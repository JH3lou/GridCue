import { describe, expect, it } from "vitest";
import { compile } from "../src/core/compile";
import { matchMentions } from "../src/core/mentions";
import { normalize } from "../src/core/normalize";
import { emptyViewState } from "../src/core/protocol";
import type { ClauseResolution } from "../src/core/resolution";
import { defineSchema, isExposed } from "../src/core/schema";

// Regression tests for the Greptile review of PRs #2 to #4. Each case reproduced a wrong view or a misleading
// prompt before its fix.
const schema = defineSchema(
  [
    { id: "value", label: "Market value", kind: "currency" },
    { id: "gain", label: "Gain", kind: "currency" },
    { id: "name", label: "Name", kind: "string" },
    { id: "type", label: "Registration type", kind: "enum" },
    { id: "cust", label: "Custodian", kind: "enum" },
    { id: "a", label: "Owner", kind: "string" },
    { id: "b", label: "Owner name", kind: "string" },
    { id: "house", label: "Household", kind: "string" },
  ],
  {
    rowNoun: "account",
    columns: {
      b: { aliases: ["owner"] },
      house: { entity: "household" },
      type: {
        enumValues: [
          { id: "trust", label: "Trust" },
          { id: "roth", label: "Roth IRA" },
          { id: "ira", label: "IRA" },
        ],
      },
      cust: {
        enumValues: [
          { id: "ng", label: "Northgate" },
          { id: "hl", label: "Harborline" },
          { id: "st", label: "Summit" },
        ],
        allowedOperators: ["eq", "neq"],
      },
    },
  },
);
let n = 0;
const run = (text: string, clauses: Array<Partial<ClauseResolution>>, answers?: Record<string, string>) => {
  const input = normalize(text);
  return compile({
    input,
    resolution: { clauses: clauses.map((c, i) => ({ clauseIndex: i, families: [], columns: [], values: [], unmatchedTerms: [], ...c })) },
    schema,
    state: emptyViewState(schema.columns.map((c) => c.id)),
    baseRevision: "r1",
    channel: "typed",
    mentions: matchMentions(input.clauses, schema.columns.filter(isExposed), { rowNoun: schema.rowNoun }),
    ...(answers ? { answers } : {}),
    newId: (p) => `${p}_${++n}`,
  });
};
const hi = (id: string) => ({ id, confidence: 0.95 });
const role = (columnId: string, family: string) => ({ columnId, family, confidence: 0.9 });

describe("review fixes", () => {
  it("puts an amount on the column the User named, over the provider's pick", () => {
    const plan = run("show market value over $1m", [
      { families: [hi("filter")], literalColumns: [{ literalIndex: 0, columnId: "gain", confidence: 0.95 }] },
    ]);
    expect(plan.operations).toMatchObject([{ predicate: { columnId: "value", operator: "gt", value: 1_000_000 } }]);
  });

  it("says a shared name is ambiguous instead of calling it missing", () => {
    const plan = run("sort by owner", [{ families: [hi("sort")] }]);
    expect(plan.clarifications[0]).toMatchObject({
      prompt: "“owner” could mean Owner or Owner name. Which column should be sorted by?",
      options: [{ id: "a" }, { id: "b" }],
    });
  });

  it("groups by a column that is named on its own, even when one of its values is named too", () => {
    const plan = run("roth ira accounts grouped by registration type", [{ families: [hi("group")] }]);
    expect(plan.operations).toEqual([
      {
        type: "filter.add",
        combineWith: "and",
        predicate: { id: expect.any(String), type: "predicate", columnId: "type", operator: "eq", value: "roth" },
      },
      { type: "group.set", columnIds: ["type"] },
    ]);
  });

  it("never puts an unassigned named column into two changes; it asks instead", () => {
    const plan = run("sort by market value with gain and name hidden", [
      { families: [hi("sort"), hi("columns.hide")], roles: [role("value", "sort"), role("gain", "columns.hide")] },
    ]);
    expect(plan.status).toBe("needs_clarification");
    expect(plan.clarifications[0]?.prompt).toBe(
      "“sort by market value with gain and name hidden” also mentions Name. Say which change it belongs to, or split it into separate parts.",
    );
  });

  it("filters on a value that continues a grouping, rather than grouping by it", () => {
    const input = normalize("group by custodian, then northgate");
    expect(input.clauses[1]).toMatchObject({ text: "group by northgate", continues: "group" });
    const plan = run("group by custodian, then northgate", [{ families: [hi("group")] }, { families: [hi("group")] }]);
    expect(plan.operations).toMatchObject([
      { type: "group.set", columnIds: ["cust"] },
      { type: "filter.add", predicate: { columnId: "cust", value: "ng" } },
    ]);
  });

  it("carries a negation across a list of values", () => {
    const mentions = matchMentions(normalize("accounts not at northgate or harborline").clauses, schema.columns.filter(isExposed));
    expect(mentions.map((m) => [m.valueId, m.negated])).toEqual([
      ["ng", true],
      ["hl", true],
    ]);
  });

  it("uses an operator the Host allows when excluding a value, or asks", () => {
    const one = run("everything except northgate and harborline", [{ families: [hi("filter")] }]);
    expect(one.operations).toMatchObject([{ predicate: { columnId: "cust", operator: "eq", value: "st" } }]);
    const two = run("everything except summit", [{ families: [hi("filter")] }]);
    expect(two.operations).toMatchObject([{ predicate: { columnId: "cust", operator: "neq", value: "st" } }]);
  });

  it("keeps a column the provider reads as the rows out of the plan, even with a confident column score", () => {
    const plan = run("show the household", [
      { families: [hi("columns.show")], columns: [hi("house")], readings: [{ columnId: "house", reading: "rows", confidence: 0.9 }] },
    ]);
    expect(JSON.stringify(plan.operations)).not.toContain('"house"');
  });

  it("asks for the sort column rather than dropping a sort the text clearly asks for", () => {
    const plan = run("biggest ones at northgate first", [
      { families: [hi("sort")], roles: [{ columnId: "value", family: "sort", confidence: 0.57 }] },
    ]);
    // It asks (here, to split the part) instead of applying the filter and silently dropping the sort.
    expect(plan.status).toBe("needs_clarification");
    expect(plan.operations).toEqual([]);
  });

  it("keeps the other changes when the User chooses to group by an entity", () => {
    const plan = run("sort by gain, largest households first", [{ families: [hi("sort")], roles: [role("gain", "sort")] }], {
      "c0.reading.house": "group",
    });
    expect(plan.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "gain", direction: "desc" }] },
      { type: "group.set", columnIds: ["house"] },
    ]);
  });
});
