import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    mock: "src/mock/index.ts",
  },
  format: "esm",
  platform: "neutral",
  dts: true,
  clean: true,
});
