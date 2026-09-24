import { type AccountRow, generateAccounts, wealthColumns, wealthSchemaOptions } from "@gridcue-internal/wealth-fixtures";
import {
  type ColumnDef,
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { createGridCue, createRemoteProvider } from "gridcue";
import { createTanStackAdapter, gridcueFilterFn, schemaFromTanStack } from "gridcue/tanstack-table";
import { useState } from "react";
import { CommandBar } from "@/components/gridcue/command-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DevPanel } from "./dev-panel";

// This is the app as it existed before GridCue: a shadcn Data Table on TanStack Table v9.
const features = tableFeatures({
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
const columns: Array<ColumnDef<typeof features, AccountRow>> = wealthColumns.map((c) => ({
  accessorKey: c.id as keyof AccountRow,
  header: c.label,
  cell: (info) => (FORMAT[c.id] ?? String)(info.getValue()),
}));
const data = generateAccounts();

export function App() {
  const table = useTable({
    features,
    columns,
    data,
    defaultColumn: { filterFn: gridcueFilterFn }, // GridCue line 1 of 3
    initialState: { columnVisibility: { tax_id: false } },
  });

  // GridCue lines 2 and 3: an adapter over the existing table, and a controller.
  // Create it once: useTable returns a new object whenever table state changes.
  const [cue] = useState(() => {
    const schema = schemaFromTanStack(table, wealthSchemaOptions);
    return createGridCue({
      schema,
      adapter: createTanStackAdapter({ schema, table }),
      provider: createRemoteProvider({ endpoint: "/api/gridcue" }),
    });
  });
  const [showDev, setShowDev] = useState(false);
  const rows = table.getRowModel().rows;

  return (
    <main className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Accounts</h1>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showDev} onChange={(e) => setShowDev(e.target.checked)} /> Developer panel
        </label>
      </header>
      <CommandBar controller={cue} />
      {showDev && <DevPanel controller={cue} />}
      <p className="text-muted-foreground text-sm">{rows.length} rows</p>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.slice(0, 100).map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}
