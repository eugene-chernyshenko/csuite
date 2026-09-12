/**
 * Formatting and windowing for a company event stream, kept behind one seam
 * (`TimeScale`) rather than spread across every view as raw `Date` math.
 *
 * The platform server stamps every event's `ts` in epoch milliseconds
 * (`Date.now()`); `REAL_TIME` is the one implementation of that seam. Every
 * view that renders a timestamp, sizes an animation window, or draws a time
 * axis goes through it, so a future second stream (a replay, a different
 * transport) only has to supply another `TimeScale`, not touch the views.
 *
 * `REAL_TIME` is a pure, frozen object — nothing closes over store state — so
 * its identity is stable forever and a `useSim((s) => s.time)` selector never
 * causes a re-render.
 */

export interface TimeScale {
  /** An event's `ts` as a wall clock — always HH:MM, in both locales. */
  format(ts: number): string;
  /** A window of `seconds` real seconds, expressed in stream units (ms). */
  window(seconds: number): number;
  /** A difference between two `ts` values, in minutes. */
  minutes(delta: number): number;
  /** `[min, max]` for a chart x-axis covering the stream so far. */
  axis(now: number, firstTs?: number): { min: number; max: number };
  /** `count` evenly spaced tick values across {@link axis}. */
  ticks(now: number, firstTs: number | undefined, count: number): number[];
  /**
   * Where `now` sits in the period the monthly budget is spent over, 0..1 —
   * the pace line on the budget meter. Paces across the actual calendar
   * month, which is what the budget is drawn on.
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
