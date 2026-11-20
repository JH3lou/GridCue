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
| The count rule, as one function of a plan and its view | O1 | C1 (edits), C4 (removals). Not `proposeView` | C had no rule for a view with a count |
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
| 2 | The code for a `now` that throws (N5) | `INPUT_CLOCK` |
| 2 | The words table in named filters' spec, section 9 | The lead shows it to the owner when wave 1 clears. Wave 2 does not wait for an answer |
| 3 | Totals an adapter doesn't apply (O3) | O3 settles how an adapter says which functions it applies, before its code, and the lead checks it |
| 3 | Where a row with no value sits in a sort | Out of scope, as the spec says. The rendered-rows bar is 100% on which rows show, the groups and the totals. Views that differ only in this are counted and reported |
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
