# Grid routing and saved views: grilling log

Status: answered by the owner on 2026-11-13. The answers are at the end of this log.

This is opportunity 4 of the five the owner put ahead of the four bets on 2026-11-13: "5 opportunities first then four bets in terms of build priority." It takes GridCue past one grid and one moment. **Grid routing** sends a request about another grid to that grid. This is the owner's advisor desktop, with client, household, account and position grids (fan-out grill, Q2). **Saved views** let a User keep a good result ("save this as my exceptions view") and bring it back ("open my exceptions view"). Both stay inside the first and fourth rules in `AGENTS.md`. GridCue picks a grid from a closed list the Host declares, and the Host does the redirect. The Host stores every saved view; GridCue never stores one. The design is for today's code, where every request goes through an Intent Provider. Where it touches what the four bets add later, this log says so. This round asks only what is the owner's to decide.

## Facts gathered (2026-11-13)

Each fact cites a file and line, or the command that was run. Probes ran from the repo root with `pnpm exec tsx` on the wealth fixture and the Mock Provider, with no model calls. The scripts are kept outside the repo. *Unverified* marks anything nobody checked.

The spec author re-checked every fact against the code on 2026-11-13. Two citations were wrong and are corrected in place, five facts were added, and Q5 and Q7 changed as a result. Each change is marked.

### Where the two ideas stand

- **Routing was promised and never specced.** The owner asked for it on 2026-09-24: "imagine an advisor desktop with many different views (client, household, account, positions…) redirect capability to correct grid" (`docs/planning/fan-out-grill.md:159`). The answer was recorded as "the Host navigates through a callback it owns, and GridCue picks the grid". It was sequenced after fan-out (`fan-out-grill.md:161`), and then after the chassis (`configurable-resolution-grill.md:105`).
- **It slipped from 0.2.** The product brief (`docs/planning/product-brief.md:206`) and the README (`README.md:168`) list grid routing for 0.2. The 0.2.0 changelog (`packages/gridcue/CHANGELOG.md:56-69`) has none.
- **Saved views are deferred by design.** The product definition lists "Named/saved views" under "designed in the protocol, deferred in implementation" (`docs/internals/product.md:56`). It also says GridCue is "not a replacement for … saved views" (`product.md:102`).
- **The four bets left storage out on purpose.** ADR 0021 says "Storage, names, and links stay with the Host. GridCue ships no saved-views feature" (`docs/adr/0021-the-view-state-is-the-record.md:17`). The four bets spec puts "storing, naming, or sharing views" out of scope (`docs/superpowers/specs/2026-11-10-four-bets-design.md:54`).
- **`proposeView` is designed and not built.** Spec 5.3 (`four-bets-design.md:168-178`) and ADR 0021 cover it. A saved state is untrusted. It becomes the operations that turn the current view into it, and it is validated like any plan. It applies in full or is unsupported, and is never partly applied. Plan task 3.3 builds it in PR 3 (`docs/superpowers/plans/2026-11-10-four-bets.md:146-151`), after PR 2.
- **Without `proposeView`, a saved view skips the Preview.** `adapter.restore` already "puts a saved view back" (`apps/site/content/docs/api/adapters.mdx:35`). It does no validation. ADR 0021 (`:15`) says a Host that calls it with a stored state gets none of the checks.

### How GridCue is built today

- **One Controller is wired to one grid.** `GridCueOptions` takes one `adapter` and one `provider` (`packages/gridcue/src/core/controller.ts:26-40`). The undo stack lives in that Controller (`controller.ts:89-91`). CONTEXT.md defines the Controller as "the single object a developer creates to wire one grid".
- **Navigation is refused everywhere.** Code:
  - It is one of four unsupported families (`core/resolution.ts:29`) and a protocol category (`core/protocol.ts:158`).
  - "open", "go" and "navigate" start a new part (`core/normalize.ts:69-71`).
  - The Mock Provider marks "go to", "navigate", "take me" and "open the page/screen/record" as navigation (`mock/index.ts:19`).
  - Jev is asked whether a part means "open another page or record" (`server/jev.ts:76`).
  - Docs: `AGENTS.md` rule 1 and `apps/site/content/docs/safety.mdx:10` ("never … navigates to other screens"). `product.md:65` excludes "navigating to records or privileged application areas".
- **The Host already declares other records.** A column can name an `entity`, such as Household (`core/schema.ts:38-39`, `core/protocol.ts:51-52`). The schema has one `rowNoun` (`protocol.ts:65`). Nothing declares another grid. ADR 0015 rule 4 offers "Group by Household" for "largest households first" (`core/compile.ts:368`). The chassis grill planned to add "Open the Households grid" there "once routing exists" (`configurable-resolution-grill.md:58`).
- **What a provider is sent is closed.** The request carries the Clauses, the candidate families and columns, the `rowNoun`, and the current view (`core/resolution.ts:80-114`). Grids and saved views are not in it. Adding them would change the resolution protocol, which needs an ADR (`AGENTS.md`, Documentation).
- **A plan's status has three values,** `ready`, `needs_clarification` and `unsupported` (`protocol.ts:185`). A plan's source channel can already be `"api"` (`protocol.ts:182`).
- **Audit events describe plans only.** The type is `"gridcue.plan"`, with no text or labels unless the Host opts in (`core/preview.ts:171-193`). A save or a route is not a plan.
- **"View" already appears in requests.** "Reset my accounts view" is a reset, and stays one (`CHANGELOG.md:39`). The product definition's example "give me a compact exceptions view" asks for a density change, not a saved view (`product.md:162`).
- **A question's choices are closed.** A Clarification offers fixed options or none (`protocol.ts:169-175`), and `answer` is synchronous (`controller.ts:46`). There is no free-text answer, so "ask for another name" means a question with no choices, and the User types again. *(Added by the spec author, 2026-11-13.)*
- **Undo is tied to revisions.** An undo entry is usable while the grid shows the revision its plan produced (`controller.ts:89`, `:105`). A save changes no revision, so an undo entry for a save needs its own rule. *(Added by the spec author, 2026-11-13.)*
- **The bar's text is its own.** Both UIs keep the input's text in local component state (`react/grid-cue-bar.tsx:22`, `registry/registry/gridcue/command-bar.tsx:23`). A request passed from another grid has no way into the input today. *(Added by the spec author, 2026-11-13.)*

### What requests do today (probe, Mock Provider)

| Request | Result today |
| --- | --- |
| "go to households", "take me to the client grid" | Unsupported, navigation |
| "open the households grid", "switch to positions", "open the client record" | Asked: "I'm not sure what to change for …" |
| "show households" | Asked: "What should … filter on?" |
| "largest households first" | Asked, two choices: Group by Household / Use the Household column |
| "save this as my exceptions view", "save this view" | Asked: "I'm not sure what to change for …" |
| "open my exceptions view", "load the exceptions view", "switch to my Q3 review view" | Asked: "I'm not sure what to change for …" |
| "show my exceptions view" | Asked: "What should … filter on?" |
| "delete my exceptions view", "rename this view to exceptions" | Unsupported, data editing |
| **"households over $5m"** | **Ready: Filter Market value above $5,000,000** |
| **"clients over $5m"**, **"positions over $1m"** | **Ready: Filter Market value above …** |
| **"show positions over $1m sorted by gain"** | **Ready: Filter Market value above $1,000,000, then Sort by Unrealized gain** |
| **"households sorted by value"**, **"households with more than $5m sorted by value"** | **Ready: Sort by Market value; Filter Market value above $5,000,000 and Sort by Market value** |
| **"show my taxable view"**, **"show the taxable view"**, **"show taxable view"** | **Ready: Filter Registration type to Taxable** |
| **"show my retirement view"**, **"show me my northgate view"** | **Ready: Filter Registration type to any of IRA and Roth IRA; Filter Custodian to Northgate** |
| "open my taxable view", "switch to taxable", "load taxable" | Asked: "I'm not sure what to change for …" |

*The last four rows were added by the spec author on 2026-11-13, with the same probe script.*

- **On the single accounts grid, the rows-noun results are labelled correct.** "Households over $10M" is labelled as an account filter (`evals/cases.jsonl:22`), and so are "Clients with more than $5 million" (`evals/cases-live.jsonl:9`) and "Households over $1M, group by advisor" (`evals/cases-reading-heldout.jsonl:43`). The Mentions set expects no Mention in "Households over $10M." (`evals/mentions-cases.jsonl:50`). The changelog keeps this on purpose: "other entities … still mean the rows" (`CHANGELOG.md:16`).
- **Two different rules give these results.** *(Corrected by the spec author, 2026-11-13. The log first cited `core/normalize.ts:110`, which is the rule that keeps "Roth IRAs grouped by rep" in one part, not a reading rule.)* "Households" is the Household column's `entity`. Before an amount the column can't hold, it is dropped as the rows (`core/mentions.ts:214-221`). "Clients" and "positions" are no declared name at all. Nothing reads them, and the amount goes to the column the Mock Provider's `literalColumns` picks, the Host's default for its kind (`mock/index.ts:186-211`).
- **"Show" with "view" is already a filter.** "Show my taxable view" and "show my retirement view" are ready filters today. A Host's User may well name a saved view "Taxable". So the frame in Q5 can't claim every "show my X view": it would turn today's ready filter into a different view whenever a saved name matched.
- **On a multi-grid desktop, the same results would be wrong views.** A User who types "households over $5m" next to a Households grid wants households worth over $5m. Today they get accounts worth over $5m. Routing has to change this reading, but only for a Host that declares the other grid.
- No eval case asks to navigate to a declared grid, save a view, or open one. The only `open` case is a workflow refusal: "open a new IRA for the Birch household" (`evals/cases-reading-heldout.jsonl`).
- "Pin the Northgate accounts to my watchlist" is labelled unsupported (`evals/cases-reading.jsonl`). Keeping rows in a list is a business workflow. Saving a view keeps only the View State, never rows.

### Not checked

- *Unverified:* how Jev scores "open my exceptions view", "save this as my exceptions view" or "households over $5m" next to a declared grid. Live calls need the owner's command.
- *Unverified:* how a real Host application names its grids and saved views. It was not opened for this log.
- *Partly checked by the spec author, 2026-11-13:* whether both examples can show routing with a second grid on its own route. The Next.js example uses the App Router with one page (`examples/next/app/page.tsx`), so a second grid is one more route file. The Vite example has one grid and no router (`examples/vite/src/App.tsx`), so its "navigation" would be the app switching grids in its own state, which is still the Host's redirect. Neither was built.

### Where this touches the four bets

- **`proposeView`** (spec 5.3) is the only safe way to open a saved view. Q2 asks whether to build it here, with the same design.
- **`describeView`** (spec 5.3): once it exists, the Preview for opening a saved view can include that view's View Sentence. Until then, the Preview lists the operations, like any plan.
- **The Local Resolver's closed grammar** (spec 5.4) refuses a part that starts with a refused verb, and "open" and "go" are among them. Routing and saved-view requests are recognised in the Controller before any resolver runs, the same way restricted columns are screened (`controller.ts:273`). So the Local Resolver never sees them, and its grammar does not need them.
- **`controller.read`** (spec 5.2): a recognised grid noun or saved-view name can later get a mark of its own, with the same words the offer uses.

## Round 1

Answer by number. A bare "agree" accepts the recommendation.

❓ **Q1 - Scope and order.**
(a) **One spec and one plan, with two PRs: saved views first, built on `proposeView`, then grid routing after its ADR.** ← recommended
(b) Routing first, because it is the owner's stated requirement.
(c) Two separate grills, specs and plans.

➡️ (a). Saved views reuse a design that is already approved, and they are smaller. Routing needs an ADR first, because it moves the navigation boundary. Both need one rule that tells "open my exceptions view" from "open the Households grid" from "open the client record". One spec keeps that rule in one place.

---

❓ **Q2 - `proposeView` moves forward.**
(a) **Build `proposeView` in this work, exactly as four bets spec 5.3 and ADR 0021 describe it.** Four bets PR 3 then adds only `describeView`, the sentence, and `ControllerState.view`. ← recommended
(b) Build a narrower path that opens saved views only, and leave `proposeView` for PR 3.
(c) Saved views wait for four bets PR 3.

➡️ (a). There is one design for bringing a View State back, and it is approved. (b) would make two ways to do the same thing. (c) goes against the build order. `proposeView` does not depend on PR 2's positions, so moving it changes nothing else in the four bets plan.

---

❓ **Q3 - What saved views do by request.**
(a) **Open and save.** The Host passes a `savedViews` option to `createGridCue`: the current User's list of names, and callbacks to load, save and remove. GridCue never stores a view. Renaming, deleting and sharing stay in the Host's own UI and are still refused in the bar. ← recommended
(b) Open only. Saving stays a button the Host builds.
(c) Neither by request. Ship `proposeView` and a "Save and share a view" guide, as the four bets spec planned.

➡️ (a). "Save this as my exceptions view" builds on the product definition's own example, "compact exceptions view", and the Host still owns storage. ADR 0021's line "GridCue ships no saved-views feature" changes with this answer, so the spec rewrites it. Renaming and deleting change something the User already has, so they stay out.

---

❓ **Q4 - How a save is confirmed and undone.**
(a) **A save is shown like a Preview ("Save the current view as “Exceptions”") and happens on Apply. A name already in use is never replaced by request: GridCue asks for another name. Undo removes the new saved view through the Host's `remove` callback.** ← recommended
(b) Save at once, then show "Saved" with Undo.
(c) Confirm first, and allow replacing a name after a second question. Undo puts the old view back.

➡️ (a). Nothing happens without a Preview, and every way in has a way out. Replacing a saved view loses something the User built, so a request alone should not do it. (c) would also make GridCue hold the old view to undo a replace, and it should never store a view.

---

❓ **Q5 - How a request names a saved view, and what leaves the browser.**
(a) **A saved view is named only in an explicit frame: "open", "load", "switch to" or "go back to", then "my" or "the", then the name, with "view" optional; or "show my" or "show the", then the name, then "view", which is required after "show". The name must exactly match one name on the Host's list, ignoring letter case. A near match, or two matches, asks with the names as choices. A name that also reads as something on this grid (a column, a value, a Value Group, the Row Noun) or as a declared grid asks with both readings as choices. After "show", a name that is not on the list leaves the request to today's reading. Saved-view names never go to an Intent Provider.** ← recommended
(b) Any mention of a saved name opens it, matched in code.
(c) Also send the names to the provider as candidates, so it can match loosely, when the Host opts in.

➡️ (a). Names are the User's own text. They can hold client names, and they can collide with column labels and values ("Taxable", "my accounts view"). The narrowest certain reading is an explicit frame and an exact name. (b) would read "show taxable" as a saved view called "Taxable". (c) sends User content to a provider, which rule 4 keeps out by default.

*Changed by the spec author on 2026-11-13, after the facts check.* The first draft let "show" open a saved view with "view" optional, and did not say what a name that reads as a change on this grid does. "Show my taxable view" is a ready filter today. With a saved view called "Taxable" it would have opened that view, which may hold a sort and hidden columns the User did not ask for. "Open", "load", "switch to" and "go back to" only ever ask today, so claiming them changes no ready result. "Show" claims a request only when the name is exact and nothing on this grid reads the same way.

---

❓ **Q6 - What a request for another grid does.**
(a) **Offer, never jump. GridCue says "This is about households. Open the Households grid?" and the User chooses. The Host's `onRoute({ gridId, request })` callback navigates. The request is passed on only when it asks for more than the move itself, and the target grid's Controller previews it as usual. A request that mixes this grid and another asks the User to split it. Opening a record or any screen that is not a declared grid stays unsupported.** ← recommended
(b) Navigate only. Nothing is passed on, and the User types again on the new grid.
(c) Navigate at once, without asking, when the grid is certain.

➡️ (a). Moving to another screen leaves the grid the User is looking at, so it is their choice. Passing the request on means "households over $5m" ends in a Preview on the Households grid, and nothing applies without it. Only the User's own words move, never rows. (c) would be the only change GridCue makes with no Preview.

---

❓ **Q7 - How GridCue decides a request is about another grid.**
(a) **In code only, from a `grids` option on each Controller.** Each declared grid has an id, a label, a Row Noun and aliases. A request routes when its rows are another grid's Row Noun and nothing in this grid claims that word. When a column here does claim it (Household's `entity`), "Open the Households grid" is one more choice in the question, never the only reading. No provider question, so the protocol is unchanged. There is no router object above the Controllers. ← recommended
(b) Also add a "which grid" Choice to the provider request. This changes the protocol and needs its own ADR.
(c) A router object above several Controllers, which picks one per request.

➡️ (a). Grids are a short closed list the Host declares, and their nouns are read by the same matcher as Mentions, so code can be certain. On an advisor desktop the target grid is usually not mounted, so a router above live Controllers has nothing to call. The bar is fixed before any code: 0 wrong views and 0 wrong routes on a held-out set of routing requests, labelled before the rule exists. What would change this answer: a held-out set where Users name grids in words no declared alias covers, often enough that asking becomes the usual result.

*Made precise by the spec author on 2026-11-13.* "Claims" means the word is a label, alias or `entity` of a column here that the provider may see. On the wealth fixture, Household's `entity` claims "households". So "households over $5m", which is a ready filter today and no question at all, becomes a question with two choices: "Open the Households grid" and "Keep it on this grid". Where today's result is already a question with choices ("largest households first"), the route is added to those choices, so there is still one question. "Keep it on this grid" gives today's result, chosen by the User. "Clients over $5m" is claimed by nothing here, so it is offered.

---

❓ **Q8 - What another record's name means once its grid is declared.**
(a) **When the Host declares a grid for a noun, a request whose rows are that noun never filters this grid. It offers that grid, or asks. Without a declared grid, nothing changes, and today's labels stand.** ← recommended
(b) Nothing changes. Entity nouns keep meaning this grid's rows, and routing happens only on explicit words such as "open the Households grid".
(c) Change it for every Host: ask whenever another record's noun names the rows, whether or not a grid is declared.

➡️ (a). Today "households over $5m" filters accounts. That is right when no Households grid exists, and a wrong view when one does. The Host's declaration is what makes the difference certain. (b) keeps a view the User didn't ask for. (c) changes results labelled exact for every single-grid Host. That is a reading question for its own grill, not part of routing.

## Owner's answers

The owner was shown the 45 decisions in section 7 of `docs/superpowers/plans/2026-11-13-five-opportunities-order.md` on 2026-11-13, with the words "a bare agree accepts every recommendation", and two trims the lead recommended in the same message. The owner's reply, in full: "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next."

| Question | Order plan | Answer (owner, 2026-11-13) |
| --- | --- | --- |
| Q1 - Scope and order | D1 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." |
| Q2 - `proposeView` moves forward | D29 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." |
| Q3 - What saved views do by request | D30 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." |
| Q4 - How a save is confirmed and undone | D31 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." |
| Q5 - How a request names a saved view | D32 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." |
| Q6 - What a request for another grid does | D34 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." |
| Q7 - How GridCue decides a request is about another grid | D35 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." |
| Q8 - What another record's name means once its grid is declared | D36 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." |

**What the reply approved.** It approved the recommended answers as section 7 of the order plan states them, and with them the spec and the plan. For every question above that is answer (a). Section 7 was written after a cross-check of all five opportunities. Where it differs from this log's own recommendation, section 7 stands:

- **Q1 and D1.** This log recommended two PRs. The work is a planning record and three code PRs: `proposeView`, then saved views, then grid routing. They are steps 21 to 23 of the order plan, after named filters, the operation set and more grids, and before the command bar.
- **Q2 and D29.** `proposeView` is built once, in this work's first code PR. The command bar and the four bets use it and do not build it again.
- **Q5 and D32.** This log said saved-view names never go to an Intent Provider. Section 7 says the Host's list is never sent. A name the User typed can still leave the browser inside their own request, when that request also reads as a change on this grid, as any typed request does today.
- **Q6 and D34.** Section 7 adds three things this log did not say. `AGENTS.md` rule 1 gains one sentence, which the owner writes by hand. A route has no undo. A route the User picks as a choice in a question has no Preview, because the choice was theirs and nothing on this grid changes.
- **Q8 and D36.** This log said such a request never filters this grid. Section 7 says it never does so without the User's choice: "Keep it on this grid" gives today's result.

Section 7 also holds decisions that no question in this log asks, and the reply approved them too:

- **D33.** `audit.onEvent` widens to a union of event types. A Host with a narrowly typed handler gets a type error. A second callback was the other way.
- **D2.** The edits to approved documents in section 5 of the order plan are approved once. For this work they are ADR 0021's last paragraph, the four bets spec's line on storing views, the four bets plan's tasks as section 6 of the order plan lists them, `docs/internals/product.md`, and the Site's safety page. The `AGENTS.md` rule 1 edit is the owner's own.
- **D3.** A request for something the grid can't do gets a question with no choices, from one shared piece of code. `proposeView` is not a request. A saved view the grid can't show in full stays unsupported, as four bets spec 5.3 has it (D29), and section 3 of the order plan does not list `proposeView` among the users of that shared piece.
- **D4.** A wrong view found on a held-out set is narrowed to a question, with a fresh held-out set. No reading is added.
- **D5.** A Host callback that throws while a request is read is an `INPUT_` error, and one that throws at Apply is an `ADAPTER_` error. So a failing `list` or `load` is `INPUT_SAVED_VIEW_FAILED`, and a failing `save`, `remove` or `onRoute` keeps its `ADAPTER_` code. The spec first gave `load` an `ADAPTER_` code.

**A trim, as the lead reads the reply.** In the same message the lead recommended one trim to this work: a saved view's name is matched exactly only, ignoring letter case. Section 7 of the order plan records it under D32. The owner's reply did not name the trim. The lead reads the reply as covering it. That reading is the lead's, not the owner's words.

With the trim, Q5's answer is (a) without its near match. A name one letter off, or in another word order, is not matched and makes no question with choices. A name that is not on the Host's list is handled as the spec handles any name not on the list: after "show" the request keeps today's reading, and after any other verb GridCue says there is no saved view by that name. Two saved views with the same name still ask. Near names can come later, on their own held-out set.

The terms **Saved View**, **Declared Grid** and **Grid Offer** enter `CONTEXT.md` with these answers. ADR 0034 records saved views through the Host, and ADR 0035 records offering a Declared Grid.
