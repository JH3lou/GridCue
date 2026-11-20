/**
 * THE HOST'S CODE, NOT GRIDCUE'S. GridCue never writes a Data Query (ADR 0032). This is one way a Host turns a View
 * State into its own request for rows, here SQLite through `node:sqlite`. Copy it, change it, and run the Query Check
 * from `gridcue/testing` against your copy (see query.test.ts).
 *
 * Two rules keep it safe:
 * - No value from a View State is ever written into the query text. Every value is a bound parameter (`?`).
 * - A column ID is used only after it is found in the schema, and never for a restricted column. It is then written as
 *   a quoted identifier. An ID the schema doesn't hold is an error, never text in the query.
 *
 * What each filter keeps follows GridCue's own meanings (`applyView`), not SQL's habits. SQL's `<>` drops empty cells,
 * GridCue's "is not" keeps them; `=` on text may care about letter case, GridCue's doesn't. Each rule is next to its
 * SQL below.
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  type ColumnDescriptor,
  type FilterGroup,
  type FilterPredicate,
  operatorsFor,
  type Scalar,
  type SortSpec,
  type ViewSchema,
  type ViewState,
} from "gridcue";

/** Which rows of the view to return: `size` rows, after skipping `offset`. */
export interface Page {
  offset: number;
  size: number;
}

/** A query's text and the values bound to its `?`s, in order. */
export interface Statement {
  sql: string;
  params: SQLInputValue[];
}

/** The page's rows, and how many rows the whole view has. */
export interface RowsQuery {
  rows: Statement;
  total: Statement;
}

/** A View State or page this Data Query can't carry out. The route answers 400. */
export class DataQueryError extends Error {}

const TABLE = '"grid_rows"';
const MAX_PAGE_SIZE = 1000;
/**
 * The most a View State's filters may hold here. A View State has no such limit, but a database has: SQLite refuses an
 * expression about 1,000 deep and more than 32,766 bound values. A View State GridCue builds is a few groups deep.
 */
const MAX_GROUP_DEPTH = 16;
const MAX_FILTERS = 200;
const MAX_LIST_VALUES = 1000;
const MAX_BOUND_VALUES = 10_000;

// --- Columns -----------------------------------------------------------------------------------------------------

/** A column ID as a quoted SQL identifier. Only ever called with an ID taken from the schema. */
const quoted = (id: string): string => `"${id.replaceAll('"', '""')}"`;

const TEXT_KINDS: ReadonlySet<ColumnDescriptor["kind"]> = new Set(["string", "enum"]);
const NUMBER_KINDS: ReadonlySet<ColumnDescriptor["kind"]> = new Set(["number", "currency", "percent"]);

/** The schema's column for an ID a View State names. Unknown and restricted columns are errors. */
const usableColumn = (schema: ViewSchema, columnId: unknown, use: "filter" | "sort"): ColumnDescriptor => {
  const column = schema.columns.find((c) => c.id === columnId);
  // The ID is not put in the message: it came from the request.
  if (!column) throw new DataQueryError(`A ${use} names a column this grid doesn't have.`);
  if (column.sensitivity === "restricted") throw new DataQueryError(`A ${use} names a restricted column.`);
  if (!column.capabilities.includes(use)) throw new DataQueryError(`${column.label} can't be used to ${use}.`);
  return column;
};

/** The columns a page returns: every column but the restricted ones, which never leave the server. */
const returnedColumns = (schema: ViewSchema): ColumnDescriptor[] => schema.columns.filter((c) => c.sensitivity !== "restricted");

// --- Dates: a date in a filter means the whole day in the calendar's time zone -----------------------------------

/**
 * The time zone a date in a filter is a whole day in: the schema's Calendar's. With none, GridCue uses the browser's,
 * which a server can't know, so this falls back to the server's own. Name a Calendar time zone to make them agree.
 */
const timeZoneOf = (schema: ViewSchema): string => schema.calendar?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?)?$/;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** Reads "2026-11-13", and only a day that exists. */
const readDay = (text: unknown): Ymd | undefined => {
  if (typeof text !== "string") return undefined;
  const match = DAY.exec(text);
  return match ? realDay(Number(match[1]), Number(match[2]), Number(match[3])) : undefined;
};

const realDay = (y: number, m: number, d: number): Ymd | undefined => {
  const at = new Date(0);
  at.setUTCFullYear(y, m - 1, d);
  const exists = y >= 1 && at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
  return exists ? { y, m, d } : undefined;
};

const dayText = ({ y, m, d }: Ymd): string => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const nextDay = ({ y, m, d }: Ymd): Ymd => {
  const at = new Date(0);
  at.setUTCFullYear(y, m - 1, d + 1);
  return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() };
};

/** A clock time read as if it were UTC, in milliseconds. */
const clockMs = (day: Ymd, hour: number, minute: number, second: number, ms: number): number => {
  const at = new Date(0);
  at.setUTCFullYear(day.y, day.m - 1, day.d);
  at.setUTCHours(hour, minute, second, ms);
  return at.getTime();
};

const clocks = new Map<string, Intl.DateTimeFormat>();

/** The wall clock in a time zone, to the second. */
const clockIn = (timeZone: string): Intl.DateTimeFormat => {
  let clock = clocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    clocks.set(timeZone, clock);
  }
  return clock;
};

/** The wall clock's fields in the time zone at an instant. */
const wallAt = (at: number, timeZone: string): Record<string, number> => {
  const parts: Record<string, number> = {};
  for (const part of clockIn(timeZone).formatToParts(at)) parts[part.type] = Number(part.value);
  return parts;
};

/** How far the time zone's clock is ahead of UTC at an instant, in milliseconds. */
const offsetAt = (at: number, timeZone: string): number => {
  const p = wallAt(at, timeZone);
  const wall = clockMs({ y: p.year ?? 1970, m: p.month ?? 1, d: p.day ?? 1 }, p.hour ?? 0, p.minute ?? 0, p.second ?? 0, 0);
  return wall - (at - (((at % 1000) + 1000) % 1000));
};

/** The instant the clock in the time zone shows a clock time. Read the offset twice, since a clock change moves it. */
const instantOfClock = (clock: number, timeZone: string): number => clock - offsetAt(clock - offsetAt(clock, timeZone), timeZone);

/** The instant a day starts in the time zone, in milliseconds since 1970 UTC. */
const startOfDay = (day: Ymd, timeZone: string): number => instantOfClock(clockMs(day, 0, 0, 0, 0), timeZone);

/**
 * The instant a date and time names, or `undefined`. With an offset ("Z", "+05:30") it is the instant written; with
 * none it is that time on the clock in the time zone. A day with no time names no instant.
 */
const readInstant = (text: unknown, timeZone: string): number | undefined => {
  if (typeof text !== "string") return undefined;
  const match = STAMP.exec(text.trim());
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s, fraction, zulu, sign, offsetHours, offsetMinutes] = match;
  const day = realDay(Number(y), Number(mo), Number(d));
  const [hour, minute, second] = [Number(h), Number(mi), Number(s ?? 0)];
  if (!day || hour > 23 || minute > 59 || second > 59) return undefined;
  const clock = clockMs(day, hour, minute, second, Number((fraction ?? "0").slice(0, 3).padEnd(3, "0")));
  if (zulu === undefined && sign === undefined) return instantOfClock(clock, timeZone);
  const [hours, minutes] = [Number(offsetHours ?? 0), Number(offsetMinutes ?? 0)];
  if (hours > 23 || minutes > 59) return undefined;
  return clock - (sign === "-" ? -1 : 1) * (hours * 60 + minutes) * 60_000;
};

/** The day an instant falls on in the time zone. */
const dayOfInstant = (at: number, timeZone: string): string => {
  const p = wallAt(at, timeZone);
  return dayText({ y: p.year ?? 1970, m: p.month ?? 1, d: p.day ?? 1 });
};

// --- Filters -----------------------------------------------------------------------------------------------------

type DateOperator = "eq" | "gt" | "gte" | "lt" | "lte";
const SQL_COMPARISON: Record<DateOperator, string> = { eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=" };

/**
 * One end of a date comparison. A date column holds days as text ("2026-11-13"); a date-and-time column holds
 * instants, in milliseconds since 1970 UTC (see `openRowsDatabase`). A day in the filter is the whole day in the time
 * zone, so on a date-and-time column it becomes the instants the day starts and ends. A filter value that names an
 * instant compares as one. A value that is neither keeps no row, as in `applyView`.
 */
const dateEnd = (column: ColumnDescriptor, operator: DateOperator, end: unknown, params: SQLInputValue[], timeZone: string): string => {
  const c = quoted(column.id);
  const day = readDay(end);
  if (column.kind === "date") {
    if (!day) return "0"; // A date column's cells are days, and a day has no instant to compare.
    params.push(dayText(day));
    return `${c} ${SQL_COMPARISON[operator]} ?`;
  }
  if (day) {
    const [start, after] = [startOfDay(day, timeZone), startOfDay(nextDay(day), timeZone)];
    params.push(...{ eq: [start, after], gt: [after], gte: [start], lt: [start], lte: [after] }[operator]);
    if (operator === "eq") return `(${c} >= ? AND ${c} < ?)`;
    return `${c} ${{ gt: ">=", gte: ">=", lt: "<", lte: "<" }[operator]} ?`;
  }
  const at = readInstant(end, timeZone);
  if (at === undefined) return "0";
  params.push(at);
  return `${c} ${SQL_COMPARISON[operator]} ?`;
};

/** A filter value, checked against the column's kind and turned into what the database holds. */
const bound = (column: ColumnDescriptor, value: unknown): SQLInputValue => {
  if (NUMBER_KINDS.has(column.kind) && typeof value === "number" && Number.isFinite(value)) return value;
  if (column.kind === "boolean" && typeof value === "boolean") return value ? 1 : 0;
  if (column.kind === "string" && typeof value === "string") return value.toLowerCase(); // compared ignoring case
  if (column.kind === "enum" && typeof value === "string") return value;
  if ((column.kind === "date" || column.kind === "datetime") && typeof value === "string") return value;
  throw new DataQueryError(`A filter on ${column.label} has a value of the wrong kind.`);
};

/** A `between` filter's value: `{ min, max }`. */
const rangeOf = (value: unknown): { min?: unknown; max?: unknown } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DataQueryError("A range needs a start and an end.");
  return value;
};

/** One filter as SQL, its values pushed onto `params`. */
const predicateSql = (schema: ViewSchema, p: FilterPredicate, params: SQLInputValue[]): string => {
  const column = usableColumn(schema, p.columnId, "filter");
  if (!operatorsFor(column).includes(p.operator)) throw new DataQueryError(`${column.label} can't use that filter.`);
  const c = quoted(column.id);
  const text = column.kind === "string";
  // On a text column GridCue compares ignoring case, and an empty cell is empty text: "is" "" keeps the empty cells.
  // `lower` is JavaScript's own (see openRowsDatabase), so it folds every letter as GridCue does.
  const cell = text ? `lower(coalesce(${c}, ''))` : c;
  const empty = TEXT_KINDS.has(column.kind) ? `(${c} IS NULL OR ${c} = '')` : `${c} IS NULL`;
  const value = p.value;

  if ((column.kind === "date" || column.kind === "datetime") && p.operator !== "isEmpty" && p.operator !== "isNotEmpty") {
    const zone = timeZoneOf(schema);
    if (p.operator === "between") {
      const range = rangeOf(value);
      bound(column, range.min);
      bound(column, range.max);
      // Both ends included, each a whole day.
      return `(${dateEnd(column, "gte", range.min, params, zone)} AND ${dateEnd(column, "lte", range.max, params, zone)})`;
    }
    bound(column, value);
    return dateEnd(column, p.operator as DateOperator, value, params, zone);
  }

  switch (p.operator) {
    case "isEmpty":
      // Null and empty text. Whitespace-only text is a value.
      return empty;
    case "isNotEmpty":
      return `NOT ${empty}`;
    case "eq":
      params.push(bound(column, value));
      return `${cell} = ?`;
    case "neq":
      // GridCue's "is not" keeps empty cells. SQL's <> alone would drop them.
      params.push(bound(column, value));
      return text ? `${cell} <> ?` : `(${c} IS NULL OR ${c} <> ?)`;
    case "in": {
      if (!Array.isArray(value)) throw new DataQueryError(`A list filter on ${column.label} needs a list.`);
      if (value.length > MAX_LIST_VALUES) throw new DataQueryError(`A list filter holds at most ${MAX_LIST_VALUES} values.`);
      if (value.length === 0) return "0";
      params.push(...value.map((v) => bound(column, v)));
      return `${cell} IN (${value.map(() => "?").join(", ")})`;
    }
    case "contains":
      // instr, not LIKE: % and _ in the value are plain text, and empty text keeps every row.
      params.push(bound(column, value));
      return `instr(${cell}, ?) > 0`;
    case "startsWith":
      params.push(bound(column, value));
      return `instr(${cell}, ?) = 1`;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      // An empty cell is NULL, and a comparison with NULL keeps no row.
      params.push(bound(column, value));
      return `${c} ${SQL_COMPARISON[p.operator]} ?`;
    case "between": {
      // Both ends included.
      const range = rangeOf(value);
      params.push(bound(column, range.min), bound(column, range.max));
      return `(${c} >= ? AND ${c} <= ?)`;
    }
    default:
      throw new DataQueryError(`${column.label} can't use that filter.`);
  }
};

const JOINS = { and: " AND ", or: " OR " } as const;

/**
 * Checks the filters' size before any SQL is built: at most `MAX_GROUP_DEPTH` groups deep and `MAX_FILTERS` filters in
 * all. It walks with a list, not by calling itself, so no depth can overflow the stack here.
 */
const checkFilterSize = (root: FilterGroup): void => {
  const pending: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 1 }];
  let filters = 0;
  while (pending.length > 0) {
    const { node, depth } = pending.pop() as { node: unknown; depth: number };
    const children = (node as { type?: unknown; children?: unknown }).type === "group" ? (node as FilterGroup).children : undefined;
    if (!Array.isArray(children)) {
      filters += 1;
      if (filters > MAX_FILTERS) throw new DataQueryError(`A view holds at most ${MAX_FILTERS} filters here.`);
      continue;
    }
    if (depth > MAX_GROUP_DEPTH) throw new DataQueryError(`Filter groups nest at most ${MAX_GROUP_DEPTH} deep here.`);
    for (const child of children) pending.push({ node: child, depth: depth + 1 });
  }
};

/** A filter group as SQL, nested as the View State nests it. An empty "and" keeps every row, an empty "or" none. */
const groupSql = (schema: ViewSchema, group: FilterGroup, params: SQLInputValue[]): string => {
  const join = JOINS[group.combinator as keyof typeof JOINS];
  if (!join || !Array.isArray(group.children)) throw new DataQueryError("A filter group must join its filters with and or or.");
  if (group.children.length === 0) return group.combinator === "and" ? "1" : "0";
  const parts = group.children.map((child) =>
    child.type === "group" ? groupSql(schema, child, params) : predicateSql(schema, child as FilterPredicate, params),
  );
  return `(${parts.join(join)})`;
};

// --- Sorts -------------------------------------------------------------------------------------------------------

const DIRECTIONS = { asc: "ASC NULLS LAST", desc: "DESC NULLS FIRST" } as const;

/**
 * The ORDER BY list. Each sort column in turn, in its direction. Empty cells go where `applyView` puts them: a cell
 * with no value is last going up and first going down, and empty text sorts before other text going up. Text is
 * ordered ignoring case, which the Query Check tests on text made of the letters A to Z; how a database orders other
 * text (`NOCASE` folds only A to Z) is its own collation's. Rows that tie keep the order they were loaded in (rowid),
 * as `applyView` keeps the Host's order.
 */
const orderSql = (schema: ViewSchema, sorts: readonly SortSpec[]): string => {
  const keys = sorts.map((s) => {
    const column = usableColumn(schema, s.columnId, "sort");
    const direction = DIRECTIONS[s.direction as keyof typeof DIRECTIONS];
    if (!direction) throw new DataQueryError("A sort's direction must be asc or desc.");
    return `${quoted(column.id)}${TEXT_KINDS.has(column.kind) ? " COLLATE NOCASE" : ""} ${direction}`;
  });
  return [...keys, "rowid"].join(", ");
};

/**
 * Refuses a column sorted twice. A second sort on a column says nothing its first sort didn't, and a View State sets no
 * limit on how many sorts it holds: SQLite refuses an ORDER BY of thousands of terms. Sorted once each, the sorts are
 * never more than the schema's columns. It runs before any SQL is built.
 */
const checkSortedOnce = (sorts: readonly SortSpec[]): void => {
  const seen = new Set<unknown>();
  for (const sort of sorts) {
    const columnId: unknown = sort?.columnId;
    // The ID is not put in the message: it came from the request.
    if (seen.has(columnId)) throw new DataQueryError("A view sorts by each column once.");
    seen.add(columnId);
  }
};

/** A count never keeps a row with no value in the first sorted column. */
const hasValueSql = (schema: ViewSchema, sorts: readonly SortSpec[]): string | undefined => {
  const first = sorts[0];
  if (!first) return undefined;
  const column = usableColumn(schema, first.columnId, "sort");
  const c = quoted(column.id);
  return TEXT_KINDS.has(column.kind) ? `(${c} IS NOT NULL AND ${c} <> '')` : `${c} IS NOT NULL`;
};

// --- The query ---------------------------------------------------------------------------------------------------

const isWhole = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/**
 * The SQL for one page of a View State, and for the number of rows in the whole view. Filters, then a count (the first
 * N rows of the sorted, filtered rows, cut before paging), then the page. Grouping, totals, pins and which columns
 * show are the table's to draw, so they are not in the query.
 */
export const buildRowsQuery = (schema: ViewSchema, state: ViewState, page: Page): RowsQuery => {
  if (!isWhole(page?.offset, 0, Number.MAX_SAFE_INTEGER) || !isWhole(page?.size, 1, MAX_PAGE_SIZE)) {
    throw new DataQueryError(`A page is a whole-number offset from 0 and a size from 1 to ${MAX_PAGE_SIZE}.`);
  }
  const limit = state.limit;
  if (limit !== undefined && !isWhole(limit, 1, Number.MAX_SAFE_INTEGER)) throw new DataQueryError("A count is a whole number from 1.");
  const sorts = Array.isArray(state.sorts) ? state.sorts : [];
  checkSortedOnce(sorts);

  const params: SQLInputValue[] = [];
  if (state.filters) checkFilterSize(state.filters);
  const conditions = state.filters ? [groupSql(schema, state.filters, params)] : [];
  if (params.length > MAX_BOUND_VALUES) throw new DataQueryError(`A view's filters hold at most ${MAX_BOUND_VALUES} values here.`);
  const hasValue = limit === undefined ? undefined : hasValueSql(schema, sorts);
  if (hasValue) conditions.push(hasValue);
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const order = orderSql(schema, sorts);
  const columns = returnedColumns(schema)
    .map((c) => quoted(c.id))
    .join(", ");

  // With a count, the page never reaches past the count's last row.
  const rowsOnPage = limit === undefined ? page.size : Math.max(0, Math.min(page.size, limit - page.offset));
  return {
    rows: {
      sql: `SELECT ${columns} FROM ${TABLE}${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      params: [...params, rowsOnPage, page.offset],
    },
    total:
      limit === undefined
        ? { sql: `SELECT count(*) AS total FROM ${TABLE}${where}`, params: [...params] }
        : { sql: `SELECT min(count(*), ?) AS total FROM ${TABLE}${where}`, params: [limit, ...params] },
  };
};

/** Runs the query on the database: the page's rows, as the table draws them, and the number of rows in the view. */
export const readRows = (
  db: DatabaseSync,
  schema: ViewSchema,
  state: ViewState,
  page: Page,
): { rows: Array<Record<string, Scalar>>; total: number } => {
  const query = buildRowsQuery(schema, state, page);
  const columns = returnedColumns(schema);
  const rows = db
    .prepare(query.rows.sql)
    .all(...query.rows.params)
    .map((row) => Object.fromEntries(columns.map((c) => [c.id, fromDatabase(c, row[c.id] ?? null)])));
  const total = Number(db.prepare(query.total.sql).get(...query.total.params)?.total ?? 0);
  return { rows, total };
};

// --- The database ------------------------------------------------------------------------------------------------

const SQL_TYPE: Record<ColumnDescriptor["kind"], string> = {
  string: "TEXT",
  enum: "TEXT",
  number: "REAL",
  currency: "REAL",
  percent: "REAL",
  boolean: "INTEGER",
  date: "TEXT",
  datetime: "INTEGER",
};

/**
 * A cell as the database holds it. Yes and no are 1 and 0. A date is its day, "2026-11-13", in the time zone when the
 * cell holds a time with an offset. A date and time is its instant, in milliseconds since 1970 UTC. Outside text
 * columns, empty text is an empty cell. A cell the column's kind can't hold is an error, as a typed database would
 * refuse it.
 */
const toDatabase = (column: ColumnDescriptor, value: unknown, timeZone: string): SQLInputValue => {
  if (value === null || value === undefined) return null;
  if (value === "" && !TEXT_KINDS.has(column.kind)) return null;
  if (TEXT_KINDS.has(column.kind) && typeof value === "string") return value;
  if (NUMBER_KINDS.has(column.kind) && typeof value === "number") return value;
  if (column.kind === "boolean" && typeof value === "boolean") return value ? 1 : 0;
  if (column.kind === "date" && typeof value === "string") {
    const day = readDay(value);
    if (day) return dayText(day);
    // A time with no offset is on its own date; with an offset, on the day that instant falls on.
    const match = STAMP.exec(value.trim());
    const at = readInstant(value, timeZone);
    if (match && at !== undefined) {
      const hasOffset = match[8] !== undefined || match[9] !== undefined;
      return hasOffset ? dayOfInstant(at, timeZone) : value.trim().slice(0, 10);
    }
  }
  if (column.kind === "datetime") {
    const at = readInstant(value, timeZone);
    if (at !== undefined) return at;
  }
  throw new DataQueryError(`A ${column.label} cell can't be stored as ${column.kind}.`);
};

/** A cell as the table draws it: yes and no as true and false, a date and time as an ISO instant. */
const fromDatabase = (column: ColumnDescriptor, value: unknown): Scalar => {
  if (value === null) return null;
  if (column.kind === "boolean") return value === 1;
  if (column.kind === "datetime") return new Date(Number(value)).toISOString();
  return value as Scalar;
};

/**
 * An in-memory SQLite database holding `rows` in one table, a column for each of the schema's columns, in the order
 * given. The route loads its rows once; the test loads the Query Check's synthetic rows.
 */
export const openRowsDatabase = (schema: ViewSchema, rows: readonly object[]): DatabaseSync => {
  const db = new DatabaseSync(":memory:");
  // SQLite's own lower() folds only A to Z. This one folds every letter, as GridCue does.
  db.function("lower", { deterministic: true }, (value) => (typeof value === "string" ? value.toLowerCase() : value));
  const timeZone = timeZoneOf(schema);
  db.exec(`CREATE TABLE ${TABLE} (${schema.columns.map((c) => `${quoted(c.id)} ${SQL_TYPE[c.kind]}`).join(", ")})`);
  const insert = db.prepare(
    `INSERT INTO ${TABLE} (${schema.columns.map((c) => quoted(c.id)).join(", ")}) VALUES (${schema.columns.map(() => "?").join(", ")})`,
  );
  db.exec("BEGIN");
  for (const row of rows) {
    const cells = row as Record<string, unknown>;
    insert.run(...schema.columns.map((c) => toDatabase(c, cells[c.id], timeZone)));
  }
  db.exec("COMMIT");
  return db;
};
