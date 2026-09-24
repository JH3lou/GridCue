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
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { describe, expect, it } from "vitest";
import { createGridCue } from "../src/core/controller";
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

runAdapterContract("TanStack Table adapter", () => {
  const table = makeTable();
  const adapter = createTanStackAdapter({ schema: schemaFromTanStack(table), table });
  return { adapter, manualChange: () => table.setSorting([{ id: "team", desc: false }]), numericColumn: "value", otherColumn: "name" };
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
