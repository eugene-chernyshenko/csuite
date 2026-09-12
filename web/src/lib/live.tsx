"use client";

/**
 * Live mode: the same four views, reading a real company off the platform API.
 *
 * The shape of it is deliberately small. The server is the log; the browser
 * holds the events it has seen and folds them with `reduce()` from
 * `@csuite/contract` — the *same* function the server folds with. That is the
 * whole point of the shared contract: live mode is not a second read model, it
 * is the same derivation running on the other side of the wire, so a bug in
 * "what the company looks like" can only ever exist in one place.
 *
 * Transport is 2-second polling of `GET /events?after=<lastSeq>`, which the
 * cursor makes incremental. Recomputing the full state from all cached events
 * on every arrival is cheap at Phase 1 volumes (hundreds of events) and buys
 * exact agreement with a cold reload. SSE can replace the transport later
 * without touching a single view.
 */

import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  emptyState,
  reduce,
  type CompanyConfig,
  type CompanyEvent,
  type Id,
} from "@csuite/contract";
import {
  ApiRequestError,
  DEFAULT_COMPANY_ID,
  askQuestion,
  getCompany,
  getEvents,
  getHealth,
  postDecision,
  postEscalationResolution,
  type StoredEvent,
} from "./api";
import { findAwaiting, type CompanyStore } from "./store";
import { REAL_TIME } from "./time";
import { CompanyStoreContext } from "./context";

/** How often we ask for events we have not seen. */
const POLL_MS = 2000;
/**
 * How often `now` advances so the Floor's animation windows keep sliding.
 * Independent of polling: it moves the clock, it does not touch the network.
 */
const CLOCK_MS = 250;
/** Past this much quiet, the clock stops ticking every frame and idles. */
const REST_MS = 12_000;
/** …but still refreshes this often, so nothing on screen goes stale. */
const IDLE_TICK_MS = 30_000;

/** Role id the board speaks under as a body, not as a member (server-side). */
const BOARD_ROLE_ID = "board";

/** A company we have not managed to load yet — never rendered as fact. */
function placeholderConfig(companyId: string): CompanyConfig {
  return {
    name: companyId,
    product: "",
    monthlyBudget: 0,
    currency: "USD",
    departments: [],
    roles: [],
  };
}

/**
 * Does this event end the wait for an answer to the CEO's question?
 *
 * A board run reports back only through the log (server/src/board/run.ts): it
 * either submits a proposal, or files a worklog saying why it could not. The
 * body-level notices come from the `board` role; the "only N of M positions
 * came back" one is filed under the drafting role, so it is matched by text.
 */
function answersQuestion(ev: CompanyEvent): boolean {
  if (ev.type === "proposal_submitted") return true;
  if (ev.type !== "worklog") return false;
  if (ev.roleId === BOARD_ROLE_ID) return true;
  return /^board (run failed|offline)/i.test(ev.note ?? "");
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type LiveStore = CompanyStore & {
  /** Every event we have seen, in log order. The only durable client state. */
  events: StoredEvent[];
  /** Cursor: the highest `seq` we hold. */
  lastSeq: number;
  /** `seq` of the question whose answer we are waiting for. */
  askedAtSeq?: number;
  /** The company's config has been fetched at least once. */
  loaded: boolean;

  bootstrap(): Promise<void>;
  poll(): Promise<void>;
  clockTick(): void;
};

export function createLiveStore(companyId: string) {
  // Guards against a slow poll overlapping the next interval tick. Kept in the
  // closure rather than in state: it is plumbing, nothing renders it.
  let inFlight = false;

  return create<LiveStore>((set, get) => {
    /** Folds newly arrived events into state and answers the "is it back yet" question. */
    function ingest(incoming: StoredEvent[], lastSeq: number): void {
      const s = get();
      const events = incoming.length ? [...s.events, ...incoming] : s.events;
      const state = incoming.length ? reduce(events) : s.state;
      const answered =
        s.deliberating &&
        s.askedAtSeq !== undefined &&
        incoming.some((ev) => ev.seq > s.askedAtSeq! && answersQuestion(ev));
      set({
        events,
        lastSeq: Math.max(s.lastSeq, lastSeq),
        state,
        awaiting: findAwaiting(state),
        deliberating: answered ? false : s.deliberating,
        connection: "online",
        now: Date.now(),
      });
    }

    /** One place decides what a failure means for the connection dot. */
    function fail(err: unknown): void {
      const offline = err instanceof ApiRequestError && err.offline;
      set({
        connection: offline ? "offline" : get().connection,
        notice: messageOf(err),
      });
    }

    return {
      companyId,
      config: placeholderConfig(companyId),
      state: emptyState(),
      awaiting: undefined,
      now: Date.now(),
      time: REAL_TIME,

      events: [],
      lastSeq: 0,
      askedAtSeq: undefined,
      loaded: false,

      connection: "connecting",
      boardOnline: false,
      deliberating: false,
      notice: undefined,

      /* ------------------------------------------- demo-only, inert here */
      // A real log has no scripted future to scrub through, no playback to
      // pause, and no autopilot to hand decisions to — the CEO is the only one
      // who decides. These exist so one store shape serves both providers;
      scenario: [],
      playing: false,
      speed: 1,
      autopilot: false,
      play: () => {},
      pause: () => {},
      setSpeed: () => {},
      setAutopilot: () => {},
      scrubTo: () => {},
      tick: () => {},
      restart: () => {},

      /* ----------------------------------------------------------- loading */

      bootstrap: async () => {
        try {
          const company = await getCompany(companyId);
          const page = await getEvents(companyId);
          const state = reduce(page.events);
          set({
            config: company.config,
            events: page.events,
            lastSeq: page.lastSeq,
            state,
            awaiting: findAwaiting(state),
            loaded: true,
            connection: "online",
            notice: undefined,
            now: Date.now(),
          });
        } catch (err) {
          fail(err);
          return;
        }
        // Health is advisory: it tells the CEO whether asking anything will
        // produce a deliberation at all. A failure here is not a connection
        // failure — we just got a company out of the same server.
        try {
          const health = await getHealth();
          set({ boardOnline: health.board === "online" });
        } catch {
          /* leave boardOnline as it stands */
        }
      },

      poll: async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          if (!get().loaded) {
            await get().bootstrap();
            return;
          }
          const page = await getEvents(companyId, get().lastSeq);
          ingest(page.events, page.lastSeq);
        } catch (err) {
          fail(err);
        } finally {
          inFlight = false;
        }
      },

      clockTick: () => {
        const s = get();
        const now = Date.now();
        const last = s.state.feed[s.state.feed.length - 1]?.ts ?? 0;
        // Animate while the company is doing something; otherwise idle, so a
        // quiet company is not re-rendering the Floor four times a second.
        if (now - last < REST_MS || now - s.now > IDLE_TICK_MS) set({ now });
      },

      /* ------------------------------------------------------------ writes */

      ask: (text) => {
        const trimmed = text.trim();
        const s = get();
        if (!trimmed || s.deliberating) return;
        set({ deliberating: true, notice: undefined, askedAtSeq: undefined });
        void askQuestion(companyId, trimmed)
          .then((res) => {
            set({ askedAtSeq: res.questionEventSeq });
            return get().poll();
          })
          .catch((err: unknown) => {
            set({ deliberating: false });
            fail(err);
          });
      },

      decide: (proposalId: Id, decision, note) => {
        void postDecision(companyId, proposalId, decision, note)
          .then(() => set({ notice: undefined }))
          .catch((err: unknown) => {
            // 409 means the log already moved on — someone (or an earlier
            // click) decided this. Not a crash and not a retry: refetch below
            // and let the document show what actually happened.
            fail(err);
          })
          .finally(() => {
            void get().poll();
          });
      },

      resolveEscalation: (escalationId: Id, resolution) => {
        void postEscalationResolution(companyId, escalationId, resolution)
          .then(() => set({ notice: undefined }))
          .catch((err: unknown) => fail(err))
          .finally(() => {
            void get().poll();
          });
      },

      dismissNotice: () => set({ notice: undefined }),
    };
  });
}

/** `?company=` wins over `NEXT_PUBLIC_COMPANY_ID`, so one build can show many. */
export function companyIdFromLocation(): string {
  if (typeof window === "undefined") return DEFAULT_COMPANY_ID;
  const q = new URLSearchParams(window.location.search).get("company");
  return q?.trim() || DEFAULT_COMPANY_ID;
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  // Lazy `useState`: the store is the context value, so it is read during
  // render, and this initializer runs exactly once per mount.
  const [store] = useState(() => createLiveStore(companyIdFromLocation()));

  useEffect(() => {
    void store.getState().bootstrap();

    const onVisible = () => {
      if (!document.hidden) void store.getState().poll();
    };
    const poll = setInterval(() => {
      if (document.hidden) return;
      void store.getState().poll();
    }, POLL_MS);
    const clock = setInterval(() => {
      if (document.hidden) return;
      store.getState().clockTick();
    }, CLOCK_MS);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store]);

  return <CompanyStoreContext.Provider value={store}>{children}</CompanyStoreContext.Provider>;
}
