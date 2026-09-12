/**
 * The board runner — Phase 1's centrepiece.
 *
 * A strategic question in → each C-level agent writes an **independent
 * position, blind to the others** (one OpenRouter call per role, in parallel,
 * prompted only with the company profile, its own mandate, and the question) →
 * one synthesis call that assembles the proposal document and *records*
 * disagreements rather than smoothing them over → a `proposal_submitted` event
 * that lands in the same CEO inbox the Phase 0 demo already renders.
 *
 * Everything this function does, it does through the event log: that is the
 * only channel it has back to the world (it is invoked fire-and-forget from
 * POST /api/companies/:id/questions), so a run that fails must still say so in
 * the log where the UI can see it.
 *
 * Cost discipline is binding (CLAUDE.md): without context tools a run is N+1
 * calls — never more. With them, a position may consult company memory first
 * (see context-loop.ts), which adds at most `BOARD_MAX_TOOL_CALLS` tool calls
 * and the turns that carry them, under a per-position deadline. Either way
 * every call is token-capped, every JSON answer buys one repair attempt at
 * most, nothing loops unbounded, and the run closes with what it actually
 * spent — including which positions consulted and how often.
 *
 * **Stage 0 exists only when the company has a `staff` role** (the Chief of
 * Staff). Then a question is triaged first — one cheap call that either sends
 * it straight to the board or stops the run and asks the CEO 1-3 things only
 * the CEO can know (see triage.ts). A stopped run appends
 * `clarification_requested` and nothing else: no positions, no document, no
 * spend beyond the one call. It resumes when the CEO answers, with the answers
 * carried into both stages as the highest authority in the prompt. A company
 * with no `staff` role never makes that call and behaves exactly as before.
 * The Chief of Staff also *writes* the document: synthesis is authorship, and
 * an author who argued a side is judging their own position.
 *
 * The **revision run** (`runBoardRevision`) is the same machine over a
 * different subject: the CEO returned a proposal with questions, so the board
 * answers them with a new document that `revises` the old one. Same two stages,
 * same caps, same degradation — only the prompts and the ids differ. It is
 * triggered by one CEO decision and produces one document: no self-driving,
 * every further round needs another returned+note from the desk.
 */

import type { CompanyConfig, CompanyEvent, Disagreement, Id, Position, Proposal, Role } from "@csuite/contract";
import type { ContextRegistry, ContextToolDef } from "../context/types";
import type { EventStore, NewEvent } from "../store/types";
import {
  chatJsonWithTools,
  DEFAULT_MAX_TOOL_CALLS,
  isToolsRejection,
  type Consultation,
} from "./context-loop";
import { describeSpend, type ToolSpend } from "./cost";
import { chatJson } from "./json";
import { truncate, type ChatUsage, type FetchLike } from "./openrouter";
import {
  buildPositionMessages,
  buildRevisionPositionMessages,
  buildRevisionSynthesisMessages,
  buildSynthesisMessages,
  companyProfile,
  DEFAULT_POSITION_MAX_TOKENS,
  DEFAULT_SYNTHESIS_MAX_TOKENS,
  POSITION_TEMPERATURE,
  SYNTHESIS_TEMPERATURE,
  type ClarificationContext,
  type CompanyProfile,
  type SynthesisEntry,
} from "./prompts";
import { positionResponseSchema, proposalResponseSchema } from "./schemas";
import { makeClarificationId, triageQuestion } from "./triage";

/** Last-resort model: cheap, and the one .env.example ships with. */
export const DEFAULT_BOARD_MODEL = "openai/gpt-5.6-luna";

/** Role id used for notices that belong to the board as a body, not to a member. */
const BOARD_ROLE_ID = "board";

/** The human CEO's role id — a user, never an agent (CLAUDE.md). */
const CEO_ROLE_ID = "ceo";

/** Below this, there is no deliberation to synthesise — just one opinion. */
const MIN_POSITIONS = 2;

export interface BoardDeps {
  store: EventStore;
  /** Present when an OpenRouter key is configured. */
  apiKey?: string | undefined;
  /** Default model for roles whose config does not name an OpenRouter one. */
  model?: string | undefined;
  /** Position-prompt harness; "adversarial" adds steelman-against obligations. */
  harness?: import("./prompts").Harness | undefined;
  /** Per-call token ceilings; defaults live in prompts.ts, overrides in .env. */
  positionMaxTokens?: number | undefined;
  synthesisMaxTokens?: number | undefined;
  /**
   * Company memory the board may consult while writing positions. Absent (or
   * empty) means the old behaviour exactly: one call per position, no tools.
   * Synthesis never gets it — stage 2 reads the positions, not the company.
   */
  context?: ContextRegistry | undefined;
  /** Individual tool calls one position may make; `BOARD_MAX_TOOL_CALLS` in .env. */
  maxToolCalls?: number | undefined;
  /** Injected by tests; defaults to global fetch. */
  fetchImpl?: FetchLike | undefined;
  log?: { warn(msg: string): void; info(msg: string): void };
}

/**
 * What a run is about.
 *
 * `question` is the fresh-question run; `revision` is the same deliberation
 * pointed at a returned proposal. Everything that differs between the two is a
 * field here, which is why there is one runner and not two.
 */
type Subject =
  | {
      kind: "question";
      question: string;
      /**
       * Present only on the resume path: the Chief of Staff asked, the CEO
       * answered, and the run restarted with both in hand. Its presence is also
       * what stops the resumed run from being triaged a second time.
       */
      clarification?: ClarificationContext | undefined;
      /** The `question_asked` event this run answers, when the caller knows it. */
      questionEventId?: Id | undefined;
      /** Who asked. Only used to attribute a clarification request back to them. */
      byRoleId?: Id | undefined;
    }
  | {
      kind: "revision";
      /** What the board was originally asked — recovered, or the summary. */
      question: string;
      /** The returned document, from reduced state: positions and ceoNote included. */
      original: Proposal;
      /** The CEO's questions. Non-empty by the time a subject exists. */
      note: string;
      /** `<originalId>-r2`, worked out against the ids already in the log. */
      proposalId: Id;
    };

/**
 * Everything about a question run that is *not* the question.
 *
 * All optional, and a call that passes none of it behaves exactly as the
 * one-argument runner always did — which is the property the no-staff-role
 * regression rests on.
 */
export interface RunBoardOptions {
  /**
   * The `question_asked` event this run answers. Needed only to attribute a
   * clarification request back to it; without it a triaged run still works, it
   * just cannot name the question event it came from.
   */
  questionEventId?: Id | undefined;
  /** Who asked. Defaults to the CEO, who is a user and never an agent. */
  byRoleId?: Id | undefined;
  /**
   * Set by the resume path (POST .../clarifications/:id/answer): the Chief of
   * Staff's questions and the CEO's answers. Its presence skips triage — this
   * question has already been through it — and feeds both stages the answers.
   */
  clarification?: ClarificationContext | undefined;
}

export async function runBoard(
  companyId: string,
  questionText: string,
  deps: BoardDeps,
  options: RunBoardOptions = {},
): Promise<void> {
  // Fire-and-forget: nothing above catches for us, and an unhandled rejection
  // would lose the run silently.
  try {
    await deliberate(
      companyId,
      {
        kind: "question",
        question: questionText,
        clarification: options.clarification,
        questionEventId: options.questionEventId,
        byRoleId: options.byRoleId,
      },
      deps,
    );
  } catch (err) {
    await reportCrash(deps, companyId, "Board run", err);
  }
}

/**
 * The board answers the CEO's questions on a proposal they returned.
 *
 * Reads the returned document out of reduced state (nothing is passed in but
 * an id, so the log stays the single source of truth), recovers the question
 * the round began with, and runs the same two stages against them. Every
 * precondition is re-checked here: the endpoint is one caller, not the
 * guarantee.
 */
export async function runBoardRevision(
  companyId: string,
  proposalId: Id,
  deps: BoardDeps,
): Promise<void> {
  try {
    const { store, log } = deps;
    const state = await store.getState(companyId);
    const original = state.proposals[proposalId];
    if (!original) {
      log?.warn(`[board] no such proposal to revise (company=${companyId}, proposal=${proposalId})`);
      return;
    }
    if (original.status !== "returned") {
      log?.warn(
        `[board] proposal ${proposalId} is "${original.status}", not "returned" — ` +
          `no revision run (company=${companyId})`,
      );
      return;
    }
    const note = (original.ceoNote ?? "").trim();
    if (note === "") {
      // A return with no questions is the legacy shape and says nothing to
      // answer. Silence is the correct behaviour, not a failure.
      log?.info(
        `[board] proposal ${proposalId} was returned without a note — nothing to revise ` +
          `(company=${companyId})`,
      );
      return;
    }

    await deliberate(
      companyId,
      {
        kind: "revision",
        original,
        note,
        // The board must know what it was asked; if that is unrecoverable the
        // document's own summary is the subject, which is what it was anyway.
        question: findOriginalQuestion(state.feed, rootProposalId(proposalId)) ?? original.summary,
        proposalId: nextRevisionId(proposalId, Object.keys(state.proposals)),
      },
      deps,
    );
  } catch (err) {
    await reportCrash(deps, companyId, "Board revision", err);
  }
}

async function deliberate(companyId: string, subject: Subject, deps: BoardDeps): Promise<void> {
  const { store, apiKey, log } = deps;
  const revision = subject.kind === "revision" ? subject : undefined;
  const fresh = subject.kind === "question" ? subject : undefined;
  const label = revision ? "Board revision" : "Board run";

  const company = await store.getCompany(companyId);
  if (!company) {
    log?.warn(
      `[board] no such company (company=${companyId}); ` +
        `${revision ? "revision" : "question"} dropped`,
    );
    return;
  }
  const config: CompanyConfig = company.config;
  const boardRoles = config.roles.filter((r) => r.kind === "board");

  if (!apiKey) {
    const message = revision
      ? "Board is OFFLINE: OPENROUTER_API_KEY is not set. The return was recorded in the " +
        "event log, but the board cannot answer the CEO's questions and no revised proposal " +
        "will reach the CEO desk. Set OPENROUTER_API_KEY in the repo-root .env and return " +
        "the proposal again."
      : "Board is OFFLINE: OPENROUTER_API_KEY is not set. The question was recorded in the " +
        "event log, but no C-level positions will be produced and no proposal will reach the " +
        "CEO desk. Set OPENROUTER_API_KEY in the repo-root .env and ask again.";
    log?.warn(`[board] ${message} (company=${companyId})`);
    await store.appendEvents(companyId, [
      {
        type: "worklog",
        roleId: BOARD_ROLE_ID,
        activity: "idle",
        note: revision
          ? `Board offline — no OpenRouter key configured. The CEO's questions on ` +
            `"${truncate(revision.original.title, 120)}" are unanswered.`
          : `Board offline — no OpenRouter key configured. Question left unanswered: "${truncate(subject.question, 160)}"`,
      },
    ]);
    return;
  }

  if (boardRoles.length < MIN_POSITIONS) {
    const note =
      `${label} failed — ${boardRoles.length} board role(s) configured, ` +
      `${MIN_POSITIONS} are needed for a deliberation. No proposal drafted.`;
    log?.warn(`[board] ${note} (company=${companyId})`);
    await store.appendEvents(companyId, [
      { type: "worklog", roleId: BOARD_ROLE_ID, activity: "idle", note },
    ]);
    return;
  }

  const profile = companyProfile(config);

  /**
   * The process role that guards the CEO's attention — the Chief of Staff. At
   * most one is consulted: a second one would only be a second opinion, and
   * opinions are what the board is for.
   */
  const staff = config.roles.find((r) => r.kind === "staff");
  const usages: ChatUsage[] = [];

  // ------------------------------------------ stage 0: clarification triage
  // Only on a fresh question, only with a staff role, and never twice: a run
  // that already carries the CEO's answers has been through this gate, and a
  // revision does not need it — the CEO's note on returning the document *is*
  // the clarification.
  if (staff && fresh && !fresh.clarification) {
    const verdict = await triageQuestion({
      apiKey,
      model: modelFor(staff, deps.model),
      profile,
      cos: staff,
      question: fresh.question,
      // What the board can look up for itself is never the CEO's to recite.
      toolNames: contextToolNames(deps, staff.id),
      fetchImpl: deps.fetchImpl,
      usageSink: usages,
      log,
    });

    if (verdict.warning) {
      // A gate that broke is a gate the log should show breaking — but the run
      // goes on regardless: the board is the product, triage is the courtesy.
      log?.warn(`[board] ${verdict.warning} (company=${companyId})`);
      await appendQuietly(deps, companyId, [
        {
          type: "worklog",
          roleId: staff.id,
          activity: "idle",
          note: truncate(verdict.warning, 300),
        },
      ]);
    }

    if (!verdict.proceed) {
      const questionEventId =
        fresh.questionEventId ?? (await questionEventIdFor(store, companyId, fresh.question));
      await store.appendEvents(companyId, [
        {
          type: "clarification_requested",
          id: makeClarificationId(questionEventId),
          questionEventId,
          questionText: fresh.question,
          byRoleId: fresh.byRoleId ?? CEO_ROLE_ID,
          questions: verdict.questions,
        },
        {
          type: "worklog",
          roleId: staff.id,
          activity: "idle",
          note:
            `Waiting for the CEO's clarification — ${verdict.questions.length} question(s) ` +
            `before the board takes this up. ${describeSpend(usages)}`,
        },
      ]);
      log?.info(
        `[board] clarification requested before deliberating (company=${companyId}, ` +
          `role=${staff.id}, questions=${verdict.questions.length})`,
      );
      return;
    }
  }

  // Who signs the document. A `staff` role always does when the company has
  // one — the Chief of Staff was not a party to the argument, which is the
  // entire point: an author who argued a side is an author judging their own
  // position. Without one, nothing changes — a revision keeps the byline of the
  // member who signed the original, unless that role has since left the board.
  const author =
    staff ??
    (revision ? boardRoles.find((r) => r.id === revision.original.authorRoleId) : undefined) ??
    pickDraftingRole(boardRoles, subject.question);
  const authorIsStaff = author.kind === "staff";
  const proposalId = revision ? revision.proposalId : makeProposalId(subject.question);

  // The board takes the question up. `title` here is provisional — the real one
  // comes out of synthesis; this event exists so the Floor can show work
  // starting before any model has answered.
  await store.appendEvents(companyId, [
    {
      type: "drafting_started",
      proposalId,
      authorRoleId: author.id,
      title: revision
        ? truncate(`Revision — ${revision.original.title}`, 80)
        : provisionalTitle(subject.question),
    },
    ...boardRoles.map(
      (role): NewEvent => ({
        type: "worklog",
        roleId: role.id,
        activity: "thinking",
        note: revision
          ? `Answering the CEO's questions on "${truncate(revision.original.title, 80)}": ` +
            `"${truncate(revision.note, 120)}"`
          : `Writing an independent position on: "${truncate(subject.question, 120)}"`,
      }),
    ),
  ]);

  // ------------------------------------------------- stage 1: blind positions
  // In parallel, and each call appends its own event the moment it lands: the
  // log should show positions arriving, not a batch appearing at the end.
  const outcomes = await Promise.all(
    boardRoles.map((role) =>
      writePosition({
        companyId,
        proposalId,
        profile,
        role,
        subject,
        roles: config.roles,
        apiKey,
        usages,
        deps,
      }),
    ),
  );

  const entries: SynthesisEntry[] = outcomes.flatMap((o) =>
    o.position ? [{ role: o.role, position: o.position }] : [],
  );

  // Stage 1's tool use, counted once and reported in the run's spend line.
  const toolSpend: ToolSpend = {
    positionsWithTools: outcomes.filter((o) => o.usedTools).length,
    consultations: outcomes.reduce((n, o) => n + o.consultations, 0),
  };

  if (entries.length < MIN_POSITIONS) {
    const note =
      `${label} failed — only ${entries.length} of ${boardRoles.length} positions came back; ` +
      `${MIN_POSITIONS} are needed to synthesise. No proposal drafted. ${describeSpend(usages, toolSpend)}`;
    log?.warn(`[board] ${note} (company=${companyId})`);
    await store.appendEvents(companyId, [
      { type: "worklog", roleId: author.id, activity: "idle", note },
    ]);
    return;
  }

  // ---------------------------------------------------- stage 2: synthesis
  const doc = await chatJson({
    apiKey,
    model: modelFor(author, deps.model),
    messages: revision
      ? buildRevisionSynthesisMessages({
          profile,
          question: revision.question,
          original: revision.original,
          note: revision.note,
          entries,
          author,
          authorIsStaff,
        })
      : buildSynthesisMessages({
          profile,
          question: subject.question,
          entries,
          author,
          authorIsStaff,
          clarification: fresh?.clarification,
        }),
    schema: proposalResponseSchema,
    maxTokens: deps.synthesisMaxTokens ?? DEFAULT_SYNTHESIS_MAX_TOKENS,
    temperature: SYNTHESIS_TEMPERATURE,
    fetchImpl: deps.fetchImpl,
    usageSink: usages,
    label: `synthesis(${author.id})`,
    log,
  });

  const positions = entries.map((e) => e.position);
  const speakers = new Set(positions.map((p) => p.roleId));
  const disagreements = doc.disagreements.flatMap((d): Disagreement[] => {
    // A disagreement is only evidence if it names people who actually spoke.
    const roleIds = resolveRoleIds(d.roleIds, config.roles, speakers);
    if (roleIds.length < 2) return [];
    return [{ topic: d.topic, roleIds, detail: d.detail }];
  });
  if (disagreements.length < doc.disagreements.length) {
    log?.warn(
      `[board] dropped ${doc.disagreements.length - disagreements.length} disagreement(s) ` +
        `naming roles that did not submit a position (company=${companyId})`,
    );
  }

  const proposal: Proposal = {
    id: proposalId,
    title: doc.title,
    authorRoleId: author.id,
    summary: doc.summary,
    rationale: doc.rationale,
    alternatives: doc.alternatives,
    cost: doc.cost,
    risks: doc.risks,
    positions,
    disagreements,
    // The reducer forces `pending_approval` on submission; this is what the
    // document means at the moment it leaves the board.
    status: "pending_approval",
    // The thread: this document answers that one. The returned original keeps
    // its own status and the CEO's note — nothing is rewritten.
    ...(revision ? { revises: revision.original.id } : {}),
  };

  const spend = `${label} complete — ${describeSpend(usages, toolSpend)}`;
  await store.appendEvents(companyId, [
    ...disagreements.map(
      (disagreement): NewEvent => ({ type: "disagreement_recorded", proposalId, disagreement }),
    ),
    { type: "proposal_submitted", proposal },
    { type: "worklog", roleId: author.id, activity: "idle", note: spend },
  ]);
  log?.info(`[board] ${spend} (company=${companyId}, proposal=${proposalId})`);
}

// ---------------------------------------------------------------- stage 1

interface PositionOutcome {
  role: Role;
  position?: Position;
  /** The position's calls carried tool definitions (even if it called nothing). */
  usedTools: boolean;
  /** Tool calls this position actually executed. */
  consultations: number;
}

async function writePosition(args: {
  companyId: string;
  proposalId: Id;
  profile: CompanyProfile;
  role: Role;
  subject: Subject;
  /** The roster — used only to label an already-submitted document's positions. */
  roles: readonly Role[];
  apiKey: string;
  usages: ChatUsage[];
  deps: BoardDeps;
}): Promise<PositionOutcome> {
  const { companyId, proposalId, profile, role, subject, apiKey, usages, deps } = args;
  const { store, log } = deps;

  // A role's tools are asked for once, here: whether this position can consult
  // anything is decided before the first token is spent. A budget of zero means
  // the same thing as no registry — an offer the member may not accept would be
  // prompt tokens spent on nothing.
  const budget = deps.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  let tools: readonly ContextToolDef[] = [];
  if (budget > 0) {
    try {
      tools = deps.context?.toolsFor(role.id) ?? [];
    } catch (err) {
      log?.warn(
        `[board] context registry refused to list tools (company=${companyId}, role=${role.id}): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const common = {
    apiKey,
    model: modelFor(role, deps.model),
    schema: positionResponseSchema,
    maxTokens: deps.positionMaxTokens ?? DEFAULT_POSITION_MAX_TOKENS,
    temperature: POSITION_TEMPERATURE,
    fetchImpl: deps.fetchImpl,
    usageSink: usages,
    label: `position(${role.id})`,
    log,
  };
  const messagesFor = (withTools: readonly ContextToolDef[]) =>
    subject.kind === "revision"
      ? buildRevisionPositionMessages({
          profile,
          role,
          question: subject.question,
          original: subject.original,
          note: subject.note,
          roles: args.roles,
          harness: deps.harness ?? "baseline",
          tools: withTools,
        })
      : buildPositionMessages({
          profile,
          role,
          question: subject.question,
          harness: deps.harness ?? "baseline",
          tools: withTools,
          clarification: subject.clarification,
        });

  let usedTools = false;
  let consultations = 0;

  try {
    let answer;
    if (tools.length > 0 && deps.context) {
      usedTools = true;
      try {
        const result = await chatJsonWithTools({
          ...common,
          messages: messagesFor(tools),
          tools,
          registry: deps.context,
          companyId,
          roleId: role.id,
          maxToolCalls: deps.maxToolCalls,
          // Counted here rather than from the result, so a consultation that
          // happened is still counted if the attempt later falls apart.
          onConsult: (consultation) => {
            consultations++;
            return recordConsultation(deps, companyId, consultation);
          },
        });
        answer = result.value;
      } catch (err) {
        // The model or the route does not do function calling. One retry, tools
        // off, so the board keeps its member instead of losing a position.
        if (!isToolsRejection(err)) throw err;
        usedTools = consultations > 0;
        const message = err instanceof Error ? err.message : String(err);
        log?.warn(
          `[board] context tools rejected (company=${companyId}, role=${role.id}): ${message}; ` +
            "retrying this position without tools",
        );
        await appendQuietly(deps, companyId, [
          {
            type: "worklog",
            roleId: role.id,
            activity: "thinking",
            note:
              "Context tools unavailable for this model — writing the position from the " +
              `company profile alone. (${truncate(message, 160)})`,
          },
        ]);
        answer = await chatJson({ ...common, messages: messagesFor([]) });
      }
    } else {
      answer = await chatJson({ ...common, messages: messagesFor([]) });
    }

    const position: Position = {
      roleId: role.id,
      stance: answer.stance,
      summary: answer.summary,
      // Provenance v0 lands here: the contract's `Position` has no
      // `assumptions` field and must not grow one, so ungrounded figures ride
      // along as visibly-labelled key points instead of disappearing.
      keyPoints: [...answer.keyPoints, ...answer.assumptions.map(asAssumption)],
    };

    await store.appendEvents(companyId, [
      { type: "position_submitted", proposalId, position },
    ]);
    return { role, position, usedTools, consultations };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.warn(`[board] position failed (company=${companyId}, role=${role.id}): ${message}`);
    await appendQuietly(deps, companyId, [
      {
        type: "worklog",
        roleId: role.id,
        activity: "idle",
        note: `Position failed — ${truncate(message, 200)}`,
      },
    ]);
    return { role, usedTools, consultations };
  }
}

/**
 * Provenance for one consultation, in the log where the UI can show it
 * ("the CFO read the August finance summary"). Best-effort by design: a
 * bookkeeping write that fails must not cost the board its position — the run
 * degrades to an unexplained figure, not to a lost member.
 */
async function recordConsultation(
  deps: BoardDeps,
  companyId: string,
  consultation: Consultation,
): Promise<void> {
  await appendQuietly(deps, companyId, [
    {
      type: "context_consulted",
      roleId: consultation.roleId,
      tool: consultation.tool,
      args: consultation.args,
      ok: consultation.ok,
    },
  ]);
}

/** "Assumes: 4% churn" — without doubling the word when the model wrote it already. */
export function asAssumption(text: string): string {
  const body = text.trim().replace(/^assum(?:es|ed|ing|ption)?\b[\s:—–-]*/i, "");
  return `Assumes: ${body || text.trim()}`;
}

// ---------------------------------------------------------------- helpers

/**
 * The names of the context tools the board will have on this run — told to the
 * Chief of Staff so triage knows what the board can look up for itself, and
 * therefore what must never be asked of the CEO. Names only: the definitions
 * belong in the position stage's request, not in a prompt.
 *
 * Best-effort by construction. A registry that will not answer costs triage a
 * little precision, never the run.
 */
function contextToolNames(deps: BoardDeps, roleId: Id): string[] {
  if ((deps.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS) <= 0) return [];
  try {
    return (deps.context?.toolsFor(roleId) ?? []).map((t) => t.name);
  } catch {
    return [];
  }
}

/**
 * The id of the `question_asked` event a clarification points back at.
 *
 * The API knows it — it appended the event a moment ago — and passes it in.
 * Any other caller gets it recovered here from the log, by the last question
 * with the same text, so the pointer means something. If the log holds no such
 * question (a run started straight from code), the clarification stands under
 * an id of its own: an honest orphan beats a dangling pointer.
 */
async function questionEventIdFor(
  store: EventStore,
  companyId: string,
  questionText: string,
): Promise<Id> {
  const events = await store.listEvents(companyId);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "question_asked" && event.text === questionText) return event.id;
  }
  return crypto.randomUUID();
}

/** A role's model is only usable if it looks like an OpenRouter id (`vendor/model`). */
export function modelFor(role: Role, fallback?: string): string {
  if (role.model && role.model.includes("/")) return role.model;
  return fallback && fallback.trim() !== "" ? fallback : DEFAULT_BOARD_MODEL;
}

/**
 * Which board member's name goes on the document.
 *
 * Deliberately dumb: a topic lexicon scored against the question and against
 * each role's own title + mandate, first board role on a tie. It decides
 * attribution only — every board member writes a position either way — so a
 * wrong guess costs nothing but a byline.
 */
const TOPIC_LEXICON: Record<string, readonly string[]> = {
  money: [
    "price", "prices", "pricing", "cost", "costs", "budget", "revenue", "margin", "margins",
    "cash", "spend", "spending", "churn", "mrr", "arr", "billing", "discount", "payback",
    "economics", "economic", "financial", "finance", "profit", "funding", "invest",
    "investment", "runway", "subscription", "monetize", "monetise", "fee", "fees", "payment",
    "unit", "ltv", "cac",
  ],
  tech: [
    "build", "rebuild", "migrate", "migration", "architecture", "architectural",
    "infrastructure", "platform", "stack", "api", "database", "latency", "performance",
    "security", "technical", "technology", "refactor", "cdn", "deploy", "deployment",
    "rewrite", "engineering", "code", "integration", "scalability", "scale", "uptime",
    "debt", "risk", "server", "servers",
  ],
  ops: [
    "hire", "hiring", "headcount", "capacity", "process", "support", "staffing", "deadline",
    "deadlines", "timeline", "onboarding", "workload", "operations", "operational", "team",
    "vendor", "logistics", "schedule", "throughput", "feasibility", "load", "queue",
  ],
};

export function pickDraftingRole(boardRoles: Role[], question: string): Role {
  const first = boardRoles[0];
  if (!first) throw new Error("pickDraftingRole needs at least one board role");

  const questionScore = scoreTopics(question);
  let best = first;
  let bestScore = 0;
  for (const role of boardRoles) {
    const roleScore = scoreTopics(`${role.title} ${role.mandate}`);
    let score = 0;
    for (const topic of Object.keys(TOPIC_LEXICON)) {
      score += (questionScore[topic] ?? 0) * (roleScore[topic] ?? 0);
    }
    if (score > bestScore) {
      best = role;
      bestScore = score;
    }
  }
  return best;
}

function scoreTopics(text: string): Record<string, number> {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  const scores: Record<string, number> = {};
  for (const [topic, lexicon] of Object.entries(TOPIC_LEXICON)) {
    scores[topic] = lexicon.reduce((n, w) => n + (words.has(w) ? 1 : 0), 0);
  }
  return scores;
}

/**
 * Maps whatever the synthesiser called the parties onto real role ids, and
 * keeps only roles that actually submitted a position.
 */
export function resolveRoleIds(
  raw: readonly string[],
  roles: readonly Role[],
  speakers: ReadonlySet<Id>,
): Id[] {
  const out: Id[] = [];
  for (const candidate of raw) {
    const needle = candidate.trim().toLowerCase();
    const match = roles.find(
      (r) =>
        r.id.toLowerCase() === needle ||
        r.name.toLowerCase() === needle ||
        r.title.toLowerCase() === needle,
    );
    if (match && speakers.has(match.id) && !out.includes(match.id)) out.push(match.id);
  }
  return out;
}

/** The last-resort trace for a run that fell over somewhere unexpected. */
async function reportCrash(
  deps: BoardDeps,
  companyId: string,
  label: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  deps.log?.warn(
    `[board] ${label.toLowerCase()} failed unexpectedly (company=${companyId}): ${message}`,
  );
  await appendQuietly(deps, companyId, [
    {
      type: "worklog",
      roleId: BOARD_ROLE_ID,
      activity: "idle",
      note: `${label} failed: ${truncate(message, 200)}`,
    },
  ]);
}

// ------------------------------------------------------------- revision ids

/** `prop-x-ab12ef-r3` → `prop-x-ab12ef`. Idempotent on an unrevised id. */
export function rootProposalId(proposalId: Id): Id {
  return proposalId.replace(/(?:-r\d+)+$/, "");
}

/**
 * The id of the next revision of `proposalId`: `-r2` for the first, then `-r3`,
 * counted off the `-r` suffixes already present on the same base id rather than
 * off the one document we happen to hold — a base can only have one live thread,
 * and re-deriving it from the log is what keeps a re-returned revision from
 * colliding with its own predecessor.
 */
export function nextRevisionId(proposalId: Id, existingIds: readonly Id[]): Id {
  const base = rootProposalId(proposalId);
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-r(\\d+)$`);
  let highest = 1;
  for (const id of existingIds) {
    const found = pattern.exec(id)?.[1];
    if (found !== undefined) highest = Math.max(highest, Number(found));
  }
  return `${base}-r${highest + 1}`;
}

/**
 * The question the thread started from: the last `question_asked` before the
 * root proposal's `drafting_started`. Returns undefined when the log does not
 * hold one — a proposal can be submitted without a question ever being asked,
 * and the caller falls back to the document's own summary.
 */
export function findOriginalQuestion(
  events: readonly CompanyEvent[],
  rootId: Id,
): string | undefined {
  const drafting = events.findIndex(
    (e) => e.type === "drafting_started" && e.proposalId === rootId,
  );
  if (drafting === -1) return undefined;
  for (let i = drafting - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "question_asked") return event.text;
  }
  return undefined;
}

export function makeProposalId(question: string): string {
  const slug =
    question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .filter(Boolean)
      .slice(0, 5)
      .join("-")
      .slice(0, 32)
      .replace(/-+$/, "") || "question";
  return `prop-${slug}-${crypto.randomUUID().slice(0, 6)}`;
}

function provisionalTitle(question: string): string {
  return truncate(question.trim().replace(/\s+/g, " "), 80);
}

/** Best-effort log write: used on paths that are already handling a failure. */
async function appendQuietly(
  deps: BoardDeps,
  companyId: string,
  events: NewEvent[],
): Promise<void> {
  try {
    await deps.store.appendEvents(companyId, events);
  } catch (err) {
    deps.log?.warn(
      `[board] could not record the failure in the log (company=${companyId}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
