import { describe, expect, it } from "vitest";
import { emptyViewState, type FilterPredicate, type ViewSchema, type ViewState } from "../src/core/protocol";
import { defineSchema } from "../src/core/schema";
import { groupedFirst, type RenderedCase, type Row, renderWithRows, renderWithTanStack, runRenderedRows } from "./rendered-rows";

// Both Grid Adapters keep the same rows for the same view (named filters spec, section 10). This file holds the
// whole-day, empty and exact-text cases. Nothing here reads the machine's own time zone, except the cases that say
// they take the browser's: this file passes with TZ set to UTC, America/New_York and Pacific/Auckland.

const COLUMNS = ["key", "booked", "posted", "stamped", "owner", "category"];

const stateWith = (...predicates: Array<Omit<FilterPredicate, "id" | "type">>): ViewState => ({
  ...emptyViewState(COLUMNS),
  filters: {
    id: "root",
    type: "group",
    combinator: "and",
    children: predicates.map((q, i) => ({ id: `f${i}`, type: "predicate", ...q })),
  },
});

const schemaIn = (timeZone?: string): ViewSchema =>
  defineSchema(
    [
      { id: "key" },
      { id: "booked", kind: "date" },
      { id: "posted", kind: "datetime" },
      { id: "stamped", kind: "datetime" },
      { id: "owner", kind: "string" },
      { id: "category", kind: "enum" },
    ],
    {
      columns: {
        category: {
          enumValues: [
            { id: "travel", label: "Travel" },
            { id: "fees", label: "Fees" },
          ],
        },
      },
      ...(timeZone ? { calendar: { timeZone } } : {}),
    },
  );

const step = (day: string, count: number) => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
};

const withOffset = (at: number, offset: number) => {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const local = new Date(at + offset * 60_000).toISOString().slice(0, 23);
  return `${local}${offset < 0 ? "-" : "+"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
};

// --- Whole days -----------------------------------------------------------------------------------------------

/** A day in a zone and the instants its midnights fall on, written by hand. */
const DAYS = [
  { zone: "America/New_York", day: "2026-01-31", start: "2026-01-31T05:00:00.000Z", end: "2026-02-01T05:00:00.000Z" },
  { zone: "America/New_York", day: "2026-03-08", start: "2026-03-08T05:00:00.000Z", end: "2026-03-09T04:00:00.000Z" },
  { zone: "Asia/Kolkata", day: "2026-01-31", start: "2026-01-30T18:30:00.000Z", end: "2026-01-31T18:30:00.000Z" },
  { zone: "Pacific/Auckland", day: "2026-01-31", start: "2026-01-30T11:00:00.000Z", end: "2026-01-31T11:00:00.000Z" },
  { zone: "Pacific/Auckland", day: "2026-04-05", start: "2026-04-04T11:00:00.000Z", end: "2026-04-05T12:00:00.000Z" },
] as const;

type Where = -1 | 0 | 1 | "none" | "empty";

/** Rows around one day, each with one cell in one date column and where its day is against the day. */
const rowsAround = ({ day, start, end }: (typeof DAYS)[number]) => {
  const s = Date.parse(start);
  const e = Date.parse(end);
  const out: Array<Row & { column: string; where: Where }> = [];
  const add = (column: string, cell: unknown, where: Where) => out.push({ key: `r${out.length}`, column, where, [column]: cell });
  for (const [at, where] of [
    [s - 1, -1],
    [s, 0],
    [e - 1, 0],
    [e, 1],
  ] as const) {
    add("stamped", new Date(at), where);
    add("posted", new Date(at).toISOString(), where);
    add("posted", withOffset(at, 330), where);
    add("posted", withOffset(at, -480), where);
  }
  add("posted", `${step(day, -1)}T23:59:59.999`, -1);
  add("posted", `${day}T00:00:00`, 0);
  add("posted", `${day}T23:59`, 0);
  add("posted", `${step(day, 1)}T00:00`, 1);
  add("booked", step(day, -1), -1);
  add("booked", day, 0);
  add("booked", step(day, 1), 1);
  for (const column of ["booked", "posted", "stamped"]) {
    add(column, null, "empty");
    add(column, "", "empty");
    add(column, undefined, "empty");
  }
  add("booked", "31/01/2026", "none");
  add("booked", "2026-02-30", "none");
  add("posted", "2026-01-31T25:00:00Z", "none");
  add("posted", "soon", "none");
  add("stamped", new Date(Number.NaN), "none");
  return out;
};

const OPERATORS = (day: string): Array<[string, Omit<FilterPredicate, "id" | "type" | "columnId">, (w: Where) => boolean]> => {
  const dated = (keep: (w: -1 | 0 | 1) => boolean) => (w: Where) => typeof w === "number" && keep(w);
  return [
    ["eq", { operator: "eq", value: day }, dated((w) => w === 0)],
    ["gt", { operator: "gt", value: day }, dated((w) => w > 0)],
    ["gte", { operator: "gte", value: day }, dated((w) => w >= 0)],
    ["lt", { operator: "lt", value: day }, dated((w) => w < 0)],
    ["lte", { operator: "lte", value: day }, dated((w) => w <= 0)],
    ["between the day and itself", { operator: "between", value: { min: day, max: day } }, dated((w) => w === 0)],
    ["between the day before and the day", { operator: "between", value: { min: step(day, -1), max: day } }, dated((w) => w <= 0)],
    ["isEmpty", { operator: "isEmpty" }, (w) => w === "empty"],
    ["isNotEmpty", { operator: "isNotEmpty" }, (w) => w !== "empty"],
  ];
};

const wholeDays: RenderedCase[] = DAYS.flatMap((d) => {
  const rows = rowsAround(d);
  const schema = schemaIn(d.zone);
  return ["booked", "posted", "stamped"].flatMap((columnId) =>
    OPERATORS(d.day).map(([name, predicate, keeps]) => ({
      name: `${d.zone}, ${d.day}: ${columnId} ${name}`,
      schema,
      rows,
      state: stateWith({ columnId, ...predicate }),
      // A row with no cell in this column is empty there.
      expected: rows.filter((r) => keeps(r.column === columnId ? r.where : "empty")).map((r) => r.key),
    })),
  );
});

// With no Calendar time zone, both adapters take the browser's when the rows are filtered.
const browserZone: RenderedCase[] = ["posted", "stamped"].map((columnId) => ({
  name: `no Calendar time zone: ${columnId} on 2026-01-31, in the browser's zone`,
  schema: schemaIn(),
  rows: DAYS.flatMap((d) => rowsAround(d)).map((r, i) => ({ ...r, key: `b${i}` })),
  state: stateWith({ columnId, operator: "eq", value: "2026-01-31" }),
}));

// --- 2,000 random instants in six time zones, on a fixed seed ----------------------------------------------------

const ZONES = ["UTC", "America/New_York", "America/St_Johns", "Europe/London", "Asia/Kolkata", "Pacific/Auckland"] as const;

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

// The test's own reading of an instant's day: Intl's parts, which the module doesn't use.
const partsDay = (at: Date, zone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const randomInstants: RenderedCase[] = ZONES.flatMap((zone, z) => {
  const rand = seeded(5400 + z);
  const span = Date.UTC(2027, 0, 1) - Date.UTC(2026, 6, 1);
  const rows: Row[] = Array.from({ length: 2000 }, (_, i) => {
    const at = new Date(Date.UTC(2026, 6, 1) + Math.floor(rand() * span));
    return { key: `i${i}`, posted: at.toISOString(), stamped: at, day: partsDay(at, zone) };
  });
  // "Last 90 days" on 2026-11-13, as the spec's example has it.
  const [first, last] = ["2026-08-15", "2026-11-13"];
  const expected = rows.filter((r) => (r.day as string) >= first && (r.day as string) <= last).map((r) => r.key);
  return ["posted", "stamped"].map((columnId) => ({
    name: `2,000 random instants in ${zone}: ${columnId} from ${first} to ${last}`,
    schema: schemaIn(zone),
    rows,
    state: stateWith({ columnId, operator: "between", value: { min: first, max: last } }),
    expected,
  }));
});

// --- Empty ----------------------------------------------------------------------------------------------------

const emptyRows: Row[] = [
  { key: "e0", owner: "Avery Lane", category: "travel", booked: "2026-01-31", posted: "2026-01-31T09:00:00Z", stamped: new Date(0) },
  { key: "e1", owner: null, category: null, booked: null, posted: null, stamped: null },
  { key: "e2", owner: "", category: "", booked: "", posted: "", stamped: "" },
  { key: "e3" },
  { key: "e4", owner: " ", category: "fees", booked: "not a date", posted: "soon", stamped: new Date(Number.NaN) },
];

const empties: RenderedCase[] = ["owner", "category", "booked", "posted", "stamped"].flatMap((columnId) => [
  {
    name: `${columnId} is empty`,
    schema: schemaIn("UTC"),
    rows: emptyRows,
    state: stateWith({ columnId, operator: "isEmpty" }),
    expected: ["e1", "e2", "e3"],
  },
  {
    name: `${columnId} is not empty`,
    schema: schemaIn("UTC"),
    rows: emptyRows,
    state: stateWith({ columnId, operator: "isNotEmpty" }),
    expected: ["e0", "e4"],
  },
]);

// --- Exact text -----------------------------------------------------------------------------------------------

const textRows: Row[] = [
  { key: "t0", owner: "Avery Lane", category: "travel", booked: "2026-01-30" },
  { key: "t1", owner: "avery lane", category: "fees", booked: "2026-01-31" },
  { key: "t2", owner: "AVERY LANE", category: "travel", booked: "2026-02-01" },
  { key: "t3", owner: "Avery Lanes", category: "travel", booked: "2026-01-31" },
  { key: "t4", owner: "Lane Avery", category: "Travel", booked: "2026-01-31" },
  { key: "t5", owner: null, category: null, booked: null },
  { key: "t6", owner: "", category: "", booked: "" },
];

const exactText: RenderedCase[] = [
  {
    name: "exact text ignores letter case and nothing else",
    schema: schemaIn("UTC"),
    rows: textRows,
    state: stateWith({ columnId: "owner", operator: "eq", value: "avery lane" }),
    expected: ["t0", "t1", "t2"],
  },
  {
    name: "containing text",
    schema: schemaIn("UTC"),
    rows: textRows,
    state: stateWith({ columnId: "owner", operator: "contains", value: "LANE" }),
    expected: ["t0", "t1", "t2", "t3", "t4"],
  },
  {
    name: "a category is its exact id",
    schema: schemaIn("UTC"),
    rows: textRows,
    state: stateWith({ columnId: "category", operator: "eq", value: "travel" }),
    expected: ["t0", "t2", "t3"],
  },
  {
    name: "exact text beside a whole day",
    schema: schemaIn("Pacific/Auckland"),
    rows: textRows,
    state: stateWith(
      { columnId: "owner", operator: "eq", value: "Avery Lane" },
      { columnId: "booked", operator: "gte", value: "2026-01-31" },
    ),
    expected: ["t1", "t2"],
  },
];

// --- Pinned columns and density (operation set spec, 5.3) -----------------------------------------------------

const pinRows: Row[] = [
  { key: "r1", booked: "2026-01-02", posted: null, stamped: null, owner: "Avery", category: "travel" },
  { key: "r2", booked: "2026-01-01", posted: null, stamped: null, owner: "Blake", category: "fees" },
];
const plain = schemaIn();
const pinState = (pins: ViewState["pinnedColumnIds"], more: Partial<ViewState> = {}): ViewState => ({
  ...emptyViewState(COLUMNS),
  pinnedColumnIds: pins,
  ...more,
});
const pinned: RenderedCase[] = [
  { name: "no pins: the column order", schema: plain, rows: pinRows, state: pinState({ start: [], end: [] }), columns: COLUMNS },
  {
    name: "start pins first, end pins last, each in its pin order",
    schema: plain,
    rows: pinRows,
    state: pinState({ start: ["owner", "key"], end: ["category", "booked"] }),
    columns: ["owner", "key", "posted", "stamped", "category", "booked"],
  },
  {
    name: "a reordered view, with one side pinned",
    schema: plain,
    rows: pinRows,
    state: pinState(
      { start: [], end: ["key"] },
      { columnOrder: ["category", "owner", "stamped", "posted", "booked", "key"], visibleColumnIds: [...COLUMNS] },
    ),
    columns: ["category", "owner", "stamped", "posted", "booked", "key"],
  },
  {
    name: "a hidden pinned column is in neither list",
    schema: plain,
    rows: pinRows,
    state: pinState(
      { start: ["owner", "posted"], end: ["stamped"] },
      { visibleColumnIds: ["key", "booked", "stamped", "owner", "category"] },
    ),
    columns: ["owner", "key", "booked", "category", "stamped"],
  },
  {
    name: "pins beside a sort and a filter",
    schema: plain,
    rows: pinRows,
    state: pinState(
      { start: ["owner"], end: [] },
      { sorts: [{ columnId: "booked", direction: "asc" }], filters: stateWith({ columnId: "owner", operator: "isNotEmpty" }).filters },
    ),
    expected: ["r2", "r1"],
  },
  ...(["compact", "comfortable", "spacious"] as const).map((density) => ({
    name: `${density} density`,
    schema: plain,
    rows: pinRows,
    state: pinState({ start: ["key"], end: [] }, { density }),
  })),
];

runRenderedRows("Pinned columns and density", pinned);

// The columns, pins and density both adapters draw for 400 seeded random views, half of them grouped. The rows, groups
// and totals of grouped views are compared in rendered-rows-groups.test.ts. On a grouped view TanStack Table
// puts the grouped columns first among the unpinned ones (`groupedFirst`); the views where that moves a column are
// counted, so the difference is seen, not hidden.
describe("Pinned columns and density, seeded random views: what both adapters draw", () => {
  let seed = 20261114;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  it("draws the same columns, pins and density, apart from TanStack's grouped columns first", async () => {
    let moved = 0;
    for (let n = 0; n < 400; n++) {
      const order = shuffle(COLUMNS);
      const pool = shuffle(COLUMNS);
      const k1 = Math.floor(random() * 3);
      const k2 = Math.floor(random() * 3);
      const state: ViewState = {
        ...emptyViewState(COLUMNS),
        columnOrder: order,
        visibleColumnIds: order.filter(() => random() < 0.75),
        pinnedColumnIds: { start: pool.slice(0, k1), end: pool.slice(k1, k1 + k2) },
        // A grouped column may be pinned or hidden too.
        groupBy: n % 2 === 0 ? [] : shuffle(COLUMNS).slice(0, 1 + Math.floor(random() * 2)),
        density: (["compact", "comfortable", "spacious"] as const)[Math.floor(random() * 3)] ?? "comfortable",
      };
      const c = { name: `view ${n}`, schema: plain, rows: pinRows, state };
      const rows = await renderWithRows(c);
      const table = await renderWithTanStack(c);
      expect(table.pinned, c.name).toEqual(rows.pinned);
      expect(table.density, c.name).toBe(rows.density);
      expect(table.columns, c.name).toEqual(groupedFirst(rows.columns, rows.pinned, state.groupBy));
      if (state.groupBy.length === 0) expect(table.columns, c.name).toEqual(rows.columns);
      else if (JSON.stringify(table.columns) !== JSON.stringify(rows.columns)) moved++;
    }
    // Measured on this seed (2026-11-14): of the 200 grouped views, 95 draw a grouped column in another place.
    expect(moved).toBe(95);
  });
});
runRenderedRows("Whole days", [...wholeDays, ...browserZone, ...randomInstants]);
runRenderedRows("Empty", empties);
runRenderedRows("Exact text", exactText);
