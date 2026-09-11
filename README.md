# csuite

**Your AI C-suite: a company of agents with a human CEO.**

You run the company. Everyone else — the board of directors, department heads, workers — is an AI agent. You set strategic goals; your C-level agents deliberate and bring you decisions to approve; approved decisions become a roadmap; departments execute; reports and escalations flow back to your desk. Not just for software — departments can own code, analytics, marketing, finance.

## Why this isn't another agent chat

Most agent tools give you one main agent and one input box. csuite is a **management layer**:

- **The core object is a decision, not a message.** Every proposal has an author, rationale, cost, risks, and the board's *recorded disagreements* — then a lifecycle: pending approval → approved → in progress → report.
- **Your attention is protected by authority limits.** Only approvals, reports, and escalations reach you. Everything below runs within budgets and permissions you've granted. Drill down anytime; get flooded never.
- **The board is not a group chat.** C-level agents write independent positions blind to each other, with adversarial mandates (the CFO attacks the economics, the CTO attacks the risks). Disagreements are shown to you, not smoothed into fake consensus.
- **Deterministic skeleton, LLMs in the nodes.** The org structure, decision lifecycle, and approval gates are code and configuration — not an LLM improvising management.

## Status

Early design stage — documentation only, no code yet. Next milestone: a clickable demo UI ([Phase 0](docs/ROADMAP.md)).

## Docs

- [Concept](docs/en/CONCEPT.md) ([ru](docs/ru/CONCEPT.md)) — vision, roles, the decision-making process, research grounding
- [Architecture](docs/en/ARCHITECTURE.md) ([ru](docs/ru/ARCHITECTURE.md)) — service form, company memory vs. assets, layers of rigidity, agent execution
- [Roadmap](docs/ROADMAP.md) — wow first, truth second, scale third
