/**
 * csuite v0 contract — entity shapes.
 *
 * These schemas are the frozen v0 API contract (ROADMAP Phase 0): later phases
 * swap the mock transport for the real platform API, not the shapes.
 */

export type Id = string;

export type RoleKind = "ceo" | "board" | "lead" | "worker";

export interface Role {
  id: Id;
  /** Display name of the agent, e.g. "Vera" */
  name: string;
  /** e.g. "Chief Financial Officer" or "Backend engineer" */
  title: string;
  kind: RoleKind;
  departmentId?: Id;
  /** One-line loss function: what this role is obliged to defend/attack */
  mandate: string;
  /** Model flavor, display-only in Phase 0, e.g. "opus" | "sonnet" */
  model?: string;
}

export interface Department {
  id: Id;
  name: string;
}

export interface CompanyConfig {
  name: string;
  /** What the company builds/operates — one sentence */
  product: string;
  monthlyBudget: number;
  currency: "USD";
  departments: Department[];
  roles: Role[];
}

export type Stance = "support" | "support_with_conditions" | "object";

export interface Position {
  roleId: Id;
  stance: Stance;
  summary: string;
  keyPoints: string[];
}

export interface Disagreement {
  topic: string;
  roleIds: Id[];
  detail: string;
}

export type ProposalStatus =
  | "drafting"
  | "pending_approval"
  | "approved"
  | "returned"
  | "rejected"
  | "in_progress"
  | "delivered";

export interface Proposal {
  id: Id;
  title: string;
  authorRoleId: Id;
  /** One-paragraph pitch the CEO reads first */
  summary: string;
  /** The full argument — serif document body */
  rationale: string;
  alternatives: string[];
  cost: { amount: number; note: string };
  risks: string[];
  positions: Position[];
  disagreements: Disagreement[];
  status: ProposalStatus;
  ceoNote?: string;
}

export type TaskStatus = "todo" | "in_progress" | "in_review" | "blocked" | "done";

export interface Task {
  id: Id;
  proposalId?: Id;
  title: string;
  departmentId: Id;
  assigneeRoleId?: Id;
  status: TaskStatus;
}

export interface Report {
  id: Id;
  kind: "task" | "periodic";
  taskId?: Id;
  departmentId?: Id;
  authorRoleId: Id;
  title: string;
  /** What was done, plainly */
  done: string;
  /** Deviations from plan, if any */
  deviations?: string;
  /** Real money spent, USD */
  spend?: number;
  needsFromCeo?: string;
}

export interface Escalation {
  id: Id;
  fromRoleId: Id;
  severity: "attention" | "urgent";
  reason: string;
  /** The concrete decision/help requested from the CEO */
  ask: string;
  status: "open" | "resolved";
  resolution?: string;
}
