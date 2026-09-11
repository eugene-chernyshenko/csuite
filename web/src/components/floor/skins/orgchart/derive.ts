import type { CompanyEvent } from "@/lib/contract/events";
import type {
  CompanyConfig,
  Id,
  Proposal,
  Stance,
  Task,
  TaskStatus,
} from "@/lib/contract/types";

/**
 * Everything the Floor animates is derived here, as a pure function of
 * (feed, simTime, speed). Nothing accumulates across renders, so scrubbing the
 * day backwards produces exactly the same picture as playing forwards to it.
 */

/** Window lengths in *real* seconds; converted to sim-minutes via speed. */
const SECONDS = {
  travel: 2.8,
  message: 1.5,
  flash: 1.7,
  deliberation: 8,
  taskEnter: 1.2,
} as const;

export const TRAVEL_DURATION = 2.1;
export const MESSAGE_DURATION = 1.1;

function win(seconds: number, speed: number) {
  return Math.max(0.35, seconds * (speed || 1));
}

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
  feed: CompanyEvent[],
  simTime: number,
  speed: number,
  proposals: Record<Id, Proposal>,
  roleDept: Record<Id, Id | undefined>,
  ceoRoleId: Id | undefined,
): Moments {
  if (feed.length === 0 || !ceoRoleId) return EMPTY;

  const wTravel = win(SECONDS.travel, speed);
  const wMessage = win(SECONDS.message, speed);
  const wFlash = win(SECONDS.flash, speed);
  const wDelib = win(SECONDS.deliberation, speed);
  const wEnter = win(SECONDS.taskEnter, speed);
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
            text: `Disagrees on ${ev.disagreement.topic}`,
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
          title: proposals[ev.proposalId]?.title ?? "Decision",
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

const STANCE_VERB: Record<Stance, string> = {
  support: "supports",
  support_with_conditions: "supports with conditions",
  object: "objects",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  blocked: "Blocked",
  done: "Done",
};

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
  feed: CompanyEvent[],
  config: CompanyConfig,
  proposals: Record<Id, Proposal>,
  tasks: Record<Id, Task>,
  count = 4,
): FeedLine[] {
  const nameOf = (id: Id) => config.roles.find((r) => r.id === id)?.name ?? id;
  const deptOf = (id?: Id) => config.departments.find((d) => d.id === id)?.name ?? "the company";

  const out: FeedLine[] = [];
  for (let i = feed.length - 1; i >= 0 && out.length < count; i--) {
    const ev = feed[i];
    if (!isNotable(ev)) continue;
    let text = "";
    let tone: Tone = "ink";
    switch (ev.type) {
      case "day_started":
        text = "The day started";
        break;
      case "day_ended":
        text = "The day ended";
        break;
      case "message_sent":
        text = `${nameOf(ev.fromRoleId)} → ${nameOf(ev.toRoleId)}: ${ev.gist}`;
        break;
      case "drafting_started":
        text = `${nameOf(ev.authorRoleId)} started drafting “${ev.title}”`;
        break;
      case "position_submitted":
        text = `${nameOf(ev.position.roleId)} ${STANCE_VERB[ev.position.stance]}: ${ev.position.summary}`;
        tone = ev.position.stance === "object" ? "pencil" : "ink";
        break;
      case "disagreement_recorded":
        text = `Disagreement on ${ev.disagreement.topic}`;
        tone = "pencil";
        break;
      case "proposal_submitted":
        text = `${nameOf(ev.proposal.authorRoleId)} submitted “${ev.proposal.title}”`;
        tone = "hold";
        break;
      case "ceo_decision": {
        const title = proposals[ev.proposalId]?.title ?? "the proposal";
        const verb =
          ev.decision === "approved"
            ? "approved"
            : ev.decision === "rejected"
              ? "rejected"
              : "returned";
        text = `You ${verb} “${title}”`;
        tone = ev.decision === "approved" ? "sign" : ev.decision === "rejected" ? "pencil" : "hold";
        break;
      }
      case "tasks_created": {
        const n = ev.tasks.length;
        const oneDept = ev.tasks.every((t) => t.departmentId === ev.tasks[0]?.departmentId);
        text = `${n} task${n === 1 ? "" : "s"} created${
          oneDept ? ` in ${deptOf(ev.tasks[0]?.departmentId)}` : ""
        }`;
        tone = "sign";
        break;
      }
      case "task_status_changed": {
        const t = tasks[ev.taskId];
        text = `${t?.title ?? "Task"} — ${TASK_STATUS_LABEL[ev.status].toLowerCase()}`;
        tone = ev.status === "blocked" ? "pencil" : ev.status === "done" ? "ledger" : "ink";
        break;
      }
      case "report_submitted":
        text = `${nameOf(ev.report.authorRoleId)} filed “${ev.report.title}”`;
        tone = "ledger";
        break;
      case "escalation_raised":
        text = `${nameOf(ev.escalation.fromRoleId)} escalated: ${ev.escalation.reason}`;
        tone = "pencil";
        break;
      case "escalation_resolved":
        text = `Escalation resolved: ${ev.resolution}`;
        tone = "ledger";
        break;
      case "budget_spent":
        text = `Spent $${ev.amount.toLocaleString("en-US")} on ${ev.category}`;
        tone = "ink";
        break;
      default:
        continue;
    }
    out.push({ id: ev.id, ts: ev.ts, text, tone });
  }
  return out;
}
