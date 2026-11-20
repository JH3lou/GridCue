import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { applyView, emptyViewState, type FilterGroup, type ViewSchema, type ViewState } from "gridcue";
import { queryCheck } from "gridcue/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The ledger fixture is not a dependency of the example, so it comes in by path. It is synthetic.
import { ledgerSchema } from "../../../../../fixtures/ledger/src/index";
import * as example from "./query";
import { type DataQueryModule, runQueryCheck } from "./query-check-run";
import { writeMutants } from "./query-mutants";
import { MUTANTS_ROUND_2 } from "./query-mutants-round-2";

/**
 * Held-out mutants, round 2. Each is the example's Data Query with one rule translated wrong (query-mutants-round-2.ts).
 * The Query Check must fail at least one case for each, and the case's name must be about the rule the mutant breaks.
 */

type SchemaName = "ledger" | "wealth";
const SCHEMAS: Record<SchemaName, { schema: ViewSchema; id: string }> = {
  ledger: { schema: ledgerSchema, id: "entry_number" },
  wealth: { schema: wealthSchema, id: "account_number" },
};

/** Where each mutant is caught, and the start of the name of a case that catches it: the rule it breaks. */
const CAUGHT: Record<string, readonly [SchemaName, string]> = {
  M1: ["ledger", "not equal to empty text leaves out exactly the empty cells"],
  M2: ["ledger", "not equal keeps empty cells"],
  M4: ["ledger", "is empty keeps null and empty text, and leaves out whitespace-only and placeholder text"],
  M5: ["ledger", "is empty keeps only cells with no value, and zero is a value"],
  M6: ["ledger", "in a list with empty text among other values keeps the empty cells too"],
  M7: ["ledger", "equal to whitespace-only text keeps only that text, not the empty cells"],
  M8: ["ledger", "starts with keeps the spaces in what it asks for"],
  M9: ["ledger", "starts with reads _ as plain text"],
  M10: ["ledger", "contains reads \\, ! and [ as plain text"],
  M11: ["ledger", "starts with ignores case, looks only at the start"],
  // Caught through the percent column: 0.25 rounds to 0, so "Rate is above 0.1" loses it.
  M13: ["ledger", "greater than leaves out the value itself and empty cells"],
  M14: ["ledger", "a filter joined with and keeps its own brackets"],
  M15: ["ledger", "a filter joined with and keeps its own brackets"],
  M16: ["ledger", "two filters on one column must both hold"],
  M17: ["ledger", "two filters on one column must both hold"],
  M18: ["ledger", "a sort on a hidden column still orders the rows"],
  M20: ["ledger", "a count keeps the first rows of the sorted, filtered rows"],
};

const visible = ledgerSchema.columns.map((c) => c.id);
const base = emptyViewState(visible);
const oneFilter = (columnId: string, operator: string, value: unknown): FilterGroup =>
  ({ id: "root", type: "group", combinator: "and", children: [{ id: "f1", type: "predicate", columnId, operator, value }] }) as FilterGroup;
/** A ledger row from the Query Check's own rows, with its id and the cells given. */
const ledgerRows = (cells: ReadonlyArray<Record<string, unknown>>) => {
  const rows = queryCheck(ledgerSchema, { id: "entry_number" }).rows;
  return cells.map((cell, i) => ({ ...rows[i], entry_number: String(i + 1), ...cell }));
};

type Probe = { rows: () => Array<Record<string, unknown>>; state: ViewState };

/**
 * For the mutants the held-out run found no case for, a View State and rows on which the mutant keeps rows (or an
 * order) applyView doesn't: proof that each is wrong, whether or not a case catches it now.
 */
const PROBES: Record<string, Probe> = {
  // "in" with empty text beside other values. The check's lists held empty text only on its own.
  M6: {
    rows: () => ledgerRows([{ owner: "Elm Garth" }, { owner: "" }, { owner: null }, { owner: "Cedar Dun" }]),
    state: { ...base, filters: oneFilter("owner", "in", ["Elm Garth", ""]) },
  },
  // A backslash in what "contains" asks for. No row and no case held a backslash.
  M10: {
    rows: () => ledgerRows([{ owner: "a\\b" }, { owner: "ab" }, { owner: "xa\\by" }, { owner: null }]),
    state: { ...base, filters: oneFilter("owner", "contains", "a\\b") },
  },
  // A sort on a hidden column. No case hid a column it sorts by.
  M18: {
    rows: () => ledgerRows([{ units: 1 }, { units: 9 }, { units: 5 }]),
    state: { ...base, visibleColumnIds: visible.filter((id) => id !== "units"), sorts: [{ columnId: "units", direction: "desc" }] },
  },
  // A count that cuts among rows that tie. The check's counts cut between two different values, and compare leaves the
  // order of rows that tie to the Host.
  M19: {
    rows: () => ledgerRows([{ units: 5 }, { units: 9 }, { units: 9 }, { units: 9 }, { units: 1 }]),
    state: { ...base, sorts: [{ columnId: "units", direction: "desc" }], limit: 2 },
  },
};

/**
 * Mutants no case catches yet. They are marked to fail until the Query Check catches them. M19 waits on the lead's
 * ruling: whether a Data Query must break ties in the order the rows were loaded, or may break them its own way.
 */
const NOT_CAUGHT: ReadonlySet<string> = new Set(["M19"]);

/** The ids a Data Query returns for `state` on `rows`, in order. */
const idsFrom = (query: DataQueryModule, rows: Array<Record<string, unknown>>, state: ViewState): unknown[] => {
  const db = query.openRowsDatabase(ledgerSchema, rows);
  try {
    return query.readRows(db, ledgerSchema, state, { offset: 0, size: rows.length }).rows.map((row) => row.entry_number);
  } finally {
    db.close();
  }
};

describe("the Query Check catches a Data Query that translates a rule wrong (held-out round 2)", () => {
  let dir = "";
  let paths = new Map<string, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gridcue-query-mutants-2-"));
    paths = writeMutants(dir, MUTANTS_ROUND_2);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const load = async (id: string) => (await import(/* @vite-ignore */ paths.get(id) as string)) as DataQueryModule;

  it("every mutant is listed once, as caught or not caught", () => {
    const listed = [...Object.keys(CAUGHT), ...NOT_CAUGHT];
    expect(listed.sort()).toEqual(MUTANTS_ROUND_2.map((m) => m.id).sort());
    for (const id of NOT_CAUGHT) expect(PROBES, id).toHaveProperty(id);
  });

  for (const mutant of MUTANTS_ROUND_2.filter((m) => m.id in CAUGHT)) {
    const [schemaName, rule] = CAUGHT[mutant.id] as readonly [SchemaName, string];
    it(`${mutant.id}: ${mutant.rule} (caught on the ${schemaName} schema)`, async () => {
      const { schema, id } = SCHEMAS[schemaName];
      const { failures } = runQueryCheck(schema, id, await load(mutant.id));
      expect(failures.map((f) => f.name).filter((name) => name.startsWith(rule))).not.toEqual([]);
    });
  }

  for (const mutant of MUTANTS_ROUND_2.filter((m) => m.id in PROBES)) {
    const probe = PROBES[mutant.id] as Probe;
    it(`${mutant.id}: ${mutant.rule} (the mutant is wrong: it keeps rows or an order applyView doesn't)`, async () => {
      const rows = probe.rows();
      const want = applyView(rows, probe.state, ledgerSchema).rows.map((row) => row.entry_number);
      expect(idsFrom(example, rows, probe.state)).toEqual(want);
      expect(idsFrom(await load(mutant.id), rows, probe.state)).not.toEqual(want);
    });
  }

  for (const mutant of MUTANTS_ROUND_2.filter((m) => NOT_CAUGHT.has(m.id))) {
    it.fails(`${mutant.id}: ${mutant.rule} (no case catches it yet)`, async () => {
      const query = await load(mutant.id);
      const failures = [SCHEMAS.ledger, SCHEMAS.wealth].flatMap(({ schema, id }) => runQueryCheck(schema, id, query).failures);
      expect(failures).not.toEqual([]);
    });
  }
});
