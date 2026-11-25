// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { ledgerColumns, ledgerSchemaOptions } from "../../../fixtures/ledger/src/index";
import { generateAccounts, wealthColumns, wealthMockOptions, wealthSchemaOptions } from "../../../fixtures/wealth/src/index";
import { createAgGridAdapter, gridcueColumnDefs, schemaFromAgGrid } from "../src/ag-grid";
import { readColumnModel } from "../src/ag-grid/read";
import { createGridCue } from "../src/core/controller";
import { type ColumnDescriptor, emptyViewState, type FilterGroup, type FilterPredicate, type ViewSchema } from "../src/core/protocol";
import { applyView } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { filterIssues } from "../src/core/validate";
import { createMockProvider } from "../src/mock";
import { columnDefsFor, latest, MAJORS, type Major, shown } from "./ag-grid-grids";
import { edgeRows } from "./ag-grid-row-check";

// What AG Grid's filter menu offers on each column, and what GridCue makes of it (more grids spec, 5.6): each filter
// offers only the options GridCue can read for its column, so a filter the User sets in the menu is in the View State,
// and the Preview, "clear the filters" and undo see it. In jsdom a menu change is the filter model the menu would set,
// set through the grid's own api; a model whose option the column doesn't list is one the menu can't set, and AG Grid
// drops it (spike, Q2b).

const WEALTH = defineSchema(wealthColumns, wealthSchemaOptions);
const LEDGER = defineSchema(ledgerColumns, ledgerSchemaOptions);
const SUBJECTS = [
  { name: "wealth", schema: WEALTH, id: "account_number" },
  { name: "ledger", schema: LEDGER, id: "entry_number" },
];

/** Every option key AG Grid's text, number and date filters know, and GridCue's custom ones. */
const KEYS = [
  "equals",
  "notEqual",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "lessThan",
  "lessThanOrEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "inRange",
  "blank",
  "notBlank",
  "gridcueLessThan",
  "gridcueLessThanOrEqual",
  "gridcueGreaterThan",
  "gridcueGreaterThanOrEqual",
  "gridcueBetween",
  "gridcueIsEmpty",
  "gridcueIsNotEmpty",
];
const NO_INPUT = new Set(["blank", "notBlank", "gridcueIsEmpty", "gridcueIsNotEmpty"]);
const TWO_INPUTS = new Set(["inRange", "gridcueBetween"]);

/** The options each kind's filter offers: the ones GridCue reads for that kind. */
const OFFERED: Record<ColumnDescriptor["kind"], string[]> = {
  string: ["equals", "notEqual", "contains", "startsWith", "gridcueIsEmpty", "gridcueIsNotEmpty"],
  enum: ["equals", "notEqual", "gridcueIsEmpty", "gridcueIsNotEmpty"],
  boolean: ["equals"],
  number: [
    "equals",
    "notEqual",
    "gridcueLessThan",
    "gridcueLessThanOrEqual",
    "gridcueGreaterThan",
    "gridcueGreaterThanOrEqual",
    "gridcueBetween",
    "gridcueIsEmpty",
    "gridcueIsNotEmpty",
  ],
  currency: [],
  percent: [],
  date: [
    "equals",
    "gridcueLessThan",
    "gridcueLessThanOrEqual",
    "gridcueGreaterThan",
    "gridcueGreaterThanOrEqual",
    "gridcueBetween",
    "gridcueIsEmpty",
    "gridcueIsNotEmpty",
  ],
  datetime: [],
};
OFFERED.currency = OFFERED.number;
OFFERED.percent = OFFERED.number;
OFFERED.datetime = OFFERED.date;

/** A model for one option on a column, with operands a User could type there. */
const modelFor = (column: ColumnDescriptor, type: string): Record<string, unknown> => {
  const kind = column.kind;
  if (kind === "number" || kind === "currency" || kind === "percent") {
    const filterType = "number";
    if (NO_INPUT.has(type)) return { filterType, type };
    return TWO_INPUTS.has(type) ? { filterType, type, filter: 1, filterTo: 1_000_000 } : { filterType, type, filter: 5 };
  }
  if (kind === "date" || kind === "datetime") {
    const filterType = "date";
    if (NO_INPUT.has(type)) return { filterType, type };
    return TWO_INPUTS.has(type)
      ? { filterType, type, dateFrom: "2026-01-10 00:00:00", dateTo: "2026-03-10 00:00:00" }
      : { filterType, type, dateFrom: "2026-01-10 00:00:00" };
  }
  const filterType = "text";
  if (NO_INPUT.has(type)) return { filterType, type };
  const text = kind === "boolean" ? "true" : kind === "enum" ? (column.enumValues?.[0]?.id ?? "a") : "an";
  return TWO_INPUTS.has(type) ? { filterType, type, filter: "b", filterTo: "n" } : { filterType, type, filter: text };
};

const filterable = (schema: ViewSchema) =>
  schema.columns.filter((c) => c.sensitivity !== "restricted" && c.capabilities.includes("filter"));

const leaves = (group: FilterGroup | null): FilterPredicate[] =>
  (group?.children ?? []).flatMap((c) => (c.type === "group" ? leaves(c) : [c]));

describe("AG Grid's menu offers only what GridCue reads, and every filter it holds is in the View State", () => {
  for (const major of MAJORS) {
    for (const { name, schema, id } of SUBJECTS) {
      it(`AG Grid ${major.version}, ${name}: each column holds the options of its kind, and each one reads with the rows the grid shows`, () => {
        const rows = edgeRows(schema, id);
        const api = major.createGrid({ columnDefs: gridcueColumnDefs(schema, columnDefsFor(schema)), rowData: rows, animateRows: false });
        const adapter = createAgGridAdapter({ schema, api });
        const wrong: string[] = [];
        for (const column of filterable(schema)) {
          const held: string[] = [];
          for (const type of KEYS) {
            api.setFilterModel({ [column.id]: modelFor(column, type) });
            if (!Object.hasOwn(api.getFilterModel(), column.id)) continue;
            held.push(type);
            const filters = adapter.getState().state.filters;
            if (!filters) {
              wrong.push(`${column.id} ${type}: held, but not in the View State`);
              continue;
            }
            for (const p of leaves(filters)) {
              if (filterIssues(p, schema).length > 0) wrong.push(`${column.id} ${type}: read as a filter validation refuses`);
            }
            const view = { ...emptyViewState(schema.columns.map((c) => c.id)), filters };
            const want = applyView(rows, view, schema).rows.map((r) => r[id]);
            const got = shown(api, id);
            if (JSON.stringify([...want].sort()) !== JSON.stringify([...got].sort())) {
              wrong.push(`${column.id} ${type}: the grid shows ${got.length} rows, the View State means ${want.length}`);
            }
          }
          expect(held, `${column.id} (${column.kind})`).toEqual(OFFERED[column.kind]);
        }
        api.setFilterModel(null);
        expect(wrong).toEqual([]);
      });
    }
  }
});

// The examples' column definitions (examples/ag-grid/src/App.tsx): Registration type and Custodian show each value's
// label through a valueFormatter, so a User types the label they see.
const LABELS: Record<string, string> = {
  taxable: "Taxable",
  ira: "IRA",
  roth_ira: "Roth IRA",
  trust: "Trust",
  northgate: "Northgate",
  harborline: "Harborline",
  summit_trust: "Summit Trust",
};
const label = ({ value }: { value?: unknown }) => LABELS[String(value)] ?? String(value ?? "");
const accounts = generateAccounts();
const exampleDefs = [
  { field: "account_number", headerName: "Account number" },
  { field: "household", headerName: "Household" },
  { field: "advisor_name", headerName: "Advisor" },
  { field: "registration_type", headerName: "Registration type", valueFormatter: label },
  { field: "custodian", headerName: "Custodian", valueFormatter: label },
  { field: "market_value", headerName: "Market value", cellDataType: "number" },
  { field: "concentration", headerName: "Concentration", cellDataType: "number" },
  { field: "unrealized_gain", headerName: "Unrealized gain", cellDataType: "number" },
  { field: "has_restricted_holding", headerName: "Restricted holdings", cellDataType: "boolean" },
  { field: "tax_id", headerName: "Tax ID", hide: true },
];
const exampleGrid = (major: Major = latest) => {
  const schema = schemaFromAgGrid(exampleDefs, { ...wealthSchemaOptions, sampleRows: accounts.map((r) => ({ ...r })) });
  const api = major.createGrid({ columnDefs: gridcueColumnDefs(schema, exampleDefs), rowData: accounts });
  return { schema, api, adapter: createAgGridAdapter({ schema, api }) };
};
const ids = (keep: (row: (typeof accounts)[number]) => boolean) => accounts.filter(keep).map((r) => r.account_number);

describe("an enum column whose cells show labels: the User types the label they see", () => {
  for (const major of MAJORS) {
    it(`AG Grid ${major.version}: “Northgate” in the menu means the value northgate, in the grid and the View State`, () => {
      const { api, adapter } = exampleGrid(major);
      const northgate = ids((r) => r.custodian === "northgate");
      expect(northgate.length).toBeGreaterThan(0);
      for (const typed of ["Northgate", "northgate", "NORTHGATE"]) {
        api.setFilterModel({ custodian: { filterType: "text", type: "equals", filter: typed } });
        expect(shown(api, "account_number").sort(), typed).toEqual([...northgate].sort());
        expect(leaves(adapter.getState().state.filters)).toMatchObject([{ columnId: "custodian", operator: "eq", value: "northgate" }]);
        api.setFilterModel({ custodian: { filterType: "text", type: "notEqual", filter: typed } });
        expect(shown(api, "account_number").sort(), typed).toEqual(ids((r) => r.custodian !== "northgate").sort());
        expect(leaves(adapter.getState().state.filters)).toMatchObject([{ columnId: "custodian", operator: "neq", value: "northgate" }]);
      }
      api.setFilterModel({
        registration_type: {
          filterType: "text",
          operator: "OR",
          conditions: [
            { filterType: "text", type: "equals", filter: "Roth IRA" },
            { filterType: "text", type: "equals", filter: "IRA" },
          ],
        },
      });
      expect(shown(api, "account_number").sort()).toEqual(
        ids((r) => r.registration_type === "roth_ira" || r.registration_type === "ira").sort(),
      );
      expect(leaves(adapter.getState().state.filters)).toMatchObject([
        { columnId: "registration_type", operator: "in", value: ["roth_ira", "ira"] },
      ]);
    });
  }

  it("reads a label as its value, and text that names no value as nothing", () => {
    const custodian = WEALTH.columns.find((c) => c.id === "custodian") as ColumnDescriptor;
    expect(readColumnModel({ filterType: "text", type: "equals", filter: "Summit Trust" }, custodian)).toMatchObject([
      { operator: "eq", value: "summit_trust" },
    ]);
    expect(readColumnModel({ filterType: "text", type: "equals", filter: "North" }, custodian)).toBeUndefined();
  });

  it("“Custodian not equal Northgate” set in the menu as the cell shows it, then “clear the filters”: the Preview names it, and the grid clears", async () => {
    const { schema, api, adapter } = exampleGrid();
    api.setFilterModel({ custodian: { filterType: "text", type: "notEqual", filter: "Northgate" } });
    const controller = createGridCue({ schema, adapter, provider: createMockProvider(wealthMockOptions) });
    await controller.propose("clear the filters");
    expect(controller.getState().preview?.lines).toEqual(["Remove the filter Custodian to exclude Northgate"]);
    expect(await controller.apply()).toBe(true);
    expect(api.getFilterModel()).toEqual({});
    expect(shown(api, "account_number")).toHaveLength(accounts.length);
  });

  it("a label that names no value stays the Host's: GridCue leaves it out of the View State and never reads it as a value", () => {
    const { api, adapter } = exampleGrid();
    api.setFilterModel({ custodian: { filterType: "text", type: "equals", filter: "North" } });
    expect(Object.hasOwn(api.getFilterModel(), "custodian")).toBe(true);
    expect(adapter.getState().state.filters).toBeNull();
  });
});
