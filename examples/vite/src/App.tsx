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
import { createGridCue, createRemoteProvider, type HouseTerm } from "gridcue";
import { createTanStackAdapter, gridcueFilterFn, localValuesFromTable, schemaFromTanStack } from "gridcue/tanstack-table";
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
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
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
  last_contact: (v) => dateTime.format(new Date(v as string)),
};

// Two date columns of this app's own: the day an account opened, and the last contact with it.
interface Row extends AccountRow {
  opened: string;
  last_contact: string;
}
const columns: Array<ColumnDef<typeof features, Row>> = [
  ...wealthColumns,
  { id: "opened", label: "Opened" },
  { id: "last_contact", label: "Last contact" },
].map((c) => ({
  accessorKey: c.id as keyof Row,
  header: c.label,
  cell: (info) => (FORMAT[c.id] ?? String)(info.getValue()),
}));

// Synthetic dates worked out from each row's index and today in the browser's time zone: Opened spreads over four
// years back from today, so "opened in the last 90 days" keeps some rows and not all. Date.UTC rolls a day count over
// into earlier months and years, so this is arithmetic on calendar days.
const today = Object.fromEntries(
  new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(new Date())
    .map((p) => [p.type, p.value]),
);
const back = (days: number, hour = 0, minute = 0) =>
  new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) - days, hour, minute)).toISOString();
const data: Row[] = generateAccounts().map((row, i) => ({
  ...row,
  opened: back((i * 97) % 1461).slice(0, 10),
  last_contact: back((i * 13) % 120, 13 + (i % 8), (i * 7) % 60),
}));

// House Terms: the firm's own names for fixed filters. GridCue reads them in the browser and never sends them.
const houseTerms: HouseTerm[] = [
  { label: "Large", aliases: ["big"], where: [{ columnId: "market_value", operator: "gt", value: 1_000_000 }] },
  {
    label: "Needs attention",
    aliases: ["need attention", "needing attention"],
    where: [
      { columnId: "concentration", operator: "gt", value: 0.1 },
      { columnId: "has_restricted_holding", operator: "eq", value: true },
    ],
  },
];

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
    // No `calendar`: the rows are filtered in the browser, so the browser's time zone is the right one.
    const schema = schemaFromTanStack(table, {
      ...wealthSchemaOptions,
      columns: {
        ...wealthSchemaOptions.columns,
        opened: { kind: "date", aliases: ["opened", "open date"] },
        last_contact: { kind: "datetime", aliases: ["contacted", "last contacted"] },
      },
      houseTerms,
    });
    return createGridCue({
      schema,
      adapter: createTanStackAdapter({ schema, table }),
      provider: createRemoteProvider({ endpoint: "/api/gridcue" }),
      // Local Values: the names the table's rows hold, read in the browser and never sent.
      localValues: localValuesFromTable(table, ["advisor_name", "household"]),
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
