/**
 * One error shape for the whole API: `{ error: { message } }`.
 *
 * Route handlers signal failure by throwing `ApiError`; the handler below maps
 * store errors and zod failures onto the same shape so clients never have to
 * special-case where a rejection came from.
 */

import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { CompanyExistsError, CompanyNotFoundError } from "../store/types";
import { InvalidEventError } from "../store/event-shape";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function zodMessage(err: ZodError): string {
  return err.issues
    .map((i) => {
      const where = i.path.join(".");
      return where ? `${where}: ${i.message}` : i.message;
    })
    .join("; ");
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { message: `No route for ${req.method} ${req.url}` } });
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { message: err.message } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { message: zodMessage(err) } });
    }
    if (err instanceof InvalidEventError) {
      return reply.status(400).send({ error: { message: err.message } });
    }
    if (err instanceof CompanyNotFoundError) {
      return reply.status(404).send({ error: { message: err.message } });
    }
    if (err instanceof CompanyExistsError) {
      return reply.status(409).send({ error: { message: err.message } });
    }
    // Fastify's own errors (malformed JSON, payload too large, ...) carry a status.
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, "unhandled error");
      return reply.status(status).send({ error: { message: "Internal server error" } });
    }
    const message = err instanceof Error ? err.message : "Request failed";
    return reply.status(status).send({ error: { message } });
  });
}
