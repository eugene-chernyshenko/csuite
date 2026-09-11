/**
 * The context-tool registry: the company's memory, made queryable by the
 * agents who work for it (ARCHITECTURE: "Board context — on demand, not
 * wholesale", "Context tools").
 *
 * Three design rules this file holds to:
 *
 * 1. **Read-only.** Deliberation consults memory; it does not change it. The
 *    library service can write, and REST exposes that — but `library_write` is
 *    deliberately absent from the board's toolset, because a board member who
 *    can edit the policy he is arguing about is not deliberating.
 * 2. **Everything folds from the log.** Process-memory tools read
 *    `store.getState()`; library tools go through the library service (which is
 *    itself a fold, or a projection of one). There is no third source.
 * 3. **Results are small and plain.** A tool answers in compact markdown and is
 *    hard-capped at {@link MAX_RESULT_CHARS}; anything longer says so and tells
 *    the model how to narrow. Context is the scarce resource here, not calls.
 *
 * Recording is the caller's job: the board runner appends `context_consulted`
 * for each call it makes. Execution here stays pure lookup.
 */

import { z } from "zod";
import type {
  CompanyState,
  Disagreement,
  Document,
  DocumentFrontmatter,
  Id,
  Proposal,
  Report,
  Task,
} from "@csuite/contract";
import {
  createLibraryService,
  eventSourcedLibraryStore,
  type DocumentHit,
  type LibraryService,
} from "../library";
import type { EventStore } from "../store/types";
import { ContextToolError, type ContextRegistry, type ContextToolDef } from "./types";

export interface ContextRegistryDeps {
  store: EventStore;
  /**
   * The library behind `library_*`. Optional so a caller with nothing but an
   * EventStore still gets a working registry — it falls back to reading the
   * library straight out of the log.
   */
  library?: LibraryService;
}

/**
 * The ceiling on one tool result, in characters (~1k tokens). A tool that hits
 * it truncates and says so — a silently clipped answer is worse than a short
 * one, because the model cannot tell it is reasoning on half a document.
 */
export const MAX_RESULT_CHARS = 4000;

const DOCUMENT_TYPES = [
  "profile",
  "policy",
  "finance",
  "analysis",
  "agreement",
  "note",
] as const;

const TASK_STATUSES = ["todo", "in_progress", "in_review", "blocked", "done"] as const;

/* ------------------------------------------------------------- formatting */

/** Caps a result, leaving a visible note about what was cut. */
export function cap(text: string, max: number = MAX_RESULT_CHARS): string {
  if (text.length <= max) return text;
  const notice = "\n\n[truncated: ";
  const room = max - notice.length - 80;
  const kept = text.slice(0, Math.max(0, room)).trimEnd();
  return `${kept}${notice}${text.length - kept.length} more characters. Narrow the filters, or read one item by id.]`;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * The company timeline in whatever unit the stream uses: the server writes
 * epoch milliseconds, the demo writes sim-minutes (see `EventBase.ts`).
 */
function when(ts: number): string {
  return ts > 1e11 ? new Date(ts).toISOString().slice(0, 10) : `t+${Math.round(ts)}`;
}

function bullets(lines: string[]): string {
  return lines.map((l) => `- ${l}`).join("\n");
}

function tagsOf(doc: DocumentFrontmatter): string {
  return doc.tags.length ? ` [${doc.tags.join(", ")}]` : "";
}

function documentLine(doc: DocumentFrontmatter): string {
  const superseded = doc.status === "superseded" ? " (SUPERSEDED)" : "";
  return `${doc.id} — ${doc.type} — "${doc.title}"${superseded}, owner ${doc.ownerRoleId}, updated ${when(doc.updatedAt)}${tagsOf(doc)}\n  ${doc.summary}`;
}

function renderDocument(doc: Document): string {
  const head = [
    `# ${doc.title}`,
    `id: ${doc.id} · type: ${doc.type} · owner: ${doc.ownerRoleId} · status: ${doc.status}` +
      (doc.supersededBy ? ` (superseded by ${doc.supersededBy})` : "") +
      ` · updated: ${when(doc.updatedAt)}`,
    doc.tags.length ? `tags: ${doc.tags.join(", ")}` : "",
    "",
    doc.summary,
    "",
    doc.body,
  ];
  return head.filter((l) => l !== "").join("\n");
}

function renderHit(hit: DocumentHit): string {
  return `${hit.id} — ${hit.type} — "${hit.title}" (owner ${hit.ownerRoleId}, updated ${when(hit.updatedAt)})\n  ${hit.snippet}`;
}

function disagreementTopics(ds: Disagreement[]): string {
  if (!ds.length) return "no recorded disagreement";
  return `disagreement: ${ds.map((d) => d.topic).join("; ")}`;
}

function proposalLine(p: Proposal, state: CompanyState): string {
  const decision = state.decisions[p.id] ?? "undecided";
  const ts = submittedAt(state, p.id);
  return (
    `${p.id} — "${p.title}" (${p.status}, CEO: ${decision}` +
    (ts === undefined ? "" : `, ${when(ts)}`) +
    `)\n  cost ${money(p.cost.amount)} — ${p.cost.note}\n  ${disagreementTopics(p.disagreements)}`
  );
}

function submittedAt(state: CompanyState, proposalId: Id): number | undefined {
  for (let i = state.feed.length - 1; i >= 0; i -= 1) {
    const ev = state.feed[i]!;
    if (ev.type === "proposal_submitted" && ev.proposal.id === proposalId) return ev.ts;
  }
  return undefined;
}

function renderProposal(p: Proposal, state: CompanyState): string {
  const decision = state.decisions[p.id] ?? "undecided";
  const parts: string[] = [
    `# ${p.title}`,
    `id: ${p.id} · author: ${p.authorRoleId} · status: ${p.status} · CEO decision: ${decision}`,
    "",
    `## Summary\n${p.summary}`,
    `## Rationale\n${p.rationale}`,
    `## Cost\n${money(p.cost.amount)} — ${p.cost.note}`,
  ];
  if (p.alternatives.length) parts.push(`## Alternatives considered\n${bullets(p.alternatives)}`);
  if (p.risks.length) parts.push(`## Risks\n${bullets(p.risks)}`);
  if (p.positions.length) {
    parts.push(
      `## Board positions\n` +
        p.positions
          .map(
            (pos) =>
              `### ${pos.roleId} — ${pos.stance}\n${pos.summary}\n${bullets(pos.keyPoints)}`,
          )
          .join("\n\n"),
    );
  }
  parts.push(
    p.disagreements.length
      ? `## Recorded disagreements\n` +
          p.disagreements
            .map((d) => `### ${d.topic} (${d.roleIds.join(", ")})\n${d.detail}`)
            .join("\n\n")
      : `## Recorded disagreements\nNone — the board converged.`,
  );
  if (p.ceoNote) parts.push(`## CEO note\n${p.ceoNote}`);
  return parts.join("\n\n");
}

function taskLine(t: Task): string {
  return `${t.id} — "${t.title}" [${t.status}] dept ${t.departmentId}${t.assigneeRoleId ? `, assignee ${t.assigneeRoleId}` : ""}${t.proposalId ? `, from ${t.proposalId}` : ""}`;
}

function reportLine(r: Report): string {
  const bits = [
    `${r.id} — ${r.kind} — "${r.title}" by ${r.authorRoleId}`,
    r.departmentId ? `dept ${r.departmentId}` : "",
    r.spend ? `spend ${money(r.spend)}` : "",
  ].filter(Boolean);
  const tail = [r.done, r.deviations ? `Deviations: ${r.deviations}` : "", r.needsFromCeo ? `Needs CEO: ${r.needsFromCeo}` : ""]
    .filter(Boolean)
    .join(" | ");
  return `${bits.join(", ")}\n  ${tail}`;
}

/* ----------------------------------------------------------- arg schemas */

const libraryListArgs = z.object({
  type: z.enum(DOCUMENT_TYPES).optional(),
  owner: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
});

const libraryReadArgs = z.object({ id: z.string().min(1) });

const librarySearchArgs = z.object({
  query: z.string().min(1),
  type: z.enum(DOCUMENT_TYPES).optional(),
});

const decisionsListArgs = z.object({}).loose();
const decisionsReadArgs = z.object({ id: z.string().min(1) });

const tasksListArgs = z.object({
  departmentId: z.string().min(1).optional(),
  status: z.enum(TASK_STATUSES).optional(),
});

const reportsListArgs = z.object({
  departmentId: z.string().min(1).optional(),
  kind: z.enum(["task", "periodic"]).optional(),
  limit: z.number().int().positive().max(50).optional(),
});

const escalationsListArgs = z.object({
  status: z.enum(["open", "resolved"]).optional(),
});

const budgetSummaryArgs = z.object({}).loose();

/** Turns a zod failure into the message the model will read. */
function parseArgs<T>(schema: z.ZodType<T>, args: unknown, tool: string): T {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "arguments";
    throw new ContextToolError(`${tool}: bad ${where} — ${issue?.message ?? "invalid"}`);
  }
  return parsed.data;
}

/** JSON Schema for an arguments object, OpenRouter function-calling shape. */
function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

const stringProp = (description: string) => ({ type: "string", description });
const enumProp = (values: readonly string[], description: string) => ({
  type: "string",
  enum: [...values],
  description,
});

/* -------------------------------------------------------------- registry */

export function createContextRegistry(deps: ContextRegistryDeps): ContextRegistry {
  const { store } = deps;
  // Fall back to reading the library out of the log when no service is wired.
  const library = deps.library ?? createLibraryService({ library: eventSourcedLibraryStore(store) });

  async function stateOf(companyId: string): Promise<CompanyState> {
    return store.getState(companyId);
  }

  /** A wrong department id gets a corrective error, not a silent empty result. */
  async function requireDepartment(companyId: string, departmentId: string | undefined) {
    if (!departmentId) return;
    const company = await store.getCompany(companyId);
    const departments = company?.config.departments ?? [];
    if (!departments.some((d) => d.id === departmentId)) {
      const valid = departments.map((d) => `'${d.id}' (${d.name})`).join(", ") || "none";
      throw new ContextToolError(
        `Unknown department '${departmentId}'. This company's departments: ${valid}.`,
      );
    }
  }

  const tools: ContextToolDef[] = [
    /* ------------------------------------------------------------ library */
    {
      name: "library_list",
      description:
        "List the company library's current documents (id, type, title, one-line summary, owner, tags) without their bodies. " +
        "Use this FIRST when you need to know what the company has already written down — standing policies, the company profile, " +
        "finance summaries, past analyses — and you do not yet know which document you want. Filter by type " +
        "(profile, policy, finance, analysis, agreement, note), by owning role, or by tag. Then read the one that matters with library_read.",
      parameters: schema({
        type: enumProp(DOCUMENT_TYPES, "Only documents of this type."),
        owner: stringProp("Only documents owned by this role id, e.g. 'cfo'."),
        tag: stringProp("Only documents carrying this tag."),
      }),
      async run(companyId, args) {
        const a = parseArgs(libraryListArgs, args, "library_list");
        const docs = await library.list(companyId, {
          ...(a.type ? { type: a.type } : {}),
          ...(a.owner ? { ownerRoleId: a.owner } : {}),
          ...(a.tag ? { tag: a.tag } : {}),
          status: "current",
        });
        if (!docs.length) return "The library has no current documents matching that filter.";
        return cap(
          `${docs.length} document(s) in the library:\n\n${docs.map(documentLine).join("\n")}`,
        );
      },
    },
    {
      name: "library_read",
      description:
        "Read one library document in full, body included, by its id (ids come from library_list or library_search). " +
        "Use this before asserting what a policy says, what the company profile claims, or what a past analysis actually found — " +
        "quote the document rather than your assumption about it. Superseded documents can still be read; their status says so.",
      parameters: schema({ id: stringProp("Document id, e.g. 'doc-pricing-policy'.") }, ["id"]),
      async run(companyId, args) {
        const a = parseArgs(libraryReadArgs, args, "library_read");
        const doc = await library.read(companyId, a.id);
        return cap(renderDocument(doc));
      },
    },
    {
      name: "library_search",
      description:
        "Full-text search across library document titles, summaries and bodies; returns matching documents with the passage that matched. " +
        "Use this when you know WHAT you are looking for but not WHERE it is written — 'churn', 'third-party ads', 'CAC payback' — " +
        "and follow up with library_read on the ids worth reading whole. Prefer a few precise words over a sentence.",
      parameters: schema(
        {
          query: stringProp("Words to search for, e.g. 'annual billing churn'."),
          type: enumProp(DOCUMENT_TYPES, "Restrict the search to one document type."),
        },
        ["query"],
      ),
      async run(companyId, args) {
        const a = parseArgs(librarySearchArgs, args, "library_search");
        const hits = await library.search(companyId, a.query, {
          ...(a.type ? { type: a.type } : {}),
          status: "current",
        });
        if (!hits.length) {
          return `Nothing in the library matches "${a.query}". Try library_list to see what exists.`;
        }
        return cap(
          `${hits.length} match(es) for "${a.query}":\n\n${hits.map(renderHit).join("\n")}`,
        );
      },
    },

    /* ---------------------------------------------------- process memory */
    {
      name: "decisions_list",
      description:
        "List the company's past proposals: id, title, status, the CEO's decision, the money at stake, when it was submitted, " +
        "and the topics the board disagreed on. Use this before arguing a question the company may have already decided — " +
        "to check precedent, to avoid re-litigating a settled call, or to point out that a prior decision is about to be contradicted. " +
        "Read one in full with decisions_read.",
      parameters: schema({}),
      async run(companyId, args) {
        parseArgs(decisionsListArgs, args, "decisions_list");
        const state = await stateOf(companyId);
        const proposals = Object.values(state.proposals).sort(
          (a, b) => (submittedAt(state, b.id) ?? 0) - (submittedAt(state, a.id) ?? 0),
        );
        if (!proposals.length) return "No proposals have been made yet — there is no precedent to consult.";
        return cap(
          `${proposals.length} proposal(s), newest first:\n\n${proposals
            .map((p) => proposalLine(p, state))
            .join("\n")}`,
        );
      },
    },
    {
      name: "decisions_read",
      description:
        "Read one past proposal in full: summary, rationale, cost, alternatives, risks, every board member's position and stance, " +
        "the recorded disagreements, and the CEO's note. Use this when precedent matters to the question in front of you — " +
        "what was actually promised, what the objection was, and whether the conditions attached to an approval still hold.",
      parameters: schema({ id: stringProp("Proposal id from decisions_list.") }, ["id"]),
      async run(companyId, args) {
        const a = parseArgs(decisionsReadArgs, args, "decisions_read");
        const state = await stateOf(companyId);
        const p = state.proposals[a.id];
        if (!p) throw new ContextToolError(`No proposal "${a.id}". Use decisions_list for the ids.`);
        return cap(renderProposal(p, state));
      },
    },
    {
      name: "tasks_list",
      description:
        "List the company's tasks with status, owning department, assignee and originating proposal. " +
        "Use this to check what is already in flight or blocked before proposing more work — capacity and half-finished commitments " +
        "are the usual reason a good idea is a bad idea this month. Filter by department or status.",
      parameters: schema({
        departmentId: stringProp("Only tasks of this department, e.g. 'dep-eng'."),
        status: enumProp(TASK_STATUSES, "Only tasks in this status."),
      }),
      async run(companyId, args) {
        const a = parseArgs(tasksListArgs, args, "tasks_list");
        await requireDepartment(companyId, a.departmentId);
        const state = await stateOf(companyId);
        const tasks = Object.values(state.tasks).filter(
          (t) =>
            (!a.departmentId || t.departmentId === a.departmentId) &&
            (!a.status || t.status === a.status),
        );
        if (!tasks.length) return "No tasks match that filter.";
        const open = tasks.filter((t) => t.status !== "done").length;
        return cap(
          `${tasks.length} task(s), ${open} still open:\n\n${tasks.map(taskLine).join("\n")}`,
        );
      },
    },
    {
      name: "reports_list",
      description:
        "List delivery and periodic reports, newest first: what was done, deviations from plan, money spent, and anything the author " +
        "needs from the CEO. Use this to ground a claim about how the last attempt actually went — a channel that already failed, " +
        "an estimate that already slipped — instead of guessing. Filter by department or kind; limit defaults to 10.",
      parameters: schema({
        departmentId: stringProp("Only reports from this department."),
        kind: enumProp(["task", "periodic"], "task = delivery report, periodic = cadence report."),
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many, newest first." },
      }),
      async run(companyId, args) {
        const a = parseArgs(reportsListArgs, args, "reports_list");
        await requireDepartment(companyId, a.departmentId);
        const state = await stateOf(companyId);
        const matching = state.reports.filter(
          (r) =>
            (!a.departmentId || r.departmentId === a.departmentId) && (!a.kind || r.kind === a.kind),
        );
        const picked = matching.slice(-(a.limit ?? 10)).reverse();
        if (!picked.length) return "No reports match that filter.";
        const spent = matching.reduce((sum, r) => sum + (r.spend ?? 0), 0);
        return cap(
          `${picked.length} of ${matching.length} report(s), newest first (reported spend ${money(spent)}):\n\n${picked
            .map(reportLine)
            .join("\n")}`,
        );
      },
    },
    {
      name: "escalations_list",
      description:
        "List escalations raised to the CEO — who raised it, how urgent, the reason, the concrete ask, and the resolution if it was settled. " +
        "Use this to see what is currently stuck waiting on a human decision, and whether the problem you are about to describe " +
        "has already been escalated. Filter by status (open or resolved); default shows both.",
      parameters: schema({
        status: enumProp(["open", "resolved"], "Only escalations in this status."),
      }),
      async run(companyId, args) {
        const a = parseArgs(escalationsListArgs, args, "escalations_list");
        const state = await stateOf(companyId);
        const list = Object.values(state.escalations).filter((e) => !a.status || e.status === a.status);
        if (!list.length) return "No escalations match that filter.";
        return cap(
          `${list.length} escalation(s):\n\n${list
            .map(
              (e) =>
                `${e.id} — ${e.severity.toUpperCase()} from ${e.fromRoleId} [${e.status}]\n  reason: ${e.reason}\n  ask: ${e.ask}` +
                (e.resolution ? `\n  resolution: ${e.resolution}` : ""),
            )
            .join("\n")}`,
        );
      },
    },
    {
      name: "budget_summary",
      description:
        "The company's money right now: the monthly budget, how much has been spent against it, what is left, and the spend broken down " +
        "by category. Use this before putting a number on anything — 'we can afford it' and 'that is a third of the month's budget' " +
        "are different arguments, and only one of them is checkable.",
      parameters: schema({}),
      async run(companyId, args) {
        parseArgs(budgetSummaryArgs, args, "budget_summary");
        const company = await store.getCompany(companyId);
        if (!company) throw new ContextToolError(`No company "${companyId}".`);
        const state = await stateOf(companyId);
        const budget = company.config.monthlyBudget;
        const remaining = budget - state.spent;
        const categories = Object.entries(state.spendByCategory).sort((a, b) => b[1] - a[1]);
        const lines = [
          `Monthly budget: ${money(budget)} ${company.config.currency}`,
          `Spent so far: ${money(state.spent)} (${budget ? Math.round((state.spent / budget) * 100) : 0}% of budget)`,
          `Remaining: ${money(remaining)}`,
        ];
        if (categories.length) {
          lines.push("", "By category:", ...categories.map(([c, n]) => `- ${c}: ${money(n)}`));
        } else {
          lines.push("", "No categorised spend recorded yet.");
        }
        return cap(lines.join("\n"));
      },
    },
  ];

  const byName = new Map(tools.map((t) => [t.name, t]));

  return {
    // Phase 1: every board role gets the same read-only set. Per-role
    // allowlists are a role-manifest concern and land with the manifests.
    toolsFor: () => tools,

    async run(companyId, _roleId, name, args) {
      const tool = byName.get(name);
      if (!tool) {
        throw new ContextToolError(
          `Unknown context tool: ${name}. Available: ${tools.map((t) => t.name).join(", ")}`,
        );
      }
      return tool.run(companyId, args);
    },
  };
}
