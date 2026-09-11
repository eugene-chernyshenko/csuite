"use client";

/**
 * The one context every view reads the company through.
 *
 * It lives in its own module so the two providers (`sim.tsx`, `live.tsx`) can
 * both publish into it without importing each other, and so `useSim` stays a
 * single hook with a single error message regardless of which one is mounted.
 */

import { createContext, useContext } from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";
import type { CompanyStore, Mode } from "./store";

/** Read-only view of a store: the providers own writing, the views only read. */
export type CompanyStoreApi = Pick<
  StoreApi<CompanyStore>,
  "getState" | "getInitialState" | "subscribe"
>;

export const CompanyStoreContext = createContext<CompanyStoreApi | null>(null);

/**
 * The universal company hook.
 *
 * Named `useSim` for continuity with Phase 0 — every view already calls it, and
 * live mode was built to need no change at the call sites. It reads whichever
 * provider is mounted; `s.mode` says which, for the handful of places where the
 * difference is real (playback controls, "press play" copy, empty states).
 */
export function useSim<T>(selector: (s: CompanyStore) => T): T {
  const store = useContext(CompanyStoreContext);
  if (!store) throw new Error("useSim must be used within a CompanyProvider");
  return useStore(store, selector);
}

/** Convenience for the several components that only branch on the mode. */
export function useMode(): Mode {
  return useSim((s) => s.mode);
}
