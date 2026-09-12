"use client";

import type { CeoDecision, CompanyConfig, CompanyState, Id } from "@csuite/contract";
import type { TimeScale } from "./time";

/** How the live provider is getting on with the server. */
export type Connection = "connecting" | "online" | "offline";

/**
 * The one store shape the app reads through `useSim`.
 *
 * `LiveProvider` (`./live.tsx`) is the only implementation: a real company
 * over the platform API. Kept as a named shape of its own — rather than
 * inlining it into `live.tsx` — so views (Floor/Desk/Reports/Metrics) declare
 * what they need (`config`, `state`, `awaiting`, `now`, `time`, `decide`,
 * `resolveEscalation`, …) independently of how the provider gets there.
 */
export interface CompanyStore {
  config: CompanyConfig;
  state: CompanyState;
  /** Proposal waiting for the CEO right now (the first, if several). */
  awaiting?: Id;
  /** Now, in epoch milliseconds. Always paired with `time`. */
  now: number;
  time: TimeScale;

  decide(proposalId: Id, decision: CeoDecision, note?: string): void;
  resolveEscalation(escalationId: Id, resolution: string): void;

  /** Company id on the server. */
  companyId: string;
  connection: Connection;
  /** The board has an OpenRouter key and can actually deliberate. */
  boardOnline: boolean;
  /** A question is in flight: asked, no proposal or failure notice back yet. */
  deliberating: boolean;
  /** Last thing that went wrong, already translation-agnostic (server text). */
  notice?: string;
  /** Ask the board a strategic question. */
  ask(text: string): void;
  dismissNotice(): void;
}

export function findAwaiting(state: CompanyState): Id | undefined {
  return Object.values(state.proposals).find((p) => p.status === "pending_approval")?.id;
}
