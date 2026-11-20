// A plain, slow reference day counter for named filters spec 5.5 and ADR 0026.
// Held out: written by the Task 5.1 labeller, never shown to the builder. It shares
// no code with the package. Every calendar day from 1000-01-01 to 2300-12-31 is
// counted one at a time with the Gregorian rules written out, and all day
// arithmetic is a step along that list. Periods are found by walking day by day.
// An instant's day in a time zone comes from Intl.DateTimeFormat's parts, and
// nothing else here touches a clock or the machine's own time zone.

export type IsoDay = string;
export interface DayRange {
  first: IsoDay;
  last: IsoDay;
}

// ---- The Gregorian calendar, written out ----

const isLeapYear = (year: number): boolean => {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
};

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
};

const pad = (n: number, width: number): string => String(n).padStart(width, "0");
const isoOf = (year: number, month: number, day: number): IsoDay => `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;

const FIRST_YEAR = 1000;
const LAST_YEAR = 2300;
const ALL_DAYS: IsoDay[] = [];
const INDEX = new Map<IsoDay, number>();
{
  let year = FIRST_YEAR;
  let month = 1;
  let day = 1;
  while (year <= LAST_YEAR) {
    const iso = isoOf(year, month, day);
    INDEX.set(iso, ALL_DAYS.length);
    ALL_DAYS.push(iso);
    day += 1;
    if (day > daysInMonth(year, month)) {
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }
}
const EPOCH_INDEX = INDEX.get("1970-01-01") as number;

const indexOf = (iso: IsoDay): number => {
  const i = INDEX.get(iso);
  if (i === undefined) throw new Error(`reference-days: not a day it counts: ${iso}`);
  return i;
};

/** True when the text is an ISO day that exists on the Gregorian calendar, within the counted years. */
export const isDay = (iso: string): boolean => INDEX.has(iso);

/** The day n days after (or before, for a negative n) the given day, counted one step at a time. */
export const addDays = (iso: IsoDay, n: number): IsoDay => {
  let i = indexOf(iso);
  const step = n < 0 ? -1 : 1;
  for (let k = 0; k !== n; k += step) i += step;
  const out = ALL_DAYS[i];
  if (out === undefined) throw new Error(`reference-days: ${iso} + ${n} is outside the counted years`);
  return out;
};

const partsOf = (iso: IsoDay) => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) });

/** The same day number n months before; a day the month doesn't have is that month's last day. */
const monthsBefore = (iso: IsoDay, n: number): IsoDay => {
  let { year, month, day } = partsOf(iso);
  for (let k = 0; k < n; k += 1) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return isoOf(year, month, Math.min(day, daysInMonth(year, month)));
};

// ---- Today ----

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
};

const dayOfInstant = (ms: number, timeZone: string): IsoDay => {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: string) => {
    const p = parts.find((x) => x.type === type);
    if (!p) throw new Error(`reference-days: no ${type} part`);
    return Number(p.value);
  };
  return isoOf(get("year"), get("month"), get("day"));
};

/** The day an instant falls on in the time zone. */
export const today = (instant: Date | number | string, timeZone: string): IsoDay => {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === "number" ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) throw new Error(`reference-days: not an instant: ${String(instant)}`);
  return dayOfInstant(ms, timeZone);
};

// ---- Periods, by walking ----

type Period = "month" | "quarter" | "year";

const startsPeriod = (iso: IsoDay, period: Period, fiscalYearStart: number): boolean => {
  const { month, day } = partsOf(iso);
  if (day !== 1) return false;
  if (period === "month") return true;
  const monthsIntoYear = (month - fiscalYearStart + 12) % 12;
  if (period === "quarter") return monthsIntoYear % 3 === 0;
  return monthsIntoYear === 0;
};

const periodStart = (iso: IsoDay, period: Period, fiscalYearStart: number): IsoDay => {
  let d = iso;
  while (!startsPeriod(d, period, fiscalYearStart)) d = addDays(d, -1);
  return d;
};

const periodEnd = (iso: IsoDay, period: Period, fiscalYearStart: number): IsoDay => {
  let d = iso;
  while (!startsPeriod(addDays(d, 1), period, fiscalYearStart)) d = addDays(d, 1);
  return d;
};

const wholePeriod = (iso: IsoDay, period: Period, fiscalYearStart: number): DayRange => ({
  first: periodStart(iso, period, fiscalYearStart),
  last: periodEnd(iso, period, fiscalYearStart),
});

// ---- Forms ----

/** Every form spec 5.5's first table lists, other than a range of two ISO dates. */
export const FORM_KINDS = [
  "today",
  "yesterday",
  "last N days",
  "past N days",
  "last N weeks",
  "past N weeks",
  "last N months",
  "past N months",
  "last N years",
  "past N years",
  "this month",
  "this quarter",
  "this year",
  "last month",
  "last quarter",
  "last year",
  "month to date",
  "quarter to date",
  "year to date",
  "MTD",
  "QTD",
  "YTD",
] as const;

/**
 * The first and last day a form means, both included, for a given today.
 * `form` is the form's words, such as "last 90 days" or "YTD". N is 1 to 999 in digits;
 * "last 1 day" and "last 1 days" are both read. Throws on words that are not a form.
 */
export const range = (form: string, todayIso: IsoDay, fiscalYearStart = 1): DayRange => {
  if (!Number.isInteger(fiscalYearStart) || fiscalYearStart < 1 || fiscalYearStart > 12) {
    throw new Error(`reference-days: fiscalYearStart must be 1 to 12: ${fiscalYearStart}`);
  }
  indexOf(todayIso);
  const words = form.trim().toLowerCase().replace(/\s+/g, " ");
  const T = todayIso;

  const relative = /^(last|past) ([1-9][0-9]{0,2}) (days?|weeks?|months?|years?)$/.exec(words);
  if (relative) {
    const n = Number(relative[2]);
    const unit = (relative[3] ?? "").replace(/s$/, "");
    if (unit === "day") return { first: addDays(T, -n), last: T };
    if (unit === "week") return { first: addDays(T, -7 * n), last: T };
    if (unit === "month") return { first: monthsBefore(T, n), last: T };
    return { first: monthsBefore(T, 12 * n), last: T };
  }

  switch (words) {
    case "today":
      return { first: T, last: T };
    case "yesterday": {
      const y = addDays(T, -1);
      return { first: y, last: y };
    }
    case "this month":
      return wholePeriod(T, "month", fiscalYearStart);
    case "this quarter":
      return wholePeriod(T, "quarter", fiscalYearStart);
    case "this year":
      return wholePeriod(T, "year", fiscalYearStart);
    case "last month":
      return wholePeriod(addDays(periodStart(T, "month", fiscalYearStart), -1), "month", fiscalYearStart);
    case "last quarter":
      return wholePeriod(addDays(periodStart(T, "quarter", fiscalYearStart), -1), "quarter", fiscalYearStart);
    case "last year":
      return wholePeriod(addDays(periodStart(T, "year", fiscalYearStart), -1), "year", fiscalYearStart);
    case "month to date":
    case "mtd":
      return { first: periodStart(T, "month", fiscalYearStart), last: T };
    case "quarter to date":
    case "qtd":
      return { first: periodStart(T, "quarter", fiscalYearStart), last: T };
    case "year to date":
    case "ytd":
      return { first: periodStart(T, "year", fiscalYearStart), last: T };
  }
  throw new Error(`reference-days: not a form: ${form}`);
};

/** "between A and B" with two ISO days: both ends included; written high to low, the ends are swapped. */
export const between = (a: IsoDay, b: IsoDay): DayRange => {
  indexOf(a);
  indexOf(b);
  return indexOf(a) <= indexOf(b) ? { first: a, last: b } : { first: b, last: a };
};

// ---- A cell's day ----

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * The day a cell means in the time zone, or undefined when it can't be read as a date.
 * A date string is that day. A Date, or a string with a time and an offset, is the day
 * its instant falls on in the time zone. A string with a time and no offset is its own
 * date part. Anything else (numbers, other text, a day that doesn't exist) is unreadable.
 */
export const dayOf = (cell: unknown, timeZone: string): IsoDay | undefined => {
  if (cell instanceof Date) {
    const ms = cell.getTime();
    return Number.isFinite(ms) ? dayOfInstant(ms, timeZone) : undefined;
  }
  if (typeof cell !== "string") return undefined;

  const dateOnly = DATE_ONLY.exec(cell);
  if (dateOnly) return isDay(cell) ? cell : undefined;

  const dt = DATE_TIME.exec(cell);
  if (!dt) return undefined;
  const iso = `${dt[1]}-${dt[2]}-${dt[3]}`;
  if (!isDay(iso)) return undefined;
  const hour = Number(dt[4]);
  const minute = Number(dt[5]);
  const second = dt[6] === undefined ? 0 : Number(dt[6]);
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const offsetText = dt[8];
  if (offsetText === undefined) return iso;

  let offsetMinutes = 0;
  if (offsetText !== "Z" && offsetText !== "z") {
    const sign = offsetText[0] === "-" ? -1 : 1;
    const digits = offsetText.slice(1).replace(":", "");
    const oh = Number(digits.slice(0, 2));
    const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (oh > 23 || om > 59) return undefined;
    offsetMinutes = sign * (oh * 60 + om);
  }
  const fraction = dt[7] === undefined ? 0 : Number(`0.${dt[7]}`) * 1000;
  const epochDays = indexOf(iso) - EPOCH_INDEX;
  const ms = epochDays * 86_400_000 + hour * 3_600_000 + minute * 60_000 + second * 1000 + Math.floor(fraction) - offsetMinutes * 60_000;
  return dayOfInstant(ms, timeZone);
};

/** True when the day is within the range, both ends included. */
export const inRange = (day: IsoDay, r: DayRange): boolean => indexOf(day) >= indexOf(r.first) && indexOf(day) <= indexOf(r.last);

/** For property tests: the n-th counted day, and the index of a day. */
export const dayAt = (i: number): IsoDay => {
  const d = ALL_DAYS[i];
  if (d === undefined) throw new Error(`reference-days: no day at ${i}`);
  return d;
};
export const dayIndex = (iso: IsoDay): number => indexOf(iso);
