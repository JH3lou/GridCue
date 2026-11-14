import type { ColumnDescriptor, ColumnKind, FilterOperator } from "./protocol";

/**
 * What a column allows, read from its descriptor alone. This module imports no other part of core, so every reader can
 * use it, and `core/schema.ts` can check a House Term with those readers, with no import cycle.
 */

const OPERATORS_BY_KIND: Record<ColumnKind, FilterOperator[]> = {
  string: ["eq", "neq", "contains", "startsWith", "in", "isEmpty", "isNotEmpty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  currency: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  percent: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  date: ["eq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  datetime: ["eq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  boolean: ["eq"],
  enum: ["eq", "neq", "in", "isEmpty", "isNotEmpty"],
};

/** Operators legal for a column: its kind's operators, narrowed by the Host's allow-list. */
export const operatorsFor = (column: ColumnDescriptor): FilterOperator[] => {
  const byKind = OPERATORS_BY_KIND[column.kind];
  return column.allowedOperators ? byKind.filter((op) => column.allowedOperators?.includes(op)) : byKind;
};

export const isExposed = (column: ColumnDescriptor): boolean => column.sensitivity !== "restricted" && column.exposeToProvider !== false;
