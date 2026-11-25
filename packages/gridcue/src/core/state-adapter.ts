import type { ApplyResult, GridAdapter } from "./adapter";
import { GridCueError } from "./errors";
import { emptyViewState, type VersionedViewState, type ViewSchema, type ViewState } from "./protocol";
import { isApplicable, resultingState } from "./validate";

/**
 * The shared holder the Rows Adapter and the Query Adapter are built from (more grids spec, 5.4). It holds the View
 * State itself, so a write is done the moment the state changes, and every write notifies the Host's subscribers before
 * it returns. Its subscriber rules are the Rows Adapter's, unchanged: an error a subscriber throws comes out of the
 * write, after the state changed, and the subscribers after it don't hear of that write. A write returns the latest
 * state, so when a subscriber writes on hearing of a change, the write returns the subscriber's newer one. Internal: no
 * entry exports it.
 */
export interface StateAdapter extends GridAdapter {
  /** For the Host's own controls, such as clicking a column header. Bumps the revision. */
  setState(update: (state: ViewState) => ViewState): VersionedViewState;
}

export interface StateAdapterOptions {
  schema: ViewSchema;
  initialState?: ViewState;
  maxSorts?: number;
  maxGroups?: number;
  /** Every operation the adapter lists, in order. */
  operations: readonly string[];
  /** What each Revision starts with: `rows` gives `rows:0`, `rows:1`, … */
  revisionPrefix: string;
}

export const createStateAdapter = (options: StateAdapterOptions): StateAdapter => {
  const operations = [...options.operations];
  const defaultState = structuredClone(options.initialState ?? emptyViewState(options.schema.columns.map((c) => c.id)));
  let n = 0;
  let current: VersionedViewState = { revision: `${options.revisionPrefix}:${n}`, state: structuredClone(defaultState) };
  const listeners = new Set<(s: VersionedViewState) => void>();
  /** Holds the state, tells each subscriber the latest state, and returns the latest state. */
  const commit = (state: ViewState): VersionedViewState => {
    current = { revision: `${options.revisionPrefix}:${++n}`, state: structuredClone(state) };
    for (const l of listeners) l(current);
    return current;
  };
  return {
    getSchema: () => options.schema,
    getCapabilities: () => ({
      operations: [...operations],
      maxSorts: options.maxSorts ?? 3,
      maxGroups: options.maxGroups ?? 2,
      supportsAtomicApply: true,
      supportsSnapshotRestore: true,
      observesChanges: true,
    }),
    getState: () => current,
    getDefaultState: () => structuredClone(defaultState),
    async apply(plan): Promise<ApplyResult> {
      if (!isApplicable(plan)) return { ok: false, code: "ADAPTER_NOT_APPLICABLE", message: "Only validated plans can be applied." };
      if (plan.baseRevision !== current.revision) return { ok: false, code: "ADAPTER_STALE_REVISION", message: "The view changed first." };
      return { ok: true, state: commit(resultingState(plan)) };
    },
    async restore(snapshot): Promise<ApplyResult> {
      return { ok: true, state: commit(snapshot.state) };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setState: (update) => commit(update(structuredClone(current.state))),
  };
};

/** What a Host's table draws beyond its rows and columns, as an adapter's `renders` option names it. */
export type RenderedName = "pinning" | "density" | "totals";

/** The operation each `renders` name lets an adapter list (operation set spec, 4.2; ADR 0029). */
const RENDERED = { pinning: "columns.pin", density: "density.set", totals: "aggregation.set" } as const;

/**
 * A value as text for a message, for any value a Host may pass: `1n` for a bigint, and the object's tag for an object
 * that can't be turned into text, such as one with no prototype. `json` writes an object as JSON where it can.
 */
export const textOf = (value: unknown, json = false): string => {
  if (typeof value === "bigint") return `${value}n`;
  try {
    return (json ? JSON.stringify(value) : undefined) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
};

/** “a”, “a” and “b”, “a”, “b” and “c”. */
const quotedList = (names: readonly string[]): string => {
  const quoted = names.map((name) => `“${name}”`);
  return quoted.length <= 1 ? quoted.join("") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
};

/**
 * The operations an adapter's `renders` lists, in one order whatever the order or repeats in it. Every name the adapter
 * doesn't take throws `INPUT_CONFIG` naming it: with the message `refused` gives for that name, or else one that lists
 * the names `takes` holds. `nameOf` writes the name for that message; the Rows Adapter passes `String`, as it always has.
 */
export const renderedOperations = (
  renders: unknown,
  {
    adapter,
    takes,
    refused = {},
    nameOf = textOf,
  }: {
    adapter: string;
    takes: readonly RenderedName[];
    refused?: Record<string, string>;
    nameOf?: (value: unknown) => string;
  },
): string[] => {
  if (renders === undefined) return [];
  if (!Array.isArray(renders)) throw new GridCueError("INPUT_CONFIG", "renders must be a list, such as [“pinning”, “density”].");
  for (const name of renders) {
    if ((takes as readonly unknown[]).includes(name)) continue;
    const refusal = typeof name === "string" && Object.hasOwn(refused, name) ? refused[name] : undefined;
    if (refusal !== undefined) throw new GridCueError("INPUT_CONFIG", refusal);
    throw new GridCueError(
      "INPUT_CONFIG",
      `renders names “${nameOf(name)}”, which ${adapter} doesn't take. It takes ${quotedList(takes)}.`,
    );
  }
  return (Object.keys(RENDERED) as RenderedName[])
    .filter((name) => takes.includes(name) && renders.includes(name))
    .map((name) => RENDERED[name]);
};
