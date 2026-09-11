/**
 * Request-body schemas. Every body on every route goes through one of these —
 * the API is the platform's "labor code in executable form" and it never
 * accepts an unvalidated write into the log.
 */

import { z } from "zod";

const idSchema = z.string().min(1);

const roleSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["ceo", "board", "lead", "worker"]),
  departmentId: idSchema.optional(),
  mandate: z.string().min(1),
  model: z.string().optional(),
});

const departmentSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
});

/** Mirrors CompanyConfig from @csuite/contract. */
export const companyConfigSchema = z.object({
  name: z.string().min(1),
  product: z.string().min(1),
  monthlyBudget: z.number().nonnegative(),
  currency: z.literal("USD"),
  departments: z.array(departmentSchema),
  roles: z.array(roleSchema),
});

export const createCompanySchema = z.object({
  id: idSchema.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "id must be url-safe").optional(),
  config: companyConfigSchema,
});

export const askQuestionSchema = z.object({
  text: z.string().min(1, "A question needs text").max(8000),
  /** Defaults to the human CEO — who is a user, never an agent. */
  byRoleId: idSchema.optional(),
  /** Position-prompt harness for this run; defaults to baseline. */
  harness: z.enum(["baseline", "adversarial"]).optional(),
});

export const decisionSchema = z.object({
  decision: z.enum(["approved", "returned", "rejected"]),
  note: z.string().max(8000).optional(),
});

export const resolveEscalationSchema = z.object({
  resolution: z.string().min(1, "A resolution needs text").max(8000),
});

export const listEventsQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
});

export type CreateCompanyBody = z.infer<typeof createCompanySchema>;
export type AskQuestionBody = z.infer<typeof askQuestionSchema>;
export type DecisionBody = z.infer<typeof decisionSchema>;
export type ResolveEscalationBody = z.infer<typeof resolveEscalationSchema>;
