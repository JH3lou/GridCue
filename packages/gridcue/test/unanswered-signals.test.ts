import { describe, expect, it } from "vitest";
import { createGridCue } from "../src/core/controller";
import { emptyViewState } from "../src/core/protocol";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// When no one was asked whether a part adds a level, or which level is outer (the focused strategy, the Mock, or
// a provider without those questions), wording that may change the answer is asked about, never defaulted
// (pre-launch fix: focused applied a replaced grouping for "also group by advisor").
const schema = defineSchema([{ id: "advisor" }, { id: "custodian" }, { id: "household" }, { id: "value", kind: "currency" }], {
  rowNoun: "account",
});
const setup = (state: Partial<ReturnType<typeof emptyViewState>> = {}) =>
  createGridCue({
    adapter: createRowsAdapter({ schema, initialState: { ...emptyViewState(schema.columns.map((c) => c.id)), ...state } }),
    provider: createMockProvider(),
  });

describe("an unanswered add-a-level question", () => {
  it("asks whether a second grouping adds to the current one", async () => {
    const cue = setup({ groupBy: ["custodian"] });
    await cue.propose("group by advisor as another level");
    expect(cue.getState().plan?.clarifications[0]).toMatchObject({
      id: "c0.group.adds",
      prompt: "Add Advisor to the current grouping, or replace it?",
    });
    cue.answer("c0.group.adds", "add");
    expect(cue.getState().plan?.operations).toEqual([{ type: "group.set", columnIds: ["custodian", "advisor"] }]);
  });

  it("replaces when the User says so", async () => {
    const cue = setup({ groupBy: ["custodian"] });
    await cue.propose("group by advisor as another level");
    cue.answer("c0.group.adds", "replace");
    expect(cue.getState().plan?.operations).toEqual([{ type: "group.set", columnIds: ["advisor"] }]);
  });

  it("does not ask when there is nothing to add to", async () => {
    const cue = setup();
    await cue.propose("group by advisor as another level");
    expect(cue.getState().status).toBe("ready");
  });
});

describe("an unanswered outer-level question", () => {
  it("asks which grouping is outer for reversal wording", async () => {
    const cue = setup();
    await cue.propose("group by advisor within custodian");
    expect(cue.getState().plan?.clarifications[0]).toMatchObject({ id: "c0.group.outer", prompt: "Which should be the outer grouping?" });
    cue.answer("c0.group.outer", "custodian");
    expect(cue.getState().plan?.operations).toEqual([{ type: "group.set", columnIds: ["custodian", "advisor"] }]);
  });

  it("keeps the named order with no reversal wording", async () => {
    const cue = setup();
    await cue.propose("group by custodian, then by advisor");
    expect(cue.getState().plan?.operations).toEqual([{ type: "group.set", columnIds: ["custodian", "advisor"] }]);
  });
});

describe("the row noun after each or per", () => {
  it("reads “for each account” as the rows", async () => {
    const cue = setup();
    await cue.propose("show the household column for each account");
    expect(cue.getState().plan?.operations).toEqual([{ type: "columns.show", columnIds: ["household"] }]);
  });
});
