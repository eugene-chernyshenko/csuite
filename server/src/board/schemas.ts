/**
 * What the board's models are allowed to hand back.
 *
 * These are *response* schemas, not contract shapes: the contract (`Position`,
 * `Proposal`) is frozen and lives in `@csuite/contract`. A model answers in the
 * shape below, and run.ts is what turns that into contract entities — notably
 * `assumptions`, which the contract has no field for and which is folded into
 * `keyPoints` as "Assumes: …" lines.
 */

import { z } from "zod";

const sentence = z.string().trim().min(1);

export const positionResponseSchema = z.object({
  stance: z.enum(["support", "support_with_conditions", "object"]),
  summary: sentence,
  /*
   * The prompt asks for 2–4 key points. The ceiling here is looser than the
   * ask on purpose: a fifth bullet is not worth a repair call (cost
   * discipline), a single bullet is not a position.
   */
  keyPoints: z.array(sentence).min(2).max(6),
  /**
   * Provenance v0: every figure the model could not ground in the company
   * profile, stated as the assumption it is. An empty list is a valid answer —
   * a position that used no ungrounded numbers.
   */
  assumptions: z.array(sentence).max(12).default([]),
});

export type PositionResponse = z.infer<typeof positionResponseSchema>;

/**
 * The Chief of Staff's triage verdict on a question: send it to the board, or
 * ask the CEO first.
 *
 * `questions` is allowed up to six here and cut to `MAX_CLARIFYING_QUESTIONS`
 * by the runner — for the same reason `positionResponseSchema` tolerates a
 * fifth key point: a model that asked one question too many is not worth a
 * repair call (cost discipline), it is worth a `slice`.
 */
export const triageResponseSchema = z.object({
  proceed: z.boolean(),
  questions: z.array(sentence).max(6).default([]),
});

export type TriageResponse = z.infer<typeof triageResponseSchema>;

export const disagreementResponseSchema = z.object({
  topic: sentence,
  /** Role ids of the conflicting parties — at least two, or it is not a conflict. */
  roleIds: z.array(sentence).min(2).max(6),
  detail: sentence,
});

export const proposalResponseSchema = z.object({
  title: sentence,
  summary: sentence,
  rationale: sentence,
  alternatives: z.array(sentence).min(1).max(5),
  cost: z.object({
    amount: z.number().finite().nonnegative(),
    note: z.string(),
  }),
  risks: z.array(sentence).min(1).max(6),
  /** Empty is the right answer when the board genuinely agrees. */
  disagreements: z.array(disagreementResponseSchema).max(5).default([]),
});

export type ProposalResponse = z.infer<typeof proposalResponseSchema>;
