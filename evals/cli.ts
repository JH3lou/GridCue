import { wealthMockOptions } from "@gridcue-internal/wealth-fixtures";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { IntentProvider, ResolutionRequest, ResolutionResult } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { createJevProvider, JEV_SIGNALS, type JevClient, type JevSignal, type JevStrategy } from "gridcue/server";
import { loadCases, runCase, type Verdict } from "./run";

const live = process.argv.includes("--live");
const verbose = process.argv.includes("--verbose");
// `--strategy=focused|fan-out` picks the Jev strategy (ADR 0015). `--without=kind,adds` and `--with=values` switch
// signals off or on top of it, so the value of each question can be measured.
const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const strategy = (flag("strategy") ?? "fan-out") as JevStrategy;
const listed = (name: string) => (flag(name) ?? "").split(",").filter(Boolean) as JevSignal[];
const signals: Partial<Record<JevSignal, boolean>> = {
  ...Object.fromEntries(listed("with").map((s) => [s, true])),
  ...Object.fromEntries(listed("without").map((s) => [s, false])),
};
for (const s of Object.keys(signals))
  if (!(JEV_SIGNALS as readonly string[]).includes(s)) throw new Error(`Unknown signal "${s}". Use ${JEV_SIGNALS.join(", ")}.`);
const setup = [live ? strategy : "", ...Object.entries(signals).map(([s, v]) => `${v ? "+" : "-"}${s}`)].filter(Boolean).join(" ");
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
const base: IntentProvider = live ? createJevProvider({ client, strategy, signals }) : createMockProvider(wealthMockOptions);

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
    const fan = [
      c.roles?.length ? `roles [${scores(c.roles.map((r) => ({ id: `${r.columnId}:${r.family}`, confidence: r.confidence })))}]` : "",
      c.kind ? `kind ${c.kind.id} ${c.kind.confidence.toFixed(2)}` : "",
      c.adds !== undefined ? `adds ${c.adds.toFixed(2)}` : "",
      c.outer?.length ? `outer [${c.outer.map((o) => `${o.outerId}>${o.innerId} ${o.confidence.toFixed(2)}`).join(", ")}]` : "",
      c.readings?.length ? `readings [${c.readings.map((r) => `${r.columnId}:${r.reading} ${r.confidence.toFixed(2)}`).join(", ")}]` : "",
    ].filter(Boolean);
    if (fan.length > 0) lines.push(`      ${fan.join("  ")}`);
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
  console.log(`GridCue evals: ${label} (${live ? "Jev" : "Mock Provider"}${setup ? `, ${setup}` : ""})`);
  console.table(counts);
  return counts;
};

const core = await run(new URL("./cases.jsonl", import.meta.url), "cases.jsonl");
// Live-only cases need common sense the Mock doesn't have. They are findings, with no pass bar, except that none may be unsafe.
const extra = live ? await run(new URL("./cases-live.jsonl", import.meta.url), "cases-live.jsonl") : undefined;
const fanout = live ? await run(new URL("./cases-fanout.jsonl", import.meta.url), "cases-fanout.jsonl") : undefined;
const chassis = live ? await run(new URL("./cases-chassis.jsonl", import.meta.url), "cases-chassis.jsonl") : undefined;

// Applying a view the user did not ask for is release-blocking with any provider.
// With the Mock Provider every case must match exactly, because its answers are deterministic.
if (core.unsafe > 0 || (extra?.unsafe ?? 0) > 0 || (fanout?.unsafe ?? 0) > 0 || (chassis?.unsafe ?? 0) > 0 || (!live && core.mismatch > 0))
  process.exit(1);
