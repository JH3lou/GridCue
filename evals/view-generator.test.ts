import { generateLedger, ledgerSchema } from "@gridcue-internal/ledger-fixtures";
import { generateAccounts, wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { createRowsAdapter, type ViewSchema, validatePlan } from "gridcue";
import { describe, expect, it } from "vitest";
import { generateView, operationsFor } from "../packages/gridcue/test/view-generator";

// The seeded view generator lives with the package's tests (operation set spec, 5.4), and evals/ imports it from
// there. On both fixtures, with their rows for filter values, every view it gives is one the built package reaches
// from the default view with a validated plan.

const reachable = (schema: ViewSchema, rows: ReadonlyArray<object>) => {
  const adapter = createRowsAdapter({ schema, renders: ["pinning", "density", "totals"] });
  for (let seed = 0; seed < 300; seed++) {
    const state = generateView(seed, schema, { capabilities: adapter.getCapabilities(), rows });
    const result = validatePlan(
      {
        protocolVersion: "0.1",
        id: `p_${seed}`,
        baseRevision: adapter.getState().revision,
        source: { channel: "api" },
        status: "ready",
        operations: operationsFor(state, schema),
        evidence: [],
        clarifications: [],
        unsupportedSegments: [],
      },
      { schema, capabilities: adapter.getCapabilities(), current: adapter.getState(), defaultState: adapter.getDefaultState() },
    );
    expect(result.ok ? undefined : result.issues, `seed ${seed}`).toBeUndefined();
    if (result.ok) expect(result.state, `seed ${seed}`).toEqual(state);
  }
};

describe("the seeded view generator, on the fixtures", () => {
  it("gives the wealth fixture reachable views", () => reachable(wealthSchema, generateAccounts(200)));
  it("gives the ledger fixture reachable views", () => reachable(ledgerSchema, generateLedger(200)));
});
