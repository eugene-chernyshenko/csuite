import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // No Postgres, no network: every test runs against the in-memory store or
    // pure functions. `npm test` must stay runnable on a laptop with nothing up.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
