// @vitest-environment jsdom

// The shared adapter contract on a table a v8 app moved to `useLegacyTable` (spec 5.2). It writes the table as a
// v8 app does: v8 column definitions, and the `get…RowModel` options in place of `features`. `tanstack.test.ts`
// builds its legacy table from the same options as its `useTable` one, to compare the two hooks. This file differs
// in what it checks: one v8-shaped table, in two harnesses, the table owning its state and the Host controlling it.
// No code under `src` moves for this file.

import {
  type ColumnFiltersState,
  type ColumnVisibilityState,
  filterFn_includesString,
  filterFn_inNumberRange,
  type SortingState,
} from "@tanstack/react-table";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type LegacyColumnDef,
  useLegacyTable,
} from "@tanstack/react-table/legacy";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGridCue } from "../src/core/controller";
import { validatePlan } from "../src/core/validate";
import { createMockProvider } from "../src/mock";
import { createTanStackAdapter, gridcueFilterFn, schemaFromTanStack, type TanStackTableLike, withGridCueFilter } from "../src/tanstack";
import { runAdapterContract } from "./adapter-contract";

type Account = { value: number; team: string; name: string };

const data: Account[] = [
  { value: 5, team: "b", name: "x" },
  { value: 20, team: "a", name: "y" },
  { value: 12, team: "b", name: "z" },
];

// v8-style column definitions: `accessorKey`, a string `header`, and a `cell` renderer.
const columns: LegacyColumnDef<Account>[] = [
  { accessorKey: "value", header: "Value", cell: (info) => String(info.getValue()) },
  { accessorKey: "team", header: "Team", cell: (info) => String(info.getValue()) },
  { accessorKey: "name", header: "Name", cell: (info) => String(info.getValue()) },
];

/** Which slices of the table's state the Host controls, with a change handler for each, as a v8 app does. */
type Control = { sorting?: boolean; filters?: boolean; visibility?: boolean };

// A v8 app's table: its own state hooks, then the options it already passes, with GridCue's filter function as the
// default. Only the hook's name and its import changed from `useReactTable`.
const useAccountsTable = (control: Control) => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});
  return useLegacyTable<Account>({
    data,
    columns,
    defaultColumn: { filterFn: gridcueFilterFn },
    state: {
      ...(control.sorting ? { sorting } : {}),
      ...(control.filters ? { columnFilters } : {}),
      ...(control.visibility ? { columnVisibility } : {}),
    },
    ...(control.sorting ? { onSortingChange: setSorting } : {}),
    ...(control.filters ? { onColumnFiltersChange: setColumnFilters } : {}),
    ...(control.visibility ? { onColumnVisibilityChange: setColumnVisibility } : {}),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
};

// A controlled table updates on its next render, so an apply is done only when the table holds it (spec 4.2).
// Updates outside `act` render on their own, as in an app. `act` below flushes only the User's own changes.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(cleanup);

const harnessOf = (control: Control) => () => {
  const hook = renderHook(() => useAccountsTable(control));
  // Created once, as the Vite guide does: the table object changes whenever table state changes.
  const table = hook.result.current as unknown as TanStackTableLike & { setSorting(sorting: SortingState): void };
  const adapter = createTanStackAdapter({ schema: schemaFromTanStack(table), table });
  // The User's own change goes through React, as a header click does.
  const manualChange = () => act(() => table.setSorting([{ id: "team", desc: false }]));
  return { adapter, manualChange, numericColumn: "value", otherColumn: "name" };
};

runAdapterContract("TanStack Table adapter, v8 app on useLegacyTable, table-owned", harnessOf({}));
runAdapterContract(
  "TanStack Table adapter, v8 app on useLegacyTable, Host-controlled sorting, filters and visibility with handlers",
  harnessOf({ sorting: true, filters: true, visibility: true }),
);

// The guide's recipe for a v8 column with its own filter input. `defaultColumn: { filterFn: gridcueFilterFn }`
// replaces v8's `auto` on every column that names no filter function, and `gridcueFilterFn` passes every row for a
// value that isn't GridCue's. So each column the Host filters gets the built-in function `auto` picked for it (or the
// one it named), through `besideGridCue`. The table resolves a filter value only for the function a column holds,
// so the helper resolves it before it calls the built-in. GridCue's own filter and the Host's own value on the
// column both have to keep working. The helper below is the guide's, word for word.

type BuiltInFilter = typeof filterFn_includesString;

/** A built-in TanStack filter function that keeps working beside GridCue's filters. */
const besideGridCue = (builtIn: BuiltInFilter) =>
  Object.assign(
    withGridCueFilter((row, columnId, value) =>
      builtIn(row as Parameters<BuiltInFilter>[0], columnId, builtIn.resolveFilterValue?.(value) ?? value),
    ),
    {
      // The Host's own empty value clears the filter, as before. GridCue's value is an object and is never cleared.
      autoRemove: (value: unknown) =>
        typeof value === "object" && value !== null && !Array.isArray(value) ? false : Boolean(builtIn.autoRemove?.(value)),
    },
  );

type Holding = { value: number | null; team: string; name: string };

const holdings: Holding[] = [
  { value: 5, team: "Blue", name: "x" },
  { value: 20, team: "Red", name: "y" },
  { value: 12, team: "Blue", name: "z" },
  { value: null, team: "Green", name: "w" },
];

const applyFilter = async (adapter: ReturnType<typeof createTanStackAdapter>, columnId: string, operator: "eq" | "gt", value: unknown) => {
  const result = validatePlan(
    {
      protocolVersion: "0.1",
      id: `p_${columnId}`,
      baseRevision: adapter.getState().revision,
      source: { channel: "api" },
      status: "ready",
      operations: [
        {
          type: "filter.add",
          combineWith: "and",
          predicate: { id: "f1", type: "predicate", columnId, operator, value },
        },
      ],
      evidence: [],
      clarifications: [],
      unsupportedSegments: [],
    },
    {
      schema: adapter.getSchema(),
      capabilities: adapter.getCapabilities(),
      current: adapter.getState(),
      defaultState: adapter.getDefaultState(),
    },
  );
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.code).join(","));
  return adapter.apply(result.plan);
};

const mountHoldings = (columns: LegacyColumnDef<Holding>[]) => {
  const hook = renderHook(() =>
    useLegacyTable<Holding>({
      data: holdings,
      columns,
      defaultColumn: { filterFn: gridcueFilterFn },
      getCoreRowModel: getCoreRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
    }),
  );
  const table = hook.result.current as unknown as TanStackTableLike & {
    setColumnFilters(filters: ColumnFiltersState): void;
    getColumn(id: string): { setFilterValue(value: unknown): void } | undefined;
    getState(): { columnFilters: ColumnFiltersState };
  };
  const adapter = createTanStackAdapter({ schema: schemaFromTanStack(table), table });
  const rows = () => hook.result.current.getRowModel().rows.map((row) => `${row.original.team}/${row.original.value}`);
  return { adapter, table, rows };
};

describe("a v8 column on `auto`, under the guide's default filter function", () => {
  it("passes every row for the Host's own value, so the guide's recipe is needed", () => {
    const { table, rows } = mountHoldings([
      { accessorKey: "value", header: "Value" },
      { accessorKey: "team", header: "Team" },
      { accessorKey: "name", header: "Name" },
    ]);
    act(() => table.setColumnFilters([{ id: "team", value: "blu" }]));
    expect(rows()).toEqual(["Blue/5", "Red/20", "Blue/12", "Green/null"]);
  });
});

describe("a v8 column with its own filter input, through besideGridCue", () => {
  const columns: LegacyColumnDef<Holding>[] = [
    { accessorKey: "value", header: "Value", filterFn: besideGridCue(filterFn_inNumberRange) },
    { accessorKey: "team", header: "Team", filterFn: besideGridCue(filterFn_includesString) },
    { accessorKey: "name", header: "Name" },
  ];

  it("keeps the Host's text filter, in any case", () => {
    const { table, rows } = mountHoldings(columns);
    act(() => table.setColumnFilters([{ id: "team", value: "BLU" }]));
    expect(rows()).toEqual(["Blue/5", "Blue/12"]);
  });

  it("keeps the Host's range filter, closed and open-ended", () => {
    const { table, rows } = mountHoldings(columns);
    act(() => table.setColumnFilters([{ id: "value", value: [10, 30] }]));
    expect(rows()).toEqual(["Red/20", "Blue/12"]);
    act(() => table.setColumnFilters([{ id: "value", value: ["", 15] }]));
    expect(rows()).toEqual(["Blue/5", "Blue/12"]);
  });

  it("clears the Host's range filter when both ends are emptied, as v8 did", () => {
    const { table, rows } = mountHoldings(columns);
    act(() => table.setColumnFilters([{ id: "value", value: [10, 30] }]));
    act(() => table.getColumn("value")?.setFilterValue(["", ""]));
    expect(table.getState().columnFilters).toEqual([]);
    expect(rows()).toEqual(["Blue/5", "Red/20", "Blue/12", "Green/null"]);
  });

  it("filters by GridCue's predicate on a text column", async () => {
    const { adapter, rows } = mountHoldings(columns);
    expect((await applyFilter(adapter, "team", "eq", "Blue")).ok).toBe(true);
    expect(rows()).toEqual(["Blue/5", "Blue/12"]);
  });

  it("filters by GridCue's predicate on a number column, beside the Host's text filter", async () => {
    const { adapter, table, rows } = mountHoldings(columns);
    act(() => table.setColumnFilters([{ id: "team", value: "blu" }]));
    expect((await applyFilter(adapter, "value", "gt", 10)).ok).toBe(true);
    expect(rows()).toEqual(["Blue/12"]);
  });

  it("keeps the Host's range filter on the column GridCue filters too", async () => {
    const { adapter, table, rows } = mountHoldings(columns);
    act(() => table.setColumnFilters([{ id: "value", value: [0, 15] }]));
    expect((await applyFilter(adapter, "value", "gt", 6)).ok).toBe(true);
    expect(rows()).toEqual(["Blue/12"]);
  });
});

// The TanStack adapter doesn't read a column's sort options (reported to the owner). On a column with
// `enableSorting: false` the table ignores GridCue's sort, and on one with `invertSorting: true` it shows the rows
// the other way round. Until the adapter reads them, the guide's Limits tell the Host to take `sort` out of that
// column's capabilities. These tests hold that advice: GridCue then never shows a ready sort on the column.
describe("a v8 column whose sort options GridCue can't follow", () => {
  const capabilitiesWithoutSort = ["filter", "group", "show", "hide", "reorder"] as const;

  for (const [label, option] of [
    ["enableSorting: false", { enableSorting: false }],
    ["invertSorting: true", { invertSorting: true }],
  ] as const) {
    it(`never applies a sort on a column with ${label}, once its capabilities leave sort out`, async () => {
      const hook = renderHook(() =>
        useLegacyTable<Account>({
          data,
          columns: [
            { accessorKey: "value", header: "Value", ...option },
            { accessorKey: "team", header: "Team" },
            { accessorKey: "name", header: "Name" },
          ],
          defaultColumn: { filterFn: gridcueFilterFn },
          getCoreRowModel: getCoreRowModel(),
          getFilteredRowModel: getFilteredRowModel(),
          getSortedRowModel: getSortedRowModel(),
          getGroupedRowModel: getGroupedRowModel(),
        }),
      );
      const table = hook.result.current as unknown as TanStackTableLike;
      const schema = schemaFromTanStack(table, { columns: { value: { capabilities: [...capabilitiesWithoutSort] } } });
      const adapter = createTanStackAdapter({ schema, table });
      const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
      await cue.propose("sort by value largest first");
      expect(cue.getState().status).not.toBe("ready");
      expect(adapter.getState().state.sorts).toEqual([]);
      expect(hook.result.current.getRowModel().rows.map((row) => row.original.value)).toEqual([5, 20, 12]);
    });
  }
});
