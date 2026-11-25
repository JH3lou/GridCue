# The Five Opportunities: Build Order

Status: approved by the owner on 2026-11-13.

**Date:** 2026-11-13
**Owner's direction:** "5 opportunities first then four bets in terms of build priority." (2026-11-13)
**Owner's approval:** "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13)

Five pairs of agents each wrote a grill log, a spec and a plan for one opportunity, without seeing the others' work. This plan puts their PRs in one order. It names the pieces more than one of them planned, and gives each piece one owner. It reserves the ADR numbers. It says what changes for the four bets. It lists what the owner must decide.

The five:

| Key | Opportunity | Spec | Plan |
| --- | --- | --- | --- |
| N | Filters for people, dates and house terms | `specs/2026-11-13-named-filters-design.md` | `plans/2026-11-13-named-filters.md` |
| O | Finish the operation set | `specs/2026-11-13-operation-set-design.md` | `plans/2026-11-13-operation-set.md` |
| G | Reach the grids enterprises run | `specs/2026-11-13-more-grids-design.md` | `plans/2026-11-13-more-grids.md` |
| R | Grid routing and saved views | `specs/2026-11-13-routing-and-saved-views-design.md` | `plans/2026-11-13-routing-and-saved-views.md` |
| C | A command bar people live in | `specs/2026-11-13-command-bar-design.md` | `plans/2026-11-13-command-bar.md` |

A PR is named by its key and its number in its own plan. N2 is named filters' PR 2.

The owner approved every recommended answer in section 7, and with it the five specs and plans. The owner's fixed target does not change: 0 wrong views, every mechanism tested on a held-out set labelled before the rule exists, and a question whenever a reading is not certain.

## 1. Before any code

1. Every PR below stacks on PR #21 (`fix/reading-wrong-views`), and each on the one before it, until they merge. Merging is the owner's.
2. Each opportunity's planning record is its own docs PR: the grill log with the owner's answers, the spec, the plan, its ADRs, and its `CONTEXT.md` terms. This file goes with the first of them.
3. The owner asked for the PRs, and for each to be watched through review and CI.

**Waves.** The work runs in waves, each a batch of workflows. A wave starts only when the one before it is cleared: every PR in it has a green `pnpm check` in CI and no open review comment.

| Wave | PRs |
| --- | --- |
| 0 | N0, O0, G0, R0, C0 |
| 1 | N1, O1, G1, G3, G2 |
| 2 | N2 to N5 |
| 3 | O2 to O4 |
| 4 | G4 to G6 |
| 5 | R1 to R3 |
| 6 | C1 to C5 |
| Then | The four bets, PR 2 to PR 5 |

## 2. The order

Fixes come first. Then each opportunity in the owner's order, except where one needs a piece another builds.

| Step | PR | Branch | Needs first | Why here |
| --- | --- | --- | --- | --- |
| 1 | N0 | `docs/named-filters-plan` | The owner's answers | Planning record. ADRs 0023 to 0026 |
| 2 | O0 | `docs/operation-set-plan` | The owner's answers | Planning record. ADRs 0027 to 0030 |
| 3 | G0 | `docs/more-grids-plan` | The owner's answers | Planning record. ADRs 0031 to 0033 |
| 4 | R0 | `docs/routing-and-saved-views-plan` | The owner's answers | Planning record. ADRs 0034 and 0035. The owner makes the `AGENTS.md` rule 1 edit by hand |
| 5 | C0 | `docs/command-bar-plan` | The owner's answers | Planning record. ADRs 0036 to 0040 |
| 6 | N1 | `fix/quoted-text-and-date-wrong-views` | N0, PR #21 | A wrong view that is ready to apply today: `advisor is not "Avery Lane"` shows the rows the User left out. Every fix asks |
| 7 | O1 | `fix/count-follows-its-rows` | O0, N1 | A wrong view today: a count silently follows a new sort or filter. Starts `core/view-words.ts`. Adds the payload pin test |
| 8 | G1 | `fix/tanstack-controlled-state` | G0 | "View updated." when the table took nothing. Touches the TanStack adapter and the adapter contract suite, not the compiler, so it can run beside steps 6 and 7 |
| 9 | G3 | `fix/grid-cant-group` | G0 | Small. Builds the one "this grid can't" result that O2 reuses. It changes `core/compile.ts`, so it goes after steps 6 and 7 |
| 10 | G2 | `docs/tanstack-v8-bridge` | G1 | Docs and a CI run. No package code. Can run beside steps 11 to 14 |
| 11 | N2 | `feat/text-forms` | N1, O1 | Adds the ledger fixture and the placed-words check. Makes `buildResolutionRequest` pick its fields. Adds the Preview-line pin test |
| 12 | N3 | `feat/house-terms` | N2 | Reuses N2's path. Adds the Site-suggestions test |
| 13 | N4 | `feat/local-values` | N3 | Needs a real Host application run before it merges |
| 14 | N5 | `feat/relative-dates` | N4 | Changes what a date filter means on date-and-time columns. Starts the shared rendered-rows test. G5 and G6 must come after it |
| 15 | O2 | `feat/pin-and-density` | O1, G3 | Adds `renders`. Reuses G3's result for a grid that doesn't draw pins. It follows N by the owner's order, not by need |
| 16 | O3 | `feat/totals` | O2, N2, N5 | Builds the seeded view generator. Grows the rendered-rows test N5 started. Its totals sets run on the ledger |
| 17 | O4 | `feat/tanstack-counts` | O3 | Rests on a spike. Stops cleanly if the spike fails, and blocks nothing after it |
| 18 | G4 | `feat/query-adapter` | O2, O3 | Shares a state holder with the Rows Adapter, which O2 and O3 change first |
| 19 | G5 | `feat/query-check` | G4, N2, N5, O1 | Its table of filter meanings must already hold whole days and what a count keeps |
| 20 | G6 | `feat/ag-grid-adapter` | G1, G3, G5, N5, O2 to O4 | The largest adapter. It must cover or not list what O added |
| 21 | R1 | `feat/propose-view` | R0, O3, N2 | Builds `proposeView` once. Uses the generator and the ledger |
| 22 | R2 | `feat/saved-views` | R1, N3, N4 | Its name-collision rule must know House Terms and Local Values. Starts with the one bar prototype |
| 23 | R3 | `feat/grid-routing` | R2 | Moves the input's text into the hook. Adds the households fixture as the target grid |
| 24 | C1 | `feat/edit-preview` | C0, R2, O1, N3 | An edit must pass the count rule and keep a House Term's lines together |
| 25 | C2 | `feat/row-count` | C1, O3 | Uses the generator |
| 26 | C3 | `feat/answer-in-words` | C2, R3, N2 | Uses the text in the hook. `buildResolutionRequest` already picks its fields |
| 27 | C4 | `feat/current-view` | C3, R1 | Removal goes through `proposeView` |
| 28 | C5 | `feat/starters` | C4 | Last. The four bets' reading line shares its row |

Then the four bets: PR 2 (as-you-type), PR 3 (the View Sentence), PR 4 (the Local Resolver), PR 5 (terse requests), as their plan orders them.

**What can run side by side.** G1 and G2 touch files nothing else in steps 6 to 14 touches. Everything else changes `core/compile.ts`, `core/controller.ts`, the adapters or the bar, so it runs in order. Each PR rebases before its gate, and the lead runs every set again after a rebase.

**What a failed spike does.** O4 may stop (TanStack counts). O3 may ship totals without TanStack. G6's spike may narrow AG Grid's tested versions. None of these blocks a later step.

## 3. Shared pieces, and who owns each

More than one plan meant to build each of these. One PR builds it. The others use it.

| Piece | Owner | Used by | What was planned before |
| --- | --- | --- | --- |
| The payload pin test: the provider request for every labelled request equals the last recorded one | O1 | N2 to N5, R2, R3, C3, four bets PR 2 | O, N, R, C and the bets each planned their own |
| `core/view-words.ts`: closed forms read by code | O1, grown in O2 and O3 | N2 imports its form words. The Local Resolver calls it | N said "whichever lands second moves both into one module". They stay two modules: a reader and a check |
| The count rule, as one function of a plan and its view | O1 | C1 (edits), C4 (removals), C5 (the sort starter). Not `proposeView` | C had no rule for a view with a count |
| The "this grid can't" result: a question with no choices, nothing applied | G3 | O2 and O3 (pins, density, totals without `renders`), G4, G6 | O said "unsupported" and an Unsupported Segment. G said a question |
| The ledger fixture (two name columns, date, date-and-time, number, currency, percent, category, yes/no), and a schema per case file in `evals/run.ts` | N2 | O3, G5, G6, R1, R2, C1 to C5, four bets PR 3 and PR 4 | N and G each planned a ledger. R planned households as its second schema. C planned an inline one. O planned its own |
| `buildResolutionRequest` picks the fields it sends | N2 | C3 (`Clause.source`), four bets PR 2 | C3 and four bets PR 2 each planned it. N would have sent two new literal fields |
| `core/placed.ts`: every word beside a code-read filter is placed | N2, grown in N3 to N5 | The Local Resolver replaces it | — |
| The Preview-line pin test | N2 | O3 (totals wording), N5 (date wording), C4 (the words move) | N and C each planned one |
| A test that every request the Site demo suggests gives the plan it promises | N3 | C5 (starters), four bets PR 4 | C5 planned it, after N had already changed the suggestions |
| `packages/gridcue/test/rendered-rows.ts`: both Grid Adapters keep the same rows | N5 starts it (filters). O3 adds groups, order and totals. O4 adds counts | — | N said the contract suite would compare rows. It compares state |
| The seeded view generator | O3 | R1, C2, C4, C5, four bets PR 3 | R1, C2 and four bets task 3.1 each planned `evals/views.ts` |
| The shared state holder for adapters that hold the View State | G4 | The Rows Adapter and the Query Adapter. It carries O2's `renders` | — |
| `proposeView`, `INPUT_INVALID_VIEW`, and its property test | R1 | R2, C4, C5, four bets PR 3 | R1, C4 and four bets task 3.3 |
| One throwaway prototype of the whole bar | R2 (Task 2.1) | The command bar checks and extends it before C1's component code. Four bets task 2.1 updates it | R, C and the bets each planned a bar prototype. O's grid prototype is a different page |
| `previewLabels` and `statusLabel` | R2 | C1 to C5 | — |
| The input's text in the hook (`text`, `setText`) | R3 | C3, four bets PR 2 (`read`) | R3 needed it for `initialRequest`. C3 planned it |
| The households fixture | R3 | The target grid only | R1 planned it as a second schema |
| `Clause.source` spans | C3 | Four bets PR 2 adds the character map under the same field | Four bets task 2.3 |
| `core/words.ts` | C2 starts it. C4 moves the Preview's words in | Four bets PR 3 adds the reading half | Four bets task 3.2 |
| `describeViewParts` and the current-view line | C4 | Four bets PR 3 builds `describeView` on it | The bets planned a `viewSentence` prop and `view-sentence.tsx` |
| The adapter contract suite | Each adds its own tests: G1 (apply, then undo), O2 (`renders`, `limit.set`), N5 (date filters), R1 (`proposeView`) | Every adapter | — |

**One order for reading a request,** once all five are in. Each spec added a step without seeing the others.

1. The Controller checks the length, the number of parts, and restricted columns, as today.
2. Named filters' House Terms and Local Values are matched, longest name first.
3. With `savedViews` or `grids` set, routing's four frames run. A whole Local Value is never a grid's name.
4. The provider is called as today. Its request is built from the same input as today.
5. The compiler reads each part: the operation set's view words first, for a whole part or not at all. Then named filters' code-read filters, with the placed-words check. Then the provider's choices, narrowed by ADR 0022 and the limit on its picks.
6. After compiling: ADR 0019's check, then the count question.
7. An operation the grid doesn't list ends in "This grid can't …".
8. The Preview. An edit or a removal runs validation and the count rule again.

## 4. ADR numbers

Each planning record takes a block, so no two collide whatever order they merge in.

| Number | Title | From | Needed by |
| --- | --- | --- | --- |
| 0023 | Beside a code-read filter, every word is placed | N, ADR D | N2 |
| 0024 | House Terms | N, ADR B | N3 |
| 0025 | GridCue reads Local Values in the browser | N, ADR A | N4 |
| 0026 | A date in a request becomes fixed days | N, ADR C | N5 |
| 0027 | A count follows its rows | O, ADR C | O1, and O4 for TanStack |
| 0028 | Code reads closed view words | O, ADR A | O1 |
| 0029 | Two gates for pins, totals and density | O, ADR D | O2 |
| 0030 | Totals, and one group order | O, ADR B | O3 |
| 0031 | An apply is done when the grid holds it | G, ADR C | G1 |
| 0032 | Rows on a server: the Host's own Data Query | G, ADR A | G4 |
| 0033 | AG Grid Community through AG Grid's own filters | G, ADR B | G6 |
| 0034 | Saved views through the Host | R | R1 |
| 0035 | Offering a declared grid | R | R3 |
| 0036 | A User's edit to a Preview is a new plan | C | C1 |
| 0037 | The Host counts rows, and zero rows is information | C | C2 |
| 0038 | Every open question shows, and each can be answered in words | C | C3 |
| 0039 | The current view reads as parts, and each part can be removed through a Preview | C | C4 |
| 0040 | Recent requests are off unless the Host turns them on | C | C5 |

Accepted ADRs these touch. Each new ADR names what it changes, and the old text is rewritten, not added to.

- **ADR 0018.** 0027 says TanStack lists `limit.set` with GridCue's count piece. 0032 says a backend that sorts and cuts before paging can show the true first ten. Both change the same bullet, so the second to merge edits the first's wording.
- **ADRs 0019 and 0022.** 0036 limits them to the plan a request produced. An edited plan is not checked against the request's words.
- **ADR 0020.** 0023 and 0028 are its first two slices. The Local Resolver replaces `core/placed.ts` and calls `readViewWords`.
- **ADR 0021.** 0034 rewrites its last paragraph ("GridCue ships no saved-views feature"). 0039 adds a line: the current view's parts can be removed through a Preview.

## 5. Edits to approved documents

These need the owner's sign-off (D2). The PR that lands each piece makes the edit.

| Document | Edit | PR |
| --- | --- | --- |
| Four bets spec, line 56 | "Starts with", empty and not empty become reachable | N2 |
| Four bets spec, line 56 | Pinning and density become reachable; then totals | O2, O3 |
| Four bets spec, line 58 | `limit.set` reaches TanStack Table, if the spike passes | O4 |
| Four bets spec, 5.3 `unsaid` list and sentence order | A pinned column, a total and a density become typeable. Totals, pins and density join the order | O2, O3 |
| Four bets spec, line 54 | Saved views exist, through the Host | R2 |
| Four bets spec, line 55 and section 7's last row | Parts of the current view can be removed. The Preview panel and the questions change | C0 |
| Four bets spec, section 6 | `viewSentence` and `view-sentence.tsx` give way to `currentView` and `view-parts.tsx` | C4 |
| Four bets plan | Section 6 below | With each PR |
| ADR 0021 | Two edits, as in section 4 | R0, C0 |
| ADRs 0019 and 0022 | Each is limited to the plan a request produced (ADR 0036) | C0 |
| ADR 0022 | "Three places" gains a fourth, beside a code-read filter (ADR 0023) | N2 |
| ADR 0018 | One sentence for a backend that sorts and cuts before paging (ADR 0032). The count bullet (ADR 0027). The `defaultMeasure` bullet gains group ranking (ADR 0030) | G0. O1 and O4. O3 |
| `AGENTS.md` rule 1 | One sentence: GridCue may offer to open a Declared Grid, and the Host navigates. The owner makes this edit by hand | R0 |
| `AGENTS.md` entry lists | `gridcue/testing`, `gridcue/ag-grid`, the Query Adapter | G5, G6 |
| `docs/internals/product.md` | Lines 32, 52 to 56, 65, 90, 94, 111 and 162 | N3, N4, O2, O3, R3, C1, C3 |
| `apps/site/content/docs/safety.mdx` | "It does not compute answers or aggregate" (O3). "Navigates to other screens" (R3). What is read in the browser and never sent (N4, C2, C5) | As listed |

The rows for ADRs 0018, 0019 and 0022 were added after the approval, when the planning records were written: section 4 already said each new ADR rewrites the old text it changes. Developer docs and `docs/internals/` pages follow the code they describe, in the PR that changes it, and are not listed here.

## 6. What changes for the four bets' plan

The bets start after step 28. Their order does not change. Much of their groundwork is built by then.

| Bets task | Change |
| --- | --- |
| 2.1 Prototype the bar | The prototype exists (R2, checked in C0) with the bets' lines in it. The task updates it |
| 2.3 Positions and the cached matcher | `Clause.source` holds each part's span (C3). The task adds the character map under it. `buildResolutionRequest` already picks its fields (N2), and the payload pin test exists (O1). The cached matcher is still to build |
| 2.4 `read` | Marks must also cover what the five added: text and empty forms, House Terms, Local Values and date forms (`readCodeFilters` returns spans), view words (`readViewWords` returns spans), a saved view's name and a grid's name. "No marks when a part starts with a refused verb" must let "open" and "go to" through when a saved view or a Declared Grid follows. `read` reuses the Local Values index and decides when it refreshes |
| 2.5 Both UIs | The input's text is in the hook (R3). The hint row exists (C5): starters when the input is empty, the reading line while typing, the status otherwise |
| 3.1 Second schema and generator | Nothing left to build. The ledger (N2) and the generator (O3) exist |
| 3.2 One vocabulary and `describeView` | `core/words.ts` exists (C4). The task adds the reading half. `describeView` is built on `describeViewParts` (C4), and the round trip may change a part's words. The sentence must word exact text, "is empty", "starting with", fixed dates, totals, pins and density, and each must type back |
| 3.3 `proposeView` and `ControllerState.view` | Only `ControllerState.view` is left |
| 3.4 Both UIs, examples, docs | The sentence shows in the current-view line (C4). No `viewSentence` prop and no `view-sentence.tsx`. The examples already save and open views (R2). The guide "Save and share a view" becomes a section on sharing by link in the "Saved views" guide |
| 4.1 Two fresh sets | They must hold the new forms. "All existing sets (188)" becomes every set in the repo by then |
| 4.2 The grammar | It gains rows for text forms, empty, House Terms, Local Values and date forms (N), and for pins, density, totals and count-clearing (O). It replaces `core/placed.ts` and must give the same result on every N set. It treats "this grid can't" as final. Routing's frames run before it |
| 4.5 The Site demo | The test of the demo's suggestions exists (N3). It now runs on the Local Resolver. The demo's chips are the package's starters (C5) |
| 5.3 Tab completion | No change. Starters never show while the User types |
| Section 8, the gate | "Every set with the Mock Provider and with the Local Resolver alone" now covers many more sets. See the risk in section 10 |

**One thing the bets no longer own.** Words dropped beside a reading ("taxable accounts for Lane" previews Taxable alone) were left for the Local Resolver. With the bets later, that wait is longer. D4 says what happens meanwhile.

## 7. Decisions for the owner

The owner approved every recommended answer below on 2026-11-13. The IDs run in build order: D6 gates step 6, D7 and D8 step 7, and so on. The tables group them by opportunity, so the numbers skip within a table. Only the approved answer is shown; each grill has the full options. D3, D4, D5, D43 and D45 came from the check, and no grill asks them.

Two trims were recommended to the owner in the same message, and the lead reads the approval as covering them. "This week" and "last week" are asked about, so there is no `weekStart` (D15, D17). A saved view's name is matched exactly only (D32).

**Before any code**

| ID | Decision | Approved |
| --- | --- | --- |
| D1 | The order of the 28 PRs | Section 2: fixes first, then N, O, G, R, C, with shared pieces built by their first user |
| D2 | Edits to approved documents | Approve the list in section 5 once. The PR that lands each piece makes its edit. The owner makes the `AGENTS.md` rule 1 edit by hand |
| D3 | How GridCue says a grid can't do something | A question with no choices ("This grid can't group rows."), nothing applied, from one shared piece of code. No protocol change. The other way is a new unsupported category, which needs an ADR |
| D4 | A natural held-out set finds a wrong view from a word nothing reads, in a part this work doesn't cover | The bar stays at 0. The class is narrowed to a question, with a fresh held-out set. No reading is added. N2 also reports how many ready plans on every set hold an unplaced word |
| D5 | Names that collide | **Count** stays for "top 10". C's glossary term becomes **Rows Shown**, with `countRows` and `rowCount` kept in code. `terms` becomes `houseTerms`, since the root entry exports `unknownTerm`. A Host callback that throws while a request is read is `INPUT_`; one that throws at Apply is `ADAPTER_` |

**N: named filters**

| ID | PR | Decision | Approved |
| --- | --- | --- | --- |
| D6 | N1 | The wrong views found in the grill | Fix them first, in their own PR. Every fix asks; none adds a reading |
| D10 | N2 | The smaller gaps | Read empty, "starts with" and "exactly". Keep asking about either-or |
| D11 | N2 | Words beside a code-read filter | Every word in the part is placed, from a closed list, or GridCue asks. A provider's picks are limited to what the words name |
| D12 | N3 | What a House Term is | A named list of fixed conditions in the View Schema, all of which must hold. Never sent. A left-out term asks |
| D13 | N4 | How the Host lets GridCue read the grid's values | A `localValues` option on `createGridCue`: a function per text column. Off unless set. Nothing is sent |
| D14 | N4 | What counts as naming a value | A whole value is certain. One word of a value asks, with at most five choices |
| D15 | N5 | Which dates GridCue reads | A closed list, each with one meaning. The Preview always shows the dates. Anything else that looks like a date asks, "this week" and "last week" included |
| D16 | N5 | The dates or the words | The view keeps fixed dates. The plan's evidence keeps the words |
| D17 | N5 | The clock and the calendar | The calendar in the View Schema, the clock on the Controller, both defaulting to the browser's. The calendar is the time zone and the first month of the year |

**O: the operation set**

| ID | PR | Decision | Approved |
| --- | --- | --- | --- |
| D7 | O1 | A count when the sort or the filters change | Ask: "Keep only the first 10 rows of the new view, or show every row?" An empty value never fills a count |
| D8 | O1 | How a request reaches the new operations | Code reads a small, closed set of words. Columns come only from Mentions. The protocol stays 0.1 |
| D18 | O2 | Which columns may pin and total | Two gates. Columns: pinning on, totals on for number, currency and percent. Grids: each adapter lists them only when the Host's `renders` says its table draws them |
| D19 | O2 | The words for pinning and density | Narrow words. "Freeze" only with "column". "Denser" and "tighter" ask |
| D20 | O3 | What a total is | Sums and averages only. The column's kind picks which |
| D21 | O3 | Ranking groups by their total | One group order for both adapters, TanStack's. The Rows Adapter changes to match. "Largest households first" gains a third choice |
| D22 | O4 | Counts on TanStack Table | A piece the Host registers, if a spike shows it keeps exactly `applyView`'s rows. Never on a manual table |

**G: more grids**

| ID | PR | Decision | Approved |
| --- | --- | --- | --- |
| D9 | G2 | TanStack Table v8 | Reach it through TanStack's own `useLegacyTable` bridge. No v8 entry |
| D23 | G4 | The adapter for a server grid | A named Query Adapter, without `limit.set` unless the backend cuts before paging. Its `without` option only removes |
| D24 | G4 | When an apply is done on a server grid | When the View State changes. The Host's fetch follows, and its errors are the Host's |
| D25 | G5 | What a server-data Host gets | A guide, a tested example, and a Query Check in `gridcue/testing`. No translator |
| D26 | G6 | AG Grid editions | Community only: Client-Side and Infinite row models, no grouping |
| D27 | G6 | AG Grid filters | AG Grid's own filters, set to GridCue's meanings by `gridcueColDef(schema)`, and read back |
| D28 | G6 | The AG Grid entry and its dependency | `gridcue/ag-grid`, typed structurally, no peer dependency, checked at creation |

**R: routing and saved views**

| ID | PR | Decision | Approved |
| --- | --- | --- | --- |
| D29 | R1 | Pieces pulled forward from the four bets | Build `proposeView` once, in R1, exactly as four bets 5.3 and ADR 0021 describe it. C3 pulls forward each part's span |
| D30 | R2 | What saved views do by request | Open and save, through a Host `savedViews` option. GridCue never stores a view. This rewrites ADR 0021's last paragraph |
| D31 | R2 | How a save is confirmed and undone | Previewed, saved on Apply. A name in use is never replaced. Undo removes it |
| D32 | R2 | How a request names a saved view | An explicit frame and an exact name; a near name is not matched. "Show" needs "view". A name that also reads as a change here asks. The Host's list is never sent |
| D33 | R2 | Audit events for saves and routes | Widen `audit.onEvent` to a union. A Host with a narrowly typed handler gets a type error. The other way is a second callback |
| D34 | R3 | What a request for another grid does | Offer, never jump. The Host's `onRoute` navigates. This adds one sentence to `AGENTS.md` rule 1. A route has no undo, and one chosen in a question has no Preview |
| D35 | R3 | How GridCue decides a request is about another grid | In code only, from a `grids` option. No protocol change. No router object |
| D36 | R3 | What another record's noun means once its grid is declared | It never filters this grid without the User's choice. Without a declared grid, nothing changes |

**C: the command bar**

| ID | PR | Decision | Approved |
| --- | --- | --- | --- |
| D37 | C1 | What the User can edit in a Preview | Drop a line, and change a filter's value. No provider call. Tied lines drop together |
| D38 | C1 | How the Controller grows | A few narrow verbs, each ending in a fresh Preview: `edit`, `answer(id, { text })`, `proposeView`, `countRows` |
| D39 | C2 | Where the row count comes from | An optional `countRows(state)` the Host passes. The adapter interface does not change |
| D40 | C2 | What a count of zero does | It says "No rows match." Apply stays |
| D41 | C3 | How questions are asked and answered | Every open question shows. A typed answer must match one choice. A question with no choices takes a new wording of its part |
| D42 | C4 | The current view in the bar | One line of removable parts. The × proposes a removal through a Preview. This amends ADR 0021 |
| D43 | C4 | Removing the sort or a filter part on a view with a count | Ask the count question first. Each answer is a whole view shown in a Preview. The other way: the sort part and the count go together |
| D44 | C5 | Starters | Only at an empty, focused input, at most five: the Host's examples, recent requests, then schema starters |
| D45 | C5 | Recent requests by default | Off unless the Host sets `recent: true` or passes a store. `AGENTS.md` says raw Utterances are never recorded without explicit Host configuration. C's grill had them on, in memory |

## 8. Evidence bars the check found weak

Each fix is now in the spec and plan it belongs to.

| Mechanism | What was weak | What changed |
| --- | --- | --- |
| The limit on a provider's picks (N 4.2) | Tested only by the builder's own fake provider, and by a live run that waits for the owner's command | A dev and a held-out set of scripted provider answers, written before the code |
| Natural sets (N) | The bar is 0 wrong views, but the spec puts one class of wrong view out of scope. The bar could only be met by leaving those cases out | The bar stays. D4 says how the class is handled |
| Group order, totals and TanStack counts (O) | The rendered-rows test ran only on seeds the builder sees | A second run on seeds the lead draws after the build |
| The open frame (R) | The held-out set used the same 8 names the builder saw | 15 held-out requests on a second list over the ledger, with a House Term and a Local Value among the names |
| Routing (R) | The held-out set used the same four grids the builder saw | 15 held-out requests on a second grid list; 5 with a House Term or a Local Value before another grid's noun |
| Edits and removals on a view with a count (C) | No bar. Either could change which rows a count keeps | A bar and sets for each |
| Schema starters (C) | A dev set only | 20 more views on a seed the lead draws |

Still weak, and not fixable in a plan:

- **Nothing was run with Jev.** Every number in the five grills is from the Mock Provider. Live runs wait for the owner's command: one for each of N1 to N5, and one each before O3, R3 and C3 merge. G has none, and needs none.
- **AG Grid's behaviour was read, not run.** G6's spike runs it before any adapter code.
- **TanStack totals and counts rest on spikes** (O3, O4).
- **The v8 bridge's run of six examples has no bar.** The contract suite is its bar.
- **Real names were not tested.** The fixture has 5 advisors and 12 households, invented to be distinct. A real Host application run before N4 merges reports counts only.
- **Empty values in a count** (O1) have unit tests and no held-out set until O4's rendered-rows run.

## 9. Scope notes

Two things were cut, as section 7 says. These are the other places the five go beyond the smallest thing. The owner may trim any of them.

- **C:** narrowing 200 choices as the User types, and typed answers to questions that already have choices.
- **G:** two AG Grid examples and a paged page. Rule 5 asks for Vite and Next.js, so these stay.
- **The whole:** 23 code PRs, 5 planning records and 18 ADRs before the four bets start.

## 10. Risks of this order

- **A known class of wrong view waits.** "Show large taxable accounts" previews Taxable alone until N3. "Taxable accounts since january" until N5. A word nothing reads, until the Local Resolver. No labelled set holds these today, so every gate passes with them in place.
- **The gate grows.** Every set runs on the Rows Adapter, then also on TanStack (O4), on a grid with no grouping (G3) and on a Query Adapter (G4), with terms, values and a calendar on (N), and with saved views and grids declared (R). The bets add the Local Resolver. Someone must watch the time `pnpm check` takes.
- **The bar gains many things before the bets add theirs.** One prototype of the whole bar comes before any component code, so the owner sees it all at once.
- **Rebases.** Almost every code PR touches `compile.ts`, `controller.ts`, an adapter or the bar. The order is linear for that reason.
- **Part labels may change twice.** C4 words the parts. The bets' round trip may change the words.

## 11. Settled by the lead when the records were written

The review of each planning record left these to the lead. None changes an approved answer.

| Wave | Point | Settled |
| --- | --- | --- |
| 1 | A count set on a grid that keeps none (O1) | A question with no choices, "This grid can't show only the first 5 rows." G3 moves it onto the shared result |
| 1 | The ID of the "this grid can't" question (G3) | It starts with its Clause's index, so the command bar can show it beside its part |
| 1 | ADR 0018's count bullet | G0 adds the sentence for a backend that cuts before paging. O1 rewrites the bullet and keeps that sentence |
| 1 | "Show every row" where there is no count to clear (O1) | Read only on a grid that lists `limit.set`, and not on a filtered view with no count, where it may mean the rows the filters leave out. Elsewhere it goes to the provider as before, which is narrower than the operation set spec's 5.1 and errs toward asking |
| 1 | Count words said before a change in the same request (O1) | "Show only the first 5 rows, sorted by advisor" asks, as does a count word before a reset. Said after the change, the count is the request's own and reads |
| 1 | What "no value" means for a count (O1) | `null`, a missing key, an empty string and `NaN`, as `isEmpty` in core already says |
| 1 | A Host handler that stores something other than what it is given, or stores it after the bound (G1) | Documented, not handled in code. The apply fails after 1,000 ms; the table keeps what the handler stored, and it can't be undone. The owner decides whether the bound becomes an adapter option or the message names the handler |
| 1 | A Host listener that changes another part of the view on the same notification that holds GridCue's write (G1) | Left as the spec has it: the apply fails with "the view changed meanwhile", and GridCue leaves the view as it is. Whether it fails or succeeds with a stale undo depends on which listener subscribed first. Reported to the owner |
| 1 | Which words count as asking to group, on a grid that can't (G3) | Wider than the spec's "grouping verb". A request holding any word built on "group", outside a declared name and quoted text, is never ready. One exception: the word is said to stay or be left out, with a fixed list of staying words, and nothing follows it in its part. Three held-out rounds each found a ready Preview that dropped such a word; the fourth found none. The cost: "show accounts in the Northgate group" gets "This grid can't group rows." where the User likely meant a filter. The spec's "would change if" says to narrow to the verb at the start of a part on that evidence; narrowing would bring the dropped-word Previews back, so the lead kept the wide rule until the fix in section 12 can ask a truer question on every grid. The owner may rule otherwise |
| 1 | A reading question that offers grouping on a grid that can't group (G3) | Unchanged and out of scope: "largest households first" still offers "Group by Household" there, and picking it ends unsupported. Nothing applies. It goes with O2, which reuses the shared "this grid can't" result |
| 1 | Wrong views in the TanStack Table adapter that the v8 guide's review found (G2) | Not fixed: G2 adds no code to the package, and no plan covers them. The guide and the skill give the workaround. They need the owner's ruling and their own fix PR. On a column with `invertSorting: true`, the table shows the opposite order to the Preview. On a column or table with `enableSorting: false`, and on a table with no grouped row model, GridCue says "View updated." and the rows don't change. A column that names a built-in filter function shows no rows for a GridCue filter. All but the last hold on `useTable` too |
| 2 | The code for a `now` that throws (N5) | `INPUT_CLOCK` |
| 2 | The words table in named filters' spec, section 9 | The lead shows it to the owner when wave 1 clears. Wave 2 does not wait for an answer |
| 2 | An empty form on a yes/no column (N2) | Said before the column ("no restricted holdings"), it keeps today's reading, as spec 5.2 says. Said after the column ("Cleared is empty"), it asks: today's reading of that was Cleared is Yes, a wrong view the held-out form set found |
| 2 | An empty form, then an amount with no column of its own (N2) | Asks across "and", a comma and the next part too ("Advisor is empty and over 5%"). The spec's rule was only enforced inside one part. An amount with its column named stays ready |
| 2 | A column asked for beside a form on another column (N2) | A column named in the singular right after a column-choosing word must end up in a change the plan holds other than a sort, or the part asks ("show only household where advisor is empty"). "Every", "each", "all" or "any" before an entity word names the rows, as the plural does |
| 2 | A statement that holds a form (N2) | It asks. "My", "our", "me" and "us" are placed only where they belong to the request. A form is not read after a quantifier, a possessive or a demonstrative before its column, after "is" or "are" before "without", after "has" with no relative word right before it, after a question word before its column, or before a trailing phrase that only names the rows. This is narrower than spec 4.2's small-word row and ADR 0023's "which words, not where they sit". Each sentence asked before this PR. Some such sentences are still ready: section 12 C lists them for the owner |
| 2 | The two D4 narrowings the natural set called for (N2) | In a part with no form, a word for empty values ("sort by counterparty with the blanks last") asks, and so does a "show only these columns" part that holds other words ("just the accounts where the advisor is exactly Blake Moreno"). Both were wrong views in the release |
| 2 | A column named right after a form (N2) | Read as the same words in the other order are: "entries with no vendor booked after 2026-01-01" is ready with both filters. Before, the question named the column as an unknown word |
| 2 | The Row Noun and a text form (N2) | The Row Noun is never the column of a text form either, which goes past spec 5.2: `account starts with "AC"` asks, and `account number starts with "AC"` reads |
| 2 | Twenty cases N1 labelled to ask how to match (N2) | Relabelled to the reading spec 5.2 gives, in the three named-fixes sets. Only their expected result changed |
| 2 | Letter case in the exact-text Preview line (N2) | Lower case, "Filter Advisor to exactly “avery lane”", as spec 5.2 and today's "containing" lines have it, for text the User quotes. Section 9's "Avery Lane" is the line for a Local Value (N4), which shows the value as the Host stores it. The spec is unchanged |
| 2 | "Thanks" beside a form (N2) | Asks: it is not on spec 4.2's list. The list grows one word at a time on held-out evidence, as the spec says |
| 2 | The terms the sets are labelled against (N3) | Declared before labelling. Wealth: Large (alias "big") is Market value above $1,000,000; Needs attention ("need attention", "needing attention") is Concentration above 10% and Restricted holdings is Yes; Unassigned ("orphaned") is Advisor is empty. Ledger: Material ("sizeable") is Amount above $10,000; Needs review ("need review", "needing review") is Cleared is No and Amount above $5,000; Uncoded ("uncategorized", "uncategorised") is Category is empty |
| 2 | Where the terms live (N3) | In the eval harness, the two examples and the Site demo, not in the fixtures. With the terms declared, one existing labelled request changes: "uncategorised entries please" goes from a safe miss to the labelled view through Uncoded's alias. The plan's bar was no change at all, so the fixtures stay as they are |
| 2 | A term's name (N3) | Stricter than spec 5.3's whole-name rule. `defineSchema` also refuses a name that holds one of GridCue's own words among its words ("Top tier", "Out of policy", "Due today"), an amount or a count ("Tier 1"), a column's or value's name, the Row Noun or an entity word ("Big gain"), or only words a comparison is written with ("More", "Valued", "Worth"). Each such name was read twice in a review probe: as the term and as the word. The owner may relax it for small words such as "of" |
| 2 | Where a term is not read (N3) | Past spec 5.3's left out, where a column goes, and "or": a term asks right after a comparison word ("accounts under large"), after a preposition with nothing after it ("accounts at large"), right after an amount ("gain 50k large"), and before a possessive ("large households' accounts") |
| 2 | A statement that holds a term (N3) | It asks, as beside a form: a form of "be" before the term ("accounts are large"), the rows right before a term that is no "-ing" or "-ed" word ("accounts need attention"), a singular noun for the rows anywhere before it, or the rows anywhere before a term said as a verb ("Northgate needs attention"). A term asked for with a relative word or "which", listed after a comma or a joining word, or before the noun it describes, is read. Section 12 C lists what is still ready |
| 2 | A provider's No for a yes/no column (N3) | In a part with a code-read filter, a yes/no column named on its own keeps only Yes, or only No after a negation; a provider's other answer is dropped and the part asks. This also holds beside the text-forms PR's forms. A part with no code-read filter is section 12 A |
| 2 | The two D4 narrowings the held-out sets called for (N3) | They hold on every grid, with terms or without. An adverb nothing reads beside a value, a yes/no column, an amount or a date asks ("accounts largely in taxable"); adverbs that say what "only", "all" or "now" say are read as before. A size or age word asks which column to sort by when the only column it could order holds no amount or date ("which advisor has the largest accounts", "accounts by advisor, largest first"); "sort by advisor, largest first" reads as before. Each was a wrong view in the release. "Accounts really in retirement" and "taxable accounts held directly" read before and now ask |
| 2 | A word made from a term's name (N3) | With terms declared, "largely", "larger", "bigger" and "materials" ask in a part with no term: the User may mean the term. "Largest" stays a size word, and "larger than $2m" a comparison |
| 2 | The Row Noun beside a code-read filter (N3) | A Row Noun that is also a column's alias is read as the rows there: "show the advisor column for large accounts" no longer also shows the Account number column, which the release did for a form too |
| 2 | Six dev cases the Mock Provider can't answer (N3) | "Large accounts over $5m", a spec 5.3 row, and five like it ask with the Mock Provider, which answers nothing for a part that starts with a word it doesn't know. They are ready with a scripted provider. The gate names the six and requires them to ask; the Mock is not changed here |
| 2 | The columns the name sets are labelled against (N4) | Declared before labelling. Wealth: Advisor and Household. Ledger: Owner and Counterparty. Their values are the ones the fixtures' rows hold. They live in the eval harness; the examples and the Site demo pass their own rows |
| 2 | Several values of one column (N4) | They make one filter only when written as one list ("Avery Lane or Blake Moreno"). Apart in one part ("Avery Lane's accounts for Blake Moreno"), or in two parts, they ask: no row has two Advisor values. Spec 5.4 says only "several values of one column make one filter"; the held-out wealth set found the merged reading as a wrong view |
| 2 | Values of two columns (N4) | Read as rows with both when the words say which rows have each ("Avery Lane's accounts in the Alder household", "Avery Lane's Alder household accounts"), or when each follows its column's name ("advisor is Avery Lane and household is Alder Household"). They ask "both, or either?" with "and", "also", a comma or a dash between them, when each comes with the rows' own noun, or in two parts. The spec gives no rule; the two form labellers disagreed, and the lead ruled for asking. Two declared values still read as rows with both, as in the release ("taxable accounts and Northgate accounts") |
| 2 | A value beside a filter no row can match with it (N4) | Asks: "Avery Lane's accounts with no advisor" would show an empty view. So does a word built on "group" that is a word of a value the grid holds ("Travel Group entries", with a counterparty named Hollis Travel Group). Both checks run only for a Local Value. The same readings with no `localValues` are as in the release, and section 12 A lists them |
| 2 | A possessive after a value (N4) | Read, as spec 5.4's table has it: "Avery Lane's accounts". A House Term before a possessive asks ("large households' accounts"); the spec wins for a value |
| 2 | A `localValues` column whose operators leave out exact text (N4) | `createGridCue` throws `INPUT_CONFIG`. Spec 5.4 says "may be filtered"; a column limited to "contains" may be, but every name on it ended in "GridCue can't filter … to exact text here". The real Host test found it: that application's name columns allow "contains" alone |
| 2 | A tie's choices (N4) | One choice for each column, five at most, as the one-word question has. With more, the question has no buttons and asks the User to rephrase. Values that differ only in letter case are one value |
| 2 | One existing labelled request that changes with the fixture's values on (N4) | "Just the accounts where the advisor is Blake Moreno" is labelled to ask, from the text-forms PR's narrowing. With values on it reads Advisor to exactly “Blake Moreno”, the view asked for. `evals/local-values.test.ts` names it and holds every other existing request to no change. The plan's bar was no change, so the fixtures pass no values |
| 2 | Three fresh held-out cases set aside (N4) | Round 2's set had 59 cases. Three run with no `localValues` and test release readings: two text forms on one column that no row can match together, and "travel group entries". The first narrowing fixed them on every grid; the review found that it also made "the retirement group" ask, a right reading, so the fix was kept to Local Values and the three cases left the set. Section 12 A lists both classes |
| 2 | Long choices in both UIs (N4) | The spec's section 9 said no component or style changes. The browser check at 320 px found two. Before: a choice button never wrapped, so a 50-character name made a 397 px button and the page scrolled sideways; in `<GridCueBar />` the input row was 288 px in a 233 px bar, with nothing typed. After: a choice has `max-width: 100%`, `text-align: start` and `overflow-wrap: anywhere` (built-in), or `h-auto min-h-8 max-w-full shrink justify-start py-[5px] text-start whitespace-normal wrap-anywhere` (registry), and the built-in bar's grid has `grid-template-columns: minmax(0, 1fr)`. A one-line choice is 32 px high, as before. Why: a name must be readable and pressable without sideways scroll. No motion changed |
| 2 | The fixed clock for the date sets (N5) | Every date case runs on the ledger with the clock at 2026-11-13T15:00:00Z and the Calendar America/New_York, year from January: the spec's own day. It lives in the eval harness (`evals/clock.ts`, a case's `"clock": true`), so no fixture's pinned provider request changes |
| 2 | Where the examples' date columns live (N5) | The wealth fixture does not change. Each example and the Site demo adds an Opened date and a Last contact column of its own, worked out from today, so "opened in the last 90 days" always keeps some rows. The Site's pages are prerendered, so its two date cells are blank until the page runs in the browser; the Next.js example renders for each request and the server passes its clock on |
| 2 | The range shape (N5) | One `between` filter with both days included; one day is `eq`; one ISO date keeps today's operators. The natural set's labeller counted "last 30 days" as 30 days with today among them; the spec counts from the day 30 days before today, 31 days in all. Four labels were moved to the spec's days before the run. That two careful readers differ is evidence for the spec's "would change if" on this form |
| 2 | Which time words ask (N5) | The spec lists the kinds. The reviews found more that a ready plan dropped, each of them in the release too, and the lead kept the reader's wider list: abbreviations, fiscal and accounting words, halves, "period", a unit joined to where in it, days of the month and decades, times of day, seasons, and each written with a space, a hyphen or dots. It also asks for "this", "last", "since" and the like right after the rows or a date column and before a word nothing reads. Every one of these only asks. A word of no kind ("soon", "earlier", "overdue", "newer") is still dropped in a part with no code-read filter: section 12 A |
| 2 | A place in the grid and a share (N5) | Not time words: "put advisor last", "the next column", "the 2nd column", "a quarter of the entries". A first version asked the dates question for a part that ended in "last"; the fresh round's ordinary requests showed the wrong question on grids with no date column, and the lead took that rule out. A request with no time word reads as it did |
| 2 | A dictated "period" (N5) | Still a full stop, but not after a word that makes a span of time of it ("this period", "prior period", "the reporting period"). Before, "travel entries last period" lost its last two words before any reader saw them |
| 2 | A name that holds a time word (N5) | Inside a declared name or a Local Value the words are the name's. A person or firm the grid doesn't declare ("owner April Ortiz", "Summer Freight Ltd") asked before and still asks, now with the dates question. A Local Value that is a date form plus one of GridCue's own words ("Last 90 Days Group") asks which was meant, where it was ready: the words can be read both ways |
| 2 | A range with a comparison after it, and "or so" (N5) | "From 2026-01-01 to 2026-03-01 or later" is no range and asks, as it did before dates were read. "Or so" after any code-read filter is never placed. Both came from the docs check and the fresh round |
| 2 | Questions about dates (N5) | "Were entries booked last quarter?" is ready with that filter, as a question beside a text form or a Local Value is. Labelled ready-or-ask in the fresh sets |
| 2 | Cells a date column can't read (N5) | A third change to old behaviour, which the spec requires: an epoch number or "11/13/2026" in a `date` column matched a filter written the same way, and now matches none. The changelog, the adapter guide and the skill say how to convert. The owner may want a number read as an instant: that is a new reading and waits for a go |
| 2 | Two fresh held-out rounds after the review (N5) | Round 2, 171 cases: 9 judged wrong. 7 were labels (three single dates with "or later", "or earlier", "up to", which the release reads; three mixed requests the labeller could not write operations for; two forms each after its own column). 1 was real and new, "booked last month or so", and now asks. 1, "this entry was booked after 2026-03-01", is a statement the release already reads, in a part this PR doesn't read: set aside, section 12 C. Round 3, 172 cases, labelled after that fix: 0 wrong views on its first run |
| 2 | The representative Host test (N5) | Its grids declare no date column, so a relative form there says the grid has none. On its 289 requests: 5 that dropped a time word now ask, 5 questions are reworded, none got worse, and its own typecheck, lint, tests and build pass |
| 3 | The eval harness for pins and density (O2) | A case marked `"renders": ["pinning", "density"]` runs on a grid that draws both, and every pin and density case is labelled for one. The run on a grid without `renders` is derived, as the grid that can't group is: a case that pins or sets a density must end in "This grid can't …" with nothing applied, and every other case keeps its verdict. Labels that need a Host name holding a form word run on an eval-only schema, never a fixture |
| 3 | A form at the end of a part (O2) | Read on its own after "and" or a comma, with the rest of the part compiled as if it weren't there. Spec 5.3's own row needs it ("group by advisor and pin advisor" is ready with two lines), though ADR 0028 says a form is read as a whole Clause: `normalize` starts no part before "pin" or "compact", and a new split would change the provider request |
| 3 | A pin or density word no form read (O2) | It never leaves a ready plan. A form said at the start or in the middle of a part asks to be said on its own ("compact view, top 10 by market value"); on a grid without `renders` it ends in "This grid can't …". ADR 0028 gained one bullet for this. Before, such a request applied the rest and dropped the word, in the release too. Round 3: of 42 such requests, 19 read and 23 asked |
| 3 | A column a pin names that may mean the rows (O2) | The Row Noun, a plural entity word, and a yes/no column's bare name ask: "GridCue can't tell whether “cleared” means the Cleared column or the rows. To pin the column, say “pin the Cleared column”." The spec's own "freeze the account column" row allows the ask. The cost is real: round 2 was aimed at this class and 16 of its 35 ready-labelled requests asked for it. A question with a choice ("Pin the Cleared column") would cost one click; it is a new reading, so it waits for the owner |
| 3 | A pin list cut by `normalize` (O2) | "Pin rate and cleared to the start" was split before "cleared" (a verb to the splitter), pinned Rate alone and filtered Cleared: the one held-out wrong view. A part after a pin list that starts with a column's name now asks. Reading the list across the split would be a new reading |
| 3 | A Host name that holds a form word (O2) | "Compact view" where the Host names a size class Compact. The spec says the name wins and the part reads as today. The builders made it ask, since on a grid that draws density the words can mean either. The lead kept the ask there and restored the spec's reading on a grid that doesn't draw density, where the words can only be the name: a Host that never set `renders` sees no change. "Compact rows" after a word that takes the rows is the value on every grid |
| 3 | Pinning a column that is already pinned (O2) | The compiler leaves it where it is, and says "The grid already shows this view." when nothing would change. The reducer still removes and adds, as spec 4.4 says, so a plan made without compiling can move it |
| 3 | "Unpin everything" with a column the User may not name (O2) | A hidden restricted column stays pinned out of sight and the rest are unpinned. If it shows, the part asks and never names it: "GridCue can't unpin every column here. To unpin the others, name them." |
| 3 | A refused part beside a pin (O2) | The refusal wins on every grid: "pin advisor and export the list" is refused. Grouping on a grid that can't group still asks "This grid can't group rows." there; left as built in wave 1 |
| 3 | House Term names (O2) | A term may not be named with a word a pin or density form reads ("Unpin", "End", "Mode", "Use", "All", "Column"), as it may not be named "Pin" |
| 3 | Grouped column order on TanStack Table (O2) | TanStack moves a grouped column to the front and `applyView` doesn't; this was so before. The rendered-rows test now counts it, and the docs say how to get `applyView`'s order |
| 3 | The grids of the Site demo and the examples (O2) | Not drawn yet. The plan has the owner look at the prototype first. The prototype showed five places where spec section 9 is silent; they wait for the owner with it |
| 3 | A third blind round after the review (O2) | 198 cases, labelled after the review's fixes: 80 exact, 116 asked, 1 refused, 1 safe miss, 0 wrong views on its first run; nothing ready on a grid without `renders`. Its 83 ordinary requests read the same as on the starting source |
| 3 | The eval harness for totals (O3) | As for pins: a case marked `"renders": ["totals"]` runs on a grid that draws totals, and the run without is derived ("This grid can't show totals.", nothing applied, the grouping of "total X by Y" included). A question's choices are checked as well as its prompt (`clarificationChoices`). Two eval-only schemas: one with a `defaultMeasure`, one whose labels hold "total" |
| 3 | TanStack totals: the spike passed, with two additions (O3) | Totals are on the TanStack Table adapter. The spec named one function for the Host to register, `gridcueAggregationFn`. The spike found a second is needed, `gridcueAggregationValue`: TanStack caches a column's grand total on things that don't change when only the totals do. And a change to the totals alone makes the adapter write the grouping (or the column order) again so the table recomputes, which resets the page and the expanded groups as a sort does. The docs and the skill show both lines together |
| 3 | How a total adds (O3) | The decimals a User sees, exactly: 0.1 + 0.2 is 0.3, in any row order. An average is that sum divided once by the count of rows with a value. Only finite numbers count; text in a number column is skipped like an empty cell. A view or a group with no values has an empty total, never 0. An average of a percent column is a fraction, as its cells are. One function, `totalOf`, does this for both adapters |
| 3 | Which total functions an adapter applies (O3) | An optional `aggregationFunctions` beside an adapter's operations; left out it means sum and average. ADR 0029 gained the sentence. It is an addition to the adapter interface |
| 3 | The shape of the totals in a result (O3) | `ViewResult.totals` and each group's `totals`: a list in the view's order of the column, the function and the value, the value `null` when empty |
| 3 | Group order beyond the spec's table (O3) | The table has one grouping level and one sort. The lead kept what TanStack draws, since the Host can't change it: ties between groups keep first-appearance order; a group with an empty total sorts where a row with no value does (first descending, last ascending) and is never ranked as 0; with two levels the groups of one outer group sit together; a sort on a grouping column orders the groups by that column; with several sorts groups are compared sort by sort. The two-level order changes views requests reach today on the Rows Adapter, as the one-level change does: ADR 0030 and the changelog say so |
| 3 | A total on a column the view groups by (O3) | Not reachable: the compiler asks ("GridCue can't group by X and show its total too.") and validation refuses the state. The two adapters would draw it differently, and nothing a Host registers changes that. A User can still make one with the table's own controls. It is a validation row the spec's 4.4 doesn't have |
| 3 | Totals that don't fit (O3) | "Total concentration" asks the spec's question with "Yes" and "No"; Yes shows the average. A text, date or yes/no column asks "Advisor can't be totalled." with no choices. A column whose capabilities leave totals out asks "GridCue can't total X here." A total on a hidden column shows the column first, as a pin does. A request that changes no total says "The grid already shows this view." |
| 3 | Two totals in one request (O3) | Both are read, and the plan keeps one `aggregation.set` with the whole list, so the Preview has one line: "Show the total of Market value and the average of Concentration". The held-out natural set found the earlier shape (two operations). The same column twice in one request asks |
| 3 | A total said right after a list or a clear (O3) | "Sort by gain and total market value", "hide custodian, average concentration" and "remove the totals and total market value" ask: the words may be one more thing to sort by, hide or remove. With a verb of its own it reads ("… and show the total of market value"). After "then", a semicolon or a full stop it is a new step and reads: the last review pass called these wrong views, and the lead ruled they are what the sentence says |
| 3 | A Host alias made only of totals words (O3) | The ledger names Amount "total" and "sum". On a grid that draws totals, such a word asks where it could ask for a total (beside a grouping, or before another number column: "sort by total units"), and is the Host's name elsewhere ("sort by total"). On a grid that doesn't draw totals it reads as before |
| 3 | The third choice of the ranked-group question (O3) | Offered only on a grid that lists totals, grouping and sorting. Its column is the `defaultMeasure` for a size word, a column the request or the provider names, or, for "most" and "least", a column whose name is the adjective with "-ion" for "-ed" ("most concentrated": Concentration). The last is a rule made for the spec's own row; it only adds a choice to a question |
| 3 | Totals words on a grid without `renders` (O3) | A request with a totals word that asked before may now ask "This grid can't show totals." instead ("in total, show taxable accounts"). Nothing that was ready there changed, except three requests that dropped a totals word and now ask |
| 3 | A speed test that failed under load (O3) | "Reads and compiles 2,000 characters of names in under 50 ms" failed twice in about a dozen full runs. Alone it takes 7 ms, the same as before this PR. The suite is larger now and runs in parallel, so the test waited for the processor. It now measures its own process's CPU time. The other speed tests still use the clock and did not fail |
| 3 | A third blind round after the review (O3) | 203 cases. 6 judged wrong: 1 real and new ("group by advisor, total market value by custodian" kept both groupings in the Preview and applied the second), now a question; 4 labels (an ungroup the labeller could not write, two plans that hold only what changes, and the ledger's "total amount over 2000", a filter on its own alias); 1 older than totals with no totals word ("advisors with the most gain first"), set aside to section 12 A. The 202 kept: 58 exact, 128 asked, 2 refused, 14 safe misses, 0 wrong views. 39 of them were ready on the code before this PR, most with the total dropped or read as one more column |
| 3 | A Host that names a column "total" or "sum" (O3) | The spec says the Host's name wins, and it does. The cost shows on the ledger fixture, which aliases both to Amount: "total units", "sum of units" and "remove the totals" ask there, on a grid that draws totals. "Average" forms read. 10 of round 3's 14 safe misses are this. The docs tell a Host that turns totals on not to alias those words; refusing the pair at setup would be the stricter rule, and waits for the owner |
| 3 | The natural set's ask rate (O3) | 25 of the 29 requests its labeller marked ready asked (86%): "per" 7 times, "subtotal" 4, "add up" 3, "mean" 3, "for each" 3, "overall" 3. The plan sends anything above half to the owner as evidence against ADR 0028's closed words. None of the 25 was a wrong view |
| 3 | Totals an adapter doesn't apply (O3) | O3 settles how an adapter says which functions it applies, before its code, and the lead checks it |
| 3 | Where a row with no value sits in a sort | Out of scope, as the spec says. The rendered-rows bar is 100% on which rows show, the groups and the totals. Views that differ only in this are counted and reported |
| 3 | The shape of the count piece (O4) | The spike built both shapes of spec 5.5 on a real TanStack Table 9.2.4 table, and both met the bar with the same numbers, since they share one row model. The lead kept the second: `gridcueCountFeature` holds the count in the table's own store, and `gridcueCountRowModel(createFilteredRowModel())` wraps the filtered row model. A change of the count alone then redraws through its own slice, `table.reset()` clears the count with the rest of the view, and a caption can read it. The Host passes TanStack's `createFilteredRowModel()` in, because the package's TanStack entry imports nothing from TanStack |
| 3 | The feature is spread into `tableFeatures` (O4) | TanStack's types name only TanStack's own features, so the docs show `...{ gridcueCountFeature }`. It passes typecheck with no cast. One helper that returns both pieces would read better, and its name is the owner's to choose |
| 3 | Public names beyond the piece (O4) | `countOrder`, exported from the root, is the one choice of rows a count makes: `applyView` and the piece both call it, so neither copies the other. `rowsBeforeCount(table)` gives the rows before the count, for "First 10 of 48 rows". `ADAPTER_UNSUPPORTED_COUNT` is a new result code beside `ADAPTER_UNSUPPORTED_FILTER`. The spec names none of the three |
| 3 | Tables that can't keep a count (O4) | The spec names manual pagination, sorting and filtering. The spike added `manualGrouping`, and the review found a wrong view on a tree table ("top 2" showed 5 rows: two rows and their sub-rows), so `getSubRows` is refused too, even where it returns nothing: the adapter can't see the rows when it is made. Each throws `INPUT_CONFIG` naming the setting, as do a missing piece, `useLegacyTable` and a table whose options the adapter can't read |
| 3 | A setting the Host turns on after a count is held (O4) | The review found the count went on cutting one page while the View State still held it. Now the piece stops cutting, the adapter reads no count and lists no `limit.set`, a Preview made before is refused as stale, and a write of a count fails with `ADAPTER_UNSUPPORTED_COUNT`. The count stays in the table's store, so it cuts again if the Host turns the setting off before GridCue next writes. "Show every row" then asks "What should “show every row” filter on?", as it does on any view with no count: a miss the compiler could answer plainly, not this PR's |
| 3 | The rows a count keeps are GridCue's, not the table's (O4) | The piece sorts with GridCue's own comparison, so both adapters keep the same rows on every view tested. They need not be the first rows the table's own sort would show with no count: a `null` in a later sorted number column (TanStack reads it as 0), a Host's own `sortFn`, or TanStack's alphanumeric sort order rows differently. On the bar's row sets that was 5 to 19 of 600 views. Refusing `"count"` where a sortable column has its own `sortFn` would be the stricter rule; the lead did not add it, since most such columns never lead a count, and it waits for the owner |
| 3 | The lead's seeds for counts (O4) | Seeds 448190251 to 448190750, drawn after the build: wealth 487 views the same, 13 that differ only in where a row with no value sits, 0 different; ledger 490, 10 and 0. The rows kept differ in no view. The grouped test on the same seeds: 0 different. The lead's own probes also passed: two tables over one features object, a count the Host writes itself, a value that is no count, `table.reset()`, new data under a held count, and a count with paging |
| 3 | A fifth difference between the adapters (O4) | The review found the bar's row sets avoid a `null` beside a `0` in one sorted number column, where TanStack's basic sort is inconsistent and draws rows that hold values out of order. It is older than counts, and never changes which rows a count keeps. It is now named in the row sets, counted apart by both seeded tests, and listed in ADR 0030, the adapters page and section 12 B |
| 3 | The eval runner's TanStack run (O4) | Every labelled set runs on a real TanStack table as well as the Rows Adapter: 4,019 cases in 56 sets, with the same verdict, plan, questions and Preview on both, and 0 wrong views. A case's `renders` gains "count" there, since the Rows Adapter keeps a count with no option. A control run without it gave 34 wrong views and failed the gate. The run proposes and never applies, so it checks how requests read; the rendered-rows test checks the rows. The three sets judged only with a live provider are held to the Rows Adapter's result alone. The runs on a grid with no grouping and with no `renders` stay on the Rows Adapter. It adds about 4 s to the gate |
| 4 | An operation a Query Adapter's `without` removes (G4) | G4 wires each one to the shared "this grid can't" result, and labels a set for it |
| 4 | `AGENTS.md`'s Grid Adapters list | The Query Adapter joins it in G4, where it lands |
| 5 | A saved view the grid can't show in full (R1) | Unsupported, as four bets 5.3 says. The "this grid can't" question is for requests |
| 5 | A Host's saved-view list or load that throws (R2) | `INPUT_SAVED_VIEW_FAILED` |
| 5 | `docs/internals/product.md` line 56 | R2 edits it, where saved views land |
| 5 | `AGENTS.md` rule 1 | The owner's edit by hand, needed before R3 |
| 6 | `countRows` that throws (C2) | No Rows Shown line, and no error the User sees |
| 6 | `recent.onChange` that throws (C5) | An `ADAPTER_` issue. The view already applied stays applied, and Undo works |
| 6 | The bar prototype | The owner sees it after R2 builds it, and again before C1's component code |

Live Jev runs wait for the owner's command each time. So does every merge.

## 12. Wrong views found while building, not yet planned

The reviews and held-out rounds of wave 1, and of wave 2's text-forms, House Terms, Local Values and dates PRs, found these. Each is in the release too. None is in an approved plan, and no wave 1 PR could fix them inside its one concern. For A and B the lead recommends two fix PRs, each with its own labelled sets, built the way the wave 1 fixes were: every change asks, and none adds a reading. They wait for the owner. D holds what the review of the open PRs raised.

**A. Reading: a word or symbol GridCue drops, in a part with no code-read filter.** Named filters' every-word rule does not reach these parts (its spec 4.2), and the Local Resolver that would is in the four bets.

| Request | Today |
| --- | --- |
| `custodian != Northgate`, and `≠` or `not=` | Shows Northgate |
| A full-width "！" before a name | Dropped; shows the rows the User left out |
| "sort by value reversed", "backwards", "inverted" | Sorts ascending |
| "all but restricted" | Shows the restricted rows |
| "reset and trusts", on a filtered and sorted view | Drops the reset |
| "account first for trusts" | Drops the column move |
| `advisor "Lane" and restricted removed` | Shows the restricted rows |
| "show accounts in the Northgate group", on a grid that can group | Filters Custodian and drops "group" |
| "Northgate group accounts" | Also groups by Account number |
| "sort by value, groups by advisor" | Sorts by Advisor |
| "households named group" | Groups by Household |
| "accounts over $1m, top 5 by gain" | Filters Unrealized gain and sorts by Market value |
| "show only household where custodian is Northgate" | Filters Custodian and drops the column change |
| "just the advisor where value is over $1m" | Filters and drops the column change |
| "show only advisor and household columns, in that order" | Sorts by Advisor, then Household |
| "cleared is no", "restricted holdings is no" | Shows the Yes rows |
| "sort by advisor, unassigned last" | Sorts and drops "unassigned last" |

| "cleared entries", "material entries, cleared", with a provider that answers No for Cleared | Shows the No rows |
| "accounts smaller than taxable", "accounts under trust", "entries greater than fees" | Filters the value and drops the comparison |
| "taxable households' accounts" | Filters Taxable and drops the possessive |
| "show larger taxable accounts", on a grid with no House Terms | Filters Taxable and drops "larger" |
| `advisor starts with "Av" and advisor is empty`, and other text forms on one column that no row can match together | Shows an empty view |
| "travel group entries", "the travel group", on a grid whose Category holds Travel | Filters Category to Travel and drops "group" |
| "travel entries soon", "… earlier", "… overdue", "… newer", "… first thing" | Filters Category to Travel and drops the word. The dates PR asks for every kind of time word it knows; these are of none |
| "this fy travel entries", "travel entries over 500 this season" | Drops the period: it asks only right after the rows or a date column |
| "sort by owner units", "sort by amount units", and on the ledger "sort by total units" on a grid that draws no totals | Sorts by the first column and drops the second: a column named right after another is read as the rows |
| "sort by advisor ascending, market value descending" | Sorts both descending: the first column's direction is lost |
| "advisors with the most gain first" | Sorts the accounts by Unrealized gain and drops "advisors": the question about households as a whole is asked only for a size word right before the entity word |
| "accounts except over $1m" | Shows the accounts above $1,000,000: "except" before an amount is read as the amount alone |
| "clear the gain filter", with a provider that scores the column below the floor | Removes every filter: the floor drops the column before the clear looks for what it names |
| `advisor "Lane" or advisor "Hale"`, after the User answers the column question with Advisor | Previews both filters joined with "and" |
| `advisor "Lane" not restricted`, "accounts not restricted", with a provider that answers Yes for Restricted holdings | Shows the Yes rows |
| "sort by gain, don't keep the grouping", on a grouped view | Sorts and keeps the grouping: "keep" with a negation before it is read as keeping |
| "sort by balance for accounts with no advisor", on a view sorted by Advisor, with a provider that scores an added sort high | Adds Market value after Advisor, where the User asked for a new sort. The fix replaces the sort without asking, so it is a reading change and not a question |
| "hide duplicates where amount is under $100", "hide losers where market value is under $10k", and on the ledger "hide counterparties where amount is under $100" | Keeps the rows at or above the amount and drops the word: one word ending in "s" before "where" is read as the rows, a column's plural among them |
| "hide pending accounts whose gain is below $0", "… with gain below $0" | The same, with "whose" or "with": the review's fix asks only before "where" |
| "top 5 by gain, then sort by advisor instead", "top 5 by gain, then clear the sort and sort by advisor" | Keeps the first 5 rows by Advisor |
| "top 5 by gain, then clear the sort" | Keeps the first 5 rows in the order the Host gave them |
| "sort by advisor, then top 5 by gain" | Sorts by Advisor first, so the count keeps the first 5 rows by Advisor |

In the second table, the first five were found by the text-forms PR's reviews (wave 2), the next four by the House Terms PR's, the next two by the Local Values PR's held-out sets, and the last eleven by the review of the open PRs (D) and the checks of its fixes. Each of the six from the House Terms and Local Values PRs reads the same in the release, and each of the last eleven read the same before the review's fixes. The text-forms PR also found that the plural "entries" is not read as the ledger's Row Noun "entry" outside a part with a form: a miss, not a wrong view.

With this fix in, the can't-group question can narrow back to the grouping verb (more grids spec 5.3).

**B. The TanStack Table adapter says a view applied that the table doesn't show.** The first four were found by the v8 guide's review; the guide and the skill give a workaround for each. The next five were found by the totals PR's rendered-rows test and its review, and the last two by the TanStack counts PR's. The two rows at the end of the table were found by the review of the totals PR and the check of its fixes. Each is older than totals, the test counts five of them, and ADR 0030 and the adapters page list them. One fix for the first two would be a GridCue sort function the Host registers, as it registers the filter function.

| Table setup | Today |
| --- | --- |
| A column with `invertSorting: true` | The table shows the opposite order to the Preview |
| A column or table with `enableSorting: false` | "View updated."; the rows don't move |
| No grouped row model | "View updated."; the rows are not grouped |
| A column that names a built-in filter function | A GridCue filter on it shows no rows |
| A `null` cell in a sorted text, category or date column | TanStack's default sort treats `null` as equal to every text, so rows that have values are drawn out of order too. 31 of 500 seeded wealth views and 34 of 500 ledger views |
| A sorted text column with mixed letter case | TanStack orders by code unit, `applyView` as the locale does |
| A grouped column that holds both `null` and missing cells | TanStack draws two empty groups, `applyView` one, so their totals differ too |
| A total on a column the table groups by, made with the table's own controls | TanStack shows the group's own value there, `applyView` the group's total. GridCue no longer makes such a view |
| `null` and missing cells mixed in one sorted column, in the Rows Adapter | The comparison is inconsistent for that pair, so the row order, and the rows a count keeps, depend on the order the rows arrived in |
| A `null` beside a `0` in a sorted number column | TanStack's basic sort reads `null` as 0 one way and not the other, so rows that hold values are drawn out of order. With zeros put beside the nulls, 13 of 500 seeded wealth views and 4 of 500 ledger views. A count keeps the same rows either way |
| A count on a column with the Host's own `sortFn`, or a later sorted number column holding `null` | The count keeps the rows GridCue's comparison puts first, and the table draws them in its own order, so they need not be the first rows the table would show with no count |
| A schema column the table doesn't have | A sort or a filter on it says "View updated." and the rows don't change. A total on such a column now fails at setup with `INPUT_CONFIG`; the same check for sorts and filters is a setup-wide rule, so it waits for the owner |
| A footer total on an ungrouped view, when the Host gives the table a column order that never changes and no handler for it | The table doesn't draw again, so the footer keeps the old total while the View State holds the new one. On a grouped view the same Host now gets a failed apply and "Nothing was changed." |

**C. A statement read as a request, in a part that holds a form or a House Term.** The text-forms PR reads a form by which words a part holds, not where they sit (named filters spec 4.2). Four rounds narrowed the statements its reviews found, and its three held-out rounds ended with none ready. The last independent check still found these ready as "Show only rows where Advisor is empty"; each asked in the release:

| Sentence | Why it slips through |
| --- | --- |
| "accounts are all without an advisor" | "All" sits between "are" and "without" |
| "which of the advisors is missing", "which accounts advisor is missing" | The question word is not right before the column |
| "for every account, advisor is empty" | The phrase about the rows comes before the form |
| "advisor is empty for every account please", "advisor is empty, for every account" | A word or a comma sits around the phrase about the rows |

The House Terms PR's last check found the same class beside a term, each ready with the term's filters:

| Sentence | Why it slips through |
| --- | --- |
| "these accounts at Northgate, need attention", "entries for travel: need review" | A comma or a colon before a term lists it, as in "show accounts, need attention" |
| "trusts need attention", on a grid whose Host declared "Need attention" and no "Needs attention" | Nothing marks a term as a verb but a first word that ends in a verb's "s", or the same name declared with and without it |
| "advisors that need attention" | Filters the accounts, as "advisors with restricted holdings" does in the release |

The dates PR found the same class with an ISO date, each ready in the release too:

| Sentence | Why it slips through |
| --- | --- |
| "this entry was booked after 2026-03-01", "the entries got booked before 2026-02-01" | No code-read filter is in the part: the date is read as the release reads it, and the statement check is not run |
| "travel entries were booked after 2026-01-31" | The same, beside a value |

A relative form or a range said this way asks ("entries were booked last quarter"). A yes/no question about dates is ready with its filter ("were entries booked last quarter?"), as one beside a text form is.

The release reads statements this way where no form is involved: "the accounts are at Northgate" previews "Filter Custodian to Northgate". The owner decides between leaving these until the Local Resolver's grammar (ADR 0020), as the spec has it, and a stricter rule in a fix PR: read "C is empty" and "has a C" only in the shapes spec 5.2 lists, and ask on anything else around them.

**D. Raised in the review of the open PRs.** CodeRabbit left 132 threads on PRs 19 to 35. Each was checked with a probe before a ruling: 67 were fixed on the PR they were raised on, 29 needed no change, and five were older wrong views, now rows of A. Two blind held-out sets were labelled before the fixes they test: `evals/cases-review-fixes-heldout.jsonl` (133 requests) and its `-r2` (57). On the first, wrong views went from 32 before the fixes to 0. An independent check after each pass found wrong views that two of the fixes had let through, and they were repaired before anything was pushed. The forms that check found which are older than the fixes are rows of A. A second round left 24 more threads, on PRs 19, 20 and 36 to 38: 16 were fixed, 5 needed no change, and 3 are in the table below. Its reading fix has its own blind set, `evals/cases-review-fixes-totals-heldout.jsonl` (31 requests, two totals under two groupings): 4 wrong views before the fix and 0 after, and the independent check found no request that asked before and is ready now.

Decisions for the owner. None shows a wrong view today unless its row says so. Each would change or add to an approved decision, so none was made in a review fix.

| PR | Question | The lead's recommendation |
| --- | --- | --- |
| 20 | `describeView` can't know the Host's input limit, which lives on the Controller | Add a `maxLength` option that defaults to 500 and that `ControllerState.view` fills in |
| 20 | The spec doesn't say which text Tab replaces | The word from the last space before the caret to the caret; offer a completion only when the caret ends the word |
| 20 | The `proposeView` bar says the applied view equals the saved one, and doesn't say that the ids of filters and filter groups are not compared | Say so in R1's plan: the reducer makes those ids, so a saved view's can never match |
| 20 | The gate line says only live runs judge the live-only sets, and also that the Local Resolver runs every set | Say in the four bets PR 4 that the Local Resolver run covers every set, the live-only ones too, and fails on a wrong view among the results it resolves, as the table's row has it |
| 21 | "Northgate and gain at or above $50k" asks "not either one", because of the "or" in "at or above" | Read it: skip the "or" of "at or above" and "at or below". It adds a ready reading |
| 21 | "hide concentration where market value is over $1m" hides the column and adds the filter, as the docs say of "hide C where …". The second held-out set's labeller would ask: a column can't be hidden for some rows, and elsewhere "hide … where" leaves rows out (6 cases) | Keep the documented reading. The six cases are in `REVIEW_R2_FOR_THE_OWNER` in `evals/run.ts` until the owner rules |
| 23 | Task 4.3 leaves the Next.js grid out of the count caption, which spec section 9 names | Name all three grids in the task |
| 24 | The Query Check compares ids as a set, so a Data Query that returns a row twice passes | `compare(ids)` fails on a repeated id and names it |
| 24 | An empty operand (`eq ""`, `contains ""`) passes validation; the spec now states which rows each keeps | Leave validation as it is |
| 25 | Undo of a save can remove a saved view the User changed on another screen | Keep the callbacks, and add a Host rule: `remove` may refuse a changed view by throwing |
| 26 | A total kept per Revision goes stale when the Host's rows change | Drop the cache and count the total beside each plan's count |
| 28 | "group by owner, then top 3 entries by amount" keeps the top 3 overall and shows them grouped, as the count's spec has it. The second held-out set's labeller would ask: it could mean 3 per owner (2 cases, in the same list) | Ask when a count is said after a grouping in one request. "Group by owner" on a view that already has a count stays ready |
| 32 | "balance over 100 without an advisor" asks how to compare | Read "without" there as "with no" is read. It adds a ready reading |
| 33 | When the Row Noun is also a column's alias, "account number column" beside a term is dropped as the rows, and the request asks | Scope the drop to the Row Noun's own words. It adds a ready reading |
| 33 | A term changed in place after `defineSchema` is not read; the docs now say to call `defineSchema` again | Leave the `ViewSchema` type as it is |
| 34 | "sort by market value, then Avery Lane" asks, where a declared value in that place filters | Keep the question |
| 34 | A Local Value that holds "or" ("Smith or Jones") trips the either-or question in one word order | Keep the question unless a real Host holds such values |
| 34 | A tie between a declared name and a Local Value offers two column choices that lead to the same reading | Merge them into one choice, in the command bar's work on questions |
| 35 | `defineSchema` accepts a numeric offset ("+05:30") where the spec says an IANA name | Reject it, so a schema that builds on one runtime can't throw on another |
| 37 | An adapter may list fewer total functions than sum and average (`aggregationFunctions`), and the compiler can't see the list. "Average concentration" compiles ready and then ends unsupported, and so do the Yes of the average question and the Rank choice. Nothing applies | Add an optional `aggregationFunctions` to `CompileInput`, defaulting to sum and average, so these ask or drop the choice. It adds a field to a root export. Neither shipped adapter narrows the list |

Not changed now. Each is an edge: it ends in a question, a refusal or an error unless its row says otherwise, and none is reached by a fixture, an example or the Host test.

| PR | What | Why not now |
| --- | --- | --- |
| 21 | On a column limited to `gt`, "exclude gain over $50k" ends unsupported | Needs a Host that limits a number column's operators, and the fix adds a ready reading |
| 27 | On a text column that leaves out "contains", the column question offers that column, and picking it returns the same question | No fixture or example limits a text column's operators |
| 28 | An empty OR group counts as no filters, so "clear the filters" on a counted view that holds one is ready where it should ask | No request and no Grid Adapter makes an empty OR group |
| 28 | A reset to a default view that has a count, then "show every row", asks what to filter on | A safe miss; reading it adds a ready reading |
| 30 | A recorded safe miss is labelled with "Group of Seven" where GridCue keeps quoted text in lower case | The label is the blind labeller's, and the case asks today |
| 32 | The same text as a date in one part and as an exact value in another can ask in one order of the plan's filters | Only ever a question |
| 32 | `household "who" and accounts have no advisor` asks about text that isn't there, where the question about the unread words would fit | The request asks either way, and the better question needs a new field on what code reads |
| 33 | A column name over 200 characters right after a form is cut and asked about | No Host names a column that long |
| 33 | A term's threshold with more than two decimals is rounded in the question's example | Only the question's hint |
| 33 | "Show travel material cleared entries" previews its three filters in another order than the words | The view is right, and word order would move pinned Preview lines |
| 33 | A term's date-and-time range written with two different offsets can be refused when it is in order | A setup error the Host sees at once |
| 34 | A name that two columns hold, with "group" in it, on a grid that can't group, gets the can't-group question before the tie's | Nothing applies either way |
| 34 | A value written twice in one list, beside an exact-text form of it, can ask | Only ever a question |
| 35 | "Sort by this month", on a grid with a column named This Month, reads the clock before the words are checked against declared names | Matters only when the Host's `now` throws |
| 35 | On a grid whose date columns all leave out `between`, "show rows this month" asks which date column, with no choices | Needs such a schema; a plain refusal would be better wording |
| 35 | A date cell on the first day of year 1 or the last of year 9999 matches no date filter | End-of-time values only |
| 35 | Validation accepts a date-and-time value in a form the filter can't read ("Nov 13 2026"), so a Host's own plan can keep no rows and say nothing | GridCue never writes a time from a request. The fix is to validate only what the filter reads |
| 35 | A schema changed by hand after `defineSchema` can hold an unknown time zone, and "booked today" then ends in an error | The view does not change |
| 35 | A write that changes only a filter's time zone reports done before a controlled table has taken it | Needs a Host that controls the table's filters and drops GridCue's write |

Safe misses the two held-out sets show, each a request a careful reader finds clear and GridCue asks about: "clear the filters but don't clear the sort" (the review's fix made the negated verb ask, where it cleared both), two bounds on one named column ("gain over $10k and under $20k"), "show only the advisor column for taxable accounts, largest balance first", "remove the trust filter", "remove advisor from the grouping", "hide cleared entries", and "top 10 accounts by market value for taxable accounts".

**Costs to win back.** Requests the wave 1 fixes made ask, which read correctly before: `advisor "Lane" in descending order of value`, `advisor "Lane" is trusts`, `advisor's name is "Lane"`, `advisor containing the text "Lane"`, and, on a grid that can't group, "clear the sort, leave the grouping and the filter alone". The review's fixes made one more form ask: "top 10 by market value, then sort by household", which sorted by Market value and then Household and kept the right ten rows, in an order the User did not ask for.
