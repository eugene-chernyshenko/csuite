/**
 * The Postgres LibraryStore: the log plus its queryable projection.
 *
 * The one rule this file exists to enforce: **the document event and the
 * projection row are written in the same transaction**. The projection is
 * derived data (drop the table, replay the log, get it back) — but while it is
 * there it must never disagree with the log it came from.
 *
 * Search is Postgres FTS over the generated tsvector column
 * (`websearch_to_tsquery`, so an agent can type "annual billing" -churn and
 * mean it), with a substring pass as the safety net for terms the English
 * dictionary stems away.
 */

import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Document, DocumentFrontmatter, Id } from "@csuite/contract";
import type { Database } from "../db/client";
import { documents, events, type DocumentRow } from "../db/schema";
import { normalizeEvent, toRowParts } from "../store/event-shape";
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  frontmatter,
  snippetFor,
} from "./query";
import type { DocumentFilter, DocumentHit, LibraryStore } from "./types";

const FTS_CONFIG = "english";

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    ownerRoleId: row.ownerRoleId,
    tags: row.tags ?? [],
    status: row.status,
    ...(row.supersededBy === null ? {} : { supersededBy: row.supersededBy }),
    body: row.body,
    updatedAt: row.updatedAt,
  };
}

/** WHERE fragments shared by list and search. */
function filterConditions(companyId: string, filter: DocumentFilter): SQL[] {
  const status = filter.status ?? "current";
  const where: SQL[] = [eq(documents.companyId, companyId)];
  if (status !== "any") where.push(eq(documents.status, status));
  if (filter.type) where.push(eq(documents.type, filter.type));
  if (filter.ownerRoleId) where.push(eq(documents.ownerRoleId, filter.ownerRoleId));
  // jsonb containment: `tags @> '["growth"]'` — index-friendly and exact.
  if (filter.tag) where.push(sql`${documents.tags} @> ${JSON.stringify([filter.tag])}::jsonb`);
  return where;
}

export function pgLibraryStore(db: Database): LibraryStore {
  return {
    async writeDocument(companyId, event, document) {
      const row = {
        companyId,
        id: document.id,
        type: document.type,
        title: document.title,
        summary: document.summary,
        ownerRoleId: document.ownerRoleId,
        tags: document.tags,
        status: document.status,
        supersededBy: document.supersededBy ?? null,
        body: document.body,
        updatedAt: document.updatedAt,
      };

      await db.transaction(async (tx) => {
        await tx.insert(events).values({
          companyId,
          ...toRowParts(normalizeEvent(event, document.updatedAt)),
        });
        await tx
          .insert(documents)
          .values(row)
          .onConflictDoUpdate({
            target: [documents.companyId, documents.id],
            set: {
              type: row.type,
              title: row.title,
              summary: row.summary,
              ownerRoleId: row.ownerRoleId,
              tags: row.tags,
              status: row.status,
              supersededBy: row.supersededBy,
              body: row.body,
              updatedAt: row.updatedAt,
            },
          });
      });

      return document;
    },

    async listDocuments(companyId, filter): Promise<DocumentFrontmatter[]> {
      const rows = await db
        .select()
        .from(documents)
        .where(and(...filterConditions(companyId, filter)))
        .orderBy(desc(documents.updatedAt), asc(documents.id))
        .limit(filter.limit ?? DEFAULT_LIST_LIMIT);
      return rows.map((r) => frontmatter(toDocument(r)));
    },

    async getDocument(companyId, id: Id): Promise<Document | null> {
      const [row] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.companyId, companyId), eq(documents.id, id)))
        .limit(1);
      return row ? toDocument(row) : null;
    },

    async searchDocuments(companyId, query, filter): Promise<DocumentHit[]> {
      const limit = filter.limit ?? DEFAULT_SEARCH_LIMIT;
      const conditions = filterConditions(companyId, filter);

      const tsquery = sql`websearch_to_tsquery(${FTS_CONFIG}, ${query})`;
      const ranked = await db
        .select({ row: documents, rank: sql<number>`ts_rank(${documents.search}, ${tsquery})` })
        .from(documents)
        .where(and(...conditions, sql`${documents.search} @@ ${tsquery}`))
        .orderBy(desc(sql`ts_rank(${documents.search}, ${tsquery})`), desc(documents.updatedAt))
        .limit(limit);

      let rows = ranked.map((r) => r.row);

      if (rows.length === 0) {
        // FTS found nothing: retry as a literal substring. Stemming is good at
        // prose and bad at "CAC readout Q3" — this is cheap and only runs when
        // the good path already came back empty.
        const pattern = `%${query.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
        rows = await db
          .select()
          .from(documents)
          .where(
            and(
              ...conditions,
              sql`(${documents.title} ILIKE ${pattern} OR ${documents.summary} ILIKE ${pattern} OR ${documents.body} ILIKE ${pattern})`,
            ),
          )
          .orderBy(desc(documents.updatedAt))
          .limit(limit);
      }

      return rows.map((r) => {
        const doc = toDocument(r);
        return { ...frontmatter(doc), snippet: snippetFor(doc, query) };
      });
    },
  };
}
