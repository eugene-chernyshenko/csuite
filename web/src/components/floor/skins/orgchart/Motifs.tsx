"use client";

import { memo, useMemo } from "react";
import { motion } from "motion/react";
import type { Id } from "@/lib/contract/types";
import { travelPoints, type FloorLayout } from "./layout";
import { MESSAGE_DURATION, TRAVEL_DURATION, type Tone } from "./derive";
import { TONE, TONE_SOFT } from "./tokens";

/** A sheet of paper — proposals go up, signed decisions come back down. */
function Sheet({ tone, kind }: { tone: Tone; kind: "proposal" | "decision" | "report" }) {
  const ink = TONE[tone];
  return (
    <svg width="26" height="32" viewBox="0 0 26 32" fill="none" aria-hidden>
      <rect
        x="0.5"
        y="0.5"
        width="25"
        height="31"
        rx="2"
        fill="var(--color-sheet)"
        stroke="var(--color-line)"
      />
      <path d="M5 7h16M5 11h16M5 15h11" stroke="var(--color-line)" strokeWidth="1.5" />
      {kind === "proposal" && (
        <path d="M5 20h16M5 24h9" stroke={ink} strokeWidth="1.5" strokeOpacity="0.55" />
      )}
      {kind === "report" && (
        <path
          d="M6 23l3.5 3.5L20 19"
          stroke={ink}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {kind === "decision" && tone === "pencil" && (
        <path d="M6 19l14 9M20 19L6 28" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      )}
      {kind === "decision" && tone !== "pencil" && (
        <path
          d="M5 26c3-6 5 2 7-3s4 4 9-3"
          stroke={ink}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  );
}

export interface TravelMotifProps {
  layout: FloorLayout;
  from: Id;
  to: Id;
  tone: Tone;
  kind: "proposal" | "decision" | "report";
  label: string;
}

function TravelMotifImpl({ layout, from, to, tone, kind, label }: TravelMotifProps) {
  const pts = useMemo(() => travelPoints(layout, from, to), [layout, from, to]);
  const xs = useMemo(() => pts.map((p) => p.x), [pts]);
  const ys = useMemo(() => pts.map((p) => p.y), [pts]);
  if (pts.length < 2) return null;

  return (
    <motion.div
      className="pointer-events-none absolute top-0 left-0 z-30"
      initial={{ x: xs[0], y: ys[0], opacity: 0, scale: 0.6 }}
      animate={{ x: xs, y: ys, opacity: [0, 1, 1, 1, 0], scale: [0.6, 1, 1, 1, 0.8] }}
      exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.28 } }}
      transition={{ duration: TRAVEL_DURATION, ease: "easeInOut" }}
    >
      <div className="flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
        <div style={{ filter: "drop-shadow(0 1px 2px rgba(24,26,32,0.16))" }}>
          <Sheet tone={tone} kind={kind} />
        </div>
        <span
          className="max-w-[170px] truncate rounded-sm px-1 text-[9.5px] leading-[13px] font-medium"
          style={{ background: TONE_SOFT[tone], color: TONE[tone] }}
        >
          {label}
        </span>
      </div>
    </motion.div>
  );
}

export const TravelMotif = memo(TravelMotifImpl);

export interface MessageDotProps {
  layout: FloorLayout;
  from: Id;
  to: Id;
}

function MessageDotImpl({ layout, from, to }: MessageDotProps) {
  const pts = useMemo(() => travelPoints(layout, from, to, 5), [layout, from, to]);
  const xs = useMemo(() => pts.map((p) => p.x), [pts]);
  const ys = useMemo(() => pts.map((p) => p.y), [pts]);
  if (pts.length < 2) return null;

  return (
    <motion.span
      className="pointer-events-none absolute top-0 left-0 z-20 block h-[7px] w-[7px] rounded-full"
      style={{ background: "var(--color-sign)", marginLeft: -3.5, marginTop: -3.5 }}
      initial={{ x: xs[0], y: ys[0], opacity: 0, scale: 0.5 }}
      animate={{ x: xs, y: ys, opacity: [0, 1, 1, 0.8], scale: [0.5, 1, 1, 0.8] }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      transition={{ duration: MESSAGE_DURATION, ease: "easeInOut" }}
    />
  );
}

export const MessageDot = memo(MessageDotImpl);
