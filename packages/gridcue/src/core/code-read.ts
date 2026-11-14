import { type Mention, matchMentions } from "./mentions";
import { type Clause, type Literal, literalText, type NormalizedInput, TEXT_MATCH_WORDS, unquoted } from "./normalize";
import { type CodeReadSpan, PREPOSITIONS, QUANTIFIERS, rowNouns, type UnplacedWord } from "./placed";
import type { ColumnDescriptor, FilterOperator, ViewSchema } from "./protocol";
import { isExposed } from "./schema";
import { findMentions } from "./text-match";

type Span = { start: number; end: number };

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
    const said = saidIn(clause, mentions, schema);
    const found = [...textForm(clause, columns, mentions, schema), ...emptyForms(clause, columns, column, said)].sort(
      (a, b) => a.start - b.start,
    );
    return found.filter((f) => !found.some((g) => g !== f && g.start < f.end && f.start < g.end));
  });
};
