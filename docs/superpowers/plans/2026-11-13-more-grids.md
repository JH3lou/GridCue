# More Grids Implementation Plan

Status: approved by the owner on 2026-11-13. Answers in docs/planning/more-grids-grill.md.

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. Each task names the model that runs it and the files it owns. Do not start a task whose "needs" are not done.

**Spec:** `docs/superpowers/specs/2026-11-13-more-grids-design.md`
**Decisions:** `docs/planning/more-grids-grill.md`, Round 1 (Q1 to Q7), with the fact check's change to Q7, approved as the order plan's D9, D23 to D28 and D3. ADRs 0031 to 0033 (spec section 7).
**Build order:** opportunity 3 of the five, before the four bets. Baseline: `fix/reading-wrong-views` (PR #21). Each PR stacks on it, and on the PR before it in the order plan, until they merge. Merging is the owner's.

## How the work is run

**Sub-agents, started by the lead.** Inside each PR the stages run in order, and the lead's checks between them decide what happens next.

1. **Label.** A labeller writes the dev and held-out sets from the spec section alone, before any code. Where a held-out set is seeds or harnesses, the lead picks them after the build and before the run. The lead spot-checks the labels.
2. **Build.** A builder sees the dev set, never the held-out set. It writes tests first, then the code, and runs the gate.
3. **Held-out run.** The lead runs the held-out set once and reports the numbers as they are, misses included. A wrong view goes back to the builder as a class, not as the failing case, and that class gets a fresh held-out set. The used held-out set joins the repo as a regression set.
4. **Review.** A reviewer sees the diff and the spec section, and nothing else.
5. **Gate.** `pnpm lint`, then `pnpm check`. Pages and messages are also checked in a real browser, light and dark.

**Models, chosen by what a mistake costs.**

| Work | Model | Why |
| --- | --- | --- |
| The Query Check's edges; AG Grid's filter meanings and the menu-filter reader | Fable | The hardest reasoning here, and a missed edge or a misread filter is a wrong view the Host never sees |
| Adapters, the Controller-facing wait, the compiler change, the example's Data Query; every review | Opus | Subtle code with wrong-view risk, on well-defined rules |
| Labelling; harnesses; the AG Grid spike; examples; Site docs; the agent skill | Sonnet | Well-specified work with tests to hold it |
| Changelog lines, `exports` and `tsdown` entries, docs `meta.json`, link checks | Haiku | Mechanical |

**Branches and order.** One concern per PR.

| PR | Branch | Title | Needs |
| --- | --- | --- | --- |
| 0 | `docs/more-grids-plan` | `docs(planning): more grids grill, spec, plan, and ADRs` | The owner's approval (given 2026-11-13) |
| 1 | `fix/tanstack-controlled-state` | `fix(tanstack-table): an apply is done only when the table holds it` | PR 0 (ADR 0031) |
| 2 | `docs/tanstack-v8-bridge` | `docs(tanstack-table): v8 apps reach GridCue through useLegacyTable` | PR 1 (stacked) |
| 3 | `fix/grid-cant-group` | `fix(core): a grid that can't group says so` | PR 0; named filters' PR 1 and the operation set's PR 1, which change `core/compile.ts` first |
| 4 | `feat/query-adapter` | `feat(core): a Query Adapter for rows the Host fetches` | PR 0 (ADR 0032); the operation set's PR 2 and PR 3, so the shared holder carries `renders` |
| 5 | `feat/query-check` | `feat(testing): a Query Check for a Host's own Data Query` | PR 4 (stacked); named filters' PR 2 (the ledger fixture) and PR 5 (whole days); the operation set's PR 1 (what a count keeps) |
| 6 | `feat/ag-grid-adapter` | `feat(ag-grid): an adapter for AG Grid Community` | PR 0 (ADR 0033), PR 1, PR 3, PR 5; the operation set's PR 2 to PR 4; named filters' PR 5 |

Where each PR sits among the other opportunities' PRs is in `docs/superpowers/plans/2026-11-13-five-opportunities-order.md`. PR 1 and PR 3 go early, with the other fixes, and PR 2 follows PR 1. PR 3 also builds the shared "this grid can't" result that the operation set reuses. PR 4 to PR 6 follow the operation set, so they are built on the filter, count and date meanings core holds by then. The Needs column above is the whole list. A "Needs" line under a PR's heading names only this plan's own PRs.

A PR is opened only when the owner asks. The owner asked on 2026-11-13: "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." The order plan's section 1 sets the waves: PR 0 is in wave 0, PR 1 to PR 3 in wave 1, and PR 4 to PR 6 in wave 4.

**What the owner sees before code.** The three ADRs (PR 0). The PR 3 messages, already in spec section 9. The results of task 6.1, before task 6.3 starts, if they change spec 5.6. Screenshots of each new example page, light and dark.

**Live runs.** None. Nothing here changes a provider request or how a proposal is checked.

## PR 0: The planning record (`docs/more-grids-plan`)

### Task 0.1: ADRs and glossary (Sonnet)
- [ ] ADRs 0031 (An apply is done when the grid holds it), 0032 (Rows on a server: the Host's own Data Query) and 0033 (AG Grid Community through AG Grid's own filters), the numbers the order plan reserves.
- [ ] ADR 0018: the `limit.set` bullet's sentence on a grid whose rows come a page at a time is rewritten to name ADR 0032. The operation set's ADR 0027 changes the same bullet in its own PR 1 and PR 4, which edit the wording they find.
- [ ] `CONTEXT.md`: Data Query, Query Adapter, Query Check; the Rows Adapter's pointer.
- [ ] The grill's owner's-answers table filled in verbatim.

### Task 0.2: Review (Opus), gate

## PR 1: An apply is done when the table holds it (`fix/tanstack-controlled-state`)

Spec 4.2 and 5.1. ADR 0031.

### Task 1.1: Harnesses (Sonnet)
**Files:** `packages/gridcue/test/tanstack.test.ts`, `packages/gridcue/test/adapter-contract.ts`.
- [ ] The new contract test, "applies, then undoes": apply a two-operation plan and expect `getState()` to hold the written state and the very Revision `apply` returned (today's defect); then `restore` the snapshot taken before, and expect the first state back with a new Revision.
- [ ] Three dev harnesses from spec section 10 that run the whole suite through `renderHook`: table-owned; Host-controlled sorting and filters with handlers; `useLegacyTable` Host-controlled.
- [ ] A fourth, Host-controlled sorting with no handler. It takes no write, so it runs one test: the apply fails and the table is unchanged.
- [ ] `@tanstack/react-table` 9.2.4, exact, in `packages/gridcue` dev dependencies.

### Task 1.2: The wait (Opus)
**Files:** `packages/gridcue/src/tanstack/index.ts`, `packages/gridcue/src/core/adapter.ts` (doc comment only), `packages/gridcue/src/core/controller.ts` (the recovery), tests. Needs 1.1.
- [ ] Tests first: owned returns in the same tick; controlled waits for the render; no handler fails after 1,000 ms and the Controller says "Nothing was changed"; a manual change during the wait fails with recovery; `restore` waits the same way.
- [ ] The recovery after a failed apply: a part of the view the plan writes is the plan's own only when it holds its old value or the value the plan wrote. Test: a sort apply waits, the User clicks a header and changes the sort, the wait fails, and the User's sort stays.
- [ ] After a write, compare the table's View State with the written one; wait on store notifications up to the bound; return the store's Revision.
- [ ] `GridAdapter.apply`'s doc comment states 4.2.

### Task 1.3: Held-out run (lead)
- [ ] Write the two held-out harnesses from spec section 10 after the build. Run the suite once. Report pass or fail per test, and the wait's median and worst.

### Task 1.4: Docs (Sonnet), changelog (Haiku)
- [ ] Site: `guides/vite-tanstack` (a controlled slice needs its handler; set state, then fetch), `guides/build-an-adapter` (the new test; an apply is done when the grid holds it).
- [ ] `skills/gridcue/references/troubleshooting.md`: "Undo refused on a controlled table" and its fix. `pnpm check:skills`.
- [ ] `packages/gridcue/CHANGELOG.md`.

### Task 1.5: Review (Opus), gate
- [ ] Both UIs: no change; a smoke check that apply and undo work in the Vite example.

## PR 2: v8 apps through `useLegacyTable` (`docs/tanstack-v8-bridge`)

Spec 5.2. Needs PR 1.

### Task 2.1: Label (lead)
- [ ] Name the six TanStack v8 examples from spec section 10 before the guide exists. Fetch them into scratch, outside the repo, at v8.21.3.

### Task 2.2: CI run and guide (Sonnet)
**Files:** `packages/gridcue/test/tanstack-legacy.test.ts`, `apps/site/content/docs/guides/tanstack-v8.mdx`, `apps/site/content/docs/guides/meta.json`.
- [ ] The contract suite on `useLegacyTable`, owned and Host-controlled.
- [ ] The guide: install `@tanstack/react-table@9`; change the import to `/legacy`; add GridCue as for v9; then move to `useTable`. It says React 18 is needed for v9 and 19 for `gridcue/react`, and that the Rows Adapter remains for apps that can't move.

### Task 2.3: Held-out run (Sonnet, a separate agent; lead reports)
- [ ] An agent that didn't write the guide moves each of the six examples using only the guide, in scratch. The lead reports how many run unchanged after the import change and what each other one needed. No bar; a failure goes to the owner.

### Task 2.4: Skill (Sonnet), links (Haiku)
- [ ] `skills/gridcue/references/setup.md`: the v8 row becomes the steps. `pnpm check:skills`.
- [ ] `get-started/quick-start` links the new guide.

### Task 2.5: Review (Opus), gate
- [ ] A throwaway copy of the Vite example on `useLegacyTable`, outside the repo, checked in a real browser, light and dark. Screenshots in the PR.

## PR 3: A grid that can't group says so (`fix/grid-cant-group`)

Spec 5.3.

### Task 3.1: Label (Sonnet)
- [ ] 25 dev requests on an adapter without `group.set`: grouping alone, grouping with a filter or sort, "ungroup", and controls where "group" is a value or a column label.
- [ ] 25 held-out requests of the same classes, outside the repo, written before any code.
- [ ] An eval mode that runs every existing set on an adapter without `group.set`, with expected results derived: a case whose expected plan groups must end not applied.

### Task 3.2: The prompt and the hint (Opus)
**Files:** `packages/gridcue/src/core/compile.ts`, tests, `evals/run.ts`, `evals/evals.test.ts`.
- [ ] Tests first, one per row of the table in spec 5.3.
- [ ] A grouping verb read by code, on a grid without `group.set`, ends in the required Clarification "This grid can't group rows." with no options. Nothing in the request applies.
- [ ] The result comes from one function that takes the operation the grid doesn't list, so the operation set's pins, density and totals reuse it (order plan). The count question the operation set's PR 1 asks on a grid without `limit.set` moves onto it.
- [ ] The Clarification's ID starts with its Clause's index, as the compiler's other questions do, so the command bar can show it beside its part (command bar spec).
- [ ] The hint at `compile.ts:661` lists only the grid's families.
- [ ] Bars on the dev set: 0 wrong views; on the Rows Adapter, every existing verdict unchanged.

### Task 3.3: Held-out run (lead)
- [ ] Run once. Report wrong views, exact, and safe misses. A wrong view goes back as a class.

### Task 3.4: Docs (Sonnet), changelog (Haiku)
- [ ] Site: `concepts/requests` (what a grid that can't group says).
- [ ] `packages/gridcue/CHANGELOG.md`.

### Task 3.5: Review (Opus), gate
- [ ] Both UIs show the new prompt in the status row: the Vite example on a test adapter without `group.set`, and the registry command bar. Light and dark.

## PR 4: The Query Adapter (`feat/query-adapter`)

Spec 5.4. ADR 0032.

### Task 4.1: Label (lead)
- [ ] The held-out run is every existing eval set on a default Query Adapter; no new labels. Confirm which cases expect `limit.set` (two today).

### Task 4.2: The adapter (Opus)
**Files:** new `packages/gridcue/src/core/state-adapter.ts` (the shared holder), `core/rows-adapter.ts`, new `core/query-adapter.ts`, `src/index.ts`, `test/query-adapter.test.ts`, `evals/run.ts`.
- [ ] Tests first: operations with defaults, with `countBeforePaging`, with `without`; each bad `without` name throws `INPUT_CONFIG` naming it; `setState`; Revisions `query:n`; `renders` lists pins and density only when named, and `renders: ["totals"]` throws `INPUT_CONFIG`.
- [ ] The contract suite on it.
- [ ] The Rows Adapter moves onto the shared holder with no change in behaviour: its tests pass unchanged.

### Task 4.3: Held-out run (lead)
- [ ] Every existing set on a default Query Adapter. Bar: 0 wrong views. By kind of request: a size word with a count ("top 10") ends as a sort with the count note; a request that only sets a count ("show only the first 5 rows") ends in "This grid can't show only the first 5 rows." with nothing applied; a request that clears a count ends as any clear of something the view doesn't have. The operation set's count sets are among the existing sets by then.

### Task 4.4: Docs (Sonnet), changelog (Haiku)
- [ ] Site: `api/adapters` (`createQueryAdapter`; the Rows Adapter is for rows in memory).
- [ ] `skills/gridcue/references/setup.md`: a row for rows on a server that names the Query Adapter. PR 5 adds the link to its guide, since `pnpm check:skills` fails on a link to a page that doesn't exist yet. `pnpm check:skills`.
- [ ] `packages/gridcue/CHANGELOG.md`.

### Task 4.5: Review (Opus), gate

## PR 5: The Query Check (`feat/query-check`)

Spec 4.1 and 5.5. Needs PR 4.

### Task 5.1: Label (Sonnet, two separate agents)
- [ ] The ledger fixture already exists (named filters' PR 2, order plan). Check it has number, date and date-and-time columns. Add nothing to `fixtures/`.
- [ ] At least 12 mutants: wrong translations of the View State, written from spec 4.1 and common SQL habits, as small functions over the example's query shape. Kept outside the repo until the held-out run. This agent never sees `queryCheck`.

### Task 5.2: `queryCheck` (Fable)
**Files:** new `packages/gridcue/src/testing/index.ts`, `test/query-check.test.ts`.
- [ ] Tests first: every edge in 4.1 produces a case, with the two rows core changed before this PR: a count never keeps a row with no value in the first sorted column, and a date means the whole day in the calendar's time zone; `notNull`; restricted columns never appear; a count case only with `limit.set` listed; `compare` names missing and extra ids, and checks order only where sort cells aren't empty.
- [ ] Synthetic rows from kinds and declared values; expected ids from `applyView`; seeded and deterministic.
- [ ] No test-runner import. No new dependency.

### Task 5.3: The example's Data Query (Opus)
**Files:** `examples/next/app/api/rows/route.ts`, `examples/next/app/api/rows/query.ts`, a Vitest test in the root run. Needs 5.2.
- [ ] Tests first: the Query Check on the wealth schema passes.
- [ ] `node:sqlite` in memory, seeded from the wealth fixture. If it fails to load in the route runtime, an in-memory SQL engine as a dev dependency of the example only, and the PR says why.
- [ ] Values are parameters. Column IDs are checked against the schema. A comment marks the query as Host code.

### Task 5.4: The page (Sonnet)
**Files:** `examples/next/app/paged/page.tsx`, its CSS.
- [ ] Load `emil-design-eng`, `better-ui` and `principle-experience-first` first.
- [ ] The Query Adapter, `<GridCueBar />`, a plain table, paging, and the Host's own loading and error states.
- [ ] Real-browser check, light and dark. Before/After and screenshots in the PR.

### Task 5.5: Held-out run (lead)
- [ ] The Query Check on the ledger schema against the example's query: report rows that differ (bar: 0).
- [ ] Each mutant against both schemas: report which cases caught it (bar: every mutant fails at least one).
- [ ] The mutants and the ledger cases join the repo as regression tests.

### Task 5.6: Docs (Sonnet), entries and links (Haiku)
- [ ] Site: the "Rows on a server" guide (spec 5.5); a new `api/testing`; `meta.json` entries.
- [ ] `package.json` `exports` and `tsdown` entry for `./testing`; `pnpm check:package`.
- [ ] `AGENTS.md`: the two lists of entries gain `gridcue/testing`. The owner approved the edit with the order plan's D2.
- [ ] `skills/gridcue`: the server-rows row links the guide; `pnpm check:skills`. The changelog.

### Task 5.7: Review (Opus, with a security pass on the example's query), gate
- [ ] The bundle leak check covers `/paged`, and no client bundle imports `gridcue/testing`.

## PR 6: The AG Grid adapter (`feat/ag-grid-adapter`)

Spec 5.6. ADR 0033. Needs PRs 1, 3, 5.

### Task 6.1: Spike (Sonnet), in scratch, before any adapter code
- [ ] Does AG Grid 36 run in jsdom under Vitest? If not, which browser runner, and what it adds.
- [ ] Run the defaults the grill only read: blank handling in not-equal and comparisons, `inRangeInclusive`, whether blank cells reach `textMatcher`, multi-column sort in Community, and whether `setFilterModel` then `getFilterModel` reads back in the same tick.
- [ ] Do AG Grid 34 and 35 have every `GridApi` call the adapter will use? Report the oldest that does.
- [ ] Does an Infinite Row Model datasource get called again after `setFilterModel` and `applyColumnState`?
- [ ] The lead reports the results to the owner. If any changes spec 5.6, the spec is updated before 6.3.

### Task 6.2: Label (Sonnet)
- [ ] At least 30 menu filter models a User can set in AG Grid's text, number and date filters, written from AG Grid's docs and spec 5.6 alone, each with the View State it should read as, or "unreadable". Outside the repo.
- [ ] `ag-grid-community` and `ag-grid-react` 36.3.0, exact, as dev dependencies where tests and examples need them.

### Task 6.3: The adapter (Opus)
**Files:** new `packages/gridcue/src/ag-grid/index.ts`, `test/ag-grid.test.ts`. Needs 6.1.
- [ ] Tests first: the contract suite on the Client-Side and Infinite row models; each creation check; an `in` with another filter on its column fails with `ADAPTER_UNSUPPORTED_FILTER` and nothing written; pins and an Enterprise grouping are written back unchanged.
- [ ] `AgGridApiLike`, `createAgGridAdapter`, `schemaFromAgGrid`. One apply writes, waits until the grid reads back what was written, then notifies once.

### Task 6.4: Meanings and the reader (Fable)
**Files:** `src/ag-grid/meanings.ts`, `src/ag-grid/read.ts`, tests. Needs 6.3.
- [ ] Date filters compare whole days in the schema calendar's time zone, as named filters' PR 5 defines them.
- [ ] `gridcueColDef(schema)`: the settings in spec 5.6, then the row check (the Query Check's cases through AG Grid on the wealth schema) decides, option by option, between AG Grid's setting and a custom option with GridCue's predicate.
- [ ] The reader: AND conditions, OR on one column, equals-OR-equals as `in`, and "unreadable" kept as the Host's.
- [ ] Bars on dev: 0 rows differ; same order where sort cells aren't empty.

### Task 6.5: Held-out run (lead)
- [ ] The ledger schema's cases and fresh seeds through AG Grid, on both row models. Report rows that differ (bar: 0) and where empty cells sort (no bar).
- [ ] The 30 menu filter models. Report misreads (bar: 0) and the share read.

### Task 6.6: Examples (Sonnet)
**Files:** new `examples/ag-grid/` (Vite), `examples/next/app/ag-grid/`.
- [ ] Load the three design skills first.
- [ ] The Vite example and the Next.js page, each with `<GridCueBar />` and the Mock Provider, Community modules only.
- [ ] Real-browser check, light and dark, in both. Before/After and screenshots in the PR.

### Task 6.7: Docs (Sonnet), entries and links (Haiku)
- [ ] Site: the "AG Grid" guide (Community only, tested majors, `gridcueColDef`, the Infinite Row Model with the server guide); `api/adapters`; `meta.json`; the marketing page's grid list, if it has one.
- [ ] `package.json` `exports` and `tsdown` entry for `./ag-grid`; `pnpm check:package`.
- [ ] `AGENTS.md`: the two lists of entries and the list of Grid Adapters gain `gridcue/ag-grid` and the Query Adapter. The owner approved the edit with the order plan's D2.
- [ ] `skills/gridcue/references/setup.md`: the AG Grid row; `troubleshooting.md`: each `INPUT_CONFIG` message. `pnpm check:skills`. The changelog.

### Task 6.8: Review (Opus), gate
- [ ] The bundle leak check covers both new pages.

## Spec coverage

| Spec section | Tasks |
| --- | --- |
| 4.1 Filter meanings | 5.2, 5.6, 6.4 |
| 4.2 An apply is done when the grid holds it | 1.1 to 1.5, 6.3 |
| 5.1 Host-controlled TanStack state | 1.1 to 1.5 |
| 5.2 TanStack Table v8 | 2.1 to 2.5 |
| 5.3 A grid that can't group | 3.1 to 3.5 |
| 5.4 The Query Adapter | 4.1 to 4.5 |
| 5.5 The Query Check and the guide | 5.1 to 5.7 |
| 5.6 The AG Grid adapter | 6.1 to 6.8 |
| 7 ADRs, 8 Terms | 0.1 |
| 9 UI | 3.5, 5.4, 6.6 |
| 10 Evidence | 1.3, 2.3, 3.3, 4.3, 5.5, 6.5 |
| 11 Surfaces | 1.4, 2.4, 3.4, 4.4, 5.6, 5.7, 6.6, 6.7, 6.8 |
