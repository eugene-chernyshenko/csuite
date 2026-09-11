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
 *
 * The **revision** pair (`buildRevisionPositionMessages` /
 * `buildRevisionSynthesisMessages`) is the same two stages over a different
 * subject: a proposal the CEO returned with questions. It is the one place a
 * stage-1 prompt legitimately carries colleagues' words — a *submitted*
 * document, positions included, is company record; the CEO has read it and so
 * may its authors. Blindness still holds where it means something: nobody sees
 * anybody's **revised** position before writing their own.
 */

import type { CompanyConfig, Position, Proposal, Role } from "@csuite/contract";
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

/** The shared opening: who you are and what the board is for. */
function stewardshipBlock(profile: CompanyProfile, role: Role): string[] {
  return [
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
  ];
}

function adversarialBlock(harness: Harness): string[] {
  if (harness !== "adversarial") return [];
  return [
    "",
    "ADVERSARIAL OBLIGATIONS (this harness is stricter)",
    "- Before settling on a stance, construct the strongest case AGAINST the answer " +
      "you are inclined to give, from within your own mandate. If you cannot refute " +
      "that case with the facts in the profile, your stance must reflect it.",
    "- One of your keyPoints must state, concretely, what would have to be true for " +
      'you to take the opposite stance ("I would flip to object if ...").',
    "- Unanimity is not your job. If your mandate gives you any real reason to " +
      "resist this question, resist it — a board that always agrees is broken.",
  ];
}

/** Which figures count as fact — identical for a first position and a revised one. */
function groundingBlock(hasTools: boolean): string[] {
  return [
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
  ];
}

/** The stage-1 JSON contract — the one `positionResponseSchema` validates. */
function positionOutputBlock(summaryHint: string): string[] {
  return [
    "",
    "OUTPUT",
    "Reply with one JSON object and nothing else — no markdown fence, no commentary:",
    "{",
    '  "stance": "support" | "support_with_conditions" | "object",',
    `  "summary": "${summaryHint}",`,
    '  "keyPoints": ["2 to 4 specific arguments, each a full sentence"],',
    '  "assumptions": ["every figure or claim you could not ground, stated as an assumption; [] if none"]',
    "}",
  ];
}

export function buildPositionMessages(input: PositionPromptInput): ChatMessage[] {
  const { profile, role, question, harness = "baseline" } = input;
  const hasTools = (input.tools?.length ?? 0) > 0;

  const system = [
    ...stewardshipBlock(profile, role),
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
    ...adversarialBlock(harness),
    ...(hasTools ? contextToolsBlock() : []),
    ...groundingBlock(hasTools),
    ...positionOutputBlock("one sentence, your position in your own voice"),
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

// ------------------------------------------------- stage 1, revision variant

export interface RevisionPositionPromptInput {
  profile: CompanyProfile;
  /** The one role writing the revised position. */
  role: Role;
  /** What the board was originally asked — or, if unrecoverable, the subject. */
  question: string;
  /** The returned document, verbatim. Company record since the CEO read it. */
  original: Proposal;
  /** The CEO's questions, i.e. the note attached to the return. */
  note: string;
  /** Roster, used only to label the record's positions the way the record does. */
  roles?: readonly Role[] | undefined;
  harness?: Harness;
  tools?: readonly ContextToolDef[] | undefined;
}

/**
 * The submitted document as the CEO saw it — positions included, the reader's
 * own marked so nobody has to work out which voice was theirs.
 */
export function formatSubmittedDocument(
  proposal: Proposal,
  roles: readonly Role[] = [],
  ownRoleId?: string,
): string {
  const label = (roleId: string): string => {
    const role = roles.find((r) => r.id === roleId);
    const who = role ? ` — ${role.name}, ${role.title}` : "";
    return `--- roleId: ${roleId}${who}${roleId === ownRoleId ? "   << YOUR OWN POSITION" : ""}`;
  };

  const lines = [
    `TITLE: ${proposal.title}`,
    "",
    `SUMMARY: ${proposal.summary}`,
    "",
    "RATIONALE:",
    proposal.rationale,
    "",
    "ALTERNATIVES OFFERED:",
    ...proposal.alternatives.map((a) => `- ${a}`),
    "",
    `COST AS STATED: ${proposal.cost.amount} — ${proposal.cost.note}`,
    "",
    "RISKS AS STATED:",
    ...proposal.risks.map((r) => `- ${r}`),
    "",
    "POSITIONS AS SUBMITTED (the round that closed)",
  ];
  for (const position of proposal.positions) {
    lines.push(
      "",
      label(position.roleId),
      `stance: ${position.stance}`,
      `summary: ${position.summary}`,
      "key points:",
      ...position.keyPoints.map((p) => `- ${p}`),
    );
  }
  if (proposal.disagreements.length > 0) {
    lines.push("", "DISAGREEMENTS RECORDED");
    for (const d of proposal.disagreements) {
      lines.push(`- ${d.topic} (${d.roleIds.join(" vs ")}): ${d.detail}`);
    }
  }
  return lines.join("\n");
}

/**
 * A board member answering the CEO's questions on a returned proposal.
 *
 * Sighted about the round that closed, blind about the round in progress — and
 * the instruction that matters is the one about changing your mind: the point
 * of a revision is to fix what the questions exposed, not to re-argue it.
 */
export function buildRevisionPositionMessages(input: RevisionPositionPromptInput): ChatMessage[] {
  const { profile, role, question, original, note, harness = "baseline" } = input;
  const hasTools = (input.tools?.length ?? 0) > 0;
  const own = original.positions.find((p) => p.roleId === role.id);

  const system = [
    ...stewardshipBlock(profile, role),
    "",
    "THIS IS A REVISION ROUND. The board already answered this question: the proposal " +
      "below was submitted to the CEO, and the CEO RETURNED it with questions. A submitted " +
      "document is company record — the CEO has read it, every position in it included — so " +
      "you are reading exactly what they read, your own position among them.",
    "",
    own
      ? "You wrote one of those positions; it is marked as yours. You are now writing your " +
        "REVISED position: answer the CEO's questions from your own domain, and say where " +
        "you stand once they are answered."
      : "You did not have a position in that round. You are writing one now, answering the " +
        "CEO's questions from your own domain.",
    "",
    "RULES FOR THIS ROUND",
    "- Answer the CEO's questions that touch your domain DIRECTLY, in your key points. Do " +
      "not answer around them, do not defer them to a colleague, do not promise to look " +
      "into it later.",
    "- If a question exposes a real hole in what the board argued — or in what you argued — " +
      "change your stance and say plainly what changed it. Revising because the CEO found " +
      "something is stewardship; defending a position for pride is not.",
    "- What still stands, still stands. Say so briefly — one key point is enough — and " +
      "spend the rest on what the questions actually opened. Do not re-argue an untouched " +
      "point at length and do not pad.",
    "- You are blind AGAIN for this round: you can see what your colleagues wrote in the " +
      "round that closed, but not what any of them is writing now. Do not guess at their " +
      "revised positions, do not address them, do not hedge toward a consensus that does " +
      "not exist yet.",
    '- Take a clear stance. "support_with_conditions" must name the conditions; "object" ' +
      "must name what would change your mind.",
    "- No preamble, no flattery, no restating the CEO's questions before answering them.",
    "- Write your ENTIRE position — summary, key points, assumptions — in the language " +
      "the CEO's questions are written in. The CEO must never need a translator to read " +
      "their own board.",
    ...adversarialBlock(harness),
    ...(hasTools ? contextToolsBlock() : []),
    ...groundingBlock(hasTools),
    ...positionOutputBlock(
      "one sentence: where you stand now, after the CEO's questions",
    ),
  ].join("\n");

  const user = [
    profileBlock(profile, hasTools),
    "",
    "WHAT THE BOARD WAS ASKED",
    question,
    "",
    "THE RETURNED PROPOSAL (company record — submitted, read by the CEO, returned)",
    formatSubmittedDocument(original, input.roles ?? [], role.id),
    "",
    "THE CEO'S QUESTIONS ON RETURNING IT",
    note,
    "",
    hasTools
      ? `Consult what you need, then write your revised position as ${role.title}.`
      : `Write your revised position as ${role.title}.`,
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

/** The rule the whole board design rests on — identical in both synthesis shapes. */
function disagreementBlock(roleIds: readonly string[]): string[] {
  return [
    "DISAGREEMENTS",
    "- Record one ONLY where two positions genuinely conflict: opposing stances on the same " +
      "point, or key points that cannot both be acted on.",
    `- Identify the conflicting parties by roleId, exactly as given below (valid ids: ${roleIds.join(", ")}), at least two per disagreement.`,
    "- Different emphasis is not disagreement. A condition nobody contradicts is not " +
      "disagreement. Two people worried about different risks are not disagreeing.",
    "- If the board does not genuinely disagree, return an empty array. Inventing a " +
      "disagreement is worse than reporting none.",
  ];
}

/** `subject` is what the document must be written in the language of. */
function synthesisLanguageBlock(subject: string): string[] {
  return [
    "LANGUAGE",
    "Write the ENTIRE document — title, summary, rationale, alternatives, cost note, " +
      `risks, disagreements — in the language of ${subject}, even if some ` +
      "positions were written in another language.",
  ];
}

function synthesisGroundingBlock(): string[] {
  return [
    "GROUNDING",
    "Use only figures that appear in the company profile, in the positions below, or in the " +
      "sources those positions cite — a member who consulted the company's records may have " +
      "brought numbers with them, and those are usable, attributed as the position attributes " +
      "them. Do not invent new numbers; if a figure is an assumption, say so in the sentence " +
      "that uses it.",
  ];
}

/** The stage-2 JSON contract — the one `proposalResponseSchema` validates. */
function proposalOutputBlock(rationaleHint: string): string[] {
  return [
    "OUTPUT",
    "Reply with one JSON object and nothing else — no markdown fence, no commentary:",
    "{",
    '  "title": "the decision, stated as a decision, under 80 characters",',
    '  "summary": "one paragraph the CEO reads first",',
    `  "rationale": "${rationaleHint}",`,
    '  "alternatives": ["2 to 3 real options the CEO could pick instead, each one sentence"],',
    '  "cost": { "amount": <number in USD, 0 if there is truly no direct spend>, "note": "what the number covers, or why it is 0" },',
    '  "risks": ["3 to 4 concrete risks, each a full sentence"],',
    '  "disagreements": [{ "topic": "...", "roleIds": ["...", "..."], "detail": "what each side actually argues, named" }]',
    "}",
  ];
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
    ...disagreementBlock(roleIds),
    "",
    ...synthesisLanguageBlock("the CEO's question"),
    "",
    ...synthesisGroundingBlock(),
    "",
    ...proposalOutputBlock("2-3 paragraphs of the actual argument, separated by blank lines"),
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

// ------------------------------------------------- stage 2, revision variant

export interface RevisionSynthesisPromptInput {
  profile: CompanyProfile;
  /** What the board was originally asked. */
  question: string;
  /** The returned document the revision answers. */
  original: Proposal;
  /** The CEO's questions. */
  note: string;
  /** Every surviving revised position, verbatim. */
  entries: SynthesisEntry[];
  author: Role;
}

/**
 * The revised document. One obligation the first-round synthesis does not have:
 * the rationale must OPEN by answering the CEO's questions, explicitly, before
 * it argues anything else. A revision the CEO has to search for an answer in
 * has failed at the only job it was given.
 */
export function buildRevisionSynthesisMessages(
  input: RevisionSynthesisPromptInput,
): ChatMessage[] {
  const { profile, question, original, note, entries, author } = input;
  const roleIds = entries.map((e) => e.role.id);

  const system = [
    `You are ${author.name}, ${author.title} at ${profile.name}, writing the board's ` +
      "REVISED proposal document for the CEO.",
    "",
    "The board's previous document was submitted and the CEO RETURNED it with questions. " +
      "Each board member has now written a revised position, independently and blind to the " +
      "others, answering those questions from their own domain. Turn them into ONE revised " +
      "document the CEO can act on — and report the board's disagreements instead of " +
      "smoothing them over.",
    "",
    "WHAT A REVISION MUST DO",
    "- OPEN THE RATIONALE BY ANSWERING THE CEO'S QUESTIONS, explicitly and in the order " +
      "they were asked, before any other argument. If the CEO asked three questions, the " +
      "first paragraphs must contain three answers, each recognisable as the answer to one " +
      "of them. An answer the CEO has to hunt for is a question left unanswered.",
    "- Say what CHANGED from the returned document and what deliberately did not, and why. " +
      "A revision that quietly rewrites everything is as useless as one that changes nothing.",
    "- Where the questions found a real hole, the document must move — new conditions, a " +
      "different cost, a narrower scope, or a withdrawal. Do not defend the previous " +
      "document for the sake of consistency.",
    "- This is a COMPLETE document, not a diff: the CEO must be able to decide from it " +
      "alone, so title, summary, alternatives, cost and risks are all restated in full.",
    "",
    ...disagreementBlock(roleIds),
    "",
    ...synthesisLanguageBlock("the CEO's questions"),
    "",
    ...synthesisGroundingBlock(),
    "",
    ...proposalOutputBlock(
      "2-4 paragraphs, separated by blank lines; the first paragraphs answer the CEO's " +
        "questions one by one, then the argument",
    ),
  ].join("\n");

  const user = [
    profileBlock(profile),
    "",
    "WHAT THE BOARD WAS ASKED",
    question,
    "",
    "THE RETURNED PROPOSAL (what the CEO read before asking)",
    formatSubmittedDocument(original, entries.map((e) => e.role)),
    "",
    "THE CEO'S QUESTIONS ON RETURNING IT",
    note,
    "",
    "REVISED POSITIONS (written independently, blind to each other)",
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
