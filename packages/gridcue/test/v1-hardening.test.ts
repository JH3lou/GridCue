import {
  columnFilteringFeature,
  columnGroupingFeature,
  columnOrderingFeature,
  columnVisibilityFeature,
  constructTable,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import { describe, expect, it, vi } from "vitest";
import type { GridAdapter } from "../src/core/adapter";
import { compile } from "../src/core/compile";
import { createGridCue } from "../src/core/controller";
import { normalize } from "../src/core/normalize";
import { emptyViewState } from "../src/core/protocol";
import type { IntentProvider } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { resultingState } from "../src/core/validate";
import { createMockProvider } from "../src/mock";
import { createTanStackAdapter, gridcueFilterFn, type TanStackTableLike } from "../src/tanstack";

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

  it("gives up on a provider that never settles and ignores cancellation", async () => {
    vi.useFakeTimers();
    try {
      const deaf: IntentProvider = { resolve: () => new Promise(() => {}) };
      const cue = createGridCue({ adapter: createRowsAdapter({ schema }), provider: deaf, providerTimeoutMs: 8000 });
      const pending = cue.propose("sort by value");
      await vi.advanceTimersByTimeAsync(8000);
      expect(await pending).toBeNull();
      expect(cue.getState()).toMatchObject({ status: "idle", utterance: "sort by value", issues: [{ code: "PROVIDER_TIMEOUT" }] });
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

  // The recovery after a write that throws, on both first-release adapters.
  const tanstackAdapter = (): GridAdapter => {
    const table = constructTable({
      features: tableFeatures({
        coreReactivityFeature: storeReactivityBindings(),
        columnFilteringFeature,
        rowSortingFeature,
        columnGroupingFeature,
        columnVisibilityFeature,
        columnOrderingFeature,
      }),
      data: [],
      defaultColumn: { filterFn: gridcueFilterFn },
      columns: [{ accessorKey: "name" }, { accessorKey: "value" }],
    } as never) as unknown as TanStackTableLike;
    return createTanStackAdapter({ schema, table });
  };
  const adapters: Array<[string, () => GridAdapter]> = [
    ["Rows Adapter", () => createRowsAdapter({ schema })],
    ["TanStack Table adapter", tanstackAdapter],
  ];
  for (const [name, makeAdapter] of adapters) {
    describe(name, () => {
      it("restores the previous view when a write throws part-way", async () => {
        const adapter = makeAdapter();
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
        expect(cue.getState()).toMatchObject({
          status: "error",
          message: "The grid couldn't apply that change. The previous view is back.",
        });
      });

      it("restores the previous view when a write stops between parts", async () => {
        const adapter = makeAdapter();
        const cue = createGridCue({ adapter, provider: mock });
        const before = adapter.getState().state;
        await cue.propose("sort by value, hide name");
        expect(cue.getState().status).toBe("ready");
        adapter.apply = async (plan) => {
          // The write got as far as the plan's sort, then failed before hiding the column.
          const now = adapter.getState();
          await adapter.restore({ ...now, state: { ...now.state, sorts: resultingState(plan).sorts } });
          throw new Error("half-written");
        };
        expect(await cue.apply()).toBe(false);
        expect(adapter.getState().state).toEqual(before);
        expect(cue.getState().message).toBe("The grid couldn't apply that change. The previous view is back.");
      });

      it("leaves the view alone when a part the plan writes holds a value the plan didn't write", async () => {
        const adapter = makeAdapter();
        const cue = createGridCue({ adapter, provider: mock });
        await cue.propose("sort by value");
        adapter.apply = async () => {
          // The User sorts by name before the write lands. That sort is a newer change, not the plan's.
          const now = adapter.getState();
          await adapter.restore({ ...now, state: { ...now.state, sorts: [{ columnId: "name", direction: "asc" }] } });
          throw new Error("half-written");
        };
        expect(await cue.apply()).toBe(false);
        expect(adapter.getState().state.sorts).toEqual([{ columnId: "name", direction: "asc" }]);
        expect(cue.getState().message).toBe(
          "The grid couldn't apply that change, and the view changed meanwhile, so GridCue left it as it is.",
        );
      });

      it("leaves the view alone when a newer change landed before recovery", async () => {
        const adapter = makeAdapter();
        const cue = createGridCue({ adapter, provider: mock });
        await cue.propose("sort by value");
        const realApply = adapter.apply.bind(adapter);
        adapter.apply = async (plan) => {
          await realApply(plan);
          // Someone else hides a column before GridCue can recover.
          const now = adapter.getState();
          await adapter.restore({ ...now, state: { ...now.state, visibleColumnIds: ["value"] } });
          throw new Error("half-written");
        };
        expect(await cue.apply()).toBe(false);
        expect(adapter.getState().state.visibleColumnIds).toEqual(["value"]);
        expect(cue.getState().message).toBe(
          "The grid couldn't apply that change, and the view changed meanwhile, so GridCue left it as it is.",
        );
      });
    });
  }

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

  it("keeps an independent question when the User declines something else in the same part", () => {
    const plan = compile({
      input: normalize("only value over 1.000.000"),
      resolution: {
        clauses: [
          {
            clauseIndex: 0,
            families: [
              { id: "filter", confidence: 0.95 },
              { id: "sort", confidence: 0.7 },
            ],
            columns: [{ id: "value", confidence: 0.95 }],
            values: [],
            unmatchedTerms: [],
          },
        ],
      },
      schema,
      state: emptyViewState(["name", "value"]),
      baseRevision: "r1",
      channel: "typed",
      answers: { "c0.family.sort": "none" },
      newId: (p) => p,
    });
    expect(plan.clarifications.map((q) => q.id)).toEqual(["c0.literal0.number"]);
  });
});
