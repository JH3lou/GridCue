import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { applyView, defineSchema, emptyViewState, type ViewSchema, type ViewState } from "gridcue";
import { queryCheck } from "gridcue/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The ledger fixture is not a dependency of the example, so it comes in by path. It is synthetic.
import { ledgerSchema } from "../../../../../fixtures/ledger/src/index";
import * as example from "./query";
import type { DataQueryModule } from "./query-check-run";
import { writeMutants } from "./query-mutants";
import { CLEAN_CUT_CASES, RIGHT, runCheck, WRONG } from "./query-mutants-second-1";

/**
 * The second held-out check of the Query Check, round 1. Each Data Query is the example's (query.ts) with one choice
 * made another way (query-mutants-second-1.ts). The Query Check must fail each wrong one on a case whose name is about
 * the rule it breaks, and pass each right one on both schemas, with `limit.set` listed and without.
 */

type SchemaName = "ledger" | "wealth";
const SCHEMAS: Record<SchemaName, { schema: ViewSchema; id: string }> = {
  ledger: { schema: ledgerSchema, id: "entry_number" },
  wealth: { schema: wealthSchema, id: "account_number" },
};

const TIED = "a count that cuts inside tied rows keeps its number of rows: every row ahead of the tie, none behind it, and any of the tied";
const NEXT_DECIDES = "a count that cuts inside rows that tie on the first sorted column keeps the ones the next sorted column puts first";
/** How the name of every case whose count cuts inside a run of tied rows starts. */
const CUT_INSIDE_TIES = "a count that cuts inside ";
const LATER = "a row with no value in a later sorted column keeps its place by the columns before it";
const COUNT_LATER = "a count keeps a row with no value in a later sorted column";
const NEVER_EMPTY = "a count never keeps a row with no value in the first sorted column";
const HIDDEN_SORT = "a sort on a hidden column still orders the rows";
const ENUM_IDS = "an enum sorts by its values' IDs, ignoring case";

/** Where each wrong Data Query is caught, with `limit.set` listed, and the start of the name of a case that catches it. */
const CAUGHT: Record<string, readonly [SchemaName, string]> = {
  W1: ["ledger", TIED],
  W2: ["ledger", TIED],
  W4: ["ledger", TIED],
  W5: ["ledger", TIED],
  W6: ["ledger", TIED],
  W7: ["ledger", TIED],
  W9: ["ledger", LATER],
  W10: ["ledger", LATER],
  W11: ["ledger", "sorts by each column in turn, in its direction"],
  W12: ["ledger", COUNT_LATER],
  W13: ["ledger", COUNT_LATER],
  W14: ["ledger", LATER],
  W15: ["ledger", NEVER_EMPTY],
  W16: ["ledger", NEVER_EMPTY],
  W17: ["ledger", NEVER_EMPTY],
  W18: ["ledger", NEVER_EMPTY],
  W20: ["ledger", HIDDEN_SORT],
  W21: ["ledger", HIDDEN_SORT],
  W22: ["ledger", HIDDEN_SORT],
  W23: ["ledger", "a filter on a hidden column still holds"],
  W24: ["ledger", "a sort beside a filter still orders the rows"],
  W26: ["ledger", "a second sort on an enum orders the rows that tie on the first"],
  W27: ["ledger", ENUM_IDS],
  W28: ["ledger", "a second sort on text orders the rows that tie on the first"],
  W29: ["ledger", ENUM_IDS],
  W31: ["ledger", ENUM_IDS],
  W32: ["ledger", "equal keeps é and e apart"],
  // Each text operator has its own accent cases.
  W33: ["ledger", "in a list ignores case but not accents"],
  W34: ["ledger", "not equal ignores case but not accents"],
  W35: ["ledger", "contains keeps é and e apart"],
  W36: ["ledger", "starts with ignores case but not accents"],
  W37: ["ledger", "equal keeps é and e apart"],
  W38: ["ledger", "contains keeps é and e apart"],
  W40: ["ledger", "a count keeps the first rows of the sorted, filtered rows"],
  W41: ["ledger", "a count keeps the first rows of the sorted, filtered rows"],
  W42: ["ledger", "numbers sort by their value, not as text"],
  W43: ["ledger", "text sorts by its letters, ignoring case"],
  // Caught when the pages are read: a random tie-break repeats rows and loses others.
  W44: ["ledger", "a paged read is the whole result cut in pieces: rows that tie keep one order from page to page"],
  // Missed in the first run of this set; each class has its cases now.
  W8: ["ledger", NEXT_DECIDES],
  W19: ["ledger", "a count keeps a row with an empty cell in a later sorted column"],
  W25: ["ledger", "a sort beside an or group still orders the rows"],
  W39: ["ledger", "not equal keeps é and e apart"],
  W45: ["ledger", "a filter on a hidden column still holds in an or group"],
};

/** The wrong Data Queries caught with `limit.set` left out too: each changes more than a count. */
const CAUGHT_WITHOUT_COUNTS: ReadonlySet<string> = new Set([
  "W9",
  "W10",
  "W11",
  "W14",
  "W20",
  "W21",
  "W22",
  "W23",
  "W24",
  "W25",
  "W26",
  "W27",
  "W28",
  "W29",
  "W31",
  "W32",
  "W33",
  "W34",
  "W35",
  "W36",
  "W37",
  "W38",
  "W39",
  "W42",
  "W43",
  "W44",
  "W45",
]);

/**
 * Wrong Data Queries the first run of this set missed: each returned the same ids as the example's query on every
 * case, on both schemas. The second round of the Query Check added the cases that tell each class apart. A probe
 * below proves each one wrong on rows of its own, so the case that now catches it is not a false alarm.
 */
const ONCE_MISSED: Record<string, string> = {
  W8: "a count that cuts inside a run of rows that tie on the first sorted column, sorted by two",
  W19: "a count sorted by a text column second, with empty text in that column ahead of the cut",
  W25: "a sort beside an or group",
  W39: "not equal with é in what it asks for",
  W45: "a filter on a hidden column inside an or group",
};

const visible = ledgerSchema.columns.map((c) => c.id);
const base = emptyViewState(visible);
/** Ledger rows from the Query Check's own rows, with their ids and the cells given. */
const ledgerRows = (cells: ReadonlyArray<Record<string, unknown>>) => {
  const rows = queryCheck(ledgerSchema, { id: "entry_number" }).rows;
  return cells.map((cell, i) => ({ ...rows[i], entry_number: String(i + 1), ...cell }));
};
const predicate = (id: string, columnId: string, operator: string, value?: unknown) => ({
  id,
  type: "predicate" as const,
  columnId,
  operator,
  ...(value === undefined ? {} : { value }),
});

type Probe = { rows: () => Array<Record<string, unknown>>; state: ViewState; ordered?: boolean };

/** For each missed Data Query, rows and a View State on which it keeps rows, or an order, that applyView doesn't. */
const PROBES: Record<string, Probe> = {
  // The cut must follow every sorted column: of the three rows booked on one day, the one with the fewest units.
  W8: {
    rows: () =>
      ledgerRows([
        { booked: "2026-06-15", units: 5 },
        { booked: "2026-03-08", units: 9 },
        { booked: "2026-03-08", units: 1 },
        { booked: "2026-03-08", units: 3 },
        { booked: "2026-01-02", units: 2 },
      ]),
    state: {
      ...base,
      sorts: [
        { columnId: "booked", direction: "desc" },
        { columnId: "units", direction: "asc" },
      ],
      limit: 2,
    },
  },
  // A row with empty text in a later sorted column keeps its place by the first, so the count keeps it.
  W19: {
    rows: () =>
      ledgerRows([
        { booked: "2026-06-15", owner: "Zed" },
        { booked: "2026-06-15", owner: "" },
        { booked: "2026-03-08", owner: "Amy" },
        { booked: "2026-01-02", owner: "Amy" },
      ]),
    state: {
      ...base,
      sorts: [
        { columnId: "booked", direction: "desc" },
        { columnId: "owner", direction: "asc" },
      ],
      limit: 3,
    },
  },
  // The sorts still order the rows when the filter is an or group.
  W25: {
    rows: () =>
      ledgerRows([
        { category: "travel", units: 5, amount: 10 },
        { category: "fees", units: 3, amount: 20 },
        { category: "fees", units: 2, amount: 5 },
        { category: "fees", units: 1, amount: 99 },
        { category: "supplies", units: 4, amount: 7 },
      ]),
    state: {
      ...base,
      filters: {
        id: "root",
        type: "group",
        combinator: "or",
        children: [predicate("f1", "units", "gte", 2), predicate("f2", "amount", "gt", 90)],
      } as ViewState["filters"],
      sorts: [
        { columnId: "category", direction: "asc" },
        { columnId: "amount", direction: "desc" },
      ],
    },
    ordered: true,
  },
  // "Is not zoe" keeps Zoë: GridCue folds letter case only.
  W39: {
    rows: () => ledgerRows([{ owner: "Zoë" }, { owner: "Zoe" }, { owner: "Jose" }]),
    state: {
      ...base,
      filters: { id: "root", type: "group", combinator: "and", children: [predicate("f1", "owner", "neq", "zoe")] } as ViewState["filters"],
    },
  },
  // The filter on the hidden column still holds inside the or group.
  W45: {
    rows: () =>
      ledgerRows([
        { owner: "Ann", cleared: true },
        { owner: "Bo", cleared: false },
        { owner: "Cy", cleared: null },
      ]),
    state: {
      ...base,
      visibleColumnIds: visible.filter((id) => id !== "cleared"),
      filters: {
        id: "root",
        type: "group",
        combinator: "or",
        children: [predicate("f1", "cleared", "eq", true), predicate("f2", "owner", "eq", "bo")],
      } as ViewState["filters"],
    },
  },
};

/** The ids a Data Query returns for `state` on `rows`: in order, or as a sorted set. */
const idsFrom = (query: DataQueryModule, rows: Array<Record<string, unknown>>, state: ViewState, ordered: boolean): unknown[] => {
  const db = query.openRowsDatabase(ledgerSchema, rows);
  try {
    const ids = query.readRows(db, ledgerSchema, state, { offset: 0, size: rows.length }).rows.map((row) => row.entry_number);
    return ordered ? ids : [...ids].sort();
  } finally {
    db.close();
  }
};

/** A schema whose enum labels sort in another order than its IDs, for W30. The ledger's and the wealth's sort alike. */
const kindsSchema = defineSchema(
  [
    { id: "ref", label: "Reference" },
    { id: "kind", label: "Kind" },
    { id: "units", label: "Units" },
  ],
  {
    id: "kinds",
    version: "1",
    columns: {
      kind: {
        kind: "enum",
        enumValues: [
          { id: "bravo", label: "Alpha" },
          { id: "alpha", label: "Zulu" },
          { id: "charlie", label: "Mike" },
        ],
      },
      units: { kind: "number" },
    },
  },
);

const SLOW = 120_000;

describe("the Query Check against the second held-out set, round 1", () => {
  let dir = "";
  let paths = new Map<string, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gridcue-query-second-1-"));
    paths = writeMutants(dir, [...WRONG, ...RIGHT]);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const load = async (id: string) => (await import(/* @vite-ignore */ paths.get(id) as string)) as DataQueryModule;

  it("every wrong Data Query is listed once: caught, or W30; and each once missed has its probe", () => {
    const listed = [...Object.keys(CAUGHT), "W30"];
    expect(listed.sort()).toEqual(WRONG.map((m) => m.id).sort());
    for (const id of Object.keys(ONCE_MISSED)) {
      expect(CAUGHT, id).toHaveProperty(id);
      expect(PROBES, id).toHaveProperty(id);
    }
  });

  it(
    "the example's query passes every case, on both schemas, with limit.set listed and without",
    () => {
      for (const { schema, id } of Object.values(SCHEMAS)) {
        for (const counts of [true, false]) expect(runCheck(schema, id, example, counts).failures).toEqual([]);
      }
    },
    SLOW,
  );

  for (const mutant of WRONG.filter((m) => m.id in CAUGHT)) {
    const [schemaName, rule] = CAUGHT[mutant.id] as readonly [SchemaName, string];
    it(
      `${mutant.id}: ${mutant.rule} (caught on the ${schemaName} schema)`,
      async () => {
        const { schema, id } = SCHEMAS[schemaName];
        const { failures } = runCheck(schema, id, await load(mutant.id), true);
        expect(failures.map((f) => f.name).filter((name) => name.startsWith(rule))).not.toEqual([]);
      },
      SLOW,
    );
  }

  for (const mutant of WRONG.filter((m) => CAUGHT_WITHOUT_COUNTS.has(m.id))) {
    it(
      `${mutant.id}: caught with limit.set left out too`,
      async () => {
        const { schema, id } = SCHEMAS[(CAUGHT[mutant.id] as readonly [SchemaName, string])[0]];
        expect(runCheck(schema, id, await load(mutant.id), false).failures).not.toEqual([]);
      },
      SLOW,
    );
  }

  // Once missed: no case held a View State that told these from the example's query. Each is caught on both schemas now.
  for (const mutant of WRONG.filter((m) => m.id in ONCE_MISSED)) {
    it(
      `${mutant.id}: ${mutant.rule} (once missed, now caught on both schemas: a case holds ${ONCE_MISSED[mutant.id]})`,
      async () => {
        const query = await load(mutant.id);
        for (const { schema, id } of [SCHEMAS.ledger, SCHEMAS.wealth]) {
          expect(runCheck(schema, id, query, true).failures).not.toEqual([]);
        }
      },
      SLOW,
    );
  }

  for (const mutant of WRONG.filter((m) => m.id in PROBES)) {
    const probe = PROBES[mutant.id] as Probe;
    it(`${mutant.id}: ${mutant.rule} (the Data Query is wrong: it keeps rows or an order applyView doesn't)`, async () => {
      const rows = probe.rows();
      const ordered = probe.ordered ?? false;
      const kept = applyView(rows, probe.state, ledgerSchema).rows.map((row) => row.entry_number);
      const want = ordered ? kept : [...kept].sort();
      expect(idsFrom(example, rows, probe.state, ordered)).toEqual(want);
      expect(idsFrom(await load(mutant.id), rows, probe.state, ordered)).not.toEqual(want);
    });
  }

  it(
    "W30: on the ledger and wealth schemas the labels sort as the IDs do, so sorting by them is right there: every case passes",
    async () => {
      // It differs from the example's query only in where an empty enum cell sorts (its CASE reads empty text as no
      // value), which ruling R3 leaves to the Host.
      const query = await load("W30");
      for (const { schema, id } of Object.values(SCHEMAS)) {
        for (const counts of [true, false]) expect(runCheck(schema, id, query, counts).failures).toEqual([]);
      }
    },
    SLOW,
  );

  it(
    "W30: an enum sorts by its values' IDs, not their labels (caught on a schema whose labels sort another way)",
    async () => {
      expect(runCheck(kindsSchema, "ref", example, true).failures).toEqual([]);
      const { failures } = runCheck(kindsSchema, "ref", await load("W30"), true);
      expect(failures.map((f) => f.name).filter((name) => name.startsWith(ENUM_IDS))).not.toEqual([]);
    },
    SLOW,
  );

  for (const mutant of RIGHT) {
    it(
      `${mutant.id}: ${mutant.rule} (a right Data Query: every case passes, on both schemas, with limit.set listed and without)`,
      async () => {
        const query = await load(mutant.id);
        for (const { schema, id } of Object.values(SCHEMAS)) {
          for (const counts of [true, false]) {
            const { cases, failures } = runCheck(schema, id, query, counts);
            expect(cases).toBeGreaterThan(40);
            expect(failures).toEqual([]);
          }
        }
      },
      SLOW,
    );
  }

  it(
    "V20: at a cut between two values, RANK (W1) and the rows ahead of the next row's value (W4) keep the right rows",
    async () => {
      for (const id of ["W1", "W4"]) {
        const query = await load(id);
        for (const { schema, id: key } of Object.values(SCHEMAS)) {
          const { failures } = runCheck(schema, key, query, true);
          expect(failures.filter((f) => CLEAN_CUT_CASES.some((name) => f.name.startsWith(name)))).toEqual([]);
          // They fail only where the cut falls inside a run of rows that tie: on the one sorted column, beside a filter
          // or not, or on the sorted columns before the last, where a run of rows that also tie on the last may
          // straddle the cut. Every such case's name starts the same way.
          expect(failures.filter((f) => !f.name.startsWith(CUT_INSIDE_TIES))).toEqual([]);
          expect(failures.filter((f) => f.name.startsWith(TIED) || f.name.startsWith(NEXT_DECIDES))).not.toEqual([]);
        }
      }
    },
    SLOW,
  );
});
