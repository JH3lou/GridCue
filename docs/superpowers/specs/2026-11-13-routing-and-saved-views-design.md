# Grid routing and saved views: design spec

Status: approved by the owner on 2026-11-13. Answers in docs/planning/routing-and-saved-views-grill.md.

**Date:** 2026-11-13
**Scope:** grill answers Q1 to Q8 in `docs/planning/routing-and-saved-views-grill.md`, as the owner approved them on 2026-11-13: decisions D29 to D36, and D1 to D5 where they reach this work, in `docs/superpowers/plans/2026-11-13-five-opportunities-order.md`. Saved-view names are matched exactly only. That is a trim the lead recommended, and the lead reads the owner's approval as covering it (grill log, owner's answers).
**Plan:** `docs/superpowers/plans/2026-11-13-routing-and-saved-views.md`
**Build order:** opportunity 4 of the five the owner put before the four bets on 2026-11-13. It is designed on today's code, where every request goes through an Intent Provider. Section 15 says where it meets the four bets.

This is the current best design. Every mechanism below has an evidence bar in section 10, fixed before any code. A mechanism that misses its bar is reworked or removed; the bar does not move.

## 1. Purpose

GridCue today works on one grid, for one request at a time. A good view is lost when the User leaves, and a request about another grid is refused, asked about, or read as a change to this one. This work takes GridCue past one grid and one moment:

1. **Saved views.** "Save this as my exceptions view" keeps the view. "Open my exceptions view" brings it back through a Preview. The Host stores every saved view; GridCue never stores one.
2. **Grid routing.** On a screen with several grids, a request about another grid's rows offers that grid: "This is about clients. Open the Clients grid?" The User chooses, and the Host navigates. The request goes along and is previewed on the new grid.

Success means:

- 0 wrong views and 0 wrong routes on every labelled set, old and new;
- each mechanism meets its bar in section 10 on cases labelled before its code exists;
- a Host that sets neither new option sees no change at all.

## 2. Decisions this spec builds on

| Decision | Source |
| --- | --- |
| One spec and one plan. `proposeView` first, then saved views built on it, then grid routing after its ADR. They are steps 21 to 23 of the order plan | Grill Q1, order plan D1 |
| `proposeView` is built once, here, exactly as the four bets spec 5.3 and ADR 0021 describe it | Grill Q2, order plan D29 |
| Save and open by request, through a Host `savedViews` option. Rename, delete and share stay refused | Grill Q3, order plan D30 |
| A save is previewed and happens on Apply. A name in use is never replaced. Undo removes the new saved view | Grill Q4, order plan D31 |
| A saved view is named only in an explicit frame, with an exact name, ignoring letter case. Near names are not matched. "Show" needs "view" after the name. A name that also reads as a change here asks. The Host's list of names never goes to a provider | Grill Q5 as changed by the facts check, order plan D32. Exact names only is the lead's trim (grill log, owner's answers) |
| Offer, never jump. The Host's `onRoute` navigates. The request goes along when it asks for more than the move. A route has no undo, and one chosen in a question has no Preview | Grill Q6, order plan D34 |
| `audit.onEvent` widens to a union of event types | Order plan D33 |
| A Host callback that throws while a request is read is an `INPUT_` error; one that throws at Apply is an `ADAPTER_` error | Order plan D5 |
| A wrong view found on a held-out set is narrowed to a question, with a fresh held-out set. No reading is added | Order plan D4 |
| Edits to approved documents are made by the PR that lands each piece | Order plan D2 |
| Routing is decided in code from a `grids` option. No protocol change, no router object | Grill Q7, made precise by the facts check; order plan D35 |
| Once a grid is declared for a noun, a request whose rows are that noun never filters this grid without the User's choice | Grill Q8, order plan D36 |
| Additive, optional fields. The protocol stays 0.1 | ADR 0010 precedent |

## 3. Scope

### In

- **PR 1, `proposeView`** (5.1): bringing a View State back through a Preview, and `INPUT_INVALID_VIEW`.
- **PR 2, saved views** (5.2): the `savedViews` option, the save and open frames, the pending save, undo, audit, both UIs, both examples, the Site demo, and a "Saved views" guide.
- **PR 3, grid routing** (5.3): the `grids` option, the move frame, the rows-noun rule, the offer, the passed request, `initialRequest` in both UIs, both examples, and a "Several grids" guide.
- ADR 0034 and ADR 0035 (section 7), and the terms in section 8.

### Out

- **Renaming, deleting, sharing or replacing a saved view by request.** They change something the User already has. They stay refused in the bar, and the Host's own UI does them.
- **Saved views shared between Users, or kept across grids.** The Host's `list` is the current User's list for this grid.
- **Opening a record or any screen that is not a declared grid.** "Open the client record" and "go to the reports page" stay as today.
- **Navigating without the User's choice,** even when the grid is certain.
- **A router object above several Controllers.**
- **Sending the Host's list of saved views, or the grid list, to an Intent Provider.** The resolution protocol does not change.
- **Changing what another record's noun means on a Host that declares no grids.** Today's labels stand (grill Q8 (c) is a reading question for its own grill).
- **Opening a saved view and making another change in one request** ("open my exceptions view and sort by gain"). GridCue asks the User to do one, then the other.
- **Near names.** A name one letter off, or in another word order, is not matched and is never offered as a choice. Near names can come later, on their own held-out set.
- **The View Sentence in the save and open Previews.** It arrives with `describeView` in four bets PR 3 (section 15).
- **Grid routing in the Site demo.** The demo has one grid. The Next.js and Vite examples show routing.

## 4. Shared pieces

### 4.1 Recognised in the Controller, before any provider

`propose` gains four steps, in code only. They run after today's length check, clause count check and restricted-column screen, and before any provider is called:

1. **Save frame** (only with `savedViews`).
2. **Open frame** (only with `savedViews`).
3. **Move frame** (only with `grids`).
4. **Another grid's rows** (only with `grids`).

A request that none of them claims runs exactly as today. A request that names a restricted column is still refused before any of them, as today.

None of the four steps calls a provider or sends anything. Where a step asks a question whose choices include today's reading ("Keep it on this grid", "Change this view instead"), today's path also runs, with the Utterance only, and its result is held for that choice. `answer` stays synchronous.

So one thing is sent in that case, and it is what is sent today: the request as the User typed it. It may hold a saved view's name or a grid's name, because the User wrote one. The Host's list of saved views, the list of grids, and whether a name matched are never sent.

The Local Resolver (four bets PR 4) will run after these steps, so its closed grammar never sees these forms.

Named filters is built before this work (order plan). Its Local Values are read by the longest-name rule before step 4, so the words of a whole Local Value ("the Alder household") are never a grid's name.

Questions these steps ask are about the whole request. Their IDs name no part, so the command bar's questions panel (its 5.3) shows them without a part field, as it shows `plan.empty`.

### 4.2 The pending step

A save and a grid are not View Plans. The Controller's state gains `pending`, which says what Apply will do:

```ts
type PendingStep =
  | { kind: "save"; name: string }
  | { kind: "saved_view"; savedViewId: string; name: string } // a plan that opens a saved view
  | { kind: "grid"; gridId: string; label: string; request?: string };
```

- `pending` is `null` for every plan made as today, so existing Hosts see the same state.
- With `kind: "save"` or `"grid"`, the status is `ready`, `plan` is `null`, and `preview` holds lines core renders. Apply saves or calls `onRoute`. Cancel and Escape clear it.
- With `kind: "saved_view"`, `plan` is an ordinary ready plan. Apply applies it.
- After a save or an opened saved view is applied, `pending` stays set in the `applied` state, so the UIs can say "Saved". After a route, the Controller returns to idle (5.3).
- A pending save or grid is not a plan. The command bar, built after this work, keeps `lineEdits` and `rowCount` at `null` for it, and does not keep it as a recent request.

### 4.3 Audit events

Every save and every route emits a structured event, like every applied plan:

- `{ type: "gridcue.saved_view", outcome: "saved" | "undone" | "cancelled" | "failed", savedViewId?, errorCode? }`
- `{ type: "gridcue.grid", outcome: "opened" | "cancelled" | "failed", gridId, from, errorCode? }`

Neither carries the saved view's name or the request unless the Host sets `includeText`. Opening a saved view is a plan, and emits `gridcue.plan` as today. `audit.onEvent`'s parameter widens to `GridCueAuditEvent`, the union of the three.

## 5. Units

### 5.1 `proposeView` (PR 1)

Exactly as the four bets spec 5.3 and ADR 0021 describe it:

```ts
controller.proposeView(savedState); // from the Host's storage, or a link
```

- The state is untrusted. It is parsed, and anything else ends in `INPUT_INVALID_VIEW`: "That saved view can't be read."
- The plan is the set of operations that turns the current view into the saved one, with `source.channel: "api"`. It is validated like any plan: a column that no longer exists, a restricted column, or a change the grid can't make fails closed.
- If the operations can't reproduce the saved view exactly, the result is unsupported: "That saved view holds a setting this grid can't apply." Nothing is applied in part. The "This grid can't …" question (order plan, D3) is for a request, and `proposeView` does not use it.
- If the grid already shows it: "The grid already shows this view." The Controller returns to idle with that message and no plan. *This settles a point the four bets spec left open.*
- From there it is an ordinary ready plan: Preview, apply, undo, audit, and a stale Revision is rejected.

`proposeView` is synchronous and returns the plan, like `answer`. It is on the `useGridCue` binding too. When a typed request opens a saved view (5.2), the same code runs, and the plan keeps the request's channel and text.

It is built once, here (order plan). The command bar's current-view line and starters, and the four bets' PR 3, use it and don't build it again. The operation set's count question (its 5.1) does not apply to a plan from `proposeView`: the saved view states its count in full.

### 5.2 Saved views (PR 2)

**The Host's option.** GridCue reads and writes saved views only through it:

```ts
createGridCue({
  adapter,
  provider,
  savedViews: {
    list: () => [{ id: "sv_1", name: "Exceptions" }, { id: "sv_2", name: "Q3 review" }], // this User, this grid
    load: (id) => store.get(id),                       // returns the stored View State; may be async
    save: async ({ name, state }) => ({ id: await store.add(name, state) }),
    remove: (id) => store.delete(id),
  },
});
```

- `list` is synchronous, so `controller.read` (four bets PR 2) can mark a saved name as the User types. A Host with remote storage keeps its list in memory.
- Each entry is checked at use. An entry whose `id` or `name` is not a non-empty string is skipped, never matched.
- What `load` returns is untrusted and goes through `proposeView`.

**The save frame.** A request is a save only when its whole text is:

> "save" [this | this view | the view | the current view | it] "as" [my | the | a] *name* ["view"]

- The name is taken from the text as typed, so its letter case is kept. A quoted name is taken exactly, quotes removed, and "view" inside the quotes stays.
- A name is 1 to 60 characters, with at least one letter or digit and no line breaks.
- A save calls no provider at all, so the name goes nowhere but the Host's `save`.

**The open frame.** A request opens a saved view only when its whole text is one of:

> ("open" | "load" | "switch to" | "go back to") [my | the] *name* ["view"]
> "show" (my | the) *name* "view"

The typed name must be exactly a name on the Host's list, ignoring letter case, extra spaces and the kind of quote mark. Then:

| What matched | Result |
| --- | --- |
| One name exactly, and nothing on this grid reads the same way | Ready: the plan from `proposeView`, with the message "From your saved view “Exceptions”." |
| One name exactly, and it is also a column, value, Value Group, Row Noun, House Term or Local Value here (the last two from named filters), or a declared grid's name | Asked, with two choices: "Open your saved view “Taxable”" and "Change this view instead" |
| Two saved views with the same name | Asked, no choices: "You have two saved views called “Exceptions”. Open one from your saved views." |
| No name on the list is exactly the typed one, after "show" | Today's reading, unchanged |
| No name on the list is exactly the typed one, after any other verb | Asked, no choices: "You have no saved view called “archive”." |

- **A near name is not matched.** A typed name that is one letter off a saved one, or has its words in another order, is a name that is not on the list. It is never opened and never offered as a choice.
- **"Show" needs "view" and an exact name,** because "show my taxable view" is a ready filter today. Without a matching saved view, it stays one.

**The save step.**

| State | Result |
| --- | --- |
| The name is free | Ready, `pending: { kind: "save" }`. Preview line: "Save the current view as “concentrated”" |
| The name is in use, ignoring case | Asked, no choices: "You already have a saved view called “Exceptions”. Save this one under another name." |
| No name ("save this view") | Asked, no choices: "Give the view a name, as in “save this as my exceptions view”." |
| Apply, and the view changed since the Preview | Rejected: "The view changed since this preview. Preview the request again." Nothing is saved |
| Apply | `save({ name, state })` with the grid's current View State. Message: "Saved as “concentrated”." Undo shows |
| `save` throws | Error `ADAPTER_SAVED_VIEW_FAILED`: "Couldn't save the view. Nothing was saved." |

**Undo of a save** calls `remove(id)` with the id `save` returned. It follows today's undo rule: it is usable while the grid shows the Revision it had when the save ran. Message: "Removed the saved view “concentrated”." If `remove` throws, the error is `ADAPTER_SAVED_VIEW_FAILED` and the undo history is cleared, as for a failed restore.

**Opening a saved view** calls `load(id)` while the request is read. If it throws, the error is `INPUT_SAVED_VIEW_FAILED`: "Couldn't open “Exceptions”. The view hasn't changed." `list` is also called while a request is read, by the save and open frames. If it throws, the error is `INPUT_SAVED_VIEW_FAILED` too: "Couldn't read your saved views. The view hasn't changed." `save` and `remove` run at Apply and at Undo, so their failures are `ADAPTER_` errors (order plan, D5). What `load` returns goes through `proposeView`.

**Requests, with a list of "Exceptions", "Q3 review" and "Taxable" (Mock Provider):**

| Request | Today | After |
| --- | --- | --- |
| "save this as my concentrated view" | Asked: "I'm not sure what to change for …" | Ready: Save the current view as “concentrated” |
| "save this as Exceptions" | Asked | Asked: a saved view called “Exceptions” already exists |
| "save this view" | Asked | Asked: give the view a name |
| "open my exceptions view", "load the Q3 review" | Asked | Ready: the operations that bring the saved view back |
| "show my exceptions view" | Asked: "What should … filter on?" | Ready: the operations that bring the saved view back |
| "open my exception view" | Asked | Asked: no saved view called “exception” |
| "open my archive view" | Asked | Asked: no saved view called “archive” |
| "show my taxable view" | Ready: Filter Registration type to Taxable | Asked: Open your saved view “Taxable” / Change this view instead |
| "show my retirement view" | Ready: Filter Registration type to any of IRA and Roth IRA | Unchanged |
| "open my exceptions view and sort by gain" | Asked | Asked: "Open the saved view on its own, then ask for the other change." |
| "delete my exceptions view", "rename this view to exceptions" | Unsupported, data editing | Unchanged |
| "reset my accounts view" | Ready: Reset the view | Unchanged |
| Any request, on a Host with no `savedViews` | — | Unchanged |

### 5.3 Grid routing (PR 3)

**The Host's option.** Each Controller takes the same closed list and says which grid it is:

```ts
createGridCue({
  adapter,
  provider,
  grids: {
    current: "accounts",
    list: [
      { id: "clients", label: "Clients", rowNoun: "client" },
      { id: "households", label: "Households", rowNoun: "household" },
      { id: "accounts", label: "Accounts", rowNoun: "account" },
      { id: "positions", label: "Positions", rowNoun: "position", aliases: ["holdings"] },
    ],
    onRoute: ({ gridId, request, from }) => openGrid(gridId, request), // the Host navigates
  },
});
```

`createGridCue` throws `INPUT_CONFIG` when: two grids share an id or a name (label, Row Noun, its plural, or an alias); `current` is not on the list; the current grid's `rowNoun` differs from the schema's; or the list holds more than 20 grids. A name is 1 to 40 characters.

**A grid's names** are its label, its Row Noun and that noun's plural, and its aliases. They are read by the same matcher as Mentions, longest name first.

**The move frame.** A request moves to a grid only when its first part starts:

> ("open" | "go to" | "go back to" | "take me to" | "switch to" | "navigate to" | "jump to" | "bring up" | "pull up") [the | my] *grid name* ["grid" | "list" | "screen" | "page" | "tab"]

- A singular Row Noun with a word before it names one record, not the grid: "open the Smith household" is not a move, and stays as today.
- "Open the accounts grid" on the Accounts grid returns to idle with "This is the Accounts grid."
- A name that is both a saved view and a grid asks, with both as choices.

**Another grid's rows.** A part's rows are grid G's when a plural name of G is the part's subject: it comes first, after at most a view verb ("show", "show me", "list", "find", "only", "just"), a determiner, values of this grid, a House Term or a Local Value of this grid (named filters), a size word, or a count. Without the last two, "large households" would be read by the House Term alone and filter this grid, which grill Q8 rules out. It is followed by the end of the part, an amount or comparison, or a word that starts a condition, sort or grouping ("with", "where", "that", "who", "at", "in", "by", "sorted", "grouped", "ordered").

**What happens next:**

| Case | Result |
| --- | --- |
| A move frame to G. The move words are explicit, so a column that claims the name does not matter | Offer: ready, `pending: { kind: "grid" }`. Message: "This is about households." Preview line: "Open the Households grid" |
| Rows that are G's, and no column here claims that name | Offer, as above. Message: "This is about clients." Preview lines: "Open the Clients grid", and "Then preview “clients over $5m” there" when a request goes along |
| Rows that are G's, and a column here claims that name, and today's result is a question with choices | The same question, with "Open the Households grid" added as the last choice |
| Rows that are G's, and a column here claims that name, otherwise | Asked: "Households have their own grid." Choices: "Keep it on this grid" and "Open the Households grid" |
| Parts whose rows are this grid's and another grid's, or two other grids' | Asked, no choices: "This asks about accounts and households. Ask about one grid at a time." |
| A move to anything that is not a declared grid | Unchanged |

- **"Claims"** means the name is a label, alias or `entity` of a column here that the provider may see. On the wealth fixture, Household's `entity` claims "households".
- **"Keep it on this grid"** gives today's result, held from 4.1. Choosing it is the User's own choice, so it is not a wrong view.
- **Choosing "Open the … grid"** in a question routes at once: the choice was the User's. An offer routes on Apply.
- **Where the operation set has added a third choice** to "largest households first" ("Rank households by total Market value"), the grid is the fourth and last.
- **The request that goes along** is the User's text with the move words removed: the verb, a determiner, the grid's name when it came right after the verb, and a grid word. If nothing remains but "show", "me", "all", determiners and joiners, no request goes. Without a move frame, the whole text goes, as typed.
- **`onRoute`** is called once, after the User's choice, with `{ gridId, request?, from }`. When it resolves, the Controller returns to idle with "Opened the Households grid." If it throws, the error is `ADAPTER_ROUTE_FAILED`: "Couldn't open the Households grid. This view hasn't changed."
- **There is no undo for a route.** Nothing on this grid changed. The Host's own back control returns the User.

**On the target grid,** the Host passes the request to the bar:

```tsx
<GridCueBar controller={householdsCue} initialRequest={request} />
```

The bar puts it in the input and proposes it once, on mount. For that, the input's text moves from each component into the hook, as `text` and `setText` on the binding; the command bar's PR 3 and the four bets' `read` reuse them. The target grid's Controller reads it as any typed request, with its own schema and its own Row Noun, and shows its own Preview. Only the User's words move between grids, never rows or a view.

**Requests on the Accounts grid, with the four grids above (Mock Provider):**

| Request | Today | After |
| --- | --- | --- |
| "go to households", "take me to the client grid" | Unsupported, navigation | Offer: Open the Households grid; Open the Clients grid. No request goes |
| "open the households grid", "switch to positions" | Asked | Offer, no request |
| "open the households grid and sort by value" | Asked | Offer: Open the Households grid, then preview “sort by value” there |
| "open the client record", "open the Smith household" | Asked | Unchanged |
| "clients over $5m" | Ready: Filter Market value above $5,000,000 | Offer: Open the Clients grid, then preview “clients over $5m” there |
| "show positions over $1m sorted by gain" | Ready: Filter Market value, then Sort by Unrealized gain | Offer: Open the Positions grid, with the request |
| "holdings over $1m" | Ready: Filter Market value above $1,000,000 | Offer: Open the Positions grid, with the request |
| "households over $5m", "households sorted by value" | Ready: Filter Market value above $5,000,000; Sort by Market value | Asked: Keep it on this grid / Open the Households grid |
| "largest households first" | Asked: Group by Household / Use the Household column | Asked: Group by Household / Use the Household column / Open the Households grid |
| "show households" | Asked: "What should … filter on?" | Asked: Keep it on this grid / Open the Households grid |
| "accounts over $1m and households over $5m" | Asked | Asked: one grid at a time |
| "open the accounts grid" | Asked | Idle: "This is the Accounts grid." |
| "group by household", "accounts over $1m" | Ready | Unchanged |
| Any request, on a Host with no `grids` | — | Unchanged |

The rows-noun cases already labelled for the single accounts grid (`evals/cases.jsonl:22`, `evals/cases-live.jsonl:9`, `evals/cases-reading-heldout.jsonl:43`, `evals/mentions-cases.jsonl:50`) keep their labels. They are run without `grids`. Copies with the four grids declared join the routing set with new labels.

## 6. Public API and protocol

All additive, except the audit callback's widened type (section 14). Nothing is removed or renamed.

| Addition | Entry | PR |
| --- | --- | --- |
| `controller.proposeView(state)` | root | 1 |
| `proposeView` on the `useGridCue` binding | `gridcue/react` | 1 |
| `INPUT_INVALID_VIEW` | root | 1 |
| `GridCueOptions.savedViews`, `SavedViewsOption`, `SavedViewEntry` | root | 2 |
| `ControllerState.pending`, `PendingStep` | root | 2 |
| `ADAPTER_SAVED_VIEW_FAILED`, `INPUT_SAVED_VIEW_FAILED` | root | 2 |
| `SavedViewAuditEvent`, `GridCueAuditEvent`; `audit.onEvent` takes `GridCueAuditEvent` | root | 2 |
| `previewLabels(state)` and `statusLabel(state)` | `gridcue/react` | 2 |
| `title`, `applyLabel` and `note` props on `PreviewPanel` | Component Registry | 2 |
| `GridCueOptions.grids`, `GridsOption`, `DeclaredGrid`, `RouteRequest` | root | 3 |
| `ADAPTER_ROUTE_FAILED` | root | 3 |
| `GridAuditEvent` added to `GridCueAuditEvent` | root | 3 |
| `initialRequest` on `useGridCue`, `<GridCueBar />` and `CommandBar` | `gridcue/react`, Component Registry | 3 |
| `text` and `setText` on the binding (the input's text, held in the hook) | `gridcue/react` | 3 |

The resolution protocol does not change. `gridcue/server` and `gridcue/mock` do not change. `gridcue/tanstack-table` changes only in tests: the adapter contract suite gains `proposeView`.

## 7. ADRs

Both are in the planning record, before PR 1's code.

**ADR 0034, "Saved views through the Host"** (`docs/adr/0034-saved-views-through-the-host.md`). GridCue saves and opens a saved view by request, only through the Host's `savedViews` callbacks, and never stores a view itself. The Host's list is the current User's, for this grid. The list never goes to an Intent Provider; a request is sent as typed only when it also reads as a change on this grid. A name is matched exactly, ignoring letter case. A save is previewed and happens on Apply; a name in use is never replaced by request; undo removes the new saved view. Opening goes through `proposeView`, so a saved view never skips the Preview. It rewrites the last paragraph of ADR 0021 ("GridCue ships no saved-views feature") to point here; the rest of ADR 0021 stands.

**ADR 0035, "Offering a declared grid"** (`docs/adr/0035-offering-a-declared-grid.md`). Navigation stays an unsupported family, with one exception: GridCue may offer to open a grid from the Host's closed `grids` list, and the Host's `onRoute` callback navigates. GridCue never navigates without the User's choice, never opens a record or an undeclared screen, and sends only the User's words to the target grid, never rows. The decision is made in code; the resolution protocol does not change. Once a Host declares a grid for a noun, a request whose rows are that noun no longer filters this grid unless the User chooses to keep it there. A route has no undo, and a route chosen in a question has no Preview, because the choice was the User's and nothing on this grid changes (order plan, D34).

`AGENTS.md` rule 1, `docs/internals/product.md` and the Site's safety page each gain one sentence for the exception. Rule 1 sits under "What we never compromise on", so the owner writes that sentence by hand, and no agent edits it. PR 3 waits for that edit. The other two edits are made in PR 3.

## 8. Terms for CONTEXT.md

- **Saved View**: A View State the Host stores under a name the User chose. GridCue saves and opens one by request through the Host, and never stores it. _Avoid_: Bookmark, preset, layout, favourite.
- **Declared Grid**: One of the grids the Host lists as places a request can be sent, each with its own Row Noun. _Avoid_: Screen, page, route, tab.
- **Grid Offer**: GridCue's offer to open another Declared Grid when a request names that grid or is about its rows. The User chooses, and the Host opens the grid. _Avoid_: Redirect, jump, navigation.

The **Controller** entry stays: it still wires one grid.

## 9. UI design pass

Applied with `emil-design-eng`, `better-ui` and `principle-experience-first`. Both UIs get the same behaviour from the hooks. Labels come from `previewLabels` and `statusLabel` in `gridcue/react`, so the two UIs can't drift; the command bar reuses both. PR 2 starts with one throwaway HTML prototype of the whole bar, light and dark: every new state here, the command bar's states (its section 9), and the four bets' future lines. This work, the command bar and the four bets each planned a bar prototype. There is one, built here because this work's components come first, so the owner sees the whole bar once, before any component code.

| Before | After | Why |
| --- | --- | --- |
| The panel heading is always "This will change" (bar: `.gridcue-heading`, `0.875rem`; registry: `CardTitle` `text-sm`) | "This will change" for plans and saved views, "This will save" for a save, "This will open" for a grid. Same classes | The heading names what Apply does |
| The primary button is always "Apply" (bar: `.gridcue-primary`; registry: `Button size="sm"`) | "Apply", "Save view", or "Open" and the grid's label ("Open Households"). Same classes, no fixed width | A verb and its object. Leaving the screen must never look like applying a filter |
| The status label for `ready` is "Ready to apply" | "Ready to save" and "Ready to open" for those steps. "Saved" after a save | The label is text, never colour alone |
| The status row is empty on a ready plan | The message carries context: "This is about clients." for an offer; "From your saved view “Exceptions”." for an opened view. Status row style unchanged: `0.875rem`, `var(--gridcue-muted)`, live region | The User sees why GridCue offers this before choosing |
| The panel's note is "No records will be changed." (bar: `.gridcue-note`, `0.8125rem`, muted; registry: `text-xs text-muted-foreground`) | Unchanged for plans. A save: "Only the view is saved, never the rows." A grid: "This grid's view stays as it is." Same styles | Each note answers the doubt that step raises |
| Preview lines can overflow on a long unbroken word | `.gridcue-list li { overflow-wrap: anywhere; }`; registry `[overflow-wrap:anywhere]` on each `li` | A 60-character name or a long request stays inside the panel |
| Clarification choices are outline buttons | Unchanged style. Labels: "Open your saved view “Taxable”", "Change this view instead", "Keep it on this grid", "Open the Households grid". Choices that stay on this grid come first | The way that leaves the screen is never the first thing a keyboard User reaches |
| The target grid's input starts empty | It starts with the passed request (`initialRequest`), and its Preview shows on mount. Focus is not moved | The User sees their own words arrive. Moving focus on page load is the Host's call |
| Ctrl/⌘ Enter applies a ready plan; Escape cancels | The same keys save and open. The `<kbd>` hint is unchanged | One way to confirm, whatever Apply does |
| The panel appears with no transition | Unchanged: every new state appears with no transition | Keyboard-driven, many times a day |
| Press feedback `scale: 0.96`, `150ms ease-out` | Unchanged on the new buttons | No new motion |
| Light accent `#2563eb`, dark `#60a5fa` | Unchanged. No new tokens | No new colour carries meaning |
| `PreviewPanel` has fixed text | It gains `title`, `applyLabel` and `note` props, whose defaults are today's text | A registry file a developer already copied keeps working |

## 10. Evals and evidence

Every set is synthetic. Every held-out set is written and labelled before the code it tests, by a labeller who has not seen that code. A wrong view, wrong save or wrong route in a held-out run goes back to the builder as a class. The class is narrowed: GridCue asks, or keeps today's reading, and no reading is added (order plan, D4). That class then gets a fresh held-out set.

**Definitions.** A *wrong view* applies, or offers as ready, a view the User did not ask for. Opening a saved view other than the one named, or opening one for a request that reads as a change here without the User choosing it, is a wrong view. A *wrong save* saves when not asked, under a name other than the one typed, or over an existing name. A *wrong route* offers, or adds as a choice, a grid the request is not about, or passes words that change what the target grid previews.

| Mechanism | Dev set | Held-out set | Bar | Reported, with no bar |
| --- | --- | --- | --- | --- |
| `proposeView` (5.1) | The seeded generator of random reachable views (operation set PR 3), 1,500 on each of two schemas (wealth and the ledger fixture), from random starting views | The same test with seeds drawn by the lead after the build | The applied view equals the saved one, or the result is unsupported. Never a different view | The unsupported share, by reason |
| Save frame (5.2) | 25 requests | 25 requests | 0 wrong saves. 0 changed results on requests that are not saves | The held-out exact share |
| Open frame (5.2) | 40 requests, on a fixed list of 8 synthetic names: three collide with this grid (a value, a Value Group, a column label), one with a declared grid, two differ by one letter. Some requests type a name one letter off, or in another word order | 40 requests: 25 on the same list, and 15 on a second list of 6 names over the ledger schema, which the builder never sees. Two of those names collide with a House Term and a Local Value | 0 wrong views. A near name is never opened and never offered: it gets the result of a name that is not on the list | The share opened at once, asked, and unchanged |
| No change elsewhere (4.1) | Every existing set, run with the synthetic `savedViews` list and the four grids declared | — | Every result identical to the run without them, except the cases the routing labeller listed before the code (rows that are another grid's) | — |
| Routing (5.3) | 50 requests on the Accounts grid with four declared grids. Each passed request also labelled on the households schema | 50 requests, labelled the same way. At least 15 use a second grid list the builder never sees: the Households grid as the current one, with other aliases. At least 5 put a House Term or a Local Value before another grid's noun | 0 wrong routes, 0 wrong views on either grid | The share offered, asked, and unchanged; the share where the User named a grid in words no declared name covers (the evidence that would change grill Q7) |
| A real Host application, at the owner's call | Its own grids declared in a throwaway clone; requests written from its grids before the build is seen | — | 0 wrong views, 0 wrong routes | Offers and questions, by grid |

- The gate (`pnpm check`) runs the new sets with the Mock Provider. A wrong view, wrong save or wrong route fails it.
- Live runs with Jev need the owner's command. The four new steps call no provider. Before PR 3 merges, one `--live` run on the existing sets with grids declared confirms 0 wrong views where "Keep it on this grid" and today's path still reach Jev.
- The households schema is added to `fixtures/` in PR 3, with a currency, a number and a date column, as the target grid. It is not a second domain. PR 1's second schema is the ledger fixture from named filters' PR 2, and its generator is the operation set's (order plan), so PR 1 adds neither.

## 11. Surfaces

| Surface | What changes |
| --- | --- |
| Entry points | Root: everything in section 6. `gridcue/react`: the binding, the bar, `styles.css`, the label helpers, `initialRequest`. `gridcue/tanstack-table`: contract tests only. `gridcue/server` and `gridcue/mock`: no change, and the browser bundle check still passes |
| Both UIs | The save and grid steps, the new labels, the collision and grid questions, and `initialRequest`, from the same hooks. `PreviewPanel` gains three props |
| Frameworks and tables | The Vite example (registry `CommandBar`) and the Next.js example (`<GridCueBar />`) both save and open views, stored by the example in `localStorage` as Host code. In PR 3, Next.js adds a `/households` route and Vite switches between two grids in its own state; both pass the request in memory, never in a URL. Both Grid Adapters pass the contract suite with `proposeView` |
| The Site | The demo gains saved views with one seeded synthetic view, "Exceptions". Docs: `api/create-grid-cue`, `api/react`, `api/protocol` (audit events), `concepts/views`, `concepts/requests`, the component pages, `safety`, and two new guides, "Saved views" and "Several grids" |
| Agent skill | `skills/gridcue` covers `savedViews`, `grids` and `onRoute`, and `proposeView`. `pnpm check:skills` passes |
| Failure paths | Cancel and Escape clear every new step. Undo removes a save. A route has no undo, and says nothing changed here. A stale Revision rejects a save and an opened view. An unreadable saved view is `INPUT_INVALID_VIEW`. A failing `list` or `load` is `INPUT_SAVED_VIEW_FAILED`; a failing `save` or `remove` is `ADAPTER_SAVED_VIEW_FAILED`; a failing `onRoute` is `ADAPTER_ROUTE_FAILED`. The view is unchanged in each |

## 12. Testing

- Unit tests for `proposeView`: an unreadable state, an unknown column, a restricted column, a setting the grid can't apply, the same view, a stale Revision, cancel, undo. The property test with fixed seeds.
- Unit tests for each frame: every verb, every optional word, quoted names, names with "view" in them, case, near names (which must not match), two equal names, and a leftover word in each, which must leave the request to today's path.
- Unit tests for the rows-noun rule: subject and non-subject places, claimed and unclaimed names, aliases, mixed grids, and a singular noun naming one record.
- Controller tests: the pending step through Apply, Cancel and Undo; stale Revisions; each Host callback throwing; `answer` on a route choice and on "Keep it on this grid"; audit events with and without `includeText`; a Host with neither option is unchanged, pinned by a test that compares states.
- `INPUT_CONFIG` tests for every invalid `grids` option.
- Component tests in both UIs for each label, the note, the choices' order, and `initialRequest` proposing once, in React's strict mode too.
- The payload pin test (operation set PR 1) runs with both options set. The provider request for every labelled request equals the last recorded one, so nothing from the Host's list of saved views or the grid list is in it.
- Every UI change is checked in a real browser, light and dark, in the Vite example, the Next.js example, and the Site.

## 13. Acceptance criteria

1. `pnpm lint` and `pnpm check` pass with no credentials after each PR.
2. Every bar in section 10 is met and reported in its PR, with the numbers, misses included.
3. Each PR's description says which surfaces in section 11 it touched.
4. ADR 0034 and ADR 0035 are in before PR 1's code. ADR 0021's last paragraph points to ADR 0034. The owner's `AGENTS.md` rule 1 edit is in before PR 3 merges. `CONTEXT.md` has the terms in section 8.
5. UI PRs carry before and after screenshots, light and dark.
6. The README roadmap and the product brief no longer list grid routing as missing from 0.2 once PR 3 ships.

## 14. Risks

- **The rows-noun rule is the most likely source of a wrong route.** It decides when "clients over $5m" is about another grid. The held-out set is the check, and an offer still needs the User's choice and a Preview on the target grid.
- **Hosts with a declared grid will see questions where they saw ready filters.** "Households over $5m" asks on the wealth fixture. That is the point of grill Q8, but the share of new questions is reported, and a real Host application's run is the owner's evidence.
- **`audit.onEvent` widens its type.** A Host that typed its handler as `(event: AuditEvent) => void` gets a type error. Inline handlers do not. The changelog says so. The owner chose this over a second callback (order plan, D33).
- **A saved view can stop opening after the Host's schema changes.** A missing column fails closed as unsupported, and the message names the setting. That is correct, and the guide tells Hosts to expect it.
- **`list` is synchronous.** A Host with remote storage may hold a stale list: a new name is not found, or a save misses a name taken elsewhere. The first asks; the second relies on the Host's `save` rejecting a duplicate, which the guide asks for.
- **Saved names can hold client names.** The list stays in the browser and the Host's store, and is left out of audit events by default. A name reaches a provider only inside a request the User typed that also reads as a change on this grid (4.1), as any typed request does today.
- **A passed request in a URL could reach server logs.** Both examples pass it in memory, and the guide says why.
- **A name typed one letter off is not found.** After "open", GridCue says there is no saved view by that name. After "show", the request keeps today's reading. Near names can come later, on their own held-out set.
- **Users who name a saved view after a value ("Taxable") get a question each time they open it with "show".** "Open my taxable view" asks too. The open-frame set reports how often; a later grill can loosen this on evidence.

## 15. How this meets the four bets

- **`proposeView`** is built here, unchanged from four bets spec 5.3. Four bets PR 3 then builds `describeView`, the sentence in both UIs and `ControllerState.view`, and drops `proposeView` from task 3.3. The random-view generator (operation set PR 3) and the second schema (named filters PR 2) also exist before the bets start, so task 3.1 has nothing left to build.
- **The "Save and share a view" guide** in four bets PR 3 becomes this work's "Saved views" guide. Four bets PR 3 adds sharing by link to it, as `proposeView` with a state from a URL.
- **`describeView`.** Once built, the save Preview reads "Save the current view as “concentrated”: Accounts where …", and the open Preview puts the saved view's View Sentence above its operations. `savedViews.save` may then receive the sentence too, as an added field.
- **`controller.read`.** A saved name in an open frame, and a grid name in a move frame or as the rows, can get a mark worded like the offer: "exceptions: your saved view", "clients: Clients grid". This is why `list` is synchronous. A name that is not exactly on the list gets no mark.
- **The Local Resolver.** Its closed grammar refuses parts starting with "open" or "go". The four steps in 4.1 run before any resolver, so the grammar never needs these forms. With no provider, saves, opens and offers still work; "Keep it on this grid" and "Change this view instead" run the Local Resolver, or ask.
- **Positions in the User's text** (four bets 4.1). The save frame reads the name from the text as typed, so it needs no positions now. When positions exist, the frame can use them with no change in behaviour.
- **One vocabulary** (four bets 4.2). The new Preview words join that module when it exists.
