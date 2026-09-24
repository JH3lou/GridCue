import { describe, expect, it } from "vitest";
import { GridCueError } from "../src/core/errors";
import { matchesFilter } from "../src/core/evaluate";
import { emptyViewState, type ViewOperation, type ViewPlan } from "../src/core/protocol";
import { applyOperations } from "../src/core/reduce";
import { defineSchema } from "../src/core/schema";
import { type ApplicableViewPlan, isApplicable, resultingState, validatePlan } from "../src/core/validate";

const schema = defineSchema([{ id: "name" }, { id: "value", kind: "currency" }, { id: "status", kind: "enum" }, { id: "secret" }], {
  restricted: ["secret"],
  columns: { status: { enumValues: [{ id: "open", label: "Open" }] }, name: { capabilities: ["show", "hide", "reorder"] } },
});
const base = { ...emptyViewState(["name", "value", "status", "secret"]), visibleColumnIds: ["name", "value", "status"] };
const caps = {
  operations: ["filter.add", "filter.clear", "sort.set", "group.set", "columns.show", "columns.hide", "columns.order", "view.reset"],
  maxSorts: 2,
  supportsAtomicApply: true,
  supportsSnapshotRestore: true,
  observesChanges: true,
};
const ctx = { schema, capabilities: caps, current: { revision: "r1", state: base }, defaultState: base };
const plan = (operations: ViewOperation[], extra: Partial<ViewPlan> = {}): ViewPlan => ({
  protocolVersion: "0.1",
  id: "p1",
  baseRevision: "r1",
  source: { channel: "typed" },
  status: "ready",
  operations,
  evidence: [],
  clarifications: [],
  unsupportedSegments: [],
  ...extra,
});
const gt = (value: unknown, columnId = "value"): ViewOperation =>
  ({
    type: "filter.add",
    combineWith: "and",
    predicate: { id: "f1", type: "predicate", columnId, operator: "gt", value },
  }) as ViewOperation;
const codes = (r: ReturnType<typeof validatePlan>) => (r.ok ? [] : r.issues.map((i) => i.code));

describe("validatePlan", () => {
  it("brands and freezes a valid plan", () => {
    const result = validatePlan(plan([gt(100), { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }]), ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isApplicable(result.plan)).toBe(true);
      expect(Object.isFrozen(result.plan.operations)).toBe(true);
      expect(result.state.sorts).toEqual([{ columnId: "value", direction: "desc" }]);
    }
  });

  it("cannot be fooled by a hand-made object", () => {
    expect(isApplicable(plan([]))).toBe(false);
  });

  it("refuses to compute resultingState for a plan that was not validated", () => {
    const unvalidated = plan([]) as unknown as ApplicableViewPlan;
    let error: unknown;
    try {
      resultingState(unvalidated);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GridCueError);
    expect((error as GridCueError).code).toBe("ADAPTER_NOT_APPLICABLE");
    expect((error as GridCueError).message).toBe("Plan was not validated.");
  });

  it.each([
    ["stale revision", plan([], { baseRevision: "r0" }), "PLAN_STALE_REVISION"],
    ["not ready", plan([], { status: "needs_clarification" }), "PLAN_NOT_READY"],
    ["unknown column", plan([gt(1, "nope")]), "PLAN_UNKNOWN_COLUMN"],
    ["restricted column", plan([{ type: "columns.show", columnIds: ["secret"] }]), "POLICY_RESTRICTED_COLUMN"],
    ["missing capability", plan([{ type: "sort.set", sorts: [{ columnId: "name", direction: "asc" }] }]), "PLAN_COLUMN_CAPABILITY"],
    ["wrong value type", plan([gt("lots")]), "PLAN_VALUE_TYPE"],
    ["unsupported operation", plan([{ type: "density.set", density: "compact" }]), "PLAN_OPERATION_UNSUPPORTED"],
    [
      "too many sorts",
      plan([{ type: "sort.set", sorts: ["value", "status", "value"].map((c) => ({ columnId: c, direction: "asc" as const })) }]),
      "PLAN_CARDINALITY",
    ],
    ["hides everything", plan([{ type: "columns.hide", columnIds: ["name", "value", "status"] }]), "PLAN_INCONSISTENT_STATE"],
    ["malformed", { nope: true }, "PLAN_SHAPE"],
  ])("rejects %s", (_name, input, code) => {
    expect(codes(validatePlan(input, ctx))).toContain(code);
  });

  it("rejects a plan the adapter cannot apply atomically", () => {
    const nonAtomicCtx = { ...ctx, capabilities: { ...caps, supportsAtomicApply: false } };
    const multiOp = plan([gt(100), { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }]);
    expect(codes(validatePlan(multiOp, nonAtomicCtx))).toContain("PLAN_NOT_ATOMIC");
  });

  it("rejects an operator the column's kind does not allow", () => {
    const op = {
      type: "filter.add",
      combineWith: "and",
      predicate: { id: "f1", type: "predicate", columnId: "value", operator: "contains", value: "abc" },
    } as ViewOperation;
    expect(codes(validatePlan(plan([op]), ctx))).toContain("PLAN_OPERATOR_NOT_ALLOWED");
  });

  it("rejects enum values the host did not approve", () => {
    const op = {
      type: "filter.add",
      combineWith: "and",
      predicate: { id: "f", type: "predicate", columnId: "status", operator: "eq", value: "closed" },
    } as ViewOperation;
    expect(codes(validatePlan(plan([op]), ctx))).toContain("PLAN_VALUE_TYPE");
  });
});

describe("applyOperations", () => {
  it("keeps visible columns in column order and resets to the default", () => {
    const next = applyOperations(
      base,
      [
        { type: "columns.hide", columnIds: ["name"] },
        { type: "columns.order", columnIds: ["status", "value"] },
      ],
      base,
    );
    expect(next.columnOrder).toEqual(["status", "value", "name", "secret"]);
    expect(next.visibleColumnIds).toEqual(["status", "value"]);
    expect(applyOperations(next, [{ type: "view.reset" }], base)).toEqual(base);
  });
});

describe("matchesFilter", () => {
  it("evaluates and/or trees with kind semantics", () => {
    const filter = applyOperations(base, [gt(100)], base).filters;
    expect(matchesFilter({ value: 150 }, filter, schema)).toBe(true);
    expect(matchesFilter({ value: null }, filter, schema)).toBe(false);
  });
});
