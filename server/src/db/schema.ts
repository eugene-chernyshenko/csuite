/**
 * Platform tables.
 *
 * Two rules the rest of the code depends on:
 *
 * 1. `company_id` is on every row (docs/en/ARCHITECTURE.md: the SaaS path must
 *    never be painted out, even while we are single-tenant).
 * 2. `events` is **append-only**. There is no UPDATE or DELETE against it
 *    anywhere in this codebase, and there must never be: the log is the source
 *    of truth and everything else is a fold over it.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type {
  CompanyConfig,
  CompanyEvent,
  DocumentStatus,
  DocumentType,
} from "@csuite/contract";

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  /** CompanyConfig from @csuite/contract — roles, departments, budget. */
  config: jsonb("config").$type<CompanyConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const events = pgTable(
  "events",
  {
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    /**
     * Append order. Global bigserial, but only ever read per company — so it is
     * monotonic within a company, which is all `?after=` polling needs.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    /** Contract event id (client- or server-minted), unique per company. */
    id: text("id").notNull(),
    /**
     * Contract `ts`: time in the company's timeline. On the server that is
     * epoch milliseconds; the demo simulation uses sim-minutes. See the doc on
     * `EventBase.ts` in @csuite/contract.
     */
    ts: bigint("ts", { mode: "number" }).notNull(),
    type: text("type").$type<CompanyEvent["type"]>().notNull(),
    /** The whole contract event minus id/ts/type, verbatim. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.seq] }),
    index("events_company_seq_idx").on(t.companyId, t.seq),
  ],
);

/**
 * Postgres `tsvector`. drizzle has no built-in for it, and the column is
 * never read in TypeScript — it exists to be matched against and indexed.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/**
 * The company library as a **queryable projection** of the log.
 *
 * Not a second source of truth: every row here is derived from a
 * `document_created/updated/superseded` event and is written in the *same
 * transaction* as that event (see src/library/store-pg.ts). Drop this table and
 * a replay rebuilds it; drop the events and nothing does. It exists because
 * "find me the policy that mentions third-party ads" is a full-text query, and
 * folding the whole log to answer it does not scale.
 */
export const documents = pgTable(
  "documents",
  {
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    /** Contract Document id, unique per company. */
    id: text("id").notNull(),
    type: text("type").$type<DocumentType>().notNull(),
    title: text("title").notNull(),
    /** One line — what list views and context-tool results show. */
    summary: text("summary").notNull(),
    ownerRoleId: text("owner_role_id").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status").$type<DocumentStatus>().notNull(),
    supersededBy: text("superseded_by"),
    /** Markdown. */
    body: text("body").notNull(),
    /** Contract `updatedAt`: company-timeline ms, same clock as `events.ts`. */
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    /**
     * Generated FTS column over title + summary + body. Generated rather than
     * trigger-maintained so it can never drift from the row, and with an
     * explicit `'english'` regconfig because `to_tsvector` is only IMMUTABLE
     * — and therefore only usable in a generated column — in that form.
     */
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce("title", '') || ' ' || coalesce("summary", '') || ' ' || coalesce("body", ''))`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    index("documents_company_type_idx").on(t.companyId, t.type),
    index("documents_company_status_idx").on(t.companyId, t.status),
    index("documents_search_idx").using("gin", t.search),
  ],
);

export type CompanyRow = typeof companies.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
