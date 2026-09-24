import express from "express";
import { gridcueApi } from "./gridcue-api.ts";

const app = express();
const api = gridcueApi(process.env);
app.post("/api/gridcue", api.listener);
app.use(express.static("dist"));
const port = Number(process.env.PORT ?? 4173);
app.listen(port, () => console.log(`GridCue Vite example on http://localhost:${port} (provider: ${api.providerName})`));
