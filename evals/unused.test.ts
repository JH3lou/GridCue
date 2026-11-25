import { wealthSchema } from "@gridcue-internal/wealth-fixtures";
import type { ViewOperation } from "gridcue";
import { describe, expect, it } from "vitest";
// ADR 0019's check is internal to the compiler, so this test reads it from the package source.
import { matchMentions } from "../packages/gridcue/src/core/mentions";
import { normalize, withoutNamedSizes } from "../packages/gridcue/src/core/normalize";
import { isExposed } from "../packages/gridcue/src/core/schema";
import { unusedReadings } from "../packages/gridcue/src/core/unused";
import { loadCases } from "./run";

/**
 * ADR 0019: the check that a ready plan uses everything GridCue read must never block a correct plan. Every labelled
 * case whose expected plan is ready passes it with its expected operations. This bounds the check for every
 * provider, Jev included, without a live call.
 */
const FILES = [
  "cases.jsonl",
  "cases-live.jsonl",
  "cases-fanout.jsonl",
  "cases-chassis.jsonl",
  "cases-reading.jsonl",
  "cases-reading-heldout.jsonl",
];
const columns = wealthSchema.columns.filter(isExposed);

describe("a ready plan uses everything it read, on every labelled ready plan", () => {
  for (const file of FILES) {
    for (const c of loadCases(new URL(`./${file}`, import.meta.url)).filter((x) => x.expect.status === "ready")) {
      it(`${file}: ${c.id}`, () => {
        const normalized = normalize(c.utterance);
        const mentions = matchMentions(normalized.clauses, columns, { rowNoun: wealthSchema.rowNoun });
        const input = withoutNamedSizes(normalized, mentions);
        const operations = (c.expect.operations ?? []) as ViewOperation[];
        expect(unusedReadings(input, mentions, operations, [], wealthSchema.rowNoun)).toEqual([]);
      });
    }
  }
});
