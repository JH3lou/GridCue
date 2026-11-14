import { wealthMockOptions } from "@gridcue-internal/wealth-fixtures";
import { createMockProvider } from "gridcue/mock";
import { describe, expect, it } from "vitest";
import { judge, loadCases, runCase } from "./run";

const provider = createMockProvider(wealthMockOptions);

describe("evals with the Mock Provider", () => {
  for (const c of loadCases()) {
    it(c.id, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).toMatch(/^(exact|safe_abstention|rejected)$/);
    });
  }
});

// Reading cases: a question where a plan was expected is a reported miss; a wrong view fails.
describe("reading evals with the Mock Provider", () => {
  for (const file of ["cases-reading.jsonl", "cases-reading-heldout.jsonl"]) {
    for (const c of loadCases(new URL(`./${file}`, import.meta.url))) {
      it(`${file}: ${c.id}`, async () => {
        const result = await runCase(c, provider);
        expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
      });
    }
  }
});

// Quoted text and dates that showed rows the User didn't ask for (named filters spec, 5.1). Each now asks, so with the
// Mock Provider every case must match: the controls exactly, the rest with the expected question. The held-out set was
// labelled from the spec alone, before the fixes, and first run after them (2026-11-13): 16 exact, 37 asked as
// labelled, 0 wrong views, of 53. 31 of its requests showed a wrong view before the fixes and now ask.
describe("named-filter fixes with the Mock Provider", () => {
  for (const file of ["cases-named-fixes.jsonl", "cases-named-fixes-heldout.jsonl"]) {
    for (const c of loadCases(new URL(`./${file}`, import.meta.url))) {
      it(`${file}: ${c.id}`, async () => {
        const result = await runCase(c, provider);
        expect(result.verdict, JSON.stringify(result.plan, null, 1)).toMatch(/^(exact|safe_abstention|rejected)$/);
      });
    }
  }
});

// A second held-out set for the same fixes, first run after the round-1 review's fixes (2026-11-13): 34 exact, 34 asked
// as labelled, 6 safe misses, 0 wrong views, of 74, after two labels were corrected to ask. After the round-2 fixes: 37
// exact, 34 asked as labelled, 3 safe misses. A safe miss is reported by `pnpm eval`; a wrong view fails.
describe("named-filter fixes, second held-out set, with the Mock Provider", () => {
  for (const c of loadCases(new URL("./cases-named-fixes-heldout-r2.jsonl", import.meta.url))) {
    it(`cases-named-fixes-heldout-r2.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

// A count follows its rows (operation set spec, 5.1; ADR 0027). After a count, a change to the sort or the filters asks
// whether to keep the count, and the count's own words set and clear it. Labelled before the code. With the Mock
// Provider every case must match: 25 exact and 15 asked as labelled, of 40 (2026-11-13). Before the fix, 11 of these
// requests kept a count over different rows without saying so.
describe("a count follows its rows, with the Mock Provider", () => {
  for (const c of loadCases(new URL("./cases-count.jsonl", import.meta.url))) {
    it(`cases-count.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).toMatch(/^(exact|safe_abstention|rejected)$/);
    });
  }
});

// The same classes in other words, labelled from the spec alone before the code and first run after it (2026-11-13):
// with the Mock Provider 19 exact, 26 asked as labelled, 3 safe misses, 0 wrong views, of 48. 15 of its requests kept a
// count over different rows before the fix and now ask. A safe miss is reported by `pnpm eval`; a wrong view fails.
describe("a count follows its rows, held-out set, with the Mock Provider", () => {
  for (const c of loadCases(new URL("./cases-count-heldout.jsonl", import.meta.url))) {
    it(`cases-count-heldout.jsonl: ${c.id}`, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).not.toBe("unsafe");
    });
  }
});

describe("the verdict", () => {
  const show = { type: "columns.show", columnIds: ["custodian"] };
  const hide = { type: "columns.hide", columnIds: ["custodian"] };
  const sort = { type: "sort.set", sorts: [{ columnId: "market_value", direction: "desc" }] };
  const group = { type: "group.set", columnIds: ["advisor_name"] };
  const verdict = (got: unknown[], want: unknown[]) =>
    judge({ id: "t", utterance: "", expect: { status: "ready", operations: want } }, { operations: got } as never, "ready");

  it("ignores order between a sort and a grouping", () => {
    expect(verdict([group, sort], [sort, group])).toBe("exact");
  });

  it("keeps the order of column changes", () => {
    expect(verdict([hide, show], [show, hide])).toBe("unsafe");
  });
});
