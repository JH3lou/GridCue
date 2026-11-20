// @vitest-environment jsdom

import type * as ag36 from "ag-grid-community";
import type * as ag34 from "ag-grid-community-34";
import type * as ag35 from "ag-grid-community-35";
import { describe, expect, it, vi } from "vitest";
// The Next.js example's Data Query: the Host's own code, which the Infinite Row Model's datasource runs.
import { openRowsDatabase, readRows } from "../../../examples/next/app/api/rows/query";
import { generateAccounts, wealthMockOptions, wealthSchemaOptions } from "../../../fixtures/wealth/src/index";
import { type AgGridAdapterOptions, type AgGridApiLike, createAgGridAdapter, gridcueColumnDefs, schemaFromAgGrid } from "../src/ag-grid";
import { columnSettings } from "../src/ag-grid/meanings";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { createGridCue } from "../src/core/controller";
import { isGridCueError } from "../src/core/errors";
import type {
  ColumnDescriptor,
  FilterGroup,
  FilterPredicate,
  VersionedViewState,
  ViewOperation,
  ViewPlan,
  ViewSchema,
} from "../src/core/protocol";
import { defineSchema } from "../src/core/schema";
import { validatePlan } from "../src/core/validate";
import { createMockProvider } from "../src/mock";
import { DATED_COLUMNS, DATED_ROWS, runAdapterContract } from "./adapter-contract";
import { type GridOptions, latest, MAJORS, type Major, type RowModel, shown, type TestApi, tick } from "./ag-grid-grids";

// The AG Grid adapter (more grids spec, 5.6; ADR 0033), run on AG Grid Community 34, 35 and 36 in jsdom
// (`ag-grid-grids.ts`). What the grid keeps under GridCue's meanings is `ag-grid-meanings.test.ts`; what the adapter
// reads from a filter set in AG Grid's menu is `ag-grid-read.test.ts`.

// What gridcueColumnDefs sets on a column fits each major's own column definition; each major's column definitions are
// what schemaFromAgGrid and gridcueColumnDefs read, and gridcueColumnDefs gives back that major's own, with no cast:
// `pnpm typecheck` checks these.
const typesFit = {
  settings: (schema: ViewSchema, column: ColumnDescriptor): [ag34.ColDef, ag35.ColDef, ag36.ColDef] => {
    const settings = columnSettings(schema)(column);
    return [settings, settings, settings];
  },
  columnDefs34: (defs: Array<ag34.ColDef | ag34.ColGroupDef>): Array<ag34.ColDef | ag34.ColGroupDef> =>
    gridcueColumnDefs(schemaFromAgGrid(defs), defs),
  columnDefs35: (defs: Array<ag35.ColDef | ag35.ColGroupDef>): Array<ag35.ColDef | ag35.ColGroupDef> =>
    gridcueColumnDefs(schemaFromAgGrid(defs), defs),
  columnDefs36: (defs: Array<ag36.ColDef | ag36.ColGroupDef>): Array<ag36.ColDef | ag36.ColGroupDef> =>
    gridcueColumnDefs(schemaFromAgGrid(defs), defs),
};
void typesFit;

/** Synthetic rows for the contract suite. */
const rows = [
  { value: 5, team: "b", name: "x" },
  { value: 20, team: "a", name: "y" },
  { value: 12, team: "b", name: "z" },
];
/**
 * The contract's columns. On the Infinite Row Model AG Grid has no rows to read a column's type from when it starts, so
 * the Host names each `cellDataType` (the creation check refuses a number column that would get the text filter).
 */
const columnDefs = [
  { field: "value", headerName: "Value", cellDataType: "number" },
  { field: "team", headerName: "Team", cellDataType: "text" },
  { field: "name", headerName: "Name", cellDataType: "text" },
];
const DATED_TYPES: Record<string, string> = { memo: "text", booked: "dateString", posted: "dateTimeString", stamped: "date" };

/** A grid on one row model, with GridCue's settings on its columns. */
const makeGrid = (major: Major, rowModel: RowModel, data: readonly object[], defs: readonly object[], extra: GridOptions = {}) => {
  const schema = schemaFromAgGrid(defs as never, { sampleRows: data as never });
  const rowOptions: GridOptions =
    rowModel === "clientSide"
      ? { rowData: data }
      : {
          rowModelType: "infinite",
          datasource: {
            getRows: (p: { successCallback(rows: object[], last: number): void }) => p.successCallback([...data], data.length),
          },
        };
  const api = major.createGrid({ columnDefs: gridcueColumnDefs(schema, defs), ...rowOptions, ...extra });
  return { api, schema };
};

const harness = (major: Major, rowModel: RowModel) => () => {
  const { api, schema } = makeGrid(major, rowModel, rows, columnDefs);
  const adapter = createAgGridAdapter({ schema, api });
  return {
    adapter,
    // A header click. AG Grid tells listeners a tick later; the adapter also checks the grid whenever it is read, as the
    // Controller reads it before every apply, so the harness reads it once.
    manualChange: () => {
      api.applyColumnState({ state: [{ colId: "team", sort: "asc", sortIndex: 0 }], defaultState: { sort: null } });
      adapter.getState();
    },
    numericColumn: "value",
    otherColumn: "name",
    dated: () => {
      const defs = DATED_COLUMNS.map((id) => ({ field: id, headerName: id, cellDataType: DATED_TYPES[id] }));
      const dated = makeGrid(major, rowModel, DATED_ROWS, defs);
      return createAgGridAdapter({ schema: dated.schema, api: dated.api });
    },
  };
};

for (const major of MAJORS) {
  for (const rowModel of ["clientSide", "infinite"] as const) {
    runAdapterContract(`AG Grid ${major.version} adapter, ${rowModel} row model`, harness(major, rowModel), { without: ["group.set"] });
  }
}

// --- Helpers ---------------------------------------------------------------------------------------------------------

const planFor = (current: VersionedViewState, operations: ViewOperation[]): ViewPlan => ({
  protocolVersion: "0.1",
  id: `p_${Math.random()}`,
  baseRevision: current.revision,
  source: { channel: "api" },
  status: "ready",
  operations,
  evidence: [],
  clarifications: [],
  unsupportedSegments: [],
});

const validated = (adapter: ReturnType<typeof createAgGridAdapter>, operations: ViewOperation[]) => {
  const result = validatePlan(planFor(adapter.getState(), operations), {
    schema: adapter.getSchema(),
    capabilities: adapter.getCapabilities(),
    current: adapter.getState(),
    defaultState: adapter.getDefaultState(),
  });
  if (!result.ok) throw new Error(result.issues.map((i) => i.code).join(","));
  return result.plan;
};

let ids = 0;
const filter = (
  columnId: string,
  operator: FilterPredicate["operator"],
  value?: FilterPredicate["value"],
  combineWith: "and" | "or" = "and",
) =>
  ({
    type: "filter.add",
    combineWith,
    predicate: { id: `f${++ids}`, type: "predicate", columnId, operator, ...(value === undefined ? {} : { value }) },
  }) as ViewOperation;

const configError = (make: () => unknown) => {
  try {
    make();
  } catch (error) {
    return isGridCueError(error) ? { code: error.code, message: error.message } : { code: "other", message: String(error) };
  }
  return undefined;
};

/** What a test compares to see that nothing was written: the filter model and the column state. */
const written = (api: AgGridApiLike) => JSON.stringify({ filters: api.getFilterModel(), columns: api.getColumnState() });

// --- What it lists, and its Revisions ---------------------------------------------------------------------------------

describe("AG Grid adapter: operations and Revisions", () => {
  it("lists the MVP operations without group.set, and nothing beyond them", () => {
    const { adapter } = harness(latest, "clientSide")();
    expect(adapter.getCapabilities().operations).toEqual(MVP_OPERATIONS.filter((op) => op !== "group.set"));
  });

  it("reads Revisions as ag-grid:n, and one apply moves it by one", async () => {
    const { adapter } = harness(latest, "clientSide")();
    expect(adapter.getState().revision).toBe("ag-grid:0");
    const result = await adapter.apply(validated(adapter, [{ type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }]));
    expect(result.ok && result.state.revision).toBe("ag-grid:1");
  });

  it("writes and reads AG Grid's own filters, sorts and columns: the grid shows what the View State says", async () => {
    const { api, schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    const adapter = createAgGridAdapter({ schema, api });
    const result = await adapter.apply(
      validated(adapter, [
        filter("value", "gt", 6),
        { type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] },
        { type: "columns.hide", columnIds: ["team"] },
        { type: "columns.order", columnIds: ["name"] },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(api.getFilterModel()).toEqual({ value: { filterType: "number", type: "gridcueGreaterThan", filter: 6 } });
    expect(shown(api, "value")).toEqual([12, 20]);
    expect(api.getColumnState().map((c) => [c.colId, c.hide, c.sort ?? null])).toEqual([
      ["name", false, null],
      ["value", false, "asc"],
      ["team", true, null],
    ]);
  });

  it("gives every sorted column its sortIndex and clears the sorts it no longer holds", async () => {
    const { api, schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    const adapter = createAgGridAdapter({ schema, api });
    const two = [
      { columnId: "team", direction: "asc" },
      { columnId: "value", direction: "desc" },
    ] as const;
    expect((await adapter.apply(validated(adapter, [{ type: "sort.set", sorts: [...two] }]))).ok).toBe(true);
    expect(adapter.getState().state.sorts).toEqual(two);
    expect(shown(api, "value")).toEqual([20, 12, 5]);
    expect((await adapter.apply(validated(adapter, [{ type: "sort.set", sorts: [{ columnId: "name", direction: "desc" }] }]))).ok).toBe(
      true,
    );
    expect(api.getColumnState().filter((c) => c.sort)).toMatchObject([{ colId: "name", sort: "desc", sortIndex: 0 }]);
    expect(adapter.getState().state.sorts).toEqual([{ columnId: "name", direction: "desc" }]);
  });

  it("takes the grid's view when it was created as the default state", async () => {
    const defs = columnDefs.map((d) => (d.field === "value" ? { ...d, sort: "desc" } : d.field === "name" ? { ...d, hide: true } : d));
    const { api, schema } = makeGrid(latest, "clientSide", rows, defs);
    const adapter = createAgGridAdapter({ schema, api });
    const start = adapter.getDefaultState();
    expect(start.sorts).toEqual([{ columnId: "value", direction: "desc" }]);
    expect(start.visibleColumnIds).toEqual(["value", "team"]);
    expect(
      (
        await adapter.apply(
          validated(adapter, [
            { type: "sort.set", sorts: [] },
            { type: "columns.show", columnIds: ["name"] },
          ]),
        )
      ).ok,
    ).toBe(true);
    expect((await adapter.apply(validated(adapter, [{ type: "view.reset" }]))).ok).toBe(true);
    expect(adapter.getState().state).toEqual(start);
    expect(api.getColumnState().map((c) => [c.colId, c.hide, c.sort ?? null])).toEqual([
      ["value", false, "desc"],
      ["team", false, null],
      ["name", true, null],
    ]);
  });

  it("refuses to restore a snapshot holding pins, totals, a density, a count or a grouping, and writes nothing", async () => {
    const { api, schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    const adapter = createAgGridAdapter({ schema, api });
    const snapshot = adapter.getState();
    const grid = written(api);
    for (const extra of [
      { pinnedColumnIds: { start: ["value"], end: [] } },
      { aggregations: [{ columnId: "value", function: "sum" as const }] },
      { density: "compact" as const },
      { limit: 2 },
      // Community can't group: the grid would hold the sort and not the grouping.
      { groupBy: ["team"] },
    ]) {
      const result = await adapter.restore({
        ...snapshot,
        state: { ...snapshot.state, sorts: [{ columnId: "value", direction: "asc" }], ...extra },
      });
      expect(result.ok, JSON.stringify(extra)).toBe(false);
      if (!result.ok) expect(result.code).toBe("ADAPTER_NOT_APPLICABLE");
      expect(written(api)).toBe(grid);
    }
    expect(adapter.getState()).toEqual(snapshot);
  });

  it("restores a snapshot whose count is null, as no count", async () => {
    const { api, schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    const adapter = createAgGridAdapter({ schema, api });
    const snapshot = adapter.getState();
    const state = { ...snapshot.state, sorts: [{ columnId: "value", direction: "desc" as const }], limit: null };
    const result = await adapter.restore({ ...snapshot, state: state as unknown as typeof snapshot.state });
    expect(result.ok).toBe(true);
    expect(shown(api, "value")).toEqual([20, 12, 5]);
  });

  it("tells subscribers of a change made in the grid, a tick later, with no read", async () => {
    const { api, schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    const adapter = createAgGridAdapter({ schema, api });
    const heard: VersionedViewState[] = [];
    adapter.subscribe((s) => heard.push(s));
    api.applyColumnState({ state: [{ colId: "name", hide: true }] });
    await tick();
    expect(heard).toHaveLength(1);
    expect(heard[0]?.revision).toBe("ag-grid:1");
    expect(heard[0]?.state.visibleColumnIds).toEqual(["value", "team"]);
  });

  it("ends a grouping request in “This grid can't group rows.”, and applies and undoes a sort through the Controller", async () => {
    const { api, schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    const adapter = createAgGridAdapter({ schema, api });
    const controller = createGridCue({ schema, adapter, provider: createMockProvider() });
    await controller.propose("group by team");
    expect(controller.getState().message).toBe("This grid can't group rows.");
    await controller.propose("sort by value descending");
    expect(await controller.apply()).toBe(true);
    expect(shown(api, "value")).toEqual([20, 12, 5]);
    expect(await controller.undo()).toBe(true);
    expect(api.getColumnState().some((c) => c.sort)).toBe(false);
  });
});

// --- Checks at creation ----------------------------------------------------------------------------------------------

/** Every GridApi call the adapter uses. A grid without one is refused at creation, by name (spec 5.6). */
const CALLS = ["getFilterModel", "setFilterModel", "getColumnState", "applyColumnState", "getColumn", "addEventListener", "isDestroyed"];

/** A plain object holding `api`'s calls, bound, with `without` left out. */
const callsOf = (api: TestApi, without?: string) =>
  Object.fromEntries(
    CALLS.filter((name) => name !== without).map((name) => [
      name,
      (api as unknown as Record<string, (...a: unknown[]) => unknown>)[name]?.bind(api),
    ]),
  ) as unknown as AgGridApiLike;

describe("AG Grid adapter: checks at creation", () => {
  for (const major of MAJORS) {
    it(`AG Grid ${major.version} has every call the adapter uses`, () => {
      const { api, schema } = makeGrid(major, "clientSide", rows, columnDefs);
      expect(configError(() => createAgGridAdapter({ schema, api: callsOf(api) }))).toBeUndefined();
      expect(configError(() => createAgGridAdapter({ schema, api }))).toBeUndefined();
    });

    for (const call of CALLS) {
      it(`AG Grid ${major.version} without ${call}: INPUT_CONFIG naming it`, () => {
        const { api, schema } = makeGrid(major, "clientSide", rows, columnDefs);
        const error = configError(() => createAgGridAdapter({ schema, api: callsOf(api, call) }));
        expect(error?.code).toBe("INPUT_CONFIG");
        expect(error?.message).toContain(call);
      });
    }
  }

  it("refuses a value that isn't a grid api", () => {
    const { schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    for (const api of [undefined, null, 3, "api"]) {
      expect(configError(() => createAgGridAdapter({ schema, api } as unknown as AgGridAdapterOptions))?.code).toBe("INPUT_CONFIG");
    }
  });

  it("refuses a destroyed grid", () => {
    const { api, schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    api.destroy();
    const error = configError(() => createAgGridAdapter({ schema, api }));
    expect(error).toEqual({ code: "INPUT_CONFIG", message: expect.stringContaining("destroyed") });
  });

  it("refuses a schema column the grid doesn't have, naming it", () => {
    const { api } = makeGrid(latest, "clientSide", rows, columnDefs);
    const schema = defineSchema([{ id: "value" }, { id: "team" }, { id: "name" }, { id: "missing" }], { sampleRows: rows });
    const error = configError(() => createAgGridAdapter({ schema, api }));
    expect(error?.code).toBe("INPUT_CONFIG");
    expect(error?.message).toContain("“missing”");
  });

  it("refuses a filterable column without gridcueColumnDefs' settings, naming it", () => {
    const schema = schemaFromAgGrid(columnDefs as never, { sampleRows: rows });
    for (const defaultColDef of [undefined, { filter: true }]) {
      const api = latest.createGrid({ columnDefs, defaultColDef, rowData: rows });
      const error = configError(() => createAgGridAdapter({ schema, api }));
      expect(error?.code).toBe("INPUT_CONFIG");
      expect(error?.message).toContain("“value”");
      expect(error?.message).toContain("gridcueColumnDefs");
    }
  });

  it("sets each schema column, inside column groups too, beside the Host's own default column definition, and leaves other columns as they are", () => {
    const defs = [{ headerName: "Both", children: columnDefs.slice(0, 2) }, ...columnDefs.slice(2), { field: "extra", filter: false }];
    const schema = schemaFromAgGrid(columnDefs as never, { sampleRows: rows });
    const wrapped = gridcueColumnDefs(schema, defs) as Array<Record<string, unknown>>;
    expect(wrapped[0]?.children).toHaveLength(2);
    expect(wrapped[2]).toEqual({ field: "extra", filter: false });
    // A default column definition that turns filters off, or names other options, doesn't reach a column that sets them.
    const api = latest.createGrid({
      columnDefs: wrapped,
      defaultColDef: { filter: false, filterParams: { filterOptions: ["contains"], buttons: ["reset"] }, flex: 1 },
      rowData: rows,
    });
    const adapter = createAgGridAdapter({ schema, api });
    expect(adapter.getState().state.columnOrder).toEqual(["value", "team", "name"]);
  });

  it("refuses a column whose own filterParams replace gridcueColumnDefs', naming it and the setting", () => {
    const defs = columnDefs.map((d) => (d.field === "team" ? { ...d, filterParams: { filterOptions: ["contains"] } } : d));
    const { api, schema } = makeGrid(latest, "clientSide", rows, defs);
    const error = configError(() => createAgGridAdapter({ schema, api }));
    expect(error?.code).toBe("INPUT_CONFIG");
    expect(error?.message).toContain("“team”");
    expect(error?.message).toContain("filterOptions");
  });

  it("keeps a column's own filterParams that gridcueColumnDefs doesn't set", () => {
    const defs = columnDefs.map((d) => (d.field === "team" ? { ...d, filterParams: { buttons: ["reset"] } } : d));
    const { api, schema } = makeGrid(latest, "clientSide", rows, defs);
    expect(configError(() => createAgGridAdapter({ schema, api }))).toBeUndefined();
  });

  it("refuses a column with filter turned off, or a filter of its own, that the schema lets GridCue filter", () => {
    for (const own of [false, "agSetColumnFilter", class {}]) {
      const defs = columnDefs.map((d) => (d.field === "name" ? { ...d, filter: own } : d));
      const { api } = makeGrid(latest, "clientSide", rows, defs);
      const schema = defineSchema(
        columnDefs.map((d) => ({ id: d.field })),
        { sampleRows: rows },
      );
      const error = configError(() => createAgGridAdapter({ schema, api }));
      expect(error?.code, String(own)).toBe("INPUT_CONFIG");
      expect(error?.message).toContain("“name”");
    }
  });

  it("refuses a number column that gets AG Grid's text filter, as on the Infinite Row Model with no cellDataType", () => {
    const defs = columnDefs.map(({ cellDataType: _type, ...d }) => d);
    const schema = schemaFromAgGrid(defs as never, { sampleRows: rows });
    const { api } = makeGrid(latest, "infinite", rows, defs);
    const error = configError(() => createAgGridAdapter({ schema, api }));
    expect(error?.code).toBe("INPUT_CONFIG");
    expect(error?.message).toContain("“value”");
    expect(error?.message).toContain("cellDataType");
  });

  // A setting that makes AG Grid filter on another value than the column's cell, or match it another way, keeps other
  // rows than the View State means. The check sees each one; the rows each changes are in the next test.
  const ANOTHER_VALUE: Array<[string, string, Record<string, unknown>]> = [
    ["team", "filterValueGetter", { filterValueGetter: ({ data }: { data?: { team?: string } }) => `team ${data?.team}` }],
    ["team", "valueGetter", { valueGetter: ({ data }: { data?: { team?: string } }) => `team ${data?.team}` }],
    ["team", "textFormatter", { filterParams: { textFormatter: () => "same" } }],
    ["value", "includeBlanksInEquals", { filterParams: { includeBlanksInEquals: true } }],
  ];
  for (const major of MAJORS) {
    for (const [columnId, setting, extra] of ANOTHER_VALUE) {
      it(`AG Grid ${major.version}: refuses a filterable column with its own ${setting}, naming it and the setting`, () => {
        const schema = schemaFromAgGrid(columnDefs as never, { sampleRows: rows });
        const defs = columnDefs.map((d) => (d.field === columnId ? { ...d, ...extra } : d));
        const api = major.createGrid({ columnDefs: gridcueColumnDefs(schema, defs), rowData: rows });
        const error = configError(() => createAgGridAdapter({ schema, api }));
        expect(error?.code).toBe("INPUT_CONFIG");
        expect(error?.message).toContain(`“${columnId}”`);
        expect(error?.message).toContain(setting);
      });
    }
  }

  it("each of those settings keeps other rows than GridCue's filter means", async () => {
    const blankRows = [...rows, { value: null, team: "c", name: "w" }];
    const means = { team: ["a"], value: [20] };
    for (const [columnId, setting, extra] of ANOTHER_VALUE) {
      const schema = schemaFromAgGrid(columnDefs as never, { sampleRows: blankRows });
      const defs = columnDefs.map((d) => (d.field === columnId ? { ...d, ...extra } : d));
      const api = latest.createGrid({ columnDefs: gridcueColumnDefs(schema, defs), rowData: blankRows });
      api.setFilterModel(
        columnId === "team"
          ? { team: { filterType: "text", type: "equals", filter: "a" } }
          : { value: { filterType: "number", type: "equals", filter: 20 } },
      );
      expect(shown(api, columnId), setting).not.toEqual(means[columnId as keyof typeof means]);
    }
  });

  it("the examples' grid with a filterValueGetter that filters an enum by its label: refused, or never offered for filtering", async () => {
    const LABELS: Record<string, string> = { northgate: "Northgate", harborline: "Harborline", summit_trust: "Summit Trust" };
    const accounts = generateAccounts();
    const byLabel = ({ data }: { data?: { custodian?: string } }) => LABELS[String(data?.custodian)] ?? data?.custodian;
    const defs = [
      { field: "account_number", headerName: "Account number" },
      { field: "household", headerName: "Household" },
      { field: "advisor_name", headerName: "Advisor" },
      { field: "registration_type", headerName: "Registration type" },
      { field: "custodian", headerName: "Custodian", filterValueGetter: byLabel },
      { field: "market_value", headerName: "Market value", cellDataType: "number" },
      { field: "concentration", headerName: "Concentration", cellDataType: "number" },
      { field: "unrealized_gain", headerName: "Unrealized gain", cellDataType: "number" },
      { field: "has_restricted_holding", headerName: "Restricted holdings", cellDataType: "boolean" },
      { field: "tax_id", headerName: "Tax ID", hide: true },
    ];
    // The Host names the filter capability itself: the adapter refuses the grid, naming the column and the setting.
    const named = schemaFromAgGrid(defs, {
      ...wealthSchemaOptions,
      sampleRows: accounts.map((r) => ({ ...r })),
      columns: {
        ...wealthSchemaOptions.columns,
        custodian: { ...wealthSchemaOptions.columns?.custodian, capabilities: ["filter", "sort"] },
      },
    });
    const refused = latest.createGrid({ columnDefs: gridcueColumnDefs(named, defs), rowData: accounts });
    const error = configError(() => createAgGridAdapter({ schema: named, api: refused }));
    expect(error?.code).toBe("INPUT_CONFIG");
    expect(error?.message).toContain("“custodian”");
    expect(error?.message).toContain("filterValueGetter");
    // Read from the grid, the column gets no filter capability: GridCue never filters it, so it never shows other rows.
    const schema = schemaFromAgGrid(defs, { ...wealthSchemaOptions, sampleRows: accounts.map((r) => ({ ...r })) });
    expect(schema.columns.find((c) => c.id === "custodian")?.capabilities).not.toContain("filter");
    const api = latest.createGrid({ columnDefs: gridcueColumnDefs(schema, defs), rowData: accounts });
    const adapter = createAgGridAdapter({ schema, api });
    const controller = createGridCue({ schema, adapter, provider: createMockProvider(wealthMockOptions) });
    await controller.propose("custodian is Northgate");
    await controller.apply();
    expect(api.getFilterModel()).toEqual({});
    expect(adapter.getState().state.filters).toBeNull();
  });

  it("takes a column with its own filter when the schema doesn't let GridCue filter it", () => {
    const defs = columnDefs.map((d) => (d.field === "name" ? { ...d, filter: class {} } : d));
    const { api, schema } = makeGrid(latest, "clientSide", rows, defs);
    expect(schema.columns.find((c) => c.id === "name")?.capabilities).not.toContain("filter");
    expect(configError(() => createAgGridAdapter({ schema, api }))).toBeUndefined();
  });
});

// --- Filters AG Grid can't hold ----------------------------------------------------------------------------------------

describe("AG Grid adapter: a filter AG Grid can't hold fails before anything is written", () => {
  const refused = async (operations: ViewOperation[]) => {
    const { api, schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    const adapter = createAgGridAdapter({ schema, api });
    const before = adapter.getState();
    const grid = written(api);
    let heard = 0;
    adapter.subscribe(() => heard++);
    const result = await adapter.apply(validated(adapter, operations));
    await tick();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ADAPTER_UNSUPPORTED_FILTER");
    expect(written(api)).toBe(grid);
    expect(adapter.getState()).toEqual(before);
    expect(heard).toBe(0);
    return result;
  };

  it("an in with another filter on its column", async () => {
    await refused([
      filter("team", "in", ["a", "b"]),
      filter("team", "contains", "a"),
      { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
    ]);
  });

  it("an OR across columns", async () => {
    await refused([filter("value", "gt", 10), filter("team", "eq", "a", "or"), { type: "columns.hide", columnIds: ["name"] }]);
  });

  it("holds an in on its own column, and an OR on one column, as AG Grid's OR of conditions", async () => {
    const { api, schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    const adapter = createAgGridAdapter({ schema, api });
    expect(
      (
        await adapter.apply(
          validated(adapter, [filter("name", "in", ["x", "z"]), filter("value", "lt", 6), filter("value", "gt", 15, "or")]),
        )
      ).ok,
    ).toBe(false);
    expect((await adapter.apply(validated(adapter, [filter("name", "in", ["x", "z"])]))).ok).toBe(true);
    expect(api.getFilterModel()).toEqual({
      name: {
        filterType: "text",
        operator: "OR",
        conditions: [
          { filterType: "text", type: "equals", filter: "x" },
          { filterType: "text", type: "equals", filter: "z" },
        ],
      },
    });
    expect(shown(api, "name")).toEqual(["x", "z"]);
  });

  it("an OR on one column with another filter ANDed on that column", async () => {
    await refused([filter("value", "gt", 1), filter("value", "lt", 6, "or"), filter("value", "gt", 15)]);
  });

  it("a model AG Grid cuts short: the apply fails, and the grid is put back as it was", async () => {
    // A grid that keeps fewer conditions than the list holds, as AG Grid does past a column's maxNumConditions, without
    // a word (spike, Q2f). gridcueColumnDefs' own limit is checked at creation, so this grid cuts as it is written to.
    const { api, schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    const cut = (entry: unknown) => {
      const conditions = (entry as { conditions?: unknown[] }).conditions;
      return conditions ? { ...(entry as object), conditions: conditions.slice(0, 2) } : entry;
    };
    const cutting: AgGridApiLike = {
      ...callsOf(api),
      setFilterModel: (model) =>
        api.setFilterModel(model && Object.fromEntries(Object.entries(model).map(([id, entry]) => [id, cut(entry)]))),
    };
    const adapter = createAgGridAdapter({ schema, api: cutting });
    const before = adapter.getState();
    const grid = written(api);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await adapter.apply(
        validated(adapter, [
          filter("name", "in", ["x", "y", "z"]),
          { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
        ]),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("ADAPTER_FAILED");
    } finally {
      quiet.mockRestore();
      warned.mockRestore();
    }
    expect(written(api)).toBe(grid);
    expect(adapter.getState()).toEqual(before);
  });
});

// --- The Host's own: pins, a grouping, and filters GridCue can't read ------------------------------------------------

describe("AG Grid adapter: what the Host's grid holds is written back unchanged", () => {
  it("keeps the grid's pins through apply, undo and a column move, and holds none in the View State", async () => {
    const defs = columnDefs.map((d) =>
      d.field === "value" ? { ...d, pinned: "left" } : d.field === "name" ? { ...d, pinned: "right" } : d,
    );
    const { api, schema } = makeGrid(latest, "clientSide", rows, defs);
    const adapter = createAgGridAdapter({ schema, api });
    const pins = () => api.getColumnState().map((c) => [c.colId, c.pinned ?? null]);
    const pinned = [
      ["value", "left"],
      ["team", null],
      ["name", "right"],
    ];
    expect(pins()).toEqual(pinned);
    const snapshot = adapter.getState();
    expect(snapshot.state.pinnedColumnIds).toEqual({ start: [], end: [] });
    const applied = await adapter.apply(
      validated(adapter, [
        { type: "columns.order", columnIds: ["name", "team"] },
        { type: "sort.set", sorts: [{ columnId: "team", direction: "asc" }] },
        { type: "columns.hide", columnIds: ["value"] },
      ]),
    );
    expect(applied.ok).toBe(true);
    expect(Object.fromEntries(pins())).toEqual(Object.fromEntries(pinned));
    expect((await adapter.restore(snapshot)).ok).toBe(true);
    expect(pins()).toEqual(pinned);
  });

  it("reads an Enterprise grouping into the View State and writes it back unchanged", async () => {
    const { api, schema } = makeGrid(latest, "clientSide", rows, columnDefs);
    const calls: unknown[] = [];
    // AG Grid Community can't group, so this grid reports a grouping by Team as Enterprise would, and records each write.
    const enterprise: AgGridApiLike = {
      ...callsOf(api),
      getColumnState: () => api.getColumnState().map((c) => (c.colId === "team" ? { ...c, rowGroup: true, rowGroupIndex: 0 } : c)),
      applyColumnState: (params) => {
        calls.push(structuredClone(params));
        return api.applyColumnState(params);
      },
    };
    const adapter = createAgGridAdapter({ schema, api: enterprise });
    expect(adapter.getState().state.groupBy).toEqual(["team"]);
    expect(adapter.getDefaultState().groupBy).toEqual(["team"]);
    const snapshot = adapter.getState();
    const applied = await adapter.apply(
      validated(adapter, [
        { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
        { type: "view.reset" },
        filter("value", "gt", 6),
      ]),
    );
    expect(applied.ok).toBe(true);
    expect(adapter.getState().state.groupBy).toEqual(["team"]);
    expect((await adapter.restore(snapshot)).ok).toBe(true);
    expect(adapter.getState().state).toEqual(snapshot.state);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      for (const entry of (call as { state: Array<Record<string, unknown>> }).state) {
        expect(Object.keys(entry).filter((key) => ["rowGroup", "rowGroupIndex", "pinned"].includes(key))).toEqual([]);
      }
    }
  });

  // The filters GridCue can't read, which also stay the Host's, are in `ag-grid-read.test.ts`.
});

// --- The Infinite Row Model with the Host's own filter ---------------------------------------------------------------

/** The Host's own custom filter component: it keeps the rows of one advisor. */
class AdvisorFilter {
  private model: { advisor: string } | null = null;
  init() {}
  getGui() {
    return document.createElement("div");
  }
  isFilterActive() {
    return this.model !== null;
  }
  doesFilterPass(params: { data: { advisor?: string } }) {
    return params.data.advisor === this.model?.advisor;
  }
  getModel() {
    return this.model;
  }
  setModel(model: { advisor: string } | null) {
    this.model = model;
  }
}

describe("AG Grid adapter: the Infinite Row Model with the Host's own filter", () => {
  const accounts = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, advisor: i % 3 === 1 ? "Lee" : "Kim", qty: (i * 7) % 10 }));
  const defs = [
    { field: "id", cellDataType: "number" },
    { field: "advisor", filter: AdvisorFilter },
    { field: "qty", cellDataType: "number" },
  ];

  for (const major of MAJORS) {
    it(`AG Grid ${major.version}: the request holds the Host's filter, the View State only GridCue's, and the Data Query keeps the rows that pass both`, async () => {
      const schema = schemaFromAgGrid(defs as never, { sampleRows: accounts });
      expect(schema.columns.find((c) => c.id === "advisor")?.capabilities).not.toContain("filter");
      // The Host's server knows its own filter's column, so its own schema lets it filter there.
      const serverSchema = defineSchema(
        defs.map((d) => ({ id: d.field })),
        { sampleRows: accounts },
      );
      const db = openRowsDatabase(serverSchema, accounts);
      const requests: Array<Record<string, unknown>> = [];
      const answered: unknown[][] = [];
      let adapter: ReturnType<typeof createAgGridAdapter> | undefined;
      try {
        const api = major.createGrid({
          columnDefs: gridcueColumnDefs(schema, defs),
          rowModelType: "infinite",
          cacheBlockSize: 50,
          datasource: {
            getRows(params: {
              startRow: number;
              endRow: number;
              filterModel: Record<string, unknown>;
              successCallback(rows: object[], last: number): void;
            }) {
              requests.push(structuredClone(params.filterModel));
              // The Host's Data Query: the View State's filters, and its own filter from the request, joined with AND
              // (spec 5.5, step 2). Everything else comes from the View State.
              const view = adapter?.getState().state;
              if (!view) return params.successCallback([], 0);
              const host = params.filterModel.advisor as { advisor: string } | undefined;
              const own: FilterPredicate[] = host
                ? [{ id: "host", type: "predicate", columnId: "advisor", operator: "eq", value: host.advisor }]
                : [];
              const filters: FilterGroup | null =
                view.filters || own.length
                  ? { id: "both", type: "group", combinator: "and", children: [...(view.filters ? [view.filters] : []), ...own] }
                  : null;
              const result = readRows(
                db,
                serverSchema,
                { ...view, filters },
                { offset: params.startRow, size: params.endRow - params.startRow },
              );
              answered.push(result.rows.map((r) => r.id));
              params.successCallback(result.rows, result.total);
            },
          },
        });
        adapter = createAgGridAdapter({ schema, api });
        await tick();
        // The User sets the Host's own filter in its menu.
        api.setFilterModel({ advisor: { advisor: "Lee" } });
        await tick();
        // Then GridCue's filter on another column.
        const applied = await adapter.apply(validated(adapter, [filter("qty", "gt", 4)]));
        expect(applied.ok).toBe(true);
        await tick(30);

        expect(requests.at(-1)).toEqual({
          advisor: { advisor: "Lee" },
          qty: { filterType: "number", type: "gridcueGreaterThan", filter: 4 },
        });
        expect(adapter.getState().state.filters?.children).toEqual([
          { id: expect.any(String), type: "predicate", columnId: "qty", operator: "gt", value: 4 },
        ]);
        const passBoth = accounts.filter((a) => a.advisor === "Lee" && a.qty > 4).map((a) => a.id);
        expect(passBoth.length).toBeGreaterThan(0);
        expect(answered.at(-1)).toEqual(passBoth);
        const drawn = Array.from({ length: api.getDisplayedRowCount() }, (_, i) => api.getDisplayedRowAtIndex(i)?.data?.id);
        expect(drawn).toEqual(passBoth);
      } finally {
        db.close();
      }
    });
  }
});

// --- schemaFromAgGrid ------------------------------------------------------------------------------------------------

describe("schemaFromAgGrid", () => {
  it("reads ids, labels and kinds from the column definitions and sample rows, and filters only where AG Grid's own filter is", () => {
    const schema: ViewSchema = schemaFromAgGrid(
      [
        {
          headerName: "Account",
          children: [
            { field: "account", headerName: "Account" },
            { colId: "mv", field: "market.value", headerName: "Market value", cellDataType: "number" },
          ],
        },
        { field: "advisor", filter: AdvisorFilter },
        { field: "notes", filter: false },
        { field: "opened" },
        { field: "stamp" },
        { field: "rank", sortable: false },
        { field: "region", filter: "agSetColumnFilter" },
        { field: "flag", filter: "agTextColumnFilter" },
        { headerName: "No id" },
      ],
      {
        sampleRows: [
          {
            account: "A1",
            market: { value: 5 },
            advisor: "Lee",
            notes: "",
            opened: "2026-01-02",
            stamp: "2026-01-02T10:00:00Z",
            rank: 1,
            region: "East",
            flag: true,
          },
        ],
        columns: { advisor: { aliases: ["adviser"] } },
      },
    );
    const by = Object.fromEntries(schema.columns.map((c) => [c.id, c]));
    expect(schema.columns.map((c) => c.id)).toEqual(["account", "mv", "advisor", "notes", "opened", "stamp", "rank", "region", "flag"]);
    expect(by.mv).toMatchObject({ label: "Market value", kind: "number" });
    expect(by.opened?.kind).toBe("date");
    expect(by.stamp?.kind).toBe("datetime");
    expect(by.flag?.kind).toBe("boolean");
    expect(by.advisor?.aliases).toEqual(["adviser"]);
    for (const id of ["advisor", "notes", "region"]) expect(by[id]?.capabilities, id).not.toContain("filter");
    for (const id of ["account", "mv", "opened", "stamp", "rank", "flag"]) expect(by[id]?.capabilities, id).toContain("filter");
    expect(by.rank?.capabilities).not.toContain("sort");
    expect(by.account?.capabilities).toContain("sort");
  });
});
