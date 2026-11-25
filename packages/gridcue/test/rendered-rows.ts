import {
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
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
 * Named filters' dates PR starts it with the whole-day, empty and exact-text cases. The operation set's PR 3 adds
 * groups, order and totals: a field on `Rendered` and its reading in each renderer below.
 */
export type Row = Record<string, unknown> & { key: string };

export interface RenderedCase {
  name: string;
  schema: ViewSchema;
  rows: readonly Row[];
  state: ViewState;
  /** The keys of the rows the view must show, in order, when the case states them. */
  expected?: readonly string[];
}

/** What a Grid Adapter renders for a view. */
export interface Rendered {
  rows: Row[];
}

/** The Rows Adapter: `applyView` over the Host's rows. */
export const renderWithRows = async ({ rows, state, schema }: RenderedCase): Promise<Rendered> => ({
  rows: applyView(rows, state, schema).rows,
});

const features = tableFeatures({
  coreReactivityFeature: storeReactivityBindings(),
  columnFilteringFeature,
  rowSortingFeature,
  columnGroupingFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  groupedRowModel: createGroupedRowModel(),
});

type RenderedTable = TanStackTableLike & { getRowModel(): { rows: Array<{ original: Row }> } };

/** The TanStack Table adapter: a table over the same rows, with `gridcueFilterFn`, given the view through the adapter. */
export const renderWithTanStack = async ({ rows, state, schema }: RenderedCase): Promise<Rendered> => {
  const table = constructTable({
    features,
    data: rows,
    defaultColumn: { filterFn: gridcueFilterFn },
    columns: schema.columns.map((c) => ({ accessorKey: c.id, header: c.label })),
  } as never) as unknown as RenderedTable;
  const adapter = createTanStackAdapter({ schema, table });
  const written = await adapter.restore({ revision: adapter.getState().revision, state });
  if (!written.ok) throw new Error(`The TanStack Table adapter refused the view: ${written.code}`);
  return { rows: table.getRowModel().rows.map((r) => r.original) };
};

export const RENDERERS = { "Rows Adapter": renderWithRows, "TanStack Table adapter": renderWithTanStack } as const;

/** Runs each case through every Grid Adapter and compares what they render. */
export const runRenderedRows = (title: string, cases: readonly RenderedCase[]) => {
  describe(`${title}: rendered rows`, () => {
    for (const c of cases) {
      it(c.name, async () => {
        const [first, ...others] = await Promise.all(Object.values(RENDERERS).map((render) => render(c)));
        if (!first) throw new Error("no renderer");
        if (c.expected) expect(first.rows.map((r) => r.key)).toEqual(c.expected);
        for (const [i, other] of others.entries()) {
          expect(other.rows, `${Object.keys(RENDERERS)[i + 1]} against the Rows Adapter`).toEqual(first.rows);
        }
      });
    }
  });
};
