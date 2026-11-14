// @vitest-environment jsdom

import { useTable } from "@tanstack/react-table";
import { getCoreRowModel, getFilteredRowModel, getSortedRowModel, useLegacyTable } from "@tanstack/react-table/legacy";
import {
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
  columnVisibilityFeature,
  constructTable,
  createFilteredRowModel,
  createGroupedRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  functionalUpdate,
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
import { createGridCue } from "../src/core/controller";
import { validatePlan } from "../src/core/validate";
import { createMockProvider } from "../src/mock";
import { createTanStackAdapter, gridcueFilterFn, schemaFromTanStack, type TanStackTableLike, withGridCueFilter } from "../src/tanstack";
import { runAdapterContract } from "./adapter-contract";

const rows = [
  { value: 5, team: "b", name: "x" },
  { value: 20, team: "a", name: "y" },
  { value: 12, team: "b", name: "z" },
];

const features = tableFeatures({
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
});

type TestTable = TanStackTableLike & {
  getRowModel(): { rows: Array<{ original: (typeof rows)[number] }> };
  setPageIndex(index: number): void;
  setRowSelection(selection: Record<string, boolean>): void;
};

const makeTable = () =>
  constructTable({
    features,
    data: rows,
    defaultColumn: { filterFn: gridcueFilterFn },
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

runAdapterContract("TanStack Table adapter", () => {
  const table = makeTable();
  const adapter = createTanStackAdapter({ schema: schemaFromTanStack(table), table });
  return { adapter, manualChange: () => table.setSorting([{ id: "team", desc: false }]), numericColumn: "value", otherColumn: "name" };
});

// The same suite through React's `useTable` and `useLegacyTable`, where the Host may control a slice of the
// table's state. A controlled table updates on its next render, so an apply is done only when the table holds
// it (spec 4.2). The first harness owns its state, as every table above does.
beforeAll(() => {
  // Updates outside `act` render on their own, as in an app. `act` below flushes only the User's own changes.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(cleanup);

const reactFeatures = tableFeatures({
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
});
const reactColumns = [
  { accessorKey: "value", header: "Value" },
  { accessorKey: "team", header: "Team" },
  { accessorKey: "name", header: "Name" },
];

type Sorting = Array<{ id: string; desc: boolean }>;
type Filters = Array<{ id: string; value: unknown }>;
/** Which slices of the table's state the Host controls, and whether it gives a change handler. */
type Control = { sorting?: "handler" | "none"; filters?: "handler" };

/** The Host's own state and handlers for the slices it controls: the options both hooks share. */
const useHostOptions = (control: Control) => {
  const [sorting, setSorting] = useState<Sorting>([]);
  const [columnFilters, setColumnFilters] = useState<Filters>([]);
  return {
    columns: reactColumns,
    data: rows,
    defaultColumn: { filterFn: gridcueFilterFn },
    state: {
      ...(control.sorting ? { sorting } : {}),
      ...(control.filters ? { columnFilters } : {}),
    },
    ...(control.sorting === "handler" ? { onSortingChange: setSorting } : {}),
    ...(control.filters === "handler" ? { onColumnFiltersChange: setColumnFilters } : {}),
  };
};

const useHostTable = (control: Control) => useTable({ ...useHostOptions(control), features: reactFeatures } as never);

const useHostLegacyTable = (control: Control) =>
  useLegacyTable({
    ...useHostOptions(control),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  } as never);

const makeHostTable = (control: Control, legacy: boolean) => {
  const hook = legacy ? renderHook(() => useHostLegacyTable(control)) : renderHook(() => useHostTable(control));
  // Created once, as the Vite example does: useTable returns a new object whenever table state changes.
  const table = hook.result.current as unknown as TestTable;
  const schema = schemaFromTanStack(table);
  const adapter = createTanStackAdapter({ schema, table });
  // The User's own change goes through React, as a header click does.
  const manualChange = () => act(() => table.setSorting([{ id: "team", desc: false }]));
  return { table, schema, adapter, manualChange };
};

const harnessOf = (control: Control, legacy: boolean) => () => {
  const { adapter, manualChange } = makeHostTable(control, legacy);
  return { adapter, manualChange, numericColumn: "value", otherColumn: "name" };
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
