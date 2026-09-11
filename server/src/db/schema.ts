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
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { CompanyConfig, CompanyEvent } from "@csuite/contract";

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

export type CompanyRow = typeof companies.$inferSelect;
export type EventRow = typeof events.$inferSelect;
