"use client";

/** Small shared pieces of the Desk's document language. */

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { clock } from "@csuite/contract";
import { toneText, toneVar, type Tone } from "./util";

/**
 * A ruled section of a document: hairline above, quiet sans heading.
 * `rule` is dropped when the section already sits under the header's rule.
 */
export function Section({
  title,
  note,
  rule = true,
  children,
}: {
  title: string;
  note?: string;
  rule?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={rule ? "mt-7 border-t border-line pt-5" : "mt-6"}>
      <h2 className="text-[12px] font-medium text-ink-soft">{title}</h2>
      {note && <p className="mt-0.5 text-[12px] text-ink-soft">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * A document heading. The line-height is set inline because globals.css
 * declares an unlayered `.font-serif { line-height: 1.6 }`, which outranks
 * any Tailwind leading-* utility.
 */
export function DocTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1
      className="mt-2.5 max-w-prose font-serif text-[27px] font-semibold text-ink"
      style={{ lineHeight: 1.2 }}
    >
      {children}
    </h1>
  );
}

/** Serif body copy, held under 80ch. */
export function Body({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-prose font-serif text-[15px] text-ink">{children}</p>
  );
}

/** A list of short statements — alternatives, risks, key points. */
export function Statements({
  items,
  tone = "neutral",
  size = "body",
}: {
  items: readonly string[];
  tone?: Tone;
  size?: "body" | "small";
}) {
  const t = useTranslations("common");
  if (!items.length) return <p className="text-[13px] text-ink-soft">{t("noneRecorded")}</p>;
  return (
    <ul className="max-w-prose space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span
            aria-hidden
            className="mt-[9px] h-px w-2.5 shrink-0"
            style={{ background: toneVar(tone) }}
          />
          <span
            className={
              size === "small"
                ? "font-serif text-[14px] text-ink-soft"
                : "font-serif text-[15px] text-ink"
            }
          >
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A coloured rail down the left edge of a block. */
export function Rail({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className="absolute inset-y-0 left-0 w-[3px] rounded-l-md"
      style={{ background: toneVar(tone) }}
    />
  );
}

/**
 * The outcome of a decision, set down like a stamp on the document.
 * `fresh` is true only for a decision the user just made — motion answers
 * user actions, it does not greet you on arrival.
 */
export function Stamp({
  tone,
  label,
  at,
  fresh = false,
}: {
  tone: Tone;
  label: string;
  at?: number;
  fresh?: boolean;
}) {
  const reduced = useReducedMotion();
  const color = toneVar(tone);
  const still = reduced || !fresh;

  return (
    <motion.div
      initial={still ? false : { opacity: 0, scale: 1.22, rotate: -8 }}
      animate={{ opacity: 1, scale: 1, rotate: -1.5 }}
      transition={{ type: "spring", stiffness: 380, damping: 24, mass: 0.7 }}
      className="inline-flex items-baseline gap-2.5 rounded-md border-2 px-3.5 py-1.5"
      style={{ borderColor: color, color }}
    >
      <span className="text-[13px] font-semibold">{label}</span>
      {at !== undefined && (
        <span className="font-mono text-[12px] tnum opacity-75">{clock(at)}</span>
      )}
    </motion.div>
  );
}

/** name · title · time, under a document heading. */
export function Byline({
  name,
  title,
  at,
}: {
  name: string;
  title?: string;
  at?: number;
}) {
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-soft">
      <span className="text-ink">{name}</span>
      {title && <span>{title}</span>}
      {at !== undefined && (
        <>
          <span aria-hidden>·</span>
          <span className="font-mono text-[12px] tnum">{clock(at)}</span>
        </>
      )}
    </p>
  );
}

/** The one-line kind + status above a document title. */
export function DocKicker({ kind, tone, status }: { kind: string; tone: Tone; status: string }) {
  return (
    <p className="flex items-center gap-2 text-[12px]">
      <span className="text-ink-soft">{kind}</span>
      <span aria-hidden className="h-3 w-px bg-line" />
      <span className={`font-medium ${toneText(tone)}`}>{status}</span>
    </p>
  );
}

/** A small semantic dot, for task and inbox rows. */
export function Dot({ tone, size = 6 }: { tone: Tone; size?: number }) {
  return (
    <span
      aria-hidden
      className="shrink-0 rounded-full"
      style={{ background: toneVar(tone), width: size, height: size }}
    />
  );
}
