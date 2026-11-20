import { type ColumnDescriptor, type FilterPredicate, type MatchOptions, matchesPredicate, operatorsFor, type ViewSchema } from "../index";

// GridCue's meanings in AG Grid's own filters and sorts (more grids spec, 4.1 and 5.6): the settings each column of the
// Host's grid gets, and each GridCue filter as a condition of AG Grid's filter model.
//
// Which options are AG Grid's own and which are custom options with GridCue's predicate was settled by the row check:
// the Query Check's cases, and rows with empty text in number and date cells, run through AG Grid 34, 35 and 36
// (`test/ag-grid-meanings.test.ts` holds the findings as a test). An operator has one option on every filter, and each
// column's filter lists only the options of the operators its column allows (`optionKeysFor`), so AG Grid's menu offers
// nothing GridCue can't read. A default column definition can't do that: AG Grid 34 and 35 give every column the same
// `filterParams`, so the settings are set on each column (`gridcueColumnDefs`).
//
// | Operator                   | Option                        | Why                                                                |
// | -------------------------- | ----------------------------- | ------------------------------------------------------------------ |
// | equals                     | AG Grid's `equals`            | Right on 34, 35 and 36: text through the matcher below, a number   |
// |                            |                               | as it is (an empty cell is never equal, to 0 either), a date       |
// |                            |                               | through the whole-day comparator below.                            |
// | not equal                  | AG Grid's `notEqual`          | Right on 34, 35 and 36 with `includeBlanksInNotEqual`: empty cells |
// |                            |                               | stay. A date column has no "not equal" in GridCue.                 |
// | contains, starts with      | AG Grid's own                 | Right on 34, 35 and 36 through the matcher.                        |
// | less than (or equal),      | custom `gridcueLessThan`, ... | On 34 and 35 AG Grid's own keep an empty text cell in a number     |
// | greater than (or equal),   |                               | column, as the value 0. Right on 36, and on dates on all three,    |
// | between                    |                               | but an operator has one option.                                    |
// | is empty, is not empty     | custom `gridcueIsEmpty`, ...  | AG Grid's `blank` also matches whitespace-only text, on 34, 35 and |
// |                            |                               | 36, and on 34 and 35 leaves out an empty text cell in a date       |
// |                            |                               | column. Right on numbers on all three, but one option.             |
// | text equal to empty text   | `gridcueIsEmpty`              | AG Grid never passes a missing cell to the matcher: it drops it    |
// | text not equal to it       | `gridcueIsNotEmpty`           | for `equals` and keeps it for `notEqual`. GridCue means the empty  |
// |                            |                               | cells, missing ones included, and the rest. On 34, 35 and 36.      |
// | text contains, or starts   | none: refused                 | GridCue keeps every row; AG Grid's own drop the missing cells, on  |
// | with, empty text           |                               | 34, 35 and 36, and no option here keeps every row.                 |
//
// So `inRangeInclusive` is not set: AG Grid's own `inRange` is not listed, and "Between" includes both ends itself.
// AG Grid's own `blank`, `lessThan` and the rest are not listed either, so the grid drops a filter model that uses one.
//
// An enum column's text filter takes a value's ID, or its label in any case ("Northgate" for northgate), since a grid
// often shows the label: the matcher and the reader both read the label as its value's ID, so the rows agree.

/** AG Grid's filter for a column: its text, number or date filter. */
export type AgFilterType = "text" | "number" | "date";

/** The AG Grid filter a column of each kind uses. */
export const filterTypeOf = (kind: ColumnDescriptor["kind"]): AgFilterType => {
  if (kind === "number" || kind === "currency" || kind === "percent") return "number";
  if (kind === "date" || kind === "datetime") return "date";
  return "text";
};

/** AG Grid's own filters, by the name a column definition gives them. */
export const AG_FILTERS: Readonly<Record<string, AgFilterType>> = {
  agTextColumnFilter: "text",
  agNumberColumnFilter: "number",
  agDateColumnFilter: "date",
};

/** The filter AG Grid gives a column whose `filter` is `true`, by its `cellDataType`: text unless it is a number or a date. */
export const filterTypeForDataType = (cellDataType: unknown): AgFilterType | "other" => {
  if (cellDataType === "number") return "number";
  if (cellDataType === "date" || cellDataType === "dateString" || cellDataType === "dateTime" || cellDataType === "dateTimeString") {
    return "date";
  }
  if (cellDataType === "bigint") return "other";
  return "text";
};

/** AG Grid's own options GridCue writes and reads. */
export type BuiltInOption = "equals" | "notEqual" | "contains" | "startsWith";

/** The operator each option means, AG Grid's own and GridCue's custom ones. `in` is an OR of `equals`. */
export const OPERATOR_OF: Readonly<Record<string, FilterPredicate["operator"]>> = {
  equals: "eq",
  notEqual: "neq",
  contains: "contains",
  startsWith: "startsWith",
  gridcueLessThan: "lt",
  gridcueLessThanOrEqual: "lte",
  gridcueGreaterThan: "gt",
  gridcueGreaterThanOrEqual: "gte",
  gridcueBetween: "between",
  gridcueIsEmpty: "isEmpty",
  gridcueIsNotEmpty: "isNotEmpty",
};
const OPTION_OF = Object.fromEntries(Object.entries(OPERATOR_OF).map(([option, operator]) => [operator, option])) as Partial<
  Record<FilterPredicate["operator"], string>
>;

/**
 * The options a column's filter lists, in the menu's order: one for each operator the column allows, "Equals" also for
 * a list (an OR of equals). Every option GridCue writes on the column is here, and every one here reads back.
 */
export const optionKeysFor = (column: ColumnDescriptor): string[] => {
  const allowed = new Set(operatorsFor(column));
  return Object.entries(OPERATOR_OF)
    .filter(([key, operator]) => allowed.has(operator) || (key === "equals" && allowed.has("in")))
    .map(([key]) => key);
};

/**
 * The value an enum column's filter text names: a value's ID, else the one value whose label it is, ignoring case. With
 * no declared values, the text itself. `undefined` when it names no value, or more than one.
 */
export const enumIdOf = (column: ColumnDescriptor, text: string): string | undefined => {
  const values = column.enumValues;
  if (!values) return text;
  if (values.some((v) => v.id === text)) return text;
  const named = values.filter((v) => v.label.toLowerCase() === text.toLowerCase());
  return named.length === 1 ? named[0]?.id : undefined;
};

/** A custom filter option, as AG Grid's `IFilterOptionDef` takes one. */
export interface GridcueFilterOption {
  displayKey: string;
  displayName: string;
  numberOfInputs: 0 | 1 | 2;
  predicate: (filterValues: unknown[], cellValue: unknown) => boolean;
}

/** What AG Grid passes its text filter's matcher, as far as GridCue reads it. */
export interface GridcueTextMatcherParams {
  filterOption?: string | null;
  value: unknown;
  filterText: string | null;
  column?: { getColId(): string } | null;
  colDef?: { colId?: string; field?: string } | null;
}

/** The filter settings a column GridCue may filter gets (spec 5.6). */
export interface GridcueFilterParams {
  /**
   * The options of the operators the column allows, and only those: AG Grid silently drops a filter model whose option
   * a column doesn't list, and its menu offers each one listed.
   */
  filterOptions: Array<BuiltInOption | GridcueFilterOption>;
  /** The conditions one column holds: enough for a list of every declared value, and never fewer than 64. */
  maxNumConditions: number;
  includeBlanksInNotEqual: true;
  /** AG Grid's own "equals" leaves out empty cells, as GridCue's does. */
  includeBlanksInEquals: false;
  caseSensitive: true;
  textMatcher: (params: GridcueTextMatcherParams) => boolean;
  /** The text filter passes the cell and the filter's text to the matcher as they are. */
  textFormatter: (text: string) => string;
  /** The date filter's comparator: the cell's whole day in the Calendar's time zone against the filter's day. */
  comparator: (filterDate: Date, cellValue: unknown) => number;
}

/** What `gridcueColumnDefs` sets on one column of the schema. */
export interface GridcueColDef {
  /** On a column GridCue may filter: AG Grid's own filter for its `cellDataType`, unless the column names one. */
  filter?: unknown;
  /** On a column GridCue may filter. */
  filterParams?: GridcueFilterParams;
  /** The sort comparator: text in core's order; everything else as AG Grid sorts it, empty cells lowest. */
  comparator: (valueA: unknown, valueB: unknown) => number;
}

/** True when GridCue may filter the column: the Host lets it, and it isn't restricted. */
export const filtersColumn = (column: ColumnDescriptor): boolean =>
  column.sensitivity !== "restricted" && column.capabilities.includes("filter");

/** A column of one kind, for `matchesPredicate`, which reads only the kind. */
const columnOf = (kind: ColumnDescriptor["kind"]): ColumnDescriptor => ({
  id: "gridcue",
  label: "gridcue",
  kind,
  capabilities: [],
  sensitivity: "internal",
});
const TEXT = columnOf("string");
const NUMBER = columnOf("number");
const DATE = columnOf("date");
const DATETIME = columnOf("datetime");

/** How a filter is matched for a schema: in its Calendar's time zone. With none, core reads the browser's as it filters. */
export const matchOptionsOf = (schema: ViewSchema): MatchOptions | undefined =>
  schema.calendar?.timeZone === undefined ? undefined : { timeZone: schema.calendar.timeZone };

const predicateOf = (operator: FilterPredicate["operator"], value?: FilterPredicate["value"]): FilterPredicate => ({
  id: "gridcue",
  type: "predicate",
  columnId: "gridcue",
  operator,
  ...(value === undefined ? {} : { value }),
});

const blank = (cell: unknown): boolean => cell === null || cell === undefined || cell === "";
const isEmptyCell = (_values: unknown[], cell: unknown): boolean => blank(cell);
const isNotEmptyCell = (_values: unknown[], cell: unknown): boolean => !blank(cell);

const two = (n: number) => String(n).padStart(2, "0");

/**
 * One end of a date filter as GridCue's filter holds it. AG Grid builds the end as a `Date` on the grid's own clock,
 * from "2026-01-31 00:00:00" in the model. At midnight it is a whole day, "2026-01-31". With a time of day it is that
 * time on the clock, "2026-01-31T09:30:00", which core reads as a moment in the Calendar's time zone.
 */
const endOf = (date: Date): string => {
  const day = `${String(date.getFullYear()).padStart(4, "0")}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  // Midnight, or on a day whose clock skips midnight, the first moment of the day.
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  if (start.getTime() === date.getTime()) return day;
  return `${day}T${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
};

/** What a function `gridcueColumnDefs` builds closes over, so two built from equal schemas count as the same setting. */
const BRAND = "gridcue";
const branded = <F extends object>(fn: F, brand: string): F => Object.assign(fn, { [BRAND]: brand });

/** The brand of a setting `gridcueColumnDefs` built, or `undefined` for any other value. */
export const brandOf = (value: unknown): string | undefined => {
  if (typeof value !== "function") return undefined;
  const brand = (value as unknown as Record<string, unknown>)[BRAND];
  return typeof brand === "string" ? brand : undefined;
};

/**
 * GridCue's order for two cells (4.1): text by `localeCompare`, as core's `compareValues` sorts it, which ignores case
 * where AG Grid's own text sort puts every capital letter first. Everything else is AG Grid's own order: empty cells
 * lowest, which 4.1 leaves open, and numbers, yes/no and dates by value.
 */
const compareCells = (a: unknown, b: unknown): number => {
  const [noA, noB] = [a === null || a === undefined, b === null || b === undefined];
  if (noA || noB) return noA && noB ? 0 : noA ? -1 : 1;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  const [x, y] = [a as number, b as number];
  return x > y ? 1 : x < y ? -1 : 0;
};

/** The fewest conditions a column holds: a list of text values this long always fits. */
const MIN_CONDITIONS = 64;

/** The conditions one column holds under `gridcueColumnDefs`: a filter with more is refused before it is written. */
export const maxConditionsOf = (schema: ViewSchema): number =>
  Math.max(MIN_CONDITIONS, ...schema.columns.map((c) => c.enumValues?.length ?? 0));

/**
 * The settings each column of the schema gets, so GridCue's filters can be written into AG Grid's own and keep the rows
 * GridCue means (more grids spec, 5.6). The table at the top of this file says which options are AG Grid's own and why.
 * `gridcueColumnDefs` sets them on the Host's column definitions; `createAgGridAdapter` checks each column holds them.
 *
 * - **Text filter:** exact case, with a matcher that applies GridCue's meaning for the column's kind: text ignores
 *   case, an enum's IDs (or labels) and yes/no match exactly. AG Grid takes the matcher's answer as final.
 * - **Date filter:** `equals` compares whole days in the schema Calendar's time zone, or with none the browser's.
 * - **Custom options** carry GridCue's own predicate, which sees every cell: the comparisons, "Between" with both ends
 *   included, "Is empty" and "Is not empty".
 * - **Options:** each column lists the options of the operators it allows (`optionKeysFor`).
 * - **Sorting:** text in GridCue's order. AG Grid keeps empty cells lowest.
 *
 * The settings are built from the schema's columns and Calendar, so build them from the schema the adapter gets.
 */
export const columnSettings = (schema: ViewSchema): ((column: ColumnDescriptor) => GridcueColDef) => {
  const zone = schema.calendar?.timeZone;
  const options = matchOptionsOf(schema);
  const columns = new Map(schema.columns.map((c) => [c.id, c]));
  const kinds = JSON.stringify(schema.columns.map((c) => [c.id, c.kind, c.enumValues?.map((v) => [v.id, v.label]) ?? null]));

  /** A comparison as a custom option's predicate. The date filter passes dates, the number filter numbers. */
  const compares = (operator: "lt" | "lte" | "gt" | "gte" | "between") =>
    branded(
      (filterValues: unknown[], cell: unknown): boolean => {
        const dated = filterValues[0] instanceof Date;
        const ends = filterValues.slice(0, operator === "between" ? 2 : 1).map((v) => (v instanceof Date ? endOf(v) : v));
        const [from, to] = ends;
        if (ends.some((v) => typeof v !== "number" && typeof v !== "string")) return false;
        const value = (operator === "between" ? { min: from, max: to } : from) as FilterPredicate["value"];
        return matchesPredicate(cell, predicateOf(operator, value), dated ? DATE : NUMBER, options);
      },
      `${operator}|${zone ?? ""}`,
    );

  const textMatcher = branded((params: GridcueTextMatcherParams): boolean => {
    const operator = params.filterOption ? OPERATOR_OF[params.filterOption] : undefined;
    if (!operator) return false;
    const id = params.column?.getColId() ?? params.colDef?.colId ?? params.colDef?.field;
    // A column outside the schema is filtered as text.
    const column = (id === undefined ? undefined : columns.get(id)) ?? TEXT;
    // AG Grid passes a yes/no cell as it is, or as the text "true" or "false".
    const yesNo = (v: unknown) => (column.kind !== "boolean" ? v : v === "true" ? true : v === "false" ? false : v);
    const text = params.filterText ?? "";
    // An enum's label means its value, as the reader reads it. (AG Grid 34 and 35 pass another filter type's operand,
    // such as a number, as it is.)
    const operand = column.kind === "enum" && typeof text === "string" ? (enumIdOf(column, text) ?? text) : yesNo(text);
    return matchesPredicate(yesNo(params.value), predicateOf(operator, operand as string | boolean), column, options);
  }, `textMatcher|${kinds}`);

  const textFormatter = branded((text: string): string => text, "textFormatter");

  const comparator = branded(
    (filterDate: Date, cell: unknown): number => {
      const end = endOf(filterDate);
      const is = (operator: "eq" | "lt" | "gt") => matchesPredicate(cell, predicateOf(operator, end), DATE, options);
      // A cell that is no date is on no day: it is neither equal, before nor after.
      return is("eq") ? 0 : is("lt") ? -1 : is("gt") ? 1 : Number.NaN;
    },
    `comparator|${zone ?? ""}`,
  );

  const every: ReadonlyArray<BuiltInOption | GridcueFilterOption> = [
    "equals",
    "notEqual",
    "contains",
    "startsWith",
    { displayKey: "gridcueLessThan", displayName: "Less than", numberOfInputs: 1, predicate: compares("lt") },
    { displayKey: "gridcueLessThanOrEqual", displayName: "Less than or equal to", numberOfInputs: 1, predicate: compares("lte") },
    { displayKey: "gridcueGreaterThan", displayName: "Greater than", numberOfInputs: 1, predicate: compares("gt") },
    { displayKey: "gridcueGreaterThanOrEqual", displayName: "Greater than or equal to", numberOfInputs: 1, predicate: compares("gte") },
    { displayKey: "gridcueBetween", displayName: "Between", numberOfInputs: 2, predicate: compares("between") },
    { displayKey: "gridcueIsEmpty", displayName: "Is empty", numberOfInputs: 0, predicate: isEmptyCell },
    { displayKey: "gridcueIsNotEmpty", displayName: "Is not empty", numberOfInputs: 0, predicate: isNotEmptyCell },
  ];
  const keyOf = (option: BuiltInOption | GridcueFilterOption) => (typeof option === "string" ? option : option.displayKey);
  const maxNumConditions = maxConditionsOf(schema);

  return (column) => {
    if (!filtersColumn(column)) return { comparator: compareCells };
    const keys = new Set(optionKeysFor(column));
    return {
      filter: true,
      filterParams: {
        filterOptions: every.filter((option) => keys.has(keyOf(option))),
        maxNumConditions,
        includeBlanksInNotEqual: true,
        includeBlanksInEquals: false,
        caseSensitive: true,
        textMatcher,
        textFormatter,
        comparator,
      },
      comparator: compareCells,
    };
  };
};

/** One column definition, or a group of them, as `gridcueColumnDefs` reads it. Any AG Grid `ColDef` or `ColGroupDef` fits. */
interface ColumnDefLike {
  colId?: unknown;
  field?: unknown;
  children?: unknown;
  filter?: unknown;
  filterParams?: unknown;
  comparator?: unknown;
}

/**
 * The Host's column definitions with GridCue's settings on each column of the schema (more grids spec, 5.6):
 * `columnDefs={gridcueColumnDefs(schema, columnDefs)}`. Column groups are kept. A column GridCue may filter gets AG
 * Grid's own filter for its `cellDataType`, unless it names one, and filter settings that set that filter to GridCue's
 * meanings and list only the options GridCue reads on that column. Every schema column gets GridCue's sort comparator.
 * A setting the column already has is kept: its own `filter`, `comparator` and `filterParams` keys win, and
 * `createAgGridAdapter` then names any that GridCue's filters can't work with. Columns outside the schema are unchanged.
 *
 * Build it from the schema the adapter gets, once, as it builds new settings each time.
 */
export const gridcueColumnDefs = <D extends object>(schema: ViewSchema, columnDefs: readonly D[]): D[] => {
  const settingsOf = columnSettings(schema);
  const columns = new Map(schema.columns.map((c) => [c.id, c]));
  const withSettings = (def: D): D => {
    const own = def as ColumnDefLike;
    if (Array.isArray(own.children)) return { ...def, children: own.children.map((child: D) => withSettings(child)) };
    const id = own.colId ?? own.field;
    const column = typeof id === "string" ? columns.get(id) : undefined;
    if (!column) return def;
    const settings = settingsOf(column);
    const ownParams = typeof own.filterParams === "object" && own.filterParams !== null ? own.filterParams : {};
    return {
      ...def,
      comparator: own.comparator ?? settings.comparator,
      ...(settings.filterParams ? { filter: own.filter ?? settings.filter, filterParams: { ...settings.filterParams, ...ownParams } } : {}),
    };
  };
  return columnDefs.map(withSettings);
};

/** One condition of an AG Grid simple filter model. */
export type AgCondition = Record<string, string | number>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/** The date and time the clock in a time zone shows at an instant, "2026-01-31T09:30:00". With no zone, the browser's. */
const clockAt = (at: number, timeZone: string | undefined): string | undefined => {
  const parts: Record<string, string> = {};
  const clock = new Intl.DateTimeFormat("en-US", {
    ...(timeZone === undefined ? {} : { timeZone }),
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
  for (const part of clock.formatToParts(at)) parts[part.type] = part.value;
  const text = `${String(Number(parts.year)).padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  return CLOCK.test(text) ? text : undefined;
};

/**
 * A date in a filter as AG Grid's date filter model writes one, or `undefined` when the model can't hold it. A day is
 * its midnight, "2026-01-31 00:00:00". A time, which only a Host's own View State holds, is the time the clock in the
 * Calendar's time zone shows, "2026-01-31 09:30:00". It is written only when GridCue's options read the very same
 * moment back from it (`endOf`): not at midnight, which is a whole day; not with a part of a second; and not a time
 * the grid's own clock or the Calendar's skips or shows twice.
 */
const agDate = (value: unknown, options: MatchOptions | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  if (DAY.test(value)) return `${value} 00:00:00`;
  const at = Date.parse(value);
  // A time with no offset is already the clock's time; any other is the clock's time at that instant.
  const candidates = [CLOCK.test(value) ? value : undefined, Number.isNaN(at) ? undefined : clockAt(at, options?.timeZone)];
  for (const clock of candidates) {
    const match = clock === undefined ? null : CLOCK.exec(clock);
    if (!clock || !match) continue;
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
    // The grid builds the date on its own clock.
    const built = new Date(0);
    built.setFullYear(year, month - 1, day);
    built.setHours(hour, minute, second, 0);
    if (endOf(built) !== clock) continue;
    if (!matchesPredicate(clock, predicateOf("eq", value), DATETIME, options)) continue;
    return clock.replace("T", " ");
  }
  return undefined;
};

/**
 * One GridCue filter, other than a list, as one condition of AG Grid's filter for its column, or the reason AG Grid
 * holds none, as a sentence. A list (`in`) is a condition per value, joined with OR, which the caller builds from
 * `eq` filters. A date is written for the schema Calendar's time zone, which `options` holds.
 */
export const conditionFor = (
  predicate: Pick<FilterPredicate, "operator" | "value">,
  column: ColumnDescriptor,
  options?: MatchOptions,
): AgCondition | string => {
  const condition = anyCondition(predicate, column, options);
  // Only an option the column's filter lists: AG Grid drops any other. Text equal to empty text is "Is empty", which a
  // column that allows equals but not "is empty" doesn't list.
  if (typeof condition !== "string" && !optionKeysFor(column).includes(String(condition.type))) {
    return `AG Grid's filter on ${column.label} doesn't offer that condition.`;
  }
  return condition;
};

const anyCondition = (
  predicate: Pick<FilterPredicate, "operator" | "value">,
  column: ColumnDescriptor,
  options?: MatchOptions,
): AgCondition | string => {
  const filterType = filterTypeOf(column.kind);
  const { operator, value } = predicate;
  const none = `AG Grid has no filter for that condition on ${column.label}.`;
  const type = OPTION_OF[operator];
  if (!type) return none;
  if (operator === "isEmpty" || operator === "isNotEmpty") return { filterType, type };
  const range = operator === "between" && typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
  if (operator === "between" && !range) return none;
  if (filterType === "number") {
    const [from, to] = range ? [range.min, range.max] : [value, undefined];
    if (typeof from !== "number" || (range && typeof to !== "number")) return none;
    return { filterType, type, filter: from, ...(range ? { filterTo: to as number } : {}) };
  }
  if (filterType === "date") {
    if (operator === "neq") return none;
    const [from, to] = range ? [agDate(range.min, options), agDate(range.max, options)] : [agDate(value, options), undefined];
    if (from === undefined || (range && to === undefined))
      return `AG Grid's date filter can't hold the time in the filter on ${column.label}.`;
    return { filterType, type, dateFrom: from, ...(range ? { dateTo: to as string } : {}) };
  }
  if (range || (typeof value !== "string" && typeof value !== "boolean")) return none;
  if (value === "" && column.kind === "string") {
    // Text equal to empty text means the empty cells, missing ones included, which only the custom options keep.
    if (operator === "eq") return { filterType, type: "gridcueIsEmpty" };
    if (operator === "neq") return { filterType, type: "gridcueIsNotEmpty" };
    return `Every row's ${column.label} ${operator === "contains" ? "contains" : "starts with"} empty text, and AG Grid has no filter that keeps every row.`;
  }
  return { filterType, type, filter: String(value) };
};
