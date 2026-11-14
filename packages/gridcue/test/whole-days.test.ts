import {
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
  columnVisibilityFeature,
  constructTable,
  createFilteredRowModel,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { describe, expect, it } from "vitest";
import { matchesFilter, matchesPredicate } from "../src/core/evaluate";
import { type ColumnDescriptor, emptyViewState, type FilterPredicate, type ViewSchema } from "../src/core/protocol";
import { applyView } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createTanStackAdapter, gridcueFilterFn, type TanStackTableLike } from "../src/tanstack";

// Filtering by whole days (named filters spec, 5.5; ADR 0026). A date in a filter means the whole day in the
// Calendar's time zone, on date and date-and-time columns alike. Nothing here reads the machine's own time zone,
// except where a test says it reads the browser's: this file passes with TZ set to UTC, America/New_York and
// Pacific/Auckland.

const DATE = { id: "booked", label: "Booked", kind: "date" } as ColumnDescriptor;
const DATETIME = { id: "posted", label: "Posted", kind: "datetime" } as ColumnDescriptor;
const KINDS = [DATE, DATETIME];

const p = (operator: FilterPredicate["operator"], value?: FilterPredicate["value"]): FilterPredicate => ({
  id: "f",
  type: "predicate",
  columnId: "posted",
  operator,
  ...(value === undefined ? {} : { value }),
});

/**
 * A day in a zone, and the instants its midnights fall on, written by hand: `start` is its first instant and `end`
 * the first instant of the next day.
 */
const DAYS = [
  { zone: "America/New_York", day: "2026-01-31", start: "2026-01-31T05:00:00.000Z", end: "2026-02-01T05:00:00.000Z" },
  // The clock goes from 02:00 to 03:00: a day of 23 hours.
  { zone: "America/New_York", day: "2026-03-08", start: "2026-03-08T05:00:00.000Z", end: "2026-03-09T04:00:00.000Z" },
  { zone: "Asia/Kolkata", day: "2026-01-31", start: "2026-01-30T18:30:00.000Z", end: "2026-01-31T18:30:00.000Z" },
  { zone: "Pacific/Auckland", day: "2026-01-31", start: "2026-01-30T11:00:00.000Z", end: "2026-01-31T11:00:00.000Z" },
  // The clock goes from 03:00 back to 02:00: a day of 25 hours.
  { zone: "Pacific/Auckland", day: "2026-04-05", start: "2026-04-04T11:00:00.000Z", end: "2026-04-05T12:00:00.000Z" },
] as const;

/** The day before and after an ISO date, counted on a UTC `Date` the module never uses. */
const step = (day: string, count: number) => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
};

/** The same instant written with another offset of its own, in minutes. */
const withOffset = (at: number, offset: number) => {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const local = new Date(at + offset * 60_000).toISOString().slice(0, 23);
  return `${local}${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
};

/** Cells on the day before (-1), the day itself (0) and the day after (1), in every form a cell may take. */
const cellsAround = ({ day, start, end }: (typeof DAYS)[number]): Array<{ cell: unknown; where: -1 | 0 | 1; what: string }> => {
  const s = Date.parse(start);
  const e = Date.parse(end);
  const instants: Array<[number, -1 | 0 | 1, string]> = [
    [s - 1, -1, "the last instant before the day"],
    [s, 0, "the day's first instant"],
    [e - 1, 0, "the day's last instant"],
    [e, 1, "the first instant after the day"],
  ];
  const before = step(day, -1);
  const after = step(day, 1);
  return [
    ...instants.flatMap(([at, where, what]) => [
      { cell: new Date(at), where, what: `${what}, as a Date` },
      { cell: new Date(at).toISOString(), where, what: `${what}, as a UTC string` },
      { cell: withOffset(at, 330), where, what: `${what}, written at +05:30` },
      { cell: withOffset(at, -480), where, what: `${what}, written at -08:00` },
    ]),
    // A time with no offset is its own date part, in every zone.
    { cell: `${before}T23:59:59.999`, where: -1, what: "the day before, late, with no offset" },
    { cell: `${day}T00:00:00`, where: 0, what: "the day at midnight, with no offset" },
    { cell: `${day} 23:59`, where: 0, what: "the day, late, with no offset" },
    { cell: `${after}T00:00`, where: 1, what: "the day after at midnight, with no offset" },
    { cell: before, where: -1, what: "the day before, as a date" },
    { cell: day, where: 0, what: "the day, as a date" },
    { cell: after, where: 1, what: "the day after, as a date" },
  ];
};

/** What each operator keeps, by where the cell's day is against the filter's day. */
const KEEPS = (day: string): Array<[FilterPredicate, (where: -1 | 0 | 1) => boolean]> => [
  [p("eq", day), (w) => w === 0],
  [p("gt", day), (w) => w > 0],
  [p("gte", day), (w) => w >= 0],
  [p("lt", day), (w) => w < 0],
  [p("lte", day), (w) => w <= 0],
  [p("between", { min: day, max: day }), (w) => w === 0],
  [p("between", { min: step(day, -1), max: day }), (w) => w <= 0],
  [p("between", { min: day, max: step(day, 1) }), (w) => w >= 0],
  [p("between", { min: step(day, 1), max: step(day, -1) }), () => false],
  [p("isEmpty"), () => false],
  [p("isNotEmpty"), () => true],
];

describe("a date in a filter means the whole day in the time zone", () => {
  for (const d of DAYS) {
    for (const column of KINDS) {
      it(`${d.zone}, ${d.day}, a ${column.kind} column: every operator, on the day before, the day and the day after`, () => {
        for (const { cell, where, what } of cellsAround(d)) {
          for (const [predicate, keeps] of KEEPS(d.day)) {
            const label = `${what} (${String(cell instanceof Date ? cell.toISOString() : cell)}), ${predicate.operator} ${JSON.stringify(predicate.value ?? "")}`;
            expect(matchesPredicate(cell, predicate, column, { timeZone: d.zone }), label).toBe(keeps(where));
          }
        }
      });
    }
  }

  it("the same instant is on different days in different zones", () => {
    // 12:00 UTC on 2026-01-31 is 07:00 that day in New York, 17:30 in Kolkata, and 01:00 the next day in Auckland.
    const cell = new Date("2026-01-31T12:00:00.000Z");
    const on = p("eq", "2026-01-31");
    expect(matchesPredicate(cell, on, DATETIME, { timeZone: "America/New_York" })).toBe(true);
    expect(matchesPredicate(cell, on, DATETIME, { timeZone: "Asia/Kolkata" })).toBe(true);
    expect(matchesPredicate(cell, on, DATETIME, { timeZone: "Pacific/Auckland" })).toBe(false);
    expect(matchesPredicate(cell, p("eq", "2026-02-01"), DATETIME, { timeZone: "Pacific/Auckland" })).toBe(true);
  });

  it("“after 2026-01-31” no longer keeps a row stamped on the 31st", () => {
    // Compared as text, "2026-01-31T09:00:00Z" sorts after "2026-01-31", which kept the row.
    for (const zone of ["UTC", "America/New_York", "Asia/Kolkata", "Pacific/Auckland"]) {
      // 09:00 UTC is on the 31st in all four: 04:00 in New York, 22:00 in Auckland.
      expect(matchesPredicate("2026-01-31T09:00:00Z", p("gt", "2026-01-31"), DATETIME, { timeZone: zone }), zone).toBe(false);
      // 12:00 UTC is 01:00 on the 1st in Auckland, and still the 31st elsewhere.
      expect(matchesPredicate("2026-01-31T12:00:00Z", p("gt", "2026-01-31"), DATETIME, { timeZone: zone }), zone).toBe(
        zone === "Pacific/Auckland",
      );
      expect(matchesPredicate("2026-01-31T09:00:00", p("gt", "2026-01-31"), DATETIME, { timeZone: zone }), zone).toBe(false);
      expect(matchesPredicate("2026-01-31T09:00:00", p("eq", "2026-01-31"), DATETIME, { timeZone: zone }), zone).toBe(true);
    }
  });
});

describe("a cell GridCue can't read as a date", () => {
  const unreadable: unknown[] = [
    "31/01/2026",
    "Jan 31, 2026",
    "2026-1-31",
    "2026-02-30",
    "2026-01-31T24:00:00Z",
    "2026-01-31T10:00:00+25:00",
    "2026-01-31T10:00:00 tomorrow",
    "   ",
    "today",
    20260131,
    Date.parse("2026-01-31T12:00:00Z"),
    true,
    {},
    ["2026-01-31"],
    new Date(Number.NaN),
  ];
  const empty: unknown[] = [null, undefined, ""];

  it("matches no filter that holds a date, for every operator and both kinds", () => {
    for (const column of KINDS) {
      for (const cell of [...unreadable, ...empty]) {
        for (const [predicate] of KEEPS("2026-01-31").filter(([q]) => q.operator !== "isEmpty" && q.operator !== "isNotEmpty")) {
          expect(matchesPredicate(cell, predicate, column, { timeZone: "UTC" }), `${String(cell)} ${predicate.operator}`).toBe(false);
        }
      }
    }
  });

  it("is empty only when it holds no value: “is empty” and “is not empty” hold no date", () => {
    for (const column of KINDS) {
      for (const cell of empty) {
        expect(matchesPredicate(cell, p("isEmpty"), column, { timeZone: "UTC" })).toBe(true);
        expect(matchesPredicate(cell, p("isNotEmpty"), column, { timeZone: "UTC" })).toBe(false);
      }
      for (const cell of unreadable) {
        expect(matchesPredicate(cell, p("isEmpty"), column, { timeZone: "UTC" })).toBe(false);
        expect(matchesPredicate(cell, p("isNotEmpty"), column, { timeZone: "UTC" })).toBe(true);
      }
    }
  });

  it("a filter value that isn't a date or a time keeps no row", () => {
    for (const value of ["31/01/2026", "", 20260131, true, null]) {
      expect(matchesPredicate("2026-01-31", p("eq", value), DATE, { timeZone: "UTC" })).toBe(false);
      expect(matchesPredicate("2026-01-31", p("gte", value), DATETIME, { timeZone: "UTC" })).toBe(false);
    }
    expect(matchesPredicate("2026-01-31", p("between", ["2026-01-01", "2026-12-31"]), DATE, { timeZone: "UTC" })).toBe(false);
    expect(matchesPredicate("2026-01-31", p("between", { min: "2026-01-01", max: 5 }), DATE, { timeZone: "UTC" })).toBe(false);
  });
});

describe("a filter value that holds a time is compared as an instant", () => {
  const ny = { timeZone: "America/New_York" };
  const start = Date.parse("2026-01-31T05:00:00.000Z");

  it("with an offset, on Date cells and strings with an offset", () => {
    for (const target of ["2026-01-31T05:00:00.000Z", "2026-01-31T00:00:00-05:00", "2026-01-31T10:30:00+05:30"]) {
      for (const cell of [new Date(start), withOffset(start, 0), withOffset(start, 780)]) {
        expect(matchesPredicate(cell, p("eq", target), DATETIME, ny)).toBe(true);
        expect(matchesPredicate(cell, p("gte", target), DATETIME, ny)).toBe(true);
        expect(matchesPredicate(cell, p("gt", target), DATETIME, ny)).toBe(false);
        expect(matchesPredicate(cell, p("lte", target), DATETIME, ny)).toBe(true);
        expect(matchesPredicate(cell, p("lt", target), DATETIME, ny)).toBe(false);
      }
      expect(matchesPredicate(new Date(start + 1), p("gt", target), DATETIME, ny)).toBe(true);
      expect(matchesPredicate(new Date(start - 1), p("lt", target), DATETIME, ny)).toBe(true);
      expect(matchesPredicate(new Date(start - 1), p("eq", target), DATETIME, ny)).toBe(false);
    }
  });

  it("with no offset, as the moment the zone's clock shows it, and a cell with no offset the same way", () => {
    const target = "2026-01-31T00:00:00";
    expect(matchesPredicate(new Date(start), p("eq", target), DATETIME, ny)).toBe(true);
    expect(matchesPredicate(new Date(start - 1), p("lt", target), DATETIME, ny)).toBe(true);
    expect(matchesPredicate("2026-01-31T00:00:00.001", p("gt", target), DATETIME, ny)).toBe(true);
    expect(matchesPredicate("2026-01-30T23:59:59.999", p("gt", target), DATETIME, ny)).toBe(false);
    // In Auckland the same clock time is 13 hours before UTC's.
    expect(matchesPredicate(new Date("2026-01-30T11:00:00.000Z"), p("eq", target), DATETIME, { timeZone: "Pacific/Auckland" })).toBe(true);
    // Either side of a clock change, the offset is the one in force there.
    expect(matchesPredicate(new Date("2026-03-08T07:00:00.000Z"), p("eq", "2026-03-08T03:00:00"), DATETIME, ny)).toBe(true);
    expect(matchesPredicate(new Date("2026-03-08T06:59:59.999Z"), p("eq", "2026-03-08T01:59:59.999"), DATETIME, ny)).toBe(true);
  });

  it("a date cell with no time is a whole day, not an instant, and matches no such filter", () => {
    for (const operator of ["eq", "gt", "gte", "lt", "lte"] as const) {
      expect(matchesPredicate("2026-01-31", p(operator, "2026-01-31T05:00:00.000Z"), DATETIME, ny)).toBe(false);
    }
  });

  it("a range may hold a day at one end and a time at the other", () => {
    const range = p("between", { min: "2026-01-31", max: "2026-01-31T12:00:00.000Z" });
    expect(matchesPredicate(new Date("2026-01-31T05:00:00.000Z"), range, DATETIME, ny)).toBe(true);
    expect(matchesPredicate(new Date("2026-01-31T12:00:00.000Z"), range, DATETIME, ny)).toBe(true);
    expect(matchesPredicate(new Date("2026-01-31T12:00:00.001Z"), range, DATETIME, ny)).toBe(false);
    expect(matchesPredicate(new Date("2026-01-31T04:59:59.999Z"), range, DATETIME, ny)).toBe(false);
  });
});

describe("the time zone", () => {
  const row = { posted: new Date("2026-01-31T12:00:00.000Z") };
  const filter = (value: string) => ({
    id: "root",
    type: "group" as const,
    combinator: "and" as const,
    children: [{ ...p("eq", value), columnId: "posted" }],
  });
  const schemaIn = (timeZone?: string) =>
    defineSchema([{ id: "posted", kind: "datetime" }], timeZone ? { calendar: { timeZone } } : {}) as ViewSchema;
  const browser = () => new Intl.DateTimeFormat().resolvedOptions().timeZone;

  it("matchesFilter and applyView read it from the schema's Calendar", () => {
    expect(matchesFilter(row, filter("2026-01-31"), schemaIn("America/New_York"))).toBe(true);
    expect(matchesFilter(row, filter("2026-01-31"), schemaIn("Pacific/Auckland"))).toBe(false);
    expect(matchesFilter(row, filter("2026-02-01"), schemaIn("Pacific/Auckland"))).toBe(true);
    const state = { ...emptyViewState(["posted"]), filters: filter("2026-02-01") };
    expect(applyView([row], state, schemaIn("Pacific/Auckland")).rows).toEqual([row]);
    expect(applyView([row], state, schemaIn("Asia/Kolkata")).rows).toEqual([]);
  });

  it("with no Calendar time zone, they read the browser's", () => {
    for (const day of ["2026-01-31", "2026-02-01"]) {
      expect(matchesFilter(row, filter(day), schemaIn())).toBe(matchesFilter(row, filter(day), schemaIn(browser())));
      expect(matchesPredicate(row.posted, p("eq", day), DATETIME)).toBe(matchesFilter(row, filter(day), schemaIn(browser())));
    }
  });

  it("is read when rows are filtered, not when the schema is built", async () => {
    const schema = schemaIn();
    const before = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Auckland";
      await Promise.resolve();
      expect(browser()).toBe("Pacific/Auckland");
      expect(matchesFilter(row, filter("2026-02-01"), schema)).toBe(true);
      process.env.TZ = "America/New_York";
      // The browser's zone is read again once the current task ends.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(browser()).toBe("America/New_York");
      expect(matchesFilter(row, filter("2026-02-01"), schema)).toBe(false);
      expect(matchesFilter(row, filter("2026-01-31"), schema)).toBe(true);
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

  it("an option names it for one predicate, over the browser's", () => {
    expect(matchesPredicate(row.posted, p("eq", "2026-02-01"), DATETIME, { timeZone: "Pacific/Auckland" })).toBe(true);
    expect(matchesPredicate(row.posted, p("eq", "2026-02-01"), DATETIME, { timeZone: "America/New_York" })).toBe(false);
  });

  it("a time zone the runtime doesn't know throws, and never falls back to the machine's", () => {
    expect(() => matchesPredicate(row.posted, p("eq", "2026-01-31"), DATETIME, { timeZone: "Mars/Olympus" })).toThrow(RangeError);
  });

  it("is not needed by any other column kind", () => {
    const text = { id: "note", label: "Note", kind: "string" } as ColumnDescriptor;
    expect(matchesPredicate("2026-01-31T09:00", { ...p("contains", "2026-01-31") }, text, { timeZone: "Mars/Olympus" })).toBe(true);
  });
});

describe("the TanStack Table adapter stores the Calendar's time zone beside the column's kind", () => {
  const features = tableFeatures({
    coreReactivityFeature: storeReactivityBindings(),
    columnFilteringFeature,
    rowSortingFeature,
    columnGroupingFeature,
    columnVisibilityFeature,
    columnOrderingFeature,
    filteredRowModel: createFilteredRowModel(),
  });
  const rows = [
    { note: "a", posted: new Date("2026-01-31T12:00:00.000Z") },
    { note: "b", posted: "2026-01-31T20:00:00-05:00" },
  ];
  const tableOf = () =>
    constructTable({
      features,
      data: rows,
      defaultColumn: { filterFn: gridcueFilterFn },
      columns: [{ accessorKey: "note" }, { accessorKey: "posted" }],
    } as never) as unknown as TanStackTableLike & { getRowModel(): { rows: Array<{ original: (typeof rows)[number] }> } };
  const apply = async (schema: ViewSchema) => {
    const table = tableOf();
    const adapter = createTanStackAdapter({ schema, table });
    const state = {
      ...emptyViewState(["note", "posted"]),
      filters: {
        id: "root",
        type: "group" as const,
        combinator: "and" as const,
        children: [
          { id: "f1", type: "predicate" as const, columnId: "posted", operator: "eq" as const, value: "2026-02-01" },
          { id: "f2", type: "predicate" as const, columnId: "note", operator: "isNotEmpty" as const },
        ],
      },
    };
    await adapter.restore({ revision: adapter.getState().revision, state });
    return table;
  };
  const columns = [
    { id: "note", kind: "string" as const },
    { id: "posted", kind: "datetime" as const },
  ];

  it("so gridcueFilterFn keeps the rows applyView keeps", async () => {
    const schema = defineSchema(columns, { calendar: { timeZone: "Pacific/Auckland" } });
    const table = await apply(schema);
    const stored = table.store.state.columnFilters ?? [];
    expect(stored.find((f) => f.id === "posted")?.value).toMatchObject({ kind: "datetime", timeZone: "Pacific/Auckland" });
    expect(stored.find((f) => f.id === "note")?.value).not.toHaveProperty("timeZone");
    // In Auckland both instants are on 2026-02-01; in New York neither is.
    expect(table.getRowModel().rows.map((r) => r.original.note)).toEqual(["a", "b"]);
    const ny = await apply(defineSchema(columns, { calendar: { timeZone: "America/New_York" } }));
    expect(ny.getRowModel().rows).toEqual([]);
  });

  it("with no Calendar time zone, stores none, and reads the browser's when a row is filtered", async () => {
    const table = await apply(defineSchema(columns));
    expect((table.store.state.columnFilters ?? []).find((f) => f.id === "posted")?.value).not.toHaveProperty("timeZone");
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const expected = rows.filter((r) => matchesPredicate(r.posted, p("eq", "2026-02-01"), DATETIME, { timeZone: zone }));
    expect(table.getRowModel().rows.map((r) => r.original)).toEqual(expected);
  });
});
