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
import { RIGHT, W224, WRONG } from "./query-mutants-second-3";

/**
 * The second held-out check of the Query Check, round 3. Each Data Query is the example's (query.ts) with one choice
 * made another way (query-mutants-second-3.ts). The Query Check must fail each wrong one on a case whose name is about
 * the rule it breaks, and pass each right one on both schemas, with `limit.set` listed and without. Two of the list are
 * held to what the rulings say today, each with a probe that shows what it does: W220, which a later ruling makes a
 * right Data Query, and W224, which waits on the owner.
 */

type SchemaName = "ledger" | "wealth";
const SCHEMAS: Record<SchemaName, { schema: ViewSchema; id: string }> = {
  ledger: { schema: ledgerSchema, id: "entry_number" },
  wealth: { schema: wealthSchema, id: "account_number" },
};

const THIRD_DECIDES = "a count that cuts inside rows that tie on the first two sorted columns keeps the ones the third puts first";
const OR_COUNT = "a count beside an or group still keeps only its first rows";
const HIDDEN_IN_OR = "a filter on a hidden column still holds in an or group inside an and";
const TEXT_ORDER = "text sorts by its letters, ignoring case";
const FIRST_ROWS = "a count keeps the first rows of the sorted, filtered rows";
const TWO_SORTS_BESIDE_OR = "two sorts beside an or group order the rows by each in turn";

/** Where each caught wrong Data Query is caught, with `limit.set` listed, and the start of the name of a case that catches it. */
const CAUGHT: Record<string, readonly [SchemaName, string]> = {
  // Class 1: a count cut by fewer than all of three sorts.
  W201: ["ledger", THIRD_DECIDES],
  W202: ["ledger", THIRD_DECIDES],
  W204: ["ledger", THIRD_DECIDES],
  W205: ["ledger", THIRD_DECIDES],
  // Class 2 and 3: sorts and a count beside an or group.
  W207: ["ledger", "two sorts beside an or group order the rows by each in turn"],
  W209: ["ledger", OR_COUNT],
  W210: ["ledger", OR_COUNT],
  W211: ["ledger", OR_COUNT],
  // Class 4: a filter on a hidden column in an or group inside an and. W212 is caught on the ledger schema only.
  W212: ["ledger", HIDDEN_IN_OR],
  W213: ["ledger", HIDDEN_IN_OR],
  // Class 5: a hidden sort column in a count's cut.
  W215: ["ledger", "a count still sorts by a hidden column"],
  W216: ["ledger", "a count still sorts by a hidden second column"],
  // Class 6: text order.
  W218: ["ledger", TEXT_ORDER],
  W219: ["ledger", TEXT_ORDER],
  // Class 7: other counting habits.
  W222: ["ledger", FIRST_ROWS],
  W223: ["ledger", FIRST_ROWS],
  // Missed by round 3's cases, found again by the review of the second round. Each class now has its own cases.
  W203: ["ledger", "a count that cuts inside rows that tie on the first three sorted columns keeps the ones the fourth puts first"],
  W206: ["ledger", TWO_SORTS_BESIDE_OR],
  W208: ["ledger", TWO_SORTS_BESIDE_OR],
  W214: ["ledger", "a filter on a hidden column still holds in an and group inside an or"],
  W217: ["ledger", "a count still sorts by a hidden third column"],
  W221: ["ledger", "a count sorted by text keeps its first rows by its letters, ignoring case"],
};

/** The caught wrong Data Queries also caught with `limit.set` left out: each changes more than a count. */
const CAUGHT_WITHOUT_COUNTS: ReadonlySet<string> = new Set(["W206", "W207", "W208", "W212", "W213", "W214", "W218", "W219"]);

/**
 * W225 loses a row between pages. No case is named for paging: every case reads its rows in pages of 7 too, and the
 * paged read of each case fails, with or without `limit.set`.
 */
const CAUGHT_BY_PAGES = "W225";

/**
 * Listed as wrong, and right by a later ruling. W220 orders text with its spaces taken out, as a collation that skips
 * spaces at first does (PostgreSQL's default libc collation in en_US.UTF-8, or ICU's "shifted"). The more grids spec,
 * 5.5, "Text order beyond the letters A to Z", makes it a right Data Query: where a space sorts against a letter is the
 * Host's collation's own. So the Query Check must pass it, and no two texts whose order it checks differ first at a
 * space.
 */
const RIGHT_BY_RULING: Record<string, string> = {
  W220: "where a space sorts against a letter is the Host's collation's own",
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
const group = (id: string, combinator: "and" | "or", children: unknown[]) => ({ id, type: "group" as const, combinator, children });
const filters = (root: ReturnType<typeof group>) => root as ViewState["filters"];

type Probe = { rows: () => Array<Record<string, unknown>>; state: ViewState; ordered?: boolean };

/** Data F1 of the held-out list. */
const F1 = () =>
  ledgerRows([
    { category: "fees", units: 2, amount: 10, owner: "Zed" },
    { category: "fees", units: 2, amount: 40, owner: "Amy" },
    { category: "fees", units: 5, amount: 41, owner: "Bob" },
    { category: "travel", units: 1, amount: 90, owner: "Cy" },
    { category: "travel", units: 7, amount: 45, owner: "Dee" },
    { category: "supplies", units: 3, amount: 60, owner: "Eve" },
  ]);
const categoryThenAmountDown = [
  { columnId: "category", direction: "asc" as const },
  { columnId: "amount", direction: "desc" as const },
];

/**
 * For each Data Query the check once missed, and for W220, rows and a View State on which it keeps rows, or an order,
 * that applyView doesn't.
 */
const PROBES: Record<string, Probe> = {
  // Of the three rows that tie on three sorts, the count keeps the two the fourth (owner) puts first: Amy and Cy.
  W203: {
    rows: () =>
      ledgerRows([
        { category: "fees", units: 1, amount: 10, owner: "Zed" },
        { category: "fees", units: 1, amount: 10, owner: "Amy" },
        { category: "fees", units: 1, amount: 10, owner: "Cy" },
        { category: "travel", units: 1, amount: 10, owner: "Bo" },
      ]),
    state: {
      ...base,
      sorts: [
        { columnId: "category", direction: "asc" },
        { columnId: "units", direction: "asc" },
        { columnId: "amount", direction: "desc" },
        { columnId: "owner", direction: "asc" },
      ],
      limit: 2,
    },
  },
  // The fees rows come by amount, going down, beside the or group inside the and.
  W206: {
    rows: F1,
    state: {
      ...base,
      filters: filters(
        group("root", "and", [
          predicate("f1", "units", "gte", 2),
          group("g1", "or", [predicate("f2", "amount", "gt", 50), predicate("f3", "category", "eq", "fees")]),
        ]),
      ),
      sorts: categoryThenAmountDown,
    },
    ordered: true,
  },
  // Both sorts order the rows beside an or group of three filters.
  W208: {
    rows: F1,
    state: {
      ...base,
      filters: filters(
        group("root", "or", [
          predicate("f1", "amount", "gt", 50),
          predicate("f2", "category", "eq", "fees"),
          predicate("f3", "units", "gte", 7),
        ]),
      ),
      sorts: categoryThenAmountDown,
    },
    ordered: true,
  },
  // The filter on the hidden amount holds in the and inside the or: Ann and Bo are left out.
  W214: {
    rows: () =>
      ledgerRows([
        { owner: "Ann", category: "fees", amount: 5 },
        { owner: "Bo", category: "fees", amount: 80 },
        { owner: "Cy", category: "travel", amount: 90 },
        { owner: "Di", category: "travel", amount: 10 },
        { owner: "Ed", category: "fees", amount: 95 },
      ]),
    state: {
      ...base,
      visibleColumnIds: visible.filter((id) => id !== "amount"),
      filters: filters(
        group("root", "or", [
          predicate("f1", "owner", "eq", "di"),
          group("g1", "and", [predicate("f2", "amount", "gt", 85), predicate("f3", "category", "eq", "fees")]),
        ]),
      ),
    },
  },
  // The count cuts by the hidden third sort too: of the three tied fees rows, the two with the fewest units.
  W217: {
    rows: () =>
      ledgerRows([
        { category: "fees", amount: 10, units: 3 },
        { category: "fees", amount: 10, units: 1 },
        { category: "fees", amount: 10, units: 2 },
        { category: "travel", amount: 10, units: 1 },
      ]),
    state: {
      ...base,
      visibleColumnIds: visible.filter((id) => id !== "units"),
      sorts: [
        { columnId: "category", direction: "asc" },
        { columnId: "amount", direction: "desc" },
        { columnId: "units", direction: "asc" },
      ],
      limit: 2,
    },
  },
  // In applyView a space sorts before a letter: "Al Fen", "Alder", "Alf". With its spaces taken out, "Alder" comes
  // first. Both orders are right (spec 5.5, "Text order beyond the letters A to Z").
  W220: {
    rows: () => ledgerRows([{ owner: "Al Fen" }, { owner: "Alder" }, { owner: "Alf" }]),
    state: { ...base, sorts: [{ columnId: "owner", direction: "asc" }] },
    ordered: true,
  },
  // The first two by their letters are alpha and bravo; by character code, Charlie comes first.
  W221: {
    rows: () => ledgerRows([{ owner: "alpha" }, { owner: "Charlie" }, { owner: "bravo" }]),
    state: { ...base, sorts: [{ columnId: "owner", direction: "asc" }], limit: 2 },
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

const SLOW = 120_000;

describe("the Query Check against the second held-out set, round 3", () => {
  let dir = "";
  let paths = new Map<string, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gridcue-query-second-3-"));
    paths = writeMutants(dir, [...WRONG, W224, ...RIGHT]);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const load = async (id: string) => (await import(/* @vite-ignore */ paths.get(id) as string)) as DataQueryModule;

  it("every Data Query listed as wrong is listed once: caught, or right by a later ruling, with a probe", () => {
    expect([...Object.keys(CAUGHT), CAUGHT_BY_PAGES, ...Object.keys(RIGHT_BY_RULING)].sort()).toEqual(WRONG.map((m) => m.id).sort());
    for (const id of Object.keys(RIGHT_BY_RULING)) expect(PROBES, id).toHaveProperty(id);
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

  it(
    "W225: a paged result is the whole result cut in pieces (caught when the pages are read, on both schemas, with limit.set listed and without)",
    async () => {
      const query = await load(CAUGHT_BY_PAGES);
      for (const { schema, id } of Object.values(SCHEMAS)) {
        for (const counts of [true, false]) {
          const { failures } = runCheck(schema, id, query, counts);
          expect(failures).not.toEqual([]);
          expect(failures.filter((f) => !f.message.startsWith("in pages of 7, "))).toEqual([]);
        }
      }
    },
    SLOW,
  );

  // W220 sorts text with its spaces taken out. Spec 5.5's "Text order beyond the letters A to Z" makes that right: where
  // a space sorts against a letter is the Host's collation's own. So every case passes it, on both schemas.
  for (const mutant of WRONG.filter((m) => m.id in RIGHT_BY_RULING)) {
    it(
      `${mutant.id}: text sorted with its spaces taken out passes every case, on both schemas, with limit.set listed and without (${RIGHT_BY_RULING[mutant.id]})`,
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

  for (const mutant of WRONG.filter((m) => m.id in PROBES)) {
    const probe = PROBES[mutant.id] as Probe;
    // A Data Query that a later ruling makes right is named for what it does, not for the list's withdrawn rule.
    const name =
      mutant.id in RIGHT_BY_RULING
        ? `${mutant.id}: text sorted with its spaces taken out gives an order applyView doesn't, and ${RIGHT_BY_RULING[mutant.id]}`
        : `${mutant.id}: ${mutant.rule} (the Data Query is wrong: it keeps rows or an order applyView doesn't)`;
    it(name, async () => {
      const rows = probe.rows();
      const ordered = probe.ordered ?? false;
      const want = wanted(probe);
      expect(idsFrom(example, rows, probe.state, ordered)).toEqual(want);
      expect(idsFrom(await load(mutant.id), rows, probe.state, ordered)).not.toEqual(want);
    });
  }

  // W224 reads one row more on each page, never past the count. It loses no row, and `compare` counts a repeated id
  // once. Whether `compare` fails on a repeated id is the owner's open decision (ruling R5), so this test holds what
  // the check does today: it passes, and since no page reads past the count, with limit.set listed too.
  it(
    "W224: the check passes a Data Query that reads a row on two pages and loses none, when limit.set is not listed, and when it is",
    async () => {
      const query = await load(W224.id);
      for (const { schema, id } of Object.values(SCHEMAS)) {
        for (const counts of [false, true]) {
          const { cases, failures } = runCheck(schema, id, query, counts);
          expect(cases).toBeGreaterThan(40);
          expect(failures).toEqual([]);
        }
      }
    },
    SLOW,
  );

  it("W224: reads a row twice where two pages meet, and loses none", async () => {
    const query = await load(W224.id);
    const rows = ledgerRows([1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ amount: 90 - n })));
    const state: ViewState = { ...base, sorts: [{ columnId: "amount", direction: "desc" }] };
    const db = query.openRowsDatabase(ledgerSchema, rows);
    try {
      const paged = [0, 3, 6].flatMap((offset) =>
        query.readRows(db, ledgerSchema, state, { offset, size: 3 }).rows.map((row) => row.entry_number),
      );
      expect(paged).toEqual(["1", "2", "3", "4", "4", "5", "6", "7", "7", "8"]);
    } finally {
      db.close();
    }
  });

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
});
