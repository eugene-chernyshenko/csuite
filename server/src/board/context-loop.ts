/**
 * The position stage's tool loop — "board context, on demand, not wholesale"
 * (docs/en/ARCHITECTURE.md).
 *
 * A board member may consult the company's own memory before taking a stance:
 * the model is offered the role's context tools, it asks for what its domain
 * needs, each call is executed against the registry and fed back as a `tool`
 * message, and the loop ends when the model stops asking and writes its JSON
 * position.
 *
 * Cost discipline is binding (CLAUDE.md), so the loop is bounded on every axis
 * that could run away: a hard budget of *individual* tool calls per position
 * (`BOARD_MAX_TOOL_CALLS`), a whole-position deadline, a per-HTTP-call timeout,
 * a ceiling on how much text one tool result may push back into the context,
 * and the same one-shot JSON repair the tool-free path gets — never a second.
 * When the budget runs out the model is told so in a tool result and the next
 * turn goes out with `tool_choice: "none"`: it must write the position now.
 *
 * Nothing here knows about the event log. Executed calls are reported through
 * `onConsult` so the runner can append `context_consulted` — provenance is the
 * runner's business, execution is ours.
 */

import type { z } from "zod";
import { ContextToolError, type ContextRegistry, type ContextToolDef } from "../context/types";
import { JsonCallError, parseModelJson, repairMessages } from "./json";
import {
  chat,
  OpenRouterError,
  REQUEST_TIMEOUT_MS,
  truncate,
  type ChatMessage,
  type ChatUsage,
  type FetchLike,
  type ToolCall,
  type ToolSpec,
} from "./openrouter";

/** Individual tool calls one position may make. Env: `BOARD_MAX_TOOL_CALLS`. */
export const DEFAULT_MAX_TOOL_CALLS = 6;

/** A position may spend minutes consulting, but not a quarter of an hour. */
export const POSITION_DEADLINE_MS = 5 * 60_000;

/** One tool result is evidence, not a document dump — and every char is paid for. */
export const MAX_TOOL_RESULT_CHARS = 4000;

/** What the model is told when it has spent its budget. */
export const BUDGET_EXHAUSTED_MESSAGE =
  "call budget exhausted — write your position now, using what you already have.";

/** One executed call, as the runner will record it in `context_consulted`. */
export interface Consultation {
  roleId: string;
  tool: string;
  /** The arguments as executed. Unparseable JSON is kept as `{ raw }`. */
  args: Record<string, unknown>;
  ok: boolean;
}

export interface ToolLoopOptions<S extends z.ZodType> {
  apiKey: string;
  model: string;
  /** The position prompt. The loop appends to a copy; the caller's array is untouched. */
  messages: ChatMessage[];
  schema: S;
  maxTokens: number;
  temperature: number;
  /** The role's tools. An empty list makes this a plain `chatJson` with extra steps. */
  tools: readonly ContextToolDef[];
  registry: ContextRegistry;
  companyId: string;
  roleId: string;
  maxToolCalls?: number | undefined;
  deadlineMs?: number | undefined;
  fetchImpl?: FetchLike | undefined;
  /** Every HTTP call's usage lands here, tool rounds included. */
  usageSink?: ChatUsage[] | undefined;
  label?: string | undefined;
  log?: { warn(msg: string): void } | undefined;
  /** Awaited after each executed call, in call order, before the next one runs. */
  onConsult?: ((consultation: Consultation) => Promise<void>) | undefined;
}

export interface ToolLoopResult<T> {
  value: T;
  /** Calls actually executed (a refused-for-budget call is not one). */
  consultations: number;
}

/** ContextToolDef → the OpenAI function shape OpenRouter expects. */
export function toToolSpecs(tools: readonly ContextToolDef[]): ToolSpec[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * True when the failure is the provider refusing the `tools` parameter itself —
 * some models and some routes do not do function calling. The caller's answer
 * is to try the position once more without tools, not to lose the position.
 */
export function isToolsRejection(err: unknown): boolean {
  return (
    err instanceof OpenRouterError &&
    err.status === 400 &&
    /\btools?\b|\bfunction[_ -]?call|\bfunctions?\b/i.test(err.message)
  );
}

export async function chatJsonWithTools<S extends z.ZodType>(
  opts: ToolLoopOptions<S>,
): Promise<ToolLoopResult<z.infer<S>>> {
  const label = opts.label ?? "call";
  const budget = opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const specs = toToolSpecs(opts.tools);
  const deadline = Date.now() + (opts.deadlineMs ?? POSITION_DEADLINE_MS);

  const messages: ChatMessage[] = [...opts.messages];
  let used = 0;
  let toolsOn = specs.length > 0 && budget > 0;
  let consultations = 0;

  const call = async (toolsAllowed: boolean) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new JsonCallError(`${label} ran out of time before it produced a position`);
    }
    const result = await chat({
      apiKey: opts.apiKey,
      model: opts.model,
      messages,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      fetchImpl: opts.fetchImpl,
      timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remaining),
      ...(specs.length > 0
        ? { tools: specs, toolChoice: toolsAllowed ? ("auto" as const) : ("none" as const) }
        : {}),
    });
    opts.usageSink?.push(result.usage);
    return result;
  };

  // Bounded twice over: each round with tools spends at least one unit of the
  // budget, and this ceiling stands even if a provider echoes an empty round.
  const maxRounds = budget + 2;

  for (let round = 0; round <= maxRounds; round++) {
    const answer = await call(toolsOn);

    if (!toolsOn || answer.toolCalls.length === 0) {
      const value = await finalise<S>(answer.content, messages, opts, label, deadline);
      return { value, consultations };
    }

    messages.push({ role: "assistant", content: answer.content, toolCalls: answer.toolCalls });

    for (const toolCall of answer.toolCalls) {
      if (used >= budget) {
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: BUDGET_EXHAUSTED_MESSAGE,
        });
        continue;
      }
      used++;
      const outcome = await execute(opts, toolCall);
      consultations++;
      await opts.onConsult?.({
        roleId: opts.roleId,
        tool: toolCall.name,
        args: outcome.args,
        ok: outcome.ok,
      });
      messages.push({ role: "tool", toolCallId: toolCall.id, content: outcome.content });
    }

    if (used >= budget) {
      // Said once, in the log as well as to the model: the position is now due.
      if (toolsOn) {
        opts.log?.warn(
          `[board] ${label}: context-tool budget of ${budget} call(s) spent; ` +
            "asking for the position without tools",
        );
      }
      toolsOn = false;
    }
  }

  throw new JsonCallError(`${label} kept calling tools past its budget and never answered`);
}

/**
 * One executed tool call. Never throws: a bad argument or a broken tool is
 * something the model can recover from, and it is told so in the tool result.
 */
async function execute(
  opts: ToolLoopOptions<z.ZodType>,
  toolCall: ToolCall,
): Promise<{ content: string; ok: boolean; args: Record<string, unknown> }> {
  const raw = toolCall.arguments.trim();

  let parsed: unknown;
  try {
    parsed = raw === "" ? {} : JSON.parse(raw);
  } catch (err) {
    // Counts against the budget: a model that cannot write JSON arguments must
    // not be free to keep trying.
    return {
      ok: false,
      args: { raw: truncate(raw, 500) },
      content:
        `Error: the arguments for ${toolCall.name} were not valid JSON ` +
        `(${err instanceof Error ? err.message : String(err)}). ` +
        "Send the arguments as a JSON object, or answer without this tool.",
    };
  }

  const args = asRecord(parsed);
  try {
    const result = await opts.registry.run(opts.companyId, opts.roleId, toolCall.name, parsed);
    return { ok: true, args, content: truncate(result, MAX_TOOL_RESULT_CHARS) };
  } catch (err) {
    const message =
      err instanceof ContextToolError
        ? err.message
        : `the tool failed unexpectedly (${err instanceof Error ? err.message : String(err)})`;
    return {
      ok: false,
      args,
      content: `Error: ${truncate(message, 500)}. Try different arguments, another tool, or answer without it.`,
    };
  }
}

/** Parses the model's final JSON, buying exactly one repair turn — as ever. */
async function finalise<S extends z.ZodType>(
  content: string,
  messages: ChatMessage[],
  opts: ToolLoopOptions<S>,
  label: string,
  deadline: number,
): Promise<z.infer<S>> {
  const parsed = parseModelJson(content, opts.schema);
  if (parsed.ok) return parsed.value;

  opts.log?.warn(`[board] ${label}: unusable reply (${parsed.error}); one repair attempt`);

  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new JsonCallError(`${label} ran out of time before it produced a position`);
  }

  const specs = toToolSpecs(opts.tools);
  const repaired = await chat({
    apiKey: opts.apiKey,
    model: opts.model,
    messages: repairMessages(messages, content, parsed.error),
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    fetchImpl: opts.fetchImpl,
    timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remaining),
    // The repair turn is for JSON, not for more consulting.
    ...(specs.length > 0 ? { tools: specs, toolChoice: "none" as const } : {}),
  });
  opts.usageSink?.push(repaired.usage);

  const second = parseModelJson(repaired.content, opts.schema);
  if (second.ok) return second.value;
  throw new JsonCallError(`${label} returned unusable JSON twice — ${second.error}`);
}

/** Tool arguments as an object, so the provenance event always has a body. */
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return value === undefined ? {} : { value };
}
