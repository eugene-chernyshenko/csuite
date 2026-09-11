/**
 * Desk-local helpers: semantic tone mapping, role lookup, formatting and the
 * derivation of the CEO inbox from current state. Everything here is a pure
 * function of the state it is handed — the day can be scrubbed backwards and
 * entities may vanish, so nothing is cached across renders.
 */

import type {
  Department,
  Escalation,
  Id,
  Proposal,
  ProposalStatus,
  Role,
  Stance,
  Task,
  TaskStatus,
  CompanyEvent,
} from "@csuite/contract";
import type { useTranslations } from "next-intl";

/** The bound translator handed down from `useTranslations` — passed in rather
 * than called here, since these are plain functions, not components. */
type T = ReturnType<typeof useTranslations>;

/* ------------------------------------------------------------------ tone */

/** The four semantic colors of the design system, plus a neutral fallback. */
export type Tone = "sign" | "pencil" | "ledger" | "hold" | "neutral";

/**
 * CSS variable for a tone. Used inline for rails, dots and stamps so the
 * colour never depends on Tailwind class-ordering for border longhands.
 */
export function toneVar(tone: Tone): string {
  switch (tone) {
    case "sign":
      return "var(--color-sign)";
    case "pencil":
      return "var(--color-pencil)";
    case "ledger":
      return "var(--color-ledger)";
    case "hold":
      return "var(--color-hold)";
    default:
      return "var(--color-ink-soft)";
  }
}

export function toneText(tone: Tone): string {
  switch (tone) {
    case "sign":
      return "text-sign";
    case "pencil":
      return "text-pencil";
    case "ledger":
      return "text-ledger";
    case "hold":
      return "text-hold";
    default:
      return "text-ink-soft";
  }
}

/* ----------------------------------------------------------------- roles */

export type RoleMap = Record<Id, Role>;

export function buildRoleMap(roles: readonly Role[]): RoleMap {
  const map: RoleMap = {};
  for (const r of roles) map[r.id] = r;
  return map;
}

/** Never throws on an unknown id — a scrubbed-away role still renders. */
export function roleName(t: T, roles: RoleMap, id: Id | undefined): string {
  if (!id) return t("common.unassigned");
  return roles[id]?.name ?? id;
}

export function roleTitle(roles: RoleMap, id: Id | undefined): string {
  if (!id) return "";
  return roles[id]?.title ?? "";
}

export function departmentName(departments: readonly Department[], id: Id | undefined): string {
  if (!id) return "";
  return departments.find((d) => d.id === id)?.name ?? id;
}

/* ------------------------------------------------------------ formatting */

export function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** "12% of the monthly budget" — omitted when the budget is unknown. */
export function shareOfBudget(t: T, amount: number, monthlyBudget: number): string | null {
  if (!monthlyBudget || monthlyBudget <= 0) return null;
  const pct = Math.round((amount / monthlyBudget) * 100);
  if (pct <= 0) return null;
  return t("desk.shareOfBudget", { pct });
}

/** Split a rationale into paragraphs on blank lines; always returns ≥1 entry. */
export function paragraphs(text: string): string[] {
  const parts = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

/* ---------------------------------------------------------------- stance */

export function stanceTone(stance: Stance): Tone {
  switch (stance) {
    case "support":
      return "ledger";
    case "support_with_conditions":
      return "hold";
    case "object":
      return "pencil";
    default:
      return "neutral";
  }
}

export function stanceLabel(t: T, stance: Stance): string {
  switch (stance) {
    case "support":
      return t("desk.stance.support");
    case "support_with_conditions":
      return t("desk.stance.supportWithConditions");
    case "object":
      return t("desk.stance.object");
    default:
      return t("desk.stance.filed");
  }
}

/* -------------------------------------------------------- proposal status */

export function proposalTone(status: ProposalStatus): Tone {
  switch (status) {
    case "pending_approval":
    case "returned":
      return "hold";
    case "approved":
    case "in_progress":
      return "sign";
    case "delivered":
      return "ledger";
    case "rejected":
      return "pencil";
    default:
      return "neutral";
  }
}

/** Short label for the inbox line. */
export function proposalStatusLabel(t: T, status: ProposalStatus): string {
  switch (status) {
    case "drafting":
      return t("desk.status.drafting");
    case "pending_approval":
      return t("desk.status.pendingApproval");
    case "approved":
      return t("desk.status.approved");
    case "in_progress":
      return t("desk.status.inProgress");
    case "delivered":
      return t("desk.status.delivered");
    case "returned":
      return t("desk.status.returned");
    case "rejected":
      return t("desk.status.rejected");
    default:
      return status;
  }
}

/** The word that lands in the stamp once a proposal has been decided. */
export function stampLabel(t: T, status: ProposalStatus): string | null {
  switch (status) {
    case "approved":
    case "in_progress":
      return t("desk.stamp.approved");
    case "delivered":
      return t("desk.stamp.delivered");
    case "returned":
      return t("desk.stamp.returned");
    case "rejected":
      return t("desk.stamp.rejected");
    default:
      return null;
  }
}

export function isDecided(status: ProposalStatus): boolean {
  return status === "approved" || status === "in_progress" || status === "delivered" ||
    status === "returned" || status === "rejected";
}

/* ------------------------------------------------------------ task status */

export function taskTone(status: TaskStatus): Tone {
  switch (status) {
    case "done":
      return "ledger";
    case "in_progress":
      return "sign";
    case "in_review":
      return "hold";
    case "blocked":
      return "pencil";
    default:
      return "neutral";
  }
}

export function taskStatusLabel(t: T, status: TaskStatus): string {
  switch (status) {
    case "todo":
      return t("common.taskStatus.todo");
    case "in_progress":
      return t("common.taskStatus.inProgress");
    case "in_review":
      return t("common.taskStatus.inReview");
    case "blocked":
      return t("common.taskStatus.blocked");
    case "done":
      return t("common.taskStatus.done");
    default:
      return status;
  }
}

/* ------------------------------------------------------------- timestamps */

export interface DeskTimes {
  /** proposalId → ts of proposal_submitted */
  submitted: Record<Id, number>;
  /** proposalId → ts of the CEO decision */
  decided: Record<Id, number>;
  /** escalationId → ts raised */
  raised: Record<Id, number>;
  /** escalationId → ts resolved */
  resolved: Record<Id, number>;
}

/** One pass over the applied feed; everything the Desk needs to date a document. */
export function readTimes(feed: readonly CompanyEvent[]): DeskTimes {
  const times: DeskTimes = { submitted: {}, decided: {}, raised: {}, resolved: {} };
  for (const ev of feed) {
    switch (ev.type) {
      case "drafting_started":
        times.submitted[ev.proposalId] ??= ev.ts;
        break;
      case "proposal_submitted":
        times.submitted[ev.proposal.id] = ev.ts;
        break;
      case "ceo_decision":
        times.decided[ev.proposalId] = ev.ts;
        break;
      case "escalation_raised":
        times.raised[ev.escalation.id] = ev.ts;
        break;
      case "escalation_resolved":
        times.resolved[ev.escalationId] = ev.ts;
        break;
      default:
        break;
    }
  }
  return times;
}

/* ------------------------------------------------------------------ inbox */

export type ItemKind = "escalation" | "proposal";

export interface InboxItem {
  key: string;
  kind: ItemKind;
  id: Id;
  title: string;
  authorRoleId: Id;
  statusLabel: string;
  tone: Tone;
  /** Needs a decision from the CEO right now */
  needsYou: boolean;
  severity?: Escalation["severity"];
  /** Scenario minutes, for the inbox timestamp and ordering */
  ts: number;
}

export function itemKey(kind: ItemKind, id: Id): string {
  return `${kind}:${id}`;
}

/**
 * The inbox, ordered by urgency:
 *   1. open escalations (urgent before attention, newest first)
 *   2. proposals waiting for approval (newest first)
 *   3. everything else, newest activity first — the quiet history
 */
export function buildInbox(
  t: T,
  proposals: Record<Id, Proposal>,
  escalations: Record<Id, Escalation>,
  times: DeskTimes,
): InboxItem[] {
  const open: InboxItem[] = [];
  const pending: InboxItem[] = [];
  const history: InboxItem[] = [];

  for (const e of Object.values(escalations)) {
    const raised = times.raised[e.id] ?? 0;
    if (e.status === "open") {
      open.push({
        key: itemKey("escalation", e.id),
        kind: "escalation",
        id: e.id,
        title: e.reason,
        authorRoleId: e.fromRoleId,
        statusLabel:
          e.severity === "urgent"
            ? t("desk.escalationStatus.urgent")
            : t("desk.escalationStatus.attention"),
        tone: "pencil",
        needsYou: true,
        severity: e.severity,
        ts: raised,
      });
    } else {
      history.push({
        key: itemKey("escalation", e.id),
        kind: "escalation",
        id: e.id,
        title: e.reason,
        authorRoleId: e.fromRoleId,
        statusLabel: t("desk.escalationStatus.resolved"),
        tone: "ledger",
        needsYou: false,
        severity: e.severity,
        ts: times.resolved[e.id] ?? raised,
      });
    }
  }

  for (const p of Object.values(proposals)) {
    const submitted = times.submitted[p.id] ?? 0;
    const item: InboxItem = {
      key: itemKey("proposal", p.id),
      kind: "proposal",
      id: p.id,
      title: p.title,
      authorRoleId: p.authorRoleId,
      statusLabel: proposalStatusLabel(t, p.status),
      tone: proposalTone(p.status),
      needsYou: p.status === "pending_approval",
      ts: p.status === "pending_approval" ? submitted : (times.decided[p.id] ?? submitted),
    };
    if (item.needsYou) pending.push(item);
    else history.push(item);
  }

  const severityRank = (s?: Escalation["severity"]) => (s === "urgent" ? 1 : 0);
  open.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.ts - a.ts);
  pending.sort((a, b) => b.ts - a.ts);
  history.sort((a, b) => b.ts - a.ts);

  return [...open, ...pending, ...history];
}

export function tasksForProposal(tasks: Record<Id, Task>, proposalId: Id): Task[] {
  return Object.values(tasks).filter((t) => t.proposalId === proposalId);
}
