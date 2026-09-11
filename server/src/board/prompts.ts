/**
 * The board's prompts.
 *
 * Two shapes only, and the difference between them is the product:
 *
 *  - **Stage 1, blind.** `buildPositionMessages` takes a `CompanyProfile` and
 *    *one* role. It cannot be handed the roster, so no colleague's name,
 *    title, mandate or opinion can reach a position prompt — blindness is
 *    enforced by the signature, not by care. "The board is not a group chat"
 *    (CLAUDE.md) is a property of this file.
 *  - **Stage 2, sighted.** `buildSynthesisMessages` sees everything: the
 *    question and every position verbatim. Its job is to record the fight, not
 *    to settle it.
 */

import type { CompanyConfig, Position, Role } from "@csuite/contract";
import type { ContextToolDef } from "../context/types";
import type { ChatMessage } from "./openrouter";

/**
 * Per-call budget. Every call is capped, by decision (CLAUDE.md) — but the cap
 * is a knob, not a constant: these are the defaults behind
 * `BOARD_POSITION_MAX_TOKENS` / `BOARD_SYNTHESIS_MAX_TOKENS` in .env, which
 * reach the runner through `BoardDeps`.
 */
export const DEFAULT_POSITION_MAX_TOKENS = 2000;
export const DEFAULT_SYNTHESIS_MAX_TOKENS = 4000;

/** Positions argue; synthesis reports. The temperatures say so. */
export const POSITION_TEMPERATURE = 0.7;
export const SYNTHESIS_TEMPERATURE = 0.4;

/**
 * Everything a board member is allowed to treat as fact — and, deliberately,
 * the only part of the company config a position prompt can see. No roles.
 */
export interface CompanyProfile {
  name: string;
  product: string;
  monthlyBudget: number;
  currency: string;
  dossier?: string | undefined;
  /** Departments (id + name) — ids are what the context tools accept. Not the roster. */
  departments?: { id: string; name: string }[] | undefined;
}

export function companyProfile(config: CompanyConfig): CompanyProfile {
  return {
    name: config.name,
    product: config.product,
    monthlyBudget: config.monthlyBudget,
    currency: config.currency,
    dossier: config.dossier,
    departments: config.departments.map((d) => ({ id: d.id, name: d.name })),
  };
}

function profileBlock(profile: CompanyProfile, hasTools = false): string {
  const lines = [
    hasTools
      ? "COMPANY PROFILE (grounded fact; the context tools can give you more)"
      : "COMPANY PROFILE (the only grounded facts available)",
    `Name: ${profile.name}`,
    `Product: ${profile.product}`,
    `Monthly budget: ${profile.monthlyBudget.toLocaleString("en-US")} ${profile.currency}`,
  ];
  if (profile.departments?.length) {
    lines.push(`Departments: ${profile.departments.map((d) => `${d.id} (${d.name})`).join(", ")}`);
  }
  if (profile.dossier) {
    lines.push("", "COMPANY DOSSIER (also grounded fact)", profile.dossier.trim());
  }
  return lines.join("\n");
}

// --------------------------------------------------------------- stage 1

export type Harness = "baseline" | "adversarial";

export interface PositionPromptInput {
  profile: CompanyProfile;
  /** The one role writing. Its colleagues are structurally out of reach here. */
  role: Role;
  question: string;
  /** "adversarial" adds the steelman-against + flip-conditions obligations. */
  harness?: Harness;
  /**
   * The context tools this role may call on this run, if any. Only their
   * *existence* changes the prompt — the tool definitions themselves travel in
   * the request's `tools` field, not in the text. Still blind by construction:
   * the registry exposes company memory, never a colleague's position.
   */
  tools?: readonly ContextToolDef[] | undefined;
}

/**
 * How a member is told to use the tools. Deliberately short: consult narrowly,
 * cite what you consulted, and do not expect to find your colleagues in there.
 */
function contextToolsBlock(): string[] {
  return [
    "",
    "CONTEXT TOOLS (available to you on this question)",
    "You can consult the company's own memory before you take a stance — the tools attached " +
      "to this request answer questions about what the company has written down and decided.",
    "- Consult what your own domain needs, and stop. A few targeted calls beat sweeping the " +
      "whole archive: every call spends the company's money and the CEO's time.",
    "- A figure you obtained from a tool is GROUNDED. Say where it came from in the key point " +
      'that uses it — e.g. "per the August finance summary, support spend ran at $4,100".',
    "- A figure you did NOT obtain from a tool and cannot find in the profile is still " +
      'ungrounded, and still belongs in "assumptions" under the rule below.',
    "- The tools reach company memory only. Nothing in them returns another board member's " +
      "position, opinion or stance on this question — that is by design, not an oversight. " +
      "Do not ask for one and do not guess at one.",
    "- When you have what you need, stop calling tools and reply with the JSON position.",
  ];
}

export function buildPositionMessages(input: PositionPromptInput): ChatMessage[] {
  const { profile, role, question, harness = "baseline" } = input;
  const hasTools = (input.tools?.length ?? 0) > 0;

  const adversarialBlock =
    harness === "adversarial"
      ? [
          "",
          "ADVERSARIAL OBLIGATIONS (this harness is stricter)",
          "- Before settling on a stance, construct the strongest case AGAINST the answer " +
            "you are inclined to give, from within your own mandate. If you cannot refute " +
            "that case with the facts in the profile, your stance must reflect it.",
          "- One of your keyPoints must state, concretely, what would have to be true for " +
            'you to take the opposite stance ("I would flip to object if ...").',
          "- Unanimity is not your job. If your mandate gives you any real reason to " +
            "resist this question, resist it — a board that always agrees is broken.",
        ]
      : [];

  const system = [
    `You are ${role.name}, ${role.title} at ${profile.name}. You sit on the board.`,
    "",
    "The board's shared job — yours included — is to lead the company to success: grow " +
      "the business, expand its market, and not lose its money or its customers' trust. " +
      "You are neither an attacker nor a cheerleader; you are a steward. Support what " +
      "moves the company forward, resist what endangers it, and say which is which " +
      "plainly. The cheapest good decision is a fast yes to an obviously right move; the " +
      "most expensive mistake is a confident yes to a wrong one.",
    "",
    "Your own domain of stewardship — the lens you argue from — is:",
    role.mandate,
    "",
    "You are writing an INDEPENDENT position on a question the CEO has put to the board. " +
      "You have not seen any colleague's position and you will not see one before you " +
      "submit. Do not guess at what anyone else will say, do not address them, do not " +
      "hedge toward a consensus that does not exist yet. Judge the question from your own " +
      "domain, honestly — agreement and objection are both fine when they are earned.",
    "",
    "RULES",
    "- Argue strictly from your mandate. Touch other areas only where your mandate is at stake.",
    '- Take a clear stance. "support_with_conditions" must name the conditions; "object" ' +
      "must name what would change your mind.",
    "- Be specific. A key point that would read the same for any company is worthless — " +
      "anchor every one of them to this company, this question, this budget.",
    "- No preamble, no flattery, no restating the question.",
    "- Write your ENTIRE position — summary, key points, assumptions — in the language " +
      "the CEO's question is written in. The CEO must never need a translator to read " +
      "their own board.",
    ...adversarialBlock,
    ...(hasTools ? contextToolsBlock() : []),
    "",
    "GROUNDING (this is not optional)",
    hasTools
      ? "Your grounded facts are the company profile below plus whatever you actually " +
        "obtained from a context tool. Any number, rate, percentage, price, benchmark or " +
        "timeline from neither source is not grounded. You may still use one to make the " +
        'argument concrete — but every single such figure must also appear in "assumptions", ' +
        'written as the assumption it is (e.g. "Assumes ~4% monthly churn; not in the ' +
        'profile and not in anything I read."). Never present an ungrounded figure as fact, ' +
        'and never put a figure you did obtain from a tool in "assumptions" — cite its ' +
        "source in the key point instead."
      : "The company profile below is the only grounded fact you have. Any number, rate, " +
        "percentage, price, benchmark or timeline that does not appear there is not grounded. " +
        "You may still use one to make the argument concrete — but every single such figure " +
        'must also appear in "assumptions", written as the assumption it is ' +
        '(e.g. "Assumes ~4% monthly churn; not given in the profile."). Never present an ' +
        "ungrounded figure as fact.",
    "",
    "OUTPUT",
    "Reply with one JSON object and nothing else — no markdown fence, no commentary:",
    "{",
    '  "stance": "support" | "support_with_conditions" | "object",',
    '  "summary": "one sentence, your position in your own voice",',
    '  "keyPoints": ["2 to 4 specific arguments, each a full sentence"],',
    '  "assumptions": ["every figure or claim you could not ground, stated as an assumption; [] if none"]',
    "}",
  ].join("\n");

  const user = [
    profileBlock(profile, hasTools),
    "",
    "QUESTION FROM THE CEO",
    question,
    "",
    hasTools
      ? `Consult what you need, then write your position as ${role.title}.`
      : `Write your position as ${role.title}.`,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// --------------------------------------------------------------- stage 2

export interface SynthesisEntry {
  role: Role;
  position: Position;
}

export interface SynthesisPromptInput {
  profile: CompanyProfile;
  question: string;
  /** Every surviving position, verbatim, with the role that wrote it. */
  entries: SynthesisEntry[];
  /** The role the document is attributed to. */
  author: Role;
}

export function buildSynthesisMessages(input: SynthesisPromptInput): ChatMessage[] {
  const { profile, question, entries, author } = input;
  const roleIds = entries.map((e) => e.role.id);

  const system = [
    `You are ${author.name}, ${author.title} at ${profile.name}, writing the board's ` +
      "proposal document for the CEO.",
    "",
    "Each board member wrote an independent position, blind to the others. Turn the " +
      "question and those positions into ONE document the CEO can act on — and report the " +
      "board's disagreements instead of smoothing them over.",
    "",
    "DISAGREEMENTS",
    "- Record one ONLY where two positions genuinely conflict: opposing stances on the same " +
      "point, or key points that cannot both be acted on.",
    `- Identify the conflicting parties by roleId, exactly as given below (valid ids: ${roleIds.join(", ")}), at least two per disagreement.`,
    "- Different emphasis is not disagreement. A condition nobody contradicts is not " +
      "disagreement. Two people worried about different risks are not disagreeing.",
    "- If the board does not genuinely disagree, return an empty array. Inventing a " +
      "disagreement is worse than reporting none.",
    "",
    "LANGUAGE",
    "Write the ENTIRE document — title, summary, rationale, alternatives, cost note, " +
      "risks, disagreements — in the language of the CEO's question, even if some " +
      "positions were written in another language.",
    "",
    "GROUNDING",
    "Use only figures that appear in the company profile, in the positions below, or in the " +
      "sources those positions cite — a member who consulted the company's records may have " +
      "brought numbers with them, and those are usable, attributed as the position attributes " +
      "them. Do not invent new numbers; if a figure is an assumption, say so in the sentence " +
      "that uses it.",
    "",
    "OUTPUT",
    "Reply with one JSON object and nothing else — no markdown fence, no commentary:",
    "{",
    '  "title": "the decision, stated as a decision, under 80 characters",',
    '  "summary": "one paragraph the CEO reads first",',
    '  "rationale": "2-3 paragraphs of the actual argument, separated by blank lines",',
    '  "alternatives": ["2 to 3 real options the CEO could pick instead, each one sentence"],',
    '  "cost": { "amount": <number in USD, 0 if there is truly no direct spend>, "note": "what the number covers, or why it is 0" },',
    '  "risks": ["3 to 4 concrete risks, each a full sentence"],',
    '  "disagreements": [{ "topic": "...", "roleIds": ["...", "..."], "detail": "what each side actually argues, named" }]',
    "}",
  ].join("\n");

  const user = [
    profileBlock(profile),
    "",
    "QUESTION FROM THE CEO",
    question,
    "",
    "POSITIONS (written independently, blind to each other)",
    "",
    entries.map(formatEntry).join("\n\n"),
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function formatEntry(entry: SynthesisEntry): string {
  const { role, position } = entry;
  return [
    `--- roleId: ${role.id} — ${role.name}, ${role.title}`,
    `mandate: ${role.mandate}`,
    `stance: ${position.stance}`,
    `summary: ${position.summary}`,
    "key points:",
    ...position.keyPoints.map((p) => `- ${p}`),
  ].join("\n");
}
