/**
 * Date arithmetic and whole days (named filters spec, 5.5; ADR 0026).
 *
 * A date form in a request ("last 90 days", "this quarter") becomes two fixed days, worked out once from today in the
 * Calendar's time zone. A cell becomes the day it is on, so a date in a filter means the whole day.
 *
 * A day here is an ISO date, "2026-11-13". All arithmetic is done on a day's year, month and day of the month. Nothing
 * adds hours or milliseconds to move a day, so a clock change can't shift one, and nothing reads the machine's own
 * time zone. `Intl.DateTimeFormat` is used for one thing: the day an instant falls on in a named time zone.
 */

/** A form's first and last day, both included. */
export interface DayRange {
  first: string;
  last: string;
}

/** The closed list of relative date forms, as the first table of the named filters spec's 5.5 has them. */
export type DateForm =
  | { kind: "day"; day: "today" | "yesterday" }
  | { kind: "last"; count: number; unit: "day" | "week" | "month" | "year" }
  | { kind: "period"; which: "this" | "last"; period: "month" | "quarter" | "year" }
  | { kind: "toDate"; period: "month" | "quarter" | "year" };

interface Ymd {
  y: number;
  m: number;
  d: number;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y: number, m: number): number => (m === 2 && isLeapYear(y) ? 29 : (MONTH_DAYS[m - 1] ?? 0));

/** Years 0001 to 9999 are the ones an ISO date can write with four digits. */
const isRealDay = (y: number, m: number, d: number): boolean =>
  y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);

/** The two digits at `at` as a number, or -1 when they are not both digits. */
const twoDigits = (text: string, at: number): number => {
  const tens = text.charCodeAt(at) - 48;
  const ones = text.charCodeAt(at + 1) - 48;
  return tens >= 0 && tens <= 9 && ones >= 0 && ones <= 9 ? tens * 10 + ones : -1;
};

const HYPHEN = 45;

/** Reads "2026-11-13" and nothing else. It is read by hand, not by a pattern: every cell of a date column passes here. */
const parseDay = (text: string): Ymd | undefined => {
  if (typeof text !== "string" || text.length !== 10 || text.charCodeAt(4) !== HYPHEN || text.charCodeAt(7) !== HYPHEN) return undefined;
  const century = twoDigits(text, 0);
  const year = twoDigits(text, 2);
  if (century < 0 || year < 0) return undefined;
  const [y, m, d] = [century * 100 + year, twoDigits(text, 5), twoDigits(text, 8)];
  return isRealDay(y, m, d) ? { y, m, d } : undefined;
};

const mustParse = (text: string): Ymd => {
  const day = parseDay(text);
  // The text is not put in the message: it may be a User's words.
  if (!day) throw new RangeError("A day is written like 2026-01-31, and must be a real one.");
  return day;
};

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

const formatDay = ({ y, m, d }: Ymd): string => {
  if (!isRealDay(y, m, d)) throw new RangeError("The day is outside the years 0001 to 9999.");
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
};

/** Whole days since 1970-01-01, counted from the year, month and day alone. */
const dayNumber = ({ y, m, d }: Ymd): number => {
  // The year is counted from March, so a leap day is its last day.
  const year = m <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
};

/** The day that is `n` whole days after 1970-01-01: `dayNumber` backwards. */
const dayFromNumber = (n: number): Ymd => {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthFromMarch = Math.floor((5 * dayOfYear + 2) / 153);
  const d = dayOfYear - Math.floor((153 * monthFromMarch + 2) / 5) + 1;
  const m = monthFromMarch < 10 ? monthFromMarch + 3 : monthFromMarch - 9;
  return { y: yearOfEra + era * 400 + (m <= 2 ? 1 : 0), m, d };
};

/** The month `count` months after (or, below zero, before) the month `y`-`m`. */
const monthFrom = (y: number, m: number, count: number): { y: number; m: number } => {
  const index = y * 12 + (m - 1) + count;
  return { y: Math.floor(index / 12), m: (((index % 12) + 12) % 12) + 1 };
};

/** The same day of the month, `count` months away. A month day that doesn't exist is that month's last day. */
const shiftMonths = ({ y, m, d }: Ymd, count: number): Ymd => {
  const to = monthFrom(y, m, count);
  return { ...to, d: Math.min(d, daysInMonth(to.y, to.m)) };
};

/** Whether the text is a real day written as an ISO date: "2026-02-28" is, "2026-02-30" is not. */
export const isDay = (text: string): boolean => parseDay(text) !== undefined;

/** The day `count` whole days after `day`, or before it when `count` is below zero. */
export const addDays = (day: string, count: number): string => {
  if (!Number.isInteger(count)) throw new RangeError("A count of days is a whole number.");
  return formatDay(dayFromNumber(dayNumber(mustParse(day)) + count));
};

/** How many whole days `to` is after `from`. Below zero when it is before. */
export const daysBetween = (from: string, to: string): number => dayNumber(mustParse(to)) - dayNumber(mustParse(from));

// --- An instant's day in a time zone ---------------------------------------------------------------------------

interface ZoneDays {
  format: Intl.DateTimeFormat;
  /** The clock on the wall there, to the second: built only when a time with no offset is read as an instant. */
  clock?: Intl.DateTimeFormat;
  /** The last instant asked about and its day: a range's two ends ask about the same cell one after the other. */
  lastAt: number;
  lastDay: string | undefined;
}

/** One formatter for each time zone, built the first time the zone is named and kept. */
const zones = new Map<string, ZoneDays>();

const zoneDays = (timeZone: string): ZoneDays => {
  const known = zones.get(timeZone);
  if (known) return known;
  // With no time zone, Intl would use the machine's. That must never happen silently.
  if (typeof timeZone !== "string" || timeZone === "") throw new RangeError("A time zone is an IANA name, such as America/New_York.");
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const made: ZoneDays = { format, lastAt: Number.NaN, lastDay: undefined };
  zones.set(timeZone, made);
  return made;
};

/**
 * The time zone a Calendar names, or with none, the browser's (spec 5.5). It is read each time it is needed, when a
 * request is read or a row is filtered, and never kept: a schema built on a server and used in a browser takes the
 * browser's.
 */
export const calendarZone = (calendar?: { timeZone?: string | undefined }): string =>
  calendar?.timeZone ?? (new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

/** Whether `timeZone` is a name the runtime knows, such as "America/New_York". */
export const isTimeZone = (timeZone: string): boolean => {
  try {
    zoneDays(timeZone);
    return true;
  } catch {
    return false;
  }
};

// 0001-01-02 and 9999-12-30 at midnight UTC and its last millisecond. An offset is under a day, so an instant
// between them is in the years 0001 to 9999 in every time zone.
const FIRST_INSTANT = -62135510400000;
const LAST_INSTANT = 253402214399999;

const SLASH = 47;

/** The day the instant `at` (milliseconds since 1970 UTC) falls on in the time zone, if it has one GridCue can write. */
const dayOfInstant = (at: number, timeZone: string): string | undefined => {
  const zone = zoneDays(timeZone);
  if (at === zone.lastAt) return zone.lastDay;
  if (!(at >= FIRST_INSTANT && at <= LAST_INSTANT)) return undefined;
  // The formatter writes the month, the day and the year: "11/13/2026", or "06/05/999" before the year 1000.
  // Anything else is not a day, and neither is a date `parseDay` refuses.
  const written = zone.format.format(at);
  const slashes = written.charCodeAt(2) === SLASH && written.charCodeAt(5) === SLASH;
  const day = slashes ? `${written.slice(6).padStart(4, "0")}-${written.slice(0, 2)}-${written.slice(3, 5)}` : "";
  const read = parseDay(day) ? day : undefined;
  zone.lastAt = at;
  zone.lastDay = read;
  return read;
};

/**
 * Today in a time zone: the day the clock's instant falls on there. It throws a `RangeError` for a clock that gives
 * no instant or one outside the years 0001 to 9999, and for a time zone the runtime doesn't know.
 */
export const todayIn = (now: Date, timeZone: string): string => {
  const day = dayOfInstant(now instanceof Date ? now.getTime() : Number.NaN, timeZone);
  if (day === undefined) throw new RangeError("The clock gave no day between the years 0001 and 9999.");
  return day;
};

// --- A date form's first and last day -------------------------------------------------------------------------

const FORM =
  /^(?:(today|yesterday)|(?:last|past) ([1-9]\d{0,2}) (day|week|month|year)(s?)|(this|last) (month|quarter|year)|(month|quarter|year) to date|([mqy])td)$/;

const PERIOD_OF_LETTER = { m: "month", q: "quarter", y: "year" } as const;

/**
 * Reads the words of one date form: "last 90 days", "this quarter", "YTD". The words are the whole form and nothing
 * else, in any letter case. A count is 1 to 999 in digits. Any other wording is not a form, "this week" and
 * "last week" included, and the caller asks.
 */
export const readDateForm = (words: string): DateForm | undefined => {
  if (typeof words !== "string") return undefined;
  const match = FORM.exec(words.trim().toLowerCase().replace(/\s+/g, " "));
  if (!match) return undefined;
  const [, day, count, unit, plural, which, period, toDate, letter] = match;
  if (day) return { kind: "day", day: day as "today" | "yesterday" };
  if (count && unit) {
    // "Last 1 day" and "last 2 days" are forms. "Last 2 day" is not.
    if (!plural && count !== "1") return undefined;
    return { kind: "last", count: Number(count), unit: unit as "day" | "week" | "month" | "year" };
  }
  if (which && period) return { kind: "period", which: which as "this" | "last", period: period as "month" | "quarter" | "year" };
  if (toDate) return { kind: "toDate", period: toDate as "month" | "quarter" | "year" };
  if (letter) return { kind: "toDate", period: PERIOD_OF_LETTER[letter as "m" | "q" | "y"] };
  return undefined;
};

const MONTHS_IN = { month: 1, quarter: 3, year: 12 } as const;

/** The first month of the month, quarter or year that holds `day`. Quarters and years start in `fiscalYearStart`. */
const periodStart = (period: "month" | "quarter" | "year", day: Ymd, fiscalYearStart: number): { y: number; m: number } => {
  if (period === "month") return { y: day.y, m: day.m };
  const sinceYearStart = (day.m - fiscalYearStart + 12) % 12;
  return monthFrom(day.y, day.m, -(period === "year" ? sinceYearStart : sinceYearStart % 3));
};

/**
 * The first and last day a form means, both included, given today and the first month of the Calendar's year.
 *
 * - Today, yesterday: that day.
 * - Last N days, weeks, months, years: from the day N units before today, through today. A week is 7 days. A month
 *   day that doesn't exist is that month's last day.
 * - This month, quarter, year: the whole period that holds today. Last: the whole period before it.
 * - To date: from the period's first day, through today.
 *
 * Quarters, years and their to-date forms start in `fiscalYearStart`, a month from 1 to 12. Months are calendar months.
 * It throws a `RangeError` for a today that is not a day, a first month that is not a month, a count outside 1 to 999,
 * and a day outside the years 0001 to 9999.
 */
export const datesOf = (form: DateForm, today: string, fiscalYearStart = 1): DayRange => {
  const t = mustParse(today);
  if (!Number.isInteger(fiscalYearStart) || fiscalYearStart < 1 || fiscalYearStart > 12) {
    throw new RangeError("The first month of the year is a whole number from 1 to 12.");
  }
  switch (form.kind) {
    case "day": {
      const day = form.day === "today" ? today : addDays(today, -1);
      return { first: day, last: day };
    }
    case "last": {
      const { count, unit } = form;
      if (!Number.isInteger(count) || count < 1 || count > 999) throw new RangeError("A count is a whole number from 1 to 999.");
      if (unit === "day") return { first: addDays(today, -count), last: today };
      if (unit === "week") return { first: addDays(today, -7 * count), last: today };
      return { first: formatDay(shiftMonths(t, -(unit === "year" ? 12 * count : count))), last: today };
    }
    case "period": {
      const months = MONTHS_IN[form.period];
      const here = periodStart(form.period, t, fiscalYearStart);
      const start = form.which === "this" ? here : monthFrom(here.y, here.m, -months);
      const end = monthFrom(start.y, start.m, months - 1);
      return { first: formatDay({ ...start, d: 1 }), last: formatDay({ ...end, d: daysInMonth(end.y, end.m) }) };
    }
    case "toDate":
      return { first: formatDay({ ...periodStart(form.period, t, fiscalYearStart), d: 1 }), last: today };
  }
};

// --- A cell's day ---------------------------------------------------------------------------------------------

// What may follow a date: a time, then perhaps an offset. "T15:00", " 15:00:00.000Z", "T15:00:00+05:30". The offset
// is "Z", or hours with or without minutes.
const TIME = /^[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?)?$/;

/**
 * The day a cell is on, or `undefined` for a cell that can't be read as a date. Such a cell matches no date filter.
 *
 * - A date string is that day.
 * - A `Date`, or a string with a time and an offset, is the day that instant falls on in the time zone.
 * - A string with a time and no offset is its own date part.
 *
 * It throws a `RangeError` for a time zone the runtime doesn't know.
 */
export const dayOfCell = (value: unknown, timeZone: string): string | undefined => {
  if (value instanceof Date) return dayOfInstant(value.getTime(), timeZone);
  // An unknown time zone throws for every cell, not only for the ones that need it.
  if (!zones.has(timeZone)) zoneDays(timeZone);
  const stamp = readStamp(value);
  if (!stamp) return undefined;
  if (stamp.time === undefined || stamp.offset === undefined) return stamp.date;
  return dayOfInstant(stamp.time - stamp.offset * 60_000, timeZone);
};

/** A date string read: its day, and when it has one, its time on the clock and its offset in minutes. */
interface Stamp {
  date: string;
  /** The date and time on the clock, counted as if it were UTC, in milliseconds since 1970. */
  time?: number;
  offset?: number;
}

/** Reads "2026-11-13", "2026-11-13T15:00", "2026-11-13T15:00:00.000Z" or "2026-11-13 10:00-05:00", and nothing else. */
const readStamp = (value: unknown): Stamp | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const date = text.length === 10 ? text : text.slice(0, 10);
  const day = parseDay(date);
  if (!day) return undefined;
  if (text.length === 10) return { date };
  const time = TIME.exec(text.slice(10));
  if (!time) return undefined;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = time[3] === undefined ? 0 : Number(time[3]);
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const sign = time[6];
  const offsetHours = sign === undefined ? 0 : Number(time[7]);
  const offsetMinutes = time[8] === undefined ? 0 : Number(time[8]);
  if (offsetHours > 23 || offsetMinutes > 59) return undefined;
  const millisecond = time[4] === undefined ? 0 : Number(time[4].slice(0, 3).padEnd(3, "0"));
  // The time on the clock from its own fields. `Date.UTC` reads a year below 100 as 1900 and up, so the year is set
  // on its own.
  const clock = new Date(0);
  clock.setUTCFullYear(day.y, day.m - 1, day.d);
  clock.setUTCHours(hour, minute, second, millisecond);
  const stamp: Stamp = { date, time: clock.getTime() };
  if (time[5] !== undefined || sign !== undefined) stamp.offset = (sign === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  return stamp;
};

/** How far the clock in the time zone is ahead of UTC at the instant `at`, in milliseconds. */
const zoneOffsetAt = (at: number, timeZone: string): number => {
  const zone = zoneDays(timeZone);
  zone.clock ??= new Intl.DateTimeFormat("en-US", {
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
  const parts: Record<string, number> = {};
  for (const part of zone.clock.formatToParts(at)) parts[part.type] = Number(part.value);
  const wall = new Date(0);
  wall.setUTCFullYear(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1);
  wall.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, 0);
  const whole = at - (((at % 1000) + 1000) % 1000);
  return wall.getTime() - whole;
};

/**
 * The instant a cell or a filter value names, in milliseconds since 1970 UTC, or `undefined` when it names none.
 *
 * - A `Date` is its instant.
 * - A string with a time and an offset is the instant it writes.
 * - A string with a time and no offset is the moment the clock in the time zone shows that time. A time the clock
 *   skips or shows twice on a clock-change day takes one of the instants either side.
 * - A date with no time is a whole day, not an instant, and so is not read here.
 *
 * GridCue never writes a time into a filter from a request. A Host's own View State may hold one, and it is compared
 * as an instant. It throws a `RangeError` for a time zone the runtime doesn't know.
 */
export const instantOfCell = (value: unknown, timeZone: string): number | undefined => {
  if (!zones.has(timeZone)) zoneDays(timeZone);
  if (value instanceof Date) {
    const at = value.getTime();
    return Number.isNaN(at) ? undefined : at;
  }
  const stamp = readStamp(value);
  if (stamp?.time === undefined) return undefined;
  if (stamp.offset !== undefined) return stamp.time - stamp.offset * 60_000;
  // The clock's time read as UTC, less the zone's offset there; read the offset again at that instant, since a
  // clock change between the two moves it.
  const first = zoneOffsetAt(stamp.time, timeZone);
  const second = zoneOffsetAt(stamp.time - first, timeZone);
  return stamp.time - second;
};
