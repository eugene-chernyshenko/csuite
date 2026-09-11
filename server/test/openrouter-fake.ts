/**
 * A fake OpenRouter — the only way the board is ever exercised in tests.
 *
 * `npm test` must stay runnable with nothing up and must never touch a real
 * model: no network, no key, no spend. This double speaks the same wire shape
 * the real endpoint does (choices[0].message.content + usage) and records every
 * request so tests can assert on what was actually sent.
 */

import type { FetchLike } from "../src/board/openrouter";

export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    messages: { role: string; content: string }[];
    max_tokens: number;
    temperature: number;
  };
}

export interface FakeUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cost?: number;
}

export interface FakeReply {
  /** The assistant message text. */
  content?: string;
  usage?: FakeUsage;
  /** Return an HTTP error instead of a completion. */
  status?: number;
  raw?: string;
  /** Make the fetch itself reject, as a dropped connection would. */
  throws?: string;
}

/** 1200 in / 800 out → $0.0012 per call at the default model's list price. */
export const DEFAULT_USAGE: FakeUsage = { prompt_tokens: 1200, completion_tokens: 800 };

export function fakeOpenRouter(
  reply: (call: RecordedCall, index: number) => string | FakeReply,
): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const fetchImpl: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init.body)) as RecordedCall["body"];
    const call: RecordedCall = {
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body,
    };
    calls.push(call);

    const raw = reply(call, calls.length - 1);
    const spec: FakeReply = typeof raw === "string" ? { content: raw } : raw;

    if (spec.throws) throw new Error(spec.throws);
    if (spec.status !== undefined && spec.status >= 400) {
      return new Response(spec.raw ?? '{"error":{"message":"upstream said no"}}', {
        status: spec.status,
      });
    }
    return new Response(
      JSON.stringify({
        id: `gen-${calls.length}`,
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: spec.content ?? "" } }],
        usage: spec.usage ?? DEFAULT_USAGE,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  return { fetchImpl, calls };
}

export const systemOf = (call: RecordedCall): string => call.body.messages[0]?.content ?? "";
export const userOf = (call: RecordedCall): string => call.body.messages[1]?.content ?? "";

/** Stage 2 prompts are the only ones that mention writing the document. */
export const isSynthesis = (call: RecordedCall): boolean =>
  systemOf(call).includes("proposal document for the CEO");

/** Which board member a stage-1 call belongs to, by the name the prompt opens with. */
export function addresseeOf(call: RecordedCall): string {
  return /^You are ([^,]+),/.exec(systemOf(call))?.[1] ?? "";
}

export function positionJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stance: "support_with_conditions",
    summary: "Worth doing if we cap the spend.",
    keyPoints: [
      "The upside is concentrated in the first two months, so a short test reads clean.",
      "Nothing here touches the billing system, so the engineering cost is close to zero.",
    ],
    assumptions: ["Assumes a $54 blended CAC; not given in the profile."],
    ...overrides,
  });
}

export function proposalJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: "Run a four-week sponsorship test",
    summary: "Spend a capped $2,400 to find out whether the channel converts.",
    rationale: "Paragraph one.\n\nParagraph two.\n\nParagraph three.",
    alternatives: ["Do nothing for a quarter.", "Put the money into paid search instead."],
    cost: { amount: 2400, note: "Two shows, four weeks, half up front." },
    risks: [
      "Attribution is soft and may undercount.",
      "Two shows is not a sample.",
      "The spend is sunk if we kill it at week two.",
    ],
    disagreements: [],
    ...overrides,
  });
}
