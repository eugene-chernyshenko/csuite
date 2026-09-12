/**
 * The pure event reducer: `CompanyEvent[]` → `CompanyState`.
 *
 * The event log is the source of truth (docs/en/ARCHITECTURE.md); every other
 * view of the company is a fold over it. This file is that fold, and it is
 * shared verbatim between the demo simulation and the platform server so the
 * two can never drift.
 *
 * Deliberately *not* here: the demo's timeline machinery (autopilot gating,
 * `when`-branch resolution, merging a scripted script with live clicks). That
 * is simulation policy, it lives in `web/src/lib/store.ts`, and it is built on
 * top of `apply()`.
 */

import type {
  Clarification,
  Document,
  Escalation,
  Id,
  Position,
  Proposal,
  Report,
  Task,
} from "./types";
import type { Activity, CeoDecision, CompanyEvent } from "./events";

export interface CompanyState {
  proposals: Record<Id, Proposal>;
  /** Positions seen so far while a proposal is still drafting (Floor ambience) */
  draftPositions: Record<Id, Position[]>;
  tasks: Record<Id, Task>;
  reports: Report[];
  escalations: Record<Id, Escalation>;
  /**
   * The company library, current *and* superseded — a superseded document is
   * still readable, it just no longer counts as true. Callers that want only
   * live documents filter on `status === "current"`.
   */
  documents: Record<Id, Document>;
  /**
   * Clarification rounds the Chief of Staff opened on the CEO's questions. An
   * open one is a board run parked mid-flight, waiting on the desk; a company
   * with no `staff` role never has any.
   */
  clarifications: Record<Id, Clarification>;
  decisions: Record<Id, CeoDecision>;
  spent: number;
  spendByCategory: Record<string, number>;
  activity: Record<Id, { activity: Activity; note?: string }>;
  /** Applied events, oldest first */
  feed: CompanyEvent[];
}

export function emptyState(): CompanyState {
  return {
    proposals: {},
    draftPositions: {},
    tasks: {},
    reports: [],
    escalations: {},
    documents: {},
    clarifications: {},
    decisions: {},
    spent: 0,
    spendByCategory: {},
    activity: {},
    feed: [],
  };
}

/** Applies one event to `state` in place. Must stay total and side-effect free. */
export function apply(state: CompanyState, ev: CompanyEvent): void {
  state.feed.push(ev);
  switch (ev.type) {
    case "worklog":
      state.activity[ev.roleId] = { activity: ev.activity, note: ev.note };
      break;
    case "position_submitted": {
      const list = (state.draftPositions[ev.proposalId] ??= []);
      list.push(ev.position);
      break;
    }
    case "proposal_submitted":
      state.proposals[ev.proposal.id] = { ...ev.proposal, status: "pending_approval" };
      break;
    case "ceo_decision": {
      const p = state.proposals[ev.proposalId];
      if (p) {
        p.status = ev.decision === "approved" ? "in_progress" : ev.decision;
        p.ceoNote = ev.note;
      }
      state.decisions[ev.proposalId] = ev.decision;
      break;
    }
    case "tasks_created":
      for (const t of ev.tasks) state.tasks[t.id] = { ...t };
      break;
    case "task_status_changed": {
      const t = state.tasks[ev.taskId];
      if (t) t.status = ev.status;
      break;
    }
    case "report_submitted": {
      state.reports.push(ev.report);
      if (ev.report.spend) {
        state.spent += ev.report.spend;
      }
      const pid = ev.report.taskId ? state.tasks[ev.report.taskId]?.proposalId : undefined;
      if (pid) {
        const p = state.proposals[pid];
        const allDone =
          p &&
          Object.values(state.tasks)
            .filter((t) => t.proposalId === pid)
            .every((t) => t.status === "done");
        if (p && allDone) p.status = "delivered";
      }
      break;
    }
    case "clarification_requested":
      state.clarifications[ev.id] = {
        id: ev.id,
        questionText: ev.questionText,
        byRoleId: ev.byRoleId,
        questions: [...ev.questions],
        status: "open",
      };
      break;
    case "clarification_answered": {
      const c = state.clarifications[ev.clarificationId];
      if (c) {
        c.answers = ev.answers;
        c.status = "answered";
      }
      break;
    }
    case "escalation_raised":
      state.escalations[ev.escalation.id] = { ...ev.escalation };
      break;
    case "escalation_resolved": {
      const e = state.escalations[ev.escalationId];
      if (e) {
        e.status = "resolved";
        e.resolution = ev.resolution;
      }
      break;
    }
    case "budget_spent":
      state.spent += ev.amount;
      state.spendByCategory[ev.category] =
        (state.spendByCategory[ev.category] ?? 0) + ev.amount;
      break;
    case "document_created":
    case "document_updated":
      // Both are upserts: the event carries the whole document, so the latest
      // one wins and the log keeps the versions.
      state.documents[ev.document.id] = { ...ev.document };
      break;
    case "document_superseded": {
      const d = state.documents[ev.documentId];
      if (d) {
        d.status = "superseded";
        if (ev.by !== undefined) d.supersededBy = ev.by;
        // Retiring a document is a write to it, so it moves in the library's
        // "most recently touched" order like any other.
        d.updatedAt = ev.ts;
      }
      break;
    }
    // `context_consulted` is provenance, not state: it belongs in the feed
    // (which every event already joined above) and nowhere else.
    default:
      break;
  }
}

/**
 * Folds a durable, already-ordered event log into the company's state.
 *
 * This is the server's reduction: an append-only log has no branches to
 * resolve and no autopilot to consult — everything in it happened.
 */
export function reduce(events: readonly CompanyEvent[]): CompanyState {
  const state = emptyState();
  for (const ev of events) apply(state, ev);
  return state;
}
