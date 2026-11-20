import { describe, expect, it } from "vitest";
// The ledger fixture is not a dependency of the example, so it comes in by path. It is synthetic.
import { ledgerSchema } from "../../../../../fixtures/ledger/src/index";
import * as example from "./query";
import { runQueryCheck } from "./query-check-run";

// Held-out run, round 1: the example's Data Query was built against the wealth schema and a made-up schema. The ledger
// schema has a date, a date-and-time, a percent and an enum column, and no Calendar time zone.
describe("the example's Data Query passes the Query Check on the ledger schema", () => {
  it("every case keeps the rows applyView keeps", () => {
    const { cases, failures } = runQueryCheck(ledgerSchema, "entry_number", example);
    expect(cases).toBeGreaterThan(40);
    expect(failures).toEqual([]);
  });
});
