/**
 * The platform API client — the whole transport surface of live mode.
 *
 * Thin on purpose: every call returns the server's JSON and throws
 * {@link ApiRequestError} on anything else, so `live.tsx` can decide what a
 * 409 or a dropped connection *means* without this file having an opinion.
 * Nothing here derives state; that is the shared reducer's job, which is the
 * point of live mode (same fold on both sides of the wire).
 */

import type { CeoDecision, CompanyConfig, CompanyEvent, Id } from "@csuite/contract";

/**
 * Base URL of the platform server. Read at module scope because Next inlines
 * `NEXT_PUBLIC_*` at build time — there is no runtime environment in a browser.
 */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
).replace(/\/+$/, "");

/** The default company live mode opens. Overridable with `?company=`. */
export const DEFAULT_COMPANY_ID = process.env.NEXT_PUBLIC_COMPANY_ID ?? "brightpage-v2";

/** A contract event as the log stores it: the event plus its append order. */
export type StoredEvent = CompanyEvent & { seq: number };

export interface CompanyRecord {
  id: string;
  config: CompanyConfig;
  createdAt: string;
}

export interface EventsPage {
  companyId: string;
  events: StoredEvent[];
  /** Cursor for the next poll. */
  lastSeq: number;
}

export interface Health {
  ok: boolean;
  /** "online" only when the server has an OpenRouter key configured. */
  board: "online" | "offline";
  model: string;
}

export class ApiRequestError extends Error {
  /** HTTP status, or 0 when the request never reached a server. */
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
  /** True when the server was unreachable, as opposed to unhappy. */
  get offline(): boolean {
    return this.status === 0;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
    });
  } catch (err) {
    // No response at all: server down, wrong port, DNS, CORS preflight refused.
    throw new ApiRequestError(0, err instanceof Error ? err.message : "Network error");
  }

  if (!res.ok) {
    // The API answers every failure as `{ error: { message } }` (api/errors.ts);
    // fall back to the status line if we got something else entirely.
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* keep the status line */
    }
    throw new ApiRequestError(res.status, message);
  }

  return (await res.json()) as T;
}

export function getHealth(signal?: AbortSignal): Promise<Health> {
  return request<Health>("/api/health", signal ? { signal } : undefined);
}

export async function getCompany(companyId: string, signal?: AbortSignal): Promise<CompanyRecord> {
  const body = await request<{ company: CompanyRecord }>(
    `/api/companies/${encodeURIComponent(companyId)}`,
    signal ? { signal } : undefined,
  );
  return body.company;
}

/** Events with `seq > after`, oldest first. Omit `after` for the whole log. */
export function getEvents(
  companyId: string,
  after?: number,
  signal?: AbortSignal,
): Promise<EventsPage> {
  const query = after !== undefined && after > 0 ? `?after=${after}` : "";
  return request<EventsPage>(
    `/api/companies/${encodeURIComponent(companyId)}/events${query}`,
    signal ? { signal } : undefined,
  );
}

/**
 * Puts a strategic question to the board. Returns as soon as the question is in
 * the log (202) — the deliberation itself reports back through the event
 * stream, which is the only channel it has.
 */
export function askQuestion(
  companyId: string,
  text: string,
): Promise<{ questionEventSeq: number; event: StoredEvent }> {
  return request(`/api/companies/${encodeURIComponent(companyId)}/questions`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

/** Records the CEO's decision. 409 when the proposal is no longer pending. */
export function postDecision(
  companyId: string,
  proposalId: Id,
  decision: CeoDecision,
  note?: string,
): Promise<{ seq: number; event: StoredEvent }> {
  return request(
    `/api/companies/${encodeURIComponent(companyId)}/proposals/${encodeURIComponent(proposalId)}/decision`,
    {
      method: "POST",
      body: JSON.stringify(note === undefined ? { decision } : { decision, note }),
    },
  );
}

/** Settles an open escalation. 409 when it was already settled. */
export function postEscalationResolution(
  companyId: string,
  escalationId: Id,
  resolution: string,
): Promise<{ seq: number; event: StoredEvent }> {
  return request(
    `/api/companies/${encodeURIComponent(companyId)}/escalations/${encodeURIComponent(escalationId)}/resolve`,
    { method: "POST", body: JSON.stringify({ resolution }) },
  );
}
