# Concept: A Company of Agents with a Human CEO

## Vision

A service where the user is the CEO of a real (if small) company, and the entire organization beneath them consists of AI agents: a board of directors (C-level), departments, and workers. The CEO sets strategic tasks, the board works them through and brings decisions up for approval, approved decisions are broken down into a roadmap and executed by departments, and reports and escalations flow back up.

This is not an "office" visualization on top of chats (there are many such projects, and all of them are read-only theater), but a **management layer**: process, authority, decisions, reporting. Applicable beyond IT products — departments work with any kind of asset: code, analytics, finance, marketing.

## The Key Shift from Existing Tools

Claude Code and its peers are "one main agent + one input box." The model here is different:

- **The primary UX object is a decision (proposal), not a chat message.** A decision has an author, rationale, alternatives, cost, risks, the board's recorded disagreements, and a status: draft → pending approval → approved/rejected → in progress → report.
- **The CEO's attention is protected by authority limits.** Only decisions pending approval, reports, and escalations reach the CEO. Everything else the board and departments resolve within their limits (budget up to X — on their own; external actions — only through the CEO). Drilling down to any level is possible, but by default the kitchen noise does not flood upward.
- **Transparency through artifacts.** The company's state is readable from the decision log, roadmap, reports, and event log — without excavating chat histories.

## Roles

A role is a durable context, not a disposable subagent. Each role has a mandate (a domain of stewardship), authority limits, tools, and a reporting cadence. All roles share one goal: lead the company to success — grow the business, expand its markets, lose neither money nor customer trust. A mandate is a point of view, not a combat stance: a role neither "attacks" nor cheerleads; it answers for its domain.

- **CEO — a human.** The only human in the system, the top of the hierarchy.
- **C-level (the board):** e.g. CTO (technical risk, architecture), CFO (the project's money: budget, P&L, unit economics — tokens are merely a line item in opex), COO (operations, deadlines). The composition is configurable.
- **Chief of Staff — the process role.** Not a board member: it writes no position, takes no business stance and never votes. Its mandate is the CEO's attention and the integrity of the decision process — it triages questions before the board takes them up, and it writes the document the CEO reads. Optional: a company configured without it simply loses both.
- **Departments and workers:** engineers, testers, analysts, marketers — per the company's needs.

## The Decision-Making Process

The board is not a group chat. It is well documented (AI Village, sycophancy research) that a flat agent chat propagates errors socially and produces fake consensus.

1. The CEO sets a strategic task.
2. Each C-level agent writes an **independent position without seeing the others** — from its own domain (the CFO judges the money, the CTO the technology and risk), grounded in company data: the dossier, financial summaries, metrics, the decision log, tasks. The board must be able to **query** the data it needs rather than receive everything at once — company context is large and not all of it is relevant to every question.
3. A synthesis step merges the positions into a decision; **disagreements are recorded and shown to the CEO**, not smoothed over.
4. The CEO approves / rejects / returns with questions.
5. The approved decision is decomposed into a roadmap; tasks are distributed across departments.
6. Execution → per-task reports + periodic department reports → the CEO's dashboard.

Full deliberation happens only on strategic decisions. Operational work takes the cheap path with no "meetings" (ritual debate is expensive and performative — confirmed by research).

## Two Spaces

- **Company memory** — the organization's state: decisions, roadmap, tasks, reports, event log, role configs, the skills library. Lives in the platform's storage (a database). Never mixed with deliverables.
- **Company assets** — what the company works on: product git repositories (there may be several), ad accounts, cloud accounts, documents. An asset registry records which department owns what and through which tools it operates. Git is an asset type and an IT-department tool, not the system's foundation.

## Principles (research findings, Sep 2026)

1. **Deterministic skeleton, LLMs in the nodes.** Org structure, decision lifecycle, gates, and cadences are code/configuration, not an LLM "manager" improvising. (MAST: most multi-agent system failures are organizational-design failures.)
2. **Documents as the communication medium.** Agents exchange structured artifacts, not chat paraphrases — this cures the "telephone game" (MetaGPT's lesson).
3. **One stateful loop per workstream; stateless workers.** Hierarchy lives in the data (task tree, ownership), not in agent nesting depth (Cognition's lesson).
4. **Stewardship instead of attack or cheerleading.** Validated by golden-case evals (Sep 2026): "attack X" mandates produce a wall of unanimous objections (the board rejected even cheap backups), while "be contrarian" instructions manufacture theatrical disagreement (the board conditionally accepted casino ads). What works: a shared goal + a domain of stewardship + an explicit disagreement protocol — dissent is recorded when it is earned, not when it is assigned.
5. **Design for regular failure.** The industry's honest baseline is 30–43% completion of realistic office tasks (TheAgentCompany, NeurIPS 2025). Hence mandatory acceptance gates, task returns, escalations.
6. **Event-driven economics.** Agents wake on events and schedules; nothing spins forever.

## Product Trajectory

A service from day one (not a local toy): first run locally for ourselves (dogfood), possibly open-source the core, and **SaaS stays on the planning horizon** — architectural decisions must not paint us into a single-tenant/single-machine corner.
