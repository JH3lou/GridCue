import { describe, expect, it } from "vitest";
import type { GridAdapter } from "../src/core/adapter";
import type { ViewOperation, ViewPlan } from "../src/core/protocol";
import { validatePlan } from "../src/core/validate";

export interface ContractHarness {
  adapter: GridAdapter;
  /** Simulates the user changing the view by hand, outside GridCue. */
  manualChange(): void;
  /** Two column IDs that support filter and sort, the first numeric. */
  numericColumn: string;
  otherColumn: string;
}

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

/** Every Grid Adapter must pass this suite. */
export const runAdapterContract = (name: string, make: () => ContractHarness) => {
  describe(`${name}: adapter contract`, () => {
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

    it("does not advertise unsupported operations", () => {
      const h = make();
      for (const op of ["columns.pin", "aggregation.set", "density.set"]) {
        expect(h.adapter.getCapabilities().operations).not.toContain(op);
      }
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
