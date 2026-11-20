// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { generateLedger, ledgerColumns, ledgerSchemaOptions } from "../../../fixtures/ledger/src/index";
import { generateAccounts, wealthColumns, wealthSchemaOptions } from "../../../fixtures/wealth/src/index";
import { createAgGridAdapter, gridcueColumnDefs } from "../src/ag-grid";
import { emptyViewState, type FilterGroup, type FilterPredicate, type ViewSchema } from "../src/core/protocol";
import { applyView } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { filterIssues } from "../src/core/validate";
import { columnDefsFor, MAJORS, shown, tick } from "./ag-grid-grids";

// The held-out menu models (plan Task 6.5): 60 filter models a User can set in AG Grid's menu, labelled by hand from
// AG Grid's documented models and spec 4.1 and 5.6 before the reader was read, and run once through the built adapter
// on AG Grid 34, 35 and 36. They stay as a regression set. Each model is set with `setFilterModel` on a grid using
// `gridcueColumnDefs`, on the wealth or ledger fixture's rows with every empty form added, and read with the adapter.
//
// The labels name AG Grid's own option keys. `gridcueColumnDefs` lists custom options in place of AG Grid's comparisons,
// "In range", "Blank" and "Not blank" on number and date filters, so AG Grid drops a model that names one of those:
// each such model runs twice, as labelled (the grid holds nothing) and with the adapter's key (read as labelled).
//
// What every run checks:
// - A filter the adapter reads keeps exactly the rows the grid shows, and validation takes it.
// - A model the grid drops reads as no filter, and the grid shows every row.
// - An "unreadable" label is never read as a filter, except where noted below.
// - A readable label is read as labelled.
//
// Where the run and a label part (named, not changed):
// - held-27, a number model on the text column Owner, is labelled unreadable. AG Grid 36 holds it as the text model
//   the menu sets, `equals "5"`, and the adapter reads that as the menu's own (see ag-grid-read.test.ts); the rows
//   agree. 34 and 35 keep the number as the operand, and it stays the Host's.
// - held-29, AG Grid's "empty" option, is labelled no filters. Every tested major drops the model: no filter either way.
// - held-24, Category `equals "Fees"`, is labelled unreadable: "Fees" is no value's ID. It is the label of fees, which
//   the cell often shows, so the matcher and the reader both take it as fees (review fix, after the run); the rows
//   agree on every major.

type Bare = { columnId: string; operator: FilterPredicate["operator"]; value?: FilterPredicate["value"] };
type Label = "unreadable" | { predicates: Bare[] } | { group: { combinator: "or"; children: Bare[] } };
interface HeldOut {
  id: string;
  columnId: string;
  model: Record<string, unknown>;
  label: Label;
}

const HELD_OUT: HeldOut[] = [
  {
    id: "held-01",
    columnId: "entry_number",
    model: { filterType: "text", type: "contains", filter: "INV-" },
    label: { predicates: [{ columnId: "entry_number", operator: "contains", value: "INV-" }] },
  },
  { id: "held-02", columnId: "household", model: { filterType: "text", type: "notContains", filter: "Estate" }, label: "unreadable" },
  {
    id: "held-03",
    columnId: "account_number",
    model: { filterType: "text", type: "equals", filter: "A-1001" },
    label: { predicates: [{ columnId: "account_number", operator: "eq", value: "A-1001" }] },
  },
  {
    id: "held-04",
    columnId: "owner",
    model: { filterType: "text", type: "notEqual", filter: "Dana Wu" },
    label: { predicates: [{ columnId: "owner", operator: "neq", value: "Dana Wu" }] },
  },
  {
    id: "held-05",
    columnId: "account_number",
    model: { filterType: "text", type: "startsWith", filter: "A-10" },
    label: { predicates: [{ columnId: "account_number", operator: "startsWith", value: "A-10" }] },
  },
  { id: "held-06", columnId: "household", model: { filterType: "text", type: "endsWith", filter: "Family" }, label: "unreadable" },
  { id: "held-07", columnId: "owner", model: { filterType: "text", type: "blank" }, label: "unreadable" },
  { id: "held-08", columnId: "household", model: { filterType: "text", type: "notBlank" }, label: "unreadable" },
  {
    id: "held-09",
    columnId: "household",
    model: { filterType: "text", type: "gridcueIsEmpty" },
    label: { predicates: [{ columnId: "household", operator: "isEmpty" }] },
  },
  {
    id: "held-10",
    columnId: "household",
    model: { filterType: "text", type: "gridcueIsNotEmpty" },
    label: { predicates: [{ columnId: "household", operator: "isNotEmpty" }] },
  },
  {
    id: "held-11",
    columnId: "owner",
    model: {
      filterType: "text",
      operator: "AND",
      conditions: [
        { filterType: "text", type: "startsWith", filter: "J" },
        { filterType: "text", type: "notEqual", filter: "Jo" },
      ],
    },
    label: {
      predicates: [
        { columnId: "owner", operator: "startsWith", value: "J" },
        { columnId: "owner", operator: "neq", value: "Jo" },
      ],
    },
  },
  {
    id: "held-12",
    columnId: "owner",
    model: {
      filterType: "text",
      operator: "OR",
      conditions: [
        { filterType: "text", type: "contains", filter: "smith" },
        { filterType: "text", type: "contains", filter: "jones" },
      ],
    },
    label: {
      group: {
        combinator: "or",
        children: [
          { columnId: "owner", operator: "contains", value: "smith" },
          { columnId: "owner", operator: "contains", value: "jones" },
        ],
      },
    },
  },
  {
    id: "held-13",
    columnId: "category",
    model: {
      filterType: "text",
      operator: "OR",
      conditions: [
        { filterType: "text", type: "equals", filter: "fees" },
        { filterType: "text", type: "equals", filter: "travel" },
      ],
    },
    label: { predicates: [{ columnId: "category", operator: "in", value: ["fees", "travel"] }] },
  },
  {
    id: "held-14",
    columnId: "custodian",
    model: { filterType: "text", type: "equals", filter: "northgate" },
    label: { predicates: [{ columnId: "custodian", operator: "eq", value: "northgate" }] },
  },
  {
    id: "held-15",
    columnId: "custodian",
    model: { filterType: "text", type: "notEqual", filter: "summit_trust" },
    label: { predicates: [{ columnId: "custodian", operator: "neq", value: "summit_trust" }] },
  },
  {
    id: "held-16",
    columnId: "registration_type",
    model: {
      filterType: "text",
      operator: "OR",
      conditions: [
        { filterType: "text", type: "equals", filter: "taxable" },
        { filterType: "text", type: "equals", filter: "ira" },
        { filterType: "text", type: "equals", filter: "roth_ira" },
        { filterType: "text", type: "equals", filter: "trust" },
      ],
    },
    label: { predicates: [{ columnId: "registration_type", operator: "in", value: ["taxable", "ira", "roth_ira", "trust"] }] },
  },
  {
    id: "held-17",
    columnId: "custodian",
    model: {
      filterType: "text",
      operator: "OR",
      conditions: [
        { filterType: "text", type: "equals", filter: "northgate" },
        { filterType: "text", type: "notEqual", filter: "harborline" },
      ],
    },
    label: {
      group: {
        combinator: "or",
        children: [
          { columnId: "custodian", operator: "eq", value: "northgate" },
          { columnId: "custodian", operator: "neq", value: "harborline" },
        ],
      },
    },
  },
  {
    id: "held-20",
    columnId: "owner",
    model: {
      filterType: "text",
      operator: "OR",
      conditions: [
        { filterType: "text", type: "notEqual", filter: "Ann" },
        { filterType: "text", type: "notEqual", filter: "Bo" },
      ],
    },
    label: {
      group: {
        combinator: "or",
        children: [
          { columnId: "owner", operator: "neq", value: "Ann" },
          { columnId: "owner", operator: "neq", value: "Bo" },
        ],
      },
    },
  },
  { id: "held-21", columnId: "counterparty", model: { filterType: "text", type: "equals", filter: "" }, label: "unreadable" },
  { id: "held-22", columnId: "counterparty", model: { filterType: "text", type: "contains", filter: "" }, label: "unreadable" },
  { id: "held-23", columnId: "category", model: { filterType: "text", type: "startsWith", filter: "t" }, label: "unreadable" },
  { id: "held-24", columnId: "category", model: { filterType: "text", type: "equals", filter: "Fees" }, label: "unreadable" },
  { id: "held-25", columnId: "tax_id", model: { filterType: "text", type: "contains", filter: "123" }, label: "unreadable" },
  { id: "held-26", columnId: "not_a_column", model: { filterType: "text", type: "equals", filter: "x" }, label: "unreadable" },
  { id: "held-27", columnId: "owner", model: { filterType: "number", type: "equals", filter: 5 }, label: "unreadable" },
  { id: "held-28", columnId: "owner", model: { filterType: "text", type: "equals" }, label: "unreadable" },
  { id: "held-29", columnId: "owner", model: { filterType: "text", type: "empty" }, label: { predicates: [] } },
  {
    id: "held-30",
    columnId: "owner",
    model: {
      filterType: "text",
      operator: "OR",
      conditions: [
        { filterType: "text", type: "equals", filter: "Ann" },
        { filterType: "text", type: "blank" },
      ],
    },
    label: "unreadable",
  },
  {
    id: "held-31",
    columnId: "household",
    model: {
      filterType: "text",
      operator: "AND",
      conditions: [
        { filterType: "text", type: "contains", filter: "trust" },
        { filterType: "text", type: "endsWith", filter: "LLC" },
      ],
    },
    label: "unreadable",
  },
  {
    id: "held-32",
    columnId: "amount",
    model: { filterType: "number", type: "equals", filter: 0 },
    label: { predicates: [{ columnId: "amount", operator: "eq", value: 0 }] },
  },
  {
    id: "held-33",
    columnId: "amount",
    model: { filterType: "number", type: "notEqual", filter: 250.5 },
    label: { predicates: [{ columnId: "amount", operator: "neq", value: 250.5 }] },
  },
  {
    id: "held-34",
    columnId: "rate",
    model: { filterType: "number", type: "greaterThan", filter: 0.05 },
    label: { predicates: [{ columnId: "rate", operator: "gt", value: 0.05 }] },
  },
  {
    id: "held-35",
    columnId: "rate",
    model: { filterType: "number", type: "lessThanOrEqual", filter: 0.2 },
    label: { predicates: [{ columnId: "rate", operator: "lte", value: 0.2 }] },
  },
  {
    id: "held-36",
    columnId: "units",
    model: { filterType: "number", type: "lessThan", filter: 10 },
    label: { predicates: [{ columnId: "units", operator: "lt", value: 10 }] },
  },
  {
    id: "held-37",
    columnId: "units",
    model: { filterType: "number", type: "greaterThanOrEqual", filter: 3 },
    label: { predicates: [{ columnId: "units", operator: "gte", value: 3 }] },
  },
  {
    id: "held-38",
    columnId: "unrealized_gain",
    model: { filterType: "number", type: "inRange", filter: -500000, filterTo: 500000 },
    label: { predicates: [{ columnId: "unrealized_gain", operator: "between", value: { min: -500000, max: 500000 } }] },
  },
  {
    id: "held-39",
    columnId: "amount",
    model: { filterType: "number", type: "blank" },
    label: { predicates: [{ columnId: "amount", operator: "isEmpty" }] },
  },
  {
    id: "held-40",
    columnId: "amount",
    model: { filterType: "number", type: "notBlank" },
    label: { predicates: [{ columnId: "amount", operator: "isNotEmpty" }] },
  },
  {
    id: "held-41",
    columnId: "units",
    model: {
      filterType: "number",
      operator: "AND",
      conditions: [
        { filterType: "number", type: "greaterThanOrEqual", filter: 1 },
        { filterType: "number", type: "lessThanOrEqual", filter: 100 },
      ],
    },
    label: {
      predicates: [
        { columnId: "units", operator: "gte", value: 1 },
        { columnId: "units", operator: "lte", value: 100 },
      ],
    },
  },
  {
    id: "held-43",
    columnId: "amount",
    model: {
      filterType: "number",
      operator: "OR",
      conditions: [
        { filterType: "number", type: "lessThan", filter: 0 },
        { filterType: "number", type: "inRange", filter: 100, filterTo: 200 },
      ],
    },
    label: {
      group: {
        combinator: "or",
        children: [
          { columnId: "amount", operator: "lt", value: 0 },
          { columnId: "amount", operator: "between", value: { min: 100, max: 200 } },
        ],
      },
    },
  },
  {
    id: "held-44",
    columnId: "market_value",
    model: { filterType: "number", type: "gridcueIsEmpty" },
    label: { predicates: [{ columnId: "market_value", operator: "isEmpty" }] },
  },
  { id: "held-45", columnId: "units", model: { filterType: "number", type: "inRange", filter: 5 }, label: "unreadable" },
  { id: "held-46", columnId: "units", model: { filterType: "number", type: "equals" }, label: "unreadable" },
  { id: "held-47", columnId: "units", model: { filterType: "number", type: "contains", filter: 5 }, label: "unreadable" },
  {
    id: "held-49",
    columnId: "amount",
    model: {
      filterType: "number",
      operator: "AND",
      conditions: [
        { filterType: "number", type: "greaterThan", filter: 100 },
        { filterType: "number", type: "blank" },
      ],
    },
    label: {
      predicates: [
        { columnId: "amount", operator: "gt", value: 100 },
        { columnId: "amount", operator: "isEmpty" },
      ],
    },
  },
  {
    id: "held-50",
    columnId: "posted_at",
    model: { filterType: "date", type: "equals", dateFrom: "2026-05-20 00:00:00" },
    label: { predicates: [{ columnId: "posted_at", operator: "eq", value: "2026-05-20" }] },
  },
  {
    id: "held-51",
    columnId: "posted_at",
    model: { filterType: "date", type: "lessThan", dateFrom: "2026-05-20 00:00:00" },
    label: { predicates: [{ columnId: "posted_at", operator: "lt", value: "2026-05-20" }] },
  },
  {
    id: "held-52",
    columnId: "posted_at",
    model: { filterType: "date", type: "greaterThan", dateFrom: "2026-05-20 00:00:00" },
    label: { predicates: [{ columnId: "posted_at", operator: "gt", value: "2026-05-20" }] },
  },
  {
    id: "held-53",
    columnId: "posted_at",
    model: { filterType: "date", type: "inRange", dateFrom: "2026-04-01 00:00:00", dateTo: "2026-06-30 00:00:00" },
    label: { predicates: [{ columnId: "posted_at", operator: "between", value: { min: "2026-04-01", max: "2026-06-30" } }] },
  },
  {
    id: "held-54",
    columnId: "posted_at",
    model: { filterType: "date", type: "blank" },
    label: { predicates: [{ columnId: "posted_at", operator: "isEmpty" }] },
  },
  {
    id: "held-55",
    columnId: "posted_at",
    model: { filterType: "date", type: "notBlank" },
    label: { predicates: [{ columnId: "posted_at", operator: "isNotEmpty" }] },
  },
  {
    id: "held-56",
    columnId: "posted_at",
    model: { filterType: "date", type: "notEqual", dateFrom: "2026-05-20 00:00:00" },
    label: "unreadable",
  },
  {
    id: "held-57",
    columnId: "booked",
    model: { filterType: "date", type: "lessThanOrEqual", dateFrom: "2026-02-28 00:00:00" },
    label: { predicates: [{ columnId: "booked", operator: "lte", value: "2026-02-28" }] },
  },
  {
    id: "held-58",
    columnId: "booked",
    model: { filterType: "date", type: "equals", dateFrom: "2026-05-20 15:30:00" },
    label: "unreadable",
  },
  { id: "held-59", columnId: "booked", model: { filterType: "date", type: "equals" }, label: "unreadable" },
  {
    id: "held-60",
    columnId: "booked",
    model: { filterType: "date", type: "inRange", dateFrom: "2026-01-01 00:00:00" },
    label: "unreadable",
  },
  {
    id: "held-61",
    columnId: "booked",
    model: {
      filterType: "date",
      operator: "AND",
      conditions: [
        { filterType: "date", type: "greaterThan", dateFrom: "2026-01-01 00:00:00" },
        { filterType: "date", type: "lessThan", dateFrom: "2026-02-01 00:00:00" },
      ],
    },
    label: {
      predicates: [
        { columnId: "booked", operator: "gt", value: "2026-01-01" },
        { columnId: "booked", operator: "lt", value: "2026-02-01" },
      ],
    },
  },
  {
    id: "held-62",
    columnId: "booked",
    model: {
      filterType: "date",
      operator: "OR",
      conditions: [
        { filterType: "date", type: "equals", dateFrom: "2026-01-01 00:00:00" },
        { filterType: "date", type: "equals", dateFrom: "2026-01-02 00:00:00" },
      ],
    },
    label: {
      group: {
        combinator: "or",
        children: [
          { columnId: "booked", operator: "eq", value: "2026-01-01" },
          { columnId: "booked", operator: "eq", value: "2026-01-02" },
        ],
      },
    },
  },
  {
    id: "held-64",
    columnId: "booked",
    model: {
      filterType: "date",
      operator: "OR",
      conditions: [
        { filterType: "date", type: "blank" },
        { filterType: "date", type: "lessThan", dateFrom: "2026-01-01 00:00:00" },
      ],
    },
    label: {
      group: {
        combinator: "or",
        children: [
          { columnId: "booked", operator: "isEmpty" },
          { columnId: "booked", operator: "lt", value: "2026-01-01" },
        ],
      },
    },
  },
  { id: "held-65", columnId: "booked", model: { filterType: "text", type: "contains", filter: "2026" }, label: "unreadable" },
];

/** Where a label and the run part on one major: what the adapter reads there instead. */
const PARTS: Record<string, { majors: string[]; reads: Label }> = {
  "held-27": { majors: ["36"], reads: { predicates: [{ columnId: "owner", operator: "eq", value: "5" }] } },
  "held-24": { majors: ["34", "35", "36"], reads: { predicates: [{ columnId: "category", operator: "eq", value: "fees" }] } },
};

const WEALTH = defineSchema(wealthColumns, wealthSchemaOptions);
const LEDGER = defineSchema(ledgerColumns, ledgerSchemaOptions);
type Row = Record<string, unknown>;

/** The fixture's rows, and a row for every empty form in every column. */
const withEdges = (schema: ViewSchema, rows: Row[], id: string): Row[] => {
  const [first] = rows;
  const out = [...rows];
  let n = 0;
  for (const c of schema.columns) {
    if (c.id === id) continue;
    const forms: unknown[] = [null, undefined, ""];
    if (c.kind === "string" || c.kind === "enum") forms.push("   ");
    for (const v of forms) {
      const r: Row = { ...first, [id]: `EDGE-${++n}` };
      if (v === undefined) delete r[c.id];
      else r[c.id] = v;
      out.push(r);
    }
  }
  return out;
};
const SUBJECTS = [
  { schema: WEALTH, id: "account_number", rows: withEdges(WEALTH, generateAccounts() as unknown as Row[], "account_number") },
  { schema: LEDGER, id: "entry_number", rows: withEdges(LEDGER, generateLedger() as unknown as Row[], "entry_number") },
];
/** A column outside both schemas (held-26) runs on the ledger. */
const subjectOf = (columnId: string) =>
  SUBJECTS.find((s) => s.schema.columns.some((c) => c.id === columnId)) ?? (SUBJECTS[1] as (typeof SUBJECTS)[1]);

/** AG Grid's own number and date options, and the custom option `gridcueColumnDefs` lists in each one's place. */
const ADAPTER_KEY: Record<string, string> = {
  lessThan: "gridcueLessThan",
  lessThanOrEqual: "gridcueLessThanOrEqual",
  greaterThan: "gridcueGreaterThan",
  greaterThanOrEqual: "gridcueGreaterThanOrEqual",
  inRange: "gridcueBetween",
  blank: "gridcueIsEmpty",
  notBlank: "gridcueIsNotEmpty",
};
/** The model with the adapter's keys, or the very model when it names none of AG Grid's replaced options. */
const withAdapterKeys = (model: Record<string, unknown>): Record<string, unknown> => {
  if (model.filterType !== "number" && model.filterType !== "date") return model;
  const replaced = (c: Record<string, unknown>) => typeof c.type === "string" && Object.hasOwn(ADAPTER_KEY, c.type);
  const one = (c: Record<string, unknown>) => (replaced(c) ? { ...c, type: ADAPTER_KEY[c.type as string] } : c);
  if (!Array.isArray(model.conditions)) return one(model);
  const conditions = model.conditions as Array<Record<string, unknown>>;
  return conditions.some(replaced) ? { ...model, conditions: conditions.map(one) } : model;
};

const bare = (p: FilterPredicate | FilterGroup): Bare => {
  if (p.type !== "predicate") throw new Error("a group inside a group");
  return { columnId: p.columnId, operator: p.operator, ...(p.value === undefined ? {} : { value: p.value }) };
};
/** The adapter's filters in a label's shape: none is no predicates. */
const asLabel = (filters: FilterGroup | null): Label => {
  const children = filters?.children ?? [];
  const [only] = children;
  if (children.length === 1 && only?.type === "group") return { group: { combinator: "or", children: only.children.map(bare) } };
  return { predicates: children.map(bare) };
};
const leaves = (group: FilterGroup | null): FilterPredicate[] =>
  (group?.children ?? []).flatMap((c) => (c.type === "group" ? leaves(c) : [c]));

/** One model through one grid: what the grid holds, what the adapter reads, and the checks every run makes. */
const run = async (major: (typeof MAJORS)[number], columnId: string, model: Record<string, unknown>) => {
  const s = subjectOf(columnId);
  const api = major.createGrid({ columnDefs: gridcueColumnDefs(s.schema, columnDefsFor(s.schema)), rowData: s.rows });
  const adapter = createAgGridAdapter({ schema: s.schema, api });
  api.setFilterModel({ [columnId]: model });
  const held = api.getFilterModel()[columnId];
  const filters = adapter.getState().state.filters;
  const gridRows = shown(api, s.id);
  if (held === undefined) {
    expect(filters).toBeNull();
    expect(gridRows).toHaveLength(s.rows.length);
  }
  if (filters) {
    const view = { ...emptyViewState(s.schema.columns.map((c) => c.id)), filters };
    expect(applyView(s.rows, view, s.schema).rows.map((r) => (r as Row)[s.id])).toEqual(gridRows);
    for (const p of leaves(filters)) expect(filterIssues(p, s.schema), JSON.stringify(p)).toEqual([]);
  }
  api.destroy();
  await tick(0);
  return { held, reading: filters ? asLabel(filters) : undefined };
};

describe("AG Grid adapter: the held-out menu models", () => {
  for (const major of MAJORS) {
    for (const entry of HELD_OUT) {
      it(`AG Grid ${major.version}: ${entry.id}, ${entry.columnId}`, async () => {
        const part = PARTS[entry.id]?.majors.includes(major.version) ? PARTS[entry.id] : undefined;
        const label = part ? part.reads : entry.label;
        const model = withAdapterKeys(entry.model);
        if (model !== entry.model) {
          // As labelled, with AG Grid's own key: the column doesn't list it, so the grid holds nothing.
          expect(await run(major, entry.columnId, entry.model)).toEqual({ held: undefined, reading: undefined });
        }
        const { held, reading } = await run(major, entry.columnId, model);
        if (label === "unreadable") {
          expect(reading).toBeUndefined();
          return;
        }
        // Dropped: no filter, which is the reading of a label with no predicates.
        if (held === undefined) expect(label).toEqual({ predicates: [] });
        else expect(reading).toEqual(label);
      });
    }
  }
});
