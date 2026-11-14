import { isExposed, operatorsFor } from "./columns";
import { formatAmount } from "./format";
import { leavesRowsOut } from "./lead";
import { type Mention, matchMentions } from "./mentions";
import {
  type Clause,
  comparisonSpans,
  directionSpans,
  isComparisonWord,
  type Literal,
  literalText,
  type NormalizedInput,
  TEXT_MATCH_WORDS,
  unquoted,
} from "./normalize";
import { type CodeReadSpan, isChangeVerb, onPlacedLists, PREPOSITIONS, QUANTIFIERS, rowNouns, type UnplacedWord } from "./placed";
import type { ColumnDescriptor, FilterOperator, FilterValue, HouseTerm, ViewSchema } from "./protocol";
import { escapeRegExp, findMentions } from "./text-match";

type Span = { start: number; end: number };

/**
 * Code-read filters (named filters spec, 4.1 and 5.2; ADR 0023). A code-read filter is a filter whose meaning GridCue
 * reads with its own code. An Intent Provider is never asked what it means, and the request it is sent is the same with
 * or without one.
 *
 * A House Term (ADR 0024; spec 5.3) is one: a name the Host declares for fixed conditions on the rows. It is found as a
 * whole word by its label or an alias, ignoring letter case, with no plural form, the longest name first, and never in
 * quoted text or a declared name of a column or value. Each condition becomes a filter (`houseTerms` below). A term
 * left out ("not large", "hide large accounts"), where a column or an amount goes ("sort by large", "accounts under
 * large"), describing the rows' owner ("large households' accounts") or said as a statement ("accounts are large") is
 * read, so that no provider's pick can stand in for it, and the compiler asks (`termQuestion`).
 *
 * Text and empty forms are read only as the words the spec shows and nothing else:
 * - a text form: a column, then "starts with", "starting with", "begins with" or "beginning with", or "is exactly",
 *   "exactly", "=", "equals" or "equal to", then quoted text (`advisor starts with "Av"`);
 * - an empty form: a column with "is empty", "is blank", "is missing", "is not empty", "is not blank" or "isn't empty"
 *   after it, or "no", "without", "without a", "without an" or "without any" before it, or "has a", "have an" or
 *   "having a" before it; the last two kinds may end in "assigned" or "set" ("accounts with no advisor assigned").
 *
 * What it reads is not yet a decision: the compiler writes the filter only where the column's kind and the Host's
 * `allowedOperators` allow it, and otherwise asks. A part that holds a code-read filter is ready only when every word in
 * it is placed (`core/placed.ts`).
 *
 * Never read, so the part reads as before:
 * - the Row Noun as the column ("no accounts over $1m" is about the rows, and "account" is also a column's alias);
 * - a yes/no column with the form before it ("no restricted holdings" keeps today's reading). With the form after it
 *   ("cleared is empty") the form is read, and the compiler asks;
 * - an empty form on a number, currency or percent column followed by an amount or a comparison ("accounts with no
 *   gain over $50k" keeps today's reading);
 * - an empty form followed by quoted text, which is its column's own (`accounts without advisor "Lane"` asks, as
 *   before).
 * - a form said as a statement: "my" or "our" before its column ("my advisor is missing"); a possessive before its
 *   column ("my accounts' advisor is missing"); "every", "each", "all" or "any", or "this", "that", "these" or "those",
 *   before the column of a form that says something of it ("every advisor is empty", `each advisor starts with "Av"`,
 *   "that advisor is missing"); a form of "be" right before a form's words ("accounts are without an advisor",
 *   "accounts which were without an advisor"); a question word right before its column, with no name for the rows
 *   before it ("which advisor is missing"); only a preposition and the rows after a form that says something of its
 *   column ("advisor is empty for every account"); or "has" or "have" with no "that", "which" or "who" before it that
 *   describes the rows ("every account has an advisor", "my accounts have no advisor", "that account has no
 *   advisor"). See `statement`.
 * `advisor is "Lane"` is not a text form: it stays "containing".
 */

/**
 * The kinds of code-read filter read so far: a text form, an empty form, and a House Term (ADR 0024). Local Values and
 * dates join later.
 */
export type CodeReadKind = "text" | "empty" | "term";

/** The filter a code-read filter reads, on one column. */
export interface CodeReadPredicate {
  columnId: string;
  /** A text form reads `startsWith` or `eq`, and an empty form `isEmpty` or `isNotEmpty`. A House Term's condition may use any. */
  operator: FilterOperator;
  /**
   * The quoted text of a text form, as `normalize` keeps it (lower case), or a House Term's condition's value as the Host
   * declared it. An empty form has none.
   */
  value?: FilterValue;
}

/**
 * A code-read filter: where its words sit in which part, what kind it is, and the filter it reads. A House Term gives
 * one for each of its conditions, in the term's order, each over the same words.
 */
export interface CodeReadFilter extends CodeReadSpan {
  kind: CodeReadKind;
  predicate: CodeReadPredicate;
  /** For a House Term, its label as the Host declared it, also when the User typed an alias. The Preview names it. */
  term?: string;
}

/** An empty form after its column. */
const EMPTY_AFTER = /^ (?:(is (?:empty|blank|missing))|(is not (?:empty|blank)|isn't empty))(?![\p{L}\p{N}'])/u;
/** An empty form before its column. */
const EMPTY_BEFORE = /(?<![\p{L}\p{N}'])(?:(no|without(?: (?:a|an|any))?)|((?:has|have|having) (?:a|an))) $/u;
/** "My" or "our" right before a column: "my advisor is missing" says something about the User's own advisor. */
const OWN_BEFORE = /(?<![\p{L}\p{N}'])(my|our)\s+$/u;
/** A possessive right before a column: "my accounts' advisor is missing", "the client's advisor is blank". */
const POSSESSIVE_BEFORE = /(?<![\p{L}\p{N}'])([\p{L}\p{N}]+(?:'s|s'))\s+$/u;
/** "This", "that", "these" and "those": they pick out which ones, as a quantifier does. */
const DEMONSTRATIVES = ["this", "that", "these", "those"] as const;
/**
 * "Every", "each", "all" or "any", or "this", "that", "these" or "those", right before a column, with or without "of" or
 * "the": "every advisor is empty", "all the advisor is empty" and "that advisor is missing" say something of the
 * advisors they pick out.
 */
const PICKS_BEFORE = new RegExp(
  String.raw`(?<![\p{L}\p{N}'])((?:${[...QUANTIFIERS, ...DEMONSTRATIVES].join("|")})(?:\s+of)?(?:\s+the)?)\s+$`,
  "u",
);
/**
 * A form of "be" right before a form's words, or before the "with" that leads to them: "accounts are without an
 * advisor", "that account is with no advisor" and "accounts which were without an advisor" say what the rows are or
 * were. In "advisor is empty" the "is" is the form's own, and sits after its column. After "there" it says nothing of
 * the rows, and "there" is a word GridCue never places: "there is no advisor I trust" asks about "there" and "I"
 * (spec 5.2).
 */
const BE_BEFORE = /(?<![\p{L}\p{N}'])(?<!there\s+)(is|are|was|were|isn't|aren't|wasn't|weren't)(?:\s+with)?\s+$/u;
/**
 * A verb that says something of the column before it: "is" and "isn't" ("advisor is empty", `advisor is exactly "x"`),
 * "starts", "begins" and "equals". "Starting with", "beginning with", "exactly" and "equal to" describe the rows
 * instead: `all advisors starting with "Av"`.
 */
const SAYS_OF_COLUMN = /^ ?(?:is|isn't|starts|begins|equals)(?![\p{L}\p{N}'])/u;
/** "Has" or "have" right before an empty form's words: "accounts have no advisor". */
const HAS_BEFORE = /(?<![\p{L}\p{N}'])(?:has|have)\s+$/u;
/** "Has", "have" or "having" right before an empty form's words: "that account having no advisor". */
const HAVING_BEFORE = /(?<![\p{L}\p{N}'])(?:has|have|having)\s+$/u;
/**
 * "This", "that", "these" or "those" right before the noun for the rows, written here as "#" (`statement` marks the
 * noun so), at the end of the text: in "that account has no advisor" the "that" picks a row out and is no relative
 * word, wherever a name sits before it ("for taxable, that account has no advisor").
 */
const PICKED_ROWS = new RegExp(String.raw`(?<![\p{L}\p{N}'])(${DEMONSTRATIVES.join("|")})\s+(?:#\s+)*#\s*$`, "u");
/** A relative word: "that", "which" or "who". */
const RELATIVE = /(?<![\p{L}\p{N}'])(?:that|which|who)(?![\p{L}\p{N}'])/gu;
/** "Which", asking which rows: "which accounts have no advisor?". */
const WHICH = /(?<![\p{L}\p{N}'])which(?![\p{L}\p{N}'])/gu;
/** A question word right before a form's column: "which advisor is missing", "whose advisor is empty". */
const QUESTION_BEFORE = /(?<![\p{L}\p{N}'])(which|what|whose|who)\s+$/u;
/**
 * The words that pick rows out without narrowing them: "for every account", "in those accounts", "for all". "My" and
 * "our" are not among them: after a form, the placed-words check asks about them ("advisor is missing from my account").
 */
const PICK_WORDS = ["the", "a", "an", ...QUANTIFIERS, ...DEMONSTRATIVES, "of"] as const;
/**
 * A phrase that ends the part and is only a preposition, words from `PICK_WORDS` and the noun for the rows, written
 * here as "#" (`statement` marks the noun so): " for every account", " from the account", " for all".
 */
const ONLY_THE_ROWS = new RegExp(String.raw`^\s+(?:${PREPOSITIONS.join("|")})((?:\s+(?:${PICK_WORDS.join("|")}))*)(\s+#)?[\s.!?]*$`, "u");

/** A part's text, its schema, and its names (`saidIn`). */
interface Said {
  text: string;
  schema: ViewSchema;
  names: readonly Mention[];
}
/**
 * Where the part names rows: by a noun (`rowNouns`: the Row Noun, an entity word, "rows", "records" or "ones") or by a
 * named value ("trusts"). The entity word of the form's own column is no name for its rows: "advisor is missing from
 * advisor".
 */
const rowsIn = (said: Said, columnId: string): { nouns: Span[]; rows: Span[] } => {
  const nouns = rowNouns(unquoted(said.text), said.schema, new Set([columnId]));
  return { nouns, rows: [...nouns, ...said.names.filter((m) => m.valueId !== undefined)] };
};

/**
 * Where the rows' name ends after "which" at `from`, when it follows right after: "which accounts", "which of the
 * taxable accounts". A name is a noun for the rows or a named value; "of" and "the" may sit between.
 */
const rowsAfterWhich = (text: string, rows: readonly Span[], from: number): number | undefined => {
  let at = from;
  let named = false;
  for (;;) {
    const space = /^\s+/.exec(text.slice(at))?.[0].length ?? 0;
    const row = rows.filter((r) => r.start === at + space).sort((a, b) => b.end - a.end)[0];
    const small = /^(?:of|the)(?![\p{L}\p{N}'])/u.exec(text.slice(at + space));
    if (!space || (!row && !small)) return named ? at : undefined;
    at = row ? row.end : at + space + (small?.[0].length ?? 0);
    named ||= !!row;
  }
};
/**
 * Whether "has" or "have", starting at `verb`, describes the rows asked for. It does after a relative word: "that",
 * "which" or "who" after a name, the rows' or a column's ("accounts that have an advisor", "trusts which have no
 * advisor", "entries that aren't cleared and have no category"), or with no name between it and the verb ("those that
 * have no advisor"); and after "which" and the rows' name ("which accounts have no advisor?", "which accounts at
 * Northgate have no advisor"). The words between are checked as any others are: "accounts that also have an advisor"
 * is read, and "accounts that don't have an advisor" asks about "don't". In "that account has no advisor" the "that"
 * comes before the rows' name and picks one out, and "every account has an advisor" has no relative word: both say
 * something about the rows.
 */
const asksWhichHave = (said: Said, rows: readonly Span[], verb: number): boolean => {
  const before = said.text.slice(0, verb);
  const named = [...rows, ...said.names];
  const relative = (r: Span) => named.some((n) => n.end <= r.start) || !named.some((n) => n.start >= r.end && n.end <= verb);
  if ([...before.matchAll(RELATIVE)].some((r) => relative({ start: r.index, end: r.index + r[0].length }))) return true;
  return [...before.matchAll(WHICH)].some((w) => rowsAfterWhich(said.text, rows, w.index + w[0].length) !== undefined);
};

/**
 * The words around a form that make it a statement rather than a request, if any:
 * - "my advisor is missing" is about the User's own advisor;
 * - "my accounts' advisor is missing" and "the client's advisor is blank" are about someone's advisor;
 * - "every advisor is empty" says something of every advisor, and "that advisor is missing" of one. A quantifier or
 *   "those" before the rows ("every account with no advisor", "those accounts with no advisor") or inside a form's own
 *   words ("without any advisor") is read;
 * - "which advisor is missing" asks about the advisors, not for rows: a question word right before the column, with no
 *   name for the rows before it. "Accounts whose advisor is empty" is read;
 * - "accounts are without an advisor" and "accounts which were without an advisor" say what the rows are or were;
 * - "advisor is empty for every account" says something of every row: after a form that says something of its column,
 *   a phrase that ends the part and is only a preposition and the rows ("for all accounts", "from the account", "for
 *   all"). A phrase that narrows the rows is read: "advisor is empty for taxable accounts";
 * - "that account has no advisor", "every account has an advisor" or "my accounts have no advisor" says something
 *   about the rows. "Has" or "have" is read only where it describes the rows asked for (`asksWhichHave`).
 * `form` is where the form's words start and end in the part's text, and `column` where its column's name sits and
 * which column it is. `afterColumn` is the form's words after its column, if it has any there.
 */
const statement = (said: Said, form: Span, column: Span & { columnId: string }, afterColumn = ""): string | undefined => {
  const { text } = said;
  const before = text.slice(0, column.start);
  const own = OWN_BEFORE.exec(before) ?? POSSESSIVE_BEFORE.exec(before);
  if (own) return own[1];
  const saysOfColumn = SAYS_OF_COLUMN.test(afterColumn);
  const picks = saysOfColumn ? PICKS_BEFORE.exec(before) : null;
  if (picks) return picks[1];
  const { nouns, rows } = rowsIn(said, column.columnId);
  const question = QUESTION_BEFORE.exec(before);
  if (question && !rows.some((r) => r.end <= question.index)) return question[1];
  const be = BE_BEFORE.exec(text.slice(0, form.start));
  if (be) return be[1];
  const mark = (spans: readonly Span[]) =>
    spans.reduce((t, n) => t.slice(0, n.start) + "#".padEnd(n.end - n.start, " ") + t.slice(n.end), text);
  const marked = mark(nouns);
  const having = /^(?:has|have|having)\b/.exec(text.slice(form.start)) ? form.start : HAVING_BEFORE.exec(text.slice(0, form.start))?.index;
  const picked = having === undefined ? null : PICKED_ROWS.exec(mark(rows).slice(0, having));
  if (picked) return picked[1];
  if (saysOfColumn) {
    const only = ONLY_THE_ROWS.exec(marked.slice(form.end));
    if (only && (only[1] || only[2]))
      return text
        .slice(form.end)
        .trim()
        .replace(/[.!?]+$/, "");
  }
  const has = /^(?:has|have)\b/.exec(text.slice(form.start));
  const verb = has ? form.start : HAS_BEFORE.exec(text.slice(0, form.start))?.index;
  if (verb === undefined || asksWhichHave(said, rows, verb)) return undefined;
  return /^\S+/.exec(text.slice(verb))?.[0];
};
/**
 * The part's text and schema, and its names: its Mentions, and a column named by its own name wherever it sits
 * (`columnNames`), which the Mentions may have read as the rows ("show the owner that has a vendor").
 */
const saidIn = (clause: Clause, mentions: readonly Mention[], schema: ViewSchema): Said => ({
  text: clause.text,
  schema,
  names: [...mentions.filter((m) => m.clauseIndex === clause.index), ...columnNames(clause, mentions, schema)],
});
/** What may end an empty form written before its column. */
const ASSIGNED = /^ (?:assigned|set)(?![\p{L}\p{N}'])/u;
/** The kinds an amount or a comparison may follow on, where "no gain over $50k" is today's comparison. */
const AMOUNT_KINDS: ReadonlySet<string> = new Set(["number", "currency", "percent"]);
/** The comparison words read before an amount, as one pattern: "over", "less than", "at least", "between". */
const COMPARISON_WORDS =
  "over|under|above|below|exceeding|between|(?:more|greater|larger|bigger|higher|less|fewer|smaller|lower) than|at least|at most|up to|since|before|after";
/** A comparison word right after a form: "no advisor over $1m", "no gain at least $50k". */
/** The words that may lead a comparison: "accounts valued over $1m", "worth at least $5k". */
const COMPARISON_LEADS = "valued|worth";
const COMPARISON_NEXT = new RegExp(String.raw`^\s*(?:(?:${COMPARISON_LEADS})\s+)?(?:${COMPARISON_WORDS}|[<>=≤≥])`);
/** Every word the comparisons here are written with, taken from the patterns themselves, so it never falls behind them. */
const COMPARISON_WORD_SET: ReadonlySet<string> = new Set(`${COMPARISON_LEADS}|${COMPARISON_WORDS}`.match(/[a-z]+/g));
/**
 * Whether `word` (lower case) is one a comparison is written with, here or in `normalize`: "more", "than", "valued",
 * "worth". A House Term named only with such words would be found inside a comparison ("accounts valued over $1m"), so
 * `defineSchema` refuses one.
 */
export const inComparison = (word: string): boolean => COMPARISON_WORD_SET.has(word) || isComparisonWord(word);

/** "accounts", "account" and "entries", "entry" name the same noun. */
const singular = (words: string) =>
  words
    .toLowerCase()
    .trim()
    .replace(/ies$/, "y")
    .replace(/(?:es|s)$/, "");
/** Whether a Mention is the Row Noun, in either number: "accounts", "entry". */
export const isRowNoun = (clause: Pick<Clause, "text">, m: Pick<Mention, "start" | "end">, rowNoun: string | undefined) => {
  if (!rowNoun) return false;
  const said = singular(clause.text.slice(m.start, m.end));
  return said === singular(rowNoun) || said === rowNoun.toLowerCase().trim();
};

/** Whether an amount or a comparison follows a form's words: "accounts with no advisor over $1m". */
export const amountAfter = (clause: Clause, end: number): boolean => {
  const after = unquoted(clause.text).slice(end);
  if (COMPARISON_NEXT.test(after)) return true;
  const gap = /^\s*/.exec(after)?.[0].length ?? 0;
  return clause.literals.some((lit) => lit.kind !== "text" && lit.at === end + gap);
};

/** A comparison word or symbol, wherever it sits: the words `COMPARISON_NEXT` reads right after a form. */
const COMPARISON_ANYWHERE = new RegExp(
  String.raw`(?<![\p{L}\p{N}'])(?:${COMPARISON_LEADS}|${COMPARISON_WORDS})(?![\p{L}\p{N}'])|[<>=≤≥]`,
  "gu",
);
/** Where the first amount or comparison in a part sits from `from` on, if any. */
const firstAmount = (clause: Clause, from: number): number | undefined => {
  const words = [...unquoted(clause.text).slice(from).matchAll(COMPARISON_ANYWHERE)].map((m) => from + m.index);
  const amounts = clause.literals.filter((lit) => lit.kind !== "text" && lit.at >= from).map((lit) => lit.at);
  const all = [...words, ...amounts];
  return all.length > 0 ? Math.min(...all) : undefined;
};

/**
 * Whether an amount or a comparison follows a form's words with no name between them (spec 5.2). Such an amount names
 * no column of its own, so it could be the form's: "Advisor is empty and over 5%" may mean Advisor is over 5%. It looks
 * past "and" and a comma, and past the end of the part into the next one: "no advisor; over 5%". A name between them
 * gives the amount its own subject: "no advisor and market value over $1m", "no advisor and trusts over $1m".
 * `mentions` are the request's Mentions; `next` is the part after this one, if any.
 *
 * It returns what follows, for the question: `"date"` when it is a date ("no vendor after 2026-01-01"), and `"amount"`
 * for anything else, a comparison with nothing after it included.
 */
export const amountWithoutName = (
  clause: Clause,
  end: number,
  mentions: readonly Mention[],
  next?: Clause,
): "amount" | "date" | undefined => {
  const named = (part: Clause, from: number, to: number) =>
    mentions.some((m) => m.clauseIndex === part.index && m.start >= from && m.start < to);
  // The first amount or date from the comparison on. A comparison word comes before what it compares with.
  const kindAt = (part: Clause, at: number) =>
    part.literals.filter((lit) => lit.kind !== "text" && lit.at >= at).sort((a, b) => a.at - b.at)[0]?.kind === "date" ? "date" : "amount";
  const at = firstAmount(clause, end);
  if (at !== undefined) return named(clause, end, at) ? undefined : kindAt(clause, at);
  if (!next || named(clause, end, clause.text.length)) return undefined;
  const nextAt = firstAmount(next, 0);
  return nextAt !== undefined && !named(next, 0, nextAt) ? kindAt(next, nextAt) : undefined;
};

/** Words for no value: the empty forms' own ("empty", "blank", "missing"), their plurals, and "null". */
const NO_VALUE_WORDS = /(?<![\p{L}\p{N}'])(?:blanks?|empty|empties|nulls?|missing)(?![\p{L}\p{N}'])/gu;

/**
 * The words for no value in a part, outside its names and quoted text: "blanks" in "sort by advisor, blanks last".
 * Outside an empty form GridCue reads none of them, so the compiler asks about each, in a part with no code-read filter
 * (order plan, D4). Beside a code-read filter, the placed-words check asks about them already.
 */
export const emptyWordsOutside = (clause: Clause, mentions: readonly Mention[]): UnplacedWord[] => {
  const bare = mentions
    .filter((m) => m.clauseIndex === clause.index)
    .reduce((t, m) => t.slice(0, m.start) + " ".repeat(m.end - m.start) + t.slice(m.end), unquoted(clause.text));
  return [...bare.matchAll(NO_VALUE_WORDS)].map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
};

/** A word made with "-ly" from three letters or more: "largely", "mostly", "roughly", but not "only" or "ugly". */
const ADVERB = /(?<![\p{L}\p{N}'])\p{L}{3,}ly(?![\p{L}\p{N}'])/gu;
/** The text forms' own words ("exactly"), wherever they sit. */
const TEXT_FORM_WORDS = new RegExp(TEXT_MATCH_WORDS.map(([, words]) => `(?:${words})`).join("|"), "gu");
/** The first word at the start of some text, past spaces and commas. */
const FIRST_WORD = /^[\s,]*(\p{L}+)/u;
/**
 * The adverbs that say what a word GridCue reads or places says, so a part means the same with or without them: "only"
 * or "all" ("solely", "exclusively", "entirely", "fully", "wholly", "purely", "strictly", "completely"), and the
 * lead-in "now" ("currently", "presently", "quickly", "immediately"). "Accounts currently at Northgate" keeps the
 * Northgate accounts, as "accounts at Northgate" does. Any other adverb is asked about.
 */
const SAYS_A_READ_WORD: ReadonlySet<string> = new Set([
  "solely",
  "exclusively",
  "entirely",
  "fully",
  "wholly",
  "purely",
  "strictly",
  "completely",
  "currently",
  "presently",
  "quickly",
  "immediately",
]);

/**
 * The adverbs GridCue reads nowhere, in a part that keeps rows: "largely" in "accounts largely in retirement", "mostly"
 * in "accounts that are mostly taxable", "roughly" in "accounts roughly over $1m". Each says how a row meets what the
 * part keeps, which no filter holds, and read without it the part would keep rows the User did not ask for. So the
 * compiler asks about each, in a part with no code-read filter (order plan, D4), whatever House Terms are declared.
 *
 * An adverb is a word made with "-ly". A part keeps rows when it names a value, a yes-or-no column, an amount or a
 * date. Not counted: an adverb inside a name, quoted text or an amount; one GridCue reads, as an amount's comparison, a
 * text form's words, a sort's direction or a word on the placed-words lists ("only", "exactly", "alphabetically"); one
 * that says what such a word says (`SAYS_A_READ_WORD`: "solely", "currently"); and one right before a verb on those
 * lists, which speaks of the asking ("kindly show"). Beside a code-read filter the
 * placed-words check, and beside quoted text the compiler's checks there, ask about such words already.
 */
export const unreadAdverbs = (clause: Clause, mentions: readonly Mention[], schema: ViewSchema): UnplacedWord[] => {
  if (clause.literals.some((lit) => lit.kind === "text")) return [];
  const own = mentions.filter((m) => m.clauseIndex === clause.index);
  const yesNo = (m: Mention) => schema.columns.find((c) => c.id === m.columnId)?.kind === "boolean";
  if (clause.literals.length === 0 && !own.some((m) => m.valueId !== undefined || yesNo(m))) return [];
  const read: Span[] = [
    ...own,
    ...clause.literals.flatMap((lit) => [
      { start: lit.at, end: lit.at + literalText(clause.text, lit).length },
      ...comparisonSpans(clause.text, lit),
    ]),
  ];
  const text = unquoted(clause.text);
  const bare = read
    .reduce((t, s) => t.slice(0, s.start) + " ".repeat(Math.max(0, s.end - s.start)) + t.slice(s.end), text)
    .replace(TEXT_FORM_WORDS, (w) => " ".repeat(w.length));
  const { direction } = directionSpans(bare);
  return [...bare.matchAll(ADVERB)].flatMap((m) => {
    const end = m.index + m[0].length;
    if (direction && m.index >= direction.start && end <= direction.end) return [];
    if (onPlacedLists(m[0]) || SAYS_A_READ_WORD.has(m[0])) return [];
    const next = FIRST_WORD.exec(text.slice(end))?.[1];
    if (next !== undefined && isChangeVerb(next)) return [];
    return [{ start: m.index, end, text: clause.text.slice(m.index, end) }];
  });
};

/** Words made from a House Term's names, as one pattern, built once for each list of terms. */
const MADE_FROM_TERMS = new WeakMap<readonly HouseTerm[], RegExp>();
/** An ending a word drops before another is made from it: "large" gives "largely", "orphaned" gives "orphan". */
const ENDING = /(?:ed|es|s|e)$/u;
const madeFromTerms = (terms: readonly HouseTerm[]): RegExp => {
  const cached = MADE_FROM_TERMS.get(terms);
  if (cached) return cached;
  const names = terms
    .flatMap((term) => [term.label, ...(term.aliases ?? [])])
    .map((name) =>
      nameTokens(name).map((token) => {
        const stem = token.replace(ENDING, "");
        return `${escapeRegExp(stem.length >= 3 ? stem : token)}\\p{L}*`;
      }),
    )
    .filter((tokens) => tokens.length > 0)
    .sort((a, b) => b.length - a.length)
    .map((tokens) => tokens.join(String.raw`[\s\-_./]+`));
  const pattern = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${names.join("|")})(?![\p{L}\p{N}])`, "gu");
  MADE_FROM_TERMS.set(terms, pattern);
  return pattern;
};
/**
 * A word GridCue reads as an order, the words of a part's direction in `core/normalize.ts` ("largest", "oldest
 * first"). A comparison word ("larger than $2m") is read too, where it is an amount's (`comparisonSpans`).
 */
const READ_ORDER = /^(?:top|bottom|largest|biggest|highest|greatest|most|newest|latest|smallest|lowest|least|oldest|earliest)$/u;

/**
 * The words made from a House Term's name in a part, outside its names and quoted text: "largely" in "accounts largely
 * in taxable", "larger" in "show larger taxable accounts", "needed attention" for Needs attention. A term is found only
 * as a whole word, so GridCue reads none of them as the term, and the compiler asks about each in a part with no
 * code-read filter (order plan, D4): read without it, the part would drop the word. A size word GridCue reads as an
 * order ("largest") and the comparison words GridCue read for an amount ("larger than $2m") are read, and left alone.
 * "Larger than" with no amount after it is read for none ("accounts larger than taxable"), and asks. Beside a code-read
 * filter, the placed-words check asks about such words already. With no terms declared, there are none.
 */
export const termWordsOutside = (clause: Clause, mentions: readonly Mention[], schema: ViewSchema): UnplacedWord[] => {
  const terms = schema.houseTerms;
  if (!terms || terms.length === 0) return [];
  const masked = mentions
    .filter((m) => m.clauseIndex === clause.index)
    .reduce((t, m) => t.slice(0, m.start) + MASK.repeat(m.end - m.start) + t.slice(m.end), unquoted(clause.text, MASK));
  const found = [...masked.matchAll(madeFromTerms(terms))];
  if (found.length === 0) return [];
  // Worked out once for the part, not for each word.
  const compared = clause.literals.flatMap((lit) => comparisonSpans(clause.text, lit));
  return found.flatMap((m) => {
    const end = m.index + m[0].length;
    if (READ_ORDER.test(m[0]) || compared.some((s) => s.start <= m.index && end <= s.end)) return [];
    return [{ start: m.index, end, text: clause.text.slice(m.index, end) }];
  });
};

/** Whether a text form's own words, and nothing else, join a column to its quoted text: `advisor starts with "Av"`. */
const joinsTextForm = (clause: Clause, lit: Literal, column: Span): boolean => {
  if (lit.kind !== "text" || !lit.match || column.end > lit.at) return false;
  const words = TEXT_MATCH_WORDS.find(([kind]) => kind === lit.match)?.[1] ?? "$^";
  return new RegExp(`^ ?(?:${words}) ?$`, "u").test(clause.text.slice(column.end, lit.at));
};

/**
 * The words that make a text form a statement and not a request, if its words join this column to this quoted text:
 * "every" in `every advisor starts with "Av"`, "my" in `my advisor starts with "Av"`, "which" in `which advisor starts
 * with "Av"`. The compiler asks about them, rather than how to match the text: the form's own words are read elsewhere.
 * `mentions` are the request's Mentions, from `matchMentions` with `schema`.
 */
export const textFormStatement = (
  clause: Clause,
  lit: Literal,
  column: Span & { columnId: string },
  mentions: readonly Mention[],
  schema: ViewSchema,
): string | undefined =>
  joinsTextForm(clause, lit, column)
    ? statement(
        saidIn(clause, mentions, schema),
        { start: column.start, end: lit.at + literalText(clause.text, lit).length },
        column,
        clause.text.slice(column.end, lit.at),
      )
    : undefined;

/** The text form joined to its column by exactly its words, if any: `advisor starts with "Av"`. */
const textForm = (clause: Clause, columns: readonly Mention[], mentions: readonly Mention[], schema: ViewSchema): CodeReadFilter[] =>
  clause.literals.flatMap((lit) => {
    if (lit.kind !== "text" || !lit.match) return [];
    const column = columns
      .filter((m) => m.end <= lit.at)
      .sort((a, b) => a.end - b.end)
      .at(-1);
    if (!column || !joinsTextForm(clause, lit, column)) return [];
    // `my advisor starts with "Av"`, `every advisor is exactly "Avery Lane"`: a statement, not a request.
    if (textFormStatement(clause, lit, column, mentions, schema)) return [];
    return [
      {
        clauseIndex: clause.index,
        start: column.start,
        end: lit.at + literalText(clause.text, lit).length,
        kind: "text" as const,
        predicate: { columnId: column.columnId, operator: lit.match === "exact" ? "eq" : "startsWith", value: String(lit.value) },
      },
    ];
  });

/** The empty forms around each column: "advisor is empty", "no advisor", "having an advisor assigned". */
const emptyForms = (
  clause: Clause,
  columns: readonly Mention[],
  column: (id: string) => ColumnDescriptor | undefined,
  said: Said,
): CodeReadFilter[] =>
  columns.flatMap((m) => {
    const kind = column(m.columnId)?.kind;
    if (!kind) return [];
    const after = EMPTY_AFTER.exec(clause.text.slice(m.end));
    const before = EMPTY_BEFORE.exec(clause.text.slice(0, m.start));
    // Read one way only: "no advisor is empty" is neither.
    if (!after === !before) return [];
    // A yes/no column keeps today's reading of a form before it: "no restricted holdings" is No. A form after it
    // ("cleared is empty") is read, and the compiler asks: today's reading drops "empty" and shows Yes.
    if (kind === "boolean" && before) return [];
    const tail = before ? (ASSIGNED.exec(clause.text.slice(m.end))?.[0].length ?? 0) : 0;
    const start = before ? before.index : m.start;
    const end = after ? m.end + after[0].length : m.end + tail;
    // "My advisor is missing", "every advisor is empty", "every account has an advisor": a statement, not a request.
    if (statement(said, { start, end }, m, after?.[0])) return [];
    // "Accounts with no gain over $50k" is today's comparison on Unrealized gain.
    if (AMOUNT_KINDS.has(kind) && amountAfter(clause, end)) return [];
    // Quoted text right after is the column's own (`accounts without advisor "Lane"`): no empty form, and the part asks
    // as it did before.
    if (/^\s*"/.test(clause.text.slice(end))) return [];
    const notEmpty = after ? after[2] !== undefined : before?.[2] !== undefined;
    return [
      {
        clauseIndex: clause.index,
        start,
        end,
        kind: "empty" as const,
        predicate: { columnId: m.columnId, operator: notEmpty ? "isNotEmpty" : "isEmpty" },
      },
    ];
  });

/**
 * Where the part names a column by one of its declared names, whatever the words around it. The Mentions decide
 * whether a column's name means the rows ("accounts with …") or a column the provider should hear about, and they drop
 * a name before an amount it can't hold ("no advisor over $1m"). A form's words are fixed, so here the name is the
 * column wherever a form sits beside it. A name two columns share names neither; a named value is never a column.
 */
const columnNames = (clause: Clause, mentions: readonly Mention[], schema: ViewSchema): Mention[] => {
  const columns = schema.columns.filter(isExposed);
  const owners = new Map<string, Set<string>>();
  for (const col of columns)
    for (const name of [col.label, ...(col.aliases ?? [])]) {
      const key = name.trim().toLowerCase();
      owners.set(key, (owners.get(key) ?? new Set()).add(col.id));
    }
  const entries = columns.map((col) => ({
    item: col.id,
    names: [col.label, ...(col.aliases ?? [])].filter((name) => owners.get(name.trim().toLowerCase())?.size === 1),
  }));
  const values = mentions.filter((m) => m.clauseIndex === clause.index && m.valueId !== undefined);
  const masked = values.reduce((t, m) => t.slice(0, m.start) + " ".repeat(m.end - m.start) + t.slice(m.end), unquoted(clause.text));
  return findMentions(masked, entries).map((hit) => ({ clauseIndex: clause.index, columnId: hit.item, start: hit.start, end: hit.end }));
};

/**
 * The columns named right after a code-read filter's words. The Mentions read a name right after another name as the
 * rows ("Northgate accounts"), so in "entries with no counterparty booked after 2026-01-01" they name no Booked. The
 * name before it is the form's own, so here the column is named as it is with the form's words gone, and as it is in
 * "entries booked after 2026-01-01 with no counterparty". An entity word is added as the Mentions leave it, undecided,
 * so "accounts with no household advisor" asks rather than drop "advisor". The Row Noun is never added: "no advisor
 * accounts" is about the rows. These are for the compiler alone: the provider's request is built from the Mentions
 * `matchMentions` finds, and stays the same (ADR 0023).
 */
/** How many characters on each side of a code-read filter's words are read again for a column named after them. */
const NEAR = 200;
export const namesAfterCodeRead = (
  input: NormalizedInput,
  mentions: readonly Mention[],
  codeRead: readonly CodeReadSpan[],
  schema: ViewSchema,
): Mention[] => {
  if (codeRead.length === 0) return [];
  // A column's name starts with the first word of one of its names, so a place followed by no such word names no
  // column, and the part is not read again for it. A House Term's conditions share its words: each place is looked at
  // once.
  const firstWords = [
    ...new Set(
      schema.columns
        .filter(isExposed)
        .flatMap((col) => [col.label, ...(col.aliases ?? []), col.entity ?? ""])
        .flatMap((name) => nameTokens(name).slice(0, 1)),
    ),
  ];
  const nextWord = /\s*([\p{L}\p{N}]+)/uy;
  const seen = new Set<string>();
  return codeRead.flatMap((r) => {
    const place = `${r.clauseIndex}:${r.start}:${r.end}`;
    if (seen.has(place)) return [];
    seen.add(place);
    const clause = input.clauses.find((c) => c.index === r.clauseIndex);
    if (!clause) return [];
    nextWord.lastIndex = r.end;
    const word = nextWord.exec(clause.text)?.[1];
    if (!word || !firstWords.some((first) => word.startsWith(first))) return [];
    // A name found there would start where the next word does, and one of the Mentions already covers that place: it
    // would overlap it, and is never added.
    const at = nextWord.lastIndex - word.length;
    if (mentions.some((o) => o.clauseIndex === r.clauseIndex && o.start <= at && at < o.end)) return [];
    // Only the words near the place decide what is named there, so a long part is read again around it and not from
    // end to end for each place: the rest is blank, and every offset stays where it was.
    const from = r.start <= NEAR ? 0 : clause.text.lastIndexOf(" ", r.start - NEAR) + 1;
    const cut = r.end + NEAR >= clause.text.length ? -1 : clause.text.indexOf(" ", r.end + NEAR);
    const to = cut === -1 ? clause.text.length : cut;
    const text =
      " ".repeat(from) +
      clause.text.slice(from, r.start) +
      " ".repeat(r.end - r.start) +
      clause.text.slice(r.end, to) +
      " ".repeat(clause.text.length - to);
    return matchMentions([{ ...clause, text }], schema.columns.filter(isExposed), { rowNoun: schema.rowNoun }).filter(
      (m) =>
        m.valueId === undefined &&
        !isRowNoun(clause, m, schema.rowNoun) &&
        m.start >= r.end &&
        /^\s*$/.test(clause.text.slice(r.end, m.start)) &&
        !mentions.some((o) => o.clauseIndex === m.clauseIndex && o.start < m.end && m.start < o.end),
    );
  });
};

/** A House Term's names as one pattern, longest first, and the term each name belongs to. */
interface TermNames {
  pattern: RegExp;
  /** By the name's letters and digits alone, with no separators: "needs attention" is "needsattention". */
  byKey: ReadonlyMap<string, HouseTerm>;
  /**
   * The names said as a verb, by key: a name whose term also has the same words with an "s" more or less on the first
   * one, as a verb has for one row and for many ("needs attention" and "need attention"), and a name of several words
   * whose first ends in a verb's "s" ("needs attention", "breaches limit"), whatever else the Host declared.
   */
  verbs: ReadonlySet<string>;
}
/** Built once for each list of terms, so reading a part compiles nothing. */
const TERM_NAMES = new WeakMap<readonly HouseTerm[], TermNames>();
const nameTokens = (name: string): string[] => name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
/**
 * Stands in for a declared name or quoted text, keeping offsets. No House Term's name can match across it: it is no
 * letter, no digit and no separator.
 */
const MASK = "\u0000";
const termNames = (terms: readonly HouseTerm[]): TermNames => {
  const cached = TERM_NAMES.get(terms);
  if (cached) return cached;
  const byKey = new Map<string, HouseTerm>();
  const names: string[][] = [];
  const verbs = new Set<string>();
  for (const term of terms) {
    const own = [term.label, ...(term.aliases ?? [])].map(nameTokens);
    for (const tokens of own) {
      const key = tokens.join("");
      if (!key || byKey.has(key)) continue;
      byKey.set(key, term);
      names.push(tokens);
      const [head = "", ...rest] = tokens;
      const inflected = own.some(
        ([other = "", ...more]) => (other === `${head}s` || `${other}s` === head) && more.join(" ") === rest.join(" "),
      );
      // "Class A" and "Bonus eligible" end in "ss" and "us", which no verb's "s" does.
      const thirdPerson = rest.length > 0 && head.length >= 3 && /[^su]s$/u.test(head);
      if (inflected || thirdPerson) verbs.add(key);
    }
  }
  // Longest first: "needs attention" is read before a shorter name inside it. A name's words may be joined by spaces, a
  // hyphen, an underscore, a full stop or a slash, or by nothing, as a value's name is (`core/text-match.ts`). There is
  // no plural form: "large" and "largest" are different words.
  const alternatives = names
    .sort((a, b) => b.join(" ").length - a.join(" ").length)
    .map((tokens) => tokens.map(escapeRegExp).join(String.raw`[\s\-_./]*`));
  const pattern = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${alternatives.join("|")})(?![\p{L}\p{N}])`, "gu");
  const built = { pattern, byKey, verbs };
  TERM_NAMES.set(terms, built);
  return built;
};
/** Whether a House Term's words, as written in a part, are one of its names said as a verb (`TermNames.verbs`). */
const saidAsVerb = (words: string, schema: ViewSchema): boolean =>
  !!schema.houseTerms && termNames(schema.houseTerms).verbs.has(nameTokens(words).join(""));

/**
 * The House Terms a part names, as code-read filters: one for each condition, in the term's order, each over the term's
 * words. A term is found as a whole word by its label or an alias, ignoring letter case, the longest name first, and
 * never inside quoted text or a declared name of a column or value (`said.names`).
 */
const houseTerms = (clause: Clause, said: Said): CodeReadFilter[] => {
  const terms = said.schema.houseTerms;
  if (!terms || terms.length === 0) return [];
  const { pattern, byKey } = termNames(terms);
  const masked = said.names.reduce(
    (t, m) => t.slice(0, m.start) + MASK.repeat(m.end - m.start) + t.slice(m.end),
    unquoted(clause.text, MASK),
  );
  return [...masked.matchAll(pattern)].flatMap((hit) => {
    const term = byKey.get(nameTokens(hit[0]).join(""));
    if (!term) return [];
    const start = hit.index;
    const end = start + hit[0].length;
    return term.where.map((condition) => ({
      clauseIndex: clause.index,
      start,
      end,
      kind: "term" as const,
      predicate: { ...condition },
      term: term.label,
    }));
  });
};

/**
 * A word that leaves out what follows, right before a House Term's words, with only "the", "a", "an", "any", "those",
 * "these" or a form of "be" between: "not large", "aren't large", "non-large", "no big accounts", "except the large
 * ones", "all but large".
 */
const LEFT_OUT_BEFORE =
  /(?<![\p{L}\p{N}'])(?:not|no|non|never|nor|neither|without|except|excepting|excluding|besides|minus|other than|rather than|apart from|aside from|instead of|(?:all|anything|everything) but|\p{L}+n't)(?:[\s-]+(?:the|a|an|any|those|these|be|being|been))*[\s-]*$/u;
/** "By" right before a House Term's words, as in "sort by large": a column goes there. */
const BY_BEFORE = /(?<![\p{L}\p{N}'])by(?:\s+the)?\s+$/u;
/** "Column" right after a House Term's words, as in "the large column". */
const COLUMN_AFTER = /^\s+columns?(?![\p{L}\p{N}'])/u;
/** A form of "be" right before a House Term's words: "accounts are large" says something of the rows. */
const BE_BEFORE_TERM = /(?<![\p{L}\p{N}'])(is|are|was|were)\s+$/u;
/**
 * A comma, a semicolon, a colon or a joining word right before a House Term's words: "accounts at Northgate, large
 * only", "accounts in trust and large". The term is one more thing the User lists, not something said of the rows.
 */
const LISTED_BEFORE = /(?:[,;:]|(?<![\p{L}\p{N}'])(?:and|but|or|then|also|plus))\s*$/u;
/**
 * A comparison word or symbol right before a House Term's words, with "the", "a" or "an" between or nothing: "under
 * large", "larger than big", "> large". It compares with the term's threshold, which a term never holds as an amount.
 */
const COMPARED_BEFORE = new RegExp(
  String.raw`(?:(?<![\p{L}\p{N}'])(?:${COMPARISON_LEADS}|${COMPARISON_WORDS})|[<>=≤≥])(?:\s+(?:the|a|an))?\s*$`,
  "u",
);
/** A preposition right before a House Term's words, with "the", "a" or "an" between or nothing: "accounts at large". */
const PREPOSITION_BEFORE = new RegExp(String.raw`(?<![\p{L}\p{N}'])(?:${PREPOSITIONS.join("|")})(?:\s+(?:the|a|an))?\s+$`, "u");
/** An amount's own characters and the space after it, with no comma or joining word between it and what follows. */
const AMOUNT_THEN_TERM = /^[^\s,;:]+\s*$/u;
/** Nothing but the end of the part: punctuation or spaces. */
const PART_ENDS = /^[\s.!?]*$/u;
/** A possessive mark right after a noun: "households' accounts", "the advisor's accounts". */
const POSSESSIVE_MARK = /^(?:'s|')(?![\p{L}\p{N}])/u;
/**
 * A word made with "-ing" or "-ed" at the start of a House Term's words: after the rows, "needing attention" and
 * "unassigned" describe them, where "need attention" says something of them. "Need" itself ends in "eed", and is not
 * one.
 */
const PARTICIPLE = /^\p{L}{2,}(?:ing|(?<!e)ed)(?![\p{L}\p{N}])/u;
/** The opposite of a condition, with the words GridCue reads for it, for the question when a term is left out. */
const KEEP_WORDS: Partial<Record<FilterOperator, [FilterOperator, string]>> = {
  gt: ["lte", "at or below"],
  gte: ["lt", "below"],
  lt: ["gte", "at or above"],
  lte: ["gt", "above"],
  isEmpty: ["isNotEmpty", "is not empty"],
  isNotEmpty: ["isEmpty", "is empty"],
};
/** The column kinds an empty form is read on (spec 5.2): the opposite of an empty condition is typed as one. */
const EMPTY_FORM_KINDS: ReadonlySet<string> = new Set(["string", "enum", "date", "datetime"]);

/**
 * What a User can type to keep the rows a one-condition term leaves out, if GridCue reads it as that one filter:
 * "market value at or below $1,000,000" for Large. A term with more than one condition has no such filter: its opposite
 * is "either-or", which GridCue doesn't read.
 */
const keepInstead = (term: readonly CodeReadFilter[], schema: ViewSchema): string | undefined => {
  const [only] = term;
  if (term.length !== 1 || !only) return undefined;
  const { columnId, operator, value } = only.predicate;
  // `defineSchema` refuses a restricted condition; a schema built by hand never names a restricted column here either.
  const column = schema.columns.find((c) => c.id === columnId && isExposed(c));
  const opposite = KEEP_WORDS[operator];
  if (!column || !opposite || !operatorsFor(column).includes(opposite[0])) return undefined;
  const label = column.label.toLowerCase();
  if (operator === "isEmpty" || operator === "isNotEmpty") return EMPTY_FORM_KINDS.has(column.kind) ? `${label} ${opposite[1]}` : undefined;
  if (typeof value !== "number" || !["number", "currency", "percent"].includes(column.kind)) return undefined;
  return `${label} ${opposite[1]} ${formatAmount(value, column.kind)}`;
};

/**
 * The question for the first House Term in a part that GridCue can't read where it sits, if any (spec 4.1, 5.3).
 * `terms` are the part's terms, each as its filters at one place, from `readCodeFilters`. A term is read only as the
 * rows to keep:
 * - left out, it asks: "not large", "accounts that aren't large", "hide large accounts", "everyone except the large
 *   ones". Its opposite would also hide rows with no value, and a term with more than one condition has no single
 *   opposite (ADR 0024);
 * - where a column goes, it asks: "sort by large", "group by big", "the large column";
 * - where an amount goes, it asks: after a comparison word ("accounts under large", "larger than big"), or after a
 *   preposition with nothing after it ("accounts at large"), or right after an amount ("value over 1 mil", "gain 50k
 *   large"). "Under" is placed as a small word, and read so the part would keep the rows above the threshold, the
 *   opposite of what was asked;
 * - describing another thing's owner, it asks: "large households' accounts", "the big advisor's accounts";
 * - said as a statement, it asks: a form of "be" right before it ("accounts are large", "the account is big"), or the
 *   noun for the rows right before it ("the account needs attention", "accounts need attention"). A relative word that
 *   describes the rows ("accounts that are large") or "which" and the rows' name ("which accounts are large") makes it
 *   a request, as "has" and "have" are read before an empty form, and so does a term whose first word is made with
 *   "-ing" or "-ed" after the rows in the plural ("accounts needing attention", "accounts unassigned").
 * A part that leaves rows out and names a column ("hide the custodian column for large accounts") is left to the
 * compiler, which asks as it does beside any code-read filter.
 */
export const termQuestion = (
  terms: ReadonlyArray<readonly CodeReadFilter[]>,
  clause: Clause,
  mentions: readonly Mention[],
  schema: ViewSchema,
): { id: "leftOut" | "column" | "compared" | "possessive" | "statement"; prompt: string } | undefined => {
  if (terms.length === 0) return undefined;
  // What the part holds is worked out once, whatever the number of terms in it.
  const text = unquoted(clause.text);
  const leavesOut = leavesRowsOut(text) && !/(?<![\p{L}\p{N}'])columns?(?![\p{L}\p{N}'])/u.test(text);
  let part: { said: Said; rows: Span[]; nouns: Span[]; singulars: ReadonlySet<string> } | undefined;
  const statementParts = () => {
    if (part) return part;
    const said = saidIn(clause, mentions, schema);
    const singulars = new Set(
      [schema.rowNoun, ...schema.columns.filter(isExposed).map((c) => c.entity)].flatMap((n) =>
        n?.trim() ? [n.trim().toLowerCase()] : [],
      ),
    );
    part = { said, rows: rowsIn(said, "").rows, nouns: rowNouns(text, schema), singulars };
    return part;
  };
  for (const term of terms) {
    const [first] = term;
    if (!first) continue;
    const words = clause.text.slice(first.start, first.end);
    const before = text.slice(0, first.start);
    const after = text.slice(first.end);
    if (leavesOut || LEFT_OUT_BEFORE.test(before)) {
      const keep = keepInstead(term, schema);
      return {
        id: "leftOut",
        prompt: `GridCue can't leave out “${words}” yet. Ask for the rows to keep${keep ? `, such as “${keep}”` : ""}.`,
      };
    }
    if (BY_BEFORE.test(before) || COLUMN_AFTER.test(after)) {
      const column = schema.columns.find((c) => c.id === first.predicate.columnId && isExposed(c));
      return {
        id: "column",
        prompt: `“${words}” stands for rows, not a column. Name a column instead${column ? `, such as ${column.label}` : ""}.`,
      };
    }
    // A term describes rows, so it never stands where an amount or a noun goes: "accounts under large" would keep the
    // rows above the threshold, the opposite of what was asked, and "accounts at large" names no rows.
    const compared = COMPARED_BEFORE.exec(before);
    const placedAfter = compared ? undefined : PREPOSITION_BEFORE.exec(before);
    const bare = compared ?? (placedAfter && PART_ENDS.test(after) ? placedAfter : undefined);
    if (bare) return { id: "compared", prompt: placedPrompt(clause.text.slice(bare.index, first.end).trim()) };
    // Nor does it stand right after an amount, where a unit or what the amount counts goes: "value over 1 mil" would
    // read the amount without its unit, and "gain 50k large" would read it as "equal to". A term whose first word is
    // made with "-ing" or "-ed" describes the rows there, as it does after their noun: "accounts over $1m unassigned".
    const amount = clause.literals.find(
      (lit) => AMOUNT_KINDS.has(lit.kind) && lit.at < first.start && AMOUNT_THEN_TERM.test(text.slice(lit.at, first.start)),
    );
    if (amount && !PARTICIPLE.test(words)) return { id: "compared", prompt: placedPrompt(clause.text.slice(amount.at, first.end).trim()) };
    const { said, rows, nouns, singulars } = statementParts();
    // The noun the term describes, past the other words that describe it ("large taxable households"). A possessive
    // after it makes it another thing's owner: "large households' accounts" are the accounts of large households, and
    // the term says nothing of the rows.
    const owner = describedNoun(first.end, term, terms, said, nouns);
    if (owner && POSSESSIVE_MARK.test(clause.text.slice(owner.end))) {
      const mark = POSSESSIVE_MARK.exec(clause.text.slice(owner.end))?.[0] ?? "";
      return { id: "possessive", prompt: placedPrompt(clause.text.slice(first.start, owner.end + mark.length)) };
    }
    const be = BE_BEFORE_TERM.exec(before);
    if (be && !asksWhichHave(said, rows, be.index)) return { id: "statement", prompt: placedPrompt(be[1] ?? "") };
    if (be || owner || LISTED_BEFORE.test(before) || asksWhichHave(said, rows, first.start)) continue;
    // The noun for the rows right before a term says something of them ("the account needs attention", "accounts need
    // attention"), unless the term's first word is made with "-ing" or "-ed" and describes the rows in the plural
    // ("accounts needing attention", "accounts unassigned"). With other words between, the rows named by a noun or a
    // value say something of a term said as a verb ("these accounts at Northgate need attention", "trusts need
    // attention"), and a noun in the singular of any term ("the account at Northgate needs attention"). A term said
    // after the rows as a word that describes them is read: "accounts at Northgate large". So is one listed after a
    // comma or a joining word ("show accounts, need attention"), one before the noun it describes ("accounts at
    // Northgate: large accounts"), and one a relative word or "which" asks for ("accounts at Northgate that need
    // attention"). The question names the words from the noun for the rows, or with none, from the first value.
    const noun = /(\S+)\s+$/.exec(before);
    const next = noun && nouns.find((n) => n.end === noun.index + (noun[1]?.length ?? 0));
    const isSingular = (n: Span) => singulars.has(text.slice(n.start, n.end));
    if (next && (isSingular(next) || !PARTICIPLE.test(words))) {
      return { id: "statement", prompt: placedPrompt(clause.text.slice(next.start, first.end)) };
    }
    const earlier = (spans: readonly Span[]) => spans.filter((n) => n.end <= first.start).sort((a, b) => a.start - b.start)[0];
    const subject = earlier(nouns) ?? earlier(rows);
    const singular = nouns.some((n) => n.end <= first.start && isSingular(n));
    if (subject && (singular || saidAsVerb(words, schema))) {
      return { id: "statement", prompt: placedPrompt(clause.text.slice(subject.start, first.end)) };
    }
  }
  return undefined;
};

/**
 * The noun a term at `from` describes: the first noun for rows (`nouns`) or name of a column after it, past spaces, the
 * part's other terms, and named values or yes/no columns ("large taxable households", "big restricted accounts").
 */
const describedNoun = (
  from: number,
  term: readonly CodeReadFilter[],
  terms: ReadonlyArray<readonly CodeReadFilter[]>,
  said: Said,
  nouns: readonly Span[],
): Span | undefined => {
  const yesNo = (m: Mention) => m.valueId === undefined && said.schema.columns.find((c) => c.id === m.columnId)?.kind === "boolean";
  const describing: Span[] = [
    ...terms.filter((t) => t !== term).flatMap((t) => (t[0] ? [t[0]] : [])),
    ...said.names.filter((m) => m.valueId !== undefined || yesNo(m)),
  ];
  const named: Span[] = [...nouns, ...said.names.filter((m) => m.valueId === undefined && !yesNo(m))];
  let at = from;
  for (;;) {
    const space = /^\s*/.exec(said.text.slice(at))?.[0].length ?? 0;
    const start = at + space;
    const noun = named.filter((n) => n.start === start).sort((a, b) => b.end - a.end)[0];
    if (noun) return noun;
    const next = describing.filter((d) => d.start === start).sort((a, b) => b.end - a.end)[0];
    if (!next || next.end <= at) return undefined;
    at = next.end;
  }
};
/** ADR 0019's question, for words GridCue can't place. */
const placedPrompt = (words: string) => `I'm not sure what to do with “${words}”. Try rephrasing that part.`;

/**
 * The code-read filters in a request, part by part, in the order written. `mentions` are the request's Mentions, from
 * `matchMentions` with the same schema; their values are never read as a column. A filter's words never overlap
 * another reading's; where two readings would, neither is kept, and the part reads as before. A House Term's conditions
 * share its words, and are one reading.
 */
export const readCodeFilters = (input: NormalizedInput, mentions: readonly Mention[], schema: ViewSchema): CodeReadFilter[] => {
  const column = (id: string) => schema.columns.find((col) => col.id === id);
  return input.clauses.flatMap((clause) => {
    // A column named by its own name, never the Row Noun.
    const columns = columnNames(clause, mentions, schema).filter((m) => !isRowNoun(clause, m, schema.rowNoun));
    const said = saidIn(clause, mentions, schema);
    const found = [
      ...textForm(clause, columns, mentions, schema),
      ...emptyForms(clause, columns, column, said),
      ...houseTerms(clause, said),
    ];
    const apart = (f: CodeReadFilter, g: CodeReadFilter) =>
      g === f || (f.kind === "term" && g.kind === "term" && g.start === f.start && g.end === f.end) || g.start >= f.end || f.start >= g.end;
    // Sorted by where each starts; a term's conditions keep their order.
    return found.filter((f) => found.every((g) => apart(f, g))).sort((a, b) => a.start - b.start);
  });
};
