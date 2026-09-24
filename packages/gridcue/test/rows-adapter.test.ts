import { describe, expect, it } from "vitest";
import { applyView, createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { runAdapterContract } from "./adapter-contract";

const schema = defineSchema([{ id: "value", kind: "number" }, { id: "team" }, { id: "name" }]);

runAdapterContract("Rows Adapter", () => {
  const adapter = createRowsAdapter({ schema });
  return {
    adapter,
    manualChange: () => adapter.setState((s) => ({ ...s, sorts: [{ columnId: "team", direction: "asc" }] })),
    numericColumn: "value",
    otherColumn: "name",
  };
});

describe("applyView", () => {
  it("accepts rows typed as plain interfaces", () => {
    interface Account {
      value: number;
      team: string;
      name: string;
    }
    const typed: Account[] = [{ value: 1, team: "a", name: "n" }];
    expect(applyView(typed, createRowsAdapter({ schema }).getState().state, schema).rows).toEqual(typed);
  });

  const rows = [
    { value: 5, team: "b", name: "x" },
    { value: 20, team: "a", name: "y" },
    { value: 12, team: "b", name: "z" },
  ];

  it("filters, sorts, orders columns, and groups", () => {
    const adapter = createRowsAdapter({ schema });
    const state = {
      ...adapter.getState().state,
      filters: {
        id: "root",
        type: "group" as const,
        combinator: "and" as const,
        children: [{ id: "f", type: "predicate" as const, columnId: "value", operator: "gt" as const, value: 6 }],
      },
      sorts: [{ columnId: "value", direction: "desc" as const }],
      groupBy: ["team"],
      columnOrder: ["name", "value", "team"],
      visibleColumnIds: ["value", "name"],
    };
    const result = applyView(rows, state, schema);
    expect(result.columns).toEqual(["name", "value"]);
    expect(result.rows.map((r) => r.value)).toEqual([20, 12]);
    expect(result.groups?.map((g) => g.key)).toEqual([{ team: "a" }, { team: "b" }]);
  });
});
