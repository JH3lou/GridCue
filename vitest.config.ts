import { defineConfig } from "vitest/config";

// Only `pnpm test:live` loads .env.local, so `pnpm test` never needs a secret or the network.
// Variables already set in the shell take precedence.
export default defineConfig(({ mode }) => {
  if (mode === "live") {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // No .env.local: live tests skip unless JEV_API_KEY is set in the shell.
    }
  }
  return {
    test: {
      projects: [
        "packages/gridcue",
        "registry",
        "evals",
        "apps/site",
        // The Next.js example's Data Query, run through the Query Check.
        { test: { name: "example-next", root: "examples/next", include: ["app/**/*.test.ts"] } },
        { test: { name: "live", root: "packages/gridcue", include: ["test/live/**/*.test.ts"] } },
      ],
    },
  };
});
