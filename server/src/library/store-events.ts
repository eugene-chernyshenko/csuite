/**
 * The event-sourced LibraryStore: writes go into the log, reads come back out
 * of the contract reducer (`state.documents`).
 *
 * It is the honest fallback, not a fake: the log *is* the source of truth, so
 * this implementation is always correct — it is only ever the slow one, since
 * every read folds the whole log and every search is a substring scan. The
 * Postgres store exists to make those two operations cheap, not to make them
 * different.
 *
 * Used by the test suite (no database) and by any wiring that has an EventStore
 * but no projection.
 */

import type { Document, DocumentFrontmatter, Id } from "@csuite/contract";
import type { EventStore } from "../store/types";
import {
  byUpdatedAtDesc,
  DEFAULT_LIST_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  frontmatter,
  ilikeMatch,
  matchesFilter,
  snippetFor,
} from "./query";
import type { DocumentFilter, DocumentHit, LibraryStore } from "./types";

export function eventSourcedLibraryStore(store: EventStore): LibraryStore {
  async function documentsOf(companyId: string): Promise<Document[]> {
    const state = await store.getState(companyId);
    return Object.values(state.documents);
  }

  return {
    async writeDocument(companyId, event, document) {
      // No projection to keep in step: the event is the whole write.
      await store.appendEvents(companyId, [event]);
      return document;
    },

    async listDocuments(companyId, filter): Promise<DocumentFrontmatter[]> {
      const docs = (await documentsOf(companyId)).filter((d) => matchesFilter(d, filter));
      return docs
        .map(frontmatter)
        .sort(byUpdatedAtDesc)
        .slice(0, filter.limit ?? DEFAULT_LIST_LIMIT);
    },

    async getDocument(companyId, id: Id) {
      const state = await store.getState(companyId);
      return state.documents[id] ?? null;
    },

    async searchDocuments(companyId, query, filter): Promise<DocumentHit[]> {
      const docs = (await documentsOf(companyId))
        .filter((d) => matchesFilter(d, filter))
        .filter((d) => ilikeMatch(d, query));
      return docs
        .sort(byUpdatedAtDesc)
        .slice(0, filter.limit ?? DEFAULT_SEARCH_LIMIT)
        .map((d) => ({ ...frontmatter(d), snippet: snippetFor(d, query) }));
    },
  };
}
