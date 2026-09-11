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
 */

import type { CompanyConfig, Disagreement, Id, Position, Proposal, Role } from "@csuite/contract";
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
  buildSynthesisMessages,
  companyProfile,
  DEFAULT_POSITION_MAX_TOKENS,
  DEFAULT_SYNTHESIS_MAX_TOKENS,
  POSITION_TEMPERATURE,
  SYNTHESIS_TEMPERATURE,
  type CompanyProfile,
  type SynthesisEntry,
} from "./prompts";
import { positionResponseSchema, proposalResponseSchema } from "./schemas";

/** Last-resort model: cheap, and the one .env.example ships with. */
export const DEFAULT_BOARD_MODEL = "openai/gpt-5.6-luna";

/** Role id used for notices that belong to the board as a body, not to a member. */
const BOARD_ROLE_ID = "board";

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

export async function runBoard(
  companyId: string,
  questionText: string,
  deps: BoardDeps,
): Promise<void> {
  // Fire-and-forget: nothing above catches for us, and an unhandled rejection
  // would lose the run silently.
  try {
    await deliberate(companyId, questionText, deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log?.warn(`[board] run failed unexpectedly (company=${companyId}): ${message}`);
    await appendQuietly(deps, companyId, [
      {
        type: "worklog",
        roleId: BOARD_ROLE_ID,
        activity: "idle",
        note: `Board run failed: ${truncate(message, 200)}`,
      },
    ]);
  }
}

async function deliberate(
  companyId: string,
  questionText: string,
  deps: BoardDeps,
): Promise<void> {
  const { store, apiKey, log } = deps;

  const company = await store.getCompany(companyId);
  if (!company) {
    log?.warn(`[board] no such company (company=${companyId}); question dropped`);
    return;
  }
  const config: CompanyConfig = company.config;
  const boardRoles = config.roles.filter((r) => r.kind === "board");

  if (!apiKey) {
    const message =
      "Board is OFFLINE: OPENROUTER_API_KEY is not set. The question was recorded in the " +
      "event log, but no C-level positions will be produced and no proposal will reach the " +
      "CEO desk. Set OPENROUTER_API_KEY in the repo-root .env and ask again.";
    log?.warn(`[board] ${message} (company=${companyId})`);
    await store.appendEvents(companyId, [
      {
        type: "worklog",
        roleId: BOARD_ROLE_ID,
        activity: "idle",
        note: `Board offline — no OpenRouter key configured. Question left unanswered: "${truncate(questionText, 160)}"`,
      },
    ]);
    return;
  }

  if (boardRoles.length < MIN_POSITIONS) {
    const note =
      `Board run failed — ${boardRoles.length} board role(s) configured, ` +
      `${MIN_POSITIONS} are needed for a deliberation. No proposal drafted.`;
    log?.warn(`[board] ${note} (company=${companyId})`);
    await store.appendEvents(companyId, [
      { type: "worklog", roleId: BOARD_ROLE_ID, activity: "idle", note },
    ]);
    return;
  }

  const profile = companyProfile(config);
  const author = pickDraftingRole(boardRoles, questionText);
  const proposalId = makeProposalId(questionText);
  const usages: ChatUsage[] = [];

  // The board takes the question up. `title` here is provisional — the real one
  // comes out of synthesis; this event exists so the Floor can show work
  // starting before any model has answered.
  await store.appendEvents(companyId, [
    {
      type: "drafting_started",
      proposalId,
      authorRoleId: author.id,
      title: provisionalTitle(questionText),
    },
    ...boardRoles.map(
      (role): NewEvent => ({
        type: "worklog",
        roleId: role.id,
        activity: "thinking",
        note: `Writing an independent position on: "${truncate(questionText, 120)}"`,
      }),
    ),
  ]);

  // ------------------------------------------------- stage 1: blind positions
  // In parallel, and each call appends its own event the moment it lands: the
  // log should show positions arriving, not a batch appearing at the end.
  const outcomes = await Promise.all(
    boardRoles.map((role) =>
      writePosition({ companyId, proposalId, profile, role, questionText, apiKey, usages, deps }),
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
      `Board run failed — only ${entries.length} of ${boardRoles.length} positions came back; ` +
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
    messages: buildSynthesisMessages({ profile, question: questionText, entries, author }),
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
  };

  const spend = `Board run complete — ${describeSpend(usages, toolSpend)}`;
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
  questionText: string;
  apiKey: string;
  usages: ChatUsage[];
  deps: BoardDeps;
}): Promise<PositionOutcome> {
  const { companyId, proposalId, profile, role, questionText, apiKey, usages, deps } = args;
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
    buildPositionMessages({
      profile,
      role,
      question: questionText,
      harness: deps.harness ?? "baseline",
      tools: withTools,
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
