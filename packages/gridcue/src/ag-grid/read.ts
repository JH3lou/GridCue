import { type ColumnDescriptor, type FilterGroup, type FilterPredicate, operatorsFor, type Scalar, type ViewSchema } from "../index";
import { enumIdOf, filterTypeOf, OPERATOR_OF } from "./meanings";

// Reading back (more grids spec, 5.6): a filter the User sets in AG Grid's menu, as GridCue filters. The reader takes
// one column's entry in AG Grid's filter model and knows nothing of what GridCue wrote. It reads the options
// `gridcueColumnDefs` lists on a column GridCue may filter, into filters validation would take, and only where the rows
// AG Grid keeps are the rows the GridCue filter means. Every option a column lists reads; an operand that means no
// value of the column (text that names no enum value, empty text, a date with a time of day) doesn't. Anything
// unreadable stays the Host's.
//
// The reader sees the model the grid holds, never the one `setFilterModel` was given, and AG Grid changes some on the
// way in. A model of another filter's type (a number filter's model on a text column) is relabelled with the column's
// filter type on 34 and 35, operand unchanged, so it is unreadable; 36 also turns the operand (5 into "5"), and then it
// is the very model the menu sets and reads as one. `test/ag-grid-read.test.ts` checks the rows agree either way.

type Read = Pick<FilterPredicate, "operator" | "value">;

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** The day in "2026-01-31 00:00:00", as AG Grid's date filter writes a whole day. A time of day is not read. */
const dayOf = (value: unknown): string | undefined => {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2}) 00:00:00$/.exec(value) : null;
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real && year >= 1 ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
};

/** A text filter's operand as the column's kind holds a value, or `undefined` when the kind holds no such value. */
const textValue = (filter: unknown, column: ColumnDescriptor): Scalar | undefined => {
  if (typeof filter !== "string") return undefined;
  if (column.kind === "boolean") return filter === "true" ? true : filter === "false" ? false : undefined;
  // A value's ID, or its label as the cell may show it: the matcher reads it the same way.
  if (column.kind === "enum") return enumIdOf(column, filter);
  // AG Grid never passes a missing cell to the matcher, so on text an empty operand keeps other rows than GridCue's
  // filter would: "equals" keeps only the cells that hold empty text, where GridCue also keeps the missing ones.
  return filter === "" ? undefined : filter;
};

/** One simple condition as a GridCue filter, or `undefined` when it has none. */
const readCondition = (condition: unknown, column: ColumnDescriptor): Read | undefined => {
  const model = recordOf(condition);
  const filterType = filterTypeOf(column.kind);
  if (!model || model.filterType !== filterType || typeof model.type !== "string") return undefined;
  const operator = Object.hasOwn(OPERATOR_OF, model.type) ? OPERATOR_OF[model.type] : undefined;
  // "Equals" on a column that takes a list and not equals is read as a list of one (`readColumnModel`).
  const allowed = operatorsFor(column);
  if (!operator || !(allowed.includes(operator) || (operator === "eq" && allowed.includes("in")))) return undefined;
  if (operator === "isEmpty" || operator === "isNotEmpty") return { operator };
  const ends = filterType === "date" ? [dayOf(model.dateFrom), dayOf(model.dateTo)] : [model.filter, model.filterTo];
  const valueAt = (end: unknown): Scalar | undefined => {
    if (filterType === "number") return typeof end === "number" && Number.isFinite(end) ? end : undefined;
    if (filterType === "date") return typeof end === "string" ? end : undefined;
    return textValue(end, column);
  };
  const from = valueAt(ends[0]);
  if (from === undefined) return undefined;
  if (operator !== "between") return { operator, value: from };
  const to = valueAt(ends[1]);
  return to === undefined ? undefined : { operator, value: { min: from, max: to } };
};

/**
 * What one column's entry in AG Grid's filter model reads as: the filters to join into the View State with AND, or
 * `undefined` when GridCue can't read it. Each AND condition is a filter; an OR of conditions is one nested OR group;
 * equals-OR-equals is one list (`in`), on a column that takes a list. AG Grid's "empty" option, its word for no filter,
 * reads as no filters. One unreadable condition makes the whole entry unreadable.
 */
export const readColumnModel = (model: unknown, column: ColumnDescriptor): Array<FilterPredicate | FilterGroup> | undefined => {
  if (column.sensitivity === "restricted" || !column.capabilities.includes("filter")) return undefined;
  const entry = recordOf(model);
  if (!entry || entry.filterType !== filterTypeOf(column.kind)) return undefined;
  const eqAllowed = operatorsFor(column).includes("eq");
  const predicate = (read: Read, i: number): FilterPredicate => ({
    id: `ag-grid:${column.id}:${i}`,
    type: "predicate",
    columnId: column.id,
    ...(read.operator === "eq" && !eqAllowed ? { operator: "in", value: [read.value as Scalar] } : read),
  });
  if (entry.operator === undefined) {
    if (entry.type === "empty") return [];
    const read = readCondition(entry, column);
    return read ? [predicate(read, 0)] : undefined;
  }
  if ((entry.operator !== "AND" && entry.operator !== "OR") || !Array.isArray(entry.conditions) || entry.conditions.length === 0) {
    return undefined;
  }
  const reads: Read[] = [];
  for (const condition of entry.conditions) {
    const read = readCondition(condition, column);
    if (!read) return undefined;
    reads.push(read);
  }
  if (entry.operator === "AND" || reads.length === 1) return reads.map(predicate);
  if (reads.every((r) => r.operator === "eq") && operatorsFor(column).includes("in")) {
    return [predicate({ operator: "in", value: reads.map((r) => r.value as Scalar) }, 0)];
  }
  return [{ id: `ag-grid:${column.id}`, type: "group", combinator: "or", children: reads.map(predicate) }];
};

/**
 * A whole AG Grid filter model as a View State's filters: every readable column's filters in one AND group, in the
 * schema's column order, and the ids of the entries it can't read, which are the Host's.
 */
export const readFilterModel = (model: Record<string, unknown>, schema: ViewSchema): { filters: FilterGroup | null; unread: string[] } => {
  const children: FilterGroup["children"] = [];
  const read = new Set<string>();
  for (const column of schema.columns) {
    if (!Object.hasOwn(model, column.id)) continue;
    const filters = readColumnModel(model[column.id], column);
    if (!filters) continue;
    read.add(column.id);
    children.push(...filters);
  }
  return {
    filters: children.length > 0 ? { id: "ag-grid:root", type: "group", combinator: "and", children } : null,
    unread: Object.keys(model).filter((id) => !read.has(id)),
  };
};
