import { type ConfidencePolicy, DEFAULT_CONFIDENCE } from "./compile";
import { formatAmount } from "./format";
import type { ColumnDescriptor, FilterGroup, FilterPredicate, Scalar, ViewOperation, ViewPlan, ViewSchema, ViewState } from "./protocol";

const OPERATOR_TEXT: Record<FilterPredicate["operator"], string> = {
  eq: "to",
  neq: "to exclude",
  gt: "above",
  gte: "at or above",
  lt: "below",
  lte: "at or below",
  between: "between",
  contains: "containing",
  startsWith: "starting with",
  in: "to any of",
  isEmpty: "to empty",
  isNotEmpty: "to not empty",
};

/** Formats a filter value for people, using the column's kind and approved enum labels. */
export const formatValue = (value: Scalar, column?: ColumnDescriptor): string => {
  if (value === null) return "empty";
  if (column?.kind === "boolean" || typeof value === "boolean") return value ? "Yes" : "No";
  if (column?.kind === "enum") return column.enumValues?.find((e) => e.id === value)?.label ?? String(value);
  if (typeof value === "number") return formatAmount(value, column?.kind);
  return `“${value}”`;
};

const list = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** Every predicate in a filter group, nested groups included. */
const predicatesOf = (group: FilterGroup | null | undefined): FilterPredicate[] =>
  (group?.children ?? []).flatMap((child) => ("children" in child ? predicatesOf(child) : [child]));

/**
 * A filter that reads as a sentence about the rows, without "Filter": a yes/no column's value ("Restricted holdings is
 * Yes"), and an empty or not empty column ("Advisor is empty"). `undefined` for any other filter.
 */
const rowsWhere = (p: FilterPredicate, c: ColumnDescriptor | undefined): string | undefined => {
  const label = c?.label ?? p.columnId;
  if (c?.kind === "boolean" && p.operator === "eq") return `${label} is ${formatValue(p.value as Scalar, c)}`;
  if (p.operator === "isEmpty") return `${label} is empty`;
  if (p.operator === "isNotEmpty") return `${label} is not empty`;
  return undefined;
};

const describe = (op: ViewOperation, schema: ViewSchema, current?: Pick<ViewState, "filters">): string => {
  const col = (id: string) => schema.columns.find((c) => c.id === id);
  const label = (id: string) => col(id)?.label ?? id;
  switch (op.type) {
    case "filter.add": {
      const p = op.predicate;
      const c = col(p.columnId);
      const where = rowsWhere(p, c);
      if (where) return `Show only rows where ${where}`;
      const v = p.value;
      // Exact text on a text column, without letter case: "to" alone can't be told from "containing" at a glance.
      if (c?.kind === "string" && p.operator === "eq" && typeof v === "string") return `Filter ${c.label} to exactly ${formatValue(v, c)}`;
      const shown =
        v === undefined
          ? ""
          : Array.isArray(v)
            ? list(v.map((x) => formatValue(x, c)))
            : typeof v === "object" && v !== null
              ? `${formatValue(v.min, c)} and ${formatValue(v.max, c)}`
              : formatValue(v, c);
      return `Filter ${label(p.columnId)} ${OPERATOR_TEXT[p.operator]}${shown ? ` ${shown}` : ""}`;
    }
    case "filter.clear": {
      // Name what goes, so a new filter never silently drops an old one (user feedback on the live demo).
      const removed = predicatesOf(current?.filters).map((predicate) => {
        const where = rowsWhere(predicate, col(predicate.columnId));
        if (where) return where;
        return describe({ type: "filter.add", predicate, combineWith: "and" }, schema).replace(/^Filter /, "");
      });
      if (removed.length === 0) return "Clear all filters";
      return `Remove the ${removed.length === 1 ? "filter" : "filters"} ${removed.join("; ")}`;
    }
    case "sort.set":
      return op.sorts.length === 0
        ? "Clear sorting"
        : `Sort by ${op.sorts.map((s) => `${label(s.columnId)}, ${s.direction === "desc" ? "descending" : "ascending"}`).join("; then ")}`;
    case "group.set":
      // Nested levels, outermost first.
      return op.columnIds.length === 0 ? "Clear grouping" : `Group by ${op.columnIds.map(label).join(", then ")}`;
    case "columns.show":
      return `Show ${list(op.columnIds.map(label))}`;
    case "columns.hide":
      return `Hide ${list(op.columnIds.map(label))}`;
    case "columns.order":
      return `Put ${list(op.columnIds.map(label))} first`;
    case "columns.pin":
      return op.position === "none"
        ? `Unpin ${list(op.columnIds.map(label))}`
        : `Pin ${list(op.columnIds.map(label))} to the ${op.position}`;
    case "aggregation.set":
      return `Summarize ${list(op.aggregations.map((a) => `${label(a.columnId)} (${a.function})`))}`;
    case "density.set":
      return `Use ${op.density} density`;
    case "limit.set":
      return op.count === null
        ? "Show every row"
        : `Show only the first ${op.count.toLocaleString("en-US")} ${op.count === 1 ? "row" : "rows"}`;
    case "view.reset":
      return "Reset the view";
  }
};

export interface Preview {
  /** One line per operation, in order. */
  lines: string[];
  /**
   * Where the plan differs from the request's words: a count on a grid that can't limit rows ("top 10" where the
   * adapter has no `limit.set`, ADR 0018), or rows with no value that leaving something out hides too ("exclude
   * accounts over $1m"). Not an operation, so never a line; `text` includes them, and both UIs show them.
   * `renderPreview` always sets it; optional so a Preview built by hand (a fixture, a story) still type-checks.
   */
  notes?: string[];
  /** The whole preview as one sentence, ending with the no-data-change assurance. */
  text: string;
}

/** The count a plan left out because the grid can't limit rows (ADR 0018), or undefined. */
export const droppedLimit = (plan: Partial<Pick<ViewPlan, "evidence">>): number | undefined => {
  const dropped = plan.evidence?.findLast((e) => e.key.startsWith("dropped:") && e.key.endsWith(".limit"));
  const count = Number(dropped?.selectedId);
  return Number.isInteger(count) && count > 0 ? count : undefined;
};

/**
 * Columns a plan filters to "everything except what the request named" ("exclude accounts over $1m", "non-retirement").
 * Such a filter also leaves out rows with no value in that column, which the request didn't name.
 */
const leftOutEmpty = (plan: Pick<ViewPlan, "operations"> & Partial<Pick<ViewPlan, "evidence">>): string[] => {
  const filtered = new Set(plan.operations.flatMap((op) => (op.type === "filter.add" ? [op.predicate.columnId] : [])));
  const columns = (plan.evidence ?? []).flatMap((e) => (e.key.endsWith(".leftOutEmpty") && e.selectedId ? [e.selectedId] : []));
  return [...new Set(columns)].filter((id) => filtered.has(id));
};

/** Where a House Term's evidence names the filter it made: `c0.term.<filter ID>`, with the term's label. */
const TERM_KEY = ".term.";

/** Renders exactly what a plan will change. Deterministic: the same plan always gives the same text. */
export const renderPreview = (
  plan: Pick<ViewPlan, "operations"> & Partial<Pick<ViewPlan, "evidence">>,
  schema: ViewSchema,
  /** The view the plan applies to. With it, a line that clears filters names the ones it removes. */
  current?: Pick<ViewState, "filters">,
): Preview => {
  // A filter a House Term made names the term, as the Host declared it (spec 4.5): "Filter Market value above
  // $1,000,000 (Large)". The plan's `host` evidence keeps the label, by the filter's ID.
  const terms = new Map(
    (plan.evidence ?? []).flatMap((e) => {
      const at = e.key.indexOf(TERM_KEY);
      return at >= 0 && e.source === "host" && e.selectedId ? [[e.key.slice(at + TERM_KEY.length), e.selectedId] as const] : [];
    }),
  );
  const lines = plan.operations.map((op) => {
    const line = describe(op, schema, current);
    const term = op.type === "filter.add" ? terms.get(op.predicate.id) : undefined;
    return term ? `${line} (${term})` : line;
  });
  const count = droppedLimit(plan);
  const label = (id: string) => schema.columns.find((c) => c.id === id)?.label ?? id;
  const notes = [
    ...(count === undefined ? [] : [`Count not applied: this grid can't show only the first ${count.toLocaleString("en-US")}`]),
    ...leftOutEmpty(plan).map((id) => `Rows with no ${label(id)} are hidden too`),
  ];
  const joined = [...lines, ...notes].map((l, i) => (i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1))).join("; ");
  return { lines, notes, text: `${joined ? `${joined}. ` : ""}No records will be changed.` };
};

export interface ViewDiff {
  filtersChanged: boolean;
  sortsChanged: boolean;
  groupingChanged: boolean;
  shown: string[];
  hidden: string[];
  orderChanged: boolean;
  /** The count ("top 10") was set, changed or cleared. */
  countChanged: boolean;
}

export const diffViews = (before: ViewState, after: ViewState): ViewDiff => ({
  filtersChanged: JSON.stringify(before.filters) !== JSON.stringify(after.filters),
  sortsChanged: JSON.stringify(before.sorts) !== JSON.stringify(after.sorts),
  groupingChanged: JSON.stringify(before.groupBy) !== JSON.stringify(after.groupBy),
  shown: after.visibleColumnIds.filter((id) => !before.visibleColumnIds.includes(id)),
  hidden: before.visibleColumnIds.filter((id) => !after.visibleColumnIds.includes(id)),
  orderChanged: JSON.stringify(before.columnOrder) !== JSON.stringify(after.columnOrder),
  countChanged: before.limit !== after.limit,
});

export interface AuditPolicy {
  /** Include the raw request text. Off by default. */
  includeText?: boolean;
  /** Include column IDs and operators. Values are never included. Off by default. */
  includeStructure?: boolean;
}

export type AuditOutcome = "applied" | "cancelled" | "rejected" | "undone" | "failed";

export interface AuditEvent {
  type: "gridcue.plan";
  outcome: AuditOutcome;
  protocolVersion: string;
  planId: string;
  status: ViewPlan["status"];
  operationTypes: string[];
  confidenceBand: "high" | "medium" | "low" | "none";
  baseRevision: string;
  newRevision?: string;
  errorCode?: string;
  text?: string;
  structure?: Array<{ type: string; columnIds: string[]; operator?: string }>;
}

/** A structured audit event with no values, labels, or text unless the Host opts in. */
export const toAuditEvent = (
  plan: ViewPlan,
  outcome: AuditOutcome,
  policy: AuditPolicy = {},
  extra: { newRevision?: string; errorCode?: string } = {},
  bands: ConfidencePolicy = DEFAULT_CONFIDENCE,
): AuditEvent => {
  const c = plan.confidence;
  return {
    type: "gridcue.plan",
    outcome,
    protocolVersion: plan.protocolVersion,
    planId: plan.id,
    status: plan.status,
    operationTypes: plan.operations.map((o) => o.type),
    confidenceBand: c === undefined ? "none" : c >= bands.ready ? "high" : c >= bands.clarify ? "medium" : "low",
    baseRevision: plan.baseRevision,
    ...extra,
    ...(policy.includeText && plan.source.text ? { text: plan.source.text } : {}),
    ...(policy.includeStructure
      ? {
          structure: plan.operations.map((o) =>
            o.type === "filter.add"
              ? { type: o.type, columnIds: [o.predicate.columnId], operator: o.predicate.operator }
              : { type: o.type, columnIds: "columnIds" in o ? o.columnIds : "sorts" in o ? o.sorts.map((s) => s.columnId) : [] },
          ),
        }
      : {}),
  };
};
