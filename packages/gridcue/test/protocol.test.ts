import { describe, expect, it } from "vitest";
import { emptyViewState, FilterGroup, ViewOperation, ViewPlan } from "../src/core/protocol";

describe("protocol schemas", () => {
  it("accepts nested filter groups", () => {
    const group = {
      id: "root",
      type: "group",
      combinator: "and",
      children: [
        { id: "f1", type: "predicate", columnId: "market_value", operator: "gt", value: 1_000_000 },
        { id: "g2", type: "group", combinator: "or", children: [] },
      ],
    };
    expect(FilterGroup.parse(group)).toEqual(group);
  });

  it("rejects operations outside the closed union", () => {
    expect(ViewOperation.safeParse({ type: "row.delete" }).success).toBe(false);
  });

  it("rejects a plan with an unknown protocol version", () => {
    const plan = {
      protocolVersion: "9.9",
      id: "p",
      baseRevision: "r1",
      source: { channel: "typed" },
      status: "ready",
      operations: [],
      evidence: [],
      clarifications: [],
      unsupportedSegments: [],
    };
    expect(ViewPlan.safeParse(plan).success).toBe(false);
  });

  it("builds an empty view that shows every column in order", () => {
    expect(emptyViewState(["a", "b"])).toMatchObject({ visibleColumnIds: ["a", "b"], columnOrder: ["a", "b"], filters: null });
  });
});
