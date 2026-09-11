/**
 * An in-memory EventStore — the test double.
 *
 * It exists so the HTTP layer can be tested without Postgres (`vitest` must
 * never need a running database). It mirrors the real store's *semantics*
 * deliberately: the same normalization, the same append-only discipline, the
 * same monotonic per-company `seq`. It is never wired into `src/index.ts`;
 * mocked and real components stay distinguishable (CLAUDE.md).
 */

import { reduce } from "@csuite/contract";
import type { CompanyState } from "@csuite/contract";
import { normalizeEvent } from "./event-shape";
import {
  CompanyExistsError,
  CompanyNotFoundError,
  type Company,
  type EventStore,
  type NewEvent,
  type StoredEvent,
} from "./types";

export function memoryEventStore(): EventStore {
  const companies = new Map<string, Company>();
  const log = new Map<string, StoredEvent[]>();
  let nextSeq = 1;

  function requireCompany(companyId: string): void {
    if (!companies.has(companyId)) throw new CompanyNotFoundError(companyId);
  }

  const store: EventStore = {
    async createCompany({ id, config }) {
      const companyId = id ?? `company-${crypto.randomUUID().slice(0, 8)}`;
      if (companies.has(companyId)) throw new CompanyExistsError(companyId);
      const company: Company = {
        id: companyId,
        config,
        createdAt: new Date().toISOString(),
      };
      companies.set(companyId, company);
      log.set(companyId, []);
      return company;
    },

    async getCompany(companyId) {
      return companies.get(companyId) ?? null;
    },

    async appendEvents(companyId, incoming: NewEvent[]) {
      requireCompany(companyId);
      const now = Date.now();
      const list = log.get(companyId)!;
      const appended = incoming.map((ev) => {
        const stored: StoredEvent = { ...normalizeEvent(ev, now), seq: nextSeq++ };
        list.push(stored);
        return stored;
      });
      return appended;
    },

    async listEvents(companyId, afterSeq) {
      requireCompany(companyId);
      const list = log.get(companyId)!;
      return afterSeq === undefined ? [...list] : list.filter((e) => e.seq > afterSeq);
    },

    async getState(companyId): Promise<CompanyState> {
      return reduce(await store.listEvents(companyId));
    },
  };

  return store;
}
