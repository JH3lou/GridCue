import { COLUMN_VERBS, LEAD_IN_WORDS } from "./lead";
import { LITERAL_COLUMN_KINDS, type Mention } from "./mentions";
import { type Clause, comparisonSpans, directionSpans, literalText, unquoted } from "./normalize";
import type { Clarification, DecisionEvidence, ViewOperation, ViewSchema } from "./protocol";
import type { ClauseResolution } from "./resolution";
import { isExposed } from "./schema";
import { escapeRegExp } from "./text-match";
import { readViewWords } from "./view-words";

/**
 * Beside a code-read filter, every word is placed (named filters spec, 4.2; ADR 0023).
 *
 * A code-read filter is a filter whose meaning GridCue reads with its own code, and an Intent Provider is never asked
 * what it means. So a part that holds one gives a ready plan only when GridCue placed every word in it: `unplacedWords`
 * returns the ones it didn't, and the compiler asks about them. In a part that passed, `limitPicks` keeps what a
 * provider proposes only where the part's words name it.
 *
 * The lists of placed words live here and nowhere else, with three exceptions that each have one home of their own: the
 * lead-ins and the verbs read only for columns (`core/lead.ts`), and the operation set's form words, which are read
 * through `readViewWords` (`core/view-words.ts`). The compiler's checks beside quoted text build their patterns from the
 * lists exported here, so a word of one kind is written once.
 *
 * This checks which words a part holds, not where they sit. It is the first slice of the closed grammar in ADR 0020;
 * the Local Resolver checks both and replaces it.
 */

type Span = { start: number; end: number };

/** Where the words of one code-read filter sit: in which part, and from where to where in its text. */
export interface CodeReadSpan extends Span {
  clauseIndex: number;
}

/** One part of a request, as the placed-words check sees it. */
export interface PlacedPart {
  clause: Clause;
  /** The part's own Mentions. */
  mentions: readonly Mention[];
  /**
   * Where the part's code-read filters sit in its text, with the column each filters on when it is known. Their words
   * are placed, whatever they are.
   */
  codeRead: readonly (Span & { predicate?: { columnId: string } })[];
  schema: ViewSchema;
  /**
   * The operations the plan holds for this part. Another change's own words ("sorted by", "hide") and a verb read only
   * for columns ("add") are placed only when these hold that change. Left out, those words count as placed: the first
   * check runs before the plan is built, and the caller checks again once it is.
   */
  operations?: readonly ViewOperation[];
}

/** A word GridCue didn't place, as written, with where it sits in its part. */
export interface UnplacedWord extends Span {
  text: string;
}

const alt = (words: readonly string[]) => words.map(escapeRegExp).join("|");
const blank = (text: string, spans: readonly Span[]) =>
  spans.reduce((t, s) => (s.end > s.start ? t.slice(0, s.start) + " ".repeat(s.end - s.start) + t.slice(s.end) : t), text);
const within = (inner: Span, outer: Span) => inner.start >= outer.start && inner.end <= outer.end;

// The lists. Each word is written once. A list the checks beside quoted text also read is exported.

/** Verbs that choose rows. */
export const CHOOSING_VERBS = ["show", "display", "list", "see", "view", "find", "get", "filter", "keep", "include"] as const;
/** "Only" and "just" choose rows too, alone or after a verb: "only trusts", "show just the trusts". */
export const ONLY_WORDS = ["only", "just"] as const;
/** The row verbs: the verbs that choose rows, "give", and "only" and "just". */
const ROW_VERBS: readonly string[] = [...CHOOSING_VERBS, "give", ...ONLY_WORDS];

/** A sort's own verbs, and a grouping's. */
export const SORT_VERBS = ["sort", "sorted", "order", "ordered"] as const;
export const GROUP_VERBS = ["group", "grouped"] as const;
const HIDE_VERBS: readonly string[] = ["hide", "hidden"];
/** "By" belongs to a sort or a grouping. */
const BY = "by";
/** "Column" belongs to any change that names a column: a sort, a grouping, or a change to which columns show. */
const COLUMN_WORDS: readonly string[] = ["column", "columns"];

/** The words that make quoted text "containing". "Has" does too, and is a small word. */
export const CONTAINING_WORDS = ["containing", "contains", "includes", "like", "matching"] as const;

/** Prepositions read before a name: "at Northgate", "for trusts". */
export const PREPOSITIONS = ["with", "for", "of", "at", "in", "from"] as const;
/** "All", "any", "every" and "each" before a name. */
export const QUANTIFIERS = ["all", "any", "every", "each"] as const;
/** "Also", "too" and "as well". */
export const ALSO_WORDS = ["also", "too", "as well"] as const;
/** The small words: the lists above, and the rest of the spec's row. "'s" is read apart, as it is no word of its own. */
const SMALL_WORDS: readonly string[] = [
  "the",
  "a",
  "an",
  ...QUANTIFIERS,
  "my",
  "our",
  "me",
  "us",
  "those",
  "these",
  "that",
  "which",
  "whose",
  "where",
  ...PREPOSITIONS,
  "under",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "having",
  "held",
  "owned",
  "and",
  "or",
  ...ALSO_WORDS,
  "rows",
  "records",
  "ones",
];

const ALWAYS_PLACED: ReadonlySet<string> = new Set([...ROW_VERBS, ...SMALL_WORDS].filter((w) => !w.includes(" ")));
/** Small words of more than one word ("as well"), read as one phrase. */
const PHRASES = new RegExp(
  String.raw`(?<![\p{L}\p{N}'])(?:${alt([...ROW_VERBS, ...SMALL_WORDS].filter((w) => w.includes(" ")))})(?![\p{L}\p{N}'])`,
  "gu",
);
/** A lead-in of `core/lead.ts`, wherever it sits. */
const LEAD_INS = new RegExp(String.raw`(?<![\p{L}\p{N}'])(?:${LEAD_IN_WORDS})(?![\p{L}\p{N}'])`, "gu");
const COLUMN_VERB_WORDS: ReadonlySet<string> = new Set(COLUMN_VERBS.split("|"));
/** The column change each verb read only for columns makes. "Add" shows a column, "pin" pins one, the rest move one. */
const changeOf = (verb: string): ViewOperation["type"] =>
  verb === "add" ? "columns.show" : verb === "pin" ? "columns.pin" : "columns.order";
/** A possessive: "the advisor's accounts". */
const POSSESSIVE = /'s(?![\p{L}\p{N}])/gu;
/** A containing word right before quoted text: `household containing "Alder"`. */
const CONTAINING_BEFORE = new RegExp(String.raw`(?<![\p{L}\p{N}'])(?:${alt(CONTAINING_WORDS)})\s+$`, "u");
/** "On" right before a date: "opened on 2026-01-31". */
const ON_BEFORE = /(?<![\p{L}\p{N}'])on\s+$/u;
/**
 * A word, with any apostrophes inside it ("isn't"), or one symbol. Commas, full stops, colons, brackets, long dashes
 * and quote marks join or end words and are never asked about. Any other symbol is: "&", "/", "!", "=", "~".
 */
const TOKEN = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*|[^\s\p{L}\p{N},.;:?()'"—]/gu;
/** A hyphen joins two words when a letter or a digit sits on each side ("non-retirement"). Standing free, it may mean "minus". */
const HYPHEN = /^[-–]$/;
const joinsWords = (text: string, at: number) => /[\p{L}\p{N}]/u.test(text[at - 1] ?? "") && /[\p{L}\p{N}]/u.test(text[at + 1] ?? "");

/** The forms a noun is written in: "account", "accounts"; "entry", "entries". */
const nounPattern = (noun: string): string => {
  const words = noun.trim().toLowerCase().split(/\s+/).map(escapeRegExp);
  const last = words.pop() ?? "";
  const plural = /[^aeiou]y$/.test(last) ? `(?:${last}|${last.slice(0, -1)}ies)` : `${last}(?:es|s)?`;
  return [...words, plural].join(String.raw`\s+`);
};

/** The part's text with quoted text filled with letters, keeping offsets, so nothing reads a word or a space in it. */
const filled = (text: string): string => {
  const bare = unquoted(text);
  // By UTF-16 code unit, as every stored position counts: spreading the text would count an emoji as one.
  return text
    .split("")
    .map((ch, i) => (bare[i] === ch ? ch : "x"))
    .join("");
};
/** The part's text with its names blanked and its quoted text filled, keeping offsets. */
export const withoutNames = (text: string, names: readonly Span[]): string => blank(filled(text), names);

/**
 * Where a part writes the direction and the count GridCue reads ("largest first", "top 10", "sorted descending", "in
 * descending order"). `scan` is the part from `withoutNames`. A direction counts only when nothing but names sits
 * inside it ("largest value first"): `largest exact first` and `largest "Lane" first` are not read.
 */
export const directionWords = (clause: Pick<Clause, "direction" | "limit">, scan: string): Span[] => {
  if (clause.direction === undefined && clause.limit === undefined) return [];
  const { direction, count } = directionSpans(scan);
  const spans: Span[] = [];
  if (
    direction &&
    clause.direction !== undefined &&
    /^\S+(?: to \S+| first)?$/.test(scan.slice(direction.start, direction.end).trim().replace(/\s+/g, " "))
  ) {
    const lead = DIRECTION_LEAD.exec(scan.slice(0, direction.start));
    const tail = /^\s+order\b/.exec(scan.slice(direction.end));
    spans.push({ start: direction.start - (lead?.[0].length ?? 0), end: direction.end + (tail?.[0].length ?? 0) });
  }
  if (count && clause.limit !== undefined) spans.push(count);
  return spans;
};
/** What may lead a direction: a sort's verb, "in" or "from". */
const DIRECTION_LEAD = new RegExp(String.raw`\b(?:${alt([...SORT_VERBS, "in", "from"])})\s+$`);

/** The part's Mentions that are not a code-read filter's own: a name inside one names nothing else. */
export const outsideCodeRead = <T extends Span>(mentions: readonly T[], codeRead: readonly Span[]): T[] =>
  mentions.filter((m) => !codeRead.some((r) => within(m, r)));

/**
 * Where the Row Noun and the entity words sit: names the Mentions may have read as the rows. The entity word of a
 * code-read filter's own column is left out: "advisors with no advisor" and "show advisor where advisor starts with …"
 * name that column again, and nothing reads it.
 */
const nounSpans = (text: string, schema: PlacedPart["schema"], filtered: ReadonlySet<string>): Span[] => {
  const nouns = [
    schema.rowNoun,
    ...schema.columns.filter((col) => isExposed(col) && !filtered.has(col.id)).map((col) => col.entity),
  ].filter((n): n is string => !!n?.trim());
  return nouns.flatMap((noun) =>
    [...text.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}])${nounPattern(noun)}(?![\p{L}\p{N}])`, "gu"))].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
    })),
  );
};

/** What the part's words are checked against: its text with the names, the quoted text and the code-read filters gone. */
const read = (part: PlacedPart) => {
  const { clause, codeRead } = part;
  const names = outsideCodeRead(part.mentions, codeRead);
  let scan = withoutNames(clause.text, [...names, ...codeRead]);
  const filtered = new Set(codeRead.flatMap((r) => (r.predicate ? [r.predicate.columnId] : [])));
  scan = blank(scan, nounSpans(scan, part.schema, filtered));
  /** The column a verb read only for columns acts on: named right after it, after "the". */
  const objectOf = (verbEnd: number): string | undefined => {
    const at = verbEnd + (/^ (?:the )?/.exec(clause.text.slice(verbEnd))?.[0].length ?? 0);
    return at > verbEnd ? names.find((m) => m.valueId === undefined && m.start === at)?.columnId : undefined;
  };
  return { names, scan, objectOf };
};

const tokens = (text: string): UnplacedWord[] =>
  [...text.matchAll(TOKEN)].map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));

/**
 * The words of a part that GridCue didn't place (spec 4.2). A word is placed when it is
 * - a name: a Mention of a column or a value, the Row Noun, an entity word, or a code-read filter's own words;
 * - an amount, a date or quoted text, with its comparison as read today. Quoted text is skipped;
 * - a lead-in, a row verb or a small word;
 * - another change's own words, when the plan holds that change: a sort's ("sorted", "by", the direction and the count
 *   read today), a grouping's ("grouped", "by"), a hide's, and "column" beside any of them or a change to columns;
 * - a verb read only for columns ("add", "put", "move", "pin"), when its object is a column and the plan holds that
 *   change for that column.
 *
 * A part read whole as view words (ADR 0028) has every word placed. Any other word is returned, in the order written.
 * This is a pure function of the part. The compiler calls it only for a part that holds a code-read filter.
 */
export const unplacedWords = (part: PlacedPart): UnplacedWord[] => {
  const { clause, operations } = part;
  const { scan, objectOf } = read(part);
  const text = clause.text;
  const placed: Span[] = [];
  for (const lit of clause.literals) {
    placed.push({ start: lit.at, end: lit.at + literalText(text, lit).length }, ...comparisonSpans(text, lit));
    const before = scan.slice(0, lit.at);
    const lead = lit.kind === "text" ? CONTAINING_BEFORE.exec(before) : lit.kind === "date" ? ON_BEFORE.exec(before) : null;
    if (lead) placed.push({ start: lead.index, end: lit.at });
  }
  placed.push(...(readViewWords(clause, part.mentions, part.schema)?.spans ?? []));
  const holds = (test: (op: ViewOperation) => boolean) => operations === undefined || operations.some(test);
  const sorts = holds((op) => op.type === "sort.set" && op.sorts.length > 0);
  const groups = holds((op) => op.type === "group.set" && op.columnIds.length > 0);
  const hides = holds((op) => op.type === "columns.hide");
  const columns = sorts || groups || holds((op) => op.type.startsWith("columns."));
  if (sorts) placed.push(...directionWords(clause, scan));
  let rest = blank(scan, placed);
  for (const pattern of [LEAD_INS, PHRASES, POSSESSIVE]) rest = rest.replace(pattern, (s) => " ".repeat(s.length));
  return tokens(rest).filter(({ text: word, start, end }) => {
    if (ALWAYS_PLACED.has(word)) return false;
    if (HYPHEN.test(word)) return !joinsWords(text, start);
    if ((SORT_VERBS as readonly string[]).includes(word)) return !sorts;
    if ((GROUP_VERBS as readonly string[]).includes(word)) return !groups;
    if (word === BY) return !sorts && !groups;
    if (HIDE_VERBS.includes(word)) return !hides;
    if (COLUMN_WORDS.includes(word)) return !columns;
    if (COLUMN_VERB_WORDS.has(word)) {
      const columnId = objectOf(end);
      if (columnId === undefined) return true;
      return !holds((op) => op.type === changeOf(word) && "columnIds" in op && op.columnIds.includes(columnId));
    }
    return true;
  });
};

/**
 * A change to show only some columns: its own words besides its columns' names, the row verbs and the lead-ins. "&"
 * joins columns as "and" does, "these" points at the columns named after it ("keep only these columns: household,
 * gain"), and "visible" says what the change does ("keep only the advisor column visible").
 */
const COLUMNS_ONLY_WORDS: ReadonlySet<string> = new Set([...ROW_VERBS, ...COLUMN_WORDS, "the", "these", "and", "&", "visible"]);
/** Thanks, as a pattern: at the end of a part, or at the start of a request before a comma. */
export const COURTESY = String.raw`(?:thanks|thank you)\b`;
/**
 * Words that say when or where a change to show only some columns is made, or thank, and not which columns: "for now"
 * at the end of a part, as the lead-in "now" does, "again", "in the grid" or "on the table" (where neither is a name),
 * and thanks at the start or the end. "Just the advisor column for now", "show only the advisor column again".
 */
const BESIDE_COLUMNS_ONLY = new RegExp(
  [
    String.raw`(?<![\p{L}\p{N}'])(?:again|(?:in|on) the (?:grid|table))(?![\p{L}\p{N}'])`,
    String.raw`(?<![\p{L}\p{N}'])for now\s*$`,
    String.raw`^\s*${COURTESY}\s*,`,
    String.raw`(?<![\p{L}\p{N}'])${COURTESY}[\s.!]*$`,
  ].join("|"),
  "gu",
);

/**
 * The words of a part read as a change to show only some columns ("just the advisor", "show only the advisor and
 * value columns") that are not that change's own (order plan, D4). Its own words are the columns' names, a lead-in, a
 * row verb and `COLUMNS_ONLY_WORDS`. Any other word, quoted text included, would be dropped: "just the accounts where
 * the advisor is Blake Moreno" would show Advisor alone. It is for a part with no code-read filter, which
 * `unplacedWords` never sees.
 */
export const strayBesideColumnsOnly = (clause: Pick<Clause, "text">, mentions: readonly Mention[]): UnplacedWord[] => {
  const rest = blank(
    clause.text,
    mentions.filter((m) => m.valueId === undefined),
  )
    .replace(BESIDE_COLUMNS_ONLY, (s) => " ".repeat(s.length))
    .replace(LEAD_INS, (s) => " ".repeat(s.length));
  return tokens(rest).filter(({ text }) => !COLUMNS_ONLY_WORDS.has(text));
};

/** “called about”; “there” and “i”; “a”, “b” and “c”. Words written side by side are named together. */
const named = (text: string, words: readonly UnplacedWord[]): string => {
  const runs: Span[] = [];
  for (const word of words) {
    const last = runs.at(-1);
    if (last && /^\s*$/.test(text.slice(last.end, word.start))) last.end = word.end;
    else runs.push({ start: word.start, end: word.end });
  }
  const quoted = runs.map((run) => `“${text.slice(run.start, run.end)}”`);
  return quoted.length > 2 ? `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}` : quoted.join(" and ");
};

/** The question for a part's unplaced words, in ADR 0019's wording. Its ID starts with its part's index. */
export const unplacedQuestion = (clause: Pick<Clause, "index" | "text">, words: readonly UnplacedWord[]): Clarification => ({
  id: `c${clause.index}.placed`,
  prompt: `I'm not sure what to do with ${named(clause.text, words)}. Try rephrasing that part.`,
  required: true,
});

const CLEARS: ReadonlySet<string> = new Set(["filter.clear", "sort.clear", "group.clear", "view.reset"]);

/**
 * The limit on a provider's picks (spec 4.2), for a part that holds a code-read filter and passed `unplacedWords`. This
 * extends ADR 0022: the provider proposes, and the part's words decide what stays.
 * - A column or value the provider proposes that no Mention names is dropped. A name inside the code-read filter is the
 *   filter's own, and names nothing else. The yes or no of a named yes/no column stays, as today.
 * - The column for a bare amount or a bare date still comes from the provider's pick for it, or, with no pick, from a
 *   column of a kind that can hold it (the kind rule of ADR 0013).
 * - A sort, a grouping, a hide, a show or an only-these-columns change is kept only when the part holds that change's
 *   own words. A clear or a reset is dropped: its words are never placed, so a part that passed holds none.
 * - A refusal stays a refusal.
 * Each drop is recorded as `dropped:` evidence: `unnamed` for a column or value, `unasked` for a change. The filter's
 * own column is not recorded: the words name it, and code reads it without the provider.
 */
export const limitPicks = (res: ClauseResolution, part: PlacedPart, record: (e: DecisionEvidence) => void): ClauseResolution => {
  const { clause } = part;
  const key = `c${clause.index}`;
  const { names, scan, objectOf } = read(part);
  const said = tokens(scan);
  const says = (words: readonly string[]) => said.some((t) => words.includes(t.text));
  const column = (id: string) => part.schema.columns.find((col) => col.id === id);
  const namedColumns = new Set(names.filter((m) => m.valueId === undefined).map((m) => m.columnId));
  // A bare amount's column: the provider's pick for it, or with none, any column of a kind that can hold it.
  const picks = res.literalColumns ?? [];
  const holdsLiteral = (id: string) =>
    clause.literals.some((lit, j) => {
      if (lit.kind === "text" || lit.kind === "unreadable") return false;
      const pick = picks.find((l) => l.literalIndex === j);
      return pick ? pick.columnId === id : LITERAL_COLUMN_KINDS[lit.kind].includes(column(id)?.kind ?? "string");
    });
  const keepsColumn = (id: string) => namedColumns.has(id) || holdsLiteral(id);
  const keepsValue = (v: ClauseResolution["values"][number]) =>
    names.some((m) => m.columnId === v.columnId && m.valueId === v.valueId) ||
    (namedColumns.has(v.columnId) && column(v.columnId)?.kind === "boolean");
  const adds = said.some((t) => t.text === "add" && objectOf(t.end) !== undefined);
  const asked = (family: string): boolean => {
    if (family === "sort") return says(SORT_VERBS) || clause.direction !== undefined;
    if (family === "group") return says(GROUP_VERBS);
    if (family === "columns.hide") return says(HIDE_VERBS);
    if (family === "columns.show") return says(COLUMN_WORDS) || adds;
    if (family === "columns.only") return says(COLUMN_WORDS) && says([...ONLY_WORDS, "keep"]);
    return !CLEARS.has(family);
  };
  const columns = res.columns.filter((p) => keepsColumn(p.id));
  const values = res.values.filter(keepsValue);
  const families = res.families.filter((f) => asked(f.id));
  const filtersOwn = new Set(part.mentions.filter((m) => m.valueId === undefined && !names.includes(m)).map((m) => m.columnId));
  for (const p of res.columns.filter((x) => !columns.includes(x) && !filtersOwn.has(x.id)))
    record({ key: `dropped:${key}.unnamed`, selectedId: p.id, confidence: p.confidence, source: "deterministic" });
  for (const v of res.values.filter((x) => !values.includes(x)))
    record({ key: `dropped:${key}.unnamed`, selectedId: `${v.columnId}=${v.valueId}`, confidence: v.confidence, source: "deterministic" });
  for (const f of res.families.filter((x) => !families.includes(x)))
    record({ key: `dropped:${key}.unasked`, selectedId: f.id, confidence: f.confidence, source: "deterministic" });
  // What the provider said about a column or a change that was dropped goes with it.
  const { roles, kind, ...rest } = res;
  const keptRoles = roles?.filter((r) => namedColumns.has(r.columnId) && asked(r.family));
  return { ...rest, families, columns, values, ...(keptRoles ? { roles: keptRoles } : {}), ...(kind && asked(kind.id) ? { kind } : {}) };
};
