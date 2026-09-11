/**
 * The library service: the rules around library writes and reads.
 *
 * Every write is an event first (`document_created/updated/superseded`) and a
 * row second — see `LibraryStore.writeDocument`. Nothing here edits a document
 * in place: an update appends a whole new version, and superseding retires the
 * old one without deleting it, because the reasoning behind a past decision has
 * to stay readable after the decision stops being true.
 *
 * Governance (ARCHITECTURE, "Three layers of documents"): `policy` and
 * `profile` are the company's standing rules and its account of itself, and
 * they change **only through the decision process** — proposal, CEO signature.
 * The decision gate itself is not wired yet, so the rule is carried by an
 * explicit `viaDecision: true` flag: it documents the constraint in the type
 * system today and blocks a role from quietly rewriting a policy meanwhile.
 * When the gate lands, the flag stops being caller-supplied and starts being
 * derived from an approved proposal id.
 */

import type {
  Document,
  DocumentFrontmatter,
  DocumentType,
  Id,
} from "@csuite/contract";
import type { NewEvent } from "../store/types";
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_SEARCH_LIMIT,
} from "./query";
import {
  DocumentExistsError,
  DocumentNotFoundError,
  GovernanceError,
  type DocumentFilter,
  type DocumentHit,
  type LibraryStore,
} from "./types";

/** Types that only the decision process may create or change. */
export const GOVERNED_TYPES: readonly DocumentType[] = ["policy", "profile"];

export function isGoverned(type: DocumentType): boolean {
  return GOVERNED_TYPES.includes(type);
}

export interface CreateDocumentInput {
  /** Optional stable id — the seeder uses it to stay idempotent. */
  id?: Id;
  type: DocumentType;
  title: string;
  summary: string;
  ownerRoleId: Id;
  tags?: string[];
  body: string;
  /** Required for `policy`/`profile`: this write comes from an approved decision. */
  viaDecision?: boolean;
  /** Company-timeline ms; defaults to now. */
  ts?: number;
}

export interface UpdateDocumentInput {
  title?: string;
  summary?: string;
  ownerRoleId?: Id;
  tags?: string[];
  body?: string;
  viaDecision?: boolean;
  ts?: number;
}

export interface SupersedeOptions {
  /** The document that replaces this one, if any. */
  by?: Id;
  viaDecision?: boolean;
  ts?: number;
}

export interface LibraryService {
  create(companyId: string, input: CreateDocumentInput): Promise<Document>;
  update(companyId: string, id: Id, input: UpdateDocumentInput): Promise<Document>;
  supersede(companyId: string, id: Id, opts?: SupersedeOptions): Promise<Document>;
  list(companyId: string, filter?: DocumentFilter): Promise<DocumentFrontmatter[]>;
  read(companyId: string, id: Id): Promise<Document>;
  search(companyId: string, query: string, filter?: DocumentFilter): Promise<DocumentHit[]>;
}

export interface LibraryServiceDeps {
  library: LibraryStore;
}

function requireDecision(type: DocumentType, viaDecision: boolean | undefined, verb: string): void {
  if (!isGoverned(type) || viaDecision === true) return;
  throw new GovernanceError(
    `A "${type}" document changes only through the decision process: ${verb} it requires an ` +
      `approved decision (viaDecision: true). Raise a proposal instead, or write this as a "note".`,
  );
}

function mintId(title: string): Id {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `doc-${slug || "untitled"}-${crypto.randomUUID().slice(0, 6)}`;
}

export function createLibraryService(deps: LibraryServiceDeps): LibraryService {
  const { library } = deps;

  async function requireDoc(companyId: string, id: Id): Promise<Document> {
    const doc = await library.getDocument(companyId, id);
    if (!doc) throw new DocumentNotFoundError(id);
    return doc;
  }

  return {
    async create(companyId, input) {
      requireDecision(input.type, input.viaDecision, "creating");

      const id = input.id ?? mintId(input.title);
      if (await library.getDocument(companyId, id)) throw new DocumentExistsError(id);

      const document: Document = {
        id,
        type: input.type,
        title: input.title,
        summary: input.summary,
        ownerRoleId: input.ownerRoleId,
        tags: input.tags ?? [],
        status: "current",
        body: input.body,
        updatedAt: input.ts ?? Date.now(),
      };
      const event: NewEvent = {
        type: "document_created",
        ts: document.updatedAt,
        document,
      };
      return library.writeDocument(companyId, event, document);
    },

    async update(companyId, id, input) {
      const previous = await requireDoc(companyId, id);
      // The *existing* type decides: a document's type never changes on update,
      // so a policy stays governed no matter what the caller passes.
      requireDecision(previous.type, input.viaDecision, "updating");

      const document: Document = {
        ...previous,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.summary === undefined ? {} : { summary: input.summary }),
        ...(input.ownerRoleId === undefined ? {} : { ownerRoleId: input.ownerRoleId }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
        ...(input.body === undefined ? {} : { body: input.body }),
        updatedAt: input.ts ?? Date.now(),
      };
      const event: NewEvent = {
        type: "document_updated",
        ts: document.updatedAt,
        document,
      };
      return library.writeDocument(companyId, event, document);
    },

    async supersede(companyId, id, opts = {}) {
      const previous = await requireDoc(companyId, id);
      // Retiring a standing rule is as much a change to it as rewriting it.
      requireDecision(previous.type, opts.viaDecision, "superseding");
      if (opts.by) await requireDoc(companyId, opts.by);

      const document: Document = {
        ...previous,
        status: "superseded",
        ...(opts.by === undefined ? {} : { supersededBy: opts.by }),
        updatedAt: opts.ts ?? Date.now(),
      };
      const event: NewEvent = {
        type: "document_superseded",
        ts: document.updatedAt,
        documentId: id,
        ...(opts.by === undefined ? {} : { by: opts.by }),
      };
      return library.writeDocument(companyId, event, document);
    },

    async list(companyId, filter = {}) {
      return library.listDocuments(companyId, {
        ...filter,
        limit: Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, 200),
      });
    },

    read(companyId, id) {
      return requireDoc(companyId, id);
    },

    async search(companyId, query, filter = {}) {
      if (!query.trim()) return [];
      return library.searchDocuments(companyId, query, {
        ...filter,
        limit: Math.min(filter.limit ?? DEFAULT_SEARCH_LIMIT, 50),
      });
    },
  };
}
