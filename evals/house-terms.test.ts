import { createMockProvider } from "gridcue/mock";
import { describe, expect, it } from "vitest";
import { labelledRequests } from "./payloads";
import { mockOptionsFor, runCase } from "./run";

/**
 * Nothing old changes (named filters plan, Task 3.4; spec section 10). Every existing labelled request, every case of
 * every `cases*.jsonl` set that doesn't say `"terms": true` and every request labelled for its Mentions, runs on its
 * schema with the House Terms of `evals/house-terms.ts` declared, and must give the same verdict and the same
 * operations as without them. The dated and group-names schemas declare no terms, so their cases are left out.
 *
 * `CHANGED` lists each request whose result the terms change, with its verdict with them. The bar is none. One request
 * changes, so the terms stay in the eval harness and out of the fixtures (2026-11-14):
 * - "uncategorised entries please", from the natural held-out set for the text forms, was labelled to show the entries
 *   with no category. Without the terms it asks; with them the ledger's Uncoded term reads its alias "uncategorised",
 *   and the plan is the one labelled.
 */
const CHANGED: Record<string, string> = {
  "cases-text-forms-natural-heldout.jsonl: n1-led-uncategorised": "exact",
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

describe("every existing labelled request, with the House Terms declared", () => {
  const existing = labelledRequests().filter(({ case: c }) => !c.terms && (c.schema === undefined || c.schema === "ledger"));

  for (const { file, id, case: c } of existing) {
    const key = `${file}: ${id}`;
    it(key, async () => {
      const provider = c.schema === "ledger" ? ledger : wealth;
      const without = await runCase(c, provider);
      const withTerms = await runCase({ ...c, terms: true }, provider);
      if (key in CHANGED) {
        expect(withTerms.verdict).toBe(CHANGED[key]);
        expect(withTerms.verdict).not.toBe(without.verdict);
        return;
      }
      expect(withTerms.verdict).toBe(without.verdict);
      expect(withTerms.status).toBe(without.status);
      expect(stripIds(withTerms.plan?.operations)).toEqual(stripIds(without.plan?.operations));
    });
  }

  it("lists only requests that exist", () => {
    const keys = new Set(existing.map(({ file, id }) => `${file}: ${id}`));
    expect(Object.keys(CHANGED).filter((key) => !keys.has(key))).toEqual([]);
  });
});
