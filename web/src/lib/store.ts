"use client";

import { create } from "zustand";
import {
  apply,
  emptyState,
  DAY_MINUTES,
  type CeoDecision,
  type CompanyConfig,
  type CompanyEvent,
  type CompanyState,
  type Id,
} from "@csuite/contract";
import { SIM_TIME, type TimeScale } from "./time";

/**
 * Walk the merged (scenario + live) timeline up to `until`, honoring branches:
 * - auto CEO decisions are skipped unless autopilot is on;
 * - any ceo_decision for an already-decided proposal is skipped;
 * - `when`-conditioned events apply only if the actual decision matches.
 */
function reduceTimeline(
  scenario: CompanyEvent[],
  live: CompanyEvent[],
  until: number,
  autopilot: boolean,
): CompanyState {
  const merged = [...scenario, ...live].sort((a, b) => a.ts - b.ts);
  const state = emptyState();
  for (const ev of merged) {
    if (ev.ts > until) break;
    if (ev.type === "ceo_decision") {
      if (state.decisions[ev.proposalId]) continue;
      if (ev.auto && !autopilot) continue;
    }
    if (ev.type === "escalation_resolved" && ev.auto && !autopilot) continue;
    if (ev.when && state.decisions[ev.when.proposalId] !== ev.when.decision) continue;
    apply(state, ev);
  }
  return state;
}

export type Mode = "demo" | "live";

/** How the live provider is getting on with the server. */
export type Connection = "connecting" | "online" | "offline";

/**
 * The one store shape every view reads through `useSim`.
 *
 * Two providers satisfy it: the scripted `SimProvider` (demo) and `LiveProvider`
 * (a real company over the platform API). Keeping a single shape — rather than
 * a common hook plus two private ones — is what lets Floor/Desk/Reports/Metrics
 * stay untouched by the existence of live mode: they read `config`, `state`,
 * `awaiting`, `now`, `time`, `decide`, `resolveEscalation` and never learn
 * which provider answered.
 *
 * The fields each provider cannot honestly implement are filled with inert
 * values rather than removed, and are marked below. Anything that reads a
 * demo-only field for more than display must gate on `mode` first.
 */
export interface CompanyStore {
  mode: Mode;
  config: CompanyConfig;
  state: CompanyState;
  /** Proposal waiting for the CEO right now (the first, if several). */
  awaiting?: Id;
  /**
   * Now, on this stream's own clock: sim-minutes in demo, epoch milliseconds
   * in live. Always paired with `time`, which knows which of the two it is.
   */
  now: number;
  time: TimeScale;

  decide(proposalId: Id, decision: CeoDecision, note?: string): void;
  resolveEscalation(escalationId: Id, resolution: string): void;

  /* --------------------------------------------- demo-only (live: inert) */
  /** The scripted day. Live: `[]` — a real log has no future to draw. */
  scenario: CompanyEvent[];
  playing: boolean;
  /** Sim-minutes per real second. */
  speed: number;
  autopilot: boolean;
  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  setAutopilot(on: boolean): void;
  scrubTo(t: number): void;
  tick(dtSeconds: number): void;
  restart(): void;

  /* --------------------------------------------- live-only (demo: inert) */
  /** Company id on the server. Demo: the scenario company's name-ish id. */
  companyId: string;
  connection: Connection;
  /** The board has an OpenRouter key and can actually deliberate. */
  boardOnline: boolean;
  /** A question is in flight: asked, no proposal or failure notice back yet. */
  deliberating: boolean;
  /** Last thing that went wrong, already translated-agnostic (server text). */
  notice?: string;
  /** Ask the board a strategic question. Demo: no-op. */
  ask(text: string): void;
  dismissNotice(): void;
}

/** Back-compat alias: `useSim` was typed against this name in Phase 0. */
export type SimStore = CompanyStore;

let liveSeq = 0;

function recompute(s: CompanyStore & SimOnly, now: number, autopilot = s.autopilot) {
  return reduceTimeline(s.scenario, s.liveEvents, now, autopilot);
}

export function findAwaiting(state: CompanyState): Id | undefined {
  return Object.values(state.proposals).find((p) => p.status === "pending_approval")?.id;
}

/** The demo store adds its own scratch field on top of the shared shape. */
interface SimOnly {
  /** CEO actions the user took, merged into the scripted timeline. */
  liveEvents: CompanyEvent[];
}

export function createSimStore(config: CompanyConfig, scenario: CompanyEvent[]) {
  const sorted = [...scenario].sort((a, b) => a.ts - b.ts);
  return create<CompanyStore & SimOnly>((set, get) => ({
    mode: "demo",
    config,
    scenario: sorted,
    liveEvents: [],
    now: 0,
    time: SIM_TIME,
    playing: false,
    speed: 3,
    autopilot: false,
    awaiting: undefined,
    state: reduceTimeline(sorted, [], 0, false),

    // Inert live-only surface: the demo server-connection is always "here".
    companyId: "demo",
    connection: "online",
    boardOnline: true,
    deliberating: false,
    notice: undefined,
    ask: () => {},
    dismissNotice: () => {},

    play: () => set({ playing: true }),
    pause: () => set({ playing: false }),
    setSpeed: (speed) => set({ speed }),
    setAutopilot: (on) => {
      const s = get();
      const state = recompute(s, s.now, on);
      set({ autopilot: on, state, awaiting: on ? undefined : findAwaiting(state) });
    },
    scrubTo: (t) => {
      const s = get();
      const now = Math.max(0, Math.min(DAY_MINUTES, t));
      const state = recompute(s, now);
      set({ now, state, awaiting: s.autopilot ? undefined : findAwaiting(state) });
    },
    tick: (dt) => {
      const s = get();
      if (!s.playing) return;
      const now = Math.min(DAY_MINUTES, s.now + dt * s.speed);
      const state = recompute(s, now);
      const awaiting = s.autopilot ? undefined : findAwaiting(state);
      set({
        now,
        state,
        awaiting,
        playing: awaiting ? false : now >= DAY_MINUTES ? false : s.playing,
      });
    },
    decide: (proposalId, decision, note) => {
      const s = get();
      const ev: CompanyEvent = {
        id: `live-${liveSeq++}`,
        ts: s.now,
        type: "ceo_decision",
        proposalId,
        decision,
        note,
      };
      const liveEvents = [...s.liveEvents, ev];
      const state = reduceTimeline(s.scenario, liveEvents, s.now, s.autopilot);
      set({ liveEvents, state, awaiting: findAwaiting(state), playing: true });
    },
    resolveEscalation: (escalationId, resolution) => {
      const s = get();
      const ev: CompanyEvent = {
        id: `live-${liveSeq++}`,
        ts: s.now,
        type: "escalation_resolved",
        escalationId,
        resolution,
      };
      const liveEvents = [...s.liveEvents, ev];
      set({ liveEvents, state: reduceTimeline(s.scenario, liveEvents, s.now, s.autopilot) });
    },
    restart: () => {
      const s = get();
      set({
        liveEvents: [],
        now: 0,
        playing: false,
        awaiting: undefined,
        state: reduceTimeline(s.scenario, [], 0, s.autopilot),
      });
    },
  }));
}
