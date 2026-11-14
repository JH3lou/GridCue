# Finishing the operation set: design spec

Status: approved by the owner on 2026-11-13. Answers in docs/planning/operation-set-grill.md.

**Date:** 2026-11-13
**Scope:** grill answers Q1 to Q8 in `docs/planning/operation-set-grill.md`, as the owner approved them on 2026-11-13: decisions D7, D8 and D18 to D22 in section 7 of `docs/superpowers/plans/2026-11-13-five-opportunities-order.md`, with D1 to D5 where they reach this work.
**Plan:** `docs/superpowers/plans/2026-11-13-operation-set.md`

This is the current best design. Every mechanism below has an evidence bar in section 10, fixed before any code. A mechanism that misses its bar is reworked or removed; the bar does not move.

## 1. Purpose

The protocol already holds pins, totals, density and a count. The validator and the Preview know them. But no request can reach the first three, no shipped adapter draws them, and a count works only in the Rows Adapter. This work makes each one reachable, safe, and the same in both Grid Adapters:

1. **A count follows its rows.** A count never quietly changes meaning when the sort or the filters change, and an empty value is never in "the top 10".
2. **Pinning and density.** "Pin account number", "compact view".
3. **Totals.** "Total market value by advisor", and "largest households first" can rank households by their total.
4. **Counts on TanStack Table.** "Top 10" shows ten rows there too.

Success means:

- 0 wrong views on every labelled set, old and new;
- each reading rule meets its bar in section 10 on cases labelled before the rule exists;
- for the same View State and rows, both adapters show the same rows, in the same order, with the same totals. The one exception is where a row with no value in a sorted column sits (section 3, Out);
- nothing that is exact today stops being exact, except the one group order change in section 5.4, which ADR 0030 and the changelog name.

This is opportunity 2 of the five the owner put before the four bets on 2026-11-13. It is designed on today's code, where every request goes through an Intent Provider. Section 15 says where it meets the four bets.

## 2. Decisions this spec builds on

| Decision | Source |
| --- | --- |
| Code reads a small, closed set of words for each new operation. Columns come only from Mentions. The provider's choices and Jev's questions do not change; the protocol stays 0.1 | Grill Q1, D8, ADR 0028 |
| Totals are sums and averages only. The column's kind picks which | Grill Q2, D20, ADR 0030 |
| One group order for both adapters: a total ranks groups, otherwise groups keep the order they first appear in. "Largest households first" gains a third choice | Grill Q3, D21, ADR 0030 |
| Counts on TanStack through a piece the Host registers, if a spike shows it can match the Rows Adapter exactly. Never on a manual table | Grill Q4, D22, ADR 0027 |
| A change to the sort or the filters of a view with a count asks. An empty value never fills a count | Grill Q5, D7, ADR 0027 |
| Two gates: columns may pin and total by default; each adapter lists pinning, density and totals only when the Host's `renders` says its table draws them | Grill Q6, D18, ADR 0029 |
| A grid that can't do something says so in a question with no choices, and nothing applies | D3, ADR 0029 |
| Narrow words for pinning and density | Grill Q7, D19, ADR 0028 |
| One spec, one plan, four PRs in order, placed among the other opportunities' PRs by the order plan | Grill Q8, D1 |
| The edits to approved documents are approved once. The PR that lands each piece makes its edit (section 11) | D2 |
| A wrong view the natural set finds from a word nothing reads still fails the bar, and is narrowed to a question (section 10) | D4 |
| **Count** is the glossary term for "top 10" (section 8) | D5 |
| A ready plan uses everything it read | ADR 0019 |
| A provider's proposal is checked against the request's words | ADR 0022 |

D numbers are the decisions in section 7 of the order plan (`docs/superpowers/plans/2026-11-13-five-opportunities-order.md`). That plan also says where each PR here sits among the other opportunities' PRs.

## 3. Scope

### In

- **PR 1, the count fix:** the count question, count-clearing words, and empty values in a count, in core and the Rows Adapter (5.1, 5.2).
- **PR 2, pinning and density:** their words, validation, the reducer fix, both adapters, the `renders` option, and the contract suite extended (5.2, 5.3).
- **PR 3, totals and one group order:** their words, validation, `applyView` totals, TanStack totals, the group order, the third choice, and a rendered-rows test both adapters share (5.2, 5.4).
- **PR 4, counts on TanStack Table:** a spike, then the registered piece and the adapter's `limit.set` (5.5).
- ADRs 0027 to 0030.

### Out

- **Min, max and count totals.** "How many accounts per advisor" stays a question; the grid already shows each group's row count.
- **The same ten rows in a new order.** The View State can't hold a count tied to one sort and a display order from another, so GridCue asks instead.
- **Pinning rows.** "Pin … to my watchlist" stays a refused workflow action.
- **Relative density words** ("denser", "tighter") and broad pin synonyms ("lock", "stick").
- **"10 largest accounts"** and other counts not written as ADR 0018's "top 10". They stay questions.
- **A total at each nesting level in `applyView`.** It keeps one group per full key, as today. TanStack draws its own nested levels.
- **Where a row with no value sits in a sort.** The adapters differ (grill, "Empty values in a descending sort"). A count never keeps such a row for its first sorted column (5.1). Anywhere else it changes order, not which rows show, and is left to its own change.
- **Skipping the provider call when code reads every Clause.** That is the Local Resolver's job (four bets 5.4). Calls happen as today.
- **How Preview notes look.** Both UIs already show `Preview.notes` on this branch (commit `469cc75`). Their look belongs to the command bar opportunity.
- Any change to the confidence defaults, the resolution protocol, or Jev's questions.

## 4. Shared pieces

### 4.1 View words (PR 1, grown in PR 2 and PR 3)

A new pure module, `core/view-words.ts`, reads a Clause's words against closed forms:

```ts
readViewWords(clause, mentions, schema): ViewWordsReading | undefined
// { operations: ViewOperation[]; spans: Array<{ start: number; end: number; kind: "verb" | "column" | "count" | "density" | "position" }> }
```

- **Closed.** A Clause is read only when every word is a form word, a Mention of a column, or a filler word the form allows ("the", "column", "columns"). One word left over and it returns `undefined`, and the Clause goes to the provider exactly as today.
- **Columns come only from Mentions,** never from a provider's pick. A Row Noun or an entity word is not a column here.
- **The compiler calls it first** for each Clause. When it reads, its operations are used and the provider's families for that Clause are ignored. When it doesn't, nothing changes.
- **It is not stored on the Clause.** `buildResolutionRequest` spreads the whole Clause into the provider request (`resolution.ts:186-192`), so a new Clause field would change the payload. A test pins the provider payload for every labelled request to today's. PR 1 adds that pin test, and the other opportunities reuse it (order plan).
- **One set of words.** Named filters' placed-words check (`core/placed.ts`) imports these form words rather than listing them again.
- **Spans index the Clause text,** so the four bets' positions (four bets 4.1) can map them to the User's own text later.
- **ADR 0019 holds:** a read form uses every word, so nothing read is left unused.
- **A part that starts with a refused verb** ("sell", "export") never reaches this module; the refusal runs first, as today.

### 4.2 The `renders` option (PR 2, grown in PR 3 and PR 4)

Both adapters are headless. GridCue writes the View State; the Host's table draws it. So each adapter lists `columns.pin`, `density.set` and `aggregation.set` only when the Host says its table draws them:

```ts
createRowsAdapter({ schema, renders: ["pinning", "density", "totals"] });
createTanStackAdapter({ schema, table, renders: ["pinning", "density", "totals", "count"] });
```

- The default is none. With none, the capabilities are exactly today's, and a request for one of them ends in a question with no choices: "This grid can't pin columns." Nothing in the request applies. This is the same result more grids builds first for grouping (its 5.3), from one shared piece of code, so every "this grid can't" reads and behaves alike. It is not an Unsupported Segment: `CONTEXT.md` keeps that term for requests outside the view-only rule, and the Controller's message for one says "GridCue only changes how the table looks", which would be untrue here. The other way was a new unsupported category in the protocol, which would have needed an ADR. The owner approved the question (order plan, D3).
- The Rows Adapter keeps listing `limit.set` with no option, because `applyView` drops the rows itself.
- On TanStack, `"pinning"` needs `setColumnPinning` on the table, `"totals"` needs `gridcueAggregationFn` registered, and `"count"` needs PR 4's piece registered. Where the adapter can see a missing piece, `createTanStackAdapter` throws `INPUT_CONFIG` naming it. Where it can't, the docs say so.

### 4.3 Column defaults (PR 2 and PR 3)

- `DEFAULT_CAPABILITIES` gains `"pin"` (PR 2).
- `defineSchema` adds `"aggregate"` to number, currency and percent columns (PR 3). A restricted column still gets none.
- A Host's `capabilities` override still replaces the defaults, as today.

### 4.4 Validation (each PR adds its own)

| Plan | Today | After | PR |
| --- | --- | --- | --- |
| Pin the same column twice | `start: [a, a]` | One entry. The reducer removes a column from both lists before it adds it | 2 |
| Pin a column to the end that is pinned to the start | Moves it | Moves it (unchanged) | 2 |
| Pin a hidden column | Passes, nothing shows | The compiler adds "Show X" before the pin, so the Preview says both. Validation still accepts a hidden pinned column, so hiding one later keeps its pin | 2 |
| A sum on a text, enum, date or percent column | Passes | `PLAN_AGGREGATION_KIND`: "Concentration can't be totalled; try an average." | 3 |
| An average on a text, enum or date column | Passes | `PLAN_AGGREGATION_KIND` | 3 |
| The same column and function twice | Passes | `PLAN_INCONSISTENT_STATE` | 3 |
| Min, max or count | Passes where listed | Still valid in the protocol; no request produces them, and the adapters apply only sum and average. `PLAN_AGGREGATION_KIND` on an adapter that doesn't apply them | 3 |

`docs/internals/intent-protocol.md` promises an "incompatible grouping/aggregation" check. These rows are that check.

### 4.5 Preview, diff and audit

| Operation | Preview line today | After | PR |
| --- | --- | --- | --- |
| `columns.pin` start | "Pin Account number to the start" | Unchanged | — |
| `columns.pin` end | "Pin Account number to the end" | Unchanged | — |
| `columns.pin` none | "Unpin Account number" | Unchanged; "Unpin all columns" when it names every pinned column | 2 |
| `density.set` | "Use compact density" | Unchanged | — |
| `aggregation.set` | "Summarize Market value (sum)" | "Show the total of Market value", "Show the average of Concentration", "Remove the totals". "Summarize" goes, since `CONTEXT.md` avoids "summary" | 3 |
| `limit.set` | "Show only the first 10 rows", "Show every row" | Unchanged | — |

- `diffViews` gains `pinsChanged`, `densityChanged` (PR 2), `totalsChanged` (PR 3) and `countChanged` (PR 1).
- The audit's structure lists the columns of `aggregation.set` (PR 3). Values are still never included.
- Named filters' PR 2 adds a test that pins every Preview line the evals produce (order plan). PR 3 updates it for the totals wording and lists each line that changed.

## 5. Units

### 5.1 A count follows its rows (PR 1)

| Request, after "top 10 accounts by market value" | Today | After |
| --- | --- | --- |
| "sort by advisor" | Ready: "Sort by Advisor, ascending"; still 10 rows, a different ten | Asks: "Keep only the first 10 rows of the new view, or show every row?" with "Keep the first 10" and "Show every row" |
| "clear the sort" | Ready; ten rows in no order | Asks, the same question |
| "only the taxable ones", "accounts over $1m", "clear the filters" | Ready, one filter line; still 10 rows, maybe ten different ones | Asks, the same question |
| "group by advisor", "hide custodian" | Ready; count kept | Unchanged: they don't change which rows the count keeps |
| "top 5 by gain" | Ready: sort and count 5 | Unchanged: the plan sets its own count |
| "show every row", "show all rows", "remove the count" | Asked | Ready: "Show every row" |
| "show only the first 5 rows" (view has a sort) | Asked | Ready: "Show only the first 5 rows" |
| "show only the first 5 rows" (view has no sort) | Asked | Asked: "First 5 by which column?" |
| "show all accounts" (view has a filter and a count) | Asked what to filter on | Asks: "Show every row, or clear the filters too?" |
| "reset the view" | Ready; count gone | Unchanged |

- **The rule.** A ready plan, on a view with a count, that changes or clears the sort, or adds, replaces or clears a filter, and sets no count of its own, becomes a question. "Keep the first 10" adds `limit.set` with the same count, so the Preview says it; "Show every row" adds `limit.set` with `null`.
- **The question is asked by core, after compiling,** right after ADR 0019's check, so it protects every provider.
- **The rule is about a plan and the view it applies to,** not about the request's words. So it also holds where a plan is made without compiling: a Preview the User edits, and a View Part the User removes (command bar 5.1 and 5.4). Neither may change which rows a count keeps without the Preview saying so. A plan from `proposeView` for a saved view is exempt, because its target view states its count in full.
- **A grid that keeps no count.** A request that only sets a count ("show only the first 5 rows"), on a grid that doesn't list `limit.set`, ends in a question with no choices, "This grid can't show only the first 5 rows.", and nothing applies (D3). "Top 10" there still sorts alone with the note (ADR 0018). "Show every row" on a view with no count is treated as any clear of something the view doesn't have is treated today, on every adapter.
- **Empty values.** In `applyView`, a row with no value in the first sorted column never fills a count. "Top 10" on a column where only 7 rows have a value shows 7. Today, in a descending sort, rows with no value come first and fill the count.
- **Counts read in core** are the existing ones (ADR 0018) plus the count-clearing words and "show only the first N rows", which are the Preview's own lines. Both are view words (4.1).

### 5.2 The words (PR 1 to PR 3)

| Form | Reads | Doesn't read (goes to the provider, as today) |
| --- | --- | --- |
| Count clear | "show every row", "show all rows", "remove the count", "no count" | "show all accounts" with a Row Noun (5.1 asks); "remove the limit" |
| Count | "show only the first N rows", "only the first N rows" | "10 largest accounts", "the first ten" |
| Pin | "pin X", "pin X and Y", "pin the X column", "pin X to the start/left", "pin X to the end/right", "freeze the X column" | "freeze X" without "column", "lock X", "pin X to my watchlist", "pin the Northgate accounts" (a value, not a column) |
| Unpin | "unpin X", "unpin all columns", "unpin all", "unpin everything" | "unfreeze" |
| Density | "compact", "comfortable" or "spacious" directly before "view", "rows", "density" or "mode"; "use compact density" | "denser", "tighter", "make it compact", "compact exceptions view" |
| Total | "total X", "sum of X", "show the total of X", "show total X" (X a number or currency column) | "how much does each advisor manage", "X totals" |
| Average | "average X", "show the average of X" (X a number, currency or percent column) | "mean X", "avg X" |
| Total by | "total X by Y", "average X by Y" (Y a column that can group) | "total X per Y" until the held-out set shows "per" is certain |
| Clear totals | "remove the totals", "clear the totals", "no totals" | "hide the totals" (could mean columns) |

- "Left" and "right" pin to the start and the end. The docs say this assumes a left-to-right grid.
- A form word that is also a declared label or alias of the Host ("Pin code", "Compact") is a Mention first, so the form doesn't read; the provider gets the Clause, as today.
- "Compact exceptions view" still asks, about the whole part, as the product doc's own example. If the Host declares "exceptions" as a value, "show exceptions, compact view" reads.
- The exact word lists are settled by the dev set and the held-out set (section 10), not by this table. A word moves from the right column to the left only on held-out evidence.

### 5.3 Pinning and density (PR 2)

| Request | Today, both adapters | After, with `renders` | After, without |
| --- | --- | --- | --- |
| "pin account number" | Asked: "I'm not sure what to change…" | Ready: "Pin Account number to the start" | Asked, no choices: "This grid can't pin columns." |
| "pin the account number column to the left" | Asked | Ready, same line | The same |
| "pin market value to the right" | Asked | Ready: "Pin Market value to the end" | The same |
| "freeze the account column" | Asked | Ready: "Pin Account number to the start", only if today's Mention rules place "account" as the column. In the wealth schema "account" is both the Row Noun and an alias of Account number; if it isn't placed, it asks | "This grid can't pin columns.", or today's question, the same way |
| "unpin everything" | Asked | Ready: "Unpin all columns" (or "The grid already shows this view." with none pinned) | "This grid can't pin columns." |
| "compact view" | Asked | Ready: "Use compact density" | Asked, no choices: "This grid can't change its density." |
| "make it denser" | Asked | Asked | Asked |
| "group by advisor and pin advisor" | Asked about the second part | Ready, two lines | "This grid can't pin columns." Nothing applies, the grouping included |
| "pin the Northgate accounts to my watchlist" | Unsupported | Unsupported (unchanged) | Unsupported |

**Rows Adapter.** `ViewResult` gains `pinned: { start: string[]; end: string[] }` and `density`. `columns` puts start-pinned columns first and end-pinned columns last, keeping each list's order. The Host makes them sticky and sets the row height.

**TanStack Table adapter.**

- `TanStackTableLike` gains an optional `setColumnPinning`, and `TanStackState` gains `columnPinning`. The adapter writes and reads pins through TanStack's own state, which has GridCue's shape (`start`, `end`).
- TanStack has no density. The adapter holds it, and reads it back with the rest of the View State, so undo and restore keep it. Today `read()` fills it from the default every time.
- A pin the User makes with the table's own controls is reported like any manual change (ADR 0009).

**Contract suite.** "Does not advertise `columns.pin`, `aggregation.set`, `density.set`" becomes "lists each only when `renders` names it". For each operation an adapter lists, the suite checks: apply, read back, restore an exact snapshot, undo, and one notification per apply. Each adapter runs the suite twice, with and without `renders`. `limit.set` gains the same checks.

### 5.4 Totals and one group order (PR 3)

| Request | Today, both adapters | After, with `renders: ["totals"]` |
| --- | --- | --- |
| "total market value by advisor" | Asked | Ready: "Group by Advisor; Show the total of Market value" |
| "sum of market value by advisor" | Asked | Same |
| "average concentration by custodian" | Asked | Ready: "Group by Custodian; Show the average of Concentration" |
| "group by advisor and show total market value" | Asked what to filter on | Ready, the same two lines |
| "total concentration" | Asked | Asked: "Concentration can't be totalled. Show its average instead?" |
| "total market value" (no grouping) | Asked | Ready: "Show the total of Market value"; one grand total |
| "also total gain" (view has a total) | Asked | Ready: "Show the total of Unrealized gain"; both totals show |
| "remove the totals" | Asked | Ready: "Remove the totals" |
| "how many accounts per advisor" | Asked | Asked (unchanged) |
| "largest households first" (with `defaultMeasure`) | Asked, two choices | Asked, three: "Group by Household", "Use the Household column", "Rank households by total Market value" |
| "most concentrated households first" | Asked, two choices | Asked, three; the third is "Rank households by average Concentration" |
| "largest households first" (no `defaultMeasure`) | Asked, two choices | Unchanged |

- **A new total is added** to the view's totals, and the plan's `aggregation.set` carries the whole list. Nothing disappears unless a request says to remove it.
- **"Total X by Y"** also sets the grouping to Y, replacing the current one, as "group by Y" does today.
- **A total counts the rows the view shows,** after its filters and its count. Empty values are skipped. With no values, the total is empty.
- **The third choice** applies the grouping, the total and a descending sort on the total's column (ascending for "smallest"). The Preview shows all three lines. Routing later adds "Open the Households grid" to the same question, as its last choice, after these three.

**`applyView`.** `ViewResult` gains `totals` (one per total, over all shown rows) and each group gains `totals`.

**One group order, both adapters.** The Rows Adapter changes to TanStack's order:

| View | Rows Adapter today | TanStack today | Both, after |
| --- | --- | --- | --- |
| Grouped, sorted on a column with a total | By each group's largest row | By the total | By the total |
| Grouped, sorted on a column with no total | By each group's largest row (when descending) | The order groups first appear in the rows before sorting | The order groups first appear in the rows before sorting |

Rows inside each group are sorted in both, as today. The second row changes a view requests reach today, in the Rows Adapter only (the Next.js example). It goes in ADR 0030 and the changelog.

**TanStack totals.** A total is a column definition in TanStack, which the Host owns. GridCue exports `gridcueAggregationFn` for the Host to register on `defaultColumn`, as it registers `gridcueFilterFn` today. It reads the adapter's totals and gives a sum, an average, or nothing for each column. A grand total is `column.getAggregationValue()`. The adapter holds the totals, so undo and restore keep them. PR 3 starts with a spike that proves this on a real table; if TanStack can't pick the function from GridCue's state, `"totals"` stays off the TanStack adapter, and the PR says so.

**The rendered-rows test.** `packages/gridcue/test/rendered-rows.ts` builds both adapters on the same rows and View State and compares what the Host would draw: rows, order, groups, group order and totals. Named filters' PR 5 starts the file with filter-only cases (whole days, empty, exact text); this PR adds the rest. It runs on seeded random views from fixed seeds, with ties and empty values in the data, and once more on seeds the lead draws after the build. One difference is out of scope (section 3): where a row with no value in a sorted column sits. The test still checks that both adapters keep those rows. It reports their positions apart from the bar, so the difference is counted, not hidden.

**The seeded view generator** is built here, for any schema, where the package's tests and `evals/` can both import it. `proposeView`'s property test, the command bar's row-count and View Part tests, and the four bets' round trip reuse it (order plan). It starts from the four bets' first test generator, kept outside the repo.

### 5.5 Counts on TanStack Table (PR 4)

| Request | TanStack today | After, with `renders: ["count"]` | After, without |
| --- | --- | --- | --- |
| "top 10 accounts by market value" | Sort, and the note "Count not applied: this grid can't show only the first 10" | Ready: sort, and "Show only the first 10 rows" | As today |
| "top 10 accounts by market value grouped by advisor" | Sort and group, with the note | Ready; ten accounts, grouped | As today |
| 5.1's follow-ups | Ready (no count was kept) | As 5.1 | As today |

**First, a spike.** It tries two shapes on TanStack 9.2.4 and keeps the one that meets the bar:

1. A wrapper around the Host's `filteredRowModel` that keeps the first N rows of the sorted view, with the count held by the adapter.
2. A GridCue table feature that holds the count in the table's own store (TanStack v9 accepts custom state), with the same row model.

Either way, the piece keeps the rows `applyView` would keep (sorted with GridCue's own comparison, no empty values in the first sorted column), returns them in their original order, and leaves display order to TanStack's sort and grouping. That is what makes group order follow 5.4. The table must redraw when only the count changes.

**Never on a manual table.** When the table's pagination, sorting or filtering is manual, the rows it holds are one page, and the first N of a page is not the first N of the view (more grids, section 14). `renders: ["count"]` on such a table throws `INPUT_CONFIG`, and `limit.set` is not listed. A server grid gets its count from the Query Adapter's `countBeforePaging` (more grids 5.4).

**The bar** is the rendered-rows test from 5.4, extended to views with a count: the same rows, in the same order, grouped and not. If neither shape meets it, PR 4 stops, today's note stays, and the result goes to the owner.

## 6. Public API and protocol

All additive, except the two default changes and the group order, which ADRs 0029 and 0030 record. The resolution protocol does not change: it stays 0.1, the provider request is the same for every labelled request, and Jev's questions are unchanged.

| Name | Entry | PR |
| --- | --- | --- |
| `ViewDiff.countChanged` | root | 1 |
| The count question (a `Clarification` with two options) | root | 1 |
| `RowsAdapterOptions.renders` | root | 2 |
| `ViewResult.pinned`, `ViewResult.density` | root | 2 |
| `ViewDiff.pinsChanged`, `ViewDiff.densityChanged` | root | 2 |
| `DEFAULT_CAPABILITIES` gains `"pin"` | root | 2 |
| `TanStackAdapterOptions.renders` | `gridcue/tanstack-table` | 2 |
| `TanStackTableLike.setColumnPinning` (optional) | `gridcue/tanstack-table` | 2 |
| `defineSchema` adds `"aggregate"` to number, currency and percent columns | root | 3 |
| `ViewResult.totals`, `groups[].totals` | root | 3 |
| `ViewDiff.totalsChanged` | root | 3 |
| `PLAN_AGGREGATION_KIND` | root | 3 |
| `gridcueAggregationFn` | `gridcue/tanstack-table` | 3 |
| The count piece, named by the spike (for example `gridcueCountRowModel`) | `gridcue/tanstack-table` | 4 |

`gridcue/react`, `gridcue/server` and `gridcue/mock` don't change. New Preview lines and questions reach both UIs through the existing hooks. The Mock Provider's families don't change, because no family is added.

## 7. ADRs

Four ADRs record what is hard to reverse here. Each is its own file.

| ADR | Records | First needed by |
| --- | --- | --- |
| [0027: A count follows its rows](../../adr/0027-a-count-follows-its-rows.md) | What a count keeps, the count question, and counts on TanStack Table (5.1, 5.5). It refines ADR 0018's count bullet | PR 1, and PR 4 for TanStack |
| [0028: Code reads closed view words](../../adr/0028-code-reads-closed-view-words.md) | How a request reaches pins, density, totals and count-clearing, with the protocol still at 0.1 (4.1, 5.2). A first slice of ADR 0020 | PR 1 |
| [0029: Two gates for pins, totals and density](../../adr/0029-two-gates-for-pins-totals-and-density.md) | The column defaults, `renders`, and "This grid can't …" (4.2, 4.3) | PR 2 |
| [0030: Totals, and one group order](../../adr/0030-totals-and-one-group-order.md) | What a total is, and the group order both adapters draw (5.4) | PR 3 |

## 8. Terms for `CONTEXT.md`

All four sit under "Views", in this order, with the three new terms right after View State.

- **View State**: rewrite to "The complete arrangement of a grid at a moment: filters, sorts, grouping, totals, count, which columns show in what order, which are pinned, and density." Its _Avoid_ line stays.
- **Count** (new): "How many rows a grid shows from the top of the sorted view, as in "top 10"." _Avoid_: Limit, page size, top-N.
- **Total** (new): "A sum or an average of one column, shown for each group, or once for the whole view when it isn't grouped." _Avoid_: Aggregation, summary, subtotal.
- **Pinned Column** (new): "A column kept in view at the start or the end of the grid while the rest scrolls." _Avoid_: Frozen column, locked column, sticky column.

The _Avoid_ lines are about prose. `limit.set`, `aggregation.set` and the `aggregate` capability keep their names in code. The command bar's term for how many rows a view holds is **Rows Shown**, so it is not mixed up with Count (order plan, D5).

## 9. UI

**The command bars don't change.** `<GridCueBar />` and the Component Registry show the new Preview lines, the count question and the three-choice question with the components they already have. Notes are already shown on this branch.

**The grids the Site demo and both examples draw do change.** They now draw pinned columns, density, totals and a count caption, so a User sees new things there. The design pass was run with `emil-design-eng`, `better-ui` and `principle-experience-first`. The Site and the Vite example use the shadcn table tokens; the Next.js example uses its plain CSS (`examples/next/app/page.css`). PR 2 starts with a throwaway HTML prototype of one grid with all four, light and dark, for the owner to look at before any component code.

| Before | After | Why |
| --- | --- | --- |
| Every column scrolls | A pinned cell and its header: `position: sticky; inset-inline-start: <offset>` (end: `inset-inline-end`), header `z-index: 2`, cells `z-index: 1`. The offset is TanStack's `column.getStart("start")`; the Next.js example measures header widths | Logical properties keep it right in a right-to-left grid |
| — | Pinned cells get an opaque background: Site and Vite `bg-card`; group rows `color-mix(in oklch, var(--muted) 40%, var(--card))`. Next.js light `#ffffff` and `#f3f4f6`, dark `#030712` and `#1f2937` | A translucent sticky cell lets scrolled text show through |
| — | The last start-pinned column has `box-shadow: inset -1px 0 0 var(--border)` (Next.js `#e5e7eb` light, `#1f2937` dark); the first end-pinned column the mirror | A structural edge, not colour alone, says where the pinned area ends |
| One row height | Compact: cells `py-1 px-2` (Next.js `2px 8px`), header `h-8`. Comfortable: today's `p-2` (Next.js `6px 8px`), header `h-10`. Spacious: `py-3 px-2` (Next.js `10px 8px`), header `h-12`. Font size unchanged | Density changes spacing, never legibility |
| — | A density change has no transition | It follows a request the User just confirmed; padding can't animate cheaply, and keyboard-driven changes never animate |
| Group row: "Northgate · 12 accounts" in one cell | With totals, the group row has one cell per visible column. The first holds the label and count as today; each total column holds its value, `font-medium tabular-nums`, after a `text-xs text-muted-foreground` word: "total" or "avg" | The word is the cue, so a total never reads as a row's own value |
| — | Ungrouped with a total: a `<tfoot>` row, `border-top: 1px solid var(--border)`, background `bg-muted/40`, the first cell "All 48 accounts" muted, total cells as above | One grand total, set apart by structure |
| Caption: "48 rows, showing the first 20" (display cap) | With a count: "First 10 of 48 rows". The display cap wording stays for views without a count | The User sees that rows were left out, and how many |
| `.changed-header` marks a changed header for 1.2s | Also marks a header whose pin or total changed | Same cue for every column change, no new motion |
| Command bar, Preview, questions, Undo | Unchanged | — |

Every grid change is checked in a real browser, light and dark, in the Site, the Vite example and the Next.js example, with a horizontally scrolled table for pins.

## 10. Evals and evidence bars

Every set is synthetic. Every held-out set is written and labelled before the code it tests, by a labeller who has not seen that code, and is run once by the lead. A held-out wrong view goes back to the builder as a class, and that class gets a fresh held-out set. Cases that need a current view carry it in the case's state, which the harness already supports.

| Mechanism | Dev set | Held-out set | Bar | Reported with no bar |
| --- | --- | --- | --- | --- |
| The count question and count words (5.1) | 30 follow-ups after a count, half wanting each outcome, plus 10 controls that must not ask | 30, written from 5.1 alone | 0 wrong views. Every follow-up that changes the sort or filters asks or sets its own count | Exact and safe-miss counts |
| Empty values in a count (5.1) | Unit tests | None until PR 4's rendered-rows run, on views with a count | A row with no value never fills a count, both directions | — |
| Pin and density words (5.2, 5.3) | 40, with 10 adversarial (workflow verbs, values not columns, labels that contain a form word) | 40, same mix, written from the docs page draft alone | 0 wrong views. Every adversarial case asks or is refused | Exact share; which unread wordings recurred |
| Totals words (5.2, 5.4) | 40, with 10 adversarial (text and percent columns, "per", "how much") | 40, same mix; and a separate **natural set** of 30, written by a labeller who sees only the product doc and the schema, not the word list | 0 wrong views on all three | The natural set's ask rate. Above half is evidence against ADR 0028 and goes to the owner |
| The third choice (5.4) | 15 "X households first" requests, with and without `defaultMeasure` | 15 | 0 wrong views; new cases check the choices, not only the prompt | — |
| Validation (4.4) | Unit tests, one per row | — | Every row | — |
| The contract suite (5.3) | Both adapters, with and without `renders` | — | Pass | — |
| Group order and totals (5.4) | The rendered-rows test: 500 seeded random grouped views on each of two row sets, with ties and empty values | 500 more on each row set, from seeds the lead draws after the build | 100% equal on both | How many views differ only in where a row with no value in a sorted column sits (section 3, Out) |
| Counts on TanStack (5.5) | The same test, on views with a count | The same, on the lead's seeds; one case for each manual setting, which must throw | 100% equal, grouped and not | The spike's notes, whichever shape fails |
| Every existing set | All existing sets, with the Mock Provider | — | 0 wrong views, and no verdict worse than today | Exact counts per set |
| Provider payload | Every labelled request | — | Identical to today's | — |

- If the natural set finds a wrong view from a word nothing reads, in a part this work doesn't cover, the bar stays at 0. The class is narrowed to a question, with a fresh held-out set, and no reading is added (order plan, D4).
- The totals sets also run on the ledger fixture, which named filters' PR 2 adds with a number, a currency and a percent column (order plan). This work adds no schema of its own.
- The eval runner builds a Rows Adapter only (`evals/run.ts:95`). It gains a TanStack run in PR 4, so the TanStack count path is in the gate.
- Live runs with Jev need the owner's command. Before PR 3 merges, one live run confirms 0 wrong views and no drop in exact results on every set. Closed Clauses ignore the provider, so only mixed requests can change.

## 11. Surfaces

| Surface | Applies | What changes |
| --- | --- | --- |
| Entry points | Root, `gridcue/tanstack-table` | Root: view words, compiler, validation, Preview, `applyView`, `diffViews`, defaults. TanStack: pins, density, totals, count, `renders`. `gridcue/react`, `gridcue/server`, `gridcue/mock`: no change, checked by type tests |
| Both UIs | Checked, no change | New lines and questions render through the existing hooks; each PR's component tests in both UIs cover one new question |
| Frameworks and tables | Yes | Both examples turn on `renders` and draw what they turn on: the Next.js example with the Rows Adapter, the Vite example with TanStack. Both adapters pass the contract suite and the rendered-rows test. No server code is reachable from a client bundle |
| The Site | Yes | The demo turns on `renders` and draws pins, density, totals and, after PR 4, counts. Docs: `concepts/views`, `concepts/requests`, `api/adapters`, `api/schema`, `api/protocol`, `guides/build-an-adapter`, `guides/vite-tanstack`, `guides/next-rows-adapter`, `get-started/describe-your-domain`, and `safety`, whose "It does not compute answers or aggregate" (`safety.mdx:10`) is rewritten in PR 3: the Host's grid totals rows it already holds, and nothing is sent |
| Agent skill | Yes | `skills/gridcue` describes the view as including totals, pins, density and counts, and tells the agent to set `renders` only for what the Host's table draws. `pnpm check:skills` |
| Failure paths | Yes | A request for something the grid doesn't draw ends in "This grid can't …" and applies nothing. The count question has cancel and both answers. Undo restores pins, density, totals and counts in both adapters. A stale Revision is rejected as today |

`docs/internals/product.md` ("Designed in the protocol, deferred", and the "compact exceptions view" row) and `docs/internals/intent-protocol.md` are rewritten in the PR that lands each piece. So are lines 56 and 58 of the four bets spec, and its 5.3 `unsaid` list and sentence order. The four bets plan's tasks change with each PR, as the order plan's section 6 lists. ADR 0018's count bullet is rewritten in PR 1 and again in PR 4, as ADR 0027 refines it. The owner approved these edits once, with the others the order plan lists (D2).

## 12. Testing

- Unit tests for each view-words form in 5.2, each with one leftover word, which must not read.
- Unit tests for the count question: each row of 5.1, and that it never fires on a plan that sets its own count.
- Unit tests for each validation row in 4.4 and each Preview line in 4.5.
- Reducer tests: pin twice, pin to the other side, unpin all.
- `applyView` tests: pins in `columns`, totals with empty values, group order both ways, a count with empty values.
- The contract suite and the rendered-rows test, on both adapters.
- A payload test: the provider request for every labelled request equals today's.
- Component tests in both UIs for the count question.
- The browser bundle check still passes.

## 13. Acceptance criteria

1. `pnpm lint` and `pnpm check` pass with no credentials after each PR.
2. Every bar in section 10 is met and reported in its PR, with the numbers, misses included.
3. Each PR's description says which surfaces in section 11 it touched.
4. ADRs 0027 to 0030 are in, `CONTEXT.md` matches section 8, and the docs pages in section 11 are current.
5. PR 2 to PR 4 carry before and after screenshots of the demo grid, light and dark.

## 14. Risks

- **Closed words may reach too little.** Users may say "how much does each advisor manage" far more than "total market value by advisor". The natural set measures it, and ADR 0028 names it as the evidence that would reopen the choice.
- **The group order change surprises a Rows Adapter Host.** A grouped, sorted view today ranks groups by their largest row. After, groups keep their first-seen order unless a total ranks them. The changelog and ADR 0030 say so, and "largest households first" now offers a real ranking.
- **The count question may feel slow.** It asks on every sort or filter change after a count. The dev set has follow-ups that want each outcome, so the cost is visible in the numbers; the owner can revisit with them.
- **The TanStack pieces may not be feasible.** Totals and counts both rest on spikes. Each PR stops cleanly if its spike fails, and today's behaviour stays.
- **A Host turns on `renders` and doesn't draw it.** GridCue can't see the Host's markup. The docs, the agent skill and the examples show both halves together.
- **A form word is also a Host label.** A Mention comes first, so the form doesn't read, and the Clause goes to the provider as today. The adversarial cases cover it.

## 15. Meeting the four bets

- **Local Resolver closed grammar (four bets 5.4).** Its table gains Pin, Density, Totals and Count-clear rows. They call `readViewWords`, so the forms are written once. A Clause the reader reads in full is exactly the "every word accounted for" rule the grammar uses.
- **`controller.read` (four bets 5.2).** `readViewWords` returns spans over the Clause text, with a kind for each. Once the four bets' positions map Clause text to the User's text (4.1), these spans become marks: "pin" as a verb, "compact view" as a density, "total" as a total. Nothing in this design needs to change for that.
- **`describeView` (four bets 5.3).** Pins, totals and density become typeable, so "a pinned column, a summary, or a density" leaves the `roundTrips`-false list for any view whose words section 5.2 reads. The sentence's order gains totals after grouping and pins and density after columns, using the Preview's words from 4.5. The round-trip test is the check.
- **`proposeView` (four bets 5.3).** A saved view with pins, totals, density or a count applies only on an adapter that lists the operation; elsewhere it is unsupported, as that section already says.
- **Four bets spec lines 56 and 58** go stale: these operations become reachable, and `limit.set` reaches TanStack. The PR that lands each piece rewrites the line.
