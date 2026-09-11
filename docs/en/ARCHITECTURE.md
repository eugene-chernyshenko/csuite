# Architecture

## Form: a Service, API-first

The platform is a continuously running service (not a CLI session): database + API + agent workers + the "CEO desk" web UI. The same service deploys three ways as it grows:

1. **Locally** (docker compose, single tenant) — the dogfood stage;
2. **Open-source core** — the same thing, self-hosted by others;
3. **SaaS** — multi-tenant. To keep that path open: `company_id` on every entity from day one, no local-disk state as a source of truth, asset secrets in a per-company store.

## Layers of Rigidity (how features get added)

Rule: the closer to process semantics, the more rigid.

| Layer | What it is | How it changes |
|---|---|---|
| **Kernel** | Decision lifecycle, approval gates, authority limits, event log, budgets | Code. Rarely, deliberately. This is the "constitution" — the guarantee that agents cannot rewrite their own authority |
| **Roles/departments** | Mandate, model, tool allowlist, reporting cadence, limits | Configuration (a role manifest). New department = new manifest, no code |
| **Skills** | SOPs for "how work gets done": how we review code, how we compute unit economics, how we write a report | Markdown documents in the company library. Added on the fly. Meta-loop: an agent notices a systemic problem → drafts an SOP → proposal → CEO approves → the skill lands in the library |
| **Integrations** | External systems (git hosts, CRM, bank, analytics) | MCP adapters + a line in a role's allowlist. Never touches the kernel |

## Model Access: OpenRouter

All of the platform's LLM calls go through **OpenRouter** as a single gateway:

- **The model is a role-configuration field**, not a hardwired vendor: the board can run different models on different roles (which directly reinforces the adversarial-deliberation principle); switching a model = editing a manifest.
- **One key, unified billing** — per-model spend is visible in one place and flows directly into the company's opex (the CFO's domain) and into event-log telemetry (call cost is recorded on the event).
- **OpenRouter's fallbacks and limits** serve as the first line of fault tolerance.

Caveat: the IT-worker runner built on the Claude Agent SDK requires the Anthropic Messages API; whether that format works through OpenRouter (or requires a shim like LiteLLM / a separate direct channel for the runner) must be verified in a spike — see open questions.

## Company Memory: Database + Platform API

The organization's state lives in Postgres. Core entities: `Company`, `Role`, `Proposal` (+ C-level positions and disagreements), `Initiative`/`Task`, `Report`, `Escalation`, `Skill`, `Asset`, `Event`.

**Agents access company memory only through the platform API** (the platform exposes its own MCP to agents: `propose_decision`, `claim_task`, `submit_report`, `escalate`, ...). No raw files: every call passes validation (required report fields, authority-level checks) and lands in the event log automatically. The API is the "labor code" in executable form; this is where determinism lives.

**The event log is the foundation, not a feature.** Every action is an append-only event. From it: the audit trail, company telemetry (decision throughput, department cycle time, money/token spend vs. budget), and the material for periodic reports.

## Tasks

The source of truth is the platform database (Task with an owning department, dependencies, a status model, and a link to the decision that spawned it). External trackers plug in later as **projections** through a `TaskBackend` interface (first candidate — GitHub Issues for IT departments: tasks next to the code, PRs, visibility for humans). Process semantics are never coupled to a third-party data model.

## Assets

The asset registry: type (git repo, cloud, ad account, document store), owning department, access method (MCP server / CLI), credentials. There may be several product repositories; deliverables live in assets, the company's internal state never does.

## Agent Execution

- **Process orchestration** — a deterministic graph with durable gates: at the "waiting for CEO" step, state is persisted, nothing spins or burns tokens, and the wait can last hours or days. Candidates: LangGraph (`interrupt()` + Postgres checkpointer) or Temporal; to be chosen in a technical spike.
- **Worker agents** — stateless per-task agent runs: for IT tasks the natural runner is the Claude Agent SDK (headless) sandboxed with access to the asset; for document tasks, direct LLM calls with platform tools. One stateful loop per initiative; workers are disposable.
- **Wake-ups** — event-driven: task arrival, dependency completion, reporting-cycle cron, escalation.

## Analytics — Two Distinct Loops

1. **Company telemetry** (built-in): the CEO dashboard over the event log — decision throughput, cycle time, budgets, stalling departments.
2. **Domain business analytics** (department work): the analytics department queries real sources (the product's DB, payment providers, web analytics) through MCP integrations and produces report artifacts. The platform provides the source-connection mechanism, not ready-made dashboards.

## The "CEO Desk" UI

Not a chat but an executive workspace: an inbox of decisions pending approval (with the board's positions and disagreements), a report feed, escalations, a telemetry dashboard, the roadmap. Drill-down to any level (down to worker traces) — on demand, not by default. Chat with any role — an additional channel, not the primary one.

## Open Questions (next spikes)

- LangGraph vs Temporal for durable orchestration (criteria: self-hosted ops complexity, audit history, HITL ergonomics).
- The IT-worker runner: Claude Agent SDK headless vs a custom loop over the API — cost, sandboxing, limits; and its OpenRouter compatibility (Anthropic Messages API through the gateway, a LiteLLM shim, or a direct channel as the exception).
- Role and skill manifest format (compatibility with Agent Skills / Claude's subagent format, to avoid inventing our own).
- The permission model for asset MCP adapters (how to confine a department's "hands" to its own asset).
- The first dogfood company: which real project with real money do we hand over to management.
