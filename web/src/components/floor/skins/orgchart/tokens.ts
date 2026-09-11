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
  /** Message key under the `floor.activity` namespace — the label itself is
   * translated where it's rendered, since this module isn't a component. */
  labelKey: Activity;
  tone: Tone;
  /** idle agents are still; everyone else breathes */
  alive: boolean;
}

export const ACTIVITY: Record<Activity, ActivityLook> = {
  idle: { labelKey: "idle", tone: "ink", alive: false },
  thinking: { labelKey: "thinking", tone: "hold", alive: true },
  writing: { labelKey: "writing", tone: "sign", alive: true },
  coding: { labelKey: "coding", tone: "sign", alive: true },
  reviewing: { labelKey: "reviewing", tone: "ledger", alive: true },
  analyzing: { labelKey: "analyzing", tone: "hold", alive: true },
  meeting: { labelKey: "meeting", tone: "sign", alive: true },
};

export const TASK_TONE: Record<TaskStatus, Tone> = {
  todo: "ink",
  in_progress: "sign",
  in_review: "hold",
  blocked: "pencil",
  done: "ledger",
};
