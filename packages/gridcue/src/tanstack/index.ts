import {
  type ApplyResult,
  type ColumnDescriptor,
  defineSchema,
  emptyViewState,
  type FilterPredicate,
  type GridAdapter,
  isApplicable,
  MVP_OPERATIONS,
  matchesPredicate,
  resultingState,
  type SchemaOptions,
  type VersionedViewState,
  type ViewSchema,
  type ViewState,
} from "../index";

type ColumnFilter = { id: string; value: unknown };
type TanStackState = {
  columnFilters?: ColumnFilter[];
  sorting?: Array<{ id: string; desc: boolean }>;
  grouping?: string[];
  columnVisibility?: Record<string, boolean>;
  columnOrder?: string[];
};

/**
 * The parts of a TanStack Table v9 instance GridCue uses. Any table from `useTable`
 * or `constructTable` with the filtering, sorting, grouping, visibility, and ordering features fits.
 */
export interface TanStackTableLike {
  store: { state: TanStackState; subscribe(listener: () => void): { unsubscribe(): void } | (() => void) };
  _reactivity: { batch(fn: () => void): void };
  setColumnFilters(filters: ColumnFilter[]): void;
  setSorting(sorting: Array<{ id: string; desc: boolean }>): void;
  setGrouping(grouping: string[]): void;
  setColumnVisibility(visibility: Record<string, boolean>): void;
  setColumnOrder(order: string[]): void;
  getAllLeafColumns(): Array<{ id: string; columnDef: { header?: unknown } }>;
  getCoreRowModel(): { rows: Array<{ getValue(columnId: string): unknown }> };
}

/**
 * The filter value GridCue stores in TanStack's column filter state. `host` carries the
 * Host's own filter value for the same column, when there was one, so one TanStack column
 * filter entry can hold both without either replacing the other.
 */
interface GridCueFilterValue {
  gridcue: 1;
  kind: ColumnDescriptor["kind"];
  predicates: FilterPredicate[];
  host?: unknown;
}

const isGridCueValue = (v: unknown): v is GridCueFilterValue =>
  typeof v === "object" && v !== null && (v as GridCueFilterValue).gridcue === 1;

/**
 * Register once with `defaultColumn: { filterFn: gridcueFilterFn }` so GridCue filters
 * behave exactly as they do in the Rows Adapter. It only evaluates GridCue's own predicates:
 * it has no Host filter function to call, so a `host` value carried alongside them is not
 * evaluated here. Use `withGridCueFilter` on a column that needs its Host filter honoured too.
 */
export const gridcueFilterFn = (row: { getValue(columnId: string): unknown }, columnId: string, value: unknown): boolean =>
  !isGridCueValue(value) ||
  value.predicates.every((p) => matchesPredicate(row.getValue(columnId), p, { kind: value.kind } as ColumnDescriptor));

type FilterFn = (
  row: { getValue(columnId: string): unknown },
  columnId: string,
  value: unknown,
  addMeta?: (meta: never) => void,
) => boolean;

/** Wraps a column's own filter function so it keeps working alongside GridCue filters. */
export const withGridCueFilter =
  (fallback: FilterFn): FilterFn =>
  (row, columnId, value, addMeta) =>
    isGridCueValue(value)
      ? gridcueFilterFn(row, columnId, value) && (value.host === undefined || fallback(row, columnId, value.host, addMeta))
      : fallback(row, columnId, value, addMeta);

/** Builds a GridCue schema from a table's existing columns and a sample of its rows. */
export const schemaFromTanStack = (table: TanStackTableLike, options: Omit<SchemaOptions, "sampleRows"> = {}): ViewSchema => {
  const columns = table.getAllLeafColumns();
  const sampleRows = table
    .getCoreRowModel()
    .rows.slice(0, 50)
    .map((row) => Object.fromEntries(columns.map((c) => [c.id, row.getValue(c.id)])));
  return defineSchema(
    columns.map((c) => ({ id: c.id, ...(typeof c.columnDef.header === "string" ? { label: c.columnDef.header } : {}) })),
    { ...options, sampleRows },
  );
};

export interface TanStackAdapterOptions {
  schema: ViewSchema;
  table: TanStackTableLike;
  maxSorts?: number;
  maxGroups?: number;
}

/** A Grid Adapter over a TanStack Table v9 instance. The Host keeps owning the table and its state. */
export const createTanStackAdapter = ({ schema, table, maxSorts = 3, maxGroups = 2 }: TanStackAdapterOptions): GridAdapter => {
  let n = 0;
  const leafIds = () => table.getAllLeafColumns().map((c) => c.id);
  const read = (): ViewState => {
    const s = table.store.state;
    const leaves = leafIds();
    const order = s.columnOrder?.length ? [...s.columnOrder, ...leaves.filter((id) => !s.columnOrder?.includes(id))] : leaves;
    const predicates = (s.columnFilters ?? []).flatMap((f) => (isGridCueValue(f.value) ? f.value.predicates : []));
    return {
      ...emptyViewState(order),
      visibleColumnIds: order.filter((id) => s.columnVisibility?.[id] !== false),
      filters: predicates.length ? { id: "root", type: "group", combinator: "and", children: predicates } : null,
      sorts: (s.sorting ?? []).map((x) => ({ columnId: x.id, direction: x.desc ? "desc" : "asc" })),
      groupBy: [...(s.grouping ?? [])],
    };
  };
  const defaultState = read();
  const listeners = new Set<(s: VersionedViewState) => void>();
  const current = (): VersionedViewState => ({ revision: `tanstack:${n}`, state: read() });
  // Only a change to the View State should bump the revision. TanStack's store also notifies for
  // pagination, row selection, expanded rows, column sizing, and its own auto-resets (e.g.
  // getRowModel() resetting pageIndex to 0 after a sort), none of which change it. The View State
  // holds only GridCue's own scalar values, so serialising it never trips on a Host filter value
  // such as a BigInt.
  const fingerprint = () => JSON.stringify(read());
  let lastFingerprint = fingerprint();
  const sub = table.store.subscribe(() => {
    const next = fingerprint();
    if (next === lastFingerprint) return;
    lastFingerprint = next;
    n++;
    const snapshot = current();
    for (const l of listeners) l(snapshot);
  });
  void sub;

  const write = (next: ViewState): ApplyResult => {
    const predicates: FilterPredicate[] = [];
    if (next.filters) {
      if (next.filters.combinator !== "and" || next.filters.children.some((c) => c.type !== "predicate")) {
        return { ok: false, code: "ADAPTER_UNSUPPORTED_FILTER", message: "TanStack column filters can only be combined with AND." };
      }
      predicates.push(...(next.filters.children as FilterPredicate[]));
    }
    const byColumn = new Map<string, FilterPredicate[]>();
    for (const p of predicates) byColumn.set(p.columnId, [...(byColumn.get(p.columnId) ?? []), p]);
    // A column can carry a Host filter and a GridCue filter at once, but TanStack keeps only one
    // columnFilters entry per column id. Collect the Host's value per column, from both its own
    // plain entries and the `host` field of GridCue entries already holding one, so it survives
    // being folded into (or, once GridCue's predicates are gone, back out of) that one entry.
    const hostByColumn = new Map<string, unknown>();
    for (const f of table.store.state.columnFilters ?? []) {
      const host = isGridCueValue(f.value) ? f.value.host : f.value;
      if (host !== undefined && !hostByColumn.has(f.id)) hostByColumn.set(f.id, host);
    }
    const kind = (id: string) => schema.columns.find((c) => c.id === id)?.kind ?? "string";
    table._reactivity.batch(() => {
      table.setColumnFilters([
        ...[...hostByColumn].filter(([id]) => !byColumn.has(id)).map(([id, host]) => ({ id, value: host })),
        ...[...byColumn].map(([id, preds]) => ({
          id,
          value: {
            gridcue: 1,
            kind: kind(id),
            predicates: preds,
            ...(hostByColumn.has(id) ? { host: hostByColumn.get(id) } : {}),
          } satisfies GridCueFilterValue,
        })),
      ]);
      table.setSorting(next.sorts.map((s) => ({ id: s.columnId, desc: s.direction === "desc" })));
      table.setGrouping([...next.groupBy]);
      table.setColumnOrder([...next.columnOrder]);
      table.setColumnVisibility(Object.fromEntries(next.columnOrder.map((id) => [id, next.visibleColumnIds.includes(id)])));
    });
    return { ok: true, state: current() };
  };

  return {
    getSchema: () => schema,
    getCapabilities: () => ({
      operations: [...MVP_OPERATIONS],
      maxSorts,
      maxGroups,
      supportsAtomicApply: true,
      supportsSnapshotRestore: true,
      observesChanges: true,
    }),
    getState: current,
    getDefaultState: () => structuredClone(defaultState),
    async apply(plan) {
      if (!isApplicable(plan)) return { ok: false, code: "ADAPTER_NOT_APPLICABLE", message: "Only validated plans can be applied." };
      if (plan.baseRevision !== current().revision)
        return { ok: false, code: "ADAPTER_STALE_REVISION", message: "The view changed first." };
      return write(resultingState(plan));
    },
    async restore(snapshot) {
      return write(snapshot.state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
