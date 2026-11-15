import { inComparison } from "./code-read";
import { isExposed, operatorsFor } from "./columns";
import { isTimeZone } from "./dates";
import { GridCueError } from "./errors";
import { matchMentions } from "./mentions";
import { normalize } from "./normalize";
import { ownWord } from "./own-words";
import { rowNouns } from "./placed";
import {
  Calendar,
  type ColumnCapability,
  type ColumnDescriptor,
  type ColumnKind,
  type EnumValue,
  type FilterOperator,
  HouseTerm,
  ViewSchema,
} from "./protocol";
import { filterIssues } from "./validate";
import { formWordIn } from "./view-words";

/**
 * The view operations GridCue can perform on a column by default. Every column that isn't restricted may be pinned
 * (ADR 0029): a pin still reaches the grid only when its adapter lists `columns.pin`. A Host's `capabilities` for a
 * column replace this list.
 */
export const DEFAULT_CAPABILITIES: ColumnCapability[] = ["filter", "sort", "group", "show", "hide", "reorder", "pin"];

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
  /**
   * The Calendar (ADR 0026): `{ timeZone: "America/New_York", fiscalYearStart: 1 }`. It turns date words such as "last
   * 90 days" into fixed days, and a date in a filter means the whole day in its time zone. `timeZone` is an IANA name;
   * left out, it is the browser's, taken when a request is read or a row is filtered. `fiscalYearStart` is a month from
   * 1 to 12, default 1. Anything else in it, a time zone the runtime doesn't know, or a month outside 1 to 12 throws
   * `INPUT_SCHEMA`. It is never sent to an Intent Provider.
   */
  calendar?: Calendar;
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
      // The word after the run in the name, if any: "May items" never puts a number after "may".
      if (ownWord(run, words[to])) return run;
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
      // The pin, unpin and density forms read their words whatever the Host's terms are (ADR 0028): "unpin everything"
      // would never ask about a term named "Unpin".
      const form = formWordIn(name);
      if (form === wordsOf(name)) fail(`${term}: the name "${name}" is one of GridCue's own words.`);
      if (form) fail(`${term}: the name "${name}" holds “${form}”, one of GridCue's own words.`);
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

/**
 * Checks the Host's Calendar (ADR 0026) and returns it parsed: an object holding `timeZone`, an IANA name the runtime
 * knows, and `fiscalYearStart`, a whole month from 1 to 12, and nothing else. Both may be left out. Throws
 * `INPUT_SCHEMA`, naming the reason. The time zone a Calendar leaves out is not looked up here: it is the browser's,
 * taken when a request is read or a row is filtered.
 */
const checkCalendar = (input: unknown): Calendar => {
  const fail = (message: string): never => {
    throw new GridCueError("INPUT_SCHEMA", message);
  };
  if (typeof input !== "object" || input === null || Array.isArray(input)) fail("calendar must be an object.");
  const raw = input as Record<string, unknown>;
  const stray = Object.keys(raw).filter((key) => key !== "timeZone" && key !== "fiscalYearStart");
  if (stray.length > 0) fail(`calendar holds only timeZone and fiscalYearStart, not ${stray.join(", ")}.`);
  const { timeZone, fiscalYearStart } = raw;
  if (timeZone !== undefined && (typeof timeZone !== "string" || !isTimeZone(timeZone))) {
    fail("calendar.timeZone must be an IANA time zone name, such as America/New_York.");
  }
  if (
    fiscalYearStart !== undefined &&
    (typeof fiscalYearStart !== "number" || !Number.isInteger(fiscalYearStart) || fiscalYearStart < 1 || fiscalYearStart > 12)
  ) {
    fail("calendar.fiscalYearStart must be a month from 1 to 12.");
  }
  const parsed = Calendar.safeParse(raw);
  if (!parsed.success) fail(`calendar is malformed: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  return (parsed as { data: Calendar }).data;
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
  if (options.calendar !== undefined) schema.calendar = checkCalendar(options.calendar);

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
