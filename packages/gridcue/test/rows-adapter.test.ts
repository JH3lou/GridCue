import { describe, expect, it } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { isGridCueError } from "../src/core/errors";
import { emptyViewState } from "../src/core/protocol";
import { applyView, createRowsAdapter, type RowsAdapterOptions } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { DATED_COLUMNS, DATED_ROWS, runAdapterContract } from "./adapter-contract";

const schema = defineSchema([{ id: "value", kind: "number" }, { id: "team" }, { id: "name" }]);

const harnessWith = (renders?: RowsAdapterOptions["renders"]) => () => {
  const adapter = createRowsAdapter({ schema, ...(renders ? { renders } : {}) });
  return {
    adapter,
    manualChange: () => adapter.setState((s) => ({ ...s, sorts: [{ columnId: "team", direction: "asc" }] })),
    numericColumn: "value",
    otherColumn: "name",
    dated: () =>
      createRowsAdapter({
        schema: defineSchema(
          DATED_COLUMNS.map((id) => ({ id })),
          { sampleRows: DATED_ROWS },
        ),
        ...(renders ? { renders } : {}),
      }),
  };
};

// The Rows Adapter keeps a count with no option (ADR 0018). It lists pins, density and totals only when the Host's table
// draws them (operation set spec, 4.2; ADR 0029).
runAdapterContract("Rows Adapter", harnessWith(), { keepsCount: true });
runAdapterContract("Rows Adapter, renders pinning and density", harnessWith(["pinning", "density"]), {
  keepsCount: true,
  renders: ["pinning", "density"],
});
runAdapterContract("Rows Adapter, renders pinning", harnessWith(["pinning"]), { keepsCount: true, renders: ["pinning"] });
runAdapterContract("Rows Adapter, renders density", harnessWith(["density"]), { keepsCount: true, renders: ["density"] });
runAdapterContract("Rows Adapter, renders totals", harnessWith(["totals"]), { keepsCount: true, renders: ["totals"] });
runAdapterContract("Rows Adapter, renders pinning, density and totals", harnessWith(["pinning", "density", "totals"]), {
  keepsCount: true,
  renders: ["pinning", "density", "totals"],
});

describe("Rows Adapter: renders", () => {
  const configError = (renders: unknown) => {
    try {
      createRowsAdapter({ schema, renders } as unknown as RowsAdapterOptions);
    } catch (error) {
      return isGridCueError(error) ? { code: error.code, message: error.message } : { code: "other", message: String(error) };
    }
    return undefined;
  };

  it("lists exactly today's operations with no renders, or with an empty one", () => {
    const today = [...MVP_OPERATIONS, "limit.set"];
    expect(createRowsAdapter({ schema }).getCapabilities().operations).toEqual(today);
    expect(createRowsAdapter({ schema, renders: [] }).getCapabilities().operations).toEqual(today);
  });

  it("lists each operation once, whatever the order or repeats in renders", () => {
    const ops = createRowsAdapter({ schema, renders: ["density", "pinning", "density"] }).getCapabilities().operations;
    expect(ops).toEqual([...MVP_OPERATIONS, "limit.set", "columns.pin", "density.set"]);
  });

  it("throws INPUT_CONFIG naming a name it doesn't know", () => {
    expect(configError(["pinning", "sticky"])).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("“sticky”") });
    expect(configError(["Pinning"])).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("“Pinning”") });
  });

  it("takes totals, and lists aggregation.set for it (operation set spec, 5.4)", () => {
    expect(configError(["totals"])).toBeUndefined();
    const ops = createRowsAdapter({ schema, renders: ["totals", "totals"] }).getCapabilities().operations;
    expect(ops).toEqual([...MVP_OPERATIONS, "limit.set", "aggregation.set"]);
  });

  it("throws INPUT_CONFIG for count, which it keeps with no option", () => {
    expect(configError(["count"])).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("“count”") });
  });

  it("throws INPUT_CONFIG when renders isn't a list", () => {
    expect(configError("pinning")).toMatchObject({ code: "INPUT_CONFIG" });
  });
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

  // The Host makes pinned columns sticky and sets the row height from these (operation set spec, 5.3).
  describe("pinned columns and density", () => {
    const wide = defineSchema(["a", "b", "c", "d", "e"].map((id) => ({ id })));
    const base = emptyViewState(["a", "b", "c", "d", "e"]);

    it("reports no pins and the default density for the default view", () => {
      const result = applyView(rows, emptyViewState(["value", "team", "name"]), schema);
      expect(result.columns).toEqual(["value", "team", "name"]);
      expect(result.pinned).toEqual({ start: [], end: [] });
      expect(result.density).toBe("comfortable");
    });

    it("puts start-pinned columns first and end-pinned columns last, each in its pin order", () => {
      const state = { ...base, pinnedColumnIds: { start: ["d", "b"], end: ["e", "a"] } };
      const result = applyView([], state, wide);
      expect(result.columns).toEqual(["d", "b", "c", "e", "a"]);
      expect(result.pinned).toEqual({ start: ["d", "b"], end: ["e", "a"] });
    });

    it("keeps the column order among the columns that aren't pinned", () => {
      const state = {
        ...base,
        columnOrder: ["e", "d", "c", "b", "a"],
        visibleColumnIds: ["e", "d", "c", "b", "a"],
        pinnedColumnIds: { start: ["c"], end: [] },
      };
      expect(applyView([], state, wide).columns).toEqual(["c", "e", "d", "b", "a"]);
    });

    it("leaves a hidden pinned column out of the columns and out of both pin lists", () => {
      const state = { ...base, visibleColumnIds: ["a", "c", "d", "e"], pinnedColumnIds: { start: ["b", "c"], end: ["d"] } };
      const result = applyView([], state, wide);
      expect(result.columns).toEqual(["c", "a", "e", "d"]);
      expect(result.pinned).toEqual({ start: ["c"], end: ["d"] });
    });

    it("leaves out a pinned id that isn't a column of the view", () => {
      const state = { ...base, pinnedColumnIds: { start: ["gone", "a"], end: ["also-gone"] } };
      const result = applyView([], state, wide);
      expect(result.columns).toEqual(["a", "b", "c", "d", "e"]);
      expect(result.pinned).toEqual({ start: ["a"], end: [] });
    });

    it("returns the view's density", () => {
      expect(applyView([], { ...base, density: "compact" }, wide).density).toBe("compact");
      expect(applyView([], { ...base, density: "spacious" }, wide).density).toBe("spacious");
    });

    it("changes no rows, whatever is pinned or the density", () => {
      const state = {
        ...emptyViewState(["value", "team", "name"]),
        pinnedColumnIds: { start: ["name"], end: [] },
        density: "compact" as const,
      };
      expect(applyView(rows, state, schema).rows).toEqual(rows);
    });
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
      // Value has no total, so the groups keep the order they first appear in the rows shown (ADR 0030): "b" at
      // "five", then "a" at "twenty". The rows inside each are sorted.
      expect(result.groups?.flatMap((g) => g.rows.map((r) => r.name))).toEqual(["twelve", "five", "twenty"]);
    });
  });
});
