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
