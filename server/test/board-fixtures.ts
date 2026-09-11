/**
 * A company with a real board — three C-level roles with distinct mandates,
 * which is the minimum shape a deliberation test can say anything about.
 * (`fixtures.ts`'s `testConfig` has two and exists for the API tests.)
 */

import type { CompanyConfig, Role } from "@csuite/contract";

export const boardConfig: CompanyConfig = {
  name: "Brightpage",
  product: "A website builder for independent authors and small publishers",
  monthlyBudget: 18000,
  currency: "USD",
  departments: [
    { id: "dep-eng", name: "Engineering" },
    { id: "dep-growth", name: "Growth" },
  ],
  roles: [
    {
      id: "ceo",
      name: "You",
      title: "Chief Executive Officer",
      kind: "ceo",
      mandate: "Sets direction, approves decisions, owns the company.",
    },
    {
      id: "cfo",
      name: "Marcus",
      title: "Chief Financial Officer",
      kind: "board",
      mandate: "Attacks the economics: budget, payback, unit costs, cash timing.",
    },
    {
      id: "cto",
      name: "Iris",
      title: "Chief Technology Officer",
      kind: "board",
      mandate: "Attacks technical risk and architectural debt in every proposal.",
      // Not an OpenRouter id — a Phase 0 display flavour. The runner must
      // ignore it and fall back to the configured default.
      model: "opus",
    },
    {
      id: "coo",
      name: "Dana",
      title: "Chief Operating Officer",
      kind: "board",
      mandate: "Attacks feasibility: capacity, deadlines, operational load.",
      model: "anthropic/claude-sonnet-4.5",
    },
    {
      id: "eng-1",
      name: "Sam",
      title: "Backend engineer",
      kind: "worker",
      departmentId: "dep-eng",
      mandate: "Ships backend tasks to acceptance.",
    },
  ],
};

export function roleById(id: string): Role {
  const role = boardConfig.roles.find((r) => r.id === id);
  if (!role) throw new Error(`no such role in the fixture: ${id}`);
  return role;
}

export const boardRoleIds = boardConfig.roles.filter((r) => r.kind === "board").map((r) => r.id);
