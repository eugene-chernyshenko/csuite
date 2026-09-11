"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { getSkin, listSkins, registerSkin } from "@/lib/skin";
import { orgChartSkin } from "./skins/orgchart";

/**
 * The Floor is skin-swappable: the same sim state can be rendered as an org
 * chart today and a pixel office later. Skins register themselves here at
 * module load; FloorView only picks one and mounts it.
 */
registerSkin(orgChartSkin);

const DEFAULT_SKIN = "orgchart";

/** Skin registry names are plain data (set at module load, outside React) — translate known ids here. */
function skinLabel(t: ReturnType<typeof useTranslations<"floor">>, id: string, fallback: string): string {
  if (id === "orgchart") return t("skinOrgChart");
  return fallback;
}

export function FloorView() {
  const t = useTranslations("floor");
  const [skinId, setSkinId] = useState(DEFAULT_SKIN);
  const skins = listSkins();
  const skin = getSkin(skinId) ?? skins[0];

  if (!skin) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-soft">
        {t("noSkin")}
      </div>
    );
  }

  const Skin = skin.Component;

  return (
    <div className="relative h-full min-h-0">
      <Skin />
      {skins.length > 1 && (
        <div className="absolute top-2 right-3 z-50 flex items-center gap-0.5 rounded-md border border-line bg-sheet p-0.5">
          {skins.map((s) => (
            <button
              key={s.id}
              onClick={() => setSkinId(s.id)}
              className={`rounded px-2 py-1 text-[11px] ${
                s.id === skin.id ? "bg-sign-soft text-sign" : "text-ink-soft hover:text-ink"
              }`}
            >
              {skinLabel(t, s.id, s.name)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
