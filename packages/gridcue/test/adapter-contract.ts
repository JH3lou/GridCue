import { describe, expect, it } from "vitest";
import { type GridAdapter, MVP_OPERATIONS } from "../src/core/adapter";
import type { FilterPredicate, VersionedViewState, ViewOperation, ViewPlan, ViewState } from "../src/core/protocol";
import { validatePlan } from "../src/core/validate";

export interface ContractHarness {
  adapter: GridAdapter;
  /** Simulates the user changing the view by hand, outside GridCue. */
  manualChange(): void;
  /** Two column IDs that support filter and sort, the first numeric. */
  numericColumn: string;
  otherColumn: string;
  /**
   * The same kind of grid over `DATED_ROWS`, with a column for each of its keys and its schema read from those rows,
   * so `booked` is a date column, and `posted` (ISO strings) and `stamped` (`Date` objects) are date-and-time columns.
   */
  dated(): GridAdapter;
}

/** Synthetic rows for the date checks: a date, a date-and-time string and a `Date` in each. */
export const DATED_ROWS = [
  { memo: "a", booked: "2026-01-30", posted: "2026-01-30T23:30:00.000Z", stamped: new Date("2026-01-30T23:30:00.000Z") },
  { memo: "b", booked: "2026-01-31", posted: "2026-01-31T09:00:00-05:00", stamped: new Date("2026-01-31T14:00:00.000Z") },
  { memo: "c", booked: "2026-02-01", posted: "2026-02-01T00:30:00+13:00", stamped: new Date("2026-01-31T11:30:00.000Z") },
];
export const DATED_COLUMNS = ["memo", "booked", "posted", "stamped"] as const;

const planFor = (adapter: GridAdapter, operations: ViewOperation[]): ViewPlan => ({
  protocolVersion: "0.1",
  id: `p_${Math.random()}`,
  baseRevision: adapter.getState().revision,
  source: { channel: "api" },
  status: "ready",
  operations,
  evidence: [],
  clarifications: [],
  unsupportedSegments: [],
});

/**
 * What a Host's table draws beyond the rows, as an adapter's `renders` option names it, and the operation each name
 * lets the adapter list (operation set spec, 4.2). An adapter lists each one only when its `renders` names it.
 * "count" is the operation set's PR 4: no adapter takes it yet.
 */
export const LISTED_BY_RENDERS = {
  pinning: "columns.pin",
  density: "density.set",
  totals: "aggregation.set",
} as const;
export type RenderName = keyof typeof LISTED_BY_RENDERS;

/** How the adapter under test was built, so the suite knows what it must list. */
export interface ContractOptions {
  /** The adapter's `renders` option. Absent: none. */
  renders?: readonly RenderName[];
  /** True when the adapter keeps a count with no option, as the Rows Adapter does (ADR 0018), and so lists `limit.set`. */
  keepsCount?: boolean;
}

type Step = { operations: ViewOperation[]; holds(state: ViewState): void };

/**
 * The checks for each operation an adapter may list beyond the MVP ones. Each is a few plans applied in turn, with
 * what the View State must hold after each. For every operation an adapter lists, the suite applies them, reads each
 * back, restores an exact snapshot that holds the first, undoes to the view before, and counts one notification per
 * write. A new operation gets an entry here, and the suite fails for an adapter that lists one with no entry.
 */
const OPERATION_CHECKS: Record<string, (h: ContractHarness) => Step[]> = {
  "columns.pin": ({ numericColumn: a, otherColumn: b }) => [
    {
      operations: [
        { type: "columns.pin", columnIds: [a], position: "start" },
        { type: "columns.pin", columnIds: [b], position: "end" },
      ],
      holds: (s) => expect(s.pinnedColumnIds).toEqual({ start: [a], end: [b] }),
    },
    {
      // A column is pinned once: pinning it to the other side moves it there.
      operations: [{ type: "columns.pin", columnIds: [a], position: "end" }],
      holds: (s) => expect(s.pinnedColumnIds).toEqual({ start: [], end: [b, a] }),
    },
    {
      // A hidden column keeps its pin (operation set spec, 4.4).
      operations: [{ type: "columns.hide", columnIds: [b] }],
      holds: (s) => {
        expect(s.pinnedColumnIds).toEqual({ start: [], end: [b, a] });
        expect(s.visibleColumnIds).not.toContain(b);
      },
    },
    {
      operations: [{ type: "columns.pin", columnIds: [a, b], position: "none" }],
      holds: (s) => expect(s.pinnedColumnIds).toEqual({ start: [], end: [] }),
    },
  ],
  "density.set": () => [
    { operations: [{ type: "density.set", density: "compact" }], holds: (s) => expect(s.density).toBe("compact") },
    { operations: [{ type: "density.set", density: "spacious" }], holds: (s) => expect(s.density).toBe("spacious") },
  ],
  "aggregation.set": ({ numericColumn: a, otherColumn: b }) => [
    {
      operations: [{ type: "aggregation.set", aggregations: [{ columnId: a, function: "sum" }] }],
      holds: (s) => expect(s.aggregations).toEqual([{ columnId: a, function: "sum" }]),
    },
    {
      // A column holds one total at a time: an average replaces its sum. With a grouping, each group shows it.
      operations: [
        { type: "group.set", columnIds: [b] },
        { type: "aggregation.set", aggregations: [{ columnId: a, function: "avg" }] },
      ],
      holds: (s) => {
        expect(s.aggregations).toEqual([{ columnId: a, function: "avg" }]);
        expect(s.groupBy).toEqual([b]);
      },
    },
    {
      // Only the totals change.
      operations: [{ type: "aggregation.set", aggregations: [{ columnId: a, function: "sum" }] }],
      holds: (s) => {
        expect(s.aggregations).toEqual([{ columnId: a, function: "sum" }]);
        expect(s.groupBy).toEqual([b]);
      },
    },
    {
      operations: [{ type: "aggregation.set", aggregations: [] }],
      holds: (s) => {
        expect(s.aggregations).toEqual([]);
        expect(s.groupBy).toEqual([b]);
      },
    },
  ],
  "limit.set": ({ numericColumn: a }) => [
    {
      operations: [
        { type: "sort.set", sorts: [{ columnId: a, direction: "desc" }] },
        { type: "limit.set", count: 2 },
      ],
      holds: (s) => expect(s.limit).toBe(2),
    },
    { operations: [{ type: "limit.set", count: 5 }], holds: (s) => expect(s.limit).toBe(5) },
    { operations: [{ type: "limit.set", count: null }], holds: (s) => expect(s.limit).toBeUndefined() },
  ],
};

const validated = (adapter: GridAdapter, operations: ViewOperation[]) => {
  const result = validatePlan(planFor(adapter, operations), {
    schema: adapter.getSchema(),
    capabilities: adapter.getCapabilities(),
    current: adapter.getState(),
    defaultState: adapter.getDefaultState(),
  });
  if (!result.ok) throw new Error(result.issues.map((i) => i.code).join(","));
  return result;
};

/**
 * Every Grid Adapter must pass this suite. Run it once for each way the adapter can be built: with no `renders`, and
 * with each `renders` it takes, saying so in `options`.
 */
export const runAdapterContract = (name: string, make: () => ContractHarness, options: ContractOptions = {}) => {
  const renders = options.renders ?? [];
  const listed = [...(options.keepsCount ? ["limit.set"] : []), ...renders.map((r) => LISTED_BY_RENDERS[r])];
  describe(`${name}: adapter contract`, () => {
    it("lists columns.pin, density.set and aggregation.set each only when its renders names it", () => {
      const operations = make().adapter.getCapabilities().operations;
      for (const [rendered, op] of Object.entries(LISTED_BY_RENDERS)) {
        expect(operations.includes(op), `${op}, with renders ${JSON.stringify(renders)}`).toBe(renders.includes(rendered as RenderName));
      }
      expect(operations.includes("limit.set")).toBe(!!options.keepsCount);
    });

    it("lists the MVP operations, and beyond them only what the suite checks", () => {
      const operations = make().adapter.getCapabilities().operations;
      expect(operations.filter((op) => MVP_OPERATIONS.includes(op))).toEqual([...MVP_OPERATIONS]);
      const beyond = operations.filter((op) => !MVP_OPERATIONS.includes(op));
      expect([...beyond].sort()).toEqual([...listed].sort());
      for (const op of beyond) expect(Object.keys(OPERATION_CHECKS), `checks for ${op}`).toContain(op);
    });

    it("refuses a plan holding an operation it doesn't list, before it reaches the grid", () => {
      const h = make();
      const unlisted: ViewOperation[] = [
        { type: "columns.pin", columnIds: [h.numericColumn], position: "start" },
        { type: "density.set", density: "compact" },
        { type: "aggregation.set", aggregations: [{ columnId: h.numericColumn, function: "sum" }] },
        { type: "limit.set", count: 2 },
      ].filter((op) => !h.adapter.getCapabilities().operations.includes(op.type)) as ViewOperation[];
      for (const op of unlisted) {
        const result = validatePlan(planFor(h.adapter, [op]), {
          schema: h.adapter.getSchema(),
          capabilities: h.adapter.getCapabilities(),
          current: h.adapter.getState(),
          defaultState: h.adapter.getDefaultState(),
        });
        expect(result.ok, op.type).toBe(false);
      }
    });

    for (const op of listed) {
      it(`${op}: applies, reads back, restores an exact snapshot, undoes, and notifies once per write`, async () => {
        const h = make();
        const steps = OPERATION_CHECKS[op]?.(h);
        if (!steps) throw new Error(`No checks for ${op}`);
        const before = h.adapter.getState();
        let calls = 0;
        h.adapter.subscribe(() => calls++);
        const held: VersionedViewState[] = [];
        for (const step of steps) {
          const seen = calls;
          const result = await h.adapter.apply(validated(h.adapter, step.operations).plan);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(calls - seen, "notifications for one apply").toBe(1);
          const now = h.adapter.getState();
          expect(now.revision).toBe(result.state.revision);
          expect(now.state).toEqual(result.state.state);
          step.holds(now.state);
          held.push(now);
        }
        const [first] = held;
        if (!first || !steps[0]) throw new Error("no steps");

        // Restore: a snapshot that holds the operation's first result is written back exactly.
        let seen = calls;
        const restored = await h.adapter.restore(first);
        expect(restored.ok).toBe(true);
        expect(calls - seen, "notifications for one restore").toBe(1);
        expect(h.adapter.getState().state).toEqual(first.state);
        steps[0].holds(h.adapter.getState().state);

        // Undo: back to the view before the first apply.
        seen = calls;
        const undone = await h.adapter.restore(before);
        expect(undone.ok).toBe(true);
        expect(calls - seen, "notifications for one undo").toBe(1);
        expect(h.adapter.getState().state).toEqual(before.state);
      });
    }

    it("applies a multi-operation plan and bumps the revision", async () => {
      const h = make();
      const before = h.adapter.getState();
      const ops: ViewOperation[] = [
        {
          type: "filter.add",
          combineWith: "and",
          predicate: { id: "f1", type: "predicate", columnId: h.numericColumn, operator: "gt", value: 10 },
        },
        { type: "sort.set", sorts: [{ columnId: h.numericColumn, direction: "desc" }] },
        { type: "columns.hide", columnIds: [h.otherColumn] },
      ];
      const { plan } = validated(h.adapter, ops);
      const result = await h.adapter.apply(plan);
      expect(result.ok).toBe(true);
      const after = h.adapter.getState();
      expect(after.revision).not.toBe(before.revision);
      expect(after.state.sorts).toEqual([{ columnId: h.numericColumn, direction: "desc" }]);
      expect(after.state.visibleColumnIds).not.toContain(h.otherColumn);
      expect(after.state.filters?.children).toHaveLength(1);
    });

    it("applies, then undoes", async () => {
      const h = make();
      const snapshot = h.adapter.getState();
      const { plan } = validated(h.adapter, [
        {
          type: "filter.add",
          combineWith: "and",
          predicate: { id: "f1", type: "predicate", columnId: h.numericColumn, operator: "gt", value: 10 },
        },
        { type: "sort.set", sorts: [{ columnId: h.numericColumn, direction: "desc" }] },
      ]);
      const applied = await h.adapter.apply(plan);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      // An apply is done when the grid holds it: the state written, and the very Revision apply returned.
      const held = h.adapter.getState();
      expect(held.state).toEqual(applied.state.state);
      expect(held.revision).toBe(applied.state.revision);
      expect(held.state.sorts).toEqual([{ columnId: h.numericColumn, direction: "desc" }]);
      expect(held.state.filters?.children).toHaveLength(1);

      const restored = await h.adapter.restore(snapshot);
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const back = h.adapter.getState();
      expect(back.state).toEqual(snapshot.state);
      expect(back.revision).toBe(restored.state.revision);
      expect(back.revision).not.toBe(snapshot.revision);
      expect(back.revision).not.toBe(held.revision);
    });

    it("applies a negative amount as given", async () => {
      const h = make();
      const { plan } = validated(h.adapter, [
        {
          type: "filter.add",
          combineWith: "and",
          predicate: { id: "f1", type: "predicate", columnId: h.numericColumn, operator: "lt", value: -50 },
        },
        {
          type: "filter.add",
          combineWith: "and",
          predicate: { id: "f2", type: "predicate", columnId: h.numericColumn, operator: "between", value: { min: -100, max: -1 } },
        },
      ]);
      expect((await h.adapter.apply(plan)).ok).toBe(true);
      expect(h.adapter.getState().state.filters?.children).toMatchObject([{ value: -50 }, { value: { min: -100, max: -1 } }]);
    });

    it("notifies subscribers once per apply", async () => {
      const h = make();
      let calls = 0;
      h.adapter.subscribe(() => calls++);
      const { plan } = validated(h.adapter, [
        { type: "sort.set", sorts: [{ columnId: h.numericColumn, direction: "asc" }] },
        { type: "columns.hide", columnIds: [h.otherColumn] },
      ]);
      await h.adapter.apply(plan);
      expect(calls).toBe(1);
    });

    it("rejects plans that were not validated", async () => {
      const h = make();
      const before = h.adapter.getState();
      const plan = planFor(h.adapter, [{ type: "filter.clear" }]);
      const result = await h.adapter.apply(plan as never);
      expect(result.ok).toBe(false);
      expect(h.adapter.getState()).toEqual(before);
    });

    it("reports manual changes so stale plans are refused", async () => {
      const h = make();
      const { plan } = validated(h.adapter, [{ type: "filter.clear" }]);
      let seen = 0;
      h.adapter.subscribe(() => seen++);
      h.manualChange();
      expect(seen).toBeGreaterThan(0);
      expect((await h.adapter.apply(plan)).ok).toBe(false);
    });

    it("restores an exact snapshot", async () => {
      const h = make();
      const snapshot = h.adapter.getState();
      const { plan } = validated(h.adapter, [{ type: "sort.set", sorts: [{ columnId: h.numericColumn, direction: "desc" }] }]);
      await h.adapter.apply(plan);
      await h.adapter.restore(snapshot);
      expect(h.adapter.getState().state).toEqual(snapshot.state);
    });

    it("hands out capabilities the caller cannot use to corrupt the adapter", () => {
      const { adapter } = make();
      adapter.getCapabilities().operations.push("cells.edit");
      expect(adapter.getCapabilities().operations).not.toContain("cells.edit");
    });

    it("stops notifying once the function returned by subscribe is called", async () => {
      const h = make();
      let calls = 0;
      const unsubscribe = h.adapter.subscribe(() => calls++);
      h.manualChange();
      expect(calls).toBeGreaterThan(0);
      unsubscribe();
      const before = calls;
      const { plan } = validated(h.adapter, [{ type: "sort.set", sorts: [{ columnId: h.numericColumn, direction: "asc" }] }]);
      await h.adapter.apply(plan);
      h.manualChange();
      expect(calls).toBe(before);
    });

    describe("date, date-and-time and Date-object filters", () => {
      // A date means the whole day (ADR 0026), and a filter on a date-and-time column holds a day or a time. The
      // adapter keeps each filter exactly as the plan gives it.
      const dateFilters = (): ViewOperation[] =>
        [
          { columnId: "booked", operator: "eq", value: "2026-01-31" },
          { columnId: "booked", operator: "between", value: { min: "2026-01-01", max: "2026-01-31" } },
          { columnId: "posted", operator: "gt", value: "2026-01-30" },
          { columnId: "posted", operator: "lte", value: "2026-01-31T12:00:00.000Z" },
          { columnId: "stamped", operator: "between", value: { min: "2026-01-31", max: "2026-02-01" } },
          { columnId: "stamped", operator: "isNotEmpty" },
        ].map((p, i) => ({
          type: "filter.add",
          combineWith: "and",
          predicate: { id: `d${i}`, type: "predicate", ...p } as FilterPredicate,
        }));

      it("reads the dated columns' kinds from their rows", () => {
        const kinds = Object.fromEntries(
          make()
            .dated()
            .getSchema()
            .columns.map((c) => [c.id, c.kind]),
        );
        expect(kinds).toMatchObject({ booked: "date", posted: "datetime", stamped: "datetime" });
      });

      it("applies them, holds each as given, and undoes to the exact snapshot", async () => {
        const adapter = make().dated();
        const snapshot = adapter.getState();
        const ops = dateFilters();
        const { plan } = validated(adapter, ops);
        const applied = await adapter.apply(plan);
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        const held = adapter.getState();
        expect(held.revision).toBe(applied.state.revision);
        expect(held.state.filters?.children).toEqual(ops.map((op) => (op as { predicate: FilterPredicate }).predicate));
        const restored = await adapter.restore(snapshot);
        expect(restored.ok).toBe(true);
        expect(adapter.getState().state).toEqual(snapshot.state);
      });

      it("adds a date filter to one already held, and clears both", async () => {
        const adapter = make().dated();
        const [first, second] = dateFilters();
        if (!first || !second) throw new Error("no filters");
        expect((await adapter.apply(validated(adapter, [first]).plan)).ok).toBe(true);
        expect((await adapter.apply(validated(adapter, [second]).plan)).ok).toBe(true);
        expect(adapter.getState().state.filters?.children.map((c) => (c as FilterPredicate).id)).toEqual(["d0", "d1"]);
        expect((await adapter.apply(validated(adapter, [{ type: "filter.clear" }]).plan)).ok).toBe(true);
        expect(adapter.getState().state.filters).toBeNull();
      });
    });

    it("rejects every kind of invalid apply with a code starting with ADAPTER_", async () => {
      const h = make();
      const { plan: stalePlan } = validated(h.adapter, [{ type: "sort.set", sorts: [{ columnId: h.numericColumn, direction: "asc" }] }]);
      h.manualChange();
      const staleResult = await h.adapter.apply(stalePlan);
      expect(staleResult.ok).toBe(false);
      if (!staleResult.ok) expect(staleResult.code).toMatch(/^ADAPTER_/);

      const unvalidated = planFor(h.adapter, [{ type: "filter.clear" }]);
      const unvalidatedResult = await h.adapter.apply(unvalidated as never);
      expect(unvalidatedResult.ok).toBe(false);
      if (!unvalidatedResult.ok) expect(unvalidatedResult.code).toMatch(/^ADAPTER_/);
    });
  });
};
