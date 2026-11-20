"use client";

import { generateAccounts, wealthMockOptions, wealthSchemaOptions } from "@gridcue-internal/wealth-fixtures";
import { AllCommunityModule, type ColDef, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { createGridCue, type GridCueController } from "gridcue";
import { createAgGridAdapter, gridcueColumnDefs, schemaFromAgGrid } from "gridcue/ag-grid";
import { createMockProvider } from "gridcue/mock";
import { GridCueBar } from "gridcue/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import "./ag-grid.css";

// AG Grid Community only: one module bundle, no Enterprise.
ModuleRegistry.registerModules([AllCommunityModule]);

// THE HOST'S CODE, NOT GRIDCUE'S. This is an AG Grid the app already had: its column definitions, its rows, its
// formatting. GridCue adds three things: a schema read from the column definitions, settings on those columns that set
// AG Grid's own filters to GridCue's meanings, and an adapter over the grid's api. The Mock Provider runs in the
// browser, so this page needs no key and no Server Handler.
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
const label = ({ value }: { value?: unknown }) => LABELS[String(value)] ?? String(value ?? "");

const rows = generateAccounts();
const columnDefs: ColDef[] = [
  { field: "account_number", headerName: "Account number" },
  { field: "household", headerName: "Household", minWidth: 160 },
  { field: "advisor_name", headerName: "Advisor", minWidth: 125 },
  { field: "registration_type", headerName: "Registration type", minWidth: 140, valueFormatter: label },
  { field: "custodian", headerName: "Custodian", minWidth: 125, valueFormatter: label },
  {
    field: "market_value",
    headerName: "Market value",
    minWidth: 135,
    cellDataType: "number",
    valueFormatter: ({ value }) => money.format(value),
  },
  {
    field: "concentration",
    headerName: "Concentration",
    minWidth: 145,
    cellDataType: "number",
    valueFormatter: ({ value }) => `${Math.round(value * 1000) / 10}%`,
  },
  {
    field: "unrealized_gain",
    headerName: "Unrealized gain",
    minWidth: 125,
    cellDataType: "number",
    valueFormatter: ({ value }) => money.format(value),
  },
  { field: "has_restricted_holding", headerName: "Restricted holdings", minWidth: 125, cellDataType: "boolean" },
  // The restricted column: hidden to start, and GridCue never offers it.
  { field: "tax_id", headerName: "Tax ID", hide: true },
];

// The schema is read from the column definitions and a sample of the rows. The fixture's options name what a
// definition can't say: kinds, aliases and the approved enum values.
const schema = schemaFromAgGrid(columnDefs, { ...wealthSchemaOptions, sampleRows: rows.map((row) => ({ ...row })) });
// Each column's filter offers only what GridCue reads there. Custodian and Registration type take the label a cell
// shows, such as “Northgate”, as well as the value's ID.
const gridColumnDefs = gridcueColumnDefs(schema, columnDefs);
// Columns share the width and wrap their header, so all nine columns and their filter icons show at 1280px.
const defaultColDef: ColDef = { flex: 1, minWidth: 110, wrapHeaderText: true, autoHeaderHeight: true };

// A little less padding in each cell, so nine columns and their icons fit at 1280px.
const theme = themeQuartz.withParams({ cellHorizontalPadding: 12 });

/** AG Grid's light and dark modes follow the page's `color-scheme`. */
const useColorScheme = () => {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      document.body.dataset.agThemeMode = query.matches ? "dark" : "light";
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
};

export function AgGridView() {
  useColorScheme();
  const [cue, setCue] = useState<GridCueController | null>(null);
  const provider = useMemo(() => createMockProvider(wealthMockOptions), []);

  return (
    <main className="ag-example">
      <div className="ag-head">
        <h1>Accounts, in AG Grid</h1>
        <nav aria-label="Examples">
          <Link href="/">Rows in memory</Link>
          <Link href="/paged">Rows from a server, paged</Link>
        </nav>
      </div>
      {cue ? (
        <GridCueBar controller={cue} />
      ) : (
        <p className="ag-note" role="status">
          Starting the grid…
        </p>
      )}
      <div className="ag-grid">
        <AgGridReact
          theme={theme}
          rowData={rows}
          columnDefs={gridColumnDefs}
          defaultColDef={defaultColDef}
          // The ready grid's api goes straight to the adapter. The adapter reads the grid's own filters and sorts, so
          // what a User sets in AG Grid's menus is part of the View State too.
          onGridReady={(e) => setCue(createGridCue({ schema, adapter: createAgGridAdapter({ schema, api: e.api }), provider }))}
        />
      </div>
    </main>
  );
}
