// Held-out property tests for named filters spec 5.5 (Task 5.2's bar): the product's
// date arithmetic and whole-day filtering against an independent reference day counter.
// Written by the Task 5.1 labeller before the code; the builder never sees this file.
// The runner copies this file and reference-days.ts into packages/gridcue/test/.
// Bars: every date equal; 0 rows differ.
import { describe, expect, it } from "vitest";
// GUESS: the module path. The plan (Task 5.2) puts date arithmetic in core/dates.ts.
import * as dates from "../packages/gridcue/src/core/dates";
// Spec section 6 names matchesPredicate(value, predicate, column, { timeZone }); core/evaluate.ts holds it today.
import { matchesPredicate } from "../packages/gridcue/src/core/evaluate";
import { type DayRange, dayAt, dayIndex, inRange, dayOf as refDayOf, range as refRange, today as refToday } from "./reference-days";

// ---- The product, in one place. The runner fixes names and shapes here and nowhere else. ----
// GUESS: the plan and spec name no exports for core/dates.ts. "todayIn", "rangeFor" and "dayOf"
// are guesses; change them in BINDINGS, and adapt the argument shapes in `product` below if the
// product takes a parsed form (each Form carries its parts) or a clock function.
const BINDINGS = { today: "todayIn", range: "datesOf", dayOf: "dayOfCell" } as const;

const exported = (name: string): ((...args: unknown[]) => unknown) => {
  const f = (dates as unknown as Record<string, unknown>)[name];
  if (typeof f !== "function") throw new Error(`core/dates has no function export "${name}". Fix BINDINGS at the top of this file.`);
  return f as (...args: unknown[]) => unknown;
};

/** A range in whatever shape the product returns it: {first,last}, {from,to}, {min,max}, {start,end} or [a, b]. */
const asRange = (r: unknown): DayRange => {
  if (Array.isArray(r) && r.length === 2) return { first: String(r[0]), last: String(r[1]) };
  const o = (r ?? {}) as Record<string, unknown>;
  const pairs: [string, string][] = [
    ["first", "last"],
    ["from", "to"],
    ["min", "max"],
    ["start", "end"],
  ];
  for (const [a, b] of pairs) {
    if (a in o && b in o) return { first: String(o[a]), last: String(o[b]) };
  }
  throw new Error(`Can't read a range from ${JSON.stringify(r)}. Adapt asRange or BINDINGS.`);
};

/** One form, as words and as parts, so a product that takes a parsed form can be bound without new parsing. */
interface Form {
  words: string;
  kind: string;
  n?: number;
  unit?: "day" | "week" | "month" | "year";
}

const product = {
  today: (instant: Date, timeZone: string): string => String(exported(BINDINGS.today)(instant, timeZone)),
  range: (form: Form, today: string, fiscalYearStart: number): DayRange =>
    asRange(exported(BINDINGS.range)(dates.readDateForm(form.words), today, fiscalYearStart)),
  dayOf: (cell: unknown, timeZone: string): string | undefined => {
    const d = exported(BINDINGS.dayOf)(cell, timeZone);
    return d === null || d === undefined ? undefined : String(d);
  },
  keeps: (cell: unknown, operator: string, value: unknown, kind: "date" | "datetime", timeZone: string): boolean =>
    (matchesPredicate as unknown as (...args: unknown[]) => boolean)(
      cell,
      { id: "f1", type: "predicate", columnId: "posted_at", operator, value },
      { id: "posted_at", label: "Posted", kind },
      { timeZone },
    ),
};
// ---- End of the product bindings. ----

/** mulberry32: a small seeded generator, so every run draws the same cases. */
const seeded = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const intIn = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;

const ZONES = ["UTC", "America/New_York", "America/St_Johns", "Europe/London", "Asia/Kolkata", "Pacific/Auckland"] as const;

const formsFor = (rand: () => number): Form[] => {
  const forms: Form[] = [
    { words: "today", kind: "today" },
    { words: "yesterday", kind: "yesterday" },
  ];
  for (const lead of ["last", "past"]) {
    for (const unit of ["day", "week", "month", "year"] as const) {
      const n = intIn(rand, 1, 999);
      forms.push({ words: `${lead} ${n} ${unit}s`, kind: `${lead} N ${unit}s`, n, unit });
    }
  }
  for (const words of ["this month", "this quarter", "this year", "last month", "last quarter", "last year"]) {
    forms.push({ words, kind: words });
  }
  for (const words of ["month to date", "quarter to date", "year to date", "MTD", "QTD", "YTD"]) {
    forms.push({ words, kind: words });
  }
  return forms;
};

const show = (xs: string[]) => (xs.length === 0 ? [] : [`${xs.length} differ; first ones:`, ...xs.slice(0, 25)]);

describe("date forms against the reference day counter", () => {
  it("gives every form's dates on 1,000 random days (seed 5051)", () => {
    const rand = seeded(5051);
    const lo = dayIndex("2000-01-01");
    const hi = dayIndex("2099-12-31");
    const diffs: string[] = [];
    let checked = 0;
    for (let i = 0; i < 1000; i += 1) {
      const today = dayAt(intIn(rand, lo, hi));
      const fiscalYearStart = i % 3 === 0 ? 1 : intIn(rand, 1, 12);
      for (const form of formsFor(rand)) {
        const want = refRange(form.words, today, fiscalYearStart);
        let got: DayRange | string;
        try {
          got = product.range(form, today, fiscalYearStart);
        } catch (error) {
          got = `throws ${(error as Error).message}`;
        }
        checked += 1;
        if (typeof got === "string" || got.first !== want.first || got.last !== want.last) {
          diffs.push(`${today} fy${fiscalYearStart} "${form.words}": want ${want.first}..${want.last}, got ${JSON.stringify(got)}`);
        }
      }
    }
    expect(checked).toBe(1000 * 22);
    expect(show(diffs)).toEqual([]);
  }, 120_000);
});

/** An instant near a local midnight in every zone: a UTC midnight plus a whole number of half hours, plus a little. */
const instantNear = (rand: () => number): number => {
  const day = dayAt(intIn(rand, dayIndex("2000-01-01"), dayIndex("2040-12-31")));
  const base = Date.parse(`${day}T00:00:00.000Z`);
  if (rand() < 0.3) return base + Math.floor(rand() * 86_400_000);
  const halfHours = intIn(rand, -28, 28);
  const jitter = pick(rand, [-1, 0, 999, -60_000, 59_999, intIn(rand, -1_800_000, 1_800_000)]);
  return base + halfHours * 1_800_000 + jitter;
};

const OFFSETS = ["+00:00", "-05:00", "-04:00", "-03:30", "-02:30", "+01:00", "+05:30", "+12:00", "+13:00", "-10:00", "+14:00"] as const;
const offsetMinutes = (o: string) => (o[0] === "-" ? -1 : 1) * (Number(o.slice(1, 3)) * 60 + Number(o.slice(4, 6)));
/** The instant's wall clock at a fixed offset, "YYYY-MM-DDTHH:MM:SS.mmm", worked from UTC fields only. */
const wallClock = (ms: number, offset: string) => new Date(ms + offsetMinutes(offset) * 60_000).toISOString().slice(0, 23);

type Cell = { label: string; value: unknown };
const cellsFor = (rand: () => number, ms: number): Cell[] => {
  const offset = pick(rand, OFFSETS);
  const cells: Cell[] = [
    { label: "Date", value: new Date(ms) },
    { label: "string with Z", value: new Date(ms).toISOString() },
    { label: "string with offset", value: `${wallClock(ms, offset)}${offset}` },
    { label: "string, no offset", value: wallClock(ms, pick(rand, OFFSETS)) },
    { label: "date string", value: new Date(ms).toISOString().slice(0, 10) },
  ];
  if (rand() < 0.15) {
    cells.push({
      label: "unreadable",
      value: pick(rand, ["not a date", "2026-02-30", "", null, undefined, "31/01/2026", new Date(Number.NaN)]),
    });
  }
  return cells;
};

const describeCell = (c: Cell) => `${c.label} ${c.value instanceof Date ? `Date(${c.value.getTime()})` : JSON.stringify(c.value)}`;

describe("whole days against the reference day counter", () => {
  it("finds today and each cell's day for 2,000 random instants in six zones (seed 7262)", () => {
    const rand = seeded(7262);
    const diffs: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const ms = instantNear(rand);
      const zone = pick(rand, ZONES);
      const wantToday = refToday(ms, zone);
      const gotToday = product.today(new Date(ms), zone);
      if (gotToday !== wantToday) diffs.push(`today ${new Date(ms).toISOString()} ${zone}: want ${wantToday}, got ${gotToday}`);
      for (const cell of cellsFor(rand, ms)) {
        const want = refDayOf(cell.value, zone);
        const got = product.dayOf(cell.value, zone);
        if (got !== want) diffs.push(`dayOf ${describeCell(cell)} ${zone}: want ${want}, got ${got}`);
      }
    }
    expect(show(diffs)).toEqual([]);
  }, 120_000);

  it("keeps a row exactly when its day in the zone is in the range, for 2,000 random instants (seed 9373)", () => {
    const rand = seeded(9373);
    const diffs: string[] = [];
    let kept = 0;
    let rows = 0;
    for (let i = 0; i < 2000; i += 1) {
      const ms = instantNear(rand);
      const zone = pick(rand, ZONES);
      const near = dayIndex(refToday(ms, zone));
      const firstIndex = near + intIn(rand, -2, 1);
      const r: DayRange = { first: dayAt(firstIndex), last: dayAt(firstIndex + intIn(rand, 0, 2)) };
      for (const cell of cellsFor(rand, ms)) {
        for (const kind of ["date", "datetime"] as const) {
          const day = refDayOf(cell.value, zone);
          const want = day !== undefined && inRange(day, r);
          const got = product.keeps(cell.value, "between", { min: r.first, max: r.last }, kind, zone);
          rows += 1;
          if (want) kept += 1;
          if (got !== want) diffs.push(`between ${r.first}..${r.last} ${kind} ${describeCell(cell)} ${zone}: want ${want}, got ${got}`);
        }
      }
    }
    expect(kept).toBeGreaterThan(rows / 5);
    expect(kept).toBeLessThan(rows);
    expect(show(diffs)).toEqual([]);
  }, 120_000);

  it("compares one date by whole days, with each operator, for 2,000 random instants (seed 1484)", () => {
    const rand = seeded(1484);
    const diffs: string[] = [];
    const holds: Record<string, (day: number, date: number) => boolean> = {
      eq: (d, x) => d === x,
      gt: (d, x) => d > x,
      gte: (d, x) => d >= x,
      lt: (d, x) => d < x,
      lte: (d, x) => d <= x,
    };
    for (let i = 0; i < 2000; i += 1) {
      const ms = instantNear(rand);
      const zone = pick(rand, ZONES);
      const date = dayAt(dayIndex(refToday(ms, zone)) + intIn(rand, -1, 1));
      const operator = pick(rand, Object.keys(holds));
      for (const cell of cellsFor(rand, ms)) {
        for (const kind of ["date", "datetime"] as const) {
          const day = refDayOf(cell.value, zone);
          const want = day !== undefined && (holds[operator] as (d: number, x: number) => boolean)(dayIndex(day), dayIndex(date));
          const got = product.keeps(cell.value, operator, date, kind, zone);
          if (got !== want) diffs.push(`${operator} ${date} ${kind} ${describeCell(cell)} ${zone}: want ${want}, got ${got}`);
        }
      }
    }
    expect(show(diffs)).toEqual([]);
  }, 120_000);
});
