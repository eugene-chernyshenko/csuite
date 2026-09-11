import type {
  CompanyConfig,
  Disagreement,
  Escalation,
  Position,
  Report,
  Task,
} from "@csuite/contract";
import type { CompanyEvent } from "@csuite/contract";

/**
 * "A day in the company" — the scripted mock scenario that drives the demo.
 *
 * Brightpage, Sept 11. Three proposals move through the board today:
 *  - prop-annual-billing (CFO): pricing change, approved, drives most of the
 *    day's engineering work.
 *  - prop-cdn (CTO): infra bet, returned with a question — not everything
 *    gets a yes.
 *  - prop-podcast (growth): a smaller, cheaper bet, approved with conditions.
 * A same-day partnership escalation from growth forces a fast CEO call in
 * the middle of the day. The whole thing is stitched together with worklogs
 * so the Floor never goes quiet.
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
    { id: "cto", name: "Iris", title: "Chief Technology Officer", kind: "board", mandate: "Stewards the technology: keeps the product able to grow and technical risk priced into every decision.", model: "opus" },
    { id: "cfo", name: "Marcus", title: "Chief Financial Officer", kind: "board", mandate: "Stewards the money: funds growth without losing the company — budget, cash timing, unit economics.", model: "opus" },
    { id: "coo", name: "Dana", title: "Chief Operating Officer", kind: "board", mandate: "Stewards the operation: keeps promises deliverable — capacity, processes, service quality.", model: "sonnet" },
    { id: "eng-lead", name: "Petra", title: "Engineering lead", kind: "lead", departmentId: "dep-eng", mandate: "Owns delivery quality and acceptance of engineering work.", model: "sonnet" },
    { id: "eng-1", name: "Sam", title: "Backend engineer", kind: "worker", departmentId: "dep-eng", mandate: "Ships backend tasks to acceptance.", model: "sonnet" },
    { id: "eng-2", name: "Noa", title: "Frontend engineer", kind: "worker", departmentId: "dep-eng", mandate: "Ships frontend tasks to acceptance.", model: "sonnet" },
    { id: "growth-lead", name: "Felix", title: "Growth lead", kind: "lead", departmentId: "dep-growth", mandate: "Owns acquisition experiments and their honest readouts.", model: "sonnet" },
    { id: "analyst", name: "Rhea", title: "Analyst", kind: "worker", departmentId: "dep-growth", mandate: "Turns raw product and revenue data into defensible numbers.", model: "sonnet" },
  ],
};

// ---------------------------------------------------------------------------
// Proposal 1 — annual billing (CFO). Approved.
// ---------------------------------------------------------------------------

const posCfoAnnual: Position = {
  roleId: "cfo",
  stance: "support",
  summary: "The economics work: annual billing converts churn-exposed MRR into cash we already have in hand.",
  keyPoints: [
    "412 subscribers, $11,391 MRR, 4.2% monthly MRR churn — about $478/month leaking from failed renewals and quiet cancellations.",
    "At 25% existing and 33% new-signup adoption over two quarters, we convert roughly $850/month of exposed MRR and pull forward about $28,000 in cash.",
    "Two months free costs $55.60 per annual subscriber against list price — cheaper than what we already spend recovering one failed-card renewal.",
    "Deferred revenue accounting is straightforward at our size; I'll own the recognition schedule.",
  ],
};

const posCtoAnnual: Position = {
  roleId: "cto",
  stance: "support_with_conditions",
  summary: "Ship it, but scope down: upgrade-only, no self-serve proration on day one.",
  keyPoints: [
    "Full proration — upgrade, downgrade, mid-cycle switches, refund math — is a two-to-three week build on its own. Not worth blocking launch for.",
    "The migration script needs a production dry run before it touches real subscriptions; 1,146 accounts is small enough to verify by hand if it flags edge cases.",
    "I want plan switches capped at once per billing cycle at first, so we don't chase invoice disputes.",
  ],
};

const posCooAnnual: Position = {
  roleId: "coo",
  stance: "support_with_conditions",
  summary: "Fine operationally if downgrades stay a support queue, not a self-serve button, until we see real volume.",
  keyPoints: [
    "Support runs light today — 6 to 8 tickets a day. Manual downgrade handling adds maybe 30 minutes a day at current signup pace.",
    "I want a written script for support so nobody promises a refund we can't honor.",
    "If adoption beats the model, flag me at 15% conversion, not after — I'll need a head start on hiring.",
  ],
};

const disagreementAnnual: Disagreement = {
  topic: "Whether to build full proration before shipping annual billing",
  roleIds: ["cfo", "cto"],
  detail:
    "Marcus wants proration built now so the cash-flow number in his model isn't undercut by manual refund mistakes. Iris wants to ship upgrade-only first and build proration only if downgrade volume justifies it — arguing the two-week delay costs more in exposed churn than the manual-refund risk is worth.",
};

const tasksAnnual: Task[] = [
  { id: "t-stripe-plan", proposalId: "prop-annual-billing", title: "Add annual plan ($275/yr) to the Stripe product catalog", departmentId: "dep-eng", assigneeRoleId: "eng-1", status: "todo" },
  { id: "t-switch-flow", proposalId: "prop-annual-billing", title: "Build the plan-switch flow in account settings", departmentId: "dep-eng", assigneeRoleId: "eng-2", status: "todo" },
  { id: "t-migration-script", proposalId: "prop-annual-billing", title: "Write the migration script for existing monthly subscribers", departmentId: "dep-eng", assigneeRoleId: "eng-1", status: "todo" },
  { id: "t-qa-billing", proposalId: "prop-annual-billing", title: "QA billing edge cases: mid-cycle switch, failed-payment retry", departmentId: "dep-eng", assigneeRoleId: "eng-lead", status: "todo" },
  { id: "t-pricing-copy", proposalId: "prop-annual-billing", title: "Update the pricing page with the annual toggle and copy", departmentId: "dep-eng", assigneeRoleId: "eng-2", status: "todo" },
  { id: "t-launch-email", proposalId: "prop-annual-billing", title: "Draft the annual-billing announcement email to existing customers", departmentId: "dep-growth", assigneeRoleId: "analyst", status: "todo" },
];

// ---------------------------------------------------------------------------
// Proposal 2 — own CDN for image hosting (CTO). Returned with a question.
// ---------------------------------------------------------------------------

const posCooCdn: Position = {
  roleId: "coo",
  stance: "support_with_conditions",
  summary: "Low operational risk if the cutover is staged, not a big-bang switch.",
  keyPoints: [
    "Recommend a phased rollout — new sites first, then batch-migrate existing sites over two weeks, not one weekend.",
    "No new hires needed; this sits inside engineering's existing capacity.",
    "Want a rollback plan documented before the first site gets repointed.",
  ],
};

const posCfoCdn: Position = {
  roleId: "cfo",
  stance: "object",
  summary: "Payback is 14 months and our cash position doesn't have room for a $9,000 bet with that long a tail this quarter.",
  keyPoints: [
    "$9,000 is half of this month's total budget — spending it here means less room for anything else that comes up this quarter.",
    "14-month payback assumes traffic holds steady; if it doesn't, this could stretch past 18 months before we see a dollar back.",
    "We're already carrying the cash-flow effect of the annual-billing migration this month — I'd rather see one quarter of runway before we add a second big outlay.",
    "Negotiating our current vendor down to $500/month costs nothing and captures most of the savings without the migration risk.",
  ],
};

const disagreementCdn: Disagreement = {
  topic: "Whether to fund the CDN migration this quarter",
  roleIds: ["cfo", "cto"],
  detail:
    "Iris argues the 14-month payback is worth it because it also unblocks image-pipeline work — WebP by default, responsive srcset — that's stalled on our vendor's roadmap; the value isn't just the cost line. Marcus argues payback period isn't the only cash concern: deploying $9,000 this month on top of the annual-billing cash effects leaves too thin a cushion if anything else breaks.",
};

// ---------------------------------------------------------------------------
// Proposal 3 — podcast sponsorship test (Growth). Approved with conditions.
// ---------------------------------------------------------------------------

const posCooPodcast: Position = {
  roleId: "coo",
  stance: "support",
  summary: "No operational load — this runs entirely inside growth's existing capacity.",
  keyPoints: [
    "No new tooling or support burden; promo-code redemption is the same flow we already have.",
    "Recording sponsor reads is a half-day ask of Felix's time, not a distraction from anything else in flight.",
  ],
};

const posAnalystPodcast: Position = {
  roleId: "analyst",
  stance: "support",
  summary: "The math clears our current paid CAC if it converts anywhere near the modeled rate.",
  keyPoints: [
    "Current blended paid CAC is $54; break-even for this test is $40, so there's real room to prove the channel out.",
    "Both shows' audiences match our ICP — checked their guest lists and back-catalog against our top customer segments.",
    "UTM plus promo code gives us a clean weekly read; dashboard will be live before the first episode airs.",
  ],
};

const posCfoPodcast: Position = {
  roleId: "cfo",
  stance: "support_with_conditions",
  summary: "Support it, but with a hard cap and a kill-switch — we can't let this drift.",
  keyPoints: [
    "Cap total spend at $2,400 — no extending to more shows mid-test without coming back for approval.",
    "Kill the test if blended CAC clears $40 by the end of week 2; don't wait for all four weeks to call it.",
    "This is the second unbudgeted growth spend this week after the newsletter placement — I want a weekly number, not a month-end surprise.",
  ],
};

const tasksPodcast: Task[] = [
  { id: "t-podcast-creative", proposalId: "prop-podcast", title: "Record sponsor-read intro/outro with two indie-author podcast hosts", departmentId: "dep-growth", assigneeRoleId: "growth-lead", status: "todo" },
  { id: "t-podcast-tracking", proposalId: "prop-podcast", title: "Set up promo-code and UTM tracking for the podcast test", departmentId: "dep-growth", assigneeRoleId: "analyst", status: "todo" },
  { id: "t-podcast-cac", proposalId: "prop-podcast", title: "Track weekly blended CAC against the $40 kill-switch", departmentId: "dep-growth", assigneeRoleId: "analyst", status: "todo" },
];

const whenAnnualApproved = { proposalId: "prop-annual-billing", decision: "approved" as const };
const whenAnnualRejected = { proposalId: "prop-annual-billing", decision: "rejected" as const };
const whenCdnReturned = { proposalId: "prop-cdn", decision: "returned" as const };

export const dayOne: CompanyEvent[] = [
  { id: "e001", ts: 0, type: "day_started" },
  { id: "e002", ts: 0.5, type: "worklog", roleId: "coo", activity: "meeting", note: "Prepping yesterday's close-out numbers" },
  { id: "e003", ts: 1, type: "worklog", roleId: "cto", activity: "thinking", note: "Reviewing yesterday's pricing question from the CEO" },
  { id: "e004", ts: 2, type: "worklog", roleId: "cfo", activity: "analyzing", note: "Pulling MRR and churn numbers for the pricing review" },
  { id: "e005", ts: 3, type: "worklog", roleId: "eng-lead", activity: "reviewing", note: "Triaging overnight error reports" },
  { id: "e006", ts: 4, type: "worklog", roleId: "eng-1", activity: "coding", note: "Profiling the slow publish pipeline on large sites" },
  { id: "e007", ts: 5, type: "worklog", roleId: "eng-2", activity: "coding", note: "Fixing the image upload timeout on mobile Safari" },
  { id: "e008", ts: 6, type: "worklog", roleId: "growth-lead", activity: "analyzing", note: "Reviewing weekend signup funnel drop-off" },
  { id: "e009", ts: 7, type: "worklog", roleId: "analyst", activity: "analyzing", note: "Building a cohort retention view for Q3" },
  {
    id: "e010", ts: 9, type: "report_submitted",
    report: {
      id: "r-eod-yesterday", kind: "periodic", departmentId: "dep-eng", authorRoleId: "coo",
      title: "Yesterday's close-out",
      done: "Shipped the mobile upload timeout fix and closed 8 support tickets. 14 new trial signups, zero P1 incidents. Publish pipeline is running slow on sites over 200 pages — Sam's picking that up this morning.",
    } satisfies Report,
  },
  { id: "e011", ts: 10, type: "worklog", roleId: "cto", activity: "thinking", note: "Sketching questions for Marcus on the annual-billing math" },
  { id: "e012", ts: 12, type: "drafting_started", proposalId: "prop-annual-billing", authorRoleId: "cfo", title: "Introduce annual billing at 2 months free" },
  { id: "e013", ts: 14, type: "worklog", roleId: "eng-1", activity: "coding", note: "Pipeline slows past 200 pages — looks like template re-render, not I/O" },
  { id: "e014", ts: 15, type: "message_sent", fromRoleId: "cfo", toRoleId: "cto", gist: "Drafting the annual billing pitch — need your read on migration risk before I submit." },
  { id: "e015", ts: 17, type: "worklog", roleId: "growth-lead", activity: "meeting", note: "Syncing with Rhea on funnel numbers" },
  { id: "e016", ts: 18, type: "position_submitted", proposalId: "prop-annual-billing", position: posCfoAnnual },
  { id: "e017", ts: 21, type: "worklog", roleId: "analyst", activity: "analyzing", note: "Cross-checking drop-off against last month's baseline" },
  { id: "e018", ts: 25, type: "position_submitted", proposalId: "prop-annual-billing", position: posCtoAnnual },
  { id: "e019", ts: 27, type: "worklog", roleId: "eng-2", activity: "coding", note: "Reproducing the Safari upload timeout on a real device" },
  { id: "e020", ts: 30, type: "disagreement_recorded", proposalId: "prop-annual-billing", disagreement: disagreementAnnual },
  { id: "e021", ts: 33, type: "worklog", roleId: "coo", activity: "meeting", note: "Reviewing support queue capacity for an annual-billing launch" },
  { id: "e022", ts: 36, type: "position_submitted", proposalId: "prop-annual-billing", position: posCooAnnual },
  { id: "e023", ts: 40, type: "message_sent", fromRoleId: "cto", toRoleId: "cfo", gist: "Fine to launch without proration if we cap plan switches to once per billing cycle at first." },
  { id: "e024", ts: 42, type: "worklog", roleId: "eng-lead", activity: "reviewing", note: "Reviewing Noa's Safari upload fix" },
  { id: "e025", ts: 45, type: "budget_spent", amount: 42, category: "infra", note: "Daily infra — compute, Postgres, backups" },
  { id: "e026", ts: 48, type: "worklog", roleId: "eng-1", activity: "coding", note: "Publish pipeline fix ready for review — caching the template render" },
  { id: "e027", ts: 50, type: "message_sent", fromRoleId: "cfo", toRoleId: "ceo", gist: "Proposal's almost ready — numbers check out, want Iris's and Dana's positions in before I send it." },
  {
    id: "e028", ts: 55, type: "proposal_submitted",
    proposal: {
      id: "prop-annual-billing",
      title: "Introduce annual billing at 2 months free",
      authorRoleId: "cfo",
      summary: "Move new and existing customers onto an annual plan priced at two months free, so committed authors pay upfront and we stop re-selling the same subscriber every 30 days.",
      rationale:
        "Brightpage carries 412 paying subscriptions at an average $27.65 per month, for $11,391 in MRR. Monthly churn has held at 4.2% of MRR for the last three cycles — call it $478 walking out the door every month, most of it authors who paused their site for a season and never came back to update payment details.\n\n" +
        "An annual plan at $275/year (two months free against the $331.80 sticker) asks for a bigger upfront commitment but removes ten of twelve monthly renewal risks per customer. If even a quarter of existing subscribers and a third of new signups take the annual option over the next two quarters, we'd convert roughly $850/month of churn-exposed MRR into locked revenue and pull forward close to $28,000 in cash we'd otherwise collect a dollar at a time.\n\n" +
        "We can ship this without building full proration: launch upgrade-only, route downgrade requests to support by hand until volume tells us it's worth automating, and backfill the migration script against existing subscribers' actual billing-cycle anchor dates so nobody gets double-charged in the switch.",
      alternatives: [
        "Leave pricing as-is and revisit after we ship the workspace redesign.",
        "Offer one month free instead of two — smaller cash-flow hit but a weaker signup incentive and roughly half the modeled churn reduction.",
        "Build full proration and self-serve downgrades before launch — safer for support load, but pushes the launch 6-8 weeks and delays the cash-flow benefit.",
      ],
      cost: { amount: 2400, note: "~2 engineer-weeks (Sam + Noa) to ship annual billing, the migration script, and pricing page changes; proration and self-serve downgrades deferred to a later sprint." },
      risks: [
        "Without proration, customers who switch mid-cycle can be confused by the first prorated invoice — mitigated by a confirmation modal showing the exact amount before they commit.",
        "The migration script touches live subscription records for 1,146 customers — a bad batch could double-bill or silently drop someone's site.",
        "Downgrade requests routed to support by hand could pile up faster than Dana's team can clear them if adoption is heavier than modeled.",
        "Annual revenue is recognized over 12 months, not received — the cash-flow number assumes we don't spend the upfront cash as if it were monthly revenue.",
      ],
      positions: [posCfoAnnual, posCtoAnnual, posCooAnnual],
      disagreements: [disagreementAnnual],
      status: "pending_approval",
    },
  },
  { id: "e029", ts: 57, type: "ceo_decision", proposalId: "prop-annual-billing", decision: "approved", auto: true, note: "Approved. Ship upgrade-only first like Iris scoped — we can revisit proration once we see real downgrade volume." },

  // --- rejected branch: small, so the demo doesn't dead-end -----------------
  { id: "e030", ts: 57.2, type: "message_sent", when: whenAnnualRejected, fromRoleId: "coo", toRoleId: "cfo", gist: "Noted the call — let's hold pricing steady and revisit once we've got another cycle of churn data." },
  { id: "e031", ts: 57.4, type: "worklog", when: whenAnnualRejected, roleId: "cfo", activity: "analyzing", note: "Building a deeper cohort analysis for an annual-billing v2 pitch" },
  { id: "e032", ts: 57.6, type: "message_sent", when: whenAnnualRejected, fromRoleId: "cfo", toRoleId: "ceo", gist: "Understood. I'll pull Q3 churn cohorts and bring a sharper number next week." },

  // --- approved branch: tasks and delivery through the day -----------------
  { id: "e033", ts: 58, type: "tasks_created", when: whenAnnualApproved, proposalId: "prop-annual-billing", tasks: tasksAnnual },
  { id: "e034", ts: 59, type: "message_sent", when: whenAnnualApproved, fromRoleId: "eng-lead", toRoleId: "eng-1", gist: "Start with the Stripe plan setup — I'll review before you touch the migration script." },
  { id: "e035", ts: 60.5, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-stripe-plan", status: "in_progress", byRoleId: "eng-1" },
  { id: "e036", ts: 61, type: "worklog", when: whenAnnualApproved, roleId: "eng-1", activity: "coding", note: "Adding the annual price object to Stripe's product catalog" },
  { id: "e037", ts: 63, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-switch-flow", status: "in_progress", byRoleId: "eng-2" },
  { id: "e038", ts: 65, type: "worklog", when: whenAnnualApproved, roleId: "eng-2", activity: "coding", note: "Building the plan-switch UI in account settings" },
  { id: "e039", ts: 70, type: "message_sent", when: whenAnnualApproved, fromRoleId: "eng-lead", toRoleId: "eng-2", gist: "Keep the switch flow upgrade-only for now — downgrades route to support until proration lands." },
  { id: "e040", ts: 75, type: "worklog", roleId: "growth-lead", activity: "analyzing", note: "Checking signups now that the Safari upload fix is live" },
  { id: "e041", ts: 78, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-stripe-plan", status: "in_review", byRoleId: "eng-1" },
  { id: "e042", ts: 80, type: "message_sent", when: whenAnnualApproved, fromRoleId: "eng-1", toRoleId: "eng-lead", gist: "Stripe plan is up — $275/yr framed as 2 months free on the price description. Ready for review." },
  { id: "e043", ts: 82, type: "worklog", when: whenAnnualApproved, roleId: "eng-lead", activity: "reviewing", note: "Reviewing the Stripe annual-plan config in test mode" },
  { id: "e044", ts: 84, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-stripe-plan", status: "done", byRoleId: "eng-lead" },
  {
    id: "e045", ts: 85, type: "report_submitted", when: whenAnnualApproved,
    report: { id: "r-stripe-plan", kind: "task", taskId: "t-stripe-plan", departmentId: "dep-eng", authorRoleId: "eng-1", title: "Stripe annual plan live", done: "Added the $275/year plan to the Stripe catalog, price description reads '2 months free vs. monthly.' Verified test-mode checkout and webhook handling for the new price ID." } satisfies Report,
  },
  { id: "e046", ts: 88, type: "worklog", when: whenAnnualApproved, roleId: "analyst", activity: "writing", note: "Drafting the annual-billing announcement email" },
  { id: "e047", ts: 90, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-launch-email", status: "in_progress", byRoleId: "analyst" },

  { id: "e048", ts: 92, type: "worklog", roleId: "growth-lead", activity: "analyzing", note: "Checking week-over-week signups against last month's cohort" },
  { id: "e049", ts: 95, type: "budget_spent", amount: 18, category: "model usage", note: "Agent inference — morning batch (proposal drafting, code review)" },
  { id: "e050", ts: 98, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-switch-flow", status: "in_review", byRoleId: "eng-2" },
  { id: "e051", ts: 100, type: "message_sent", when: whenAnnualApproved, fromRoleId: "eng-2", toRoleId: "eng-lead", gist: "Switch flow's ready for review — upgrade path only, confirmation modal shows the prorated first invoice estimate." },
  { id: "e052", ts: 102, type: "worklog", when: whenAnnualApproved, roleId: "eng-lead", activity: "reviewing", note: "Reviewing the plan-switch flow against Stripe test mode" },
  { id: "e053", ts: 105, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-switch-flow", status: "done", byRoleId: "eng-lead" },
  {
    id: "e054", ts: 106, type: "report_submitted", when: whenAnnualApproved,
    report: { id: "r-switch-flow", kind: "task", taskId: "t-switch-flow", departmentId: "dep-eng", authorRoleId: "eng-2", title: "Plan-switch flow shipped", done: "Account settings now shows an upgrade-to-annual option with a confirmation modal that quotes the exact prorated first charge before the customer confirms. Downgrades still route to support, per Iris's condition." } satisfies Report,
  },
  { id: "e055", ts: 108, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-migration-script", status: "in_progress", byRoleId: "eng-1" },
  { id: "e056", ts: 110, type: "worklog", when: whenAnnualApproved, roleId: "eng-1", activity: "coding", note: "Writing the migration script — backfilling real billing-cycle anchor dates so nobody gets double-charged" },
  { id: "e057", ts: 112, type: "worklog", when: whenAnnualApproved, roleId: "analyst", activity: "writing", note: "Second pass on the announcement email — tightening the subject line" },
  { id: "e058", ts: 115, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-pricing-copy", status: "in_progress", byRoleId: "eng-2" },
  { id: "e059", ts: 118, type: "worklog", when: whenAnnualApproved, roleId: "eng-2", activity: "writing", note: "Updating pricing page copy — annual toggle, '2 months free' framing" },
  { id: "e060", ts: 120, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-launch-email", status: "in_review", byRoleId: "analyst" },
  { id: "e061", ts: 122, type: "message_sent", when: whenAnnualApproved, fromRoleId: "analyst", toRoleId: "growth-lead", gist: "Announcement draft's ready — flagging two subject line options for your call." },
  { id: "e062", ts: 124, type: "worklog", when: whenAnnualApproved, roleId: "growth-lead", activity: "reviewing", note: "Reviewing the annual-billing announcement draft" },
  { id: "e063", ts: 126, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-launch-email", status: "done", byRoleId: "growth-lead" },
  {
    id: "e064", ts: 128, type: "report_submitted", when: whenAnnualApproved,
    report: { id: "r-launch-email", kind: "task", taskId: "t-launch-email", departmentId: "dep-growth", authorRoleId: "analyst", title: "Annual-billing announcement drafted", done: "Email ready to send once the toggle goes live — leads with '2 months free,' links straight to the account settings upgrade flow. Licensed one stock illustration for the header ($85).", spend: 85 } satisfies Report,
  },
  { id: "e065", ts: 130, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-migration-script", status: "blocked", byRoleId: "eng-1" },
  { id: "e066", ts: 131, type: "worklog", when: whenAnnualApproved, roleId: "eng-1", activity: "idle", note: "Blocked — need read access to the production subscriber DB replica to test real billing-cycle dates" },
  { id: "e067", ts: 132, type: "message_sent", when: whenAnnualApproved, fromRoleId: "eng-1", toRoleId: "eng-lead", gist: "Migration script's blocked — I need read access to the prod subscriber replica to test against real billing-cycle dates." },
  { id: "e068", ts: 134, type: "message_sent", when: whenAnnualApproved, fromRoleId: "eng-lead", toRoleId: "cto", gist: "Sam needs read access to the prod subscriber replica to finish the migration script — can you approve?" },
  { id: "e069", ts: 136, type: "worklog", when: whenAnnualApproved, roleId: "cto", activity: "reviewing", note: "Approving scoped read-only replica access for migration testing" },
  { id: "e070", ts: 138, type: "message_sent", when: whenAnnualApproved, fromRoleId: "cto", toRoleId: "eng-1", gist: "Access granted — read-only, replica only, expires end of week." },
  { id: "e071", ts: 140, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-migration-script", status: "in_progress", byRoleId: "eng-1" },
  { id: "e072", ts: 141, type: "worklog", when: whenAnnualApproved, roleId: "eng-1", activity: "coding", note: "Resuming the migration script now that replica access is live" },
  { id: "e073", ts: 144, type: "worklog", when: whenAnnualApproved, roleId: "coo", activity: "meeting", note: "Reviewing support queue ahead of the annual-billing launch" },
  { id: "e074", ts: 148, type: "worklog", when: whenAnnualApproved, roleId: "cfo", activity: "analyzing", note: "Modeling the cash-flow timing of upfront annual payments" },
  { id: "e075", ts: 155, type: "worklog", roleId: "eng-lead", activity: "reviewing", note: "Reviewing the QA plan for billing edge cases" },
  { id: "e076", ts: 158, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-qa-billing", status: "in_progress", byRoleId: "eng-lead" },
  { id: "e077", ts: 160, type: "worklog", when: whenAnnualApproved, roleId: "eng-lead", activity: "coding", note: "Writing test cases for mid-cycle plan switches and failed-payment retry" },

  // --- proposal 2 begins in parallel -----------------------------------
  { id: "e078", ts: 165, type: "drafting_started", proposalId: "prop-cdn", authorRoleId: "cto", title: "Move image hosting to our own CDN" },
  { id: "e079", ts: 168, type: "worklog", roleId: "cto", activity: "writing", note: "Drafting the CDN migration proposal" },
  { id: "e080", ts: 170, type: "message_sent", fromRoleId: "cto", toRoleId: "cfo", gist: "Putting together the CDN migration numbers — want your sign-off on the payback math before I submit." },
  { id: "e081", ts: 172, type: "worklog", when: whenAnnualApproved, roleId: "eng-1", activity: "coding", note: "Migration script dry run against staging — checking edge cases on annual-anchor accounts" },
  { id: "e082", ts: 176, type: "worklog", when: whenAnnualApproved, roleId: "coo", activity: "analyzing", note: "Modeling support-queue volume from annual-billing switch requests" },
  { id: "e083", ts: 180, type: "worklog", when: whenAnnualApproved, roleId: "eng-2", activity: "reviewing", note: "Polishing the pricing page annual toggle copy" },
  { id: "e084", ts: 182, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-migration-script", status: "in_review", byRoleId: "eng-1" },
  { id: "e085", ts: 184, type: "message_sent", when: whenAnnualApproved, fromRoleId: "eng-1", toRoleId: "eng-lead", gist: "Migration script's ready — dry run against staging converted 1,140 of 1,146 subscribers cleanly, 6 flagged for manual review." },
  { id: "e086", ts: 186, type: "worklog", when: whenAnnualApproved, roleId: "eng-lead", activity: "reviewing", note: "Reviewing the migration script's dry-run results" },
  { id: "e087", ts: 190, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-migration-script", status: "done", byRoleId: "eng-lead" },
  {
    id: "e088", ts: 191, type: "report_submitted", when: whenAnnualApproved,
    report: { id: "r-migration-script", kind: "task", taskId: "t-migration-script", departmentId: "dep-eng", authorRoleId: "eng-1", title: "Subscriber migration script ready", done: "Dry run against staging converted 1,140 of 1,146 monthly subscribers cleanly. 6 accounts flagged for manual billing-date review before we run it against production — mostly customers who've paused and resumed mid-cycle." } satisfies Report,
  },
  { id: "e089", ts: 193, type: "worklog", roleId: "analyst", activity: "analyzing", note: "Pulling CAC benchmarks across our current paid channels" },
  { id: "e090", ts: 195, type: "position_submitted", proposalId: "prop-cdn", position: posCooCdn },
  { id: "e091", ts: 197, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-pricing-copy", status: "in_review", byRoleId: "eng-2" },
  { id: "e092", ts: 199, type: "message_sent", when: whenAnnualApproved, fromRoleId: "eng-2", toRoleId: "eng-lead", gist: "Pricing page copy and toggle are ready for review — annual shows as $22.92/mo billed yearly." },
  { id: "e093", ts: 201, type: "worklog", when: whenAnnualApproved, roleId: "eng-lead", activity: "reviewing", note: "Reviewing the pricing page annual toggle" },

  // --- escalation: same-day newsletter placement ----------------------
  { id: "e094", ts: 203, type: "worklog", roleId: "growth-lead", activity: "thinking", note: "Working out the numbers for the newsletter placement ask" },
  {
    id: "e095", ts: 205, type: "escalation_raised",
    escalation: {
      id: "esc-newsletter", fromRoleId: "growth-lead", severity: "urgent",
      reason: "Indie Author Weekly (41,000 subscribers) offered a same-day featured placement in tomorrow's issue, but the $3,500 rate is above my $1,000 approval limit and the slot closes at 5pm today.",
      ask: "Approve $3,500 from the growth budget so we don't lose the slot to a competing website builder.",
      status: "open",
    } satisfies Escalation,
  },
  { id: "e096", ts: 206, type: "worklog", roleId: "growth-lead", activity: "idle", note: "Waiting on placement approval before the 5pm cutoff" },
  { id: "e097", ts: 208, type: "escalation_resolved", auto: true, escalationId: "esc-newsletter", resolution: "Approved — $3,500 fits inside the growth experiment budget and Indie Author Weekly's audience matches our ICP tightly. Booking it now." },
  { id: "e098", ts: 209, type: "budget_spent", amount: 3500, category: "growth - partnerships", departmentId: "dep-growth", note: "Indie Author Weekly newsletter placement" },
  { id: "e099", ts: 210, type: "worklog", roleId: "growth-lead", activity: "writing", note: "Confirming the placement and sending creative to Indie Author Weekly" },
  { id: "e100", ts: 212, type: "message_sent", fromRoleId: "growth-lead", toRoleId: "analyst", gist: "Placement's approved — can you get me a dedicated landing page and UTM link by tomorrow morning?" },
  { id: "e101", ts: 214, type: "worklog", roleId: "analyst", activity: "coding", note: "Setting up a landing page and UTM tracking for the newsletter placement" },

  { id: "e102", ts: 216, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-pricing-copy", status: "done", byRoleId: "eng-lead" },
  {
    id: "e103", ts: 217, type: "report_submitted", when: whenAnnualApproved,
    report: { id: "r-pricing-copy", kind: "task", taskId: "t-pricing-copy", departmentId: "dep-eng", authorRoleId: "eng-2", title: "Pricing page annual toggle live", done: "Pricing page now shows a monthly/annual toggle; annual renders as $22.92/mo billed yearly with the 2-months-free callout. Verified against both plan IDs in Stripe test mode." } satisfies Report,
  },
  { id: "e104", ts: 220, type: "worklog", when: whenAnnualApproved, roleId: "eng-lead", activity: "coding", note: "Running billing edge-case tests against the full annual-billing flow" },
  { id: "e105", ts: 225, type: "position_submitted", proposalId: "prop-cdn", position: posCfoCdn },
  { id: "e106", ts: 230, type: "disagreement_recorded", proposalId: "prop-cdn", disagreement: disagreementCdn },
  { id: "e107", ts: 240, type: "task_status_changed", when: whenAnnualApproved, taskId: "t-qa-billing", status: "done", byRoleId: "eng-lead" },
  {
    id: "e108", ts: 242, type: "report_submitted", when: whenAnnualApproved,
    report: { id: "r-qa-billing", kind: "task", taskId: "t-qa-billing", departmentId: "dep-eng", authorRoleId: "eng-lead", title: "Billing edge cases verified", done: "Tested mid-cycle plan switches, failed-payment retry, and downgrade requests end-to-end. Found and fixed two retry-logic bugs where a failed card kept retrying the old price after a plan switch. Annual billing is ready to open to everyone." } satisfies Report,
  },
  { id: "e109", ts: 245, type: "worklog", roleId: "cto", activity: "writing", note: "Wrapping up the CDN proposal numbers" },
  { id: "e110", ts: 250, type: "message_sent", fromRoleId: "cto", toRoleId: "ceo", gist: "Submitting the CDN proposal now — flagging Marcus's payback objection so you've got both sides." },
  {
    id: "e111", ts: 260, type: "proposal_submitted",
    proposal: {
      id: "prop-cdn",
      title: "Move image hosting to our own CDN",
      authorRoleId: "cto",
      summary: "Move page and cover-image hosting off our current third-party CDN onto a self-hosted CloudFront + S3 setup we control, cutting the recurring bill and giving us image-optimization levers we don't have today.",
      rationale:
        "We currently pay $650/month to our image CDN vendor for transforms and delivery across roughly 9,400 author sites. That bill has grown 40% over the last two quarters as sites and traffic have grown, and we don't control the optimization pipeline — we can't ship WebP-by-default or the responsive srcset work Noa scoped last month without waiting on their roadmap.\n\n" +
        "Standing up our own CloudFront distribution in front of S3, with a Lambda@Edge resize/transform layer, costs an estimated $9,000 to build — three weeks of my time plus infra setup — and drops our recurring bill to roughly $215/month at current traffic. That's a 14-month payback on the build cost; after that we save about $430/month and gain control of the image pipeline.\n\n" +
        "The tradeoff is real: $9,000 is a meaningful chunk of this month's budget, and the migration itself — repointing every existing image URL for 9,400 sites — has to happen with zero broken images, or we hear about it from every customer on the same day.",
      alternatives: [
        "Stay on the current vendor and negotiate volume pricing — likely gets us to ~$500/month with no build cost or migration risk.",
        "Move to a cheaper third-party CDN instead of building our own — smaller savings than self-hosting but a one-week migration instead of three.",
        "Do nothing until traffic growth makes the current bill impossible to ignore — defers both the cost and the benefit.",
      ],
      cost: { amount: 9000, note: "Three weeks of Iris's time plus AWS setup; one-time build cost, not recurring." },
      risks: [
        "Migrating 9,400 sites' image URLs without a broken-image incident requires a careful dual-write cutover — any bug here is customer-visible immediately.",
        "We lose our vendor's managed reliability and take on our own uptime risk for image delivery, a core part of the product experience.",
        "14-month payback assumes flat image-serving costs; if traffic keeps growing at the current rate, payback could be faster — but if it's slower, this quarter's $9,000 was the wrong bet.",
        "Committing $9,000 now overlaps with the annual-billing migration cash outlay already in flight this month.",
      ],
      positions: [posCooCdn, posCfoCdn],
      disagreements: [disagreementCdn],
      status: "pending_approval",
    },
  },
  { id: "e112", ts: 262, type: "ceo_decision", proposalId: "prop-cdn", decision: "returned", auto: true, note: "Not yet — get me real bandwidth numbers from the last 90 days before we commit $9,000. Revisit next week." },
  { id: "e113", ts: 264, type: "message_sent", when: whenCdnReturned, fromRoleId: "cto", toRoleId: "cfo", gist: "Fair. Pulling 90 days of bandwidth logs so the payback number isn't a guess." },

  { id: "e114", ts: 270, type: "worklog", roleId: "analyst", activity: "analyzing", note: "Building a CAC model for the podcast sponsorship pitch" },
  { id: "e115", ts: 275, type: "worklog", roleId: "growth-lead", activity: "writing", note: "Drafting the podcast sponsorship proposal" },
  { id: "e116", ts: 280, type: "budget_spent", amount: 22, category: "model usage", note: "Agent inference — midday batch (proposal review, QA test generation)" },
  { id: "e117", ts: 285, type: "worklog", roleId: "eng-2", activity: "reviewing", note: "Confirmed the Safari upload timeout fix is holding in production — zero timeouts in the last two hours" },
  { id: "e118", ts: 290, type: "worklog", when: whenAnnualApproved, roleId: "coo", activity: "reviewing", note: "Auditing the support queue ahead of annual-billing GA" },
  { id: "e119", ts: 300, type: "worklog", roleId: "cfo", activity: "analyzing", note: "Closing out the newsletter placement spend against this month's growth line" },
  { id: "e120", ts: 305, type: "worklog", roleId: "analyst", activity: "analyzing", note: "Modeling break-even CAC for the podcast test" },
  { id: "e121", ts: 310, type: "drafting_started", proposalId: "prop-podcast", authorRoleId: "growth-lead", title: "Run a 4-week podcast sponsorship test, $2,400" },
  { id: "e122", ts: 315, type: "worklog", roleId: "eng-1", activity: "coding", note: "Cleaning up feature flags left over from the Safari upload fix" },
  { id: "e123", ts: 320, type: "position_submitted", proposalId: "prop-podcast", position: posCooPodcast },
  { id: "e124", ts: 330, type: "position_submitted", proposalId: "prop-podcast", position: posAnalystPodcast },
  { id: "e125", ts: 340, type: "position_submitted", proposalId: "prop-podcast", position: posCfoPodcast },
  { id: "e126", ts: 345, type: "message_sent", fromRoleId: "growth-lead", toRoleId: "ceo", gist: "Podcast test proposal is in — capped at $2,400, Marcus wants a CAC kill-switch at $40." },
  { id: "e127", ts: 350, type: "worklog", when: whenAnnualApproved, roleId: "eng-lead", activity: "meeting", note: "Planning next sprint: proration support for plan downgrades" },
  { id: "e128", ts: 355, type: "worklog", when: whenAnnualApproved, roleId: "cto", activity: "thinking", note: "Sketching the proration design doc for next sprint" },
  { id: "e129", ts: 360, type: "budget_spent", amount: 68, category: "infra", note: "Image storage and bandwidth — third-party CDN, afternoon traffic" },
  { id: "e130", ts: 365, type: "worklog", roleId: "growth-lead", activity: "reviewing", note: "Checking early click numbers from the newsletter placement" },
  {
    id: "e131", ts: 378, type: "proposal_submitted",
    proposal: {
      id: "prop-podcast",
      title: "Run a 4-week podcast sponsorship test, $2,400",
      authorRoleId: "growth-lead",
      summary: "Run a four-week sponsorship test across two indie-author podcasts — $2,400 total, capped — to see if podcast audiences convert at a better CAC than our current paid channels.",
      rationale:
        "Our blended paid CAC has held at $54 for two months, mostly from search ads competing for the same six keywords every website-builder competitor bids on. Self-Published Now (8,200 weekly listeners) and Indie Author Hour (5,100 weekly listeners) both reach exactly our ICP — working authors who need a site, not a hobbyist audience — and neither is currently running ads for any competitor.\n\n" +
        "$2,400 buys a 4-week mid-roll sponsorship on both shows with a dedicated promo code, split $1,200 each. If the podcast channel converts even 60 trials at a $40 blended CAC, that's break-even against our current paid CAC with an audience we haven't tapped yet — and either show has room to become a recurring monthly line if it works.",
      alternatives: [
        "Skip podcasts, put the $2,400 toward another paid-search push — safer, but competing on the same saturated keywords.",
        "Run a smaller single-show test at $1,200 for two weeks — lower risk, but not enough volume to read CAC with confidence.",
        "Wait for the newsletter placement results before committing to a second new channel this month.",
      ],
      cost: { amount: 2400, note: "$1,200 per show, 4-week mid-roll sponsorship with dedicated promo codes; paid as a deposit today, balance due at week 2." },
      risks: [
        "Podcast attribution is soft — promo-code redemption undercounts anyone who signs up later without using the code.",
        "Two shows isn't a large enough sample to generalize about podcast advertising broadly, just about these two shows.",
        "We're already carrying the newsletter placement spend this month — a second growth bet in the same week makes the growth budget line lumpy.",
        "If early CAC looks bad, killing the test at week 2 still leaves the week-1 spend sunk.",
      ],
      positions: [posCooPodcast, posAnalystPodcast, posCfoPodcast],
      disagreements: [],
      status: "pending_approval",
    },
  },
  { id: "e132", ts: 380, type: "ceo_decision", proposalId: "prop-podcast", decision: "approved", auto: true, note: "Approved — Marcus's cap and kill-switch stand. Check CAC weekly." },
  { id: "e133", ts: 381, type: "tasks_created", proposalId: "prop-podcast", tasks: tasksPodcast },
  { id: "e134", ts: 383, type: "task_status_changed", taskId: "t-podcast-tracking", status: "in_progress", byRoleId: "analyst" },
  { id: "e135", ts: 385, type: "worklog", roleId: "analyst", activity: "coding", note: "Building promo-code redemption tracking for the podcast test" },
  { id: "e136", ts: 390, type: "task_status_changed", taskId: "t-podcast-creative", status: "in_progress", byRoleId: "growth-lead" },
  { id: "e137", ts: 395, type: "worklog", roleId: "growth-lead", activity: "meeting", note: "Recording the sponsor read with Self-Published Now's hosts" },
  { id: "e138", ts: 400, type: "budget_spent", amount: 1200, category: "growth - podcast sponsorship", departmentId: "dep-growth", note: "50% deposit — Self-Published Now and Indie Author Hour, 4-week test (total contracted $2,400)" },
  { id: "e139", ts: 405, type: "worklog", when: whenAnnualApproved, roleId: "eng-2", activity: "coding", note: "Checkout perf pass — cut render-blocking scripts, publish-pipeline p95 down from 4.1s to 2.6s" },
  { id: "e140", ts: 410, type: "worklog", when: whenAnnualApproved, roleId: "eng-1", activity: "idle", note: "Wrapping up billing follow-ups; picking up the proration design spike for next sprint" },
  { id: "e141", ts: 420, type: "budget_spent", amount: 24, category: "model usage", note: "Agent inference — afternoon batch (drafting, QA)" },
  { id: "e142", ts: 430, type: "task_status_changed", taskId: "t-podcast-tracking", status: "in_review", byRoleId: "analyst" },
  { id: "e143", ts: 432, type: "message_sent", fromRoleId: "analyst", toRoleId: "growth-lead", gist: "UTM and promo-code tracking are live — dashboard splits CAC by show and by week." },
  { id: "e144", ts: 435, type: "task_status_changed", taskId: "t-podcast-tracking", status: "done", byRoleId: "analyst" },
  {
    id: "e145", ts: 437, type: "report_submitted",
    report: { id: "r-podcast-tracking", kind: "task", taskId: "t-podcast-tracking", departmentId: "dep-growth", authorRoleId: "analyst", title: "Podcast CAC tracking live", done: "Promo codes and UTM links are live for both shows. CAC dashboard updates nightly and flags red if blended CAC clears the $40 kill-switch." } satisfies Report,
  },
  { id: "e146", ts: 445, type: "worklog", roleId: "growth-lead", activity: "writing", note: "Editing the sponsor read audio ahead of Friday's episode drop" },
  { id: "e147", ts: 455, type: "worklog", when: whenAnnualApproved, roleId: "eng-lead", activity: "reviewing", note: "Final pass on the annual-billing rollout checklist" },
  { id: "e148", ts: 465, type: "worklog", roleId: "cfo", activity: "analyzing", note: "Closing out today's spend against the growth and infra lines" },
  { id: "e149", ts: 475, type: "worklog", roleId: "coo", activity: "writing", note: "Drafting the end-of-day summary" },
  { id: "e150", ts: 485, type: "message_sent", fromRoleId: "growth-lead", toRoleId: "ceo", gist: "First two hours of the newsletter placement: 340 clicks, 11 trial signups — full numbers tomorrow." },
  { id: "e151", ts: 490, type: "worklog", roleId: "analyst", activity: "analyzing", note: "Finalizing the CAC dashboard baseline ahead of tomorrow's podcast launch" },
  {
    id: "e152", ts: 500, type: "report_submitted", when: whenAnnualApproved,
    report: {
      id: "r-eng-eod", kind: "periodic", departmentId: "dep-eng", authorRoleId: "eng-lead",
      title: "Annual billing — ready for GA",
      done: "All five engineering tasks are shipped and QA'd — Stripe plan, switch flow, migration script, pricing copy, billing edge cases. Migration script dry run flagged 6 of 1,146 accounts for manual review before we run it live.",
      needsFromCeo: "Say go/no-go on running the subscriber migration script live tomorrow morning, and whether you want a soft launch or to open annual billing to everyone at once.",
    } satisfies Report,
  },
  {
    id: "e153", ts: 515, type: "report_submitted", when: whenAnnualApproved,
    report: {
      id: "r-eod-approved", kind: "periodic", authorRoleId: "coo",
      title: "End of day — Sept 11",
      done: "Annual billing shipped end-to-end, pending tomorrow's live migration run. The Indie Author Weekly newsletter placement went out this afternoon — early clicks strong. The podcast sponsorship test is underway, two of three tasks started. The CDN proposal came back for more data — no spend committed there.",
      deviations: "The newsletter placement ($3,500) and podcast deposit ($1,200) weren't in this week's growth plan — both came in same-day and Felix flagged them before spending.",
      needsFromCeo: "Go/no-go on tomorrow's live subscriber migration, and whether annual billing launches to everyone at once or in a soft rollout.",
    } satisfies Report,
  },
  {
    id: "e154", ts: 517, type: "report_submitted", when: whenAnnualRejected,
    report: {
      id: "r-eod-rejected", kind: "periodic", authorRoleId: "coo",
      title: "End of day — Sept 11",
      done: "Pricing stays as-is for now — the annual-billing pitch is back with Marcus for another pass. The Indie Author Weekly newsletter placement went out this afternoon and the podcast sponsorship test is underway; early signals look good on both.",
      needsFromCeo: "None outstanding — Marcus will have a sharper annual-billing number next week.",
    } satisfies Report,
  },
  { id: "e155", ts: 525, type: "worklog", when: whenAnnualApproved, roleId: "cto", activity: "idle", note: "Wrapping up — proration design doc drafted for tomorrow's review" },
  { id: "e156", ts: 530, type: "worklog", when: whenAnnualApproved, roleId: "eng-1", activity: "idle", note: "Signing off — migration script's ready for tomorrow's live run" },
  { id: "e157", ts: 535, type: "worklog", roleId: "growth-lead", activity: "idle", note: "Signing off — podcast creative locked, tracking live for launch" },
  { id: "e158", ts: 540, type: "day_ended" },
];
