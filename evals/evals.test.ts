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
