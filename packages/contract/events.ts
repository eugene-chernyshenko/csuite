import type {
  Disagreement,
  Document,
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
  /**
   * Time in the company's own timeline — a semantic clock, not a wall clock,
   * and deliberately *not* two types.
   *
   * The only invariants the contract asserts are: it is a number, it increases
   * along the timeline, and every consumer of a given event stream reads it in
   * the same unit. What that unit is belongs to whoever produces the stream:
   *
   * - demo/simulation (`web`): sim-minutes since 09:00, `0..DAY_MINUTES`, may
   *   be fractional — `clock()` below formats exactly this;
   * - platform server: epoch milliseconds (`Date.now()`).
   *
   * So `clock()` is a *demo* helper, and anything rendering a real company's
   * stream must format `ts` as a date instead. Forking this into two types
   * would fork the whole event union with it; the reducer does not care, and
   * neither should the shapes.
   */
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
    /**
     * A strategic question put to the company — the input that wakes the board.
     * `byRoleId` is the asker; for a question from the CEO desk that is the
     * human CEO's role id (the CEO is a user, never an agent).
     */
    | { type: "question_asked"; text: string; byRoleId: Id }
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
    /* ------------------------------------------------- the company library */
    /** A new library document. Carries the whole document, body included. */
    | { type: "document_created"; document: Document }
    /**
     * A new version of an existing document, carried whole — the log keeps
     * every version, `previousVersion` names the event id it replaces so the
     * chain can be walked without re-reducing.
     */
    | { type: "document_updated"; document: Document; previousVersion?: Id }
    /** Retires a document; `by` is the document that replaces it, if any. */
    | { type: "document_superseded"; documentId: Id; by?: Id }
    /**
     * An agent consulted company memory through a context tool
     * (docs/en/ARCHITECTURE.md: "Board context — on demand, not wholesale").
     * Provenance only: it changes no state, it explains one.
     */
    | { type: "context_consulted"; roleId: Id; tool: string; args: unknown; ok: boolean }
    | { type: "day_ended" }
  );

export type CompanyEventType = CompanyEvent["type"];

export const DAY_MINUTES = 540; // 09:00 → 18:00

/**
 * Formats a **sim-minute** `ts` as a wall clock time. Demo-only: a server
 * stream carries epoch milliseconds and must be formatted as a date instead.
 */
export function clock(ts: number): string {
  const m = Math.max(0, Math.min(DAY_MINUTES, Math.floor(ts)));
  const h = Math.floor(m / 60) + 9;
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h.toString().padStart(2, "0")}:${mm}`;
}
