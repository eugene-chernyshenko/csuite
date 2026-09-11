/**
 * What a board run cost.
 *
 * Token spend is one opex line, not the CFO's essence (CLAUDE.md) — but it is
 * real money and it is reported honestly: OpenRouter's own number when we have
 * it, list price when we don't.
 */

import type { ChatUsage } from "./openrouter";

/**
 * Fallback list price for the default board model, `openai/gpt-5.6-luna`:
 * $0.20 per 1M input tokens, $1.20 per 1M output tokens. Used only when a
 * response carries no `usage.cost`. It is a *default model* price, so a run on
 * a pricier per-role model that also omits the cost field will be understated —
 * the honest fix is OpenRouter's number, which we ask for on every call.
 */
export const FALLBACK_PRICE_USD_PER_MTOK = { prompt: 0.2, completion: 1.2 } as const;

/** Cost of one call, in USD. */
export function callCostUsd(usage: ChatUsage): number {
  if (usage.costUsd !== undefined) return usage.costUsd;
  return (
    (usage.promptTokens * FALLBACK_PRICE_USD_PER_MTOK.prompt +
      usage.completionTokens * FALLBACK_PRICE_USD_PER_MTOK.completion) /
    1_000_000
  );
}

export function totalCostUsd(usages: readonly ChatUsage[]): number {
  return usages.reduce((sum, u) => sum + callCostUsd(u), 0);
}

/** `$0.0061` — four decimals, because a board run is worth fractions of a cent. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

/** `4 calls, $0.0061` — the tail of every run's closing worklog. */
export function describeSpend(usages: readonly ChatUsage[]): string {
  const calls = usages.length === 1 ? "1 call" : `${usages.length} calls`;
  return `${calls}, ${formatUsd(totalCostUsd(usages))}`;
}
