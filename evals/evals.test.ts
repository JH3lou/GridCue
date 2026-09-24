import { wealthMockOptions } from "@gridcue-internal/wealth-fixtures";
import { createMockProvider } from "gridcue/mock";
import { describe, expect, it } from "vitest";
import { loadCases, runCase } from "./run";

const provider = createMockProvider(wealthMockOptions);

describe("evals with the Mock Provider", () => {
  for (const c of loadCases()) {
    it(c.id, async () => {
      const result = await runCase(c, provider);
      expect(result.verdict, JSON.stringify(result.plan, null, 1)).toMatch(/^(exact|safe_abstention|rejected)$/);
    });
  }
});
