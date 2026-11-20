// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { ledgerColumns, ledgerSchemaOptions } from "../../../fixtures/ledger/src/index";
import { wealthColumns, wealthSchemaOptions } from "../../../fixtures/wealth/src/index";
import { createAgGridAdapter, gridcueColumnDefs } from "../src/ag-grid";
import { columnSettings, type GridcueFilterParams } from "../src/ag-grid/meanings";
import { matchesFilter, matchesPredicate } from "../src/core/evaluate";
import type { ColumnDescriptor, FilterPredicate, Scalar, ViewSchema } from "../src/core/protocol";
import { defineSchema } from "../src/core/schema";
import { columnDefsFor, latest, MAJORS, type Major, type RowModel, shown } from "./ag-grid-grids";
import { edgeRows, gridFor, predicatesOf, runRowCheck, viewWith } from "./ag-grid-row-check";

// GridCue's meanings in AG Grid's filters and sorts (more grids spec, 4.1 and 5.6): what `gridcueColumnDefs` sets, the
// row check that decided each setting, and the rows AG Grid 34, 35 and 36 then keep. Synthetic rows only.

const WEALTH = defineSchema(wealthColumns, wealthSchemaOptions);
const LEDGER = defineSchema(ledgerColumns, ledgerSchemaOptions);
const ledgerIn = (timeZone: string) => defineSchema(ledgerColumns, { ...ledgerSchemaOptions, calendar: { timeZone } });
const SUBJECTS = [
  { name: "wealth", schema: WEALTH, id: "account_number" },
  { name: "ledger", schema: LEDGER, id: "entry_number" },
];
const LONG = 240_000;

type Family = "text" | "enum" | "yes/no" | "number" | "date";
const familyOf = (kind: ColumnDescriptor["kind"]): Family => {
  if (kind === "string") return "text";
  if (kind === "enum") return "enum";
  if (kind === "boolean") return "yes/no";
  return kind === "date" || kind === "datetime" ? "date" : "number";
};
const filterTypeOf = (family: Family) => (family === "number" || family === "date" ? family : "text");

/** A few filters the Query Check doesn't make, on zero: where AG Grid 34 and 35 read an empty number cell as 0. */
const zeroFilters = (schema: ViewSchema): FilterPredicate[] =>
  schema.columns
    .filter((c) => familyOf(c.kind) === "number")
    .flatMap((c) =>
      (["eq", "neq", "lt", "lte", "gt", "gte"] as const).map((operator) => ({
        id: `zero_${c.id}_${operator}`,
        type: "predicate" as const,
        columnId: c.id,
        operator,
        value: 0,
      })),
    );

// --- gridcueColumnDefs -----------------------------------------------------------------------------------------------

/** The settings `gridcueColumnDefs` gives one column of a schema. */
const settingsFor = (schema: ViewSchema, columnId: string) =>
  columnSettings(schema)(schema.columns.find((c) => c.id === columnId) as ColumnDescriptor);
const paramsFor = (schema: ViewSchema, columnId: string) => settingsFor(schema, columnId).filterParams as GridcueFilterParams;
const keysOf = (schema: ViewSchema, columnId: string) =>
  paramsFor(schema, columnId).filterOptions.map((option) => (typeof option === "string" ? option : option.displayKey));

describe("gridcueColumnDefs", () => {
  it("lists every option GridCue writes on a column, once, and no option of AG Grid's that means something else", () => {
    expect(keysOf(WEALTH, "market_value")).toEqual([
      "equals",
      "notEqual",
      "gridcueLessThan",
      "gridcueLessThanOrEqual",
      "gridcueGreaterThan",
      "gridcueGreaterThanOrEqual",
      "gridcueBetween",
      "gridcueIsEmpty",
      "gridcueIsNotEmpty",
    ]);
    expect(keysOf(WEALTH, "household")).toEqual(["equals", "notEqual", "contains", "startsWith", "gridcueIsEmpty", "gridcueIsNotEmpty"]);
  });

  it("names each custom option as AG Grid names its own, with the inputs it takes", () => {
    const custom = paramsFor(WEALTH, "market_value").filterOptions.filter((option) => typeof option !== "string");
    expect(custom.map((o) => [o.displayName, o.numberOfInputs])).toEqual([
      ["Less than", 1],
      ["Less than or equal to", 1],
      ["Greater than", 1],
      ["Greater than or equal to", 1],
      ["Between", 2],
      ["Is empty", 0],
      ["Is not empty", 0],
    ]);
  });

  it("sets the text filter to exact case with GridCue's matcher, keeps empty cells for not equal, and filters each column GridCue may filter", () => {
    const def = settingsFor(WEALTH, "household");
    expect(def.filter).toBe(true);
    expect(def.filterParams).toMatchObject({ caseSensitive: true, includeBlanksInNotEqual: true, includeBlanksInEquals: false });
    expect(typeof def.filterParams?.textMatcher).toBe("function");
    expect(def.filterParams?.textFormatter("A b")).toBe("A b");
    expect(typeof def.filterParams?.comparator).toBe("function");
    expect(typeof def.comparator).toBe("function");
    // The restricted column gets GridCue's sort comparator only: GridCue never filters it.
    expect(Object.keys(settingsFor(WEALTH, "tax_id"))).toEqual(["comparator"]);
  });

  it("holds enough conditions for a list of every declared value, and never fewer than 64", () => {
    expect(paramsFor(WEALTH, "custodian").maxNumConditions).toBe(64);
    const wide = defineSchema([{ id: "code" }], {
      columns: { code: { kind: "enum", enumValues: Array.from({ length: 90 }, (_, i) => ({ id: `v${i}`, label: `Value ${i}` })) } },
    });
    expect(paramsFor(wide, "code").maxNumConditions).toBe(90);
  });

  it("built twice from one schema, or from two equal schemas, gives settings the adapter takes as its own", () => {
    for (const again of [WEALTH, defineSchema(wealthColumns, wealthSchemaOptions)]) {
      const api = latest.createGrid({ columnDefs: gridcueColumnDefs(again, columnDefsFor(WEALTH)), rowData: [] });
      expect(() => createAgGridAdapter({ schema: WEALTH, api })).not.toThrow();
    }
  });

  it("refuses settings built for another schema's kinds, enum labels or operators, or another Calendar's time zone", () => {
    const inUtc = { ...wealthSchemaOptions, calendar: { timeZone: "UTC" } };
    const schema = defineSchema(wealthColumns, inUtc);
    const retyped = defineSchema(wealthColumns, { ...inUtc, columns: { ...inUtc.columns, custodian: { kind: "string" } } });
    const zoned = defineSchema(wealthColumns, { ...inUtc, calendar: { timeZone: "Pacific/Auckland" } });
    const relabelled = defineSchema(wealthColumns, {
      ...inUtc,
      columns: { ...inUtc.columns, custodian: { enumValues: [{ id: "northgate", label: "North Gate" }] } },
    });
    const narrowed = defineSchema(wealthColumns, {
      ...inUtc,
      columns: { ...inUtc.columns, household: { ...inUtc.columns?.household, allowedOperators: ["eq"] } },
    });
    for (const other of [retyped, zoned, relabelled, narrowed]) {
      const api = latest.createGrid({ columnDefs: gridcueColumnDefs(other, columnDefsFor(schema)), rowData: [] });
      expect(() => createAgGridAdapter({ schema, api })).toThrow(/gridcueColumnDefs/);
    }
  });

  it("sorts text ignoring case, as core does, and leaves the rest as AG Grid sorts it: empty cells lowest", () => {
    const { comparator } = settingsFor(WEALTH, "household");
    const sorted = (values: unknown[]) => [...values].sort(comparator);
    expect(sorted(["b", "A", "a", "B", "C"])).toEqual(["b", "A", "a", "B", "C"].sort((a, b) => a.localeCompare(b)));
    expect(sorted(["cedar", "Birch", "alder"])).toEqual(["alder", "Birch", "cedar"]);
    expect(sorted([3, null, -1, 20])).toEqual([null, -1, 3, 20]);
    expect([comparator(undefined, -1), comparator(-1, undefined), comparator(undefined, null)]).toEqual([-1, 1, 0]);
    expect(sorted(["b", null, "a"])).toEqual([null, "a", "b"]);
    expect(sorted([true, false, null])).toEqual([null, false, true]);
    expect(sorted([new Date(2026, 1, 2), new Date(2026, 0, 2)])).toEqual([new Date(2026, 0, 2), new Date(2026, 1, 2)]);
  });
});

// --- The decisions: AG Grid's own setting, or a custom option ---------------------------------------------------------

/** AG Grid's own option for each operator, with 5.6's starting settings. */
const OWN: Partial<Record<FilterPredicate["operator"], string>> = {
  eq: "equals",
  neq: "notEqual",
  contains: "contains",
  startsWith: "startsWith",
  lt: "lessThan",
  lte: "lessThanOrEqual",
  gt: "greaterThan",
  gte: "greaterThanOrEqual",
  between: "inRange",
  isEmpty: "blank",
  isNotEmpty: "notBlank",
};

/** One filter as AG Grid's own options would hold it. */
const ownModel = (p: FilterPredicate, column: ColumnDescriptor): Record<string, unknown> => {
  const family = familyOf(column.kind);
  const filterType = filterTypeOf(family);
  const one = (type: string, value: unknown) => {
    if (family === "number") return { filterType, type, filter: value };
    if (family === "date") return { filterType, type, dateFrom: `${String(value)} 00:00:00` };
    return { filterType, type, filter: String(value) };
  };
  if (p.operator === "in") return { filterType, operator: "OR", conditions: (p.value as Scalar[]).map((v) => one("equals", v)) };
  const type = OWN[p.operator] as string;
  if (p.operator === "isEmpty" || p.operator === "isNotEmpty") return { filterType, type };
  if (p.operator === "between") {
    const { min, max } = p.value as { min: Scalar; max: Scalar };
    return family === "number"
      ? { filterType, type, filter: min, filterTo: max }
      : { filterType, type, dateFrom: `${String(min)} 00:00:00`, dateTo: `${String(max)} 00:00:00` };
  }
  return one(type, p.value);
};

const holdsEmptyText = (p: FilterPredicate) => p.value === "" || (Array.isArray(p.value) && p.value.includes(""));

/**
 * Where AG Grid's own option keeps other rows than GridCue's meaning, by major: the row check's findings, which decide
 * `gridcueColumnDefs` (`src/ag-grid/meanings.ts` records each decision). An option not named here keeps GridCue's rows on
 * 34, 35 and 36 with its own setting. A change here, on a new major or a new release, is a decision to make again.
 */
const OWN_DIFFERS: Record<string, string[]> = {
  // AG Grid's "blank" also matches whitespace-only text (4.1).
  "text is empty": ["34", "35", "36"],
  "text is not empty": ["34", "35", "36"],
  "enum is empty": ["34", "35", "36"],
  "enum is not empty": ["34", "35", "36"],
  // AG Grid never passes a null or missing cell to the text matcher: it drops them for these, and keeps them for "not equal".
  "text equals empty text": ["34", "35", "36"],
  "text in a list with empty text": ["34", "35", "36"],
  "text not equal empty text": ["34", "35", "36"],
  "text contains empty text": ["34", "35", "36"],
  "text starts with empty text": ["34", "35", "36"],
  // On 34 and 35 an empty text cell in a number column is the value 0.
  "number less than": ["34", "35"],
  "number less than or equal": ["34", "35"],
  "number greater than": ["34", "35"],
  "number greater than or equal": ["34", "35"],
  "number between": ["34", "35"],
  // On 34 and 35 an empty text cell in a date column is not blank.
  "date is empty": ["34", "35"],
  "date is not empty": ["34", "35"],
};

const WORDS: Record<FilterPredicate["operator"], string> = {
  eq: "equals",
  neq: "not equal",
  contains: "contains",
  startsWith: "starts with",
  in: "in a list",
  lt: "less than",
  lte: "less than or equal",
  gt: "greater than",
  gte: "greater than or equal",
  between: "between",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
};
const optionName = (p: FilterPredicate, column: ColumnDescriptor) =>
  `${familyOf(column.kind)} ${WORDS[p.operator]}${holdsEmptyText(p) ? (p.operator === "in" ? " with empty text" : " empty text") : ""}`;

describe("the row check's decisions: where AG Grid's own option keeps other rows than GridCue means", () => {
  for (const major of MAJORS) {
    it(
      `AG Grid ${major.version}`,
      () => {
        const differs = new Set<string>();
        const checked = new Set<string>();
        for (const { schema, id } of SUBJECTS) {
          const rows = edgeRows(schema, id);
          // GridCue's settings on each column, with AG Grid's own options in place of the custom ones.
          const own = { filterOptions: [...new Set(Object.values(OWN))], inRangeInclusive: true };
          const columnDefs = gridcueColumnDefs(schema, columnDefsFor(schema)).map((def) => ({
            ...def,
            filterParams: { ...(def as { filterParams?: object }).filterParams, ...own },
          }));
          const api = major.createGrid({ columnDefs, rowData: rows, animateRows: false });
          for (const p of [...predicatesOf(schema, id), ...zeroFilters(schema)]) {
            const column = schema.columns.find((c) => c.id === p.columnId) as ColumnDescriptor;
            const name = optionName(p, column);
            api.setFilterModel({ [p.columnId]: ownModel(p, column) });
            // An option the grid doesn't hold shows every row, which no filter here means.
            const got = new Set(shown(api, id));
            const zone = schema.calendar?.timeZone;
            const want = rows.filter((row) => matchesPredicate(row[p.columnId], p, column, zone ? { timeZone: zone } : undefined));
            checked.add(name);
            if (want.length !== got.size || want.some((row) => !got.has(row[id]))) differs.add(name);
          }
        }
        const expected = Object.entries(OWN_DIFFERS)
          .filter(([, majors]) => majors.includes(major.version))
          .map(([name]) => name);
        expect([...differs].sort()).toEqual(expected.sort());
        // Every kind and operator a column allows was checked.
        for (const name of [
          ...["equals", "not equal", "contains", "starts with", "in a list", "is empty", "is not empty"].map((w) => `text ${w}`),
          ...["equals", "not equal", "in a list", "is empty", "is not empty"].map((w) => `enum ${w}`),
          "yes/no equals",
          ...["equals", "not equal", "less than", "less than or equal", "greater than", "greater than or equal", "between"].map(
            (w) => `number ${w}`,
          ),
          ...[
            "equals",
            "less than",
            "less than or equal",
            "greater than",
            "greater than or equal",
            "between",
            "is empty",
            "is not empty",
          ].map((w) => `date ${w}`),
        ]) {
          expect(checked, name).toContain(name);
        }
      },
      LONG,
    );
  }
});

// --- The row check: the Query Check's cases through AG Grid ------------------------------------------------------------

describe("the row check: AG Grid keeps the rows GridCue means", () => {
  const run = (major: Major, rowModel: RowModel, name: string, schema: ViewSchema, id: string) =>
    it(
      `AG Grid ${major.version}, ${rowModel} row model, ${name}`,
      async () => {
        const result = await runRowCheck(major, rowModel, schema, id);
        expect(result.differ).toEqual([]);
        expect(result.misread).toEqual([]);
        // What the grid can't hold is refused before anything is written, and only that.
        expect(Object.keys(result.refused)).toEqual(["ADAPTER_UNSUPPORTED_FILTER"]);
        expect(result.held).toBeGreaterThan(result.cases / 2);
        expect(result.held + (result.refused.ADAPTER_UNSUPPORTED_FILTER ?? 0)).toBe(result.cases);
        // Client-Side, AG Grid sorts; its comparator is gridcueColumnDefs'. Infinite, the Host's Data Query sorts.
        if (rowModel === "infinite") expect(result.orderDiffers).toBe(0);
      },
      LONG,
    );
  // The wealth schema on every major and both row models; the ledger, for its number, date and date-and-time columns,
  // wherever AG Grid itself filters. On the Infinite Row Model the Host's Data Query filters, from the View State.
  for (const major of MAJORS) {
    run(major, "clientSide", "wealth", WEALTH, "account_number");
    run(major, "infinite", "wealth", WEALTH, "account_number");
    run(major, "clientSide", "ledger", LEDGER, "entry_number");
  }
  run(latest, "infinite", "ledger", LEDGER, "entry_number");
  // A date in a filter is a whole day in the Calendar's time zone, whatever the machine's.
  for (const zone of ["America/New_York", "Pacific/Auckland"]) {
    run(latest, "clientSide", `ledger, Calendar in ${zone}`, ledgerIn(zone), "entry_number");
  }
});

describe("the row check on rows the Query Check doesn't make: empty text in number and date cells, and instants", () => {
  for (const major of MAJORS) {
    for (const subject of [
      ...SUBJECTS,
      { name: "ledger, Calendar in Pacific/Auckland", schema: ledgerIn("Pacific/Auckland"), id: "entry_number" },
    ]) {
      it(
        `AG Grid ${major.version}, ${subject.name}: every filter keeps GridCue's rows`,
        async () => {
          const { schema, id } = subject;
          const rows = edgeRows(schema, id);
          const { api, adapter } = gridFor(major, "clientSide", schema, rows);
          const differ: string[] = [];
          const refused: string[] = [];
          let held = 0;
          for (const p of [...predicatesOf(schema, id), ...zeroFilters(schema)]) {
            const state = viewWith(schema, p);
            const written = await adapter.restore({ revision: adapter.getState().revision, state });
            if (!written.ok) {
              refused.push(`${p.operator} ${JSON.stringify(p.value)}: ${written.code}`);
              continue;
            }
            held++;
            const got = new Set(shown(api, id));
            const want = rows.filter((row) => matchesFilter(row, state.filters, schema)).map((row) => row[id]);
            if (want.length !== got.size || want.some((x) => !got.has(x))) {
              differ.push(`${p.columnId} ${p.operator} ${JSON.stringify(p.value)}: wanted ${want.length} rows, got ${got.size}`);
            }
          }
          expect(differ).toEqual([]);
          expect(held).toBeGreaterThan(100);
          // The one filter AG Grid has no option for keeps every row: text that contains, or starts with, empty text.
          expect([...new Set(refused)].sort()).toEqual([
            'contains "": ADAPTER_UNSUPPORTED_FILTER',
            'startsWith "": ADAPTER_UNSUPPORTED_FILTER',
          ]);
        },
        LONG,
      );
    }
  }
});

// --- What the adapter writes -------------------------------------------------------------------------------------------

describe("what the adapter writes into AG Grid's filter model", () => {
  const rows = [
    { name: "Ann", n: 5, day: "2026-01-10", at: "2026-01-10T15:00:00Z", kind: "a", ok: true },
    { name: null, n: null, day: null, at: null, kind: null, ok: null },
    { name: "", n: "", day: "", at: "", kind: "", ok: false },
  ];
  const schema = defineSchema([{ id: "name" }, { id: "n" }, { id: "day" }, { id: "at" }, { id: "kind" }, { id: "ok" }], {
    columns: {
      n: { kind: "number" },
      day: { kind: "date" },
      at: { kind: "datetime" },
      kind: { kind: "enum" },
      ok: { kind: "boolean" },
    },
    calendar: { timeZone: "UTC" },
  });
  const pred = (columnId: string, operator: FilterPredicate["operator"], value?: FilterPredicate["value"]): FilterPredicate => ({
    id: `${columnId}_${operator}`,
    type: "predicate",
    columnId,
    operator,
    ...(value === undefined ? {} : { value }),
  });
  const write = async (...predicates: FilterPredicate[]) => {
    const api = latest.createGrid({ columnDefs: gridcueColumnDefs(schema, columnDefsFor(schema)), rowData: rows });
    const adapter = createAgGridAdapter({ schema, api });
    const state = { ...viewWith(schema, predicates[0] as FilterPredicate) };
    state.filters = { id: "root", type: "group", combinator: "and", children: predicates };
    const result = await adapter.restore({ revision: adapter.getState().revision, state });
    return { result, model: api.getFilterModel(), view: adapter.getState().state };
  };

  for (const major of MAJORS) {
    it(`AG Grid ${major.version}: an enum's IDs match exactly, text ignores case, and yes/no matches its value`, async () => {
      const cells = [
        { id: 1, name: "Ann", kind: "a", ok: true },
        { id: 2, name: "ANN", kind: "A", ok: false },
        { id: 3, name: null, kind: null, ok: null },
      ];
      const kinds = defineSchema([{ id: "id" }, { id: "name" }, { id: "kind" }, { id: "ok" }], {
        columns: { id: { kind: "number" }, kind: { kind: "enum" }, ok: { kind: "boolean" } },
      });
      const { api, adapter } = gridFor(major, "clientSide", kinds, cells);
      const keeps: Array<[FilterPredicate, number[]]> = [
        [pred("name", "eq", "ann"), [1, 2]],
        [pred("name", "neq", "ann"), [3]],
        [pred("name", "in", ["ann", "bo"]), [1, 2]],
        [pred("kind", "eq", "a"), [1]],
        [pred("kind", "neq", "a"), [2, 3]],
        [pred("kind", "in", ["a", "b"]), [1]],
        [pred("ok", "eq", true), [1]],
        [pred("ok", "eq", false), [2]],
      ];
      for (const [predicate, ids] of keeps) {
        const state = viewWith(kinds, predicate);
        expect((await adapter.restore({ revision: adapter.getState().revision, state })).ok, predicate.id).toBe(true);
        expect(shown(api, "id"), predicate.id).toEqual(ids);
      }
    });
  }

  it("writes each operator as the option the row check chose", async () => {
    const { result, model } = await write(
      pred("name", "contains", "an"),
      pred("n", "gte", 2),
      pred("n", "neq", 9),
      pred("day", "between", { min: "2026-01-01", max: "2026-01-31" }),
      pred("at", "lt", "2026-02-01"),
      pred("kind", "in", ["a", "b"]),
      pred("ok", "eq", true),
    );
    expect(result.ok).toBe(true);
    expect(model).toEqual({
      name: { filterType: "text", type: "contains", filter: "an" },
      n: {
        filterType: "number",
        operator: "AND",
        conditions: [
          { filterType: "number", type: "gridcueGreaterThanOrEqual", filter: 2 },
          { filterType: "number", type: "notEqual", filter: 9 },
        ],
      },
      day: { filterType: "date", type: "gridcueBetween", dateFrom: "2026-01-01 00:00:00", dateTo: "2026-01-31 00:00:00" },
      at: { filterType: "date", type: "gridcueLessThan", dateFrom: "2026-02-01 00:00:00" },
      kind: {
        filterType: "text",
        operator: "OR",
        conditions: [
          { filterType: "text", type: "equals", filter: "a" },
          { filterType: "text", type: "equals", filter: "b" },
        ],
      },
      ok: { filterType: "text", type: "equals", filter: "true" },
    });
  });

  it("writes text equal to empty text as “Is empty”, which keeps the same rows, and the View State keeps the filter as asked", async () => {
    const { result, model, view } = await write(pred("name", "eq", ""));
    expect(result.ok).toBe(true);
    expect(model).toEqual({ name: { filterType: "text", type: "gridcueIsEmpty" } });
    expect(view.filters?.children).toEqual([pred("name", "eq", "")]);
    expect((await write(pred("name", "neq", ""))).model).toEqual({ name: { filterType: "text", type: "gridcueIsNotEmpty" } });
    expect((await write(pred("name", "in", ["Ann", ""]))).model).toEqual({
      name: {
        filterType: "text",
        operator: "OR",
        conditions: [
          { filterType: "text", type: "equals", filter: "Ann" },
          { filterType: "text", type: "gridcueIsEmpty" },
        ],
      },
    });
    // An enum equal to empty text keeps only the cells that hold empty text, which AG Grid's own option does.
    expect((await write(pred("kind", "eq", ""))).model).toEqual({ kind: { filterType: "text", type: "equals", filter: "" } });
  });

  it("writes a time in a Host's own filter as the Calendar's clock shows it, and keeps the rows that moment means", async () => {
    const instants = [
      { id: 1, at: "2026-01-10T14:59:59Z" },
      { id: 2, at: "2026-01-10T15:00:00Z" },
      { id: 3, at: "2026-01-10T10:00:01-05:00" },
      { id: 4, at: null },
    ];
    for (const zone of ["UTC", "Pacific/Auckland"]) {
      const zoned = defineSchema([{ id: "id" }, { id: "at" }], { columns: { at: { kind: "datetime" } }, calendar: { timeZone: zone } });
      const api = latest.createGrid({ columnDefs: gridcueColumnDefs(zoned, columnDefsFor(zoned)), rowData: instants });
      const adapter = createAgGridAdapter({ schema: zoned, api });
      const state = viewWith(zoned, pred("at", "gte", "2026-01-10T15:00:00Z"));
      expect((await adapter.restore({ revision: adapter.getState().revision, state })).ok).toBe(true);
      expect(api.getFilterModel()).toEqual({
        at: {
          filterType: "date",
          type: "gridcueGreaterThanOrEqual",
          dateFrom: zone === "UTC" ? "2026-01-10 15:00:00" : "2026-01-11 04:00:00",
        },
      });
      expect(shown(api, "id"), zone).toEqual([2, 3]);
      expect(adapter.getState().state.filters).toEqual(state.filters);
      const equal = viewWith(zoned, pred("at", "eq", "2026-01-10T15:00:00Z"));
      expect((await adapter.restore({ revision: adapter.getState().revision, state: equal })).ok).toBe(true);
      expect(shown(api, "id"), zone).toEqual([2]);
    }
  });

  it("refuses, before anything is written, what no option holds", async () => {
    for (const unheld of [
      pred("name", "contains", ""),
      pred("name", "startsWith", ""),
      // A time at midnight on the Calendar's clock would read back as the whole day, and a part of a second is lost.
      pred("at", "gt", "2026-01-10T00:00:00Z"),
      pred("at", "between", { min: "2026-01-10", max: "2026-01-10T15:00:00.500Z" }),
      // More values than the column holds conditions.
      pred(
        "name",
        "in",
        Array.from({ length: 65 }, (_, i) => `v${i}`),
      ),
    ]) {
      const { result, model } = await write(pred("n", "gt", 1), unheld);
      expect(result.ok, unheld.id).toBe(false);
      if (!result.ok) expect(result.code).toBe("ADAPTER_UNSUPPORTED_FILTER");
      expect(model).toEqual({});
    }
  });
});
