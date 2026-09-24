# Resolution Chassis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved resolution chassis spec. Hosts choose a Jev strategy and describe their domain (`rowNoun`, `entity`, `valueGroups`). GridCue uses those declarations to handle row nouns that are also columns, values after the verb, and categories spanning several values.

**Architecture:** Schema declarations flow into candidates and Mentions. The matcher expands value groups, marks excluded values, and flags ambiguous or ranked entity nouns. The compiler turns those into filters, complements, or a "whole records?" Clarification. The Jev provider's `strategy` and `signals` decide which questions are asked. The compiler is shared by every strategy.

**Spec:** `docs/superpowers/specs/2026-09-24-resolution-chassis-design.md`. The grill log is `docs/planning/configurable-resolution-grill.md`. Decisions and evidence are in ADR 0015.

## How this plan was verified

Every diff was built and run in a scratch worktree of `claude/resolution-chassis` on 2026-09-24, against live Jev.

| Check | Result |
| --- | --- |
| `pnpm check` | exit 0: 364 passed, 1 skipped |
| Fan-out, two consecutive verbose runs, 176 live requests | 0 wrong views and 0 unsafe in both. Core 31 of 31, live-only 55 of 56, fan-out 49 of 50, chassis 36 of 39 |
| Before the chassis, on the first 23 chassis cases | 10 exact, 2 wrong views, 1 unsafe |
| Regressions against the pre-chassis baseline | none, in either run |
| Focused against the PR #2 baseline cases | 76 exact where PR #2 got 64, with no regressions |
| Median latency | fan-out about 153 ms (148 before); focused about 137 ms |

### Decisions made while verifying

1. **A text-valued entity ranked by size means the records, and code decides it.** "Largest households first", "top reps first". Jev's reading question answered "column" (0.78 to 0.92) for these requests, and keeping them as uncertain Mentions produced 5 unsafe results and 7 wrong views in one run. The column-kind rule replaced that approach.
2. **Excluded values filter to the column's other approved values.** This covers "non-", "excluding", "except" and "not at".
3. **`values` is opt-in, not in the fan-out default.** Ablation showed it decided 1 case against a bar of 3. It stays available as configuration, per the owner's direction.
4. **The existing error code `INPUT_SCHEMA` is used** for an invalid value group. The spec had said `SCHEMA_INVALID`.
5. **Duplicate-family fix.** A family added by a rule and promoted by the provider runs once. "Show IRAs at Northgate" had produced a duplicate filter.
6. **Two live-only labels changed on the owner's direction.** "Largest/Top households first" now expect the records question. ADR 0015 records this.

### Task 1: Schema declarations and protocol fields

**Files:**
- Modify `packages/gridcue/src/core/protocol.ts`
- Modify `packages/gridcue/src/core/schema.ts`
- Modify `packages/gridcue/src/core/resolution.ts`

- [ ] **Step 1: Add `rowNoun`, `entity` and `valueGroups`, validate groups, and describe them in the provider payload**

```diff
diff --git a/packages/gridcue/src/core/protocol.ts b/packages/gridcue/src/core/protocol.ts
index 33c489c..4d82d9c 100644
--- a/packages/gridcue/src/core/protocol.ts
+++ b/packages/gridcue/src/core/protocol.ts
@@ -48,6 +48,12 @@ export const ColumnDescriptor = z.object({
   sensitivity: Sensitivity,
   exposeToProvider: z.boolean().optional(),
   enumValues: z.array(EnumValue).optional(),
+  /** The other record this column names, such as "household", so "largest households first" can be read either way. */
+  entity: z.string().min(1).optional(),
+  /** Host-named categories over this column's enum values, such as Retirement = IRA and Roth IRA. */
+  valueGroups: z
+    .array(z.object({ label: z.string().min(1), aliases: z.array(z.string()).optional(), values: z.array(z.string()).min(1) }))
+    .optional(),
 });
 export type ColumnDescriptor = z.infer<typeof ColumnDescriptor>;
 
@@ -55,6 +61,8 @@ export const ViewSchema = z.object({
   id: z.string().min(1),
   version: z.string().min(1),
   columns: z.array(ColumnDescriptor),
+  /** What one row is, such as "account". Its name in a request means the rows, not a column. */
+  rowNoun: z.string().min(1).optional(),
 });
 export type ViewSchema = z.infer<typeof ViewSchema>;
 
diff --git a/packages/gridcue/src/core/schema.ts b/packages/gridcue/src/core/schema.ts
index 6180a8a..0ec286f 100644
--- a/packages/gridcue/src/core/schema.ts
+++ b/packages/gridcue/src/core/schema.ts
@@ -35,6 +35,10 @@ export interface ColumnOverride {
   capabilities?: ColumnCapability[];
   allowedOperators?: FilterOperator[];
   enumValues?: EnumValue[];
+  /** The other record this column names, such as "household" (ADR 0015). */
+  entity?: string;
+  /** Categories over this column's enum values, such as `{ label: "Retirement", values: ["ira", "roth_ira"] }`. */
+  valueGroups?: Array<{ label: string; aliases?: string[]; values: string[] }>;
 }
 
 export interface SchemaOptions {
@@ -44,6 +48,8 @@ export interface SchemaOptions {
   columns?: Record<string, ColumnOverride>;
   /** Column IDs GridCue must never expose to a provider or act on. */
   restricted?: string[];
+  /** What one row is, such as "account" (ADR 0015). */
+  rowNoun?: string;
   /** Rows used only to infer missing kinds. They never leave the caller. */
   sampleRows?: ReadonlyArray<Record<string, unknown>>;
 }
@@ -91,9 +97,18 @@ export const defineSchema = (columns: readonly ColumnInput[], options: SchemaOpt
     throw new GridCueError("INPUT_SCHEMA", `columns names an id that matches no column: ${unknownOverrides.join(", ")}.`);
   }
 
+  for (const [id, override] of Object.entries(options.columns ?? {})) {
+    const known = new Set((override.enumValues ?? []).map((v) => v.id));
+    const stray = (override.valueGroups ?? []).flatMap((g) => g.values).filter((v) => !known.has(v));
+    if (stray.length > 0) {
+      throw new GridCueError("INPUT_SCHEMA", `valueGroups on ${id} name values that are not in its enumValues: ${stray.join(", ")}.`);
+    }
+  }
+
   const schema: ViewSchema = {
     id: options.id ?? "default",
     version: options.version ?? "1",
+    ...(options.rowNoun ? { rowNoun: options.rowNoun } : {}),
     columns: columns.map((input): ColumnDescriptor => {
       const override = options.columns?.[input.id] ?? {};
       const kind = override.kind ?? input.kind ?? (override.enumValues ? "enum" : inferKind(sample.map((row) => row[input.id])));
@@ -109,6 +124,8 @@ export const defineSchema = (columns: readonly ColumnInput[], options: SchemaOpt
         sensitivity: isRestricted ? "restricted" : "internal",
         exposeToProvider: !isRestricted,
         ...(override.enumValues ? { enumValues: override.enumValues } : {}),
+        ...(override.entity ? { entity: override.entity } : {}),
+        ...(override.valueGroups ? { valueGroups: override.valueGroups } : {}),
       };
     }),
   };
@@ -130,10 +147,15 @@ export interface ProviderPayloadColumn {
   aliases?: string[];
   description?: string;
   enumValues?: EnumValue[];
+  entity?: string;
+  valueGroups?: Array<{ label: string; aliases?: string[]; values: string[] }>;
 }
 
 /** Exactly what an Intent Provider may receive about this schema. Rows are never included. */
-export const describeProviderPayload = (schema: ViewSchema): { columns: ProviderPayloadColumn[]; rows: "never sent" } => ({
+export const describeProviderPayload = (
+  schema: ViewSchema,
+): { columns: ProviderPayloadColumn[]; rowNoun?: string; rows: "never sent" } => ({
+  ...(schema.rowNoun ? { rowNoun: schema.rowNoun } : {}),
   columns: schema.columns.filter(isExposed).map((c) => ({
     id: c.id,
     label: c.label,
@@ -141,6 +163,8 @@ export const describeProviderPayload = (schema: ViewSchema): { columns: Provider
     ...(c.aliases ? { aliases: c.aliases } : {}),
     ...(c.description ? { description: c.description } : {}),
     ...(c.enumValues ? { enumValues: c.enumValues } : {}),
+    ...(c.entity ? { entity: c.entity } : {}),
+    ...(c.valueGroups ? { valueGroups: c.valueGroups } : {}),
   })),
   rows: "never sent",
 });
```

- [ ] **Step 2: Send them in candidates; add ambiguous Mentions and `readings`**

```diff
diff --git a/packages/gridcue/src/core/resolution.ts b/packages/gridcue/src/core/resolution.ts
index 5e14d49..7d6356e 100644
--- a/packages/gridcue/src/core/resolution.ts
+++ b/packages/gridcue/src/core/resolution.ts
@@ -61,6 +61,8 @@ export const CandidateColumn = z.object({
   families: z.array(z.string()),
   operators: z.array(FilterOperator),
   enumValues: z.array(EnumValue).optional(),
+  entity: z.string().optional(),
+  valueGroups: z.array(z.object({ label: z.string(), aliases: z.array(z.string()).optional(), values: z.array(z.string()) })).optional(),
 });
 export type CandidateColumn = z.infer<typeof CandidateColumn>;
 
@@ -83,11 +85,22 @@ export const ResolutionRequest = z.object({
         literals: z.array(LiteralSchema),
         direction: z.enum(["asc", "desc"]).optional(),
         /** Columns and enum values core already matched by a Host-declared name. A provider may skip asking about them. */
-        mentions: z.array(z.object({ columnId: z.string(), valueId: z.string().optional() })).optional(),
+        mentions: z
+          .array(
+            z.object({
+              columnId: z.string(),
+              valueId: z.string().optional(),
+              /** A row or entity noun ("households") that could mean the column or the records (ADR 0015). */
+              ambiguous: z.literal(true).optional(),
+              /** The words as written, for the provider's reading question. */
+              text: z.string().optional(),
+            }),
+          )
+          .optional(),
       }),
     )
     .max(12),
-  candidates: z.object({ families: z.array(z.string()), columns: z.array(CandidateColumn) }),
+  candidates: z.object({ families: z.array(z.string()), columns: z.array(CandidateColumn), rowNoun: z.string().optional() }),
   view: z.object({
     visibleColumnIds: z.array(z.string()),
     sorts: z.array(SortSpec),
@@ -118,6 +131,10 @@ export const ClauseResolution = z.object({
   adds: z.number().min(0).max(1).optional(),
   /** For reversal wording ("advisor within custodian"): is `outerId` the outer grouping or primary sort? Optional. */
   outer: z.array(z.object({ outerId: z.string(), innerId: z.string(), confidence: z.number().min(0).max(1) })).optional(),
+  /** What an ambiguous row or entity noun refers to (ADR 0015). Optional. */
+  readings: z
+    .array(z.object({ columnId: z.string(), reading: z.enum(["column", "records", "rows"]), confidence: z.number().min(0).max(1) }))
+    .optional(),
   /** The column each literal applies to, by its index in the Clause's `literals`. Optional. */
   literalColumns: z
     .array(z.object({ literalIndex: z.number().int().nonnegative(), columnId: z.string(), confidence: z.number().min(0).max(1) }))
@@ -146,9 +163,11 @@ export const buildCandidates = (schema: ViewSchema, capabilities: ViewCapabiliti
       families: families.filter((f) => COLUMN_FAMILIES[f]?.every((cap) => c.capabilities.includes(cap))),
       operators: operatorsFor(c),
       ...(c.enumValues ? { enumValues: c.enumValues } : {}),
+      ...(c.entity ? { entity: c.entity } : {}),
+      ...(c.valueGroups ? { valueGroups: c.valueGroups } : {}),
     }),
   );
-  return { families: [...families, ...UNSUPPORTED_FAMILIES], columns };
+  return { families: [...families, ...UNSUPPORTED_FAMILIES], columns, ...(schema.rowNoun ? { rowNoun: schema.rowNoun } : {}) };
 };
 
 export const buildResolutionRequest = (
@@ -163,7 +182,9 @@ export const buildResolutionRequest = (
   clauses: input.clauses.map((clause) => {
     const own = mentions
       .filter((m) => m.clauseIndex === clause.index)
-      .map(({ columnId, valueId }) => (valueId === undefined ? { columnId } : { columnId, valueId }));
+      .map(({ columnId, valueId, ambiguous, text }) =>
+        valueId !== undefined ? { columnId, valueId } : ambiguous ? { columnId, ambiguous, ...(text ? { text } : {}) } : { columnId },
+      );
     return own.length > 0 ? { ...clause, mentions: own } : clause;
   }),
   candidates: buildCandidates(schema, capabilities),
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter gridcue exec tsc --noEmit -p .
```

- [ ] **Step 4: Commit**

```bash
git add packages/gridcue/src/core/protocol.ts packages/gridcue/src/core/schema.ts packages/gridcue/src/core/resolution.ts
git commit -m "feat(core): rowNoun, entity, and valueGroups declarations (ADR 0015)"
```

### Task 2: Mentions: value groups, excluded values, ambiguous and ranked nouns

**Files:**
- Modify `packages/gridcue/src/core/mentions.ts`
- Modify `packages/gridcue/test/mentions.test.ts`

- [ ] **Step 1: Write the failing tests**

```diff
diff --git a/packages/gridcue/test/mentions.test.ts b/packages/gridcue/test/mentions.test.ts
index be92756..768019b 100644
--- a/packages/gridcue/test/mentions.test.ts
+++ b/packages/gridcue/test/mentions.test.ts
@@ -132,3 +132,62 @@ describe("matchMentions superlatives", () => {
     expect(found("sort by the largest cost")).toEqual([]);
   });
 });
+
+describe("chassis declarations in Mentions (ADR 0015)", () => {
+  const domain = defineSchema(
+    [
+      { id: "number", label: "Item number", kind: "string" },
+      { id: "owner", label: "Owner", kind: "string" },
+      { id: "state", label: "State", kind: "enum" },
+      { id: "price", label: "Price", kind: "currency" },
+    ],
+    {
+      rowNoun: "item",
+      columns: {
+        number: { aliases: ["item"] },
+        owner: { aliases: ["seller"], entity: "owner" },
+        state: {
+          enumValues: [
+            { id: "open", label: "Open" },
+            { id: "held", label: "Held" },
+            { id: "sold", label: "Sold" },
+          ],
+          valueGroups: [{ label: "Active", values: ["open", "held"] }],
+        },
+      },
+    },
+  );
+  const cols = domain.columns.filter(isExposed);
+  const match = (text: string) => matchMentions(normalize(text).clauses, cols, { rowNoun: domain.rowNoun });
+
+  it("expands a value group into one Mention per value", () => {
+    expect(match("only active ones").map((m) => m.valueId)).toEqual(["open", "held"]);
+  });
+
+  it("marks an excluded value as negated", () => {
+    expect(match("non-active items").map((m) => [m.valueId, m.negated])).toEqual([
+      ["open", true],
+      ["held", true],
+    ]);
+    expect(match("everything except sold")[0]).toMatchObject({ valueId: "sold", negated: true });
+  });
+
+  it("flags a row noun grammar can't place, and never one in a column slot", () => {
+    expect(match("show the item")[0]).toMatchObject({ columnId: "number", ambiguous: true, text: "item" });
+    expect(match("sort by item")[0]).not.toHaveProperty("ambiguous");
+  });
+
+  it("reads a text-valued entity ranked by size as the records, by any of its names", () => {
+    expect(match("largest owners first")[0]).toMatchObject({ columnId: "owner", ambiguous: true, records: true });
+    expect(match("top sellers first")[0]).toMatchObject({ columnId: "owner", records: true });
+    expect(match("largest items first")).toEqual([]);
+  });
+
+  it("rejects a value group that names a value the column doesn't have", () => {
+    expect(() =>
+      defineSchema([{ id: "state", kind: "enum" }], {
+        columns: { state: { enumValues: [{ id: "open", label: "Open" }], valueGroups: [{ label: "Active", values: ["open", "gone"] }] } },
+      }),
+    ).toThrow(/valueGroups on state name values that are not in its enumValues: gone/);
+  });
+});
```

- [ ] **Step 2: Implement**

```diff
diff --git a/packages/gridcue/src/core/mentions.ts b/packages/gridcue/src/core/mentions.ts
index 297a037..a70fbc0 100644
--- a/packages/gridcue/src/core/mentions.ts
+++ b/packages/gridcue/src/core/mentions.ts
@@ -18,6 +18,20 @@ export interface Mention {
   columnId: string;
   /** Set when the text named an enum value, such as "roth". Its column is implied. */
   valueId?: string;
+  /**
+   * A row or entity noun that grammar couldn't place, such as "households" in "largest households first": it may mean
+   * the column or the records (ADR 0015). The provider may be asked which.
+   */
+  ambiguous?: true;
+  /** The words as written. Set on ambiguous Mentions. */
+  text?: string;
+  /** The value was excluded, not chosen: "non-retirement", "excluding trusts". The compiler filters to the others. */
+  negated?: true;
+  /**
+   * Another entity ranked by size ("largest households first") whose column can't hold a size, such as the text
+   * Household: it can only mean the records. Code reads that from the column's kind, like the amount rule (ADR 0015).
+   */
+  records?: true;
   start: number;
   end: number;
 }
@@ -29,6 +43,8 @@ export interface MentionColumn {
   kind: ColumnKind;
   aliases?: readonly string[] | undefined;
   enumValues?: readonly EnumValue[] | undefined;
+  entity?: string | undefined;
+  valueGroups?: ReadonlyArray<{ label: string; aliases?: readonly string[] | undefined; values: readonly string[] }> | undefined;
 }
 
 // A column name "where the rows go" names the rows, not the column (ADR 0013): "Roth accounts",
@@ -60,38 +76,61 @@ const unambiguous = <T>(entries: Array<{ item: T; key: string; names: string[] }
   return entries.map((e) => ({ item: e.item, names: e.names.filter((n) => owners.get(nameKey(n))?.size === 1) }));
 };
 
-const inRowPosition = (clause: Clause, hit: TextMatch<MentionColumn>, others: ReadonlyArray<TextMatch<unknown>>): boolean => {
+/** Where grammar puts a column-name match: a column slot, the rows, or undecided. */
+const placement = (
+  clause: Clause,
+  hit: TextMatch<MentionColumn>,
+  others: ReadonlyArray<TextMatch<unknown>>,
+): "column" | "rows" | "ranked" | undefined => {
   const before = clause.text.slice(0, hit.start);
   const after = clause.text.slice(hit.end);
-  if (COLUMN_SLOT_BEFORE.test(before) || COLUMN_WORD_AFTER.test(after)) return false;
-  if (others.some((o) => o !== hit && o.end <= hit.start && /^\s*$/.test(clause.text.slice(o.end, hit.start)))) return true;
-  if (QUALIFIER_AFTER.test(after) || BY_AFTER.test(after)) return true;
+  if (COLUMN_SLOT_BEFORE.test(before) || COLUMN_WORD_AFTER.test(after)) return "column";
+  if (others.some((o) => o !== hit && o.end <= hit.start && /^\s*$/.test(clause.text.slice(o.end, hit.start)))) return "rows";
+  if (QUALIFIER_AFTER.test(after) || BY_AFTER.test(after)) return "rows";
   // A yes/no column can't be ranked, so "the most restricted accounts" still names Restricted holdings.
-  if (SUPERLATIVE_BEFORE.test(before) && hit.item.kind !== "boolean") return true;
+  // Ranked by a superlative. For the grid's own row noun that is the rows; for another entity it may be the records.
+  if (SUPERLATIVE_BEFORE.test(before) && hit.item.kind !== "boolean") return "ranked";
   if (COMPARISON_AFTER.test(after)) {
     // With an amount after it, the kind decides: "value over $1M" is a column, "accounts over $1M" the rows.
     // With none, the word is a preposition: "accounts under each advisor".
     const literal = clause.literals.filter((l) => l.at >= hit.end).sort((a, b) => a.at - b.at)[0];
-    if (!literal) return true;
-    return literal.kind !== "unreadable" && !LITERAL_COLUMN_KINDS[literal.kind].includes(hit.item.kind);
+    if (!literal) return "rows";
+    return literal.kind !== "unreadable" && !LITERAL_COLUMN_KINDS[literal.kind].includes(hit.item.kind) ? "rows" : undefined;
   }
-  return false;
+  return undefined;
 };
 
+/** "households" and "household" name the same noun. */
+const singular = (words: string) => nameKey(words).replace(/(?:es|s)$/, "");
+/** A value named after one of these is excluded, not chosen: "non-retirement", "excluding trusts". Left to the provider. */
+const NEGATED_BEFORE = /\b(?:non|not|no|excluding|except|without)(?:\s+(?:at|in|from|with))?[\s-]*$/;
+
 /**
  * Finds the columns and enum values each Clause names by a Host-declared label or alias. Deterministic,
  * so these never depend on a provider's score. Pass exposed columns only: Mentions are sent to the provider.
  */
-export const matchMentions = (clauses: readonly Clause[], columns: readonly MentionColumn[]): Mention[] => {
+export const matchMentions = (
+  clauses: readonly Clause[],
+  columns: readonly MentionColumn[],
+  options: { rowNoun?: string | undefined } = {},
+): Mention[] => {
+  // A value group ("retirement") names several values of one column, so it yields one Mention per value (ADR 0015).
   const valueEntries = unambiguous(
-    columns.flatMap((c) =>
-      (c.enumValues ?? []).map((v) => ({
-        item: { columnId: c.id, valueId: v.id },
+    columns.flatMap((c) => [
+      ...(c.enumValues ?? []).map((v) => ({
+        item: { columnId: c.id, valueIds: [v.id] },
         key: `${c.id}\u0000${v.id}`,
         names: [v.label, ...(v.aliases ?? [])],
       })),
-    ),
+      ...(c.valueGroups ?? []).map((g) => ({
+        item: { columnId: c.id, valueIds: [...g.values] },
+        key: `${c.id}\u0000group\u0000${g.label}`,
+        names: [g.label, ...(g.aliases ?? [])],
+      })),
+    ]),
   );
+  // A row noun or entity word that grammar leaves undecided may mean the column or the records.
+  const nouns = (col: MentionColumn) => [options.rowNoun, col.entity].filter((n): n is string => !!n).map(singular);
   const columnEntries = unambiguous(columns.map((c) => ({ item: c, key: c.id, names: [c.label, ...(c.aliases ?? [])] })));
   return clauses.flatMap((clause) => {
     // Values first, masked out, so "Roth IRA" is not also read as a column name.
@@ -100,10 +139,41 @@ export const matchMentions = (clauses: readonly Clause[], columns: readonly Ment
     const cols = findMentions(masked, columnEntries);
     const all: TextMatch<unknown>[] = [...values, ...cols];
     return [
-      ...values.map((h) => ({ clauseIndex: clause.index, columnId: h.item.columnId, valueId: h.item.valueId, start: h.start, end: h.end })),
-      ...cols
-        .filter((h) => !inRowPosition(clause, h, all))
-        .map((h) => ({ clauseIndex: clause.index, columnId: h.item.id, start: h.start, end: h.end })),
+      ...values.flatMap((h) => {
+        const negated = NEGATED_BEFORE.test(clause.text.slice(0, h.start));
+        return h.item.valueIds.map((valueId) => ({
+          clauseIndex: clause.index,
+          columnId: h.item.columnId,
+          valueId,
+          start: h.start,
+          end: h.end,
+          ...(negated ? { negated: true as const } : {}),
+        }));
+      }),
+      ...cols.flatMap((h): Mention[] => {
+        const place = placement(clause, h, all);
+        const text = clause.text.slice(h.start, h.end);
+        const isRowNoun = !!options.rowNoun && singular(text) === singular(options.rowNoun);
+        // Any name of a column that declares an entity names that entity: "reps" for Advisor.
+        const isEntity = !!h.item.entity;
+        // "largest households first" ranks another entity: the column's values or the households as records.
+        const rankedEntity = place === "ranked" && isEntity && !isRowNoun;
+        if (place === "rows" || (place === "ranked" && !rankedEntity)) return [];
+        const ambiguous = rankedEntity || (place === undefined && nouns(h.item).includes(singular(text)));
+        const sized = ["number", "currency", "percent", "date", "datetime"].includes(h.item.kind);
+        if (rankedEntity && !sized) {
+          return [{ clauseIndex: clause.index, columnId: h.item.id, start: h.start, end: h.end, ambiguous: true, text, records: true }];
+        }
+        return [
+          {
+            clauseIndex: clause.index,
+            columnId: h.item.id,
+            start: h.start,
+            end: h.end,
+            ...(ambiguous ? { ambiguous: true as const, text } : {}),
+          },
+        ];
+      }),
     ].sort((a, b) => a.start - b.start);
   });
 };
```

- [ ] **Step 3: Run**

```bash
pnpm --filter gridcue exec vitest run test/mentions.test.ts
# Expected: 18 passed
```

- [ ] **Step 4: Commit**

```bash
git add packages/gridcue/src/core/mentions.ts packages/gridcue/test/mentions.test.ts
git commit -m "feat(core): value groups, excluded values, and ranked entity nouns in Mentions"
```

### Task 3: Compiler: readings, prepositions, per-value checks, excluded values

**Files:**
- Modify `packages/gridcue/src/core/compile.ts`
- Modify `packages/gridcue/test/compile.test.ts`
- Modify `packages/gridcue/src/core/controller.ts`

- [ ] **Step 1: Write the failing tests**

```diff
diff --git a/packages/gridcue/test/compile.test.ts b/packages/gridcue/test/compile.test.ts
index 3015dd3..72241cf 100644
--- a/packages/gridcue/test/compile.test.ts
+++ b/packages/gridcue/test/compile.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from "vitest";
 import { compile, settleFamilies } from "../src/core/compile";
-import { matchMentions } from "../src/core/mentions";
+import { type Mention, matchMentions } from "../src/core/mentions";
 import { normalize } from "../src/core/normalize";
 import { renderPreview, toAuditEvent } from "../src/core/preview";
 import { emptyViewState } from "../src/core/protocol";
@@ -342,10 +342,10 @@ describe("Mentions", () => {
   });
 
   it("never silently ignores a named value in a part that doesn't filter", () => {
-    const plan = run("group by name for closed ones", [{ families: [hi("group")], columns: [hi("name")] }], undefined, true);
+    const plan = run("group by name, closed ones please", [{ families: [hi("group")], columns: [hi("name")] }], undefined, true);
     expect(plan.status).toBe("needs_clarification");
     expect(plan.clarifications[0]?.prompt).toBe(
-      "“group by name for closed ones” also names Closed. Split it into separate parts, such as “only Closed” and the rest.",
+      "“group by name, closed ones please” also names Closed. Split it into separate parts, such as “only Closed” and the rest.",
     );
   });
 
@@ -556,3 +556,92 @@ describe("fan-out signals", () => {
     expect(plan.evidence).toContainEqual({ key: "c0.only-reading", selectedId: "filter", confidence: 1, source: "deterministic" });
   });
 });
+
+describe("chassis compiler rules (ADR 0015)", () => {
+  const mention = (m: Partial<Mention> & { columnId: string }): Mention => ({ clauseIndex: 0, start: 0, end: 0, ...m });
+  const compileWith = (text: string, clause: Partial<ClauseResolution>, mentions: Mention[], answers?: Record<string, string>) =>
+    compile({
+      input: normalize(text),
+      resolution: { clauses: [{ clauseIndex: 0, families: [], columns: [], values: [], unmatchedTerms: [], ...clause }] },
+      schema: entitySchema,
+      state: emptyViewState(entitySchema.columns.map((c) => c.id)),
+      baseRevision: "r1",
+      channel: "typed",
+      mentions,
+      ...(answers ? { answers } : {}),
+      newId: (p) => `${p}_${++n}`,
+    });
+  const entitySchema = defineSchema(
+    [
+      { id: "name", kind: "string" },
+      { id: "value", kind: "currency" },
+      { id: "status", kind: "enum" },
+    ],
+    {
+      columns: {
+        name: { label: "Household", entity: "household" },
+        status: {
+          enumValues: [
+            { id: "open", label: "Open" },
+            { id: "closed", label: "Closed" },
+            { id: "held", label: "Held" },
+          ],
+        },
+      },
+    },
+  );
+
+  it("filters on a value after the verb when it sits in a prepositional phrase", () => {
+    const plan = run("sort by value for closed ones", [{ families: [hi("sort")], columns: [hi("value")] }], undefined, true);
+    expect(plan.operations.map((o) => o.type)).toEqual(["filter.add", "sort.set"]);
+    expect(plan.evidence).toContainEqual({ key: "c0.preposition", selectedId: "filter", confidence: 1, source: "deterministic" });
+  });
+
+  it("filters on a value after the verb when the provider's per-value answer confirms it", () => {
+    const plan = run(
+      "sort by value, closed ones please",
+      [{ families: [hi("sort")], columns: [hi("value")], values: [{ columnId: "status", valueId: "closed", confidence: 0.9 }] }],
+      undefined,
+      true,
+    );
+    expect(plan.operations.map((o) => o.type)).toEqual(["filter.add", "sort.set"]);
+    expect(plan.evidence).toContainEqual({ key: "c0.values", selectedId: "filter", confidence: 0.9, source: "provider" });
+  });
+
+  it("filters to the other approved values when a value is excluded", () => {
+    const plan = compileWith("excluding closed", { families: [hi("filter")] }, [
+      mention({ columnId: "status", valueId: "closed", negated: true }),
+    ]);
+    expect(plan.operations).toMatchObject([{ predicate: { columnId: "status", operator: "in", value: ["open", "held"] } }]);
+  });
+
+  it("asks when an entity noun means the records, and groups when the User says so", () => {
+    const households = mention({ columnId: "name", ambiguous: true, text: "households", records: true });
+    const asked = compileWith("largest households first", { families: [hi("sort")] }, [households]);
+    expect(asked.clarifications[0]).toMatchObject({
+      id: "c0.reading.name",
+      prompt: "Did you mean households as a whole? GridCue can group by Household.",
+      options: [{ id: "group" }, { id: "column" }],
+    });
+    const grouped = compileWith("largest households first", { families: [hi("sort")] }, [households], { "c0.reading.name": "group" });
+    expect(grouped.operations).toEqual([{ type: "group.set", columnIds: ["name"] }]);
+    const column = compileWith("largest households first", { families: [hi("sort")] }, [households], { "c0.reading.name": "column" });
+    expect(column.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "name", direction: "desc" }] }]);
+  });
+
+  it("drops an ambiguous noun the provider reads as the rows, and keeps one it reads as the column", () => {
+    const noun = mention({ columnId: "name", ambiguous: true, text: "household" });
+    const rows = compileWith(
+      "show the household",
+      { families: [hi("columns.show")], readings: [{ columnId: "name", reading: "rows", confidence: 0.9 }] },
+      [noun],
+    );
+    expect(rows.evidence).toContainEqual({ key: "dropped:c0.mention", selectedId: "name", confidence: 0.9, source: "provider" });
+    const col = compileWith(
+      "show the household",
+      { families: [hi("columns.show")], readings: [{ columnId: "name", reading: "column", confidence: 0.9 }] },
+      [noun],
+    );
+    expect(col.operations).toEqual([{ type: "columns.show", columnIds: ["name"] }]);
+  });
+});
```

- [ ] **Step 2: Implement**

```diff
diff --git a/packages/gridcue/src/core/compile.ts b/packages/gridcue/src/core/compile.ts
index 62a6e9c..ecb2686 100644
--- a/packages/gridcue/src/core/compile.ts
+++ b/packages/gridcue/src/core/compile.ts
@@ -107,8 +107,15 @@ export const FAN_OUT = {
   adds: 0.7,
   /** A reversal Noul at or above this puts the later-named column outside the earlier one. */
   outer: 0.7,
+  /** A per-value Noul at or above this confirms a named value limits the rows ("sort by gain, just the trusts"). */
+  values: 0.7,
+  /** A reading Choice at or above this decides what an ambiguous row or entity noun means (ADR 0015). */
+  reading: 0.6,
 } as const;
 
+/** A value named inside one of these phrases limits the rows, wherever it sits: "sort by gain for trusts". */
+const PREPOSITION_BEFORE = /\b(?:for|among|at|in|with|from|of|within)\s+(?:(?:the|all|only|just)\s+)?(?:[\p{L}-]+\s+)?$/u;
+
 /**
  * Decides between competing families (ADR 0012). `accepted` are at or above `ready` or confirmed by the User;
  * `middling` are view families between `clarify` and `ready`. `viable` says whether a family has something to act
@@ -209,13 +216,47 @@ export const compile = (c: CompileInput): ViewPlan => {
       const own = (c.mentions ?? []).filter((m) => m.clauseIndex === clause.index);
       const scored = new Map(res.columns.map((p) => [p.id, p.confidence]));
       const mentionedColumns: string[] = [];
+
+      // An ambiguous row or entity noun ("largest households first") takes the provider's reading, or the User's
+      // answer. "rows" drops the Mention; "records" asks rather than guessing, since GridCue can only group (ADR 0015).
+      const readAsRows = new Set<string>();
+      let groupAnswer: string | undefined;
+      let readingPending = false;
+      for (const m of own.filter((x) => x.ambiguous)) {
+        const col = column(m.columnId);
+        if (!col) continue;
+        const answerKey = `${key}.reading.${col.id}`;
+        const answer = answers[answerKey];
+        if (answer === "group") groupAnswer = col.id;
+        if (answer !== undefined) continue;
+        const reading = m.records
+          ? { columnId: col.id, reading: "records" as const, confidence: 1 }
+          : res.readings?.find((r) => r.columnId === col.id);
+        if (!reading || reading.confidence < FAN_OUT.reading) continue;
+        if (reading.reading === "rows") {
+          readAsRows.add(col.id);
+          evidence.push({ key: `dropped:${key}.mention`, selectedId: col.id, confidence: reading.confidence, source: "provider" });
+        } else if (reading.reading === "records" && col.entity) {
+          clarifications.push({
+            id: answerKey,
+            prompt: `Did you mean ${col.entity}s as a whole? GridCue can group by ${col.label}.`,
+            options: [
+              { id: "group", label: `Group by ${col.label}` },
+              { id: "column", label: `Use the ${col.label} column` },
+            ],
+            required: true,
+          });
+          readingPending = true;
+        }
+      }
+      if (readingPending) continue;
       // The provider's other answers can confirm a named column its column score doubts: "restricted accounts" scored
       // Restricted holdings 0.39 as a column but "true" 0.96 as a value in the same call.
       const supported = (id: string) =>
         res.values.some((v) => v.columnId === id && v.confidence >= bands.ready) ||
         (res.roles ?? []).some((r) => r.columnId === id && r.confidence >= FAN_OUT.role) ||
         (res.literalColumns ?? []).some((l) => l.columnId === id && l.confidence >= bands.ready);
-      for (const id of new Set(own.filter((m) => m.valueId === undefined).map((m) => m.columnId))) {
+      for (const id of new Set(own.filter((m) => m.valueId === undefined && !readAsRows.has(m.columnId)).map((m) => m.columnId))) {
         const score = scored.get(id);
         if (score !== undefined && score < MENTION_FLOOR && !supported(id)) {
           evidence.push({ key: `dropped:${key}.mention`, selectedId: id, confidence: score, source: "provider" });
@@ -223,8 +264,16 @@ export const compile = (c: CompileInput): ViewPlan => {
       }
       const mentionedValues = own.filter((m) => m.valueId !== undefined);
       const valueColumns = new Set(mentionedValues.map((m) => m.columnId));
+      // An excluded value ("non-retirement", "excluding trusts") filters to the column's other approved values.
+      const chosen = mentionedValues.filter((m) => !m.negated);
+      const excluded = mentionedValues.filter((m) => m.negated && !chosen.some((x) => x.columnId === m.columnId));
+      const others = [...new Set(excluded.map((m) => m.columnId))].flatMap((columnId) =>
+        (column(columnId)?.enumValues ?? [])
+          .filter((v) => !excluded.some((m) => m.columnId === columnId && m.valueId === v.id))
+          .map((v) => `${columnId}\u0000${v.id}`),
+      );
       const values = [
-        ...[...new Set(mentionedValues.map((m) => `${m.columnId}\u0000${m.valueId}`))].map((k) => {
+        ...[...new Set([...chosen.map((m) => `${m.columnId}\u0000${m.valueId}`), ...others])].map((k) => {
           const [columnId = "", valueId = ""] = k.split("\u0000");
           return { columnId, valueId, confidence: 1, mentioned: true };
         }),
@@ -345,12 +394,38 @@ export const compile = (c: CompileInput): ViewPlan => {
         accepted.push({ id: "filter", confidence: 1 });
         evidence.push({ key: `${key}.modifier`, selectedId: "filter", confidence: 1, source: "deterministic" });
       }
+      // After the verb, a named value limits the rows when it sits in a prepositional phrase ("for trusts"), or when
+      // the provider's per-value answer says so ("but just the trusts"). Otherwise it is still asked about below.
+      const confirmed = (m: Mention) =>
+        res.values.some((v) => v.columnId === m.columnId && v.valueId === m.valueId && v.confidence >= FAN_OUT.values);
+      const afterVerb = mentionedValues.filter((m) => !accepted.some((f) => f.id === "filter"));
+      if (afterVerb.length > 0 && otherChanges.length > 0) {
+        const byPreposition = afterVerb.every((m) => PREPOSITION_BEFORE.test(clause.text.slice(0, m.start)));
+        if (byPreposition || afterVerb.every(confirmed)) {
+          accepted.push({ id: "filter", confidence: 1 });
+          evidence.push({
+            key: `${key}.${byPreposition ? "preposition" : "values"}`,
+            selectedId: "filter",
+            confidence: byPreposition
+              ? 1
+              : Math.min(...afterVerb.map((m) => res.values.find((v) => v.valueId === m.valueId)?.confidence ?? 0)),
+            source: byPreposition ? "deterministic" : "provider",
+          });
+        }
+      }
       // When nothing the provider suggests has anything to act on and the part names a value, filtering is the only
       // reading left: "show trusts".
       if (namedFilter && ![...accepted, ...middling].some((f) => isView(f.id) && viable(f.id))) {
         accepted.push({ id: "filter", confidence: 1 });
         evidence.push({ key: `${key}.only-reading`, selectedId: "filter", confidence: 1, source: "deterministic" });
       }
+      // The User chose "Group by Household" for an ambiguous noun: this part groups by that column only.
+      if (groupAnswer) {
+        for (const f of [...accepted])
+          if (isView(f.id) && COLUMN_FAMILIES[f.id as ViewFamily] && f.id !== "filter") accepted.splice(accepted.indexOf(f), 1);
+        accepted.push({ id: "group", confidence: 1 });
+        middling.length = 0;
+      }
       const settled = settleFamilies(accepted, middling, viable, { separable, kind: res.kind });
       const families = settled.kept;
       if (settled.byKind && res.kind)
@@ -376,10 +451,10 @@ export const compile = (c: CompileInput): ViewPlan => {
         unsupportedSegments.push({ text: clause.text, category: f.id.replace("unsupported.", "") as UnsupportedCategory });
       }
       // Canonical order within a part (Q6): filters first, then sorts, groups, and columns, as VIEW_FAMILIES lists them.
-      const viewFamilies = families
-        .filter((f) => isView(f.id))
-        .map((f) => f.id as ViewFamily)
-        .sort((a, b) => VIEW_FAMILIES.indexOf(a) - VIEW_FAMILIES.indexOf(b));
+      // A family can be added by a rule and promoted by the provider in the same part; it still runs once.
+      const viewFamilies = [...new Set(families.filter((f) => isView(f.id)).map((f) => f.id as ViewFamily))].sort(
+        (a, b) => VIEW_FAMILIES.indexOf(a) - VIEW_FAMILIES.indexOf(b),
+      );
       if (blocked.length > 0) continue;
       if (viewFamilies.length === 0) {
         if (!familyPending) {
```

- [ ] **Step 3: Pass the row noun to the matcher**

```diff
diff --git a/packages/gridcue/src/core/controller.ts b/packages/gridcue/src/core/controller.ts
index da377a9..df199bc 100644
--- a/packages/gridcue/src/core/controller.ts
+++ b/packages/gridcue/src/core/controller.ts
@@ -166,7 +166,8 @@ export const createGridCue = (options: GridCueOptions): GridCueController => {
       }
       const base = adapter.getState();
       const restricted = screenRestricted(input, schema);
-      const mentions = restricted.length === 0 ? matchMentions(input.clauses, schema.columns.filter(isExposed)) : [];
+      const mentions =
+        restricted.length === 0 ? matchMentions(input.clauses, schema.columns.filter(isExposed), { rowNoun: schema.rowNoun }) : [];
       try {
         let resolution: ResolutionResult = { clauses: [] };
         if (restricted.length === 0) {
```

- [ ] **Step 4: Run**

```bash
pnpm --filter gridcue exec vitest run test/compile.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/gridcue/src/core/compile.ts packages/gridcue/src/core/controller.ts packages/gridcue/test/compile.test.ts
git commit -m "feat(core): read ambiguous nouns, prepositions, and excluded values (ADR 0015)"
```

### Task 4: Jev strategies, signals, per-value Nouls, and the reading Choice

**Files:**
- Modify `packages/gridcue/src/server/jev.ts`
- Modify `packages/gridcue/src/server/index.ts`
- Modify `packages/gridcue/test/jev.test.ts`

- [ ] **Step 1: Write the failing tests**

```diff
diff --git a/packages/gridcue/test/jev.test.ts b/packages/gridcue/test/jev.test.ts
index 744d5e4..4cae726 100644
--- a/packages/gridcue/test/jev.test.ts
+++ b/packages/gridcue/test/jev.test.ts
@@ -11,7 +11,7 @@ const caps = { operations: ["filter.add", "sort.set"], supportsAtomicApply: true
 const request = buildResolutionRequest(normalize("open accounts over $1m"), schema, caps, emptyViewState(["value", "status", "tax_id"]));
 
 /** The question keys this provider asks as Choices; every other key is a Noul. */
-const isChoice = (k: string) => /_(?:val|bool)\d+$|_dir$|_lit\d+$|_kind$/.test(k);
+const isChoice = (k: string) => /_(?:val|bool)\d+$|_dir$|_lit\d+$|_kind$|_reading\d+$/.test(k);
 
 type Seen = { questions?: Record<string, unknown>; state?: unknown; model?: string };
 const fakeClient = (answer: (name: string) => unknown, seen: Seen = {}): JevClient => ({
@@ -27,6 +27,7 @@ describe("createJevProvider", () => {
   it("asks closed questions and maps answers to candidate IDs", async () => {
     const seen: Seen = {};
     const provider = createJevProvider({
+      strategy: "focused",
       client: fakeClient((k) => {
         if (k === "c0_f0") return { noul: 0.93 }; // filter
         if (k.endsWith("_col0")) return { noul: 0.91 }; // value
@@ -58,6 +59,7 @@ describe("createJevProvider", () => {
 
   it("treats a missing answer as malformed", async () => {
     const provider = createJevProvider({
+      strategy: "focused",
       client: fakeClient((k) =>
         k === "c0_val1" ? undefined : isChoice(k) ? { choice: "none", probabilities: { none: 0.9 } } : { noul: 0.1 },
       ),
@@ -178,6 +180,67 @@ describe("createJevProvider", () => {
     expect(await keysFor("sort by market value and status")).toEqual([]);
   });
 
+  it("asks one yes/no per enum value when the values signal is on, so several values can come back", async () => {
+    const seen: Seen = {};
+    const provider = createJevProvider({
+      signals: { values: true },
+      client: fakeClient(
+        (k) => (k === "c0_is1_0" ? { noul: 0.93 } : isChoice(k) ? { choice: "none", probabilities: { none: 1 } } : { noul: 0.05 }),
+        seen,
+      ),
+    });
+    const [clause] = (await provider.resolve(request)).clauses;
+    expect(Object.keys(seen.questions ?? {})).toContain("c0_is1_0");
+    expect(Object.keys(seen.questions ?? {})).not.toContain("c0_val1");
+    expect(clause?.values).toContainEqual({ columnId: "status", valueId: "open", confidence: 0.93 });
+  });
+
+  it("asks the focused strategy's questions only, and rejects unknown strategies and signals", async () => {
+    const seen: Seen = {};
+    const answer = (k: string) => (isChoice(k) ? { choice: "none", probabilities: { none: 1 } } : { noul: 0 });
+    await createJevProvider({ strategy: "focused", client: fakeClient(answer, seen) }).resolve(request);
+    const keys = Object.keys(seen.questions ?? {});
+    expect(keys.some((k) => /_role|_kind|_adds|_is\d|_reading|_outer/.test(k))).toBe(false);
+    expect(keys).toContain("c0_val1");
+    const onlyKind: Seen = {};
+    await createJevProvider({ strategy: "focused", signals: { kind: true }, client: fakeClient(answer, onlyKind) }).resolve(request);
+    expect(Object.keys(onlyKind.questions ?? {})).toContain("c0_kind");
+    expect(() => createJevProvider({ strategy: "everything" as never })).toThrow(/Unknown strategy/);
+    expect(() => createJevProvider({ signals: { magic: true } as never })).toThrow(/Unknown signal/);
+  });
+
+  it("asks what an ambiguous row or entity noun means, with only the readings that apply", async () => {
+    const entitySchema = defineSchema(
+      [
+        { id: "house", label: "Household", kind: "string" },
+        { id: "value", label: "Market value", kind: "currency" },
+      ],
+      {
+        rowNoun: "account",
+        columns: { house: { entity: "household" } },
+      },
+    );
+    const input = normalize("largest households first");
+    const mentions = [{ clauseIndex: 0, columnId: "house", start: 8, end: 18, ambiguous: true as const, text: "households" }];
+    const req = buildResolutionRequest(input, entitySchema, caps, emptyViewState(["house", "value"]), mentions);
+    const seen: Seen = {};
+    const provider = createJevProvider({
+      client: fakeClient(
+        (k) =>
+          k === "c0_reading0"
+            ? { choice: "records", probabilities: { column: 0.1, records: 0.9 } }
+            : isChoice(k)
+              ? { choice: "none", probabilities: { none: 1 } }
+              : { noul: 0.05 },
+        seen,
+      ),
+    });
+    const [clause] = (await provider.resolve(req)).clauses;
+    expect(JSON.stringify(seen.questions?.c0_reading0)).toContain("households as whole records");
+    expect(JSON.stringify(seen.questions?.c0_reading0)).not.toContain("rows of this grid");
+    expect(clause?.readings).toEqual([{ columnId: "house", reading: "records", confidence: 0.9 }]);
+  });
+
   it("wraps transport errors", async () => {
     const provider = createJevProvider({
       client: {
```

- [ ] **Step 2: Implement**

```diff
diff --git a/packages/gridcue/src/server/jev.ts b/packages/gridcue/src/server/jev.ts
index 65b8c53..4db9c3a 100644
--- a/packages/gridcue/src/server/jev.ts
+++ b/packages/gridcue/src/server/jev.ts
@@ -27,8 +27,25 @@ export interface JevProviderOptions {
    * request. Twelve Clauses on a nine-column schema need about 790. Measure cost and latency with `pnpm eval:live`.
    */
   maxQuestions?: number;
+  /**
+   * Which questions to ask (ADR 0015). "fan-out", the default, asks every signal except the opt-in `values`.
+   * "focused" asks only the first version's questions: fewer tokens, for grids whose requests are simple.
+   */
+  strategy?: JevStrategy;
+  /** Turns individual signals on or off on top of the strategy, e.g. `{ values: false }` for very large enums. */
+  signals?: Partial<Record<JevSignal, boolean>>;
 }
 
+/** The optional questions a strategy can ask. Each has its own evidence in ADRs 0014 and 0015. */
+export const JEV_SIGNALS = ["roles", "kind", "adds", "outer", "values", "reading"] as const;
+export type JevSignal = (typeof JEV_SIGNALS)[number];
+export type JevStrategy = "focused" | "fan-out";
+export const JEV_STRATEGIES: Readonly<Record<JevStrategy, readonly JevSignal[]>> = {
+  focused: [],
+  // `values` is opt-in: in the ADR 0015 ablation it decided one case, below its bar of three.
+  "fan-out": ["roles", "kind", "adds", "outer", "reading"],
+};
+
 export const DEFAULT_JEV_MODEL = "jev-1.13.0";
 
 const FAMILY_TEXT: Record<string, string> = {
@@ -60,6 +77,17 @@ const ROLE_TEXT: Record<string, string> = {
 
 /** Jev resolves bounded yes/no and choice questions. It never sees rows or restricted columns. */
 export const createJevProvider = (options: JevProviderOptions): IntentProvider => {
+  // Check the configuration before building a client, so a bad strategy fails even without a key.
+  const strategy = options.strategy ?? "fan-out";
+  if (!(strategy in JEV_STRATEGIES)) throw new GridCueError("INPUT_CONFIG", `Unknown strategy "${strategy}". Use focused or fan-out.`);
+  const on = new Set<string>(JEV_STRATEGIES[strategy]);
+  for (const [signal, enabled] of Object.entries(options.signals ?? {})) {
+    if (!(JEV_SIGNALS as readonly string[]).includes(signal)) {
+      throw new GridCueError("INPUT_CONFIG", `Unknown signal "${signal}". Use ${JEV_SIGNALS.join(", ")}.`);
+    }
+    if (enabled) on.add(signal);
+    else on.delete(signal);
+  }
   // `logLevel` otherwise falls back to `TYPESAFE_LOG_LEVEL`; at `debug` the SDK logs full request and response
   // bodies (the Utterance, column labels, aliases, descriptions). Set it explicitly so a Host's environment
   // can't turn that on by accident. A Host that wants SDK logs can inject its own `client` instead.
@@ -87,7 +115,15 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
               `Does ${about} refer to the grid column \`columns[${i}]\` (“${c.label}”), by its label or an alias?`,
             );
           }
-          if (c.enumValues?.length && !valued.has(c.id)) {
+          if (c.enumValues?.length && on.has("values")) {
+            // One Noul per value, so several can be yes ("retirement accounts" = IRA and Roth IRA). For a named value,
+            // only that value is asked, to confirm it limits the rows ("sort by gain but just the trusts"). ADR 0015.
+            const named = new Set(clause.mentions?.filter((m) => m.columnId === c.id && m.valueId).map((m) => m.valueId));
+            c.enumValues.forEach((v, j) => {
+              if (named.size > 0 && !named.has(v.id)) return;
+              questions[`${q}_is${i}_${j}`] = noul(`Does ${about} mean rows whose \`columns[${i}]\` (“${c.label}”) is “${v.label}”?`);
+            });
+          } else if (c.enumValues?.length && !valued.has(c.id)) {
             questions[`${q}_val${i}`] = choice(
               `Which value of the column \`columns[${i}]\` (“${c.label}”) does ${about} mention, if any?`,
               {
@@ -109,7 +145,7 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
         });
         // Fan-out (spec 2026-09-24): asked for every part; the compiler reads only the answers that apply.
         columns.forEach((c, i) => {
-          if (valued.has(c.id)) return;
+          if (valued.has(c.id) || !on.has("roles")) return;
           Object.keys(ROLE_TEXT).forEach((family, r) => {
             if (!c.families.includes(family)) return;
             questions[`${q}_role${i}_${r}`] = noul(
@@ -117,15 +153,37 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
             );
           });
         });
-        questions[`${q}_kind`] = choice(`Which kind of change does ${about} mainly ask for?`, {
-          ...Object.fromEntries(families.map((f) => [f, FAMILY_TEXT[f] ?? f])),
-          none: "No change to the view, or it is unclear",
-        });
-        questions[`${q}_adds`] = noul(
-          `If ${about} sorts or groups the rows, does it add another level to the current \`view\` sort or grouping, rather than replace it?`,
-        );
+        if (on.has("kind")) {
+          questions[`${q}_kind`] = choice(`Which kind of change does ${about} mainly ask for?`, {
+            ...Object.fromEntries(families.map((f) => [f, FAMILY_TEXT[f] ?? f])),
+            none: "No change to the view, or it is unclear",
+          });
+        }
+        if (on.has("adds")) {
+          questions[`${q}_adds`] = noul(
+            `If ${about} sorts or groups the rows, does it add another level to the current \`view\` sort or grouping, rather than replace it?`,
+          );
+        }
+        // An ambiguous row or entity noun: the column's values, the other records, or this grid's rows (ADR 0015).
+        if (on.has("reading")) {
+          for (const m of clause.mentions ?? []) {
+            const i = columns.findIndex((c) => c.id === m.columnId);
+            const c = columns[i];
+            if (!m.ambiguous || !c) continue;
+            const noun = (m.text ?? c.label).toLowerCase();
+            const rowNoun = request.candidates.rowNoun;
+            const isRowNoun = !!rowNoun && noun.replace(/(?:es|s)$/, "") === rowNoun.toLowerCase();
+            const options = {
+              column: `The values in the grid column \`columns[${i}]\` (“${c.label}”)`,
+              ...(c.entity ? { records: `${c.entity}s as whole records, each summing up several rows` } : {}),
+              ...(isRowNoun ? { rows: `The rows of this grid themselves (each row is one ${rowNoun})` } : {}),
+            };
+            if (Object.keys(options).length > 1)
+              questions[`${q}_reading${i}`] = choice(`In ${about}, what does “${noun}” refer to?`, options);
+          }
+        }
         const named = [...new Set(clause.mentions?.filter((m) => m.valueId === undefined).map((m) => m.columnId))];
-        if (REVERSAL_WORDING.test(clause.text) && named.length > 1) {
+        if (on.has("outer") && REVERSAL_WORDING.test(clause.text) && named.length > 1) {
           for (const a of named) {
             for (const b of named) {
               if (a === b) continue;
@@ -226,6 +284,17 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
             const allowed = c.enumValues ? ["none", ...c.enumValues.map((e) => e.id)] : ["none", "true", "false"];
             const v = key && key in questions ? pickOf(key, allowed) : undefined;
             if (v) values.push({ columnId: c.id, valueId: v.id, confidence: v.confidence });
+            c.enumValues?.forEach((e, j) => {
+              const noulKey = `${q}_is${i}_${j}`;
+              if (noulKey in questions) values.push({ columnId: c.id, valueId: e.id, confidence: yes(noulKey) });
+            });
+          });
+          const readings: NonNullable<ClauseResolution["readings"]> = [];
+          columns.forEach((c, i) => {
+            const readingKey = `${q}_reading${i}`;
+            if (!(readingKey in questions)) return;
+            const pick = pickOf(readingKey, ["column", "records", "rows"]);
+            if (pick) readings.push({ columnId: c.id, reading: pick.id as "column" | "records" | "rows", confidence: pick.confidence });
           });
           const direction = clause.direction ? undefined : pickOf(`${q}_dir`, ["none", "asc", "desc"]);
           const literalColumns: NonNullable<ClauseResolution["literalColumns"]> = [];
@@ -242,7 +311,7 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
               if (key in questions) roles.push({ columnId: c.id, family, confidence: yes(key) });
             });
           });
-          const kind = pickOf(`${q}_kind`, [...families, "none"]);
+          const kind = `${q}_kind` in questions ? pickOf(`${q}_kind`, [...families, "none"]) : undefined;
           const outer: NonNullable<ClauseResolution["outer"]> = [];
           for (const key of Object.keys(questions)) {
             const m = key.match(/^c(\d+)_outer(\d+)_(\d+)$/);
@@ -253,9 +322,10 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
           return {
             clauseIndex: clause.index,
             families: fam,
-            roles,
+            ...(roles.length > 0 ? { roles } : {}),
             ...(kind ? { kind } : {}),
-            adds: yes(`${q}_adds`),
+            ...(`${q}_adds` in questions ? { adds: yes(`${q}_adds`) } : {}),
+            ...(readings.length > 0 ? { readings } : {}),
             ...(outer.length > 0 ? { outer } : {}),
             columns: mentions.map((m) => ({ id: m.c.id, confidence: m.p })),
             values,
```

- [ ] **Step 3: Export the strategy types**

```diff
diff --git a/packages/gridcue/src/server/index.ts b/packages/gridcue/src/server/index.ts
index 7159153..6593137 100644
--- a/packages/gridcue/src/server/index.ts
+++ b/packages/gridcue/src/server/index.ts
@@ -1,3 +1,12 @@
 export { createGridCueHandler, type GridCueHandler, type HandlerOptions } from "./handler";
-export { createJevProvider, type JevClient, type JevProviderOptions } from "./jev";
+export {
+  createJevProvider,
+  DEFAULT_JEV_MODEL,
+  JEV_SIGNALS,
+  JEV_STRATEGIES,
+  type JevClient,
+  type JevProviderOptions,
+  type JevSignal,
+  type JevStrategy,
+} from "./jev";
 export { toNodeHandler } from "./node";
```

- [ ] **Step 4: Run**

```bash
pnpm --filter gridcue exec vitest run test/jev.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/gridcue/src/server packages/gridcue/test/jev.test.ts
git commit -m "feat(server): Jev strategies (focused, fan-out) with signal toggles"
```

### Task 5: Mock Provider and the wealth fixture

**Files:**
- Modify `packages/gridcue/src/mock/index.ts`
- Modify `fixtures/wealth/src/index.ts`

- [ ] **Step 1: Pass the row noun to the Mock's matcher**

```diff
diff --git a/packages/gridcue/src/mock/index.ts b/packages/gridcue/src/mock/index.ts
index d6ee2e4..fba349f 100644
--- a/packages/gridcue/src/mock/index.ts
+++ b/packages/gridcue/src/mock/index.ts
@@ -60,7 +60,7 @@ export const createMockProvider = (options: MockProviderOptions = {}): IntentPro
         if (unsupported) return { ...empty, families: [pick(unsupported[1], 0.95)] };
 
         // The Mock reads names with core's deterministic matcher, context rules included (ADR 0013).
-        const mentions = matchMentions([clause], columns);
+        const mentions = matchMentions([clause], columns, { rowNoun: request.candidates.rowNoun });
         const byId = new Map(columns.map((c) => [c.id, c]));
         const valueHits = mentions.filter((m) => m.valueId !== undefined);
         const columnHits = mentions.filter((m) => m.valueId === undefined);
```

- [ ] **Step 2: Declare the wealth domain**

```diff
diff --git a/fixtures/wealth/src/index.ts b/fixtures/wealth/src/index.ts
index 19bc165..56d96ce 100644
--- a/fixtures/wealth/src/index.ts
+++ b/fixtures/wealth/src/index.ts
@@ -36,9 +36,12 @@ export const wealthSchemaOptions: SchemaOptions = {
   id: "wealth-accounts",
   version: "1",
   restricted: ["tax_id"],
+  // The domain in three declarations (ADR 0015): what a row is, which columns name other records, and the Host's categories.
+  rowNoun: "account",
   columns: {
     account_number: { aliases: ["account", "account #", "acct"] },
-    advisor_name: { aliases: ["advisor", "rep", "financial advisor"] },
+    household: { entity: "household" },
+    advisor_name: { aliases: ["advisor", "rep", "financial advisor"], entity: "advisor" },
     registration_type: {
       aliases: ["registration", "account type", "tax status"],
       enumValues: [
@@ -47,6 +50,7 @@ export const wealthSchemaOptions: SchemaOptions = {
         { id: "roth_ira", label: "Roth IRA", aliases: ["roth"] },
         { id: "trust", label: "Trust" },
       ],
+      valueGroups: [{ label: "Retirement", aliases: ["retirement account"], values: ["ira", "roth_ira"] }],
     },
     custodian: {
       enumValues: [
```

- [ ] **Step 3: Run the package tests**

```bash
pnpm --filter gridcue exec vitest run
# Expected: 260 passed
```

- [ ] **Step 4: Commit**

```bash
git add packages/gridcue/src/mock/index.ts fixtures/wealth/src/index.ts
git commit -m "feat(fixtures): declare the wealth domain: row noun, entities, Retirement"
```

### Task 6: Evals: chassis cases, strategy flags, and the label change

**Files:**
- Create `evals/cases-chassis.jsonl`
- Modify `evals/cli.ts`
- Modify `evals/cases-live.jsonl`

- [ ] **Step 1: Add the 39 chassis cases. The first 23 were written before any code, and the last 16 before the refinements they tested**

```diff
diff --git a/evals/cases-chassis.jsonl b/evals/cases-chassis.jsonl
new file mode 100644
index 0000000..abce8a3
--- /dev/null
+++ b/evals/cases-chassis.jsonl
@@ -0,0 +1,39 @@
+{"id":"c-largest-households","utterance":"Largest households first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean households as a whole? GridCue can group by Household."}}
+{"id":"c-top-households","utterance":"Top households first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean households as a whole? GridCue can group by Household."}}
+{"id":"c-sort-household-control","utterance":"Sort by household.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"household","direction":"asc"}]}]}}
+{"id":"c-households-with-gain","utterance":"Households with a gain over $50k.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"unrealized_gain","operator":"gt","value":50000}}]}}
+{"id":"c-household-for-each-account","utterance":"Show the household for each account.","expect":{"status":"ready","operations":[{"type":"columns.show","columnIds":["household"]}]}}
+{"id":"c-accounts-by-number","utterance":"Sort accounts by account number.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"account_number","direction":"asc"}]}]}}
+{"id":"c-group-by-account","utterance":"Group by account.","expect":{"status":"ready","operations":[{"type":"group.set","columnIds":["account_number"]}]}}
+{"id":"c-biggest-advisors","utterance":"Biggest advisors first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean advisors as a whole? GridCue can group by Advisor."}}
+{"id":"v-gain-for-trusts","utterance":"Sort by gain for trusts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"trust"}},{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"asc"}]}]}}
+{"id":"v-group-for-iras","utterance":"Group by custodian for IRAs.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"ira"}},{"type":"group.set","columnIds":["custodian"]}]}}
+{"id":"v-among-roth","utterance":"Sort by balance among Roth accounts, largest first.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"roth_ira"}},{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"v-at-northgate","utterance":"Sort by concentration at Northgate.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"custodian","operator":"eq","value":"northgate"}},{"type":"sort.set","sorts":[{"columnId":"concentration","direction":"asc"}]}]}}
+{"id":"v-just-the-trusts","utterance":"Sort by gain but just the trusts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"trust"}},{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"asc"}]}]}}
+{"id":"v-limited-to","utterance":"Sort by gain limited to Harborline.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"custodian","operator":"eq","value":"harborline"}},{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"asc"}]}]}}
+{"id":"v-descending-control","utterance":"Sort by gain in descending order.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"desc"}]}]}}
+{"id":"v-for-each-control","utterance":"Sort by gain for each advisor.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"advisor_name","direction":"asc"},{"columnId":"unrealized_gain","direction":"asc"}]}]}}
+{"id":"m-retirement","utterance":"Show retirement accounts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"in","value":["ira","roth_ira"]}}]}}
+{"id":"m-retirement-grouped","utterance":"Retirement accounts grouped by advisor.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"in","value":["ira","roth_ira"]}},{"type":"group.set","columnIds":["advisor_name"]}]}}
+{"id":"m-iras-and-roths","utterance":"Only IRAs and Roths.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"in","value":["ira","roth_ira"]}}]}}
+{"id":"m-tax-advantaged","utterance":"Show me the tax-advantaged accounts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"in","value":["ira","roth_ira"]}}]}}
+{"id":"m-two-custodians","utterance":"Accounts at Northgate or Harborline.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"custodian","operator":"in","value":["northgate","harborline"]}}]}}
+{"id":"m-non-retirement","utterance":"Non-retirement accounts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"in","value":["taxable","trust"]}}]}}
+{"id":"m-single-control","utterance":"Only trusts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"trust"}}]}}
+{"id":"c2-smallest-households","utterance":"Smallest households first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean households as a whole? GridCue can group by Household."}}
+{"id":"c2-top-advisors","utterance":"Top advisors first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean advisors as a whole? GridCue can group by Advisor."}}
+{"id":"c2-households-at-control","utterance":"Households at Harborline.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"custodian","operator":"eq","value":"harborline"}}]}}
+{"id":"c2-largest-accounts-control","utterance":"Largest accounts first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"c2-biggest-households-northgate","utterance":"Biggest households at Northgate first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean households as a whole? GridCue can group by Household."}}
+{"id":"n-excluding-trusts","utterance":"Excluding trusts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"in","value":["taxable","ira","roth_ira"]}}]}}
+{"id":"n-except-northgate","utterance":"Everything except Northgate.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"custodian","operator":"in","value":["harborline","summit_trust"]}}]}}
+{"id":"n-non-taxable-sorted","utterance":"Non-taxable accounts sorted by gain.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"in","value":["ira","roth_ira","trust"]}},{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"asc"}]}]}}
+{"id":"n-not-at","utterance":"Accounts not at Summit Trust.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"custodian","operator":"in","value":["northgate","harborline"]}}]}}
+{"id":"c3-biggest-households","utterance":"Biggest households first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean households as a whole? GridCue can group by Household."}}
+{"id":"c3-smallest-advisors","utterance":"Smallest advisors first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean advisors as a whole? GridCue can group by Advisor."}}
+{"id":"c3-top-reps","utterance":"Top reps first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean advisors as a whole? GridCue can group by Advisor."}}
+{"id":"c3-largest-balances-control","utterance":"Largest balances first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"c3-household-desc-control","utterance":"Sort by household, descending.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"household","direction":"desc"}]}]}}
+{"id":"c3-largest-trust-accounts","utterance":"Largest trust accounts first.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"trust"}},{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"c3-most-concentrated-households","utterance":"Most concentrated households first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean households as a whole? GridCue can group by Household."}}
```

- [ ] **Step 2: Add `--strategy`, `--with` and `--without`, run the chassis cases live, and print readings**

```diff
diff --git a/evals/cli.ts b/evals/cli.ts
index b3dd29b..9653675 100644
--- a/evals/cli.ts
+++ b/evals/cli.ts
@@ -2,18 +2,23 @@ import { wealthMockOptions } from "@gridcue-internal/wealth-fixtures";
 import { TypeSafeClient } from "@typesafe-ai/sdk";
 import type { IntentProvider, ResolutionRequest, ResolutionResult } from "gridcue";
 import { createMockProvider } from "gridcue/mock";
-import { createJevProvider, type JevClient } from "gridcue/server";
+import { createJevProvider, JEV_SIGNALS, type JevClient, type JevSignal, type JevStrategy } from "gridcue/server";
 import { loadCases, runCase, type Verdict } from "./run";
 
 const live = process.argv.includes("--live");
 const verbose = process.argv.includes("--verbose");
-// `--without=kind,adds` drops those fan-out answers before the compiler sees them, to measure what each is worth.
-const without = new Set(
-  (process.argv.find((a) => a.startsWith("--without="))?.slice("--without=".length) ?? "").split(",").filter(Boolean),
-);
-const SIGNALS = ["roles", "kind", "adds", "outer"] as const;
-for (const s of without)
-  if (!(SIGNALS as readonly string[]).includes(s)) throw new Error(`Unknown signal "${s}". Use ${SIGNALS.join(", ")}.`);
+// `--strategy=focused|fan-out` picks the Jev strategy (ADR 0015). `--without=kind,adds` and `--with=values` switch
+// signals off or on top of it, so the value of each question can be measured.
+const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
+const strategy = (flag("strategy") ?? "fan-out") as JevStrategy;
+const listed = (name: string) => (flag(name) ?? "").split(",").filter(Boolean) as JevSignal[];
+const signals: Partial<Record<JevSignal, boolean>> = {
+  ...Object.fromEntries(listed("with").map((s) => [s, true])),
+  ...Object.fromEntries(listed("without").map((s) => [s, false])),
+};
+for (const s of Object.keys(signals))
+  if (!(JEV_SIGNALS as readonly string[]).includes(s)) throw new Error(`Unknown signal "${s}". Use ${JEV_SIGNALS.join(", ")}.`);
+const setup = [live ? strategy : "", ...Object.entries(signals).map(([s, v]) => `${v ? "+" : "-"}${s}`)].filter(Boolean).join(" ");
 if (live && !process.env.JEV_API_KEY) {
   console.log("Skipping live evals: JEV_API_KEY is not set.");
   process.exit(0);
@@ -32,16 +37,13 @@ const client: JevClient | undefined = live
       } satisfies JevClient;
     })()
   : undefined;
-const base: IntentProvider = live ? createJevProvider({ client }) : createMockProvider(wealthMockOptions);
+const base: IntentProvider = live ? createJevProvider({ client, strategy, signals }) : createMockProvider(wealthMockOptions);
 
 // Records what the provider saw and said, for --verbose.
 let seen: { request?: ResolutionRequest; result?: ResolutionResult } = {};
 const provider: IntentProvider = {
   async resolve(request, signal) {
-    const raw = await base.resolve(request, signal);
-    const result = {
-      clauses: raw.clauses.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !without.has(k))) as typeof c),
-    };
+    const result = await base.resolve(request, signal);
     seen = { request, result };
     return result;
   },
@@ -67,6 +69,7 @@ const describe = (ms: number) => {
       c.kind ? `kind ${c.kind.id} ${c.kind.confidence.toFixed(2)}` : "",
       c.adds !== undefined ? `adds ${c.adds.toFixed(2)}` : "",
       c.outer?.length ? `outer [${c.outer.map((o) => `${o.outerId}>${o.innerId} ${o.confidence.toFixed(2)}`).join(", ")}]` : "",
+      c.readings?.length ? `readings [${c.readings.map((r) => `${r.columnId}:${r.reading} ${r.confidence.toFixed(2)}`).join(", ")}]` : "",
     ].filter(Boolean);
     if (fan.length > 0) lines.push(`      ${fan.join("  ")}`);
     if (c.literalColumns?.length) {
@@ -94,7 +97,7 @@ const run = async (file: URL, label: string) => {
       console.log(`${verdict.toUpperCase()}: ${c.id}`);
     }
   }
-  console.log(`GridCue evals: ${label} (${live ? "Jev" : "Mock Provider"}${without.size ? `, without ${[...without].join(", ")}` : ""})`);
+  console.log(`GridCue evals: ${label} (${live ? "Jev" : "Mock Provider"}${setup ? `, ${setup}` : ""})`);
   console.table(counts);
   return counts;
 };
@@ -103,7 +106,9 @@ const core = await run(new URL("./cases.jsonl", import.meta.url), "cases.jsonl")
 // Live-only cases need common sense the Mock doesn't have. They are findings, with no pass bar, except that none may be unsafe.
 const extra = live ? await run(new URL("./cases-live.jsonl", import.meta.url), "cases-live.jsonl") : undefined;
 const fanout = live ? await run(new URL("./cases-fanout.jsonl", import.meta.url), "cases-fanout.jsonl") : undefined;
+const chassis = live ? await run(new URL("./cases-chassis.jsonl", import.meta.url), "cases-chassis.jsonl") : undefined;
 
 // Applying a view the user did not ask for is release-blocking with any provider.
 // With the Mock Provider every case must match exactly, because its answers are deterministic.
-if (core.unsafe > 0 || (extra?.unsafe ?? 0) > 0 || (fanout?.unsafe ?? 0) > 0 || (!live && core.mismatch > 0)) process.exit(1);
+if (core.unsafe > 0 || (extra?.unsafe ?? 0) > 0 || (fanout?.unsafe ?? 0) > 0 || (chassis?.unsafe ?? 0) > 0 || (!live && core.mismatch > 0))
+  process.exit(1);
```

- [ ] **Step 3: Relabel two cases per the owner's direction (ADR 0015, Evidence)**

```diff
diff --git a/evals/cases-live.jsonl b/evals/cases-live.jsonl
index 3e3c187..7641389 100644
--- a/evals/cases-live.jsonl
+++ b/evals/cases-live.jsonl
@@ -19,7 +19,7 @@
 {"id":"h3-smallest-accounts","utterance":"Smallest accounts first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"asc"}]}]}}
 {"id":"h3-account-column-hide","utterance":"Hide the account number.","expect":{"status":"ready","operations":[{"type":"columns.hide","columnIds":["account_number"]}]}}
 {"id":"h3-household-name","utterance":"Sort by household name.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"household","direction":"asc"}]}]}}
-{"id":"h3-big-households","utterance":"Largest households first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"h3-big-households","utterance":"Largest households first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean households as a whole? GridCue can group by Household."}}
 {"id":"h3-accounts-by-custodian","utterance":"Break the accounts down by custodian.","expect":{"status":"ready","operations":[{"type":"group.set","columnIds":["custodian"]}]}}
 {"id":"h3-account-list","utterance":"Show just account, advisor, and gain.","expect":{"status":"ready","operations":[{"type":"columns.show","columnIds":["account_number","advisor_name","unrealized_gain"]},{"type":"columns.hide","columnIds":["household","registration_type","custodian","market_value","concentration","has_restricted_holding"]},{"type":"columns.order","columnIds":["account_number","advisor_name","unrealized_gain"]}]}}
 {"id":"h3-concentrated-accounts","utterance":"Most concentrated accounts first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"concentration","direction":"desc"}]}]}}
@@ -35,7 +35,7 @@
 {"id":"h3-ira-accounts-show","utterance":"Show IRA accounts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"ira"}}]}}
 {"id":"h3-accounts-per-advisor","utterance":"Accounts per advisor.","expect":{"status":"ready","operations":[{"type":"group.set","columnIds":["advisor_name"]}]}}
 {"id":"h4-biggest-balance","utterance":"Biggest balance first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
-{"id":"h4-top-households","utterance":"Top households first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"h4-top-households","utterance":"Top households first.","expect":{"status":"needs_clarification","clarificationPrompt":"Did you mean households as a whole? GridCue can group by Household."}}
 {"id":"h4-largest-gain","utterance":"Sort by largest gain.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"desc"}]}]}}
 {"id":"h4-newest-accounts","utterance":"Show the accounts with the most concentration first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"concentration","direction":"desc"}]}]}}
 {"id":"h4-hide-account","utterance":"Get rid of the account column.","expect":{"status":"ready","operations":[{"type":"columns.hide","columnIds":["account_number"]}]}}
```

- [ ] **Step 4: Run**

```bash
pnpm build && pnpm exec vitest run --project evals && pnpm eval
```

- [ ] **Step 5: Commit**

```bash
git add evals
git commit -m "test(evals): chassis cases and --strategy/--with/--without"
```

### Task 7: Docs

**Files:**
- Create `docs/adr/0015-resolution-chassis.md`
- Modify `CONTEXT.md`, `README.md`, `docs/internals/intent-protocol.md`, `docs/internals/product.md`, `docs/planning/handoff-2026-09-24.md`

- [ ] **Step 1: Apply**

```diff
diff --git a/CONTEXT.md b/CONTEXT.md
index 4c6bff7..4b9d15d 100644
--- a/CONTEXT.md
+++ b/CONTEXT.md
@@ -32,6 +32,18 @@ _Avoid_: Intent, action type, command
 A column or enum value a Clause names by one of the Host's declared labels or aliases, found by deterministic code before any provider call. A name used for the rows themselves, as in "biggest accounts first", is not a Mention.
 _Avoid_: Match, hit, reference
 
+**Row Noun**:
+What one row of a grid is, such as "account", declared by the Host. In a request it means the rows, not a column.
+_Avoid_: Entity type, record type
+
+**Value Group**:
+A Host-named category over several enum values of one column, such as Retirement = IRA and Roth IRA.
+_Avoid_: Category, bucket, tag
+
+**Strategy**:
+Which questions an Intent Provider asks for each Clause, chosen by the Host. Jev offers "focused" (fewest questions) and "fan-out" (the default).
+_Avoid_: Mode, profile, preset
+
 **Clarification**:
 A single focused question GridCue asks when a request cannot be resolved without a choice only the User can make.
 _Avoid_: Follow-up, disambiguation prompt
diff --git a/README.md b/README.md
index 215fbaf..4c1ec4c 100644
--- a/README.md
+++ b/README.md
@@ -111,6 +111,37 @@ Using shadcn/ui? Copy the styled components instead of `GridCueBar`: see `regist
 
 Create the controller once, as above. TanStack's `useTable` returns a new object whenever table state changes, so a `useMemo` keyed on `table` would rebuild the controller.
 
+## Describe your domain, choose a strategy
+
+GridCue is a chassis: your data, grids, and words differ from anyone else's. Three optional schema declarations teach GridCue your domain:
+
+```ts
+defineSchema(columns, {
+  rowNoun: "account", // what one row is: "biggest accounts first" means the rows
+  columns: {
+    household: { entity: "household" }, // "largest households first" means households as whole records, so GridCue asks
+    registration_type: {
+      enumValues: [/* … */],
+      valueGroups: [{ label: "Retirement", values: ["ira", "roth_ira"] }], // "retirement accounts" = IRA or Roth IRA
+    },
+  },
+});
+```
+
+The Jev provider has two strategies, and each individual question can be switched off:
+
+| Strategy | Questions per part (9 columns) | Best for |
+| --- | --- | --- |
+| `"fan-out"` (default) | about 65 | Compound requests: "Roth IRAs grouped by rep", "also group by advisor", "advisor within custodian" |
+| `"focused"` | 27 | Simple, single-change requests, with the fewest tokens |
+
+```ts
+createJevProvider({ apiKey, strategy: "focused" });
+createJevProvider({ apiKey, signals: { values: true } }); // opt in: one yes/no per enum value, for undeclared categories
+```
+
+Measure your own requests with `pnpm eval:live -- --strategy=focused` or `--without=<signal>`.
+
 ## Try it
 
 ```bash
diff --git a/docs/adr/0015-resolution-chassis.md b/docs/adr/0015-resolution-chassis.md
new file mode 100644
index 0000000..7b5eaa4
--- /dev/null
+++ b/docs/adr/0015-resolution-chassis.md
@@ -0,0 +1,72 @@
+# Resolution chassis: strategies and domain declarations
+
+GridCue is a chassis. Every client's data, grids and words differ, so the Host chooses how GridCue uses Jev and describes its own domain in a few declarations. This ADR records the resolution chassis spec (`docs/superpowers/specs/2026-09-24-resolution-chassis-design.md`) as built and measured.
+
+## Strategies
+
+`createJevProvider({ strategy })` chooses which questions are asked, and `signals` overrides individual ones. The compiler is the same for every strategy and treats a missing answer as "no signal", so the strategies are one code path.
+
+| Strategy | Signals | Questions per part, wealth schema | Median latency |
+| --- | --- | --- | --- |
+| `"focused"` | none: the first version's questions (PR #2) | 27 | about 137 ms |
+| `"fan-out"` (default) | roles, kind, adds, outer, reading | about 55 to 70 | about 153 ms |
+| opt-in | `values`: one Noul per enum value | about 5 more | — |
+
+**Focused reproduces the first version and does better.** On the PR #2 baseline's cases, it gets 76 exact where PR #2 got 64, with no regressions, because the compiler improvements apply to every strategy. It still proposes the first version's wrong views on request types that version never handled: nesting, "also", and combinations. That is the trade-off it represents, and why fan-out is the default.
+
+## Domain declarations
+
+These are optional additions to `ViewSchema` and `ColumnDescriptor`:
+
+- **`rowNoun`:** what one row is ("account").
+- **`entity`:** the other record a column names ("household"). Any name of that column counts ("reps" for Advisor).
+- **`valueGroups`:** Host categories over enum values ("Retirement" = IRA and Roth IRA). `defineSchema` rejects a group that names a value the column doesn't have.
+
+## Rules
+
+1. **Value groups** match like aliases and give one Mention per value, so the filter is `in`.
+2. **An excluded value filters to the column's other approved values.** This covers "non-retirement", "excluding trusts", "everything except Northgate" and "not at Summit Trust". The complement is taken over `enumValues`, which the Host approved as the closed set.
+3. **A value in a prepositional phrase is a filter,** wherever it sits: "sort by gain for trusts", "at Northgate", "among Roth accounts".
+4. **A text-valued entity ranked by size means the records.** "Largest households first" or "top reps first": you can't rank a name by size, so GridCue offers "Group by Household" or "Use the Household column" rather than guessing. The rule came from evidence: Jev's reading question answered "column" (0.78 to 0.92) for these requests, so code decides this from the column's kind, like the amount rule in ADR 0013.
+5. **The reading Choice** is asked for a row or entity noun that grammar can't place ("show the household for each account"): column, records, or this grid's rows.
+6. **A family added by a rule and promoted by the provider in the same part runs once.** "Show IRAs at Northgate" had produced a duplicate filter.
+
+## Evidence
+
+The spec's 23 chassis cases were written before any code, and two more held-out sets (9 and 7 cases) before the refinements they tested. All 39 are now in `evals/cases-chassis.jsonl`.
+
+**Before the chassis:**
+- 10 of 23 exact;
+- 2 wrong views ("Show the household for each account" also showed Account number; "Retirement accounts grouped by advisor" dropped its filter);
+- 1 unsafe ("Largest households first" sorted instead of asking).
+
+**Final fan-out results, from two consecutive verbose runs:**
+
+| Set | Result |
+| --- | --- |
+| Core, 31 cases | all correct |
+| Live-only, 56 cases | 55 correct |
+| Fan-out, 50 cases | 49 correct |
+| Chassis, 39 cases | 36 correct |
+
+0 wrong views, 0 unsafe, and no regressions against the pre-chassis baseline. The one fan-out miss is a known flaky case: exact in 8 of 12 runs, and it asks otherwise.
+
+**Ablation, removing one signal from fan-out:**
+- **`reading`** decided 2 cases, and without it "Show the household for each account" proposes a wrong view. It stays.
+- **`values`** decided 1 case, below its bar of 3, and that case also flips when `reading` is removed. It is **opt-in**, not deleted. It is the only route to categories nobody declared ("tax-advantaged" scored IRA 0.39), and the owner asked that approaches stay available as configuration.
+
+**One label changed on the owner's direction.** Two older live-only cases labelled "Largest/Top households first" as "sort by Market value". They contradicted the owner's direction to decide whether a noun means records or the column, and the chassis labels. They now expect the records question. The grill log records the change.
+
+## Remaining findings
+
+All of these ask the User; none applies a wrong view.
+
+- **"Remove the custodian column":** Jev scores no change type.
+- **"Tax-advantaged accounts":** declare it as a value group, or opt in to `values`.
+- **"Biggest households at Northgate first":** the qualifier rule places "households" as rows before the ranking rule sees it.
+- **"Sort by gain limited to Harborline":** "to" is not in the preposition list, so it depends on opt-in `values`.
+
+## Revisit when
+
+- The model or the question wording changes. Rerun `pnpm eval:live -- --strategy=focused` and the `--without` ablations.
+- A client's domain shows the declarations missing something.
diff --git a/docs/internals/intent-protocol.md b/docs/internals/intent-protocol.md
index 06d3798..95cf78a 100644
--- a/docs/internals/intent-protocol.md
+++ b/docs/internals/intent-protocol.md
@@ -338,6 +338,12 @@ The fan-out (ADR 0014) adds four more optional `ClauseResolution` fields:
 
 A provider that omits any of them gets the behaviour from before the fan-out.
 
+The resolution chassis (ADR 0015) adds these optional fields:
+
+- `ViewSchema.rowNoun`, `ColumnDescriptor.entity` and `ColumnDescriptor.valueGroups`, which are also sent in `candidates`;
+- `clauses[].mentions[].ambiguous` and `.text`, for a row or entity noun that grammar couldn't place;
+- `ClauseResolution.readings`: `{ columnId, reading: "column" | "records" | "rows", confidence }[]`.
+
 ## Versioning
 
 - Additive optional fields may remain within protocol `0.1` during pre-release development.
diff --git a/docs/internals/product.md b/docs/internals/product.md
index 209da9d..d3c3c80 100644
--- a/docs/internals/product.md
+++ b/docs/internals/product.md
@@ -145,6 +145,12 @@ The defaults are `ready` 0.85 and `clarify` 0.65. They are unchanged since the f
   - An add-a-level answer appends to the current sort or grouping.
   - With reversal wording, an outer answer decides nesting.
   - A value named before another change's verb is a filter.
+- **Domain declarations** (ADR 0015).
+  - A value group names several values at once.
+  - An excluded value filters to the others.
+  - A value in a prepositional phrase ("for trusts") is a filter.
+  - A text-valued entity ranked by size ("largest households first") means the records, so GridCue offers to group rather than guess.
+  - The Host chooses the Jev strategy ("focused" or "fan-out").
 
 ## Domain examples
 
diff --git a/docs/planning/handoff-2026-09-24.md b/docs/planning/handoff-2026-09-24.md
index ca3d907..b7f8024 100644
--- a/docs/planning/handoff-2026-09-24.md
+++ b/docs/planning/handoff-2026-09-24.md
@@ -52,6 +52,12 @@ This is where the first build stopped, and what comes next. It covers the work i
      - "Remove the custodian column" (no change type scored);
      - row nouns that are also columns ("largest households first");
      - a value after the verb ("Sort by gain for trusts").
+1c. **Done: resolution chassis** (spec `docs/superpowers/specs/2026-09-24-resolution-chassis-design.md`, ADR 0015).
+   - Strategies: `"focused"` and `"fan-out"`, with signal toggles.
+   - Domain declarations: `rowNoun`, `entity` and `valueGroups`.
+   - Rules: excluded values, prepositions, and ranked entities as records.
+   - Fan-out results: 0 wrong views; chassis cases 36 of 39.
+   - **Next, per the owner's order:** a UI spec for the strategy-comparison demo, then grid routing, which builds on `entity`.
 2. **Extend the question budget.** Done in step 1: one call, a higher cap, and no questions for named values. A second call was rejected, because Jev prices per token and answers batched questions in parallel.
 3. **Publish to npm.**
    - Confirm `gridcue` is still free on npm (ADR 0004 asks for a re-check).
```

- [ ] **Step 2: Commit**

```bash
git add docs CONTEXT.md README.md
git commit -m "docs: ADR 0015, strategy guide, and chassis glossary"
```

### Task 8: Gate and acceptance

**Files:**

- [ ] **Step 1: Gate**

```bash
pnpm install --frozen-lockfile && pnpm check
# Expected: exit 0; 364 passed, 1 skipped
```

- [ ] **Step 2: Two fan-out runs**

```bash
pnpm eval:live -- --verbose > /tmp/c1.txt; pnpm eval:live -- --verbose > /tmp/c2.txt
grep -c '    got ready' /tmp/c1.txt /tmp/c2.txt   # Expected: 0 and 0
```

- [ ] **Step 3: One focused run**

```bash
pnpm eval:live -- --verbose --strategy=focused > /tmp/cf.txt
```

- [ ] **Step 4: Live test**

```bash
pnpm test:live
```

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "chore: resolution chassis passes the gate and live runs"
```

## Spec coverage

| Spec section | Task |
| --- | --- |
| 4 Strategies | 4 |
| 5.1 Jev provider | 4 |
| 5.2 Declarations | 1, 5 |
| 5.3 Mentions | 2 |
| 5.4 Compiler | 3 |
| 6 Protocol | 1, 7 |
| 7 Evals and evidence | 6, 8, ADR 0015 |
| 9 Acceptance (README note, handoff) | 7, 8 |
