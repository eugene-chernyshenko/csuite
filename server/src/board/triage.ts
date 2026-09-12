/**
 * Clarification triage — the Chief of Staff's gate in front of the board.
 *
 * The CEO asks a question. Before three C-level agents spend N+1 model calls
 * arguing about it, one cheap call asks the role whose mandate *is* the CEO's
 * attention: can the board answer this as asked, or is something missing that
 * only the CEO can supply?
 *
 * Two properties make this safe to put in the hot path:
 *
 *  - **It is cheap.** One call, `TRIAGE_MAX_TOKENS` out, at temperature 0.2,
 *    with the same one-shot JSON repair everything else gets and no loop.
 *    Against a deliberation it is noise; against a deliberation the CEO would
 *    have thrown away it is a saving.
 *  - **It never blocks.** Any failure — bad JSON twice, a dead route, a
 *    timeout, a registry that will not list tools — resolves to *proceed*. The
 *    board is the product; triage is a courtesy, and a broken courtesy must
 *    cost nothing but a warning in the log.
 *
 * A company with no `staff` role never calls this at all.
 */

import type { Role } from "@csuite/contract";
import { chatJson } from "./json";
import type { ChatUsage, FetchLike } from "./openrouter";
import {
  buildTriageMessages,
  MAX_CLARIFYING_QUESTIONS,
  TRIAGE_MAX_TOKENS,
  TRIAGE_TEMPERATURE,
  type CompanyProfile,
} from "./prompts";
import { triageResponseSchema } from "./schemas";

export interface TriageVerdict {
  /** True: send the question to the board now. False: ask the CEO first. */
  proceed: boolean;
  /** Non-empty only when `proceed` is false. Capped at three. */
  questions: string[];
  /**
   * Set when triage did not work and the run is proceeding by default. The
   * runner turns it into a warn worklog — a degraded gate must be visible.
   */
  warning?: string;
}

export interface TriageOptions {
  apiKey: string;
  model: string;
  profile: CompanyProfile;
  /** The Chief of Staff. */
  cos: Role;
  question: string;
  /** Names of the context tools the board will have — what NOT to ask the CEO. */
  toolNames?: readonly string[] | undefined;
  fetchImpl?: FetchLike | undefined;
  /** The triage call's usage joins the run's spend line like any other call. */
  usageSink?: ChatUsage[] | undefined;
  log?: { warn(msg: string): void } | undefined;
}

/**
 * One triage call. Never throws: the verdict on a broken call is "proceed".
 */
export async function triageQuestion(opts: TriageOptions): Promise<TriageVerdict> {
  try {
    const answer = await chatJson({
      apiKey: opts.apiKey,
      model: opts.model,
      messages: buildTriageMessages({
        profile: opts.profile,
        cos: opts.cos,
        question: opts.question,
        toolNames: opts.toolNames,
      }),
      schema: triageResponseSchema,
      maxTokens: TRIAGE_MAX_TOKENS,
      temperature: TRIAGE_TEMPERATURE,
      fetchImpl: opts.fetchImpl,
      usageSink: opts.usageSink,
      label: `triage(${opts.cos.id})`,
      log: opts.log,
    });

    const questions = answer.questions
      .map((q) => q.trim())
      .filter((q) => q !== "")
      .slice(0, MAX_CLARIFYING_QUESTIONS);

    // "Do not proceed" with nothing to ask is not a hold, it is a malformed
    // verdict — and a hold nobody can answer would strand the run forever.
    if (answer.proceed || questions.length === 0) return { proceed: true, questions: [] };
    return { proceed: false, questions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.log?.warn(`[board] triage failed (role=${opts.cos.id}): ${message}; proceeding`);
    return {
      proceed: true,
      questions: [],
      warning:
        "Clarification triage failed, so the question went to the board unchecked — " +
        `${message}`,
    };
  }
}

/**
 * The id of a clarification round: derived from the `question_asked` event it
 * triaged, so the pair is joinable in the log and the id is stable if the same
 * question is somehow triaged twice.
 */
export function makeClarificationId(questionEventId: string): string {
  return `clar-${questionEventId}`;
}
