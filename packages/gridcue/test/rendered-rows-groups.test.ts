import { describe, expect, it } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { emptyViewState, type ViewSchema, type ViewState } from "../src/core/protocol";
import { defineSchema } from "../src/core/schema";
import {
  ledgerRows,
  ledgerSchema,
  nullAndZeroColumns,
  type RowSet,
  seedsFrom,
  wealthRows,
  wealthSchema,
  withZerosBesideNull,
} from "./rendered-row-sets";
import { compareDrawn, type DrawnComparison, groupedFirst, type Row, renderWithRows, renderWithTanStack } from "./rendered-rows";
import { generateView } from "./view-generator";

// Groups, their order and their totals, the same through both Grid Adapters (operation set spec, 5.4 and 10; ADR
// 0030). Seeded grouped views from the view generator, on two row sets of 300 rows each (`rendered-row-sets.ts`), a
// wealth-like one and a ledger-like one, with ties and empty values in the columns a view sorts, groups and totals.
// The views here hold no count; `rendered-rows-counts.test.ts` draws views with one. Both adapters get the
// same rows and the same View State, and what a Host would draw is compared: rows, their order inside each group, the
// groups, their order, and every total (`compareDrawn`). The bar is 100% equal. Two things are counted apart from it:
// views that differ only in where a row with no value in a sorted column sits (spec section 3, out of scope), and views
// where TanStack puts a grouped column first (operation set PR 2). No view totals a column it groups by: GridCue never
// applies one (spec 5.4), and the last describe shows how the adapters would differ there.
//
// The views come from seeds. By default they are 500 fixed seeds for each row set, and the counts are pinned. To run
// other seeds, as the lead does after the build, set GRIDCUE_RENDERED_SEEDS to a range or a list; the bar still holds,
// and the counts are printed instead of pinned (the verbose reporter shows them):
//   GRIDCUE_RENDERED_SEEDS=73001-73500 pnpm --filter gridcue exec vitest run test/rendered-rows-groups.test.ts --reporter=verbose
//   GRIDCUE_RENDERED_SEEDS=5,17,90210 pnpm --filter gridcue exec vitest run test/rendered-rows-groups.test.ts --reporter=verbose

const GIVEN = seedsFrom(process.env.GRIDCUE_RENDERED_SEEDS);
const SEEDS = GIVEN ?? Array.from({ length: 500 }, (_, i) => 20_261_114 + i);

/**
 * What a TanStack Table adapter lists with `renders: ["pinning", "density", "totals"]`: no count, so these seeds draw the
 * views they drew before the count (operation set PR 4), and the counts pinned below still hold.
 */
const TANSTACK_CAPABILITIES = {
  operations: [...MVP_OPERATIONS, "columns.pin", "density.set", "aggregation.set"],
  maxSorts: 3,
  maxGroups: 2,
};

const SETS: RowSet[] = [
  { name: "wealth", schema: wealthSchema, rows: wealthRows() },
  { name: "ledger", schema: ledgerSchema, rows: ledgerRows() },
];

interface Tally {
  views: number;
  same: number;
  emptyPlaces: number;
  different: number;
  groupedColumnsMoved: number;
  twoLevels: number;
  withTotals: number;
  sortedByTotal: number;
}

/** Draws every seed's grouped view through both adapters and counts how they compare. */
const drawAll = async (set: RowSet, seeds: readonly number[]) => {
  const tally: Tally = {
    views: 0,
    same: 0,
    emptyPlaces: 0,
    different: 0,
    groupedColumnsMoved: 0,
    twoLevels: 0,
    withTotals: 0,
    sortedByTotal: 0,
  };
  const failures: Array<{ seed: number; state: ViewState; result: DrawnComparison }> = [];
  for (const seed of seeds) {
    const state = generateView(seed, set.schema, { capabilities: TANSTACK_CAPABILITIES, rows: set.rows, grouped: true });
    const c = { name: `${set.name} ${seed}`, schema: set.schema, rows: set.rows, state };
    const [rows, table] = await Promise.all([renderWithRows(c), renderWithTanStack(c)]);
    const result = compareDrawn(rows, table, state);
    tally.views++;
    tally[result.verdict]++;
    if (result.verdict === "different") failures.push({ seed, state, result });
    if (state.aggregations.some((a) => state.groupBy.includes(a.columnId))) throw new Error(`seed ${seed} totals a grouping column`);
    if (JSON.stringify(rows.columns) !== JSON.stringify(table.columns)) tally.groupedColumnsMoved++;
    if (state.groupBy.length === 2) tally.twoLevels++;
    if (state.aggregations.length > 0) tally.withTotals++;
    if (state.sorts.some((s) => state.aggregations.some((a) => a.columnId === s.columnId))) tally.sortedByTotal++;
  }
  return { tally, failures };
};

/** A failure in a line: its seed, what differs, and the view's grouping, sorts and totals. */
const describeFailure = ({ seed, state, result }: { seed: number; state: ViewState; result: DrawnComparison }) =>
  `seed ${seed}: ${result.why} (grouped by ${state.groupBy.join(", ")}; sorted by ${state.sorts
    .map((s) => `${s.columnId} ${s.direction}`)
    .join(", ")}; totals ${state.aggregations.map((a) => `${a.function} of ${a.columnId}`).join(", ") || "none"})`;

/** The counts on the fixed seeds, measured 2026-11-14. A change to either adapter or the generator shows here. */
const PINNED: Record<string, Tally> = {
  wealth: {
    views: 500,
    same: 416,
    emptyPlaces: 84,
    different: 0,
    groupedColumnsMoved: 357,
    twoLevels: 259,
    withTotals: 297,
    sortedByTotal: 152,
  },
  ledger: {
    views: 500,
    same: 461,
    emptyPlaces: 39,
    different: 0,
    groupedColumnsMoved: 333,
    twoLevels: 272,
    withTotals: 301,
    sortedByTotal: 152,
  },
};

describe("Groups, their order and their totals: both adapters draw the same", () => {
  it("each row set has ties and empty values in every column a view can sort, group or total", () => {
    for (const set of SETS) {
      for (const column of set.schema.columns) {
        if (column.id === "key" || column.sensitivity === "restricted" || column.kind === "boolean") continue;
        const cells = set.rows.map((r) => r[column.id]);
        const held = cells.filter((v) => v !== null && v !== undefined);
        expect(held.length, `${set.name} ${column.id}: some cells empty`).toBeLessThan(cells.length);
        expect(new Set(held).size, `${set.name} ${column.id}: some ties`).toBeLessThan(held.length);
      }
      // The bar's rows keep out a null beside a 0 in one number column; it is counted apart below.
      expect([...nullAndZeroColumns(set)], set.name).toEqual([]);
    }
  });

  it("the comparison sees a difference in group order, a total, row order and the rows kept", async () => {
    const state: ViewState = {
      ...emptyViewState(ledgerSchema.columns.map((c) => c.id)),
      groupBy: ["owner"],
      sorts: [{ columnId: "amount", direction: "desc" }],
      aggregations: [{ columnId: "amount", function: "sum" }],
    };
    const c = { name: "self-check", schema: ledgerSchema, rows: SETS[1]?.rows ?? [], state };
    const drawn = await renderWithRows(c);
    expect(compareDrawn(drawn, await renderWithTanStack(c), state).verdict).toBe("same");
    const groups = drawn.groups ?? [];
    expect(groups.length).toBeGreaterThan(2);
    const variant = (change: (gs: typeof groups) => typeof groups) => {
      const gs = change(structuredClone(groups));
      const columns = groupedFirst(drawn.columns, drawn.pinned, state.groupBy);
      return compareDrawn(drawn, { ...drawn, columns, groups: gs, rows: gs.flatMap((g) => g.rows) }, state);
    };
    expect(variant((gs) => [gs[1], gs[0], ...gs.slice(2)] as typeof groups).why).toBe("group order");
    expect(variant((gs) => gs.map((g, i) => (i === 0 ? { ...g, totals: { amount: (g.totals.amount ?? 0) + 0.01 } } : g))).verdict).toBe(
      "different",
    );
    expect(variant((gs) => gs.map((g, i) => (i === 0 ? { ...g, rows: [...g.rows].reverse() } : g))).verdict).toBe("different");
    expect(variant((gs) => gs.map((g, i) => (i === 0 ? { ...g, rows: g.rows.slice(1) } : g))).verdict).toBe("different");
    // A row with no amount moved to the other end of its group: only where it sits differs.
    const blankAt = groups.findIndex((g) => g.rows.some((r) => r.amount === undefined || r.amount === null));
    expect(blankAt).toBeGreaterThanOrEqual(0);
    const moved = variant((gs) =>
      gs.map((g, i) => {
        if (i !== blankAt) return g;
        const blank = g.rows.filter((r) => r.amount === undefined || r.amount === null);
        return { ...g, rows: [...g.rows.filter((r) => !blank.includes(r)), ...blank] };
      }),
    );
    expect(["same", "emptyPlaces"]).toContain(moved.verdict);
  });

  for (const set of SETS) {
    it(`${set.name}: ${SEEDS.length} seeded grouped views`, async () => {
      const { tally, failures } = await drawAll(set, SEEDS);
      console.log(`rendered rows, ${set.name}: ${JSON.stringify(tally)}`);
      // The bar: every view the same, apart from where rows with no value in a sorted column sit.
      expect(failures.map(describeFailure)).toEqual([]);
      if (!GIVEN) expect(tally).toEqual(PINNED[set.name]);
      // About a second alone; this is no speed test, and the whole suite at once can take five times as long.
    }, 30_000);
  }
});

// --- Differences older than totals, counted -----------------------------------------------------------------------
// None of these is new with totals, and none is in this PR's scope. Each is counted so a change to it is seen, and each
// is listed for the owner.

describe("Counted: a null text cell in a sorted column", () => {
  // TanStack's default sort compares a `null` with a text value as neither smaller nor larger, so its order is no
  // order: with a `null` among them, it can draw the text values themselves out of order, not only the empty row.
  // applyView puts the empty row last (first when descending). A missing cell is `undefined`, which TanStack's
  // `sortUndefined` places as applyView does.
  const nullText: RowSet[] = [
    { name: "wealth", schema: wealthSchema, rows: wealthRows(null) },
    { name: "ledger", schema: ledgerSchema, rows: ledgerRows(null) },
  ];
  const textual = (schema: ViewSchema) =>
    new Set(schema.columns.filter((c) => ["string", "enum", "date", "datetime"].includes(c.kind)).map((c) => c.id));
  for (const set of nullText) {
    it(`${set.name}: every view that differs sorts by a text or category column holding null`, async () => {
      const { tally, failures } = await drawAll(set, SEEDS);
      console.log(`rendered rows with null text, ${set.name}: ${JSON.stringify(tally)}`);
      const text = textual(set.schema);
      const unexplained = failures.filter(
        ({ state }) => !state.sorts.some((s) => text.has(s.columnId) && set.rows.some((r) => r[s.columnId] === null)),
      );
      expect(unexplained.map(describeFailure)).toEqual([]);
      if (!GIVEN) expect(tally.different).toBe(NULL_TEXT_DIFFERENT[set.name]);
    }, 30_000);
  }
});
/** Measured on the fixed seeds, 2026-11-14. */
const NULL_TEXT_DIFFERENT: Record<string, number> = { wealth: 30, ledger: 35 };

describe("Counted: letter case in a sorted text column", () => {
  it("TanStack's default text sort orders by code unit, applyView as the locale does", async () => {
    const schema = defineSchema([{ id: "key" }, { id: "owner" }]);
    const rows: Row[] = ["cedar", "Birch", "alder"].map((owner, i) => ({ key: `c${i}`, owner }));
    const state: ViewState = { ...emptyViewState(["key", "owner"]), sorts: [{ columnId: "owner", direction: "asc" }] };
    const c = { name: "letter case", schema, rows, state };
    expect((await renderWithRows(c)).rows.map((r) => r.owner)).toEqual(["alder", "Birch", "cedar"]);
    expect((await renderWithTanStack(c)).rows.map((r) => r.owner)).toEqual(["Birch", "alder", "cedar"]);
  });
});

describe("Counted: null and missing cells in one grouped column", () => {
  it("TanStack draws them as two groups, applyView as one", async () => {
    const schema = defineSchema([{ id: "key" }, { id: "owner" }, { id: "amount", kind: "currency" }]);
    const rows: Row[] = [
      { key: "a", owner: null, amount: 1 },
      { key: "b", amount: 2 },
      { key: "c", owner: "Owner A", amount: 3 },
    ];
    const state: ViewState = {
      ...emptyViewState(["key", "owner", "amount"]),
      groupBy: ["owner"],
      aggregations: [{ columnId: "amount", function: "sum" }],
    };
    const c = { name: "two kinds of empty", schema, rows, state };
    expect((await renderWithRows(c)).groups?.map((g) => [g.key.owner, g.totals.amount])).toEqual([
      [null, 3],
      ["Owner A", 3],
    ]);
    expect((await renderWithTanStack(c)).groups?.map((g) => [g.key.owner, g.totals.amount])).toEqual([
      [null, 1],
      [null, 2],
      ["Owner A", 3],
    ]);
  });
});

describe("Counted: a null beside a 0 in a sorted number column", () => {
  // TanStack's basic sort finds `null` smaller than `0`, and `0` smaller than `null`, so its order is no order: it can
  // draw the rows that have values out of order, not only the empty row. A missing cell sorts as applyView sorts it.
  for (const set of SETS.map(withZerosBesideNull)) {
    it(`${set.name}: every view that differs sorts by a number column holding null and 0`, async () => {
      const both = nullAndZeroColumns(set);
      expect(both.size).toBeGreaterThan(0);
      const { tally, failures } = await drawAll(set, SEEDS);
      console.log(`rendered rows with zeros beside null, ${set.name}: ${JSON.stringify(tally)}`);
      const unexplained = failures.filter(({ state }) => !state.sorts.some((s) => both.has(s.columnId)));
      expect(unexplained.map(describeFailure)).toEqual([]);
      if (!GIVEN) expect(tally.different).toBe(NULL_ZERO_DIFFERENT[set.name]);
    }, 30_000);
  }

  it("TanStack can draw two rows that hold 0 in the other order", async () => {
    const schema = defineSchema([{ id: "key" }, { id: "amount", kind: "currency" }]);
    const state: ViewState = { ...emptyViewState(["key", "amount"]), sorts: [{ columnId: "amount", direction: "asc" }] };
    const valued = async (rows: Row[], render: typeof renderWithRows) =>
      (await render({ name: "null beside 0", schema, rows, state })).rows.filter((r) => typeof r.amount === "number").map((r) => r.key);
    const withNull: Row[] = [0, null, 0].map((amount, i) => ({ key: `r${i}`, amount }));
    expect(await valued(withNull, renderWithRows)).toEqual(["r0", "r2"]);
    expect(await valued(withNull, renderWithTanStack)).toEqual(["r2", "r0"]);
    // The same rows with the empty cell missing: both draw r0 before r2.
    const missing: Row[] = withNull.map((r) => (r.amount === null ? { key: r.key } : r));
    expect(await valued(missing, renderWithTanStack)).toEqual(["r0", "r2"]);
  });
});

/** Measured on the fixed seeds, 2026-11-19. */
const NULL_ZERO_DIFFERENT: Record<string, number> = { "wealth, zeros beside null": 13, "ledger, zeros beside null": 4 };

describe("Not drawn alike: a total on a column the view groups by", () => {
  // GridCue never applies such a view: the compiler asks, and validation refuses a plan that groups or sets totals into
  // one (spec 5.4). A User can still make one with the table's own controls. In a group row TanStack Table shows the
  // group's own value in that column, and `applyView` gives the group's total.
  it("TanStack shows the group's value, applyView the group's total", async () => {
    const schema = defineSchema([{ id: "key" }, { id: "units", kind: "number" }]);
    const rows: Row[] = [2, 2, 2, 5].map((units, i) => ({ key: `u${i}`, units }));
    const state: ViewState = {
      ...emptyViewState(["key", "units"]),
      groupBy: ["units"],
      aggregations: [{ columnId: "units", function: "sum" }],
    };
    const c = { name: "grouped total", schema, rows, state };
    expect((await renderWithRows(c)).groups?.map((g) => [g.key.units, g.totals.units])).toEqual([
      [2, 6],
      [5, 5],
    ]);
    expect((await renderWithTanStack(c)).groups?.map((g) => [g.key.units, g.totals.units])).toEqual([
      [2, 2],
      [5, 5],
    ]);
  });
});
