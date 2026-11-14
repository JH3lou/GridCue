# Finishing the Operation Set: Implementation Plan

Status: approved by the owner on 2026-11-13. Answers in docs/planning/operation-set-grill.md.

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. Each task names the model that runs it and the files it owns. Do not start a task whose "needs" are not done.

**Spec:** `docs/superpowers/specs/2026-11-13-operation-set-design.md`
**Decisions:** `docs/planning/operation-set-grill.md`, Round 1 (Q1 to Q8) and the owner's answers, and ADRs 0027 to 0030 (spec section 7).

## How the work is run

**Sub-agents, not a fixed script.** The four PRs stack, so they run one after another. Inside each PR the stages are in order, and between stages the lead reads the labels and the held-out numbers to decide what happens next.

**Every PR follows the same five stages.**

1. **Label.** A labeller writes the dev set and the held-out set from the spec section alone, before any code. It never sees the code under test. The lead spot-checks the labels.
2. **Build.** A builder sees the dev set, never the held-out set. Tests first, then code, then the gate.
3. **Held-out run.** The lead runs the held-out set once and reports the numbers as they are, misses included. A wrong view goes back to the builder as a class, not as the failing sentence. The held-out set then joins the repo as a regression set, and the class gets a fresh held-out set for the next round. From the second round on, the builder may only narrow: ask, or keep what today's code reads, and add no new reading.
4. **Review.** An independent reviewer sees the diff and the spec section, and nothing else.
5. **Gate.** `pnpm lint`, then `pnpm check`. Grid UI changes are also checked in a real browser, light and dark.

**Models, chosen by what a mistake costs.**

| Work | Model | Why |
| --- | --- | --- |
| The count question's rule; the view-words reader; the group order and total semantics | Fable | The hardest reasoning here, and a mistake is a wrong view |
| Compiler, validation, reducer, `applyView`, both adapters, the TanStack spikes, the rendered-rows test; every review | Opus | Subtle code with wrong-view risk, on well-defined rules |
| Labelling; the HTML prototype; the demo and example grids; Site docs; the agent skill | Sonnet | Well-specified work with tests or a prototype to hold it |
| `CONTEXT.md` lines, changelog lines, index entries, link checks | Haiku | Mechanical |

**Branches.** Each PR is a branch stacked on the one before it in the order plan, which is not always one of this plan's. The first stacks on `fix/reading-wrong-views` until PR #21 merges, then on `main`. Where each PR sits among the other opportunities' PRs is in `docs/superpowers/plans/2026-11-13-five-opportunities-order.md`: PR 1 is the second code PR of all, and PR 2 to PR 4 follow named filters. That plan also names the pieces this work owns for the others: the payload pin test (PR 1) and the seeded view generator (PR 3). It runs the work in waves: PR 0 is in wave 0, PR 1 in wave 1, and PR 2 to PR 4 are wave 3. A wave starts only when the one before it is cleared.

| Order | Branch | Title | Needs |
| --- | --- | --- | --- |
| 0 | `docs/operation-set-plan` | `docs(planning): finish the operation set: spec, plan, ADRs` | The owner's answers, given 2026-11-13 |
| 1 | `fix/count-follows-its-rows` | `fix(core): a count asks when its rows would change` | 0, and named filters' PR 1 |
| 2 | `feat/pin-and-density` | `feat(adapters): pin columns and set density on request` | 1, and more grids' PR 3 (`fix/grid-cant-group`) |
| 3 | `feat/totals` | `feat(core): totals, and one group order in both adapters` | 2, and named filters' PR 2 and PR 5 |
| 4 | `feat/tanstack-counts` | `feat(tanstack-table): show only the first rows on TanStack Table` | 3 |

PR 0 holds the grill log, this plan, the spec, ADRs 0027 to 0030, and the `CONTEXT.md` terms in spec section 8, so each code PR holds one concern. It edits no approved document: the order plan gives each of those edits to the code PR that lands the piece. On 2026-11-13 the owner asked for the PRs, and for each to be watched through review and CI (order plan, section 1).

**Live runs.** No sub-agent calls Jev. One live run before PR 3 merges waits for the owner's command.

**Shared files.** Other opportunities are planned at the same time. These files are likely to be touched by them too, so each PR rebases before its gate and the lead re-runs every set after a rebase: `core/compile.ts`, `core/normalize.ts`, `core/preview.ts`, `core/validate.ts`, `core/reduce.ts`, `core/rows-adapter.ts`, `core/schema.ts`, `tanstack/index.ts`, `test/adapter-contract.ts`, `evals/run.ts`.

## PR 0: The planning record (`docs/operation-set-plan`)

### Task 0.1: ADRs and terms (Haiku, then the lead reads them)
- [x] ADRs 0027 to 0030, the numbers the order plan reserves: `0027-a-count-follows-its-rows.md`, `0028-code-reads-closed-view-words.md`, `0029-two-gates-for-pins-totals-and-density.md`, `0030-totals-and-one-group-order.md`.
- [ ] `CONTEXT.md`: rewrite View State; add Total, Count and Pinned Column (spec section 8).
- [x] The spec and this plan name each ADR by its number.
- [x] The grill log holds the owner's answers.

## PR 1: A count follows its rows (`fix/count-follows-its-rows`)

Spec 4.1 (count forms only), 5.1, 5.2 (count rows). ADR 0027, without the TanStack part, and ADR 0028 for the count forms.

### Task 1.1: Label the count cases (Sonnet)
**Files:** new `evals/cases-count.jsonl`; a held-out set outside the repo.
- [ ] Dev: 30 follow-ups after a count (sort, clear sort, filter, clear filters, "show every row", "show only the first 5 rows", "show all accounts" with and without a filter), half wanting each outcome; 10 controls that must not ask (grouping, columns, a new count, reset). Each case carries the current view in its state.
- [ ] Held-out: 30 of the same kinds, written from spec 5.1 alone.
- [ ] Baseline with the Mock Provider on both, before any code. Today's wrong views are expected; record them.

### Task 1.2: Empty values in a count (Opus)
**Files:** `core/rows-adapter.ts`, `test/rows-adapter.test.ts`, `CHANGELOG.md`.
- [ ] Tests first: top N descending and ascending with `null` and missing values; fewer than N rows with a value; a count with no sort.
- [ ] `applyView` keeps only rows with a value in the first sorted column when it applies a count.

### Task 1.3: The count question and the count words (Fable)
**Files:** new `core/view-words.ts`, `core/compile.ts`, `core/preview.ts` (`diffViews`), `index.ts`, tests, `evals/evals.test.ts`.
- [ ] Tests first: one per row of the table in spec 5.1; the question never fires on a plan with its own count; each count form with one leftover word, which must not read.
- [ ] `readViewWords` with the count-clear and "show only the first N rows" forms, returning spans. Not stored on the Clause.
- [ ] The count question, asked after compiling, right after ADR 0019's check.
- [ ] `ViewDiff.countChanged`.
- [ ] A payload test: the provider request for every labelled request equals today's. This PR owns that pin test (order plan). Named filters, routing, the command bar and the four bets reuse it and say why whenever they update it.
- [ ] The count rule is one pure function of a plan's operations and the view it applies to, exported for the command bar's `edit` and View Parts to call.
- [ ] `cases-count.jsonl` in the gate. Bars: 0 wrong views on the dev set and on every existing set, no existing verdict worse.

### Task 1.4: Held-out run (lead)
- [ ] One run of the held-out set. Report exact, safe misses and wrong views. Bar: 0 wrong views. A wrong view goes back as a class, with a fresh held-out set.
- [ ] The set joins the repo as `evals/cases-count-heldout.jsonl`.

### Task 1.5: UIs and docs (Sonnet)
**Files:** `test/grid-cue-bar.test.tsx`, `registry/test/command-bar.test.tsx`, Site docs, `skills/gridcue/SKILL.md`.
- [ ] Component tests in both UIs: the count question shows two choices, and each answer previews its line.
- [ ] Site: `concepts/requests` (a count asks when its rows would change; the clearing words), `concepts/views`, `api/protocol`.
- [ ] `skills/gridcue`: counts and how to clear one. `pnpm check:skills`.
- [ ] ADR 0018's count bullet is rewritten, not added to: an empty value never fills a count, and a change to the sort or the filters asks (ADR 0027).
- [ ] The four bets plan, as the order plan's section 6 says: the payload pin test exists (task 2.3), and marks and the grammar cover the count-clearing words (tasks 2.4 and 4.2).
- [ ] Changelog (Haiku).

### Task 1.6: Review (Opus), then gate
- [ ] The reviewer hunts for a follow-up that changes which rows a count keeps without asking.
- [ ] `pnpm lint`, `pnpm check`.

**Owner sees before code:** nothing new; the question uses the existing clarification UI.

## PR 2: Pinning and density (`feat/pin-and-density`)

Spec 4.1 to 4.5 (pin and density rows), 5.2, 5.3, 9. ADR 0028, and ADR 0029's pinning and density half.

### Task 2.1: Prototype the grid (Sonnet)
- [ ] One throwaway HTML page, outside the repo: a wide grid with two start-pinned columns and one end-pinned column, scrolled; all three densities; a group row and a footer with totals; the count caption. Light and dark, with the exact values in spec section 9.
- [ ] The owner looks at it. Changes go into spec section 9 before any grid code. This covers PR 3's and PR 4's grid changes too.

### Task 2.2: Label the pin and density cases (Sonnet)
**Files:** new `evals/cases-view-words.jsonl`; a held-out set outside the repo.
- [ ] Dev: 40, with 10 adversarial: workflow verbs ("pin to my watchlist", "freeze the account", "lock the Alder household"), values that aren't columns ("pin the Northgate accounts"), a Host label that contains a form word, relative density words.
- [ ] Held-out: 40, the same mix, written from the draft docs page alone.
- [ ] Baseline with the Mock Provider, with and without `renders`.

### Task 2.3: Words, validation, reducer, Preview (Opus)
**Files:** `core/view-words.ts`, `core/compile.ts`, `core/reduce.ts`, `core/validate.ts`, `core/preview.ts`, `core/schema.ts`, tests.
- [ ] Tests first: each pin, unpin and density form in spec 5.2, each with one leftover word; each validation row for pins in spec 4.4; "Unpin all columns".
- [ ] The reducer removes a column from both pin lists before adding it.
- [ ] "Pin X" on a hidden column adds "Show X" first.
- [ ] `DEFAULT_CAPABILITIES` gains `"pin"`. A request for an operation the adapter doesn't list ends in "This grid can't …", with no choices and nothing applied, through the shared code that more grids' `fix/grid-cant-group` adds first (order plan). It is not an Unsupported Segment.
- [ ] `ViewDiff.pinsChanged`, `densityChanged`.
- [ ] Bars: 0 wrong views on the dev set and on every existing set; the payload test unchanged.

### Task 2.4: Both adapters and the contract suite (Opus)
**Files:** `core/rows-adapter.ts`, `tanstack/index.ts`, `test/adapter-contract.ts`, `test/rows-adapter.test.ts`, `test/tanstack.test.ts`. Needs 2.3.
- [ ] Tests first: the suite's "does not advertise" check becomes "lists each only when `renders` names it". For each listed operation: apply, read back, restore, undo, one notification per apply. `limit.set` gets the same checks. Each adapter runs the suite with and without `renders`.
- [ ] `renders` on both adapters. `ViewResult.pinned` and `density`; `columns` in pinned order.
- [ ] TanStack: `setColumnPinning` and `columnPinning` on `TanStackTableLike`; density held by the adapter and read back; a manual pin reported as a change. `INPUT_CONFIG` when `"pinning"` is named and the table has no `setColumnPinning`.

### Task 2.5: Held-out run (lead)
- [ ] One run of the held-out set, with and without `renders`. Bar: 0 wrong views; every adversarial case asks or is refused. Report exact share and the unread wordings that recurred.
- [ ] It joins the repo as `evals/cases-view-words-heldout.jsonl`.

### Task 2.6: Grids, examples, Site, skill (Sonnet)
**Files:** `apps/site/app/components/demo/wealth-table.tsx`, `use-wealth-demo.ts`, `apps/site/app/app.css`, `examples/vite/src/`, `examples/next/app/accounts-view.tsx`, `page.css`, Site docs, `skills/gridcue/SKILL.md`. Needs 2.1 and 2.4.
- [ ] The Site demo and the Vite example register `columnPinningFeature`, turn on `renders: ["pinning", "density"]`, and draw them with spec section 9's values. The Next.js example does the same with the Rows Adapter.
- [ ] Real-browser check in all three, light and dark, with a horizontally scrolled table. Before and after screenshots.
- [ ] Site: `concepts/views`, `concepts/requests`, `api/adapters` (`renders`), `api/schema` (defaults), `guides/build-an-adapter` (the contract suite), `guides/vite-tanstack`, `guides/next-rows-adapter`.
- [ ] `skills/gridcue`: the view includes pins and density; set `renders` only for what the table draws. `pnpm check:skills`.
- [ ] `docs/internals/product.md` (lines 52 to 56 and 162), `docs/internals/intent-protocol.md`, and the four bets spec for pins and density: line 56, and 5.3's `unsaid` list and sentence order. The four bets plan's tasks 2.4, 3.2 and 4.2 gain pins and density (order plan, section 6). Changelog (Haiku).

### Task 2.7: Review (Opus), then gate
- [ ] The reviewer hunts for a workflow phrase that reads as a pin, and a listed operation the Host's table might not draw.
- [ ] The browser bundle check: nothing from `gridcue/server` is reachable.
- [ ] `pnpm lint`, `pnpm check`.

## PR 3: Totals and one group order (`feat/totals`)

Spec 4.3 to 4.5 (totals rows), 5.2, 5.4, 9. ADR 0030, and ADR 0029's totals half.

### Task 3.1: The TanStack totals spike (Opus)
- [ ] Outside the repo: a TanStack 9.2.4 table with `gridcueAggregationFn` on `defaultColumn` that reads totals from adapter state. It must give per-group sums and averages, a grand total through `column.getAggregationValue()`, and redraw when only the totals change.
- [ ] Report to the lead. If it fails, `"totals"` stays off the TanStack adapter in this PR, the Site demo shows totals only after a fix, and the owner hears it before Task 3.4.

### Task 3.2: Label the totals cases (Sonnet, two separate agents)
**Files:** new `evals/cases-totals.jsonl`; held-out sets outside the repo.
- [ ] Dev: 40 totals requests with 10 adversarial (text and percent columns, "per", "how much", "total" inside a label), and 15 "X households first" requests with and without `defaultMeasure`. Cases check a question's choices, not only its prompt.
- [ ] Held-out: 40 of the same mix and 15 ranked-group requests, from spec 5.4 alone.
- [ ] The totals sets also run on the ledger fixture from named filters' PR 2. This PR adds no schema.
- [ ] The natural set: 30 requests for totals, written by a second labeller who sees only the product doc and the schema, never the word list.

### Task 3.3: Totals, validation, group order (Fable for the rules, Opus for the code)
**Files:** `core/view-words.ts`, `core/compile.ts`, `core/validate.ts`, `core/errors.ts`, `core/preview.ts`, `core/schema.ts`, `core/rows-adapter.ts`, tests.
- [ ] Fable first writes the tests for the semantics: what a total counts, empty values, the kind rule, adding to existing totals, one total for each column ("total market value" then "average market value" replaces the total, and a group with 60 and 60 against a group with 100 ranks by the one that is left), "total X by Y", the three-choice question, and the group order in both rows of spec 5.4's table.
- [ ] Opus builds against them: the forms; `PLAN_AGGREGATION_KIND` and the duplicate check; Preview lines and the audit's columns; `defineSchema` adds `"aggregate"`; `ViewResult.totals` and `groups[].totals`; the Rows Adapter's group order; the third choice in the "as a whole" question (`compile.ts:365-372`).
- [ ] The Preview-line pin test from named filters' PR 2 is updated for the totals wording, and the PR lists each line that changed.
- [ ] Bars: 0 wrong views on the dev set and every existing set; the nine chassis prompts unchanged; the payload test unchanged.

### Task 3.4: TanStack totals and the rendered-rows test (Opus)
**Files:** `tanstack/index.ts`, `test/rendered-rows.ts` (started by named filters' PR 5), `test/tanstack.test.ts`, `test/rows-adapter.test.ts`, the contract suite. Needs 3.1 and 3.3.
- [ ] `gridcueAggregationFn`; totals held by the adapter and read back; `INPUT_CONFIG` when `"totals"` is named and the function isn't registered, if the adapter can see it.
- [ ] The seeded view generator, for any schema, placed where the package's tests and `evals/` can both import it. This PR owns it (order plan); `proposeView`, the command bar and the four bets reuse it.
- [ ] The rendered-rows test, grown from the file named filters' PR 5 started: 500 seeded grouped views on each of two row sets with ties and empty values. Bar: 100% equal rows, order, group order and totals. Where a row with no value in a sorted column sits is out of scope (spec section 3): the test checks both adapters keep those rows, and reports how many views differ only there.

### Task 3.5: Held-out run (lead)
- [ ] One run of the held-out sets. Bar: 0 wrong views. Report exact counts.
- [ ] The natural set: 0 wrong views, and its ask rate. Above half goes to the owner as evidence against ADR 0028. A wrong view from a word nothing reads, in a part this work doesn't cover, still fails the bar: the class is narrowed to a question, with a fresh held-out set, and no reading is added (order plan, D4).
- [ ] The rendered-rows test once more, on 500 views for each row set from seeds the lead draws after the build. Bar: 100% equal.
- [ ] The sets join the repo as regression sets.

### Task 3.6: Grids, examples, Site, skill (Sonnet)
**Files:** as Task 2.6. Needs 2.1 and 3.4.
- [ ] Group rows and the footer draw totals with spec section 9's values, in the Site demo and both examples, with `renders: ["totals"]` (TanStack only if Task 3.1 passed).
- [ ] Real-browser check, light and dark. Before and after screenshots, including a grouped view whose group order changed in the Next.js example.
- [ ] Site: `concepts/views`, `concepts/requests`, `api/adapters`, `api/schema`, `api/protocol`, `guides/vite-tanstack`, `get-started/describe-your-domain` (`defaultMeasure` now also ranks groups), and `safety` (its "does not compute answers or aggregate" sentence).
- [ ] `skills/gridcue`: totals and `gridcueAggregationFn`. `pnpm check:skills`.
- [ ] `docs/internals/product.md`, `intent-protocol.md`, and the four bets spec for totals: line 56, and 5.3's `unsaid` list and sentence order. The four bets plan's tasks 2.4, 3.2 and 4.2 gain totals (order plan, section 6). Changelog, with the group order change called out (Haiku).

### Task 3.7: Live run, review (Opus), gate
- [ ] The owner's command: one live run with Jev on every set. 0 wrong views, no drop in exact results.
- [ ] The reviewer hunts for a total on a column it doesn't fit, and a view where the adapters differ.
- [ ] `pnpm lint`, `pnpm check`.

## PR 4: Counts on TanStack Table (`feat/tanstack-counts`)

Spec 5.5, 9. ADR 0027's TanStack part.

### Task 4.1: The count spike (Opus)
- [ ] Outside the repo, both shapes from spec 5.5: a `filteredRowModel` wrapper with the count held by the adapter, and a GridCue table feature with the count in the table's store.
- [ ] Run the rendered-rows test on views with a count, grouped and not, for each shape. Keep the one at 100% that redraws when only the count changes.
- [ ] If neither meets the bar, stop here, keep today's note, and report to the owner.

### Task 4.2: The count piece and the adapter (Opus)
**Files:** `tanstack/index.ts`, `test/rendered-rows.ts`, `test/tanstack.test.ts`, the contract suite, `evals/run.ts`. Needs 4.1.
- [ ] Tests first: the rendered-rows test with counts; the contract suite's `limit.set` checks on TanStack with `renders: ["count"]`; 5.1's follow-ups on TanStack; `renders: ["count"]` on a table with manual pagination, sorting or filtering, which must throw `INPUT_CONFIG`.
- [ ] Export the piece under the name the spike chose. `renders: ["count"]` lists `limit.set`, never on a manual table.
- [ ] The lead runs the rendered-rows test with counts once more on seeds drawn after the build. Bar: 100% equal, grouped and not.
- [ ] The eval runner gains a TanStack run, so every set runs on both adapters in the gate. Bar: 0 wrong views on both.

### Task 4.3: Grids, Site, skill (Sonnet)
- [ ] The Site demo and the Vite example register the piece and show "First 10 of 48 rows".
- [ ] Real-browser check, light and dark. Before and after screenshots.
- [ ] Site: `api/adapters`, `guides/vite-tanstack`, `concepts/requests` (the note now appears only without the piece). ADR 0018's count bullet is rewritten: the TanStack Table adapter lists `limit.set` with GridCue's count piece (ADR 0027). If more grids' ADR 0032 has changed that bullet first, this PR edits its wording.
- [ ] `skills/gridcue`. `pnpm check:skills`. The four bets spec's line 58. Changelog (Haiku).

### Task 4.4: Review (Opus), then gate
- [ ] `pnpm lint`, `pnpm check`.

## Spec coverage

| Spec section | Tasks |
| --- | --- |
| 4.1 View words | 1.3, 2.3, 3.3 |
| 4.2 `renders` | 2.4, 3.4, 4.2 |
| 4.3 Column defaults | 2.3, 3.3 |
| 4.4 Validation | 2.3, 3.3 |
| 4.5 Preview, diff, audit | 1.3, 2.3, 3.3 |
| 5.1 A count follows its rows | 1.1 to 1.6 |
| 5.2 The words | 1.3, 2.3, 3.3 |
| 5.3 Pinning and density | 2.1 to 2.7 |
| 5.4 Totals and one group order | 3.1 to 3.7 |
| 5.5 Counts on TanStack | 4.1 to 4.4 |
| 7 ADRs, 8 terms | 0.1 |
| 9 UI | 2.1, 2.6, 3.6, 4.3 |
| 10 Evidence bars | 1.3, 1.4, 2.3, 2.5, 3.3 to 3.5, 4.1, 4.2 |
| 11 Surfaces | 1.5, 2.6, 3.6, 4.3 |
