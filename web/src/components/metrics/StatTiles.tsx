"use client";

import { useMemo } from "react";
import { useSim } from "@/lib/sim";
import { DAY_MINUTES } from "@/lib/contract/events";
import { formatMoney } from "./format";

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="col-span-3 flex flex-col gap-2.5 rounded-md border border-line bg-sheet p-4">
      <span className="text-[12px] text-ink-soft">{label}</span>
      {children}
    </div>
  );
}

/**
 * Spend vs monthlyBudget, paced linearly through the 540-minute day: a quiet
 * meter that reads ledger (green) while spend is under the pace line implied
 * by the current sim time, and pencil (red) once it runs ahead of it.
 */
export function BudgetTile() {
  const spent = useSim((s) => s.state.spent);
  const budget = useSim((s) => s.config.monthlyBudget);
  const simTime = useSim((s) => s.simTime);

  const pace = simTime / DAY_MINUTES;
  const expected = budget * pace;
  const overPace = spent > expected;
  const fillPct = Math.max(0, Math.min(100, (spent / Math.max(budget, 1)) * 100));
  const pacePct = Math.max(0, Math.min(100, pace * 100));
  const tone = overPace ? "pencil" : "ledger";

  return (
    <Tile label="Budget">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[19px] text-ink tnum">{formatMoney(spent)}</span>
        <span className="font-mono text-[11px] text-ink-soft tnum">of {formatMoney(budget)}</span>
      </div>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: `var(--color-${tone}-soft)` }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${fillPct}%`, background: `var(--color-${tone})` }}
        />
        <div
          className="absolute top-0 h-full w-px bg-ink-soft"
          style={{ left: `${pacePct}%` }}
        />
      </div>
      <span className="text-[11px]" style={{ color: `var(--color-${tone})` }}>
        {overPace ? "Over pace" : "On pace"}
      </span>
    </Tile>
  );
}

function DecisionStat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[19px] tnum" style={{ color }}>
        {value}
      </span>
      <span className="text-[11px] text-ink-soft">{label}</span>
    </div>
  );
}

/** Approved / returned / rejected counts from every decision made so far today. */
export function DecisionsTile() {
  const decisions = useSim((s) => s.state.decisions);
  const counts = useMemo(() => {
    const c = { approved: 0, returned: 0, rejected: 0 };
    for (const d of Object.values(decisions)) c[d]++;
    return c;
  }, [decisions]);

  return (
    <Tile label="Decisions today">
      <div className="flex items-end gap-5">
        <DecisionStat value={counts.approved} label="Approved" color="var(--color-sign)" />
        <DecisionStat value={counts.returned} label="Returned" color="var(--color-hold)" />
        <DecisionStat value={counts.rejected} label="Rejected" color="var(--color-pencil)" />
      </div>
    </Tile>
  );
}

/** Done vs total tasks, with in-review/blocked called out since they need eyes. */
export function TasksTile() {
  const tasks = useSim((s) => s.state.tasks);
  const counts = useMemo(() => {
    const values = Object.values(tasks);
    return {
      total: values.length,
      done: values.filter((t) => t.status === "done").length,
      inReview: values.filter((t) => t.status === "in_review").length,
      blocked: values.filter((t) => t.status === "blocked").length,
    };
  }, [tasks]);

  return (
    <Tile label="Tasks">
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[19px] text-ink tnum">{counts.done}</span>
        <span className="text-[13px] text-ink-soft">/ {counts.total} done</span>
      </div>
      <div className="flex gap-4 text-[11px] text-ink-soft">
        <span>
          In review <span className="font-mono text-hold tnum">{counts.inReview}</span>
        </span>
        <span>
          Blocked <span className="font-mono text-pencil tnum">{counts.blocked}</span>
        </span>
      </div>
    </Tile>
  );
}

/** Open escalations waiting on the CEO, broken down by severity. */
export function EscalationsTile() {
  const escalations = useSim((s) => s.state.escalations);
  const counts = useMemo(() => {
    const open = Object.values(escalations).filter((e) => e.status === "open");
    return {
      open: open.length,
      urgent: open.filter((e) => e.severity === "urgent").length,
      attention: open.filter((e) => e.severity === "attention").length,
    };
  }, [escalations]);

  return (
    <Tile label="Open escalations">
      <span className={`font-mono text-[19px] tnum ${counts.open > 0 ? "text-pencil" : "text-ink"}`}>
        {counts.open}
      </span>
      <span className="text-[11px] text-ink-soft">
        {counts.open > 0 ? `${counts.urgent} urgent · ${counts.attention} attention` : "None waiting"}
      </span>
    </Tile>
  );
}
