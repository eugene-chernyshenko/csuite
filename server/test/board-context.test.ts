/**
 * The board consulting company memory — "on demand, not wholesale"
 * (docs/en/ARCHITECTURE.md).
 *
 * What is asserted here is the shape of a *consultation*: a board member asks
 * the registry for what its own domain needs, every executed call lands in the
 * log as `context_consulted` before the position it informed, the results come
 * back to the model as tool messages, and every one of those extra HTTP calls
 * is paid for in the run's closing spend line. Then the edges that must not
 * cost a position: a spent budget, a model that cannot do tools at all, a tool
 * that fails, and arguments that are not JSON.
 *
 * Still no network, no key, no spend.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { CompanyEventType } from "@csuite/contract";
import {
  BUDGET_EXHAUSTED_MESSAGE,
  chatJsonWithTools,
  isToolsRejection,
  POSITION_DEADLINE_MS,
} from "../src/board/context-loop";
import { describeSpend } from "../src/board/cost";
import { OpenRouterError } from "../src/board/openrouter";
import { positionResponseSchema } from "../src/board/schemas";
import { buildPositionMessages, companyProfile } from "../src/board/prompts";
import { runBoard, type BoardDeps } from "../src/board/run";
import { ContextToolError, type ContextRegistry, type ContextToolDef } from "../src/context/types";
import { memoryEventStore } from "../src/store/memory";
import type { EventStore, StoredEvent } from "../src/store/types";
import { boardConfig, roleById } from "./board-fixtures";
import {
  addresseeOf,
  fakeOpenRouter,
  isSynthesis,
  positionJson,
  proposalJson,
  toolResultsOf,
  toolNamesOf,
  type FakeReply,
  type RecordedCall,
} from "./openrouter-fake";

const COMPANY = "brightpage";
const QUESTION = "Should we sponsor two indie-author podcasts for four weeks?";

/** Which fixture role each board member's prompt is addressed to. */
const ROLE_OF: Record<string, string> = { Marcus: "cfo", Iris: "cto", Dana: "coo" };

let store: EventStore;

beforeEach(async () => {
  store = memoryEventStore();
  await store.createCompany({ id: COMPANY, config: boardConfig });
  await store.appendEvents(COMPANY, [{ type: "day_started" }]);
});

// ------------------------------------------------------------------ doubles

const LIBRARY_SEARCH: ContextToolDef = {
  name: "library_search",
  description: "Search the company library for documents matching a query.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" }, type: { type: "string" } },
    required: ["query"],
  },
  run: async () => "unused: the registry, not the def, is what the loop calls",
};

const LIBRARY_READ: ContextToolDef = {
  name: "library_read",
  description: "Read one document from the company library by id.",
  parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  run: async () => "unused",
};

interface RegistryCall {
  companyId: string;
  roleId: string;
  name: string;
  args: unknown;
}

/** A ContextRegistry built against the seam only — no library, no database. */
function fakeRegistry(
  handler: (call: RegistryCall) => Promise<string> | string = () =>
    "August finance summary: support spend ran at $4,100/mo.",
  tools: ContextToolDef[] = [LIBRARY_SEARCH, LIBRARY_READ],
): ContextRegistry & { calls: RegistryCall[] } {
  const calls: RegistryCall[] = [];
  return {
    calls,
    toolsFor: () => tools,
    run: async (companyId, roleId, name, args) => {
      const call: RegistryCall = { companyId, roleId, name, args };
      calls.push(call);
      if (!tools.some((t) => t.name === name)) {
        throw new ContextToolError(`Unknown context tool: ${name}`);
      }
      return handler(call);
    },
  };
}

/**
 * A fake board: `script` answers the nth position call for a given member,
 * synthesis always answers with the document.
 */
function scriptedBoard(
  script: (who: string, turn: number, call: RecordedCall) => string | FakeReply,
) {
  const turns = new Map<string, number>();
  return fakeOpenRouter((call) => {
    if (isSynthesis(call)) return proposalJson();
    const who = addresseeOf(call);
    const turn = turns.get(who) ?? 0;
    turns.set(who, turn + 1);
    return script(who, turn, call);
  });
}

async function run(over: Partial<BoardDeps>) {
  await runBoard(COMPANY, QUESTION, { store, apiKey: "test-key", model: "openai/gpt-5.6-luna", ...over });
  return store.listEvents(COMPANY);
}

const typesOf = (events: StoredEvent[]): CompanyEventType[] => events.map((e) => e.type);
const consultationsIn = (events: StoredEvent[]) =>
  events.flatMap((e) => (e.type === "context_consulted" ? [e] : []));
const closingNote = (events: StoredEvent[]): string => {
  const last = events[events.length - 1];
  if (!last || last.type !== "worklog") throw new Error("the run did not close with a worklog");
  return last.note ?? "";
};
const positionCalls = (calls: RecordedCall[]) => calls.filter((c) => !isSynthesis(c));
const callsFor = (calls: RecordedCall[], who: string) =>
  positionCalls(calls).filter((c) => addresseeOf(c) === who);

// --------------------------------------------------------------- happy path

describe("position tool loop — a member consults, then takes a stance", () => {
  it("threads two consultations into the position and records both, in order", async () => {
    const registry = fakeRegistry(({ name }) =>
      name === "library_search"
        ? "doc-fin-aug — August finance summary (finance, current)"
        : "August finance summary: support spend ran at $4,100/mo against a $5,000 line.",
    );

    const { fetchImpl, calls } = scriptedBoard((who, turn) => {
      if (who !== "Marcus") return positionJson();
      if (turn === 0) {
        return { toolCalls: [{ name: "library_search", arguments: '{"query":"finance summary"}' }] };
      }
      if (turn === 1) {
        return { toolCalls: [{ name: "library_read", arguments: '{"id":"doc-fin-aug"}' }] };
      }
      return positionJson();
    });

    const events = await run({ fetchImpl, context: registry });

    // The registry saw both calls, scoped to the company and the asking role.
    expect(registry.calls).toEqual([
      { companyId: COMPANY, roleId: "cfo", name: "library_search", args: { query: "finance summary" } },
      { companyId: COMPANY, roleId: "cfo", name: "library_read", args: { id: "doc-fin-aug" } },
    ]);

    // Provenance in the log: both consultations, in call order, before the
    // position they informed.
    const consulted = consultationsIn(events);
    expect(consulted).toHaveLength(2);
    expect(consulted.map((e) => e.tool)).toEqual(["library_search", "library_read"]);
    expect(consulted.every((e) => e.roleId === "cfo" && e.ok)).toBe(true);
    expect(consulted[1]!.args).toEqual({ id: "doc-fin-aug" });

    const cfoPosition = events.findIndex(
      (e) => e.type === "position_submitted" && e.position.roleId === "cfo",
    );
    const lastConsult = events.map((e) => e.type).lastIndexOf("context_consulted");
    expect(lastConsult).toBeGreaterThan(-1);
    expect(lastConsult).toBeLessThan(cfoPosition);

    // The results really came back to the model, oldest first.
    const marcus = callsFor(calls, "Marcus");
    expect(marcus).toHaveLength(3);
    expect(toolResultsOf(marcus[2]!)).toEqual([
      "doc-fin-aug — August finance summary (finance, current)",
      "August finance summary: support spend ran at $4,100/mo against a $5,000 line.",
    ]);
    // ...attached to the assistant turn that asked for them.
    const asked = marcus[2]!.body.messages.filter((m) => m.tool_calls);
    expect(asked).toHaveLength(2);
    expect(asked[0]!.tool_calls![0]!.function.name).toBe("library_search");
    expect(marcus[2]!.body.messages.find((m) => m.role === "tool")!.tool_call_id).toBe(
      asked[0]!.tool_calls![0]!.id,
    );

    // Every position call offered the tools; synthesis never does.
    for (const call of positionCalls(calls)) {
      expect(toolNamesOf(call)).toEqual(["library_search", "library_read"]);
      expect(call.body.tool_choice).toBe("auto");
    }
    const [synthesis] = calls.filter(isSynthesis);
    expect(synthesis!.body.tools).toBeUndefined();
    expect(synthesis!.body.tool_choice).toBeUndefined();

    // Every tool round is a paid HTTP call, and the closing line says so:
    // 3 (Marcus) + 1 + 1 + 1 synthesis = 6 calls at $0.0012 each.
    expect(closingNote(events)).toBe(
      "Board run complete — 6 calls (3 with tools, 2 tool consultations), $0.0072",
    );
    expect(typesOf(events).filter((t) => t === "proposal_submitted")).toHaveLength(1);
  });

  it("passes each tool through as an OpenAI function definition", async () => {
    const { fetchImpl, calls } = scriptedBoard(() => positionJson());
    await run({ fetchImpl, context: fakeRegistry() });

    const [tool] = positionCalls(calls)[0]!.body.tools!;
    expect(tool).toEqual({
      type: "function",
      function: {
        name: "library_search",
        description: LIBRARY_SEARCH.description,
        parameters: LIBRARY_SEARCH.parameters,
      },
    });
  });
});

// ------------------------------------------------------------------- budget

describe("position tool loop — the call budget is a wall", () => {
  it("refuses calls past the cap and takes the tools away", async () => {
    const registry = fakeRegistry(() => "a document");
    // A member that would read the whole archive if we let it.
    const { fetchImpl, calls } = scriptedBoard((who, _turn, call) => {
      if (who !== "Marcus") return positionJson();
      if (call.body.tool_choice === "none") return positionJson();
      return {
        toolCalls: [
          { name: "library_search", arguments: '{"query":"a"}' },
          { name: "library_search", arguments: '{"query":"b"}' },
        ],
      };
    });

    const events = await run({ fetchImpl, context: registry, maxToolCalls: 3 });

    // Three executed, the fourth refused without ever reaching the registry.
    expect(registry.calls).toHaveLength(3);
    expect(consultationsIn(events)).toHaveLength(3);

    const marcus = callsFor(calls, "Marcus");
    expect(marcus).toHaveLength(3);
    expect(toolResultsOf(marcus[2]!)).toEqual([
      "a document",
      "a document",
      "a document",
      BUDGET_EXHAUSTED_MESSAGE,
    ]);

    // The last turn still carries the definitions, but forbids using them.
    expect(marcus[2]!.body.tool_choice).toBe("none");
    expect(marcus[0]!.body.tool_choice).toBe("auto");

    // And the position still lands — the budget ends the consulting, not the member.
    const cfo = events.find((e) => e.type === "position_submitted" && e.position.roleId === "cfo");
    expect(cfo).toBeDefined();
    expect(closingNote(events)).toMatch(/\(3 with tools, 3 tool consultations\)/);
  });

  it("never offers tools at all when the budget is zero", async () => {
    const { fetchImpl, calls } = scriptedBoard(() => positionJson());
    const events = await run({ fetchImpl, context: fakeRegistry(), maxToolCalls: 0 });

    // Not "attached but forbidden": a budget of zero is a tool-free run, down to
    // the prompt — an invitation the member could not accept costs real tokens.
    for (const call of positionCalls(calls)) {
      expect(call.body.tools).toBeUndefined();
      expect(call.body.tool_choice).toBeUndefined();
      expect(call.body.messages[0]!.content).not.toContain("CONTEXT TOOLS");
    }
    expect(consultationsIn(events)).toHaveLength(0);
    expect(closingNote(events)).toBe("Board run complete — 4 calls, $0.0048");
  });
});

// --------------------------------------------------------------- robustness

describe("position tool loop — failures reach the model, never the run", () => {
  it("hands a tool error back to the model and records it as a failed consultation", async () => {
    const registry = fakeRegistry(() => {
      throw new ContextToolError("no document with id doc-nope");
    });
    const { fetchImpl, calls } = scriptedBoard((who, turn) => {
      if (who !== "Marcus") return positionJson();
      return turn === 0
        ? { toolCalls: [{ name: "library_read", arguments: '{"id":"doc-nope"}' }] }
        : positionJson();
    });

    const events = await run({ fetchImpl, context: registry });

    const [consulted] = consultationsIn(events);
    expect(consulted).toBeDefined();
    expect(consulted!.ok).toBe(false);
    expect(consulted!.tool).toBe("library_read");
    expect(consulted!.args).toEqual({ id: "doc-nope" });

    expect(toolResultsOf(callsFor(calls, "Marcus")[1]!)[0]).toMatch(
      /^Error: no document with id doc-nope/,
    );
    // The run is untouched by it.
    expect(typesOf(events)).toContain("proposal_submitted");
    expect(events.some((e) => e.type === "worklog" && /Position failed/.test(e.note ?? ""))).toBe(
      false,
    );
  });

  it("survives a tool that throws something unexpected", async () => {
    const registry = fakeRegistry(() => {
      throw new TypeError("registry is on fire");
    });
    const { fetchImpl, calls } = scriptedBoard((who, turn) =>
      who === "Marcus" && turn === 0
        ? { toolCalls: [{ name: "library_search", arguments: '{"query":"x"}' }] }
        : positionJson(),
    );

    const events = await run({ fetchImpl, context: registry });

    expect(consultationsIn(events)[0]!.ok).toBe(false);
    expect(toolResultsOf(callsFor(calls, "Marcus")[1]!)[0]).toMatch(/registry is on fire/);
    expect(typesOf(events)).toContain("proposal_submitted");
  });

  it("answers malformed tool arguments with an error, and charges them to the budget", async () => {
    const registry = fakeRegistry();
    const { fetchImpl, calls } = scriptedBoard((who, turn) =>
      who === "Marcus" && turn === 0
        ? { toolCalls: [{ name: "library_read", arguments: "{not json" }] }
        : positionJson(),
    );

    const events = await run({ fetchImpl, context: registry });

    // The registry was never asked: the call died on its own arguments.
    expect(registry.calls).toHaveLength(0);
    const [consulted] = consultationsIn(events);
    expect(consulted!.ok).toBe(false);
    expect(consulted!.args).toEqual({ raw: "{not json" });
    expect(toolResultsOf(callsFor(calls, "Marcus")[1]!)[0]).toMatch(/were not valid JSON/);
    // It cost a consultation all the same.
    expect(closingNote(events)).toMatch(/1 tool consultation\)/);
  });

  it("retries a position without tools when the model rejects the tools parameter", async () => {
    const registry = fakeRegistry();
    const { fetchImpl, calls } = fakeOpenRouter((call) => {
      if (isSynthesis(call)) return proposalJson();
      if (call.body.tools) {
        return {
          status: 400,
          raw: '{"error":{"message":"No endpoints found that support tool use."}}',
        };
      }
      return positionJson();
    });

    const events = await run({ fetchImpl, context: registry });

    // Every member tried once with tools, then wrote a position without them.
    expect(positionCalls(calls).filter((c) => c.body.tools)).toHaveLength(3);
    expect(positionCalls(calls).filter((c) => !c.body.tools)).toHaveLength(3);
    expect(consultationsIn(events)).toHaveLength(0);

    const warned = events.filter(
      (e) => e.type === "worklog" && /Context tools unavailable/.test(e.note ?? ""),
    );
    expect(warned).toHaveLength(3);
    expect(new Set(warned.map((e) => (e as { roleId: string }).roleId))).toEqual(
      new Set(["cfo", "cto", "coo"]),
    );

    expect(typesOf(events)).toContain("proposal_submitted");
    // The rejected calls returned no usage, so the run is priced at the 4 that worked.
    expect(closingNote(events)).toBe("Board run complete — 4 calls, $0.0048");
  });

  it("keeps writing positions when the registry cannot even list its tools", async () => {
    const broken: ContextRegistry = {
      toolsFor: () => {
        throw new Error("registry unavailable");
      },
      run: async () => "unreachable",
    };
    const { fetchImpl, calls } = scriptedBoard(() => positionJson());
    const events = await run({ fetchImpl, context: broken });

    expect(positionCalls(calls).every((c) => c.body.tools === undefined)).toBe(true);
    expect(closingNote(events)).toBe("Board run complete — 4 calls, $0.0048");
  });
});

// --------------------------------------------------------------- regression

describe("no context registry — nothing changes", () => {
  it("sends no tools field and closes with the old spend line", async () => {
    const { fetchImpl, calls } = scriptedBoard(() => positionJson());
    const events = await run({ fetchImpl });

    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.body.tools).toBeUndefined();
      expect(call.body.tool_choice).toBeUndefined();
    }
    expect(consultationsIn(events)).toHaveLength(0);
    expect(closingNote(events)).toBe("Board run complete — 4 calls, $0.0048");
  });

  it("treats an empty registry — the stub every deployment starts with — the same way", async () => {
    const empty = fakeRegistry(() => "unreachable", []);
    const { fetchImpl, calls } = scriptedBoard(() => positionJson());
    const events = await run({ fetchImpl, context: empty });

    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call.body.tools).toBeUndefined();
    expect(closingNote(events)).toBe("Board run complete — 4 calls, $0.0048");
  });
});

// ------------------------------------------------------------------ prompts

describe("the position prompt with tools", () => {
  const profile = companyProfile(boardConfig);
  const withTools = buildPositionMessages({
    profile,
    role: roleById("cfo"),
    question: QUESTION,
    tools: [LIBRARY_SEARCH, LIBRARY_READ],
  })
    .map((m) => m.content)
    .join("\n");

  it("invites consultation, narrowly, and only when there is something to consult", () => {
    expect(withTools).toContain("CONTEXT TOOLS");
    expect(withTools).toMatch(/Consult what your own domain needs/);

    const without = buildPositionMessages({ profile, role: roleById("cfo"), question: QUESTION })
      .map((m) => m.content)
      .join("\n");
    expect(without).not.toContain("CONTEXT TOOLS");
    expect(without).toContain("the only grounded facts available");
  });

  it("makes tool-obtained figures grounded, and cited", () => {
    expect(withTools).toMatch(/obtained from a tool is GROUNDED/);
    expect(withTools).toMatch(/Say where it came from/);
    expect(withTools).toMatch(/still belongs in "assumptions"/);
  });

  it("says plainly that colleagues are not in there", () => {
    expect(withTools).toMatch(/returns another board member's position/);
    expect(withTools).toMatch(/by design/);
  });

  it("stays blind: no tool section leaks a colleague", () => {
    for (const role of boardConfig.roles.filter((r) => r.kind === "board")) {
      const prompt = buildPositionMessages({
        profile,
        role,
        question: QUESTION,
        tools: [LIBRARY_SEARCH, LIBRARY_READ],
      })
        .map((m) => m.content)
        .join("\n");
      for (const other of boardConfig.roles.filter((r) => r.kind === "board" && r.id !== role.id)) {
        expect(prompt).not.toContain(other.name);
        expect(prompt).not.toContain(other.title);
        expect(prompt).not.toContain(other.mandate);
        expect(prompt).not.toContain(other.id);
      }
    }
  });
});

// ------------------------------------------------------------------- limits

describe("the loop's own limits", () => {
  it("gives a position five minutes to finish consulting", () => {
    expect(POSITION_DEADLINE_MS).toBe(300_000);
  });

  it("stops rather than consult past its deadline", async () => {
    const registry = fakeRegistry();
    const { fetchImpl, calls } = fakeOpenRouter(() => ({
      toolCalls: [{ name: "library_search", arguments: '{"query":"x"}' }],
    }));

    await expect(
      chatJsonWithTools({
        apiKey: "k",
        model: "openai/gpt-5.6-luna",
        messages: [{ role: "user", content: "write a position" }],
        schema: positionResponseSchema,
        maxTokens: 100,
        temperature: 0.7,
        tools: [LIBRARY_SEARCH],
        registry,
        companyId: COMPANY,
        roleId: "cfo",
        // Already past: the very first call must not go out.
        deadlineMs: -1,
        fetchImpl,
      }),
    ).rejects.toThrow(/ran out of time/);
    expect(calls).toHaveLength(0);
  });

  it("knows a refused tools parameter from any other 400", () => {
    expect(isToolsRejection(new OpenRouterError("OpenRouter returned 400: no endpoints support tool use", 400))).toBe(true);
    expect(
      isToolsRejection(new OpenRouterError("OpenRouter returned 400: function calling unsupported", 400)),
    ).toBe(true);
    // A different complaint is a real failure, and the position fails with it.
    expect(
      isToolsRejection(new OpenRouterError("OpenRouter returned 400: max_tokens too large", 400)),
    ).toBe(false);
    expect(isToolsRejection(new OpenRouterError("OpenRouter returned 500: tools broke", 500))).toBe(
      false,
    );
    expect(isToolsRejection(new Error("tools"))).toBe(false);
  });

  it("fails the position on a 400 that is not about tools, without a second attempt", async () => {
    const { fetchImpl, calls } = fakeOpenRouter((call) =>
      isSynthesis(call)
        ? proposalJson()
        : { status: 400, raw: '{"error":{"message":"max_tokens is too large"}}' },
    );
    const events = await run({ fetchImpl, context: fakeRegistry() });

    // One attempt per member and no fallback retry.
    expect(positionCalls(calls)).toHaveLength(3);
    expect(events.filter((e) => e.type === "worklog" && /Position failed/.test(e.note ?? ""))).toHaveLength(3);
    expect(typesOf(events)).not.toContain("proposal_submitted");
  });
});

describe("describeSpend with tool use", () => {
  const usage = { promptTokens: 1200, completionTokens: 800 };
  const run4 = [usage, usage, usage, usage];

  it("reports tool use only when there was any", () => {
    expect(describeSpend(run4)).toBe("4 calls, $0.0048");
    expect(describeSpend(run4, { positionsWithTools: 0, consultations: 0 })).toBe(
      "4 calls, $0.0048",
    );
    expect(describeSpend(run4, { positionsWithTools: 3, consultations: 1 })).toBe(
      "4 calls (3 with tools, 1 tool consultation), $0.0048",
    );
    expect(describeSpend(run4, { positionsWithTools: 3, consultations: 5 })).toBe(
      "4 calls (3 with tools, 5 tool consultations), $0.0048",
    );
  });
});
