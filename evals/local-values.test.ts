import { createMockProvider } from "gridcue/mock";
import { describe, expect, it } from "vitest";
import { labelledRequests } from "./payloads";
import { mockOptionsFor, runCase } from "./run";

/**
 * Nothing old changes (named filters plan, Task 4.3; spec section 10). Every existing labelled request, every case of
 * every `cases*.jsonl` set that doesn't say `"values": true` and every request labelled for its Mentions, runs on its
 * schema with the Local Values of `evals/local-values.ts`, and must give the same verdict and the same operations as
 * without them. The dated and group-names schemas have no Local Values, so their cases are left out.
 *
 * `CHANGED` lists each request whose result the values change, with its verdict with them. The bar is none. One request
 * changes, so the values stay in the eval harness and out of the fixtures (2026-11-14):
 * - "just the accounts where the advisor is Blake Moreno", from the second held-out set for the text forms, was
 *   labelled before Local Values to ask, since GridCue couldn't read the name then. With the values it reads as spec
 *   5.4's "advisor is Avery Lane" does: Advisor to exactly “Blake Moreno”. Its label still says ask, so the verdict is
 *   "unsafe" against that label, though the plan is the one the User asked for.
 */
const CHANGED: Record<string, string> = {
  "cases-text-forms-heldout-r2.jsonl: r2-just-advisor-is": "unsafe",
};

const wealth = createMockProvider(mockOptionsFor({}));
const ledger = createMockProvider(mockOptionsFor({ schema: "ledger" }));
const stripIds = (operations: readonly unknown[] = []) =>
  operations.map((op) => {
    const o = op as { type: string; predicate?: { id?: string } };
    if (o.type !== "filter.add" || !o.predicate) return o;
    const { id: _id, ...predicate } = o.predicate;
    return { ...o, predicate };
  });

describe("every existing labelled request, with the Local Values on", () => {
  // The Local Values sets (`cases-names*.jsonl`) are new, not existing: a case of theirs without `"values": true` is
  // labelled for a grid with no values on purpose ("Dana Whitfield's accounts" asks there), so it is left out.
  const existing = labelledRequests().filter(
    ({ file, case: c }) => !file.startsWith("cases-names") && !c.values && (c.schema === undefined || c.schema === "ledger"),
  );

  for (const { file, id, case: c } of existing) {
    const key = `${file}: ${id}`;
    it(key, async () => {
      const provider = c.schema === "ledger" ? ledger : wealth;
      const without = await runCase(c, provider);
      const withValues = await runCase({ ...c, values: true }, provider);
      if (key in CHANGED) {
        expect(withValues.verdict).toBe(CHANGED[key]);
        expect(withValues.verdict).not.toBe(without.verdict);
        return;
      }
      expect(withValues.verdict).toBe(without.verdict);
      expect(withValues.status).toBe(without.status);
      expect(stripIds(withValues.plan?.operations)).toEqual(stripIds(without.plan?.operations));
    });
  }

  it("covers every existing request, and lists only requests that exist", () => {
    expect(existing.length).toBeGreaterThanOrEqual(2000);
    const keys = new Set(existing.map(({ file, id }) => `${file}: ${id}`));
    expect(Object.keys(CHANGED).filter((key) => !keys.has(key))).toEqual([]);
  });
});
