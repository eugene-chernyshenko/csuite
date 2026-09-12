/**
 * The platform API (prefix `/api`).
 *
 * Reads are folds over the log; writes are appends to it. No handler mutates
 * derived state — if something is supposed to change, an event says so and the
 * reducer works out the consequences.
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { Id } from "@csuite/contract";
import { checkAnswerable, checkDecidable, checkResolvable } from "../domain/lifecycle";
import { DEFAULT_BOARD_MODEL, runBoard, runBoardRevision } from "../board/run";
import { createContextRegistry } from "../context/registry";
import { CompanyNotFoundError, type EventStore } from "../store/types";
import { ApiError } from "./errors";
import {
  answerClarificationSchema,
  askQuestionSchema,
  createCompanySchema,
  decisionSchema,
  listEventsQuerySchema,
  resolveEscalationSchema,
} from "./schemas";

export interface ApiDeps {
  store: EventStore;
  /** The library behind the board's library_* tools (FTS path in production). */
  library?: import("../library").LibraryService | undefined;
  openrouterApiKey?: string | undefined;
  /** Default board model; a role's own `model` overrides it. */
  openrouterModel?: string | undefined;
  /** Per-call token ceilings for a board run; defaults live in board/prompts.ts. */
  boardPositionMaxTokens?: number | undefined;
  boardSynthesisMaxTokens?: number | undefined;
  /** Context-tool calls one position may make; default lives in board/context-loop.ts. */
  boardMaxToolCalls?: number | undefined;
}

/** Role id attributed to the human CEO's own actions at the desk. */
const CEO_ROLE_ID = "ceo";

export function apiRoutes(deps: ApiDeps): FastifyPluginAsync {
  const { store } = deps;

  // One registry for the process: tool definitions are static, and the company
  // a call belongs to is an argument, never a binding (multi-tenant, CLAUDE.md).
  const context = createContextRegistry({ store, library: deps.library });

  async function requireCompany(companyId: string) {
    const company = await store.getCompany(companyId);
    if (!company) throw new CompanyNotFoundError(companyId);
    return company;
  }

  /** Everything a board run needs from the process, minus what the run is about. */
  function boardDeps(log: { warn(msg: string): void; info(msg: string): void }) {
    return {
      store,
      apiKey: deps.openrouterApiKey,
      model: deps.openrouterModel,
      positionMaxTokens: deps.boardPositionMaxTokens,
      synthesisMaxTokens: deps.boardSynthesisMaxTokens,
      // Company memory the board may consult while writing positions.
      context,
      maxToolCalls: deps.boardMaxToolCalls,
      log,
    };
  }

  return async (app: FastifyInstance) => {
    app.get("/health", async () => ({
      ok: true,
      board: deps.openrouterApiKey ? "online" : "offline",
      model: deps.openrouterModel ?? DEFAULT_BOARD_MODEL,
    }));

    // ---------------------------------------------------------- companies

    app.post("/companies", async (req, reply) => {
      const body = createCompanySchema.parse(req.body);
      const company = await store.createCompany({ id: body.id, config: body.config });
      // The log starts the moment the company does.
      await store.appendEvents(company.id, [{ type: "day_started" }]);
      return reply.status(201).send({ company });
    });

    app.get<{ Params: { id: string } }>("/companies/:id", async (req) => {
      return { company: await requireCompany(req.params.id) };
    });

    app.get<{ Params: { id: string } }>("/companies/:id/state", async (req) => {
      const company = await requireCompany(req.params.id);
      const state = await store.getState(company.id);
      return { companyId: company.id, config: company.config, state };
    });

    // -------------------------------------------------------------- events

    app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
      "/companies/:id/events",
      async (req) => {
        const company = await requireCompany(req.params.id);
        const { after } = listEventsQuerySchema.parse(req.query);
        const events = await store.listEvents(company.id, after);
        return {
          companyId: company.id,
          events,
          // Cursor for the next poll; SSE can replace this without changing shapes.
          lastSeq: events.length ? events[events.length - 1]!.seq : (after ?? 0),
        };
      },
    );

    // ----------------------------------------------------------- questions

    app.post<{ Params: { id: string } }>("/companies/:id/questions", async (req, reply) => {
      const company = await requireCompany(req.params.id);
      const body = askQuestionSchema.parse(req.body);
      const byRoleId: Id = body.byRoleId ?? CEO_ROLE_ID;

      const [event] = await store.appendEvents(company.id, [
        { type: "question_asked", text: body.text, byRoleId },
      ]);
      if (!event) throw new ApiError(500, "Failed to record the question");

      // Fire-and-forget: the board deliberates on its own clock and reports back
      // through the log, which is the only channel it has. The HTTP call must
      // not wait on it — a real deliberation takes minutes.
      void runBoard(
        company.id,
        body.text,
        {
          ...boardDeps({
            warn: (msg) => req.log.warn(msg),
            info: (msg) => req.log.info(msg),
          }),
          harness: body.harness,
        },
        // The run may not reach the board at all: with a Chief of Staff in the
        // company it is triaged first, and a triage that wants clarification
        // parks it against this very question event.
        { questionEventId: event.id, byRoleId },
      ).catch((err: unknown) => {
        req.log.error({ err }, "board run failed");
      });

      return reply.status(202).send({ questionEventSeq: event.seq, event });
    });

    // ------------------------------------------------------- clarifications

    /**
     * The CEO answers the Chief of Staff, and the parked board run restarts.
     *
     * Same fire-and-forget contract as the question path: the desk gets its
     * 201 immediately and the deliberation reports back through the log. The
     * run resumes on the ORIGINAL question text — the clarification carries it
     * — with the Q&A folded into every prompt as grounded fact.
     */
    app.post<{ Params: { id: string; clarificationId: string } }>(
      "/companies/:id/clarifications/:clarificationId/answer",
      async (req, reply) => {
        const company = await requireCompany(req.params.id);
        const body = answerClarificationSchema.parse(req.body);

        const state = await store.getState(company.id);
        const check = checkAnswerable(state, req.params.clarificationId);
        if (!check.ok) throw new ApiError(check.status, check.message);
        const clarification = check.value;

        const [event] = await store.appendEvents(company.id, [
          {
            type: "clarification_answered",
            clarificationId: clarification.id,
            answers: body.answers,
            byRoleId: CEO_ROLE_ID,
          },
        ]);
        if (!event) throw new ApiError(500, "Failed to record the answer");

        void runBoard(
          company.id,
          clarification.questionText,
          boardDeps({
            warn: (msg) => req.log.warn(msg),
            info: (msg) => req.log.info(msg),
          }),
          {
            byRoleId: clarification.byRoleId,
            // Carrying the answers is also what stops the resumed run from
            // being triaged a second time — one round, by construction.
            clarification: { questions: clarification.questions, answers: body.answers },
          },
        ).catch((err: unknown) => {
          req.log.error({ err }, "board run failed after clarification");
        });

        const next = await store.getState(company.id);
        return reply.status(201).send({
          seq: event.seq,
          event,
          clarification: next.clarifications[clarification.id],
        });
      },
    );

    // ----------------------------------------------------- decision gate

    app.post<{ Params: { id: string; proposalId: string } }>(
      "/companies/:id/proposals/:proposalId/decision",
      async (req, reply) => {
        const company = await requireCompany(req.params.id);
        const body = decisionSchema.parse(req.body);

        const state = await store.getState(company.id);
        const check = checkDecidable(state, req.params.proposalId);
        if (!check.ok) throw new ApiError(check.status, check.message);

        const [event] = await store.appendEvents(company.id, [
          {
            type: "ceo_decision",
            proposalId: req.params.proposalId,
            decision: body.decision,
            ...(body.note === undefined ? {} : { note: body.note }),
          },
        ]);
        if (!event) throw new ApiError(500, "Failed to record the decision");

        // A return WITH questions sends the board back to work: same
        // fire-and-forget contract as the question path — the desk does not
        // wait, and the revision reports back through the log. A return with
        // no note is the legacy shape and asks nothing, so nothing happens.
        if (body.decision === "returned" && (body.note ?? "").trim() !== "") {
          void runBoardRevision(
            company.id,
            req.params.proposalId,
            boardDeps({
              warn: (msg) => req.log.warn(msg),
              info: (msg) => req.log.info(msg),
            }),
          ).catch((err: unknown) => {
            req.log.error({ err }, "board revision run failed");
          });
        }

        const next = await store.getState(company.id);
        return reply.status(201).send({
          seq: event.seq,
          event,
          proposal: next.proposals[req.params.proposalId],
        });
      },
    );

    // ---------------------------------------------------------- escalations

    app.post<{ Params: { id: string; escalationId: string } }>(
      "/companies/:id/escalations/:escalationId/resolve",
      async (req, reply) => {
        const company = await requireCompany(req.params.id);
        const body = resolveEscalationSchema.parse(req.body);

        const state = await store.getState(company.id);
        const check = checkResolvable(state, req.params.escalationId);
        if (!check.ok) throw new ApiError(check.status, check.message);

        const [event] = await store.appendEvents(company.id, [
          {
            type: "escalation_resolved",
            escalationId: req.params.escalationId,
            resolution: body.resolution,
          },
        ]);
        if (!event) throw new ApiError(500, "Failed to record the resolution");

        const next = await store.getState(company.id);
        return reply.status(201).send({
          seq: event.seq,
          event,
          escalation: next.escalations[req.params.escalationId],
        });
      },
    );
  };
}
