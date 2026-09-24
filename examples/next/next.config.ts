import type { NextConfig } from "next";

// Env files live at the repo root, shared with the Vite example, evals, and live tests.
// Variables already set in the shell take precedence.
try {
  process.loadEnvFile(new URL("../../.env.local", import.meta.url));
} catch {
  // No root .env.local: the route falls back to the Mock Provider.
}

const config: NextConfig = {
  // The fixtures package ships TypeScript source inside this monorepo.
  transpilePackages: ["@gridcue-internal/wealth-fixtures"],
};

export default config;
