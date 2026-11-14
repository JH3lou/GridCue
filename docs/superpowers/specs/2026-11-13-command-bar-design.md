# A command bar people live in: design spec

Status: approved by the owner on 2026-11-13. Answers in docs/planning/command-bar-grill.md.

**Date:** 2026-11-13
**Scope:** grill answers Q1 to Q8 in `docs/planning/command-bar-grill.md`, as the owner approved them in section 7 of `docs/superpowers/plans/2026-11-13-five-opportunities-order.md` (D37 to D45, and D1 to D5 where they touch this work).
**Plan:** `docs/superpowers/plans/2026-11-13-command-bar.md`

This is the current best design. Every mechanism below has an evidence bar in section 10, fixed before any code. A mechanism that misses its bar is reworked or removed; the bar does not move. Section 14 says what evidence would change each decision.

## 1. Purpose

Today the Controller can propose, answer by choice, apply, cancel, and undo, and both UIs can do no more than that. A User who wants one line less, or a different amount, retypes the whole request. The Preview says nothing about how many rows will be left. Only the first question shows, and only when it has choices, though 161 of the 197 questions in the evals have none. Nothing helps a new User find what to ask, and nothing in the bar shows the view as it is now.

This work makes the bar a place a User stays in:

1. **Edit the Preview.** Drop a line, or change a filter's value, and get a new Preview without retyping.
2. **See the Rows Shown.** "Shows 57 of 500 rows" in the Preview, counted by the Host.
3. **Answer every question.** All open questions show at once. Each can be answered by choice or in words.
4. **See the current view.** The view reads as parts, and each part can be removed through a Preview.
5. **Start from something.** At an empty input, a few starters: the Host's examples, recent requests where the Host turns them on, and changes built from the View Schema.

Success means:

- 0 wrong views on every labelled set, old and new;
- each mechanism meets its bar in section 10 on cases labelled before its code exists;
- nothing that is exact today stops being exact, and the payload sent to a provider does not change;
- every change works in `<GridCueBar />` and in the Component Registry, in the Vite and Next.js examples.

## 2. Decisions this spec builds on

| Decision | Source |
| --- | --- |
| Drop a line, or change a filter's value, with no provider call. Lines that only make sense together drop together | Grill Q1 |
| Every open question shows, each next to its part. A typed answer matches one choice exactly or the question stays. A question with no choices takes a new wording of its part, and the request is proposed again | Grill Q2 |
| The Host counts rows through an optional `countRows`. The Grid Adapter interface does not change. The glossary term is Rows Shown; `countRows` and `rowCount` stay in code | Grill Q3, order plan D5 |
| Zero rows is said in words. Apply stays, and the plan's status doesn't change | Grill Q4 |
| One current-view line, built as removable parts. Removing a part goes through a Preview | Grill Q5 |
| On a view with a count, removing the sort or a filter part asks the count question first. Each answer is a whole view shown in a Preview | Order plan D43 |
| Starters only at an empty, focused input, at most five | Grill Q6 |
| Recent requests are off unless the Host sets `recent: true` or passes a store | Order plan D45 |
| A few narrow verbs, each ending in a fresh, validated Preview. The protocol does not change | Grill Q7 |
| Five PRs, one change each, built last of the five opportunities. Each part's span is pulled forward from the four bets in PR 3. `proposeView` is built once, by routing's PR 1 | Grill Q8, order plan D1 and D29 |
| A grid that can't do what was asked says so in a question with no choices, and nothing applies | Order plan D3 |
| A held-out wrong view from a word nothing reads keeps the bar at 0. The class is narrowed to a question, and no reading is added | Order plan D4 |
| A Host callback that throws while a request is read is an `INPUT_` error; one that throws at Apply is an `ADAPTER_` error | Order plan D5 |
| Additive, optional fields. The protocol stays 0.1 | ADR 0010 precedent |
| Behaviour in hooks, look in components, in both UIs | ADRs 0001 and 0008 |

## 3. Scope

### In

- **PR 1, edit a Preview:** `edit`, which lines can be dropped or changed, the value reader, both UIs (5.1).
- **PR 2, the Rows Shown:** the `countRows` option, `rowCount` in the state, a TanStack Table counter, both UIs (5.2).
- **PR 3, every question, answered in words:** each part's span in the User's text (4.1), typed answers, a new wording for a part, both UIs (5.3).
- **PR 4, the current view:** the rest of the words module (4.2), `describeViewParts`, removal through the `proposeView` that routing built (4.3), the current-view line in both UIs (5.4).
- **PR 5, starters:** the Host's examples, recent requests when the Host turns them on, schema starters, both UIs, and the Site demo's move to them (5.5).
- Five ADRs (section 7), `CONTEXT.md` terms (section 8), and the docs, Site and agent skill pages in section 11.

### Out

- **Building what an earlier opportunity builds.** This work is the last of the five (`docs/superpowers/plans/2026-11-13-five-opportunities-order.md`). `proposeView`, the seeded view generator, the ledger fixture, the payload pin test, the input's text in the hook, the label helpers and the bar prototype all exist by then, and this work uses them.
- **A full Preview editor.** Changing a line's column or its comparison, adding a line, or reordering lines. The Host's own controls do that (`docs/internals/product.md:102`).
- **Editing a value inside a range or a list.** A "between" filter and an "any of" filter can be dropped, not changed.
- **Changing a sort direction, a group, or a column list in the Preview.** Drop the line and ask again.
- **A Preview of the settled parts while a question is open.** The compiler still empties a plan that asks (`compile.ts:1278`).
- **Reading "remove the taxable filter".** It still asks. The × on that part does it.
- **The Rows Shown in an audit event or a provider request.** The Host can read `rowCount` from the state.
- **Rows that the Grid Adapter counts.** The adapter interface does not change.
- **Starters while typing, and a completion menu.** The four bets own the input once the User types.
- **Recent requests by default, or in browser storage.** They are off unless the Host turns them on. A Host that wants them kept passes its own store.
- **Editing the View Sentence's text.** Parts can be removed, not rewritten.
- **A × on pinned columns, totals or density.** The operation set makes them reachable by request. Here they show as parts with no ×.

## 4. Shared pieces

### 4.1 Each part's span in the User's text (PR 3)

Pulled forward from four bets 4.1, which is approved. Only the first piece is built here: where each Clause starts and ends in the Utterance. The map of every character, which the underlines need, stays in four bets PR 2.

Today a Clause's text is GridCue's cleaned text: lowercased, spaces collapsed, and sometimes given a borrowed verb. "Sort by Gain.  Then by ADVISOR" becomes "sort by gain" and "sort by advisor". Nothing maps a part back to what the User typed.

- `normalize` sets `Clause.source = { start, end }`, the part's span in the Utterance as typed. The span leaves out the separator that joined it to the part before (",", "and", "then", ".", a dictated "comma"). A borrowed verb has no span: the second part above spans "Then by ADVISOR".
- Every Clause has one span, and spans don't overlap. A part that a clear or reset keeps ("except accounts over $1m") spans its own words.
- None of this is sent to a provider. `buildResolutionRequest` already picks the fields it sends (named filters PR 2), and `source` is not one of them. The payload pin test (operation set PR 1) covers every labelled Utterance and passes unchanged.
- Four bets PR 2 adds the character map under the same `Clause.source` field. Nothing built here changes then.

### 4.2 Words in one module (PR 2, then PR 4)

Pulled forward from four bets 4.2, in part. PR 2 starts `core/words.ts` with `rowCountText`; PR 4 moves the rest in. The Preview's words ("above", "at or above", "below", "at or below", "between", "containing", "starting with", "ascending", "descending") and `formatValue` move to one module, `core/words.ts`. The Preview, the parts in 5.4, the Rows Shown in 5.2 and the starters in 5.5 import it.

- No Preview line changes. The Preview-line pin test (named filters PR 2) holds every line the evals produce, and it passes unchanged.
- Named filters and the operation set add their new Preview words (dates, "exactly", "is empty", totals) to `preview.ts` before this work. PR 4 moves them with the rest.
- The other half of 4.2, that `normalize` reads every word GridCue prints, stays in four bets PR 3. It changes reading, and it is tested there by the round trip.

### 4.3 `proposeView` (used from PR 4)

Pulled forward from four bets 5.3 and ADR 0021, both approved, exactly as designed there. Routing and saved views builds it, in its PR 1. A View State is untrusted. It is parsed (`INPUT_INVALID_VIEW` if it can't be), turned into the operations that change the current view into it, validated like any plan, and shown as a Preview. If the operations can't reproduce it exactly, the result is unsupported. If the grid already shows it: "The grid already shows this view." The plan's source channel is `"api"`.

Both this work and opportunity 4 planned to build it. The owner approved one answer (order plan D29): opportunity 4 comes first and builds it, and this work adds only the removal tests in section 10. It is built once.

## 5. Units

### 5.1 Edit a Preview (PR 1)

On the wealth fixture's default view, with the Mock Provider:

| Preview, and the User's edit | Today | After |
| --- | --- | --- |
| "top 10 by gain": × on "Sort by Unrealized gain, descending" | Retype the request | Both lines go. The × names "Show only the first 10 rows" before it is pressed |
| "top 10 by gain": × on "Show only the first 10 rows" | Retype | Sort by Unrealized gain, descending |
| "taxable accounts over $1m": change $1,000,000 to "2m" | Retype | Filter Market value above $2,000,000 |
| The same, changed to "2m+" or "1.000.000" or "over 2m" | — | Refused in the field: "GridCue couldn't read “2m+” as an amount." The Preview is unchanged |
| "trusts": pick Taxable from Registration type's values | Retype | Filter Registration type to Taxable |
| `advisor containing "lane"`: change to "Lee" | Retype | Filter Advisor containing “Lee” |
| "clear the market value filter", on a view filtered to Market value and Taxable: × on "Filter Registration type to Taxable" | Retype | Remove the filters Market value above $1,000,000; Registration type to Taxable |
| The same Preview: × on "Remove the filters …" | Retype | No × is offered: it would take the line it puts back with it, and nothing would be left. Cancel does that |
| "show only advisor and market value": × on "Hide Account number, …" | Retype | Show Advisor and Market value · Put Advisor and Market value first |

**Core.** One synchronous call, with no provider:

```ts
controller.edit({ line: 0, drop: true });          // drop line 0, and any line tied to it
controller.edit({ line: 1, value: "2m" });         // a typed value
controller.edit({ line: 0, choose: "taxable" });   // one of the column's declared values, by ID
// => { ok: true, plan } | { ok: false, code: "INPUT_UNREADABLE_VALUE" | "INPUT_NOT_EDITABLE", message }
```

The state says what each line allows, so both UIs draw the same controls:

```ts
state.lineEdits; // one per Preview line, or null when there is no ready Preview
// [{ drop: { with: [1] },  value: null },
//  { drop: { with: [] },   value: { kind: "amount", text: "$1,000,000", at: 30 } }]
```

- **Line *i* is operation *i*.** The Preview already renders one line per operation, in order (`preview.ts:133`).
- **Tied lines.** Two rules, plus one for House Terms (below), and only these:
  - a `limit.set` is tied to a `sort.set` in the same plan: dropping the sort drops the count. The count was asked of that order.
  - a `filter.add` whose predicate is already in the current view, after a `filter.clear` in the same plan, puts that filter back: dropping the clear drops it too.
  
  Dropping the second line of either pair on its own is allowed, since each line left still does exactly what it says.
- **No line can be dropped when it and its tied lines are all the lines left.** Cancel does that.
- **A count still follows its rows.** The operation set's count rule (its 5.1) is about a plan and the view it applies to, so an edited plan must pass it too. A line has no × when dropping it would leave a plan that changes the sort or the filters of a view with a count and sets no count of its own. The usual case is the "Show only the first 10 rows" line that the count question added: without it the count would stay, and the Preview would no longer say so.
- **Lines one House Term made** (named filters 5.3) drop together. Their values can't be changed, and nor can a line that carries date words ("last 90 days"). So the words in brackets never sit on a filter they didn't make.
- **A pending save or grid** (routing 4.2) is not a plan. `lineEdits` is `null` for it.
- **Which values change.** A `filter.add` with one value: equal, not equal, above, at or above, below, at or below, containing, starting with. An enum or a yes/no column offers its declared values (`choose`). A number, amount, percent or date column takes typed text (`value`). A text column takes the typed text as it is.
- **The typed value is read whole.** `normalize` reads the trimmed text. It must give one Clause with one literal, no comparison word, covering the whole text, of a kind the column can hold (ADR 0013's kind rule). Anything else is refused with `INPUT_UNREADABLE_VALUE`, and nothing changes. A typed date is one ISO date; a relative form from named filters ("today", "last 90 days") is refused in the field. Text for a text column must be non-empty, at most 200 characters, and hold no quote mark.
- **Every edit is a new plan.** It has a new ID, the same base Revision and source, the edited operations, and one evidence entry per edit (`edit.1.drop`, `edit.2.value`, source `user`). It is validated against the schema, the capabilities and the current Revision, its Preview is rendered again, and its rows are counted again. A plan that fails validation is unsupported, as any plan is.
- **An edited plan is not checked against the request's words.** The User changed it on purpose after reading it. ADR 0019's and ADR 0022's checks still run on the plan the request produced, before any edit.
- **Edits add up.** Each starts from the current edited plan. Cancel drops them all. Enter in the input reads the request again, with one provider call.
- **The status message after an edit** is "Preview updated." The Preview is what the User checks before Apply.

### 5.2 The Rows Shown (PR 2)

On 500 synthetic accounts (`generateAccounts(500, 42)`):

| Request | Today | After |
| --- | --- | --- |
| "taxable accounts over $1m" | Two lines | The same, then "Shows 57 of 500 rows." |
| "trusts" | One line | "Shows 136 of 500 rows." |
| "also trusts", on a view filtered to Taxable | One line, and the grid is empty after Apply | "No rows match." in the Preview, before Apply. Apply stays |
| "group by advisor" | One line | "Shows all 500 rows." |
| "top 10 by gain" | Two lines | "Shows 10 of 500 rows." |
| Any request, on a grid with no `countRows` | Lines | Lines. No Rows Shown line |

**Core.**

```ts
createGridCue({ adapter, provider, countRows: (state) => applyView(rows, state, schema).rows.length }); // Rows Adapter
createGridCue({ adapter, provider, countRows: tanstackRowCounter(table) });                          // gridcue/tanstack-table
createGridCue({ adapter, provider, countRows: (state) => api.count(state) });                        // a server-side grid
```

- `countRows(state)` returns a whole number, a promise of one, or `undefined` for "can't count". GridCue calls it for the view the ready plan would produce, and for that view with no filters and no Count, which is the total. The total is kept per Revision.
- **It never holds up the Preview.** The Preview shows first; the rows are counted after the next paint. A number that arrives for a plan no longer shown is dropped.
- **A number that can't be trusted shows nothing.** `undefined`, a throw, a rejected promise, a negative or fractional number, or more rows shown than the total: no Rows Shown line. A `countRows` that throws is not an error the User sees. It runs after the request is read and before Apply, so neither stage in order plan D5 is its own, and the Preview it follows is still good.
- **`state.rowCount`** is `{ shown, total }`, `"counting"`, or `null`. It is set only while a ready plan is shown. A pending save or grid (routing 4.2) is not a plan, so it has no Rows Shown.
- **Wording** comes from one function, `rowCountText`, in the words module: "Shows 57 of 500 rows.", "Shows all 500 rows.", "Shows 1 of 500 rows.", "No rows match." It always says "rows". A Row Noun's plural is not guessed.
- **Zero changes nothing else.** The plan stays ready and Apply stays (grill Q4). An empty result can be the answer the User wanted: 37 correct ready plans in the evals give 0 rows.
- **The Rows Shown go nowhere.** They are not in the Preview's `text`, not in an audit event, and never in a provider request.

**`tanstackRowCounter(table)`** counts the table's core rows that match the state's filters, capped by its Count, with GridCue's own filter function. It caps as the operation set defines a Count: a row with no value in the first sorted column never fills it. It returns `undefined`, and the Preview shows no Rows Shown line, when any of these holds: `manualFiltering`, `manualPagination`, a global filter, a column filter GridCue didn't write (or a Host value carried in one of GridCue's), or `getSubRows`. In each case the core rows are not the set the User sees.

### 5.3 Every question, answered in words (PR 3)

| Request | Today | After |
| --- | --- | --- |
| "sort by" | Nine buttons | Nine buttons, and a field. Typing "market value" and Enter answers it. "mark" alone matches nothing whole, so the question stays and says "Pick one of the choices, or type its full name." |
| "accounts over, and sort by" | Only "I'm not sure what to change for “accounts over”" in the status line, with no control. The sort question can't be reached | Both questions, in order. The first has a field holding "accounts over"; the second has its choices |
| "Taxable accounts over $1M but" | The prompt in the status line and an "Edit request" button | The prompt, and a field holding "Taxable accounts over $1M but", as typed. The User deletes "but" and presses Enter: "Taxable accounts over $1M" is proposed |
| "sort by. group by." | The sort question; the group question appears after it is answered | Both questions at once |
| A question on a schema with 200 sortable columns | 200 buttons | The field first. Typing narrows the buttons to at most 8 whose names contain the text |
| "That request doesn't change the view…" (`plan.empty`) | Status line and "Edit request" | Unchanged. This question is about the whole request |

**Core.**

```ts
controller.answer("c1.sort.column", "market_value");        // as today: by choice ID. Synchronous
await controller.answer("c1.sort.column", { text: "Market Value" }); // a typed choice. No provider call
await controller.answer("c0.cut", { text: "Taxable accounts over $1M" }); // a new wording of the part. One provider call
```

- **`state.clarifications`** lists every open question, each with its part: `{ clarification, part: { index, text, start, end } | null }`. `text` is the User's own words, from the part's span (4.1). The part comes from the question's ID: every question about one part starts `c<index>.`, and a test pins that for every question the compiler can ask. `plan.empty` has no part.
- **A typed answer to a question with choices** must name exactly one choice: its label, or a declared alias of the column or value it stands for, compared as whole names with letter case and punctuation ignored. One match answers it, with no provider call, exactly as `answer(id, optionId)` does. None, or more than one, leaves the question open with "Pick one of the choices, or type its full name." A typed answer is never read as a request.
- **A new wording of a part** replaces that part's span in the Utterance and proposes the whole request again, with one provider call and a new Preview. The User's other words are kept exactly as typed. An empty wording drops the part, with the separator before it (or after it, for the first part).
- **Answers to other questions carry over** only when they are certain to mean the same: the new request has the same number of parts, and the answered part's text is unchanged at the same index. Otherwise that question is asked again.
- **"This grid can't …"** (more grids 5.3, order plan D3) is a question with no choices, asked by the compiler about one part. It shows like any other: with a field holding that part. A new wording, or an empty one that drops the part, is the way on. Its ID starts `c<index>.`, and the test that every question names its part covers it.
- **Questions asked outside the compiler have no part.** The count question (operation set 5.1) and the saved-view and grid questions (routing 4.1) are about the whole request, like `plan.empty`. They show with their choices, or with no field. The test that every question names its part covers the compiler's questions only.
- **`state.utterance` becomes the new request,** and both UIs show it in the input, so the input always holds what was proposed. The input's text is already in the hook (`text` and `setText`, from routing's PR 3).
- **`message` does not change.** It is still the first question's prompt (`controller.ts:153`), so a Host that shows only the status line keeps working. Both bars show the questions in a panel and only the label "Needs your input" in the status line.
- `docs/internals/product.md:111` changes from "Ask one focused question and offer bounded choices where possible" to "Show every open question, each with its part, and accept a choice or a new wording of that part."

### 5.4 The current view (PR 4)

On a view filtered to Taxable and above $1M, grouped by Advisor, with Custodian hidden:

| What the User does | Today | After |
| --- | --- | --- |
| Looks at the bar | Nothing about the view | Current view: [Registration type is Taxable ×] [Market value above $1,000,000 ×] [Grouped by Advisor ×] [Hiding Custodian ×] |
| Presses × on "Registration type is Taxable" | — | A Preview: "Remove the filters Registration type to Taxable; Market value above $1,000,000 · Filter Market value above $1,000,000". Apply or Cancel as usual |
| Types "remove the taxable filter" | Asked: "also names Taxable. Split it into separate parts" | Unchanged. The × does it |
| Clicks a column header to sort | The bar says nothing | A part "Sorted by Gain, descending" appears, with no transition |
| Opens the default view | — | Current view: All accounts (or "All rows" with no Row Noun) |

**Core.**

```ts
const parts = describeViewParts(state, schema, { defaultState, capabilities });
// [{ id: "filter:f1", kind: "filter", text: "Registration type is Taxable",     without: ViewState | null },
//  { id: "filter:f2", kind: "filter", text: "Market value above $1,000,000",   without },
//  { id: "group",     kind: "group",  text: "Grouped by Advisor",              without },
//  { id: "hidden",    kind: "columns", text: "Hiding Custodian",               without }]
```

- **Order:** rows, grouping, sorting, count, columns, as the four bets order the View Sentence.
- **Filters:** one part for each condition in a top-level "and" group. An "or" group, or a nested group, is one part for the whole filter. Labels only, never IDs or aliases.
- **Sort:** one part for every level. **Grouping:** one part. **Count:** "First 10 rows". **Columns,** against the default view: "Hiding Custodian and Household" when some are hidden, "Columns in a new order" when the order changed. **Pinned columns, totals, density:** a part with no ×.
- **`without`** is the view with that part removed: the condition taken out of the filter (no filter if it was the last), no sort, no grouping, no count, the hidden columns shown, the default order. It is `null`, and the part has no ×, when the grid can't make that change.
- **The × calls `proposeView(part.without)`** (4.3). It never applies directly, so "Nothing applies without a preview" holds. Apply, Cancel, Undo, audit and a stale Revision all behave as for any plan.
- **On a view with a count,** removing the sort or a filter changes which rows the count keeps, and `proposeView` alone would leave the count in place with a Preview that doesn't mention it. That is the defect the operation set's count fix closes for requests. So such a removal first asks the operation set's question ("Keep only the first 10 rows of the new view, or show every row?"), and each answer is a whole view proposed through `proposeView`. Removing the count part itself never asks. The owner approved this (order plan D43) over tying the sort part to the count.
- **`state.viewParts`** holds the parts for the grid's current view. It is computed once per Revision, so it follows the User's own header clicks (ADR 0009).

### 5.5 Starters (PR 5)

| What the User does | Today | After |
| --- | --- | --- |
| Focuses the empty input, in a Host that passed `examples` | Nothing (the Site demo alone has chips) | Up to five starters: the Host's examples first |
| The same, after applying "trusts" earlier in the session, in a Host that set `recent: true` | Nothing | "trusts" among the starters, marked as recent |
| The same, in a Host that set no `recent` option | Nothing | No recent starter. No Utterance is kept |
| The same, in a Host with no examples, on a schema with a groupable enum column and a `defaultMeasure` | Nothing | "Group by Custodian" and "Sort by Market value, descending" |
| Types one letter | — | The starters hide. The input is the User's |
| Picks "Group by Custodian" | — | A Preview from `proposeView`, with no provider call. The input shows "Group by Custodian" |
| Picks an example or a recent request | — | The input takes its text, and it is proposed like a typed request |

**Core.**

```ts
createGridCue({ adapter, provider, examples: ["Taxable accounts over $1M", "Group by custodian, then by advisor"] });
createGridCue({ adapter, provider });                                                            // no recent requests: the default
createGridCue({ adapter, provider, recent: true });                                              // this session's, in memory
createGridCue({ adapter, provider, recent: { initial: saved, onChange: (list) => save(list) } }); // the Host keeps them
state.starters; // [{ kind: "example", label, text }, { kind: "recent", label, text }, { kind: "schema", label, state }]
```

- **At most five,** in this order: the Host's examples, then recent requests where the Host turned them on, then schema starters. A starter whose text matches one already listed (case ignored) is left out.
- **Recent requests** are Utterances whose plan was applied, newest first, at most five. A plan the User edited (5.1), or one from `proposeView`, is not recorded: its text no longer says what was applied. A save or a grid offer (routing) is not recorded either.
- **Recent requests are off unless the Host turns them on** (order plan D45). `AGENTS.md` says: "Never record raw Utterances or schema details without explicit Host configuration." Kept by default, even in memory, they would sit against that rule, and on a shared desk the next User would see them. With no `recent` option, or `recent: false`, GridCue keeps no Utterance and `state.recent` is empty. With `recent: true` they live in the Controller's memory and are gone when it is. With a store, `recent.initial` and `recent.onChange`, the Host keeps them and decides where they go. `recent.onChange` runs at Apply, so if it throws the error is an `ADAPTER_` one (order plan D5). GridCue never writes browser storage.
- **Schema starters** are built from the View Schema and the current view, never sent to a provider: "Group by" the first exposed groupable enum column, and "Sort by" the `defaultMeasure`, descending, when one is declared and can sort. Each is a View State proposed through `proposeView`. One the current view already has is left out.
- **When they show:** the input is empty, nothing is pending, and focus is inside the bar. Typing hides them. Once the four bets ship, the reading line owns that row while the User types, so the two never meet.
- **The Site demo** passes its ten requests as `examples` and drops its own chips (`apps/site/app/components/demo/ask-bar.tsx:67-83`). Their comment says each is checked against the Mock Provider (`apps/site/app/routes/demo.tsx:18`), but no test does it today. Named filters' PR 3 adds that test when it first changes the suggestions; PR 5 points it at the `examples`.

## 6. Public API and protocol

All additive. Nothing is removed or renamed.

| Addition | Entry | PR |
| --- | --- | --- |
| `controller.edit(change)`, `PreviewEdit`, `EditResult` | root | 1 |
| `ControllerState.lineEdits`, `LineEdit` | root | 1 |
| `INPUT_UNREADABLE_VALUE`, `INPUT_NOT_EDITABLE` | root | 1 |
| `edit` and `lineEdits` on the `useGridCue` binding | `gridcue/react` | 1 |
| `GridCueOptions.countRows` | root | 2 |
| `ControllerState.rowCount`, `RowCount`, `rowCountText` | root | 2 |
| `tanstackRowCounter(table)` | `gridcue/tanstack-table` | 2 |
| `Clause.source` (a part's span) | root | 3 |
| `controller.answer(id, { text })`, returning a promise | root | 3 |
| `ControllerState.clarifications`, `OpenClarification` | root | 3 |
| `describeViewParts`, `ViewPart` | root | 4 |
| `ControllerState.viewParts` | root | 4 |
| `removeViewPart(part)` on the binding | `gridcue/react` | 4 |
| A `currentView` prop on `<GridCueBar />`, default on | `gridcue/react` | 4 |
| `GridCueOptions.examples`, `GridCueOptions.recent` | root | 5 |
| `ControllerState.starters`, `ControllerState.recent`, `Starter` | root | 5 |
| `pickStarter(starter)` on the binding | `gridcue/react` | 5 |
| A `starters` prop on `<GridCueBar />`, default on | `gridcue/react` | 5 |
| `preview-panel.tsx` (edits, the Rows Shown), `clarification-prompt.tsx` (every question), new `view-parts.tsx` and `starters.tsx`, `command-bar.tsx` | Component Registry | 1 to 5 |

- **Already there when this work starts** (order plan), and so not in the table: `controller.proposeView`, `proposeView` on the binding and `INPUT_INVALID_VIEW` (routing PR 1); `previewLabels` and `statusLabel` (routing PR 2); `text` and `setText` on the binding (routing PR 3).
- **Two names changed in review.** `removeViewPart`, not `removePart`: in this API a "part" is already a part of the request (`clarifications[].part`). `pickStarter`, not `useStarter`: a function named `use…` reads as a React hook, and the hook lint rule would refuse a call to it from a click handler.
- **The resolution protocol does not change.** Nothing new is sent to a provider; a test pins the payload. An edit is recorded with the existing `source: "user"` evidence.
- **The Grid Adapter interface does not change.** The Rows Shown come from the Host.
- `gridcue/server` and `gridcue/mock` change only where a type they re-export gains a field.

## 7. ADRs

The order plan reserves 0036 to 0040 for these five. Each is written with the planning record.

**ADR 0036, "A User's edit to a Preview is a new plan"** (`docs/adr/0036-a-users-edit-to-a-preview-is-a-new-plan.md`). The User can drop a Preview line, or change a filter's value, without a provider call. The edited operations make a new plan: new ID, the same base Revision, an evidence entry with source `user` for each edit. It is validated and previewed again like any plan, and is not checked against the request's words, because the User changed it after reading it. This limits ADRs 0019 and 0022 to the plan a request produced, and the ADR says so. Checks that are about the plan and the view, not the words, still run: validation, and the count rule of ADR 0027. Lines that only make sense together drop together, by fixed rules, and a typed value must be read whole or it is refused. A full editor was rejected: it would duplicate the Host's own controls.

**ADR 0037, "The Host counts rows, and zero rows is information"** (`docs/adr/0037-the-host-counts-rows-and-zero-rows-is-information.md`). GridCue shows how many rows a ready plan leaves only when the Host passes `countRows`. The Grid Adapter does not count: a paged or server grid can't count its own rows, and a wrong number is worse than none. Zero rows is said in words and changes nothing else, because in a Mock Provider run over the evals 37 correct plans gave zero rows and the one wrong view seen kept every row. The number is never sent to a provider and never put in an audit event.

**ADR 0038, "Every open question shows, and each can be answered in words"** (`docs/adr/0038-every-open-question-shows-and-each-can-be-answered-in-words.md`). A plan can carry several Clarifications, and the bars now show them all, each with its part, instead of the first. A question with choices also takes typed text, which must name exactly one choice or the question stays; it is never read as a request. A question with no choices takes a new wording of its part, which replaces that part in the User's own text and sends the whole request through the provider again. This supersedes "ask one focused question" in the product definition. The evidence was that 82% of the questions in a Mock Provider run over the evals have no choices, and that a real Host application, by the owner's report, showed a question only when it had them.

**ADR 0039, "The current view reads as parts, and each part can be removed through a Preview"** (`docs/adr/0039-the-current-view-reads-as-parts.md`). It amends ADR 0021. The bar shows the view as parts, and the × on a part proposes the view without it through `proposeView`. Nothing applies without a Preview. On a view with a count, removing the sort or a filter part asks the count question first (order plan D43). When the four bets add the View Sentence, it is built from the same parts, so the bar keeps one line that is both read and edited. The alternative, removal that applies at once with Undo as the safety net, was rejected because it breaks the third rule in `AGENTS.md`. On 2026-11-13 the owner approved this change to the four bets' design (order plan D2 and D42).

**ADR 0040, "Recent requests are off unless the Host turns them on"** (`docs/adr/0040-recent-requests-are-off-unless-the-host-turns-them-on.md`). The bar can offer this session's applied requests as starters, and only when the Host sets `recent: true` or passes a store. Turned on without a store, they live in the Controller's memory and are gone when it is. GridCue never writes them to browser storage, which matters on shared desks. This follows the rule that raw Utterances are never recorded without explicit Host configuration (order plan D45).

## 8. Terms to add to `CONTEXT.md`

**Rows Shown**:
How many rows a ready View Plan would leave, and how many there are in all, as the Host counts them. Shown with the Preview; never sent to an Intent Provider.
_Avoid_: Row count, match count, hits, results

The operation set adds **Count** to the glossary for "top 10". Two terms one word apart, for two different things, would be mixed up, so this one is **Rows Shown** (order plan D5). `countRows` and `rowCount` stay as the names in code.

**View Part**:
One piece of the current View State as the bar shows it, such as one filter condition, the sort, the grouping, or the hidden columns. Removing one proposes the view without it, through a Preview.
_Avoid_: Chip, tag, pill, facet

**Starter**:
A request the bar offers at an empty input: one of the Host's examples, a recent request, or a change built from the View Schema.
_Avoid_: Suggestion, completion

**Clarification**, rewritten:
A question GridCue asks when a request cannot be resolved without something only the User can give. A View Plan can carry several, each about one Clause, answered with a choice or with a new wording of that Clause.
_Avoid_: Follow-up, disambiguation prompt

A few questions are about the whole request and have no Clause to word again (5.3). The glossary entry gives the usual case.

## 9. UI design pass

Applied with `emil-design-eng`, `better-ui`, and `principle-experience-first`. Both UIs get the same behaviour from the hooks. The values below are for the built-in bar (`styles.css`); the Registry column gives the matching Tailwind and shadcn/ui pieces. The whole bar is prototyped once, in a throwaway HTML page, light and dark: the states below, routing and saved views' states (their section 9), and the four bets' future lines (the View Sentence, the underlines and reading line, Tab completion). Routing's PR 2 comes first and builds the page (order plan). This work's task 0.2 checks that it holds every row below and adds what is missing, and the owner looks at it before any component code. The heading, button and status labels come from routing's `previewLabels` and `statusLabel`.

`principle-experience-first` cut three things from the first sketch: a pencil button on each line (the value itself is the control), a "Counting rows…" text on every Preview (only after 400 ms), and a separate "Show all choices" toggle (typing narrows instead).

The bar, top to bottom: the current view; the input; one hint row holding starters or the status; the Preview or the questions; Undo.

| Before | After (built-in) | Registry | Why |
| --- | --- | --- | --- |
| The bar starts with the input's label | A first line: "Current view" (`font-weight: 600`, `0.875rem`), then the parts in a row (`display: flex; flex-wrap: wrap; gap: 4px`) | `text-sm font-medium`, then `flex flex-wrap gap-1` | The same line the four bets give the View Sentence. One line, not two |
| — | A part: `min-height: 24px; padding-inline: 8px 2px; border-radius: 999px; background: var(--gridcue-part); font-size: 0.8125rem; display: inline-flex; align-items: center; gap: 2px`. A part with no ×: `padding-inline: 8px` | `Badge variant="secondary" className="h-6 gap-0.5 rounded-full ps-2 pe-0.5 text-xs font-normal"` | Filled, because a part is state, not an action |
| — | New token `--gridcue-part`: light `oklch(0 0 0 / 0.05)`, dark `oklch(1 0 0 / 0.08)` | `bg-secondary` | `--gridcue-hover` (0.04) is too faint to read as a surface |
| — | The ×: a button `inline-size: 20px; block-size: 20px; border-radius: 999px`, its hit area `24px` by a `::before` at `inset: -2px`; a 12px icon at `stroke-width: 1.5`; `color: var(--gridcue-muted)`; hover `background: var(--gridcue-hover)`; `aria-label="Remove Registration type is Taxable"` | `Button variant="ghost" size="icon" className="size-5 rounded-full"`, lucide `X` `size-3` `strokeWidth={1.5}` | Concentric: a round × in a round part. A 24px target. The stroke matches 400-weight text |
| — | Parts change with no transition | The same | They change after Ctrl+Enter and header clicks, many times a day |
| Starters exist only in the Site demo | A hint row under the input, `min-height: 1.5rem`, holding either the starters or the status. Starters: "Try" in `var(--gridcue-muted)` `0.8125rem`, then buttons `min-height: 24px; padding-inline: 8px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--gridcue-border); background: transparent; font-size: 0.8125rem; color: var(--gridcue-muted)`, hover `color: var(--gridcue-fg)`, press `scale: 0.96` | `Button variant="outline" size="sm" className="h-6 rounded-full px-2 text-xs"` with `PRESS` | Outlined, because a starter is an action. One row for starters and status keeps the bar's height steady |
| — | A recent starter leads with a 12px clock icon, `stroke-width: 1.5`, and has `aria-label="Recent: trusts"` | lucide `History` `size-3` | The icon is not the only cue: the label says so |
| — | Starters appear on focus with no transition, inside `role="group" aria-label="Try one of these"`. The status element stays mounted, so its live region still announces | The same | Focus is frequent. A live region added late is not announced |
| Preview lines are plain text | Each line is a row: `display: flex; align-items: baseline; gap: 4px`, with the × at `margin-inline-start: auto` | `flex items-baseline gap-1`, × `ms-auto` | The ×s form one column, easy to scan |
| — | The line's ×: the same button as on a part; `aria-label="Remove: Sort by Unrealized gain, descending, and Show only the first 10 rows"` when lines are tied | The same | A screen reader hears what goes before pressing |
| — | Hovering or focusing a × strikes through every line it removes: `text-decoration: line-through; text-decoration-color: var(--gridcue-muted)`, with no transition | `line-through decoration-muted-foreground` | The tie is visible before the click, not only after. Not colour alone |
| — | A value that can change is a button styled as text: `font: inherit; color: inherit; padding: 0; background: none; border: 0; text-decoration: underline dotted; text-decoration-thickness: 1px; text-underline-offset: 3px`; `aria-label="Change Market value, now $1,000,000"` | `underline decoration-dotted underline-offset-[3px]` | The value is the control. Dotted and muted, so it never reads like the four bets' solid accent underline in the input |
| — | Pressing it puts a field in its place: `inline-size: 12ch; font: inherit; padding: 0 4px; border: 1px solid var(--gridcue-border); border-radius: 4px`, or a native `<select>` of declared values. Enter commits, Escape restores, leaving the field restores | `Input className="h-6 w-[12ch] px-1"`; a native `<select>` with the Input's classes | A native select is the most accessible picker and needs no dependency |
| — | A refused value: a line under the row, `0.8125rem`, body colour: "GridCue couldn't read “2m+” as an amount." The field gets `aria-invalid="true"` and `aria-describedby` to it | `text-xs` | Words, not a red border alone |
| — | After an edit, the new Preview replaces the old one with no transition; focus returns to the × or value that was used, or to Apply if that line is gone | The same | Keyboard flow continues where it was |
| — | A Rows Shown line after the list: `font-size: 0.875rem; font-variant-numeric: tabular-nums; margin: 4px 0 0`, body colour. "No rows match." is `font-weight: 600` | `text-sm tabular-nums`, `font-semibold` for zero | Read before Apply. Zero stands out by weight and words, not colour |
| — | While counting, the line's space is held (`min-height: 1.25em`), empty. After 400 ms, "Counting rows…" in `var(--gridcue-muted)`. The line has `aria-live="polite"` | The same | No flash on a fast count, no jump when it lands |
| Only the first question shows, and only when it has choices. Its prompt is only in the status line | A panel: "GridCue needs your input" (`0.875rem`, 600), then an ordered list, `gap: 12px`. Each question: its prompt (`0.875rem`, body colour) with an `id`, then its controls | `Card` with `CardTitle className="text-sm"`, `ol className="grid gap-3"` | Every question is reachable. The prompt sits next to what answers it |
| — | Choices: buttons as today. Under them, a field `placeholder="Or type a choice"`, labelled by the prompt. With more than 8 choices, the field comes first and the buttons show only those whose names contain the typed text, at most 8, with "8 of 200 shown" in `0.8125rem` muted | `Input className="h-8"`, `text-xs text-muted-foreground` | 200 buttons is a wall. Narrowing is not answering: Enter still needs exactly one match |
| — | A question with no choices: a row with a field holding the part as typed, full width, and a "Preview" button. `aria-labelledby` the prompt | `Input` and `Button variant="outline" size="sm"` | The User fixes the part where the question points, not the whole request |
| The status line shows the first prompt | The status line shows "Needs your input" and no message while the panel is shown | The same | The prompt is not said twice |
| — | Focus stays in the input when questions appear after Enter. After a choice is clicked, focus moves to the next open question's first control, or to Apply when the plan is ready | The same | Keyboard-initiated changes don't steal focus. A click moves on |
| Escape cancels only from the input | Escape anywhere in the bar cancels. Inside a value field, Escape first restores the value | The same | One way out from every new control |
| Light `#2563eb`, dark `#60a5fa` accent; radius 6px; bar radius `calc(6px + 12px)` | Unchanged | Unchanged | One new token only |

**Checked in a real browser before each UI PR merges,** light and dark, at 1280px and at 375px with a 16px gutter, in the Vite example (registry), the Next.js example (built-in) and the Site demo: every state above, keyboard only, and with a screen reader (VoiceOver) for the panel, the Rows Shown line and the ×s. Motion is checked at 10% speed; the only animation in this work is the existing press scale.

## 10. Evals and evidence

Every set is synthetic. Every held-out set is written and labelled before the code it tests, by a labeller who has not seen that code and works from this spec's section alone. A held-out wrong view sends the work back as a class, not a sentence; the set then joins the repo as a regression set, and the next round gets a fresh held-out set. At least 10 cases in each held-out set use the ledger fixture (named filters PR 2), which has number, date and date-and-time columns. Where a held-out wrong view comes from a word nothing reads, in a part this work doesn't cover, the bar stays at 0: the class is narrowed to a question, with a fresh held-out set, and no reading is added (order plan D4).

A **wrong view** here means: the view after Apply is not the one the case's label says, or a typed text was taken as a different choice or value than labelled.

| Mechanism | Dev set | Held-out set | Bar | Reported, no bar |
| --- | --- | --- | --- | --- |
| Edits (5.1) | `evals/cases-edit.jsonl`: 40 cases, each a starting view, a plan's operations, one or more edits, and the expected view or "refused". Starts from operations, so no provider is involved | 40, from section 5.1 alone | 0 wrong views. Every tied pair drops together | The share refused |
| Typed values (5.1) | 60 typed values across amount, percent, number, date and text columns, with the value expected or "refused" | 60, including suffixes ("2m dollars"), comparisons ("over 2m"), ranges, unreadable numbers ("1.000.000") and negatives | 0 values read as a different value. A value is read exactly as labelled or refused | The share refused |
| Rows Shown (5.2) | 1,500 random reachable views on 500 rows, fixed seed: `countRows` through `applyView` against the rows the Rows Adapter's grid shows | The same on 1,500 more views with a second seed. For the TanStack counter: the same views against TanStack's own filtered row model, and one case for each condition in 5.2 that must return nothing | Exact on every view. `undefined` in every listed condition | Cost at 100,000 rows: median and worst over 21 runs (today 77 ms and 88 ms with `applyView`). The Preview's own time is unchanged |
| Part spans (4.1) | Every labelled Utterance in `evals/` when PR 3 is built (813 cases in seven files today): each span's text, cleaned, equals its Clause's text without a borrowed verb | 40 Utterances written for spans: borrowed verbs, dictated "comma", smart quotes, double spaces, mixed case, kept parts, mid-line splits | 100% exact spans on both. The provider payload equals today's for every labelled Utterance | — |
| Typed choices (5.3) | 40: a question, a typed text, and the choice expected or "stays" | 40, including aliases, partial names, two choices sharing a word, and text that is itself a request | 0 texts taken as a different choice | The share answered |
| A new wording of a part (5.3) | 40: a request, its question, a new wording, the spliced request expected exactly, and the plan expected with the Mock Provider | 40, including empty wordings, first and last parts, carried answers, and a wording that splits into two parts | Spliced text exact on all. 0 wrong views. A carried answer only where the rule allows | Exact, safe misses |
| Question to part (5.3) | Every question the compiler can ask, from a test that reaches each `clarifications.push` | — | Every question but `plan.empty` names its part | — |
| View Parts (5.4) | 30 views with their parts' labels and `without` views labelled | 30 more, including "or" filters, nested groups, a view with a count, reordered columns, and pinned columns | For every part, `proposeView(part.without)` applied gives exactly `without`, or is unsupported. Never a different view | The share of parts with no × |
| `proposeView` (4.3) | Routing's PR 1 owns the property test (1,500 random reachable views from random starting views, as four bets section 8 states). Here: every View Part's `without`, on those views | The same, on a seed the lead draws after the build | The applied view equals the proposed one, or the result is unsupported | — |
| Removal on a view with a count (5.4) | 20 views with a count: each part removed, labelled with the question or the view expected | 20 more | No removal changes which rows a count keeps without a question or a Preview line that says so | — |
| Edits and the count rule (5.1) | 10 of the 40 edit cases start from a view with a count | 10 of the held-out 40 | No edited plan trips the operation set's count rule | — |
| Schema starters (5.5) | Each starter on the wealth schema and on the ledger, from the default view and from 20 random views | The same from 20 more random views, on a seed the lead draws after the build | Each applied starter's view is what its label says | — |
| Recent requests (5.5) | Tests with storage spied on, and with no `recent` option | — | With no `recent` option, no Utterance is kept and `state.recent` is empty. Nothing written to `localStorage`, `sessionStorage` or IndexedDB. No Utterance in an audit event unless `includeText` | — |

- The gate (`pnpm check`) runs every new set with the Mock Provider. A wrong view in any of them fails it.
- **The real Host application.** After PR 3, the lead reruns its 209 requests in a throwaway clone, as PR 1 of the four bets did. Bar: no wrong view, and no change in the plans, since spans send nothing new. The lead also checks that its questions with no choices now show.
- **Live runs.** No agent calls Jev. Before PR 3 merges, one `--live` run on the owner's command confirms the payload is unchanged and that a new wording gives no wrong view on its held-out set.

## 11. Surfaces

| Surface | Applies | What changes |
| --- | --- | --- |
| Entry points | Yes | Root: everything in section 6. `gridcue/react`: the binding, `<GridCueBar />`, `styles.css`. `gridcue/tanstack-table`: `tanstackRowCounter`. `gridcue/server` and `gridcue/mock`: types only |
| Both UIs | Yes | Every change in `<GridCueBar />` and in the registry's `command-bar.tsx`, `preview-panel.tsx`, `clarification-prompt.tsx`, and new `view-parts.tsx` and `starters.tsx`, from the same hooks. The shared component suite (`packages/gridcue/test/command-bar-suite.tsx`) gains every behaviour, so both pass the same tests |
| Frameworks and tables | Yes | The Next.js example (Rows Adapter, built-in bar) passes `countRows` with `applyView`. The Vite example (TanStack Table, registry bar) passes `tanstackRowCounter`. Both pass `examples`. `proposeView` and the parts are tested on both Grid Adapters. Nothing here is server code |
| The Site | Yes | The demo uses the package's starters and Rows Shown. Docs: `api/create-grid-cue` (`edit`, `answer`, `proposeView`, `countRows`, `examples`, `recent`, the new state fields), `api/react`, `api/adapters` (`tanstackRowCounter`), the four component pages and two new ones (`view-parts`, `starters`), `concepts/pipeline`, `concepts/requests` (questions), `concepts/views` (parts), `safety` (the Rows Shown stay local, and recent requests are off unless the Host turns them on), `guides/vite-tanstack` and `guides/next-rows-adapter` (`countRows`) |
| Agent skill | Yes | `skills/gridcue/SKILL.md` step 4 and `references/setup.md`: `countRows` for each adapter and `examples` as setup steps. `pnpm check:skills` |
| Failure paths | Yes | Cancel and Escape drop edits, open questions, and a part's removal. A refused value leaves the Preview as it was. A `countRows` that fails shows no Rows Shown line. A new wording that fails at the provider keeps the old request in the input. A stale Revision rejects an edited plan and a removal. Undo works for each |

## 12. Testing

- Unit tests for `edit`: each row of the table in 5.1, both tie rules in both directions, the last-line rule, each value kind, and a stale Revision.
- Unit tests for the value reader: every case in the dev set.
- Controller tests for the Rows Shown: a number, a promise, `undefined`, a throw, a rejection, a late answer for a replaced plan, the total cached per Revision, and that nothing reaches a provider or an audit event.
- Unit tests for `tanstackRowCounter`: each condition that returns nothing, against a real TanStack v9 table.
- Unit tests for spans: borrowed verbs, collapsed spaces, dictated "comma", smart quotes, letter case, kept parts, mid-line splits. The payload test over every labelled Utterance.
- Controller tests for typed answers and new wordings: each row of the table in 5.3, the carry-over rule, an empty wording, and a provider failure.
- Unit tests for `describeViewParts`: each kind of part, each `without`, and each case with no ×. Property tests for `proposeView` and for removal, with fixed seeds.
- Controller tests for starters and recent requests: the order, the limit of five, what is not recorded, no `recent` option (nothing kept), `recent: true`, `recent: false`, and the Host's store.
- Component tests in the shared suite, run on both UIs: every row of the design pass that has behaviour, keyboard only, with labels and `aria-*` checked.
- The browser bundle check still passes: nothing here imports server code.
- Every UI change is checked in a real browser, light and dark, in the Vite example, the Next.js example, and the Site.

## 13. Acceptance criteria

1. `pnpm lint` and `pnpm check` pass with no credentials after each PR.
2. Every bar in section 10 is met and reported in its PR, with the numbers, misses included.
3. Each PR's description says which surfaces in section 11 it touched.
4. The five ADRs are in, `CONTEXT.md` has the terms in section 8, `docs/internals/product.md` matches 5.3, and the docs pages in section 11 are current.
5. UI PRs carry before and after screenshots, light and dark, and a short video for the edit and the questions.
6. The owner has seen the prototype before PR 1's component code.

## 14. Risks, and what would change the design

- **An edit the User didn't mean.** The User reads the new Preview before Apply, and Undo works. Would change Q1 if: a held-out edit gives a wrong view that a tie rule should have caught, which would add a rule, or if Users in the representative Host never change values.
- **A typed value read as a different value.** "Read whole" refuses anything with leftover words. Would change Q1 if: one held-out value is misread.
- **A new wording costs a provider call and can read differently.** It is a new request, checked and previewed like any other. Would change Q2 if: a held-out new wording gives a wrong view, or Users in the representative Host answer most questions by choice anyway.
- **A Host's number can be wrong.** GridCue can't check what a server counts. The docs say `countRows` must use the same filters the grid applies, and the TanStack counter returns nothing whenever it can't be sure. Would change Q3 if: most Hosts use one adapter whose rows GridCue can count exactly.
- **Users may apply a zero-row Preview and undo it.** Would change Q4 if: in the representative Host most zero-row Previews that are applied are undone.
- **A removal's Preview reads as two lines.** Removing one condition is a clear and a re-add, as "clear the market value filter" is today. The lines are exact, if long. Would change Q5 if: the prototype review finds it confusing; the fix would be a Preview line, not a new operation.
- **The current-view line and the View Sentence could drift.** Both come from one list of parts. Would change Q5 if: the four bets' round trip shows the sentence can't be split into parts that each read alone.
- **Starters at an empty input may be missed.** Would change Q6 if: Users in the representative Host reach for them mid-request.
- **`proposeView` was planned by two opportunities.** It is built once, by routing's PR 1, to the approved design (4.3).
- **An edit or a removal could get around the count rule.** Neither goes through the compiler, where the operation set asks its count question. Sections 5.1 and 5.4 close both, and section 10 has a bar for each.
- **The bar grows.** Five additions to one bar. The prototype comes first, with the four bets' lines in it, so the owner sees the whole bar before any of it is built.

## 15. How this meets the four bets

| This work | Four bets | When the bets are built |
| --- | --- | --- |
| Each part's span (4.1 here) | Positions in the User's own text (their 4.1, PR 2) | Their PR 2 adds the character map under `Clause.source`. Spans don't change |
| Words in one module (4.2 here) | One vocabulary (their 4.2, PR 3) | Their PR 3 adds the reading half: `normalize` reads every word GridCue prints |
| `proposeView` (4.3 here, built by routing's PR 1) | `proposeView` (their 5.3, PR 3) | Already built; their PR 3 adds `describeView`, the sentence and `ControllerState.view` only |
| The current-view line of View Parts | The View Sentence on the bar's first line (their 5.3 and 7) | `describeView` is built on `describeViewParts`. The line shows the sentence, and each part's words in it keep their ×. One line, not two. So their `viewSentence` prop and `view-sentence.tsx` give way to this work's `currentView` prop and `view-parts.tsx`: one prop and one registry file for the line. The round trip may still change a part's words. Their design row "Preview panel, clarification buttons, Undo: unchanged" no longer holds; their design pass starts from this bar |
| Starters in the hint row at an empty input | The reading line in the same row while typing (their 7) | The row holds starters when the input is empty, the reading line while the text differs from the last Preview, and the status otherwise |
| Schema starters as View States | "Every example request the Site suggests must resolve locally" (their 5.4) | Already met for schema starters. Text examples go through the Local Resolver like typed text |
| No completion menu | Tab completes one name (their 5.5) | Unchanged: starters never show while typing |
| `edit`, typed answers, the Rows Shown | `read`, `resolvedBy`, an optional `provider` | No overlap. A new wording goes through the Local Resolver first once local first is on |
| The closed grammar (their 5.4) | — | A new wording of a part is a request like any other, so the Local Resolver reads it first when on. Nothing here adds words GridCue reads |
