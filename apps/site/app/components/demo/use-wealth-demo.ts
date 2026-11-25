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
import { createGridCue, type GridCueController, type IntentProvider, type ResolutionRequest, type SchemaOptions } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { createTanStackAdapter, gridcueFilterFn, localValuesFromTable, schemaFromTanStack } from "gridcue/tanstack-table";
import { useState, useSyncExternalStore } from "react";

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
export const formatCell = (columnId: string, value: unknown) => (FORMAT[columnId] ?? String)(value);

/** The demo's two date columns, beside the fixture's own: the day the account opened, and the last contact with it. */
interface DatedRow extends AccountRow {
  opened: string;
  last_contact: string;
}

/**
 * Adds the two dates to each row, worked out from its index and today in the browser's time zone, so "opened in the
 * last 90 days" always keeps some rows and not all. Opened dates spread over four years back from today.
 */
const withDates = (rows: AccountRow[], now: Date): DatedRow[] => {
  const today: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now)) {
    today[part.type] = part.value;
  }
  // Date.UTC rolls a day count over into earlier months and years, so this is arithmetic on calendar days.
  const back = (days: number, hour = 0, minute = 0) =>
    new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) - days, hour, minute)).toISOString();
  return rows.map((row, i) => ({
    ...row,
    opened: back((i * 97) % 1461).slice(0, 10),
    last_contact: back((i * 13) % 120, 13 + (i % 8), (i * 7) % 60),
  }));
};

const never = () => () => {};
/**
 * A cell of one of the two date columns. Its text is worked out from today in the browser's time zone, and the Site's
 * pages are prerendered on another day, in another zone. So the prerendered cell holds blank figures as wide as a date,
 * and the browser writes the date in once the page is its own: the two never disagree, and the column keeps its width.
 */
function DateCell({ getValue, column }: { getValue: () => unknown; column: { id: string } }) {
  const inBrowser = useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
  return inBrowser ? formatCell(column.id, getValue()) : "\u2007".repeat(column.id === "opened" ? 10 : 21);
}

const fixtureColumns = wealthColumns.map(
  (c): ColumnDef<typeof features, AccountRow> => ({
    accessorKey: c.id as keyof AccountRow,
    header: c.label,
    cell: (info) => formatCell(c.id, info.getValue()),
  }),
);
// Opened sits right after the Advisor, where it shows without scrolling the table sideways; Last contact is last.
const OPENED_AT = wealthColumns.findIndex((c) => c.id === "advisor_name") + 1;
const columns: Array<ColumnDef<typeof features, AccountRow>> = [
  ...fixtureColumns.slice(0, OPENED_AT),
  { id: "opened", header: "Opened", accessorFn: (row) => (row as DatedRow).opened, cell: DateCell },
  ...fixtureColumns.slice(OPENED_AT),
  { id: "last_contact", header: "Last contact", accessorFn: (row) => (row as DatedRow).last_contact, cell: DateCell },
];

/**
 * The fixture's schema options plus the demo's two date columns and its House Terms, which GridCue reads in the browser
 * and never sends. No `calendar`: the rows are filtered in the browser, so the browser's time zone is the right one.
 */
const demoSchemaOptions: SchemaOptions = {
  ...wealthSchemaOptions,
  columns: {
    ...wealthSchemaOptions.columns,
    opened: { kind: "date", aliases: ["opened", "open date"] },
    last_contact: { kind: "datetime", aliases: ["contacted", "last contacted"] },
  },
  houseTerms: [
    { label: "Large", aliases: ["big"], where: [{ columnId: "market_value", operator: "gt", value: 1_000_000 }] },
    {
      label: "Needs attention",
      aliases: ["need attention", "needing attention"],
      where: [
        { columnId: "concentration", operator: "gt", value: 0.1 },
        { columnId: "has_restricted_holding", operator: "eq", value: true },
      ],
    },
  ],
};

/** What the provider was sent last: shown in the developer panel to prove no rows leave the page. */
export interface LastRequest {
  request: ResolutionRequest | null;
}

/**
 * A synthetic wealth grid wired to GridCue with the keyless Mock Provider. The same hook powers the hero (a few rows)
 * and /demo (all 500). Everything runs in the browser: no server, no key. `now` is the clock the rows' dates and a
 * request's dates are both worked out from; tests pass a fixed one.
 */
export function useWealthDemo(rowCount: number, now: () => Date = () => new Date()) {
  const [data] = useState<AccountRow[]>(() => withDates(generateAccounts(rowCount), now()));
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
    const schema = schemaFromTanStack(table, demoSchemaOptions);
    const mock = createMockProvider(wealthMockOptions);
    const provider: IntentProvider = {
      resolve: (request, signal) => {
        last.request = request;
        return mock.resolve(request, signal);
      },
    };
    // Local Values: the advisor and household names the rows hold, read in the browser and never sent.
    const localValues = localValuesFromTable(table, ["advisor_name", "household"]);
    return createGridCue({ schema, adapter: createTanStackAdapter({ schema, table }), provider, localValues, now });
  });
  return { table, cue, last };
}
