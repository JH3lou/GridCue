import { type ConfidencePolicy, DEFAULT_CONFIDENCE } from "./compile";
import { calendarZone, isDay } from "./dates";
import { formatAmount } from "./format";
import {
  type ColumnDescriptor,
  emptyViewState,
  type FilterGroup,
  type FilterPredicate,
  type Scalar,
  type ViewOperation,
  type ViewPlan,
  type ViewSchema,
  type ViewState,
} from "./protocol";
import { applyOperations } from "./reduce";

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

/** The words for a comparison with a date (spec section 9). Each is one `normalize` reads, so the line can be typed back. */
const DATE_OPERATOR_TEXT: Partial<Record<FilterPredicate["operator"], string>> = {
  eq: "on",
  gt: "after",
  gte: "on or after",
  lt: "before",
  lte: "on or before",
};

/**
 * A filter on a date or date-and-time column, without quote marks (spec section 9): "Filter Opened after 2026-01-31",
 * "Filter Opened from 2026-08-15 to 2026-11-13". `undefined` for any other filter.
 */
const dateLine = (p: FilterPredicate, c: ColumnDescriptor | undefined): string | undefined => {
  if (c?.kind !== "date" && c?.kind !== "datetime") return undefined;
  const v = p.value;
  if (p.operator === "between" && typeof v === "object" && v !== null && !Array.isArray(v)) {
    return typeof v.min === "string" && typeof v.max === "string" ? `Filter ${c.label} from ${v.min} to ${v.max}` : undefined;
  }
  const words = DATE_OPERATOR_TEXT[p.operator];
  return words && typeof v === "string" ? `Filter ${c.label} ${words} ${v}` : undefined;
};

/** Whether a filter compares a date-and-time column with a day, which then means the whole day (ADR 0026). */
const onWholeDays = (p: FilterPredicate, c: ColumnDescriptor | undefined): boolean => {
  if (c?.kind !== "datetime") return false;
  const v = p.value;
  const days = typeof v === "string" ? [v] : typeof v === "object" && v !== null && !Array.isArray(v) ? [v.min, v.max] : [];
  return days.length > 0 && days.every((d) => typeof d === "string" && isDay(d));
};

const describe = (op: ViewOperation, schema: ViewSchema, current?: Pick<ViewState, "filters">, pinned?: readonly string[]): string => {
  const col = (id: string) => schema.columns.find((c) => c.id === id);
  const label = (id: string) => col(id)?.label ?? id;
  switch (op.type) {
    case "filter.add": {
      const p = op.predicate;
      const c = col(p.columnId);
      const where = rowsWhere(p, c);
      if (where) return `Show only rows where ${where}`;
      const date = dateLine(p, c);
      if (date) return date;
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
    case "columns.pin": {
      if (op.position !== "none") return `Pin ${list(op.columnIds.map(label))} to the ${op.position}`;
      // An unpin that names every pinned column, or names none ("unpin everything" with nothing pinned), unpins them all.
      const every = pinned !== undefined && op.columnIds.length === pinned.length && pinned.every((id) => op.columnIds.includes(id));
      return every || op.columnIds.length === 0 ? "Unpin all columns" : `Unpin ${list(op.columnIds.map(label))}`;
    }
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
/** Where a relative date form's evidence names the filter it made: `c0.dateWords.<filter ID>`, with the form's words. */
const DATE_WORDS_KEY = ".dateWords.";

/** Renders exactly what a plan will change. Deterministic: the same plan always gives the same text. */
export const renderPreview = (
  plan: Pick<ViewPlan, "operations"> & Partial<Pick<ViewPlan, "evidence">>,
  schema: ViewSchema,
  /**
   * The view the plan applies to. With it, a line that clears filters names the ones it removes, and an unpin that
   * names every pinned column says "Unpin all columns".
   */
  current?: Pick<ViewState, "filters"> & Partial<Pick<ViewState, "pinnedColumnIds">>,
): Preview => {
  // A filter a House Term made names the term, as the Host declared it (spec 4.5): "Filter Market value above
  // $1,000,000 (Large)". The plan's `host` evidence keeps the label, by the filter's ID.
  const terms = new Map(
    (plan.evidence ?? []).flatMap((e) => {
      const at = e.key.indexOf(TERM_KEY);
      return at >= 0 && e.source === "host" && e.selectedId ? [[e.key.slice(at + TERM_KEY.length), e.selectedId] as const] : [];
    }),
  );
  // A filter a relative date form made names the form's words after its dates (spec 4.5): "Filter Opened from
  // 2026-08-15 to 2026-11-13 (last 90 days)". The plan's evidence keeps the words, by the filter's ID.
  const dateWords = new Map(
    (plan.evidence ?? []).flatMap((e) => {
      const at = e.key.indexOf(DATE_WORDS_KEY);
      return at >= 0 && e.source === "deterministic" && e.selectedId
        ? [[e.key.slice(at + DATE_WORDS_KEY.length), e.selectedId] as const]
        : [];
    }),
  );
  // The columns pinned when each operation applies, followed through the plan's own pins. After a reset they are the
  // default view's, which the Preview isn't given.
  let pins = current?.pinnedColumnIds;
  const lines = plan.operations.map((op) => {
    const line = describe(op, schema, current, pins && [...pins.start, ...pins.end]);
    if (op.type === "view.reset") pins = undefined;
    else if (op.type === "columns.pin" && pins) {
      const before = { ...emptyViewState([]), pinnedColumnIds: pins };
      pins = applyOperations(before, [op], before).pinnedColumnIds;
    }
    const term = op.type === "filter.add" ? terms.get(op.predicate.id) : undefined;
    if (term) return `${line} (${term})`;
    const words = op.type === "filter.add" ? dateWords.get(op.predicate.id) : undefined;
    return words ? `${line} (${words})` : line;
  });
  const count = droppedLimit(plan);
  const label = (id: string) => schema.columns.find((c) => c.id === id)?.label ?? id;
  // A day on a date-and-time column means the whole day in the Calendar's time zone (ADR 0026): the one thing the dates
  // don't show. Said once, however many such filters the plan adds.
  const wholeDays = plan.operations.some(
    (op) =>
      op.type === "filter.add" &&
      onWholeDays(
        op.predicate,
        schema.columns.find((c) => c.id === op.predicate.columnId),
      ),
  );
  const notes = [
    ...(count === undefined ? [] : [`Count not applied: this grid can't show only the first ${count.toLocaleString("en-US")}`]),
    ...leftOutEmpty(plan).map((id) => `Rows with no ${label(id)} are hidden too`),
    ...(wholeDays ? [`Whole days, in ${calendarZone(schema.calendar)} time`] : []),
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
  /** A column was pinned, unpinned, or moved from one side to the other or within a side. */
  pinsChanged: boolean;
  /** The density changed. */
  densityChanged: boolean;
}

export const diffViews = (before: ViewState, after: ViewState): ViewDiff => ({
  filtersChanged: JSON.stringify(before.filters) !== JSON.stringify(after.filters),
  sortsChanged: JSON.stringify(before.sorts) !== JSON.stringify(after.sorts),
  groupingChanged: JSON.stringify(before.groupBy) !== JSON.stringify(after.groupBy),
  shown: after.visibleColumnIds.filter((id) => !before.visibleColumnIds.includes(id)),
  hidden: before.visibleColumnIds.filter((id) => !after.visibleColumnIds.includes(id)),
  orderChanged: JSON.stringify(before.columnOrder) !== JSON.stringify(after.columnOrder),
  countChanged: before.limit !== after.limit,
  pinsChanged: JSON.stringify(before.pinnedColumnIds) !== JSON.stringify(after.pinnedColumnIds),
  densityChanged: before.density !== after.density,
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
