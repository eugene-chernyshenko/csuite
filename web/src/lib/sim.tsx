"use client";

import { useEffect, useState } from "react";
import { createSimStore } from "./store";
import { company, dayOne } from "./scenario/day-one";
import { CompanyStoreContext } from "./context";

export function SimProvider({ children }: { children: React.ReactNode }) {
  // Lazy `useState` rather than a ref: the store is read during render (it is
  // the context value), and this is the one initializer React guarantees runs
  // exactly once per mount.
  const [store] = useState(() => createSimStore(company, dayOne));

  useEffect(() => {
    const interval = setInterval(() => store.getState().tick(0.1), 100);
    return () => clearInterval(interval);
  }, [store]);

  return <CompanyStoreContext.Provider value={store}>{children}</CompanyStoreContext.Provider>;
}

// `useSim` moved to ./context so both providers can publish into one context.
// Re-exported here because every view already imports it from "@/lib/sim".
export { useSim, useMode } from "./context";
