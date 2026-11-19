import { describe, expect, it } from "vitest";
import type { Scalar, ViewSchema, ViewState } from "../src/core/protocol";
import { applyView } from "../src/core/rows-adapter";
import {
  createTanStackAdapter,
  gridcueAggregationFn,
  gridcueAggregationValue,
  gridcueCountFeature,
  gridcueCountRowModel,
  gridcueFilterFn,
  type TanStackTableLike,
} from "../src/tanstack";
import { tanStackTables } from "./tanstack-table";

/**
 * The rows a view shows, the same through every Grid Adapter (named filters spec, section 10). Each case is one set
 * of rows, one schema and one View State. Both adapters render it, and the rows each keeps must be the same rows, in
 * the same order. A case may also name the rows it expects, by their `key`.
 *
 * Named filters' dates PR starts it with the whole-day, empty and exact-text cases. The operation set's PR 2 adds the
 * columns in display order, the pinned columns and the density. Its PR 3 adds the groups, their order and the totals.
 * Its PR 4 adds the count: the TanStack Table here registers GridCue's count piece, so it keeps a count as `applyView`
 * does (`rendered-rows-counts.test.ts`).
 */
export type Row = Record<string, unknown> & { key: string };

export interface RenderedCase {
  name: string;
  schema: ViewSchema;
  rows: readonly Row[];
  state: ViewState;
  /** The keys of the rows the view must show, in order, when the case states them. */
  expected?: readonly string[];
  /** The columns the view must show, in display order, when the case states them. */
  columns?: readonly string[];
}

/** A Total as a Host draws it, by column id: its value, or `null` when it is empty. */
export type DrawnTotals = Record<string, number | null>;

/** One group a Host draws at the last grouping level: its key, its rows in order, and its total cells. */
export interface DrawnGroup {
  key: Record<string, Scalar>;
  rows: Row[];
  totals: DrawnTotals;
}

/**
 * What a Grid Adapter renders for a view: its rows, its visible columns in display order, the columns pinned to each
 * side, its density, its groups in order, and its Totals for the whole view (the footer). Both tables here draw pins,
 * density, totals and a count (`renders: DRAWN`). A grouped view's `rows` are its groups' rows, group
 * after group, as the Host draws them.
 */
export interface Rendered {
  rows: Row[];
  columns: string[];
  pinned: { start: string[]; end: string[] };
  density: ViewState["density"];
  groups?: DrawnGroup[];
  totals: DrawnTotals;
}

/** The Rows Adapter: `applyView` over the Host's rows. */
export const renderWithRows = async ({ rows, state, schema }: RenderedCase): Promise<Rendered> => {
  const view = applyView(rows, state, schema);
  const drawn = (totals: ReadonlyArray<{ columnId: string; value: number | null }>): DrawnTotals =>
    Object.fromEntries(totals.map((t) => [t.columnId, t.value]));
  const groups = view.groups?.map((g) => ({ key: g.key, rows: g.rows, totals: drawn(g.totals) }));
  return {
    rows: groups ? groups.flatMap((g) => g.rows) : view.rows,
    columns: view.columns,
    pinned: view.pinned,
    density: view.density,
    ...(groups ? { groups } : {}),
    totals: drawn(view.totals),
  };
};

/** Everything the TanStack Table here draws, so the adapter lists every operation. */
export const DRAWN = ["pinning", "density", "totals", "count"] as const;

type Leaf = { id: string };
type TableRow = { original: Row; subRows: TableRow[]; getValue(columnId: string): unknown };
export type RenderedTable = TanStackTableLike & {
  getRowModel(): { rows: TableRow[] };
  getColumn(id: string): { getAggregationValue(): unknown } | undefined;
  getStartVisibleLeafColumns(): Leaf[];
  getCenterVisibleLeafColumns(): Leaf[];
  getEndVisibleLeafColumns(): Leaf[];
};

const orEmpty = (value: unknown): number | null => (typeof value === "number" ? value : null);

/**
 * A TanStack Table over `rows`, as a Host builds one for GridCue, with a column for each of the schema's: TanStack's
 * own features and row models, and GridCue's count piece around its filtering (`tanstack-table.ts`, which `evals/`
 * builds its tables with too).
 */
const buildTable = tanStackTables({
  gridcueCountFeature,
  gridcueCountRowModel,
  gridcueFilterFn,
  gridcueAggregationFn,
  gridcueAggregationValue,
});
export const tanStackTableOver = (rows: readonly Row[], schema: ViewSchema): RenderedTable => buildTable<RenderedTable>(rows, schema);

/**
 * The TanStack Table adapter: a table over the same rows, with `gridcueFilterFn`, `gridcueAggregationFn`,
 * `gridcueAggregationValue` and the count piece, given the view through the adapter, which must read it back with the
 * same count. Its columns are what a Host draws from TanStack's start, center and end lists; its density is the
 * adapter's. Its groups are the group rows at the last grouping level, in the order the row model gives them, each with
 * its leaf rows and its total cells; its Totals are `column.getAggregationValue()`.
 */
export const renderWithTanStack = async ({ rows, state, schema }: RenderedCase): Promise<Rendered> => {
  const table = tanStackTableOver(rows, schema);
  const adapter = createTanStackAdapter({ schema, table, renders: DRAWN });
  const written = await adapter.restore({ revision: adapter.getState().revision, state });
  if (!written.ok) throw new Error(`The TanStack Table adapter refused the view: ${written.code}`);
  const back = adapter.getState().state;
  if (back.limit !== state.limit) throw new Error(`The TanStack Table adapter read back the count ${back.limit} for ${state.limit}.`);
  return drawTanStack(table, state, back.density);
};

/** What a Host draws from a TanStack Table that shows `state`. */
export const drawTanStack = (table: RenderedTable, state: ViewState, density: ViewState["density"]): Rendered => {
  const ids = (leaves: Leaf[]) => leaves.map((c) => c.id);
  const start = ids(table.getStartVisibleLeafColumns());
  const end = ids(table.getEndVisibleLeafColumns());
  const totalled = state.aggregations.map((a) => a.columnId);
  const top = table.getRowModel().rows;
  const groups: DrawnGroup[] = [];
  const walk = (level: readonly TableRow[], depth: number) => {
    for (const row of level) {
      if (depth < state.groupBy.length - 1) walk(row.subRows, depth + 1);
      else {
        const leaves = row.subRows.map((r) => r.original);
        const first = leaves[0] as Row;
        groups.push({
          key: Object.fromEntries(state.groupBy.map((id) => [id, (first[id] ?? null) as Scalar])),
          rows: leaves,
          totals: Object.fromEntries(totalled.map((id) => [id, orEmpty(row.getValue(id))])),
        });
      }
    }
  };
  if (state.groupBy.length > 0) walk(top, 0);
  return {
    rows: state.groupBy.length > 0 ? groups.flatMap((g) => g.rows) : top.map((r) => r.original),
    columns: [...start, ...ids(table.getCenterVisibleLeafColumns()), ...end],
    pinned: { start, end },
    density,
    ...(state.groupBy.length > 0 ? { groups } : {}),
    totals: Object.fromEntries(totalled.map((id) => [id, orEmpty(table.getColumn(id)?.getAggregationValue())])),
  };
};

export const RENDERERS = { "Rows Adapter": renderWithRows, "TanStack Table adapter": renderWithTanStack } as const;

/**
 * The columns TanStack Table draws for the Rows Adapter's `columns` on a view grouped by `groupBy`. TanStack's default
 * `groupedColumnMode: "reorder"` puts the grouped columns first among the unpinned ones, in grouping order, and leaves
 * the pinned columns where their pins put them; the Host's table sets that option, not GridCue. `applyView` keeps every
 * column in its place. So the two differ only there, and the comparison counts that difference rather than hiding it.
 */
export const groupedFirst = (columns: readonly string[], pinned: Rendered["pinned"], groupBy: readonly string[]): string[] => {
  const center = columns.filter((id) => !pinned.start.includes(id) && !pinned.end.includes(id));
  const grouped = groupBy.filter((id) => center.includes(id));
  return [...pinned.start, ...grouped, ...center.filter((id) => !grouped.includes(id)), ...pinned.end];
};

/** The columns `renderer` must draw for a view whose Rows Adapter columns are `rows`. */
const columnsFor = (renderer: string, rows: Rendered, state: ViewState) =>
  renderer === "TanStack Table adapter" ? groupedFirst(rows.columns, rows.pinned, state.groupBy) : rows.columns;

/** Runs each case through every Grid Adapter and compares what they render. */
export const runRenderedRows = (title: string, cases: readonly RenderedCase[]) => {
  describe(`${title}: rendered rows`, () => {
    for (const c of cases) {
      it(c.name, async () => {
        const [first, ...others] = await Promise.all(Object.values(RENDERERS).map((render) => render(c)));
        if (!first) throw new Error("no renderer");
        if (c.expected) expect(first.rows.map((r) => r.key)).toEqual(c.expected);
        for (const [i, other] of others.entries()) {
          const renderer = Object.keys(RENDERERS)[i + 1] ?? "";
          const against = `${renderer} against the Rows Adapter`;
          expect(other.rows, against).toEqual(first.rows);
          expect(other.columns, `${against}: columns`).toEqual(columnsFor(renderer, first, c.state));
          expect(other.pinned, `${against}: pinned columns`).toEqual(first.pinned);
          expect(other.density, `${against}: density`).toBe(first.density);
          expect(other.groups, `${against}: groups`).toEqual(first.groups);
          expect(other.totals, `${against}: totals`).toEqual(first.totals);
        }
        if (c.columns) expect(first.columns).toEqual(c.columns);
      });
    }
  });
};

/**
 * How two adapters' drawings of one view compare (operation set spec, 5.4):
 * - `same`: every row, group, order and total is equal.
 * - `emptyPlaces`: equal but for where rows with no value in a sorted column sit, and where groups with no value in a
 *   sorted grouping column sit. Out of scope (spec section 3): both still keep exactly those rows, in the same groups.
 * - `different`: anything else, and a failure of the bar.
 *
 * Every total cell is compared. A view with a total on a column it groups by is one GridCue never applies (the compiler
 * asks and validation refuses it), so the generator draws none.
 */
export interface DrawnComparison {
  verdict: "same" | "emptyPlaces" | "different";
  /** For a `different` verdict: what differs first. */
  why?: string;
}

const isBlank = (v: unknown) => v === null || v === undefined;
const json = (v: unknown) => JSON.stringify(v);

export const compareDrawn = (rows: Rendered, table: Rendered, state: ViewState): DrawnComparison => {
  const fail = (why: string): DrawnComparison => ({ verdict: "different", why });
  if (json(table.pinned) !== json(rows.pinned)) return fail("pinned columns");
  if (table.density !== rows.density) return fail("density");
  if (json(table.columns) !== json(groupedFirst(rows.columns, rows.pinned, state.groupBy))) return fail("columns");
  if (json(table.totals) !== json(rows.totals)) return fail(`totals ${json(rows.totals)} against ${json(table.totals)}`);
  const sorted = state.sorts.map((s) => s.columnId);
  const blankInSort = (r: Row) => sorted.some((id) => isBlank(r[id]));
  let emptyPlaces = false;
  /** The same rows in the same order, or the same rows apart from where those blank in a sorted column sit. */
  const sameRows = (a: readonly Row[], b: readonly Row[], where: string): string | undefined => {
    if (json(a.map((r) => r.key)) === json(b.map((r) => r.key))) return undefined;
    const placed = (rs: readonly Row[]) => rs.filter((r) => !blankInSort(r)).map((r) => r.key);
    const blank = (rs: readonly Row[]) =>
      rs
        .filter(blankInSort)
        .map((r) => r.key)
        .sort();
    if (json(placed(a)) !== json(placed(b))) return `${where}: row order`;
    if (json(blank(a)) !== json(blank(b))) return `${where}: rows with no value`;
    emptyPlaces = true;
    return undefined;
  };
  if (state.groupBy.length === 0) {
    const why = sameRows(rows.rows, table.rows, "rows");
    if (why) return fail(why);
    return { verdict: emptyPlaces ? "emptyPlaces" : "same" };
  }
  const a = rows.groups ?? [];
  const b = table.groups ?? [];
  const keyOf = (g: DrawnGroup) => json(state.groupBy.map((id) => g.key[id] ?? null));
  if (json(a.map(keyOf).sort()) !== json(b.map(keyOf).sort())) return fail(`groups ${a.length} against ${b.length}`);
  if (json(a.map(keyOf)) !== json(b.map(keyOf))) {
    // A group with no value in a sorted grouping column sits where an empty row would: out of scope.
    const blankGroup = (g: DrawnGroup) => state.groupBy.some((id) => sorted.includes(id) && isBlank(g.key[id]));
    const placed = (gs: readonly DrawnGroup[]) => gs.filter((g) => !blankGroup(g)).map(keyOf);
    if (json(placed(a)) !== json(placed(b))) return fail("group order");
    emptyPlaces = true;
  }
  const byKey = new Map(b.map((g) => [keyOf(g), g]));
  const totalled = state.aggregations.map((t) => t.columnId);
  for (const g of a) {
    const other = byKey.get(keyOf(g)) as DrawnGroup;
    for (const id of totalled) {
      if (g.totals[id] !== other.totals[id]) return fail(`group ${keyOf(g)}: total of ${id} ${g.totals[id]} against ${other.totals[id]}`);
    }
    const why = sameRows(g.rows, other.rows, `group ${keyOf(g)}`);
    if (why) return fail(why);
  }
  return { verdict: emptyPlaces ? "emptyPlaces" : "same" };
};
