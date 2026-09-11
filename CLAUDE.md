# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A service where a human user is the CEO of a company whose entire organization — board of directors (C-level), departments, workers — consists of AI agents. The primary UX object is a **Proposal** (decision with lifecycle: draft → pending approval → approved/rejected → in progress → report), not a chat. Read `docs/en/CONCEPT.md` and `docs/en/ARCHITECTURE.md` before making design decisions; `docs/ROADMAP.md` defines the build order.

**Current state:** npm-workspaces monorepo. `web/` — the Phase 0 demo UI (Next.js 15: Floor/Desk/Reports/Metrics over an event-sourced sim store playing a scripted day). `packages/contract` — the frozen v0 contract (`@csuite/contract`: types, events, pure reducer) shared by web and server. `server/` — the Phase 1 platform core (Fastify + Postgres via drizzle: append-only event log, decision-lifecycle API, board runner seam in `src/board/run.ts`). `docker compose up -d` for Postgres; `npm run dev -w server` / `-w web`; tests: `npm run test -w server`. LLM calls go through OpenRouter (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` in root `.env`); default model is cheap (`openai/gpt-5.6-luna`) — cap `max_tokens` on every call and never add retry loops or bulk runs without the owner's ask.

## Non-Negotiable Design Decisions

These were set explicitly by the project owner; do not drift from them:

- **The CEO is the human user, never an agent.** Topology: human CEO → C-level agents → departments → workers.
- **The CFO agent's domain is real project money** (budget, P&L, unit economics). Token/model spend is just one opex line item, not the CFO's essence.
- **This is a service, not a local toy.** State lives in a database (Postgres), API-first, no file-based task storage as a source of truth. Trajectory: local docker-compose → possibly open-source core → SaaS. Multi-tenant must never be painted out (`company_id` on every entity, no local-disk state, per-company secrets).
- **Two separated spaces:** company memory (decisions, tasks, reports, event log, role configs, skills — in the platform DB) vs. company assets (product git repos — possibly several — ad accounts, clouds). Git is an asset type, never the company's memory.
- **Agents access company memory only through the platform API/MCP** (`propose_decision`, `claim_task`, `submit_report`, `escalate`) — validation, authority checks, and event-log writes happen there.
- **All LLM calls go through OpenRouter.** The model is a role-config field, not a hardwired vendor.
- **The board is not a group chat:** C-level agents write independent positions blind to each other (distinct mandates, ideally distinct models); disagreements are recorded and shown to the CEO, never smoothed over.
- **Layers of rigidity:** kernel (decision lifecycle, gates, authority limits, event log) = code; roles/departments = config manifests; SOPs = markdown skills; external systems = MCP adapters.
- **Taska (the owner's task tracker) is out of scope** — do not propose it as a backend or use its MCP for this project.

## Documentation Conventions

- All docs live in `docs/`.
- Bilingual docs are mirrored: `docs/ru/<NAME>.md` and `docs/en/<NAME>.md`. **When you change one, update its pair in the same commit.**
- Single-language docs (currently only `ROADMAP.md`, English-only) go directly in `docs/`, not in a language folder.

## Roadmap Discipline

- Wow first, truth second, scale third: demo UI on mocks (Phase 0) → real board deliberation (Phase 1) → one IT department that actually delivers with substantive acceptance gates (Phase 2) → hardening, non-IT departments, product.
- Mocks are shaped as the real API contract; later phases swap the transport, not the shapes.
- Mocked vs. real components must always be distinguishable internally.
- Kill criteria are first-class: Phase 1 may kill the deliberation design, Phase 2 may kill the autonomy assumption.
