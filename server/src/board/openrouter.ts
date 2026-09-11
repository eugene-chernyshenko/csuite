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

/**
 * One function call the model asked for. `arguments` is the raw JSON string the
 * model emitted — it is not parsed here, because a model that writes broken
 * JSON is a normal event the caller has to answer, not a transport failure.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * A message on the wire. Tool results ride back as `role: "tool"`, and the
 * assistant turn that asked for them has to be echoed back verbatim — a
 * provider will reject a `tool` message that answers nothing.
 */
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

/** A callable exposed to the model, in OpenAI/OpenRouter function format. */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** "auto" lets the model call tools; "none" forbids it without removing them. */
export type ToolChoice = "auto" | "none";

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
  /** Function calls the model asked for; empty when it answered in prose. */
  toolCalls: ToolCall[];
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
  /** Omitted from the body entirely when absent — a plain call stays plain. */
  tools?: readonly ToolSpec[] | undefined;
  toolChoice?: ToolChoice | undefined;
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
        messages: req.messages.map(wireMessage),
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        ...(req.tools && req.tools.length > 0 ? { tools: req.tools } : {}),
        ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
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
  const toolCalls = readToolCalls(body);
  // A turn that only asks for tools carries no prose, and that is a complete,
  // valid answer — the "no content" failure applies only when nothing came back.
  if (content === null && toolCalls.length === 0) {
    throw new OpenRouterError(
      `OpenRouter returned no message content: ${truncate(raw, 300)}`,
      status,
    );
  }

  return {
    content: content ?? "",
    usage: readUsage(body),
    model: readModel(body) ?? req.model,
    toolCalls,
  };
}

/** Our message shape → the wire's. The only place the two are allowed to differ. */
function wireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
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

/**
 * Tool calls off the wire, skipping anything malformed enough that we could not
 * answer it (no id, no name): an unanswerable call would wedge the next turn.
 */
function readToolCalls(body: unknown): ToolCall[] {
  const choices = (body as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const raw = (choices[0] as { message?: { tool_calls?: unknown } })?.message?.tool_calls;
  if (!Array.isArray(raw)) return [];

  const calls: ToolCall[] = [];
  for (const entry of raw) {
    const call = entry as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const id = call.id;
    const name = call.function?.name;
    if (typeof id !== "string" || id === "" || typeof name !== "string" || name === "") continue;
    const args = call.function?.arguments;
    calls.push({ id, name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) });
  }
  return calls;
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
