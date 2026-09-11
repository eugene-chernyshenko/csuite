"use client";

import { useSim } from "@/lib/sim";
import { clock, DAY_MINUTES } from "@csuite/contract";

const speeds = [
  { value: 1, label: "×1" },
  { value: 3, label: "×3" },
  { value: 10, label: "×10" },
];

function pipColor(type: string): string | null {
  switch (type) {
    case "proposal_submitted":
      return "var(--color-hold)";
    case "ceo_decision":
      return "var(--color-sign)";
    case "escalation_raised":
      return "var(--color-pencil)";
    case "report_submitted":
      return "var(--color-ledger)";
    default:
      return null;
  }
}

export function TransportBar() {
  const simTime = useSim((s) => s.simTime);
  const playing = useSim((s) => s.playing);
  const speed = useSim((s) => s.speed);
  const autopilot = useSim((s) => s.autopilot);
  const awaiting = useSim((s) => s.awaiting);
  const scenario = useSim((s) => s.scenario);
  const play = useSim((s) => s.play);
  const pause = useSim((s) => s.pause);
  const setSpeed = useSim((s) => s.setSpeed);
  const setAutopilot = useSim((s) => s.setAutopilot);
  const scrubTo = useSim((s) => s.scrubTo);
  const restart = useSim((s) => s.restart);

  const done = simTime >= DAY_MINUTES;

  return (
    <div className="flex items-center gap-4 border-b border-line bg-sheet px-5 py-2">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => (playing ? pause() : done ? restart() : play())}
          className="flex h-7 w-16 items-center justify-center rounded-md bg-sign text-[12px] font-medium text-white hover:opacity-90"
        >
          {playing ? "Pause" : done ? "Replay" : "Play"}
        </button>
        <button
          onClick={restart}
          className="flex h-7 items-center rounded-md border border-line px-2.5 text-[12px] text-ink-soft hover:text-ink"
        >
          Restart
        </button>
      </div>

      <div className="flex items-center gap-0.5">
        {speeds.map((s) => (
          <button
            key={s.value}
            onClick={() => setSpeed(s.value)}
            className={`rounded px-2 py-1 font-mono text-[11px] ${
              speed === s.value ? "bg-sign-soft text-sign" : "text-ink-soft hover:text-ink"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
        <div
          className="pointer-events-none absolute top-1/2 left-0 h-px -translate-y-1/2 bg-sign"
          style={{ width: `${(simTime / DAY_MINUTES) * 100}%` }}
        />
        {scenario.map((ev) => {
          const color = pipColor(ev.type);
          if (!color) return null;
          return (
            <span
              key={ev.id}
              className="pointer-events-none absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${(ev.ts / DAY_MINUTES) * 100}%`,
                background: ev.ts <= simTime ? color : "var(--color-line)",
              }}
            />
          );
        })}
        <input
          type="range"
          min={0}
          max={DAY_MINUTES}
          step={0.5}
          value={simTime}
          onChange={(e) => scrubTo(Number(e.target.value))}
          aria-label="Scrub through the day"
          className="relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent opacity-0"
        />
      </div>

      <span className="font-mono text-[13px] text-ink tnum">{clock(simTime)}</span>

      {awaiting && (
        <span className="rounded-md bg-hold-soft px-2.5 py-1 text-[12px] font-medium text-hold">
          Waiting for your decision
        </span>
      )}

      <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-soft">
        <input
          type="checkbox"
          checked={autopilot}
          onChange={(e) => setAutopilot(e.target.checked)}
          className="accent-[var(--color-sign)]"
        />
        Autopilot
      </label>
    </div>
  );
}
