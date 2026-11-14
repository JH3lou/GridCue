# A Command Bar People Live In: Implementation Plan

Status: approved by the owner on 2026-11-13. Answers in docs/planning/command-bar-grill.md.

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. Each task names the model that runs it and the files it owns. Do not start a task whose "needs" are not done.

**Spec:** `docs/superpowers/specs/2026-11-13-command-bar-design.md`
**Decisions:** `docs/planning/command-bar-grill.md`, Round 1 (Q1 to Q8), as the owner approved them in section 7 of `docs/superpowers/plans/2026-11-13-five-opportunities-order.md` (D37 to D45, and D1 to D5 where they touch this work).

## How the work is run

**Where it sits.** This is the fifth of the five opportunities the owner put ahead of the four bets on 2026-11-13, and it is built last of them (`docs/superpowers/plans/2026-11-13-five-opportunities-order.md`). By then the others have built what this work first planned to build itself: `proposeView` (routing PR 1), the seeded view generator (operation set PR 3), the ledger fixture and the change that makes `buildResolutionRequest` pick its fields (named filters PR 2), the payload pin test (operation set PR 1), the label helpers (routing PR 2), the input's text in the hook (routing PR 3), and the one bar prototype (routing Task 2.1). This work uses each and builds none of them again. The four bets' PRs 2 to 5 come after it and build on it (spec section 15).

**Waves.** The owner's reply on 2026-11-13 was: "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." The order plan's section 1 turns that into waves. The planning record (C0) is in wave 0. The five code PRs (C1 to C5) are wave 6, the last before the four bets. A wave starts only when the one before it is cleared: every PR in it has a green `pnpm check` in CI and no open review comment. Each PR is watched through review and CI.

**In order inside the wave.** The five PRs stack, so they run one after another. Inside each PR the stages are also in order. Between stages the lead checks labels and runs the held-out set, and those checks decide what happens next, so no stage starts before the check ahead of it is done.

**Every PR follows the same five stages.**

1. **Label.** A labeller writes the dev set and the held-out set from the spec section alone, before any code. It never sees the code under test. The lead spot-checks the labels.
2. **Build.** A builder sees the dev set, never the held-out set. It writes tests first, then the code, then both UIs, and runs the gate.
3. **Held-out run.** The lead runs the held-out set once and reports the numbers as they are, misses included. A wrong view sends the work back to the builder as a class, not a sentence. The held-out set then joins the repo as a regression set, and the next round gets a fresh held-out set from a new labeller.
4. **Review.** A reviewer sees the diff and the spec section, and nothing else.
5. **Gate.** `pnpm lint`, then `pnpm check`. Every UI change is checked in a real browser, light and dark, at 1280px and 375px, in the Vite example, the Next.js example and the Site.

**Models, chosen by what a mistake costs.**

| Work | Model | Why |
| --- | --- | --- |
| Splicing a new wording into the User's text, and which answers carry over (PR 3) | Fable | The hardest reasoning here, and a mistake re-proposes a request the User didn't write or keeps an answer to a different question: a wrong view |
| Spans in `normalize`; `edit` and its tie rules; the value reader; typed choices; `countRows` in the Controller; `describeViewParts`; `proposeView`; the starters' core; the TanStack counter; every review | Opus | Parser, compiler, Controller and adapter code with wrong-view risk, on rules the spec states exactly |
| Labelling; the prototype; hooks; both UIs; examples; Site docs; the agent skill | Sonnet | Well-specified work with tests to hold it |
| Changelog lines, docs index entries, link checks | Haiku | Mechanical |

**Branches.** Each PR is a branch stacked on the one before: `feat/edit-preview`, `feat/row-count`, `feat/answer-in-words`, `feat/current-view`, `feat/starters`. The planning record (the grill log, the spec, this plan, the five ADRs, `CONTEXT.md`) is its own small docs PR first, `docs/command-bar-plan`, so each feature PR holds one concern. The owner's reply asks for each PR to be watched, and the order plan's section 1 reads that as asking for the PRs. Merging is the owner's.

**Live runs.** No sub-agent calls Jev. One `--live` run before PR 3 merges waits for the owner's command.

**What the owner sees before code.**

- The prototype of the whole bar (task 0.2), before any component code in PR 1.

The owner approved the five ADRs' decisions on 2026-11-13, with the edits they make to what the four bets approved (order plan D2, D42 and D45). No ADR waits on a further sign-off.

## PR 0: The planning record (`docs/command-bar-plan`)

`docs(planning): command bar spec, plan, and ADRs`. The owner approved the spec and this plan on 2026-11-13. It is step 5 of the order plan (C0), in wave 0. Task 0.1 is the PR. Task 0.2 is not part of it: it runs later, once routing's prototype exists.

### Task 0.1: ADRs and glossary (Sonnet)
**Files:** five new files in `docs/adr/`, `CONTEXT.md`, `docs/planning/command-bar-grill.md` (the owner's answers, verbatim), ADRs 0019, 0021 and 0022, and `docs/superpowers/specs/2026-11-10-four-bets-design.md`.
- [ ] The five ADRs in spec section 7, with the numbers the order plan reserves: 0036 "A User's edit to a Preview is a new plan", 0037 "The Host counts rows, and zero rows is information", 0038 "Every open question shows, and each can be answered in words", 0039 "The current view reads as parts, and each part can be removed through a Preview", 0040 "Recent requests are off unless the Host turns them on".
- [ ] `CONTEXT.md`: Rows Shown (order plan D5), View Part, Starter, and the rewritten Clarification (spec section 8).
- [ ] ADR 0021 gains a line: the current view's parts can be removed through a Preview (ADR 0039). ADRs 0019 and 0022 each gain a line that limits them to the plan a request produced (ADR 0036). Each line goes where the old text covers that point. No second account is added at the end.
- [ ] Four bets spec: line 55 ("Editing the View Sentence in place") says parts of the current view can be removed, and section 7's last row says the Preview panel and the questions change, as this spec's section 9 has them. The owner approved these edits with the others the order plan lists (D2). The `viewSentence` edit to that spec's section 6 is PR 4's (task 4.6).

### Task 0.2: Check the bar prototype (Sonnet)
**Files:** the throwaway HTML page routing's Task 2.1 built, outside the repo. Needs routing's Task 2.1 (order plan step 22), so it runs after wave 5 and before PR 1's component code.
- [ ] Routing's PR 2 built one prototype of the whole bar (order plan). Check it holds every row of spec section 9, and add what is missing. Light and dark, at 1280px and 375px: the current-view line with parts; the hint row with starters, then with status; a Preview with ×s, a tied pair struck through on hover, a value being changed, a refused value, the Rows Shown (counting, 57 of 500, no rows); the questions panel with a part field, a 9-choice question and a 200-choice question narrowed by typing.
- [ ] The four bets' future pieces in the same page: the View Sentence in the first line with ×s on its parts, the underlines, the reading line in the hint row, Tab completion.
- [ ] The owner looks at it. Changes go into spec section 9 before any component code.

## PR 1: Edit a Preview (`feat/edit-preview`)

`feat: edit a Preview before applying it`. Spec 5.1, 9. ADR 0036, "A User's edit to a Preview is a new plan". Needs PR 0 and task 0.2, and routing PR 2, operation set PR 1 and named filters PR 3 (order plan step 24).

### Task 1.1: Label the edit cases (Sonnet, two separate agents)
**Files:** `evals/cases-edit.jsonl`, `evals/values.jsonl`; held-out sets outside the repo.
- [ ] Dev: 40 edit cases (starting view, a plan's operations, one or more edits, the expected view or "refused") and 60 typed values (column, text, the value expected or "refused").
- [ ] Held-out, by a second labeller from spec 5.1 alone: 40 edits and 60 values, at least 10 of each on the ledger fixture.
- [ ] In each set of 40 edits, 10 start from a view with a count, and 5 edit a Preview that holds a House Term's lines or date words.
- [ ] Baseline: today no case can run, since `edit` doesn't exist. Record that, and record which cases a builder would most likely get wrong in the lead's spot-check.

### Task 1.2: `edit`, tie rules, and the value reader (Opus)
**Files:** `packages/gridcue/src/core/controller.ts`, new `core/edit.ts`, `core/errors.ts`, `src/index.ts`, `packages/gridcue/test/edit.test.ts`, an eval runner in `evals/`.
- [ ] Tests first: one per row of the table in spec 5.1, both tie rules in both directions, the last-line rule, each value kind, a stale Revision, and edits that add up.
- [ ] Tests first, for what the earlier opportunities added: no × where dropping a line would trip the operation set's count rule (it calls that rule's own function); a House Term's lines drop together and their values can't change; a line with date words can't change; a relative date typed in a value field is refused; `lineEdits` is `null` for a pending save or grid.
- [ ] `lineEdits` from the plan, the schema and the base view. `edit` builds the new plan, records `source: "user"` evidence, validates it, and renders the Preview again.
- [ ] The value reader: `normalize` on the trimmed text, one Clause, one literal, no comparison, whole text, a kind the column holds. Text values as typed, with the limits in 5.1.
- [ ] `INPUT_UNREADABLE_VALUE` and `INPUT_NOT_EDITABLE`.
- [ ] Bars on the dev sets: 0 wrong views, every tied pair together, every value exact or refused.

### Task 1.3: Both UIs (Sonnet)
**Files:** `react/use-grid-cue.ts`, `react/grid-cue-bar.tsx`, `react/styles.css`, `registry/registry/gridcue/preview-panel.tsx`, `command-bar.tsx`, `registry/registry.json`, `test/command-bar-suite.tsx`. Needs 1.2.
- [ ] `edit` and `lineEdits` on the binding. Behaviour in the hook, look in the components.
- [ ] The line ×, the struck-through tie on hover and focus, the value button, its field or native select, the refused-value line, and focus after an edit, with the exact values in spec section 9.
- [ ] Escape anywhere in the bar cancels; inside a value field it restores first.
- [ ] The shared suite covers each, so both bars pass the same tests.
- [ ] Real-browser check in all three places, light and dark, keyboard only. Before and after screenshots, and a short video of an edit.

### Task 1.4: Docs (Sonnet) and index lines (Haiku)
- [ ] Site: `api/create-grid-cue` (`edit`, `lineEdits`, the two error codes), `api/react`, `components/grid-cue-bar`, `components/command-bar`, `components/preview-panel`, `concepts/pipeline` (an edit is a new plan).
- [ ] `docs/internals/product.md:32`: "applies, edits, or cancels" now says what an edit is.
- [ ] `skills/gridcue`: the check in step 4 adds "drop a Preview line". The changelog. `pnpm check:skills`.

### Task 1.5: Held-out run (lead), review (Opus), gate
- [ ] The held-out edits and values, once. Bars: 0 wrong views; every value exact or refused. Report the share refused.
- [ ] Review against spec 5.1 and 9 only.
- [ ] `pnpm lint`, `pnpm check`.

## PR 2: The Rows Shown (`feat/row-count`)

`feat: the Preview says how many rows it leaves`. Spec 5.2, 9. ADR 0037, "The Host counts rows, and zero rows is information". Needs PR 1, and operation set PR 3 (order plan step 25).

### Task 2.1: The counting sets (Sonnet)
**Files:** seeds for the seeded view generator the operation set's PR 3 built (order plan); held-out seeds outside the repo. This task adds nothing to the generator.
- [ ] Dev: 1,500 views on 500 rows, seed 1. Held-out: 1,500 views, a seed the builder doesn't see.
- [ ] One TanStack case for each condition in spec 5.2 that must return nothing.

### Task 2.2: `countRows` in the Controller (Opus)
**Files:** `core/controller.ts`, `core/words.ts` (new: `rowCountText` only; the rest of the module comes in PR 4), `src/index.ts`, tests.
- [ ] Tests first: a number, a promise, `undefined`, a throw, a rejection, a negative or fractional number, shown above total, a late answer for a replaced plan, the total kept per Revision, and that the Rows Shown reach no provider request, no audit event and no Preview `text`.
- [ ] `countRows` is called after the Preview is set, never before. `rowCount` is set only while a ready plan is shown.
- [ ] Bar on the dev views: exact on every one.

### Task 2.3: `tanstackRowCounter` (Opus)
**Files:** `packages/gridcue/src/tanstack/index.ts`, `test/tanstack.test.ts`.
- [ ] Tests first, against a real TanStack v9 table: each condition that returns nothing, and exact counts on the dev views against TanStack's own filtered row model. A view with a count is capped as the operation set defines it: rows with no value in the first sorted column never fill it.
- [ ] `TanStackTableLike` widens only as far as the counter needs, with a test that the adapter's existing contract suite still passes.

### Task 2.4: Both UIs and both examples (Sonnet)
**Files:** the bar, `styles.css`, `preview-panel.tsx`, `command-bar.tsx`, the shared suite, `examples/next/app/accounts-view.tsx`, `examples/vite/src/App.tsx`, the Site demo. Needs 2.2 and 2.3.
- [ ] `rowCount` on the binding. The Rows Shown line, the held space, "Counting rows…" after 400 ms, and the weight on "No rows match.", with `aria-live="polite"` on the line.
- [ ] The Next.js example passes `countRows` with `applyView`; the Vite example passes `tanstackRowCounter`; the Site demo counts its rows.
- [ ] Real-browser check, light and dark, with a VoiceOver pass on the Rows Shown line. Screenshots.

### Task 2.5: Docs (Sonnet) and index lines (Haiku)
- [ ] Site: `api/create-grid-cue` (`countRows`, `rowCount`, `rowCountText`), `api/adapters` (`tanstackRowCounter` and when it returns nothing), `guides/vite-tanstack`, `guides/next-rows-adapter`, `components/preview-panel`, `safety` (the Rows Shown stay with the Host).
- [ ] `skills/gridcue/references/setup.md`: `countRows` for each adapter as a setup step. The changelog. `pnpm check:skills`.

### Task 2.6: Held-out run (lead), review (Opus), gate
- [ ] The held-out views, once. Bar: exact on every view, `undefined` in every listed condition. Report the cost at 100,000 rows: median and worst over 21 runs.
- [ ] Review against spec 5.2 and 9 only. `pnpm lint`, `pnpm check`.

## PR 3: Every question, answered in words (`feat/answer-in-words`)

`feat: every open question shows, answered by choice or in words`. Spec 4.1, 5.3, 9. ADR 0038, "Every open question shows, and each can be answered in words". Needs PR 2, and routing PR 3 and named filters PR 2 (order plan step 26).

### Task 3.1: Label the question cases (Sonnet, three separate agents)
**Files:** `evals/cases-spans.jsonl`, `evals/cases-answers.jsonl`; held-out sets outside the repo.
- [ ] Spans: the expected span of every Clause for 40 Utterances written for spans (spec section 10). Held-out: 40 more.
- [ ] Typed choices: 40 dev and 40 held-out (question, typed text, choice expected or "stays").
- [ ] New wordings: 40 dev and 40 held-out (request, question, new wording, the spliced request exactly, the plan expected with the Mock Provider).
- [ ] Baseline with today's code: how many questions in the six case files have no choices (161 of 197 at the grill), and how many plans hold more than one.

### Task 3.2: Part spans (Opus)
**Files:** `core/normalize.ts`, `core/resolution.ts`, `test/normalize.test.ts`, new `test/spans.test.ts`.
- [ ] Tests first: borrowed verbs, collapsed spaces, dictated "comma", smart quotes, letter case, kept parts, mid-line splits.
- [ ] `Clause.source = { start, end }` for every Clause, never overlapping, separators left out.
- [ ] `buildResolutionRequest` already picks the fields it sends (named filters PR 2). `source` is not added to them. The payload pin test (operation set PR 1) passes unchanged for every labelled Utterance in `evals/`.
- [ ] Bars: 100% exact spans on the dev set and on every labelled case in `evals/` (813 today, more by then). No eval verdict changes.

### Task 3.3: Typed choices and `state.clarifications` (Opus)
**Files:** `core/controller.ts`, new `core/answers.ts`, `src/index.ts`, tests. Needs 3.2.
- [ ] Tests first: each row of the table in spec 5.3 with choices; one test that reaches every `clarifications.push` in `compile.ts` and checks its ID names a part (all but `plan.empty`).
- [ ] `state.clarifications` with each part's text from its span. `message` unchanged.
- [ ] Questions asked outside the compiler have `part: null`: the operation set's count question, and routing's saved-view and grid questions. A test for each.
- [ ] The "This grid can't …" question (more grids PR 3) names its part and shows with that part's field. A test on a grid that can't group.
- [ ] `answer(id, { text })` on a question with choices: exactly one match by label or alias, or the question stays. Never read as a request.
- [ ] Bar on the dev set: 0 texts taken as a different choice.

### Task 3.4: A new wording of a part (Fable)
**Files:** `core/controller.ts`, `core/answers.ts`, tests. Needs 3.3.
- [ ] Tests first: each row of the table in spec 5.3 without choices, an empty wording for the first, a middle and the last part, a wording that splits into two parts, a provider failure that keeps the old request, and the carry-over rule both ways.
- [ ] The splice on the Utterance as typed, the whole request proposed again, `state.utterance` set to it.
- [ ] Answers carry only with the same part count and the answered part's text unchanged at its index.
- [ ] Bars on the dev set: spliced text exact on all; 0 wrong views.

### Task 3.5: Both UIs (Sonnet)
**Files:** the bar, `styles.css`, `clarification-prompt.tsx`, `command-bar.tsx`, the shared suite. Needs 3.3 and 3.4.
- [ ] The input's text is already in the hook (`text`, `setText`, from routing's PR 3). A new wording shows through it in both UIs.
- [ ] The questions panel, choices with a field, narrowing past 8 choices, the part field, the status line without the prompt, and focus as in spec section 9.
- [ ] `ClarificationPrompt` renders every kind of question; it no longer returns nothing for a question without choices.
- [ ] Real-browser check, light and dark, keyboard only and with VoiceOver. Screenshots and a short video.

### Task 3.6: Docs (Sonnet) and index lines (Haiku)
- [ ] Site: `api/create-grid-cue` (`answer` both ways, `clarifications`), `api/react` (`text`, `setText`), `components/clarification-prompt`, `components/command-bar`, `components/grid-cue-bar`, `concepts/requests` (how questions are asked and answered), `api/protocol` (`Clause.source` is not sent).
- [ ] `docs/internals/product.md:111` rewritten as spec 5.3 says.
- [ ] Four bets plan: task 2.3 changes as the order plan's section 6 says (`Clause.source` holds each part's span, and the task adds the character map under it).
- [ ] `skills/gridcue`, the changelog, `pnpm check:skills`.

### Task 3.7: Held-out run (lead), the real Host application, review (Opus), gate
- [ ] The three held-out sets, once. Bars: 100% spans; 0 typed choices taken as another; spliced text exact and 0 wrong views. Report the share answered and the exact and safe-miss counts.
- [ ] The real Host application, in a throwaway clone: its 209 requests give the same plans, and its questions with no choices now show.
- [ ] One `--live` run on the owner's command: the payload is unchanged and the held-out new wordings give no wrong view with Jev.
- [ ] Review against spec 4.1, 5.3 and 9 only. `pnpm lint`, `pnpm check`.

## PR 4: The current view (`feat/current-view`)

`feat: the bar shows the current view, and each part can be removed`. Spec 4.2, 4.3, 5.4, 9. ADR 0039, "The current view reads as parts, and each part can be removed through a Preview". Needs PR 3, and routing PR 1 (order plan step 27).

### Task 4.1: Label the parts (Sonnet)
**Files:** `evals/cases-parts.jsonl`; held-out set outside the repo.
- [ ] 30 dev views and 30 held-out views, each with its parts' labels and `without` views, including "or" filters, nested groups, a count, reordered columns and pinned columns.

### Task 4.2: The words module (Opus)
**Files:** `core/words.ts`, `core/preview.ts`, tests.
- [ ] The Preview's words and `formatValue` move into `core/words.ts`. A test pins every Preview line produced by the evals to its text before the move.

### Task 4.3: `proposeView`, checked (Opus)
**Files:** tests only.
- [ ] Routing's PR 1 built `proposeView` and its property test (order plan). Check it against four bets spec 5.3. Build nothing.
- [ ] Add the removal tests: for every View Part of the generator's views, `proposeView(part.without)` applied gives exactly `without`, or is unsupported. Two seeds; the lead draws the second after the build.

### Task 4.4: `describeViewParts` and `state.viewParts` (Opus)
**Files:** new `core/parts.ts`, `core/controller.ts`, `src/index.ts`, tests. Needs 4.2 and 4.3.
- [ ] Tests first: each kind of part, its label, its `without`, and each case with no ×.
- [ ] `viewParts` computed once per Revision, following the User's own changes.
- [ ] On a view with a count, removing the sort or a filter asks the operation set's count question first, and each answer is a whole view proposed through `proposeView`. The owner approved this (order plan D43). Dev and held-out sets of 20 views each, labelled first. Bar: no removal changes which rows a count keeps without a question or a Preview line that says so.
- [ ] Bar on the dev set and on random views: `proposeView(part.without)` applied gives exactly `without`, or is unsupported.

### Task 4.5: Both UIs (Sonnet)
**Files:** the binding (`removeViewPart`), the bar (`currentView` prop), `styles.css` (`--gridcue-part`), new `registry/registry/gridcue/view-parts.tsx`, `command-bar.tsx`, `registry/registry.json`, the shared suite. Needs 4.4.
- [ ] The current-view line, parts, ×s and focus after a removal, with the exact values in spec section 9.
- [ ] Both examples show the line; a header click in each updates it.
- [ ] Real-browser check, light and dark, at 375px with many parts wrapping. Screenshots.

### Task 4.6: Docs (Sonnet) and index lines (Haiku)
- [ ] Site: `api/create-grid-cue` (`proposeView`, `viewParts`, `INPUT_INVALID_VIEW`), `api/react`, a new `components/view-parts` page, `components/grid-cue-bar`, `concepts/views`.
- [ ] Four bets spec, section 6: the `viewSentence` prop and `view-sentence.tsx` give way to `currentView` and `view-parts.tsx` (order plan section 5). Four bets plan: tasks 3.2 and 3.4 change as the order plan's section 6 says (`core/words.ts` and `describeViewParts` exist; the sentence shows in the current-view line).
- [ ] `skills/gridcue`, the changelog, `pnpm check:skills`.

### Task 4.7: Held-out run (lead), review (Opus), gate
- [ ] The held-out parts set and the second `proposeView` seed, once. Bar: never a different view. Report the share of parts with no ×.
- [ ] Review against spec 4.2, 4.3, 5.4 and 9 only. `pnpm lint`, `pnpm check`.

## PR 5: Starters (`feat/starters`)

`feat: starters at an empty input`. Spec 5.5, 9. ADR 0040, "Recent requests are off unless the Host turns them on". Needs PR 4.

### Task 5.1: Label the schema starters (Sonnet)
- [ ] For the wealth schema and the ledger fixture: the starters expected from the default view and from 20 random views, with the view each should give. The lead draws 20 more views after the build, for the held-out run.

### Task 5.2: Starters and recent requests in core (Opus)
**Files:** new `core/starters.ts`, `core/controller.ts`, `src/index.ts`, tests.
- [ ] Recent requests are off unless the Host sets `recent: true` or passes a store (order plan D45), which is what `AGENTS.md` asks for raw Utterances. With no `recent` option, no Utterance is kept.
- [ ] Tests first: the order, the limit of five, duplicates left out, an edited plan, a `proposeView` plan, a save and a grid offer not recorded, no `recent` option (nothing kept), `recent: true`, `recent: false`, the Host's `initial` and `onChange`, and storage spied on.
- [ ] Schema starters as View States through `proposeView`, left out when the view already has them.
- [ ] Bar: each applied starter's view is what its label says, on both schemas.

### Task 5.3: Both UIs, the examples and the Site demo (Sonnet)
**Files:** the binding (`pickStarter`), the bar (`starters` prop), `styles.css`, new `registry/registry/gridcue/starters.tsx`, `command-bar.tsx`, `registry/registry.json`, the shared suite, both examples, `apps/site/app/components/demo/ask-bar.tsx`, `apps/site/app/routes/demo.tsx`.
- [ ] The hint row: starters at an empty input with focus in the bar, the status otherwise, the live region always mounted.
- [ ] Both examples pass `examples`. The Site demo passes its requests and drops its own chips. The test that each gives the plan its comment promises exists already (named filters PR 3); point it at the `examples`. Four bets 5.4 later runs the same test on the Local Resolver.
- [ ] Real-browser check, light and dark, keyboard only. Screenshots.

### Task 5.4: Docs (Sonnet) and index lines (Haiku)
- [ ] Site: `api/create-grid-cue` (`examples`, `recent`, `starters`), `api/react`, a new `components/starters` page, `safety` (recent requests are off unless the Host turns them on, and GridCue never writes them to browser storage), `get-started/describe-your-domain` (writing good examples).
- [ ] Four bets plan: tasks 2.5 and 4.5 change as the order plan's section 6 says (the hint row exists; the demo's chips are the package's starters).
- [ ] `skills/gridcue`: `examples` as a setup step. The changelog. `pnpm check:skills`.

### Task 5.5: Review (Opus), gate
- [ ] Review against spec 5.5 and 9 only. `pnpm lint`, `pnpm check`, including the browser bundle check.

## Spec coverage

| Spec section | Tasks |
| --- | --- |
| 4.1 Part spans | 3.1, 3.2 |
| 4.2 Words in one module | 2.2 (`rowCountText`), 4.2 |
| 4.3 `proposeView` | 4.3 |
| 5.1 Edit a Preview | 1.1 to 1.5 |
| 5.2 The Rows Shown | 2.1 to 2.6 |
| 5.3 Every question | 3.1 to 3.7 |
| 5.4 The current view | 4.1 to 4.7 |
| 5.5 Starters | 5.1 to 5.5 |
| 7 ADRs, 8 Terms | 0.1 |
| 9 UI design pass | 0.2, 1.3, 2.4, 3.5, 4.5, 5.3 |
| 10 Evidence bars | 1.2, 1.5, 2.2, 2.3, 2.6, 3.2 to 3.4, 3.7, 4.3, 4.4, 4.7, 5.2 |
| 11 Surfaces | 1.3, 1.4, 2.4, 2.5, 3.5, 3.6, 4.5, 4.6, 5.3, 5.4 |
