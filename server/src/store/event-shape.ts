/**
 * Minimal shape validation and row (de)serialization for log events.
 *
 * "Minimal" is the point: the log accepts any event whose *envelope* is valid
 * (known contract `type`, string `id`, numeric `ts`) and stores the rest of the
 * body verbatim. Per-type payload rules belong at the API boundary where the
 * caller can be told what they got wrong — not in the log, which must stay
 * able to replay everything it ever accepted.
 */

import { z } from "zod";
import type { CompanyEvent, CompanyEventType } from "@csuite/contract";
import type { NewEvent, StoredEvent } from "./types";

const EVENT_TYPES = [
  "day_started",
  "worklog",
  "question_asked",
  "message_sent",
  "drafting_started",
  "position_submitted",
  "disagreement_recorded",
  "proposal_submitted",
  "ceo_decision",
  "clarification_requested",
  "clarification_answered",
  "tasks_created",
  "task_status_changed",
  "report_submitted",
  "escalation_raised",
  "escalation_resolved",
  "budget_spent",
  "document_created",
  "document_updated",
  "document_superseded",
  "context_consulted",
  "day_ended",
] as const satisfies readonly CompanyEventType[];

// Fails to compile if a new event type is added to the contract union and not
// mirrored above — the log must know every type it is asked to store.
type Unlisted = Exclude<CompanyEventType, (typeof EVENT_TYPES)[number]>;
const _exhaustive: Unlisted extends never ? true : never = true;
void _exhaustive;

export class InvalidEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEventError";
  }
}

const envelopeSchema = z
  .object({
    id: z.string().min(1).optional(),
    ts: z.number().finite().optional(),
    type: z.enum(EVENT_TYPES),
  })
  .loose();

/** Validates the envelope and fills in a server `id`/`ts` when the caller omitted them. */
export function normalizeEvent(input: NewEvent, now: number = Date.now()): CompanyEvent {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "event";
    throw new InvalidEventError(`Invalid event: ${where}: ${issue?.message ?? "bad shape"}`);
  }
  const { id, ts, ...rest } = parsed.data;
  return {
    ...rest,
    id: id ?? crypto.randomUUID(),
    // Server streams measure the company timeline in epoch milliseconds.
    ts: ts ?? now,
  } as CompanyEvent;
}

export interface EventRowParts {
  id: string;
  ts: number;
  type: CompanyEventType;
  payload: Record<string, unknown>;
}

/** Splits an event into its indexed columns plus an opaque body. */
export function toRowParts(ev: CompanyEvent): EventRowParts {
  const { id, ts, type, ...payload } = ev;
  return { id, ts, type, payload: payload as Record<string, unknown> };
}

/** The inverse of {@link toRowParts}, plus the append order. */
export function fromRowParts(parts: EventRowParts & { seq: number }): StoredEvent {
  const { seq, id, ts, type, payload } = parts;
  return { ...payload, id, ts, type, seq } as StoredEvent;
}
