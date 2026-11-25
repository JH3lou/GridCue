import { MVP_OPERATIONS } from "../src/core/adapter";
import { operatorsFor } from "../src/core/columns";
import {
  type AggregationSpec,
  type ColumnCapability,
  type ColumnDescriptor,
  emptyViewState,
  type FilterOperator,
  type FilterPredicate,
  type FilterValue,
  type Scalar,
  type ViewCapabilities,
  type ViewOperation,
  type ViewSchema,
  type ViewState,
} from "../src/core/protocol";
import { totalKindIssue } from "../src/core/validate";

/**
 * The seeded view generator (operation set spec, 5.4; order plan, section 9). A seed and a View Schema in, a View
 * State out: one a User could reach on that schema, from the default view, with validated plans. It holds filters,
 * sorts, a grouping of one or two levels, hidden and pinned columns, totals, a count and a density, each only where the
 * schema's column capabilities and the grid's operations allow. A total is never on a column the view groups by. The same seed and schema give the same view on any
 * machine: it draws from its own seeded sequence and never from `Math.random`.
 *
 * The package's tests import it from here, and `evals/` from `../packages/gridcue/test/view-generator`. The
 * rendered-rows test is its first user. `proposeView`'s property test, the command bar's tests and the four bets'
 * round trip reuse it (order plan): pass the grid's capabilities, and rows when filters should keep some of them.
 *
 * It starts from no generator in the repo: the four bets' first test generator was kept outside it, and none of the
 * repo's tests had a view generator. The seeded sequence is mulberry32, as the dates tests use.
 */
export interface ViewGeneratorOptions {
  /**
   * What the grid can do. Left out: every operation the Rows Adapter lists with every `renders`, at most 3 sorts and
   * 2 grouping levels. `aggregationFunctions` left out means a sum and an average, as validation reads it.
   */
  capabilities?: Pick<ViewCapabilities, "operations" | "maxSorts" | "maxGroups" | "aggregationFunctions">;
  /** Rows to take filter values from, so a filter keeps some of them. Left out, values come from each column's kind. */
  rows?: ReadonlyArray<object>;
  /** True: always grouped. False: never. Left out: either. */
  grouped?: boolean;
  /**
   * True: always a count, where the grid lists `limit.set`, beside a sort as a request sets one (a sort is drawn when
   * the view has none). False: never. Left out: sometimes, beside a sort the view already has.
   */
  counted?: boolean;
  /** The counts to draw from. Left out: 1 to 20. */
  counts?: readonly number[];
}

/** A seeded sequence of numbers in [0, 1): mulberry32. The same seed gives the same sequence everywhere. */
export const seededRandom = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const EVERY_OPERATION = [...MVP_OPERATIONS, "limit.set", "columns.pin", "density.set", "aggregation.set"];
const DENSITIES: ReadonlyArray<ViewState["density"]> = ["compact", "comfortable", "spacious"];
const NUMERIC = new Set(["number", "currency", "percent"]);

/** A View State for `schema`, drawn from `seed`. See the module's comment. */
export const generateView = (seed: number, schema: ViewSchema, options: ViewGeneratorOptions = {}): ViewState => {
  const random = seededRandom(seed);
  const chance = (p: number) => random() < p;
  const below = (n: number) => Math.floor(random() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;
  const shuffled = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = below(i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  const caps = options.capabilities ?? { operations: EVERY_OPERATION, maxSorts: 3, maxGroups: 2 };
  const lists = (op: string) => caps.operations.includes(op);
  const able = (capability: ColumnCapability) =>
    schema.columns.filter((c) => c.sensitivity !== "restricted" && c.capabilities.includes(capability));

  const state = emptyViewState(schema.columns.map((c) => c.id));

  // Column order: some columns that may move go first, in a drawn order; the rest keep theirs (one `columns.order`).
  const movable = able("reorder").map((c) => c.id);
  if (lists("columns.order") && movable.length > 1 && chance(0.5)) {
    const front = shuffled(movable).slice(0, 1 + below(movable.length));
    state.columnOrder = [...front, ...state.columnOrder.filter((id) => !front.includes(id))];
  }
  // Hidden columns, never all of them.
  const hidden = new Set(
    lists("columns.hide")
      ? able("hide")
          .filter(() => chance(0.2))
          .map((c) => c.id)
      : [],
  );
  const visible = state.columnOrder.filter((id) => !hidden.has(id));
  state.visibleColumnIds = visible.length > 0 ? visible : [...state.columnOrder];
  // Pins: up to two at the start and one at the end. A hidden column may keep a pin.
  if (lists("columns.pin")) {
    const pool = shuffled(able("pin").map((c) => c.id));
    const start = pool.slice(0, below(3));
    const end = pool.slice(start.length, start.length + below(2));
    state.pinnedColumnIds = { start, end };
  }
  // Filters: up to three, all of which must hold.
  if (lists("filter.add")) {
    const filterable = able("filter").filter((c) => operatorsFor(c).length > 0);
    const count = filterable.length === 0 ? 0 : below(4);
    const children: FilterPredicate[] = [];
    for (let i = 0; i < count; i++) {
      const column = pick(filterable);
      const operator = pick(operatorsFor(column));
      const value = filterValue(column, operator, options.rows, random);
      children.push({ id: `f${i}`, type: "predicate", columnId: column.id, operator, ...(value === undefined ? {} : { value }) });
    }
    if (children.length > 0) state.filters = { id: "root", type: "group", combinator: "and", children };
  }
  // Totals: up to two, each a function its column's kind takes and the grid applies.
  if (lists("aggregation.set")) {
    const applies = caps.aggregationFunctions ?? ["sum", "avg"];
    const totals: AggregationSpec[] = [];
    for (const column of shuffled(able("aggregate")).slice(0, below(3))) {
      const fits = applies.filter((fn) => totalKindIssue(column, fn) === undefined);
      if (fits.length > 0) totals.push({ columnId: column.id, function: pick(fits) });
    }
    state.aggregations = totals;
  }
  // Groups: one or two levels.
  const groupable = able("group").map((c) => c.id);
  const maxGroups = Math.min(2, caps.maxGroups ?? 2, groupable.length);
  if (lists("group.set") && maxGroups > 0 && options.grouped !== false && (options.grouped || chance(0.5))) {
    state.groupBy = shuffled(groupable).slice(0, 1 + below(maxGroups));
  }
  // No total on a column the view groups by: a group row shows its own value there, and validation refuses it.
  state.aggregations = state.aggregations.filter((a) => !state.groupBy.includes(a.columnId));
  // Sorts. When the view has a total, its column is often the first sort, so groups often order by a total.
  const sortable = able("sort").map((c) => c.id);
  const maxSorts = Math.min(caps.maxSorts ?? 3, sortable.length);
  if (lists("sort.set") && maxSorts > 0 && chance(0.8)) {
    const sorts = shuffled(sortable).slice(0, 1 + below(maxSorts));
    const totalled = state.aggregations.map((a) => a.columnId).filter((id) => sortable.includes(id));
    if (totalled.length > 0 && chance(0.5)) {
      const first = pick(totalled);
      sorts.splice(sorts.indexOf(first) >= 0 ? sorts.indexOf(first) : sorts.length - 1, 1);
      sorts.unshift(first);
    }
    state.sorts = sorts.map((columnId) => ({ columnId, direction: chance(0.5) ? "asc" : "desc" }));
  }
  // A count, only beside a sort, as a request sets one. Left to chance, it draws exactly as it did before `counted`.
  if (lists("limit.set") && options.counted !== false) {
    if (options.counted && state.sorts.length === 0 && lists("sort.set") && sortable.length > 0) {
      state.sorts = [{ columnId: pick(sortable), direction: chance(0.5) ? "asc" : "desc" }];
    }
    if (state.sorts.length > 0 && (options.counted || chance(0.3))) {
      state.limit = options.counts?.length ? pick(options.counts) : 1 + below(20);
    }
  }
  if (lists("density.set")) state.density = pick(DENSITIES);
  return state;
};

/** A filter value of the column's kind for the operator, from a row when one has a value that fits. */
const filterValue = (
  column: ColumnDescriptor,
  operator: FilterOperator,
  rows: ViewGeneratorOptions["rows"],
  random: () => number,
): FilterValue | undefined => {
  if (operator === "isEmpty" || operator === "isNotEmpty") return undefined;
  const below = (n: number) => Math.floor(random() * n);
  const one = (): Scalar => {
    const held = (rows ?? []).map((r) => (r as Record<string, unknown>)[column.id]).filter((v) => fits(v, column));
    const taken = held.length > 0 && random() < 0.9 ? (held[below(held.length)] as Scalar) : drawn(column, random);
    if ((operator === "contains" || operator === "startsWith") && typeof taken === "string" && taken.length > 1) {
      const from = operator === "startsWith" ? 0 : below(taken.length - 1);
      return taken.slice(from, from + 1 + below(taken.length - from));
    }
    return taken;
  };
  if (operator === "in") return Array.from({ length: 1 + below(3) }, one);
  if (operator === "between") {
    const [a, b] = [one(), one()];
    const low = (a as number | string) <= (b as number | string);
    return { min: low ? a : b, max: low ? b : a };
  }
  return one();
};

/** Whether a row's cell can be a filter value on this column, as validation reads a value. */
const fits = (v: unknown, column: ColumnDescriptor): boolean => {
  if (NUMERIC.has(column.kind)) return typeof v === "number" && Number.isFinite(v);
  if (column.kind === "boolean") return typeof v === "boolean";
  if (column.kind === "date") return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (column.kind === "datetime") return typeof v === "string" && !Number.isNaN(Date.parse(v));
  if (column.kind === "enum") return typeof v === "string" && (!column.enumValues || column.enumValues.some((e) => e.id === v));
  return typeof v === "string" && v.length > 0;
};

/** A value of the column's kind with no row to take it from. */
const drawn = (column: ColumnDescriptor, random: () => number): Scalar => {
  const below = (n: number) => Math.floor(random() * n);
  switch (column.kind) {
    case "number":
    case "currency":
      return Math.round((random() - 0.3) * 2_000_000) / 100;
    case "percent":
      return Math.round(random() * 10_000) / 10_000;
    case "boolean":
      return random() < 0.5;
    case "date":
      return `2026-${String(1 + below(12)).padStart(2, "0")}-${String(1 + below(28)).padStart(2, "0")}`;
    case "datetime":
      return new Date(Date.UTC(2026, below(12), 1 + below(28), below(24), below(60))).toISOString();
    case "enum":
      return column.enumValues?.length ? (column.enumValues[below(column.enumValues.length)]?.id ?? "") : `value ${below(5)}`;
    default:
      return `${column.label} ${below(10)}`;
  }
};

/**
 * The operations that reach `state` from the default view, in the order a User could ask for them: a reset, then one
 * operation for each part the view holds. `validatePlan` on them, from the default view, gives `state` exactly, which
 * is what makes a generated view reachable; the generator's own test checks it.
 */
export const operationsFor = (state: ViewState, schema: ViewSchema): ViewOperation[] => {
  const defaults = emptyViewState(schema.columns.map((c) => c.id));
  const ops: ViewOperation[] = [{ type: "view.reset" }];
  // The fewest columns that, moved to the front, give the order: `columns.order` keeps the rest in theirs.
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
  for (let k = 0; k <= state.columnOrder.length; k++) {
    const moved = state.columnOrder.slice(0, k);
    if (!same([...moved, ...defaults.columnOrder.filter((id) => !moved.includes(id))], state.columnOrder)) continue;
    if (k > 0) ops.push({ type: "columns.order", columnIds: moved });
    break;
  }
  const hidden = state.columnOrder.filter((id) => !state.visibleColumnIds.includes(id));
  if (hidden.length > 0) ops.push({ type: "columns.hide", columnIds: hidden });
  if (state.pinnedColumnIds.start.length > 0) ops.push({ type: "columns.pin", columnIds: state.pinnedColumnIds.start, position: "start" });
  if (state.pinnedColumnIds.end.length > 0) ops.push({ type: "columns.pin", columnIds: state.pinnedColumnIds.end, position: "end" });
  for (const child of state.filters?.children ?? []) {
    if (child.type === "predicate") ops.push({ type: "filter.add", combineWith: "and", predicate: child });
  }
  if (state.aggregations.length > 0) ops.push({ type: "aggregation.set", aggregations: state.aggregations });
  if (state.groupBy.length > 0) ops.push({ type: "group.set", columnIds: state.groupBy });
  if (state.sorts.length > 0) ops.push({ type: "sort.set", sorts: state.sorts });
  if (state.limit !== undefined) ops.push({ type: "limit.set", count: state.limit });
  if (state.density !== defaults.density) ops.push({ type: "density.set", density: state.density });
  return ops;
};
