import { wealthInitialState, wealthMockOptions, wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { createGridCue, createRowsAdapter, type ViewOperation } from "gridcue";
import { createMockProvider } from "gridcue/mock";
import { describe, expect, it } from "vitest";

/**
 * The wealth schema with its Row Noun removed. Without one, a money column named before a percentage (or the
 * reverse) used to be read as the rows, and the amount went to another column. These are round three's held-out
 * cases: labelled before the fix, first run after it (2026-11-10).
 */
const { rowNoun: _rowNoun, ...schema } = wealthSchema;

const run = async (text: string) => {
  const cue = createGridCue({
    adapter: createRowsAdapter({ schema, initialState: wealthInitialState }),
    provider: createMockProvider(wealthMockOptions),
  });
  const plan = await cue.propose(text);
  const status = cue.getState().status;
  return status === "ready" ? (plan?.operations ?? []) : status;
};
const filters = (ops: readonly ViewOperation[]) =>
  ops.flatMap((op) => (op.type === "filter.add" ? [[op.predicate.columnId, op.predicate.operator, op.predicate.value]] : []));

describe("a schema with no Row Noun", () => {
  for (const text of [
    "balance over 8%",
    "assets under 12%",
    "largest position over $2m",
    "concentration below $500k grouped by advisor",
    "unrealized gain above 3%",
  ]) {
    it(`asks about “${text}”`, async () => {
      expect(await run(text)).toBe("needs_clarification");
    });
  }

  it("still reads an amount its column can hold", async () => {
    expect(filters((await run("assets over $3m")) as ViewOperation[])).toEqual([["market_value", "gt", 3_000_000]]);
    expect(filters((await run("largest position over 25%")) as ViewOperation[])).toEqual([["concentration", "gt", 0.25]]);
    expect(filters((await run("accounts under $500k")) as ViewOperation[])).toEqual([["market_value", "lt", 500_000]]);
    const both = (await run("gain over $10k grouped by custodian")) as ViewOperation[];
    expect(filters(both)).toEqual([["unrealized_gain", "gt", 10_000]]);
    expect(both).toContainEqual({ type: "group.set", columnIds: ["custodian"] });
  });
});
