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
import type { DataQueryModule } from "./query-check-run";
import { writeMutants } from "./query-mutants";
import { runCheck } from "./query-mutants-second-1";
import { RIGHT, WRONG } from "./query-mutants-second-2";

/**
 * The second held-out check of the Query Check, round 2. Each Data Query is the example's (query.ts) with one choice
 * made another way (query-mutants-second-2.ts). The Query Check must fail each wrong one on a case whose name is about
 * the rule it breaks, and pass each right one on both schemas, with `limit.set` listed and without. What it still
 * misses is marked `it.fails`, with a probe that proves the Data Query wrong against applyView.
 */

type SchemaName = "ledger" | "wealth";
const SCHEMAS: Record<SchemaName, { schema: ViewSchema; id: string }> = {
  ledger: { schema: ledgerSchema, id: "entry_number" },
  wealth: { schema: wealthSchema, id: "account_number" },
};

const NEXT_DECIDES = "a count that cuts inside rows that tie on the first sorted column keeps the ones the next sorted column puts first";
const COUNT_EMPTY_LATER = "a count keeps a row with an empty cell in a later sorted column";
const OR_SORT = "a sort beside an or group still orders the rows";

/** Where each caught wrong Data Query is caught, with `limit.set` listed, and the start of the name of a case that catches it. */
const CAUGHT: Record<string, readonly [SchemaName, string]> = {
  W102: ["ledger", NEXT_DECIDES],
  W103: ["ledger", NEXT_DECIDES],
  W104: ["ledger", COUNT_EMPTY_LATER],
  W105: ["ledger", COUNT_EMPTY_LATER],
  W106: ["ledger", "a count keeps a row with no value in a later sorted column"],
  W107: ["ledger", OR_SORT],
  W109: ["ledger", OR_SORT],
  W111: ["ledger", "in a list keeps é and e apart"],
  W112: ["ledger", "starts with keeps é and e apart"],
  W113: ["ledger", "not equal keeps é and e apart"],
  W114: ["ledger", "equal ignores case on text"],
  W115: ["ledger", "a filter on a hidden column still holds in an or group"],
  W118: ["ledger", "numbers sort by their value, not as text"],
  // No case is named for numbers sorting as numbers under a count: the count cases catch it.
  W119: ["ledger", "a count"],
  // Caught when the pages are read: the count's last page comes up a row short. No case is named for paging alone.
  W120: ["ledger", "a count"],
  W121: ["ledger", "a count"],
  // Missed by the first round's cases. Each class now has its own cases, for every column of its kind.
  W101: ["ledger", "a count that cuts inside rows that tie on the first two sorted columns keeps the ones the third puts first"],
  W108: ["ledger", "two sorts beside an or group order the rows by each in turn"],
  W110: ["ledger", "a count beside an or group still keeps only its first rows"],
  W116: ["ledger", "a filter on a hidden column still holds in an or group inside an and"],
  W117: ["ledger", "a count still sorts by a hidden column"],
  W122: ["ledger", "text sorts by its letters, ignoring case"],
};

/** The caught wrong Data Queries also caught with `limit.set` left out: each changes more than a count. */
const CAUGHT_WITHOUT_COUNTS: ReadonlySet<string> = new Set([
  "W107",
  "W108",
  "W109",
  "W111",
  "W112",
  "W113",
  "W114",
  "W115",
  "W116",
  "W118",
  "W122",
]);

/** Wrong Data Queries no case catches: each returns the example's ids on every case, on both schemas. None now. */
const MISSED: Record<string, string> = {};

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
const group = (id: string, combinator: "and" | "or", children: unknown[]) => ({ id, type: "group" as const, combinator, children });
const filters = (root: ReturnType<typeof group>) => root as ViewState["filters"];

type Probe = { rows: () => Array<Record<string, unknown>>; state: ViewState; ordered?: boolean };

const D9 = () =>
  ledgerRows([
    { category: "travel", units: 5, amount: 10, owner: "Zed" },
    { category: "fees", units: 3, amount: 20, owner: "Amy" },
    { category: "fees", units: 2, amount: 5, owner: "Bob" },
    { category: "fees", units: 1, amount: 99, owner: "Cy" },
    { category: "supplies", units: 4, amount: 7, owner: "Dee" },
  ]);
const unitsOrAmount = group("root", "or", [predicate("f1", "units", "gte", 2), predicate("f2", "amount", "gt", 90)]);

/** For each Data Query the check misses, rows and a View State on which it keeps rows, or an order, that applyView doesn't. */
const PROBES: Record<string, Probe> = {
  // Of the three rows that tie on category and units, the count keeps the two with the most amount.
  W101: {
    rows: () =>
      ledgerRows([
        { category: "fees", units: 1, amount: 2 },
        { category: "fees", units: 1, amount: 5 },
        { category: "fees", units: 1, amount: 9 },
        { category: "travel", units: 3, amount: 1 },
      ]),
    state: {
      ...base,
      sorts: [
        { columnId: "category", direction: "asc" },
        { columnId: "units", direction: "asc" },
        { columnId: "amount", direction: "desc" },
      ],
      limit: 2,
    },
  },
  // Both sorts order the rows beside the or group: the fees rows by amount, going down.
  W108: {
    rows: D9,
    state: {
      ...base,
      filters: filters(unitsOrAmount),
      sorts: [
        { columnId: "category", direction: "asc" },
        { columnId: "amount", direction: "desc" },
      ],
    },
    ordered: true,
  },
  // The count keeps two rows beside the or group.
  W110: {
    rows: D9,
    state: { ...base, filters: filters(unitsOrAmount), sorts: [{ columnId: "amount", direction: "desc" }], limit: 2 },
  },
  // The filter on the hidden column holds in the or group inside the and: Ann is kept.
  W116: {
    rows: () =>
      ledgerRows([
        { owner: "Ann", cleared: true },
        { owner: "Bo", cleared: false },
        { owner: "Cy", cleared: null },
      ]),
    state: {
      ...base,
      visibleColumnIds: visible.filter((id) => id !== "cleared"),
      filters: filters(
        group("root", "and", [
          predicate("f1", "owner", "neq", "cy"),
          group("g1", "or", [predicate("f2", "cleared", "eq", true), predicate("f3", "owner", "eq", "bo")]),
        ]),
      ),
    },
  },
  // The count sorts by the hidden amount too: of the two fees rows, the one with more.
  W117: {
    rows: () =>
      ledgerRows([
        { category: "fees", owner: "Zed", amount: 10 },
        { category: "fees", owner: "Amy", amount: 90 },
        { category: "travel", owner: "Bob", amount: 50 },
      ]),
    state: {
      ...base,
      visibleColumnIds: visible.filter((id) => id !== "amount"),
      sorts: [
        { columnId: "category", direction: "asc" },
        { columnId: "amount", direction: "desc" },
      ],
      limit: 1,
    },
  },
  // Ann comes before Bo, though it is longer.
  W122: {
    rows: () => ledgerRows([{ owner: "Bo" }, { owner: "Ann" }, { owner: "Cy" }]),
    state: { ...base, sorts: [{ columnId: "owner", direction: "asc" }] },
    ordered: true,
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

/** What applyView keeps for a probe: in order, or as a sorted set. */
const wanted = (probe: Probe): unknown[] => {
  const kept = applyView(probe.rows(), probe.state, ledgerSchema).rows.map((row) => row.entry_number);
  return probe.ordered ? kept : [...kept].sort();
};

/**
 * V106 is right only for a non-empty operand: "is not" empty text leaves out every empty cell, NULL among them, and
 * `lower(x) IS NOT ''` keeps NULL. These are the cases that ask for it.
 */
const EMPTY_NEQ = "not equal to empty text leaves out exactly the empty cells";

const SLOW = 120_000;

describe("the Query Check against the second held-out set, round 2", () => {
  let dir = "";
  let paths = new Map<string, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gridcue-query-second-2-"));
    paths = writeMutants(dir, [...WRONG, ...RIGHT]);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const load = async (id: string) => (await import(/* @vite-ignore */ paths.get(id) as string)) as DataQueryModule;

  it("every wrong Data Query is listed once: caught, or missed with a probe", () => {
    expect([...Object.keys(CAUGHT), ...Object.keys(MISSED)].sort()).toEqual(WRONG.map((m) => m.id).sort());
    for (const id of Object.keys(MISSED)) expect(PROBES, id).toHaveProperty(id);
  });

  it(
    "each wrong Data Query once missed is caught on the wealth schema too",
    async () => {
      for (const id of Object.keys(PROBES)) {
        const { schema, id: key } = SCHEMAS.wealth;
        expect(runCheck(schema, key, await load(id), true).failures, id).not.toEqual([]);
      }
    },
    SLOW,
  );

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

  // W120 reads a row twice on each page after the first. With no count it loses no row, and compare treats a repeated
  // id as one (ruling R5, still the owner's), so with limit.set left out no case catches it.
  it.fails(
    "W120: a paged result is the whole result cut in pieces (caught with limit.set left out: not yet)",
    async () => {
      expect(runCheck(ledgerSchema, "entry_number", await load("W120"), false).failures).not.toEqual([]);
    },
    SLOW,
  );

  // Missed: no case holds a View State that tells these from the example's query.
  for (const mutant of WRONG.filter((m) => m.id in MISSED)) {
    it.fails(
      `${mutant.id}: ${mutant.rule} (missed: ${MISSED[mutant.id]})`,
      async () => {
        const query = await load(mutant.id);
        for (const { schema, id } of Object.values(SCHEMAS)) {
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
      const want = wanted(probe);
      expect(idsFrom(example, rows, probe.state, ordered)).toEqual(want);
      expect(idsFrom(await load(mutant.id), rows, probe.state, ordered)).not.toEqual(want);
    });
  }

  for (const mutant of RIGHT.filter((m) => m.id !== "V106")) {
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

  // V106 was listed as right, but it is right only for a non-empty operand. The check is right to fail it, and fails it
  // only there.
  it(
    "V106: fails only where not equal asks for empty text, which keeps a NULL cell applyView leaves out",
    async () => {
      const query = await load("V106");
      for (const { schema, id } of Object.values(SCHEMAS)) {
        for (const counts of [true, false]) {
          const names = runCheck(schema, id, query, counts).failures.map((f) => f.name);
          expect(names.filter((name) => name.startsWith(EMPTY_NEQ))).not.toEqual([]);
          expect(names.filter((name) => !name.includes("is not “”"))).toEqual([]);
        }
      }
      const probe: Probe = {
        rows: () => ledgerRows([{ owner: null }, { owner: "" }, { owner: "Ann" }]),
        state: { ...base, filters: filters(group("root", "and", [predicate("f1", "owner", "neq", "")])) },
      };
      const want = wanted(probe);
      expect(want).toEqual(["3"]);
      expect(idsFrom(example, probe.rows(), probe.state, false)).toEqual(want);
      expect(idsFrom(query, probe.rows(), probe.state, false)).not.toEqual(want);
    },
    SLOW,
  );
});
