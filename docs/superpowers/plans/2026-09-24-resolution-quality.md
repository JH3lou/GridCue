# Resolution Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six live-eval mismatches and lift the question budget, as the approved spec describes, without changing the confidence defaults.

**Architecture:** Core gains a deterministic matcher, `matchMentions`, which finds Host-declared column and value names in each Clause and uses grammar rules to tell the rows from a column. The Controller runs it before the provider call and sends the Mentions with the request. The compiler settles competing Operation Families with fixed rules (ADR 0012). It uses Mentions at confidence 1 unless the provider scores a named column below 0.40, and never silently ignores a named value. The Jev provider asks a Choice per literal, reads `probabilities`, pins `jev-1.13.0`, and caps questions at 600 (ADR 0013).

**Tech Stack:** unchanged from the first plan. Node 24, pnpm 12.6, TypeScript 7.0, Vitest 5, Biome 2.5, zod 4, `@typesafe-ai/sdk` 0.6.

**Spec:** `docs/superpowers/specs/2026-09-24-resolution-quality-design.md`. Read it first. `docs/planning/resolution-quality-grill.md` has the decisions and the experiments behind them.

## How this plan was verified

Every diff below was applied and run in a scratch worktree of `claude/resolution-quality` on 2026-09-24, with the real `JEV_API_KEY`. At the end of that run:

| Check | Result |
| --- | --- |
| `pnpm check` | exit 0: 325 tests passed, 1 skipped (the live Jev test, which the gate never runs) |
| `pnpm eval` with the Mock Provider | 25 cases: 18 exact, 3 safe abstentions, 4 rejected, 0 mismatch, 0 unsafe |
| `pnpm eval:live`, the 15 original cases | All 15 meet their expectation in two consecutive runs. Before: 6 mismatches |
| `pnpm eval:live`, all 81 live requests (25 core and 56 live-only) | Two consecutive verbose runs: 0 unsafe, and **0 wrong views proposed**. Every miss asks the User instead |
| `pnpm test:live` | 1 passed |

Diffs are Biome-formatted. `git apply` of the whole plan reproduces the scratch tree exactly.

### Decisions made while verifying

The owner asked that the matcher "use context clues to make sure it works". So each rule was tested on requests written and labelled before the rule existed, and each new held-out set was run before any fix it prompted. These refinements go beyond the approved spec. Tasks 1, 2 and 7 carry them, and ADRs 0012 and 0013 record them.

1. **The provider still scores named columns, and can overrule them below 0.40.**
   - The spec skipped Jev's question for a named column and let the Mention override.
   - A live-only set then showed "account" (both an alias and the word for the rows) proposing four wrong views, such as "Biggest accounts first" sorting by Account number. Jev had scored Account number 0.02 to 0.05 in each of them.
   - Named values stay fully deterministic, because Jev is weak at values.
2. **More grammar rules, all leaning toward "the rows".** A name wrongly read as the rows falls back to Jev, while one wrongly read as a column overrides it. The additions:
   - a name after a superlative is the rows, unless its column is yes/no;
   - a comparison word with no amount after it is a preposition ("accounts under each advisor");
   - two exceptions that always mean a column: after "by" or "on", and before "column".
3. **Rule 0: a family with nothing to act on yields to one that has something.** "Show IRAs at Northgate" scored show 0.85 and filter 0.82. Without this rule, it told the User there was no column called "iras at northgate".
4. **A named value is never silently ignored.** "Roth IRAs grouped by rep" grouped and dropped the Roth filter. It was the last wrong view in the live set. GridCue now asks the User to split the part.
5. **Core never calls a recognised name unknown.** `unknownTerm` is skipped when the Clause has any Mention. It also strips "me" and "us".
6. **A middling literal pick is offered first, not asked about on its own.** A confident Mention whose kind fits wins over it.
7. **Held-out sets 3 and 4 were folded into `evals/cases-live.jsonl`** once they had been run, so `pnpm eval:live` keeps them as regression cases.

## Global Constraints

The first plan's constraints apply unchanged. In particular:

- `JEV_API_KEY` is read only on a server.
- User-facing strings are exactly as written in the diffs, and tests assert several of them.
- Every eval case is synthetic.
- Commits use conventional titles.

Also:

- Do not change `DEFAULT_CONFIDENCE`. That needs its own ADR (spec section 3).
- `FAMILY_MARGIN` (0.10) and `MENTION_FLOOR` (0.40) are compiler constants, not Host options.
- New live-only eval cases state the right answer. A failure is recorded as a finding in the handoff, never "fixed" by editing the expectation.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/gridcue/src/core/mentions.ts` (new) | `matchMentions`, the grammar rules, and `LITERAL_COLUMN_KINDS` |
| `packages/gridcue/src/core/terms.ts` (new) | `unknownTerm`, moved from the Mock |
| `packages/gridcue/src/core/resolution.ts` | Optional `clauses[].mentions` and `literalColumns` fields |
| `packages/gridcue/src/core/compile.ts` | `settleFamilies`, Mention use and the floor, literal picks, never ignoring a named value, unknown terms |
| `packages/gridcue/src/core/controller.ts` | Runs `matchMentions` and passes the Mentions to the provider and the compiler. "parts" copy |
| `packages/gridcue/src/server/jev.ts` | Literal Choices, `probabilities`, question cap 600, `jev-1.13.0` |
| `packages/gridcue/src/mock/index.ts` | Uses the core helpers |
| `evals/*` | Mention fixtures, 10 Mock cases, 56 live-only cases, `--verbose` |

### Task 1: Mentions and unknown terms (core)

**Files:**
- Create `packages/gridcue/src/core/mentions.ts`
- Create `packages/gridcue/src/core/terms.ts`
- Modify `packages/gridcue/src/index.ts`
- Create `packages/gridcue/test/mentions.test.ts`

- [ ] **Step 1: Write the failing tests**

```diff
diff --git a/packages/gridcue/test/mentions.test.ts b/packages/gridcue/test/mentions.test.ts
new file mode 100644
index 0000000..be92756
--- /dev/null
+++ b/packages/gridcue/test/mentions.test.ts
@@ -0,0 +1,134 @@
+import { describe, expect, it } from "vitest";
+import { matchMentions } from "../src/core/mentions";
+import { normalize } from "../src/core/normalize";
+import { isExposed } from "../src/core/schema";
+import { unknownTerm } from "../src/core/terms";
+import { defineSchema } from "../src/index";
+
+const schema = defineSchema(
+  [
+    { id: "item", label: "Item number", kind: "string" },
+    { id: "price", label: "Price", kind: "currency" },
+    { id: "owner", label: "Owner", kind: "string" },
+    { id: "state", label: "State", kind: "enum" },
+    { id: "region", label: "Region", kind: "enum" },
+    { id: "secret", label: "Secret" },
+  ],
+  {
+    restricted: ["secret"],
+    columns: {
+      item: { aliases: ["item"] },
+      owner: { aliases: ["rep", "seller"] },
+      price: { aliases: ["cost"] },
+      state: {
+        enumValues: [
+          { id: "open", label: "Open" },
+          { id: "sold", label: "Sold", aliases: ["closed"] },
+        ],
+      },
+      region: {
+        enumValues: [
+          { id: "north", label: "North" },
+          { id: "open_air", label: "Open air", aliases: ["outdoor"] },
+        ],
+      },
+    },
+  },
+);
+const columns = schema.columns.filter(isExposed);
+const found = (text: string) =>
+  matchMentions(normalize(text).clauses, columns).map((m) => (m.valueId === undefined ? m.columnId : `${m.columnId}=${m.valueId}`));
+
+describe("matchMentions", () => {
+  it("matches labels, aliases, and plurals as whole words", () => {
+    expect(found("sort by rep")).toEqual(["owner"]);
+    expect(found("group by sellers")).toEqual(["owner"]);
+    expect(found("hide item numbers")).toEqual(["item"]);
+    expect(found("hide the representative")).toEqual([]);
+  });
+
+  it("matches enum values and their aliases, masking them from column matching", () => {
+    expect(found("only closed items")).toEqual(["state=sold"]);
+    expect(found("open and sold, sorted by price")).toEqual(["state=open", "state=sold", "price"]);
+  });
+
+  it("reads a column name after another name as the rows (rule 1)", () => {
+    expect(found("show open items")).toEqual(["state=open"]);
+  });
+
+  it("reads a column name before a qualifier as the rows (rule 2)", () => {
+    expect(found("items with a price above $5")).toEqual(["price"]);
+    expect(found("show items without an owner")).toEqual(["owner"]);
+  });
+
+  it("reads a column name before 'by' as the rows (rule 3)", () => {
+    expect(found("sort items by price")).toEqual(["price"]);
+  });
+
+  it("reads a column name compared with a literal it can't hold as the rows (rule 4)", () => {
+    expect(found("items over $500")).toEqual([]);
+    expect(found("cost over $500")).toEqual(["price"]);
+    expect(found("group the items under each owner")).toEqual(["owner"]);
+  });
+
+  it("always reads a name after 'by' or before 'column' as a column", () => {
+    expect(found("sort by price in descending order")).toEqual(["price"]);
+    expect(found("group by items")).toEqual(["item"]);
+    expect(found("hide the item column")).toEqual(["item"]);
+  });
+
+  it("leaves an ambiguous name to the provider", () => {
+    const twoOwners = defineSchema(
+      [
+        { id: "a", label: "Owner", kind: "string" },
+        { id: "b", label: "Owner name", kind: "string" },
+      ],
+      { columns: { b: { aliases: ["owner"] } } },
+    );
+    expect(matchMentions(normalize("sort by owner").clauses, twoOwners.columns)).toEqual([]);
+    const twoOpens = defineSchema(
+      [
+        { id: "a", kind: "enum" },
+        { id: "b", kind: "enum" },
+      ],
+      {
+        columns: { a: { enumValues: [{ id: "open", label: "Open" }] }, b: { enumValues: [{ id: "open", label: "Open" }] } },
+      },
+    );
+    expect(matchMentions(normalize("only open").clauses, twoOpens.columns)).toEqual([]);
+  });
+
+  it("never matches a column that is not exposed", () => {
+    expect(found("sort by secret")).toEqual([]);
+  });
+
+  it("keeps each Mention on its own Clause", () => {
+    const mentions = matchMentions(normalize("group by owner, then sort by price").clauses, columns);
+    expect(mentions.map((m) => [m.clauseIndex, m.columnId])).toEqual([
+      [0, "owner"],
+      [1, "price"],
+    ]);
+  });
+});
+
+describe("unknownTerm", () => {
+  it("names the words after a column verb", () => {
+    expect(unknownTerm("sort by risk score")).toBe("risk score");
+    expect(unknownTerm("group by the region code, largest first")).toBe("region code");
+  });
+
+  it("returns nothing for a pronoun, an empty remainder, or a sentence", () => {
+    expect(unknownTerm("sort them")).toBeUndefined();
+    expect(unknownTerm("sort by")).toBeUndefined();
+    expect(unknownTerm("sort by the thing my manager asked about yesterday")).toBeUndefined();
+  });
+});
+
+describe("matchMentions superlatives", () => {
+  it("reads a name after a superlative, with at most one word between, as the rows (rule 5)", () => {
+    expect(found("biggest items first")).toEqual([]);
+    expect(found("largest open items first")).toEqual(["state=open"]);
+    // Leaning toward the rows: this falls back to the provider rather than being matched.
+    expect(found("sort by the largest cost")).toEqual([]);
+  });
+});
```

- [ ] **Step 2: Run them and see them fail**

```bash
pnpm --filter gridcue exec vitest run test/mentions.test.ts
# Expected: FAIL, cannot find ../src/core/mentions and ../src/core/terms
```

- [ ] **Step 3: Add the matcher**

```diff
diff --git a/packages/gridcue/src/core/mentions.ts b/packages/gridcue/src/core/mentions.ts
new file mode 100644
index 0000000..297a037
--- /dev/null
+++ b/packages/gridcue/src/core/mentions.ts
@@ -0,0 +1,109 @@
+import type { Clause, LiteralKind } from "./normalize";
+import type { ColumnKind, EnumValue } from "./protocol";
+import { findMentions, type TextMatch } from "./text-match";
+
+/** The column kinds a literal of each kind can filter. An unreadable number fits none, so GridCue asks. */
+export const LITERAL_COLUMN_KINDS: Readonly<Record<LiteralKind, readonly ColumnKind[]>> = {
+  number: ["number", "currency", "percent"],
+  currency: ["currency", "number"],
+  percent: ["percent"],
+  date: ["date", "datetime"],
+  text: ["string"],
+  unreadable: [],
+};
+
+/** A column or enum value a Clause names by one of its Host-declared names. */
+export interface Mention {
+  clauseIndex: number;
+  columnId: string;
+  /** Set when the text named an enum value, such as "roth". Its column is implied. */
+  valueId?: string;
+  start: number;
+  end: number;
+}
+
+/** What matching needs from a column. Schema columns and provider candidates both fit. */
+export interface MentionColumn {
+  id: string;
+  label: string;
+  kind: ColumnKind;
+  aliases?: readonly string[] | undefined;
+  enumValues?: readonly EnumValue[] | undefined;
+}
+
+// A column name "where the rows go" names the rows, not the column (ADR 0013): "Roth accounts",
+// "accounts with …", "sort households by …", "accounts over $1M" when Account number can't hold an amount.
+// The rules lean toward "the rows": a name wrongly read as the rows falls back to the provider, while one
+// wrongly read as a column overrides it.
+const QUALIFIER_AFTER = /^\s*(?:with|without|where|whose|that|which|at|in|from|having|held|owned)\b/;
+const BY_AFTER = /^\s*by\b/;
+const COMPARISON_AFTER =
+  /^\s*(?:(?:is|are)\s+)?(?:over|under|above|below|exceed(?:s|ing)?|more than|less than|greater than|fewer than|at least|at most|up to|between|>|<)/;
+// A superlative ranks rows: "biggest accounts first", "largest households first".
+const SUPERLATIVE_BEFORE =
+  /\b(?:biggest|largest|smallest|highest|lowest|greatest|least|most|top|bottom|best|worst|richest|poorest|newest|oldest)\s+(?:[\p{L}-]+\s+)?$/u;
+// These slots always hold a column: "sort by value in descending order", "hide the account column".
+const COLUMN_SLOT_BEFORE = /\b(?:by|on)\s+(?:the\s+)?$/;
+const COLUMN_WORD_AFTER = /^\s*columns?\b/;
+
+const nameKey = (name: string) => (name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
+
+/** Keeps only names that point at exactly one item. An ambiguous name is left to the provider. */
+const unambiguous = <T>(entries: Array<{ item: T; key: string; names: string[] }>) => {
+  const owners = new Map<string, Set<string>>();
+  for (const e of entries) {
+    for (const n of e.names) {
+      const k = nameKey(n);
+      owners.set(k, (owners.get(k) ?? new Set()).add(e.key));
+    }
+  }
+  return entries.map((e) => ({ item: e.item, names: e.names.filter((n) => owners.get(nameKey(n))?.size === 1) }));
+};
+
+const inRowPosition = (clause: Clause, hit: TextMatch<MentionColumn>, others: ReadonlyArray<TextMatch<unknown>>): boolean => {
+  const before = clause.text.slice(0, hit.start);
+  const after = clause.text.slice(hit.end);
+  if (COLUMN_SLOT_BEFORE.test(before) || COLUMN_WORD_AFTER.test(after)) return false;
+  if (others.some((o) => o !== hit && o.end <= hit.start && /^\s*$/.test(clause.text.slice(o.end, hit.start)))) return true;
+  if (QUALIFIER_AFTER.test(after) || BY_AFTER.test(after)) return true;
+  // A yes/no column can't be ranked, so "the most restricted accounts" still names Restricted holdings.
+  if (SUPERLATIVE_BEFORE.test(before) && hit.item.kind !== "boolean") return true;
+  if (COMPARISON_AFTER.test(after)) {
+    // With an amount after it, the kind decides: "value over $1M" is a column, "accounts over $1M" the rows.
+    // With none, the word is a preposition: "accounts under each advisor".
+    const literal = clause.literals.filter((l) => l.at >= hit.end).sort((a, b) => a.at - b.at)[0];
+    if (!literal) return true;
+    return literal.kind !== "unreadable" && !LITERAL_COLUMN_KINDS[literal.kind].includes(hit.item.kind);
+  }
+  return false;
+};
+
+/**
+ * Finds the columns and enum values each Clause names by a Host-declared label or alias. Deterministic,
+ * so these never depend on a provider's score. Pass exposed columns only: Mentions are sent to the provider.
+ */
+export const matchMentions = (clauses: readonly Clause[], columns: readonly MentionColumn[]): Mention[] => {
+  const valueEntries = unambiguous(
+    columns.flatMap((c) =>
+      (c.enumValues ?? []).map((v) => ({
+        item: { columnId: c.id, valueId: v.id },
+        key: `${c.id}\u0000${v.id}`,
+        names: [v.label, ...(v.aliases ?? [])],
+      })),
+    ),
+  );
+  const columnEntries = unambiguous(columns.map((c) => ({ item: c, key: c.id, names: [c.label, ...(c.aliases ?? [])] })));
+  return clauses.flatMap((clause) => {
+    // Values first, masked out, so "Roth IRA" is not also read as a column name.
+    const values = findMentions(clause.text, valueEntries);
+    const masked = values.reduce((t, h) => t.slice(0, h.start) + " ".repeat(h.end - h.start) + t.slice(h.end), clause.text);
+    const cols = findMentions(masked, columnEntries);
+    const all: TextMatch<unknown>[] = [...values, ...cols];
+    return [
+      ...values.map((h) => ({ clauseIndex: clause.index, columnId: h.item.columnId, valueId: h.item.valueId, start: h.start, end: h.end })),
+      ...cols
+        .filter((h) => !inRowPosition(clause, h, all))
+        .map((h) => ({ clauseIndex: clause.index, columnId: h.item.id, start: h.start, end: h.end })),
+    ].sort((a, b) => a.start - b.start);
+  });
+};
```

- [ ] **Step 4: Add the unknown-term helper**

```diff
diff --git a/packages/gridcue/src/core/terms.ts b/packages/gridcue/src/core/terms.ts
new file mode 100644
index 0000000..1b4fee5
--- /dev/null
+++ b/packages/gridcue/src/core/terms.ts
@@ -0,0 +1,18 @@
+const PRONOUNS = new Set(["it", "this", "that", "them", "these", "those", "one", "ones"]);
+
+/**
+ * The words a column Clause names after its verb, such as "risk score" in "sort by risk score", so a
+ * Clarification can say which name GridCue didn't recognise. Never matched to a column. Returns nothing
+ * for a pronoun, an empty remainder, or more than four words, which are more likely a sentence than a name.
+ */
+export const unknownTerm = (clauseText: string): string | undefined => {
+  const term = clauseText
+    .replace(/^.*?\b(?:sort(?:ed)?|order(?:ed)?|group(?:ed)?|hide|show|display|filter)\b(?:\s+(?:by|on))?\s*/, "")
+    .replace(/\b(?:largest|biggest|highest|smallest|lowest|newest|oldest)\b.*$|\b(?:ascending|descending|first|column|columns)\b/g, "")
+    .replace(/\b(?:the|me|us)\b/g, "")
+    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
+    .replace(/\s+/g, " ")
+    .trim();
+  if (!term || term.split(" ").length > 4 || PRONOUNS.has(term)) return undefined;
+  return term;
+};
```

- [ ] **Step 5: Export both from the root entry**

```diff
diff --git a/packages/gridcue/src/index.ts b/packages/gridcue/src/index.ts
index 37d4537..733e81d 100644
--- a/packages/gridcue/src/index.ts
+++ b/packages/gridcue/src/index.ts
@@ -9,6 +9,7 @@ export {
 } from "./core/controller";
 export * from "./core/errors";
 export { matchesFilter, matchesPredicate } from "./core/evaluate";
+export { LITERAL_COLUMN_KINDS, type Mention, type MentionColumn, matchMentions } from "./core/mentions";
 export { type Clause, type Comparator, type Literal, type LiteralKind, type NormalizedInput, normalize } from "./core/normalize";
 export { type RestrictedMention, screenRestricted } from "./core/policy";
 export * from "./core/preview";
@@ -18,6 +19,7 @@ export { createRemoteProvider, type RemoteProviderOptions } from "./core/remote"
 export * from "./core/resolution";
 export { applyView, createRowsAdapter, type RowsAdapter, type RowsAdapterOptions, type ViewResult } from "./core/rows-adapter";
 export * from "./core/schema";
+export { unknownTerm } from "./core/terms";
 export {
   type ApplicableViewPlan,
   isApplicable,
```

- [ ] **Step 6: Run the tests and see them pass**

```bash
pnpm --filter gridcue exec vitest run test/mentions.test.ts
# Expected: 13 passed
```

- [ ] **Step 7: Commit**

```bash
git add packages/gridcue/src/core/mentions.ts packages/gridcue/src/core/terms.ts packages/gridcue/src/index.ts packages/gridcue/test/mentions.test.ts
git commit -m "feat(core): match Host-declared names with context rules (ADR 0013)"
```

### Task 2: Protocol fields and the compiler

**Files:**
- Modify `packages/gridcue/src/core/resolution.ts`
- Modify `packages/gridcue/src/core/compile.ts`
- Modify `packages/gridcue/test/compile.test.ts`

- [ ] **Step 1: Write the failing tests**

```diff
diff --git a/packages/gridcue/test/compile.test.ts b/packages/gridcue/test/compile.test.ts
index 0db89a1..a574b74 100644
--- a/packages/gridcue/test/compile.test.ts
+++ b/packages/gridcue/test/compile.test.ts
@@ -1,5 +1,6 @@
 import { describe, expect, it } from "vitest";
-import { compile } from "../src/core/compile";
+import { compile, settleFamilies } from "../src/core/compile";
+import { matchMentions } from "../src/core/mentions";
 import { normalize } from "../src/core/normalize";
 import { renderPreview, toAuditEvent } from "../src/core/preview";
 import { emptyViewState } from "../src/core/protocol";
@@ -27,9 +28,10 @@ const schema = defineSchema(
 );
 const state = emptyViewState(schema.columns.map((c) => c.id));
 let n = 0;
-const run = (text: string, clauses: Array<Partial<ClauseResolution>>, answers?: Record<string, string>) =>
+const run = (text: string, clauses: Array<Partial<ClauseResolution>>, answers?: Record<string, string>, useMentions = false) =>
   compile({
     input: normalize(text),
+    ...(useMentions ? { mentions: matchMentions(normalize(text).clauses, schema.columns) } : {}),
     resolution: { clauses: clauses.map((c, i) => ({ clauseIndex: i, families: [], columns: [], values: [], unmatchedTerms: [], ...c })) },
     schema,
     state,
@@ -228,3 +230,153 @@ describe("toAuditEvent", () => {
     expect(toAuditEvent(plan, "applied", {}, {}, { ready: 0.95, clarify: 0.9 }).confidenceBand).toBe("medium");
   });
 });
+
+const at = (id: string, confidence: number) => ({ id, confidence });
+const families = (plan: ReturnType<typeof run>) => plan.evidence.filter((e) => e.key === "c0.family").map((e) => e.selectedId);
+
+describe("family precedence (ADR 0012)", () => {
+  it("drops middling families once one is confident (rule 1)", () => {
+    const plan = run("reset the view", [{ families: [at("view.reset", 0.96), at("filter.clear", 0.83), at("sort.clear", 0.64)] }]);
+    expect(plan.status).toBe("ready");
+    expect(plan.operations).toEqual([{ type: "view.reset" }]);
+    expect(plan.evidence).toContainEqual({
+      key: "dropped:c0.family",
+      selectedId: "filter.clear",
+      confidence: 0.83,
+      source: "deterministic",
+    });
+  });
+
+  it("still asks about middling families when nothing is confident", () => {
+    const plan = run("tidy up", [{ families: [at("view.reset", 0.8)] }]);
+    expect(plan.clarifications.map((q) => q.prompt)).toEqual(["Did you want to reset the view?"]);
+  });
+
+  it("lets show-only absorb show and hide (rule 2)", () => {
+    const plan = run("keep only name and value", [
+      { families: [at("columns.only", 0.97), at("columns.hide", 0.88), at("columns.show", 0.67)], columns: [hi("name"), hi("value")] },
+    ]);
+    expect(plan.status).toBe("ready");
+    expect(plan.operations[0]).toEqual({ type: "columns.show", columnIds: ["name", "value"] });
+  });
+
+  it("lets explicit clears beat a weaker reset, and a stronger reset beat the clears (rule 3)", () => {
+    const clears = run("clear the filters and sorting", [
+      { families: [at("filter.clear", 0.99), at("sort.clear", 0.99), at("view.reset", 0.9)] },
+    ]);
+    expect(clears.operations).toEqual([{ type: "filter.clear" }, { type: "sort.set", sorts: [] }]);
+    const reset = run("reset everything", [{ families: [at("view.reset", 0.97), at("filter.clear", 0.9)] }]);
+    expect(reset.operations).toEqual([{ type: "view.reset" }]);
+    const tie = run("reset the filters", [{ families: [at("view.reset", 0.9), at("filter.clear", 0.9)] }]);
+    expect(tie.operations).toEqual([{ type: "filter.clear" }]);
+  });
+
+  it("keeps the top column family when it leads by at least 0.10 (rule 4)", () => {
+    const plan = run("show value over $1m", [{ families: [at("filter", 0.95), at("columns.show", 0.85)], columns: [hi("value")] }]);
+    expect(plan.status).toBe("ready");
+    expect(plan.operations.map((o) => o.type)).toEqual(["filter.add"]);
+    expect(families(plan)).toEqual(["filter"]);
+  });
+
+  it("asks for a split when column families are close (rule 5)", () => {
+    const plan = run("show value over $1m", [{ families: [at("filter", 0.95), at("columns.show", 0.9)], columns: [hi("value")] }]);
+    expect(plan.clarifications[0]?.prompt).toBe(
+      "“show value over $1m” asks for more than one kind of change. Split it into separate parts.",
+    );
+  });
+
+  it("lets a family with nothing to act on yield to one that has something", () => {
+    const plan = run("show closed ones", [{ families: [at("columns.show", 0.85), at("filter", 0.82)] }], undefined, true);
+    expect(plan.clarifications.map((q) => q.prompt)).toEqual(["Did you want to filter the rows?"]);
+    const alone = run("sort by risk score", [{ families: [hi("sort")] }]);
+    expect(alone.clarifications[0]?.prompt).toBe("There's no column called “risk score”. Which column should be sorted by?");
+  });
+
+  it("settles families as a pure function, with a lead of exactly 0.10 counting as a margin", () => {
+    expect(settleFamilies([at("sort", 0.95), at("group", 0.85)], [at("filter", 0.7)])).toEqual({
+      kept: [at("sort", 0.95)],
+      ask: [],
+      dropped: [at("group", 0.85), at("filter", 0.7)],
+    });
+    expect(settleFamilies([at("sort", 0.95), at("group", 0.86)], []).kept).toHaveLength(2);
+  });
+});
+
+describe("Mentions", () => {
+  it("uses a named column at confidence 1 whatever the provider scored", () => {
+    const plan = run("sort by gain", [{ families: [hi("sort")], columns: [at("gain", 0.7)] }], undefined, true);
+    expect(plan.status).toBe("ready");
+    expect(plan.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "gain", direction: "asc" }] }]);
+    expect(plan.evidence).toContainEqual({ key: "c0.column", selectedId: "gain", confidence: 1, source: "deterministic" });
+  });
+
+  it("drops a named column the provider scored below the floor, so the rows aren't read as a column", () => {
+    const plan = run("sort by gain", [{ families: [hi("sort")], columns: [at("gain", 0.05), at("value", 0.9)] }], undefined, true);
+    expect(plan.operations).toEqual([{ type: "sort.set", sorts: [{ columnId: "value", direction: "asc" }] }]);
+    expect(plan.evidence).toContainEqual({ key: "dropped:c0.mention", selectedId: "gain", confidence: 0.05, source: "provider" });
+  });
+
+  it("never calls a named value an unknown column", () => {
+    const plan = run("show closed ones", [{ families: [at("columns.show", 0.9)] }], undefined, true);
+    expect(plan.clarifications.map((q) => q.prompt).join(" ")).not.toContain("no column called");
+  });
+
+  it("never silently ignores a named value in a part that doesn't filter", () => {
+    const plan = run("closed ones grouped by name", [{ families: [hi("group")], columns: [hi("name")] }], undefined, true);
+    expect(plan.status).toBe("needs_clarification");
+    expect(plan.clarifications[0]?.prompt).toBe(
+      "“closed ones grouped by name” also names Closed. Split it into separate parts, such as “only Closed” and the rest.",
+    );
+  });
+
+  it("uses a named value, and never asks about the column it implies", () => {
+    const plan = run("only closed ones", [{ families: [hi("filter")], columns: [at("status", 0.75)], values: [] }], undefined, true);
+    expect(plan.status).toBe("ready");
+    expect(plan.operations).toMatchObject([{ type: "filter.add", predicate: { columnId: "status", operator: "eq", value: "closed" } }]);
+  });
+
+  it("never asks about a column a confident provider value already implies", () => {
+    const plan = run("only the open ones", [
+      { families: [hi("filter")], columns: [at("status", 0.7)], values: [{ columnId: "status", valueId: "open", confidence: 0.9 }] },
+    ]);
+    expect(plan.status).toBe("ready");
+  });
+});
+
+describe("literal targets", () => {
+  it("uses the provider's confident pick for a literal", () => {
+    const plan = run("rows over $1m", [
+      { families: [hi("filter")], literalColumns: [{ literalIndex: 0, columnId: "gain", confidence: 0.9 }] },
+    ]);
+    expect(plan.operations).toMatchObject([{ predicate: { columnId: "gain", operator: "gt", value: 1_000_000 } }]);
+  });
+
+  it("offers a middling pick first when no column is otherwise known", () => {
+    const plan = run("rows over $1m", [
+      { families: [hi("filter")], literalColumns: [{ literalIndex: 0, columnId: "gain", confidence: 0.7 }] },
+    ]);
+    expect(plan.clarifications[0]).toMatchObject({
+      prompt: "Which column should be above $1,000,000?",
+      options: [{ id: "gain" }, { id: "value" }],
+    });
+  });
+
+  it("ignores a pick whose kind doesn't fit, and falls back to a confident column", () => {
+    const plan = run("value over $1m", [
+      { families: [hi("filter")], columns: [hi("value")], literalColumns: [{ literalIndex: 0, columnId: "name", confidence: 0.99 }] },
+    ]);
+    expect(plan.operations).toMatchObject([{ predicate: { columnId: "value" } }]);
+  });
+});
+
+describe("unknown terms", () => {
+  it("names the term when the provider found no column and returned none", () => {
+    const plan = run("sort by risk score", [{ families: [hi("sort")] }]);
+    expect(plan.clarifications[0]?.prompt).toBe("There's no column called “risk score”. Which column should be sorted by?");
+  });
+
+  it("does not claim a column is missing while asking 'Did you mean …?'", () => {
+    const plan = run("sort by worth", [{ families: [hi("sort")], columns: [at("value", 0.7)] }]);
+    expect(plan.clarifications.map((q) => q.prompt)).toEqual(["Did you mean Value?", "Which column should be sorted by?"]);
+  });
+});
```

- [ ] **Step 2: Run them and see them fail**

```bash
pnpm --filter gridcue exec vitest run test/compile.test.ts
# Expected: FAIL, settleFamilies is not exported and `literalColumns` is not a ClauseResolution field
```

- [ ] **Step 3: Add the optional protocol fields and pass Mentions into the request**

```diff
diff --git a/packages/gridcue/src/core/resolution.ts b/packages/gridcue/src/core/resolution.ts
index b23ac03..7423b63 100644
--- a/packages/gridcue/src/core/resolution.ts
+++ b/packages/gridcue/src/core/resolution.ts
@@ -1,4 +1,5 @@
 import { z } from "zod";
+import type { Mention } from "./mentions";
 import type { NormalizedInput } from "./normalize";
 import type { ColumnCapability, OperationType, ViewCapabilities, ViewSchema, ViewState } from "./protocol";
 import { ColumnKind, EnumValue, FilterOperator, PROTOCOL_VERSION, SortSpec } from "./protocol";
@@ -81,6 +82,8 @@ export const ResolutionRequest = z.object({
         text: z.string(),
         literals: z.array(LiteralSchema),
         direction: z.enum(["asc", "desc"]).optional(),
+        /** Columns and enum values core already matched by a Host-declared name. A provider may skip asking about them. */
+        mentions: z.array(z.object({ columnId: z.string(), valueId: z.string().optional() })).optional(),
       }),
     )
     .max(12),
@@ -107,6 +110,10 @@ export const ClauseResolution = z.object({
   direction: Pick.optional(),
   /** Phrases that look like column references but match no candidate. Never guessed at. */
   unmatchedTerms: z.array(z.string()),
+  /** The column each literal applies to, by its index in the Clause's `literals`. Optional. */
+  literalColumns: z
+    .array(z.object({ literalIndex: z.number().int().nonnegative(), columnId: z.string(), confidence: z.number().min(0).max(1) }))
+    .optional(),
 });
 export type ClauseResolution = z.infer<typeof ClauseResolution>;
 
@@ -141,10 +148,16 @@ export const buildResolutionRequest = (
   schema: ViewSchema,
   capabilities: ViewCapabilities,
   state: ViewState,
+  mentions: readonly Mention[] = [],
 ): ResolutionRequest => ({
   protocolVersion: PROTOCOL_VERSION,
   utterance: input.text,
-  clauses: input.clauses,
+  clauses: input.clauses.map((clause) => {
+    const own = mentions
+      .filter((m) => m.clauseIndex === clause.index)
+      .map(({ columnId, valueId }) => (valueId === undefined ? { columnId } : { columnId, valueId }));
+    return own.length > 0 ? { ...clause, mentions: own } : clause;
+  }),
   candidates: buildCandidates(schema, capabilities),
   view: {
     visibleColumnIds: state.visibleColumnIds,
```

- [ ] **Step 4: Update the compiler: precedence rules, Mentions and the floor, literal picks, never ignoring a named value, unknown terms, and "parts" copy**

```diff
diff --git a/packages/gridcue/src/core/compile.ts b/packages/gridcue/src/core/compile.ts
index 8a08b1a..833152b 100644
--- a/packages/gridcue/src/core/compile.ts
+++ b/packages/gridcue/src/core/compile.ts
@@ -1,3 +1,4 @@
+import { LITERAL_COLUMN_KINDS, type Mention } from "./mentions";
 import type { Literal, NormalizedInput } from "./normalize";
 import type { RestrictedMention } from "./policy";
 import {
@@ -23,6 +24,7 @@ import {
   type ViewFamily,
 } from "./resolution";
 import { isExposed, operatorsFor } from "./schema";
+import { unknownTerm } from "./terms";
 
 export interface ConfidencePolicy {
   /** At or above this, a decision is used as-is. Default 0.85. */
@@ -41,21 +43,14 @@ export interface CompileInput {
   channel: ViewPlan["source"]["channel"];
   text?: string;
   restricted?: RestrictedMention[];
+  /** Columns and values matched by Host-declared names. Each counts as confidence 1 and overrides the provider. */
+  mentions?: readonly Mention[];
   /** Answers to earlier clarifications, keyed by clarification ID. */
   answers?: Record<string, string>;
   confidence?: ConfidencePolicy;
   newId: (prefix: string) => string;
 }
 
-const LITERAL_KINDS: Record<Literal["kind"], ColumnKind[]> = {
-  number: ["number", "currency", "percent"],
-  currency: ["currency", "number"],
-  percent: ["percent"],
-  date: ["date", "datetime"],
-  text: ["string"],
-  unreadable: [],
-};
-
 const COLUMN_WORD: Record<string, string> = {
   sort: "sorted by",
   group: "grouped by",
@@ -83,6 +78,42 @@ const FAMILY_PHRASE: Record<string, string> = {
 
 const isView = (f: string): f is ViewFamily => !f.startsWith("unsupported.");
 const KNOWN_FAMILY_IDS: ReadonlySet<string> = new Set([...VIEW_FAMILIES, ...UNSUPPORTED_FAMILIES]);
+const CLEARS: ReadonlySet<string> = new Set(["filter.clear", "sort.clear", "group.clear"]);
+const isColumnFamily = (f: Pick) => isView(f.id) && COLUMN_FAMILIES[f.id] !== undefined;
+/** How far the top column family must lead the next for the next to be dropped (ADR 0012). */
+export const FAMILY_MARGIN = 0.1;
+/** Below this provider score, a column named by a Host-declared word is read as not meant (ADR 0013). */
+export const MENTION_FLOOR = 0.4;
+
+/**
+ * Decides between competing families (ADR 0012). `accepted` are at or above `ready` or confirmed by the User;
+ * `middling` are view families between `clarify` and `ready`. `viable` says whether a family has something to act
+ * on in this Clause. Returns the families to use, the ones to ask about, and the ones dropped.
+ */
+export const settleFamilies = (accepted: readonly Pick[], middling: readonly Pick[], viable: (family: string) => boolean = () => true) => {
+  let kept = [...accepted];
+  const dropped: Pick[] = [];
+  const drop = (test: (f: Pick) => boolean) => {
+    dropped.push(...kept.filter(test));
+    kept = kept.filter((f) => !test(f));
+  };
+  // A family with nothing to act on yields to one that has something, as "show" does to "filter" in "show IRAs at Northgate".
+  if (kept.some((f) => !viable(f.id)) && [...kept, ...middling].some((f) => viable(f.id))) drop((f) => !viable(f.id));
+  if (kept.some((f) => f.id === "columns.only")) drop((f) => f.id === "columns.show" || f.id === "columns.hide");
+  const reset = kept.find((f) => f.id === "view.reset");
+  const clears = kept.filter((f) => CLEARS.has(f.id));
+  if (reset && clears.length > 0) {
+    if (clears.every((f) => reset.confidence > f.confidence)) drop((f) => CLEARS.has(f.id));
+    else drop((f) => f.id === "view.reset");
+  }
+  const ranked = kept.filter(isColumnFamily).sort((a, b) => b.confidence - a.confidence);
+  const [top, next] = ranked;
+  // The epsilon keeps 0.95 - 0.85 (0.0999…) on the "leads by 0.10" side.
+  if (top && next && top.confidence - next.confidence >= FAMILY_MARGIN - 1e-9) drop((f) => f !== top && isColumnFamily(f));
+  const confident = kept.some((f) => isView(f.id));
+  if (confident) dropped.push(...middling);
+  return { kept, ask: confident ? [] : [...middling], dropped };
+};
 
 /** Turns provider picks and parsed literals into a View Plan. Deterministic; never guesses. */
 export const compile = (c: CompileInput): ViewPlan => {
@@ -94,7 +125,7 @@ export const compile = (c: CompileInput): ViewPlan => {
   const unsupportedSegments: ViewPlan["unsupportedSegments"] = [];
   const confidences: number[] = [];
   const column = (id: string) => c.schema.columns.find((col) => col.id === id && isExposed(col));
-  const optionsFor = (kinds: ColumnKind[] | null, capability: string) =>
+  const optionsFor = (kinds: readonly ColumnKind[] | null, capability: string) =>
     c.schema.columns
       .filter((col) => isExposed(col) && col.capabilities.includes(capability as never) && (!kinds || kinds.includes(col.kind)))
       .map((col) => ({ id: col.id, label: col.label }));
@@ -118,34 +149,71 @@ export const compile = (c: CompileInput): ViewPlan => {
         values: [],
         unmatchedTerms: [],
       };
-      // Family picks: confident ones are used, middling ones are confirmed, weak ones are dropped.
-      let familyPending = false;
-      const families: Pick[] = [];
+      // Mentions are deterministic: a named value is used at confidence 1. A named column is too, unless the provider
+      // scored that column below MENTION_FLOOR: "biggest accounts first" names the rows, not Account number (ADR 0013).
+      const own = (c.mentions ?? []).filter((m) => m.clauseIndex === clause.index);
+      const scored = new Map(res.columns.map((p) => [p.id, p.confidence]));
+      const mentionedColumns: string[] = [];
+      for (const id of new Set(own.filter((m) => m.valueId === undefined).map((m) => m.columnId))) {
+        const score = scored.get(id);
+        if (score !== undefined && score < MENTION_FLOOR) {
+          evidence.push({ key: `dropped:${key}.mention`, selectedId: id, confidence: score, source: "provider" });
+        } else mentionedColumns.push(id);
+      }
+      const mentionedValues = own.filter((m) => m.valueId !== undefined);
+      const valueColumns = new Set(mentionedValues.map((m) => m.columnId));
+      const values = [
+        ...[...new Set(mentionedValues.map((m) => `${m.columnId}\u0000${m.valueId}`))].map((k) => {
+          const [columnId = "", valueId = ""] = k.split("\u0000");
+          return { columnId, valueId, confidence: 1, mentioned: true };
+        }),
+        ...res.values.filter((v) => !valueColumns.has(v.columnId)).map((v) => ({ ...v, mentioned: false })),
+      ];
+      // A column already implied by a named or confident value, or by a confident literal pick, is never asked about.
+      const covered = new Set([
+        ...values.filter((v) => v.confidence >= bands.ready).map((v) => v.columnId),
+        ...(res.literalColumns ?? []).filter((l) => l.confidence >= bands.ready).map((l) => l.columnId),
+      ]);
+
+      const hasColumns = mentionedColumns.length > 0 || res.columns.some((p) => p.confidence >= bands.clarify && column(p.id));
+      const hasFilterArgs = clause.literals.length > 0 || values.some((v) => v.mentioned || v.confidence >= bands.clarify);
+      const viable = (f: string) => (f === "filter" ? hasFilterArgs : isView(f) && COLUMN_FAMILIES[f] ? hasColumns : true);
+
+      // Family picks: sort each into accepted, middling, or dropped, then settle competing ones (ADR 0012).
+      const accepted: Pick[] = [];
+      const middling: Pick[] = [];
       for (const f of res.families) {
         if (!KNOWN_FAMILY_IDS.has(f.id)) continue;
         const answerKey = `${key}.family.${f.id}`;
         if (answers[answerKey] !== undefined) {
           if (answers[answerKey] === f.id) {
-            families.push(f);
+            accepted.push({ id: f.id, confidence: 1 });
             note(answerKey, f.id, 1, "user");
           }
         } else if (f.confidence >= bands.ready || (!isView(f.id) && f.confidence >= bands.clarify)) {
           // An unsupported action is refused, not confirmed: asking "did you want to edit the data?" invites a yes that is refused anyway.
-          families.push(f);
-          note(`${key}.family`, f.id, f.confidence, "provider");
+          accepted.push(f);
         } else if (f.confidence >= bands.clarify) {
-          clarifications.push({
-            id: answerKey,
-            prompt: `Did you want to ${FAMILY_PHRASE[f.id] ?? "change the view"}?`,
-            options: [
-              { id: f.id, label: "Yes" },
-              { id: "none", label: "No" },
-            ],
-            required: true,
-          });
-          familyPending = true;
+          middling.push(f);
         }
       }
+      const settled = settleFamilies(accepted, middling, viable);
+      const families = settled.kept;
+      for (const f of families) if (answers[`${key}.family.${f.id}`] === undefined) note(`${key}.family`, f.id, f.confidence, "provider");
+      for (const f of settled.dropped)
+        evidence.push({ key: `dropped:${key}.family`, selectedId: f.id, confidence: f.confidence, source: "deterministic" });
+      for (const f of settled.ask) {
+        clarifications.push({
+          id: `${key}.family.${f.id}`,
+          prompt: `Did you want to ${FAMILY_PHRASE[f.id] ?? "change the view"}?`,
+          options: [
+            { id: f.id, label: "Yes" },
+            { id: "none", label: "No" },
+          ],
+          required: true,
+        });
+      }
+      const familyPending = settled.ask.length > 0;
 
       const blocked = families.filter((f) => !isView(f.id));
       for (const f of blocked) {
@@ -166,18 +234,36 @@ export const compile = (c: CompileInput): ViewPlan => {
       if (viewFamilies.filter((f) => COLUMN_FAMILIES[f]).length > 1) {
         clarifications.push({
           id: `${key}.family`,
-          prompt: `“${clause.text}” asks for more than one kind of change. Split it into separate steps.`,
+          prompt: `“${clause.text}” asks for more than one kind of change. Split it into separate parts.`,
+          required: true,
+        });
+        continue;
+      }
+      // A value the User named is never silently ignored: "roth iras grouped by rep" names Roth IRA but only groups.
+      const unused = viewFamilies.includes("filter") ? [] : mentionedValues;
+      if (unused.length > 0) {
+        const col = column(unused[0]?.columnId ?? "");
+        const label = col?.enumValues?.find((v) => v.id === unused[0]?.valueId)?.label ?? "a value";
+        clarifications.push({
+          id: `${key}.family`,
+          prompt: `“${clause.text}” also names ${label}. Split it into separate parts, such as “only ${label}” and the rest.`,
           required: true,
         });
         continue;
       }
 
-      // Column picks: confident ones are used, middling ones are confirmed, weak ones are dropped.
+      // Column picks: named ones are used; otherwise confident ones are used, middling ones are confirmed, weak ones are dropped.
       const picked: ColumnDescriptor[] = [];
+      for (const id of mentionedColumns) {
+        const col = column(id);
+        if (!col) continue;
+        picked.push(col);
+        note(`${key}.column`, id, 1, "deterministic");
+      }
       for (const p of res.columns) {
         const answerKey = `${key}.column.${p.id}`;
         const col = column(p.id);
-        if (!col) continue;
+        if (!col || mentionedColumns.includes(p.id)) continue;
         if (answers[answerKey] !== undefined) {
           if (answers[answerKey] === p.id) {
             picked.push(col);
@@ -186,7 +272,7 @@ export const compile = (c: CompileInput): ViewPlan => {
         } else if (p.confidence >= bands.ready) {
           picked.push(col);
           note(`${key}.column`, p.id, p.confidence, "provider");
-        } else if (p.confidence >= bands.clarify) {
+        } else if (p.confidence >= bands.clarify && !covered.has(p.id)) {
           clarifications.push({
             id: answerKey,
             prompt: `Did you mean ${col.label}?`,
@@ -209,7 +295,7 @@ export const compile = (c: CompileInput): ViewPlan => {
           const pred = (columnId: string, operator: FilterPredicate["operator"], value?: FilterPredicate["value"]) =>
             predicates.push({ id: c.newId("filter"), type: "predicate", columnId, operator, ...(value === undefined ? {} : { value }) });
           const byColumn = new Map<string, string[]>();
-          for (const v of res.values) {
+          for (const v of values) {
             const col = column(v.columnId);
             if (!col) continue;
             const isBoolean = col.kind === "boolean";
@@ -229,6 +315,8 @@ export const compile = (c: CompileInput): ViewPlan => {
             const answerKey = `${key}.value.${col.id}.${v.valueId}`;
             if (answers[answerKey] !== undefined) {
               if (answers[answerKey] === v.valueId) use(1, "user", answerKey);
+            } else if (v.mentioned) {
+              use(1, "deterministic", `${key}.value.${col.id}`);
             } else if (v.confidence >= bands.ready) {
               use(v.confidence, "provider", `${key}.value.${col.id}`);
             } else if (v.confidence >= bands.clarify) {
@@ -258,21 +346,29 @@ export const compile = (c: CompileInput): ViewPlan => {
               return;
             }
             const answerKey = `${key}.literal${j}.column`;
-            const fits = LITERAL_KINDS[lit.kind];
+            const fits = LITERAL_COLUMN_KINDS[lit.kind];
             const answered = answers[answerKey] ? column(answers[answerKey]) : undefined;
-            const target = answered ?? picked.find((col) => fits.includes(col.kind) && !used.has(col.id));
+            // The provider's pick for this literal: used when confident, offered first when middling.
+            const pick = res.literalColumns?.find((l) => l.literalIndex === j);
+            const pickCol = pick && column(pick.columnId);
+            const pickFits = pickCol && fits.includes(pickCol.kind) && pickCol.capabilities.includes("filter") && !used.has(pickCol.id);
+            const provided = pickFits && pick.confidence >= bands.ready ? pickCol : undefined;
+            const target = answered ?? provided ?? picked.find((col) => fits.includes(col.kind) && !used.has(col.id));
             const operator = lit.kind === "text" ? "contains" : (lit.comparator ?? "eq");
             if (!target || !operatorsFor(target).includes(operator)) {
+              const options = optionsFor(fits, "filter");
+              const first = pickFits && pick.confidence >= bands.clarify ? pickCol.id : undefined;
               clarifications.push({
                 id: answerKey,
                 prompt: `Which column should be ${describeLiteral(lit)}?`,
-                options: optionsFor(fits, "filter"),
+                options: first ? [...options.filter((o) => o.id === first), ...options.filter((o) => o.id !== first)] : options,
                 required: true,
               });
               return;
             }
             used.add(target.id);
             if (answered) note(answerKey, target.id, 1, "user");
+            else if (target === provided && pick) note(answerKey, target.id, pick.confidence, "provider");
             note(`${key}.literal${j}`, String(lit.value), 1, "deterministic");
             pred(target.id, operator, operator === "between" ? { min: lit.value, max: lit.upper ?? lit.value } : lit.value);
           });
@@ -293,7 +389,10 @@ export const compile = (c: CompileInput): ViewPlan => {
           );
           if (answered) note(answerKey, answered.id, 1, "user");
           if (cols.length === 0) {
-            const unknown = res.unmatchedTerms[0];
+            // A provider's own term wins. Core names one only when no "Did you mean …?" is pending here and the
+            // Clause named nothing it recognised: it never calls a Host-declared name unknown.
+            const pending = clarifications.some((q) => q.id.startsWith(`${key}.column.`));
+            const unknown = res.unmatchedTerms[0] ?? (pending || own.length > 0 ? undefined : unknownTerm(clause.text));
             clarifications.push({
               id: answerKey,
               prompt: unknown
```

- [ ] **Step 5: Run the tests and see them pass**

```bash
pnpm --filter gridcue exec vitest run test/compile.test.ts
# Expected: 37 passed
```

- [ ] **Step 6: Commit**

```bash
git add packages/gridcue/src/core/resolution.ts packages/gridcue/src/core/compile.ts packages/gridcue/test/compile.test.ts
git commit -m "feat(core): settle competing families and use Mentions in the compiler (ADR 0012)"
```

### Task 3: Controller wiring and copy

**Files:**
- Modify `packages/gridcue/src/core/controller.ts`
- Modify `packages/gridcue/test/controller.test.ts`

- [ ] **Step 1: Write the failing tests**

```diff
diff --git a/packages/gridcue/test/controller.test.ts b/packages/gridcue/test/controller.test.ts
index 1f339b6..f6495c2 100644
--- a/packages/gridcue/test/controller.test.ts
+++ b/packages/gridcue/test/controller.test.ts
@@ -2,7 +2,7 @@ import { describe, expect, it, vi } from "vitest";
 import { createGridCue } from "../src/core/controller";
 import { GridCueError } from "../src/core/errors";
 import type { AuditEvent } from "../src/core/preview";
-import type { IntentProvider } from "../src/core/resolution";
+import type { IntentProvider, ResolutionRequest } from "../src/core/resolution";
 import { createRowsAdapter } from "../src/core/rows-adapter";
 import { defineSchema } from "../src/core/schema";
 import { createMockProvider } from "../src/mock";
@@ -193,7 +193,7 @@ describe("controller", () => {
     expect(cue.getState().preview?.lines).toEqual(["Sort by Value, ascending"]);
   });
 
-  it("asks for fewer steps when a request has too many clauses", async () => {
+  it("asks for fewer parts when a request has too many clauses", async () => {
     const provider = { resolve: vi.fn() };
     const { cue } = setup(provider);
     await cue.propose(Array.from({ length: 13 }, (_, i) => `sort by value ${i}`).join("; "));
@@ -201,6 +201,29 @@ describe("controller", () => {
     expect(provider.resolve).not.toHaveBeenCalled();
   });
 
+  it("sends Mentions to the provider and uses them over a middling score", async () => {
+    let sent: ResolutionRequest | undefined;
+    const { cue } = setup({
+      resolve: async (request) => {
+        sent = request;
+        return {
+          clauses: [
+            {
+              clauseIndex: 0,
+              families: [{ id: "sort", confidence: 0.95 }],
+              columns: [{ id: "gain", confidence: 0.5 }],
+              values: [],
+              unmatchedTerms: [],
+            },
+          ],
+        };
+      },
+    });
+    await cue.propose("sort by gain");
+    expect(sent?.clauses[0]?.mentions).toEqual([{ columnId: "gain" }]);
+    expect(cue.getState().status).toBe("ready");
+  });
+
   it("keeps the view when the provider fails", async () => {
     const { adapter, cue } = setup({
       resolve: async () => {
@@ -229,7 +252,7 @@ describe("controller", () => {
     expect(cue.getState().issues[0]?.code).toBe("PROVIDER_FAILED");
   });
 
-  it("asks for fewer steps on a provider's PROVIDER_TOO_COMPLEX without naming GridCue's own limit", async () => {
+  it("asks for fewer parts on a provider's PROVIDER_TOO_COMPLEX without naming GridCue's own limit", async () => {
     const { cue } = setup({
       resolve: async () => {
         throw new GridCueError("PROVIDER_TOO_COMPLEX", "That request is too complex. Try a shorter one.");
@@ -238,7 +261,7 @@ describe("controller", () => {
     await cue.propose("sort by value");
     expect(cue.getState()).toMatchObject({
       status: "error",
-      message: "Try fewer steps at once.",
+      message: "Try fewer parts at once.",
       issues: [{ code: "PROVIDER_TOO_COMPLEX" }],
     });
   });
```

- [ ] **Step 2: Run them and see them fail**

```bash
pnpm --filter gridcue exec vitest run test/controller.test.ts
# Expected: FAIL, no `mentions` on the request, and the copy still says "steps"
```

- [ ] **Step 3: Match Mentions before the provider call and pass them through**

```diff
diff --git a/packages/gridcue/src/core/controller.ts b/packages/gridcue/src/core/controller.ts
index 4ce9dcf..da377a9 100644
--- a/packages/gridcue/src/core/controller.ts
+++ b/packages/gridcue/src/core/controller.ts
@@ -1,11 +1,13 @@
 import type { GridAdapter } from "./adapter";
 import { type ConfidencePolicy, compile } from "./compile";
 import { GridCueError, type Issue, isGridCueError } from "./errors";
+import { type Mention, matchMentions } from "./mentions";
 import { type NormalizedInput, normalize } from "./normalize";
 import { screenRestricted } from "./policy";
 import { type AuditEvent, type AuditPolicy, type Preview, renderPreview, toAuditEvent } from "./preview";
 import type { VersionedViewState, ViewPlan, ViewSchema } from "./protocol";
 import { buildResolutionRequest, type IntentProvider, ResolutionResult } from "./resolution";
+import { isExposed } from "./schema";
 import { type ApplicableViewPlan, validatePlan } from "./validate";
 
 export type InteractionStatus = "idle" | "resolving" | "ready" | "needs_clarification" | "unsupported" | "applying" | "applied" | "error";
@@ -68,6 +70,7 @@ export const createGridCue = (options: GridCueOptions): GridCueController => {
     channel: ViewPlan["source"]["channel"];
     answers: Record<string, string>;
     restricted: ReturnType<typeof screenRestricted>;
+    mentions: Mention[];
   } | null = null;
   let applicable: ApplicableViewPlan | null = null;
   let undoEntry: { before: VersionedViewState; appliedRevision: string; plan: ViewPlan } | null = null;
@@ -94,6 +97,7 @@ export const createGridCue = (options: GridCueOptions): GridCueController => {
       channel: session.channel,
       text: state.utterance,
       restricted: session.restricted,
+      mentions: session.mentions,
       answers: session.answers,
       ...(options.confidence ? { confidence: options.confidence } : {}),
       newId: (prefix) => `${prefix}_${++ids}`,
@@ -155,24 +159,25 @@ export const createGridCue = (options: GridCueOptions): GridCueController => {
       if (input.clauses.length > MAX_CLAUSES) {
         set({
           status: "error",
-          message: `Try fewer steps at once. GridCue handles up to ${MAX_CLAUSES} in one request.`,
+          message: `Try fewer parts at once. GridCue handles up to ${MAX_CLAUSES} in one request.`,
           issues: [{ code: "INPUT_TOO_COMPLEX", message: "Too many clauses." }],
         });
         return null;
       }
       const base = adapter.getState();
       const restricted = screenRestricted(input, schema);
+      const mentions = restricted.length === 0 ? matchMentions(input.clauses, schema.columns.filter(isExposed)) : [];
       try {
         let resolution: ResolutionResult = { clauses: [] };
         if (restricted.length === 0) {
-          const request = buildResolutionRequest(input, schema, adapter.getCapabilities(), base.state);
+          const request = buildResolutionRequest(input, schema, adapter.getCapabilities(), base.state, mentions);
           const raw = await provider.resolve(request, controller.signal);
           if (controller.signal.aborted) return null;
           const parsed = ResolutionResult.safeParse(raw);
           if (!parsed.success) throw new GridCueError("PROVIDER_MALFORMED", "The provider returned an unexpected response.");
           resolution = parsed.data;
         }
-        session = { input, resolution, base, channel, answers: {}, restricted };
+        session = { input, resolution, base, channel, answers: {}, restricted, mentions };
         return present();
       } catch (error) {
         if (controller.signal.aborted) return null;
@@ -180,7 +185,7 @@ export const createGridCue = (options: GridCueOptions): GridCueController => {
         // A provider (local or remote) can find a request too complex on its own terms, with its own limit,
         // so name no number here; the local clause-count check above states GridCue's own.
         const message =
-          code === "PROVIDER_TOO_COMPLEX" ? "Try fewer steps at once." : "Couldn't interpret that request. The view hasn't changed.";
+          code === "PROVIDER_TOO_COMPLEX" ? "Try fewer parts at once." : "Couldn't interpret that request. The view hasn't changed.";
         set({
           status: "error",
           message,
```

- [ ] **Step 4: Run the tests and see them pass**

```bash
pnpm --filter gridcue exec vitest run test/controller.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/gridcue/src/core/controller.ts packages/gridcue/test/controller.test.ts
git commit -m "feat(core): send Mentions to the provider; users see \"parts\", not \"steps\""
```

### Task 4: Jev provider

**Files:**
- Modify `packages/gridcue/src/server/jev.ts`
- Modify `packages/gridcue/test/jev.test.ts`

- [ ] **Step 1: Write the failing tests**

```diff
diff --git a/packages/gridcue/test/jev.test.ts b/packages/gridcue/test/jev.test.ts
index ea55c61..ea099f4 100644
--- a/packages/gridcue/test/jev.test.ts
+++ b/packages/gridcue/test/jev.test.ts
@@ -1,7 +1,7 @@
 import { describe, expect, it, vi } from "vitest";
 import { defineSchema } from "../src/core/schema";
-import { buildResolutionRequest, emptyViewState, normalize } from "../src/index";
-import { createJevProvider, type JevClient } from "../src/server/jev";
+import { buildResolutionRequest, emptyViewState, isExposed, matchMentions, normalize } from "../src/index";
+import { createJevProvider, DEFAULT_JEV_MODEL, type JevClient } from "../src/server/jev";
 
 const schema = defineSchema([{ id: "value", label: "Market value", kind: "currency" }, { id: "status", kind: "enum" }, { id: "tax_id" }], {
   restricted: ["tax_id"],
@@ -10,24 +10,27 @@ const schema = defineSchema([{ id: "value", label: "Market value", kind: "curren
 const caps = { operations: ["filter.add", "sort.set"], supportsAtomicApply: true, supportsSnapshotRestore: true, observesChanges: true };
 const request = buildResolutionRequest(normalize("open accounts over $1m"), schema, caps, emptyViewState(["value", "status", "tax_id"]));
 
-const fakeClient = (answer: (name: string) => unknown, seen: { questions?: Record<string, unknown>; state?: unknown } = {}): JevClient => ({
+type Seen = { questions?: Record<string, unknown>; state?: unknown; model?: string };
+const fakeClient = (answer: (name: string) => unknown, seen: Seen = {}): JevClient => ({
   async systemOne(req) {
     seen.questions = req.questions;
     seen.state = req.state;
+    if (req.model !== undefined) seen.model = req.model;
     return { answers: Object.fromEntries(Object.keys(req.questions).map((k) => [k, answer(k)])) };
   },
 });
 
 describe("createJevProvider", () => {
   it("asks closed questions and maps answers to candidate IDs", async () => {
-    const seen: { questions?: Record<string, unknown>; state?: unknown } = {};
+    const seen: Seen = {};
     const provider = createJevProvider({
       client: fakeClient((k) => {
         if (k === "c0_f0") return { noul: 0.93 }; // filter
         if (k.endsWith("_col0")) return { noul: 0.91 }; // value
         if (k.includes("_f") || k.includes("_col")) return { noul: 0.02 };
-        if (k === "c0_val1") return { choice: "open", confidence: 0.97, probabilities: {} };
-        return { choice: "none", confidence: 0.9, probabilities: {} };
+        // `confidence` describes the distribution's shape; the value's own probability is what GridCue uses.
+        if (k === "c0_val1") return { choice: "open", confidence: 0.4, probabilities: { none: 0.03, open: 0.97 } };
+        return { choice: "none", confidence: 0.9, probabilities: { none: 0.9 } };
       }, seen),
     });
     const result = await provider.resolve(request);
@@ -55,14 +58,95 @@ describe("createJevProvider", () => {
       client: fakeClient((k) =>
         k === "c0_val1"
           ? undefined
-          : k.includes("_val") || k.endsWith("_dir")
-            ? { choice: "none", confidence: 0.9, probabilities: {} }
+          : k.includes("_val") || k.endsWith("_dir") || k.includes("_lit")
+            ? { choice: "none", probabilities: { none: 0.9 } }
             : { noul: 0.1 },
       ),
     });
     await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_MALFORMED" });
   });
 
+  it("treats a choice without its probability as malformed", async () => {
+    const provider = createJevProvider({
+      client: fakeClient((k) =>
+        k.includes("_val") || k.endsWith("_dir") || k.includes("_lit") ? { choice: "none", confidence: 0.9 } : { noul: 0.1 },
+      ),
+    });
+    await expect(provider.resolve(request)).rejects.toMatchObject({ code: "PROVIDER_MALFORMED" });
+  });
+
+  it("asks which column each literal applies to, offering only columns that fit", async () => {
+    const seen: Seen = {};
+    const provider = createJevProvider({
+      client: fakeClient(
+        (k) =>
+          k === "c0_lit0"
+            ? { choice: "value", probabilities: { none: 0.08, value: 0.92 } }
+            : k.includes("_val") || k.endsWith("_dir")
+              ? { choice: "none", probabilities: { none: 0.9 } }
+              : { noul: 0.1 },
+        seen,
+      ),
+    });
+    const result = await provider.resolve(request);
+    expect(JSON.stringify(seen.questions?.c0_lit0)).toContain("Market value");
+    expect(JSON.stringify(seen.questions?.c0_lit0)).not.toContain("Status");
+    expect(seen.state).toMatchObject({ clauses: [{ literals: [{ kind: "currency", value: 1_000_000, comparator: "gt" }] }] });
+    expect(result.clauses[0]?.literalColumns).toEqual([{ literalIndex: 0, columnId: "value", confidence: 0.92 }]);
+  });
+
+  it("skips questions about named values, but still asks about named columns", async () => {
+    const text = "only open, sorted by market value";
+    const input = normalize(text);
+    const named = buildResolutionRequest(
+      input,
+      schema,
+      caps,
+      emptyViewState(["value", "status", "tax_id"]),
+      matchMentions(input.clauses, schema.columns.filter(isExposed)),
+    );
+    const seen: Seen = {};
+    const provider = createJevProvider({
+      client: fakeClient(
+        (k) =>
+          k.includes("_val") || k.endsWith("_dir") || k.includes("_lit") ? { choice: "none", probabilities: { none: 0.9 } } : { noul: 0.1 },
+        seen,
+      ),
+    });
+    const result = await provider.resolve(named);
+    expect(Object.keys(seen.questions ?? {})).not.toContain("c0_val1");
+    expect(Object.keys(seen.questions ?? {})).not.toContain("c0_col1");
+    expect(Object.keys(seen.questions ?? {})).toContain("c1_col0");
+    expect(result.clauses[0]?.columns.map((c) => c.id)).toEqual(["value"]);
+  });
+
+  it("pins the model it is tuned against unless the Host picks one", async () => {
+    const answer = (k: string) =>
+      k.includes("_val") || k.endsWith("_dir") || k.includes("_lit") ? { choice: "none", probabilities: { none: 1 } } : { noul: 0 };
+    const pinned: Seen = {};
+    await createJevProvider({ client: fakeClient(answer, pinned) }).resolve(request);
+    expect(pinned.model).toBe(DEFAULT_JEV_MODEL);
+    expect(DEFAULT_JEV_MODEL).toBe("jev-1.13.0");
+    const floating: Seen = {};
+    await createJevProvider({ client: fakeClient(answer, floating), model: "jev-latest" }).resolve(request);
+    expect(floating.model).toBe("jev-latest");
+  });
+
+  it("fits twelve Clauses within the default question budget", async () => {
+    const twelve = buildResolutionRequest(
+      normalize(Array.from({ length: 12 }, (_, i) => `sort by market value ${i}`).join("; ")),
+      schema,
+      caps,
+      emptyViewState(["value", "status", "tax_id"]),
+    );
+    const provider = createJevProvider({
+      client: fakeClient((k) =>
+        k.includes("_val") || k.endsWith("_dir") || k.includes("_lit") ? { choice: "none", probabilities: { none: 1 } } : { noul: 0 },
+      ),
+    });
+    await expect(provider.resolve(twelve)).resolves.toMatchObject({ clauses: { length: 12 } });
+  });
+
   it("wraps transport errors", async () => {
     const provider = createJevProvider({
       client: {
```

- [ ] **Step 2: Run them and see them fail**

```bash
pnpm --filter gridcue exec vitest run test/jev.test.ts
# Expected: FAIL, DEFAULT_JEV_MODEL missing, no literal questions, `confidence` read instead of `probabilities`
```

- [ ] **Step 3: Update the provider: literal Choices, skip named values, read probabilities, cap 600, pinned model**

```diff
diff --git a/packages/gridcue/src/server/jev.ts b/packages/gridcue/src/server/jev.ts
index 3191871..76e83cb 100644
--- a/packages/gridcue/src/server/jev.ts
+++ b/packages/gridcue/src/server/jev.ts
@@ -1,5 +1,12 @@
 import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
-import { type ClauseResolution, GridCueError, type IntentProvider, type Pick, type ResolutionRequest } from "../index";
+import {
+  type ClauseResolution,
+  GridCueError,
+  type IntentProvider,
+  LITERAL_COLUMN_KINDS,
+  type Pick,
+  type ResolutionRequest,
+} from "../index";
 
 /** The slice of the TypeSafe client this provider uses. Tests pass a fake. */
 export interface JevClient {
@@ -11,12 +18,18 @@ export interface JevClient {
 
 export interface JevProviderOptions {
   apiKey?: string;
+  /** Default `jev-1.13.0`, the model GridCue's confidence bands are tuned against. Pass `jev-latest` to float. */
   model?: string;
   client?: JevClient;
-  /** GridCue's own per-request question budget, not an API limit. Default 96. Measure cost and latency with `pnpm eval:live`. */
+  /**
+   * GridCue's own per-request question budget, not an API limit. Default 600, about 24k tokens: under Jev's 64k per
+   * request. Twelve Clauses on a nine-column schema need about 330. Measure cost and latency with `pnpm eval:live`.
+   */
   maxQuestions?: number;
 }
 
+export const DEFAULT_JEV_MODEL = "jev-1.13.0";
+
 const FAMILY_TEXT: Record<string, string> = {
   filter: "narrow the rows to those matching a condition",
   sort: "sort the rows",
@@ -34,7 +47,7 @@ const FAMILY_TEXT: Record<string, string> = {
   "unsupported.export": "export, download, print, or copy data",
 };
 
-type Answer = { noul?: number; choice?: string; confidence?: number };
+type Answer = { noul?: number; choice?: string; probabilities?: Record<string, unknown> };
 
 /** Jev resolves bounded yes/no and choice questions. It never sees rows or restricted columns. */
 export const createJevProvider = (options: JevProviderOptions): IntentProvider => {
@@ -42,7 +55,8 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
   // bodies (the Utterance, column labels, aliases, descriptions). Set it explicitly so a Host's environment
   // can't turn that on by accident. A Host that wants SDK logs can inject its own `client` instead.
   const client: JevClient = options.client ?? (new TypeSafeClient({ apiKey: options.apiKey, logLevel: "off" }) as unknown as JevClient);
-  const maxQuestions = options.maxQuestions ?? 96;
+  const maxQuestions = options.maxQuestions ?? 600;
+  const model = options.model ?? DEFAULT_JEV_MODEL;
   return {
     async resolve(request: ResolutionRequest, signal?: AbortSignal) {
       const { columns, families } = request.candidates;
@@ -51,14 +65,19 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
       request.clauses.forEach((clause, p) => {
         const q = `c${clause.index}`;
         const about = `The request step \`clauses[${p}].text\``;
+        // A named value is final, so its column and value questions are skipped. A named column is still asked about:
+        // its score lets the compiler tell the column from the rows ("biggest accounts first"), ADR 0013.
+        const valued = new Set(clause.mentions?.filter((m) => m.valueId !== undefined).map((m) => m.columnId));
         families.forEach((f, i) => {
           questions[`${q}_f${i}`] = noul(`Does ${about} ask to ${FAMILY_TEXT[f] ?? f}?`);
         });
         columns.forEach((c, i) => {
-          questions[`${q}_col${i}`] = noul(
-            `Does ${about} refer to the grid column \`columns[${i}]\` (“${c.label}”), by its label or an alias?`,
-          );
-          if (c.enumValues?.length) {
+          if (!valued.has(c.id)) {
+            questions[`${q}_col${i}`] = noul(
+              `Does ${about} refer to the grid column \`columns[${i}]\` (“${c.label}”), by its label or an alias?`,
+            );
+          }
+          if (c.enumValues?.length && !valued.has(c.id)) {
             questions[`${q}_val${i}`] = choice(
               `Which value of the column \`columns[${i}]\` (“${c.label}”) does ${about} mention, if any?`,
               {
@@ -78,6 +97,17 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
             );
           }
         });
+        clause.literals.forEach((lit, j) => {
+          const fits = columns.filter((c) => c.families.includes("filter") && LITERAL_COLUMN_KINDS[lit.kind].includes(c.kind));
+          if (fits.length === 0) return;
+          questions[`${q}_lit${j}`] = choice(
+            `Which grid column does the condition \`clauses[${p}].literals[${j}]\` in ${about} apply to?`,
+            {
+              none: "None of these columns",
+              ...Object.fromEntries(fits.map((c) => [c.id, c.label])),
+            },
+          );
+        });
         if (!clause.direction) {
           questions[`${q}_dir`] = choice(`If ${about} sorts rows, which direction does it ask for?`, {
             none: "No direction given",
@@ -93,10 +123,15 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
       try {
         const response = await client.systemOne(
           {
-            ...(options.model ? { model: options.model } : {}),
+            model,
             state: {
               request: request.utterance,
-              clauses: request.clauses.map((c) => ({ text: c.text })),
+              clauses: request.clauses.map((c) => ({
+                text: c.text,
+                ...(c.literals.length > 0
+                  ? { literals: c.literals.map(({ kind, value, upper, comparator }) => ({ kind, value, upper, comparator })) }
+                  : {}),
+              })),
               columns: columns.map(({ id, label, kind, aliases, description }) => ({ id, label, kind, aliases, description })),
             },
             questions,
@@ -117,14 +152,21 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
         if (!a) throw new GridCueError("PROVIDER_MALFORMED", "Jev omitted an answer.");
         if (typeof a.choice !== "string" || !allowed.includes(a.choice))
           throw new GridCueError("PROVIDER_MALFORMED", "Jev returned an unknown choice.");
-        return a.choice === "none" ? undefined : { id: a.choice, confidence: a.confidence ?? 0 };
+        // Jev's `confidence` describes the whole distribution's shape; GridCue's bands are probabilities (ADR 0013).
+        const probability = a.probabilities?.[a.choice];
+        if (typeof probability !== "number" || probability < 0 || probability > 1)
+          throw new GridCueError("PROVIDER_MALFORMED", "Jev omitted a choice probability.");
+        return a.choice === "none" ? undefined : { id: a.choice, confidence: probability };
       };
       return {
         clauses: request.clauses.map((clause): ClauseResolution => {
           const q = `c${clause.index}`;
           const fam = families.map((f, i) => ({ id: f, confidence: yes(`${q}_f${i}`) }));
+          const asked = (i: number) => `${q}_col${i}` in questions;
           const mentions = columns
-            .map((c, i) => ({ c, i, p: yes(`${q}_col${i}`) }))
+            .map((c, i) => ({ c, i }))
+            .filter((m) => asked(m.i))
+            .map((m) => ({ ...m, p: yes(`${q}_col${m.i}`) }))
             .map((m) => ({
               ...m,
               at:
@@ -136,14 +178,19 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
             .sort((a, b) => a.at - b.at || a.i - b.i);
           const values: ClauseResolution["values"] = [];
           columns.forEach((c, i) => {
-            const v = c.enumValues
-              ? pickOf(`${q}_val${i}`, ["none", ...c.enumValues.map((e) => e.id)])
-              : c.kind === "boolean"
-                ? pickOf(`${q}_bool${i}`, ["none", "true", "false"])
-                : undefined;
+            const key = c.enumValues ? `${q}_val${i}` : c.kind === "boolean" ? `${q}_bool${i}` : undefined;
+            const allowed = c.enumValues ? ["none", ...c.enumValues.map((e) => e.id)] : ["none", "true", "false"];
+            const v = key && key in questions ? pickOf(key, allowed) : undefined;
             if (v) values.push({ columnId: c.id, valueId: v.id, confidence: v.confidence });
           });
           const direction = clause.direction ? undefined : pickOf(`${q}_dir`, ["none", "asc", "desc"]);
+          const literalColumns: NonNullable<ClauseResolution["literalColumns"]> = [];
+          clause.literals.forEach((_, j) => {
+            const key = `${q}_lit${j}`;
+            if (!(key in questions)) return;
+            const pick = pickOf(key, ["none", ...columns.map((c) => c.id)]);
+            if (pick) literalColumns.push({ literalIndex: j, columnId: pick.id, confidence: pick.confidence });
+          });
           return {
             clauseIndex: clause.index,
             families: fam,
@@ -151,6 +198,7 @@ export const createJevProvider = (options: JevProviderOptions): IntentProvider =
             values,
             ...(direction ? { direction } : {}),
             unmatchedTerms: [],
+            ...(literalColumns.length > 0 ? { literalColumns } : {}),
           };
         }),
       };
```

- [ ] **Step 4: Run the tests and see them pass**

```bash
pnpm --filter gridcue exec vitest run test/jev.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/gridcue/src/server/jev.ts packages/gridcue/test/jev.test.ts
git commit -m "feat(server): Jev asks per-literal columns, reads probabilities, pins jev-1.13.0"
```

### Task 5: Mock Provider on the shared core helpers

**Files:**
- Modify `packages/gridcue/src/mock/index.ts`

- [ ] **Step 1: Switch the Mock to `matchMentions`, `LITERAL_COLUMN_KINDS` and `unknownTerm`**

```diff
diff --git a/packages/gridcue/src/mock/index.ts b/packages/gridcue/src/mock/index.ts
index 01dfe33..1fc73be 100644
--- a/packages/gridcue/src/mock/index.ts
+++ b/packages/gridcue/src/mock/index.ts
@@ -1,5 +1,6 @@
-import { findMentions } from "../core/text-match";
-import type { CandidateColumn, ClauseResolution, IntentProvider, LiteralKind, Pick, ResolutionRequest, ResolutionResult } from "../index";
+import { LITERAL_COLUMN_KINDS, matchMentions } from "../core/mentions";
+import { unknownTerm } from "../core/terms";
+import type { ClauseResolution, IntentProvider, LiteralKind, Pick, ResolutionRequest, ResolutionResult } from "../index";
 
 export interface MockProviderOptions {
   /** Which column a bare amount refers to, e.g. `{ currency: "market_value" }` for "accounts over $1 million". */
@@ -16,14 +17,6 @@ const UNSUPPORTED: Array<[RegExp, string]> = [
 ];
 
 const NEGATION = /\b(?:without|no|not|non|excluding)\s+(?:any\s+)?$/;
-const KIND_FIT: Record<LiteralKind, CandidateColumn["kind"][]> = {
-  number: ["number", "currency", "percent"],
-  currency: ["currency", "number"],
-  percent: ["percent"],
-  date: ["date", "datetime"],
-  text: ["string"],
-  unreadable: [],
-};
 
 const pick = (id: string, confidence: number): Pick => ({ id, confidence });
 
@@ -48,13 +41,6 @@ const detectFamilies = (clause: Clause, hasValues: boolean): string[] => {
   return [];
 };
 
-const remainderAfterVerb = (text: string): string =>
-  text
-    .replace(/^.*?\b(?:sort(?:ed)?|order(?:ed)?|group(?:ed)?|hide|show|display|filter)\b(?:\s+(?:by|on))?\s*/, "")
-    .replace(/\b(?:largest|biggest|highest|smallest|lowest|newest|oldest)\b.*$|\b(?:ascending|descending|first|column|columns)\b/g, "")
-    .replace(/\bthe\b/g, "")
-    .trim();
-
 /** A deterministic, rule-based Intent Provider for tests, demos, and keyless development. */
 export const createMockProvider = (options: MockProviderOptions = {}): IntentProvider => ({
   async resolve(request: ResolutionRequest): Promise<ResolutionResult> {
@@ -65,21 +51,17 @@ export const createMockProvider = (options: MockProviderOptions = {}): IntentPro
         const unsupported = UNSUPPORTED.find(([re]) => re.test(clause.text));
         if (unsupported) return { ...empty, families: [pick(unsupported[1], 0.95)] };
 
-        const valueEntries = columns.flatMap((c) =>
-          (c.enumValues ?? []).map((v) => ({ item: { columnId: c.id, valueId: v.id }, names: [v.label, ...(v.aliases ?? [])] })),
-        );
-        const valueHits = findMentions(clause.text, valueEntries);
-        const masked = valueHits.reduce((t, h) => t.slice(0, h.start) + " ".repeat(h.end - h.start) + t.slice(h.end), clause.text);
-        const columnHits = findMentions(
-          masked,
-          columns.map((c) => ({ item: c, names: [c.label, ...(c.aliases ?? [])] })),
-        );
-        const booleanHits = columnHits.filter((h) => h.item.kind === "boolean");
+        // The Mock reads names with core's deterministic matcher, context rules included (ADR 0013).
+        const mentions = matchMentions([clause], columns);
+        const byId = new Map(columns.map((c) => [c.id, c]));
+        const valueHits = mentions.filter((m) => m.valueId !== undefined);
+        const columnHits = mentions.filter((m) => m.valueId === undefined);
+        const booleanHits = columnHits.filter((m) => byId.get(m.columnId)?.kind === "boolean");
         const values = [
-          ...valueHits.map((h) => ({ ...h.item, confidence: 0.95 })),
-          ...booleanHits.map((h) => ({
-            columnId: h.item.id,
-            valueId: NEGATION.test(masked.slice(Math.max(0, h.start - 16), h.start)) ? "false" : "true",
+          ...valueHits.map((m) => ({ columnId: m.columnId, valueId: m.valueId ?? "", confidence: 0.95 })),
+          ...booleanHits.map((m) => ({
+            columnId: m.columnId,
+            valueId: NEGATION.test(clause.text.slice(Math.max(0, m.start - 16), m.start)) ? "false" : "true",
             confidence: 0.9,
           })),
         ];
@@ -87,23 +69,23 @@ export const createMockProvider = (options: MockProviderOptions = {}): IntentPro
         const families = detectFamilies(clause, values.length > 0).filter((f) => request.candidates.families.includes(f));
         if (families.length === 0) return empty;
 
-        const picked: Pick[] = columnHits.map((h) => pick(h.item.id, 0.95));
+        const picked: Pick[] = [...new Set(columnHits.map((m) => m.columnId))].map((id) => pick(id, 0.95));
         if (families.includes("filter")) {
           for (const lit of clause.literals) {
-            const fits = KIND_FIT[lit.kind];
-            const referenced = columnHits.some((h) => fits.includes(h.item.kind));
+            const fits = LITERAL_COLUMN_KINDS[lit.kind];
+            const referenced = columnHits.some((m) => fits.includes(byId.get(m.columnId)?.kind ?? "string"));
             const fallback = options.defaultColumnForKind?.[lit.kind];
             if (!referenced && fallback && !picked.some((p) => p.id === fallback)) picked.push(pick(fallback, 0.9));
           }
         }
         const needsColumns = families.some((f) => ["sort", "group", "columns.hide", "columns.show", "columns.only"].includes(f));
-        const unmatched = needsColumns && picked.length === 0 ? [remainderAfterVerb(clause.text)].filter(Boolean) : [];
+        const term = needsColumns && picked.length === 0 ? unknownTerm(clause.text) : undefined;
         return {
           clauseIndex: clause.index,
           families: families.map((f) => pick(f, 0.95)),
           columns: picked,
           values,
-          unmatchedTerms: unmatched,
+          unmatchedTerms: term ? [term] : [],
         };
       }),
     };
```

- [ ] **Step 2: Run the Mock tests and the Mock evals: nothing changes for the existing cases**

```bash
pnpm --filter gridcue exec vitest run test/mock.test.ts
pnpm build && pnpm eval
# Expected: 15 cases: 9 exact, 2 safe abstentions, 4 rejected, 0 mismatch, 0 unsafe
```

- [ ] **Step 3: Commit**

```bash
git add packages/gridcue/src/mock/index.ts
git commit -m "refactor(mock): read names with core's matcher and unknown-term helper"
```

### Task 6: Evals: new cases, live-only cases, Mention fixtures, and --verbose

**Files:**
- Modify `evals/cases.jsonl` (10 new Mock-answerable cases)
- Create `evals/cases-live.jsonl` (56 live-only cases)
- Create `evals/mentions-cases.jsonl` (the 66 labelled requests)
- Create `evals/mentions.test.ts`
- Modify `evals/cli.ts`

- [ ] **Step 1: Add the Mention fixtures and their test**

```diff
diff --git a/evals/mentions-cases.jsonl b/evals/mentions-cases.jsonl
new file mode 100644
index 0000000..0ff3f28
--- /dev/null
+++ b/evals/mentions-cases.jsonl
@@ -0,0 +1,66 @@
+{"set":"dev","utterance":"Show accounts over $1 million.","mentions":[]}
+{"set":"dev","utterance":"Only taxable accounts with concentration above 10%.","mentions":["concentration","registration_type=taxable"]}
+{"set":"dev","utterance":"Group by advisor and sort market value largest first.","mentions":["advisor_name","market_value"]}
+{"set":"dev","utterance":"Hide custodian and account number.","mentions":["account_number","custodian"]}
+{"set":"dev","utterance":"Keep only account, household, market value, and unrealized gain.","mentions":["account_number","household","market_value","unrealized_gain"]}
+{"set":"dev","utterance":"Clear the filters and sorting.","mentions":[]}
+{"set":"dev","utterance":"Only Roth accounts, grouped by rep.","mentions":["advisor_name","registration_type=roth_ira"]}
+{"set":"dev","utterance":"Sort by risk score.","mentions":[]}
+{"set":"dev","utterance":"Market value between $250k and $2 million, sort by unrealized gain.","mentions":["market_value","unrealized_gain"]}
+{"set":"dev","utterance":"Hide account numbers.","mentions":["account_number"]}
+{"set":"dev","utterance":"Sort by unrealized gains, biggest first.","mentions":["unrealized_gain"]}
+{"set":"dev","utterance":"Only IRAs.","mentions":["registration_type=ira"]}
+{"set":"dev","utterance":"Just the Roth IRAs and trusts.","mentions":["registration_type=roth_ira","registration_type=trust"]}
+{"set":"dev","utterance":"Group by custodians.","mentions":["custodian"]}
+{"set":"dev","utterance":"Group accounts by advisor.","mentions":["advisor_name"]}
+{"set":"dev","utterance":"Sort accounts by market value.","mentions":["market_value"]}
+{"set":"dev","utterance":"Group by rep.","mentions":["advisor_name"]}
+{"set":"dev","utterance":"Show only brokerage accounts at Northgate.","mentions":["custodian=northgate","registration_type=taxable"]}
+{"set":"dev","utterance":"Hide the balances.","mentions":["market_value"]}
+{"set":"dev","utterance":"Filter to trusts with restricted holdings.","mentions":["has_restricted_holding","registration_type=trust"]}
+{"set":"dev","utterance":"Show accounts without restricted holdings.","mentions":["has_restricted_holding"]}
+{"set":"dev","utterance":"Sort by acct.","mentions":["account_number"]}
+{"set":"dev","utterance":"Accounts with concentration over 20%, sorted by concentration.","mentions":["concentration"]}
+{"set":"dev","utterance":"Group by registration, then by custodian.","mentions":["custodian","registration_type"]}
+{"set":"dev","utterance":"Only accounts with values above $2M.","mentions":["market_value"]}
+{"set":"dev","utterance":"Sort by value, descending.","mentions":["market_value"]}
+{"set":"dev","utterance":"Hide concentration and gains.","mentions":["concentration","unrealized_gain"]}
+{"set":"dev","utterance":"Keep only the account column and the advisor column.","mentions":["account_number","advisor_name"]}
+{"set":"dev","utterance":"Show Summit Trust accounts.","mentions":["custodian=summit_trust"]}
+{"set":"dev","utterance":"Only trust accounts.","mentions":["registration_type=trust"]}
+{"set":"dev","utterance":"Remove the account type grouping.","mentions":["registration_type"]}
+{"set":"dev","utterance":"Show IRA and Roth accounts over $500k.","mentions":["registration_type=ira","registration_type=roth_ira"]}
+{"set":"dev","utterance":"Sort households by assets.","mentions":["market_value"]}
+{"set":"dev","utterance":"Group by households.","mentions":["household"]}
+{"set":"dev","utterance":"Which advisors have the most restricted accounts? Group by advisor.","mentions":["advisor_name","has_restricted_holding"]}
+{"set":"dev","utterance":"Show the reps' largest positions.","mentions":["advisor_name","concentration"]}
+{"set":"held-out","utterance":"Show balances over $1M.","mentions":["market_value"]}
+{"set":"held-out","utterance":"Sort accounts by balance.","mentions":["market_value"]}
+{"set":"held-out","utterance":"List households with gains above $50k.","mentions":["unrealized_gain"]}
+{"set":"held-out","utterance":"Show only the account and balance columns.","mentions":["account_number","market_value"]}
+{"set":"held-out","utterance":"Filter out trusts.","mentions":["registration_type=trust"]}
+{"set":"held-out","utterance":"Group trusts by custodian.","mentions":["custodian","registration_type=trust"]}
+{"set":"held-out","utterance":"Order by gains descending.","mentions":["unrealized_gain"]}
+{"set":"held-out","utterance":"Sort by account, then by value.","mentions":["account_number","market_value"]}
+{"set":"held-out","utterance":"Hide gains.","mentions":["unrealized_gain"]}
+{"set":"held-out","utterance":"Accounts at Harborline sorted by balance.","mentions":["custodian=harborline","market_value"]}
+{"set":"held-out","utterance":"Only show accounts where concentration is above 25%.","mentions":["concentration"]}
+{"set":"held-out","utterance":"Group by account type.","mentions":["registration_type"]}
+{"set":"held-out","utterance":"Show accounts by household.","mentions":["household"]}
+{"set":"held-out","utterance":"Households over $10M.","mentions":[]}
+{"set":"held-out","utterance":"Show accounts whose largest position exceeds 30%.","mentions":["concentration"]}
+{"set":"held-out","utterance":"Hide the account column.","mentions":["account_number"]}
+{"set":"held-out","utterance":"Sort balances largest first.","mentions":["market_value"]}
+{"set":"held-out","utterance":"Taxable accounts only.","mentions":["registration_type=taxable"]}
+{"set":"held-out","utterance":"Group by advisors.","mentions":["advisor_name"]}
+{"set":"held-out","utterance":"Hide the custodians and reps.","mentions":["advisor_name","custodian"]}
+{"set":"held-out","utterance":"Show IRAs at Northgate.","mentions":["custodian=northgate","registration_type=ira"]}
+{"set":"held-out","utterance":"Accounts with restricted holdings, grouped by advisor.","mentions":["advisor_name","has_restricted_holding"]}
+{"set":"held-out","utterance":"Sort the trusts by market value.","mentions":["market_value","registration_type=trust"]}
+{"set":"held-out","utterance":"Show brokerage accounts over $250k.","mentions":["registration_type=taxable"]}
+{"set":"held-out","utterance":"Keep only accounts, balances, and reps.","mentions":["account_number","advisor_name","market_value"]}
+{"set":"held-out","utterance":"Group households by rep.","mentions":["advisor_name"]}
+{"set":"held-out","utterance":"Roth IRAs with unrealized gains over $100k.","mentions":["registration_type=roth_ira","unrealized_gain"]}
+{"set":"held-out","utterance":"Show assets under $500k.","mentions":["market_value"]}
+{"set":"held-out","utterance":"Sort by registration type, then by custodian.","mentions":["custodian","registration_type"]}
+{"set":"held-out","utterance":"Hide account numbers and households.","mentions":["account_number","household"]}
```

```diff
diff --git a/evals/mentions.test.ts b/evals/mentions.test.ts
new file mode 100644
index 0000000..aa58322
--- /dev/null
+++ b/evals/mentions.test.ts
@@ -0,0 +1,27 @@
+import { readFileSync } from "node:fs";
+import { wealthSchema } from "@gridcue-internal/wealth-fixtures";
+import { isExposed, matchMentions, normalize } from "gridcue";
+import { describe, expect, it } from "vitest";
+
+/**
+ * 66 labelled requests from the context-rule experiment (docs/planning/resolution-quality-grill.md). The held-out
+ * set was labelled before the rules existed. "accounts" meaning the rows is not a Mention of Account number.
+ * Each Mention is "columnId", or "columnId=valueId" for an enum value.
+ */
+const cases = readFileSync(new URL("./mentions-cases.jsonl", import.meta.url), "utf8")
+  .split("\n")
+  .filter((l) => l.trim())
+  .map((l) => JSON.parse(l) as { set: string; utterance: string; mentions: string[] });
+
+const columns = wealthSchema.columns.filter(isExposed);
+
+describe("Mentions on the wealth schema", () => {
+  for (const c of cases) {
+    it(`${c.set}: ${c.utterance}`, () => {
+      const found = matchMentions(normalize(c.utterance).clauses, columns).map((m) =>
+        m.valueId === undefined ? m.columnId : `${m.columnId}=${m.valueId}`,
+      );
+      expect([...new Set(found)].sort()).toEqual(c.mentions);
+    });
+  }
+});
```

- [ ] **Step 2: Add the Mock-answerable cases**

```diff
diff --git a/evals/cases.jsonl b/evals/cases.jsonl
index 47c60ab..360b0ed 100644
--- a/evals/cases.jsonl
+++ b/evals/cases.jsonl
@@ -13,3 +13,13 @@
 {"id":"between-range","utterance":"Market value between $250k and $2 million, sort by unrealized gain.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"market_value","operator":"between","value":{"min":250000,"max":2000000}}},{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"asc"}]}]}}
 {"id":"bare-roth-alias","utterance":"Only Roth accounts, grouped by rep.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"roth_ira"}},{"type":"group.set","columnIds":["advisor_name"]}]}}
 {"id":"reset","utterance":"Reset the view.","expect":{"status":"ready","operations":[{"type":"view.reset"}]}}
+{"id":"plural-hide","utterance":"Hide account numbers and households.","expect":{"status":"ready","operations":[{"type":"columns.hide","columnIds":["account_number","household"]}]}}
+{"id":"plural-group","utterance":"Group by custodians.","expect":{"status":"ready","operations":[{"type":"group.set","columnIds":["custodian"]}]}}
+{"id":"row-noun-before-by","utterance":"Sort accounts by balance.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"asc"}]}]}}
+{"id":"plural-values","utterance":"Show IRAs at Northgate.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"ira"}},{"type":"filter.add","combineWith":"and","predicate":{"columnId":"custodian","operator":"eq","value":"northgate"}}]}}
+{"id":"two-values-one-column","utterance":"Only IRA and Roth accounts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"in","value":["ira","roth_ira"]}}]}}
+{"id":"abbreviated-alias","utterance":"Sort by acct, descending.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"account_number","direction":"desc"}]}]}}
+{"id":"row-noun-with-amount","utterance":"Households over $10M.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"market_value","operator":"gt","value":10000000}}]}}
+{"id":"row-noun-with-qualifier","utterance":"Accounts with restricted holdings, grouped by advisor.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"has_restricted_holding","operator":"eq","value":true}},{"type":"group.set","columnIds":["advisor_name"]}]}}
+{"id":"unknown-group-column","utterance":"Group by region.","expect":{"status":"needs_clarification","clarificationPrompt":"There's no column called “region”. Which column should be grouped by?"}}
+{"id":"column-slot-after-by","utterance":"Sort by value in descending order.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
```

- [ ] **Step 3: Add the live-only cases. Every expectation is the right answer, not the predicted one, so failures are findings**

```diff
diff --git a/evals/cases-live.jsonl b/evals/cases-live.jsonl
new file mode 100644
index 0000000..6ad674a
--- /dev/null
+++ b/evals/cases-live.jsonl
@@ -0,0 +1,56 @@
+{"id":"live-biggest-first","utterance":"Biggest accounts first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"live-retirement","utterance":"Show me the retirement accounts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"in","value":["ira","roth_ira"]}}]}}
+{"id":"live-gains-on-top","utterance":"Put the biggest gains at the top.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"desc"}]}]}}
+{"id":"live-largest-holding","utterance":"Only accounts where the largest single holding is over 25%.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"concentration","operator":"gt","value":0.25}}]}}
+{"id":"live-drop-sorting","utterance":"Drop the sorting.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[]}]}}
+{"id":"live-start-over","utterance":"Start over.","expect":{"status":"ready","operations":[{"type":"view.reset"}]}}
+{"id":"live-remove-column","utterance":"Remove the custodian column.","expect":{"status":"ready","operations":[{"type":"columns.hide","columnIds":["custodian"]}]}}
+{"id":"live-everything-except","utterance":"Hide everything except account and market value.","expect":{"status":"ready","operations":[{"type":"columns.show","columnIds":["account_number","market_value"]},{"type":"columns.hide","columnIds":["household","advisor_name","registration_type","custodian","concentration","unrealized_gain","has_restricted_holding"]},{"type":"columns.order","columnIds":["account_number","market_value"]}]}}
+{"id":"live-clients-amount","utterance":"Clients with more than $5 million.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"market_value","operator":"gt","value":5000000}}]}}
+{"id":"live-how-concentrated","utterance":"Sort by how concentrated the account is.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"concentration","direction":"asc"}]}]}}
+{"id":"live-alias-values","utterance":"Show only non-qualified accounts at Summit Trust.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"taxable"}},{"type":"filter.add","combineWith":"and","predicate":{"columnId":"custodian","operator":"eq","value":"summit_trust"}}]}}
+{"id":"live-who-manages","utterance":"Group by who manages the account.","expect":{"status":"ready","operations":[{"type":"group.set","columnIds":["advisor_name"]}]}}
+{"id":"live-gain-amount","utterance":"Filter to accounts with a gain above $100k.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"unrealized_gain","operator":"gt","value":100000}}]}}
+{"id":"live-near-miss","utterance":"Sort by risk.","expect":{"status":"needs_clarification","clarificationPrompt":"There's no column called “risk”. Which column should be sorted by?"}}
+{"id":"live-no-comma-compound","utterance":"Show accounts over $1M sorted by gain.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"market_value","operator":"gt","value":1000000}},{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"asc"}]}]}}
+{"id":"live-trusts-under","utterance":"Accounts under $250k in trusts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"trust"}},{"type":"filter.add","combineWith":"and","predicate":{"columnId":"market_value","operator":"lt","value":250000}}]}}
+{"id":"h3-each-account-sort","utterance":"Rank each account by its gain, highest first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"desc"}]}]}}
+{"id":"h3-account-owner","utterance":"Group by the advisor on the account.","expect":{"status":"ready","operations":[{"type":"group.set","columnIds":["advisor_name"]}]}}
+{"id":"h3-smallest-accounts","utterance":"Smallest accounts first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"asc"}]}]}}
+{"id":"h3-account-column-hide","utterance":"Hide the account number.","expect":{"status":"ready","operations":[{"type":"columns.hide","columnIds":["account_number"]}]}}
+{"id":"h3-household-name","utterance":"Sort by household name.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"household","direction":"asc"}]}]}}
+{"id":"h3-big-households","utterance":"Largest households first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"h3-accounts-by-custodian","utterance":"Break the accounts down by custodian.","expect":{"status":"ready","operations":[{"type":"group.set","columnIds":["custodian"]}]}}
+{"id":"h3-account-list","utterance":"Show just account, advisor, and gain.","expect":{"status":"ready","operations":[{"type":"columns.show","columnIds":["account_number","advisor_name","unrealized_gain"]},{"type":"columns.hide","columnIds":["household","registration_type","custodian","market_value","concentration","has_restricted_holding"]},{"type":"columns.order","columnIds":["account_number","advisor_name","unrealized_gain"]}]}}
+{"id":"h3-concentrated-accounts","utterance":"Most concentrated accounts first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"concentration","direction":"desc"}]}]}}
+{"id":"h3-trust-accounts-sorted","utterance":"Trust accounts only, sorted by balance.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"trust"}},{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"asc"}]}]}}
+{"id":"h3-restricted-only","utterance":"Only the restricted ones.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"has_restricted_holding","operator":"eq","value":true}}]}}
+{"id":"h3-harborline-accounts","utterance":"Which accounts are at Harborline?","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"custodian","operator":"eq","value":"harborline"}}]}}
+{"id":"h3-account-type-group","utterance":"Group by account type, then by advisor.","expect":{"status":"ready","operations":[{"type":"group.set","columnIds":["registration_type"]},{"type":"group.set","columnIds":["advisor_name"]}]}}
+{"id":"h3-reps-with-roth","utterance":"Roth IRAs grouped by rep.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"roth_ira"}},{"type":"group.set","columnIds":["advisor_name"]}]}}
+{"id":"h3-value-of-account","utterance":"Sort by the value of each account, descending.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"h3-accounts-below","utterance":"Accounts below $100k.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"market_value","operator":"lt","value":100000}}]}}
+{"id":"h3-show-households","utterance":"Show the household column.","expect":{"status":"ready","operations":[{"type":"columns.show","columnIds":["household"]}]}}
+{"id":"h3-oldest-account","utterance":"Sort each account by concentration.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"concentration","direction":"asc"}]}]}}
+{"id":"h3-ira-accounts-show","utterance":"Show IRA accounts.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"ira"}}]}}
+{"id":"h3-accounts-per-advisor","utterance":"Accounts per advisor.","expect":{"status":"ready","operations":[{"type":"group.set","columnIds":["advisor_name"]}]}}
+{"id":"h4-biggest-balance","utterance":"Biggest balance first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"h4-top-households","utterance":"Top households first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"h4-largest-gain","utterance":"Sort by largest gain.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"desc"}]}]}}
+{"id":"h4-newest-accounts","utterance":"Show the accounts with the most concentration first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"concentration","direction":"desc"}]}]}}
+{"id":"h4-hide-account","utterance":"Get rid of the account column.","expect":{"status":"ready","operations":[{"type":"columns.hide","columnIds":["account_number"]}]}}
+{"id":"h4-account-and-rep","utterance":"Only show account and rep.","expect":{"status":"ready","operations":[{"type":"columns.show","columnIds":["account_number","advisor_name"]},{"type":"columns.hide","columnIds":["household","registration_type","custodian","market_value","concentration","unrealized_gain","has_restricted_holding"]},{"type":"columns.order","columnIds":["account_number","advisor_name"]}]}}
+{"id":"h4-households-northgate","utterance":"Households at Northgate.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"custodian","operator":"eq","value":"northgate"}}]}}
+{"id":"h4-lowest-balance","utterance":"Lowest balances first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"asc"}]}]}}
+{"id":"h4-each-household","utterance":"Group each account by household.","expect":{"status":"ready","operations":[{"type":"group.set","columnIds":["household"]}]}}
+{"id":"h4-sort-household","utterance":"Alphabetize by household.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"household","direction":"asc"}]}]}}
+{"id":"h4-biggest-accounts-northgate","utterance":"Biggest Northgate accounts first.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"custodian","operator":"eq","value":"northgate"}},{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"h4-accounts-over-gain","utterance":"Accounts whose gain is over $50k.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"unrealized_gain","operator":"gt","value":50000}}]}}
+{"id":"h4-hide-reps","utterance":"Hide the rep column.","expect":{"status":"ready","operations":[{"type":"columns.hide","columnIds":["advisor_name"]}]}}
+{"id":"h4-account-count","utterance":"Sort by account.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"account_number","direction":"asc"}]}]}}
+{"id":"h4-smallest-positions","utterance":"Least concentrated accounts first.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"concentration","direction":"asc"}]}]}}
+{"id":"h4-taxable-households","utterance":"Just taxable households.","expect":{"status":"ready","operations":[{"type":"filter.add","combineWith":"and","predicate":{"columnId":"registration_type","operator":"eq","value":"taxable"}}]}}
+{"id":"h4-advisor-accounts","utterance":"Group the accounts under each advisor.","expect":{"status":"ready","operations":[{"type":"group.set","columnIds":["advisor_name"]}]}}
+{"id":"h4-highest-value-households","utterance":"Highest value households on top.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"market_value","direction":"desc"}]}]}}
+{"id":"h4-show-account-numbers","utterance":"Show account numbers again.","expect":{"status":"ready","operations":[{"type":"columns.show","columnIds":["account_number"]}]}}
+{"id":"h4-top-accounts-by-gain","utterance":"Top accounts by gain.","expect":{"status":"ready","operations":[{"type":"sort.set","sorts":[{"columnId":"unrealized_gain","direction":"desc"}]}]}}
```

- [ ] **Step 4: Run live-only cases in `eval:live`, and add `--verbose`**

```diff
diff --git a/evals/cli.ts b/evals/cli.ts
index e840f04..f892119 100644
--- a/evals/cli.ts
+++ b/evals/cli.ts
@@ -1,25 +1,91 @@
 import { wealthMockOptions } from "@gridcue-internal/wealth-fixtures";
-import type { IntentProvider } from "gridcue";
+import { TypeSafeClient } from "@typesafe-ai/sdk";
+import type { IntentProvider, ResolutionRequest, ResolutionResult } from "gridcue";
 import { createMockProvider } from "gridcue/mock";
-import { createJevProvider } from "gridcue/server";
+import { createJevProvider, type JevClient } from "gridcue/server";
 import { loadCases, runCase, type Verdict } from "./run";
 
 const live = process.argv.includes("--live");
+const verbose = process.argv.includes("--verbose");
 if (live && !process.env.JEV_API_KEY) {
   console.log("Skipping live evals: JEV_API_KEY is not set.");
   process.exit(0);
 }
-const provider: IntentProvider = live ? createJevProvider({ apiKey: process.env.JEV_API_KEY }) : createMockProvider(wealthMockOptions);
 
-const counts: Record<Verdict, number> = { exact: 0, safe_abstention: 0, rejected: 0, mismatch: 0, unsafe: 0 };
-for (const c of loadCases()) {
-  const { verdict } = await runCase(c, provider);
-  counts[verdict]++;
-  if (verdict === "mismatch" || verdict === "unsafe") console.log(`${verdict.toUpperCase()}: ${c.id}`);
-}
-console.log(`GridCue evals (${live ? "Jev" : "Mock Provider"})`);
-console.table(counts);
+// In verbose mode, count the questions each request sends to Jev.
+let questions = 0;
+const client: JevClient | undefined = live
+  ? (() => {
+      const real = new TypeSafeClient({ apiKey: process.env.JEV_API_KEY, logLevel: "off" });
+      return {
+        systemOne: (req, opts) => {
+          questions = Object.keys(req.questions).length;
+          return real.systemOne(req as never, opts);
+        },
+      } satisfies JevClient;
+    })()
+  : undefined;
+const base: IntentProvider = live ? createJevProvider({ client }) : createMockProvider(wealthMockOptions);
+
+// Records what the provider saw and said, for --verbose.
+let seen: { request?: ResolutionRequest; result?: ResolutionResult } = {};
+const provider: IntentProvider = {
+  async resolve(request, signal) {
+    const result = await base.resolve(request, signal);
+    seen = { request, result };
+    return result;
+  },
+};
+
+const scores = (picks: ReadonlyArray<{ id: string; confidence: number }>) =>
+  picks
+    .filter((p) => p.confidence >= 0.3)
+    .map((p) => `${p.id} ${p.confidence.toFixed(2)}`)
+    .join(", ");
+
+const describe = (ms: number) => {
+  const lines = [`    ${ms} ms${live ? `, ${questions} questions` : ""}`];
+  for (const c of seen.result?.clauses ?? []) {
+    const clause = seen.request?.clauses.find((q) => q.index === c.clauseIndex);
+    const mentions = (clause?.mentions ?? []).map((m) => (m.valueId ? `${m.columnId}=${m.valueId}` : m.columnId)).join(", ");
+    lines.push(`    part ${c.clauseIndex}: “${clause?.text ?? ""}”`);
+    lines.push(`      families [${scores(c.families)}]  columns [${scores(c.columns)}]  mentions [${mentions}]`);
+    if (c.values.length > 0)
+      lines.push(`      values [${scores(c.values.map((v) => ({ id: `${v.columnId}=${v.valueId}`, confidence: v.confidence })))}]`);
+    if (c.literalColumns?.length) {
+      lines.push(
+        `      literals [${scores(c.literalColumns.map((l) => ({ id: `#${l.literalIndex}→${l.columnId}`, confidence: l.confidence })))}]`,
+      );
+    }
+  }
+  return lines.join("\n");
+};
+
+const run = async (file: URL, label: string) => {
+  const counts: Record<Verdict, number> = { exact: 0, safe_abstention: 0, rejected: 0, mismatch: 0, unsafe: 0 };
+  for (const c of loadCases(file)) {
+    seen = {};
+    const started = Date.now();
+    const { verdict, plan, status } = await runCase(c, provider);
+    counts[verdict]++;
+    if (verbose) {
+      console.log(`${verdict.padEnd(15)} ${c.id}`);
+      console.log(describe(Date.now() - started));
+      if (verdict === "mismatch" || verdict === "unsafe")
+        console.log(`    got ${status}: ${plan?.clarifications.map((q) => q.prompt).join(" | ") || JSON.stringify(plan?.operations)}`);
+    } else if (verdict === "mismatch" || verdict === "unsafe") {
+      console.log(`${verdict.toUpperCase()}: ${c.id}`);
+    }
+  }
+  console.log(`GridCue evals: ${label} (${live ? "Jev" : "Mock Provider"})`);
+  console.table(counts);
+  return counts;
+};
+
+const core = await run(new URL("./cases.jsonl", import.meta.url), "cases.jsonl");
+// Live-only cases need common sense the Mock doesn't have. They are findings, with no pass bar, except that none may be unsafe.
+const extra = live ? await run(new URL("./cases-live.jsonl", import.meta.url), "cases-live.jsonl") : undefined;
 
 // Applying a view the user did not ask for is release-blocking with any provider.
 // With the Mock Provider every case must match exactly, because its answers are deterministic.
-if (counts.unsafe > 0 || (!live && counts.mismatch > 0)) process.exit(1);
+if (core.unsafe > 0 || (extra?.unsafe ?? 0) > 0 || (!live && core.mismatch > 0)) process.exit(1);
```

- [ ] **Step 5: Run the evals project and the Mock evals**

```bash
pnpm build && pnpm exec vitest run --project evals && pnpm eval
# Expected: 91 passed; 25 cases: 18 exact, 3 safe abstentions, 4 rejected, 0 mismatch, 0 unsafe
```

- [ ] **Step 6: Commit**

```bash
git add evals
git commit -m "test(evals): Mention fixtures, 10 Mock cases, 56 live-only cases, and --verbose"
```

### Task 7: Docs

**Files:**
- Modify `CONTEXT.md`
- Modify `docs/adr/0012-operation-family-precedence.md`
- Modify `docs/adr/0013-deterministic-mentions-and-literal-columns.md`
- Modify `docs/internals/intent-protocol.md`
- Modify `docs/internals/product.md`
- Modify `docs/planning/handoff-2026-09-24.md`

- [ ] **Step 1: Apply the doc changes**

```diff
diff --git a/CONTEXT.md b/CONTEXT.md
index 660e0e0..4c6bff7 100644
--- a/CONTEXT.md
+++ b/CONTEXT.md
@@ -28,6 +28,10 @@ _Avoid_: Step, sub-request, segment
 The kind of change a Clause asks for, such as filter, sort, show only some columns, or reset the view. An Intent Provider scores each family; the compiler decides which ones are used.
 _Avoid_: Intent, action type, command
 
+**Mention**:
+A column or enum value a Clause names by one of the Host's declared labels or aliases, found by deterministic code before any provider call. A name used for the rows themselves, as in "biggest accounts first", is not a Mention.
+_Avoid_: Match, hit, reference
+
 **Clarification**:
 A single focused question GridCue asks when a request cannot be resolved without a choice only the User can make.
 _Avoid_: Follow-up, disambiguation prompt
diff --git a/docs/adr/0012-operation-family-precedence.md b/docs/adr/0012-operation-family-precedence.md
index b76b50e..7c6d350 100644
--- a/docs/adr/0012-operation-family-precedence.md
+++ b/docs/adr/0012-operation-family-precedence.md
@@ -4,6 +4,7 @@ A provider scores every Operation Family on its own, so several can come back hi
 
 The compiler now applies fixed rules before it builds operations, in this order:
 
+0. **Something to act on.** A family with nothing to act on yields to one that has something. "Show" with no column named gives way to "filter" when the part names values, as in "Show IRAs at Northgate". This rule was added while verifying the plan.
 1. **Confident beats middling.** Once any view family is at or above `ready`, middle-band view families are dropped instead of asked about.
 2. **Show-only absorbs show and hide.**
 3. **Reset versus the clears.** Reset wins only when its score is higher than every accepted clear. Otherwise the explicit clears win. A User's confirmation counts as 1.
@@ -12,6 +13,8 @@ The compiler now applies fixed rules before it builds operations, in this order:
 
 Each dropped family is recorded in the plan's evidence with source `deterministic`, so the audit trail says why it was not applied.
 
+Separately, **a value the User named is never silently ignored.** If a part names an enum value but ends up with no filter, as in "Roth IRAs grouped by rep", GridCue asks the User to split it instead of grouping and dropping "Roth IRA". This was the only wrong view left in 81 live requests before it was added.
+
 We chose this over asking Jev a single Choice for the Clause's main family (grill Q1, option b). The rules work the same for every provider, including the Mock and third-party ones. They change no provider questions, and each one is a unit test. Dropping a family never applies anything the User can't see: the Preview shows exactly what will change, and nothing applies without approval.
 
 The margin (0.10) is a compiler constant, not a Host setting. It exists because Jev's scores move between runs: "Show accounts over $1 million" gave show-columns 0.85 in one run and 0.83 in the next, so a rule that depended on `ready` alone would flip. Revisit it, and option b, when the larger eval set shows a family being dropped that Users meant.
diff --git a/docs/adr/0013-deterministic-mentions-and-literal-columns.md b/docs/adr/0013-deterministic-mentions-and-literal-columns.md
index 25f8b51..4e9c80d 100644
--- a/docs/adr/0013-deterministic-mentions-and-literal-columns.md
+++ b/docs/adr/0013-deterministic-mentions-and-literal-columns.md
@@ -1,8 +1,43 @@
 # Deterministic Mentions, literal columns, and a pinned Jev model
 
-**Mentions.** Before the provider call, core matches the Host's declared column labels and aliases, and enum value labels and aliases, as whole words in each Clause. Plurals match. A column-name match that sits where the rows go is not a column reference: directly after another matched name ("Roth accounts"), before a qualifier ("accounts with …"), before "by" ("sort households by assets"), or before a comparison with a literal its kind can't hold ("accounts over $1M", where Account number is text). A name that matches more than one column or value is left to the provider. A Mention counts as confidence 1 with source `deterministic`, and it overrides the provider's score for that column or value.
+**Mentions.** Before the provider call, core matches the Host's declared column labels and aliases, and enum value labels and aliases, as whole words in each Clause. Plurals match. A name that matches more than one column or value is left to the provider.
 
-This follows the architecture's rule that deterministic code owns parsing. Live, Jev scored the declared alias "rep" at 0.83 and missed "Summit Trust" (0.03) and a second value in "IRA and Roth accounts" (0.06), because one single-answer Choice per column can't return two values. The context rules were tested on a 36-request dev set and a 30-request held-out set written before the rules. They gave 0 wrong and 0 missed matches, where matching plurals without context read "accounts" as the Account number column 25 times. Restricted-column screening keeps matching every form, with no context rules, so it errs toward refusing.
+A column-name match that sits where the rows go is not a column reference. That means a match:
+
+- directly after another matched name ("Roth accounts");
+- before a qualifier ("accounts with …");
+- before "by" ("sort households by assets");
+- before a comparison with a literal its kind can't hold ("accounts over $1M", where Account number is text), or with no literal at all, where the word is a preposition ("accounts under each advisor");
+- directly after a superlative, unless the column is yes/no ("biggest accounts first"; but "the most restricted accounts" still names Restricted holdings).
+
+A match directly after "by" or "on", or directly before "column", is always a column.
+
+**The rules lean toward "the rows" on purpose.** A name wrongly read as the rows falls back to the provider, which usually gets it or asks. A name wrongly read as a column overrides the provider and proposes a wrong view.
+
+**Two signals for columns.** A named value counts as confidence 1 with source `deterministic`. A named column does too, unless the provider scores that column below **0.40**, in which case it is dropped. So the provider is still asked about named columns.
+
+The grammar rules and the provider fail on different requests:
+
+- In "Biggest accounts first", "Group by who manages the account" and "Sort by how concentrated the account is", no grammar rule fired. Jev scored Account number 0.02 to 0.05.
+- On the labelled requests, Jev scored every real column mention at 0.46 or higher. Every row-noun hit the grammar missed scored 0.36 or lower.
+
+The 0.40 floor is a compiler constant.
+
+This follows the architecture's rule that deterministic code owns parsing. Live, Jev scored the declared alias "rep" at 0.83. It missed "Summit Trust" (0.03), and missed the second value in "IRA and Roth accounts" (0.06), because one single-answer Choice per column can't return two values.
+
+Every rule was tested on requests written and labelled before that rule existed:
+
+| Set | Size | Rules it tested |
+| --- | --- | --- |
+| Dev | 36 | none (the rules were written from it) |
+| Held-out 1 | 30 | the grammar rules, on the matcher alone |
+| Held-out 2 | 16 | the grammar rules live |
+| Held-out 3 | 20 | the provider floor |
+| Held-out 4 | 20 | the superlative rule |
+
+Each held-out set found problems the earlier ones hid. A third run of the full live set then found "Group the accounts under each advisor", which led to the comparison-word rule. After that, two consecutive verbose runs of the 81 live requests produced no wrong view. Matching plurals without context had read "accounts" as the Account number column 25 times.
+
+Restricted-column screening keeps matching every form, with no context rules, so it errs toward refusing.
 
 **Literal columns.** The Jev provider asks one Choice per literal ("$1 million") over the columns whose kind fits, plus `none`. The compiler uses the pick through the usual confidence bands. Before this, a literal went to the first confident column that fit, and "Show accounts over $1 million" named no column at all.
 
diff --git a/docs/internals/intent-protocol.md b/docs/internals/intent-protocol.md
index b40a532..9c4f1ab 100644
--- a/docs/internals/intent-protocol.md
+++ b/docs/internals/intent-protocol.md
@@ -324,6 +324,11 @@ Every candidate set includes an explicit escape such as `none`, `ambiguous`, or
 
 The concrete contract lives in `packages/gridcue/src/core/resolution.ts`. A `ResolutionRequest` carries the normalized clauses and their literals, the closed candidate families and columns, and a summary of the current view. It never carries rows, restricted columns, or enum values the Host did not approve. A `ResolutionResult` returns, per clause, the families it asks for, the columns it mentions in order, any enum or boolean values, an optional sort direction, and phrases that matched no column. Every pick carries a confidence between 0 and 1.
 
+Two optional fields were added within 0.1 (ADR 0013). Providers that ignore them behave as before:
+
+- `ResolutionRequest.clauses[].mentions`: `{ columnId, valueId? }[]`. These are the columns and enum values core already matched by a Host-declared name. A provider may skip asking about a named value. It should still score a named column, because the compiler drops a named column that the provider scores below 0.40.
+- `ClauseResolution.literalColumns`: `{ literalIndex, columnId, confidence }[]`. This is the column each literal applies to, with `literalIndex` being the literal's position in `clauses[].literals`.
+
 ## Versioning
 
 - Additive optional fields may remain within protocol `0.1` during pre-release development.
diff --git a/docs/internals/product.md b/docs/internals/product.md
index c7d7ff0..37d4c9a 100644
--- a/docs/internals/product.md
+++ b/docs/internals/product.md
@@ -126,6 +126,20 @@ Suggested initial bands, to be tuned with eval evidence:
 
 The host may set stricter bands. Auto-apply is off in the MVP regardless of confidence.
 
+The defaults are `ready` 0.85 and `clarify` 0.65. They are unchanged since the first live run and need an ADR to change. Around them, the compiler applies fixed rules:
+
+- **Competing families** (ADR 0012).
+  - A family with nothing to act on yields to one that has something.
+  - A confident family drops middling ones.
+  - Show-only absorbs show and hide.
+  - Reset and the clears: the higher score wins.
+  - A lead of at least 0.10 decides between column families.
+  - Otherwise, GridCue asks the User to split the part.
+- **Host-declared names** (ADR 0013).
+  - A column or value named by a declared label or alias counts as confidence 1.
+  - This does not apply when the name sits where the rows go, or when the provider scores the column below 0.40.
+  - A named value is never silently ignored.
+
 ## Domain examples
 
 | User request | Expected interpretation |
diff --git a/docs/planning/handoff-2026-09-24.md b/docs/planning/handoff-2026-09-24.md
index 2003f90..7403788 100644
--- a/docs/planning/handoff-2026-09-24.md
+++ b/docs/planning/handoff-2026-09-24.md
@@ -26,26 +26,23 @@ This is where the first build stopped, and what comes next. It covers the work i
 
 ## Next steps, in order
 
-1. **Run live Jev evals.** The environment now has the rotated `JEV_API_KEY` and allows `api.typesafe.ai` and `docs.typesafe.ai`. In a new cloud session, run:
-   ```bash
-   NODE_USE_ENV_PROXY=1 pnpm test:live
-   NODE_USE_ENV_PROXY=1 pnpm eval:live
-   ```
-   Node's built-in `fetch` ignores the cloud proxy without that flag.
-
-   **First live run, 2026-09-24:** `pnpm test:live` passes. `pnpm eval:live` gives 4 exact, 1 safe abstention, 4 rejected, 6 mismatch, and **0 unsafe**. Every mismatch asked a question instead of applying; none applied a wrong view. Each step costs 27 questions on the wealth schema, and the median call takes 207 ms (range 160 to 601 ms).
-
-   The mismatches have three causes:
-   - **Jev says yes to more than one kind of change.** Jev asks one yes/no question per family, and several can come back yes at once.
-     - "Show accounts over $1 million": filter 0.97 and show-columns 0.85, so GridCue asks the User to split the request.
-     - "Keep only account, household, …": show-only 0.97, hide 0.89 and show 0.70.
-     - "Clear the filters and sorting": both clears 0.99, plus reset 0.78.
-     - "Reset the view": reset 0.96, plus clear-filters 0.84.
-
-     The compiler needs rules for which family wins. Show-only already covers show and hide. Reset covers the clears, but explicit clears should win over a weaker reset. Alternatively, Jev could ask a Choice for the step's main kind of change. That changes confirmation behaviour, so write an ADR first.
-   - **Column aliases land in the middle band.** "Only Roth accounts, grouped by rep" gives Registration type 0.78 and Advisor 0.73, so GridCue asks about both. Set `ready` from more live cases than these 15; any change to the confidence defaults needs an ADR.
-   - **No unknown-term detection.** Jev always returns `unmatchedTerms: []`. "Sort by risk score" therefore asks "Which column should be sorted by?" instead of saying there is no "risk score" column. That is still safe, but less helpful.
-2. **Extend the question budget.** Most questions are one yes/no per column, repeated for every step, so 27 questions per step on 9 columns allows about 3 steps within `maxQuestions` 96. Asking about the change type first, then only the columns that type needs, should cut the count a lot, at the cost of a second call. Measure it with `pnpm eval:live`. A literal goes to the first of several confident candidate columns; revisit that at the same time.
+1. **Done: resolution quality (steps 1 and 2 of the first handoff).** Spec `docs/superpowers/specs/2026-09-24-resolution-quality-design.md`, plan `docs/superpowers/plans/2026-09-24-resolution-quality.md`, and ADRs 0012 and 0013.
+   - The six first-run mismatches are fixed.
+   - 81 live requests produce no wrong view. The set is the 25 core cases plus 56 live-only cases, most written before the rule they tested.
+   - The question cap is 600, and the model is pinned to `jev-1.13.0`.
+   - `pnpm eval:live -- --verbose` shows each case's scores.
+
+   **Findings for the confidence-defaults ADR and later work.** These are the live-only mismatches, all of which ask instead of applying:
+   - **Middling families where a person would act.**
+     - "Rank each account by its gain" gave sort 0.73.
+     - "Show IRAs at Northgate" and "Which accounts are at Harborline?" gave filter 0.80 to 0.82.
+     - "Get rid of the account column" gave hide 0.69.
+     - "Remove the custodian column" scored no family at all.
+     - Sets the evidence for lowering `ready`, or rewording the family questions. Either needs an ADR.
+   - **Two values of one column that aren't Host-declared names.** "Show me the retirement accounts" means IRA and Roth IRA. One single-answer Choice per column can't return both. The docs' pattern is one Noul per value.
+   - **Compound requests without a comma.** "Show accounts over $1M sorted by gain" stays one part. Normalizer candidate: split before "sorted by", "grouped by" or "ordered by".
+   - **Row nouns that are also columns** ("households at Northgate", "top households first") ask "Did you mean Household?". That is safe, but noisy.
+2. **Extend the question budget.** Done in step 1: one call, a higher cap, and no questions for named values. A second call was rejected, because Jev prices per token and answers batched questions in parallel.
 3. **Publish to npm.**
    - Confirm `gridcue` is still free on npm (ADR 0004 asks for a re-check).
    - Choose `0.1.0`.
```

- [ ] **Step 2: Commit**

```bash
git add CONTEXT.md docs
git commit -m "docs: record the verified resolution rules, protocol fields, and live findings"
```

### Task 8: Gate and live acceptance

**Files:**

- [ ] **Step 1: Run the full gate from a clean frozen install**

```bash
pnpm install --frozen-lockfile && pnpm check
# Expected: exit 0; 325 passed, 1 skipped (the live Jev test)
```

- [ ] **Step 2: Run the live evals twice, verbose, and check for wrong views**

```bash
pnpm eval:live -- --verbose > /tmp/live-1.txt; pnpm eval:live -- --verbose > /tmp/live-2.txt
grep -c '    got ready' /tmp/live-1.txt /tmp/live-2.txt
# Expected, both runs: cases.jsonl 17 exact, 3 safe, 4 rejected, 1 mismatch (plural-values, which asks), 0 unsafe;
# cases-live.jsonl 0 unsafe; 0 "got ready" lines, meaning no wrong view was proposed
```

- [ ] **Step 3: Run the live test**

```bash
pnpm test:live
# Expected: 1 passed
```

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "chore: resolution quality passes the gate and two live runs"
```

## Spec coverage

| Spec section | Task |
| --- | --- |
| 4, 5.1 Family precedence and margin | 2 |
| 5.2 Mentions | 1, 2, 3 |
| 5.3 Literal targets | 2, 4 |
| 5.4 Unknown terms | 1, 2, 5 |
| 5.5 Jev provider | 4 |
| 5.6 Copy | 2, 3 |
| 6 Protocol changes | 2, 7 |
| 7 Evals | 6 |
| 8 Testing | 1 to 6 |
| 9 Acceptance criteria | 8 |
