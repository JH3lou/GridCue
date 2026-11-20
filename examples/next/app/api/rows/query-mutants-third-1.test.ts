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
import { PROBES, type Probe, RIGHT, WRONG } from "./query-mutants-third-1";

/**
 * The third held-out check of the Query Check, round 1: the pairs promise (more grids spec 5.5, "Pairs, and no more").
 * Each Data Query is the example's (query.ts) with one choice made another way (query-mutants-third-1.ts). A wrong one
 * is right until one condition holds, and the Query Check must fail it on a case whose name is about the rule it
 * breaks. A right one must pass every case on both schemas, with `limit.set` listed and without.
 *
 * Outside the promise, and so not tested: the list's Data Queries that are wrong only where TWO conditions meet. What
 * the Query Check did with each when the list was first run (ledger and wealth, with `limit.set` listed):
 *
 * | Id     | Wrong only when                                   | What it does                       | Caught |
 * | ------ | ------------------------------------------------- | ---------------------------------- | ------ |
 * | T301   | an eq filter, and the first sort goes up          | drops every sort                   | yes    |
 * | T302   | an or group, and a hidden sorted column           | leaves the hidden sort out         | yes    |
 * | T303   | an eq filter, on a hidden column                  | drops the filter                   | yes    |
 * | T304   | an in filter, and the first sort goes down        | a count keeps one row more         | yes    |
 * | T305   | a contains filter, inside an or group             | matches by case                    | no     |
 * | T306   | an and group in an or, and the first sort down    | turns the later sorts round        | yes    |
 * | T307   | a gt filter, on a hidden column                   | a count keeps one row more         | ledger |
 * | T308   | an isEmpty filter, and a yes/no first sort        | keeps the first sort only          | no     |
 * | T309   | a neq filter, and a text first sort               | sorts capitals first               | no     |
 * | T310   | a between filter, and the first sort goes up      | a count cuts by the first sort     | yes    |
 * | T-W337 | a hidden sorted column, and it goes down          | sorts it going up                  | yes    |
 *
 * Eight of the eleven are caught, T307 on the ledger schema only.
 */

type SchemaName = "ledger" | "wealth";
const SCHEMAS: Record<SchemaName, { schema: ViewSchema; id: string }> = {
  ledger: { schema: ledgerSchema, id: "entry_number" },
  wealth: { schema: wealthSchema, id: "account_number" },
};

// The rules about sorting and counting, as the Query Check names them beside one filter.
const SORT = "a sort beside a filter still orders the rows";
const TWO_SORTS = "two sorts beside a filter order the rows by each in turn";
const COUNT = "a count beside a filter still keeps only its first rows";
const TIED = "a count that cuts inside tied rows beside a filter keeps its number of rows";
const TWO_SORT_CUT =
  "a count that cuts inside rows that tie on the first sorted column beside a filter keeps the ones the next sorted column puts first";
/** The same rule beside an or group, or beside a filter on a hidden column. */
const besideOr = (rule: string) => rule.replace("beside a filter", "beside an or group");
const besideHidden = (rule: string) => rule.replace("beside a filter", "beside a filter on a hidden column");
const TIED_ALONE =
  "a count that cuts inside tied rows keeps its number of rows: every row ahead of the tie, none behind it, and any of the tied";
const EACH_IN_TURN = "sorts by each column in turn, in its direction";

/**
 * Where each wrong Data Query is caught, with `limit.set` listed: the start of the name of a case that fails, which
 * names the rule the Data Query breaks. Every one is caught on the ledger schema, and every one but W332 on the wealth
 * schema too (the wealth schema has no date column).
 */
const CAUGHT: Record<string, string> = {
  // eq: the order by one sort; a count that cuts inside tied rows.
  W301: SORT,
  W302: TIED,
  // neq: the order by one sort; the first rows of a count.
  W303: SORT,
  W304: COUNT,
  // in: the order by two sorts; a count that cuts inside tied rows.
  W305: TWO_SORTS,
  W306: TIED,
  // gt, lte: the order by two sorts; the first rows of a count.
  W307: TWO_SORTS,
  W308: COUNT,
  // between: a two-sort count cut inside rows that tie on the first; the order by one sort.
  W309: TWO_SORT_CUT,
  W310: SORT,
  // contains: the order by one sort; a count that cuts inside tied rows.
  W311: SORT,
  W312: TIED,
  // startsWith: the order by two sorts; the first rows of a count.
  W313: TWO_SORTS,
  W314: COUNT,
  // isEmpty: the order by one sort; a count that cuts inside tied rows.
  W315: SORT,
  W316: TIED,
  // isNotEmpty: the order by two sorts; the first rows of a count.
  W317: TWO_SORTS,
  W318: COUNT,
  // An or group: the order by two sorts; a count that cuts inside tied rows.
  W319: besideOr(TWO_SORTS),
  W320: besideOr(TIED),
  // An or group inside an and: the order by one sort; a two-sort count cut inside rows that tie on the first.
  W321: besideOr(SORT),
  W322: besideOr(TWO_SORT_CUT),
  // An and group inside an or: the order by one sort; the first rows of a count. The only cases that sort or count
  // beside this shape of group are the ones whose filters sit on hidden columns, so those are the names that fail.
  W323: besideHidden(SORT),
  W324: besideHidden(COUNT),
  // A filter on a hidden column: the order by one sort; a count that cuts inside tied rows.
  W325: besideHidden(SORT),
  W326: besideHidden(TIED),
  // The first sort going up: a count that cuts inside tied rows, kept whole and dropped whole.
  W327: TIED_ALONE,
  W328: TIED_ALONE,
  // The first sort going down: the order by two sorts; the first rows of a count.
  W329: EACH_IN_TURN,
  W330: "a count keeps the first rows of the sorted, filtered rows",
  // The first sorted column's kind: yes/no, date, text, enum.
  W331: TWO_SORTS,
  W332: EACH_IN_TURN,
  W333: "text sorts by its letters, ignoring case",
  W334: "an enum sorts by its values' IDs, ignoring case",
  // A hidden sorted column: second, first, and in a count's cut.
  W335: "a second sort on a hidden column still orders the rows",
  W336: "a sort on a hidden column still orders the rows",
  W339: "a count still sorts by a hidden second column",
  // A filter on a hidden column, left out.
  W338: "a filter on a hidden column still holds",
};

/** The wrong Data Queries also caught with `limit.set` left out: each changes an order or a filter, not only a count. */
const CAUGHT_WITHOUT_COUNTS: ReadonlySet<string> = new Set([
  "W301",
  "W303",
  "W305",
  "W307",
  "W310",
  "W311",
  "W313",
  "W315",
  "W317",
  "W319",
  "W321",
  "W323",
  "W325",
  "W329",
  "W331",
  "W332",
  "W333",
  "W334",
  "W335",
  "W336",
  "W338",
]);

/** The right Data Queries that change nothing: each is a choice the example's own query already makes. */
const OWN_CHOICE: ReadonlySet<string> = new Set(["V303", "V304", "V314"]);

const visible = ledgerSchema.columns.map((c) => c.id);
const base = emptyViewState(visible);
/** Ledger rows from the Query Check's own rows, with their ids and the cells given. */
const ledgerRows = (cells: ReadonlyArray<Record<string, unknown>>) => {
  const rows = queryCheck(ledgerSchema, { id: "entry_number" }).rows;
  return cells.map((cell, i) => ({ ...rows[i], entry_number: String(i + 1), ...cell }));
};
const stateOf = (probe: Probe): ViewState => ({
  ...base,
  visibleColumnIds: visible.filter((id) => !(probe.hidden ?? []).includes(id)),
  ...probe.state,
});
const inOrder = (probe: Probe, ids: unknown[]): unknown[] => (probe.ordered ? ids : [...ids].sort());

/** The ids a Data Query returns for a probe: in order, or as a sorted set. */
const idsFrom = (query: DataQueryModule, probe: Probe): unknown[] => {
  const rows = ledgerRows(probe.cells);
  const db = query.openRowsDatabase(ledgerSchema, rows);
  try {
    const read = query.readRows(db, ledgerSchema, stateOf(probe), { offset: 0, size: rows.length });
    return inOrder(
      probe,
      read.rows.map((row) => row.entry_number),
    );
  } finally {
    db.close();
  }
};

/** What applyView keeps for a probe: in order, or as a sorted set. */
const wanted = (probe: Probe): unknown[] =>
  inOrder(
    probe,
    applyView(ledgerRows(probe.cells), stateOf(probe), ledgerSchema).rows.map((row) => row.entry_number),
  );

const SLOW = 120_000;

describe("the Query Check against the third held-out set, round 1: the pairs promise", () => {
  let dir = "";
  let paths = new Map<string, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gridcue-query-third-1-"));
    paths = writeMutants(dir, [...WRONG, ...RIGHT]);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const load = async (id: string) => (await import(/* @vite-ignore */ paths.get(id) as string)) as DataQueryModule;

  it("every Data Query listed as wrong is caught, and has a probe", () => {
    expect(Object.keys(CAUGHT).sort()).toEqual(WRONG.map((m) => m.id).sort());
    expect(Object.keys(PROBES).sort()).toEqual(WRONG.map((m) => m.id).sort());
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

  for (const mutant of WRONG) {
    const probe = PROBES[mutant.id] as Probe;
    it(`${mutant.id}: ${mutant.rule} (the Data Query is wrong: it keeps rows or an order applyView doesn't)`, async () => {
      const want = wanted(probe);
      expect(idsFrom(example, probe)).toEqual(want);
      expect(idsFrom(await load(mutant.id), probe)).not.toEqual(want);
    });

    const rule = CAUGHT[mutant.id] as string;
    it(
      `${mutant.id}: ${mutant.rule} (caught on the ledger schema)`,
      async () => {
        const { schema, id } = SCHEMAS.ledger;
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
        const { schema, id } = SCHEMAS.ledger;
        expect(runCheck(schema, id, await load(mutant.id), false).failures).not.toEqual([]);
      },
      SLOW,
    );
  }

  it("V303, V304 and V314 are the example's own choices: they change nothing in its query", () => {
    expect(RIGHT.filter((m) => m.edits.length === 0).map((m) => m.id)).toEqual([...OWN_CHOICE]);
  });

  for (const mutant of RIGHT.filter((m) => !OWN_CHOICE.has(m.id))) {
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
