/**
 * The company library: the reducer's document folding, the governance rule,
 * and the service's read paths.
 *
 * Everything runs against the in-memory store through the event-sourced
 * library, so the log — not a projection — is what is being asserted about.
 * The Postgres store is the same contract with a faster index behind it; its
 * FTS path is covered by the ILIKE-equivalent substring search here.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { reduce, type Document } from "@csuite/contract";
import {
  createLibraryService,
  eventSourcedLibraryStore,
  GovernanceError,
  type LibraryService,
} from "../src/library";
import { memoryEventStore } from "../src/store/memory";
import type { EventStore } from "../src/store/types";
import { ev, makeDocument, testConfig } from "./fixtures";

const COMPANY = "acme";

let store: EventStore;
let library: LibraryService;

beforeEach(async () => {
  store = memoryEventStore();
  await store.createCompany({ id: COMPANY, config: testConfig });
  library = createLibraryService({ library: eventSourcedLibraryStore(store) });
});

describe("document events reduce", () => {
  it("upserts on created and updated, keeping the latest version", () => {
    const v1 = makeDocument({ title: "Pricing policy", body: "Monthly only." });
    const v2: Document = { ...v1, title: "Pricing policy (v2)", body: "Monthly and annual.", updatedAt: 20 };

    const state = reduce([
      ev({ type: "document_created", document: v1 }),
      ev({ type: "document_updated", document: v2, previousVersion: "ev-1" }),
    ]);

    expect(Object.keys(state.documents)).toEqual(["d1"]);
    expect(state.documents.d1?.title).toBe("Pricing policy (v2)");
    expect(state.documents.d1?.body).toBe("Monthly and annual.");
    expect(state.documents.d1?.status).toBe("current");
  });

  it("flips status on supersede and records what replaced it", () => {
    const old = makeDocument({ id: "d1" });
    const next = makeDocument({ id: "d2" });

    const state = reduce([
      ev({ type: "document_created", document: old }),
      ev({ type: "document_created", document: next }),
      ev({ type: "document_superseded", documentId: "d1", by: "d2" }, 99),
    ]);

    expect(state.documents.d1?.status).toBe("superseded");
    expect(state.documents.d1?.supersededBy).toBe("d2");
    // Retiring a document is a write to it: it moves in "recently touched" order.
    expect(state.documents.d1?.updatedAt).toBe(99);
    // The body survives — a superseded document stays readable.
    expect(state.documents.d1?.body).toBe(old.body);
    expect(state.documents.d2?.status).toBe("current");
  });

  it("supersedes without a replacement, and ignores unknown documents", () => {
    const state = reduce([
      ev({ type: "document_created", document: makeDocument() }),
      ev({ type: "document_superseded", documentId: "d1" }),
      ev({ type: "document_superseded", documentId: "ghost" }),
    ]);

    expect(state.documents.d1?.status).toBe("superseded");
    expect(state.documents.d1?.supersededBy).toBeUndefined();
    expect(state.documents.ghost).toBeUndefined();
  });

  it("keeps context_consulted out of state and in the feed", () => {
    const state = reduce([
      ev({ type: "context_consulted", roleId: "cfo", tool: "library_read", args: { id: "d1" }, ok: true }),
    ]);

    expect(state.documents).toEqual({});
    expect(state.feed).toHaveLength(1);
    expect(state.feed[0]?.type).toBe("context_consulted");
  });
});

describe("library governance", () => {
  const governed = ["policy", "profile"] as const;

  it.each(governed)("refuses to create a %s without an explicit decision", async (type) => {
    await expect(
      library.create(COMPANY, {
        type,
        title: "No third-party ads",
        summary: "Standing rule.",
        ownerRoleId: "ceo",
        body: "We never monetise our authors' readers.",
      }),
    ).rejects.toBeInstanceOf(GovernanceError);

    expect(await library.list(COMPANY, { status: "any" })).toHaveLength(0);
  });

  it.each(governed)("creates a %s when the write comes through a decision", async (type) => {
    const doc = await library.create(COMPANY, {
      type,
      title: "No third-party ads",
      summary: "Standing rule.",
      ownerRoleId: "ceo",
      body: "We never monetise our authors' readers.",
      viaDecision: true,
    });

    expect(doc.status).toBe("current");
    expect(await library.read(COMPANY, doc.id)).toMatchObject({ type, status: "current" });
  });

  it("refuses to update or supersede a policy without a decision, whatever the caller claims", async () => {
    const doc = await library.create(COMPANY, {
      id: "pol-1",
      type: "policy",
      title: "No third-party ads",
      summary: "Standing rule.",
      ownerRoleId: "ceo",
      body: "We never monetise our authors' readers.",
      viaDecision: true,
    });

    await expect(library.update(COMPANY, doc.id, { body: "Ads are fine now." })).rejects.toBeInstanceOf(
      GovernanceError,
    );
    await expect(library.supersede(COMPANY, doc.id)).rejects.toBeInstanceOf(GovernanceError);

    // The policy is untouched, and nothing was written to the log.
    expect((await library.read(COMPANY, doc.id)).body).toBe("We never monetise our authors' readers.");
    const docEvents = (await store.listEvents(COMPANY)).filter((e) => e.type.startsWith("document_"));
    expect(docEvents).toHaveLength(1);
  });

  it("lets ungoverned types be written by their owning role", async () => {
    const doc = await library.create(COMPANY, {
      type: "finance",
      title: "Monthly finance summary",
      summary: "MRR, churn, CAC.",
      ownerRoleId: "cfo",
      body: "MRR $11,391.",
    });
    const updated = await library.update(COMPANY, doc.id, { body: "MRR $12,000." });

    expect(updated.body).toBe("MRR $12,000.");
    expect((await store.listEvents(COMPANY)).map((e) => e.type)).toEqual([
      "document_created",
      "document_updated",
    ]);
  });
});

describe("library service", () => {
  beforeEach(async () => {
    await library.create(COMPANY, {
      id: "fin-1",
      type: "finance",
      title: "Monthly finance summary",
      summary: "Budget, MRR, churn, CAC.",
      ownerRoleId: "cfo",
      tags: ["finance", "churn"],
      body: "Blended paid CAC is $54 and monthly MRR churn is 4.2%.",
      ts: 1_000,
    });
    await library.create(COMPANY, {
      id: "ana-1",
      type: "analysis",
      title: "Paid search CAC readout",
      summary: "The channel is saturated.",
      ownerRoleId: "growth-lead",
      tags: ["growth"],
      body: "Volume has been flat for three months at the same spend.",
      ts: 2_000,
    });
  });

  it("lists frontmatter only, newest first, current by default", async () => {
    const docs = await library.list(COMPANY);

    expect(docs.map((d) => d.id)).toEqual(["ana-1", "fin-1"]);
    expect(docs[0]).not.toHaveProperty("body");
  });

  it("filters by type, owner and tag", async () => {
    expect((await library.list(COMPANY, { type: "finance" })).map((d) => d.id)).toEqual(["fin-1"]);
    expect((await library.list(COMPANY, { ownerRoleId: "growth-lead" })).map((d) => d.id)).toEqual(["ana-1"]);
    expect((await library.list(COMPANY, { tag: "churn" })).map((d) => d.id)).toEqual(["fin-1"]);
  });

  it("hides superseded documents from the default listing but still reads them", async () => {
    await library.supersede(COMPANY, "fin-1", { by: "ana-1" });

    expect((await library.list(COMPANY)).map((d) => d.id)).toEqual(["ana-1"]);
    expect((await library.list(COMPANY, { status: "any" })).map((d) => d.id).sort()).toEqual([
      "ana-1",
      "fin-1",
    ]);

    const retired = await library.read(COMPANY, "fin-1");
    expect(retired.status).toBe("superseded");
    expect(retired.supersededBy).toBe("ana-1");
    expect(retired.body).toContain("CAC is $54");
  });

  it("finds documents by title and by body", async () => {
    const byTitle = await library.search(COMPANY, "paid search");
    expect(byTitle.map((d) => d.id)).toEqual(["ana-1"]);

    const byBody = await library.search(COMPANY, "churn");
    expect(byBody.map((d) => d.id)).toEqual(["fin-1"]);
    expect(byBody[0]?.snippet).toContain("churn");
    expect(byBody[0]).not.toHaveProperty("body");

    expect(await library.search(COMPANY, "kubernetes")).toEqual([]);
    expect(await library.search(COMPANY, "   ")).toEqual([]);
  });

  it("404s on an unknown document and 409s on a duplicate id", async () => {
    await expect(library.read(COMPANY, "nope")).rejects.toMatchObject({ status: 404 });
    await expect(
      library.create(COMPANY, {
        id: "fin-1",
        type: "note",
        title: "Clash",
        summary: "Same id.",
        ownerRoleId: "coo",
        body: "x",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("writes one event per write, and the log alone reproduces the library", async () => {
    await library.update(COMPANY, "fin-1", { summary: "Updated numbers." });
    await library.supersede(COMPANY, "ana-1");

    const types = (await store.listEvents(COMPANY)).map((e) => e.type);
    expect(types).toEqual([
      "document_created",
      "document_created",
      "document_updated",
      "document_superseded",
    ]);

    const state = reduce(await store.listEvents(COMPANY));
    expect(state.documents["fin-1"]?.summary).toBe("Updated numbers.");
    expect(state.documents["ana-1"]?.status).toBe("superseded");
  });
});
