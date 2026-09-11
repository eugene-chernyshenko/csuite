/**
 * HTTP-level tests over the in-memory store — no Postgres, no network.
 * `fastify.inject()` exercises the real routes, validation and error handler.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { memoryEventStore } from "../src/store/memory";
import type { EventStore } from "../src/store/types";
import { makeProposal, testConfig } from "./fixtures";

let app: FastifyInstance;
let store: EventStore;

beforeEach(async () => {
  store = memoryEventStore();
  app = await buildApp({ store }); // no OpenRouter key: board is offline
  await app.ready();
});

const json = (res: { payload: string }) => JSON.parse(res.payload);

async function createCompany(id = "acme") {
  return app.inject({ method: "POST", url: "/api/companies", payload: { id, config: testConfig } });
}

describe("POST /api/companies", () => {
  it("creates a company and opens its log", async () => {
    const res = await createCompany();
    expect(res.statusCode).toBe(201);
    expect(json(res).company.id).toBe("acme");

    const events = json(await app.inject({ method: "GET", url: "/api/companies/acme/events" }));
    expect(events.events).toHaveLength(1);
    expect(events.events[0].type).toBe("day_started");
    expect(events.lastSeq).toBe(1);
  });

  it("409s on a duplicate id", async () => {
    await createCompany();
    const res = await createCompany();
    expect(res.statusCode).toBe(409);
    expect(json(res).error.message).toMatch(/already exists/);
  });

  it("400s on a malformed config", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/companies",
      payload: { config: { name: "x" } },
    });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.message).toContain("config.product");
  });
});

describe("GET /api/companies/:id/state", () => {
  it("returns the reduced state alongside the config", async () => {
    await createCompany();
    await store.appendEvents("acme", [
      { type: "proposal_submitted", proposal: makeProposal() },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/companies/acme/state" });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.config.name).toBe("Inkwell");
    expect(body.state.proposals.p1.status).toBe("pending_approval");
  });

  it("404s for an unknown company", async () => {
    const res = await app.inject({ method: "GET", url: "/api/companies/ghost/state" });
    expect(res.statusCode).toBe(404);
    expect(json(res).error.message).toMatch(/not found/);
  });
});

describe("GET /api/companies/:id/events", () => {
  it("honours the ?after cursor", async () => {
    await createCompany();
    await store.appendEvents("acme", [
      { type: "question_asked", text: "a", byRoleId: "ceo" },
      { type: "question_asked", text: "b", byRoleId: "ceo" },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/companies/acme/events?after=1" });
    const body = json(res);
    expect(body.events.map((e: { seq: number }) => e.seq)).toEqual([2, 3]);
    expect(body.lastSeq).toBe(3);
  });

  it("400s on a nonsense cursor", async () => {
    await createCompany();
    const res = await app.inject({ method: "GET", url: "/api/companies/acme/events?after=soon" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/companies/:id/questions", () => {
  it("records the question and reports the board offline without a key", async () => {
    await createCompany();

    const res = await app.inject({
      method: "POST",
      url: "/api/companies/acme/questions",
      payload: { text: "Should we sponsor two author podcasts?" },
    });

    expect(res.statusCode).toBe(202);
    expect(json(res).questionEventSeq).toBe(2);

    // The board runner is fire-and-forget; let its microtasks drain.
    await new Promise((r) => setTimeout(r, 0));

    const events = await store.listEvents("acme");
    const question = events.find((e) => e.type === "question_asked");
    expect(question).toMatchObject({ byRoleId: "ceo", text: "Should we sponsor two author podcasts?" });
    expect(typeof question!.ts).toBe("number");

    const offline = events.find((e) => e.type === "worklog");
    expect(offline).toBeDefined();
    expect((offline as { note?: string }).note).toMatch(/offline/i);
  });

  it("400s on an empty question", async () => {
    await createCompany();
    const res = await app.inject({
      method: "POST",
      url: "/api/companies/acme/questions",
      payload: { text: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/companies/:id/proposals/:proposalId/decision", () => {
  const decide = async (payload: Record<string, unknown>, proposalId = "p1") =>
    await app.inject({
      method: "POST",
      url: `/api/companies/acme/proposals/${proposalId}/decision`,
      payload,
    });

  beforeEach(async () => {
    await createCompany();
    await store.appendEvents("acme", [
      { type: "proposal_submitted", proposal: makeProposal() },
    ]);
  });

  it("records a decision on a pending proposal", async () => {
    const res = await decide({ decision: "approved", note: "Ship the test" });
    expect(res.statusCode).toBe(201);
    expect(json(res).proposal.status).toBe("in_progress");
    expect(json(res).proposal.ceoNote).toBe("Ship the test");

    const state = await store.getState("acme");
    expect(state.decisions.p1).toBe("approved");
  });

  it("409s on a proposal that is no longer pending", async () => {
    expect((await decide({ decision: "approved" })).statusCode).toBe(201);

    const res = await decide({ decision: "rejected" });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.message).toMatch(/not "pending_approval"/);

    // The rejected write left no trace in the log.
    const state = await store.getState("acme");
    expect(state.proposals.p1?.status).toBe("in_progress");
    expect((await store.listEvents("acme")).filter((e) => e.type === "ceo_decision")).toHaveLength(1);
  });

  it("404s on an unknown proposal", async () => {
    expect((await decide({ decision: "approved" }, "ghost")).statusCode).toBe(404);
  });

  it("400s on a decision verb outside the contract", async () => {
    const res = await decide({ decision: "maybe" });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.message).toContain("decision");
  });
});

describe("POST /api/companies/:id/escalations/:escalationId/resolve", () => {
  beforeEach(async () => {
    await createCompany();
    await store.appendEvents("acme", [
      {
        type: "escalation_raised",
        escalation: {
          id: "e1",
          fromRoleId: "cto",
          severity: "urgent",
          reason: "Vendor pulled out",
          ask: "Approve a replacement",
          status: "open",
        },
      },
    ]);
  });

  const resolve = async (payload: Record<string, unknown>, id = "e1") =>
    await app.inject({
      method: "POST",
      url: `/api/companies/acme/escalations/${id}/resolve`,
      payload,
    });

  it("resolves an open escalation", async () => {
    const res = await resolve({ resolution: "Use the backup vendor" });
    expect(res.statusCode).toBe(201);
    expect(json(res).escalation).toMatchObject({
      status: "resolved",
      resolution: "Use the backup vendor",
    });
  });

  it("409s on an already-resolved escalation", async () => {
    await resolve({ resolution: "done" });
    expect((await resolve({ resolution: "again" })).statusCode).toBe(409);
  });

  it("400s without a resolution", async () => {
    expect((await resolve({})).statusCode).toBe(400);
  });
});

describe("errors", () => {
  it("shapes unknown routes as { error: { message } } too", async () => {
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(json(res).error.message).toMatch(/No route/);
  });
});
