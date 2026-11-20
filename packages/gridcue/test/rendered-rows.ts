import {
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnVisibilityFeature,
  constructTable,
  createFilteredRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { describe, expect, it } from "vitest";
import type { ViewSchema, ViewState } from "../src/core/protocol";
import { applyView } from "../src/core/rows-adapter";
import { createTanStackAdapter, gridcueFilterFn, type TanStackTableLike } from "../src/tanstack";

/**
 * The rows a view shows, the same through every Grid Adapter (named filters spec, section 10). Each case is one set
 * of rows, one schema and one View State. Both adapters render it, and the rows each keeps must be the same rows, in
 * the same order. A case may also name the rows it expects, by their `key`.
 *
 * Named filters' dates PR starts it with the whole-day, empty and exact-text cases. The operation set's PR 2 adds the
 * columns in display order, the pinned columns and the density. Its PR 3 adds groups, order and totals: a field on
 * `Rendered` and its reading in each renderer below.
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

/**
 * What a Grid Adapter renders for a view: its rows, its visible columns in display order, the columns pinned to each
 * side, and its density. Both tables here draw pins and density (`renders: ["pinning", "density"]`).
 */
export interface Rendered {
  rows: Row[];
  columns: string[];
  pinned: { start: string[]; end: string[] };
  density: ViewState["density"];
}

/** The Rows Adapter: `applyView` over the Host's rows. */
export const renderWithRows = async ({ rows, state, schema }: RenderedCase): Promise<Rendered> => {
  const view = applyView(rows, state, schema);
  return { rows: view.rows, columns: view.columns, pinned: view.pinned, density: view.density };
};

const features = tableFeatures({
  coreReactivityFeature: storeReactivityBindings(),
  columnFilteringFeature,
  rowSortingFeature,
  columnGroupingFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  columnPinningFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  groupedRowModel: createGroupedRowModel(),
});

type Leaf = { id: string };
type RenderedTable = TanStackTableLike & {
  getRowModel(): { rows: Array<{ original: Row }> };
  getStartVisibleLeafColumns(): Leaf[];
  getCenterVisibleLeafColumns(): Leaf[];
  getEndVisibleLeafColumns(): Leaf[];
};

/**
 * The TanStack Table adapter: a table over the same rows, with `gridcueFilterFn`, given the view through the adapter.
 * Its columns are what a Host draws from TanStack's start, center and end lists; its density is the adapter's.
 */
export const renderWithTanStack = async ({ rows, state, schema }: RenderedCase): Promise<Rendered> => {
  const table = constructTable({
    features,
    data: rows,
    defaultColumn: { filterFn: gridcueFilterFn },
    columns: schema.columns.map((c) => ({ accessorKey: c.id, header: c.label })),
  } as never) as unknown as RenderedTable;
  const adapter = createTanStackAdapter({ schema, table, renders: ["pinning", "density"] });
  const written = await adapter.restore({ revision: adapter.getState().revision, state });
  if (!written.ok) throw new Error(`The TanStack Table adapter refused the view: ${written.code}`);
  const ids = (leaves: Leaf[]) => leaves.map((c) => c.id);
  const start = ids(table.getStartVisibleLeafColumns());
  const end = ids(table.getEndVisibleLeafColumns());
  return {
    rows: table.getRowModel().rows.map((r) => r.original),
    columns: [...start, ...ids(table.getCenterVisibleLeafColumns()), ...end],
    pinned: { start, end },
    density: adapter.getState().state.density,
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
        }
        if (c.columns) expect(first.columns).toEqual(c.columns);
      });
    }
  });
};
