import { describe, expect, it } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { cantQuestion } from "../src/core/compile";
import { createGridCue } from "../src/core/controller";
import { matchMentions } from "../src/core/mentions";
import { normalize } from "../src/core/normalize";
import { diffViews, renderPreview } from "../src/core/preview";
import { emptyViewState, type ViewOperation, type ViewPlan, type ViewState } from "../src/core/protocol";
import { applyOperations } from "../src/core/reduce";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { DEFAULT_CAPABILITIES, defineSchema, isExposed } from "../src/core/schema";
import { validatePlan } from "../src/core/validate";
import { readViewWords, viewWordsQuestion } from "../src/core/view-words";
import { createMockProvider } from "../src/mock";

// Pinning and density (operation set spec, 4.1 to 4.5, 5.2 and 5.3; ADRs 0028 and 0029). Code reads a small, closed set
// of words for each; a word left over and the part goes to the provider exactly as before. A grid that doesn't list the
// operation says so with the shared "This grid can't …" question, and nothing in the request applies.
const columns = [
  { id: "account", label: "Account number" },
  { id: "household", label: "Household" },
  { id: "advisor", label: "Advisor" },
  { id: "custodian", label: "Custodian" },
  { id: "value", label: "Market value", kind: "currency" as const },
  { id: "restricted", label: "Restricted holdings", kind: "boolean" as const },
  { id: "notes", label: "Notes" },
  { id: "ssn", label: "Tax ID" },
];
const options = {
  rowNoun: "account",
  restricted: ["ssn"],
  columns: {
    account: { aliases: ["account", "acct"] },
    household: { entity: "household" },
    advisor: { aliases: ["advisor", "rep"], entity: "advisor" },
    custodian: {
      kind: "enum" as const,
      enumValues: [
        { id: "northgate", label: "Northgate" },
        { id: "harborline", label: "Harborline" },
      ],
    },
    value: { aliases: ["value", "aum"] },
    restricted: { aliases: ["restricted"] },
    notes: { capabilities: ["show" as const, "hide" as const] },
  },
};
const schema = defineSchema(columns, options);
const mock = createMockProvider({ defaultColumnForKind: { currency: "value" } });
const PIN = "columns.pin";
const DENSITY = "density.set";

/** A grid that lists `columns.pin` and `density.set`, as the Rows Adapter will with `renders` (Task 2.4), or not. */
const grid = ({ pins = true, density = true, view = {} as Partial<ViewState>, s = schema } = {}) => {
  const rows = createRowsAdapter({ schema: s });
  rows.setState((v) => ({ ...v, ...view }));
  const extra = [...(pins ? [PIN] : []), ...(density ? [DENSITY] : [])];
  const adapter = {
    ...rows,
    getCapabilities: () => {
      const caps = rows.getCapabilities();
      return { ...caps, operations: [...caps.operations, ...extra] };
    },
  };
  return { adapter, cue: createGridCue({ adapter, provider: mock }) };
};

/** Proposes `request` and returns the plan's status, operations, Preview lines and questions. */
const propose = async (request: string, setup: Parameters<typeof grid>[0] = {}) => {
  const { cue, adapter } = grid(setup);
  const plan = await cue.propose(request);
  const state = cue.getState();
  return {
    status: state.status,
    operations: plan?.operations ?? [],
    lines: state.preview?.lines ?? null,
    questions: plan?.clarifications ?? [],
    unsupported: plan?.unsupportedSegments ?? [],
    cue,
    adapter,
  };
};
const pin = (columnIds: string[], position: "start" | "end" | "none" = "start"): ViewOperation => ({ type: PIN, columnIds, position });

const read = (text: string, s = schema) => {
  const { clauses } = normalize(text);
  const clause = clauses[0];
  if (!clause || clauses.length !== 1) throw new Error(`“${text}” is not one part`);
  const mentions = matchMentions(clauses, s.columns.filter(isExposed), { rowNoun: s.rowNoun });
  return { reading: readViewWords(clause, mentions, s), question: viewWordsQuestion(clause, mentions, s) };
};

describe("the pin, unpin and density words (spec 5.2)", () => {
  it.each([
    ["pin advisor", [pin(["advisor"])]],
    ["pin advisor and household", [pin(["advisor", "household"])]],
    ["pin advisor, household and custodian", [pin(["advisor", "household", "custodian"])]],
    ["pin the household column", [pin(["household"])]],
    ["pin the custodian and advisor columns", [pin(["custodian", "advisor"])]],
    ["pin account number to the start", [pin(["account"])]],
    ["pin account number to the left", [pin(["account"])]],
    ["pin market value to the end", [pin(["value"], "end")]],
    ["pin market value to the right", [pin(["value"], "end")]],
    ["Pin AUM to the end.", [pin(["value"], "end")]],
    ["pin the account number column to the left", [pin(["account"])]],
    ["freeze the advisor column", [pin(["advisor"])]],
    ["freeze the advisor and household columns", [pin(["advisor", "household"])]],
    ["unpin advisor", [pin(["advisor"], "none")]],
    ["unpin account number and household", [pin(["account", "household"], "none")]],
    ["unpin the market value column", [pin(["value"], "none")]],
    // An unpin that names no column unpins every pinned one: the compiler names them.
    ["unpin all columns", [pin([], "none")]],
    ["unpin all", [pin([], "none")]],
    ["unpin everything", [pin([], "none")]],
    ["compact view", [{ type: DENSITY, density: "compact" }]],
    ["comfortable rows", [{ type: DENSITY, density: "comfortable" }]],
    ["spacious density", [{ type: DENSITY, density: "spacious" }]],
    ["Spacious mode", [{ type: DENSITY, density: "spacious" }]],
    ["use compact density", [{ type: DENSITY, density: "compact" }]],
    ["pin advisor and compact view", [pin(["advisor"]), { type: DENSITY, density: "compact" }]],
  ])("reads “%s” whole", (text, operations) => {
    const { reading } = read(text);
    expect(reading?.operations).toEqual(operations);
    expect(reading?.from).toBeUndefined();
  });

  it("gives a span for each word it read, in the part's own text", () => {
    expect(read("pin the account number column to the left").reading?.spans).toEqual([
      { start: 0, end: 3, kind: "verb" },
      { start: 8, end: 22, kind: "column" },
      { start: 30, end: 41, kind: "position" },
    ]);
    expect(read("use compact density").reading?.spans).toEqual([
      { start: 0, end: 3, kind: "verb" },
      { start: 4, end: 19, kind: "density" },
    ]);
  });

  it.each([
    "pin advisor please",
    "please pin advisor",
    "pin advisor now",
    "pin advisor and household please",
    "pin the household column please",
    "pin account number to the left side",
    "pin market value to the far right",
    "pin market value to the top",
    "freeze the advisor column now",
    "unpin advisor please",
    "unpin all columns please",
    "unpin all the columns",
    "unpin everything now",
    "compact view please",
    "the compact view",
    "use compact density now",
    "use compact view",
    "compact views",
  ])("doesn't read “%s”: a word is left over", (text) => {
    expect(read(text).reading).toBeUndefined();
    expect(read(text).question).toBeUndefined();
  });

  it.each([
    // "Freeze" reads only with "column" (order plan D19); "lock", "stick" and "unfreeze" are not pin words.
    "freeze advisor",
    "freeze the account",
    "lock advisor",
    "stick advisor to the left",
    "unfreeze advisor",
    // Relative density words depend on the current density, so they ask.
    "denser",
    "tighter",
    "make it denser",
    "make it compact",
    "compact",
    "compact exceptions view",
    // Pinning rows is a workflow action, and a value is never a column.
    "pin to my watchlist",
    "pin the Northgate accounts to my watchlist",
    "pin the Northgate accounts",
    "pin northgate",
    "pin advisor and northgate",
    "unpin",
    "pin",
  ])("doesn't read “%s”", (text) => {
    expect(read(text).reading).toBeUndefined();
  });

  it("reads a pin, unpin or density said at the end of a part after “and” or a comma, and says where", () => {
    const text = "group by advisor and pin advisor";
    expect(read(text).reading).toEqual({
      operations: [pin(["advisor"])],
      spans: [
        { start: 21, end: 24, kind: "verb" },
        { start: 25, end: 32, kind: "column" },
      ],
      from: 17,
    });
    expect(read("sort by market value, compact rows").reading?.from).toBe(20);
    expect(read("sort by market value, compact rows").reading?.operations).toEqual([{ type: DENSITY, density: "compact" }]);
    // One word left over at the end and nothing is read.
    expect(read("group by advisor and pin advisor please").reading).toBeUndefined();
    expect(read("group by advisor and pin advisor to the far left").reading).toBeUndefined();
    // With no joining word, the words before are not the provider's alone.
    expect(read("group by advisor pin advisor").reading).toBeUndefined();
  });

  it("reads a Host's own name first: a form word in a declared label or alias is a Mention, so the form doesn't read", () => {
    const fleet = defineSchema(
      [
        { id: "unit", label: "Unit number" },
        { id: "pin_code", label: "Pin code" },
        { id: "size", label: "Size class" },
      ],
      {
        rowNoun: "vehicle",
        columns: {
          size: {
            kind: "enum",
            enumValues: [
              { id: "compact", label: "Compact" },
              { id: "midsize", label: "Midsize" },
            ],
          },
        },
      },
    );
    // "Pin code" names the column, and no pin word is left.
    expect(read("pin code", fleet)).toEqual({ reading: undefined, question: undefined });
    // "Compact" names a size: the words may ask for the density or name the value, so the part asks.
    expect(read("compact view", fleet).reading).toBeUndefined();
    expect(read("compact view", fleet).question?.prompt).toBe(
      "“compact” is a name in this grid, so GridCue can't tell what “compact view” asks for. Try rephrasing that part.",
    );
    expect(read("use compact density", fleet).reading).toBeUndefined();
    expect(read("pin unit number and compact view", fleet).question?.prompt).toContain("“compact”");
    // The column's own name after the pin word reads.
    expect(read("pin pin code", fleet).reading?.operations).toEqual([pin(["pin_code"])]);
    // A declared name the Mentions leave out (two columns share it) is still the Host's.
    const shared = defineSchema(
      [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ],
      { columns: { a: { aliases: ["view"] }, b: { aliases: ["view"] } } },
    );
    expect(read("compact view", shared).reading).toBeUndefined();
    expect(read("compact view", shared).question?.prompt).toContain("“view”");
  });

  it("never takes a name that may mean the rows as the column: the part asks instead", () => {
    // The Row Noun, even with "column" after it.
    expect(read("pin account").reading).toBeUndefined();
    expect(read("pin account").question?.prompt).toBe(
      "GridCue can't tell whether “account” means the Account number column or the rows. To pin the column, say “pin the Account number column”.",
    );
    expect(read("freeze the account column").reading).toBeUndefined();
    expect(read("freeze the account column").question?.prompt).toContain("“account”");
    // An entity word in the plural names the records.
    expect(read("pin households").reading).toBeUndefined();
    expect(read("pin households").question?.prompt).toContain("the Household column or the rows");
    expect(read("unpin advisors").question?.prompt).toContain("To unpin the column, say “unpin the Advisor column”.");
    // A yes/no column's name also says which rows, so it is the column only with "column" after it.
    expect(read("pin restricted").reading).toBeUndefined();
    expect(read("pin restricted holdings").question?.prompt).toContain("the Restricted holdings column or the rows");
    expect(read("pin the restricted holdings column").reading?.operations).toEqual([pin(["restricted"])]);
    // The singular entity word is the column's own name.
    expect(read("pin household").reading?.operations).toEqual([pin(["household"])]);
  });
});

describe("pinning and density on a grid that lists them (spec 5.3)", () => {
  it.each([
    ["pin account number", ["Pin Account number to the start"]],
    ["pin the account number column to the left", ["Pin Account number to the start"]],
    ["pin market value to the right", ["Pin Market value to the end"]],
    ["pin advisor and household", ["Pin Advisor and Household to the start"]],
    ["compact view", ["Use compact density"]],
    ["group by advisor and pin advisor", ["Group by Advisor", "Pin Advisor to the start"]],
    ["sort by market value descending and pin advisor", ["Sort by Market value, descending", "Pin Advisor to the start"]],
    ["pin advisor and compact view", ["Pin Advisor to the start", "Use compact density"]],
  ])("“%s” is ready", async (request, lines) => {
    const result = await propose(request);
    expect(result.status).toBe("ready");
    expect(result.lines).toEqual(lines);
  });

  it("keeps what the provider proposes only where the rest of the part names it", async () => {
    // The provider saw "advisor" in the pin's words too, and took it as a second sort.
    const result = await propose("sort by market value descending and pin advisor");
    expect(result.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }, pin(["advisor"])]);
    const hidden = await propose("hide custodian and pin advisor");
    expect(hidden.lines).toEqual(["Hide Custodian", "Pin Advisor to the start"]);
  });

  it("shows a hidden column before its pin, so the Preview says both", async () => {
    const view = { visibleColumnIds: ["account", "household", "advisor", "value"] };
    const result = await propose("pin custodian to the right", { view });
    expect(result.operations).toEqual([{ type: "columns.show", columnIds: ["custodian"] }, pin(["custodian"], "end")]);
    expect(result.lines).toEqual(["Show Custodian", "Pin Custodian to the end"]);
    expect(await result.cue.apply()).toBe(true);
    expect(result.adapter.getState().state.pinnedColumnIds).toEqual({ start: [], end: ["custodian"] });
    expect(result.adapter.getState().state.visibleColumnIds).toContain("custodian");
    // Of two columns, only the hidden one is shown.
    const two = await propose("pin advisor and custodian", { view });
    expect(two.operations).toEqual([{ type: "columns.show", columnIds: ["custodian"] }, pin(["advisor", "custodian"])]);
  });

  it("asks when the request hides the column it pins, or changes a pin again", async () => {
    const hidden = await propose("hide advisor and pin advisor");
    expect(hidden.status).toBe("needs_clarification");
    expect(hidden.questions).toEqual([{ id: "c0.pin", prompt: "GridCue can't hide Advisor and pin it too.", required: true }]);
    const later = await propose("pin advisor and hide advisor");
    expect(later.status).toBe("needs_clarification");
    expect(later.questions.map((q) => q.prompt)).toEqual(["I'm not sure what to do with “pin advisor”. Try rephrasing that part."]);
    const twice = await propose("pin advisor, unpin advisor");
    expect(twice.status).toBe("needs_clarification");
    // Two densities: the later one replaces the earlier, which is asked about.
    const densities = await propose("compact view, spacious view");
    expect(densities.status).toBe("needs_clarification");
    // An unpin of every column after a pin in the same request undoes that pin: it asks.
    expect((await propose("pin household and unpin everything")).status).toBe("needs_clarification");
    // An unpin a later pin follows is said as it shows.
    const view = { pinnedColumnIds: { start: ["advisor", "household"], end: [] } };
    expect((await propose("unpin everything and pin advisor", { view })).lines).toEqual(["Unpin all columns", "Pin Advisor to the start"]);
    // Two different columns are two changes.
    expect((await propose("pin advisor, pin household to the right")).lines).toEqual([
      "Pin Advisor to the start",
      "Pin Household to the end",
    ]);
  });

  it("unpins every pinned column for “unpin all columns”, and says so", async () => {
    const view = { pinnedColumnIds: { start: ["household", "advisor"], end: ["value"] } };
    for (const request of ["unpin all columns", "unpin all", "unpin everything"]) {
      const result = await propose(request, { view });
      expect(result.operations).toEqual([pin(["household", "advisor", "value"], "none")]);
      expect(result.lines).toEqual(["Unpin all columns"]);
    }
    const one = await propose("unpin advisor", { view });
    expect(one.lines).toEqual(["Unpin Advisor"]);
    // With nothing pinned, it would change nothing, so it says so (spec 5.3) rather than preview a line that does nothing.
    for (const request of ["unpin everything", "unpin advisor"]) {
      const none = await propose(request);
      expect(none.status, request).toBe("needs_clarification");
      expect(none.questions, request).toEqual([{ id: "plan.empty", prompt: "The grid already shows this view.", required: true }]);
    }
  });

  it("names only the columns a pin or unpin changes, so its line never claims a change that doesn't happen", async () => {
    const view = { pinnedColumnIds: { start: ["advisor", "household"], end: ["value"] } };
    // Pinned to that side already: it stays where it is, first among the pinned columns.
    const again = await propose("pin advisor", { view });
    expect(again.questions.map((q) => q.prompt)).toEqual(["The grid already shows this view."]);
    const more = await propose("pin advisor and custodian", { view });
    expect(more.operations).toEqual([pin(["custodian"])]);
    expect(await more.cue.apply()).toBe(true);
    expect(more.adapter.getState().state.pinnedColumnIds).toEqual({ start: ["advisor", "household", "custodian"], end: ["value"] });
    // Pinned to the other side: it moves, as said.
    expect((await propose("pin advisor to the right", { view })).lines).toEqual(["Pin Advisor to the end"]);
    // An unpin of a column that isn't pinned beside another change leaves only that change.
    const sorted = await propose("sort by market value and unpin custodian", { view });
    expect(sorted.lines).toEqual(["Sort by Market value, ascending"]);
    // A hidden column pinned to that side already is shown, and that is all.
    const hidden = await propose("pin household", { view: { ...view, visibleColumnIds: ["account", "advisor", "value"] } });
    expect(hidden.operations).toEqual([{ type: "columns.show", columnIds: ["household"] }]);
  });

  it("never pins a restricted column, or one whose capabilities leave pin out", async () => {
    const restricted = await propose("pin tax id");
    expect(restricted.status).toBe("unsupported");
    expect(restricted.unsupported).toEqual([{ category: "restricted_column" }]);
    expect(restricted.operations.some((op) => op.type === PIN)).toBe(false);
    const notes = await propose("pin notes");
    expect(notes.status).toBe("needs_clarification");
    expect(notes.questions).toEqual([{ id: "c0.pin", prompt: "GridCue can't pin Notes here.", required: true }]);
    const unpin = await propose("unpin all", { view: { pinnedColumnIds: { start: ["notes"], end: [] } } });
    expect(unpin.questions).toEqual([{ id: "c0.pin", prompt: "GridCue can't unpin Notes here.", required: true }]);
    const others = await propose("unpin everything", { view: { pinnedColumnIds: { start: ["notes", "advisor"], end: [] } } });
    expect(others.questions.map((q) => q.prompt)).toEqual(["GridCue can't unpin Notes here. To unpin the others, name them."]);
    // A restricted column the Host pinned and hides is never named: "unpin everything" leaves it pinned, out of sight, and
    // unpins the rest. One the User sees is asked about (below).
    const hidden = ["account", "household", "advisor", "custodian", "value", "restricted", "notes"];
    const secret = await propose("unpin everything", {
      view: { visibleColumnIds: hidden, pinnedColumnIds: { start: ["ssn", "advisor"], end: [] } },
    });
    expect(secret.lines).toEqual(["Unpin Advisor"]);
    expect(JSON.stringify(secret.questions)).not.toContain("Tax ID");
  });

  it("asks, never naming it, when “unpin everything” would leave a column the User sees pinned", async () => {
    const shown = ["account", "household", "advisor", "custodian", "value", "restricted", "notes", "ssn"];
    const both = { visibleColumnIds: shown, pinnedColumnIds: { start: ["ssn", "advisor"], end: [] } };
    const only = { visibleColumnIds: shown, pinnedColumnIds: { start: ["ssn"], end: [] } };
    const asks = [
      ["unpin everything", both, "GridCue can't unpin every column here. To unpin the others, name them."],
      ["unpin all columns", both, "GridCue can't unpin every column here. To unpin the others, name them."],
      ["unpin all", both, "GridCue can't unpin every column here. To unpin the others, name them."],
      ["compact view and unpin everything", both, "GridCue can't unpin every column here. To unpin the others, name them."],
      // Tax ID is the only one pinned: the grid doesn't already show this view.
      ["unpin everything", only, "GridCue can't unpin every column here."],
      ["compact view and unpin everything", only, "GridCue can't unpin every column here."],
    ] as const;
    for (const [request, view, prompt] of asks) {
      const result = await propose(request, { view });
      expect(result.status, request).toBe("needs_clarification");
      expect(result.questions, request).toEqual([{ id: expect.stringMatching(/^c\d\.pin$/), prompt, required: true }]);
      expect(await result.cue.apply()).toBe(false);
      expect(JSON.stringify(result.questions)).not.toContain("Tax ID");
    }
    // Naming the others still unpins them.
    expect((await propose("unpin advisor", { view: both })).lines).toEqual(["Unpin Advisor"]);
    // After a reset to a view with nothing pinned, nothing is left pinned.
    const reset = await propose("reset the view and unpin everything", { view: both });
    expect(reset.lines).toEqual(["Reset the view"]);
    expect(await reset.cue.apply()).toBe(true);
    expect(reset.adapter.getState().state.pinnedColumnIds).toEqual({ start: [], end: [] });
  });

  it("asks about a Host's name that holds a form's word wherever the words sit in the part", async () => {
    const fleet = defineSchema(
      [
        { id: "unit", label: "Unit number" },
        { id: "size", label: "Size class" },
        { id: "mileage", label: "Mileage", kind: "number" },
      ],
      {
        rowNoun: "vehicle",
        columns: {
          size: {
            kind: "enum",
            aliases: ["size"],
            enumValues: [
              { id: "compact", label: "Compact" },
              { id: "midsize", label: "Midsize" },
            ],
          },
        },
      },
    );
    // "Compact view" may ask for the density or name the size class, at the start of a part, in it, or at its end.
    const requests = [
      "compact view",
      "compact rows",
      "compact view, mileage over 50000",
      "mileage over 50000, compact view",
      "compact view sorted by mileage",
      "sort by mileage in compact view",
      "sort by mileage, compact view",
      "compact rows grouped by size",
      "group by size, compact rows",
      "compact rows for midsize vehicles",
      "midsize vehicles compact view",
      "midsize vehicles, compact view",
    ];
    for (const request of requests) {
      const result = await propose(request, { s: fleet });
      expect(result.status, request).toBe("needs_clarification");
      expect(result.operations, request).toEqual([]);
      expect(result.questions.map((q) => q.prompt)[0], request).toMatch(
        /^“compact” is a name in this grid, so GridCue can't tell what “compact (?:view|rows)” asks for\. Try rephrasing that part\.$/,
      );
    }
    // On a grid that doesn't list density, the words can only be the Host's value: each request reads as it did before
    // density was read, with the size class filter and no question about a name.
    for (const request of requests) {
      const result = await propose(request, { s: fleet, pins: false, density: false });
      expect(result.status, request).toBe("ready");
      expect(
        result.operations.some((op) => op.type === "filter.add" && op.predicate.columnId === "size"),
        request,
      ).toBe(true);
      expect(
        result.operations.some((op) => op.type === DENSITY),
        request,
      ).toBe(false);
    }
    // A density form that is no name of the Host's still ends in the shared question there.
    const spacious = await propose("compact vehicles, spacious rows", { s: fleet, pins: false, density: false });
    expect(spacious.questions.map((q) => q.prompt)).toEqual(["This grid can't change its density."]);
    // Without a density's noun after it, "compact" is only the Host's value, as before. "Rows" is the records' own word,
    // so after a word that takes them ("the", "show") "compact rows" says which rows, as "compact vehicles" does.
    for (const request of [
      "compact vehicles",
      "compact vehicles sorted by mileage",
      "sort by mileage, compact vehicles",
      "show me the compact rows",
      "hide the compact rows",
      "show compact rows only",
    ]) {
      const result = await propose(request, { s: fleet });
      expect(result.status, request).toBe("ready");
      expect(
        result.operations.some((op) => op.type === DENSITY),
        request,
      ).toBe(false);
    }
  });

  it("keeps the questions it asked before for words it doesn't read", async () => {
    for (const request of ["make it denser", "tighter", "pin to my watchlist", "pin the Northgate accounts", "compact exceptions view"]) {
      const result = await propose(request);
      expect(result.status, request).not.toBe("ready");
      expect(result.operations.some((op) => op.type === PIN || op.type === DENSITY)).toBe(false);
    }
  });
});

describe("a grid that doesn't draw pins or density says so (spec 5.3; order plan D3)", () => {
  const expectCant = async (request: string, prompts: string[], setup: Parameters<typeof grid>[0]) => {
    const { adapter, cue } = grid(setup);
    const before = adapter.getState();
    const plan = await cue.propose(request);
    expect(cue.getState().status, request).toBe("needs_clarification");
    expect(cue.getState().preview).toBeNull();
    expect(plan?.operations).toEqual([]);
    expect(plan?.unsupportedSegments).toEqual([]);
    expect(plan?.clarifications.map((q) => q.prompt)).toEqual(prompts);
    expect(plan?.clarifications.every((q) => q.options === undefined)).toBe(true);
    expect(await cue.apply()).toBe(false);
    expect(adapter.getState()).toEqual(before);
  };
  const PINS = "This grid can't pin columns.";
  const DENSE = "This grid can't change its density.";

  it.each([
    "pin account number",
    "pin the account number column to the left",
    "pin market value to the right",
    "freeze the advisor column",
    "unpin everything",
  ])("asks “This grid can't pin columns.” for “%s”", async (request) => {
    await expectCant(request, [PINS], { pins: false });
  });

  it("asks “This grid can't change its density.” for “compact view”", async () => {
    await expectCant("compact view", [DENSE], { density: false });
    await expectCant("use spacious density", [DENSE], { pins: false, density: false });
  });

  it("applies nothing in the request, the grouping included", async () => {
    await expectCant("group by advisor and pin advisor", [PINS], { pins: false });
    await expectCant("sort by market value and compact view", [DENSE], { density: false });
    await expectCant("pin advisor and compact view", [PINS, DENSE], { pins: false, density: false });
    // On a grid that can't group either, each "can't" is asked once, the grouping's first.
    const rows = createRowsAdapter({ schema });
    const adapter = {
      ...rows,
      getCapabilities: () => ({ ...rows.getCapabilities(), operations: MVP_OPERATIONS.filter((o) => o !== "group.set") }),
    };
    const plan = await createGridCue({ adapter, provider: mock }).propose("group by advisor and pin advisor");
    expect(plan?.clarifications).toEqual([cantQuestion(0, { type: "group.set" }), cantQuestion(0, { type: PIN })]);
  });

  it("uses the one shared question, with an ID that starts with its part's index", () => {
    expect(cantQuestion(2, { type: PIN })).toEqual({ id: "c2.cant.pin", prompt: PINS, required: true });
    expect(cantQuestion(0, { type: DENSITY })).toEqual({ id: "c0.cant.density", prompt: DENSE, required: true });
  });

  it("reads a request with no pin or density words as it did before", async () => {
    const without = await propose("sort by market value descending", { pins: false, density: false });
    const withThem = await propose("sort by market value descending");
    expect(without.lines).toEqual(["Sort by Market value, descending"]);
    expect(withThem.lines).toEqual(without.lines);
    // A pin word the reader doesn't read keeps today's question on both grids.
    const unread = await propose("pin to my watchlist", { pins: false });
    expect(unread.questions.map((q) => q.prompt)).toEqual((await propose("pin to my watchlist")).questions.map((q) => q.prompt));
  });
});

describe("the column default (spec 4.3; ADR 0029)", () => {
  it("lets every column that isn't restricted pin, unless the Host's capabilities leave it out", () => {
    expect(DEFAULT_CAPABILITIES).toContain("pin");
    const col = (id: string) => schema.columns.find((c) => c.id === id);
    expect(col("advisor")?.capabilities).toContain("pin");
    expect(col("ssn")?.capabilities).toEqual([]);
    // The Host's list replaces the defaults.
    expect(col("notes")?.capabilities).toEqual(["show", "hide"]);
  });
});

describe("pins in the reducer and validation (spec 4.4)", () => {
  const ids = schema.columns.map((c) => c.id);
  const base: ViewState = { ...emptyViewState(ids), visibleColumnIds: ids.filter((id) => id !== "ssn" && id !== "custodian") };
  const caps = {
    operations: [...MVP_OPERATIONS, PIN, DENSITY],
    supportsAtomicApply: true,
    supportsSnapshotRestore: true,
    observesChanges: true,
  };
  const ctx = { schema, capabilities: caps, current: { revision: "r1", state: base }, defaultState: base };
  const plan = (operations: ViewOperation[]): ViewPlan => ({
    protocolVersion: "0.1",
    id: "p1",
    baseRevision: "r1",
    source: { channel: "typed" },
    status: "ready",
    operations,
    evidence: [],
    clarifications: [],
    unsupportedSegments: [],
  });
  const pinsAfter = (operations: ViewOperation[], from: ViewState = base) => applyOperations(from, operations, base).pinnedColumnIds;

  it("keeps one entry for a column pinned twice", () => {
    expect(pinsAfter([pin(["advisor"]), pin(["advisor"])])).toEqual({ start: ["advisor"], end: [] });
    expect(pinsAfter([pin(["advisor", "advisor"])])).toEqual({ start: ["advisor"], end: [] });
    const result = validatePlan(plan([pin(["advisor"]), pin(["advisor"])]), ctx);
    expect(result.ok && result.state.pinnedColumnIds).toEqual({ start: ["advisor"], end: [] });
  });

  it("moves a column pinned to the start when it is pinned to the end", () => {
    expect(pinsAfter([pin(["advisor", "household"]), pin(["advisor"], "end")])).toEqual({ start: ["household"], end: ["advisor"] });
  });

  it("unpins a column from either side", () => {
    const pinned = { ...base, pinnedColumnIds: { start: ["advisor"], end: ["value"] } };
    expect(pinsAfter([pin(["advisor", "value"], "none")], pinned)).toEqual({ start: [], end: [] });
  });

  it("accepts a hidden pinned column, so hiding one later keeps its pin", () => {
    const result = validatePlan(plan([pin(["custodian"])]), ctx);
    expect(result.ok).toBe(true);
    const hidden = validatePlan(plan([pin(["advisor"]), { type: "columns.hide", columnIds: ["advisor"] }]), ctx);
    expect(hidden.ok && hidden.state.pinnedColumnIds.start).toEqual(["advisor"]);
  });

  it("rejects a pin on a column that may not pin, on a restricted column, or on a grid that doesn't list it", () => {
    const codes = (operations: ViewOperation[], c = ctx) => {
      const r = validatePlan(plan(operations), c);
      return r.ok ? [] : r.issues.map((i) => i.code);
    };
    expect(codes([pin(["notes"])])).toEqual(["PLAN_COLUMN_CAPABILITY"]);
    expect(codes([pin(["ssn"])])).toEqual(["POLICY_RESTRICTED_COLUMN"]);
    const without = { ...ctx, capabilities: { ...caps, operations: [...MVP_OPERATIONS] } };
    expect(codes([pin(["advisor"])], without)).toEqual(["PLAN_OPERATION_UNSUPPORTED"]);
    expect(codes([{ type: DENSITY, density: "compact" }], without)).toEqual(["PLAN_OPERATION_UNSUPPORTED"]);
  });
});

describe("pins and density in the Preview and the diff (spec 4.5)", () => {
  const ids = schema.columns.map((c) => c.id);
  const base: ViewState = emptyViewState(ids);
  it("keeps today's lines, and says “Unpin all columns” when the plan names every pinned column", () => {
    const lines = (operations: ViewOperation[], current?: Partial<ViewState>) =>
      renderPreview({ operations }, schema, current ? { filters: null, ...current } : undefined).lines;
    expect(lines([pin(["account"])])).toEqual(["Pin Account number to the start"]);
    expect(lines([pin(["account"], "end")])).toEqual(["Pin Account number to the end"]);
    expect(lines([pin(["account"], "none")])).toEqual(["Unpin Account number"]);
    expect(lines([{ type: DENSITY, density: "compact" }])).toEqual(["Use compact density"]);
    const pinned = { pinnedColumnIds: { start: ["advisor"], end: ["value"] } };
    expect(lines([pin(["value", "advisor"], "none")], pinned)).toEqual(["Unpin all columns"]);
    expect(lines([pin(["value"], "none")], pinned)).toEqual(["Unpin Market value"]);
    // Followed through the plan's own pins.
    expect(lines([pin(["household"]), pin(["advisor", "value", "household"], "none")], pinned)).toEqual([
      "Pin Household to the start",
      "Unpin all columns",
    ]);
  });

  it("says whether the pins or the density changed", () => {
    const pinned = { ...base, pinnedColumnIds: { start: ["advisor"], end: [] } };
    expect(diffViews(base, pinned)).toMatchObject({ pinsChanged: true, densityChanged: false });
    expect(diffViews(base, { ...base, density: "compact" })).toMatchObject({ pinsChanged: false, densityChanged: true });
    expect(diffViews(base, base)).toMatchObject({ pinsChanged: false, densityChanged: false });
  });
});

describe("a pin list cut where the request splits before a column's name", () => {
  // "Cleared" and "Order date" start with words the request is split before ("clear", "order"), so "pin customer and
  // cleared" is two parts: "pin customer" and "cleared". The list may run on into the second part, which the provider
  // would read as rows ("Cleared is Yes") or as another change. GridCue asks, and never reads the pin alone.
  const orders = defineSchema(
    [
      { id: "customer", label: "Customer" },
      { id: "order_date", label: "Order date", kind: "date" as const },
      { id: "amount", label: "Amount", kind: "currency" as const },
      { id: "cleared", label: "Cleared", kind: "boolean" as const },
    ],
    { rowNoun: "order", columns: { cleared: { aliases: ["settled"] } } },
  );
  const CLEARED =
    "GridCue can't tell whether “cleared” means the Cleared column or the rows. To pin the column, say “pin the Cleared column”.";

  it.each([
    ["pin customer and cleared", CLEARED],
    ["pin customer and cleared to the start", CLEARED],
    ["pin customer, cleared to the end", CLEARED],
    ["pin customer, cleared", CLEARED],
    ["pin customer and amount and cleared", CLEARED],
    ["pin the customer column and cleared", CLEARED],
    ["pin customer to the end and cleared", CLEARED],
    ["group by customer and pin amount and cleared", CLEARED],
    [
      "unpin customer and cleared",
      "GridCue can't tell whether “cleared” means the Cleared column or the rows. To unpin the column, say “unpin the Cleared column”.",
    ],
    [
      "pin customer and order date",
      "GridCue can't tell whether “order date” is one more column to pin. To pin it, say “pin the Order date column”.",
    ],
  ])("asks for “%s”, and never pins the first column alone", async (request, prompt) => {
    const result = await propose(request, { s: orders });
    expect(result.status, request).toBe("needs_clarification");
    expect(result.questions.map((q) => q.prompt)).toContain(prompt);
    // The same as a yes/no column's alias the list holds in one part.
    expect((await propose("pin customer and settled", { s: orders })).status).toBe("needs_clarification");
  });

  it("asks only “This grid can't pin columns.” on a grid that can't pin, whatever the list holds", async () => {
    for (const request of ["pin customer and cleared to the start", "pin customer and order date"]) {
      const result = await propose(request, { s: orders, pins: false });
      expect(result.questions.map((q) => q.prompt)).toEqual(["This grid can't pin columns."]);
      expect(result.operations).toEqual([]);
    }
  });

  it("still reads a pin before another change, and a list in one part", async () => {
    const shown = await propose("pin customer and show cleared", { s: orders });
    expect(shown.status).toBe("ready");
    expect(shown.operations[0]).toEqual(pin(["customer"]));
    expect((await propose("pin customer and amount", { s: orders })).lines).toEqual(["Pin Customer and Amount to the start"]);
    expect((await propose("pin customer, sort by amount", { s: orders })).status).toBe("ready");
    // A density form names no list, so nothing runs on from it.
    expect((await propose("compact view and show cleared", { s: orders })).status).toBe("ready");
  });

  it("reads a request with no pin form as it did before", async () => {
    for (const request of ["sort by amount and cleared", "cleared to the start"]) {
      const withPins = await propose(request, { s: orders });
      const without = await propose(request, { s: orders, pins: false, density: false });
      expect(withPins.status).toBe(without.status);
      expect(withPins.operations).toEqual(without.operations);
    }
  });
});

describe("a pin or density word no form read never leaves a ready plan (spec 5.2)", () => {
  // Code reads a form only as a whole part or its end. Said anywhere else, the word went to the provider with the rest
  // of the part, and the Mock read the rest and dropped it: "compact view, top 10 by market value" sorted and counted.
  const formAsks = (said: string) => `GridCue can't tell how “${said}” fits with the rest of that part. Try asking for it on its own.`;
  const wordAsks = (said: string) => `I'm not sure what to do with “${said}”. Try rephrasing that part.`;

  it.each([
    ["compact view, top 10 by market value", formAsks("compact view")],
    ["compact view of northgate accounts", formAsks("compact view")],
    ["northgate accounts in compact view", formAsks("compact view")],
    ["sort by market value in spacious mode", formAsks("spacious mode")],
    ["pin market value above 1m", formAsks("pin market value")],
    ["group by advisor with advisor pinned", wordAsks("pinned")],
    ["northgate accounts compact", wordAsks("compact")],
    ["northgate accounts, denser", wordAsks("denser")],
    ["northgate accounts with a freeze", wordAsks("freeze")],
  ])("asks for “%s” on a grid that draws pins and density", async (request, prompt) => {
    const result = await propose(request);
    expect(result.status, request).toBe("needs_clarification");
    expect(result.questions.map((q) => q.prompt)).toEqual([prompt]);
  });

  it.each([
    ["compact view, top 10 by market value", "This grid can't change its density."],
    ["northgate accounts in compact view", "This grid can't change its density."],
    ["pin market value above 1m", "This grid can't pin columns."],
  ])("asks only “This grid can't …” for “%s” on a grid that doesn't", async (request, prompt) => {
    const result = await propose(request, { pins: false, density: false });
    expect(result.questions.map((q) => q.prompt)).toEqual([prompt]);
    expect(result.operations).toEqual([]);
  });

  it("asks a word nothing reads the same on both grids", async () => {
    const result = await propose("group by advisor with advisor pinned", { pins: false, density: false });
    expect(result.questions.map((q) => q.prompt)).toEqual([wordAsks("pinned")]);
  });

  it("reads as before where the word is a name, quoted text, the text to match, or said to stay", async () => {
    for (const request of [
      'household contains "compact"',
      "sort by market value, the pins stay",
      "sort by market value, pinned columns unchanged",
    ]) {
      const withThem = await propose(request);
      const without = await propose(request, { pins: false, density: false });
      expect(withThem.status, request).toBe("ready");
      expect(without.operations, request).toEqual(withThem.operations);
    }
    // A Host's name that holds the word is a Mention first: "Compact" is a size here.
    const sized = defineSchema([...columns, { id: "size", label: "Size" }], {
      ...options,
      columns: { ...options.columns, size: { kind: "enum" as const, enumValues: [{ id: "compact", label: "Compact" }] } },
    });
    expect((await propose("compact accounts sorted by market value", { s: sized })).status).toBe("ready");
  });
});

describe("a grid that doesn't draw pins asks only “This grid can't …”, whatever the pin's words", () => {
  it("asks it for a pin whose column may mean the rows, rather than a question whose answer the grid can't do", async () => {
    for (const request of ["pin restricted", "pin households", "freeze the account column"]) {
      const result = await propose(request, { pins: false, density: false });
      expect(
        result.questions.map((q) => q.prompt),
        request,
      ).toEqual(["This grid can't pin columns."]);
    }
  });

  it("refuses a request with a part outside the view-only rule, as a grid that draws pins does", async () => {
    for (const setup of [{}, { pins: false, density: false }]) {
      const result = await propose("pin advisor and export the list", setup);
      expect(result.status).toBe("unsupported");
      expect(result.unsupported).toEqual([{ text: "export the list", category: "export" }]);
    }
  });
});

describe("a House Term is never named with a pin or density form's word (ADR 0024)", () => {
  it.each(["Unpin", "Freeze", "Start", "End", "Left", "Right", "Mode", "Density", "Use", "Spacious", "Unpin list"])(
    "refuses “%s”",
    (label) => {
      const terms = [{ label, where: [{ columnId: "value", operator: "lt" as const, value: 100_000 }] }];
      expect(() => defineSchema(columns, { ...options, houseTerms: terms })).toThrow(/one of GridCue's own words/);
    },
  );

  it("accepts a name built on such a word that no form reads", () => {
    const terms = [{ label: "Frozen", where: [{ columnId: "value", operator: "lt" as const, value: 100_000 }] }];
    expect(() => defineSchema(columns, { ...options, houseTerms: terms })).not.toThrow();
  });
});

describe("reading pin and density words stays fast", () => {
  // Each unit makes one long part, and most end in a word left over, so the end of the part is looked for after every
  // "and" and comma. A first version read the rest of the part again from each one and took 25 ms here.
  const units = [
    "compact view and ",
    "unpin all columns, compact rows, ",
    "pin advisor and household and ",
    "pin advisor, household, custodian, market value and aum to the right and ",
    "group by advisor and pin advisor ",
    "pin the account column ",
    "and and and , , , pin ",
  ];
  it("reads and compiles 2,000 characters of pin and density words in under 50 ms", async () => {
    const empty = { resolve: async () => ({ clauses: [] }) };
    for (const unit of units) {
      const text = unit.repeat(Math.ceil(2000 / unit.length)).slice(0, 2000);
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const { adapter } = grid();
        const cue = createGridCue({ adapter, provider: empty, maxUtteranceLength: 2000 });
        const started = performance.now();
        await cue.propose(text);
        best = Math.min(best, performance.now() - started);
      }
      expect(best, unit).toBeLessThan(50);
    }
  });
});
