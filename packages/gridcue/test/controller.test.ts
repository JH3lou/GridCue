import { describe, expect, it, vi } from "vitest";
import { createGridCue } from "../src/core/controller";
import type { AuditEvent } from "../src/core/preview";
import type { IntentProvider } from "../src/core/resolution";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { createMockProvider } from "../src/mock";

const schema = defineSchema([{ id: "name" }, { id: "value", kind: "currency" }, { id: "gain", kind: "currency" }, { id: "tax_id" }], {
  restricted: ["tax_id"],
});
const setup = (provider: IntentProvider = createMockProvider({ defaultColumnForKind: { currency: "value" } })) => {
  const adapter = createRowsAdapter({ schema });
  const events: AuditEvent[] = [];
  const cue = createGridCue({ adapter, provider, audit: { onEvent: (e) => events.push(e) } });
  return { adapter, cue, events };
};

describe("controller", () => {
  it("previews, applies, and undoes", async () => {
    const { adapter, cue, events } = setup();
    const before = adapter.getState().state;
    await cue.propose("show accounts over $1m, sort by value largest first");
    expect(cue.getState().status).toBe("ready");
    expect(cue.getState().preview?.text).toBe("Filter Value above $1,000,000; sort by Value, descending. No records will be changed.");
    expect(adapter.getState().state).toEqual(before);
    expect(await cue.apply()).toBe(true);
    expect(adapter.getState().state.sorts).toEqual([{ columnId: "value", direction: "desc" }]);
    expect(cue.getState().canUndo).toBe(true);
    expect(await cue.undo()).toBe(true);
    expect(adapter.getState().state).toEqual(before);
    expect(events.map((e) => e.outcome)).toEqual(["applied", "undone"]);
    expect(JSON.stringify(events)).not.toContain("accounts");
  });

  it("cancel changes nothing and ignores a late provider answer", async () => {
    let release: (v: unknown) => void = () => {};
    const slow: IntentProvider = {
      resolve: () =>
        new Promise((r) => {
          release = r;
        }) as never,
    };
    const { adapter, cue } = setup(slow);
    const before = adapter.getState();
    const pending = cue.propose("sort by value");
    expect(cue.getState().status).toBe("resolving");
    cue.cancel();
    release({ clauses: [] });
    expect(await pending).toBeNull();
    expect(cue.getState()).toMatchObject({ status: "idle", utterance: "sort by value" });
    expect(adapter.getState()).toEqual(before);
  });

  it("refuses to apply after a manual change", async () => {
    const { adapter, cue } = setup();
    await cue.propose("sort by value");
    adapter.setState((s) => ({ ...s, sorts: [{ columnId: "name", direction: "asc" }] }));
    expect(await cue.apply()).toBe(false);
    expect(cue.getState().issues[0]?.code).toBe("PLAN_STALE_REVISION");
    expect(adapter.getState().state.sorts).toEqual([{ columnId: "name", direction: "asc" }]);
  });

  it("refuses to undo over newer manual changes", async () => {
    const { adapter, cue } = setup();
    await cue.propose("sort by value");
    await cue.apply();
    adapter.setState((s) => ({ ...s, groupBy: ["name"] }));
    expect(cue.getState().canUndo).toBe(false);
    expect(await cue.undo()).toBe(false);
    expect(adapter.getState().state.groupBy).toEqual(["name"]);
  });

  it("applies once even when apply is pressed twice", async () => {
    const { adapter, cue } = setup();
    const spy = vi.spyOn(adapter, "apply");
    await cue.propose("sort by value");
    await Promise.all([cue.apply(), cue.apply()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("resolves a clarification and then applies", async () => {
    const { cue } = setup(createMockProvider());
    await cue.propose("over $1m");
    expect(cue.getState().status).toBe("needs_clarification");
    cue.answer("c0.literal0.column", "gain");
    expect(cue.getState().status).toBe("ready");
    expect(await cue.apply()).toBe(true);
  });

  it("rejects an answer whose option was never offered", async () => {
    const { cue } = setup(createMockProvider());
    await cue.propose("over $1m");
    const before = cue.getState();
    expect(cue.answer("c0.literal0.column", "concentration")).toBeNull();
    expect(cue.getState()).toBe(before);
    expect(cue.getState().status).toBe("needs_clarification");
  });

  it("rejects an answer to a clarification id that was never offered", async () => {
    const { cue } = setup(createMockProvider());
    await cue.propose("over $1m");
    const before = cue.getState();
    expect(cue.answer("not-a-real-clarification-id", "gain")).toBeNull();
    expect(cue.getState()).toBe(before);
    expect(cue.getState().status).toBe("needs_clarification");
  });

  it("undoes the plan that was applied, not a later proposal", async () => {
    const { cue, events } = setup();
    await cue.propose("sort by value");
    const appliedPlanId = cue.getState().plan?.id;
    expect(await cue.apply()).toBe(true);
    await cue.propose("sort by name");
    expect(cue.getState().status).toBe("ready");
    expect(await cue.undo()).toBe(true);
    const undone = events.find((e) => e.outcome === "undone");
    expect(undone?.planId).toBe(appliedPlanId);
  });

  it("still audits the applied plan on undo when a later proposal fails", async () => {
    const { cue, events } = setup();
    await cue.propose("sort by value");
    const appliedPlanId = cue.getState().plan?.id;
    expect(await cue.apply()).toBe(true);
    await cue.propose("x".repeat(501));
    expect(cue.getState().status).toBe("error");
    expect(cue.getState().plan).toBeNull();
    expect(await cue.undo()).toBe(true);
    const undone = events.find((e) => e.outcome === "undone");
    expect(undone?.planId).toBe(appliedPlanId);
  });

  it("never applies a mixed request", async () => {
    const { cue } = setup();
    await cue.propose("sort by value, then sell everything");
    expect(cue.getState().status).toBe("unsupported");
    expect(await cue.apply()).toBe(false);
  });

  it("refuses restricted columns without calling the provider", async () => {
    const provider = { resolve: vi.fn() };
    const { cue } = setup(provider);
    await cue.propose("show the tax id column");
    expect(provider.resolve).not.toHaveBeenCalled();
    expect(cue.getState().status).toBe("unsupported");
  });

  it("keeps only the latest request when submissions overlap", async () => {
    const releases: Array<() => void> = [];
    const provider = createMockProvider();
    const slow: IntentProvider = {
      resolve: (req, signal) =>
        new Promise((resolve) => {
          releases.push(() => resolve(provider.resolve(req, signal)));
        }),
    };
    const { cue } = setup(slow);
    const first = cue.propose("sort by name");
    const second = cue.propose("sort by value");
    releases[1]?.();
    await second;
    releases[0]?.();
    expect(await first).toBeNull();
    expect(cue.getState().preview?.lines).toEqual(["Sort by Value, ascending"]);
  });

  it("asks for fewer steps when a request has too many clauses", async () => {
    const provider = { resolve: vi.fn() };
    const { cue } = setup(provider);
    await cue.propose(Array.from({ length: 13 }, (_, i) => `sort by value ${i}`).join("; "));
    expect(cue.getState().issues[0]?.code).toBe("INPUT_TOO_COMPLEX");
    expect(provider.resolve).not.toHaveBeenCalled();
  });

  it("keeps the view when the provider fails", async () => {
    const { adapter, cue } = setup({
      resolve: async () => {
        throw new Error("down");
      },
    });
    const before = adapter.getState();
    await cue.propose("sort by value");
    expect(cue.getState()).toMatchObject({ status: "error", utterance: "sort by value" });
    expect(adapter.getState()).toEqual(before);
  });

  it("rejects malformed provider output", async () => {
    const { cue } = setup({ resolve: async () => ({ clauses: [{ nonsense: true }] }) as never });
    await cue.propose("sort by value");
    expect(cue.getState().issues[0]?.code).toBe("PROVIDER_MALFORMED");
  });

  it("reports foreign provider error codes as PROVIDER_FAILED", async () => {
    const { cue } = setup({
      resolve: async () => {
        throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      },
    });
    await cue.propose("sort by value");
    expect(cue.getState().issues[0]?.code).toBe("PROVIDER_FAILED");
  });
});
