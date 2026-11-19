import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MVP_OPERATIONS } from "../src/core/adapter";
import { createGridCue } from "../src/core/controller";
import { isGridCueError } from "../src/core/errors";
import type { VersionedViewState, ViewOperation, ViewPlan } from "../src/core/protocol";
import { createQueryAdapter, type QueryAdapterOptions } from "../src/core/query-adapter";
import { createRowsAdapter } from "../src/core/rows-adapter";
import { defineSchema } from "../src/core/schema";
import { validatePlan } from "../src/core/validate";
import * as root from "../src/index";
import { createMockProvider } from "../src/mock";
import { DATED_COLUMNS, DATED_ROWS, type RenderName, runAdapterContract } from "./adapter-contract";

// The Query Adapter (more grids spec, 5.4; ADR 0032): it holds the View State for a Host whose rows come from its own
// Data Query, and lists only what that Data Query can carry out.
const schema = defineSchema(
  [
    { id: "account", label: "Account" },
    { id: "advisor", label: "Advisor" },
    { id: "custodian", label: "Custodian" },
    { id: "type", label: "Registration type" },
    { id: "value", label: "Market value", kind: "currency" as const },
  ],
  {
    rowNoun: "account",
    columns: {
      value: { aliases: ["value"] },
      custodian: {
        kind: "enum",
        enumValues: [
          { id: "northgate", label: "Northgate" },
          { id: "harborline", label: "Harborline" },
        ],
      },
      type: {
        kind: "enum",
        enumValues: [
          { id: "taxable", label: "Taxable" },
          { id: "trust", label: "Trust" },
        ],
      },
    },
  },
);
const provider = createMockProvider({ defaultColumnForKind: { currency: "value" } });

const configError = (options: Record<string, unknown>) => {
  try {
    createQueryAdapter({ schema, ...options } as unknown as QueryAdapterOptions);
  } catch (error) {
    return isGridCueError(error) ? { code: error.code, message: error.message } : { code: "other", message: String(error) };
  }
  return undefined;
};

const planFor = (current: VersionedViewState, operations: ViewOperation[]): ViewPlan => ({
  protocolVersion: "0.1",
  id: `p_${Math.random()}`,
  baseRevision: current.revision,
  source: { channel: "api" },
  status: "ready",
  operations,
  evidence: [],
  clarifications: [],
  unsupportedSegments: [],
});

const validated = (adapter: ReturnType<typeof createQueryAdapter>, operations: ViewOperation[]) => {
  const result = validatePlan(planFor(adapter.getState(), operations), {
    schema: adapter.getSchema(),
    capabilities: adapter.getCapabilities(),
    current: adapter.getState(),
    defaultState: adapter.getDefaultState(),
  });
  if (!result.ok) throw new Error(result.issues.map((i) => i.code).join(","));
  return result.plan;
};

const valueDesc = { columnId: "value", direction: "desc" } as const;
const byValue: ViewOperation = { type: "sort.set", sorts: [valueDesc] };

describe("Query Adapter: the operations it lists", () => {
  it("lists the MVP operations and no count by default", () => {
    const operations = createQueryAdapter({ schema }).getCapabilities().operations;
    expect(operations).toEqual([...MVP_OPERATIONS]);
    expect(operations).not.toContain("limit.set");
  });

  it("lists limit.set only when the Host's server sorts and cuts before paging", () => {
    expect(createQueryAdapter({ schema, countBeforePaging: true }).getCapabilities().operations).toEqual([...MVP_OPERATIONS, "limit.set"]);
    expect(createQueryAdapter({ schema, countBeforePaging: false }).getCapabilities().operations).toEqual([...MVP_OPERATIONS]);
  });

  it("takes out each operation `without` names, and nothing else", () => {
    expect(createQueryAdapter({ schema, without: ["group.set"] }).getCapabilities().operations).toEqual(
      MVP_OPERATIONS.filter((op) => op !== "group.set"),
    );
    expect(createQueryAdapter({ schema, without: ["columns.order", "group.set", "group.set"] }).getCapabilities().operations).toEqual(
      MVP_OPERATIONS.filter((op) => op !== "group.set" && op !== "columns.order"),
    );
    expect(createQueryAdapter({ schema, without: [] }).getCapabilities().operations).toEqual([...MVP_OPERATIONS]);
  });

  it("removes with `without` and adds the count with countBeforePaging, together", () => {
    expect(createQueryAdapter({ schema, without: ["group.set"], countBeforePaging: true }).getCapabilities().operations).toEqual([
      ...MVP_OPERATIONS.filter((op) => op !== "group.set"),
      "limit.set",
    ]);
  });

  it("can only remove: `without` never adds an operation", () => {
    for (const without of [["filter.add"], ["view.reset", "sort.set"]]) {
      const operations = createQueryAdapter({ schema, without }).getCapabilities().operations;
      expect(operations.every((op) => MVP_OPERATIONS.includes(op))).toBe(true);
      expect(operations).toHaveLength(MVP_OPERATIONS.length - without.length);
    }
  });

  it("hands out operations the caller can't use to change what it lists", () => {
    const adapter = createQueryAdapter({ schema });
    adapter.getCapabilities().operations.push("limit.set");
    expect(adapter.getCapabilities().operations).not.toContain("limit.set");
  });
});

describe("Query Adapter: a bad `without` throws INPUT_CONFIG, naming it", () => {
  it("a typo", () => {
    expect(configError({ without: ["group.sett"] })).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("“group.sett”"),
    });
    expect(configError({ without: ["Group.set"] })).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("“Group.set”"),
    });
    expect(configError({ without: ["group.set", "sort"] })).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("“sort”"),
    });
  });

  it("a name the Query Adapter doesn't list", () => {
    for (const name of ["limit.set", "aggregation.set", "columns.pin", "density.set", "cells.edit"]) {
      expect(configError({ without: [name] }), name).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining(`“${name}”`) });
    }
  });

  it("limit.set, even with countBeforePaging: the count is turned off by leaving that out", () => {
    expect(configError({ without: ["limit.set"], countBeforePaging: true })).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("countBeforePaging"),
    });
  });

  it("a name that isn't text", () => {
    expect(configError({ without: [3] })).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("3") });
    expect(configError({ without: [null] })).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("null") });
    expect(configError({ without: [{ op: "group.set" }] })).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("group.set"),
    });
  });

  it("a name no message can quote as it is: a bigint, an object with no prototype, an object that holds itself", () => {
    expect(configError({ without: [1n] })).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("1n") });
    const bare = Object.assign(Object.create(null), { op: "group.set" });
    expect(configError({ without: [bare] })).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("group.set") });
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(configError({ without: [loop] })).toMatchObject({ code: "INPUT_CONFIG" });
    expect(configError({ renders: [1n] })).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("1n") });
    expect(configError({ renders: [Object.create(null)] })).toMatchObject({ code: "INPUT_CONFIG" });
    expect(configError({ countBeforePaging: 1n })).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("1n") });
  });

  it("a `without` that isn't a list", () => {
    expect(configError({ without: "group.set" })).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("without") });
  });

  it("a countBeforePaging that isn't true or false", () => {
    expect(configError({ countBeforePaging: "false" })).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("countBeforePaging"),
    });
  });

  it("a starting view with a count the grid can't keep", () => {
    const withCount = { ...createQueryAdapter({ schema }).getDefaultState(), sorts: [{ columnId: "value", direction: "desc" }], limit: 10 };
    expect(configError({ initialState: withCount })).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("count") });
    expect(configError({ initialState: withCount, countBeforePaging: true })).toBeUndefined();
  });

  it("a starting view with no count, written as a count of null, is no count", () => {
    expect(configError({ initialState: { ...createQueryAdapter({ schema }).getDefaultState(), limit: null } })).toBeUndefined();
  });
});

// A Query Adapter's View State never holds what the adapter lists no operation for, of the parts only an opt-in
// operation sets: a count without countBeforePaging, totals ever, pins without “pinning” and a density without
// “density”. The Host's Data Query would never carry it out, and no request could clear it.
describe("Query Adapter: it never holds what it doesn't list", () => {
  const start = () => createQueryAdapter({ schema }).getDefaultState();
  const parts = {
    "a count": { sorts: [{ columnId: "value", direction: "desc" as const }], limit: 10 },
    totals: { aggregations: [{ columnId: "value", function: "sum" as const }] },
    "pinned columns": { pinnedColumnIds: { start: ["advisor"], end: [] } },
    "a density": { density: "compact" as const },
  };
  const turnedOn = {
    "a count": { countBeforePaging: true },
    totals: undefined,
    "pinned columns": { renders: ["pinning"] },
    "a density": { renders: ["density"] },
  } as const;

  for (const [name, part] of Object.entries(parts) as Array<[keyof typeof parts, (typeof parts)[keyof typeof parts]]>) {
    it(`refuses ${name} in the starting view, unless it lists the operation`, () => {
      expect(configError({ initialState: { ...start(), ...part } })).toMatchObject({ code: "INPUT_CONFIG" });
      const on = turnedOn[name];
      if (on) expect(configError({ initialState: { ...start(), ...part }, ...on })).toBeUndefined();
    });

    it(`refuses ${name} from setState, unless it lists the operation, and leaves the view and its Revision as they were`, () => {
      const adapter = createQueryAdapter({ schema });
      const before = adapter.getState();
      let calls = 0;
      adapter.subscribe(() => calls++);
      let thrown: unknown;
      try {
        adapter.setState((s) => ({ ...s, ...part }));
      } catch (error) {
        thrown = error;
      }
      expect(isGridCueError(thrown) && thrown.code).toBe("INPUT_CONFIG");
      expect(adapter.getState()).toEqual(before);
      expect(calls).toBe(0);
      const on = turnedOn[name];
      if (!on) return;
      const listing = createQueryAdapter({ schema, ...(on as Partial<QueryAdapterOptions>) });
      expect(listing.setState((s) => ({ ...s, ...part })).state).toMatchObject(part);
    });

    it(`refuses to restore a snapshot holding ${name}, unless it lists the operation`, async () => {
      const adapter = createQueryAdapter({ schema });
      const before = adapter.getState();
      let calls = 0;
      adapter.subscribe(() => calls++);
      expect(await adapter.restore({ revision: "elsewhere:3", state: { ...start(), ...part } })).toMatchObject({
        ok: false,
        code: "ADAPTER_NOT_APPLICABLE",
      });
      expect(adapter.getState()).toEqual(before);
      expect(calls).toBe(0);
      const on = turnedOn[name];
      if (!on) return;
      const listing = createQueryAdapter({ schema, ...(on as Partial<QueryAdapterOptions>) });
      expect(await listing.restore({ revision: "elsewhere:3", state: { ...start(), ...part } })).toMatchObject({ ok: true });
    });
  }

  it("takes a count of null, and the comfortable density, from setState and restore", async () => {
    const adapter = createQueryAdapter({ schema });
    // The type has no null count, but a Host's saved view may hold one, and it means no count.
    const none = null as unknown as undefined;
    expect(adapter.setState((s) => ({ ...s, limit: none, density: "comfortable" })).revision).toBe("query:1");
    expect(await adapter.restore({ revision: "query:0", state: { ...start(), limit: none } })).toMatchObject({ ok: true });
  });
});

describe("Query Adapter: the Host's subscribers", () => {
  // A subscriber's error is reported as an event listener's is. Where the runtime has no `reportError`, it is thrown
  // on its own in a microtask; these tests stand one in, so they can see it.
  const reported: unknown[] = [];
  beforeEach(() => {
    reported.length = 0;
    vi.stubGlobal("reportError", (error: unknown) => reported.push(error));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a subscriber that throws, such as a Data Query that fails at once, stops neither the write nor the others", async () => {
    const adapter = createQueryAdapter({ schema });
    const failure = new Error("the Host's fetch failed");
    adapter.subscribe(() => {
      throw failure;
    });
    const later: string[] = [];
    adapter.subscribe((s) => later.push(s.revision));
    const applied = await adapter.apply(validated(adapter, [byValue]));
    expect(applied).toMatchObject({ ok: true, state: { revision: "query:1" } });
    expect(adapter.getState().state.sorts).toEqual([valueDesc]);
    expect(later).toEqual(["query:1"]);
    expect(reported).toEqual([failure]);
    expect(adapter.setState((s) => ({ ...s, sorts: [] })).revision).toBe("query:2");
    expect(await adapter.restore({ revision: "query:0", state: adapter.getDefaultState() })).toMatchObject({ ok: true });
    expect(later).toEqual(["query:1", "query:2", "query:3"]);
    expect(reported).toEqual([failure, failure, failure]);
  });

  it("where the runtime has no reportError, a subscriber's error is thrown on its own, after the write", () => {
    vi.stubGlobal("reportError", undefined);
    const queued: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (task: () => void) => queued.push(task));
    const adapter = createQueryAdapter({ schema });
    const failure = new Error("the Host's fetch failed");
    adapter.subscribe(() => {
      throw failure;
    });
    expect(adapter.setState((s) => ({ ...s, sorts: [valueDesc] })).revision).toBe("query:1");
    expect(queued).toHaveLength(1);
    expect(() => queued[0]?.()).toThrow(failure);
  });

  it("through a Controller, a subscriber that throws leaves “View updated.” and an Undo that works", async () => {
    const adapter = createQueryAdapter({ schema });
    adapter.subscribe(() => {
      throw new Error("the Host's fetch failed");
    });
    const later: string[] = [];
    adapter.subscribe((s) => later.push(s.revision));
    const cue = createGridCue({ adapter, provider });
    await cue.propose("sort by market value descending");
    expect(await cue.apply()).toBe(true);
    expect(cue.getState().message).toBe("View updated.");
    expect(adapter.getState().state.sorts).toEqual([valueDesc]);
    expect(await cue.undo()).toBe(true);
    expect(adapter.getState().state.sorts).toEqual([]);
    expect(later).toEqual(["query:1", "query:2"]);
  });

  it("a subscriber that writes on a write: apply returns its own Revision, and every subscriber hears the newer view last", async () => {
    const adapter = createQueryAdapter({ schema });
    let trimmed = false;
    adapter.subscribe(() => {
      if (trimmed) return;
      trimmed = true;
      // A Host that keeps one sort for its server.
      adapter.setState((v) => ({ ...v, sorts: v.sorts.slice(-1) }));
    });
    const later: string[] = [];
    adapter.subscribe((s) => later.push(`${s.revision} ${s.state.sorts.length}`));
    const twoSorts: ViewOperation = {
      type: "sort.set",
      sorts: [
        { columnId: "advisor", direction: "asc" },
        { columnId: "value", direction: "desc" },
      ],
    };
    const applied = await adapter.apply(validated(adapter, [twoSorts]));
    expect(applied).toMatchObject({ ok: true, state: { revision: "query:1" } });
    if (applied.ok) expect(applied.state.state.sorts).toHaveLength(2);
    expect(adapter.getState().revision).toBe("query:2");
    expect(later).toEqual(["query:2 1"]);
  });

  it("the Rows Adapter, on the same holder, does the same for both", async () => {
    const throwing = createRowsAdapter({ schema });
    const failure = new Error("the Host's listener failed");
    throwing.subscribe(() => {
      throw failure;
    });
    const heard: string[] = [];
    throwing.subscribe((s) => heard.push(s.revision));
    expect(await throwing.apply(validated(throwing as never, [byValue]))).toMatchObject({ ok: true, state: { revision: "rows:1" } });
    expect(heard).toEqual(["rows:1"]);
    expect(reported).toEqual([failure]);
    const writing = createRowsAdapter({ schema });
    writing.subscribe((s) => {
      if (s.revision === "rows:1") writing.setState((v) => ({ ...v, sorts: [] }));
    });
    expect(await writing.apply(validated(writing as never, [byValue]))).toMatchObject({ ok: true, state: { revision: "rows:1" } });
    expect(writing.getState().revision).toBe("rows:2");
  });

  it("through a Controller, Undo never erases a change a subscriber made on GridCue's write", async () => {
    const adapter = createQueryAdapter({ schema });
    let trimmed = false;
    adapter.subscribe(() => {
      if (trimmed) return;
      trimmed = true;
      adapter.setState((v) => ({ ...v, sorts: v.sorts.slice(-1) }));
    });
    const cue = createGridCue({ adapter, provider });
    await cue.propose("sort by advisor, then by market value descending");
    expect(cue.getState().status).toBe("ready");
    expect(await cue.apply()).toBe(true);
    const hosts = adapter.getState();
    expect(hosts.state.sorts).toEqual([valueDesc]);
    expect(await cue.undo()).toBe(false);
    expect(cue.getState().message).toBe("The view changed after that update, so undo would erase newer changes.");
    expect(adapter.getState()).toEqual(hosts);
  });
});

describe("Query Adapter: renders", () => {
  it("lists columns.pin and density.set only when the Host names them, and never aggregation.set", () => {
    const ops = (renders?: QueryAdapterOptions["renders"]) =>
      createQueryAdapter({ schema, ...(renders ? { renders } : {}) }).getCapabilities().operations;
    expect(ops()).toEqual([...MVP_OPERATIONS]);
    expect(ops([])).toEqual([...MVP_OPERATIONS]);
    expect(ops(["pinning"])).toEqual([...MVP_OPERATIONS, "columns.pin"]);
    expect(ops(["density"])).toEqual([...MVP_OPERATIONS, "density.set"]);
    expect(ops(["density", "pinning", "density"])).toEqual([...MVP_OPERATIONS, "columns.pin", "density.set"]);
    for (const renders of [undefined, ["pinning"], ["density"], ["pinning", "density"]] as const) {
      expect(ops(renders)).not.toContain("aggregation.set");
    }
  });

  it("puts the count before what renders adds, as the Rows Adapter does", () => {
    expect(createQueryAdapter({ schema, countBeforePaging: true, renders: ["pinning"] }).getCapabilities().operations).toEqual([
      ...MVP_OPERATIONS,
      "limit.set",
      "columns.pin",
    ]);
  });

  it("throws INPUT_CONFIG for totals: a total over rows on a server is a Data Query of its own", () => {
    expect(configError({ renders: ["totals"] })).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("“totals”") });
    expect(configError({ renders: ["pinning", "totals"] })).toMatchObject({ code: "INPUT_CONFIG" });
  });

  it("throws INPUT_CONFIG for count, which countBeforePaging turns on", () => {
    expect(configError({ renders: ["count"] })).toMatchObject({
      code: "INPUT_CONFIG",
      message: expect.stringContaining("countBeforePaging"),
    });
  });

  it("throws INPUT_CONFIG naming any other name, and for a renders that isn't a list", () => {
    expect(configError({ renders: ["sticky"] })).toMatchObject({ code: "INPUT_CONFIG", message: expect.stringContaining("“sticky”") });
    expect(configError({ renders: "pinning" })).toMatchObject({ code: "INPUT_CONFIG" });
  });
});

describe("Query Adapter: the View State and its Revisions", () => {
  it("starts at query:0 and counts each write", async () => {
    const adapter = createQueryAdapter({ schema });
    expect(adapter.getState().revision).toBe("query:0");
    const applied = await adapter.apply(validated(adapter, [byValue]));
    expect(applied).toMatchObject({ ok: true, state: { revision: "query:1" } });
    adapter.setState((s) => ({ ...s, sorts: [] }));
    expect(adapter.getState().revision).toBe("query:2");
    const restored = await adapter.restore({ revision: "query:0", state: adapter.getDefaultState() });
    expect(restored).toMatchObject({ ok: true, state: { revision: "query:3" } });
  });

  it("leaves the Rows Adapter's Revisions as they were", async () => {
    const rows = createRowsAdapter({ schema });
    expect(rows.getState().revision).toBe("rows:0");
    rows.setState((s) => s);
    expect(rows.getState().revision).toBe("rows:1");
  });

  it("setState from a Host control changes the View State, notifies once and moves the Revision", () => {
    const adapter = createQueryAdapter({ schema });
    const before = adapter.getState();
    const seen: VersionedViewState[] = [];
    adapter.subscribe((s) => seen.push(s));
    const returned = adapter.setState((s) => ({ ...s, sorts: [{ columnId: "value", direction: "desc" }] }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(returned);
    expect(adapter.getState()).toEqual(returned);
    expect(returned.state.sorts).toEqual([{ columnId: "value", direction: "desc" }]);
    expect(returned.revision).not.toBe(before.revision);
  });

  it("hands setState a copy, so the update can't change the held state in place", () => {
    const adapter = createQueryAdapter({ schema });
    adapter.setState((s) => {
      s.sorts.push({ columnId: "value", direction: "asc" });
      return s;
    });
    const held = adapter.getState().state;
    adapter.setState((s) => {
      s.sorts.length = 0;
      return { ...s, sorts: [{ columnId: "advisor", direction: "asc" }] };
    });
    expect(held.sorts).toEqual([{ columnId: "value", direction: "asc" }]);
  });

  it("returns the starting view as its default, a fresh copy each time", () => {
    const adapter = createQueryAdapter({ schema });
    const first = adapter.getDefaultState();
    first.sorts.push({ columnId: "value", direction: "asc" });
    expect(adapter.getDefaultState().sorts).toEqual([]);
    expect(adapter.getState().state).toEqual(adapter.getDefaultState());
  });

  it("an apply is done when the View State changes: the Host's subscriber has the new state before apply resolves", async () => {
    const adapter = createQueryAdapter({ schema });
    const order: string[] = [];
    let fetchedFor: VersionedViewState | undefined;
    adapter.subscribe((s) => {
      // The Host's own Data Query would start here, from the View State.
      fetchedFor = s;
      order.push("notified");
    });
    const result = await adapter.apply(validated(adapter, [byValue])).then((r) => {
      order.push("resolved");
      return r;
    });
    expect(order).toEqual(["notified", "resolved"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fetchedFor).toEqual(result.state);
    expect(fetchedFor?.state.sorts).toEqual([{ columnId: "value", direction: "desc" }]);
  });

  it("refuses a stale Revision and leaves the view as it is", async () => {
    const adapter = createQueryAdapter({ schema });
    const plan = validated(adapter, [byValue]);
    adapter.setState((s) => ({ ...s, sorts: [{ columnId: "advisor", direction: "asc" }] }));
    const after = adapter.getState();
    let calls = 0;
    adapter.subscribe(() => calls++);
    expect(await adapter.apply(plan)).toMatchObject({ ok: false, code: "ADAPTER_STALE_REVISION" });
    expect(adapter.getState()).toEqual(after);
    expect(calls).toBe(0);
  });

  it("refuses a plan holding an operation it doesn't list, so a count it can't keep never reaches the View State", async () => {
    const adapter = createQueryAdapter({ schema });
    const plan = validatePlan(planFor(adapter.getState(), [byValue, { type: "limit.set", count: 10 }]), {
      schema,
      capabilities: { ...adapter.getCapabilities(), operations: [...MVP_OPERATIONS, "limit.set"] },
      current: adapter.getState(),
      defaultState: adapter.getDefaultState(),
    });
    if (!plan.ok) throw new Error("not validated");
    const before = adapter.getState();
    let calls = 0;
    adapter.subscribe(() => calls++);
    const result = await adapter.apply(plan.plan);
    expect(result).toMatchObject({ ok: false, code: "ADAPTER_NOT_APPLICABLE" });
    expect(adapter.getState()).toEqual(before);
    expect(calls).toBe(0);
  });
});

describe("Query Adapter: through a Controller", () => {
  it("applies and undoes", async () => {
    const adapter = createQueryAdapter({ schema });
    const cue = createGridCue({ adapter, provider });
    const before = adapter.getState();
    await cue.propose("sort by market value descending");
    expect(cue.getState().status).toBe("ready");
    expect(await cue.apply()).toBe(true);
    expect(adapter.getState().state.sorts).toEqual([{ columnId: "value", direction: "desc" }]);
    expect(adapter.getState().revision).toBe("query:1");
    expect(await cue.undo()).toBe(true);
    expect(adapter.getState().state).toEqual(before.state);
    expect(adapter.getState().revision).toBe("query:2");
  });

  it("refuses an apply after the Host's own control changed the view", async () => {
    const adapter = createQueryAdapter({ schema });
    const cue = createGridCue({ adapter, provider });
    await cue.propose("sort by market value descending");
    expect(cue.getState().status).toBe("ready");
    adapter.setState((s) => ({ ...s, sorts: [{ columnId: "advisor", direction: "asc" }] }));
    expect(await cue.apply()).toBe(false);
    expect(adapter.getState().state.sorts).toEqual([{ columnId: "advisor", direction: "asc" }]);
  });

  // The rows of spec 5.4's table.
  it("“top 10 accounts by market value”, by default: sorts alone and says the count was not applied", async () => {
    const cue = createGridCue({ adapter: createQueryAdapter({ schema }), provider });
    const plan = await cue.propose("top 10 accounts by market value");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([byValue]);
    expect(cue.getState().preview?.notes).toEqual(["Count not applied: this grid can't show only the first 10"]);
  });

  it("“top 10 accounts by market value”, with countBeforePaging: sorts and shows only the first 10 rows", async () => {
    const adapter = createQueryAdapter({ schema, countBeforePaging: true });
    const cue = createGridCue({ adapter, provider });
    const plan = await cue.propose("top 10 accounts by market value");
    expect(cue.getState().status).toBe("ready");
    expect(plan?.operations).toEqual([byValue, { type: "limit.set", count: 10 }]);
    expect(cue.getState().preview?.lines).toEqual(["Sort by Market value, descending", "Show only the first 10 rows"]);
    expect(await cue.apply()).toBe(true);
    expect(adapter.getState().state.limit).toBe(10);
  });

  it("“show only the first 5 rows”, by default: this grid can't, and nothing applies", async () => {
    const adapter = createQueryAdapter({ schema });
    const cue = createGridCue({ adapter, provider });
    const plan = await cue.propose("sort by market value, show only the first 5 rows");
    expect(plan?.clarifications).toContainEqual({ id: "c1.cant", prompt: "This grid can't show only the first 5 rows.", required: true });
    expect(plan?.operations).toEqual([]);
    expect(adapter.getState().revision).toBe("query:0");
  });

  it("“group by advisor”, without group.set: this grid can't group rows", async () => {
    for (const countBeforePaging of [false, true]) {
      const adapter = createQueryAdapter({ schema, without: ["group.set"], countBeforePaging });
      const cue = createGridCue({ adapter, provider });
      const plan = await cue.propose("group by advisor");
      expect(cue.getState().status).toBe("needs_clarification");
      expect(plan?.clarifications.map((q) => q.prompt)).toEqual(["This grid can't group rows."]);
      expect(plan?.operations).toEqual([]);
    }
  });

  it("“taxable accounts over $1m” applies the same View State as on the Rows Adapter", async () => {
    const states = [];
    for (const adapter of [
      createRowsAdapter({ schema }),
      createQueryAdapter({ schema }),
      createQueryAdapter({ schema, countBeforePaging: true }),
    ]) {
      const cue = createGridCue({ adapter, provider });
      await cue.propose("taxable accounts over $1m");
      expect(cue.getState().status).toBe("ready");
      expect(await cue.apply()).toBe(true);
      states.push(adapter.getState().state);
    }
    const [rows, ...query] = states;
    const withoutIds = (s: unknown) => JSON.parse(JSON.stringify(s).replace(/"id":"[^"]*"/g, '"id":""'));
    for (const s of query) expect(withoutIds(s)).toEqual(withoutIds(rows));
  });
});

describe("Query Adapter: entries", () => {
  it("is exported from the root entry with its own names, and the shared holder is not", () => {
    expect(root.createQueryAdapter).toBe(createQueryAdapter);
    expect(Object.keys(root)).not.toContain("createStateAdapter");
    expect(Object.keys(root).filter((name) => /state.?adapter/i.test(name))).toEqual([]);
  });
});

// The contract suite, on each way the Query Adapter can be built that lists what the suite checks.
const harnessWith =
  (options: Omit<QueryAdapterOptions, "schema"> = {}) =>
  () => {
    const adapter = createQueryAdapter({ schema: contractSchema, ...options });
    return {
      adapter,
      manualChange: () => adapter.setState((s) => ({ ...s, sorts: [{ columnId: "team", direction: "asc" }] })),
      numericColumn: "value",
      otherColumn: "name",
      dated: () =>
        createQueryAdapter({
          schema: defineSchema(
            DATED_COLUMNS.map((id) => ({ id })),
            { sampleRows: DATED_ROWS },
          ),
          ...options,
        }),
    };
  };
const contractSchema = defineSchema([{ id: "value", kind: "number" }, { id: "team" }, { id: "name" }]);

const RENDERS: ReadonlyArray<readonly RenderName[] | undefined> = [undefined, ["pinning"], ["density"], ["pinning", "density"]];
for (const renders of RENDERS) {
  const named = renders ? `, renders ${renders.join(" and ")}` : "";
  const options = renders ? { renders: renders as QueryAdapterOptions["renders"] } : {};
  runAdapterContract(`Query Adapter${named}`, harnessWith(options), { ...(renders ? { renders } : {}) });
  runAdapterContract(`Query Adapter, countBeforePaging${named}`, harnessWith({ ...options, countBeforePaging: true }), {
    keepsCount: true,
    ...(renders ? { renders } : {}),
  });
}
