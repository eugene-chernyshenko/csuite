/**
 * The revision loop: the CEO returns a proposal with questions, and the board
 * answers them with a new document.
 *
 * What is asserted here is the shape of a *second round*: it starts only when
 * the CEO actually asked something, every member answers the questions from
 * their own domain with the submitted document in front of them (company
 * record — it is the one place stage 1 may see a colleague's words), nobody
 * sees anybody's revised position, and the result lands in the CEO inbox as a
 * pending document that says which one it revises.
 *
 * Same rules as every other board test: no network, no key, no spend.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { CompanyEventType, Proposal } from "@csuite/contract";
import { buildApp } from "../src/app";
import {
  findOriginalQuestion,
  nextRevisionId,
  rootProposalId,
  runBoardRevision,
  type BoardDeps,
} from "../src/board/run";
import { buildRevisionPositionMessages, companyProfile } from "../src/board/prompts";
import { memoryEventStore } from "../src/store/memory";
import type { EventStore, StoredEvent } from "../src/store/types";
import { boardConfig, roleById } from "./board-fixtures";
import {
  addresseeOf,
  fakeOpenRouter,
  isSynthesis,
  positionJson,
  proposalJson,
  systemOf,
  userOf,
  type FakeReply,
  type RecordedCall,
} from "./openrouter-fake";
import type { ContextRegistry, ContextToolDef } from "../src/context/types";

const COMPANY = "brightpage";
const QUESTION = "Should we sponsor two indie-author podcasts for four weeks?";
const ORIGINAL_ID = "prop-should-we-sponsor-two-indie-ab12ef";
const NOTE =
  "Two questions before I sign this: what happens to the payback if only one show converts, " +
  "and who runs the creative if Growth is already at capacity?";

let store: EventStore;

beforeEach(async () => {
  store = memoryEventStore();
  await store.createCompany({ id: COMPANY, config: boardConfig });
  await store.appendEvents(COMPANY, [{ type: "day_started" }]);
});

// ------------------------------------------------------------------ fixtures

function originalProposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: ORIGINAL_ID,
    title: "Run a four-week sponsorship test on two indie-author podcasts",
    authorRoleId: "cfo",
    summary: "Spend a capped $2,400 to find out whether the channel converts.",
    rationale: "The first-round argument, in full.\n\nAnd its second paragraph.",
    alternatives: ["Do nothing for a quarter.", "Put the money into paid search instead."],
    cost: { amount: 2400, note: "Two shows, four weeks, half up front." },
    risks: ["Attribution is soft.", "Two shows is not a sample."],
    positions: [
      {
        roleId: "cfo",
        stance: "support_with_conditions",
        summary: "Marcus: worth doing if we cap the spend at $2,400.",
        keyPoints: ["Payback inside one quarter or we stop.", "Assumes: a $54 blended CAC."],
      },
      {
        roleId: "cto",
        stance: "support",
        summary: "Iris: nothing here touches the publish pipeline.",
        keyPoints: ["No engineering work is implied.", "Tracking links are already in place."],
      },
      {
        roleId: "coo",
        stance: "object",
        summary: "Dana: Growth has no capacity for the creative.",
        keyPoints: ["Two shows means eight scripts.", "The queue is already two weeks deep."],
      },
    ],
    disagreements: [
      {
        topic: "Whether Growth can absorb the creative work",
        roleIds: ["cfo", "coo"],
        detail: "Marcus prices it as near-zero; Dana says it is eight scripts nobody has.",
      },
    ],
    status: "pending_approval",
    ...over,
  };
}

/** A submitted proposal the CEO has returned — with questions unless told otherwise. */
async function seedReturned(
  opts: { proposal?: Proposal; note?: string | undefined; askQuestion?: boolean } = {},
): Promise<Proposal> {
  const proposal = opts.proposal ?? originalProposal();
  const note = "note" in opts ? opts.note : NOTE;
  if (opts.askQuestion !== false) {
    await store.appendEvents(COMPANY, [
      { type: "question_asked", text: QUESTION, byRoleId: "ceo" },
      {
        type: "drafting_started",
        proposalId: rootProposalId(proposal.id),
        authorRoleId: "cfo",
        title: "provisional",
      },
    ]);
  }
  await store.appendEvents(COMPANY, [{ type: "proposal_submitted", proposal }]);
  await store.appendEvents(COMPANY, [
    {
      type: "ceo_decision",
      proposalId: proposal.id,
      decision: "returned",
      ...(note === undefined ? {} : { note }),
    },
  ]);
  return proposal;
}

/** Answers every revised-position call one way, the single synthesis call another. */
function board(
  position: (call: RecordedCall) => string | FakeReply,
  synthesis: string | FakeReply = proposalJson(),
) {
  return fakeOpenRouter((call) => (isSynthesis(call) ? synthesis : position(call)));
}

async function revise(
  fetchImpl: BoardDeps["fetchImpl"],
  proposalId = ORIGINAL_ID,
  over: Partial<BoardDeps> = {},
) {
  await runBoardRevision(COMPANY, proposalId, {
    store,
    apiKey: "test-key",
    model: "openai/gpt-5.6-luna",
    fetchImpl,
    ...over,
  });
  return store.listEvents(COMPANY);
}

const typesOf = (events: StoredEvent[]): CompanyEventType[] => events.map((e) => e.type);
const notesOf = (events: StoredEvent[]): string[] =>
  events.flatMap((e) => (e.type === "worklog" ? [e.note ?? ""] : []));
const submitted = (events: StoredEvent[]): Proposal[] =>
  events.flatMap((e) => (e.type === "proposal_submitted" ? [e.proposal] : []));
const closingNote = (events: StoredEvent[]): string => {
  const last = events[events.length - 1];
  if (!last || last.type !== "worklog") throw new Error("the run did not close with a worklog");
  return last.note ?? "";
};
const positionCalls = (calls: RecordedCall[]) => calls.filter((c) => !isSynthesis(c));
const callFor = (calls: RecordedCall[], who: string) =>
  positionCalls(calls).find((c) => addresseeOf(c) === who)!;

// -------------------------------------------------------------- the new round

describe("runBoardRevision — a complete second round", () => {
  it("answers the questions with a pending -r2 document that says what it revises", async () => {
    await seedReturned();
    const before = (await store.listEvents(COMPANY)).length;

    const { fetchImpl, calls } = board(() => positionJson());
    const events = await revise(fetchImpl);

    // Same N+1 shape as a first round: one call per board role, one synthesis.
    expect(calls).toHaveLength(4);
    expect(calls.filter(isSynthesis)).toHaveLength(1);

    expect(typesOf(events.slice(before))).toEqual([
      "drafting_started",
      "worklog", // cfo takes the questions up
      "worklog", // cto
      "worklog", // coo
      "position_submitted",
      "position_submitted",
      "position_submitted",
      "proposal_submitted",
      "worklog", // the run's spend line
    ]);

    const revised = submitted(events).find((p) => p.id !== ORIGINAL_ID)!;
    expect(revised.id).toBe(`${ORIGINAL_ID}-r2`);
    expect(revised.revises).toBe(ORIGINAL_ID);
    expect(revised.positions).toHaveLength(3);
    // The byline stays with the member who signed the document being revised.
    expect(revised.authorRoleId).toBe("cfo");

    const draftingR2 = events.find(
      (e) => e.type === "drafting_started" && e.proposalId === `${ORIGINAL_ID}-r2`,
    );
    if (!draftingR2 || draftingR2.type !== "drafting_started") throw new Error("no drafting event");
    expect(draftingR2.authorRoleId).toBe("cfo");
    expect(draftingR2.title).toContain("Revision");
  });

  it("lands in the CEO inbox as pending_approval, `revises` intact through the reducer", async () => {
    await seedReturned();
    const { fetchImpl } = board(() => positionJson());
    await revise(fetchImpl);

    const state = await store.getState(COMPANY);
    const revised = state.proposals[`${ORIGINAL_ID}-r2`];
    expect(revised?.status).toBe("pending_approval");
    // The reducer needed no teaching: an additive field rides through the fold.
    expect(revised?.revises).toBe(ORIGINAL_ID);
    // ...and the returned original is left exactly as the CEO left it.
    expect(state.proposals[ORIGINAL_ID]?.status).toBe("returned");
    expect(state.proposals[ORIGINAL_ID]?.ceoNote).toBe(NOTE);
  });

  it("records the board's disagreements in the new round too", async () => {
    await seedReturned();
    const { fetchImpl } = board(
      () => positionJson(),
      proposalJson({
        disagreements: [
          {
            topic: "Whether one converting show is enough",
            roleIds: ["cfo", "coo"],
            detail: "Marcus would keep going; Dana would stop.",
          },
          { topic: "Ghost", roleIds: ["cfo", "legal"], detail: "Nobody named legal exists." },
        ],
      }),
    );
    const events = await revise(fetchImpl);

    const recorded = events.filter((e) => e.type === "disagreement_recorded");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ proposalId: `${ORIGINAL_ID}-r2` });
    expect(submitted(events).at(-1)!.disagreements.map((d) => d.topic)).toEqual([
      "Whether one converting show is enough",
    ]);
  });

  it("closes with a spend line that says it was a revision", async () => {
    await seedReturned();
    const { fetchImpl } = board(() => positionJson());
    const events = await revise(fetchImpl);

    // 4 calls x (1200 in, 800 out) at $0.20/$1.20 per 1M = $0.0012 each.
    expect(closingNote(events)).toBe("Board revision complete — 4 calls, $0.0048");
  });

  it("revises a revision: -r2 returned again becomes -r3", async () => {
    await seedReturned();
    const first = board(() => positionJson());
    await revise(first.fetchImpl);

    // The CEO returns the revision, with new questions.
    await store.appendEvents(COMPANY, [
      {
        type: "ceo_decision",
        proposalId: `${ORIGINAL_ID}-r2`,
        decision: "returned",
        note: "Still not convinced by the payback maths — show me the downside case.",
      },
    ]);

    const second = board(() => positionJson());
    const events = await revise(second.fetchImpl, `${ORIGINAL_ID}-r2`);

    const third = submitted(events).at(-1)!;
    expect(third.id).toBe(`${ORIGINAL_ID}-r3`);
    expect(third.revises).toBe(`${ORIGINAL_ID}-r2`);

    const state = await store.getState(COMPANY);
    expect(Object.keys(state.proposals).sort()).toEqual([
      ORIGINAL_ID,
      `${ORIGINAL_ID}-r2`,
      `${ORIGINAL_ID}-r3`,
    ]);
    expect(state.proposals[`${ORIGINAL_ID}-r3`]?.status).toBe("pending_approval");

    // The round that just closed is the one being answered — not the first one.
    const secondRoundPrompt = userOf(callFor(second.calls, "Marcus"));
    expect(secondRoundPrompt).toContain("show me the downside case");
  });
});

// ------------------------------------------------------------ what starts it

describe("runBoardRevision — only a real question starts a round", () => {
  const noCalls = async (proposalId = ORIGINAL_ID) => {
    const { fetchImpl, calls } = board(() => positionJson());
    const before = (await store.listEvents(COMPANY)).length;
    const events = await revise(fetchImpl, proposalId);
    expect(calls).toHaveLength(0);
    expect(events).toHaveLength(before);
  };

  it("does nothing for a return with an empty note", async () => {
    await seedReturned({ note: "   " });
    await noCalls();
  });

  it("does nothing for a legacy return with no note at all", async () => {
    await seedReturned({ note: undefined });
    await noCalls();
  });

  it("does nothing for a proposal that was not returned", async () => {
    await store.appendEvents(COMPANY, [
      { type: "proposal_submitted", proposal: originalProposal() },
    ]);
    await noCalls();
  });

  it("does nothing for a proposal that does not exist", async () => {
    await noCalls("prop-ghost");
  });
});

// ---------------------------------------------------------------- the prompts

describe("the revision position prompt", () => {
  it("carries the CEO's note, the document verbatim, and marks the role's own position", async () => {
    await seedReturned();
    const { fetchImpl, calls } = board(() => positionJson());
    await revise(fetchImpl);

    const marcus = callFor(calls, "Marcus");
    const prompt = `${systemOf(marcus)}\n${userOf(marcus)}`;

    // The CEO's questions, whole.
    expect(prompt).toContain(NOTE);
    // The returned document, as submitted.
    const original = originalProposal();
    expect(prompt).toContain(original.title);
    expect(prompt).toContain(original.summary);
    expect(prompt).toContain(original.rationale);
    expect(prompt).toContain(original.cost.note);
    for (const position of original.positions) {
      expect(prompt).toContain(position.summary);
      for (const point of position.keyPoints) expect(prompt).toContain(point);
    }
    expect(prompt).toContain(original.disagreements[0]!.detail);
    // The question the round began with, recovered from the log.
    expect(prompt).toContain(QUESTION);

    // Marcus's own prior position is marked as his, and nobody else's is.
    expect(prompt).toMatch(/roleId: cfo[^\n]*YOUR OWN POSITION/);
    expect(prompt).not.toMatch(/roleId: cto[^\n]*YOUR OWN POSITION/);
    expect(prompt).toMatch(/roleId: coo — Dana, Chief Operating Officer\n/);

    // Dana's prompt marks hers instead.
    const dana = `${systemOf(callFor(calls, "Dana"))}\n${userOf(callFor(calls, "Dana"))}`;
    expect(dana).toMatch(/roleId: coo[^\n]*YOUR OWN POSITION/);
    expect(dana).not.toMatch(/roleId: cfo[^\n]*YOUR OWN POSITION/);
  });

  it("instructs the member to answer, to change their mind, and to keep what stands", () => {
    const prompt = buildRevisionPositionMessages({
      profile: companyProfile(boardConfig),
      role: roleById("cfo"),
      question: QUESTION,
      original: originalProposal(),
      note: NOTE,
      roles: boardConfig.roles,
    })
      .map((m) => m.content)
      .join("\n");

    expect(prompt).toContain("THIS IS A REVISION ROUND");
    expect(prompt).toMatch(/Answer the CEO's questions that touch your domain DIRECTLY/);
    expect(prompt).toMatch(/change your stance and say plainly what changed it/);
    expect(prompt).toMatch(/defending a position for pride is not/);
    expect(prompt).toMatch(/What still stands, still stands/);
    // Blindness for the round in progress, sight of the round that closed.
    expect(prompt).toMatch(/blind AGAIN for this round/);
    expect(prompt).toMatch(/not what any of them is writing now/);
    // Same output contract, same grounding discipline as a first position.
    expect(prompt).toContain('"stance"');
    expect(prompt).toContain('"assumptions"');
    expect(prompt).toMatch(/not grounded/i);
    // ...and the language rule, pointed at the note.
    expect(prompt).toMatch(/in the language the CEO's questions are written in/);
  });

  it("still works for a member who had no position in the returned round", () => {
    const original = originalProposal({
      positions: originalProposal().positions.filter((p) => p.roleId !== "cto"),
    });
    const prompt = buildRevisionPositionMessages({
      profile: companyProfile(boardConfig),
      role: roleById("cto"),
      question: QUESTION,
      original,
      note: NOTE,
      roles: boardConfig.roles,
    })
      .map((m) => m.content)
      .join("\n");

    expect(prompt).toContain("You did not have a position in that round");
    expect(prompt).not.toContain("YOUR OWN POSITION");
  });
});

describe("the revision synthesis prompt", () => {
  it("demands the rationale open with the answers, and carries both rounds", async () => {
    await seedReturned();
    const { fetchImpl, calls } = board(() => positionJson());
    await revise(fetchImpl);

    const synthesis = calls.find(isSynthesis)!;
    const prompt = `${systemOf(synthesis)}\n${userOf(synthesis)}`;

    expect(prompt).toContain("REVISED proposal document for the CEO");
    expect(prompt).toMatch(/OPEN THE RATIONALE BY ANSWERING THE CEO'S QUESTIONS/);
    expect(prompt).toMatch(/Say what CHANGED from the returned document/);
    expect(prompt).toContain(NOTE);
    expect(prompt).toContain(originalProposal().rationale);
    expect(prompt).toContain("REVISED POSITIONS (written independently, blind to each other)");
    // Disagreement rules unchanged.
    expect(prompt).toContain("valid ids: cfo, cto, coo");
    expect(prompt).toContain("Inventing a disagreement is worse than reporting none");
    // Language follows the CEO's questions.
    expect(prompt).toMatch(/in the language of the CEO's questions/);
  });
});

// ------------------------------------------------------ caps and degradation

describe("runBoardRevision — the same caps and the same degradation", () => {
  it("synthesises from the survivors, and refuses to revise from one opinion", async () => {
    await seedReturned();
    const { fetchImpl, calls } = board((call) =>
      addresseeOf(call) === "Marcus" ? positionJson() : "I would rather talk this through.",
    );
    const events = await revise(fetchImpl);

    // Two failures burn one repair attempt each, and no more.
    expect(positionCalls(calls)).toHaveLength(5);
    expect(submitted(events).map((p) => p.id)).toEqual([ORIGINAL_ID]);
    const failure = notesOf(events).find((n) => n.startsWith("Board revision failed"));
    expect(failure).toMatch(/only 1 of 3 positions came back/);
    expect(failure).toMatch(/5 calls, \$0\.0060/);
  });

  it("honours the token caps and offers the context tools in the new round", async () => {
    await seedReturned();
    const search: ContextToolDef = {
      name: "library_search",
      description: "Search the company library.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      run: async () => "unused",
    };
    const registry: ContextRegistry = {
      toolsFor: () => [search],
      run: async () => "doc-fin-aug — August finance summary",
    };
    const { fetchImpl, calls } = board((call) =>
      addresseeOf(call) === "Marcus" && !call.body.messages.some((m) => m.role === "tool")
        ? { toolCalls: [{ name: "library_search", arguments: '{"query":"payback"}' }] }
        : positionJson(),
    );

    const events = await revise(fetchImpl, ORIGINAL_ID, {
      context: registry,
      positionMaxTokens: 321,
      synthesisMaxTokens: 654,
    });

    for (const call of positionCalls(calls)) {
      expect(call.body.max_tokens).toBe(321);
      expect(call.body.tools?.map((t) => t.function.name)).toEqual(["library_search"]);
    }
    const synthesis = calls.find(isSynthesis)!;
    expect(synthesis.body.max_tokens).toBe(654);
    expect(synthesis.body.tools).toBeUndefined();

    expect(events.filter((e) => e.type === "context_consulted")).toHaveLength(1);
    expect(closingNote(events)).toBe(
      "Board revision complete — 5 calls (3 with tools, 1 tool consultation), $0.0060",
    );
  });

  it("records a crash instead of throwing", async () => {
    const broken: EventStore = {
      ...store,
      getState: () => Promise.reject(new Error("database is on fire")),
    };
    const notes: string[] = [];
    await expect(
      runBoardRevision(COMPANY, ORIGINAL_ID, {
        store: broken,
        apiKey: "k",
        log: { warn: (m) => notes.push(m), info: () => {} },
      }),
    ).resolves.toBeUndefined();

    expect(notes.join("\n")).toMatch(/database is on fire/);
    expect(notesOf(await store.listEvents(COMPANY))).toContainEqual(
      expect.stringContaining("Board revision failed: database is on fire"),
    );
  });

  it("says the board is offline instead of pretending to revise", async () => {
    await seedReturned();
    const events = await revise(undefined, ORIGINAL_ID, { apiKey: undefined });

    expect(
      events.some((e) => e.type === "drafting_started" && e.proposalId.endsWith("-r2")),
    ).toBe(false);
    expect(notesOf(events).at(-1)).toMatch(/Board offline .*questions on/);
  });
});

// ----------------------------------------------------- recovering the subject

describe("what the board is told it was asked", () => {
  it("falls back to the document's summary when no question was ever asked", async () => {
    const proposal = originalProposal();
    await seedReturned({ askQuestion: false });
    const { fetchImpl, calls } = board(() => positionJson());
    await revise(fetchImpl);

    const prompt = userOf(callFor(calls, "Marcus"));
    expect(prompt).not.toContain(QUESTION);
    expect(prompt).toContain(proposal.summary);
  });

  it("finds the question that opened the thread, and only that one", () => {
    const events = [
      { id: "1", ts: 1, type: "question_asked" as const, text: "an older, unrelated question", byRoleId: "ceo" },
      { id: "2", ts: 2, type: "drafting_started" as const, proposalId: "prop-other", authorRoleId: "cfo", title: "x" },
      { id: "3", ts: 3, type: "question_asked" as const, text: QUESTION, byRoleId: "ceo" },
      { id: "4", ts: 4, type: "drafting_started" as const, proposalId: ORIGINAL_ID, authorRoleId: "cfo", title: "x" },
    ];
    expect(findOriginalQuestion(events, ORIGINAL_ID)).toBe(QUESTION);
    expect(findOriginalQuestion(events, "prop-other")).toBe("an older, unrelated question");
    expect(findOriginalQuestion(events, "prop-missing")).toBeUndefined();
    expect(findOriginalQuestion([], ORIGINAL_ID)).toBeUndefined();
  });

  it("derives revision ids off the base, however deep the thread", () => {
    expect(rootProposalId("prop-x-ab12ef")).toBe("prop-x-ab12ef");
    expect(rootProposalId("prop-x-ab12ef-r2")).toBe("prop-x-ab12ef");
    expect(rootProposalId("prop-x-ab12ef-r10")).toBe("prop-x-ab12ef");

    expect(nextRevisionId("prop-x-ab12ef", ["prop-x-ab12ef"])).toBe("prop-x-ab12ef-r2");
    expect(nextRevisionId("prop-x-ab12ef-r2", ["prop-x-ab12ef", "prop-x-ab12ef-r2"])).toBe(
      "prop-x-ab12ef-r3",
    );
    // Counted off the log, not off the document in hand: revising -r2 when -r3
    // already exists still produces a fresh id rather than a collision.
    expect(
      nextRevisionId("prop-x-ab12ef-r2", ["prop-x-ab12ef", "prop-x-ab12ef-r2", "prop-x-ab12ef-r3"]),
    ).toBe("prop-x-ab12ef-r4");
    // Another thread's ids are not this thread's.
    expect(nextRevisionId("prop-x-ab12ef", ["prop-y-cd34-r7"])).toBe("prop-x-ab12ef-r2");
  });
});

// ------------------------------------------------------------ the HTTP trigger

describe("POST .../decision — a returned proposal with questions wakes the board", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // No OpenRouter key: the revision run reaches the offline guard and says so
    // in the log, which is exactly the evidence that it was started at all.
    app = await buildApp({ store });
    await app.ready();
  });

  const decide = async (payload: Record<string, unknown>, proposalId = "p2") =>
    app.inject({
      method: "POST",
      url: `/api/companies/${COMPANY}/proposals/${proposalId}/decision`,
      payload,
    });

  /** A second, still-pending proposal to decide on in each case. */
  const pending = async (id = "p2") => {
    await store.appendEvents(COMPANY, [
      { type: "proposal_submitted", proposal: originalProposal({ id }) },
    ]);
  };

  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it("starts a revision run when the return carries a note", async () => {
    await pending();
    const res = await decide({ decision: "returned", note: NOTE });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).proposal.status).toBe("returned");

    await settle();
    expect(notesOf(await store.listEvents(COMPANY)).at(-1)).toMatch(
      /Board offline .*questions on/,
    );
  });

  it("starts nothing when the return carries no questions", async () => {
    await pending();
    expect((await decide({ decision: "returned" })).statusCode).toBe(201);
    await settle();
    expect(notesOf(await store.listEvents(COMPANY))).toHaveLength(0);

    await pending("p3");
    expect((await decide({ decision: "returned", note: "  " }, "p3")).statusCode).toBe(201);
    await settle();
    expect(notesOf(await store.listEvents(COMPANY))).toHaveLength(0);
  });

  it("starts nothing when the proposal is approved or rejected, note or not", async () => {
    await pending();
    expect((await decide({ decision: "approved", note: "Ship it" })).statusCode).toBe(201);
    await pending("p3");
    expect((await decide({ decision: "rejected", note: "No" }, "p3")).statusCode).toBe(201);

    await settle();
    expect(notesOf(await store.listEvents(COMPANY))).toHaveLength(0);
  });
});
