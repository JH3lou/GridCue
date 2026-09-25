import { writeFileSync } from "node:fs";
import { wealthInitialState, wealthMockOptions, wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { createGridCue, createRowsAdapter, type IntentProvider } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { createJevProvider, DEFAULT_JEV_MODEL, type JevClient } from "gridcue/server";

// Records the same requests under Jev's two strategies and the Mock Provider, for the Site's "Compare strategies"
// tab (Site spec §5.3). The Site never calls Jev; it shows this file. Run it locally with a key in .env.local:
//   pnpm eval:record
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "apps/site/app/data/strategy-runs.json";
if (!process.env.JEV_API_KEY) {
  console.log("JEV_API_KEY is not set. Put it in .env.local to record live runs.");
  process.exit(1);
}

// Chosen to show where the strategies differ: compound requests, nesting, "also", and the declined cases.
const REQUESTS = [
  "Roth IRAs grouped by rep",
  "Taxable accounts over $1M, sort by concentration, highest first",
  "Show me the retirement accounts",
  "Biggest accounts first",
  "Group by custodian, then by advisor",
  "Also sort by market value",
  "Accounts excluding trusts, largest first",
  "Sort by gains for trusts",
  "Hide custodian and account number",
  "Largest households first",
  "Sell anything over 10%",
  "What's the total market value?",
];

let questions = 0;
const real = new TypeSafeClient({ apiKey: process.env.JEV_API_KEY, logLevel: "off" });
const client: JevClient = {
  systemOne: (req, opts) => {
    questions = Object.keys(req.questions).length;
    return real.systemOne(req as never, opts);
  },
};
const PROVIDERS: Array<["focused" | "fan-out" | "mock", IntentProvider]> = [
  ["focused", createJevProvider({ client, strategy: "focused" })],
  ["fan-out", createJevProvider({ client, strategy: "fan-out" })],
  ["mock", createMockProvider(wealthMockOptions)],
];

const requests = [];
for (const utterance of REQUESTS) {
  const runs = [];
  for (const [strategy, provider] of PROVIDERS) {
    questions = 0;
    const cue = createGridCue({ adapter: createRowsAdapter({ schema: wealthSchema, initialState: wealthInitialState }), provider });
    const started = Date.now();
    await cue.propose(utterance);
    const latencyMs = Date.now() - started;
    const state = cue.getState();
    runs.push({
      strategy,
      status: state.status,
      preview: state.preview?.lines ?? [],
      ...(state.message ? { message: state.message } : {}),
      ...(strategy === "mock" ? {} : { questions, latencyMs }),
    });
  }
  requests.push({ utterance, runs });
  console.log(`${utterance}: ${runs.map((r) => `${r.strategy} ${r.status}`).join(", ")}`);
}

const recordedAt = new Date().toISOString().slice(0, 10);
writeFileSync(out, `${JSON.stringify({ recordedAt, model: DEFAULT_JEV_MODEL, requests }, null, 2)}\n`);
console.log(`Wrote ${out}`);
