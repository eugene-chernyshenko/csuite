import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `@csuite/contract` ships TypeScript source (one definition of the v0
   * contract, shared with the server) — Next has to compile it like app code.
   */
  transpilePackages: ["@csuite/contract"],
};

export default nextConfig;
