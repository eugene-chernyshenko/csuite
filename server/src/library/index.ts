/**
 * The company library: `createLibraryService` over one of the two stores.
 *
 *   pgLibraryStore(db)            — production: event + projection in one tx,
 *                                   Postgres full-text search.
 *   eventSourcedLibraryStore(store) — tests and any storeless wiring: the log
 *                                   folded through the reducer.
 */

export * from "./types";
export * from "./service";
export { eventSourcedLibraryStore } from "./store-events";
export { pgLibraryStore } from "./store-pg";
export { DEFAULT_LIST_LIMIT, DEFAULT_SEARCH_LIMIT } from "./query";
