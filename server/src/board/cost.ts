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

/**
 * What the board's tool use added to a run. Reported only when it happened —
 * a run with no context registry reads exactly as it always did.
 */
export interface ToolSpend {
  /** Positions whose calls carried context-tool definitions. */
  positionsWithTools: number;
  /** Tool calls actually executed across the whole run. */
  consultations: number;
}

/**
 * `4 calls, $0.0061` — the tail of every run's closing worklog; with tool use,
 * `9 calls (4 with tools, 5 tool consultations), $0.0112`. Note that "calls"
 * counts HTTP calls to the model: a position that consulted twice made more
 * than one.
 */
export function describeSpend(usages: readonly ChatUsage[], tools?: ToolSpend): string {
  const calls = usages.length === 1 ? "1 call" : `${usages.length} calls`;
  const detail =
    tools && (tools.positionsWithTools > 0 || tools.consultations > 0)
      ? ` (${tools.positionsWithTools} with tools, ${tools.consultations} tool ` +
        `consultation${tools.consultations === 1 ? "" : "s"})`
      : "";
  return `${calls}${detail}, ${formatUsd(totalCostUsd(usages))}`;
}
