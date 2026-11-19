import { describe, expect, it } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { cantQuestion, compile } from "../src/core/compile";
import { createGridCue } from "../src/core/controller";
import { matchMentions } from "../src/core/mentions";
import { normalize } from "../src/core/normalize";
import { diffViews, renderPreview, toAuditEvent } from "../src/core/preview";
import {
  type AggregationSpec,
  type ColumnCapability,
  emptyViewState,
  type ViewCapabilities,
  ViewOperation,
  type ViewPlan,
  type ViewState,
} from "../src/core/protocol";
import type { IntentProvider, ResolutionResult } from "../src/core/resolution";
import { applyView, createRowsAdapter } from "../src/core/rows-adapter";
import { DEFAULT_CAPABILITIES, defineSchema, isExposed } from "../src/core/schema";
import { validatePlan } from "../src/core/validate";
import { readViewWords } from "../src/core/view-words";
import { createMockProvider } from "../src/mock";

// Totals (operation set spec, 4.3 to 4.5, 5.2 and 5.4; ADR 0030 and the totals half of ADR 0029). Written before the
// code, as its contract. A Total is a sum or an average of one column. Code reads a small, closed set of words for
// it; one word left over and the part goes to the provider exactly as before. A grid that doesn't list
// `aggregation.set` says "This grid can't show totals.", and nothing in the request applies.
//
// A test marked "OPEN:" pins a detail the spec leaves open, with the reading judged right here. The lead settles each.
const columns = [
  { id: "account", label: "Account number" },
  { id: "household", label: "Household" },
  { id: "advisor", label: "Advisor" },
  { id: "custodian", label: "Custodian" },
  { id: "opened", label: "Opened", kind: "date" as const },
  { id: "value", label: "Market value", kind: "currency" as const },
  { id: "gain", label: "Unrealized gain", kind: "currency" as const },
  { id: "score", label: "Risk score", kind: "number" as const },
  { id: "concentration", label: "Concentration", kind: "percent" as const },
  { id: "restricted", label: "Restricted holdings", kind: "boolean" as const },
  { id: "fee", label: "Annual fee", kind: "currency" as const },
  { id: "notes", label: "Notes" },
  { id: "ssn", label: "Tax ID" },
];
const options = {
  rowNoun: "account",
  restricted: ["ssn"],
  columns: {
    account: { aliases: ["account", "acct"] },
    household: { entity: "household" },
    advisor: { aliases: ["advisor", "rep"], entity: "advisor" },
    custodian: {
      kind: "enum" as const,
      enumValues: [
        { id: "northgate", label: "Northgate" },
        { id: "harborline", label: "Harborline" },
      ],
    },
    value: { aliases: ["value", "aum"] },
    gain: { aliases: ["gain"] },
    restricted: { aliases: ["restricted"] },
    // The Host's own list replaces the defaults, so this currency column may not be totalled.
    fee: { capabilities: ["filter" as const, "sort" as const, "show" as const, "hide" as const] },
    notes: { capabilities: ["show" as const, "hide" as const] },
  },
};
const schema = defineSchema(columns, options);
/** The same grid with Market value as the Host's main value column (ADR 0018). */
const measured = defineSchema(columns, { ...options, defaultMeasure: "value" });
const mock = createMockProvider({ defaultColumnForKind: { currency: "value", percent: "concentration" } });
const TOTALS = "aggregation.set";
const CANT = "This grid can't show totals.";

const sum = (columnId: string): AggregationSpec => ({ columnId, function: "sum" });
const avg = (columnId: string): AggregationSpec => ({ columnId, function: "avg" });
const totals = (...aggregations: AggregationSpec[]): ViewOperation => ({ type: TOTALS, aggregations });
const groupBy = (...columnIds: string[]): ViewOperation => ({ type: "group.set", columnIds });

/** A grid that lists `aggregation.set`, as the Rows Adapter does with `renders: ["totals"]`, or one that doesn't. */
const grid = ({
  totals: lists = true,
  view = {} as Partial<ViewState>,
  s = schema,
  provider = mock as IntentProvider,
  audit = undefined as Parameters<typeof createGridCue>[0]["audit"],
} = {}) => {
  const rows = createRowsAdapter({ schema: s });
  rows.setState((v) => ({ ...v, ...view }));
  const adapter = {
    ...rows,
    getCapabilities: () => {
      const caps = rows.getCapabilities();
      return { ...caps, operations: [...caps.operations, ...(lists ? [TOTALS] : [])] };
    },
  };
  return { adapter, cue: createGridCue({ adapter, provider, ...(audit ? { audit } : {}) }) };
};

/** Proposes `request` and returns the plan's status, operations, Preview lines and questions. */
const propose = async (request: string, setup: Parameters<typeof grid>[0] = {}) => {
  const { cue, adapter } = grid(setup);
  const plan = await cue.propose(request);
  const state = cue.getState();
  return {
    status: state.status,
    operations: plan?.operations ?? [],
    lines: state.preview?.lines ?? null,
    questions: plan?.clarifications ?? [],
    unsupported: plan?.unsupportedSegments ?? [],
    cue,
    adapter,
  };
};
const holdsTotals = (operations: readonly ViewOperation[]) => operations.some((op) => op.type === TOTALS);

const read = (text: string, s = schema) => {
  const { clauses } = normalize(text);
  const clause = clauses[0];
  if (!clause || clauses.length !== 1) throw new Error(`“${text}” is not one part`);
  const mentions = matchMentions(clauses, s.columns.filter(isExposed), { rowNoun: s.rowNoun });
  return readViewWords(clause, mentions, s);
};

describe("the totals words (spec 5.2)", () => {
  // What the words name, and nothing of the current view: the compiler adds the view's other totals (spec 5.4).
  it.each([
    // Total: "total X", "sum of X", "show the total of X", "show total X". X is a number or currency column.
    ["total market value", [totals(sum("value"))]],
    ["sum of market value", [totals(sum("value"))]],
    ["show the total of market value", [totals(sum("value"))]],
    ["show total market value", [totals(sum("value"))]],
    ["total aum", [totals(sum("value"))]],
    ["Total unrealized gain.", [totals(sum("gain"))]],
    ["total risk score", [totals(sum("score"))]],
    ["also total gain", [totals(sum("gain"))]],
    // Average: "average X", "show the average of X". X is a number, currency or percent column.
    ["average market value", [totals(avg("value"))]],
    ["average risk score", [totals(avg("score"))]],
    ["average concentration", [totals(avg("concentration"))]],
    ["show the average of concentration", [totals(avg("concentration"))]],
    // Total by: the grouping first, as the Preview says it.
    ["total market value by advisor", [groupBy("advisor"), totals(sum("value"))]],
    ["sum of market value by advisor", [groupBy("advisor"), totals(sum("value"))]],
    ["average market value by advisor", [groupBy("advisor"), totals(avg("value"))]],
    ["average concentration by custodian", [groupBy("custodian"), totals(avg("concentration"))]],
    ["total gain by household", [groupBy("household"), totals(sum("gain"))]],
    // Clear totals: an empty list.
    ["remove the totals", [totals()]],
    ["clear the totals", [totals()]],
    ["no totals", [totals()]],
  ])("reads “%s” whole", (text, operations) => {
    const reading = read(text);
    expect(reading?.operations).toEqual(operations);
    expect(reading?.from).toBeUndefined();
  });

  it.each([
    "total market value please",
    "please total market value",
    "sum of market value now",
    "show the total of market value please",
    "show total market value now",
    "also total gain please",
    "average market value please",
    "show the average of concentration now",
    "total market value by advisor please",
    "average concentration by custodian now",
    "remove the totals please",
    "clear the totals now",
    "no totals please",
  ])("doesn't read “%s”: a word is left over", (text) => {
    expect(read(text)).toBeUndefined();
  });

  it.each([
    // The right column of spec 5.2: these go to the provider, as today. "Per" is not "by" until held-out evidence says so.
    "how much does each advisor manage",
    "how many accounts per advisor",
    "market value totals",
    "mean market value",
    "avg market value",
    "total market value per advisor",
    "average market value per advisor",
    "hide the totals",
    // A sum fits a number or a currency column only; an average a number, currency or percent column only.
    "total concentration",
    "sum of concentration",
    "show the total of concentration",
    "total concentration by custodian",
    "total advisor",
    "total custodian",
    "total opened",
    "total restricted holdings",
    "total notes",
    "average advisor",
    "average custodian",
    "average opened",
    "average restricted holdings",
    // A value is never a column, and a form needs its column.
    "total northgate",
    "total market value by northgate",
    "total",
    "totals",
    "average",
    "sum of",
    "total by advisor",
    // No request reaches a minimum, a maximum or a count of rows (spec 3, Out).
    "min market value",
    "max market value",
    "minimum market value",
    "maximum market value",
    "count market value",
    "count of market value",
    "median market value",
  ])("doesn't read “%s”", (text) => {
    expect(read(text)).toBeUndefined();
  });

  it("reads a total said at the end of a part after “and” or a comma, and says where", () => {
    const text = "group by advisor and total market value";
    expect(read(text)?.operations).toEqual([totals(sum("value"))]);
    expect(read(text)?.from).toBe(17);
    const listed = "sort by market value descending, average concentration";
    expect(read(listed)?.operations).toEqual([totals(avg("concentration"))]);
    expect(read(listed)?.from).toBe(31);
    // One word left over at the end and nothing is read.
    expect(read("group by advisor and total market value please")).toBeUndefined();
    // With no joining word, the words before are not the provider's alone.
    expect(read("group by advisor total market value")).toBeUndefined();
  });

  it("gives a span for each word it read, in the part's own text", () => {
    // OPEN: spec 4.1 lists five span kinds and none for a total's own word; section 15 calls it "a total". This names
    // the kind "total", and leaves "by" without a span, as "the" and "column" have none.
    expect(read("total market value by advisor")?.spans).toEqual([
      { start: 0, end: 5, kind: "total" },
      { start: 6, end: 18, kind: "column" },
      { start: 22, end: 29, kind: "column" },
    ]);
  });

  describe("beside a Host's name that holds a totals word", () => {
    const policies = defineSchema(
      [
        { id: "policy", label: "Policy number" },
        { id: "total_return", label: "Total return", kind: "percent" as const },
        { id: "sum_insured", label: "Sum insured", kind: "currency" as const },
        { id: "average_cost", label: "Average cost", kind: "currency" as const },
        { id: "premium", label: "Premium", kind: "currency" as const },
      ],
      { rowNoun: "policy" },
    );

    it("reads the Host's name first: the name alone is a column, never a total", () => {
      expect(read("total return", policies)).toBeUndefined();
      expect(read("average cost", policies)).toBeUndefined();
      expect(read("sum insured", policies)).toBeUndefined();
    });

    it("reads a form whose column is such a name", () => {
      expect(read("average total return", policies)?.operations).toEqual([totals(avg("total_return"))]);
      expect(read("total sum insured", policies)?.operations).toEqual([totals(sum("sum_insured"))]);
      expect(read("total average cost", policies)?.operations).toEqual([totals(sum("average_cost"))]);
      expect(read("sum of premium", policies)?.operations).toEqual([totals(sum("premium"))]);
      // A percent column takes an average only, whatever its name.
      expect(read("total total return", policies)).toBeUndefined();
    });

    it("reads a request that only names such a column as it did before, on a grid that lists totals or doesn't", async () => {
      for (const request of ["sort by total return", "hide average cost", "sort by sum insured descending"]) {
        const withTotals = await propose(request, { s: policies });
        const without = await propose(request, { s: policies, totals: false });
        expect(withTotals.status, request).toBe("ready");
        expect(holdsTotals(withTotals.operations), request).toBe(false);
        expect(withTotals.operations, request).toEqual(without.operations);
        expect(withTotals.lines, request).toEqual(without.lines);
      }
    });
  });
});

describe("totals on a grid that lists them (spec 5.4)", () => {
  it.each([
    ["total market value", [totals(sum("value"))], ["Show the total of Market value"]],
    ["sum of market value", [totals(sum("value"))], ["Show the total of Market value"]],
    ["show the total of market value", [totals(sum("value"))], ["Show the total of Market value"]],
    ["average concentration", [totals(avg("concentration"))], ["Show the average of Concentration"]],
    ["total market value by advisor", [groupBy("advisor"), totals(sum("value"))], ["Group by Advisor", "Show the total of Market value"]],
    ["sum of market value by advisor", [groupBy("advisor"), totals(sum("value"))], ["Group by Advisor", "Show the total of Market value"]],
    [
      "average concentration by custodian",
      [groupBy("custodian"), totals(avg("concentration"))],
      ["Group by Custodian", "Show the average of Concentration"],
    ],
    [
      "group by advisor and show total market value",
      [groupBy("advisor"), totals(sum("value"))],
      ["Group by Advisor", "Show the total of Market value"],
    ],
    [
      "hide custodian and show the total of market value",
      [{ type: "columns.hide", columnIds: ["custodian"] }, totals(sum("value"))],
      ["Hide Custodian", "Show the total of Market value"],
    ],
  ])("“%s” is ready", async (request, operations, lines) => {
    const result = await propose(request);
    expect(result.status).toBe("ready");
    expect(result.operations).toEqual(operations);
    expect(result.lines).toEqual(lines);
  });

  it("applies one grand total for “total market value” on a view with no grouping, and undoes it", async () => {
    const result = await propose("total market value");
    expect(await result.cue.apply()).toBe(true);
    const applied = result.adapter.getState().state;
    expect(applied.aggregations).toEqual([sum("value")]);
    expect(applied.groupBy).toEqual([]);
    expect(await result.cue.undo()).toBe(true);
    expect(result.adapter.getState().state.aggregations).toEqual([]);
  });

  it("keeps the view's grouping for a total that names none", async () => {
    const result = await propose("total market value", { view: { groupBy: ["advisor"] } });
    expect(result.operations).toEqual([totals(sum("value"))]);
    expect(await result.cue.apply()).toBe(true);
    expect(result.adapter.getState().state.groupBy).toEqual(["advisor"]);
  });

  it("sets the grouping to Y for “total X by Y”, replacing the current one", async () => {
    const result = await propose("total market value by custodian", { view: { groupBy: ["advisor"] } });
    expect(result.operations).toEqual([groupBy("custodian"), totals(sum("value"))]);
    expect(result.lines).toEqual(["Group by Custodian", "Show the total of Market value"]);
    expect(await result.cue.apply()).toBe(true);
    const applied = result.adapter.getState().state;
    expect(applied.groupBy).toEqual(["custodian"]);
    expect(applied.aggregations).toEqual([sum("value")]);
    // Two levels go too: the grouping is Y alone, as "group by Y" sets it today.
    const nested = await propose("average concentration by custodian", { view: { groupBy: ["advisor", "household"] } });
    expect(nested.operations).toEqual([groupBy("custodian"), totals(avg("concentration"))]);
  });

  it("asks when “total X by Y” would replace a grouping the same request set", async () => {
    // Before, the plan held both groupings, the Preview showed both lines, and only the second applied.
    for (const request of [
      "group by advisor, total market value by custodian",
      "group by advisor and total market value by custodian",
      "group by advisor. average concentration by custodian",
    ]) {
      const result = await propose(request);
      expect(result.status, request).toBe("needs_clarification");
      expect(result.operations, request).toEqual([]);
      expect(
        result.questions.map((q) => q.prompt),
        request,
      ).toEqual(["GridCue can't group by Advisor and by Custodian too. To group by both, say “group by advisor, then custodian”."]);
      expect(result.questions[0]?.options ?? [], request).toEqual([]);
    }
    // The same grouping said twice is no change, and a grouping the view had before the request is replaced as before.
    const same = await propose("group by advisor, total market value by advisor");
    expect(same.operations).toEqual([groupBy("advisor"), totals(sum("value"))]);
    // On a grid that draws no totals the request ends in the one question, as any totals request does.
    const cant = await propose("group by advisor, total market value by custodian", { totals: false });
    expect(cant.questions.map((q) => q.prompt)).toEqual([CANT]);
    expect(cant.operations).toEqual([]);
  });

  it("reads a total at the end of a part, and keeps of the provider's proposal only what the rest of the part names", async () => {
    // Before, the provider read both columns as grouping levels, or as two sorts, and the totals word was dropped.
    const grouped = await propose("group by advisor and total market value");
    expect(grouped.operations).toEqual([groupBy("advisor"), totals(sum("value"))]);
    expect(grouped.lines).toEqual(["Group by Advisor", "Show the total of Market value"]);
    // After a sort, the words may be one more column to sort by, so the part asks (below).
    const sorted = await propose("sort by market value descending, average concentration");
    expect(sorted.status).toBe("needs_clarification");
  });

  describe("a new total is added to the view's totals", () => {
    const view = { aggregations: [sum("value")] };

    it("carries the whole list in the plan, and the Preview names only the new total", async () => {
      const result = await propose("also total gain", { view });
      expect(result.status).toBe("ready");
      expect(result.operations).toEqual([totals(sum("value"), sum("gain"))]);
      expect(result.lines).toEqual(["Show the total of Unrealized gain"]);
      expect(await result.cue.apply()).toBe(true);
      expect(result.adapter.getState().state.aggregations).toEqual([sum("value"), sum("gain")]);
    });

    it.each([
      ["total gain", [sum("value"), sum("gain")], ["Show the total of Unrealized gain"]],
      ["average concentration", [sum("value"), avg("concentration")], ["Show the average of Concentration"]],
      ["sum of risk score", [sum("value"), sum("score")], ["Show the total of Risk score"]],
    ])("never drops the total on another column for “%s”", async (request, list, lines) => {
      const result = await propose(request, { view });
      expect(result.operations).toEqual([totals(...list)]);
      expect(result.lines).toEqual(lines);
    });

    it("keeps every other total through “total X by Y” too", async () => {
      const result = await propose("total gain by advisor", { view: { aggregations: [sum("value"), avg("concentration")] } });
      expect(result.operations).toEqual([groupBy("advisor"), totals(sum("value"), avg("concentration"), sum("gain"))]);
      expect(result.lines).toEqual(["Group by Advisor", "Show the total of Unrealized gain"]);
    });
  });

  describe("a column holds one total at a time", () => {
    it("replaces the total with the average, and the Preview says so", async () => {
      const result = await propose("average market value", { view: { aggregations: [sum("value")] } });
      expect(result.status).toBe("ready");
      expect(result.operations).toEqual([totals(avg("value"))]);
      expect(result.lines).toEqual(["Show the average of Market value instead of its total"]);
      expect(await result.cue.apply()).toBe(true);
      expect(result.adapter.getState().state.aggregations).toEqual([avg("value")]);
    });

    it("replaces the average with the total, and the Preview says so", async () => {
      const result = await propose("total market value", { view: { aggregations: [avg("value")] } });
      expect(result.operations).toEqual([totals(sum("value"))]);
      expect(result.lines).toEqual(["Show the total of Market value instead of its average"]);
    });

    it("replaces it where it stands, and keeps the totals on other columns", async () => {
      const result = await propose("average market value", { view: { aggregations: [sum("value"), sum("gain")] } });
      expect(result.operations).toEqual([totals(avg("value"), sum("gain"))]);
      expect(result.lines).toEqual(["Show the average of Market value instead of its total"]);
    });

    it("ranks the groups by the one total that is left: 60 and 60 against 100", async () => {
      // "Total market value", then a sort on it, then "average market value". A group with 60 and 60 totals 120 and
      // comes before a group with 100. Its average is 60, so it comes after once the average replaces the total.
      const rows = [
        { account: "A-1", advisor: "North desk", value: 60 },
        { account: "A-2", advisor: "South desk", value: 100 },
        { account: "A-3", advisor: "North desk", value: 60 },
      ];
      const { cue, adapter } = grid();
      const shown = () => {
        const result = applyView(rows, adapter.getState().state, schema);
        return result.groups?.map((g) => [g.key.advisor, g.totals.map((t) => t.value)]);
      };
      await cue.propose("total market value by advisor");
      expect(await cue.apply()).toBe(true);
      await cue.propose("sort by market value descending");
      expect(await cue.apply()).toBe(true);
      expect(shown()).toEqual([
        ["North desk", [120]],
        ["South desk", [100]],
      ]);
      const plan = await cue.propose("average market value");
      expect(plan?.operations).toEqual([totals(avg("value"))]);
      expect(cue.getState().preview?.lines).toEqual(["Show the average of Market value instead of its total"]);
      expect(await cue.apply()).toBe(true);
      expect(adapter.getState().state.aggregations).toEqual([avg("value")]);
      expect(shown()).toEqual([
        ["South desk", [100]],
        ["North desk", [60]],
      ]);
      // Undo brings the total back, and its order with it.
      expect(await cue.undo()).toBe(true);
      expect(adapter.getState().state.aggregations).toEqual([sum("value")]);
      expect(shown()).toEqual([
        ["North desk", [120]],
        ["South desk", [100]],
      ]);
    });
  });

  describe("removing the totals", () => {
    const view = { aggregations: [sum("value"), avg("concentration")], groupBy: ["advisor"] };

    it.each(["remove the totals", "clear the totals", "no totals"])("“%s” removes every total, and nothing else", async (request) => {
      const result = await propose(request, { view });
      expect(result.status).toBe("ready");
      expect(result.operations).toEqual([totals()]);
      expect(result.lines).toEqual(["Remove the totals"]);
      expect(await result.cue.apply()).toBe(true);
      const applied = result.adapter.getState().state;
      expect(applied.aggregations).toEqual([]);
      expect(applied.groupBy).toEqual(["advisor"]);
      expect(await result.cue.undo()).toBe(true);
      expect(result.adapter.getState().state.aggregations).toEqual(view.aggregations);
    });

    it("says the grid already shows the view when there is no total to remove, or the total asked for is there", async () => {
      // OPEN: the spec has no row for a totals request that changes nothing. This follows its row for "unpin
      // everything" with nothing pinned (5.3): no line that claims a change, and the one "already shows" question.
      const already = [{ id: "plan.empty", prompt: "The grid already shows this view.", required: true }];
      for (const request of ["remove the totals", "no totals"]) {
        const none = await propose(request);
        expect(none.status, request).toBe("needs_clarification");
        expect(none.questions, request).toEqual(already);
      }
      const same = await propose("total market value", { view: { aggregations: [sum("value")] } });
      expect(same.status).toBe("needs_clarification");
      expect(same.questions).toEqual(already);
    });
  });

  describe("a total that doesn't fit its column's kind (ADR 0030)", () => {
    const PERCENT = "Concentration can't be totalled. Show its average instead?";

    it.each(["total concentration", "sum of concentration", "show the total of concentration"])(
      "asks “Concentration can't be totalled. Show its average instead?” for “%s”, and applies nothing",
      async (request) => {
        const result = await propose(request);
        expect(result.status).toBe("needs_clarification");
        expect(result.operations).toEqual([]);
        expect(result.lines).toBeNull();
        expect(result.questions.map((q) => q.prompt)).toEqual([PERCENT]);
        expect(result.questions[0]?.id).toMatch(/^c0\./);
        expect(await result.cue.apply()).toBe(false);
        expect(result.adapter.getState().state.aggregations).toEqual([]);
      },
    );

    it("offers the average, and a way out", async () => {
      // OPEN: the spec gives the prompt and no choices. A question with a question mark and no button would dead-end,
      // so it has two: "Yes" shows the average, "No" changes nothing, as "Did you want to …?" has today.
      const asked = await propose("total concentration");
      const [question] = asked.questions;
      expect(question?.options?.map((o) => o.label)).toEqual(["Yes", "No"]);
      const [yes, no] = question?.options ?? [];
      const plan = asked.cue.answer(question?.id ?? "", yes?.id ?? "");
      expect(plan?.status).toBe("ready");
      expect(plan?.operations).toEqual([totals(avg("concentration"))]);
      expect(asked.cue.getState().preview?.lines).toEqual(["Show the average of Concentration"]);
      expect(await asked.cue.apply()).toBe(true);
      expect(asked.adapter.getState().state.aggregations).toEqual([avg("concentration")]);

      const again = await propose("total concentration");
      const declined = again.cue.answer(again.questions[0]?.id ?? "", no?.id ?? "");
      expect(declined?.status).toBe("needs_clarification");
      expect(declined?.operations).toEqual([]);
      expect(declined?.clarifications.map((q) => q.prompt)).toEqual(["Okay, nothing will change. Rephrase or edit your request."]);
      expect(await again.cue.apply()).toBe(false);
      expect(again.adapter.getState().state.aggregations).toEqual([]);
    });

    it("asks the same for “total concentration by custodian”, and “Yes” keeps the grouping it named", async () => {
      const asked = await propose("total concentration by custodian");
      expect(asked.status).toBe("needs_clarification");
      expect(asked.operations).toEqual([]);
      expect(asked.questions.map((q) => q.prompt)).toEqual([PERCENT]);
      const [question] = asked.questions;
      const plan = asked.cue.answer(question?.id ?? "", question?.options?.[0]?.id ?? "");
      expect(plan?.operations).toEqual([groupBy("custodian"), totals(avg("concentration"))]);
      expect(asked.cue.getState().preview?.lines).toEqual(["Group by Custodian", "Show the average of Concentration"]);
    });

    it.each([
      "total advisor",
      "sum of account number",
      "total custodian",
      "total opened",
      "total restricted holdings",
      "average advisor",
      "average custodian",
      "average opened",
      "average restricted holdings",
      "total advisor by custodian",
    ])("never totals a text, enum, date or yes/no column: “%s” is not ready", async (request) => {
      const result = await propose(request);
      expect(result.status).not.toBe("ready");
      expect(holdsTotals(result.operations)).toBe(false);
      expect(await result.cue.apply()).toBe(false);
      const applied = result.adapter.getState().state;
      expect(applied.aggregations).toEqual([]);
      expect(applied.groupBy).toEqual([]);
    });

    it("says which column can't take the total, with no choices, when no total fits its kind", async () => {
      // OPEN: the spec gives the question for a percent column only. For a kind no total fits there is nothing to
      // offer, so the question has no choices, as "This grid can't …" has none.
      const text = await propose("total advisor");
      expect(text.questions.map((q) => q.prompt)).toEqual(["Advisor can't be totalled."]);
      expect(text.questions[0]?.options).toBeUndefined();
      const date = await propose("average opened");
      expect(date.questions.map((q) => q.prompt)).toEqual(["Opened can't be averaged."]);
      const yesNo = await propose("total restricted holdings");
      expect(yesNo.questions.map((q) => q.prompt)).toEqual(["Restricted holdings can't be totalled."]);
    });
  });

  describe("a column that may not be totalled", () => {
    it("never totals a restricted column", async () => {
      const result = await propose("total tax id");
      expect(result.status).toBe("unsupported");
      expect(result.unsupported).toEqual([{ category: "restricted_column" }]);
      expect(holdsTotals(result.operations)).toBe(false);
    });

    it.each(["total annual fee", "average annual fee", "total annual fee by advisor"])(
      "never totals a column whose capabilities leave aggregate out: “%s” is not ready",
      async (request) => {
        const result = await propose(request);
        expect(result.status).not.toBe("ready");
        expect(holdsTotals(result.operations)).toBe(false);
        expect(await result.cue.apply()).toBe(false);
      },
    );

    it("says so, as a pin on such a column does", async () => {
      // OPEN: the words follow "GridCue can't pin Notes here." (the pins PR). The spec has no line for it.
      const result = await propose("total annual fee");
      expect(result.questions.map((q) => q.prompt)).toEqual(["GridCue can't total Annual fee here."]);
      expect(result.questions[0]?.id).toMatch(/^c0\./);
      expect(result.questions[0]?.options).toBeUndefined();
    });
  });

  it("shows a hidden column before its total, so the Preview says both", async () => {
    // OPEN: spec 4.4 says this for a pin and is silent for a total. A total on a hidden column draws nothing, so the
    // request would apply and change nothing the User sees.
    const hidden = columns.map((c) => c.id).filter((id) => id !== "ssn" && id !== "value");
    const result = await propose("total market value", { view: { visibleColumnIds: hidden } });
    expect(result.operations).toEqual([{ type: "columns.show", columnIds: ["value"] }, totals(sum("value"))]);
    expect(result.lines).toEqual(["Show Market value", "Show the total of Market value"]);
  });

  it("applies both totals when one request asks for two", async () => {
    // OPEN: spec 5.2 lists each form on its own. Two of them joined by "and" make up the whole part, as "pin advisor
    // and compact view" does, so both are read. Each total is one the spec's rows name; no other reading is added.
    const result = await propose("total market value and average concentration");
    expect(result.status).toBe("ready");
    expect(await result.cue.apply()).toBe(true);
    expect(result.adapter.getState().state.aggregations).toEqual([sum("value"), avg("concentration")]);
  });

  describe("two totals in one request (spec 5.4)", () => {
    // The plan's `aggregation.set` carries the whole list: one operation, however many totals forms the request holds.
    it.each([
      [
        "total market value and average concentration",
        {},
        [totals(sum("value"), avg("concentration"))],
        ["Show the total of Market value and the average of Concentration"],
      ],
      [
        "total market value, average concentration",
        {},
        [totals(sum("value"), avg("concentration"))],
        ["Show the total of Market value and the average of Concentration"],
      ],
      [
        "average concentration and total market value by advisor",
        {},
        [groupBy("advisor"), totals(avg("concentration"), sum("value"))],
        ["Group by Advisor", "Show the average of Concentration and the total of Market value"],
      ],
      [
        "total market value by advisor and average concentration",
        {},
        [groupBy("advisor"), totals(sum("value"), avg("concentration"))],
        ["Group by Advisor", "Show the total of Market value and the average of Concentration"],
      ],
      [
        "also total gain and average concentration",
        { aggregations: [sum("value")] },
        [totals(sum("value"), sum("gain"), avg("concentration"))],
        ["Show the total of Unrealized gain and the average of Concentration"],
      ],
      [
        "total gain, group by advisor, average concentration",
        {},
        [groupBy("advisor"), totals(sum("gain"), avg("concentration"))],
        ["Group by Advisor", "Show the total of Unrealized gain and the average of Concentration"],
      ],
    ] as Array<[string, Partial<ViewState>, ViewOperation[], string[]]>)(
      "carries both in one list for “%s”",
      async (request, view, operations, lines) => {
        const result = await propose(request, { view });
        expect(result.status).toBe("ready");
        expect(result.operations).toEqual(operations);
        expect(result.lines).toEqual(lines);
        expect(await result.cue.apply()).toBe(true);
        const applied = operations.find((op) => op.type === TOTALS);
        expect(result.adapter.getState().state.aggregations).toEqual(applied?.type === TOTALS ? applied.aggregations : []);
      },
    );

    // A column holds one total at a time (spec 4.4), so two totals on one column in one request can't both show. Nor can
    // a total the same request then removes. Whatever the view already shows, the request asks, and nothing applies.
    const oneTotal = "Market value shows one total at a time. Ask for its total or its average.";
    it.each([
      ["total market value and average market value", oneTotal],
      ["total market value and sum of market value", oneTotal],
      ["total market value and total market value", oneTotal],
      ["average market value and total market value by advisor", oneTotal],
      ["total market value and remove the totals", "GridCue can't show the total of Market value and remove the totals too."],
      ["average market value, no totals", "GridCue can't show the average of Market value and remove the totals too."],
    ])("asks for “%s”, whatever totals the view shows", async (request, prompt) => {
      const views: Array<Partial<ViewState>> = [{}, { aggregations: [sum("value")] }, { aggregations: [avg("value"), sum("gain")] }];
      for (const view of views) {
        const result = await propose(request, { view });
        expect(result.status).toBe("needs_clarification");
        expect(result.questions.map((q) => q.prompt)).toEqual([prompt]);
        expect(result.questions[0]?.options).toBeUndefined();
        expect(await result.cue.apply()).toBe(false);
        expect(result.adapter.getState().state.aggregations).toEqual(view.aggregations ?? []);
      }
    });

    it("asks the same where the two totals are in different parts", async () => {
      for (const view of [{}, { aggregations: [sum("value")] }]) {
        const result = await propose("total market value, then average market value", { view });
        expect(result.status).toBe("needs_clarification");
        expect(result.questions.map((q) => q.prompt)).toEqual([oneTotal]);
      }
    });

    it("adds the second to the first after a reset, where the default view's totals aren't given", async () => {
      // The provider's reading, as the controller gets it, compiled by a caller that gives no default view.
      const text = "reset the view, total market value and average concentration";
      const seen: ResolutionResult[] = [];
      const recorder: IntentProvider = {
        resolve: async (request, signal) => {
          const out = await mock.resolve(request, signal);
          seen.push(out);
          return out;
        },
      };
      const { cue, adapter } = grid({ view: { aggregations: [sum("gain")] }, provider: recorder });
      await cue.propose(text);
      const resolution = seen[0];
      if (!resolution) throw new Error("the provider was not called");
      const input = normalize(text);
      const plan = compile({
        input,
        resolution,
        schema,
        state: adapter.getState().state,
        baseRevision: "r1",
        channel: "typed",
        mentions: matchMentions(input.clauses, schema.columns.filter(isExposed), { rowNoun: schema.rowNoun }),
        operations: adapter.getCapabilities().operations,
        newId: (p) => p,
      });
      expect(plan.status).toBe("ready");
      // The columns that show after the reset aren't given either, so each total's column is shown first, as before.
      expect(plan.operations).toEqual([
        { type: "view.reset" },
        { type: "columns.show", columnIds: ["value"] },
        { type: "columns.show", columnIds: ["concentration"] },
        totals(sum("value"), avg("concentration")),
      ]);
      expect(renderPreview(plan, schema, adapter.getState().state).lines).toEqual([
        "Reset the view",
        "Show Market value",
        "Show Concentration",
        "Show the total of Market value and the average of Concentration",
      ]);
    });

    it("still reads a clear said before a total with its own verb: the total replaces the view's", async () => {
      const result = await propose("remove the totals and show the total of market value", {
        view: { aggregations: [sum("value"), sum("gain")] },
      });
      expect(result.status).toBe("ready");
      expect(result.operations).toEqual([totals(sum("value"))]);
      expect(result.lines).toEqual(["Remove the total of Unrealized gain"]);
    });
  });

  it.each([
    "how many accounts per advisor",
    "how much does each advisor manage",
    "total market value per advisor",
    "market value totals",
    "mean market value",
    "avg market value",
    "hide the totals",
    // A minimum, a maximum and a count of rows are valid in the protocol and reached by no request.
    "min market value",
    "max market value",
    "minimum market value",
    "maximum market value",
    "count of accounts",
    "count market value",
  ])("still asks for “%s”", async (request) => {
    const result = await propose(request, { view: { aggregations: [sum("value")] } });
    expect(result.status).not.toBe("ready");
    expect(holdsTotals(result.operations)).toBe(false);
    expect(await result.cue.apply()).toBe(false);
    expect(result.adapter.getState().state.aggregations).toEqual([sum("value")]);
  });
});

describe("a grid that doesn't draw totals says so (spec 4.2 and 5.4; order plan D3)", () => {
  const expectCant = async (request: string, setup: Parameters<typeof grid>[0] = {}) => {
    const { adapter, cue } = grid({ ...setup, totals: false });
    const before = adapter.getState();
    const plan = await cue.propose(request);
    expect(cue.getState().status, request).toBe("needs_clarification");
    expect(cue.getState().preview, request).toBeNull();
    expect(plan?.operations, request).toEqual([]);
    expect(plan?.unsupportedSegments, request).toEqual([]);
    expect(
      plan?.clarifications.map((q) => q.prompt),
      request,
    ).toEqual([CANT]);
    expect(plan?.clarifications.every((q) => q.options === undefined)).toBe(true);
    expect(await cue.apply()).toBe(false);
    expect(adapter.getState()).toEqual(before);
  };

  it.each([
    "total market value",
    "sum of market value",
    "show the total of market value",
    "show total market value",
    "average concentration",
    "show the average of concentration",
    "also total gain",
    "remove the totals",
    "clear the totals",
    "no totals",
  ])("asks “This grid can't show totals.” for “%s”", async (request) => {
    await expectCant(request);
  });

  it("asks it for a view that holds totals too", async () => {
    await expectCant("remove the totals", { view: { aggregations: [sum("value")] } });
    await expectCant("average market value", { view: { aggregations: [sum("value")] } });
  });

  it("applies nothing in the request, the grouping of “total X by Y” included", async () => {
    await expectCant("total market value by advisor");
    await expectCant("average concentration by custodian");
    await expectCant("group by advisor and show total market value");
    await expectCant("group by advisor and total market value");
    await expectCant("hide custodian and show the total of market value");
    await expectCant("sort by market value descending, average concentration");
  });

  it("asks it, and not about the column's kind, for a total the grid couldn't show whatever the column", async () => {
    await expectCant("total concentration");
    await expectCant("total concentration by custodian");
  });

  it("uses the one shared question, with an ID that starts with its part's index", () => {
    const question = cantQuestion(2, { type: TOTALS });
    expect(question).toEqual({ id: expect.stringMatching(/^c2\.cant\b/), prompt: CANT, required: true });
    expect(question.options).toBeUndefined();
  });

  it("refuses a request with a part outside the view-only rule, on either grid", async () => {
    for (const setup of [{}, { totals: false }]) {
      const result = await propose("total market value and export the list", setup);
      expect(result.status).toBe("unsupported");
      expect(holdsTotals(result.operations)).toBe(false);
    }
  });

  it("reads a request with no totals word exactly as a grid that lists totals does", async () => {
    for (const request of [
      "sort by market value descending",
      "group by advisor",
      "group by advisor, sort by market value descending",
      "northgate accounts over $1m",
      "hide custodian",
      "top 10 by market value",
      "largest households first",
      "how many accounts per advisor",
      "reset the view",
    ]) {
      const withTotals = await propose(request);
      const without = await propose(request, { totals: false });
      expect(without.status, request).toBe(withTotals.status);
      expect(without.operations, request).toEqual(withTotals.operations);
      expect(without.lines, request).toEqual(withTotals.lines);
      expect(without.questions, request).toEqual(withTotals.questions);
    }
  });
});

describe("a totals word no form read never leaves a ready plan (spec 5.2; order plan, section 11)", () => {
  // Code reads a form only as a whole part or its end. Said anywhere else, the word went to the provider with the
  // rest of the part, which read the rest and dropped it: "sort by total market value" sorted Market value from low to
  // high, and "northgate accounts total" filtered and showed no total. Each of these was a ready Preview before.
  const formAsks = (said: string) => `GridCue can't tell how “${said}” fits with the rest of that part. Try asking for it on its own.`;
  const wordAsks = (said: string) => `I'm not sure what to do with “${said}”. Try rephrasing that part.`;

  it.each([
    // A form that starts at the word, with the provider's words before it and no "and" or comma between.
    ["sort by total market value", formAsks("total market value")],
    ["sort by average concentration", formAsks("average concentration")],
    // The word alone.
    ["northgate accounts total", wordAsks("total")],
    ["northgate accounts sum", wordAsks("sum")],
    ["group by advisor with totals", wordAsks("totals")],
    ["hide custodian total", wordAsks("total")],
  ])("asks for “%s” on a grid that lists totals", async (request, prompt) => {
    const result = await propose(request);
    expect(result.status, request).toBe("needs_clarification");
    expect(result.operations).toEqual([]);
    expect(result.questions.map((q) => q.prompt)).toEqual([prompt]);
    expect(await result.cue.apply()).toBe(false);
  });

  it.each([
    "total market value for northgate accounts",
    "average concentration of northgate accounts",
    "show the average of northgate accounts",
  ])("is never ready for “%s” on a grid that lists totals", async (request) => {
    const result = await propose(request);
    expect(result.status).not.toBe("ready");
    expect(result.operations).toEqual([]);
  });

  it.each([
    "sort by total market value",
    "sort by average concentration",
    "total market value for northgate accounts",
    "average concentration of northgate accounts",
    // OPEN: the word alone. A pin word no form starts at ("pinned") asks the same question on both grids. A totals
    // word alone asks for a total, so the grid says it can't show one, as the lead's rule for this PR has it, rather
    // than ask for other words that would end in the same answer.
    "northgate accounts total",
    "northgate accounts sum",
    "group by advisor with totals",
    "hide custodian total",
  ])("asks only “This grid can't show totals.” for “%s” on a grid that doesn't", async (request) => {
    const result = await propose(request, { totals: false });
    expect(result.status).toBe("needs_clarification");
    expect(result.operations).toEqual([]);
    expect(result.questions.map((q) => q.prompt)).toEqual([CANT]);
    expect(result.questions[0]?.options).toBeUndefined();
    expect(await result.cue.apply()).toBe(false);
  });

  it("reads as before where the word is quoted text to match", async () => {
    for (const request of ['household contains "total"', 'advisor contains "average"']) {
      const withTotals = await propose(request);
      const without = await propose(request, { totals: false });
      expect(withTotals.status, request).toBe("ready");
      expect(withTotals.operations, request).toEqual(without.operations);
      expect(withTotals.lines, request).toEqual(without.lines);
      expect(holdsTotals(withTotals.operations), request).toBe(false);
    }
  });
});

describe("the third choice of the ranked-group question (spec 5.4; ADR 0030)", () => {
  const WHOLE = "Did you mean households as a whole? GridCue can group by Household.";
  const GROUP = { id: "group", label: "Group by Household" };
  const COLUMN = { id: "column", label: "Use the Household column" };
  const labels = (q: { options?: Array<{ label: string }> } | undefined) => q?.options?.map((o) => o.label);

  it.each(["largest households first", "biggest households first", "top households first", "smallest households first"])(
    "offers three choices for “%s” where the Host has a main value column",
    async (request) => {
      const result = await propose(request, { s: measured });
      expect(result.status).toBe("needs_clarification");
      expect(result.operations).toEqual([]);
      expect(result.questions).toHaveLength(1);
      const [question] = result.questions;
      expect(question?.id).toBe("c0.reading.household");
      expect(question?.prompt).toBe(WHOLE);
      expect(question?.required).toBe(true);
      expect(question?.options?.slice(0, 2)).toEqual([GROUP, COLUMN]);
      expect(labels(question)).toEqual(["Group by Household", "Use the Household column", "Rank households by total Market value"]);
    },
  );

  it("names the entity the request ranks", async () => {
    const result = await propose("largest advisors first", { s: measured });
    expect(labels(result.questions[0])).toEqual(["Group by Advisor", "Use the Advisor column", "Rank advisors by total Market value"]);
  });

  it("keeps today's two choices without a main value column", async () => {
    const result = await propose("largest households first");
    expect(result.questions).toEqual([{ id: "c0.reading.household", prompt: WHOLE, options: [GROUP, COLUMN], required: true }]);
  });

  it("keeps today's two choices on a grid that doesn't list totals, with a main value column or without", async () => {
    for (const s of [measured, schema]) {
      const result = await propose("largest households first", { s, totals: false });
      expect(result.questions).toEqual([{ id: "c0.reading.household", prompt: WHOLE, options: [GROUP, COLUMN], required: true }]);
    }
  });

  it("keeps today's two choices where the main value column may not be totalled", async () => {
    // Annual fee may be sorted, and its capabilities leave aggregate out.
    const fees = defineSchema(columns, { ...options, defaultMeasure: "fee" });
    const result = await propose("largest households first", { s: fees });
    expect(result.questions).toEqual([{ id: "c0.reading.household", prompt: WHOLE, options: [GROUP, COLUMN], required: true }]);
  });

  /** Proposes `request`, picks the question's third choice, and returns the plan it makes. */
  const rank = async (request: string, setup: Parameters<typeof grid>[0] = {}) => {
    const asked = await propose(request, { s: measured, ...setup });
    const [question] = asked.questions;
    const third = question?.options?.[2];
    const plan = asked.cue.answer(question?.id ?? "", third?.id ?? "no third choice");
    return { ...asked, plan, lines: asked.cue.getState().preview?.lines ?? null, label: third?.label };
  };

  it("applies the grouping, the total and a descending sort on the total's column, and the Preview shows all three", async () => {
    const result = await rank("largest households first");
    expect(result.plan?.status).toBe("ready");
    expect(result.plan?.operations).toEqual([
      groupBy("household"),
      totals(sum("value")),
      { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
    ]);
    expect(result.lines).toEqual(["Group by Household", "Show the total of Market value", "Sort by Market value, descending"]);
    expect(await result.cue.apply()).toBe(true);
    const applied = result.adapter.getState().state;
    expect(applied.groupBy).toEqual(["household"]);
    expect(applied.aggregations).toEqual([sum("value")]);
    expect(applied.sorts).toEqual([{ columnId: "value", direction: "desc" }]);
  });

  it("sorts ascending for “smallest”", async () => {
    const result = await rank("smallest households first");
    expect(result.label).toBe("Rank households by total Market value");
    expect(result.plan?.operations).toEqual([
      groupBy("household"),
      totals(sum("value")),
      { type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] },
    ]);
    expect(result.lines).toEqual(["Group by Household", "Show the total of Market value", "Sort by Market value, ascending"]);
  });

  it("ranks the households by their total once applied: the largest first, or the smallest", async () => {
    const rows = [
      { account: "A-1", household: "Alder", value: 60 },
      { account: "A-2", household: "Birch", value: 100 },
      { account: "A-3", household: "Alder", value: 60 },
      { account: "A-4", household: "Cedar", value: 30 },
    ];
    const ranked = async (request: string) => {
      const result = await rank(request);
      expect(await result.cue.apply()).toBe(true);
      return applyView(rows, result.adapter.getState().state, measured).groups?.map((g) => g.key.household);
    };
    expect(await ranked("largest households first")).toEqual(["Alder", "Birch", "Cedar"]);
    expect(await ranked("smallest households first")).toEqual(["Cedar", "Birch", "Alder"]);
  });

  it("adds its total to the view's totals, and replaces the grouping and the sort", async () => {
    const view = {
      aggregations: [sum("gain")],
      groupBy: ["advisor"],
      sorts: [{ columnId: "account", direction: "asc" as const }],
    };
    const result = await rank("largest households first", { view });
    expect(result.plan?.operations).toEqual([
      groupBy("household"),
      totals(sum("gain"), sum("value")),
      { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
    ]);
    expect(result.lines).toEqual(["Group by Household", "Show the total of Market value", "Sort by Market value, descending"]);
  });

  it("ranks by an average where the column's kind takes no sum", async () => {
    const byShare = defineSchema(columns, { ...options, defaultMeasure: "concentration" });
    const result = await rank("largest households first", { s: byShare });
    expect(result.label).toBe("Rank households by average Concentration");
    expect(result.plan?.operations).toEqual([
      groupBy("household"),
      totals(avg("concentration")),
      { type: "sort.set", sorts: [{ columnId: "concentration", direction: "desc" }] },
    ]);
    expect(result.lines).toEqual(["Group by Household", "Show the average of Concentration", "Sort by Concentration, descending"]);
  });

  it("ranks by the column the request names, before the main value column", async () => {
    // OPEN: spec 5.4's row for "most concentrated households first" needs "concentrated" to name Concentration, and
    // nothing a Host declares says so. ADR 0030 offers the choice "when the request names a column". Here the Intent
    // Provider names it, as it names the column of a sort, and the choice says which column, so the User decides. The
    // Mock Provider names none for these words, so with it the question keeps the choices it has without this column.
    const picksConcentration: IntentProvider = {
      resolve: async () => ({
        clauses: [
          {
            clauseIndex: 0,
            families: [{ id: "sort", confidence: 0.95 }],
            columns: [{ id: "concentration", confidence: 0.95 }],
            values: [],
            unmatchedTerms: [],
          },
        ],
      }),
    };
    for (const s of [measured, schema]) {
      const result = await rank("most concentrated households first", { s, provider: picksConcentration });
      expect(labels(result.questions[0])).toEqual([
        "Group by Household",
        "Use the Household column",
        "Rank households by average Concentration",
      ]);
      expect(result.plan?.operations).toEqual([
        groupBy("household"),
        totals(avg("concentration")),
        { type: "sort.set", sorts: [{ columnId: "concentration", direction: "desc" }] },
      ]);
      expect(result.lines).toEqual(["Group by Household", "Show the average of Concentration", "Sort by Concentration, descending"]);
    }
  });

  it("leaves the other two choices as they are", async () => {
    const asked = await propose("largest households first", { s: measured });
    const plan = asked.cue.answer("c0.reading.household", "group");
    expect(plan?.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }, groupBy("household")]);
    expect(asked.cue.getState().preview?.lines).toEqual(["Sort by Market value, descending", "Group by Household"]);
  });
});

describe("the column default (spec 4.3; ADR 0029)", () => {
  const capabilitiesOf = (id: string, s = schema) => s.columns.find((c) => c.id === id)?.capabilities ?? [];
  const sorted = (list: readonly ColumnCapability[]) => [...list].sort();

  it("lets number, currency and percent columns be totalled, beside the defaults", () => {
    for (const id of ["value", "gain", "score", "concentration"]) {
      expect(sorted(capabilitiesOf(id)), id).toEqual(sorted([...DEFAULT_CAPABILITIES, "aggregate"]));
    }
  });

  it("gives no other kind the capability", () => {
    const kinds = defineSchema([
      { id: "text" },
      { id: "choice", kind: "enum" },
      { id: "day", kind: "date" },
      { id: "moment", kind: "datetime" },
      { id: "flag", kind: "boolean" },
    ]);
    for (const column of kinds.columns) expect(column.capabilities, column.id).toEqual(DEFAULT_CAPABILITIES);
    expect(DEFAULT_CAPABILITIES).not.toContain("aggregate");
  });

  it("gives it to a column whose kind is read from sample rows", () => {
    const inferred = defineSchema([{ id: "amount" }, { id: "name" }], { sampleRows: [{ amount: 12.5, name: "a" }] });
    expect(capabilitiesOf("amount", inferred)).toContain("aggregate");
    expect(capabilitiesOf("name", inferred)).not.toContain("aggregate");
  });

  it("gives a restricted column none", () => {
    const secret = defineSchema([{ id: "salary", kind: "currency" }, { id: "name" }], { restricted: ["salary"] });
    expect(capabilitiesOf("salary", secret)).toEqual([]);
    expect(capabilitiesOf("ssn")).toEqual([]);
  });

  it("lets a Host's capabilities replace the defaults, as today", () => {
    expect(capabilitiesOf("fee")).toEqual(["filter", "sort", "show", "hide"]);
    expect(capabilitiesOf("notes")).toEqual(["show", "hide"]);
    const narrowed = defineSchema([{ id: "amount", kind: "currency" }], { columns: { amount: { capabilities: ["sort", "aggregate"] } } });
    expect(capabilitiesOf("amount", narrowed)).toEqual(["sort", "aggregate"]);
  });
});

describe("totals in validation (spec 4.4)", () => {
  // Every column here may be totalled as far as its capabilities go, so each check below is the kind rule's alone.
  const ALL: ColumnCapability[] = [...DEFAULT_CAPABILITIES, "aggregate"];
  const kinds = defineSchema(
    [
      { id: "text" },
      { id: "choice", kind: "enum" },
      { id: "day", kind: "date" },
      { id: "moment", kind: "datetime" },
      { id: "flag", kind: "boolean" },
      { id: "amount", kind: "currency" },
      { id: "units", kind: "number" },
      { id: "rate", kind: "percent" },
      { id: "plain", kind: "currency" },
      { id: "untouched" },
      { id: "secret", kind: "currency" },
    ],
    {
      restricted: ["secret"],
      columns: {
        text: { capabilities: ALL },
        choice: { capabilities: ALL },
        day: { capabilities: ALL },
        moment: { capabilities: ALL },
        flag: { capabilities: ALL },
        plain: { capabilities: ["filter", "sort"] },
      },
    },
  );
  const ids = kinds.columns.map((c) => c.id);
  const base: ViewState = emptyViewState(ids);
  const caps: ViewCapabilities = {
    operations: [...MVP_OPERATIONS, TOTALS],
    supportsAtomicApply: true,
    supportsSnapshotRestore: true,
    observesChanges: true,
  };
  const ctx = { schema: kinds, capabilities: caps, current: { revision: "r1", state: base }, defaultState: base };
  const plan = (operations: ViewOperation[]): ViewPlan => ({
    protocolVersion: "0.1",
    id: "p1",
    baseRevision: "r1",
    source: { channel: "typed" },
    status: "ready",
    operations,
    evidence: [],
    clarifications: [],
    unsupportedSegments: [],
  });
  const issues = (operations: ViewOperation[], c = ctx) => {
    const result = validatePlan(plan(operations), c);
    return result.ok ? [] : result.issues;
  };
  const codes = (operations: ViewOperation[], c = ctx) => issues(operations, c).map((i) => i.code);

  it.each(["text", "choice", "day", "moment", "flag", "rate"])("rejects a sum on the %s column", (id) => {
    expect(codes([totals(sum(id))])).toEqual(["PLAN_AGGREGATION_KIND"]);
  });

  it("says which total would fit a percent column, in the spec's words", () => {
    expect(issues([totals(sum("rate"))])).toEqual([
      { code: "PLAN_AGGREGATION_KIND", message: "Rate can't be totalled; try an average.", path: "operations.0" },
    ]);
  });

  it.each(["text", "choice", "day", "moment", "flag"])("rejects an average on the %s column", (id) => {
    expect(codes([totals(avg(id))])).toEqual(["PLAN_AGGREGATION_KIND"]);
  });

  it("says a column of a kind no total fits can't be totalled, or averaged", () => {
    // OPEN: the spec gives the message for a percent column only.
    expect(issues([totals(sum("text"))]).map((i) => i.message)).toEqual(["Text can't be totalled."]);
    expect(issues([totals(avg("day"))]).map((i) => i.message)).toEqual(["Day can't be averaged."]);
  });

  it("accepts a sum on a number or currency column, and an average on a number, currency or percent column", () => {
    for (const list of [[sum("amount")], [sum("units")], [avg("amount")], [avg("units")], [avg("rate")], [sum("amount"), avg("rate")]]) {
      const result = validatePlan(plan([totals(...list)]), ctx);
      expect(result.ok, JSON.stringify(list)).toBe(true);
      expect(result.ok && result.state.aggregations).toEqual(list);
    }
    // An empty list removes the totals.
    const cleared = validatePlan(plan([totals()]), {
      ...ctx,
      current: { revision: "r1", state: { ...base, aggregations: [sum("amount")] } },
    });
    expect(cleared.ok && cleared.state.aggregations).toEqual([]);
  });

  it("rejects two totals on one column in one plan, with the same function or different ones", () => {
    expect(codes([totals(sum("amount"), sum("amount"))])).toEqual(["PLAN_INCONSISTENT_STATE"]);
    expect(codes([totals(sum("amount"), avg("amount"))])).toEqual(["PLAN_INCONSISTENT_STATE"]);
    expect(codes([totals(avg("rate"), sum("units"), avg("rate"))])).toEqual(["PLAN_INCONSISTENT_STATE"]);
    // A later list in the same plan replaces the earlier one: the view ends with one total for the column.
    const replaced = validatePlan(plan([totals(sum("amount")), totals(avg("amount"))]), ctx);
    expect(replaced.ok && replaced.state.aggregations).toEqual([avg("amount")]);
  });

  describe("a minimum, a maximum and a count", () => {
    const others = (["min", "max", "count"] as const).map((fn): AggregationSpec => ({ columnId: "amount", function: fn }));

    it("stay valid in the protocol", () => {
      for (const spec of others) expect(ViewOperation.safeParse(totals(spec)).success, spec.function).toBe(true);
    });

    it("are rejected on an adapter that applies sums and averages only, which is every adapter that doesn't say more", () => {
      for (const spec of others) expect(codes([totals(spec)]), spec.function).toEqual(["PLAN_AGGREGATION_KIND"]);
      // Beside a total the adapter does apply, the plan still fails whole.
      expect(codes([totals(sum("units"), { columnId: "amount", function: "max" })])).toEqual(["PLAN_AGGREGATION_KIND"]);
    });

    it("pass on an adapter that says it applies them", () => {
      // OPEN: how an adapter says which functions it applies (order plan, section 11, "Totals an adapter doesn't
      // apply"). Here: an optional `aggregationFunctions` beside `operations` in its capabilities. Left out, it is
      // sum and average, so the two shipped adapters need not set it and their capabilities stay as they are.
      const more = { ...caps, aggregationFunctions: ["sum", "avg", "min", "max", "count"] } as ViewCapabilities;
      for (const spec of others) {
        const result = validatePlan(plan([totals(spec)]), { ...ctx, capabilities: more });
        expect(result.ok, spec.function).toBe(true);
      }
      // An adapter may also say it applies fewer.
      const sumsOnly = { ...caps, aggregationFunctions: ["sum"] } as ViewCapabilities;
      expect(codes([totals(avg("amount"))], { ...ctx, capabilities: sumsOnly })).toEqual(["PLAN_AGGREGATION_KIND"]);
      expect(codes([totals(sum("amount"))], { ...ctx, capabilities: sumsOnly })).toEqual([]);
    });
  });

  it("still rejects a total on a column that may not be totalled, on a restricted or unknown column, or on a grid that doesn't list it", () => {
    expect(codes([totals(sum("plain"))])).toEqual(["PLAN_COLUMN_CAPABILITY"]);
    expect(codes([totals(sum("secret"))])).toEqual(["POLICY_RESTRICTED_COLUMN"]);
    expect(codes([totals(sum("nowhere"))])).toEqual(["PLAN_UNKNOWN_COLUMN"]);
    const without = { ...ctx, capabilities: { ...caps, operations: [...MVP_OPERATIONS] } };
    expect(codes([totals(sum("amount"))], without)).toEqual(["PLAN_OPERATION_UNSUPPORTED"]);
    // A text column with the default capabilities fails on both counts; either way it is not valid.
    expect(validatePlan(plan([totals(sum("untouched"))]), ctx).ok).toBe(false);
  });
});

describe("totals in the Preview, the diff and the audit (spec 4.5)", () => {
  const ids = schema.columns.map((c) => c.id);
  const base: ViewState = emptyViewState(ids);
  const lines = (operations: ViewOperation[], current?: Partial<ViewState>) =>
    renderPreview({ operations }, schema, current ? { filters: null, ...current } : undefined).lines;

  it("says “Show the total of …” and “Show the average of …”, never “Summarize”", () => {
    expect(lines([totals(sum("value"))])).toEqual(["Show the total of Market value"]);
    expect(lines([totals(avg("concentration"))])).toEqual(["Show the average of Concentration"]);
    expect(lines([totals(sum("value"))], { aggregations: [] })).toEqual(["Show the total of Market value"]);
    expect(renderPreview({ operations: [totals(sum("value"))] }, schema).text).toBe(
      "Show the total of Market value. No records will be changed.",
    );
    expect(renderPreview({ operations: [groupBy("advisor"), totals(sum("value"))] }, schema).text).toBe(
      "Group by Advisor; show the total of Market value. No records will be changed.",
    );
    for (const operations of [[totals(sum("value"))], [totals(avg("value"), sum("gain"))], [totals()]]) {
      expect(renderPreview({ operations }, schema).text).not.toMatch(/summar/i);
    }
  });

  it("says “Remove the totals” for an empty list", () => {
    expect(lines([totals()])).toEqual(["Remove the totals"]);
    expect(lines([totals()], { aggregations: [sum("value"), avg("concentration")] })).toEqual(["Remove the totals"]);
  });

  it("names only the totals the plan adds to the view's", () => {
    expect(lines([totals(sum("value"), sum("gain"))], { aggregations: [sum("value")] })).toEqual(["Show the total of Unrealized gain"]);
    expect(lines([totals(sum("value"), avg("concentration"))], { aggregations: [sum("value")] })).toEqual([
      "Show the average of Concentration",
    ]);
  });

  it("says which total a new one replaces on the same column", () => {
    expect(lines([totals(avg("value"))], { aggregations: [sum("value")] })).toEqual([
      "Show the average of Market value instead of its total",
    ]);
    expect(lines([totals(sum("value"))], { aggregations: [avg("value")] })).toEqual([
      "Show the total of Market value instead of its average",
    ]);
    expect(lines([totals(avg("value"), sum("gain"))], { aggregations: [sum("value"), sum("gain")] })).toEqual([
      "Show the average of Market value instead of its total",
    ]);
  });

  it("gives each total its own words when one list adds several, removes one, or holds another function", () => {
    // OPEN: spec 4.5 gives the line for one total. No request makes these lists; a plan made another way can.
    // Each total keeps its own "the total of" or "the average of": "the total of Market value and Unrealized gain"
    // could be read as one sum of both columns.
    expect(lines([totals(sum("value"), sum("gain"))])).toEqual(["Show the total of Market value and the total of Unrealized gain"]);
    expect(lines([totals(sum("value"), sum("gain"), avg("concentration"))])).toEqual([
      "Show the total of Market value, the total of Unrealized gain and the average of Concentration",
    ]);
    // Followed through the plan's own totals, as pins are.
    expect(lines([totals(sum("value")), totals(sum("value"), avg("concentration"))])).toEqual([
      "Show the total of Market value",
      "Show the average of Concentration",
    ]);
    // A list that drops one of the view's totals and keeps the rest.
    expect(lines([totals(sum("value"))], { aggregations: [sum("value"), sum("gain")] })).toEqual(["Remove the total of Unrealized gain"]);
    expect(lines([totals(sum("gain"))], { aggregations: [sum("gain"), avg("concentration")] })).toEqual([
      "Remove the average of Concentration",
    ]);
    // The functions no request reaches.
    expect(lines([totals({ columnId: "value", function: "min" })])).toEqual(["Show the minimum of Market value"]);
    expect(lines([totals({ columnId: "value", function: "max" })])).toEqual(["Show the maximum of Market value"]);
    expect(lines([totals({ columnId: "value", function: "count" })])).toEqual(["Show the count of Market value"]);
  });

  it("says whether the totals changed", () => {
    const totalled = { ...base, aggregations: [sum("value")] };
    expect(diffViews(base, totalled)).toMatchObject({ totalsChanged: true });
    expect(diffViews(totalled, { ...base, aggregations: [avg("value")] })).toMatchObject({ totalsChanged: true });
    expect(diffViews(totalled, base)).toMatchObject({ totalsChanged: true });
    expect(diffViews(totalled, { ...totalled, groupBy: ["advisor"] })).toMatchObject({ totalsChanged: false, groupingChanged: true });
    expect(diffViews(base, base)).toMatchObject({ totalsChanged: false });
  });

  it("lists the columns of a totals change in the audit's structure, and never a value", async () => {
    const plan: ViewPlan = {
      protocolVersion: "0.1",
      id: "p1",
      baseRevision: "r1",
      source: { channel: "typed" },
      status: "ready",
      operations: [groupBy("advisor"), totals(sum("value"), avg("concentration"))],
      evidence: [],
      clarifications: [],
      unsupportedSegments: [],
    };
    expect(toAuditEvent(plan, "applied", { includeStructure: true }).structure).toEqual([
      { type: "group.set", columnIds: ["advisor"] },
      { type: TOTALS, columnIds: ["value", "concentration"] },
    ]);
    // Off by default, as every structure is.
    expect(toAuditEvent(plan, "applied").structure).toBeUndefined();
    // Through the Controller: one event for the apply, with the same structure.
    const events: Array<ReturnType<typeof toAuditEvent>> = [];
    const result = await propose("total market value by advisor", {
      audit: { onEvent: (event) => events.push(event), policy: { includeStructure: true } },
    });
    expect(await result.cue.apply()).toBe(true);
    expect(events.map((e) => [e.outcome, e.operationTypes, e.structure])).toEqual([
      [
        "applied",
        ["group.set", TOTALS],
        [
          { type: "group.set", columnIds: ["advisor"] },
          { type: TOTALS, columnIds: ["value"] },
        ],
      ],
    ]);
  });
});

describe("reading totals words stays fast", () => {
  // Each unit makes one long part, and most end in a word left over, so the end of the part is looked for after every
  // "and" and comma. Reading must not read the rest of the part again from each one.
  const units = [
    "total market value and ",
    "average concentration, total market value by advisor, ",
    "show the total of market value and ",
    "sum of market value by advisor and ",
    "remove the totals, no totals, ",
    "group by advisor and total market value ",
    "total total total average sum of ",
    "sort by gain and total market value, hide custodian and average concentration, ",
    "above-average gain and ",
  ];
  it("reads and compiles 2,000 characters of totals words in under 50 ms", async () => {
    const empty = { resolve: async () => ({ clauses: [] }) };
    for (const unit of units) {
      const text = unit.repeat(Math.ceil(2000 / unit.length)).slice(0, 2000);
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const { adapter } = grid();
        const cue = createGridCue({ adapter, provider: empty, maxUtteranceLength: 2000 });
        const started = performance.now();
        await cue.propose(text);
        best = Math.min(best, performance.now() - started);
      }
      expect(best, unit).toBeLessThan(50);
    }
  });
});

describe("a Host's name made of a totals word is in doubt where the grid shows totals (order plan, section 11, O2)", () => {
  // The Host aliased Amount "total" and "sum", as the ledger fixture does. On a grid that draws totals, "total" said
  // beside a grouping or a total may ask for a total, or name the column. "Group by category, total amount, average
  // rate" grouped by Category, then Amount, and showed no total of Amount. On a grid that doesn't draw totals, the
  // words can only be the name, and read as before.
  const ledger = defineSchema(
    [
      { id: "entry", label: "Entry number" },
      { id: "owner", label: "Owner" },
      { id: "category", label: "Category" },
      { id: "amount", label: "Amount", kind: "currency" as const },
      { id: "units", label: "Units", kind: "number" as const },
      { id: "rate", label: "Rate", kind: "percent" as const },
    ],
    {
      rowNoun: "entry",
      columns: {
        owner: { aliases: ["holder"] },
        amount: { aliases: ["value", "total", "sum"] },
        category: {
          kind: "enum" as const,
          enumValues: [
            { id: "fees", label: "Fees" },
            { id: "travel", label: "Travel" },
          ],
        },
      },
    },
  );
  const ledgerMock = createMockProvider({ defaultColumnForKind: { currency: "amount", percent: "rate" } });
  const on = (request: string, lists = true, view: Partial<ViewState> = {}) =>
    propose(request, { s: ledger, provider: ledgerMock, totals: lists, view });

  it.each([
    "group by category, total amount",
    "group by owner and total amount",
    "group by owner then total amount",
    "group by category, total amount, average rate",
    "group by owner, total, average rate",
    "group by category, sum, average units",
    "group by owner with totals",
    "group by owner and sum",
    "hide total and average rate",
  ])("never makes “%s” ready on a grid that shows totals", async (request) => {
    const result = await on(request);
    expect(result.status, request).toBe("needs_clarification");
    expect(result.operations).toEqual([]);
    expect(result.questions.length).toBeGreaterThan(0);
    expect(await result.cue.apply()).toBe(false);
  });

  it("says the words may be the Host's name", async () => {
    const result = await on("group by category, total amount, average rate");
    expect(result.questions.map((q) => q.prompt)).toEqual([
      "“total” is a name in this grid, so GridCue can't tell what “total” asks for. Try rephrasing that part.",
    ]);
    const alone = await on("group by owner with totals");
    expect(alone.questions.map((q) => q.prompt)).toEqual([
      "“totals” is a name in this grid, so GridCue can't tell what “totals” asks for. Try rephrasing that part.",
    ]);
  });

  // A column's name right after the Host's totals word ("total units", "sum of units") makes the words a totals form
  // with the name spelled out. The Mention rules read a name right after another as the rows, so "sort by total units"
  // sorted by Amount and dropped Units.
  it.each([
    "sort by total units",
    "sort by total rate",
    "sort by sum units",
    "sort by the total units",
    "sort by total of units",
    "sort by the total of units",
    "hide total units",
    "hide total rate",
    "sort by owner and total units",
    "hide category, total units",
    "hide rate and total units",
    "group by owner, sort by total units",
  ])("never makes “%s” ready on a grid that shows totals", async (request) => {
    const result = await on(request);
    expect(result.status, request).toBe("needs_clarification");
    expect(result.operations).toEqual([]);
    expect(await result.cue.apply()).toBe(false);
  });

  it("says the words may be the Host's name, up to the column's name", async () => {
    const result = await on("sort by total units");
    expect(result.questions.map((q) => q.prompt)).toEqual([
      "“total” is a name in this grid, so GridCue can't tell what “total units” asks for. Try rephrasing that part.",
    ]);
    const of = await on("sort by total of units");
    expect(of.questions.map((q) => q.prompt)).toEqual([
      "“total” is a name in this grid, so GridCue can't tell what “total of units” asks for. Try rephrasing that part.",
    ]);
  });

  it.each([
    // The column the name is: "total amount" and "total value" both name Amount.
    ["sort by total amount", "amount"],
    ["sort by total value", "amount"],
    ["sort by total and units", "amount"],
    ["sort by total, units", "amount"],
  ])("reads “%s” as before", async (request, first) => {
    const withTotals = await on(request);
    const without = await on(request, false);
    expect(withTotals.status, request).toBe("ready");
    expect(withTotals.operations).toEqual(without.operations);
    const [sort] = withTotals.operations;
    expect(sort?.type === "sort.set" ? sort.sorts[0]?.columnId : undefined).toBe(first);
  });

  it.each(["sort by total units", "hide total rate", "sort by total of units"])(
    "reads “%s” as before on a grid that doesn't show totals",
    async (request) => {
      const before = await on(request, false);
      expect(before.questions.map((q) => q.prompt)).not.toContain(CANT);
      expect(holdsTotals(before.operations)).toBe(false);
    },
  );

  it("reads the name as before where the plan neither groups nor shows totals", async () => {
    const result = await on("sort by total, largest first");
    expect(result.status).toBe("ready");
    expect(result.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "amount", direction: "desc" }] }]);
  });

  it.each(["group by category, total amount", "group by owner with totals", "group by owner and sum", "sort by total, largest first"])(
    "reads “%s” as before on a grid that doesn't show totals",
    async (request) => {
      const before = await on(request, false);
      expect(before.status, request).toBe("ready");
      expect(holdsTotals(before.operations)).toBe(false);
    },
  );
});

describe("a total said after a sort or column list may be the list's next item (order plan, section 11, O2)", () => {
  // "Pin" can't be a column of a sort, but "average concentration" or "total market value" can be the next one, or
  // the next column to hide. The words were read as a new total, with no question.
  it.each([
    "sort by gain and total market value",
    "group by advisor, sort by gain and average concentration",
    "sort by market value descending and average concentration",
    "sort by market value descending, average concentration",
    "hide custodian and average concentration",
    "top 10 by gain and total market value",
    "total gain, sort by gain descending, average concentration",
  ])("asks for “%s”", async (request) => {
    const result = await propose(request);
    expect(result.status, request).toBe("needs_clarification");
    expect(result.operations).toEqual([]);
    expect(await result.cue.apply()).toBe(false);
  });

  it("says which list the words may continue", async () => {
    const result = await propose("sort by gain and total market value");
    expect(result.questions.map((q) => q.prompt)).toEqual([
      "GridCue can't tell whether “total market value” is one more column to sort by. To show the total, ask for it on its own.",
    ]);
    const hidden = await propose("hide custodian and average concentration");
    expect(hidden.questions.map((q) => q.prompt)).toEqual([
      "GridCue can't tell whether “average concentration” is one more column to hide. To show the average, ask for it on its own.",
    ]);
  });

  it("reads a total after a grouping, which can't group by a total", async () => {
    const result = await propose("group by advisor and total market value");
    expect(result.status).toBe("ready");
    expect(result.lines).toEqual(["Group by Advisor", "Show the total of Market value"]);
  });

  it("ends in “This grid can't show totals.” on a grid that doesn't, as before", async () => {
    const result = await propose("sort by gain and total market value", { totals: false });
    expect(result.questions.map((q) => q.prompt)).toEqual([CANT]);
  });
});

describe("a total said after a clear may be one more thing to remove (order plan, section 11, O2)", () => {
  // "Remove the totals and total market value" may remove the total of Market value too: the User asked for no totals.
  // The words were read as a clear, then a new total, and showed or kept the total named after "remove".
  const both = { view: { aggregations: [sum("value"), avg("concentration")] } };
  it.each([
    "remove the totals and total market value",
    "clear the totals and total market value",
    "no totals and total market value",
    "remove the totals and also total market value",
    "remove the totals and average concentration",
    "clear the totals and average concentration",
    "no totals and average concentration",
    "clear the totals, total market value",
    "remove the totals and sum of market value",
    "remove the totals and total market value by advisor",
    "remove the totals and total concentration",
    "sort by gain and remove the totals and total market value",
    "group by advisor, remove the totals and total market value",
    "clear the sort and total market value",
    "remove the grouping and total market value",
    "clear the filters and average concentration",
  ])("asks for “%s”", async (request) => {
    for (const aggregations of [[], both.view.aggregations]) {
      const result = await propose(request, { view: { aggregations } });
      expect(result.status, request).toBe("needs_clarification");
      expect(result.operations).toEqual([]);
      expect(await result.cue.apply()).toBe(false);
      expect(result.adapter.getState().state.aggregations).toEqual(aggregations);
    }
  });

  it("says the words may be one more thing to remove", async () => {
    const result = await propose("remove the totals and total market value", both);
    expect(result.questions.map((q) => q.prompt)).toEqual([
      "GridCue can't tell whether “total market value” is one more thing to remove. To show the total, ask for it on its own.",
    ]);
    const sorted = await propose("clear the sort and average concentration");
    expect(sorted.questions.map((q) => q.prompt)).toEqual([
      "GridCue can't tell whether “average concentration” is one more thing to remove. To show the average, ask for it on its own.",
    ]);
  });

  it.each([
    ["remove the totals and show the total of market value", {}, ["Show the total of Market value"]],
    ["clear the totals and show total market value", {}, ["Show the total of Market value"]],
    ["remove the totals, then total market value", {}, ["Show the total of Market value"]],
    // "Ungroup" takes no words after it, so the total can't be one more thing it removes.
    ["ungroup and total market value", { groupBy: ["custodian"] }, ["Clear grouping", "Show the total of Market value"]],
  ])("reads “%s”, where the words after the clear say their own change", async (request, view, lines) => {
    const result = await propose(request, { view });
    expect(result.status, `${request}: ${result.questions.map((q) => q.prompt)}`).toBe("ready");
    expect(result.lines).toEqual(lines);
  });

  it("ends in “This grid can't show totals.” on a grid that doesn't", async () => {
    for (const request of ["remove the totals and total market value", "clear the sort and total market value"]) {
      const result = await propose(request, { totals: false });
      expect(
        result.questions.map((q) => q.prompt),
        request,
      ).toEqual([CANT]);
    }
  });
});

describe("a totals word inside a Host's name reads as before (spec 5.2)", () => {
  // The Mention rules don't place a name right before "by", which they read as the rows. The word is still the name's.
  const insured = defineSchema(
    [
      { id: "holder", label: "Holder" },
      { id: "cost", label: "Average cost", kind: "currency" as const },
      { id: "insured", label: "Sum insured", kind: "currency" as const },
      { id: "premium", label: "Premium", kind: "currency" as const },
    ],
    { columns: { premium: { aliases: ["total premium"] }, cost: { aliases: ["avg cost"] } } },
  );
  it.each(["average cost by holder", "sum insured by holder", "total premium by holder", "avg cost by holder"])(
    "asks for “%s” on a grid that doesn't show totals as it does on one that does",
    async (request) => {
      const without = await propose(request, { s: insured, totals: false });
      const withTotals = await propose(request, { s: insured });
      expect(
        without.questions.map((q) => q.prompt),
        request,
      ).not.toContain(CANT);
      expect(without.questions.map((q) => q.id)).toEqual(withTotals.questions.map((q) => q.id));
      expect(without.status).toBe(withTotals.status);
    },
  );

  it("reads “above-average gain” as a level to compare with, as “above average gain”", async () => {
    for (const request of ["above-average gain", "accounts with above-average gain"]) {
      const result = await propose(request, { totals: false });
      expect(
        result.questions.map((q) => q.prompt),
        request,
      ).not.toContain(CANT);
    }
  });
});

describe("a total on a column the view groups by (spec 5.4)", () => {
  // TanStack Table draws a group row's own value in a column it groups by, and the Rows Adapter gave it a total, so
  // the two drew different numbers. GridCue asks instead, and validation refuses the view.
  it.each([
    ["total gain", { groupBy: ["gain"] }],
    ["average concentration", { groupBy: ["advisor", "concentration"] }],
    ["group by gain", { aggregations: [sum("gain")] }],
    ["total gain", { groupBy: ["advisor", "gain"] }],
  ])("asks for “%s” on a view that would total a column it groups by", async (request, view) => {
    const result = await propose(request, { view });
    expect(result.status, request).toBe("needs_clarification");
    expect(result.operations).toEqual([]);
    expect(await result.cue.apply()).toBe(false);
  });

  it("says why", async () => {
    const result = await propose("total gain", { view: { groupBy: ["gain"] } });
    expect(result.questions.map((q) => q.prompt)).toEqual(["GridCue can't group by Unrealized gain and show its total too."]);
  });

  it("still reads a total on another column of a grouped view, and “total X by Y” that groups by another column", async () => {
    expect((await propose("total market value", { view: { groupBy: ["gain"] } })).status).toBe("ready");
    const regrouped = await propose("total gain by advisor", { view: { groupBy: ["gain"] } });
    expect(regrouped.status).toBe("ready");
    expect(regrouped.operations).toEqual([groupBy("advisor"), totals(sum("gain"))]);
  });

  it("is refused by validation where the grid shows totals, for a plan that changes the grouping or the totals", () => {
    const state: ViewState = { ...emptyViewState(schema.columns.map((c) => c.id)), groupBy: ["gain"] };
    const capabilities: ViewCapabilities = {
      operations: [...MVP_OPERATIONS, TOTALS],
      supportsAtomicApply: true,
      supportsSnapshotRestore: true,
      observesChanges: true,
    };
    const plan = (operations: ViewOperation[]): ViewPlan => ({
      protocolVersion: "0.1",
      id: "p1",
      baseRevision: "r1",
      source: { channel: "typed" },
      status: "ready",
      operations,
      evidence: [],
      clarifications: [],
      unsupportedSegments: [],
    });
    const check = (operations: ViewOperation[], view: ViewState, caps = capabilities) => {
      const result = validatePlan(plan(operations), {
        schema,
        capabilities: caps,
        current: { revision: "r1", state: view },
        defaultState: view,
      });
      return result.ok ? [] : result.issues.map((i) => i.code);
    };
    expect(check([totals(sum("gain"))], state)).toEqual(["PLAN_INCONSISTENT_STATE"]);
    expect(check([groupBy("gain")], { ...state, groupBy: [], aggregations: [sum("gain")] })).toEqual(["PLAN_INCONSISTENT_STATE"]);
    expect(check([totals(sum("value"))], state)).toEqual([]);
    // A plan that changes neither is not refused for a view the User made with the table's own controls.
    const manual = { ...state, aggregations: [sum("gain")] };
    expect(check([{ type: "columns.hide", columnIds: ["notes"] }], manual)).toEqual([]);
  });
});

describe("a request that changes no totals (spec 4.5)", () => {
  it("says the grid already shows the view, where its totals words end where they started", async () => {
    const result = await propose("no totals and show the total of market value", { view: { aggregations: [sum("value")] } });
    expect(result.status).toBe("needs_clarification");
    expect(result.operations).toEqual([]);
    expect(result.questions.map((q) => q.prompt)).toEqual(["The grid already shows this view."]);
  });

  it("keeps the rest of the request where only its totals change nothing", async () => {
    const result = await propose("no totals and show the total of market value, group by advisor", {
      view: { aggregations: [sum("value")] },
    });
    expect(result.status).toBe("ready");
    expect(result.lines).toEqual(["Group by Advisor"]);
  });
});

describe("the third choice for an adjective made from a column's name (spec 5.4)", () => {
  const labels = (q: { options?: Array<{ label: string }> } | undefined) => q?.options?.map((o) => o.label);
  it.each([
    ["most concentrated households first", "Household", "desc"],
    ["least concentrated households first", "Household", "asc"],
    ["most concentrated advisors first", "Advisor", "desc"],
  ] as const)("offers “Rank … by average Concentration” for “%s”", async (request, entity, direction) => {
    for (const s of [measured, schema]) {
      const asked = await propose(request, { s });
      const [question] = asked.questions;
      expect(labels(question)).toEqual([
        `Group by ${entity}`,
        `Use the ${entity} column`,
        `Rank ${entity.toLowerCase()}s by average Concentration`,
      ]);
      const plan = asked.cue.answer(question?.id ?? "", "rank");
      expect(plan?.status).toBe("ready");
      expect(plan?.operations).toEqual([
        groupBy(entity === "Household" ? "household" : "advisor"),
        totals(avg("concentration")),
        { type: "sort.set", sorts: [{ columnId: "concentration", direction }] },
      ]);
    }
  });

  it("keeps two choices on a grid that doesn't show totals", async () => {
    const asked = await propose("most concentrated households first", { totals: false });
    expect(labels(asked.questions[0])).toEqual(["Group by Household", "Use the Household column"]);
  });
});
