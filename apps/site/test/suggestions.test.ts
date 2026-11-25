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
  "Avery Lane's accounts": { status: "ready", operations: [is("advisor_name", "eq", "Avery Lane")] },
  // Today is 2026-11-13 at NOW in every time zone the tests run in, so the 90 days run from 2026-08-15.
  "Opened in the last 90 days": { status: "ready", operations: [is("opened", "between", { min: "2026-08-15", max: "2026-11-13" })] },
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

/**
 * A fixed clock: 08:00 UTC on 2026-11-13 is that day in UTC, in New York (03:00) and in Auckland (21:00), so the
 * dates below hold in each time zone the tests run in.
 */
const NOW = new Date("2026-11-13T08:00:00.000Z");

/** The demo's own controller: `useWealthDemo` rendered once, as the server renders /demo, on the fixed clock. */
const demo = (): ReturnType<typeof useWealthDemo> => {
  let made: ReturnType<typeof useWealthDemo> | undefined;
  const Probe = () => {
    made = useWealthDemo(500, () => NOW);
    return null;
  };
  renderToString(createElement(Probe));
  if (!made) throw new Error("useWealthDemo gave no controller");
  return made;
};
const demoCue = (): GridCueController => demo().cue;

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

  it("a relative date shows its two days in the Preview, and applying it keeps exactly the rows opened between them", async () => {
    const { cue, table } = demo();
    const opened = (row: { getValue(id: string): unknown }) => String(row.getValue("opened"));
    const inRange = table.getCoreRowModel().rows.filter((row) => opened(row) >= "2026-08-15" && opened(row) <= "2026-11-13");
    expect(inRange.length).toBeGreaterThan(0);
    expect(inRange.length).toBeLessThan(500);
    await cue.propose("Opened in the last 90 days");
    expect(cue.getState().preview?.lines.join(" ")).toMatch(/2026-08-15.*2026-11-13/);
    expect(await cue.apply()).toBe(true);
    expect(table.getRowModel().rows.map((row) => row.id)).toEqual(inRange.map((row) => row.id));
  });
});
