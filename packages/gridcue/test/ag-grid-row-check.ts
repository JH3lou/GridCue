import { createAgGridAdapter, gridcueColumnDefs } from "../src/ag-grid";
import { readFilterModel } from "../src/ag-grid/read";
import { matchesFilter } from "../src/core/evaluate";
import { emptyViewState, type FilterGroup, type FilterPredicate, type Scalar, type ViewSchema, type ViewState } from "../src/core/protocol";
import { applyView } from "../src/core/rows-adapter";
import { queryCheck } from "../src/testing";
import { columnDefsFor, type Major, type RowModel, shown, type TestApi, tick } from "./ag-grid-grids";

// The AG Grid row check (more grids spec, 5.5 and 5.6): the Query Check's cases, run through the adapter into AG Grid,
// and the rows the grid then shows compared with the rows GridCue's meaning keeps. It decides, option by option,
// whether AG Grid's own setting or a custom option carries each filter (`src/ag-grid/meanings.ts`).

type Row = Record<string, Scalar>;

export interface RowCheckResult {
  /** Every case the Query Check makes for the schema and the adapter's operations. */
  cases: number;
  /** The cases the grid held: the adapter wrote the case's View State and the grid read it back. */
  held: number;
  /** The cases the adapter refused before writing anything, by error code. */
  refused: Record<string, number>;
  /** The Query Check's message for each held case whose rows, or checked order, are wrong. The bar is none. */
  differ: string[];
  /** Held cases that sort, whose rows are right but not in `applyView`'s exact order: where empty and tied cells sit. */
  orderDiffers: number;
  /** Held cases whose filter model, read back with no memory of what was written, keeps other rows. The bar is none. */
  misread: string[];
  /** Held cases with a filter the reader leaves as the Host's, such as an enum equal to empty text. */
  notRead: number;
}

/** The rows an Infinite grid has drawn, once every one of them has loaded. */
const drawn = async (api: TestApi, id: string): Promise<unknown[]> => {
  for (let tries = 0; ; tries++) {
    await tick(0);
    const ids = Array.from({ length: api.getDisplayedRowCount() }, (_, i) => api.getDisplayedRowAtIndex(i)?.data?.[id]);
    if (!ids.includes(undefined) || tries > 50) return ids;
  }
};

/** A grid over `rows` with GridCue's settings on its columns, and its adapter. */
export const gridFor = (
  major: Major,
  rowModel: RowModel,
  schema: ViewSchema,
  rows: readonly Row[],
  extra: Record<string, unknown> = {},
) => {
  let adapter: ReturnType<typeof createAgGridAdapter> | undefined;
  const requests = { count: 0 };
  const rowOptions =
    rowModel === "clientSide"
      ? { rowData: rows }
      : {
          rowModelType: "infinite",
          cacheBlockSize: 500,
          datasource: {
            // The Host's Data Query, here over rows in memory: built from the View State alone (spec 5.5, step 2).
            getRows(params: { startRow: number; endRow: number; successCallback(rows: object[], last: number): void }) {
              requests.count++;
              const view = adapter?.getState().state;
              const kept = view ? applyView(rows, view, schema).rows : [...rows];
              params.successCallback(kept.slice(params.startRow, params.endRow), kept.length);
            },
          },
        };
  // No row animation: jsdom draws no layout, and an animated grid draws every row on every write.
  const api = major.createGrid({
    columnDefs: gridcueColumnDefs(schema, columnDefsFor(schema)),
    animateRows: false,
    ...rowOptions,
    ...extra,
  });
  adapter = createAgGridAdapter({ schema, api });
  return { api, adapter, requests };
};

const sameSet = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

/** Runs every Query Check case for `schema` through AG Grid on one major and row model. */
export const runRowCheck = async (major: Major, rowModel: RowModel, schema: ViewSchema, id: string): Promise<RowCheckResult> => {
  const probe = gridFor(major, rowModel, schema, []);
  const check = queryCheck(schema, { id, operations: probe.adapter.getCapabilities().operations });
  probe.api.destroy();
  const { api, adapter } = gridFor(major, rowModel, schema, check.rows);
  const result: RowCheckResult = { cases: check.cases.length, held: 0, refused: {}, differ: [], orderDiffers: 0, misread: [], notRead: 0 };
  for (const c of check.cases) {
    const written = await adapter.restore({ revision: adapter.getState().revision, state: c.state });
    if (!written.ok) {
      result.refused[written.code] = (result.refused[written.code] ?? 0) + 1;
      continue;
    }
    result.held++;
    // The Client-Side grid has its rows at once (spike, Q2f). The tick lets AG Grid run the events of this write
    // before the next, as it would between two requests.
    const ids = (rowModel === "clientSide" ? shown(api, id) : await drawn(api, id)) as Array<string | number>;
    if (rowModel === "clientSide") await tick(0);
    const compared = c.compare(ids);
    if (!compared.ok) result.differ.push(compared.message);
    const exact = applyView(check.rows, c.state, schema).rows.map((row) => row[id]);
    if (compared.ok && c.state.sorts.length > 0 && JSON.stringify(exact) !== JSON.stringify(ids)) result.orderDiffers++;
    // The reader, with no memory of what GridCue wrote: the View State it reads must keep the rows the grid shows.
    const model = api.getFilterModel();
    const reread = readFilterModel(model, schema);
    if (reread.unread.length > 0) result.notRead++;
    else {
      const kept = check.rows.filter((row) => matchesFilter(row, reread.filters, schema)).map((row) => row[id]);
      if (!sameSet(kept, ids)) result.misread.push(`${c.name}: read as ${JSON.stringify(reread.filters)}`);
    }
  }
  return result;
};

/** Every filter the Query Check's cases use, once each. */
export const predicatesOf = (schema: ViewSchema, id: string): FilterPredicate[] => {
  const found = new Map<string, FilterPredicate>();
  const walk = (group: FilterGroup) => {
    for (const child of group.children) {
      if (child.type === "group") walk(child);
      else found.set(JSON.stringify([child.columnId, child.operator, child.value]), child);
    }
  };
  for (const c of queryCheck(schema, { id }).cases) if (c.state.filters) walk(c.state.filters);
  return [...found.values()];
};

/**
 * The Query Check's rows, and rows it doesn't make: empty text in each number, date and yes/no column, which AG Grid 34
 * and 35 read as a value (spike, Q3); whitespace-only text in an enum column; and in a date-and-time column, instants
 * with an offset and a cell that is no date.
 */
export const edgeRows = (schema: ViewSchema, id: string): Row[] => {
  const { rows } = queryCheck(schema, { id });
  const [first] = rows;
  if (!first) return rows;
  let next = 9000;
  const extra = (columnId: string, value: Scalar): Row => ({ ...first, [id]: String(++next), [columnId]: value });
  const more: Row[] = [];
  for (const column of schema.columns) {
    if (column.id === id || column.sensitivity === "restricted") continue;
    if (!["string", "enum"].includes(column.kind)) more.push(extra(column.id, ""));
    if (column.kind === "enum") more.push(extra(column.id, " "));
    if (["number", "currency", "percent"].includes(column.kind)) more.push(extra(column.id, 0));
    if (column.kind === "datetime") {
      for (const cell of ["2026-11-01T04:30:00Z", "2026-11-02T03:00:00+13:00", "2026-03-08T07:30:00-05:00", "not a date"]) {
        more.push(extra(column.id, cell));
      }
    }
  }
  return [...rows, ...more];
};

/** A View State that holds one filter and nothing else. */
export const viewWith = (schema: ViewSchema, predicate: FilterPredicate): ViewState => ({
  ...emptyViewState(schema.columns.map((c) => c.id)),
  filters: { id: "root", type: "group", combinator: "and", children: [predicate] },
});
