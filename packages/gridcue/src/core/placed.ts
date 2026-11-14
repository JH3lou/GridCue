import { isExposed } from "./columns";
import { COLUMN_VERBS, LEAD_IN_WORDS } from "./lead";
import { LITERAL_COLUMN_KINDS, type Mention } from "./mentions";
import { type Clause, comparisonSpans, directionSpans, literalText, unquoted } from "./normalize";
import type { Clarification, DecisionEvidence, ViewOperation, ViewSchema } from "./protocol";
import type { ClauseResolution } from "./resolution";
import { escapeRegExp } from "./text-match";
import { namesOf } from "./unused";
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
 * Two kinds of word are placed by where they sit, not by a list alone, because a list would pass a part that is no
 * request or would drop something the User asked for:
 * - a first-person word ("my", "our", "me", "us") is placed only where it belongs to a request, so "advisor is missing
 *   from my account" asks (see `OWNERS`);
 * - a column's name in the singular right after a word that chooses columns asks for that column, so it is placed only
 *   when the plan holds a change for it: "show only household where advisor is empty" asks (see `askedColumns`).
 *
 * Apart from those two, this checks which words a part holds, not where they sit. It is the first slice of the closed
 * grammar in ADR 0020; the Local Resolver checks both and replaces it.
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
   * Where the part's code-read filters sit in its text, with the column each filters on and how, when that is known.
   * Their words are placed, whatever they are.
   */
  codeRead: readonly (Span & { predicate?: { columnId: string; operator?: string }; kind?: string })[];
  schema: ViewSchema;
  /**
   * The operations the plan holds for this part. Another change's own words ("sorted by", "hide"), a verb read only
   * for columns ("add") and a column the part asks for ("show household where …") are placed only when these hold that
   * change. Left out, those words count as placed where the plan may yet hold the change: the first check runs before
   * the plan is built, and the caller checks again once it is.
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
/** The verbs that choose rows, and "give": "give us the trusts". */
const GIVING_VERBS: readonly string[] = [...CHOOSING_VERBS, "give"];
/** The row verbs: the verbs that choose rows, "give", and "only" and "just". */
const ROW_VERBS: readonly string[] = [...GIVING_VERBS, ...ONLY_WORDS];

/** A sort's own verbs, and a grouping's. */
export const SORT_VERBS = ["sort", "sorted", "order", "ordered"] as const;
export const GROUP_VERBS = ["group", "grouped"] as const;
const HIDE = "hide";
const HIDE_VERBS: readonly string[] = [HIDE, "hidden"];
/** "Add" shows a column. It is one of the verbs read only for columns (`core/lead.ts`). */
const ADD = "add";
/**
 * The words that choose what shows, columns or rows: after one, a column's name in the singular stands where a column
 * would, and asks for that column ("show household", "only the advisor", "hide custodian", "find advisor where …").
 */
const COLUMN_CHOOSING: readonly string[] = [...GIVING_VERBS, ...ONLY_WORDS, ADD, HIDE];
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
/** Other words for the rows. */
const ROW_WORDS: readonly string[] = ["rows", "records", "ones"];
/**
 * The first-person words. None is placed for being on a list: a part that says something about the User ("advisor is
 * missing from my account", "advisor is missing for me") is a statement, not a request for a view. Each is placed only
 * where the words make it part of a request:
 * - "my" and "our" right before the noun for the rows, when that noun comes before the part's code-read filters ("my
 *   accounts with no advisor"). What describes the rows may sit between ("my taxable accounts", "my restricted
 *   accounts", "my top 10 accounts"), and a named value may stand for them ("my trusts"). An entity word in the singular
 *   is no noun for the rows here: "my household" is one household of the User's, which GridCue can't know. `ownsRows` in
 *   `read` holds the rule;
 * - "me" and "us" in a lead-in ("show me", "let me see"), or right after a verb that chooses rows ("show us", "list me"),
 *   but never with a preposition right after it: in "include me in accounts …" the User is the verb's object, not the
 *   one the rows are shown to (`SELF_OBJECT`).
 * "I", "mine" and "ours" are placed only inside a lead-in ("I want to see"), like any other word no list holds.
 */
const OWNERS: readonly string[] = ["my", "our"];
const SELVES: readonly string[] = ["me", "us"];
/**
 * The small words: the lists above, and the rest of the spec's row but its first-person words. "'s" is read apart, as
 * it is no word of its own.
 */
const SMALL_WORDS: readonly string[] = [
  "the",
  "a",
  "an",
  ...QUANTIFIERS,
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
  ...ROW_WORDS,
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
/** Every word and phrase on the lists here, wherever it is placed: alone, or only beside the change it belongs to. */
const ON_A_LIST: ReadonlySet<string> = new Set([
  ...ROW_VERBS,
  ...SMALL_WORDS,
  ...OWNERS,
  ...SELVES,
  ...SORT_VERBS,
  ...GROUP_VERBS,
  ...HIDE_VERBS,
  ADD,
  BY,
  ...COLUMN_WORDS,
  ...CONTAINING_WORDS,
  ...COLUMN_VERB_WORDS,
]);
/** The verbs on the lists here: the ones that choose rows, sort, group, hide, or show or move columns. */
const CHANGE_VERBS: ReadonlySet<string> = new Set([
  ...GIVING_VERBS,
  ...SORT_VERBS,
  ...GROUP_VERBS,
  ...HIDE_VERBS,
  ADD,
  ...COLUMN_VERB_WORDS,
]);
/** Whether `word` (lower case) is a verb on the lists here: "show", "sort", "group", "hide", "add", "move". */
export const isChangeVerb = (word: string): boolean => CHANGE_VERBS.has(word);
const WHOLE_LEAD_IN = new RegExp(`^(?:${LEAD_IN_WORDS})$`, "u");
/**
 * Whether `words` (lower case, one space between) is a word or a phrase on the lists here, or a lead-in of
 * `core/lead.ts`. A House Term may not be named one of them (ADR 0024).
 */
export const onPlacedLists = (words: string): boolean => ON_A_LIST.has(words) || WHOLE_LEAD_IN.test(words);
/** The column change each verb read only for columns makes. "Add" shows a column, "pin" pins one, the rest move one. */
const changeOf = (verb: string): ViewOperation["type"] =>
  verb === ADD ? "columns.show" : verb === "pin" ? "columns.pin" : "columns.order";
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

/** A name's words in lower case, with one space between and no symbols: "Market  Value" and "market value" are equal. */
const wordsOf = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");

/** A noun the Mentions may have read as the rows. The Row Noun names no column here; an entity word names its own. */
interface Noun extends Span {
  columnId?: string;
  /** Written as the schema declares it, not in the plural. */
  singular: boolean;
}

/**
 * Where the Row Noun and the entity words sit: names the Mentions may have read as the rows. The entity word of a
 * code-read filter's own column is left out: "advisors with no advisor" and "show advisor where advisor starts with …"
 * name that column again, and nothing reads it. An entity word that is also the Row Noun is the Row Noun.
 */
const nounSpans = (text: string, schema: PlacedPart["schema"], filtered: ReadonlySet<string>): Noun[] => {
  const rowNoun = schema.rowNoun?.trim() ? schema.rowNoun : undefined;
  const entities = schema.columns.filter(
    (col) => isExposed(col) && !filtered.has(col.id) && !!col.entity?.trim() && wordsOf(col.entity) !== wordsOf(rowNoun ?? ""),
  );
  const nouns: Array<{ noun: string; columnId?: string }> = [
    ...(rowNoun ? [{ noun: rowNoun }] : []),
    ...entities.map((col) => ({ noun: col.entity ?? "", columnId: col.id })),
  ];
  return nouns.flatMap(({ noun, columnId }) =>
    [...text.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}])${nounPattern(noun)}(?![\p{L}\p{N}])`, "gu"))].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
      singular: wordsOf(m[0]) === wordsOf(noun),
      ...(columnId === undefined ? {} : { columnId }),
    })),
  );
};

/** "Rows", "records" and "ones", wherever they sit. */
const ROW_WORD = new RegExp(String.raw`(?<![\p{L}\p{N}'])(?:${alt(ROW_WORDS)})(?![\p{L}\p{N}'])`, "gu");

/**
 * Where a text names rows by a noun: the Row Noun and the entity words, in either number, and "rows", "records" and
 * "ones". The entity words of the columns in `except` are left out. The checks for a form said as a statement read them
 * (`core/code-read.ts`).
 */
export const rowNouns = (text: string, schema: ViewSchema, except: ReadonlySet<string> = new Set()): Span[] => [
  ...nounSpans(text, schema, except).map(({ start, end }) => ({ start, end })),
  ...[...text.matchAll(ROW_WORD)].map((m) => ({ start: m.index, end: m.index + m[0].length })),
];

/** A column the part asks for: where its name sits, and its column. */
interface AskedColumn extends Span {
  columnId: string;
}
/** The words that pick out one thing, as a name in the singular does: "the", "a", "an", "this" and "that". */
const ONE_OF: readonly string[] = ["the", "a", "an", "this", "that"];
/**
 * A word that chooses columns right before a name, with only "the", "a", "an", "this", "that", "only", "just" or a
 * first-person word between: "show household", "show only the advisor", "show me an advisor", "show my advisor".
 * "Every", "each" and "all" are not among them: "show every household" means the households, as the plural does.
 */
const CHOOSES_COLUMN = new RegExp(
  String.raw`(?<![\p{L}\p{N}'])(?:${alt(COLUMN_CHOOSING)})(?: (?:${alt([...ONE_OF, ...ONLY_WORDS, ...SELVES, ...OWNERS])}))* $`,
  "u",
);
/** A possessive mark right after a name: "the advisor's accounts" describes the rows. */
const POSSESSIVE_AFTER = /^'s?(?![\p{L}\p{N}])/u;

/**
 * The columns a part asks for, outside its code-read filters: a column's name (its label, an alias or its entity word)
 * in the singular right after a word that chooses columns or rows (`CHOOSES_COLUMN`). A column with no entity word
 * asks there anyway, as the plan holds no change for it; an entity word behaves the same. "Show only household where
 * advisor is empty" asks for the
 * Household column and for the rows with no advisor. The Mentions read "household" before "where" as the rows, which is
 * right for "households with no advisor" and for the Row Noun, and wrong there. A name in the plural, a possessive
 * ("show the advisor's accounts") and the Row Noun are the rows.
 *
 * `scan` is the part with its names and code-read filters blanked, `names` its Mentions outside the code-read
 * filters, and `nouns` the entity words the Mentions left unread.
 */
const askedColumns = (
  clause: Pick<Clause, "text">,
  scan: string,
  names: readonly Mention[],
  nouns: readonly Noun[],
  schema: ViewSchema,
) => {
  const rowNoun = wordsOf(schema.rowNoun ?? "");
  // Said as the schema declares it, so not in the plural, and not the Row Noun ("account" is also Account number's alias).
  const declared = (m: Mention) => {
    const col = schema.columns.find((c) => c.id === m.columnId);
    const said = clause.text.slice(m.start, m.end);
    if (wordsOf(said) === rowNoun && !/[^\p{L}\p{N}\s]/u.test(said)) return false;
    return [col?.label, ...(col?.aliases ?? []), col?.entity].some((name) => !!name && wordsOf(name) === wordsOf(said));
  };
  const named: AskedColumn[] = [
    ...names.filter((m) => m.valueId === undefined && declared(m)).map((m) => ({ start: m.start, end: m.end, columnId: m.columnId })),
    ...nouns.flatMap((n) => (n.columnId !== undefined && n.singular ? [{ start: n.start, end: n.end, columnId: n.columnId }] : [])),
  ];
  return named.filter((s) => CHOOSES_COLUMN.test(scan.slice(0, s.start)) && !POSSESSIVE_AFTER.test(clause.text.slice(s.end)));
};

/** "Rows", "records" or "ones", where a text starts. */
const ROWS_NEXT = new RegExp(String.raw`^(?:${alt(ROW_WORDS)})(?![\p{L}\p{N}'])`, "u");
/** A verb that chooses rows, or "give", right before "me" or "us": "show us", "list me". */
const GIVES = new RegExp(String.raw`(?<![\p{L}\p{N}'])(?:${alt(GIVING_VERBS)}) $`, "u");
/**
 * "Me" or "us" with a preposition right after it, in a lead-in or not: in "include me in accounts …" and "show me in
 * accounts …" the User is the verb's object, and the part asks for something done to the User, not for a view.
 */
const SELF_OBJECT = new RegExp(String.raw`(?<![\p{L}\p{N}'])(?:${alt(SELVES)})(?= (?:${alt(PREPOSITIONS)})(?![\p{L}\p{N}']))`, "gu");

/** What the part's words are checked against: its text with the names, the quoted text and the code-read filters gone. */
const read = (part: PlacedPart) => {
  const { clause, codeRead } = part;
  const names = outsideCodeRead(part.mentions, codeRead);
  let scan = withoutNames(clause.text, [...names, ...codeRead]);
  const filtered = new Set(codeRead.flatMap((r) => (r.predicate ? [r.predicate.columnId] : [])));
  const nouns = nounSpans(scan, part.schema, filtered);
  const asked = askedColumns(clause, scan, names, nouns, part.schema);
  // A noun the part asks for as a column is not the rows, so it is left in for the check.
  const rows = nouns.filter((n) => !asked.some((a) => a.start === n.start));
  scan = blank(scan, rows);
  /** The column a verb read only for columns acts on: named right after it, after "the". */
  const objectOf = (verbEnd: number): string | undefined => {
    const at = verbEnd + (/^ (?:the )?/.exec(clause.text.slice(verbEnd))?.[0].length ?? 0);
    return at > verbEnd ? names.find((m) => m.valueId === undefined && m.start === at)?.columnId : undefined;
  };
  /**
   * Whether "my" or "our", ending at `end`, sits right before the noun for the rows, with that noun before every
   * code-read filter in the part: "my accounts with no advisor". What describes the rows may sit between: named values
   * ("our taxable accounts"), which may also stand for the rows ("my trusts"), and `ranking`, the direction and count
   * words a sort reads ("my top 10 accounts", "our largest accounts"), and a yes/no column named for the rows ("my
   * restricted accounts"), which can't stand for them. The noun is the Row Noun, an entity word in the plural, or
   * "rows", "records" or "ones", whether the Mentions read it as the rows or left it undecided ("my accounts, with no
   * advisor"). An entity word in the singular is no noun for the rows: "my household" is one household of the User's,
   * which GridCue can't know. Nor is a possessive ("my advisor's accounts"), or a noun that follows another one for the
   * rows: in "the accounts of our household", the rows are the accounts.
   */
  const yesNo = (m: Mention) => m.valueId === undefined && part.schema.columns.find((c) => c.id === m.columnId)?.kind === "boolean";
  const oneEntity = (n: Span) => {
    const said = wordsOf(clause.text.slice(n.start, n.end));
    return (
      said !== wordsOf(part.schema.rowNoun ?? "") &&
      part.schema.columns.some((c) => isExposed(c) && !!c.entity?.trim() && wordsOf(c.entity) === said)
    );
  };
  const ownsRows = (end: number, ranking: readonly Span[]): boolean => {
    if ([...rows, ...names.filter((m) => m.ambiguous)].some((n) => n.end <= end)) return false;
    let at = end;
    let values = 0;
    for (;;) {
      if (clause.text[at] !== " ") break;
      const value = names.find((m) => m.start === at + 1 && (m.valueId !== undefined || yesNo(m)));
      // A House Term describes the rows as a named value does: "my large accounts".
      const term = codeRead.find((r) => r.kind === "term" && r.start === at + 1);
      // "Top" and "top 10" start at the same place: the longer one is the whole of it.
      const described = value ?? term ?? ranking.filter((s) => s.start === at + 1).sort((a, b) => b.end - a.end)[0];
      if (!described) break;
      at = described.end;
      if (value?.valueId !== undefined) values++;
    }
    const next = clause.text[at] === " " ? at + 1 : undefined;
    const said =
      next === undefined ? undefined : (rows.find((n) => n.start === next) ?? names.find((m) => m.ambiguous && m.start === next));
    const noun = said && !oneEntity(said) ? said : undefined;
    const word = next === undefined ? null : ROWS_NEXT.exec(clause.text.slice(next));
    const rowsEnd = noun ? noun.end : word && next !== undefined ? next + word[0].length : values > 0 ? at : undefined;
    // "My advisor's accounts" are the accounts of the User's own advisor, whom GridCue can't know: no noun for the rows.
    if (rowsEnd === undefined || POSSESSIVE_AFTER.test(clause.text.slice(rowsEnd))) return false;
    // A House Term between "my" and the noun is one of the words that describe the rows.
    return codeRead.every((r) => r.start >= rowsEnd || (r.kind === "term" && r.start > end && r.end <= rowsEnd));
  };
  return { names, scan, objectOf, asked, ownsRows };
};

const tokens = (text: string): UnplacedWord[] =>
  [...text.matchAll(TOKEN)].map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));

/**
 * The words of a part that GridCue didn't place (spec 4.2). A word is placed when it is
 * - a name: a Mention of a column or a value, the Row Noun, an entity word, or a code-read filter's own words;
 * - an amount, a date or quoted text, with its comparison as read today. Quoted text is skipped;
 * - a lead-in, a row verb or a small word;
 * - a first-person word where it belongs to a request: "my" or "our" right before the noun for the rows, when that noun
 *   comes before the part's code-read filters, and "me" or "us" in a lead-in or right after a verb that chooses rows,
 *   with no preposition right after it;
 * - another change's own words, when the plan holds that change: a sort's ("sorted", "by", the direction and the count
 *   read today), a grouping's ("grouped", "by"), a hide's, and "column" beside any of them or a change to columns;
 * - a verb read only for columns ("add", "put", "move", "pin"), when its object is a column and the plan holds that
 *   change for that column.
 *
 * A column the part asks for (`askedColumns`) is a name of another kind: it is placed only when the plan holds a change
 * that names its column, other than a code-read filter's own filter. So "show only household where advisor is empty" is
 * never ready with the Advisor filter alone. Before the plan is built, it counts as placed when the Mentions hold it,
 * since the plan may yet; a name the Mentions read as the rows can be in no change, and is returned at once.
 *
 * A part read whole as view words (ADR 0028) has every word placed. Any other word is returned, in the order written.
 * This is a pure function of the part. The compiler calls it only for a part that holds a code-read filter.
 */
export const unplacedWords = (part: PlacedPart): UnplacedWord[] => {
  const { clause, operations } = part;
  const { names, scan, objectOf, asked, ownsRows } = read(part);
  const text = clause.text;
  const placed: Span[] = [];
  for (const lit of clause.literals) {
    placed.push({ start: lit.at, end: lit.at + literalText(text, lit).length }, ...comparisonSpans(text, lit));
    const before = scan.slice(0, lit.at);
    const lead = lit.kind === "text" ? CONTAINING_BEFORE.exec(before) : lit.kind === "date" ? ON_BEFORE.exec(before) : null;
    if (lead) placed.push({ start: lead.index, end: lit.at });
  }
  const whole = readViewWords(clause, part.mentions, part.schema)?.spans ?? [];
  placed.push(...whole);
  const holds = (test: (op: ViewOperation) => boolean) => operations === undefined || operations.some(test);
  const sorts = holds((op) => op.type === "sort.set" && op.sorts.length > 0);
  const groups = holds((op) => op.type === "group.set" && op.columnIds.length > 0);
  const hides = holds((op) => op.type === "columns.hide");
  const columns = sorts || groups || holds((op) => op.type.startsWith("columns."));
  const ranking = sorts ? directionWords(clause, scan) : [];
  placed.push(...ranking);
  // The columns the plan's changes name. A code-read filter's own filter is no change for a column asked for beside it.
  const own = (op: ViewOperation) =>
    op.type === "filter.add" &&
    part.codeRead.some(
      (r) => r.predicate?.columnId === op.predicate.columnId && (r.predicate.operator ?? op.predicate.operator) === op.predicate.operator,
    );
  const changed = operations && new Set(operations.filter((op) => !own(op)).flatMap(namesOf));
  const dropped = asked.filter(
    (a) => !whole.some((s) => within(a, s)) && !(changed ? changed.has(a.columnId) : names.some((m) => m.start === a.start)),
  );
  // "Me" or "us" before a preposition is never placed, not even in a lead-in: "show me in accounts with no advisor".
  const selves = [...filled(text).matchAll(SELF_OBJECT)]
    .map((m) => ({ start: m.index, end: m.index + m[0].length, text: text.slice(m.index, m.index + m[0].length) }))
    .filter((s) => scan.slice(s.start, s.end).trim() !== "" && !whole.some((w) => within(s, w)));
  let rest = blank(scan, [...placed, ...asked, ...selves]);
  for (const pattern of [LEAD_INS, PHRASES, POSSESSIVE]) rest = rest.replace(pattern, (s) => " ".repeat(s.length));
  const stray = tokens(rest).filter(({ text: word, start, end }) => {
    if (ALWAYS_PLACED.has(word)) return false;
    if (HYPHEN.test(word)) return !joinsWords(text, start);
    if (OWNERS.includes(word)) return !ownsRows(end, ranking);
    if (SELVES.includes(word)) return !GIVES.test(scan.slice(0, start));
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
  const unasked = dropped.map((a) => ({ start: a.start, end: a.end, text: text.slice(a.start, a.end) }));
  return [...stray, ...unasked, ...selves].sort((a, b) => a.start - b.start);
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
 *   filter's own, and names nothing else. A yes/no column named on its own keeps Yes, or No where a negation
 *   leaves it out; the provider's other answer for it is dropped.
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
  // A yes/no column named on its own says Yes ("cleared entries"), or No when a negation leaves it out. The words say
  // nothing else, so a provider's other answer is dropped: "material cleared entries" never shows Cleared is No.
  const saysYesNo = (v: ClauseResolution["values"][number]) =>
    names.some((m) => m.columnId === v.columnId && m.valueId === undefined && v.valueId === (m.negated ? "false" : "true"));
  const keepsValue = (v: ClauseResolution["values"][number]) =>
    names.some((m) => m.columnId === v.columnId && m.valueId === v.valueId) ||
    (namedColumns.has(v.columnId) && column(v.columnId)?.kind === "boolean" && saysYesNo(v));
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
