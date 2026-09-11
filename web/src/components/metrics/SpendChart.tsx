"use client";

import { useMemo } from "react";
import { useSim } from "@/lib/sim";
import { DAY_MINUTES, clock } from "@csuite/contract";
import { formatMoney, niceMax } from "./format";

const W = 640;
const H = 220;
const PAD_L = 60;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 28;
const X_TICKS = [0, 180, 360, 540];

/**
 * Cumulative spend through the day: a step line over budget_spent events and
 * report spends pulled straight from the feed, x = sim time, y = dollars.
 */
export function SpendChart() {
  const feed = useSim((s) => s.state.feed);
  const simTime = useSim((s) => s.simTime);
  const spent = useSim((s) => s.state.spent);

  const points = useMemo(() => {
    const events: { ts: number; amount: number }[] = [];
    for (const ev of feed) {
      if (ev.type === "budget_spent") {
        events.push({ ts: ev.ts, amount: ev.amount });
      } else if (ev.type === "report_submitted" && ev.report.spend) {
        events.push({ ts: ev.ts, amount: ev.report.spend });
      }
    }
    events.sort((a, b) => a.ts - b.ts);

    let cum = 0;
    const pts: { ts: number; cum: number }[] = [{ ts: 0, cum: 0 }];
    for (const e of events) {
      pts.push({ ts: e.ts, cum }); // flat until the spend lands
      cum += e.amount;
      pts.push({ ts: e.ts, cum }); // then the step up
    }
    pts.push({ ts: simTime, cum }); // hold flat out to "now"
    return pts;
  }, [feed, simTime]);

  const maxY = niceMax(Math.max(spent, 1));
  const x = (ts: number) => PAD_L + (ts / DAY_MINUTES) * (W - PAD_L - PAD_R);
  const y = (v: number) => H - PAD_B - (v / maxY) * (H - PAD_T - PAD_B);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(1)},${y(p.cum).toFixed(1)}`)
    .join(" ");
  const isEmpty = spent === 0;
  const last = points[points.length - 1];
  const yTicks = [0, maxY / 2, maxY];

  return (
    <div className="col-span-7 flex flex-col gap-2 rounded-md border border-line bg-sheet p-4">
      <div>
        <h3 className="text-[13px] font-medium text-ink">Cumulative spend</h3>
        <p className="text-[11px] text-ink-soft">Through the day, in dollars</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cumulative spend through the day">
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--color-line)" strokeWidth={1} />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="var(--color-line)" strokeWidth={1} />

        {yTicks.map((t) => (
          <text
            key={t}
            x={PAD_L - 8}
            y={y(t)}
            textAnchor="end"
            dominantBaseline="middle"
            className="font-mono tnum"
            fontSize={10}
            fill="var(--color-ink-soft)"
          >
            {formatMoney(t)}
          </text>
        ))}
        {X_TICKS.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={H - PAD_B + 16}
            textAnchor="middle"
            className="font-mono tnum"
            fontSize={10}
            fill="var(--color-ink-soft)"
          >
            {clock(t)}
          </text>
        ))}

        {isEmpty ? (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={12} fill="var(--color-ink-soft)">
            The day hasn&rsquo;t produced data yet.
          </text>
        ) : (
          <>
            <path d={path} fill="none" stroke="var(--color-ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(last.ts)} cy={y(last.cum)} r={4} fill="var(--color-ink)" stroke="var(--color-sheet)" strokeWidth={2}>
              <title>{`${formatMoney(spent)} spent by ${clock(simTime)}`}</title>
            </circle>
          </>
        )}
      </svg>
    </div>
  );
}
