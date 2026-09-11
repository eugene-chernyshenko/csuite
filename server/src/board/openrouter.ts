/**
 * The OpenRouter transport.
 *
 * Every LLM call in the platform goes through OpenRouter (CLAUDE.md: the model
 * is a role-config field, never a hardwired vendor), and this file is the only
 * place that knows what an HTTP call to a model provider looks like. No SDK on
 * purpose: it is one endpoint with one JSON body, and a dependency here would
 * be a vendor lock-in we explicitly refused.
 *
 * It knows nothing about boards, positions or proposals — it takes messages and
 * returns text plus what the call cost us.
 */

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Attribution headers OpenRouter shows on the account's activity page. */
export const OPENROUTER_REFERER = "https://github.com/eugene-chernyshenko/csuite";
export const OPENROUTER_TITLE = "csuite";

/** Hard ceiling on a single call. A board run makes a handful of these. */
export const REQUEST_TIMEOUT_MS = 60_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** What one call consumed. `costUsd` is present only when OpenRouter reports it. */
export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  /**
   * Dollar cost of this call as reported by OpenRouter (`usage.cost`, which it
   * returns because we send `usage: { include: true }`). When absent — some
   * providers and some error shapes omit it — cost.ts falls back to list price.
   */
  costUsd?: number;
}

export interface ChatResult {
  content: string;
  usage: ChatUsage;
  /** The model OpenRouter actually served, which may differ from the one asked for. */
  model: string;
}

/**
 * Narrower than `typeof fetch` so a test double taking a plain string URL is
 * assignable. The real `globalThis.fetch` satisfies it.
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ChatRequest {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** Always set explicitly: cost discipline is binding (CLAUDE.md). */
  maxTokens: number;
  temperature: number;
  fetchImpl?: FetchLike | undefined;
  timeoutMs?: number | undefined;
}

export class OpenRouterError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  const doFetch: FetchLike = req.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  const timeoutMs = req.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let status: number;
  let ok: boolean;
  let raw: string;
  try {
    const res = await doFetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_REFERER,
        "X-Title": OPENROUTER_TITLE,
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        // Asks OpenRouter to report what the call actually cost, so the CFO's
        // opex line is measured rather than estimated.
        usage: { include: true },
      }),
    });
    status = res.status;
    ok = res.ok;
    // Read the body inside the timeout window: an aborted stream must not hang.
    raw = await res.text();
  } catch (err) {
    if (controller.signal.aborted) {
      throw new OpenRouterError(`OpenRouter call timed out after ${timeoutMs}ms`);
    }
    throw new OpenRouterError(
      `OpenRouter call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const body = safeJson(raw);

  if (!ok) {
    throw new OpenRouterError(`OpenRouter returned ${status}: ${truncate(raw, 300)}`, status);
  }

  const content = readContent(body);
  if (content === null) {
    throw new OpenRouterError(
      `OpenRouter returned no message content: ${truncate(raw, 300)}`,
      status,
    );
  }

  return { content, usage: readUsage(body), model: readModel(body) ?? req.model };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function readContent(body: unknown): string | null {
  const choices = (body as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } })?.message;
  const content = message?.content;
  if (typeof content !== "string" || content.trim() === "") return null;
  return content;
}

function readModel(body: unknown): string | null {
  const model = (body as { model?: unknown })?.model;
  return typeof model === "string" && model !== "" ? model : null;
}

function readUsage(body: unknown): ChatUsage {
  const usage = (body as { usage?: Record<string, unknown> })?.usage ?? {};
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  const cost = usage["cost"];
  const result: ChatUsage = {
    promptTokens: num(usage["prompt_tokens"]),
    completionTokens: num(usage["completion_tokens"]),
  };
  if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) result.costUsd = cost;
  return result;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
