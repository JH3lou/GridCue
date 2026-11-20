import { createMockProvider } from "gridcue/mock";
import { describe, expect, it } from "vitest";
import { labelledRequests } from "./payloads";
import { mockOptionsFor, runCase } from "./run";

/**
 * Nothing old changes (named filters plan, Task 5.3; spec section 10). Every existing labelled request, every case of
 * every `cases*.jsonl` set that doesn't say `"clock": true` and every request labelled for its Mentions, runs on its
 * schema with the fixed Calendar of `evals/clock.ts` and at its fixed clock, and must give the same verdict, the same
 * status and the same operations as with no Calendar and the system clock. Its Preview may differ only in a date
 * filter's wording, which is the same with a Calendar or without (spec section 9), and in the whole-days note's time
 * zone. The bar is no change: none changes (2026-11-14).
 */
const wealth = createMockProvider(mockOptionsFor({}));
const ledger = createMockProvider(mockOptionsFor({ schema: "ledger" }));
const stripIds = (operations: readonly unknown[] = []) =>
  operations.map((op) => {
    const o = op as { type: string; predicate?: { id?: string } };
    if (o.type !== "filter.add" || !o.predicate) return o;
    const { id: _id, ...predicate } = o.predicate;
    return { ...o, predicate };
  });

describe("every existing labelled request, with a Calendar and a fixed clock", () => {
  const existing = labelledRequests().filter(({ case: c }) => !c.clock);

  for (const { file, id, case: c } of existing) {
    it(`${file}: ${id}`, async () => {
      const provider = c.schema === "ledger" ? ledger : wealth;
      const without = await runCase(c, provider);
      const withCalendar = await runCase(c, provider, undefined, { calendar: true });
      expect(withCalendar.verdict).toBe(without.verdict);
      expect(withCalendar.status).toBe(without.status);
      expect(stripIds(withCalendar.plan?.operations)).toEqual(stripIds(without.plan?.operations));
      expect(withCalendar.preview?.lines).toEqual(without.preview?.lines);
    });
  }

  it("covers every existing request", () => {
    expect(existing.length).toBeGreaterThanOrEqual(2597);
  });
});
