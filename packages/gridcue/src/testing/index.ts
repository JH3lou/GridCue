import { addDays, instantOfCell, isTimeZone } from "../core/dates";
import { GridCueError } from "../core/errors";
import { isEmpty } from "../core/evaluate";
import { formatAmount } from "../core/format";
import {
  type ColumnDescriptor,
  emptyViewState,
  type FilterGroup,
  type FilterOperator,
  type FilterPredicate,
  type FilterValue,
  type Scalar,
  type SortSpec,
  ViewSchema,
  type ViewState,
} from "../core/protocol";
import { applyView } from "../core/rows-adapter";
import { filterIssues } from "../core/validate";

/**
 * The Query Check (ADR 0032): synthetic rows and View States, built from a View Schema, that a Host runs through its
 * own Data Query to prove it keeps the rows GridCue would.
 *
 * ```ts
 * const check = queryCheck(schema, { id: "account_id", operations: adapter.getCapabilities().operations });
 * await loadIntoTestDatabase(check.rows);
 * for (const c of check.cases) {
 *   const result = c.compare(await myDataQuery(c.state)); // the Host's own query, ids in order
 *   if (!result.ok) throw new Error(result.message);
 * }
 * ```
 *
 * This entry imports no test runner, and never reads or sends a real row. The rows each case keeps come from
 * `applyView`, so the check holds whatever meaning core holds.
 */

export interface QueryCheckOptions {
  /**
   * The key each row's id is under, such as `"account_id"`. When it is a text or number column of the schema, that
   * column holds the ids and is in no case. When it is no column of the schema, each row gains the key. The ids are the
   * numbers from 1 to the number of rows, in a fixed shuffle: numbers, or text ("1", "2") in a text column. No row's id
   * is its place in `rows`, so a Data Query that returns the database's own row numbers fails.
   */
  id: string;
  /**
   * The operations the Host's Grid Adapter lists: `adapter.getCapabilities().operations`. A count case appears only
   * when it lists `limit.set`. Left out, there is none.
   */
  operations?: readonly string[];
  /**
   * The IDs of columns the Host's database can't leave empty. They get no empty cells: no `null` and no empty text. A
   * name that is no column of the schema throws `INPUT_CONFIG`.
   */
  notNull?: readonly string[];
}

export interface QueryCheckCase {
  /** The rule the case tests, then the view in plain words: "not equal keeps empty cells (Custodian is not Northgate)". */
  name: string;
  /** The View State to run through the Data Query. */
  state: ViewState;
  /**
   * Checks the ids the Data Query returned for `state`, in the order it returned them. The ids are checked as a set,
   * and "4" and 4 are the same id. When the case sorts, the order is checked too, for the rows that hold a value in
   * every sorted column: where a row with an empty cell goes is the Host's own, and so is the order of rows that tie.
   * On a text column only text made of the letters A to Z and single spaces is ordered, and never two texts that differ
   * only in letter case: how a database orders other text is its own collation's. The same holds for an enum column's
   * values, which are ordered by their IDs, as text. On a date-and-time column, a clock
   * time with no offset beside instants has no checked place either.
   * The message names the case, the missing ids and the extra ids, and is whole on its own: "not equal keeps empty
   * cells (Custodian is not Northgate): 2 rows missing, ids 4 and 7". Anything but a list of ids throws `INPUT_CONFIG`.
   */
  compare(ids: ReadonlyArray<string | number>): { ok: true } | { ok: false; message: string };
}

export interface QueryCheck {
  /** Synthetic rows to load into a test database, keyed by column ID. Every value is made up from the schema. */
  rows: Array<Record<string, Scalar>>;
  /** One View State for each edge of each column and operator, then each filter beside others, and the sorts. */
  cases: QueryCheckCase[];
}

type Row = Record<string, Scalar>;
type Kind = ColumnDescriptor["kind"];

// --- The values that hit each edge (more grids spec, 4.1) -----------------------------------------------------

/**
 * A text column's values. Every name is invented. Between them they hold whitespace-only text, one text in two letter
 * cases with a letter outside A to Z, the same text without its accent, the same text with spaces around it, the same
 * words inside a longer text, a `%`
 * beside the same text with a digit in its place, a `_` beside the same text with a space in its place, a backslash,
 * `!` and `[` side by side (the characters a LIKE pattern escapes with, and a bracket), a text that starts with a small
 * letter, and placeholder text that is a value, not an empty cell.
 */
const TEXT = {
  blank: " ",
  mixed: "Ålder Fen",
  upper: "ÅLDER FEN",
  // The same letters with no accent. Core keeps Å and A apart; a collation that ignores accents reads them as one.
  plain: "Alder Fen",
  padded: " Ålder Fen ",
  inside: "Old Ålder Fen",
  percent: "Birch 100%",
  digit: "Birch 1000",
  underscore: "Cedar_Dun",
  spaced: "Cedar Dun",
  // A Data Query that escapes % and _ with "ESCAPE '\'" or "ESCAPE '!'" but leaves the escape character as it is reads
  // the pair as one plain character, and so never finds this text.
  escapes: "Fir\\![Holt",
  // Ordered by character code it comes after "Elm Garth"; ignoring case, before it.
  small: "cedar Row",
  other: "Elm Garth",
  unknown: "N/A",
  dash: "-",
} as const;

/**
 * What the text filters ask for. Each is written in a letter case no row holds, with small and capital letters both, so
 * a comparison that ignores case on one side only keeps no row either. The letter Å has no small form in A to Z, so a
 * comparison that folds only A to Z keeps no row.
 */
const ASKED = {
  text: "åLDER fen",
  /** The same text with no accent, which only the row without the accent holds. */
  plain: "aLDER fen",
  word: "åLDER F",
  other: "ELM garth",
  underscore: "cedar_DUN",
  start: "cedar_D",
  /** The text with the spaces around it that one row holds. */
  padded: " åLDER fen ",
  /** The start of that row, a space first. */
  paddedStart: " åLDER",
  /** The end of that row's words, with the space after them. */
  trailing: "fEN ",
  /** The start of the text with a `%`: read as a pattern, it also starts the text with a digit there. */
  percentStart: "bIRCH 100%",
  /** The middle of the text that holds a backslash, `!` and `[`, all three. */
  escapes: "r\\![hOL",
  /** The start of that text, to just after the `[`. */
  escapesStart: "fIR\\![",
} as const;

/**
 * A number column's values by kind: a negative number, zero, both ends of a range and the values just past them, and
 * one inside. They sort differently as text ("9" after "10"), so a comparison made on text shows. The first is the
 * negative number.
 */
const NUMBERS: Record<"number" | "currency" | "percent", { low: number; high: number; values: readonly number[] }> = {
  number: { low: 10, high: 100, values: [-40, 0, 9, 10, 55, 100, 101] },
  currency: { low: 1000, high: 250000, values: [-2500.5, 0, 999.99, 1000, 5000, 250000, 250000.01] },
  percent: { low: 0.1, high: 0.5, values: [-0.05, 0, 0.09, 0.1, 0.25, 0.5, 0.51] },
};

/** The two ends of a date range, and a day inside it. In 2026 the clocks change on both ends in America/New_York. */
const DAYS = { low: "2026-03-08", inside: "2026-06-15", high: "2026-11-01" } as const;

/** Values for an enum column that declares none. They are letters alone, so their order is checked in a sort. */
const UNDECLARED = ["alpha", "bravo", "charlie"];

const MIN_ROWS = 60;
const SEED = 0x5eed_c0de;

const isNumeric = (kind: Kind): kind is "number" | "currency" | "percent" => kind === "number" || kind === "currency" || kind === "percent";
const isDated = (kind: Kind): boolean => kind === "date" || kind === "datetime";

/**
 * The kinds every engine orders alike. Text and enum columns follow a collation, which differs by database, so each is
 * sorted on its own and only text made of the letters A to Z has a checked place.
 */
const ORDERED: ReadonlySet<Kind> = new Set(["number", "currency", "percent", "date", "datetime", "boolean"]);

/**
 * A date-and-time column's values around one day: the second before it starts, its first and last seconds, and the
 * first second after it. With a Calendar time zone they are instants, written in UTC, on that zone's midnights. With
 * none, core reads the browser's zone when it filters, which a check can't know, so they are clock times with no
 * offset: such a time is on its own date in every zone.
 */
const stampsAround = (day: string, zone: string | undefined): string[] => {
  if (zone === undefined) return clocksAround(day);
  const next = addDays(day, 1);
  const [start, end] = [instantOfCell(`${day}T00:00:00`, zone) ?? 0, instantOfCell(`${next}T00:00:00`, zone) ?? 0];
  return [start - 1000, start, end - 1000, end].map(utcStamp);
};
/** The same four seconds as clock times with no offset. Each is on its own date, whatever the time zone. */
const clocksAround = (day: string): string[] => [
  `${addDays(day, -1)}T23:59:59`,
  `${day}T00:00:00`,
  `${day}T23:59:59`,
  `${addDays(day, 1)}T00:00:00`,
];
const utcStamp = (at: number): string => `${new Date(at).toISOString().slice(0, 19)}Z`;
const noonOf = (day: string, zone: string | undefined): string =>
  zone === undefined ? `${day}T12:00:00` : utcStamp(instantOfCell(`${day}T12:00:00`, zone) ?? 0);

const enumIds = (column: ColumnDescriptor): string[] => {
  const declared = (column.enumValues ?? []).map((value) => value.id);
  return declared.length > 0 ? declared : UNDECLARED;
};

/** The values a column's cells take, each hitting an edge. `empties` is false for a column the database can't leave empty. */
const valuesFor = (column: ColumnDescriptor, empties: boolean, zone: string | undefined): Scalar[] => {
  const { kind } = column;
  const nothing: Scalar[] = empties ? [null] : [];
  if (kind === "string") return [...nothing, ...(empties ? [""] : []), ...Object.values(TEXT)];
  // Empty text is an empty cell on an enum column too, as on every column.
  if (kind === "enum") return [...nothing, ...(empties ? [""] : []), ...enumIds(column)];
  if (kind === "boolean") return [...nothing, true, false];
  if (isNumeric(kind)) return [...nothing, ...NUMBERS[kind].values];
  if (kind === "date") return [...nothing, addDays(DAYS.low, -1), DAYS.low, DAYS.inside, DAYS.high, addDays(DAYS.high, 1)];
  // With a Calendar time zone, clock times with no offset too: each is on its own date there, not the date it would
  // fall on if it were read as UTC.
  const clocks = zone === undefined ? [] : clocksAround(DAYS.low);
  return [...nothing, ...stampsAround(DAYS.low, zone), ...clocks, noonOf(DAYS.inside, zone), ...stampsAround(DAYS.high, zone)];
};

/** A restricted column's cell: a plain value, never empty and on no edge. */
const plainValue = (column: ColumnDescriptor, n: number, zone: string | undefined): Scalar => {
  const { kind } = column;
  if (kind === "string") return `Plain ${n}`;
  if (kind === "enum") return enumIds(column)[(n - 1) % enumIds(column).length] as string;
  if (kind === "boolean") return n % 2 === 0;
  if (kind === "percent") return 0.25;
  if (isNumeric(kind)) return n;
  return kind === "date" ? DAYS.inside : noonOf(DAYS.inside, zone);
};

// --- A fixed shuffle ------------------------------------------------------------------------------------------

/** A small seeded generator, so the same schema always gives the same rows. */
const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A number from a column's ID, so a column's cells don't move when another column joins the schema. */
const hashOf = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

const shuffled = <T>(items: readonly T[], random: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

// --- A case's name --------------------------------------------------------------------------------------------

const WORDS: Partial<Record<FilterOperator, string>> = {
  eq: "is",
  neq: "is not",
  gt: "is above",
  gte: "is at least",
  lt: "is below",
  lte: "is at most",
  contains: "contains",
  startsWith: "starts with",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
};
const DATE_WORDS: Partial<Record<FilterOperator, string>> = {
  eq: "is on",
  gt: "is after",
  gte: "is on or after",
  lt: "is before",
  lte: "is on or before",
};

const valueWords = (value: Scalar, column: ColumnDescriptor): string => {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return formatAmount(value, column.kind);
  if (column.kind === "enum") return column.enumValues?.find((e) => e.id === value)?.label ?? String(value);
  return isDated(column.kind) ? String(value) : `“${String(value)}”`;
};

/** A filter in plain words: "Custodian is not Northgate", "Booked is from 2026-03-08 to 2026-11-01". */
const filterWords = (p: Pick<FilterPredicate, "operator" | "value">, column: ColumnDescriptor, zone: string | undefined): string => {
  const { value } = p;
  const dated = isDated(column.kind);
  const said = (v: Scalar) => valueWords(v, column);
  // A day on a date-and-time column is a whole day in the Calendar's time zone, so the name says which.
  const where = column.kind === "datetime" && zone !== undefined && value !== undefined ? `, ${zone} time` : "";
  if (Array.isArray(value)) return `${column.label} is one of ${value.map(said).join(", ")}`;
  if (typeof value === "object" && value !== null) {
    return `${column.label} is ${dated ? "from" : "between"} ${said(value.min)} ${dated ? "to" : "and"} ${said(value.max)}${where}`;
  }
  const words = (dated ? DATE_WORDS[p.operator] : undefined) ?? WORDS[p.operator] ?? p.operator;
  return `${column.label} ${words}${value === undefined ? "" : ` ${said(value)}`}${where}`;
};

const sortWords = (sorts: readonly SortSpec[], label: (id: string) => string): string =>
  `sorted by ${sorts.map((s) => `${label(s.columnId)}, ${s.direction === "desc" ? "descending" : "ascending"}`).join(", then ")}`;

// --- The filters each column gets: one for each edge of each operator -----------------------------------------

interface Draft {
  /** The rule from the table in 4.1, in plain words. It starts the case's name. */
  rule: string;
  operator: FilterOperator;
  value?: FilterValue;
}

const NO_VALUE = "is empty keeps only cells with no value";
const HAS_VALUE = "is not empty leaves out cells with no value";

const draftsFor = (column: ColumnDescriptor, zone: string | undefined): Draft[] => {
  const { kind } = column;
  if (kind === "string") {
    return [
      { rule: "equal ignores case on text, and leaves out empty cells", operator: "eq", value: ASKED.text },
      // A collation that ignores accents would keep "Ålder Fen" too.
      { rule: "equal ignores case but not accents", operator: "eq", value: ASKED.plain },
      // A pattern match would read the _ as any one character, and keep the text with a space there too.
      { rule: "equal reads _ as plain text", operator: "eq", value: ASKED.underscore },
      { rule: "equal to empty text keeps exactly the empty cells", operator: "eq", value: "" },
      // Trimmed, what these ask for would keep other rows: the text without its spaces, or the empty cells.
      { rule: "equal keeps the spaces in what it asks for", operator: "eq", value: ASKED.padded },
      { rule: "equal to whitespace-only text keeps only that text, not the empty cells", operator: "eq", value: TEXT.blank },
      { rule: "not equal keeps empty cells, and ignores case on text", operator: "neq", value: ASKED.text },
      { rule: "not equal to empty text leaves out exactly the empty cells", operator: "neq", value: "" },
      { rule: "not equal keeps the spaces in what it asks for", operator: "neq", value: ASKED.padded },
      { rule: "in a list ignores case on text, and leaves out empty cells", operator: "in", value: [ASKED.text, ASKED.other] },
      { rule: "in a list of empty text keeps exactly the empty cells", operator: "in", value: [""] },
      { rule: "in a list keeps the spaces in what it asks for", operator: "in", value: [ASKED.padded, TEXT.blank] },
      // A Data Query that keeps empty text in a list only when it is asked for on its own leaves the empty cells out.
      {
        rule: "in a list with empty text among other values keeps the empty cells too",
        operator: "in",
        value: [ASKED.other, ""],
      },
      { rule: "contains ignores case, and leaves out empty cells", operator: "contains", value: ASKED.word },
      { rule: "contains reads % as plain text", operator: "contains", value: "%" },
      { rule: "contains reads _ as plain text", operator: "contains", value: "_" },
      { rule: "contains reads \\, ! and [ as plain text", operator: "contains", value: ASKED.escapes },
      { rule: "contains empty text keeps every row, empty cells included", operator: "contains", value: "" },
      { rule: "contains keeps the spaces in what it asks for", operator: "contains", value: ASKED.trailing },
      { rule: "contains whitespace-only text keeps only the text that holds it", operator: "contains", value: TEXT.blank },
      {
        rule: "starts with ignores case, looks only at the start, and leaves out empty cells",
        operator: "startsWith",
        value: ASKED.word,
      },
      { rule: "starts with reads % as plain text", operator: "startsWith", value: ASKED.percentStart },
      { rule: "starts with reads _ as plain text", operator: "startsWith", value: ASKED.start },
      { rule: "starts with reads \\, ! and [ as plain text", operator: "startsWith", value: ASKED.escapesStart },
      { rule: "starts with empty text keeps every row, empty cells included", operator: "startsWith", value: "" },
      { rule: "starts with keeps the spaces in what it asks for", operator: "startsWith", value: ASKED.paddedStart },
      { rule: "is empty keeps null and empty text, and leaves out whitespace-only and placeholder text", operator: "isEmpty" },
      { rule: "is not empty keeps whitespace-only and placeholder text, and leaves out null and empty text", operator: "isNotEmpty" },
    ];
  }
  if (kind === "enum") {
    const ids = enumIds(column);
    return [
      { rule: "equal is exact and leaves out empty cells", operator: "eq", value: ids[0] as string },
      { rule: "not equal keeps empty cells", operator: "neq", value: ids[0] as string },
      { rule: "in a list keeps each listed value and leaves out empty cells", operator: "in", value: ids.slice(0, 2) },
      { rule: NO_VALUE, operator: "isEmpty" },
      { rule: HAS_VALUE, operator: "isNotEmpty" },
    ];
  }
  if (kind === "boolean") {
    return [
      { rule: "yes keeps only yes and leaves out empty cells", operator: "eq", value: true },
      { rule: "no keeps only no and leaves out empty cells", operator: "eq", value: false },
    ];
  }
  if (isNumeric(kind)) {
    const { low, high, values } = NUMBERS[kind];
    const negative = values[0] as number;
    // An empty cell is no number, not zero. Each of these keeps zero, so a Data Query that reads an empty cell as zero
    // keeps the empty cells too, or, for "not equal to zero", leaves them out.
    const notZero = "leaves out empty cells, which are not zero";
    return [
      { rule: "equal to zero leaves out empty cells", operator: "eq", value: 0 },
      { rule: "not equal keeps empty cells", operator: "neq", value: low },
      { rule: "not equal to zero keeps empty cells, which are not zero", operator: "neq", value: 0 },
      { rule: "greater than leaves out the value itself and empty cells", operator: "gt", value: low },
      { rule: `greater than a negative number ${notZero}`, operator: "gt", value: negative },
      { rule: "greater than or equal includes the value itself and leaves out empty cells", operator: "gte", value: low },
      { rule: `greater than or equal to a negative number ${notZero}`, operator: "gte", value: negative },
      { rule: "less than leaves out the value itself and empty cells", operator: "lt", value: high },
      { rule: "less than or equal includes the value itself and leaves out empty cells", operator: "lte", value: high },
      { rule: "between includes both ends and leaves out empty cells", operator: "between", value: { min: low, max: high } },
      { rule: `between a range that holds zero ${notZero}`, operator: "between", value: { min: negative, max: low } },
      { rule: `${NO_VALUE}, and zero is a value`, operator: "isEmpty" },
      { rule: "is not empty keeps zero, and leaves out cells with no value", operator: "isNotEmpty" },
    ];
  }
  const wholeDay =
    kind === "datetime" && zone !== undefined
      ? "a date means the whole day in the calendar's time zone, and a time with no offset is on its own date"
      : "a date means the whole day";
  return [
    { rule: wholeDay, operator: "eq", value: DAYS.low },
    { rule: "after a date leaves out that whole day", operator: "gt", value: DAYS.low },
    { rule: "on or after a date includes that whole day", operator: "gte", value: DAYS.low },
    { rule: "before a date leaves out that whole day", operator: "lt", value: DAYS.high },
    { rule: "on or before a date includes that whole day", operator: "lte", value: DAYS.high },
    { rule: "between includes both ends, each a whole day", operator: "between", value: { min: DAYS.low, max: DAYS.high } },
    { rule: NO_VALUE, operator: "isEmpty" },
    { rule: HAS_VALUE, operator: "isNotEmpty" },
  ];
};

// --- What the Host passes -------------------------------------------------------------------------------------

const fail = (code: "INPUT_CONFIG" | "INPUT_SCHEMA", message: string): never => {
  throw new GridCueError(code, message);
};

const isNames = (value: unknown): value is string[] => Array.isArray(value) && value.every((name) => typeof name === "string");

const readOptions = (options: unknown, schema: ViewSchema): { id: string; counts: boolean; notNull: ReadonlySet<string> } => {
  if (typeof options !== "object" || options === null) {
    return fail("INPUT_CONFIG", 'queryCheck takes options after the schema: { id: "account_id" } names the key each row\'s id is under.');
  }
  const { id, operations, notNull } = options as Record<string, unknown>;
  if (typeof id !== "string" || id === "") {
    return fail("INPUT_CONFIG", 'id must name the key each row\'s id is under, such as "account_id".');
  }
  const column = schema.columns.find((c) => c.id === id);
  if (column && column.kind !== "string" && column.kind !== "number") {
    fail(
      "INPUT_CONFIG",
      `id names the column ${column.label}, which can't hold ids. Name a text or number column, or a key that is no column.`,
    );
  }
  if (operations !== undefined && !isNames(operations)) {
    fail("INPUT_CONFIG", "operations must be a list of operation names, such as adapter.getCapabilities().operations.");
  }
  if (notNull !== undefined && !isNames(notNull)) fail("INPUT_CONFIG", "notNull must be a list of column IDs.");
  const unknown = ((notNull as string[] | undefined) ?? []).find((name) => !schema.columns.some((c) => c.id === name));
  if (unknown !== undefined) fail("INPUT_CONFIG", `notNull names “${unknown}”, which is no column of the schema.`);
  return {
    id,
    counts: ((operations as string[] | undefined) ?? []).includes("limit.set"),
    notNull: new Set((notNull as string[] | undefined) ?? []),
  };
};

// --- compare's message ----------------------------------------------------------------------------------------

const NAMED_IDS = 10;

/** "id 4", "ids 4 and 7", "ids 1, 4 and 7", and after ten of them "and 3 more". */
const idWords = (ids: readonly string[]): string => {
  if (ids.length > NAMED_IDS) return `ids ${ids.slice(0, NAMED_IDS).join(", ")} and ${ids.length - NAMED_IDS} more`;
  if (ids.length === 1) return `id ${ids[0]}`;
  return `ids ${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;
};
const rowWords = (count: number, what: string, ids: readonly string[]): string =>
  `${count} ${count === 1 ? "row" : "rows"} ${what}, ${idWords(ids)}`;

const NUMBER_TEXT = /^-?\d+(?:\.\d+)?$/;
/** Ids in the order a message names them: numbers by size, then text. */
const byId = (a: string, b: string): number => {
  const [x, y] = [NUMBER_TEXT.test(a), NUMBER_TEXT.test(b)];
  if (x && y) return Number(a) - Number(b);
  if (x !== y) return x ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * Text that every database orders alike once letter case is ignored: the letters A to Z, with one space between words.
 * Where other text goes (a space at the start, `%`, `_`, a letter outside A to Z) is the database's collation's.
 */
const LETTERS = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

// --- The Query Check ------------------------------------------------------------------------------------------

/**
 * Builds the Query Check for a View Schema: synthetic rows, and the View States to run through the Host's own Data
 * Query, each with a `compare` for the ids that come back.
 *
 * - **`rows`** hold, for each column, the values that hit an edge of what a filter means: empty cells (`null`, and
 *   empty text on a text or enum column), whitespace-only text, one text in two letter cases, the same text without
 *   its accent, the same text with spaces around it, text holding `%` and `_`, text holding a backslash, `!` and `[`,
 *   placeholder text such as "N/A", negative numbers and zero, both ends of a range and the values just past them,
 *   dates and times on each side of a day's start and end, each declared enum value, and yes, no and empty. A
 *   restricted column gets plain values. No row's id is its place in `rows`.
 * - **`cases`** are one View State for each edge of each column and operator the column allows; one with no filter;
 *   each of those filters beside a filter on another column; two filters on one column; a filter on a hidden column;
 *   then two filters on two columns joined with "and", an "or" group, an "or" group inside an "and", and two sorts on
 *   two columns. A sort with no count, each text and enum column sorted each way, and a sort on each column a case
 *   sorts by, with that column hidden. With `limit.set` in `operations` there are count cases too. Restricted columns
 *   and the id column are in none. A case never groups.
 * - The cases that sort by two columns, and the counts that cut, sort only number, date and yes/no columns. A text or
 *   enum column is sorted on its own, and only the order of text made of the letters A to Z is checked: a database
 *   orders other text by its own collation. An enum is ordered by its values' IDs, as text.
 * - A date-and-time column holds instants, written in UTC, when the schema's Calendar names a time zone, and clock times
 *   with no offset beside them. With none it holds only clock times with no offset, which are on their own date in
 *   every zone.
 *
 * The same schema and options always give the same rows and cases. It throws `INPUT_SCHEMA` for something that is no
 * View Schema, and `INPUT_CONFIG` for options it can't use.
 */
export const queryCheck = (schema: ViewSchema, options: QueryCheckOptions): QueryCheck => {
  const parsed = ViewSchema.safeParse(schema);
  if (!parsed.success) return fail("INPUT_SCHEMA", "queryCheck takes a View Schema first, such as the one defineSchema returns.");
  const view = parsed.data;
  const zone = view.calendar?.timeZone;
  if (zone !== undefined && !isTimeZone(zone)) {
    return fail("INPUT_SCHEMA", "The schema's calendar names a time zone this runtime doesn't know.");
  }
  const { id, counts, notNull } = readOptions(options, view);
  const usable = view.columns.filter((c) => c.sensitivity !== "restricted" && c.id !== id);
  const label = (columnId: string) => view.columns.find((c) => c.id === columnId)?.label ?? columnId;

  // --- Rows ---
  const total = Math.max(MIN_ROWS, ...usable.map((c) => 4 * valuesFor(c, !notNull.has(c.id), zone).length));
  const numbers = Array.from({ length: total }, (_, i) => i + 1);
  const idColumn = view.columns.find((c) => c.id === id);
  // Each row's id is the number after its own in a fixed shuffle of 1 to n, so no row's id is its own number: a Data
  // Query that returns the database's row numbers in place of the ids fails.
  const cycle = shuffled(numbers, seeded(SEED));
  const nextInCycle = new Map(cycle.map((n, k) => [n, cycle[(k + 1) % cycle.length] as number]));
  const idOf = (n: number): Scalar => {
    const shuffledId = nextInCycle.get(n) as number;
    return idColumn?.kind === "string" ? String(shuffledId) : shuffledId;
  };
  const cells = new Map<string, Scalar[]>(
    view.columns.map((column) => {
      if (column.id === id) return [column.id, numbers.map(idOf)];
      if (column.sensitivity === "restricted") return [column.id, numbers.map((n) => plainValue(column, n, zone))];
      const values = valuesFor(column, !notNull.has(column.id), zone);
      const cycled = numbers.map((_, i) => values[i % values.length] as Scalar);
      return [column.id, shuffled(cycled, seeded(hashOf(column.id) ^ SEED))];
    }),
  );
  const rows: Row[] = numbers.map((n, i) => ({
    ...(idColumn ? {} : { [id]: idOf(n) }),
    ...Object.fromEntries(view.columns.map((column) => [column.id, (cells.get(column.id) as Scalar[])[i] as Scalar])),
  }));
  const position = new Map(rows.map((row, i) => [String(row[id]), i]));
  const cellsIn = (column: ColumnDescriptor) => cells.get(column.id) as Scalar[];
  /**
   * For each text and enum column, the cells whose order is checked: letters only, and no other cell that differs only
   * in case. An enum's cells are its values' IDs, which core orders as text.
   */
  const orderable = new Map<string, ReadonlySet<Scalar>>(
    usable
      .filter((c) => c.kind === "string" || c.kind === "enum")
      .map((column) => {
        const texts = [...new Set(cellsIn(column))].filter((v): v is string => typeof v === "string" && LETTERS.test(v));
        const alone = texts.filter((t) => !texts.some((other) => other !== t && other.toLowerCase() === t.toLowerCase()));
        return [column.id, new Set(alone)];
      }),
  );
  /**
   * The date-and-time columns that hold clock times with no offset beside instants. Core orders their cells as text, and
   * a Data Query may order them by the instant each names, so where such a clock time sorts is not checked.
   */
  const mixed = new Set(usable.filter((c) => c.kind === "datetime" && zone !== undefined).map((c) => c.id));
  const isClock = (columnId: string, cell: Scalar): boolean => mixed.has(columnId) && typeof cell === "string" && !cell.endsWith("Z");
  /** Whether a row's cell has a place every right Data Query agrees on, in a sort by its column. */
  const placed = (columnId: string, cell: Scalar): boolean =>
    !isEmpty(cell) && !isClock(columnId, cell) && (orderable.get(columnId)?.has(cell) ?? true);
  /** The rows a View State keeps, in order, as positions in `rows`. `applyView` is the only judge. */
  const keptBy = (state: ViewState): number[] => applyView(rows, state, view).rows.map((row) => position.get(String(row[id])) as number);

  // --- Cases ---
  const base = emptyViewState(view.columns.filter((c) => c.sensitivity !== "restricted").map((c) => c.id));
  const group = (combinator: "and" | "or", children: FilterGroup["children"], groupId = "root"): FilterGroup => ({
    id: groupId,
    type: "group",
    combinator,
    children,
  });
  const cases: QueryCheckCase[] = [];
  const add = (name: string, state: ViewState): number[] => {
    const kept = keptBy(state);
    const expected = new Set(kept);
    const sortIds = state.sorts.map((s) => s.columnId);
    const key = (at: number) => sortIds.map((columnId) => (rows[at] as Row)[columnId]);
    const ordered = (at: number) => sortIds.every((columnId) => placed(columnId, (rows[at] as Row)[columnId] as Scalar));
    const idAt = (at: number) => String((rows[at] as Row)[id]);
    const compare: QueryCheckCase["compare"] = (ids) => {
      if (!Array.isArray(ids) || ids.some((value) => typeof value !== "string" && typeof value !== "number")) {
        return fail(
          "INPUT_CONFIG",
          "compare takes the ids your Data Query returned, as a list of text or numbers, in the order it returned them.",
        );
      }
      // The ids as a set: each once, in the order it first came.
      const given = [...new Set(ids.map(String))];
      const found = new Set(given.flatMap((text) => position.get(text) ?? []));
      const missing = [...expected]
        .filter((at) => !found.has(at))
        .map(idAt)
        .sort(byId);
      const extra = [
        ...[...found]
          .filter((at) => !expected.has(at))
          .map(idAt)
          .sort(byId),
        ...given.filter((text) => !position.has(text)),
      ];
      const problems = [
        ...(missing.length > 0 ? [rowWords(missing.length, "missing", missing)] : []),
        ...(extra.length > 0 ? [rowWords(extra.length, "extra", extra)] : []),
      ];
      if (problems.length === 0 && sortIds.length > 0) {
        // The order, for the rows that hold a value in every sorted column, and on a text column text every database
        // orders alike. Rows that tie hold the same cells, so comparing the cells place by place lets them come in
        // either order.
        const want = kept.filter(ordered);
        const got = given.map((text) => position.get(text) as number).filter(ordered);
        const at = want.findIndex((expectedAt, i) => key(expectedAt).some((cell, n) => cell !== key(got[i] as number)[n]));
        if (at >= 0) problems.push(`wrong order: id ${idAt(got[at] as number)} came where id ${idAt(want[at] as number)} belongs`);
      }
      return problems.length === 0 ? { ok: true } : { ok: false, message: `${name}: ${problems.join("; ")}` };
    };
    cases.push({ name, state: structuredClone(state), compare });
    return kept;
  };

  // One filter on one column, for each edge of each operator the column allows. Validation's own check decides what a
  // column allows, so a case is always a View State the grid could hold.
  interface Single {
    columnId: string;
    predicate: FilterPredicate;
    words: string;
    /** Whether it keeps each row, by the row's position. */
    keeps: boolean[];
    size: number;
  }
  const singles: Single[] = [];
  for (const column of usable) {
    for (const draft of draftsFor(column, zone)) {
      const predicate: FilterPredicate = {
        id: "f1",
        type: "predicate",
        columnId: column.id,
        operator: draft.operator,
        ...(draft.value === undefined ? {} : { value: draft.value }),
      };
      if (filterIssues(predicate, view).length > 0) continue;
      const words = filterWords(predicate, column, zone);
      const kept = new Set(add(`${draft.rule} (${words})`, { ...base, filters: group("and", [predicate]) }));
      singles.push({ columnId: column.id, predicate, words, keeps: rows.map((_, i) => kept.has(i)), size: kept.size });
    }
  }

  // Filters on two columns. Each column offers the two filters that split the rows most evenly, leaving out lists and
  // empty text so the name reads plainly. The first combination that a wrong joining would get wrong is the case, and
  // columns of two different kinds come first.
  const splitters = usable.flatMap((column) =>
    singles
      .filter((s) => s.columnId === column.id && s.predicate.operator !== "in" && s.predicate.value !== "")
      .sort((a, b) => Math.abs(a.size - total / 2) - Math.abs(b.size - total / 2))
      .slice(0, 2),
  );
  const sizeOf = (keeps: boolean[]) => keeps.filter(Boolean).length;
  const both = (a: boolean[], b: boolean[]) => a.map((kept, i) => kept && (b[i] as boolean));
  const either = (a: boolean[], b: boolean[]) => a.map((kept, i) => kept || (b[i] as boolean));
  const same = (a: boolean[], b: boolean[]) => a.every((kept, i) => kept === b[i]);
  const named = (s: Single, filterId: string): FilterPredicate => ({ ...s.predicate, id: filterId });
  const kindOf = (s: Single) => view.columns.find((c) => c.id === s.columnId)?.kind;
  const everyPair = splitters.flatMap((a, i) =>
    splitters.slice(i + 1).flatMap((b) => (a.columnId === b.columnId ? [] : [[a, b] as const])),
  );
  const pairs = [...everyPair.filter(([a, b]) => kindOf(a) !== kindOf(b)), ...everyPair.filter(([a, b]) => kindOf(a) === kindOf(b))];
  const byEvenness = (list: readonly Single[]): Single[] =>
    [...list].sort((a, b) => Math.abs(a.size - total / 2) - Math.abs(b.size - total / 2));

  // No filter and no sort: every row. Only beside filters, so a schema with nothing to filter has no case.
  if (singles.length > 0) add("no filters keep every row (no filter and no sort)", base);

  // Each filter beside a filter on another column, joined with "and". A Data Query may write one filter as conditions
  // joined with "or" (a list, "is empty", "is not"): without brackets around them, "and" binds only the nearest. The
  // other filter leaves out a row of each value this one keeps, so wherever the "or" falls, a row comes back that
  // shouldn't.
  const valueKey = (cell: Scalar) => (cell === null ? "null" : `${typeof cell}:${String(cell)}`);
  const leavesOutEachValue = (other: Single, s: Single): boolean => {
    const leftOut = new Set(rows.flatMap((row, i) => (other.keeps[i] ? [] : [valueKey(row[s.columnId] as Scalar)])));
    return rows.every((row, i) => !s.keeps[i] || leftOut.has(valueKey(row[s.columnId] as Scalar)));
  };
  const caseNames = () => new Set(cases.map((c) => c.name));
  for (const s of singles) {
    if (s.size === 0) continue;
    const partners = byEvenness(singles.filter((other) => other.columnId !== s.columnId && leavesOutEachValue(other, s)));
    const other = partners.find((p) => sizeOf(both(p.keeps, s.keeps)) > 0) ?? partners[0];
    if (!other) continue;
    const name = `a filter joined with and keeps its own brackets (${other.words} and ${s.words})`;
    if (caseNames().has(name)) continue;
    add(name, { ...base, filters: group("and", [named(other, "f1"), named(s, "f2")]) });
  }

  // Two filters on one column, joined with "and": each leaves out rows the other keeps, so a Data Query that keeps one
  // filter for each column fails.
  for (const column of usable) {
    const own = byEvenness(singles.filter((s) => s.columnId === column.id));
    const candidates = own
      .flatMap((a, i) => own.slice(i + 1).map((b) => [a, b] as const))
      .filter(([a, b]) => !same(both(a.keeps, b.keeps), a.keeps) && !same(both(a.keeps, b.keeps), b.keeps));
    const pair = candidates.find(([a, b]) => sizeOf(both(a.keeps, b.keeps)) > 0) ?? candidates[0];
    if (!pair) continue;
    const [a, b] = pair;
    add(`two filters on one column must both hold (${a.words} and ${b.words})`, {
      ...base,
      filters: group("and", [named(a, "f1"), named(b, "f2")]),
    });
  }

  // A filter on a column the view hides: hiding a column changes what shows, never which rows.
  for (const column of usable) {
    const [s] = byEvenness(singles.filter((x) => x.columnId === column.id));
    if (!s) continue;
    add(`a filter on a hidden column still holds (${s.words}, with ${column.label} hidden)`, {
      ...base,
      visibleColumnIds: base.visibleColumnIds.filter((columnId) => columnId !== column.id),
      filters: group("and", [s.predicate]),
    });
  }

  const and = pairs.find(([a, b]) => {
    const size = sizeOf(both(a.keeps, b.keeps));
    return size > 0 && size < Math.min(a.size, b.size);
  });
  if (and) {
    const [a, b] = and;
    add(`filters on two columns must both hold (${a.words} and ${b.words})`, {
      ...base,
      filters: group("and", [named(a, "f1"), named(b, "f2")]),
    });
  }
  const or = pairs.find(([a, b]) => {
    const size = sizeOf(either(a.keeps, b.keeps));
    return size > Math.max(a.size, b.size) && size < total;
  });
  if (or) {
    const [a, b] = or;
    add(`an or group keeps a row that either filter keeps (${a.words} or ${b.words})`, {
      ...base,
      filters: group("or", [named(a, "f1"), named(b, "f2")]),
    });
  }
  // "(a or b) and c": read with no brackets it is "a or (b and c)", joined with one word it is all "and" or all "or",
  // and with the group dropped it is "c" alone.
  const tellsApart = (a: Single, b: Single, c: Single): boolean => {
    const anyOf = either(a.keeps, b.keeps);
    const right = both(anyOf, c.keeps);
    return (
      sizeOf(right) > 0 &&
      !same(right, anyOf) &&
      !same(right, c.keeps) &&
      !same(right, either(a.keeps, both(b.keeps, c.keeps))) &&
      !same(right, both(both(a.keeps, b.keeps), c.keeps)) &&
      !same(right, either(anyOf, c.keeps))
    );
  };
  nested: for (const [a, b] of pairs) {
    const others = splitters.filter((c) => c !== a && c !== b);
    const elsewhere = (c: Single) => c.columnId !== a.columnId && c.columnId !== b.columnId;
    // A third column first, then a second filter on one of the two.
    for (const c of [...others.filter(elsewhere), ...others.filter((s) => !elsewhere(s))]) {
      if (!tellsApart(a, b, c)) continue;
      // The shape the View State takes when an "and" filter joins an "or" group.
      add(`an or group inside an and keeps its own brackets (either ${a.words} or ${b.words}, and ${c.words})`, {
        ...base,
        filters: group("and", [group("or", [named(a, "f1"), named(b, "f2")]), named(c, "f3")], "root_f3"),
      });
      break nested;
    }
  }

  // Sorts on two columns, each direction on each. Where a row with an empty cell goes is not checked.
  const sortable = usable.filter((c) => ORDERED.has(c.kind) && c.capabilities.includes("sort"));
  const [first, second] = sortable;
  if (first) {
    for (const [one, two] of [
      ["asc", "desc"],
      ["desc", "asc"],
    ] as const) {
      const sorts: SortSpec[] = [{ columnId: first.id, direction: one }, ...(second ? [{ columnId: second.id, direction: two }] : [])];
      add(`sorts by each column in turn, in its direction (${sortWords(sorts, label)})`, { ...base, sorts });
    }
  }

  // A sort with no count keeps every row, the rows with no value in the sorted column too.
  for (const column of sortable) {
    if (!cellsIn(column).some(isEmpty)) continue;
    const sorts: SortSpec[] = [{ columnId: column.id, direction: "asc" }];
    add(`a sort with no count keeps the rows with no value (${sortWords(sorts, label)})`, { ...base, sorts });
  }

  // Each text column sorted on its own, each way. Core orders text ignoring case first; ordered by character code, a
  // text that starts with a small letter comes after every text that starts with a capital. Only text made of the
  // letters A to Z is checked for its place, so a right Data Query passes on any collation that ignores case.
  // An enum column too: core orders it by its values' IDs, as text. Not by their labels, and not in the order they are
  // declared, as a database's own enum type would. An enum with fewer than two IDs of letters alone has no such case.
  const sortableText = usable.filter((c) => c.kind === "string" && c.capabilities.includes("sort"));
  const sortableEnums = usable.filter((c) => c.kind === "enum" && c.capabilities.includes("sort") && (orderable.get(c.id)?.size ?? 0) >= 2);
  const collated = [...sortableText, ...sortableEnums];
  for (const column of collated) {
    if ((orderable.get(column.id)?.size ?? 0) < 2) continue;
    const rule = column.kind === "enum" ? "an enum sorts by its values' IDs, ignoring case" : "text sorts by its letters, ignoring case";
    for (const direction of ["asc", "desc"] as const) {
      const sorts: SortSpec[] = [{ columnId: column.id, direction }];
      add(`${rule} (${sortWords(sorts, label)})`, { ...base, sorts });
    }
  }

  // A sort on a column the view hides: hiding a column changes what shows, never the order of the rows. One for each
  // column a case sorts by, descending, so a Data Query that drops the sort returns the rows in the order they were
  // loaded, and fails.
  for (const column of [...sortable, ...collated]) {
    const sorts: SortSpec[] = [{ columnId: column.id, direction: "desc" }];
    add(`a sort on a hidden column still orders the rows (${sortWords(sorts, label)}, with ${column.label} hidden)`, {
      ...base,
      visibleColumnIds: base.visibleColumnIds.filter((columnId) => columnId !== column.id),
      sorts,
    });
  }

  // A count (ADR 0027): the first rows of the sorted, filtered rows, and never a row with no value in the first sorted
  // column. Each sorts by one column, and the cut falls between two different values, so neither rows that tie nor
  // where an empty cell sorts can change which rows a right Data Query keeps.
  if (counts && first) {
    const sorts: SortSpec[] = [{ columnId: first.id, direction: "desc" }];
    const cell = (at: number) => (rows[at] as Row)[first.id] as Scalar;
    /** The day a date or date-and-time cell names, as written. */
    const dayOf = (at: number) => String(cell(at)).slice(0, 10);
    /**
     * Where a count may cut rows in this order: between two different values of the first sorted column, each with a
     * checked place. A clock time with no offset may sort elsewhere in a right Data Query, but never more than a day
     * from where core puts it, so the cut stays two days clear of every such cell among the rows.
     */
    const cutsIn = (inOrder: readonly number[], candidates: readonly number[]): number[] => {
      const clocks = inOrder.filter((at) => isClock(first.id, cell(at)));
      const clear = (at: number) => clocks.every((clock) => [-2, -1, 0, 1, 2].every((days) => addDays(dayOf(clock), days) !== dayOf(at)));
      return candidates.filter((n) => {
        if (n < 1 || n >= inOrder.length) return false;
        const [before, after] = [inOrder[n - 1] as number, inOrder[n] as number];
        return (
          cell(before) !== cell(after) && placed(first.id, cell(before)) && placed(first.id, cell(after)) && clear(before) && clear(after)
        );
      });
    };
    for (const filter of splitters.filter((s) => s.columnId !== first.id)) {
      const filters = group("and", [filter.predicate]);
      const inOrder = keptBy({ ...base, filters, sorts, limit: total });
      const cuts = cutsIn(inOrder, [5, 6, 7, 8, 9, 10, 4, 3, 2]);
      // A cut made before the filter must keep other rows, or the case would pass a Data Query that cuts first.
      const limit = cuts.find((n) => {
        const cutFirst = keptBy({ ...base, sorts, limit: n }).filter((at) => filter.keeps[at]);
        return cutFirst.length !== n;
      });
      if (limit === undefined) continue;
      add(
        `a count keeps the first rows of the sorted, filtered rows (the first ${limit} rows, ${sortWords(sorts, label)}, where ${filter.words})`,
        {
          ...base,
          filters,
          sorts,
          limit,
        },
      );
      break;
    }
    // A row with a value in the first sorted column and none in a later one keeps its place by the first: the count
    // keeps it when that place is before the cut. Sorted by two columns, with such a row before the cut and a row that
    // holds both values after it, a Data Query that puts every row with an empty sort cell last and then cuts ("ORDER
    // BY b IS NULL, a, b") leaves the row out. The cut falls between two values of the first column, so where an empty
    // cell sorts among rows that tie can't change which rows a right Data Query keeps.
    const later = sortable.find(
      (c) => c !== first && cellsIn(c).some((value, i) => isEmpty(value) && !isEmpty(cellsIn(first)[i] as Scalar)),
    );
    if (later) {
      const twoSorts: SortSpec[] = [
        { columnId: first.id, direction: "desc" },
        { columnId: later.id, direction: "asc" },
      ];
      const inOrder = keptBy({ ...base, sorts: twoSorts, limit: total });
      const holeAt = (at: number) => isEmpty((rows[at] as Row)[later.id] as Scalar);
      const candidates = [5, 6, 7, 8, 9, 10, 4, 3, 2, ...inOrder.map((_, n) => n).filter((n) => n > 10)];
      const limit = cutsIn(inOrder, candidates).find((n) => inOrder.slice(0, n).some(holeAt) && inOrder.slice(n).some((at) => !holeAt(at)));
      if (limit !== undefined) {
        add(`a count keeps a row with no value in a later sorted column (the first ${limit} rows, ${sortWords(twoSorts, label)})`, {
          ...base,
          sorts: twoSorts,
          limit,
        });
      }
    }
    // It asks for as many rows as there are, so a Data Query that keeps a row with no value returns too many. With no
    // cut, a second sort is safe: a row with a value in the first sorted column and none in the second must stay.
    const holed = sortable.find((c) => cellsIn(c).some(isEmpty));
    if (holed) {
      const then = sortable.find((c) => c !== holed && cellsIn(c).some((value, i) => isEmpty(value) && !isEmpty(cellsIn(holed)[i])));
      const ascending: SortSpec[] = [
        { columnId: holed.id, direction: "asc" },
        ...(then ? [{ columnId: then.id, direction: "desc" as const }] : []),
      ];
      add(`a count never keeps a row with no value in the first sorted column (the first ${total} rows, ${sortWords(ascending, label)})`, {
        ...base,
        sorts: ascending,
        limit: total,
      });
    }
  }
  // The same on each text and enum column, where empty text is no value too.
  if (counts) {
    for (const column of collated) {
      if (!cellsIn(column).some(isEmpty)) continue;
      const sorts: SortSpec[] = [{ columnId: column.id, direction: "asc" }];
      add(`a count never keeps a row with no value in the first sorted column (the first ${total} rows, ${sortWords(sorts, label)})`, {
        ...base,
        sorts,
        limit: total,
      });
    }
  }

  return { rows: structuredClone(rows), cases };
};
