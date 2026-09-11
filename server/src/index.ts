/**
 * Entry point: wire the real (Postgres-backed) store into the API and listen.
 */

import { env } from "./env";
import { buildApp } from "./app";
import { DEFAULT_BOARD_MODEL } from "./board/run";
import { createDb } from "./db/client";
import { pgEventStore } from "./store/pg";

async function main(): Promise<void> {
  const { db, pool } = createDb();
  const store = pgEventStore(db);

  const app = await buildApp({
    store,
    openrouterApiKey: env.OPENROUTER_API_KEY,
    openrouterModel: env.OPENROUTER_MODEL,
    boardPositionMaxTokens: env.BOARD_POSITION_MAX_TOKENS,
    boardSynthesisMaxTokens: env.BOARD_SYNTHESIS_MAX_TOKENS,
    logger: { level: env.LOG_LEVEL },
  });

  if (env.OPENROUTER_API_KEY) {
    app.log.info(
      `Board is ONLINE via OpenRouter; default model ${env.OPENROUTER_MODEL ?? DEFAULT_BOARD_MODEL}, ` +
        `max_tokens ${env.BOARD_POSITION_MAX_TOKENS} per position / ${env.BOARD_SYNTHESIS_MAX_TOKENS} for synthesis`,
    );
  } else {
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
