export type Comparator = "eq" | "gt" | "gte" | "lt" | "lte" | "between";
/** `unreadable` marks a number whose format is ambiguous, such as "1.000.000". GridCue asks rather than guesses. */
export type LiteralKind = "number" | "currency" | "percent" | "date" | "text" | "unreadable";

export interface Literal {
  kind: LiteralKind;
  value: number | string;
  /** Upper bound for `between`. */
  upper?: number | string;
  comparator?: Comparator;
  /** Character offset of the literal within its clause. */
  at: number;
}

export interface Clause {
  index: number;
  text: string;
  literals: Literal[];
  direction?: "asc" | "desc";
  /**
   * Set when a verb-less part ("then advisor", "then by advisor") took the sort or group verb of the part before
   * it. The compiler uses it to read a value there ("then Northgate") as a filter, not a level.
   */
  continues?: "sort" | "group";
  /** How many rows a ranking asks for: "top 10", "largest 5" (ADR 0018). That number is not a literal. */
  limit?: number;
  /**
   * Set on what a clear or reset says to keep: "accounts over $1m" in "clear filters except accounts over $1m". The
   * compiler keeps it only when the current view already has it.
   */
  keeps?: true;
}

export interface NormalizedInput {
  text: string;
  clauses: Clause[];
}

/** Words that start a new instruction. A comma or "and" before one of these splits the request. */
const CLAUSE_VERBS = [
  "show",
  "only",
  "keep",
  "hide",
  "group",
  "ungroup",
  "sort",
  "order",
  "filter",
  "clear",
  "reset",
  "remove",
  "display",
  "list",
  "include",
  "exclude",
  "place",
  "sell",
  "buy",
  "trade",
  "submit",
  "export",
  "download",
  "email",
  "send",
  "delete",
  "edit",
  "update",
  "open",
  "go",
  "navigate",
  "make",
  "put",
  "approve",
];
const QUOTED = /"([^"]+)"/g;
/**
 * Blanks quoted spans, keeping offsets, so words inside a quoted value never read as an instruction, a size or a count.
 * With `mark`, a single character, each span starts with it, so the words on either side of the span don't touch.
 */
export const unquoted = (text: string, mark = " "): string => text.replace(QUOTED, (s) => mark + " ".repeat(s.length - 1));

const VERB_ALT = CLAUSE_VERBS.join("|");
const VERB = `(?:${VERB_ALT})(?:ed)?\\b`;
// "!=" is a comparison, not the end of a sentence. A "!" ends a sentence only right after a word ("show trusts!"):
// one that starts the request, follows a space, or sits right before a name, quoted text or an amount says "not"
// (`!advisor "Lane"`, `advisor "Lane" !trusts`), so it stays in the part, and the compiler asks about it.
const SPLIT = new RegExp(
  `[;?]+|(?<=\\S)!+(?![=\\w"'$\\u00c0-\\uffff])|\\.(?=\\s|$)|,?\\s+then\\s+|,\\s*(?=${VERB})|\\s+and\\s+(?=${VERB})`,
  "g",
);

/**
 * A change that starts mid-line with no comma or "and" before it: "grouped by household sorted largest to smallest",
 * "sort by value only trusts", "group by advisor where value is over 1m". "Order" counts only before "by" or a
 * direction, so "in descending order" never starts a part.
 */
const MID_LINE_VERB =
  /\s(?=(?:sort|order|group)(?:ed)?\s+(?:by|on|from|largest|biggest|smallest|highest|lowest|ascending|descending)\b|(?:show|only|where)\s+\S|filter(?:ed)?\s+(?:to|by|on|for|out|where)\b)/g;
const INSTRUCTION_WORD = new RegExp(`\\b(${VERB_ALT}|where)(?:ed)?\\b`, "g");
/** The kind of change a verb starts. "Show", "only" and "where" all choose rows, so they never split from each other. */
const verbFamily = (verb: string): string =>
  /^(?:sort|order)/.test(verb)
    ? "sort"
    : /^group/.test(verb)
      ? "group"
      : /^(?:show|only|filter|where|keep|display|list|include|exclude)/.test(verb)
        ? "filter"
        : verb;

/**
 * Splits a part where a different kind of change starts mid-line (ADR 0018). The text before it must already give
 * an instruction with words after its verb, so "Roth IRAs grouped by rep" stays one part (the value describes the rows)
 * and "show only trusts" never splits after "show". A second verb of the same kind ("show accounts where …") stays in
 * its part.
 */
/** Words that name rows and nothing else: "accounts", "the rows", "all those records". */
const ROWS_ONLY = /^(?: (?:the|all|any|those|these|rows?|records?|ones|[a-z]+s))+ ?$/;
const splitMidLine = (part: string): string[] => {
  const out: string[] = [];
  const bare = unquoted(part);
  let start = 0;
  for (const m of bare.matchAll(MID_LINE_VERB)) {
    const at = m.index ?? 0;
    const before = bare.slice(start, at);
    const last = [...before.matchAll(INSTRUCTION_WORD)].at(-1);
    const next = bare.slice(at + 1).match(/^[a-z]+/)?.[0] ?? "";
    // A quoted argument counts as words after the verb: 'hide "market value" sorted by name' (review fix).
    if (
      !last ||
      !part
        .slice(start, at)
        .slice((last.index ?? 0) + last[0].length)
        .trim()
    )
      continue;
    if (verbFamily(last[1] ?? "") === verbFamily(next)) continue;
    // "Hide accounts where gain is below $0": the "where" says which rows to leave out, so it stays one part.
    if (
      next === "where" &&
      /^(?:hide|exclude|remove|drop)$/.test(last[1] ?? "") &&
      ROWS_ONLY.test(before.slice((last.index ?? 0) + last[0].length))
    )
      continue;
    out.push(part.slice(start, at));
    start = at + 1;
  }
  out.push(part.slice(start));
  return out;
};

/**
 * A ranking with a count: "top 10", "largest 5 households", "top 10,000". Its number is the count, never a filter value
 * (ADR 0018).
 */
const COUNT =
  /\b(?:top|largest|biggest|smallest)\s+([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)\b(?!\s*(?:%|percent\b|k\b|thousand\b|mm?\b|million\b|bn?\b|billion\b|dollars\b|[.,]\d))/;

/**
 * The comparison read before an amount, first match wins. Symbols count with or without spaces around them ("> $1m",
 * "value>$1m"). The two-part phrases come first, so "at or above" is never read as "above", and "less than or equal
 * to" never as "equal to".
 */
const MORE = "(?:more|greater|larger|bigger|higher)";
const LESS = "(?:less|fewer|smaller|lower)";
const COMPARATORS: Array<[RegExp, Comparator]> = [
  // "No greater than" and "not more than" are "at most"; "no lower than" and "not less than" are "at least".
  [
    new RegExp(
      `(?:\\b(?:(?:under|below|${LESS})(?: than)? or equal to|at or below|on or before|(?:no|not) ${MORE} than|at most|up to)|<=|=<|≤)\\s*$`,
    ),
    "lte",
  ],
  [
    new RegExp(
      `(?:\\b(?:(?:over|above|${MORE})(?: than)? or equal to|at or above|on or after|(?:no|not) ${LESS} than|at least|minimum of|since)|>=|=>|≥)\\s*$`,
    ),
    "gte",
  ],
  [new RegExp(`(?:\\b(?:over|above|${MORE} than|exceeding)|(?<![<=])>)\\s*$`), "gt"],
  [new RegExp(`(?:\\b(?:under|below|${LESS} than|before|earlier than)|<)\\s*$`), "lt"],
  [/\b(?:after|later than)\s*$/, "gt"],
  // "=/=" and "!=" are not "equal to", and GridCue reads no "not equal to" from a request: they are asked about.
  [/(?:\b(?:equal to|equals|exactly)|(?<![<>=!/])==?)\s*$/, "eq"],
];
/**
 * A comparison after the amount: "$1m or more", "$500k and up", "$1m+", "$1m at most", "$10k minimum", "2024-01-01 or
 * later", "$1m exactly". Never when more words change it again: "$1m or more or less".
 */
const COMPARATORS_AFTER: Array<[RegExp, Comparator]> = [
  [/^ ?(?:\+|(?:or|and) (?:more|above|over|higher|greater|up)\b|at (?:the )?least\b|min(?:imum)?\b|or better\b)(?! or\b| and\b)/, "gte"],
  [/^ ?(?:(?:or|and) (?:less|below|under|lower|fewer|down)\b|at (?:the )?most\b|max(?:imum)?\b|tops\b)(?! or\b| and\b)/, "lte"],
  [/^ ?exactly\b(?! or\b| and\b)/, "eq"],
];
/** Time words after a date only: "2024-01-01 or later". After any other amount they are asked about. */
const DATE_COMPARATORS_AFTER: Array<[RegExp, Comparator]> = [
  [/^ ?(?:(?:or|and) (?:later|after|beyond)\b|at the earliest\b)(?! or\b| and\b)/, "gte"],
  [/^ ?(?:(?:or|and) (?:earlier|before|prior)\b|at the latest\b)(?! or\b| and\b)/, "lte"],
];
/** The comparison written right after an amount, and how many characters it takes. */
export const trailingComparison = (after: string, date = false): { comparator: Comparator; length: number } | undefined => {
  for (const [re, comparator] of date ? [...DATE_COMPARATORS_AFTER, ...COMPARATORS_AFTER] : COMPARATORS_AFTER) {
    const m = re.exec(after);
    if (m) return { comparator, length: m[0].length };
  }
  return undefined;
};
/** A negation right before a comparison word reverses it ("not over"). GridCue asks rather than reverse it. */
const NEGATED_COMPARISON = /\b(?:not|no|isn't|aren't|never)\s*$/;

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

/**
 * An amount, with an optional sign: "-$50k", "$-50k", "negative $50k". A minus counts only as a sign, never as a
 * hyphen ("non-retirement", "$50k-$100k", "2020-2024"); `extractLiterals` checks what sits before it.
 */
const NUMBER =
  /(?:(?<=^|[\s(<>=≤≥:])([-−])|\b(?:negative|minus)\s+)?(?:(\$)\s?)?([-−])?(\d[\d,.]*\d|\d)\s*(k|thousand|mm|m|million|bn|b|billion)?\b\s*(%|percent\b|dollars\b)?/g;
/** An amount just before a minus makes it a range, not a sign: "between $50k - $100k". */
// Run on a short tail only (`hyphenAfterAmount`): blanked quoted text and dates can leave long runs of spaces.
const AMOUNT_BEFORE = /\d ?(?:(?:k|thousand|mm|m|million|bn|b|billion) ?)?(?:(?:%|percent|dollars) ?)?$/;
const hyphenAfterAmount = (text: string, at: number) => AMOUNT_BEFORE.test(text.slice(Math.max(0, at - 16), at).replace(/\s+/g, " "));
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const DESC =
  /\b(?:largest|biggest|highest|greatest|most|top|newest|latest)\b[^,]*?\bfirst\b|\bdescending\b|\bhigh(?:est)? to low(?:est)?\b|\bdesc\b/;
const ASC =
  /\b(?:smallest|lowest|least|oldest|earliest)\b[^,]*?\bfirst\b|\bascending\b|\blow(?:est)? to high(?:est)?\b|\ba to z\b|\balphabetical(?:ly)?\b|\basc\b/;
/** Size words. On their own they rank by size: the schema's `defaultMeasure` when no column is named (ADR 0018). */
export const SIZE_WORDS = /\b(?:top|largest|biggest|smallest)\b/;
/**
 * A part's sort direction, first match wins. "Largest to smallest" names the top of the list first, so it is read
 * before the size word alone, and before "smallest … first" could claim it.
 */
const DIRECTIONS: ReadonlyArray<readonly [RegExp, "asc" | "desc"]> = [
  [/\b(?:largest|biggest|highest|greatest|most|top)\s+to\s+(?:smallest|lowest|least|bottom)\b/, "desc"],
  [/\b(?:smallest|lowest|least|bottom)\s+to\s+(?:largest|biggest|highest|greatest|most|top)\b/, "asc"],
  [DESC, "desc"],
  [ASC, "asc"],
  [/\b(?:top|largest|biggest)\b/, "desc"],
  [/\bsmallest\b/, "asc"],
];

const directionOf = (text: string) => DIRECTIONS.find(([re]) => re.test(unquoted(text)))?.[1];

type Span = { start: number; end: number };
const spanOf = (m: RegExpExecArray | null): Span | undefined => (m ? { start: m.index, end: m.index + m[0].length } : undefined);
/** Where a part writes the direction `directionOf` reads, and the count it reads ("top 10"), if anywhere. */
export const directionSpans = (text: string): { direction?: Span | undefined; count?: Span | undefined } => {
  const found = DIRECTIONS.find(([re]) => re.test(text));
  return { direction: found && spanOf(found[0].exec(text)), count: spanOf(COUNT.exec(text)) };
};

/**
 * Reads each part's direction again with the columns and values it names blanked, so a size word that belongs to a
 * name ("show top tier", where "Top tier" is a value) never asks for a sort (review fix).
 */
export const withoutNamedSizes = (
  input: NormalizedInput,
  mentions: ReadonlyArray<{ clauseIndex: number; start: number; end: number }>,
): NormalizedInput => ({
  ...input,
  clauses: input.clauses.map((clause) => {
    const spans = mentions.filter((m) => m.clauseIndex === clause.index);
    if (spans.length === 0) return clause;
    const { direction: _read, limit, ...rest } = clause;
    const blanked = spans.reduce((t, m) => t.slice(0, m.start) + " ".repeat(m.end - m.start) + t.slice(m.end), clause.text);
    const direction = directionOf(blanked);
    // A count inside a name ("Top 10 Holding") is part of the name, never a count.
    const keepsLimit = limit !== undefined && COUNT.test(unquoted(blanked));
    return { ...rest, ...(direction ? { direction } : {}), ...(keepsLimit ? { limit } : {}) };
  }),
});

/** Dotted thousands ("1.000.000"), or commas not in groups of three ("10,5"), are ambiguous across locales. */
const AMBIGUOUS_NUMBER = /^\d{1,3}(?:\.\d{3})+$|,(?!\d{3}(?:\D|$))/;

const cleanText = (raw: string): string =>
  raw
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // Whitespace collapses first, so no pattern below scans a long run of spaces from every start.
    .replace(/\s+/g, " ")
    .replace(/ comma\b/gi, ",")
    .replace(/ (?:period|full stop)\b/gi, ".")
    .trim()
    .toLowerCase();

const comparatorBefore = (clause: string, at: number): Comparator | undefined => {
  const before = clause.slice(Math.max(0, at - 40), at);
  for (const [re, comparator] of COMPARATORS) {
    const m = re.exec(before);
    if (m) return NEGATED_COMPARISON.test(before.slice(0, m.index)) ? undefined : comparator;
  }
  return undefined;
};

/** The comparison around an amount: before it, else after it ("$1m or more"). */
const comparatorAround = (clause: string, at: number, end: number, date = false): Comparator | undefined =>
  comparatorBefore(clause, at) ?? trailingComparison(clause.slice(end, end + 40), date)?.comparator;

const extractLiterals = (clause: string): Literal[] => {
  const literals: Literal[] = [];
  for (const m of clause.matchAll(QUOTED)) {
    literals.push({ kind: "text", value: m[1] ?? "", at: m.index ?? 0 });
  }
  const withoutQuotes = unquoted(clause);
  for (const m of withoutQuotes.matchAll(ISO_DATE)) {
    const comparator = comparatorAround(withoutQuotes, m.index ?? 0, (m.index ?? 0) + m[0].length, true);
    literals.push({ kind: "date", value: m[0], ...(comparator ? { comparator } : {}), at: m.index ?? 0 });
  }
  const withoutDates = withoutQuotes.replace(ISO_DATE, (s) => " ".repeat(s.length));
  for (const m of withoutDates.matchAll(NUMBER)) {
    const [whole, leading, dollar, inner, digits, scale, unit] = m;
    let at = m.index ?? 0;
    // A minus right after another amount ("$50k - $100k") or a word ("2020-2024") is a hyphen, so the amount
    // starts after it. A minus after "$" with no sign before it ("$-50k") is a sign.
    const hyphen = (leading !== undefined && hyphenAfterAmount(withoutDates, at)) || (inner !== undefined && dollar === undefined);
    if (hyphen) at += 1 + (withoutDates.slice(at + 1).match(/^\s*/)?.[0].length ?? 0);
    const negative = !hyphen && (leading !== undefined || inner !== undefined || /^(?:negative|minus)\b/.test(whole));
    const end = (m.index ?? 0) + whole.length;
    if (AMBIGUOUS_NUMBER.test(digits ?? "") || Number.isNaN(Number((digits ?? "").replace(/,/g, "")))) {
      literals.push({ kind: "unreadable", value: withoutDates.slice(at, end).trim(), at });
      continue;
    }
    let value = (negative ? -1 : 1) * Number((digits ?? "").replace(/,/g, "")) * (scale ? (MULTIPLIERS[scale] ?? 1) : 1);
    let kind: LiteralKind = "number";
    if (dollar || unit === "dollars") kind = "currency";
    if (unit === "%" || unit === "percent") {
      kind = "percent";
      value = value / 100;
    }
    const comparator = comparatorAround(withoutDates, at, end);
    literals.push({ kind, value: Number(value.toPrecision(12)), ...(comparator ? { comparator } : {}), at });
  }
  literals.sort((a, b) => a.at - b.at);
  return mergeBetween(clause, literals);
};

/** A literal's words as written in its part, such as "-$50k" or “$1m and $5m”, for questions that name it. */
export const literalText = (text: string, lit: Literal): string => {
  if (lit.kind === "text") return `"${lit.value}"`;
  if (lit.kind === "date" || lit.kind === "unreadable") return String(lit.value);
  const bare = unquoted(text);
  const at = new RegExp(NUMBER.source, "y");
  at.lastIndex = lit.at;
  const first = at.exec(bare);
  if (!first) return String(lit.value);
  let end = first.index + first[0].length;
  if (lit.comparator === "between") {
    const next = new RegExp(NUMBER.source, "g");
    next.lastIndex = end;
    const second = next.exec(bare);
    if (second) end = second.index + second[0].length;
  }
  return text.slice(lit.at, end).trim();
};

const SCALE_AND_UNIT = /(?:(k|thousand|mm|m|million|bn|b|billion)\b)?\s*(%|percent|dollars)?$/;
const take = (value: number, scale?: string, unit?: string) =>
  Number(((value * (scale ? (MULTIPLIERS[scale] ?? 1) : 1)) / (unit === "%" || unit === "percent" ? 100 : 1)).toPrecision(12));

/**
 * One range from two bounds, lower first. A bound written with no scale or unit takes the other bound's: "between
 * 10-20%" is 10% to 20%, "between -10 and -5%" is -10% to -5%, and "between $1-2m" is $1,000,000 to $2,000,000. That
 * is read only when it is certain: the range must rise in the shared unit, and a scale ("m", "k") is shared only by a
 * compact "$1-2m" (a percent sign with any join). Anything else, such as "between $1 and 2m" or "between 5 and 50k", is
 * unreadable, so GridCue asks.
 */
const range = (clause: string, a: Literal, b: Literal, gap: string): Literal => {
  const aText = literalText(clause, a);
  const bText = literalText(clause, b);
  const [, aScale, aUnit] = SCALE_AND_UNIT.exec(aText) ?? [];
  const [, bScale, bUnit] = SCALE_AND_UNIT.exec(bText) ?? [];
  let value = a.value as number;
  let upper = b.value as number;
  const unclear: Literal = { kind: "unreadable", value: `${aText}${gap}${bText}`.replace(/\s+/g, " "), at: a.at };
  const aBare = !aScale && !aUnit;
  // A bound written in full ("$500,000", "250000") is complete next to a scaled one ("$1m"): nothing to borrow.
  const complete = (text: string) => /\d,\d{3}|\d{4}/.test(text);
  const unitOf = (unit: string | undefined) => (unit === "%" || unit === "percent" ? "%" : undefined);
  // ...and so is a bound with its own "$" next to another with its own "$": "between $999 and $2k".
  const fullNextToScale =
    (aText.includes("$") && bText.includes("$")) ||
    (aBare ? complete(aText) && !!bScale && !unitOf(bUnit) : complete(bText) && !!aScale && !unitOf(aUnit));
  if (aBare !== (!bScale && !bUnit) && !fullNextToScale) {
    const signed = (text: string, lit: Literal) =>
      Math.sign(lit.value as number) * Number(/\d[\d,.]*/.exec(text)?.[0].replaceAll(",", "") ?? Number.NaN);
    // Only the first bound borrows, and only from the second: a scale in the compact "$1-2m" form, a percent sign
    // with any join ("between 10 and 20%"). "Between $1m and 2", "from 1m-2" and "between 5 and 50k" ask.
    if (!aBare || !(signed(aText, a) <= signed(bText, b))) return unclear;
    if (bScale && !/^\s*[-–]\s*$/.test(gap)) return unclear;
    value = take(value, bScale, bUnit);
  }
  if (value > upper) {
    // Written high to low with a scale on only one bound ("between $1m and $2"): the other probably lost its scale,
    // so swapping would invent a range nobody asked for. Bounds at like scales are swapped into order.
    if (!!aScale !== !!bScale) return unclear;
    [value, upper] = [upper, value];
  }
  return { kind: a.kind === "number" ? b.kind : a.kind, value, upper, comparator: "between", at: a.at };
};

/** What joins the two bounds of a range: "between $1m and $5m", "from $2-4m", "from 5% to 15%". */
const BETWEEN_JOIN = /^\s*(?:and|[-–]|to)\s*$/;
const FROM_JOIN = /^\s*(?:[-–]|to|through)\s*$/;

/** "between $1m and $5m", "from $1m to $5m" and "from 5-15%" become one literal with a lower and upper bound. */
const mergeBetween = (clause: string, literals: Literal[]): Literal[] => {
  const out: Literal[] = [];
  for (let i = 0; i < literals.length; i++) {
    const a = literals[i];
    const b = literals[i + 1];
    const before = a ? clause.slice(Math.max(0, a.at - 10), a.at) : "";
    // Two amounts make a range only when they are joined as one: "accounts from Northgate over $1m" is not one.
    const gap = a && b ? clause.slice(a.at + literalText(clause, a).length, b.at) : "";
    const ranged = (/\bbetween\s*$/.test(before) && BETWEEN_JOIN.test(gap)) || (/\bfrom\s*$/.test(before) && FROM_JOIN.test(gap));
    if (a && b && ranged && typeof a.value === "number" && typeof b.value === "number") {
      out.push(range(clause, a, b, gap));
      i++;
    } else if (a) {
      out.push(a);
    }
  }
  return out;
};

/** A part with no instruction verb at all, such as "advisor" in "group by custodian, then advisor". */
const NO_VERB = new RegExp(`^(?!.*\\b(?:${VERB_ALT})(?:ed)?\\b)`);
/** A verb that takes "by", so a following "then by …" part can continue it. */
const LEVEL_VERB = /\b(sort(?:ed)?|order(?:ed)?|group(?:ed)?)\s+by\b/;

/** Splits the request into parts. Punctuation or a verb inside quoted text never splits it: `"Smith. Jones"`. */
const splitOutsideQuotes = (text: string): string[] => {
  const out: string[] = [];
  let start = 0;
  // Quoted text is filled with letters, not spaces, so it can't form a long run of spaces for SPLIT to scan.
  const filled = text.replace(QUOTED, (s) => `"${"x".repeat(s.length - 2)}"`);
  for (const m of filled.matchAll(SPLIT)) {
    out.push(text.slice(start, m.index));
    start = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(start));
  return out.flatMap(splitKeep);
};

/**
 * "Clear filters except accounts over $1m", "reset the view but keep trusts": what to keep is its own part, after the
 * clear or reset. The joining words are dropped, so "except" never reads as excluding what follows.
 */
// Only a clear of the view's own changes splits: "remove northgate accounts except trusts" is not one.
const CLEAR_WORD =
  /^(?:please )?(?:ungroup\b|(?:clear|remove|reset|undo|drop)(?: all| every)?(?: the| my| of the)? (?:filters?|filtering|sorts?|sorting|grouping|groups?|view|everything)\b)/;
const KEEP_WORDS =
  / (?:except(?: for)?|but(?= (?:keep|leave)\b| (?:the |my )?(?:sort|sorting|sorts|grouping|groups?|filters?)\b)|other than|apart from) /g;
/** Marks a part split off by `splitKeep`; `normalize` turns it into `Clause.keeps`. */
const KEPT = "\u0001";
const splitKeep = (part: string): string[] => {
  const bare = unquoted(part).trimStart();
  const clear = CLEAR_WORD.exec(bare);
  if (!clear) return [part];
  const offset = part.length - bare.length;
  KEEP_WORDS.lastIndex = clear[0].length;
  const keep = KEEP_WORDS.exec(bare);
  return keep ? [part.slice(0, offset + keep.index), KEPT + part.slice(offset + keep.index + keep[0].length)] : [part];
};

/** Deterministically splits a request into clauses and extracts literals code handles better than a model. */
export const normalize = (raw: string): NormalizedInput => {
  const text = cleanText(raw);
  // "group by account type, then by advisor": the second part leaves out its verb and continues the first.
  let levelVerb: string | undefined;
  const parts = splitOutsideQuotes(text)
    .flatMap(splitMidLine)
    .map((p) =>
      p
        .trim()
        .replace(/^(?:and|then)\s+/, "")
        .replace(/[,\s]+$/, ""),
    )
    .map((p) => (p.startsWith(KEPT) ? { p: p.slice(1).trim(), keeps: true } : { p, keeps: false }))
    .filter(({ p }) => p.length > 0)
    .map(({ p, keeps }) => {
      // "then by advisor", or a bare "then advisor" of at most three words, continues the sort or grouping before it.
      const bare = !/^by\b/.test(p) && NO_VERB.test(p) && p.split(" ").length <= 3;
      const verb = levelVerb && (/^by\b/.test(p) || bare) ? levelVerb : undefined;
      const part = verb ? (/^by\b/.test(p) ? `${verb} ${p}` : `${verb} by ${p}`) : p;
      levelVerb = part.match(LEVEL_VERB)?.[1];
      const continues: Clause["continues"] = verb ? (/^group/.test(verb) ? "group" : "sort") : undefined;
      return { part, continues, keeps };
    });
  return {
    text,
    clauses: parts.map(({ part, continues, keeps }, index) => {
      const bare = unquoted(part);
      const direction = directionOf(bare);
      const count = COUNT.exec(bare);
      const digits = count?.[1] ?? "";
      // The count's digits are blanked, keeping offsets, so "top 10" never reads as "equal to 10".
      const at = count ? count.index + count[0].length - digits.length : -1;
      const literalText = count ? part.slice(0, at) + " ".repeat(digits.length) + part.slice(at + digits.length) : part;
      return {
        index,
        text: part,
        literals: extractLiterals(literalText),
        ...(direction ? { direction } : {}),
        ...(continues ? { continues } : {}),
        ...(count ? { limit: Number(digits.replaceAll(",", "")) } : {}),
        ...(keeps ? { keeps: true as const } : {}),
      };
    }),
  };
};
