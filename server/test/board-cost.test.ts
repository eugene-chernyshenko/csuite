/**
 * What a run cost. Small arithmetic, but it is the number the CFO's opex line
 * is built from, so it is pinned.
 */

import { describe, expect, it } from "vitest";
import {
  callCostUsd,
  describeSpend,
  FALLBACK_PRICE_USD_PER_MTOK,
  formatUsd,
  totalCostUsd,
} from "../src/board/cost";
import type { ChatUsage } from "../src/board/openrouter";

const usage = (promptTokens: number, completionTokens: number, costUsd?: number): ChatUsage =>
  costUsd === undefined
    ? { promptTokens, completionTokens }
    : { promptTokens, completionTokens, costUsd };

describe("callCostUsd", () => {
  it("prices a call at the default model's list rate when nothing is reported", () => {
    // 1M in at $0.20, 1M out at $1.20.
    expect(callCostUsd(usage(1_000_000, 0))).toBeCloseTo(0.2, 10);
    expect(callCostUsd(usage(0, 1_000_000))).toBeCloseTo(1.2, 10);
    expect(callCostUsd(usage(1200, 800))).toBeCloseTo(0.0012, 10);
  });

  it("prefers OpenRouter's own number over the estimate", () => {
    expect(callCostUsd(usage(1200, 800, 0.0031))).toBe(0.0031);
    // Including a reported zero: some models genuinely are free.
    expect(callCostUsd(usage(1200, 800, 0))).toBe(0);
  });

  it("treats a missing usage block as free rather than exploding", () => {
    expect(callCostUsd(usage(0, 0))).toBe(0);
  });

  it("keeps the fallback prices where a human can check them", () => {
    expect(FALLBACK_PRICE_USD_PER_MTOK).toEqual({ prompt: 0.2, completion: 1.2 });
  });
});

describe("totalCostUsd / formatUsd / describeSpend", () => {
  const run = [usage(1200, 800), usage(1200, 800), usage(1200, 800), usage(2400, 1600)];

  it("adds a run up", () => {
    expect(totalCostUsd(run)).toBeCloseTo(0.006, 10);
    expect(totalCostUsd([])).toBe(0);
  });

  it("mixes reported and estimated calls", () => {
    expect(totalCostUsd([usage(1200, 800), usage(0, 0, 0.005)])).toBeCloseTo(0.0062, 10);
  });

  it("formats to four decimals — a run is worth fractions of a cent", () => {
    expect(formatUsd(0.0061)).toBe("$0.0061");
    expect(formatUsd(0)).toBe("$0.0000");
    expect(formatUsd(1.23456)).toBe("$1.2346");
  });

  it("writes the tail of the run's closing worklog", () => {
    expect(describeSpend(run)).toBe("4 calls, $0.0060");
    expect(describeSpend([usage(1200, 800)])).toBe("1 call, $0.0012");
    expect(describeSpend([])).toBe("0 calls, $0.0000");
  });
});
