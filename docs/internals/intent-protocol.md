# Intent-to-view protocol

This document defines the initial public contract. It is a design target for the scaffold, not a claim that packages have already been published.

## Goals

- Represent a grid view independently of any UI framework or grid library.
- Represent proposed changes as a small, serializable, closed union.
- Validate every identifier, operator, value, capability, and state revision.
- Preserve ambiguity and provider confidence without granting provider output authority.
- Make preview, audit, adapter contract testing, and undo deterministic.

## Schema and capabilities

```ts
type ColumnKind =
  | "string"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "datetime"
  | "boolean"
  | "enum";

type ColumnCapability =
  | "filter"
  | "sort"
  | "group"
  | "aggregate"
  | "show"
  | "hide"
  | "reorder"
  | "pin";

type Sensitivity = "public" | "internal" | "restricted";

interface ColumnDescriptor {
  id: string;                 // Stable host ID; never inferred from label.
  label: string;
  description?: string;       // Short, approved semantic description.
  kind: ColumnKind;
  aliases?: string[];
  capabilities: ColumnCapability[];
  allowedOperators?: FilterOperator[];
  sensitivity: Sensitivity;
  exposeToProvider?: boolean; // Defaults false for restricted columns.
  enumValues?: Array<{ id: string; label: string; aliases?: string[] }>;
}

interface ViewSchema {
  id: string;
  version: string;
  columns: ColumnDescriptor[];
}

interface ViewCapabilities {
  operations: ViewOperation["type"][];
  maxSorts?: number;
  maxGroups?: number;
  supportsAtomicApply: boolean;
  supportsSnapshotRestore: boolean;
}
```

`enumValues` contains only values the host permits GridCue to use for resolution. Do not populate it by blindly uploading distinct values from a dataset.

## Canonical view state

```ts
type Scalar = string | number | boolean | null;

type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "contains"
  | "startsWith"
  | "in"
  | "isEmpty"
  | "isNotEmpty";

interface FilterPredicate {
  id: string;
  type: "predicate";
  columnId: string;
  operator: FilterOperator;
  value?: Scalar | Scalar[] | { min: Scalar; max: Scalar };
}

interface FilterGroup {
  id: string;
  type: "group";
  combinator: "and" | "or";
  children: Array<FilterPredicate | FilterGroup>;
}

interface SortSpec {
  columnId: string;
  direction: "asc" | "desc";
}

interface AggregationSpec {
  columnId: string;
  function: "sum" | "avg" | "min" | "max" | "count";
}

interface ViewState {
  visibleColumnIds: string[];
  columnOrder: string[];
  pinnedColumnIds: { start: string[]; end: string[] };
  filters: FilterGroup | null;
  sorts: SortSpec[];
  groupBy: string[];
  aggregations: AggregationSpec[];
  density: "compact" | "comfortable" | "spacious";
}

interface VersionedViewState {
  revision: string;
  state: ViewState;
}
```

Adapters may support only a subset. Their capability declaration determines what can compile into an applicable plan.

## Operations

```ts
type ViewOperation =
  | {
      type: "filter.add";
      predicate: FilterPredicate;
      combineWith: "and" | "or";
    }
  | { type: "filter.clear" }
  | { type: "sort.set"; sorts: SortSpec[] }
  | { type: "group.set"; columnIds: string[] }
  | { type: "columns.show"; columnIds: string[] }
  | { type: "columns.hide"; columnIds: string[] }
  | { type: "columns.order"; columnIds: string[] }
  | {
      type: "columns.pin";
      columnIds: string[];
      position: "start" | "end" | "none";
    }
  | { type: "aggregation.set"; aggregations: AggregationSpec[] }
  | {
      type: "density.set";
      density: ViewState["density"];
    }
  | { type: "view.reset" };
```

The first implementation supports the MVP subset named in the approved build spec under `docs/superpowers/specs/`. A declared-but-unimplemented operation returns `unsupported`; it is not silently dropped.

Operation order is significant during compilation and preview, but the validator calculates one final state and the adapter applies it atomically.

## Plan

```ts
type ResolutionStatus =
  | "ready"
  | "needs_clarification"
  | "unsupported";

interface DecisionEvidence {
  key: string;
  selectedId?: string;
  confidence?: number;
  source: "deterministic" | "provider" | "host";
}

interface Clarification {
  id: string;
  prompt: string;
  options?: Array<{ id: string; label: string }>;
  required: true;
}

interface ViewPlan {
  protocolVersion: "0.1";
  id: string;
  baseRevision: string;
  source: {
    channel: "typed" | "dictated" | "api";
    text?: string; // May be omitted from persisted/audit representations.
  };
  status: ResolutionStatus;
  operations: ViewOperation[];
  confidence?: number;
  evidence: DecisionEvidence[];
  clarifications: Clarification[];
  unsupportedSegments: Array<{
    text?: string;
    category: "data_mutation" | "workflow_action" | "navigation" | "export" | "unknown";
  }>;
}
```

Only a plan with `status: "ready"`, no clarifications, no unsupported segments, a current `baseRevision`, and a successful validation result can be branded as `ApplicableViewPlan` inside core. External callers cannot create that brand by type assertion; runtime validation produces it.

## Validation invariants

Before preview and again before apply:

1. Protocol, schema, and state shapes pass runtime validation.
2. `baseRevision` equals the adapter's current revision.
3. Every operation is declared by adapter capabilities.
4. Every column ID exists and permits that operation.
5. Every operator is legal for the column kind and host policy.
6. Every value has the required type and, for closed enums, resolves to an approved ID.
7. Cardinality limits for sorting/grouping are respected.
8. The plan contains no clarification or unsupported segment.
9. The resulting state is internally consistent: no duplicate order IDs, missing visible columns, or incompatible grouping/aggregation.
10. The whole plan can apply atomically.

Validation failure never mutates view state.

## Example plan

Request:

> “Only taxable accounts over $1 million, grouped by advisor, biggest first.”

Illustrative result:

```json
{
  "protocolVersion": "0.1",
  "id": "plan_01",
  "baseRevision": "view_42",
  "source": {
    "channel": "typed",
    "text": "Only taxable accounts over $1 million, grouped by advisor, biggest first."
  },
  "status": "ready",
  "operations": [
    {
      "type": "filter.add",
      "predicate": {
        "id": "filter_taxable",
        "type": "predicate",
        "columnId": "registration_type",
        "operator": "eq",
        "value": "taxable"
      },
      "combineWith": "and"
    },
    {
      "type": "filter.add",
      "predicate": {
        "id": "filter_value",
        "type": "predicate",
        "columnId": "market_value",
        "operator": "gt",
        "value": 1000000
      },
      "combineWith": "and"
    },
    {
      "type": "group.set",
      "columnIds": ["advisor_name"]
    },
    {
      "type": "sort.set",
      "sorts": [{ "columnId": "market_value", "direction": "desc" }]
    }
  ],
  "confidence": 0.94,
  "evidence": [
    {
      "key": "filter.registration.column",
      "selectedId": "registration_type",
      "confidence": 0.97,
      "source": "provider"
    },
    {
      "key": "filter.market_value.literal",
      "selectedId": "1000000",
      "source": "deterministic"
    }
  ],
  "clarifications": [],
  "unsupportedSegments": []
}
```

The preview text is generated from this validated structure, for example:

> Filter Registration Type to Taxable; filter Market Value above $1,000,000; group by Advisor; sort Market Value descending. No records will be changed.

## Ambiguity example

Request:

> “Show the big accounts.”

If `big` has no host-defined semantic rule, the result is:

- `status: "needs_clarification"`;
- zero applicable operations;
- a bounded question such as “What minimum market value should count as big?”;
- no guessed threshold.

## Mixed-scope example

Request:

> “Show positions above 10% and sell them.”

The filter can be understood, but `sell them` is a prohibited workflow action. The entire plan remains non-applicable with an `unsupportedSegments` entry. GridCue must not quietly apply the filter and imply that the whole request succeeded.

## Provider contract notes

Provider-specific outputs are internal. A provider returns selected candidate IDs, probabilities/confidence, and unresolved decisions. It does not return `ViewOperation` objects. This separation prevents a model response from bypassing compiler and policy logic.

Every candidate set includes an explicit escape such as `none`, `ambiguous`, or `unsupported`. A provider error, malformed response, unknown choice, or missing material decision yields a non-applicable result.

## Versioning

- Additive optional fields may remain within protocol `0.1` during pre-release development.
- Any new operation, changed operation meaning, removed field, or altered validation invariant requires an ADR and a protocol-version decision.
- Adapters declare the protocol versions they support and fail closed on unknown versions.
