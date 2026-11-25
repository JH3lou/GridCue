import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The Site's own tests. The aliases match tsconfig.json's paths.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\/components\/gridcue\/(.*)$/,
        replacement: fileURLToPath(new URL("../../registry/registry/gridcue/$1", import.meta.url)),
      },
      { find: /^@\/(.*)$/, replacement: fileURLToPath(new URL("./app/$1", import.meta.url)) },
    ],
  },
  test: { name: "site", include: ["test/**/*.test.ts"] },
});
