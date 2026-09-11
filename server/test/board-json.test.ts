/**
 * JSON out of a text model: extraction, validation, and the single repair.
 *
 * The cost rule is the thing under test as much as the parsing — a model that
 * keeps answering badly must cost exactly two calls, never three, never a loop.
 */

import { describe, expect, it } from "vitest";
import { chatJson, extractJsonObject, JsonCallError, parseModelJson } from "../src/board/json";
import {
  OPENROUTER_REFERER,
  OPENROUTER_TITLE,
  OPENROUTER_URL,
  type ChatUsage,
} from "../src/board/openrouter";
import { positionResponseSchema } from "../src/board/schemas";
import { fakeOpenRouter, positionJson } from "./openrouter-fake";

const GOOD = positionJson();
const BAD_SHAPE = JSON.stringify({ stance: "maybe", summary: "", keyPoints: [] });

describe("extractJsonObject", () => {
  it("takes the object as-is", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("unwraps a markdown fence", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("survives prose on either side", () => {
    expect(extractJsonObject('Sure!\n{"a":1}\nHope that helps.')).toBe('{"a":1}');
  });

  it("returns null when there is no object at all", () => {
    expect(extractJsonObject("I would rather discuss this in person.")).toBeNull();
  });
});

describe("parseModelJson", () => {
  it("accepts a good position and defaults an omitted assumptions list", () => {
    const withoutAssumptions = JSON.parse(GOOD) as Record<string, unknown>;
    delete withoutAssumptions["assumptions"];
    const parsed = parseModelJson(JSON.stringify(withoutAssumptions), positionResponseSchema);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.assumptions).toEqual([]);
  });

  it("names the offending fields when the shape is wrong", () => {
    const parsed = parseModelJson(BAD_SHAPE, positionResponseSchema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("stance");
      expect(parsed.error).toContain("keyPoints");
    }
  });

  it("reports unparseable text rather than throwing", () => {
    const parsed = parseModelJson("{not json at all}", positionResponseSchema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/not valid JSON/);
  });
});

describe("chatJson", () => {
  const call = (
    reply: Parameters<typeof fakeOpenRouter>[0],
    usageSink: ChatUsage[] = [],
  ) => {
    const { fetchImpl, calls } = fakeOpenRouter(reply);
    return {
      calls,
      usageSink,
      run: () =>
        chatJson({
          apiKey: "test-key",
          model: "openai/gpt-5.6-luna",
          messages: [
            { role: "system", content: "be terse" },
            { role: "user", content: "your position?" },
          ],
          schema: positionResponseSchema,
          maxTokens: 1234, // arbitrary: what matters is that the cap is passed through
          temperature: 0.7,
          fetchImpl,
          usageSink,
          label: "position(cfo)",
        }),
    };
  };

  it("sends one request with the caps, the auth and the attribution headers", async () => {
    const c = call(() => GOOD);
    await c.run();

    expect(c.calls).toHaveLength(1);
    const [only] = c.calls;
    expect(only!.url).toBe(OPENROUTER_URL);
    expect(only!.headers["Authorization"]).toBe("Bearer test-key");
    expect(only!.headers["HTTP-Referer"]).toBe(OPENROUTER_REFERER);
    expect(only!.headers["X-Title"]).toBe(OPENROUTER_TITLE);
    expect(only!.body.max_tokens).toBe(1234);
    expect(only!.body.temperature).toBe(0.7);
    expect(only!.body.model).toBe("openai/gpt-5.6-luna");
  });

  it("repairs exactly once, quoting the validation error back to the model", async () => {
    const c = call((_, i) => (i === 0 ? BAD_SHAPE : GOOD));
    const value = await c.run();

    expect(c.calls).toHaveLength(2);
    expect(value.stance).toBe("support_with_conditions");

    const repair = c.calls[1]!.body.messages;
    // The original turns, plus the bad answer, plus the correction.
    expect(repair).toHaveLength(4);
    expect(repair[2]).toMatchObject({ role: "assistant", content: BAD_SHAPE });
    expect(repair[3]!.content).toContain("stance");
    expect(repair[3]!.content).toContain("could not be used");
  });

  it("gives up after the repair instead of looping", async () => {
    const c = call(() => BAD_SHAPE);
    await expect(c.run()).rejects.toBeInstanceOf(JsonCallError);
    expect(c.calls).toHaveLength(2);
  });

  it("records the usage of every response, including the discarded one", async () => {
    const sink: ChatUsage[] = [];
    const c = call(
      (_, i) =>
        i === 0
          ? { content: BAD_SHAPE, usage: { prompt_tokens: 100, completion_tokens: 10 } }
          : { content: GOOD, usage: { prompt_tokens: 200, completion_tokens: 20 } },
      sink,
    );
    await c.run();

    // A reply we threw away still cost money.
    expect(sink).toEqual([
      { promptTokens: 100, completionTokens: 10 },
      { promptTokens: 200, completionTokens: 20 },
    ]);
  });

  it("does not retry a transport failure", async () => {
    const c = call(() => ({ status: 429, raw: '{"error":{"message":"rate limited"}}' }));
    await expect(c.run()).rejects.toThrow(/429/);
    expect(c.calls).toHaveLength(1);
  });

  it("reads OpenRouter's own cost when it reports one", async () => {
    const sink: ChatUsage[] = [];
    const c = call(
      () => ({ content: GOOD, usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0042 } }),
      sink,
    );
    await c.run();
    expect(sink[0]!.costUsd).toBe(0.0042);
  });
});

describe("response schemas", () => {
  it("rejects a position with a single key point", () => {
    const parsed = positionResponseSchema.safeParse({
      stance: "object",
      summary: "No.",
      keyPoints: ["Only one."],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts an empty assumptions list — a position can be fully grounded", () => {
    const parsed = positionResponseSchema.safeParse({
      stance: "object",
      summary: "No.",
      keyPoints: ["One.", "Two."],
      assumptions: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("is a zod schema, so unknown keys are ignored rather than fatal", () => {
    const parsed = parseModelJson(
      JSON.stringify({ ...(JSON.parse(GOOD) as object), confidence: 0.9 }),
      positionResponseSchema,
    );
    expect(parsed.ok).toBe(true);
  });
});
