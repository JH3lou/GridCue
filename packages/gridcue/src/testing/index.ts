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
   * and "4" and 4 are the same id. When the case sorts, the order is checked too. Three things are the Host's own,
   * because a database has no load order and GridCue doesn't state where an empty cell sorts:
   *
   * - Rows that tie on every sorted column may come in any order.
   * - A row with an empty sort cell is checked by its leading sorted columns that hold a value, up to its first empty
   *   one. Where it sits among the rows that share those values is the Host's. A row with no value in the first
   *   sorted column may sit anywhere.
   * - A count that cuts inside a run of rows the sorts don't tell apart may keep any of them for its last places. It
   *   must keep every row ahead of them, none behind them, every row the sorts put ahead of a row it keeps, and its
   *   number of rows in all. Only there are the ids not one fixed set.
   *
   * On a text column only text made of the letters A to Z and single spaces is ordered, and never two texts that differ
   * only in letter case: how a database orders other text is its own collation's. The same holds for an enum column's
   * values, which are ordered by their IDs, as text. On a date-and-time column, a clock time with no offset beside
   * instants has no checked place either. In the order, a row with such a cell is checked as a row with an empty cell
   * there is: by the sorted columns before it.
   *
   * The message names the case, the missing ids and the extra ids, and is whole on its own: "not equal keeps empty
   * cells (Custodian is not Northgate): 2 rows missing, ids 4 and 7". A count that returns the wrong number of rows
   * also reads "9 rows came back, and the count asks for 6", after any missing and extra ids, and rows out of order
   * "wrong order: id 4 came where id 7 belongs". Anything but a list of ids throws `INPUT_CONFIG`.
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

/** Filters a sort or a count sits beside: the rows they keep, by position, in plain words, and the columns they hide. */
interface Shape {
  filters: FilterGroup;
  keeps: boolean[];
  words: string;
  hidden: string[];
}

// --- The values that hit each edge (more grids spec, 4.1) -----------------------------------------------------

/**
 * A text column's values. Every name is invented. Between them they hold whitespace-only text, one text in two letter
 * cases with a letter outside A to Z, the same text without its accent, a second pair that differs only by an é, the
 * same text with spaces around it, the same words inside a longer text, a `%`
 * beside the same text with a digit in its place, a `_` beside the same text with a space in its place, a backslash,
 * `!` and `[` side by side (the characters a LIKE pattern escapes with, and a bracket), a text that starts with a small
 * letter and is shorter than the other texts of letters alone, and placeholder text that is a value, not an empty cell.
 */
const TEXT = {
  blank: " ",
  mixed: "Ålder Fen",
  upper: "ÅLDER FEN",
  // The same letters with no accent. Core keeps Å and A apart; a collation that ignores accents reads them as one.
  plain: "Alder Fen",
  // A pair that differs only by an accent outside å, ä and ö. A Swedish or Finnish collation keeps those three as
  // letters of their own, so it passes the pair above, and reads é as e.
  acute: "Hazél Tor",
  acutePlain: "Hazel Tor",
  padded: " Ålder Fen ",
  inside: "Old Ålder Fen",
  percent: "Birch 100%",
  digit: "Birch 1000",
  underscore: "Cedar_Dun",
  spaced: "Cedar Dun",
  // A Data Query that escapes % and _ with "ESCAPE '\'" or "ESCAPE '!'" but leaves the escape character as it is reads
  // the pair as one plain character, and so never finds this text.
  escapes: "Fir\\![Holt",
  // Ordered by character code it comes after "Elm Garth"; ignoring case, before it. It is the only text of letters alone
  // that isn't nine characters long, and its letters put it in the middle of them: ordered by length first, it comes
  // first or last.
  small: "cob",
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
  /** The same text with no accent, which only the row without the accent holds, and its start. */
  plain: "aLDER fen",
  plainStart: "aLDER F",
  /** The text with an é, which only the row with the accent holds, a piece of it, and its start. */
  acute: "hAZÉL tor",
  acuteWord: "aZÉL t",
  acuteStart: "hAZÉL",
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
 * The kinds every engine orders alike. Text and enum columns follow a collation, which differs by database, so none
 * leads a sort by two or more columns, and only text made of the letters A to Z has a checked place.
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

/** "Household", "Household and Market value", "Household, Advisor and Market value". */
const listWords = (items: readonly string[]): string =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

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
      // A collation that keeps å, ä and ö apart and folds every other accent would keep "Hazel Tor" too.
      { rule: "equal keeps é and e apart", operator: "eq", value: ASKED.acute },
      // A pattern match would read the _ as any one character, and keep the text with a space there too.
      { rule: "equal reads _ as plain text", operator: "eq", value: ASKED.underscore },
      { rule: "equal to empty text keeps exactly the empty cells", operator: "eq", value: "" },
      // Trimmed, what these ask for would keep other rows: the text without its spaces, or the empty cells.
      { rule: "equal keeps the spaces in what it asks for", operator: "eq", value: ASKED.padded },
      { rule: "equal to whitespace-only text keeps only that text, not the empty cells", operator: "eq", value: TEXT.blank },
      { rule: "not equal keeps empty cells, and ignores case on text", operator: "neq", value: ASKED.text },
      // Each text operator has the two accent cases "equal" has: a collation that folds an accent keeps, or leaves
      // out, the text without it too.
      { rule: "not equal ignores case but not accents", operator: "neq", value: ASKED.plain },
      { rule: "not equal keeps é and e apart", operator: "neq", value: ASKED.acute },
      { rule: "not equal to empty text leaves out exactly the empty cells", operator: "neq", value: "" },
      { rule: "not equal keeps the spaces in what it asks for", operator: "neq", value: ASKED.padded },
      { rule: "in a list ignores case on text, and leaves out empty cells", operator: "in", value: [ASKED.text, ASKED.other] },
      { rule: "in a list ignores case but not accents", operator: "in", value: [ASKED.plain, ASKED.other] },
      { rule: "in a list keeps é and e apart", operator: "in", value: [ASKED.acute, ASKED.other] },
      { rule: "in a list of empty text keeps exactly the empty cells", operator: "in", value: [""] },
      { rule: "in a list keeps the spaces in what it asks for", operator: "in", value: [ASKED.padded, TEXT.blank] },
      // A Data Query that keeps empty text in a list only when it is asked for on its own leaves the empty cells out.
      {
        rule: "in a list with empty text among other values keeps the empty cells too",
        operator: "in",
        value: [ASKED.other, ""],
      },
      { rule: "contains ignores case, and leaves out empty cells", operator: "contains", value: ASKED.word },
      { rule: "contains ignores case but not accents", operator: "contains", value: ASKED.plainStart },
      { rule: "contains keeps é and e apart", operator: "contains", value: ASKED.acuteWord },
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
      { rule: "starts with ignores case but not accents", operator: "startsWith", value: ASKED.plainStart },
      { rule: "starts with keeps é and e apart", operator: "startsWith", value: ASKED.acuteStart },
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
 *   its accent, a second pair of texts that differ only by an é, the same text with spaces around it, text holding `%`
 *   and `_`, text holding a backslash, `!` and `[`, text of letters alone of two lengths, placeholder text such as
 *   "N/A", negative numbers and zero, both ends of a range and the values just past them, dates and times on each side
 *   of a day's start and end, each declared enum value, and yes, no and empty. A restricted column gets plain values.
 *   No row's id is its place in `rows`.
 * - **`cases`** are one View State for each edge of each column and operator the column allows, accents among them
 *   for every text operator; one with no filter; each of those filters beside a filter on another column; two filters
 *   on one column; a filter on a hidden column, alone, inside an "or" group, inside an "or" group inside an "and", and
 *   inside an "and" group inside an "or"; then two filters on two columns joined with "and", an "or" group, an "or"
 *   group of three filters, an "or" group inside an "and", and two sorts on two columns. Two more sorts on two columns,
 *   for a row with no value in the second. A sort with no count, each number column sorted each way by its value, each
 *   text and enum column sorted each way, an enum and a text column each sorted second, each way; each column a case
 *   sorts by, sorted each way beside a filter and once with that column hidden; two sorts beside a filter, the second a
 *   number, date or yes/no column, an enum and text, each way; one sort and two beside each "or" group, each way; a
 *   sort on each column a case sorts by, with that column hidden, a second sort on a hidden column, and a sort with
 *   long runs of rows that tie, for a Host that reads each case in pages. With `limit.set` in `operations` there are
 *   count cases too: the first rows of the sorted, filtered rows; a count beside each "or" group; a row with no value
 *   in a later sorted column, for each column that holds empty cells; never a row with no value in the first; for each
 *   number, date and yes/no column, each way, a count that cuts inside a run of rows that tie, and one beside a filter;
 *   for each, a count with a second sort, each way, that cuts inside a run of rows that tie on the first, a count with
 *   three sorts, the third each way, that cuts inside a run of rows that tie on the first two, and a count with four,
 *   the fourth each way, that cuts inside a run of rows that tie on the first three; for each text and enum column, a
 *   count with it sorted second, each way, that cuts inside a run of rows that tie on the first, and a count sorted by
 *   it, each way; and for each number, date and yes/no column, a count sorted by it with it hidden, and a count whose
 *   second sort, and one whose third, is on a hidden column. The sort and count cases beside an "or" group sit beside
 *   each "or" group, and beside each shape of a filter on a hidden column with the sorted columns hidden too: one sort
 *   and two, each way, and with `limit.set` a count of the first rows, a count that cuts inside a run of rows that tie,
 *   and a count with two sorts, the second each way, that cuts inside a run of rows that tie on the first. Restricted
 *   columns and the id column are in none. A case never groups.
 * - A sort by two or more columns starts with a number, date or yes/no column. Only the order of text made of the
 *   letters A to Z is checked: a database orders other text by its own collation. An enum is ordered by its values'
 *   IDs, as text. Where a text or enum column decides which rows a count keeps, only its values with a checked place
 *   decide it. A count sorted by such a column, first or second, sits beside a filter that keeps only those values,
 *   where the column allows one.
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
  const cellAt = (at: number, columnId: string): Scalar => (rows[at] as Row)[columnId] as Scalar;

  // --- Cases ---
  const base = emptyViewState(view.columns.filter((c) => c.sensitivity !== "restricted").map((c) => c.id));
  const group = (combinator: "and" | "or", children: FilterGroup["children"], groupId = "root"): FilterGroup => ({
    id: groupId,
    type: "group",
    combinator,
    children,
  });

  // --- What a sort decides between two rows (more grids spec, 5.5) ---
  /** For each column, the place of each of its values in the order core sorts them, going up. Read from `applyView`. */
  const places = new Map<string, Map<Scalar, number>>();
  const placeOf = (columnId: string, cell: Scalar): number => {
    let known = places.get(columnId);
    if (!known) {
      known = new Map<Scalar, number>();
      for (const at of keptBy({ ...base, sorts: [{ columnId, direction: "asc" }] })) {
        const value = cellAt(at, columnId);
        if (!known.has(value)) known.set(value, known.size);
      }
      places.set(columnId, known);
    }
    return known.get(cell) as number;
  };
  /** The day a date or date-and-time cell names, as written. */
  const dayOf = (cell: Scalar): string => String(cell).slice(0, 10);
  /** Whether two days are within two days of each other. */
  const near = (a: string, b: string): boolean => [-2, -1, 0, 1, 2].some((days) => addDays(a, days) === b);
  /**
   * Which of two cells of a date-and-time column comes first going up, when one is a clock time with no offset and the
   * days they name are more than two apart: below zero for the first, above for the second, zero when it can't be said.
   * A right Data Query may order such a clock time as text or by the instant it names, and the two are never a day apart.
   */
  const farApart = (columnId: string, a: Scalar, b: Scalar): number => {
    if (!mixed.has(columnId) || isEmpty(a) || isEmpty(b) || near(dayOf(a), dayOf(b))) return 0;
    return dayOf(a) < dayOf(b) ? -1 : 1;
  };
  /**
   * Which of two rows a sort puts first, and the column that decides it: below zero for the first row, above for the
   * second. The rows are compared by their leading sort columns that hold a value with a checked place, up to the first
   * one where either row has none. `undefined` when those columns don't tell them apart: the rows tie, or a cell with no
   * checked place comes first. Where such rows go is the Host's own. With `clocks`, a clock time with no offset counts
   * against a cell more than two days from it, which is enough to say which rows a count keeps.
   */
  const decides = (sorts: readonly SortSpec[], a: number, b: number, clocks = false): { by: number; columnId: string } | undefined => {
    for (const { columnId, direction } of sorts) {
      const [x, y] = [cellAt(a, columnId), cellAt(b, columnId)];
      const turn = direction === "desc" ? -1 : 1;
      if (placed(columnId, x) && placed(columnId, y)) {
        const by = placeOf(columnId, x) - placeOf(columnId, y);
        if (by !== 0) return { by: by * turn, columnId };
        continue;
      }
      const by = clocks ? farApart(columnId, x, y) : 0;
      return by === 0 ? undefined : { by: by * turn, columnId };
    }
    return undefined;
  };

  const cases: QueryCheckCase[] = [];
  const add = (name: string, state: ViewState): number[] => {
    const kept = keptBy(state);
    const { sorts, limit } = state;
    const sortIds = sorts.map((s) => s.columnId);
    const key = (at: number) => sortIds.map((columnId) => cellAt(at, columnId));
    /** Whether a row holds a value with a checked place in every sorted column. */
    const whole = rows.map((_, at) => sortIds.every((columnId) => placed(columnId, cellAt(at, columnId))));
    const idAt = (at: number) => String((rows[at] as Row)[id]);
    // Every row the view may show, in core's order. A count of all the rows leaves out only the rows a count never
    // keeps: those with no value in the first sorted column.
    const eligible = limit === undefined ? kept : keptBy({ ...state, limit: total });
    const coreOrder = new Map(eligible.map((at, i) => [at, i]));
    // The rows a right Data Query must return, and the rows it may. They are the same rows, the ones core keeps, but
    // where a count cuts between rows the sorts don't tell apart: rows that tie, or a row with no value in a later
    // sorted column beside the rows that share its first. There a right Data Query keeps every row ahead of the cut,
    // none behind it, and any of the rows at the cut to make the count.
    let must: ReadonlySet<number> = new Set(kept);
    let may = must;
    if (eligible.length > kept.length) {
      const ahead = eligible.map(() => 0);
      const behind = eligible.map(() => 0);
      eligible.forEach((a, i) => {
        for (let j = i + 1; j < eligible.length; j++) {
          const by = decides(sorts, a, eligible[j] as number, true)?.by ?? 0;
          if (by === 0) continue;
          const [first, second] = by < 0 ? [i, j] : [j, i];
          behind[first] = (behind[first] as number) + 1;
          ahead[second] = (ahead[second] as number) + 1;
        }
      });
      // A row is in every choice of the first rows when too few rows could come before it to fill the count without
      // it, and in none when the rows that must come before it fill the count already.
      must = new Set(eligible.filter((_, i) => eligible.length - (behind[i] as number) - 1 < kept.length));
      may = new Set(eligible.filter((_, i) => (ahead[i] as number) < kept.length));
    }
    const compare: QueryCheckCase["compare"] = (ids) => {
      if (!Array.isArray(ids) || ids.some((value) => typeof value !== "string" && typeof value !== "number")) {
        return fail(
          "INPUT_CONFIG",
          "compare takes the ids your Data Query returned, as a list of text or numbers, in the order it returned them.",
        );
      }
      // The ids as a set: each once, in the order it first came.
      const given = [...new Set(ids.map(String))];
      const got = given.flatMap((text) => position.get(text) ?? []);
      const found = new Set(got);
      // Where a count cuts, every row the sorts put ahead of a row that came back must come back too. With two sorts,
      // rows that tie on the first may be kept by the second, and some of them may sit anywhere among the others.
      const cutAhead =
        eligible.length > kept.length
          ? eligible.filter((at) => !found.has(at) && got.some((back) => may.has(back) && (decides(sorts, at, back, true)?.by ?? 0) < 0))
          : [];
      const missing = [...new Set([...must, ...cutAhead])]
        .filter((at) => !found.has(at))
        .map(idAt)
        .sort(byId);
      const extra = [
        ...got
          .filter((at) => !may.has(at))
          .map(idAt)
          .sort(byId),
        ...given.filter((text) => !position.has(text)),
      ];
      const problems = [
        ...(missing.length > 0 ? [rowWords(missing.length, "missing", missing)] : []),
        ...(extra.length > 0 ? [rowWords(extra.length, "extra", extra)] : []),
      ];
      // A count keeps exactly its number of rows, whichever of the rows at its cut it takes. Where the rows that came
      // back are the wrong number, the message says so, after any missing and extra rows. With every row ahead of a
      // kept row there and none from behind the cut, the number is all that is left to check.
      if (limit !== undefined && got.length !== kept.length) {
        const fewer = kept.length < limit ? `, and only ${kept.length} ${kept.length === 1 ? "row" : "rows"} can fill it` : "";
        problems.push(`${got.length} ${got.length === 1 ? "row" : "rows"} came back, and the count asks for ${limit}${fewer}`);
      }
      if (problems.length === 0 && sortIds.length > 0) {
        // The order, first for the rows that hold a value with a checked place in every sorted column. Rows that tie
        // hold the same cells, so comparing the cells place by place lets them come in either order.
        const complete = got.filter((at) => whole[at]);
        const want = [...complete].sort((a, b) => (coreOrder.get(a) as number) - (coreOrder.get(b) as number));
        const at = want.findIndex((expectedAt, i) => key(expectedAt).some((cell, n) => cell !== key(complete[i] as number)[n]));
        if (at >= 0) problems.push(`wrong order: id ${idAt(complete[at] as number)} came where id ${idAt(want[at] as number)} belongs`);
        // Then each other row, by its leading sorted columns that hold a value: it comes after every row those columns
        // put ahead of it, and before every row they put behind it.
        for (let i = 0; i < got.length && problems.length === 0; i++) {
          for (let j = i + 1; j < got.length; j++) {
            const [early, late] = [got[i] as number, got[j] as number];
            if (whole[early] && whole[late]) continue;
            const decided = decides(sorts, early, late);
            if (decided === undefined || decided.by < 0) continue;
            problems.push(
              `wrong order: id ${idAt(early)} came before id ${idAt(late)}, which belongs ahead of it by ${label(decided.columnId)}`,
            );
            break;
          }
        }
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

  /**
   * The filters that hold a filter on a hidden column, by their shape: alone, in an or group, in an or group inside an
   * and, and in an and group inside an or. One for each column, so a sort or a count beside them can take the first
   * that keeps the rows it needs.
   */
  const hiddenShapes = new Map<string, Shape[]>();
  const hiddenShape = (shape: string, filters: FilterGroup, keeps: boolean[], words: string, columnId: string) =>
    hiddenShapes.set(shape, [...(hiddenShapes.get(shape) ?? []), { filters, keeps, words, hidden: [columnId] }]);

  // A filter on a column the view hides: hiding a column changes what shows, never which rows.
  for (const column of usable) {
    const [s] = byEvenness(singles.filter((x) => x.columnId === column.id));
    if (!s) continue;
    const filters = group("and", [s.predicate]);
    add(`a filter on a hidden column still holds (${s.words}, with ${column.label} hidden)`, {
      ...base,
      visibleColumnIds: base.visibleColumnIds.filter((columnId) => columnId !== column.id),
      filters,
    });
    hiddenShape("alone", filters, s.keeps, s.words, column.id);
  }
  // And inside an or group, beside a filter on a column that shows. The filter on the hidden column keeps rows the other
  // doesn't, so a Data Query that drops it there, as one that builds its "or" in another place may, loses them.
  for (const column of usable) {
    const [s] = byEvenness(singles.filter((x) => x.columnId === column.id));
    if (!s) continue;
    const partner = byEvenness(splitters.filter((p) => p.columnId !== column.id)).find((p) => {
      const kept = either(p.keeps, s.keeps);
      return !same(kept, p.keeps) && sizeOf(kept) < total;
    });
    if (!partner) continue;
    const filters = group("or", [named(partner, "f1"), named(s, "f2")]);
    add(`a filter on a hidden column still holds in an or group (${partner.words} or ${s.words}, with ${column.label} hidden)`, {
      ...base,
      visibleColumnIds: base.visibleColumnIds.filter((columnId) => columnId !== column.id),
      filters,
    });
    hiddenShape("or", filters, either(partner.keeps, s.keeps), `${partner.words} or ${s.words}`, column.id);
  }
  // And inside an or group that is itself inside an and, beside a filter on another column. A Data Query that builds
  // the groups inside the root group in another place may drop the filter there only, and keep rows it leaves out.
  for (const column of usable) {
    const [s] = byEvenness(singles.filter((x) => x.columnId === column.id));
    if (!s) continue;
    const others = byEvenness(splitters.filter((p) => p.columnId !== column.id));
    const found = others
      .flatMap((partner) => others.filter((c) => c !== partner).map((c) => [partner, c] as const))
      .find(([partner, c]) => {
        const kept = both(either(partner.keeps, s.keeps), c.keeps);
        return sizeOf(kept) > 0 && sizeOf(kept) < total && !same(kept, both(partner.keeps, c.keeps));
      });
    if (!found) continue;
    const [partner, c] = found;
    const words = `either ${partner.words} or ${s.words}, and ${c.words}`;
    const filters = group("and", [group("or", [named(partner, "f1"), named(s, "f2")]), named(c, "f3")], "root_f3");
    add(`a filter on a hidden column still holds in an or group inside an and (${words}, with ${column.label} hidden)`, {
      ...base,
      visibleColumnIds: base.visibleColumnIds.filter((columnId) => columnId !== column.id),
      filters,
    });
    hiddenShape("or inside and", filters, both(either(partner.keeps, s.keeps), c.keeps), words, column.id);
  }
  // And inside an and group that is itself inside an or. A Data Query that drops the filter there keeps the rows the
  // and group's other filter keeps.
  for (const column of usable) {
    const [s] = byEvenness(singles.filter((x) => x.columnId === column.id));
    if (!s) continue;
    const others = byEvenness(splitters.filter((p) => p.columnId !== column.id));
    const found = others
      .flatMap((c) => others.filter((partner) => partner !== c).map((partner) => [c, partner] as const))
      .find(([c, partner]) => {
        const kept = either(both(s.keeps, c.keeps), partner.keeps);
        return sizeOf(kept) > 0 && sizeOf(kept) < total && !same(kept, either(c.keeps, partner.keeps)) && !same(kept, partner.keeps);
      });
    if (!found) continue;
    const [c, partner] = found;
    const words = `either ${s.words} and ${c.words}, or ${partner.words}`;
    const filters = group("or", [group("and", [named(s, "f1"), named(c, "f2")]), named(partner, "f3")], "root_f3");
    add(`a filter on a hidden column still holds in an and group inside an or (${words}, with ${column.label} hidden)`, {
      ...base,
      visibleColumnIds: base.visibleColumnIds.filter((columnId) => columnId !== column.id),
      filters,
    });
    hiddenShape("and inside or", filters, either(both(s.keeps, c.keeps), partner.keeps), words, column.id);
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
  /** The or groups the cases above hold, with the rows each keeps, for a sort beside each. */
  const orGroups: Shape[] = [];
  if (or) {
    const [a, b] = or;
    const filters = group("or", [named(a, "f1"), named(b, "f2")]);
    add(`an or group keeps a row that either filter keeps (${a.words} or ${b.words})`, { ...base, filters });
    orGroups.push({ filters, keeps: either(a.keeps, b.keeps), words: `${a.words} or ${b.words}`, hidden: [] });
  }
  // An or group of three filters: each keeps a row the other two don't, and not every row is kept. A Data Query that
  // reads a group of three or more another way than a group of two fails here, and in the sorts and the count beside it.
  // Filters on three columns first, then on two.
  const orOfThree = (() => {
    const columnsOf = (list: readonly Single[]) => new Set(list.map((s) => s.columnId)).size;
    const triples = splitters.flatMap((a, i) =>
      splitters.slice(i + 1).flatMap((b, j) => splitters.slice(i + j + 2).map((c) => [a, b, c] as const)),
    );
    return [...triples]
      .filter((t) => columnsOf(t) >= 2)
      .sort((x, y) => columnsOf(y) - columnsOf(x))
      .find(([a, b, c]) => {
        const all = either(either(a.keeps, b.keeps), c.keeps);
        const without = [either(b.keeps, c.keeps), either(a.keeps, c.keeps), either(a.keeps, b.keeps)];
        return sizeOf(all) < total && without.every((rest) => !same(rest, all));
      });
  })();
  if (orOfThree) {
    const [a, b, c] = orOfThree;
    const filters = group("or", [named(a, "f1"), named(b, "f2"), named(c, "f3")]);
    const words = `${a.words} or ${b.words} or ${c.words}`;
    add(`an or group of three filters keeps a row that any of them keeps (${words})`, { ...base, filters });
    orGroups.push({ filters, keeps: either(either(a.keeps, b.keeps), c.keeps), words, hidden: [] });
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
      const filters = group("and", [group("or", [named(a, "f1"), named(b, "f2")]), named(c, "f3")], "root_f3");
      const words = `either ${a.words} or ${b.words}, and ${c.words}`;
      add(`an or group inside an and keeps its own brackets (${words})`, { ...base, filters });
      orGroups.push({ filters, keeps: both(either(a.keeps, b.keeps), c.keeps), words, hidden: [] });
      break nested;
    }
  }

  // Sorts on two columns, each direction on each. A row with no value in the first sorted column may sit anywhere. A
  // row with a value there and none in the second is held to its place by the first.
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

  // A row with a value in the first sorted column and none in a later one keeps its place by the first. Where it sits
  // among the rows that share that value is the Host's own, so NULLS FIRST and NULLS LAST both pass. A Data Query that
  // puts every row with an empty sort cell after the rest, or before it ("ORDER BY b IS NULL, a, b"), moves the row past
  // rows with another first value, and fails. Both columns are sorted the same way, each way.
  const later = first && sortable.find((c) => c !== first && cellsIn(c).some((value, i) => isEmpty(value) && !isEmpty(cellsIn(first)[i])));
  if (first && later) {
    for (const direction of ["asc", "desc"] as const) {
      const sorts: SortSpec[] = [
        { columnId: first.id, direction },
        { columnId: later.id, direction },
      ];
      add(`a row with no value in a later sorted column keeps its place by the columns before it (${sortWords(sorts, label)})`, {
        ...base,
        sorts,
      });
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

  // An enum, and text, as the second of two sorts: it orders the rows that tie on the first. The first is a number,
  // date or yes/no column, whose values every database orders alike and many rows share. A Data Query that sorts such a
  // column only when it comes first, or sorts an enum in the order its values are declared, fails. Text of other
  // characters has no checked place in the second column either: its row is held to its place by the first.
  // Each way: a Data Query that sorts the second column one way whatever the View State says fails one of the two.
  const [anEnum] = sortableEnums;
  const text = sortableText.find((c) => (orderable.get(c.id)?.size ?? 0) >= 2);
  if (first) {
    if (anEnum) {
      for (const direction of ["asc", "desc"] as const) {
        const sorts: SortSpec[] = [
          { columnId: first.id, direction: "desc" },
          { columnId: anEnum.id, direction },
        ];
        add(`a second sort on an enum orders the rows that tie on the first, by its values' IDs (${sortWords(sorts, label)})`, {
          ...base,
          sorts,
        });
      }
    }
    if (text) {
      for (const direction of ["desc", "asc"] as const) {
        const sorts: SortSpec[] = [
          { columnId: first.id, direction: "asc" },
          { columnId: text.id, direction },
        ];
        add(`a second sort on text orders the rows that tie on the first, by its letters (${sortWords(sorts, label)})`, { ...base, sorts });
      }
    }
  }

  // A sort beside a filter, with no count: a Data Query that builds its filters in one place and its sorts in another
  // may lose the sorts when a filter is set, or some of them, or their direction. For each column a case sorts by, each
  // way, and once with that column hidden. The filter is on another column where there is one, and keeps rows of two
  // or more values the sort tells apart.
  /** Whether the rows a filter keeps hold two or more values of the column, each with a checked place, and not every row. */
  const toldBy = (column: ColumnDescriptor) => (keeps: boolean[]) =>
    new Set(cellsIn(column).filter((cell, i) => keeps[i] && placed(column.id, cell))).size >= 2 && sizeOf(keeps) < total;
  for (const column of [...sortable, ...collated]) {
    const told = toldBy(column);
    const beside = [...splitters.filter((s) => s.columnId !== column.id), ...splitters.filter((s) => s.columnId === column.id)].find((s) =>
      told(s.keeps),
    );
    if (!beside) continue;
    const filters = group("and", [beside.predicate]);
    for (const direction of ["desc", "asc"] as const) {
      const sorts: SortSpec[] = [{ columnId: column.id, direction }];
      add(`a sort beside a filter still orders the rows (${sortWords(sorts, label)}, where ${beside.words})`, { ...base, filters, sorts });
    }
    const sorts: SortSpec[] = [{ columnId: column.id, direction: "desc" }];
    add(
      `a sort on a hidden column beside a filter still orders the rows (${sortWords(sorts, label)}, where ${beside.words}, with ${column.label} hidden)`,
      { ...base, visibleColumnIds: base.visibleColumnIds.filter((columnId) => columnId !== column.id), filters, sorts },
    );
  }
  /**
   * Every sort and count rule below that sits beside an or group sits beside each one the check holds, and beside each
   * shape of a filter on a hidden column: alone, in an or group, in an or group inside an and, and in an and group
   * inside an or. There every sorted column is hidden too. A Data Query may build its sorts or its count another way
   * only where the filters hold an "or", or only where a column is hidden; beside these, each such way fails. Of the
   * hidden shapes, one for each column, a rule takes the first that keeps the rows it needs.
   */
  const besides: Array<{ phrase: string; options: Shape[] }> = [
    ...orGroups.map((shape) => ({ phrase: "beside an or group", options: [shape] })),
    ...[...hiddenShapes.values()].map((options) => ({ phrase: "beside a filter on a hidden column", options })),
  ];
  /** A View State beside a shape, and its words: where it filters, and what it hides. */
  const besideCase = (shape: Shape, sorts: SortSpec[], limit?: number): { state: ViewState; where: string } => {
    const hide = shape.hidden.length === 0 ? [] : [...new Set([...shape.hidden, ...sorts.map((s) => s.columnId)])];
    const hiding = hide.length === 0 ? "" : `, with ${listWords(hide.map(label))} hidden`;
    return {
      state: {
        ...base,
        visibleColumnIds: base.visibleColumnIds.filter((columnId) => !hide.includes(columnId)),
        filters: shape.filters,
        sorts,
        ...(limit === undefined ? {} : { limit }),
      },
      where: `, where ${shape.words}${hiding}`,
    };
  };
  // And beside each or group, each way: a Data Query that builds an "or" in another place may lose the sorts there.
  const [sortedAlone] = [...sortable, ...collated];
  if (sortedAlone) {
    const told = toldBy(sortedAlone);
    for (const { phrase, options } of besides) {
      const shape = options.find((option) => told(option.keeps));
      if (!shape) continue;
      for (const direction of ["desc", "asc"] as const) {
        const sorts: SortSpec[] = [{ columnId: sortedAlone.id, direction }];
        const { state, where } = besideCase(shape, sorts);
        add(`a sort ${phrase} still orders the rows (${sortWords(sorts, label)}${where})`, state);
      }
    }
  }
  /** Whether two rows a filter keeps tie on the first column and hold different values in the second, each with a checked place. */
  const ordersTies = (lead: ColumnDescriptor, then: ColumnDescriptor) => (keeps: boolean[]) => {
    const kept = rows.flatMap((_, at) =>
      keeps[at] && placed(lead.id, cellAt(at, lead.id)) && placed(then.id, cellAt(at, then.id)) ? [at] : [],
    );
    return kept.some((a) => kept.some((b) => cellAt(a, lead.id) === cellAt(b, lead.id) && cellAt(a, then.id) !== cellAt(b, then.id)));
  };
  // Two sorts beside each or group, the second each way: it orders the rows the group keeps that tie on the first. A
  // Data Query that keeps only the first sort where the filters hold an "or", or only the last, or turns the second
  // round, fails. Both are number, date or yes/no columns.
  if (first && second) {
    for (const { phrase, options } of besides) {
      const shape = options.find((option) => ordersTies(first, second)(option.keeps));
      if (!shape) continue;
      for (const direction of ["asc", "desc"] as const) {
        const sorts: SortSpec[] = [
          { columnId: first.id, direction: "desc" },
          { columnId: second.id, direction },
        ];
        const { state, where } = besideCase(shape, sorts);
        add(`two sorts ${phrase} order the rows by each in turn (${sortWords(sorts, label)}${where})`, state);
      }
    }
  }
  // Two sorts beside a filter joined with "and", the second each way, for a second column of each sort: a number, date
  // or yes/no column, an enum, and text. A Data Query that keeps only the first sort when a filter is set fails.
  if (first) {
    for (const then of [second, anEnum, text]) {
      if (!then) continue;
      const ties = ordersTies(first, then);
      const beside = [
        ...splitters.filter((s) => s.columnId !== first.id && s.columnId !== then.id),
        ...splitters.filter((s) => s.columnId === first.id || s.columnId === then.id),
      ].find((s) => ties(s.keeps) && s.size < total);
      if (!beside) continue;
      for (const direction of ["asc", "desc"] as const) {
        const sorts: SortSpec[] = [
          { columnId: first.id, direction: "desc" },
          { columnId: then.id, direction },
        ];
        add(`two sorts beside a filter order the rows by each in turn (${sortWords(sorts, label)}, where ${beside.words})`, {
          ...base,
          filters: group("and", [beside.predicate]),
          sorts,
        });
      }
    }
  }

  // Numbers sort by their value, each way: as text, "10" comes before "9".
  for (const column of sortable.filter((c) => isNumeric(c.kind))) {
    for (const direction of ["asc", "desc"] as const) {
      const sorts: SortSpec[] = [{ columnId: column.id, direction }];
      add(`numbers sort by their value, not as text (${sortWords(sorts, label)})`, { ...base, sorts });
    }
  }

  // A sort with long runs of rows that tie, for a Host that reads each case in pages too, as the guide says. Rows that tie
  // may come in any order, but in one order: a Data Query that breaks ties another way on each page ("ORDER BY …,
  // random()") repeats some rows and loses others. The column is the one with the longest run.
  const longestRun = (column: ColumnDescriptor): number => {
    const inOrder = keptBy({ ...base, sorts: [{ columnId: column.id, direction: "asc" }] }).map((at) => cellAt(at, column.id));
    let [best, now] = [0, 0];
    inOrder.forEach((cell, i) => {
      now = i > 0 && inOrder[i - 1] === cell && placed(column.id, cell) ? now + 1 : 1;
      best = Math.max(best, now);
    });
    return best;
  };
  const runLengths = new Map(sortable.map((column) => [column, longestRun(column)]));
  const [paged] = [...sortable].sort((a, b) => (runLengths.get(b) as number) - (runLengths.get(a) as number));
  if (paged && (runLengths.get(paged) as number) > 7) {
    const sorts: SortSpec[] = [{ columnId: paged.id, direction: "desc" }];
    add(`a paged read is the whole result cut in pieces: rows that tie keep one order from page to page (${sortWords(sorts, label)})`, {
      ...base,
      sorts,
    });
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
  // And a second sort on a column the view hides: it still orders the rows that tie on the first. A Data Query that
  // keeps only the sorts whose columns show, after the first, fails.
  const hiddenSecond = second ?? collated.find((c) => (orderable.get(c.id)?.size ?? 0) >= 2);
  if (first && hiddenSecond) {
    const sorts: SortSpec[] = [
      { columnId: first.id, direction: "desc" },
      { columnId: hiddenSecond.id, direction: "asc" },
    ];
    add(`a second sort on a hidden column still orders the rows (${sortWords(sorts, label)}, with ${hiddenSecond.label} hidden)`, {
      ...base,
      visibleColumnIds: base.visibleColumnIds.filter((columnId) => columnId !== hiddenSecond.id),
      sorts,
    });
  }

  /** The counts a case tries, in turn: a few rows first, then any number. */
  const countsFor = (inOrder: readonly number[]): number[] => [
    5,
    6,
    7,
    8,
    9,
    10,
    4,
    3,
    2,
    ...inOrder.map((_, n) => n).filter((n) => n > 10),
  ];
  /**
   * Where a count may cut rows in this order, sorted by `column` first: between two different values of it, each with a
   * checked place. A clock time with no offset may sort elsewhere in a right Data Query, but never more than a day from
   * where core puts it, so the cut stays two days clear of every such cell among the rows.
   */
  const cutsIn = (column: ColumnDescriptor, inOrder: readonly number[], candidates: readonly number[]): number[] => {
    const cell = (at: number) => cellAt(at, column.id);
    const clocks = inOrder.filter((at) => isClock(column.id, cell(at)));
    const clear = (at: number) => clocks.every((clock) => !near(dayOf(cell(clock)), dayOf(cell(at))));
    return candidates.filter((n) => {
      if (n < 1 || n >= inOrder.length) return false;
      const [before, after] = [inOrder[n - 1] as number, inOrder[n] as number];
      return (
        cell(before) !== cell(after) && placed(column.id, cell(before)) && placed(column.id, cell(after)) && clear(before) && clear(after)
      );
    });
  };

  /** For each list of sorts and filters, the rows a count of every row keeps, in core's order, and its runs of tied rows. */
  const tiedRuns = new Map<string, { inOrder: number[]; runs: number[][] }>();
  const runsOf = (prefix: readonly SortSpec[], filters: FilterGroup | null) => {
    const key = JSON.stringify([prefix, filters]);
    const known = tiedRuns.get(key);
    if (known) return known;
    const inOrder = keptBy({ ...base, filters, sorts: [...prefix], limit: total });
    // Rows next to each other that hold the same value, with a checked place, in every column of `prefix`.
    const runs: number[][] = [];
    for (const at of inOrder) {
      const run = runs.at(-1);
      const head = run?.[0];
      const tiesHead =
        head !== undefined &&
        prefix.every(({ columnId }) => placed(columnId, cellAt(at, columnId)) && cellAt(at, columnId) === cellAt(head, columnId));
      if (run && tiesHead) run.push(at);
      else runs.push([at]);
    }
    const found = { inOrder, runs: runs.filter((members) => members.length >= 2) };
    tiedRuns.set(key, found);
    return found;
  };
  /**
   * Where a count may cut inside a run of rows that tie on every column of `prefix`, so that a sort by `then` after them
   * decides which of the run it keeps: some row the count must keep with `then` going one way, it must leave out going
   * the other. A Data Query that cuts by `prefix` alone keeps the same rows both ways, so it fails one of the pair,
   * whichever rows it takes. Rows the prefix doesn't tell from the run (ruling R3) count as rows that may come before
   * any row of it. Runs with rows ahead of them and behind first, then cuts near a run's middle.
   */
  const pairCut = (prefix: readonly SortSpec[], then: ColumnDescriptor, filters: FilterGroup | null = null): number | undefined => {
    const { inOrder, runs } = runsOf(prefix, filters);
    const inside = (members: number[]) => members[0] !== inOrder[0] && members.at(-1) !== inOrder.at(-1);
    for (const members of [...runs].sort((a, b) => Number(inside(b)) - Number(inside(a)))) {
      const head = members[0] as number;
      const run = new Set(members);
      let [ahead, loose] = [0, 0];
      for (const at of inOrder) {
        if (run.has(at)) continue;
        const by = decides(prefix, at, head, true)?.by;
        if (by === undefined) loose += 1;
        else if (by < 0) ahead += 1;
      }
      const values = members.filter((at) => placed(then.id, cellAt(at, then.id))).map((at) => placeOf(then.id, cellAt(at, then.id)));
      if (new Set(values).size < 2) continue;
      const n = members.length;
      const middle = Math.ceil(n / 2);
      const places = Array.from({ length: n - 1 }, (_, k) => k + 1).sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
      // Going up, a row of the run is kept for certain when fewer than `p` other rows may come before it, and never
      // when `p` rows must: the rows above its value. Going down, the rows below it.
      const tells = (p: number) =>
        values.some((v) => {
          const [below, above] = [values.filter((w) => w < v).length, values.filter((w) => w > v).length];
          return (above >= p && n + loose - 1 - above < p) || (below >= p && n + loose - 1 - below < p);
        });
      const p = places.find(tells);
      if (p !== undefined) return ahead + p;
    }
    return undefined;
  };
  /**
   * A filter that keeps only the values of a text or enum column whose order is checked, where the column allows it.
   * It leaves out a value that another cell of the column matches once accents and letter case are taken out, so a
   * Data Query whose collation folds accents keeps the same rows, and fails only the cases about accents.
   */
  const onlyOrdered = (column: ColumnDescriptor): FilterPredicate | undefined => {
    const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const cells = [...new Set(cellsIn(column))].filter((cell): cell is string => typeof cell === "string");
    const values = [...(orderable.get(column.id) ?? [])]
      .map(String)
      .filter((value) => !cells.some((other) => other !== value && fold(other) === fold(value)))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    if (values.length < 2) return undefined;
    const predicate: FilterPredicate = { id: "f1", type: "predicate", columnId: column.id, operator: "in", value: values };
    return filterIssues(predicate, view).length === 0 ? predicate : undefined;
  };

  // A count (ADR 0027): the first rows of the sorted, filtered rows, and never a row with no value in the first sorted
  // column. In these the cut falls between two different values of the first sorted column, so neither rows that tie
  // nor where an empty cell sorts can change which rows a right Data Query keeps.
  if (counts && first) {
    const sorts: SortSpec[] = [{ columnId: first.id, direction: "desc" }];
    // A cut made before the filter must keep other rows, or the case would pass a Data Query that cuts first. Such a
    // Data Query may take any of the rows that tie at its own cut, so the case looks for a row the filter leaves out
    // that sorts ahead of them: it is among the first rows whichever tied rows are taken, and the filter then drops it.
    // Failing that, a cut where the rows core itself would take first are other rows.
    const unfiltered = keptBy({ ...base, sorts, limit: total });
    const cutFirstKeepsOthers = (filter: Single, n: number): boolean =>
      unfiltered.slice(0, n).some((at) => !filter.keeps[at] && (decides(sorts, at, unfiltered[n - 1] as number, true)?.by ?? 0) < 0);
    const coreCutFirstKeepsOthers = (filter: Single, n: number): boolean =>
      unfiltered.slice(0, n).filter((at) => filter.keeps[at]).length !== n;
    const firstRows = (differs: (filter: Single, n: number) => boolean): { filter: Single; limit: number } | undefined => {
      for (const filter of splitters.filter((s) => s.columnId !== first.id)) {
        const inOrder = keptBy({ ...base, filters: group("and", [filter.predicate]), sorts, limit: total });
        const candidates = countsFor(inOrder);
        const limit = cutsIn(first, inOrder, candidates).find((n) => differs(filter, n));
        if (limit !== undefined) return { filter, limit };
      }
      return undefined;
    };
    const cutAfterFilter = firstRows(cutFirstKeepsOthers) ?? firstRows(coreCutFirstKeepsOthers);
    if (cutAfterFilter) {
      const { filter, limit } = cutAfterFilter;
      add(
        `a count keeps the first rows of the sorted, filtered rows (the first ${limit} rows, ${sortWords(sorts, label)}, where ${filter.words})`,
        {
          ...base,
          filters: group("and", [filter.predicate]),
          sorts,
          limit,
        },
      );
    }
    // A row with a value in the first sorted column and none in a later one keeps its place by the first: the count
    // keeps it when that place is before the cut. Sorted by two columns, with such a row before the cut and a row that
    // holds both values after it, a Data Query that puts every row with an empty sort cell last and then cuts ("ORDER
    // BY b IS NULL, a, b") leaves the row out. The cut falls between two values of the first column, so where an empty
    // cell sorts among rows that tie can't change which rows a right Data Query keeps. Where it can, the cut also
    // leaves such a row ahead of a kept row with another first value, so a Data Query that cuts in the right place and
    // then moves the rows with an empty sort cell to the end fails on their order.
    if (later) {
      const twoSorts: SortSpec[] = [
        { columnId: first.id, direction: "desc" },
        { columnId: later.id, direction: "asc" },
      ];
      const inOrder = keptBy({ ...base, sorts: twoSorts, limit: total });
      const holeAt = (at: number) => isEmpty(cellAt(at, later.id));
      const candidates = countsFor(inOrder);
      const cuts = cutsIn(first, inOrder, candidates).filter(
        (n) => inOrder.slice(0, n).some(holeAt) && inOrder.slice(n).some((at) => !holeAt(at)),
      );
      const showsOrder = (n: number) => {
        const before = inOrder.slice(0, n);
        return before.some((hole) => holeAt(hole) && before.some((at) => !holeAt(at) && (decides(twoSorts, hole, at)?.by ?? 0) < 0));
      };
      const limit = cuts.find(showsOrder) ?? cuts[0];
      if (limit !== undefined) {
        add(`a count keeps a row with no value in a later sorted column (the first ${limit} rows, ${sortWords(twoSorts, label)})`, {
          ...base,
          sorts: twoSorts,
          limit,
        });
      }
    }
    // The same for each other column a case sorts by that holds empty cells: number, date and yes/no columns, and text
    // and enum columns, where empty text is an empty cell too. The cut falls between two values of the first column,
    // with rows that hold an empty cell in the second ahead of it (on text, a null and an empty text where the first
    // rows hold both) and a row that holds a value there behind it. A Data Query whose count leaves out such rows, by
    // a guard on more than the first column or by reading empty text as no value, takes rows from behind the cut.
    for (const then of [...sortable, ...collated]) {
      if (then === first || then === later || !cellsIn(then).some(isEmpty)) continue;
      const holeAt = (at: number) => isEmpty(cellAt(at, then.id));
      const wanted = cellsIn(then).includes("") ? 2 : 1;
      /** The cuts in one direction of the first column, and how many kinds of empty cell each leaves ahead of it. */
      const cutsFor = (direction: "asc" | "desc") => {
        const twoSorts: SortSpec[] = [
          { columnId: first.id, direction },
          { columnId: then.id, direction: "asc" },
        ];
        const inOrder = keptBy({ ...base, sorts: twoSorts, limit: total });
        const kindsAhead = (n: number) =>
          new Set(
            inOrder
              .slice(0, n)
              .filter(holeAt)
              .map((at) => cellAt(at, then.id) === ""),
          ).size;
        const candidates = countsFor(inOrder);
        return cutsIn(first, inOrder, candidates)
          .filter((n) => inOrder.slice(n).some((at) => !holeAt(at)) && kindsAhead(n) > 0)
          .map((limit) => ({ twoSorts, limit, kinds: kindsAhead(limit) }));
      };
      const cuts = [...cutsFor("desc"), ...cutsFor("asc")];
      const cut = cuts.find((c) => c.kinds >= wanted) ?? cuts[0];
      if (!cut) continue;
      const { twoSorts, limit } = cut;
      add(`a count keeps a row with an empty cell in a later sorted column (the first ${limit} rows, ${sortWords(twoSorts, label)})`, {
        ...base,
        sorts: twoSorts,
        limit,
      });
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
  // A count that cuts inside a run of rows that tie on the sorted column, for each number, date and yes/no column, each
  // way. A database has no load order, so which of the tied rows fill the last places is the Host's own: by its own key,
  // either way, or as the rows were stored. It must keep every row ahead of the tied value, none behind it, and the
  // count's number of rows in all. A Data Query that keeps every tied row (RANK, WITH TIES), drops the tied run, or
  // fills a place from behind it fails. The run is one with rows ahead of it and behind it where the column has one.
  if (counts) {
    for (const column of sortable) {
      for (const direction of ["desc", "asc"] as const) {
        const sorts: SortSpec[] = [{ columnId: column.id, direction }];
        const inOrder = keptBy({ ...base, sorts, limit: total });
        const cell = (n: number) => cellAt(inOrder[n] as number, column.id);
        const clocks = inOrder.map((at) => cellAt(at, column.id)).filter((value) => isClock(column.id, value));
        const runs: Array<{ start: number; end: number }> = [];
        inOrder.forEach((_, n) => {
          const run = runs.at(-1);
          if (run && cell(run.start) === cell(n)) run.end = n + 1;
          else runs.push({ start: n, end: n + 1 });
        });
        // Rows that hold the same value, which has a checked place, more than two days from every clock time with no
        // offset: such a time may sort up to a day from where core puts it.
        const tied = runs.filter(
          (run) =>
            run.end - run.start >= 2 &&
            placed(column.id, cell(run.start)) &&
            clocks.every((clock) => !near(dayOf(clock), dayOf(cell(run.start)))),
        );
        const run = tied.find((r) => r.start > 0 && r.end < inOrder.length) ?? tied.find((r) => r.start > 0) ?? tied[0];
        if (!run) continue;
        const limit = run.start + Math.ceil((run.end - run.start) / 2);
        add(
          `a count that cuts inside tied rows keeps its number of rows: every row ahead of the tie, none behind it, and any of the tied (the first ${limit} rows, ${sortWords(sorts, label)})`,
          { ...base, sorts, limit },
        );
      }
    }
  }
  // The same beside a filter, for each number, date and yes/no column: a Data Query that builds its count another way
  // where the filters are set (RANK or WITH TIES there) fails. The filter is on another column. The run of tied rows it
  // leaves has rows ahead of it and behind it where the column has one, else rows ahead of it.
  /**
   * Where a count sorted by `column`, descending, beside `filters`, cuts inside a run of rows that tie on it: the middle
   * of the first run with rows ahead of it, and with `inside` rows behind it too. The run's value has a checked place
   * and is more than two days from every clock time with no offset among the rows.
   */
  const tiedCut = (column: ColumnDescriptor, filters: FilterGroup | null, inside: boolean): number | undefined => {
    const { inOrder, runs } = runsOf([{ columnId: column.id, direction: "desc" }], filters);
    const clocks = inOrder.map((at) => cellAt(at, column.id)).filter((value) => isClock(column.id, value));
    const run = runs.find(
      (members) =>
        members[0] !== inOrder[0] &&
        (!inside || members.at(-1) !== inOrder.at(-1)) &&
        clocks.every((clock) => !near(dayOf(clock), dayOf(cellAt(members[0] as number, column.id)))),
    );
    return run && inOrder.indexOf(run[0] as number) + Math.ceil(run.length / 2);
  };
  if (counts) {
    for (const column of sortable) {
      const sorts: SortSpec[] = [{ columnId: column.id, direction: "desc" }];
      const runFor = (filter: Single, inside: boolean) => {
        const filters = group("and", [filter.predicate]);
        const limit = tiedCut(column, filters, inside);
        return limit === undefined ? undefined : { filter, filters, limit };
      };
      const filters = splitters.filter((s) => s.columnId !== column.id && s.size < total);
      let cut: ReturnType<typeof runFor>;
      for (const inside of [true, false]) {
        for (const filter of filters) {
          cut = runFor(filter, inside);
          if (cut) break;
        }
        if (cut) break;
      }
      if (!cut) continue;
      const { filter, filters: beside, limit } = cut;
      add(
        `a count that cuts inside tied rows beside a filter keeps its number of rows (the first ${limit} rows, ${sortWords(sorts, label)}, where ${filter.words})`,
        { ...base, filters: beside, sorts, limit },
      );
    }
  }
  // A count with two sorts that cuts inside a run of rows that tie on the first: the second decides which of them it
  // keeps. One pair for each number, date and yes/no column, the second sorted each way at the same cut. A Data Query
  // that cuts by the first sort alone and only then sorts by both keeps the same tied rows both ways, so it fails at
  // least one of the pair, whichever order it gives rows that tie on the first. Where the run holds rows with no value
  // in the second, those are the Host's to place (ruling R3): the cut takes more of the run than there are such rows,
  // and fewer than the rest, and falls between two values of the second wherever a right Data Query puts them.
  let hiddenSecondCount = false;
  if (counts) {
    for (const lead of sortable) {
      const leadOrder = keptBy({ ...base, sorts: [{ columnId: lead.id, direction: "desc" }], limit: total });
      const leadCell = (n: number) => cellAt(leadOrder[n] as number, lead.id);
      const clocks = leadOrder.map((at) => cellAt(at, lead.id)).filter((value) => isClock(lead.id, value));
      const runs: Array<{ start: number; end: number }> = [];
      leadOrder.forEach((_, n) => {
        const run = runs.at(-1);
        if (run && leadCell(run.start) === leadCell(n)) run.end = n + 1;
        else runs.push({ start: n, end: n + 1 });
      });
      const tied = runs
        .filter(
          (run) =>
            run.end - run.start >= 3 &&
            placed(lead.id, leadCell(run.start)) &&
            clocks.every((clock) => !near(dayOf(clock), dayOf(leadCell(run.start)))),
        )
        // Runs with rows ahead and behind first.
        .sort((a, b) => Number(b.start > 0 && b.end < leadOrder.length) - Number(a.start > 0 && a.end < leadOrder.length));
      /** A run, the column that orders it, and how many of its rows the count keeps. */
      const pick = (): { then: ColumnDescriptor; start: number; places: number } | undefined => {
        // Runs with no row that lacks a value in the second first: there the rows kept are one fixed set. Then cuts
        // that fall between two values of the second wherever a right Data Query puts such rows, then where it puts
        // them at either end of the run, then anywhere inside it.
        for (const [loose, sides] of [
          [false, 4],
          [true, 4],
          [true, 2],
          [true, 0],
        ] as const) {
          for (const then of sortable.filter((c) => c !== lead)) {
            for (const run of tied) {
              const members = leadOrder.slice(run.start, run.end);
              const cells = members.map((at) => cellAt(at, then.id));
              // A cell with no checked place that is no empty cell may sort anywhere in a right Data Query.
              if (cells.some((cell) => !isEmpty(cell) && !placed(then.id, cell))) continue;
              const free = cells.filter(isEmpty).length;
              if (free > 0 && !loose) continue;
              const values = cells
                .filter((cell) => !isEmpty(cell))
                .map((cell) => placeOf(then.id, cell))
                .sort((a, b) => a - b);
              const n = values.length;
              // A cut between the k-th and the next of the run's values going up has a different value on each side.
              const clean = (k: number) => k >= 1 && k < n && values[k - 1] !== values[k];
              const middle = Math.ceil(n / 2);
              const options = Array.from({ length: n }, (_, k) => k)
                .filter((places) => places > free && places < n)
                .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
              // Going up and going down, with the rows with no value in the second all ahead of the cut or all behind.
              if (new Set(values).size < 2) continue;
              const places = options.find(
                (p) => sides === 0 || (clean(p) && clean(n - p) && (sides === 2 || (clean(p - free) && clean(n - p + free)))),
              );
              if (places !== undefined) return { then, start: run.start, places };
            }
          }
        }
        return undefined;
      };
      const picked = pick();
      if (!picked) continue;
      const { then, start, places } = picked;
      for (const direction of ["asc", "desc"] as const) {
        const sorts: SortSpec[] = [
          { columnId: lead.id, direction: "desc" },
          { columnId: then.id, direction },
        ];
        const limit = start + places;
        add(
          `a count that cuts inside rows that tie on the first sorted column keeps the ones the next sorted column puts first (the first ${limit} rows, ${sortWords(sorts, label)})`,
          { ...base, sorts, limit },
        );
      }
      // The first such pair again, with the second column hidden: a Data Query whose count sorts only by the columns
      // that show cuts by the first alone, and fails at least one of the pair.
      if (hiddenSecondCount) continue;
      hiddenSecondCount = true;
      for (const direction of ["asc", "desc"] as const) {
        const sorts: SortSpec[] = [
          { columnId: lead.id, direction: "desc" },
          { columnId: then.id, direction },
        ];
        const limit = start + places;
        add(
          `a count still sorts by a hidden second column (the first ${limit} rows, ${sortWords(sorts, label)}, with ${then.label} hidden)`,
          {
            ...base,
            visibleColumnIds: base.visibleColumnIds.filter((columnId) => columnId !== then.id),
            sorts,
            limit,
          },
        );
      }
    }
  }
  // A count with three sorts that cuts inside a run of rows that tie on the first two: the third decides which of them
  // it keeps. One pair for each number, date and yes/no column that leads such a run, the third sorted each way at the
  // same cut. A Data Query that cuts by the first two sorts alone keeps the same tied rows both ways, so it fails at
  // least one of the pair. The second and third columns hold no clock time with no offset, and every row of the run
  // holds a value in the third. A row with no value in the second that shares the run's first value is the Host's to
  // place (ruling R3): the cut takes more of the run than there are such rows, and falls between two values of the third
  // wherever a right Data Query puts them, where the rows allow it.
  let hiddenThirdCount = false;
  if (counts) {
    const steady = sortable.filter((c) => !mixed.has(c.id));
    for (const lead of sortable) {
      const clocks = cellsIn(lead).filter((cell) => isClock(lead.id, cell));
      /** The second and third columns, and where the count cuts. */
      const pick = (): { mid: ColumnDescriptor; then: ColumnDescriptor; limit: number } | undefined => {
        // Runs with no row that lacks a value in the second first, as for two sorts.
        for (const [loose, sides] of [
          [false, 4],
          [true, 4],
          [true, 2],
          [true, 0],
        ] as const) {
          for (const mid of steady.filter((c) => c !== lead)) {
            const twoSorts: SortSpec[] = [
              { columnId: lead.id, direction: "desc" },
              { columnId: mid.id, direction: "desc" },
            ];
            const inOrder = keptBy({ ...base, sorts: twoSorts, limit: total });
            const runs: number[][] = [];
            for (const at of inOrder) {
              const run = runs.at(-1);
              const head = run?.[0];
              const tiesHead =
                head !== undefined && cellAt(head, lead.id) === cellAt(at, lead.id) && cellAt(head, mid.id) === cellAt(at, mid.id);
              if (run && tiesHead) run.push(at);
              else runs.push([at]);
            }
            for (const members of runs) {
              const head = members[0] as number;
              const [leadValue, midValue] = [cellAt(head, lead.id), cellAt(head, mid.id)];
              if (members.length < 3 || !placed(lead.id, leadValue) || !placed(mid.id, midValue)) continue;
              if (clocks.some((clock) => near(dayOf(clock), dayOf(leadValue)))) continue;
              const free = inOrder.filter((at) => cellAt(at, lead.id) === leadValue && !placed(mid.id, cellAt(at, mid.id))).length;
              if (free > 0 && !loose) continue;
              // The rows the first two sorts put ahead of the run, wherever a right Data Query puts the rows above.
              const ahead = inOrder.filter((at) => (decides(twoSorts, at, head, true)?.by ?? 0) < 0).length;
              for (const then of steady.filter((c) => c !== lead && c !== mid)) {
                const cells = members.map((at) => cellAt(at, then.id));
                if (!cells.every((cell) => placed(then.id, cell))) continue;
                const values = cells.map((cell) => placeOf(then.id, cell)).sort((a, b) => a - b);
                const n = values.length;
                if (new Set(values).size < 2) continue;
                const clean = (k: number) => k >= 1 && k < n && values[k - 1] !== values[k];
                const middle = Math.ceil(n / 2);
                const places = Array.from({ length: n }, (_, k) => k)
                  .filter((p) => p > free && p < n)
                  .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))
                  .find((p) => sides === 0 || (clean(p) && clean(n - p) && (sides === 2 || (clean(p - free) && clean(n - p + free)))));
                if (places !== undefined) return { mid, then, limit: ahead + places };
              }
            }
          }
        }
        return undefined;
      };
      const picked = pick();
      if (!picked) continue;
      const { mid, then, limit } = picked;
      for (const direction of ["asc", "desc"] as const) {
        const sorts: SortSpec[] = [
          { columnId: lead.id, direction: "desc" },
          { columnId: mid.id, direction: "desc" },
          { columnId: then.id, direction },
        ];
        add(
          `a count that cuts inside rows that tie on the first two sorted columns keeps the ones the third puts first (the first ${limit} rows, ${sortWords(sorts, label)})`,
          { ...base, sorts, limit },
        );
      }
      // The first such pair again, with the third column hidden: a Data Query whose count sorts only by the columns
      // that show cuts by the first two alone, and fails at least one of the pair.
      if (hiddenThirdCount) continue;
      hiddenThirdCount = true;
      for (const direction of ["asc", "desc"] as const) {
        const sorts: SortSpec[] = [
          { columnId: lead.id, direction: "desc" },
          { columnId: mid.id, direction: "desc" },
          { columnId: then.id, direction },
        ];
        add(
          `a count still sorts by a hidden third column (the first ${limit} rows, ${sortWords(sorts, label)}, with ${then.label} hidden)`,
          { ...base, visibleColumnIds: base.visibleColumnIds.filter((columnId) => columnId !== then.id), sorts, limit },
        );
      }
    }
  }
  // A count with a text or enum column sorted second that cuts inside a run of rows that tie on the first: its letters,
  // or its values' IDs, decide which of them it keeps. One pair for each text and enum column, sorted each way at the
  // same cut, after the first number, date or yes/no column that has such a run. Beside a filter that keeps only the
  // values whose order is checked, where the column allows one, since the place of other text is the database's own.
  // A Data Query that cuts by the first sort alone keeps the same rows both ways, and fails one of the pair.
  if (counts) {
    for (const then of collated) {
      const only = onlyOrdered(then);
      const filters = only ? group("and", [only]) : null;
      const where = only ? `, where ${filterWords(only, then, zone)}` : "";
      for (const lead of sortable) {
        const prefix: SortSpec[] = [{ columnId: lead.id, direction: "desc" }];
        const limit = pairCut(prefix, then, filters);
        if (limit === undefined) continue;
        const kind = then.kind === "enum" ? "an enum" : "text";
        for (const direction of ["asc", "desc"] as const) {
          const sorts: SortSpec[] = [...prefix, { columnId: then.id, direction }];
          add(
            `a count that cuts inside rows that tie on the first sorted column keeps the ones ${kind} sorted next puts first (the first ${limit} rows, ${sortWords(sorts, label)}${where})`,
            { ...base, filters, sorts, limit },
          );
        }
        break;
      }
    }
  }
  // A count with four sorts that cuts inside a run of rows that tie on the first three: the fourth decides which of them
  // it keeps. One pair for each number, date and yes/no column that leads such a run, the fourth sorted each way at the
  // same cut. A Data Query that cuts by the first three sorts alone keeps the same rows both ways, and fails one of the
  // pair. The columns after the first hold no clock time with no offset; the ones with the fewest values come first,
  // since they tie most often.
  if (counts) {
    const distinct = (column: ColumnDescriptor) => new Set(cellsIn(column).filter((cell) => placed(column.id, cell))).size;
    const after = [...sortable.filter((c) => !mixed.has(c.id)), ...collated].sort((a, b) => distinct(a) - distinct(b));
    for (const lead of sortable) {
      const pick = (): { prefix: SortSpec[]; then: ColumnDescriptor; limit: number } | undefined => {
        for (const mid of after) {
          for (const third of after) {
            if (mid === lead || third === lead || third === mid) continue;
            const prefix: SortSpec[] = [lead, mid, third].map((c) => ({ columnId: c.id, direction: "desc" }));
            if (runsOf(prefix, null).runs.length === 0) continue;
            for (const then of after) {
              if (then === lead || then === mid || then === third) continue;
              const limit = pairCut(prefix, then);
              if (limit !== undefined) return { prefix, then, limit };
            }
          }
        }
        return undefined;
      };
      const picked = pick();
      if (!picked) continue;
      const { prefix, then, limit } = picked;
      for (const direction of ["asc", "desc"] as const) {
        const sorts: SortSpec[] = [...prefix, { columnId: then.id, direction }];
        add(
          `a count that cuts inside rows that tie on the first three sorted columns keeps the ones the fourth puts first (the first ${limit} rows, ${sortWords(sorts, label)})`,
          { ...base, sorts, limit },
        );
      }
    }
  }
  // A count sorted first by a text or enum column, each way: the first rows by its letters, ignoring case, or by its
  // values' IDs, as text. Beside a filter that keeps only the values whose order is checked, where the column allows
  // one; with none, only a column whose every value is such a value. The cut falls between two values, where the rows
  // kept by character code, or for an enum in the order its values are declared, would be other rows if it can.
  if (counts) {
    for (const column of collated) {
      const only = onlyOrdered(column);
      const filters = only ? group("and", [only]) : null;
      const where = only ? `, where ${filterWords(only, column, zone)}` : "";
      const declared = (column.enumValues ?? []).map((value) => value.id);
      for (const direction of ["asc", "desc"] as const) {
        const sorts: SortSpec[] = [{ columnId: column.id, direction }];
        const inOrder = keptBy({ ...base, filters, sorts, limit: total });
        const cell = (at: number) => cellAt(at, column.id);
        if (inOrder.length < 2 || !inOrder.every((at) => placed(column.id, cell(at)))) continue;
        const turn = direction === "desc" ? -1 : 1;
        const byCode = (a: number, b: number) => {
          const [x, y] = [String(cell(a)), String(cell(b))];
          return turn * (x < y ? -1 : x > y ? 1 : 0);
        };
        const inDeclared = (a: number, b: number) => turn * (declared.indexOf(String(cell(a))) - declared.indexOf(String(cell(b))));
        const others = [byCode, ...(declared.length > 0 ? [inDeclared] : [])].map((by) => [...inOrder].sort(by));
        const valuesOf = (order: readonly number[], n: number) =>
          order
            .slice(0, n)
            .map((at) => String(cell(at)))
            .sort()
            .join("\u0000");
        const middle = Math.ceil(inOrder.length / 2);
        const cuts = inOrder
          .map((_, n) => n)
          .filter((n) => n >= 1 && cell(inOrder[n - 1] as number) !== cell(inOrder[n] as number))
          .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
        const limit = cuts.find((n) => others.some((order) => valuesOf(order, n) !== valuesOf(inOrder, n))) ?? cuts[0];
        if (limit === undefined) continue;
        const rule =
          column.kind === "enum"
            ? "an enum keeps its first rows by its values' IDs"
            : "text keeps its first rows by its letters, ignoring case";
        add(`a count sorted by ${rule} (the first ${limit} rows, ${sortWords(sorts, label)}${where})`, { ...base, filters, sorts, limit });
      }
    }
  }
  // A count beside each or group: a Data Query that builds an "or" in another place may lose the count there, and
  // return every row the filters keep. The cut falls between two values of the sorted column.
  // And beside each shape of a filter on a hidden column, with the sorted column hidden too.
  if (counts && first) {
    const sorts: SortSpec[] = [{ columnId: first.id, direction: "desc" }];
    for (const { phrase, options } of besides) {
      const found = options
        .map((shape) => {
          const inOrder = keptBy({ ...base, filters: shape.filters, sorts, limit: total });
          const [limit] = cutsIn(first, inOrder, countsFor(inOrder));
          return limit === undefined ? undefined : { shape, limit };
        })
        .find((option) => option !== undefined);
      if (!found) continue;
      const { state, where } = besideCase(found.shape, sorts, found.limit);
      add(`a count ${phrase} still keeps only its first rows (the first ${found.limit} rows, ${sortWords(sorts, label)}${where})`, state);
    }
  }
  // A count that cuts inside a run of tied rows beside each of them, as beside a filter joined with "and": a Data Query
  // that keeps every tied row (RANK, WITH TIES), drops the tied run, or keeps another number of rows only where the
  // filters hold an "or", or only where a column is hidden, fails. The first number, date or yes/no column with such a
  // run, descending; a run with rows ahead of it and behind it first.
  if (counts) {
    for (const { phrase, options } of besides) {
      let found: { column: ColumnDescriptor; shape: Shape; limit: number } | undefined;
      for (const inside of [true, false]) {
        for (const column of sortable) {
          for (const shape of options) {
            const limit = tiedCut(column, shape.filters, inside);
            if (limit !== undefined) found ??= { column, shape, limit };
          }
        }
      }
      if (!found) continue;
      const sorts: SortSpec[] = [{ columnId: found.column.id, direction: "desc" }];
      const { state, where } = besideCase(found.shape, sorts, found.limit);
      add(
        `a count that cuts inside tied rows ${phrase} keeps its number of rows (the first ${found.limit} rows, ${sortWords(sorts, label)}${where})`,
        state,
      );
    }
  }
  // And a count with two sorts that cuts inside a run of rows that tie on the first, beside each of them: the second,
  // each way, decides which of the run it keeps. A Data Query that cuts by the first sort alone there keeps the same rows
  // both ways, and fails one of the pair. Both are number, date or yes/no columns; the second holds no clock time with no
  // offset. Rows the first sort doesn't tell from the run are the Host's to place (ruling R3).
  if (counts) {
    for (const { phrase, options } of besides) {
      let found: { prefix: SortSpec[]; then: ColumnDescriptor; shape: Shape; limit: number } | undefined;
      for (const lead of sortable) {
        const prefix: SortSpec[] = [{ columnId: lead.id, direction: "desc" }];
        for (const then of sortable.filter((c) => c !== lead && !mixed.has(c.id))) {
          for (const shape of options) {
            if (found) break;
            const limit = pairCut(prefix, then, shape.filters);
            if (limit !== undefined) found = { prefix, then, shape, limit };
          }
        }
      }
      if (!found) continue;
      const { prefix, then, shape, limit } = found;
      for (const direction of ["asc", "desc"] as const) {
        const sorts: SortSpec[] = [...prefix, { columnId: then.id, direction }];
        const { state, where } = besideCase(shape, sorts, limit);
        add(
          `a count that cuts inside rows that tie on the first sorted column ${phrase} keeps the ones the next sorted column puts first (the first ${limit} rows, ${sortWords(sorts, label)}${where})`,
          state,
        );
      }
    }
  }
  // A count sorted by a column the view hides, for each number, date and yes/no column: hiding a column never changes
  // which rows a count keeps. A Data Query whose count sorts only by the columns that show keeps other rows. The cut
  // falls between two values of the column.
  if (counts) {
    for (const column of sortable) {
      const sorts: SortSpec[] = [{ columnId: column.id, direction: "desc" }];
      const inOrder = keptBy({ ...base, sorts, limit: total });
      const [limit] = cutsIn(column, inOrder, countsFor(inOrder));
      if (limit === undefined) continue;
      add(`a count still sorts by a hidden column (the first ${limit} rows, ${sortWords(sorts, label)}, with ${column.label} hidden)`, {
        ...base,
        visibleColumnIds: base.visibleColumnIds.filter((columnId) => columnId !== column.id),
        sorts,
        limit,
      });
    }
  }
  // A count never keeps a row with no value in a text or enum column it sorts by first either, where empty text is no
  // value too.
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
