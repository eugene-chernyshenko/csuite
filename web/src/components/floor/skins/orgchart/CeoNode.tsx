"use client";

import { memo } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";

export interface CeoNodeProps {
  title: string;
  companyName: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** a proposal is sitting in the inbox waiting to be signed */
  awaiting: boolean;
  awaitingTitle?: string;
  openEscalations: number;
  reduced: boolean;
}

function CeoNodeImpl({
  title,
  companyName,
  x,
  y,
  w,
  h,
  awaiting,
  awaitingTitle,
  openEscalations,
  reduced,
}: CeoNodeProps) {
  const t = useTranslations("floor.ceo");
  return (
    <div className="absolute" style={{ left: x - w / 2, top: y - h / 2, width: w, height: h }}>
      {awaiting && !reduced && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute -inset-1.5 rounded-lg"
          style={{ border: "1px solid var(--color-hold)" }}
          animate={{ opacity: [0.85, 0.2, 0.85], scale: [1, 1.03, 1] }}
          transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {awaiting && reduced && (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1.5 rounded-lg"
          style={{ border: "1px solid var(--color-hold)" }}
        />
      )}

      <div
        className="relative flex h-full flex-col justify-center rounded-md border-[1.5px] bg-sheet px-3"
        style={{ borderColor: "var(--color-sign)" }}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-[14px] font-semibold text-sign">{t("you")}</span>
          <span className="ml-auto truncate font-mono text-[9px] text-ink-soft">{t("human")}</span>
        </div>
        <div className="truncate text-[11px] leading-[15px] text-ink-soft">{title}</div>
        <div className="truncate text-[10.5px] leading-[14px] text-ink-soft">
          {t("reportsToYou", { company: companyName })}
        </div>
      </div>

      {(awaiting || openEscalations > 0) && (
        <div className="absolute top-full left-1/2 z-20 mt-2.5 flex -translate-x-1/2 flex-col items-center gap-1">
          {awaiting && (
            <Link
              href="/desk"
              className="flex max-w-[300px] items-center gap-2 rounded-md border border-hold bg-hold-soft px-2.5 py-1 text-[11px] text-hold hover:bg-sheet"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-hold" />
              <span className="truncate font-medium">
                {awaitingTitle ? t("waitingWithTitle", { title: awaitingTitle }) : t("waiting")}
              </span>
              <span className="shrink-0 underline underline-offset-2">{t("openDesk")}</span>
            </Link>
          )}
          {openEscalations > 0 && (
            <Link
              href="/desk"
              className="rounded-md border border-pencil bg-pencil-soft px-2 py-[3px] text-[10.5px] text-pencil hover:bg-sheet"
            >
              {t("escalationsOpen", { count: openEscalations })}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export const CeoNode = memo(CeoNodeImpl);
