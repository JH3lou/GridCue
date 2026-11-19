import { describe, expect, it } from "vitest";
import type { GridAdapter } from "../src/core/adapter";
import { createGridCue } from "../src/core/controller";
import type { ViewState } from "../src/core/protocol";
import { createQueryAdapter } from "../src/core/query-adapter";
import { buildCandidates, type IntentProvider, type ResolutionRequest } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// An operation a Query Adapter's `without` removes (order plan, section 11; more grids spec, 5.3 and 5.4). A part that
// asks for one ends the whole request in the shared "This grid can't …" question, with no choices, and nothing applies.
// A request that asks only for what the grid lists reads as it does on a default Query Adapter.
const schema = defineSchema(
  [
    { id: "account", label: "Account" },
    { id: "advisor", label: "Advisor" },
    { id: "custodian", label: "Custodian" },
    { id: "type", label: "Registration type" },
    { id: "value", label: "Market value", kind: "currency" as const },
  ],
  {
    rowNoun: "account",
    columns: {
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
        ],
      },
    },
  },
);
const mock = createMockProvider({ defaultColumnForKind: { currency: "value" } });

/** A view with two filters, so a clear or a reset has something to change. */
const filtered: Partial<ViewState> = {
  filters: {
    id: "g",
    type: "group",
    combinator: "and",
    children: [
      { id: "p1", type: "predicate", columnId: "custodian", operator: "eq", value: "northgate" },
      { id: "p2", type: "predicate", columnId: "value", operator: "gt", value: 1_000_000 },
    ],
  },
};

/**
 * Each MVP operation, a plain request for it, the operations that request compiles to on a grid that lists them all,
 * the view it is asked on, the question's ID suffix and the prompt a grid without it asks. "Show only the advisor
 * column" shows it, hides the others and puts it first. Grouping's ID has no suffix, as it had before the other
 * operations joined it. `before` is a part said ahead of it that needs none of its operations.
 */
interface Asked {
  op: string;
  request: string;
  needs: readonly string[];
  state?: Partial<ViewState>;
  before: string;
  id: string;
  prompt: string;
}
const OPERATIONS: readonly Asked[] = [
  {
    op: "sort.set",
    request: "sort by market value descending",
    needs: ["sort.set"],
    before: "show taxable accounts",
    id: ".cant.sort",
    prompt: "This grid can't sort rows.",
  },
  {
    op: "filter.add",
    request: "show taxable accounts",
    needs: ["filter.add"],
    before: "hide the custodian column",
    id: ".cant.filter",
    prompt: "This grid can't filter rows.",
  },
  {
    op: "filter.clear",
    request: "clear the filters",
    needs: ["filter.clear"],
    state: filtered,
    before: "hide the custodian column",
    id: ".cant.clear",
    prompt: "This grid can't clear filters.",
  },
  {
    op: "group.set",
    request: "group by advisor",
    needs: ["group.set"],
    before: "show taxable accounts",
    id: ".cant",
    prompt: "This grid can't group rows.",
  },
  {
    op: "columns.hide",
    request: "hide the custodian column",
    needs: ["columns.hide"],
    before: "show taxable accounts",
    id: ".cant.hide",
    prompt: "This grid can't hide columns.",
  },
  {
    op: "columns.show",
    request: "add the custodian column",
    needs: ["columns.show"],
    // "Sort by market value descending and add the custodian column" sorts by Custodian too, on every grid: the column
    // named after "and" is read as one more column to sort by. "Then" starts a part of its own.
    before: "show taxable accounts, then",
    id: ".cant.show",
    prompt: "This grid can't show hidden columns.",
  },
  {
    op: "columns.order",
    request: "show only the advisor column",
    needs: ["columns.show", "columns.hide", "columns.order"],
    before: "show taxable accounts",
    id: ".cant.order",
    prompt: "This grid can't reorder columns.",
  },
  {
    op: "view.reset",
    request: "reset the view",
    needs: ["view.reset"],
    state: filtered,
    before: "hide the custodian column",
    id: ".cant.reset",
    prompt: "This grid can't reset the view.",
  },
];

const queryGrid = (without: readonly string[] = [], state?: Partial<ViewState>, provider: IntentProvider = mock) => {
  const adapter = createQueryAdapter({ schema, ...(without.length > 0 ? { without } : {}) });
  if (state) adapter.setState((s) => ({ ...s, ...state }));
  return { adapter, cue: createGridCue({ adapter, provider }) };
};

/** Proposes `request`, and checks that it asks only `prompt`, with no choices, from part `index`, and nothing applies. */
const expectCant = async (
  without: readonly string[],
  request: string,
  question: { id: string; prompt: string },
  state?: Partial<ViewState>,
) => {
  const { adapter, cue } = queryGrid(without, state);
  const before = adapter.getState();
  const plan = await cue.propose(request);
  expect(cue.getState().status, request).toBe("needs_clarification");
  expect(cue.getState().message, request).toBe(question.prompt);
  expect(cue.getState().preview).toBeNull();
  expect(plan?.operations).toEqual([]);
  expect(plan?.clarifications, request).toEqual([{ id: question.id, prompt: question.prompt, required: true }]);
  expect(await cue.apply()).toBe(false);
  expect(adapter.getState()).toEqual(before);
};

/** What a proposal reads as, generated IDs left out, for comparing two grids. */
const reading = async (adapter: GridAdapter, request: string) => {
  const cue = createGridCue({ adapter, provider: mock });
  const plan = await cue.propose(request);
  const { status, message, preview } = cue.getState();
  const strip = (v: unknown) => JSON.parse(JSON.stringify(v ?? null).replace(/"(?:id|plan)_\d+"/g, '""'));
  return strip({ status, message, preview, operations: plan?.operations, clarifications: plan?.clarifications });
};

describe("a Query Adapter built without an operation asks “This grid can't …” for it", () => {
  for (const { op, request, state, id, prompt } of OPERATIONS) {
    it(`“${request}”, without ${op}: “${prompt}”`, async () => {
      await expectCant([op], request, { id: `c0${id}`, prompt }, state);
    });
  }

  for (const { op, request, before, state, id, prompt } of OPERATIONS) {
    const mixed = before.endsWith(", then") ? `${before} ${request}` : `${before} and ${request}`;
    it(`“${mixed}”, without ${op}: the whole request asks, and nothing applies`, async () => {
      await expectCant([op], mixed, { id: `c1${id}`, prompt }, state);
    });
  }

  it("asks once for each operation the request needs, in the order of the parts", async () => {
    const { cue } = queryGrid(["sort.set", "columns.hide"]);
    const plan = await cue.propose("sort by market value descending and hide the custodian column");
    expect(cue.getState().status).toBe("needs_clarification");
    expect(plan?.operations).toEqual([]);
    expect(plan?.clarifications).toEqual([
      { id: "c0.cant.sort", prompt: "This grid can't sort rows.", required: true },
      { id: "c1.cant.hide", prompt: "This grid can't hide columns.", required: true },
    ]);
  });

  it("asks it for a size word said beside a filter, where a grid that sorts would ask which column", async () => {
    await expectCant(["sort.set"], "taxable accounts, largest first", { id: "c0.cant.sort", prompt: "This grid can't sort rows." });
  });

  it("asks it for a clear of the sort, which writes the sort", async () => {
    await expectCant(
      ["sort.set"],
      "clear the sort",
      { id: "c0.cant.sort", prompt: "This grid can't sort rows." },
      {
        sorts: [{ columnId: "value", direction: "desc" }],
      },
    );
  });

  it("asks it for a new filter on a view with filters, which a new filter replaces (ADR 0017)", async () => {
    await expectCant(
      ["filter.clear"],
      "show taxable accounts",
      { id: "c0.cant.clear", prompt: "This grid can't clear filters." },
      filtered,
    );
  });

  it("asks it for a filter said beside a size word, though the sort's column is asked about too", async () => {
    await expectCant(["filter.add"], "taxable accounts, largest first", { id: "c0.cant.filter", prompt: "This grid can't filter rows." });
  });

  it("refuses a request with a part the provider refuses, as on a grid that lists the change", async () => {
    const { cue } = queryGrid(["sort.set"]);
    const plan = await cue.propose("sort by market value descending and export the list");
    expect(cue.getState().status).toBe("unsupported");
    // Its plan never applies, and holds no change the grid doesn't list, as for a pin.
    expect(plan?.operations).toEqual([]);
    expect(cue.getState().preview).toBeNull();
  });
});

describe("a Query Adapter built without an operation reads every other request as a default one does", () => {
  for (const { op } of OPERATIONS) {
    for (const other of OPERATIONS.filter((o) => !o.needs.includes(op))) {
      it(`without ${op}: “${other.request}”`, async () => {
        const without = queryGrid([op], other.state).adapter;
        const plain = queryGrid([], other.state).adapter;
        expect(await reading(without, other.request)).toEqual(await reading(plain, other.request));
      });
    }
  }

  it("sends the provider the request a default Query Adapter sends, but on a grid that can't group", async () => {
    const seen = async (without: readonly string[]) => {
      let sent: ResolutionRequest | undefined;
      const spy: IntentProvider = {
        resolve: async (request) => {
          sent = request;
          return mock.resolve(request);
        },
      };
      await queryGrid(without, undefined, spy).cue.propose("sort by market value descending");
      return sent;
    };
    const plain = await seen([]);
    for (const { op } of OPERATIONS.filter((o) => o.op !== "group.set")) expect(await seen([op]), op).toEqual(plain);
    expect((await seen(["group.set"]))?.candidates.families).not.toContain("group");
    expect((await seen(["group.set", "sort.set"]))?.candidates).toEqual((await seen(["group.set"]))?.candidates);
  });

  it("names in the hint only the changes the grid lists", async () => {
    const hint = async (without: readonly string[]) => {
      const { cue } = queryGrid(without);
      await cue.propose("whatever looks risky");
      return cue.getState().message;
    };
    expect(await hint([])).toBe(
      "I'm not sure what to change for “whatever looks risky”. Try asking to filter, sort, group, or show or hide columns.",
    );
    expect(await hint(["sort.set"])).toBe(
      "I'm not sure what to change for “whatever looks risky”. Try asking to filter, group, or show or hide columns.",
    );
    expect(await hint(["filter.add", "columns.hide"])).toBe(
      "I'm not sure what to change for “whatever looks risky”. Try asking to sort, group, or show columns.",
    );
  });
});

describe("a part GridCue asks to say again keeps the question a default Query Adapter asks", () => {
  // A question with no choices asks the User to say the part again: GridCue can't be sure the part asks for the change
  // the grid doesn't list, so it asks as on any grid, and reads the new words again.
  const hidden: Partial<ViewState> = { visibleColumnIds: ["account", "advisor", "type", "value"] };
  const asked: Array<{ without: string[]; request: string; state?: Partial<ViewState>; count?: boolean }> = [
    // Read as a filter with no value, where the User may mean the column.
    { without: ["filter.add"], request: "show custodian", state: hidden },
    // Read as a filter with an amount and no comparison, where the User may mean a count.
    { without: ["filter.add"], request: "show 20 rows" },
    { without: ["filter.add"], request: "first 10 rows" },
    { without: ["filter.add"], request: "show 20 rows", count: true },
    // A new filter replaces the one in place (ADR 0017), but a word of the part is left unused.
    { without: ["filter.clear"], request: "advisor is taxable", state: filtered },
    { without: ["filter.clear"], request: "market value taxable", state: filtered },
  ];
  for (const { without, request, state, count } of asked) {
    it(`“${request}”, without ${without.join(" ")}${count ? ", with a count" : ""}`, async () => {
      const make = (w: readonly string[]) => {
        const adapter = createQueryAdapter({
          schema,
          ...(w.length > 0 ? { without: w } : {}),
          ...(count ? { countBeforePaging: true } : {}),
        });
        if (state) adapter.setState((s) => ({ ...s, ...state }));
        return adapter;
      };
      const plain = await reading(make([]), request);
      expect(plain.status).toBe("needs_clarification");
      expect(plain.message).not.toMatch(/^This grid can't/);
      expect(await reading(make(without), request)).toEqual(plain);
    });
  }
});

describe("a family the provider names in doubt reads as on a grid that lists it", () => {
  // Jev may name a family in the middle band, below `ready`, and a change-type pick (`kind`). The Mock Provider never
  // does, so this provider answers as the Mock Provider and then sets each part's families and kind.
  type Pick = { id: string; confidence: number };
  const reshaped = (families: Pick[], kind?: Pick): IntentProvider => ({
    resolve: async (request, signal) => {
      const result = await mock.resolve(request, signal);
      return { ...result, clauses: result.clauses.map((c) => ({ ...c, families, ...(kind ? { kind } : {}) })) };
    },
  });
  const read = async (without: readonly string[], request: string, provider: IntentProvider, state?: Partial<ViewState>) => {
    const adapter = createQueryAdapter({ schema, ...(without.length > 0 ? { without } : {}) });
    if (state) adapter.setState((s) => ({ ...s, ...state }));
    const cue = createGridCue({ adapter, provider });
    const before = adapter.getState();
    const plan = await cue.propose(request);
    const { status, message, preview } = cue.getState();
    const applied = await cue.apply();
    const strip = (v: unknown) => JSON.parse(JSON.stringify(v ?? null).replace(/"(?:id|plan)_\d+"/g, '""'));
    return {
      cue,
      changed: applied || adapter.getState() !== before,
      got: strip({ status, message, preview, operations: plan?.operations, clarifications: plan?.clarifications }),
    };
  };

  it("a kind that lifts the family out of the middle band ends in “This grid can't …”, never in another reading", async () => {
    const cases: Array<{ without: string; request: string; families: Pick[]; kind: Pick; prompt: string }> = [
      {
        without: "sort.set",
        request: "custodian by value",
        families: [
          { id: "group", confidence: 0.9 },
          { id: "sort", confidence: 0.7 },
        ],
        kind: { id: "sort", confidence: 0.95 },
        prompt: "This grid can't sort rows.",
      },
      {
        without: "sort.set",
        request: "custodian by value",
        families: [
          { id: "columns.hide", confidence: 0.9 },
          { id: "sort", confidence: 0.7 },
        ],
        kind: { id: "sort", confidence: 0.95 },
        prompt: "This grid can't sort rows.",
      },
      {
        without: "columns.hide",
        request: "hide custodian by value",
        families: [
          { id: "columns.hide", confidence: 0.7 },
          { id: "sort", confidence: 0.9 },
        ],
        kind: { id: "columns.hide", confidence: 0.95 },
        prompt: "This grid can't hide columns.",
      },
    ];
    for (const { without, request, families, kind, prompt } of cases) {
      const provider = reshaped(families, kind);
      const plain = await read([], request, provider);
      expect(plain.got.status, request).toBe("ready");
      const { got, changed } = await read([without], request, provider);
      expect(got.status, request).toBe("needs_clarification");
      expect(got.message, request).toBe(prompt);
      expect(got.operations).toEqual([]);
      expect(changed).toBe(false);
    }
  });

  it("a family left in the middle band asks as on a grid that lists it, and its Yes is never ready", async () => {
    for (const [without, family, prompt] of [
      ["view.reset", "view.reset", "Did you want to reset the view?"],
      ["filter.clear", "filter.clear", "Did you want to clear the filters?"],
    ] as const) {
      for (const request of ["trusts", "show trusts", "northgate trusts", "taxable ones please"]) {
        const provider = reshaped([{ id: family, confidence: 0.7 }]);
        const plain = await read([], request, provider, filtered);
        expect(plain.got.message, request).toBe(prompt);
        const asked = await read([without], request, provider, filtered);
        expect(asked.got, request).toEqual(plain.got);
        expect(asked.changed).toBe(false);
        // Yes asks what it asks on a grid that lists the change, or "This grid can't …" where that grid would be ready.
        plain.cue.answer(`c0.family.${family}`, family);
        asked.cue.answer(`c0.family.${family}`, family);
        const after = asked.cue.getState();
        expect(after.status, request).toBe("needs_clarification");
        if (plain.cue.getState().status === "ready") expect(after.message, request).toMatch(/^This grid can't/);
        else expect(after.message, request).toBe(plain.cue.getState().message);
      }
    }
  });

  it("is never ready where a default Query Adapter isn't ready with the same plan", async () => {
    const families = ["filter", "sort", "columns.hide", "columns.show", "columns.only", "filter.clear", "sort.clear", "view.reset"];
    const requests = ["custodian by value", "hide custodian by value", "taxable accounts by value", "trusts", "northgate trusts"];
    for (const { op } of OPERATIONS.filter((o) => o.op !== "group.set")) {
      for (const request of requests) {
        for (const doubted of families) {
          const tweaks: Array<[Pick[], Pick?]> = [
            [[{ id: doubted, confidence: 0.7 }]],
            ...families
              .filter((f) => f !== doubted)
              .map((f): [Pick[], Pick] => [
                [
                  { id: f, confidence: 0.9 },
                  { id: doubted, confidence: 0.7 },
                ],
                { id: doubted, confidence: 0.95 },
              ]),
          ];
          for (const [picks, kind] of tweaks) {
            const provider = reshaped(picks, kind);
            const { got, changed } = await read([op], request, provider, filtered);
            if (got.status !== "ready") {
              expect(changed, `${request} ${JSON.stringify(picks)}`).toBe(false);
              continue;
            }
            const plain = await read([], request, provider, filtered);
            expect(got, `${request}, without ${op}, ${JSON.stringify(picks)} ${JSON.stringify(kind)}`).toEqual(plain.got);
          }
        }
      }
    }
  });
});

describe("a grid that lists every operation, or every one but grouping, is as it was", () => {
  const grids: Array<[string, () => GridAdapter]> = [
    ["a default Query Adapter", () => createQueryAdapter({ schema })],
    ["the Rows Adapter", () => createRowsAdapter({ schema })],
    ["a Query Adapter without group.set", () => createQueryAdapter({ schema, without: ["group.set"] })],
  ];
  for (const [name, make] of grids) {
    it(`${name} sends the provider the candidates of its own operations`, async () => {
      const adapter = make();
      let sent: ResolutionRequest | undefined;
      const spy: IntentProvider = {
        resolve: async (request) => {
          sent = request;
          return mock.resolve(request);
        },
      };
      await createGridCue({ adapter, provider: spy }).propose("sort by market value descending");
      expect(sent?.candidates).toEqual(buildCandidates(schema, adapter.getCapabilities()));
    });
  }

  for (const { op, request, state } of OPERATIONS.filter((o) => o.op !== "group.set")) {
    it(`a default Query Adapter and the Rows Adapter make the same ready plan for “${request}”, with ${op}`, async () => {
      const query = createQueryAdapter({ schema });
      const rows = createRowsAdapter({ schema });
      if (state) {
        query.setState((s) => ({ ...s, ...state }));
        rows.setState((s) => ({ ...s, ...state }));
      }
      const got = await reading(query, request);
      expect(got.status, request).toBe("ready");
      expect(got.operations.map((o: { type: string }) => o.type)).toContain(op);
      expect(got).toEqual(await reading(rows, request));
    });
  }
});
