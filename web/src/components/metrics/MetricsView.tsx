"use client";

import { BudgetTile, DecisionsTile, EscalationsTile, TasksTile } from "./StatTiles";
import { SpendChart } from "./SpendChart";
import { TaskFlowChart } from "./TaskFlowChart";
import { DecisionLatencyChart } from "./DecisionLatencyChart";

/**
 * Company telemetry: how the company is running, computed entirely from
 * event-sourced sim state (s.state) and config — never a running local
 * total, so it stays correct across play, pause, and scrubbing backwards.
 */
export function MetricsView() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="grid grid-cols-12 gap-4">
        <BudgetTile />
        <DecisionsTile />
        <TasksTile />
        <EscalationsTile />

        <SpendChart />
        <TaskFlowChart />

        <DecisionLatencyChart />
      </div>
    </div>
  );
}
