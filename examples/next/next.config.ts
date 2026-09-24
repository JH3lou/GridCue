import type { NextConfig } from "next";

const config: NextConfig = {
  // The fixtures package ships TypeScript source inside this monorepo.
  transpilePackages: ["@gridcue-internal/wealth-fixtures"],
};

export default config;
