import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { operatorsFor } from "../src/core/columns";
import { isGridCueError } from "../src/core/errors";
import {
  type ColumnDescriptor,
  type FilterGroup,
  type FilterOperator,
  type FilterPredicate,
  type Scalar,
  type ViewSchema,
  ViewState,
} from "../src/core/protocol";
import { createQueryAdapter } from "../src/core/query-adapter";
import { applyView } from "../src/core/rows-adapter";
import { type ColumnInput, defineSchema, type SchemaOptions } from "../src/core/schema";
import { filterIssues } from "../src/core/validate";
import * as root from "../src/index";
import { type QueryCheck, type QueryCheckCase, type QueryCheckOptions, queryCheck } from "../src/testing";
import { seededRandom } from "./view-generator";

// The Query Check (more grids spec, 4.1 and 5.5; ADR 0032): synthetic rows and View States, built from a View Schema,
// that a Host runs through its own Data Query. These tests hold it to the table in 4.1, and then turn it on itself: a
// Data Query that keeps what `applyView` keeps passes every case, and each wrong translation below fails the case that
// names its rule.

// --- The two fixture schemas, as `fixtures/wealth` and `fixtures/ledger` declare them ---------------------------
// The fixtures import the built package, so the package's own tests declare the same columns here. Every name is
// invented.

const wealthColumns: ColumnInput[] = [
  { id: "account_number", label: "Account number" },
  { id: "household", label: "Household" },
  { id: "advisor_name", label: "Advisor" },
  { id: "registration_type", label: "Registration type" },
  { id: "custodian", label: "Custodian" },
  { id: "market_value", label: "Market value" },
  { id: "concentration", label: "Concentration" },
  { id: "unrealized_gain", label: "Unrealized gain" },
  { id: "has_restricted_holding", label: "Restricted holdings" },
  { id: "tax_id", label: "Tax ID" },
];
const wealthOptions: SchemaOptions = {
  id: "wealth-accounts",
  version: "1",
  restricted: ["tax_id"],
  rowNoun: "account",
  columns: {
    registration_type: {
      enumValues: [
        { id: "taxable", label: "Taxable" },
        { id: "ira", label: "IRA" },
        { id: "roth_ira", label: "Roth IRA" },
        { id: "trust", label: "Trust" },
      ],
    },
    custodian: {
      enumValues: [
        { id: "northgate", label: "Northgate" },
        { id: "harborline", label: "Harborline" },
        { id: "summit_trust", label: "Summit Trust" },
      ],
    },
    market_value: { kind: "currency" },
    concentration: { kind: "percent" },
    unrealized_gain: { kind: "currency" },
    has_restricted_holding: { kind: "boolean" },
  },
};
const ledgerColumns: ColumnInput[] = [
  { id: "entry_number", label: "Entry number" },
  { id: "owner", label: "Owner" },
  { id: "counterparty", label: "Counterparty" },
  { id: "booked", label: "Booked" },
  { id: "posted_at", label: "Posted at" },
  { id: "units", label: "Units" },
  { id: "amount", label: "Amount" },
  { id: "rate", label: "Rate" },
  { id: "category", label: "Category" },
  { id: "cleared", label: "Cleared" },
];
const ledgerOptions: SchemaOptions = {
  id: "ledger-entries",
  version: "1",
  rowNoun: "entry",
  columns: {
    booked: { kind: "date" },
    posted_at: { kind: "datetime" },
    units: { kind: "number" },
    amount: { kind: "currency" },
    rate: { kind: "percent" },
    category: {
      kind: "enum",
      enumValues: [
        { id: "fees", label: "Fees" },
        { id: "travel", label: "Travel" },
        { id: "supplies", label: "Supplies" },
        { id: "services", label: "Services" },
        { id: "software", label: "Software" },
      ],
    },
    cleared: { kind: "boolean" },
  },
};

const WEALTH = defineSchema(wealthColumns, wealthOptions);
const LEDGER = defineSchema(ledgerColumns, ledgerOptions);
const ledgerIn = (timeZone: string) => defineSchema(ledgerColumns, { ...ledgerOptions, calendar: { timeZone } });
const LEDGER_NY = ledgerIn("America/New_York");

/** Every operation a grid may list that the Query Check has a case for. */
const WITH_COUNT = [...MVP_OPERATIONS, "limit.set"];

interface Subject {
  name: string;
  schema: ViewSchema;
  id: string;
}
const SUBJECTS: Subject[] = [
  { name: "wealth", schema: WEALTH, id: "account_number" },
  { name: "ledger", schema: LEDGER, id: "entry_number" },
  { name: "ledger, Calendar in America/New_York", schema: LEDGER_NY, id: "entry_number" },
  { name: "ledger, Calendar in Pacific/Auckland", schema: ledgerIn("Pacific/Auckland"), id: "entry_number" },
];
const checkOf = (s: Subject, more: Partial<QueryCheckOptions> = {}) => queryCheck(s.schema, { id: s.id, operations: WITH_COUNT, ...more });
/** The check, once it is seen to hold rows and cases: a test of what no case does proves nothing with no cases. */
const full = (check: QueryCheck): QueryCheck => {
  expect(check.rows.length).toBeGreaterThan(0);
  expect(check.cases.length).toBeGreaterThan(0);
  return check;
};

type Row = Record<string, Scalar>;
type Ids = Array<string | number>;
type DataQuery = (state: ViewState) => Ids;

const predicatesOf = (group: FilterGroup | null): FilterPredicate[] =>
  (group?.children ?? []).flatMap((child) => (child.type === "group" ? predicatesOf(child) : [child]));

/** The reference Data Query: `applyView` itself. */
const applyViewQuery =
  (check: QueryCheck, schema: ViewSchema, id: string): DataQuery =>
  (state) =>
    applyView(check.rows, state, schema).rows.map((row) => row[id] as string | number);

/** The messages of the cases a Data Query fails. */
const failuresOf = (check: QueryCheck, query: DataQuery): string[] =>
  check.cases.flatMap((c) => {
    const result = c.compare(query(c.state));
    return result.ok ? [] : [result.message];
  });

/** The cases that filter one column with one operator and do nothing else: the column shows, and nothing sorts. */
const singles = (check: QueryCheck, columnId: string, operator?: FilterOperator): QueryCheckCase[] =>
  check.cases.filter((c) => {
    const [only, ...others] = c.state.filters?.children ?? [];
    return (
      only !== undefined &&
      others.length === 0 &&
      only.type === "predicate" &&
      only.columnId === columnId &&
      c.state.visibleColumnIds.includes(columnId) &&
      (operator === undefined || only.operator === operator) &&
      c.state.sorts.length === 0 &&
      c.state.limit === undefined
    );
  });

const theCase = (check: QueryCheck, name: RegExp): QueryCheckCase => {
  const found = check.cases.filter((c) => name.test(c.name));
  expect(
    found.map((c) => c.name),
    String(name),
  ).toHaveLength(1);
  return found[0] as QueryCheckCase;
};

const isEmptyCell = (v: unknown) => v === null || v === undefined || v === "";
const cellsOf = (check: QueryCheck, columnId: string): Scalar[] => check.rows.map((row) => row[columnId] as Scalar);
/** The cells a case keeps in one column, read from `applyView`. */
const keptCells = (check: QueryCheck, schema: ViewSchema, c: QueryCheckCase, columnId: string): Scalar[] =>
  applyView(check.rows, c.state, schema).rows.map((row) => row[columnId] as Scalar);

// --- The entry ---------------------------------------------------------------------------------------------------

describe("the gridcue/testing entry", () => {
  const source = readFileSync(join(import.meta.dirname, "../src/testing/index.ts"), "utf8");

  it("imports no test runner and nothing outside the package's core", () => {
    const specifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => !/^\.\.\/core\/[\w-]+$/.test(s))).toEqual([]);
    expect(source).not.toMatch(/vitest|jest|mocha|node:test|chai/);
  });

  it("reads no clock and no random number", () => {
    expect(source).not.toMatch(/Math\.random|Date\.now|new Date\(\)|performance\.now/);
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random was called");
    });
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now was called");
    });
    try {
      for (const s of SUBJECTS) expect(checkOf(s).cases.length).toBeGreaterThan(0);
    } finally {
      random.mockRestore();
      now.mockRestore();
    }
  });

  it("is the only entry that exports the Query Check", () => {
    expect(root).not.toHaveProperty("queryCheck");
  });

  it("is used in a few lines, as the spec's example is", () => {
    const adapter = createQueryAdapter({ schema: WEALTH, countBeforePaging: true });
    const check = queryCheck(WEALTH, { id: "account_number", operations: adapter.getCapabilities().operations });
    const myDataQuery = applyViewQuery(check, WEALTH, "account_number");
    expect(check.rows.length).toBeGreaterThan(0);
    expect(check.cases.length).toBeGreaterThan(0);
    for (const c of check.cases) {
      const result = c.compare(myDataQuery(c.state));
      if (!result.ok) throw new Error(result.message);
    }
  });
});

// --- The rows ----------------------------------------------------------------------------------------------------

describe("the rows are synthetic, and hit each edge in the table", () => {
  const ny = SUBJECTS[2] as Subject;

  it("every row holds every column, and a different id", () => {
    for (const s of SUBJECTS) {
      const { rows } = checkOf(s);
      expect(rows.length, s.name).toBeGreaterThanOrEqual(30);
      for (const row of rows) expect(Object.keys(row).sort(), s.name).toEqual(s.schema.columns.map((c) => c.id).sort());
      expect(new Set(rows.map((row) => String(row[s.id]))).size, s.name).toBe(rows.length);
      for (const row of rows) expect(isEmptyCell(row[s.id]), s.name).toBe(false);
    }
  });

  it("an id that is no column of the schema is a number on each row, and never the row's own place", () => {
    const { rows, cases } = queryCheck(WEALTH, { id: "row_id" });
    const ids = rows.map((row) => row.row_id as number);
    expect([...ids].sort((a, b) => a - b)).toEqual(rows.map((_, i) => i + 1));
    // A database numbers rows as they are loaded, from 1. No row's id is that number.
    expect(ids.filter((id, i) => id === i + 1)).toEqual([]);
    expect(cases.length).toBeGreaterThan(0);
  });

  it("a text column also holds text with spaces around it, placeholder text, a letter outside A to Z, and a small first letter", () => {
    for (const [s, columnId] of [
      [SUBJECTS[0], "household"],
      [SUBJECTS[1], "counterparty"],
    ] as Array<[Subject, string]>) {
      const texts = cellsOf(checkOf(s), columnId).filter((v): v is string => typeof v === "string");
      // The same text with and without spaces around it.
      expect(
        texts.some((t) => t !== t.trim() && t.trim() !== "" && texts.includes(t.trim())),
        columnId,
      ).toBe(true);
      // Placeholder text, which is a value and not an empty cell.
      for (const placeholder of ["N/A", "-"]) expect(texts, columnId).toContain(placeholder);
      // One text in two letter cases, with a letter outside A to Z.
      expect(
        texts.some((a) => [...a].some((ch) => ch.charCodeAt(0) > 127) && texts.some((b) => a !== b && a.toLowerCase() === b.toLowerCase())),
        columnId,
      ).toBe(true);
      // Text of the letters A to Z alone that sorts one way by character code and another ignoring case.
      const letters = texts.filter((t) => /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(t));
      const byCode = [...letters].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const ignoringCase = [...letters].sort((a, b) => a.localeCompare(b));
      expect(byCode, columnId).not.toEqual(ignoringCase);
    }
  });

  it("a text column holds null, empty text, whitespace-only text, one text in two cases, and text with % and _", () => {
    for (const [s, columnId] of [
      [SUBJECTS[0], "household"],
      [SUBJECTS[0], "advisor_name"],
      [SUBJECTS[1], "counterparty"],
    ] as Array<[Subject, string]>) {
      const cells = cellsOf(checkOf(s), columnId);
      const texts = cells.filter((v): v is string => typeof v === "string");
      expect(cells, columnId).toContain(null);
      expect(cells, columnId).toContain("");
      expect(
        texts.some((t) => t !== "" && t.trim() === ""),
        columnId,
      ).toBe(true);
      expect(
        texts.some((a) => texts.some((b) => a !== b && a.toLowerCase() === b.toLowerCase())),
        columnId,
      ).toBe(true);
      expect(
        texts.some((t) => t.includes("%")),
        columnId,
      ).toBe(true);
      expect(
        texts.some((t) => t.includes("_")),
        columnId,
      ).toBe(true);
      // The characters a LIKE pattern escapes with, and a bracket, side by side in one text.
      expect(
        texts.some((t) => t.includes("\\![")),
        columnId,
      ).toBe(true);
    }
  });

  it("a number column holds null, a negative number, zero, both ends of its range and the values just past them", () => {
    for (const [s, columnId] of [
      [SUBJECTS[0], "market_value"],
      [SUBJECTS[0], "concentration"],
      [SUBJECTS[1], "units"],
      [SUBJECTS[1], "amount"],
      [SUBJECTS[1], "rate"],
    ] as Array<[Subject, string]>) {
      const check = checkOf(s);
      const cells = cellsOf(check, columnId);
      const numbers = cells.filter((v): v is number => typeof v === "number");
      expect(cells, columnId).toContain(null);
      expect(cells, columnId).toContain(0);
      expect(
        numbers.some((n) => n < 0),
        columnId,
      ).toBe(true);
      const [between] = singles(check, columnId, "between");
      const range = predicatesOf(between?.state.filters ?? null)[0]?.value as { min: number; max: number };
      expect(range.min, columnId).toBeLessThan(range.max);
      expect(numbers, columnId).toContain(range.min);
      expect(numbers, columnId).toContain(range.max);
      const sorted = [...new Set(numbers)].sort((a, b) => a - b);
      // The value just below the low end and the one just above the high end are in the rows, and nothing sits closer.
      expect(sorted.indexOf(range.min), columnId).toBeGreaterThan(0);
      expect(sorted.indexOf(range.max), columnId).toBeLessThan(sorted.length - 1);
      expect(
        numbers.some((n) => n > range.min && n < range.max),
        columnId,
      ).toBe(true);
    }
  });

  it("a number column's values sort differently as text, so a comparison made on text fails", () => {
    for (const [s, columnId] of [
      [SUBJECTS[0], "market_value"],
      [SUBJECTS[1], "units"],
    ] as Array<[Subject, string]>) {
      const numbers = [...new Set(cellsOf(checkOf(s), columnId).filter((v): v is number => typeof v === "number"))];
      const asNumbers = [...numbers].sort((a, b) => a - b);
      const asText = [...numbers].sort((a, b) => (String(a) < String(b) ? -1 : 1));
      expect(asText, columnId).not.toEqual(asNumbers);
    }
  });

  it("an enum column holds each declared value, null and empty text", () => {
    const cells = cellsOf(checkOf(SUBJECTS[0] as Subject), "registration_type");
    for (const value of ["taxable", "ira", "roth_ira", "trust", null, ""]) expect(cells).toContain(value);
    expect(new Set(cells).size).toBe(6);
  });

  it("a text column holds two texts that differ only by an accent", () => {
    const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    for (const [s, columnId] of [
      [SUBJECTS[0], "household"],
      [SUBJECTS[1], "counterparty"],
    ] as Array<[Subject, string]>) {
      const texts = [...new Set(cellsOf(checkOf(s), columnId).filter((v): v is string => typeof v === "string"))];
      expect(
        texts.some((a) => texts.some((b) => a.toLowerCase() !== b.toLowerCase() && fold(a) === fold(b))),
        columnId,
      ).toBe(true);
    }
  });

  it("a yes/no column holds yes, no and null", () => {
    expect(new Set(cellsOf(checkOf(SUBJECTS[1] as Subject), "cleared"))).toEqual(new Set([true, false, null]));
  });

  it("a date column holds null, both ends of its range, and the days just past them", () => {
    const check = checkOf(SUBJECTS[1] as Subject);
    const cells = cellsOf(check, "booked");
    const [between] = singles(check, "booked", "between");
    const range = predicatesOf(between?.state.filters ?? null)[0]?.value as { min: string; max: string };
    const step = (day: string, count: number) => {
      const d = new Date(`${day}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + count);
      return d.toISOString().slice(0, 10);
    };
    for (const day of [null, step(range.min, -1), range.min, range.max, step(range.max, 1)]) expect(cells).toContain(day);
    for (const cell of cells) if (cell !== null) expect(cell).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("with a Calendar time zone, a date-and-time column holds instants on each side of a day's start and end there", () => {
    const check = checkOf(ny);
    const cells = cellsOf(check, "posted_at");
    // 2026-03-08 in New York, written by hand: it starts at 05:00 UTC, and the clock change makes it 23 hours long.
    for (const instant of ["2026-03-08T04:59:59Z", "2026-03-08T05:00:00Z", "2026-03-09T03:59:59Z", "2026-03-09T04:00:00Z"]) {
      expect(cells).toContain(instant);
    }
    expect(cells).toContain(null);
    // Beside them, clock times with no offset on each side of the same day's midnights: each is on its own date.
    const clocks = ["2026-03-07T23:59:59", "2026-03-08T00:00:00", "2026-03-08T23:59:59", "2026-03-09T00:00:00"];
    for (const time of clocks) expect(cells).toContain(time);
    for (const cell of cells) {
      if (cell !== null && !clocks.includes(cell as string)) expect(cell).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
    const on = theCase(
      check,
      /^a date means the whole day in the calendar's time zone, and a time with no offset is on its own date \(Posted at is on 2026-03-08/,
    );
    expect(new Set(keptCells(check, LEDGER_NY, on, "posted_at"))).toEqual(
      new Set(["2026-03-08T05:00:00Z", "2026-03-09T03:59:59Z", "2026-03-08T00:00:00", "2026-03-08T23:59:59"]),
    );
    // The same day in Auckland starts 13 hours before UTC's.
    const auckland = checkOf(SUBJECTS[3] as Subject);
    for (const instant of ["2026-03-07T10:59:59Z", "2026-03-07T11:00:00Z", "2026-03-08T10:59:59Z", "2026-03-08T11:00:00Z"]) {
      expect(cellsOf(auckland, "posted_at")).toContain(instant);
    }
  });

  it("with no Calendar time zone, a date-and-time column holds clock times with no offset, on each side of midnight", () => {
    const check = checkOf(SUBJECTS[1] as Subject);
    const cells = cellsOf(check, "posted_at");
    for (const time of ["2026-03-07T23:59:59", "2026-03-08T00:00:00", "2026-03-08T23:59:59", "2026-03-09T00:00:00"]) {
      expect(cells).toContain(time);
    }
    for (const cell of cells) if (cell !== null) expect(cell).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    const on = theCase(check, /^a date means the whole day \(Posted at is on 2026-03-08\)/);
    expect(new Set(keptCells(check, LEDGER, on, "posted_at"))).toEqual(new Set(["2026-03-08T00:00:00", "2026-03-08T23:59:59"]));
  });

  it("a restricted column gets plain values", () => {
    const cells = cellsOf(full(checkOf(SUBJECTS[0] as Subject)), "tax_id");
    for (const cell of cells) {
      expect(typeof cell).toBe("string");
      expect(String(cell).trim()).not.toBe("");
      expect(String(cell)).toMatch(/^[A-Za-z0-9 ]+$/);
    }
  });
});

// --- notNull -----------------------------------------------------------------------------------------------------

describe("notNull names columns the Host's database can't leave empty", () => {
  const notNull = ["household", "custodian", "market_value", "has_restricted_holding"];

  it("they get no empty cells, and the other columns keep theirs", () => {
    const check = checkOf(SUBJECTS[0] as Subject, { notNull });
    for (const id of notNull) expect(cellsOf(check, id).filter(isEmptyCell), id).toEqual([]);
    for (const id of ["advisor_name", "registration_type", "concentration"]) expect(cellsOf(check, id), id).toContain(null);
    // Whitespace-only text is a value, so a column that can't be empty still holds it.
    expect(cellsOf(check, "household").some((v) => typeof v === "string" && v !== "" && v.trim() === "")).toBe(true);
  });

  it("no case sorts them to test where the rows with no value go", () => {
    const check = checkOf(SUBJECTS[0] as Subject, { notNull });
    const aboutEmpty = check.cases.filter((c) =>
      /^a (sort with no count keeps the rows|count never keeps a row) with no value/.test(c.name),
    );
    expect(aboutEmpty.length).toBeGreaterThan(0);
    for (const c of aboutEmpty) expect(notNull, c.name).not.toContain(c.state.sorts[0]?.columnId);
  });

  it("the cases still hold: applyView passes every one, and every operator still has its case", () => {
    const s = SUBJECTS[0] as Subject;
    const check = checkOf(s, { notNull });
    expect(failuresOf(check, applyViewQuery(check, s.schema, s.id))).toEqual([]);
    for (const id of notNull) {
      const column = s.schema.columns.find((c) => c.id === id) as ColumnDescriptor;
      for (const operator of operatorsFor(column)) expect(singles(check, id, operator).length, `${id} ${operator}`).toBeGreaterThan(0);
    }
    // "Is empty" keeps no row of such a column, and a Data Query that keeps whitespace-only text there still fails it.
    const empty = theCase(
      check,
      /^is empty keeps null and empty text, and leaves out whitespace-only and placeholder text \(Household is empty\)/,
    );
    expect(empty.compare([]).ok).toBe(true);
  });

  it("a name that is no column of the schema throws INPUT_CONFIG, naming it", () => {
    let thrown: unknown;
    try {
      queryCheck(WEALTH, { id: "account_number", notNull: ["housheold"] });
    } catch (error) {
      thrown = error;
    }
    expect(isGridCueError(thrown) && thrown.code).toBe("INPUT_CONFIG");
    expect((thrown as Error).message).toContain("housheold");
  });
});

// --- The cases ---------------------------------------------------------------------------------------------------

/** The rule each operator's cases name, by the kind of column: one row of the table in 4.1, or its empty-operand line. */
const TEXT_RULES: Partial<Record<FilterOperator, RegExp[]>> = {
  eq: [
    /^equal ignores case on text, and leaves out empty cells \(/,
    /^equal ignores case but not accents \(/,
    /^equal reads _ as plain text \(/,
    /^equal to empty text keeps exactly the empty cells \(/,
    /^equal keeps the spaces in what it asks for \(/,
    /^equal to whitespace-only text keeps only that text, not the empty cells \(/,
  ],
  neq: [
    /^not equal keeps empty cells, and ignores case on text \(/,
    /^not equal to empty text leaves out exactly the empty cells \(/,
    /^not equal keeps the spaces in what it asks for \(/,
  ],
  in: [
    /^in a list ignores case on text, and leaves out empty cells \(/,
    /^in a list of empty text keeps exactly the empty cells \(/,
    /^in a list keeps the spaces in what it asks for \(/,
    /^in a list with empty text among other values keeps the empty cells too \(/,
  ],
  contains: [
    /^contains ignores case, and leaves out empty cells \(/,
    /^contains reads % as plain text \(/,
    /^contains reads _ as plain text \(/,
    /^contains reads \\, ! and \[ as plain text \(/,
    /^contains empty text keeps every row, empty cells included \(/,
    /^contains keeps the spaces in what it asks for \(/,
    /^contains whitespace-only text keeps only the text that holds it \(/,
  ],
  startsWith: [
    /^starts with ignores case, looks only at the start, and leaves out empty cells \(/,
    /^starts with reads % as plain text \(/,
    /^starts with reads _ as plain text \(/,
    /^starts with reads \\, ! and \[ as plain text \(/,
    /^starts with empty text keeps every row, empty cells included \(/,
    /^starts with keeps the spaces in what it asks for \(/,
  ],
  isEmpty: [/^is empty keeps null and empty text, and leaves out whitespace-only and placeholder text \(/],
  isNotEmpty: [/^is not empty keeps whitespace-only and placeholder text, and leaves out null and empty text \(/],
};
const ENUM_RULES: Partial<Record<FilterOperator, RegExp[]>> = {
  eq: [/^equal is exact and leaves out empty cells \(/],
  neq: [/^not equal keeps empty cells \(/],
  in: [/^in a list keeps each listed value and leaves out empty cells \(/],
  isEmpty: [/^is empty keeps only cells with no value \(/],
  isNotEmpty: [/^is not empty leaves out cells with no value \(/],
};
const NUMBER_RULES: Partial<Record<FilterOperator, RegExp[]>> = {
  eq: [/^equal to zero leaves out empty cells \(/],
  neq: [/^not equal keeps empty cells \(/, /^not equal to zero keeps empty cells, which are not zero \(/],
  gt: [
    /^greater than leaves out the value itself and empty cells \(/,
    /^greater than a negative number leaves out empty cells, which are not zero \(/,
  ],
  gte: [
    /^greater than or equal includes the value itself and leaves out empty cells \(/,
    /^greater than or equal to a negative number leaves out empty cells, which are not zero \(/,
  ],
  lt: [/^less than leaves out the value itself and empty cells \(/],
  lte: [/^less than or equal includes the value itself and leaves out empty cells \(/],
  between: [
    /^between includes both ends and leaves out empty cells \(/,
    /^between a range that holds zero leaves out empty cells, which are not zero \(/,
  ],
  isEmpty: [/^is empty keeps only cells with no value, and zero is a value \(/],
  isNotEmpty: [/^is not empty keeps zero, and leaves out cells with no value \(/],
};
const DATE_RULES: Partial<Record<FilterOperator, RegExp[]>> = {
  eq: [/^a date means the whole day/],
  gt: [/^after a date leaves out that whole day/],
  gte: [/^on or after a date includes that whole day/],
  lt: [/^before a date leaves out that whole day/],
  lte: [/^on or before a date includes that whole day/],
  between: [/^between includes both ends, each a whole day/],
  isEmpty: [/^is empty keeps only cells with no value \(/],
  isNotEmpty: [/^is not empty leaves out cells with no value \(/],
};
const YES_NO_RULES: Partial<Record<FilterOperator, RegExp[]>> = {
  eq: [/^yes keeps only yes and leaves out empty cells \(/, /^no keeps only no and leaves out empty cells \(/],
};
const RULES: Record<ColumnDescriptor["kind"], Partial<Record<FilterOperator, RegExp[]>>> = {
  string: TEXT_RULES,
  enum: ENUM_RULES,
  number: NUMBER_RULES,
  currency: NUMBER_RULES,
  percent: NUMBER_RULES,
  date: DATE_RULES,
  datetime: DATE_RULES,
  boolean: YES_NO_RULES,
};

describe("every edge in the table produces a case, for every column and every operator the column allows", () => {
  for (const s of SUBJECTS) {
    it(`${s.name}: each operator of each column has a case for each of its rules`, () => {
      const check = checkOf(s);
      let checked = 0;
      for (const column of s.schema.columns) {
        if (column.sensitivity === "restricted" || column.id === s.id) continue;
        for (const operator of operatorsFor(column)) {
          const names = singles(check, column.id, operator).map((c) => c.name);
          const rules = RULES[column.kind][operator] ?? [];
          expect(rules.length, `${column.kind} ${operator}`).toBeGreaterThan(0);
          for (const rule of rules) {
            expect(
              names.filter((name) => rule.test(name)),
              `${column.label} ${operator} ${rule}`,
            ).toHaveLength(1);
            checked += 1;
          }
          // No case of the column's is left unnamed by a rule.
          expect(
            names.filter((name) => !rules.some((rule) => rule.test(name))),
            `${column.label} ${operator}`,
          ).toEqual([]);
        }
      }
      expect(checked).toBeGreaterThan(40);
    });
  }

  it("a case's name is its rule, then the view in plain words", () => {
    const check = checkOf(SUBJECTS[0] as Subject);
    const names = check.cases.map((c) => c.name);
    expect(names).toContain("not equal keeps empty cells (Custodian is not Northgate)");
    expect(names).toContain("between includes both ends and leaves out empty cells (Market value is between $1,000 and $250,000)");
    expect(names).toContain("equal ignores case on text, and leaves out empty cells (Advisor is “åLDER fen”)");
    expect(names).toContain("in a list ignores case on text, and leaves out empty cells (Advisor is one of “åLDER fen”, “ELM garth”)");
    expect(names).toContain("starts with reads _ as plain text (Household starts with “cedar_D”)");
    expect(names).toContain("yes keeps only yes and leaves out empty cells (Restricted holdings is Yes)");
    expect(names).toContain("is empty keeps null and empty text, and leaves out whitespace-only and placeholder text (Household is empty)");
    expect(names).toContain("no filters keep every row (no filter and no sort)");
    expect(names).toContain("text sorts by its letters, ignoring case (sorted by Household, descending)");
    expect(new Set(names).size).toBe(names.length);
    const ledger = checkOf(SUBJECTS[2] as Subject).cases.map((c) => c.name);
    expect(ledger).toContain("on or before a date includes that whole day (Booked is on or before 2026-11-01)");
    expect(ledger).toContain(
      "a date means the whole day in the calendar's time zone, and a time with no offset is on its own date (Posted at is on 2026-03-08, America/New_York time)",
    );
    expect(ledger).toContain("between a range that holds zero leaves out empty cells, which are not zero (Units is between -40 and 10)");
    expect(ledger).toContain("greater than leaves out the value itself and empty cells (Units is above 10)");
    expect(ledger).toContain("less than or equal includes the value itself and leaves out empty cells (Rate is at most 50%)");
  });

  it("each case tests its edge: the rows it keeps and leaves out are the ones its rule is about", () => {
    const s = SUBJECTS[0] as Subject;
    const check = checkOf(s);
    const kept = (name: RegExp, columnId: string) => keptCells(check, s.schema, theCase(check, name), columnId);

    // neq keeps empty cells: null and "" on text, null on an enum.
    expect(kept(/^not equal keeps empty cells \(Custodian is not Northgate\)/, "custodian")).toContain(null);
    const notText = kept(/^not equal keeps empty cells, and ignores case on text \(Advisor is not/, "advisor_name");
    expect(notText).toContain(null);
    expect(notText).toContain("");
    expect(notText.some((v) => typeof v === "string" && v.toLowerCase() === "ålder fen")).toBe(false);
    // Not equal to empty text keeps every value, whitespace-only text too, and only the empty cells are left out.
    const notEmptyText = new Set(kept(/^not equal to empty text leaves out exactly the empty cells \(Advisor/, "advisor_name"));
    expect(notEmptyText.has(null) || notEmptyText.has("")).toBe(false);
    expect(notEmptyText.has(" ")).toBe(true);

    // eq and in on text ignore case, for a letter outside A to Z too: the value is written in neither case the rows hold.
    const equal = new Set(kept(/^equal ignores case on text, and leaves out empty cells \(Advisor is/, "advisor_name"));
    expect(equal.size).toBe(2);
    expect([...equal].map((v) => String(v).toLowerCase())).toEqual(["ålder fen", "ålder fen"]);
    // Accents are not folded: the same letters without the accent keep only that text, never "Ålder Fen".
    expect(new Set(kept(/^equal ignores case but not accents \(Advisor is/, "advisor_name"))).toEqual(new Set(["Alder Fen"]));
    const listed = new Set(kept(/^in a list ignores case on text, and leaves out empty cells \(Advisor is/, "advisor_name"));
    expect(listed.size).toBeGreaterThanOrEqual(3);
    expect(listed.has(null)).toBe(false);

    // Spaces in what a filter asks for are text: trimmed, each would keep other rows.
    expect(new Set(kept(/^equal keeps the spaces in what it asks for \(Household/, "household"))).toEqual(new Set([" Ålder Fen "]));
    expect(new Set(kept(/^equal to whitespace-only text keeps only that text.* \(Household/, "household"))).toEqual(new Set([" "]));
    expect(new Set(kept(/^starts with keeps the spaces in what it asks for \(Household/, "household"))).toEqual(new Set([" Ålder Fen "]));
    expect(new Set(kept(/^contains keeps the spaces in what it asks for \(Household/, "household"))).toEqual(new Set([" Ålder Fen "]));
    const spaced = new Set(kept(/^contains whitespace-only text keeps only the text that holds it \(Household/, "household"));
    expect([...spaced].every((v) => typeof v === "string" && v.includes(" "))).toBe(true);
    expect(spaced.has(null) || spaced.has("")).toBe(false);
    const notPadded = new Set(kept(/^not equal keeps the spaces in what it asks for \(Household/, "household"));
    expect(notPadded.has(" Ålder Fen ")).toBe(false);
    expect(notPadded.has("Ålder Fen") && notPadded.has(null)).toBe(true);
    expect(new Set(kept(/^in a list keeps the spaces in what it asks for \(Household/, "household"))).toEqual(
      new Set([" Ålder Fen ", " "]),
    );

    // contains and startsWith: ignoring case; % and _ are plain text.
    const contains = new Set(kept(/^contains ignores case, and leaves out empty cells \(Advisor contains/, "advisor_name"));
    const starts = new Set(
      kept(/^starts with ignores case, looks only at the start, and leaves out empty cells \(Advisor starts with/, "advisor_name"),
    );
    expect(starts.size).toBeGreaterThanOrEqual(2);
    expect(contains.size).toBeGreaterThan(starts.size);
    // Read as a pattern, the % would also keep the text with a digit in its place.
    expect(new Set(kept(/^starts with reads % as plain text \(Household/, "household"))).toEqual(new Set(["Birch 100%"]));
    expect(cellsOf(check, "household")).toContain("Birch 1000");
    const wild = (name: RegExp) => {
      const held = kept(name, "household");
      expect(held.length, String(name)).toBeGreaterThan(0);
      return held;
    };
    for (const cell of wild(/^contains reads % as plain text \(Household contains “%”\)/)) expect(cell).toContain("%");
    for (const cell of wild(/^contains reads _ as plain text \(Household contains “_”\)/)) expect(cell).toContain("_");
    // The same text with a space where the _ is sits in the rows too, and a pattern match would keep it.
    const texts = cellsOf(check, "household").filter((v): v is string => typeof v === "string");
    const underscored = texts.find((t) => t.includes("_")) as string;
    expect(texts).toContain(underscored.replace("_", " "));
    for (const name of [
      /^starts with reads _ as plain text \(Household starts with “cedar_D”\)/,
      /^equal reads _ as plain text \(Household is/,
    ]) {
      expect(new Set(wild(name))).toEqual(new Set([underscored]));
    }
    // A backslash, ! and [ are plain text too: the one text that holds them, and no other.
    const escaped = texts.find((t) => t.includes("\\![")) as string;
    for (const name of [
      /^contains reads \\, ! and \[ as plain text \(Household/,
      /^starts with reads \\, ! and \[ as plain text \(Household/,
    ]) {
      expect(new Set(wild(name))).toEqual(new Set([escaped]));
    }
    // Empty text beside other values in a list keeps the empty cells and each other value.
    const mixedList = new Set(kept(/^in a list with empty text among other values keeps the empty cells too \(Household/, "household"));
    expect(mixedList).toEqual(new Set([null, "", "Elm Garth"]));

    // What a text filter asks for is in a letter case no row holds, and neither all small nor all capital letters: a
    // comparison that ignores case on the column alone, or on the value alone, keeps no row.
    for (const column of ["household", "advisor_name"]) {
      for (const operator of ["eq", "neq", "in", "contains", "startsWith"] as const) {
        const asked = singles(check, column, operator)
          .flatMap((c) => predicatesOf(c.state.filters).flatMap((p) => (Array.isArray(p.value) ? p.value : [p.value])))
          .filter((value): value is string => typeof value === "string" && /[a-z]/i.test(value));
        expect(asked.length, `${column} ${operator}`).toBeGreaterThan(0);
        for (const value of asked) {
          expect(value, `${column} ${operator}`).not.toBe(value.toLowerCase());
          expect(value, `${column} ${operator}`).not.toBe(value.toUpperCase());
          expect(
            texts.some((t) => t.includes(value)),
            `${column} ${operator}`,
          ).toBe(false);
        }
      }
    }

    // An empty operand: eq and in keep exactly the empty cells; contains and startsWith keep every row.
    for (const name of [/^equal to empty text keeps exactly the empty cells \(Household/, /^in a list of empty text .* \(Household/]) {
      expect(new Set(kept(name, "household"))).toEqual(new Set([null, ""]));
    }
    for (const name of [/^contains empty text keeps every row.* \(Household/, /^starts with empty text keeps every row.* \(Household/]) {
      expect(kept(name, "household")).toHaveLength(check.rows.length);
    }
    for (const operator of ["eq", "in", "contains", "startsWith"] as const) {
      const empty = singles(check, "household", operator).filter((c) => {
        const value = predicatesOf(c.state.filters)[0]?.value;
        return value === "" || (Array.isArray(value) && value.length === 1 && value[0] === "");
      });
      expect(empty, operator).toHaveLength(1);
    }

    // isEmpty keeps null and "", and leaves out whitespace-only and placeholder text; isNotEmpty is the rest.
    expect(new Set(kept(/^is empty keeps null and empty text.* \(Household is empty\)/, "household"))).toEqual(new Set([null, ""]));
    const notEmpty = kept(/^is not empty keeps whitespace-only and placeholder text.* \(Household is not empty\)/, "household");
    expect(notEmpty.some((v) => typeof v === "string" && v.trim() === "")).toBe(true);
    expect(notEmpty).toContain("N/A");
    expect(notEmpty).toContain("-");
    expect(notEmpty.some(isEmptyCell)).toBe(false);

    // Numbers: the ends of a range are in, the values just past them are out, and zero is a value.
    const range = new Set(kept(/^between includes both ends.* \(Market value/, "market_value"));
    expect(range.has(1000) && range.has(250000)).toBe(true);
    expect([...range].every((v) => typeof v === "number" && v >= 1000 && v <= 250000)).toBe(true);
    expect(new Set(kept(/^greater than leaves out the value itself.* \(Market value/, "market_value")).has(1000)).toBe(false);
    expect(new Set(kept(/^greater than or equal includes the value itself.* \(Market value/, "market_value")).has(1000)).toBe(true);
    expect(new Set(kept(/^less than leaves out the value itself.* \(Market value/, "market_value")).has(250000)).toBe(false);
    expect(new Set(kept(/^less than or equal includes the value itself.* \(Market value/, "market_value")).has(250000)).toBe(true);
    expect(new Set(kept(/^equal to zero leaves out empty cells \(Market value is \$0\)/, "market_value"))).toEqual(new Set([0]));
    expect(new Set(kept(/^is empty keeps only cells with no value, and zero is a value \(Market value/, "market_value"))).toEqual(
      new Set([null]),
    );
    expect(kept(/^is not empty keeps zero.* \(Market value/, "market_value")).toContain(0);
    // An empty cell is not zero: each of these keeps zero and leaves out the empty cells, or keeps them where zero is
    // left out.
    for (const name of [
      /^between a range that holds zero .* \(Market value/,
      /^greater than a negative number .* \(Market value/,
      /^greater than or equal to a negative number .* \(Market value/,
    ]) {
      const held = kept(name, "market_value");
      expect(held, String(name)).toContain(0);
      expect(held, String(name)).not.toContain(null);
    }
    const notZero = kept(/^not equal to zero keeps empty cells.* \(Market value/, "market_value");
    expect(notZero).toContain(null);
    expect(notZero).not.toContain(0);

    // Yes/no: each keeps its own value, never an empty cell.
    expect(new Set(kept(/^no keeps only no/, "has_restricted_holding"))).toEqual(new Set([false]));
    expect(new Set(kept(/^yes keeps only yes/, "has_restricted_holding"))).toEqual(new Set([true]));
  });

  it("a date means the whole day: the day's own rows are kept or left out together, on both kinds of column", () => {
    const ny = SUBJECTS[2] as Subject;
    const check = checkOf(ny);
    const kept = (name: RegExp, columnId: string) => new Set(keptCells(check, ny.schema, theCase(check, name), columnId));
    const [first, last, before, after] = ["2026-03-08T05:00:00Z", "2026-03-09T03:59:59Z", "2026-03-08T04:59:59Z", "2026-03-09T04:00:00Z"];
    const afterDay = kept(/^after a date leaves out that whole day \(Posted at is after 2026-03-08/, "posted_at");
    expect([first, last, before].some((cell) => afterDay.has(cell as string))).toBe(false);
    expect(afterDay.has(after as string)).toBe(true);
    const onOrAfter = kept(/^on or after a date includes that whole day \(Posted at is on or after 2026-03-08/, "posted_at");
    expect([first, last, after].every((cell) => onOrAfter.has(cell as string))).toBe(true);
    expect(onOrAfter.has(before as string)).toBe(false);
    // 2026-11-01 in New York starts at 04:00 UTC and, with the clock change, ends at 05:00 UTC the next day.
    const onOrBefore = kept(/^on or before a date includes that whole day \(Posted at is on or before 2026-11-01/, "posted_at");
    expect(onOrBefore.has("2026-11-02T04:59:59Z")).toBe(true);
    expect(onOrBefore.has("2026-11-02T05:00:00Z")).toBe(false);
    const beforeDay = kept(/^before a date leaves out that whole day \(Posted at is before 2026-11-01/, "posted_at");
    expect(beforeDay.has("2026-11-01T03:59:59Z")).toBe(true);
    expect(beforeDay.has("2026-11-01T04:00:00Z")).toBe(false);
    const range = kept(/^between includes both ends, each a whole day \(Posted at is from 2026-03-08 to 2026-11-01/, "posted_at");
    expect([first, last, "2026-11-01T04:00:00Z", "2026-11-02T04:59:59Z"].every((cell) => range.has(cell as string))).toBe(true);
    expect([before, "2026-11-02T05:00:00Z", null].some((cell) => range.has(cell as string | null))).toBe(false);
    // A date column holds days, and the same rules read them.
    expect(kept(/^a date means the whole day \(Booked is on 2026-03-08\)/, "booked")).toEqual(new Set(["2026-03-08"]));
    expect(kept(/^between includes both ends, each a whole day \(Booked is from 2026-03-08 to 2026-11-01\)/, "booked")).toEqual(
      new Set(["2026-03-08", "2026-06-15", "2026-11-01"]),
    );
  });

  it("every case is a View State the grid could hold: its filters pass validation, and it never groups", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      for (const c of check.cases) {
        expect(ViewState.safeParse(c.state).success, c.name).toBe(true);
        for (const predicate of predicatesOf(c.state.filters)) expect(filterIssues(predicate, s.schema), c.name).toEqual([]);
        for (const sort of c.state.sorts) {
          const column = s.schema.columns.find((col) => col.id === sort.columnId);
          expect(column?.capabilities, c.name).toContain("sort");
          expect(column?.sensitivity, c.name).not.toBe("restricted");
        }
        expect(c.state.groupBy, c.name).toEqual([]);
        expect(c.state.aggregations, c.name).toEqual([]);
        // Every case filters or sorts, but the one that asks for every row.
        expect(c.state.filters !== null || c.state.sorts.length > 0, c.name).toBe(
          c.name !== "no filters keep every row (no filter and no sort)",
        );
        // Every column shows, but in the cases about a hidden column, which hide the one they filter or sort by.
        const hidden = s.schema.columns.filter((col) => col.sensitivity !== "restricted" && !c.state.visibleColumnIds.includes(col.id));
        if (/^a filter on a hidden column still holds \(/.test(c.name)) {
          expect(
            hidden.map((col) => col.id),
            c.name,
          ).toEqual(predicatesOf(c.state.filters).map((p) => p.columnId));
        } else if (/^a sort on a hidden column still orders the rows \(/.test(c.name)) {
          expect(
            hidden.map((col) => col.id),
            c.name,
          ).toEqual(c.state.sorts.map((sort) => sort.columnId));
        } else expect(hidden, c.name).toEqual([]);
      }
    }
  });

  it("a column's own allow-list and capabilities narrow its cases", () => {
    const schema = defineSchema(
      [{ id: "key" }, { id: "name" }, { id: "note" }, { id: "score", kind: "number" }, { id: "rank", kind: "number" }],
      {
        columns: { name: { allowedOperators: ["contains"] }, note: { capabilities: ["show", "hide"] }, rank: { capabilities: ["filter"] } },
      },
    );
    const check = queryCheck(schema, { id: "key", operations: WITH_COUNT });
    expect(singles(check, "name").every((c) => predicatesOf(c.state.filters)[0]?.operator === "contains")).toBe(true);
    expect(singles(check, "name").length).toBe(7);
    expect(check.cases.some((c) => predicatesOf(c.state.filters).some((p) => p.columnId === "note"))).toBe(false);
    expect(check.cases.some((c) => c.state.sorts.some((sort) => sort.columnId === "rank" || sort.columnId === "note"))).toBe(false);
    expect(failuresOf(check, applyViewQuery(check, schema, "key"))).toEqual([]);
  });
});

describe("restricted columns never appear in a case", () => {
  it("not in a filter, a sort, the columns, or a name", () => {
    const check = full(checkOf(SUBJECTS[0] as Subject));
    for (const c of check.cases) {
      expect(JSON.stringify(c.state), c.name).not.toContain("tax_id");
      expect(c.name).not.toContain("Tax ID");
    }
  });

  it("nor does the id column in a filter or a sort", () => {
    for (const s of SUBJECTS) {
      for (const c of full(checkOf(s)).cases) {
        expect(
          predicatesOf(c.state.filters).some((p) => p.columnId === s.id),
          c.name,
        ).toBe(false);
        expect(
          c.state.sorts.some((sort) => sort.columnId === s.id),
          c.name,
        ).toBe(false);
      }
    }
  });
});

describe("a count case appears only when operations lists limit.set", () => {
  const counted = (check: QueryCheck) => check.cases.filter((c) => c.state.limit !== undefined);

  it("none with no operations, with the MVP operations, or with a default Query Adapter's", () => {
    for (const s of SUBJECTS) {
      expect(counted(full(queryCheck(s.schema, { id: s.id }))), s.name).toEqual([]);
      expect(counted(full(queryCheck(s.schema, { id: s.id, operations: MVP_OPERATIONS }))), s.name).toEqual([]);
      const adapter = createQueryAdapter({ schema: s.schema });
      expect(counted(full(queryCheck(s.schema, { id: s.id, operations: adapter.getCapabilities().operations }))), s.name).toEqual([]);
    }
  });

  it("with it, one for the first rows of the sorted, filtered rows, and one for rows with no value in the first sorted column", () => {
    for (const s of SUBJECTS) {
      const adapter = createQueryAdapter({ schema: s.schema, countBeforePaging: true });
      const check = queryCheck(s.schema, { id: s.id, operations: adapter.getCapabilities().operations });
      const cases = counted(check);
      expect([...new Set(cases.map((c) => c.name.replace(/ \(.*$/, "")))].sort(), s.name).toEqual([
        "a count keeps a row with no value in a later sorted column",
        "a count keeps the first rows of the sorted, filtered rows",
        "a count never keeps a row with no value in the first sorted column",
      ]);
      for (const c of cases) expect(c.state.sorts.length, c.name).toBeGreaterThan(0);
      // One that never keeps a row with no value for a number, date or yes/no column, and one for each text column,
      // where empty text is no value too.
      const textColumns = s.schema.columns
        .filter((col) => col.kind === "string" && col.id !== s.id && col.sensitivity !== "restricted")
        .map((col) => col.id);
      const kindOf = (columnId: string) => s.schema.columns.find((col) => col.id === columnId)?.kind;
      expect(
        cases
          .filter((c) => /^a count never keeps/.test(c.name))
          .map((c) => c.state.sorts[0]?.columnId)
          .filter((id) => textColumns.includes(id as string))
          .sort(),
        s.name,
      ).toEqual([...textColumns].sort());

      const first = theCase(check, /^a count keeps the first rows of the sorted, filtered rows/);
      expect(first.state.filters, first.name).not.toBeNull();
      const firstRows = applyView(check.rows, first.state, s.schema).rows;
      expect(firstRows.length, first.name).toBe(first.state.limit);
      // The cut falls between two different values, so rows that tie can't make a right Data Query fail.
      const { limit: _cut, ...uncut } = first.state;
      const sortId = first.state.sorts[0]?.columnId as string;
      const next = applyView(check.rows, { ...uncut, limit: (first.state.limit as number) + 1 }, s.schema).rows.at(-1);
      expect(next?.[sortId], first.name).not.toBe(firstRows.at(-1)?.[sortId]);
      // Cutting before the filter keeps other rows.
      const cutFirst = new Set(applyView(check.rows, { ...first.state, filters: null }, s.schema).rows.map((row) => row[s.id]));
      const filtered = applyView(check.rows, uncut, s.schema).rows.filter((row) => cutFirst.has(row[s.id] as Scalar));
      expect(filtered.map((row) => row[s.id]).sort(), first.name).not.toEqual(firstRows.map((row) => row[s.id]).sort());

      for (const never of check.cases.filter((c) => /^a count never keeps a row with no value in the first sorted column/.test(c.name))) {
        const neverId = never.state.sorts[0]?.columnId as string;
        const neverRows = applyView(check.rows, never.state, s.schema).rows;
        // It asks for more rows than hold a value, and gets only those.
        expect(neverRows.length, never.name).toBeLessThan(never.state.limit as number);
        expect(
          neverRows.some((row) => isEmptyCell(row[neverId])),
          never.name,
        ).toBe(false);
        expect(
          check.rows.some((row) => isEmptyCell(row[neverId])),
          never.name,
        ).toBe(true);
        // On a text or enum column, empty text is among the rows left out.
        if (textColumns.includes(neverId) || kindOf(neverId) === "enum")
          expect(
            check.rows.some((row) => row[neverId] === ""),
            never.name,
          ).toBe(true);
      }

      // A row with a value in the first sorted column and none in the second has its place by the first. The cut falls
      // between two values of the first column, with such a row before it and a row with both values after it, so a
      // Data Query that puts every row with an empty sort cell last, then cuts, leaves that row out.
      const later = theCase(check, /^a count keeps a row with no value in a later sorted column \(/);
      expect(later.state.sorts, later.name).toHaveLength(2);
      expect(later.state.filters, later.name).toBeNull();
      const [lead, then] = later.state.sorts.map((sort) => sort.columnId) as [string, string];
      const laterRows = applyView(check.rows, later.state, s.schema).rows;
      expect(laterRows.length, later.name).toBe(later.state.limit);
      expect(
        laterRows.some((row) => isEmptyCell(row[then])),
        later.name,
      ).toBe(true);
      const { limit: _laterCut, ...laterUncut } = later.state;
      const beyond = applyView(check.rows, { ...laterUncut, limit: check.rows.length }, s.schema).rows.slice(later.state.limit);
      expect(beyond[0]?.[lead], later.name).not.toBe(laterRows.at(-1)?.[lead]);
      expect(
        beyond.some((row) => !isEmptyCell(row[then])),
        later.name,
      ).toBe(true);
    }
  });

  it("their names say the view", () => {
    const names = checkOf(SUBJECTS[1] as Subject).cases.map((c) => c.name);
    expect(
      names.some((name) => /^a count keeps the first rows of the sorted, filtered rows \(the first \d+ rows, sorted by /.test(name)),
    ).toBe(true);
  });
});

describe("a few cases filter two columns and sort two columns", () => {
  for (const s of SUBJECTS) {
    it(`${s.name}: two filters joined with and, an or group, and an or group inside an and`, () => {
      const check = checkOf(s);
      const both = theCase(check, /^filters on two columns must both hold \(/);
      expect(both.state.filters?.combinator).toBe("and");
      expect(new Set(predicatesOf(both.state.filters).map((p) => p.columnId)).size).toBe(2);

      const either = theCase(check, /^an or group keeps a row that either filter keeps \(/);
      expect(either.state.filters?.combinator).toBe("or");
      expect(new Set(predicatesOf(either.state.filters).map((p) => p.columnId)).size).toBe(2);

      const nested = theCase(check, /^an or group inside an and keeps its own brackets \(/);
      const group = nested.state.filters as FilterGroup;
      expect(group.combinator).toBe("and");
      expect(group.children.filter((child) => child.type === "group" && child.combinator === "or")).toHaveLength(1);
      expect(new Set(predicatesOf(group).map((p) => p.columnId)).size).toBeGreaterThanOrEqual(2);
      // Every filter and group in a case has its own id, as in a View State GridCue builds.
      const ids = (g: FilterGroup): string[] => [
        g.id,
        ...g.children.flatMap((child) => (child.type === "group" ? ids(child) : [child.id])),
      ];
      for (const c of [both, either, nested])
        expect(new Set(ids(c.state.filters as FilterGroup)).size).toBe(ids(c.state.filters as FilterGroup).length);
    });

    it(`${s.name}: two sorts, each direction on each column`, () => {
      const check = checkOf(s);
      const sorted = check.cases.filter((c) => /^sorts by each column in turn, in its direction \(/.test(c.name));
      expect(sorted).toHaveLength(2);
      const [a, b] = sorted.map((c) => c.state.sorts);
      expect(a).toHaveLength(2);
      expect(b?.map((sort) => sort.columnId)).toEqual(a?.map((sort) => sort.columnId));
      expect(a?.[0]?.direction).not.toBe(a?.[1]?.direction);
      expect(b?.map((sort) => sort.direction)).toEqual(a?.map((sort) => (sort.direction === "asc" ? "desc" : "asc")));
      for (const c of sorted) expect(c.state.limit).toBeUndefined();
    });
  }

  it("the cases that sort two columns or cut a count sort numbers, dates and yes/no; a text column is sorted on its own", () => {
    const ordered = ["number", "currency", "percent", "date", "datetime", "boolean"];
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      const kindOf = (columnId: string) => s.schema.columns.find((column) => column.id === columnId)?.kind;
      for (const c of check.cases.filter((c) =>
        /^(sorts by each column in turn|a count keeps the first rows|a count keeps a row with no value in a later|a sort with no count)/.test(
          c.name,
        ),
      )) {
        for (const sort of c.state.sorts) expect(ordered, c.name).toContain(kindOf(sort.columnId));
      }
      const text = check.cases.filter((c) => /^text sorts by its letters, ignoring case \(/.test(c.name));
      const textColumns = s.schema.columns.filter((col) => col.kind === "string" && col.id !== s.id && col.sensitivity !== "restricted");
      expect(text, s.name).toHaveLength(2 * textColumns.length);
      for (const c of text) {
        expect(c.state.sorts, c.name).toHaveLength(1);
        expect(kindOf(c.state.sorts[0]?.columnId as string), c.name).toBe("string");
        expect(c.state.filters, c.name).toBeNull();
      }
      // An enum column is sorted on its own too, by its values' IDs, each way. It is sorted only in its own cases, with
      // its column hidden, and in the count about rows with no value.
      const enumSorts = check.cases.filter((c) => /^an enum sorts by its values' IDs, ignoring case \(/.test(c.name));
      const sortableEnums = s.schema.columns.filter(
        (col) => col.kind === "enum" && col.capabilities.includes("sort") && col.sensitivity !== "restricted",
      );
      expect(sortableEnums.length, s.name).toBeGreaterThan(0);
      expect(enumSorts.map((c) => `${c.state.sorts[0]?.columnId} ${c.state.sorts[0]?.direction}`).sort(), s.name).toEqual(
        sortableEnums.flatMap((col) => [`${col.id} asc`, `${col.id} desc`]).sort(),
      );
      for (const c of enumSorts) {
        expect(c.state.sorts, c.name).toHaveLength(1);
        expect(c.state.filters, c.name).toBeNull();
      }
      for (const c of check.cases.filter((c) => c.state.sorts.some((sort) => kindOf(sort.columnId) === "enum"))) {
        expect(c.name).toMatch(
          /^(an enum sorts by its values' IDs, ignoring case|a sort on a hidden column still orders the rows|a count never keeps a row with no value in the first sorted column) \(/,
        );
        expect(c.state.sorts, c.name).toHaveLength(1);
      }
    }
  });

  it("an enum sorts by its values' IDs as text: not in the order they are declared, and the sort is never dropped", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      const enumSorts = check.cases.filter((c) => /^an enum sorts by its values' IDs, ignoring case \(/.test(c.name));
      expect(enumSorts.length, s.name).toBeGreaterThan(0);
      for (const c of enumSorts) {
        const sort = c.state.sorts[0] as { columnId: string; direction: "asc" | "desc" };
        const column = s.schema.columns.find((col) => col.id === sort.columnId) as ColumnDescriptor;
        const declared = (column.enumValues ?? []).map((value) => value.id);
        const ids = applyView(check.rows, c.state, s.schema).rows.map((row) => row[s.id] as string | number);
        expect(c.compare(ids), c.name).toEqual({ ok: true });
        const cellOf = (id: string | number) => check.rows.find((row) => String(row[s.id]) === String(id))?.[sort.columnId];
        // In the order the values are declared, as a database's own enum type sorts them.
        const rank = (id: string | number) => {
          const at = declared.indexOf(String(cellOf(id)));
          return at < 0 ? declared.length : at;
        };
        const inDeclaredOrder = [...ids].sort((a, b) => (sort.direction === "desc" ? rank(b) - rank(a) : rank(a) - rank(b)));
        const declaredResult = c.compare(inDeclaredOrder);
        expect(declaredResult.ok === false && declaredResult.message, c.name).toMatch(/: wrong order: id \S+ came where id \S+ belongs$/);
        // The rows as they were loaded, as a Data Query that drops the sort returns them.
        const unsorted = c.compare(check.rows.map((row) => row[s.id] as string | number));
        expect(unsorted.ok === false && unsorted.message, c.name).toMatch(/: wrong order: id \S+ came where id \S+ belongs$/);
      }
    }
  });
});

describe("each filter holds beside others, on a hidden column, and twice on one column", () => {
  for (const s of SUBJECTS) {
    it(`${s.name}: each filter beside a filter on another column that leaves out a row of each value it keeps`, () => {
      const check = full(checkOf(s));
      const bracketed = check.cases.filter((c) => /^a filter joined with and keeps its own brackets \(/.test(c.name));
      const filtering = check.cases.filter((c) => {
        const [only, ...others] = c.state.filters?.children ?? [];
        return only?.type === "predicate" && others.length === 0 && c.state.sorts.length === 0 && c.state.limit === undefined;
      });
      // Every filter that keeps a row has its case, but where no other filter leaves out a row of each value it keeps.
      expect(bracketed.length, s.name).toBeGreaterThan(filtering.length * 0.8);
      for (const c of bracketed) {
        const [other, own] = predicatesOf(c.state.filters) as [FilterPredicate, FilterPredicate];
        expect(c.state.filters?.combinator, c.name).toBe("and");
        expect(other.columnId, c.name).not.toBe(own.columnId);
        const keptBy = (p: FilterPredicate) =>
          new Set(
            applyView(check.rows, { ...c.state, filters: { id: "root", type: "group", combinator: "and", children: [p] } }, s.schema).rows,
          );
        const [byOther, byOwn] = [keptBy(other), keptBy(own)];
        const values = new Set([...byOwn].map((row) => JSON.stringify(row[own.columnId] ?? null)));
        const leftOut = new Set(check.rows.filter((row) => !byOther.has(row)).map((row) => JSON.stringify(row[own.columnId] ?? null)));
        for (const value of values) expect(leftOut.has(value), `${c.name}: ${value}`).toBe(true);
      }
    });

    it(`${s.name}: a filter on each column, with that column hidden`, () => {
      const check = full(checkOf(s));
      const hidden = check.cases.filter((c) => /^a filter on a hidden column still holds \(/.test(c.name));
      const filterable = s.schema.columns.filter(
        (c) => c.sensitivity !== "restricted" && c.id !== s.id && c.capabilities.includes("filter"),
      );
      expect(hidden.map((c) => predicatesOf(c.state.filters)[0]?.columnId).sort(), s.name).toEqual(filterable.map((c) => c.id).sort());
      for (const c of hidden) {
        const kept = applyView(check.rows, c.state, s.schema).rows.length;
        expect(kept, c.name).toBeGreaterThan(0);
        expect(kept, c.name).toBeLessThan(check.rows.length);
      }
    });

    it(`${s.name}: a sort on each column the check sorts by, with that column hidden`, () => {
      const check = full(checkOf(s));
      const hidden = check.cases.filter((c) => /^a sort on a hidden column still orders the rows \(/.test(c.name));
      const sortedBy = new Set(check.cases.flatMap((c) => c.state.sorts.map((sort) => sort.columnId)));
      expect(hidden.map((c) => c.state.sorts[0]?.columnId).sort(), s.name).toEqual([...sortedBy].sort());
      // The rows in the order they were loaded, as a Data Query that drops the sort returns them.
      const loaded = check.rows.map((row) => row[s.id] as string | number);
      for (const c of hidden) {
        expect(c.state.sorts, c.name).toHaveLength(1);
        expect(c.state.filters, c.name).toBeNull();
        expect(c.state.limit, c.name).toBeUndefined();
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
        const unsorted = c.compare(loaded);
        expect(unsorted.ok === false && unsorted.message, c.name).toMatch(/: wrong order: id \S+ came where id \S+ belongs$/);
      }
    });

    it(`${s.name}: two filters on each column, each leaving out rows the other keeps`, () => {
      const check = full(checkOf(s));
      const twice = check.cases.filter((c) => /^two filters on one column must both hold \(/.test(c.name));
      const filterable = s.schema.columns.filter(
        (c) => c.sensitivity !== "restricted" && c.id !== s.id && c.capabilities.includes("filter"),
      );
      expect(twice).toHaveLength(filterable.length);
      for (const c of twice) {
        const [a, b] = predicatesOf(c.state.filters) as [FilterPredicate, FilterPredicate];
        expect(a.columnId, c.name).toBe(b.columnId);
        const ids = (p: FilterPredicate[]) =>
          new Set(
            applyView(check.rows, { ...c.state, filters: { id: "root", type: "group", combinator: "and", children: p } }, s.schema).rows,
          );
        const [both, onlyA, onlyB] = [ids([a, b]), ids([a]), ids([b])];
        expect(both.size, c.name).toBeLessThan(onlyA.size);
        expect(both.size, c.name).toBeLessThan(onlyB.size);
      }
    });
  }
});

// --- compare -----------------------------------------------------------------------------------------------------

describe("compare(ids)", () => {
  // The spec's own example: an id that is no column, so the ids are the rows' numbers.
  const schema = defineSchema(
    [
      { id: "custodian", label: "Custodian" },
      { id: "market_value", label: "Market value", kind: "currency" },
      { id: "units", kind: "number" },
    ],
    {
      columns: {
        custodian: {
          enumValues: [
            { id: "northgate", label: "Northgate" },
            { id: "harborline", label: "Harborline" },
          ],
        },
      },
    },
  );
  const check = queryCheck(schema, { id: "account_id", operations: WITH_COUNT });
  const expected = (c: QueryCheckCase) => applyView(check.rows, c.state, schema).rows.map((row) => row.account_id as number);
  let notEqual: QueryCheckCase;
  beforeAll(() => {
    notEqual = theCase(check, /^not equal keeps empty cells \(Custodian is not Northgate\)$/);
  });

  it("returns ok for the expected ids, in any order when the case doesn't sort", () => {
    const ids = expected(notEqual);
    expect(ids.length).toBeGreaterThan(3);
    expect(notEqual.compare(ids)).toEqual({ ok: true });
    expect(notEqual.compare([...ids].reverse())).toEqual({ ok: true });
  });

  it("names the case and the missing ids, as the spec's example reads", () => {
    const ids = expected(notEqual);
    const empties = check.rows
      .filter((row) => row.custodian === null)
      .map((row) => row.account_id as number)
      .sort((a, b) => a - b);
    expect(empties.length).toBeGreaterThanOrEqual(2);
    const [a, b] = empties as [number, number];
    expect(notEqual.compare(ids.filter((id) => id !== a && id !== b))).toEqual({
      ok: false,
      message: `not equal keeps empty cells (Custodian is not Northgate): 2 rows missing, ids ${a} and ${b}`,
    });
    expect(notEqual.compare(ids.filter((id) => id !== a))).toEqual({
      ok: false,
      message: `not equal keeps empty cells (Custodian is not Northgate): 1 row missing, id ${a}`,
    });
  });

  it("names the extra ids, and both when rows are missing too", () => {
    const ids = expected(notEqual);
    // The message names ids in order, smallest first.
    const others = check.rows
      .map((row) => row.account_id as number)
      .filter((id) => !ids.includes(id))
      .sort((a, b) => a - b);
    const [x, y, z] = others as [number, number, number];
    expect(notEqual.compare([...ids, x])).toEqual({
      ok: false,
      message: `not equal keeps empty cells (Custodian is not Northgate): 1 row extra, id ${x}`,
    });
    expect(notEqual.compare([z, ...ids, y, x])).toEqual({
      ok: false,
      message: `not equal keeps empty cells (Custodian is not Northgate): 3 rows extra, ids ${x}, ${y} and ${z}`,
    });
    const [gone, ...rest] = ids as [number, ...number[]];
    expect(notEqual.compare([...rest, x])).toEqual({
      ok: false,
      message: `not equal keeps empty cells (Custodian is not Northgate): 1 row missing, id ${gone}; 1 row extra, id ${x}`,
    });
  });

  it("an id of no row is extra, and a long list is cut short", () => {
    const ids = expected(notEqual);
    const unknown = notEqual.compare([...ids, 9001]);
    expect(unknown.ok === false && unknown.message).toBe("not equal keeps empty cells (Custodian is not Northgate): 1 row extra, id 9001");
    const none = notEqual.compare([]);
    expect(none.ok).toBe(false);
    expect(ids.length).toBeGreaterThan(10);
    expect(none.ok === false && none.message).toBe(
      `not equal keeps empty cells (Custodian is not Northgate): ${ids.length} rows missing, ids ${[...ids]
        .sort((a, b) => a - b)
        .slice(0, 10)
        .join(", ")} and ${ids.length - 10} more`,
    );
  });

  it("checks the ids as a set: a repeated id is one id, and text and number ids are the same id", () => {
    const ids = expected(notEqual);
    expect(notEqual.compare([...ids, ...ids])).toEqual({ ok: true });
    expect(notEqual.compare(ids.map(String))).toEqual({ ok: true });
    // An id column of the schema that holds text: the ids are text, and numbers still match.
    const wealth = checkOf(SUBJECTS[0] as Subject);
    const c = wealth.cases[0] as QueryCheckCase;
    const textIds = applyView(wealth.rows, c.state, WEALTH).rows.map((row) => row.account_number);
    expect(textIds.every((id) => typeof id === "string")).toBe(true);
    expect(c.compare(textIds.map(Number))).toEqual({ ok: true });
  });

  it("anything but a list of ids throws, in plain words", () => {
    for (const bad of [undefined, null, "1,2,3", 7, { ids: [1] }]) {
      expect(() => notEqual.compare(bad as never)).toThrow(/compare takes the ids your Data Query returned/);
    }
    expect(() => notEqual.compare([{ account_id: 1 }] as never)).toThrow(/compare takes the ids your Data Query returned/);
  });

  describe("when the case sorts", () => {
    const sorted = check.cases.filter((c) => /^sorts by each column in turn/.test(c.name));
    const cellsFor = (c: QueryCheckCase, id: number) => {
      const row = check.rows.find((r) => r.account_id === id) as Row;
      return c.state.sorts.map((sort) => row[sort.columnId] as Scalar);
    };
    const hasEmpty = (c: QueryCheckCase, id: number) => cellsFor(c, id).some(isEmptyCell);

    it("the expected order is ok, and so is any place for the rows with an empty sort cell", () => {
      expect(sorted).toHaveLength(2);
      for (const c of sorted) {
        const ids = expected(c);
        expect(c.compare(ids), c.name).toEqual({ ok: true });
        const withValue = ids.filter((id) => !hasEmpty(c, id));
        const without = ids.filter((id) => hasEmpty(c, id));
        expect(without.length, c.name).toBeGreaterThan(0);
        expect(c.compare([...without, ...withValue]), c.name).toEqual({ ok: true });
        expect(c.compare([...withValue, ...without.reverse()]), c.name).toEqual({ ok: true });
        const half = Math.floor(withValue.length / 2);
        expect(c.compare([...withValue.slice(0, half), ...without, ...withValue.slice(half)]), c.name).toEqual({ ok: true });
      }
    });

    it("rows that tie on every sorted column may come in either order", () => {
      for (const c of sorted) {
        const ids = expected(c).filter((id) => !hasEmpty(c, id));
        const at = ids.findIndex((id, i) => i > 0 && JSON.stringify(cellsFor(c, id)) === JSON.stringify(cellsFor(c, ids[i - 1] as number)));
        expect(at, c.name).toBeGreaterThan(0);
        const swapped = [...ids];
        [swapped[at - 1], swapped[at]] = [swapped[at] as number, swapped[at - 1] as number];
        const rest = expected(c).filter((id) => hasEmpty(c, id));
        expect(c.compare([...swapped, ...rest]), c.name).toEqual({ ok: true });
      }
    });

    it("the right rows in the wrong order fail, and the message names the case and the first row out of place", () => {
      for (const c of sorted) {
        const ids = expected(c);
        const withValue = ids.filter((id) => !hasEmpty(c, id));
        const reversed = c.compare([...ids].reverse());
        expect(reversed.ok, c.name).toBe(false);
        expect(reversed.ok === false && reversed.message).toBe(
          `${c.name}: wrong order: id ${withValue.at(-1)} came where id ${withValue[0]} belongs`,
        );
        // Two neighbours that differ in a sorted column, swapped.
        const at = withValue.findIndex(
          (id, i) => i > 0 && JSON.stringify(cellsFor(c, id)) !== JSON.stringify(cellsFor(c, withValue[i - 1] as number)),
        );
        const swapped = [...withValue];
        [swapped[at - 1], swapped[at]] = [swapped[at] as number, swapped[at - 1] as number];
        const result = c.compare([...swapped, ...ids.filter((id) => hasEmpty(c, id))]);
        expect(result.ok === false && result.message, c.name).toBe(
          `${c.name}: wrong order: id ${withValue[at]} came where id ${withValue[at - 1]} belongs`,
        );
      }
    });

    it("missing and extra rows are named before any order is checked", () => {
      const c = sorted[0] as QueryCheckCase;
      const [first, ...rest] = expected(c) as [number, ...number[]];
      const result = c.compare(rest.reverse());
      expect(result.ok === false && result.message).toBe(`${c.name}: 1 row missing, id ${first}`);
    });

    it("on a text column, only text of the letters A to Z has a place, and letter case never decides it", () => {
      const s = SUBJECTS[0] as Subject;
      const wealth = checkOf(s);
      for (const c of wealth.cases.filter((c) => /^text sorts by its letters, ignoring case \(/.test(c.name))) {
        const columnId = c.state.sorts[0]?.columnId as string;
        const ids = applyView(wealth.rows, c.state, WEALTH).rows.map((row) => row.account_number as string);
        const cellOf = (id: string) => wealth.rows.find((row) => row.account_number === id)?.[columnId];
        const letters = (id: string) => /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(String(cellOf(id)));
        expect(c.compare(ids), c.name).toEqual({ ok: true });
        // Any other text may go anywhere, as a database's collation puts it.
        expect(c.compare([...ids.filter((id) => !letters(id)).reverse(), ...ids.filter(letters)]), c.name).toEqual({ ok: true });
        // Ordered by character code, "cedar Row" comes after "Elm Garth": that fails.
        const byCode = [...ids].sort((a, b) => {
          const [x, y] = [String(cellOf(a) ?? ""), String(cellOf(b) ?? "")];
          const d = x < y ? -1 : x > y ? 1 : 0;
          return c.state.sorts[0]?.direction === "desc" ? -d : d;
        });
        const result = c.compare(byCode);
        expect(result.ok, c.name).toBe(false);
        expect(result.ok === false && result.message, c.name).toMatch(/: wrong order: id \d+ came where id \d+ belongs$/);
      }
    });

    it("a count case checks its rows as a set and their order too", () => {
      const c = theCase(check, /^a count keeps the first rows of the sorted, filtered rows/);
      const ids = expected(c);
      expect(c.compare(ids)).toEqual({ ok: true });
      const reversed = c.compare([...ids].reverse());
      expect(reversed.ok === false && reversed.message).toMatch(/: wrong order: id \d+ came where id \d+ belongs$/);
    });
  });
});

// --- The same schema and options always give the same rows and cases -------------------------------------------

describe("the Query Check is deterministic", () => {
  const shape = (check: QueryCheck) => ({ rows: check.rows, cases: check.cases.map((c) => ({ name: c.name, state: c.state })) });

  it("two calls give the same rows and cases, and share nothing", () => {
    for (const s of SUBJECTS) {
      const [a, b] = [checkOf(s), checkOf(s)];
      expect(JSON.stringify(shape(a)), s.name).toBe(JSON.stringify(shape(b)));
      (a.rows[0] as Row)[s.id] = "changed";
      (a.cases[0] as QueryCheckCase).state.sorts.push({ columnId: "x", direction: "asc" });
      expect(JSON.stringify(shape(checkOf(s))), s.name).toBe(JSON.stringify(shape(b)));
    }
  });

  it("the rows don't depend on operations, and a count only adds cases", () => {
    for (const s of SUBJECTS) {
      const [without, withCount] = [queryCheck(s.schema, { id: s.id }), checkOf(s)];
      expect(withCount.rows, s.name).toEqual(without.rows);
      const names = withCount.cases.map((c) => c.name);
      for (const c of without.cases) expect(names, s.name).toContain(c.name);
      const added = names.filter((name) => !without.cases.some((c) => c.name === name));
      expect(added.length, s.name).toBeGreaterThanOrEqual(2);
      for (const name of added) expect(name, s.name).toMatch(/^a count /);
    }
  });

  it("a column's cells don't change when another column joins the schema", () => {
    const more = defineSchema([...ledgerColumns, { id: "memo", label: "Memo" }], ledgerOptions);
    const [a, b] = [full(queryCheck(LEDGER, { id: "entry_number" })), full(queryCheck(more, { id: "entry_number" }))];
    for (const column of ledgerColumns) expect(cellsOf(b, column.id), column.id).toEqual(cellsOf(a, column.id));
    expect(cellsOf(b, "memo")).toContain("");
  });

  it("the machine's own time zone changes nothing, with a Calendar time zone or without", async () => {
    const before = process.env.TZ;
    const under = async (timeZone: string) => {
      process.env.TZ = timeZone;
      // Core reads the browser's zone once for each task.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(timeZone);
      return SUBJECTS.map((s) => {
        const check = full(checkOf(s));
        return { check, ids: check.cases.map((c) => applyViewQuery(check, s.schema, s.id)(c.state)) };
      });
    };
    try {
      const auckland = await under("Pacific/Auckland");
      const honolulu = await under("Pacific/Honolulu");
      auckland.forEach((there, i) => {
        const here = honolulu[i] as (typeof honolulu)[number];
        expect(JSON.stringify(shape(here.check))).toBe(JSON.stringify(shape(there.check)));
        // What a case expects was worked out in one zone, and the rows applyView keeps in the other still pass it.
        here.check.cases.forEach((c, n) => {
          expect(c.compare(there.ids[n] as Ids), c.name).toEqual({ ok: true });
        });
        there.check.cases.forEach((c, n) => {
          expect(c.compare(here.ids[n] as Ids), c.name).toEqual({ ok: true });
        });
      });
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
});

// --- Bad input ---------------------------------------------------------------------------------------------------

describe("what the Host passes is checked", () => {
  const codeOf = (run: () => unknown): string | undefined => {
    try {
      run();
    } catch (error) {
      return isGridCueError(error) ? `${error.code}: ${error.message}` : `not a GridCueError: ${String(error)}`;
    }
    return undefined;
  };

  it("an id that is missing or empty throws INPUT_CONFIG", () => {
    expect(codeOf(() => queryCheck(WEALTH, {} as never))).toMatch(/^INPUT_CONFIG: .*id/);
    expect(codeOf(() => queryCheck(WEALTH, { id: "" }))).toMatch(/^INPUT_CONFIG: .*id/);
    expect(codeOf(() => queryCheck(WEALTH, undefined as never))).toMatch(/^INPUT_CONFIG: /);
  });

  it("an id column that can't hold ids throws INPUT_CONFIG, naming it", () => {
    expect(codeOf(() => queryCheck(WEALTH, { id: "custodian" }))).toMatch(/^INPUT_CONFIG: .*Custodian/);
    expect(codeOf(() => queryCheck(LEDGER, { id: "booked" }))).toMatch(/^INPUT_CONFIG: .*Booked/);
    expect(codeOf(() => queryCheck(LEDGER, { id: "units" }))).toBeUndefined();
    const { rows } = queryCheck(LEDGER, { id: "units" });
    expect(rows.map((row) => row.units as number).sort((a, b) => a - b)).toEqual(rows.map((_, i) => i + 1));
  });

  it("operations and notNull that aren't lists of names throw INPUT_CONFIG", () => {
    expect(codeOf(() => queryCheck(WEALTH, { id: "account_number", operations: "limit.set" as never }))).toMatch(
      /^INPUT_CONFIG: .*operations/,
    );
    expect(codeOf(() => queryCheck(WEALTH, { id: "account_number", notNull: "household" as never }))).toMatch(/^INPUT_CONFIG: .*notNull/);
  });

  it("something that is no View Schema throws INPUT_SCHEMA", () => {
    expect(codeOf(() => queryCheck({ columns: "none" } as never, { id: "key" }))).toMatch(/^INPUT_SCHEMA: /);
    expect(codeOf(() => queryCheck(undefined as never, { id: "key" }))).toMatch(/^INPUT_SCHEMA: /);
    const unknownZone = { ...LEDGER, calendar: { timeZone: "Mars/Olympus" } };
    expect(codeOf(() => queryCheck(unknownZone, { id: "entry_number" }))).toMatch(/^INPUT_SCHEMA: .*time zone/);
  });

  it("a schema with nothing to check gives rows and no cases", () => {
    const schema = defineSchema([{ id: "key" }, { id: "secret" }], { restricted: ["secret"] });
    const check = queryCheck(schema, { id: "key", operations: WITH_COUNT });
    expect(check.cases).toEqual([]);
    expect(check.rows.length).toBeGreaterThan(0);
  });
});

// --- The self-check: a right Data Query passes, and each wrong translation fails the case that names its rule ---

/**
 * A wrong translation of the View State, as a Host might write it. Each is a habit from SQL or from a quick reading of
 * the table in 4.1.
 */
type Mistake =
  | "not equal drops empty cells"
  | "not equal is case-sensitive on text"
  | "equal is case-sensitive on text"
  | "equal on text is a pattern match"
  | "only the column's letter case is ignored"
  | "in is case-sensitive on text"
  | "an empty number is zero"
  | "no keeps empty cells"
  | "LIKE is case-sensitive"
  | "LIKE wildcards are not escaped"
  | "greater than includes the value"
  | "at most leaves out the value"
  | "numbers are compared as text"
  | "between leaves out its ends"
  | "is empty trims the text"
  | "is empty takes zero"
  | "is empty is null only"
  | "an empty operand drops null"
  | "dates are compared as text"
  | "a day is the UTC day"
  | "the count is cut before the filter"
  | "the count keeps rows with no value"
  | "the count leaves out a row with no value in any sorted column"
  | "the count is cut before the sort"
  | "everything is joined with and"
  | "an or group loses its brackets"
  | "the sort ignores direction"
  | "only the first sort is used"
  | "the sorts are used in reverse"
  // The classes the held-out round found, each written here afresh.
  | "not equal to empty text keeps empty text"
  | "the operand is trimmed"
  | "is empty keeps placeholder text"
  | "a filter loses its brackets"
  | "only the last filter on a column holds"
  | "text sorts by character code"
  | "the count keeps rows with empty text"
  | "a filter on a hidden column is dropped"
  | "lower folds only A to Z"
  | "the ids are the row numbers"
  | "a time with no offset is read as UTC"
  | "equal on text keeps empty cells"
  | "contains keeps empty cells"
  | "no filters keep no rows"
  | "a sort with no count drops rows with no value"
  // The classes the second held-out round found, each written here afresh.
  | "a list drops empty text beside other values"
  | "LIKE leaves its escape character \\ as it is"
  | "LIKE leaves its escape character ! as it is"
  | "a sort on a hidden column is dropped"
  // The classes the review of the Query Check found, each written here afresh.
  | "text is compared ignoring accents"
  | "is empty on an enum is null only"
  | "a sort on an enum is dropped"
  | "an enum sorts in the order its values are declared"
  | "a row with an empty sort cell goes last, then the count cuts";

const NUMERIC_KINDS = new Set(["number", "currency", "percent"]);
const textOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A Data Query written by hand from the table in 4.1, the way a Host translates a View State for a database, with one
 * mistake when asked. It shares no code with core. Where the table leaves a choice it takes the other one from
 * `applyView`: empty cells sort first, and rows that tie come in the reverse of the rows' own order. With `byInstant`
 * it orders a date-and-time column by the instant each cell names, as a database that stores instants does, where
 * `applyView` orders the cells as text.
 */
const handQuery = (check: QueryCheck, schema: ViewSchema, id: string, mistake?: Mistake, byInstant = false): DataQuery => {
  const zone = schema.calendar?.timeZone;
  const dayIn = zone ? new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }) : undefined;
  const clockIn = zone
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : undefined;
  /** The instant a date-and-time cell names: with "Z" as written, with no offset that clock time in the Calendar's zone. */
  const instantOf = (text: string): number => {
    const asUtc = Date.parse(text.endsWith("Z") ? text : `${text}Z`);
    if (text.endsWith("Z") || !clockIn) return asUtc;
    const ahead = (at: number) => {
      const p = Object.fromEntries(clockIn.formatToParts(at).map((part) => [part.type, Number(part.value)]));
      return Date.UTC(p.year as number, (p.month as number) - 1, p.day, p.hour, p.minute, p.second) - at;
    };
    return asUtc - ahead(asUtc - ahead(asUtc));
  };
  /** The day a date or date-and-time cell is on. */
  const dayOf = (cell: Scalar): string => {
    const text = String(cell);
    // A time with no offset, read as UTC and then taken to the Calendar's day.
    if (mistake === "a time with no offset is read as UTC" && dayIn && text.length > 10 && !text.endsWith("Z")) {
      return dayIn.format(new Date(`${text}Z`));
    }
    if (!text.endsWith("Z") || mistake === "a day is the UTC day") return text.slice(0, 10);
    return (dayIn as Intl.DateTimeFormat).format(new Date(text));
  };
  const lower = (v: unknown) => {
    if (mistake === "lower folds only A to Z") return String(v).replace(/[A-Z]+/g, (s) => s.toLowerCase());
    // A collation that ignores accents, such as MySQL's default: Å is A.
    if (mistake === "text is compared ignoring accents") return String(v).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    return String(v).toLowerCase();
  };
  const PLACEHOLDERS: unknown[] = ["N/A", "n/a", "NA", "-", "--", "none"];
  /** What the filter asks for, without letter case: "LOWER(column) = ?" forgets this side. */
  const asked = (v: unknown) => (mistake === "only the column's letter case is ignored" ? String(v) : lower(v));
  /** SQL's LIKE with the value put straight in the pattern: % is any text and _ any one character. */
  const pattern = (needle: string) =>
    needle
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/%/g, ".*")
      .replace(/_/g, ".");
  const trim = (v: unknown) => (typeof v === "string" ? v.trim() : v);
  const keeps = (cell: Scalar, p: Pick<FilterPredicate, "operator" | "value">, column: ColumnDescriptor): boolean => {
    const text = column.kind === "string";
    const trimmed = text && mistake === "the operand is trimmed";
    const value = (trimmed ? (Array.isArray(p.value) ? p.value.map(trim) : trim(p.value)) : p.value) as FilterPredicate["value"];
    const dated = column.kind === "date" || column.kind === "datetime";
    const numeric = NUMERIC_KINDS.has(column.kind);
    const empty = isEmptyCell(cell);
    const equalText = (target: Scalar, caseSensitive: boolean): boolean => {
      if (target === "") return mistake === "an empty operand drops null" ? cell === "" : empty;
      if (empty) return mistake === "equal on text keeps empty cells";
      if (mistake === "equal on text is a pattern match") return new RegExp(`^${pattern(String(target))}$`, "is").test(String(cell));
      return caseSensitive ? cell === target : lower(cell) === asked(target);
    };
    /** Below zero, zero or above: the cell against one end. */
    const sign = (target: Scalar): number => {
      if (dated)
        return mistake === "dates are compared as text" ? textOrder(String(cell), String(target)) : textOrder(dayOf(cell), String(target));
      if (mistake === "numbers are compared as text") return textOrder(String(cell), String(target));
      return (cell as number) - (target as number);
    };
    const zeroForEmpty = numeric && mistake === "an empty number is zero";
    const compared = (test: (s: number) => boolean, target: Scalar): boolean => {
      if (empty) return zeroForEmpty ? test(0 - (target as number)) : false;
      return test(sign(target));
    };
    switch (p.operator) {
      case "isEmpty":
        if (mistake === "is empty trims the text") return empty || (typeof cell === "string" && cell.trim() === "");
        if (mistake === "is empty takes zero") return empty || cell === 0;
        if (mistake === "is empty is null only") return cell === null;
        if (mistake === "is empty on an enum is null only" && column.kind === "enum") return cell === null;
        if (mistake === "is empty keeps placeholder text") return empty || PLACEHOLDERS.includes(cell);
        return empty;
      case "isNotEmpty":
        return !keeps(cell, { operator: "isEmpty" }, column);
      case "eq":
        if (dated) return !empty && (mistake === "dates are compared as text" ? cell === value : dayOf(cell) === value);
        if (text) return equalText(value as Scalar, mistake === "equal is case-sensitive on text");
        if (column.kind === "boolean" && value === false && mistake === "no keeps empty cells") return cell !== true;
        if (zeroForEmpty) return (cell ?? 0) === value;
        return cell === value;
      case "neq":
        // Not equal to empty text keeps every value: on text an empty cell is empty text.
        if (text && value === "") return mistake === "not equal to empty text keeps empty text" ? cell !== null : !empty;
        if (empty) return zeroForEmpty ? value !== 0 : mistake !== "not equal drops empty cells";
        return text && mistake !== "not equal is case-sensitive on text" ? lower(cell) !== asked(value) : cell !== value;
      case "in": {
        const listed = value as Scalar[];
        // "IN (?, ?)" with the empty text taken out, as if "" were only ever asked for on its own.
        const kept =
          mistake === "a list drops empty text beside other values" && listed.length > 1 ? listed.filter((v) => v !== "") : listed;
        return kept.some((target) => (text ? equalText(target, mistake === "in is case-sensitive on text") : !empty && cell === target));
      }
      case "contains":
      case "startsWith": {
        const start = p.operator === "startsWith";
        if (mistake === "LIKE wildcards are not escaped") {
          // NULL never matches a pattern.
          return cell !== null && new RegExp(start ? `^${pattern(String(value))}` : pattern(String(value)), "is").test(String(cell));
        }
        // LIKE with "ESCAPE '\'" (or '!'), where % and _ are escaped and the escape character itself is not. In the
        // pattern each escape character makes the one after it plain text and is gone; one at the end matches nothing.
        const escapeCharacter =
          mistake === "LIKE leaves its escape character \\ as it is"
            ? "\\"
            : mistake === "LIKE leaves its escape character ! as it is"
              ? "!"
              : "";
        let needle = String(value);
        if (escapeCharacter !== "") {
          let plain = "";
          for (let i = 0; i < needle.length; i++) {
            if (needle[i] === escapeCharacter) i += 1;
            if (i >= needle.length) return false;
            plain += needle[i];
          }
          needle = plain;
        }
        if (needle === "") return mistake === "an empty operand drops null" ? cell !== null : true;
        if (empty) return mistake === "contains keeps empty cells" && !start;
        const [hay, find] = mistake === "LIKE is case-sensitive" ? [String(cell), needle] : [lower(cell), asked(needle)];
        return start ? hay.startsWith(find) : hay.includes(find);
      }
      case "gt":
        return compared((s) => (mistake === "greater than includes the value" ? s >= 0 : s > 0), value as Scalar);
      case "gte":
        return compared((s) => s >= 0, value as Scalar);
      case "lt":
        return compared((s) => s < 0, value as Scalar);
      case "lte":
        return compared((s) => (mistake === "at most leaves out the value" ? s < 0 : s <= 0), value as Scalar);
      case "between": {
        const { min, max } = value as { min: Scalar; max: Scalar };
        const exclusive = mistake === "between leaves out its ends";
        return compared((s) => (exclusive ? s > 0 : s >= 0), min) && compared((s) => (exclusive ? s < 0 : s <= 0), max);
      }
    }
  };
  const columnOf = (columnId: string) => schema.columns.find((c) => c.id === columnId) as ColumnDescriptor;
  const keepsRow = (row: Row, p: FilterPredicate) => keeps(row[p.columnId] as Scalar, p, columnOf(p.columnId));
  /** One filter written as conditions joined with "or": the empty cells it keeps, the empty text, and the values. */
  const armsOf = (row: Row, p: FilterPredicate): boolean[] => {
    const cell = row[p.columnId] as Scalar;
    const kept = keepsRow(row, p);
    return [kept && cell === null, kept && cell === "", kept && !isEmptyCell(cell)];
  };
  const where = (row: Row, group: FilterGroup, visible: readonly string[]): boolean => {
    if (mistake === "everything is joined with and") return predicatesOf(group).every((p) => keepsRow(row, p));
    if (mistake === "a filter on a hidden column is dropped") {
      group = {
        ...group,
        children: group.children.filter((child) => child.type === "group" || visible.includes(child.columnId)),
      };
    }
    if (mistake === "only the last filter on a column holds") {
      const children = group.children;
      group = {
        ...group,
        children: children.filter(
          (child, i) =>
            child.type === "group" ||
            !children.slice(i + 1).some((later) => later.type === "predicate" && later.columnId === child.columnId),
        ),
      };
    }
    if (mistake === "a filter loses its brackets" && group.combinator === "and") {
      // "x AND a OR b": each filter's conditions in a line with the joining words, and AND binding first.
      const line: Array<boolean | "and" | "or"> = group.children.flatMap((child, i) => [
        ...(i > 0 ? (["and"] as const) : []),
        ...(child.type === "group"
          ? [where(row, child, visible)]
          : armsOf(row, child).flatMap((arm, k) => [...(k > 0 ? (["or"] as const) : []), arm])),
      ]);
      const runs: boolean[][] = [[]];
      for (const part of line) {
        if (part === "or") runs.push([]);
        else if (part !== "and") (runs.at(-1) as boolean[]).push(part);
      }
      return runs.some((run) => run.length > 0 && run.every(Boolean));
    }
    if (mistake === "an or group loses its brackets") {
      // "a OR b AND c": the filters in a line with their joining words, and AND binding first.
      const line = (g: FilterGroup): Array<boolean | "and" | "or"> =>
        g.children.flatMap((child, i) => [
          ...(i > 0 ? [g.combinator] : []),
          ...(child.type === "group" ? line(child) : [keepsRow(row, child)]),
        ]);
      const runs: boolean[][] = [[]];
      for (const part of line(group)) {
        if (part === "or") runs.push([]);
        else if (part !== "and") (runs.at(-1) as boolean[]).push(part);
      }
      return runs.some((run) => run.every(Boolean));
    }
    const results = group.children.map((child) => (child.type === "group" ? where(row, child, visible) : keepsRow(row, child)));
    return group.combinator === "and" ? results.every(Boolean) : results.some(Boolean);
  };
  return (state) => {
    if (mistake === "no filters keep no rows" && state.filters === null) return [];
    const filtered = (rows: Row[]) => rows.filter((row) => (state.filters ? where(row, state.filters, state.visibleColumnIds) : true));
    const shown =
      mistake === "a sort on a hidden column is dropped"
        ? state.sorts.filter((sort) => state.visibleColumnIds.includes(sort.columnId))
        : mistake === "a sort on an enum is dropped"
          ? state.sorts.filter((sort) => columnOf(sort.columnId).kind !== "enum")
          : state.sorts;
    const sorts =
      mistake === "only the first sort is used"
        ? shown.slice(0, 1)
        : mistake === "the sorts are used in reverse"
          ? [...shown].reverse()
          : shown;
    const cells = (a: Scalar, b: Scalar, columnId: string): number => {
      if (a === b) return 0;
      if (a === null) return -1;
      if (b === null) return 1;
      if (typeof a === "number" && typeof b === "number") return a - b;
      if (byInstant && columnOf(columnId).kind === "datetime") return instantOf(String(a)) - instantOf(String(b));
      if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
      if (mistake === "an enum sorts in the order its values are declared" && columnOf(columnId).kind === "enum") {
        const declared = (columnOf(columnId).enumValues ?? []).map((value) => value.id);
        return declared.indexOf(String(a)) - declared.indexOf(String(b));
      }
      // Text ignoring case, then by character code, as a database's case-blind collation does.
      if (mistake === "text sorts by character code") return textOrder(String(a), String(b));
      return textOrder(String(a).toLowerCase(), String(b).toLowerCase()) || textOrder(String(a), String(b));
    };
    const ordered = (rows: Row[]) => {
      const sorted = [...rows].reverse().sort((a, b) => {
        for (const sort of sorts) {
          const d = cells(a[sort.columnId] as Scalar, b[sort.columnId] as Scalar, sort.columnId);
          if (d !== 0) return sort.direction === "desc" && mistake !== "the sort ignores direction" ? -d : d;
        }
        return 0;
      });
      if (mistake !== "a row with an empty sort cell goes last, then the count cuts") return sorted;
      // "ORDER BY (b IS NULL), a, b": every row with an empty cell in any sorted column goes after the rest.
      const holed = (row: Row) => sorts.some((sort) => isEmptyCell(row[sort.columnId]));
      return [...sorted.filter((row) => !holed(row)), ...sorted.filter(holed)];
    };
    const first = state.sorts[0]?.columnId;
    const needed =
      mistake === "the count leaves out a row with no value in any sorted column" ? state.sorts.map((s) => s.columnId) : [first];
    const hasValue = (cell: unknown) => (mistake === "the count keeps rows with empty text" ? cell !== null : !isEmptyCell(cell));
    const withValue = (rows: Row[]) =>
      first === undefined ? rows : rows.filter((row) => needed.every((columnId) => hasValue(row[columnId as string])));
    let rows: Row[];
    if (state.limit === undefined && mistake === "a sort with no count drops rows with no value")
      rows = ordered(withValue(filtered(check.rows)));
    else if (state.limit === undefined) rows = ordered(filtered(check.rows));
    else if (mistake === "the count is cut before the filter") rows = filtered(ordered(withValue(check.rows)).slice(0, state.limit));
    else if (mistake === "the count keeps rows with no value") rows = ordered(filtered(check.rows)).slice(0, state.limit);
    else if (mistake === "the count is cut before the sort") rows = ordered(withValue(filtered(check.rows)).slice(0, state.limit));
    else rows = ordered(withValue(filtered(check.rows))).slice(0, state.limit);
    // The database's own row numbers, from 1 in the order the rows were loaded, in place of the ids.
    if (mistake === "the ids are the row numbers") return rows.map((row) => check.rows.indexOf(row) + 1);
    return rows.map((row) => row[id] as string | number);
  };
};

/** Each mistake, the row of the table in 4.1 it breaks, and the rules its failing cases must name. */
const MISTAKES: Array<{ mistake: Mistake; row: string; rules: RegExp[]; only?: "ledger" | "calendar" }> = [
  {
    mistake: "not equal drops empty cells",
    row: "neq",
    rules: [/^not equal keeps empty cells \(/, /^not equal keeps empty cells, and ignores case on text \(/],
  },
  { mistake: "not equal is case-sensitive on text", row: "neq", rules: [/^not equal keeps empty cells, and ignores case on text \(/] },
  {
    mistake: "equal is case-sensitive on text",
    row: "eq, in on a text column",
    rules: [/^equal ignores case on text, and leaves out empty cells \(/],
  },
  { mistake: "equal on text is a pattern match", row: "eq, in on a text column", rules: [/^equal reads _ as plain text \(/] },
  {
    mistake: "only the column's letter case is ignored",
    row: "eq, in on a text column",
    rules: [
      /^equal ignores case on text, and leaves out empty cells \(/,
      /^in a list ignores case on text, and leaves out empty cells \(/,
      /^not equal keeps empty cells, and ignores case on text \(/,
    ],
  },
  {
    mistake: "only the column's letter case is ignored",
    row: "contains, startsWith",
    rules: [/^contains ignores case, and leaves out empty cells \(/, /^starts with ignores case, looks only at the start, and leaves out/],
  },
  {
    mistake: "in is case-sensitive on text",
    row: "eq, in on a text column",
    rules: [/^in a list ignores case on text, and leaves out empty cells \(/],
  },
  {
    mistake: "an empty number is zero",
    row: "eq, in on an enum, number, date, or yes/no column",
    rules: [/^equal to zero leaves out empty cells \(/],
  },
  {
    mistake: "no keeps empty cells",
    row: "eq, in on an enum, number, date, or yes/no column",
    rules: [/^no keeps only no and leaves out empty cells \(/],
  },
  {
    mistake: "LIKE is case-sensitive",
    row: "contains, startsWith",
    rules: [/^contains ignores case, and leaves out empty cells \(/, /^starts with ignores case, looks only at the start, and leaves out/],
  },
  {
    mistake: "LIKE wildcards are not escaped",
    row: "contains, startsWith",
    rules: [
      /^contains reads % as plain text \(/,
      /^contains reads _ as plain text \(/,
      /^starts with reads _ as plain text \(/,
      /^starts with reads % as plain text \(/,
    ],
  },
  {
    mistake: "greater than includes the value",
    row: "gt, gte, lt, lte",
    rules: [/^greater than leaves out the value itself and empty cells \(/],
  },
  {
    mistake: "at most leaves out the value",
    row: "gt, gte, lt, lte",
    rules: [/^less than or equal includes the value itself and leaves out empty cells \(/],
  },
  {
    mistake: "an empty number is zero",
    row: "gt, gte, lt, lte",
    rules: [
      /^less than leaves out the value itself and empty cells \(/,
      /^less than or equal includes the value itself and leaves out empty cells \(/,
    ],
  },
  {
    mistake: "numbers are compared as text",
    row: "gt, gte, lt, lte",
    rules: [/^greater than leaves out the value itself and empty cells \(/, /^less than leaves out the value itself and empty cells \(/],
  },
  { mistake: "between leaves out its ends", row: "between", rules: [/^between includes both ends and leaves out empty cells \(/] },
  { mistake: "between leaves out its ends", row: "between", rules: [/^between includes both ends, each a whole day \(/], only: "ledger" },
  {
    mistake: "is empty trims the text",
    row: "isEmpty",
    rules: [/^is empty keeps null and empty text, and leaves out whitespace-only and placeholder text \(/],
  },
  {
    mistake: "is empty takes zero",
    row: "isEmpty",
    rules: [/^is empty keeps only cells with no value, and zero is a value \(/, /^is not empty keeps zero/],
  },
  {
    mistake: "is empty is null only",
    row: "isEmpty",
    rules: [/^is empty keeps null and empty text, and leaves out whitespace-only and placeholder text \(/],
  },
  {
    mistake: "an empty operand drops null",
    row: "an empty operand",
    rules: [
      /^equal to empty text keeps exactly the empty cells \(/,
      /^in a list of empty text keeps exactly the empty cells \(/,
      /^contains empty text keeps every row, empty cells included \(/,
      /^starts with empty text keeps every row, empty cells included \(/,
    ],
  },
  {
    mistake: "dates are compared as text",
    row: "a date means the whole day",
    rules: [/^a date means the whole day/, /^after a date leaves out that whole day/, /^on or before a date includes that whole day/],
    only: "ledger",
  },
  {
    mistake: "a day is the UTC day",
    row: "a date means the whole day in the calendar's time zone",
    rules: [/^a date means the whole day in the calendar's time zone, /, /^on or after a date includes that whole day \(Posted at/],
    only: "calendar",
  },
  {
    mistake: "the count is cut before the filter",
    row: "a count",
    rules: [/^a count keeps the first rows of the sorted, filtered rows \(/],
  },
  { mistake: "the count is cut before the sort", row: "a count", rules: [/^a count keeps the first rows of the sorted, filtered rows \(/] },
  {
    mistake: "the count leaves out a row with no value in any sorted column",
    row: "a count",
    rules: [/^a count never keeps a row with no value in the first sorted column \(/],
  },
  {
    mistake: "the count keeps rows with no value",
    row: "a count",
    rules: [/^a count never keeps a row with no value in the first sorted column \(/],
  },
  { mistake: "everything is joined with and", row: "two columns", rules: [/^an or group keeps a row that either filter keeps \(/] },
  { mistake: "an or group loses its brackets", row: "two columns", rules: [/^an or group inside an and keeps its own brackets \(/] },
  { mistake: "the sort ignores direction", row: "sorting", rules: [/^sorts by each column in turn, in its direction \(/] },
  { mistake: "only the first sort is used", row: "sorting", rules: [/^sorts by each column in turn, in its direction \(/] },
  { mistake: "the sorts are used in reverse", row: "sorting", rules: [/^sorts by each column in turn, in its direction \(/] },
  // The classes the held-out round found.
  {
    mistake: "not equal to empty text keeps empty text",
    row: "an empty operand",
    rules: [/^not equal to empty text leaves out exactly the empty cells \(/],
  },
  {
    mistake: "the operand is trimmed",
    row: "spaces in an operand",
    rules: [
      /^equal keeps the spaces in what it asks for \(/,
      /^equal to whitespace-only text keeps only that text, not the empty cells \(/,
      /^not equal keeps the spaces in what it asks for \(/,
      /^in a list keeps the spaces in what it asks for \(/,
      /^contains keeps the spaces in what it asks for \(/,
      /^contains whitespace-only text keeps only the text that holds it \(/,
      /^starts with keeps the spaces in what it asks for \(/,
    ],
  },
  {
    mistake: "an empty number is zero",
    row: "between",
    rules: [
      /^between a range that holds zero leaves out empty cells, which are not zero \(/,
      /^greater than a negative number leaves out empty cells, which are not zero \(/,
      /^greater than or equal to a negative number leaves out empty cells, which are not zero \(/,
      /^not equal to zero keeps empty cells, which are not zero \(/,
    ],
  },
  {
    mistake: "is empty keeps placeholder text",
    row: "isEmpty",
    rules: [
      /^is empty keeps null and empty text, and leaves out whitespace-only and placeholder text \(/,
      /^is not empty keeps whitespace-only and placeholder text, and leaves out null and empty text \(/,
    ],
  },
  { mistake: "a filter loses its brackets", row: "two columns", rules: [/^a filter joined with and keeps its own brackets \(/] },
  { mistake: "only the last filter on a column holds", row: "two columns", rules: [/^two filters on one column must both hold \(/] },
  { mistake: "a filter on a hidden column is dropped", row: "hidden columns", rules: [/^a filter on a hidden column still holds \(/] },
  { mistake: "text sorts by character code", row: "sorting", rules: [/^text sorts by its letters, ignoring case \(/] },
  {
    mistake: "the count keeps rows with empty text",
    row: "a count",
    rules: [/^a count never keeps a row with no value in the first sorted column \(.*sorted by (Household|Advisor|Owner|Counterparty),/],
  },
  {
    mistake: "lower folds only A to Z",
    row: "eq, in on a text column",
    rules: [
      /^equal ignores case on text, and leaves out empty cells \(/,
      /^in a list ignores case on text, and leaves out empty cells \(/,
      /^not equal keeps empty cells, and ignores case on text \(/,
      /^contains ignores case, and leaves out empty cells \(/,
      /^starts with ignores case, looks only at the start, and leaves out empty cells \(/,
    ],
  },
  // No case's name is about ids: every case but the one that keeps every row fails.
  {
    mistake: "the ids are the row numbers",
    row: "ids",
    rules: [/^equal to zero leaves out empty cells \(/, /^sorts by each column in turn/],
  },
  {
    mistake: "a time with no offset is read as UTC",
    row: "a date means the whole day in the calendar's time zone",
    rules: [/^a date means the whole day in the calendar's time zone, and a time with no offset is on its own date \(/],
    only: "calendar",
  },
  {
    mistake: "equal on text keeps empty cells",
    row: "eq, in on a text column",
    rules: [/^equal ignores case on text, and leaves out empty cells \(/],
  },
  { mistake: "contains keeps empty cells", row: "contains, startsWith", rules: [/^contains ignores case, and leaves out empty cells \(/] },
  { mistake: "no filters keep no rows", row: "no filters", rules: [/^no filters keep every row \(/] },
  {
    mistake: "a sort with no count drops rows with no value",
    row: "sorting",
    rules: [/^a sort with no count keeps the rows with no value \(/],
  },
  // The classes the second held-out round found.
  {
    mistake: "a list drops empty text beside other values",
    row: "an empty operand",
    rules: [/^in a list with empty text among other values keeps the empty cells too \(/],
  },
  {
    mistake: "LIKE leaves its escape character \\ as it is",
    row: "contains, startsWith",
    rules: [/^contains reads \\, ! and \[ as plain text \(/, /^starts with reads \\, ! and \[ as plain text \(/],
  },
  {
    mistake: "LIKE leaves its escape character ! as it is",
    row: "contains, startsWith",
    rules: [/^contains reads \\, ! and \[ as plain text \(/, /^starts with reads \\, ! and \[ as plain text \(/],
  },
  {
    mistake: "a sort on a hidden column is dropped",
    row: "hidden columns",
    rules: [/^a sort on a hidden column still orders the rows \(/],
  },
  // The classes the review of the Query Check found.
  {
    mistake: "text is compared ignoring accents",
    row: "eq, in on a text column",
    rules: [/^equal ignores case but not accents \(/, /^equal ignores case on text, and leaves out empty cells \(/],
  },
  {
    mistake: "text is compared ignoring accents",
    row: "contains, startsWith",
    rules: [/^contains ignores case, and leaves out empty cells \(/],
  },
  {
    mistake: "is empty on an enum is null only",
    row: "isEmpty",
    rules: [/^is empty keeps only cells with no value \((Registration type|Custodian|Category) is empty\)/],
  },
  { mistake: "a sort on an enum is dropped", row: "sorting", rules: [/^an enum sorts by its values' IDs, ignoring case \(/] },
  {
    mistake: "an enum sorts in the order its values are declared",
    row: "sorting",
    rules: [/^an enum sorts by its values' IDs, ignoring case \(/],
  },
  {
    mistake: "a row with an empty sort cell goes last, then the count cuts",
    row: "a count",
    rules: [/^a count keeps a row with no value in a later sorted column \(/],
  },
];

describe("the self-check", () => {
  for (const s of SUBJECTS) {
    it(`${s.name}: a Data Query that is applyView passes every case`, () => {
      const check = checkOf(s);
      expect(check.cases.length).toBeGreaterThan(50);
      expect(failuresOf(check, applyViewQuery(check, s.schema, s.id))).toEqual([]);
    });

    it(`${s.name}: a Data Query written by hand from the table passes every case`, () => {
      const check = full(checkOf(s));
      expect(failuresOf(check, handQuery(check, s.schema, s.id))).toEqual([]);
    });

    it(`${s.name}: so does one that orders a date-and-time column by the instant each cell names`, () => {
      const check = full(checkOf(s));
      expect(failuresOf(check, handQuery(check, s.schema, s.id, undefined, true))).toEqual([]);
    });
  }

  it("has a wrong translation for each row of the table in 4.1, and for the rows core changed", () => {
    const rows = new Set(MISTAKES.map((m) => m.row));
    for (const row of [
      "neq",
      "eq, in on a text column",
      "eq, in on an enum, number, date, or yes/no column",
      "contains, startsWith",
      "gt, gte, lt, lte",
      "between",
      "isEmpty",
      "a count",
      "an empty operand",
      "a date means the whole day",
      "a date means the whole day in the calendar's time zone",
    ]) {
      expect(rows.has(row), row).toBe(true);
    }
  });

  for (const { mistake, row, rules, only } of MISTAKES) {
    const subjects = SUBJECTS.filter((s) =>
      only === "ledger" ? s.name.startsWith("ledger") : only === "calendar" ? s.schema.calendar?.timeZone !== undefined : true,
    );
    for (const s of subjects) {
      it(`${row}: “${mistake}” fails on ${s.name}, and the message names the rule`, () => {
        const check = checkOf(s);
        const failed = failuresOf(check, handQuery(check, s.schema, s.id, mistake));
        expect(failed.length).toBeGreaterThan(0);
        for (const rule of rules) {
          const named = failed.filter((message) => rule.test(message));
          expect(named.length, `${rule} among:\n${failed.join("\n")}`).toBeGreaterThan(0);
          for (const message of named) expect(message).toMatch(/: (\d+ rows? (missing|extra), ids? |wrong order: id )/);
        }
      });
    }
  }

  it("a mistake fails only the cases whose view it touches", () => {
    const s = SUBJECTS[2] as Subject;
    const check = full(checkOf(s));
    const kindOf = (columnId: string) => s.schema.columns.find((c) => c.id === columnId)?.kind;
    const failedBy = (mistake: Mistake) => {
      const query = handQuery(check, s.schema, s.id, mistake);
      const failed = check.cases.filter((c) => !c.compare(query(c.state)).ok);
      expect(failed.length, mistake).toBeGreaterThan(0);
      return failed;
    };
    const touches: Array<[Mistake, (c: QueryCheckCase) => boolean]> = [
      [
        "equal is case-sensitive on text",
        (c) => predicatesOf(c.state.filters).some((p) => p.operator === "eq" && kindOf(p.columnId) === "string"),
      ],
      ["not equal drops empty cells", (c) => predicatesOf(c.state.filters).some((p) => p.operator === "neq")],
      ["between leaves out its ends", (c) => predicatesOf(c.state.filters).some((p) => p.operator === "between")],
      ["a day is the UTC day", (c) => predicatesOf(c.state.filters).some((p) => kindOf(p.columnId) === "datetime")],
      ["the sort ignores direction", (c) => c.state.sorts.length > 0],
      ["the count keeps rows with no value", (c) => c.state.limit !== undefined],
      ["an or group loses its brackets", (c) => (c.state.filters?.children ?? []).some((child) => child.type === "group")],
    ];
    for (const [mistake, touched] of touches) {
      expect(
        failedBy(mistake)
          .filter((c) => !touched(c))
          .map((c) => c.name),
        mistake,
      ).toEqual([]);
    }
  });
});

// --- Small and odd schemas: a right Data Query must never fail ------------------------------------------------

describe("a right Data Query passes on any schema", () => {
  /** Both references pass every case: `applyView`, and the hand query that orders ties and empty cells another way. */
  const passes = (schema: ViewSchema, id: string, more: Partial<QueryCheckOptions> = {}): QueryCheck => {
    const check = queryCheck(schema, { id, operations: WITH_COUNT, ...more });
    expect(failuresOf(check, applyViewQuery(check, schema, id))).toEqual([]);
    expect(failuresOf(check, handQuery(check, schema, id))).toEqual([]);
    expect(failuresOf(check, handQuery(check, schema, id, undefined, true))).toEqual([]);
    return check;
  };

  it("text columns only: each is sorted on its own, and the only counts are about empty text", () => {
    const check = full(passes(defineSchema([{ id: "key" }, { id: "name" }, { id: "note" }]), "key"));
    const sorted = check.cases.filter((c) => c.state.sorts.length > 0 || c.state.limit !== undefined);
    expect(sorted.map((c) => c.name.replace(/ \(.*$/, "")).sort()).toEqual([
      "a count never keeps a row with no value in the first sorted column",
      "a count never keeps a row with no value in the first sorted column",
      "a sort on a hidden column still orders the rows",
      "a sort on a hidden column still orders the rows",
      "text sorts by its letters, ignoring case",
      "text sorts by its letters, ignoring case",
      "text sorts by its letters, ignoring case",
      "text sorts by its letters, ignoring case",
    ]);
    expect(check.cases.some((c) => /^filters on two columns must both hold/.test(c.name))).toBe(true);
  });

  it("one number column: the sort cases sort by it alone, each way", () => {
    const check = full(passes(defineSchema([{ id: "key" }, { id: "score", kind: "number" }]), "key"));
    const sorted = check.cases.filter((c) => /^sorts by each column in turn/.test(c.name)).map((c) => c.state.sorts);
    expect(sorted).toEqual([[{ columnId: "score", direction: "asc" }], [{ columnId: "score", direction: "desc" }]]);
    // One column can't join a filter on a second one, but two filters on it can join.
    expect(check.cases.some((c) => new Set(predicatesOf(c.state.filters).map((p) => p.columnId)).size > 1)).toBe(false);
    expect(check.cases.some((c) => /^two filters on one column must both hold/.test(c.name))).toBe(true);
    expect(check.cases.some((c) => /^a count never keeps a row with no value/.test(c.name))).toBe(true);
  });

  it("an enum that declares no values, or one", () => {
    const schema = defineSchema(
      [{ id: "key" }, { id: "status", kind: "enum" }, { id: "tier", kind: "enum" }, { id: "flag", kind: "boolean" }],
      { columns: { tier: { enumValues: [{ id: "gold", label: "Gold" }] } } },
    );
    const check = full(passes(schema, "key"));
    expect(new Set(cellsOf(check, "tier"))).toEqual(new Set(["gold", null, ""]));
    expect(new Set(cellsOf(check, "status")).size).toBeGreaterThan(2);
    expect(check.cases.map((c) => c.name)).toContain("in a list keeps each listed value and leaves out empty cells (Tier is one of Gold)");
  });

  it("every column notNull: no case needs an empty cell to pass, and the count case that needs one is left out", () => {
    const s = SUBJECTS[1] as Subject;
    const check = full(passes(s.schema, s.id, { notNull: s.schema.columns.map((c) => c.id) }));
    for (const column of s.schema.columns) expect(cellsOf(check, column.id).filter(isEmptyCell), column.id).toEqual([]);
    expect(check.cases.some((c) => /^a count never keeps a row with no value/.test(c.name))).toBe(false);
    expect(check.cases.some((c) => /^a count keeps the first rows/.test(c.name))).toBe(true);
  });

  it("an enum with many values makes more rows, so each value is still in several", () => {
    const values = Array.from({ length: 40 }, (_, i) => ({ id: `v${i}`, label: `Value ${i}` }));
    const schema = defineSchema([{ id: "key" }, { id: "kind", kind: "enum" }, { id: "score", kind: "number" }], {
      columns: { kind: { enumValues: values } },
    });
    const check = full(passes(schema, "key"));
    // Each value, null and empty text.
    expect(check.rows.length).toBe(4 * 42);
    for (const { id } of values) expect(cellsOf(check, "kind").filter((v) => v === id).length, id).toBe(4);
  });

  it("sixty seeded schemas, with columns of every kind in any mix", () => {
    const kinds: Array<ColumnDescriptor["kind"]> = ["string", "number", "currency", "percent", "date", "datetime", "boolean", "enum"];
    const zones = [undefined, "America/New_York", "Asia/Kolkata", "Pacific/Auckland", "UTC"];
    let cases = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const random = seededRandom(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
      const columns = Array.from({ length: 1 + Math.floor(random() * 7) }, (_, i) => ({ id: `c${i}`, kind: pick(kinds) }));
      const overrides = Object.fromEntries(
        columns.map((column) => [
          column.id,
          {
            ...(column.kind === "enum" && random() < 0.8
              ? { enumValues: Array.from({ length: 1 + Math.floor(random() * 5) }, (_, n) => ({ id: `e${n}`, label: `E${n}` })) }
              : {}),
            ...(random() < 0.15 ? { capabilities: ["filter" as const, "show" as const] } : {}),
          },
        ]),
      );
      const timeZone = pick(zones);
      const schema = defineSchema([{ id: "key" }, ...columns], { columns: overrides, ...(timeZone ? { calendar: { timeZone } } : {}) });
      const notNull = columns.filter(() => random() < 0.25).map((column) => column.id);
      const check = passes(schema, random() < 0.5 ? "key" : "row_id", { notNull });
      cases += check.cases.length;
      expect(new Set(check.cases.map((c) => c.name)).size, `seed ${seed}`).toBe(check.cases.length);
    }
    expect(cases).toBeGreaterThan(1000);
  });
});
