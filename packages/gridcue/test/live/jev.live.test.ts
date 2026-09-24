import { describe, expect, it } from "vitest";
import { buildResolutionRequest, defineSchema, emptyViewState, normalize } from "../../src/index";
import { createJevProvider } from "../../src/server";

const apiKey = process.env.JEV_API_KEY;

describe.skipIf(!apiKey)("Jev (live)", () => {
  it("resolves a sort request against real Jev", { timeout: 30_000 }, async () => {
    const schema = defineSchema([
      { id: "market_value", label: "Market value", kind: "currency" },
      { id: "advisor_name", label: "Advisor", kind: "string" },
    ]);
    const caps = { operations: ["sort.set", "group.set"], supportsAtomicApply: true, supportsSnapshotRestore: true, observesChanges: true };
    const request = buildResolutionRequest(
      normalize("sort by market value, largest first"),
      schema,
      caps,
      emptyViewState(["market_value", "advisor_name"]),
    );
    const [clause] = (await createJevProvider({ apiKey }).resolve(request)).clauses;
    expect(clause?.families.map((f) => f.id)).toContain("sort");
    expect(clause?.columns[0]?.id).toBe("market_value");
  });
});
