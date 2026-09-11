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

/** A positive integer from the environment, or the default when unset/nonsense. */
function positiveInt(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
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

  /**
   * Default model for board agents. A role's own `model` wins when it names an
   * OpenRouter id; this is the fallback, and it is deliberately cheap.
   */
  OPENROUTER_MODEL: optional("OPENROUTER_MODEL"),

  /**
   * Per-call token ceilings for a board run. Every call is capped — that part
   * is not negotiable — but the caps themselves are a tuning knob: the default
   * model is cheap, and a position that stops mid-argument is worse than a
   * slightly larger bill. Raise them to give the board more room.
   */
  BOARD_POSITION_MAX_TOKENS: positiveInt("BOARD_POSITION_MAX_TOKENS", 2000),
  BOARD_SYNTHESIS_MAX_TOKENS: positiveInt("BOARD_SYNTHESIS_MAX_TOKENS", 4000),

  PORT: Number(optional("PORT") ?? 3001),
  HOST: optional("HOST") ?? "127.0.0.1",
  LOG_LEVEL: optional("LOG_LEVEL") ?? "info",
} as const;

export type Env = typeof env;
