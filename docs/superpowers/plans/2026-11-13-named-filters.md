# Filters for People, Dates, and House Terms: Implementation Plan

Status: approved by the owner on 2026-11-13. Answers in docs/planning/named-filters-grill.md.

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. Each task names the model that runs it and the files it owns. Do not start a task whose "needs" are not done.

**Spec:** `docs/superpowers/specs/2026-11-13-named-filters-design.md`
**Decisions:** `docs/planning/named-filters-grill.md`, Round 1 (Q1 to Q8) with its fact check and the owner's answers, and ADRs 0023 to 0026.

## How the work is run

**Sub-agents, not a fixed script.** The five PRs stack, so they run one after another. Inside each PR the stages are in order, and between stages the lead reads the labels and the held-out numbers to decide what happens next.

**Every PR follows the same five stages.**

1. **Label.** A labeller writes the dev set and the held-out set before any code. It never sees the code under test. A form set is written from the spec section. A natural set is written by a separate labeller who sees only `docs/internals/product.md` and the schema, not the forms. The lead spot-checks the labels.
2. **Build.** A builder sees the dev set, never the held-out set. Tests first, then code, then the gate.
3. **Held-out run.** The lead runs each held-out set once and reports the numbers as they are, misses included. A wrong view goes back to the builder as a class, not as the failing sentence. The held-out set then joins the repo as a regression set, and the class gets a fresh held-out set for the next round. From the second round on, the builder may only narrow: ask, or keep what today's code reads, and add no new reading.
4. **Review.** An independent reviewer sees the diff and the spec section, and nothing else. It hunts for wrong views with its own probes.
5. **Gate.** `pnpm lint`, then `pnpm check`. PRs that change what a User reads are also checked in a real browser, light and dark.

**Models, chosen by what a mistake costs.**

| Work | Model | Why |
| --- | --- | --- |
| The placed-words rule; what counts as naming a Local Value (whole value, longest name, ties, one word); the limit on a provider's picks; date arithmetic and whole days | Fable | The hardest reasoning here. Each is a rule that reads requests or picks rows, and a mistake is a wrong view |
| `normalize`, Mentions, the compiler, ADR 0019's check, the Controller, `defineSchema`, `evaluate`, both Grid Adapters; every review | Opus | Subtle code with wrong-view risk, on rules the spec fixes |
| Labelling; the ledger fixture; the examples; the Site docs and demo; the agent skill; browser checks | Sonnet | Well-specified work with tests or a table to hold it |
| ADR files from the spec's text, `CONTEXT.md` lines, changelog lines, link checks | Haiku | Mechanical |

**Branches.** Each PR is a branch stacked on the one before it in the order plan, and all of them on PR #21 (`fix/reading-wrong-views`) until it merges. Merging is the owner's. Where each PR sits among the other opportunities' PRs is in `docs/superpowers/plans/2026-11-13-five-opportunities-order.md`: PR 1 is the first code PR of all, and PR 2 to PR 5 follow the other opportunities' fixes. The owner approved that order as D1. That plan also names the pieces this work owns for the others: the ledger fixture, the change that makes `buildResolutionRequest` pick its fields, the Preview-line pin test, the Site-suggestions test, and the first cases of the shared rendered-rows test.

| Order | Branch | Title | Needs |
| --- | --- | --- | --- |
| 0 | `docs/named-filters-plan` | `docs(planning): filters for people, dates and house terms: spec, plan, ADRs` | The owner's answers, given on 2026-11-13 |
| 1 | `fix/quoted-text-and-date-wrong-views` | `fix(core): quoted text and dates ask where GridCue can't be sure` | 0, and PR #21 |
| 2 | `feat/text-forms` | `feat(core): read "starts with", "exactly" and empty` | 1, and the operation set's PR 1 (the payload pin test and `core/view-words.ts`) |
| 3 | `feat/house-terms` | `feat(core): a Host can declare house terms` | 2 |
| 4 | `feat/local-values` | `feat(core): read a grid's own names in the browser` | 3 |
| 5 | `feat/relative-dates` | `feat(core): read relative dates and date ranges` | 4 |

PR 0 holds the grill log, this plan, the spec, ADRs 0023 to 0026, and the `CONTEXT.md` terms, so each code PR holds one concern. The order plan merges with it. The owner's reply of 2026-11-13 was: "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." The order plan reads it as asking for the PRs, each watched through review and CI, in waves. PR 0 is in wave 0, PR 1 in wave 1, and PR 2 to PR 5 are wave 2. A wave starts only when every PR in the one before it has a green `pnpm check` in CI and no open review comment. House Terms come before Local Values, as the order plan has them; saved views need both.

**Live runs.** No sub-agent calls Jev. One live run before each of PR 1 to PR 5 merges waits for the owner's command. Bar: 0 wrong views, and no drop in exact results against the last recorded run.

**Shared files.** Other opportunities are planned at the same time. These files are likely to be touched by them too, so each PR rebases before its gate and the lead re-runs every set after a rebase: `core/compile.ts`, `core/normalize.ts`, `core/mentions.ts`, `core/lead.ts`, `core/unused.ts`, `core/preview.ts` (or `core/words.ts` once it exists), `core/schema.ts`, `core/protocol.ts`, `core/validate.ts`, `core/evaluate.ts`, `core/controller.ts`, `tanstack/index.ts`, `test/adapter-contract.ts`, `evals/run.ts`, `fixtures/`.

## PR 0: The planning record (`docs/named-filters-plan`)

### Task 0.1: ADRs and terms (Haiku, then the lead reads them)
- [x] The four ADRs, with the numbers the order plan reserves: 0023 "Beside a code-read filter, every word is placed", 0024 "House Terms", 0025 "GridCue reads Local Values in the browser", 0026 "A date in a request becomes fixed days".
- [x] The spec and this plan name each ADR by its number.
- [x] The grill log holds the owner's answers, and the lead's trim of the week forms as the lead's reading.
- [ ] `CONTEXT.md`: add Local Value, House Term and Calendar; add one sentence to Mention (spec section 8). The lead makes this edit, since all five planning records change that file.
- [ ] No other approved document changes in this PR. The four bets spec's line 56 changes in PR 2 (Task 2.6). `docs/internals/product.md` changes in PR 3 and PR 4, and the Site's `safety` page in PR 4 (Tasks 3.6 and 4.6). The owner signed those edits off as D2 (order plan, section 5).

## PR 1: Fixes (`fix/quoted-text-and-date-wrong-views`)

Spec 5.1. No ADR: every fix asks, and none adds a reading.

### Task 1.1: Label the fix cases (Sonnet)
**Files:** new `evals/cases-named-fixes.jsonl`; a held-out set outside the repo.
- [ ] Dev, at least 30: quoted text beside each negation and beside "starts with", "ends with", "exactly", `=`; the Row Noun before "for"; a date against a date-and-time column; a date that is not a real day; and 10 controls that must stay exact (`containing`, `is`, `:`, "like", "non-retirement … containing"). Date cases use the inline dated schema in `test/reading-fixes.test.ts`, plus one date-and-time column.
- [ ] Held-out, at least 30 of the same kinds, written from spec 5.1 alone.
- [ ] Baseline with the Mock Provider on both, before any code. Today's wrong views are expected; record them.

### Task 1.2: The fixes (Opus)
**Files:** `core/compile.ts`, `core/mentions.ts`, `core/normalize.ts`, new `test/named-fixes.test.ts`, `evals/evals.test.ts`, `CHANGELOG.md`.
- [ ] Tests first, one group per row of the table in spec 5.1, plus the controls.
- [ ] Quoted text is "containing" only after the words the spec lists. Any other word between a column and quoted text asks.
- [ ] A negation that belongs to no named value asks when the part holds quoted text.
- [ ] The grid's own Row Noun before "for" is the rows. No other name changes.
- [ ] A date for a date-and-time column asks. A date that is not a real day asks.
- [ ] The question for quoted text with no column says "contain".
- [ ] `cases-named-fixes.jsonl` in the gate. Bars: 0 wrong views on the dev set; the 23 quoted-text cases exact; no existing verdict worse.

### Task 1.3: Held-out run (lead)
- [ ] One run. Report exact, safe misses and wrong views, and how many requests that are ready today now ask. Bar: 0 wrong views. A wrong view goes back as a class, with a fresh held-out set.
- [ ] The set joins the repo as `evals/cases-named-fixes-heldout.jsonl`.

### Task 1.4: Docs (Sonnet), review (Opus), gate
- [ ] Site: `concepts/requests` (which words make quoted text "containing"; what asks). Changelog (Haiku).
- [ ] The reviewer hunts for quoted text that still becomes "containing" beside a word GridCue didn't read.
- [ ] One live run, on the owner's command. `pnpm lint`, `pnpm check`.

**Owner sees before code:** nothing new. Every change is a question in the existing UI.

## PR 2: Text forms (`feat/text-forms`)

Spec 4.1, 4.2, 4.4, 4.6, 5.2, and the PR 2 rows of section 9. ADR 0023.

### Task 2.1: The ledger fixture (Sonnet)
**Files:** new `fixtures/ledger/`, `evals/run.ts`.
- [ ] A ledger schema from spec 4.6 alone, with seeded synthetic rows: two text columns of names, a date column, a date-and-time column, a number, a currency, a percent, a category and a yes/no column.
- [ ] `evals/run.ts` runs a case file against the schema it names. This PR owns the ledger (order plan). More grids, the operation set, routing, the command bar and the four bets reuse it and add no second schema of their own.

### Task 2.2: Label the text-form cases (Sonnet, two separate agents)
**Files:** new `evals/cases-text-forms.jsonl`, new `evals/cases-not-requests.jsonl`; held-out sets outside the repo.
- [ ] Form dev set, 40, on both schemas: each form in spec 5.2, each with a filter beside it, and each on a column kind that must ask.
- [ ] Form held-out set, 40, from spec 5.2 alone.
- [ ] Not-a-request sets, 20 dev and 20 held-out: sentences that hold an empty form or a text form and are not view requests ("there is no advisor I trust"). Labelled ask or refused.
- [ ] Natural held-out set, 30, by the second labeller, who sees only the product definition and the two schemas.
- [ ] Provider-pick sets, 20 dev and 20 held-out: requests that hold a code-read filter, each with a scripted provider answer that proposes a sort, a column or a value for words the filter took. Written before the code. Each of PR 3 to PR 5 adds 10 to both.
- [ ] Baseline with the Mock Provider on all of them, before any code.

### Task 2.3: Every word is placed (Fable)
**Files:** new `core/placed.ts`, `core/lead.ts`, tests.
- [ ] Tests first: each kind of placed word in spec 4.2; each word the spec names as off the list; a verb for columns with and without a column as its object, and with a column but no column change in the plan ("pin advisor for Avery Lane's accounts"), which must ask.
- [ ] One pure function that returns the unplaced words of a part, given its names, literals and code-read filters. The lists live in this module and nowhere else, except the operation set's form words, which it imports from `core/view-words.ts`.
- [ ] The limit on a provider's picks in a part that passed: a column or value no Mention names is dropped; a sort, group, show or hide needs its own words. Tests use a fake provider.
- [ ] In the compiler, a part with no code-read filter never reaches this function. A test runs every existing labelled request through the compiler and finds the function is not called. Task 2.5's report calls it from `evals/`, outside the compiler, so the report can't change a result.

### Task 2.4: The forms (Opus)
**Files:** `core/normalize.ts`, new `core/code-read.ts`, `core/compile.ts`, `core/resolution.ts`, `core/unused.ts`, `core/preview.ts`, `index.ts`, tests. Needs 2.3.
- [ ] Tests first, one per row of both tables in spec 5.2, and each form with one extra word, which must ask.
- [ ] `Literal.match` for "starts with" and "exactly". `readCodeFilters` with the empty forms.
- [ ] `buildResolutionRequest` picks the fields it sends, so `Literal.match` is not sent. The payload pin test from the operation set's count fix passes unchanged. The command bar and the four bets reuse this and don't repeat it.
- [ ] The compiler writes `startsWith`, `eq`, `isEmpty` and `isNotEmpty`, only where the column's kind and the Host's `allowedOperators` allow.
- [ ] ADR 0019's check counts both forms. The expected-plan test: 0 blocked.
- [ ] The Preview lines in spec section 9 for exact text and the two empty filters. A test pins every Preview line the evals produce before the change, and lists each one that changes. This PR owns that pin test; later PRs update it and say what changed.
- [ ] PR 1's "I'm not sure how to match" question no longer fires for the forms now read.
- [ ] Bars: 0 wrong views on the dev sets and on every existing set; no existing verdict worse.

### Task 2.5: Held-out run (lead)
- [ ] One run of each held-out set. Bar: 0 wrong views on all of them; none of the not-a-request sentences is ready; no provider pick the words don't name survives.
- [ ] A wrong view in the natural set from a word nothing reads, in a part with no code-read filter, still fails the bar. It goes back as a class and is narrowed to a question; no reading is added (order plan, D4).
- [ ] Report the form set's exact share, the natural set's ask rate, and each word that was unplaced in a request labelled ready.
- [ ] Report how many ready plans on every set, old and new, hold a word the lists don't place, whether or not the part holds a code-read filter (order plan, D4). No bar; the number says how large the class left for the Local Resolver is. The report runs in `evals/`, not in the compiler.
- [ ] The sets join the repo.

### Task 2.6: Docs and skill (Sonnet)
- [ ] Site: `concepts/requests` (the four forms, what "empty" means, what asks), `api/schema` (`allowedOperators` turns a form off), `guides/build-an-adapter` (empty, and exact text without letter case).
- [ ] The four bets spec (`docs/superpowers/specs/2026-11-10-four-bets-design.md`), line 56: "starts with", empty and not empty leave the list of what a request can't reach. OR filters stay on it. This edit lands here, not in PR 0 (order plan, section 5; signed off as D2). The operation set's PRs change the same line later for pins, density and totals.
- [ ] `skills/gridcue`: the forms, and a House Term as the way to name a placeholder such as "Unassigned" once PR 3 lands. `pnpm check:skills`. Changelog (Haiku).

### Task 2.7: Review (Opus), then gate
- [ ] The reviewer hunts for a part with a form that is ready with a word GridCue didn't place.
- [ ] One live run, on the owner's command. `pnpm lint`, `pnpm check`.

**Owner sees before code:** the words table in spec section 9. It covers PR 2 to PR 5.

## PR 3: House Terms (`feat/house-terms`)

Spec 4.3, 4.5, 5.3. ADR 0024.

### Task 3.1: Declare the terms, then label (lead, then Sonnet, two separate agents)
**Files:** new `evals/cases-house-terms.jsonl`; held-out sets outside the repo.
- [ ] The lead declares three terms on each schema before any labelling: one comparison, two conditions, and one empty or exact-text condition.
- [ ] Form dev set, 40, both schemas: a term alone, beside values and amounts, beside another change, left out, in a column slot, with "or", and next to a size word.
- [ ] Form held-out set, at least 40, both schemas, from spec 5.3 alone. Natural held-out set, 30. Not-a-request sentences: 10 more for each of the two sets from Task 2.2.
- [ ] Baseline with the Mock Provider, before any code.

### Task 3.2: `houseTerms` in the View Schema (Opus)
**Files:** `core/protocol.ts`, `core/schema.ts`, `core/validate.ts`, `index.ts`, `test/schema.test.ts`.
- [ ] Tests first: every way a term can be wrong in spec 5.3, and each name collision.
- [ ] `SchemaOptions.houseTerms`, `ViewSchema.houseTerms`, `HouseTerm`. The name is `houseTerms` because the root entry already exports `unknownTerm` (order plan, D5). `defineSchema` checks each condition with validation's own value check.
- [ ] `buildCandidates` and `describeProviderPayload` are unchanged; a test pins both.

### Task 3.3: Reading a term (Opus)
**Files:** `core/code-read.ts`, `core/compile.ts`, `core/unused.ts`, `core/preview.ts`, `core/controller.ts`, tests. Needs 3.2.
- [ ] Tests first, one per row of the table in spec 5.3.
- [ ] A term is a code-read filter: each condition a filter, `host` evidence with the term's label, and the label in brackets on each Preview line.
- [ ] A left-out term and a term where a column goes ask.
- [ ] The request is built before terms are looked at. The request-equality test of spec 4.3 over every labelled request: the operation set's payload pin test, run with the terms declared and without. No second pin test is built.
- [ ] Fake-provider tests: a sort, a column and a value proposed for the term's word are each dropped.

### Task 3.4: Nothing old changes (lead)
- [ ] Every existing labelled request with the terms declared: the same verdict and operations. Bar: 0 changes.
- [ ] If it holds, the wealth fixture declares Large and Needs attention. If not, the terms stay in the eval schema and the Site demo declares its own.

### Task 3.5: Held-out run (lead)
- [ ] One run of each set. Bar: 0 wrong views. Report the exact share, the natural set's ask rate, and how often a term was left out. The sets join the repo.

### Task 3.6: Examples, Site, skill (Sonnet)
- [ ] Both examples use the fixture's terms. The Site demo suggests "large taxable accounts".
- [ ] A test resolves every request the Site demo suggests, with the demo's provider, and checks the plan its comment promises. No test does this today (`apps/site/app/routes/demo.tsx:18`). The command bar's starters and the four bets reuse it.
- [ ] Site: `api/schema` (`houseTerms`), `get-started/describe-your-domain` (a "House terms" section), `concepts/requests`, `safety` (terms are not sent). `docs/internals/product.md` and `intent-protocol.md`: the "large" and "big" paragraphs now point to House Terms.
- [ ] `skills/gridcue`: when to declare a term, and that its names must be its own. `pnpm check:skills`. Changelog (Haiku).
- [ ] Browser check of the bracketed Preview lines in both UIs, light and dark.

### Task 3.7: Review (Opus), then gate
- [ ] The reviewer hunts for a term's word that also changes something else in the plan.
- [ ] One live run, on the owner's command. `pnpm lint`, `pnpm check`.

## PR 4: Local Values (`feat/local-values`)

Spec 4.3, 5.4. ADR 0025.

### Task 4.1: Label the name cases (Sonnet, three separate agents)
**Files:** new `evals/cases-names.jsonl`; held-out sets outside the repo.
- [ ] Form dev set, 60, both schemas: whole values in each position, lists, a value beside other filters and other changes, one word of a value, ties with a declared name, a value where a column goes, a value left out, and refused requests that hold a value.
- [ ] Two form held-out sets of at least 60, one for each schema, each by its own labeller, from spec 5.4 alone.
- [ ] Natural held-out set, 30. Not-a-request sentences: 10 more for each set from Task 2.2 ("Avery Lane called about the trust accounts").
- [ ] Baseline with the Mock Provider and no `localValues`, before any code.

### Task 4.2: The value index and what counts as a name (Fable)
**Files:** new `core/local-values.ts`, tests.
- [ ] Tests first: a whole value with other letter case and punctuation; no plural; the longest name; a value inside a longer value; an amount inside a value; a value made only of GridCue's own words; a value two columns hold; a value that is also a declared name; one word of one, five and six values; a word that is a declared name.
- [ ] A word index built once for each column's values. Bars on 50,000 distinct names: built in at most 250 ms, a request looked up in at most 5 ms. Report both at 1,000 and 10,000.
- [ ] One pure function from a part and the indexes to whole-value hits, ties and one-word hits, each with its span.

### Task 4.3: The Controller and the compiler (Opus)
**Files:** `core/controller.ts`, `core/code-read.ts`, `core/compile.ts`, `core/unused.ts`, `core/errors.ts`, `index.ts`, tests. Needs 4.2.
- [ ] Tests first: each `INPUT_CONFIG` case; `INPUT_LOCAL_VALUES` when a function throws; the index kept for the same array and rebuilt for a new one; one test per row of the table in spec 5.4; each question, each answer and "None of these".
- [ ] `GridCueOptions.localValues`. The request is built before values are looked at.
- [ ] The request-equality test with `localValues` on and off, over every labelled request, again as a run of the operation set's payload pin test. A test that the provider is called once whether or not a value matched.
- [ ] A whole value is an exact filter in the grid's letter case; several make one `in` filter.
- [ ] Every existing labelled request with the fixture's values on: the same verdict and operations.

### Task 4.4: The TanStack Table helper (Opus)
**Files:** `tanstack/index.ts`, `test/tanstack.test.ts`.
- [ ] `localValuesFromTable(table, columnIds)` reads every loaded row, whatever filters the table has. A test filters the table and still finds a hidden row's value.

### Task 4.5: Held-out run and the real Host test (lead)
- [ ] One run of each held-out set. Bar: 0 wrong views. Report the exact share, the natural set's ask rate, how often the one-word question fired, and with how many choices. The sets join the repo.
- [ ] A real Host application, in a throwaway clone, with `localValues` on its name columns. Report counts only, with no value written down: values that are also a declared name, values made only of GridCue's own words, and how often the one-word question fires on its earlier request set. Its own tests pass unchanged.

### Task 4.6: Examples, Site, skill (Sonnet)
- [ ] The Next.js example passes `localValues` from its rows. The Vite example uses `localValuesFromTable`. The Site demo reads its rows' names and suggests "Avery Lane's accounts".
- [ ] Site: `api/create-grid-cue` (`localValues`, `INPUT_LOCAL_VALUES`), `api/adapters` (`localValuesFromTable`), `safety` (read in the browser, never sent; what the Utterance still carries), `get-started/describe-your-domain`, `guides/vite-tanstack`, `guides/next-rows-adapter`, `concepts/requests`. `docs/internals/product.md` and `architecture.md`: the distinct-value resolver paragraph and the payload list.
- [ ] `skills/gridcue`: `localValues` for each adapter, which columns to name, and a paged grid's own list. `pnpm check:skills`. Changelog (Haiku).
- [ ] Browser check in the Vite example, the Next.js example and the Site, light and dark: six choices with long names at 320 px wide, and keyboard order through them. Screenshots.

### Task 4.7: Review (Opus), then gate
- [ ] The reviewer hunts two things: a request whose provider payload differs with `localValues` on, and a ready plan from a sentence that is not a view request.
- [ ] One live run, on the owner's command. `pnpm lint`, `pnpm check`, and the browser bundle check.

## PR 5: Dates (`feat/relative-dates`)

Spec 4.5, 5.5. ADR 0026.

### Task 5.1: Label the date cases (Sonnet, two separate agents)
**Files:** new `evals/cases-dates.jsonl`; held-out sets outside the repo; a reference day counter in `evals/`.
- [ ] Form dev set, 60, on the ledger with a fixed clock: each form in spec 5.5, with and without a column named, after the Row Noun, beside other filters, on the date-and-time column, and each wording that must ask, "this week" and "last week" among them.
- [ ] Form held-out set, at least 60, from spec 5.5 alone, with the same fixed clock. Natural held-out set, 30. Not-a-request sentences: 10 more for each set from Task 2.2.
- [ ] The expected dates for every form on a month end, a leap day, a year end, the first day of a quarter and both clock-change days, in the six time zones of spec section 10. Written by hand from the spec's table.
- [ ] A reference day counter for the property tests, written by this labeller and not shown to the builder.

### Task 5.2: Date arithmetic and whole days (Fable)
**Files:** new `core/dates.ts`, tests.
- [ ] Tests first: the labelled table from 5.1; today in a zone either side of midnight; a cell's day for a date string, a `Date`, a string with an offset and a string with none; an unreadable cell.
- [ ] Today from a clock and a time zone. Each form to its dates, on calendar days only. A cell to its day.
- [ ] Property tests against the reference counter: 1,000 random days, and 2,000 random instants in six zones, fixed seeds. Bar: every date equal, 0 rows differ.

### Task 5.3: The reader, the column and the Preview (Opus)
**Files:** `core/protocol.ts`, `core/schema.ts`, `core/normalize.ts`, `core/mentions.ts`, `core/code-read.ts`, `core/compile.ts`, `core/unused.ts`, `core/preview.ts`, `core/controller.ts`, `core/errors.ts`, `index.ts`, tests. Needs 5.2.
- [ ] Tests first, one per row of both tables in spec 5.5.
- [ ] `calendar` in the schema, holding `timeZone` and `fiscalYearStart` and nothing else, with its checks. `now` on the Controller; a `now` that throws stops the request with `INPUT_CLOCK` (order plan, D5). `normalize(text, { today, calendar })`; with no `today`, relative forms ask.
- [ ] Ranges of two ISO dates. `Literal.words`.
- [ ] A date column named right before a date form keeps its name after the Row Noun or a value.
- [ ] Every other time word asks, "this week" and "last week" included. A grid with no date column asks.
- [ ] The Preview's date words, the bracketed words and the whole-days note. Each test that pinned the old date wording is listed in the PR.
- [ ] Every existing labelled request with a calendar set: the same verdict and operations.

### Task 5.4: Filtering by whole days (Opus)
**Files:** `core/evaluate.ts`, `tanstack/index.ts`, `test/adapter-contract.ts`, new `test/rendered-rows.ts`, tests. Needs 5.2.
- [ ] Tests first: the contract suite gains date, date-and-time and `Date`-object filters in its state checks. A new shared test, `test/rendered-rows.ts`, builds both Grid Adapters on the same rows and View State and compares the rows each keeps. This PR starts it with the whole-day, empty and exact-text cases; the operation set's PR 3 adds groups, order and totals.
- [ ] `matchesPredicate` takes the time zone. `matchesFilter` reads it from the schema. The TanStack Table adapter stores it beside the column's kind.
- [ ] PR 1's question for date-and-time columns is removed, with its tests turned into ready cases.
- [ ] Report the time to filter 50,000 date-and-time rows.

### Task 5.5: Held-out run (lead)
- [ ] One run of each set, with the fixed clock. Bar: 0 wrong views. Report the exact share, the natural set's ask rate, and which unlisted date wording turned up most. The sets join the repo.

### Task 5.6: Fixture, examples, Site, skill (Sonnet)
- [ ] The wealth fixture gains an Opened date and a Last contact column if every existing labelled request stays the same. Otherwise both examples add a small ledger table.
- [ ] Both examples and the Site demo resolve "opened in the last 90 days" and show the dates.
- [ ] Site: `api/schema` (`calendar`), `api/create-grid-cue` (`now`), `concepts/requests` (the forms, and what asks), `concepts/views` (a view keeps fixed dates), `guides/going-to-production` (set `timeZone` when rows render on a server), `guides/build-an-adapter` and `guides/build-a-provider` (whole days). `docs/internals/architecture.md`: the dates line.
- [ ] `skills/gridcue`: `calendar`, and when to set `timeZone`. `pnpm check:skills`. Changelog (Haiku).
- [ ] Browser check in both examples and the Site, light and dark: a two-filter date Preview with its note. Screenshots.

### Task 5.7: Review (Opus), then gate
- [ ] The reviewer hunts for a date off by one day: either side of midnight, on a clock-change day, and with a fiscal year start.
- [ ] One live run, on the owner's command. `pnpm lint`, `pnpm check`.

## Spec coverage

| Spec section | Tasks |
| --- | --- |
| 4.1 Code-read filters | 2.4, 3.3, 4.3, 5.3 |
| 4.2 Every word is placed | 2.2, 2.3, 2.5, and the not-a-request sentences in 3.1, 4.1, 5.1 |
| 4.3 The provider request does not change | 3.3, 4.3, 4.7 |
| 4.4 ADR 0019's check | 2.4, 3.3, 4.3, 5.3 |
| 4.5 Where a filter came from | 3.3, 5.3 |
| 4.6 A second schema | 2.1 |
| 5.1 Fixes | 1.1 to 1.4 |
| 5.2 Text forms | 2.2 to 2.7 |
| 5.3 House Terms | 3.1 to 3.7 |
| 5.4 Local Values | 4.1 to 4.7 |
| 5.5 Dates | 5.1 to 5.7 |
| 7 ADRs, 8 terms | 0.1 |
| 9 UI | 2.4, 3.6, 4.6, 5.3, 5.6 |
| 10 Evidence bars | 1.3, 2.5, 3.4, 3.5, 4.2, 4.3, 4.5, 5.2, 5.5 |
| 11 Surfaces | 1.4, 2.6, 3.6, 4.4, 4.6, 5.4, 5.6 |
| 11 The four bets spec's line 56 | 2.6 |
