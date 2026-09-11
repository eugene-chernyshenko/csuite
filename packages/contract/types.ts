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
  /**
   * The company dossier: values, key numbers (MRR, churn, CAC), priorities,
   * standing policies — markdown, shown to board agents as grounded fact.
   * Interim measure: replaced by on-demand data access (company memory +
   * assets via the platform API) in a later phase.
   */
  dossier?: string;
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

/**
 * The six kinds of library document (docs/en/ARCHITECTURE.md, "Three layers of
 * documents", layer 2). `note` is the escape valve so nothing has to be
 * mis-typed to be written down.
 */
export type DocumentType =
  | "profile"
  | "policy"
  | "finance"
  | "analysis"
  | "agreement"
  | "note";

export type DocumentStatus = "current" | "superseded";

/**
 * A company-library document: markdown with typed frontmatter.
 *
 * Versioned through the event log (`document_created/updated/superseded`), not
 * edited in place — a superseded document keeps its body and points at the one
 * that replaced it, so the reasoning behind a past decision stays readable.
 *
 * Governance (enforced by the library service, not by this shape): `policy` and
 * `profile` change only through the decision process; other types are written
 * by roles within their own authority.
 */
export interface Document {
  id: Id;
  type: DocumentType;
  title: string;
  /** One line: what this document says, for list views and tool results. */
  summary: string;
  /** The role accountable for keeping it true. */
  ownerRoleId: Id;
  tags: string[];
  status: DocumentStatus;
  /** Set when `status` is "superseded" and a replacement exists. */
  supersededBy?: Id;
  /** Markdown. */
  body: string;
  /** Company-timeline `ts` of the last write — same clock as `EventBase.ts`. */
  updatedAt: number;
}

/** A document without its body — what list/search results carry. */
export type DocumentFrontmatter = Omit<Document, "body">;

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
