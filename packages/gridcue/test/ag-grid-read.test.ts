// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { ledgerColumns, ledgerSchemaOptions } from "../../../fixtures/ledger/src/index";
import { wealthColumns, wealthSchemaOptions } from "../../../fixtures/wealth/src/index";
import { createAgGridAdapter, gridcueColumnDefs } from "../src/ag-grid";
import { optionKeysFor } from "../src/ag-grid/meanings";
import { readColumnModel, readFilterModel } from "../src/ag-grid/read";
import { createGridCue } from "../src/core/controller";
import {
  type ColumnDescriptor,
  emptyViewState,
  type FilterGroup,
  type FilterPredicate,
  type ViewOperation,
  type ViewPlan,
  type ViewSchema,
} from "../src/core/protocol";
import { applyView } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { filterIssues, validatePlan } from "../src/core/validate";
import { createMockProvider } from "../src/mock";
import { columnDefsFor, latest, MAJORS, type Major, shown, tick } from "./ag-grid-grids";

// Reading back (more grids spec, 5.6): a filter the User sets in AG Grid's menu is read into the View State; a filter
// GridCue can't read stays the Host's. In jsdom a menu change is the filter model the menu would set, set through the
// grid's own api: the menu itself is checked in the examples, in a browser.

const WEALTH = defineSchema(wealthColumns, wealthSchemaOptions);
const LEDGER = defineSchema(ledgerColumns, ledgerSchemaOptions);
const columnOf = (id: string): [ColumnDescriptor, ViewSchema] => {
  for (const schema of [WEALTH, LEDGER]) {
    const column = schema.columns.find((c) => c.id === id);
    if (column) return [column, schema];
  }
  throw new Error(`no column ${id}`);
};

type Bare = { operator: FilterPredicate["operator"]; value?: FilterPredicate["value"] };
type Expected = "unreadable" | { and: Bare[] } | { or: Bare[] };

const bare = (p: FilterPredicate | FilterGroup): Bare => {
  if (p.type !== "predicate") throw new Error("a group inside a group");
  return { operator: p.operator, ...(p.value === undefined ? {} : { value: p.value }) };
};
/** What one column's model reads as, without ids. */
const reading = (columnId: string, model: unknown): Expected => {
  const [column, schema] = columnOf(columnId);
  const children = readColumnModel(model, column);
  if (!children) return "unreadable";
  // Whatever is read is a filter validation takes, on its own column.
  const predicates = children.flatMap((c) => (c.type === "group" ? (c.children as FilterPredicate[]) : [c]));
  for (const p of predicates) {
    expect(p.columnId).toBe(columnId);
    expect(filterIssues(p, schema), JSON.stringify(p)).toEqual([]);
  }
  expect(new Set([...children, ...predicates].map((c) => c.id)).size).toBe(new Set([...children, ...predicates]).size);
  const [only] = children;
  if (children.length === 1 && only?.type === "group") {
    expect(only.combinator).toBe("or");
    return { or: only.children.map(bare) };
  }
  return { and: children.map(bare) };
};

const text = (type: string, filter?: string) => ({ filterType: "text", type, ...(filter === undefined ? {} : { filter }) });
const number = (type: string, filter?: number, filterTo?: number) => ({
  filterType: "number",
  type,
  ...(filter === undefined ? {} : { filter }),
  ...(filterTo === undefined ? {} : { filterTo }),
});
const date = (type: string, dateFrom?: string, dateTo?: string) => ({
  filterType: "date",
  type,
  ...(dateFrom === undefined ? {} : { dateFrom }),
  ...(dateTo === undefined ? {} : { dateTo }),
});
const joined = (operator: "AND" | "OR", ...conditions: Array<{ filterType: string }>) => ({
  filterType: conditions[0]?.filterType ?? "text",
  operator,
  conditions,
});

describe("the reader: one column's filter model as GridCue filters", () => {
  const cases: Array<[string, string, unknown, Expected]> = [
    // Text.
    ["contains", "owner", text("contains", "ann"), { and: [{ operator: "contains", value: "ann" }] }],
    ["equals", "owner", text("equals", "Ann Lee"), { and: [{ operator: "eq", value: "Ann Lee" }] }],
    ["not equal", "counterparty", text("notEqual", "Acme"), { and: [{ operator: "neq", value: "Acme" }] }],
    ["starts with", "counterparty", text("startsWith", "Bl"), { and: [{ operator: "startsWith", value: "Bl" }] }],
    ["is empty", "counterparty", text("gridcueIsEmpty"), { and: [{ operator: "isEmpty" }] }],
    ["is not empty", "counterparty", text("gridcueIsNotEmpty"), { and: [{ operator: "isNotEmpty" }] }],
    ["text kept as typed, spaces and case", "owner", text("equals", " ann  LEE "), { and: [{ operator: "eq", value: " ann  LEE " }] }],
    [
      "AND of two conditions",
      "household",
      joined("AND", text("contains", "trust"), text("notEqual", "Trust Fund")),
      {
        and: [
          { operator: "contains", value: "trust" },
          { operator: "neq", value: "Trust Fund" },
        ],
      },
    ],
    [
      "equals OR equals is a list",
      "owner",
      joined("OR", text("equals", "Ann Lee"), text("equals", "Bo Chen")),
      { and: [{ operator: "in", value: ["Ann Lee", "Bo Chen"] }] },
    ],
    [
      "three enum ids ORed are a list",
      "custodian",
      joined("OR", text("equals", "northgate"), text("equals", "harborline"), text("equals", "summit_trust")),
      { and: [{ operator: "in", value: ["northgate", "harborline", "summit_trust"] }] },
    ],
    ["an enum id", "registration_type", text("equals", "ira"), { and: [{ operator: "eq", value: "ira" }] }],
    ["an enum id, not equal", "custodian", text("notEqual", "northgate"), { and: [{ operator: "neq", value: "northgate" }] }],
    // A grid often shows an enum's label, so the User types it: the matcher reads it the same way.
    [
      "an enum label, in any case, is its value",
      "custodian",
      text("equals", "NorthGate"),
      { and: [{ operator: "eq", value: "northgate" }] },
    ],
    [
      "enum labels ORed are a list",
      "registration_type",
      joined("OR", text("equals", "Roth IRA"), text("equals", "taxable")),
      { and: [{ operator: "in", value: ["roth_ira", "taxable"] }] },
    ],
    [
      "OR of other options is a group",
      "advisor_name",
      joined("OR", text("contains", "ng"), text("startsWith", "Ma")),
      {
        or: [
          { operator: "contains", value: "ng" },
          { operator: "startsWith", value: "Ma" },
        ],
      },
    ],
    [
      "OR of equals and is empty is a group",
      "counterparty",
      joined("OR", text("equals", "Acme"), text("gridcueIsEmpty")),
      { or: [{ operator: "eq", value: "Acme" }, { operator: "isEmpty" }] },
    ],
    ["one condition in a joined model", "owner", joined("OR", text("equals", "Ann Lee")), { and: [{ operator: "eq", value: "Ann Lee" }] }],
    ["yes", "cleared", text("equals", "true"), { and: [{ operator: "eq", value: true }] }],
    ["no", "has_restricted_holding", text("equals", "false"), { and: [{ operator: "eq", value: false }] }],
    // Number.
    ["number equals", "market_value", number("equals", 1_000_000), { and: [{ operator: "eq", value: 1_000_000 }] }],
    ["number not equal", "market_value", number("notEqual", 0), { and: [{ operator: "neq", value: 0 }] }],
    ["number greater than", "market_value", number("gridcueGreaterThan", 1_000_000), { and: [{ operator: "gt", value: 1_000_000 }] }],
    ["number at least", "market_value", number("gridcueGreaterThanOrEqual", 5), { and: [{ operator: "gte", value: 5 }] }],
    ["number less than", "market_value", number("gridcueLessThan", 250_000), { and: [{ operator: "lt", value: 250_000 }] }],
    ["number at most", "market_value", number("gridcueLessThanOrEqual", 250_000), { and: [{ operator: "lte", value: 250_000 }] }],
    [
      "number between",
      "market_value",
      number("gridcueBetween", 1_000_000, 5_000_000),
      { and: [{ operator: "between", value: { min: 1_000_000, max: 5_000_000 } }] },
    ],
    ["number is empty", "market_value", number("gridcueIsEmpty"), { and: [{ operator: "isEmpty" }] }],
    ["number is not empty", "market_value", number("gridcueIsNotEmpty"), { and: [{ operator: "isNotEmpty" }] }],
    [
      "number AND",
      "concentration",
      joined("AND", number("gridcueGreaterThan", 0.1), number("gridcueLessThan", 0.5)),
      {
        and: [
          { operator: "gt", value: 0.1 },
          { operator: "lt", value: 0.5 },
        ],
      },
    ],
    [
      "number OR",
      "amount",
      joined("OR", number("gridcueLessThan", 0), number("gridcueGreaterThan", 10_000)),
      {
        or: [
          { operator: "lt", value: 0 },
          { operator: "gt", value: 10_000 },
        ],
      },
    ],
    [
      "number equals OR equals is a group: a number column takes no list",
      "units",
      joined("OR", number("equals", 5), number("equals", 7)),
      {
        or: [
          { operator: "eq", value: 5 },
          { operator: "eq", value: 7 },
        ],
      },
    ],
    // Date.
    ["date equals", "booked", date("equals", "2026-01-10 00:00:00"), { and: [{ operator: "eq", value: "2026-01-10" }] }],
    ["date before", "booked", date("gridcueLessThan", "2026-01-10 00:00:00"), { and: [{ operator: "lt", value: "2026-01-10" }] }],
    ["date after", "booked", date("gridcueGreaterThan", "2026-01-10 00:00:00"), { and: [{ operator: "gt", value: "2026-01-10" }] }],
    [
      "date and time on or after: the whole day",
      "posted_at",
      date("gridcueGreaterThanOrEqual", "2026-03-01 00:00:00"),
      { and: [{ operator: "gte", value: "2026-03-01" }] },
    ],
    [
      "date between",
      "booked",
      date("gridcueBetween", "2026-01-10 00:00:00", "2026-01-15 00:00:00"),
      { and: [{ operator: "between", value: { min: "2026-01-10", max: "2026-01-15" } }] },
    ],
    ["date is empty", "booked", date("gridcueIsEmpty"), { and: [{ operator: "isEmpty" }] }],
    ["date is not empty", "booked", date("gridcueIsNotEmpty"), { and: [{ operator: "isNotEmpty" }] }],
    [
      "date AND",
      "booked",
      joined("AND", date("gridcueGreaterThanOrEqual", "2026-01-01 00:00:00"), date("gridcueLessThanOrEqual", "2026-06-30 00:00:00")),
      {
        and: [
          { operator: "gte", value: "2026-01-01" },
          { operator: "lte", value: "2026-06-30" },
        ],
      },
    ],
    [
      "date OR",
      "booked",
      joined("OR", date("gridcueLessThan", "2026-01-01 00:00:00"), date("gridcueGreaterThan", "2026-12-31 00:00:00")),
      {
        or: [
          { operator: "lt", value: "2026-01-01" },
          { operator: "gt", value: "2026-12-31" },
        ],
      },
    ],
    // AG Grid's "no filter" option.
    ["AG Grid's empty option is no filter", "owner", text("empty"), { and: [] }],

    // Unreadable: it stays the Host's.
    ["not contains: no such operator", "owner", text("notContains", "ann"), "unreadable"],
    ["ends with: no such operator", "counterparty", text("endsWith", "LLC"), "unreadable"],
    ["AG Grid's blank on text also matches whitespace", "counterparty", text("blank"), "unreadable"],
    ["AG Grid's not blank on text", "counterparty", text("notBlank"), "unreadable"],
    ["contains on an enum column", "category", text("contains", "fee"), "unreadable"],
    ["text that names no value of an enum", "custodian", text("equals", "North"), "unreadable"],
    ["text equal to empty text keeps only empty text, not missing cells", "owner", text("equals", ""), "unreadable"],
    ["text not equal to empty text", "owner", text("notEqual", ""), "unreadable"],
    ["contains empty text", "counterparty", text("contains", ""), "unreadable"],
    ["a text option with no text", "owner", text("equals"), "unreadable"],
    ["a comparison on a text column", "owner", text("gridcueLessThan", "m"), "unreadable"],
    ["yes/no equal to other text", "cleared", text("equals", "yes"), "unreadable"],
    ["yes/no with another option", "cleared", text("notEqual", "true"), "unreadable"],
    ["yes/no is empty: the kind takes only equals", "cleared", text("gridcueIsEmpty"), "unreadable"],
    [
      "one unreadable condition makes the column unreadable",
      "owner",
      joined("AND", text("contains", "a"), text("endsWith", "b")),
      "unreadable",
    ],
    ["a list beside an unreadable condition", "owner", joined("OR", text("equals", "a"), text("notContains", "b")), "unreadable"],
    // AG Grid's own number and date options aren't GridCue's on every major, so gridcueColumnDefs lists none of them.
    ["AG Grid's own less than, which reads empty text as 0 on 34 and 35", "market_value", number("lessThan", 5), "unreadable"],
    ["AG Grid's own range", "market_value", number("inRange", 1, 5), "unreadable"],
    ["AG Grid's own blank on a number", "market_value", number("blank"), "unreadable"],
    ["AG Grid's own blank on a date", "booked", date("blank"), "unreadable"],
    ["a number option with no number", "market_value", number("gridcueGreaterThan"), "unreadable"],
    ["a number that is not one", "market_value", { filterType: "number", type: "equals", filter: "12" }, "unreadable"],
    ["a range with one end", "market_value", number("gridcueBetween", 1), "unreadable"],
    ["a text option on a number column", "market_value", number("contains", 1), "unreadable"],
    ["date not equal: no such operator on a date", "booked", date("notEqual", "2026-01-10 00:00:00"), "unreadable"],
    ["a date with a time of day", "posted_at", date("equals", "2026-01-10 15:30:00"), "unreadable"],
    ["a date that is no date", "booked", date("equals", "2026-02-31 00:00:00"), "unreadable"],
    ["a date option with no date", "booked", date("gridcueLessThan"), "unreadable"],
    ["a date range with one end", "booked", date("gridcueBetween", "2026-01-10 00:00:00"), "unreadable"],
    ["another filter's model on a text column", "owner", number("equals", 5), "unreadable"],
    ["the Host's own model", "owner", { advisor: "Lee" }, "unreadable"],
    ["a set filter's model", "custodian", { filterType: "set", values: ["northgate"] }, "unreadable"],
    [
      "conditions joined the old way",
      "owner",
      { filterType: "text", operator: "AND", condition1: text("equals", "a"), condition2: text("equals", "b") },
      "unreadable",
    ],
    [
      "a join that is neither AND nor OR",
      "owner",
      { filterType: "text", operator: "XOR", conditions: [text("equals", "a")] },
      "unreadable",
    ],
    ["no conditions", "owner", { filterType: "text", operator: "AND", conditions: [] }, "unreadable"],
    ["a joined model inside a joined model", "owner", joined("AND", joined("OR", text("equals", "a"), text("equals", "b"))), "unreadable"],
    ["nothing", "owner", null, "unreadable"],
    ["text", "owner", "equals", "unreadable"],
  ];
  for (const [name, columnId, model, expected] of cases) {
    it(`${columnId}: ${name}`, () => {
      expect(reading(columnId, model)).toEqual(expected);
    });
  }

  it("reads nothing on a column GridCue may not filter: restricted, or without the filter capability", () => {
    const [restricted] = columnOf("tax_id");
    expect(readColumnModel(text("equals", "x"), restricted)).toBeUndefined();
    const [owner] = columnOf("owner");
    expect(readColumnModel(text("equals", "x"), { ...owner, capabilities: ["sort"] })).toBeUndefined();
  });

  it("reads only the operators the Host allows on the column", () => {
    const [owner] = columnOf("owner");
    const narrowed: ColumnDescriptor = { ...owner, allowedOperators: ["eq", "contains"] };
    expect(readColumnModel(text("contains", "a"), narrowed)).toHaveLength(1);
    expect(readColumnModel(text("startsWith", "a"), narrowed)).toBeUndefined();
    // With no list allowed, equals OR equals is a group of two.
    expect(readColumnModel(joined("OR", text("equals", "a"), text("equals", "b")), narrowed)).toMatchObject([
      { type: "group", combinator: "or" },
    ]);
    // With a list allowed and not equals, the menu's "Equals" reads as a list of one.
    const listOnly: ColumnDescriptor = { ...owner, allowedOperators: ["in"] };
    expect(readColumnModel(text("equals", "a"), listOnly)).toMatchObject([{ operator: "in", value: ["a"] }]);
    expect(readColumnModel(joined("OR", text("equals", "a"), text("equals", "b")), listOnly)).toMatchObject([
      { operator: "in", value: ["a", "b"] },
    ]);
  });

  it("each column's filter lists exactly the options the reader reads there", () => {
    const [owner] = columnOf("owner");
    const [custodian] = columnOf("custodian");
    const [cleared] = columnOf("cleared");
    const [booked] = columnOf("booked");
    expect(optionKeysFor(owner)).toEqual(["equals", "notEqual", "contains", "startsWith", "gridcueIsEmpty", "gridcueIsNotEmpty"]);
    expect(optionKeysFor(custodian)).toEqual(["equals", "notEqual", "gridcueIsEmpty", "gridcueIsNotEmpty"]);
    expect(optionKeysFor(cleared)).toEqual(["equals"]);
    expect(optionKeysFor(booked)).not.toContain("notEqual");
    expect(optionKeysFor({ ...owner, allowedOperators: ["eq", "contains"] })).toEqual(["equals", "contains"]);
    expect(optionKeysFor({ ...owner, allowedOperators: ["in"] })).toEqual(["equals"]);
  });

  it("reads a whole filter model: each readable column into one AND group, in the schema's column order, and names the rest", () => {
    const read = readFilterModel(
      {
        market_value: number("gridcueGreaterThan", 5),
        household: joined("OR", text("contains", "a"), text("startsWith", "b")),
        custodian: text("contains", "north"),
        not_a_column: text("equals", "x"),
      },
      WEALTH,
    );
    expect(read.unread.sort()).toEqual(["custodian", "not_a_column"]);
    expect(read.filters).toMatchObject({
      type: "group",
      combinator: "and",
      children: [
        { type: "group", combinator: "or", children: [{ columnId: "household" }, { columnId: "household" }] },
        { type: "predicate", columnId: "market_value", operator: "gt", value: 5 },
      ],
    });
    expect(readFilterModel({}, WEALTH)).toEqual({ filters: null, unread: [] });
    expect(readFilterModel({ custodian: text("contains", "north") }, WEALTH)).toEqual({ filters: null, unread: ["custodian"] });
  });
});

// --- Through the grid --------------------------------------------------------------------------------------------------

const rows = [
  { id: 1, owner: "Ann Lee", custodian: "northgate", value: 5, booked: "2026-01-10" },
  { id: 2, owner: "Bo Chen", custodian: "harborline", value: 20, booked: "2026-02-10" },
  { id: 3, owner: "ann lee", custodian: null, value: null, booked: null },
  { id: 4, owner: "Cy Diaz", custodian: "", value: 12, booked: "2026-03-10" },
];
const schema = defineSchema([{ id: "id" }, { id: "owner" }, { id: "custodian" }, { id: "value" }, { id: "booked" }], {
  columns: {
    id: { kind: "number", capabilities: ["sort", "show", "hide", "reorder"] },
    custodian: {
      kind: "enum",
      label: "Custodian",
      enumValues: [
        { id: "northgate", label: "Northgate" },
        { id: "harborline", label: "Harborline" },
      ],
    },
    value: { kind: "number" },
    booked: { kind: "date" },
  },
  calendar: { timeZone: "UTC" },
});
/** The Host's columns: Id, which GridCue doesn't filter, keeps a filter of the Host's own. */
const hostDefs = columnDefsFor(schema).map((d) => (d.field === "id" ? { ...d, filter: "agNumberColumnFilter" } : d));
const make = (major: Major = latest, before?: Record<string, unknown>) => {
  const api = major.createGrid({ columnDefs: gridcueColumnDefs(schema, hostDefs), rowData: rows });
  if (before) api.setFilterModel(before);
  return { api, adapter: createAgGridAdapter({ schema, api }) };
};
const apply = (adapter: ReturnType<typeof createAgGridAdapter>, operations: ViewOperation[]) => {
  const current = adapter.getState();
  const plan: ViewPlan = {
    protocolVersion: "0.1",
    id: `p_${Math.random()}`,
    baseRevision: current.revision,
    source: { channel: "api" },
    status: "ready",
    operations,
    evidence: [],
    clarifications: [],
    unsupportedSegments: [],
  };
  const result = validatePlan(plan, { schema, capabilities: adapter.getCapabilities(), current, defaultState: adapter.getDefaultState() });
  if (!result.ok) throw new Error(result.issues.map((i) => `${i.code}: ${i.message}`).join(", "));
  return adapter.apply(result.plan);
};
const add = (columnId: string, operator: FilterPredicate["operator"], value?: FilterPredicate["value"]): ViewOperation => ({
  type: "filter.add",
  combineWith: "and",
  predicate: { id: `f_${columnId}_${operator}`, type: "predicate", columnId, operator, ...(value === undefined ? {} : { value }) },
});
const leaves = (group: FilterGroup | null): FilterPredicate[] =>
  (group?.children ?? []).flatMap((c) => (c.type === "group" ? leaves(c) : [c]));

describe("AG Grid adapter: a filter set in AG Grid's menu is read into the View State", () => {
  for (const major of MAJORS) {
    it(`AG Grid ${major.version}: an AND, an OR, a list and a custom option, with the rows the grid shows`, () => {
      const { api, adapter } = make(major);
      const before = adapter.getState();
      expect(before.state.filters).toBeNull();
      api.setFilterModel({
        owner: joined("OR", text("equals", "ann lee"), text("equals", "Cy Diaz")),
        value: joined("AND", number("gridcueGreaterThan", 4), number("notEqual", 20)),
        booked: joined("OR", date("gridcueLessThan", "2026-02-01 00:00:00"), date("gridcueIsEmpty")),
      });
      const now = adapter.getState();
      expect(now.revision).not.toBe(before.revision);
      expect(now.state.filters).toMatchObject({
        type: "group",
        combinator: "and",
        children: [
          { type: "predicate", columnId: "owner", operator: "in", value: ["ann lee", "Cy Diaz"] },
          { type: "predicate", columnId: "value", operator: "gt", value: 4 },
          { type: "predicate", columnId: "value", operator: "neq", value: 20 },
          {
            type: "group",
            combinator: "or",
            children: [
              { columnId: "booked", operator: "lt", value: "2026-02-01" },
              { columnId: "booked", operator: "isEmpty" },
            ],
          },
        ],
      });
      // The grid's own rows are the rows that View State means: text ignores case, and the list is an OR.
      expect(shown(api, "id")).toEqual([1]);
      // Reading again changes nothing.
      expect(adapter.getState()).toEqual(now);
    });
  }

  it("tells subscribers a tick after the menu changes, with the filter read", async () => {
    const { api, adapter } = make();
    const heard: Array<FilterPredicate[]> = [];
    adapter.subscribe((s) => heard.push(leaves(s.state.filters)));
    api.setFilterModel({ custodian: text("notEqual", "northgate") });
    await tick();
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject([{ columnId: "custodian", operator: "neq", value: "northgate" }]);
  });

  it("“Custodian not equal Northgate” set in the menu, then “clear the filters”: the Preview names it, clearing removes it, undo puts it back", async () => {
    const { api, adapter } = make();
    const menu = { custodian: text("notEqual", "northgate") };
    api.setFilterModel(menu);
    // Empty cells stay, as on every other adapter (4.1).
    expect(shown(api, "id")).toEqual([2, 3, 4]);
    const controller = createGridCue({ schema, adapter, provider: createMockProvider() });
    await controller.propose("clear the filters");
    expect(controller.getState().preview?.lines).toEqual(["Remove the filter Custodian to exclude Northgate"]);
    expect(await controller.apply()).toBe(true);
    expect(api.getFilterModel()).toEqual({});
    expect(adapter.getState().state.filters).toBeNull();
    expect(await controller.undo()).toBe(true);
    expect(api.getFilterModel()).toEqual(menu);
    expect(leaves(adapter.getState().state.filters)).toMatchObject([{ columnId: "custodian", operator: "neq", value: "northgate" }]);
  });

  it("keeps a menu filter beside a GridCue filter on another column, and adds to one on its own column", async () => {
    const { api, adapter } = make();
    api.setFilterModel({ owner: text("contains", "lee") });
    expect((await apply(adapter, [add("value", "gte", 5)])).ok).toBe(true);
    expect(api.getFilterModel()).toEqual({ owner: text("contains", "lee"), value: number("gridcueGreaterThanOrEqual", 5) });
    expect(shown(api, "id")).toEqual([1]);
    expect((await apply(adapter, [add("owner", "startsWith", "ann")])).ok).toBe(true);
    expect(api.getFilterModel()).toMatchObject({ owner: joined("AND", text("contains", "lee"), text("startsWith", "ann")) });
    expect(leaves(adapter.getState().state.filters).map((p) => [p.columnId, p.operator])).toEqual([
      ["owner", "contains"],
      ["value", "gte"],
      ["owner", "startsWith"],
    ]);
  });

  it("reads a menu change to a filter GridCue wrote, in place of what it wrote", async () => {
    const { api, adapter } = make();
    expect((await apply(adapter, [add("value", "gt", 6), add("owner", "eq", "Bo Chen")])).ok).toBe(true);
    const revision = adapter.getState().revision;
    api.setFilterModel({ ...api.getFilterModel(), value: number("gridcueLessThan", 25) });
    const now = adapter.getState();
    expect(now.revision).not.toBe(revision);
    expect(leaves(now.state.filters)).toMatchObject([
      { id: "f_owner_eq", columnId: "owner", operator: "eq", value: "Bo Chen" },
      { columnId: "value", operator: "lt", value: 25 },
    ]);
    // And a filter the menu removes leaves the View State.
    api.setFilterModel({ value: number("gridcueLessThan", 25) });
    expect(leaves(adapter.getState().state.filters)).toMatchObject([{ columnId: "value", operator: "lt", value: 25 }]);
  });

  it("restoring a view from before a menu filter removes it: undo sees it", async () => {
    const { api, adapter } = make();
    const snapshot = adapter.getState();
    api.setFilterModel({ owner: text("contains", "lee") });
    expect(adapter.getState().state.filters).not.toBeNull();
    expect((await adapter.restore(snapshot)).ok).toBe(true);
    expect(api.getFilterModel()).toEqual({});
  });

  it("holds a filter that was in the grid before the adapter was made, and makes it part of the default state", () => {
    const { adapter } = make(latest, { value: number("gridcueGreaterThan", 6) });
    expect(leaves(adapter.getState().state.filters)).toMatchObject([{ columnId: "value", operator: "gt", value: 6 }]);
    expect(leaves(adapter.getDefaultState().filters)).toMatchObject([{ columnId: "value", operator: "gt", value: 6 }]);
  });
});

describe("AG Grid adapter: a filter GridCue can't read stays the Host's", () => {
  // Listed options with an operand that means no value of the column: empty text, which AG Grid's text filter keeps
  // only where a cell holds empty text, and text that names no value of an enum.
  const unreadable = { owner: text("equals", ""), custodian: text("equals", "north") };

  it("is left out of the View State, kept on every write, and blocks a GridCue filter on its column", async () => {
    const { api, adapter } = make(latest, unreadable);
    expect(api.getFilterModel()).toEqual(unreadable);
    expect(adapter.getState().state.filters).toBeNull();
    expect((await apply(adapter, [add("value", "gt", 1)])).ok).toBe(true);
    expect(api.getFilterModel()).toEqual({ ...unreadable, value: number("gridcueGreaterThan", 1) });
    expect(leaves(adapter.getState().state.filters).map((p) => p.columnId)).toEqual(["value"]);
    expect((await apply(adapter, [{ type: "filter.clear" }])).ok).toBe(true);
    expect(api.getFilterModel()).toEqual(unreadable);
    const before = adapter.getState();
    for (const blocked of [add("owner", "eq", "Bo Chen"), add("custodian", "eq", "northgate")]) {
      const result = await apply(adapter, [blocked, { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("ADAPTER_UNSUPPORTED_FILTER");
        expect(result.message).toContain("can't read");
      }
      expect(api.getFilterModel()).toEqual(unreadable);
      expect(adapter.getState()).toEqual(before);
    }
    expect((await adapter.restore(before)).ok).toBe(true);
    expect(api.getFilterModel()).toEqual(unreadable);
  });

  it("a menu change that makes GridCue's own filter unreadable takes it out of the View State and keeps the menu's", async () => {
    const { api, adapter } = make();
    expect((await apply(adapter, [add("owner", "eq", "Bo Chen"), add("value", "gt", 1)])).ok).toBe(true);
    api.setFilterModel({ ...api.getFilterModel(), owner: unreadable.owner });
    expect(leaves(adapter.getState().state.filters).map((p) => p.columnId)).toEqual(["value"]);
    expect((await apply(adapter, [{ type: "filter.clear" }])).ok).toBe(true);
    expect(api.getFilterModel()).toEqual({ owner: unreadable.owner });
  });

  it("a filter on a column the schema doesn't let GridCue filter is the Host's, whatever it holds", async () => {
    const { api, adapter } = make(latest, { id: number("equals", 2) });
    expect(adapter.getState().state.filters).toBeNull();
    expect((await apply(adapter, [add("value", "gt", 1)])).ok).toBe(true);
    expect(api.getFilterModel()).toMatchObject({ id: number("equals", 2) });
    expect(shown(api, "id")).toEqual([2]);
  });
});

// A model of another filter's type is one no menu sets: a number filter's model on a text column, say, which a Host's
// own code or a saved view can hand `setFilterModel`. AG Grid doesn't hold it as set. 34 and 35 relabel it with the
// column's filter type and keep the operand as it was; 36 also turns the operand into the column's own (5 into "5",
// "5" into 5), and drops a model it can't turn. The adapter never sees what was set, only what the grid holds, so on 36
// such a model reads as the menu's own would. That is right while the rows the reading means are the rows the grid
// shows, which is what this checks, for every crossing and major (the held-out menu models, on AG Grid 36).
describe("AG Grid adapter: a filter model set with another filter's type is read as the grid holds it", () => {
  const crossRows = [...rows, { id: 5, owner: "5", custodian: "harborline", value: 2026, booked: "2026-01-31" }];
  const everyRow = crossRows.map((r) => r.id);
  const grid = (major: Major) => {
    const api = major.createGrid({ columnDefs: gridcueColumnDefs(schema, columnDefsFor(schema)), rowData: crossRows });
    return { api, adapter: createAgGridAdapter({ schema, api }) };
  };
  const crossings: Array<[string, string, unknown]> = [
    ["a number model on a text column", "owner", number("equals", 5)],
    ["a number model with a text option on a text column", "owner", number("contains", 5)],
    ["a number comparison on a text column", "owner", number("gridcueGreaterThan", 5)],
    ["an OR of number conditions on a text column", "owner", joined("OR", number("equals", 5), number("equals", 6))],
    ["a number condition beside a text one on a text column", "owner", joined("OR", text("equals", "Bo Chen"), number("equals", 5))],
    ["a date model on a text column", "owner", date("equals", "2026-01-31 00:00:00")],
    ["a number model on an enum column", "custodian", number("equals", 5)],
    ["a text model on a number column", "value", text("equals", "5")],
    ["a text model that is no number on a number column", "value", text("equals", "abc")],
    ["a text option on a number column", "value", text("contains", "5")],
    ["a date model on a number column", "value", date("equals", "2026-01-31 00:00:00")],
    ["a text model on a date column", "booked", text("contains", "2026")],
    ["a text day on a date column", "booked", text("equals", "2026-01-31")],
    ["a number model on a date column", "booked", number("equals", 2026)],
  ];
  for (const major of MAJORS) {
    for (const [name, columnId, model] of crossings) {
      it(`AG Grid ${major.version}: ${name}`, async () => {
        const { api, adapter } = grid(major);
        api.setFilterModel({ [columnId]: model });
        const held = api.getFilterModel()[columnId];
        const filters = adapter.getState().state.filters;
        const gridRows = shown(api, "id");
        // What the adapter reads is what the reader makes of the model the grid holds, and nothing of the model set.
        const column = schema.columns.find((c) => c.id === columnId) as ColumnDescriptor;
        const read = held === undefined ? [] : (readColumnModel(held, column) ?? []);
        expect(filters?.children ?? []).toEqual(read);
        if (held === undefined) {
          // Dropped: the grid shows every row, and no filter is the right reading.
          expect(gridRows).toEqual(everyRow);
          return;
        }
        if (filters) {
          // Read: the rows the reading means are the rows the grid shows.
          const view = { ...emptyViewState(schema.columns.map((c) => c.id)), filters };
          expect(applyView(crossRows, view, schema).rows.map((r) => r.id)).toEqual(gridRows);
          for (const p of leaves(filters)) expect(filterIssues(p, schema), JSON.stringify(p)).toEqual([]);
          return;
        }
        // Not read: it is the Host's, kept on a write and blocking a GridCue filter on its column.
        const other = columnId === "value" ? add("owner", "contains", "e") : add("value", "gt", 1);
        expect((await apply(adapter, [other])).ok).toBe(true);
        expect(api.getFilterModel()).toMatchObject({ [columnId]: held });
        const blocked = await apply(adapter, [add(columnId, "isEmpty")]);
        expect(blocked).toMatchObject({ ok: false, code: "ADAPTER_UNSUPPORTED_FILTER" });
        expect(api.getFilterModel()).toMatchObject({ [columnId]: held });
      });
    }
  }

  it("AG Grid 36 turns a number model on a text column into the text model the menu sets, and it reads as that one does", () => {
    const menu = grid(latest);
    menu.api.setFilterModel({ owner: text("equals", "5") });
    const crossed = grid(latest);
    crossed.api.setFilterModel({ owner: number("equals", 5) });
    expect(crossed.api.getFilterModel()).toEqual(menu.api.getFilterModel());
    expect(leaves(crossed.adapter.getState().state.filters)).toMatchObject([{ columnId: "owner", operator: "eq", value: "5" }]);
    expect(shown(crossed.api, "id")).toEqual([5]);
    expect(crossed.adapter.getState().state).toEqual(menu.adapter.getState().state);
  });

  for (const major of MAJORS.slice(0, 2)) {
    it(`AG Grid ${major.version} keeps the number as the operand, which no text filter holds: it stays the Host's`, () => {
      const { api, adapter } = grid(major);
      api.setFilterModel({ owner: number("equals", 5) });
      expect(api.getFilterModel()).toEqual({ owner: { filterType: "text", type: "equals", filter: 5 } });
      expect(adapter.getState().state.filters).toBeNull();
    });
  }
});
