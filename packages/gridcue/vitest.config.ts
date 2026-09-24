import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "gridcue", exclude: ["test/live/**", "**/node_modules/**"] },
});
