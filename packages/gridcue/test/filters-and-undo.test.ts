import { describe, expect, it } from "vitest";
import { createGridCue } from "../src/core/controller";
import { renderPreview } from "../src/core/preview";
import { emptyViewState } from "../src/core/protocol";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// User feedback on the live demo: a filter with no results left every later filter empty, and undo couldn't get
// back to the unfiltered grid.
const schema = defineSchema([{ id: "type" }, { id: "custodian" }, { id: "value", kind: "currency" }], {
  columns: {
    type: {
      enumValues: [
        { id: "taxable", label: "Taxable" },
        { id: "trust", label: "Trust" },
      ],
    },
    custodian: {
      enumValues: [
        { id: "northgate", label: "Northgate" },
        { id: "harborline", label: "Harborline" },
      ],
    },
  },
});
const setup = () => {
  const adapter = createRowsAdapter({ schema, initialState: emptyViewState(schema.columns.map((c) => c.id)) });
  const cue = createGridCue({ adapter, provider: createMockProvider({ defaultColumnForKind: { currency: "value" } }) });
  const run = async (text: string) => {
    await cue.propose(text);
    expect(cue.getState().status).toBe("ready");
    const lines = cue.getState().preview?.lines;
    await cue.apply();
    return lines;
  };
  const filters = () => (adapter.getState().state.filters?.children ?? []).map((p) => ("columnId" in p ? p.columnId : "group"));
  return { adapter, cue, run, filters };
};

describe("a new filter", () => {
  it("replaces the current filters, and the Preview names the ones it removes", async () => {
    const { run, filters } = setup();
    await run("value over $100 million");
    const lines = await run("show trusts");
    expect(lines).toEqual(["Remove the filter Value above $100,000,000", "Filter Type to Trust"]);
    expect(filters()).toEqual(["type"]);
  });

  it("adds to them when the request says so", async () => {
    const { run, filters } = setup();
    await run("show trusts");
    const lines = await run("also only northgate");
    expect(lines).toEqual(["Filter Custodian to Northgate"]);
    expect(filters()).toEqual(["type", "custodian"]);
  });

  it("clears once for a request with several filters", async () => {
    const { run, filters } = setup();
    await run("show trusts");
    await run("taxable accounts over $1 million");
    expect(filters()).toEqual(["type", "value"]);
  });

  it("reads “also” with the change it sits next to", async () => {
    const { run, filters } = setup();
    await run("value over $100 million");
    // "also" goes with the sort here, so the trust filter still replaces the old one.
    expect(await run("show trusts and also sort by value")).toContain("Remove the filter Value above $100,000,000");
    expect(filters()).toEqual(["type"]);
    // "too" after a filter keeps the current ones.
    await run("show northgate too");
    expect(filters()).toEqual(["type", "custodian"]);
  });

  it("lets the request's first filtering part decide, and combines filters within one request", async () => {
    const { run, filters } = setup();
    await run("value over $100 million");
    await run("also show taxable, then show northgate");
    expect(filters()).toEqual(["value", "type", "custodian"]);
  });

  it("names a removed yes/no filter plainly", () => {
    const flags = defineSchema([{ id: "restricted", label: "Restricted holdings", kind: "boolean" }]);
    const current = {
      filters: {
        id: "g1",
        type: "group" as const,
        combinator: "and" as const,
        children: [{ id: "f1", type: "predicate" as const, columnId: "restricted", operator: "eq" as const, value: true }],
      },
    };
    expect(renderPreview({ operations: [{ type: "filter.clear" }] }, flags, current).lines).toEqual([
      "Remove the filter Restricted holdings is Yes",
    ]);
  });

  it("changes nothing when there were no filters", async () => {
    const { run } = setup();
    expect(await run("show trusts")).toEqual(["Filter Type to Trust"]);
  });
});

describe("undo", () => {
  it("steps back through every applied change to the starting view", async () => {
    const { adapter, cue, run } = setup();
    const start = adapter.getState().state;
    await run("value over $100 million");
    await run("show trusts");
    await run("also only northgate");
    for (let i = 0; i < 3; i++) expect(await cue.undo()).toBe(true);
    expect(adapter.getState().state).toEqual(start);
    expect(cue.getState().canUndo).toBe(false);
    expect(await cue.undo()).toBe(false);
  });

  it("treats two quick presses as one undo, and keeps the rest of the history", async () => {
    const { adapter, cue, run } = setup();
    const start = adapter.getState().state;
    await run("value over $100 million");
    await run("show trusts");
    const [a, b] = await Promise.all([cue.undo(), cue.undo()]);
    expect([a, b]).toEqual([true, true]);
    expect(cue.getState().canUndo).toBe(true);
    expect(await cue.undo()).toBe(true);
    expect(adapter.getState().state).toEqual(start);
  });

  it("stops at a manual change instead of erasing it", async () => {
    const { adapter, cue, run } = setup();
    await run("show trusts");
    // The User changes the grid by hand, then asks for another change.
    const now = adapter.getState();
    await adapter.restore({ ...now, state: { ...now.state, sorts: [{ columnId: "value", direction: "desc" }] } });
    await run("show northgate");
    expect(await cue.undo()).toBe(true);
    // Back to the hand-made view, and no further: undoing "show trusts" would erase the manual sort.
    expect(adapter.getState().state.sorts).toEqual([{ columnId: "value", direction: "desc" }]);
    expect(cue.getState().canUndo).toBe(false);
  });
});
