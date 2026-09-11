"use client";

import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { clock } from "@csuite/contract";
import type { FeedLine } from "./derive";
import { TONE } from "./tokens";

export interface NowStripProps {
  lines: FeedLine[];
  reduced: boolean;
}

function NowStripImpl({ lines, reduced }: NowStripProps) {
  const t = useTranslations("floor");
  return (
    <div className="flex shrink-0 items-center gap-0 border-t border-line bg-sheet px-4 py-1.5">
      <span className="shrink-0 pr-3 text-[10.5px] text-ink-soft">{t("now")}</span>
      <div className="flex min-w-0 flex-1 items-stretch">
        {lines.length === 0 && (
          <span className="text-[11px] text-ink-soft">{t("nothingYet")}</span>
        )}
        <AnimatePresence initial={false} mode="popLayout">
          {lines.map((l, i) => (
            <motion.div
              key={l.id}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: i === 0 ? 1 : 0.62 }}
              exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.15 } }}
              transition={{ duration: reduced ? 0 : 0.28, ease: "easeOut" }}
              className="flex min-w-0 flex-1 items-baseline gap-1.5 border-l border-line px-3 first:border-l-0 first:pl-0"
            >
              <span className="shrink-0 font-mono text-[10.5px] text-ink-soft tnum">
                {clock(l.ts)}
              </span>
              <span
                className="truncate text-[11.5px] leading-[16px]"
                style={{ color: l.tone === "ink" ? "var(--color-ink)" : TONE[l.tone] }}
              >
                {l.text}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export const NowStrip = memo(NowStripImpl);
