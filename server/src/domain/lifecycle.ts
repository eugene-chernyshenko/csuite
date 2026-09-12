/**
 * Decision-lifecycle rules — the kernel, in the sense of CLAUDE.md's "layers of
 * rigidity": code, not configuration, and the guarantee that nothing downstream
 * can talk its way past an approval gate.
 *
 * Everything here is a pure function of reduced state, so it is testable
 * without a database or an HTTP server, and the route handlers stay thin.
 */

import type {
  CeoDecision,
  Clarification,
  CompanyState,
  Escalation,
  Id,
  Proposal,
} from "@csuite/contract";

export type Check<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string };

const CEO_DECISIONS: readonly CeoDecision[] = ["approved", "returned", "rejected"];

export function isCeoDecision(value: unknown): value is CeoDecision {
  return typeof value === "string" && (CEO_DECISIONS as readonly string[]).includes(value);
}

/**
 * A CEO decision is only admissible on a proposal that is actually waiting for
 * one. Deciding twice, or deciding on something still drafting, is a conflict
 * (409) rather than a no-op: silently swallowing it would make the event log
 * disagree with what the caller believes happened.
 */
export function checkDecidable(state: CompanyState, proposalId: Id): Check<Proposal> {
  const proposal = state.proposals[proposalId];
  if (!proposal) {
    return { ok: false, status: 404, message: `Proposal "${proposalId}" not found` };
  }
  if (proposal.status !== "pending_approval") {
    return {
      ok: false,
      status: 409,
      message:
        `Proposal "${proposalId}" is "${proposal.status}", not "pending_approval" — ` +
        `no decision can be recorded on it`,
    };
  }
  return { ok: true, value: proposal };
}

/**
 * A clarification can be answered exactly once, while it is open.
 *
 * Both failures are 409 rather than 404-then-409, and deliberately so: behind
 * an open clarification sits a board run parked mid-flight, and answering is
 * what restarts it. "No such round" and "already answered" mean the same thing
 * to the caller — this round is not waiting for you — and in both cases a
 * second answer must not start a second deliberation.
 */
export function checkAnswerable(
  state: CompanyState,
  clarificationId: Id,
): Check<Clarification> {
  const clarification = state.clarifications[clarificationId];
  if (!clarification) {
    return {
      ok: false,
      status: 409,
      message: `Clarification "${clarificationId}" is not open — this company has no such clarification round`,
    };
  }
  if (clarification.status !== "open") {
    return {
      ok: false,
      status: 409,
      message: `Clarification "${clarificationId}" has already been answered`,
    };
  }
  return { ok: true, value: clarification };
}

/** An escalation can be resolved exactly once, while it is open. */
export function checkResolvable(state: CompanyState, escalationId: Id): Check<Escalation> {
  const escalation = state.escalations[escalationId];
  if (!escalation) {
    return { ok: false, status: 404, message: `Escalation "${escalationId}" not found` };
  }
  if (escalation.status !== "open") {
    return {
      ok: false,
      status: 409,
      message: `Escalation "${escalationId}" is already resolved`,
    };
  }
  return { ok: true, value: escalation };
}
