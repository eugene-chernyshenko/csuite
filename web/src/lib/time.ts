/**
 * Unit-aware time for a company event stream.
 *
 * `EventBase.ts` is deliberately one number in one contract, but its *unit*
 * belongs to whoever produced the stream (see the comment on `ts` in
 * `@csuite/contract`):
 *
 * - the demo simulation counts **sim-minutes since 09:00** (`0..DAY_MINUTES`),
 *   and `clock()` formats exactly that;
 * - the platform server stamps **epoch milliseconds** (`Date.now()`).
 *
 * Every view that renders a timestamp, sizes an animation window, or draws a
 * time axis therefore has to ask the provider what unit it is reading. That is
 * this file: two stateless, frozen {@link TimeScale} values — one per unit —
 * hung off the store surface as `time`. They are pure functions of their
 * arguments (nothing closes over store state), so their identity is stable
 * forever and a `useSim((s) => s.time)` selector never causes a re-render.
 */

import { clock, DAY_MINUTES } from "@csuite/contract";

export type TimeUnit = "sim-minutes" | "ms";

export interface TimeScale {
  /** What `ts` means on this stream. */
  readonly unit: TimeUnit;
  /** An event's `ts` as a wall clock — always HH:MM, in both locales. */
  format(ts: number): string;
  /**
   * A window of `seconds` real seconds, expressed in stream units. The demo
   * scales by playback speed (one real second covers `speed` sim-minutes);
   * a live stream runs at 1×, so `speed` is ignored.
   */
  window(seconds: number, speed: number): number;
  /** A difference between two `ts` values, in minutes. */
  minutes(delta: number): number;
  /** `[min, max]` for a chart x-axis covering the stream so far. */
  axis(now: number, firstTs?: number): { min: number; max: number };
  /** `count` evenly spaced tick values across {@link axis}. */
  ticks(now: number, firstTs: number | undefined, count: number): number[];
  /**
   * Where `now` sits in the period the monthly budget is spent over, 0..1 —
   * the pace line on the budget meter. The demo paces across its scripted day;
   * live paces across the actual calendar month, which is what the budget is.
   */
  pace(now: number): number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function evenly(min: number, max: number, count: number): number[] {
  if (count < 2) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + i * step);
}

/* ------------------------------------------------------------------ demo */

/** Sim-minutes since 09:00 — the scripted day the Phase 0 demo plays. */
export const SIM_TIME: TimeScale = Object.freeze<TimeScale>({
  unit: "sim-minutes",
  format: clock,
  // Never below a third of a sim-minute: at 1× a 1.5s window would otherwise
  // be too short for the event to be seen at all.
  window: (seconds, speed) => Math.max(0.35, seconds * (speed || 1)),
  minutes: (delta) => delta,
  axis: () => ({ min: 0, max: DAY_MINUTES }),
  ticks: (_now, _firstTs, count) => evenly(0, DAY_MINUTES, count),
  pace: (now) => clamp01(now / DAY_MINUTES),
});

/* ------------------------------------------------------------------ live */

/**
 * Forced to `en-GB` rather than the UI locale on purpose: the design system
 * fixes the clock at HH:MM in both English and Russian (CLAUDE.md, "UI
 * languages"), and a runtime locale could hand us a 12-hour clock instead.
 * The time zone stays the viewer's own.
 */
const HHMM = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** An axis narrower than this is all rounding noise; widen it. */
const MIN_AXIS_MS = 60_000;
/** How far back the axis reaches when the log is still empty. */
const EMPTY_AXIS_MS = 60 * 60_000;

function monthPace(now: number): number {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return clamp01((now - start) / Math.max(1, end - start));
}

/** Epoch milliseconds — what the platform server stamps on every event. */
export const REAL_TIME: TimeScale = Object.freeze<TimeScale>({
  unit: "ms",
  format: (ts) => HHMM.format(new Date(ts)),
  window: (seconds) => seconds * 1000,
  minutes: (delta) => delta / 60_000,
  axis: (now, firstTs) => {
    const min = firstTs ?? now - EMPTY_AXIS_MS;
    return { min, max: Math.max(now, min + MIN_AXIS_MS) };
  },
  ticks: (now, firstTs, count) => {
    const { min, max } = REAL_TIME.axis(now, firstTs);
    return evenly(min, max, count);
  },
  pace: monthPace,
});
