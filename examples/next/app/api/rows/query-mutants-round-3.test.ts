import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { applyView, emptyViewState, type ViewSchema, type ViewState } from "gridcue";
import { queryCheck } from "gridcue/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The ledger fixture is not a dependency of the example, so it comes in by path. It is synthetic.
import { ledgerSchema } from "../../../../../fixtures/ledger/src/index";
import * as example from "./query";
import { type DataQueryModule, runQueryCheck } from "./query-check-run";
import { writeMutants } from "./query-mutants";
import { MUTANTS_ROUND_3 } from "./query-mutants-round-3";

/**
 * Held-out mutants, round 3. Each is the example's Data Query with one rule translated wrong (query-mutants-round-3.ts).
 * The Query Check must fail at least one case for each, and the case's name must be about the rule the mutant breaks.
 *
 * Round 3's M23 ("not equal to no" read as "is yes") is not here: a yes/no column takes only "equal", so no View State
 * can hold it, and the example's query refuses it.
 *
 * Two of them, M15 and M16, are no wrong translations after all. They only break ties another way, and ruling R2 (more
 * grids spec 5.5, `compare`) leaves that to the Host: the Query Check must pass them.
 */

type SchemaName = "ledger" | "wealth";
const SCHEMAS: Record<SchemaName, { schema: ViewSchema; id: string }> = {
  ledger: { schema: ledgerSchema, id: "entry_number" },
  wealth: { schema: wealthSchema, id: "account_number" },
};

/** Where each mutant is caught, and the start of the name of a case that catches it: the rule it breaks. */
const CAUGHT: Record<string, readonly [SchemaName, string]> = {
  M1: ["ledger", "in a list with empty text among other values keeps the empty cells too"],
  M2: ["ledger", "in a list with empty text among other values keeps the empty cells too"],
  M3: ["ledger", "in a list of empty text keeps exactly the empty cells"],
  M4: ["ledger", "equal to empty text keeps exactly the empty cells"],
  M5: ["ledger", "contains empty text keeps every row, empty cells included"],
  M6: ["ledger", "contains reads \\, ! and [ as plain text"],
  M7: ["ledger", "starts with reads \\, ! and [ as plain text"],
  M8: ["ledger", "contains reads % as plain text"],
  M9: ["ledger", "contains reads \\, ! and [ as plain text"],
  M10: ["ledger", "contains ignores case"],
  M11: ["ledger", "a sort on a hidden column still orders the rows"],
  M12: ["ledger", "a second sort on a hidden column still orders the rows"],
  M13: ["ledger", "a sort on a hidden column still orders the rows"],
  M14: ["ledger", "a sort on a hidden column still orders the rows"],
  // RANK keeps every row that ties at the cut: more rows than the count asks for.
  M17: [
    "ledger",
    "a count that cuts inside tied rows keeps its number of rows: every row ahead of the tie, none behind it, and any of the tied",
  ],
  // Caught on the wealth schema only: its count's first sorted column holds a zero. The ledger's doesn't.
  M18: ["wealth", "a count never keeps a row with no value in the first sorted column"],
  M19: ["ledger", "a count never keeps a row with no value in the first sorted column"],
  M20: ["ledger", "sorts by each column in turn, in its direction"],
  M21: ["ledger", "equal to zero leaves out empty cells"],
  M22: ["ledger", "no keeps only no and leaves out empty cells"],
  M24: ["ledger", "an or group inside an and keeps its own brackets"],
  M25: ["ledger", "between includes both ends and leaves out empty cells"],
};

/**
 * Right Data Queries under ruling R2: a count that cuts inside a run of tied rows may keep any of the tied rows for its
 * last places, and rows that tie may come in any order. M15 breaks ties in the reverse of the order the rows were
 * loaded in when it sorts going up, and M16 by another column. A database has no load order, so both are the Host's
 * own choice, and the Query Check must pass them.
 */
const RIGHT_BY_R2: ReadonlySet<string> = new Set(["M15", "M16"]);

const visible = ledgerSchema.columns.map((c) => c.id);
const base = emptyViewState(visible);
/** Ledger rows from the Query Check's own rows, with their ids and the cells given. */
const ledgerRows = (cells: ReadonlyArray<Record<string, unknown>>) => {
  const rows = queryCheck(ledgerSchema, { id: "entry_number" }).rows;
  return cells.map((cell, i) => ({ ...rows[i], entry_number: String(i + 1), ...cell }));
};

type Probe = { rows: () => Array<Record<string, unknown>>; state: ViewState };

/**
 * For each mutant the held-out run found no case for, rows and a View State on which it keeps rows (or an order)
 * applyView doesn't. For M12 and M17 that is proof each is wrong. For M15 and M16 it shows only that they break ties
 * another way.
 */
const PROBES: Record<string, Probe> = {
  // A second sort on a hidden column. The check's hidden-column cases sorted by one column.
  M12: {
    rows: () =>
      ledgerRows([
        { category: "fees", units: 3 },
        { category: "fees", units: 9 },
        { category: "fees", units: 5 },
      ]),
    state: {
      ...base,
      visibleColumnIds: visible.filter((id) => id !== "units"),
      sorts: [
        { columnId: "category", direction: "asc" },
        { columnId: "units", direction: "desc" },
      ],
    },
  },
  // A count going up that cuts inside a run of rows that tie: the query keeps the tied row loaded last, and applyView
  // the one loaded first. Both keep the row ahead of the tie and two rows in all.
  M15: {
    rows: () => ledgerRows([{ units: 1 }, { units: 5 }, { units: 5 }, { units: 5 }, { units: 9 }]),
    state: { ...base, sorts: [{ columnId: "units", direction: "asc" }], limit: 2 },
  },
  // The same, with ties broken by Owner.
  M16: {
    rows: () =>
      ledgerRows([
        { units: 9, owner: "Zed" },
        { units: 9, owner: "Amy" },
        { units: 9, owner: "Mia" },
        { units: 1, owner: "Oak" },
      ]),
    state: { ...base, sorts: [{ columnId: "units", direction: "desc" }], limit: 2 },
  },
  // A count with RANK keeps every row that ties at the cut, so more than N rows.
  M17: {
    rows: () => ledgerRows([{ units: 5 }, { units: 9 }, { units: 9 }, { units: 9 }, { units: 1 }]),
    state: { ...base, sorts: [{ columnId: "units", direction: "desc" }], limit: 2 },
  },
};

/** The ids a Data Query returns for `state` on `rows`, in order. */
const idsFrom = (query: DataQueryModule, rows: Array<Record<string, unknown>>, state: ViewState): unknown[] => {
  const db = query.openRowsDatabase(ledgerSchema, rows);
  try {
    return query.readRows(db, ledgerSchema, state, { offset: 0, size: rows.length }).rows.map((row) => row.entry_number);
  } finally {
    db.close();
  }
};

// Each test reads every case twice: seconds, and more when the whole suite runs at once.
describe("the Query Check catches a Data Query that translates a rule wrong (held-out round 3)", { timeout: 120_000 }, () => {
  let dir = "";
  let paths = new Map<string, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gridcue-query-mutants-3-"));
    paths = writeMutants(dir, MUTANTS_ROUND_3);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const load = async (id: string) => (await import(/* @vite-ignore */ paths.get(id) as string)) as DataQueryModule;

  it("every mutant is listed once, as caught or as right under ruling R2", () => {
    const listed = [...Object.keys(CAUGHT), ...RIGHT_BY_R2];
    expect(listed.sort()).toEqual(
      MUTANTS_ROUND_3.filter((m) => m.id !== "M23")
        .map((m) => m.id)
        .sort(),
    );
    for (const id of RIGHT_BY_R2) expect(PROBES, id).toHaveProperty(id);
  });

  it("M23 can't be held: a yes/no column takes only equal, and the example's query refuses not equal", () => {
    const state: ViewState = {
      ...base,
      filters: {
        id: "root",
        type: "group",
        combinator: "and",
        children: [{ id: "f1", type: "predicate", columnId: "cleared", operator: "neq", value: false }],
      },
    };
    expect(() => example.buildRowsQuery(ledgerSchema, state, { offset: 0, size: 10 })).toThrow(example.DataQueryError);
  });

  for (const mutant of MUTANTS_ROUND_3.filter((m) => m.id in CAUGHT)) {
    const [schemaName, rule] = CAUGHT[mutant.id] as readonly [SchemaName, string];
    it(`${mutant.id}: ${mutant.rule} (caught on the ${schemaName} schema)`, async () => {
      const { schema, id } = SCHEMAS[schemaName];
      const { failures } = runQueryCheck(schema, id, await load(mutant.id));
      expect(failures.map((f) => f.name).filter((name) => name.startsWith(rule))).not.toEqual([]);
    });
  }

  for (const mutant of MUTANTS_ROUND_3.filter((m) => m.id in PROBES)) {
    const probe = PROBES[mutant.id] as Probe;
    const what = RIGHT_BY_R2.has(mutant.id)
      ? "it keeps other tied rows than applyView does, which ruling R2 leaves to the Host"
      : "the mutant is wrong: it keeps rows or an order applyView doesn't";
    it(`${mutant.id}: ${mutant.rule} (${what})`, async () => {
      const rows = probe.rows();
      const want = applyView(rows, probe.state, ledgerSchema).rows.map((row) => row.entry_number);
      expect(idsFrom(example, rows, probe.state)).toEqual(want);
      expect(idsFrom(await load(mutant.id), rows, probe.state)).not.toEqual(want);
    });
  }

  // Ruling R2 makes these right Data Queries. They break ties another way than applyView, and nothing else.
  for (const mutant of MUTANTS_ROUND_3.filter((m) => RIGHT_BY_R2.has(m.id))) {
    it(`${mutant.id}: ${mutant.rule} (a right Data Query under ruling R2: every case passes, on both schemas)`, async () => {
      const query = await load(mutant.id);
      for (const { schema, id } of [SCHEMAS.ledger, SCHEMAS.wealth]) {
        const { cases, failures } = runQueryCheck(schema, id, query);
        expect(cases).toBeGreaterThan(40);
        expect(failures).toEqual([]);
      }
    });
  }

  it("M17: RANK fails on both schemas, and the message says how many rows came back and how many the count asks for", async () => {
    const query = await load("M17");
    for (const { schema, id } of [SCHEMAS.ledger, SCHEMAS.wealth]) {
      const tied = runQueryCheck(schema, id, query).failures.filter((f) => f.name.startsWith(CAUGHT.M17?.[1] as string));
      expect(tied.length).toBeGreaterThan(0);
      for (const failure of tied) expect(failure.message).toMatch(/: (\d+) rows came back, and the count asks for (\d+)$/);
    }
  });
});
