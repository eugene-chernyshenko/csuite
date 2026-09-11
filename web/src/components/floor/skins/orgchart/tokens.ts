import type { Activity, TaskStatus } from "@csuite/contract";
import type { Tone } from "./derive";

/** Design tokens resolved to CSS custom properties (see DESIGN.md). */
export const TONE: Record<Tone, string> = {
  sign: "var(--color-sign)",
  pencil: "var(--color-pencil)",
  ledger: "var(--color-ledger)",
  hold: "var(--color-hold)",
  ink: "var(--color-ink)",
};

export const TONE_SOFT: Record<Tone, string> = {
  sign: "var(--color-sign-soft)",
  pencil: "var(--color-pencil-soft)",
  ledger: "var(--color-ledger-soft)",
  hold: "var(--color-hold-soft)",
  ink: "var(--color-paper)",
};

export interface ActivityLook {
  label: string;
  tone: Tone;
  /** idle agents are still; everyone else breathes */
  alive: boolean;
}

export const ACTIVITY: Record<Activity, ActivityLook> = {
  idle: { label: "Idle", tone: "ink", alive: false },
  thinking: { label: "Thinking", tone: "hold", alive: true },
  writing: { label: "Writing", tone: "sign", alive: true },
  coding: { label: "Coding", tone: "sign", alive: true },
  reviewing: { label: "Reviewing", tone: "ledger", alive: true },
  analyzing: { label: "Analyzing", tone: "hold", alive: true },
  meeting: { label: "In a meeting", tone: "sign", alive: true },
};

export const TASK_TONE: Record<TaskStatus, Tone> = {
  todo: "ink",
  in_progress: "sign",
  in_review: "hold",
  blocked: "pencil",
  done: "ledger",
};
