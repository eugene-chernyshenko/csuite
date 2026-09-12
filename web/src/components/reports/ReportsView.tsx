"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useSim } from "@/lib/company";
import { ReportCard } from "./ReportCard";

type Filter = "all" | "periodic" | `dept:${string}`;

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`border-b pb-0.5 text-[13px] transition-colors ${
        active ? "border-ink font-medium text-ink" : "border-transparent text-ink-soft hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The reports feed: every report the company has produced so far today,
 * newest first. Rendered purely from current sim state, so scrubbing the
 * day backwards naturally shrinks the feed.
 */
export function ReportsView() {
  const t = useTranslations("reports");
  const reports = useSim((s) => s.state.reports);
  const departments = useSim((s) => s.config.departments);
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const newestFirst = [...reports].reverse();
    if (filter === "all") return newestFirst;
    if (filter === "periodic") return newestFirst.filter((r) => r.kind === "periodic");
    const deptId = filter.slice("dept:".length);
    return newestFirst.filter((r) => r.departmentId === deptId);
  }, [reports, filter]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2">
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
          {t("filterAll")}
        </FilterButton>
        {departments.map((d) => (
          <FilterButton
            key={d.id}
            active={filter === `dept:${d.id}`}
            onClick={() => setFilter(`dept:${d.id}`)}
          >
            {d.name}
          </FilterButton>
        ))}
        <FilterButton active={filter === "periodic"} onClick={() => setFilter("periodic")}>
          {t("filterPeriodicOnly")}
        </FilterButton>
      </div>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-ink-soft">
          {t("noReports")}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}
