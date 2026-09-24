import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/gridcue", "evals", { test: { name: "live", root: "packages/gridcue", include: ["test/live/**/*.test.ts"] } }],
  },
});
