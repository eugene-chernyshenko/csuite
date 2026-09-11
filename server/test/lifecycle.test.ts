/**
 * The approval gate, as a pure function. This is kernel behaviour (CLAUDE.md:
 * agents must not be able to route around their own authority limits), so it
 * gets tested away from HTTP and away from the database.
 */

import { describe, expect, it } from "vitest";
import { reduce, type ProposalStatus } from "@csuite/contract";
import { checkDecidable, checkResolvable, isCeoDecision } from "../src/domain/lifecycle";
import { ev, makeProposal } from "./fixtures";

const pending = () => reduce([ev({ type: "proposal_submitted", proposal: makeProposal() })]);

describe("checkDecidable", () => {
  it("admits a decision on a proposal that is pending approval", () => {
    const check = checkDecidable(pending(), "p1");
    expect(check.ok).toBe(true);
  });

  it("404s on a proposal that does not exist", () => {
    const check = checkDecidable(pending(), "ghost");
    expect(check).toMatchObject({ ok: false, status: 404 });
  });

  it("409s on a second decision for the same proposal", () => {
    const state = reduce([
      ev({ type: "proposal_submitted", proposal: makeProposal() }),
      ev({ type: "ceo_decision", proposalId: "p1", decision: "approved" }),
    ]);

    const check = checkDecidable(state, "p1");
    expect(check).toMatchObject({ ok: false, status: 409 });
    if (!check.ok) expect(check.message).toContain("in_progress");
  });

  it("409s on every non-pending status", () => {
    const statuses: ProposalStatus[] = [
      "drafting",
      "approved",
      "returned",
      "rejected",
      "in_progress",
      "delivered",
    ];

    for (const status of statuses) {
      // Build the state directly: only `proposal_submitted` can force
      // pending_approval, so this exercises the other statuses honestly.
      const state = reduce([]);
      state.proposals.p1 = makeProposal({ status });
      expect(checkDecidable(state, "p1")).toMatchObject({ ok: false, status: 409 });
    }
  });
});

describe("checkResolvable", () => {
  const raised = () =>
    reduce([
      ev({
        type: "escalation_raised",
        escalation: {
          id: "e1",
          fromRoleId: "cto",
          severity: "urgent",
          reason: "Vendor pulled out",
          ask: "Approve a replacement",
          status: "open",
        },
      }),
    ]);

  it("admits a resolution while the escalation is open", () => {
    expect(checkResolvable(raised(), "e1").ok).toBe(true);
  });

  it("404s on an unknown escalation", () => {
    expect(checkResolvable(raised(), "ghost")).toMatchObject({ ok: false, status: 404 });
  });

  it("409s once it has been resolved", () => {
    const state = raised();
    state.escalations.e1!.status = "resolved";
    expect(checkResolvable(state, "e1")).toMatchObject({ ok: false, status: 409 });
  });
});

describe("isCeoDecision", () => {
  it("accepts only the three contract decisions", () => {
    expect(["approved", "returned", "rejected"].every(isCeoDecision)).toBe(true);
    expect(isCeoDecision("maybe")).toBe(false);
    expect(isCeoDecision(undefined)).toBe(false);
  });
});
