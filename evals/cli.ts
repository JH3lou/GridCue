import { readdirSync } from "node:fs";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { IntentProvider, ResolutionRequest, ResolutionResult } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { createJevProvider, JEV_SIGNALS, type JevClient, type JevSignal, type JevStrategy } from "gridcue/server";
import {
  caseFiles,
  type EvalCase,
  failsTanStackRun,
  LIVE_ONLY_SETS,
  loadCases,
  mockOptionsFor,
  passesWithoutRenders,
  QUERY_KINDS,
  QUERY_WITHOUT_AS_ON_A_DEFAULT_GRID,
  REVIEW_R2_FOR_THE_OWNER,
  runCase,
  runOnQueryAdapter,
  runOnTanStack,
  runWithoutGrouping,
  runWithoutRenders,
  type Verdict,
} from "./run";

const live = process.argv.includes("--live");
const verbose = process.argv.includes("--verbose");
// Live runs report mismatches without failing, because a live model varies and a service can error. `--strict`
// fails on any mismatch, for a release check against a known-good run.
const strict = process.argv.includes("--strict");
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
// Exits once everything printed has been written: to a pipe, `process.exit` alone can cut the report off.
const exit = async (code: number) => {
  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
  process.exit(code);
};
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
const jev: IntentProvider | undefined = live ? createJevProvider({ client, strategy, signals }) : undefined;
// The Mock Provider is set up for the app each case runs in: a bare amount names another column on the ledger.
const wealthMock = createMockProvider(mockOptionsFor({}));
const ledgerMock = createMockProvider(mockOptionsFor({ schema: "ledger" }));
let base: IntentProvider = jev ?? wealthMock;
const useProviderFor = (c: EvalCase) => {
  base = jev ?? (c.schema === "ledger" ? ledgerMock : wealthMock);
};

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

// `forTheOwner` lists cases whose wrong view is the owner's decision, or an older one the order plan records: each is
// reported, and not failed.
// `listName` names that list in the report.
const run = async (
  file: URL,
  label: string,
  forTheOwner: readonly string[] = [],
  listName = "the owner's decisions (REVIEW_R2_FOR_THE_OWNER)",
) => {
  const counts: Record<Verdict, number> = { exact: 0, safe_abstention: 0, rejected: 0, mismatch: 0, unsafe: 0 };
  let owners = 0;
  const cases = loadCases(file);
  // A case that says `"values": true` runs with its schema's Local Values (evals/local-values.ts).
  const withValues = cases.filter((c) => c.values).length;
  // A case that says `"clock": true` runs at the fixed clock with the fixed Calendar (evals/clock.ts).
  const withClock = cases.filter((c) => c.clock).length;
  const named = [label, withValues > 0 ? `${withValues} with Local Values` : "", withClock > 0 ? `${withClock} on the fixed clock` : ""]
    .filter(Boolean)
    .join(", ");
  for (const c of cases) {
    seen = {};
    useProviderFor(c);
    const started = Date.now();
    const { verdict, plan, status } = await runCase(c, provider);
    counts[verdict]++;
    if (verdict === "unsafe" && forTheOwner.includes(c.id)) owners++;
    if (verbose) {
      console.log(`${verdict.padEnd(15)} ${c.id}`);
      console.log(describe(Date.now() - started));
      if (verdict === "mismatch" || verdict === "unsafe")
        console.log(`    got ${status}: ${plan?.clarifications.map((q) => q.prompt).join(" | ") || JSON.stringify(plan?.operations)}`);
    } else if (verdict === "mismatch" || verdict === "unsafe") {
      console.log(`${verdict.toUpperCase()}: ${c.id}`);
    }
  }
  console.log(`GridCue evals: ${named} (${live ? "Jev" : "Mock Provider"}${setup ? `, ${setup}` : ""})`);
  console.table(counts);
  if (owners > 0) console.log(`${owners} of the unsafe cases are ${listName}, not failed.`);
  return { ...counts, unsafe: counts.unsafe - owners };
};

/**
 * Every set on the TanStack Table adapter as well as the Rows Adapter (operation set spec, section 10), with the case's
 * `renders` plus "count". A case fails when its TanStack result differs from its Rows Adapter result in any part, or
 * when it is a wrong view by its labels; the live-only sets are judged by their labels only with `--live`. With
 * `--live` the two runs ask the model apart, so a difference is reported and not failed. `perSet` prints a table for
 * each set; otherwise one totals line. Returns how many cases failed.
 */
const tanStackRun = async (perSet: boolean): Promise<number> => {
  type Counts = Record<Verdict | "unsafe, not judged" | "unsafe, the owner's" | "differs", number>;
  const zero = (): Counts => ({
    exact: 0,
    safe_abstention: 0,
    rejected: 0,
    mismatch: 0,
    unsafe: 0,
    "unsafe, not judged": 0,
    "unsafe, the owner's": 0,
    differs: 0,
  });
  const totals = zero();
  let cases = 0;
  let sets = 0;
  let failed = 0;
  const started = Date.now();
  for (const file of caseFiles()) {
    const counts = zero();
    const judged = live || !LIVE_ONLY_SETS.includes(file);
    // A case with `without` is labelled for its Query Adapter alone, and runs there in every run, so a set of them is
    // left out here.
    const onTanStack = loadCases(new URL(file, import.meta.url)).filter((c) => !c.without);
    if (onTanStack.length === 0) continue;
    sets++;
    for (const c of onTanStack) {
      useProviderFor(c);
      const result = await runOnTanStack(c, provider);
      cases++;
      const verdict = result.tanstack?.verdict;
      // The owner's decisions in the review fixes' second held-out set are ready here, as on the Rows Adapter.
      const forTheOwner = file === "cases-review-fixes-heldout-r2.jsonl" && REVIEW_R2_FOR_THE_OWNER.includes(c.id);
      // A wrong view in a live-only set is counted apart: with the Mock Provider those labels are not judged.
      if (verdict)
        counts[
          verdict === "unsafe" && !judged ? "unsafe, not judged" : verdict === "unsafe" && forTheOwner ? "unsafe, the owner's" : verdict
        ]++;
      if (!result.same) counts.differs++;
      const wrong = judged && verdict === "unsafe" && !forTheOwner;
      if (failsTanStackRun(result, { wrong, live })) failed++;
      if (wrong) console.log(`UNSAFE on TanStack: ${file}: ${c.id}`);
      if (!result.same) console.log(`DIFFERS on TanStack: ${file}: ${c.id} (“${c.utterance}”)\n    ${result.why.join("\n    ")}`);
      else if (verbose) console.log(`ok on TanStack ${file}: ${c.id} (${verdict})`);
    }
    for (const k of Object.keys(totals) as Array<keyof Counts>) totals[k] += counts[k];
    if (perSet) {
      console.log(
        `GridCue evals on the TanStack Table adapter: ${file}${judged ? "" : " (held to the Rows Adapter only)"} (${live ? "Jev" : "Mock Provider"})`,
      );
      console.table(counts);
    }
  }
  const line = Object.entries(totals)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  console.log(`GridCue evals on the TanStack Table adapter: ${cases} cases in ${sets} sets: ${line} (${Date.now() - started} ms)`);
  return failed;
};

// `--adapter=tanstack` runs every set on the TanStack Table adapter and the Rows Adapter, one table for each set.
if (flag("adapter") === "tanstack") await exit((await tanStackRun(true)) > 0 ? 1 : 0);
if (flag("adapter") !== undefined && flag("adapter") !== "rows")
  throw new Error(`Unknown adapter "${flag("adapter")}". Use rows or tanstack.`);

// `--grid=no-group` runs every existing set on a grid that doesn't list `group.set` instead (more grids spec, 10).
// A case whose expected plan groups must end not applied; every other case must keep its verdict on the Rows Adapter.
// A case unsafe on both grids fails too, except in the live-only sets, whose Mock wrong views are known and not judged.
if (flag("grid") === "no-group") {
  const dir = new URL("./", import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => /^cases.*\.jsonl$/.test(name))
    .sort();
  let failed = 0;
  for (const file of files) {
    const counts = { grouping: 0, "grouping, ready": 0, other: 0, "other, verdict changed": 0, "starts grouped, left out": 0 };
    for (const c of loadCases(new URL(file, dir))) {
      // A set labelled for a grid without group.set already runs there, and one with `without` on its own Query Adapter; a
      // scripted answer was written for a grid that groups.
      if (c.grid || c.without || c.providerAnswer) continue;
      useProviderFor(c);
      const result = await runWithoutGrouping(c, provider);
      if (!result) {
        counts["starts grouped, left out"]++;
        continue;
      }
      counts[result.groups ? "grouping" : "other"]++;
      // The owner's decisions in the review fixes' second held-out set are ready on both grids, as they are on one.
      const forTheOwner = file === "cases-review-fixes-heldout-r2.jsonl" && REVIEW_R2_FOR_THE_OWNER.includes(c.id);
      if (!result.pass || (result.after.verdict === "unsafe" && !LIVE_ONLY_SETS.includes(file) && !forTheOwner)) {
        failed++;
        counts[result.groups ? "grouping, ready" : "other, verdict changed"]++;
        const { before, after } = result;
        const got = after.plan?.clarifications.map((q) => q.prompt).join(" | ") || JSON.stringify(after.plan?.operations);
        console.log(
          `${result.groups ? "READY" : "CHANGED"}: ${file}: ${c.id} (${before.verdict} -> ${after.verdict}, ${after.status}: ${got})`,
        );
      } else if (verbose) console.log(`ok ${result.groups ? "grouping" : "other"} ${file}: ${c.id} (${result.after.verdict})`);
    }
    // A set labelled for a grid without group.set already runs there.
    if (Object.values(counts).every((n) => n === 0)) continue;
    console.log(`GridCue evals on a grid without group.set: ${file} (${live ? "Jev" : "Mock Provider"})`);
    console.table(counts);
  }
  process.exit(failed > 0 ? 1 : 0);
}

// `--grid=no-renders` runs every case labelled for a grid that draws pins and density on a grid without `renders`
// (operation set spec, 5.3). A case whose expected plan pins or sets the density must end not applied, asking only
// "This grid can't …"; every other case must keep the verdict it has with `renders`. The totals held-out sets allow
// what `passesWithoutRenders` says, the rule `evals.test.ts` judges by too.
if (flag("grid") === "no-renders") {
  const dir = new URL("./", import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => /^cases.*\.jsonl$/.test(name))
    .sort();
  let failed = 0;
  for (const file of files) {
    const counts = { "pins or density": 0, "pins or density, not asked why": 0, other: 0, "other, verdict changed": 0 };
    for (const c of loadCases(new URL(file, dir))) {
      if (!c.renders) continue;
      useProviderFor(c);
      const result = await runWithoutRenders(c, provider);
      if (!result) continue;
      counts[result.needsRenders ? "pins or density" : "other"]++;
      if (!passesWithoutRenders(file, result)) {
        failed++;
        counts[result.needsRenders ? "pins or density, not asked why" : "other, verdict changed"]++;
        const { before, after } = result;
        const got = after.plan?.clarifications.map((q) => q.prompt).join(" | ") || JSON.stringify(after.plan?.operations);
        console.log(
          `${result.needsRenders ? "NOT ASKED" : "CHANGED"}: ${file}: ${c.id} (${before.verdict} -> ${after.verdict}, ${after.status}: ${got})`,
        );
      } else if (verbose) console.log(`ok ${result.needsRenders ? "pins or density" : "other"} ${file}: ${c.id} (${result.after.verdict})`);
    }
    if (Object.values(counts).every((n) => n === 0)) continue;
    console.log(`GridCue evals on a grid without renders: ${file} (${live ? "Jev" : "Mock Provider"})`);
    console.table(counts);
  }
  process.exit(failed > 0 ? 1 : 0);
}

// `--grid=query` runs every existing set on a default Query Adapter (more grids spec, 10), judged by
// `passesOnQueryAdapter`, the rule `evals.test.ts` judges by too. A case whose starting view holds a count, totals, a pin
// or a density is left out. One line for each set, then a table of the totals.
if (flag("grid") === "query") {
  const zero = () => ({
    ...Object.fromEntries(QUERY_KINDS.flatMap((kind) => [[kind, 0] as const, [`${kind}, failed`, 0] as const])),
    "kept the Rows Adapter's verdict": 0,
    "starts with a count, left out": 0,
    "starts with totals, left out": 0,
    "starts with pins, left out": 0,
    "starts with a density, left out": 0,
  });
  const totals: Record<string, number> = zero();
  let failed = 0;
  for (const file of caseFiles()) {
    const counts: Record<string, number> = zero();
    for (const c of loadCases(new URL(file, import.meta.url))) {
      // A case with `without` runs on its own Query Adapter, in the run without a mode.
      if (c.without) continue;
      useProviderFor(c);
      const result = await runOnQueryAdapter(c, file, provider);
      if (result.leftOut) {
        counts[`${result.leftOut}, left out`] = (counts[`${result.leftOut}, left out`] ?? 0) + 1;
        continue;
      }
      counts[result.kind] = (counts[result.kind] ?? 0) + 1;
      if (result.query.verdict === result.rows.verdict)
        counts["kept the Rows Adapter's verdict"] = (counts["kept the Rows Adapter's verdict"] ?? 0) + 1;
      if (!result.pass) {
        failed++;
        counts[`${result.kind}, failed`] = (counts[`${result.kind}, failed`] ?? 0) + 1;
        const { rows, query } = result;
        const got = query.plan?.clarifications.map((q) => q.prompt).join(" | ") || JSON.stringify(query.plan?.operations);
        console.log(
          `FAILED (${result.kind}): ${file}: ${c.id} (“${c.utterance}”; ${rows.verdict} on the Rows Adapter -> ${query.verdict} on the Query Adapter, ${query.status}: ${got})`,
        );
      } else if (verbose) console.log(`ok ${result.kind} ${file}: ${c.id} (${result.query.verdict})`);
    }
    for (const [k, n] of Object.entries(counts)) totals[k] = (totals[k] ?? 0) + n;
    const line = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    if (line) console.log(`${file}: ${line}`);
  }
  console.log(`GridCue evals on a default Query Adapter, every set (${live ? "Jev" : "Mock Provider"})`);
  console.table(totals);
  await exit(failed > 0 ? 1 : 0);
}

const core = await run(new URL("./cases.jsonl", import.meta.url), "cases.jsonl");
// Live-only cases need common sense the Mock doesn't have. They are findings, with no pass bar, except that none may be unsafe.
const extra = live ? await run(new URL("./cases-live.jsonl", import.meta.url), "cases-live.jsonl") : undefined;
const fanout = live ? await run(new URL("./cases-fanout.jsonl", import.meta.url), "cases-fanout.jsonl") : undefined;
const chassis = live ? await run(new URL("./cases-chassis.jsonl", import.meta.url), "cases-chassis.jsonl") : undefined;
// Reading cases (comparison symbols, negative amounts, quoted text): none may be unsafe with either provider.
// Mismatches are reported, not failed.
const reading = await run(new URL("./cases-reading.jsonl", import.meta.url), "cases-reading.jsonl");
// The same classes in other words, labelled before the fixes and first run after them (2026-11-10).
const readingHeldOut = await run(new URL("./cases-reading-heldout.jsonl", import.meta.url), "cases-reading-heldout.jsonl");
// Quoted text and dates that showed rows the User didn't ask for (named filters spec, 5.1). With the Mock Provider each
// case must match, like the core cases. The text forms PR 1 asked about are read since spec 5.2, and their cases were
// relabelled to the spec's reading (2026-11-14): 7 here, 6 and 7 in the two held-out sets below.
const namedFixes = await run(new URL("./cases-named-fixes.jsonl", import.meta.url), "cases-named-fixes.jsonl");
// The same classes in other words, labelled before the fixes and first run after them (2026-11-13): with the Mock
// Provider 16 exact, 37 asked as labelled, 0 wrong views, of 53. With the text forms read: 22 exact, 31 asked.
const namedFixesHeldOut = await run(new URL("./cases-named-fixes-heldout.jsonl", import.meta.url), "cases-named-fixes-heldout.jsonl");
// A second held-out set for the same fixes, labelled before it was run and first run after the round-1 review's fixes
// (2026-11-13). With the Mock Provider: 34 exact, 34 asked as labelled, 6 safe misses, 0 wrong views, of 74. Two labels
// were corrected to ask after the run (r2-ok-12, r2-ok-36). After the round-2 fixes: 37 exact, 34 asked as labelled, 3
// safe misses, 0 wrong views. With the text forms read (2026-11-14): 44 exact, 27 asked as labelled, 3 safe misses. Its
// safe misses are reported, not failed; a wrong view fails.
const namedFixesHeldOut2 = await run(
  new URL("./cases-named-fixes-heldout-r2.jsonl", import.meta.url),
  "cases-named-fixes-heldout-r2.jsonl",
);
// A count follows its rows (operation set spec, 5.1): requests made after a count, and the count's own words. Each case
// starts from the view in its state. With the Mock Provider each case must match: 25 exact, 15 asked as labelled, of 40.
const count = await run(new URL("./cases-count.jsonl", import.meta.url), "cases-count.jsonl");
// The same classes in other words, labelled before the code and first run after it (2026-11-13). With the Mock Provider:
// 19 exact, 26 asked as labelled, 3 safe misses, 0 wrong views, of 48. Its safe misses are reported, not failed; a
// wrong view fails.
const countHeldOut = await run(new URL("./cases-count-heldout.jsonl", import.meta.url), "cases-count-heldout.jsonl");
// A grid that can't group says so (more grids spec, 5.3), on a grid without group.set. With the Mock Provider each case
// must match: 6 exact, 19 asked as labelled, of 25. `--grid=no-group` runs every other set on that grid.
const cantGroup = await run(new URL("./cases-cant-group.jsonl", import.meta.url), "cases-cant-group.jsonl");
// The same classes in other words, labelled before the code and first run after it (2026-11-13). With the Mock Provider:
// 4 exact, 24 asked as labelled, 2 safe misses, 1 wrong view (h-groupwise-word), of 31. After the fix for that class
// ("group" after a name), 4 exact, 25 asked as labelled, 2 safe misses, no wrong view. After the fix for any word built
// on "group" (third set), 4 exact, 26 asked as labelled, 1 safe miss (h-value-group-in-household asks), no wrong view.
// Its safe misses are reported, not failed; a wrong view fails.
const cantGroupHeldOut = await run(new URL("./cases-cant-group-heldout.jsonl", import.meta.url), "cases-cant-group-heldout.jsonl");
// A second held-out set of the same classes, first run after that fix (2026-11-13). With the Mock Provider: 35 asked as
// labelled, 1 refused as labelled, 1 safe miss (r2-unsupported-edit asks instead of refusing), 1 wrong view
// (r2-noun-a-group-of), of 38. After the fix for that class ("group" as a noun after an article, before a name), 36
// asked as labelled, 1 refused as labelled, 1 safe miss, no wrong view. Its safe misses are reported, not failed; a
// wrong view fails.
const cantGroupHeldOut2 = await run(new URL("./cases-cant-group-heldout-r2.jsonl", import.meta.url), "cases-cant-group-heldout-r2.jsonl");
// A third held-out set of the same classes, first run after that fix (2026-11-13). With the Mock Provider: 34 asked as
// labelled, 1 refused as labelled, 1 safe miss (r3-verb-stop-grouping asks the general question), 1 wrong view
// (r3-noun-groups-of: "groups of" before a name, with no article, read as a filter), of 37. After the fix for that
// class (any word built on "group", with or without an article: "groups", "grouping", "regroup by"), 36 asked as
// labelled, 1 refused as labelled, no safe miss, no wrong view. Its safe misses are reported, not failed; a wrong view
// fails.
const cantGroupHeldOut3 = await run(new URL("./cases-cant-group-heldout-r3.jsonl", import.meta.url), "cases-cant-group-heldout-r3.jsonl");
// A fourth held-out set of the same classes, with the lead's ruling on grouping words said to stay or left out, first
// run after that fix (2026-11-14). With the Mock Provider: 13 exact, 39 asked as labelled, 3 safe misses
// (r4-keep-nothing-after, r4-keep-and-join and r4-quoted-household ask, as they do on a grid that can group), no wrong
// view, of 55. Its safe misses are reported, not failed; a wrong view fails.
const cantGroupHeldOut4 = await run(new URL("./cases-cant-group-heldout-r4.jsonl", import.meta.url), "cases-cant-group-heldout-r4.jsonl");
// Text forms (named filters spec, 5.2): "starts with", "exactly", empty and not empty, on the wealth and ledger
// fixtures. With the Mock Provider each case must match. The first 40 were labelled before the code: 31 exact, 9 asked
// as labelled (2026-11-14). Before the code, 1 showed a wrong view ("accounts with no advisor over $1m"). 32 more
// joined with the fix for a column asked for beside a form ("show only household where advisor is empty"), written
// beside that fix: 22 that must not be ready, of which 13 were ready with the form's filter alone before it, and 10
// controls that stay ready ("households with no advisor"). 8 more joined with the review's next fixes: 5 that must not
// be ready ("show me an advisor where household is empty", "my household with no advisor"), all 5 ready with the
// form's filter alone before them, and 3 controls that must be ready ("show every household with no advisor", "my
// restricted accounts with no advisor"), 2 of which asked before them. 11 more joined with the lead's rulings on
// statements around a form (round 4): controls that keep the plan they had before ("accounts whose advisor is empty",
// "advisor is empty for taxable accounts"), and "advisor is empty for accounts over $1m", which asks as before. Now: 54
// exact, 37 asked as labelled, of 91.
const textForms = await run(new URL("./cases-text-forms.jsonl", import.meta.url), "cases-text-forms.jsonl");
// Sentences that hold a text or empty form and are not view requests (spec 4.2). None may be ready. The first 20 were
// labelled before the code: 19 asked and 1 refused (2026-11-14). 24 more joined with the fix for statements made only
// of words GridCue places ("advisor is missing from my account", "every advisor is empty"), written beside that fix:
// all 24 were ready before it. 11 more joined with the review's next fixes ("include me in accounts with no advisor",
// "that advisor is missing", "accounts which were without an advisor"): all 11 were ready before them. 16 more joined
// with the lead's rulings on statements around a form (round 4: "accounts are without an advisor", "that account has
// no advisor", "which advisor is missing", "advisor is empty for every account"): all 16 were ready before them. 10 more
// that hold a House Term joined before its code ("that was a large mistake"), each run with its schema's terms
// declared: all 10 asked before it and ask after it. Now: 80 asked and 1 refused, of 81.
const notRequests = await run(new URL("./cases-not-requests.jsonl", import.meta.url), "cases-not-requests.jsonl");
// The limit on a provider's picks (spec 4.2): requests that hold a code-read filter, each with a scripted provider answer
// that proposes a sort, a column or a value for words the filter took, written before the code. Each case must match:
// 14 exact, 6 asked as labelled, of 20 (2026-11-14). Before the code, 8 showed a wrong view. 10 more that hold a House
// Term joined before its code, each run with its schema's terms declared: 9 exact and 1 asked as labelled. Before the
// code, 9 of them showed a wrong view. Now: 23 exact, 7 asked as labelled, of 30.
const providerPicks = await run(new URL("./cases-provider-picks.jsonl", import.meta.url), "cases-provider-picks.jsonl");
// The held-out form set, from spec 5.2 alone, labelled before the code and first run after it (2026-11-14). With the Mock
// Provider: 43 exact, 42 asked as labelled, 1 refused as labelled, 1 safe miss (h2f-23), 2 wrong views (h2f-54
// "Cleared is empty" filters Cleared to Yes, as before the code; h2f-59 "Advisor is empty and over 5%" is ready), of 89.
// After the fix for both classes (an empty form after a yes/no column asks; an amount after an empty form with no name
// of its own asks, past "and", a comma or the end of the part): 43 exact, 44 asked as labelled, 1 refused as labelled,
// 1 safe miss (h2f-23), no wrong view. Its safe misses are reported, not failed; a wrong view fails.
const textFormsHeldOut = await run(new URL("./cases-text-forms-heldout.jsonl", import.meta.url), "cases-text-forms-heldout.jsonl");
// The natural held-out set, by a labeller who saw only the product definition and the schemas, first run after the code
// (2026-11-14). With the Mock Provider: 6 exact, 8 asked as labelled, 22 safe misses, 2 wrong views, both as before the
// code (n1-led-ambig-blanks-last, n1-wea-advisor-exact), of 38. Each was a word nothing reads in a part with no
// code-read filter, narrowed to a question as a class (order plan, D4): a word for empty values outside an empty form,
// and a change to show only some columns beside words that aren't its own. After that fix: 6 exact, 9 asked as
// labelled, 23 safe misses (n1-wea-advisor-exact now asks), no wrong view. Its safe misses are reported, not failed; a
// wrong view fails.
const textFormsNatural = await run(
  new URL("./cases-text-forms-natural-heldout.jsonl", import.meta.url),
  "cases-text-forms-natural-heldout.jsonl",
);
// A second held-out set for the text forms, labelled from the spec and first run after the fixes for the first sets'
// wrong views (2026-11-14). With the Mock Provider: 16 exact, 30 asked as labelled, 1 refused as labelled, no safe miss,
// no wrong view, of 47, after two labels were corrected to the spec's reading (r2-text-starts-with-and-amount,
// r2-just-the-advisor). 15 of its requests showed a wrong view before the code and now ask. Its safe misses are
// reported, not failed; a wrong view fails.
const textFormsHeldOut2 = await run(new URL("./cases-text-forms-heldout-r2.jsonl", import.meta.url), "cases-text-forms-heldout-r2.jsonl");
// A third held-out set for the text forms, labelled from the spec and the lead's rulings (a column asked for beside a
// form, statements that are not requests, the question after an empty form), first run after the fixes for them
// (2026-11-14). With the Mock Provider: 49 exact, 58 asked as labelled, 1 safe miss (r3-plain-l04, no form, asks as
// before the code), no wrong view, of 108, after 11 labels were corrected (r3-r1-w12 and r3-r1-l09 show the column
// they name with "column" beside the form's filter, as spec 4.2 reads them; 9 plain controls said only "ready"). 13
// of its requests showed a wrong view before the code and now ask. Its safe misses are reported, not failed; a wrong
// view fails.
const textFormsHeldOut3 = await run(new URL("./cases-text-forms-heldout-r3.jsonl", import.meta.url), "cases-text-forms-heldout-r3.jsonl");
// Held-out sentences that hold a form and are not view requests (2026-11-14). None may be ready: 20 asked and 5 refused,
// of 25.
const notRequestsHeldOut = await run(new URL("./cases-not-requests-heldout.jsonl", import.meta.url), "cases-not-requests-heldout.jsonl");
// Held-out scripted provider picks for the form's words, written before the code (2026-11-14). Each case must match: 25
// exact, of 25. Before the code, 9 showed a wrong view.
const providerPicksHeldOut = await run(
  new URL("./cases-provider-picks-heldout.jsonl", import.meta.url),
  "cases-provider-picks-heldout.jsonl",
);
// House Terms (named filters spec, 5.3): each case says `"terms": true` and runs on its schema with the declared terms
// (evals/house-terms.ts), labelled before the code (2026-11-14). Before the code, 1 showed a wrong view ("show large
// taxable accounts" filtered Taxable alone). With the Mock Provider now: 23 exact, 12 asked as labelled, 6 safe misses,
// no wrong view, of 41. A wrong view fails. Its 6 safe misses
// are the Mock Provider's: each part starts with a word the Mock doesn't know, so it proposes no sort, grouping or
// column for an amount, which come from the provider (evals.test.ts names them). So the set is not in `mockMustMatch`.
const houseTerms = await run(new URL("./cases-house-terms.jsonl", import.meta.url), "cases-house-terms.jsonl");
// The House Terms held-out sets, labelled before the code from the declared terms and first run after it (2026-11-14),
// each case run with its schema's terms declared. With the Mock Provider:
// - the form set: 55 exact, 65 asked as labelled, 3 refused as labelled, 4 safe misses, 1 wrong view
//   (h1-contain-largely: "accounts largely in taxable" filters Taxable and drops "largely", as before the code), of 128;
// - sentences that hold a term and are not requests: 20 asked, 1 refused, none ready, of 21;
// - scripted provider picks for a term's words: 19 exact, 5 asked as labelled, of 24. Before the code, 21 showed a
//   wrong view;
// - the natural set, by a labeller who saw only the product definition, the schemas and the terms: 21 exact, 20 asked
//   as labelled, 1 refused as labelled, 13 safe misses, 1 wrong view (hn-w-largest-advisor: "which advisor has the
//   largest accounts?" sorts by Advisor, as before the code), of 56.
// The fix narrowed each wrong view's class to a question (order plan, D4), and both sets now hold them as regression
// cases: a word made from a term's name ("largely", "larger") in a part with no code-read filter asks about the word,
// and a size word on its own sorts only a column that holds an amount or a date, so "which advisor has the largest
// accounts?" asks which column. Now: the form set 66 asked and the natural set 21 asked, with no wrong view; the other
// numbers are unchanged.
// Their safe misses are reported, not failed; a wrong view fails.
const houseTermsHeldOut = await run(new URL("./cases-house-terms-heldout.jsonl", import.meta.url), "cases-house-terms-heldout.jsonl");
const houseTermsNotRequestsHeldOut = await run(
  new URL("./cases-house-terms-not-requests-heldout.jsonl", import.meta.url),
  "cases-house-terms-not-requests-heldout.jsonl",
);
const houseTermsPicksHeldOut = await run(
  new URL("./cases-house-terms-picks-heldout.jsonl", import.meta.url),
  "cases-house-terms-picks-heldout.jsonl",
);
const houseTermsNaturalHeldOut = await run(
  new URL("./cases-house-terms-natural-heldout.jsonl", import.meta.url),
  "cases-house-terms-natural-heldout.jsonl",
);
// A second held-out set for House Terms, labelled from the declared terms and the spec and first run after the fix for
// the first sets' wrong views (2026-11-14), each case run with its schema's terms declared. With the Mock Provider: 10
// exact, 29 asked as labelled, 1 refused as labelled, no safe miss, 2 wrong views (r2-form-largely-8: "records largely
// in the Travel category" filters Category to Travel and drops "largely"; r2-nat-size-2: "accounts by advisor, largest
// first" sorts Advisor descending), both as before the code, of 42, after one label was corrected to the spec's reading
// (r2-term-ready-10, "just the material ones", is ready with the Material filter). 9 of its requests showed a view the
// User didn't ask for before the code and now ask. The fix narrowed each wrong view's class to a question: an adverb
// nothing reads beside what a part keeps asks about the word, with or without terms, and a size or age word's phrase
// sorts a column that holds no size only where the part says "sort" or "order". Now: 10 exact, 31 asked, 1 refused, no
// wrong view. Its safe misses are reported, not failed; a wrong view fails.
const houseTermsHeldOut2 = await run(
  new URL("./cases-house-terms-heldout-r2.jsonl", import.meta.url),
  "cases-house-terms-heldout-r2.jsonl",
);
// A third held-out set for House Terms, labelled from the declared terms and the spec and first run after the fix for
// the second set's wrong views (2026-11-14), most cases run with their schema's terms declared and three without:
// adverbs nothing reads ("largely", "mostly", "roughly") beside a value, an amount or a term, a size word's phrase after
// "by" and a column that holds no size, each term's aliases, and a term left out, in a column slot, with "or", or in a
// sentence that is not a view request. With the Mock Provider: 7 exact, 33 asked as labelled, 1 safe miss
// (r3-term-1, "which big accounts do we have", asks about "do we", which spec 4.2 does not place), no wrong view, of
// 41, after 7 labels were corrected: r3-term-1 to r3-term-6 held a predicate "type" the harness drops, and
// r3-term-ask-15 ("material entries without a category") is ready with the Material filter and Category empty, as
// spec 5.2, 5.3 and 4.2 read it. 14 of its requests showed a view the User didn't ask for before the code and now ask.
// Its safe misses are reported, not failed; a wrong view fails.
const houseTermsHeldOut3 = await run(
  new URL("./cases-house-terms-heldout-r3.jsonl", import.meta.url),
  "cases-house-terms-heldout-r3.jsonl",
);
// Local Values (named filters spec, 5.4): whole values of the name columns in each position, lists, a value beside other
// changes, one word of a value, a value where a column goes or where rows are left out, and refused requests that hold
// a value. Each case says `"values": true` and runs with its schema's Local Values (evals/local-values.ts), labelled
// before the code (2026-11-14). Before the code, with no Local Values, the Mock Provider gave: 2 exact, 15 asked as
// labelled, 1 refused as labelled, 33 safe misses, and 9 wrong views, each a name dropped beside another reading ("show
// taxable accounts for Avery Lane" filters Taxable alone), of 60. After it: 37 exact, 16 asked as labelled, 1 refused
// as labelled, 6 safe misses, no wrong view. The 6 are the Mock Provider's (evals/evals.test.ts names them).
const names = await run(new URL("./cases-names.jsonl", import.meta.url), "cases-names.jsonl");
// The Local Values held-out sets, labelled from spec 5.4 and the declared name columns before the code, and first run
// after it (2026-11-14), each case with its schema's Local Values. With the Mock Provider:
// - the wealth form set: 45 exact, 51 asked as labelled, 4 refused as labelled, 7 safe misses, 4 wrong views (a value's
//   filter beside another filter on the same column that leaves no row, twice; two values of one column in separate
//   places read as any of them; values of two columns joined by "and" read as two filters), of 111;
// - the ledger form set: 49 exact, 54 asked as labelled, 5 refused as labelled, 2 safe misses, 1 wrong view ("Travel
//   Group entries" filters Category to Travel and drops "Group", as before the code), of 111;
// - sentences that hold a value and are not requests: 21 asked, 1 refused, none ready, of 22;
// - scripted provider picks for a value's words: 22 exact, 1 asked as labelled, of 23;
// - the natural set, by a labeller who saw only the product definition, the schemas and the name columns: 14 exact, 13
//   asked as labelled, 2 refused as labelled, 15 safe misses, no wrong view, of 44, after 3 labels were corrected to
//   spec 5.4's table: "everyone but …" and "… except …" ask, rather than filter to the other values.
// 8 of their requests showed a view the User didn't ask for before the code and now ask. Their safe misses are
// reported, not failed; a wrong view fails.
const namesHeldOutWealth = await run(new URL("./cases-names-heldout-wealth.jsonl", import.meta.url), "cases-names-heldout-wealth.jsonl");
const namesHeldOutLedger = await run(new URL("./cases-names-heldout-ledger.jsonl", import.meta.url), "cases-names-heldout-ledger.jsonl");
const namesNotRequestsHeldOut = await run(
  new URL("./cases-names-not-requests-heldout.jsonl", import.meta.url),
  "cases-names-not-requests-heldout.jsonl",
);
const namesPicksHeldOut = await run(new URL("./cases-names-picks-heldout.jsonl", import.meta.url), "cases-names-picks-heldout.jsonl");
const namesNaturalHeldOut = await run(new URL("./cases-names-natural-heldout.jsonl", import.meta.url), "cases-names-natural-heldout.jsonl");
// A second held-out set for Local Values, labelled from spec 5.4 and the declared name columns, and first run after the
// fix for the first sets' wrong views (2026-11-14), most cases with their schema's Local Values and two without: a
// value beside another filter on its column that leaves no row, two values of one column apart, values of two columns
// joined by "and", a word built on "group" that the part doesn't group by, whole values in each shape spec 5.4 reads,
// one word of a value, and a value where rows are left out, in a column slot or in a sentence that is not a request.
// With the Mock Provider: 17 exact, 37 asked as labelled, 2 refused as labelled, no wrong view, of 56; one request
// labelled ready asked, which its label accepts. 2 of its requests showed a view the User didn't ask for before the code
// and now ask: "Travel Group" requests that filtered Category to Travel, where the grid holds Hollis Travel Group. Three
// cases that ran with no Local Values were taken out after the review (2026-11-14): with none, every request reads as
// before this PR, and they test readings outside it. Its safe misses are reported, not failed; a wrong view fails.
const namesHeldOut2 = await run(new URL("./cases-names-heldout-wealth-r2.jsonl", import.meta.url), "cases-names-heldout-wealth-r2.jsonl");
// Dates (named filters spec, 5.5): each form, with and without a date column named, after the Row Noun or a value,
// beside other changes, on the date-and-time column, and the wordings that must ask, on the ledger at the fixed clock
// (evals/clock.ts), labelled before the code (2026-11-14). Before the code: 1 exact, 1 wrong view ("travel entries
// since january" showed Travel and dropped the date), 58 asked. With the Mock Provider now: 40 exact, 16 asked as
// labelled, 3 asked where a ready plan or a question is right, 1 safe miss, no wrong view, of 60. A wrong view fails.
// The safe miss is the Mock Provider's: the part starts with a word the Mock doesn't know, so it proposes no sort
// (evals/evals.test.ts names it). So the set is not in `mockMustMatch`.
const dates = await run(new URL("./cases-dates.jsonl", import.meta.url), "cases-dates.jsonl");
// The date held-out sets, labelled from spec 5.5 before the code, on the ledger at the fixed clock, and first run after
// it (2026-11-14), once each. With the Mock Provider:
// - the form set: 64 exact, 59 asked as labelled, 7 asked where a ready plan or a question is right, 3 safe misses (the
//   Mock Provider's: no sort, grouping or amount column for a part that starts with "entries"), no wrong view, of 133;
// - sentences that hold a date form and are not requests: 12 asked, 5 refused, none ready, of 17;
// - scripted provider picks for a date form's words: 14 exact, 1 asked where a ready plan or a question is right, of 15;
// - the natural set, by a labeller who saw only the product definition, the ledger schema and the fixed day: 11 exact,
//   19 asked as labelled, 1 refused as labelled, 19 safe misses, no wrong view, of 50. A month name was the unlisted
//   date wording that asked most.
// 1 of their requests showed a view the User didn't ask for before the code and now asks. Their safe misses are
// reported, not failed; a wrong view fails.
const datesHeldOut = await run(new URL("./cases-dates-heldout.jsonl", import.meta.url), "cases-dates-heldout.jsonl");
const datesNotRequestsHeldOut = await run(
  new URL("./cases-dates-not-requests-heldout.jsonl", import.meta.url),
  "cases-dates-not-requests-heldout.jsonl",
);
const datesPicksHeldOut = await run(new URL("./cases-dates-picks-heldout.jsonl", import.meta.url), "cases-dates-picks-heldout.jsonl");
const datesNaturalHeldOut = await run(new URL("./cases-dates-natural-heldout.jsonl", import.meta.url), "cases-dates-natural-heldout.jsonl");
// Rounds 2 and 3, each labelled blind after the review's fixes and run once. Round 2: 34 exact, 136 asked, no wrong
// view, of the 170 kept (seven labels corrected, one request set aside; see evals.test.ts). Round 3, first run: 48
// exact, 121 asked, 3 safe misses, no wrong view, of 172.
const datesHeldOut2 = await run(new URL("./cases-dates-heldout-r2.jsonl", import.meta.url), "cases-dates-heldout-r2.jsonl");
const datesHeldOut3 = await run(new URL("./cases-dates-heldout-r3.jsonl", import.meta.url), "cases-dates-heldout-r3.jsonl");
// Pinning and density (operation set spec, 5.2 and 5.3), labelled for a grid that draws both, with 10 adversarial
// cases. Each case runs on a Rows Adapter built with its `renders`, and with the Mock Provider each must match: 40
// exact, 10 asked as labelled, of 50 (2026-11-14). `--grid=no-renders` runs them on a grid without `renders`.
const viewWords = await run(new URL("./cases-view-words.jsonl", import.meta.url), "cases-view-words.jsonl");
// The held-out set for pinning and density, labelled blind for a grid that draws both and run once (2026-11-14): 48
// exact, 39 asked as labelled, 2 asked where a ready plan or a question is right, 1 wrong view ("pin rate and cleared
// to the start" pinned Rate alone and filtered Cleared to Yes), of 90. Without `renders`, every case passed. After the
// fix for that wrong view: 48 exact, 41 asked, 1 mismatch (that request, which now asks), no wrong view.
const viewWordsHeldOut = await run(new URL("./cases-view-words-heldout.jsonl", import.meta.url), "cases-view-words-heldout.jsonl");
// Round 2, labelled blind for a grid that draws both and run once (2026-11-14): 15 exact, 16 asked as labelled, 20
// asked where the label is a ready plan (16 of them a yes-or-no column in a pin list), no wrong view, of 51. Without
// `renders`, 49 passed; "use spacious rows" and "pin advisor and export the list" asked another question, and applied
// nothing. After the review's fix for pin and density words said where no form reads them, all 51 pass without it (see
// evals.test.ts); with it, the counts are unchanged.
const viewWordsHeldOut2 = await run(new URL("./cases-view-words-heldout-r2.jsonl", import.meta.url), "cases-view-words-heldout-r2.jsonl");
// Round 3, labelled blind after the review's fixes and run once (2026-11-15): 80 exact, 116 asked, 1 refused, 1 asked
// where its label is a ready plan, no wrong view, of 198. Without `renders`, all 198 passed.
const viewWordsHeldOut3 = await run(new URL("./cases-view-words-heldout-r3.jsonl", import.meta.url), "cases-view-words-heldout-r3.jsonl");
// Totals (operation set spec, 5.2 and 5.4), labelled for a grid that draws totals, with 10 adversarial cases and 15
// ranked-group requests. With the Mock Provider (2026-11-14): 30 exact, 28 asked as labelled, 2 asked with today's two
// choices where the label has a third ("most" and "least concentrated households first", which need "concentrated" read
// as Concentration), no wrong view, of 60. `--grid=no-renders` runs them on a grid without `renders`.
const totals = await run(new URL("./cases-totals.jsonl", import.meta.url), "cases-totals.jsonl");
// The held-out sets for totals, labelled blind for a grid that draws totals and run once (2026-11-14). Totals, from spec
// 5.4: 41 exact, 47 asked as labelled, 2 asked where a ready plan or a question is right, no wrong view, of 90. Ranked
// groups: 2 exact, 11 asked as labelled, 6 asked with other choices, no wrong view, of 19. The natural set, by a
// labeller who saw only the product definition and the schemas: 3 exact, 21 asked as labelled, 25 asked where the label
// is a ready plan (an ask rate of 25 of 29), 1 wrong view by the verdict ("total market value and average
// concentration" gave two `aggregation.set` operations, the second carrying both totals), of 50. See evals.test.ts.
const totalsHeldOut = await run(new URL("./cases-totals-heldout.jsonl", import.meta.url), "cases-totals-heldout.jsonl");
const totalsRankedHeldOut = await run(new URL("./cases-totals-ranked-heldout.jsonl", import.meta.url), "cases-totals-ranked-heldout.jsonl");
const totalsNaturalHeldOut = await run(
  new URL("./cases-totals-natural-heldout.jsonl", import.meta.url),
  "cases-totals-natural-heldout.jsonl",
);
// Round 2, labelled blind for a grid that draws totals and run once (2026-11-14): 21 exact, 18 asked as labelled, 2
// asked where the label was a ready plan, no wrong view, of 41. The 2 were label errors ("total" is an alias of the
// ledger's Amount, so its form doesn't read) and are corrected in the file. Without `renders`, all 41 passed.
const totalsHeldOut2 = await run(new URL("./cases-totals-heldout-r2.jsonl", import.meta.url), "cases-totals-heldout-r2.jsonl");
// Round 3, labelled blind after the review's fixes and run once (2026-11-15). One wrong view from this work, now a
// question; four labels corrected; one request set aside (see evals.test.ts). Of the 202 kept: 58 exact, 128 asked, 2
// refused, 14 asked where the label is a ready plan, no wrong view.
const totalsHeldOut3 = await run(new URL("./cases-totals-heldout-r3.jsonl", import.meta.url), "cases-totals-heldout-r3.jsonl");
// The review fixes' held-out set, labelled blind before the fixes for the stack's review findings, and first run after
// them (2026-11-19), once: 76 exact, 36 asked as labelled, 21 safe misses, no wrong view, of 133. Its safe misses are
// reported, not failed; a wrong view fails.
const reviewFixesHeldOut = await run(new URL("./cases-review-fixes-heldout.jsonl", import.meta.url), "cases-review-fixes-heldout.jsonl");
// The second held-out set for the review fixes, labelled blind, and first run after the third repair of pull request 21
// (2026-11-19), once: 28 exact, 20 asked as labelled, 1 safe miss, 8 wrong views, of 57. The 8 are
// REVIEW_R2_FOR_THE_OWNER, the owner's decisions: they are reported, not failed; any other wrong view fails. Its safe
// misses are reported, not failed.
const reviewFixesHeldOut2 = await run(
  new URL("./cases-review-fixes-heldout-r2.jsonl", import.meta.url),
  "cases-review-fixes-heldout-r2.jsonl",
  REVIEW_R2_FOR_THE_OWNER,
);
// The held-out set for two totals under two groupings, labelled blind before the fixes for pull request 37's second
// review, and first run after them (2026-11-19), once: 14 exact, 16 asked as labelled (one where the label also takes
// a question), 1 safe miss ("total market value and unrealized gain by advisor" asks where the label is a ready plan),
// no wrong view, of 31. Its safe misses are reported, not failed; a wrong view fails.
const reviewFixesTotalsHeldOut = await run(
  new URL("./cases-review-fixes-totals-heldout.jsonl", import.meta.url),
  "cases-review-fixes-totals-heldout.jsonl",
);
// An operation a Query Adapter's `without` removes (order plan, section 11), each case on a Query Adapter built with its
// `without`, labelled before the code (2026-11-19). Before the code: 40 exact, 15 asked as labelled, 68 safe misses, 2
// wrong views by their labels, of 125. After it: 40 exact, 71 asked as labelled, 12 safe misses, 2 wrong views by their
// labels. The 14 are QUERY_WITHOUT_AS_ON_A_DEFAULT_GRID: they read as on a default Query Adapter, which
// evals.test.ts holds them to. The 2 wrong views are reported, not failed. Its safe misses are reported, not failed;
// evals.test.ts fails any other case that doesn't match.
const queryWithout = await run(
  new URL("./cases-query-without.jsonl", import.meta.url),
  "cases-query-without.jsonl",
  QUERY_WITHOUT_AS_ON_A_DEFAULT_GRID,
  "older readings on every grid (QUERY_WITHOUT_AS_ON_A_DEFAULT_GRID; order plan, section 12)",
);
// The held-out set for the same rule, labelled blind and first run after the code (2026-11-19), once: 22 exact, 54
// asked as labelled, 24 safe misses, no wrong view, of 100. One label was corrected after the run (qwh-filter.clear-10:
// a new filter replaces the one in place, ADR 0017, so it asks "This grid can't clear filters."): 22 exact, 55 asked as
// labelled, 23 safe misses. Its safe misses are reported, not failed; a wrong view fails.
const queryWithoutHeldOut = await run(new URL("./cases-query-without-heldout.jsonl", import.meta.url), "cases-query-without-heldout.jsonl");

// Applying a view the user did not ask for is release-blocking with any provider.
// With the Mock Provider every core case must match exactly, because its answers are deterministic.
const all = [
  core,
  extra,
  fanout,
  chassis,
  reading,
  readingHeldOut,
  namedFixes,
  namedFixesHeldOut,
  namedFixesHeldOut2,
  count,
  countHeldOut,
  cantGroup,
  cantGroupHeldOut,
  cantGroupHeldOut2,
  cantGroupHeldOut3,
  cantGroupHeldOut4,
  textForms,
  notRequests,
  providerPicks,
  textFormsHeldOut,
  textFormsNatural,
  textFormsHeldOut2,
  textFormsHeldOut3,
  notRequestsHeldOut,
  providerPicksHeldOut,
  houseTerms,
  houseTermsHeldOut,
  houseTermsNotRequestsHeldOut,
  houseTermsPicksHeldOut,
  houseTermsNaturalHeldOut,
  houseTermsHeldOut2,
  houseTermsHeldOut3,
  names,
  namesHeldOutWealth,
  namesHeldOutLedger,
  namesNotRequestsHeldOut,
  namesPicksHeldOut,
  namesNaturalHeldOut,
  namesHeldOut2,
  dates,
  datesHeldOut,
  datesNotRequestsHeldOut,
  datesPicksHeldOut,
  datesNaturalHeldOut,
  datesHeldOut2,
  datesHeldOut3,
  viewWords,
  viewWordsHeldOut,
  viewWordsHeldOut2,
  viewWordsHeldOut3,
  totals,
  totalsHeldOut,
  totalsRankedHeldOut,
  totalsNaturalHeldOut,
  totalsHeldOut2,
  totalsHeldOut3,
  reviewFixesHeldOut,
  reviewFixesHeldOut2,
  reviewFixesTotalsHeldOut,
  queryWithout,
  queryWithoutHeldOut,
];
const mockMustMatch = [
  core,
  namedFixes,
  namedFixesHeldOut,
  count,
  cantGroup,
  textForms,
  notRequests,
  providerPicks,
  notRequestsHeldOut,
  providerPicksHeldOut,
  viewWords,
];
// The TanStack run, after every Rows Adapter set, so the TanStack count path is in the gate (operation set spec,
// section 10). It prints one totals line, and a line for each case that fails. With `--live` it would ask the model
// twice for each case, so it runs only when asked for, with `--adapter=tanstack`.
const tanStackFailed = live ? 0 : await tanStackRun(false);
if (live) console.log("GridCue evals on the TanStack Table adapter: not run with --live. Run it with --adapter=tanstack.");
if (tanStackFailed > 0) await exit(1);
if (all.some((counts) => (counts?.unsafe ?? 0) > 0) || (!live && mockMustMatch.some((counts) => counts.mismatch > 0))) await exit(1);
if (strict && all.some((counts) => (counts?.mismatch ?? 0) > 0)) await exit(1);
