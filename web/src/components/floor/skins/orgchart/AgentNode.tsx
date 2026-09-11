"use client";

import { memo } from "react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import type { Activity } from "@csuite/contract";
import type { Tone } from "./derive";
import { ACTIVITY, TONE, TONE_SOFT } from "./tokens";

export interface AgentNodeProps {
  name: string;
  title: string;
  model?: string;
  activity: Activity;
  note?: string;
  /** centre x / centre y in stage pixels */
  x: number;
  y: number;
  w: number;
  h: number;
  /** live deliberation, shown in place of the worklog note */
  stanceTone?: Tone;
  stanceText?: string;
  /** an escalation raised by this agent is still open */
  escalated: boolean;
  /** changes when a fresh escalation should flash the node */
  flashKey?: string;
  reduced: boolean;
}

function AgentNodeImpl({
  name,
  title,
  model,
  activity,
  note,
  x,
  y,
  w,
  h,
  stanceTone,
  stanceText,
  escalated,
  flashKey,
  reduced,
}: AgentNodeProps) {
  const t = useTranslations("floor");
  const look = ACTIVITY[activity] ?? ACTIVITY.idle;
  const activityLabel = t(`activity.${look.labelKey}`);
  const alive = look.alive;
  const deliberating = Boolean(stanceText);
  const accent = deliberating && stanceTone ? TONE[stanceTone] : undefined;
  const bubble = stanceText ?? note;
  const bubbleTone = accent ?? "var(--color-ink-soft)";

  return (
    <div className="absolute" style={{ left: x - w / 2, top: y - h / 2, width: w, height: h }}>
      {/* breathing halo — ambient only, removed under reduced motion */}
      {alive && !reduced && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-lg"
          style={{ background: TONE_SOFT[look.tone] }}
          animate={{ opacity: [0.9, 0.25, 0.9], scale: [1, 1.035, 1] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      <div
        className="relative flex h-full flex-col justify-center overflow-hidden rounded-md border bg-sheet px-2.5"
        style={{
          borderColor: accent ?? (escalated ? "var(--color-pencil)" : "var(--color-line)"),
          boxShadow: accent ? `0 0 0 1px ${accent}` : undefined,
        }}
      >
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink">{name}</span>
          {model && (
            <span className="ml-auto shrink-0 rounded-sm border border-line px-1 font-mono text-[9px] leading-[14px] text-ink-soft">
              {model}
            </span>
          )}
        </div>
        <div className="truncate text-[11px] leading-[15px] text-ink-soft">{title}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background: alive ? TONE[look.tone] : "var(--color-line)",
              outline: alive ? `2px solid ${TONE_SOFT[look.tone]}` : undefined,
            }}
          />
          <span
            className="truncate text-[10.5px] leading-[14px]"
            style={{ color: alive ? TONE[look.tone] : "var(--color-ink-soft)" }}
          >
            {activityLabel}
          </span>
        </div>

        {/* escalation flash — one pass, keyed on the event so a scrub replays it */}
        {flashKey && !reduced && (
          <motion.span
            key={flashKey}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-md"
            style={{ background: "var(--color-pencil)" }}
            initial={{ opacity: 0.42 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        )}
      </div>

      {escalated && (
        <span
          className="absolute -top-1.5 -right-1.5 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-pencil font-mono text-[10px] leading-none font-medium text-white"
          title={t("agentEscalatedTitle")}
        >
          !
        </span>
      )}

      {bubble && (
        <div
          className="pointer-events-none absolute top-full left-1/2 z-10 mt-2 -translate-x-1/2"
          style={{ maxWidth: Math.max(w + 56, 180) }}
        >
          <span
            aria-hidden
            className="absolute -top-[3px] left-1/2 h-[6px] w-[6px] -translate-x-1/2 rotate-45 border-t border-l bg-sheet"
            style={{ borderColor: deliberating ? bubbleTone : "var(--color-line)" }}
          />
          <div
            className="truncate rounded-md border bg-sheet px-1.5 py-[3px] text-[10.5px] leading-[14px]"
            style={{
              borderColor: deliberating ? bubbleTone : "var(--color-line)",
              color: deliberating ? bubbleTone : "var(--color-ink-soft)",
            }}
          >
            {bubble}
          </div>
        </div>
      )}
    </div>
  );
}

export const AgentNode = memo(AgentNodeImpl);
