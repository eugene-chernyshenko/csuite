/**
 * The event-store interface the API is written against.
 *
 * Two implementations exist: `pgEventStore` (real, Postgres) and
 * `memoryEventStore` (a fake for tests). Keeping the API dependent on the
 * interface rather than on drizzle is what lets the HTTP-level tests run
 * without a database — see the note in store/memory.ts.
 */

import type { CompanyConfig, CompanyEvent, CompanyState, Id } from "@csuite/contract";

/** A contract event as it exists in the log: the event plus its append order. */
export type StoredEvent = CompanyEvent & { seq: number };

/**
 * `Omit` over a union collapses it to the members' shared keys, which would
 * throw away every event body. The conditional makes it distribute instead, so
 * each variant keeps its own fields.
 */
export type DraftEvent<T = CompanyEvent> = T extends CompanyEvent
  ? Omit<T, "id" | "ts"> & { id?: Id; ts?: number }
  : never;

export interface Company {
  id: string;
  config: CompanyConfig;
  createdAt: string;
}

/** An event on its way in: `id` and `ts` are filled in by the store if absent. */
export type NewEvent = DraftEvent;

export interface EventStore {
  createCompany(input: { id?: string; config: CompanyConfig }): Promise<Company>;
  getCompany(companyId: string): Promise<Company | null>;

  /**
   * Appends events in the given order, assigning each the next `seq`.
   * Append-only: this is the single write path into the log.
   */
  appendEvents(companyId: string, events: NewEvent[]): Promise<StoredEvent[]>;

  /** Events with `seq > afterSeq`, oldest first. */
  listEvents(companyId: string, afterSeq?: number): Promise<StoredEvent[]>;

  /** The full log folded through the contract reducer. */
  getState(companyId: string): Promise<CompanyState>;
}

export class CompanyNotFoundError extends Error {
  constructor(companyId: string) {
    super(`Company "${companyId}" not found`);
    this.name = "CompanyNotFoundError";
  }
}

export class CompanyExistsError extends Error {
  constructor(companyId: string) {
    super(`Company "${companyId}" already exists`);
    this.name = "CompanyExistsError";
  }
}
