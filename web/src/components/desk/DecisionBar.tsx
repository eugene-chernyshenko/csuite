"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import type { CeoDecision } from "@csuite/contract";

/**
 * A single ink stroke drawn under the Approve button — the act of signing,
 * played once, in answer to the click.
 */
function SignatureStroke() {
  return (
    <motion.svg
      aria-hidden
      className="pointer-events-none absolute -bottom-2 left-0 w-full"
      height="12"
      viewBox="0 0 120 12"
      preserveAspectRatio="none"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
    >
      <motion.path
        d="M3 8 C 20 2, 36 11, 54 5 S 90 2, 117 7"
        fill="none"
        stroke="var(--color-sign)"
        strokeWidth={2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      />
    </motion.svg>
  );
}

export function DecisionBar({
  note,
  onNoteChange,
  onDecide,
  signing,
}: {
  note: string;
  onNoteChange: (value: string) => void;
  onDecide: (decision: CeoDecision) => void;
  /** The decision currently being signed, if any — buttons lock while it plays. */
  signing: CeoDecision | null;
}) {
  const busy = signing !== null;
  const t = useTranslations("desk");

  return (
    <div className="shrink-0 border-t border-line bg-sheet px-6 py-3">
      <div className="mx-auto flex w-full max-w-[46rem] items-center gap-2">
        <input
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder={t("notePlaceholder")}
          aria-label={t("noteAria")}
          className="h-9 min-w-0 flex-1 rounded-md border border-line bg-sheet px-3 text-[13px] text-ink placeholder:text-ink-soft focus:border-sign focus:outline-none"
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("rejected")}
          className="h-9 shrink-0 rounded-md border border-pencil px-3 text-[13px] font-medium text-pencil hover:bg-pencil-soft disabled:opacity-50"
        >
          {t("reject")}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("returned")}
          className="h-9 shrink-0 rounded-md border border-line px-3 text-[13px] text-ink hover:bg-paper disabled:opacity-50"
        >
          {t("returnWithQuestions")}
        </button>

        <div className="relative shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("approved")}
            className="h-9 rounded-md bg-sign px-5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-90"
          >
            {t("approve")}
          </button>
          <AnimatePresence>{signing === "approved" && <SignatureStroke />}</AnimatePresence>
        </div>
      </div>

      <p className="mx-auto mt-2 w-full max-w-[46rem] text-[11px] text-ink-soft">
        {t.rich("keyboardHint", {
          a: (chunks) => <span className="font-mono">{chunks}</span>,
          r: (chunks) => <span className="font-mono">{chunks}</span>,
        })}
      </p>
    </div>
  );
}
