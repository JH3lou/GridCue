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
const VERB_ALT = CLAUSE_VERBS.join("|");
const VERB = `(?:${VERB_ALT})(?:ed)?\\b`;
const SPLIT = new RegExp(`[;!?]+|\\.(?=\\s|$)|,?\\s+then\\s+|,\\s*(?=${VERB})|\\s+and\\s+(?=${VERB})`, "g");

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
const splitMidLine = (part: string): string[] => {
  const out: string[] = [];
  let start = 0;
  for (const m of part.matchAll(MID_LINE_VERB)) {
    const at = m.index ?? 0;
    const before = part.slice(start, at);
    const last = [...before.matchAll(INSTRUCTION_WORD)].at(-1);
    const next = part.slice(at + 1).match(/^[a-z]+/)?.[0] ?? "";
    if (!last || !before.slice((last.index ?? 0) + last[0].length).trim()) continue;
    if (verbFamily(last[1] ?? "") === verbFamily(next)) continue;
    out.push(before);
    start = at + 1;
  }
  out.push(part.slice(start));
  return out;
};

/** A ranking with a count: "top 10", "largest 5 households". Its number is the count, never a filter value (ADR 0018). */
const COUNT =
  /\b(?:top|largest|biggest|smallest)\s+([1-9]\d{0,3})\b(?!\s*(?:%|percent\b|k\b|thousand\b|mm?\b|million\b|bn?\b|billion\b|dollars\b|[.,]\d))/;

const COMPARATORS: Array<[RegExp, Comparator]> = [
  [/\b(?:no more than|at most|up to)\s*$/, "lte"],
  [/\b(?:no less than|at least|minimum of)\s*$/, "gte"],
  [/\b(?:over|above|more than|greater than|exceeding|bigger than|larger than|>)\s*$/, "gt"],
  [/\b(?:under|below|less than|fewer than|smaller than|before|earlier than|<)\s*$/, "lt"],
  [/\b(?:after|later than|since)\s*$/, "gt"],
  [/\b(?:equal to|equals|exactly|=)\s*$/, "eq"],
];

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

const NUMBER = /(\$)?\s?(\d[\d,.]*\d|\d)\s*(k|thousand|mm|m|million|bn|b|billion)?\b\s*(%|percent\b|dollars\b)?/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const QUOTED = /"([^"]+)"/g;

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

/** Dotted thousands ("1.000.000"), or commas not in groups of three ("10,5"), are ambiguous across locales. */
const AMBIGUOUS_NUMBER = /^\d{1,3}(?:\.\d{3})+$|,(?!\d{3}(?:\D|$))/;

const cleanText = (raw: string): string =>
  raw
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+comma\b/gi, ",")
    .replace(/\s+(?:period|full stop)\b/gi, ".")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const comparatorBefore = (clause: string, at: number): Comparator | undefined => {
  const before = clause.slice(Math.max(0, at - 24), at);
  return COMPARATORS.find(([re]) => re.test(before))?.[1];
};

const extractLiterals = (clause: string): Literal[] => {
  const literals: Literal[] = [];
  for (const m of clause.matchAll(QUOTED)) {
    literals.push({ kind: "text", value: m[1] ?? "", at: m.index ?? 0 });
  }
  const withoutQuotes = clause.replace(QUOTED, (s) => " ".repeat(s.length));
  for (const m of withoutQuotes.matchAll(ISO_DATE)) {
    literals.push({ kind: "date", value: m[0], comparator: comparatorBefore(withoutQuotes, m.index ?? 0), at: m.index ?? 0 });
  }
  const withoutDates = withoutQuotes.replace(ISO_DATE, (s) => " ".repeat(s.length));
  for (const m of withoutDates.matchAll(NUMBER)) {
    const [, dollar, digits, scale, unit] = m;
    const at = m.index ?? 0;
    if (AMBIGUOUS_NUMBER.test(digits ?? "") || Number.isNaN(Number((digits ?? "").replace(/,/g, "")))) {
      literals.push({ kind: "unreadable", value: m[0].trim(), at });
      continue;
    }
    let value = Number((digits ?? "").replace(/,/g, "")) * (scale ? (MULTIPLIERS[scale] ?? 1) : 1);
    let kind: LiteralKind = "number";
    if (dollar || unit === "dollars") kind = "currency";
    if (unit === "%" || unit === "percent") {
      kind = "percent";
      value = value / 100;
    }
    literals.push({ kind, value: Number(value.toPrecision(12)), comparator: comparatorBefore(withoutDates, at), at });
  }
  literals.sort((a, b) => a.at - b.at);
  return mergeBetween(clause, literals);
};

/** "between $1m and $5m" becomes one literal with a lower and upper bound. */
const mergeBetween = (clause: string, literals: Literal[]): Literal[] => {
  const out: Literal[] = [];
  for (let i = 0; i < literals.length; i++) {
    const a = literals[i];
    const b = literals[i + 1];
    if (
      a &&
      b &&
      /\bbetween\s*$/.test(clause.slice(Math.max(0, a.at - 10), a.at)) &&
      typeof a.value === "number" &&
      typeof b.value === "number"
    ) {
      const kind = a.kind === "number" ? b.kind : a.kind;
      out.push({ kind, value: a.value, upper: b.value, comparator: "between", at: a.at });
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

/** Deterministically splits a request into clauses and extracts literals code handles better than a model. */
export const normalize = (raw: string): NormalizedInput => {
  const text = cleanText(raw);
  // "group by account type, then by advisor": the second part leaves out its verb and continues the first.
  let levelVerb: string | undefined;
  const parts = text
    .split(SPLIT)
    .flatMap(splitMidLine)
    .map((p) =>
      p
        .trim()
        .replace(/^(?:and|then)\s+/, "")
        .replace(/[,\s]+$/, ""),
    )
    .filter((p) => p.length > 0)
    .map((p) => {
      // "then by advisor", or a bare "then advisor" of at most three words, continues the sort or grouping before it.
      const bare = !/^by\b/.test(p) && NO_VERB.test(p) && p.split(" ").length <= 3;
      const verb = levelVerb && (/^by\b/.test(p) || bare) ? levelVerb : undefined;
      const part = verb ? (/^by\b/.test(p) ? `${verb} ${p}` : `${verb} by ${p}`) : p;
      levelVerb = part.match(LEVEL_VERB)?.[1];
      const continues: Clause["continues"] = verb ? (/^group/.test(verb) ? "group" : "sort") : undefined;
      return { part, continues };
    });
  return {
    text,
    clauses: parts.map(({ part, continues }, index) => {
      const direction = DIRECTIONS.find(([re]) => re.test(part))?.[1];
      const count = COUNT.exec(part);
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
        ...(count ? { limit: Number(digits) } : {}),
      };
    }),
  };
};
