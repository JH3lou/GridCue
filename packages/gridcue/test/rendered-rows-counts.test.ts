import { describe, expect, it } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { emptyViewState, type ViewSchema, type ViewState } from "../src/core/protocol";
import { applyView } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createTanStackAdapter } from "../src/tanstack";
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
import {
  compareDrawn,
  DRAWN,
  type DrawnComparison,
  drawTanStack,
  type Row,
  renderWithRows,
  renderWithTanStack,
  tanStackTableOver,
} from "./rendered-rows";
import { generateView, seededRandom } from "./view-generator";

// Views with a count, the same through both Grid Adapters (operation set spec, 5.5 and 10; ADR 0027). The TanStack
// Table registers GridCue's count piece and the adapter is told it draws the count (`renders` with "count"). Seeded
// views from the view generator, each with a count, half of them grouped, on the two row sets of the grouped test
// (`rendered-row-sets.ts`), with ties and empty values. Both adapters get the same rows and the same View State, and
// what a Host would draw is compared as there: rows, their order, the groups, their order, and every total, which is
// over the rows the count keeps. The bar is 100% equal, and the rows each adapter keeps are the same rows in every view,
// counted on their own (`keptDiffer`). Views that differ only in where a row with no value in a sorted column sits are
// counted apart, as in the grouped test (spec section 3); a count never keeps such a row, in its first sorted column.
//
// The differences the grouped test counts apart (a null text cell in a sorted column, letter case, null and missing
// cells in one grouped column, a null beside a 0 in a sorted number column) stay counted apart here. Each is checked
// with a count: which rows show stays the same.
//
// The views come from seeds. By default they are 500 fixed seeds for each row set, and the counts are pinned. Other
// seeds, as the lead draws after the build, go in GRIDCUE_RENDERED_SEEDS, as for the grouped test; the bar still holds,
// and the counts are printed instead of pinned (the verbose reporter shows them):
//   GRIDCUE_RENDERED_SEEDS=73001-73500 pnpm --filter gridcue exec vitest run test/rendered-rows-counts.test.ts --reporter=verbose

const GIVEN = seedsFrom(process.env.GRIDCUE_RENDERED_SEEDS);
const SEEDS = GIVEN ?? Array.from({ length: 500 }, (_, i) => 20_261_119 + i);

/** What the TanStack Table adapter lists with every `renders` it takes, the count included. */
const CAPABILITIES = {
  operations: [...MVP_OPERATIONS, "columns.pin", "density.set", "aggregation.set", "limit.set"],
  maxSorts: 3,
  maxGroups: 2,
};

/** Counts of 1 row, a few, more than many groups hold, and around and past the 300 rows each set has. */
const COUNTS = [1, 2, 3, 5, 7, 10, 20, 50, 299, 300, 301, 1000];

/**
 * A view with a count, from a seed: grouped for an even seed, not for an odd one. One in ten has no sort: a request
 * never sets a count without one (spec 5.1 asks), but a User who clears the sort with the table's own header keeps the
 * count, which then keeps the first rows in the Host's order.
 */
const countView = (seed: number, set: RowSet): ViewState => {
  const state = generateView(seed, set.schema, {
    capabilities: CAPABILITIES,
    rows: set.rows,
    grouped: seed % 2 === 0,
    counted: true,
    counts: COUNTS,
  });
  if (seededRandom(seed ^ 0x5eed)() < 0.1) state.sorts = [];
  return state;
};

const SETS: RowSet[] = [
  { name: "wealth", schema: wealthSchema, rows: wealthRows() },
  { name: "ledger", schema: ledgerSchema, rows: ledgerRows() },
];

const isBlank = (v: unknown) => v === null || v === undefined || v === "" || Number.isNaN(v);
const keys = (rows: readonly Row[]) => rows.map((r) => r.key).sort();

interface Tally {
  views: number;
  same: number;
  emptyPlaces: number;
  different: number;
  /** Views where the two adapters keep different rows, whatever their order. */
  keptDiffer: number;
  grouped: number;
  twoLevels: number;
  withTotals: number;
  noSort: number;
  /** Views where the count leaves rows out. */
  cut: number;
  /** Views where the last row kept ties with the first row left out, on every sorted column. */
  tieAtCut: number;
  /** Views with rows that have no value in the first sorted column, which the count passes over. */
  emptyInFirst: number;
}

/** Facts about a view's count, from the view with no count, to show what the seeds cover. */
const cover = (set: RowSet, state: ViewState) => {
  const all = applyView(set.rows, { ...state, limit: undefined }, set.schema).rows as Row[];
  const first = state.sorts[0]?.columnId;
  const counted = first ? all.filter((r) => !isBlank(r[first])) : all;
  const limit = state.limit ?? Number.POSITIVE_INFINITY;
  const tie = (a: Row | undefined, b: Row | undefined) => !!a && !!b && state.sorts.every((s) => a[s.columnId] === b[s.columnId]);
  return {
    cut: counted.length > limit,
    tieAtCut: counted.length > limit && tie(counted[limit - 1], counted[limit]),
    emptyInFirst: counted.length < all.length,
  };
};

type Failure = { seed: number; state: ViewState; why: string };

/** Draws every seed's view with a count through both adapters and counts how they compare. */
const drawAll = async (set: RowSet, seeds: readonly number[]) => {
  const tally: Tally = {
    views: 0,
    same: 0,
    emptyPlaces: 0,
    different: 0,
    keptDiffer: 0,
    grouped: 0,
    twoLevels: 0,
    withTotals: 0,
    noSort: 0,
    cut: 0,
    tieAtCut: 0,
    emptyInFirst: 0,
  };
  const failures: Failure[] = [];
  const kept: Failure[] = [];
  for (const seed of seeds) {
    const state = countView(seed, set);
    if (state.limit === undefined) throw new Error(`seed ${seed} has no count`);
    const c = { name: `${set.name} ${seed}`, schema: set.schema, rows: set.rows, state };
    const [rows, table] = await Promise.all([renderWithRows(c), renderWithTanStack(c)]);
    const result: DrawnComparison = compareDrawn(rows, table, state);
    tally.views++;
    tally[result.verdict]++;
    if (result.verdict === "different") failures.push({ seed, state, why: result.why ?? "" });
    if (JSON.stringify(keys(rows.rows)) !== JSON.stringify(keys(table.rows))) {
      tally.keptDiffer++;
      kept.push({ seed, state, why: `${rows.rows.length} rows against ${table.rows.length}` });
    }
    if (state.groupBy.length > 0) tally.grouped++;
    if (state.groupBy.length === 2) tally.twoLevels++;
    if (state.aggregations.length > 0) tally.withTotals++;
    if (state.sorts.length === 0) tally.noSort++;
    const facts = cover(set, state);
    if (facts.cut) tally.cut++;
    if (facts.tieAtCut) tally.tieAtCut++;
    if (facts.emptyInFirst) tally.emptyInFirst++;
  }
  return { tally, failures, kept };
};

/** A failure in a line: its seed, what differs, and the view's count, grouping, sorts and totals. */
const describeFailure = ({ seed, state, why }: Failure) =>
  `seed ${seed}: ${why} (count ${state.limit}; grouped by ${state.groupBy.join(", ") || "nothing"}; sorted by ${
    state.sorts.map((s) => `${s.columnId} ${s.direction}`).join(", ") || "nothing"
  }; totals ${state.aggregations.map((a) => `${a.function} of ${a.columnId}`).join(", ") || "none"})`;

/** The counts on the fixed seeds, measured 2026-11-19. A change to either adapter or the generator shows here. */
const PINNED: Record<string, Tally> = {
  wealth: {
    views: 500,
    same: 490,
    emptyPlaces: 10,
    different: 0,
    keptDiffer: 0,
    grouped: 250,
    twoLevels: 133,
    withTotals: 310,
    noSort: 58,
    cut: 248,
    tieAtCut: 92,
    emptyInFirst: 250,
  },
  ledger: {
    views: 500,
    same: 490,
    emptyPlaces: 10,
    different: 0,
    keptDiffer: 0,
    grouped: 250,
    twoLevels: 145,
    withTotals: 321,
    noSort: 58,
    cut: 248,
    tieAtCut: 89,
    emptyInFirst: 254,
  },
};

describe("Views with a count: both adapters draw the same", () => {
  for (const set of SETS) {
    it(`${set.name}: ${SEEDS.length} seeded views with a count, grouped and not`, async () => {
      const { tally, failures, kept } = await drawAll(set, SEEDS);
      console.log(`rendered rows with a count, ${set.name}: ${JSON.stringify(tally)}`);
      // The bar: every view the same, apart from where rows with no value in a sorted column sit, and the same rows kept.
      expect(failures.map(describeFailure)).toEqual([]);
      expect(kept.map(describeFailure)).toEqual([]);
      if (!GIVEN) expect(tally).toEqual(PINNED[set.name]);
    }, 60_000);
  }

  for (const set of SETS) {
    it(`${set.name}: views that differ only in the count, on one table, each give applyView's rows`, async () => {
      // One table and one adapter, as a Host has them: the count is set, changed, cleared and set again, and each read
      // of the table is compared with applyView. The table must draw again when only the count changes.
      const table = tanStackTableOver(set.rows, set.schema);
      const adapter = createTanStackAdapter({ schema: set.schema, table, renders: DRAWN });
      const failures: string[] = [];
      let reads = 0;
      for (const seed of SEEDS.slice(0, 100)) {
        const state = countView(seed, set);
        for (const limit of [state.limit, 1, 7, 50, undefined, 3, 1000, state.limit]) {
          const next: ViewState = { ...state, limit };
          const written = await adapter.restore({ revision: adapter.getState().revision, state: next });
          if (!written.ok) throw new Error(written.code);
          const back = adapter.getState().state;
          if (back.limit !== limit) failures.push(`seed ${seed}: read back the count ${back.limit} for ${limit}`);
          const expected = await renderWithRows({ name: "", schema: set.schema, rows: set.rows, state: next });
          const drawn = drawTanStack(table, next, back.density);
          const result = compareDrawn(expected, drawn, next);
          if (result.verdict === "different") failures.push(`seed ${seed}, count ${limit}: ${result.why}`);
          if (JSON.stringify(keys(expected.rows)) !== JSON.stringify(keys(drawn.rows)))
            failures.push(`seed ${seed}, count ${limit}: rows kept`);
          reads++;
        }
      }
      expect(reads).toBe(Math.min(SEEDS.length, 100) * 8);
      expect(failures.slice(0, 10)).toEqual([]);
    }, 60_000);
  }
});

// --- Differences older than the count, counted apart ---------------------------------------------------------------
// The grouped test counts each of these apart, and none is this PR's to fix. With a count, each still keeps the same
// rows on both adapters: the count piece takes GridCue's own comparison, whatever order TanStack then draws them in.

describe("Counted with a count: a null text cell in a sorted column", () => {
  const nullText: RowSet[] = [
    { name: "wealth", schema: wealthSchema, rows: wealthRows(null) },
    { name: "ledger", schema: ledgerSchema, rows: ledgerRows(null) },
  ];
  const textual = (schema: ViewSchema) =>
    new Set(schema.columns.filter((c) => ["string", "enum", "date", "datetime"].includes(c.kind)).map((c) => c.id));
  for (const set of nullText) {
    it(`${set.name}: the same rows are kept in every view; any view that differs sorts by a text column holding null`, async () => {
      const { tally, failures, kept } = await drawAll(set, SEEDS);
      console.log(`rendered rows with a count and null text, ${set.name}: ${JSON.stringify(tally)}`);
      expect(kept.map(describeFailure)).toEqual([]);
      const text = textual(set.schema);
      const unexplained = failures.filter(
        ({ state }) => !state.sorts.some((s) => text.has(s.columnId) && set.rows.some((r) => r[s.columnId] === null)),
      );
      expect(unexplained.map(describeFailure)).toEqual([]);
      if (!GIVEN) expect(tally.different).toBe(NULL_TEXT_DIFFERENT[set.name]);
    }, 60_000);
  }
});
/** Measured on the fixed seeds, 2026-11-19. */
const NULL_TEXT_DIFFERENT: Record<string, number> = { wealth: 8, ledger: 17 };

describe("Counted with a count: a null beside a 0 in a sorted number column", () => {
  const zeros = SETS.map(withZerosBesideNull);
  for (const set of zeros) {
    it(`${set.name}: the same rows are kept in every view; any view that differs sorts by a column holding null and 0`, async () => {
      const both = nullAndZeroColumns(set);
      expect(both.size).toBeGreaterThan(0);
      const { tally, failures, kept } = await drawAll(set, SEEDS);
      console.log(`rendered rows with a count and zeros beside null, ${set.name}: ${JSON.stringify(tally)}`);
      expect(kept.map(describeFailure)).toEqual([]);
      const unexplained = failures.filter(({ state }) => !state.sorts.some((s) => both.has(s.columnId)));
      expect(unexplained.map(describeFailure)).toEqual([]);
      if (!GIVEN) expect(tally.different).toBe(NULL_ZERO_DIFFERENT[set.name]);
    }, 60_000);
  }

  it("in a later sorted column: keeps the same three rows, and TanStack draws the two that hold 0 in the other order", async () => {
    // In the first sorted column the count passes over the null, so only a later column can hold one beside a 0.
    const schema = defineSchema([{ id: "key" }, { id: "units", kind: "number" }, { id: "amount", kind: "currency" }]);
    const rows: Row[] = [0, null, 0, 5].map((amount, i) => ({ key: `r${i}`, units: i < 3 ? 1 : 0, amount }));
    const state: ViewState = {
      ...emptyViewState(["key", "units", "amount"]),
      sorts: [
        { columnId: "units", direction: "desc" },
        { columnId: "amount", direction: "asc" },
      ],
      limit: 3,
    };
    const c = { name: "null beside 0", schema, rows, state };
    const [byRows, byTable] = [await renderWithRows(c), await renderWithTanStack(c)];
    expect(keys(byRows.rows)).toEqual(["r0", "r1", "r2"]);
    expect(keys(byTable.rows)).toEqual(["r0", "r1", "r2"]);
    const valued = (drawn: typeof byRows) => drawn.rows.filter((r) => typeof r.amount === "number").map((r) => r.key);
    expect(valued(byRows)).toEqual(["r0", "r2"]);
    expect(valued(byTable)).toEqual(["r2", "r0"]);
  });
});
/** Measured on the fixed seeds, 2026-11-19. */
const NULL_ZERO_DIFFERENT: Record<string, number> = { "wealth, zeros beside null": 1, "ledger, zeros beside null": 0 };

describe("Counted with a count: letter case in a sorted text column", () => {
  it("keeps the same two rows, which TanStack draws in its code-unit order", async () => {
    const schema = defineSchema([{ id: "key" }, { id: "owner" }]);
    const rows: Row[] = ["cedar", "Birch", "alder"].map((owner, i) => ({ key: `c${i}`, owner }));
    const state: ViewState = { ...emptyViewState(["key", "owner"]), sorts: [{ columnId: "owner", direction: "asc" }], limit: 2 };
    const c = { name: "letter case", schema, rows, state };
    expect((await renderWithRows(c)).rows.map((r) => r.owner)).toEqual(["alder", "Birch"]);
    expect((await renderWithTanStack(c)).rows.map((r) => r.owner)).toEqual(["Birch", "alder"]);
  });
});

describe("Counted with a count: null and missing cells in one grouped column", () => {
  it("keeps the same rows, which TanStack draws in two groups and applyView in one", async () => {
    const schema = defineSchema([{ id: "key" }, { id: "owner" }, { id: "amount", kind: "currency" }]);
    const rows: Row[] = [
      { key: "a", owner: null, amount: 1 },
      { key: "b", amount: 2 },
      { key: "c", owner: "Owner A", amount: 3 },
      { key: "d", owner: "Owner A", amount: 0.5 },
    ];
    const state: ViewState = {
      ...emptyViewState(["key", "owner", "amount"]),
      groupBy: ["owner"],
      sorts: [{ columnId: "amount", direction: "desc" }],
      aggregations: [{ columnId: "amount", function: "sum" }],
      limit: 3,
    };
    const c = { name: "two kinds of empty", schema, rows, state };
    const byRows = await renderWithRows(c);
    const byTable = await renderWithTanStack(c);
    expect(keys(byRows.rows)).toEqual(["a", "b", "c"]);
    expect(keys(byTable.rows)).toEqual(["a", "b", "c"]);
    // Two groups with the same total keep the order they first appear in.
    expect(byRows.groups?.map((g) => [g.key.owner, g.totals.amount])).toEqual([
      [null, 3],
      ["Owner A", 3],
    ]);
    expect(byTable.groups?.map((g) => [g.key.owner, g.totals.amount])).toEqual([
      ["Owner A", 3],
      [null, 2],
      [null, 1],
    ]);
  });
});

describe("A count's own cases, both adapters", () => {
  const schema = defineSchema([{ id: "key" }, { id: "amount", kind: "currency" }, { id: "owner" }]);
  const view = (over: Partial<ViewState>): ViewState => ({ ...emptyViewState(["key", "amount", "owner"]), ...over });
  const both = async (rows: Row[], state: ViewState) => {
    const c = { name: "", schema, rows, state };
    const [a, b] = [await renderWithRows(c), await renderWithTanStack(c)];
    expect(b.rows.map((r) => r.key)).toEqual(a.rows.map((r) => r.key));
    return a.rows.map((r) => r.key);
  };

  it("keeps the tied rows that come first in the Host's order, at the cut", async () => {
    const rows: Row[] = [
      { key: "a", amount: 5 },
      { key: "b", amount: 9 },
      { key: "c", amount: 5 },
      { key: "d", amount: 5 },
      { key: "e", amount: 1 },
    ];
    expect(await both(rows, view({ sorts: [{ columnId: "amount", direction: "desc" }], limit: 3 }))).toEqual(["b", "a", "c"]);
    expect(await both(rows, view({ sorts: [{ columnId: "amount", direction: "asc" }], limit: 2 }))).toEqual(["e", "a"]);
  });

  it("never fills a count with a row that has no value in the first sorted column, either way", async () => {
    const rows: Row[] = [{ key: "a", amount: null }, { key: "b", amount: 3 }, { key: "c" }, { key: "e", amount: 1 }];
    expect(await both(rows, view({ sorts: [{ columnId: "amount", direction: "desc" }], limit: 4 }))).toEqual(["b", "e"]);
    expect(await both(rows, view({ sorts: [{ columnId: "amount", direction: "asc" }], limit: 1 }))).toEqual(["e"]);
    // A number that isn't one (NaN) is never kept either. A count drops it before it sorts, so the other rows keep their
    // order: both adapters take the same steps on the same rows, so they keep the same ones.
    const nan: Row[] = [...rows, { key: "d", amount: Number.NaN }];
    for (const direction of ["asc", "desc"] as const) {
      expect(await both(nan, view({ sorts: [{ columnId: "amount", direction }], limit: 4 }))).not.toContain("d");
    }
  });

  it("keeps the first rows in the Host's order when the view has no sort, and every row when the count is above them", async () => {
    const rows: Row[] = ["a", "b", "c"].map((key, i) => ({ key, amount: i }));
    expect(await both(rows, view({ limit: 2 }))).toEqual(["a", "b"]);
    expect(await both(rows, view({ sorts: [{ columnId: "amount", direction: "desc" }], limit: 10 }))).toEqual(["c", "b", "a"]);
  });

  it("keeps ten rows when grouped, and each group's total is over the rows kept", async () => {
    const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ key: `r${i}`, amount: i, owner: i % 2 ? "Owner A" : "Owner B" }));
    const state = view({
      sorts: [{ columnId: "amount", direction: "desc" }],
      groupBy: ["owner"],
      aggregations: [{ columnId: "amount", function: "sum" }],
      limit: 10,
    });
    const c = { name: "", schema, rows, state };
    const [a, b] = [await renderWithRows(c), await renderWithTanStack(c)];
    expect(compareDrawn(a, b, state).verdict).toBe("same");
    expect(b.rows).toHaveLength(10);
    expect(b.groups?.map((g) => [g.key.owner, g.totals.amount])).toEqual([
      ["Owner A", 29 + 27 + 25 + 23 + 21],
      ["Owner B", 28 + 26 + 24 + 22 + 20],
    ]);
  });
});
