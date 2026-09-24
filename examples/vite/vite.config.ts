import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { gridcueApi } from "./gridcue-api.ts";

/** Mounts GridCue's Server Handler at /api/gridcue in `vite dev` and `vite preview`. */
const gridcue = (env: Record<string, string>): Plugin => {
  const api = gridcueApi(env);
  const mount = (server: { middlewares: { use(path: string, fn: typeof api.listener): unknown } }): void => {
    server.middlewares.use("/api/gridcue", api.listener);
  };
  return { name: "gridcue-api", configureServer: mount, configurePreviewServer: mount };
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), gridcue(loadEnv(mode, process.cwd(), ""))],
  resolve: {
    alias: [
      {
        find: /^@\/components\/gridcue\/(.*)$/,
        replacement: fileURLToPath(new URL("../../registry/registry/gridcue/$1", import.meta.url)),
      },
      { find: /^@\/(.*)$/, replacement: fileURLToPath(new URL("./src/$1", import.meta.url)) },
    ],
  },
}));
