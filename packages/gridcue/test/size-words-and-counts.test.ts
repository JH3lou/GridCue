import { describe, expect, it } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { createGridCue } from "../src/core/controller";
import { normalize } from "../src/core/normalize";
import { droppedLimit, renderPreview } from "../src/core/preview";
import { applyOperations } from "../src/core/reduce";
import { applyView, createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// ADR 0018: several changes in one line, size words, the Host's main value column, and a count.
const columns = [
  { id: "name", label: "Account name" },
  { id: "household", label: "Household" },
  { id: "value", label: "Market value", kind: "currency" as const },
  { id: "type", label: "Registration" },
];
const options = {
  rowNoun: "account",
  columns: {
    value: { aliases: ["aum", "size"] },
    household: { entity: "household" },
    type: {
      enumValues: [
        { id: "taxable", label: "Taxable" },
        { id: "trust", label: "Trust" },
      ],
    },
  },
};
const measured = defineSchema(columns, { ...options, defaultMeasure: "value" });
const plain = defineSchema(columns, options);

const setup = (schema = measured, adapter = createRowsAdapter({ schema })) => createGridCue({ adapter, provider: createMockProvider() });

/** A rows adapter that, like a server-paged grid, can't show only the first rows. */
const withoutLimit = () => {
  const rows = createRowsAdapter({ schema: measured });
  return { ...rows, getCapabilities: () => ({ ...rows.getCapabilities(), operations: [...MVP_OPERATIONS] }) };
};

describe("several changes in one line", () => {
  it("splits where a different kind of change starts mid-line", () => {
    expect(normalize("grouped by household sorted largest to smallest").clauses.map((c) => c.text)).toEqual([
      "grouped by household",
      "sorted largest to smallest",
    ]);
    expect(normalize("sort by value only trusts").clauses.map((c) => c.text)).toEqual(["sort by value", "only trusts"]);
    expect(normalize("group by household where value over 1m").clauses.map((c) => c.text)).toEqual([
      "group by household",
      "where value over 1m",
    ]);
  });

  it("keeps a part whole when nothing before the verb is an instruction, or both verbs choose rows", () => {
    expect(normalize("roth iras grouped by rep").clauses).toHaveLength(1);
    expect(normalize("show only trusts").clauses).toHaveLength(1);
    expect(normalize("show accounts where value over 1m").clauses).toHaveLength(1);
    expect(normalize("sort by value in descending order").clauses).toHaveLength(1);
  });

  it("counts a quoted argument as words after the verb", () => {
    expect(normalize('hide "market value" sorted by name').clauses.map((c) => c.text)).toEqual(['hide "market value"', "sorted by name"]);
  });

  it("never splits inside a quoted value", () => {
    const [clause, ...rest] = normalize('filter name "clients grouped by rep"').clauses;
    expect(rest).toEqual([]);
    expect(clause?.literals).toEqual([{ kind: "text", value: "clients grouped by rep", at: 12 }]);
  });

  it("proposes every change it understands, not only the first", async () => {
    const cue = setup();
    await cue.propose("show top accounts grouped by household sorted largest to smallest");
    expect(cue.getState().status).toBe("ready");
    expect(cue.getState().plan?.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
      { type: "group.set", columnIds: ["household"] },
    ]);
    expect(cue.getState().preview?.lines).toEqual(["Sort by Market value, descending", "Group by Household"]);
  });

  it("still asks for the sort column when the Host declares no main value column", async () => {
    const cue = setup(plain);
    await cue.propose("grouped by household sorted largest to smallest");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().plan?.clarifications.map((q) => q.id)).toEqual(["c1.sort.column"]);
  });
});

describe("direction phrases", () => {
  it.each([
    ["largest to smallest", "desc"],
    ["biggest to smallest", "desc"],
    ["smallest to largest", "asc"],
    ["biggest first", "desc"],
    ["smallest first", "asc"],
    ["ascending", "asc"],
    ["descending", "desc"],
    ["top accounts", "desc"],
    ["the largest accounts", "desc"],
    ["the smallest accounts", "asc"],
  ])("reads “%s” as %s", (text, direction) => {
    expect(normalize(text).clauses[0]?.direction).toBe(direction);
  });

  it("sorts “largest to smallest” descending on a named column", async () => {
    const cue = setup(plain);
    await cue.propose("sort by market value largest to smallest");
    expect(cue.getState().plan?.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }]);
  });
});

describe("the main value column (defaultMeasure)", () => {
  it("ranks size words with no column by it, and records the Host's choice", async () => {
    const cue = setup();
    const plan = await cue.propose("smallest first");
    expect(plan?.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] }]);
    expect(plan?.evidence).toContainEqual({ key: "c0.measure", selectedId: "value", confidence: 1, source: "host" });
  });

  it("sorts beside a filter: “trusts, largest first”", async () => {
    const cue = setup();
    await cue.propose("trusts, largest first");
    expect(cue.getState().plan?.operations).toEqual([
      expect.objectContaining({ type: "filter.add" }),
      { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
    ]);
  });

  it("never replaces a column the User named, or one GridCue doesn't know", async () => {
    const cue = setup();
    await cue.propose("sort by household largest first");
    expect(cue.getState().plan?.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "household", direction: "desc" }] }]);
    await cue.propose("sort by risk largest first");
    expect(cue.getState().status).toBe("needs_clarification");
  });

  it("asks rather than replace a named column that can't sort", async () => {
    const noSort = defineSchema(columns, {
      ...options,
      defaultMeasure: "value",
      columns: { ...options.columns, household: { entity: "household", capabilities: ["show", "hide", "filter"] } },
    });
    const cue = setup(noSort);
    await cue.propose("sort by household largest first");
    expect(cue.getState().status).toBe("needs_clarification");
  });

  it("is not used when it is restricted or can't sort", async () => {
    const restricted = defineSchema(columns, { ...options, defaultMeasure: "value", restricted: ["value"] });
    const cue = setup(restricted);
    await cue.propose("largest first");
    expect(cue.getState().status).toBe("needs_clarification");
  });

  it("must name a column", () => {
    expect(() => defineSchema(columns, { defaultMeasure: "missing" })).toThrow(/defaultMeasure/);
  });

  it("reads column synonyms from the schema's aliases", async () => {
    const cue = setup();
    await cue.propose("aum over 1m");
    expect(cue.getState().plan?.operations).toEqual([
      {
        type: "filter.add",
        predicate: expect.objectContaining({ columnId: "value", operator: "gt", value: 1_000_000 }),
        combineWith: "and",
      },
    ]);
  });
});

describe("a count", () => {
  it("reads “top 10” as a count, never as a filter value", () => {
    const [clause] = normalize("top 10 accounts").clauses;
    expect(clause?.limit).toBe(10);
    expect(clause?.literals).toEqual([]);
    expect(normalize("accounts over 10").clauses[0]?.limit).toBeUndefined();
    expect(normalize("top 10% of accounts").clauses[0]?.limit).toBeUndefined();
  });

  it("reads counts with thousands separators or more digits", () => {
    expect(normalize("top 10,000 accounts").clauses[0]?.limit).toBe(10_000);
    expect(normalize("top 20000 accounts").clauses[0]?.limit).toBe(20_000);
    expect(normalize("top 10,000 accounts").clauses[0]?.literals).toEqual([]);
  });

  it("never swaps a named column that holds a size for the main value column", async () => {
    const scored = defineSchema([...columns, { id: "score", label: "Score", kind: "number" }], { ...options, defaultMeasure: "value" });
    const cue = setup(scored);
    for (const request of ["top 10 scores", "top 20000 scores", "largest scores first"]) {
      await cue.propose(request);
      expect(cue.getState().plan?.operations[0]).toEqual({ type: "sort.set", sorts: [{ columnId: "score", direction: "desc" }] });
    }
  });

  it("ranks the rows by the main value column, whatever the count", async () => {
    const named = defineSchema([{ id: "account", label: "Account" }, ...columns.slice(1)], { ...options, defaultMeasure: "value" });
    const cue = setup(named);
    for (const count of ["10", "10,000", "20000"]) {
      await cue.propose(`top ${count} accounts`);
      expect(cue.getState().plan?.operations[0]).toEqual({ type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] });
    }
  });

  it("never reads a size word inside a named value as a sort", async () => {
    const tiered = defineSchema([...columns, { id: "tier", label: "Tier" }], {
      ...options,
      defaultMeasure: "value",
      columns: { ...options.columns, tier: { enumValues: [{ id: "top", label: "Top tier" }] } },
    });
    const cue = setup(tiered);
    await cue.propose("show top tier");
    expect(cue.getState().plan?.operations).toEqual([
      { type: "filter.add", predicate: expect.objectContaining({ columnId: "tier", value: "top" }), combineWith: "and" },
    ]);
  });

  it("never reads a count, size word or direction inside a quoted value", async () => {
    const [clause] = normalize('filter name "top 10"').clauses;
    expect(clause?.limit).toBeUndefined();
    expect(clause?.direction).toBeUndefined();
    expect(clause?.literals).toEqual([{ kind: "text", value: "top 10", at: 12 }]);
    const cue = setup();
    await cue.propose('filter account name "top 10"');
    expect(cue.getState().plan?.operations).toEqual([
      {
        type: "filter.add",
        predicate: expect.objectContaining({ columnId: "name", operator: "contains", value: "top 10" }),
        combineWith: "and",
      },
    ]);
  });

  it("limits the sorted view where the grid can, with its own preview line", async () => {
    const cue = setup();
    await cue.propose("top 10 accounts");
    expect(cue.getState().plan?.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
      { type: "limit.set", count: 10 },
    ]);
    expect(cue.getState().preview?.lines).toEqual(["Sort by Market value, descending", "Show only the first 10 rows"]);
    expect(await cue.apply()).toBe(true);
  });

  it("sorts alone and says the count was not applied where the grid can't limit", async () => {
    const cue = setup(measured, withoutLimit());
    const plan = await cue.propose("top 10 accounts");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }]);
    expect(plan && droppedLimit(plan)).toBe(10);
    expect(cue.getState().preview?.notes).toEqual(["Count not applied: this grid can't show only the first 10"]);
    expect(cue.getState().preview?.text).toContain("count not applied");
  });

  it("keeps the first rows of the sorted view, before grouping, and clears with null", () => {
    const state = applyOperations(
      createRowsAdapter({ schema: measured }).getState().state,
      [
        { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
        { type: "limit.set", count: 2 },
      ],
      createRowsAdapter({ schema: measured }).getDefaultState(),
    );
    const rows = [
      { name: "a", household: "x", value: 1, type: "trust" },
      { name: "b", household: "y", value: 3, type: "trust" },
      { name: "c", household: "x", value: 2, type: "trust" },
    ];
    expect(applyView(rows, state, measured).rows.map((r) => r.name)).toEqual(["b", "c"]);
    expect(applyView(rows, { ...state, groupBy: ["household"] }, measured).groups?.flatMap((g) => g.rows.map((r) => r.name))).toEqual([
      "b",
      "c",
    ]);
    const cleared = applyOperations(state, [{ type: "limit.set", count: null }], state);
    expect(cleared.limit).toBeUndefined();
    expect(renderPreview({ operations: [{ type: "limit.set", count: null }] }, measured).lines).toEqual(["Show every row"]);
  });
});
