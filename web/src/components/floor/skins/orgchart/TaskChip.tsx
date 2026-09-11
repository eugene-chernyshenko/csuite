"use client";

import { memo } from "react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import type { TaskStatus } from "@csuite/contract";
import { taskStatusLabel } from "@/components/desk/util";
import { TASK_TONE, TONE, TONE_SOFT } from "./tokens";

export interface TaskChipProps {
  title: string;
  status: TaskStatus;
  assignee?: string;
  /** set for one flash window right after the task became blocked */
  flashKey?: string;
  reduced: boolean;
}

function TaskChipImpl({ title, status, assignee, flashKey, reduced }: TaskChipProps) {
  const t = useTranslations();
  const tone = TASK_TONE[status];
  const border = status === "todo" ? "var(--color-line)" : TONE[tone];
  const fg = status === "todo" ? "var(--color-ink-soft)" : TONE[tone];

  return (
    <motion.span
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 6, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: reduced ? 0 : 0.18 } }}
      transition={{ duration: reduced ? 0 : 0.32, ease: "easeOut" }}
      title={`${title} — ${taskStatusLabel(t, status)}${assignee ? ` · ${assignee}` : ""}`}
      className="relative flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-sm border px-1.5 py-[2px] text-[10.5px] leading-[15px]"
      style={{
        borderColor: border,
        background: status === "todo" ? "var(--color-sheet)" : TONE_SOFT[tone],
        color: fg,
      }}
    >
      <span
        className="h-1 w-1 shrink-0 rounded-full"
        style={{ background: status === "todo" ? "var(--color-line)" : TONE[tone] }}
      />
      <span className="truncate">{title}</span>
      {flashKey && !reduced && (
        <motion.span
          key={flashKey}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-sm"
          style={{ background: "var(--color-pencil)" }}
          initial={{ opacity: 0.5 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      )}
    </motion.span>
  );
}

export const TaskChip = memo(TaskChipImpl);
