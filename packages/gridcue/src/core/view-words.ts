import type { Mention } from "./mentions";
import type { Clause } from "./normalize";
import type { ViewOperation, ViewSchema } from "./protocol";

/**
 * View words: the small, closed set of words code reads itself (ADR 0028). A Clause is read whole or not at all. One
 * word left over and it is not read, and the Clause goes to the provider exactly as it does today.
 */
export interface ViewWordsReading {
  /** What the Clause asks for. The compiler uses these and ignores the provider's families for the Clause. */
  operations: ViewOperation[];
  /** Where the words that were read sit in the Clause's text. */
  spans: Array<{ start: number; end: number; kind: "verb" | "column" | "count" | "density" | "position" }>;
}

/** How a count is written: 5, 25, 1,000. Never 0, 05, 5.5 or "five". */
const NUMBER = String.raw`[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*`;

/**
 * Each form is its whole Clause, word for word. A named group is a span of that kind; `n` is the count's number. `nouns`
 * are the form's own nouns: where a Host's declared name holds one ("Trade count"), the form is not read.
 */
const FORMS: ReadonlyArray<{ words: RegExp; nouns: readonly string[]; count: (n: string | undefined) => number | null }> = [
  // The count-clear form, in the Preview's own words: "Show every row".
  { words: /^(?<verb>show) (?<count>every row|all rows)$/d, nouns: ["row"], count: () => null },
  { words: /^(?<verb>remove) the (?<count>count)$/d, nouns: ["count"], count: () => null },
  { words: /^(?<count>no count)$/d, nouns: ["count"], count: () => null },
  // The count form, in the Preview's own words: "Show only the first 5 rows".
  {
    words: new RegExp(`^(?:(?<verb>show) )?only the (?<count>first (?<n>${NUMBER}) rows?)$`, "d"),
    nouns: ["row"],
    count: (n) => Number((n ?? "").replaceAll(",", "")),
  },
];
const SPAN_KINDS = ["verb", "count"] as const;

const wordsOf = (text: string): string[] => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.replace(/(?:es|s)$/, ""));

/** Every label and alias the Host declared, for columns and their values, as words. "Rows" and "row" are one word. */
const declaredNames = (schema: ViewSchema): string[][] =>
  schema.columns
    .flatMap((col) => [
      col.label,
      ...(col.aliases ?? []),
      ...(col.enumValues ?? []).flatMap((v) => [v.label, ...(v.aliases ?? [])]),
      ...(col.valueGroups ?? []).flatMap((g) => [g.label, ...(g.aliases ?? [])]),
    ])
    .map(wordsOf)
    .filter((words) => words.length > 0);

/** Whether `name` is written whole, word for word, somewhere in `words`. */
const holds = (words: readonly string[], name: readonly string[]): boolean =>
  words.some((_, at) => name.every((word, i) => words[at + i] === word));

/**
 * Reads a Clause's words against the closed forms (spec 4.1, ADR 0028). Returns `undefined` unless every word is a form
 * word: then the Clause is left to the provider. The Host's names come first, so a form is not read when
 * - the Clause holds a Mention (these forms name no column),
 * - one of the Host's declared names is written whole in it ("Count", "Rows"), whatever the Mention rules made of it, or
 * - the form's own noun is a word of one of the Host's names ("remove the count" beside a "Trade count" column).
 *
 * The reading is returned, never stored on the Clause: the provider request is built from the Clause, and it must not
 * change.
 */
export const readViewWords = (clause: Clause, mentions: readonly Mention[], schema: ViewSchema): ViewWordsReading | undefined => {
  // What a clear says to keep, and a part that continues a sort or grouping, are read by their own rules.
  if (clause.keeps || clause.continues) return undefined;
  if (mentions.some((m) => m.clauseIndex === clause.index)) return undefined;
  for (const form of FORMS) {
    const match = form.words.exec(clause.text);
    if (!match) continue;
    const names = declaredNames(schema);
    const words = wordsOf(clause.text);
    if (names.some((name) => holds(words, name) || name.some((word) => form.nouns.includes(word)))) return undefined;
    const count = form.count(match.groups?.n);
    if (count !== null && !Number.isSafeInteger(count)) return undefined;
    const spans = SPAN_KINDS.flatMap((kind) => {
      const at = match.indices?.groups?.[kind];
      return at ? [{ start: at[0], end: at[1], kind }] : [];
    });
    return { operations: [{ type: "limit.set", count }], spans };
  }
  return undefined;
};

/**
 * "Show all accounts", "show every account": the count-clear words with the Row Noun where "rows" would be. This is
 * never the count-clear form (spec 5.2). On a view with filters it may ask for the rows they leave out too, so the
 * compiler asks. The Row Noun may be a Mention here ("account" is often a column's alias too); nothing else may be.
 */
export const namesEveryRow = (clause: Clause, mentions: readonly Mention[], schema: ViewSchema): boolean => {
  const noun = schema.rowNoun?.toLowerCase();
  if (!noun || clause.keeps || clause.continues) return false;
  const lead = /^show (?:every|all) /.exec(clause.text);
  if (!lead) return false;
  const rows = clause.text.slice(lead[0].length);
  if (rows !== noun && rows !== `${noun}s` && rows !== `${noun}es`) return false;
  return mentions.every((m) => m.clauseIndex !== clause.index || (m.valueId === undefined && m.start >= lead[0].length));
};
