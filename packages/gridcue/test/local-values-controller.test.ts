import { describe, expect, it } from "vitest";
import { createGridCue, type GridCueOptions, type LocalValues } from "../src/core/controller";
import { isGridCueError } from "../src/core/errors";
import { renderPreview } from "../src/core/preview";
import type { ViewOperation, ViewSchema } from "../src/core/protocol";
import type { ClauseResolution, IntentProvider, ResolutionRequest } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema, type SchemaOptions } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// Local Values in the Controller and the compiler (named filters spec, 4.1 to 4.4 and 5.4; ADR 0025). A whole value of
// a column the Host names in `localValues` is an exact filter in the grid's own letter case. One word of a value, or a
// tie, asks which was meant, and the answer stays in the browser. Nothing about the values is sent to a provider.
const columns = [
  { id: "account_number", label: "Account number" },
  { id: "household", label: "Household" },
  { id: "advisor_name", label: "Advisor" },
  { id: "registration_type", label: "Registration type" },
  { id: "custodian", label: "Custodian" },
  { id: "market_value", label: "Market value" },
  { id: "unrealized_gain", label: "Unrealized gain" },
  { id: "has_restricted_holding", label: "Restricted holdings" },
  { id: "tax_id", label: "Tax ID" },
  { id: "notes", label: "Notes" },
];
const options: SchemaOptions = {
  rowNoun: "account",
  restricted: ["tax_id"],
  columns: {
    account_number: { aliases: ["account"] },
    household: { entity: "household" },
    advisor_name: { aliases: ["advisor"], entity: "advisor" },
    registration_type: {
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
    market_value: { kind: "currency", aliases: ["value"] },
    unrealized_gain: { kind: "currency", aliases: ["gain"] },
    has_restricted_holding: { kind: "boolean", aliases: ["restricted"] },
  },
};
const schema = defineSchema(columns, options);

// Synthetic names. "Jordan Pike" is in both columns, "Northgate" is also a custodian, "Kim" is a word of two advisors,
// and "Lee" a word of six.
const ADVISORS = [
  "Avery Lane",
  "Blake Moreno",
  "Casey Ortiz",
  "Kim Ross",
  "Kim Vale",
  "Jordan Pike",
  "Lee Adams",
  "Lee Brandt",
  "Lee Corran",
  "Dale Lee",
  "Lee Ferris",
  "Lee Gant",
];
const HOUSEHOLDS = ["Alder Household", "Birch Household", "Jordan Pike", "Northgate", null, ""];
const localValues: LocalValues = {
  advisor_name: () => ADVISORS,
  household: () => HOUSEHOLDS,
};

const mock = createMockProvider({ defaultColumnForKind: { currency: "market_value" } });
/** A provider that answers every part with `answer` (or the Mock's answer), and keeps each request it is sent. */
const watched = (answer?: Partial<ClauseResolution>) => {
  const requests: ResolutionRequest[] = [];
  const provider: IntentProvider = {
    resolve: async (request, signal) => {
      requests.push(structuredClone(request));
      if (!answer) return mock.resolve(request, signal);
      return {
        clauses: request.clauses.map((c) => ({
          clauseIndex: c.index,
          families: [],
          columns: [],
          values: [],
          unmatchedTerms: [],
          ...structuredClone(answer),
        })),
      };
    },
  };
  return { provider, requests };
};
const make = (more: Partial<GridCueOptions> = {}, s: ViewSchema = schema) => {
  const adapter = createRowsAdapter({ schema: s });
  const cue = createGridCue({ adapter, provider: mock, localValues, ...more });
  return { cue, adapter };
};
const propose = async (text: string, more: Partial<GridCueOptions> = {}) => {
  const { cue } = make(more);
  await cue.propose(text);
  return cue.getState();
};
const strip = (ops: readonly ViewOperation[] = []) =>
  ops.map((op) => {
    if (op.type !== "filter.add") return op;
    const { id: _id, ...predicate } = op.predicate;
    return { ...op, predicate };
  });
const filter = (columnId: string, operator: string, value?: unknown) => ({
  type: "filter.add",
  combineWith: "and",
  predicate: { type: "predicate", columnId, operator, ...(value === undefined ? {} : { value }) },
});
const lines = async (text: string, more: Partial<GridCueOptions> = {}) => {
  const state = await propose(text, more);
  return state.status === "ready" ? state.preview?.lines : state.message;
};
const configError = (more: Partial<GridCueOptions>, s: ViewSchema = schema) => {
  try {
    make(more, s);
  } catch (error) {
    return isGridCueError(error) ? error.code : "not a GridCue error";
  }
  return "no error";
};

describe("localValues when the Controller is made", () => {
  it("is off unless set", async () => {
    const state = await propose("accounts for Avery Lane", { localValues: undefined });
    expect(state.status).not.toBe("ready");
  });
  it("throws INPUT_CONFIG for a column that is not text", () => {
    expect(configError({ localValues: { market_value: () => [] } })).toBe("INPUT_CONFIG");
    expect(configError({ localValues: { registration_type: () => [] } })).toBe("INPUT_CONFIG");
  });
  it("throws INPUT_CONFIG for a restricted column", () => {
    expect(configError({ localValues: { tax_id: () => [] } })).toBe("INPUT_CONFIG");
  });
  it("throws INPUT_CONFIG for a column that is not exposed", () => {
    const hidden: ViewSchema = {
      ...schema,
      columns: schema.columns.map((c) => (c.id === "notes" ? { ...c, exposeToProvider: false } : c)),
    };
    expect(configError({ localValues: { notes: () => [] } }, hidden)).toBe("INPUT_CONFIG");
  });
  it("throws INPUT_CONFIG for a column that may not be filtered", () => {
    const fixed: ViewSchema = {
      ...schema,
      columns: schema.columns.map((c) => (c.id === "notes" ? { ...c, capabilities: c.capabilities.filter((x) => x !== "filter") } : c)),
    };
    expect(configError({ localValues: { notes: () => [] } }, fixed)).toBe("INPUT_CONFIG");
  });
  it("throws INPUT_CONFIG for a column whose operators leave out exact text", () => {
    // A real Host's name columns allowed "contains" alone: every name asked "GridCue can't filter … to exact text here".
    for (const allowedOperators of [["contains"], ["contains", "eq"], ["contains", "in"]] as const) {
      const limited: ViewSchema = {
        ...schema,
        columns: schema.columns.map((c) => (c.id === "notes" ? { ...c, allowedOperators: [...allowedOperators] } : c)),
      };
      expect(configError({ localValues: { notes: () => [] } }, limited), allowedOperators.join()).toBe("INPUT_CONFIG");
    }
    const exact: ViewSchema = {
      ...schema,
      columns: schema.columns.map((c) => (c.id === "notes" ? { ...c, allowedOperators: ["contains", "eq", "in"] } : c)),
    };
    expect(configError({ localValues: { notes: () => [] } }, exact)).toBe("no error");
  });
  it("throws INPUT_CONFIG for a column the grid doesn't have", () => {
    expect(configError({ localValues: { advisor: () => [] } })).toBe("INPUT_CONFIG");
  });
  it("throws INPUT_CONFIG for a value that is not a function, or no object", () => {
    expect(configError({ localValues: { advisor_name: ADVISORS } as unknown as LocalValues })).toBe("INPUT_CONFIG");
    expect(configError({ localValues: [] as unknown as LocalValues })).toBe("INPUT_CONFIG");
    expect(configError({ localValues: null as unknown as LocalValues })).toBe("INPUT_CONFIG");
  });
  it("throws INPUT_CONFIG for a Map, which would read as no columns", () => {
    const map = new Map([["advisor_name", () => ADVISORS]]);
    expect(configError({ localValues: map as unknown as LocalValues })).toBe("INPUT_CONFIG");
    expect(configError({ localValues: Object.assign(Object.create(null), { advisor_name: () => ADVISORS }) })).toBe("no error");
  });
  it("takes text columns that are exposed, not restricted, and may be filtered", () => {
    expect(configError({ localValues: { notes: () => [] } })).toBe("no error");
  });
});

describe("a function that throws", () => {
  const failing = (text: string, values: LocalValues) => {
    const { provider, requests } = watched();
    const { cue, adapter } = make({ provider, localValues: values });
    const before = adapter.getState();
    return { cue, adapter, before, requests, run: () => cue.propose(text) };
  };
  it("stops the request with INPUT_LOCAL_VALUES, and the view doesn't change", async () => {
    const { cue, adapter, before, requests, run } = failing("accounts for Avery Lane", {
      advisor_name: () => {
        throw new Error("the rows are not loaded");
      },
    });
    expect(await run()).toBeNull();
    const state = cue.getState();
    expect(state.status).toBe("error");
    expect(state.message).toBe("Couldn't read this grid's values. The view hasn't changed.");
    expect(state.issues).toEqual([{ code: "INPUT_LOCAL_VALUES", message: "Couldn't read this grid's values. The view hasn't changed." }]);
    expect(state.plan).toBeNull();
    expect(adapter.getState()).toEqual(before);
    expect(requests).toHaveLength(0);
  });
  it("never reads a request with half its values", async () => {
    const { cue, run } = failing("the Alder household", {
      advisor_name: () => ADVISORS,
      household: () => {
        throw new Error("not loaded");
      },
    });
    await run();
    expect(cue.getState().status).toBe("error");
    expect(cue.getState().plan).toBeNull();
  });
  it("stops the request when a function returns something other than a list", async () => {
    const { cue, run } = failing("accounts for Avery Lane", { advisor_name: () => "Avery Lane" as unknown as string[] });
    await run();
    expect(cue.getState().issues[0]?.code).toBe("INPUT_LOCAL_VALUES");
  });
  it("leaves a request the function cancelled or replaced alone, and never calls the provider for it", async () => {
    const { provider, requests } = watched();
    let mode = "cancel and throw";
    const { cue } = make({
      provider,
      localValues: {
        advisor_name: () => {
          if (mode === "cancel and throw") {
            cue.cancel();
            throw new Error("not loaded");
          }
          if (mode === "cancel") cue.cancel();
          if (mode === "replace and throw") {
            mode = "read";
            void cue.propose("sort by market value");
            throw new Error("not loaded");
          }
          return ADVISORS;
        },
      },
    });
    await cue.propose("accounts for Avery Lane");
    expect(cue.getState().status).toBe("idle");
    expect(cue.getState().issues).toEqual([]);
    mode = "cancel";
    await cue.propose("accounts for Avery Lane");
    expect(cue.getState().status).toBe("idle");
    expect(requests).toHaveLength(0);
    mode = "replace and throw";
    await cue.propose("accounts for Avery Lane");
    expect(cue.getState().issues).toEqual([]);
    expect(cue.getState().utterance).toBe("sort by market value");
  });
  it("is called when a request is made, every time", async () => {
    let calls = 0;
    const { cue } = make({
      localValues: {
        advisor_name: () => {
          calls++;
          return ADVISORS;
        },
      },
    });
    await cue.propose("taxable accounts");
    await cue.propose("accounts for Avery Lane");
    expect(calls).toBe(2);
  });
});

describe("the value index", () => {
  it("is kept while the function returns the same array, and rebuilt for a new one", async () => {
    let list = ["Avery Lane"];
    const { cue } = make({ localValues: { advisor_name: () => list } });
    await cue.propose("accounts for Avery Lane");
    expect(cue.getState().status).toBe("ready");
    // The same array, changed in place: the index built from it is kept, so the new name is not read.
    list.push("Blake Moreno");
    await cue.propose("accounts for Blake Moreno");
    expect(cue.getState().status).not.toBe("ready");
    // A new array: the index is built again.
    list = [...list];
    await cue.propose("accounts for Blake Moreno");
    expect(cue.getState().status).toBe("ready");
    expect(strip(cue.getState().plan?.operations)).toEqual([filter("advisor_name", "eq", "Blake Moreno")]);
  });
});

describe("the provider request does not change (spec 4.3)", () => {
  const requests = async (text: string, values?: LocalValues) => {
    const { provider, requests: seen } = watched();
    const { cue } = make({ provider, localValues: values });
    await cue.propose(text);
    return seen;
  };
  for (const text of [
    "Avery Lane's accounts",
    "Lane's accounts",
    "taxable accounts for Lane",
    "Jordan Pike's accounts",
    "the Alder household",
    "sort by Avery Lane",
    "taxable accounts",
    "accounts for Nobody Known",
  ]) {
    it(`is the same, and sent once, with the values on and off: ${text}`, async () => {
      const on = await requests(text, localValues);
      const off = await requests(text, undefined);
      expect(on).toHaveLength(1);
      expect(off).toHaveLength(1);
      expect(on).toEqual(off);
    });
  }
  it("is sent once whether or not a value matched, and not again for an answer", async () => {
    const { provider, requests: seen } = watched();
    const { cue } = make({ provider });
    await cue.propose("Lane's accounts");
    const question = cue.getState().plan?.clarifications[0];
    expect(question?.prompt).toBe("Did you mean Advisor: Avery Lane?");
    cue.answer(question?.id ?? "", "v0");
    expect(cue.getState().status).toBe("ready");
    expect(seen).toHaveLength(1);
    // Nothing the provider was sent holds a value it didn't type, or a choice.
    expect(JSON.stringify(seen)).not.toContain("Avery");
  });
});

// One test per row of the table in spec 5.4.
describe("spec 5.4, row by row", () => {
  it("“Avery Lane's accounts”, “accounts for Avery Lane”, “advisor is Avery Lane”: Advisor to exactly “Avery Lane”", async () => {
    for (const text of ["Avery Lane's accounts", "accounts for Avery Lane", "advisor is Avery Lane"]) {
      expect(await lines(text), text).toEqual(["Filter Advisor to exactly “Avery Lane”"]);
    }
  });
  it("“the Alder household”: Household to exactly “Alder Household”", async () => {
    expect(await lines("the Alder household")).toEqual(["Filter Household to exactly “Alder Household”"]);
  });
  it("“Avery Lane or Blake Moreno”: Advisor to any of both, as one filter", async () => {
    const state = await propose("Avery Lane or Blake Moreno");
    expect(strip(state.plan?.operations)).toEqual([filter("advisor_name", "in", ["Avery Lane", "Blake Moreno"])]);
    expect(state.preview?.lines).toEqual(["Filter Advisor to any of “Avery Lane” and “Blake Moreno”"]);
  });
  it("“show taxable accounts for Avery Lane”: both filters", async () => {
    expect(await lines("show taxable accounts for Avery Lane")).toEqual([
      "Filter Registration type to Taxable",
      "Filter Advisor to exactly “Avery Lane”",
    ]);
  });
  it("“Avery Lane's taxable accounts over $1m”: three filters, the amount's column from the provider", async () => {
    const { provider } = watched({
      families: [{ id: "filter", confidence: 0.95 }],
      values: [{ columnId: "registration_type", valueId: "taxable", confidence: 0.95 }],
      literalColumns: [{ literalIndex: 0, columnId: "market_value", confidence: 0.95 }],
    });
    expect(await lines("Avery Lane's taxable accounts over $1m", { provider })).toEqual([
      "Filter Advisor to exactly “Avery Lane”",
      "Filter Registration type to Taxable",
      "Filter Market value above $1,000,000",
    ]);
  });
  it("“sort by market value for the Alder household”: the filter, and the sort", async () => {
    expect(await lines("sort by market value for the Alder household")).toEqual([
      "Filter Household to exactly “Alder Household”",
      "Sort by Market value, ascending",
    ]);
  });
  it("“group by advisor for Avery Lane”: the filter, and the grouping", async () => {
    expect(await lines("group by advisor for Avery Lane")).toEqual(["Filter Advisor to exactly “Avery Lane”", "Group by Advisor"]);
  });
  it("“Lane's accounts”, “taxable accounts for Lane”: asks “Did you mean Advisor: Avery Lane?”", async () => {
    for (const text of ["Lane's accounts", "taxable accounts for Lane"]) {
      const state = await propose(text);
      expect(state.status, text).toBe("needs_clarification");
      expect(state.message, text).toBe("Did you mean Advisor: Avery Lane?");
      expect(state.plan?.clarifications[0]?.options?.map((o) => o.label)).toEqual(["Yes, Avery Lane", "No"]);
    }
  });
  it("“sort by Avery Lane”: asks “Avery Lane is a value in Advisor, not a column.”", async () => {
    for (const text of ["sort by Avery Lane", "group by Avery Lane", "show the Avery Lane column"]) {
      expect(await lines(text), text).toBe("Avery Lane is a value in Advisor, not a column.");
    }
  });
  it("“hide Avery Lane”, “everyone except Avery Lane”: asks", async () => {
    for (const text of ["hide Avery Lane", "everyone except Avery Lane", "accounts not for Avery Lane", "all but Avery Lane"]) {
      const state = await propose(text);
      expect(state.status, text).toBe("needs_clarification");
    }
    expect(await lines("hide Avery Lane")).toBe("GridCue can't leave out “avery lane” yet. Ask for the rows to keep.");
  });
  it("“Avery Lane called about the trust accounts”: asks about “called about”", async () => {
    expect(await lines("Avery Lane called about the trust accounts")).toBe(
      "I'm not sure what to do with “called about”. Try rephrasing that part.",
    );
  });
  it("“assign Avery Lane to the taxable accounts”: never ready", async () => {
    expect((await propose("assign Avery Lane to the taxable accounts")).status).not.toBe("ready");
  });
  it('`advisor containing "Lane"`: unchanged', async () => {
    const state = await propose('advisor containing "Lane"');
    expect(strip(state.plan?.operations)).toEqual([filter("advisor_name", "contains", "lane")]);
  });
});

describe("a whole value", () => {
  it("is read in the grid's own letter case, whatever the User typed", async () => {
    for (const text of ["avery lane's accounts", "ACCOUNTS FOR AVERY LANE", "accounts for Avery  Lane."]) {
      expect(await lines(text), text).toEqual(["Filter Advisor to exactly “Avery Lane”"]);
    }
  });
  it("names its own column with it, joined by a space, “is” or a colon", async () => {
    for (const text of ["accounts with advisor Avery Lane", "advisor: Avery Lane", "accounts whose advisor is Avery Lane"]) {
      expect(await lines(text), text).toEqual(["Filter Advisor to exactly “Avery Lane”"]);
    }
  });
  it("sits among the part's other filters where it was written", async () => {
    expect(await lines("Avery Lane's taxable accounts")).toEqual([
      "Filter Advisor to exactly “Avery Lane”",
      "Filter Registration type to Taxable",
    ]);
  });
  it("is read beside quoted text as a named value is", async () => {
    expect(await lines('Avery Lane\'s accounts with household containing "alder"')).toEqual([
      "Filter Advisor to exactly “Avery Lane”",
      "Filter Household containing “alder”",
    ]);
  });
  it("of two columns joined by “or” asks either-or, as any two columns do", async () => {
    expect((await propose("Avery Lane or the Alder household")).status).toBe("needs_clarification");
  });
  it("asks when another part names another value of its column: filters in two parts must both hold", async () => {
    expect(await lines("accounts for Avery Lane; accounts for Blake Moreno")).toBe(
      "No row has two Advisor values. Ask for them in one part, such as “Avery Lane or Blake Moreno”.",
    );
    expect(await lines("accounts for Avery Lane; sort by value")).toEqual([
      "Filter Advisor to exactly “Avery Lane”",
      "Sort by Market value, ascending",
    ]);
  });
  it("makes a refused request no less refused", async () => {
    const state = await propose("Export Avery Lane's accounts to Excel");
    expect(state.status).toBe("unsupported");
    // A provider that refuses an edit the Mock doesn't: the refusal stands, with a value, a tie or one word in the part.
    const { provider } = watched({ families: [{ id: "unsupported.data_mutation", confidence: 0.95 }] });
    for (const text of [
      "set the advisor to Avery Lane for these accounts",
      "move Casey Ortiz's accounts to Harborline",
      "assign Lane",
      "set Jordan Pike",
    ]) {
      expect((await propose(text, { provider })).status, text).toBe("unsupported");
    }
  });
  it("takes the part's other changes from the provider, as today (spec 4.1)", async () => {
    const sorts = watched({
      families: [
        { id: "filter", confidence: 0.95 },
        { id: "sort", confidence: 0.95 },
      ],
      columns: [{ id: "market_value", confidence: 0.95 }],
      direction: { id: "desc", confidence: 0.95 },
    });
    expect(await lines("Blake Moreno's accounts sorted by market value, largest first", { provider: sorts.provider })).toEqual([
      "Filter Advisor to exactly “Blake Moreno”",
      "Sort by Market value, descending",
    ]);
    const groups = watched({
      families: [
        { id: "filter", confidence: 0.95 },
        { id: "group", confidence: 0.95 },
      ],
      columns: [{ id: "custodian", confidence: 0.95 }],
    });
    expect(await lines("Blake Moreno's accounts grouped by custodian", { provider: groups.provider })).toEqual([
      "Filter Advisor to exactly “Blake Moreno”",
      "Group by Custodian",
    ]);
  });
  it("is the filter's own: a column the User asks for beside it must be in the plan", async () => {
    expect((await propose("show only household for Avery Lane")).status).not.toBe("ready");
  });
});

describe("values and filters that no row can match together", () => {
  const empty = "No row matches every Advisor filter, so the view would be empty. Ask for the rows to keep.";
  it("asks for a value beside another filter on its column that it can't pass", async () => {
    for (const text of [
      "Avery Lane's accounts with no advisor",
      "Avery Lane's accounts where advisor is empty",
      'Avery Lane\'s accounts where advisor starts with "Bl"',
      'Avery Lane\'s accounts with advisor containing "bl"',
    ]) {
      expect(await lines(text), text).toBe(empty);
    }
  });
  it("reads a value beside another filter on its column that it passes", async () => {
    expect(await lines('Avery Lane\'s accounts where advisor starts with "Av"')).toEqual([
      "Filter Advisor to exactly “Avery Lane”",
      "Filter Advisor starting with “av”",
    ]);
  });
  it("reads filters with no Local Value among them as before, with the values on", async () => {
    // Two text forms that no row can match together are read as they are with no Local Values: the check is a value's.
    const state = await propose('accounts where advisor starts with "av" and advisor is empty');
    expect(state.status).toBe("ready");
    expect(strip(state.plan?.operations)).toEqual([filter("advisor_name", "startsWith", "av"), filter("advisor_name", "isEmpty")]);
  });
  it("asks for a value added to a view whose filter on its column it can't pass", async () => {
    const adapter = createRowsAdapter({ schema });
    adapter.setState((view) => ({
      ...view,
      filters: {
        id: "root",
        type: "group",
        combinator: "and",
        children: [{ id: "f1", type: "predicate", columnId: "advisor_name", operator: "eq", value: "Blake Moreno" }],
      },
    }));
    const cue = createGridCue({ adapter, provider: mock, localValues });
    await cue.propose("also Avery Lane's accounts");
    expect(cue.getState().message).toBe(empty);
  });
});

describe("several values of one column", () => {
  const apart = "No row has two Advisor values. Ask for them as one list, such as “Avery Lane or Blake Moreno”.";
  it("make one filter when they are written as a list", async () => {
    for (const text of [
      "Avery Lane or Blake Moreno",
      "Avery Lane and Blake Moreno",
      "Avery Lane, Blake Moreno",
      "accounts for Avery Lane or Blake Moreno",
      "advisor is Avery Lane or Blake Moreno",
    ]) {
      expect(await lines(text), text).toEqual(["Filter Advisor to any of “Avery Lane” and “Blake Moreno”"]);
    }
  });
  it("ask when they sit apart: the words give the same rows two values", async () => {
    for (const text of [
      "Avery Lane's accounts for Blake Moreno",
      "accounts for Avery Lane with advisor Blake Moreno",
      "Avery Lane's taxable accounts for Blake Moreno",
    ]) {
      expect(await lines(text), text).toBe(apart);
    }
  });
  it("ask when each follows its column's name, unless “or” alone sits between them", async () => {
    for (const text of [
      "advisor is Avery Lane and advisor is Blake Moreno",
      "advisor is Avery Lane, advisor is Blake Moreno",
      "accounts where advisor is Avery Lane and advisor is Blake Moreno",
    ]) {
      expect(await lines(text), text).toBe(apart);
    }
    expect(await lines("household is Alder Household and household is Birch Household")).toBe(
      "No row has two Household values. Ask for them as one list, such as “Alder Household or Birch Household”.",
    );
    expect(await lines("advisor is Avery Lane or advisor is Blake Moreno")).toEqual([
      "Filter Advisor to any of “Avery Lane” and “Blake Moreno”",
    ]);
  });
});

describe("a value's own words", () => {
  it("never say to keep the view's filters", async () => {
    const values: LocalValues = {
      advisor_name: () => ["Avery Lane", "Riley As Well", "Further Lane"],
      household: () => ["Too Many Cooks"],
    };
    const read = async (text: string) => {
      const adapter = createRowsAdapter({ schema });
      adapter.setState((view) => ({
        ...view,
        filters: {
          id: "root",
          type: "group",
          combinator: "and",
          children: [{ id: "f1", type: "predicate", columnId: "custodian", operator: "eq", value: "northgate" }],
        },
      }));
      const cue = createGridCue({ adapter, provider: mock, localValues: values });
      await cue.propose(text);
      return strip(cue.getState().plan?.operations);
    };
    for (const [text, columnId, value] of [
      ["show Avery Lane", "advisor_name", "Avery Lane"],
      ["show Riley As Well", "advisor_name", "Riley As Well"],
      ["Riley As Well's accounts", "advisor_name", "Riley As Well"],
      ["show Further Lane", "advisor_name", "Further Lane"],
      ["accounts for Too Many Cooks", "household", "Too Many Cooks"],
    ] as const) {
      expect(await read(text), text).toEqual([{ type: "filter.clear" }, filter(columnId, "eq", value)]);
    }
    // The words beside the value still keep them.
    expect(await read("also show Avery Lane")).toEqual([filter("advisor_name", "eq", "Avery Lane")]);
  });
});

describe("values of two columns", () => {
  it("ask when listed together: rows with both, or with either", async () => {
    const both =
      "GridCue can't tell whether you want rows with both “Avery Lane” and “Alder Household”, or with either. Ask for one at a time, or for the rows that have both.";
    for (const text of [
      "Avery Lane and the Alder household",
      "Avery Lane, the Alder household",
      "Avery Lane and Alder Household accounts",
    ]) {
      expect(await lines(text), text).toBe(both);
    }
    expect(await lines("Avery Lane or the Alder household")).toBe(
      "GridCue can only show rows that match every condition, not either one. Ask for one at a time.",
    );
  });
  it("ask when words that add one to the other sit anywhere between them", async () => {
    const both =
      "GridCue can't tell whether you want rows with both “Avery Lane” and “Alder Household”, or with either. Ask for one at a time, or for the rows that have both.";
    for (const text of [
      "Avery Lane accounts and the Alder household",
      "Avery Lane's accounts and the Alder household's accounts",
      "Avery Lane's accounts and the Alder household",
      "Avery Lane accounts and Alder Household accounts",
      "accounts for Avery Lane and for the Alder household",
      "Avery Lane and also the Alder household",
      "Avery Lane, also the Alder household",
      "Avery Lane's taxable accounts and the Alder household",
    ]) {
      expect(await lines(text), text).toBe(both);
    }
  });
  it("ask when they sit in two parts: each part is a request of its own", async () => {
    const both = (first: string, other: string) =>
      `GridCue can't tell whether you want rows with both “${first}” and “${other}”, or with either. Ask for one at a time, or for the rows that have both.`;
    for (const text of [
      "show Avery Lane's accounts and show the Alder household",
      "Avery Lane's accounts. Also the Alder household.",
      "Avery Lane's accounts; also the Alder household",
      "Avery Lane's accounts; the Alder household's accounts",
      "Avery Lane's accounts, then the Alder household",
      "Avery Lane. Alder household.",
    ]) {
      expect(await lines(text), text).toBe(both("Avery Lane", "Alder Household"));
    }
    expect(await lines("the Alder household's accounts; Avery Lane's accounts")).toBe(both("Alder Household", "Avery Lane"));
    // A value beside another part that names no Local Value, or the same value again, is read as before.
    expect(await lines("Avery Lane's accounts in the Alder household; sort by value")).toEqual([
      "Filter Advisor to exactly “Avery Lane”",
      "Filter Household to exactly “Alder Household”",
      "Sort by Market value, ascending",
    ]);
    expect(await lines("show Avery Lane's accounts and show taxable accounts")).toEqual([
      "Filter Advisor to exactly “Avery Lane”",
      "Filter Registration type to Taxable",
    ]);
  });
  it("ask when each value comes with the rows' own noun, or a dash sits between them", async () => {
    const both =
      "GridCue can't tell whether you want rows with both “Avery Lane” and “Alder Household”, or with either. Ask for one at a time, or for the rows that have both.";
    // Each was ready with both filters, where the same words with a comma between them asked.
    for (const text of [
      "Avery Lane's accounts — the Alder household's accounts",
      "Avery Lane's accounts—the Alder household",
      "Avery Lane's accounts the Alder household's accounts",
      "accounts for Avery Lane accounts for the Alder household",
      "Avery Lane's accounts: the Alder household's accounts",
      "Avery Lane's accounts (the Alder household's accounts)",
    ]) {
      expect(await lines(text), text).toBe(both);
    }
    // A hyphen between spaces asks about itself first.
    expect(await lines("Avery Lane's accounts - the Alder household")).toBe("I'm not sure what to do with “-”. Try rephrasing that part.");
  });
  it("are both read when each follows its column's name: two conditions", async () => {
    const lane = ["Filter Advisor to exactly “Avery Lane”", "Filter Household to exactly “Alder Household”"];
    // The two-part form asked "both or either", where the same request on two declared values was ready.
    for (const text of [
      "advisor is Avery Lane; household is Alder Household",
      "advisor is Avery Lane and household is Alder Household",
      "where advisor is Avery Lane and where household is Alder Household",
      "accounts where advisor is Avery Lane, household is Alder Household",
    ]) {
      expect(await lines(text), text).toEqual(lane);
    }
    // One value named bare is still listed apart from the other.
    expect(await lines("advisor is Avery Lane; the Alder household")).toBe(
      "GridCue can't tell whether you want rows with both “Avery Lane” and “Alder Household”, or with either. Ask for one at a time, or for the rows that have both.",
    );
  });
  it("are both read when the words say which rows have each", async () => {
    for (const text of [
      "Avery Lane's accounts in the Alder household",
      "accounts for Avery Lane in the Alder household",
      "Avery Lane's Alder household accounts",
      "Avery Lane with the Alder household",
    ]) {
      expect(await lines(text), text).toEqual(["Filter Advisor to exactly “Avery Lane”", "Filter Household to exactly “Alder Household”"]);
    }
    expect(await lines("the Alder household accounts for Avery Lane")).toEqual([
      "Filter Household to exactly “Alder Household”",
      "Filter Advisor to exactly “Avery Lane”",
    ]);
  });
  it("read a list of one column beside a value of another", async () => {
    expect(await lines("Avery Lane and Blake Moreno in the Alder household")).toEqual([
      "Filter Advisor to any of “Avery Lane” and “Blake Moreno”",
      "Filter Household to exactly “Alder Household”",
    ]);
  });
});

describe("a value said in a way that is no request for rows", () => {
  it("asks for a statement around its column", async () => {
    for (const text of [
      "every advisor is Avery Lane",
      "which advisor is Avery Lane",
      "my advisor is Avery Lane",
      "advisor is Avery Lane for every account",
    ]) {
      expect((await propose(text)).status, text).toBe("needs_clarification");
    }
  });
  it("asks for a value that says something itself", async () => {
    for (const text of ["Avery Lane is an advisor", "the Alder household has trust accounts", "accounts are Avery Lane's"]) {
      expect((await propose(text)).status, text).toBe("needs_clarification");
    }
    expect(await lines("Avery Lane is an advisor")).toBe("I'm not sure what to do with “avery lane is”. Try rephrasing that part.");
  });
  it("asks for a possessive that owns something other than the rows", async () => {
    for (const text of ["Avery Lane's household", "Avery Lane's market value", "show Avery Lane's"]) {
      expect((await propose(text)).status, text).toBe("needs_clarification");
    }
    expect(await lines("Avery Lane's household")).toBe("I'm not sure what to do with “avery lane's household”. Try rephrasing that part.");
  });
});

describe("the limit on a provider's picks (spec 4.2)", () => {
  const picks = async (text: string, answer: Partial<ClauseResolution>) => {
    const { provider } = watched(answer);
    const { cue } = make({ provider });
    await cue.propose(text);
    return cue.getState();
  };
  it("drops a sort for the name's own words", async () => {
    const state = await picks("Avery Lane's accounts", {
      families: [
        { id: "filter", confidence: 0.95 },
        { id: "sort", confidence: 0.9 },
      ],
      columns: [
        { id: "advisor_name", confidence: 0.95 },
        { id: "market_value", confidence: 0.9 },
      ],
      direction: { id: "desc", confidence: 0.9 },
    });
    expect(strip(state.plan?.operations)).toEqual([filter("advisor_name", "eq", "Avery Lane")]);
    expect(state.plan?.evidence.some((e) => e.key === "dropped:c0.unasked" && e.selectedId === "sort")).toBe(true);
  });
  it("drops a grouping, a column change and a value for the name's own words", async () => {
    const state = await picks("the Alder household", {
      families: [
        { id: "filter", confidence: 0.95 },
        { id: "group", confidence: 0.9 },
        { id: "columns.hide", confidence: 0.9 },
      ],
      columns: [
        { id: "household", confidence: 0.95 },
        { id: "custodian", confidence: 0.9 },
      ],
      values: [{ columnId: "registration_type", valueId: "taxable", confidence: 0.9 }],
    });
    expect(strip(state.plan?.operations)).toEqual([filter("household", "eq", "Alder Household")]);
    const dropped = state.plan?.evidence.filter((e) => e.key.startsWith("dropped:")).map((e) => e.selectedId);
    expect(dropped).toEqual(expect.arrayContaining(["group", "columns.hide", "custodian", "registration_type=taxable"]));
  });
});

describe("one word of a value", () => {
  it("with one value, asks “Did you mean …?”, and Yes reads it as if typed whole", async () => {
    const { cue } = make();
    await cue.propose("taxable accounts for Lane");
    const question = cue.getState().plan?.clarifications[0];
    expect(question?.options?.map((o) => o.label)).toEqual(["Yes, Avery Lane", "No"]);
    cue.answer(question?.id ?? "", "v0");
    expect(cue.getState().status).toBe("ready");
    expect(cue.getState().preview?.lines).toEqual(["Filter Registration type to Taxable", "Filter Advisor to exactly “Avery Lane”"]);
  });
  it("with two to five values, offers each, then “None of these”", async () => {
    const { cue } = make();
    await cue.propose("Kim's accounts");
    const question = cue.getState().plan?.clarifications[0];
    expect(question?.prompt).toBe("Which Advisor did you mean by “kim”?");
    expect(question?.options?.map((o) => o.label)).toEqual(["Kim Ross", "Kim Vale", "None of these"]);
    cue.answer(question?.id ?? "", "v1");
    expect(strip(cue.getState().plan?.operations)).toEqual([filter("advisor_name", "eq", "Kim Vale")]);
  });
  it("with more than five values, asks for the full name, with no choices", async () => {
    const state = await propose("Lee's accounts");
    expect(state.message).toBe("6 Advisor values contain “lee”. Type the full name.");
    expect(state.plan?.clarifications[0]?.options).toBeUndefined();
  });
  it("“None of these” and “No” say nothing will change", async () => {
    for (const [text, none] of [
      ["Kim's accounts", "none"],
      ["Lane's accounts", "none"],
    ] as const) {
      const { cue } = make();
      await cue.propose(text);
      const question = cue.getState().plan?.clarifications[0];
      cue.answer(question?.id ?? "", none);
      const state = cue.getState();
      expect(state.status).toBe("needs_clarification");
      expect(state.message).toMatch(/^Nothing will change for “(kim|lane)”\. Type the full name, or rephrase that part\.$/);
      expect(state.plan?.operations).toEqual([]);
      expect(state.plan?.clarifications[0]?.options).toBeUndefined();
    }
  });
  it("never offers a declared name or one of GridCue's own words", async () => {
    // "Taxable" is a declared value, and "accounts" the Row Noun: neither asks which name was meant.
    const values: LocalValues = { advisor_name: () => ["Taxable Desk", "Accounts Team", "Top Hat"] };
    expect(await lines("taxable accounts", { localValues: values })).toEqual(["Filter Registration type to Taxable"]);
    expect((await propose("top accounts", { localValues: values })).message).not.toMatch(/Did you mean|by “top”/);
  });
  it("asks about the other words GridCue can't place first", async () => {
    expect(await lines("Lane called about the trust accounts")).toBe(
      "I'm not sure what to do with “called about”. Try rephrasing that part.",
    );
  });
});

describe("ties", () => {
  it("ask which was meant for a value two columns hold", async () => {
    const { cue } = make();
    await cue.propose("Jordan Pike's accounts");
    const question = cue.getState().plan?.clarifications[0];
    expect(question?.prompt).toBe("Which did you mean by “jordan pike”?");
    expect(question?.options?.map((o) => o.label)).toEqual(["Advisor: Jordan Pike", "Household: Jordan Pike", "None of these"]);
    cue.answer(question?.id ?? "", "v1");
    expect(cue.getState().preview?.lines).toEqual(["Filter Household to exactly “Jordan Pike”"]);
  });
  it("ask which was meant for a value that is also a declared name, and the name reads as without Local Values", async () => {
    const { cue } = make();
    await cue.propose("Northgate accounts");
    const question = cue.getState().plan?.clarifications[0];
    expect(question?.options?.map((o) => o.label)).toEqual(["Household: Northgate", "Custodian: Northgate", "None of these"]);
    cue.answer(question?.id ?? "", "n0");
    expect(cue.getState().preview?.lines).toEqual(["Filter Custodian to Northgate"]);
    const again = make().cue;
    await again.propose("Northgate accounts");
    again.answer(question?.id ?? "", "v0");
    expect(again.getState().preview?.lines).toEqual(["Filter Household to exactly “Northgate”"]);
  });
  it("read a chosen value at its own words, so the words it leaves out still ask", async () => {
    const { cue } = make({ localValues: { advisor_name: () => ["Avery Lane Keene", "Keene Morgan", "Morgan Reed Vale"] } });
    await cue.propose("Avery Lane Keene Morgan Reed Vale");
    // Picking Keene Morgan at each question that offers it was ready with that one filter, and dropped the other words.
    for (let i = 0; i < 2; i++) {
      const question = cue.getState().plan?.clarifications.find((q) => q.options?.some((o) => o.label === "Keene Morgan"));
      if (!question) break;
      cue.answer(question.id, question.options?.find((o) => o.label === "Keene Morgan")?.id ?? "");
    }
    expect(cue.getState().status).toBe("needs_clarification");
    expect(cue.getState().message).toBe("I'm not sure what to do with “avery lane”. Try rephrasing that part.");
  });
});

describe("a word built on “group” that is a word of a value", () => {
  const groups: LocalValues = { household: () => ["Harbor Group", "Alder Household"] };
  it("asks where the part doesn't group: the User may have named the value", async () => {
    for (const text of ["accounts in the Northgate group", "show accounts in the Northgate group", "taxable accounts in the group"]) {
      expect(await lines(text, { localValues: groups }), text).toBe("I'm not sure what to do with “group”. Try rephrasing that part.");
    }
  });
  it("reads as before where no value holds the word, and where the part groups or names the whole value", async () => {
    const households: LocalValues = { household: () => ["Alder Household"] };
    expect(await lines("accounts in the Northgate group", { localValues: households })).toEqual(["Filter Custodian to Northgate"]);
    expect(await lines("group by custodian", { localValues: groups })).toEqual(["Group by Custodian"]);
    expect(await lines("Harbor Group accounts", { localValues: groups })).toEqual(["Filter Household to exactly “Harbor Group”"]);
  });
});

describe("a tie's question", () => {
  it("offers one choice for each column a declared name belongs to", async () => {
    const { cue } = make({ localValues: { household: () => ["Northgate Trust Household"] } });
    await cue.propose("Northgate Trust Household");
    const question = cue.getState().plan?.clarifications[0];
    expect(question?.options?.map((o) => o.label)).toEqual([
      "Household: Northgate Trust Household",
      "Custodian: Northgate",
      "Registration type: Trust",
      "The Household column",
      "None of these",
    ]);
  });
  it("offers no more than five choices, and past that asks the User to rephrase", async () => {
    const parts = ["Alder", "Birch", "Cedar", "Dunmore", "Ellery", "Fairholm"];
    const { cue } = make({ localValues: { household: () => ["Alder, Birch, Cedar, Dunmore, Ellery and Fairholm", ...parts] } });
    await cue.propose("Alder, Birch, Cedar, Dunmore, Ellery and Fairholm");
    const question = cue.getState().plan?.clarifications[0];
    expect(question?.prompt).toBe(
      "“alder, birch, cedar, dunmore, ellery and fairholm” could mean more than 5 things here. Try rephrasing that part.",
    );
    expect(question?.options).toBeUndefined();
    expect(cue.getState().status).toBe("needs_clarification");
  });
});

describe("an answer to one word of a value", () => {
  it("lists the values in the order written", async () => {
    const { cue } = make();
    await cue.propose("Lane and Blake Moreno");
    const question = cue.getState().plan?.clarifications[0];
    cue.answer(question?.id ?? "", "v0");
    expect(cue.getState().preview?.lines).toEqual(["Filter Advisor to any of “Avery Lane” and “Blake Moreno”"]);
  });
});

describe("values that differ only in letter case", () => {
  it("are one value: an exact filter on a text column ignores letter case", async () => {
    const { cue } = make({ localValues: { advisor_name: () => ["Avery Lane", "AVERY LANE"] } });
    await cue.propose("AVERY LANE's accounts");
    expect(cue.getState().preview?.lines).toEqual(["Filter Advisor to exactly “Avery Lane”"]);
    expect(strip(cue.getState().plan?.operations)).toEqual([filter("advisor_name", "eq", "Avery Lane")]);
  });
});

describe("ADR 0019's check (spec 4.4)", () => {
  it("counts each value as used when the plan holds its filter, several of one column in one filter", async () => {
    const state = await propose("accounts for Avery Lane, Blake Moreno or Casey Ortiz");
    expect(state.status).toBe("ready");
    expect(strip(state.plan?.operations)).toEqual([filter("advisor_name", "in", ["Avery Lane", "Blake Moreno", "Casey Ortiz"])]);
  });
});

describe("the Preview", () => {
  it("shows the value as the grid holds it, after “to exactly” or “to any of”", () => {
    const op = (operator: "eq" | "in", value: string | string[]): ViewOperation => ({
      type: "filter.add",
      combineWith: "and",
      predicate: { id: "f1", type: "predicate", columnId: "advisor_name", operator, value },
    });
    expect(renderPreview({ operations: [op("eq", "Avery Lane")] }, schema).lines).toEqual(["Filter Advisor to exactly “Avery Lane”"]);
    expect(renderPreview({ operations: [op("in", ["Avery Lane", "Blake Moreno"])] }, schema).lines).toEqual([
      "Filter Advisor to any of “Avery Lane” and “Blake Moreno”",
    ]);
  });
});

describe("reading Local Values stays fast", () => {
  const units = [
    "Avery Lane's accounts ",
    "accounts for Avery Lane or Blake Moreno ",
    "advisor is Avery Lane and ",
    "the Alder household ",
    "Lane ",
    "Jordan Pike ",
    "Kim Lee ",
  ];
  it("reads and compiles 2,000 characters of names in under 50 ms", async () => {
    const empty: IntentProvider = { resolve: async () => ({ clauses: [] }) };
    for (const unit of units) {
      const text = unit.repeat(Math.ceil(2000 / unit.length)).slice(0, 2000);
      // The best of three: backtracking is slow every time, while a busy test runner is slow once.
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const { cue } = make({ provider: empty, maxUtteranceLength: 2000 });
        const started = performance.now();
        await cue.propose(text);
        best = Math.min(best, performance.now() - started);
      }
      expect(best, unit).toBeLessThan(50);
    }
  });
  it("stays fast when one word is in many values, and when values hold each other in turn", async () => {
    const empty: IntentProvider = { resolve: async () => ({ clauses: [] }) };
    const surnames = ["Abe", "Bao", "Cole", "Dunn", "Eads", "Ford", "Gale", "Hart", "Ives", "Jay", "Kerr", "Lowe"];
    const nested = Array.from({ length: 100 }, (_, i) =>
      Array(i + 1)
        .fill("kim")
        .join(" "),
    );
    const cases: Array<[string, readonly string[]]> = [
      ...[2, 5, 6, 9, 12].map((n): [string, readonly string[]] => ["Kim ", surnames.slice(0, n).map((s) => `Kim ${s}`)]),
      ["Kim and ", surnames.map((s) => `Kim ${s}`)],
      ["kim ", nested.slice(0, 3)],
      ["kim ", nested.slice(0, 30)],
      ["kim ", nested],
      ["kim, ", nested],
    ];
    for (const [unit, values] of cases) {
      const text = unit.repeat(Math.ceil(2000 / unit.length)).slice(0, 2000);
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const { cue } = make({ provider: empty, maxUtteranceLength: 2000, localValues: { advisor_name: () => values } });
        const started = performance.now();
        await cue.propose(text);
        best = Math.min(best, performance.now() - started);
      }
      expect(best, `${unit} with ${values.length} values`).toBeLessThan(50);
    }
  });
});
