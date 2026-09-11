/**
 * Seeds the dev database with one company to ask real questions of.
 *
 *   npm run seed -w server
 *
 * Idempotent: if "brightpage" already exists, nothing is written — the log is
 * append-only and re-seeding must never duplicate a company's history.
 *
 * The config mirrors the Phase 0 demo company (web/src/lib/scenario/day-one.ts)
 * so the same org shows up behind real agents, with one deliberate difference:
 * **the board roles carry no `model`**. In the demo it was a display-only
 * flavour ("opus"); here an unset model means the board runs on
 * `OPENROUTER_MODEL` from .env, which is the cheap default. Give a board role a
 * real OpenRouter id (`vendor/model`) when you want to split the board across
 * models — which is the eventual intent (CLAUDE.md: "ideally distinct models").
 */

import type { CompanyConfig } from "@csuite/contract";
import { env } from "./env";
import { createDb } from "./db/client";
import { pgEventStore } from "./store/pg";

const COMPANY_ID = process.env.SEED_COMPANY_ID ?? "brightpage";

export const brightpage: CompanyConfig = {
  name: "Brightpage",
  product: "A website builder for independent authors and small publishers",
  monthlyBudget: 18000,
  currency: "USD",
  dossier: [
    "VALUES & STANDING POLICIES",
    "- The trust of independent authors is the core asset; we never trade customer-facing quality or their readers' experience for short-term revenue.",
    "- We compete on craft and reliability, not on being the cheapest.",
    "",
    "KEY NUMBERS (last 3 months, stable)",
    "- 412 paying subscriptions, $11,391 MRR, average $27.65/month.",
    "- Monthly MRR churn 4.2% (~$478/month), mostly quiet cancellations and failed cards.",
    "- Blended paid CAC $54, mostly search ads on saturated website-builder keywords.",
    "- Support load 6-8 tickets/day, handled within the current team.",
    "- Monthly operating budget $18,000; roughly $6,400 infra & tooling, $7,200 payroll-equivalent, $3,000 growth spend, the rest buffer.",
    "",
    "CURRENT PRIORITIES",
    "1. Reduce churn (annual billing shipped recently, migration pending).",
    "2. Prove one acquisition channel beyond paid search (podcast test running).",
    "3. Keep publish pipeline reliability above 99.9% - it is the product's core promise.",
  ].join("\n"),
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
    // --- the board: no `model`, so OPENROUTER_MODEL applies -----------------
    {
      id: "cto",
      name: "Iris",
      title: "Chief Technology Officer",
      kind: "board",
      mandate:
        "Stewards the technology: keeps the product able to grow — architecture, delivery capability, reliability — and keeps technical risk priced into every decision.",
    },
    {
      id: "cfo",
      name: "Marcus",
      title: "Chief Financial Officer",
      kind: "board",
      mandate:
        "Stewards the money: funds growth without losing the company — budget, cash timing, unit economics, payback — and protects revenue quality, not just revenue.",
    },
    {
      id: "coo",
      name: "Dana",
      title: "Chief Operating Officer",
      kind: "board",
      mandate:
        "Stewards the operation: keeps promises deliverable — capacity, processes, service quality — so growth lands without breaking the team or the customers.",
    },
    // --- below the board: not called by Phase 1, kept as the demo has them --
    {
      id: "eng-lead",
      name: "Petra",
      title: "Engineering lead",
      kind: "lead",
      departmentId: "dep-eng",
      mandate: "Owns delivery quality and acceptance of engineering work.",
      model: "sonnet",
    },
    {
      id: "eng-1",
      name: "Sam",
      title: "Backend engineer",
      kind: "worker",
      departmentId: "dep-eng",
      mandate: "Ships backend tasks to acceptance.",
      model: "sonnet",
    },
    {
      id: "eng-2",
      name: "Noa",
      title: "Frontend engineer",
      kind: "worker",
      departmentId: "dep-eng",
      mandate: "Ships frontend tasks to acceptance.",
      model: "sonnet",
    },
    {
      id: "growth-lead",
      name: "Felix",
      title: "Growth lead",
      kind: "lead",
      departmentId: "dep-growth",
      mandate: "Owns acquisition experiments and their honest readouts.",
      model: "sonnet",
    },
    {
      id: "analyst",
      name: "Rhea",
      title: "Analyst",
      kind: "worker",
      departmentId: "dep-growth",
      mandate: "Turns raw product and revenue data into defensible numbers.",
      model: "sonnet",
    },
  ],
};

const QUESTION =
  "Should we introduce annual billing at two months free, or keep pricing monthly-only?";

function printNextSteps(base: string): void {
  const board = env.OPENROUTER_API_KEY ? "ONLINE" : "OFFLINE (set OPENROUTER_API_KEY)";
  console.log(
    [
      "",
      `Board: ${board}. Default model: ${env.OPENROUTER_MODEL ?? "openai/gpt-5.6-luna"}`,
      "",
      "Ask the board a question (returns 202; the run happens in the background):",
      `  curl -sS -X POST ${base}/api/companies/${COMPANY_ID}/questions \\`,
      `    -H 'content-type: application/json' \\`,
      `    -d '{"text":"${QUESTION}"}' | jq`,
      "",
      "Watch the log as the board works (poll with the cursor from the last response):",
      `  curl -sS '${base}/api/companies/${COMPANY_ID}/events?after=0' | jq '.events[] | {seq, type}'`,
      "",
      "Read the folded state — the proposal lands in state.proposals:",
      `  curl -sS ${base}/api/companies/${COMPANY_ID}/state | jq '.state.proposals'`,
      "",
      "Decide on it (approved | returned | rejected):",
      `  curl -sS -X POST ${base}/api/companies/${COMPANY_ID}/proposals/<proposalId>/decision \\`,
      `    -H 'content-type: application/json' \\`,
      `    -d '{"decision":"approved","note":"Ship it."}' | jq`,
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const { db, pool } = createDb();
  const store = pgEventStore(db);
  try {
    const existing = await store.getCompany(COMPANY_ID);
    if (existing) {
      console.log(`Company "${COMPANY_ID}" already exists (created ${existing.createdAt}) — nothing written.`);
    } else {
      const company = await store.createCompany({ id: COMPANY_ID, config: brightpage });
      // The log starts the moment the company does, exactly as POST /companies does it.
      await store.appendEvents(company.id, [{ type: "day_started" }]);
      console.log(`Created company "${company.id}" — ${brightpage.roles.length} roles, board of 3.`);
    }
  } finally {
    await pool.end();
  }
  printNextSteps(`http://${env.HOST}:${env.PORT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
