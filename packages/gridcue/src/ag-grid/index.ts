import {
  type ApplyResult,
  type ColumnDescriptor,
  type ColumnInput,
  type ColumnKind,
  defineSchema,
  emptyViewState,
  type FilterGroup,
  type GridAdapter,
  GridCueError,
  isApplicable,
  MVP_OPERATIONS,
  resultingState,
  type SchemaOptions,
  type SortSpec,
  type VersionedViewState,
  type ViewSchema,
  type ViewState,
} from "../index";
import { AG_FILTERS, brandOf, columnSettings, filtersColumn, filterTypeForDataType, filterTypeOf, type GridcueColDef } from "./meanings";
import { type AgColumnModel, canonical, toFilterModel, Unwritable } from "./model";
import { readColumnModel } from "./read";

export {
  type GridcueColDef,
  type GridcueFilterOption,
  type GridcueFilterParams,
  type GridcueTextMatcherParams,
  gridcueColumnDefs,
} from "./meanings";

/** A column definition as GridCue reads it. Any AG Grid `ColDef` fits. */
export interface AgColDefLike {
  colId?: string;
  field?: string;
  headerName?: string;
  filter?: unknown;
  filterParams?: unknown;
  cellDataType?: unknown;
  sortable?: boolean | null;
  valueGetter?: unknown;
  filterValueGetter?: unknown;
}

/** A column group definition as GridCue reads it. Any AG Grid `ColGroupDef` fits. */
export interface AgColGroupDefLike {
  children: ReadonlyArray<AgColDefLike | AgColGroupDefLike>;
}

/** One column's state as GridCue reads and writes it. AG Grid's `ColumnState` fits. */
export interface AgColumnStateLike {
  colId: string;
  hide?: boolean | null;
  sort?: "asc" | "desc" | null;
  sortIndex?: number | null;
  pinned?: unknown;
  rowGroup?: boolean | null;
  rowGroupIndex?: number | null;
}

/**
 * The parts of AG Grid's `GridApi` GridCue uses. The `api` an AG Grid 34, 35 or 36 grid gives `onGridReady` fits; the
 * entry imports nothing from AG Grid. `createAgGridAdapter` checks each call is there and names any that isn't.
 */
export interface AgGridApiLike {
  getFilterModel(): Record<string, unknown>;
  setFilterModel(model: Record<string, unknown> | null): void;
  getColumnState(): AgColumnStateLike[];
  applyColumnState(params: { state?: AgColumnStateLike[]; applyOrder?: boolean; defaultState?: Omit<AgColumnStateLike, "colId"> }): boolean;
  getColumn(key: string): { getColId(): string; getColDef(): AgColDefLike } | null;
  addEventListener(eventType: string, listener: (event: unknown) => void): void;
  isDestroyed(): boolean;
}

export interface AgGridAdapterOptions {
  schema: ViewSchema;
  /** The grid's api, from `onGridReady` or `createGrid`. */
  api: AgGridApiLike;
  /** The most columns a sort may hold. Default 3. */
  maxSorts?: number;
}

/** Every call the adapter makes on the grid. A grid without one is refused at creation (spec 5.6). */
const CALLS = [
  "getFilterModel",
  "setFilterModel",
  "getColumnState",
  "applyColumnState",
  "getColumn",
  "addEventListener",
  "isDestroyed",
] as const satisfies ReadonlyArray<keyof AgGridApiLike>;

/** The grid events after which the adapter reads the grid again: a change to its filters, sorts or columns. */
const EVENTS = [
  "filterChanged",
  "sortChanged",
  "columnVisible",
  "columnMoved",
  "columnRowGroupChanged",
  "displayedColumnsChanged",
  "newColumnsLoaded",
];

const TESTED = "GridCue's AG Grid adapter is tested with AG Grid Community 34, 35 and 36.";

/** Checks `api` has every call the adapter makes, and is a grid that is still there. */
const checkApi = (api: unknown): AgGridApiLike => {
  if (typeof api !== "object" || api === null) {
    throw new GridCueError("INPUT_CONFIG", "createAgGridAdapter needs api: the grid's api, from onGridReady or createGrid.");
  }
  for (const call of CALLS) {
    if (typeof (api as Record<string, unknown>)[call] !== "function") {
      throw new GridCueError("INPUT_CONFIG", `The grid's api has no ${call}, which GridCue uses. ${TESTED}`);
    }
  }
  const grid = api as AgGridApiLike;
  if (grid.isDestroyed()) throw new GridCueError("INPUT_CONFIG", "The grid is destroyed. Create the adapter from a grid that is showing.");
  return grid;
};

/**
 * True when two settings are the same: the same function, two functions `gridcueColumnDefs` built from the same
 * columns and Calendar, or arrays and objects whose parts are the same.
 */
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a === "function" || typeof b === "function") return brandOf(a) !== undefined && brandOf(a) === brandOf(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) || Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

const FILTER_NAMES = { text: "text", number: "number", date: "date", other: "other" } as const;
const FIX =
  "Give the grid columnDefs={gridcueColumnDefs(schema, columnDefs)}, or take “filter” off the column's capabilities in the schema.";
const NOT_FILTERED = "or take “filter” off the column's capabilities in the schema, so GridCue never filters it.";

/**
 * Why a column the schema lets GridCue filter can't hold GridCue's filters, or `undefined` when it can: AG Grid must
 * filter its own cell, with its own filter for the column's kind and every filter setting `gridcueColumnDefs` gives
 * the column (spec 5.6).
 */
const filterIssue = (column: ColumnDescriptor, def: AgColDefLike, expected: GridcueColDef): string | undefined => {
  const name = `the column “${column.id}”`;
  // GridCue's filter means the column's cell, read from the row: AG Grid would filter another value.
  if (def.filterValueGetter !== undefined && def.filterValueGetter !== null) {
    return `${name} has a filterValueGetter, so AG Grid filters another value than its cell, which GridCue's filters mean. Take filterValueGetter off the column, ${NOT_FILTERED}`;
  }
  if (def.valueGetter !== undefined && def.valueGetter !== null) {
    return `${name} has a valueGetter, so AG Grid filters a value GridCue doesn't read from the row. Give the column a field that holds that value, ${NOT_FILTERED}`;
  }
  const { filter } = def;
  if (filter === undefined || filter === null || filter === false)
    return `${name} has no filter, so it doesn't carry gridcueColumnDefs' settings. ${FIX}`;
  const named = typeof filter === "string" ? AG_FILTERS[filter] : undefined;
  if (filter !== true && !named) {
    return `${name} has a filter of its own, which GridCue can't write. Use AG Grid's own filter on it, from gridcueColumnDefs, ${NOT_FILTERED}`;
  }
  const needs = filterTypeOf(column.kind);
  const gets = named ?? filterTypeForDataType(def.cellDataType);
  if (gets !== needs) {
    const why =
      filter === true
        ? `its cellDataType is ${def.cellDataType === undefined || def.cellDataType === false ? "not set" : `“${String(def.cellDataType)}”`}, so AG Grid gives it the ${FILTER_NAMES[gets]} filter`
        : `it uses AG Grid's ${FILTER_NAMES[gets]} filter`;
    return `${name} holds ${column.kind} values in the schema, but ${why}. Set cellDataType on the column to match, as the Infinite Row Model needs, or fix its kind in the schema.`;
  }
  const params = (typeof def.filterParams === "object" && def.filterParams !== null ? def.filterParams : {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected.filterParams ?? {})) {
    if (!same(params[key], value)) {
      return `${name} doesn't carry gridcueColumnDefs' filter settings: its filterParams.${key} isn't the one gridcueColumnDefs gives it for this schema. Build gridcueColumnDefs from the schema the adapter gets, and leave ${key} out of the column's own filterParams, ${NOT_FILTERED}`;
    }
  }
  return undefined;
};

/** Checks every schema column is a column of the grid, and every one GridCue may filter carries GridCue's filter settings. */
const checkColumns = (schema: ViewSchema, api: AgGridApiLike) => {
  const settingsOf = columnSettings(schema);
  const found = schema.columns.map((column) => {
    const inGrid = api.getColumn(column.id);
    if (!inGrid) {
      throw new GridCueError(
        "INPUT_CONFIG",
        `The schema names “${column.id}”, which is not a column of this grid. Give the column that colId, or leave it out of the schema.`,
      );
    }
    return [column, inGrid] as const;
  });
  for (const [column, inGrid] of found) {
    if (!filtersColumn(column)) continue;
    const issue = filterIssue(column, inGrid.getColDef() ?? {}, settingsOf(column));
    if (issue) throw new GridCueError("INPUT_CONFIG", `The grid can't hold GridCue's filters: ${issue}`);
  }
};

/** What a View State holds that this adapter lists no operation for, as words for a message, or `undefined`. */
const unkeptPart = (state: ViewState): string | undefined => {
  if ((state.pinnedColumnIds?.start.length ?? 0) > 0 || (state.pinnedColumnIds?.end.length ?? 0) > 0) return "pinned columns";
  if ((state.aggregations?.length ?? 0) > 0) return "totals";
  if (state.density !== undefined && state.density !== emptyViewState([]).density) return `the density “${state.density}”`;
  // A count written as `null`, as a saved view may write “no count”, is no count, as on the Query Adapter.
  if (state.limit !== undefined && state.limit !== null) return "a count";
  return undefined;
};

/** The filters GridCue wrote: the View State's tree, and the model it wrote for each column. */
interface Owned {
  tree: FilterGroup | null;
  models: ReadonlyMap<string, string>;
}

/** `tree` without the predicates on `columns`, or `null` when nothing is left. */
const without = (tree: FilterGroup | null, columns: ReadonlySet<string>): FilterGroup | null => {
  if (!tree || columns.size === 0) return tree;
  const children = tree.children.flatMap((child): FilterGroup["children"] => {
    if (child.type === "predicate") return columns.has(child.columnId) ? [] : [child];
    const kept = without(child, columns);
    return kept ? [kept] : [];
  });
  return children.length > 0 ? { ...tree, children } : null;
};

/** `tree` and the filters read from the grid's menu, joined with AND. */
const withRead = (tree: FilterGroup | null, read: FilterGroup["children"]): FilterGroup | null => {
  if (read.length === 0) return tree;
  if (tree?.combinator === "and") return { ...tree, children: [...tree.children, ...read] };
  return { id: "ag-grid:root", type: "group", combinator: "and", children: [...(tree ? [tree] : []), ...read] };
};

/**
 * A Grid Adapter over AG Grid Community, on the Client-Side or the Infinite Row Model (more grids spec, 5.6; ADR 0033).
 * It writes filters into AG Grid's own column filters, which `gridcueColumnDefs(schema, columnDefs)` sets up, and sorts,
 * hidden columns and order through the column state. It lists the MVP operations without `group.set`: AG Grid
 * Community can't group.
 *
 * One apply writes the filter model and the column state, reads both back, and is done only when the grid holds what
 * was written (ADR 0031). AG Grid reads both back at once, so there is no wait. A write the grid doesn't hold, such as a
 * model it drops or cuts short, is put back and fails with `ADAPTER_FAILED`. A filter AG Grid can't hold, such as an OR
 * across columns, a list beside another filter on its column, or a time of day on a date, fails with
 * `ADAPTER_UNSUPPORTED_FILTER` before anything is written. Revisions read `ag-grid:n`; the default state is the grid's
 * view when the adapter is made.
 *
 * A filter the User sets in AG Grid's menu is read into the View State (`read.ts`), so the Preview, "clear the
 * filters" and undo see it: each column's menu offers only the options GridCue reads there. What GridCue doesn't change
 * stays the Host's: the grid's pins, an Enterprise grouping (read into the View State, never written, so `restore`
 * refuses a snapshot with another), the sorts of columns not in the schema, and any filter GridCue can't read, such as
 * text that names no value of an enum, which it leaves out of the View State and keeps on every write. A GridCue filter
 * on a column holding one fails with `ADAPTER_UNSUPPORTED_FILTER`.
 *
 * At creation it checks the grid has every call it uses, every schema column is a column of the grid, and every column
 * the schema lets GridCue filter filters its own cell (no `valueGetter` or `filterValueGetter`) and carries the filter
 * settings `gridcueColumnDefs` gives it; each fails with `INPUT_CONFIG`, by name.
 */
export const createAgGridAdapter = (options: AgGridAdapterOptions): GridAdapter => {
  const { schema, maxSorts = 3 } = options;
  const api = checkApi(options?.api);
  checkColumns(schema, api);
  const schemaIds = new Set(schema.columns.map((c) => c.id));
  const operations = MVP_OPERATIONS.filter((op) => op !== "group.set");

  let owned: Owned = { tree: null, models: new Map() };

  /**
   * The grid's filter model, sorted three ways (spec 5.6, "Reading back"). `own`: the columns whose entry GridCue wrote
   * and the grid still holds as written; the View State keeps those filters as they were asked for. `read`: every other
   * entry the reader reads, as filters: one the User set in AG Grid's menu, a menu change to GridCue's own included.
   * `theirs`: the entries GridCue can't read, which stay the Host's.
   */
  const heldFilters = () => {
    const model = api.getFilterModel() ?? {};
    const own = new Set(
      [...owned.models].filter(([id, text]) => Object.hasOwn(model, id) && canonical(model[id]) === text).map(([id]) => id),
    );
    const read: FilterGroup["children"] = [];
    const theirs: Record<string, unknown> = {};
    const columns = new Map(schema.columns.map((c) => [c.id, c]));
    // The schema's column order, then the entries of columns outside it, so the same model always reads the same.
    for (const id of [...schema.columns.map((c) => c.id), ...Object.keys(model).filter((key) => !columns.has(key))]) {
      if (!Object.hasOwn(model, id) || own.has(id)) continue;
      const column = columns.get(id);
      const filters = column ? readColumnModel(model[id], column) : undefined;
      if (filters) read.push(...filters);
      else theirs[id] = model[id];
    }
    return { model, own, read, theirs };
  };

  /**
   * The View State the grid holds now. Its filters are the ones GridCue wrote that the grid still holds as written, and
   * the ones the reader reads from the rest. A filter GridCue can't read is left out: it is the Host's.
   */
  const read = (): ViewState => {
    const filters = heldFilters();
    const lost = new Set([...owned.models.keys()].filter((id) => !filters.own.has(id)));
    const columns = api.getColumnState().filter((c) => schemaIds.has(c.colId));
    const order = columns.map((c) => c.colId);
    const ranked = (key: "sortIndex" | "rowGroupIndex") => (c: AgColumnStateLike) => c[key] ?? Number.MAX_SAFE_INTEGER;
    const sorts: SortSpec[] = columns
      .filter((c) => c.sort === "asc" || c.sort === "desc")
      .sort((a, b) => ranked("sortIndex")(a) - ranked("sortIndex")(b))
      .map((c) => ({ columnId: c.colId, direction: c.sort as SortSpec["direction"] }));
    const groupBy = columns
      .filter((c) => c.rowGroup === true)
      .sort((a, b) => ranked("rowGroupIndex")(a) - ranked("rowGroupIndex")(b))
      .map((c) => c.colId);
    return {
      ...emptyViewState(order),
      visibleColumnIds: columns.filter((c) => c.hide !== true).map((c) => c.colId),
      filters: structuredClone(withRead(without(owned.tree, lost), filters.read)),
      sorts,
      groupBy,
    };
  };

  let n = 0;
  let held = read();
  let fingerprint = JSON.stringify(held);
  const listeners = new Set<(s: VersionedViewState) => void>();
  const current = (): VersionedViewState => ({ revision: `ag-grid:${n}`, state: structuredClone(held) });
  const notify = (snapshot: VersionedViewState) => {
    for (const l of listeners) l(snapshot);
  };
  /** Reads the grid, and counts and reports a change since the last read. A destroyed grid keeps its last view. */
  const sync = () => {
    if (api.isDestroyed()) return;
    const state = read();
    const next = JSON.stringify(state);
    if (next === fingerprint) return;
    held = state;
    fingerprint = next;
    n++;
    notify(current());
  };
  /**
   * True while `write` runs: an event the grid fires inside it, or a Host that reads the state from a grid callback,
   * would see and report half a write. `write` reads the grid after, or puts it back.
   */
  let writing = false;
  /** The grid's View State. Inside a write, the last one reported, since the grid holds half the change. */
  const fresh = (): VersionedViewState => {
    if (!writing) sync();
    return current();
  };
  const defaultState = structuredClone(held);
  for (const event of EVENTS)
    api.addEventListener(event, () => {
      if (!writing) sync();
    });

  /** The column state that holds `next`'s order, hidden columns and sorts, leaving every other column state as it is. */
  const columnStateFor = (next: ViewState, before: readonly AgColumnStateLike[]): AgColumnStateLike[] => {
    const inGrid = before.filter((c) => schemaIds.has(c.colId)).map((c) => c.colId);
    const ours = [...next.columnOrder.filter((id) => inGrid.includes(id)), ...inGrid.filter((id) => !next.columnOrder.includes(id))];
    let slot = 0;
    const order = before.map((c) => (schemaIds.has(c.colId) ? (ours[slot++] as string) : c.colId));
    const sortAt = new Map(next.sorts.map((s, i) => [s.columnId, i]));
    // A sort on a column outside the schema is the Host's: it stays, after GridCue's sorts.
    const theirs = before
      .filter((c) => !schemaIds.has(c.colId) && (c.sort === "asc" || c.sort === "desc"))
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    return order.map((colId) => {
      if (schemaIds.has(colId)) {
        const at = sortAt.get(colId);
        const sort = at === undefined ? null : (next.sorts[at]?.direction ?? null);
        return { colId, hide: !next.visibleColumnIds.includes(colId), sort, sortIndex: at ?? null };
      }
      const host = theirs.findIndex((c) => c.colId === colId);
      const own = theirs[host];
      return own ? { colId, sort: own.sort ?? null, sortIndex: next.sorts.length + host } : { colId, sort: null, sortIndex: null };
    });
  };

  const write = (target: ViewState): ApplyResult => {
    // The adapter lists no pins, totals, density or count, so its View State never holds one. A snapshot that does came
    // from another grid, and this one can't hold it.
    const unkept = unkeptPart(target);
    if (unkept) return { ok: false, code: "ADAPTER_NOT_APPLICABLE", message: `This view holds ${unkept}, which this grid can't keep.` };
    sync();
    // The filters GridCue can't read are the Host's, and stay. Every other entry is in the View State, as GridCue's own
    // or as read from the menu, so the target says what becomes of it.
    const { model, theirs } = heldFilters();
    const before = { filters: model, columns: api.getColumnState(), owned };
    let ours: Map<string, AgColumnModel>;
    try {
      ours = toFilterModel(target.filters, schema);
    } catch (error) {
      if (!(error instanceof Unwritable)) throw error;
      return { ok: false, code: "ADAPTER_UNSUPPORTED_FILTER", message: error.message };
    }
    const taken = [...ours.keys()].find((id) => Object.hasOwn(theirs, id));
    if (taken !== undefined) {
      const label = schema.columns.find((c) => c.id === taken)?.label ?? taken;
      return {
        ok: false,
        code: "ADAPTER_UNSUPPORTED_FILTER",
        message: `${label} holds a filter GridCue can't read, so GridCue leaves it as it is and can't add one there.`,
      };
    }
    const filterModel = { ...theirs, ...Object.fromEntries(ours) };
    const columnState = columnStateFor(target, before.columns);
    // What the grid must read back: the filters, order, hidden columns and sorts written; the grouping it holds.
    const expected: ViewState = {
      ...emptyViewState(columnState.map((c) => c.colId).filter((id) => schemaIds.has(id))),
      visibleColumnIds: columnState.filter((c) => schemaIds.has(c.colId) && c.hide !== true).map((c) => c.colId),
      filters: target.filters ? structuredClone(target.filters) : null,
      sorts: target.sorts.map((s) => ({ ...s })),
      groupBy: [...held.groupBy],
    };

    /** Puts the grid back as it was, so nothing changed, and says whether it is. */
    const putBack = (): boolean => {
      owned = before.owned;
      try {
        api.setFilterModel(before.filters);
        api.applyColumnState({
          state: before.columns.map((c) => ({
            colId: c.colId,
            hide: c.hide ?? false,
            sort: c.sort ?? null,
            sortIndex: c.sortIndex ?? null,
          })),
          applyOrder: true,
          defaultState: { sort: null },
        });
        return JSON.stringify(read()) === fingerprint;
      } catch {
        return false;
      }
    };
    const notPutBack = (why: string) => {
      sync();
      return new GridCueError("ADAPTER_FAILED", `${why}, and the grid couldn't be put back as it was.`);
    };

    writing = true;
    try {
      owned = { tree: expected.filters, models: new Map([...ours].map(([id, model]) => [id, canonical(model)])) };
      try {
        api.setFilterModel(filterModel);
        api.applyColumnState({ state: columnState, applyOrder: true, defaultState: { sort: null } });
      } catch (error) {
        // Such as a Host's comparator that throws: the error is the Host's, once the grid is as it was.
        if (!putBack()) throw notPutBack("AG Grid failed in the change");
        throw error;
      }
      // AG Grid reads both back in the same tick, and drops or cuts a model it can't hold (spike, Q2f).
      const filtersHeld = canonical(api.getFilterModel() ?? {}) === canonical(filterModel);
      const now = read();
      if (filtersHeld && canonical(now) === canonical({ ...expected, groupBy: now.groupBy })) {
        sync();
        return { ok: true, state: current() };
      }
      if (!putBack()) throw notPutBack("AG Grid didn't hold the change");
      return { ok: false, code: "ADAPTER_FAILED", message: "AG Grid didn't hold the change, so nothing was changed." };
    } finally {
      writing = false;
    }
  };

  return {
    getSchema: () => schema,
    getCapabilities: () => ({
      operations: [...operations],
      maxSorts,
      supportsAtomicApply: true,
      supportsSnapshotRestore: true,
      observesChanges: true,
    }),
    getState: fresh,
    getDefaultState: () => structuredClone(defaultState),
    async apply(plan) {
      if (!isApplicable(plan)) return { ok: false, code: "ADAPTER_NOT_APPLICABLE", message: "Only validated plans can be applied." };
      if (api.isDestroyed()) return { ok: false, code: "ADAPTER_FAILED", message: "The grid is destroyed." };
      if (plan.baseRevision !== fresh().revision) return { ok: false, code: "ADAPTER_STALE_REVISION", message: "The view changed first." };
      const unlisted = plan.operations.find((op) => !operations.includes(op.type));
      if (unlisted)
        return { ok: false, code: "ADAPTER_NOT_APPLICABLE", message: `This grid doesn't list ${unlisted.type}, so the plan can't apply.` };
      return write(resultingState(plan));
    },
    async restore(snapshot) {
      if (api.isDestroyed()) return { ok: false, code: "ADAPTER_FAILED", message: "The grid is destroyed." };
      sync();
      // GridCue never writes a grouping: Community has none, and an Enterprise grouping stays the User's. So the grid
      // holds a snapshot only with the grouping it has, which every snapshot this adapter took has: undo runs only
      // while the grid is as the apply left it. One with another grouping came from elsewhere.
      if (JSON.stringify(snapshot.state.groupBy ?? []) !== JSON.stringify(held.groupBy)) {
        const message =
          held.groupBy.length === 0
            ? "This view holds a grouping, which this grid can't keep."
            : "This view groups rows another way than the grid, and GridCue never changes the grid's grouping.";
        return { ok: false, code: "ADAPTER_NOT_APPLICABLE", message };
      }
      return write(structuredClone(snapshot.state));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

// --- schemaFromAgGrid --------------------------------------------------------------------------------------------------

/**
 * The kind a column's `cellDataType` names, when it names one. AG Grid's `date` is any `Date` object, a time of day
 * included (it infers `date` for every one), so the sample rows say whether it is a date or a date and time.
 */
const KIND_OF_DATA_TYPE: Readonly<Record<string, ColumnKind>> = {
  text: "string",
  number: "number",
  boolean: "boolean",
  dateString: "date",
  dateTime: "datetime",
  dateTimeString: "datetime",
};

/**
 * True when AG Grid filters the column's own cell with its own text, number or date filter, or the one
 * `gridcueColumnDefs` gives it: no `filterValueGetter` or `valueGetter` gives it another value to filter.
 */
const filtersWithAgGrid = (def: AgColDefLike): boolean => {
  const { filter } = def;
  if (def.filterValueGetter != null || def.valueGetter != null) return false;
  return filter === undefined || filter === null || filter === true || (typeof filter === "string" && filter in AG_FILTERS);
};

/** A cell from a row at a column's `field`, which may be a path such as "market.value". */
const valueAt = (row: Record<string, unknown>, field: string): unknown => {
  if (Object.hasOwn(row, field)) return row[field];
  let value: unknown = row;
  for (const part of field.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
};

const leaves = (defs: ReadonlyArray<AgColDefLike | AgColGroupDefLike>): AgColDefLike[] =>
  defs.flatMap((def) => ("children" in def && Array.isArray(def.children) ? leaves(def.children) : [def as AgColDefLike]));

/**
 * Builds a GridCue schema from a grid's column definitions, column groups included, and a sample of its rows (spec 5.6).
 * A column's id is its `colId`, else its `field`; a column with neither is left out. Its label is its `headerName`. Its
 * kind is from `options.columns`, else its `cellDataType`, else its sample cells, read at its `field`. A column whose
 * filter is `false` or not AG Grid's own text, number or date filter (a custom component, or an Enterprise filter), or
 * that has a `valueGetter` or `filterValueGetter`, so that AG Grid filters a value the sample rows don't hold, gets no
 * `filter` capability, so GridCue never offers it; one with `sortable: false` gets no `sort`. The rest are core's
 * defaults; the adapter's operations decide what reaches the grid. Capabilities the Host names in `options.columns`
 * replace these, and the adapter checks them against the grid when it is made.
 */
export const schemaFromAgGrid = (columnDefs: ReadonlyArray<AgColDefLike | AgColGroupDefLike>, options: SchemaOptions = {}): ViewSchema => {
  const defs = leaves(columnDefs).filter((def) => typeof (def.colId ?? def.field) === "string" && (def.colId ?? def.field) !== "");
  const idOf = (def: AgColDefLike) => (def.colId ?? def.field) as string;
  const sampleRows = (options.sampleRows ?? []).map((row) =>
    Object.fromEntries(defs.map((def) => [idOf(def), def.field === undefined ? undefined : valueAt(row, def.field)])),
  );
  const columns: ColumnInput[] = defs.map((def) => {
    const kind = typeof def.cellDataType === "string" ? KIND_OF_DATA_TYPE[def.cellDataType] : undefined;
    return { id: idOf(def), ...(typeof def.headerName === "string" ? { label: def.headerName } : {}), ...(kind ? { kind } : {}) };
  });
  // Read once for each column's kind and default capabilities, then take away what the column definition rules out.
  const { houseTerms: _later, ...rest } = options;
  const read = defineSchema(columns, { ...rest, sampleRows });
  // `Date` objects whose sample cells read as no date and time, or that no sample row holds, are dates.
  defs.forEach((def, i) => {
    if (def.cellDataType === "date" && read.columns[i]?.kind !== "datetime") columns[i] = { ...columns[i], id: idOf(def), kind: "date" };
  });
  const overrides = Object.fromEntries(
    defs.map((def, i) => {
      const own = options.columns?.[idOf(def)] ?? {};
      if (own.capabilities) return [idOf(def), own];
      const capabilities = (read.columns[i]?.capabilities ?? []).filter(
        (c) => !(c === "filter" && !filtersWithAgGrid(def)) && !(c === "sort" && def.sortable === false),
      );
      return [idOf(def), { ...own, capabilities }];
    }),
  );
  return defineSchema(columns, { ...options, columns: { ...options.columns, ...overrides }, sampleRows });
};
