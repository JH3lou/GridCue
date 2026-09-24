import { z } from "zod";
import type { Mention } from "./mentions";
import type { NormalizedInput } from "./normalize";
import type { ColumnCapability, OperationType, ViewCapabilities, ViewSchema, ViewState } from "./protocol";
import { ColumnKind, EnumValue, FilterOperator, PROTOCOL_VERSION, SortSpec } from "./protocol";
import { isExposed, operatorsFor } from "./schema";

/** Operation families a clause can ask for. Providers choose among these; they never emit operations. */
export const VIEW_FAMILIES = [
  "filter",
  "sort",
  "group",
  "columns.show",
  "columns.hide",
  "columns.only",
  "filter.clear",
  "sort.clear",
  "group.clear",
  "view.reset",
] as const;
export type ViewFamily = (typeof VIEW_FAMILIES)[number];

export const UNSUPPORTED_FAMILIES = [
  "unsupported.data_mutation",
  "unsupported.workflow_action",
  "unsupported.navigation",
  "unsupported.export",
] as const;
export type UnsupportedFamily = (typeof UNSUPPORTED_FAMILIES)[number];
export type Family = ViewFamily | UnsupportedFamily;

/** Families that act on named columns, and the column capability each needs. */
export const COLUMN_FAMILIES: Partial<Record<ViewFamily, ColumnCapability[]>> = {
  filter: ["filter"],
  sort: ["sort"],
  group: ["group"],
  "columns.show": ["show"],
  "columns.hide": ["hide"],
  "columns.only": ["show", "hide", "reorder"],
};

const FAMILY_OPERATIONS: Record<ViewFamily, OperationType[]> = {
  filter: ["filter.add"],
  sort: ["sort.set"],
  group: ["group.set"],
  "columns.show": ["columns.show"],
  "columns.hide": ["columns.hide"],
  "columns.only": ["columns.show", "columns.hide", "columns.order"],
  "filter.clear": ["filter.clear"],
  "sort.clear": ["sort.set"],
  "group.clear": ["group.set"],
  "view.reset": ["view.reset"],
};

export const CandidateColumn = z.object({
  id: z.string(),
  label: z.string(),
  kind: ColumnKind,
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
  families: z.array(z.string()),
  operators: z.array(FilterOperator),
  enumValues: z.array(EnumValue).optional(),
  entity: z.string().optional(),
  valueGroups: z.array(z.object({ label: z.string(), aliases: z.array(z.string()).optional(), values: z.array(z.string()) })).optional(),
});
export type CandidateColumn = z.infer<typeof CandidateColumn>;

const LiteralSchema = z.object({
  kind: z.enum(["number", "currency", "percent", "date", "text", "unreadable"]),
  value: z.union([z.number(), z.string()]),
  upper: z.union([z.number(), z.string()]).optional(),
  comparator: z.enum(["eq", "gt", "gte", "lt", "lte", "between"]).optional(),
  at: z.number(),
});

export const ResolutionRequest = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  utterance: z.string().max(2000),
  clauses: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        text: z.string(),
        literals: z.array(LiteralSchema),
        direction: z.enum(["asc", "desc"]).optional(),
        continues: z.enum(["sort", "group"]).optional(),
        /** Columns and enum values core already matched by a Host-declared name. A provider may skip asking about them. */
        mentions: z
          .array(
            z.object({
              columnId: z.string(),
              valueId: z.string().optional(),
              /** A row or entity noun ("households") that could mean the column or the records (ADR 0015). */
              ambiguous: z.literal(true).optional(),
              /** The words as written, for the provider's reading question. */
              text: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .max(12),
  candidates: z.object({ families: z.array(z.string()), columns: z.array(CandidateColumn), rowNoun: z.string().optional() }),
  view: z.object({
    visibleColumnIds: z.array(z.string()),
    sorts: z.array(SortSpec),
    groupBy: z.array(z.string()),
    hasFilters: z.boolean(),
  }),
});
export type ResolutionRequest = z.infer<typeof ResolutionRequest>;

export const Pick = z.object({ id: z.string(), confidence: z.number().min(0).max(1) });
export type Pick = z.infer<typeof Pick>;

export const ClauseResolution = z.object({
  clauseIndex: z.number().int().nonnegative(),
  families: z.array(Pick),
  /** Columns the clause refers to, in the order they are mentioned. */
  columns: z.array(Pick),
  /** Approved enum value IDs, or "true"/"false" for boolean columns. */
  values: z.array(z.object({ columnId: z.string(), valueId: z.string(), confidence: z.number().min(0).max(1) })),
  direction: Pick.optional(),
  /** Phrases that look like column references but match no candidate. Never guessed at. */
  unmatchedTerms: z.array(z.string()),
  /** Per column and column family: does the Clause ask for that change to that column? Optional (fan-out spec). */
  roles: z.array(z.object({ columnId: z.string(), family: z.string(), confidence: z.number().min(0).max(1) })).optional(),
  /** The kind of change the Clause mainly asks for, as a relative pick over the families. Optional. */
  kind: Pick.optional(),
  /** Probability that a sort or grouping adds a level to the current view's, rather than replacing it. Optional. */
  adds: z.number().min(0).max(1).optional(),
  /** For reversal wording ("advisor within custodian"): is `outerId` the outer grouping or primary sort? Optional. */
  outer: z.array(z.object({ outerId: z.string(), innerId: z.string(), confidence: z.number().min(0).max(1) })).optional(),
  /** What an ambiguous row or entity noun refers to (ADR 0015). Optional. */
  readings: z
    .array(z.object({ columnId: z.string(), reading: z.enum(["column", "records", "rows"]), confidence: z.number().min(0).max(1) }))
    .optional(),
  /** The column each literal applies to, by its index in the Clause's `literals`. Optional. */
  literalColumns: z
    .array(z.object({ literalIndex: z.number().int().nonnegative(), columnId: z.string(), confidence: z.number().min(0).max(1) }))
    .optional(),
});
export type ClauseResolution = z.infer<typeof ClauseResolution>;

export const ResolutionResult = z.object({ clauses: z.array(ClauseResolution) });
export type ResolutionResult = z.infer<typeof ResolutionResult>;

export interface IntentProvider {
  resolve(request: ResolutionRequest, signal?: AbortSignal): Promise<ResolutionResult>;
}

/** The closed choice sets a provider may pick from, derived only from the schema and adapter capabilities. */
export const buildCandidates = (schema: ViewSchema, capabilities: ViewCapabilities): ResolutionRequest["candidates"] => {
  const ops = new Set(capabilities.operations);
  const families = VIEW_FAMILIES.filter((f) => FAMILY_OPERATIONS[f].every((op) => ops.has(op)));
  const columns = schema.columns.filter(isExposed).map(
    (c): CandidateColumn => ({
      id: c.id,
      label: c.label,
      kind: c.kind,
      ...(c.aliases ? { aliases: c.aliases } : {}),
      ...(c.description ? { description: c.description } : {}),
      families: families.filter((f) => COLUMN_FAMILIES[f]?.every((cap) => c.capabilities.includes(cap))),
      operators: operatorsFor(c),
      ...(c.enumValues ? { enumValues: c.enumValues } : {}),
      ...(c.entity ? { entity: c.entity } : {}),
      ...(c.valueGroups ? { valueGroups: c.valueGroups } : {}),
    }),
  );
  return { families: [...families, ...UNSUPPORTED_FAMILIES], columns, ...(schema.rowNoun ? { rowNoun: schema.rowNoun } : {}) };
};

export const buildResolutionRequest = (
  input: NormalizedInput,
  schema: ViewSchema,
  capabilities: ViewCapabilities,
  state: ViewState,
  mentions: readonly Mention[] = [],
): ResolutionRequest => ({
  protocolVersion: PROTOCOL_VERSION,
  utterance: input.text,
  clauses: input.clauses.map((clause) => {
    const own = mentions
      .filter((m) => m.clauseIndex === clause.index)
      .map(({ columnId, valueId, ambiguous, text }) =>
        valueId !== undefined ? { columnId, valueId } : ambiguous ? { columnId, ambiguous, ...(text ? { text } : {}) } : { columnId },
      );
    return own.length > 0 ? { ...clause, mentions: own } : clause;
  }),
  candidates: buildCandidates(schema, capabilities),
  view: {
    visibleColumnIds: state.visibleColumnIds,
    sorts: state.sorts,
    groupBy: state.groupBy,
    hasFilters: state.filters !== null,
  },
});
