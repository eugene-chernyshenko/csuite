"use client";

import { useSim } from "@/lib/sim";
import type { Report } from "@/lib/contract/types";
import { clock } from "@/lib/contract/events";
import { formatMoney } from "./format";

/**
 * A single report entry. Periodic reports (department/company digests) render
 * as a slightly more prominent sheet-white document card with a serif body;
 * task reports render as a compact row. Purely a function of the report and
 * the current config — safe to re-render after scrubbing the day backwards.
 */
export function ReportCard({ report }: { report: Report }) {
  const role = useSim((s) => s.config.roles.find((r) => r.id === report.authorRoleId));
  const departmentId = report.departmentId ?? role?.departmentId;
  const department = useSim((s) => s.config.departments.find((d) => d.id === departmentId));
  const ts = useSim(
    (s) =>
      s.state.feed.find((e) => e.type === "report_submitted" && e.report.id === report.id)?.ts,
  );

  const byline = [role?.name ?? "Unknown", role?.title, department?.name]
    .filter(Boolean)
    .join(" · ");

  if (report.kind === "periodic") {
    return (
      <article className="rounded-md border border-line bg-sheet p-5">
        <header className="mb-3 flex items-start justify-between gap-4 border-b border-line pb-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium text-ink">{report.title}</h3>
            <p className="mt-0.5 text-[12px] text-ink-soft">{byline}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {ts != null && (
              <span className="font-mono text-[11px] text-ink-soft tnum">{clock(ts)}</span>
            )}
            {report.spend != null && (
              <span className="font-mono text-[13px] text-ink tnum">
                {formatMoney(report.spend)}
              </span>
            )}
          </div>
        </header>

        <p className="font-serif text-[14px] leading-relaxed text-ink">{report.done}</p>

        {report.deviations && (
          <p className="mt-3 text-[13px] text-hold">
            <span className="font-medium">Deviations: </span>
            {report.deviations}
          </p>
        )}

        {report.needsFromCeo && (
          <div className="mt-3 rounded-md bg-hold-soft px-3 py-2 text-[13px] text-hold">
            <span className="font-medium">Needs from you: </span>
            {report.needsFromCeo}
          </div>
        )}
      </article>
    );
  }

  return (
    <article className="flex items-start justify-between gap-4 border-b border-line px-1 py-2.5 text-[13px]">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-ink">{report.title}</span>
          <span className="text-[12px] text-ink-soft">{byline}</span>
          {ts != null && (
            <span className="font-mono text-[11px] text-ink-soft tnum">{clock(ts)}</span>
          )}
        </div>
        <p className="mt-0.5 text-ink-soft">{report.done}</p>
        {report.deviations && <p className="mt-0.5 text-hold">{report.deviations}</p>}
        {report.needsFromCeo && (
          <p className="mt-1 inline-block rounded bg-hold-soft px-2 py-1 text-hold">
            Needs from you: {report.needsFromCeo}
          </p>
        )}
      </div>
      {report.spend != null && (
        <span className="shrink-0 font-mono text-ink tnum">{formatMoney(report.spend)}</span>
      )}
    </article>
  );
}
