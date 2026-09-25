import {
  type AccountRow,
  generateAccounts,
  wealthColumns,
  wealthMockOptions,
  wealthSchemaOptions,
} from "@gridcue-internal/wealth-fixtures";
import {
  type ColumnDef,
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { createGridCue, type GridCueController, type IntentProvider, type ResolutionRequest } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { createTanStackAdapter, gridcueFilterFn, schemaFromTanStack } from "gridcue/tanstack-table";
import { useState } from "react";

export const features = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  columnGroupingFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  groupedRowModel: createGroupedRowModel(),
});

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const LABELS: Record<string, string> = {
  taxable: "Taxable",
  ira: "IRA",
  roth_ira: "Roth IRA",
  trust: "Trust",
  northgate: "Northgate",
  harborline: "Harborline",
  summit_trust: "Summit Trust",
};
const FORMAT: Partial<Record<string, (value: unknown) => string>> = {
  market_value: (v) => money.format(v as number),
  unrealized_gain: (v) => money.format(v as number),
  concentration: (v) => `${Math.round((v as number) * 1000) / 10}%`,
  has_restricted_holding: (v) => (v ? "Yes" : "No"),
  registration_type: (v) => LABELS[v as string] ?? String(v),
  custodian: (v) => LABELS[v as string] ?? String(v),
};
export const formatCell = (columnId: string, value: unknown) => (FORMAT[columnId] ?? String)(value);

const columns: Array<ColumnDef<typeof features, AccountRow>> = wealthColumns.map((c) => ({
  accessorKey: c.id as keyof AccountRow,
  header: c.label,
  cell: (info) => formatCell(c.id, info.getValue()),
}));

/** What the provider was sent last: shown in the developer panel to prove no rows leave the page. */
export interface LastRequest {
  request: ResolutionRequest | null;
}

/**
 * A synthetic wealth grid wired to GridCue with the keyless Mock Provider. The same hook powers the hero (a few rows)
 * and /demo (all 500). Everything runs in the browser: no server, no key.
 */
export function useWealthDemo(rowCount: number) {
  const [data] = useState(() => generateAccounts(rowCount));
  const [last] = useState<LastRequest>(() => ({ request: null }));
  const table = useTable({
    features,
    columns,
    data,
    defaultColumn: { filterFn: gridcueFilterFn },
    initialState: { columnVisibility: { tax_id: false } },
  });
  // Create the controller once: useTable returns a new object whenever table state changes.
  const [cue] = useState<GridCueController>(() => {
    const schema = schemaFromTanStack(table, wealthSchemaOptions);
    const mock = createMockProvider(wealthMockOptions);
    const provider: IntentProvider = {
      resolve: (request, signal) => {
        last.request = request;
        return mock.resolve(request, signal);
      },
    };
    return createGridCue({ schema, adapter: createTanStackAdapter({ schema, table }), provider });
  });
  return { table, cue, last };
}
