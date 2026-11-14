import { readdirSync } from "node:fs";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { IntentProvider, ResolutionRequest, ResolutionResult } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { createJevProvider, JEV_SIGNALS, type JevClient, type JevSignal, type JevStrategy } from "gridcue/server";
import { type EvalCase, loadCases, mockOptionsFor, runCase, runWithoutGrouping, type Verdict } from "./run";

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

const run = async (file: URL, label: string) => {
  const counts: Record<Verdict, number> = { exact: 0, safe_abstention: 0, rejected: 0, mismatch: 0, unsafe: 0 };
  for (const c of loadCases(file)) {
    seen = {};
    useProviderFor(c);
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

// `--grid=no-group` runs every existing set on a grid that doesn't list `group.set` instead (more grids spec, 10).
// A case whose expected plan groups must end not applied; every other case must keep its verdict on the Rows Adapter.
if (flag("grid") === "no-group") {
  const dir = new URL("./", import.meta.url);
  const files = readdirSync(dir)
    .filter((name) => /^cases.*\.jsonl$/.test(name))
    .sort();
  let failed = 0;
  for (const file of files) {
    const counts = { grouping: 0, "grouping, ready": 0, other: 0, "other, verdict changed": 0, "starts grouped, left out": 0 };
    for (const c of loadCases(new URL(file, dir))) {
      // A set labelled for a grid without group.set already runs there; a scripted answer was written for a grid that groups.
      if (c.grid || c.providerAnswer) continue;
      useProviderFor(c);
      const result = await runWithoutGrouping(c, provider);
      if (!result) {
        counts["starts grouped, left out"]++;
        continue;
      }
      counts[result.groups ? "grouping" : "other"]++;
      if (!result.pass) {
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
];
if (all.some((counts) => (counts?.unsafe ?? 0) > 0) || (!live && mockMustMatch.some((counts) => counts.mismatch > 0))) process.exit(1);
if (strict && all.some((counts) => (counts?.mismatch ?? 0) > 0)) process.exit(1);
