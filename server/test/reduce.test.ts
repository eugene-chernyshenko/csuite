/**
 * The reducer is shared verbatim with the web app, so these are the tests that
 * pin the *contract's* behaviour: a scripted log must fold to exactly the
 * proposal/task/escalation statuses both consumers expect.
 */

import { describe, expect, it } from "vitest";
import { apply, emptyState, reduce, type CompanyEvent } from "@csuite/contract";
import { ev, makeProposal } from "./fixtures";

describe("reduce", () => {
  it("lands a submitted proposal as pending_approval regardless of the drafted status", () => {
    const state = reduce([
      ev({ type: "proposal_submitted", proposal: makeProposal({ status: "drafting" }) }),
    ]);

    expect(state.proposals.p1?.status).toBe("pending_approval");
  });

  it("maps each CEO decision onto the right proposal status", () => {
    const cases = [
      ["approved", "in_progress"],
      ["returned", "returned"],
      ["rejected", "rejected"],
    ] as const;

    for (const [decision, expected] of cases) {
      const state = reduce([
        ev({ type: "proposal_submitted", proposal: makeProposal() }),
        ev({ type: "ceo_decision", proposalId: "p1", decision, note: "because" }),
      ]);
      expect(state.proposals.p1?.status).toBe(expected);
      expect(state.proposals.p1?.ceoNote).toBe("because");
      expect(state.decisions.p1).toBe(decision);
    }
  });

  it("walks a full approve → tasks → reports → delivered lifecycle", () => {
    const log: CompanyEvent[] = [
      ev({ type: "day_started" }),
      ev({ type: "question_asked", text: "Should we sponsor podcasts?", byRoleId: "ceo" }),
      ev({ type: "position_submitted", proposalId: "p1", position: { roleId: "cfo", stance: "object", summary: "CAC unproven", keyPoints: ["No attribution"] } }),
      ev({ type: "proposal_submitted", proposal: makeProposal() }),
      ev({ type: "ceo_decision", proposalId: "p1", decision: "approved" }),
      ev({
        type: "tasks_created",
        proposalId: "p1",
        tasks: [
          { id: "t1", proposalId: "p1", title: "Negotiate slots", departmentId: "dep-growth", status: "todo" },
          { id: "t2", proposalId: "p1", title: "Build landing page", departmentId: "dep-eng", status: "todo" },
        ],
      }),
      ev({ type: "task_status_changed", taskId: "t1", status: "done" }),
      ev({ type: "task_status_changed", taskId: "t2", status: "done" }),
      ev({
        type: "report_submitted",
        report: { id: "r1", kind: "task", taskId: "t2", authorRoleId: "cto", title: "Landing page live", done: "Shipped", spend: 120 },
      }),
      ev({ type: "budget_spent", amount: 1200, category: "growth", departmentId: "dep-growth" }),
    ];

    const state = reduce(log);

    expect(state.proposals.p1?.status).toBe("delivered");
    expect(state.tasks.t1?.status).toBe("done");
    expect(state.reports).toHaveLength(1);
    expect(state.spent).toBe(1320);
    expect(state.spendByCategory.growth).toBe(1200);
    expect(state.draftPositions.p1).toHaveLength(1);
    expect(state.feed).toHaveLength(log.length);
  });

  it("keeps a proposal in_progress while any of its tasks is unfinished", () => {
    const state = reduce([
      ev({ type: "proposal_submitted", proposal: makeProposal() }),
      ev({ type: "ceo_decision", proposalId: "p1", decision: "approved" }),
      ev({
        type: "tasks_created",
        proposalId: "p1",
        tasks: [
          { id: "t1", proposalId: "p1", title: "A", departmentId: "dep-eng", status: "todo" },
          { id: "t2", proposalId: "p1", title: "B", departmentId: "dep-eng", status: "todo" },
        ],
      }),
      ev({ type: "task_status_changed", taskId: "t1", status: "done" }),
      ev({
        type: "report_submitted",
        report: { id: "r1", kind: "task", taskId: "t1", authorRoleId: "cto", title: "A done", done: "ok" },
      }),
    ]);

    expect(state.proposals.p1?.status).toBe("in_progress");
  });

  it("opens and resolves escalations", () => {
    const state = reduce([
      ev({
        type: "escalation_raised",
        escalation: { id: "e1", fromRoleId: "cto", severity: "urgent", reason: "Vendor pulled out", ask: "Approve a replacement", status: "open" },
      }),
      ev({ type: "escalation_resolved", escalationId: "e1", resolution: "Use the backup vendor" }),
    ]);

    expect(state.escalations.e1?.status).toBe("resolved");
    expect(state.escalations.e1?.resolution).toBe("Use the backup vendor");
  });

  it("ignores events about entities it has never seen, rather than throwing", () => {
    const state = reduce([
      ev({ type: "ceo_decision", proposalId: "ghost", decision: "approved" }),
      ev({ type: "task_status_changed", taskId: "ghost", status: "done" }),
      ev({ type: "escalation_resolved", escalationId: "ghost", resolution: "n/a" }),
    ]);

    expect(state.proposals.ghost).toBeUndefined();
    expect(state.feed).toHaveLength(3);
  });

  it("folds identically whether applied at once or one event at a time", () => {
    const log = [
      ev({ type: "proposal_submitted", proposal: makeProposal() }),
      ev({ type: "ceo_decision", proposalId: "p1", decision: "returned", note: "needs numbers" }),
    ];

    const incremental = emptyState();
    for (const e of log) apply(incremental, e);

    expect(incremental).toEqual(reduce(log));
  });
});
