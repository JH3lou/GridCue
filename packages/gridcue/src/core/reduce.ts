import type { FilterGroup, ViewOperation, ViewState } from "./protocol";

const addFilter = (current: FilterGroup | null, op: Extract<ViewOperation, { type: "filter.add" }>): FilterGroup => {
  if (!current) return { id: "root", type: "group", combinator: op.combineWith, children: [op.predicate] };
  if (current.combinator === op.combineWith) return { ...current, children: [...current.children, op.predicate] };
  return { id: `root_${op.predicate.id}`, type: "group", combinator: op.combineWith, children: [current, op.predicate] };
};

const inOrder = (ids: readonly string[], order: readonly string[]): string[] => order.filter((id) => ids.includes(id));

const step = (s: ViewState, op: ViewOperation, defaultState: ViewState): ViewState => {
  switch (op.type) {
    case "filter.add":
      return { ...s, filters: addFilter(s.filters, op) };
    case "filter.clear":
      return { ...s, filters: null };
    case "sort.set":
      return { ...s, sorts: op.sorts };
    case "group.set":
      return { ...s, groupBy: op.columnIds };
    case "columns.show":
      return { ...s, visibleColumnIds: inOrder([...s.visibleColumnIds, ...op.columnIds], s.columnOrder) };
    case "columns.hide":
      return { ...s, visibleColumnIds: s.visibleColumnIds.filter((id) => !op.columnIds.includes(id)) };
    case "columns.order": {
      const columnOrder = [...op.columnIds, ...s.columnOrder.filter((id) => !op.columnIds.includes(id))];
      return { ...s, columnOrder, visibleColumnIds: inOrder(s.visibleColumnIds, columnOrder) };
    }
    case "columns.pin": {
      // A column is pinned once (operation set spec, 4.4): it leaves both lists before it joins one, so pinning it again
      // keeps one entry, and pinning it to the other side moves it.
      const ids = [...new Set(op.columnIds)];
      const start = s.pinnedColumnIds.start.filter((id) => !ids.includes(id));
      const end = s.pinnedColumnIds.end.filter((id) => !ids.includes(id));
      return {
        ...s,
        pinnedColumnIds: {
          start: op.position === "start" ? [...start, ...ids] : start,
          end: op.position === "end" ? [...end, ...ids] : end,
        },
      };
    }
    case "aggregation.set":
      return { ...s, aggregations: op.aggregations };
    case "density.set":
      return { ...s, density: op.density };
    case "limit.set": {
      const { limit: _cleared, ...rest } = s;
      return op.count === null ? rest : { ...s, limit: op.count };
    }
    case "view.reset":
      return structuredClone(defaultState);
  }
};

/** Applies operations in order to produce the resulting view. Pure; never touches rows or a grid. */
export const applyOperations = (state: ViewState, operations: readonly ViewOperation[], defaultState: ViewState): ViewState => {
  let next = state;
  for (const op of operations) next = step(next, op, defaultState);
  return next;
};
