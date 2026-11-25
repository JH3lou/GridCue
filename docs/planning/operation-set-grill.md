# Finishing the operation set: grilling log

Status: answered by the owner on 2026-11-13. See "Owner's answers" at the end. The facts were checked again against the code while the spec was drafted, the same day. Corrections are made in place and marked *Corrected*; Q3, Q5 and Q6 changed because of them.

The protocol already defines four View Operations that no request can reach in full: `aggregation.set` (totals), `columns.pin`, `density.set`, and `limit.set` (counts) on the TanStack Table adapter. The validator and the Preview know them, but no Operation Family produces the first three, no shipped adapter applies them, and a count works only in the Rows Adapter. This round decides how a request reaches each one, what each one means on both Grid Adapters, and how they are proven safe. It is opportunity 2 of the five the owner put before the four bets on 2026-11-13, so it designs on today's code, where every request goes through an Intent Provider, and says where it meets what the bets add later.

## Facts gathered (2026-11-13)

Marked *Verified* when a command or test was run, *Read* when taken from the code or docs, and *Unverified* when nobody has checked. Probes are scratch scripts outside the repo, run with `pnpm exec tsx` and the Mock Provider. No model was called.

### The protocol, validation and Preview

- **The shapes exist.** `AggregationSpec` (`sum`, `avg`, `min`, `max`, `count`), `Density` (`compact`, `comfortable`, `spacious`), `pinnedColumnIds` with `start` and `end`, and an optional `limit` are in the View State. The operations `columns.pin`, `aggregation.set`, `density.set` and `limit.set` are in the union. `packages/gridcue/src/core/protocol.ts:104-123`, `:137-141`. *Read.*
- **No Operation Family produces three of them.** A provider picks among `VIEW_FAMILIES`: filter, sort, group, the three column families, the three clears, and reset. There is no family for totals, pinning or density. `packages/gridcue/src/core/resolution.ts:12-23`, `:45-56`. *Read.*
- **A count is read by code, not by a provider.** The normaliser reads "top 10" as a count (`COUNT` at `normalize.ts:148`, set on the Clause at `:500`). Only "top", "largest", "biggest" or "smallest" before a number is a count; "the first 10 rows" is not. The compiler turns it into `limit.set` only where the adapter lists that operation; otherwise it sorts alone and records `dropped:<clause>.limit` evidence. `compile.ts:1199-1210`, ADR 0018. *Read; line numbers corrected.*
- **The column capabilities `pin` and `aggregate` are off by default.** `DEFAULT_CAPABILITIES` is filter, sort, group, show, hide, reorder. `schema.ts:5`. On the wealth schema as shipped, a pin plan fails with `PLAN_COLUMN_CAPABILITY`. *Verified* (`validate-gaps.mts`).
- **Density has no column capability.** Only the adapter's operation list gates it. `validate.ts:50-59`. *Read.*
- **Validation accepts pins and totals that make no sense,** once an adapter lists the operations and the columns allow them. *Verified* (`validate-gaps.mts`):
  - pinning the same column twice gives `start: ["account_number", "account_number"]` (the reducer appends without removing, `reduce.ts:29-42`);
  - pinning a hidden column passes;
  - a sum on a text column, a sum on a percent column, and the same total twice all pass.
  - `docs/internals/intent-protocol.md:220` promises a check for "incompatible grouping/aggregation". No such check exists in `validate.ts:103-165`.
- **The Preview has a line for each.** "Pin Account number to the start", "Unpin …", "Summarize Market value (sum)", "Use compact density", "Show only the first 10 rows", "Show every row". `preview.ts:78-89`. The totals line prints the function's ID, and "Summarize" sits close to "summary", a word `CONTEXT.md` lists under _Avoid_ (`CONTEXT.md:87`, `:91`). *Read.*
- **`diffViews` ignores pins, totals, density and the count** (`preview.ts:153-160`). **The audit's structure for `aggregation.set` lists no columns,** because it looks for `columnIds` or `sorts` only (`preview.ts:206-213`). *Read; line numbers corrected.*
- **`aggregation.set` replaces the whole list** (`reduce.ts:43-44`), so a second total request drops the first unless the compiler sends both. The Preview line names only the new list. *Read.*

### The two adapters

| | Rows Adapter | TanStack Table adapter |
| --- | --- | --- |
| Lists beyond the MVP set | `limit.set` (`rows-adapter.ts:32-40`) | nothing (`tanstack/index.ts:183-190`) |
| Pins, totals, density | Kept in its View State, so undo restores them. `applyView` ignores all three (`rows-adapter.ts:78-104`), and `ViewResult` has no field for totals (`:59-66`) | Never written (`tanstack/index.ts:140-179`). `read()` fills them from the defaults every time (`:107-119`), so an applied value would vanish and undo could not restore it |
| Group order when grouped and sorted | First-seen order of the sorted rows, so a group comes first because of its largest row, not its total. With A = 5 + 7 and B = 9 + 1, sorted descending, with or without a sum: B, A. *Verified* (`validate-gaps.mts`, `group-order.mts`) | With a sum on the sorted column, by the sum: A (12), B (10). With none, every group's value is empty, so the groups keep the order they first appear in the rows before sorting: A, B. *Verified* (`group-order.mts`). *Corrected:* the two adapters already order groups differently today, on a view any request can reach ("group by advisor, sorted by market value descending") |
| Empty values in a descending sort | First. `compareValues` puts an empty value last and a descending sort flips it, so rows with no Market value lead "sorted by Market value descending" and fill "top 10" before any row with a value. Rows a (5), b (empty), c (9), d (missing), e (1), top 2 descending: d, b. *Verified* (`null-order.mts`) | A missing value first, a `null` last: d, c, a, e, b. *Verified* (`null-order.mts`) |

**The shared adapter contract suite** (`packages/gridcue/test/adapter-contract.ts`) checks multi-operation apply, negative amounts, one notification per apply, unvalidated and stale plans, snapshot restore, and subscription. It asserts that an adapter does **not** list `columns.pin`, `aggregation.set` or `density.set` (`:121-126`). It never tests `limit.set`. *Read.*

**TanStack Table 9.2.4**, the pinned version (`packages/gridcue/package.json:90`). Read from its installed type files and source, not from the live docs:

- **Pinning is table state** with the same shape as GridCue's: `columnPinning: { start: string[]; end: string[] }`, set with `setColumnPinning`. `columnPinningFeature.types.d.ts:15-22`, `:176`. `TanStackTableLike` does not include it today (`tanstack/index.ts:31-41`). *Read.*
- **A total is a column definition, not state.** `aggregationFn` is a `ColumnDef` option (`rowAggregationFeature.types.d.ts:123`), and with none set a column aggregates to nothing (`rowAggregationFeature.utils.js:101`). The Host owns the column definitions. *Read.*
- **Sorting runs after grouping,** and a group row's value for a non-grouped column is its aggregate. So a sort on a column with a total orders the groups by that total. `coreRowModelsFeature.utils.js:82-90`, `createGroupedRowModel.js:84-103`. *Read; not run.*
- **Density and a row count have no TanStack state.** Pagination exists, but it is a page the User can move, and after grouping it counts groups, not rows. *Read.*
- **The row models run in this order:** core, filtered, grouped, sorted, expanded, paginated. Each is a factory in the `features` option that the Host registers, so a wrapper around `filteredRowModel` sees the rows before grouping. `coreRowModelsFeature.utils.js`. *Read.*
- **A column with no `aggregationFn` gives its group rows an empty value** (`createGroupedRowModel.js:84-103`, `rowAggregationFeature.utils.js:101`). A Host can register one function on `defaultColumn`, as it registers `gridcueFilterFn` today, and `column.getAggregationValue()` gives one total over the rows before grouping. *Read.*
- **TanStack v9 accepts custom table features with their own initial state** (`getInitialState`, `types/TableFeatures.d.ts:342`). A GridCue feature could hold the count, the totals and the density in the table's own store, so the table redraws and the adapter reads them back. *Read; not run.*
- **Whether a Host-registered row-model wrapper can keep the first N rows of the sorted view before grouping** is *Unverified*.

**Both adapters are headless.** *Read.* GridCue writes the View State; the Host's own markup draws the grid. `applyView` returns rows and columns, and the TanStack adapter writes table state. Neither makes a column sticky, changes a row's height, or draws a total cell: the Host's table does, if it reads the state. A count is the exception in the Rows Adapter, because `applyView` drops the rows itself. So an adapter that lists `columns.pin`, `density.set` or `aggregation.set` while the Host's table ignores them would preview a change the User then never sees. *Corrected:* the first draft of Q6 treated the column capabilities as the only gate.

### What happens today

Every request below, through the Mock Provider, on both adapters. *Verified* (`today.mts`, `followups.mts`).

| Request | Rows Adapter | TanStack Table adapter |
| --- | --- | --- |
| "total market value by advisor", "sum of market value by advisor", "average concentration by custodian", "how many accounts per advisor" | Asked: "I'm not sure what to change…" | Same |
| "group by advisor and show total market value" | Asked what "show total market value" should filter on | Same |
| "largest households first" | Asked, with "Group by Household" or "Use the Household column". Choosing the grouping then asks "Which column should be sorted by?" | Same |
| "compact exceptions view", "compact view", "make it denser" | Asked: "I'm not sure what to change…" | Same |
| "pin account number", "pin the account number column to the left", "freeze the account column", "unpin everything" | Asked: "I'm not sure what to change…" | Same |
| "top 10 accounts by market value" | **Ready:** sort by Market value descending, first 10 rows | **Ready:** sort alone, with the note "Count not applied: this grid can't show only the first 10" |
| "top 10" | Asked which column (the wealth fixture has no `defaultMeasure`) | Same |
| "show the first 10 rows", "10 largest accounts" | Asked how to compare with "10" | Same |

With Jev: *Unverified*. No live call was made.

### A count outlives its sort

After "top 10 accounts by market value" applies in the Rows Adapter, *Verified* (`followups.mts`):

| Next request | Result | Count after |
| --- | --- | --- |
| "clear the sort" | Ready: "Clear sorting" | still 10: ten rows in no order |
| "sort by advisor" | Ready: "Sort by Advisor, ascending" | still 10: a different ten rows, the first by Advisor |
| "show every row", "show all accounts", "remove the limit" | Asked | still 10 |
| "reset the view" | Ready | gone |

Neither Preview mentions the count. "Show every row" is a Preview line (`preview.ts:87-88`) that no request can produce.

*Corrected:* a filter does the same, which the first probe did not try. After "top 10 accounts by market value", "only the taxable ones", "taxable accounts", "accounts over $1m" and "clear the filters" are each ready with one filter line, and the count stays at 10. "Only the taxable ones" most likely means the taxable accounts among the ten on screen, but the grid then shows the first ten taxable accounts by Market value, which can be ten different rows. "Group by advisor", "hide custodian" and "top 5 by gain" are fine: grouping and columns don't change which rows the count keeps, and a new count replaces the old one. *Verified* (`count-followups2.mts`). The four bets probe listed "a count without a sort" as unreachable (`four-bets-grill.md:44`); it is reachable in two steps.

### The command bars and `Preview.notes`

- **Both built-in UIs render `Preview.notes` on this branch.** `<GridCueBar />` shows each note as a `gridcue-caveat` paragraph (`grid-cue-bar.tsx:70-74`); the registry's `PreviewPanel` does the same (`registry/registry/gridcue/preview-panel.tsx:28-32`). Both arrived in commit `469cc75`, which is on this branch and not on `main`. *Verified* (`git log -S`, `git merge-base --is-ancestor`).
- The Site's demo uses the registry's `PreviewPanel` through a path alias (`apps/site/tsconfig.json:12`, `ask-bar.tsx:5`), the Vite example uses the registry's `CommandBar`, and the Next.js example uses `<GridCueBar />`. *Read.*
- No UI test checks that a note is shown (`grid-cue-bar.test.tsx`, `registry/test/command-bar.test.tsx`). *Verified* (grep).
- So the brief's premise holds for `main` only. Rendering notes needs no work in this opportunity. A new note this work adds uses the same field. How notes look belongs to the command bar opportunity.

### Every surface a new operation reaches

- **Entry points:** root (reading, compiler, validation, Preview, `applyView`), `gridcue/tanstack-table` (the adapter), `gridcue/mock` (only if families change), `gridcue/server` (only if the provider protocol changes), `gridcue/react` (no change while Preview lines carry everything).
- **Site demo:** TanStack adapter with the Mock Provider in the browser; its table has no pinning, aggregation or pagination features (`apps/site/app/components/demo/use-wealth-demo.ts:26-35`, `:92`). It already shows each group's row count (`wealth-table.tsx:118`).
- **Examples:** Vite uses TanStack (`examples/vite/src/App.tsx:74`); Next.js uses the Rows Adapter and `applyView` (`examples/next/app/accounts-view.tsx:23`).
- **Evals:** the runner builds a Rows Adapter only (`evals/run.ts:95`), so the TanStack count path is in no eval. Two cases expect `limit.set` (`cases-reading.jsonl:49`, `cases-reading-heldout.jsonl:44`). Two adversarial cases use "pin" for a workflow action and expect unsupported: "pin the Northgate accounts to my watchlist" (`cases-reading.jsonl:153`) and "pin the accounts over $1m to my watchlist" (`cases-reading-heldout.jsonl:157`). Nine chassis cases ask "Did you mean households (or advisors) as a whole?" for "Largest/Top/Biggest/Smallest/Most concentrated households/advisors/reps first" (`cases-chassis.jsonl:1`, `:2`, `:8`, `:24`, `:25`, `:33`, `:34`, `:35`, `:39`). The runner compares only the question's prompt, never its choices (`evals/run.ts:89`), so a third choice changes none of them; new cases must check the choices. *Corrected:* the first draft said three cases expect only the grouping choice.
- **Docs that say these are unreachable:** `docs/internals/product.md:52-55` and `:162`, `apps/site/content/docs/concepts/views.mdx:45`, `apps/site/content/docs/api/adapters.mdx:91`, `apps/site/content/docs/guides/build-an-adapter.mdx:148`, `apps/site/content/docs/concepts/requests.mdx:31`, `docs/internals/intent-protocol.md:160`. The agent skill describes the view as "filters, sorts, grouping, and which columns show" (`skills/gridcue/SKILL.md:8`). `CONTEXT.md:62` defines the View State the same way.
- **Product boundary:** AGENTS.md rule 1 lists aggregating, pinning and density as view changes. A total is computed by the Host's grid in the browser from rows it already has; no row reaches a provider (rule 4).

### Where this meets the four bets

- The four bets spec keeps pinning, totals and density "unreachable by request" (`2026-11-10-four-bets-design.md:56`) and puts `limit.set` on TanStack out of scope (`:58`). Both lines go stale when this opportunity lands.
- The View Sentence's `roundTrips` may be false for "a pinned column, a summary, or a density" (`:161`). Once requests can reach them, that reason should leave the list, and the sentence's order ("rows, grouping, sorting, count, columns", `:153`) gains totals, pinning and density.
- The Local Resolver's closed grammar (`:190-198`) has forms for rows, sort, group, columns, count and clear. If this opportunity reads its new words in core, as counts are read today, the grammar gains Totals, Pin and Density rows that reuse that reading with no rework.
- `controller.read` marks names, amounts, directions and counts (`:124-128`). The new words need spans like counts get in PR 2.
- `proposeView` can bring back a saved view with pins, totals or density only on an adapter that applies them; otherwise it is unsupported (`:177`).

## Round 1

Answer by number. A bare "agree" accepts every recommendation.

❓ **Q1 - How a request reaches the new operations.**
(a) **Recommended: code reads a small, closed set of words for each, as it reads counts today.** Columns come only from Mentions. The provider's choices and the Jev questions do not change, so the protocol stays at 0.1. Anything outside the words, or a column no Mention names, is asked about.
(b) Add Operation Families for totals, pinning and density, with new Jev questions.
(c) Both: code reads the closed words, and a provider family handles the rest.

➡️ (a). It is the narrowest reading that is certain, and in PR 1 every looser reading opened new wrong views. "Pin … to my watchlist" and "freeze the Alder account" are workflow actions that a provider family would have to learn to refuse; closed words never match them. The Local Resolver reuses the same reading later with no rework. It needs an ADR. **What would change it:** a held-out set where a large share of natural totals wording, such as "how much does each advisor manage", falls outside the closed words.

---

❓ **Q2 - What a total is.**
(a) **Recommended: totals and averages only.** "Total" and "sum of" before a named number or currency column; "average" before a named number, currency or percent column. A percent column takes an average only, never a total. "Total X by Y" also groups by Y. With a grouping, each group shows its total. With none, the grid shows one grand total. A total counts the rows the view shows, after its filters and count. A new total is added to the ones the view has; "remove the totals" clears them. `applyView` returns the totals, and the Preview line reads "Show the total of Market value".
(b) All five functions, including min, max and count.
(c) Totals only with a grouping: "total X" on an ungrouped view asks "Total by what?"

➡️ (a). Sum and average are the requests in the brief. "How many accounts per advisor" is mostly a grouping, and the grid already shows each group's row count. Validation also gains the missing checks: a function must fit the column's kind, a column is pinned once, and a total appears once. **What would change it:** labelled requests showing that min, max or count are asked for about as often as totals.

---

❓ **Q3 - Ranking groups by their total ("largest households first").**
(a) **Recommended: one group order for both adapters, TanStack's.** A sort on a column with a total orders the groups by that total. A sort on a column with no total orders the rows inside each group and leaves the groups in the order they first appear in the rows before sorting. The Rows Adapter changes to match in both cases. "Largest households first" gains a third choice, "Rank households by total Market value", when the request names a column or the schema has a `defaultMeasure` (an average for a percent column: "Most concentrated households first" offers "Rank households by average Concentration"). With neither, the question stays as it is.
(b) Rank groups by their total only. Keep the Rows Adapter's order for a sort with no total.
(c) Keep today's group order. Ranking groups stays unreachable.

➡️ (a). *Changed after the fact check:* the two adapters already show the same grouped, sorted view in different group orders today, with no total (`group-order.mts`). The Rows Adapter's order ranks each group by its largest row, which is a measure nobody asked for and the View State doesn't hold. TanStack's order can't be changed from outside the Host's column definitions, so the Rows Adapter moves. That changes a view requests can reach today in the Rows Adapter (the Next.js example), so it is in the ADR and the changelog. Ranking groups is the request that comes right after a grouping, and the third choice gives it a certain reading. The nine chassis cases keep their prompt; new cases check the choices. It needs an ADR. **What would change it:** Hosts on the Rows Adapter showing that Users read today's group order as a ranking and miss it, which would argue for (b) with a GridCue sort function the TanStack Host registers.

---

❓ **Q4 - Counts on the TanStack Table adapter.**
(a) **Recommended: GridCue exports a row-model wrapper that the Host registers.** It keeps the first N rows of the sorted view before grouping, as `applyView` does. The adapter keeps the count with its own state and lists `limit.set` only when the wrapper is registered. Without it, today's note stays.
(b) Write TanStack's pagination: page size N, page 0.
(c) Leave it as today: sort, and say the count was not applied.

➡️ (a), if the spec's first step shows the wrapper can do it; that is unverified. The step tries two shapes: a wrapper around `filteredRowModel` with the count held by the adapter, and a GridCue table feature that holds it in the table's own store (TanStack v9 allows custom state). The wrapper returns the kept rows in their original order and leaves ordering to TanStack's sort, so group order follows Q3. (b) shows rows 11 to 20 when the User pages on, and counts groups once the view is grouped, so it is a wrong view. **Evidence bar:** the same rows, in the same order, as the Rows Adapter for the same View State, grouped and not, with empty values in the data, in a test both adapters share.

---

❓ **Q5 - A count when the sort changes.**
(a) **Recommended: ask.** A plan that changes or clears the sort, or adds, replaces or clears a filter, on a view with a count, and sets no count of its own, asks: "Keep only the first 10 rows of the new view, or show every row?" "Show every row", "show all rows", "show only the first 10 rows" and "remove the count" are read. With a Row Noun, "show all accounts" asks when the view has both a filter and a count. A row with no value in the first sorted column never fills a count.
(b) Keep the count, and add a Preview note that it now follows the new sort or filter.
(c) Any change to the sort or the filters clears the count, with its own Preview line.

➡️ (a). After "top 10 by value", "sort by advisor" may mean the same ten rows in a new order, which the View State can't hold, or the first ten by advisor. *Changed after the fact check:* filters have the same problem ("only the taxable ones" after "top 10" can mean the taxable rows among the ten, which the View State can't hold either), and in a descending sort the Rows Adapter fills a count with rows that have no value before any row that has one. Neither reading of a follow-up is certain, so GridCue asks; an empty value is never one of the "top 10". Grouping, columns, pins, density and totals don't change which rows a count keeps, so they don't ask. These are defects today in the Rows Adapter and are fixed first. **What would change it:** a labelled set where Users follow a count with a filter far more often than with anything else, and nearly always mean one reading.

---

❓ **Q6 - Which columns may pin and total by default.**
(a) **Recommended: two gates, each with its own default.** *Columns:* pinning on for every column that isn't restricted; `aggregate` on for number, currency and percent columns, where the kind then picks the function (sum and average for number and currency, average only for percent). A Host can still narrow any column with `capabilities`. *Grids:* each adapter lists `columns.pin`, `density.set` and `aggregation.set` only when the Host says its table draws them, with one adapter option. The Rows Adapter keeps listing `limit.set`, since `applyView` drops the rows itself.
(b) Off by default at both gates. The Host opts each column in as well, and the demo and examples do.

➡️ (a). Both are view changes with no data risk, and a column flag a Host has to find first is a feature most never see. *Changed after the fact check:* both adapters are headless, so GridCue can't know whether the Host's table draws a sticky column, a row height or a total cell. Listing one it doesn't draw would preview a change the User never sees, so the grid gate stays off until the Host turns it on. One option per adapter is cheap to find, and the docs and the agent skill name it. Changing a default is hard to reverse once Hosts rely on it, so both go in the ADR.

---

❓ **Q7 - The words for pinning and density.**
(a) **Recommended: narrow words.** "Pin X" pins to the start; "pin X to the right" or "to the end" pins to the end; "unpin X" and "unpin all columns". "Freeze" counts only with "column" ("freeze the account column"). Density takes only "compact", "comfortable" or "spacious" with "view", "rows", "density" or "mode". "Denser" and "tighter" ask.
(b) Broader synonyms: "freeze", "lock", "stick", "denser", "more compact".

➡️ (a). "Freeze the account" and "lock the Alder household" are workflow actions. Relative words depend on the current density and invite guesses. "Compact exceptions view" will still ask about "exceptions" unless the Host declares that name: the density part is read, and the unknown word is never guessed at.

---

❓ **Q8 - Order and shape of the work.**
(a) **Recommended: one spec and one plan, then four PRs in this order:** the count fix (Q5) in the Rows Adapter; pinning and density in both adapters, with the contract suite extended; totals and one group order (Q2, Q3), which starts a rendered-rows test both adapters share; counts on TanStack (Q4), which extends that test. *Changed after the fact check:* totals now come before TanStack counts, because Q4's bar compares grouped rows and needs Q3's single group order first, and because Q4 rests on an unverified spike that should block nothing else. Each PR covers every surface listed above: the docs pages, the agent skill, the Site demo, both examples, `CONTEXT.md`, and the four bets spec's stale lines. Each reading rule is tested on a held-out set labelled before the rule exists, with 0 wrong views on both the new sets and every existing set, and exact counts reported, misses included.
(b) A separate spec and plan for each operation.

➡️ (a). The four share one reading layer, one contract suite and one ADR, so one spec keeps them consistent. The count fix goes first because it is a view the User didn't ask for. Pinning and density come next because they are state only and prove the extended contract suite before totals change `applyView`.

## Out of scope

- Min, max and count totals (Q2), and totals of totals across nesting beyond what each adapter does natively.
- Keeping "the same ten rows in a new order": the View State can't hold a count tied to one sort and a display order from another.
- Pinning rows. "Pin to my watchlist" stays a refused workflow action.
- Restyling how notes look in either command bar (the command bar opportunity).
- Any change to the confidence defaults, the provider protocol, or the Jev questions.
- Where empty values go in a sort with no count. The two adapters place them differently (`null-order.mts`): the Rows Adapter first when descending, TanStack a missing value first and a `null` last, set by the Host's `sortUndefined`. It changes the order of rows, not which rows show, and is left to its own change.

## Owner's answers

The owner was shown the 45 decisions in section 7 of the order plan (`docs/superpowers/plans/2026-11-13-five-opportunities-order.md`) on 2026-11-13, each with its recommended answer, under the words "a bare agree accepts every recommendation". One reply answered all of them. The D numbers are that section's.

| Question | Decision | Answer |
| --- | --- | --- |
| Q1 - How a request reaches the new operations | D8 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) |
| Q2 - What a total is | D20 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) |
| Q3 - Ranking groups by their total | D21 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) |
| Q4 - Counts on the TanStack Table adapter | D22 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) |
| Q5 - A count when the sort changes | D7 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) |
| Q6 - Which columns may pin and total by default | D18, D3 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) |
| Q7 - The words for pinning and density | D19 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) |
| Q8 - Order and shape of the work | D1, D2, D4 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) |

The reply approved the recommended answer to each decision as section 7 of the order plan states it, and with them the spec and the plan. That is (a) for every question above. Section 7 was written after a check across all five opportunities. Where it differs from this round's own recommendation, section 7 stands:

- **Q4 (D22).** Section 7 adds "Never on a manual table". A TanStack table whose pagination, sorting or filtering is manual holds one page of its rows, so it never lists a count. This round did not say so.
- **Q6 (D18).** Section 7 names the adapter option `renders`. This round said "one adapter option".
- **Q6 (D3).** This round did not say what a request gets when the grid doesn't draw what it asks for. D3, which the check added, does: a question with no choices, such as "This grid can't pin columns.", with nothing applied, from one shared piece of code and with no protocol change. More grids' `fix/grid-cant-group` builds that piece first.
- **Q8 (D1).** The four PRs keep their order, but they no longer run back to back. The order plan puts the count fix after named filters' first fix, pinning and density after more grids' `fix/grid-cant-group`, and totals after named filters' PR 2 and PR 5. Named filters' PR 5 starts the rendered-rows test, where this round had the totals PR start it. The count fix also owns the payload pin test, and the totals PR owns the seeded view generator, for the other opportunities.
- **Q8 (D1).** This round spoke of "one ADR". The order plan reserves four: 0027 to 0030. The `CONTEXT.md` terms go in the planning record, not in each PR.
- **Q8 (D2).** The edits to approved documents were approved once, as section 5 of the order plan lists them. The PR that lands each piece makes its edit.
- **Q8 (D4).** D4 is new. If a natural held-out set finds a wrong view from a word nothing reads, the bar stays at 0, the class is narrowed to a question with a fresh held-out set, and no reading is added.
- **D5.** **Count** stays the glossary term for "top 10". The command bar's term for how many rows a view holds becomes **Rows Shown**.

Q1, Q2, Q3, Q5 and Q7 are in section 7 as this round recommended them. The lead recommended two trims in the same message. Neither touches this record.

The terms **Total**, **Count** and **Pinned Column** enter `CONTEXT.md` with these answers, and **View State** is rewritten to include them. The decisions are recorded in ADRs 0027 to 0030.
