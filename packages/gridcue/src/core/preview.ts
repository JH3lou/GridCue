import { type ConfidencePolicy, DEFAULT_CONFIDENCE } from "./compile";
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

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Formats a filter value for people, using the column's kind and approved enum labels. */
export const formatValue = (value: Scalar, column?: ColumnDescriptor): string => {
  if (value === null) return "empty";
  if (column?.kind === "boolean" || typeof value === "boolean") return value ? "Yes" : "No";
  if (column?.kind === "enum") return column.enumValues?.find((e) => e.id === value)?.label ?? String(value);
  if (typeof value === "number" && column?.kind === "currency") return currency.format(value);
  if (typeof value === "number" && column?.kind === "percent") return `${Math.round(value * 1000) / 10}%`;
  if (typeof value === "number") return value.toLocaleString("en-US");
  return `“${value}”`;
};

const list = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** Every predicate in a filter group, nested groups included. */
const predicatesOf = (group: FilterGroup | null | undefined): FilterPredicate[] =>
  (group?.children ?? []).flatMap((child) => ("children" in child ? predicatesOf(child) : [child]));

const describe = (op: ViewOperation, schema: ViewSchema, current?: Pick<ViewState, "filters">): string => {
  const col = (id: string) => schema.columns.find((c) => c.id === id);
  const label = (id: string) => col(id)?.label ?? id;
  switch (op.type) {
    case "filter.add": {
      const p = op.predicate;
      const c = col(p.columnId);
      if (c?.kind === "boolean" && p.operator === "eq") return `Show only rows where ${c.label} is ${formatValue(p.value as Scalar, c)}`;
      const v = p.value;
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
      const removed = predicatesOf(current?.filters).map((predicate) =>
        describe({ type: "filter.add", predicate, combineWith: "and" }, schema).replace(/^Filter /, ""),
      );
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
    case "view.reset":
      return "Reset the view";
  }
};

export interface Preview {
  /** One line per operation, in order. */
  lines: string[];
  /** The whole preview as one sentence, ending with the no-data-change assurance. */
  text: string;
}

/** Renders exactly what a plan will change. Deterministic: the same plan always gives the same text. */
export const renderPreview = (
  plan: Pick<ViewPlan, "operations">,
  schema: ViewSchema,
  /** The view the plan applies to. With it, a line that clears filters names the ones it removes. */
  current?: Pick<ViewState, "filters">,
): Preview => {
  const lines = plan.operations.map((op) => describe(op, schema, current));
  const joined = lines.map((l, i) => (i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1))).join("; ");
  return { lines, text: `${joined ? `${joined}. ` : ""}No records will be changed.` };
};

export interface ViewDiff {
  filtersChanged: boolean;
  sortsChanged: boolean;
  groupingChanged: boolean;
  shown: string[];
  hidden: string[];
  orderChanged: boolean;
}

export const diffViews = (before: ViewState, after: ViewState): ViewDiff => ({
  filtersChanged: JSON.stringify(before.filters) !== JSON.stringify(after.filters),
  sortsChanged: JSON.stringify(before.sorts) !== JSON.stringify(after.sorts),
  groupingChanged: JSON.stringify(before.groupBy) !== JSON.stringify(after.groupBy),
  shown: after.visibleColumnIds.filter((id) => !before.visibleColumnIds.includes(id)),
  hidden: before.visibleColumnIds.filter((id) => !after.visibleColumnIds.includes(id)),
  orderChanged: JSON.stringify(before.columnOrder) !== JSON.stringify(after.columnOrder),
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
