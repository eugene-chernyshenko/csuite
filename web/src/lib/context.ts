"use client";

/**
 * The one context every view reads the company through.
 *
 * `LiveProvider` (./live.tsx) publishes into it; views read with `useSim`.
 * The hook keeps its Phase 0 name — every call site already uses it, and the
 * store shape (`CompanyStore`) is the contract between provider and views.
 */

import { createContext, useContext } from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";
import type { CompanyStore } from "./store";

/** Read-only view of a store: the provider owns writing, the views only read. */
export type CompanyStoreApi = Pick<
  StoreApi<CompanyStore>,
  "getState" | "getInitialState" | "subscribe"
>;

export const CompanyStoreContext = createContext<CompanyStoreApi | null>(null);

export function useSim<T>(selector: (s: CompanyStore) => T): T {
  const store = useContext(CompanyStoreContext);
  if (!store) throw new Error("useSim must be used within a CompanyProvider");
  return useStore(store, selector);
}
