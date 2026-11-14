import { wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { createMockProvider } from "gridcue/mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
// The placed-words check is internal to the compiler, so this test runs the Controller and the compiler from the
// package source, where the check can be watched.
import { compile } from "../packages/gridcue/src/core/compile";
import { createGridCue as createFromSource } from "../packages/gridcue/src/core/controller";
import { matchMentions } from "../packages/gridcue/src/core/mentions";
import { normalize } from "../packages/gridcue/src/core/normalize";
import { limitPicks, unplacedWords } from "../packages/gridcue/src/core/placed";
import { emptyViewState } from "../packages/gridcue/src/core/protocol";
import { isExposed } from "../packages/gridcue/src/core/schema";
import { labelledRequests } from "./payloads";
import { mockOptionsFor, runCase } from "./run";

vi.mock("../packages/gridcue/src/core/placed", async (original) => {
  const actual = await original<typeof import("../packages/gridcue/src/core/placed")>();
  return { ...actual, unplacedWords: vi.fn(actual.unplacedWords), limitPicks: vi.fn(actual.limitPicks) };
});

/**
 * A part with no code-read filter is read exactly as before (named filters spec, 4.2; ADR 0023). That holds because
 * the compiler never runs the placed-words check, or the limit on a provider's picks, on such a part. This test runs
 * every labelled request that was in the repo before the code-read filters through the compiler and watches both.
 *
 * `NEW_SETS` are the sets labelled for the code-read filters: their requests hold one, so they are left out.
 * `REACHES` lists the older requests that hold a code-read filter once its form is read, as "file: id". Each is one
 * whose result this work means to change, and the pull request says why. Every other request must never reach the
 * check.
 */
const NEW_SETS = new Set([
  "cases-text-forms.jsonl",
  "cases-not-requests.jsonl",
  "cases-provider-picks.jsonl",
  "cases-text-forms-heldout.jsonl",
  "cases-text-forms-natural-heldout.jsonl",
  "cases-text-forms-heldout-r2.jsonl",
  "cases-text-forms-heldout-r3.jsonl",
  "cases-not-requests-heldout.jsonl",
  "cases-provider-picks-heldout.jsonl",
]);
// Each holds a text form spec 5.2 reads. PR 1 labelled them to ask how to match; all but r2-ask-28 now expect the
// spec's reading, and r2-ask-28 asks about "thanks", which the placed-words lists don't hold.
const REACHES = new Set<string>([
  "cases-named-fixes.jsonl: nf-form-starts-with",
  "cases-named-fixes.jsonl: nf-form-exactly",
  "cases-named-fixes.jsonl: nf-form-equals",
  "cases-named-fixes.jsonl: nf-form-household-starts",
  "cases-named-fixes.jsonl: nf-form-account-starts",
  "cases-named-fixes.jsonl: nf-form-begins",
  "cases-named-fixes.jsonl: nf-form-sentence",
  "cases-named-fixes-heldout.jsonl: h1-form-starts",
  "cases-named-fixes-heldout.jsonl: h1-form-exactly",
  "cases-named-fixes-heldout.jsonl: h1-form-equals-sign",
  "cases-named-fixes-heldout.jsonl: h1-form-household-starts",
  "cases-named-fixes-heldout.jsonl: h1-form-begins",
  "cases-named-fixes-heldout.jsonl: h1-form-equals-word",
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-08",
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-09",
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-11",
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-12",
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-13",
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-14",
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-27",
  "cases-named-fixes-heldout-r2.jsonl: r2-ask-28",
]);

// The source and the built package declare the same Controller. A brand on an applicable plan keeps TypeScript from
// seeing that; no case here applies a plan.
const createGridCue = createFromSource as unknown as NonNullable<Parameters<typeof runCase>[2]>;
const wealth = createMockProvider(mockOptionsFor({}));
const ledger = createMockProvider(mockOptionsFor({ schema: "ledger" }));

describe("the placed-words check on every request labelled before the code-read filters", () => {
  beforeEach(() => {
    vi.mocked(unplacedWords).mockClear();
    vi.mocked(limitPicks).mockClear();
  });

  const older = labelledRequests().filter(({ file }) => !NEW_SETS.has(file));

  for (const { file, id, case: c } of older) {
    const key = `${file}: ${id}`;
    it(key, async () => {
      await runCase(c, c.schema === "ledger" ? ledger : wealth, createGridCue);
      const reached = vi.mocked(unplacedWords).mock.calls.length + vi.mocked(limitPicks).mock.calls.length > 0;
      expect(reached, reached ? "A part with no code-read filter reached the check." : "This request no longer reaches the check.").toBe(
        REACHES.has(key),
      );
      // Whatever reaches the check holds a code-read filter in that part.
      for (const [part] of vi.mocked(unplacedWords).mock.calls) expect(part.codeRead.length).toBeGreaterThan(0);
      for (const [, part] of vi.mocked(limitPicks).mock.calls) expect(part.codeRead.length).toBeGreaterThan(0);
    });
  }

  it("is watched: a part that holds a code-read filter does reach the check", () => {
    // "Flagged" stands in for a code-read filter. The same request with none must not reach the check.
    const input = normalize("flagged trust accounts");
    const mentions = matchMentions(input.clauses, wealthSchema.columns.filter(isExposed), { rowNoun: wealthSchema.rowNoun });
    const run = (codeRead?: Array<{ clauseIndex: number; start: number; end: number }>) =>
      compile({
        input,
        resolution: {
          clauses: [{ clauseIndex: 0, families: [{ id: "filter", confidence: 0.95 }], columns: [], values: [], unmatchedTerms: [] }],
        },
        schema: wealthSchema,
        state: emptyViewState(wealthSchema.columns.map((col) => col.id)),
        baseRevision: "r1",
        channel: "typed",
        mentions,
        ...(codeRead ? { codeRead } : {}),
        newId: (prefix) => `${prefix}_1`,
      });
    expect(run().status).toBe("ready");
    expect(vi.mocked(unplacedWords)).not.toHaveBeenCalled();
    expect(vi.mocked(limitPicks)).not.toHaveBeenCalled();
    expect(run([{ clauseIndex: 0, start: 0, end: "flagged".length }]).status).toBe("ready");
    // Once before the plan is built, and once after.
    expect(vi.mocked(unplacedWords)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(limitPicks)).toHaveBeenCalledTimes(1);
  });

  it("covers every older labelled request, and lists only requests that exist", () => {
    expect(older.length).toBeGreaterThanOrEqual(1263);
    const keys = new Set(older.map(({ file, id }) => `${file}: ${id}`));
    expect([...REACHES].filter((key) => !keys.has(key))).toEqual([]);
  });
});
