/**
 * The context registry against a scripted company: every tool must answer, and
 * every answer must be small enough to put in a prompt.
 *
 * The point of these tests is not formatting — it is that a board agent asking
 * a reasonable question gets back the fact it asked for, and that a tool can
 * never blow up a position prompt with a 40kB document.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  cap,
  createContextRegistry,
  MAX_RESULT_CHARS,
} from "../src/context/registry";
import { ContextToolError, type ContextRegistry } from "../src/context/types";
import { createLibraryService, eventSourcedLibraryStore, type LibraryService } from "../src/library";
import { memoryEventStore } from "../src/store/memory";
import type { EventStore } from "../src/store/types";
import { makeProposal, testConfig } from "./fixtures";

const COMPANY = "acme";
const ROLE = "cfo";

let store: EventStore;
let library: LibraryService;
let registry: ContextRegistry;

/** One company with a decided proposal, tasks, a report, an escalation, spend, and a library. */
async function scriptCompany(): Promise<void> {
  await store.createCompany({ id: COMPANY, config: testConfig });
  await store.appendEvents(COMPANY, [
    { type: "day_started" },
    {
      type: "proposal_submitted",
      proposal: makeProposal({
        positions: [
          {
            roleId: "cfo",
            stance: "object",
            summary: "CAC is unproven on this channel.",
            keyPoints: ["Attribution is weak", "Payback would be four months"],
          },
          {
            roleId: "cto",
            stance: "support_with_conditions",
            summary: "Fine if the landing page is throwaway.",
            keyPoints: ["No new infrastructure"],
          },
        ],
        disagreements: [
          {
            topic: "Attribution",
            roleIds: ["cfo", "cto"],
            detail: "Whether a promo code is evidence enough to keep spending.",
          },
        ],
      }),
    },
    { type: "ceo_decision", proposalId: "p1", decision: "approved", note: "Run it once." },
    {
      type: "tasks_created",
      proposalId: "p1",
      tasks: [
        { id: "t1", proposalId: "p1", title: "Negotiate slots", departmentId: "dep-growth", status: "in_progress" },
        { id: "t2", proposalId: "p1", title: "Build landing page", departmentId: "dep-eng", status: "done" },
      ],
    },
    {
      type: "report_submitted",
      report: {
        id: "r1",
        kind: "task",
        taskId: "t2",
        departmentId: "dep-eng",
        authorRoleId: "cto",
        title: "Landing page live",
        done: "Shipped a static page behind the existing CDN.",
        spend: 120,
      },
    },
    {
      type: "escalation_raised",
      escalation: {
        id: "e1",
        fromRoleId: "cto",
        severity: "urgent",
        reason: "The podcast host wants payment up front.",
        ask: "Approve a $1,200 deposit.",
        status: "open",
      },
    },
    { type: "budget_spent", amount: 1200, category: "growth", departmentId: "dep-growth" },
  ]);

  await library.create(COMPANY, {
    id: "fin-1",
    type: "finance",
    title: "Monthly finance summary",
    summary: "Budget, MRR, churn and CAC in one page.",
    ownerRoleId: "cfo",
    tags: ["finance", "churn"],
    body: "Blended paid CAC is $54. Monthly MRR churn is 4.2%, roughly $478 a month.",
    ts: 1_000,
  });
  await library.create(COMPANY, {
    id: "pol-1",
    type: "policy",
    title: "Customer trust: no third-party ads",
    summary: "We never monetise our authors' readers.",
    ownerRoleId: "ceo",
    tags: ["trust"],
    body: "No third-party advertising on author sites, on any plan, in any form.",
    viaDecision: true,
    ts: 2_000,
  });
}

beforeEach(async () => {
  store = memoryEventStore();
  library = createLibraryService({ library: eventSourcedLibraryStore(store) });
  registry = createContextRegistry({ store, library });
  await scriptCompany();
});

const run = (name: string, args: unknown = {}) => registry.run(COMPANY, ROLE, name, args);

describe("the toolset", () => {
  it("exposes exactly the read-only context tools, each described for a model", () => {
    const tools = registry.toolsFor(ROLE);

    expect(tools.map((t) => t.name).sort()).toEqual([
      "budget_summary",
      "decisions_list",
      "decisions_read",
      "escalations_list",
      "library_list",
      "library_read",
      "library_search",
      "reports_list",
      "tasks_list",
    ]);
    // Deliberation is read-only: the board may not write the library it cites.
    expect(tools.map((t) => t.name)).not.toContain("library_write");

    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(80);
      expect(tool.description).toMatch(/Use this/);
      expect(tool.parameters).toMatchObject({ type: "object" });
    }
  });

  it("rejects an unknown tool with the list of real ones", async () => {
    await expect(run("library_delete")).rejects.toBeInstanceOf(ContextToolError);
    await expect(run("library_delete")).rejects.toThrow(/library_list/);
  });

  it("rejects bad arguments instead of guessing", async () => {
    await expect(run("library_read", {})).rejects.toBeInstanceOf(ContextToolError);
    await expect(run("library_search", { query: "x", type: "recipe" })).rejects.toBeInstanceOf(
      ContextToolError,
    );
    await expect(run("tasks_list", { status: "napping" })).rejects.toBeInstanceOf(ContextToolError);
  });

  it("answers every tool against the scripted company", async () => {
    const calls: [string, unknown][] = [
      ["library_list", {}],
      ["library_read", { id: "fin-1" }],
      ["library_search", { query: "churn" }],
      ["decisions_list", {}],
      ["decisions_read", { id: "p1" }],
      ["tasks_list", {}],
      ["reports_list", {}],
      ["escalations_list", {}],
      ["budget_summary", {}],
    ];

    for (const [name, args] of calls) {
      const out = await run(name, args);
      expect(out.length, name).toBeGreaterThan(0);
      expect(out.length, name).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    }
  });
});

describe("library tools", () => {
  it("lists frontmatter with ids and summaries, and filters", async () => {
    const all = await run("library_list");
    expect(all).toContain("fin-1");
    expect(all).toContain("pol-1");
    // No bodies in a listing.
    expect(all).not.toContain("No third-party advertising on author sites");

    const onlyFinance = await run("library_list", { type: "finance" });
    expect(onlyFinance).toContain("fin-1");
    expect(onlyFinance).not.toContain("pol-1");

    expect(await run("library_list", { owner: "ceo" })).toContain("pol-1");
    expect(await run("library_list", { tag: "churn" })).toContain("fin-1");
    expect(await run("library_list", { tag: "nonexistent" })).toMatch(/no current documents/i);
  });

  it("reads a whole document, body included", async () => {
    const out = await run("library_read", { id: "pol-1" });

    expect(out).toContain("# Customer trust: no third-party ads");
    expect(out).toContain("No third-party advertising on author sites");
    expect(out).toContain("owner: ceo");
  });

  it("reports a missing document as a tool error, not a crash", async () => {
    await expect(run("library_read", { id: "ghost" })).rejects.toBeInstanceOf(ContextToolError);
  });

  it("finds documents by title and by body, and says so when it finds nothing", async () => {
    const byTitle = await run("library_search", { query: "monthly finance" });
    expect(byTitle).toContain("fin-1");

    const byBody = await run("library_search", { query: "third-party advertising" });
    expect(byBody).toContain("pol-1");

    const typed = await run("library_search", { query: "churn", type: "policy" });
    expect(typed).toMatch(/Nothing in the library matches/);
  });
});

describe("process-memory tools", () => {
  it("lists past decisions with the CEO's call, the cost and the disagreement topics", async () => {
    const out = await run("decisions_list");

    expect(out).toContain("p1");
    expect(out).toContain("CEO: approved");
    expect(out).toContain("$2,400");
    expect(out).toContain("disagreement: Attribution");
  });

  it("reads one decision in full, positions and dissent included", async () => {
    const out = await run("decisions_read", { id: "p1" });

    expect(out).toContain("## Board positions");
    expect(out).toContain("cfo — object");
    expect(out).toContain("Attribution is weak");
    expect(out).toContain("## Recorded disagreements");
    expect(out).toContain("## CEO note");
    expect(out).toContain("Run it once.");
  });

  it("errors on an unknown proposal", async () => {
    await expect(run("decisions_read", { id: "p9" })).rejects.toBeInstanceOf(ContextToolError);
  });

  it("lists tasks and filters by department and status", async () => {
    const all = await run("tasks_list");
    expect(all).toContain("2 task(s), 1 still open");

    const eng = await run("tasks_list", { departmentId: "dep-eng" });
    expect(eng).toContain("t2");
    expect(eng).not.toContain("t1");

    expect(await run("tasks_list", { status: "blocked" })).toMatch(/No tasks match/);
  });

  it("lists reports with spend and honours the limit", async () => {
    const out = await run("reports_list", { limit: 1 });

    expect(out).toContain("r1");
    expect(out).toContain("Landing page live");
    expect(out).toContain("$120");
    expect(await run("reports_list", { kind: "periodic" })).toMatch(/No reports match/);
  });

  it("lists escalations and filters by status", async () => {
    const open = await run("escalations_list", { status: "open" });

    expect(open).toContain("e1");
    expect(open).toContain("URGENT");
    expect(open).toContain("Approve a $1,200 deposit.");
    expect(await run("escalations_list", { status: "resolved" })).toMatch(/No escalations match/);
  });

  it("summarises the budget from the config and the log", async () => {
    const out = await run("budget_summary");

    // $20,000 budget, $1,200 categorised spend plus $120 reported.
    expect(out).toContain("$20,000");
    expect(out).toContain("Spent so far: $1,320");
    expect(out).toContain("Remaining: $18,680");
    expect(out).toContain("- growth: $1,200");
  });
});

describe("result length cap", () => {
  it("truncates an oversized result and says how much was cut", () => {
    const out = cap("x".repeat(MAX_RESULT_CHARS * 2));

    expect(out.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(out).toMatch(/\[truncated: \d+ more characters/);
    expect(cap("short")).toBe("short");
  });

  it("caps a huge document on the way out of library_read", async () => {
    await library.create(COMPANY, {
      id: "big-1",
      type: "note",
      title: "Everything we know",
      summary: "Far too much of it.",
      ownerRoleId: "coo",
      body: "The quick brown fox. ".repeat(2000),
    });

    const out = await run("library_read", { id: "big-1" });

    expect(out.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(out).toContain("[truncated:");
  });

  it("caps a long listing too", async () => {
    for (let i = 0; i < 60; i += 1) {
      await library.create(COMPANY, {
        id: `note-${i}`,
        type: "note",
        title: `Standing note number ${i} about the publish pipeline`,
        summary: `A summary long enough to matter when sixty of them are listed together — number ${i}.`,
        ownerRoleId: "coo",
        body: "body",
      });
    }

    const out = await run("library_list", { type: "note" });
    expect(out.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(out).toContain("[truncated:");
  });
});

describe("registry without a library service", () => {
  it("still answers library tools by folding the log", async () => {
    const bare = createContextRegistry({ store });

    expect(await bare.run(COMPANY, ROLE, "library_list", {})).toContain("fin-1");
    expect(await bare.run(COMPANY, ROLE, "library_read", { id: "pol-1" })).toContain(
      "No third-party advertising",
    );
  });
});
