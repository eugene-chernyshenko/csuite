"use client";

import { useMemo } from "react";
import { useSim } from "@/lib/sim";
import type { TaskStatus } from "@csuite/contract";

const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "in_review", "blocked", "done"];
const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: "var(--color-line)",
  in_progress: "var(--color-ink-soft)",
  in_review: "var(--color-hold)",
  blocked: "var(--color-pencil)",
  done: "var(--color-ledger)",
};
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  blocked: "Blocked",
  done: "Done",
};

const W = 480;
const ROW_H = 34;
const BAR_H = 20;
const PAD_TOP = 8;
const LABEL_W = 108;
const COUNT_W = 34;
const GAP = 2;
const R = 4;

/** A rounded rect that only rounds the corners requested — used so a stacked
 * bar's outer ends are rounded while internal segment joins stay square. */
function segmentPath(x: number, y: number, w: number, h: number, roundLeft: boolean, roundRight: boolean): string {
  const rl = roundLeft ? Math.min(R, w / 2) : 0;
  const rr = roundRight ? Math.min(R, w / 2) : 0;
  return [
    `M${x + rl},${y}`,
    `H${x + w - rr}`,
    rr ? `A${rr},${rr} 0 0 1 ${x + w},${y + rr}` : "",
    `V${y + h - rr}`,
    rr ? `A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}` : "",
    `H${x + rl}`,
    rl ? `A${rl},${rl} 0 0 1 ${x},${y + h - rl}` : "",
    `V${y + rl}`,
    rl ? `A${rl},${rl} 0 0 1 ${x + rl},${y}` : "",
    "Z",
  ].join(" ");
}

/** Task status mix per department, as a horizontal stacked bar. */
export function TaskFlowChart() {
  const departments = useSim((s) => s.config.departments);
  const tasks = useSim((s) => s.state.tasks);

  const rows = useMemo(() => {
    const values = Object.values(tasks);
    return departments.map((d) => {
      const deptTasks = values.filter((t) => t.departmentId === d.id);
      const counts = STATUS_ORDER.map((status) => deptTasks.filter((t) => t.status === status).length);
      return { department: d, total: deptTasks.length, counts };
    });
  }, [departments, tasks]);

  const totalTasks = rows.reduce((sum, r) => sum + r.total, 0);
  const barAreaW = W - LABEL_W - COUNT_W;
  const H = PAD_TOP * 2 + Math.max(rows.length, 1) * ROW_H;

  return (
    <div className="col-span-5 flex flex-col gap-2 rounded-md border border-line bg-sheet p-4">
      <div>
        <h3 className="text-[13px] font-medium text-ink">Task flow by department</h3>
        <p className="text-[11px] text-ink-soft">Status mix of every task created today</p>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-[11px] text-ink-soft">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      {totalTasks === 0 ? (
        <p className="py-8 text-center text-[12px] text-ink-soft">The day hasn&rsquo;t produced data yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Task status mix by department">
          {rows.map((row, i) => {
            const rowY = PAD_TOP + i * ROW_H;
            const barY = rowY + (ROW_H - BAR_H) / 2;
            const nonZero = row.counts.filter((c) => c > 0).length;
            const gapTotal = Math.max(0, nonZero - 1) * GAP;
            const usable = Math.max(0, barAreaW - gapTotal);
            let cursorX = LABEL_W;
            let seen = 0;

            return (
              <g key={row.department.id}>
                <text x={0} y={rowY + BAR_H / 2} dominantBaseline="middle" fontSize={12} fill="var(--color-ink)">
                  {row.department.name}
                </text>
                {row.total === 0 ? (
                  <rect
                    x={LABEL_W}
                    y={barY}
                    width={barAreaW}
                    height={BAR_H}
                    rx={R}
                    fill="var(--color-paper)"
                    stroke="var(--color-line)"
                    strokeWidth={1}
                  />
                ) : (
                  row.counts.map((count, si) => {
                    if (count === 0) return null;
                    const segW = (count / row.total) * usable;
                    const isFirst = seen === 0;
                    seen++;
                    const isLast = seen === nonZero;
                    const x0 = cursorX;
                    cursorX += segW + GAP;
                    return (
                      <path key={si} d={segmentPath(x0, barY, segW, BAR_H, isFirst, isLast)} fill={STATUS_COLOR[STATUS_ORDER[si]]}>
                        <title>{`${STATUS_LABEL[STATUS_ORDER[si]]}: ${count}`}</title>
                      </path>
                    );
                  })
                )}
                <text
                  x={W}
                  y={rowY + BAR_H / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="font-mono tnum"
                  fontSize={11}
                  fill="var(--color-ink-soft)"
                >
                  {row.total}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
