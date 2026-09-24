import { describe, expect, it } from "vitest";
import { normalize } from "../src/core/normalize";
import { screenRestricted } from "../src/core/policy";
import { emptyViewState } from "../src/core/protocol";
import { buildCandidates, buildResolutionRequest } from "../src/core/resolution";
import { defineSchema } from "../src/core/schema";
import { findMentions } from "../src/core/text-match";

const schema = defineSchema([{ id: "account_number" }, { id: "market_value", kind: "currency" }, { id: "tax_id" }], {
  restricted: ["tax_id"],
  columns: { tax_id: { aliases: ["ssn"] }, market_value: { capabilities: ["filter", "sort"] } },
});
const caps = {
  operations: ["filter.add", "filter.clear", "sort.set", "group.set", "columns.show", "columns.hide", "columns.order", "view.reset"],
  supportsAtomicApply: true,
  supportsSnapshotRestore: true,
  observesChanges: true,
};

describe("buildCandidates", () => {
  const candidates = buildCandidates(schema, caps);

  it("offers only exposed columns", () => {
    expect(candidates.columns.map((c) => c.id)).toEqual(["account_number", "market_value"]);
  });

  it("limits each column's families to its capabilities", () => {
    expect(candidates.columns.find((c) => c.id === "market_value")?.families).toEqual(["filter", "sort"]);
  });

  it("always offers the unsupported escape families", () => {
    expect(candidates.families).toContain("unsupported.workflow_action");
  });

  it("drops families the adapter cannot perform", () => {
    const narrow = buildCandidates(schema, { ...caps, operations: ["sort.set"] });
    expect(narrow.families.filter((f) => !f.startsWith("unsupported"))).toEqual(["sort", "sort.clear"]);
  });
});

describe("buildResolutionRequest", () => {
  it("never includes restricted columns or rows", () => {
    const request = buildResolutionRequest(
      normalize("sort by market value"),
      schema,
      caps,
      emptyViewState(["account_number", "market_value", "tax_id"]),
    );
    expect(JSON.stringify(request.candidates)).not.toContain("tax_id");
  });
});

describe("screenRestricted", () => {
  it("finds restricted labels and aliases, including plurals", () => {
    expect(screenRestricted(normalize("show the SSNs"), schema)).toEqual([{ clauseIndex: 0, columnId: "tax_id" }]);
    expect(screenRestricted(normalize("sort by tax id"), schema)).toHaveLength(1);
    expect(screenRestricted(normalize("sort by market value"), schema)).toEqual([]);
  });

  it("finds restricted labels through punctuation variants", () => {
    expect(screenRestricted(normalize("show tax-id"), schema)).toEqual([{ clauseIndex: 0, columnId: "tax_id" }]);
    expect(screenRestricted(normalize("show tax_id"), schema)).toEqual([{ clauseIndex: 0, columnId: "tax_id" }]);
    expect(screenRestricted(normalize("show taxid"), schema)).toEqual([{ clauseIndex: 0, columnId: "tax_id" }]);
    expect(screenRestricted(normalize("show Tax  ID"), schema)).toEqual([{ clauseIndex: 0, columnId: "tax_id" }]);
  });

  it("keeps whole-word boundaries so a longer word is not a false match", () => {
    expect(screenRestricted(normalize("show taxidermy"), schema)).toEqual([]);
  });
});

describe("findMentions", () => {
  it("prefers the longest overlapping name", () => {
    const hits = findMentions("hide custodian and account number", [
      { item: "acct", names: ["account"] },
      { item: "acct_no", names: ["account number"] },
      { item: "cust", names: ["custodian"] },
    ]);
    expect(hits.map((h) => h.item)).toEqual(["cust", "acct_no"]);
  });
});
