import { z } from "zod";

export const PROTOCOL_VERSION = "0.1" as const;

export const ColumnKind = z.enum(["string", "number", "currency", "percent", "date", "datetime", "boolean", "enum"]);
export type ColumnKind = z.infer<typeof ColumnKind>;

export const ColumnCapability = z.enum(["filter", "sort", "group", "aggregate", "show", "hide", "reorder", "pin"]);
export type ColumnCapability = z.infer<typeof ColumnCapability>;

export const Sensitivity = z.enum(["public", "internal", "restricted"]);
export type Sensitivity = z.infer<typeof Sensitivity>;

export const FilterOperator = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "contains",
  "startsWith",
  "in",
  "isEmpty",
  "isNotEmpty",
]);
export type FilterOperator = z.infer<typeof FilterOperator>;

export const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Scalar = z.infer<typeof Scalar>;

export const EnumValue = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  aliases: z.array(z.string()).optional(),
});
export type EnumValue = z.infer<typeof EnumValue>;

export const ColumnDescriptor = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  kind: ColumnKind,
  aliases: z.array(z.string()).optional(),
  capabilities: z.array(ColumnCapability),
  allowedOperators: z.array(FilterOperator).optional(),
  sensitivity: Sensitivity,
  exposeToProvider: z.boolean().optional(),
  enumValues: z.array(EnumValue).optional(),
});
export type ColumnDescriptor = z.infer<typeof ColumnDescriptor>;

export const ViewSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  columns: z.array(ColumnDescriptor),
});
export type ViewSchema = z.infer<typeof ViewSchema>;

export const FilterValue = z.union([Scalar, z.array(Scalar), z.object({ min: Scalar, max: Scalar })]);
export type FilterValue = z.infer<typeof FilterValue>;

export const FilterPredicate = z.object({
  id: z.string().min(1),
  type: z.literal("predicate"),
  columnId: z.string().min(1),
  operator: FilterOperator,
  value: FilterValue.optional(),
});
export type FilterPredicate = z.infer<typeof FilterPredicate>;

export interface FilterGroup {
  id: string;
  type: "group";
  combinator: "and" | "or";
  children: Array<FilterPredicate | FilterGroup>;
}
export const FilterGroup: z.ZodType<FilterGroup> = z.object({
  id: z.string().min(1),
  type: z.literal("group"),
  combinator: z.enum(["and", "or"]),
  get children() {
    return z.array(z.union([FilterPredicate, FilterGroup]));
  },
});

export const SortSpec = z.object({ columnId: z.string().min(1), direction: z.enum(["asc", "desc"]) });
export type SortSpec = z.infer<typeof SortSpec>;

export const AggregationSpec = z.object({
  columnId: z.string().min(1),
  function: z.enum(["sum", "avg", "min", "max", "count"]),
});
export type AggregationSpec = z.infer<typeof AggregationSpec>;

export const Density = z.enum(["compact", "comfortable", "spacious"]);

export const ViewState = z.object({
  visibleColumnIds: z.array(z.string()),
  columnOrder: z.array(z.string()),
  pinnedColumnIds: z.object({ start: z.array(z.string()), end: z.array(z.string()) }),
  filters: FilterGroup.nullable(),
  sorts: z.array(SortSpec),
  groupBy: z.array(z.string()),
  aggregations: z.array(AggregationSpec),
  density: Density,
});
export type ViewState = z.infer<typeof ViewState>;

export const VersionedViewState = z.object({ revision: z.string().min(1), state: ViewState });
export type VersionedViewState = z.infer<typeof VersionedViewState>;

export const ViewOperation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("filter.add"), predicate: FilterPredicate, combineWith: z.enum(["and", "or"]) }),
  z.object({ type: z.literal("filter.clear") }),
  z.object({ type: z.literal("sort.set"), sorts: z.array(SortSpec) }),
  z.object({ type: z.literal("group.set"), columnIds: z.array(z.string()) }),
  z.object({ type: z.literal("columns.show"), columnIds: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("columns.hide"), columnIds: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("columns.order"), columnIds: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("columns.pin"), columnIds: z.array(z.string()), position: z.enum(["start", "end", "none"]) }),
  z.object({ type: z.literal("aggregation.set"), aggregations: z.array(AggregationSpec) }),
  z.object({ type: z.literal("density.set"), density: Density }),
  z.object({ type: z.literal("view.reset") }),
]);
export type ViewOperation = z.infer<typeof ViewOperation>;
export type OperationType = ViewOperation["type"];

export const ViewCapabilities = z.object({
  operations: z.array(z.string()),
  maxSorts: z.number().int().positive().optional(),
  maxGroups: z.number().int().positive().optional(),
  supportsAtomicApply: z.boolean(),
  supportsSnapshotRestore: z.boolean(),
  /** ADR 0009: true when the adapter reports manual view changes through `subscribe`. */
  observesChanges: z.boolean(),
});
export type ViewCapabilities = z.infer<typeof ViewCapabilities>;

export const UnsupportedCategory = z.enum(["data_mutation", "workflow_action", "navigation", "export", "restricted_column", "unknown"]);
export type UnsupportedCategory = z.infer<typeof UnsupportedCategory>;

export const DecisionEvidence = z.object({
  key: z.string(),
  selectedId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(["deterministic", "provider", "host", "user"]),
});
export type DecisionEvidence = z.infer<typeof DecisionEvidence>;

export const Clarification = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  required: z.literal(true),
});
export type Clarification = z.infer<typeof Clarification>;

export const ViewPlan = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  baseRevision: z.string().min(1),
  source: z.object({
    channel: z.enum(["typed", "dictated", "api"]),
    text: z.string().optional(),
  }),
  status: z.enum(["ready", "needs_clarification", "unsupported"]),
  operations: z.array(ViewOperation),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.array(DecisionEvidence),
  clarifications: z.array(Clarification),
  unsupportedSegments: z.array(z.object({ text: z.string().optional(), category: UnsupportedCategory })),
});
export type ViewPlan = z.infer<typeof ViewPlan>;

export const emptyViewState = (columnIds: string[]): ViewState => ({
  visibleColumnIds: [...columnIds],
  columnOrder: [...columnIds],
  pinnedColumnIds: { start: [], end: [] },
  filters: null,
  sorts: [],
  groupBy: [],
  aggregations: [],
  density: "comfortable",
});
