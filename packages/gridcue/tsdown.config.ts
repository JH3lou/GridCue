import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react/index.ts",
    mock: "src/mock/index.ts",
    server: "src/server/index.ts",
    "server-browser": "src/server/browser.ts",
    "tanstack-table": "src/tanstack/index.ts",
    testing: "src/testing/index.ts",
    "ag-grid": "src/ag-grid/index.ts",
  },
  format: "esm",
  platform: "neutral",
  // Declarations come from the sources alone. With the tests in the project, TypeScript 7 also writes a declaration
  // beside any file a test imports from outside the package, such as the Next.js example's Data Query.
  dts: { tsconfig: "tsconfig.build.json" },
  clean: true,
  copy: [{ from: "src/react/styles.css", to: "dist" }],
});
