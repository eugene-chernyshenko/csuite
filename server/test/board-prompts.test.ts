/**
 * Prompt construction — and above all, blindness.
 *
 * "The board is not a group chat" (CLAUDE.md) is only true if a position prompt
 * physically cannot contain a colleague. That is what the first block here
 * checks, word by word.
 */

import { describe, expect, it } from "vitest";
import type { Position, Role } from "@csuite/contract";
import {
  buildPositionMessages,
  buildSynthesisMessages,
  companyProfile,
} from "../src/board/prompts";
import { boardConfig, roleById } from "./board-fixtures";

const profile = companyProfile(boardConfig);
const QUESTION = "Should we sponsor two indie-author podcasts for four weeks?";

const text = (messages: { content: string }[]): string => messages.map((m) => m.content).join("\n");

describe("buildPositionMessages — blindness", () => {
  it("never mentions another board member's name, title or mandate", () => {
    for (const role of boardConfig.roles.filter((r) => r.kind === "board")) {
      const prompt = text(buildPositionMessages({ profile, role, question: QUESTION }));
      const others = boardConfig.roles.filter((r) => r.kind === "board" && r.id !== role.id);

      expect(others.length).toBeGreaterThan(0);
      for (const other of others) {
        expect(prompt).not.toContain(other.name);
        expect(prompt).not.toContain(other.title);
        expect(prompt).not.toContain(other.mandate);
        expect(prompt).not.toContain(other.id);
      }
    }
  });

  it("never leaks another member's position, because it cannot be given one", () => {
    // The signature takes a CompanyProfile and exactly one Role: there is no
    // parameter through which a colleague's position could arrive. This test
    // pins the shape that guarantees it.
    const cfo = roleById("cfo");
    const prompt = text(buildPositionMessages({ profile, role: cfo, question: QUESTION }));
    // The synthesis prompt's markers for somebody else's opinion, absent here.
    expect(prompt).not.toContain("roleId:");
    expect(prompt).not.toContain("POSITIONS");
    expect(prompt).not.toContain("key points:");
    expect(prompt).toContain("You have not seen any colleague's position");
  });

  it("carries the profile, the question, and the role's own mandate", () => {
    const cfo = roleById("cfo");
    const prompt = text(buildPositionMessages({ profile, role: cfo, question: QUESTION }));

    expect(prompt).toContain(boardConfig.name);
    expect(prompt).toContain(boardConfig.product);
    expect(prompt).toContain("18,000 USD");
    expect(prompt).toContain(QUESTION);
    expect(prompt).toContain(cfo.mandate);
    expect(prompt).toContain(cfo.title);
  });

  it("states the provenance rule and the required JSON shape", () => {
    const prompt = text(
      buildPositionMessages({ profile, role: roleById("cto"), question: QUESTION }),
    );
    expect(prompt).toContain("assumptions");
    expect(prompt).toMatch(/not grounded/i);
    expect(prompt).toContain('"stance"');
    expect(prompt).toContain('"keyPoints"');
  });
});

describe("buildSynthesisMessages", () => {
  const position = (roleId: string, over: Partial<Position> = {}): Position => ({
    roleId,
    stance: "support",
    summary: `${roleId} says go.`,
    keyPoints: [`${roleId} point one`, `${roleId} point two`],
    ...over,
  });

  const entries = (["cfo", "cto", "coo"] as const).map((id) => ({
    role: roleById(id) as Role,
    position: position(id),
  }));

  const prompt = text(
    buildSynthesisMessages({
      profile,
      question: QUESTION,
      entries,
      author: roleById("cfo"),
    }),
  );

  it("passes every position through verbatim, attributed by roleId", () => {
    for (const { role, position: p } of entries) {
      expect(prompt).toContain(`roleId: ${role.id}`);
      expect(prompt).toContain(p.summary);
      for (const point of p.keyPoints) expect(prompt).toContain(point);
    }
  });

  it("lists the valid role ids and forbids inventing a disagreement", () => {
    expect(prompt).toContain("valid ids: cfo, cto, coo");
    expect(prompt).toContain("Inventing a disagreement is worse than reporting none");
    expect(prompt).toContain("return an empty array");
  });

  it("asks for the full proposal document shape", () => {
    for (const field of ["title", "summary", "rationale", "alternatives", "cost", "risks"]) {
      expect(prompt).toContain(`"${field}"`);
    }
  });
});
