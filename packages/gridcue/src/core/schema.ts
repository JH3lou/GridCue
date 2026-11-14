import { emptyWordsOutside, inComparison } from "./code-read";
import { isExposed, operatorsFor } from "./columns";
import { GridCueError } from "./errors";
import { leavesRowsOut, nothingAfter } from "./lead";
import { LEAVES_OUT, matchMentions } from "./mentions";
import {
  comparisonSpans,
  directionSpans,
  literalText,
  normalize,
  readsOrder,
  SIZE_WORDS,
  startsInstruction,
  TEXT_MATCH_WORDS,
} from "./normalize";
import { onPlacedLists, rowNouns } from "./placed";
import {
  type ColumnCapability,
  type ColumnDescriptor,
  type ColumnKind,
  Density,
  type EnumValue,
  type FilterOperator,
  HouseTerm,
  ViewSchema,
} from "./protocol";
import { filterIssues } from "./validate";

/** The view operations GridCue can perform on a column by default. */
export const DEFAULT_CAPABILITIES: ColumnCapability[] = ["filter", "sort", "group", "show", "hide", "reorder"];

// They live in `core/columns.ts`, which imports nothing else from core, so the readers this module checks a House
// Term with can use them with no import cycle. The root entry still exports them from here.
export { isExposed, operatorsFor };

export interface ColumnInput {
  id: string;
  label?: string;
  kind?: ColumnKind;
}

export interface ColumnOverride {
  label?: string;
  kind?: ColumnKind;
  description?: string;
  aliases?: string[];
  capabilities?: ColumnCapability[];
  allowedOperators?: FilterOperator[];
  enumValues?: EnumValue[];
  /** The other record this column names, such as "household" (ADR 0015). */
  entity?: string;
  /** Categories over this column's enum values, such as `{ label: "Retirement", values: ["ira", "roth_ira"] }`. */
  valueGroups?: Array<{ label: string; aliases?: string[]; values: string[] }>;
}

export interface SchemaOptions {
  id?: string;
  version?: string;
  /** Per-column additions: aliases, descriptions, approved enum values, narrower capabilities. */
  columns?: Record<string, ColumnOverride>;
  /** Column IDs GridCue must never expose to a provider or act on. */
  restricted?: string[];
  /** What one row is, such as "account" (ADR 0015). */
  rowNoun?: string;
  /** The column "top", "largest", "biggest" and "smallest" rank by when a request names none, such as "market_value" (ADR 0018). */
  defaultMeasure?: string;
  /** Rows used only to infer missing kinds. They never leave the caller. */
  sampleRows?: ReadonlyArray<Record<string, unknown>>;
  /**
   * Names for fixed lists of conditions on the rows, such as `{ label: "Large", where: [{ columnId: "market_value",
   * operator: "gt", value: 1_000_000 }] }` (ADR 0024). Each condition must be a filter a plan could hold, and each name
   * must be the term's own. They are never sent to an Intent Provider.
   */
  houseTerms?: HouseTerm[];
}

/** Turns "market_value" or "marketValue" into "Market value". */
export const humanize = (id: string): string => {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T/;

/** Infers a column kind from sample values. Currency and percent can't be inferred; declare them. */
export const inferKind = (values: readonly unknown[]): ColumnKind => {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (present.length === 0) return "string";
  if (present.every((v) => typeof v === "boolean")) return "boolean";
  if (present.every((v) => typeof v === "number" && Number.isFinite(v))) return "number";
  if (present.every((v) => v instanceof Date || (typeof v === "string" && ISO_DATETIME.test(v)))) return "datetime";
  if (present.every((v) => typeof v === "string" && ISO_DATE.test(v))) return "date";
  return "string";
};

/** A name's words in lower case, one space between: "Needs-Attention" reads as "needs attention". */
const wordsOf = (name: string): string => (name.toLowerCase().match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? []).join(" ");

/**
 * The forms GridCue finds a Host's name in (`core/text-match.ts`, `core/placed.ts`): any case, any separator between
 * its words or none, and a plural. Two names that share a form can be found in the same words.
 */
const formsOf = (name: string): string[] => {
  const key = wordsOf(name).replace(/[^\p{L}\p{N}]/gu, "");
  return [key, `${key}s`, `${key}es`, ...(/[^aeiou]y$/.test(key) ? [`${key.slice(0, -1)}ies`] : [])];
};

const whole = (pattern: string) => new RegExp(`^(?:${pattern})$`, "u");
/** GridCue's own words that its reader writes as patterns: the size words, the words that leave rows out, the match words. */
const OWN_PATTERNS: readonly RegExp[] = [whole(SIZE_WORDS.source), whole(LEAVES_OUT), ...TEXT_MATCH_WORDS.map(([, words]) => whole(words))];

/** Whether `text` holds one amount and nothing but the comparison words read for it: "over 1", "1 or more". */
const onlyComparison = (text: string): boolean => {
  const { clauses } = normalize(text);
  const clause = clauses[0];
  const lit = clause?.literals[0];
  if (clauses.length !== 1 || !clause || !lit || clause.literals.length !== 1) return false;
  const read = [{ start: lit.at, end: lit.at + literalText(clause.text, lit).length }, ...comparisonSpans(clause.text, lit)];
  return clause.text.split("").every((ch, i) => /\s/.test(ch) || read.some((s) => i >= s.start && i < s.end));
};

/** The densities a view can have: "compact view" asks for one. */
const DENSITIES: ReadonlySet<string> = new Set(Density.options);
/**
 * The words for days and periods the dates of named filters' spec 5.5 read ("today", "last 90 days", "this quarter",
 * "YTD", a month's name). GridCue keeps them for itself before it reads them, so no term can be named one now and read
 * twice later.
 */
const TIME_WORDS =
  /^(?:today|yesterday|tomorrow|days?|weeks?|months?|quarters?|years?|ago|next|recent|mtd|qtd|ytd|january|february|march|april|may|june|july|august|september|october|november|december)$/u;

/**
 * Whether `words` (lower case, one space between) are one of GridCue's own words, taken from the lists its reader
 * already holds: a word the placed-words check places or a lead-in (`core/placed.ts`, `core/lead.ts`), a joining or
 * staying word ("plus", "then", "stays"), a size, age or order word or a direction, a verb that starts an instruction, a
 * density, a word for no value, a word that leaves rows out, a text match's words, a comparison, or a time word. A House
 * Term that held one would be read twice.
 */
const ownWord = (words: string): boolean => {
  const all = (span: { start: number; end: number } | undefined) => !!span && span.start === 0 && span.end === words.length;
  return (
    onPlacedLists(words) ||
    nothingAfter(words, 0) ||
    OWN_PATTERNS.some((re) => re.test(words)) ||
    all(directionSpans(words).direction) ||
    readsOrder(words) ||
    startsInstruction(words) ||
    DENSITIES.has(words) ||
    TIME_WORDS.test(words) ||
    leavesRowsOut(`${words} rows`) ||
    emptyWordsOutside({ index: 0, text: words, literals: [] }, []).some(all) ||
    onlyComparison(`${words} 1`) ||
    onlyComparison(`1 ${words}`) ||
    onlyComparison(`${words} 1 and 2`)
  );
};

/**
 * The first of GridCue's own words a name holds, if any: the name read on its own holds an amount, a count or a sort's
 * direction, or splits into parts ("Top 10", "1m", "Tier 1"); or one of its words, or a run of them, is one of
 * GridCue's own words (`ownWord`: "Top tier", "Highest", "Most valuable", "Reset"); or every word of it is one a
 * comparison is written with ("More", "Than", "Up", "Equal"), so the whole name could sit inside one. Each such word is
 * read by GridCue as well as by the term: "top tier accounts" would also sort, and "gain more than $50k" would also
 * filter by a term named "More".
 */
const ownWordIn = (name: string): string | undefined => {
  const text = wordsOf(name);
  const words = text.split(" ");
  for (let from = 0; from < words.length; from++) {
    for (let to = from + 1; to <= words.length; to++) {
      const run = words.slice(from, to).join(" ");
      if (ownWord(run)) return run;
    }
  }
  if (words.every(inComparison)) return text;
  const { clauses } = normalize(text);
  const [read] = clauses;
  if (clauses.length !== 1 || !read) return "more than one part";
  if (read.literals.length > 0) return "an amount";
  if (read.limit !== undefined) return "a count";
  if (read.direction !== undefined) return "an order";
  return undefined;
};

/**
 * The first name GridCue already reads that a term's name holds, if any: a column's or a value's name the Mentions
 * find in it ("High value" holds "value", "Northgate large" holds "Northgate"), or the Row Noun or an entity word
 * ("Big accounts"). A term is never found inside a declared name, so such a term could never be read, or its other
 * words would be read alone.
 */
const nameIn = (name: string, schema: ViewSchema): string | undefined => {
  const text = wordsOf(name);
  const [held] = [
    ...matchMentions([{ index: 0, text, literals: [] }], schema.columns.filter(isExposed), { rowNoun: schema.rowNoun }),
    ...rowNouns(text, schema),
  ];
  return held ? text.slice(held.start, held.end) : undefined;
};

/** Why a `between` condition's range keeps no row, when its low end is above its high end. */
const reversed = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { min, max } = value as { min?: unknown; max?: unknown };
  const comparable = (typeof min === "number" && typeof max === "number") || (typeof min === "string" && typeof max === "string");
  return comparable && (min as number | string) > (max as number | string)
    ? `its range starts at ${String(min)}, above where it ends at ${String(max)}, so it keeps no row.`
    : undefined;
};

/** Every name the schema already uses, with what uses it. */
const namesInUse = (schema: ViewSchema): Array<{ name: string; owner: string }> => [
  ...(schema.rowNoun ? [{ name: schema.rowNoun, owner: "the Row Noun" }] : []),
  ...schema.columns.flatMap((c) => [
    ...[c.label, ...(c.aliases ?? [])].map((name) => ({ name, owner: `a name of the column ${c.label}` })),
    ...(c.entity ? [{ name: c.entity, owner: `the entity word of ${c.label}` }] : []),
    ...(c.enumValues ?? []).flatMap((v) =>
      [v.label, ...(v.aliases ?? [])].map((name) => ({ name, owner: `a name of the value ${v.label} in ${c.label}` })),
    ),
    ...(c.valueGroups ?? []).flatMap((g) =>
      [g.label, ...(g.aliases ?? [])].map((name) => ({ name, owner: `a name of the Value Group ${g.label} in ${c.label}` })),
    ),
  ]),
];

/**
 * Checks the Host's House Terms against the schema they are declared on (ADR 0024) and returns them parsed. Each
 * condition must be a filter a plan could hold, checked by validation's own check. Each name must be the term's own.
 * Throws `INPUT_SCHEMA`, naming the term and the reason.
 */
const checkHouseTerms = (terms: readonly unknown[], schema: ViewSchema): HouseTerm[] => {
  const fail = (message: string): never => {
    throw new GridCueError("INPUT_SCHEMA", message);
  };
  if (!Array.isArray(terms)) fail("houseTerms must be a list.");
  const inUse = namesInUse(schema).map((n) => ({ ...n, forms: formsOf(n.name) }));
  const declared: Array<{ forms: string[]; owner: string }> = [];
  return terms.map((input, i) => {
    const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
    const label = typeof raw.label === "string" ? raw.label : "";
    if (!wordsOf(label)) fail(`House Term ${i + 1} has no label.`);
    const term = `House Term "${label}"`;
    if (Array.isArray(raw.aliases) && raw.aliases.some((a) => typeof a !== "string" || !wordsOf(a))) fail(`${term} has an empty alias.`);
    if (!Array.isArray(raw.where) || raw.where.length === 0) fail(`${term} has no conditions.`);
    const parsed = HouseTerm.safeParse(input);
    if (!parsed.success) {
      fail(`${term} is malformed: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    }
    const { data } = parsed as { data: HouseTerm };
    data.where.forEach((condition, n) => {
      const [issue] = filterIssues(condition, schema);
      const range = condition.operator === "between" ? reversed(condition.value) : undefined;
      if (!issue && !range) return;
      const reason = !issue
        ? range
        : issue.code === "PLAN_UNKNOWN_COLUMN"
          ? `no column has the id "${condition.columnId}".`
          : issue.message;
      fail(`${term}, condition ${n + 1}: ${reason}`);
    });
    for (const name of [data.label, ...(data.aliases ?? [])]) {
      const own = ownWordIn(name);
      if (own === wordsOf(name)) fail(`${term}: the name "${name}" is one of GridCue's own words.`);
      if (own && !wordsOf(name).includes(own)) fail(`${term}: the name "${name}" holds ${own}, which GridCue reads on its own.`);
      if (own) fail(`${term}: the name "${name}" holds “${own}”, one of GridCue's own words.`);
      const forms = formsOf(name);
      const taken = [...inUse, ...declared].find((other) => other.forms.some((f) => forms.includes(f)));
      if (taken) fail(`${term}: the name "${name}" is also ${taken.owner}.`);
      const held = nameIn(name, schema);
      if (held) fail(`${term}: the name "${name}" holds “${held}”, a name the schema already uses, so the term could never be found.`);
    }
    declared.push(
      ...[data.label, ...(data.aliases ?? [])].map((name) => ({ forms: formsOf(name), owner: `a name of House Term "${data.label}"` })),
    );
    return data;
  });
};

/** Builds a ViewSchema from the columns a table already has. */
export const defineSchema = (columns: readonly ColumnInput[], options: SchemaOptions = {}): ViewSchema => {
  const restricted = new Set(options.restricted ?? []);
  const sample = options.sampleRows ?? [];
  const knownIds = new Set(columns.map((c) => c.id));

  const duplicateIds = [...new Set(columns.map((c) => c.id).filter((id, i, all) => all.indexOf(id) !== i))];
  if (duplicateIds.length > 0) {
    throw new GridCueError("INPUT_SCHEMA", `Column ids must be unique. Repeated: ${duplicateIds.join(", ")}.`);
  }
  const unknownRestricted = (options.restricted ?? []).filter((id) => !knownIds.has(id));
  if (unknownRestricted.length > 0) {
    throw new GridCueError("INPUT_SCHEMA", `restricted names an id that matches no column: ${unknownRestricted.join(", ")}.`);
  }
  const unknownOverrides = Object.keys(options.columns ?? {}).filter((id) => !knownIds.has(id));
  if (unknownOverrides.length > 0) {
    throw new GridCueError("INPUT_SCHEMA", `columns names an id that matches no column: ${unknownOverrides.join(", ")}.`);
  }
  if (options.defaultMeasure !== undefined && !knownIds.has(options.defaultMeasure)) {
    throw new GridCueError("INPUT_SCHEMA", `defaultMeasure names an id that matches no column: ${options.defaultMeasure}.`);
  }

  for (const [id, override] of Object.entries(options.columns ?? {})) {
    const known = new Set((override.enumValues ?? []).map((v) => v.id));
    const stray = (override.valueGroups ?? []).flatMap((g) => g.values).filter((v) => !known.has(v));
    if (stray.length > 0) {
      throw new GridCueError("INPUT_SCHEMA", `valueGroups on ${id} name values that are not in its enumValues: ${stray.join(", ")}.`);
    }
  }

  const schema: ViewSchema = {
    id: options.id ?? "default",
    version: options.version ?? "1",
    ...(options.rowNoun ? { rowNoun: options.rowNoun } : {}),
    ...(options.defaultMeasure ? { defaultMeasure: options.defaultMeasure } : {}),
    columns: columns.map((input): ColumnDescriptor => {
      const override = options.columns?.[input.id] ?? {};
      const kind = override.kind ?? input.kind ?? (override.enumValues ? "enum" : inferKind(sample.map((row) => row[input.id])));
      const isRestricted = restricted.has(input.id);
      return {
        id: input.id,
        label: override.label ?? input.label ?? humanize(input.id),
        kind,
        ...(override.description ? { description: override.description } : {}),
        ...(override.aliases ? { aliases: override.aliases } : {}),
        capabilities: isRestricted ? [] : (override.capabilities ?? DEFAULT_CAPABILITIES),
        ...(override.allowedOperators ? { allowedOperators: override.allowedOperators } : {}),
        sensitivity: isRestricted ? "restricted" : "internal",
        exposeToProvider: !isRestricted,
        ...(override.enumValues ? { enumValues: override.enumValues } : {}),
        ...(override.entity ? { entity: override.entity } : {}),
        ...(override.valueGroups ? { valueGroups: override.valueGroups } : {}),
      };
    }),
  };
  const houseTerms = checkHouseTerms(options.houseTerms ?? [], schema);
  if (houseTerms.length > 0) schema.houseTerms = houseTerms;

  const parsed = ViewSchema.safeParse(schema);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new GridCueError("INPUT_SCHEMA", `Invalid schema: ${detail}`);
  }
  return parsed.data;
};

export interface ProviderPayloadColumn {
  id: string;
  label: string;
  kind: ColumnKind;
  aliases?: string[];
  description?: string;
  enumValues?: EnumValue[];
  entity?: string;
  valueGroups?: Array<{ label: string; aliases?: string[]; values: string[] }>;
}

/** Exactly what an Intent Provider may receive about this schema. Rows are never included. */
export const describeProviderPayload = (
  schema: ViewSchema,
): { columns: ProviderPayloadColumn[]; rowNoun?: string; rows: "never sent" } => ({
  ...(schema.rowNoun ? { rowNoun: schema.rowNoun } : {}),
  columns: schema.columns.filter(isExposed).map((c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind,
    ...(c.aliases ? { aliases: c.aliases } : {}),
    ...(c.description ? { description: c.description } : {}),
    ...(c.enumValues ? { enumValues: c.enumValues } : {}),
    ...(c.entity ? { entity: c.entity } : {}),
    ...(c.valueGroups ? { valueGroups: c.valueGroups } : {}),
  })),
  rows: "never sent",
});

export const findColumn = (schema: ViewSchema, id: string): ColumnDescriptor | undefined => schema.columns.find((c) => c.id === id);
