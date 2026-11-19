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
  rowAggregationFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import type { ViewSchema } from "../src/core/protocol";
import type * as GridCueTanStack from "../src/tanstack";

/**
 * A real TanStack Table v9 over a Host's rows, built as a Host builds one for GridCue: TanStack's own features and row
 * models, GridCue's count piece around the filtering, and GridCue's filter and total functions on every column. It is
 * the one way the tests build such a table. The package's tests (`rendered-rows.ts`) build it with the package source's
 * pieces, and `evals/run.ts` with the built package's, since the count piece only knows a row model its own module made.
 */
export type TanStackPieces = Pick<
  typeof GridCueTanStack,
  "gridcueCountFeature" | "gridcueCountRowModel" | "gridcueFilterFn" | "gridcueAggregationFn" | "gridcueAggregationValue"
>;

/**
 * Returns a builder of tables over `rows`, with a column for each of the schema's columns, read by `accessorKey`. Pass
 * `initialState` to start the table from a view other than every column in schema order, such as one with a column
 * hidden (`{ columnVisibility: { tax_id: false } }`).
 */
export const tanStackTables = (pieces: TanStackPieces) => {
  const features = tableFeatures({
    coreReactivityFeature: storeReactivityBindings(),
    columnFilteringFeature,
    rowSortingFeature,
    columnGroupingFeature,
    columnVisibilityFeature,
    columnOrderingFeature,
    columnPinningFeature,
    rowAggregationFeature,
    // Spread in, as `gridcueCountFeature`'s doc says: TanStack's types name only TanStack's own features.
    ...{ gridcueCountFeature: pieces.gridcueCountFeature },
    filteredRowModel: pieces.gridcueCountRowModel(createFilteredRowModel()),
    sortedRowModel: createSortedRowModel(),
    groupedRowModel: createGroupedRowModel(),
  });
  return <Table>(rows: readonly object[], schema: ViewSchema, initialState?: object): Table =>
    constructTable({
      features,
      data: rows,
      defaultColumn: {
        filterFn: pieces.gridcueFilterFn,
        aggregationFn: pieces.gridcueAggregationFn,
        getAggregationValue: pieces.gridcueAggregationValue,
      },
      columns: schema.columns.map((c) => ({ accessorKey: c.id, header: c.label })),
      ...(initialState ? { initialState } : {}),
    } as never) as unknown as Table;
};
