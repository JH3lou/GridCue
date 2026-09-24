import { describe, expect, it, vi } from "vitest";
import { compile } from "../src/core/compile";
import { createGridCue } from "../src/core/controller";
import { normalize } from "../src/core/normalize";
import { emptyViewState } from "../src/core/protocol";
import type { IntentProvider } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

// v1 hardening (docs/planning/v1-release-grill.md, Q1): a User is never left waiting, stuck, or at a dead end.
const schema = defineSchema([{ id: "name" }, { id: "value", kind: "currency" }]);
const mock = createMockProvider({ defaultColumnForKind: { currency: "value" } });

describe("provider time limit", () => {
  it("returns to idle with the request kept when the provider takes too long", async () => {
    vi.useFakeTimers();
    try {
      const hanging: IntentProvider = {
        resolve: (_r, signal) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      };
      const cue = createGridCue({ adapter: createRowsAdapter({ schema }), provider: hanging, providerTimeoutMs: 8000 });
      const pending = cue.propose("sort by value");
      await vi.advanceTimersByTimeAsync(8000);
      expect(await pending).toBeNull();
      expect(cue.getState()).toMatchObject({
        status: "idle",
        utterance: "sort by value",
        message: "That took too long. Try again.",
        issues: [{ code: "PROVIDER_TIMEOUT" }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays silent when a newer request replaces a pending one", async () => {
    const slow: IntentProvider = { resolve: (r, signal) => new Promise((res) => setTimeout(() => res(mock.resolve(r, signal)), 20)) };
    const cue = createGridCue({ adapter: createRowsAdapter({ schema }), provider: slow });
    const first = cue.propose("sort by name");
    const second = cue.propose("sort by value");
    expect(await first).toBeNull();
    await second;
    expect(cue.getState().issues).toEqual([]);
  });
});

describe("apply and undo never stick", () => {
  for (const method of ["getCapabilities", "getDefaultState"] as const) {
    it(`reports an error instead of staying on "applying" when ${method} throws`, async () => {
      const adapter = createRowsAdapter({ schema });
      const cue = createGridCue({ adapter, provider: mock });
      await cue.propose("sort by value");
      (adapter as unknown as Record<string, unknown>)[method] = () => {
        throw new Error("boom");
      };
      expect(await cue.apply()).toBe(false);
      expect(cue.getState()).toMatchObject({ status: "error", issues: [{ code: "ADAPTER_FAILED" }] });
    });
  }

  it("restores the previous view when a write throws part-way", async () => {
    const adapter = createRowsAdapter({ schema });
    const cue = createGridCue({ adapter, provider: mock });
    const before = adapter.getState().state;
    await cue.propose("sort by value");
    const realApply = adapter.apply.bind(adapter);
    adapter.apply = async (plan) => {
      await realApply(plan);
      throw new Error("half-written");
    };
    expect(await cue.apply()).toBe(false);
    expect(adapter.getState().state).toEqual(before);
    expect(cue.getState()).toMatchObject({ status: "error", message: "The grid couldn't apply that change. The previous view is back." });
  });

  it("reports an error instead of throwing when undo can't read the grid", async () => {
    const adapter = createRowsAdapter({ schema });
    const cue = createGridCue({ adapter, provider: mock });
    await cue.propose("sort by value");
    await cue.apply();
    adapter.getState = () => {
      throw new Error("boom");
    };
    expect(await cue.undo()).toBe(false);
    expect(cue.getState()).toMatchObject({ status: "error", issues: [{ code: "ADAPTER_FAILED" }] });
  });
});

describe("a 'No' never dead-ends", () => {
  it("ends with a clear 'nothing will change' when the User declines the only change", () => {
    const plan = compile({
      input: normalize("tidy up"),
      resolution: {
        clauses: [{ clauseIndex: 0, families: [{ id: "view.reset", confidence: 0.8 }], columns: [], values: [], unmatchedTerms: [] }],
      },
      schema,
      state: emptyViewState(["name", "value"]),
      baseRevision: "r1",
      channel: "typed",
      answers: { "c0.family.view.reset": "none" },
      newId: (p) => p,
    });
    expect(plan.clarifications).toEqual([
      { id: "c0.declined", prompt: "Okay, nothing will change. Rephrase or edit your request.", required: true },
    ]);
  });
});
