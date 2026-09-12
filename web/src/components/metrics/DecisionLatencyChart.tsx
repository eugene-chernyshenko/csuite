"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useSim } from "@/lib/company";
import type { CeoDecision } from "@csuite/contract";

const DECISION_COLOR: Record<CeoDecision, string> = {
  approved: "var(--color-sign)",
  returned: "var(--color-hold)",
  rejected: "var(--color-pencil)",
};
const DECISION_ORDER: CeoDecision[] = ["approved", "returned", "rejected"];

const W = 640;
const ROW_H = 28;
const PAD_TOP = 8;
const PAD_BOTTOM = 24;
const LABEL_W = 160;
const PAD_R = 48;

/**
 * For every decided proposal, minutes from proposal_submitted to ceo_decision
 * (read straight off feed timestamps) — how long decisions wait for the CEO.
 *
 * The gap between two `ts` values is in the stream's own unit, so it goes
 * through `TimeScale.minutes`: sim-minutes are already minutes, live
 * milliseconds are not.
 */
export function DecisionLatencyChart() {
  const t = useTranslations("metrics");
  const decisionLabel = (d: CeoDecision) => t(`decision.${d}`);
  const feed = useSim((s) => s.state.feed);
  const time = useSim((s) => s.time);

  /**
   * A live board answers in seconds, not hours: rounding those to whole minutes
   * would print "0m" for every decision.
   */
  const round = (m: number) => (m < 10 ? Math.round(m * 10) / 10 : Math.round(m));

  const rows = useMemo(() => {
    const submittedAt = new Map<string, { ts: number; title: string }>();
    const out: { id: string; title: string; minutes: number; decision: CeoDecision; decidedAt: number }[] = [];
    for (const ev of feed) {
      if (ev.type === "proposal_submitted") {
        submittedAt.set(ev.proposal.id, { ts: ev.ts, title: ev.proposal.title });
      } else if (ev.type === "ceo_decision") {
        const sub = submittedAt.get(ev.proposalId);
        if (sub) {
          out.push({
            id: ev.proposalId,
            title: sub.title,
            minutes: time.minutes(Math.max(0, ev.ts - sub.ts)),
            decision: ev.decision,
            decidedAt: ev.ts,
          });
        }
      }
    }
    out.sort((a, b) => a.decidedAt - b.decidedAt);
    return out;
  }, [feed, time]);

  const maxMinutes = Math.max(1, ...rows.map((r) => r.minutes));
  const barAreaW = W - LABEL_W - PAD_R;
  const x = (m: number) => LABEL_W + (m / maxMinutes) * barAreaW;
  const H = PAD_TOP + Math.max(rows.length, 1) * ROW_H + PAD_BOTTOM;

  return (
    <div className="col-span-12 flex flex-col gap-2 rounded-md border border-line bg-sheet p-4">
      <div>
        <h3 className="text-[13px] font-medium text-ink">{t("decisionLatency")}</h3>
        <p className="text-[11px] text-ink-soft">{t("howLongWait")}</p>
      </div>

      <div className="flex gap-4">
        {DECISION_ORDER.map((d) => (
          <span key={d} className="flex items-center gap-1.5 text-[11px] text-ink-soft">
            <span className="h-2 w-2 rounded-full" style={{ background: DECISION_COLOR[d] }} />
            {decisionLabel(d)}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-ink-soft">{t("noDataYet")}</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("decisionLatencyAriaLabel")}>
          <line x1={LABEL_W} y1={PAD_TOP} x2={LABEL_W} y2={H - PAD_BOTTOM} stroke="var(--color-line)" strokeWidth={1} />
          <line x1={LABEL_W} y1={H - PAD_BOTTOM} x2={W - PAD_R + 8} y2={H - PAD_BOTTOM} stroke="var(--color-line)" strokeWidth={1} />
          {rows.map((r, i) => {
            const rowY = PAD_TOP + i * ROW_H + ROW_H / 2;
            return (
              <g key={r.id}>
                <text x={LABEL_W - 8} y={rowY} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--color-ink)">
                  {r.title.length > 22 ? `${r.title.slice(0, 21)}…` : r.title}
                </text>
                <line x1={x(0)} y1={rowY} x2={x(r.minutes)} y2={rowY} stroke="var(--color-ink-soft)" strokeWidth={2} strokeLinecap="round" />
                <circle cx={x(r.minutes)} cy={rowY} r={4} fill={DECISION_COLOR[r.decision]} stroke="var(--color-sheet)" strokeWidth={2}>
                  <title>{t("decisionAfterMin", { decision: decisionLabel(r.decision), minutes: round(r.minutes) })}</title>
                </circle>
                <text
                  x={x(r.minutes) + 10}
                  y={rowY}
                  dominantBaseline="middle"
                  className="font-mono tnum"
                  fontSize={10}
                  fill="var(--color-ink-soft)"
                >
                  {t("minutesShort", { minutes: round(r.minutes) })}
                </text>
              </g>
            );
          })}
          <text x={LABEL_W} y={H - 8} fontSize={10} fill="var(--color-ink-soft)">
            {t("minutesShort", { minutes: 0 })}
          </text>
          <text x={W - PAD_R + 8} y={H - 8} textAnchor="end" className="font-mono tnum" fontSize={10} fill="var(--color-ink-soft)">
            {t("minutesShort", { minutes: round(maxMinutes) })}
          </text>
        </svg>
      )}
    </div>
  );
}
