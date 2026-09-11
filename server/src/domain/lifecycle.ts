/**
 * Decision-lifecycle rules — the kernel, in the sense of CLAUDE.md's "layers of
 * rigidity": code, not configuration, and the guarantee that nothing downstream
 * can talk its way past an approval gate.
 *
 * Everything here is a pure function of reduced state, so it is testable
 * without a database or an HTTP server, and the route handlers stay thin.
 */

import type { CeoDecision, CompanyState, Escalation, Id, Proposal } from "@csuite/contract";

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
