/**
 * @csuite/contract — the frozen v0 platform contract.
 *
 * Distributed as TypeScript **source**, on purpose: there is exactly one
 * definition of every shape, and both consumers compile it themselves
 * (`transpilePackages` in Next, `tsx`/`vitest` on the server). Nothing here may
 * import from a consumer, touch `process`, or reach for I/O — it is pure data
 * plus a pure reducer.
 */

export * from "./types";
export * from "./events";
export * from "./reduce";
