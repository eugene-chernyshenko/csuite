/**
 * The company library — layer 2 of the three layers of documents
 * (docs/en/ARCHITECTURE.md): markdown with typed frontmatter, versioned
 * through the event log.
 *
 * Two seams live here:
 *
 * - `LibraryStore` — where documents are *stored and queried*. Two
 *   implementations: `pgLibraryStore` writes the event and the projection row
 *   in one transaction and searches with Postgres FTS; `eventSourcedLibraryStore`
 *   appends the event and reads documents back out of the reducer, which is
 *   what the tests (and any store without a projection) use.
 * - `LibraryService` — the *rules*: id minting, governance, not-found and
 *   conflict handling. Everything above (REST, context tools, the seeder)
 *   talks to this and never to a store directly.
 */

import type {
  Document,
  DocumentFrontmatter,
  DocumentStatus,
  DocumentType,
  Id,
} from "@csuite/contract";
import { ContextToolError } from "../context/types";
import type { NewEvent } from "../store/types";

/** Filters for a library listing. Omitted fields mean "no constraint". */
export interface DocumentFilter {
  type?: DocumentType;
  ownerRoleId?: Id;
  tag?: string;
  /** Defaults to "current"; pass "any" to include superseded documents. */
  status?: DocumentStatus | "any";
  limit?: number;
}

/** A search result: frontmatter plus the passage that matched. */
export interface DocumentHit extends DocumentFrontmatter {
  snippet: string;
}

export interface LibraryStore {
  /**
   * Appends `event` and writes `document` into the queryable projection **in
   * one transaction**. Either both land or neither does: a projection row
   * without its event would be a second source of truth, and an event without
   * its row would be invisible to search until the next replay.
   */
  writeDocument(companyId: string, event: NewEvent, document: Document): Promise<Document>;
  listDocuments(companyId: string, filter: DocumentFilter): Promise<DocumentFrontmatter[]>;
  getDocument(companyId: string, id: Id): Promise<Document | null>;
  searchDocuments(
    companyId: string,
    query: string,
    filter: DocumentFilter,
  ): Promise<DocumentHit[]>;
}

/**
 * A library failure a caller can act on: it carries an HTTP status for the
 * REST layer and is a `ContextToolError`, so a tool call that trips it comes
 * back to the model as an error string instead of crashing the run.
 */
export class LibraryError extends ContextToolError {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "LibraryError";
    this.status = status;
  }
}

export class DocumentNotFoundError extends LibraryError {
  constructor(id: Id) {
    super(404, `Document "${id}" not found`);
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentExistsError extends LibraryError {
  constructor(id: Id) {
    super(409, `Document "${id}" already exists`);
    this.name = "DocumentExistsError";
  }
}

/**
 * Governance refusal: `policy` and `profile` are the company's standing rules
 * and its account of itself, and they change only through the decision process
 * (ARCHITECTURE, "Three layers of documents").
 */
export class GovernanceError extends LibraryError {
  constructor(message: string) {
    super(403, message);
    this.name = "GovernanceError";
  }
}
