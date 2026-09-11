/**
 * Getting structured data out of a text model, cheaply.
 *
 * The rule (CLAUDE.md, cost discipline): JSON is asked for in the prompt and
 * validated with zod; a malformed answer buys **exactly one** repair attempt —
 * the model is shown its own output and the validation error — and then the
 * call fails. No loops, no escalating retries, no "just once more".
 *
 * Every response's usage is recorded even when the answer is unusable: a reply
 * we threw away still cost money, and the run's spend line must say so.
 */

import type { z } from "zod";
import { chat, truncate, type ChatMessage, type ChatUsage, type FetchLike } from "./openrouter";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Pulls the JSON object out of a model reply: tolerates a ```json fence and
 * stray prose around the braces, which is the whole repertoire of ways a
 * well-behaved model still disobeys "reply with JSON only".
 */
export function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

export function parseModelJson<S extends z.ZodType>(
  text: string,
  schema: S,
): ParseResult<z.infer<S>> {
  const json = extractJsonObject(text);
  if (json === null) return { ok: false, error: "the reply contained no JSON object" };

  let data: unknown;
  try {
    data = JSON.parse(json) as unknown;
  } catch (err) {
    return {
      ok: false,
      error: `the reply was not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  const parsed = schema.safeParse(data);
  if (parsed.success) return { ok: true, value: parsed.data as z.infer<S> };

  const issues = parsed.error.issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: `the JSON did not match the required shape — ${issues}` };
}

export class JsonCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonCallError";
  }
}

export interface JsonCallOptions<S extends z.ZodType> {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  schema: S;
  maxTokens: number;
  temperature: number;
  fetchImpl?: FetchLike | undefined;
  timeoutMs?: number | undefined;
  /** Every response's usage lands here — including the ones that failed to parse. */
  usageSink?: ChatUsage[] | undefined;
  /** Names the call in log lines, e.g. "position(cfo)". */
  label?: string;
  log?: { warn(msg: string): void } | undefined;
}

/** Builds the one repair turn: the model's own words plus what was wrong with them. */
export function repairMessages(
  original: ChatMessage[],
  badReply: string,
  error: string,
): ChatMessage[] {
  return [
    ...original,
    { role: "assistant", content: truncate(badReply, 2000) },
    {
      role: "user",
      content:
        `That reply could not be used: ${error}\n\n` +
        "Send the same content again as a single valid JSON object matching the required " +
        "shape exactly. Output only the JSON — no markdown fence, no commentary.",
    },
  ];
}

/**
 * One model call that must return JSON, with at most one repair attempt.
 * Throws {@link JsonCallError} when the second attempt is still unusable.
 */
export async function chatJson<S extends z.ZodType>(
  opts: JsonCallOptions<S>,
): Promise<z.infer<S>> {
  const call = async (messages: ChatMessage[]) => {
    const result = await chat({
      apiKey: opts.apiKey,
      model: opts.model,
      messages,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
    opts.usageSink?.push(result.usage);
    return result;
  };

  const first = await call(opts.messages);
  const parsed = parseModelJson(first.content, opts.schema);
  if (parsed.ok) return parsed.value;

  opts.log?.warn(
    `[board] ${opts.label ?? "call"}: unusable reply (${parsed.error}); one repair attempt`,
  );

  // Exactly one. If this fails the caller degrades gracefully — it never loops.
  const second = await call(repairMessages(opts.messages, first.content, parsed.error));
  const repaired = parseModelJson(second.content, opts.schema);
  if (repaired.ok) return repaired.value;

  throw new JsonCallError(
    `${opts.label ?? "call"} returned unusable JSON twice — ${repaired.error}`,
  );
}
