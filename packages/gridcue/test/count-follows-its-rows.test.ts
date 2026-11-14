import { describe, expect, it } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { countQuestion } from "../src/core/compile";
import { createGridCue } from "../src/core/controller";
import { matchMentions } from "../src/core/mentions";
import { normalize } from "../src/core/normalize";
import { diffViews } from "../src/core/preview";
import type { FilterGroup, ViewOperation, ViewState } from "../src/core/protocol";
import type { IntentProvider, ResolutionRequest } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { namesEveryRow, readViewWords } from "../src/core/view-words";
import { createMockProvider } from "../src/mock";

// ADR 0027: a count follows its rows. ADR 0028: code reads the count's closed words. Spec 5.1 and 5.2 (count rows).
const columns = [
  { id: "name", label: "Account name" },
  { id: "advisor", label: "Advisor" },
  { id: "custodian", label: "Custodian" },
  { id: "value", label: "Market value", kind: "currency" as const },
  { id: "gain", label: "Unrealized gain", kind: "currency" as const },
  { id: "type", label: "Registration" },
];
const options = {
  rowNoun: "account",
  defaultMeasure: "value",
  columns: {
    value: { aliases: ["value"] },
    gain: { aliases: ["gain"] },
    type: {
      enumValues: [
        { id: "taxable", label: "Taxable" },
        { id: "trust", label: "Trust" },
      ],
    },
  },
};
const schema = defineSchema(columns, options);
const mock = createMockProvider({ defaultColumnForKind: { currency: "value" } });

const byValue = [{ columnId: "value", direction: "desc" as const }];
const taxable: FilterGroup = {
  id: "g",
  type: "group",
  combinator: "and",
  children: [{ id: "p1", type: "predicate", columnId: "type", operator: "eq", value: "taxable" }],
};
/** A grid after "top 10 accounts by market value", or with `view` on top of that. */
const counted = (view: Partial<ViewState> = {}, provider: IntentProvider = mock) => {
  const adapter = createRowsAdapter({ schema });
  adapter.setState((v) => ({ ...v, sorts: byValue, limit: 10, ...view }));
  return { adapter, cue: createGridCue({ adapter, provider }) };
};
/** A rows adapter that, like a server-paged grid, lists no `limit.set`. */
const withoutCount = (view: Partial<ViewState> = {}) => {
  const rows = createRowsAdapter({ schema });
  rows.setState((v) => ({ ...v, ...view }));
  const adapter = { ...rows, getCapabilities: () => ({ ...rows.getCapabilities(), operations: [...MVP_OPERATIONS] }) };
  return { adapter, cue: createGridCue({ adapter, provider: mock }) };
};
const emptyView = () => createRowsAdapter({ schema }).getState().state;
const KEEP_OR_ALL = "Keep only the first 10 rows of the new view, or show every row?";

describe("a count follows its rows (spec 5.1)", () => {
  it.each([
    ["sort by advisor", {}],
    ["clear the sort", {}],
    ["only the taxable ones", {}],
    ["accounts over $1m", {}],
    ["clear the filters", { filters: taxable }],
  ])("asks before “%s” changes which rows the count keeps", async (request, view) => {
    const { cue } = counted(view);
    const plan = await cue.propose(request);
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().message).toBe(KEEP_OR_ALL);
    expect(cue.getState().preview).toBeNull();
    expect(plan?.operations).toEqual([]);
    expect(plan?.clarifications).toEqual([
      {
        id: "plan.count",
        prompt: KEEP_OR_ALL,
        options: [
          { id: "keep", label: "Keep the first 10" },
          { id: "all", label: "Show every row" },
        ],
        required: true,
      },
    ]);
  });

  it.each([
    ["group by advisor", [{ type: "group.set", columnIds: ["advisor"] }]],
    ["hide custodian", [{ type: "columns.hide", columnIds: ["custodian"] }]],
  ])("leaves “%s” ready: it doesn't change which rows the count keeps", async (request, operations) => {
    const { cue } = counted();
    const plan = await cue.propose(request);
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual(operations);
  });

  it("never asks about a plan that sets its own count", async () => {
    const { cue } = counted();
    const plan = await cue.propose("top 5 by gain");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "gain", direction: "desc" }] },
      { type: "limit.set", count: 5 },
    ]);
  });

  it.each(["show every row", "show all rows", "remove the count", "no count"])("reads “%s” as clearing the count", async (request) => {
    const { adapter, cue } = counted();
    const plan = await cue.propose(request);
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([{ type: "limit.set", count: null }]);
    expect(cue.getState().preview?.lines).toEqual(["Show every row"]);
    expect(await cue.apply()).toBe(true);
    expect(adapter.getState().state.limit).toBeUndefined();
    expect(adapter.getState().state.sorts).toEqual(byValue);
    expect(await cue.undo()).toBe(true);
    expect(adapter.getState().state.limit).toBe(10);
  });

  it("clears the count and keeps the filters", async () => {
    const { adapter, cue } = counted({ filters: taxable });
    await cue.propose("show every row");
    expect(cue.getState().preview?.lines).toEqual(["Show every row"]);
    await cue.apply();
    expect(adapter.getState().state).toMatchObject({ filters: taxable, sorts: byValue });
    expect(adapter.getState().state.limit).toBeUndefined();
  });

  it("reads “show only the first 5 rows” on a view with a sort", async () => {
    const { adapter, cue } = counted();
    const plan = await cue.propose("show only the first 5 rows");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([{ type: "limit.set", count: 5 }]);
    expect(cue.getState().preview?.lines).toEqual(["Show only the first 5 rows"]);
    await cue.apply();
    expect(adapter.getState().state).toMatchObject({ limit: 5, sorts: byValue });
    await cue.undo();
    expect(adapter.getState().state.limit).toBe(10);
  });

  it("reads “only the first 5 rows” on a sorted view that has no count yet", async () => {
    const { cue } = counted({ limit: undefined });
    const plan = await cue.propose("only the first 5 rows");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([{ type: "limit.set", count: 5 }]);
  });

  it.each([[{ sorts: [] }], [{ sorts: [], filters: taxable }], [{ sorts: [], limit: undefined }]])(
    "asks which column when “show only the first 5 rows” meets a view with no sort",
    async (view) => {
      const { cue } = counted(view);
      const plan = await cue.propose("show only the first 5 rows");
      expect(cue.getState().status).toBe("needs_clarification");
      expect(plan?.operations).toEqual([]);
      expect(plan?.clarifications).toEqual([{ id: "c0.count", prompt: "First 5 by which column?", required: true }]);
    },
  );

  it("takes the sort said before it in the same request", async () => {
    for (const view of [{ sorts: [], limit: undefined }, {}]) {
      const { cue } = counted(view);
      const plan = await cue.propose("sort by gain and show only the first 5 rows");
      expect(cue.getState().status).toBe("ready");
      expect(plan?.operations).toEqual([
        { type: "sort.set", sorts: [{ columnId: "gain", direction: "asc" }] },
        { type: "limit.set", count: 5 },
      ]);
    }
    // A sort the request clears is no sort.
    const { cue } = counted();
    await cue.propose("clear the sort and show only the first 5 rows");
    expect(cue.getState().message).toBe("First 5 by which column?");
  });

  // "Show only the first 5 rows, then sort by advisor": the 5 rows on screen now, in a new order, or the first 5 by
  // Advisor? The View State holds only the second, and neither is certain, so GridCue asks (ADR 0027).
  it.each([
    ["show only the first 5 rows and sort by advisor", {}],
    ["show only the first 5 rows, then sort by advisor", {}],
    ["only the first 5 rows, sorted by advisor", {}],
    ["show only the first 5 rows and only the taxable ones", {}],
    ["show only the first 5 rows, then only the taxable ones", {}],
    ["show only the first 5 rows and clear the filters", { filters: taxable }],
    ["show only the first 5 rows, only trust instead", { filters: taxable }],
    ["show only the first 5 rows and sort by advisor", { limit: undefined }],
    ["show only the first 5 rows and only the taxable ones", { limit: undefined }],
    ["show only the first 5 rows, sorted by gain", { sorts: [], limit: undefined }],
    ["hide custodian, show only the first 5 rows, then sort by advisor", {}],
  ])("asks about “%s”: the count is said before a change to its rows", async (request, view) => {
    const { adapter, cue } = counted(view);
    const before = adapter.getState();
    const plan = await cue.propose(request);
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().preview).toBeNull();
    expect(plan?.clarifications.map((q) => q.prompt)).toContainEqual(
      expect.stringMatching(/^I'm not sure what to do with “(?:show )?only the first 5 rows”\. Try rephrasing that part\.$/),
    );
    expect(await cue.apply()).toBe(false);
    expect(adapter.getState()).toEqual(before);
  });

  it("leaves a count ready beside a change that keeps its rows", async () => {
    const { cue } = counted({ filters: taxable });
    // Sorting by the sort the view already has, or hiding a column, keeps the same first rows.
    expect((await cue.propose("show only the first 5 rows and sort by value descending"))?.operations).toContainEqual({
      type: "limit.set",
      count: 5,
    });
    expect(cue.getState().status).toBe("ready");
    expect((await cue.propose("show only the first 5 rows and hide custodian"))?.operations).toEqual([
      { type: "limit.set", count: 5 },
      { type: "columns.hide", columnIds: ["custodian"] },
    ]);
    expect(cue.getState().status).toBe("ready");
  });

  // A reset returns to the default view, count included, so count words before it are not kept.
  it.each(["show only the first 5 rows and reset the view", "show every row and reset the view", "remove the count and reset the view"])(
    "asks about “%s”: the reset erases the count line",
    async (request) => {
      for (const initialState of [undefined, { ...emptyView(), sorts: byValue }, { ...emptyView(), sorts: byValue, limit: 25 }]) {
        const adapter = createRowsAdapter({ schema, initialState });
        adapter.setState((v) => ({ ...v, sorts: byValue, limit: 10 }));
        const cue = createGridCue({ adapter, provider: mock });
        await cue.propose(request);
        expect(cue.getState().status).toBe("needs_clarification");
        expect(cue.getState().message).toBe(
          `I'm not sure what to do with “${request.replace(" and reset the view", "")}”. Try rephrasing that part.`,
        );
      }
    },
  );

  it("reads count words said after a reset, against the default view", async () => {
    const adapter = createRowsAdapter({ schema, initialState: { ...emptyView(), sorts: byValue, limit: 25 } });
    adapter.setState((v) => ({ ...v, sorts: [], limit: 10 }));
    const cue = createGridCue({ adapter, provider: mock });
    const plan = await cue.propose("reset the view and show only the first 5 rows");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([{ type: "view.reset" }, { type: "limit.set", count: 5 }]);
    await cue.apply();
    expect(adapter.getState().state).toMatchObject({ sorts: byValue, limit: 5 });
  });

  it("asks whether “show all accounts” clears the filters too, on a view with a filter and a count", async () => {
    const { adapter, cue } = counted({ filters: taxable });
    const plan = await cue.propose("show all accounts");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(plan?.clarifications).toEqual([
      {
        id: "c0.rows",
        prompt: "Show every row, or clear the filters too?",
        options: [
          { id: "count", label: "Show every row" },
          { id: "filters", label: "Clear the filters too" },
        ],
        required: true,
      },
    ]);
    expect(cue.answer("c0.rows", "count")?.operations).toEqual([{ type: "limit.set", count: null }]);
    expect(cue.getState().preview?.lines).toEqual(["Show every row"]);

    await cue.propose("show every account");
    const both = cue.answer("c0.rows", "filters");
    expect(cue.getState().status).toBe("ready");
    expect(both?.operations).toEqual([{ type: "limit.set", count: null }, { type: "filter.clear" }]);
    expect(cue.getState().preview?.lines).toEqual(["Show every row", "Remove the filter Registration to Taxable"]);
    await cue.apply();
    expect(adapter.getState().state.filters).toBeNull();
    expect(adapter.getState().state.limit).toBeUndefined();
    await cue.undo();
    expect(adapter.getState().state).toMatchObject({ filters: taxable, limit: 10 });
  });

  it("leaves “show all accounts” to the provider when the view has no filter, or no count", async () => {
    for (const view of [{}, { limit: undefined, filters: taxable }, { limit: undefined }]) {
      const { cue } = counted(view);
      const plan = await cue.propose("show all accounts");
      expect(cue.getState().status).toBe("needs_clarification");
      expect(plan?.clarifications[0]?.prompt).toBe(
        "What should “show all accounts” filter on? Include a value, such as an amount or a category.",
      );
    }
  });

  it("leaves a reset ready: it states its whole view", async () => {
    const { adapter, cue } = counted({ filters: taxable });
    const plan = await cue.propose("reset the view");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([{ type: "view.reset" }]);
    await cue.apply();
    expect(adapter.getState().state.limit).toBeUndefined();
  });

  it("asks nothing on a view with no count", async () => {
    for (const request of ["sort by advisor", "clear the sort", "only the taxable ones", "accounts over $1m"]) {
      const { cue } = counted({ limit: undefined });
      await cue.propose(request);
      expect(cue.getState().status, request).toBe("ready");
    }
  });
});

describe("answering the count question", () => {
  it("keeps the first 10 of the new view, and the Preview says so", async () => {
    const { adapter, cue } = counted();
    const before = adapter.getState().state;
    await cue.propose("sort by advisor");
    const plan = cue.answer("plan.count", "keep");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "advisor", direction: "asc" }] },
      { type: "limit.set", count: 10 },
    ]);
    expect(cue.getState().preview?.lines).toEqual(["Sort by Advisor, ascending", "Show only the first 10 rows"]);
    expect(adapter.getState().state).toEqual(before);
    expect(await cue.apply()).toBe(true);
    expect(adapter.getState().state).toMatchObject({ sorts: [{ columnId: "advisor", direction: "asc" }], limit: 10 });
    expect(await cue.undo()).toBe(true);
    expect(adapter.getState().state).toEqual(before);
  });

  it("shows every row, and the Preview says so", async () => {
    const { adapter, cue } = counted();
    const before = adapter.getState().state;
    await cue.propose("only the taxable ones");
    const plan = cue.answer("plan.count", "all");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([
      {
        type: "filter.add",
        predicate: expect.objectContaining({ columnId: "type", operator: "eq", value: "taxable" }),
        combineWith: "and",
      },
      { type: "limit.set", count: null },
    ]);
    expect(cue.getState().preview?.lines).toEqual(["Filter Registration to Taxable", "Show every row"]);
    expect(await cue.apply()).toBe(true);
    expect(adapter.getState().state.limit).toBeUndefined();
    expect(adapter.getState().state.sorts).toEqual(byValue);
    expect(await cue.undo()).toBe(true);
    expect(adapter.getState().state).toEqual(before);
  });

  it("applies nothing until it is answered, and cancel leaves the grid alone", async () => {
    const { adapter, cue } = counted();
    const before = adapter.getState();
    await cue.propose("clear the sort");
    expect(await cue.apply()).toBe(false);
    expect(cue.answer("plan.count", "something else")).toBeNull();
    expect(cue.getState().status).toBe("needs_clarification");
    cue.cancel();
    expect(cue.getState().status).toBe("idle");
    expect(adapter.getState()).toEqual(before);
  });

  it("is asked last, after the request's own questions", async () => {
    const { cue } = counted();
    await cue.propose("sort");
    expect(cue.getState().message).toBe("Which column should be sorted by?");
    cue.answer("c0.sort.column", "advisor");
    expect(cue.getState().message).toBe(KEEP_OR_ALL);
    expect(cue.answer("plan.count", "keep")?.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "advisor", direction: "asc" }] },
      { type: "limit.set", count: 10 },
    ]);
  });

  it("is asked of any provider's plan", async () => {
    const provider: IntentProvider = {
      resolve: async () => ({
        clauses: [
          {
            clauseIndex: 0,
            families: [{ id: "sort", confidence: 0.97 }],
            columns: [{ id: "advisor", confidence: 0.97 }],
            values: [],
            unmatchedTerms: [],
          },
        ],
      }),
    };
    const { cue } = counted({}, provider);
    await cue.propose("arrange it by who looks after it");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().message).toBe(KEEP_OR_ALL);
  });
});

describe("the count rule", () => {
  const view = { sorts: byValue, filters: null, limit: 10 };
  const filtered = { ...view, filters: taxable };
  const sort: ViewOperation = { type: "sort.set", sorts: [{ columnId: "advisor", direction: "asc" }] };
  const trusts: ViewOperation = {
    type: "filter.add",
    predicate: { id: "f1", type: "predicate", columnId: "type", operator: "eq", value: "trust" },
    combineWith: "and",
  };
  const clear: ViewOperation = { type: "filter.clear" };

  it.each([
    ["a new sort", [sort], view],
    ["a cleared sort", [{ type: "sort.set", sorts: [] }], view],
    ["a level added to the sort", [{ type: "sort.set", sorts: [...byValue, { columnId: "advisor", direction: "asc" }] }], view],
    ["the same column the other way", [{ type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] }], view],
    ["a filter added", [trusts], view],
    ["a filter added to the filters", [trusts], filtered],
    ["a filter replaced", [clear, trusts], filtered],
    ["the filters cleared", [clear], filtered],
    ["a sort beside a grouping", [{ type: "group.set", columnIds: ["advisor"] }, sort], view],
  ] as Array<[string, ViewOperation[], typeof view]>)("asks about %s", (_what, operations, from) => {
    const asked = countQuestion(operations, from);
    expect(asked?.clarification.prompt).toBe(KEEP_OR_ALL);
    expect(asked?.answers.keep).toEqual([...operations, { type: "limit.set", count: 10 }]);
    expect(asked?.answers.all).toEqual([...operations, { type: "limit.set", count: null }]);
  });

  it.each([
    ["its own count", [sort, { type: "limit.set", count: 5 }], view],
    ["its own count, cleared", [sort, { type: "limit.set", count: null }], view],
    ["its own count, said first", [{ type: "limit.set", count: 5 }, clear, trusts], filtered],
    ["a reset", [{ type: "view.reset" }], filtered],
    ["a reset, then a sort", [{ type: "view.reset" }, sort], view],
    ["a sort, then a reset", [sort, { type: "view.reset" }], view],
    ["a grouping", [{ type: "group.set", columnIds: ["advisor"] }], view],
    ["hidden columns", [{ type: "columns.hide", columnIds: ["custodian"] }], view],
    [
      "shown and ordered columns",
      [
        { type: "columns.show", columnIds: ["gain"] },
        { type: "columns.order", columnIds: ["gain"] },
      ],
      view,
    ],
    [
      "a pin, a total and a density",
      [
        { type: "columns.pin", columnIds: ["name"], position: "start" },
        { type: "aggregation.set", aggregations: [{ columnId: "value", function: "sum" }] },
        { type: "density.set", density: "compact" },
      ],
      view,
    ],
    ["the sort the view already has", [{ type: "sort.set", sorts: byValue }], view],
    ["a clear of filters the view doesn't have", [clear], view],
    [
      "the filter the view already has",
      [clear, { ...trusts, predicate: { ...trusts.predicate, id: "other", value: "taxable" } }],
      filtered,
    ],
    ["no operations", [], view],
    ["a view with no count", [sort, trusts], { sorts: byValue, filters: null }],
  ] as Array<[string, ViewOperation[], Pick<ViewState, "sorts" | "filters" | "limit">]>)(
    "never asks about a plan with %s",
    (_what, operations, from) => {
      expect(countQuestion(operations, from)).toBeUndefined();
    },
  );

  it("compares what the rows see, not how the view was written", () => {
    const written = { sorts: [{ direction: "desc" as const, columnId: "value" }], filters: { ...taxable, id: "other" }, limit: 10 };
    expect(countQuestion([{ type: "sort.set", sorts: byValue }], written)).toBeUndefined();
    const same: ViewOperation = {
      type: "filter.add",
      predicate: { value: "taxable", operator: "eq", columnId: "type", type: "predicate", id: "f9" },
      combineWith: "and",
    };
    expect(countQuestion([clear, same], written)).toBeUndefined();
    // No filters is no filters, as `null` or as an empty group.
    const empty = { ...view, filters: { id: "g", type: "group" as const, combinator: "and" as const, children: [] } };
    expect(countQuestion([clear], empty)).toBeUndefined();
    expect(countQuestion([clear, trusts], empty)).toBeDefined();
  });

  it("looks at the default view's count after a reset", () => {
    const defaultView = { sorts: byValue, filters: null, limit: 20 };
    expect(countQuestion([{ type: "view.reset" }], view, defaultView)).toBeUndefined();
    expect(countQuestion([{ type: "view.reset" }, { type: "sort.set", sorts: byValue }], view, defaultView)).toBeUndefined();
    const asked = countQuestion([{ type: "view.reset" }, sort], { sorts: [], filters: null }, defaultView);
    expect(asked?.clarification.prompt).toBe("Keep only the first 20 rows of the new view, or show every row?");
    expect(asked?.answers.keep.at(-1)).toEqual({ type: "limit.set", count: 20 });
  });

  it("words the count as the Preview does", () => {
    expect(countQuestion([sort], { ...view, limit: 1 })?.clarification).toMatchObject({
      prompt: "Keep only the first row of the new view, or show every row?",
      options: [
        { id: "keep", label: "Keep the first row" },
        { id: "all", label: "Show every row" },
      ],
    });
    expect(countQuestion([sort], { ...view, limit: 1000 })?.clarification.prompt).toBe(
      "Keep only the first 1,000 rows of the new view, or show every row?",
    );
  });
});

describe("the count words (spec 5.2)", () => {
  const read = (text: string, s = schema) => {
    const { clauses } = normalize(text);
    expect(clauses).toHaveLength(1);
    const clause = clauses[0];
    if (!clause) throw new Error("no clause");
    const mentions = matchMentions(clauses, s.columns, { rowNoun: s.rowNoun });
    return readViewWords(clause, mentions, s);
  };

  it("reads the count-clear form, with a span for each word it read", () => {
    expect(read("show every row")).toEqual({
      operations: [{ type: "limit.set", count: null }],
      spans: [
        { start: 0, end: 4, kind: "verb" },
        { start: 5, end: 14, kind: "count" },
      ],
    });
    expect(read("Show all rows.")).toEqual({
      operations: [{ type: "limit.set", count: null }],
      spans: [
        { start: 0, end: 4, kind: "verb" },
        { start: 5, end: 13, kind: "count" },
      ],
    });
    expect(read("remove the count")).toEqual({
      operations: [{ type: "limit.set", count: null }],
      spans: [
        { start: 0, end: 6, kind: "verb" },
        { start: 11, end: 16, kind: "count" },
      ],
    });
    expect(read("no count")).toEqual({ operations: [{ type: "limit.set", count: null }], spans: [{ start: 0, end: 8, kind: "count" }] });
  });

  it("reads the count form, with a span for each word it read", () => {
    expect(read("show only the first 5 rows")).toEqual({
      operations: [{ type: "limit.set", count: 5 }],
      spans: [
        { start: 0, end: 4, kind: "verb" },
        { start: 14, end: 26, kind: "count" },
      ],
    });
    expect(read("only the first 25 rows")).toEqual({
      operations: [{ type: "limit.set", count: 25 }],
      spans: [{ start: 9, end: 22, kind: "count" }],
    });
    expect(read("show only the first 1 row")?.operations).toEqual([{ type: "limit.set", count: 1 }]);
    expect(read("show only the first 1,000 rows")?.operations).toEqual([{ type: "limit.set", count: 1000 }]);
  });

  it.each([
    "show every row please",
    "please show every row",
    "show me every row",
    "show every single row",
    "show all the rows",
    "show all rows now",
    "show every taxable row",
    "show all trust rows",
    "show all accounts",
    "show every account",
    "show all records",
    "show everything",
    "every row",
    "all rows",
    "remove the count please",
    "remove the row count",
    "remove count",
    "remove the limit",
    "clear the count",
    "no count please",
    "no more count",
    "no limit",
  ])("doesn't read “%s”: a word is left over, or it is another wording", (text) => {
    expect(read(text)).toBeUndefined();
  });

  it.each([
    "show only the first 5 rows please",
    "show the first 5 rows",
    "show only first 5 rows",
    "the first 5 rows",
    "first 5 rows",
    "show only the first five rows",
    "the first ten",
    "10 largest accounts",
    "show only the first 5",
    "show only the first 5 accounts",
    "show only the first 5 taxable rows",
    "show only the first 5 rows by gain",
    "show only the first 0 rows",
    "show only the first 05 rows",
    "show only the first 5.5 rows",
    "show only the first -5 rows",
    "show only the first 5% rows",
    "show only the first $5 rows",
    "show only the first 5k rows",
    'show only the first "5" rows',
    "show only the last 5 rows",
    "show only the top 5 rows",
    "keep only the first 5 rows",
    "just the first 5 rows",
    "show only the first 99999999999999999999 rows",
  ])("doesn't read “%s”: a word is left over, or it is another wording", (text) => {
    expect(read(text)).toBeUndefined();
  });

  it("reads a Host's own name first: a form word that is a declared label or alias is a Mention", () => {
    const named = (label: string, alias?: string) =>
      defineSchema([...columns, { id: "extra", label }], {
        ...options,
        columns: { ...options.columns, ...(alias ? { extra: { aliases: [alias] } } : {}) },
      });
    expect(read("remove the count", named("Count"))).toBeUndefined();
    expect(read("no count", named("Positions", "count"))).toBeUndefined();
    expect(read("show every row", named("Row"))).toBeUndefined();
    expect(read("show all rows", named("Rows"))).toBeUndefined();
    expect(read("show only the first 5 rows", named("First"))).toBeUndefined();
    // A Mention anywhere in the part is a word the form doesn't have.
    const clause = normalize("show every row").clauses[0];
    if (!clause) throw new Error("no clause");
    expect(readViewWords(clause, [{ clauseIndex: 0, columnId: "name", start: 5, end: 10 }], schema)).toBeUndefined();
    expect(readViewWords(clause, [{ clauseIndex: 1, columnId: "name", start: 5, end: 10 }], schema)).toBeDefined();
  });

  it("doesn't read a form whose own noun is a word of one of the Host's names", () => {
    const withName = (label: string) => defineSchema([...columns, { id: "extra", label }], options);
    expect(read("remove the count", withName("Trade count"))).toBeUndefined();
    expect(read("no count", withName("Trade count"))).toBeUndefined();
    expect(read("show every row", withName("Row number"))).toBeUndefined();
    expect(read("show only the first 5 rows", withName("Rows returned"))).toBeUndefined();
    // Another form's noun doesn't matter.
    expect(read("show every row", withName("Trade count"))).toBeDefined();
    expect(read("remove the count", withName("Row number"))).toBeDefined();
  });

  it("doesn't read what a clear says to keep, or a part that continues a sort", () => {
    const clause = normalize("show every row").clauses[0];
    if (!clause) throw new Error("no clause");
    expect(readViewWords({ ...clause, keeps: true }, [], schema)).toBeUndefined();
    expect(readViewWords({ ...clause, continues: "sort" }, [], schema)).toBeUndefined();
  });

  it("tells “show all accounts” apart: the Row Noun in place of “rows” is not the count-clear form", () => {
    const names = (text: string, s = schema) => {
      const { clauses } = normalize(text);
      const clause = clauses[0];
      if (!clause) throw new Error("no clause");
      return namesEveryRow(clause, matchMentions(clauses, s.columns, { rowNoun: s.rowNoun }), s);
    };
    expect(names("show all accounts")).toBe(true);
    expect(names("show every account")).toBe(true);
    expect(names("show all rows")).toBe(false);
    expect(names("show all taxable accounts")).toBe(false);
    expect(names("show all accounts please")).toBe(false);
    expect(names("show all advisors")).toBe(false);
    expect(names("show all accounts", defineSchema(columns, { ...options, rowNoun: undefined }))).toBe(false);
  });

  it("is not stored on the Clause: the provider gets the part exactly as before", async () => {
    const seen: ResolutionRequest[] = [];
    const provider: IntentProvider = {
      resolve: (request, signal) => {
        seen.push(structuredClone(request));
        return mock.resolve(request, signal);
      },
    };
    const { cue } = counted({}, provider);
    await cue.propose("show every row and show only the first 5 rows");
    expect(seen[0]?.clauses).toEqual([
      { index: 0, text: "show every row", literals: [] },
      { index: 1, text: "show only the first 5 rows", literals: [{ kind: "number", value: 5, at: 20 }] },
    ]);
  });
});

describe("the count words in a request", () => {
  it.each([
    ["show every row please", "What should “show every row please” filter on? Include a value, such as an amount or a category."],
    ["remove the limit", "I'm not sure what to change for “remove the limit”. Try asking to filter, sort, group, or show or hide columns."],
    ["show only the first 5 rows please", "I'm not sure how to compare with “5”. Try “over”, “under”, “at least”, or “exactly”."],
    ["the first ten", "I'm not sure what to change for “the first ten”. Try asking to filter, sort, group, or show or hide columns."],
  ])("leaves “%s” to the provider, as before", async (request, prompt) => {
    const { cue } = counted();
    const plan = await cue.propose(request);
    expect(cue.getState().status).toBe("needs_clarification");
    expect(plan?.clarifications[0]?.prompt).toBe(prompt);
  });

  it("reads the count words beside other parts", async () => {
    const { cue } = counted();
    expect((await cue.propose("show only the first 5 rows and hide custodian"))?.operations).toEqual([
      { type: "limit.set", count: 5 },
      { type: "columns.hide", columnIds: ["custodian"] },
    ]);
    // A plan that sets its own count is never asked the count question.
    expect((await cue.propose("sort by advisor and show every row"))?.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "advisor", direction: "asc" }] },
      { type: "limit.set", count: null },
    ]);
    expect(cue.getState().status).toBe("ready");
    expect((await cue.propose("only the taxable ones and show only the first 5 rows"))?.operations).toEqual([
      { type: "filter.add", predicate: expect.objectContaining({ columnId: "type", value: "taxable" }), combineWith: "and" },
      { type: "limit.set", count: 5 },
    ]);
    expect(cue.getState().status).toBe("ready");
  });

  it.each([
    ["show only the first 5 rows and show every row", "show only the first 5 rows"],
    ["show every row and show only the first 5 rows", "show every row"],
    ["show only the first 5 rows, then top 3 by gain", "show only the first 5 rows"],
    ["top 3 by gain and show only the first 5 rows", "top 3"],
    ["top 3 by gain and show every row", "top 3"],
  ])("asks about “%s”: a request holds one count", async (request, unused) => {
    const { cue } = counted();
    await cue.propose(request);
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().message).toBe(`I'm not sure what to do with “${unused}”. Try rephrasing that part.`);
  });

  it("clears a count the view doesn't have, as any clear of nothing does", async () => {
    const { adapter, cue } = counted({ limit: undefined });
    const before = adapter.getState().state;
    const plan = await cue.propose("show every row");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([{ type: "limit.set", count: null }]);
    await cue.apply();
    expect(adapter.getState().state).toEqual(before);
  });

  it.each(["show every row", "show all rows"])(
    "leaves “%s” to the provider when the view has filters and no count: it may mean the rows the filters leave out",
    async (request) => {
      const { cue } = counted({ limit: undefined, filters: taxable });
      const plan = await cue.propose(request);
      expect(cue.getState().status).toBe("needs_clarification");
      expect(plan?.clarifications[0]?.prompt).toBe(`What should “${request}” filter on? Include a value, such as an amount or a category.`);
    },
  );

  it.each(["remove the count", "no count"])("reads “%s” on a view with filters and no count: it names the count", async (request) => {
    const { cue } = counted({ limit: undefined, filters: taxable });
    const plan = await cue.propose(request);
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([{ type: "limit.set", count: null }]);
  });

  it("asks about “every row” beside a filter the same request adds, when there is no count to clear", async () => {
    for (const request of ["only the taxable ones and show every row", "show all rows and only the taxable ones"]) {
      const { cue } = counted({ limit: undefined });
      await cue.propose(request);
      expect(cue.getState().status, request).toBe("needs_clarification");
      expect(cue.getState().message).toMatch(/^I'm not sure what to do with “show (?:every row|all rows)”\. Try rephrasing that part\.$/);
    }
    // With a count to clear, the request says both: these rows, and all of them.
    const { cue } = counted();
    const plan = await cue.propose("only the taxable ones and show every row");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([
      { type: "filter.add", predicate: expect.objectContaining({ columnId: "type", value: "taxable" }), combineWith: "and" },
      { type: "limit.set", count: null },
    ]);
  });
});

describe("a grid that keeps no count", () => {
  it.each([
    ["show only the first 5 rows", "This grid can't show only the first 5 rows."],
    ["only the first 5 rows", "This grid can't show only the first 5 rows."],
    ["show only the first 1 row", "This grid can't show only the first 1 row."],
    ["group by advisor and show only the first 5 rows", "This grid can't show only the first 5 rows."],
  ])("ends “%s” in a question with no choices, and applies nothing", async (request, prompt) => {
    const { adapter, cue } = withoutCount({ sorts: byValue });
    const before = adapter.getState();
    const plan = await cue.propose(request);
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().message).toBe(prompt);
    expect(plan?.operations).toEqual([]);
    expect(plan?.clarifications.every((q) => q.options === undefined)).toBe(true);
    expect(await cue.apply()).toBe(false);
    expect(adapter.getState()).toEqual(before);
  });

  it("still sorts alone for “top 10”, with the note", async () => {
    const { cue } = withoutCount();
    const plan = await cue.propose("top 10 accounts");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([{ type: "sort.set", sorts: byValue }]);
    expect(cue.getState().preview?.notes).toEqual(["Count not applied: this grid can't show only the first 10"]);
  });

  it("leaves the count-clear words and a later sort as they were", async () => {
    const { cue } = withoutCount({ sorts: byValue });
    const plan = await cue.propose("show every row");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(plan?.clarifications[0]?.prompt).toBe(
      "What should “show every row” filter on? Include a value, such as an amount or a category.",
    );
    await cue.propose("sort by advisor");
    expect(cue.getState().status).toBe("ready");
  });
});

describe("diffViews", () => {
  it("says when the count changed", () => {
    const view = createRowsAdapter({ schema }).getState().state;
    expect(diffViews(view, view).countChanged).toBe(false);
    expect(diffViews(view, { ...view, limit: 10 }).countChanged).toBe(true);
    expect(diffViews({ ...view, limit: 10 }, { ...view, limit: 5 }).countChanged).toBe(true);
    expect(diffViews({ ...view, limit: 10 }, view).countChanged).toBe(true);
    expect(diffViews({ ...view, limit: 10 }, { ...view, limit: 10, sorts: byValue })).toMatchObject({
      countChanged: false,
      sortsChanged: true,
    });
  });
});
