/**
 * Entry point: wire the real (Postgres-backed) store into the API and listen.
 */

import { env } from "./env";
import { buildApp } from "./app";
import { createDb } from "./db/client";
import { pgEventStore } from "./store/pg";

async function main(): Promise<void> {
  const { db, pool } = createDb();
  const store = pgEventStore(db);

  const app = await buildApp({
    store,
    openrouterApiKey: env.OPENROUTER_API_KEY,
    logger: { level: env.LOG_LEVEL },
  });

  if (!env.OPENROUTER_API_KEY) {
    app.log.warn(
      "OPENROUTER_API_KEY is not set — the board is OFFLINE. Questions will be logged " +
        "but produce no positions and no proposals.",
    );
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void (async () => {
        app.log.info(`${signal} received, shutting down`);
        await app.close();
        await pool.end();
        process.exit(0);
      })();
    });
  }

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
