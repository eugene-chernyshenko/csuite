"use client";

import { create } from "zustand";
import type {
  CompanyConfig,
  Escalation,
  Id,
  Position,
  Proposal,
  Report,
  Task,
} from "./contract/types";
import {
  DAY_MINUTES,
  type Activity,
  type CeoDecision,
  type CompanyEvent,
} from "./contract/events";

export interface CompanyState {
  proposals: Record<Id, Proposal>;
  /** Positions seen so far while a proposal is still drafting (Floor ambience) */
  draftPositions: Record<Id, Position[]>;
  tasks: Record<Id, Task>;
  reports: Report[];
  escalations: Record<Id, Escalation>;
  decisions: Record<Id, CeoDecision>;
  spent: number;
  spendByCategory: Record<string, number>;
  activity: Record<Id, { activity: Activity; note?: string }>;
  /** Applied events, oldest first */
  feed: CompanyEvent[];
}

function emptyState(): CompanyState {
  return {
    proposals: {},
    draftPositions: {},
    tasks: {},
    reports: [],
    escalations: {},
    decisions: {},
    spent: 0,
    spendByCategory: {},
    activity: {},
    feed: [],
  };
}

function apply(state: CompanyState, ev: CompanyEvent): void {
  state.feed.push(ev);
  switch (ev.type) {
    case "worklog":
      state.activity[ev.roleId] = { activity: ev.activity, note: ev.note };
      break;
    case "position_submitted": {
      const list = (state.draftPositions[ev.proposalId] ??= []);
      list.push(ev.position);
      break;
    }
    case "proposal_submitted":
      state.proposals[ev.proposal.id] = { ...ev.proposal, status: "pending_approval" };
      break;
    case "ceo_decision": {
      const p = state.proposals[ev.proposalId];
      if (p) {
        p.status = ev.decision === "approved" ? "in_progress" : ev.decision;
        p.ceoNote = ev.note;
      }
      state.decisions[ev.proposalId] = ev.decision;
      break;
    }
    case "tasks_created":
      for (const t of ev.tasks) state.tasks[t.id] = { ...t };
      break;
    case "task_status_changed": {
      const t = state.tasks[ev.taskId];
      if (t) t.status = ev.status;
      break;
    }
    case "report_submitted": {
      state.reports.push(ev.report);
      if (ev.report.spend) {
        state.spent += ev.report.spend;
      }
      const pid = ev.report.taskId ? state.tasks[ev.report.taskId]?.proposalId : undefined;
      if (pid) {
        const p = state.proposals[pid];
        const allDone =
          p &&
          Object.values(state.tasks)
            .filter((t) => t.proposalId === pid)
            .every((t) => t.status === "done");
        if (p && allDone) p.status = "delivered";
      }
      break;
    }
    case "escalation_raised":
      state.escalations[ev.escalation.id] = { ...ev.escalation };
      break;
    case "escalation_resolved": {
      const e = state.escalations[ev.escalationId];
      if (e) {
        e.status = "resolved";
        e.resolution = ev.resolution;
      }
      break;
    }
    case "budget_spent":
      state.spent += ev.amount;
      state.spendByCategory[ev.category] =
        (state.spendByCategory[ev.category] ?? 0) + ev.amount;
      break;
    default:
      break;
  }
}

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
