"use client";

import { useTranslations } from "next-intl";
import { useSim } from "@/lib/company";
import { Dot } from "./primitives";
import { roleName, roleTitle, toneText, type InboxItem, type RoleMap } from "./util";

/** The pencil-red severity marker on an open escalation. */
function SeverityMark({ severity }: { severity: "attention" | "urgent" }) {
  return (
    <span
      aria-hidden
      className="mt-[3px] h-3.5 w-[3px] shrink-0 rounded-[1px]"
      style={{
        background: severity === "urgent" ? "var(--color-pencil)" : "transparent",
        boxShadow: severity === "urgent" ? undefined : "inset 0 0 0 1px var(--color-pencil)",
      }}
    />
  );
}

function Row({
  item,
  roles,
  selected,
  quiet,
  onSelect,
}: {
  item: InboxItem;
  roles: RoleMap;
  selected: boolean;
  quiet: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations();
  // Unit-aware: sim-minutes in demo, epoch milliseconds in live.
  const clock = useSim((s) => s.time.format);
  const author = roleName(t, roles, item.authorRoleId);
  const title = roleTitle(roles, item.authorRoleId);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`relative flex w-full items-start gap-2.5 border-b border-line px-4 py-3 text-left transition-colors ${
          selected ? "bg-sign-soft" : "hover:bg-paper"
        }`}
      >
        {selected && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[2px]"
            style={{ background: "var(--color-sign)" }}
          />
        )}

        {item.kind === "escalation" && item.severity && item.needsYou ? (
          <SeverityMark severity={item.severity} />
        ) : (
          <span className="mt-[6px]">
            <Dot tone={item.tone} size={quiet ? 5 : 6} />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span
            className={`block text-[13px] leading-snug ${
              quiet ? "text-ink-soft" : "font-medium text-ink"
            }`}
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.title}
          </span>
          <span className="mt-1 block truncate text-[12px] text-ink-soft">
            {author}
            {title ? `, ${title.toLowerCase()}` : ""}
          </span>
          <span className={`mt-1 block text-[11px] ${toneText(item.tone)}`}>
            {item.statusLabel}
          </span>
        </span>

        <span className="mt-[1px] font-mono text-[11px] text-ink-soft tnum">
          {clock(item.ts)}
        </span>
      </button>
    </li>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <li className="bg-sheet px-4 pt-4 pb-1.5 text-[11px] font-medium text-ink-soft">
      {children}
    </li>
  );
}

export function Inbox({
  items,
  roles,
  selectedKey,
  onSelect,
}: {
  items: InboxItem[];
  roles: RoleMap;
  selectedKey: string | null;
  onSelect: (item: InboxItem) => void;
}) {
  const t = useTranslations("desk");
  const needsYou = items.filter((i) => i.needsYou);
  const earlier = items.filter((i) => !i.needsYou);

  return (
    <aside className="flex w-[21rem] shrink-0 flex-col border-r border-line bg-sheet">
      <header className="flex items-baseline gap-2 border-b border-line px-4 py-2.5">
        <h1 className="text-[13px] font-semibold text-ink">{t("yourDesk")}</h1>
        <span className="text-[12px] text-ink-soft">
          {needsYou.length > 0
            ? t("itemsNeedYou", { count: needsYou.length })
            : t("nothingWaiting")}
        </span>
      </header>

      {items.length === 0 ? (
        <div className="flex-1 px-4 py-4 text-[12px] text-ink-soft">
          {t("nothingReached")}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {needsYou.length > 0 && <GroupHeading>{t("needsYouGroup")}</GroupHeading>}
          {needsYou.map((item) => (
            <Row
              key={item.key}
              item={item}
              roles={roles}
              selected={item.key === selectedKey}
              quiet={false}
              onSelect={() => onSelect(item)}
            />
          ))}

          {earlier.length > 0 && <GroupHeading>{t("earlierToday")}</GroupHeading>}
          {earlier.map((item) => (
            <Row
              key={item.key}
              item={item}
              roles={roles}
              selected={item.key === selectedKey}
              quiet
              onSelect={() => onSelect(item)}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}
