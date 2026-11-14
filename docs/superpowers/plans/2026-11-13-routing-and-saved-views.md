# Grid Routing and Saved Views Implementation Plan

Status: approved by the owner on 2026-11-13. Answers in docs/planning/routing-and-saved-views-grill.md.

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. Each task names the model that runs it and the files it owns. Do not start a task whose "needs" are not done.

**Spec:** `docs/superpowers/specs/2026-11-13-routing-and-saved-views-design.md`
**Decisions:** `docs/planning/routing-and-saved-views-grill.md`, Round 1 (Q1 to Q8) and the owner's answers; D29 to D36 in the order plan, and D1 to D5 where they reach this work; ADR 0034, "Saved views through the Host"; and ADR 0035, "Offering a declared grid".
**Build order:** opportunity 4 of the five that come before the four bets (owner, 2026-11-13). The owner approved the grill answers, the spec and this plan together on 2026-11-13. On 2026-11-13 the owner asked for the work to run in batches of workflows, with each PR watched through review and CI, and the next batch started once one clears.

## How the work is run

**Waves, and stages in order.** The work runs in the order plan's waves, each a batch of workflows. PR 0 is in wave 0, and PRs 1 to 3 are wave 5. A wave starts only when the one before it is cleared: every PR in it has a green `pnpm check` in CI and no open review comment. The PRs stack, so they run one after another. Inside each PR the stages are in order, and between stages the lead checks labels and runs the held-out set. Those checks decide what happens next.

**Every code PR follows the same five stages.**

1. **Label.** A labeller writes the dev set and the held-out set from the spec section alone, before any code. It never sees the code under test. The lead spot-checks the labels. The held-out set stays outside the repo until its first run.
2. **Build.** A builder sees the dev set, never the held-out set. It writes tests first, then the code, and runs the gate.
3. **Held-out run.** The lead runs the held-out set once and reports the numbers as they are, misses included. A wrong view, wrong save or wrong route sends the work back to the builder as a class, never as the failing sentence. The held-out set then joins the repo as a regression set, and that class gets a fresh held-out set.
4. **Review.** A reviewer sees the diff and the spec section, and nothing else.
5. **Gate.** `pnpm lint`, then `pnpm check`. UI PRs are also checked in a real browser, light and dark.

From the first held-out miss on, the builder's instruction is to narrow only: ask, or keep today's reading, and add no new reading. PR 1 of the four bets showed that each new ready reading opened new wrong views.

**Models, chosen by what a mistake costs.**

| Work | Model | Why |
| --- | --- | --- |
| The open frame and its collision rule; the rows-noun rule and what claims a name | Fable | The hardest reasoning here, and a mistake opens the wrong view or offers the wrong grid |
| `proposeView`; the save and move frames; the Controller's pending step, undo and audit; option checks; the eval harness; every review | Opus | Subtle code with wrong-view risk, on well-defined rules |
| Labelling; the generator and fixture; the prototype; hooks; both UIs; examples; Site docs; the agent skill | Sonnet | Well-specified work with tests to hold it |
| Changelog lines, index entries, `meta.json` entries, link checks | Haiku | Mechanical |

**Branches.** Each PR is a branch stacked on the one before. Where each sits among the other opportunities' PRs is in `docs/superpowers/plans/2026-11-13-five-opportunities-order.md`: this work follows named filters, the operation set and more grids, and comes before the command bar. So it builds on House Terms and Local Values, the ledger fixture and the seeded view generator, and it owns three pieces the command bar and the four bets reuse: `proposeView` (PR 1), the one bar prototype (Task 2.1), and the input's text in the hook (PR 3).

| Order | Branch | Title | Needs |
| --- | --- | --- | --- |
| 0 | `docs/routing-and-saved-views-plan` | `docs(planning): grid routing and saved views` | The owner's approval of the grill answers, spec and plan, given on 2026-11-13 |
| 1 | `feat/propose-view` | `feat(core): a saved view comes back through a Preview` | PR 0, the operation set's PR 3 and named filters' PR 2 |
| 2 | `feat/saved-views` | `feat: save and open views by request` | PR 1, and named filters' PR 3 and PR 4 |
| 3 | `feat/grid-routing` | `feat: offer to open another declared grid` | PR 2, and the owner's own edit to `AGENTS.md` rule 1 |

The order plan calls these PRs R0 to R3. Each stacks on the one before it until they merge, and merging is the owner's.

**Live runs.** No sub-agent calls Jev. The one live run in Task 3.8 waits for the owner's command.

**Before any code, the owner sees:** ADR 0034, ADR 0035 and the spec (PR 0); the throwaway prototype of every new bar state (Task 2.1); and the list of existing labelled cases whose result changes once grids are declared (Task 3.1).

## PR 0: The planning record (`docs/routing-and-saved-views-plan`)

One concern: the approval record. No code.

### Task 0.1: ADRs and glossary (Sonnet)
**Files:** two new files in `docs/adr/`, `docs/adr/0021-the-view-state-is-the-record.md`, `CONTEXT.md`, and this spec, plan and grill log.
- [ ] ADR 0034, "Saved views through the Host", and ADR 0035, "Offering a declared grid", from spec section 7, each in the house ADR form.
- [ ] ADR 0021's last paragraph is rewritten to point to ADR 0034. The rest stands. The command bar's planning record adds one line to ADR 0021 for ADR 0039: the current view's parts can be removed through a Preview. The two edits don't overlap.
- [ ] `CONTEXT.md` gains Saved View, Declared Grid and Grid Offer, from spec section 8.
- [ ] `AGENTS.md` rule 1 gains one sentence: GridCue may offer to open a Declared Grid, and the Host navigates. The owner approved the sentence (order plan, D34) and writes it by hand. No agent edits `AGENTS.md`. The order plan lists the edit beside this PR. Whenever the owner makes it, PR 3 waits for it.
- [ ] The grill log holds the owner's answers, with the order plan's decision numbers and the near-name trim.

### Task 0.2: Review (Opus), gate
- [ ] A reviewer checks the ADRs against the spec and `CONTEXT.md`'s _Avoid_ words.
- [ ] `pnpm lint` and `pnpm check`.

## PR 1: `proposeView` (`feat/propose-view`)

Spec 5.1. ADR 0021 and ADR 0034. Needs PR 0.

### Task 1.1: The property-test cases (Sonnet)
- [ ] The seeded view generator already exists (operation set PR 3), and the ledger fixture is the second schema (named filters PR 2). This task builds neither. The households fixture moves to Task 3.1, where it is the target grid.
- [ ] A list of the cases the property test must cover, written before Task 1.2: an unreadable state, an unknown column, a restricted column, a setting the grid can't apply (pins, density, summaries, `limit` where unsupported), the same view, a stale Revision, cancel, undo.

### Task 1.2: `proposeView` (Opus)
**Files:** new `core/propose-view.ts`, `core/controller.ts`, `core/errors.ts`, `core/validate.ts`, `index.ts`, `react/use-grid-cue.ts`, `test/adapter-contract.ts`, tests. Needs 1.1.
- [ ] Tests first, one for each case in 1.1's list.
- [ ] Parse the state; anything else is `INPUT_INVALID_VIEW`, "That saved view can't be read."
- [ ] The operations that turn the current view into the saved one, with `source.channel: "api"`. Validate as any plan.
- [ ] If the resulting state is not exactly the saved one, unsupported: "That saved view holds a setting this grid can't apply."
- [ ] The same view returns to idle with "The grid already shows this view."
- [ ] An internal entry point that keeps a typed request's channel and text, for PR 2.
- [ ] `proposeView` on the binding.
- [ ] The adapter contract suite runs `proposeView` on the Rows Adapter and the TanStack Table adapter.
- [ ] The property test: 1,500 views on each of two schemas (wealth and ledger), from random starting views, fixed seeds. Bar: the applied view equals the saved one, or the result is unsupported.
- [ ] A test that the operation set's count question never fires on a `proposeView` plan: the saved view states its count.

### Task 1.3: Held-out run (lead)
- [ ] The property test once more, with seeds the lead draws after the build. Report the result and the unsupported share by reason. A different view sends the work back as a class.

### Task 1.4: Docs (Sonnet) and index lines (Haiku)
- [ ] Site: `api/create-grid-cue` (`proposeView`, `INPUT_INVALID_VIEW`), `api/react`, `api/adapters` (`restore` does no checks; use `proposeView`), `concepts/views`.
- [ ] `skills/gridcue`: bring a stored view back with `proposeView`, never `adapter.restore`. `pnpm check:skills`.
- [ ] The four bets plan, as the order plan's section 6 says: task 3.1 has nothing left to build, and task 3.3 keeps only `ControllerState.view`.
- [ ] The changelog.

### Task 1.5: Review (Opus), gate
- [ ] `pnpm lint` and `pnpm check`. The browser bundle check passes.

## PR 2: Saved views (`feat/saved-views`)

Spec 4.1, 4.2, 4.3, 5.2, 9. ADR 0034. Needs PR 1.

### Task 2.1: Prototype the bar (Sonnet)
- [ ] One throwaway HTML page, outside the repo, with the built-in bar's styles: the save step, an opened saved view, the collision question, "Saved" with Undo, and, for PR 3, the grid offer, the grid question and a target bar with a passed request. Light and dark, with the exact values in spec section 9.
- [ ] The same page holds the rest of the bar as it will be: every row of the command bar spec's section 9 (the current-view line, the hint row, the Preview's ×s and values, the count, the questions panel) and the four bets' future lines. It is the one bar prototype for all three works (order plan).
- [ ] The owner looks at it. Changes go into section 9 of this spec and of the command bar spec before any component code.

### Task 2.2: Label the saved-view cases (Sonnet)
- [ ] A fixed synthetic list of 8 saved names: three collide with the wealth schema (a value, a Value Group, a column label), one with a grid name used in PR 3, two that differ by one letter, one with "view" in it, one multi-word.
- [ ] Save frame: 25 dev and 25 held-out requests, each labelled with the expected result: the save and its name, the question, or today's result.
- [ ] Open frame: 40 dev and 40 held-out requests, labelled the same way, including "show" with and without "view", names not on the list, and names one letter off or in another word order, which are labelled as names not on the list. Of the held-out 40, 15 use a second list of 6 names over the ledger schema, which the builder never sees; two of those names collide with a House Term and a Local Value.
- [ ] Written from spec 5.2 alone. The held-out halves stay outside the repo.

### Task 2.3: The frames (Fable for the open frame, Opus for the save frame)
**Files:** new `core/saved-views.ts`, tests. Needs 2.2's dev half.
- [ ] Tests first: every verb, every optional word, quoted names, case, near names (which must not match), two equal names, and one leftover word in each frame, which must leave the request to today's path.
- [ ] The save frame, reading the name from the text as typed.
- [ ] The open frame. A name matches exactly, ignoring letter case, extra spaces and the kind of quote mark. A near name is a name that is not on the list.
- [ ] The collision rule: a name that also reads as a column, value, Value Group, Row Noun, House Term or Local Value here, with the same matchers named filters uses, asks with both choices.
- [ ] Pure functions. No provider, no Controller state.

### Task 2.4: The Controller (Opus)
**Files:** `core/controller.ts`, `core/preview.ts`, `core/errors.ts`, `index.ts`, tests. Needs 2.3.
- [ ] Tests first: each row of the two tables in spec 5.2; Apply, Cancel and Undo of a save; a stale Revision at Apply; `list` and `load` each throwing (`INPUT_SAVED_VIEW_FAILED`), `save` and `remove` each throwing (`ADAPTER_SAVED_VIEW_FAILED`); a Host with no `savedViews` is unchanged, pinned by a state comparison.
- [ ] The steps in spec 4.1, in order, after the restricted-column screen.
- [ ] `ControllerState.pending`. Core renders the save Preview line.
- [ ] Where a question offers "Change this view instead", today's path runs once and its result is held. `answer` stays synchronous.
- [ ] Undo of a save calls `remove`, under today's revision rule.
- [ ] `SavedViewAuditEvent`; `audit.onEvent` takes `GridCueAuditEvent`. No name unless `includeText`.
- [ ] The payload pin test (operation set PR 1) runs with `savedViews` set: every provider request equals the last recorded one, so nothing from the Host's list is in it.

### Task 2.5: The eval harness (Opus)
**Files:** `evals/cli.ts`, `evals/run.ts`, `evals/evals.test.ts`, new `evals/cases-saved-views.jsonl`.
- [ ] Cases can carry a saved-views list and expect a pending step.
- [ ] A run of every existing set with the synthetic list set. Bar: every result identical to the run without it.
- [ ] The dev set in the gate: a wrong view or wrong save fails it.

### Task 2.6: Held-out run (lead)
- [ ] Both held-out halves, once. Bar for the open frame: 0 wrong views, and a near name never opened or offered. Report exact, asked and unchanged shares, and every miss. A wrong view or wrong save goes back as a class with a fresh held-out set.
- [ ] The halves then join `evals/` as regression sets.

### Task 2.7: Both UIs (Sonnet)
**Files:** `react/use-grid-cue.ts`, `react/grid-cue-bar.tsx`, `react/styles.css`, `registry/registry/gridcue/command-bar.tsx`, `registry/registry/gridcue/preview-panel.tsx`, `registry/registry.json`, tests in both. Needs 2.1 and 2.4.
- [ ] `previewLabels` and `statusLabel` in the hook file. Behaviour in the hook, look in the components.
- [ ] The heading, button, note and status labels from spec section 9 in both UIs. `PreviewPanel` gains `title`, `applyLabel` and `note`, defaulting to today's text.
- [ ] `overflow-wrap: anywhere` on preview lines in both.
- [ ] Component tests in both: each label, each note, the choices' order.
- [ ] Real-browser check in the Vite example, the Next.js example and the Site, light and dark. Before and after screenshots.

### Task 2.8: Examples, Site and docs (Sonnet), index lines (Haiku)
- [ ] Both examples pass `savedViews`, stored by the example in `localStorage` as Host code, with a comment that a real Host uses its own store.
- [ ] The Site demo seeds one synthetic saved view, "Exceptions", in memory.
- [ ] Site: a new guide, "Saved views" (the option, why `list` is synchronous, why `save` should reject a duplicate, why a saved view can stop opening after a schema change); `api/create-grid-cue`; `api/react`; `api/protocol` (audit events); `concepts/views`; the component pages.
- [ ] The four bets spec's "Out" line on storing, naming or sharing views: saved views exist, through the Host (order plan, section 5).
- [ ] The four bets plan, as the order plan's section 6 says. Task 2.1: the bar prototype exists, and the task updates it. Task 2.4: `read` marks a saved view's name, and lets "open" through when one follows. Task 3.4: the examples already save and open views, and its guide becomes a section on sharing by link in "Saved views".
- [ ] `skills/gridcue`, the changelog (including the audit type change, which the owner chose over a second callback). `pnpm check:skills`.

### Task 2.9: Review (Opus), gate
- [ ] `pnpm lint` and `pnpm check`.

## PR 3: Grid routing (`feat/grid-routing`)

Spec 5.3, 9. ADR 0035. Needs PR 2, and the owner's own edit to `AGENTS.md` rule 1, which ADR 0035 names. This PR does not merge before that edit is in.

### Task 3.1: Label the routing cases (Sonnet)
- [ ] A synthetic households schema in `fixtures/wealth/src/households.ts`: `rowNoun: "household"`, a name, an advisor, a currency total, a number of accounts, a review date, and an enum. Every value generated, none real. It is the target grid.
- [ ] Both sets hold requests with `savedViews` and `grids` set together: "open households" with no saved view of that name offers the grid; with a saved view called "Households" it asks with both as choices; a name that is neither still says there is no such saved view.
- [ ] Before any code, list every case in the existing sets whose result changes when the four grids in spec 5.3 are declared, with its new label. The owner sees this list.
- [ ] 50 dev and 50 held-out requests on the Accounts grid with the four grids declared. Each labelled with the result (offer and the request that goes along, question and its choices, or unchanged) and, for every request that goes along, the expected result on the households schema.
- [ ] Of the held-out 50, at least 15 use a second grid list the builder never sees (the Households grid as the current one, with other aliases), and at least 5 put a House Term or a Local Value before another grid's noun ("large households").
- [ ] Include move frames, rows of each grid, aliases, values before the noun, size words, mixed grids, one-record nouns ("the Smith household"), a whole Local Value that holds a grid's noun ("the Alder household"), undeclared screens, and the current grid's own name.
- [ ] Written from spec 5.3 alone. The held-out half stays outside the repo.

### Task 3.2: The rules (Fable)
**Files:** new `core/grids.ts`, tests. Needs 3.1's dev half.
- [ ] Tests first: every row of the two tables in spec 5.3, and a leftover word in each frame.
- [ ] Grid names with the Mentions matcher, longest first.
- [ ] The move frame, the rows-noun rule, the claim rule, and mixed grids.
- [ ] The request that goes along: the text with the move words removed, or the whole text.
- [ ] Pure functions. No provider, no Controller state.

### Task 3.3: The Controller and the hook (Opus)
**Files:** `core/controller.ts`, `core/preview.ts`, `core/errors.ts`, `index.ts`, `react/use-grid-cue.ts`, tests. Needs 3.2.
- [ ] Tests first: every `INPUT_CONFIG` case for `grids`; the offer through Apply and Cancel; a route choice in a question; "Keep it on this grid"; `onRoute` throwing; a name that is both a saved view and a grid; a Host with no `grids` is unchanged, pinned by a state comparison.
- [ ] `pending: { kind: "grid" }`. Core renders the offer's Preview lines and message.
- [ ] The route choice added to an existing question as its last choice.
- [ ] `GridAuditEvent`. No request text unless `includeText`.
- [ ] The input's text moves from each component into the hook, as `text` and `setText` on the binding. The command bar's PR 3 and the four bets' `read` reuse them.
- [ ] `initialRequest` on `useGridCue`: proposed once on mount, once only under React's strict mode.
- [ ] The payload pin test runs with `grids` set: every provider request equals the last recorded one, so nothing from the grid list is in it.

### Task 3.4: The eval harness and held-out run (Opus, then the lead)
- [ ] Cases can carry a grid list and expect an offer, and a passed request is run on the households schema.
- [ ] Every existing set with the four grids declared. Bar: every result identical, except the cases listed in 3.1, which match their new labels.
- [ ] The lead runs the held-out half once. Bar: 0 wrong routes, 0 wrong views on either grid. Report offered, asked and unchanged shares, and the share where a grid was named in words no declared name covers. A miss goes back as a class with a fresh held-out set.

### Task 3.5: Both UIs (Sonnet)
**Files:** `react/grid-cue-bar.tsx`, `registry/registry/gridcue/command-bar.tsx`, tests in both. Needs 3.3.
- [ ] The offer's labels and note, and `initialRequest` in both. Focus is not moved on mount.
- [ ] Component tests in both, including strict mode.
- [ ] Real-browser check, light and dark, with keyboard only. Before and after screenshots.

### Task 3.6: Examples (Sonnet)
- [ ] Next.js: a `/households` route on the households schema with `<GridCueBar initialRequest>`; `onRoute` navigates with the router and keeps the request in memory, never in the URL.
- [ ] Vite: a second grid on the households schema, switched in the app's own state, with the registry `CommandBar`.
- [ ] Both run with the Mock Provider and no key.

### Task 3.7: Docs (Sonnet), index lines (Haiku)
- [ ] Site: a new guide, "Several grids" (the option, the offer, passing the request in memory, no undo for a route); `api/create-grid-cue`; `api/react`; `api/protocol`; `concepts/requests`; `safety` (the one exception); the component pages.
- [ ] `docs/internals/product.md`: the exclusion line on navigating gains the exception, and "Named/saved views" leaves the deferred list. The order plan gives this record's `product.md` edits to this PR. `README.md` and `docs/planning/product-brief.md`: grid routing is no longer a missing 0.2 item.
- [ ] The four bets plan, as the order plan's section 6 says. Task 2.4: `read` marks a grid's name, and lets "open" and "go to" through when a Declared Grid follows. Task 4.2: routing's frames run before the grammar.
- [ ] `skills/gridcue`, the changelog. `pnpm check:skills`.

### Task 3.8: Evidence for the owner (lead)
- [ ] With the owner's command, one `--live` run on the existing sets with the four grids declared: 0 wrong views, and no drop in exact results against the last recorded run.
- [ ] At the owner's call, a real Host application in a throwaway clone: its grids declared, requests written from its grids before the build is seen. Report wrong views, wrong routes, offers and questions.

### Task 3.9: Review (Opus), gate
- [ ] `pnpm lint` and `pnpm check`. The browser bundle check: nothing from `gridcue/server` is reachable.

## Spec coverage

| Spec section | Tasks |
| --- | --- |
| 4.1 Recognised before any provider | 2.4, 3.3 |
| 4.2 The pending step | 2.4, 3.3 |
| 4.3 Audit events | 2.4, 3.3 |
| 5.1 `proposeView` | 1.1 to 1.5 |
| 5.2 Saved views | 2.2 to 2.9 |
| 5.3 Grid routing | 3.1 to 3.9 |
| 7 ADRs | 0.1 |
| 8 Terms | 0.1 |
| 9 UI design pass | 2.1, 2.7, 3.5 |
| 10 Evidence bars | 1.2, 1.3, 2.5, 2.6, 3.4, 3.8 |
| 11 Surfaces | 1.4, 2.7, 2.8, 3.5, 3.6, 3.7 |
| 15 The four bets | Four bets task 3.1 has nothing left to build (the ledger and the generator exist); task 3.3 drops `proposeView`; task 3.4's guide becomes "Saved views". Tasks 1.4, 2.8 and 3.7 make these edits and the rest of the order plan's section 6 for this work. The owner approved them once (order plan, D2) |
