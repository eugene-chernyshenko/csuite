/**
 * Environment loading.
 *
 * One `.env` at the repo root serves the whole monorepo — the server is run
 * both from `server/` (`npm run dev -w server` sets that cwd) and, in practice,
 * from the repo root, so we probe both. First file to define a key wins;
 * a real process environment variable always beats a file.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url)); // server/src
const repoRoot = path.resolve(here, "..", ".."); // <repo>

const candidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(repoRoot, ".env"),
  path.resolve(here, "..", ".env"), // server/.env, if someone insists
];

for (const file of [...new Set(candidates)]) {
  if (existsSync(file)) loadDotenv({ path: file, quiet: true });
}

function optional(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export const env = {
  /** Postgres connection string. Defaults to the docker-compose dev database. */
  DATABASE_URL:
    optional("DATABASE_URL") ?? "postgres://csuite:csuite@localhost:5432/csuite",

  /**
   * OpenRouter key — every LLM call in the platform goes through OpenRouter
   * (docs/en/ARCHITECTURE.md). Absent means the board runs offline; see
   * src/board/run.ts.
   */
  OPENROUTER_API_KEY: optional("OPENROUTER_API_KEY"),

  PORT: Number(optional("PORT") ?? 3001),
  HOST: optional("HOST") ?? "127.0.0.1",
  LOG_LEVEL: optional("LOG_LEVEL") ?? "info",
} as const;

export type Env = typeof env;
