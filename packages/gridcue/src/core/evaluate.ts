import type { ColumnDescriptor, FilterGroup, FilterPredicate, Scalar, ViewSchema } from "./protocol";

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

const compare = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
};

/** Evaluates one predicate against a cell value, using the column kind's semantics. */
export const matchesPredicate = (value: unknown, predicate: FilterPredicate, column?: ColumnDescriptor): boolean => {
  const target = predicate.value;
  const text = (v: unknown) => String(v ?? "").toLowerCase();
  const caseless = column?.kind === "string";
  const eq = (a: unknown, b: Scalar) => (caseless ? text(a) === text(b) : a === b);
  switch (predicate.operator) {
    case "isEmpty":
      return isEmpty(value);
    case "isNotEmpty":
      return !isEmpty(value);
    case "eq":
      return eq(value, target as Scalar);
    case "neq":
      return !eq(value, target as Scalar);
    case "in":
      return Array.isArray(target) && target.some((t) => eq(value, t));
    case "contains":
      return text(value).includes(text(target));
    case "startsWith":
      return text(value).startsWith(text(target));
    case "gt":
      return !isEmpty(value) && compare(value, target) > 0;
    case "gte":
      return !isEmpty(value) && compare(value, target) >= 0;
    case "lt":
      return !isEmpty(value) && compare(value, target) < 0;
    case "lte":
      return !isEmpty(value) && compare(value, target) <= 0;
    case "between": {
      const range = target as { min: Scalar; max: Scalar };
      return !isEmpty(value) && compare(value, range.min) >= 0 && compare(value, range.max) <= 0;
    }
  }
};

/** Evaluates a filter tree against a row object keyed by column ID. */
export const matchesFilter = (row: Record<string, unknown>, filter: FilterGroup | null, schema: ViewSchema): boolean => {
  if (!filter) return true;
  const results = filter.children.map((child) =>
    child.type === "group"
      ? matchesFilter(row, child, schema)
      : matchesPredicate(
          row[child.columnId],
          child,
          schema.columns.find((c) => c.id === child.columnId),
        ),
  );
  return filter.combinator === "and" ? results.every(Boolean) : results.some(Boolean);
};
