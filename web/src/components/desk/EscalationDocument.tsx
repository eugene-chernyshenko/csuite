"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Escalation } from "@csuite/contract";
import { Byline, DocKicker, DocTitle, Rail, Section, Stamp } from "./primitives";
import { roleName, roleTitle, type RoleMap } from "./util";

export function EscalationDocument({
  escalation,
  roles,
  raisedAt,
  resolvedAt,
  fresh,
  onResolve,
}: {
  escalation: Escalation;
  roles: RoleMap;
  raisedAt?: number;
  resolvedAt?: number;
  /** The user just resolved this — the stamp gets to settle in. */
  fresh: boolean;
  onResolve: (resolution: string) => void;
}) {
  const [text, setText] = useState("");
  const open = escalation.status === "open";
  const urgent = escalation.severity === "urgent";
  const t = useTranslations();

  return (
    <article className="mx-auto w-full max-w-[46rem] rounded-md border border-line bg-sheet px-8 py-7">
      <header className="border-b border-line pb-5">
        <DocKicker
          kind={t("desk.kind.escalation")}
          tone={open ? "pencil" : "ledger"}
          status={
            open
              ? urgent
                ? t("desk.escalationStatus.urgent")
                : t("desk.escalationStatus.attention")
              : t("desk.escalationStatus.resolved")
          }
        />
        <DocTitle>{escalation.reason}</DocTitle>
        <Byline
          name={roleName(t, roles, escalation.fromRoleId)}
          title={roleTitle(roles, escalation.fromRoleId)}
          at={raisedAt}
        />
      </header>

      <Section title={t("desk.whatTheyNeed")} rule={false}>
        <div className="relative rounded-md border border-line bg-paper py-3.5 pr-4 pl-5">
          <Rail tone={open ? "pencil" : "ledger"} />
          <p className="max-w-prose font-serif text-[16px] text-ink">{escalation.ask}</p>
        </div>
      </Section>

      {open ? (
        <Section title={t("desk.yourCall")}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={t("desk.resolutionPlaceholder")}
            aria-label={t("desk.resolutionAria")}
            className="w-full max-w-prose resize-y rounded-md border border-line bg-sheet px-3 py-2 font-serif text-[15px] text-ink placeholder:font-sans placeholder:text-[13px] placeholder:text-ink-soft focus:border-sign focus:outline-none"
          />
          <div className="mt-2.5 flex items-center gap-3">
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() => onResolve(text.trim())}
              className="h-9 rounded-md bg-sign px-5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {t("desk.resolve")}
            </button>
            <span className="text-[12px] text-ink-soft">
              {t("desk.isWaitingOnThis", { name: roleName(t, roles, escalation.fromRoleId) })}
            </span>
          </div>
        </Section>
      ) : (
        <Section title={t("desk.howYouSettledIt")}>
          <Stamp tone="ledger" label={t("desk.escalationStatus.resolved")} at={resolvedAt} fresh={fresh} />
          {escalation.resolution && (
            <p className="mt-3 max-w-prose border-l-2 border-line pl-3 font-serif text-[15px] text-ink">
              {t("desk.quoteAttribution", { quote: escalation.resolution })}
            </p>
          )}
        </Section>
      )}
    </article>
  );
}
