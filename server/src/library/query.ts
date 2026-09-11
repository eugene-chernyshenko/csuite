/**
 * Pure helpers shared by both library stores: filtering, frontmatter
 * projection, and the snippet a search result carries.
 *
 * Keeping these here is what makes the Postgres path and the event-sourced
 * path answer the *same* question in the same shape — only the matching
 * engine differs (FTS vs. substring).
 */

import type { Document, DocumentFrontmatter } from "@csuite/contract";
import type { DocumentFilter } from "./types";

export const DEFAULT_LIST_LIMIT = 50;
export const DEFAULT_SEARCH_LIMIT = 10;

/** Drops the body: list and search results carry frontmatter only. */
export function frontmatter(doc: Document): DocumentFrontmatter {
  const { body: _body, ...rest } = doc;
  return rest;
}

/**
 * Newest first — a library is read from its latest write backwards. Ties break
 * on id so two documents written in the same millisecond still come back in a
 * stable order, matching the Postgres store's `ORDER BY updated_at DESC, id`.
 */
export function byUpdatedAtDesc(
  a: { updatedAt: number; id: string },
  b: { updatedAt: number; id: string },
): number {
  return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}

export function matchesFilter(doc: Document, filter: DocumentFilter): boolean {
  const status = filter.status ?? "current";
  if (status !== "any" && doc.status !== status) return false;
  if (filter.type && doc.type !== filter.type) return false;
  if (filter.ownerRoleId && doc.ownerRoleId !== filter.ownerRoleId) return false;
  if (filter.tag && !doc.tags.includes(filter.tag)) return false;
  return true;
}

/**
 * The in-memory search engine: case-insensitive substring over the fields the
 * Postgres tsvector covers. Deliberately dumber than FTS (no stemming, no
 * ranking beyond field weight) — it exists so the suite runs without a
 * database, and so a store without a projection still answers.
 */
export function ilikeMatch(doc: Document, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const haystack = `${doc.title}\n${doc.summary}\n${doc.body}`.toLowerCase();
  // Every word must appear somewhere — the same "AND of terms" websearch uses.
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

const SNIPPET_RADIUS = 120;

/**
 * A short passage around the first match, for a model to judge relevance by
 * without reading the whole document. Falls back to the summary.
 */
export function snippetFor(doc: Document, query: string): string {
  const term = query.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const at = term ? doc.body.toLowerCase().indexOf(term) : -1;
  if (at < 0) return doc.summary;
  const from = Math.max(0, at - SNIPPET_RADIUS);
  const to = Math.min(doc.body.length, at + term.length + SNIPPET_RADIUS);
  const text = doc.body.slice(from, to).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${text}${to < doc.body.length ? "…" : ""}`;
}
