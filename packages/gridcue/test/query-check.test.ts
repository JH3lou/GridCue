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

// Many cases here build whole Query Checks, which take a few seconds under a loaded CI runner beside the AG Grid suites.
vi.setConfig({ testTimeout: 30_000 });

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

/** The rule a count names when its cut falls inside rows that tie (ruling R2). */
const TIED =
  /^a count that cuts inside tied rows keeps its number of rows: every row ahead of the tie, none behind it, and any of the tied \(/;
/** The rule a sort names for a row with a value in the first sorted column and none in a later one (ruling R3). */
const LATER_EMPTY = /^a row with no value in a later sorted column keeps its place by the columns before it \(/;
/** The rule a count with two sorts names when its cut falls inside rows that tie on the first (ruling R2). */
const NEXT_DECIDES =
  /^a count that cuts inside rows that tie on the first sorted column keeps the ones the next sorted column puts first \(/;
/** The rule a count names when a later sorted column, of any kind, holds an empty cell ahead of its cut (ruling R3). */
const EMPTY_LATER_IN_COUNT = /^a count keeps a row with an empty cell in a later sorted column \(/;
/** The rule a sort with many ties names, for a Host that reads each case in pages too (ruling R1). */
const PAGED = /^a paged read is the whole result cut in pieces: rows that tie keep one order from page to page \(/;
/** The rule a count with three sorts names when its cut falls inside rows that tie on the first two (ruling R2). */
const THIRD_DECIDES = /^a count that cuts inside rows that tie on the first two sorted columns keeps the ones the third puts first \(/;
/** The rule two sorts beside an or group name. */
const TWO_SORTS_BESIDE_OR = /^two sorts beside an or group order the rows by each in turn \(/;
/** The rule a count beside an or group names. */
const COUNT_BESIDE_OR = /^a count beside an or group still keeps only its first rows \(/;
/** The rule a filter on a hidden column names inside an or group inside an and. */
const HIDDEN_IN_NESTED_OR = /^a filter on a hidden column still holds in an or group inside an and \(/;
/** The rules a count sorted by a hidden column names: alone, and second. */
const COUNT_HIDDEN_SORT = /^a count still sorts by a hidden column \(/;
const COUNT_HIDDEN_SECOND = /^a count still sorts by a hidden second column \(/;
const COUNT_HIDDEN_THIRD = /^a count still sorts by a hidden third column \(/;
/** The rules a sort beside a filter joined with "and" names: one sort, one on a hidden column, and two. */
const SORT_BESIDE_FILTER = /^a sort beside a filter still orders the rows \(/;
const HIDDEN_SORT_BESIDE_FILTER = /^a sort on a hidden column beside a filter still orders the rows \(/;
const TWO_SORTS_BESIDE_FILTER = /^two sorts beside a filter order the rows by each in turn \(/;
/** The rule an or group of three filters names. */
const OR_OF_THREE = /^an or group of three filters keeps a row that any of them keeps \(/;
/** The rule a filter on a hidden column names inside an and group inside an or. */
const HIDDEN_IN_NESTED_AND = /^a filter on a hidden column still holds in an and group inside an or \(/;
/** The rule a count names when text or an enum, sorted second, decides which of the rows that tie on the first it keeps. */
const COLLATED_NEXT_DECIDES =
  /^a count that cuts inside rows that tie on the first sorted column keeps the ones (text|an enum) sorted next puts first \(/;
/** The rules a count sorted first by text or an enum names. */
const COUNT_BY_COLLATED =
  /^a count sorted by (text keeps its first rows by its letters, ignoring case|an enum keeps its first rows by its values' IDs) \(/;
/** The rule a count that cuts inside tied rows beside a filter names. */
const TIED_BESIDE_FILTER = /^a count that cuts inside tied rows beside a filter keeps its number of rows \(/;
/** The rule a count with four sorts names when its cut falls inside rows that tie on the first three. */
const FOURTH_DECIDES = /^a count that cuts inside rows that tie on the first three sorted columns keeps the ones the fourth puts first \(/;
/** The rules a count that cuts inside tied rows names beside an or group: one sort, and two. */
const TIED_BESIDE_OR = /^a count that cuts inside tied rows beside an or group keeps its number of rows \(/;
const NEXT_BESIDE_OR =
  /^a count that cuts inside rows that tie on the first sorted column beside an or group keeps the ones the next sorted column puts first \(/;
/** The rules each sort and count names beside a filter on a hidden column, with the sorted columns hidden too. */
const SORT_BESIDE_HIDDEN = /^a sort beside a filter on a hidden column still orders the rows \(/;
const TWO_SORTS_BESIDE_HIDDEN = /^two sorts beside a filter on a hidden column order the rows by each in turn \(/;
const COUNT_BESIDE_HIDDEN = /^a count beside a filter on a hidden column still keeps only its first rows \(/;
const TIED_BESIDE_HIDDEN = /^a count that cuts inside tied rows beside a filter on a hidden column keeps its number of rows \(/;
const NEXT_BESIDE_HIDDEN =
  /^a count that cuts inside rows that tie on the first sorted column beside a filter on a hidden column keeps the ones the next sorted column puts first \(/;
/** The rules a count names beside a filter: its first rows, and two sorts cut inside rows that tie on the first. */
const COUNT_BESIDE_FILTER = /^a count beside a filter still keeps only its first rows \(/;
const NEXT_BESIDE_FILTER =
  /^a count that cuts inside rows that tie on the first sorted column beside a filter keeps the ones the next sorted column puts first \(/;
/** The rules for each column sorted first, and each number of sorts, with no filter (the third round). */
const TWO_SORTS_ANY_LEAD = /^two sorts order the rows by each in turn, whichever column is sorted first \(/;
const THREE_SORTS = /^three sorts order the rows by each in turn \(/;
const FOUR_SORTS = /^four sorts order the rows by each in turn \(/;
const TIED_BY_COLLATED = /^a count that cuts inside rows that tie on (text|an enum) keeps its number of rows \(/;
const NEXT_AFTER_COLLATED =
  /^a count that cuts inside rows that tie on (text|an enum) sorted first keeps the ones the next sorted column puts first \(/;
const ALL_TIED = /^a count that cuts inside rows that tie on (both|all three|all four) sorted columns keeps its number of rows \(/;
const TIED_HIDDEN = /^a count that cuts inside tied rows keeps its number of rows with the sorted column hidden \(/;
/** The kinds every database orders alike: the count cases and the two-column sorts lead with one of these. */
const ORDERED_KINDS: ReadonlyArray<ColumnDescriptor["kind"]> = ["number", "currency", "percent", "date", "datetime", "boolean"];

/** The shape of an or group a case's filters hold: two filters, three, or an or group inside an and. */
const orShape = (c: QueryCheckCase): string => {
  const root = c.state.filters;
  if (root?.combinator === "or") return root.children.length >= 3 ? "or of three" : "or";
  return "or inside and";
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

  it("and a second pair that differs only by an accent outside å, ä and ö, with a case that asks for each", () => {
    // A Swedish or Finnish collation keeps å, ä and ö as letters of their own and reads é as e. The first pair, with
    // Å, passes such a collation, so the rows hold a pair it reads as one.
    const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const nordic = (t: string) => [...t.toLowerCase()].map((letter) => ("åäö".includes(letter) ? letter : fold(letter))).join("");
    for (const [s, columnId] of [
      [SUBJECTS[0], "household"],
      [SUBJECTS[1], "counterparty"],
    ] as Array<[Subject, string]>) {
      const check = checkOf(s);
      const texts = [...new Set(cellsOf(check, columnId).filter((v): v is string => typeof v === "string"))];
      const pairs = texts.flatMap((a) => texts.filter((b) => a < b && a.toLowerCase() !== b.toLowerCase() && nordic(a) === nordic(b)));
      expect(pairs, columnId).toHaveLength(1);
      const accented = texts.find((t) => t.toLowerCase() !== fold(t) && nordic(t) === fold(t)) as string;
      expect(accented, columnId).toBeDefined();
      const label = s.schema.columns.find((c) => c.id === columnId)?.label as string;
      for (const rule of [/^equal keeps é and e apart \(/, /^contains keeps é and e apart \(/, /^starts with keeps é and e apart \(/]) {
        const c = singles(check, columnId).find((one) => rule.test(one.name)) as QueryCheckCase;
        expect(c, `${label} ${rule}`).toBeDefined();
        // Only the text with the accent is kept, never its plain twin.
        expect(new Set(keptCells(check, s.schema, c, columnId)), c.name).toEqual(new Set([accented]));
        // What it asks for holds the accent, in a letter case no row holds.
        const asked = String(predicatesOf(c.state.filters)[0]?.value);
        expect(asked.toLowerCase(), c.name).toContain("é");
        expect(nordic(accented), c.name).toContain(nordic(asked));
      }
    }
  });

  it("every text operator has a case for each accent: é and e apart, and Å and A apart", () => {
    const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const nordic = (t: string) => [...t.toLowerCase()].map((letter) => ("åäö".includes(letter) ? letter : fold(letter))).join("");
    for (const [s, columnId] of [
      [SUBJECTS[0], "household"],
      [SUBJECTS[0], "advisor_name"],
      [SUBJECTS[1], "owner"],
      [SUBJECTS[1], "counterparty"],
    ] as Array<[Subject, string]>) {
      const check = checkOf(s);
      const texts = [...new Set(cellsOf(check, columnId).filter((v): v is string => typeof v === "string"))];
      const kept = (rule: RegExp) => {
        const c = singles(check, columnId).find((one) => rule.test(one.name)) as QueryCheckCase;
        expect(c, `${columnId} ${rule}`).toBeDefined();
        return { c, cells: new Set(keptCells(check, s.schema, c, columnId)) };
      };
      // Each keeps one text of a pair a collation that folds the accent reads as one, and not the other.
      const sides: Array<[RegExp, string, string]> = [
        // é: a Swedish or Finnish collation folds it.
        [/^not equal keeps é and e apart \(/, "Hazel Tor", "Hazél Tor"],
        [/^in a list keeps é and e apart \(/, "Hazél Tor", "Hazel Tor"],
        [/^starts with keeps é and e apart \(/, "Hazél Tor", "Hazel Tor"],
        // Å: a collation that ignores every accent folds it.
        [/^not equal ignores case but not accents \(/, "Ålder Fen", "Alder Fen"],
        [/^in a list ignores case but not accents \(/, "Alder Fen", "Ålder Fen"],
        [/^contains ignores case but not accents \(/, "Alder Fen", "Ålder Fen"],
        [/^starts with ignores case but not accents \(/, "Alder Fen", "Ålder Fen"],
      ];
      for (const [rule, keeps, leavesOut] of sides) {
        const { c, cells } = kept(rule);
        expect(texts, c.name).toContain(keeps);
        expect(texts, c.name).toContain(leavesOut);
        expect(cells.has(keeps), c.name).toBe(true);
        expect(cells.has(leavesOut), c.name).toBe(false);
        // A collation that folds the accent reads the two as one.
        const folding = rule.source.includes("é") ? nordic : fold;
        expect(folding(keeps), c.name).toBe(folding(leavesOut));
      }
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
    /^equal keeps é and e apart \(/,
    /^equal reads _ as plain text \(/,
    /^equal to empty text keeps exactly the empty cells \(/,
    /^equal keeps the spaces in what it asks for \(/,
    /^equal to whitespace-only text keeps only that text, not the empty cells \(/,
  ],
  neq: [
    /^not equal keeps empty cells, and ignores case on text \(/,
    /^not equal ignores case but not accents \(/,
    /^not equal keeps é and e apart \(/,
    /^not equal to empty text leaves out exactly the empty cells \(/,
    /^not equal keeps the spaces in what it asks for \(/,
  ],
  in: [
    /^in a list ignores case on text, and leaves out empty cells \(/,
    /^in a list ignores case but not accents \(/,
    /^in a list keeps é and e apart \(/,
    /^in a list of empty text keeps exactly the empty cells \(/,
    /^in a list keeps the spaces in what it asks for \(/,
    /^in a list with empty text among other values keeps the empty cells too \(/,
  ],
  contains: [
    /^contains ignores case, and leaves out empty cells \(/,
    /^contains ignores case but not accents \(/,
    /^contains keeps é and e apart \(/,
    /^contains reads % as plain text \(/,
    /^contains reads _ as plain text \(/,
    /^contains reads \\, ! and \[ as plain text \(/,
    /^contains empty text keeps every row, empty cells included \(/,
    /^contains keeps the spaces in what it asks for \(/,
    /^contains whitespace-only text keeps only the text that holds it \(/,
  ],
  startsWith: [
    /^starts with ignores case, looks only at the start, and leaves out empty cells \(/,
    /^starts with ignores case but not accents \(/,
    /^starts with keeps é and e apart \(/,
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
        } else if (/^a second sort on a hidden column still orders the rows \(/.test(c.name)) {
          expect(
            hidden.map((col) => col.id),
            c.name,
          ).toEqual([c.state.sorts[1]?.columnId]);
        } else if (/^a filter on a hidden column still holds in an or group \(/.test(c.name)) {
          // The second filter of the or group, the one the name says is hidden.
          expect(
            hidden.map((col) => col.id),
            c.name,
          ).toEqual([predicatesOf(c.state.filters)[1]?.columnId]);
        } else if (HIDDEN_IN_NESTED_OR.test(c.name)) {
          // The second filter of the inner or group: the root's filters come in order, the inner group's first.
          expect(
            hidden.map((col) => col.id),
            c.name,
          ).toEqual([predicatesOf(c.state.filters)[1]?.columnId]);
        } else if (COUNT_HIDDEN_SORT.test(c.name) || TIED_HIDDEN.test(c.name)) {
          expect(
            hidden.map((col) => col.id),
            c.name,
          ).toEqual([c.state.sorts[0]?.columnId]);
        } else if (COUNT_HIDDEN_SECOND.test(c.name)) {
          expect(
            hidden.map((col) => col.id),
            c.name,
          ).toEqual([c.state.sorts[1]?.columnId]);
        } else if (COUNT_HIDDEN_THIRD.test(c.name)) {
          expect(
            hidden.map((col) => col.id),
            c.name,
          ).toEqual([c.state.sorts[2]?.columnId]);
        } else if (HIDDEN_SORT_BESIDE_FILTER.test(c.name)) {
          expect(
            hidden.map((col) => col.id),
            c.name,
          ).toEqual([c.state.sorts[0]?.columnId]);
        } else if (HIDDEN_IN_NESTED_AND.test(c.name)) {
          // The first filter of the inner and group, which comes first in the root or group.
          expect(
            hidden.map((col) => col.id),
            c.name,
          ).toEqual([predicatesOf(c.state.filters)[0]?.columnId]);
        } else if (/ beside a filter on a hidden column /.test(c.name)) {
          // Every sorted column, and one filtered column besides.
          const sorted = c.state.sorts.map((sort) => sort.columnId);
          const rest = hidden.map((col) => col.id).filter((id) => !sorted.includes(id));
          for (const id of sorted)
            expect(
              hidden.map((col) => col.id),
              c.name,
            ).toContain(id);
          expect(rest.length, c.name).toBeLessThanOrEqual(1);
          expect(
            predicatesOf(c.state.filters).some((p) => !c.state.visibleColumnIds.includes(p.columnId)),
            c.name,
          ).toBe(true);
          for (const id of rest)
            expect(
              predicatesOf(c.state.filters).map((p) => p.columnId),
              c.name,
            ).toContain(id);
        } else if (/^a count never keeps a row with no value in the first sorted column \(.*, with .* hidden\)$/.test(c.name)) {
          // One sorted column: the first, or the second of two.
          expect(hidden, c.name).toHaveLength(1);
          expect(
            c.state.sorts.map((sort) => sort.columnId),
            c.name,
          ).toContain(hidden[0]?.id);
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
    // Every "contains" rule in the table, the accent cases among them.
    expect(singles(check, "name").length).toBe(9);
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
      // A count with four sorts that cuts inside rows that tie on all four is there only where the rows have such a run.
      const rules = [...new Set(cases.map((c) => c.name.replace(/ \(.*$/, "")))].sort();
      const fourTied = "a count that cuts inside rows that tie on all four sorted columns keeps its number of rows";
      const expected = [
        "a count beside a filter never keeps a row with no value in the first sorted column",
        "a count beside a filter on a hidden column never keeps a row with no value in the first sorted column",
        "a count beside a filter on a hidden column still keeps only its first rows",
        "a count beside a filter on the first sorted column never keeps a row with no value in the first sorted column",
        "a count beside a filter on the first sorted column still keeps only its first rows",
        "a count beside a filter still keeps only its first rows",
        "a count beside an or group never keeps a row with no value in the first sorted column",
        "a count beside an or group still keeps only its first rows",
        "a count beside two filters joined with and never keeps a row with no value in the first sorted column",
        "a count beside two filters joined with and still keeps only its first rows",
        "a count keeps a row with an empty cell in a later sorted column",
        "a count keeps a row with no value in a later sorted column",
        "a count keeps the first rows of the sorted, filtered rows",
        "a count never keeps a row with no value in the first sorted column",
        "a count sorted by an enum keeps its first rows by its values' IDs",
        "a count sorted by text keeps its first rows by its letters, ignoring case",
        "a count still sorts by a hidden column",
        "a count still sorts by a hidden second column",
        "a count still sorts by a hidden third column",
        "a count that cuts inside rows that tie on all three sorted columns keeps its number of rows",
        "a count that cuts inside rows that tie on an enum keeps its number of rows",
        "a count that cuts inside rows that tie on an enum sorted first keeps the ones the next sorted column puts first",
        "a count that cuts inside rows that tie on both sorted columns keeps its number of rows",
        "a count that cuts inside rows that tie on text keeps its number of rows",
        "a count that cuts inside rows that tie on text sorted first keeps the ones the next sorted column puts first",
        "a count that cuts inside rows that tie on the first sorted column beside a filter keeps the ones the next sorted column puts first",
        "a count that cuts inside rows that tie on the first sorted column beside a filter on a hidden column keeps the ones the next sorted column puts first",
        "a count that cuts inside rows that tie on the first sorted column beside a filter on the first sorted column keeps the ones the next sorted column puts first",
        "a count that cuts inside rows that tie on the first sorted column beside an or group keeps the ones the next sorted column puts first",
        "a count that cuts inside rows that tie on the first sorted column beside two filters joined with and keeps the ones the next sorted column puts first",
        "a count that cuts inside rows that tie on the first sorted column keeps the ones an enum sorted next puts first",
        "a count that cuts inside rows that tie on the first sorted column keeps the ones text sorted next puts first",
        "a count that cuts inside rows that tie on the first sorted column keeps the ones the next sorted column puts first",
        "a count that cuts inside rows that tie on the first three sorted columns keeps the ones the fourth puts first",
        "a count that cuts inside rows that tie on the first two sorted columns keeps the ones the third puts first",
        "a count that cuts inside tied rows beside a filter keeps its number of rows",
        "a count that cuts inside tied rows beside a filter on a hidden column keeps its number of rows",
        "a count that cuts inside tied rows beside a filter on the first sorted column keeps its number of rows",
        "a count that cuts inside tied rows beside an or group keeps its number of rows",
        "a count that cuts inside tied rows beside two filters joined with and keeps its number of rows",
        "a count that cuts inside tied rows keeps its number of rows with the sorted column hidden",
        "a count that cuts inside tied rows keeps its number of rows: every row ahead of the tie, none behind it, and any of the tied",
      ];
      expect(
        rules.filter((rule) => rule !== fourTied),
        s.name,
      ).toEqual(expected.sort());
      for (const c of cases) expect(c.state.sorts.length, c.name).toBeGreaterThan(0);
      // Never a row with no value in the first sorted column: for each column a case sorts by first that holds empty
      // cells, each way, text columns too, where empty text is no value.
      const textColumns = s.schema.columns
        .filter((col) => col.kind === "string" && col.id !== s.id && col.sensitivity !== "restricted")
        .map((col) => col.id);
      const kindOf = (columnId: string) => s.schema.columns.find((col) => col.id === columnId)?.kind;
      expect(
        cases
          .filter((c) => /^a count never keeps/.test(c.name) && textColumns.includes(c.state.sorts[0]?.columnId as string))
          .map((c) => `${c.state.sorts[0]?.columnId} ${c.state.sorts[0]?.direction}`)
          .sort(),
        s.name,
      ).toEqual(textColumns.flatMap((id) => [`${id} asc`, `${id} desc`]).sort());

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

// Ruling R2 (spec 5.5, `compare`): a count that cuts inside a run of tied rows may keep any of the tied rows for its
// last places. It must keep every row ahead of the tied value, none behind it, and exactly N rows in all.
describe("a count that cuts inside tied rows keeps any of them, every row ahead, none behind, and its number in all", () => {
  const tied = (check: QueryCheck) => check.cases.filter((c) => TIED.test(c.name));
  /** A tied case's rows by where they stand: ahead of the tied value, tied at the cut, and behind it. */
  const partsOf = (check: QueryCheck, s: Subject, c: QueryCheckCase) => {
    const sortId = c.state.sorts[0]?.columnId as string;
    const n = c.state.limit as number;
    // Every row a count may keep, in order: a count of all the rows leaves out only those with no value.
    const all = applyView(check.rows, { ...c.state, limit: check.rows.length }, s.schema).rows;
    const value = all[n - 1]?.[sortId];
    const idOf = (row: Row) => row[s.id] as string | number;
    return {
      n,
      sortId,
      all,
      ahead: all.filter((row, i) => i < n && row[sortId] !== value).map(idOf),
      run: all.filter((row) => row[sortId] === value).map(idOf),
      behind: all.filter((row, i) => i >= n && row[sortId] !== value).map(idOf),
    };
  };

  it("there is none without limit.set, and with it one for each number, date and yes/no column, each way", () => {
    for (const s of SUBJECTS) {
      expect(tied(full(queryCheck(s.schema, { id: s.id }))), s.name).toEqual([]);
      const check = checkOf(s);
      const columns = s.schema.columns.filter(
        (c) => ORDERED_KINDS.includes(c.kind) && c.id !== s.id && c.sensitivity !== "restricted" && c.capabilities.includes("sort"),
      );
      expect(columns.length, s.name).toBeGreaterThan(1);
      expect(
        tied(check)
          .map((c) => `${c.state.sorts[0]?.columnId} ${c.state.sorts[0]?.direction}`)
          .sort(),
        s.name,
      ).toEqual(columns.flatMap((c) => [`${c.id} asc`, `${c.id} desc`]).sort());
      for (const c of tied(check)) {
        expect(c.state.sorts, c.name).toHaveLength(1);
        expect(c.state.filters, c.name).toBeNull();
        expect(c.name).toMatch(/\(the first \d+ rows, sorted by .+, (ascending|descending)\)$/);
      }
    }
  });

  it("the cut falls inside a run of rows that tie on the sorted column: some of the run is kept, and some is not", () => {
    for (const s of SUBJECTS) {
      const check = checkOf(s);
      let withAhead = 0;
      let withBehind = 0;
      for (const c of tied(check)) {
        const { n, sortId, all, ahead, run, behind } = partsOf(check, s, c);
        expect(all.length, c.name).toBeGreaterThan(n);
        expect(all[n - 1]?.[sortId], c.name).toBe(all[n]?.[sortId]);
        expect(isEmptyCell(all[n - 1]?.[sortId]), c.name).toBe(false);
        expect(ahead.length, c.name).toBeLessThan(n);
        expect(ahead.length + run.length, c.name).toBeGreaterThan(n);
        expect(ahead.length + run.length + behind.length, c.name).toBe(all.length);
        withAhead += ahead.length > 0 ? 1 : 0;
        withBehind += behind.length > 0 ? 1 : 0;
      }
      // Most cases have rows on both sides of the run. A yes/no column has two values, so one side is empty there.
      expect(withAhead, s.name).toBeGreaterThan(tied(check).length / 2);
      expect(withBehind, s.name).toBeGreaterThan(tied(check).length / 2);
    }
  });

  it("compare accepts any of the tied rows for the last places, in any order among themselves", () => {
    for (const s of SUBJECTS) {
      const check = checkOf(s);
      for (const c of tied(check)) {
        const { n, ahead, run } = partsOf(check, s, c);
        const places = n - ahead.length;
        // applyView's own choice: the tied rows that were loaded first.
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
        expect(c.compare([...ahead, ...run.slice(0, places)]), c.name).toEqual({ ok: true });
        // The tied rows loaded last, the ones with the smallest ids, and the ones with the largest.
        expect(c.compare([...ahead, ...run.slice(-places)]), c.name).toEqual({ ok: true });
        const byId = [...run].sort((a, b) => Number(a) - Number(b));
        expect(c.compare([...ahead, ...byId.slice(0, places)]), c.name).toEqual({ ok: true });
        expect(c.compare([...ahead, ...byId.slice(-places).reverse()]), c.name).toEqual({ ok: true });
      }
    }
  });

  it("more rows than the count asks for fail, and the message says how many came back and how many were asked for", () => {
    for (const s of SUBJECTS) {
      const check = checkOf(s);
      for (const c of tied(check)) {
        const { n, ahead, run } = partsOf(check, s, c);
        // Every tied row, as RANK or WITH TIES keeps them.
        expect(c.compare([...ahead, ...run]), c.name).toEqual({
          ok: false,
          message: `${c.name}: ${ahead.length + run.length} rows came back, and the count asks for ${n}`,
        });
        // One tied row too many.
        expect(c.compare([...ahead, ...run.slice(0, n - ahead.length + 1)]), c.name).toEqual({
          ok: false,
          message: `${c.name}: ${n + 1} rows came back, and the count asks for ${n}`,
        });
      }
    }
  });

  it("fewer rows than the count asks for fail the same way", () => {
    for (const s of SUBJECTS) {
      const check = checkOf(s);
      for (const c of tied(check)) {
        const { n, ahead, run } = partsOf(check, s, c);
        // The tied run dropped.
        expect(c.compare(ahead), c.name).toEqual({
          ok: false,
          message: `${c.name}: ${ahead.length} ${ahead.length === 1 ? "row" : "rows"} came back, and the count asks for ${n}`,
        });
        // One tied row too few.
        const short = [...ahead, ...run.slice(0, n - ahead.length - 1)];
        expect(c.compare(short), c.name).toEqual({
          ok: false,
          message: `${c.name}: ${n - 1} ${n - 1 === 1 ? "row" : "rows"} came back, and the count asks for ${n}`,
        });
      }
    }
  });

  it("a row from behind the tied value fails as an extra row, and a row ahead of it left out as a missing one", () => {
    for (const s of SUBJECTS) {
      const check = checkOf(s);
      let checked = 0;
      for (const c of tied(check)) {
        const { n, ahead, run, behind } = partsOf(check, s, c);
        const places = n - ahead.length;
        const [late] = behind;
        if (late !== undefined) {
          // The right number of rows, with a row from behind the tie in a tied row's place.
          expect(c.compare([...ahead, ...run.slice(0, places - 1), late]), c.name).toEqual({
            ok: false,
            message: `${c.name}: 1 row extra, id ${late}`,
          });
          checked += 1;
        }
        const [early, ...others] = ahead;
        if (early !== undefined) {
          // The right number of rows, with one more tied row in place of a row ahead of the tie.
          expect(c.compare([...others, ...run.slice(0, places + 1)]), c.name).toEqual({
            ok: false,
            message: `${c.name}: 1 row missing, id ${early}`,
          });
          checked += 1;
        }
        // A row with no value in the sorted column is never kept, whatever else comes back.
        const empty = check.rows.find((row) => isEmptyCell(row[c.state.sorts[0]?.columnId as string]));
        if (empty) {
          const result = c.compare([...ahead, ...run.slice(0, places - 1), empty[s.id] as string | number]);
          expect(result, c.name).toEqual({ ok: false, message: `${c.name}: 1 row extra, id ${empty[s.id]}` });
        }
      }
      expect(checked, s.name).toBeGreaterThan(tied(check).length);
    }
  });

  it("the rows a count keeps are still checked for their order", () => {
    for (const s of SUBJECTS) {
      const check = checkOf(s);
      let checked = 0;
      for (const c of tied(check)) {
        const { n, ahead, run } = partsOf(check, s, c);
        if (ahead.length === 0) continue;
        // The tied rows first, then the rows that belong ahead of them.
        const result = c.compare([...run.slice(0, n - ahead.length), ...ahead]);
        expect(result.ok === false && result.message, c.name).toMatch(/: wrong order: id \S+ came where id \S+ belongs$/);
        checked += 1;
      }
      expect(checked, s.name).toBeGreaterThan(0);
    }
  });
});

// Ruling R3 (spec 5.5, `compare`): a row with an empty sort cell is checked by its leading sort columns that hold
// values, up to its first empty one. Where it sits among the rows that share those leading values is the Host's own.
describe("a row with no value in a later sorted column keeps its place by the columns before it", () => {
  const laterEmpty = (check: QueryCheck) => check.cases.filter((c) => LATER_EMPTY.test(c.name));
  /** A case's rows in applyView's order, each with its id and its two sort cells. */
  const sortedRows = (check: QueryCheck, s: Subject, c: QueryCheckCase) => {
    const [lead, then] = c.state.sorts.map((sort) => sort.columnId) as [string, string];
    return applyView(check.rows, c.state, s.schema).rows.map((row) => ({
      id: row[s.id] as string | number,
      lead: row[lead] as Scalar,
      // No value in the first sorted column: the row may sit anywhere.
      free: isEmptyCell(row[lead]),
      // A value in the first sorted column and none in the second: the row this rule is about.
      holed: !isEmptyCell(row[lead]) && isEmptyCell(row[then]),
    }));
  };
  const labelOf = (s: Subject, columnId: string) => s.schema.columns.find((col) => col.id === columnId)?.label as string;

  it("there are two cases with no count, both columns sorted the same way, on two number, date or yes/no columns", () => {
    for (const s of SUBJECTS) {
      for (const check of [full(queryCheck(s.schema, { id: s.id })), checkOf(s)]) {
        const cases = laterEmpty(check);
        expect(cases.map((c) => c.state.sorts.map((sort) => sort.direction).join(" ")).sort(), s.name).toEqual(["asc asc", "desc desc"]);
        for (const c of cases) {
          expect(c.state.limit, c.name).toBeUndefined();
          expect(c.state.filters, c.name).toBeNull();
          const kinds = c.state.sorts.map((sort) => s.schema.columns.find((col) => col.id === sort.columnId)?.kind);
          for (const kind of kinds) expect(ORDERED_KINDS, c.name).toContain(kind);
          const rows = sortedRows(check, s, c);
          // Such rows sit in more than one run of the first column's values, so moving them all to one end shows.
          expect(new Set(rows.filter((row) => row.holed).map((row) => String(row.lead))).size, c.name).toBeGreaterThan(1);
        }
      }
    }
  });

  it("such a row may sit first or last among the rows that share its first value, and a row with no first value anywhere", () => {
    for (const s of SUBJECTS) {
      const check = checkOf(s);
      for (const c of laterEmpty(check)) {
        const rows = sortedRows(check, s, c);
        const placed = rows.filter((row) => !row.free);
        const free = rows.filter((row) => row.free).map((row) => row.id);
        expect(free.length, c.name).toBeGreaterThan(0);
        // The runs of the first column's values, in order.
        const runs: (typeof rows)[] = [];
        for (const row of placed) {
          const last = runs.at(-1);
          if (last && last[0]?.lead === row.lead) last.push(row);
          else runs.push([row]);
        }
        const ids = (list: typeof rows) => list.map((row) => row.id);
        const holedFirst = runs.flatMap((run) => ids([...run.filter((row) => row.holed), ...run.filter((row) => !row.holed)]));
        const holedLast = runs.flatMap((run) => ids([...run.filter((row) => !row.holed), ...run.filter((row) => row.holed)]));
        expect(c.compare([...holedFirst, ...free]), c.name).toEqual({ ok: true });
        expect(c.compare([...free, ...holedLast]), c.name).toEqual({ ok: true });
        const half = Math.floor(holedLast.length / 2);
        expect(c.compare([...holedLast.slice(0, half), ...free.reverse(), ...holedLast.slice(half)]), c.name).toEqual({ ok: true });
      }
    }
  });

  it("moved past rows with another first value it fails, and the message names both rows and the column that decides", () => {
    for (const s of SUBJECTS) {
      const check = checkOf(s);
      for (const c of laterEmpty(check)) {
        const rows = sortedRows(check, s, c);
        const lead = labelOf(s, c.state.sorts[0]?.columnId as string);
        const holed = rows.filter((row) => row.holed).map((row) => row.id);
        const rest = rows.filter((row) => !row.holed).map((row) => row.id);
        // "ORDER BY (a IS NULL OR b IS NULL), a, b", and the same with such rows first.
        for (const moved of [
          [...rest, ...holed],
          [...holed, ...rest],
        ]) {
          const result = c.compare(moved);
          expect(result.ok, c.name).toBe(false);
          expect(result.ok === false && result.message, c.name).toMatch(
            new RegExp(`^.+: wrong order: id \\S+ came before id \\S+, which belongs ahead of it by ${lead}$`),
          );
          expect(result.ok === false && result.message.startsWith(`${c.name}: `), c.name).toBe(true);
        }
        // One such row, moved to the far end of the rows that hold a value.
        const first = rows.find((row) => row.holed) as (typeof rows)[number];
        const others = rows.filter((row) => row !== first);
        const lastPlaced = others.findLast((row) => !row.free) as (typeof rows)[number];
        expect(lastPlaced.lead, c.name).not.toBe(first.lead);
        const single = c.compare([...others.map((row) => row.id), first.id]);
        expect(single, c.name).toEqual({
          ok: false,
          message: `${c.name}: wrong order: id ${others.find((row) => !row.free && row.lead !== first.lead && rows.indexOf(row) > rows.indexOf(first))?.id} came before id ${first.id}, which belongs ahead of it by ${lead}`,
        });
      }
    }
  });

  it("the cases that sorted two columns before hold such a row to its place too", () => {
    for (const s of SUBJECTS) {
      const check = checkOf(s);
      const cases = check.cases.filter((c) => /^sorts by each column in turn, in its direction \(/.test(c.name));
      expect(cases, s.name).toHaveLength(2);
      for (const c of cases) {
        const rows = sortedRows(check, s, c);
        const holed = rows.filter((row) => row.holed).map((row) => row.id);
        expect(holed.length, c.name).toBeGreaterThan(0);
        const result = c.compare([...rows.filter((row) => !row.holed).map((row) => row.id), ...holed]);
        expect(result.ok === false && result.message, c.name).toMatch(
          /: wrong order: id \S+ came before id \S+, which belongs ahead of it by /,
        );
      }
    }
  });
});

// The second held-out check of the Query Check found five wrong translations no case told from a right one. Each class
// has its cases here, for every column of its kind.
describe("a count with two sorts that cuts inside rows that tie on the first keeps the ones the next column puts first", () => {
  const nextDecides = (check: QueryCheck) => check.cases.filter((c) => NEXT_DECIDES.test(c.name));
  /** The rows a count may keep, in core's order, and the run of rows that tie with the last kept on the first column. */
  const partsOf = (check: QueryCheck, s: Subject, c: QueryCheckCase) => {
    const [lead, then] = c.state.sorts.map((sort) => sort.columnId) as [string, string];
    const n = c.state.limit as number;
    const all = applyView(check.rows, { ...c.state, limit: check.rows.length }, s.schema).rows;
    const value = all[n - 1]?.[lead];
    const idOf = (row: Row) => row[s.id] as string | number;
    return {
      n,
      then,
      ahead: all.filter((row, i) => i < n && row[lead] !== value).map(idOf),
      run: all.filter((row) => row[lead] === value),
      idOf,
    };
  };

  it("none without limit.set; with it, for each number, date and yes/no column, a pair with the next column each way", () => {
    for (const s of SUBJECTS) {
      expect(nextDecides(full(queryCheck(s.schema, { id: s.id }))), s.name).toEqual([]);
      const check = checkOf(s);
      const kindOf = (columnId: string) => s.schema.columns.find((col) => col.id === columnId)?.kind;
      const leads = s.schema.columns.filter(
        (c) => ORDERED_KINDS.includes(c.kind) && c.id !== s.id && c.sensitivity !== "restricted" && c.capabilities.includes("sort"),
      );
      const cases = nextDecides(check);
      expect([...new Set(cases.map((c) => c.state.sorts[0]?.columnId))].sort(), s.name).toEqual(leads.map((c) => c.id).sort());
      for (const lead of leads) {
        const pair = cases.filter((c) => c.state.sorts[0]?.columnId === lead.id);
        expect(pair.map((c) => c.state.sorts[1]?.direction).sort(), lead.id).toEqual(["asc", "desc"]);
        // The same cut and the same next column, each way.
        expect(new Set(pair.map((c) => `${c.state.sorts[1]?.columnId} ${c.state.limit}`)).size, lead.id).toBe(1);
      }
      for (const c of cases) {
        expect(c.state.sorts, c.name).toHaveLength(2);
        expect(c.state.filters, c.name).toBeNull();
        for (const sort of c.state.sorts) expect(ORDERED_KINDS, c.name).toContain(kindOf(sort.columnId));
        const { n, ahead, run } = partsOf(check, s, c);
        // The cut falls inside the run: some of it is kept, and some is not.
        expect(ahead.length, c.name).toBeLessThan(n);
        expect(ahead.length + run.length, c.name).toBeGreaterThan(n);
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
      }
    }
  });

  it("the run's rows taken by the first column alone fail, whichever order a Data Query gives the rows that tie on it", () => {
    for (const s of SUBJECTS) {
      const check = checkOf(s);
      const cases = nextDecides(check);
      expect(cases.length, s.name).toBeGreaterThan(0);
      for (const c of cases) {
        const { n, ahead, run, idOf } = partsOf(check, s, c);
        const places = n - ahead.length;
        // Whichever run rows are taken in the order they were loaded, by id, or in reverse, one case of the pair fails.
        for (const taken of [run, [...run].reverse(), [...run].sort((a, b) => Number(a[s.id]) - Number(b[s.id]))]) {
          const pair = cases.filter((other) => other.state.sorts[0]?.columnId === c.state.sorts[0]?.columnId);
          const failed = pair.filter((other) => {
            const parts = partsOf(check, s, other);
            const ids = [...parts.ahead, ...taken.slice(0, parts.n - parts.ahead.length).map(idOf)];
            return !other.compare(ids).ok;
          });
          expect(failed.length, `${c.name}, ${places} places`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("a row the next column puts ahead of a kept row may not be left out, even with the right number of rows", () => {
    for (const s of SUBJECTS) {
      const check = checkOf(s);
      let checked = 0;
      for (const c of nextDecides(check)) {
        const { n, then, ahead, run, idOf } = partsOf(check, s, c);
        const right = applyView(check.rows, c.state, s.schema).rows.map(idOf);
        // The first run row with a value in the next column, left out for the first one core leaves out.
        const kept = new Set(right);
        const first = run.find((row) => !isEmptyCell(row[then]) && kept.has(idOf(row)));
        const spare = run.find((row) => !kept.has(idOf(row)) && !isEmptyCell(row[then]) && row[then] !== first?.[then]);
        if (!first || !spare) continue;
        const swapped = [...ahead, ...right.slice(ahead.length).filter((id) => id !== idOf(first)), idOf(spare)];
        expect(swapped, c.name).toHaveLength(n);
        const result = c.compare(swapped);
        expect(result.ok === false && result.message, c.name).toMatch(
          /: 1 row missing, id \S+; 1 row extra, id \S+$|: 1 row missing, id \S+$/,
        );
        checked += 1;
      }
      expect(checked, s.name).toBeGreaterThan(0);
    }
  });

  it("a count cut by the first sort alone fails, whichever way it breaks ties and sorts empty cells", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      for (const ties of ["reverse load order", "load order", "id ascending", "id descending"] as const) {
        for (const empties of ["lowest", "highest", "first", "last"] as const) {
          const failed = failuresOf(
            check,
            handQuery(check, s.schema, s.id, "the count is cut by the first sort alone", false, { ties, empties }),
          );
          expect(
            failed.filter((message) => NEXT_DECIDES.test(message)).length,
            `${s.name}, ties by ${ties}, empty cells ${empties}`,
          ).toBeGreaterThan(0);
        }
      }
    }
    // Sixteen Data Queries on each of four schemas: seconds, and more when the whole suite runs at once.
  }, 60_000);
});

describe("a count keeps a row with an empty cell in each later sorted column, text and enum columns too", () => {
  it("one for each column that a case sorts second and that holds empty cells, with such rows ahead of the cut", () => {
    for (const s of SUBJECTS) {
      for (const check of [full(queryCheck(s.schema, { id: s.id })), checkOf(s)]) {
        const counts = check.cases.some((c) => c.state.limit !== undefined);
        const cases = check.cases.filter((c) => EMPTY_LATER_IN_COUNT.test(c.name));
        if (!counts) {
          expect(cases, s.name).toEqual([]);
          continue;
        }
        const kindOf = (columnId: string) => s.schema.columns.find((col) => col.id === columnId)?.kind;
        const textual = (columnId: string) => kindOf(columnId) === "string" || kindOf(columnId) === "enum";
        // Every text and enum column the schema can sort, each of which holds empty cells.
        const collatedColumns = s.schema.columns
          .filter((col) => textual(col.id) && col.id !== s.id && col.sensitivity !== "restricted" && col.capabilities.includes("sort"))
          .map((col) => col.id);
        const seconds = cases.map((c) => c.state.sorts[1]?.columnId as string);
        for (const id of collatedColumns) expect(seconds, `${s.name} ${id}`).toContain(id);
        for (const c of cases) {
          const [lead, then] = c.state.sorts.map((sort) => sort.columnId) as [string, string];
          expect(ORDERED_KINDS, c.name).toContain(kindOf(lead));
          expect(c.state.filters, c.name).toBeNull();
          const kept = applyView(check.rows, c.state, s.schema).rows;
          expect(kept.length, c.name).toBe(c.state.limit);
          const empties = kept.filter((row) => isEmptyCell(row[then]));
          expect(empties.length, c.name).toBeGreaterThan(0);
          // On a text or enum column, a row with empty text is ahead of the cut too.
          if (textual(then))
            expect(
              empties.some((row) => row[then] === ""),
              c.name,
            ).toBe(true);
          // The cut falls between two values of the first column, and a row with a value in the second is behind it.
          const { limit: _cut, ...uncut } = c.state;
          const all = applyView(check.rows, { ...uncut, limit: check.rows.length }, s.schema).rows;
          expect(all[kept.length]?.[lead], c.name).not.toBe(kept.at(-1)?.[lead]);
          expect(
            all.slice(kept.length).some((row) => !isEmptyCell(row[then])),
            c.name,
          ).toBe(true);
          // Those rows left out, and rows from behind the cut in their place, fail.
          const others = all.filter((row) => !isEmptyCell(row[then])).slice(0, kept.length);
          expect(c.compare(others.map((row) => row[s.id] as string | number)).ok, c.name).toBe(false);
        }
      }
    }
  });
});

describe("sorts and hidden columns beside an or group", () => {
  for (const s of SUBJECTS) {
    it(`${s.name}: a sort beside an or group, an or group of three filters, and an or group inside an and, each way`, () => {
      for (const check of [full(queryCheck(s.schema, { id: s.id })), checkOf(s)]) {
        const cases = check.cases.filter((c) => /^a sort beside an or group still orders the rows \(/.test(c.name));
        expect(cases.length, s.name).toBe(6);
        expect(cases.map((c) => `${orShape(c)} ${c.state.sorts[0]?.direction}`).sort(), s.name).toEqual([
          "or asc",
          "or desc",
          "or inside and asc",
          "or inside and desc",
          "or of three asc",
          "or of three desc",
        ]);
        for (const c of cases) {
          expect(c.state.sorts, c.name).toHaveLength(1);
          expect(c.state.limit, c.name).toBeUndefined();
          expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
          // The filters kept and the sort lost: the right rows, in the order they were loaded.
          const unsorted = applyView(check.rows, { ...c.state, sorts: [] }, s.schema).rows.map((row) => row[s.id] as string | number);
          const result = c.compare(unsorted);
          expect(result.ok === false && result.message, c.name).toMatch(/: wrong order: id \S+ came where id \S+ belongs$/);
        }
      }
    });

    it(`${s.name}: a filter on each column, with that column hidden, inside an or group`, () => {
      const check = full(checkOf(s));
      const cases = check.cases.filter((c) => /^a filter on a hidden column still holds in an or group \(/.test(c.name));
      const filterable = s.schema.columns.filter(
        (c) => c.sensitivity !== "restricted" && c.id !== s.id && c.capabilities.includes("filter"),
      );
      const hiddenOf = (c: QueryCheckCase) => predicatesOf(c.state.filters).find((p) => !c.state.visibleColumnIds.includes(p.columnId));
      expect(cases.map((c) => hiddenOf(c)?.columnId).sort(), s.name).toEqual(filterable.map((c) => c.id).sort());
      for (const c of cases) {
        expect(c.state.filters?.combinator, c.name).toBe("or");
        const hidden = hiddenOf(c) as FilterPredicate;
        // With the hidden column's filter dropped, the or group keeps fewer rows, or every row.
        const rest = {
          ...(c.state.filters as FilterGroup),
          children: (c.state.filters as FilterGroup).children.filter((x) => x !== hidden),
        };
        const dropped = applyView(check.rows, { ...c.state, filters: rest }, s.schema).rows.map((row) => row[s.id] as string | number);
        expect(c.compare(dropped).ok, c.name).toBe(false);
        expect(applyView(check.rows, c.state, s.schema).rows.length, c.name).toBeLessThan(check.rows.length);
      }
    });
  }
});

// The third held-out check of the Query Check found six wrong translations no case told from a right one. Each class
// has its cases here, for every column of its kind.
describe("three sorts in a count, sorts and counts beside an or group, hidden columns, and text of other lengths", () => {
  /** The cases whose names match `rule`. */
  const named = (check: QueryCheck, rule: RegExp) => check.cases.filter((c) => rule.test(c.name));
  const kindIn = (s: Subject) => (columnId: string) => s.schema.columns.find((col) => col.id === columnId)?.kind;
  const sortableOf = (s: Subject) =>
    s.schema.columns.filter(
      (c) => ORDERED_KINDS.includes(c.kind) && c.id !== s.id && c.sensitivity !== "restricted" && c.capabilities.includes("sort"),
    );
  const idsOf = (s: Subject, rows: Row[]) => rows.map((row) => row[s.id] as string | number);

  it("a count with three sorts cuts inside rows that tie on the first two, and the third, each way, decides", () => {
    for (const s of SUBJECTS) {
      expect(named(full(queryCheck(s.schema, { id: s.id })), THIRD_DECIDES), s.name).toEqual([]);
      const check = checkOf(s);
      const kindOf = kindIn(s);
      const cases = named(check, THIRD_DECIDES);
      // Each number, date and yes/no column leads one pair.
      const leads = new Set(cases.map((c) => c.state.sorts[0]?.columnId));
      expect([...leads].sort(), s.name).toEqual(
        sortableOf(s)
          .map((c) => c.id)
          .sort(),
      );
      for (const lead of leads) {
        const pair = cases.filter((c) => c.state.sorts[0]?.columnId === lead);
        expect(pair.map((c) => c.state.sorts[2]?.direction).sort(), String(lead)).toEqual(["asc", "desc"]);
        expect(new Set(pair.map((c) => `${c.state.sorts[1]?.columnId} ${c.state.sorts[2]?.columnId} ${c.state.limit}`)).size).toBe(1);
      }
      for (const c of cases) {
        expect(c.state.sorts, c.name).toHaveLength(3);
        expect(new Set(c.state.sorts.map((sort) => sort.columnId)).size, c.name).toBe(3);
        expect(c.state.filters, c.name).toBeNull();
        for (const sort of c.state.sorts) expect(ORDERED_KINDS, c.name).toContain(kindOf(sort.columnId));
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
        // The cut falls inside a run of rows that tie on the first two columns: some of it is kept, and some is not.
        const [a, b] = c.state.sorts.map((sort) => sort.columnId) as [string, string];
        const n = c.state.limit as number;
        const all = applyView(check.rows, { ...c.state, limit: check.rows.length }, s.schema).rows;
        const last = all[n - 1] as Row;
        const tied = (row: Row) => row[a] === last[a] && row[b] === last[b];
        expect(all.slice(0, n).filter((row) => !tied(row)).length, c.name).toBeLessThan(n);
        expect(all.slice(n).some(tied), c.name).toBe(true);
      }
    }
  });

  it("a count cut by its first two sorts alone fails, whichever way it breaks ties and sorts empty cells", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      for (const ties of ["reverse load order", "load order", "id ascending", "id descending"] as const) {
        for (const empties of ["lowest", "highest", "first", "last"] as const) {
          const failed = failuresOf(
            check,
            handQuery(check, s.schema, s.id, "the count is cut by its first two sorts alone", false, { ties, empties }),
          );
          expect(failed.length, `${s.name}, ties by ${ties}, empty cells ${empties}`).toBeGreaterThan(0);
          // With four sorts, or the third hidden, it cuts by fewer than all of them too. So it does where the cut falls
          // inside rows that tie on three sorts or four: of the rows that tie on the first two it takes any.
          expect(
            failed.filter((message) => ![THIRD_DECIDES, FOURTH_DECIDES, COUNT_HIDDEN_THIRD, ALL_TIED].some((rule) => rule.test(message))),
            `${s.name}, ties by ${ties}, empty cells ${empties}`,
          ).toEqual([]);
        }
      }
    }
    // Sixteen Data Queries on each of four schemas: seconds, and more when the whole suite runs at once.
  }, 60_000);

  it("two sorts beside each or group order the rows by each in turn, with limit.set listed and without", () => {
    for (const s of SUBJECTS) {
      for (const check of [full(queryCheck(s.schema, { id: s.id })), checkOf(s)]) {
        const kindOf = kindIn(s);
        const cases = named(check, TWO_SORTS_BESIDE_OR);
        // Beside each shape of or group, the first sort each way and the second sort each way.
        expect(cases.map((c) => `${orShape(c)} ${c.state.sorts.map((sort) => sort.direction).join(" ")}`).sort(), s.name).toEqual(
          ["or", "or inside and", "or of three"].flatMap((shape) =>
            ["asc asc", "asc desc", "desc asc", "desc desc"].map((ways) => `${shape} ${ways}`),
          ),
        );
        for (const c of cases) {
          expect(c.state.sorts, c.name).toHaveLength(2);
          for (const sort of c.state.sorts) expect(ORDERED_KINDS, c.name).toContain(kindOf(sort.columnId));
          expect(c.state.limit, c.name).toBeUndefined();
          expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
          // The filters kept, and only the first sort.
          const byFirst = applyView(check.rows, { ...c.state, sorts: c.state.sorts.slice(0, 1) }, s.schema).rows;
          const result = c.compare(idsOf(s, byFirst));
          expect(result.ok === false && result.message, c.name).toMatch(/: wrong order: id \S+ came where id \S+ belongs$/);
        }
      }
    }
  });

  it("a count beside each or group keeps only its first rows, and only with limit.set", () => {
    for (const s of SUBJECTS) {
      expect(named(full(queryCheck(s.schema, { id: s.id })), COUNT_BESIDE_OR), s.name).toEqual([]);
      const check = checkOf(s);
      const cases = named(check, COUNT_BESIDE_OR);
      // Beside each shape of or group, the sort each way.
      expect(cases.map((c) => `${orShape(c)} ${c.state.sorts[0]?.direction}`).sort(), s.name).toEqual(
        ["or", "or inside and", "or of three"].flatMap((shape) => [`${shape} asc`, `${shape} desc`]),
      );
      for (const c of cases) {
        expect(c.state.sorts, c.name).toHaveLength(1);
        expect(ORDERED_KINDS, c.name).toContain(kindIn(s)(c.state.sorts[0]?.columnId as string));
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
        // The count dropped: every row the filters keep, sorted.
        const uncut = applyView(check.rows, { ...c.state, limit: undefined }, s.schema).rows;
        expect(uncut.length, c.name).toBeGreaterThan(c.state.limit as number);
        const result = c.compare(idsOf(s, uncut));
        expect(result.ok === false && result.message, c.name).toMatch(/: \d+ rows? extra, ids? /);
      }
    }
  });

  it("a filter on each column, with that column hidden, inside an or group inside an and", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      const cases = named(check, HIDDEN_IN_NESTED_OR);
      const filterable = s.schema.columns.filter(
        (c) => c.sensitivity !== "restricted" && c.id !== s.id && c.capabilities.includes("filter"),
      );
      const hiddenOf = (c: QueryCheckCase) => predicatesOf(c.state.filters).find((p) => !c.state.visibleColumnIds.includes(p.columnId));
      expect(cases.map((c) => hiddenOf(c)?.columnId).sort(), s.name).toEqual(filterable.map((c) => c.id).sort());
      for (const c of cases) {
        const root = c.state.filters as FilterGroup;
        expect(root.combinator, c.name).toBe("and");
        const inner = root.children.find((child): child is FilterGroup => child.type === "group") as FilterGroup;
        expect(inner.combinator, c.name).toBe("or");
        const hidden = hiddenOf(c) as FilterPredicate;
        expect(inner.children, c.name).toContain(hidden);
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
        // With the hidden column's filter dropped from the inner or group, other rows come back.
        const dropped = {
          ...root,
          children: root.children.map((child) =>
            child === inner ? { ...inner, children: inner.children.filter((x) => x !== hidden) } : child,
          ),
        };
        const ids = idsOf(s, applyView(check.rows, { ...c.state, filters: dropped }, s.schema).rows);
        expect(c.compare(ids).ok, c.name).toBe(false);
      }
    }
  });

  it("a count still sorts by a hidden column: each number, date and yes/no column alone, and a hidden second sort each way", () => {
    for (const s of SUBJECTS) {
      expect(named(full(queryCheck(s.schema, { id: s.id })), COUNT_HIDDEN_SORT), s.name).toEqual([]);
      expect(named(full(queryCheck(s.schema, { id: s.id })), COUNT_HIDDEN_SECOND), s.name).toEqual([]);
      const check = checkOf(s);
      const alone = named(check, COUNT_HIDDEN_SORT);
      expect(alone.map((c) => c.state.sorts[0]?.columnId).sort(), s.name).toEqual(
        sortableOf(s)
          .map((c) => c.id)
          .sort(),
      );
      for (const c of alone) {
        const [sort] = c.state.sorts as [ViewState["sorts"][number]];
        expect(c.state.sorts, c.name).toHaveLength(1);
        expect(c.state.visibleColumnIds, c.name).not.toContain(sort.columnId);
        expect(c.state.limit, c.name).toBeGreaterThan(0);
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
        // The hidden sort dropped: the first rows with a value, in the order they were loaded.
        const loaded = check.rows.filter((row) => !isEmptyCell(row[sort.columnId])).slice(0, c.state.limit);
        expect(c.compare(idsOf(s, loaded)).ok, c.name).toBe(false);
      }
      const second = named(check, COUNT_HIDDEN_SECOND);
      expect(second.map((c) => c.state.sorts[1]?.direction).sort(), s.name).toEqual(["asc", "desc"]);
      for (const c of second) {
        const [lead, then] = c.state.sorts.map((sort) => sort.columnId) as [string, string];
        expect(c.state.sorts, c.name).toHaveLength(2);
        expect(c.state.visibleColumnIds, c.name).toContain(lead);
        expect(c.state.visibleColumnIds, c.name).not.toContain(then);
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
      }
      // The hidden second sort dropped: cut by the first sort alone. Whichever way ties fall, one of the pair fails.
      for (const ties of ["reverse load order", "load order", "id ascending", "id descending"] as const) {
        const query = handQuery(check, s.schema, s.id, "the count drops a sort on a hidden column", false, { ties });
        expect(second.filter((c) => !c.compare(query(c.state)).ok).length, `${s.name}, ${ties}`).toBeGreaterThan(0);
      }
    }
  });

  it("a text column holds text of the letters A to Z of different lengths, so text sorted by its length first fails", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      const textColumns = s.schema.columns.filter((c) => c.kind === "string" && c.id !== s.id && c.sensitivity !== "restricted");
      for (const column of textColumns) {
        const letters = [...new Set(cellsOf(check, column.id))].filter(
          (v): v is string => typeof v === "string" && /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(v),
        );
        const byLetters = [...letters].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        // Ordered by length first, either way, with the letters either way after it: never the letters' order, either way.
        for (const length of [1, -1]) {
          for (const then of [1, -1]) {
            const byLength = [...letters].sort((a, b) => length * (a.length - b.length) || then * a.localeCompare(b));
            expect(byLength, column.id).not.toEqual(byLetters);
            expect(byLength, column.id).not.toEqual([...byLetters].reverse());
          }
        }
      }
      const cases = named(check, /^text sorts by its letters, ignoring case \(/);
      expect(cases.length, s.name).toBe(2 * textColumns.length);
      const failed = failuresOf(check, handQuery(check, s.schema, s.id, "text sorts by its length first"));
      for (const c of cases) {
        expect(
          failed.filter((message) => message.startsWith(`${c.name}: wrong order`)),
          c.name,
        ).toHaveLength(1);
      }
    }
  });
});

// The review of the Query Check's second round found wrong translations no case told from a right one: sorts beside a
// filter joined with "and", a second sort's direction, counts that cut inside tied rows beside a filter or with text or
// an enum, four sorts, and groups of three or nested the other way. Each class has its cases here.
describe("sorts and counts beside a filter, text and enums in a count, four sorts, and more or groups", () => {
  const named = (check: QueryCheck, rule: RegExp) => check.cases.filter((c) => rule.test(c.name));
  const kindIn = (s: Subject) => (columnId: string) => s.schema.columns.find((col) => col.id === columnId)?.kind;
  const usable = (s: Subject) => s.schema.columns.filter((c) => c.id !== s.id && c.sensitivity !== "restricted");
  const sortableOf = (s: Subject) => usable(s).filter((c) => ORDERED_KINDS.includes(c.kind) && c.capabilities.includes("sort"));
  const collatedOf = (s: Subject) => usable(s).filter((c) => (c.kind === "string" || c.kind === "enum") && c.capabilities.includes("sort"));
  const idsOf = (s: Subject, rows: Row[]) => rows.map((row) => row[s.id] as string | number);
  const TIES = ["reverse load order", "load order", "id ascending", "id descending"] as const;

  it("an or group of three filters, each keeping a row the other two don't, with a sort and a count beside it", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      const c = theCase(check, OR_OF_THREE);
      const root = c.state.filters as FilterGroup;
      expect(root.combinator, c.name).toBe("or");
      expect(
        root.children.map((child) => child.type),
        c.name,
      ).toEqual(["predicate", "predicate", "predicate"]);
      const kept = idsOf(s, applyView(check.rows, c.state, s.schema).rows);
      expect(kept.length, c.name).toBeLessThan(check.rows.length);
      for (const left of root.children) {
        const rest = { ...root, children: root.children.filter((child) => child !== left) };
        expect(c.compare(idsOf(s, applyView(check.rows, { ...c.state, filters: rest }, s.schema).rows)).ok, c.name).toBe(false);
      }
      for (const rule of [/^a sort beside an or group still orders the rows \(/, TWO_SORTS_BESIDE_OR, COUNT_BESIDE_OR]) {
        expect(named(check, rule).filter((other) => orShape(other) === "or of three").length, String(rule)).toBeGreaterThan(0);
      }
    }
  });

  it("a filter on each column, with that column hidden, inside an and group inside an or", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      const cases = named(check, HIDDEN_IN_NESTED_AND);
      const hiddenOf = (c: QueryCheckCase) => predicatesOf(c.state.filters).find((p) => !c.state.visibleColumnIds.includes(p.columnId));
      expect(cases.map((c) => hiddenOf(c)?.columnId).sort(), s.name).toEqual(
        usable(s)
          .filter((c) => c.capabilities.includes("filter"))
          .map((c) => c.id)
          .sort(),
      );
      for (const c of cases) {
        const root = c.state.filters as FilterGroup;
        expect(root.combinator, c.name).toBe("or");
        const inner = root.children.find((child): child is FilterGroup => child.type === "group") as FilterGroup;
        expect(inner.combinator, c.name).toBe("and");
        const hidden = hiddenOf(c) as FilterPredicate;
        expect(inner.children, c.name).toContain(hidden);
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
        const dropped = {
          ...root,
          children: root.children.map((child) =>
            child === inner ? { ...inner, children: inner.children.filter((x) => x !== hidden) } : child,
          ),
        };
        expect(c.compare(idsOf(s, applyView(check.rows, { ...c.state, filters: dropped }, s.schema).rows)).ok, c.name).toBe(false);
      }
    }
  });

  it("a count that cuts inside tied rows beside a filter, for each number, date and yes/no column, and only with limit.set", () => {
    for (const s of SUBJECTS) {
      expect(named(full(queryCheck(s.schema, { id: s.id })), TIED_BESIDE_FILTER), s.name).toEqual([]);
      const check = checkOf(s);
      const cases = named(check, TIED_BESIDE_FILTER);
      // Each number, date and yes/no column, descending. The pairs promise adds more, each way: one for each operator.
      const descending = cases.filter((c) => c.state.sorts[0]?.direction === "desc").map((c) => c.state.sorts[0]?.columnId);
      expect([...new Set(descending)].sort(), s.name).toEqual(
        sortableOf(s)
          .map((c) => c.id)
          .sort(),
      );
      expect(
        cases.some((c) => c.state.sorts[0]?.direction === "asc"),
        s.name,
      ).toBe(true);
      for (const c of cases) {
        expect(c.state.filters?.combinator, c.name).toBe("and");
        expect(c.state.sorts, c.name).toHaveLength(1);
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
        // The cut falls inside a run of rows that tie: the last row kept and the first left out hold the same value.
        const columnId = c.state.sorts[0]?.columnId as string;
        const n = c.state.limit as number;
        const all = applyView(check.rows, { ...c.state, limit: check.rows.length }, s.schema).rows;
        expect(all[n - 1]?.[columnId], c.name).toBe(all[n]?.[columnId]);
        // Every tied row kept, as RANK keeps them: too many rows.
        const ranked = all.filter((row, i) => i < n || row[columnId] === all[n - 1]?.[columnId]);
        const result = c.compare(idsOf(s, ranked));
        expect(result.ok === false && result.message, c.name).toMatch(/: \d+ rows came back, and the count asks for \d+$/);
      }
    }
  });

  it("a count with text or an enum sorted second, cut inside rows that tie on the first: a pair for each such column", () => {
    for (const s of SUBJECTS) {
      expect(named(full(queryCheck(s.schema, { id: s.id })), COLLATED_NEXT_DECIDES), s.name).toEqual([]);
      const check = checkOf(s);
      const kindOf = kindIn(s);
      const cases = named(check, COLLATED_NEXT_DECIDES);
      const thens = [...new Set(cases.map((c) => c.state.sorts[1]?.columnId))].sort();
      expect(thens, s.name).toEqual(
        collatedOf(s)
          .map((c) => c.id)
          .sort(),
      );
      for (const then of thens) {
        const pair = cases.filter((c) => c.state.sorts[1]?.columnId === then);
        expect(pair.map((c) => c.state.sorts[1]?.direction).sort(), String(then)).toEqual(["asc", "desc"]);
        expect(new Set(pair.map((c) => `${c.state.sorts[0]?.columnId} ${c.state.limit} ${JSON.stringify(c.state.filters)}`)).size).toBe(1);
        // Cut by the first sort alone, the run's rows are the same both ways: one of the pair fails, however ties fall.
        for (const ties of TIES) {
          const query = handQuery(
            check,
            s.schema,
            s.id,
            "the count is cut by the first sort alone when text or an enum is sorted next",
            false,
            {
              ties,
            },
          );
          expect(pair.filter((c) => !c.compare(query(c.state)).ok).length, `${s.name} ${then} ${ties}`).toBeGreaterThan(0);
        }
      }
      for (const c of cases) {
        expect(ORDERED_KINDS, c.name).toContain(kindOf(c.state.sorts[0]?.columnId as string));
        expect(["string", "enum"], c.name).toContain(kindOf(c.state.sorts[1]?.columnId as string));
        // Beside a filter that keeps only values whose order is checked.
        const [only] = predicatesOf(c.state.filters);
        expect(only?.operator, c.name).toBe("in");
        expect(only?.columnId, c.name).toBe(c.state.sorts[1]?.columnId);
        for (const value of (only?.value ?? []) as string[]) expect(value, c.name).toMatch(/^[A-Za-z]+(?: [A-Za-z]+)*$/);
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
      }
    }
  });

  it("a count sorted by text or an enum, each way, fails when cut from the far end or by character code", () => {
    for (const s of SUBJECTS) {
      expect(named(full(queryCheck(s.schema, { id: s.id })), COUNT_BY_COLLATED), s.name).toEqual([]);
      const check = checkOf(s);
      const cases = named(check, COUNT_BY_COLLATED);
      // Each column each way, at one cut, and at one more where another order keeps the right rows at the first.
      expect([...new Set(cases.map((c) => `${c.state.sorts[0]?.columnId} ${c.state.sorts[0]?.direction}`))].sort(), s.name).toEqual(
        collatedOf(s)
          .flatMap((c) => [`${c.id} asc`, `${c.id} desc`])
          .sort(),
      );
      expect(new Set(cases.map((c) => c.name)).size, s.name).toBe(cases.length);
      for (const c of cases) expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
      const ends = handQuery(check, s.schema, s.id, "a count sorted by text or an enum first takes its rows from the end");
      expect(
        cases.filter((c) => c.compare(ends(c.state)).ok).map((c) => c.name),
        s.name,
      ).toEqual([]);
      // By character code: every text column, at least one way.
      const byCode = handQuery(check, s.schema, s.id, "a count cuts text by character code");
      for (const column of collatedOf(s).filter((c) => c.kind === "string")) {
        const mine = cases.filter((c) => c.state.sorts[0]?.columnId === column.id);
        expect(mine.filter((c) => !c.compare(byCode(c.state)).ok).length, column.id).toBeGreaterThan(0);
      }
    }
  });

  it("a count with four sorts cut inside rows that tie on the first three, and a count whose third sort is hidden", () => {
    for (const s of SUBJECTS) {
      expect(named(full(queryCheck(s.schema, { id: s.id })), FOURTH_DECIDES), s.name).toEqual([]);
      expect(named(full(queryCheck(s.schema, { id: s.id })), COUNT_HIDDEN_THIRD), s.name).toEqual([]);
      const check = checkOf(s);
      const kindOf = kindIn(s);
      const cases = named(check, FOURTH_DECIDES);
      expect(cases.length, s.name).toBeGreaterThan(0);
      const leads = [...new Set(cases.map((c) => c.state.sorts[0]?.columnId))];
      for (const lead of leads) {
        const pair = cases.filter((c) => c.state.sorts[0]?.columnId === lead);
        expect(pair.map((c) => c.state.sorts[3]?.direction).sort(), String(lead)).toEqual(["asc", "desc"]);
        expect(new Set(pair.map((c) => `${c.state.sorts.slice(0, 3).map((sort) => sort.columnId)} ${c.state.limit}`)).size).toBe(1);
      }
      for (const c of cases) {
        expect(new Set(c.state.sorts.map((sort) => sort.columnId)).size, c.name).toBe(4);
        expect(ORDERED_KINDS, c.name).toContain(kindOf(c.state.sorts[0]?.columnId as string));
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
      }
      // Cut by the first three alone: one of each pair fails, however ties fall and empty cells sort.
      for (const ties of TIES) {
        const query = handQuery(check, s.schema, s.id, "the count is cut by its first three sorts alone", false, { ties });
        for (const lead of leads) {
          const pair = cases.filter((c) => c.state.sorts[0]?.columnId === lead);
          expect(pair.filter((c) => !c.compare(query(c.state)).ok).length, `${s.name} ${lead} ${ties}`).toBeGreaterThan(0);
        }
      }
      const hidden = named(check, COUNT_HIDDEN_THIRD);
      expect(hidden.map((c) => c.state.sorts[2]?.direction).sort(), s.name).toEqual(["asc", "desc"]);
      for (const c of hidden) {
        expect(c.state.visibleColumnIds, c.name).not.toContain(c.state.sorts[2]?.columnId);
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
      }
      for (const ties of TIES) {
        const query = handQuery(check, s.schema, s.id, "the count drops a hidden last sort of three", false, { ties });
        expect(hidden.filter((c) => !c.compare(query(c.state)).ok).length, `${s.name}, ${ties}`).toBeGreaterThan(0);
      }
    }
  });
});

// The re-check of the Query Check's second round found wrong translations that build the count or the sorts another way
// only beside an or group, or only where a column is hidden: a count that keeps every tied row, cuts by the first sort
// alone, or drops a later sort there. The class is closed by one rule: each sort and count rule runs beside each or
// group, and beside each shape of a filter on a hidden column, with the sorted columns hidden too.
describe("every sort and count rule beside each or group, and beside each shape of a filter on a hidden column", () => {
  const named = (check: QueryCheck, rule: RegExp) => check.cases.filter((c) => rule.test(c.name));
  const idsOf = (s: Subject, rows: Row[]) => rows.map((row) => row[s.id] as string | number);
  const TIES = ["reverse load order", "load order", "id ascending", "id descending"] as const;
  /** The shape of a case's filters that holds a filter on a hidden column. */
  const hiddenShape = (c: QueryCheckCase): string => {
    const root = c.state.filters as FilterGroup;
    const inner = root.children.find((child): child is FilterGroup => child.type === "group");
    if (inner) return `${inner.combinator} inside ${root.combinator}`;
    return root.combinator === "or" ? "or" : "alone";
  };
  const HIDDEN_SHAPES = ["alone", "and inside or", "or", "or inside and"];
  /** Every sorted column is hidden, and so is one filtered column. */
  const hidesAll = (c: QueryCheckCase) => {
    for (const sort of c.state.sorts) expect(c.state.visibleColumnIds, c.name).not.toContain(sort.columnId);
    expect(
      predicatesOf(c.state.filters).some((p) => !c.state.visibleColumnIds.includes(p.columnId)),
      c.name,
    ).toBe(true);
  };

  it("a count that cuts inside tied rows, beside each or group and each shape of a filter on a hidden column", () => {
    for (const s of SUBJECTS) {
      const without = full(queryCheck(s.schema, { id: s.id }));
      expect(named(without, TIED_BESIDE_OR), s.name).toEqual([]);
      expect(named(without, TIED_BESIDE_HIDDEN), s.name).toEqual([]);
      const check = checkOf(s);
      // Beside each, the sort each way.
      const beside = named(check, TIED_BESIDE_OR);
      expect(beside.map((c) => `${orShape(c)} ${c.state.sorts[0]?.direction}`).sort(), s.name).toEqual(
        ["or", "or inside and", "or of three"].flatMap((shape) => [`${shape} asc`, `${shape} desc`]),
      );
      const hidden = named(check, TIED_BESIDE_HIDDEN);
      expect(hidden.map((c) => `${hiddenShape(c)} ${c.state.sorts[0]?.direction}`).sort(), s.name).toEqual(
        HIDDEN_SHAPES.flatMap((shape) => [`${shape} asc`, `${shape} desc`]),
      );
      for (const c of hidden) hidesAll(c);
      for (const c of [...beside, ...hidden]) {
        expect(c.state.sorts, c.name).toHaveLength(1);
        expect(ORDERED_KINDS, c.name).toContain(s.schema.columns.find((col) => col.id === c.state.sorts[0]?.columnId)?.kind);
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
        // The cut falls inside a run of rows that tie: the last row kept and the first left out hold the same value.
        const columnId = c.state.sorts[0]?.columnId as string;
        const n = c.state.limit as number;
        const all = applyView(check.rows, { ...c.state, limit: check.rows.length }, s.schema).rows;
        expect(all[n - 1]?.[columnId], c.name).toBe(all[n]?.[columnId]);
        // Every tied row kept, as RANK keeps them: too many rows. The tied run dropped: too few.
        const ranked = all.filter((row, i) => i < n || row[columnId] === all[n - 1]?.[columnId]);
        expect(c.compare(idsOf(s, ranked)), c.name).toMatchObject({ ok: false, message: expect.stringMatching(/came back/) });
        const dropped = all.slice(0, n).filter((row) => row[columnId] !== all[n - 1]?.[columnId]);
        expect(c.compare(idsOf(s, dropped)).ok, c.name).toBe(false);
      }
    }
  });

  it("a count with two sorts cut inside rows that tie on the first, beside each or group and each hidden shape, each way", () => {
    for (const s of SUBJECTS) {
      const without = full(queryCheck(s.schema, { id: s.id }));
      expect(named(without, NEXT_BESIDE_OR), s.name).toEqual([]);
      expect(named(without, NEXT_BESIDE_HIDDEN), s.name).toEqual([]);
      const check = checkOf(s);
      // Beside each, the first sort each way and the second sort each way.
      const ways = (c: QueryCheckCase) => c.state.sorts.map((sort) => sort.direction).join(" ");
      const EACH_WAY = ["asc asc", "asc desc", "desc asc", "desc desc"];
      const beside = named(check, NEXT_BESIDE_OR);
      expect(beside.map((c) => `${orShape(c)} ${ways(c)}`).sort(), s.name).toEqual(
        ["or", "or inside and", "or of three"].flatMap((shape) => EACH_WAY.map((way) => `${shape} ${way}`)),
      );
      const hidden = named(check, NEXT_BESIDE_HIDDEN);
      expect(hidden.map((c) => `${hiddenShape(c)} ${ways(c)}`).sort(), s.name).toEqual(
        HIDDEN_SHAPES.flatMap((shape) => EACH_WAY.map((way) => `${shape} ${way}`)),
      );
      for (const c of hidden) hidesAll(c);
      for (const c of [...beside, ...hidden]) {
        expect(c.state.sorts, c.name).toHaveLength(2);
        expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
      }
      // Each pair shares its filters, first sort and cut. Cut by the first sort alone, one of the pair fails, however
      // ties fall.
      const pairs = [...beside, ...hidden].reduce((byKey, c) => {
        const key = `${JSON.stringify(c.state.filters)} ${JSON.stringify(c.state.sorts[0])} ${c.state.sorts[1]?.columnId} ${c.state.limit}`;
        byKey.set(key, [...(byKey.get(key) ?? []), c]);
        return byKey;
      }, new Map<string, QueryCheckCase[]>());
      expect(
        [...pairs.values()].map((pair) => pair.length),
        s.name,
      ).toEqual([...pairs.values()].map(() => 2));
      for (const ties of TIES) {
        const query = handQuery(check, s.schema, s.id, "the count is cut by the first sort alone", false, { ties });
        for (const pair of pairs.values()) {
          expect(pair.filter((c) => !c.compare(query(c.state)).ok).length, `${s.name} ${pair[0]?.name} ${ties}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("a sort, two sorts and a count beside each shape of a filter on a hidden column, with the sorted columns hidden", () => {
    for (const s of SUBJECTS) {
      for (const check of [full(queryCheck(s.schema, { id: s.id })), checkOf(s)]) {
        const counted = check.cases.some((c) => c.state.limit !== undefined);
        const one = named(check, SORT_BESIDE_HIDDEN);
        expect(one.map((c) => `${hiddenShape(c)} ${c.state.sorts[0]?.direction}`).sort(), s.name).toEqual(
          HIDDEN_SHAPES.flatMap((shape) => [`${shape} asc`, `${shape} desc`]),
        );
        // Two sorts, the first each way and the second each way.
        const two = named(check, TWO_SORTS_BESIDE_HIDDEN);
        expect(two.map((c) => `${hiddenShape(c)} ${c.state.sorts.map((sort) => sort.direction).join(" ")}`).sort(), s.name).toEqual(
          HIDDEN_SHAPES.flatMap((shape) => ["asc asc", "asc desc", "desc asc", "desc desc"].map((ways) => `${shape} ${ways}`)),
        );
        const count = named(check, COUNT_BESIDE_HIDDEN);
        expect(count.map((c) => `${hiddenShape(c)} ${c.state.sorts[0]?.direction}`).sort(), s.name).toEqual(
          counted ? HIDDEN_SHAPES.flatMap((shape) => [`${shape} asc`, `${shape} desc`]) : [],
        );
        for (const c of [...one, ...two, ...count]) {
          hidesAll(c);
          expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
        }
        for (const c of one) {
          expect(c.state.limit, c.name).toBeUndefined();
          // The sort lost: the right rows, in the order they were loaded.
          const unsorted = applyView(check.rows, { ...c.state, sorts: [] }, s.schema).rows;
          expect(c.compare(idsOf(s, unsorted)), c.name).toMatchObject({ ok: false, message: expect.stringMatching(/wrong order/) });
        }
        for (const c of two) {
          expect(c.state.limit, c.name).toBeUndefined();
          // Only the first sort kept.
          const byFirst = applyView(check.rows, { ...c.state, sorts: c.state.sorts.slice(0, 1) }, s.schema).rows;
          expect(c.compare(idsOf(s, byFirst)), c.name).toMatchObject({ ok: false, message: expect.stringMatching(/wrong order/) });
        }
        for (const c of count) {
          // The count dropped: every row the filters keep, sorted.
          const uncut = applyView(check.rows, { ...c.state, limit: undefined }, s.schema).rows;
          expect(c.compare(idsOf(s, uncut)).ok, c.name).toBe(false);
        }
      }
    }
  });

  it("a right Data Query still passes every case, however it breaks ties and sorts empty cells", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      for (const ties of TIES) {
        for (const empties of ["lowest", "highest", "first", "last"] as const) {
          const query = handQuery(check, s.schema, s.id, undefined, false, { ties, empties });
          const besides = check.cases.filter((c) =>
            [
              TIED_BESIDE_OR,
              NEXT_BESIDE_OR,
              SORT_BESIDE_HIDDEN,
              TWO_SORTS_BESIDE_HIDDEN,
              COUNT_BESIDE_HIDDEN,
              TIED_BESIDE_HIDDEN,
              NEXT_BESIDE_HIDDEN,
            ].some((rule) => rule.test(c.name)),
          );
          expect(besides.length, s.name).toBeGreaterThan(0);
          expect(
            besides.filter((c) => !c.compare(query(c.state)).ok).map((c) => c.name),
            `${s.name}, ${ties}, ${empties}`,
          ).toEqual([]);
        }
      }
    }
  });
});

// The third check of the Query Check found wrong translations that build the sorts or the count another way beside one
// kind of filter only: an "equals" or a "not equal" filter, which no case sorted or counted beside; a filter with the
// first sort going up; a filter with a yes/no column sorted first. The class is closed by one promise (more grids spec,
// 5.5, "Pairs, and no more"): each rule about sorting and counting sits beside each kind of filter the check makes, with
// the first sort each way. A Data Query that is wrong only under one such condition fails a case named for the rule it
// breaks. One that is wrong only where more of them meet is outside the promise.
describe("pairs, and no more: each sort and count rule beside each kind of filter, with the first sort each way", () => {
  /** Whether a View State filters a column it hides. */
  const hidesFilter = (state: ViewState) => predicatesOf(state.filters).some((p) => !state.visibleColumnIds.includes(p.columnId));
  /** The one filter of a View State whose filters are one filter, on a column that shows. */
  const oneFilter = (state: ViewState): FilterPredicate | undefined => {
    const [only, ...others] = state.filters?.children ?? [];
    return only?.type === "predicate" && others.length === 0 && !hidesFilter(state) ? only : undefined;
  };
  /** The shape of a View State's filters: one filter alone, filters joined with and, or one of the groups. */
  const shapeOf = (state: ViewState): string => {
    const root = state.filters;
    if (root === null) return "none";
    const inner = root.children.find((child): child is FilterGroup => child.type === "group");
    if (inner) return `${inner.combinator} inside ${root.combinator}`;
    if (root.combinator === "or") return root.children.length >= 3 ? "or of three" : "or";
    return root.children.length >= 2 ? "and" : "alone";
  };

  /** A kind of filter a Data Query may build another way: what a case's name calls it, and the View States it holds for. */
  interface Beside {
    name: string;
    phrase: string;
    holds: (state: ViewState) => boolean;
  }
  const LEADS: Array<[string, Array<ColumnDescriptor["kind"]>]> = [
    ["a number", ["number", "currency", "percent"]],
    ["a date", ["date", "datetime"]],
    ["a yes/no column", ["boolean"]],
  ];
  const OPERATORS = ["between", "contains", "eq", "gt", "gte", "in", "isEmpty", "isNotEmpty", "lt", "lte", "neq", "startsWith"];
  const besidesOf = (s: Subject, check: QueryCheck): Beside[] => {
    const kindOf = (columnId: string | undefined) => s.schema.columns.find((c) => c.id === columnId)?.kind;
    // Each operator the check filters by on its own, with no sort.
    const operators = [
      ...new Set(check.cases.filter((c) => c.state.sorts.length === 0).flatMap((c) => oneFilter(c.state)?.operator ?? [])),
    ];
    expect(operators.sort(), s.name).toEqual(OPERATORS);
    const leads = LEADS.filter(([, kinds]) => s.schema.columns.some((c) => kinds.includes(c.kind) && c.id !== s.id));
    return [
      ...operators.map((operator) => ({
        name: `one filter, ${operator}`,
        phrase: "beside a filter",
        holds: (state: ViewState) => oneFilter(state)?.operator === operator,
      })),
      ...leads.map(([name, kinds]) => ({
        name: `one filter, the first sort ${name}`,
        phrase: "beside a filter",
        holds: (state: ViewState) => oneFilter(state) !== undefined && kinds.some((kind) => kind === kindOf(state.sorts[0]?.columnId)),
      })),
      // One filter on the column the view sorts by first: a Data Query may read the two from one place.
      {
        name: "one filter, on the first sorted column",
        phrase: "beside a filter on the first sorted column",
        holds: (state: ViewState) => oneFilter(state) !== undefined && oneFilter(state)?.columnId === state.sorts[0]?.columnId,
      },
      {
        name: "two filters joined with and",
        phrase: "beside two filters joined with and",
        holds: (state: ViewState) => !hidesFilter(state) && shapeOf(state) === "and",
      },
      ...["or", "or of three", "or inside and"].map((shape) => ({
        name: `an or group (${shape})`,
        phrase: "beside an or group",
        holds: (state: ViewState) => !hidesFilter(state) && shapeOf(state) === shape,
      })),
      ...["alone", "or", "or inside and", "and inside or"].map((shape) => ({
        name: `a filter on a hidden column (${shape})`,
        phrase: "beside a filter on a hidden column",
        holds: (state: ViewState) => hidesFilter(state) && shapeOf(state) === shape,
      })),
    ];
  };

  /** A rule about sorting or counting: what a case's name calls it beside a kind of filter, and how many sorts it takes. */
  interface Rule {
    name: string;
    counted: boolean;
    sorts: 1 | 2;
    title: (phrase: string) => RegExp;
  }
  const RULES: Rule[] = [
    { name: "one sort", counted: false, sorts: 1, title: (p) => new RegExp(`^a sort ${p} still orders the rows \\(`) },
    { name: "two sorts", counted: false, sorts: 2, title: (p) => new RegExp(`^two sorts ${p} order the rows by each in turn \\(`) },
    {
      name: "the first rows of a count",
      counted: true,
      sorts: 1,
      title: (p) => new RegExp(`^a count ${p} still keeps only its first rows \\(`),
    },
    {
      name: "a count that cuts inside tied rows",
      counted: true,
      sorts: 1,
      title: (p) => new RegExp(`^a count that cuts inside tied rows ${p} keeps its number of rows \\(`),
    },
    {
      name: "a two-sort count cut inside rows that tie on the first",
      counted: true,
      sorts: 2,
      title: (p) =>
        new RegExp(
          `^a count that cuts inside rows that tie on the first sorted column ${p} keeps the ones the next sorted column puts first \\(`,
        ),
    },
    {
      name: "a count never keeps a row with no first value",
      counted: true,
      sorts: 1,
      title: (p) => new RegExp(`^a count ${p} never keeps a row with no value in the first sorted column \\(`),
    },
  ];
  const ruleNamed = (name: string) => RULES.find((rule) => rule.name === name) as Rule;
  /** Each way a rule's sorts go: the one sort, or the first and the second. */
  const WAYS = { 1: ["asc", "desc"], 2: ["asc asc", "asc desc", "desc asc", "desc desc"] };
  const wayOf = (c: QueryCheckCase) => c.state.sorts.map((sort) => sort.direction).join(" ");

  it("each rule sits beside each kind of filter, the first sort each way, and the count rules only with limit.set", () => {
    for (const s of SUBJECTS) {
      for (const check of [full(queryCheck(s.schema, { id: s.id })), checkOf(s)]) {
        const counted = check.cases.some((c) => c.state.limit !== undefined);
        for (const beside of besidesOf(s, check)) {
          for (const rule of RULES) {
            const cases = check.cases.filter((c) => rule.title(beside.phrase).test(c.name) && beside.holds(c.state));
            expect([...new Set(cases.map(wayOf))].sort(), `${s.name}: ${rule.name}, beside ${beside.name}`).toEqual(
              rule.counted && !counted ? [] : WAYS[rule.sorts],
            );
            for (const c of cases) {
              expect(c.state.limit !== undefined, c.name).toBe(rule.counted);
              expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
            }
          }
        }
      }
    }
  });

  it("beside each kind of filter, a count of the first rows cuts between two values, and a count inside tied rows between two that tie", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      for (const beside of besidesOf(s, check)) {
        for (const [rule, tied] of [
          ["the first rows of a count", false],
          ["a count that cuts inside tied rows", true],
        ] as const) {
          const cases = check.cases.filter((c) => ruleNamed(rule).title(beside.phrase).test(c.name) && beside.holds(c.state));
          expect(cases.length, `${s.name}: ${rule}, beside ${beside.name}`).toBeGreaterThan(0);
          for (const c of cases) {
            const columnId = c.state.sorts[0]?.columnId as string;
            const n = c.state.limit as number;
            const all = applyView(check.rows, { ...c.state, limit: check.rows.length }, s.schema).rows;
            expect(all.length, c.name).toBeGreaterThan(n);
            expect(all[n - 1]?.[columnId] === all[n]?.[columnId], c.name).toBe(tied);
          }
        }
      }
    }
  });

  /** A Data Query that makes `mistake` where `when` holds for the View State, and is right for every other. */
  const wrongWhen = (check: QueryCheck, s: Subject, mistake: Mistake, when: (state: ViewState) => boolean): DataQuery => {
    const [right, wrong] = [handQuery(check, s.schema, s.id), handQuery(check, s.schema, s.id, mistake)];
    return (state) => (when(state) ? wrong(state) : right(state));
  };
  const filtersBy = (state: ViewState, operator: FilterOperator) => predicatesOf(state.filters).some((p) => p.operator === operator);
  const firstGoesUp = (state: ViewState) => state.sorts[0]?.direction === "asc";
  const holdsOr = (g: FilterGroup | null): boolean =>
    g !== null && (g.combinator === "or" || g.children.some((child) => child.type === "group" && holdsOr(child)));

  // The wrong Data Queries the third check wrote, each written here afresh: a habit, made under one condition only.
  const FOUND: Array<{ mistake: Mistake; where: string; when: (state: ViewState, s: Subject) => boolean; rule: RegExp }> = [
    {
      mistake: "every sort goes the other way",
      where: "an equals filter is set",
      when: (state) => filtersBy(state, "eq"),
      rule: SORT_BESIDE_FILTER,
    },
    {
      mistake: "the sorts are dropped when a filter is set",
      where: "a not equal filter is set",
      when: (state) => filtersBy(state, "neq"),
      rule: SORT_BESIDE_FILTER,
    },
    {
      mistake: "a count keeps every row that ties with its last row",
      where: "an equals filter is set",
      when: (state) => filtersBy(state, "eq"),
      rule: TIED_BESIDE_FILTER,
    },
    {
      mistake: "a count keeps one row too many",
      where: "a list filter is set",
      when: (state) => filtersBy(state, "in"),
      rule: COUNT_BESIDE_FILTER,
    },
    {
      mistake: "a count leaves out the rows that tie at its cut",
      where: "a contains filter is set",
      when: (state) => filtersBy(state, "contains"),
      rule: TIED_BESIDE_FILTER,
    },
    {
      mistake: "only the first sort is used",
      where: "a filter is set and the first sort goes up",
      when: (state) => state.filters !== null && firstGoesUp(state),
      rule: TWO_SORTS_BESIDE_FILTER,
    },
    {
      mistake: "the count is cut by the first sort alone",
      where: "a filter is set and the first sort is a yes/no column",
      when: (state, s) => state.filters !== null && s.schema.columns.find((c) => c.id === state.sorts[0]?.columnId)?.kind === "boolean",
      rule: NEXT_BESIDE_FILTER,
    },
    {
      mistake: "a later sort goes the other way",
      where: "the filters hold an or group and the first sort goes up",
      when: (state) => holdsOr(state.filters) && firstGoesUp(state),
      rule: TWO_SORTS_BESIDE_OR,
    },
  ];
  for (const { mistake, where, when, rule } of FOUND) {
    for (const s of SUBJECTS) {
      it(`“${mistake}”, only where ${where}, fails on ${s.name}, and the message names the rule`, () => {
        const check = full(checkOf(s));
        const there = (state: ViewState) => when(state, s);
        const failed = check.cases.filter((c) => !c.compare(wrongWhen(check, s, mistake, there)(c.state)).ok);
        expect(failed.filter((c) => rule.test(c.name)).length, `${rule} among:\n${failed.map((c) => c.name).join("\n")}`).toBeGreaterThan(
          0,
        );
        // It is wrong nowhere else.
        expect(failed.filter((c) => !there(c.state))).toEqual([]);
      });
    }
  }

  // The class, not the list: each habit, made beside one kind of filter with the first sort one way, and nowhere else.
  // The Data Query is the right one for every other View State, and the right one passes every case (the self-check), so
  // only the cases that meet the condition are run.
  const HABITS: Array<{ mistake: Mistake; rule: string }> = [
    { mistake: "every sort goes the other way", rule: "one sort" },
    { mistake: "the sorts are dropped when a filter is set", rule: "one sort" },
    { mistake: "only the first sort is used", rule: "two sorts" },
    { mistake: "a later sort goes the other way", rule: "two sorts" },
    { mistake: "the sorts are used in reverse", rule: "two sorts" },
    { mistake: "a count keeps one row too many", rule: "the first rows of a count" },
    { mistake: "a count keeps one row too many", rule: "a count that cuts inside tied rows" },
    { mistake: "a count keeps every row that ties with its last row", rule: "a count that cuts inside tied rows" },
    { mistake: "a count leaves out the rows that tie at its cut", rule: "a count that cuts inside tied rows" },
    { mistake: "the count is cut by the first sort alone", rule: "a two-sort count cut inside rows that tie on the first" },
    // "LIMIT N" with no "WHERE x IS NOT NULL": only a count of every row reaches the rows with no value.
    { mistake: "the count keeps rows with no value", rule: "a count never keeps a row with no first value" },
  ];
  for (const s of SUBJECTS) {
    it(`${s.name}: each habit, made beside one kind of filter with the first sort one way, fails a case named for its rule`, () => {
      const check = full(checkOf(s));
      const missed: string[] = [];
      let pairs = 0;
      for (const beside of besidesOf(s, check)) {
        for (const way of ["asc", "desc"] as const) {
          const there = check.cases.filter((c) => beside.holds(c.state) && c.state.sorts[0]?.direction === way);
          for (const { mistake, rule } of HABITS) {
            const wrong = handQuery(check, s.schema, s.id, mistake);
            const title = ruleNamed(rule).title(beside.phrase);
            pairs += 1;
            if (!there.some((c) => title.test(c.name) && !c.compare(wrong(c.state)).ok)) {
              missed.push(`${mistake}, beside ${beside.name}, the first sort ${way}: no “${rule}” case fails`);
            }
          }
        }
      }
      expect(pairs).toBeGreaterThan(400);
      expect(missed).toEqual([]);
    }, 60_000);
  }
});

describe("numbers sort as numbers, and a paged read is the whole result cut in pieces", () => {
  for (const s of SUBJECTS) {
    it(`${s.name}: each number column sorted each way, and a number sorted as text fails`, () => {
      const check = full(checkOf(s));
      const cases = check.cases.filter((c) => /^numbers sort by their value, not as text \(/.test(c.name));
      const numeric = s.schema.columns.filter(
        (c) => NUMERIC_KINDS.has(c.kind) && c.id !== s.id && c.sensitivity !== "restricted" && c.capabilities.includes("sort"),
      );
      expect(cases.map((c) => `${c.state.sorts[0]?.columnId} ${c.state.sorts[0]?.direction}`).sort(), s.name).toEqual(
        numeric.flatMap((c) => [`${c.id} asc`, `${c.id} desc`]).sort(),
      );
      for (const c of cases) {
        expect(c.state.sorts, c.name).toHaveLength(1);
        expect(c.state.filters, c.name).toBeNull();
        expect(c.state.limit, c.name).toBeUndefined();
      }
    });

    it(`${s.name}: one sort with long runs of rows that tie, for a Host that reads each case in pages`, () => {
      const check = full(checkOf(s));
      const c = theCase(check, PAGED);
      expect(c.state.sorts, c.name).toHaveLength(1);
      expect(c.state.filters, c.name).toBeNull();
      expect(c.state.limit, c.name).toBeUndefined();
      // A run of tied rows longer than a page of 7, so a page that breaks ties its own way repeats or loses rows.
      const sortId = c.state.sorts[0]?.columnId as string;
      const cells = applyView(check.rows, c.state, s.schema).rows.map((row) => row[sortId]);
      const longest = cells.reduce<{ best: number; now: number }>(
        (acc, cell, i) => {
          const now = i > 0 && cells[i - 1] === cell ? acc.now + 1 : 1;
          return { best: Math.max(acc.best, now), now };
        },
        { best: 0, now: 0 },
      ).best;
      expect(longest, c.name).toBeGreaterThan(14);
      expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
    });
  }
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

  it("a text or enum column leads two or more sorts only where each column leads in turn, and a count sorted first by one keeps only values whose order is checked", () => {
    const ordered = ["number", "currency", "percent", "date", "datetime", "boolean"];
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      const kindOf = (columnId: string) => s.schema.columns.find((column) => column.id === columnId)?.kind;
      for (const c of check.cases.filter((c) =>
        /^(sorts by each column in turn|a count keeps the first rows|a count keeps a row with no value in a later|a sort with no count|a count that cuts inside tied rows|a row with no value in a later sorted column|a second sort on a hidden column|a count that cuts inside rows that tie on the first (sorted column keeps the ones the next|two)|numbers sort by their value|a paged read|two sorts beside an or group|a count beside an or group|a count still sorts by a hidden)/.test(
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
      // An enum column is sorted on its own too, by its values' IDs, each way. It is sorted alone in its own cases, with
      // its column hidden, beside filters, and in the counts sorted by it. Others sort it after a number, date or yes/no
      // column. It leads two or more sorts only in the cases that sort by each column in turn.
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
      const collated = (c: QueryCheckCase) =>
        c.state.sorts.some((sort) => kindOf(sort.columnId) === "enum" || kindOf(sort.columnId) === "string");
      for (const c of check.cases.filter(collated)) {
        if (c.state.sorts.length === 1) {
          expect(c.name).toMatch(
            /^(an enum sorts by its values' IDs, ignoring case|text sorts by its letters, ignoring case|a sort on a hidden column still orders the rows|a count never keeps a row with no value in the first sorted column|a sort beside an or group still orders the rows|a sort beside a filter still orders the rows|a sort on a hidden column beside a filter still orders the rows|a count sorted by text keeps its first rows by its letters, ignoring case|a count sorted by an enum keeps its first rows by its values' IDs|a count that cuts inside rows that tie on (text|an enum) keeps its number of rows) \(/,
          );
          // A count sorted by text or an enum keeps only rows whose cells have a checked place. It cuts between two
          // of their values, or, in the cases that say so, inside a run of rows that tie.
          if (COUNT_BY_COLLATED.test(c.name) || TIED_BY_COLLATED.test(c.name)) {
            const columnId = c.state.sorts[0]?.columnId as string;
            const all = applyView(check.rows, { ...c.state, limit: check.rows.length }, s.schema).rows.map((row) => row[columnId]);
            for (const cell of all) expect(String(cell), c.name).toMatch(/^[A-Za-z]+(?: [A-Za-z]+)*$/);
            const n = c.state.limit as number;
            expect(all[n - 1] === all[n], c.name).toBe(TIED_BY_COLLATED.test(c.name));
            expect(n, c.name).toBeLessThan(all.length);
          }
          continue;
        }
        // Text or an enum may lead two or more sorts in the cases that sort by each column in turn, with no count. A
        // count it leads, with a second sort, keeps only rows whose first sorted cell has a checked place. A count
        // that cuts inside rows that tie on every sort is led by a number, date or yes/no column.
        if ([TWO_SORTS_ANY_LEAD, THREE_SORTS, FOUR_SORTS].some((rule) => rule.test(c.name))) {
          expect(c.state.limit, c.name).toBeUndefined();
          expect(c.state.filters, c.name).toBeNull();
          continue;
        }
        if (NEXT_AFTER_COLLATED.test(c.name)) {
          const columnId = c.state.sorts[0]?.columnId as string;
          expect(c.state.sorts, c.name).toHaveLength(2);
          expect(ordered, c.name).toContain(kindOf(c.state.sorts[1]?.columnId as string));
          const all = applyView(check.rows, { ...c.state, limit: check.rows.length }, s.schema).rows.map((row) => row[columnId]);
          for (const cell of all) expect(String(cell), c.name).toMatch(/^[A-Za-z]+(?: [A-Za-z]+)*$/);
          continue;
        }
        // So is a count of every row with two sorts or more, which has no cut: text or an enum sorted later is safe.
        if (ALL_TIED.test(c.name) || /^a count never keeps a row with no value in the first sorted column \(/.test(c.name)) {
          expect(ordered, c.name).toContain(kindOf(c.state.sorts[0]?.columnId as string));
          continue;
        }
        expect(c.name).toMatch(
          /^(a second sort on an enum orders the rows that tie on the first, by its values' IDs|a second sort on text orders the rows that tie on the first, by its letters|a count keeps a row with an empty cell in a later sorted column|two sorts beside a filter order the rows by each in turn|a count that cuts inside rows that tie on the first sorted column keeps the ones (text|an enum) sorted next puts first|a count that cuts inside rows that tie on the first three sorted columns keeps the ones the fourth puts first) \(/,
        );
        expect(ordered, c.name).toContain(kindOf(c.state.sorts[0]?.columnId as string));
        if (!FOURTH_DECIDES.test(c.name)) expect(c.state.sorts, c.name).toHaveLength(2);
        // A count that sorts text or an enum second cuts between two values of the first column, or inside a run of
        // rows that tie on the columns before it (checked in their own tests).
        if (!EMPTY_LATER_IN_COUNT.test(c.name) && !COLLATED_NEXT_DECIDES.test(c.name) && !FOURTH_DECIDES.test(c.name)) {
          expect(c.state.limit, c.name).toBeUndefined();
        }
      }
    }
  });

  for (const s of SUBJECTS) {
    it(`${s.name}: a sort by two columns whose second is an enum, and one whose second is text, the second each way`, () => {
      const check = full(checkOf(s));
      const kindOf = (columnId: string) => s.schema.columns.find((column) => column.id === columnId)?.kind;
      const cellOf = (id: string | number, columnId: string) => check.rows.find((row) => String(row[s.id]) === String(id))?.[columnId];
      const pairs = [
        [/^a second sort on an enum orders the rows that tie on the first, by its values' IDs \(/, "enum"],
        [/^a second sort on text orders the rows that tie on the first, by its letters \(/, "string"],
      ] as const;
      for (const [rule, kind] of pairs) {
        const pair = check.cases.filter((c) => rule.test(c.name));
        expect(pair.map((c) => c.state.sorts[1]?.direction).sort(), String(rule)).toEqual(["asc", "desc"]);
        expect(
          new Set(pair.map((c) => `${c.state.sorts[0]?.columnId} ${c.state.sorts[0]?.direction} ${c.state.sorts[1]?.columnId}`)).size,
        ).toBe(1);
        // The second sort turned round fails one of the pair: the order of the rows that tie on the first.
        const turned = handQuery(
          check,
          s.schema,
          s.id,
          kind === "enum" ? "a second sort on an enum always goes up" : "a second sort on text always goes down",
        );
        expect(pair.filter((c) => !c.compare(turned(c.state)).ok).length, String(rule)).toBe(1);
      }
      for (const c of check.cases.filter((c) => pairs.some(([rule]) => rule.test(c.name)))) {
        const kind = pairs.find(([rule]) => rule.test(c.name))?.[1];
        const [lead, then] = c.state.sorts as [ViewState["sorts"][number], ViewState["sorts"][number]];
        expect(c.state.sorts, c.name).toHaveLength(2);
        expect(ORDERED_KINDS, c.name).toContain(kindOf(lead.columnId));
        expect(kindOf(then.columnId), c.name).toBe(kind);
        expect(c.state.filters, c.name).toBeNull();
        const ids = applyViewQuery(check, s.schema, s.id)(c.state);
        expect(c.compare(ids), c.name).toEqual({ ok: true });
        // Sorted by the first column alone, the rows that tie on it in the order they were loaded: the second sort lost.
        const { rows } = applyView(check.rows, { ...c.state, sorts: [lead] }, s.schema);
        const lost = c.compare(rows.map((row) => row[s.id] as string | number));
        expect(lost.ok === false && lost.message, c.name).toMatch(/: wrong order: id \S+ came where id \S+ belongs$/);
        // Text of other characters has no checked place in the second column either: among the rows that share a first
        // value, such rows may come in any order.
        const odd = (id: string | number) => !/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(String(cellOf(id, then.columnId) ?? ""));
        const sameLead = (a: string | number, b: string | number) => cellOf(a, lead.columnId) === cellOf(b, lead.columnId);
        const moved = [...ids];
        const at = moved.findIndex((id, i) => i > 0 && odd(id) && sameLead(id, moved[i - 1] as string | number));
        expect(at, c.name).toBeGreaterThan(0);
        [moved[at - 1], moved[at]] = [moved[at] as string | number, moved[at - 1] as string | number];
        expect(c.compare(moved), c.name).toEqual({ ok: true });
      }
    });

    it(`${s.name}: a second sort on a hidden column, and sorts beside a filter with no count`, () => {
      const kindOf = (columnId: string) => s.schema.columns.find((column) => column.id === columnId)?.kind;
      for (const check of [full(queryCheck(s.schema, { id: s.id })), checkOf(s)]) {
        const hidden = theCase(check, /^a second sort on a hidden column still orders the rows \(/);
        expect(hidden.state.sorts, hidden.name).toHaveLength(2);
        const [lead, then] = hidden.state.sorts.map((sort) => sort.columnId) as [string, string];
        expect(hidden.state.visibleColumnIds, hidden.name).toContain(lead);
        expect(hidden.state.visibleColumnIds, hidden.name).not.toContain(then);
        expect(hidden.state.limit, hidden.name).toBeUndefined();
        expect(hidden.name).toMatch(/, with .+ hidden\)$/);
        expect(hidden.compare(applyViewQuery(check, s.schema, s.id)(hidden.state)), hidden.name).toEqual({ ok: true });
        // The second sort lost: sorted by the first column alone.
        const byLead = applyView(check.rows, { ...hidden.state, sorts: hidden.state.sorts.slice(0, 1) }, s.schema).rows;
        const lost = hidden.compare(byLead.map((row) => row[s.id] as string | number));
        expect(lost.ok === false && lost.message, hidden.name).toMatch(/: wrong order: id \S+ came where id \S+ belongs$/);

        // A sort beside a filter: each column a case sorts by, each way, and once with the column hidden. The pairs
        // promise adds a sort each way beside a filter of each operator, on one column.
        const besides = check.cases.filter((c) => SORT_BESIDE_FILTER.test(c.name) || HIDDEN_SORT_BESIDE_FILTER.test(c.name));
        const sortedBy = [...new Set(check.cases.flatMap((c) => c.state.sorts.map((sort) => sort.columnId)))].sort();
        const sortOf = (c: QueryCheckCase) =>
          `${c.state.sorts[0]?.columnId} ${c.state.sorts[0]?.direction}${HIDDEN_SORT_BESIDE_FILTER.test(c.name) ? ", hidden" : ""}`;
        expect([...new Set(besides.map(sortOf))].sort(), s.name).toEqual(
          sortedBy.flatMap((columnId) => [`${columnId} asc`, `${columnId} desc`, `${columnId} desc, hidden`]).sort(),
        );
        expect(besides.filter((c) => HIDDEN_SORT_BESIDE_FILTER.test(c.name)).length, s.name).toBe(sortedBy.length);
        for (const beside of besides) {
          const hidden = HIDDEN_SORT_BESIDE_FILTER.test(beside.name);
          expect(beside.state.visibleColumnIds.includes(beside.state.sorts[0]?.columnId as string), beside.name).toBe(!hidden);
          expect(beside.state.filters?.combinator, beside.name).toBe("and");
          expect(predicatesOf(beside.state.filters), beside.name).toHaveLength(1);
          expect(beside.state.sorts, beside.name).toHaveLength(1);
          expect(beside.state.limit, beside.name).toBeUndefined();
          expect(beside.name).toMatch(/\(sorted by .+, (ascending|descending), where .+\)$/);
          expect(beside.compare(applyViewQuery(check, s.schema, s.id)(beside.state)), beside.name).toEqual({ ok: true });
          const filteredOnly = applyView(check.rows, { ...beside.state, sorts: [] }, s.schema).rows;
          expect(filteredOnly.length, beside.name).toBeGreaterThan(3);
          expect(filteredOnly.length, beside.name).toBeLessThan(check.rows.length);
          // The filter kept and the sort lost, or turned round: the right rows, in another order.
          const unsorted = beside.compare(filteredOnly.map((row) => row[s.id] as string | number));
          expect(unsorted.ok === false && unsorted.message, beside.name).toMatch(/: wrong order: id \S+ came where id \S+ belongs$/);
          const [sort] = beside.state.sorts as [ViewState["sorts"][number]];
          const turned = { ...sort, direction: sort.direction === "asc" ? ("desc" as const) : ("asc" as const) };
          const turnedRows = applyView(check.rows, { ...beside.state, sorts: [turned] }, s.schema).rows;
          expect(beside.compare(turnedRows.map((row) => row[s.id] as string | number)).ok, beside.name).toBe(false);
          // The sort kept and the filter lost fails too.
          const unfiltered = applyView(check.rows, { ...beside.state, filters: null }, s.schema).rows;
          expect(beside.compare(unfiltered.map((row) => row[s.id] as string | number)).ok, beside.name).toBe(false);
        }
        // Two sorts beside a filter: the second a number, date or yes/no column, an enum, and text, each way. An enum
        // and text come second once each way; the pairs promise adds more whose second is a number, date or yes/no column.
        const two = check.cases.filter((c) => TWO_SORTS_BESIDE_FILTER.test(c.name));
        const seconds = two.map(
          (c) =>
            `${kindOf(c.state.sorts[1]?.columnId as string) === "enum" ? "enum" : kindOf(c.state.sorts[1]?.columnId as string) === "string" ? "text" : "ordered"} ${c.state.sorts[1]?.direction}`,
        );
        expect(seconds.filter((second) => !second.startsWith("ordered")).sort(), s.name).toEqual([
          "enum asc",
          "enum desc",
          "text asc",
          "text desc",
        ]);
        expect([...new Set(seconds.filter((second) => second.startsWith("ordered")))].sort(), s.name).toEqual([
          "ordered asc",
          "ordered desc",
        ]);
        for (const c of two) {
          expect(c.state.filters?.combinator, c.name).toBe("and");
          expect(c.state.limit, c.name).toBeUndefined();
          expect(c.compare(applyViewQuery(check, s.schema, s.id)(c.state)), c.name).toEqual({ ok: true });
        }
        // The filters kept, and only the first sort: the rows that tie on it come in one order, so one of each pair
        // fails, however the rows that tie are ordered.
        // A pair shares its filter, its first sort and its second column, and sorts the second each way.
        const pairOf = (c: QueryCheckCase) =>
          `${JSON.stringify(c.state.filters)} ${JSON.stringify(c.state.sorts[0])} ${c.state.sorts[1]?.columnId}`;
        for (const key of new Set(two.map(pairOf))) {
          const pair = two.filter((c) => pairOf(c) === key);
          expect(pair.map((c) => c.state.sorts[1]?.direction).sort(), key).toEqual(["asc", "desc"]);
          for (const ties of ["reverse load order", "load order", "id ascending", "id descending"] as const) {
            const query = handQuery(check, s.schema, s.id, "only the first sort is used beside filters joined with and", false, { ties });
            const failed = pair.flatMap((c) => {
              const result = c.compare(query(c.state));
              return result.ok ? [] : [result.message];
            });
            expect(failed.length, `${key} ${ties}`).toBeGreaterThan(0);
            for (const message of failed) expect(message).toMatch(/: wrong order: id \S+ came (where|before) id \S+ /);
          }
        }
      }
    });
  }

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
    /** No value in the first sorted column: the row has no checked place at all. */
    const hasNoFirst = (c: QueryCheckCase, id: number) => isEmptyCell(cellsFor(c, id)[0]);

    it("the expected order is ok, and so is any place for the rows with no value in the first sorted column", () => {
      expect(sorted).toHaveLength(2);
      for (const c of sorted) {
        const ids = expected(c);
        expect(c.compare(ids), c.name).toEqual({ ok: true });
        const withFirst = ids.filter((id) => !hasNoFirst(c, id));
        const without = ids.filter((id) => hasNoFirst(c, id));
        expect(without.length, c.name).toBeGreaterThan(0);
        expect(c.compare([...without, ...withFirst]), c.name).toEqual({ ok: true });
        expect(c.compare([...withFirst, ...without.reverse()]), c.name).toEqual({ ok: true });
        const half = Math.floor(withFirst.length / 2);
        expect(c.compare([...withFirst.slice(0, half), ...without, ...withFirst.slice(half)]), c.name).toEqual({ ok: true });
      }
    });

    it("a row with a value in the first sorted column and none in the second is held to its place by the first", () => {
      for (const c of sorted) {
        const ids = expected(c);
        const later = ids.filter((id) => !hasNoFirst(c, id) && hasEmpty(c, id));
        expect(later.length, c.name).toBeGreaterThan(0);
        // All such rows moved to the front, or to the end: past rows with another first value.
        for (const moved of [
          [...later, ...ids.filter((id) => !later.includes(id))],
          [...ids.filter((id) => !later.includes(id)), ...later],
        ]) {
          const result = c.compare(moved);
          expect(result.ok === false && result.message, c.name).toMatch(
            /: wrong order: id \d+ came before id \d+, which belongs ahead of it by Market value$/,
          );
        }
      }
    });

    it("rows that tie on every sorted column may come in either order", () => {
      for (const c of sorted) {
        const ids = expected(c);
        const at = ids.findIndex(
          (id, i) => i > 0 && !hasEmpty(c, id) && JSON.stringify(cellsFor(c, id)) === JSON.stringify(cellsFor(c, ids[i - 1] as number)),
        );
        expect(at, c.name).toBeGreaterThan(0);
        const swapped = [...ids];
        [swapped[at - 1], swapped[at]] = [swapped[at] as number, swapped[at - 1] as number];
        expect(c.compare(swapped), c.name).toEqual({ ok: true });
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
        // Ordered by character code, "cob" comes after "Elm Garth": that fails.
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
  | "a row with an empty sort cell goes last, then the count cuts"
  // The classes the second round of the Query Check closes, each written here afresh.
  // A count that cuts inside rows that tie (ruling R2).
  | "a count keeps every row that ties with its last row"
  | "a count leaves out the rows that tie at its cut"
  | "a count keeps one row for each value"
  | "a count skips its first row"
  // A row with no value in a later sorted column (ruling R3).
  | "a row with an empty sort cell goes first"
  | "a row with an empty sort cell goes last, after the count cuts"
  | "a row with an empty sort cell goes last on each page"
  // Sorts beside other things.
  | "a second sort on a hidden column is dropped"
  | "a second sort on an enum is dropped"
  | "a second sort on text is dropped"
  | "the sorts are dropped when a filter is set"
  // Accents.
  | "accents are ignored, but for å, ä and ö"
  // The classes the second held-out check of the Query Check found, each written here afresh.
  // A count with two sorts that cuts inside rows that tie on the first.
  | "the count is cut by the first sort alone"
  // A count's guard on a later sorted column.
  | "the count leaves out a row with no value in a later sorted text or enum column"
  | "the count leaves out a row with empty text in a later sorted column"
  // Sorts and hidden columns beside an or group.
  | "the sorts are dropped beside an or group"
  | "a filter on a hidden column is dropped in an or group"
  // Accents, one operator at a time.
  | "not equal reads é as e"
  | "in a list reads é as e"
  | "starts with reads é as e"
  | "not equal ignores accents"
  | "in a list ignores accents"
  | "contains ignores accents"
  | "starts with ignores accents"
  // Numbers, and pages.
  | "numbers sort as text"
  | "each page breaks ties its own way"
  // The classes the third held-out check of the Query Check found, each written here afresh.
  | "the count is cut by its first two sorts alone"
  | "only the first sort is used beside an or group"
  | "the count is dropped beside an or group"
  | "a filter on a hidden column is dropped in an or group inside an and"
  | "the count drops a sort on a hidden column"
  | "text sorts by its length first"
  // The classes the review of the Query Check's second round found, each written here afresh.
  // Sorts beside a filter joined with "and".
  | "the first sort goes down when a filter is set"
  | "a sort on an enum is dropped when a filter is set"
  | "a sort on text is dropped when a filter is set"
  | "a sort on a hidden column is dropped when a filter is set"
  | "only the first sort is used beside filters joined with and"
  // A second sort's direction.
  | "a second sort on an enum always goes up"
  | "a second sort on text always goes down"
  // Sorts beside an or group.
  | "a later sort goes up beside an or group inside an and"
  | "only the last sort is used beside an or group of three or more"
  | "a filter on a hidden column is dropped in an and group inside an or"
  // A count's cut.
  | "the count is cut by the first sort alone when text or an enum is sorted next"
  | "a count sorted by text or an enum first takes its rows from the end"
  | "a count cuts text by character code"
  | "a count beside a filter keeps every row that ties with its last row"
  | "the count is cut by its first three sorts alone"
  | "the count drops a hidden last sort of three"
  // The classes the re-check of the Query Check's second round found, each written here afresh: the count or the sorts
  // built another way beside an or group, or where a column is hidden.
  | "a count beside an or group keeps every row that ties with its last row"
  | "a count with a filter and a hidden sorted column keeps every row that ties with its last row"
  | "the count is cut by the first sort alone beside an or group"
  | "only the first sort is used beside a filter on a hidden column"
  | "a count beside a filter on a hidden column keeps one row too many"
  | "the sorts are used in reverse beside a filter on a hidden column"
  // The habits the third check of the Query Check found beside one kind of filter only, each written here afresh. A
  // test makes each of them, and the ones above, only where a View State meets one condition (`wrongWhen`).
  | "every sort goes the other way"
  | "a later sort goes the other way"
  | "a count keeps one row too many"
  // The habits the check of the Query Check's third round found, each written here afresh. A test makes each, and the
  // ones above, only where a View State meets one condition: a column that leads, a number of sorts, a filter on the
  // first sorted column.
  | "a count cuts text by its length first"
  | "the count is cut by its last sort alone";

/** The mistakes that fold accents in one operator only: the operator, and whether å, ä and ö are kept apart. */
const ACCENTS_IN_ONE: Partial<Record<Mistake, readonly [FilterOperator, "nordic" | "all"]>> = {
  "not equal reads é as e": ["neq", "nordic"],
  "in a list reads é as e": ["in", "nordic"],
  "starts with reads é as e": ["startsWith", "nordic"],
  "not equal ignores accents": ["neq", "all"],
  "in a list ignores accents": ["in", "all"],
  "contains ignores accents": ["contains", "all"],
  "starts with ignores accents": ["startsWith", "all"],
};

const NUMERIC_KINDS = new Set(["number", "currency", "percent"]);
const textOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * What a right Data Query may choose for itself (spec 5.5, `compare`): how rows that tie on every sort column are
 * ordered, and where an empty cell sorts.
 */
interface Choices {
  /** Rows that tie: in the reverse of the order they were loaded in, in that order, or by their ids, either way. */
  ties?: "reverse load order" | "load order" | "id ascending" | "id descending";
  /**
   * An empty cell: the lowest value or the highest, so it moves with the direction, or always first or always last, as
   * NULLS FIRST and NULLS LAST put it.
   */
  empties?: "lowest" | "highest" | "first" | "last";
  /** Rows that tie: in a shuffle made from this seed, as `ORDER BY …, random()` gives them. */
  shuffle?: number;
  /**
   * Text: ordered with its spaces skipped, and by them only between texts of the same letters, as a collation that
   * ignores spaces at its first level does (spec 5.5, "Text order beyond the letters A to Z").
   */
  spaces?: "skipped";
}

/**
 * A Data Query written by hand from the table in 4.1, the way a Host translates a View State for a database, with one
 * mistake when asked. It shares no code with core. Where the table leaves a choice it takes the other one from
 * `applyView`: empty cells sort first, and rows that tie come in the reverse of the rows' own order. `choices` takes
 * another. With `byInstant` it orders a date-and-time column by the instant each cell names, as a database that stores
 * instants does, where `applyView` orders the cells as text.
 */
const handQuery = (
  check: QueryCheck,
  schema: ViewSchema,
  id: string,
  mistake?: Mistake,
  byInstant = false,
  choices: Choices = {},
): DataQuery => {
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
  /** Text without letter case, as the filter's operator compares it. */
  const lower = (v: unknown, operator: FilterOperator) => {
    if (mistake === "lower folds only A to Z") return String(v).replace(/[A-Z]+/g, (s) => s.toLowerCase());
    const [scope, accents] = (mistake && ACCENTS_IN_ONE[mistake]) ?? [];
    // A collation that keeps å, ä and ö as letters of their own and reads every other accented letter as its plain
    // one, as a Swedish or Finnish collation does: é is e, and å is not a.
    if (mistake === "accents are ignored, but for å, ä and ö" || (scope === operator && accents === "nordic")) {
      return [...String(v).toLowerCase()]
        .map((letter) => ("åäö".includes(letter) ? letter : letter.normalize("NFD").replace(/\p{M}/gu, "")))
        .join("");
    }
    // A collation that ignores accents, such as MySQL's default: Å is A.
    if (mistake === "text is compared ignoring accents" || (scope === operator && accents === "all")) {
      return String(v).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    }
    return String(v).toLowerCase();
  };
  const PLACEHOLDERS: unknown[] = ["N/A", "n/a", "NA", "-", "--", "none"];
  /** What the filter asks for, without letter case: "LOWER(column) = ?" forgets this side. */
  const asked = (v: unknown, operator: FilterOperator) =>
    mistake === "only the column's letter case is ignored" ? String(v) : lower(v, operator);
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
      return caseSensitive ? cell === target : lower(cell, p.operator) === asked(target, p.operator);
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
        return text && mistake !== "not equal is case-sensitive on text" ? lower(cell, "neq") !== asked(value, "neq") : cell !== value;
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
        const [hay, find] =
          mistake === "LIKE is case-sensitive" ? [String(cell), needle] : [lower(cell, p.operator), asked(needle, p.operator)];
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
  const where = (row: Row, group: FilterGroup, visible: readonly string[], nested = false): boolean => {
    if (mistake === "everything is joined with and") return predicatesOf(group).every((p) => keepsRow(row, p));
    // The same, only in an "or" group inside another group: a Data Query that builds its root group in one place and
    // the groups inside it in another.
    if (mistake === "a filter on a hidden column is dropped in an or group inside an and" && nested && group.combinator === "or") {
      group = {
        ...group,
        children: group.children.filter((child) => child.type === "group" || visible.includes(child.columnId)),
      };
    }
    // The same, in an "and" group inside an "or".
    if (mistake === "a filter on a hidden column is dropped in an and group inside an or" && nested && group.combinator === "and") {
      group = {
        ...group,
        children: group.children.filter((child) => child.type === "group" || visible.includes(child.columnId)),
      };
    }
    if (mistake === "a filter on a hidden column is dropped") {
      group = {
        ...group,
        children: group.children.filter((child) => child.type === "group" || visible.includes(child.columnId)),
      };
    }
    // The same, only where the filters are joined with "or".
    if (mistake === "a filter on a hidden column is dropped in an or group" && group.combinator === "or") {
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
          ? [where(row, child, visible, true)]
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
    const results = group.children.map((child) => (child.type === "group" ? where(row, child, visible, true) : keepsRow(row, child)));
    return group.combinator === "and" ? results.every(Boolean) : results.some(Boolean);
  };
  /** Whether a filter group holds an "or" group anywhere, itself included. */
  const holdsOr = (g: FilterGroup | null): boolean =>
    g !== null && (g.combinator === "or" || g.children.some((child) => child.type === "group" && holdsOr(child)));
  return (given) => {
    // The count left out where the filters hold an "or" group: built in one branch, and the "LIMIT" in another.
    const state = mistake === "the count is dropped beside an or group" && holdsOr(given.filters) ? { ...given, limit: undefined } : given;
    // "ORDER BY …, random()": each page is read on its own, so rows that tie come in another order on each.
    if (mistake === "each page breaks ties its own way") {
      const pages = Math.ceil(handQuery(check, schema, id, undefined, byInstant, choices)(state).length / 7);
      return Array.from({ length: pages }, (_, page) =>
        handQuery(check, schema, id, undefined, byInstant, { ...choices, shuffle: page + 1 })(state).slice(page * 7, page * 7 + 7),
      ).flat();
    }
    if (mistake === "no filters keep no rows" && state.filters === null) return [];
    const filtered = (rows: Row[]) => rows.filter((row) => (state.filters ? where(row, state.filters, state.visibleColumnIds) : true));
    const dropped = (sort: ViewState["sorts"][number], place: number): boolean => {
      const { kind } = columnOf(sort.columnId);
      const hidden = !state.visibleColumnIds.includes(sort.columnId);
      if (mistake === "a sort on a hidden column is dropped") return hidden;
      // The count's own query built from the columns that show.
      if (mistake === "the count drops a sort on a hidden column") return hidden && state.limit !== undefined;
      if (mistake === "a sort on an enum is dropped") return kind === "enum";
      // The first sort is kept and a later one lost: the table's own header shows one sorted column.
      if (mistake === "a second sort on a hidden column is dropped") return place > 0 && hidden;
      if (mistake === "a second sort on an enum is dropped") return place > 0 && kind === "enum";
      if (mistake === "a second sort on text is dropped") return place > 0 && kind === "string";
      if (mistake === "the sorts are dropped beside an or group") return holdsOr(state.filters);
      // The filtered branch builds its own "ORDER BY", and leaves some sorts out.
      if (state.filters !== null) {
        if (mistake === "a sort on an enum is dropped when a filter is set") return kind === "enum";
        if (mistake === "a sort on text is dropped when a filter is set") return kind === "string";
        if (mistake === "a sort on a hidden column is dropped when a filter is set") return hidden;
      }
      // "WHERE …" built in one branch and "ORDER BY …" in the other.
      return mistake === "the sorts are dropped when a filter is set" && state.filters !== null;
    };
    const shown = state.sorts.filter((sort, place) => !dropped(sort, place));
    /** Whether a filter is on a hidden column, and whether a sort is. */
    const hiddenFilter = predicatesOf(state.filters).some((p) => !state.visibleColumnIds.includes(p.columnId));
    const hiddenSort = state.sorts.some((sort) => !state.visibleColumnIds.includes(sort.columnId));
    /** Whether the root "and" holds an "or" group. */
    const orInAnd = state.filters?.combinator === "and" && state.filters.children.some((child) => child.type === "group" && holdsOr(child));
    /** Whether a group anywhere joins three or more filters with "or". */
    const wideOr = (g: FilterGroup | null): boolean =>
      g !== null &&
      ((g.combinator === "or" && g.children.length >= 3) || g.children.some((child) => child.type === "group" && wideOr(child)));
    const firstOnly =
      mistake === "only the first sort is used" ||
      (mistake === "only the first sort is used beside an or group" && holdsOr(state.filters)) ||
      (mistake === "only the first sort is used beside filters joined with and" && state.filters !== null && !holdsOr(state.filters)) ||
      (mistake === "only the first sort is used beside a filter on a hidden column" && hiddenFilter);
    const turned = (sort: ViewState["sorts"][number], place: number): ViewState["sorts"][number] => {
      const { kind } = columnOf(sort.columnId);
      if (mistake === "the first sort goes down when a filter is set" && place === 0 && state.filters !== null) {
        return { ...sort, direction: "desc" };
      }
      if (mistake === "a second sort on an enum always goes up" && place > 0 && kind === "enum") return { ...sort, direction: "asc" };
      if (mistake === "a second sort on text always goes down" && place > 0 && kind === "string") return { ...sort, direction: "desc" };
      if (mistake === "a later sort goes up beside an or group inside an and" && place > 0 && orInAnd) return { ...sort, direction: "asc" };
      // "ASC" and "DESC" the wrong way round: in every sort, or in each sort after the first.
      if (mistake === "every sort goes the other way" || (mistake === "a later sort goes the other way" && place > 0)) {
        return { ...sort, direction: sort.direction === "asc" ? "desc" : "asc" };
      }
      return sort;
    };
    /** While true, text sorts by character code: the count's own inner query, with a case-sensitive collation. */
    let byCode = false;
    /** While true, text sorts by its length first: the count's own inner query, with "ORDER BY length(x), x". */
    let byLength = false;
    const sorts = (
      firstOnly
        ? shown.slice(0, 1)
        : mistake === "the sorts are used in reverse" ||
            (mistake === "the sorts are used in reverse beside a filter on a hidden column" && hiddenFilter)
          ? [...shown].reverse()
          : mistake === "only the last sort is used beside an or group of three or more" && wideOr(state.filters)
            ? shown.slice(-1)
            : shown
    ).map(turned);
    const cells = (a: Scalar, b: Scalar, columnId: string): number => {
      if (a === b) return 0;
      // "ORDER BY CAST(x AS TEXT)": "10" before "9".
      if (typeof a === "number" && typeof b === "number" && mistake === "numbers sort as text") return textOrder(String(a), String(b));
      if (typeof a === "number" && typeof b === "number") return a - b;
      if (byInstant && columnOf(columnId).kind === "datetime") return instantOf(String(a)) - instantOf(String(b));
      if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
      if (mistake === "an enum sorts in the order its values are declared" && columnOf(columnId).kind === "enum") {
        const declared = (columnOf(columnId).enumValues ?? []).map((value) => value.id);
        return declared.indexOf(String(a)) - declared.indexOf(String(b));
      }
      // Text ignoring case, then by character code, as a database's case-blind collation does.
      if (mistake === "text sorts by character code" || byCode) return textOrder(String(a), String(b));
      // "ORDER BY length(x), x": shorter text first.
      const lengthFirst = mistake === "text sorts by its length first" || byLength;
      if (lengthFirst && columnOf(columnId).kind === "string" && String(a).length !== String(b).length) {
        return String(a).length - String(b).length;
      }
      if (choices.spaces === "skipped") {
        const letters = (v: Scalar) => String(v).toLowerCase().replace(/ /g, "");
        const byLetters = textOrder(letters(a), letters(b));
        if (byLetters !== 0) return byLetters;
      }
      return textOrder(String(a).toLowerCase(), String(b).toLowerCase()) || textOrder(String(a), String(b));
    };
    const idNumber = (row: Row) => Number(row[id]);
    /** The rows as the sort meets them: a stable sort keeps this order for rows that tie. */
    const beforeSort = (rows: Row[]): Row[] => {
      if (choices.shuffle !== undefined) {
        const random = seededRandom(choices.shuffle);
        return rows
          .map((row) => [random(), row] as const)
          .sort((a, b) => a[0] - b[0])
          .map(([, row]) => row);
      }
      if (choices.ties === "load order") return [...rows];
      if (choices.ties === "id ascending") return [...rows].sort((a, b) => idNumber(a) - idNumber(b));
      if (choices.ties === "id descending") return [...rows].sort((a, b) => idNumber(b) - idNumber(a));
      return [...rows].reverse();
    };
    const empties = choices.empties ?? "lowest";
    const holed = (row: Row) => sorts.some((sort) => isEmptyCell(row[sort.columnId]));
    /** "ORDER BY (a IS NULL OR b IS NULL)": every row with an empty cell in any sorted column after the rest, or before. */
    const holedLast = (rows: Row[]) => [...rows.filter((row) => !holed(row)), ...rows.filter(holed)];
    const holedFirst = (rows: Row[]) => [...rows.filter(holed), ...rows.filter((row) => !holed(row))];
    const ordered = (rows: Row[], by = sorts) => {
      const sorted = beforeSort(rows).sort((a, b) => {
        for (const sort of by) {
          const [x, y] = [a[sort.columnId] as Scalar, b[sort.columnId] as Scalar];
          const descending = sort.direction === "desc" && mistake !== "the sort ignores direction";
          if (x !== y && (x === null || y === null)) {
            const nullFirst = empties === "first" || (empties === "lowest" && !descending) || (empties === "highest" && descending);
            return (x === null) === nullFirst ? -1 : 1;
          }
          const d = cells(x, y, sort.columnId);
          if (d !== 0) return descending ? -d : d;
        }
        return 0;
      });
      if (mistake === "a row with an empty sort cell goes last, then the count cuts") return holedLast(sorted);
      if (mistake === "a row with an empty sort cell goes first") return holedFirst(sorted);
      return sorted;
    };
    const first = state.sorts[0]?.columnId;
    const collatedKind = (columnId: string) => ["string", "enum"].includes(columnOf(columnId).kind);
    const needed =
      mistake === "the count leaves out a row with no value in any sorted column"
        ? state.sorts.map((s) => s.columnId)
        : mistake === "the count leaves out a row with no value in a later sorted text or enum column"
          ? state.sorts.filter((s, i) => i === 0 || collatedKind(s.columnId)).map((s) => s.columnId)
          : [first];
    const hasValue = (cell: unknown) => (mistake === "the count keeps rows with empty text" ? cell !== null : !isEmptyCell(cell));
    // "AND b <> ''" for each later sorted column, written to keep out what reads as no value.
    const emptyTextLater = (row: Row) =>
      mistake === "the count leaves out a row with empty text in a later sorted column" &&
      state.sorts.slice(1).some((s) => row[s.columnId] === "");
    const withValue = (rows: Row[]) =>
      first === undefined
        ? rows
        : rows.filter((row) => needed.every((columnId) => hasValue(row[columnId as string])) && !emptyTextLater(row));
    const tie = (a: Row, b: Row) => state.sorts.every((sort) => a[sort.columnId] === b[sort.columnId]);
    /** The count's cut, on rows already filtered and sorted. */
    const cut = (inOrder: Row[], limit: number): Row[] => {
      const firstRows = inOrder.slice(0, limit);
      const [last, next] = [inOrder[limit - 1], inOrder[limit]];
      // "RANK() OVER (ORDER BY …) <= N", or "FETCH FIRST N ROWS WITH TIES": every row that ties with the Nth stays.
      if (mistake === "a count keeps every row that ties with its last row" && last) {
        return inOrder.filter((row, i) => i < limit || tie(row, last));
      }
      // "WHERE value > (the value of row N + 1)": the rows that tie with the first row left out go with it.
      if (mistake === "a count leaves out the rows that tie at its cut" && next) return firstRows.filter((row) => !tie(row, next));
      // The same, only where the filters are set: the filtered branch builds its count another way.
      if (mistake === "a count beside a filter keeps every row that ties with its last row" && last && state.filters !== null) {
        return inOrder.filter((row, i) => i < limit || tie(row, last));
      }
      // The same where the filters hold an "or" group, or where a filter is set and a sorted column is hidden.
      const ranked =
        (mistake === "a count beside an or group keeps every row that ties with its last row" && holdsOr(state.filters)) ||
        (mistake === "a count with a filter and a hidden sorted column keeps every row that ties with its last row" &&
          state.filters !== null &&
          hiddenSort);
      if (ranked && last) return inOrder.filter((row, i) => i < limit || tie(row, last));
      // "LIMIT N + 1", in the branch that builds a filter on a hidden column.
      if (mistake === "a count beside a filter on a hidden column keeps one row too many" && hiddenFilter) {
        return inOrder.slice(0, limit + 1);
      }
      if (mistake === "a count keeps one row too many") return inOrder.slice(0, limit + 1);
      // "SELECT DISTINCT ON (value)": the first row of each value, then the first N of those.
      if (mistake === "a count keeps one row for each value") {
        return inOrder.filter((row, i) => i === 0 || !tie(row, inOrder[i - 1] as Row)).slice(0, limit);
      }
      // "LIMIT N OFFSET 1", from a page counted from 1.
      if (mistake === "a count skips its first row") return inOrder.slice(1, limit + 1);
      return firstRows;
    };
    let rows: Row[];
    if (state.limit === undefined && mistake === "a sort with no count drops rows with no value")
      rows = ordered(withValue(filtered(check.rows)));
    else if (state.limit === undefined) rows = ordered(filtered(check.rows));
    else if (mistake === "the count is cut before the filter") rows = filtered(ordered(withValue(check.rows)).slice(0, state.limit));
    else if (mistake === "the count keeps rows with no value") rows = ordered(filtered(check.rows)).slice(0, state.limit);
    else if (mistake === "the count is cut before the sort") rows = ordered(withValue(filtered(check.rows)).slice(0, state.limit));
    // "ORDER BY a LIMIT N" in an inner query, and "ORDER BY a, b" outside it.
    else if (mistake === "the count is cut by the first sort alone")
      rows = ordered(ordered(withValue(filtered(check.rows)), sorts.slice(0, 1)).slice(0, state.limit));
    // The same, only where the filters hold an "or" group.
    else if (mistake === "the count is cut by the first sort alone beside an or group" && holdsOr(state.filters))
      rows = ordered(ordered(withValue(filtered(check.rows)), sorts.slice(0, 1)).slice(0, state.limit));
    // The same with the first two sorts in the inner query.
    else if (mistake === "the count is cut by its first two sorts alone")
      rows = ordered(ordered(withValue(filtered(check.rows)), sorts.slice(0, 2)).slice(0, state.limit));
    // The same with the first sort alone when text or an enum is sorted next, and with the first three of four.
    else if (
      mistake === "the count is cut by the first sort alone when text or an enum is sorted next" &&
      sorts[1] !== undefined &&
      collatedKind(sorts[1].columnId)
    )
      rows = ordered(ordered(withValue(filtered(check.rows)), sorts.slice(0, 1)).slice(0, state.limit));
    else if (mistake === "the count is cut by its first three sorts alone" && sorts.length >= 4)
      rows = ordered(ordered(withValue(filtered(check.rows)), sorts.slice(0, 3)).slice(0, state.limit));
    // The count's inner query sorts by the columns that show, when the last of three or more is hidden.
    else if (
      mistake === "the count drops a hidden last sort of three" &&
      sorts.length >= 3 &&
      !state.visibleColumnIds.includes((sorts.at(-1) as ViewState["sorts"][number]).columnId)
    )
      rows = ordered(ordered(withValue(filtered(check.rows)), sorts.slice(0, -1)).slice(0, state.limit));
    // A count sorted first by text or an enum, cut from the far end: the direction turned round for the cut.
    else if (mistake === "a count sorted by text or an enum first takes its rows from the end" && first && collatedKind(first)) {
      const inOrder = ordered(withValue(filtered(check.rows)));
      rows = inOrder.slice(Math.max(0, inOrder.length - state.limit));
    }
    // The count's inner query orders text by character code, and the page by the letters.
    else if (mistake === "a count cuts text by character code" && sorts.some((sort) => columnOf(sort.columnId).kind === "string")) {
      byCode = true;
      const inner = ordered(withValue(filtered(check.rows))).slice(0, state.limit);
      byCode = false;
      rows = ordered(inner);
    }
    // The count's inner query orders text by its length and then its letters, and the page by the letters.
    else if (mistake === "a count cuts text by its length first" && first && columnOf(first).kind === "string") {
      byLength = true;
      const inner = ordered(withValue(filtered(check.rows))).slice(0, state.limit);
      byLength = false;
      rows = ordered(inner);
    }
    // "ORDER BY b LIMIT N" in an inner query, where the view sorts by a and then b, and "ORDER BY a, b" outside it.
    else if (mistake === "the count is cut by its last sort alone" && sorts.length >= 2)
      rows = ordered(ordered(withValue(filtered(check.rows)), sorts.slice(-1)).slice(0, state.limit));
    else rows = cut(ordered(withValue(filtered(check.rows))), state.limit);
    // The right rows, cut in the right place, and then put in order again by an outer query or by the page.
    if (mistake === "a row with an empty sort cell goes last, after the count cuts") rows = holedLast(rows);
    if (mistake === "a row with an empty sort cell goes last on each page") {
      const pages = Array.from({ length: Math.ceil(rows.length / 7) }, (_, page) => rows.slice(page * 7, page * 7 + 7));
      rows = pages.flatMap(holedLast);
    }
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
  // The classes the second round of the Query Check closes.
  // A count that cuts inside rows that tie (ruling R2): more rows than asked for, fewer, a row from behind the tie, and
  // a row ahead of it left out.
  { mistake: "a count keeps every row that ties with its last row", row: "a count at ties", rules: [TIED] },
  { mistake: "a count leaves out the rows that tie at its cut", row: "a count at ties", rules: [TIED] },
  { mistake: "a count keeps one row for each value", row: "a count at ties", rules: [TIED] },
  { mistake: "a count skips its first row", row: "a count at ties", rules: [TIED] },
  // A row with no value in a later sorted column (ruling R3), with a count and without.
  { mistake: "a row with an empty sort cell goes last, then the count cuts", row: "an empty later sort cell", rules: [LATER_EMPTY] },
  { mistake: "a row with an empty sort cell goes first", row: "an empty later sort cell", rules: [LATER_EMPTY] },
  {
    mistake: "a row with an empty sort cell goes last, after the count cuts",
    row: "an empty later sort cell",
    rules: [LATER_EMPTY, /^a count keeps a row with no value in a later sorted column \(/],
  },
  { mistake: "a row with an empty sort cell goes last on each page", row: "an empty later sort cell", rules: [LATER_EMPTY] },
  // Sorts beside other things.
  {
    mistake: "a second sort on a hidden column is dropped",
    row: "hidden columns",
    rules: [/^a second sort on a hidden column still orders the rows \(/],
  },
  {
    mistake: "a second sort on an enum is dropped",
    row: "sorting",
    rules: [/^a second sort on an enum orders the rows that tie on the first, by its values' IDs \(/],
  },
  {
    mistake: "an enum sorts in the order its values are declared",
    row: "sorting",
    rules: [/^a second sort on an enum orders the rows that tie on the first, by its values' IDs \(/],
  },
  {
    mistake: "a second sort on text is dropped",
    row: "sorting",
    rules: [/^a second sort on text orders the rows that tie on the first, by its letters \(/],
  },
  { mistake: "the sorts are dropped when a filter is set", row: "sorting", rules: [/^a sort beside a filter still orders the rows \(/] },
  // Accents: é read as e, with å, ä and ö kept apart.
  {
    mistake: "accents are ignored, but for å, ä and ö",
    row: "eq, in on a text column",
    rules: [/^equal keeps é and e apart \(/],
  },
  { mistake: "accents are ignored, but for å, ä and ö", row: "contains, startsWith", rules: [/^contains keeps é and e apart \(/] },
  // The classes the second held-out check of the Query Check found.
  // Accents in every text operator, each named for accents: é and e, and Å and A.
  {
    mistake: "accents are ignored, but for å, ä and ö",
    row: "neq",
    rules: [/^not equal keeps é and e apart \(/, /^in a list keeps é and e apart \(/, /^starts with keeps é and e apart \(/],
  },
  {
    mistake: "text is compared ignoring accents",
    row: "neq",
    rules: [
      /^not equal ignores case but not accents \(/,
      /^in a list ignores case but not accents \(/,
      /^contains ignores case but not accents \(/,
      /^starts with ignores case but not accents \(/,
    ],
  },
  { mistake: "not equal reads é as e", row: "neq", rules: [/^not equal keeps é and e apart \(/] },
  { mistake: "in a list reads é as e", row: "eq, in on a text column", rules: [/^in a list keeps é and e apart \(/] },
  { mistake: "starts with reads é as e", row: "contains, startsWith", rules: [/^starts with keeps é and e apart \(/] },
  { mistake: "not equal ignores accents", row: "neq", rules: [/^not equal ignores case but not accents \(/] },
  { mistake: "in a list ignores accents", row: "eq, in on a text column", rules: [/^in a list ignores case but not accents \(/] },
  { mistake: "contains ignores accents", row: "contains, startsWith", rules: [/^contains ignores case but not accents \(/] },
  { mistake: "starts with ignores accents", row: "contains, startsWith", rules: [/^starts with ignores case but not accents \(/] },
  // A count with two sorts, cut inside rows that tie on the first.
  { mistake: "the count is cut by the first sort alone", row: "a count at ties", rules: [NEXT_DECIDES] },
  // A count with an empty cell in a later sorted column of each kind.
  {
    mistake: "the count leaves out a row with no value in a later sorted text or enum column",
    row: "an empty later sort cell",
    rules: [/^a count keeps a row with an empty cell in a later sorted column \(.*, then (Household|Advisor|Owner|Counterparty), /],
  },
  {
    mistake: "the count leaves out a row with no value in a later sorted text or enum column",
    row: "an empty later sort cell",
    rules: [/^a count keeps a row with an empty cell in a later sorted column \(.*, then (Registration type|Custodian|Category), /],
  },
  {
    mistake: "the count leaves out a row with empty text in a later sorted column",
    row: "an empty later sort cell",
    rules: [EMPTY_LATER_IN_COUNT],
  },
  // Beside an or group.
  { mistake: "the sorts are dropped beside an or group", row: "sorting", rules: [/^a sort beside an or group still orders the rows \(/] },
  {
    mistake: "a filter on a hidden column is dropped in an or group",
    row: "hidden columns",
    rules: [/^a filter on a hidden column still holds in an or group \(/],
  },
  // Numbers sorted as numbers, and a read in pages.
  { mistake: "numbers sort as text", row: "sorting", rules: [/^numbers sort by their value, not as text \(/] },
  { mistake: "each page breaks ties its own way", row: "sorting", rules: [PAGED] },
  // The classes the third held-out check of the Query Check found.
  { mistake: "the count is cut by its first two sorts alone", row: "a count at ties", rules: [THIRD_DECIDES] },
  { mistake: "only the first sort is used beside an or group", row: "sorting", rules: [TWO_SORTS_BESIDE_OR] },
  { mistake: "the count is dropped beside an or group", row: "a count", rules: [COUNT_BESIDE_OR] },
  {
    mistake: "a filter on a hidden column is dropped in an or group inside an and",
    row: "hidden columns",
    rules: [HIDDEN_IN_NESTED_OR],
  },
  {
    mistake: "the count drops a sort on a hidden column",
    row: "hidden columns",
    rules: [COUNT_HIDDEN_SORT, COUNT_HIDDEN_SECOND],
  },
  { mistake: "text sorts by its length first", row: "sorting", rules: [/^text sorts by its letters, ignoring case \(/] },
  // The classes the review of the Query Check's second round found.
  { mistake: "the first sort goes down when a filter is set", row: "sorting", rules: [SORT_BESIDE_FILTER] },
  { mistake: "a sort on an enum is dropped when a filter is set", row: "sorting", rules: [SORT_BESIDE_FILTER] },
  { mistake: "a sort on text is dropped when a filter is set", row: "sorting", rules: [SORT_BESIDE_FILTER] },
  { mistake: "a sort on a hidden column is dropped when a filter is set", row: "hidden columns", rules: [HIDDEN_SORT_BESIDE_FILTER] },
  { mistake: "only the first sort is used beside filters joined with and", row: "sorting", rules: [TWO_SORTS_BESIDE_FILTER] },
  {
    mistake: "a second sort on an enum always goes up",
    row: "sorting",
    rules: [/^a second sort on an enum orders the rows that tie on the first, by its values' IDs \(/],
  },
  {
    mistake: "a second sort on text always goes down",
    row: "sorting",
    rules: [/^a second sort on text orders the rows that tie on the first, by its letters \(/],
  },
  { mistake: "a later sort goes up beside an or group inside an and", row: "sorting", rules: [TWO_SORTS_BESIDE_OR] },
  { mistake: "only the last sort is used beside an or group of three or more", row: "sorting", rules: [TWO_SORTS_BESIDE_OR] },
  {
    mistake: "a filter on a hidden column is dropped in an and group inside an or",
    row: "hidden columns",
    rules: [HIDDEN_IN_NESTED_AND],
  },
  {
    mistake: "the count is cut by the first sort alone when text or an enum is sorted next",
    row: "a count at ties",
    rules: [COLLATED_NEXT_DECIDES],
  },
  { mistake: "a count sorted by text or an enum first takes its rows from the end", row: "a count", rules: [COUNT_BY_COLLATED] },
  { mistake: "a count cuts text by character code", row: "a count", rules: [COUNT_BY_COLLATED] },
  { mistake: "a count beside a filter keeps every row that ties with its last row", row: "a count at ties", rules: [TIED_BESIDE_FILTER] },
  { mistake: "the count is cut by its first three sorts alone", row: "a count at ties", rules: [FOURTH_DECIDES] },
  { mistake: "the count drops a hidden last sort of three", row: "hidden columns", rules: [COUNT_HIDDEN_THIRD] },
  // The classes the re-check of the Query Check's second round found.
  { mistake: "a count beside an or group keeps every row that ties with its last row", row: "a count at ties", rules: [TIED_BESIDE_OR] },
  {
    mistake: "a count with a filter and a hidden sorted column keeps every row that ties with its last row",
    row: "a count at ties",
    rules: [TIED_BESIDE_HIDDEN],
  },
  { mistake: "the count is cut by the first sort alone beside an or group", row: "a count at ties", rules: [NEXT_BESIDE_OR] },
  { mistake: "only the first sort is used beside a filter on a hidden column", row: "hidden columns", rules: [TWO_SORTS_BESIDE_HIDDEN] },
  {
    mistake: "a count beside a filter on a hidden column keeps one row too many",
    row: "hidden columns",
    rules: [COUNT_BESIDE_HIDDEN, TIED_BESIDE_HIDDEN],
  },
  {
    mistake: "the sorts are used in reverse beside a filter on a hidden column",
    row: "hidden columns",
    rules: [TWO_SORTS_BESIDE_HIDDEN],
  },
  // The habits the third check of the Query Check found, here in every view. The pairs tests make each beside one kind
  // of filter only.
  { mistake: "every sort goes the other way", row: "sorting", rules: [/^sorts by each column in turn, in its direction \(/] },
  { mistake: "a later sort goes the other way", row: "sorting", rules: [/^sorts by each column in turn, in its direction \(/] },
  {
    mistake: "a count keeps one row too many",
    row: "a count",
    rules: [/^a count keeps the first rows of the sorted, filtered rows \(/, TIED],
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
          for (const message of named) {
            expect(message).toMatch(
              /: (\d+ rows? (missing|extra), ids? |wrong order: id |\d+ rows? came back, and the count asks for \d+)/,
            );
          }
        }
      });
    }
  }

  // What a right Data Query may choose for itself (spec 5.5, `compare`; rulings R1 to R3). Each of these is a right
  // Data Query, so each passes every case: the ones that cut inside tied rows and the ones that sort by two columns too.
  const TIES = ["reverse load order", "load order", "id ascending", "id descending"] as const;
  const EMPTIES = ["lowest", "highest", "first", "last"] as const;
  for (const s of SUBJECTS) {
    for (const ties of TIES) {
      it(`${s.name}: a right Data Query that breaks ties by ${ties} passes every case`, () => {
        const check = full(checkOf(s));
        expect(check.cases.filter((c) => TIED.test(c.name)).length).toBeGreaterThan(0);
        for (const empties of EMPTIES) {
          expect(failuresOf(check, handQuery(check, s.schema, s.id, undefined, false, { ties, empties })), empties).toEqual([]);
        }
      });
    }
    for (const empties of EMPTIES) {
      it(`${s.name}: a right Data Query that sorts an empty cell ${empties} passes every case, with instants in order too`, () => {
        const check = full(checkOf(s));
        expect(check.cases.filter((c) => LATER_EMPTY.test(c.name)).length).toBeGreaterThan(0);
        expect(failuresOf(check, handQuery(check, s.schema, s.id, undefined, true, { empties }))).toEqual([]);
        expect(failuresOf(check, handQuery(check, s.schema, s.id, undefined, true, { empties, ties: "load order" }))).toEqual([]);
      });
    }
  }

  // A Data Query that cuts before it filters may break ties its own way too. The case must catch it whichever of the
  // rows that tie at its cut it takes, not only when it takes the ones core would.
  it("a count cut before the filter fails whichever of the tied rows it takes", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      for (const ties of TIES) {
        for (const empties of EMPTIES) {
          const failed = failuresOf(
            check,
            handQuery(check, s.schema, s.id, "the count is cut before the filter", false, { ties, empties }),
          );
          expect(
            failed.filter((message) => /^a count keeps the first rows of the sorted, filtered rows \(/.test(message)).length,
            `${s.name}, ties by ${ties}, empty cells ${empties}`,
          ).toBeGreaterThan(0);
        }
      }
    }
    // Sixteen Data Queries on each of four schemas: seconds, and more when the whole suite runs at once.
  }, 60_000);

  it("the sorts dropped beside a filter fail with no count case at all", () => {
    for (const s of SUBJECTS) {
      const check = full(queryCheck(s.schema, { id: s.id }));
      expect(check.cases.filter((c) => c.state.limit !== undefined)).toEqual([]);
      const failed = failuresOf(check, handQuery(check, s.schema, s.id, "the sorts are dropped when a filter is set"));
      expect(failed.length, s.name).toBeGreaterThan(0);
      for (const message of failed) {
        expect(message, s.name).toMatch(
          /^(a sort (on a hidden column )?beside (a filter|a filter on the first sorted column|two filters joined with and|an or group|a filter on a hidden column) still orders the rows|two sorts beside (a filter|a filter on the first sorted column|two filters joined with and|an or group|a filter on a hidden column) order the rows by each in turn) \(.*\): wrong order: id \S+ came where id \S+ belongs$/,
        );
      }
    }
  });

  it("é read as e fails the cases about é, and none about å: a collation that keeps å, ä and ö apart is still caught", () => {
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      const failed = failuresOf(check, handQuery(check, s.schema, s.id, "accents are ignored, but for å, ä and ö"));
      expect(failed.length, s.name).toBeGreaterThan(0);
      for (const message of failed) expect(message, s.name).toMatch(/é/i);
      expect(
        failed.filter((message) => /^equal ignores case but not accents \(/.test(message)),
        s.name,
      ).toEqual([]);
    }
  });

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
  /**
   * Every reference passes every case: `applyView`, the hand query that orders ties and empty cells another way, and
   * hand queries that take each other choice a right Data Query may make (rulings R1 to R3).
   */
  const passes = (schema: ViewSchema, id: string, more: Partial<QueryCheckOptions> = {}): QueryCheck => {
    const check = queryCheck(schema, { id, operations: WITH_COUNT, ...more });
    expect(failuresOf(check, applyViewQuery(check, schema, id))).toEqual([]);
    expect(failuresOf(check, handQuery(check, schema, id))).toEqual([]);
    expect(failuresOf(check, handQuery(check, schema, id, undefined, true))).toEqual([]);
    expect(failuresOf(check, handQuery(check, schema, id, undefined, false, { ties: "id ascending", empties: "highest" }))).toEqual([]);
    expect(failuresOf(check, handQuery(check, schema, id, undefined, true, { ties: "id descending", empties: "first" }))).toEqual([]);
    expect(failuresOf(check, handQuery(check, schema, id, undefined, true, { ties: "load order", empties: "last" }))).toEqual([]);
    expect(failuresOf(check, handQuery(check, schema, id, undefined, false, { spaces: "skipped" }))).toEqual([]);
    return check;
  };

  // Where a space sorts against a letter is the Host's collation's own (spec 5.5, "Text order beyond the letters A to
  // Z"; ruling R4). A Data Query that sorts text with its spaces skipped is right, so no case may turn on it.
  it("text sorted with its spaces skipped passes every case, and no two texts with a checked place differ first at a space", () => {
    const letters = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
    for (const s of SUBJECTS) {
      const check = full(checkOf(s));
      for (const empties of ["lowest", "highest", "first", "last"] as const) {
        expect(failuresOf(check, handQuery(check, s.schema, s.id, undefined, false, { spaces: "skipped", empties })), s.name).toEqual([]);
      }
      for (const column of s.schema.columns.filter((c) => c.kind === "string" && c.id !== s.id && c.sensitivity !== "restricted")) {
        const texts = [...new Set(cellsOf(check, column.id))].filter(
          (cell): cell is string => typeof cell === "string" && letters.test(cell),
        );
        expect(texts.length, column.id).toBeGreaterThan(3);
        for (const a of texts) {
          for (const b of texts) {
            const [x, y] = [a.toLowerCase(), b.toLowerCase()];
            const at = [...x].findIndex((letter, i) => letter !== y[i]);
            if (at < 0 || at >= y.length) continue;
            expect(x[at] === " " || y[at] === " ", `${column.id}: “${a}” and “${b}”`).toBe(false);
          }
        }
      }
    }
  });

  it("an enum with two IDs that differ first at a space: those two have no checked place, and the others still do", () => {
    const schema = defineSchema([{ id: "key" }, { id: "tier", kind: "enum" }, { id: "score", kind: "number" }], {
      columns: {
        tier: {
          enumValues: [
            { id: "zinc", label: "Zinc" },
            { id: "gold plus", label: "Gold plus" },
            { id: "golda", label: "Golda" },
            { id: "iron", label: "Iron" },
          ],
        },
      },
    });
    // With its spaces skipped "golda" comes before "gold plus"; with a space before every letter, after it. Both are right.
    const check = full(passes(schema, "key"));
    const sorted = check.cases.filter((c) => /^an enum sorts by its values' IDs, ignoring case \(/.test(c.name));
    expect(sorted.map((c) => c.state.sorts[0]?.direction).sort()).toEqual(["asc", "desc"]);
    // "iron" and "zinc" still have a place: declared the other way round, they fail in that order.
    const declared = handQuery(check, schema, "key", "an enum sorts in the order its values are declared");
    expect(sorted.filter((c) => !c.compare(declared(c.state)).ok).length).toBeGreaterThan(0);
  });

  it("text columns only: each is sorted on its own, beside a filter, each or group and each hidden shape, and counted by its letters and its empty text", () => {
    const check = full(passes(defineSchema([{ id: "key" }, { id: "name" }, { id: "note" }]), "key"));
    const sorted = check.cases.filter((c) => c.state.sorts.length > 0 || c.state.limit !== undefined);
    // Each column leads the other, with no count, and one count of every row sorts by both: the only cases that sort by
    // two columns.
    for (const c of sorted) {
      expect(c.state.sorts.length, c.name).toBeLessThanOrEqual(2);
      if (c.state.sorts.length === 2) {
        expect(c.name).toMatch(
          /^(two sorts order the rows by each in turn, whichever column is sorted first|a count never keeps a row with no value in the first sorted column) \(/,
        );
      }
    }
    expect(sorted.map((c) => c.name.replace(/ \(.*$/, "")).sort()).toEqual([
      // A count of every row beside a filter of each operator a text column allows, the sort each way, and beside a
      // filter on the first sorted column, each or group and each hidden shape.
      ...Array.from({ length: 14 }, () => "a count beside a filter never keeps a row with no value in the first sorted column"),
      ...Array.from(
        { length: 8 },
        () => "a count beside a filter on a hidden column never keeps a row with no value in the first sorted column",
      ),
      ...Array.from(
        { length: 2 },
        () => "a count beside a filter on the first sorted column never keeps a row with no value in the first sorted column",
      ),
      ...Array.from({ length: 4 }, () => "a count beside an or group never keeps a row with no value in the first sorted column"),
      // Each column, each way, one sorted by both, and two with a sorted column hidden.
      ...Array.from({ length: 7 }, () => "a count never keeps a row with no value in the first sorted column"),
      // Each column, each way, at two cuts: text ordered by its length first keeps the right rows at one of them.
      ...Array.from({ length: 8 }, () => "a count sorted by text keeps its first rows by its letters, ignoring case"),
      ...Array.from({ length: 4 }, () => "a count that cuts inside rows that tie on text keeps its number of rows"),
      ...Array.from({ length: 8 }, () => "a sort beside a filter on a hidden column still orders the rows"),
      "a sort beside a filter on the first sorted column still orders the rows",
      "a sort beside a filter on the first sorted column still orders the rows",
      // Each of the two columns, each way, beside a contains filter. Then one column, each way, beside a filter of each
      // other operator a text column allows: eq, neq, in, startsWith, isEmpty and isNotEmpty.
      ...Array.from({ length: 4 + 12 }, () => "a sort beside a filter still orders the rows"),
      "a sort beside an or group still orders the rows",
      "a sort beside an or group still orders the rows",
      "a sort beside an or group still orders the rows",
      "a sort beside an or group still orders the rows",
      "a sort beside two filters joined with and still orders the rows",
      "a sort beside two filters joined with and still orders the rows",
      "a sort on a hidden column beside a filter still orders the rows",
      "a sort on a hidden column beside a filter still orders the rows",
      "a sort on a hidden column still orders the rows",
      "a sort on a hidden column still orders the rows",
      "text sorts by its letters, ignoring case",
      "text sorts by its letters, ignoring case",
      "text sorts by its letters, ignoring case",
      "text sorts by its letters, ignoring case",
      // Each column first, each way, with the other second, each way.
      ...Array.from({ length: 8 }, () => "two sorts order the rows by each in turn, whichever column is sorted first"),
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
    // Six right Data Queries on each of sixty schemas: a few seconds alone, and more when the whole suite runs at once.
  }, 60_000);

  // Rulings R1 to R3 leave three things to the Host. Whatever a right Data Query chooses for each, on any schema, it
  // passes every case. The enums here declare IDs of letters, in both letter cases, so they are sorted second too.
  it("twelve more seeded schemas, under every choice a right Data Query may make for ties and empty cells", () => {
    const kinds: Array<ColumnDescriptor["kind"]> = ["string", "number", "currency", "percent", "date", "datetime", "boolean", "enum"];
    const zones = [undefined, "America/New_York", "Asia/Kolkata", "Pacific/Auckland", "UTC"];
    const words = ["alpha", "Bravo", "charlie", "delta", "Echo", "roth_ira"];
    let cases = 0;
    let tied = 0;
    let later = 0;
    for (let seed = 61; seed <= 72; seed++) {
      const random = seededRandom(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
      const columns = Array.from({ length: 1 + Math.floor(random() * 7) }, (_, i) => ({ id: `c${i}`, kind: pick(kinds) }));
      const overrides = Object.fromEntries(
        columns.map((column) => [
          column.id,
          {
            ...(column.kind === "enum" && random() < 0.8
              ? { enumValues: Array.from({ length: 1 + Math.floor(random() * 5) }, (_, n) => ({ id: words[n] as string, label: `E${n}` })) }
              : {}),
            ...(random() < 0.15 ? { capabilities: ["filter" as const, "show" as const] } : {}),
          },
        ]),
      );
      const timeZone = pick(zones);
      const schema = defineSchema([{ id: "key" }, ...columns], { columns: overrides, ...(timeZone ? { calendar: { timeZone } } : {}) });
      const notNull = columns.filter(() => random() < 0.25).map((column) => column.id);
      const id = random() < 0.5 ? "key" : "row_id";
      const check = queryCheck(schema, { id, operations: WITH_COUNT, notNull });
      cases += check.cases.length;
      tied += check.cases.filter((c) => TIED.test(c.name)).length;
      later += check.cases.filter((c) => LATER_EMPTY.test(c.name)).length;
      expect(failuresOf(check, applyViewQuery(check, schema, id)), `seed ${seed}`).toEqual([]);
      for (const ties of ["reverse load order", "load order", "id ascending", "id descending"] as const) {
        for (const empties of ["lowest", "highest", "first", "last"] as const) {
          for (const byInstant of [false, true]) {
            expect(
              failuresOf(check, handQuery(check, schema, id, undefined, byInstant, { ties, empties })),
              `seed ${seed} ${ties} ${empties} ${byInstant}`,
            ).toEqual([]);
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(1000);
    expect(tied).toBeGreaterThan(30);
    expect(later).toBeGreaterThan(8);
  }, 60_000);
});

// --- One condition, one failing case ---------------------------------------------------------------------------
// What the check of the Query Check's third round found. A Data Query that is right but for one habit, made under one
// condition only, passed every case: the condition was a number of sorts, a column or a kind of column sorted first, or
// a filter on the first sorted column. Each is made here afresh, on the fixture schemas and on a schema with two
// columns of each kind, where a rule always finds a filter on another column than the one it sorts by.

describe("a Data Query that is wrong under one condition alone fails a case named for the rule it breaks", () => {
  const wideColumns: ColumnInput[] = [
    { id: "ref", label: "Ref" },
    { id: "title", label: "Title" },
    { id: "memo", label: "Memo" },
    { id: "grade", label: "Grade" },
    { id: "stage", label: "Stage" },
    { id: "units", label: "Units" },
    { id: "cost", label: "Cost" },
    { id: "ratio", label: "Ratio" },
    { id: "active", label: "Active" },
    { id: "vip", label: "Vip" },
    { id: "due", label: "Due" },
    { id: "settled", label: "Settled" },
    { id: "logged_at", label: "Logged at" },
    { id: "seen_at", label: "Seen at" },
    { id: "hush", label: "Hush" },
  ];
  const wide = (calendar?: { timeZone: string }) =>
    defineSchema(wideColumns, {
      id: "two-of-each-kind",
      version: "1",
      restricted: ["hush"],
      ...(calendar ? { calendar } : {}),
      columns: {
        grade: {
          kind: "enum",
          enumValues: [
            { id: "amber", label: "Fourth" },
            { id: "Birch", label: "Third" },
            { id: "cedar wood", label: "Second" },
            { id: "dune", label: "First" },
            { id: "elm_2", label: "Fifth" },
          ],
        },
        stage: { kind: "enum" },
        units: { kind: "number" },
        cost: { kind: "currency" },
        ratio: { kind: "percent" },
        active: { kind: "boolean" },
        vip: { kind: "boolean" },
        due: { kind: "date" },
        settled: { kind: "date" },
        logged_at: { kind: "datetime" },
        seen_at: { kind: "datetime" },
      },
    });
  const WIDE: Subject[] = [
    { name: "two columns of each kind, Calendar in Asia/Kathmandu", schema: wide({ timeZone: "Asia/Kathmandu" }), id: "ref" },
    { name: "two columns of each kind, no Calendar", schema: wide(), id: "row_key" },
  ];
  const ALL: Subject[] = [...SUBJECTS.slice(0, 3), ...WIDE];

  const built = new Map<string, QueryCheck>();
  /** The check for a subject, with `limit.set` listed or with the operations a default Query Adapter lists. */
  const checkFor = (s: Subject, counted: boolean): QueryCheck => {
    const key = `${s.name} ${counted}`;
    if (!built.has(key)) built.set(key, full(queryCheck(s.schema, { id: s.id, operations: counted ? WITH_COUNT : MVP_OPERATIONS })));
    return built.get(key) as QueryCheck;
  };
  const kindIn = (s: Subject, columnId: string | undefined) => s.schema.columns.find((c) => c.id === columnId)?.kind;

  type When = (state: ViewState, s: Subject) => boolean;
  type Habit = (check: QueryCheck, s: Subject, when: When) => DataQuery;
  /** A right Data Query handed another View State where `when` holds: what a Data Query with that habit would run. */
  const reads =
    (change: (state: ViewState) => ViewState): Habit =>
    (check, s, when) => {
      const right = handQuery(check, s.schema, s.id);
      return (state) => right(when(state, s) ? change(state) : state);
    };
  /** A Data Query that makes `mistake` where `when` holds, and is right for every other View State. */
  const makes =
    (mistake: Mistake, choices: Choices = {}): Habit =>
    (check, s, when) => {
      const [right, wrong] = [
        handQuery(check, s.schema, s.id, undefined, false, choices),
        handQuery(check, s.schema, s.id, mistake, false, choices),
      ];
      return (state) => (when(state, s) ? wrong(state) : right(state));
    };
  const turned = (sort: ViewState["sorts"][number]): ViewState["sorts"][number] => ({
    ...sort,
    direction: sort.direction === "asc" ? "desc" : "asc",
  });
  const firstSorts = (n: number) => reads((state) => ({ ...state, sorts: state.sorts.slice(0, n) }));
  const noSorts = reads((state) => ({ ...state, sorts: [] }));
  const laterSortsTurned = reads((state) => ({ ...state, sorts: state.sorts.map((sort, i) => (i === 0 ? sort : turned(sort))) }));
  const ranked = makes("a count keeps every row that ties with its last row");
  const tiedRunDropped = makes("a count leaves out the rows that tie at its cut");
  const cutByFirstSort = makes("the count is cut by the first sort alone");
  const cutByLastSort = makes("the count is cut by its last sort alone");
  const cutByLength = makes("a count cuts text by its length first");
  const oneTooMany = makes("a count keeps one row too many");
  // "ORDER BY … NULLS LAST" with no "WHERE x IS NOT NULL": a count of a few rows never reaches the rows with no value.
  const noGuard = makes("the count keeps rows with no value", { empties: "last" });

  const always: When = () => true;
  const sortsAre =
    (n: number): When =>
    (state) =>
      state.sorts.length === n;
  const collatedLeads: When = (state, s) => ["string", "enum"].includes(kindIn(s, state.sorts[0]?.columnId) ?? "");
  const textLeads: When = (state, s) => kindIn(s, state.sorts[0]?.columnId) === "string";
  const stampLeads: When = (state, s) => kindIn(s, state.sorts[0]?.columnId) === "datetime";
  const filtersFirstSorted: When = (state) => predicatesOf(state.filters).some((p) => p.columnId === state.sorts[0]?.columnId);
  const hidesSortAlone: When = (state) =>
    state.filters === null && state.sorts.some((sort) => !state.visibleColumnIds.includes(sort.columnId));
  const hasStamps = (s: Subject) => s.schema.columns.some((c) => c.kind === "datetime");

  const ON_FIRST_SORTED = "beside a filter on the first sorted column";
  const allTied = (sorts: "two" | "three" | "four") =>
    new RegExp(
      `^a count that cuts inside rows that tie on ${{ two: "both", three: "all three", four: "all four" }[sorts]} sorted columns keeps its number of rows \\(`,
    );
  const NEVER_EMPTY_FIRST = /^a count never keeps a row with no value in the first sorted column \(/;
  const NEVER_EMPTY_FIRST_BESIDE = /^a count beside .+ never keeps a row with no value in the first sorted column \(/;

  interface Found {
    habit: string;
    where: string;
    query: Habit;
    when: When;
    rule: RegExp;
    /** With `limit.set` listed, without, or both. */
    counted: boolean[];
    on?: (s: Subject) => boolean;
  }
  const BOTH = [false, true];
  const FOUND: Found[] = [
    // Three sorts and four with no count: a default Query Adapter lists no `limit.set`.
    { habit: "only the first two sorts are used", where: "always", query: firstSorts(2), when: always, rule: THREE_SORTS, counted: BOTH },
    {
      habit: "every sort is dropped",
      where: "the view has three sorts",
      query: noSorts,
      when: sortsAre(3),
      rule: THREE_SORTS,
      counted: BOTH,
    },
    { habit: "only the first three sorts are used", where: "always", query: firstSorts(3), when: always, rule: FOUR_SORTS, counted: BOTH },
    {
      habit: "later sorts go the other way",
      where: "the view has four sorts",
      query: laterSortsTurned,
      when: sortsAre(4),
      rule: FOUR_SORTS,
      counted: BOTH,
    },
    // Text or an enum sorted first.
    {
      habit: "only the first sort is used",
      where: "text or an enum is sorted first",
      query: firstSorts(1),
      when: collatedLeads,
      rule: TWO_SORTS_ANY_LEAD,
      counted: BOTH,
    },
    {
      habit: "later sorts go the other way",
      where: "text or an enum is sorted first",
      query: laterSortsTurned,
      when: collatedLeads,
      rule: TWO_SORTS_ANY_LEAD,
      counted: BOTH,
    },
    {
      habit: "a count keeps every row that ties with its last row",
      where: "text or an enum is sorted first",
      query: ranked,
      when: collatedLeads,
      rule: TIED_BY_COLLATED,
      counted: [true],
    },
    {
      habit: "a count leaves out the rows that tie at its cut",
      where: "text or an enum is sorted first",
      query: tiedRunDropped,
      when: collatedLeads,
      rule: TIED_BY_COLLATED,
      counted: [true],
    },
    {
      habit: "the count is cut by the first sort alone",
      where: "text or an enum is sorted first",
      query: cutByFirstSort,
      when: collatedLeads,
      rule: NEXT_AFTER_COLLATED,
      counted: [true],
    },
    {
      habit: "the count is cut by its last sort alone",
      where: "text or an enum is sorted first",
      query: cutByLastSort,
      when: collatedLeads,
      rule: NEXT_AFTER_COLLATED,
      counted: [true],
    },
    {
      habit: "a count cuts text by its length first",
      where: "text is sorted first",
      query: cutByLength,
      when: textLeads,
      rule: COUNT_BY_COLLATED,
      counted: [true],
    },
    // A filter on the first sorted column.
    {
      habit: "every sort is dropped",
      where: "a filter is on the first sorted column",
      query: noSorts,
      when: filtersFirstSorted,
      rule: new RegExp(`^a sort ${ON_FIRST_SORTED} still orders the rows \\(`),
      counted: BOTH,
    },
    {
      habit: "only the first sort is used",
      where: "a filter is on the first sorted column",
      query: firstSorts(1),
      when: filtersFirstSorted,
      rule: new RegExp(`^two sorts ${ON_FIRST_SORTED} order the rows by each in turn \\(`),
      counted: BOTH,
    },
    {
      habit: "a count keeps every row that ties with its last row",
      where: "a filter is on the first sorted column",
      query: ranked,
      when: filtersFirstSorted,
      rule: new RegExp(`^a count that cuts inside tied rows ${ON_FIRST_SORTED} keeps its number of rows \\(`),
      counted: [true],
    },
    {
      habit: "the count is cut by the first sort alone",
      where: "a filter is on the first sorted column",
      query: cutByFirstSort,
      when: filtersFirstSorted,
      rule: new RegExp(
        `^a count that cuts inside rows that tie on the first sorted column ${ON_FIRST_SORTED} keeps the ones the next sorted column puts first \\(`,
      ),
      counted: [true],
    },
    {
      habit: "a count keeps one row too many",
      where: "a filter is on the first sorted column",
      query: oneTooMany,
      when: filtersFirstSorted,
      rule: new RegExp(`^a count ${ON_FIRST_SORTED} still keeps only its first rows \\(`),
      counted: [true],
    },
    // A count that cuts inside rows that tie on every sorted column, for each number of sorts.
    ...(["two", "three", "four"] as const).flatMap((word, i): Found[] => [
      {
        habit: "a count keeps every row that ties with its last row",
        where: `the view has ${word} sorts`,
        query: ranked,
        when: sortsAre(i + 2),
        rule: allTied(word),
        counted: [true],
      },
      {
        habit: "a count leaves out the rows that tie at its cut",
        where: `the view has ${word} sorts`,
        query: tiedRunDropped,
        when: sortsAre(i + 2),
        rule: allTied(word),
        counted: [true],
      },
    ]),
    // A count never keeps a row with no value in the first sorted column (ruling R3).
    {
      habit: "the count keeps rows with no value, sorted last",
      where: "the first sort goes down",
      query: noGuard,
      when: (state) => state.sorts[0]?.direction === "desc",
      rule: NEVER_EMPTY_FIRST,
      counted: [true],
    },
    {
      habit: "the count keeps rows with no value, sorted last",
      where: "a date-and-time column is sorted first",
      query: noGuard,
      when: stampLeads,
      rule: NEVER_EMPTY_FIRST,
      counted: [true],
      on: hasStamps,
    },
    {
      habit: "the count keeps rows with no value, sorted last",
      where: "a filter is set",
      query: noGuard,
      when: (state) => state.filters !== null,
      rule: NEVER_EMPTY_FIRST_BESIDE,
      counted: [true],
    },
    ...(["two", "three", "four"] as const).map(
      (word, i): Found => ({
        habit: "the count keeps rows with no value, sorted last",
        where: `the view has ${word} sorts`,
        query: noGuard,
        when: sortsAre(i + 2),
        rule: NEVER_EMPTY_FIRST,
        counted: [true],
      }),
    ),
    // A sorted column the view hides, with no filter.
    {
      habit: "a count keeps every row that ties with its last row",
      where: "a sorted column is hidden and no filter is set",
      query: ranked,
      when: hidesSortAlone,
      rule: TIED_HIDDEN,
      counted: [true],
    },
    {
      habit: "a count leaves out the rows that tie at its cut",
      where: "a sorted column is hidden and no filter is set",
      query: tiedRunDropped,
      when: hidesSortAlone,
      rule: TIED_HIDDEN,
      counted: [true],
    },
    {
      habit: "the count keeps rows with no value, sorted last",
      where: "a sorted column is hidden and no filter is set",
      query: noGuard,
      when: hidesSortAlone,
      rule: NEVER_EMPTY_FIRST,
      counted: [true],
    },
    {
      habit: "the count keeps rows with no value, sorted last",
      where: "a later sorted column is hidden",
      query: noGuard,
      when: (state) => state.sorts.slice(1).some((sort) => !state.visibleColumnIds.includes(sort.columnId)),
      rule: NEVER_EMPTY_FIRST,
      counted: [true],
    },
  ];
  for (const { habit, where, query, when, rule, counted, on } of FOUND) {
    for (const s of ALL.filter((subject) => on?.(subject) ?? true)) {
      for (const withCount of counted) {
        it(`“${habit}”, only where ${where}, fails on ${s.name}, ${withCount ? "with limit.set" : "without limit.set"}`, () => {
          const check = checkFor(s, withCount);
          const wrong = query(check, s, when);
          const failed = check.cases.filter((c) => !c.compare(wrong(c.state)).ok);
          expect(failed.filter((c) => rule.test(c.name)).length, `${rule} among:\n${failed.map((c) => c.name).join("\n")}`).toBeGreaterThan(
            0,
          );
          // It is wrong nowhere else.
          expect(failed.filter((c) => !when(c.state, s)).map((c) => c.name)).toEqual([]);
        });
      }
    }
  }

  /** Every column a case may sort by first: number, date and yes/no columns, and text and enum columns. */
  const leadersOf = (s: Subject) =>
    s.schema.columns.filter((c) => c.id !== s.id && c.sensitivity !== "restricted" && c.capabilities.includes("sort"));

  for (const s of ALL) {
    it(`${s.name}: later sorts lost or turned only when one column is sorted first fail, for each column, without limit.set`, () => {
      const check = checkFor(s, false);
      const leaders = leadersOf(s);
      expect(leaders.length).toBeGreaterThan(5);
      const missed: string[] = [];
      for (const column of leaders) {
        const when: When = (state) => state.sorts[0]?.columnId === column.id;
        const led = check.cases.filter((c) => TWO_SORTS_ANY_LEAD.test(c.name) && when(c.state, s));
        // The first sort each way, and the second each way.
        expect(led.map((c) => c.state.sorts.map((sort) => sort.direction).join(" ")).sort(), column.id).toEqual([
          "asc asc",
          "asc desc",
          "desc asc",
          "desc desc",
        ]);
        for (const [habit, query] of [
          ["only the first sort is used", firstSorts(1)],
          ["later sorts go the other way", laterSortsTurned],
        ] as const) {
          const wrong = query(check, s, when);
          if (!led.some((c) => !c.compare(wrong(c.state)).ok)) missed.push(`${habit}, only where ${column.label} is sorted first`);
        }
      }
      expect(missed).toEqual([]);
    });

    it(`${s.name}: a count never keeps a row with no value in the first sorted column, for each column that holds one, each way`, () => {
      const check = checkFor(s, true);
      const holed = leadersOf(s).filter((column) => cellsOf(check, column.id).some(isEmptyCell));
      expect(holed.length).toBeGreaterThan(5);
      const missed: string[] = [];
      for (const column of holed) {
        for (const way of ["asc", "desc"] as const) {
          const when: When = (state) => state.sorts[0]?.columnId === column.id && state.sorts[0]?.direction === way;
          const cases = check.cases.filter((c) => NEVER_EMPTY_FIRST.test(c.name) && when(c.state, s));
          expect(cases.length, `${column.id} ${way}`).toBeGreaterThan(0);
          for (const c of cases) expect(c.state.limit, c.name).toBe(check.rows.length);
          const wrong = noGuard(check, s, when);
          if (!cases.some((c) => !c.compare(wrong(c.state)).ok)) missed.push(`no guard only where ${column.label} is sorted first, ${way}`);
        }
      }
      expect(missed).toEqual([]);
    });
  }

  it("without limit.set, there are sorts by three columns and by four, the last each way, and no count", () => {
    for (const s of ALL) {
      const check = checkFor(s, false);
      expect(check.cases.filter((c) => c.state.limit !== undefined)).toEqual([]);
      for (const [rule, n] of [
        [THREE_SORTS, 3],
        [FOUR_SORTS, 4],
      ] as const) {
        const cases = check.cases.filter((c) => rule.test(c.name));
        expect(cases.length, `${s.name}: ${rule}`).toBeGreaterThan(0);
        expect(cases.length % 2, `${s.name}: ${rule}`).toBe(0);
        for (const c of cases) {
          expect(c.state.sorts, c.name).toHaveLength(n);
          expect(new Set(c.state.sorts.map((sort) => sort.columnId)).size, c.name).toBe(n);
          expect(c.state.filters, c.name).toBeNull();
          // Some rows tie on every column before the last and hold two values of the last, so the last decides.
          const before = c.state.sorts.slice(0, -1).map((sort) => sort.columnId);
          const last = c.state.sorts.at(-1)?.columnId as string;
          const runs = new Map<string, Set<Scalar>>();
          for (const row of check.rows) {
            if ([...before, last].some((columnId) => isEmptyCell(row[columnId]))) continue;
            const key = JSON.stringify(before.map((columnId) => row[columnId]));
            runs.set(key, (runs.get(key) ?? new Set()).add(row[last] as Scalar));
          }
          expect(
            [...runs.values()].some((values) => values.size >= 2),
            c.name,
          ).toBe(true);
        }
        // Each pair is one view, with the last sort each way.
        const ways = cases.map((c) => `${c.state.sorts.map((sort) => sort.columnId).join()} ${c.state.sorts.at(-1)?.direction}`);
        for (const c of cases) {
          const columns = c.state.sorts.map((sort) => sort.columnId).join();
          expect(ways, c.name).toContain(`${columns} asc`);
          expect(ways, c.name).toContain(`${columns} desc`);
        }
      }
    }
  });

  it("text and enum columns lead two sorts, and a count: a row whose first sorted cell has no checked place may sit anywhere", () => {
    for (const s of ALL) {
      const check = checkFor(s, true);
      const collated = leadersOf(s).filter((c) => c.kind === "string" || c.kind === "enum");
      expect(collated.length, s.name).toBeGreaterThan(2);
      for (const column of collated) {
        const leads = (c: QueryCheckCase) => c.state.sorts[0]?.columnId === column.id;
        expect(check.cases.filter((c) => TWO_SORTS_ANY_LEAD.test(c.name) && leads(c)).length, column.id).toBe(4);
        expect(check.cases.filter((c) => TIED_BY_COLLATED.test(c.name) && leads(c)).length, column.id).toBeGreaterThan(0);
        expect(check.cases.filter((c) => NEXT_AFTER_COLLATED.test(c.name) && leads(c)).length, column.id).toBe(2);
        // A count that text or an enum leads keeps only rows whose first sorted cell has a checked place.
        for (const c of check.cases.filter((x) => (TIED_BY_COLLATED.test(x.name) || NEXT_AFTER_COLLATED.test(x.name)) && leads(x))) {
          const all = applyView(check.rows, { ...c.state, limit: check.rows.length }, s.schema).rows;
          expect(all.length, c.name).toBeGreaterThan(c.state.limit as number);
          for (const row of all) expect(String(row[column.id]), c.name).toMatch(/^[A-Za-z]+(?: [A-Za-z]+)*$/);
        }
      }
      // With no count, the rows whose first sorted cell is text of other characters may be put anywhere: first, last,
      // or in the order they were loaded among the rest.
      const [two] = check.cases.filter((c) => TWO_SORTS_ANY_LEAD.test(c.name) && kindIn(s, c.state.sorts[0]?.columnId) === "string");
      expect(two, s.name).toBeDefined();
      const c = two as QueryCheckCase;
      const leadId = c.state.sorts[0]?.columnId as string;
      const right = applyViewQuery(check, s.schema, s.id)(c.state);
      const cellOf = (id: string | number) => check.rows.find((row) => String(row[s.id]) === String(id))?.[leadId];
      const placed = (id: string | number) => /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(String(cellOf(id) ?? ""));
      const [held, free] = [right.filter(placed), right.filter((id) => !placed(id))];
      expect(free.length, c.name).toBeGreaterThan(0);
      expect(c.compare([...free, ...held]), c.name).toEqual({ ok: true });
      expect(c.compare([...held, ...free]), c.name).toEqual({ ok: true });
      // The rows that are held are still held: turned round, they fail.
      expect(c.compare([...free, ...[...held].reverse()]).ok, c.name).toBe(false);
    }
  });

  it("a count that cuts inside rows that tie on every sorted column: two sorts and three on every schema, the first each way", () => {
    for (const s of ALL) {
      const check = checkFor(s, true);
      for (const [word, n] of [
        ["two", 2],
        ["three", 3],
        ["four", 4],
      ] as const) {
        const cases = check.cases.filter((c) => allTied(word).test(c.name));
        const ways = n < 4 ? ["asc", "desc"] : [...new Set(cases.map((c) => c.state.sorts[0]?.direction))];
        for (const way of ways) {
          // One cut, or two where rows with no value in a later sorted column share the run's leading values: one with
          // those rows put behind the run, and one with them put ahead of it (ruling R3).
          const cuts = cases.filter((c) => c.state.sorts[0]?.direction === way);
          expect([1, 2], `${s.name}: ${word}, ${way}`).toContain(cuts.length);
          expect(new Set(cuts.map((c) => JSON.stringify(c.state.sorts))).size, `${s.name}: ${word}, ${way}`).toBe(1);
          // Where applyView puts those rows, one of the cuts has the last row kept and the first left out tie on
          // every sorted column.
          const inside = cuts.filter((c) => {
            const limit = c.state.limit as number;
            const all = applyView(check.rows, { ...c.state, limit: check.rows.length }, s.schema).rows;
            return c.state.sorts.every((sort) => all[limit - 1]?.[sort.columnId] === all[limit]?.[sort.columnId]);
          });
          expect(inside.length, `${s.name}: ${word}, ${way}`).toBeGreaterThan(0);
        }
        for (const c of cases) {
          expect(c.state.sorts, c.name).toHaveLength(n);
          expect(c.state.filters, c.name).toBeNull();
          expect(ORDERED_KINDS, c.name).toContain(kindIn(s, c.state.sorts[0]?.columnId));
        }
      }
    }
    // Where rows tie on four columns, there is such a count too.
    expect(WIDE.some((s) => checkFor(s, true).cases.some((c) => allTied("four").test(c.name)))).toBe(true);
  });

  it("a right Data Query passes every case on the schema with two columns of each kind, whatever it chooses", () => {
    for (const s of WIDE) {
      for (const counted of BOTH) {
        const check = checkFor(s, counted);
        expect(new Set(check.cases.map((c) => c.name)).size, s.name).toBe(check.cases.length);
        expect(failuresOf(check, applyViewQuery(check, s.schema, s.id)), s.name).toEqual([]);
        expect(failuresOf(check, handQuery(check, s.schema, s.id, undefined, false, { spaces: "skipped" })), s.name).toEqual([]);
        for (const ties of ["reverse load order", "load order", "id ascending", "id descending"] as const) {
          for (const empties of ["lowest", "highest", "first", "last"] as const) {
            for (const byInstant of [false, true]) {
              expect(
                failuresOf(check, handQuery(check, s.schema, s.id, undefined, byInstant, { ties, empties })),
                `${s.name} ${ties} ${empties} ${byInstant}`,
              ).toEqual([]);
            }
          }
        }
      }
    }
  }, 120_000);

  // --- Rows that hold the very same text in a sorted column tie on it, whatever its characters ------------------------
  // Two cells that are one string tie under every collation, so the next sorted column decides between their rows, as
  // it does between two rows that hold the same text of the letters A to Z. Only where two different texts go against
  // each other is the Host's collation's own (ruling R4).

  const WORDS = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
  /** Text that holds a character other than the letters A to Z and a space, as SQL's `GLOB '*[^A-Za-z ]*'` finds it. */
  const otherThanLetters = (cell: Scalar | undefined) => typeof cell === "string" && /[^A-Za-z ]/.test(cell);
  const collatedIn = (s: Subject, columnId: string) => ["string", "enum"].includes(kindIn(s, columnId) ?? "");
  type Sorts = ViewState["sorts"];
  /** What a Data Query's ORDER BY reads for a row's cell in its `place`-th sort: the cell itself, or what a habit makes it. */
  type SortKey = (row: Row, place: number, sorts: Sorts, s: Subject) => Scalar;
  const asIs: SortKey = (row, place, sorts) => row[(sorts[place] as Sorts[number]).columnId] as Scalar;
  /** Four letters made from a text, the same for the same text: where a collation of its own puts other text. */
  const scrambled = (text: string, seed: number): string => {
    let hash = 0x811c9dc5 ^ seed;
    for (const unit of text) hash = Math.imul(hash ^ (unit.codePointAt(0) as number), 0x01000193) >>> 0;
    return Array.from({ length: 4 }, (_, i) => String.fromCharCode(97 + ((hash >>> (i * 5)) % 26))).join("");
  };
  /**
   * A Data Query with a collation of its own. Text of the letters A to Z sorts by its letters, ignoring case, and any
   * other text at a place made from the text alone, so two texts that differ go in an order no other database shares,
   * and one text always ties with itself. An empty cell is the lowest value, and rows that tie keep the order they were
   * loaded in. `key` is what its ORDER BY reads for each cell.
   */
  const ownCollation =
    (check: QueryCheck, s: Subject, seed: number, key: SortKey = asIs): DataQuery =>
    (state) => {
      const filtered = applyView(check.rows, { ...state, sorts: [], limit: undefined }, s.schema).rows;
      const textKey = (text: string) => (WORDS.test(text) ? text.toLowerCase() : `${scrambled(text, seed)}${text}`);
      const cells = (a: Scalar, b: Scalar, columnId: string): number => {
        if (isEmptyCell(a) || isEmptyCell(b)) return Number(!isEmptyCell(a)) - Number(!isEmptyCell(b));
        if (typeof a === "number" && typeof b === "number") return a - b;
        if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
        if (collatedIn(s, columnId)) return textOrder(textKey(String(a)), textKey(String(b))) || textOrder(String(a), String(b));
        return textOrder(String(a), String(b));
      };
      const { sorts } = state;
      const first = sorts[0]?.columnId;
      const rows = (state.limit === undefined || first === undefined ? filtered : filtered.filter((row) => !isEmptyCell(row[first])))
        .map((row) => ({ row, keys: sorts.map((_, place) => key(row, place, sorts, s)) }))
        .sort((a, b) => {
          for (const [place, sort] of sorts.entries()) {
            const d = cells(a.keys[place] as Scalar, b.keys[place] as Scalar, sort.columnId);
            if (d !== 0) return sort.direction === "desc" ? -d : d;
          }
          return 0;
        })
        .map(({ row }) => row);
      return (state.limit === undefined ? rows : rows.slice(0, state.limit)).map((row) => row[s.id] as string | number);
    };
  // The verifier's three probes, each a CASE in the ORDER BY of a later sort.
  const PROBES: Array<{ probe: string; key: SortKey }> = [
    {
      // "CASE WHEN first GLOB '*[^A-Za-z ]*' THEN NULL ELSE later END"
      probe: "later sorts are dropped for a row whose first sorted text or enum cell holds other characters",
      key: (row, place, sorts, s) => {
        const first = (sorts[0] as Sorts[number]).columnId;
        return place > 0 && collatedIn(s, first) && otherThanLetters(row[first]) ? null : asIs(row, place, sorts, s);
      },
    },
    {
      // "CASE WHEN first GLOB '*[^A-Za-z ]*' THEN -later ELSE later END" on a number column.
      probe: "a later number sort goes the other way for a row whose first sorted text or enum cell holds other characters",
      key: (row, place, sorts, s) => {
        const first = (sorts[0] as Sorts[number]).columnId;
        const cell = asIs(row, place, sorts, s);
        return place > 0 && typeof cell === "number" && collatedIn(s, first) && otherThanLetters(row[first]) ? -cell : cell;
      },
    },
    {
      // The same as the first, after any earlier text or enum sort, not only the first.
      probe: "later sorts are dropped after any sorted text or enum cell that holds other characters",
      key: (row, place, sorts, s) => {
        const earlier = sorts.slice(0, place).filter((sort) => collatedIn(s, sort.columnId));
        return earlier.some((sort) => otherThanLetters(row[sort.columnId] ?? "")) ? null : asIs(row, place, sorts, s);
      },
    },
  ];

  it("the verifier's case: two rows that hold the same text with a letter outside A to Z, swapped, fail on the next sort", () => {
    const s = SUBJECTS[0] as Subject;
    const check = checkFor(s, false);
    const c = theCase(
      check,
      /^two sorts order the rows by each in turn, whichever column is sorted first \(sorted by Household, descending, then Market value, ascending\)$/,
    );
    const right = applyViewQuery(check, s.schema, s.id)(c.state);
    expect(c.compare(right)).toEqual({ ok: true });
    // The account numbers are text: "23", as the example's own Data Query returns them.
    const rowOf = (id: string) => check.rows.find((row) => String(row[s.id]) === id) as Row;
    expect([rowOf("23").household, rowOf("26").household]).toEqual(["Ålder Fen", "Ålder Fen"]);
    expect(rowOf("23").market_value).not.toBe(rowOf("26").market_value);
    const swapped = right.map((id) => (String(id) === "23" ? "26" : String(id) === "26" ? "23" : id));
    const result = c.compare(swapped);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(/: wrong order: id (23|26) came /);
  });

  it("two adjacent rows that hold one text or enum ID of other characters in the first sorted column, swapped, fail where the second tells them apart", () => {
    let enums = 0;
    for (const s of ALL) {
      for (const counted of BOTH) {
        const check = checkFor(s, counted);
        const byId = new Map(check.rows.map((row) => [String(row[s.id]), row]));
        const missed: string[] = [];
        let swaps = 0;
        for (const c of check.cases.filter((x) => TWO_SORTS_ANY_LEAD.test(x.name))) {
          const [lead, then] = c.state.sorts as [Sorts[number], Sorts[number]];
          if (
            !collatedIn(s, lead.columnId) ||
            !["number", "currency", "percent", "date", "boolean"].includes(kindIn(s, then.columnId) ?? "")
          ) {
            continue;
          }
          const right = applyViewQuery(check, s.schema, s.id)(c.state);
          for (let i = 0; i + 1 < right.length; i++) {
            const [a, b] = [byId.get(String(right[i])) as Row, byId.get(String(right[i + 1])) as Row];
            const shared = a[lead.columnId];
            if (shared !== b[lead.columnId] || isEmptyCell(shared) || WORDS.test(String(shared))) continue;
            if (isEmptyCell(a[then.columnId]) || isEmptyCell(b[then.columnId]) || a[then.columnId] === b[then.columnId]) continue;
            swaps += 1;
            if (kindIn(s, lead.columnId) === "enum") enums += 1;
            const swapped = [...right];
            [swapped[i], swapped[i + 1]] = [swapped[i + 1] as string | number, swapped[i] as string | number];
            if (c.compare(swapped).ok) missed.push(`${c.name}: ids ${right[i]} and ${right[i + 1]} (${JSON.stringify(shared)})`);
          }
        }
        expect(swaps, `${s.name} ${counted}`).toBeGreaterThan(0);
        expect(missed, `${s.name} ${counted}`).toEqual([]);
      }
    }
    // Enum IDs with an underscore, such as "roth_ira", are among them.
    expect(enums).toBeGreaterThan(0);
  });

  it("rows that tie on one text of other characters and on every other sort may still come in any order", () => {
    for (const s of ALL) {
      const check = checkFor(s, false);
      const c = check.cases.find((x) => TWO_SORTS_ANY_LEAD.test(x.name) && collatedIn(s, x.state.sorts[0]?.columnId as string));
      expect(c, s.name).toBeDefined();
      const { state } = c as QueryCheckCase;
      const right = applyViewQuery(check, s.schema, s.id)(state);
      const byId = new Map(check.rows.map((row) => [String(row[s.id]), row]));
      const keyOf = (id: string | number) => JSON.stringify(state.sorts.map((sort) => byId.get(String(id))?.[sort.columnId]));
      // Each run of rows that tie on both sorts, turned round.
      const runs: Array<Array<string | number>> = [];
      for (const id of right) {
        const run = runs.at(-1);
        if (run && keyOf(run[0] as string | number) === keyOf(id)) run.push(id);
        else runs.push([id]);
      }
      expect(
        runs.some((run) => run.length > 1 && otherThanLetters(byId.get(String(run[0]))?.[state.sorts[0]?.columnId as string])),
        s.name,
      ).toBe(true);
      expect((c as QueryCheckCase).compare(runs.flatMap((run) => [...run].reverse())), s.name).toEqual({ ok: true });
    }
  });

  it("a right Data Query whose collation puts each other text at a place of its own passes every case", () => {
    for (const s of ALL) {
      for (const counted of BOTH) {
        const check = checkFor(s, counted);
        for (const seed of [1, 2, 3]) {
          expect(failuresOf(check, ownCollation(check, s, seed)), `${s.name} ${counted} ${seed}`).toEqual([]);
        }
      }
    }
  }, 60_000);

  for (const { probe, key } of PROBES) {
    it(`“${probe}” fails on every schema, with limit.set and without, and only where text or an enum is sorted before`, () => {
      for (const s of ALL) {
        for (const counted of BOTH) {
          const check = checkFor(s, counted);
          const failed = check.cases.filter((c) => !c.compare(ownCollation(check, s, 1, key)(c.state)).ok);
          expect(failed.length, `${s.name} ${counted}`).toBeGreaterThan(0);
          expect(
            failed.filter((c) => !c.state.sorts.slice(0, -1).some((sort) => collatedIn(s, sort.columnId))).map((c) => c.name),
            `${s.name} ${counted}`,
          ).toEqual([]);
        }
      }
    }, 60_000);
  }
});
