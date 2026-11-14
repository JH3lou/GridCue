# A command bar people live in: grilling log

Status: answered by the owner on 2026-11-13. See "Owner's answers" below.

The owner's direction on 2026-11-13: build five opportunities before the four bets. This is the fifth. Today the Controller can propose, answer by option, apply, cancel, and undo, and both UIs inherit that limit. The User can't drop one line of a Preview or change a value without retyping. The Preview says nothing about how many rows will be left. Only the first Clarification shows, and one without choices means rephrasing the whole request. Nothing helps a new User find what to ask. This round turns the facts below into the decisions only the owner can make. It is designed on today's code, where every request goes through an Intent Provider, and it says where each piece meets what the four bets add later: `controller.read`, the reading line, `describeView`, the View Sentence, `proposeView`, and the Local Resolver.

## Facts gathered (2026-11-13)

Each fact cites a file and line on branch `fix/reading-wrong-views`, or a probe. The probes are scratch scripts outside the repo, run from the repo root with `pnpm exec tsx <script>` and the Mock Provider on the wealth fixture. No model was called. *Unverified* marks what nobody has checked.

### The Controller and the two bars today

- **The Controller has six verbs:** `propose`, `answer(clarificationId, optionId)`, `apply`, `cancel`, `undo`, `dispose` (`packages/gridcue/src/core/controller.ts:42-51`). `useGridCue` passes them through unchanged (`packages/gridcue/src/react/use-grid-cue.ts:21-39`).
- **"Edit request" only focuses the input,** in both UIs (`packages/gridcue/src/react/grid-cue-bar.tsx:31`, `registry/registry/gridcue/command-bar.tsx:73`). The product journey says the User "applies, edits, or cancels the proposal" (`docs/internals/product.md:32`).
- **Preview lines are plain text,** one per operation, with no handle on the operation behind them (`packages/gridcue/src/core/preview.ts:95-106`; `grid-cue-bar.tsx:66-68`; `registry/registry/gridcue/preview-panel.tsx:23-27`). Line *i* is always operation *i* (`preview.ts:133`), so a line can be traced to its operation by position.
- **A plan that asks carries no operations.** The compiler empties them unless the plan is ready or unsupported (`packages/gridcue/src/core/compile.ts:1278`). So a Preview of the settled parts can't show beside a question today.
- **Both UIs share one component test suite** (`packages/gridcue/test/command-bar-suite.tsx:15-85`). The Vite example uses the registry's `CommandBar` (`examples/vite/src/App.tsx:89`); the Next.js example uses `<GridCueBar />` (`examples/next/app/accounts-view.tsx:41`).

### Some Preview lines belong together

Probe `probe-lines.mts`, on a view filtered to Market value above $1M and Taxable (57 of 500 rows):

| Request | Preview lines | Operations |
| --- | --- | --- |
| "clear the market value filter" | Remove the filters Market value above $1,000,000; Registration type to Taxable · Filter Registration type to Taxable | `filter.clear`, `filter.add` |
| "trusts" | Remove the filters … · Filter Registration type to Trust | `filter.clear`, `filter.add` |
| "top 10 by gain" (default view) | Sort by Unrealized gain, descending · Show only the first 10 rows | `sort.set`, `limit.set` |
| "remove the taxable filter" | Asked: "also names Taxable. Split it into separate parts" | none |
| "show only advisor and market value" (default view) | Show Advisor and Market value · Hide Account number, Household, … · Put Advisor and Market value first | `columns.show`, `columns.hide`, `columns.order` |

- Removing one filter is a clear plus re-adding the others. Dropping only the "Remove" line would add Taxable a second time.
- Dropping the sort from "top 10 by gain" leaves "the first 10 rows" of an unsorted view. Validation does not stop it: `validate.ts` has no rule tying `limit.set` to a sort (`grep -n limit packages/gridcue/src/core/validate.ts` finds nothing).
- "Show only" makes three lines, and each still says exactly what it does when another is dropped (spec author's probe `probe-spec.mts`).
- Removing a filter by its value's name ("remove the taxable filter") asks today.

### Clarifications

Probe `probe-clarify.mts`: every distinct Utterance in the six eval files (683), with the Mock Provider.

- **197 end in a question. 161 of them (82%) have no choices.** By kind: an amount GridCue couldn't read or compare 37, which change was meant 33, a negation 28, "keep" after a clear 18, an exclusion 16, an "or" part 13, a cut-off part 6, an unused reading 5, a value 4, a clear 1. The 36 with choices are sort 22, reading 9, group 5.
- **Most option-less questions ask for one part to be rephrased,** not for a value. Examples: "“taxable accounts over $1m but” stops after “but”. Finish that part, or leave the last word out." and "GridCue can't tell whether that keeps those rows or leaves them out. Say which rows to show." (`compile.ts:318-340`).
- **The plan can hold several questions, and the bars show only the first.** No eval Utterance produced two, but compound requests do (probe `probe-zero.mts`): "accounts over, and sort by" asks "I'm not sure what to change for “accounts over”" (no choices) and "Which column should be sorted by?" (9 choices). The first has no buttons, so the second is never reachable. "sort by. group by." asks two questions with choices; answering the first reveals the second.
- **The UIs render a question only when it has choices** (`grid-cue-bar.tsx:95`; `registry/registry/gridcue/clarification-prompt.tsx:12`). The built-in bars still print the first prompt in the status line (`controller.ts:153`). A Host that renders `ClarificationPrompt` alone shows nothing. A real Host application was found to show a GridCue question only when it has choices (owner's report from PR 1 testing; not re-checked here).
- **`answer` accepts any option ID on a question with no choices** and compiles again (`controller.ts:312`). The compiler reads only `"none"` from such an answer (`compile.ts:1237`). There is no way to answer one in words.
- **A question is tied to its part only by its ID.** Every question the compiler asks about one part has an ID starting `c<part index>.` (`compile.ts:318-1258`); the one exception is `plan.empty` (`compile.ts:1267`), which is about the whole request. The protocol's `Clarification` has no field for the part (`protocol.ts:169-174`).
- **A part's text is GridCue's cleaned text, not the User's.** It is lowercased, its spaces collapsed, and a borrowed verb added: "Sort by Gain.  Then by ADVISOR" becomes "sort by gain" and "sort by advisor" (probe `probe-spec.mts`). Questions quote it that way: "“taxable accounts over $1m but” stops after “but”" for a request typed with "$1M".
- **A column question lists every exposed column with that capability** (`compile.ts:243-246`, `compile.ts:1190`). On a 200-column schema that is 200 buttons.
- **The product doc says to ask one focused question** (`docs/internals/product.md:111`). Showing all of them at once rewrites that line.

### Match count

- **Neither adapter holds rows for GridCue to count.** `GridAdapter` has no row access (`packages/gridcue/src/core/adapter.ts:7-18`). The Rows Adapter takes a schema and a state, not rows; the Host keeps the rows and calls `applyView` (`packages/gridcue/src/core/rows-adapter.ts:7-12`, `:78`).
- **The TanStack Table adapter can reach rows** through `getCoreRowModel()` (`packages/gridcue/src/tanstack/index.ts:40`), but it reads only GridCue's own filters into the View State (`:111`). A Host's own column filters and any server-side filtering are invisible to it.
- **With `manualFiltering`, TanStack Table v9 rows are already filtered outside the table** and the filtered row model is the core one (installed 9.2.4: `table-core/dist/features/column-filtering/columnFilteringFeature.types.d.ts:178`, `table-core/dist/core/row-models/coreRowModelsFeature.utils.js:47`). A paged or server grid can't count locally. ADR 0018 made the same call for `limit.set` (`docs/adr/0018-size-words-main-value-column-and-counts.md:8`).
- **TanStack has three more ways for the core rows to be the wrong set.** `manualPagination` means the core rows are one page (`row-pagination/rowPaginationFeature.types.d.ts:24`); a global filter narrows rows GridCue doesn't read (`features/global-filtering`); and `getSubRows` nests rows the core list holds only at the top level (`core/rows/coreRowsFeature.types.d.ts:106`). A count helper must return nothing in each case.
- **Counting is cheap at 500 rows and not free at 100,000.** `applyView` over 500 synthetic rows ran 683 times inside the probe with no visible delay. At 100,000 synthetic accounts with two filters and a sort, `applyView` took 77 ms median and 88 ms worst over 21 runs; filtering alone took 73 ms (spec author's probe `probe-count.mts`). The filter is the cost, not the sort, so a separate count function would save little. A count must not hold up the Preview.
- **"0 rows" does not detect wrong views.** Probe `probe-zero.mts` judged every case in five eval files the way the harness does and counted rows on 500 synthetic accounts:

  | Ready plans | Count | 0 rows | All 500 rows |
  | --- | --- | --- | --- |
  | Exact | 493 | 37 | 129 |
  | Wrong view | 1 | 0 | 1 |

  The one wrong view ("Sort by balance with the gain column hidden.", in `cases-fanout.jsonl`, a set written for Jev that the gate does not run with the Mock, `evals/evals.test.ts:8-27`) kept all 500 rows. The 37 zero-row plans were correct; the synthetic data has no account over $10M, for example.
- **Zero rows is still the problem the owner saw.** "also trusts" on a view already filtered to Taxable gives 0 rows (probe `probe-lines.mts`). ADR 0017 exists because "a filter with no results left every later filter empty" on the live demo (`docs/adr/0017-a-new-filter-replaces-the-current-filters.md:5`).
- **Rows never reach a provider.** A count computed in the browser stays there. Audit events carry no values today (`preview.ts:147-201`); a count would be a new kind of data in them.

### Discovery

- **Suggestion chips exist only in the Site.** The demo's `AskBar` adds chips that fill the input and propose (`apps/site/app/components/demo/ask-bar.tsx:67-83`, `apps/site/app/routes/demo.tsx:20-28`). Neither package UI has them. AGENTS.md: "A feature that only works in the Site demo is not done."
- **There is no record of recent requests,** and AGENTS.md says: "Never record raw Utterances or schema details without explicit Host configuration" (`AGENTS.md:103`).
- **There is nothing that shows the current view in the bar.** The four bets add the View Sentence for that (four bets spec 5.3).
- **Nothing applies without a Preview** (`AGENTS.md:23`). A one-click removal that applies at once would break this.

### Where this meets the four bets

From `docs/superpowers/specs/2026-11-10-four-bets-design.md`:

| This opportunity | Four bets | Overlap |
| --- | --- | --- |
| Chips for the current view | The View Sentence on the bar's first line (5.3, 7) | Two descriptions of the same view. They must come from one source and show as one line |
| Removing a chip | `proposeView(state)` (5.3, ADR 0021) | A removal is "propose the current view minus this part". `proposeView` is that call |
| Replacing one part of the request with a typed answer | Positions in the User's own text (4.1) | Splicing a part back into what the User typed needs those positions |
| Suggestions under the input | The reading line shares the status row while typing (7, row 5) | Suggestions at an empty input and the reading line while typing don't collide |
| Suggestions drawn from the schema | "A completion menu" is out; Tab completes one name (Out, 5.5) | A dropdown while typing would be that menu |
| Editable Preview, all questions at once | "Preview panel, clarification buttons, Undo: unchanged" (7, last row) | That row changes. The bets' design pass must start from this work's bar |
| Schema suggestions resolved without a provider | "Every example request the Site suggests must resolve locally" (5.4) | A suggestion built as operations, not text, meets this before the Local Resolver exists |
| One vocabulary | Preview, sentence and reading line share words (4.2) | Chips, count and suggestion labels use the same module |

- "Editing the View Sentence in place" is out of the four bets (Out, line 55). Removing one part through a Preview is not editing its text, but it changes what that line does.
- **Splicing an answer back needs only where each part starts and ends** in the User's text, not 4.1's map of every character. The character map is what the underlines need; a part's span is the first piece of it.
- **Opportunity 4 also builds `proposeView`.** The routing and saved views grill recommends building it "exactly as four bets spec 5.3 and ADR 0021 describe it" (`docs/planning/routing-and-saved-views-grill.md:82-87`). Whichever lands first builds it, and the other uses it.
- The bets' Controller additions are `read`, `view`, `proposeView`, `resolvedBy`, and an optional `provider` (spec section 6). None conflicts with an `edit` verb, a typed answer, or a count.

### Surfaces this touches

- **Entry points.** Root: Controller and state additions. `gridcue/react`: binding, `<GridCueBar />`, `styles.css`. `gridcue/tanstack-table`: a count helper if Q3 (a). `gridcue/server` and `gridcue/mock`: none.
- **Both UIs.** `<GridCueBar />` and the registry's `command-bar.tsx`, `preview-panel.tsx`, `clarification-prompt.tsx`, plus new registry parts for chips and suggestions.
- **The Site.** `apps/site/content/docs/api/create-grid-cue.mdx:127-133` (`answer`), `api/react.mdx:44,114`, the three component pages, and the demo's `AskBar`.
- **Agent skill.** `skills/gridcue/SKILL.md:29` and `references/setup.md:37` name the two UIs; a count option is a setup step.

## Round 1

Answer by number. A bare "agree" accepts the recommendation. Each question says what evidence would change it.

❓ **Q1 - What the User can edit in a Preview.**
(a) ➡️ **Recommended: drop a line, and change a filter's value.** A value is picked from the column's declared values, or typed and read by GridCue's own amount and date reader, which must read it whole. Lines that only make sense together drop together: a count with its sort, and a filter removal with the filters it re-adds. Every edit makes a new plan that is validated and previewed again, with no provider call.
(b) Drop a line only.
(c) A full editor: column, comparison, and value.

Why (a): it is what the owner asked for, and each edit is certain. A declared value can't be misread, a typed amount is shown back in the new Preview before Apply, and no edit is re-read by a provider. (c) is a filter builder; the Host's own controls already do that (`product.md:102`). Would change if: a held-out set of edits finds a value the reader misreads, or Users in the representative Host never change values.

---

❓ **Q2 - How Clarifications are asked and answered.**
(a) ➡️ **Recommended: every open question at once, each next to its part of the request.** A question with choices also takes a typed answer, which must match exactly one choice by its declared name, or the question stays. A question with no choices gets a small field holding just its part. The edited part replaces the old one in the request, and the whole request is proposed again, with one provider call and a new Preview.
(b) Every question at once, choices only. A question with no choices keeps "Edit request", which now selects its part in the input.
(c) One question at a time, as today, with typed answers added.

Why (a): 82% of questions have no choices, a real Host application hid them, and one unanswerable first question hides a second that has choices. A part's own field is the narrowest typed answer: it asks for words only where the question already asks for words, and the result is still checked and previewed. `product.md:111` is rewritten to match. Would change if: a held-out set of typed answers, labelled first, gives one wrong view, or Users in the representative Host answer most questions by choice anyway.

---

❓ **Q3 - Where the match count comes from.**
(a) ➡️ **Recommended: an optional `countRows(state)` the Host passes to `createGridCue`.** It may return a number or a promise. A Rows Adapter Host passes one line with `applyView`. `gridcue/tanstack-table` exports a helper that counts the table's own rows, and returns nothing when `manualFiltering` is on or a Host column or global filter is set. Without a count, the Preview has no count line and nothing else changes.
(b) A new optional `countRows` on the Grid Adapter, with the Rows Adapter taking rows. This changes the adapter interface and needs an ADR.
(c) The Rows Adapter only.

Why (a): the Host owns the data (AGENTS.md rule 4), so the Host decides how to count, including a server count for a paged grid. It changes no adapter interface. A grid that can't count shows no number rather than a wrong one, as ADR 0018 did for counts. Would change if: most Hosts turn out to use one adapter whose rows GridCue can count exactly, which would make (b) less work for them.

---

❓ **Q4 - What a count of zero does.**
(a) ➡️ **Recommended: it says so in words and Apply stays.** "No rows match" sits with the other counts in the Preview, with no colour-only cue. The plan's status doesn't change, and the count is not sent to a provider or put in an audit event unless the Host asks.
(b) Zero rows turns the plan into a question: "No rows match. Apply anyway?"
(c) Zero rows disables Apply.

Why (a): the probe found 37 correct ready plans with 0 rows and one wrong view that kept all 500. Zero is information, not a wrong-view signal, and an empty result can be the answer the User wanted. Would change if: in the representative Host, Users apply a zero-row Preview and then undo it in most cases.

---

❓ **Q5 - The current view in the bar.**
(a) ➡️ **Recommended: one current-view line, built now as removable parts.** A root function describes each part of the view (each filter, the sort, the grouping, the count, hidden columns) in the shared vocabulary. The bar shows them as chips. The × on a chip proposes that part's removal as a Preview, through `proposeView`; it never applies directly. When the View Sentence ships, it joins the same parts, and the bar keeps one line: the sentence, with each part still removable.
(b) The same chips, but the × applies at once, with Undo as the safety net. This breaks "Nothing applies without a Preview" and needs an ADR.
(c) No chips. Wait for the View Sentence, and add removal then.

Why (a): two lines describing one view would drift apart, and the bets already plan one vocabulary. A removal through a Preview keeps rule 3 and costs one keystroke (Ctrl+Enter). It also covers "remove the taxable filter", which asks today. It needs the owner's sign-off because the four bets keep the sentence read-only. Would change if: the round-trip test shows the sentence can't be split into parts that each read alone.

---

❓ **Q6 - Suggestions: when and from where.**
(a) ➡️ **Recommended: only when the input is empty and focused, at most five.** First the Host's own examples (a new option), then this session's recent requests, then starters built from the schema ("Group by Custodian"). A schema starter is a set of operations proposed directly, not text sent to a provider. Recent requests live in memory for the Controller's life; a Host that wants them kept passes its own store, and GridCue never writes browser storage. Suggestions hide as soon as the User types.
(b) A dropdown that filters while the User types, from schema names and recent requests, saved in browser storage.
(c) The Host's examples only.

Why (a): it moves the Site-only chips into both UIs without a completion menu, which the four bets put out. Once the User types, the bets' reading line and Tab completion own that space, so the two never collide. Keeping recent requests in memory follows the rule on raw Utterances, which matters on shared desks. Would change if: Users in the representative Host reach for suggestions mid-request, which would argue for (b) after the bets ship.

---

❓ **Q7 - How the Controller grows.**
(a) ➡️ **Recommended: a few narrow verbs, each ending in a fresh, validated Preview.** `edit(change)` on the current Preview; `answer(id, { text })` beside `answer(id, optionId)`; `proposeView(state)` from the four bets, built now; the `countRows` option with `rowCount` in the Controller's state; and `recent` in the state. The protocol does not change: an edit is recorded as evidence with source `user`.
(b) One general `proposeOperations(operations)` that the UIs use for edits, chips and suggestions.
(c) No Controller change. The UIs rewrite the request text and call `propose` again.

Why (a): (c) sends each edit back through a provider, which can read it differently, and puts behaviour in components against ADR 0001. (b) gives Hosts a raw operation API the bets don't need, while `proposeView` is already approved in ADR 0021. Would change if: the spec finds `edit` and `proposeView` need the same diffing code, in which case one can be built on the other without changing what Hosts see.

---

❓ **Q8 - Order and shape of the work.**
(a) ➡️ **Recommended: one spec and one plan, then five PRs, each one change from core to both UIs.** (1) Edit a Preview. (2) The row count. (3) Every question, answered in words, with each part's span in the User's text pulled forward from four bets 4.1. (4) The current view as parts, with `proposeView` pulled forward from 5.3 unless opportunity 4 has built it. (5) Starters. Each pulled piece lands with the first thing that uses it. The four bets' PRs 2 and 3 then build on these instead of adding them, and their design pass starts from this bar.
(b) Pull nothing forward. Build only what works without spans and `proposeView`: option-less questions keep "Edit request", and chips wait for the bets.
(c) Ship the UI-only pieces first (all questions shown, the count) and plan the rest after the bets.

Why (a): both pulled pieces are already designed and approved, so building them once now avoids rework. Without spans, a replaced part would put GridCue's cleaned text in the User's input. Splicing needs only each part's span, not 4.1's map of every character, so the pulled piece is small. One PR per change follows "one concern per PR" and lets each be checked end to end in a browser. The UI design pass with the three skills runs in the spec, with a throwaway prototype of the whole bar, including the bets' future lines, for the owner to see first. Would change if: a part's span can't be found for every labelled Utterance, in which case Q2 falls back to (b) for this release.

*Revised by the spec author on 2026-11-13,* after checking the facts: the first draft pulled all of 4.1 forward and put the core of every change in one PR. See "Checked against the code" below.

## Checked against the code (2026-11-13)

The spec author re-checked every fact above against the branch before writing the spec and plan, and re-ran `probe-clarify.mts` and `probe-zero.mts`: their numbers stand (683 Utterances, 197 questions, 161 with no choices; 493 exact ready plans, 37 with 0 rows, one wrong view keeping all 500). What changed:

- **Line numbers.** `grid-cue-bar.tsx:90` is `:95`; `compile.ts:1233` is `:1237`; `compile.ts:1274` is `:1278`. Fixed above.
- **New facts,** added above: a question is tied to its part only by its ID; a part's text is GridCue's cleaned text; "show only" makes three lines that each read alone; TanStack's `manualPagination`, global filter and `getSubRows` also make its core rows the wrong set; counting 100,000 rows takes about 77 ms, almost all of it the filter; opportunity 4 also builds `proposeView`.
- **Q8 changed.** Only each part's span is pulled forward from 4.1, not the character map, and the work is five PRs, one change each. Rewritten above.
- **Q1, refined in the spec, not changed:** a text value ("containing Lane") is taken exactly as typed, since text filters match it without regard to case. The spec lists it with the other values.
- **Q7, refined in the spec, not changed:** `answer(id, { text })` returns a promise, because a rephrased part is proposed again.

## Owner's answers (2026-11-13)

The questions were put to the owner as decisions D1 to D45 in section 7 of `docs/superpowers/plans/2026-11-13-five-opportunities-order.md`. The lead's message said "a bare agree accepts every recommendation". The owner gave one reply to the whole list. It is recorded against each question here, with the decisions the question maps to.

| Question | Answer | Decisions in the order plan |
| --- | --- | --- |
| Q1 - What the User can edit in a Preview | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) | D37 |
| Q2 - How Clarifications are asked and answered | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) | D41 |
| Q3 - Where the match count comes from | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) | D39, D5 |
| Q4 - What a count of zero does | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) | D40 |
| Q5 - The current view in the bar | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) | D42, D43 |
| Q6 - Suggestions: when and from where | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) | D44, D45 |
| Q7 - How the Controller grows | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) | D38, D29 |
| Q8 - Order and shape of the work | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." (2026-11-13) | D1, D2, D29 |

The reply approved the recommended answers as section 7 of the order plan states them, along with the spec and the plan. Section 7 was written after the five grills were checked against each other. D3, D4, D5, D43 and D45 came from that check, and this round did not ask them. Where section 7 differs from this round's own recommendation, section 7 stands. For this record the differences are:

- **Q6 and D45.** This round recommended recent requests on by default, kept in the Controller's memory. Section 7 has them off unless the Host sets `recent: true` or passes a store, because `AGENTS.md` says raw Utterances are never recorded without explicit Host configuration. D45 is new: this round did not ask it.
- **Q5 and D43.** This round had no rule for removing the sort or a filter part on a view with a count. Section 7 adds one: GridCue asks the count question first, and each answer is a whole view shown in a Preview. D43 is new: this round did not ask it.
- **Q3 and D5.** This round called the number a "match count", and the first spec named it Row Count. Section 7 names the glossary term **Rows Shown**, because the operation set adds **Count** for "top 10". `countRows` and `rowCount` stay as the names in code. D5 also sets the error stage for a Host callback that throws: `INPUT_` while a request is read, `ADAPTER_` at Apply.
- **Q7, Q8, D29 and D38.** This round had this work build `proposeView` unless routing and saved views had built it. Section 7 settles it: routing's PR 1 builds `proposeView` once, and this work uses it. This work's PR 3 still pulls forward each part's span. `recent` in the Controller's state follows D45.
- **Q8 and D1.** This round ordered this work's own five PRs. Section 7 places them last of the five opportunities, as steps 24 to 28, after the planning record (C0, step 5). The pieces this work shares with the others are built by their first user, as section 3 of the order plan lists.
- **Q2 and D3.** This round did not cover a grid that can't do what was asked. Section 7 makes that a question with no choices, with nothing applied, from one shared piece of code. It is about one part, so under Q2 it takes a new wording of that part like any other question with no choices.
- **D2 and D4** apply as written. The planning record's PR edits ADR 0021, ADRs 0019 and 0022, and the four bets spec, as sections 4 and 5 of the order plan list. A held-out wrong view from a word nothing reads keeps the bar at 0 and narrows the class to a question.

No trim applies to this record. The lead recommended two trims in the same message. The owner's reply does not name them, and the lead reads it as covering them. Neither touches this work.

The terms **Rows Shown**, **View Part** and **Starter** enter `CONTEXT.md` with these answers, and **Clarification** is rewritten.
