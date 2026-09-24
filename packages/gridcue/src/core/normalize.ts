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

/** Deterministically splits a request into clauses and extracts literals code handles better than a model. */
export const normalize = (raw: string): NormalizedInput => {
  const text = cleanText(raw);
  const parts = text
    .split(SPLIT)
    .map((p) =>
      p
        .trim()
        .replace(/^(?:and|then)\s+/, "")
        .replace(/[,\s]+$/, ""),
    )
    .filter((p) => p.length > 0);
  return {
    text,
    clauses: parts.map((part, index) => {
      const direction = DESC.test(part) ? "desc" : ASC.test(part) ? "asc" : undefined;
      return { index, text: part, literals: extractLiterals(part), ...(direction ? { direction } : {}) };
    }),
  };
};
