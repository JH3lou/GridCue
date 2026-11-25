import type { GridAdapter } from "./adapter";
import { MVP_OPERATIONS } from "./adapter";
import { isEmpty, matchesFilter } from "./evaluate";
import type { AggregationSpec, Scalar, SortSpec, VersionedViewState, ViewSchema, ViewState } from "./protocol";
import { createStateAdapter, renderedOperations } from "./state-adapter";
import { TotalCells } from "./totals";

export interface RowsAdapterOptions {
  schema: ViewSchema;
  initialState?: ViewState;
  maxSorts?: number;
  maxGroups?: number;
  /**
   * What the Host's table draws from `applyView`'s result beyond its rows and columns (operation set spec, 4.2; ADR
   * 0029): `"pinning"` when it keeps `pinned` columns in place, `"density"` when it sets its row height from `density`,
   * `"totals"` when it draws `totals` and each group's `totals`. The adapter lists `columns.pin`, `density.set` and
   * `aggregation.set` only for what this names. The default is none, and a request for any of them then asks "This grid
   * can't …" and changes nothing. Name only what the table draws: GridCue can't check it. Any other name throws
   * `INPUT_CONFIG`.
   */
  renders?: ReadonlyArray<"pinning" | "density" | "totals">;
}

export interface RowsAdapter extends GridAdapter {
  /** For the Host's own controls, such as clicking a column header. Bumps the revision. */
  setState(update: (state: ViewState) => ViewState): VersionedViewState;
}

/**
 * A Grid Adapter for Hosts that keep rows in memory. Pair it with `applyView` and any table. For rows on a server, see
 * `createQueryAdapter`.
 */
export const createRowsAdapter = (options: RowsAdapterOptions): RowsAdapter => {
  const rendered = renderedOperations(options.renders, {
    adapter: "the Rows Adapter",
    takes: ["pinning", "density", "totals"],
    refused: { count: "renders names “count”: the Rows Adapter keeps a count with no option. Leave it out." },
    // The Rows Adapter's messages are as they were before the shared holder (more grids plan, task 4.2).
    nameOf: String,
  });
  return createStateAdapter({
    schema: options.schema,
    initialState: options.initialState,
    maxSorts: options.maxSorts,
    maxGroups: options.maxGroups,
    // The rows are all in memory, so a count ("top 10") is exact here (ADR 0018).
    operations: [...MVP_OPERATIONS, "limit.set", ...rendered],
    revisionPrefix: "rows",
  });
};

export interface ViewResult<Row> {
  /**
   * Visible column IDs, in display order: the columns pinned to the start first, in their pin order, then the others in
   * the column order, then the columns pinned to the end, in their pin order.
   */
  columns: string[];
  /**
   * The visible columns pinned to the start and to the end, each in its pin order, for the Host to keep in place while
   * the rest scroll. A hidden pinned column is in neither: it keeps its pin in the View State and shows again with it.
   */
  pinned: { start: string[]; end: string[] };
  /** The row height the view asks for, for the Host to draw. */
  density: ViewState["density"];
  /** Filtered and sorted rows. */
  rows: Row[];
  /**
   * One for each Total of the view, in the view's order, over every row it shows: after its filters and its count.
   * Empty when the view has none. With a grouping the Host draws each group's own; without, these once for the view.
   */
  totals: TotalValue[];
  /**
   * Present when the view is grouped: one entry per distinct key, with its rows sorted as the view sorts and its own
   * totals. Groups are in one order for every Grid Adapter (operation set spec, 5.4; ADR 0030): a sort on a column with
   * a total orders them by that total, and a sort on a grouping column by that column. Otherwise they keep the order
   * they first appear in the rows the view shows, in the Host's order. With two levels, the groups of one outer group
   * sit together, and each level is ordered by its own totals, taken over its rows.
   */
  groups?: Array<{ key: Record<string, Scalar>; rows: Row[]; totals: TotalValue[] }>;
}

/**
 * A Total's value. `value` is `null` when no row it counts holds a value, never 0. A sum and an average are computed by
 * `totalOf` (`core/totals.ts`); the Rows Adapter applies no other function, and gives any other `null`.
 */
export interface TotalValue {
  columnId: string;
  function: AggregationSpec["function"];
  value: number | null;
}

/** The visible columns in display order, and which of them are pinned (operation set spec, 5.3). */
const placeColumns = (state: ViewState): Pick<ViewResult<never>, "columns" | "pinned"> => {
  const visible = state.columnOrder.filter((id) => state.visibleColumnIds.includes(id));
  const start = [...new Set(state.pinnedColumnIds.start)].filter((id) => visible.includes(id));
  const end = [...new Set(state.pinnedColumnIds.end)].filter((id) => visible.includes(id) && !start.includes(id));
  const middle = visible.filter((id) => !start.includes(id) && !end.includes(id));
  return { columns: [...start, ...middle, ...end], pinned: { start, end } };
};

const compareValues = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
};

/** Reads one row's cell: the row by its position, the cell by its column id. */
type CellAt = (position: number, columnId: string) => unknown;

/** `positions` sorted as the view sorts its rows: a stable sort, so rows that tie keep the order they are given in. */
const sortPositions = (positions: readonly number[], cell: CellAt, sorts: readonly SortSpec[]): number[] =>
  sorts.length === 0
    ? [...positions]
    : [...positions].sort((a, b) => {
        for (const s of sorts) {
          const d = compareValues(cell(a, s.columnId), cell(b, s.columnId));
          if (d !== 0) return s.direction === "desc" ? -d : d;
        }
        return 0;
      });

/**
 * Positions, in the order given, without the rows that have no value in the first sorted column: a row with no value
 * never fills a count (ADR 0027), so "top 10" shows 7 when only 7 have one. No value is what a filter's "is empty"
 * means, plus a number that isn't one (NaN), which no sort can place. A count drops them before it sorts, since a NaN
 * left in would tie with every row and break the sort's order.
 */
const withValueFirst = (positions: readonly number[], cell: CellAt, sorts: readonly SortSpec[]): number[] => {
  const first = sorts[0]?.columnId;
  if (first === undefined) return [...positions];
  return positions.filter((i) => {
    const v = cell(i, first);
    return !isEmpty(v) && !Number.isNaN(v);
  });
};

/**
 * The rows a count takes, in the order it takes them (ADR 0027): `positions` sorted as `applyView` sorts its rows (a
 * stable sort with GridCue's own comparison, so rows that tie keep the order they are given in), without the rows that
 * have no value in the first sorted column. A count of N keeps the first N. With no sort, `positions` in the order
 * given. `applyView` takes its count this way, and so does any Grid Adapter that keeps a count in its own table, such
 * as the TanStack Table adapter's count piece, so both keep the same rows.
 */
export const countOrder = (positions: readonly number[], cell: CellAt, sorts: readonly SortSpec[]): number[] =>
  sortPositions(withValueFirst(positions, cell, sorts), cell, sorts);

/** One level of the groups: its rows (indexes, in the Host's order) and the groups inside it, in first-seen order. */
interface GroupNode {
  value: Scalar;
  rows: number[];
  children: Map<string, GroupNode>;
  /** At the last level: the group `applyView` returns. */
  group?: { key: Record<string, Scalar>; rows: unknown[]; totals: TotalValue[] };
}

/** Applies a View State to in-memory rows. Pure; the Host renders the result with any table. */
export const applyView = <Row extends object>(rows: readonly Row[], state: ViewState, schema: ViewSchema): ViewResult<Row> => {
  const cell = (i: number, id: string): unknown => (rows[i] as Record<string, unknown>)[id];
  const filtered: number[] = [];
  rows.forEach((row, i) => {
    if (matchesFilter(row as Record<string, unknown>, state.filters, schema)) filtered.push(i);
  });
  // A count keeps the first rows of the sorted view, before grouping, so "top 10 grouped by advisor" is still ten rows.
  // It takes them as `countOrder` does, which the TanStack Table adapter's count piece takes too.
  const limited =
    state.limit === undefined ? sortPositions(filtered, cell, state.sorts) : countOrder(filtered, cell, state.sorts).slice(0, state.limit);
  // A total counts the rows the view shows, after its filters and its count (ADR 0030). Each column's cells are read
  // once, for the view's totals, each group's, and the totals that order the groups.
  const read = new Map<string, TotalCells>();
  const cellsOf = (id: string) => {
    let cells = read.get(id);
    if (!cells) {
      cells = new TotalCells(rows.length, (i) => cell(i, id));
      read.set(id, cells);
    }
    return cells;
  };
  const totalsOver = (shown: readonly number[]): TotalValue[] =>
    state.aggregations.map((a) => ({
      columnId: a.columnId,
      function: a.function,
      value: a.function === "sum" || a.function === "avg" ? cellsOf(a.columnId).total(shown, a.function) : null,
    }));
  const placed = { ...placeColumns(state), density: state.density, rows: limited.map((i) => rows[i] as Row), totals: totalsOver(limited) };
  if (state.groupBy.length === 0) return placed;

  // The groups, level by level, in the order each first appears in the rows the view shows, in the Host's order.
  const shownInHostOrder = state.limit === undefined ? filtered : [...limited].sort((a, b) => a - b);
  const root: GroupNode = { value: null, rows: [], children: new Map() };
  const leafOf = new Map<number, GroupNode>();
  for (const i of shownInHostOrder) {
    let node = root;
    for (const id of state.groupBy) {
      const value = (cell(i, id) ?? null) as Scalar;
      const k = JSON.stringify(value);
      let child = node.children.get(k);
      if (!child) {
        child = { value, rows: [], children: new Map() };
        node.children.set(k, child);
      }
      child.rows.push(i);
      node = child;
    }
    leafOf.set(i, node);
  }
  // Each level is ordered by the view's sorts in turn (ADR 0030): a sort on this level's grouping column by its value, a
  // sort on a column with a total by that total over the group's rows. A sort on any other column says nothing about
  // groups and is passed over. Groups that tie keep the order they first appear.
  const ordered = (node: GroupNode, level: number): GroupNode[] => {
    const id = state.groupBy[level];
    const keys = state.sorts.flatMap((s) => {
      if (s.columnId === id) return [{ s, of: (g: GroupNode) => g.value as unknown }];
      if (state.groupBy.includes(s.columnId)) return [];
      const total = state.aggregations.find((a) => a.columnId === s.columnId);
      if (!total || (total.function !== "sum" && total.function !== "avg")) return [];
      const fn = total.function;
      const values = new Map<GroupNode, number | null>();
      return [
        {
          s,
          of: (g: GroupNode) => {
            if (!values.has(g)) values.set(g, cellsOf(s.columnId).total(g.rows, fn));
            return values.get(g) as unknown;
          },
        },
      ];
    });
    const groups = [...node.children.values()];
    if (keys.length === 0) return groups;
    return groups.sort((a, b) => {
      for (const { s, of } of keys) {
        const d = compareValues(of(a), of(b));
        if (d !== 0) return s.direction === "desc" ? -d : d;
      }
      return 0;
    });
  };
  const leaves: GroupNode[] = [];
  const walk = (node: GroupNode, level: number, key: Record<string, Scalar>) => {
    for (const child of ordered(node, level)) {
      const id = state.groupBy[level] as string;
      const childKey = { ...key, [id]: child.value };
      if (level === state.groupBy.length - 1) {
        child.group = { key: childKey, rows: [], totals: totalsOver(child.rows) };
        leaves.push(child);
      } else walk(child, level + 1, childKey);
    }
  };
  walk(root, 0, {});
  // Rows inside each group keep the view's sort.
  for (const i of limited) leafOf.get(i)?.group?.rows.push(rows[i]);
  return {
    ...placed,
    groups: leaves.map((leaf) => leaf.group as { key: Record<string, Scalar>; rows: Row[]; totals: TotalValue[] }),
  };
};
