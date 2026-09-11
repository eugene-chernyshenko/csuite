/**
 * The real event store: Postgres via drizzle.
 *
 * Every statement here is an INSERT or a SELECT. If you ever find yourself
 * wanting an UPDATE or a DELETE on `events`, the answer is a new event.
 */

import { and, asc, eq, gt } from "drizzle-orm";
import { reduce } from "@csuite/contract";
import type { CompanyState } from "@csuite/contract";
import type { Database } from "../db/client";
import { companies, events } from "../db/schema";
import { fromRowParts, normalizeEvent, toRowParts } from "./event-shape";
import {
  CompanyExistsError,
  CompanyNotFoundError,
  type Company,
  type EventStore,
  type NewEvent,
  type StoredEvent,
} from "./types";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "company";
}

export function pgEventStore(db: Database): EventStore {
  async function requireCompany(companyId: string): Promise<Company> {
    const company = await store.getCompany(companyId);
    if (!company) throw new CompanyNotFoundError(companyId);
    return company;
  }

  const store: EventStore = {
    async createCompany({ id, config }): Promise<Company> {
      const companyId = id ?? `${slugify(config.name)}-${crypto.randomUUID().slice(0, 8)}`;
      const existing = await store.getCompany(companyId);
      if (existing) throw new CompanyExistsError(companyId);

      const [row] = await db
        .insert(companies)
        .values({ id: companyId, config })
        .returning();
      if (!row) throw new Error("Failed to create company");
      return { id: row.id, config: row.config, createdAt: row.createdAt.toISOString() };
    },

    async getCompany(companyId): Promise<Company | null> {
      const [row] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);
      if (!row) return null;
      return { id: row.id, config: row.config, createdAt: row.createdAt.toISOString() };
    },

    async appendEvents(companyId, incoming: NewEvent[]): Promise<StoredEvent[]> {
      await requireCompany(companyId);
      if (incoming.length === 0) return [];

      const now = Date.now();
      const values = incoming.map((ev) => ({
        companyId,
        ...toRowParts(normalizeEvent(ev, now)),
      }));

      // One multi-row INSERT: Postgres draws `seq` from the sequence in row
      // order, so append order is the order the caller handed us.
      const rows = await db.insert(events).values(values).returning();
      return rows
        .sort((a, b) => a.seq - b.seq)
        .map((r) => fromRowParts({ seq: r.seq, id: r.id, ts: r.ts, type: r.type, payload: r.payload }));
    },

    async listEvents(companyId, afterSeq): Promise<StoredEvent[]> {
      await requireCompany(companyId);
      const where =
        afterSeq === undefined
          ? eq(events.companyId, companyId)
          : and(eq(events.companyId, companyId), gt(events.seq, afterSeq));
      const rows = await db.select().from(events).where(where).orderBy(asc(events.seq));
      return rows.map((r) =>
        fromRowParts({ seq: r.seq, id: r.id, ts: r.ts, type: r.type, payload: r.payload }),
      );
    },

    async getState(companyId): Promise<CompanyState> {
      const log = await store.listEvents(companyId);
      return reduce(log);
    },
  };

  return store;
}
