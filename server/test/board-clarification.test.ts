/**
 * The Chief of Staff: clarification triage, and authorship of the document.
 *
 * Two things are being asserted, and the second matters as much as the first:
 *
 *  - **With a `staff` role**, a question is triaged before the board sees it.
 *    Triage either waves it through or stops the run dead — `clarification_
 *    requested` and nothing else, no positions, no document — until the CEO
 *    answers, at which point the run resumes with the CEO's own words carried
 *    into every prompt. The Chief of Staff also signs the document it wrote.
 *  - **Without one**, nothing happens at all: no triage call, no behaviour
 *    change, a board member still signs. That regression is the point of the
 *    design, so it is tested explicitly rather than assumed.
 *
 * Same rules as every other board test: no network, no key, no spend.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { CompanyEventType, Proposal } from "@csuite/contract";
import { buildApp } from "../src/app";
import { runBoard, runBoardRevision, type BoardDeps } from "../src/board/run";
import { MAX_CLARIFYING_QUESTIONS, TRIAGE_MAX_TOKENS } from "../src/board/prompts";
import { memoryEventStore } from "../src/store/memory";
import type { EventStore, StoredEvent } from "../src/store/types";
import { boardConfig, staffConfig } from "./board-fixtures";
import {
  addresseeOf,
  fakeOpenRouter,
  isSynthesis,
  isTriage,
  positionJson,
  proposalJson,
  systemOf,
  triageJson,
  userOf,
  type FakeReply,
  type RecordedCall,
} from "./openrouter-fake";

const COMPANY = "brightpage";
const QUESTION = "Should we sponsor two indie-author podcasts for four weeks?";

const QUESTIONS = [
  "What outcome would make this test a success for you — signups, or learning whether the audience is ours at all?",
  "Is there a ceiling on the spend you are not willing to cross?",
];
const ANSWERS =
  "Learning, not signups — I want to know whether these listeners are our people. " +
  "Hard ceiling $3,000, and nothing recurring.";

let store: EventStore;

beforeEach(async () => {
  store = memoryEventStore();
  await store.createCompany({ id: COMPANY, config: staffConfig });
  await store.appendEvents(COMPANY, [{ type: "day_started" }]);
});

/** Answers the triage call, every position call, and the one synthesis call. */
function run3(
  triage: string | FakeReply,
  position: (call: RecordedCall) => string | FakeReply = () => positionJson(),
  synthesis: string | FakeReply = proposalJson(),
) {
  return fakeOpenRouter((call) =>
    isTriage(call) ? triage : isSynthesis(call) ? synthesis : position(call),
  );
}

async function run(
  fetchImpl: BoardDeps["fetchImpl"],
  options: Parameters<typeof runBoard>[3] = {},
  over: Partial<BoardDeps> = {},
) {
  await runBoard(
    COMPANY,
    QUESTION,
    { store, apiKey: "test-key", model: "openai/gpt-5.6-luna", fetchImpl, ...over },
    options,
  );
  return store.listEvents(COMPANY);
}

const typesOf = (events: StoredEvent[]): CompanyEventType[] => events.map((e) => e.type);
const notesOf = (events: StoredEvent[]): string[] =>
  events.filter((e) => e.type === "worklog").map((e) => (e as { note?: string }).note ?? "");

const proposalOf = (events: StoredEvent[]): Proposal => {
  const ev = events.find((e) => e.type === "proposal_submitted");
  if (!ev || ev.type !== "proposal_submitted") throw new Error("no proposal was submitted");
  return ev.proposal;
};

const clarificationOf = (events: StoredEvent[]) => {
  const ev = events.find((e) => e.type === "clarification_requested");
  if (!ev || ev.type !== "clarification_requested") throw new Error("no clarification requested");
  return ev;
};

// --------------------------------------------------------------- triage: yes

describe("triage — proceed", () => {
  it("sends the question straight to the board", async () => {
    const { fetchImpl, calls } = run3(triageJson());
    const events = await run(fetchImpl);

    // One triage + one position per board role + one synthesis: 1 + 3 + 1.
    expect(calls).toHaveLength(5);
    expect(calls.filter(isTriage)).toHaveLength(1);
    // Triage goes first, before a single position is written.
    expect(isTriage(calls[0]!)).toBe(true);

    expect(typesOf(events)).not.toContain("clarification_requested");
    expect(typesOf(events).filter((t) => t === "position_submitted")).toHaveLength(3);
    expect(proposalOf(events).positions).toHaveLength(3);
  });

  it("keeps triage cheap: one small call at a low temperature", async () => {
    const { fetchImpl, calls } = run3(triageJson());
    await run(fetchImpl);

    const triage = calls.find(isTriage)!;
    expect(triage.body.max_tokens).toBe(TRIAGE_MAX_TOKENS);
    expect(triage.body.max_tokens).toBe(500);
    expect(triage.body.temperature).toBe(0.2);
    // No role model on the Chief of Staff, so the run's default model applies.
    expect(triage.body.model).toBe("openai/gpt-5.6-luna");
  });

  it("proceeds when the verdict holds the question but names nothing to ask", async () => {
    const { fetchImpl, calls } = run3(triageJson({ proceed: false, questions: [] }));
    const events = await run(fetchImpl);

    expect(typesOf(events)).not.toContain("clarification_requested");
    expect(calls).toHaveLength(5);
    expect(typesOf(events)).toContain("proposal_submitted");
  });
});

// ---------------------------------------------------------------- triage: no

describe("triage — ask the CEO first", () => {
  const held = triageJson({ proceed: false, questions: QUESTIONS });

  it("stops the run and asks, without writing a single position", async () => {
    const { fetchImpl, calls } = run3(held);
    const events = await run(fetchImpl);

    // The whole run cost exactly one call.
    expect(calls).toHaveLength(1);
    expect(typesOf(events)).toEqual(["day_started", "clarification_requested", "worklog"]);

    const requested = clarificationOf(events);
    expect(requested.questions).toEqual(QUESTIONS);
    expect(requested.questionText).toBe(QUESTION);
    expect(requested.byRoleId).toBe("ceo");

    expect(notesOf(events)[0]).toMatch(/^Waiting for the CEO's clarification — 2 question\(s\)/);
    // Even a run that stopped reports what it spent.
    expect(notesOf(events)[0]).toMatch(/1 call, \$0\.0012/);
  });

  it("parks it in state as an open clarification", async () => {
    const { fetchImpl } = run3(held);
    const events = await run(fetchImpl);

    const state = await store.getState(COMPANY);
    const parked = state.clarifications[clarificationOf(events).id];
    expect(parked).toMatchObject({
      questionText: QUESTION,
      byRoleId: "ceo",
      questions: QUESTIONS,
      status: "open",
    });
    expect(parked?.answers).toBeUndefined();
  });

  it("attributes the hold to the Chief of Staff, not to the board", async () => {
    const { fetchImpl } = run3(held);
    const events = await run(fetchImpl);

    const worklog = events.find((e) => e.type === "worklog");
    expect((worklog as { roleId?: string }).roleId).toBe("cos");
  });

  it("never asks more than three questions, however many it wrote", async () => {
    const { fetchImpl } = run3(
      triageJson({
        proceed: false,
        questions: ["One?", "Two?", "Three?", "Four?", "Five?"],
      }),
    );
    const events = await run(fetchImpl);

    expect(MAX_CLARIFYING_QUESTIONS).toBe(3);
    expect(clarificationOf(events).questions).toEqual(["One?", "Two?", "Three?"]);
  });

  it("points the clarification back at the question event it triaged", async () => {
    const [asked] = await store.appendEvents(COMPANY, [
      { type: "question_asked", text: QUESTION, byRoleId: "ceo" },
    ]);
    const { fetchImpl } = run3(held);
    const events = await run(fetchImpl, { questionEventId: asked!.id });

    expect(clarificationOf(events).questionEventId).toBe(asked!.id);
  });

  it("recovers the question event from the log when the caller did not name it", async () => {
    const [asked] = await store.appendEvents(COMPANY, [
      { type: "question_asked", text: QUESTION, byRoleId: "ceo" },
    ]);
    const { fetchImpl } = run3(held);
    const events = await run(fetchImpl);

    expect(clarificationOf(events).questionEventId).toBe(asked!.id);
  });
});

// -------------------------------------------------------------- triage: broken

describe("triage — a broken gate never blocks the board", () => {
  it("proceeds, and says so, when the triage call falls over", async () => {
    const { fetchImpl, calls } = run3({ throws: "ECONNREFUSED" });
    const events = await run(fetchImpl);

    // The deliberation happened anyway: 1 dead triage + 3 positions + synthesis.
    expect(calls).toHaveLength(5);
    expect(typesOf(events)).not.toContain("clarification_requested");
    expect(typesOf(events)).toContain("proposal_submitted");

    const warned = notesOf(events).find((n) => n.startsWith("Clarification triage failed"));
    expect(warned).toMatch(/ECONNREFUSED/);
    expect(warned).toMatch(/went to the board unchecked/);
  });

  it("proceeds when triage answers unusable JSON twice", async () => {
    const { fetchImpl, calls } = run3("I would rather think about it.");
    const events = await run(fetchImpl);

    // Triage burns its one repair attempt and no more: 2 + 3 + 1.
    expect(calls).toHaveLength(6);
    expect(typesOf(events)).toContain("proposal_submitted");
    expect(notesOf(events).some((n) => n.startsWith("Clarification triage failed"))).toBe(true);
  });
});

// ------------------------------------------------------------------- resume

describe("resuming after the CEO answers", () => {
  it("skips triage and puts the CEO's answers in every position prompt", async () => {
    const { fetchImpl, calls } = run3("triage should never be called here");
    await run(fetchImpl, { clarification: { questions: QUESTIONS, answers: ANSWERS } });

    expect(calls.filter(isTriage)).toHaveLength(0);
    expect(calls).toHaveLength(4);

    for (const call of calls.filter((c) => !isSynthesis(c))) {
      const user = userOf(call);
      expect(user).toContain("CLARIFICATIONS FROM THE CEO");
      expect(user).toContain("the highest authority here");
      expect(user).toContain(`1. ${QUESTIONS[0]}`);
      expect(user).toContain(`2. ${QUESTIONS[1]}`);
      expect(user).toContain(ANSWERS);
      // And the original question is still the question.
      expect(user).toContain(QUESTION);
    }
  });

  it("puts them in the synthesis prompt too", async () => {
    const { fetchImpl, calls } = run3("unused");
    await run(fetchImpl, { clarification: { questions: QUESTIONS, answers: ANSWERS } });

    const user = userOf(calls.find(isSynthesis)!);
    expect(user).toContain("CLARIFICATIONS FROM THE CEO");
    expect(user).toContain(ANSWERS);
  });

  it("says nothing about clarifications when there was no clarification round", async () => {
    const { fetchImpl, calls } = run3(triageJson());
    await run(fetchImpl);

    for (const call of calls.filter((c) => !isTriage(c))) {
      expect(userOf(call)).not.toContain("CLARIFICATIONS FROM THE CEO");
    }
  });
});

// -------------------------------------------------------------- authorship

describe("authorship", () => {
  it("gives the document to the Chief of Staff, who argued nothing", async () => {
    const { fetchImpl, calls } = run3(triageJson());
    const events = await run(fetchImpl);

    const drafting = events.find((e) => e.type === "drafting_started");
    expect((drafting as { authorRoleId?: string }).authorRoleId).toBe("cos");
    expect(proposalOf(events).authorRoleId).toBe("cos");

    // The board still writes every position; the Chief of Staff writes none.
    expect(proposalOf(events).positions.map((p) => p.roleId).sort()).toEqual([
      "cfo",
      "coo",
      "cto",
    ]);
    expect(calls.filter((c) => !isTriage(c) && !isSynthesis(c)).map(addresseeOf).sort()).toEqual([
      "Dana",
      "Iris",
      "Marcus",
    ]);
  });

  it("makes synthesis speak in the Chief of Staff's voice", async () => {
    const { fetchImpl, calls } = run3(triageJson());
    await run(fetchImpl);

    const system = systemOf(calls.find(isSynthesis)!);
    expect(system).toContain("You are Alex, Chief of Staff at Brightpage");
    expect(system).toContain("You do not sit on the board");
    expect(system).toContain("do not declare a winner");
    expect(system).toContain("Resolving one is the CEO's");
  });

  it("closes the run under the Chief of Staff's name", async () => {
    const { fetchImpl } = run3(triageJson());
    const events = await run(fetchImpl);

    const last = events[events.length - 1];
    if (!last || last.type !== "worklog") throw new Error("the run did not close with a worklog");
    expect(last.roleId).toBe("cos");
    // 5 calls x (1200 in, 800 out) at $0.20/$1.20 per 1M — triage included.
    expect(last.note).toBe("Board run complete — 5 calls, $0.0060");
  });
});

// ------------------------------------------------------------- no staff role

describe("a company with no staff role is untouched", () => {
  const NO_STAFF = "plainco";

  beforeEach(async () => {
    await store.createCompany({ id: NO_STAFF, config: boardConfig });
    await store.appendEvents(NO_STAFF, [{ type: "day_started" }]);
  });

  it("never triages, and a board member still signs", async () => {
    const { fetchImpl, calls } = run3("triage should never be called here");
    await runBoard(NO_STAFF, QUESTION, {
      store,
      apiKey: "test-key",
      model: "openai/gpt-5.6-luna",
      fetchImpl,
    });
    const events = await store.listEvents(NO_STAFF);

    expect(calls.filter(isTriage)).toHaveLength(0);
    expect(calls).toHaveLength(4);
    expect(typesOf(events)).not.toContain("clarification_requested");

    const proposal = proposalOf(events);
    // A money question still goes to the money mandate, exactly as before.
    expect(proposal.authorRoleId).toBe("cfo");
    expect(systemOf(calls.find(isSynthesis)!)).toContain("You are Marcus, Chief Financial Officer");
    expect(systemOf(calls.find(isSynthesis)!)).not.toContain("You do not sit on the board");
  });
});

// --------------------------------------------------------------- revisions

describe("revisions do not go through triage", () => {
  const ORIGINAL_ID = "prop-should-we-sponsor-two-indie-ab12ef";

  function original(): Proposal {
    return {
      id: ORIGINAL_ID,
      title: "Run a four-week sponsorship test",
      authorRoleId: "cos",
      summary: "Spend a capped $2,400 to find out whether the channel converts.",
      rationale: "The first-round argument.",
      alternatives: ["Do nothing for a quarter."],
      cost: { amount: 2400, note: "Two shows, four weeks." },
      risks: ["Attribution is soft."],
      positions: [
        {
          roleId: "cfo",
          stance: "support_with_conditions",
          summary: "Worth doing if we cap the spend.",
          keyPoints: ["Payback inside one quarter or we stop.", "Assumes: a $54 blended CAC."],
        },
        {
          roleId: "cto",
          stance: "support",
          summary: "Nothing here touches the publish pipeline.",
          keyPoints: ["No engineering cost worth pricing.", "No new failure mode."],
        },
      ],
      disagreements: [],
      status: "pending_approval",
    };
  }

  it("answers the CEO's note directly — the note IS the clarification", async () => {
    await store.appendEvents(COMPANY, [
      { type: "question_asked", text: QUESTION, byRoleId: "ceo" },
      { type: "drafting_started", proposalId: ORIGINAL_ID, authorRoleId: "cos", title: "t" },
      { type: "proposal_submitted", proposal: original() },
      {
        type: "ceo_decision",
        proposalId: ORIGINAL_ID,
        decision: "returned",
        note: "What happens to payback if only one show converts?",
      },
    ]);

    const { fetchImpl, calls } = run3("triage should never be called here");
    await runBoardRevision(COMPANY, ORIGINAL_ID, {
      store,
      apiKey: "test-key",
      model: "openai/gpt-5.6-luna",
      fetchImpl,
    });

    expect(calls.filter(isTriage)).toHaveLength(0);
    expect(calls).toHaveLength(4);

    const events = await store.listEvents(COMPANY);
    expect(typesOf(events)).not.toContain("clarification_requested");

    // The revised document is the Chief of Staff's too.
    const revised = events.filter((e) => e.type === "proposal_submitted").at(-1);
    expect((revised as { proposal?: Proposal }).proposal?.authorRoleId).toBe("cos");
    expect((revised as { proposal?: Proposal }).proposal?.revises).toBe(ORIGINAL_ID);
  });
});

// ----------------------------------------------------------------- the API

describe("POST /api/companies/:id/clarifications/:clarificationId/answer", () => {
  let app: FastifyInstance;
  const CLARIFICATION_ID = "clar-q1";

  const json = (res: { payload: string }) => JSON.parse(res.payload);
  const answer = async (payload: Record<string, unknown>, id = CLARIFICATION_ID) =>
    await app.inject({
      method: "POST",
      url: `/api/companies/${COMPANY}/clarifications/${id}/answer`,
      payload,
    });

  beforeEach(async () => {
    // No OpenRouter key: the resumed run reports itself offline, which is
    // exactly the trace that proves the resume was triggered at all.
    app = await buildApp({ store });
    await app.ready();
    await store.appendEvents(COMPANY, [
      { type: "question_asked", id: "q1", text: QUESTION, byRoleId: "ceo" },
      {
        type: "clarification_requested",
        id: CLARIFICATION_ID,
        questionEventId: "q1",
        questionText: QUESTION,
        byRoleId: "ceo",
        questions: QUESTIONS,
      },
    ]);
  });

  it("records the answer and restarts the parked run", async () => {
    const res = await answer({ answers: ANSWERS });
    expect(res.statusCode).toBe(201);
    expect(json(res).clarification).toMatchObject({ status: "answered", answers: ANSWERS });

    // The board runner is fire-and-forget; let its microtasks drain.
    await new Promise((r) => setTimeout(r, 0));

    const events = await store.listEvents(COMPANY);
    const answered = events.find((e) => e.type === "clarification_answered");
    expect(answered).toMatchObject({ clarificationId: CLARIFICATION_ID, byRoleId: "ceo" });
    expect(notesOf(events).some((n) => /offline/i.test(n))).toBe(true);
  });

  it("409s on a second answer", async () => {
    expect((await answer({ answers: ANSWERS })).statusCode).toBe(201);

    const res = await answer({ answers: "again" });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.message).toMatch(/already been answered/);

    const events = await store.listEvents(COMPANY);
    expect(events.filter((e) => e.type === "clarification_answered")).toHaveLength(1);
  });

  it("409s on a clarification this company never opened", async () => {
    const res = await answer({ answers: ANSWERS }, "clar-ghost");
    expect(res.statusCode).toBe(409);
    expect(json(res).error.message).toMatch(/no such clarification round/);
  });

  it("400s on an empty answer", async () => {
    expect((await answer({ answers: "" })).statusCode).toBe(400);
  });

  it("404s for an unknown company", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/companies/ghost/clarifications/${CLARIFICATION_ID}/answer`,
      payload: { answers: ANSWERS },
    });
    expect(res.statusCode).toBe(404);
  });
});
