# Filters for people, dates, and house terms: grilling log

Status: answered by the owner on 2026-11-13. The answers are at the end of this log.

This is opportunity 1 of the five the owner put ahead of the four bets on 2026-11-13: "5 opportunities first then four bets in terms of build priority." The biggest hole in everyday requests is the things people name. A person: "Sarah Chen's accounts". A time: "last 90 days", "this quarter", "YTD". A firm's own word: "large", "needs attention". Today each one ends in a question, or is dropped beside something GridCue does read. Three smaller gaps sit next to them: "no advisor assigned", "or" across columns, and "starts with". This round decides how each is read, how the Host approves reading the grid's own values in the User's browser (the fourth rule in `AGENTS.md`), and which clock and time zone a date uses. It designs on today's code, where every request goes through an Intent Provider. Every new reading is a closed form with one meaning, so the Local Resolver's grammar (ADR 0020) can take it later without rework.

## Facts gathered (2026-11-13)

Each fact cites a file and line on branch `fix/reading-wrong-views`, or the probe that produced it. *Verified* means a probe ran. *Read* means taken from the code or docs. *Unverified* means nobody checked. The probes are five scratch scripts kept outside the repo (`probe.mts` to `probe5.mts`), run from the repo root with `pnpm exec tsx <script>` and the Mock Provider. No model was called. The date probes use the wealth schema plus two columns it lacks: Opened date (`date`) and Last contact (`datetime`).

**Fact check (2026-11-13, by the spec's author, who did not write this log).** All five probes were run again at commit `469cc75`, and every cited line was opened. What changed:

- Line numbers in `compile.ts` had moved by two to four lines after `469cc75`. They are corrected below.
- Three more wrong views were found and added to the table: "group by advisor for Avery Lane", "accounts with no advisor over $1m", and "opened after 2026-02-31", a date that doesn't exist.
- A new probe (`probe6.mts`) tested what Q3 recommended: a grid value read "under the same rules" as a declared value. Those rules alone preview a filter for sentences that are not view requests. Q3, Q7 and Q8 are narrowed because of it; each change is marked *Changed in the fact check*.
- Everything else held: the 23 quoted-text cases, the 10 labelled requests that hold a grid value (all labelled unsupported), 12 of 17 values containing a declared name, the TanStack faceting code, and the matcher timings.
- Not checked again: the MDN and Power BI facts. The design does not depend on `Temporal`.

### Wrong views found along the way

These are ready-to-apply plans for a view the User didn't ask for, or rows that don't match the Preview. All happen on this branch.

| Request | Today | Cause | Reach |
| --- | --- | --- | --- |
| `advisor is not "Avery Lane"`. Also "isn't", `!=`, "other than", "except", and `accounts without advisor "Lane"` | Filter Advisor **containing** “avery lane”: the rows the User asked to leave out | Quoted text always becomes "containing" (`packages/gridcue/src/core/compile.ts:994`). One negation that belongs to no name passes the negation check (`compile.ts:1397-1401`) | Core, for any provider that names the column. Mock path *verified* (`probe2.mts`, A). With Jev *unverified* |
| `advisor starts with "Av"`, `ends with "Lane"`, `is exactly "Avery Lane"`, `= "Avery Lane"` | Filter Advisor **containing** the text | The same line. The words between a column and quoted text are not read | The same |
| `accounts for "Avery Lane"` | Filter **Account number** containing “avery lane” | "For" is not one of the words that make a name the rows (`packages/gridcue/src/core/mentions.ts:56-57`) | Mock path *verified*. With Jev *unverified* |
| "taxable accounts opened this quarter", "show large taxable accounts", "show taxable accounts for Avery Lane", "taxable accounts needing attention". *Added in the fact check:* "taxable accounts since january", "trust accounts from last quarter", "taxable accounts for Lane" | Filter Registration type to Taxable, and nothing else | Words that nothing reads are dropped. ADR 0019 counts only what code read (`packages/gridcue/src/core/unused.ts:87-93`) | Mock path *verified* (`probe3.mts`, `probe7.mts`). With Jev *unverified* |
| *Added in the fact check.* "group by advisor for Avery Lane" | Group by Advisor, and nothing else | The same: the name is dropped | Mock path *verified* (`probe.mts`, `probe3.mts`) |
| *Added in the fact check.* "accounts with no advisor over $1m" | Filter Market value above $1,000,000, and nothing else | "No advisor" is dropped beside the amount. "Taxable accounts with no advisor" asks, so the drop depends on what else is in the part | Mock path *verified* (`probe7.mts`) |
| "sort by market value for the Alder household" | Sort by Market value, then Household | "Household" is read as a second sort column and "alder" is dropped | Mock path *verified* (`probe3.mts`) |
| "last contact after 2026-01-31", on a date-and-time column | Keeps a row stamped 2026-01-31T09:00Z. "On or before 2026-01-31" drops that row. "On 2026-01-31" keeps none | Cells are compared as text (`packages/gridcue/src/core/evaluate.ts:5-8`) | Both Grid Adapters; the TanStack filter calls the same function (`packages/gridcue/src/tanstack/index.ts:64-66`). *Verified* (`probe2.mts`, B) |
| The same filter on a column of `Date` objects, which schema inference calls date-and-time (`packages/gridcue/src/core/schema.ts:78`) | "After 2026-01-31" keeps a row dated 30 January | The cell becomes text such as "Fri Jan 30 2026" before it is compared (`evaluate.ts:7`) | *Verified* with `applyView` (`probe2.mts`, B) |
| *Added in the fact check.* "opened after 2026-02-31" | Filter Opened date above “2026-02-31”, ready to apply | Any four, two and two digits are read as a date (`normalize.ts:224`), and validation checks only the shape (`packages/gridcue/src/core/validate.ts:87`) | Mock path *verified* (`probe8.mts`). Q1's fix PR asks about it |

No labelled case covers any of these. All 23 cases that filter by quoted text put "containing" or "contains" before it, and no case holds a date (`grep` over `evals/*.jsonl`). *Verified.*

### Names

- **Advisor and Household are text columns with no declared values** (`fixtures/wealth/src/index.ts:43-44`). Mentions come only from labels, aliases, `enumValues` and `valueGroups` (`mentions.ts:136-163`). *Read.*
- **A name works only inside quotes, as "containing".** *Verified* (`probe.mts`, Mock Provider):

  | Request | Today |
  | --- | --- |
  | "Avery Lane's accounts", "accounts for Avery Lane", "advisor is Avery Lane", "the Alder household" | Asks: "I'm not sure what to change for …" |
  | `advisor containing "Lane"` | Filter Advisor containing “lane” |
  | `"Avery Lane"` alone | Asks: "Which column should be equal to avery lane?" |
  | "sort by Avery Lane" | Asks: "There's no column called “avery lane”." |

  With a provider that answers only "filter" at 0.95, "Avery Lane's accounts", "accounts for Avery Lane" and "the Alder household" ask "What should … filter on?" (`probe2.mts`, D). With Jev *unverified*.
- **GridCue has no way to see the grid's values.** `GridCueOptions` holds an adapter, a provider, a schema, confidence, audit and two limits (`packages/gridcue/src/core/controller.ts:26-40`). `GridAdapter` has no row access (`packages/gridcue/src/core/adapter.ts:7-18`). The Rows Adapter takes a schema and a state; the Host keeps the rows and calls `applyView` (`packages/gridcue/src/core/rows-adapter.ts:7-12`, `:78`; `examples/next/app/accounts-view.tsx:8`, `:27`). `sampleRows` only infer kinds and "never leave the caller" (`schema.ts:55-56`). *Read.*
- **The TanStack Table adapter can reach every loaded row** through `getCoreRowModel()` (`tanstack/index.ts:40`, used for 50 sample rows at `:86-89`). TanStack's own unique-values feature leaves out rows that other columns' filters hide, so its list shrinks with the view (installed 9.2.4, `table-core/dist/features/column-faceting/createFacetedRowModel.js:27-41`). *Read.*
- **The data boundary as published.** Rows and cell values are never sent. "The Mentions code found, as column and value ids" are sent (`apps/site/content/docs/safety.mdx:33`, `:40`; `packages/gridcue/src/core/resolution.ts:186-193`). `enumValues` "is the one place you choose to share values" (`safety.mdx:48`; `apps/site/content/docs/get-started/describe-your-domain.mdx:63`). The default payload must not hold "client names" or "unrestricted distinct values gathered from the dataset" (`docs/internals/architecture.md:138-144`). The product definition foresaw a "distinct-value resolver" the Host must govern (`docs/internals/product.md:90`). So a value read from the rows can't travel the way a Mention does today. *Read.*
- **The Utterance is always sent** (`safety.mdx:32`). For `advisor containing "Lane"` the provider receives the part's text and the literal “lane” (`probe2.mts`, E). A name the User types reaches the provider today, quoted or not. What never leaves is whether the grid holds it. *Verified.*
- **Audit events never hold filter values or question text,** and hold the Utterance only when the Host opts in (`packages/gridcue/src/core/preview.ts:162-215`). *Read.*
- **On the fixture, the grid's values turn up only in refused requests.** The 500 fixture rows hold 5 advisors and 12 households. Across all 813 labelled requests (747 plan cases, 66 Mention cases), a whole value appears outside quotes in 10 requests, all labelled unsupported ("assign Avery Lane to the taxable accounts"). Single words of those values, leaving out "Household", appear in the same 10 and nowhere else. *Verified* (`probe2.mts`, F). The fixture's names were invented to be distinct, so this is weak evidence.
- **12 of the 17 values contain a declared name.** Every household value ends in "Household", the column's label. Today "the Alder household" gives one ambiguous Mention of the Household column. *Verified* (`probe2.mts`, F).
- **Today's matcher can't hold a long value list.** `findMentions` builds one pattern per name on every call (`packages/gridcue/src/core/text-match.ts:16-39`). The first two calls took 0.26 to 0.49 s for 1,000 names, 1.5 to 2.8 s for 10,000, and 11 to 18 s for 50,000. Later calls took 1.5, 14 and 83 ms. A word index built once took 115 ms for 50,000 names and 2 ms to look up. *Verified* once (`probe4.mts`, on one machine with other work running). *Fact check:* a second run gave 0.28 to 0.54 s, 1.5 to 2.9 s and 10 to 19 s for the first two calls, then 1.4, 17 and 93 to 154 ms; the index took 141 ms to build and 2.6 ms to look up. The index in the probe is a sketch, and its lookup found no match, so 2 ms is the cost of a miss.
- ***Added in the fact check.* A declared value's rules alone are too wide for a person's name.** With Advisor and Household declared as approved values, and a provider that answers nothing (it can't know a grid value), core alone previews a ready filter for "Avery Lane called about the trust accounts" (Advisor to Avery Lane, Registration type to Trust), "Avery Lane is leaving the firm", "who is Avery Lane", "Avery Lane merged with Blake Moreno", "what happened to the Alder household" and "sort by Avery Lane". "Hide Avery Lane" keeps the four other advisors. "Call Avery Lane", "reassign Avery Lane's accounts to Blake Moreno" and the 10 labelled requests ask or are refused. The same happens today for the Host's approved values ("Northgate"); a person's name turns up in many more kinds of sentence. *Verified* (`probe6.mts`). This is why Q3 now also needs every word of the part to be placed.

### Dates

- **Only ISO dates are read** (`packages/gridcue/src/core/normalize.ts:224`, `:300-303`), with "before", "after", "since", "on or before" and "on or after" (`normalize.ts:162-174`, `:188-191`). *Verified* (`probe.mts`, `probe2.mts`):

  | Request | Today |
  | --- | --- |
  | "opened after 2026-01-31", "opened on 2026-01-31", "opened since 2026-01-01" | Ready, on a date column |
  | "opened between 2026-01-01 and 2026-03-31", "opened from 2026-01-31 to 2026-02-01" | Asks about each date. A range is built only from numbers (`normalize.ts:410`) |
  | "opened in the last 90 days", "opened more than 90 days ago" | Asks: "I'm not sure how to compare with “90”." |
  | "opened this quarter", "opened YTD", "opened this year", "opened last month", "opened today", "opened since January" | Asks: "I'm not sure what to change for …" |
  | "opened in 2024", "opened in Q1 2026", "opened after Jan 31, 2026", "opened after 1/31/2026" | Asks about "2024", "1", "31" and "1" |

- **A date column named right after the Row Noun loses its name.** "Accounts opened after 2026-01-31" asks "Which column should be above 2026-01-31?", with Opened date as the only choice when it is the only date column. "Opened after 2026-01-31" alone is ready. A name directly after another name is read as the rows (`mentions.ts:98`; ADR 0013), and a date with no named or picked column is asked about even when one column fits (`compile.ts:993-1004`). "Accounts opened on 2026-01-31" asks how to compare, for the same reason: with the name lost, "on" has no column beside it. *Verified* (`probe5.mts`; the Mock Provider has no default column for dates). With Jev, which answers a column choice for each literal (`jev.ts:221-231`), *unverified*.
- **The Preview words a date like an amount:** "Filter Opened date above “2026-01-31”" (`preview.ts:5-18`, `:26`). *Verified.*
- **The package has no clock and no time zone.** A search of `packages/gridcue/src` for `Date.now`, `new Date(`, `timeZone` and `Temporal` finds nothing. Its only runtime dependency is zod (`packages/gridcue/package.json:73-75`). *Verified.*
- **Today's date in a named time zone needs no new dependency.** MDN lists `Intl.DateTimeFormat` as widely available across browsers since September 2017. Its `timeZone` option takes any IANA name and defaults to the runtime's zone. MDN lists `Temporal` as "Limited availability". *Read* (MDN, fetched 2026-11-13).
- **"Last N days" has no agreed meaning.** Power BI's relative date filter works in UTC, and its users report both readings of whether today is included (`learn.microsoft.com/power-bi/visuals/desktop-slicer-filter-date-range` and its community threads, from a web search on 2026-11-13). *Unverified* beyond that search.
- **Nothing tests a date.** The wealth fixture has no date column (`fixtures/wealth/src/index.ts:18-29`). The four bets plan adds a second schema with a date column, in its PR 3 (`docs/superpowers/plans/2026-11-10-four-bets.md:135-136`). *Read.*
- **A date read from the request is already sent to the provider** as a literal (`resolution.ts:72-78`; `packages/gridcue/src/server/jev.ts:258-263`; `safety.mdx:32`). *Read.*
- **The docs promise more than ISO.** The architecture lists "ISO and locale-aware dates when unambiguous" (`architecture.md:48`). "Show gains close to becoming long term" must be asked about or use a Host-defined meaning, "never invent the day threshold" (`product.md:163`). *Read.*

### House terms

- **The product definition promises them.** "Unless the host supplies an approved meaning for `large`, GridCue asks" (`product.md:94`). The protocol's own example asks about "big" only "if `big` has no host-defined semantic rule" (`docs/internals/intent-protocol.md:304-309`). *Read.*
- **A Host can't declare one.** The schema takes names (`aliases`), approved values (`enumValues`), categories over one column's approved values (`valueGroups`, `packages/gridcue/src/core/protocol.ts:53-56`; checked at `schema.ts:105-110`), `rowNoun`, `entity` and `defaultMeasure`. Nothing ties a word to a condition on a number, a yes/no, or a date column. *Read.*
- **Alone, a house term asks. Beside something GridCue reads, it is dropped.** "Large accounts", "accounts that need attention" and "high net worth households" ask. "Show large taxable accounts" previews the Taxable filter alone. *Verified* (`probe.mts`, `probe3.mts`).
- **The vision's headline request fails for three reasons** (`product.md:9`), on the Mock path. "Put the largest concentration first" is not read as a sort, so GridCue asks. "That need attention" is dropped. "In one security" is dropped. With the last part reworded as "sort by concentration largest first", the plan is ready with the five right operations. *Verified* (`probe2.mts`, C; `probe3.mts`). A house term settles one of the three. With Jev *unverified*.
- **Size words are near neighbours.** "Largest", "biggest", "top" and "smallest" set a sort (`normalize.ts:230`; ADR 0018). "Large" and "big" are different whole words, so they don't collide. *Read.*

### Smaller gaps

- **Three operators are never produced.** The protocol has twelve (`protocol.ts:14-27`). The compiler writes `eq`, `in` and `neq` for values (`compile.ts:834`, `:864-869`), `contains` for quoted text (`:994`), and the comparisons read from amounts and dates. Nothing writes `startsWith`, `isEmpty` or `isNotEmpty`, and every filter it adds combines with "and" (`compile.ts:800`, `:1052`). The Preview, validation and both adapters already handle them (`preview.ts:14-17`; `packages/gridcue/src/core/validate.ts:82`; `evaluate.ts:17-20`, `:29-30`). *Read.*
- **Every way of saying "empty" asks.** Nine wordings were tried, among them "accounts with no advisor", "advisor is empty", "advisor is blank", "missing household", "accounts without a household" and "advisor is not empty". All nine ask. *Verified* (`probe.mts`).
- **"Empty" means null, missing, or an empty string** (`evaluate.ts:3`). A placeholder such as "Unassigned" is not empty. *Read.*
- **"No" already has three meanings.** "No restricted holdings" is No. "Accounts with no gain over $50k" keeps the opposite comparison (`compile.ts:1012`). "No grouping" asks (`compile.ts:1394-1396`). On an amount column, "no gain" could mean empty or zero. *Read.*
- **Either-or across columns is asked about on purpose** (`compile.ts:1022-1031`; `apps/site/content/docs/concepts/requests.mdx:29`, `:60`). "Taxable or trust" is one column and one filter. *Verified.* The protocol and the reducer can hold "or" (`protocol.ts:130`; `packages/gridcue/src/core/reduce.ts:3-7`). The TanStack Table adapter refuses it (`tanstack/index.ts:143-145`; `safety.mdx:96-100`), and clearing or keeping one named filter works only on a flat "and" list (`compile.ts:792`, `:1475-1483`). *Read.*

### Where this touches the four bets and the other opportunities

- **The four bets spec calls "starts with", empty, and not empty unreachable by request** (`docs/superpowers/specs/2026-11-10-four-bets-design.md:56`). This opportunity makes them reachable, so that line and the list of what a View Sentence can't say (`:157-162`) change with it. OR stays on that list.
- **The Local Resolver's closed grammar** (spec 5.4). Each form here is a fixed set of words around a declared name, a value from the grid, a house term, a whole number, or an ISO date. A value from the grid and a house term join "declared name" in the grammar's rule that every word must be accounted for. The resolver runs in the browser, so it uses the same value index and the same clock.
- **`controller.read`** (spec 5.2) is synchronous and calls no provider. So the grid's values must come from a synchronous function, the index is built once and not on each keystroke (the cached matcher, plan Task 2.3), and each new reading needs a span and a meaning in the Preview's words.
- **`describeView`** (spec 5.3) must word what these requests leave in the View State so that it types back on the default view with no provider: an exact text filter in a quoted form, which doesn't depend on the rows still holding the value; a date range in ISO; "is empty"; `starting with "Av"`. A house term leaves ordinary filters, so the sentence words the filters, not the term.
- **`proposeView`** (spec 5.3) needs nothing new if the View State keeps plain filters (Q5).
- **One vocabulary** (spec 4.2). The Preview's date words and text words go in the one module, and `normalize` must read each one the Preview prints.
- **The second schema.** It is needed here first, with a date column. The bets reuse it.
- **Opportunity 3, more grids.** A Host whose rows live on a server has no rows in the browser, so the grid's values come from the Host's own list or not at all (Q2). A Host's own data query must copy the date and empty meanings (`docs/planning/more-grids-grill.md`, "What a filter means in GridCue").
- **Opportunity 4, routing.** With a Households grid declared, its Q8 says a request whose rows are that noun never filters this grid (`docs/planning/routing-and-saved-views-grill.md`, Q8). "The Alder household" then needs one rule that both follow.
- **Opportunity 5, the command bar.** It recommends a Host-supplied `countRows` on `createGridCue` (`docs/planning/command-bar-grill.md`, Q3), the same shape Q2 recommends here. It also wants to change a filter's value with "GridCue's own amount and date reader" (its Q1), which is the reader Q4 defines.

### Not checked

- Nothing was run with Jev. Every "Mock path" result above is unverified with Jev. Each PR needs one live run on the owner's command before it merges, as the four bets do.
- No real Host's values were used. How often real names collide with declared names or ordinary words is unverified.
- The timing probe ran on one machine, once.
- Time zones were read from the docs, not run in the two examples.

## Round 1

Answer by number. A bare "agree" accepts the recommendation. The recommended option is first in each question.

Two working terms would enter `CONTEXT.md` once the answers settle. A **Local Value** is a value of a text column that GridCue reads from the grid's own rows in the User's browser and never sends to an Intent Provider. A **House Term** is a Host-named condition on the rows, such as Large = Market value above $1,000,000.

❓ **Q1 - The wrong views above.**
(a) **Recommended. Fix them first, in their own small PR on top of PR 21, before anything new.** Cases are written and labelled before each fix. Each fix makes GridCue ask; none adds a new reading. Quoted text beside a negation, or beside words GridCue didn't read ("starts with", "exactly", "is not"), asks. The Row Noun before "for" means the rows. A date compared with a date-and-time column, which includes every column of `Date` objects, asks until Q6 gives it a time zone. *Added in the fact check:* an ISO date that is not a real day asks.
(b) Add them to PR 21.
(c) Fold them into this opportunity's own PRs.

➡️ (a). `advisor is not "Avery Lane"` previews the rows the User asked to leave out, and it is ready to apply. PR 21 is large and already reviewed, and one concern per PR is the rule. Every fix is a question in place of a wrong plan, so it needs no spec, as with the four bets' Q1. Bar: 0 wrong views on a dev set and a held-out set of at least 30 each, labelled before the fixes, and the 23 quoted-text cases stay exact. The words dropped beside a reading (the fourth row) are not fixed here: Q3, Q4 and Q7 make those words something GridCue reads, and ADR 0019's check then covers them.

---

❓ **Q2 - How the Host lets GridCue read the grid's own values.**
(a) **Recommended. A new option on `createGridCue`: the Host names each text column and gives a function that returns its values.**

```ts
createGridCue({
  adapter,
  provider,
  localValues: {
    advisor_name: () => rows.map((row) => row.advisor_name),
    household: () => rows.map((row) => row.household),
  },
});
```

It is off unless set, and allowed only for text columns that are not restricted. GridCue reads the values in the User's browser when a request is made. Nothing about them is sent: the request to the provider is the same as today's, and a test pins it. The function is synchronous. `gridcue/tanstack-table` exports a helper that reads the values from the table's own rows. `localValues` is a working name.
(b) The View Schema marks the column, and the Grid Adapter supplies the values through a new optional method. The Rows Adapter would take the rows.
(c) Send Host-approved values to the provider as Candidates: the "distinct-value resolver" of `product.md:90`.

➡️ (a). The Host owns the rows, so the Host says which columns and where their values come from. That includes a list from its own server, for a grid that pages. It changes no adapter interface, works the same in the Vite and Next.js examples, and has the same shape as the `countRows` option opportunity 5 recommends. (b) is less code for a Host, but it ties the values to what the adapter can see, which is one page on a paged grid, and it changes the adapter interface. (c) sends row values to a provider, which the fourth rule keeps out by default. Bar: with `localValues` set, the provider request is byte-for-byte what it is without it, on every labelled request. Would change if: most Hosts use an adapter whose rows GridCue can read in full, which would make (b) less work for them. This needs an ADR, since it is the first time GridCue reads row values at all.

---

❓ **Q3 - What counts as naming a value.**
(a) **Recommended. A whole value is read as certain. One word of a value asks.** "Avery Lane's accounts" filters Advisor to exactly Avery Lane, ignoring letter case; several values of one column make one filter. The longest name wins, so "the Alder household" is the value Alder Household, not the Household column. A value that two columns hold, or that is also a declared name, asks which. One word of a value ("Lane", "Alder") is never read as certain: GridCue asks "Did you mean Advisor: Avery Lane?" with the values that hold the word as choices, five at most. A word that is a declared name or one of GridCue's own words is never offered. A value the request leaves out ("everyone except Avery Lane", "hide Avery Lane") asks. A request GridCue refuses stays refused.

*Changed in the fact check.* The first draft said a whole value is read "wherever a declared value is read today, under the same rules (ADRs 0013 and 0015)". `probe6.mts` showed those rules alone preview a filter for "Avery Lane called about the trust accounts" and "sort by Avery Lane". So one rule is added: a part that names a value from the grid gives a ready plan only when GridCue placed every other word in it, from a closed list of its own words, and the value is not written where a column goes. Any other word asks. The same rule covers a House Term (Q7), the empty and text forms (Q8) and a date form (Q4). It is the first slice of the Local Resolver's rule that every word is accounted for.
(b) Whole values only. One word of a value is not read at all, as today.
(c) A word that belongs to exactly one value is read as certain.

➡️ (a). A whole value is the narrowest reading that is certain, and it makes "Sarah Chen" exact where the quoted form also shows "Sarah Chenoweth". A last name is how people will often ask, and a question with one or two choices costs a click and can't show a wrong view. (c) turns ordinary words into filters: Lane, Young, Grant, Trust. Bar: two held-out sets of at least 60 name requests, one on the wealth schema and one on the second schema, labelled before the rule exists, with 0 wrong views; and every existing labelled request gives the same result with the fixture's values turned on. Would change if: the one-word question fires on ordinary words often enough to annoy, which moves to (b); or the held-out sets show the question almost always has one choice that Users accept, which is evidence for (c) on a fresh set.

---

❓ **Q4 - Which dates GridCue reads.**
(a) **Recommended. A closed list, each form with one exact meaning, and a Preview that always shows the dates.** With today as T:

| Form | Meaning |
| --- | --- |
| "today", "yesterday" | That day |
| "last N days", "past N days"; the same with weeks, months, years | From the day N days (weeks, months, years) before T, through T. A month back from the 31st that doesn't exist is that month's last day |
| "this month", "this quarter", "this year" | The whole period that holds T |
| "last month", "last quarter", "last year" | The whole period before it |
| "month to date", "quarter to date", "year to date", "MTD", "QTD", "YTD" | From the period's first day, through T |
| "this week", "last week" | Read only when the Host sets the first day of the week (Q6). Otherwise GridCue asks |
| An ISO date, or two as a range: "between 2026-01-01 and 2026-03-31", "from … to …" | As written, both ends included. Ranges are new |

A form may follow "in", "in the", "over the", "during" or "within the". A comparison word before a relative form ("before this quarter") asks. The date goes to the date column named right before it, also right after the Row Noun ("accounts opened in the last 90 days"), where the name is lost today. With no date column named, nothing changes from today: the provider's pick decides, or GridCue asks which column. Anything else that looks like a date asks and is never dropped: "Jan 31, 2026", "1/31/2026", "in 2024", "90 days ago".
(b) Only the three named in the opportunity: "last N days", "this quarter", "YTD".
(c) The list in (a), plus month names ("since January", "Jan 31, 2026"), years and quarters by name ("in 2024", "Q1 2026"), "N days ago", and "next N days".

➡️ (a). Each form in it has one meaning once a time zone and a year start are fixed, and the Preview states both dates, so the User checks the reading and not just the words. (b) leaves "last month" and "this year" asking for no reason. (c) adds forms with two readings ("1/2/2026") or with numbers that are also amounts ("in 2024"); each can come later with its own held-out set. Bar: a held-out set of at least 60 date requests on the second schema, labelled before the reader exists, run with a fixed clock, with 0 wrong views; and a table test of every form on the awkward days: month end, leap day, year end, the first day of a quarter, and both clock-change days in the Host's time zone. Would change if: the held-out set shows Users mean two different things by a listed form, which moves that form to "asks".

---

❓ **Q5 - What the view keeps: the dates or the words.**
(a) **Recommended. The dates.** "Last 90 days" becomes an ordinary filter between two fixed dates, worked out when the request is made. The Preview shows both the dates and the words: "Filter Opened date from 2026-08-15 to 2026-11-13 (last 90 days)". The View State, the protocol and both Grid Adapters stay as they are. A view saved today shows the same rows next month. On a date-and-time column the rows are the whole days in the Host's time zone (Q6); how the filter holds that is for the spec.
(b) The words. The View State holds a relative value, and each grid works out the dates whenever it filters. That is a new filter value in the protocol, so it needs an ADR and a protocol-version decision, and every adapter and every Host with its own data query needs a clock.

➡️ (a). The View State is the record (ADR 0021), and a record that means something else tomorrow is not one. Nothing changes in any adapter, including the ones opportunity 3 adds, and the View Sentence types back exactly. The cost is real: a saved "last 90 days" view goes stale, and the User asks again. Would change if: Hosts ask for saved views that roll forward. The plan's evidence keeps the words, so a later protocol version can add a relative value without guessing what was meant.

---

❓ **Q6 - The clock and the calendar.**
(a) **Recommended. The calendar goes in the View Schema, the clock on the Controller, and both default to the browser's.**

```ts
defineSchema(columns, { calendar: { timeZone: "America/New_York", fiscalYearStart: 1, weekStart: "monday" } });
createGridCue({ adapter, provider, now: () => new Date() });
```

`timeZone` defaults to the browser's. `fiscalYearStart` defaults to January, and quarters and years follow it. `weekStart` has no default. `now` defaults to the system clock, and tests pass a fixed one. The time zone decides what "today" is and which day a date-and-time cell falls on. The default is taken in the browser when a request is read, never when the schema is built, so a schema built on a server does not carry the server's zone. The calendar is not sent to a provider. The names are working names.
(b) The same options, but relative dates stay off until the Host sets `timeZone`. Without it GridCue asks for exact dates.
(c) Everything on the Controller, and nothing in the schema.

➡️ (a). What prints or filters a date already receives the schema: the Preview, `applyView`, and later `describeView`. The TanStack filter function receives only the column's kind (`tanstack/index.ts:64-66`), so its adapter would pass the time zone along with it. Only the Controller reads a request, so only it needs the clock. A User's "today" is their own day, and the feature works in both examples with no setup. The Preview shows the dates, so a surprise is visible. (b) is stricter, and costs every Host a setup step before "this quarter" works. Would change if: a Host whose data is booked in one time zone, with Users in another, reports a view that is off by a day. Then (b) becomes the default.

---

❓ **Q7 - What a house term is.**
(a) **Recommended. A named list of fixed conditions in the View Schema, all of which must hold.**

```ts
defineSchema(columns, {
  terms: [
    { label: "Large", aliases: ["big"], where: [{ columnId: "market_value", operator: "gt", value: 1_000_000 }] },
    {
      label: "Needs attention",
      aliases: ["need attention", "needing attention"],
      where: [
        { columnId: "concentration", operator: "gt", value: 0.1 },
        { columnId: "has_restricted_holding", operator: "eq", value: true },
      ],
    },
  ],
});
```

`defineSchema` checks each condition as validation checks a filter in a plan, and throws on a bad one or on a name that a column, a value or another term already uses. A term is found the way a value's name is. It adds its conditions as ordinary filters. The Preview shows each one and names the term: "Filter Market value above $1,000,000 (Large)". The plan records the Host as the source. A term is not sent to a provider. Leaving a term out ("accounts that aren't large") asks. `terms` and `where` are working names.

*Changed in the fact check.* The first draft read a left-out term as its opposite when the term is one comparison ("aren't large" as at or below $1,000,000). That is dropped: a left-out term always asks. Negation was the largest source of held-out wrong views in PR 21 (rounds 3 to 6 of the four bets plan), the opposite also hides rows with no value, and a left-out Local Value already asks (Q3). A term is also read only when every other word of its part is placed (see Q3).
(b) A term may also hold either-or conditions and the relative dates of Q4 ("Stale" as no contact in the last 90 days).
(c) No terms. Hosts keep using aliases and Value Groups, and "large accounts" keeps asking.

➡️ (a). The product definition already says GridCue asks about "large" unless the Host supplies a meaning. Fixed conditions joined by "and" are what both Grid Adapters can apply and what the Preview can state in full, so the User sees the threshold and not just the word. (b) needs "or", which the TanStack Table adapter refuses, and a clock inside a declaration. Bar: a held-out set of at least 40 requests on two schemas, with the terms declared before the labelling, and 0 wrong views; every existing labelled request gives the same result with terms declared. Would change if: a Host's real terms mostly need "or" or a moving date.

---

❓ **Q8 - The smaller gaps, and the order of the work.**
(a) **Recommended. Read empty, "starts with" and "exactly". Keep asking about either-or. One spec and one plan, then five PRs in this order:**
1. The fixes in Q1.
2. Text forms. `advisor starts with "Av"` and `advisor is exactly "Avery Lane"`. Empty: "advisor is empty", "is blank", "is missing", "no advisor", "without an advisor", with "assigned" or "set" allowed after. Not empty: "advisor is not empty", "has an advisor". Empty is read for text, category and date columns only. On an amount column "no gain" asks, and a yes/no column keeps today's reading.
3. House terms (Q7).
4. Names (Q2, Q3).
5. Dates (Q4 to Q6), with the second schema.

"Over $1m or at Northgate" keeps today's question. Each PR has its own held-out set, labelled before its code, and updates the Site docs and the agent skill. Q2, Q5 and Q7 each get an ADR, numbered when the spec is written.

*Changed in the fact check.* The rule that every word is placed (see Q3) starts in PR 2, with the empty and text forms, and gets its own ADR, so four ADRs in all. An empty form followed by an amount ("no advisor over $1m") asks.
(b) Also read either-or across columns. The TanStack Table adapter would have to hold "or", and clearing or keeping one filter would need rules for filters that are not a flat list.
(c) Names and dates only. House terms and the smaller gaps wait.

➡️ (a). The three text forms are already in the protocol, the Preview and both adapters, so reading them is small and each has one meaning. Either-or works on one of the two Grid Adapters today; a reading that only works there is not done, and the four bets already list "or" as something a View Sentence can't say. The order runs from the smallest and most certain to the largest: terms before names because they reuse the path a value's name takes and need nothing new from the Host, and dates last because they need the second schema and the calendar. Would change if: the owner wants the headline name case sooner, in which case names move ahead of terms at no cost to either.

## Out of scope

- Either-or across columns, unless Q8 (b).
- Leaving text or a name out: `advisor is not "Avery Lane"`, "not containing" and "everyone except Avery Lane" ask. So does "ends with", which has no operator in the protocol.
- Misspelled names, nicknames and initials.
- The grid's values for number, date or category columns, and any value sent to a provider.
- Month names, slash dates, "N days ago", "next N days", times of day, business days and holidays.
- A relative date kept in the View State.
- Sort wording such as "put the largest concentration first". That is a reading gap, not a filter.
- Terms that need other rows to work out: "top decile", "above average".
- A question for every word GridCue can't place. That is the Local Resolver's closed grammar. Until it ships, a name that is not in the grid, written beside something GridCue reads, is still dropped by a provider that ignores it.
- New View Operations.

## Owner's answers (2026-11-13)

The owner was shown the 45 decisions in section 7 of `docs/superpowers/plans/2026-11-13-five-opportunities-order.md`, each with its recommended answer, with the words "a bare agree accepts every recommendation". The owner gave one reply to the whole list. It is recorded on each row as it was given.

| Question | Decision in the order plan | Answer | Date |
| --- | --- | --- | --- |
| Q1 - The wrong views | D6 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | 2026-11-13 |
| Q2 - How the Host lets GridCue read the grid's values | D13 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | 2026-11-13 |
| Q3 - What counts as naming a value | D14, D11 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | 2026-11-13 |
| Q4 - Which dates GridCue reads | D15 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | 2026-11-13 |
| Q5 - The dates or the words | D16 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | 2026-11-13 |
| Q6 - The clock and the calendar | D17 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | 2026-11-13 |
| Q7 - What a house term is | D12, D5 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | 2026-11-13 |
| Q8 - The smaller gaps, and the order | D10, D11, D1, D2 | "Yes. Approved and go. Run in batches of workflows, babysit each PR. Once one wave or batch is cleared then kick off the next." | 2026-11-13 |

**What the reply approved.** It approved the recommended answers as section 7 of the order plan states them, and with them the spec and the plan. Each question above was recommended as (a), so (a) stands for all eight, as changed by the fact check. Where section 7 differs from this log's own recommendation, section 7 stands. For this record the differences are:

- **The House Term option is `houseTerms`, not `terms`** (D5). Q7 called `terms` a working name. The root entry already exports `unknownTerm`, where a term is a name GridCue didn't recognise.
- **A Host function that throws while a request is read gives an `INPUT_` error** (D5). No question here asked it. The spec's `INPUT_LOCAL_VALUES` already fits.
- **A provider's picks are limited to what the words name** (D11). Q3's fact check asked only that every word of the part is placed. Section 7 adds the limit on what a provider may propose in such a part.
- **A wrong view on a natural held-out set, from a word nothing reads, in a part this work doesn't cover, still fails the bar** (D4). No question here asked it. The class is narrowed to a question on a fresh held-out set, and no reading is added. PR 2 also reports how many ready plans on every set hold an unplaced word.
- **The order of the PRs is the order plan's** (D1). Q8 ran the five PRs one after another. In the order plan the operation set's count fix and more grids' first three PRs sit between PR 1 and PR 2, and PR 2 needs PR 1 and the count fix. Q8 let names move ahead of House Terms; the order is now House Terms, then Local Values, and saved views need both. Q1's "on top of PR 21" stands: every PR stacks on PR #21 and on the one before it, until they merge.
- **The second schema is built in PR 2, not PR 5** (D1). Q8 put it with dates. It is the ledger fixture, and the other four opportunities and the four bets reuse it.
- **The edit to the four bets spec lands with PR 2** (D2), the PR that makes "starts with", empty and not empty reachable. It does not land with the planning record.
- **The four ADRs are numbered 0023 to 0026** (order plan, section 4). Q8 left the numbers for the spec.

D3 changes nothing in this record: it adds no "this grid can't" result.

**One trim, recommended by the lead.** In the same message as the list, the lead recommended that "this week" and "last week" are asked about, like every other time word GridCue doesn't read, and that `weekStart` is removed. The Calendar is then the time zone and the first month of the year. The owner's reply did not name this trim. The lead reads the reply as covering it. That is the lead's reading, not the owner's words. The order plan's section 7 records it the same way, and its D15 and D17 rows are worded with the trim in. It changes two recommendations above: Q4's row for "this week" and "last week" is not built, and Q6's `weekStart` is not built. Week forms can come later on their own held-out set. The questions above are left as they were asked.

The terms **Local Value**, **House Term** and **Calendar** enter `CONTEXT.md` with these answers, and **Mention** gains one sentence. The ADRs are 0023 (every word is placed), 0024 (House Terms), 0025 (Local Values) and 0026 (fixed days).

**What still waits for the owner.** A live run with Jev needs the owner's command each time: one before each of PR 1 to PR 5 merges. Merging each PR is the owner's.
