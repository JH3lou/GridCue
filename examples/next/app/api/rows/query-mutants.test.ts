import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wealthSchema } from "@gridcue-internal/wealth-fixtures";
import type { ViewSchema } from "gridcue";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The ledger fixture is not a dependency of the example, so it comes in by path. It is synthetic.
import { ledgerSchema } from "../../../../../fixtures/ledger/src/index";
import { type DataQueryModule, runQueryCheck } from "./query-check-run";
import { MUTANTS, writeMutants } from "./query-mutants";

/**
 * Held-out mutants, round 1. Each is the example's Data Query with one rule translated wrong (query-mutants.ts). The
 * Query Check must fail at least one case for each, and the case's name must be about the rule the mutant breaks.
 */

type SchemaName = "ledger" | "wealth" | "ledger with a New York calendar";
const SCHEMAS: Record<SchemaName, { schema: ViewSchema; id: string }> = {
  ledger: { schema: ledgerSchema, id: "entry_number" },
  wealth: { schema: wealthSchema, id: "account_number" },
  // The ledger names no Calendar time zone, so the example reads days in the server's zone. Where that zone is UTC, a
  // day taken in UTC is the right day, and the mutants about time zones would not differ. With a Calendar they always do.
  "ledger with a New York calendar": { schema: { ...ledgerSchema, calendar: { timeZone: "America/New_York" } }, id: "entry_number" },
};

/** Where each mutant is caught, and the start of the name of a case that catches it: the rule it breaks. */
const CAUGHT: Record<string, readonly [SchemaName, string]> = {
  M1: ["ledger", "not equal keeps empty cells, and ignores case on text"],
  M2: ["ledger", "not equal keeps empty cells"],
  M3: ["ledger", "not equal keeps empty cells, and ignores case on text"],
  M5: ["ledger", "not equal keeps empty cells, and ignores case on text"],
  M6: ["ledger", "not equal to empty text leaves out exactly the empty cells"],
  M8: ["ledger", "equal ignores case on text"],
  M9: ["ledger", "equal ignores case on text"],
  M10: ["ledger", "in a list ignores case on text"],
  M11: ["ledger", "in a list ignores case on text"],
  // Caught through whitespace-only text, which a trim makes empty, and through the text with spaces around it.
  M12: ["ledger", "equal to empty text keeps exactly the empty cells"],
  M13: ["ledger", "equal keeps the spaces in what it asks for"],
  M14: ["ledger", "equal reads _ as plain text"],
  M15: ["ledger", "equal ignores case on text, and leaves out empty cells"],
  M16: ["ledger", "equal to empty text keeps exactly the empty cells"],
  M17: ["ledger", "equal to empty text keeps exactly the empty cells"],
  M18: ["ledger", "equal to empty text keeps exactly the empty cells"],
  M19: ["ledger", "in a list of empty text keeps exactly the empty cells"],
  M20: ["ledger", "equal is exact and leaves out empty cells"],
  M21: ["ledger", "no keeps only no and leaves out empty cells"],
  M23: ["ledger", "contains ignores case"],
  M24: ["ledger", "starts with ignores case, looks only at the start"],
  M25: ["ledger", "contains reads % as plain text"],
  M26: ["ledger", "contains reads _ as plain text"],
  M27: ["ledger", "starts with reads % as plain text"],
  M28: ["ledger", "starts with ignores case, looks only at the start"],
  M29: ["ledger", "contains empty text keeps every row, empty cells included"],
  M30: ["ledger", "contains empty text keeps every row, empty cells included"],
  M31: ["ledger", "starts with empty text keeps every row, empty cells included"],
  M32: ["ledger", "contains keeps the spaces in what it asks for"],
  M33: ["ledger", "contains ignores case, and leaves out empty cells"],
  M34: ["ledger", "greater than leaves out the value itself and empty cells"],
  M35: ["ledger", "less than leaves out the value itself and empty cells"],
  M36: ["ledger", "greater than or equal includes the value itself and leaves out empty cells"],
  M37: ["ledger", "less than or equal includes the value itself and leaves out empty cells"],
  M38: ["ledger", "greater than leaves out the value itself and empty cells"],
  M39: ["ledger", "less than leaves out the value itself and empty cells"],
  M41: ["ledger", "between includes both ends and leaves out empty cells"],
  M42: ["ledger", "between includes both ends and leaves out empty cells"],
  M43: ["ledger", "between includes both ends and leaves out empty cells"],
  M44: ["ledger", "between a range that holds zero leaves out empty cells, which are not zero"],
  M45: ["ledger", "between includes both ends and leaves out empty cells"],
  M46: ["ledger", "greater than leaves out the value itself and empty cells"],
  M47: ["ledger", "is empty keeps null and empty text, and leaves out whitespace-only and placeholder text"],
  M48: ["ledger", "is empty keeps only cells with no value"],
  M49: ["ledger", "is empty keeps null and empty text, and leaves out whitespace-only and placeholder text"],
  M51: ["ledger", "is empty keeps only cells with no value, and zero is a value"],
  M53: ["ledger", "is empty keeps null and empty text, and leaves out whitespace-only and placeholder text"],
  M54: ["ledger", "an or group keeps a row that either filter keeps"],
  M55: ["ledger", "filters on two columns must both hold"],
  M56: ["ledger", "a filter joined with and keeps its own brackets"],
  M57: ["ledger", "a filter joined with and keeps its own brackets"],
  M58: ["ledger", "a filter joined with and keeps its own brackets"],
  M59: ["ledger", "no filters keep every row"],
  M60: ["ledger", "filters on two columns must both hold"],
  M61: ["ledger", "two filters on one column must both hold"],
  M62: ["ledger", "after a date leaves out that whole day"],
  M63: ["ledger", "a date means the whole day"],
  M64: ["ledger", "on or before a date includes that whole day"],
  M65: ["ledger", "between includes both ends, each a whole day"],
  M66: ["ledger with a New York calendar", "after a date leaves out that whole day"],
  M67: ["ledger with a New York calendar", "a date means the whole day in the calendar's time zone"],
  M68: ["ledger with a New York calendar", "before a date leaves out that whole day"],
  // With a Calendar time zone the rows hold clock times with no offset beside instants, so this is caught whatever the
  // machine's own zone. On the plain ledger in a UTC zone, reading such a time as UTC is the right reading.
  M69: [
    "ledger with a New York calendar",
    "a date means the whole day in the calendar's time zone, and a time with no offset is on its own date",
  ],
  M70: ["ledger", "a date means the whole day"],
  M71: ["ledger", "after a date leaves out that whole day"],
  M72: ["ledger", "between includes both ends, each a whole day"],
  M75: ["ledger", "sorts by each column in turn, in its direction"],
  M76: ["ledger", "sorts by each column in turn, in its direction"],
  M77: ["ledger", "sorts by each column in turn, in its direction"],
  M78: ["ledger", "sorts by each column in turn, in its direction"],
  M79: ["ledger", "sorts by each column in turn, in its direction"],
  // The ledger sorts only by its date columns, so a number sorted as text shows on the wealth schema.
  M80: ["wealth", "sorts by each column in turn, in its direction"],
  M81: ["ledger", "text sorts by its letters, ignoring case"],
  M84: ["ledger", "a count keeps the first rows of the sorted, filtered rows"],
  M85: ["ledger", "a count keeps the first rows of the sorted, filtered rows"],
  M86: ["ledger", "a count keeps the first rows of the sorted, filtered rows"],
  M87: ["ledger", "a count keeps the first rows of the sorted, filtered rows"],
  M88: ["ledger", "a count keeps the first rows of the sorted, filtered rows"],
  M89: ["ledger", "a count never keeps a row with no value in the first sorted column"],
  M91: ["ledger", "a count never keeps a row with no value in the first sorted column (the first 76 rows, sorted by Owner"],
  M92: ["ledger", "a count never keeps a row with no value in the first sorted column"],
  M93: ["ledger", "a sort with no count keeps the rows with no value"],
  // A page from the wrong offset loses rows in every case. No case is about paging: the run pages, the check doesn't.
  M95: ["ledger", "equal ignores case on text"],
  M96: ["ledger", "a filter on a hidden column still holds"],
  M97: ["ledger", "equal ignores case on text"],
  // No case is about ids: every case that keeps some rows but not all fails.
  M98: ["ledger", "equal ignores case on text"],
};

// Each test reads every case twice: seconds, and more when the whole suite runs at once.
describe("the Query Check catches a Data Query that translates a rule wrong", { timeout: 120_000 }, () => {
  let dir = "";
  let paths = new Map<string, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gridcue-query-mutants-"));
    paths = writeMutants(dir);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const load = async (id: string) => (await import(/* @vite-ignore */ paths.get(id) as string)) as DataQueryModule;

  it("every mutant is listed once, as caught", () => {
    expect(Object.keys(CAUGHT).sort()).toEqual(MUTANTS.map((m) => m.id).sort());
  });

  for (const mutant of MUTANTS.filter((m) => m.id in CAUGHT)) {
    const [schemaName, rule] = CAUGHT[mutant.id] as readonly [SchemaName, string];
    it(`${mutant.id}: ${mutant.rule} (caught on the ${schemaName} schema)`, async () => {
      const { schema, id } = SCHEMAS[schemaName];
      const { failures } = runQueryCheck(schema, id, await load(mutant.id));
      expect(failures.map((f) => f.name).filter((name) => name.startsWith(rule))).not.toEqual([]);
    });
  }
});
