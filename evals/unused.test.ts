import { wealthSchema } from "@gridcue-internal/wealth-fixtures";
import type { ViewOperation, ViewSchema } from "gridcue";
import { describe, expect, it } from "vitest";
// ADR 0019's check is internal to the compiler, so this test reads it from the package source.
import { readCodeFilters } from "../packages/gridcue/src/core/code-read";
import { matchMentions } from "../packages/gridcue/src/core/mentions";
import { normalize, withoutNamedSizes } from "../packages/gridcue/src/core/normalize";
import { isExposed } from "../packages/gridcue/src/core/schema";
import { unusedReadings } from "../packages/gridcue/src/core/unused";
import { fixtureSchemaFor, loadCases } from "./run";

/**
 * ADR 0019: the check that a ready plan uses everything GridCue read must never block a correct plan. Every labelled
 * case whose expected plan is ready passes it with its expected operations. This bounds the check for every
 * provider, Jev included, without a live call.
 *
 * The text-form sets (named filters spec, 4.4) run with the code-read filters `readCodeFilters` finds, as the Controller
 * passes them: a text form and an empty form count as read, and as used when the plan holds their filter. A case that
 * says `"terms": true` runs on its schema with the House Terms declared (spec 4.4): a term counts as read, and as used
 * when the plan holds its filters.
 */
const FILES = [
  "cases.jsonl",
  "cases-live.jsonl",
  "cases-fanout.jsonl",
  "cases-chassis.jsonl",
  "cases-reading.jsonl",
  "cases-reading-heldout.jsonl",
  "cases-text-forms.jsonl",
  "cases-provider-picks.jsonl",
  "cases-text-forms-heldout.jsonl",
  "cases-provider-picks-heldout.jsonl",
  "cases-house-terms.jsonl",
];

const blocked = (utterance: string, operations: ViewOperation[], schema: ViewSchema) => {
  const normalized = normalize(utterance);
  const mentions = matchMentions(normalized.clauses, schema.columns.filter(isExposed), { rowNoun: schema.rowNoun });
  const input = withoutNamedSizes(normalized, mentions);
  return unusedReadings(input, mentions, operations, [], schema.rowNoun, readCodeFilters(input, mentions, schema));
};

describe("a ready plan uses everything it read, on every labelled ready plan", () => {
  for (const file of FILES) {
    for (const c of loadCases(new URL(`./${file}`, import.meta.url)).filter((x) => x.expect.status === "ready")) {
      it(`${file}: ${c.id}`, () => {
        const schema = fixtureSchemaFor(c);
        expect(blocked(c.utterance, (c.expect.operations ?? []) as ViewOperation[], schema)).toEqual([]);
      });
    }
  }
});

describe("ADR 0019's check counts a code-read filter", () => {
  const empty: ViewOperation = {
    type: "filter.add",
    combineWith: "and",
    predicate: { id: "f1", type: "predicate", columnId: "advisor_name", operator: "isEmpty" },
  };
  it("as used when the plan holds its filter, and as left over when it doesn't", () => {
    expect(blocked("accounts with no advisor", [empty], wealthSchema)).toEqual([]);
    expect(blocked("accounts with no advisor", [], wealthSchema)).toEqual([{ clauseIndex: 0, text: "no advisor" }]);
    const contains: ViewOperation = { ...empty, predicate: { ...empty.predicate, operator: "contains", value: "av" } };
    expect(blocked('advisor starts with "Av"', [contains], wealthSchema)).toEqual([{ clauseIndex: 0, text: 'advisor starts with "av"' }]);
  });
});

describe("ADR 0019's check counts a House Term (spec 4.4)", () => {
  const terms = fixtureSchemaFor({ terms: true });
  const filter = (id: string, columnId: string, operator: "gt" | "eq", value: number | boolean): ViewOperation => ({
    type: "filter.add",
    combineWith: "and",
    predicate: { id, type: "predicate", columnId, operator, value },
  });
  const large = filter("f1", "market_value", "gt", 1_000_000);
  const concentrated = filter("f2", "concentration", "gt", 0.1);
  const restricted = filter("f3", "has_restricted_holding", "eq", true);
  it("as used when the plan holds all of its filters, and as left over when it doesn't", () => {
    expect(blocked("large accounts", [large], terms)).toEqual([]);
    expect(blocked("large accounts", [], terms)).toEqual([{ clauseIndex: 0, text: "large" }]);
    expect(blocked("accounts that need attention", [concentrated, restricted], terms)).toEqual([]);
    expect(blocked("accounts that need attention", [concentrated], terms)).toEqual([{ clauseIndex: 0, text: "need attention" }]);
  });
  it("as its own filters only: the same column's amount said beside it needs a filter of its own", () => {
    const fiveMillion = filter("f4", "market_value", "gt", 5_000_000);
    expect(blocked("large accounts over $5m", [large, fiveMillion], terms)).toEqual([]);
    expect(blocked("large accounts over $5m", [large], terms)).toEqual([{ clauseIndex: 0, text: "$5m" }]);
  });
});
