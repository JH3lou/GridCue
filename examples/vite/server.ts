import express from "express";
import { gridcueApi } from "./gridcue-api.ts";

// Like `pnpm dev`, read the repo-root .env.local; variables already set in the shell win.
try {
  process.loadEnvFile(new URL("../../.env.local", import.meta.url));
} catch {
  // No root .env.local: the example uses the Mock Provider.
}

const app = express();
const api = gridcueApi(process.env);
app.post("/api/gridcue", api.listener);
app.use(express.static("dist"));
const port = Number(process.env.PORT ?? 4173);
app.listen(port, () => console.log(`GridCue Vite example on http://localhost:${port} (provider: ${api.providerName})`));
