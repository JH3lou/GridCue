import { describe, expect, it } from "vitest";
import { GridCueError } from "../src/core/errors";
import { defineSchema, describeProviderPayload, humanize, inferKind, operatorsFor } from "../src/core/schema";

describe("defineSchema", () => {
  const schema = defineSchema([{ id: "market_value", kind: "currency" }, { id: "advisorName" }, { id: "tax_id" }, { id: "opened" }], {
    columns: { advisorName: { label: "Advisor", aliases: ["rep"] } },
    restricted: ["tax_id"],
    sampleRows: [{ opened: "2024-01-31", advisorName: "Ada" }],
  });

  it("fills labels and infers kinds from sample rows", () => {
    expect(schema.columns.map((c) => [c.id, c.label, c.kind])).toEqual([
      ["market_value", "Market value", "currency"],
      ["advisorName", "Advisor", "string"],
      ["tax_id", "Tax id", "string"],
      ["opened", "Opened", "date"],
    ]);
  });

  it("marks restricted columns unusable and unexposed", () => {
    const taxId = schema.columns.find((c) => c.id === "tax_id");
    expect(taxId).toMatchObject({ sensitivity: "restricted", exposeToProvider: false, capabilities: [] });
  });

  it("describes the provider payload without restricted columns or rows", () => {
    const payload = describeProviderPayload(schema);
    expect(payload.rows).toBe("never sent");
    expect(payload.columns.map((c) => c.id)).toEqual(["market_value", "advisorName", "opened"]);
    expect(JSON.stringify(payload)).not.toContain("Ada");
  });
});

describe("defineSchema validation", () => {
  const failsWith = (fn: () => unknown, match: string) => {
    let error: unknown;
    try {
      fn();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GridCueError);
    expect((error as GridCueError).code).toBe("INPUT_SCHEMA");
    expect((error as GridCueError).message).toContain(match);
  };

  it("rejects a restricted id that names no column", () => {
    failsWith(() => defineSchema([{ id: "tax_id" }], { restricted: ["ssn"] }), "ssn");
  });

  it("rejects a columns override id that names no column", () => {
    failsWith(() => defineSchema([{ id: "tax_id" }], { columns: { ssn: { label: "SSN" } } }), "ssn");
  });

  it("rejects duplicate column ids", () => {
    failsWith(() => defineSchema([{ id: "value" }, { id: "value" }]), "value");
  });

  it("rejects an empty column id", () => {
    failsWith(() => defineSchema([{ id: "" }]), "columns.0.id");
  });

  it("still accepts valid schemas", () => {
    expect(() =>
      defineSchema([{ id: "market_value", kind: "currency" }, { id: "tax_id" }], { restricted: ["tax_id"], columns: { tax_id: {} } }),
    ).not.toThrow();
  });
});

describe("helpers", () => {
  it("humanizes ids", () => {
    expect(humanize("unrealized_gain")).toBe("Unrealized gain");
    expect(humanize("marketValue")).toBe("Market value");
  });

  it("infers kinds conservatively", () => {
    expect(inferKind([1, 2.5])).toBe("number");
    expect(inferKind([true, false])).toBe("boolean");
    expect(inferKind(["2024-01-01T10:00:00Z"])).toBe("datetime");
    expect(inferKind([1, "x"])).toBe("string");
  });

  it("narrows operators by the host allow-list", () => {
    const [col] = defineSchema([{ id: "v", kind: "number" }], { columns: { v: { allowedOperators: ["gt", "contains"] } } }).columns;
    expect(col && operatorsFor(col)).toEqual(["gt"]);
  });
});
