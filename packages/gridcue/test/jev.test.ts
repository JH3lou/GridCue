import { describe, expect, it } from "vitest";
import { defineSchema } from "../src/core/schema";
import { buildResolutionRequest, emptyViewState, normalize } from "../src/index";
import { createJevProvider, type JevClient } from "../src/server/jev";

const schema = defineSchema([{ id: "value", label: "Market value", kind: "currency" }, { id: "status", kind: "enum" }, { id: "tax_id" }], {
  restricted: ["tax_id"],
  columns: { status: { enumValues: [{ id: "open", label: "Open" }] } },
});
const caps = { operations: ["filter.add", "sort.set"], supportsAtomicApply: true, supportsSnapshotRestore: true, observesChanges: true };
const request = buildResolutionRequest(normalize("open accounts over $1m"), schema, caps, emptyViewState(["value", "status", "tax_id"]));

const fakeClient = (answer: (name: string) => unknown, seen: { questions?: Record<string, unknown>; state?: unknown } = {}): JevClient => ({
  async systemOne(req) {
    seen.questions = req.questions;
    seen.state = req.state;
    return { answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, answer(k)])) };
  },
});

describe("createJevProvider", () => {
  it("asks closed questions and maps answers to candidate IDs", async () => {
    const seen: { questions?: Record<string, unknown>; state?: unknown } = {};
    const provider = createJevProvider({
      client: fakeClient((k) => {
        if (k === "c0_f0") return { noul: 0.93 }; // filter
        if (k.endsWith("_col0")) return { noul: 0.91 }; // value
        if (k.includes("_f") || k.includes("_col")) return { noul: 0.02 };
        if (k === "c0_val1") return { choice: "open", confidence: 0.97, probabilities: {} };
        return { choice: "none", confidence: 0.9, probabilities: {} };
      }, seen),
    });
    const result = await provider.resolve(request);
    expect(result.clauses[0]).toMatchObject({
      families: [{ id: "filter", confidence: 0.93 }],
      columns: [{ id: "value", confidence: 0.91 }],
      values: [{ columnId: "status", valueId: "open", confidence: 0.97 }],
    });
    expect(JSON.stringify(seen)).not.toContain("tax_id");
    expect(seen.state).toMatchObject({ clauses: [{ text: "open accounts over $1m" }] });
    expect(JSON.stringify(seen.questions?.c0_col0)).toContain("`clauses[0].text`");
  });

  it("treats unknown choices as malformed", async () => {
    const provider = createJevProvider({
      client: fakeClient((k) => (k.includes("_val") ? { choice: "closed", confidence: 1 } : { noul: 0.1 })),
    });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_MALFORMED" });
  });

  it("wraps transport errors", async () => {
    const provider = createJevProvider({
      client: {
        systemOne: async () => {
          throw new Error("boom");
        },
      },
    });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
  });

  it("refuses oversized question sets", async () => {
    const provider = createJevProvider({ client: fakeClient(() => ({ noul: 0 })), maxQuestions: 3 });
    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_TOO_COMPLEX" });
  });
});
