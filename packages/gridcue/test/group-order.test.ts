import { describe, expect, it } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { type AggregationSpec, emptyViewState, type FilterGroup, type SortSpec, type ViewState } from "../src/core/protocol";
import { applyView, createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";

// What `applyView` gives for a view with totals, and the one group order both Grid Adapters draw (operation set spec,
// 5.4; ADR 0030). Written before the code, as its contract. The group orders here are the ones TanStack Table 9 draws
// for the same rows and view with `gridcueAggregationFn` registered: each was run on a real table before it was
// written down, since the rendered-rows test will hold the two adapters to the same order.
//
// A test marked "OPEN:" pins a detail the spec leaves open, with the reading judged right here. The lead settles each.
const schema = defineSchema([
  { id: "key" },
  { id: "team" },
  { id: "desk" },
  { id: "value", kind: "currency" },
  { id: "units", kind: "number" },
  { id: "share", kind: "percent" },
]);
const base = emptyViewState(schema.columns.map((c) => c.id));
type Row = { key: string; team?: string | null; desk?: string; value?: unknown; units?: number | null; share?: number | null };

const view = (rows: readonly Row[], state: Partial<ViewState> = {}) => applyView(rows, { ...base, ...state }, schema);
const sum = (columnId: string): AggregationSpec => ({ columnId, function: "sum" });
const avg = (columnId: string): AggregationSpec => ({ columnId, function: "avg" });
const desc = (columnId: string): SortSpec => ({ columnId, direction: "desc" });
const asc = (columnId: string): SortSpec => ({ columnId, direction: "asc" });
const over = (columnId: string, value: number): FilterGroup => ({
  id: "root",
  type: "group",
  combinator: "and",
  children: [{ id: "f", type: "predicate", columnId, operator: "gt", value }],
});

type Shown = ReturnType<typeof view>;
/** Each total's value, by its column. */
const valuesOf = (list: ReadonlyArray<{ columnId: string; value: number | null }>) =>
  Object.fromEntries(list.map((t) => [t.columnId, t.value]));
/** A group's name: its key's values, outermost first, joined with "/". */
const nameOf = (group: { key: Record<string, unknown> }) => Object.values(group.key).join("/");
/** The groups in the order they are drawn. */
const order = (result: Shown) => result.groups?.map(nameOf);
/** The rows of each group, in the order they are drawn, by key. */
const rowsIn = (result: Shown) => Object.fromEntries((result.groups ?? []).map((g) => [nameOf(g), g.rows.map((r) => r.key)]));
/** Each group's totals, by the group's name. */
const totalsIn = (result: Shown) => Object.fromEntries((result.groups ?? []).map((g) => [nameOf(g), valuesOf(g.totals)]));

describe("Rows Adapter: renders totals (spec 4.2; ADR 0029)", () => {
  it("lists aggregation.set only when renders names totals", () => {
    const today = [...MVP_OPERATIONS, "limit.set"];
    expect(createRowsAdapter({ schema }).getCapabilities().operations).toEqual(today);
    expect(createRowsAdapter({ schema, renders: ["pinning", "density"] }).getCapabilities().operations).not.toContain("aggregation.set");
    expect(createRowsAdapter({ schema, renders: ["totals"] }).getCapabilities().operations).toEqual([...today, "aggregation.set"]);
    expect(createRowsAdapter({ schema, renders: ["totals", "density", "pinning"] }).getCapabilities().operations).toEqual([
      ...today,
      "columns.pin",
      "density.set",
      "aggregation.set",
    ]);
  });
});

describe("applyView: what a total counts (spec 5.4; ADR 0030)", () => {
  const rows: Row[] = [
    { key: "r1", team: "blue", value: 10, units: 1 },
    { key: "r2", team: "red", value: 60, units: 2 },
    { key: "r3", team: "blue", value: 20, units: 3 },
    { key: "r4", team: "green", value: 5, units: 4 },
  ];
  const both = [sum("value"), avg("units")];

  it("gives one total for each total of the view, over every row it shows, in the view's order", () => {
    // OPEN: the spec names `ViewResult.totals` and gives it no shape. Each entry says its column, which total it is,
    // and the value, so a Host can draw the word "total" or "avg" beside it (spec section 9). An empty total is `null`.
    const result = view(rows, { aggregations: both });
    expect(result.totals).toEqual([
      { columnId: "value", function: "sum", value: 95 },
      { columnId: "units", function: "avg", value: 2.5 },
    ]);
    expect(result.groups).toBeUndefined();
    expect(view(rows, { aggregations: [avg("units"), sum("value")] }).totals.map((t) => t.columnId)).toEqual(["units", "value"]);
  });

  it("gives no totals for a view that has none, grouped or not", () => {
    expect(view(rows).totals).toEqual([]);
    const grouped = view(rows, { groupBy: ["team"] });
    expect(grouped.totals).toEqual([]);
    expect(grouped.groups?.map((g) => g.totals)).toEqual([[], [], []]);
  });

  it("gives each group its totals over its own rows, and still the totals of the whole view", () => {
    const result = view(rows, { aggregations: both, groupBy: ["team"] });
    expect(totalsIn(result)).toEqual({
      blue: { value: 30, units: 2 },
      red: { value: 60, units: 2 },
      green: { value: 5, units: 4 },
    });
    expect(result.groups?.[0]?.totals).toEqual([
      { columnId: "value", function: "sum", value: 30 },
      { columnId: "units", function: "avg", value: 2 },
    ]);
    // The whole view's average is over its rows (2.5), not an average of the groups' averages (2.67).
    expect(valuesOf(result.totals)).toEqual({ value: 95, units: 2.5 });
  });

  it("counts only the rows the filters keep", () => {
    const result = view(rows, { aggregations: both, groupBy: ["team"], filters: over("value", 8) });
    expect(result.rows.map((r) => r.key)).toEqual(["r1", "r2", "r3"]);
    expect(valuesOf(result.totals)).toEqual({ value: 90, units: 2 });
    expect(totalsIn(result)).toEqual({ blue: { value: 30, units: 2 }, red: { value: 60, units: 2 } });
  });

  it("counts only the rows the count keeps", () => {
    // The first 2 by Market value: r2 (60) and r3 (20). The blue group shows one of its two rows, and totals that one.
    const result = view(rows, { aggregations: both, sorts: [desc("value")], limit: 2 });
    expect(result.rows.map((r) => r.key)).toEqual(["r2", "r3"]);
    expect(valuesOf(result.totals)).toEqual({ value: 80, units: 2.5 });
    const grouped = view(rows, { aggregations: both, sorts: [desc("value")], limit: 2, groupBy: ["team"] });
    expect(totalsIn(grouped)).toEqual({ red: { value: 60, units: 2 }, blue: { value: 20, units: 3 } });
    expect(valuesOf(grouped.totals)).toEqual({ value: 80, units: 2.5 });
  });

  it("counts after the filters and the count together", () => {
    const result = view(rows, { aggregations: both, filters: over("value", 8), sorts: [asc("value")], limit: 2 });
    expect(result.rows.map((r) => r.key)).toEqual(["r1", "r3"]);
    expect(valuesOf(result.totals)).toEqual({ value: 30, units: 2 });
  });

  it("leaves out a row the count leaves out because it has no value to be counted by", () => {
    // A row with no value in the first sorted column never fills a count (ADR 0027), so it is not shown, and its
    // other columns are in no total.
    const more: Row[] = [...rows, { key: "r5", team: "blue", value: null, units: 9 }];
    const result = view(more, { aggregations: [sum("units")], sorts: [desc("value")], limit: 10 });
    expect(result.rows.map((r) => r.key)).toEqual(["r2", "r3", "r1", "r4"]);
    expect(valuesOf(result.totals)).toEqual({ units: 10 });
    // With no count the row is shown, and counted.
    expect(valuesOf(view(more, { aggregations: [sum("units")], sorts: [desc("value")] }).totals)).toEqual({ units: 19 });
  });
});

describe("applyView: empty values in a total (spec 5.4)", () => {
  // No value is what it is for a count (order plan, section 11): `null`, a missing key, an empty string and `NaN`.
  const gaps: Row[] = [
    { key: "g1", team: "blue", value: 10 },
    { key: "g2", team: "blue", value: null },
    { key: "g3", team: "blue" },
    { key: "g4", team: "blue", value: "" },
    { key: "g5", team: "blue", value: Number.NaN },
    { key: "g6", team: "blue", value: 20 },
    { key: "g7", team: "red", value: null },
    { key: "g8", team: "red" },
  ];

  it("skips them in a sum", () => {
    expect(valuesOf(view(gaps, { aggregations: [sum("value")] }).totals)).toEqual({ value: 30 });
  });

  it("takes an average over the rows that have a value, not over every row", () => {
    // 30 over the 2 rows with a value is 15. Over the 6 blue rows it would be 5, and over all 8 it would be 3.75.
    expect(valuesOf(view(gaps, { aggregations: [avg("value")] }).totals)).toEqual({ value: 15 });
    expect(totalsIn(view(gaps, { aggregations: [avg("value")], groupBy: ["team"] })).blue).toEqual({ value: 15 });
  });

  it("gives a group with no values an empty total, never 0", () => {
    for (const total of [sum("value"), avg("value")]) {
      const result = view(gaps, { aggregations: [total], groupBy: ["team"] });
      expect(totalsIn(result).red, total.function).toEqual({ value: null });
      expect(result.groups?.[1]?.totals, total.function).toEqual([{ columnId: "value", function: total.function, value: null }]);
    }
  });

  it("gives a view with no values an empty total, never 0", () => {
    const none = gaps.filter((r) => r.team === "red");
    expect(view(none, { aggregations: [sum("value")] }).totals).toEqual([{ columnId: "value", function: "sum", value: null }]);
    expect(view(none, { aggregations: [avg("value")] }).totals).toEqual([{ columnId: "value", function: "avg", value: null }]);
    // No rows at all: none given, or none the filters keep.
    expect(view([], { aggregations: [sum("value")] }).totals).toEqual([{ columnId: "value", function: "sum", value: null }]);
    const filtered = view(gaps, { aggregations: [sum("value"), avg("units")], filters: over("value", 1000) });
    expect(filtered.rows).toEqual([]);
    expect(valuesOf(filtered.totals)).toEqual({ value: null, units: null });
  });

  it("counts a 0 as a value: a total of 0 is 0, and a 0 is in an average's count", () => {
    const zeros: Row[] = [
      { key: "z1", team: "blue", value: 0 },
      { key: "z2", team: "blue", value: 10 },
      { key: "z3", team: "red", value: 0 },
      { key: "z4", team: "green", value: -5.5 },
      { key: "z5", team: "green", value: 5.5 },
    ];
    expect(totalsIn(view(zeros, { aggregations: [sum("value")], groupBy: ["team"] }))).toEqual({
      blue: { value: 10 },
      red: { value: 0 },
      green: { value: 0 },
    });
    expect(totalsIn(view(zeros, { aggregations: [avg("value")], groupBy: ["team"] }))).toEqual({
      blue: { value: 5 },
      red: { value: 0 },
      green: { value: 0 },
    });
  });

  it("counts only numbers: text in a number column, and a number that has no end, are skipped", () => {
    // OPEN: the spec says "empty values are skipped" and doesn't say what a cell of the wrong type is. A filter never
    // compares such a cell as a number, and a total of "5" and 10 has no one answer, so it is skipped like an empty one.
    const odd: Row[] = [
      { key: "o1", team: "blue", value: "5" },
      { key: "o2", team: "blue", value: 10 },
      { key: "o3", team: "blue", value: Number.POSITIVE_INFINITY },
      { key: "o4", team: "blue", value: true },
    ];
    expect(valuesOf(view(odd, { aggregations: [sum("value")] }).totals)).toEqual({ value: 10 });
    expect(valuesOf(view(odd, { aggregations: [avg("value")] }).totals)).toEqual({ value: 10 });
  });
});

describe("applyView: a total is arithmetic a User can check (spec 5.4)", () => {
  // The rule: a sum is the exact sum of the values as they are written, in decimal, rounded once at the end. A cell
  // that shows 0.1 is one tenth, though the number the computer keeps for it is a hair more. Adding those numbers one
  // after another keeps each hair: 0.1 + 0.2 comes to 0.30000000000000004, a thousand cents come to 9.999999999999831,
  // and the last digit depends on the order of the rows. Money is written in decimal, so the total a User adds up by
  // hand from the cells is the decimal one. And the two Grid Adapters add the same rows in different orders, so only a
  // sum that doesn't depend on order gives both the same number to the last digit.
  const totalOf = (values: readonly unknown[], total = sum("value")) =>
    view(
      values.map((value, i) => ({ key: `k${i}`, team: "a", value })),
      { aggregations: [total] },
    ).totals[0]?.value;

  it("adds 0.1 and 0.2 to 0.3", () => {
    expect(totalOf([0.1, 0.2])).toBe(0.3);
    expect(totalOf([0.1, 0.2, 0.3])).toBe(0.6);
    expect(totalOf([0.3, 0.2, 0.1])).toBe(0.6);
    expect(totalOf([0.7, 0.1])).toBe(0.8);
    expect(totalOf([1.1, 2.2])).toBe(3.3);
  });

  it("adds money with cents without drift", () => {
    expect(totalOf(Array.from({ length: 1000 }, () => 0.01))).toBe(10);
    expect(totalOf([19.99, 0.01, 5.05])).toBe(25.05);
    expect(totalOf([1234.56, -1234.55])).toBe(0.01);
  });

  // 5,000 amounts in whole cents, from -50,000.00 to 150,000.00, made from a fixed seed.
  const amounts = () => {
    let seed = 20261114;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const cents = Array.from({ length: 5000 }, () => Math.round(next() * 20_000_000) - 5_000_000);
    return { cents, values: cents.map((c) => c / 100) };
  };

  it("gives the sum of the whole cents, for 5,000 amounts", () => {
    const { cents, values } = amounts();
    // Whole numbers add exactly, so this is the sum to the cent, divided once.
    const exact = cents.reduce((a, b) => a + b, 0) / 100;
    expect(totalOf(values)).toBe(exact);
    // The plain running sum is not that number here: the test would pass a sum that drifts otherwise.
    expect(values.reduce((a, b) => a + b, 0)).not.toBe(exact);
  });

  it("gives the same sum whatever order the rows are in", () => {
    const { values } = amounts();
    const first = totalOf(values);
    expect(totalOf([...values].reverse())).toBe(first);
    expect(totalOf([...values].sort((a, b) => a - b))).toBe(first);
    expect(totalOf([...values].sort((a, b) => b - a))).toBe(first);
    // Large and small together, where a running sum loses the small one.
    expect(totalOf([1e16, 1, -1e16])).toBe(1);
    expect(totalOf([1, 1e16, -1e16])).toBe(1);
    expect(totalOf([-1e16, 1e16, 1])).toBe(1);
  });

  it("gives every group, and the whole view, a sum that doesn't drift", () => {
    const rows: Row[] = [
      { key: "d1", team: "blue", value: 0.1 },
      { key: "d2", team: "red", value: 0.7 },
      { key: "d3", team: "blue", value: 0.2 },
      { key: "d4", team: "red", value: 0.1 },
    ];
    const result = view(rows, { aggregations: [sum("value")], groupBy: ["team"] });
    expect(totalsIn(result)).toEqual({ blue: { value: 0.3 }, red: { value: 0.8 } });
    expect(result.totals[0]?.value).toBe(1.1);
  });

  it("takes an average as that sum over the count of rows with a value", () => {
    expect(totalOf([10, 20], avg("value"))).toBe(15);
    // 0.3 over 2. The running sum 0.30000000000000004 over 2 would be 0.15000000000000002.
    expect(totalOf([0.1, 0.2], avg("value"))).toBe(0.15);
    expect(totalOf([0.1, null, 0.2, undefined, ""], avg("value"))).toBe(0.15);
    const { cents, values } = amounts();
    // The sum in whole cents, divided once by 100 times the count.
    expect(totalOf(values, avg("value"))).toBe(cents.reduce((a, b) => a + b, 0) / (100 * values.length));
    expect(totalOf([...values].reverse(), avg("value"))).toBe(totalOf(values, avg("value")));
  });

  it("doesn't round an average: it is the exact sum divided once, and the Host formats it", () => {
    // OPEN: the spec doesn't say how an average is rounded. Most averages have no last digit (5 over 3), so GridCue
    // rounds to no number of decimals; the Host formats the cell as it formats the column's other cells. The value is
    // the exact decimal sum divided once by the count, so it is the number nearest the exact average: 0.6 over 3 is
    // 0.2, and three cells of 0.117 average 0.117. Dividing the rounded sum again would give 0.19999999999999998 and
    // 0.11699999999999999.
    expect(totalOf([1, 2, 2], avg("value"))).toBe(5 / 3);
    expect(totalOf([0.1, 0.2, 0.3], avg("value"))).toBe(0.2);
    expect(totalOf([0.117, 0.117, 0.117], avg("value"))).toBe(0.117);
    expect(totalOf([10.01, 10.02], avg("value"))).toBe(10.015);
  });

  /** The exact sum of the decimals `values` print as, as the number nearest it: what a User adds up by hand. */
  const exactSum = (values: readonly number[], count = 1) => {
    const scaled = values.map((v) => {
      const [mantissa = "0", exponent = "0"] = String(v).split("e");
      const [whole = "0", fraction = ""] = mantissa.replace("-", "").split(".");
      return { digits: BigInt(`${v < 0 ? "-" : ""}${whole}${fraction}`), scale: fraction.length - Number(exponent) };
    });
    const scale = Math.max(0, ...scaled.map((s) => s.scale));
    const total = scaled.reduce((t, s) => t + s.digits * 10n ** BigInt(scale - s.scale), 0n) * 10n ** 40n;
    const negative = total < 0n;
    const digits = ((negative ? -total : total) / BigInt(count)).toString().padStart(scale + 41, "0");
    return Number(`${negative ? "-" : ""}${digits.slice(0, -(scale + 40))}.${digits.slice(-(scale + 40))}`);
  };

  it("adds values with 16 or 17 significant digits exactly too", () => {
    // Scaled to a whole number, 123456789012.34567 is past 2^53, where the scaling itself is off by a unit. Such a
    // value is added as the decimal it prints as.
    expect(totalOf([123456789012.34567, 0.00001])).toBe(exactSum([123456789012.34567, 0.00001]));
    expect(totalOf([-182129561901092.53, 0.01, 99999999999999.98])).toBe(exactSum([-182129561901092.53, 0.01, 99999999999999.98]));
    // Amounts near 10^14 with cents, values with nine decimals and tiny values, mixed: the exact sum, in any order.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const draw = () => {
      const x = next();
      if (x < 0.3) return Math.round((next() - 0.5) * 1e17) / 100;
      if (x < 0.6) return Number(((next() - 0.5) * 1e6).toFixed(Math.floor(next() * 10)));
      if (x < 0.8) return (next() - 0.5) * 10 ** Math.floor(next() * 20 - 10);
      return Math.round(next() * 1e9) / 100;
    };
    for (let i = 0; i < 2000; i++) {
      const values = Array.from({ length: 1 + Math.floor(next() * 20) }, draw);
      expect(totalOf(values), JSON.stringify(values)).toBe(exactSum(values));
      expect(totalOf([...values].reverse())).toBe(exactSum(values));
      expect(totalOf(values, avg("value")), JSON.stringify(values)).toBe(exactSum(values, values.length));
    }
  });

  it("gives an average of a percent column as the cells hold it: a fraction", () => {
    // OPEN: a percent column holds fractions (0.25 for 25%), and its average is a fraction too, for the Host to format
    // as it formats the column's cells. GridCue doesn't multiply by 100.
    const rows: Row[] = [
      { key: "s1", team: "blue", share: 0.1 },
      { key: "s2", team: "blue", share: 0.25 },
      { key: "s3", team: "blue", share: null },
    ];
    expect(view(rows, { aggregations: [avg("share")] }).totals).toEqual([{ columnId: "share", function: "avg", value: 0.175 }]);
  });
});

describe("applyView: one group order (spec 5.4's table; ADR 0030)", () => {
  describe("grouped, and sorted on a column with a total: by the total", () => {
    // The spec's own case: a group with 60 and 60 against a group with 100.
    const rows: Row[] = [
      { key: "a1", team: "blue", value: 60 },
      { key: "a2", team: "red", value: 100 },
      { key: "a3", team: "blue", value: 60 },
    ];

    it("puts the larger sum first in a descending sort, not the group with the largest row", () => {
      // Before this, red came first: it holds the largest row.
      const result = view(rows, { groupBy: ["team"], sorts: [desc("value")], aggregations: [sum("value")] });
      expect(order(result)).toEqual(["blue", "red"]);
      expect(totalsIn(result)).toEqual({ blue: { value: 120 }, red: { value: 100 } });
    });

    it("puts the smaller sum first in an ascending sort", () => {
      const result = view(rows, { groupBy: ["team"], sorts: [asc("value")], aggregations: [sum("value")] });
      expect(order(result)).toEqual(["red", "blue"]);
    });

    it("ranks by the average when that is the column's total", () => {
      const down = view(rows, { groupBy: ["team"], sorts: [desc("value")], aggregations: [avg("value")] });
      expect(order(down)).toEqual(["red", "blue"]);
      expect(totalsIn(down)).toEqual({ red: { value: 100 }, blue: { value: 60 } });
      const up = view(rows, { groupBy: ["team"], sorts: [asc("value")], aggregations: [avg("value")] });
      expect(order(up)).toEqual(["blue", "red"]);
    });

    it("ranks by the total of the rows the view shows", () => {
      // The filter leaves blue one of its two rows: it then totals 60, and red's 100 comes first.
      const marked: Row[] = [
        { key: "a1", team: "blue", value: 60, units: 1 },
        { key: "a2", team: "red", value: 100, units: 1 },
        { key: "a3", team: "blue", value: 60, units: 0 },
      ];
      const state = { groupBy: ["team"], sorts: [desc("value")], aggregations: [sum("value")] };
      expect(order(view(marked, state))).toEqual(["blue", "red"]);
      const filtered = view(marked, { ...state, filters: over("units", 0) });
      expect(totalsIn(filtered)).toEqual({ red: { value: 100 }, blue: { value: 60 } });
      expect(order(filtered)).toEqual(["red", "blue"]);
    });

    it("skips empty values in the total it ranks by", () => {
      const gaps: Row[] = [
        { key: "e2", team: "low", value: null },
        { key: "e3", team: "low", value: 50 },
        { key: "e4", team: "high", value: 40 },
        { key: "e5", team: "high", value: 30 },
      ];
      // "Low" holds the largest row (50) and totals 50; "high" totals 70.
      expect(order(view(gaps, { groupBy: ["team"], sorts: [desc("value")], aggregations: [sum("value")] }))).toEqual(["high", "low"]);
      expect(order(view(gaps, { groupBy: ["team"], sorts: [asc("value")], aggregations: [sum("value")] }))).toEqual(["low", "high"]);
    });
  });

  describe("grouped, and sorted on a column with no total: the order groups first appear in the rows before sorting", () => {
    const rows: Row[] = [
      { key: "b1", team: "blue", value: 5, units: 1 },
      { key: "b2", team: "red", value: 100, units: 1 },
      { key: "b3", team: "green", value: 50, units: 9 },
      { key: "b4", team: "blue", value: 70, units: 1 },
    ];

    it("keeps that order in a descending sort, and sorts the rows inside each group", () => {
      // Before this, the groups came red, blue, green: by each group's largest row.
      const result = view(rows, { groupBy: ["team"], sorts: [desc("value")] });
      expect(order(result)).toEqual(["blue", "red", "green"]);
      expect(rowsIn(result)).toEqual({ blue: ["b4", "b1"], red: ["b2"], green: ["b3"] });
    });

    it("keeps that order in an ascending sort", () => {
      // Before this, the groups came blue, green, red: by each group's smallest row.
      const result = view(rows, { groupBy: ["team"], sorts: [asc("value")] });
      expect(order(result)).toEqual(["blue", "red", "green"]);
      expect(rowsIn(result)).toEqual({ blue: ["b1", "b4"], red: ["b2"], green: ["b3"] });
    });

    it("keeps that order when another column has the total", () => {
      // The total of Units would put green first, and the largest Market value would put red first. Neither is asked.
      const result = view(rows, { groupBy: ["team"], sorts: [desc("value")], aggregations: [sum("units")] });
      expect(order(result)).toEqual(["blue", "red", "green"]);
      expect(totalsIn(result)).toEqual({ blue: { units: 2 }, red: { units: 1 }, green: { units: 9 } });
    });

    it("keeps that order with no sort at all, as today", () => {
      expect(order(view(rows, { groupBy: ["team"] }))).toEqual(["blue", "red", "green"]);
      expect(order(view(rows, { groupBy: ["team"], aggregations: [sum("value")] }))).toEqual(["blue", "red", "green"]);
    });

    it("counts first appearance among the rows the view shows, in the Host's order", () => {
      const counted: Row[] = [
        { key: "c1", team: "a", value: 1 },
        { key: "c2", team: "b", value: 8 },
        { key: "c3", team: "c", value: 9 },
        { key: "c4", team: "a", value: 7 },
        { key: "c5", team: "b", value: 2 },
      ];
      // The first 3 by Market value are c3, c2 and c4. In the Host's order they are c2, c3, c4: groups b, c, a. Group a
      // first appears at c1, which the view doesn't show, and the sorted order would put c first.
      const result = view(counted, { groupBy: ["team"], sorts: [desc("value")], limit: 3 });
      expect(result.rows.map((r) => r.key)).toEqual(["c3", "c2", "c4"]);
      expect(order(result)).toEqual(["b", "c", "a"]);
      expect(rowsIn(result)).toEqual({ b: ["c2"], c: ["c3"], a: ["c4"] });
      // With a total on the sorted column, the same rows rank by it.
      const ranked = view(counted, { groupBy: ["team"], sorts: [desc("value")], limit: 3, aggregations: [sum("value")] });
      expect(order(ranked)).toEqual(["c", "b", "a"]);
      expect(totalsIn(ranked)).toEqual({ c: { value: 9 }, b: { value: 8 }, a: { value: 7 } });
      // And among the rows the filters keep.
      const filtered = view(counted, { groupBy: ["team"], sorts: [asc("value")], filters: over("value", 1) });
      expect(order(filtered)).toEqual(["b", "c", "a"]);
    });
  });

  describe("ties between groups", () => {
    const rows: Row[] = [
      { key: "t1", team: "x", value: 60 },
      { key: "t2", team: "y", value: 100 },
      { key: "t3", team: "x", value: 60 },
      { key: "t4", team: "z", value: 120 },
    ];

    it("keeps groups with the same total in the order they first appear, descending and ascending", () => {
      // OPEN: the spec doesn't say how a tie between groups is broken. X and Z both total 120. They keep the order they
      // first appear in the rows, in both directions: a descending sort doesn't turn a tie around. TanStack Table
      // draws this order.
      expect(order(view(rows, { groupBy: ["team"], sorts: [desc("value")], aggregations: [sum("value")] }))).toEqual(["x", "z", "y"]);
      expect(order(view(rows, { groupBy: ["team"], sorts: [asc("value")], aggregations: [sum("value")] }))).toEqual(["y", "x", "z"]);
    });
  });

  describe("a group with an empty total", () => {
    const rows: Row[] = [
      { key: "e1", team: "none", value: null },
      { key: "e2", team: "low", value: null },
      { key: "e3", team: "low", value: 50 },
      { key: "e4", team: "high", value: 40 },
      { key: "e5", team: "high", value: 30 },
      { key: "e6", team: "none" },
      { key: "e7", team: "void", value: null },
    ];

    it("is never ranked as 0", () => {
      const withNegative: Row[] = [...rows, { key: "e8", team: "debt", value: -10 }];
      const result = view(withNegative, { groupBy: ["team"], sorts: [desc("value")], aggregations: [sum("value")] });
      expect(totalsIn(result)).toEqual({
        none: { value: null },
        void: { value: null },
        high: { value: 70 },
        low: { value: 50 },
        debt: { value: -10 },
      });
      // Ranked as 0, the empty groups would sit between "low" and "debt". They sit together, at one end.
      const names = order(result) ?? [];
      expect(names.filter((n) => n !== "none" && n !== "void")).toEqual(["high", "low", "debt"]);
      expect(Math.abs(names.indexOf("none") - names.indexOf("void"))).toBe(1);
      expect([0, names.length - 2]).toContain(Math.min(names.indexOf("none"), names.indexOf("void")));
    });

    it("sits where a row with no value sits in applyView's sort: last ascending, first descending", () => {
      // OPEN: the spec leaves out where a row with no value sits in a sort (section 3), and says nothing of a group
      // with an empty total. This is the place both adapters can draw: TanStack Table puts such a group there, and it
      // can't be moved from outside the Host's column definitions. The cost: "Rank households by total Market value"
      // shows a household with no values first. Empty groups keep the order they first appear among themselves.
      expect(order(view(rows, { groupBy: ["team"], sorts: [desc("value")], aggregations: [sum("value")] }))).toEqual([
        "none",
        "void",
        "high",
        "low",
      ]);
      expect(order(view(rows, { groupBy: ["team"], sorts: [asc("value")], aggregations: [sum("value")] }))).toEqual([
        "low",
        "high",
        "none",
        "void",
      ]);
    });
  });

  describe("rows inside each group", () => {
    const rows: Row[] = [
      { key: "i1", team: "a", value: 5, units: 2 },
      { key: "i2", team: "b", value: 9, units: 1 },
      { key: "i3", team: "a", value: 9, units: 1 },
      { key: "i4", team: "a", value: 5, units: 1 },
      { key: "i5", team: "b", value: 1, units: 1 },
      { key: "i6", team: "a", value: 7, units: 3 },
    ];

    it("are sorted as today, whichever way the groups are ordered", () => {
      for (const aggregations of [[], [sum("value")], [sum("units")]]) {
        const down = view(rows, { groupBy: ["team"], sorts: [desc("value")], aggregations });
        expect(rowsIn(down), JSON.stringify(aggregations)).toEqual({ a: ["i3", "i6", "i1", "i4"], b: ["i2", "i5"] });
        const up = view(rows, { groupBy: ["team"], sorts: [asc("value")], aggregations });
        expect(rowsIn(up), JSON.stringify(aggregations)).toEqual({ a: ["i1", "i4", "i6", "i3"], b: ["i5", "i2"] });
      }
    });

    it("follow every sort of the view, in order", () => {
      const result = view(rows, { groupBy: ["team"], sorts: [asc("value"), asc("units")], aggregations: [sum("value")] });
      expect(rowsIn(result)).toEqual({ a: ["i4", "i1", "i6", "i3"], b: ["i5", "i2"] });
    });

    it("keep the Host's order when the view has no sort", () => {
      expect(rowsIn(view(rows, { groupBy: ["team"], aggregations: [sum("value")] }))).toEqual({
        a: ["i1", "i3", "i4", "i6"],
        b: ["i2", "i5"],
      });
    });

    it("keep a row with no value where applyView's sort puts it today", () => {
      // Out of scope here (spec section 3): where a row with no value sits in a sort. It must not move in this PR.
      const gaps: Row[] = [
        { key: "j1", team: "a", value: 5 },
        { key: "j2", team: "a", value: null },
        { key: "j3", team: "a", value: 9 },
      ];
      expect(rowsIn(view(gaps, { groupBy: ["team"], sorts: [desc("value")], aggregations: [sum("value")] }))).toEqual({
        a: ["j2", "j3", "j1"],
      });
      expect(rowsIn(view(gaps, { groupBy: ["team"], sorts: [asc("value")], aggregations: [sum("value")] }))).toEqual({
        a: ["j1", "j3", "j2"],
      });
    });

    it("leaves `rows` as the sorted rows of the whole view, as today", () => {
      const result = view(rows, { groupBy: ["team"], sorts: [desc("value")], aggregations: [sum("value")] });
      expect(result.rows.map((r) => r.key)).toEqual(["i2", "i3", "i6", "i1", "i4", "i5"]);
    });
  });

  describe("two grouping levels", () => {
    // `applyView` keeps one group for each full key, as today (spec section 3). TanStack Table draws the levels nested:
    // every Desk group of a Team under that Team. So that both draw the same order, the groups of one Team sit
    // together. The Teams are ordered first, each by the total of all its rows, then the Desks inside each Team.
    const rows: Row[] = [
      { key: "n1", team: "blue", desk: "east", value: 10 },
      { key: "n2", team: "red", desk: "east", value: 50 },
      { key: "n3", team: "blue", desk: "west", value: 70 },
      { key: "n4", team: "red", desk: "west", value: 5 },
      { key: "n5", team: "blue", desk: "east", value: 15 },
      { key: "n6", team: "green", desk: "west", value: 60 },
    ];
    const levels = ["team", "desk"];

    it("keeps one group for each full key, with its own totals", () => {
      const result = view(rows, { groupBy: levels, aggregations: [sum("value")] });
      expect(result.groups?.map((g) => g.key)).toHaveLength(5);
      expect(result.groups?.find((g) => nameOf(g) === "blue/east")?.key).toEqual({ team: "blue", desk: "east" });
      expect(totalsIn(result)).toEqual({
        "blue/east": { value: 25 },
        "blue/west": { value: 70 },
        "red/east": { value: 50 },
        "red/west": { value: 5 },
        "green/west": { value: 60 },
      });
      expect(valuesOf(result.totals)).toEqual({ value: 210 });
    });

    it("keeps the groups of one outer group together, in the order each first appears", () => {
      // OPEN: this changes a view requests reach today that the spec's table doesn't list: grouped by two columns, with
      // no sort or a sort on a column with no total. Today the groups come in the order each full key first appears:
      // blue/east, red/east, blue/west, red/west, green/west. TanStack Table draws the order below, and the
      // rendered-rows test can only pass with one order.
      const nested = ["blue/east", "blue/west", "red/east", "red/west", "green/west"];
      expect(order(view(rows, { groupBy: levels }))).toEqual(nested);
      expect(order(view(rows, { groupBy: levels, aggregations: [sum("value")] }))).toEqual(nested);
      const sorted = view(rows, { groupBy: levels, sorts: [desc("value")] });
      expect(order(sorted)).toEqual(nested);
      expect(rowsIn(sorted)["blue/east"]).toEqual(["n5", "n1"]);
    });

    it("orders the outer groups by their total, then the groups inside each by theirs", () => {
      // OPEN: the spec's table says "by the total" and not which group's. Blue totals 95 (west 70, east 25), green 60,
      // red 55 (east 50, west 5). By each full key's total alone, green/west would split the blue groups.
      const down = view(rows, { groupBy: levels, sorts: [desc("value")], aggregations: [sum("value")] });
      expect(order(down)).toEqual(["blue/west", "blue/east", "green/west", "red/east", "red/west"]);
      expect(rowsIn(down)["blue/east"]).toEqual(["n5", "n1"]);
      const up = view(rows, { groupBy: levels, sorts: [asc("value")], aggregations: [sum("value")] });
      expect(order(up)).toEqual(["red/west", "red/east", "green/west", "blue/east", "blue/west"]);
    });

    it("takes an outer group's average over its rows, not over its groups' averages", () => {
      // OPEN: as above. P has three rows of 10 at east and one of 100 at west: 32.5 over its rows. Q has one row of 40.
      // An average of P's two averages would be 55, and would put P first.
      const uneven: Row[] = [
        { key: "p1", team: "p", desk: "east", value: 10 },
        { key: "p2", team: "q", desk: "east", value: 40 },
        { key: "p3", team: "p", desk: "east", value: 10 },
        { key: "p4", team: "p", desk: "west", value: 100 },
        { key: "p5", team: "p", desk: "east", value: 10 },
      ];
      const result = view(uneven, { groupBy: levels, sorts: [desc("value")], aggregations: [avg("value")] });
      expect(order(result)).toEqual(["q/east", "p/west", "p/east"]);
      expect(valuesOf(result.totals)).toEqual({ value: 34 });
    });
  });

  describe("a sort on a grouping column", () => {
    const rows: Row[] = [
      { key: "b1", team: "blue", desk: "east", value: 5 },
      { key: "b2", team: "red", desk: "west", value: 100 },
      { key: "b3", team: "green", desk: "east", value: 50 },
      { key: "b4", team: "blue", desk: "west", value: 70 },
    ];

    it("orders the groups by that column's value, as today", () => {
      // OPEN: the spec's table has two rows, and a grouping column has no total, so its second row would leave these
      // groups in the order they first appear: "group by team, sort by team descending" would change nothing a User
      // sees. Every row of a group holds the same value there, so sorting the rows by it orders the groups by it.
      // `applyView` does this today, and TanStack Table draws it.
      expect(order(view(rows, { groupBy: ["team"], sorts: [desc("team")] }))).toEqual(["red", "green", "blue"]);
      expect(order(view(rows, { groupBy: ["team"], sorts: [asc("team")] }))).toEqual(["blue", "green", "red"]);
      expect(order(view(rows, { groupBy: ["team"], sorts: [desc("team")], aggregations: [sum("value")] }))).toEqual([
        "red",
        "green",
        "blue",
      ]);
    });

    it("orders only the level that column groups", () => {
      // OPEN: as above, for two levels. A sort on Desk orders the Desks inside each Team; the Teams keep the order
      // they first appear. A sort on Team orders the Teams; the Desks inside each keep theirs.
      expect(order(view(rows, { groupBy: ["team", "desk"], sorts: [desc("desk")] }))).toEqual([
        "blue/west",
        "blue/east",
        "red/west",
        "green/east",
      ]);
      expect(order(view(rows, { groupBy: ["team", "desk"], sorts: [desc("team")] }))).toEqual([
        "red/west",
        "green/east",
        "blue/east",
        "blue/west",
      ]);
    });
  });

  describe("several sorts", () => {
    it("reads each sort in turn: one on a column with a total, or on a grouping column, orders the groups; any other is passed over", () => {
      // OPEN: the spec's table speaks of one sort. With several, the groups are compared sort by sort, as rows are. A
      // sort on a column with no total says nothing about groups, so the next sort is read. TanStack Table draws this.
      const ties: Row[] = [
        { key: "m1", team: "x", value: 60, units: 1 },
        { key: "m2", team: "y", value: 120, units: 9 },
        { key: "m3", team: "x", value: 60, units: 2 },
        { key: "m4", team: "z", value: 120, units: 5 },
      ];
      // Every group totals 120. The total of Units breaks the tie: x 3, z 5, y 9.
      expect(
        order(view(ties, { groupBy: ["team"], sorts: [desc("value"), asc("units")], aggregations: [sum("value"), sum("units")] })),
      ).toEqual(["x", "z", "y"]);
      // With no total on Units, nothing breaks it: the order they first appear.
      expect(order(view(ties, { groupBy: ["team"], sorts: [desc("value"), asc("units")], aggregations: [sum("value")] }))).toEqual([
        "x",
        "y",
        "z",
      ]);
      const mixed: Row[] = [
        { key: "q1", team: "x", value: 10, units: 5 },
        { key: "q2", team: "y", value: 100, units: 3 },
        { key: "q3", team: "z", value: 50, units: 1 },
      ];
      // Units has no total, so the groups are ordered by the next sort, the total of Market value: y 100, z 50, x 10.
      // The rows' own order by Units would be z, y, x, and first appearance x, y, z.
      expect(order(view(mixed, { groupBy: ["team"], sorts: [asc("units"), desc("value")], aggregations: [sum("value")] }))).toEqual([
        "y",
        "z",
        "x",
      ]);
      // A sort on a column with no total, then one on the grouping column: by the grouping column.
      expect(order(view(mixed, { groupBy: ["team"], sorts: [asc("units"), desc("team")] }))).toEqual(["z", "y", "x"]);
    });
  });
});
