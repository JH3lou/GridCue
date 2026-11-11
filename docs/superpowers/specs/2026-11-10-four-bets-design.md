# Four bets: design spec

**Status:** approved by the owner on 2026-11-10, together with the plan (grill Q8).
**Date:** 2026-11-10
**Scope:** grill answers Q1 to Q8 in `docs/planning/four-bets-grill.md`.
**Plan:** `docs/superpowers/plans/2026-11-10-four-bets.md`

This is the current best design. Every mechanism below has an evidence bar in section 8, fixed before any code. A mechanism that misses its bar is reworked or removed; the bar does not move.

## 1. Purpose

GridCue today answers one request at a time and says nothing until Enter. These four bets make it something a User reads, trusts, and types into quickly:

1. **The view is a sentence.** Every View State reads as one View Sentence, shown live, and a saved or shared view comes back in through a Preview.
2. **Understood as you type.** The input marks each word GridCue recognises and says what it means, before Enter.
3. **Local first.** A Local Resolver reads what it can in the browser. An Intent Provider is called only for what it declines, and a Host can run with no provider at all.
4. **Terse requests.** `taxable over 1m by advisor desc` works, and Tab completes names.

Success means:

- 0 wrong views on every labelled set, old and new, with every resolver;
- each mechanism meets its bar in section 8 on cases labelled before its code exists;
- nothing that is exact today stops being exact.

## 2. Decisions this spec builds on

| Decision | Source |
| --- | --- |
| The wrong views found by the tests are fixed first, in their own PR, with a core check that a ready plan uses everything it read | Grill Q1, ADR 0019 |
| The View State is the record. The View Sentence is how it reads, and round-trips on the default view | Grill Q2, ADR 0021 |
| `describeView`, the sentence live in both UIs, and `proposeView` ship together | Grill Q3 |
| A new strict Local Resolver. The Mock Provider stays a fixture | Grill Q4, ADR 0020 |
| Local first is opt-in in this release | Grill Q5 |
| Compressed English only. No symbol grammar | Grill Q6 |
| An underline on recognised words and a line beneath saying what each means | Grill Q7 |
| One spec, one plan, five PRs in order | Grill Q8 |
| Additive, optional fields. The protocol stays 0.1 | ADR 0010 precedent |

## 3. Scope

### In

- **PR 1, reading fixes:** spaced comparison symbols, negative amounts, "at least" after a column name, punctuation inside quoted text, the Mock Provider's two wrong readings, and ADR 0019's check (5.1).
- **PR 2, as-you-type:** positions in the User's own text, a cached matcher, `read`, and the marks and reading line in both UIs (5.2).
- **PR 3, the View Sentence:** `describeView`, the sentence in both UIs, and `proposeView` (5.3).
- **PR 4, the Local Resolver:** its grammar, the `local` option, `provider` becoming optional, and the Site demo's move to it (5.4).
- **PR 5, terse requests:** the remaining parser gaps, a direction for each sort column, Tab completion, and the docs (5.5).
- ADRs 0019, 0020 and 0021.

### Out

- **Local first as the default.** It stays opt-in. The owner decides on the default after the two fresh sets in section 8 are in.
- **A symbol grammar** (`/adv -mv !trust`).
- **Storing, naming, or sharing views.** The Host does that with the View State. GridCue gives it `describeView` and `proposeView`.
- **Editing the View Sentence in place.**
- **New view operations.** OR filters, "starts with", empty and not empty, pinning, aggregations, and density stay unreachable by request. The sentence words them for reading and says they can't be typed back.
- **A completion menu.** Tab completes only when one name fits.
- **`limit.set` in the TanStack Table adapter.**

## 4. Shared pieces

### 4.1 Positions in the User's own text (PR 2)

Today a Mention's `start` and a literal's `at` index the cleaned Clause text, which is lowercased, collapsed, and sometimes given a borrowed verb ("then advisor" becomes "sort by advisor"). Nothing maps back to what the User typed.

- `normalize` records, for each Clause, where each of its characters sits in the Utterance. A borrowed verb maps to nothing.
- Directions and counts gain a span, like literals.
- Quoted text keeps the User's letter case in the literal's value. Text filters already match without regard to case, so the rows are the same; the Preview and the sentence now show what was typed. Labels that hold a lowercased quoted value are updated to the typed case, and the PR lists each one.
- None of this is sent to a provider. `buildResolutionRequest` picks the fields it sends, and a test pins the payload to today's.

### 4.2 One vocabulary

The Preview, the View Sentence, and the reading line use the same words for the same thing: "above", "at or above", "below", "at or below", "between", "containing", "descending". `normalize` reads every one of them, so anything GridCue prints can be typed back. The words live in one module that all three import.

### 4.3 A ready plan uses everything it read (PR 1)

ADR 0019. The compiler's last step turns a ready plan into a question when an amount, quoted text, date, or name was read and no operation uses it:

> I'm not sure what to do with "$1m". Try rephrasing that part.

The Local Resolver's trust (5.4) rests on this check, and it protects every provider.

## 5. Units

### 5.1 Reading fixes (PR 1)

| Request | Today | After |
| --- | --- | --- |
| "market value > $1m", and `<`, `>=`, `<=`, `=`, spaced or not | Filter Market value **to** $1,000,000 | above $1,000,000 |
| "accounts at or above $1m", "gain greater than or equal to $20k" | **above** $1,000,000; **to** $20,000 | at or above, for both |
| "gain below -$50k" | Filter Unrealized gain **to $50,000** | below -$50,000 |
| "Show gain at least $100k" | Filter **Market value** at or above $100,000 | Filter Unrealized gain at or above $100,000 |
| "Accounts over $1M grouped by custodian." (Mock Provider) | Group by Custodian | Both changes, or a question. Never the grouping alone |
| "Show only the advisor and restricted holdings columns." (Mock Provider) | Show only rows where Restricted holdings is Yes | Show only those two columns |
| `advisor containing "Smith. Jones"` | Split into two parts, then asked | One part, one filter |

- **Symbols** are read wherever a comparison word is, with or without spaces around them.
- **An amount whose comparison GridCue couldn't read leads to a question,** never to "equal to". This is the root cause of the first three rows, so it is fixed as a rule and not only by adding words to a list.
- **A minus sign** directly before an amount, after a space or a comparison, makes it negative. A hyphen between two words or two numbers ("non-retirement", "2020-2024") does not.
- **"At least" and "at most"** after a column name are a comparison. "At" on its own stays a qualifier ("accounts at Northgate").
- **Quoted text** is never split and never read as an instruction.
- **The Mock Provider** stops reading a yes/no column in a column list as a value.
- **No fix is a special case for one sentence.** Each is a rule, tested on the held-out set in section 8.

### 5.2 As-you-type (PR 2)

**Core.** One synchronous call, with no provider:

```ts
const reading = controller.read("roth accounts over $1m by rep desc");
// reading.marks, in text order, never overlapping. Positions index the text as typed.
// [{ start: 0,  end: 4,  kind: "value",     text: "roth",     meaning: "Registration type is Roth IRA" },
//  { start: 14, end: 22, kind: "amount",    text: "over $1m", meaning: "above $1,000,000" },
//  { start: 26, end: 29, kind: "column",    text: "rep",      meaning: "Advisor column" },
//  { start: 30, end: 34, kind: "direction", text: "desc",     meaning: "descending" }]
```

What gets a mark:

| Read | Mark |
| --- | --- |
| A column or value named by a declared label or alias, that the grammar placed | Yes |
| A name still ambiguous (a Row Noun or entity word that may mean the rows) | No |
| An amount, date, or quoted text, with its comparison word | Yes |
| A number GridCue can't read ("1.000.000") | No |
| A direction, or a count ("top 10") | Yes |
| Anything, when the request names a restricted column or a part starts with a verb GridCue refuses ("sell", "export") | No marks at all |

Two rules stop marks from appearing and then vanishing as the User types:

- **A name at the end of the text waits** while a longer declared name could still be typed. "account" is not marked while "account type" is possible; "advisor" is marked at once.
- **The end of the text is unfinished.** A rule that needs words not yet typed does not withdraw a mark. "concentration above" keeps its mark, where today the name is dropped until "10%" arrives.

**The matcher is built once per Controller,** not on every call. `matchMentions` keeps its signature and uses the same matcher.

**React.** `useGridCue` gains `read`. Both UIs call it with the input's text on each change.

**UI.** See the design pass in section 7. The marks are an underline in the input and a reading line beneath:

> roth: Registration type is Roth IRA · over $1m: above $1,000,000 · rep: Advisor column · desc: descending

### 5.3 The View Sentence (PR 3)

```ts
const sentence = describeView(state, schema, { defaultState });
// { text: "Accounts where Registration type is Taxable and Market value is above $1,000,000, grouped by Advisor, sorted by Market value descending.",
//   roundTrips: true,
//   unsaid: [] }
```

- **Order:** rows, grouping, sorting, count, columns. The default view reads "All accounts." (or "All rows." with no Row Noun).
- **Labels only.** The sentence uses the Host's column and value labels, never IDs and never aliases.
- **Columns are described against the default view:** "hide Custodian" when some are hidden, "show only A, B and C" when the order changed.
- **The exact wording is settled by the round-trip test,** not by this spec. The example above is the starting point. Friendlier forms, such as "Taxable accounts", are used only where the test stays at 100% on both schemas.
- **`roundTrips`** is true when the text, typed on the default view, reproduces the state with no provider. It is false when the view holds something prose can't carry or no request can reach, and `unsaid` names each in plain words: a value containing a quote mark, a label that is an instruction word, an OR filter, a pinned column, a summary, a density.
- A sentence can be longer than the default 500-character limit. `proposeView` is the way to bring a view back, so the limit does not change.

**The Controller's state gains `view`,** the sentence for the grid's current view. It updates on every change the Grid Adapter reports, including the User's own clicks (ADR 0009), and is computed once per Revision.

**`proposeView` brings a View State back in through a Preview:**

```ts
controller.proposeView(savedState); // from the Host's storage, or a link
```

- The state is untrusted. It is parsed, and anything else ends in `INPUT_INVALID_VIEW`: "That saved view can't be read."
- The plan is the set of operations that turns the current view into the saved one, with `source.channel: "api"`. It is validated like any plan: a column that no longer exists, a restricted column, or a change the grid can't make fails closed.
- If the operations can't reproduce the saved view exactly, the result is unsupported: "That saved view holds a setting this grid can't apply." Nothing is applied in part.
- If the grid already shows it: "The grid already shows this view."
- From there it is an ordinary ready plan: Preview, apply, undo, audit, and a stale Revision is rejected.

### 5.4 The Local Resolver (PR 4)

```ts
createGridCue({ adapter });                          // the Local Resolver alone: no server, no key
createGridCue({ adapter, provider, local: true });   // local first; the provider for what it declines
createGridCue({ adapter, provider });                // as today
```

`local: false` with no provider is an `INPUT_CONFIG` error.

**The grammar is closed.** A Clause is read only when every word in it is a declared name, an amount, or one of the grammar's own words in a place the grammar allows. One word left over, and the Local Resolver declines the whole request.

| Form | Examples |
| --- | --- |
| Rows | "taxable accounts", "accounts where market value is above $1m", "with restricted holdings", "custodian is Northgate or Harborline", `advisor containing "Lane"` |
| Sort | "sorted by market value descending, then by advisor", "largest first" (with `defaultMeasure`) |
| Group | "grouped by custodian, then by advisor" |
| Columns | "hide custodian and household", "show only advisor, market value and gain" |
| Count | "top 10", "top 10 by gain" |
| Clear | "clear the filters", "remove sorting", "ungroup", "reset the view" |
| Refused | a part that starts with "sell", "export", "delete", and the other verbs GridCue refuses |

- **It never guesses a column.** A bare amount ("over $1m") goes to the column ADR 0013's kind rule picks. When several fit, it goes to `defaultMeasure` if that is one of them. Otherwise the Local Resolver declines.
- **A local result is used only when** every Clause was read in full, and the compiled plan is ready and valid (which includes ADR 0019's check) or is a refusal. Anything else goes to the provider, with the same request as today.
- **With no provider,** a request the Local Resolver can't read ends in a question that names the words it couldn't place: "GridCue couldn't read "whatever looks risky". Try naming a column or a value."
- **The Controller's state gains `resolvedBy`:** `"local"`, `"provider"`, or `null`. The evals use it to count the local share.
- **The Site demo** moves from the Mock Provider to the Local Resolver alone, so it asks instead of guessing. Every example request the Site suggests must resolve locally, and a test checks that.
- **The Mock Provider** stays in `gridcue/mock` for tests and keyless development against the provider path.

### 5.5 Terse requests (PR 5)

| Line | Today | After |
| --- | --- | --- |
| `sort advisor`, `group custodian` | Asked | Read without "by" |
| `sort adv asc, mv desc` | Both descending | Each column takes the direction written after it. One with none sorts ascending |
| `top10` | Asked | Top 10 |
| `taxable over 1m by advisor desc` | Asked | "by X" with a direction is a sort |
| `taxable by advisor` | Asked | Still asked, with two choices: "Group by Advisor" and "Sort by Advisor" |
| `ungroup`, `unsort` | Asked (Mock Provider) | Clear grouping, clear sorting |

- A direction phrase that isn't written after one column ("largest first", "high to low") still applies to its whole part, as today.
- Short names are the Host's `aliases` (`adv`, `mv`). GridCue adds none of its own.
- **Tab completes a name.** When the word at the caret starts exactly one declared label or alias, and is at least two characters, `read` returns a `completion`. The reading line shows it, and Tab inserts it. With no completion, Tab moves focus as usual, so the input is never a focus trap.
- The docs gain a "Terse requests" guide. The agent skill mentions aliases for it.

## 6. Public API and protocol

All additive. Nothing is removed or renamed.

| Addition | Entry | PR |
| --- | --- | --- |
| `Clause.source`, spans on directions and counts | root | 2 |
| `controller.read(text)`, `Reading`, `ReadingMark` | root | 2 |
| `read` on the `useGridCue` binding | `gridcue/react` | 2 |
| `describeView`, `ViewSentence` | root | 3 |
| `ControllerState.view` | root | 3 |
| `controller.proposeView(state)`, `proposeView` on the binding | root, `gridcue/react` | 3 |
| `INPUT_INVALID_VIEW` | root | 3 |
| `GridCueOptions.local`; `provider` optional | root | 4 |
| `ControllerState.resolvedBy` | root | 4 |
| `Reading.completion` | root | 5 |
| A `viewSentence` prop on `<GridCueBar />`, default on | `gridcue/react` | 3 |
| `view-sentence.tsx` and `reading-line.tsx` | Component Registry | 2, 3 |

The resolution protocol does not change. The `gridcue/server` and `gridcue/tanstack-table` entries change only where a type they re-export gains a field.

## 7. UI design pass

Applied with `emil-design-eng`, `better-ui`, and `principle-experience-first`. Both UIs get the same behaviour from the hooks; the values below are for the built-in bar, and the Component Registry uses the matching Tailwind tokens. PR 2 starts with a throwaway HTML prototype of the whole bar, light and dark, for the owner to look at before any component code.

| Before | After | Why |
| --- | --- | --- |
| The bar starts with the input's label. The view is readable only from the grid's headers | A first line: a "Current view" label (`font-weight: 600`, `0.875rem`) and the View Sentence (`color: var(--gridcue-muted)`, `0.875rem`, `text-wrap: pretty`), never truncated | The User checks every change in words, including their own header clicks |
| — | The sentence swaps with no transition | It changes after Ctrl+Enter and header clicks, many times a day. Keyboard-driven changes never animate |
| The input says nothing until Enter | Recognised words are underlined: `text-decoration-thickness: 1.5px`, `text-underline-offset: 3px`, `text-decoration-color: var(--gridcue-accent)`, drawn by a layer behind the input that mirrors its font, padding, and scroll position | Feedback before the User commits |
| — | A reading line under the input, `0.8125rem`, `color: var(--gridcue-muted)`: "roth: Registration type is Roth IRA · over $1m: above $1,000,000" | Colour is never the only cue, and a screen reader gets the same content |
| A status row under the input, empty while typing | One row, `min-height: 1.25em`, holds either: the reading line while the text differs from the last previewed request, the status otherwise | The bar never changes height while the User types |
| — | Marks and the reading line appear with no transition | Typing is the most frequent action there is |
| — | The reading line is in the input's `aria-describedby`. It is not a live region | Announcing every keystroke would drown the User. The status row stays the live region |
| Tab leaves the input | With a completion, the reading line ends with `Tab` in a `<kbd>` and the completed name. Tab inserts it. With none, Tab leaves the input | Speed for heavy Users without a focus trap |
| Light `#2563eb`, dark `#60a5fa` accent | Unchanged: the underline uses `--gridcue-accent` | No new tokens |
| Preview panel, clarification buttons, Undo | Unchanged | — |

If the mirror layer can't be made exact in both UIs (long text that scrolls, composition input, right-to-left text), the underline is dropped and the reading line ships alone. It carries all of the meaning.

## 8. Evals and evidence

Every set is synthetic. Every held-out set is written and labelled before the code it tests, by a labeller who has not seen that code.

| Mechanism | Sets | Bar |
| --- | --- | --- |
| Reading fixes (5.1) | `cases-reading.jsonl` (dev, 52) and a held-out set (51), both labelled on 2026-11-10 before any fix. Today at least 27 and 25 of them are wrong views | 0 wrong views on both. The held-out exact count is reported |
| ADR 0019's check (4.3) | Every labelled case whose expected plan is ready, in all sets | It blocks none of them when given the expected operations |
| Marks (5.2) | Every labelled request, typed one character at a time; a fresh held-out set of 40 | At the last keystroke, every mark is in the final plan. A mark shown and then withdrawn, while its words are unchanged, in at most 2% of requests (20% today) |
| Matcher cost (5.2) | A synthetic schema: 200 columns, 20 values each | Median at most 1 ms per call, worst at most 8 ms (12 ms and 73 ms today) |
| Round trip (5.3) | 1,500 random reachable views on each of two schemas, fixed seeds | 100% identical with the Local Resolver alone, for every view where `roundTrips` is true. `roundTrips` is false for none of the views requests can reach |
| `proposeView` (5.3) | The same random views, proposed from random starting views | The applied view equals the proposed one, or the result is unsupported. Never a different view |
| Local Resolver (5.4) | All existing sets (188), the reading sets, the terse sets, and two fresh sets of at least 60, one on a second schema | 0 wrong views among locally resolved results. The local share is reported for each set, with no bar |
| Terse (5.5) | The 24 compressed lines from the first test (now seen, so a dev set) and a fresh held-out set of at least 30 | 0 wrong views. At least 90% exact on the held-out set, locally |

- The gate (`pnpm check`) runs every set with the Mock Provider and with the Local Resolver alone. A wrong view in any of them fails it.
- Live runs with Jev need the owner's command. Before PR 1 and PR 5 merge, one `--live` run each confirms 0 wrong views and no drop in exact results against the last recorded run.
- A second schema for the evals is added to `fixtures/`: a different domain, with a number column and a date column, which the wealth fixture lacks.

## 9. Surfaces

| Surface | What changes |
| --- | --- |
| Entry points | Root: everything in section 6. `gridcue/react`: the binding, the bar, `styles.css`. `gridcue/mock`: 5.1. `gridcue/server` and `gridcue/tanstack-table`: types only |
| Both UIs | The sentence, the marks, the reading line, and Tab, from the same hooks |
| Frameworks and tables | The Vite and Next.js examples show the sentence and the marks. Both Grid Adapters pass the contract suite, and `proposeView` is tested on each |
| The Site | The demo uses the Local Resolver. Docs: `create-grid-cue`, `react`, `providers`, the component pages, `providers-and-confidence`, `requests`, `views`, and two new guides, "Save and share a view" and "Terse requests" |
| Agent skill | `skills/gridcue` covers running with no provider, `local`, `proposeView`, and aliases for terse requests |
| Failure paths | Cancel and Escape clear a `proposeView` plan. A declined local read reaches the provider or asks. A stale Revision rejects a saved view. An unreadable saved view is an error with a stable code |

## 10. Testing

- Unit tests for each reading fix and for ADR 0019's check, including every exemption it lists.
- Unit tests for positions: borrowed verbs, collapsed spaces, dictated "comma", smart quotes, and letter case.
- Unit tests for `read`: each row of the table in 5.2, and both stability rules.
- Property tests for the round trip and for `proposeView`, with fixed seeds.
- Unit tests for each grammar form in 5.4, and for a leftover word in each.
- Controller tests for the three ways to set `provider` and `local`, for `resolvedBy`, and for the no-provider question.
- Component tests in both UIs for the sentence, the shared row, Tab with and without a completion, and `aria-describedby`.
- The browser bundle check still passes: nothing here imports server code.
- Every UI change is checked in a real browser, light and dark, in the Vite example, the Next.js example, and the Site.

## 11. Acceptance criteria

1. `pnpm check` passes with no credentials after each PR.
2. Every bar in section 8 is met and reported in its PR, with the numbers.
3. Each PR's description says which surfaces in section 9 it touched.
4. ADRs 0019 to 0021 are in, `CONTEXT.md` matches, and the docs pages in section 9 are current.
5. UI PRs carry before and after screenshots, light and dark.

## 12. Risks

- **The grammar is fitted to what it has seen.** The first trust rule was written after seeing its failures. The fresh sets, one on a second schema, are the check, and local first stays opt-in until the owner has seen them.
- **The Site demo will ask more often.** The Local Resolver read about half of naturally worded requests in the first test. The demo's suggested requests are tested to resolve, and the Preview never shows a guess.
- **ADR 0019's check can ask where a provider was right.** The expected-plan test bounds this to zero on every labelled case. A live run confirms it with Jev.
- **A direction for each sort column changes one reading.** "Sort by advisor and market value descending" becomes Advisor ascending, Market value descending, where today both are descending. No labelled case holds the old reading, and the Preview states each direction.
- **The mirror layer is fragile.** Section 7 names the fallback.
- **Tab is taken while a completion shows.** It is announced in the reading line, and a second Tab moves on.
