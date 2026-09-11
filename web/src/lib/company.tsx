"use client";

/**
 * Mode selection: demo or live, and the provider that follows from it.
 *
 * - **Demo** is Phase 0 exactly: a scripted day with a transport bar.
 * - **Live** is a real company on the platform server: the board actually
 *   deliberates, and the CEO's decisions are appends to a durable log.
 *
 * The choice is the user's and it sticks (localStorage), but `?mode=live`
 * overrides it for a single visit — handy for a link that opens straight into
 * the real thing. The default stays demo: nothing about the app should require
 * a running server to be worth looking at.
 *
 * The mode lives in the browser, so the server cannot know it. It is therefore
 * held in a tiny external store read through `useSyncExternalStore`, whose
 * server snapshot is always "demo": React renders the server's answer, hydrates
 * against it, then re-renders with the real one. Switching modes unmounts one
 * provider and mounts the other, which is exactly right — the two stores have
 * nothing to say to each other.
 */

import { useCallback, useSyncExternalStore } from "react";
import { SimProvider } from "./sim";
import { LiveProvider } from "./live";
import type { Mode } from "./store";

const MODE_KEY = "csuite.mode";

function isMode(value: string | null | undefined): value is Mode {
  return value === "demo" || value === "live";
}

/** Query param first (a link can force a mode), then the remembered choice. */
function readMode(): Mode {
  const fromQuery = new URLSearchParams(window.location.search).get("mode");
  if (isMode(fromQuery)) return fromQuery;
  try {
    const stored = window.localStorage.getItem(MODE_KEY);
    if (isMode(stored)) return stored;
  } catch {
    /* private mode, blocked storage — the default is fine */
  }
  return "demo";
}

/* ---------------------------------------------------------- the tiny store */

let current: Mode | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): Mode {
  // Resolved once, on first client read: `readMode` touches `window`.
  if (current === null) current = readMode();
  return current;
}

/** The server has no browser to ask, and the default is demo. */
function getServerSnapshot(): Mode {
  return "demo";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function writeMode(next: Mode): void {
  if (current === next) return;
  current = next;
  try {
    window.localStorage.setItem(MODE_KEY, next);
  } catch {
    /* the choice just won't survive a reload */
  }
  for (const l of listeners) l();
}

/* ------------------------------------------------------------------ hooks */

export interface ModeSwitch {
  mode: Mode;
  setMode(mode: Mode): void;
}

export function useModeSwitch(): ModeSwitch {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setMode = useCallback((next: Mode) => writeMode(next), []);
  return { mode, setMode };
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useModeSwitch();
  const Provider = mode === "live" ? LiveProvider : SimProvider;

  // `key` so switching modes tears the old store down rather than re-using a
  // tree that was built around the other one.
  return <Provider key={mode}>{children}</Provider>;
}
