import { wealthMockOptions } from "@gridcue-internal/wealth-fixtures";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { IntentProvider, ResolutionRequest, ResolutionResult } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { createJevProvider, type JevClient } from "gridcue/server";
import { loadCases, runCase, type Verdict } from "./run";

const live = process.argv.includes("--live");
const verbose = process.argv.includes("--verbose");
if (live && !process.env.JEV_API_KEY) {
  console.log("Skipping live evals: JEV_API_KEY is not set.");
  process.exit(0);
}

// In verbose mode, count the questions each request sends to Jev.
let questions = 0;
const client: JevClient | undefined = live
  ? (() => {
      const real = new TypeSafeClient({ apiKey: process.env.JEV_API_KEY, logLevel: "off" });
      return {
        systemOne: (req, opts) => {
          questions = Object.keys(req.questions).length;
          return real.systemOne(req as never, opts);
        },
      } satisfies JevClient;
    })()
  : undefined;
const base: IntentProvider = live ? createJevProvider({ client }) : createMockProvider(wealthMockOptions);

// Records what the provider saw and said, for --verbose.
let seen: { request?: ResolutionRequest; result?: ResolutionResult } = {};
const provider: IntentProvider = {
  async resolve(request, signal) {
    const result = await base.resolve(request, signal);
    seen = { request, result };
    return result;
  },
};

const scores = (picks: ReadonlyArray<{ id: string; confidence: number }>) =>
  picks
    .filter((p) => p.confidence >= 0.3)
    .map((p) => `${p.id} ${p.confidence.toFixed(2)}`)
    .join(", ");

const describe = (ms: number) => {
  const lines = [`    ${ms} ms${live ? `, ${questions} questions` : ""}`];
  for (const c of seen.result?.clauses ?? []) {
    const clause = seen.request?.clauses.find((q) => q.index === c.clauseIndex);
    const mentions = (clause?.mentions ?? []).map((m) => (m.valueId ? `${m.columnId}=${m.valueId}` : m.columnId)).join(", ");
    lines.push(`    part ${c.clauseIndex}: “${clause?.text ?? ""}”`);
    lines.push(`      families [${scores(c.families)}]  columns [${scores(c.columns)}]  mentions [${mentions}]`);
    if (c.values.length > 0)
      lines.push(`      values [${scores(c.values.map((v) => ({ id: `${v.columnId}=${v.valueId}`, confidence: v.confidence })))}]`);
    if (c.literalColumns?.length) {
      lines.push(
        `      literals [${scores(c.literalColumns.map((l) => ({ id: `#${l.literalIndex}→${l.columnId}`, confidence: l.confidence })))}]`,
      );
    }
  }
  return lines.join("\n");
};

const run = async (file: URL, label: string) => {
  const counts: Record<Verdict, number> = { exact: 0, safe_abstention: 0, rejected: 0, mismatch: 0, unsafe: 0 };
  for (const c of loadCases(file)) {
    seen = {};
    const started = Date.now();
    const { verdict, plan, status } = await runCase(c, provider);
    counts[verdict]++;
    if (verbose) {
      console.log(`${verdict.padEnd(15)} ${c.id}`);
      console.log(describe(Date.now() - started));
      if (verdict === "mismatch" || verdict === "unsafe")
        console.log(`    got ${status}: ${plan?.clarifications.map((q) => q.prompt).join(" | ") || JSON.stringify(plan?.operations)}`);
    } else if (verdict === "mismatch" || verdict === "unsafe") {
      console.log(`${verdict.toUpperCase()}: ${c.id}`);
    }
  }
  console.log(`GridCue evals: ${label} (${live ? "Jev" : "Mock Provider"})`);
  console.table(counts);
  return counts;
};

const core = await run(new URL("./cases.jsonl", import.meta.url), "cases.jsonl");
// Live-only cases need common sense the Mock doesn't have. They are findings, with no pass bar, except that none may be unsafe.
const extra = live ? await run(new URL("./cases-live.jsonl", import.meta.url), "cases-live.jsonl") : undefined;

// Applying a view the user did not ask for is release-blocking with any provider.
// With the Mock Provider every case must match exactly, because its answers are deterministic.
if (core.unsafe > 0 || (extra?.unsafe ?? 0) > 0 || (!live && core.mismatch > 0)) process.exit(1);
