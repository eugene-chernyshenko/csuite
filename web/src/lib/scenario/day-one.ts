import type { CompanyConfig } from "../contract/types";
import type { CompanyEvent } from "../contract/events";

/**
 * "A day in the company" — the scripted mock scenario that drives the demo.
 * Placeholder seed: to be replaced by the full authored day.
 */

export const company: CompanyConfig = {
  name: "Brightpage",
  product: "A website builder for independent authors and small publishers",
  monthlyBudget: 18000,
  currency: "USD",
  departments: [
    { id: "dep-eng", name: "Engineering" },
    { id: "dep-growth", name: "Growth" },
  ],
  roles: [
    { id: "ceo", name: "You", title: "Chief Executive Officer", kind: "ceo", mandate: "Sets direction, approves decisions, owns the company." },
    { id: "cto", name: "Iris", title: "Chief Technology Officer", kind: "board", mandate: "Attacks technical risk and architectural debt in every proposal.", model: "opus" },
    { id: "cfo", name: "Marcus", title: "Chief Financial Officer", kind: "board", mandate: "Attacks the economics: budget, payback, unit costs.", model: "opus" },
    { id: "coo", name: "Dana", title: "Chief Operating Officer", kind: "board", mandate: "Attacks feasibility: capacity, deadlines, operational load.", model: "sonnet" },
    { id: "eng-lead", name: "Petra", title: "Engineering lead", kind: "lead", departmentId: "dep-eng", mandate: "Owns delivery quality and acceptance of engineering work.", model: "sonnet" },
    { id: "eng-1", name: "Sam", title: "Backend engineer", kind: "worker", departmentId: "dep-eng", mandate: "Ships backend tasks to acceptance.", model: "sonnet" },
    { id: "eng-2", name: "Noa", title: "Frontend engineer", kind: "worker", departmentId: "dep-eng", mandate: "Ships frontend tasks to acceptance.", model: "sonnet" },
    { id: "growth-lead", name: "Felix", title: "Growth lead", kind: "lead", departmentId: "dep-growth", mandate: "Owns acquisition experiments and their honest readouts.", model: "sonnet" },
    { id: "analyst", name: "Rhea", title: "Analyst", kind: "worker", departmentId: "dep-growth", mandate: "Turns raw product and revenue data into defensible numbers.", model: "sonnet" },
  ],
};

export const dayOne: CompanyEvent[] = [
  { id: "e0", ts: 0, type: "day_started" },
  { id: "e1", ts: 1, type: "worklog", roleId: "cto", activity: "thinking", note: "Reviewing the pricing question" },
  { id: "e2", ts: 2, type: "worklog", roleId: "cfo", activity: "analyzing", note: "Pulling revenue numbers" },
];
