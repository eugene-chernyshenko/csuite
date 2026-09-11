import type {
  Disagreement,
  Escalation,
  Id,
  Position,
  Proposal,
  Report,
  Task,
  TaskStatus,
} from "./types";

export type CeoDecision = "approved" | "returned" | "rejected";

/** What an agent is visibly doing on the Floor */
export type Activity =
  | "idle"
  | "thinking"
  | "writing"
  | "coding"
  | "reviewing"
  | "analyzing"
  | "meeting";

interface EventBase {
  id: Id;
  /** Scenario time: minutes since 09:00 (0..540). May be fractional. */
  ts: number;
  /**
   * Conditional branch: only applied if the CEO's actual decision on the
   * proposal matches. Lets one scenario script both outcomes.
   */
  when?: { proposalId: Id; decision: CeoDecision };
}

export type CompanyEvent = EventBase &
  (
    | { type: "day_started" }
    | { type: "worklog"; roleId: Id; activity: Activity; note?: string }
    | { type: "message_sent"; fromRoleId: Id; toRoleId: Id; gist: string }
    | { type: "drafting_started"; proposalId: Id; authorRoleId: Id; title: string }
    | { type: "position_submitted"; proposalId: Id; position: Position }
    | { type: "disagreement_recorded"; proposalId: Id; disagreement: Disagreement }
    /** The complete document lands in the CEO inbox (includes positions/disagreements) */
    | { type: "proposal_submitted"; proposal: Proposal }
    /**
     * CEO decision. In the scenario these carry `auto: true` and are applied
     * only when autopilot is on; a live click in the Desk appends the same
     * event without `auto`.
     */
    | { type: "ceo_decision"; proposalId: Id; decision: CeoDecision; note?: string; auto?: boolean }
    | { type: "tasks_created"; proposalId?: Id; tasks: Task[] }
    | { type: "task_status_changed"; taskId: Id; status: TaskStatus; byRoleId?: Id }
    | { type: "report_submitted"; report: Report }
    | { type: "escalation_raised"; escalation: Escalation }
    | { type: "escalation_resolved"; escalationId: Id; resolution: string; auto?: boolean }
    | { type: "budget_spent"; amount: number; category: string; departmentId?: Id; note?: string }
    | { type: "day_ended" }
  );

export type CompanyEventType = CompanyEvent["type"];

export const DAY_MINUTES = 540; // 09:00 → 18:00

export function clock(ts: number): string {
  const m = Math.max(0, Math.min(DAY_MINUTES, Math.floor(ts)));
  const h = Math.floor(m / 60) + 9;
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h.toString().padStart(2, "0")}:${mm}`;
}
