import { describe, expect, it } from "vitest";
import { compile, settleFamilies } from "../src/core/compile";
import { type Mention, matchMentions } from "../src/core/mentions";
import { normalize } from "../src/core/normalize";
import { renderPreview, toAuditEvent } from "../src/core/preview";
import { emptyViewState } from "../src/core/protocol";
import type { ClauseResolution } from "../src/core/resolution";
import { defineSchema } from "../src/core/schema";

const schema = defineSchema(
  [
    { id: "name", kind: "string" },
    { id: "value", kind: "currency" },
    { id: "gain", kind: "currency" },
    { id: "status", kind: "enum" },
    { id: "flagged", kind: "boolean" },
  ],
  {
    columns: {
      status: {
        enumValues: [
          { id: "open", label: "Open" },
          { id: "closed", label: "Closed" },
        ],
      },
    },
  },
);
const state = emptyViewState(schema.columns.map((c) => c.id));
let n = 0;
const run = (text: string, clauses: Array<Partial<ClauseResolution>>, answers?: Record<string, string>, useMentions = false) =>
  compile({
    input: normalize(text),
    ...(useMentions ? { mentions: matchMentions(normalize(text).clauses, schema.columns) } : {}),
    resolution: { clauses: clauses.map((c, i) => ({ clauseIndex: i, families: [], columns: [], values: [], unmatchedTerms: [], ...c })) },
    schema,
    state,
    baseRevision: "r1",
    channel: "typed",
    text,
    newId: (p) => `${p}_${++n}`,
    ...(answers ? { answers } : {}),
  });
const hi = (id: string) => ({ id, confidence: 0.95 });

describe("compile", () => {
  it("builds ordered operations from a compound request", () => {
    const plan = run("open ones over $1m, sort value largest first", [
      { families: [hi("filter")], columns: [hi("value")], values: [{ columnId: "status", valueId: "open", confidence: 0.95 }] },
      { families: [hi("sort")], columns: [hi("value")] },
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.operations.map((o) => o.type)).toEqual(["filter.add", "filter.add", "sort.set"]);
    expect(renderPreview(plan, schema).text).toBe(
      "Filter Status to Open; filter Value above $1,000,000; sort by Value, descending. No records will be changed.",
    );
    expect(plan.confidence).toBe(0.95);
  });

  it("asks which column a bare amount means instead of guessing", () => {
    const plan = run("over $1m", [{ families: [hi("filter")] }]);
    expect(plan.status).toBe("needs_clarification");
    expect(plan.operations).toEqual([]);
    expect(plan.clarifications[0]).toMatchObject({ id: "c0.literal0.column", prompt: "Which column should be above $1,000,000?" });
    expect(plan.clarifications[0]?.options?.map((o) => o.id)).toEqual(["value", "gain"]);
  });

  it("uses a clarification answer on recompile", () => {
    const plan = run("over $1m", [{ families: [hi("filter")] }], { "c0.literal0.column": "gain" });
    expect(plan.status).toBe("ready");
    expect(plan.evidence).toContainEqual({ key: "c0.literal0.column", selectedId: "gain", confidence: 1, source: "user" });
  });

  it("confirms middling column picks and drops weak ones", () => {
    const plan = run("sort by worth", [
      {
        families: [hi("sort")],
        columns: [
          { id: "value", confidence: 0.7 },
          { id: "gain", confidence: 0.3 },
        ],
      },
    ]);
    expect(plan.clarifications.map((q) => q.id)).toContain("c0.column.value");
  });

  it("names unknown columns without guessing", () => {
    const plan = run("sort by risk score", [{ families: [hi("sort")], unmatchedTerms: ["risk score"] }]);
    expect(plan.clarifications[0]?.prompt).toBe("There's no column called “risk score”. Which column should be sorted by?");
  });

  it("marks mixed requests unsupported and keeps nothing applicable", () => {
    const plan = run("show flagged, then sell them", [
      { families: [hi("filter")], values: [{ columnId: "flagged", valueId: "true", confidence: 0.9 }] },
      { families: [hi("unsupported.workflow_action")] },
    ]);
    expect(plan.status).toBe("unsupported");
    expect(plan.unsupportedSegments).toEqual([{ text: "sell them", category: "workflow_action" }]);
  });

  it("refuses restricted mentions without calling on the resolution", () => {
    const plan = compile({
      input: normalize("show tax ids"),
      resolution: { clauses: [] },
      schema,
      state,
      baseRevision: "r1",
      channel: "typed",
      restricted: [{ clauseIndex: 0, columnId: "tax_id" }],
      newId: (p) => p,
    });
    expect(plan.status).toBe("unsupported");
    expect(plan.unsupportedSegments).toEqual([{ category: "restricted_column" }]);
  });

  it("asks how to read an ambiguous number and applies nothing", () => {
    const plan = run("value over 1.000.000", [{ families: [hi("filter")], columns: [hi("value")] }]);
    expect(plan.status).toBe("needs_clarification");
    expect(plan.operations).toEqual([]);
    expect(plan.clarifications[0]?.prompt).toBe("I couldn't read “1.000.000” as a number. Write it like 1,000,000 or $1M.");
  });

  it("asks for help with vague requests", () => {
    expect(run("make it look better", [{}]).status).toBe("needs_clarification");
  });

  it("ignores a boolean value that isn't true or false instead of treating it as false", () => {
    const plan = run("restricted holdings", [
      { families: [hi("filter")], values: [{ columnId: "flagged", valueId: "maybe", confidence: 0.95 }] },
    ]);
    expect(plan.status).toBe("needs_clarification");
    expect(plan.operations).toEqual([]);
  });

  it("drops a provider family id the protocol does not define", () => {
    const plan = run("do something weird", [{ families: [{ id: "cells.edit", confidence: 0.99 }] }]);
    expect(plan.status).toBe("needs_clarification");
    expect(plan.operations).toEqual([]);
    expect(plan.clarifications[0]?.prompt).toBe(
      "I'm not sure what to change for “do something weird”. Try asking to filter, sort, group, or show or hide columns.",
    );
  });

  it("confirms a middling family confidence, then resolves on the user's answer", () => {
    const clause = { families: [{ id: "sort", confidence: 0.7 }], columns: [hi("value")] };
    const asked = run("sort by worth", [clause]);
    expect(asked.status).toBe("needs_clarification");
    const clarification = asked.clarifications.find((q) => q.id === "c0.family.sort");
    expect(clarification).toMatchObject({ prompt: "Did you want to sort the rows?" });
    expect(clarification?.options?.map((o) => o.id)).toEqual(["sort", "none"]);

    const yes = run("sort by worth", [clause], { "c0.family.sort": "sort" });
    expect(yes.status).toBe("ready");
    expect(yes.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] }]);
    expect(yes.evidence).toContainEqual({ key: "c0.family.sort", selectedId: "sort", confidence: 1, source: "user" });

    const no = run("sort by worth", [clause], { "c0.family.sort": "none" });
    expect(no.operations).toEqual([]);
  });

  it("refuses a middling unsupported family instead of asking about it", () => {
    const plan = run("sort by worth and edit it", [
      { families: [hi("sort"), { id: "unsupported.data_mutation", confidence: 0.7 }], columns: [hi("value")] },
    ]);
    expect(plan.status).toBe("unsupported");
    expect(plan.clarifications.map((q) => q.id)).not.toContain("c0.family.unsupported.data_mutation");
    expect(plan.unsupportedSegments).toContainEqual(expect.objectContaining({ category: "data_mutation" }));
  });

  it("leaves a confident family and a confident value exactly as before", () => {
    const plan = run("open ones", [
      { families: [{ id: "filter", confidence: 0.9 }], values: [{ columnId: "status", valueId: "open", confidence: 0.9 }] },
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.operations).toEqual([
      expect.objectContaining({
        type: "filter.add",
        predicate: expect.objectContaining({ columnId: "status", operator: "eq", value: "open" }),
        combineWith: "and",
      }),
    ]);
  });

  it("confirms a middling value confidence, then resolves on the user's answer", () => {
    const clause = { families: [hi("filter")], values: [{ columnId: "status", valueId: "open", confidence: 0.7 }] };
    const asked = run("open ones", [clause]);
    expect(asked.status).toBe("needs_clarification");
    const clarification = asked.clarifications.find((q) => q.id === "c0.value.status.open");
    expect(clarification).toMatchObject({ prompt: "Did you mean Status: Open?" });
    expect(clarification?.options?.map((o) => o.id)).toEqual(["open", "none"]);

    const yes = run("open ones", [clause], { "c0.value.status.open": "open" });
    expect(yes.status).toBe("ready");
    expect(yes.operations).toEqual([
      expect.objectContaining({
        type: "filter.add",
        predicate: expect.objectContaining({ columnId: "status", operator: "eq", value: "open" }),
        combineWith: "and",
      }),
    ]);
    expect(yes.evidence).toContainEqual({ key: "c0.value.status.open", selectedId: "open", confidence: 1, source: "user" });

    const no = run("open ones", [clause], { "c0.value.status.open": "none" });
    expect(no.operations).toEqual([]);
  });

  it("expands keep-only into show, hide, and order", () => {
    const plan = run("keep only name and value", [{ families: [hi("columns.only")], columns: [hi("name"), hi("value")] }]);
    expect(plan.operations).toEqual([
      { type: "columns.show", columnIds: ["name", "value"] },
      { type: "columns.hide", columnIds: ["gain", "status", "flagged"] },
      { type: "columns.order", columnIds: ["name", "value"] },
    ]);
  });
});

describe("toAuditEvent", () => {
  it("omits text, labels, and values by default", () => {
    const plan = run("over $1m in value", [{ families: [hi("filter")], columns: [hi("value")] }]);
    const event = toAuditEvent(plan, "applied");
    expect(JSON.stringify(event)).not.toMatch(/1000000|over|Value/);
    expect(event.operationTypes).toEqual(["filter.add"]);
    expect(toAuditEvent(plan, "applied", { includeText: true }).text).toBe("over $1m in value");
  });

  it("bands confidence against the Host's own ConfidencePolicy, not the default", () => {
    const base = run("over $1m in value", [{ families: [hi("filter")], columns: [hi("value")] }]);
    const plan = { ...base, confidence: 0.92 };
    expect(toAuditEvent(plan, "applied").confidenceBand).toBe("high");
    expect(toAuditEvent(plan, "applied", {}, {}, { ready: 0.95, clarify: 0.9 }).confidenceBand).toBe("medium");
  });
});

const at = (id: string, confidence: number) => ({ id, confidence });
const families = (plan: ReturnType<typeof run>) => plan.evidence.filter((e) => e.key === "c0.family").map((e) => e.selectedId);

describe("family precedence (ADR 0012)", () => {
  it("drops middling families once one is confident (rule 1)", () => {
    const plan = run("reset the view", [{ families: [at("view.reset", 0.96), at("filter.clear", 0.83), at("sort.clear", 0.64)] }]);
    expect(plan.status).toBe("ready");
    expect(plan.operations).toEqual([{ type: "view.reset" }]);
    expect(plan.evidence).toContainEqual({
      key: "dropped:c0.family",
      selectedId: "filter.clear",
      confidence: 0.83,
      source: "deterministic",
    });
  });

  it("still asks about middling families when nothing is confident", () => {
    const plan = run("tidy up", [{ families: [at("view.reset", 0.8)] }]);
    expect(plan.clarifications.map((q) => q.prompt)).toEqual(["Did you want to reset the view?"]);
  });

  it("lets show-only absorb show and hide (rule 2)", () => {
    const plan = run("keep only name and value", [
      { families: [at("columns.only", 0.97), at("columns.hide", 0.88), at("columns.show", 0.67)], columns: [hi("name"), hi("value")] },
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.operations[0]).toEqual({ type: "columns.show", columnIds: ["name", "value"] });
  });

  it("lets explicit clears beat a weaker reset, and a stronger reset beat the clears (rule 3)", () => {
    const clears = run("clear the filters and sorting", [
      { families: [at("filter.clear", 0.99), at("sort.clear", 0.99), at("view.reset", 0.9)] },
    ]);
    expect(clears.operations).toEqual([{ type: "filter.clear" }, { type: "sort.set", sorts: [] }]);
    const reset = run("reset everything", [{ families: [at("view.reset", 0.97), at("filter.clear", 0.9)] }]);
    expect(reset.operations).toEqual([{ type: "view.reset" }]);
    const tie = run("reset the filters", [{ families: [at("view.reset", 0.9), at("filter.clear", 0.9)] }]);
    expect(tie.operations).toEqual([{ type: "filter.clear" }]);
  });

  it("keeps the top column family when it leads by at least 0.10 (rule 4)", () => {
    const plan = run("show value over $1m", [{ families: [at("filter", 0.95), at("columns.show", 0.85)], columns: [hi("value")] }]);
    expect(plan.status).toBe("ready");
    expect(plan.operations.map((o) => o.type)).toEqual(["filter.add"]);
    expect(families(plan)).toEqual(["filter"]);
  });

  it("asks for a split when column families are close (rule 5)", () => {
    const plan = run("show value over $1m", [{ families: [at("filter", 0.95), at("columns.show", 0.9)], columns: [hi("value")] }]);
    expect(plan.clarifications[0]?.prompt).toBe(
      "“show value over $1m” asks for more than one kind of change. Split it into separate parts.",
    );
  });

  it("lets a family with nothing to act on yield to one that has something", () => {
    const plan = run("show closed ones", [{ families: [at("columns.show", 0.85), at("filter", 0.82)] }], undefined, true);
    expect(plan.clarifications.map((q) => q.prompt)).toEqual(["Did you want to filter the rows?"]);
    const alone = run("sort by risk score", [{ families: [hi("sort")] }]);
    expect(alone.clarifications[0]?.prompt).toBe("There's no column called “risk score”. Which column should be sorted by?");
  });

  it("settles families as a pure function, with a lead of exactly 0.10 counting as a margin", () => {
    expect(settleFamilies([at("sort", 0.95), at("group", 0.85)], [at("filter", 0.7)])).toEqual({
      kept: [at("sort", 0.95)],
      ask: [],
      dropped: [at("group", 0.85), at("filter", 0.7)],
      byKind: false,
    });
    expect(settleFamilies([at("sort", 0.95), at("group", 0.86)], []).kept).toHaveLength(2);
  });
});

describe("Mentions", () => {
  it("uses a named column at confidence 1 whatever the provider scored", () => {
    const plan = run("sort by gain", [{ families: [hi("sort")], columns: [at("gain", 0.7)] }], undefined, true);
    expect(plan.status).toBe("ready");
    expect(plan.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "gain", direction: "asc" }] }]);
    expect(plan.evidence).toContainEqual({ key: "c0.column", selectedId: "gain", confidence: 1, source: "deterministic" });
  });

  it("drops a named column the provider scored below the floor, so the rows aren't read as a column", () => {
    const plan = run("sort by gain", [{ families: [hi("sort")], columns: [at("gain", 0.05), at("value", 0.9)] }], undefined, true);
    expect(plan.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] }]);
    expect(plan.evidence).toContainEqual({ key: "dropped:c0.mention", selectedId: "gain", confidence: 0.05, source: "provider" });
  });

  it("keeps a named column the provider doubts when its own value answer confirms it", () => {
    const plan = run(
      "flagged ones grouped by name",
      [
        {
          families: [hi("group")],
          columns: [at("flagged", 0.3), hi("name")],
          values: [{ columnId: "flagged", valueId: "true", confidence: 0.96 }],
        },
      ],
      undefined,
      true,
    );
    expect(plan.operations).toMatchObject([
      { type: "filter.add", predicate: { columnId: "flagged", operator: "eq", value: true } },
      { type: "group.set", columnIds: ["name"] },
    ]);
  });

  it("never calls a named value an unknown column", () => {
    const plan = run("show closed ones", [{ families: [at("columns.show", 0.9)] }], undefined, true);
    expect(plan.clarifications.map((q) => q.prompt).join(" ")).not.toContain("no column called");
  });

  it("never silently ignores a named value in a part that doesn't filter", () => {
    const plan = run("group by name, closed ones please", [{ families: [hi("group")], columns: [hi("name")] }], undefined, true);
    expect(plan.status).toBe("needs_clarification");
    expect(plan.clarifications[0]?.prompt).toBe(
      "“group by name, closed ones please” also names Closed. Split it into separate parts, such as “only Closed” and the rest.",
    );
  });

  it("filters on a value named before another change's verb", () => {
    const plan = run("closed ones grouped by name", [{ families: [hi("group")], columns: [hi("name")] }], undefined, true);
    expect(plan.status).toBe("ready");
    expect(plan.operations).toMatchObject([
      { type: "filter.add", predicate: { columnId: "status", operator: "eq", value: "closed" } },
      { type: "group.set", columnIds: ["name"] },
    ]);
    expect(plan.evidence).toContainEqual({ key: "c0.modifier", selectedId: "filter", confidence: 1, source: "deterministic" });
  });

  it("uses a named value, and never asks about the column it implies", () => {
    const plan = run("only closed ones", [{ families: [hi("filter")], columns: [at("status", 0.75)], values: [] }], undefined, true);
    expect(plan.status).toBe("ready");
    expect(plan.operations).toMatchObject([{ type: "filter.add", predicate: { columnId: "status", operator: "eq", value: "closed" } }]);
  });

  it("never asks about a column a confident provider value already implies", () => {
    const plan = run("only the open ones", [
      { families: [hi("filter")], columns: [at("status", 0.7)], values: [{ columnId: "status", valueId: "open", confidence: 0.9 }] },
    ]);
    expect(plan.status).toBe("ready");
  });
});

describe("literal targets", () => {
  it("uses the provider's confident pick for a literal", () => {
    const plan = run("rows over $1m", [
      { families: [hi("filter")], literalColumns: [{ literalIndex: 0, columnId: "gain", confidence: 0.9 }] },
    ]);
    expect(plan.operations).toMatchObject([{ predicate: { columnId: "gain", operator: "gt", value: 1_000_000 } }]);
  });

  it("offers a middling pick first when no column is otherwise known", () => {
    const plan = run("rows over $1m", [
      { families: [hi("filter")], literalColumns: [{ literalIndex: 0, columnId: "gain", confidence: 0.7 }] },
    ]);
    expect(plan.clarifications[0]).toMatchObject({
      prompt: "Which column should be above $1,000,000?",
      options: [{ id: "gain" }, { id: "value" }],
    });
  });

  it("ignores a pick whose kind doesn't fit, and falls back to a confident column", () => {
    const plan = run("value over $1m", [
      { families: [hi("filter")], columns: [hi("value")], literalColumns: [{ literalIndex: 0, columnId: "name", confidence: 0.99 }] },
    ]);
    expect(plan.operations).toMatchObject([{ predicate: { columnId: "value" } }]);
  });
});

describe("unknown terms", () => {
  it("names the term when the provider found no column and returned none", () => {
    const plan = run("sort by risk score", [{ families: [hi("sort")] }]);
    expect(plan.clarifications[0]?.prompt).toBe("There's no column called “risk score”. Which column should be sorted by?");
  });

  it("does not claim a column is missing while asking 'Did you mean …?'", () => {
    const plan = run("sort by worth", [{ families: [hi("sort")], columns: [at("value", 0.7)] }]);
    expect(plan.clarifications.map((q) => q.prompt)).toEqual(["Did you mean Value?", "Which column should be sorted by?"]);
  });
});

describe("sort and group levels", () => {
  it("adds consecutive sorts as levels, in the order they were named", () => {
    const plan = run("sort by name, then by value, largest first", [
      { families: [hi("sort")], columns: [hi("name")] },
      { families: [hi("sort")], columns: [hi("value")] },
    ]);
    expect(plan.operations).toEqual([
      {
        type: "sort.set",
        sorts: [
          { columnId: "name", direction: "asc" },
          { columnId: "value", direction: "desc" },
        ],
      },
    ]);
    expect(renderPreview(plan, schema).lines).toEqual(["Sort by Name, ascending; then Value, descending"]);
  });

  it("nests consecutive groupings, outermost first, and says so in the Preview", () => {
    const plan = run("group by status, then by name", [
      { families: [hi("group")], columns: [hi("status")] },
      { families: [hi("group")], columns: [hi("name")] },
    ]);
    expect(plan.operations).toEqual([{ type: "group.set", columnIds: ["status", "name"] }]);
    expect(renderPreview(plan, schema).lines).toEqual(["Group by Status, then Name"]);
  });

  it("replaces an earlier level when a part says 'instead'", () => {
    const plan = run("sort by name; sort by value instead", [
      { families: [hi("sort")], columns: [hi("name")] },
      { families: [hi("sort")], columns: [hi("value")] },
    ]);
    expect(plan.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "name", direction: "asc" }] },
      { type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] },
    ]);
  });

  it("starts over after a clear, and never repeats a column", () => {
    const plan = run("clear the sort; sort by value; then by value", [
      { families: [hi("sort.clear")] },
      { families: [hi("sort")], columns: [hi("value")] },
      { families: [hi("sort")], columns: [hi("value")] },
    ]);
    expect(plan.operations).toEqual([
      { type: "sort.set", sorts: [] },
      { type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] },
    ]);
  });
});

describe("fan-out signals", () => {
  const role = (columnId: string, family: string, confidence = 0.9) => ({ columnId, family, confidence });

  it("lets one part sort and hide when role answers give each its own column", () => {
    const plan = run("sort by value with the gain column hidden", [
      {
        families: [hi("sort"), hi("columns.hide")],
        columns: [hi("value"), hi("gain")],
        roles: [role("value", "sort"), role("gain", "columns.hide")],
      },
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.operations).toEqual([
      { type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] },
      { type: "columns.hide", columnIds: ["gain"] },
    ]);
  });

  it("still asks for a split when role answers don't separate the columns", () => {
    const plan = run("sort and hide value", [
      {
        families: [at("sort", 0.95), at("columns.hide", 0.9)],
        columns: [hi("value")],
        roles: [role("value", "sort"), role("value", "columns.hide")],
      },
    ]);
    expect(plan.clarifications[0]?.prompt).toContain("Split it into separate parts");
  });

  it("lets a confident change-type pick decide between close families, and records it", () => {
    const plan = run("value first", [{ families: [at("sort", 0.9), at("group", 0.88)], columns: [hi("value")], kind: at("sort", 0.8) }]);
    expect(plan.operations.map((o) => o.type)).toEqual(["sort.set"]);
    expect(plan.evidence).toContainEqual({ key: "c0.kind", selectedId: "sort", confidence: 0.8, source: "provider" });
  });

  it("promotes a middling family the change-type pick is sure of", () => {
    const plan = run("show closed ones", [{ families: [at("filter", 0.7)], kind: at("filter", 0.9) }], undefined, true);
    expect(plan.status).toBe("ready");
    expect(plan.operations).toMatchObject([{ type: "filter.add", predicate: { columnId: "status", value: "closed" } }]);
  });

  it("appends to the current view's grouping when the part adds a level", () => {
    const grouped = { ...state, groupBy: ["status"] };
    const plan = compile({
      input: normalize("also group by name"),
      resolution: {
        clauses: [{ clauseIndex: 0, families: [hi("group")], columns: [hi("name")], values: [], unmatchedTerms: [], adds: 0.9 }],
      },
      schema,
      state: grouped,
      baseRevision: "r1",
      channel: "typed",
      newId: (p) => `${p}_${++n}`,
    });
    expect(plan.operations).toEqual([{ type: "group.set", columnIds: ["status", "name"] }]);
  });

  it("replaces the current grouping when the add-a-level answer is low or the part says instead", () => {
    const grouped = { ...state, groupBy: ["status"] };
    const compileWith = (text: string, adds: number) =>
      compile({
        input: normalize(text),
        resolution: { clauses: [{ clauseIndex: 0, families: [hi("group")], columns: [hi("name")], values: [], unmatchedTerms: [], adds }] },
        schema,
        state: grouped,
        baseRevision: "r1",
        channel: "typed",
        newId: (p) => `${p}_${++n}`,
      }).operations;
    expect(compileWith("group by name", 0.3)).toEqual([{ type: "group.set", columnIds: ["name"] }]);
    expect(compileWith("group by name instead", 0.9)).toEqual([{ type: "group.set", columnIds: ["name"] }]);
  });

  it("reverses nesting only with reversal wording and a confident answer, and keeps both columns", () => {
    const outer = [{ outerId: "status", innerId: "name", confidence: 0.9 }];
    const within = run("group by name within status", [
      { families: [hi("group")], columns: [hi("name"), hi("status")], roles: [role("name", "group")], outer },
    ]);
    expect(within.operations).toEqual([{ type: "group.set", columnIds: ["status", "name"] }]);
    const plain = run("group by name and status", [{ families: [hi("group")], columns: [hi("name"), hi("status")], outer }]);
    expect(plain.operations).toEqual([{ type: "group.set", columnIds: ["name", "status"] }]);
  });

  it("counts a column with a confident role answer as meant, even when its column score is low", () => {
    const plan = run("biggest first", [{ families: [hi("sort")], columns: [at("value", 0.5)], roles: [role("value", "sort", 0.92)] }]);
    expect(plan.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "desc" }] }]);
  });

  it("filters when a value is the only reading left", () => {
    const plan = run("show closed", [{ families: [at("columns.show", 0.84)] }], undefined, true);
    expect(plan.status).toBe("ready");
    expect(plan.evidence).toContainEqual({ key: "c0.only-reading", selectedId: "filter", confidence: 1, source: "deterministic" });
  });
});

describe("chassis compiler rules (ADR 0015)", () => {
  const mention = (m: Partial<Mention> & { columnId: string }): Mention => ({ clauseIndex: 0, start: 0, end: 0, ...m });
  const compileWith = (text: string, clause: Partial<ClauseResolution>, mentions: Mention[], answers?: Record<string, string>) =>
    compile({
      input: normalize(text),
      resolution: { clauses: [{ clauseIndex: 0, families: [], columns: [], values: [], unmatchedTerms: [], ...clause }] },
      schema: entitySchema,
      state: emptyViewState(entitySchema.columns.map((c) => c.id)),
      baseRevision: "r1",
      channel: "typed",
      mentions,
      ...(answers ? { answers } : {}),
      newId: (p) => `${p}_${++n}`,
    });
  const entitySchema = defineSchema(
    [
      { id: "name", kind: "string" },
      { id: "value", kind: "currency" },
      { id: "status", kind: "enum" },
    ],
    {
      columns: {
        name: { label: "Household", entity: "household" },
        status: {
          enumValues: [
            { id: "open", label: "Open" },
            { id: "closed", label: "Closed" },
            { id: "held", label: "Held" },
          ],
        },
      },
    },
  );

  it("filters on a value after the verb when it sits in a prepositional phrase", () => {
    const plan = run("sort by value for closed ones", [{ families: [hi("sort")], columns: [hi("value")] }], undefined, true);
    expect(plan.operations.map((o) => o.type)).toEqual(["filter.add", "sort.set"]);
    expect(plan.evidence).toContainEqual({ key: "c0.preposition", selectedId: "filter", confidence: 1, source: "deterministic" });
  });

  it("filters on a value after the verb when the provider's per-value answer confirms it", () => {
    const plan = run(
      "sort by value, closed ones please",
      [{ families: [hi("sort")], columns: [hi("value")], values: [{ columnId: "status", valueId: "closed", confidence: 0.9 }] }],
      undefined,
      true,
    );
    expect(plan.operations.map((o) => o.type)).toEqual(["filter.add", "sort.set"]);
    expect(plan.evidence).toContainEqual({ key: "c0.values", selectedId: "filter", confidence: 0.9, source: "provider" });
  });

  it("filters to the other approved values when a value is excluded", () => {
    const plan = compileWith("excluding closed", { families: [hi("filter")] }, [
      mention({ columnId: "status", valueId: "closed", negated: true }),
    ]);
    expect(plan.operations).toMatchObject([{ predicate: { columnId: "status", operator: "in", value: ["open", "held"] } }]);
  });

  it("asks when an entity noun means the records, and groups when the User says so", () => {
    const households = mention({ columnId: "name", ambiguous: true, text: "households", records: true });
    const asked = compileWith("largest households first", { families: [hi("sort")] }, [households]);
    expect(asked.clarifications[0]).toMatchObject({
      id: "c0.reading.name",
      prompt: "Did you mean households as a whole? GridCue can group by Household.",
      options: [{ id: "group" }, { id: "column" }],
    });
    const grouped = compileWith("largest households first", { families: [hi("sort")] }, [households], { "c0.reading.name": "group" });
    expect(grouped.operations).toEqual([{ type: "group.set", columnIds: ["name"] }]);
    const column = compileWith("largest households first", { families: [hi("sort")] }, [households], { "c0.reading.name": "column" });
    expect(column.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "name", direction: "desc" }] }]);
  });

  it("drops an ambiguous noun the provider reads as the rows, and keeps one it reads as the column", () => {
    const noun = mention({ columnId: "name", ambiguous: true, text: "household" });
    const rows = compileWith(
      "show the household",
      { families: [hi("columns.show")], readings: [{ columnId: "name", reading: "rows", confidence: 0.9 }] },
      [noun],
    );
    expect(rows.evidence).toContainEqual({ key: "dropped:c0.mention", selectedId: "name", confidence: 0.9, source: "provider" });
    const col = compileWith(
      "show the household",
      { families: [hi("columns.show")], readings: [{ columnId: "name", reading: "column", confidence: 0.9 }] },
      [noun],
    );
    expect(col.operations).toEqual([{ type: "columns.show", columnIds: ["name"] }]);
  });
});
