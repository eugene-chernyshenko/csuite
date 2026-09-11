/**
 * The board run, end to end, against the in-memory log and a fake OpenRouter.
 *
 * What is actually being asserted is the *shape of a deliberation*: three blind
 * positions land before any document does, disagreements are recorded as events
 * naming roles that really spoke, and the run closes by saying what it cost.
 * No network, no key, no spend.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { CompanyEventType, Proposal } from "@csuite/contract";
import {
  asAssumption,
  DEFAULT_BOARD_MODEL,
  makeProposalId,
  modelFor,
  pickDraftingRole,
  resolveRoleIds,
  runBoard,
  type BoardDeps,
} from "../src/board/run";
import { DEFAULT_POSITION_MAX_TOKENS, DEFAULT_SYNTHESIS_MAX_TOKENS } from "../src/board/prompts";
import { memoryEventStore } from "../src/store/memory";
import type { EventStore, StoredEvent } from "../src/store/types";
import { boardConfig, roleById } from "./board-fixtures";
import {
  addresseeOf,
  fakeOpenRouter,
  isSynthesis,
  positionJson,
  proposalJson,
  type FakeReply,
  type RecordedCall,
} from "./openrouter-fake";

const COMPANY = "brightpage";
const QUESTION = "Should we sponsor two indie-author podcasts for four weeks?";

let store: EventStore;

beforeEach(async () => {
  store = memoryEventStore();
  await store.createCompany({ id: COMPANY, config: boardConfig });
  await store.appendEvents(COMPANY, [{ type: "day_started" }]);
});

/** Answers every position call one way, the single synthesis call another. */
function board(
  position: (call: RecordedCall) => string | FakeReply,
  synthesis: string | FakeReply,
) {
  return fakeOpenRouter((call) => (isSynthesis(call) ? synthesis : position(call)));
}

async function run(fetchImpl: BoardDeps["fetchImpl"], over: Partial<BoardDeps> = {}) {
  await runBoard(COMPANY, QUESTION, {
    store,
    apiKey: "test-key",
    model: "openai/gpt-5.6-luna",
    fetchImpl,
    ...over,
  });
  return store.listEvents(COMPANY);
}

const typesOf = (events: StoredEvent[]): CompanyEventType[] => events.map((e) => e.type);
const firstIndex = (events: StoredEvent[], type: CompanyEventType) =>
  typesOf(events).indexOf(type);
const lastIndex = (events: StoredEvent[], type: CompanyEventType) =>
  typesOf(events).lastIndexOf(type);

const proposalOf = (events: StoredEvent[]): Proposal => {
  const ev = events.find((e) => e.type === "proposal_submitted");
  if (!ev || ev.type !== "proposal_submitted") throw new Error("no proposal was submitted");
  return ev.proposal;
};

describe("runBoard — a complete deliberation", () => {
  const synthesis = proposalJson({
    disagreements: [
      {
        topic: "Whether to cap the spend before launch",
        roleIds: ["cfo", "cto"],
        detail: "Marcus wants a hard cap; Iris wants the budget to follow the traffic.",
      },
    ],
  });

  it("writes one blind position per board role, then the document", async () => {
    const { fetchImpl, calls } = board(() => positionJson(), synthesis);
    const events = await run(fetchImpl);

    // One call per board role plus exactly one synthesis: 3 + 1.
    expect(calls).toHaveLength(4);
    expect(calls.filter(isSynthesis)).toHaveLength(1);
    expect(calls.filter((c) => !isSynthesis(c)).map(addresseeOf).sort()).toEqual([
      "Dana",
      "Iris",
      "Marcus",
    ]);

    expect(typesOf(events)).toEqual([
      "day_started",
      "drafting_started",
      "worklog", // cfo picks up the question
      "worklog", // cto
      "worklog", // coo
      "position_submitted",
      "position_submitted",
      "position_submitted",
      "disagreement_recorded",
      "proposal_submitted",
      "worklog", // the run's spend line
    ]);

    // The ordering that matters: every position is in the log before the
    // document that quotes it, and the disagreement before the document too.
    expect(lastIndex(events, "position_submitted")).toBeLessThan(
      firstIndex(events, "proposal_submitted"),
    );
    expect(lastIndex(events, "disagreement_recorded")).toBeLessThan(
      firstIndex(events, "proposal_submitted"),
    );
    expect(firstIndex(events, "drafting_started")).toBeLessThan(
      firstIndex(events, "position_submitted"),
    );
  });

  it("attributes the draft to a board member and reuses that id everywhere", async () => {
    const { fetchImpl } = board(() => positionJson(), synthesis);
    const events = await run(fetchImpl);

    const drafting = events.find((e) => e.type === "drafting_started");
    if (!drafting || drafting.type !== "drafting_started") throw new Error("no drafting event");

    const proposal = proposalOf(events);
    expect(drafting.proposalId).toBe(proposal.id);
    expect(proposal.authorRoleId).toBe(drafting.authorRoleId);
    // A money question goes to the money mandate.
    expect(proposal.authorRoleId).toBe("cfo");
    expect(proposal.id).toMatch(/^prop-should-we-sponsor-two-indie-[0-9a-f]{6}$/);
  });

  it("folds assumptions into key points rather than dropping them", async () => {
    const { fetchImpl } = board(
      () =>
        positionJson({
          keyPoints: ["Grounded point one.", "Grounded point two."],
          assumptions: ["Assumes a $54 blended CAC.", "listener numbers are self-reported"],
        }),
      synthesis,
    );
    const events = await run(fetchImpl);

    const position = proposalOf(events).positions[0]!;
    expect(position.keyPoints).toEqual([
      "Grounded point one.",
      "Grounded point two.",
      "Assumes: a $54 blended CAC.",
      "Assumes: listener numbers are self-reported",
    ]);
  });

  it("records disagreements as events that name roles which really spoke", async () => {
    const { fetchImpl } = board(() => positionJson(), synthesis);
    const events = await run(fetchImpl);

    const recorded = events.filter((e) => e.type === "disagreement_recorded");
    expect(recorded).toHaveLength(1);
    const [first] = recorded;
    if (!first || first.type !== "disagreement_recorded") throw new Error("unreachable");

    const speakers = proposalOf(events).positions.map((p) => p.roleId);
    for (const id of first.disagreement.roleIds) expect(speakers).toContain(id);
    expect(first.disagreement.roleIds).toEqual(["cfo", "cto"]);
    // The proposal document carries the same disagreement the log recorded.
    expect(proposalOf(events).disagreements).toEqual([first.disagreement]);
  });

  it("drops an invented disagreement that names someone who never spoke", async () => {
    const { fetchImpl } = board(
      () => positionJson(),
      proposalJson({
        disagreements: [
          { topic: "Real", roleIds: ["cfo", "coo"], detail: "Genuine conflict." },
          { topic: "Ghost", roleIds: ["cfo", "legal"], detail: "Nobody named legal exists." },
          { topic: "Solo", roleIds: ["cfo", "cfo"], detail: "One person cannot disagree alone." },
        ],
      }),
    );
    const events = await run(fetchImpl);

    const recorded = events.filter((e) => e.type === "disagreement_recorded");
    expect(recorded).toHaveLength(1);
    expect(proposalOf(events).disagreements.map((d) => d.topic)).toEqual(["Real"]);
  });

  it("lands in the CEO inbox as pending_approval after the fold", async () => {
    const { fetchImpl } = board(() => positionJson(), synthesis);
    const events = await run(fetchImpl);

    const state = await store.getState(COMPANY);
    const proposal = state.proposals[proposalOf(events).id];
    expect(proposal?.status).toBe("pending_approval");
    expect(proposal?.positions).toHaveLength(3);
    expect(proposal?.cost).toEqual({ amount: 2400, note: "Two shows, four weeks, half up front." });
    expect(proposal?.risks).toHaveLength(3);
  });

  it("closes with what the run cost", async () => {
    const { fetchImpl } = board(() => positionJson(), synthesis);
    const events = await run(fetchImpl);

    const last = events[events.length - 1];
    if (!last || last.type !== "worklog") throw new Error("the run did not close with a worklog");
    // 4 calls x (1200 in, 800 out) at $0.20/$1.20 per 1M = $0.0012 each.
    expect(last.note).toBe("Board run complete — 4 calls, $0.0048");
    expect(last.roleId).toBe("cfo");
  });

  it("caps every call and picks a model per role", async () => {
    const { fetchImpl, calls } = board(() => positionJson(), synthesis);
    await run(fetchImpl);

    const positions = calls.filter((c) => !isSynthesis(c));
    for (const call of positions) {
      expect(call.body.max_tokens).toBe(DEFAULT_POSITION_MAX_TOKENS);
      expect(call.body.temperature).toBe(0.7);
    }
    const [synthesisCall] = calls.filter(isSynthesis);
    expect(synthesisCall!.body.max_tokens).toBe(DEFAULT_SYNTHESIS_MAX_TOKENS);
    expect(synthesisCall!.body.temperature).toBe(0.4);

    // Dana's role config names a real OpenRouter id; Iris's says "opus", which
    // is a Phase 0 flavour and not an id, so she falls back to the default.
    const modelFor_ = (name: string) =>
      positions.find((c) => addresseeOf(c) === name)?.body.model;
    expect(modelFor_("Dana")).toBe("anthropic/claude-sonnet-4.5");
    expect(modelFor_("Iris")).toBe("openai/gpt-5.6-luna");
    expect(modelFor_("Marcus")).toBe("openai/gpt-5.6-luna");
  });

  it("honours token caps handed down from the environment", async () => {
    const { fetchImpl, calls } = board(() => positionJson(), synthesis);
    await run(fetchImpl, { positionMaxTokens: 321, synthesisMaxTokens: 654 });

    expect(calls.filter((c) => !isSynthesis(c)).map((c) => c.body.max_tokens)).toEqual([
      321, 321, 321,
    ]);
    expect(calls.filter(isSynthesis)[0]!.body.max_tokens).toBe(654);
  });
});

describe("runBoard — failure is recorded, never thrown", () => {
  it("synthesises from the survivors when one position cannot be salvaged", async () => {
    const { fetchImpl, calls } = board(
      (call) => (addresseeOf(call) === "Iris" ? "I would rather talk this through." : positionJson()),
      proposalJson(),
    );
    const events = await run(fetchImpl);

    // Iris burns her repair attempt and no more: 2 good + 2 (Iris) + 1 synthesis.
    expect(calls).toHaveLength(5);

    const failed = events.filter((e) => e.type === "worklog" && /Position failed/.test(e.note ?? ""));
    expect(failed).toHaveLength(1);
    expect((failed[0] as { roleId?: string }).roleId).toBe("cto");

    const proposal = proposalOf(events);
    expect(proposal.positions.map((p) => p.roleId).sort()).toEqual(["cfo", "coo"]);
  });

  it("refuses to draft a proposal from a single opinion", async () => {
    const { fetchImpl } = board(
      (call) => (addresseeOf(call) === "Marcus" ? positionJson() : "no thanks"),
      proposalJson(),
    );
    const events = await run(fetchImpl);

    expect(typesOf(events)).not.toContain("proposal_submitted");
    const note = events
      .filter((e) => e.type === "worklog")
      .map((e) => (e as { note?: string }).note ?? "")
      .find((n) => n.startsWith("Board run failed"));
    expect(note).toMatch(/only 1 of 3 positions came back/);
    // Even a failed run reports its spend: 1 good + 2x2 wasted = 5 calls.
    expect(note).toMatch(/5 calls, \$0\.0060/);
  });

  it("survives a dead upstream without throwing", async () => {
    const { fetchImpl } = board(() => ({ throws: "ECONNREFUSED" }), "");
    await expect(
      runBoard(COMPANY, QUESTION, { store, apiKey: "k", fetchImpl }),
    ).resolves.toBeUndefined();

    const events = await store.listEvents(COMPANY);
    expect(typesOf(events)).not.toContain("proposal_submitted");
    expect(events.some((e) => e.type === "worklog" && /Position failed/.test(e.note ?? ""))).toBe(
      true,
    );
  });

  it("swallows an unexpected error and still leaves a trace", async () => {
    const broken: EventStore = {
      ...store,
      getCompany: () => Promise.reject(new Error("database is on fire")),
    };
    const notes: string[] = [];
    await expect(
      runBoard(COMPANY, QUESTION, {
        store: broken,
        apiKey: "k",
        log: { warn: (m) => notes.push(m), info: () => {} },
      }),
    ).resolves.toBeUndefined();
    expect(notes.join("\n")).toMatch(/database is on fire/);
  });

  it("stays offline, and says so, without a key", async () => {
    const events = await run(undefined, { apiKey: undefined });
    const worklogs = events.filter((e) => e.type === "worklog");
    expect(worklogs).toHaveLength(1);
    expect((worklogs[0] as { note?: string }).note).toMatch(/Board offline/);
    expect(typesOf(events)).not.toContain("drafting_started");
  });

  it("will not deliberate with fewer than two board roles", async () => {
    await store.createCompany({
      id: "solo",
      config: { ...boardConfig, roles: [roleById("ceo"), roleById("cfo")] },
    });
    const { fetchImpl, calls } = board(() => positionJson(), proposalJson());
    await runBoard("solo", QUESTION, { store, apiKey: "k", fetchImpl });

    expect(calls).toHaveLength(0);
    const events = await store.listEvents("solo");
    expect((events[0] as { note?: string }).note).toMatch(/board role\(s\) configured/);
  });
});

describe("board helpers", () => {
  it("only trusts a role's model when it looks like an OpenRouter id", () => {
    expect(modelFor(roleById("coo"), "x/y")).toBe("anthropic/claude-sonnet-4.5");
    expect(modelFor(roleById("cto"), "x/y")).toBe("x/y"); // "opus" is not an id
    expect(modelFor(roleById("cfo"), undefined)).toBe(DEFAULT_BOARD_MODEL);
    expect(modelFor(roleById("cfo"), "  ")).toBe(DEFAULT_BOARD_MODEL);
  });

  it("sends the question to the mandate that best matches it", () => {
    const roles = boardConfig.roles.filter((r) => r.kind === "board");
    expect(pickDraftingRole(roles, "Should we cut the price to protect margin?").id).toBe("cfo");
    expect(pickDraftingRole(roles, "Should we rewrite the publish pipeline?").id).toBe("cto");
    expect(pickDraftingRole(roles, "Can support absorb the extra load if we hire nobody?").id).toBe(
      "coo",
    );
    // No signal at all: the first board role, not an error.
    expect(pickDraftingRole(roles, "What should we do?").id).toBe("cfo");
  });

  it("resolves disagreement parties by id, name or title, and only if they spoke", () => {
    const spoke = new Set(["cfo", "cto"]);
    expect(resolveRoleIds(["cfo", "Iris"], boardConfig.roles, spoke)).toEqual(["cfo", "cto"]);
    expect(
      resolveRoleIds(["Chief Financial Officer", "cfo"], boardConfig.roles, spoke),
    ).toEqual(["cfo"]); // deduped
    expect(resolveRoleIds(["cfo", "Dana"], boardConfig.roles, spoke)).toEqual(["cfo"]); // silent
    expect(resolveRoleIds(["legal"], boardConfig.roles, spoke)).toEqual([]);
  });

  it("labels an assumption once, however the model phrased it", () => {
    expect(asAssumption("4% churn")).toBe("Assumes: 4% churn");
    expect(asAssumption("Assumes 4% churn")).toBe("Assumes: 4% churn");
    expect(asAssumption("Assumption: 4% churn")).toBe("Assumes: 4% churn");
    expect(asAssumption("Assuming — 4% churn")).toBe("Assumes: 4% churn");
  });

  it("builds a readable, unique proposal id", () => {
    const id = makeProposalId("Should we sponsor two indie-author podcasts?");
    expect(id).toMatch(/^prop-should-we-sponsor-two-indie-[0-9a-f]{6}$/);
    expect(makeProposalId("???")).toMatch(/^prop-question-[0-9a-f]{6}$/);
    expect(makeProposalId("same")).not.toBe(makeProposalId("same"));
  });
});
