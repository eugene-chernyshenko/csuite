/**
 * Store semantics, against the in-memory implementation. These assertions are
 * the contract `pgEventStore` must also satisfy — append order, monotonic seq,
 * envelope validation, and state as a pure fold of the log.
 */

import { describe, expect, it } from "vitest";
import { memoryEventStore } from "../src/store/memory";
import { normalizeEvent, InvalidEventError, toRowParts, fromRowParts } from "../src/store/event-shape";
import { CompanyExistsError, CompanyNotFoundError } from "../src/store/types";
import { makeProposal, testConfig } from "./fixtures";

async function seeded() {
  const store = memoryEventStore();
  const company = await store.createCompany({ id: "acme", config: testConfig });
  return { store, company };
}

describe("event store", () => {
  it("assigns increasing seq in the order events were handed over", async () => {
    const { store } = await seeded();

    const appended = await store.appendEvents("acme", [
      { type: "day_started" },
      { type: "question_asked", text: "first", byRoleId: "ceo" },
      { type: "question_asked", text: "second", byRoleId: "ceo" },
    ]);

    expect(appended.map((e) => e.seq)).toEqual([1, 2, 3]);

    const more = await store.appendEvents("acme", [
      { type: "question_asked", text: "third", byRoleId: "ceo" },
    ]);
    expect(more[0]!.seq).toBe(4);

    const all = await store.listEvents("acme");
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(all.filter((e) => e.type === "question_asked").map((e) => (e as { text: string }).text))
      .toEqual(["first", "second", "third"]);
  });

  it("serves only events after the polling cursor", async () => {
    const { store } = await seeded();
    await store.appendEvents("acme", [
      { type: "day_started" },
      { type: "question_asked", text: "a", byRoleId: "ceo" },
      { type: "question_asked", text: "b", byRoleId: "ceo" },
    ]);

    expect((await store.listEvents("acme", 1)).map((e) => e.seq)).toEqual([2, 3]);
    expect(await store.listEvents("acme", 3)).toEqual([]);
  });

  it("keeps companies isolated from one another", async () => {
    const { store } = await seeded();
    await store.createCompany({ id: "other", config: testConfig });

    await store.appendEvents("acme", [{ type: "question_asked", text: "ours", byRoleId: "ceo" }]);
    await store.appendEvents("other", [{ type: "question_asked", text: "theirs", byRoleId: "ceo" }]);

    expect(await store.listEvents("acme")).toHaveLength(1);
    expect(await store.listEvents("other")).toHaveLength(1);
    expect((await store.getState("acme")).feed).toHaveLength(1);
  });

  it("derives state as a fold of everything appended", async () => {
    const { store } = await seeded();
    await store.appendEvents("acme", [
      { type: "proposal_submitted", proposal: makeProposal() },
      { type: "ceo_decision", proposalId: "p1", decision: "approved" },
    ]);

    const state = await store.getState("acme");
    expect(state.proposals.p1?.status).toBe("in_progress");
  });

  it("refuses events for an unknown company and duplicate company ids", async () => {
    const { store } = await seeded();

    await expect(store.appendEvents("nope", [{ type: "day_started" }])).rejects.toBeInstanceOf(
      CompanyNotFoundError,
    );
    await expect(store.createCompany({ id: "acme", config: testConfig })).rejects.toBeInstanceOf(
      CompanyExistsError,
    );
  });

  it("mints a server id and an epoch-ms ts when the caller omits them", () => {
    const before = Date.now();
    const normalized = normalizeEvent({ type: "day_started" });

    expect(normalized.id).toMatch(/[0-9a-f-]{36}/);
    expect(normalized.ts).toBeGreaterThanOrEqual(before);
  });

  it("preserves a caller-supplied id and ts", () => {
    const normalized = normalizeEvent({ id: "given", ts: 42, type: "day_started" });
    expect(normalized).toEqual({ id: "given", ts: 42, type: "day_started" });
  });

  it("rejects an unknown event type", () => {
    expect(() => normalizeEvent({ type: "world_domination" } as never)).toThrow(InvalidEventError);
  });

  it("round-trips an event through row serialization unchanged", () => {
    const event = normalizeEvent({
      id: "e1",
      ts: 1700000000000,
      type: "question_asked",
      text: "Should we sponsor podcasts?",
      byRoleId: "ceo",
    });

    expect(fromRowParts({ ...toRowParts(event), seq: 7 })).toEqual({ ...event, seq: 7 });
  });
});
