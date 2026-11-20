import { afterEach, describe, expect, it, vi } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { emptyViewState, type ViewPlan, type ViewSchema, type ViewState } from "../src/core/protocol";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { validatePlan } from "../src/core/validate";
import { generateView, operationsFor, seededRandom, type ViewGeneratorOptions } from "./view-generator";

// The seeded view generator (operation set spec, 5.4): a seed and a schema in, a View State a User could reach out.

const wide: ViewSchema = defineSchema(
  [
    { id: "account" },
    { id: "advisor" },
    { id: "custodian", kind: "enum" },
    { id: "market_value", kind: "currency" },
    { id: "units", kind: "number" },
    { id: "concentration", kind: "percent" },
    { id: "opened", kind: "date" },
    { id: "contacted", kind: "datetime" },
    { id: "restricted", kind: "boolean" },
    { id: "tax_id" },
  ],
  {
    restricted: ["tax_id"],
    columns: {
      custodian: { enumValues: ["northgate", "harborline"].map((id) => ({ id, label: id })) },
      // A Host that narrows a column: no total, no pin, no grouping here.
      units: { capabilities: ["filter", "sort", "show", "hide", "reorder"], allowedOperators: ["gt", "lt"] },
    },
  },
);
const narrow: ViewSchema = defineSchema([{ id: "name" }, { id: "amount", kind: "currency" }]);

const planOf = (state: ViewState, schema: ViewSchema): ViewPlan => ({
  protocolVersion: "0.1",
  id: "p_generated",
  baseRevision: "rows:0",
  source: { channel: "api" },
  status: "ready",
  operations: operationsFor(state, schema),
  evidence: [],
  clarifications: [],
  unsupportedSegments: [],
});

/** Validates the operations that reach `state` from the default view, on a Rows Adapter with every `renders`. */
const reached = (
  state: ViewState,
  schema: ViewSchema,
  options: Parameters<typeof createRowsAdapter>[0]["renders"] = ["pinning", "density", "totals"],
) => {
  const adapter = createRowsAdapter({ schema, renders: options });
  return validatePlan(planOf(state, schema), {
    schema,
    capabilities: adapter.getCapabilities(),
    current: adapter.getState(),
    defaultState: adapter.getDefaultState(),
  });
};

describe("generateView", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives the same view for the same seed, and never calls Math.random", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random");
    });
    for (let seed = 0; seed < 50; seed++) expect(generateView(seed, wide)).toEqual(generateView(seed, wide));
    expect(generateView(1, wide)).not.toEqual(generateView(2, wide));
  });

  it("gives the same view on any machine: a pinned view and a pinned sequence", () => {
    const random = seededRandom(1);
    expect(Array.from({ length: 3 }, random)).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
    expect(generateView(20_261_114, narrow)).toEqual(PINNED_VIEW);
  });

  it("gives a view a User could reach: its operations validate from the default view and give it exactly", () => {
    for (const schema of [wide, narrow]) {
      for (let seed = 0; seed < 500; seed++) {
        const state = generateView(seed, schema);
        const result = reached(state, schema);
        expect(result.ok ? undefined : result.issues, `seed ${seed}`).toBeUndefined();
        if (result.ok) expect(result.state, `seed ${seed}`).toEqual(state);
      }
    }
  });

  it("uses only what each column allows: no restricted column, and no change a Host narrowed away", () => {
    for (let seed = 0; seed < 500; seed++) {
      const s = generateView(seed, wide);
      const named = [
        ...s.sorts.map((x) => x.columnId),
        ...s.groupBy,
        ...s.aggregations.map((a) => a.columnId),
        ...s.pinnedColumnIds.start,
        ...s.pinnedColumnIds.end,
        ...(s.filters?.children ?? []).map((c) => (c.type === "predicate" ? c.columnId : "")),
      ];
      expect(named).not.toContain("tax_id");
      expect(s.visibleColumnIds).toContain("tax_id");
      expect([...s.groupBy, ...s.aggregations.map((a) => a.columnId), ...s.pinnedColumnIds.start, ...s.pinnedColumnIds.end]).not.toContain(
        "units",
      );
      for (const c of s.filters?.children ?? [])
        if (c.type === "predicate" && c.columnId === "units") expect(["gt", "lt"]).toContain(c.operator);
      // A sum on an amount, an average on an amount or a percentage (ADR 0030).
      for (const a of s.aggregations) {
        expect(a.function === "sum" ? ["market_value"] : ["market_value", "concentration"]).toContain(a.columnId);
      }
    }
  });

  it("uses only what the grid lists", () => {
    const tanstack: ViewGeneratorOptions = { capabilities: { operations: [...MVP_OPERATIONS], maxSorts: 1, maxGroups: 1 } };
    for (let seed = 0; seed < 300; seed++) {
      const s = generateView(seed, wide, tanstack);
      expect(s.limit).toBeUndefined();
      expect(s.aggregations).toEqual([]);
      expect(s.pinnedColumnIds).toEqual({ start: [], end: [] });
      expect(s.density).toBe("comfortable");
      expect(s.sorts.length).toBeLessThanOrEqual(1);
      expect(s.groupBy.length).toBeLessThanOrEqual(1);
      const result = reached(s, wide, []);
      expect(result.ok, `seed ${seed}`).toBe(true);
    }
    // A grid that applies only an average never gets a sum.
    const averages = { capabilities: { operations: [...MVP_OPERATIONS, "aggregation.set"], aggregationFunctions: ["avg" as const] } };
    for (let seed = 0; seed < 300; seed++) for (const a of generateView(seed, wide, averages).aggregations) expect(a.function).toBe("avg");
  });

  it("over 500 seeds, holds each part of a view, and each grouping depth", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 500; seed++) {
      const s = generateView(seed, wide);
      const base = emptyViewState(wide.columns.map((c) => c.id));
      if (s.filters) seen.add("filters");
      if (s.filters?.children.some((c) => c.type === "predicate" && c.operator === "between")) seen.add("a range");
      if (s.filters?.children.some((c) => c.type === "predicate" && c.operator === "in")) seen.add("a list");
      if (s.sorts.length > 1) seen.add("two sorts or more");
      if (s.groupBy.length === 1) seen.add("one level");
      if (s.groupBy.length === 2) seen.add("two levels");
      if (s.visibleColumnIds.length < base.visibleColumnIds.length) seen.add("hidden columns");
      if (s.pinnedColumnIds.start.length > 0) seen.add("pinned to the start");
      if (s.pinnedColumnIds.end.length > 0) seen.add("pinned to the end");
      if (s.aggregations.some((a) => a.function === "sum")) seen.add("a sum");
      if (s.aggregations.some((a) => a.function === "avg")) seen.add("an average");
      if (s.aggregations.length === 2) seen.add("two totals");
      if (s.sorts.some((x) => s.aggregations.some((a) => a.columnId === x.columnId))) seen.add("a sort on a total");
      if (s.limit !== undefined) seen.add("a count");
      if (s.density !== base.density) seen.add("a density");
      if (JSON.stringify(s.columnOrder) !== JSON.stringify(base.columnOrder)) seen.add("a column order");
    }
    expect([...seen].sort()).toEqual(
      [
        "filters",
        "a range",
        "a list",
        "two sorts or more",
        "one level",
        "two levels",
        "hidden columns",
        "pinned to the start",
        "pinned to the end",
        "a sum",
        "an average",
        "two totals",
        "a sort on a total",
        "a count",
        "a density",
        "a column order",
      ].sort(),
    );
  });

  it("takes filter values from the rows it is given, so a filter can keep some", () => {
    const rows = [
      { name: "Alder Trust", amount: 125.5 },
      { name: "Birch Fund", amount: 99.99 },
    ];
    for (let seed = 0; seed < 200; seed++) {
      for (const c of generateView(seed, narrow, { rows }).filters?.children ?? []) {
        if (c.type !== "predicate" || c.operator !== "eq") continue;
        if (c.columnId === "amount") expect(typeof c.value).toBe("number");
        if (c.columnId === "name") expect(typeof c.value).toBe("string");
      }
    }
  });

  it("is always grouped, or never, when asked", () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(generateView(seed, wide, { grouped: true }).groupBy.length).toBeGreaterThan(0);
      expect(generateView(seed, wide, { grouped: false }).groupBy).toEqual([]);
    }
  });
});

/**
 * `generateView(20_261_114, narrow)`, measured 2026-11-14. Its total on Amount went when the generator stopped putting a
 * total on a column the view groups by, and the draws after it moved.
 */
const PINNED_VIEW: ViewState = {
  visibleColumnIds: ["amount"],
  columnOrder: ["amount", "name"],
  pinnedColumnIds: { start: ["amount", "name"], end: [] },
  filters: {
    id: "root",
    type: "group",
    combinator: "and",
    children: [
      { id: "f0", type: "predicate", columnId: "name", operator: "eq", value: "Name 0" },
      { id: "f1", type: "predicate", columnId: "name", operator: "startsWith", value: "Name " },
    ],
  },
  sorts: [
    { columnId: "name", direction: "asc" },
    { columnId: "amount", direction: "asc" },
  ],
  groupBy: ["amount", "name"],
  aggregations: [],
  density: "spacious",
  limit: 4,
};
