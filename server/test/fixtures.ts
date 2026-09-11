import type { CompanyConfig, CompanyEvent, Proposal } from "@csuite/contract";
import type { DraftEvent } from "../src/store/types";

export const testConfig: CompanyConfig = {
  name: "Inkwell",
  product: "A writing tool for self-published authors",
  monthlyBudget: 20000,
  currency: "USD",
  departments: [
    { id: "dep-eng", name: "Engineering" },
    { id: "dep-growth", name: "Growth" },
  ],
  roles: [
    { id: "ceo", name: "You", title: "Chief Executive Officer", kind: "ceo", mandate: "Own the company" },
    {
      id: "cfo",
      name: "Vera",
      title: "Chief Financial Officer",
      kind: "board",
      mandate: "Defend the unit economics",
      model: "opus",
    },
    {
      id: "cto",
      name: "Ash",
      title: "Chief Technology Officer",
      kind: "board",
      mandate: "Defend delivery risk",
      model: "sonnet",
    },
  ],
};

export function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1",
    title: "Sponsor two author podcasts for four weeks",
    authorRoleId: "cmo",
    summary: "A cheap test of podcast sponsorship as an acquisition channel.",
    rationale: "Long-form audio reaches our audience where they already are.",
    alternatives: ["Paid search", "Do nothing"],
    cost: { amount: 2400, note: "Two shows, four weeks, 50% deposit" },
    risks: ["Attribution is weak", "Audience may not convert"],
    positions: [],
    disagreements: [],
    status: "drafting",
    ...overrides,
  };
}

let n = 0;
/** Builds a contract event with an id/ts filled in, in append order. */
export function ev(body: DraftEvent, ts?: number): CompanyEvent {
  n += 1;
  return { id: `ev-${n}`, ts: ts ?? n, ...body } as CompanyEvent;
}
