import {
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
  columnVisibilityFeature,
  constructTable,
  createFilteredRowModel,
  createGroupedRowModel,
  createSortedRowModel,
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
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  groupedRowModel: createGroupedRowModel(),
});

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
  } as never) as unknown as TanStackTableLike & { getRowModel(): { rows: Array<{ original: (typeof rows)[number] }> } };

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
});
