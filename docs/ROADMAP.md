# Roadmap

> This document is maintained in English only (project convention: all other docs are mirrored ru/en).

Guiding idea: **wow first, truth second, scale third.** We open with a demo UI on mocks to make the vision tangible and sellable, then replace mocks with real agent work slice by slice, and only then harden into a service. Every phase ends with something you can show.

A discipline that keeps the demo honest: **mocks are shaped as the real API contract.** The mock data layer defines the platform's entity schemas (Proposal, Task, Report, Event, Role). Later phases swap the transport, not the shapes — the demo UI becomes the production UI.

---

> **Status (2026-09-12):** Phase 0 shipped and was retired the same week — the demo froze the v0 contract and built the four views, which now run exclusively against the live platform (Phase 1). The scripted-day mode was removed once the real board was more compelling than the mock; the first-touch experience becomes first-run onboarding — your own company, your own first question (Phase 5 note). Phase 1 is functionally complete (live board with context tools, provenance, revision loop, CoS in progress) pending its kill/pivot review.

## Phase 0 — Demo UI on Mocks: "The Wow" 🎬 — DONE, then retired

**Goal:** a clickable, animated demo of the whole vision in minutes, no real agents behind it.

- **The CEO Desk** (web UI): proposal inbox with 2–3 rich mocked proposals — author, rationale, cost, risks, and visibly *disagreeing* board positions (CFO attacks the economics, CTO the risks); approve / reject / return-with-questions actions that move statuses live.
- **The Company at Work — visualization**: an animated org view (board deliberating on a proposal, departments picking up tasks, reports flowing up, an escalation lighting up). Style spike: pixel-office vs. clean org-chart/flow view — pick whichever lands the wow harder. Driven entirely by a scripted mock event stream.
- **Reports feed & telemetry dashboard** on mocked events: decision throughput, department cycle time, budget burn.
- Mock scenario engine: one scripted "day in the company" that can be replayed for any viewer.

**Exit criteria:** a stranger watches a 3-minute walkthrough, understands the product without explanation, and says "I want this." The mock schemas are frozen as the v0 API contract.

## Phase 1 — First Real Vertical Slice: the Board is Alive 🧠

**Goal:** the top of the process runs on real LLMs (via OpenRouter); execution below can stay mocked.

- Strategic task in → real C-level agents write **independent positions** (blind to each other, distinct mandates, optionally distinct models) → synthesis with recorded disagreements → a real Proposal lands in the same inbox from Phase 0.
- CEO approval gate for real: approve/reject/return persists, decomposition into roadmap tasks (execution still simulated).
- Minimal platform core behind the API contract: Postgres, event log (append-only from day one), `propose_decision` / decision lifecycle endpoints.
- Provenance v0: every figure in a proposal links to its source (input document, calculation, or explicit assumption).

**Exit criteria:** we run 5–10 real strategic questions through the board and honestly assess: do independent positions produce *substance* or theater? This is the cheapest kill/pivot point for the deliberation mechanism.

## Phase 2 — Real Execution: One Department That Actually Delivers 🔧

**Goal:** kill the biggest risk — agents that decide but can't do. One IT department, real tasks, real acceptance.

- Asset registry v0 + one product git repository as the first asset.
- Worker runner (Claude Agent SDK headless or custom loop — per the spike, incl. OpenRouter compatibility): stateless task runs, sandboxed to the asset.
- **Acceptance gate on substance**, not form: a reviewer role accepts/returns work; returns and failures are normal, visible flow in the UI.
- Per-task reports; the visualization from Phase 0 now renders *real* events.

**Exit criteria:** a sustained streak of real tasks (target: 10+ in a row) goes task → execution → acceptance → report with no human hand-holding below the CEO. Measured completion rate is on the dashboard — honest numbers, not vibes.

## Phase 3 — The Operating Company: Process Hardening 🏛️

**Goal:** from a demo pipeline to an organization that runs unattended for days.

- Durable orchestration (LangGraph vs Temporal — per spike): "waiting for CEO" costs nothing and survives restarts.
- Authority limits & budgets enforced by the kernel (spend caps, external-action gates, escalations).
- Skills library v0: SOPs as markdown; routine SOP changes approved by COO, authority-changing ones by the CEO.
- Periodic department reports with digest-for-CEO (anomalies up, noise stays down).
- Security pass: per-asset credential scoping, prompt-injection review of every inbound channel (issues, emails, web content).

**Exit criteria:** the company runs a week on a real project with the CEO touching only the desk: approvals, reports, escalations.

## Phase 4 — Beyond IT: the General Company 🏢

**Goal:** prove the domain-agnostic claim.

- Second department of a different nature (analytics or marketing): non-git assets, MCP integrations to real sources, report artifacts.
- CFO with real money: project budget, opex (incl. model spend from the event log), simple P&L on the dashboard.
- Multi-asset portfolio: several repos/assets under one company, cross-department initiatives.

**Exit criteria:** one strategic initiative flows through two departments of different natures end-to-end.

## Phase 5 — From Instrument to Product 🚀

**Goal:** other people can run their own company.

- Open-source core release: docker compose self-host, docs, role/skill manifest format stabilized.
- First-run onboarding instead of any canned demo: create a company, connect a model key, ask your first strategic question — the first "wow" is your own board deliberating your own question within a minute of arrival. No sample-data mode.
- SaaS enablement (kept unblocked since day one): auth, multi-tenant isolation hardening, billing, hosted onboarding — activated when demand justifies it.
- TaskBackend projections (GitHub Issues first) for visibility into external trackers.

**Exit criteria:** a first external user launches a company without us in the loop.

---

## Standing Rules

- Every phase ships a demo; the visualization is never allowed to rot — it upgrades from theater (Phase 0) to a live control plane (Phase 2+).
- Mocked and real components may coexist in any phase, but the UI always marks which is which internally — we never confuse ourselves about what's proven.
- Kill criteria are first-class: Phase 1 can kill the deliberation design, Phase 2 can kill the autonomy assumption. Cheaper to learn it early than to scale it wrong.
