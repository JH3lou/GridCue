import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, type DateForm, datesOf, dayOfCell, daysBetween, isDay, isTimeZone, readDateForm, todayIn } from "../src/core/dates";

// Date arithmetic and whole days (named filters spec, 5.5; ADR 0026). A date form becomes two fixed days, worked out
// on calendar days from today in the Calendar's time zone. A cell becomes its day. Nothing here may read the
// machine's own time zone: this file passes with TZ set to UTC, America/New_York and Pacific/Auckland.

const ZONES = ["UTC", "America/New_York", "America/St_Johns", "Europe/London", "Asia/Kolkata", "Pacific/Auckland"] as const;

/** A fixed-seed random number generator (mulberry32), so every run draws the same days and instants. */
const seeded = (seed: number) => {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const intIn = (rand: () => number, low: number, high: number): number => low + Math.floor(rand() * (high - low + 1));

// The test's own day counter. It steps a UTC `Date`, which the module never does, so the two can't share a mistake.
const utcDay = (date: Date): string => date.toISOString().slice(0, 10);
const stepDays = (day: string, count: number): string => {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return utcDay(date);
};
const partsOf = (day: string) => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), date: Number(day.slice(8, 10)) });
const lastDateOf = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** Months counted from year 0, so two days' months can be subtracted. */
const monthIndex = (day: string): number => partsOf(day).year * 12 + partsOf(day).month - 1;

const form = (words: string): DateForm => {
  const read = readDateForm(words);
  if (!read) throw new Error(`"${words}" is not read as a date form`);
  return read;
};
const dates = (words: string, today: string, fiscalYearStart = 1): [string, string] => {
  const range = datesOf(form(words), today, fiscalYearStart);
  return [range.first, range.last];
};

describe("the labelled table (evals/dates-table.json)", () => {
  const table = JSON.parse(readFileSync(new URL("../../../evals/dates-table.json", import.meta.url), "utf8")) as {
    columns: string[];
    timeZones: string[];
    rows: [instant: string, timeZone: string, fiscalYearStart: number, form: string, first: string, last: string][];
  };

  it("holds the rows this test expects", () => {
    expect(table.columns).toEqual(["instant", "timeZone", "fiscalYearStart", "form", "first", "last"]);
    expect(table.timeZones).toEqual([...ZONES]);
    expect(table.rows.length).toBe(3206);
  });

  it("every form in it is read", () => {
    const unread = [...new Set(table.rows.map((row) => row[3]))].filter((words) => !readDateForm(words));
    expect(unread).toEqual([]);
  });

  for (const zone of ZONES) {
    it(`every row in ${zone} gives its first and last day`, () => {
      const rows = table.rows.filter((row) => row[1] === zone);
      expect(rows.length).toBeGreaterThan(400);
      const wrong: string[] = [];
      for (const [instant, timeZone, fiscalYearStart, words, first, last] of rows) {
        const today = todayIn(new Date(instant), timeZone);
        const got = dates(words, today, fiscalYearStart);
        if (got[0] !== first || got[1] !== last) {
          wrong.push(`${instant} ${timeZone} fiscal ${fiscalYearStart} "${words}": ${got.join(" to ")}, labelled ${first} to ${last}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});

describe("today in a time zone", () => {
  it("is the fixed clock's day in New York", () => {
    expect(todayIn(new Date("2026-11-13T15:00:00.000Z"), "America/New_York")).toBe("2026-11-13");
  });

  // Each row: the last millisecond of one day and the first of the next, in that zone.
  const midnights: [zone: string, before: string, after: string, day: string][] = [
    ["UTC", "2026-11-12T23:59:59.999Z", "2026-11-13T00:00:00.000Z", "2026-11-13"],
    ["America/New_York", "2026-11-13T04:59:59.999Z", "2026-11-13T05:00:00.000Z", "2026-11-13"],
    ["America/New_York", "2026-07-04T03:59:59.999Z", "2026-07-04T04:00:00.000Z", "2026-07-04"],
    ["America/St_Johns", "2026-11-13T03:29:59.999Z", "2026-11-13T03:30:00.000Z", "2026-11-13"],
    ["America/St_Johns", "2026-07-04T02:29:59.999Z", "2026-07-04T02:30:00.000Z", "2026-07-04"],
    ["Europe/London", "2026-11-12T23:59:59.999Z", "2026-11-13T00:00:00.000Z", "2026-11-13"],
    ["Europe/London", "2026-07-03T22:59:59.999Z", "2026-07-03T23:00:00.000Z", "2026-07-04"],
    ["Asia/Kolkata", "2026-11-12T18:29:59.999Z", "2026-11-12T18:30:00.000Z", "2026-11-13"],
    ["Pacific/Auckland", "2026-11-12T10:59:59.999Z", "2026-11-12T11:00:00.000Z", "2026-11-13"],
    ["Pacific/Auckland", "2026-07-03T11:59:59.999Z", "2026-07-03T12:00:00.000Z", "2026-07-04"],
    // The year turns.
    ["America/New_York", "2027-01-01T04:59:59.999Z", "2027-01-01T05:00:00.000Z", "2027-01-01"],
    ["Pacific/Auckland", "2026-12-31T10:59:59.999Z", "2026-12-31T11:00:00.000Z", "2027-01-01"],
    // A leap day starts and ends.
    ["Asia/Kolkata", "2028-02-28T18:29:59.999Z", "2028-02-28T18:30:00.000Z", "2028-02-29"],
    ["Asia/Kolkata", "2028-02-29T18:29:59.999Z", "2028-02-29T18:30:00.000Z", "2028-03-01"],
  ];
  for (const [zone, before, after, day] of midnights) {
    it(`${zone}: ${day} starts at ${after}`, () => {
      expect(todayIn(new Date(before), zone)).toBe(stepDays(day, -1));
      expect(todayIn(new Date(after), zone)).toBe(day);
    });
  }

  it("a clock-change day is 23 or 25 hours long, and still one day", () => {
    // New York, 2026-03-08: clocks go forward. The day starts at 05:00Z and ends 23 hours later.
    expect(todayIn(new Date("2026-03-08T04:59:59.999Z"), "America/New_York")).toBe("2026-03-07");
    expect(todayIn(new Date("2026-03-08T05:00:00.000Z"), "America/New_York")).toBe("2026-03-08");
    expect(todayIn(new Date("2026-03-09T03:59:59.999Z"), "America/New_York")).toBe("2026-03-08");
    expect(todayIn(new Date("2026-03-09T04:00:00.000Z"), "America/New_York")).toBe("2026-03-09");
    // New York, 2026-11-01: clocks go back. The day starts at 04:00Z and ends 25 hours later.
    expect(todayIn(new Date("2026-11-01T03:59:59.999Z"), "America/New_York")).toBe("2026-10-31");
    expect(todayIn(new Date("2026-11-01T04:00:00.000Z"), "America/New_York")).toBe("2026-11-01");
    expect(todayIn(new Date("2026-11-02T04:59:59.999Z"), "America/New_York")).toBe("2026-11-01");
    expect(todayIn(new Date("2026-11-02T05:00:00.000Z"), "America/New_York")).toBe("2026-11-02");
    // Auckland, 2026-09-27: clocks go forward. 2026-04-05: clocks go back.
    expect(todayIn(new Date("2026-09-27T10:59:59.999Z"), "Pacific/Auckland")).toBe("2026-09-27");
    expect(todayIn(new Date("2026-09-27T11:00:00.000Z"), "Pacific/Auckland")).toBe("2026-09-28");
    expect(todayIn(new Date("2026-04-05T11:59:59.999Z"), "Pacific/Auckland")).toBe("2026-04-05");
    expect(todayIn(new Date("2026-04-05T12:00:00.000Z"), "Pacific/Auckland")).toBe("2026-04-06");
  });

  it("reads days long ago on the same calendar", () => {
    expect(todayIn(new Date("1582-10-10T12:00:00.000Z"), "UTC")).toBe("1582-10-10");
    expect(todayIn(new Date("0999-06-05T12:00:00.000Z"), "UTC")).toBe("0999-06-05");
  });

  it("throws for a clock that gives no instant, or one outside the years 0001 to 9999", () => {
    expect(() => todayIn(new Date(Number.NaN), "UTC")).toThrow(RangeError);
    expect(() => todayIn(new Date(Date.UTC(-5, 0, 1)), "UTC")).toThrow(RangeError);
    expect(() => todayIn(new Date(8.64e15), "UTC")).toThrow(RangeError);
  });

  it("throws for a time zone it doesn't know, and never falls back to the machine's", () => {
    expect(() => todayIn(new Date("2026-11-13T15:00:00.000Z"), "Mars/Olympus_Mons")).toThrow(RangeError);
    expect(() => todayIn(new Date("2026-11-13T15:00:00.000Z"), "")).toThrow(RangeError);
    expect(() => todayIn(new Date("2026-11-13T15:00:00.000Z"), undefined as unknown as string)).toThrow(RangeError);
  });

  it("says whether a time zone's name is one it knows", () => {
    for (const zone of ZONES) expect(isTimeZone(zone)).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone(undefined as unknown as string)).toBe(false);
    expect(isTimeZone(5 as unknown as string)).toBe(false);
  });
});

describe("reading a date form's words", () => {
  it("reads each form in the spec's table", () => {
    expect(readDateForm("today")).toEqual({ kind: "day", day: "today" });
    expect(readDateForm("yesterday")).toEqual({ kind: "day", day: "yesterday" });
    expect(readDateForm("last 90 days")).toEqual({ kind: "last", count: 90, unit: "day" });
    expect(readDateForm("past 90 days")).toEqual({ kind: "last", count: 90, unit: "day" });
    expect(readDateForm("last 2 weeks")).toEqual({ kind: "last", count: 2, unit: "week" });
    expect(readDateForm("past 6 months")).toEqual({ kind: "last", count: 6, unit: "month" });
    expect(readDateForm("last 999 years")).toEqual({ kind: "last", count: 999, unit: "year" });
    expect(readDateForm("this month")).toEqual({ kind: "period", which: "this", period: "month" });
    expect(readDateForm("this quarter")).toEqual({ kind: "period", which: "this", period: "quarter" });
    expect(readDateForm("this year")).toEqual({ kind: "period", which: "this", period: "year" });
    expect(readDateForm("last month")).toEqual({ kind: "period", which: "last", period: "month" });
    expect(readDateForm("last quarter")).toEqual({ kind: "period", which: "last", period: "quarter" });
    expect(readDateForm("last year")).toEqual({ kind: "period", which: "last", period: "year" });
    expect(readDateForm("month to date")).toEqual({ kind: "toDate", period: "month" });
    expect(readDateForm("quarter to date")).toEqual({ kind: "toDate", period: "quarter" });
    expect(readDateForm("year to date")).toEqual({ kind: "toDate", period: "year" });
    expect(readDateForm("MTD")).toEqual({ kind: "toDate", period: "month" });
    expect(readDateForm("QTD")).toEqual({ kind: "toDate", period: "quarter" });
    expect(readDateForm("YTD")).toEqual({ kind: "toDate", period: "year" });
  });

  it("reads any letter case and any space between the words", () => {
    expect(readDateForm("Last  90\tDays")).toEqual({ kind: "last", count: 90, unit: "day" });
    expect(readDateForm(" ytd ")).toEqual({ kind: "toDate", period: "year" });
    expect(readDateForm("Year To Date")).toEqual({ kind: "toDate", period: "year" });
  });

  it("reads one unit in the singular, and only one", () => {
    expect(readDateForm("last 1 day")).toEqual({ kind: "last", count: 1, unit: "day" });
    expect(readDateForm("past 1 week")).toEqual({ kind: "last", count: 1, unit: "week" });
    expect(readDateForm("last 1 days")).toEqual({ kind: "last", count: 1, unit: "day" });
    expect(readDateForm("last 2 day")).toBeUndefined();
    expect(readDateForm("last 90 day")).toBeUndefined();
  });

  it("reads nothing else: every other wording is left for a question", () => {
    const others = [
      "this week",
      "last week",
      "next week",
      "this day",
      "last day",
      "last days",
      "past month",
      "past year",
      "past quarter",
      "last 0 days",
      "last 1000 days",
      "last 090 days",
      "last 07 days",
      "last -3 days",
      "last 1.5 years",
      "last ninety days",
      "last 3 quarters",
      "past 2 quarters",
      "next 7 days",
      "next month",
      "90 days ago",
      "last 90 days ago",
      "the last 90 days",
      "in the last 90 days",
      "last 90",
      "90 days",
      "week to date",
      "wtd",
      "day to date",
      "year to day",
      "ytd 2026",
      "this fiscal year",
      "tomorrow",
      "today yesterday",
      "recent",
      "q1",
      "2026",
      "",
      " ",
    ];
    expect(others.filter((words) => readDateForm(words) !== undefined)).toEqual([]);
  });
});

describe("a date form's first and last day", () => {
  // The spec's own examples: today is 2026-11-13 and the year starts in January.
  const T = "2026-11-13";

  it("gives the spec's examples", () => {
    expect(dates("today", T)).toEqual(["2026-11-13", "2026-11-13"]);
    expect(dates("yesterday", T)).toEqual(["2026-11-12", "2026-11-12"]);
    expect(dates("last 90 days", T)).toEqual(["2026-08-15", "2026-11-13"]);
    expect(dates("this quarter", T)).toEqual(["2026-10-01", "2026-12-31"]);
    expect(dates("last quarter", T)).toEqual(["2026-07-01", "2026-09-30"]);
    expect(dates("YTD", T)).toEqual(["2026-01-01", "2026-11-13"]);
  });

  it("a week is 7 days", () => {
    expect(dates("last 1 week", T)).toEqual(["2026-11-06", "2026-11-13"]);
    expect(dates("last 2 weeks", T)).toEqual(["2026-10-30", "2026-11-13"]);
    expect(dates("past 13 weeks", T)).toEqual(["2026-08-14", "2026-11-13"]);
  });

  it("months and years keep the day of the month", () => {
    expect(dates("last 1 month", T)).toEqual(["2026-10-13", "2026-11-13"]);
    expect(dates("last 11 months", T)).toEqual(["2025-12-13", "2026-11-13"]);
    expect(dates("past 12 months", T)).toEqual(["2025-11-13", "2026-11-13"]);
    expect(dates("last 2 years", T)).toEqual(["2024-11-13", "2026-11-13"]);
  });

  it("a month day that doesn't exist is that month's last day", () => {
    expect(dates("last 1 month", "2026-03-31")).toEqual(["2026-02-28", "2026-03-31"]);
    expect(dates("last 1 month", "2028-03-31")).toEqual(["2028-02-29", "2028-03-31"]);
    expect(dates("last 1 month", "2026-05-31")).toEqual(["2026-04-30", "2026-05-31"]);
    expect(dates("last 6 months", "2026-08-31")).toEqual(["2026-02-28", "2026-08-31"]);
    expect(dates("last 13 months", "2026-10-31")).toEqual(["2025-09-30", "2026-10-31"]);
    expect(dates("last 1 year", "2028-02-29")).toEqual(["2027-02-28", "2028-02-29"]);
    expect(dates("last 4 years", "2028-02-29")).toEqual(["2024-02-29", "2028-02-29"]);
    expect(dates("last 28 years", "2128-02-29")).toEqual(["2100-02-28", "2128-02-29"]);
  });

  it("days cross a month end, a leap day and a year end", () => {
    expect(dates("yesterday", "2026-03-01")).toEqual(["2026-02-28", "2026-02-28"]);
    expect(dates("yesterday", "2028-03-01")).toEqual(["2028-02-29", "2028-02-29"]);
    expect(dates("yesterday", "2027-01-01")).toEqual(["2026-12-31", "2026-12-31"]);
    expect(dates("last 1 day", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
    expect(dates("last 365 days", "2028-12-31")).toEqual(["2028-01-01", "2028-12-31"]);
    expect(dates("last 365 days", "2026-12-31")).toEqual(["2025-12-31", "2026-12-31"]);
    expect(dates("last 999 days", T)).toEqual([stepDays(T, -999), T]);
  });

  it("gives the whole month, quarter and year, and the one before", () => {
    expect(dates("this month", T)).toEqual(["2026-11-01", "2026-11-30"]);
    expect(dates("last month", T)).toEqual(["2026-10-01", "2026-10-31"]);
    expect(dates("this month", "2028-02-10")).toEqual(["2028-02-01", "2028-02-29"]);
    expect(dates("last month", "2026-01-15")).toEqual(["2025-12-01", "2025-12-31"]);
    expect(dates("last month", "2026-03-31")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(dates("this year", T)).toEqual(["2026-01-01", "2026-12-31"]);
    expect(dates("last year", T)).toEqual(["2025-01-01", "2025-12-31"]);
    expect(dates("last quarter", "2026-02-10")).toEqual(["2025-10-01", "2025-12-31"]);
    expect(dates("this quarter", "2026-04-01")).toEqual(["2026-04-01", "2026-06-30"]);
    expect(dates("last quarter", "2026-04-01")).toEqual(["2026-01-01", "2026-03-31"]);
  });

  it("gives a period to date", () => {
    expect(dates("month to date", T)).toEqual(["2026-11-01", T]);
    expect(dates("MTD", T)).toEqual(["2026-11-01", T]);
    expect(dates("quarter to date", T)).toEqual(["2026-10-01", T]);
    expect(dates("QTD", T)).toEqual(["2026-10-01", T]);
    expect(dates("year to date", T)).toEqual(["2026-01-01", T]);
    expect(dates("QTD", "2026-10-01")).toEqual(["2026-10-01", "2026-10-01"]);
  });

  it("years, quarters and their to-date forms follow the year's first month", () => {
    // The year starts in April: 2026-04-01 to 2027-03-31, and 2026-11-13 is in its third quarter.
    expect(dates("this year", T, 4)).toEqual(["2026-04-01", "2027-03-31"]);
    expect(dates("last year", T, 4)).toEqual(["2025-04-01", "2026-03-31"]);
    expect(dates("YTD", T, 4)).toEqual(["2026-04-01", T]);
    expect(dates("this quarter", T, 4)).toEqual(["2026-10-01", "2026-12-31"]);
    expect(dates("this year", "2026-03-31", 4)).toEqual(["2025-04-01", "2026-03-31"]);
    expect(dates("this year", "2026-04-01", 4)).toEqual(["2026-04-01", "2027-03-31"]);
    // The year starts in February: quarters start in February, May, August and November.
    expect(dates("this quarter", T, 2)).toEqual(["2026-11-01", "2027-01-31"]);
    expect(dates("last quarter", T, 2)).toEqual(["2026-08-01", "2026-10-31"]);
    expect(dates("QTD", T, 2)).toEqual(["2026-11-01", T]);
    expect(dates("this quarter", "2026-01-15", 2)).toEqual(["2025-11-01", "2026-01-31"]);
    expect(dates("this year", "2026-01-15", 2)).toEqual(["2025-02-01", "2026-01-31"]);
    expect(dates("this year", "2028-02-01", 2)).toEqual(["2028-02-01", "2029-01-31"]);
    // The year starts in December, and ends on a leap day when it starts in March.
    expect(dates("this year", T, 12)).toEqual(["2025-12-01", "2026-11-30"]);
    expect(dates("this quarter", T, 12)).toEqual(["2026-09-01", "2026-11-30"]);
    expect(dates("this year", "2027-06-01", 3)).toEqual(["2027-03-01", "2028-02-29"]);
    expect(dates("this quarter", "2028-01-10", 3)).toEqual(["2027-12-01", "2028-02-29"]);
    // A month is a calendar month whatever the year's first month is.
    expect(dates("this month", T, 4)).toEqual(["2026-11-01", "2026-11-30"]);
    expect(dates("MTD", T, 7)).toEqual(["2026-11-01", T]);
  });

  it("the year starts in January unless told otherwise", () => {
    expect(datesOf(form("this year"), T)).toEqual({ first: "2026-01-01", last: "2026-12-31" });
  });

  it("throws for a today that is not a day, a year's first month that is not a month, or a count out of range", () => {
    expect(() => datesOf(form("today"), "2026-02-30")).toThrow(RangeError);
    expect(() => datesOf(form("today"), "13/11/2026")).toThrow(RangeError);
    expect(() => datesOf(form("this year"), T, 0)).toThrow(RangeError);
    expect(() => datesOf(form("this year"), T, 13)).toThrow(RangeError);
    expect(() => datesOf(form("this year"), T, 1.5)).toThrow(RangeError);
    expect(() => datesOf({ kind: "last", count: 0, unit: "day" }, T)).toThrow(RangeError);
    expect(() => datesOf({ kind: "last", count: 1000, unit: "day" }, T)).toThrow(RangeError);
    expect(() => datesOf({ kind: "last", count: 2.5, unit: "week" }, T)).toThrow(RangeError);
    expect(() => datesOf(form("last 999 years"), "0500-06-01")).toThrow(RangeError);
  });
});

describe("days", () => {
  it("knows a real day from text that only looks like one", () => {
    for (const day of ["2026-11-13", "2028-02-29", "2000-02-29", "2026-12-31", "0001-01-01", "9999-12-31"]) expect(isDay(day)).toBe(true);
    for (const text of ["2026-02-29", "2100-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "2026-1-5", "0000-01-01"]) {
      expect(isDay(text)).toBe(false);
    }
    for (const text of ["20261113", "2026-11-13T00:00", " 2026-11-13", "13/11/2026", ""]) expect(isDay(text)).toBe(false);
  });

  it("moves by whole days and counts them", () => {
    expect(addDays("2026-11-13", 0)).toBe("2026-11-13");
    expect(addDays("2026-11-13", -90)).toBe("2026-08-15");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2100-03-01", -1)).toBe("2100-02-28");
    expect(addDays("2000-03-01", -1)).toBe("2000-02-29");
    expect(daysBetween("2026-08-15", "2026-11-13")).toBe(90);
    expect(daysBetween("2026-11-13", "2026-08-15")).toBe(-90);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addDays("2026-11-13", 0.5)).toThrow(RangeError);
    expect(() => daysBetween("2026-11-13", "soon")).toThrow(RangeError);
    expect(() => addDays("0001-01-01", -1)).toThrow(RangeError);
    expect(() => addDays("9999-12-31", 1)).toThrow(RangeError);
  });
});

describe("a cell's day", () => {
  const NY = "America/New_York";

  it("a date string is that day, in every time zone", () => {
    for (const zone of ZONES) {
      expect(dayOfCell("2026-11-13", zone)).toBe("2026-11-13");
      expect(dayOfCell("2028-02-29", zone)).toBe("2028-02-29");
      expect(dayOfCell(" 2026-11-13 ", zone)).toBe("2026-11-13");
    }
  });

  it("a Date is the day its instant falls on in the time zone", () => {
    const late = new Date("2026-11-14T03:30:00.000Z");
    expect(dayOfCell(late, "UTC")).toBe("2026-11-14");
    expect(dayOfCell(late, NY)).toBe("2026-11-13");
    expect(dayOfCell(late, "America/St_Johns")).toBe("2026-11-14");
    expect(dayOfCell(late, "Asia/Kolkata")).toBe("2026-11-14");
    expect(dayOfCell(late, "Pacific/Auckland")).toBe("2026-11-14");
    expect(dayOfCell(new Date("2026-11-13T04:59:59.999Z"), NY)).toBe("2026-11-12");
    expect(dayOfCell(new Date("2026-11-13T05:00:00.000Z"), NY)).toBe("2026-11-13");
    // A Date at midnight UTC is the day before in New York: it is an instant, not a date.
    expect(dayOfCell(new Date("2026-11-13T00:00:00.000Z"), NY)).toBe("2026-11-12");
  });

  it("a string with a time and an offset is the day its instant falls on in the time zone", () => {
    expect(dayOfCell("2026-11-14T03:30:00Z", NY)).toBe("2026-11-13");
    expect(dayOfCell("2026-11-14T03:30:00.000Z", NY)).toBe("2026-11-13");
    expect(dayOfCell("2026-11-14T03:30Z", NY)).toBe("2026-11-13");
    expect(dayOfCell("2026-11-14T03:30:00z", NY)).toBe("2026-11-13");
    expect(dayOfCell("2026-11-14T03:30:00+00:00", NY)).toBe("2026-11-13");
    expect(dayOfCell("2026-11-13T22:30:00-05:00", NY)).toBe("2026-11-13");
    expect(dayOfCell("2026-11-13T22:30:00-05:00", "UTC")).toBe("2026-11-14");
    expect(dayOfCell("2026-11-13T22:30:00-0500", "UTC")).toBe("2026-11-14");
    expect(dayOfCell("2026-11-13T22:30:00-05", "UTC")).toBe("2026-11-14");
    expect(dayOfCell("2026-11-14T09:00:00+05:30", NY)).toBe("2026-11-13");
    expect(dayOfCell("2026-11-14T09:00:00+05:30", "Asia/Kolkata")).toBe("2026-11-14");
    expect(dayOfCell("2026-11-14T16:30:00+13:00", NY)).toBe("2026-11-13");
    expect(dayOfCell("2026-11-13T23:59:59.999999-05:00", NY)).toBe("2026-11-13");
    expect(dayOfCell("2026-11-14T04:59:59.999Z", NY)).toBe("2026-11-13");
    expect(dayOfCell("2026-11-14T05:00:00.000Z", NY)).toBe("2026-11-14");
    // The year and the month turn with the offset.
    expect(dayOfCell("2027-01-01T02:00:00Z", NY)).toBe("2026-12-31");
    expect(dayOfCell("2028-02-29T23:00:00-05:00", "UTC")).toBe("2028-03-01");
    // A space between the date and the time, as a database writes it.
    expect(dayOfCell("2026-11-14 03:30:00+00", NY)).toBe("2026-11-13");
    expect(dayOfCell("0050-06-01T12:00:00Z", "UTC")).toBe("0050-06-01");
  });

  it("a string with a time and no offset is its own date part, in every time zone", () => {
    for (const zone of ZONES) {
      expect(dayOfCell("2026-11-13T23:59:59", zone)).toBe("2026-11-13");
      expect(dayOfCell("2026-11-13T00:00", zone)).toBe("2026-11-13");
      expect(dayOfCell("2026-11-13T00:00:00.000", zone)).toBe("2026-11-13");
      expect(dayOfCell("2026-11-13 08:15:00", zone)).toBe("2026-11-13");
    }
  });

  it("a cell that can't be read as a date has no day", () => {
    const unreadable: unknown[] = [
      null,
      undefined,
      "",
      " ",
      "soon",
      "n/a",
      "2026",
      "2026-11",
      "2026-02-30",
      "2026-13-01",
      "2026-11-00",
      "20261113",
      "11/13/2026",
      "13 Nov 2026",
      "Nov 13, 2026",
      "2026-11-13T",
      "2026-11-13T15",
      "2026-11-13T25:00:00",
      "2026-11-13T24:00:00",
      "2026-11-13T10:60:00",
      "2026-11-13T10:00:60",
      "2026-11-13T10:00:00+24:00",
      "2026-11-13T10:00:00+05:60",
      "2026-11-13T10:00:00 UTC",
      "2026-11-13T10:00:00Zulu",
      "2026-02-30T10:00:00Z",
      "2026-11-13 and more",
      20261113,
      1794582000000,
      Number.NaN,
      true,
      false,
      {},
      [],
      ["2026-11-13"],
      new Date(Number.NaN),
      new Date(8.64e15),
      new Date(-8.64e15),
    ];
    expect(unreadable.filter((cell) => dayOfCell(cell, NY) !== undefined)).toEqual([]);
  });

  it("throws for a time zone it doesn't know, and never falls back to the machine's", () => {
    expect(() => dayOfCell(new Date("2026-11-13T15:00:00.000Z"), "Mars/Olympus_Mons")).toThrow(RangeError);
    expect(() => dayOfCell("2026-11-13T15:00:00Z", undefined as unknown as string)).toThrow(RangeError);
  });

  it("gives the same day when asked twice, and for two zones in turn", () => {
    const at = new Date("2026-11-14T03:30:00.000Z");
    expect([dayOfCell(at, NY), dayOfCell(at, "UTC"), dayOfCell(at, NY), dayOfCell(at, NY), dayOfCell(at, "UTC")]).toEqual([
      "2026-11-13",
      "2026-11-14",
      "2026-11-13",
      "2026-11-13",
      "2026-11-14",
    ]);
  });
});

describe("properties, on fixed seeds", () => {
  const randomDay = (rand: () => number): string => {
    const year = intIn(rand, 1990, 2110);
    const month = intIn(rand, 1, 12);
    return `${year}-${String(month).padStart(2, "0")}-${String(intIn(rand, 1, lastDateOf(year, month))).padStart(2, "0")}`;
  };

  it("1,000 random days: moving by days agrees with the test's own counter, there and back", () => {
    const rand = seeded(5201);
    for (let i = 0; i < 1000; i++) {
      const day = randomDay(rand);
      const count = intIn(rand, -4000, 4000);
      const moved = addDays(day, count);
      expect(isDay(day)).toBe(true);
      expect(moved).toBe(stepDays(day, count));
      expect(addDays(moved, -count)).toBe(day);
      expect(daysBetween(day, moved)).toBe(count);
      expect(moved < day).toBe(count < 0);
    }
  });

  it("every day from 1999 to 2031 follows the one before", () => {
    let day = "1999-01-01";
    for (let i = 0; day < "2031-12-31"; i++) {
      const next = addDays(day, 1);
      expect(next).toBe(stepDays(day, 1));
      expect(daysBetween("1999-01-01", next)).toBe(i + 1);
      day = next;
    }
  });

  it("1,000 random days: last N days holds N + 1 days through today, and a week is 7 days", () => {
    const rand = seeded(5202);
    for (let i = 0; i < 1000; i++) {
      const today = randomDay(rand);
      const count = intIn(rand, 1, 999);
      for (const lead of ["last", "past"]) {
        const [first, last] = dates(`${lead} ${count} days`, today);
        expect(last).toBe(today);
        expect(first).toBe(stepDays(today, -count));
        expect(daysBetween(first, last) + 1).toBe(count + 1);
        expect(dates(`${lead} ${count} weeks`, today)).toEqual([stepDays(today, -7 * count), today]);
      }
      expect(dates("today", today)).toEqual([today, today]);
      expect(dates("yesterday", today)).toEqual([stepDays(today, -1), stepDays(today, -1)]);
    }
  });

  it("1,000 random days: last N months and years land on the same day of the month, or on that month's last day", () => {
    const rand = seeded(5203);
    for (let i = 0; i < 1000; i++) {
      const today = randomDay(rand);
      const count = intIn(rand, 1, 999);
      for (const [unit, months] of [
        ["months", count],
        ["years", 12 * count],
      ] as const) {
        const [first, last] = dates(`last ${count} ${unit}`, today);
        expect(last).toBe(today);
        expect(isDay(first)).toBe(true);
        expect(monthIndex(today) - monthIndex(first)).toBe(months);
        const from = partsOf(first);
        expect(from.date).toBe(Math.min(partsOf(today).date, lastDateOf(from.year, from.month)));
        // The year's first month never moves a count of months or years.
        expect(dates(`last ${count} ${unit}`, today, intIn(rand, 1, 12))).toEqual([first, last]);
      }
    }
  });

  it("1,000 random days, every first month: periods are whole, hold today, and follow each other", () => {
    const rand = seeded(5204);
    const LENGTH = { month: 1, quarter: 3, year: 12 } as const;
    for (let i = 0; i < 1000; i++) {
      const today = randomDay(rand);
      const fiscalYearStart = intIn(rand, 1, 12);
      for (const period of ["month", "quarter", "year"] as const) {
        const [first, last] = dates(`this ${period}`, today, fiscalYearStart);
        const [before, beforeLast] = dates(`last ${period}`, today, fiscalYearStart);
        // Whole months: it starts on a 1st, ends on a month's last day, and spans the right count of months.
        for (const [from, to] of [
          [first, last],
          [before, beforeLast],
        ] as const) {
          expect(from <= to).toBe(true);
          expect(partsOf(from).date).toBe(1);
          expect(partsOf(stepDays(to, 1)).date).toBe(1);
          expect(monthIndex(to) - monthIndex(from)).toBe(LENGTH[period] - 1);
        }
        // It holds today, and the one before ends the day before it starts.
        expect(first <= today && today <= last).toBe(true);
        expect(stepDays(beforeLast, 1)).toBe(first);
        // A year starts in its first month. A quarter starts a whole count of quarters after it.
        if (period === "year") expect(partsOf(first).month).toBe(fiscalYearStart);
        if (period === "quarter") expect((partsOf(first).month - fiscalYearStart + 12) % 3).toBe(0);
        if (period === "month") expect(first.slice(0, 7)).toBe(today.slice(0, 7));
        // To date: from the period's first day, through today.
        expect(dates(`${period} to date`, today, fiscalYearStart)).toEqual([first, today]);
        expect(dates(`${period[0]}td`, today, fiscalYearStart)).toEqual([first, today]);
        // Every day of the period gives the same period.
        expect(dates(`this ${period}`, first, fiscalYearStart)).toEqual([first, last]);
        expect(dates(`this ${period}`, last, fiscalYearStart)).toEqual([first, last]);
        expect(dates(`this ${period}`, stepDays(last, 1), fiscalYearStart)[0]).toBe(stepDays(last, 1));
      }
      // A quarter sits inside its year, and a month inside its quarter.
      const year = dates("this year", today, fiscalYearStart);
      const quarter = dates("this quarter", today, fiscalYearStart);
      const month = dates("this month", today, fiscalYearStart);
      expect(year[0] <= quarter[0] && quarter[0] <= month[0] && month[1] <= quarter[1] && quarter[1] <= year[1]).toBe(true);
      expect([365, 366]).toContain(daysBetween(year[0], year[1]) + 1);
      // The year is four quarters, end to end.
      let start = year[0];
      for (let q = 0; q < 4; q++) {
        const [first, last] = dates("this quarter", start, fiscalYearStart);
        expect(first).toBe(start);
        start = stepDays(last, 1);
      }
      expect(start).toBe(stepDays(year[1], 1));
    }
  });

  it("1,000 random days: no form's last day is before its first, and each is a real day", () => {
    const rand = seeded(5205);
    const fixed = ["today", "yesterday", "this month", "this quarter", "this year", "last month", "last quarter", "last year"];
    const toDate = ["month to date", "quarter to date", "year to date", "MTD", "QTD", "YTD"];
    for (let i = 0; i < 1000; i++) {
      const today = randomDay(rand);
      const fiscalYearStart = intIn(rand, 1, 12);
      const counted = ["days", "weeks", "months", "years"].map(
        (unit) => `${rand() < 0.5 ? "last" : "past"} ${intIn(rand, 1, 999)} ${unit}`,
      );
      for (const words of [...fixed, ...toDate, ...counted]) {
        const [first, last] = dates(words, today, fiscalYearStart);
        expect(isDay(first) && isDay(last)).toBe(true);
        expect(first <= last).toBe(true);
        expect(last >= today || words === "yesterday" || words.startsWith("last ")).toBe(true);
      }
    }
  });

  // The same day read another way: Intl's parts, in a formatter the module doesn't build.
  const byParts = new Map(
    ZONES.map((zone) => [zone, new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })]),
  );
  const partsDay = (at: Date, zone: (typeof ZONES)[number]): string => {
    const parts = Object.fromEntries((byParts.get(zone)?.formatToParts(at) ?? []).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };

  it("2,000 random instants in six time zones: today, a Date cell and a string cell agree", () => {
    const rand = seeded(5206);
    const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, "0");
    const span = Date.UTC(2040, 0, 1) - Date.UTC(1975, 0, 1);
    for (let i = 0; i < 2000; i++) {
      const at = new Date(Date.UTC(1975, 0, 1) + Math.floor(rand() * span));
      // The same instant written with an offset of its own, from -12:00 to +14:00 in quarter hours.
      const offset = 15 * intIn(rand, -48, 56);
      const local = new Date(at.getTime() + offset * 60_000).toISOString().slice(0, 23);
      const withOffset = `${local}${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
      for (const zone of ZONES) {
        const day = todayIn(at, zone);
        expect(isDay(day)).toBe(true);
        expect(day).toBe(partsDay(at, zone));
        expect(dayOfCell(at, zone)).toBe(day);
        expect(dayOfCell(at.toISOString(), zone)).toBe(day);
        expect(dayOfCell(withOffset, zone)).toBe(day);
        // With no offset, the string is its own date part whatever the zone.
        expect(dayOfCell(local, zone)).toBe(local.slice(0, 10));
        // The zone's day is the UTC day, the one before or the one after.
        expect(Math.abs(daysBetween(utcDay(at), day))).toBeLessThanOrEqual(1);
      }
      // Two zones whose offset never changes in these years, counted by hand.
      expect(todayIn(at, "UTC")).toBe(utcDay(at));
      expect(todayIn(at, "Asia/Kolkata")).toBe(utcDay(new Date(at.getTime() + 330 * 60_000)));
    }
  });

  it("2,000 random instants in six time zones: a row is kept exactly when its day is in the range", () => {
    const rand = seeded(5207);
    const span = Date.UTC(2027, 0, 1) - Date.UTC(2026, 0, 1);
    for (const zone of ZONES) {
      const today = todayIn(new Date("2026-11-13T15:00:00.000Z"), zone);
      const { first, last } = datesOf(form("last 90 days"), today);
      expect(first).toBe(stepDays(today, -90));
      let kept = 0;
      for (let i = 0; i < 2000; i++) {
        const at = new Date(Date.UTC(2026, 0, 1) + Math.floor(rand() * span));
        const day = dayOfCell(at.toISOString(), zone);
        if (day === undefined) throw new Error("an instant in 2026 has a day");
        // Compared as text, the way a filter compares two ISO dates.
        const inRange = first <= day && day <= last;
        if (inRange) kept++;
        // The test's own reading: the instant's day by Intl's parts, counted from today with the UTC stepper.
        const own = partsDay(at, zone);
        const sinceToday = Math.round((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${own}T00:00:00.000Z`)) / 86_400_000);
        expect(inRange).toBe(sinceToday >= 0 && sinceToday <= 90);
        expect(daysBetween(day, today)).toBe(sinceToday);
      }
      expect(kept).toBeGreaterThan(300);
      expect(kept).toBeLessThan(700);
    }
  });
});
