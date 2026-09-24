import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/components\/gridcue\/(.*)$/, replacement: fileURLToPath(new URL("./registry/gridcue/$1", import.meta.url)) },
      { find: /^@\/(.*)$/, replacement: fileURLToPath(new URL("./src/$1", import.meta.url)) },
    ],
  },
  test: { name: "registry", environment: "jsdom" },
});
