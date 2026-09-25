import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [fumadocsMdx(), tailwindcss(), reactRouter()],
  // Pre-bundle the demo's dependencies in the first pass. Discovered late, radix-ui was bundled in a second pass that
  // referenced a stale react/jsx-runtime chunk.
  optimizeDeps: {
    include: ["radix-ui", "@tanstack/react-table", "class-variance-authority", "cn", "lucide-react", "react/jsx-runtime"],
  },
  resolve: {
    alias: [
      // The registry components live in the monorepo's registry/, and import each other as @/components/gridcue/*.
      {
        find: /^@\/components\/gridcue\/(.*)$/,
        replacement: fileURLToPath(new URL("../../registry/registry/gridcue/$1", import.meta.url)),
      },
      { find: /^@\/(.*)$/, replacement: fileURLToPath(new URL("./app/$1", import.meta.url)) },
    ],
  },
});
