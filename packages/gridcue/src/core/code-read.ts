import { type Mention, matchMentions } from "./mentions";
import { type Clause, literalText, type NormalizedInput, TEXT_MATCH_WORDS, unquoted } from "./normalize";
import type { CodeReadSpan, UnplacedWord } from "./placed";
import type { ColumnDescriptor, FilterOperator, ViewSchema } from "./protocol";
import { isExposed } from "./schema";
import { findMentions } from "./text-match";

/**
 * Code-read filters (named filters spec, 4.1 and 5.2; ADR 0023). A code-read filter is a filter whose meaning GridCue
 * reads with its own code. An Intent Provider is never asked what it means, and the request it is sent is the same with
 * or without one.
 *
 * This PR reads two kinds, each only as the words the spec shows and nothing else:
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
 * - a form said as a statement: "my" or "our" before its column ("my advisor is missing"), or "has" or "have" with no
 *   "that", "which" or "who" before it ("every account has an advisor", "my accounts have no advisor").
 * `advisor is "Lane"` is not a text form: it stays "containing".
 */

/** The two kinds of code-read filter this PR reads. House Terms, Local Values and dates join later. */
export type CodeReadKind = "text" | "empty";

/** The filter a code-read filter reads, on one column. */
export interface CodeReadPredicate {
  columnId: string;
  operator: Extract<FilterOperator, "startsWith" | "eq" | "isEmpty" | "isNotEmpty">;
  /** The quoted text of a text form, as `normalize` keeps it (lower case). An empty form has none. */
  value?: string;
}

/** A code-read filter: where its words sit in which part, what kind it is, and the filter it reads. */
export interface CodeReadFilter extends CodeReadSpan {
  kind: CodeReadKind;
  predicate: CodeReadPredicate;
}

/** An empty form after its column. */
const EMPTY_AFTER = /^ (?:(is (?:empty|blank|missing))|(is not (?:empty|blank)|isn't empty))(?![\p{L}\p{N}'])/u;
/** An empty form before its column. */
const EMPTY_BEFORE = /(?<![\p{L}\p{N}'])(?:(no|without(?: (?:a|an|any))?)|((?:has|have|having) (?:a|an))) $/u;
/** "My" or "our" right before a column: "my advisor is missing" says something about the User's own advisor. */
const OWN_BEFORE = /(?<![\p{L}\p{N}'])(?:my|our)\s+$/u;
/** "Has" or "have" right before an empty form's words: "accounts have no advisor". */
const HAS_BEFORE = /(?<![\p{L}\p{N}'])(?:has|have)\s+$/u;
/** A relative word, which makes "has" or "have" describe the rows asked for: "accounts that have an advisor". */
const RELATIVE = /(?<![\p{L}\p{N}'])(?:that|which|who)(?![\p{L}\p{N}'])/u;
/**
 * Whether the words before a form make it a statement rather than a request: "my advisor is missing" is about the
 * User's own advisor, and "every account has an advisor" or "my accounts have no advisor" says something about the
 * rows. A "has" or "have" with "that", "which" or "who" before it describes the rows asked for, and is read.
 * `formStart` is where the form's words start in the part's text, and `columnStart` where its column's name does.
 */
const statement = (text: string, formStart: number, columnStart: number): boolean => {
  if (OWN_BEFORE.test(text.slice(0, columnStart))) return true;
  const verb = /^(?:has|have)\b/.test(text.slice(formStart)) ? formStart : HAS_BEFORE.exec(text.slice(0, formStart))?.index;
  return verb !== undefined && !RELATIVE.test(text.slice(0, verb));
};
/** What may end an empty form written before its column. */
const ASSIGNED = /^ (?:assigned|set)(?![\p{L}\p{N}'])/u;
/** The kinds an amount or a comparison may follow on, where "no gain over $50k" is today's comparison. */
const AMOUNT_KINDS: ReadonlySet<string> = new Set(["number", "currency", "percent"]);
/** A comparison word right after a form: "no advisor over $1m", "no gain at least $50k". */
const COMPARISON_NEXT =
  /^\s*(?:(?:valued|worth)\s+)?(?:over|under|above|below|exceeding|between|(?:more|greater|larger|bigger|higher|less|fewer|smaller|lower) than|at least|at most|up to|since|before|after|[<>=≤≥])/;

/** "accounts", "account" and "entries", "entry" name the same noun. */
const singular = (words: string) =>
  words
    .toLowerCase()
    .trim()
    .replace(/ies$/, "y")
    .replace(/(?:es|s)$/, "");
const isRowNoun = (clause: Clause, m: Mention, rowNoun: string | undefined) => {
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
const COMPARISON_ANYWHERE =
  /(?<![\p{L}\p{N}'])(?:valued|worth|over|under|above|below|exceeding|between|(?:more|greater|larger|bigger|higher|less|fewer|smaller|lower) than|at least|at most|up to|since|before|after)(?![\p{L}\p{N}'])|[<>=≤≥]/gu;
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
 */
export const amountWithoutName = (clause: Clause, end: number, mentions: readonly Mention[], next?: Clause): boolean => {
  const named = (part: Clause, from: number, to: number) =>
    mentions.some((m) => m.clauseIndex === part.index && m.start >= from && m.start < to);
  const at = firstAmount(clause, end);
  if (at !== undefined) return !named(clause, end, at);
  if (!next || named(clause, end, clause.text.length)) return false;
  const nextAt = firstAmount(next, 0);
  return nextAt !== undefined && !named(next, 0, nextAt);
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

/** The text form joined to its column by exactly its words, if any: `advisor starts with "Av"`. */
const textForm = (clause: Clause, columns: readonly Mention[]): CodeReadFilter[] =>
  clause.literals.flatMap((lit) => {
    if (lit.kind !== "text" || !lit.match) return [];
    const column = columns
      .filter((m) => m.end <= lit.at)
      .sort((a, b) => a.end - b.end)
      .at(-1);
    if (!column) return [];
    const words = TEXT_MATCH_WORDS.find(([kind]) => kind === lit.match)?.[1] ?? "$^";
    if (!new RegExp(`^ ?(?:${words}) ?$`, "u").test(clause.text.slice(column.end, lit.at))) return [];
    if (statement(clause.text, column.start, column.start)) return [];
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
const emptyForms = (clause: Clause, columns: readonly Mention[], column: (id: string) => ColumnDescriptor | undefined): CodeReadFilter[] =>
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
    // "My advisor is missing", "every account has an advisor": a statement, not a request.
    if (statement(clause.text, start, m.start)) return [];
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
export const namesAfterCodeRead = (
  input: NormalizedInput,
  mentions: readonly Mention[],
  codeRead: readonly CodeReadSpan[],
  schema: ViewSchema,
): Mention[] =>
  codeRead.flatMap((r) => {
    const clause = input.clauses.find((c) => c.index === r.clauseIndex);
    if (!clause) return [];
    const text = clause.text.slice(0, r.start) + " ".repeat(r.end - r.start) + clause.text.slice(r.end);
    return matchMentions([{ ...clause, text }], schema.columns.filter(isExposed), { rowNoun: schema.rowNoun }).filter(
      (m) =>
        m.valueId === undefined &&
        !isRowNoun(clause, m, schema.rowNoun) &&
        m.start >= r.end &&
        /^\s*$/.test(clause.text.slice(r.end, m.start)) &&
        !mentions.some((o) => o.clauseIndex === m.clauseIndex && o.start < m.end && m.start < o.end),
    );
  });

/**
 * The code-read filters in a request, part by part, in the order written. `mentions` are the request's Mentions, from
 * `matchMentions` with the same schema; their values are never read as a column. A filter's words never overlap
 * another's; where two readings would, neither is kept, and the part reads as before.
 */
export const readCodeFilters = (input: NormalizedInput, mentions: readonly Mention[], schema: ViewSchema): CodeReadFilter[] => {
  const column = (id: string) => schema.columns.find((col) => col.id === id);
  return input.clauses.flatMap((clause) => {
    // A column named by its own name, never the Row Noun.
    const columns = columnNames(clause, mentions, schema).filter((m) => !isRowNoun(clause, m, schema.rowNoun));
    const found = [...textForm(clause, columns), ...emptyForms(clause, columns, column)].sort((a, b) => a.start - b.start);
    return found.filter((f) => !found.some((g) => g !== f && g.start < f.end && f.start < g.end));
  });
};
