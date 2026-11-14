import { describe, expect, it } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { cantQuestion, compile } from "../src/core/compile";
import { createGridCue } from "../src/core/controller";
import { normalize } from "../src/core/normalize";
import { emptyViewState } from "../src/core/protocol";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// A grid that can't group says so (more grids spec, 5.3). One test per row of the spec's table, then the shared
// "this grid can't" question, the hint, and the names that hold the word "group".
const schema = defineSchema(
  [
    { id: "account", label: "Account" },
    { id: "advisor", label: "Advisor" },
    { id: "custodian", label: "Custodian" },
    { id: "type", label: "Registration type" },
    { id: "plan", label: "Group name" },
    { id: "value", label: "Market value", kind: "currency" as const },
  ],
  {
    rowNoun: "account",
    columns: {
      advisor: { aliases: ["rep"] },
      value: { aliases: ["value"] },
      custodian: {
        kind: "enum",
        enumValues: [
          { id: "northgate", label: "Northgate" },
          { id: "harborline", label: "Harborline" },
        ],
      },
      type: {
        kind: "enum",
        enumValues: [
          { id: "taxable", label: "Taxable" },
          { id: "trust", label: "Trust" },
          { id: "group_annuity", label: "Group Annuity" },
        ],
      },
    },
  },
);
const provider = createMockProvider({ defaultColumnForKind: { currency: "value" } });

/** A grid built as a Host would build one that can't group: the Rows Adapter with `group.set` taken out. */
const grid = ({ group = true, count = true } = {}) => {
  const rows = createRowsAdapter({ schema });
  const adapter = {
    ...rows,
    getCapabilities: () => {
      const caps = rows.getCapabilities();
      const operations = caps.operations.filter((op) => (group || op !== "group.set") && (count || op !== "limit.set"));
      return { ...caps, operations };
    },
  };
  return { adapter, cue: createGridCue({ adapter, provider }) };
};
const CANT = "This grid can't group rows.";

/** Proposes `request` on a grid without `group.set`, and checks that it asks only "This grid can't group rows." */
const expectCantGroup = async (request: string, clauseIndex = 0) => {
  const { adapter, cue } = grid({ group: false });
  const before = adapter.getState();
  const plan = await cue.propose(request);
  expect(cue.getState().status, request).toBe("needs_clarification");
  expect(cue.getState().message).toBe(CANT);
  expect(cue.getState().preview).toBeNull();
  expect(plan?.operations).toEqual([]);
  expect(plan?.clarifications).toEqual([{ id: `c${clauseIndex}.cant`, prompt: CANT, required: true }]);
  expect(await cue.apply()).toBe(false);
  expect(adapter.getState()).toEqual(before);
};

describe("a grid that can't group says so (spec 5.3)", () => {
  it("asks “This grid can't group rows.” for “group by advisor”", async () => {
    await expectCantGroup("group by advisor");
  });

  it("asks the same for “taxable accounts grouped by custodian”, and nothing applies", async () => {
    await expectCantGroup("taxable accounts grouped by custodian");
  });

  it("asks the same for “ungroup”", async () => {
    await expectCantGroup("ungroup");
  });

  it("names only the changes the grid offers in the hint for “whatever looks risky”", async () => {
    const { cue } = grid({ group: false });
    await cue.propose("whatever looks risky");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().message).toBe(
      "I'm not sure what to change for “whatever looks risky”. Try asking to filter, sort, or show or hide columns.",
    );
  });

  it("changes nothing on a grid that lists group.set", async () => {
    const results = [];
    for (const request of ["group by advisor", "taxable accounts grouped by custodian", "whatever looks risky"]) {
      const { cue } = grid();
      const plan = await cue.propose(request);
      results.push({ status: cue.getState().status, message: cue.getState().message, operations: plan?.operations });
    }
    expect(results).toEqual([
      { status: "ready", message: null, operations: [{ type: "group.set", columnIds: ["advisor"] }] },
      {
        status: "ready",
        message: null,
        operations: [
          {
            type: "filter.add",
            predicate: expect.objectContaining({ columnId: "type", operator: "eq", value: "taxable" }),
            combineWith: "and",
          },
          { type: "group.set", columnIds: ["custodian"] },
        ],
      },
      {
        status: "needs_clarification",
        message: "I'm not sure what to change for “whatever looks risky”. Try asking to filter, sort, group, or show or hide columns.",
        operations: [],
      },
    ]);
    const { adapter, cue } = grid();
    adapter.setState((v) => ({ ...v, groupBy: ["advisor"] }));
    const plan = await cue.propose("ungroup");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([{ type: "group.set", columnIds: [] }]);
  });
});

describe("a grouping word in any part ends the whole request", () => {
  it.each([
    ["grouped by custodian", 0],
    ["Group the accounts by advisor.", 0],
    ["group by account type, then by advisor", 0],
    ["group by region", 0],
    ["only taxable accounts, grouped by rep", 1],
    ["group by advisor, only trust accounts", 0],
    ["sort by market value, grouped by custodian", 1],
    ["show taxable accounts and ungroup", 1],
    ["clear the grouping", 0],
    ["clear the sort and the grouping", 0],
    ["don't group by advisor", 0],
  ])("“%s” asks, with the ID of the part that groups", async (request, clauseIndex) => {
    await expectCantGroup(request, clauseIndex);
  });

  it("asks once, for the first part that groups, whatever else the request asks", async () => {
    await expectCantGroup("group by advisor, then whatever looks risky, then ungroup");
  });

  it("asks it on a grid that keeps no count either, in place of the count question", async () => {
    const { cue } = grid({ group: false, count: false });
    const plan = await cue.propose("group by advisor and show only the first 5 rows");
    expect(plan?.clarifications).toEqual([{ id: "c0.cant", prompt: CANT, required: true }]);
  });
});

describe("“group” inside a name is not a grouping word", () => {
  it.each([
    [
      "show group annuity accounts",
      [{ type: "filter.add", predicate: expect.objectContaining({ columnId: "type", value: "group_annuity" }), combineWith: "and" }],
    ],
    ["sort by group name", [{ type: "sort.set", sorts: [{ columnId: "plan", direction: "asc" }] }]],
    [
      'account contains "group"',
      [
        {
          type: "filter.add",
          predicate: expect.objectContaining({ columnId: "account", operator: "contains", value: "group" }),
          combineWith: "and",
        },
      ],
    ],
  ])("“%s” reads on a grid without group.set as it does on one with it", async (request, operations) => {
    const { cue: without } = grid({ group: false });
    const { cue: withGroup } = grid();
    const a = await without.propose(request);
    const b = await withGroup.propose(request);
    expect(without.getState().status).toBe("ready");
    expect(a?.operations).toEqual(operations);
    expect(a?.operations).toEqual(b?.operations);
  });

  it("still asks when a grouping word sits beside the name", async () => {
    await expectCantGroup("group by group name");
  });
});

describe("“group” after a name asks, though an article comes before the name", () => {
  // "The Northgate group" names a value and then the word "group". With the name blanked, "the" sits next to "group",
  // which reads as the noun in "the group stays". The name is a word between them, so the part still asks.
  it.each([
    "show accounts in the Northgate group",
    "the Harborline group",
    "show my taxable group",
    "show accounts in a trust group",
    "show the Northgate group only",
    "show accounts in the Northgate groups",
    "show accounts in the Northgate grouping",
    'show accounts in the "Northgate" group',
  ])("“%s” asks “This grid can't group rows.”", async (request) => {
    await expectCantGroup(request);
  });
});

describe("“group” as a noun after an article asks, wherever the name sits", () => {
  // "A group of Harborline accounts" may mean a grouping or only the Harborline accounts, and code can't tell which.
  // With no name between them, "a" sits next to "group", the noun in "the group stays". Only a group said to stay is
  // left alone.
  it.each([
    "a group of Harborline accounts",
    "show a group of Northgate accounts",
    "show me the group of taxable accounts",
    "the group of trust accounts over $1m",
    "accounts in the group Northgate",
    "show each group of Harborline accounts",
    "show the groups of Northgate accounts",
    'show a group of "Northgate" accounts',
    "a group of accounts",
    "show my group",
  ])("“%s” asks “This grid can't group rows.”", async (request) => {
    await expectCantGroup(request);
  });

  it("asks with the ID of the part that names the group", async () => {
    await expectCantGroup("sort by market value, then a group of Harborline accounts", 1);
  });
});

describe("any word built on “group” asks, with or without an article", () => {
  // "Groups", "grouping" and the like, with no article before them, used to pass unseen. After a sort, "groups by
  // advisor" then read as a second sort column, and the grid showed a sort without the grouping the User asked for.
  it.each([
    ["groups of Northgate accounts", 0],
    ["groups of taxable accounts", 0],
    ["sort by market value, groups by advisor", 0],
    ["sort by market value with groups by advisor", 0],
    ["sort by market value, then by advisor in groups", 1],
    ["sort by market value with grouping by advisor", 0],
    ["sort by market value with the grouping by advisor", 0],
    ["sort by market value and add the grouping by advisor", 0],
    ["sort by market value and grouping by custodian", 0],
    ["sort groups by market value", 0],
    ["stop grouping", 0],
    ["turn off grouping", 0],
    ["add grouping by custodian", 0],
    ["i want grouping by advisor", 0],
    ["regroup by advisor", 0],
    ["groupby advisor", 0],
    ["group_by advisor", 0],
    ["subgroup by advisor", 0],
    ["groupings by custodian", 0],
    ["make groups by advisor", 0],
    ["groups: advisor", 0],
    ["taxable accounts, grouping by custodian", 0],
  ])("“%s” asks, with the ID of the part that groups", async (request, clauseIndex) => {
    await expectCantGroup(request, clauseIndex);
  });

  it.each([
    "keep the sort and add the grouping by advisor",
    "keep the sort and the grouping by advisor",
    "keep the sort and a grouping by advisor",
  ])("“%s” asks: a grouping by a column is asked for, though a staying word comes first", async (request) => {
    await expectCantGroup(request);
  });

  it("leaves “regroup” with no “by” next alone", async () => {
    const { cue } = grid({ group: false });
    await cue.propose("regroup my thoughts and show whatever matters");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().message).not.toBe(CANT);
  });

  it("leaves a word joined by “_” to a name alone", async () => {
    const { cue } = grid({ group: false });
    await cue.propose("sort by group_name");
    expect(cue.getState().message).not.toBe(CANT);
  });
});

describe("“group” right after a text match is the text", () => {
  // "Contains Group" names the text to look for. GridCue asks what it asked before this rule, not the can't-group question.
  it.each(["account contains group", "show accounts containing group", "accounts named group"])(
    "“%s” asks as it did before, not “This grid can't group rows.”",
    async (request) => {
      const { cue } = grid({ group: false });
      await cue.propose(request);
      expect(cue.getState().status).not.toBe("ready");
      expect(cue.getState().message).not.toBe(CANT);
    },
  );

  it("still asks when “by” follows it", async () => {
    await expectCantGroup("accounts containing group by advisor");
  });
});

describe("a column labelled with “group”, beside a value of its own", () => {
  // A Host column "Group" with values Alpha and Beta: "the alpha group" names the column, not a grouping (spec 5.3,
  // "would change if"). Matching records the value alone, so the label is checked here against that value's column.
  const named = defineSchema(
    [
      { id: "account", label: "Account" },
      { id: "advisor", label: "Advisor" },
      { id: "age_group", label: "Age group" },
      { id: "grp", label: "Group" },
      { id: "value", label: "Market value", kind: "currency" as const },
    ],
    {
      rowNoun: "account",
      columns: {
        value: { aliases: ["value"] },
        grp: {
          kind: "enum",
          enumValues: [
            { id: "alpha", label: "Alpha" },
            { id: "beta", label: "Beta" },
          ],
        },
        age_group: {
          kind: "enum",
          enumValues: [
            { id: "young", label: "Under 40" },
            { id: "mid", label: "40 to 60" },
          ],
        },
      },
    },
  );
  const namedGrid = (group: boolean) => {
    const rows = createRowsAdapter({ schema: named });
    const adapter = {
      ...rows,
      getCapabilities: () => {
        const caps = rows.getCapabilities();
        return { ...caps, operations: caps.operations.filter((op) => group || op !== "group.set") };
      },
    };
    return createGridCue({ adapter, provider });
  };
  const read = async (request: string, group: boolean) => {
    const cue = namedGrid(group);
    const plan = await cue.propose(request);
    return { status: cue.getState().status, message: cue.getState().message, operations: plan?.operations };
  };

  it.each(["alpha group accounts", "show alpha group", "accounts in the alpha group", "show the beta group only", "group = beta"])(
    "“%s” reads on a grid without group.set as it does on one with it",
    async (request) => {
      const without = await read(request, false);
      expect(without.status).toBe("ready");
      expect(without.operations).toEqual([
        { type: "filter.add", predicate: expect.objectContaining({ columnId: "grp", operator: "eq" }), combineWith: "and" },
      ]);
      expect(without).toEqual(await read(request, true));
    },
  );

  it("asks “show the under 40 age group” as it does on a grid with group.set", async () => {
    const without = await read("show the under 40 age group", false);
    expect(without.status).toBe("needs_clarification");
    expect(without.message).not.toBe(CANT);
    expect(without).toEqual(await read("show the under 40 age group", true));
  });

  it.each(["group by group", "alpha group, grouped by advisor", "alpha group by advisor"])(
    "“%s” still asks “This grid can't group rows.”",
    async (request) => {
      const cue = namedGrid(false);
      const plan = await cue.propose(request);
      expect(cue.getState().status).toBe("needs_clarification");
      expect(cue.getState().message).toBe(CANT);
      expect(plan?.operations).toEqual([]);
    },
  );

  it("never shows a ready Preview for “group alpha accounts by advisor”", async () => {
    // Matching reads "group" before a value of its own column as the column's name, on either grid. The part still asks.
    const without = await read("group alpha accounts by advisor", false);
    expect(without.status).toBe("needs_clarification");
    expect(without.operations).toEqual([]);
  });
});

describe("a grouping named only to say it stays is not asked for", () => {
  it.each([
    ["clear the sort, the grouping stays", [{ type: "sort.set", sorts: [] }]],
    ["clear the sort but keep the grouping", [{ type: "sort.set", sorts: [] }]],
    ["clear the sort, the group stays", [{ type: "sort.set", sorts: [] }]],
    ["clear the filters, leave the grouping as is", [{ type: "filter.clear" }]],
    ["clear the filters but keep groups", [{ type: "filter.clear" }]],
    ["sort by market value without grouping", [{ type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] }]],
  ])("“%s” reads as it did, on a grid without group.set", async (request, operations) => {
    const { adapter, cue } = grid({ group: false });
    adapter.setState((v) => ({
      ...v,
      sorts: [{ columnId: "value", direction: "desc" }],
      filters: {
        id: "g",
        type: "group",
        combinator: "and",
        children: [{ id: "p", type: "predicate", columnId: "type", operator: "eq", value: "trust" }],
      },
    }));
    const plan = await cue.propose(request);
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual(operations);
  });

  it("asks “reset everything but the grouping” as it did, not the can't-group question", async () => {
    const { cue } = grid({ group: false });
    await cue.propose("reset everything but the grouping");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().message).toBe("There's no grouping in the view to keep.");
  });

  it.each(["keep the sort and add the grouping", "keep the sort, add grouping", "keep the sort and add groups"])(
    "“%s” asks: the staying word governs the sort, not the grouping",
    async (request) => {
      await expectCantGroup(request);
    },
  );

  // A review found these asked "This grid can't group rows." though each was ready, and the same, on any grid.
  it.each([
    "sort by value, don't change the grouping",
    "sort by value, do not change the grouping",
    "sort by value, no change to grouping",
    "sort by value, no changes to the grouping",
    "sort by value, retain the grouping",
    "sort by value, preserve grouping",
    "sort by value, maintain the grouping",
    "sort by value excluding grouping",
    "sort by value w/o grouping",
  ])("“%s” reads as on a grid with group.set", async (request) => {
    const withGroup = await grid().cue.propose(request);
    const { cue } = grid({ group: false });
    const plan = await cue.propose(request);
    expect(cue.getState().status, request).toBe("ready");
    expect(plan?.operations).toEqual(withGroup?.operations);
    expect(plan?.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] }]);
  });

  // "Forget the grouping" may mean "drop it", which this grid can't do, so these keep asking.
  it.each([
    "sort by value, ignore grouping",
    "sort by value, skip the grouping",
    "sort by value, forget the grouping",
    "sort by value, never mind the grouping",
  ])("“%s” still asks", async (request) => {
    await expectCantGroup(request);
  });
});

describe("leaving out an ungrouping asks for groups", () => {
  // "Not ungrouped" is a double negative: it asks for grouped rows, which this grid can't show. Before, "not" right
  // before the word read it as left out, and the plan sorted without the grouping the User asked for.
  it.each([
    "sort by value, not ungrouped",
    "sort by value but not ungrouped",
    "sort by value and not ungrouped",
    "sort by value, not the ungrouped",
    "sort by value, no ungrouped",
    "sort by value, anything but ungrouped",
    "sort by value, everything but ungrouped",
    "sort by value, all but ungrouped",
    "sort by value, except ungrouped",
    "sort by value, other than ungrouped",
    "sort by value, apart from ungrouped",
    "sort by value excluding ungrouped",
    "sort by value without ungrouping",
    "show northgate accounts not ungrouped",
  ])("“%s” asks “This grid can't group rows.”", async (request) => {
    const { adapter, cue } = grid({ group: false });
    const before = adapter.getState();
    const plan = await cue.propose(request);
    expect(cue.getState().status, request).toBe("needs_clarification");
    expect(cue.getState().message, request).toBe(CANT);
    expect(plan?.operations).toEqual([]);
    expect(await cue.apply()).toBe(false);
    expect(adapter.getState()).toEqual(before);
  });

  it("asks it for “taxable accounts, not ungrouped”, and nothing applies", async () => {
    await expectCantGroup("taxable accounts, not ungrouped");
  });

  it("reads “sort by value, leave ungrouped” as on a grid with group.set: it keeps rows ungrouped", async () => {
    const request = "sort by value, leave ungrouped";
    const withGroup = await grid().cue.propose(request);
    const { cue } = grid({ group: false });
    const plan = await cue.propose(request);
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual(withGroup?.operations);
    expect(plan?.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] }]);
  });
});

describe("no word built on “group” leaves a ready Preview, unless it is said to stay with nothing after it", () => {
  // A re-check found sorts that dropped the grouping the User asked for: "sort by value, regroup on advisor" read
  // "advisor" as a second sort column. Any word built on "group", outside a declared name or quoted text, now never
  // ends ready. The only exception is a grouping said to stay or left out, with nothing after it in its part but
  // punctuation or a joining word.
  /** Proposes `request` on a grid without group.set, and checks that nothing is ready and nothing applies. */
  const expectNothingReady = async (request: string) => {
    const { adapter, cue } = grid({ group: false });
    const before = adapter.getState();
    const plan = await cue.propose(request);
    expect(cue.getState().status, request).not.toBe("ready");
    expect(cue.getState().preview, request).toBeNull();
    expect(plan?.operations, request).toEqual([]);
    expect(await cue.apply()).toBe(false);
    expect(adapter.getState()).toEqual(before);
    return cue.getState().message;
  };

  describe("said to stay, with more after it", () => {
    it.each([
      "sort by value, the grouping stays on advisor",
      "sort by value, leave grouping on advisor",
      "sort by value, grouping remains on advisor",
      "sort by value, the groups stay by custodian",
      "sort by value, leave the groups as is on advisor",
      "sort by value, the grouping remains, advisor first",
      "sort by value, the groups remain with advisor",
    ])("“%s” asks", async (request) => {
      expect(await expectNothingReady(request)).toBe(CANT);
    });

    // "Keep" starts a part of its own, which already asks; it keeps that question.
    it.each(["sort by value, keep grouping on custodian", "sort by value, keep the groups unchanged under rep"])(
      "“%s” asks as it did",
      async (request) => {
        const part = request.slice("sort by value, ".length);
        expect(await expectNothingReady(request)).toBe(
          `I'm not sure what to change for “${part}”. Try asking to filter, sort, or show or hide columns.`,
        );
      },
    );
  });

  describe("“regroup” and “subgroup”", () => {
    it.each([
      "sort by value, regroup the accounts by advisor",
      "sort by value, regroup on advisor",
      "sort by value, subgroup advisor",
      "sort by value, then advisor, regrouped",
      "sort by value, regroup accounts on custodian",
      "sort by value, subgroup on advisor",
      "sort by value, regrouping on advisor",
      "sort by value, subgroups advisor",
      "sort by value, then rep, regroup",
    ])("“%s” asks", async (request) => {
      expect(await expectNothingReady(request)).toBe(CANT);
    });
  });

  describe("after a word that matches text", () => {
    it.each([
      "sort by value, then advisor like groups",
      "sort by value, then advisor matching groups",
      "sort by value, then advisor called groups",
      "sort by value, then advisor containing groups",
      "sort by value, then rep named groups",
      "sort by value, then advisor like grouping",
      "sort by value, then custodian matches groups",
      "sort by value, then rep matching grouping",
    ])("“%s” asks", async (request) => {
      expect(await expectNothingReady(request)).toBe(CANT);
    });

    it("keeps the question “advisor starting with groups” asked before: it was never ready", async () => {
      expect(await expectNothingReady("sort by value, then advisor starting with groups")).toBe(
        "What should “advisor starting with groups” filter on? Include a value, such as an amount or a category.",
      );
    });
  });

  describe("other words built on “group”", () => {
    it.each([
      "sort by value, by advisor groupwise",
      "sort by value, then rep groupwise",
      "sort by value, groupwise on custodian",
      "sort by value, then custodian, groupwise",
      "sort by value, then advisor ingroup",
      "sort by value, then advisor, supergroups",
    ])("“%s” asks", async (request) => {
      expect(await expectNothingReady(request)).toBe(CANT);
    });
  });

  describe("controls that read as they did", () => {
    const withState = () => {
      const g = grid({ group: false });
      g.adapter.setState((v) => ({
        ...v,
        sorts: [{ columnId: "value", direction: "desc" }],
        filters: {
          id: "g",
          type: "group",
          combinator: "and",
          children: [{ id: "p", type: "predicate", columnId: "type", operator: "eq", value: "trust" }],
        },
      }));
      return g;
    };
    it.each([
      ["clear the sort, the grouping stays", [{ type: "sort.set", sorts: [] }]],
      ["clear the sort but keep the grouping", [{ type: "sort.set", sorts: [] }]],
      ["clear the filters, not the grouping", [{ type: "filter.clear" }]],
      ["clear the filters but keep groups", [{ type: "filter.clear" }]],
      ["clear the filters, leave the groups alone.", [{ type: "filter.clear" }]],
      ["sort by value without grouping", [{ type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] }]],
    ])("“%s” is ready on a grid without group.set", async (request, operations) => {
      const { cue } = withState();
      const plan = await cue.propose(request);
      expect(cue.getState().status).toBe("ready");
      expect(plan?.operations).toEqual(operations);
    });

    it("asks “clear the sort, keep the grouping” as on a grid with group.set, not the can't-group question", async () => {
      // "Keep the grouping" is a part of its own, which asks on either grid; only the hint drops "group".
      const { cue } = withState();
      await cue.propose("clear the sort, keep the grouping");
      expect(cue.getState().status).toBe("needs_clarification");
      expect(cue.getState().message).toBe(
        "I'm not sure what to change for “keep the grouping”. Try asking to filter, sort, or show or hide columns.",
      );
    });

    it("keeps the hint question for “regroup my thoughts and show taxable accounts”", async () => {
      const { cue } = grid({ group: false });
      await cue.propose("regroup my thoughts and show taxable accounts");
      expect(cue.getState().status).toBe("needs_clarification");
      expect(cue.getState().message).toBe(
        "I'm not sure what to change for “regroup my thoughts”. Try asking to filter, sort, or show or hide columns.",
      );
    });
  });
});

describe("the one “this grid can't” question", () => {
  it("takes the operation the grid doesn't list, and starts its ID with the part's index", () => {
    expect(cantQuestion(2, { type: "group.set" })).toEqual({ id: "c2.cant", prompt: CANT, required: true });
    expect(cantQuestion(0, { type: "limit.set", count: 5 })).toEqual({
      id: "c0.cant",
      prompt: "This grid can't show only the first 5 rows.",
      required: true,
    });
    expect(cantQuestion(1, { type: "limit.set", count: 1 }).prompt).toBe("This grid can't show only the first 1 row.");
    expect(cantQuestion(0, { type: "limit.set", count: 1500 }).prompt).toBe("This grid can't show only the first 1,500 rows.");
  });

  it("asks the count question from it, with its words unchanged", async () => {
    const { cue } = grid({ count: false });
    const plan = await cue.propose("sort by market value, show only the first 5 rows");
    expect(plan?.clarifications).toContainEqual({ id: "c1.cant", prompt: "This grid can't show only the first 5 rows.", required: true });
    expect(plan?.operations).toEqual([]);
  });
});

describe("the hint names only the grid's changes", () => {
  const hint = (operations?: readonly string[]) =>
    compile({
      input: normalize("whatever looks risky"),
      resolution: { clauses: [{ clauseIndex: 0, families: [], columns: [], values: [], unmatchedTerms: [] }] },
      schema,
      state: emptyViewState(schema.columns.map((c) => c.id)),
      baseRevision: "r1",
      channel: "typed",
      ...(operations ? { operations } : {}),
      newId: (p) => p,
    }).clarifications[0]?.prompt;
  const ask = (rest: string) => `I'm not sure what to change for “whatever looks risky”.${rest}`;

  it.each([
    [undefined, " Try asking to filter, sort, group, or show or hide columns."],
    [[...MVP_OPERATIONS], " Try asking to filter, sort, group, or show or hide columns."],
    [MVP_OPERATIONS.filter((op) => op !== "group.set"), " Try asking to filter, sort, or show or hide columns."],
    [["filter.add", "sort.set"], " Try asking to filter or sort."],
    [["sort.set", "group.set", "columns.hide"], " Try asking to sort, group, or hide columns."],
    [["columns.show"], " Try asking to show columns."],
    [[], ""],
  ])("on a grid that lists %j", (operations, rest) => {
    expect(hint(operations)).toBe(ask(rest));
  });

  it("names them in the hint for a request that changes nothing too", () => {
    const empty = (operations?: readonly string[]) =>
      compile({
        input: normalize(""),
        resolution: { clauses: [] },
        schema,
        state: emptyViewState(schema.columns.map((c) => c.id)),
        baseRevision: "r1",
        channel: "typed",
        ...(operations ? { operations } : {}),
        newId: (p) => p,
      }).clarifications[0]?.prompt;
    expect(empty()).toBe("That request doesn't change the view. Try filtering, sorting, grouping, or showing or hiding columns.");
    expect(empty(MVP_OPERATIONS.filter((op) => op !== "group.set"))).toBe(
      "That request doesn't change the view. Try filtering, sorting, or showing or hiding columns.",
    );
  });
});
