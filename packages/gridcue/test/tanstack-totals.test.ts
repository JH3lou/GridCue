// @vitest-environment jsdom

import { useTable } from "@tanstack/react-table";
import {
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
  columnVisibilityFeature,
  constructTable,
  createFilteredRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  rowAggregationFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GridAdapter } from "../src/core/adapter";
import { createGridCue } from "../src/core/controller";
import { isGridCueError } from "../src/core/errors";
import { emptyViewState, type ViewOperation, type ViewState } from "../src/core/protocol";
import { applyView } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { validatePlan } from "../src/core/validate";
import { createMockProvider } from "../src/mock";
import {
  createTanStackAdapter,
  gridcueAggregationFn,
  gridcueAggregationValue,
  gridcueFilterFn,
  type TanStackTableLike,
} from "../src/tanstack";

// Totals on TanStack Table (operation set spec, 5.4; ADR 0030): the adapter holds them, `gridcueAggregationFn` gives
// each group row its total and `gridcueAggregationValue` the footer's, with `applyView`'s arithmetic to the last digit.

type Row = { key: string; advisor: string | null; value: number | null; rate: number | null; name: string };
const ROWS: Row[] = [
  { key: "a", advisor: "Lane", value: 0.1, rate: 0.5, name: "n1" },
  { key: "b", advisor: "Moreno", value: 100, rate: 0.25, name: "n2" },
  { key: "c", advisor: "Lane", value: 0.2, rate: null, name: "n3" },
  { key: "d", advisor: "Ito", value: null, rate: null, name: "n4" },
  { key: "e", advisor: "Moreno", value: 20.05, rate: 0.75, name: "n5" },
  { key: "f", advisor: "Lane", value: 59.7, rate: 0.1, name: "n6" },
];
const COLUMNS = ["key", "advisor", "value", "rate", "name"];
const schema = defineSchema(
  [{ id: "key" }, { id: "advisor" }, { id: "value", kind: "currency" }, { id: "rate", kind: "percent" }, { id: "name" }],
  {},
);

const features = tableFeatures({
  coreReactivityFeature: storeReactivityBindings(),
  columnFilteringFeature,
  rowSortingFeature,
  columnGroupingFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  rowAggregationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  groupedRowModel: createGroupedRowModel(),
});

type GroupRow = { groupingColumnId?: string; leafRows: Array<{ original: Row }>; subRows: GroupRow[]; getValue(id: string): unknown };
type TotalsTable = TanStackTableLike & {
  getRowModel(): { rows: GroupRow[] };
  getColumn(id: string): { getAggregationValue(): unknown } | undefined;
};

const columnsWith = (own: Record<string, object> = {}) => COLUMNS.map((id) => ({ accessorKey: id, header: id, ...(own[id] ?? {}) }));
const makeTable = (
  defaultColumn: object = { filterFn: gridcueFilterFn, aggregationFn: gridcueAggregationFn, getAggregationValue: gridcueAggregationValue },
  columns = columnsWith(),
) => constructTable({ features, data: ROWS, defaultColumn, columns } as never) as unknown as TotalsTable;

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

/** What the table draws for its groups: each group's advisor, its row keys and its total cells, in order. */
const drawnGroups = (table: TotalsTable, totalled: readonly string[]) =>
  table.getRowModel().rows.map((g) => ({
    advisor: g.leafRows[0]?.original.advisor ?? null,
    rows: g.subRows.map((r) => (r as unknown as { original: Row }).original.key),
    totals: Object.fromEntries(totalled.map((id) => [id, g.getValue(id) ?? null])),
  }));
/** What `applyView` gives for the same view. */
const appliedGroups = (state: ViewState, totalled: readonly string[]) =>
  (applyView(ROWS, state, schema).groups ?? []).map((g) => ({
    advisor: g.key.advisor ?? null,
    rows: g.rows.map((r) => r.key),
    totals: Object.fromEntries(totalled.map((id) => [id, g.totals.find((t) => t.columnId === id)?.value ?? null])),
  }));

/** Runs `p` under fake timers past the adapter's 1,000 ms bound on a write, and says how it ended. */
const pastBound = async (p: () => Promise<unknown>) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const running = p().then(
      (v) => ({ resolved: v }),
      (e) => ({ rejected: isGridCueError(e) ? e.code : String(e) }),
    );
    await vi.advanceTimersByTimeAsync(1_100);
    return await running;
  } finally {
    vi.useRealTimers();
  }
};

const configError = (make: () => unknown) => {
  try {
    make();
  } catch (error) {
    return isGridCueError(error) ? { code: error.code, message: error.message } : { code: "other", message: String(error) };
  }
  return undefined;
};

describe("TanStack Table adapter: totals", () => {
  it("throws INPUT_CONFIG when renders names totals and a column it may total can't show GridCue's totals", () => {
    const build = (table: TotalsTable) => () => createTanStackAdapter({ schema, table, renders: ["totals"] });
    // Neither function registered.
    expect(configError(build(makeTable({ filterFn: gridcueFilterFn })))).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("doesn't use gridcueAggregationFn"),
    });
    // Only the group rows' function: a footer would keep the total before GridCue's last change.
    expect(configError(build(makeTable({ filterFn: gridcueFilterFn, aggregationFn: gridcueAggregationFn })))).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("gridcueAggregationValue"),
    });
    // A column of the Host's own aggregation, which GridCue's totals would not reach.
    const own = makeTable(undefined, columnsWith({ value: { aggregationFn: "sum" } }));
    expect(configError(build(own))).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("“value”") });
    // No rowAggregationFeature: no column can show a total.
    const bare = constructTable({
      features: tableFeatures({
        coreReactivityFeature: storeReactivityBindings(),
        columnGroupingFeature,
        groupedRowModel: createGroupedRowModel(),
      } as never),
      data: ROWS,
      columns: columnsWith(),
      defaultColumn: { aggregationFn: gridcueAggregationFn, getAggregationValue: gridcueAggregationValue },
    } as never) as unknown as TotalsTable;
    expect(configError(build(bare))).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("rowAggregationFeature") });
    // A column the schema lets GridCue total that the table lacks: a total on it would be applied and never drawn.
    const wider = defineSchema(
      [
        { id: "key" },
        { id: "advisor" },
        { id: "value", kind: "currency" },
        { id: "rate", kind: "percent" },
        { id: "name" },
        { id: "amount", kind: "currency" },
      ],
      {},
    );
    expect(configError(() => createTanStackAdapter({ schema: wider, table: makeTable(), renders: ["totals"] }))).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("“amount”"),
    });
    // Without "totals" the adapter never reads them, so each builds as before.
    expect(createTanStackAdapter({ schema, table: own }).getCapabilities().operations).not.toContain("aggregation.set");
    expect(createTanStackAdapter({ schema, table: bare }).getCapabilities().operations).not.toContain("aggregation.set");
  });

  it("checks only the columns the schema lets GridCue total", () => {
    // Key, advisor and name are text: a Host's own aggregation there is the Host's.
    const table = makeTable(undefined, columnsWith({ name: { aggregationFn: "count" }, advisor: { aggregationFn: "uniqueCount" } }));
    expect(createTanStackAdapter({ schema, table, renders: ["totals"] }).getCapabilities().operations).toContain("aggregation.set");
    // A Host that takes "aggregate" off a column keeps its own aggregation there.
    const narrowed = defineSchema(
      [{ id: "key" }, { id: "advisor" }, { id: "value", kind: "currency" }, { id: "rate", kind: "percent" }, { id: "name" }],
      { columns: { value: { capabilities: ["filter", "sort", "group", "show", "hide", "reorder"] } } },
    );
    const own = makeTable(undefined, columnsWith({ value: { aggregationFn: "sum" } }));
    expect(createTanStackAdapter({ schema: narrowed, table: own, renders: ["totals"] }).getCapabilities().operations).toContain(
      "aggregation.set",
    );
  });

  it("draws each group's total and the footer's as applyView gives them, to the last digit", async () => {
    const table = makeTable();
    const adapter = createTanStackAdapter({ schema, table, renders: ["totals"] });
    const ops: ViewOperation[] = [
      { type: "group.set", columnIds: ["advisor"] },
      { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
      {
        type: "aggregation.set",
        aggregations: [
          { columnId: "value", function: "sum" },
          { columnId: "rate", function: "avg" },
        ],
      },
    ];
    expect((await adapter.apply(planWith(adapter, ops))).ok).toBe(true);
    const state = adapter.getState().state;
    expect(state.aggregations).toEqual([
      { columnId: "value", function: "sum" },
      { columnId: "rate", function: "avg" },
    ]);
    const drawn = drawnGroups(table, ["value", "rate"]);
    expect(drawn).toEqual(appliedGroups(state, ["value", "rate"]));
    // Lane's 0.1 + 0.2 + 59.7 is 60, not 60.00000000000001; Moreno's 120.05 is below it; Ito has no value, an empty
    // total, which a descending sort puts first.
    expect(drawn.map((g) => [g.advisor, g.totals.value, g.totals.rate])).toEqual([
      ["Ito", null, null],
      ["Moreno", 120.05, 0.5],
      ["Lane", 60, 0.3],
    ]);
    expect(table.getColumn("value")?.getAggregationValue()).toBe(180.05);
    expect(table.getColumn("rate")?.getAggregationValue()).toBe(0.4);
    // A column with no total gives nothing, in a group row and in the footer.
    expect(table.getRowModel().rows[0]?.getValue("name")).toBeUndefined();
    expect(table.getColumn("name")?.getAggregationValue()).toBeUndefined();
  });

  it("recomputes when only the totals change, in the groups, their order and the footer, and undoes", async () => {
    const table = makeTable();
    const adapter = createTanStackAdapter({ schema, table, renders: ["totals"] });
    expect(
      (
        await adapter.apply(
          planWith(adapter, [
            { type: "group.set", columnIds: ["advisor"] },
            { type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] },
            { type: "aggregation.set", aggregations: [{ columnId: "value", function: "sum" }] },
          ]),
        )
      ).ok,
    ).toBe(true);
    const summed = adapter.getState();
    expect(drawnGroups(table, ["value"]).map((g) => [g.advisor, g.totals.value])).toEqual([
      ["Lane", 60],
      ["Moreno", 120.05],
      ["Ito", null],
    ]);
    let calls = 0;
    adapter.subscribe(() => calls++);
    // The average replaces the sum: Lane's 20 is below Moreno's 60.025, and the order follows.
    expect(
      (await adapter.apply(planWith(adapter, [{ type: "aggregation.set", aggregations: [{ columnId: "value", function: "avg" }] }]))).ok,
    ).toBe(true);
    expect(calls).toBe(1);
    expect(adapter.getState().revision).not.toBe(summed.revision);
    expect(drawnGroups(table, ["value"])).toEqual(appliedGroups(adapter.getState().state, ["value"]));
    expect(drawnGroups(table, ["value"]).map((g) => [g.advisor, g.totals.value])).toEqual([
      ["Lane", 20],
      ["Moreno", 60.025],
      ["Ito", null],
    ]);
    // The exact sum, 180.05, over five values, divided once.
    expect(table.getColumn("value")?.getAggregationValue()).toBe(36.01);
    // Undo: the sums again.
    expect((await adapter.restore(summed)).ok).toBe(true);
    expect(adapter.getState().state).toEqual(summed.state);
    expect(drawnGroups(table, ["value"]).map((g) => [g.advisor, g.totals.value])).toEqual([
      ["Lane", 60],
      ["Moreno", 120.05],
      ["Ito", null],
    ]);
    expect(table.getColumn("value")?.getAggregationValue()).toBe(180.05);
    // Removing the totals leaves the groups with none, in the order they first appear.
    expect((await adapter.apply(planWith(adapter, [{ type: "aggregation.set", aggregations: [] }]))).ok).toBe(true);
    expect(drawnGroups(table, ["value"]).map((g) => [g.advisor, g.totals.value])).toEqual([
      ["Lane", null],
      ["Moreno", null],
      ["Ito", null],
    ]);
    expect(table.getColumn("value")?.getAggregationValue()).toBeUndefined();
  });

  it("counts only the rows its filters keep", async () => {
    const table = makeTable();
    const adapter = createTanStackAdapter({ schema, table, renders: ["totals"] });
    const ops: ViewOperation[] = [
      { type: "filter.add", combineWith: "and", predicate: { id: "f1", type: "predicate", columnId: "value", operator: "lt", value: 100 } },
      { type: "aggregation.set", aggregations: [{ columnId: "value", function: "sum" }] },
    ];
    expect((await adapter.apply(planWith(adapter, ops))).ok).toBe(true);
    expect(table.getColumn("value")?.getAggregationValue()).toBe(applyView(ROWS, adapter.getState().state, schema).totals[0]?.value);
    expect(table.getColumn("value")?.getAggregationValue()).toBe(80.05);
  });

  it("holds no totals, and gives nothing, when renders doesn't name totals", async () => {
    const table = makeTable();
    const adapter = createTanStackAdapter({ schema, table, renders: ["density"] });
    expect(() => planWith(adapter, [{ type: "aggregation.set", aggregations: [{ columnId: "value", function: "sum" }] }])).toThrow();
    // A restore that holds totals keeps none on a table that doesn't draw them.
    const restored = await adapter.restore({
      revision: adapter.getState().revision,
      state: { ...emptyViewState(COLUMNS), groupBy: ["advisor"], aggregations: [{ columnId: "value", function: "sum" }] },
    });
    expect(restored.ok).toBe(true);
    expect(adapter.getState().state.aggregations).toEqual([]);
    expect(drawnGroups(table, ["value"]).every((g) => g.totals.value === null)).toBe(true);
  });

  it("totals and groups through the Controller, and undoes", async () => {
    const table = makeTable();
    const adapter = createTanStackAdapter({ schema, table, renders: ["totals"] });
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    await cue.propose("total value by advisor");
    expect(cue.getState().status).toBe("ready");
    expect(await cue.apply()).toBe(true);
    expect(drawnGroups(table, ["value"]).map((g) => [g.advisor, g.totals.value])).toEqual([
      ["Lane", 60],
      ["Moreno", 120.05],
      ["Ito", null],
    ]);
    expect(await cue.undo()).toBe(true);
    expect(adapter.getState().state.aggregations).toEqual([]);
    expect(adapter.getState().state.groupBy).toEqual([]);
  });
});

// A table drawn from React's `useTable` draws again when only the totals change: the adapter writes the grouping
// empty and back, or with no grouping the column order, so the store changes.
describe("TanStack Table adapter: totals on useTable", () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterEach(cleanup);
  const reactFeatures = tableFeatures({
    columnFilteringFeature,
    rowSortingFeature,
    columnGroupingFeature,
    columnVisibilityFeature,
    columnOrderingFeature,
    rowAggregationFeature,
    filteredRowModel: createFilteredRowModel(),
    sortedRowModel: createSortedRowModel(),
    groupedRowModel: createGroupedRowModel(),
  });

  for (const grouped of [true, false]) {
    it(`draws again when only the totals change, ${grouped ? "grouped" : "with no grouping"}`, async () => {
      let renders = 0;
      const hook = renderHook(() => {
        renders++;
        // Registered as a Host writes it, with no cast.
        return useTable({
          features: reactFeatures,
          data: ROWS,
          columns: COLUMNS.map((id) => ({ accessorKey: id as keyof Row, header: id })),
          defaultColumn: { filterFn: gridcueFilterFn, aggregationFn: gridcueAggregationFn, getAggregationValue: gridcueAggregationValue },
        });
      });
      const table = hook.result.current as unknown as TotalsTable;
      const adapter = createTanStackAdapter({ schema, table, renders: ["totals"] });
      const setup: ViewOperation[] = [
        ...(grouped ? [{ type: "group.set", columnIds: ["advisor"] } as ViewOperation] : []),
        { type: "aggregation.set", aggregations: [{ columnId: "value", function: "sum" }] },
      ];
      expect((await adapter.apply(planWith(adapter, setup))).ok).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
      const current = () => hook.result.current as unknown as TotalsTable;
      expect(current().getColumn("value")?.getAggregationValue()).toBe(180.05);
      const before = renders;
      expect(
        (await adapter.apply(planWith(adapter, [{ type: "aggregation.set", aggregations: [{ columnId: "value", function: "avg" }] }]))).ok,
      ).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(renders).toBeGreaterThan(before);
      expect(current().getColumn("value")?.getAggregationValue()).toBe(36.01);
      if (grouped) {
        expect(
          current()
            .getRowModel()
            .rows.map((g) => g.getValue("value") ?? null),
        ).toEqual([20, 60.025, null]);
      }
    });
  }

  // A Host that passes TanStack the grouping and column order it had while their items are the same, as one that keeps
  // them through a shallow-equal memo when it draws, and keeps its columns from one render to the next. Writing the
  // same grouping again then gives TanStack the same array, so it doesn't group again, and each group keeps the total
  // it had. With no grouping the footer is read again on every render, so it shows the new total.
  const stableColumns = COLUMNS.map((id) => ({ accessorKey: id as keyof Row, header: id }));
  const stableDefaultColumn = {
    filterFn: gridcueFilterFn,
    aggregationFn: gridcueAggregationFn,
    getAggregationValue: gridcueAggregationValue,
  };
  const keptHost = (grouping: string[]) => {
    const kept: { grouping?: string[]; columnOrder?: string[] } = {};
    const keep = (key: keyof typeof kept, next: string[]) => {
      const old = kept[key];
      if (!old || old.length !== next.length || old.some((id, i) => id !== next[i])) kept[key] = next;
      return kept[key] as string[];
    };
    const view = { drawn: [] as unknown[] };
    const hook = renderHook(() => {
      const [groupingHeld, setGrouping] = useState<string[]>(grouping);
      const [columnOrderHeld, setColumnOrder] = useState<string[]>([...COLUMNS]);
      const table = useTable({
        features: reactFeatures,
        data: ROWS,
        columns: stableColumns,
        defaultColumn: stableDefaultColumn,
        state: { grouping: keep("grouping", groupingHeld), columnOrder: keep("columnOrder", columnOrderHeld) },
        onGroupingChange: setGrouping,
        onColumnOrderChange: setColumnOrder,
      });
      // What the Host's markup shows: each group row's total, or with no grouping the footer's.
      view.drawn = grouping.length
        ? (table as unknown as TotalsTable).getRowModel().rows.map((g) => g.getValue("value") ?? null)
        : [table.getColumn("value")?.getAggregationValue() ?? null];
      return table;
    });
    return { table: hook.result.current as unknown as TotalsTable, view };
  };

  it("fails a totals change on a grouped view the table doesn't group again for, and changes nothing", async () => {
    const { table, view } = keptHost(["advisor"]);
    const adapter = createTanStackAdapter({ schema, table, renders: ["totals"] });
    const before = adapter.getState().state;
    expect(view.drawn).toEqual([null, null, null]);
    // The table never draws the sums, so the write fails past its bound rather than report them (ADR 0031)…
    const result = await pastBound(() =>
      adapter.apply(planWith(adapter, [{ type: "aggregation.set", aggregations: [{ columnId: "value", function: "sum" }] }])),
    );
    expect(result).toEqual({ rejected: "ADAPTER_FAILED" });
    await new Promise((r) => setTimeout(r, 0));
    // …and the View State is the one the table still draws.
    expect(view.drawn).toEqual([null, null, null]);
    expect(adapter.getState().state).toEqual(before);
    // Through the Controller: no "View updated.", and nothing changed.
    const cue = createGridCue({ schema, adapter, provider: createMockProvider() });
    await cue.propose("total value");
    expect(cue.getState().status).toBe("ready");
    expect(await pastBound(() => cue.apply())).toEqual({ resolved: false });
    expect(cue.getState().message).toBe("The grid couldn't apply that change. Nothing was changed.");
    expect(adapter.getState().state.aggregations).toEqual([]);
    expect(view.drawn).toEqual([null, null, null]);
  });

  it("applies and draws a footer total under the same Host with no grouping", async () => {
    const { table, view } = keptHost([]);
    const adapter = createTanStackAdapter({ schema, table, renders: ["totals"] });
    const result = await adapter.apply(
      planWith(adapter, [{ type: "aggregation.set", aggregations: [{ columnId: "value", function: "sum" }] }]),
    );
    expect(result.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(adapter.getState().state.aggregations).toEqual([{ columnId: "value", function: "sum" }]);
    expect(view.drawn).toEqual([180.05]);
  });
});
