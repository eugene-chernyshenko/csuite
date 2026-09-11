"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSim } from "@/lib/sim";

const tabs = [
  { href: "/", label: "Floor" },
  { href: "/desk", label: "Desk" },
  { href: "/reports", label: "Reports" },
  { href: "/metrics", label: "Metrics" },
];

export function TopBar() {
  const pathname = usePathname();
  const companyName = useSim((s) => s.config.name);
  const pending = useSim(
    (s) =>
      Object.values(s.state.proposals).filter((p) => p.status === "pending_approval").length +
      Object.values(s.state.escalations).filter((e) => e.status === "open").length,
  );
  const spent = useSim((s) => s.state.spent);
  const budget = useSim((s) => s.config.monthlyBudget);

  return (
    <header className="flex items-center gap-6 border-b border-line bg-sheet px-5 py-2.5">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[15px] font-semibold tracking-tight text-ink">csuite</span>
        <span className="text-[13px] text-ink-soft">{companyName}</span>
      </div>
      <nav className="flex items-center gap-1">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`relative rounded-md px-3 py-1.5 text-[13px] ${
                active ? "bg-sign-soft font-medium text-sign" : "text-ink-soft hover:text-ink"
              }`}
            >
              {t.label}
              {t.href === "/desk" && pending > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-hold px-1 font-mono text-[10px] text-white tnum">
                  {pending}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2 text-[13px] text-ink-soft">
        <span>Spend this month</span>
        <span className="font-mono text-ink tnum">
          ${spent.toLocaleString("en-US")} / ${budget.toLocaleString("en-US")}
        </span>
      </div>
    </header>
  );
}
