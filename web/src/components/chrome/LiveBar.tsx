"use client";

/**
 * The live mode strip: where the CEO puts a question to a real board.
 *
 * It occupies the same row the demo's transport bar does, and says the same
 * three things a control surface has to say — what you can do, whether it is
 * working, and whether anything is wrong. Nothing here is decorative: the dot
 * is the connection, the pulse is a deliberation actually running on the
 * server, and the notice line is the API's own words.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSim } from "@/lib/sim";

function StatusDot({ connection }: { connection: "connecting" | "online" | "offline" }) {
  const color =
    connection === "online"
      ? "var(--color-ledger)"
      : connection === "connecting"
        ? "var(--color-hold)"
        : "var(--color-pencil)";
  return (
    <span
      aria-hidden
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

/** Three dots that breathe — a deliberation takes minutes, not milliseconds. */
function Busy() {
  return (
    <span aria-hidden className="inline-flex items-center gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 rounded-full bg-hold"
          style={{ animation: `csuite-busy 1.2s ${i * 0.16}s infinite ease-in-out` }}
        />
      ))}
    </span>
  );
}

export function LiveBar() {
  const t = useTranslations("live");
  const mode = useSim((s) => s.mode);
  const companyName = useSim((s) => s.config.name);
  const connection = useSim((s) => s.connection);
  const boardOnline = useSim((s) => s.boardOnline);
  const deliberating = useSim((s) => s.deliberating);
  const notice = useSim((s) => s.notice);
  const ask = useSim((s) => s.ask);
  const dismissNotice = useSim((s) => s.dismissNotice);

  const [text, setText] = useState("");

  if (mode !== "live") return null;

  const canAsk = text.trim().length > 0 && !deliberating;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canAsk) return;
    ask(text);
    setText("");
  }

  const statusLabel =
    connection === "online"
      ? t("online")
      : connection === "connecting"
        ? t("connecting")
        : t("offline");

  return (
    <div className="border-b border-line bg-sheet">
      <div className="flex items-center gap-3 px-5 py-2">
        <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("askPlaceholder")}
            aria-label={t("askAria")}
            className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-[13px] text-ink placeholder:text-ink-soft focus:border-sign focus:outline-none"
          />
          <button
            type="submit"
            disabled={!canAsk}
            className="h-7 shrink-0 rounded-md bg-sign px-4 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {t("ask")}
          </button>
        </form>

        {deliberating && (
          <span className="flex shrink-0 items-center gap-2 text-[12px] text-hold">
            <Busy />
            {t("deliberating")}
          </span>
        )}

        <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-soft">
          <StatusDot connection={connection} />
          <span>{statusLabel}</span>
          <span aria-hidden>·</span>
          <span className="text-ink">{companyName}</span>
        </span>
      </div>

      {connection === "offline" && (
        <p className="border-t border-line bg-pencil-soft px-5 py-1.5 text-[12px] text-pencil">
          {t("offlineHint")}
        </p>
      )}

      {connection === "online" && !boardOnline && (
        <p className="border-t border-line bg-hold-soft px-5 py-1.5 text-[12px] text-hold">
          {t("boardOffline")}
        </p>
      )}

      {notice && connection !== "offline" && (
        <p className="flex items-center gap-3 border-t border-line px-5 py-1.5 text-[12px] text-ink-soft">
          <span className="min-w-0 flex-1 truncate">{notice}</span>
          <button
            type="button"
            onClick={dismissNotice}
            className="shrink-0 text-[12px] text-sign hover:underline"
          >
            {t("dismiss")}
          </button>
        </p>
      )}
    </div>
  );
}
