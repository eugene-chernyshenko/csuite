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

interface SimStore {
  config: CompanyConfig;
  scenario: CompanyEvent[];
  liveEvents: CompanyEvent[];
  simTime: number;
  playing: boolean;
  /** Sim-minutes per real second */
  speed: number;
  autopilot: boolean;
  /** Proposal waiting for the CEO (pauses playback when autopilot is off) */
  awaiting?: Id;
  state: CompanyState;

  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  setAutopilot(on: boolean): void;
  scrubTo(t: number): void;
  tick(dtSeconds: number): void;
  decide(proposalId: Id, decision: CeoDecision, note?: string): void;
  resolveEscalation(escalationId: Id, resolution: string): void;
  restart(): void;
}

let liveSeq = 0;

function recompute(s: SimStore, simTime: number, autopilot = s.autopilot) {
  return reduceTimeline(s.scenario, s.liveEvents, simTime, autopilot);
}

function findAwaiting(state: CompanyState): Id | undefined {
  return Object.values(state.proposals).find((p) => p.status === "pending_approval")?.id;
}

export function createSimStore(config: CompanyConfig, scenario: CompanyEvent[]) {
  const sorted = [...scenario].sort((a, b) => a.ts - b.ts);
  return create<SimStore>((set, get) => ({
    config,
    scenario: sorted,
    liveEvents: [],
    simTime: 0,
    playing: false,
    speed: 3,
    autopilot: false,
    awaiting: undefined,
    state: reduceTimeline(sorted, [], 0, false),

    play: () => set({ playing: true }),
    pause: () => set({ playing: false }),
    setSpeed: (speed) => set({ speed }),
    setAutopilot: (on) => {
      const s = get();
      const state = recompute(s, s.simTime, on);
      set({ autopilot: on, state, awaiting: on ? undefined : findAwaiting(state) });
    },
    scrubTo: (t) => {
      const s = get();
      const simTime = Math.max(0, Math.min(DAY_MINUTES, t));
      const state = recompute(s, simTime);
      set({ simTime, state, awaiting: s.autopilot ? undefined : findAwaiting(state) });
    },
    tick: (dt) => {
      const s = get();
      if (!s.playing) return;
      const simTime = Math.min(DAY_MINUTES, s.simTime + dt * s.speed);
      const state = recompute(s, simTime);
      const awaiting = s.autopilot ? undefined : findAwaiting(state);
      set({
        simTime,
        state,
        awaiting,
        playing: awaiting ? false : simTime >= DAY_MINUTES ? false : s.playing,
      });
    },
    decide: (proposalId, decision, note) => {
      const s = get();
      const ev: CompanyEvent = {
        id: `live-${liveSeq++}`,
        ts: s.simTime,
        type: "ceo_decision",
        proposalId,
        decision,
        note,
      };
      const liveEvents = [...s.liveEvents, ev];
      const state = reduceTimeline(s.scenario, liveEvents, s.simTime, s.autopilot);
      set({ liveEvents, state, awaiting: findAwaiting(state), playing: true });
    },
    resolveEscalation: (escalationId, resolution) => {
      const s = get();
      const ev: CompanyEvent = {
        id: `live-${liveSeq++}`,
        ts: s.simTime,
        type: "escalation_resolved",
        escalationId,
        resolution,
      };
      const liveEvents = [...s.liveEvents, ev];
      set({ liveEvents, state: reduceTimeline(s.scenario, liveEvents, s.simTime, s.autopilot) });
    },
    restart: () => {
      const s = get();
      set({
        liveEvents: [],
        simTime: 0,
        playing: false,
        awaiting: undefined,
        state: reduceTimeline(s.scenario, [], 0, s.autopilot),
      });
    },
  }));
}

export type { SimStore };
