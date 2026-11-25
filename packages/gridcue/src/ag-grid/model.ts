import type { FilterGroup, FilterPredicate, ViewSchema } from "../index";
import { type AgCondition, conditionFor, filterTypeOf, matchOptionsOf, maxConditionsOf } from "./meanings";

/** One column's entry in AG Grid's filter model: a condition, or conditions joined with AND or OR. */
export type AgColumnModel = AgCondition | { filterType: string; operator: "AND" | "OR"; conditions: AgCondition[] };

/** The conditions on one column, how they join, and whether they came from a list. A single condition joins either way. */
interface Unit {
  join: "AND" | "OR";
  conditions: AgCondition[];
  list?: true;
}

const columnsUnder = (group: FilterGroup): Set<string> =>
  new Set(group.children.flatMap((c) => (c.type === "predicate" ? [c.columnId] : [...columnsUnder(c)])));

/** Why a View State's filters can't be written into AG Grid, as the words of an `ADAPTER_UNSUPPORTED_FILTER` message. */
export class Unwritable extends Error {}

const ACROSS = "AG Grid can't hold an OR across two columns: each column holds its own filter, and AG Grid joins them with AND.";
const LIST_BESIDE =
  "AG Grid can't hold a list of values beside another filter on the same column: the list is an OR of its values, and a column joins its conditions one way.";
const MIXED = "AG Grid can't hold AND and OR filters on the same column: a column joins its conditions one way.";

/**
 * The View State's filters as AG Grid's filter model, one entry per column (spec 5.6). Conditions on a column joined
 * with AND are one entry with operator AND; an OR of conditions on one column, or a list (`in`), is one entry with
 * operator OR. Anything else AG Grid can't hold throws `Unwritable`, before anything is written: an OR across columns,
 * a list beside another filter on its column, AND and OR on one column, a condition no option holds, or more
 * conditions than `gridcueColumnDefs` gives a column.
 */
export const toFilterModel = (filters: FilterGroup | null, schema: ViewSchema): Map<string, AgColumnModel> => {
  const units = new Map<string, Unit[]>();
  const options = matchOptionsOf(schema);
  const conditionOf = (p: FilterPredicate): AgCondition => {
    const column = schema.columns.find((c) => c.id === p.columnId);
    const condition = column ? conditionFor(p, column, options) : "AG Grid has no filter for a condition on that column.";
    if (typeof condition === "string") throw new Unwritable(condition);
    return condition;
  };
  /** A predicate's conditions: one, or for a list one `equals` per value, joined with OR. */
  const conditionsOf = (p: FilterPredicate): Unit => {
    if (p.operator !== "in") return { join: "AND", conditions: [conditionOf(p)] };
    const values = Array.isArray(p.value) ? p.value : [];
    const conditions = values.map((value) => conditionOf({ ...p, operator: "eq", value }));
    if (conditions.length === 0) throw new Unwritable("AG Grid has no filter for an empty list.");
    return { join: conditions.length === 1 ? "AND" : "OR", conditions, list: true };
  };
  const add = (columnId: string, unit: Unit) => units.set(columnId, [...(units.get(columnId) ?? []), unit]);
  /** Every predicate under an OR group, which must all be on one column. */
  const orLeaves = (group: FilterGroup): FilterPredicate[] =>
    group.children.flatMap((child) => {
      if (child.type === "predicate") return [child];
      if (child.combinator === "or" || child.children.length === 1) return orLeaves(child);
      throw new Unwritable(columnsUnder(child).size > 1 ? ACROSS : MIXED);
    });
  const walk = (group: FilterGroup) => {
    if (group.combinator === "or" && group.children.length > 1) {
      const leaves = orLeaves(group);
      const columns = new Set(leaves.map((p) => p.columnId));
      const [columnId] = columns;
      if (columns.size !== 1 || columnId === undefined) throw new Unwritable(ACROSS);
      const conditions = leaves.flatMap((p) => conditionsOf(p).conditions);
      add(columnId, { join: conditions.length === 1 ? "AND" : "OR", conditions });
      return;
    }
    for (const child of group.children) {
      if (child.type === "group") walk(child);
      else add(child.columnId, conditionsOf(child));
    }
  };
  if (filters) walk(filters);

  const models = new Map<string, AgColumnModel>();
  const most = maxConditionsOf(schema);
  for (const [columnId, list] of units) {
    const or = list.find((u) => u.join === "OR");
    if (or && list.length > 1) throw new Unwritable(list.some((u) => u.list) ? LIST_BESIDE : MIXED);
    const conditions = list.flatMap((u) => u.conditions);
    const [only] = conditions;
    const column = schema.columns.find((c) => c.id === columnId);
    if (conditions.length > most) {
      // AG Grid cuts a longer model short without a word (spike, Q2f).
      throw new Unwritable(
        `AG Grid holds ${most} conditions on a column, and the filter on ${column?.label ?? columnId} needs ${conditions.length}.`,
      );
    }
    const filterType = column ? filterTypeOf(column.kind) : "text";
    models.set(
      columnId,
      conditions.length === 1 && only ? only : { filterType, operator: or ? "OR" : "AND", conditions: conditions.map((c) => ({ ...c })) },
    );
  }
  return models;
};

/**
 * A value as text that two equal models share, whatever the order of their keys: AG Grid reads a model back with its
 * keys in its own order, and leaves out a key that is `null` or missing.
 */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== undefined);
    return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  });
