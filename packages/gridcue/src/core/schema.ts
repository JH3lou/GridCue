import type { ColumnCapability, ColumnDescriptor, ColumnKind, EnumValue, FilterOperator, ViewSchema } from "./protocol";

/** The view operations GridCue can perform on a column by default. */
export const DEFAULT_CAPABILITIES: ColumnCapability[] = ["filter", "sort", "group", "show", "hide", "reorder"];

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

export interface ColumnInput {
  id: string;
  label?: string;
  kind?: ColumnKind;
}

export interface ColumnOverride {
  label?: string;
  kind?: ColumnKind;
  description?: string;
  aliases?: string[];
  capabilities?: ColumnCapability[];
  allowedOperators?: FilterOperator[];
  enumValues?: EnumValue[];
}

export interface SchemaOptions {
  id?: string;
  version?: string;
  /** Per-column additions: aliases, descriptions, approved enum values, narrower capabilities. */
  columns?: Record<string, ColumnOverride>;
  /** Column IDs GridCue must never expose to a provider or act on. */
  restricted?: string[];
  /** Rows used only to infer missing kinds. They never leave the caller. */
  sampleRows?: ReadonlyArray<Record<string, unknown>>;
}

/** Turns "market_value" or "marketValue" into "Market value". */
export const humanize = (id: string): string => {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T/;

/** Infers a column kind from sample values. Currency and percent can't be inferred; declare them. */
export const inferKind = (values: readonly unknown[]): ColumnKind => {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (present.length === 0) return "string";
  if (present.every((v) => typeof v === "boolean")) return "boolean";
  if (present.every((v) => typeof v === "number" && Number.isFinite(v))) return "number";
  if (present.every((v) => v instanceof Date || (typeof v === "string" && ISO_DATETIME.test(v)))) return "datetime";
  if (present.every((v) => typeof v === "string" && ISO_DATE.test(v))) return "date";
  return "string";
};

/** Builds a ViewSchema from the columns a table already has. */
export const defineSchema = (columns: readonly ColumnInput[], options: SchemaOptions = {}): ViewSchema => {
  const restricted = new Set(options.restricted ?? []);
  const sample = options.sampleRows ?? [];
  return {
    id: options.id ?? "default",
    version: options.version ?? "1",
    columns: columns.map((input): ColumnDescriptor => {
      const override = options.columns?.[input.id] ?? {};
      const kind = override.kind ?? input.kind ?? (override.enumValues ? "enum" : inferKind(sample.map((row) => row[input.id])));
      const isRestricted = restricted.has(input.id);
      return {
        id: input.id,
        label: override.label ?? input.label ?? humanize(input.id),
        kind,
        ...(override.description ? { description: override.description } : {}),
        ...(override.aliases ? { aliases: override.aliases } : {}),
        capabilities: isRestricted ? [] : (override.capabilities ?? DEFAULT_CAPABILITIES),
        ...(override.allowedOperators ? { allowedOperators: override.allowedOperators } : {}),
        sensitivity: isRestricted ? "restricted" : "internal",
        exposeToProvider: !isRestricted,
        ...(override.enumValues ? { enumValues: override.enumValues } : {}),
      };
    }),
  };
};

export const isExposed = (column: ColumnDescriptor): boolean => column.sensitivity !== "restricted" && column.exposeToProvider !== false;

export interface ProviderPayloadColumn {
  id: string;
  label: string;
  kind: ColumnKind;
  aliases?: string[];
  description?: string;
  enumValues?: EnumValue[];
}

/** Exactly what an Intent Provider may receive about this schema. Rows are never included. */
export const describeProviderPayload = (schema: ViewSchema): { columns: ProviderPayloadColumn[]; rows: "never sent" } => ({
  columns: schema.columns.filter(isExposed).map((c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind,
    ...(c.aliases ? { aliases: c.aliases } : {}),
    ...(c.description ? { description: c.description } : {}),
    ...(c.enumValues ? { enumValues: c.enumValues } : {}),
  })),
  rows: "never sent",
});

export const findColumn = (schema: ViewSchema, id: string): ColumnDescriptor | undefined => schema.columns.find((c) => c.id === id);
