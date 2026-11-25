import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wealthSchema } from "@gridcue-internal/wealth-fixtures";
import type { ViewSchema } from "gridcue";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The ledger fixture is not a dependency of the example, so it comes in by path. It is synthetic.
import { ledgerSchema } from "../../../../../fixtures/ledger/src/index";
import { type DataQueryModule, type Failure, runQueryCheck } from "./query-check-run";
import { writeMutants } from "./query-mutants";
import { RIGHT_CHOICES, WRONG_CHOICES } from "./query-rulings";

/**
 * What is the Host's own, and what is not (more grids spec 5.5, `compare`). Each Data Query here is the example's with
 * one choice made another way (query-rulings.ts), as SQL a Host might write.
 *
 * - Rows that tie on every sort column may come in any order.
 * - A count that cuts inside a run of tied rows may keep any of the tied rows for its last places. It must keep every
 *   row ahead of the tied value, none behind it, and its number of rows in all.
 * - A row with an empty sort cell is checked by its leading sort columns that hold values. Where it sits among the rows
 *   that share those values is the Host's own.
 *
 * A right Data Query must never fail, so every right choice passes every case, read whole and in pages. Every wrong one
 * fails a case whose name states the rule it breaks.
 */

type SchemaName = "ledger" | "wealth" | "ledger with a New York calendar";
const SCHEMAS: Record<SchemaName, { schema: ViewSchema; id: string }> = {
  ledger: { schema: ledgerSchema, id: "entry_number" },
  wealth: { schema: wealthSchema, id: "account_number" },
  // With a Calendar time zone the date-and-time column holds clock times with no offset beside instants.
  "ledger with a New York calendar": { schema: { ...ledgerSchema, calendar: { timeZone: "America/New_York" } }, id: "entry_number" },
};

const TIED = "a count that cuts inside tied rows keeps its number of rows: every row ahead of the tie, none behind it, and any of the tied";
const LATER_EMPTY = "a row with no value in a later sorted column keeps its place by the columns before it";

/** For each wrong choice: the start of the name of a case that must catch it, and what its message must say. */
const CAUGHT: Record<string, readonly [rule: string, message: RegExp]> = {
  W1: [TIED, /: \d+ rows? came back, and the count asks for \d+$/],
  W2: [TIED, /: (\d+ rows? missing, ids? .*; )?\d+ rows? extra, ids? /],
  W3: [LATER_EMPTY, /: wrong order: id \S+ came before id \S+, which belongs ahead of it by /],
  W4: [LATER_EMPTY, /: wrong order: id \S+ came before id \S+, which belongs ahead of it by /],
  W5: [LATER_EMPTY, /: wrong order: id \S+ came before id \S+, which belongs ahead of it by /],
  W6: ["a sort beside a filter still orders the rows", /: wrong order: id \S+ came where id \S+ belongs$/],
  W7: [
    "a second sort on an enum orders the rows that tie on the first, by its values' IDs",
    /: wrong order: id \S+ came where id \S+ belongs$/,
  ],
  W8: ["equal keeps é and e apart", /: \d+ rows? extra, ids? /],
};
/** More cases a wrong choice must fail, each by the start of its name. */
const ALSO: Record<string, readonly string[]> = {
  // The right rows, put in order again after the count's cut: the count case fails on the order of the rows it keeps.
  W5: ["a count keeps a row with no value in a later sorted column"],
  W7: ["a second sort on text orders the rows that tie on the first, by its letters"],
  W8: ["contains keeps é and e apart"],
};

/** Each of these runs every case, twice, on two or three schemas: seconds, and more when the whole suite runs at once. */
const SLOW = 120_000;

describe("what a right Data Query may choose for itself, and what it may not", () => {
  let dir = "";
  let paths = new Map<string, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gridcue-query-rulings-"));
    paths = writeMutants(dir, [...RIGHT_CHOICES, ...WRONG_CHOICES]);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const load = async (id: string) => (await import(/* @vite-ignore */ paths.get(id) as string)) as DataQueryModule;

  it("every wrong choice is listed with the case that catches it", () => {
    expect(Object.keys(CAUGHT).sort()).toEqual(WRONG_CHOICES.map((m) => m.id).sort());
    expect(new Set([...RIGHT_CHOICES, ...WRONG_CHOICES].map((m) => m.id)).size).toBe(RIGHT_CHOICES.length + WRONG_CHOICES.length);
  });

  for (const choice of RIGHT_CHOICES) {
    it(
      `${choice.id}: ${choice.rule} (a right Data Query: every case passes, on every schema)`,
      async () => {
        const query = await load(choice.id);
        for (const [name, { schema, id }] of Object.entries(SCHEMAS)) {
          const { cases, failures } = runQueryCheck(schema, id, query);
          expect(cases, name).toBeGreaterThan(40);
          expect(failures, name).toEqual([]);
        }
      },
      SLOW,
    );
  }

  for (const choice of WRONG_CHOICES) {
    const [rule, message] = CAUGHT[choice.id] as readonly [string, RegExp];
    it(
      `${choice.id}: ${choice.rule} (a wrong Data Query: it fails “${rule}”, on both schemas)`,
      async () => {
        const query = await load(choice.id);
        for (const name of ["ledger", "wealth"] as const) {
          const { schema, id } = SCHEMAS[name];
          const { failures } = runQueryCheck(schema, id, query);
          const named = (start: string): Failure[] => failures.filter((f) => f.name.startsWith(start));
          expect(named(rule), name).not.toEqual([]);
          expect(
            named(rule).filter((f) => message.test(f.message)),
            `${name}: ${named(rule)
              .map((f) => f.message)
              .join("\n")}`,
          ).not.toEqual([]);
          for (const also of ALSO[choice.id] ?? []) expect(named(also), `${name}: ${also}`).not.toEqual([]);
        }
      },
      SLOW,
    );
  }
});
