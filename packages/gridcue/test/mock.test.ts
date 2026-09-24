import { describe, expect, it } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { normalize } from "../src/core/normalize";
import { emptyViewState } from "../src/core/protocol";
import { buildResolutionRequest } from "../src/core/resolution";
import { defineSchema } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

const schema = defineSchema(
  [
    { id: "acct", label: "Account", kind: "string" },
    { id: "value", label: "Value", kind: "currency" },
    { id: "status", label: "Status", kind: "enum" },
    { id: "flagged", label: "Flagged", kind: "boolean" },
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
const caps = {
  operations: ["filter.add", "filter.clear", "sort.set", "group.set", "columns.show", "columns.hide", "columns.order", "view.reset"],
  supportsAtomicApply: true,
  supportsSnapshotRestore: true,
  observesChanges: true,
};
const provider = createMockProvider({ defaultColumnForKind: { currency: "value" } });
const resolve = async (text: string) =>
  (await provider.resolve(buildResolutionRequest(normalize(text), schema, caps, emptyViewState(schema.columns.map((c) => c.id))))).clauses;

describe("mock provider", () => {
  it("picks enum values and a default column for a bare amount", async () => {
    const [clause] = await resolve("open accounts over $5,000");
    expect(clause?.families.map((f) => f.id)).toEqual(["filter"]);
    expect(clause?.values).toEqual([{ columnId: "status", valueId: "open", confidence: 0.95 }]);
    expect(clause?.columns.map((c) => c.id)).toContain("value");
  });

  it("reads negated booleans", async () => {
    const [clause] = await resolve("show accounts that are not flagged");
    expect(clause?.values).toEqual([{ columnId: "flagged", valueId: "false", confidence: 0.9 }]);
  });

  it("flags workflow actions as unsupported", async () => {
    const [, second] = await resolve("show flagged accounts, then sell them");
    expect(second?.families.map((f) => f.id)).toEqual(["unsupported.workflow_action"]);
  });

  it("reports unknown column names instead of guessing", async () => {
    const [clause] = await resolve("sort by risk score");
    expect(clause?.columns).toEqual([]);
    expect(clause?.unmatchedTerms).toEqual(["risk score"]);
  });

  it("returns no family for vague requests", async () => {
    const [clause] = await resolve("make it look better");
    expect(clause?.families).toEqual([]);
  });

  it("detects several clears in one clause", async () => {
    const [clause] = await resolve("clear the filters and sorting");
    expect(clause?.families.map((f) => f.id)).toEqual(["filter.clear", "sort.clear"]);
  });
});

describe("Mock Provider fan-out answers", () => {
  it("gives a role to a column named right after its verb, and an add-a-level answer for 'also'", async () => {
    const schema = defineSchema([{ id: "name" }, { id: "value", kind: "currency" }]);
    const caps = { operations: [...MVP_OPERATIONS], supportsAtomicApply: true, supportsSnapshotRestore: true, observesChanges: true };
    const req = buildResolutionRequest(normalize("also sort by value"), schema, caps, emptyViewState(["name", "value"]));
    const [clause] = (await createMockProvider().resolve(req)).clauses;
    expect(clause?.roles).toEqual([{ columnId: "value", family: "sort", confidence: 0.95 }]);
    expect(clause?.adds).toBe(0.95);
  });
});
