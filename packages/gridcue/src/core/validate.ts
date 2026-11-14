import { operatorsFor } from "./columns";
import { GridCueError, type Issue } from "./errors";
import {
  type ColumnCapability,
  type ColumnDescriptor,
  type FilterPredicate,
  type VersionedViewState,
  type ViewCapabilities,
  type ViewOperation,
  ViewPlan,
  type ViewSchema,
  type ViewState,
} from "./protocol";
import { applyOperations } from "./reduce";

declare const applicableBrand: unique symbol;
/** A plan that passed every check against a specific revision. Only `validatePlan` creates one. */
export type ApplicableViewPlan = ViewPlan & { readonly [applicableBrand]: true };

const applicable = new WeakMap<object, ViewState>();

/** True only for plans produced by `validatePlan`. Adapters call this before applying. */
export const isApplicable = (plan: unknown): plan is ApplicableViewPlan =>
  typeof plan === "object" && plan !== null && applicable.has(plan);

/** The view a validated plan produces, computed once by `validatePlan`. */
export const resultingState = (plan: ApplicableViewPlan): ViewState => {
  const state = applicable.get(plan);
  if (!state) throw new GridCueError("ADAPTER_NOT_APPLICABLE", "Plan was not validated.");
  return structuredClone(state);
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

export interface ValidationContext {
  schema: ViewSchema;
  capabilities: ViewCapabilities;
  current: VersionedViewState;
  defaultState: ViewState;
}

export type ValidationResult = { ok: true; plan: ApplicableViewPlan; state: ViewState } | { ok: false; issues: Issue[] };

const CAPABILITY_FOR: Partial<Record<ViewOperation["type"], ColumnCapability>> = {
  "filter.add": "filter",
  "sort.set": "sort",
  "group.set": "group",
  "columns.show": "show",
  "columns.hide": "hide",
  "columns.order": "reorder",
  "columns.pin": "pin",
  "aggregation.set": "aggregate",
};

const columnIdsOf = (op: ViewOperation): string[] => {
  switch (op.type) {
    case "filter.add":
      return [op.predicate.columnId];
    case "sort.set":
      return op.sorts.map((s) => s.columnId);
    case "group.set":
    case "columns.show":
    case "columns.hide":
    case "columns.order":
    case "columns.pin":
      return op.columnIds;
    case "aggregation.set":
      return op.aggregations.map((a) => a.columnId);
    default:
      return [];
  }
};

const valueIssue = (p: Pick<FilterPredicate, "operator" | "value">, column: ColumnDescriptor): string | undefined => {
  const v = p.value;
  if (p.operator === "isEmpty" || p.operator === "isNotEmpty") return v === undefined ? undefined : "takes no value";
  const numeric = ["number", "currency", "percent"].includes(column.kind);
  const one = (x: unknown): boolean => {
    if (numeric) return typeof x === "number" && Number.isFinite(x);
    if (column.kind === "boolean") return typeof x === "boolean";
    if (column.kind === "date") return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
    if (column.kind === "datetime") return typeof x === "string" && !Number.isNaN(Date.parse(x));
    if (column.kind === "enum") return typeof x === "string" && (!column.enumValues || column.enumValues.some((e) => e.id === x));
    return typeof x === "string";
  };
  if (p.operator === "between") {
    return typeof v === "object" && v !== null && !Array.isArray(v) && one(v.min) && one(v.max) ? undefined : "needs a valid range";
  }
  if (p.operator === "in") return Array.isArray(v) && v.length > 0 && v.every(one) ? undefined : "needs a list of valid values";
  return one(v) ? undefined : "has a value of the wrong type";
};

/** Why a column can't take a change that needs `capability`, as an issue, or `undefined`. */
const columnIssue = (column: ColumnDescriptor | undefined, capability: ColumnCapability | undefined): Issue | undefined => {
  if (!column) return { code: "PLAN_UNKNOWN_COLUMN", message: "The plan refers to a column that does not exist." };
  if (column.sensitivity === "restricted") return { code: "POLICY_RESTRICTED_COLUMN", message: `${column.label} is restricted.` };
  if (capability && !column.capabilities.includes(capability)) {
    return { code: "PLAN_COLUMN_CAPABILITY", message: `${column.label} cannot be used for ${capability}.` };
  }
  return undefined;
};

/**
 * Every reason one filter can't apply on this schema: its column does not exist, is restricted or may not be filtered,
 * does not allow the operator, or the value does not fit its kind. `validatePlan` checks a plan's filters with it, and
 * `defineSchema` a House Term's conditions (ADR 0024), so the two can't drift apart.
 */
export const filterIssues = (p: Pick<FilterPredicate, "columnId" | "operator" | "value">, schema: ViewSchema): Issue[] => {
  const column = schema.columns.find((c) => c.id === p.columnId);
  const issues: Issue[] = [];
  const unusable = columnIssue(column, "filter");
  if (unusable) issues.push(unusable);
  if (column && column.sensitivity !== "restricted") {
    if (!operatorsFor(column).includes(p.operator)) {
      issues.push({ code: "PLAN_OPERATOR_NOT_ALLOWED", message: `${column.label} cannot use ${p.operator}.` });
    } else {
      const problem = valueIssue(p, column);
      if (problem) issues.push({ code: "PLAN_VALUE_TYPE", message: `The filter on ${column.label} ${problem}.` });
    }
  }
  return issues;
};

/**
 * Checks a plan against the schema, the adapter's capabilities, and the current revision.
 * Runs before preview and again before apply. A failed check never changes view state.
 */
export const validatePlan = (input: unknown, ctx: ValidationContext): ValidationResult => {
  const parsed = ViewPlan.safeParse(input);
  if (!parsed.success) return { ok: false, issues: [{ code: "PLAN_SHAPE", message: "The plan is malformed." }] };
  const plan = parsed.data;
  const issues: Issue[] = [];
  const add = (code: Issue["code"], message: string, path?: string) => issues.push(path ? { code, message, path } : { code, message });

  if (plan.baseRevision !== ctx.current.revision) add("PLAN_STALE_REVISION", "The view changed since this plan was made.");
  if (plan.status !== "ready" || plan.clarifications.length > 0 || plan.unsupportedSegments.length > 0) {
    add("PLAN_NOT_READY", "The plan still needs clarification or contains an unsupported request.");
  }
  if (!ctx.capabilities.supportsAtomicApply) add("PLAN_NOT_ATOMIC", "This grid cannot apply changes atomically.");

  plan.operations.forEach((op, i) => {
    const path = `operations.${i}`;
    if (!ctx.capabilities.operations.includes(op.type)) {
      add("PLAN_OPERATION_UNSUPPORTED", `This grid does not support ${op.type}.`, path);
      return;
    }
    if (op.type === "filter.add") {
      for (const issue of filterIssues(op.predicate, ctx.schema)) add(issue.code, issue.message, path);
    } else {
      const capability = CAPABILITY_FOR[op.type];
      for (const id of columnIdsOf(op)) {
        const issue = columnIssue(
          ctx.schema.columns.find((c) => c.id === id),
          capability,
        );
        if (issue) add(issue.code, issue.message, path);
      }
    }
    if (op.type === "sort.set" && ctx.capabilities.maxSorts && op.sorts.length > ctx.capabilities.maxSorts) {
      add("PLAN_CARDINALITY", `This grid sorts by at most ${ctx.capabilities.maxSorts} columns.`, path);
    }
    if (op.type === "group.set" && ctx.capabilities.maxGroups && op.columnIds.length > ctx.capabilities.maxGroups) {
      add("PLAN_CARDINALITY", `This grid groups by at most ${ctx.capabilities.maxGroups} columns.`, path);
    }
  });
  if (issues.length > 0) return { ok: false, issues };

  const state = applyOperations(ctx.current.state, plan.operations, ctx.defaultState);
  const known = new Set(ctx.schema.columns.map((c) => c.id));
  if (new Set(state.columnOrder).size !== state.columnOrder.length) add("PLAN_INCONSISTENT_STATE", "Column order has duplicates.");
  if (state.visibleColumnIds.some((id) => !state.columnOrder.includes(id) || !known.has(id))) {
    add("PLAN_INCONSISTENT_STATE", "A visible column is missing from the column order.");
  }
  if (state.visibleColumnIds.length === 0) add("PLAN_INCONSISTENT_STATE", "The plan would hide every column.");
  if (issues.length > 0) return { ok: false, issues };

  const frozen = deepFreeze(plan);
  applicable.set(frozen, deepFreeze(structuredClone(state)));
  return { ok: true, plan: frozen as ApplicableViewPlan, state };
};
