# csuite — Phase 0 design system

Personality: an executive instrument, not a dashboard template. The metaphor is **paper and signature ink** — decisions are documents, approving is signing, rejecting is the red pencil. The one bold, kinetic element of the app is the **Floor** (the living org view) plus the day timeline; everything else (Desk, Reports, Metrics) stays quiet, precise, document-like.

## Tokens (defined in `src/app/globals.css` via `@theme`)

Colors (light, committed — no dark mode in Phase 0):

- `--color-paper` `#FAFAF7` — app background
- `--color-sheet` `#FFFFFF` — cards/documents
- `--color-ink` `#181A20` — primary text
- `--color-ink-soft` `#5C616E` — secondary text
- `--color-line` `#E5E5DF` — hairlines, borders
- `--color-sign` `#2937A8` — signature ink: primary actions, approved states, links
- `--color-pencil` `#C03A21` — red pencil: reject, escalations, blocked
- `--color-ledger` `#1F7A4D` — done, on-budget, delivered
- `--color-hold` `#A87A1F` — pending approval, waiting states

Fonts (loaded in `layout.tsx`, exposed as CSS vars):

- `--font-sans` IBM Plex Sans — UI, labels, navigation
- `--font-serif` Source Serif 4 — proposal/report bodies, rationale, anything that reads as a document
- `--font-mono` IBM Plex Mono — numbers, money, timestamps, event ticks (use `tabular-nums`)

Tailwind classes are available for all of these: `bg-paper`, `text-ink`, `text-ink-soft`, `border-line`, `text-sign`, `bg-sign`, `text-pencil`, `text-ledger`, `text-hold`, `font-sans`, `font-serif`, `font-mono`.

## Rules

- Sentence case everywhere. No ALL-CAPS labels, no tracked-out eyebrow labels, no `→` appended to buttons.
- Buttons say what they do: "Approve", "Return with questions", "Reject".
- Borders and rules encode structure (a document has a rule under its header because it separates metadata from body), never decoration. Prefer hairline `border-line` over shadows; shadows only to lift a truly floating layer (modal, popover).
- Radius: 6px (`rounded-md`) for cards and buttons; do not mix many radii.
- Money and metrics always `font-mono` with `tabular-nums`. Format money as `$12,400`.
- Status colors are semantic only (sign/pencil/ledger/hold) — never decorative washes or gradients.
- Motion: the Floor may be alive (agents pulse while working, documents fly along links, escalations flash once). Desk/Reports/Metrics: motion only answers user actions (expand, confirm) — no scroll reveals, no entrance cascades.
- Copy voice: plain verbs, specific and calm, written from the CEO's point of view ("Waiting for your decision", "Engineering delivered 3 of 4 tasks"). Line length under 80ch for serif bodies.
- Respect `prefers-reduced-motion`: disable ambient Floor animation, keep state changes instant.
