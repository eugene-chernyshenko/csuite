/**
 * Seeds the dev database with one company to ask real questions of.
 *
 *   npm run seed -w server
 *
 * Idempotent: if "brightpage" already exists, nothing is written — the log is
 * append-only and re-seeding must never duplicate a company's history. The
 * library documents are seeded the same way, one id at a time: a document that
 * is already there is left exactly as it is (it may have been edited since).
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
import {
  createLibraryService,
  pgLibraryStore,
  type CreateDocumentInput,
  type LibraryService,
} from "./library";
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

/**
 * The company's starting library — the same legend the dossier tells, written
 * down as documents an agent can actually query (ARCHITECTURE, "Three layers
 * of documents": layer 2). The dossier stays as the always-present grounding;
 * these are what `library_search`/`library_read` find when a board member wants
 * the detail behind a number.
 *
 * `viaDecision` is set on the two governed types because seeding *is* the
 * founding act of the company: the CEO writing the profile and the standing
 * policy at incorporation. Every later change to them has to earn a decision.
 */
export const brightpageLibrary: (CreateDocumentInput & { id: string })[] = [
  {
    id: "doc-company-profile",
    type: "profile",
    title: "Brightpage — company profile",
    summary:
      "What Brightpage is, who it serves, how it makes money, and the three priorities everything is measured against.",
    ownerRoleId: "ceo",
    tags: ["company", "strategy", "priorities"],
    viaDecision: true,
    body: [
      "## What we are",
      "",
      "Brightpage is a website builder for independent authors and small publishers. The product's core promise is a publish pipeline that always works: an author presses publish, readers see the page. Everything else — themes, newsletters, storefront — is in service of that.",
      "",
      "## Who we serve",
      "",
      "Self-published authors and two-to-five-person publishers. They are not developers, they are not agencies, and they do not have an IT department. They choose us on craft and reliability, not price — we are deliberately not the cheapest builder on the market.",
      "",
      "## How we make money",
      "",
      "Monthly subscriptions, average $27.65/month, 412 paying customers, $11,391 MRR. Annual billing shipped recently; the migration of existing monthly customers is still pending.",
      "",
      "## Priorities (in order)",
      "",
      "1. **Reduce churn.** 4.2% monthly MRR churn is the largest single leak in the business.",
      "2. **Prove one acquisition channel beyond paid search.** A podcast sponsorship test is running.",
      "3. **Keep publish-pipeline reliability above 99.9%.** It is the product's core promise; a reliability incident costs more trust than any campaign buys.",
      "",
      "## Shape of the company",
      "",
      "Two departments — Engineering and Growth — under a C-level board (CTO, CFO, COO) reporting to a human CEO. Monthly operating budget $18,000.",
    ].join("\n"),
  },
  {
    id: "doc-policy-customer-trust",
    type: "policy",
    title: "Customer trust: no third-party ads, no selling reader data",
    summary:
      "Standing rule: we never monetise our authors' readers — no third-party ads, no data sale, no dark patterns on cancellation.",
    ownerRoleId: "ceo",
    tags: ["policy", "trust", "monetisation"],
    viaDecision: true,
    body: [
      "## The rule",
      "",
      "The trust of independent authors is our core asset. We do not trade it for short-term revenue. Concretely, and without exception:",
      "",
      "- **No third-party advertising** on author sites, in any form, on any plan — including a 'free tier subsidised by ads'.",
      "- **No sale or brokerage of reader data.** Analytics we collect exist to serve the author who owns the site, and no one else.",
      "- **No dark patterns.** Cancellation is as easy as signup: self-serve, two clicks, no retention maze, no 'call us to cancel'.",
      "- **No quality regressions sold as features.** We do not degrade the reader's experience to create an upsell.",
      "",
      "## Why it is a policy and not a preference",
      "",
      "Our authors' readers are their livelihood. A builder that monetises those readers behind the author's back is a builder they leave — and they leave loudly, in public, to an audience of exactly the people we sell to. The revenue this rule forgoes is real; the revenue it protects is larger and more durable.",
      "",
      "## How to work within it",
      "",
      "Proposals that need more revenue should reach for pricing, packaging, retention, or new paid capability — not for the reader's attention. If a proposal's economics only work with ad revenue, the economics do not work.",
      "",
      "Changing this policy requires a proposal and the CEO's signature. Nothing else changes it.",
    ].join("\n"),
  },
  {
    id: "doc-finance-monthly-summary",
    type: "finance",
    title: "Monthly finance summary — budget, MRR, churn, CAC",
    summary:
      "$18,000/month operating budget against $11,391 MRR; 4.2% monthly churn (~$478) and $54 blended paid CAC are the two numbers that decide most proposals.",
    ownerRoleId: "cfo",
    tags: ["finance", "unit-economics", "budget", "churn", "cac"],
    body: [
      "## Revenue",
      "",
      "| Metric | Value |",
      "| --- | --- |",
      "| Paying subscriptions | 412 |",
      "| MRR | $11,391 |",
      "| Average revenue per account | $27.65/month |",
      "| Monthly MRR churn | 4.2% (~$478/month) |",
      "",
      "Churn is mostly quiet cancellations and failed cards rather than angry exits — which means it is partly a billing problem, not only a product one. Annual billing has shipped; migrating existing monthly customers is pending.",
      "",
      "## Operating budget — $18,000/month",
      "",
      "| Line | Amount |",
      "| --- | --- |",
      "| Infrastructure & tooling | $6,400 |",
      "| Payroll-equivalent | $7,200 |",
      "| Growth spend | $3,000 |",
      "| Buffer | $1,400 |",
      "",
      "The buffer is genuinely a buffer: it absorbs infrastructure spikes and payment-provider surprises, and it is not available as growth budget without a decision.",
      "",
      "## Unit economics",
      "",
      "- Blended paid CAC: **$54**, almost entirely paid search.",
      "- At $27.65 ARPA, gross payback is roughly **two months** before support and infrastructure cost.",
      "- At 4.2% monthly churn, average customer lifetime is ~24 months, so LTV is ~$660 gross — an LTV:CAC of about 12:1 on paid search, which looks excellent and is the reason the channel keeps getting funded despite its ceiling.",
      "",
      "## What the CFO watches",
      "",
      "1. Growth spend is 17% of the budget. Any proposal asking for materially more than $3,000/month is asking to reallocate payroll or infrastructure, and should say which.",
      "2. Churn costs ~$478/month in recurring revenue — more than any single campaign has added.",
      "3. Revenue quality, not just revenue: discounts and annual prepay move cash forward but change the shape of the risk.",
    ].join("\n"),
  },
  {
    id: "doc-analysis-paid-search-cac",
    type: "analysis",
    title: "Paid search CAC readout — the channel is at its ceiling",
    summary:
      "Paid search still converts at $54 blended CAC, but volume has been flat for three months and incremental clicks cost materially more — the channel is saturated, not broken.",
    ownerRoleId: "growth-lead",
    tags: ["growth", "acquisition", "cac", "paid-search", "analysis"],
    body: [
      "## Question",
      "",
      "Can we buy meaningfully more growth from paid search, or do we need a second channel?",
      "",
      "## What the numbers say",
      "",
      "- Blended paid CAC has held at **$54** across the last three months — stable, not deteriorating.",
      "- Volume has been **flat** over the same period at roughly the same spend. We are not buying more customers; we are buying the same ones at the same price.",
      "- The keyword set is 'website builder' and its long tail, which is one of the most contested categories in SaaS search. The incremental cost per click above our current bid rises steeply; pushing spend has historically raised CAC without raising volume proportionally.",
      "- Intent quality is good: paid-search signups churn at roughly the company average, so this is a volume ceiling, not a quality problem.",
      "",
      "## Reading",
      "",
      "The channel is **saturated**, not broken. Cutting it would cost real customers at a defensible price. Doubling it would mostly raise CAC. The honest conclusion is that incremental growth has to come from somewhere else — hence the podcast sponsorship test, where the audience is the one we sell to and the competition for attention is not an auction against every builder on the market.",
      "",
      "## Caveat, stated plainly",
      "",
      "Attribution outside search is weak. Any second-channel test needs its measurement agreed **before** it starts, or its readout will be an argument instead of a number.",
    ].join("\n"),
  },
  {
    id: "doc-note-support-load",
    type: "note",
    title: "Support load and what it tells us about churn",
    summary:
      "6-8 tickets/day, handled inside the current team; the recurring themes are failed cards and migration anxiety, both of which show up in churn.",
    ownerRoleId: "coo",
    tags: ["operations", "support", "churn"],
    body: [
      "Support runs 6-8 tickets a day and is handled inside the current team — it is not yet a staffing problem, but it is the earliest signal we have.",
      "",
      "Recurring themes, roughly in order of volume:",
      "",
      "1. **Failed cards and billing confusion.** These become quiet cancellations if nobody chases them. Dunning is minimal today.",
      "2. **Migration anxiety** — authors moving an existing site in, worried about broken links and lost readers. Every one of these that goes badly is a churn risk in month two.",
      "3. **Theme and layout questions**, which are mostly documentation gaps.",
      "4. Publish-pipeline incidents — rare, and loud when they happen.",
      "",
      "Operational note: any proposal that adds customer-facing surface should say who answers the tickets it creates. Support capacity is the constraint that turns a good growth plan into a bad quarter.",
    ].join("\n"),
  },
];

/**
 * Creates any seed document the company does not already have. Never
 * overwrites: a document that exists may have been superseded or rewritten
 * since, and the seeder has no business undoing that.
 */
async function seedLibrary(
  library: LibraryService,
  companyId: string,
): Promise<{ created: number; existing: number }> {
  const present = new Set(
    (await library.list(companyId, { status: "any", limit: 200 })).map((d) => d.id),
  );
  let created = 0;
  let existing = 0;
  for (const input of brightpageLibrary) {
    if (present.has(input.id)) {
      existing += 1;
      continue;
    }
    await library.create(companyId, input);
    created += 1;
  }
  return { created, existing };
}

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
      "Browse the company library (what the board's context tools read):",
      `  curl -sS '${base}/api/companies/${COMPANY_ID}/library' | jq '.documents[] | {id, type, title}'`,
      `  curl -sS '${base}/api/companies/${COMPANY_ID}/library?q=churn' | jq '.documents[] | {id, snippet}'`,
      `  curl -sS ${base}/api/companies/${COMPANY_ID}/library/doc-finance-monthly-summary | jq -r '.document.body'`,
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const { db, pool } = createDb();
  const store = pgEventStore(db);
  const library = createLibraryService({ library: pgLibraryStore(db) });
  try {
    const existing = await store.getCompany(COMPANY_ID);
    if (existing) {
      console.log(`Company "${COMPANY_ID}" already exists (created ${existing.createdAt}) — config left alone.`);
    } else {
      const company = await store.createCompany({ id: COMPANY_ID, config: brightpage });
      // The log starts the moment the company does, exactly as POST /companies does it.
      await store.appendEvents(company.id, [{ type: "day_started" }]);
      console.log(`Created company "${company.id}" — ${brightpage.roles.length} roles, board of 3.`);
    }

    const lib = await seedLibrary(library, COMPANY_ID);
    console.log(
      `Library: ${lib.created} document(s) created, ${lib.existing} already present ` +
        `(${brightpageLibrary.length} in the seed set).`,
    );
  } finally {
    await pool.end();
  }
  printNextSteps(`http://${env.HOST}:${env.PORT}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
