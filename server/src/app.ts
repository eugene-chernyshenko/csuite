import Fastify, { type FastifyInstance } from "fastify";
import { registerErrorHandler } from "./api/errors";
import { apiRoutes, type ApiDeps } from "./api/routes";

export interface BuildAppOptions extends ApiDeps {
  logger?: boolean | { level?: string };
}

/**
 * Builds the Fastify app around an injected store, so the same routes can be
 * exercised over Postgres in production and over the in-memory fake in tests.
 */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  registerErrorHandler(app);
  await app.register(
    apiRoutes({ store: opts.store, openrouterApiKey: opts.openrouterApiKey }),
    { prefix: "/api" },
  );

  return app;
}
