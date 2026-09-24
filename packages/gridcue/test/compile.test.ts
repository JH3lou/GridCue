import { describe, expect, it } from "vitest";
import { compile } from "../src/core/compile";
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
const run = (text: string, clauses: Array<Partial<ClauseResolution>>, answers?: Record<string, string>) =>
  compile({
    input: normalize(text),
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
