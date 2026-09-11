/**
 * HTTP-level tests for the library API, over the in-memory store — no Postgres,
 * no network. `fastify.inject()` exercises the real routes, the zod validation
 * and the shared error handler.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { memoryEventStore } from "../src/store/memory";
import type { EventStore } from "../src/store/types";
import { testConfig } from "./fixtures";

let app: FastifyInstance;
let store: EventStore;

beforeEach(async () => {
  store = memoryEventStore();
  app = await buildApp({ store }); // no library injected: falls back to the log
  await app.ready();
  await store.createCompany({ id: "acme", config: testConfig });
});

const json = (res: { payload: string }) => JSON.parse(res.payload);

async function post(url: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url, payload });
}

const noteBody = {
  id: "note-1",
  type: "note",
  title: "Support load and churn",
  summary: "Six to eight tickets a day, mostly failed cards.",
  ownerRoleId: "coo",
  tags: ["operations", "churn"],
  body: "Failed cards become quiet cancellations if nobody chases them.",
};

describe("POST /api/companies/:id/library", () => {
  it("creates a document and records it in the log", async () => {
    const res = await post("/api/companies/acme/library", noteBody);

    expect(res.statusCode).toBe(201);
    expect(json(res).document).toMatchObject({ id: "note-1", status: "current", type: "note" });

    const events = await store.listEvents("acme");
    expect(events.map((e) => e.type)).toEqual(["document_created"]);
  });

  it("403s on a policy without an explicit decision, and creates it with one", async () => {
    const governed = { ...noteBody, id: "pol-1", type: "policy", ownerRoleId: "ceo" };

    const refused = await post("/api/companies/acme/library", governed);
    expect(refused.statusCode).toBe(403);
    expect(json(refused).error.message).toMatch(/decision process/);
    expect(await store.listEvents("acme")).toHaveLength(0);

    const allowed = await post("/api/companies/acme/library", { ...governed, viaDecision: true });
    expect(allowed.statusCode).toBe(201);
  });

  it("400s on a malformed body and 409s on a duplicate id", async () => {
    const bad = await post("/api/companies/acme/library", { ...noteBody, type: "recipe" });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error.message).toContain("type");

    await post("/api/companies/acme/library", noteBody);
    const clash = await post("/api/companies/acme/library", noteBody);
    expect(clash.statusCode).toBe(409);
  });

  it("404s for an unknown company", async () => {
    const res = await post("/api/companies/ghost/library", noteBody);
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/companies/:id/library", () => {
  beforeEach(async () => {
    await post("/api/companies/acme/library", noteBody);
    await post("/api/companies/acme/library", {
      ...noteBody,
      id: "fin-1",
      type: "finance",
      title: "Monthly finance summary",
      summary: "Budget, MRR, churn, CAC.",
      ownerRoleId: "cfo",
      tags: ["finance"],
      body: "Blended paid CAC is $54.",
    });
  });

  it("lists frontmatter only, and filters by type, owner and tag", async () => {
    const all = json(await app.inject({ url: "/api/companies/acme/library" }));
    expect(all.documents.map((d: { id: string }) => d.id).sort()).toEqual(["fin-1", "note-1"]);
    expect(all.documents[0]).not.toHaveProperty("body");

    const typed = json(await app.inject({ url: "/api/companies/acme/library?type=finance" }));
    expect(typed.documents.map((d: { id: string }) => d.id)).toEqual(["fin-1"]);

    const owned = json(await app.inject({ url: "/api/companies/acme/library?owner=coo" }));
    expect(owned.documents.map((d: { id: string }) => d.id)).toEqual(["note-1"]);

    const tagged = json(await app.inject({ url: "/api/companies/acme/library?tag=finance" }));
    expect(tagged.documents.map((d: { id: string }) => d.id)).toEqual(["fin-1"]);
  });

  it("searches when ?q= is given, returning snippets", async () => {
    const res = json(await app.inject({ url: "/api/companies/acme/library?q=CAC" }));

    expect(res.query).toBe("CAC");
    expect(res.documents).toHaveLength(1);
    expect(res.documents[0].id).toBe("fin-1");
    expect(res.documents[0].snippet).toContain("CAC");
  });

  it("400s on a nonsense query param", async () => {
    const res = await app.inject({ url: "/api/companies/acme/library?type=recipe" });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/companies/:id/library/:docId", () => {
  it("returns the document with its body", async () => {
    await post("/api/companies/acme/library", noteBody);
    const res = await app.inject({ url: "/api/companies/acme/library/note-1" });

    expect(res.statusCode).toBe(200);
    expect(json(res).document.body).toContain("quiet cancellations");
  });

  it("404s on an unknown document", async () => {
    const res = await app.inject({ url: "/api/companies/acme/library/ghost" });
    expect(res.statusCode).toBe(404);
    expect(json(res).error.message).toMatch(/not found/);
  });
});

describe("POST /api/companies/:id/library/:docId/supersede", () => {
  it("retires a document, points at its replacement, and drops it from the default listing", async () => {
    await post("/api/companies/acme/library", noteBody);
    await post("/api/companies/acme/library", { ...noteBody, id: "note-2" });

    const res = await post("/api/companies/acme/library/note-1/supersede", { by: "note-2" });
    expect(res.statusCode).toBe(201);
    expect(json(res).document).toMatchObject({ status: "superseded", supersededBy: "note-2" });

    const current = json(await app.inject({ url: "/api/companies/acme/library" }));
    expect(current.documents.map((d: { id: string }) => d.id)).toEqual(["note-2"]);

    const any = json(await app.inject({ url: "/api/companies/acme/library?status=any" }));
    expect(any.documents).toHaveLength(2);

    const events = await store.listEvents("acme");
    expect(events.map((e) => e.type)).toEqual([
      "document_created",
      "document_created",
      "document_superseded",
    ]);
  });

  it("404s when the replacement does not exist", async () => {
    await post("/api/companies/acme/library", noteBody);
    const res = await post("/api/companies/acme/library/note-1/supersede", { by: "ghost" });
    expect(res.statusCode).toBe(404);
  });

  it("403s on superseding a policy without a decision", async () => {
    await post("/api/companies/acme/library", {
      ...noteBody,
      id: "pol-1",
      type: "policy",
      ownerRoleId: "ceo",
      viaDecision: true,
    });

    const res = await post("/api/companies/acme/library/pol-1/supersede", {});
    expect(res.statusCode).toBe(403);
  });
});
