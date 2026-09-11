import type {
  CompanyEvent,
  CompanyConfig,
  Id,
  Proposal,
  Stance,
  Task,
} from "@csuite/contract";
import type { useTranslations } from "next-intl";
import { taskStatusLabel } from "@/components/desk/util";
import type { TimeScale } from "@/lib/time";

/** The bound translator handed down from `useTranslations` — passed in rather
 * than called here, since these are plain functions, not components. */
type T = ReturnType<typeof useTranslations>;

/**
 * Everything the Floor animates is derived here, as a pure function of
 * (feed, now, time, speed). Nothing accumulates across renders, so scrubbing
 * the day backwards produces exactly the same picture as playing forwards to
 * it — and in live mode, where time only moves forward, that costs nothing.
 *
 * `now` and every event `ts` are in the stream's own unit (sim-minutes in demo,
 * epoch milliseconds in live); the `TimeScale` handed in is what converts a
 * window written in real seconds into that unit. Nothing below assumes either.
 */

/** Window lengths in *real* seconds; converted to stream units by `TimeScale`. */
const SECONDS = {
  travel: 2.8,
  message: 1.5,
  flash: 1.7,
  deliberation: 8,
  taskEnter: 1.2,
} as const;

export const TRAVEL_DURATION = 2.1;
export const MESSAGE_DURATION = 1.1;

export type Tone = "sign" | "pencil" | "ledger" | "hold" | "ink";

const STANCE_TONE: Record<Stance, Tone> = {
  support: "ledger",
  support_with_conditions: "hold",
  object: "pencil",
};

export interface TravelMoment {
  key: string;
  kind: "proposal" | "decision" | "report";
  from: Id;
  to: Id;
  tone: Tone;
  title: string;
  /** 0..1 — how far through its window this moment is, for stagger-free replay */
  born: number;
}

export interface MessageMoment {
  key: string;
  from: Id;
  to: Id;
  gist: string;
}

export interface Deliberation {
  key: string;
  stance?: Stance;
  tone: Tone;
  text: string;
}

export interface Moments {
  travels: TravelMoment[];
  messages: MessageMoment[];
  /** board members currently making their case */
  deliberations: Record<Id, Deliberation>;
  /** roleId → flash key (escalation raised) */
  nodeFlash: Record<Id, string>;
  /** departmentId → flash key */
  deptFlash: Record<Id, string>;
  /** taskId → flash key (just blocked) */
  taskFlash: Record<Id, string>;
  /** taskId → key for the chip's entrance */
  taskEnter: Record<Id, string>;
}

const EMPTY: Moments = {
  travels: [],
  messages: [],
  deliberations: {},
  nodeFlash: {},
  deptFlash: {},
  taskFlash: {},
  taskEnter: {},
};

/** First index whose ts >= `from` (feed is sorted ascending). */
function lowerBound(feed: CompanyEvent[], from: number): number {
  let lo = 0;
  let hi = feed.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (feed[mid].ts < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function deriveMoments(
  t: T,
  feed: CompanyEvent[],
  simTime: number,
  time: TimeScale,
  speed: number,
  proposals: Record<Id, Proposal>,
  roleDept: Record<Id, Id | undefined>,
  ceoRoleId: Id | undefined,
): Moments {
  if (feed.length === 0 || !ceoRoleId) return EMPTY;

  const win = (seconds: number) => time.window(seconds, speed);
  const wTravel = win(SECONDS.travel);
  const wMessage = win(SECONDS.message);
  const wFlash = win(SECONDS.flash);
  const wDelib = win(SECONDS.deliberation);
  const wEnter = win(SECONDS.taskEnter);
  const widest = Math.max(wTravel, wMessage, wFlash, wDelib, wEnter);

  const start = lowerBound(feed, simTime - widest);
  const m: Moments = {
    travels: [],
    messages: [],
    deliberations: {},
    nodeFlash: {},
    deptFlash: {},
    taskFlash: {},
    taskEnter: {},
  };

  const authorOf = (proposalId: Id): Id | undefined => proposals[proposalId]?.authorRoleId;

  for (let i = start; i < feed.length; i++) {
    const ev = feed[i];
    if (ev.ts > simTime) break;
    const age = simTime - ev.ts;

    switch (ev.type) {
      case "position_submitted": {
        if (age > wDelib) break;
        m.deliberations[ev.position.roleId] = {
          key: ev.id,
          stance: ev.position.stance,
          tone: STANCE_TONE[ev.position.stance] ?? "hold",
          text: ev.position.summary,
        };
        break;
      }
      case "disagreement_recorded": {
        if (age > wDelib) break;
        for (const rid of ev.disagreement.roleIds) {
          m.deliberations[rid] = {
            key: ev.id,
            tone: "pencil",
            text: t("floor.disagreesOn", { topic: ev.disagreement.topic }),
          };
        }
        break;
      }
      case "proposal_submitted": {
        if (age > wTravel) break;
        m.travels.push({
          key: ev.id,
          kind: "proposal",
          from: ev.proposal.authorRoleId,
          to: ceoRoleId,
          tone: "hold",
          title: ev.proposal.title,
          born: age / wTravel,
        });
        break;
      }
      case "ceo_decision": {
        if (age > wTravel) break;
        const to = authorOf(ev.proposalId);
        if (!to) break;
        m.travels.push({
          key: ev.id,
          kind: "decision",
          from: ceoRoleId,
          to,
          tone:
            ev.decision === "approved" ? "sign" : ev.decision === "rejected" ? "pencil" : "hold",
          title: proposals[ev.proposalId]?.title ?? t("floor.decisionFallback"),
          born: age / wTravel,
        });
        break;
      }
      case "report_submitted": {
        if (age > wTravel) break;
        m.travels.push({
          key: ev.id,
          kind: "report",
          from: ev.report.authorRoleId,
          to: ceoRoleId,
          tone: "ledger",
          title: ev.report.title,
          born: age / wTravel,
        });
        break;
      }
      case "message_sent": {
        if (age > wMessage) break;
        m.messages.push({ key: ev.id, from: ev.fromRoleId, to: ev.toRoleId, gist: ev.gist });
        break;
      }
      case "escalation_raised": {
        if (age > wFlash) break;
        m.nodeFlash[ev.escalation.fromRoleId] = ev.id;
        const d = roleDept[ev.escalation.fromRoleId];
        if (d) m.deptFlash[d] = ev.id;
        break;
      }
      case "tasks_created": {
        if (age > wEnter) break;
        for (const t of ev.tasks) m.taskEnter[t.id] = ev.id;
        break;
      }
      case "task_status_changed": {
        if (ev.status !== "blocked" || age > wFlash) break;
        m.taskFlash[ev.taskId] = ev.id;
        break;
      }
      default:
        break;
    }
  }

  return m;
}

// ---------------------------------------------------------------------------
// Feed strip copy
// ---------------------------------------------------------------------------

/** Present-tense verbs throughout — Russian past tense would need a gender we
 * don't know for agent names, present tense sidesteps that entirely. */
function stanceVerb(t: T, stance: Stance): string {
  switch (stance) {
    case "support":
      return t("floor.stanceVerb.support");
    case "support_with_conditions":
      return t("floor.stanceVerb.supportWithConditions");
    case "object":
      return t("floor.stanceVerb.object");
    default:
      return stance;
  }
}

export interface FeedLine {
  id: string;
  ts: number;
  text: string;
  tone: Tone;
}

/** Events worth a line in the "now" strip — worklogs are ambience, not news. */
function isNotable(ev: CompanyEvent): boolean {
  return ev.type !== "worklog";
}

export function deriveFeedLines(
  t: T,
  feed: CompanyEvent[],
  config: CompanyConfig,
  proposals: Record<Id, Proposal>,
  tasks: Record<Id, Task>,
  count = 4,
): FeedLine[] {
  const nameOf = (id: Id) => config.roles.find((r) => r.id === id)?.name ?? id;
  const deptOf = (id?: Id) =>
    config.departments.find((d) => d.id === id)?.name ?? t("floor.feed.unknownDept");

  const out: FeedLine[] = [];
  for (let i = feed.length - 1; i >= 0 && out.length < count; i--) {
    const ev = feed[i];
    if (!isNotable(ev)) continue;
    let text = "";
    let tone: Tone = "ink";
    switch (ev.type) {
      case "day_started":
        text = t("floor.feed.dayStarted");
        break;
      case "day_ended":
        text = t("floor.feed.dayEnded");
        break;
      case "message_sent":
        text = t("floor.feed.messageSent", {
          from: nameOf(ev.fromRoleId),
          to: nameOf(ev.toRoleId),
          gist: ev.gist,
        });
        break;
      case "drafting_started":
        text = t("floor.feed.draftingStarted", { name: nameOf(ev.authorRoleId), title: ev.title });
        break;
      case "position_submitted":
        text = t("floor.feed.positionSubmitted", {
          name: nameOf(ev.position.roleId),
          stance: stanceVerb(t, ev.position.stance),
          summary: ev.position.summary,
        });
        tone = ev.position.stance === "object" ? "pencil" : "ink";
        break;
      case "disagreement_recorded":
        text = t("floor.feed.disagreement", { topic: ev.disagreement.topic });
        tone = "pencil";
        break;
      case "proposal_submitted":
        text = t("floor.feed.proposalSubmitted", {
          name: nameOf(ev.proposal.authorRoleId),
          title: ev.proposal.title,
        });
        tone = "hold";
        break;
      case "ceo_decision": {
        const title = proposals[ev.proposalId]?.title ?? t("floor.feed.proposalFallback");
        const verbKey =
          ev.decision === "approved"
            ? "floor.feed.decisionVerb.approved"
            : ev.decision === "rejected"
              ? "floor.feed.decisionVerb.rejected"
              : "floor.feed.decisionVerb.returned";
        text = t("floor.feed.decision", { verb: t(verbKey), title });
        tone = ev.decision === "approved" ? "sign" : ev.decision === "rejected" ? "pencil" : "hold";
        break;
      }
      case "tasks_created": {
        const n = ev.tasks.length;
        const oneDept = ev.tasks.every((task) => task.departmentId === ev.tasks[0]?.departmentId);
        text = oneDept
          ? t("floor.feed.tasksCreatedInDept", {
              count: n,
              dept: deptOf(ev.tasks[0]?.departmentId),
            })
          : t("floor.feed.tasksCreated", { count: n });
        tone = "sign";
        break;
      }
      case "task_status_changed": {
        const task = tasks[ev.taskId];
        text = t("floor.feed.taskStatusChanged", {
          title: task?.title ?? t("floor.feed.taskFallback"),
          status: taskStatusLabel(t, ev.status).toLowerCase(),
        });
        tone = ev.status === "blocked" ? "pencil" : ev.status === "done" ? "ledger" : "ink";
        break;
      }
      case "report_submitted":
        text = t("floor.feed.reportSubmitted", {
          name: nameOf(ev.report.authorRoleId),
          title: ev.report.title,
        });
        tone = "ledger";
        break;
      case "escalation_raised":
        text = t("floor.feed.escalationRaised", {
          name: nameOf(ev.escalation.fromRoleId),
          reason: ev.escalation.reason,
        });
        tone = "pencil";
        break;
      case "escalation_resolved":
        text = t("floor.feed.escalationResolved", { resolution: ev.resolution });
        tone = "ledger";
        break;
      case "budget_spent":
        text = t("floor.feed.budgetSpent", {
          amount: `$${ev.amount.toLocaleString("en-US")}`,
          category: ev.category,
        });
        tone = "ink";
        break;
      default:
        continue;
    }
    out.push({ id: ev.id, ts: ev.ts, text, tone });
  }
  return out;
}
