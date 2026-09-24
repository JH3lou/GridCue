import { wealthMockOptions } from "@gridcue-internal/wealth-fixtures";
import type { IntentProvider } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { createJevProvider } from "gridcue/server";
import { loadCases, runCase, type Verdict } from "./run";

const live = process.argv.includes("--live");
if (live && !process.env.JEV_API_KEY) {
  console.log("Skipping live evals: JEV_API_KEY is not set.");
  process.exit(0);
}
const provider: IntentProvider = live ? createJevProvider({ apiKey: process.env.JEV_API_KEY }) : createMockProvider(wealthMockOptions);

const counts: Record<Verdict, number> = { exact: 0, safe_abstention: 0, rejected: 0, mismatch: 0, unsafe: 0 };
for (const c of loadCases()) {
  const { verdict } = await runCase(c, provider);
  counts[verdict]++;
  if (verdict === "mismatch" || verdict === "unsafe") console.log(`${verdict.toUpperCase()}: ${c.id}`);
}
console.log(`GridCue evals (${live ? "Jev" : "Mock Provider"})`);
console.table(counts);

// Applying a view the user did not ask for is release-blocking with any provider.
// With the Mock Provider every case must match exactly, because its answers are deterministic.
if (counts.unsafe > 0 || (!live && counts.mismatch > 0)) process.exit(1);
