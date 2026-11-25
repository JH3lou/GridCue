// @vitest-environment jsdom

// Held-out harnesses for "an apply is done when the grid holds it" (spec 4.2 and 5.1, ADR 0031, spec section 10).
// Written after the build, from the spec and TanStack Table's own types, the way a Host sets a table up. Each one
// runs the whole shared contract suite once. They stay as a regression set.

import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnVisibilityState,
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  type GroupingState,
  type PaginationState,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type LegacyColumnDef,
  useLegacyTable,
} from "@tanstack/react-table/legacy";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GridAdapter } from "../src/core/adapter";
import { validatePlan } from "../src/core/validate";
import { createTanStackAdapter, gridcueFilterFn, schemaFromTanStack, type TanStackTableLike } from "../src/tanstack";
import { type ContractHarness, runAdapterContract } from "./adapter-contract";

type Account = { balance: number; region: string; owner: string };

// Synthetic rows. Five of them, so a page of two leaves the User able to sit on a later page.
const data: Account[] = [
  { balance: 5, region: "north", owner: "Owner A" },
  { balance: 20, region: "south", owner: "Owner B" },
  { balance: 12, region: "north", owner: "Owner C" },
  { balance: 31, region: "east", owner: "Owner D" },
  { balance: 8, region: "south", owner: "Owner E" },
];

beforeAll(() => {
  // Updates outside `act` render on their own, as in an app. `act` below flushes only the User's own changes.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(cleanup);

// How long each apply and restore takes to resolve, per harness. Measured around the adapter's own call with
// `performance.now()`, from the call to the settled promise, so it holds the wait for the Host's render.
const timings = new Map<string, Array<{ call: "apply" | "restore"; ok: boolean; ms: number }>>();

const timed = (name: string, adapter: GridAdapter): GridAdapter => {
  const log = timings.get(name) ?? [];
  timings.set(name, log);
  const apply = adapter.apply.bind(adapter);
  const restore = adapter.restore.bind(adapter);
  const measure =
    <A extends unknown[]>(call: "apply" | "restore", fn: (...args: A) => ReturnType<GridAdapter["apply"]>) =>
    async (...args: A) => {
      const start = performance.now();
      let ok = false;
      try {
        const result = await fn(...args);
        ok = result.ok;
        return result;
      } finally {
        log.push({ call, ok, ms: performance.now() - start });
      }
    };
  adapter.apply = measure("apply", apply);
  adapter.restore = measure("restore", restore);
  return adapter;
};

afterAll(() => {
  for (const [name, log] of timings) {
    const ms = log
      .filter((t) => t.ok)
      .map((t) => t.ms)
      .sort((a, b) => a - b);
    const at = (i: number) => ms[i] ?? Number.NaN;
    const mid = Math.floor(ms.length / 2);
    const median = ms.length % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
    const worst = at(ms.length - 1);
    console.log(
      `[held-out wait] ${name}: ${ms.length} successful applies and restores, median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms; ${log.length - ms.length} not ok`,
    );
  }
});

// Harness 1: all five View State slices Host-controlled on `useTable`, each with its handler.
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

const columns: Array<ColumnDef<typeof features, Account>> = [
  { accessorKey: "balance", header: "Balance" },
  { accessorKey: "region", header: "Region" },
  { accessorKey: "owner", header: "Owner" },
];

const useFullyControlledTable = () => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const table = useTable({
    features,
    columns,
    data,
    defaultColumn: { filterFn: gridcueFilterFn },
    state: { sorting, columnFilters, grouping, columnVisibility, columnOrder },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGroupingChange: setGrouping,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
  });
  // The Host renders its rows, as any page with a table does.
  table.getRowModel();
  return table;
};

// Harness 2: `useLegacyTable`, a v8-style app. The Host controls sorting, filters and pagination, and leaves
// grouping, visibility and order to the table. Pagination resets to the first page on its own after a sort or
// filter changes the rows, as TanStack does by default for client-side pagination.
const legacyColumns: Array<LegacyColumnDef<Account>> = [
  { accessorKey: "balance", header: "Balance" },
  { accessorKey: "region", header: "Region" },
  { accessorKey: "owner", header: "Owner" },
];

const useLegacyPagedTable = () => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  // The User has moved to the second page before asking GridCue for anything.
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 1, pageSize: 2 });
  const table = useLegacyTable({
    columns: legacyColumns,
    data,
    defaultColumn: { filterFn: gridcueFilterFn },
    state: { sorting, columnFilters, pagination },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    autoResetPageIndex: true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  table.getRowModel();
  return table;
};

type HostTable = TanStackTableLike & {
  getColumn(id: string): { toggleSorting(desc?: boolean): void } | undefined;
  store: TanStackTableLike["store"] & { state: { pagination?: PaginationState } };
};

const mount = (name: string, useHost: () => unknown) => {
  const hook = renderHook(useHost);
  // Created once, as the Vite example does: the hook returns a new object whenever table state changes.
  const table = hook.result.current as HostTable;
  const schema = schemaFromTanStack(table);
  const adapter = timed(name, createTanStackAdapter({ schema, table }));
  // The User's own change: a header click on Region, as TanStack's sort toggle handler makes it.
  const manualChange = () => act(() => table.getColumn("region")?.toggleSorting(false));
  return { table, schema, adapter, manualChange };
};

const FULL = "all five slices Host-controlled, useTable";
const LEGACY = "Host-controlled with pagination auto-reset, useLegacyTable";

const harness = (name: string, useHost: () => unknown) => (): ContractHarness => {
  const { adapter, manualChange } = mount(name, useHost);
  return { adapter, manualChange, numericColumn: "balance", otherColumn: "owner" };
};

runAdapterContract(`TanStack Table held-out, ${FULL}`, harness(FULL, useFullyControlledTable));
runAdapterContract(`TanStack Table held-out, ${LEGACY}`, harness(LEGACY, useLegacyPagedTable));

// Checks that the second harness is the setup it claims to be: TanStack's own page reset runs after GridCue's sort.
// Not part of the contract suite; it guards the harness, not the adapter.
describe(`TanStack Table held-out harness check, ${LEGACY}`, () => {
  it("starts on the second page and is back on the first once a GridCue sort is held", async () => {
    const { table, adapter } = mount("harness check", useLegacyPagedTable);
    expect(table.store.state.pagination?.pageIndex).toBe(1);
    const result = validatePlan(
      {
        protocolVersion: "0.1",
        id: "p_check",
        baseRevision: adapter.getState().revision,
        source: { channel: "api" },
        status: "ready",
        operations: [{ type: "sort.set", sorts: [{ columnId: "balance", direction: "desc" }] }],
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
    if (!result.ok) throw new Error(result.issues.map((i) => i.code).join(","));
    expect((await adapter.apply(result.plan)).ok).toBe(true);
    // Let React render the Host's page reset.
    await act(async () => {});
    expect(table.store.state.pagination?.pageIndex).toBe(0);
  });
});
