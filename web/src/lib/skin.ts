import type { ComponentType } from "react";

/**
 * A Floor skin renders the living company from sim-store state (via useSim).
 * Same events, different look: 'orgchart' now, 'pixel-office' later.
 */
export interface FloorSkin {
  id: string;
  name: string;
  Component: ComponentType;
}

const skins = new Map<string, FloorSkin>();

export function registerSkin(skin: FloorSkin) {
  skins.set(skin.id, skin);
}

export function getSkin(id: string): FloorSkin | undefined {
  return skins.get(id);
}

export function listSkins(): FloorSkin[] {
  return [...skins.values()];
}
