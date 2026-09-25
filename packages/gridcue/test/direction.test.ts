import { describe, expect, it } from "vitest";
import { createGridCue } from "../src/core/controller";
import type { IntentProvider } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// A direction in the text ("largest first") is a sort the User asked for. It is never silently dropped beside
// another change, and code never guesses its column (pre-launch fix: "accounts excluding trusts, largest first").
const schema = defineSchema([{ id: "name" }, { id: "type" }, { id: "custodian" }, { id: "value", kind: "currency" }], {
  rowNoun: "account",
  columns: {
    type: {
      enumValues: [
        { id: "taxable", label: "Taxable" },
        { id: "trust", label: "Trust" },
      ],
    },
  },
});
const setup = (provider: IntentProvider = createMockProvider()) => createGridCue({ adapter: createRowsAdapter({ schema }), provider });

describe("a direction with no sort picked", () => {
  it("asks which column to sort by, then applies both changes", async () => {
    const cue = setup();
    const plan = await cue.propose("trusts, largest first");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(plan?.clarifications.map((q) => q.id)).toEqual(["c0.sort.column"]);
    expect(plan?.clarifications[0]?.prompt).toBe("Which column should be sorted by?");
    cue.answer("c0.sort.column", "value");
    expect(cue.getState().status).toBe("ready");
    expect(cue.getState().plan?.operations).toEqual([
      expect.objectContaining({ type: "filter.add" }),
      { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
    ]);
  });

  it("never reads the row noun as the column to sort by", async () => {
    const cue = setup();
    await cue.propose("accounts excluding trusts, largest first");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().plan?.clarifications[0]?.id).toBe("c0.sort.column");
  });

  it("keeps a hide beside the sort it asks about", async () => {
    const cue = setup();
    await cue.propose("hide custodian, high to low");
    cue.answer("c0.sort.column", "value");
    expect(cue.getState().plan?.operations).toEqual([
      { type: "columns.hide", columnIds: ["custodian"] },
      { type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] },
    ]);
  });

  it("asks even when a provider picks only the filter", async () => {
    const filterOnly: IntentProvider = {
      resolve: async (req) => ({
        clauses: req.clauses.map((c) => ({
          clauseIndex: c.index,
          families: [{ id: "filter", confidence: 0.99 }],
          columns: [],
          values: [{ columnId: "type", valueId: "taxable", confidence: 0.99 }],
          unmatchedTerms: [],
        })),
      }),
    };
    const cue = setup(filterOnly);
    await cue.propose("taxable, biggest first");
    expect(cue.getState().status).toBe("needs_clarification");
  });

  it("adds no question when the sort already has its column", async () => {
    const cue = setup();
    await cue.propose("sort by value, largest first");
    expect(cue.getState().status).toBe("ready");
    expect(cue.getState().plan?.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }]);
  });
});
