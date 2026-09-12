"use client";

/**
 * The company provider: one mode, the real thing.
 *
 * Phase 0's scripted demo is retired (owner's call, 2026-09-12): the app runs
 * exclusively against the platform server, where the board actually
 * deliberates and the CEO's decisions are appends to a durable log.
 */

export { LiveProvider as CompanyProvider } from "./live";
export { useSim } from "./context";
