import { createGridCue, type ViewSchema } from "gridcue";
import { createMockProvider } from "gridcue/mock";
// The placed-words lists are internal to the compiler, so this report reads them from the package source, as
// `placed.test.ts` does. It runs outside the compiler and only reads: it can't change a result.
import { namesAfterCodeRead, readCodeFilters } from "../packages/gridcue/src/core/code-read";
import { matchMentions } from "../packages/gridcue/src/core/mentions";
import { normalize, withoutNamedSizes } from "../packages/gridcue/src/core/normalize";
import { type PlacedPart, unplacedWords } from "../packages/gridcue/src/core/placed";
import { screenRestricted } from "../packages/gridcue/src/core/policy";
import { isExposed } from "../packages/gridcue/src/core/schema";
import { labelledRequests } from "./payloads";
import { mockOptionsFor, runCase } from "./run";

/**
 * How many ready plans hold a word the placed-words lists don't place (named filters plan, Task 2.5; order plan, D4).
 *
 * Each labelled request runs as `pnpm eval` runs it, with the Mock Provider and the built package. Then, for each
 * ready plan only, every part of the request goes through `unplacedWords`, whether or not it holds a code-read filter.
 * The compiler calls that function only beside a code-read filter, so in a part with none these words were read some
 * other way, or left out. There is no bar: the number says how large the class left for the Local Resolver is.
 *
 * The plan doesn't say which part each operation came from, so each part is checked against the whole plan's
 * operations. A sort's words in one part are placed when any part sorts.
 *
 *   pnpm build && pnpm eval:unplaced [--verbose]
 */

const verbose = process.argv.includes("--verbose");
const wealth = createMockProvider(mockOptionsFor({}));
const ledger = createMockProvider(mockOptionsFor({ schema: "ledger" }));

interface SetReport {
  ready: number;
  withUnplaced: number;
  /** Ready plans with an unplaced word in a part that holds a code-read filter. The compiler asks there, so it stays 0. */
  besideCodeRead: number;
  words: Map<string, number>;
}
const empty = (): SetReport => ({ ready: 0, withUnplaced: 0, besideCodeRead: 0, words: new Map() });

const reports = new Map<string, SetReport>();
for (const { file, id, case: c } of labelledRequests()) {
  // The schema the Controller reads, taken as it is built. Nothing else about the run changes.
  let schema: ViewSchema | undefined;
  const make: typeof createGridCue = (options) => {
    schema = options.schema ?? options.adapter.getSchema();
    return createGridCue(options);
  };
  const { plan, status } = await runCase(c, c.schema === "ledger" ? ledger : wealth, make);
  const report = reports.get(file) ?? empty();
  reports.set(file, report);
  if (status !== "ready" || !plan || !schema) continue;
  report.ready++;

  // The parts as the Controller builds them for the compiler.
  const normalized = normalize(c.utterance);
  const mentions =
    screenRestricted(normalized, schema).length === 0
      ? matchMentions(normalized.clauses, schema.columns.filter(isExposed), { rowNoun: schema.rowNoun })
      : [];
  const input = withoutNamedSizes(normalized, mentions);
  const codeRead = readCodeFilters(input, mentions, schema);
  // A column named right after a form is a name too, as the compiler reads it ("no vendor booked after …").
  const names = [...mentions, ...namesAfterCodeRead(input, mentions, codeRead, schema)];
  const found: string[] = [];
  let beside = false;
  for (const clause of input.clauses) {
    const part: PlacedPart = {
      clause,
      mentions: names.filter((m) => m.clauseIndex === clause.index),
      codeRead: codeRead.filter((r) => r.clauseIndex === clause.index),
      schema,
      operations: plan.operations,
    };
    const words = unplacedWords(part).map((w) => w.text.toLowerCase());
    if (words.length > 0 && part.codeRead.length > 0) beside = true;
    found.push(...words);
  }
  if (found.length === 0) continue;
  report.withUnplaced++;
  if (beside) report.besideCodeRead++;
  for (const word of new Set(found)) report.words.set(word, (report.words.get(word) ?? 0) + 1);
  if (verbose) console.log(`${file}: ${id}: “${c.utterance}” [${[...new Set(found)].join(", ")}]`);
}

const top = (words: Map<string, number>) =>
  [...words]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, 20)
    .map(([word, n]) => `${word} ${n}`)
    .join(", ");

const total = empty();
console.log("Ready plans that hold a word the placed-words lists don't place (Mock Provider). No bar.");
console.table(
  Object.fromEntries(
    [...reports].map(([file, r]) => {
      total.ready += r.ready;
      total.withUnplaced += r.withUnplaced;
      total.besideCodeRead += r.besideCodeRead;
      for (const [word, n] of r.words) total.words.set(word, (total.words.get(word) ?? 0) + n);
      return [file, { ready: r.ready, "with an unplaced word": r.withUnplaced, "beside a code-read filter": r.besideCodeRead }];
    }),
  ),
);
console.log(
  `All sets: ${total.withUnplaced} of ${total.ready} ready plans hold an unplaced word, ${total.besideCodeRead} beside a code-read filter.`,
);
console.log("\nThe twenty most common unplaced words, by how many ready plans hold each:");
for (const [file, r] of reports) if (r.words.size > 0) console.log(`${file}: ${top(r.words)}`);
console.log(`All sets: ${top(total.words)}`);
