"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useSim } from "@/lib/sim";
import { useModeSwitch } from "@/lib/company";
import type { Mode } from "@/lib/store";
import { LOCALE_COOKIE, type Locale } from "@/i18n/locales";

/**
 * Demo or live — the one place the user chooses what they are looking at.
 * Kept deliberately small and unglamorous: this is a developer/demo affordance,
 * not a product feature, and the choice is remembered between visits.
 */
function ModeSwitcher() {
  const { mode, setMode } = useModeSwitch();
  const t = useTranslations("nav");
  const options: { id: Mode; label: string }[] = [
    { id: "demo", label: t("modeDemo") },
    { id: "live", label: t("modeLive") },
  ];

  return (
    <div
      role="group"
      aria-label={t("modeAria")}
      className="flex items-center gap-0.5 rounded-md border border-line p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setMode(o.id)}
          aria-pressed={mode === o.id}
          className={`rounded px-2 py-0.5 text-[11.5px] ${
            mode === o.id ? "bg-sign-soft font-medium text-sign" : "text-ink-soft hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Sets the locale cookie and asks the server to re-render everything with it. */
function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("common");

  function setLocale(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
  }

  return (
    <div className="flex items-center gap-0.5 text-[12px]">
      <button
        type="button"
        onClick={() => setLocale("en")}
        aria-current={locale === "en" ? "true" : undefined}
        className={`rounded px-1.5 py-1 ${locale === "en" ? "font-medium text-sign" : "text-ink-soft hover:text-ink"}`}
      >
        {t("langEn")}
      </button>
      <span className="text-ink-soft">/</span>
      <button
        type="button"
        onClick={() => setLocale("ru")}
        aria-current={locale === "ru" ? "true" : undefined}
        className={`rounded px-1.5 py-1 ${locale === "ru" ? "font-medium text-sign" : "text-ink-soft hover:text-ink"}`}
      >
        {t("langRu")}
      </button>
    </div>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const companyName = useSim((s) => s.config.name);
  const pending = useSim(
    (s) =>
      Object.values(s.state.proposals).filter((p) => p.status === "pending_approval").length +
      Object.values(s.state.escalations).filter((e) => e.status === "open").length,
  );
  const spent = useSim((s) => s.state.spent);
  const budget = useSim((s) => s.config.monthlyBudget);

  const tabs = [
    { href: "/", label: t("floor") },
    { href: "/desk", label: t("desk") },
    { href: "/reports", label: t("reports") },
    { href: "/metrics", label: t("metrics") },
  ];

  return (
    <header className="flex items-center gap-6 border-b border-line bg-sheet px-5 py-2.5">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[15px] font-semibold tracking-tight text-ink">csuite</span>
        <span className="text-[13px] text-ink-soft">{companyName}</span>
      </div>
      <nav className="flex items-center gap-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative rounded-md px-3 py-1.5 text-[13px] ${
                active ? "bg-sign-soft font-medium text-sign" : "text-ink-soft hover:text-ink"
              }`}
            >
              {tab.label}
              {tab.href === "/desk" && pending > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-hold px-1 font-mono text-[10px] text-white tnum">
                  {pending}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2 text-[13px] text-ink-soft">
        <span>{t("spendThisMonth")}</span>
        <span className="font-mono text-ink tnum">
          ${spent.toLocaleString("en-US")} / ${budget.toLocaleString("en-US")}
        </span>
      </div>
      <ModeSwitcher />
      <LanguageSwitcher />
    </header>
  );
}
