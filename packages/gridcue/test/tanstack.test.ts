// @vitest-environment jsdom

import { useTable } from "@tanstack/react-table";
import { getCoreRowModel, getFilteredRowModel, getSortedRowModel, useLegacyTable } from "@tanstack/react-table/legacy";
import {
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnVisibilityFeature,
  constructTable,
  createFilteredRowModel,
  createGroupedRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  functionalUpdate,
  rowAggregationFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GridAdapter } from "../src/core/adapter";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { createGridCue } from "../src/core/controller";
import { isGridCueError } from "../src/core/errors";
import type { ViewOperation } from "../src/core/protocol";
import { defineSchema } from "../src/core/schema";
import { validatePlan } from "../src/core/validate";
import { createMockProvider } from "../src/mock";
import {
  createTanStackAdapter,
  gridcueAggregationFn,
  gridcueAggregationValue,
  gridcueFilterFn,
  localValuesFromTable,
  schemaFromTanStack,
  type TanStackTableLike,
  withGridCueFilter,
} from "../src/tanstack";
import { DATED_COLUMNS, DATED_ROWS, runAdapterContract } from "./adapter-contract";

const rows = [
  { value: 5, team: "b", name: "x" },
  { value: 20, team: "a", name: "y" },
  { value: 12, team: "b", name: "z" },
];

const featureList = {
  coreReactivityFeature: storeReactivityBindings(),
  columnFilteringFeature,
  rowSortingFeature,
  columnGroupingFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  groupedRowModel: createGroupedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
};
const features = tableFeatures(featureList);
/** The same features with `columnPinningFeature`, which `renders: ["pinning"]` needs. */
const pinningFeatures = tableFeatures({ ...featureList, columnPinningFeature });
/** With `columnPinningFeature` and `rowAggregationFeature`, which `renders: ["totals"]` needs. */
const drawingFeatures = tableFeatures({ ...featureList, columnPinningFeature, rowAggregationFeature });
/** What a Host registers on `defaultColumn` for GridCue: its filter function, and its two total functions. */
const GRIDCUE_COLUMN = { filterFn: gridcueFilterFn, aggregationFn: gridcueAggregationFn, getAggregationValue: gridcueAggregationValue };

type TestTable = TanStackTableLike & {
  getRowModel(): { rows: Array<{ original: (typeof rows)[number] }> };
  setPageIndex(index: number): void;
  setRowSelection(selection: Record<string, boolean>): void;
};

/** A table with no pinning feature, with `columnPinningFeature`, or with it and the totals GridCue reads. */
type Drawn = boolean | "totals";
const featuresFor = (drawn: Drawn) => (drawn === "totals" ? drawingFeatures : drawn ? pinningFeatures : features);
const defaultColumnFor = (drawn: Drawn) => (drawn === "totals" ? GRIDCUE_COLUMN : { filterFn: gridcueFilterFn });

const makeTable = (pinning: Drawn = false) =>
  constructTable({
    features: featuresFor(pinning),
    data: rows,
    defaultColumn: defaultColumnFor(pinning),
    columns: [
      { accessorKey: "value", header: "Value" },
      { accessorKey: "team", header: "Team" },
      { accessorKey: "name", header: "Name" },
    ],
  } as never) as unknown as TestTable;

/** Like `makeTable`, but the "value" column keeps its own Host filter function alongside GridCue's. */
const makeTableWithHostFilter = () =>
  constructTable({
    features,
    data: rows,
    defaultColumn: { filterFn: gridcueFilterFn },
    columns: [
      {
        accessorKey: "value",
        header: "Value",
        filterFn: withGridCueFilter((row, id, value) => (row.getValue(id) as number) >= (value as { min: number }).min),
      },
      { accessorKey: "team", header: "Team" },
      { accessorKey: "name", header: "Name" },
    ],
  } as never) as unknown as TestTable;

/** A table over the contract's dated rows, with a column for each of their keys. */
const makeDatedTable = (pinning: Drawn = false) =>
  constructTable({
    features: featuresFor(pinning),
    data: DATED_ROWS,
    defaultColumn: defaultColumnFor(pinning),
    columns: DATED_COLUMNS.map((id) => ({ accessorKey: id, header: id })),
  } as never) as unknown as TestTable;

/** What the contract's tables draw when they draw both: pins through `columnPinningFeature`, and the density. */
const BOTH = ["pinning", "density"] as const;
/** And when they draw all three: the totals too, through `gridcueAggregationFn`. */
const ALL = ["pinning", "density", "totals"] as const;
type Renders = ReadonlyArray<"pinning" | "density" | "totals">;
const drawnFor = (renders: Renders | undefined): Drawn => (renders?.includes("totals") ? "totals" : !!renders);

const constructedHarness = (renders?: Renders) => () => {
  const table = makeTable(drawnFor(renders));
  const adapter = createTanStackAdapter({ schema: schemaFromTanStack(table), table, ...(renders ? { renders } : {}) });
  return {
    adapter,
    manualChange: () => table.setSorting([{ id: "team", desc: false }]),
    numericColumn: "value",
    otherColumn: "name",
    dated: () => {
      const dated = makeDatedTable(drawnFor(renders));
      return createTanStackAdapter({ schema: schemaFromTanStack(dated), table: dated, ...(renders ? { renders } : {}) });
    },
  };
};

runAdapterContract("TanStack Table adapter", constructedHarness());
runAdapterContract("TanStack Table adapter, renders pinning and density", constructedHarness(BOTH), { renders: BOTH });
runAdapterContract("TanStack Table adapter, renders totals", constructedHarness(["totals"]), { renders: ["totals"] });
runAdapterContract("TanStack Table adapter, renders pinning, density and totals", constructedHarness(ALL), { renders: ALL });

// The same suite through React's `useTable` and `useLegacyTable`, where the Host may control a slice of the
// table's state. A controlled table updates on its next render, so an apply is done only when the table holds
// it (spec 4.2). The first harness owns its state, as every table above does.
beforeAll(() => {
  // Updates outside `act` render on their own, as in an app. `act` below flushes only the User's own changes.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(cleanup);

const reactFeatureList = {
  columnFilteringFeature,
  rowSortingFeature,
  columnGroupingFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  groupedRowModel: createGroupedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
};
const reactFeatures = tableFeatures(reactFeatureList);
const reactPinningFeatures = tableFeatures({ ...reactFeatureList, columnPinningFeature });
const reactDrawingFeatures = tableFeatures({ ...reactFeatureList, columnPinningFeature, rowAggregationFeature });
const reactColumns = [
  { accessorKey: "value", header: "Value" },
  { accessorKey: "team", header: "Team" },
  { accessorKey: "name", header: "Name" },
];

type Sorting = Array<{ id: string; desc: boolean }>;
type Filters = Array<{ id: string; value: unknown }>;
type Pinning = { start: string[]; end: string[] };
/**
 * Which slices of the table's state the Host controls, and whether it gives a change handler, and what the adapter is
 * told the table draws. `pinning: "v8"` keeps the Host's pins in TanStack Table v8's shape, `left` and `right`.
 */
type Control = {
  sorting?: "handler" | "none";
  filters?: "handler";
  pinning?: "handler" | "none" | "v8";
  grouping?: "handler";
  renders?: Renders;
};

/** The rows and columns a Host table shows: the shared rows, or the contract's dated rows. */
type Grid = { data: readonly object[]; columns: ReadonlyArray<{ accessorKey: string; header: string }> };
const accounts: Grid = { data: rows, columns: reactColumns };
const datedGrid: Grid = { data: DATED_ROWS, columns: DATED_COLUMNS.map((id) => ({ accessorKey: id, header: id })) };

/** The Host's own state and handlers for the slices it controls: the options both hooks share. */
const useHostOptions = (control: Control, grid: Grid) => {
  const [sorting, setSorting] = useState<Sorting>([]);
  const [columnFilters, setColumnFilters] = useState<Filters>([]);
  const [columnPinning, setColumnPinning] = useState<Pinning | { left: string[]; right: string[] }>(
    control.pinning === "v8" ? { left: [], right: [] } : { start: [], end: [] },
  );
  const [grouping, setGrouping] = useState<string[]>([]);
  return {
    columns: grid.columns,
    data: grid.data,
    defaultColumn: control.renders?.includes("totals") ? GRIDCUE_COLUMN : { filterFn: gridcueFilterFn },
    state: {
      ...(control.sorting ? { sorting } : {}),
      ...(control.filters ? { columnFilters } : {}),
      ...(control.pinning ? { columnPinning } : {}),
      ...(control.grouping ? { grouping } : {}),
    },
    ...(control.sorting === "handler" ? { onSortingChange: setSorting } : {}),
    ...(control.filters === "handler" ? { onColumnFiltersChange: setColumnFilters } : {}),
    ...(control.pinning === "handler" || control.pinning === "v8" ? { onColumnPinningChange: setColumnPinning } : {}),
    ...(control.grouping === "handler" ? { onGroupingChange: setGrouping } : {}),
  };
};

const useHostTable = (control: Control, grid: Grid) =>
  useTable({
    ...useHostOptions(control, grid),
    features: control.renders?.includes("totals")
      ? reactDrawingFeatures
      : control.renders?.includes("pinning") || control.pinning
        ? reactPinningFeatures
        : reactFeatures,
  } as never);

const useHostLegacyTable = (control: Control, grid: Grid) =>
  useLegacyTable({
    ...useHostOptions(control, grid),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  } as never);

const makeHostTable = (control: Control, legacy: boolean, grid: Grid = accounts) => {
  const hook = legacy ? renderHook(() => useHostLegacyTable(control, grid)) : renderHook(() => useHostTable(control, grid));
  // Created once, as the Vite example does: useTable returns a new object whenever table state changes.
  const table = hook.result.current as unknown as TestTable;
  const schema = schemaFromTanStack(table);
  const adapter = createTanStackAdapter({ schema, table, ...(control.renders ? { renders: control.renders } : {}) });
  // The User's own change goes through React, as a header click does.
  const manualChange = () => act(() => table.setSorting([{ id: "team", desc: false }]));
  return { table, schema, adapter, manualChange };
};

const harnessOf = (control: Control, legacy: boolean) => () => {
  const { adapter, manualChange } = makeHostTable(control, legacy);
  return {
    adapter,
    manualChange,
    numericColumn: "value",
    otherColumn: "name",
    dated: () => makeHostTable(control, legacy, datedGrid).adapter,
  };
};

runAdapterContract("TanStack Table adapter, table-owned, useTable", harnessOf({}, false));
runAdapterContract(
  "TanStack Table adapter, Host-controlled sorting and filters with handlers, useTable",
  harnessOf({ sorting: "handler", filters: "handler" }, false),
);
runAdapterContract(
  "TanStack Table adapter, Host-controlled sorting and filters with handlers, useLegacyTable",
  harnessOf({ sorting: "handler", filters: "handler" }, true),
);
// The same, with the adapter told the table draws pins and density. Pins go through TanStack's own state, which the
// Host may control too; the adapter holds the density.
runAdapterContract("TanStack Table adapter, table-owned, useTable, renders pinning and density", harnessOf({ renders: BOTH }, false), {
  renders: BOTH,
});
runAdapterContract(
  "TanStack Table adapter, Host-controlled sorting, filters and pins with handlers, useTable, renders pinning and density",
  harnessOf({ sorting: "handler", filters: "handler", pinning: "handler", renders: BOTH }, false),
  { renders: BOTH },
);
runAdapterContract(
  "TanStack Table adapter, Host-controlled sorting, filters and pins with handlers, useLegacyTable, renders pinning and density",
  harnessOf({ sorting: "handler", filters: "handler", pinning: "handler", renders: BOTH }, true),
  { renders: BOTH },
);
// And with totals, which the adapter holds and `gridcueAggregationFn` reads; the Host may control the grouping.
runAdapterContract(
  "TanStack Table adapter, table-owned, useTable, renders pinning, density and totals",
  harnessOf({ renders: ALL }, false),
  {
    renders: ALL,
  },
);
runAdapterContract(
  "TanStack Table adapter, Host-controlled sorting, filters, pins and grouping with handlers, useTable, renders pinning, density and totals",
  harnessOf({ sorting: "handler", filters: "handler", pinning: "handler", grouping: "handler", renders: ALL }, false),
  { renders: ALL },
);
runAdapterContract(
  "TanStack Table adapter, Host-controlled sorting, filters, pins and grouping with handlers, useLegacyTable, renders pinning, density and totals",
  harnessOf({ sorting: "handler", filters: "handler", pinning: "handler", grouping: "handler", renders: ALL }, true),
  { renders: ALL },
);

describe("TanStack Table adapter, Host-controlled sorting with no change handler", () => {
  it("fails the apply and leaves the table unchanged", async () => {
    const { table, schema, adapter } = makeHostTable({ sorting: "none" }, false);
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    await cue.propose("sort by value largest first");
    expect(cue.getState().status).toBe("ready");
    await cue.apply();
    // With no change handler the table never takes the sort, so the wait runs out and the apply fails.
    expect(cue.getState().status).toBe("error");
    expect(cue.getState().message).toContain("Nothing was changed");
    expect(cue.getState().canUndo).toBe(false);
    expect(table.store.state.sorting).toEqual([]);
    expect(adapter.getState().state.sorts).toEqual([]);
  });
});

/** A validated plan that sorts by value, largest first. */
const sortPlan = (adapter: GridAdapter) => {
  const result = validatePlan(
    {
      protocolVersion: "0.1",
      id: `p_${Math.random()}`,
      baseRevision: adapter.getState().revision,
      source: { channel: "api" },
      status: "ready",
      operations: [{ type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }],
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
  return result.plan;
};

/** Settles to "done" or "failed", and records when it has settled. */
const watch = (promise: Promise<unknown>) => {
  const seen = { settled: false };
  const outcome = promise.then(
    () => "done",
    () => "failed",
  );
  void outcome.finally(() => {
    seen.settled = true;
  });
  return { seen, outcome };
};

// Spec 4.2 and 5.1: an apply is done only when the table holds it.
describe("TanStack Table adapter: an apply is done when the table holds it", () => {
  const owned: Array<[string, () => GridAdapter]> = [
    [
      "constructTable",
      () => {
        const table = makeTable();
        return createTanStackAdapter({ schema: schemaFromTanStack(table), table });
      },
    ],
    ["useTable", () => makeHostTable({}, false).adapter],
  ];
  for (const [name, make] of owned) {
    it(`resolves in the same tick on a table that owns its state (${name})`, async () => {
      const adapter = make();
      const order: string[] = [];
      setTimeout(() => order.push("next tick"), 0);
      const result = await adapter.apply(sortPlan(adapter));
      order.push("applied");
      expect(order).toEqual(["applied"]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(adapter.getState()).toEqual(result.state);
    });
  }

  it("waits for the render on a table whose sorting the Host controls", async () => {
    const { table, adapter } = makeHostTable({ sorting: "handler" }, false);
    const pending = adapter.apply(sortPlan(adapter));
    // The Host's state is set, but the table has not rendered it yet.
    expect(table.store.state.sorting).toEqual([]);
    const result = await pending.then((r) => ({ r, sorting: table.store.state.sorting, now: adapter.getState() }));
    expect(result.sorting).toEqual([{ id: "value", desc: true }]);
    expect(result.r.ok).toBe(true);
    if (result.r.ok) expect(result.now).toEqual(result.r.state);
  });

  it("returns the Revision the table holds once it renders", async () => {
    const { adapter } = makeHostTable({ sorting: "handler", filters: "handler" }, false);
    const result = await adapter.apply(sortPlan(adapter));
    expect(result.ok).toBe(true);
    if (result.ok) expect(adapter.getState()).toEqual(result.state);
  });

  it("restores the same way: it waits for the render, then returns the Revision the table holds", async () => {
    const { table, adapter } = makeHostTable({ sorting: "handler" }, false);
    const snapshot = adapter.getState();
    expect((await adapter.apply(sortPlan(adapter))).ok).toBe(true);
    const pending = adapter.restore(snapshot);
    expect(table.store.state.sorting).toEqual([{ id: "value", desc: true }]);
    const result = await pending.then((r) => ({ r, sorting: table.store.state.sorting, now: adapter.getState() }));
    expect(result.sorting).toEqual([]);
    expect(result.r.ok).toBe(true);
    if (result.r.ok) expect(result.now).toEqual(result.r.state);
    expect(result.now.state).toEqual(snapshot.state);
    expect(result.now.revision).not.toBe(snapshot.revision);
  });

  it("fails an apply after 1,000 ms, and not before, when the table never takes the change", async () => {
    const { table, adapter } = makeHostTable({ sorting: "none" }, false);
    const before = adapter.getState();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { seen, outcome } = watch(adapter.apply(sortPlan(adapter)));
      await vi.advanceTimersByTimeAsync(999);
      expect(seen.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
    expect(table.store.state.sorting).toEqual([]);
    expect(adapter.getState()).toEqual(before);
  });

  it("fails a restore after 1,000 ms when the table never takes it", async () => {
    const { adapter } = makeHostTable({ sorting: "none" }, false);
    const now = adapter.getState();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const sorted = { ...now, state: { ...now.state, sorts: [{ columnId: "value", direction: "desc" as const }] } };
      const { seen, outcome } = watch(adapter.restore(sorted));
      await vi.advanceTimersByTimeAsync(999);
      expect(seen.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
    expect(adapter.getState()).toEqual(now);
  });

  it("applies and undoes through the Controller when the Host controls sorting", async () => {
    const { table, schema, adapter } = makeHostTable({ sorting: "handler" }, false);
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    await cue.propose("sort by value largest first");
    expect(await cue.apply()).toBe(true);
    expect(cue.getState()).toMatchObject({ status: "applied", canUndo: true });
    expect(table.store.state.sorting).toEqual([{ id: "value", desc: true }]);
    expect(await cue.undo()).toBe(true);
    expect(table.store.state.sorting).toEqual([]);
  });

  it("applies and undoes a filter and a sort when the Host controls only sorting", async () => {
    const { table, schema, adapter } = makeHostTable({ sorting: "handler" }, false);
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    await cue.propose("value over 6, sort by value largest first");
    expect(await cue.apply()).toBe(true);
    expect(cue.getState().canUndo).toBe(true);
    expect(adapter.getState().state.filters?.children).toHaveLength(1);
    expect(await cue.undo()).toBe(true);
    expect(table.store.state.sorting).toEqual([]);
    expect(adapter.getState().state.filters).toBeNull();
  });

  it("keeps the User's own sort when they change it while GridCue waits for the render", async () => {
    const { table, schema, adapter } = makeHostTable({ sorting: "handler" }, false);
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    await cue.propose("sort by value largest first");
    expect(cue.getState().status).toBe("ready");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const applying = cue.apply();
      // GridCue's write waits for the Host's render. The User clicks a header first.
      act(() => table.setSorting([{ id: "team", desc: false }]));
      await vi.advanceTimersByTimeAsync(1000);
      expect(await applying).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    expect(cue.getState().message).toBe(
      "The grid couldn't apply that change, and the view changed meanwhile, so GridCue left it as it is.",
    );
    expect(cue.getState().canUndo).toBe(false);
    expect(table.store.state.sorting).toEqual([{ id: "team", desc: false }]);
  });

  // The Revision an apply returns is the one the table had when it first held the write. A change after that is
  // newer than the apply, so undo is refused rather than erasing it.
  for (const [name, make] of [
    ["constructTable", () => makeTable()],
    ["useTable", () => makeHostTable({}, false).table],
  ] as Array<[string, () => TestTable]>) {
    it(`counts a change in the same tick as the apply as newer, so undo keeps it (${name})`, async () => {
      const table = make();
      const schema = schemaFromTanStack(table);
      const adapter = createTanStackAdapter({ schema, table });
      const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
      await cue.propose("sort by value largest first");
      expect(cue.getState().status).toBe("ready");
      const applying = cue.apply();
      // The User hides a column in the same tick, after GridCue's write.
      table.setColumnVisibility({ name: false });
      expect(await applying).toBe(true);
      expect(await cue.undo()).toBe(false);
      expect(cue.getState().message).toBe("The view changed after that update, so undo would erase newer changes.");
      expect(adapter.getState().state.visibleColumnIds).toEqual(["value", "team"]);
      expect(adapter.getState().state.sorts).toEqual([{ columnId: "value", direction: "desc" }]);
    });
  }

  it("counts a change the Host makes on the render that holds the write as newer, so undo keeps it", async () => {
    const { table, schema, adapter } = makeHostTable({ sorting: "handler" }, false);
    // The Host hides a column the first time the table holds a sort, in the same task as that render.
    let fired = false;
    table.store.subscribe(() => {
      if (!fired && (table.store.state.sorting?.length ?? 0) > 0) {
        fired = true;
        table.setColumnVisibility({ name: false });
      }
    });
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    await cue.propose("sort by value largest first");
    expect(await cue.apply()).toBe(true);
    expect(adapter.getState().state.visibleColumnIds).toEqual(["value", "team"]);
    expect(await cue.undo()).toBe(false);
    expect(adapter.getState().state.visibleColumnIds).toEqual(["value", "team"]);
  });
});

describe("TanStack Table adapter: handlers that don't store what GridCue wrote", () => {
  it("puts back a slice the table owns when a controlled slice with no handler never changes", async () => {
    const { table, schema, adapter } = makeHostTable({ sorting: "none" }, false);
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    await cue.propose("value over 6, sort by value largest first");
    expect(cue.getState().status).toBe("ready");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const applying = cue.apply();
      await vi.advanceTimersByTimeAsync(1000);
      expect(await applying).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    expect(cue.getState().message).toBe("The grid couldn't apply that change. The previous view is back.");
    expect(table.store.state.sorting).toEqual([]);
    expect(adapter.getState().state.filters).toBeNull();
  });

  it("fails the apply when the handler stores a different value, and says the view changed", async () => {
    const hook = renderHook(() => {
      const [sorting, setSorting] = useState<Sorting>([]);
      return useTable({
        features: reactFeatures,
        columns: reactColumns,
        data: rows,
        defaultColumn: { filterFn: gridcueFilterFn },
        state: { sorting },
        // The Host adds its own tiebreaker to every sort.
        onSortingChange: (updater: unknown) =>
          setSorting((old) => [
            ...(functionalUpdate(updater as never, old) as Sorting).filter((s) => s.id !== "name"),
            { id: "name", desc: false },
          ]),
      } as never);
    });
    const table = hook.result.current as unknown as TestTable;
    const schema = schemaFromTanStack(table);
    const adapter = createTanStackAdapter({ schema, table });
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    await cue.propose("sort by value largest first");
    expect(cue.getState().status).toBe("ready");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const applying = cue.apply();
      await vi.advanceTimersByTimeAsync(1000);
      expect(await applying).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    expect(cue.getState().message).toBe(
      "The grid couldn't apply that change, and the view changed meanwhile, so GridCue left it as it is.",
    );
    expect(cue.getState().canUndo).toBe(false);
    expect(table.store.state.sorting).toEqual([
      { id: "value", desc: true },
      { id: "name", desc: false },
    ]);
  });
});

describe("The Controller's recovery on a TanStack table", () => {
  it("puts the previous view back when a write stops between the column order and the column visibility", async () => {
    const table = makeTable();
    const schema = schemaFromTanStack(table);
    const adapter = createTanStackAdapter({ schema, table });
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    table.setColumnOrder(["name", "value", "team"]);
    table.setColumnVisibility({ team: false });
    const before = adapter.getState().state;
    await cue.propose("reset the view");
    expect(cue.getState().status).toBe("ready");
    // The Host's visibility handler throws once, after GridCue has written the column order.
    const real = table.setColumnVisibility.bind(table);
    let thrown = false;
    table.setColumnVisibility = (visibility) => {
      if (!thrown) {
        thrown = true;
        throw new Error("Host handler threw");
      }
      real(visibility);
    };
    expect(await cue.apply()).toBe(false);
    expect(thrown).toBe(true);
    expect(cue.getState().message).toBe("The grid couldn't apply that change. The previous view is back.");
    expect(adapter.getState().state.columnOrder).toEqual(before.columnOrder);
    expect(adapter.getState().state.visibleColumnIds).toEqual(before.visibleColumnIds);
  });

  it("puts the previous view back when the table holds the new filter beside the other filter on its column", async () => {
    const table = makeTable();
    const schema = schemaFromTanStack(table);
    const adapter = createTanStackAdapter({ schema, table });
    const predicate = (id: string, columnId: string, operator: string, value: unknown) => ({
      type: "filter.add" as const,
      combineWith: "and" as const,
      predicate: { id, type: "predicate" as const, columnId, operator, value },
    });
    const start = validatePlan(
      {
        protocolVersion: "0.1",
        id: "p_start",
        baseRevision: adapter.getState().revision,
        source: { channel: "api" },
        status: "ready",
        operations: [predicate("f1", "value", "gt", 1), predicate("f2", "team", "contains", "b")],
        evidence: [],
        clarifications: [],
        unsupportedSegments: [],
      } as never,
      { schema, capabilities: adapter.getCapabilities(), current: adapter.getState(), defaultState: adapter.getDefaultState() },
    );
    if (!start.ok) throw new Error(start.issues.map((i) => i.code).join(","));
    expect((await adapter.apply(start.plan)).ok).toBe(true);
    const before = adapter.getState().state.filters;
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    await cue.propose("also value under 100");
    expect(cue.getState().status).toBe("ready");
    // The Host's visibility handler throws once, after GridCue has written the filters. The table keeps one
    // filter entry per column, so it holds the new Value filter beside the old one, ahead of the Team filter.
    const real = table.setColumnVisibility.bind(table);
    let thrown = false;
    table.setColumnVisibility = (visibility) => {
      if (!thrown) {
        thrown = true;
        throw new Error("Host handler threw");
      }
      real(visibility);
    };
    expect(await cue.apply()).toBe(false);
    expect(thrown).toBe(true);
    expect(cue.getState().message).toBe("The grid couldn't apply that change. The previous view is back.");
    expect(adapter.getState().state.filters).toEqual(before);
  });
});

describe("schemaFromTanStack", () => {
  it("reads headers and infers kinds from rows", () => {
    const schema = schemaFromTanStack(makeTable(), { restricted: ["name"] });
    expect(schema.columns.map((c) => [c.id, c.label, c.kind, c.sensitivity])).toEqual([
      ["value", "Value", "number", "internal"],
      ["team", "Team", "string", "internal"],
      ["name", "Name", "string", "restricted"],
    ]);
  });
});

describe("TanStack end to end", () => {
  it("filters and sorts the real row model through the controller", async () => {
    const table = makeTable();
    const schema = schemaFromTanStack(table);
    const cue = createGridCue({ adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
    await cue.propose("value over 6, sort by value largest first");
    expect(cue.getState().status).toBe("ready");
    await cue.apply();
    expect(table.getRowModel().rows.map((r) => r.original.value)).toEqual([20, 12]);
    await cue.undo();
    expect(table.getRowModel().rows).toHaveLength(3);
  });

  it("filters rows by a negative amount", () => {
    const row = (v: number) => ({ getValue: () => v });
    const below = {
      gridcue: 1,
      kind: "number",
      predicates: [{ id: "f", type: "predicate", columnId: "value", operator: "lt", value: -50 }],
    };
    expect(gridcueFilterFn(row(-60), "value", below)).toBe(true);
    expect(gridcueFilterFn(row(-40), "value", below)).toBe(false);
  });

  it("lets a column keep its own filter function next to GridCue's", () => {
    const own = withGridCueFilter((row, id, value) => row.getValue(id) === value);
    const row = { getValue: () => "b" };
    expect(own(row, "team", "b")).toBe(true);
    expect(
      own(row, "team", {
        gridcue: 1,
        kind: "string",
        predicates: [{ id: "f", type: "predicate", columnId: "team", operator: "eq", value: "a" }],
      }),
    ).toBe(false);
  });

  it("keeps a Host's own non-GridCue filters when adding filters", async () => {
    const table = makeTable();
    table.setColumnFilters([{ id: "team", value: "b" }]);
    const schema = schemaFromTanStack(table);
    const cue = createGridCue({ adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
    await cue.propose("value over 6");
    await cue.apply();
    expect(table.store.state.columnFilters?.map((f) => f.id)).toEqual(["team", "value"]);
  });

  it("keeps a Host's own filters when GridCue clears its filters", async () => {
    const table = makeTable();
    table.setColumnFilters([{ id: "team", value: "b" }]);
    const schema = schemaFromTanStack(table);
    const cue = createGridCue({ adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
    await cue.propose("value over 6");
    await cue.apply();
    await cue.propose("clear filters");
    await cue.apply();
    expect(cue.getState().status).toBe("applied");
    expect(table.store.state.columnFilters?.map((f) => f.id)).toEqual(["team"]);
  });

  it("keeps a Host's own filters when undoing a GridCue filter", async () => {
    const table = makeTable();
    table.setColumnFilters([{ id: "team", value: "b" }]);
    const schema = schemaFromTanStack(table);
    const cue = createGridCue({ adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
    await cue.propose("value over 6");
    await cue.apply();
    const undone = await cue.undo();
    expect(undone).toBe(true);
    expect(table.store.state.columnFilters?.map((f) => f.id)).toEqual(["team"]);
  });

  it("keeps a Host filter and a GridCue filter on the same column as one entry", async () => {
    const table = makeTableWithHostFilter();
    table.setColumnFilters([{ id: "value", value: { min: 10 } }]);
    const schema = schemaFromTanStack(table);
    const cue = createGridCue({ adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
    await cue.propose("value over 6");
    await cue.apply();
    const filters = table.store.state.columnFilters ?? [];
    expect(filters.filter((f) => f.id === "value")).toHaveLength(1);
    // 20 and 12 satisfy both the Host's min:10 and GridCue's over-6.
    expect(table.getRowModel().rows.map((r) => r.original.value)).toEqual([20, 12]);
    const undone = await cue.undo();
    expect(undone).toBe(true);
    expect(table.store.state.columnFilters).toEqual([{ id: "value", value: { min: 10 } }]);
  });

  it("gives the Host back its own filter entry when GridCue clears its filters on that column", async () => {
    const table = makeTableWithHostFilter();
    table.setColumnFilters([{ id: "value", value: { min: 10 } }]);
    const schema = schemaFromTanStack(table);
    const cue = createGridCue({ adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
    await cue.propose("value over 6");
    await cue.apply();
    await cue.propose("clear filters");
    await cue.apply();
    expect(cue.getState().status).toBe("applied");
    expect(table.store.state.columnFilters).toEqual([{ id: "value", value: { min: 10 } }]);
  });

  it("tolerates a Host filter value that cannot be serialised, such as a BigInt", () => {
    const table = makeTable();
    table.setColumnFilters([{ id: "team", value: 10n }]);
    const schema = schemaFromTanStack(table);
    expect(() => createTanStackAdapter({ schema, table })).not.toThrow();
    expect(() => table.setColumnFilters([{ id: "team", value: 11n }])).not.toThrow();
  });

  it("keeps undo available across pagination and TanStack's own auto-reset after a sort", async () => {
    const table = makeTable();
    table.getRowModel(); // an initial render, so the sorted row model is already memoized once
    table.setPageIndex(1);
    const schema = schemaFromTanStack(table);
    const cue = createGridCue({ adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
    await cue.propose("sort by value largest first");
    await cue.apply();
    // Reading the row model again is what makes TanStack notice the sort changed and schedule its
    // own pageIndex reset to 0.
    table.getRowModel();
    await Promise.resolve();
    await Promise.resolve();
    expect((table.store.state as unknown as { pagination: { pageIndex: number } }).pagination.pageIndex).toBe(0);
    expect(cue.getState().canUndo).toBe(true);
    expect(await cue.undo()).toBe(true);
  });

  it("still applies after row selection changes between preview and apply", async () => {
    const table = makeTable();
    const schema = schemaFromTanStack(table);
    const cue = createGridCue({ adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
    await cue.propose("sort by value largest first");
    table.setRowSelection({ 0: true });
    await cue.apply();
    expect(cue.getState().status).toBe("applied");
  });

  it("still rejects a stale preview after a real manual sort change", async () => {
    const table = makeTable();
    const schema = schemaFromTanStack(table);
    const cue = createGridCue({ adapter: createTanStackAdapter({ schema, table }), provider: createMockProvider() });
    await cue.propose("sort by value largest first");
    table.setSorting([{ id: "team", desc: false }]);
    await cue.apply();
    expect(cue.getState().status).toBe("error");
  });
});

// Local Values from a TanStack table (named filters spec, 5.4; ADR 0025). Synthetic names only.
describe("localValuesFromTable", () => {
  const accounts = [
    { advisor_name: "Avery Lane", household: "Alder Household", market_value: 250_000 },
    { advisor_name: "Blake Moreno", household: "Birch Household", market_value: 1_800_000 },
    { advisor_name: "Casey Ortiz", household: "Alder Household", market_value: 900_000 },
  ];
  type Account = (typeof accounts)[number] & { subRows?: Account[] };
  type NamesTable = TanStackTableLike & {
    getRowModel(): { rows: Array<{ original: Account; subRows?: Array<{ original: Account }> }> };
    setOptions(updater: (old: Record<string, unknown>) => Record<string, unknown>): void;
    setPageSize(size: number): void;
  };
  const accountColumns = [
    { accessorKey: "advisor_name", header: "Advisor" },
    { accessorKey: "household", header: "Household" },
    { accessorKey: "market_value", header: "Market value" },
  ];
  const makeNames = (data: Account[] = accounts, more: Record<string, unknown> = {}) =>
    constructTable({
      features,
      data,
      defaultColumn: { filterFn: gridcueFilterFn },
      columns: accountColumns,
      ...more,
    } as never) as unknown as NamesTable;
  const namesSchema = defineSchema(
    accountColumns.map((c) => ({ id: c.accessorKey, label: c.header })),
    {
      rowNoun: "account",
      columns: {
        advisor_name: { aliases: ["advisor"], entity: "advisor" },
        household: { entity: "household" },
        market_value: { kind: "currency", aliases: ["value"] },
      },
    },
  );
  /** A GridCue filter the table holds: market value above $1,000,000, which hides Avery Lane's and Casey Ortiz's rows. */
  const overOneMillion = {
    id: "market_value",
    value: {
      gridcue: 1,
      kind: "currency",
      predicates: [{ id: "f", type: "predicate", columnId: "market_value", operator: "gt", value: 1_000_000 }],
    },
  };
  const make = (table: NamesTable, columnIds: string[] = ["advisor_name", "household"]) =>
    createGridCue({
      adapter: createTanStackAdapter({ schema: namesSchema, table }),
      provider: createMockProvider(),
      localValues: localValuesFromTable(table, columnIds),
    });
  const configError = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return isGridCueError(error) ? error.code : "not a GridCue error";
    }
    return "no error";
  };
  const withDana = (old: Record<string, unknown>) => ({
    ...old,
    data: [...accounts, { advisor_name: "Dana Whit", household: "Cedar Household", market_value: 5 }],
  });

  it("reads every loaded row, whatever the table's filters, sorting, grouping and pages", () => {
    const table = makeNames();
    table.setColumnFilters([overOneMillion]);
    table.setSorting([{ id: "advisor_name", desc: true }]);
    table.setGrouping(["household"]);
    table.setPageSize(1);
    table.setColumnVisibility({ advisor_name: false });
    // Grouped by household: the page holds one group row, and the filter leaves one account in it.
    const shown = table.getRowModel().rows.flatMap((r) => r.subRows ?? []);
    expect(shown.map((r) => r.original.advisor_name)).toEqual(["Blake Moreno"]);
    const values = localValuesFromTable(table, ["advisor_name", "household"]);
    expect(Object.keys(values)).toEqual(["advisor_name", "household"]);
    // The rows before filtering, in the table's data order. Repeated values stay: the Controller's index drops them.
    expect(values.advisor_name?.()).toEqual(["Avery Lane", "Blake Moreno", "Casey Ortiz"]);
    expect(values.household?.()).toEqual(["Alder Household", "Birch Household", "Alder Household"]);
  });

  it("finds a name whose row the table's filter hides", async () => {
    const table = makeNames();
    table.setColumnFilters([overOneMillion]);
    expect(table.getRowModel().rows.map((r) => r.original.advisor_name)).toEqual(["Blake Moreno"]);
    const cue = make(table);
    await cue.propose("accounts for Avery Lane");
    expect(cue.getState().status).toBe("ready");
    const added = cue
      .getState()
      .plan?.operations.flatMap((op) =>
        op.type === "filter.add" ? [[op.predicate.columnId, op.predicate.operator, op.predicate.value]] : [],
      );
    expect(added).toEqual([["advisor_name", "eq", "Avery Lane"]]);
  });

  it("reads sub-rows too", () => {
    const child: Account = { advisor_name: "Dana Whit", household: "Cedar Household", market_value: 10 };
    const data: Account[] = [{ ...(accounts[0] as Account), subRows: [child] }];
    const table = makeNames(data, { getSubRows: (row: Account) => row.subRows });
    expect(localValuesFromTable(table, ["advisor_name"]).advisor_name?.()).toEqual(["Avery Lane", "Dana Whit"]);
  });

  it("returns the same array while the table's data is the same array, so the Controller keeps its index", () => {
    const table = makeNames();
    const values = localValuesFromTable(table, ["advisor_name", "household"]);
    const first = values.advisor_name?.();
    const households = values.household?.();
    table.setColumnFilters([overOneMillion]);
    table.setSorting([{ id: "market_value", desc: true }]);
    table.getRowModel();
    expect(values.advisor_name?.()).toBe(first);
    expect(values.household?.()).toBe(households);
    // New data: a new array, read from the new rows.
    table.setOptions(withDana);
    const next = values.advisor_name?.();
    expect(next).not.toBe(first);
    expect(next).toEqual(["Avery Lane", "Blake Moreno", "Casey Ortiz", "Dana Whit"]);
    expect(values.advisor_name?.()).toBe(next);
  });

  it("reads a name the Host's new data adds, through the Controller", async () => {
    const table = makeNames();
    const cue = make(table);
    await cue.propose("accounts for Dana Whit");
    expect(cue.getState().status).not.toBe("ready");
    table.setOptions(withDana);
    await cue.propose("accounts for Dana Whit");
    expect(cue.getState().status).toBe("ready");
  });

  it("throws INPUT_CONFIG for a column id the table doesn't have, as createGridCue does for one the schema doesn't", () => {
    const table = makeNames();
    expect(configError(() => localValuesFromTable(table, ["advisor"]))).toBe("INPUT_CONFIG");
    expect(configError(() => localValuesFromTable(table, ["advisor_name", "tax_id"]))).toBe("INPUT_CONFIG");
  });

  it("leaves createGridCue's check to refuse a column that is not text, or that the schema doesn't have", () => {
    const table = makeNames();
    expect(configError(() => make(table, ["market_value"]))).toBe("INPUT_CONFIG");
    const fewer = defineSchema([{ id: "advisor_name", label: "Advisor" }]);
    expect(
      configError(() =>
        createGridCue({
          adapter: createTanStackAdapter({ schema: fewer, table }),
          provider: createMockProvider(),
          localValues: localValuesFromTable(table, ["advisor_name", "household"]),
        }),
      ),
    ).toBe("INPUT_CONFIG");
  });

  it("passes a value that is not text through as the table holds it, and the Controller's index drops it", async () => {
    const odd = [
      { advisor_name: "Avery Lane", household: 42, market_value: 1 },
      { advisor_name: null, household: "Alder Household", market_value: 2 },
    ] as unknown as Account[];
    const table = makeNames(odd);
    const values = localValuesFromTable(table, ["advisor_name", "household"]);
    expect(values.advisor_name?.()).toEqual(["Avery Lane", null]);
    expect(values.household?.()).toEqual([42, "Alder Household"]);
    const cue = make(table);
    await cue.propose("the Alder household");
    expect(cue.getState().status).toBe("ready");
  });

  it("stops the request with INPUT_LOCAL_VALUES when the table loses a column it reads", async () => {
    const table = makeNames();
    const cue = make(table);
    table.setOptions((old) => ({ ...old, columns: accountColumns.filter((c) => c.accessorKey !== "household") }));
    await cue.propose("accounts for Avery Lane");
    expect(cue.getState().status).toBe("error");
    expect(cue.getState().issues.map((i) => i.code)).toEqual(["INPUT_LOCAL_VALUES"]);
  });
});

// Pins and density (operation set spec, 4.2 and 5.3; ADR 0029). TanStack Table v9 holds pins as `start` and `end`, the
// View State's own shape, so the adapter writes and reads them through the table's state. TanStack has no density, so
// the adapter holds it.
describe("TanStack Table adapter: renders", () => {
  type Column = { id: string };
  type PinTable = TestTable & {
    setColumnPinning(pinning: Pinning): void;
    getColumn(id: string): { pin(position: "start" | "end" | false): void } | undefined;
    getStartVisibleLeafColumns(): Column[];
    getCenterVisibleLeafColumns(): Column[];
    getEndVisibleLeafColumns(): Column[];
  };
  const pinTable = () => makeTable(true) as unknown as PinTable;
  const drawn = (table: PinTable) => ({
    start: table.getStartVisibleLeafColumns().map((c) => c.id),
    center: table.getCenterVisibleLeafColumns().map((c) => c.id),
    end: table.getEndVisibleLeafColumns().map((c) => c.id),
  });
  const configError = (make: () => unknown) => {
    try {
      make();
    } catch (error) {
      return isGridCueError(error) ? { code: error.code, message: error.message } : { code: "other", message: String(error) };
    }
    return undefined;
  };
  const planWith = (adapter: GridAdapter, operations: ViewOperation[]) => {
    const result = validatePlan(
      {
        protocolVersion: "0.1",
        id: `p_${Math.random()}`,
        baseRevision: adapter.getState().revision,
        source: { channel: "api" },
        status: "ready",
        operations,
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
    return result.plan;
  };

  it("lists exactly today's operations with no renders, on a table with the pinning feature or without", () => {
    for (const table of [makeTable(), pinTable()]) {
      const schema = schemaFromTanStack(table);
      expect(createTanStackAdapter({ schema, table }).getCapabilities().operations).toEqual([...MVP_OPERATIONS]);
      expect(createTanStackAdapter({ schema, table, renders: [] }).getCapabilities().operations).toEqual([...MVP_OPERATIONS]);
    }
  });

  it("lists columns.pin and density.set for what renders names", () => {
    const table = pinTable();
    const schema = schemaFromTanStack(table);
    const ops = (renders: ReadonlyArray<"pinning" | "density">) =>
      createTanStackAdapter({ schema, table, renders }).getCapabilities().operations;
    expect(ops(["pinning"])).toEqual([...MVP_OPERATIONS, "columns.pin"]);
    expect(ops(["density"])).toEqual([...MVP_OPERATIONS, "density.set"]);
    expect(ops(["density", "pinning", "density"])).toEqual([...MVP_OPERATIONS, "columns.pin", "density.set"]);
  });

  it("throws INPUT_CONFIG naming a name it doesn't take", () => {
    const table = pinTable();
    const schema = schemaFromTanStack(table);
    const build = (renders: unknown) => () => createTanStackAdapter({ schema, table, renders } as never);
    expect(configError(build(["pinning", "sticky"]))).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("“sticky”") });
    expect(configError(build("pinning"))).toMatchObject({ code: "INPUT_CONFIG" });
  });

  it("throws INPUT_CONFIG for count, which it can't list yet, and for totals on a table that can't draw them", () => {
    const table = pinTable();
    const schema = schemaFromTanStack(table);
    expect(configError(() => createTanStackAdapter({ schema, table, renders: ["count"] } as never))).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("“count”"),
    });
    // This table has no rowAggregationFeature: tanstack-totals.test.ts has the rest.
    expect(configError(() => createTanStackAdapter({ schema, table, renders: ["totals"] }))).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("rowAggregationFeature"),
    });
  });

  it("lists aggregation.set when renders names totals, on a table with GridCue's total functions", () => {
    const table = makeTable("totals");
    const schema = schemaFromTanStack(table);
    expect(createTanStackAdapter({ schema, table, renders: ["totals"] }).getCapabilities().operations).toEqual([
      ...MVP_OPERATIONS,
      "aggregation.set",
    ]);
    expect(createTanStackAdapter({ schema, table, renders: ALL }).getCapabilities().operations).toEqual([
      ...MVP_OPERATIONS,
      "columns.pin",
      "density.set",
      "aggregation.set",
    ]);
    expect(createTanStackAdapter({ schema, table }).getCapabilities().operations).toEqual([...MVP_OPERATIONS]);
  });

  it("throws INPUT_CONFIG when renders names pinning and the table has no setColumnPinning", () => {
    const table = makeTable();
    const schema = schemaFromTanStack(table);
    expect(configError(() => createTanStackAdapter({ schema, table, renders: ["pinning"] }))).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("setColumnPinning"),
    });
    // Density needs nothing from the table.
    expect(createTanStackAdapter({ schema, table, renders: ["density"] }).getCapabilities().operations).toContain("density.set");
  });

  it("writes pins to TanStack's own state, which the table draws, and undoes them", async () => {
    const table = pinTable();
    const adapter = createTanStackAdapter({ schema: schemaFromTanStack(table), table, renders: ["pinning"] });
    const before = adapter.getState();
    const applied = await adapter.apply(
      planWith(adapter, [
        { type: "columns.pin", columnIds: ["name"], position: "start" },
        { type: "columns.pin", columnIds: ["value"], position: "end" },
      ]),
    );
    expect(applied.ok).toBe(true);
    expect(table.store.state.columnPinning).toEqual({ start: ["name"], end: ["value"] });
    expect(drawn(table)).toEqual({ start: ["name"], center: ["team"], end: ["value"] });
    expect(adapter.getState().state.pinnedColumnIds).toEqual({ start: ["name"], end: ["value"] });
    expect((await adapter.restore(before)).ok).toBe(true);
    expect(table.store.state.columnPinning).toEqual({ start: [], end: [] });
    expect(drawn(table)).toEqual({ start: [], center: ["value", "team", "name"], end: [] });
  });

  it("reports a pin the User makes with the table's own controls, so a stale plan is refused (ADR 0009)", async () => {
    const table = pinTable();
    const adapter = createTanStackAdapter({ schema: schemaFromTanStack(table), table, renders: ["pinning"] });
    const stale = sortPlan(adapter);
    const before = adapter.getState().revision;
    const heard: string[] = [];
    adapter.subscribe((s) => heard.push(JSON.stringify(s.state.pinnedColumnIds)));
    table.getColumn("team")?.pin("end");
    expect(heard).toEqual([JSON.stringify({ start: [], end: ["team"] })]);
    expect(adapter.getState().revision).not.toBe(before);
    expect(await adapter.apply(stale)).toMatchObject({ ok: false, code: "ADAPTER_STALE_REVISION" });
  });

  it("leaves the table's own pins alone and out of the View State when renders doesn't name pinning", async () => {
    const table = pinTable();
    const adapter = createTanStackAdapter({ schema: schemaFromTanStack(table), table });
    let calls = 0;
    adapter.subscribe(() => calls++);
    const before = adapter.getState();
    table.setColumnPinning({ start: ["name"], end: [] });
    expect(calls).toBe(0);
    expect(adapter.getState()).toEqual(before);
    expect((await adapter.apply(sortPlan(adapter))).ok).toBe(true);
    expect(table.store.state.columnPinning).toEqual({ start: ["name"], end: [] });
    expect(adapter.getState().state.pinnedColumnIds).toEqual({ start: [], end: [] });
  });

  it("keeps a hidden pinned column's pin, and the table draws it again when it shows", async () => {
    const table = pinTable();
    const adapter = createTanStackAdapter({ schema: schemaFromTanStack(table), table, renders: ["pinning"] });
    await adapter.apply(planWith(adapter, [{ type: "columns.pin", columnIds: ["name"], position: "start" }]));
    await adapter.apply(planWith(adapter, [{ type: "columns.hide", columnIds: ["name"] }]));
    expect(adapter.getState().state.pinnedColumnIds).toEqual({ start: ["name"], end: [] });
    expect(drawn(table).start).toEqual([]);
    await adapter.apply(planWith(adapter, [{ type: "columns.show", columnIds: ["name"] }]));
    expect(drawn(table).start).toEqual(["name"]);
  });

  it("holds the density and reads it back, past a manual change, and restores it on undo", async () => {
    const table = makeTable();
    const adapter = createTanStackAdapter({ schema: schemaFromTanStack(table), table, renders: ["density"] });
    const before = adapter.getState();
    expect(before.state.density).toBe("comfortable");
    let calls = 0;
    adapter.subscribe(() => calls++);
    const applied = await adapter.apply(planWith(adapter, [{ type: "density.set", density: "compact" }]));
    expect(applied.ok).toBe(true);
    // A write that changes only the density is one change, with its own Revision.
    expect(calls).toBe(1);
    expect(adapter.getState().revision).not.toBe(before.revision);
    expect(adapter.getState().state.density).toBe("compact");
    // The User sorts with a header: the density stays as GridCue wrote it.
    table.setSorting([{ id: "team", desc: false }]);
    expect(adapter.getState().state.density).toBe("compact");
    expect((await adapter.restore(before)).ok).toBe(true);
    expect(adapter.getState().state).toEqual(before.state);
    // The default view keeps the default density, so a reset returns to it.
    expect(adapter.getDefaultState().density).toBe("comfortable");
  });

  it("keeps the default density, and refuses a plan that sets one, when renders doesn't name density", () => {
    const table = makeTable();
    const adapter = createTanStackAdapter({ schema: schemaFromTanStack(table), table });
    expect(adapter.getState().state.density).toBe("comfortable");
    expect(() => planWith(adapter, [{ type: "density.set", density: "compact" }])).toThrow();
  });

  it("pins and sets the density through the Controller, and undoes each", async () => {
    const table = pinTable();
    const schema = schemaFromTanStack(table);
    const adapter = createTanStackAdapter({ schema, table, renders: ["pinning", "density"] });
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    await cue.propose("pin name to the end");
    expect(cue.getState().status).toBe("ready");
    expect(await cue.apply()).toBe(true);
    expect(drawn(table).end).toEqual(["name"]);
    await cue.propose("compact view");
    expect(cue.getState().status).toBe("ready");
    expect(await cue.apply()).toBe(true);
    expect(adapter.getState().state.density).toBe("compact");
    expect(await cue.undo()).toBe(true);
    expect(adapter.getState().state.density).toBe("comfortable");
    expect(drawn(table).end).toEqual(["name"]);
    expect(await cue.undo()).toBe(true);
    expect(drawn(table).end).toEqual([]);
  });

  it("asks “This grid can't …” and changes nothing when renders names neither", async () => {
    const table = pinTable();
    const schema = schemaFromTanStack(table);
    const adapter = createTanStackAdapter({ schema, table });
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    const before = adapter.getState();
    await cue.propose("pin name to the end");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().plan?.clarifications.map((c) => [c.prompt, c.options?.length ?? 0])).toEqual([
      ["This grid can't pin columns.", 0],
    ]);
    await cue.propose("compact view");
    expect(cue.getState().plan?.clarifications.map((c) => [c.prompt, c.options?.length ?? 0])).toEqual([
      ["This grid can't change its density.", 0],
    ]);
    expect(await cue.apply()).toBe(false);
    expect(adapter.getState()).toEqual(before);
  });
});

// The pins' shape on each TanStack Table the repo tests: v9's `useTable` and `constructTable`, and a v8 app moved to
// `useLegacyTable` (tanstack-legacy.test.ts), hold `start` and `end`. TanStack Table v8 itself held `left` and `right`.
describe("TanStack Table adapter: the pins' shape", () => {
  for (const legacy of [false, true]) {
    const hook = legacy ? "useLegacyTable" : "useTable";
    it(`holds pins as start and end on ${hook}, the Host controlling them or not`, async () => {
      for (const pinning of [undefined, "handler"] as const) {
        const { table, adapter } = makeHostTable({ renders: BOTH, ...(pinning ? { pinning } : {}) }, legacy);
        expect(table.store.state.columnPinning).toEqual({ start: [], end: [] });
        const plan = validatePlan(
          {
            protocolVersion: "0.1",
            id: "p_pin",
            baseRevision: adapter.getState().revision,
            source: { channel: "api" },
            status: "ready",
            operations: [{ type: "columns.pin", columnIds: ["name"], position: "start" }],
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
        if (!plan.ok) throw new Error("not valid");
        expect((await adapter.apply(plan.plan)).ok).toBe(true);
        expect(table.store.state.columnPinning).toEqual({ start: ["name"], end: [] });
      }
    });

    it(`throws INPUT_CONFIG on ${hook} when the Host keeps its pins as v8's left and right`, () => {
      expect(() => makeHostTable({ pinning: "v8", renders: ["pinning"] }, legacy)).toThrow(/“left” and “right”/);
      // Without "pinning" the adapter never reads or writes pins, so it builds as before.
      expect(makeHostTable({ pinning: "v8" }, legacy).adapter.getCapabilities().operations).toEqual([...MVP_OPERATIONS]);
    });
  }
});
