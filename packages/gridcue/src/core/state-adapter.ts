import type { ApplyResult, GridAdapter } from "./adapter";
import { GridCueError } from "./errors";
import { emptyViewState, type VersionedViewState, type ViewSchema, type ViewState } from "./protocol";
import { isApplicable, resultingState } from "./validate";

/**
 * The shared holder the Rows Adapter and the Query Adapter are built from (more grids spec, 5.4). It holds the View
 * State itself, so a write is done the moment the state changes, and every write notifies the Host's subscribers before
 * it returns. A subscriber's error stops neither the write nor the other subscribers: it is reported, as an event
 * listener's is. A write returns its own Revision, even when a subscriber wrote a newer view on hearing of it (ADR 0031).
 * Internal: no entry exports it.
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

/**
 * Reports a subscriber's error as the runtime reports an event listener's: to `reportError` where it has one, and
 * otherwise by throwing it on its own, after the write. Either way the Host sees it, and GridCue's write stands.
 */
const report = (error: unknown): void => {
  const reportError = (globalThis as { reportError?: unknown }).reportError;
  if (typeof reportError === "function") reportError(error);
  else
    queueMicrotask(() => {
      throw error;
    });
};

export const createStateAdapter = (options: StateAdapterOptions): StateAdapter => {
  const operations = [...options.operations];
  const defaultState = structuredClone(options.initialState ?? emptyViewState(options.schema.columns.map((c) => c.id)));
  let n = 0;
  let current: VersionedViewState = { revision: `${options.revisionPrefix}:${n}`, state: structuredClone(defaultState) };
  const listeners = new Set<(s: VersionedViewState) => void>();
  /** Holds the state, tells every subscriber, and returns this write's own Revision. */
  const commit = (state: ViewState): VersionedViewState => {
    const written: VersionedViewState = { revision: `${options.revisionPrefix}:${++n}`, state: structuredClone(state) };
    current = written;
    for (const l of listeners) {
      // A subscriber that wrote a newer view has told every subscriber of it already, so none hears this older one after.
      if (current !== written) break;
      try {
        l(written);
      } catch (error) {
        report(error);
      }
    }
    return written;
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
 * the names `takes` holds.
 */
export const renderedOperations = (
  renders: unknown,
  { adapter, takes, refused = {} }: { adapter: string; takes: readonly RenderedName[]; refused?: Record<string, string> },
): string[] => {
  if (renders === undefined) return [];
  if (!Array.isArray(renders)) throw new GridCueError("INPUT_CONFIG", "renders must be a list, such as [“pinning”, “density”].");
  for (const name of renders) {
    if ((takes as readonly unknown[]).includes(name)) continue;
    const refusal = typeof name === "string" && Object.hasOwn(refused, name) ? refused[name] : undefined;
    if (refusal !== undefined) throw new GridCueError("INPUT_CONFIG", refusal);
    throw new GridCueError(
      "INPUT_CONFIG",
      `renders names “${textOf(name)}”, which ${adapter} doesn't take. It takes ${quotedList(takes)}.`,
    );
  }
  return (Object.keys(RENDERED) as RenderedName[])
    .filter((name) => takes.includes(name) && renders.includes(name))
    .map((name) => RENDERED[name]);
};
