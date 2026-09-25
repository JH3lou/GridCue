import { writeFileSync } from "node:fs";
import { wealthInitialState, wealthMockOptions, wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { createGridCue, createRowsAdapter, type IntentProvider, type ViewState } from "gridcue";
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

// Chosen to show where the strategies differ: compound requests, nesting, "also", and the declined cases. A request
// that builds on the current view starts from one, described for the reader.
const REQUESTS: Array<{ utterance: string; start?: { view: Partial<ViewState>; description: string } }> = [
  { utterance: "Roth IRAs grouped by rep" },
  { utterance: "Taxable accounts over $1M, sort by concentration, highest first" },
  { utterance: "Show me the retirement accounts" },
  { utterance: "Biggest accounts first" },
  { utterance: "Group by custodian, then by advisor" },
  {
    utterance: "Also sort by market value",
    start: { view: { sorts: [{ columnId: "advisor_name", direction: "asc" }] }, description: "sorted by Advisor" },
  },
  {
    utterance: "Also group by advisor",
    start: { view: { groupBy: ["custodian"] }, description: "grouped by Custodian" },
  },
  { utterance: "Accounts excluding trusts, largest first" },
  { utterance: "Sort by gains for trusts" },
  { utterance: "Hide custodian and account number" },
  { utterance: "Largest households first" },
  { utterance: "Sell anything over 10%" },
  { utterance: "What's the total market value?" },
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
for (const { utterance, start } of REQUESTS) {
  const runs = [];
  for (const [strategy, provider] of PROVIDERS) {
    questions = 0;
    const cue = createGridCue({
      adapter: createRowsAdapter({ schema: wealthSchema, initialState: { ...wealthInitialState, ...start?.view } }),
      provider,
    });
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
  requests.push({ utterance, ...(start ? { start: start.description } : {}), runs });
  console.log(`${utterance}: ${runs.map((r) => `${r.strategy} ${r.status}`).join(", ")}`);
}

const recordedAt = new Date().toISOString().slice(0, 10);
writeFileSync(out, `${JSON.stringify({ recordedAt, model: DEFAULT_JEV_MODEL, requests }, null, 2)}\n`);
console.log(`Wrote ${out}`);
