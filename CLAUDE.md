# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A service where a human user is the CEO of a company whose entire organization — board of directors (C-level), departments, workers — consists of AI agents. The primary UX object is a **Proposal** (decision with lifecycle: draft → pending approval → approved/rejected → in progress → report), not a chat. Read `docs/en/CONCEPT.md` and `docs/en/ARCHITECTURE.md` before making design decisions; `docs/ROADMAP.md` defines the build order.

**Current state:** npm-workspaces monorepo. `web/` — the UI (Next.js 15: Floor/Desk/Reports/Metrics), now in **two modes behind one `useSim` hook**: *demo* (the Phase 0 scripted day + transport bar) and *live* (`src/lib/live.tsx` — a real company polled off the platform API and folded with the shared `reduce()`; "ask the board" strip, connection status, provenance under each board position). Mode toggle in the top bar, `?mode=live` / `?company=` override, `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_COMPANY_ID` configure it. `packages/contract` — the frozen v0 contract (`@csuite/contract`: types, events, pure reducer) shared by web and server. `server/` — the Phase 1 platform core (Fastify + Postgres via drizzle: append-only event log, decision-lifecycle API, live board deliberation in `src/board/` — blind per-role positions via OpenRouter with a context-tool loop (`src/board/context-loop.ts`), synthesis with genuine-disagreement detection, a revision loop (returned-with-questions reconvenes the board; revised proposals carry `revises`), the **Chief of Staff** (`kind: "staff"`) with clarification triage before the board (`src/board/triage.ts`: one cheap call, holds the run with `clarification_requested`, resumes via `POST /clarifications/:id/answer`, never blocks on its own failure) and authorship of the synthesis document, per-run cost logged as a worklog event; company library in `src/library/` — six frontmatter-typed document kinds with Postgres FTS, governance gate on policy/profile, context-tool registry in `src/context/`). `docker compose up -d` for Postgres; `npm run dev -w server` / `-w web`; tests: `npm run test -w server`. LLM calls go through OpenRouter (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` in root `.env`); default model is cheap (`openai/gpt-5.6-luna`) — cap `max_tokens` on every call and never add retry loops or bulk runs without the owner's ask.

## Non-Negotiable Design Decisions

These were set explicitly by the project owner; do not drift from them:

- **The CEO is the human user, never an agent.** Topology: human CEO → C-level agents → departments → workers.
- **The CFO agent's domain is real project money** (budget, P&L, unit economics). Token/model spend is just one opex line item, not the CFO's essence.
- **This is a service, not a local toy.** State lives in a database (Postgres), API-first, no file-based task storage as a source of truth. Trajectory: local docker-compose → possibly open-source core → SaaS. Multi-tenant must never be painted out (`company_id` on every entity, no local-disk state, per-company secrets).
- **Two separated spaces:** company memory (decisions, tasks, reports, event log, role configs, skills — in the platform DB) vs. company assets (product git repos — possibly several — ad accounts, clouds). Git is an asset type, never the company's memory.
- **Agents access company memory only through the platform API/MCP** (`propose_decision`, `claim_task`, `submit_report`, `escalate`) — validation, authority checks, and event-log writes happen there.
- **All LLM calls go through OpenRouter.** The model is a role-config field, not a hardwired vendor.
- **The board is not a group chat:** C-level agents write independent positions blind to each other; disagreements are recorded and shown to the CEO, never smoothed over. Mandates are **domains of stewardship, never attack instructions** — the shared goal is leading the company to success (golden-case evals showed "attack X" mandates reject everything and "be contrarian" instructions fake dissent). Board context: static dossier now, on-demand data access via the platform API later.
- **Layers of rigidity:** kernel (decision lifecycle, gates, authority limits, event log) = code; roles/departments = config manifests; SOPs = markdown skills; external systems = MCP adapters.
- **Taska (the owner's task tracker) is out of scope** — do not propose it as a backend or use its MCP for this project.

## UI Languages (en, ru)

The web UI is bilingual: next-intl without locale routing (cookie `locale`, default `en`), dictionaries in `web/src/messages/en.json` and `web/src/messages/ru.json`, namespaced per view. Rules:

- **Every new user-facing string goes into BOTH dictionaries in the same change** — never hardcode UI text in components, never leave a key missing in one locale.
- Translate product chrome only (buttons, tabs, statuses, stances, activities, empty states, chart titles, aria-labels). Agent-generated content (proposals, positions, reports, worklog notes) is data — never translated by the UI; the live board answers in the language of the CEO's question.
- No concatenation of translated fragments — use ICU parameters ({count}, {name}).
- Money stays `$` + en-US grouping in both locales; clock stays HH:MM.

## Documentation Conventions

- All docs live in `docs/`.
- Bilingual docs are mirrored: `docs/ru/<NAME>.md` and `docs/en/<NAME>.md`. **When you change one, update its pair in the same commit.**
- Single-language docs (currently only `ROADMAP.md`, English-only) go directly in `docs/`, not in a language folder.
- **Docs stay current: after every substantial change** (new subsystem, architectural decision, phase milestone, changed process), update the affected docs — `docs/en/ARCHITECTURE.md` + `docs/ru/ARCHITECTURE.md`, `docs/ROADMAP.md` phase status, and the "Current state" section of this file — in the same piece of work, not "later".

## Roadmap Discipline

- Wow first, truth second, scale third: demo UI on mocks (Phase 0) → real board deliberation (Phase 1) → one IT department that actually delivers with substantive acceptance gates (Phase 2) → hardening, non-IT departments, product.
- Mocks are shaped as the real API contract; later phases swap the transport, not the shapes.
- Mocked vs. real components must always be distinguishable internally.
- Kill criteria are first-class: Phase 1 may kill the deliberation design, Phase 2 may kill the autonomy assumption.
