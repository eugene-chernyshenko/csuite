import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { registerErrorHandler } from "./api/errors";
import { libraryRoutes } from "./api/library-routes";
import { apiRoutes, type ApiDeps } from "./api/routes";
import {
  createLibraryService,
  eventSourcedLibraryStore,
  type LibraryService,
} from "./library";

export interface BuildAppOptions extends ApiDeps {
  /**
   * The company library. Production passes one backed by the Postgres
   * projection (event + row in one transaction, FTS search); when it is
   * omitted the app falls back to reading the library straight out of the
   * event log, which is what the tests use.
   */
  library?: LibraryService;
  logger?: boolean | { level?: string };
}

/**
 * Builds the Fastify app around an injected store, so the same routes can be
 * exercised over Postgres in production and over the in-memory fake in tests.
 */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  /*
   * CORS, dev-permissive on purpose.
   *
   * This is a local, single-tenant dev server: the web app runs on
   * localhost:3000 and talks to this one on localhost:3001, and the only
   * caller is the CEO sitting in front of both. Allowing every origin keeps
   * that setup zero-config.
   *
   * SaaS hardens this: once companies belong to tenants and requests carry
   * credentials, `origin` becomes an allow-list from configuration, and
   * `credentials: true` is only safe with it. Do not ship this as-is.
   */
  await app.register(cors, { origin: true });

  registerErrorHandler(app);
  const library =
    opts.library ?? createLibraryService({ library: eventSourcedLibraryStore(opts.store) });
  await app.register(
    apiRoutes({
      store: opts.store,
      library,
      openrouterApiKey: opts.openrouterApiKey,
      openrouterModel: opts.openrouterModel,
      boardPositionMaxTokens: opts.boardPositionMaxTokens,
      boardSynthesisMaxTokens: opts.boardSynthesisMaxTokens,
      boardMaxToolCalls: opts.boardMaxToolCalls,
    }),
    { prefix: "/api" },
  );

  await app.register(libraryRoutes({ store: opts.store, library }), { prefix: "/api" });

  return app;
}
