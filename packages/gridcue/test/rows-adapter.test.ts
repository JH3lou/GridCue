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

  // A row with no value in the first sorted column never fills a count (ADR 0027).
  describe("a count with empty values", () => {
    const base = createRowsAdapter({ schema }).getState().state;
    const withEmpty: Array<{ value?: number | null; team: string; name: string }> = [
      { value: null, team: "a", name: "empty-1" },
      { value: 5, team: "b", name: "five" },
      { team: "a", name: "missing" },
      { value: 20, team: "a", name: "twenty" },
      { value: 12, team: "b", name: "twelve" },
      { value: null, team: "b", name: "empty-2" },
    ];
    const names = (state: typeof base) => applyView(withEmpty, state, schema).rows.map((r) => r.name);

    it("keeps the top N by value in a descending sort, never an empty one", () => {
      expect(names({ ...base, sorts: [{ columnId: "value", direction: "desc" }], limit: 2 })).toEqual(["twenty", "twelve"]);
    });

    it("keeps the bottom N by value in an ascending sort, never an empty one", () => {
      expect(names({ ...base, sorts: [{ columnId: "value", direction: "asc" }], limit: 2 })).toEqual(["five", "twelve"]);
    });

    it("shows fewer than N rows when fewer than N have a value", () => {
      expect(names({ ...base, sorts: [{ columnId: "value", direction: "desc" }], limit: 10 })).toEqual(["twenty", "twelve", "five"]);
      expect(names({ ...base, sorts: [{ columnId: "value", direction: "asc" }], limit: 10 })).toEqual(["five", "twelve", "twenty"]);
    });

    it("looks only at the first sorted column", () => {
      const state = {
        ...base,
        sorts: [
          { columnId: "value", direction: "desc" as const },
          { columnId: "team", direction: "asc" as const },
        ],
        limit: 10,
      };
      expect(names(state)).toEqual(["twenty", "twelve", "five"]);
      const byTeam = {
        ...base,
        sorts: [
          { columnId: "team", direction: "asc" as const },
          { columnId: "value", direction: "desc" as const },
        ],
        limit: 10,
      };
      expect(names(byTeam)).toHaveLength(6);
    });

    it("treats empty text and a number that isn't one as no value, as filters do", () => {
      const blanks: Array<{ value: number | null; team: string; name: string }> = [
        { value: Number.NaN, team: "", name: "nan" },
        { value: 5, team: "b", name: "five" },
        { value: 9, team: "", name: "nine" },
        { value: 7, team: "a", name: "seven" },
        { value: null, team: "c", name: "empty" },
      ];
      const shown = (state: typeof base) => applyView(blanks, state, schema).rows.map((r) => r.name);
      expect(shown({ ...base, sorts: [{ columnId: "team", direction: "asc" }], limit: 2 })).toEqual(["seven", "five"]);
      expect(shown({ ...base, sorts: [{ columnId: "value", direction: "desc" }], limit: 2 })).toEqual(["nine", "seven"]);
      expect(shown({ ...base, sorts: [{ columnId: "value", direction: "asc" }], limit: 10 })).toEqual(["five", "seven", "nine"]);
    });

    it("keeps the first N rows as they are when the view has no sort", () => {
      expect(names({ ...base, sorts: [], limit: 3 })).toEqual(["empty-1", "five", "missing"]);
    });

    it("keeps every row, empty ones too, when the view has no count", () => {
      expect(names({ ...base, sorts: [{ columnId: "value", direction: "desc" }] })).toHaveLength(6);
    });

    it("drops empty rows before grouping, so the groups hold only the counted rows", () => {
      const result = applyView(
        withEmpty,
        { ...base, sorts: [{ columnId: "value", direction: "desc" }], limit: 10, groupBy: ["team"] },
        schema,
      );
      expect(result.groups?.flatMap((g) => g.rows.map((r) => r.name))).toEqual(["twenty", "twelve", "five"]);
    });
  });
});
