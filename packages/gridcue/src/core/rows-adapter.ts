import type { ApplyResult, GridAdapter } from "./adapter";
import { MVP_OPERATIONS } from "./adapter";
import { matchesFilter } from "./evaluate";
import { emptyViewState, type Scalar, type VersionedViewState, type ViewSchema, type ViewState } from "./protocol";
import { isApplicable, resultingState } from "./validate";

export interface RowsAdapterOptions {
  schema: ViewSchema;
  initialState?: ViewState;
  maxSorts?: number;
  maxGroups?: number;
}

export interface RowsAdapter extends GridAdapter {
  /** For the Host's own controls, such as clicking a column header. Bumps the revision. */
  setState(update: (state: ViewState) => ViewState): VersionedViewState;
}

/** A Grid Adapter for Hosts that keep rows in memory. Pair it with `applyView` and any table. */
export const createRowsAdapter = (options: RowsAdapterOptions): RowsAdapter => {
  const defaultState = structuredClone(options.initialState ?? emptyViewState(options.schema.columns.map((c) => c.id)));
  let n = 0;
  let current: VersionedViewState = { revision: `rows:${n}`, state: structuredClone(defaultState) };
  const listeners = new Set<(s: VersionedViewState) => void>();
  const commit = (state: ViewState): VersionedViewState => {
    current = { revision: `rows:${++n}`, state: structuredClone(state) };
    for (const l of listeners) l(current);
    return current;
  };
  return {
    getSchema: () => options.schema,
    getCapabilities: () => ({
      operations: [...MVP_OPERATIONS],
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

export interface ViewResult<Row> {
  /** Visible column IDs, in display order. */
  columns: string[];
  /** Filtered and sorted rows. */
  rows: Row[];
  /** Present when the view is grouped: one entry per distinct key, in first-seen order. */
  groups?: Array<{ key: Record<string, Scalar>; rows: Row[] }>;
}

const compareValues = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
};

/** Applies a View State to in-memory rows. Pure; the Host renders the result with any table. */
export const applyView = <Row extends object>(rows: readonly Row[], state: ViewState, schema: ViewSchema): ViewResult<Row> => {
  const cell = (row: Row, id: string): unknown => (row as Record<string, unknown>)[id];
  const filtered = rows.filter((row) => matchesFilter(row as Record<string, unknown>, state.filters, schema));
  const sorted =
    state.sorts.length === 0
      ? filtered
      : [...filtered].sort((a, b) => {
          for (const s of state.sorts) {
            const d = compareValues(cell(a, s.columnId), cell(b, s.columnId));
            if (d !== 0) return s.direction === "desc" ? -d : d;
          }
          return 0;
        });
  const columns = state.columnOrder.filter((id) => state.visibleColumnIds.includes(id));
  if (state.groupBy.length === 0) return { columns, rows: sorted };
  const groups = new Map<string, { key: Record<string, Scalar>; rows: Row[] }>();
  for (const row of sorted) {
    const key = Object.fromEntries(state.groupBy.map((id) => [id, (cell(row, id) ?? null) as Scalar]));
    const k = JSON.stringify(key);
    const group = groups.get(k) ?? { key, rows: [] };
    group.rows.push(row);
    groups.set(k, group);
  }
  return { columns, rows: sorted, groups: [...groups.values()] };
};
