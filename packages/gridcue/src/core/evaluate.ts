import { calendarZone, dayOfCell, instantOfCell, isDay } from "./dates";
import type { ColumnDescriptor, FilterGroup, FilterPredicate, Scalar, ViewSchema } from "./protocol";

/** A cell with no value: missing, `null`, or empty text. Filters and counts share this test. */
export const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

const compare = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
};

/** How a filter is evaluated where it needs more than the cell and the column. */
export interface MatchOptions {
  /**
   * The IANA time zone a date in a filter on a date or date-and-time column is a whole day in, such as
   * "America/New_York". Left out, it is the browser's, read when the row is filtered.
   */
  timeZone?: string;
}

// The browser's time zone is read when rows are filtered, never kept from one moment to the next. Reading it costs
// as much as filtering a thousand rows, so it is read once for each run of filtering: kept until the current task
// ends, then read again.
let browserZone: string | undefined;
const defaultZone = (): string => {
  if (browserZone === undefined) {
    browserZone = calendarZone();
    queueMicrotask(() => {
      browserZone = undefined;
    });
  }
  return browserZone;
};

const DATE_KINDS: ReadonlySet<ColumnDescriptor["kind"]> = new Set(["date", "datetime"]);

/** Whether a comparison's sign keeps the row, for each operator that compares a date with one end. */
const DATE_TESTS: Partial<Record<FilterPredicate["operator"], (sign: number) => boolean>> = {
  eq: (sign) => sign === 0,
  gt: (sign) => sign > 0,
  gte: (sign) => sign >= 0,
  lt: (sign) => sign < 0,
  lte: (sign) => sign <= 0,
};
const ON_OR_AFTER = (sign: number) => sign >= 0;
const ON_OR_BEFORE = (sign: number) => sign <= 0;

/**
 * A comparison on a date or date-and-time column (named filters spec, 5.5; ADR 0026). A date in the filter means the
 * whole day in the time zone, so the cell is first turned into its day: a date string is that day; a `Date`, or a
 * string with a time and an offset, is the day that instant falls on in the zone; a string with a time and no offset
 * is its own date part. A cell that can't be read as a date matches no such filter. A filter value that holds a time
 * is compared as an instant. `undefined` for an operator that compares no date ("is empty").
 */
const matchesDate = (value: unknown, predicate: FilterPredicate, timeZone: () => string): boolean | undefined => {
  const target = predicate.value;
  let low: unknown;
  let lowTest: (sign: number) => boolean;
  let high: unknown;
  let highTest: ((sign: number) => boolean) | undefined;
  if (predicate.operator === "between") {
    if (typeof target !== "object" || target === null || Array.isArray(target)) return false;
    [low, lowTest, high, highTest] = [target.min, ON_OR_AFTER, target.max, ON_OR_BEFORE];
  } else {
    const test = DATE_TESTS[predicate.operator];
    if (!test) return undefined;
    [low, lowTest] = [target, test];
  }
  const zone = timeZone();
  // The cell is read once, as a day or as an instant, whichever the filter's ends need.
  let day: string | undefined | null = null;
  let instant: number | undefined | null = null;
  const sign = (end: unknown): number | undefined => {
    if (typeof end !== "string") return undefined;
    if (isDay(end)) {
      if (day === null) day = dayOfCell(value, zone);
      if (day === undefined) return undefined;
      // Two ISO dates in the years 0001 to 9999 sort as text.
      return day < end ? -1 : day > end ? 1 : 0;
    }
    const at = instantOfCell(end, zone);
    if (at === undefined) return undefined;
    if (instant === null) instant = instantOfCell(value, zone);
    if (instant === undefined) return undefined;
    return Math.sign(instant - at);
  };
  const first = sign(low);
  if (first === undefined || !lowTest(first)) return false;
  if (!highTest) return true;
  const second = sign(high);
  return second !== undefined && highTest(second);
};

/**
 * Evaluates one predicate against a cell value, using the column kind's semantics. On a date or date-and-time column a
 * date means the whole day in `options.timeZone`, or with none, the browser's time zone, read now.
 */
export const matchesPredicate = (
  value: unknown,
  predicate: FilterPredicate,
  column?: ColumnDescriptor,
  options?: MatchOptions,
): boolean => {
  if (column && DATE_KINDS.has(column.kind)) {
    const dated = matchesDate(value, predicate, () => options?.timeZone ?? defaultZone());
    if (dated !== undefined) return dated;
  }
  const target = predicate.value;
  const text = (v: unknown) => String(v ?? "").toLowerCase();
  const caseless = column?.kind === "string";
  const eq = (a: unknown, b: Scalar) => (caseless ? text(a) === text(b) : a === b);
  switch (predicate.operator) {
    case "isEmpty":
      return isEmpty(value);
    case "isNotEmpty":
      return !isEmpty(value);
    case "eq":
      return eq(value, target as Scalar);
    case "neq":
      return !eq(value, target as Scalar);
    case "in":
      return Array.isArray(target) && target.some((t) => eq(value, t));
    case "contains":
      return text(value).includes(text(target));
    case "startsWith":
      return text(value).startsWith(text(target));
    case "gt":
      return !isEmpty(value) && compare(value, target) > 0;
    case "gte":
      return !isEmpty(value) && compare(value, target) >= 0;
    case "lt":
      return !isEmpty(value) && compare(value, target) < 0;
    case "lte":
      return !isEmpty(value) && compare(value, target) <= 0;
    case "between": {
      const range = target as { min: Scalar; max: Scalar };
      return !isEmpty(value) && compare(value, range.min) >= 0 && compare(value, range.max) <= 0;
    }
  }
};

/**
 * Evaluates a filter tree against a row object keyed by column ID. A date in a filter means the whole day in the
 * schema's Calendar's time zone, or with none, the browser's, read when the row is filtered.
 */
export const matchesFilter = (row: Record<string, unknown>, filter: FilterGroup | null, schema: ViewSchema): boolean => {
  if (!filter) return true;
  const zone = schema.calendar?.timeZone;
  return matchesGroup(row, filter, schema, zone === undefined ? undefined : { timeZone: zone });
};

const matchesGroup = (row: Record<string, unknown>, filter: FilterGroup, schema: ViewSchema, options?: MatchOptions): boolean => {
  const results = filter.children.map((child) =>
    child.type === "group"
      ? matchesGroup(row, child, schema, options)
      : matchesPredicate(
          row[child.columnId],
          child,
          schema.columns.find((c) => c.id === child.columnId),
          options,
        ),
  );
  return filter.combinator === "and" ? results.every(Boolean) : results.some(Boolean);
};
