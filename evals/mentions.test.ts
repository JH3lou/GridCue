import { readFileSync } from "node:fs";
import { wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { isExposed, matchMentions, normalize } from "gridcue";
import { describe, expect, it } from "vitest";

/**
 * 66 labelled requests from the context-rule experiment (docs/planning/resolution-quality-grill.md). The held-out
 * set was labelled before the rules existed. "accounts" meaning the rows is not a Mention of Account number.
 * Each Mention is "columnId", or "columnId=valueId" for an enum value.
 */
const cases = readFileSync(new URL("./mentions-cases.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as { set: string; utterance: string; mentions: string[] });

const columns = wealthSchema.columns.filter(isExposed);

describe("Mentions on the wealth schema", () => {
  for (const c of cases) {
    it(`${c.set}: ${c.utterance}`, () => {
      const found = matchMentions(normalize(c.utterance).clauses, columns).map((m) =>
        m.valueId === undefined ? m.columnId : `${m.columnId}=${m.valueId}`,
      );
      expect([...new Set(found)].sort()).toEqual(c.mentions);
    });
  }
});
