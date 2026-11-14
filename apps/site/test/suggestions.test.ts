import type { GridCueController, InteractionStatus, ViewOperation } from "gridcue";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SUGGESTIONS } from "@/components/demo/suggestions";
import { useWealthDemo } from "@/components/demo/use-wealth-demo";

/** What each suggestion promises: a ready plan with these operations, a question back, or a refusal. */
type Promised = { status: "ready"; operations: unknown[] } | { status: Exclude<InteractionStatus, "ready"> };

const is = (columnId: string, operator: string, value: unknown) => ({
  type: "filter.add",
  predicate: { type: "predicate", columnId, operator, value },
  combineWith: "and",
});

const PROMISES: Record<string, Promised> = {
  "Taxable accounts over $1M, sort by concentration, highest first": {
    status: "ready",
    operations: [
      is("registration_type", "eq", "taxable"),
      is("market_value", "gt", 1_000_000),
      { type: "sort.set", sorts: [{ columnId: "concentration", direction: "desc" }] },
    ],
  },
  "Roth IRAs grouped by rep": {
    status: "ready",
    operations: [is("registration_type", "eq", "roth_ira"), { type: "group.set", columnIds: ["advisor_name"] }],
  },
  "Group by custodian, then by advisor": { status: "ready", operations: [{ type: "group.set", columnIds: ["custodian", "advisor_name"] }] },
  "Retirement accounts grouped by advisor": {
    status: "ready",
    operations: [is("registration_type", "in", ["ira", "roth_ira"]), { type: "group.set", columnIds: ["advisor_name"] }],
  },
  "Large taxable accounts": {
    status: "ready",
    operations: [is("market_value", "gt", 1_000_000), is("registration_type", "eq", "taxable")],
  },
  "Show IRAs at Northgate": {
    status: "ready",
    operations: [is("registration_type", "eq", "ira"), is("custodian", "eq", "northgate")],
  },
  "Excluding trusts": { status: "ready", operations: [is("registration_type", "in", ["taxable", "ira", "roth_ira"])] },
  "Accounts with restricted holdings": { status: "ready", operations: [is("has_restricted_holding", "eq", true)] },
  "Hide custodian and account number": {
    status: "ready",
    operations: [{ type: "columns.hide", columnIds: ["custodian", "account_number"] }],
  },
  "Largest households first": { status: "needs_clarification" },
  "Sell anything over 10%": { status: "unsupported" },
};

const withoutIds = (operations: readonly ViewOperation[]) =>
  operations.map((op) => {
    if (op.type !== "filter.add" || op.predicate.type !== "predicate") return op;
    const { id: _id, ...predicate } = op.predicate;
    return { ...op, predicate };
  });

/** The demo's own controller: `useWealthDemo` rendered once, as the server renders /demo. */
const demoCue = (): GridCueController => {
  let cue: GridCueController | undefined;
  const Probe = () => {
    cue = useWealthDemo(500).cue;
    return null;
  };
  renderToString(createElement(Probe));
  if (!cue) throw new Error("useWealthDemo gave no controller");
  return cue;
};

describe("the Site demo's suggestions", () => {
  it("each has a promise, and each promise is suggested", () => {
    expect(SUGGESTIONS.map((s) => s.label).sort()).toEqual(Object.keys(PROMISES).sort());
  });

  for (const suggestion of SUGGESTIONS) {
    it(suggestion.label, async () => {
      const promise = PROMISES[suggestion.label];
      const cue = demoCue();
      await cue.propose(suggestion.label);
      const state = cue.getState();
      expect(state.status).toBe(promise?.status);
      expect(suggestion.refusal === true).toBe(promise?.status === "unsupported");
      if (promise?.status === "ready") expect(withoutIds(state.plan?.operations ?? [])).toEqual(promise.operations);
    });
  }
});
