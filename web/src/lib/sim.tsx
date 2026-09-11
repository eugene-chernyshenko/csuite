"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { useStore } from "zustand";
import { createSimStore, type SimStore } from "./store";
import { company, dayOne } from "./scenario/day-one";

type Store = ReturnType<typeof createSimStore>;

const SimContext = createContext<Store | null>(null);

export function SimProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<Store | null>(null);
  if (!ref.current) ref.current = createSimStore(company, dayOne);

  useEffect(() => {
    const store = ref.current!;
    const interval = setInterval(() => store.getState().tick(0.1), 100);
    return () => clearInterval(interval);
  }, []);

  return <SimContext.Provider value={ref.current}>{children}</SimContext.Provider>;
}

export function useSim<T>(selector: (s: SimStore) => T): T {
  const store = useContext(SimContext);
  if (!store) throw new Error("useSim must be used within SimProvider");
  return useStore(store, selector);
}
