/**
 * The context-tool seam between the company's memory and the agents that
 * consult it (ARCHITECTURE: "Board context — on demand, not wholesale").
 *
 * A ContextToolDef is one queryable capability (library_search, budget_summary,
 * ...). The registry hands a role its allowed tools and executes calls. Every
 * executed call is recorded by the CALLER as a `context_consulted` event —
 * execution here stays pure lookup.
 */

export interface ContextToolDef {
  name: string;
  /** Shown to the model — say what the tool answers and when to use it. */
  description: string;
  /** JSON Schema for the arguments object (OpenRouter function-calling format). */
  parameters: Record<string, unknown>;
  /**
   * Execute against one company. Returns the string fed back to the model.
   * Throw ContextToolError for user-visible failures (bad args, not found);
   * the caller turns it into an error string for the model, never a crash.
   */
  run(companyId: string, args: unknown): Promise<string>;
}

export class ContextToolError extends Error {}

export interface ContextRegistry {
  /** Tools this role may call. Phase 1: same set for every board role. */
  toolsFor(roleId: string): ContextToolDef[];
  /** Look up + run one call; ContextToolError for unknown tool/bad args. */
  run(companyId: string, roleId: string, name: string, args: unknown): Promise<string>;
}
