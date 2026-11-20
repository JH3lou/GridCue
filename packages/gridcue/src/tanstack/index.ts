import {
  type ApplyResult,
  type ColumnDescriptor,
  defineSchema,
  emptyViewState,
  type FilterPredicate,
  type GridAdapter,
  GridCueError,
  isApplicable,
  type LocalValues,
  MVP_OPERATIONS,
  matchesPredicate,
  resultingState,
  type SchemaOptions,
  type VersionedViewState,
  type ViewSchema,
  type ViewState,
} from "../index";

type ColumnFilter = { id: string; value: unknown };
/** TanStack Table v9's column pins: logical `start` and `end`, as GridCue's View State has them. */
type ColumnPinning = { start: string[]; end: string[] };
type TanStackState = {
  columnFilters?: ColumnFilter[];
  sorting?: Array<{ id: string; desc: boolean }>;
  grouping?: string[];
  columnVisibility?: Record<string, boolean>;
  columnOrder?: string[];
  columnPinning?: Partial<ColumnPinning>;
};

/**
 * The parts of a TanStack Table v9 instance GridCue uses. Any table from `useTable`
 * or `constructTable` with the filtering, sorting, grouping, visibility, and ordering features fits.
 * `setColumnPinning` is there when the table registers `columnPinningFeature`, which `renders: ["pinning"]` needs.
 */
export interface TanStackTableLike {
  store: { state: TanStackState; subscribe(listener: () => void): { unsubscribe(): void } | (() => void) };
  _reactivity: { batch(fn: () => void): void };
  setColumnFilters(filters: ColumnFilter[]): void;
  setSorting(sorting: Array<{ id: string; desc: boolean }>): void;
  setGrouping(grouping: string[]): void;
  setColumnVisibility(visibility: Record<string, boolean>): void;
  setColumnOrder(order: string[]): void;
  setColumnPinning?(pinning: ColumnPinning): void;
  getAllLeafColumns(): Array<{ id: string; columnDef: { header?: unknown } }>;
  getCoreRowModel(): { rows: Array<{ getValue(columnId: string): unknown }>; flatRows?: Array<{ getValue(columnId: string): unknown }> };
}

/**
 * Local Values from a table's own rows (named filters spec, 5.4; ADR 0025): for each column id, a function that
 * reads that column's value from every row the table has loaded, sub-rows included. These are the rows before the
 * table filters, sorts, groups or pages them, so a name is found while the User's filter hides its row. A table that
 * pages on a server holds only its page: pass the Host's own list to `localValues` instead.
 *
 * Each function returns the same array while the table's data is the same array, so the Controller keeps its index.
 * Values are passed on as the table holds them; the Controller drops any that are not text. A column id the table
 * doesn't have throws `INPUT_CONFIG` here. If the table later loses one, reading throws and the request stops with
 * `INPUT_LOCAL_VALUES`. `createGridCue` still checks each column against the schema.
 */
export const localValuesFromTable = (
  table: Pick<TanStackTableLike, "getAllLeafColumns" | "getCoreRowModel">,
  columnIds: readonly string[],
): LocalValues => {
  const missing = (): string | undefined => {
    const leaves = new Set(table.getAllLeafColumns().map((c) => c.id));
    return columnIds.find((id) => !leaves.has(id));
  };
  const absent = missing();
  if (absent !== undefined) {
    throw new GridCueError("INPUT_CONFIG", `localValuesFromTable names “${absent}”, which is not a column of this table.`);
  }
  // TanStack keeps its core row model while the table's data is the same array, so its rows mark the data.
  let rowsRead: unknown;
  const kept = new Map<string, readonly unknown[]>();
  const reader = (columnId: string) => (): readonly unknown[] => {
    if (missing() !== undefined) throw new Error("The table no longer has a column localValuesFromTable reads.");
    const model = table.getCoreRowModel();
    const rows = model.flatRows ?? model.rows;
    if (rows !== rowsRead) {
      rowsRead = rows;
      kept.clear();
    }
    let values = kept.get(columnId);
    if (!values) {
      values = rows.map((row) => row.getValue(columnId));
      kept.set(columnId, values);
    }
    return values;
  };
  return Object.fromEntries(columnIds.map((id) => [id, reader(id)]));
};

/**
 * The filter value GridCue stores in TanStack's column filter state. `host` carries the
 * Host's own filter value for the same column, when there was one, so one TanStack column
 * filter entry can hold both without either replacing the other.
 */
interface GridCueFilterValue {
  gridcue: 1;
  kind: ColumnDescriptor["kind"];
  /**
   * On a date or date-and-time column, the Calendar's time zone, which a date in a filter is a whole day in. With no
   * Calendar time zone it is left out, and the browser's is read when a row is filtered, as `applyView` does.
   */
  timeZone?: string;
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
export const gridcueFilterFn = (row: { getValue(columnId: string): unknown }, columnId: string, value: unknown): boolean => {
  if (!isGridCueValue(value)) return true;
  const cell = row.getValue(columnId);
  const column = { kind: value.kind } as ColumnDescriptor;
  const options = value.timeZone === undefined ? undefined : { timeZone: value.timeZone };
  return value.predicates.every((p) => matchesPredicate(cell, p, column, options));
};

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
  /**
   * What the Host's markup draws beyond TanStack's rows and columns (operation set spec, 4.2; ADR 0029). `"pinning"`
   * when it keeps pinned columns in place (`column.getStart("start")` and the start, center and end column lists), which
   * needs `columnPinningFeature` registered. `"density"` when it sets its row height from the View State's `density`,
   * which the adapter holds, since TanStack has none. The adapter lists `columns.pin` and `density.set` only for what
   * this names. The default is none, and a request for either then asks "This grid can't …" and changes nothing. Name
   * only what the table draws: GridCue can't check it. Any other name throws `INPUT_CONFIG`.
   */
  renders?: ReadonlyArray<"pinning" | "density">;
}

/**
 * Reads `renders` against the table (operation set spec, 4.2). Every name the adapter doesn't take throws, "totals" and
 * "count" included, which it can't list yet: an adapter that took a name and listed nothing would read as support.
 */
const readRenders = (renders: unknown, table: TanStackTableLike): { pinning: boolean; density: boolean } => {
  if (renders === undefined) return { pinning: false, density: false };
  if (!Array.isArray(renders)) throw new GridCueError("INPUT_CONFIG", "renders must be a list, such as [“pinning”, “density”].");
  for (const name of renders) {
    if (name === "pinning" || name === "density") continue;
    if (name === "totals" || name === "count") {
      throw new GridCueError("INPUT_CONFIG", `renders names “${name}”, which the TanStack Table adapter can't list yet. Leave it out.`);
    }
    throw new GridCueError(
      "INPUT_CONFIG",
      `renders names “${String(name)}”, which the TanStack Table adapter doesn't take. It takes “pinning” and “density”.`,
    );
  }
  const pinning = renders.includes("pinning");
  if (pinning && typeof table.setColumnPinning !== "function") {
    throw new GridCueError(
      "INPUT_CONFIG",
      "renders names “pinning”, but the table has no setColumnPinning. Register columnPinningFeature.",
    );
  }
  // TanStack Table v8 held pins as `left` and `right`; v9 reads only `start` and `end`, and a v8-shaped slice the Host
  // still controls would leave every pin GridCue writes undrawn.
  const held = table.store.state.columnPinning as Record<string, unknown> | undefined;
  if (pinning && held && ("left" in held || "right" in held)) {
    throw new GridCueError(
      "INPUT_CONFIG",
      "renders names “pinning”, but the table holds its column pins as “left” and “right”, as TanStack Table v8 did. Keep them as “start” and “end”.",
    );
  }
  return { pinning, density: renders.includes("density") };
};

/**
 * How long an apply or restore waits for a table whose state the Host controls to render what GridCue wrote.
 * Past it, the write throws and the Controller's recovery runs (spec 4.2, ADR 0031).
 */
const HOLD_WAIT_MS = 1_000;

/** A Grid Adapter over a TanStack Table v9 instance. The Host keeps owning the table and its state. */
export const createTanStackAdapter = ({ schema, table, maxSorts = 3, maxGroups = 2, renders }: TanStackAdapterOptions): GridAdapter => {
  const draws = readRenders(renders, table);
  let n = 0;
  // TanStack has no density, so the adapter holds it and reads it back with the rest of the View State: undo and
  // restore keep it. It changes only when the table draws it.
  let density: ViewState["density"] = emptyViewState([]).density;
  const leafIds = () => table.getAllLeafColumns().map((c) => c.id);
  const read = (s: TanStackState = table.store.state, held: ViewState["density"] = density): ViewState => {
    const leaves = leafIds();
    const order = s.columnOrder?.length ? [...s.columnOrder, ...leaves.filter((id) => !s.columnOrder?.includes(id))] : leaves;
    const predicates = (s.columnFilters ?? []).flatMap((f) => (isGridCueValue(f.value) ? f.value.predicates : []));
    // Pins come from TanStack's own state, and only when the table draws them. Like TanStack's own column lists, an id
    // that is no column of the table is skipped.
    const pinned = (ids: readonly string[] | undefined) => (draws.pinning ? (ids ?? []).filter((id) => leaves.includes(id)) : []);
    return {
      ...emptyViewState(order),
      visibleColumnIds: order.filter((id) => s.columnVisibility?.[id] !== false),
      pinnedColumnIds: { start: pinned(s.columnPinning?.start), end: pinned(s.columnPinning?.end) },
      filters: predicates.length ? { id: "root", type: "group", combinator: "and", children: predicates } : null,
      sorts: (s.sorting ?? []).map((x) => ({ columnId: x.id, direction: x.desc ? "desc" : "asc" })),
      groupBy: [...(s.grouping ?? [])],
      density: held,
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
  // While a write is waiting for the table, changes are counted but listeners hear of them once, when it ends:
  // an apply notifies once, however many renders a controlled table takes to hold it.
  let writing = 0;
  let held = false;
  const notify = () => {
    const snapshot = current();
    for (const l of listeners) l(snapshot);
  };
  /** Counts a change to the View State the table now holds, if there is one. */
  const sync = () => {
    const next = fingerprint();
    if (next === lastFingerprint) return;
    lastFingerprint = next;
    n++;
    if (writing > 0) held = true;
    else notify();
  };
  const waiters = new Set<() => void>();
  const sub = table.store.subscribe(() => {
    sync();
    for (const w of [...waiters]) w();
  });
  void sub;

  /**
   * Resolves once the table holds `expected`, checking after each store notification. A table that owns its state
   * holds it already, so this resolves in the same tick. A controlled table holds it on its next render. Past the
   * bound it throws: a controlled slice with no change handler never changes.
   *
   * It resolves with the Revision read at the moment the table first holds `expected`, not after the await: a change
   * made between that moment and the caller resuming is newer than the write, so undo must find it and refuse.
   */
  const untilHeld = (expected: string): Promise<VersionedViewState> => {
    sync();
    if (lastFingerprint === expected) return Promise.resolve(current());
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        waiters.delete(check);
      };
      const check = () => {
        if (lastFingerprint !== expected) return;
        done();
        resolve(current());
      };
      const timer = setTimeout(() => {
        sync();
        if (lastFingerprint === expected) return check();
        done();
        reject(new GridCueError("ADAPTER_FAILED", `The table didn't hold the change within ${HOLD_WAIT_MS} ms.`));
      }, HOLD_WAIT_MS);
      waiters.add(check);
    });
  };

  const write = async (next: ViewState): Promise<ApplyResult> => {
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
    // Beside a date column's kind, the time zone its dates are whole days in, so `gridcueFilterFn` keeps the rows
    // `applyView` keeps.
    const zoneOf = (id: string) => {
      const timeZone = schema.calendar?.timeZone;
      const dated = kind(id) === "date" || kind(id) === "datetime";
      return dated && timeZone !== undefined ? { timeZone } : {};
    };
    const slices = {
      columnFilters: [
        ...[...hostByColumn].filter(([id]) => !byColumn.has(id)).map(([id, host]) => ({ id, value: host })),
        ...[...byColumn].map(([id, preds]) => ({
          id,
          value: {
            gridcue: 1,
            kind: kind(id),
            ...zoneOf(id),
            predicates: preds,
            ...(hostByColumn.has(id) ? { host: hostByColumn.get(id) } : {}),
          } satisfies GridCueFilterValue,
        })),
      ],
      sorting: next.sorts.map((s) => ({ id: s.columnId, desc: s.direction === "desc" })),
      grouping: [...next.groupBy],
      columnOrder: [...next.columnOrder],
      columnVisibility: Object.fromEntries(next.columnOrder.map((id) => [id, next.visibleColumnIds.includes(id)])),
    } satisfies TanStackState;
    // Pins go through TanStack's own state, and only on a table that draws them; one that doesn't keeps its own.
    const columnPinning: ColumnPinning | undefined = draws.pinning
      ? { start: [...next.pinnedColumnIds.start], end: [...next.pinnedColumnIds.end] }
      : undefined;
    const nextDensity = draws.density ? next.density : density;
    // The View State the table reads as once it holds every slice written here, in the form `read` gives.
    const expected = JSON.stringify(read({ ...table.store.state, ...slices, ...(columnPinning ? { columnPinning } : {}) }, nextDensity));
    writing++;
    try {
      // Held before the table's slices, so the notification their write sends carries it, and a write that changes only
      // the density still counts as one change.
      density = nextDensity;
      table._reactivity.batch(() => {
        table.setColumnFilters(slices.columnFilters);
        table.setSorting(slices.sorting);
        table.setGrouping(slices.grouping);
        table.setColumnOrder(slices.columnOrder);
        table.setColumnVisibility(slices.columnVisibility);
        if (columnPinning) table.setColumnPinning?.(columnPinning);
      });
      // Done only when the table holds it, with the Revision that change produced (ADR 0031).
      return { ok: true, state: await untilHeld(expected) };
    } finally {
      writing--;
      if (writing === 0 && held) {
        held = false;
        notify();
      }
    }
  };

  return {
    getSchema: () => schema,
    getCapabilities: () => ({
      operations: [...MVP_OPERATIONS, ...(draws.pinning ? ["columns.pin"] : []), ...(draws.density ? ["density.set"] : [])],
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
