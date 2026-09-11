import type { EventStore } from "../store/types";
import { ContextToolError, type ContextRegistry, type ContextToolDef } from "./types";

export interface ContextRegistryDeps {
  store: EventStore;
}

/**
 * Stub: an empty registry so the board runner can be wired against the seam
 * before the library lands. Replaced by the real implementation (library,
 * process memory, budget) — see ARCHITECTURE "Context tools".
 */
export function createContextRegistry(_deps: ContextRegistryDeps): ContextRegistry {
  const tools: ContextToolDef[] = [];
  return {
    toolsFor: () => tools,
    run: async (_companyId, _roleId, name) => {
      throw new ContextToolError(`Unknown context tool: ${name}`);
    },
  };
}
