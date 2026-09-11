/**
 * The board runner — Phase 1's centrepiece, currently a stub.
 *
 * Its finished job (ROADMAP Phase 1) is: a strategic question in → each C-level
 * agent writes an **independent position, blind to the others** (distinct
 * mandates, ideally distinct models, all via OpenRouter) → synthesis that
 * *records* disagreements rather than smoothing them → one `proposal_submitted`
 * event that lands in the same CEO inbox the Phase 0 demo already renders.
 *
 * None of that exists yet: there is no OpenRouter key in this environment, and
 * inventing positions locally would be exactly the "mocked and real are
 * indistinguishable" failure CLAUDE.md forbids. So the honest behaviour for now
 * is to say so, in the log, where the UI can see it.
 */

import type { EventStore } from "../store/types";

export interface BoardDeps {
  store: EventStore;
  /** Present when an OpenRouter key is configured. */
  apiKey?: string | undefined;
  log?: { warn(msg: string): void; info(msg: string): void };
}

/** Role id the offline notice is attributed to. Real positions will use real role ids. */
const BOARD_ROLE_ID = "board";

export async function runBoard(
  companyId: string,
  questionText: string,
  deps: BoardDeps,
): Promise<void> {
  const { store, apiKey, log } = deps;

  if (!apiKey) {
    const message =
      "Board is OFFLINE: OPENROUTER_API_KEY is not set. The question was recorded in the " +
      "event log, but no C-level positions will be produced and no proposal will reach the " +
      "CEO desk. Set OPENROUTER_API_KEY in the repo-root .env and ask again.";
    log?.warn(`[board] ${message} (company=${companyId})`);
    await store.appendEvents(companyId, [
      {
        type: "worklog",
        roleId: BOARD_ROLE_ID,
        activity: "idle",
        note: `Board offline — no OpenRouter key configured. Question left unanswered: "${truncate(questionText)}"`,
      },
    ]);
    return;
  }

  // ------------------------------------------------------------------ TODO
  // TODO(phase-1): this is the seam. With a key present, run:
  //   1. fan out one OpenRouter call per board role, each blind to the others,
  //      prompted only with its own mandate + the question + company config;
  //      append `worklog` (thinking) and then `position_submitted` per role;
  //   2. synthesise: collect stances, diff them, append
  //      `disagreement_recorded` for every genuine conflict — never merge them
  //      away, the CEO is supposed to see the fight;
  //   3. append `proposal_submitted` with the assembled Proposal document
  //      (summary, rationale, alternatives, cost, risks, positions,
  //      disagreements) so it arrives as `pending_approval`;
  //   4. record spend: one `budget_spent` event per call, category "llm",
  //      from OpenRouter's reported cost — that is the CFO's opex line.
  // Model per role comes from `Role.model` in the company config; the vendor is
  // never hardwired (docs/en/ARCHITECTURE.md).
  // ---------------------------------------------------------------------
  log?.info(
    `[board] OPENROUTER_API_KEY present but the deliberation loop is not implemented yet; ` +
      `no positions produced (company=${companyId})`,
  );
}

function truncate(text: string, max = 160): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
