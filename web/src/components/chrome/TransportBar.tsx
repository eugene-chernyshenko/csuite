"use client";

import { useTranslations } from "next-intl";
import { useSim } from "@/lib/sim";
import { clock, DAY_MINUTES } from "@csuite/contract";

const speeds = [1, 3, 10];

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

/**
 * The scripted day's transport. Demo-only by construction: a live event log has
 * no future to scrub into and no playback to pause, so this returns null there
 * and `LiveBar` takes the strip instead.
 */
export function TransportBar() {
  const t = useTranslations("transport");
  const mode = useSim((s) => s.mode);
  const simTime = useSim((s) => s.now);
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

  if (mode !== "demo") return null;

  return (
    <div className="flex items-center gap-4 border-b border-line bg-sheet px-5 py-2">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => (playing ? pause() : done ? restart() : play())}
          className="flex h-7 w-16 items-center justify-center rounded-md bg-sign text-[12px] font-medium text-white hover:opacity-90"
        >
          {playing ? t("pause") : done ? t("replay") : t("play")}
        </button>
        <button
          onClick={restart}
          className="flex h-7 items-center rounded-md border border-line px-2.5 text-[12px] text-ink-soft hover:text-ink"
        >
          {t("restart")}
        </button>
      </div>

      <div className="flex items-center gap-0.5">
        {speeds.map((value) => (
          <button
            key={value}
            onClick={() => setSpeed(value)}
            className={`rounded px-2 py-1 font-mono text-[11px] ${
              speed === value ? "bg-sign-soft text-sign" : "text-ink-soft hover:text-ink"
            }`}
          >
            {t("speed", { value })}
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
          aria-label={t("scrubAriaLabel")}
          className="relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent opacity-0"
        />
      </div>

      <span className="font-mono text-[13px] text-ink tnum">{clock(simTime)}</span>

      {awaiting && (
        <span className="rounded-md bg-hold-soft px-2.5 py-1 text-[12px] font-medium text-hold">
          {t("waitingForDecision")}
        </span>
      )}

      <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-soft">
        <input
          type="checkbox"
          checked={autopilot}
          onChange={(e) => setAutopilot(e.target.checked)}
          className="accent-[var(--color-sign)]"
        />
        {t("autopilot")}
      </label>
    </div>
  );
}
