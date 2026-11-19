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
  filterFn_includesString,
  globalFilteringFeature,
  rowAggregationFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GridAdapter } from "../src/core/adapter";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { createGridCue, type GridCueController } from "../src/core/controller";
import { isGridCueError } from "../src/core/errors";
import { emptyViewState, type ViewOperation, type ViewState } from "../src/core/protocol";
import { applyView, createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createMockProvider } from "../src/mock";
import {
  createTanStackAdapter,
  gridcueAggregationFn,
  gridcueAggregationValue,
  gridcueCountFeature,
  gridcueCountRowModel,
  gridcueFilterFn,
  rowsBeforeCount,
} from "../src/tanstack";
import { compareDrawn, DRAWN, drawTanStack, type Rendered, type Row, renderWithRows, tanStackTableOver } from "./rendered-rows";

// Counts on TanStack Table (operation set spec, 5.5; ADR 0027): GridCue's count piece, what the adapter refuses, and a
// count through the Controller, where every follow-up of spec 5.1 must give what it gives on the Rows Adapter.

beforeAll(() => {
  // Updates outside `act` render on their own, as in an app.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(cleanup);

// --- The accounts: spec 5.1's schema, on 30 synthetic rows ----------------------------------------------------------

const columns = [
  { id: "name", label: "Account name" },
  { id: "advisor", label: "Advisor" },
  { id: "custodian", label: "Custodian" },
  { id: "value", label: "Market value", kind: "currency" as const },
  { id: "gain", label: "Unrealized gain", kind: "currency" as const },
  { id: "type", label: "Registration" },
];
const schema = defineSchema(columns, {
  rowNoun: "account",
  defaultMeasure: "value",
  columns: {
    value: { aliases: ["value"] },
    gain: { aliases: ["gain"] },
    type: {
      enumValues: [
        { id: "taxable", label: "Taxable" },
        { id: "trust", label: "Trust" },
      ],
    },
  },
});
const ids = columns.map((c) => c.id);
const ADVISORS = ["Avery Lane", "Blake Moreno", "Casey Ito"];
const accounts: Row[] = Array.from({ length: 30 }, (_, i) => ({
  key: `a${String(i).padStart(2, "0")}`,
  name: `Account ${String.fromCharCode(65 + (i % 26))}${i}`,
  advisor: ADVISORS[(i * 7) % 3] as string,
  custodian: i % 2 ? "northgate" : "summit",
  // Some above $1m, two with no value, and two ties.
  value: i % 11 === 4 ? null : i === 9 || i === 21 ? 750_000 : ((i * 7919) % 31) * 100_000,
  gain: i % 7 === 3 ? null : ((i * 37) % 23) * 1_000 - 9_000,
  type: i % 3 === 0 ? "trust" : "taxable",
}));
const mock = createMockProvider({ defaultColumnForKind: { currency: "value" } });

const view = (over: Partial<ViewState> = {}): ViewState => ({ ...emptyViewState(ids), ...over });
const byValue = [{ columnId: "value", direction: "desc" as const }];
const keysOf = (rows: readonly unknown[]) => (rows as Row[]).map((r) => r.key);

const configError = (make: () => unknown) => {
  try {
    make();
  } catch (error) {
    return isGridCueError(error) ? { code: error.code, message: error.message } : { code: "other", message: String(error) };
  }
  return undefined;
};

// --- What the Host registers --------------------------------------------------------------------------------------

const stock = {
  columnFilteringFeature,
  rowSortingFeature,
  columnGroupingFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  columnPinningFeature,
  rowAggregationFeature,
  rowPaginationFeature,
  globalFilteringFeature,
  sortedRowModel: createSortedRowModel(),
  groupedRowModel: createGroupedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
};
/** As `gridcueCountFeature`'s doc shows it: spread in, beside the wrapped filtered row model. No cast. */
const counting = tableFeatures({
  ...stock,
  ...{ gridcueCountFeature },
  filteredRowModel: gridcueCountRowModel(createFilteredRowModel()),
});
const plain = tableFeatures({ ...stock, filteredRowModel: createFilteredRowModel() });
const GRIDCUE_COLUMN = { filterFn: gridcueFilterFn, aggregationFn: gridcueAggregationFn, getAggregationValue: gridcueAggregationValue };
const tableColumns = columns.map((c) => ({ accessorKey: c.id, header: c.label }));

type Shown = {
  getRowModel(): { rows: Array<{ original: Row }> };
  getFilteredRowModel(): { rows: unknown[] };
  getPageCount(): number;
  setPageIndex(index: number): void;
  setSorting(sorting: Array<{ id: string; desc: boolean }>): void;
  setGlobalFilter(value: unknown): void;
  setOptions(updater: (old: Record<string, unknown>) => Record<string, unknown>): void;
  store: { state: Record<string, unknown> };
};
const construct = (features: unknown, more: Record<string, unknown> = {}) =>
  constructTable({
    features: tableFeatures({ coreReactivityFeature: storeReactivityBindings(), ...(features as object) } as never),
    data: accounts,
    columns: tableColumns,
    defaultColumn: GRIDCUE_COLUMN,
    initialState: { pagination: { pageIndex: 0, pageSize: 1000 } },
    ...more,
  } as never) as unknown as Shown & Parameters<typeof createTanStackAdapter>[0]["table"];
const shownKeys = (table: Shown) => table.getRowModel().rows.map((r) => r.original.key);
const expectedKeys = (state: ViewState) => keysOf(applyView(accounts, state, schema).rows);
const write = async (adapter: GridAdapter, state: ViewState) => {
  const result = await adapter.restore({ revision: adapter.getState().revision, state });
  if (!result.ok) throw new Error(result.code);
  return result;
};

// --- Refusals -----------------------------------------------------------------------------------------------------

describe("renders: [“count”] on a table that can't keep a count throws INPUT_CONFIG naming why", () => {
  for (const setting of ["manualPagination", "manualSorting", "manualFiltering", "manualGrouping"]) {
    it(`${setting}: the table holds one page of its rows`, () => {
      const table = construct(counting, { [setting]: true });
      expect(configError(() => createTanStackAdapter({ schema, table, renders: ["count"] }))).toEqual({
        code: "INPUT_CONFIG",
        message: `renders names “count”, but the table sets ${setting}, so it holds one page of its rows, and the first rows of a page are not the first rows of the view.`,
      });
      // The same table without "count" builds as before, with no limit.set.
      expect(createTanStackAdapter({ schema, table }).getCapabilities().operations).toEqual([...MVP_OPERATIONS]);
    });
  }

  it("manualPagination on a table from useTable, read from the object useTable returns", () => {
    const hook = renderHook(() => useTable({ features: counting, columns: tableColumns, data: accounts, manualPagination: true }));
    expect(() => createTanStackAdapter({ schema, table: hook.result.current, renders: ["count"] })).toThrow(/manualPagination/);
  });

  it("no count row model: the table's filteredRowModel is TanStack's own", () => {
    const table = construct({ ...plain, ...{ gridcueCountFeature } });
    expect(configError(() => createTanStackAdapter({ schema, table, renders: ["count"] }))).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("filteredRowModel is not gridcueCountRowModel(createFilteredRowModel())"),
    });
  });

  it("no gridcueCountFeature: the row model is wrapped, but the table has no count slice", () => {
    const table = construct({ ...stock, filteredRowModel: gridcueCountRowModel(createFilteredRowModel()) });
    expect(configError(() => createTanStackAdapter({ schema, table, renders: ["count"] }))).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("no gridcueCountFeature"),
    });
  });

  it("useLegacyTable: it builds its own filtered row model, so it can't take the piece", () => {
    const hook = renderHook(() =>
      useLegacyTable({
        columns: tableColumns,
        data: accounts,
        defaultColumn: { filterFn: gridcueFilterFn },
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
      } as never),
    );
    expect(() => createTanStackAdapter({ schema, table: hook.result.current as never, renders: ["count"] })).toThrow(
      /gridcueCountRowModel/,
    );
  });

  it("a table the adapter can't see the options of", () => {
    const table = construct(counting);
    const hidden = new Proxy(table, { get: (t, key) => (key === "options" ? undefined : Reflect.get(t, key)) });
    expect(() => createTanStackAdapter({ schema, table: hidden, renders: ["count"] })).toThrow(/gridcueCountRowModel/);
  });

  it("getSubRows: a row can hold sub-rows, which a count would bring in with it, unsorted and uncounted", () => {
    const table = construct(counting, { getSubRows: (row: { children?: unknown[] }) => row.children });
    expect(configError(() => createTanStackAdapter({ schema, table, renders: ["count"] }))).toEqual({
      code: "INPUT_CONFIG",
      message:
        "renders names “count”, but the table sets getSubRows, so a row can hold sub-rows, and a count would keep each of the first rows with every one of its sub-rows.",
    });
    expect(createTanStackAdapter({ schema, table }).getCapabilities().operations).toEqual([...MVP_OPERATIONS]);
  });

  it("a tree table without “count”: “top 2 accounts by market value” sorts and carries today's note (ADR 0018)", async () => {
    const tree: Row[] = [
      { ...(accounts[0] as Row), key: "p1", value: 50, children: [{ ...(accounts[1] as Row), key: "c1", value: 99 }] },
      { ...(accounts[2] as Row), key: "p2", value: 40 },
      { ...(accounts[3] as Row), key: "p3", value: 30 },
    ];
    const table = construct(counting, { data: tree, getSubRows: (row: { children?: unknown[] }) => row.children });
    const cue = createGridCue({ schema, adapter: createTanStackAdapter({ schema, table }), provider: mock });
    const plan = await cue.propose("top 2 accounts by market value");
    expect(plan?.operations).toEqual([{ type: "sort.set", sorts: byValue }]);
    expect(cue.getState().preview?.notes).toEqual(["Count not applied: this grid can't show only the first 2"]);
  });
});

// --- A setting the Host turns on after the adapter is made ----------------------------------------------------------
// The adapter reads the table's options when it reads the View State. With a manual setting or getSubRows on, the table
// can't keep a count: the piece stops cutting, the View State has no count and limit.set is not listed, so the View
// State still says what the table shows, and "top 10" reads as on a table that draws no count.

describe("a manual setting or getSubRows the Host turns on while the table holds a count", () => {
  const LATER = {
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    manualGrouping: true,
    getSubRows: (row: { children?: unknown[] }) => row.children,
  } as const;
  const page = accounts.slice(10, 20);

  for (const [setting, value] of Object.entries(LATER)) {
    it(`${setting}: the count stops cutting, the View State drops it, and “top 10” reads as on a table without it`, async () => {
      const table = construct(counting);
      const adapter = createTanStackAdapter({ schema, table, renders: ["count"] });
      await write(adapter, view({ sorts: byValue, limit: 5 }));
      expect(shownKeys(table)).toEqual(expectedKeys(view({ sorts: byValue, limit: 5 })));
      const heard: ViewState[] = [];
      adapter.subscribe((s) => heard.push(s.state));
      const before = adapter.getState().revision;

      // The Host moves to server paging: one page of rows, and the setting on.
      table.setOptions((old) => ({ ...old, [setting]: value, data: page }));
      // Every row of the page shows: no count cuts them.
      expect([...shownKeys(table)].sort()).toEqual(keysOf(page).sort());
      // The View State says so, as a change the adapter reports (ADR 0009), and limit.set is gone.
      const now = adapter.getState();
      expect(now.state).toMatchObject({ sorts: byValue });
      expect(now.state.limit).toBeUndefined();
      expect(now.revision).not.toBe(before);
      expect(heard).toHaveLength(1);
      expect(heard.at(-1)?.limit).toBeUndefined();
      expect(adapter.getCapabilities().operations).toEqual([...MVP_OPERATIONS]);

      // A count is refused, and nothing changes.
      const refused = await adapter.restore({ revision: now.revision, state: view({ sorts: byValue, limit: 10 }) });
      expect(refused).toMatchObject({ ok: false, code: "ADAPTER_UNSUPPORTED_COUNT" });
      expect(refused.ok ? "" : refused.message).toContain(setting);
      expect(adapter.getState()).toEqual(now);

      // "top 10" reads as on a grid that draws no count: it sorts and carries today's note.
      const cue = createGridCue({ schema, adapter, provider: mock });
      const plan = await cue.propose("top 10 accounts by market value");
      expect(cue.getState().status).toBe("ready");
      expect(plan?.operations).toEqual([{ type: "sort.set", sorts: byValue }]);
      expect(cue.getState().preview?.notes).toEqual(["Count not applied: this grid can't show only the first 10"]);
      // A write with no count still goes through.
      expect((await adapter.restore({ revision: now.revision, state: view({ sorts: byValue }) })).ok).toBe(true);
    });
  }

  it("a Preview made before the setting goes on is refused at apply, as after any change", async () => {
    const table = construct(counting);
    const adapter = createTanStackAdapter({ schema, table, renders: ["count"] });
    await write(adapter, view({ sorts: byValue, limit: 5 }));
    const cue = createGridCue({ schema, adapter, provider: mock });
    await cue.propose("hide custodian");
    expect(cue.getState().status).toBe("ready");
    table.setOptions((old) => ({ ...old, manualPagination: true }));
    expect(await cue.apply()).toBe(false);
    expect(cue.getState().message).toBe("The view changed since this preview. Preview the request again.");
    expect(adapter.getState().state.visibleColumnIds).toContain("custodian");
  });

  it("in React: a Host that turns manualPagination on in a later render", async () => {
    const hook = renderHook(
      ({ manual }: { manual: boolean }) =>
        useTable({
          features: counting,
          columns: tableColumns,
          data: manual ? page : accounts,
          defaultColumn: GRIDCUE_COLUMN,
          manualPagination: manual,
          initialState: { pagination: { pageIndex: 0, pageSize: 1000 } },
        } as never),
      { initialProps: { manual: false } },
    );
    const adapter = createTanStackAdapter({ schema, table: hook.result.current as never, renders: ["count"] });
    const latest = () => hook.result.current as unknown as Shown;
    await write(adapter, view({ sorts: byValue, limit: 5 }));
    await waitFor(() => expect(shownKeys(latest())).toEqual(expectedKeys(view({ sorts: byValue, limit: 5 }))));
    hook.rerender({ manual: true });
    await waitFor(() => expect([...shownKeys(latest())].sort()).toEqual(keysOf(page).sort()));
    expect(adapter.getState().state.limit).toBeUndefined();
    expect(adapter.getCapabilities().operations).not.toContain("limit.set");
  });

  it("in React: a setting turned on in a later render, before anything reads the rows, refuses a count", async () => {
    const hook = renderHook(
      ({ manual }: { manual: boolean }) =>
        useTable({
          features: counting,
          columns: tableColumns,
          data: accounts,
          defaultColumn: GRIDCUE_COLUMN,
          manualPagination: manual,
          initialState: { pagination: { pageIndex: 0, pageSize: 1000 } },
        } as never),
      { initialProps: { manual: false } },
    );
    // Made from the first render's object, whose options stay a render behind, before any row model is built.
    const adapter = createTanStackAdapter({ schema, table: hook.result.current as never, renders: ["count"] });
    hook.rerender({ manual: true });
    expect(adapter.getCapabilities().operations).not.toContain("limit.set");
    const refused = await adapter.restore({ revision: adapter.getState().revision, state: view({ sorts: byValue, limit: 3 }) });
    expect(refused).toMatchObject({ ok: false, code: "ADAPTER_UNSUPPORTED_COUNT" });
    const latest = () => hook.result.current as unknown as Shown;
    await waitFor(() => expect(shownKeys(latest())).toHaveLength(accounts.length));
    expect(adapter.getState().state.limit).toBeUndefined();
  });

  it("the setting off again: the count the table still holds cuts again, and the View State has it", async () => {
    const table = construct(counting);
    const adapter = createTanStackAdapter({ schema, table, renders: ["count"] });
    await write(adapter, view({ sorts: byValue, limit: 5 }));
    table.setOptions((old) => ({ ...old, manualPagination: true }));
    expect(adapter.getState().state.limit).toBeUndefined();
    table.setOptions((old) => ({ ...old, manualPagination: false }));
    expect(adapter.getState().state.limit).toBe(5);
    expect(adapter.getCapabilities().operations).toContain("limit.set");
    expect(shownKeys(table)).toEqual(expectedKeys(view({ sorts: byValue, limit: 5 })));
  });
});

describe("without renders: [“count”], nothing changes", () => {
  for (const [name, features] of [
    ["a plain table", plain],
    ["a table that registers the piece", counting],
  ] as const) {
    it(`${name}: no limit.set, no count read, every row shown`, async () => {
      const table = construct(features);
      const adapter = createTanStackAdapter({ schema, table });
      expect(adapter.getCapabilities().operations).toEqual([...MVP_OPERATIONS]);
      await write(adapter, view({ sorts: byValue, limit: 10 }));
      expect(adapter.getState().state.limit).toBeUndefined();
      expect(shownKeys(table)).toHaveLength(accounts.length);
    });
  }

  it("“top 10 accounts by market value” sorts and carries today's note (ADR 0018)", async () => {
    const table = construct(counting);
    const cue = createGridCue({ schema, adapter: createTanStackAdapter({ schema, table }), provider: mock });
    const plan = await cue.propose("top 10 accounts by market value");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([{ type: "sort.set", sorts: byValue }]);
    expect(cue.getState().preview?.notes).toEqual(["Count not applied: this grid can't show only the first 10"]);
    expect(await cue.apply()).toBe(true);
    expect(shownKeys(table)).toHaveLength(accounts.length);
  });
});

// --- The piece on a table -------------------------------------------------------------------------------------------

describe("the count piece keeps applyView's rows", () => {
  it("lists limit.set only with renders: [“count”]", () => {
    const table = construct(counting);
    expect(createTanStackAdapter({ schema, table, renders: ["count"] }).getCapabilities().operations).toEqual([
      ...MVP_OPERATIONS,
      "limit.set",
    ]);
  });

  it("shows the first rows of the view, grouped and not, and every row again when the count goes", async () => {
    const table = construct(counting);
    const adapter = createTanStackAdapter({ schema, table, renders: ["count"] });
    for (const state of [
      view({ sorts: byValue, limit: 10 }),
      view({ sorts: byValue, limit: 3 }),
      view({ sorts: [{ columnId: "advisor", direction: "asc" }, ...byValue], limit: 7 }),
      view({ sorts: byValue, limit: 10, groupBy: ["advisor"] }),
      view({ sorts: byValue }),
    ]) {
      await write(adapter, state);
      expect(adapter.getState().state.limit).toBe(state.limit);
      const rows = table.getRowModel().rows as unknown as Array<{ original: Row; subRows: Array<{ original: Row }> }>;
      const shown = state.groupBy.length ? rows.flatMap((g) => g.subRows.map((r) => r.original.key)) : shownKeys(table);
      const expected = applyView(accounts, state, schema);
      const flat = expected.groups ? expected.groups.flatMap((g) => keysOf(g.rows)) : keysOf(expected.rows);
      // The rows with a value sit as applyView puts them; where the rows with none sit is out of scope (spec section 3).
      const valued = (keys: string[]) => keys.filter((k) => accounts.find((a) => a.key === k)?.value !== null);
      expect([...shown].sort()).toEqual([...flat].sort());
      expect(valued(shown)).toEqual(valued(flat));
    }
  });

  it("keeps the rows before the count for a caption: “First 10 of 30 rows”", async () => {
    const table = construct(counting);
    const adapter = createTanStackAdapter({ schema, table, renders: ["count"] });
    expect(rowsBeforeCount(table)).toBeUndefined();
    await write(adapter, view({ sorts: byValue, limit: 10 }));
    expect(table.getFilteredRowModel().rows).toHaveLength(10);
    expect(rowsBeforeCount(table)?.rows).toHaveLength(30);
  });

  it("cuts first, then pages; a change of the count goes back to the first page", async () => {
    const table = construct(counting, { initialState: { pagination: { pageIndex: 0, pageSize: 4 } } });
    const adapter = createTanStackAdapter({ schema, table, renders: ["count"] });
    await write(adapter, view({ sorts: byValue, limit: 10 }));
    expect(table.getPageCount()).toBe(3);
    table.setPageIndex(2);
    expect(shownKeys(table)).toEqual(expectedKeys(view({ sorts: byValue, limit: 10 })).slice(8));
    await write(adapter, view({ sorts: byValue, limit: 6 }));
    expect(table.getPageCount()).toBe(2);
    await waitFor(() => expect((table.store.state.pagination as { pageIndex: number }).pageIndex).toBe(0));
    expect(shownKeys(table)).toEqual(expectedKeys(view({ sorts: byValue, limit: 6 })).slice(0, 4));
  });

  it("keeps the first rows of what a Host's own global filter leaves, which applyView can't see", async () => {
    const table = construct(counting, { globalFilterFn: filterFn_includesString });
    const adapter = createTanStackAdapter({ schema, table, renders: ["count"] });
    await write(adapter, view({ sorts: byValue, limit: 3 }));
    table.setGlobalFilter("Avery");
    const left = accounts.filter((a) => a.advisor === "Avery Lane");
    expect(shownKeys(table)).toEqual(keysOf(applyView(left, view({ sorts: byValue, limit: 3 }), schema).rows));
  });

  it("reports the User's own header sort, keeps the count, and shows the first rows of the new order (ADR 0009)", async () => {
    const table = construct(counting);
    const adapter = createTanStackAdapter({ schema, table, renders: ["count"] });
    await write(adapter, view({ sorts: byValue, limit: 10 }));
    const heard: ViewState[] = [];
    adapter.subscribe((s) => heard.push(s.state));
    table.setSorting([{ id: "gain", desc: false }]);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ sorts: [{ columnId: "gain", direction: "asc" }], limit: 10 });
    const now = adapter.getState().state;
    expect([...shownKeys(table)].sort()).toEqual([...expectedKeys(now)].sort());
    // The User clears the sort: the count keeps the first rows in the Host's order, as applyView does.
    table.setSorting([]);
    expect(adapter.getState().state).toMatchObject({ sorts: [], limit: 10 });
    expect(shownKeys(table)).toEqual(expectedKeys(adapter.getState().state));
    expect(shownKeys(table)).toEqual(keysOf(accounts.slice(0, 10)));
  });

  it("undo and restoring a snapshot keep the count, and each write notifies once", async () => {
    const table = construct(counting);
    const adapter = createTanStackAdapter({ schema, table, renders: ["count"] });
    let calls = 0;
    adapter.subscribe(() => calls++);
    await write(adapter, view({ sorts: byValue, limit: 10 }));
    const snapshot = adapter.getState();
    await write(adapter, view({ sorts: byValue, limit: 4 }));
    await write(adapter, view({ sorts: byValue }));
    expect(shownKeys(table)).toHaveLength(30);
    expect(calls).toBe(3);
    expect((await adapter.restore(snapshot)).ok).toBe(true);
    expect(calls).toBe(4);
    expect(adapter.getState().state).toEqual(snapshot.state);
    expect(shownKeys(table)).toEqual(expectedKeys(snapshot.state));
  });
});

describe("the count piece in React", () => {
  const useHost = (control: { count?: boolean }) => {
    const [gridcueCount, setGridcueCount] = useState<unknown>(null);
    return useTable({
      features: counting,
      columns: tableColumns,
      data: accounts,
      defaultColumn: GRIDCUE_COLUMN,
      initialState: { pagination: { pageIndex: 0, pageSize: 1000 } },
      ...(control.count ? { state: { gridcueCount }, onGridcueCountChange: setGridcueCount } : {}),
    } as never);
  };

  for (const control of [{}, { count: true }]) {
    it(`draws again when only the count changes${control.count ? ", the Host controlling the count" : ""}`, async () => {
      let renders = 0;
      const hook = renderHook(() => {
        renders++;
        return useHost(control);
      });
      const adapter = createTanStackAdapter({ schema, table: hook.result.current as never, renders: ["count"] });
      const latest = () => hook.result.current as unknown as Shown;
      await write(adapter, view({ sorts: byValue }));
      await waitFor(() => expect(shownKeys(latest())).toHaveLength(30));
      for (const limit of [10, 3, undefined, 25]) {
        const before = renders;
        const state = view({ sorts: byValue, limit });
        await write(adapter, state);
        await waitFor(() => expect(renders).toBeGreaterThan(before));
        expect([...shownKeys(latest())].sort()).toEqual([...expectedKeys(state)].sort());
        expect(adapter.getState().state.limit).toBe(limit);
      }
    });
  }

  it("a Host that controls the count with no change handler: the write never holds, and fails as any such write does", async () => {
    const hook = renderHook(() =>
      useTable({
        features: counting,
        columns: tableColumns,
        data: accounts,
        defaultColumn: GRIDCUE_COLUMN,
        state: { gridcueCount: null },
      } as never),
    );
    const adapter = createTanStackAdapter({ schema, table: hook.result.current as never, renders: ["count"] });
    await expect(write(adapter, view({ sorts: byValue, limit: 10 }))).rejects.toThrow(/didn't hold the change/);
  });
});

// --- Spec 5.1's follow-ups, on both adapters ----------------------------------------------------------------------

/** One grid: its adapter, its Controller, what a Host draws from it, and the User clearing the sort with a header. */
type Grid = { name: string; adapter: GridAdapter; cue: GridCueController; drawn(): Promise<Rendered>; headerSortCleared(): void };

const rowsGrid = (): Grid => {
  const adapter = createRowsAdapter({ schema });
  return {
    name: "Rows Adapter",
    adapter,
    cue: createGridCue({ adapter, provider: mock }),
    drawn: () => renderWithRows({ name: "", schema, rows: accounts, state: adapter.getState().state }),
    headerSortCleared: () => adapter.setState((s) => ({ ...s, sorts: [] })),
  };
};
const tanstackGrid = (): Grid => {
  const table = tanStackTableOver(accounts, schema);
  const adapter = createTanStackAdapter({ schema, table, renders: DRAWN });
  return {
    name: "TanStack Table adapter",
    adapter,
    cue: createGridCue({ adapter, provider: mock }),
    drawn: async () => drawTanStack(table, adapter.getState().state, adapter.getState().state.density),
    headerSortCleared: () => table.setSorting([]),
  };
};

const taxable: ViewOperation = {
  type: "filter.add",
  combineWith: "and",
  predicate: { id: "t1", type: "predicate", columnId: "type", operator: "eq", value: "taxable" },
};

const KEEP_OR_ALL = "Keep only the first 10 rows of the new view, or show every row?";

/** What a request gives: its status, its question and choices, its Preview, and the plan without filter ids. */
const outcome = (cue: GridCueController) => {
  const s = cue.getState();
  return {
    status: s.status,
    message: s.message,
    clarifications: s.plan?.clarifications.map((c) => ({ prompt: c.prompt, options: c.options })),
    lines: s.preview?.lines,
    notes: s.preview?.notes,
    operations: JSON.parse(JSON.stringify(s.plan?.operations ?? []).replace(/"id":"[^"]*",/g, "")),
  };
};

/** Starts a grid at "top 10 accounts by market value", applied through its Controller, then `setup`. */
const startAt = async (grid: Grid, setup: "top 10" | "top 10, taxable" | "top 10, header sort cleared") => {
  await grid.cue.propose("top 10 accounts by market value");
  expect(grid.cue.getState().preview?.lines, grid.name).toEqual(["Sort by Market value, descending", "Show only the first 10 rows"]);
  expect(await grid.cue.apply()).toBe(true);
  if (setup === "top 10, taxable") {
    const state = { ...grid.adapter.getState().state };
    await write(grid.adapter, { ...state, filters: { id: "root", type: "group", combinator: "and", children: [taxable.predicate] } });
  }
  if (setup === "top 10, header sort cleared") grid.headerSortCleared();
};

/** Both grids draw the same view: the same rows kept, and the same rows, groups and totals apart from where empty rows sit. */
const sameDrawing = async (rows: Grid, table: Grid, why: string) => {
  const state = rows.adapter.getState().state;
  const [a, b] = [await rows.drawn(), await table.drawn()];
  expect(keysOf(b.rows).sort(), `${why}: rows kept`).toEqual(keysOf(a.rows).sort());
  expect(["same", "emptyPlaces"], `${why}: ${compareDrawn(a, b, state).why}`).toContain(compareDrawn(a, b, state).verdict);
};

describe("spec 5.1's follow-ups after “top 10 accounts by market value”: TanStack gives what the Rows Adapter gives", () => {
  it("the count applies on TanStack: ten rows, the ones applyView keeps", async () => {
    const grid = tanstackGrid();
    await startAt(grid, "top 10");
    expect(grid.adapter.getState().state).toMatchObject({ sorts: byValue, limit: 10 });
    expect(keysOf((await grid.drawn()).rows)).toEqual(expectedKeys(view({ sorts: byValue, limit: 10 })));
  });

  it.each([
    ["sort by advisor", "top 10", KEEP_OR_ALL],
    ["clear the sort", "top 10", KEEP_OR_ALL],
    ["only the taxable ones", "top 10", KEEP_OR_ALL],
    ["accounts over $1m", "top 10", KEEP_OR_ALL],
    ["clear the filters", "top 10, taxable", KEEP_OR_ALL],
    ["group by advisor", "top 10", "ready"],
    ["hide custodian", "top 10", "ready"],
    ["top 5 by gain", "top 10", "ready"],
    ["show every row", "top 10", "ready"],
    ["show all rows", "top 10", "ready"],
    ["remove the count", "top 10", "ready"],
    ["show only the first 5 rows", "top 10", "ready"],
    ["show only the first 5 rows", "top 10, header sort cleared", "First 5 by which column?"],
    ["show all accounts", "top 10, taxable", "Show every row, or clear the filters too?"],
    ["reset the view", "top 10", "ready"],
  ] as const)("“%s” (%s): %s", async (request, setup, gives) => {
    const grids = [rowsGrid(), tanstackGrid()];
    for (const grid of grids) await startAt(grid, setup);
    const [rows, table] = grids as [Grid, Grid];
    expect(table.adapter.getState().state).toEqual(rows.adapter.getState().state);
    await sameDrawing(rows, table, "before");
    for (const grid of grids) await grid.cue.propose(request);
    // What spec 5.1's table says, on the Rows Adapter, and the same on TanStack.
    const asks = rows.cue.getState();
    expect(gives === "ready" ? asks.status : asks.message).toBe(gives);
    expect(outcome(table.cue)).toEqual(outcome(rows.cue));
    // Each answer to a question, then the apply, gives the same view and the same rows on both, and undo returns both.
    const asked = rows.cue.getState().plan?.clarifications.find((c) => c.options?.length);
    const answers = asked?.options?.map((o) => o.id) ?? [undefined];
    let applied = 0;
    for (const answer of answers) {
      if (answer !== undefined && asked) {
        for (const grid of grids) {
          await grid.cue.propose(request);
          grid.cue.answer(asked.id, answer);
        }
        expect(outcome(table.cue), `answer ${answer}`).toEqual(outcome(rows.cue));
        // Every choice offered reaches a Preview to apply.
        expect(rows.cue.getState().status, `answer ${answer}`).toBe("ready");
      }
      // A question with no choices ends here.
      if (rows.cue.getState().status !== "ready") continue;
      const before = rows.adapter.getState().state;
      for (const grid of grids) expect(await grid.cue.apply(), grid.name).toBe(true);
      applied++;
      expect(table.adapter.getState().state).toEqual(rows.adapter.getState().state);
      await sameDrawing(rows, table, `answer ${answer}`);
      for (const grid of grids) expect(await grid.cue.undo(), grid.name).toBe(true);
      expect(rows.adapter.getState().state).toEqual(before);
      expect(table.adapter.getState().state).toEqual(before);
      await sameDrawing(rows, table, `undo, answer ${answer}`);
    }
    // Every row of spec 5.1's table that is ready, or asks with choices, reaches an apply.
    if (rows.cue.getState().status === "ready" || asked) expect(applied).toBeGreaterThan(0);
  });
});
