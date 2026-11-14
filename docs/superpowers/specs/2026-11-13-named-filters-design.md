# Filters for people, dates, and house terms: design spec

Status: approved by the owner on 2026-11-13. Answers in docs/planning/named-filters-grill.md.

**Date:** 2026-11-13
**Scope:** grill answers Q1 to Q8 in `docs/planning/named-filters-grill.md`, as changed by its fact check and by the owner's answers of 2026-11-13.
**Plan:** `docs/superpowers/plans/2026-11-13-named-filters.md`

This is the current best design. Every mechanism below has an evidence bar in section 10, fixed before any code. A mechanism that misses its bar is reworked or removed; the bar does not move. Each unit also says what evidence would change it.

It is designed on today's code, where every request goes to an Intent Provider. Section 15 says how the four bets pick it up later.

## 1. Purpose

The biggest hole in everyday requests is the things people name. Today each one ends in a question, or is dropped beside something GridCue does read:

1. **A person.** "Avery Lane's accounts" works only as quoted "containing" text.
2. **A time.** Only one ISO date with a comparison is read. "Last 90 days", "this quarter" and "YTD" are not.
3. **A firm's own word.** A Host can't say that "large" means over $1,000,000.
4. **Three small forms.** "No advisor assigned", "starts with" and "exactly" are in the protocol and are never produced.

Success means:

- 0 wrong views on every labelled set, old and new;
- each mechanism meets its bar in section 10 on cases labelled before its code exists;
- nothing that is exact today stops being exact;
- with `houseTerms` and `localValues` set, the request sent to a provider is the same, byte for byte, as without them.

## 2. Decisions this spec builds on

| Decision | Source |
| --- | --- |
| The wrong views found along the way are fixed first, in their own PR. Each fix asks; none adds a reading | Grill Q1 |
| The Host names each text column whose values GridCue may read, and gives a function that returns them. Nothing about them is sent | Grill Q2, ADR 0025 |
| A whole value is read as certain. One word of a value asks | Grill Q3, ADR 0025 |
| A closed list of date forms, each with one meaning. The Preview always shows the dates | Grill Q4, ADR 0026 |
| The view keeps fixed dates, not the words | Grill Q5, ADR 0026 |
| The calendar is in the View Schema, the clock on the Controller. Both default to the browser's | Grill Q6, ADR 0026 |
| A House Term is a named list of fixed conditions in the View Schema, all of which must hold | Grill Q7, ADR 0024 |
| Empty, "starts with" and "exactly" are read. Either-or keeps asking. Five PRs in order | Grill Q8 |
| A part that holds one of these readings is ready only when every word in it is placed | Fact check of Q3, ADR 0023 |
| A left-out House Term always asks | Fact check of Q7 |
| A provider's picks are limited to what the words name | Order plan, D11; ADR 0023 |
| A wrong view from a word nothing reads still fails the bar, and is narrowed to a question | Order plan, D4 |
| The option is `houseTerms`. A Host function that throws while a request is read gives an `INPUT_` error | Order plan, D5 |
| "This week" and "last week" ask. The Calendar has no first day of the week | Order plan, D15 and D17. The lead's trim, recorded in the grill log as the lead's reading |
| A ready plan uses everything it read | ADR 0019 |
| A provider's proposal is checked against the request's words | ADR 0022 |
| Additive, optional fields. The protocol stays 0.1 | ADR 0010 precedent |

The order plan (`docs/superpowers/plans/2026-11-13-five-opportunities-order.md`) says where each PR here sits among the other opportunities' PRs, and which shared pieces this work builds for them.

**What the fact check changed.** The grill said a grid value is read "wherever a declared value is read today, under the same rules". A probe showed those rules alone preview a filter for "Avery Lane called about the trust accounts" and for "sort by Avery Lane". So this spec adds the rule in 4.2. The grill also read "accounts that aren't large" as the opposite comparison. This spec asks instead (5.3).

**What the owner's answers changed.** The owner approved the recommended answers as the order plan's section 7 states them. Four things differ from the grill's own text. The House Term option is `houseTerms`, since the root entry already exports `unknownTerm`, and a Host function that throws while a request is read gives an `INPUT_` error (D5). A provider's picks are limited to what the words name (D11, section 4.2). A natural set's wrong view from a word nothing reads fails the bar like any other (D4, section 10). And the week forms were trimmed: "this week" and "last week" ask, and the Calendar has no `weekStart` (D15, D17). The owner's reply did not name the trim. It was the lead's recommendation, and the lead reads the reply as covering it. The grill log and the order plan record it that way.

## 3. Scope

### In

- **PR 1, fixes:** quoted text beside a negation or beside words GridCue doesn't read; the Row Noun before "for"; a date against a date-and-time column; a date that is not a real day (5.1).
- **PR 2, text forms:** "starts with", "exactly", empty and not empty; the rule that every word is placed (4.2); the second schema (4.6).
- **PR 3, House Terms:** `houseTerms` in the View Schema (5.3).
- **PR 4, Local Values:** `localValues` on the Controller, the value index, the one-word question (5.4).
- **PR 5, dates:** the date forms, ranges, `calendar`, `now`, and whole days on date-and-time columns (5.5).
- ADRs 0023 to 0026 (section 7) and the terms in section 8.

### Out

- **Either-or across columns.** "Over $1m or at Northgate" keeps today's question. The TanStack Table adapter can't hold it.
- **Leaving out text, a Local Value or a House Term.** `advisor is not "Avery Lane"`, "everyone except Avery Lane" and "accounts that aren't large" ask.
- **"Ends with".** The protocol has no operator for it.
- **Misspelled names, nicknames and initials.**
- **Values read from number, date or category columns,** and any grid value sent to a provider.
- **Month names, slash dates, years and quarters by name, "N days ago", "next N days", "past week", number words ("ninety"), times of day, business days.** Each asks and is never dropped (5.5).
- **"This week" and "last week".** They ask, like every other time word GridCue doesn't read, and the Calendar holds no first day of the week. Week forms can come later, on their own held-out set.
- **A relative date kept in the View State.** A saved "last 90 days" view shows the same dates next month.
- **Terms with "or", with a moving date, or that need other rows** ("top decile", "above average").
- **Sort wording** such as "put the largest concentration first", and "in one security". So the product definition's headline request still asks; a House Term settles one of its three gaps.
- **A question for every word GridCue can't place, in every request.** Section 4.2 covers only parts that hold one of this spec's readings. The rest waits for the Local Resolver.
- **New View Operations, new operators, and any change to a Grid Adapter's interface.**

## 4. Shared pieces

### 4.1 Code-read filters (PR 2, grown in PR 3 to PR 5)

A **code-read filter** is a filter whose meaning GridCue reads with its own code. A provider is never asked what it means. This spec adds five:

| Code-read filter | Read from | PR |
| --- | --- | --- |
| A text form: "starts with", "exactly" | The words between a column name and quoted text | 2 |
| An empty form: "no advisor", "advisor is empty" | The words around a column name | 2 |
| A House Term: "large" | The View Schema's `houseTerms` | 3 |
| A Local Value: "Avery Lane" | The values the Host's function returns | 4 |
| A date form: "last 90 days", "between 2026-01-01 and 2026-03-31" | The request, the Controller's clock and the schema's calendar | 5 |

One ISO date with a comparison ("opened after 2026-01-31") is read as it is today and is not a code-read filter.

- **Code decides that the part filters.** A provider can't see a House Term or a Local Value, so it can't score "filter" for them. When a part holds a code-read filter and passes 4.2, the filter is in the plan, with `deterministic` evidence (`host` for a House Term).
- **A code-read filter is never read in two places:** where a column goes ("sort by Avery Lane", "the large column"), and where rows are left out ("hide Avery Lane", "not large", "everyone except …"). Both ask.
- **Other changes in the same part come from the provider as today.** "Avery Lane's accounts sorted by market value" filters by code and sorts by the provider's pick.
- **Filters combine with "and",** and a new filter replaces the view's current filters unless the part says to add (ADR 0017). Nothing here changes that.

### 4.2 Every word is placed (PR 2)

A part that holds a code-read filter gives a ready plan only when GridCue placed every word in it. Quoted text is skipped. A word is placed when it is one of these:

| Kind | Words |
| --- | --- |
| A name | A Mention of a column or a value, a House Term, a Local Value, the Row Noun, an entity word |
| An amount, a date or quoted text, with its comparison | As read today, plus the forms in 5.2 and 5.5 |
| A lead-in | "please", "can you", "show me", "I want to see" and the rest of the list in `core/lead.ts` |
| A row verb | show, display, list, see, view, find, get, give, filter, keep, only, just, include |
| Another change's own words, when the plan holds that change | sort, order, group, hide, by, then, column, first, and the direction and count words read today |
| A small word | the, a, an, all, any, every, each, my, our, me, us, those, these, that, which, whose, where, with, for, of, at, in, from, under, is, are, was, were, has, have, having, held, owned, and, or, also, too, as well, 's, rows, records, ones |

- **Any other word asks:** "I'm not sure what to do with “called about”. Try rephrasing that part." The wording is ADR 0019's.
- **"To", "about", "who" and "what" are not on the list,** so "assign Avery Lane to the taxable accounts" and "who is Avery Lane" never give a ready plan.
- **A verb GridCue reads only for columns** ("add", "put", "move", "pin") is placed only when its object is a column and the plan holds a column change for that verb. Otherwise it asks. "Pin advisor for Avery Lane's accounts" would pass a looser rule with the pin dropped: the Advisor filter uses the name, so ADR 0019's check is satisfied. The operation set reads a pin only when it reads the whole part (its 4.1), so a part that holds "pin" and a code-read filter always asks.
- **The provider's picks are limited to what the words name.** In a part that passed this check, a column or value the provider proposes that no Mention names is dropped, and a sort, group, show or hide is kept only when the part holds that change's own words. Each drop is recorded as `dropped:` evidence. The column for a bare amount or a bare date ("over $1m", "in the last 90 days") still comes from the kind rule and the provider's pick, as today. This extends ADR 0022.
- **A part with no code-read filter is read exactly as today.** This is how the rule can't change an existing result.
- **It checks which words, not where they sit.** The Local Resolver's grammar (ADR 0020) checks both and replaces this list.

The cost is real: "Avery Lane's accounts sorted by size" asks about "size", where "accounts sorted by size" may be ready today because a provider knows the synonym. Section 10 reports how often that happens.

Would change if: the held-out natural sets show that most requests with a name or a term ask because of one unplaced word. The list then grows, one word at a time, each on a fresh held-out set.

### 4.3 The provider request does not change (PR 3 and PR 4)

- The request is built before House Terms and Local Values are looked at, from the same input as today. A test pins it: on every labelled request, the request with `houseTerms` and `localValues` set equals the request without them, byte for byte. It is the operation set's payload pin test (order plan, section 3), run with the options on and off. This work builds no second one.
- The provider is called exactly as today, whether or not anything matched. Skipping the call on a match would show that the grid holds the name.
- What is sent, as today: the Utterance and each Clause's text. A name the User types is in them, quoted or not.
- What is never sent: the values, whether one matched, which column holds it, the choices in a question, the User's answer, a term's name or conditions, and the calendar.
- Text and date forms change the request in one way only: a date form's fixed dates are sent as a date literal, as an ISO date is today. `Literal.match` and `Literal.words` are for core and are not sent. Today `buildResolutionRequest` spreads each whole Clause into the request (`resolution.ts:186-192`), so PR 2 makes it pick the fields it sends. The command bar's `Clause.source` and the four bets' positions rely on the same change, and neither repeats it. An empty form sends nothing new.
- Audit events hold no values and no question text, as today.

### 4.4 ADR 0019's check counts the new readings (PR 2 to PR 5)

`unusedReadings` counts a text form, an empty form, a House Term, a Local Value and a date form as read. Each is used when the plan holds its filter. The expected-plan test runs on every new labelled ready case: the check blocks none of them.

### 4.5 The Preview says where a filter came from (PR 3 to PR 5)

The View State keeps plain filters. The plan's evidence keeps the term's label, or the date words, for each filter they made. `renderPreview` adds them in brackets:

> Filter Market value above $1,000,000 (Large)
> Filter Opened date from 2026-08-15 to 2026-11-13 (last 90 days)

Once applied, the words are gone from the view. The evidence stays in the plan, so a later protocol version can add a relative value without guessing what was meant.

### 4.6 A second schema (PR 2)

`fixtures/` gains a ledger domain: synthetic rows with two text columns that hold names, a date column, a date-and-time column, a number column, a currency column, a percent column, a category column and a yes/no column. This PR owns it (order plan). More grids (its 5.5), the operation set's totals sets, the command bar's held-out sets, `proposeView`'s property test and the four bets (their PR 3) all reuse it, so it carries every column kind they name. Routing's households fixture is a different thing: a second grid in the wealth domain.

## 5. Units

### 5.1 Fixes (PR 1)

Each fix makes GridCue ask. None adds a reading. The Mock Provider path is verified; with Jev it is not.

| Request | Today | After |
| --- | --- | --- |
| `advisor is not "Avery Lane"`, and "isn't", `!=`, "other than", "except" | Filter Advisor containing “avery lane” | Asks: "GridCue can't filter for text that isn't there. Ask for the text to look for instead." |
| `accounts without advisor "Lane"` | Filter Advisor containing “lane” | Asks, the same |
| `advisor starts with "Av"`, `ends with "Lane"`, `is exactly "Avery Lane"`, `= "Avery Lane"` | Filter Advisor containing the text | Asks: "I'm not sure how to match “av”. Try “containing”." |
| `advisor containing "Lane"`, `advisor is "Lane"`, `advisor: "Lane"`, `advisor like "Lane"` | Filter Advisor containing “lane” | Unchanged |
| `accounts for "Avery Lane"` | Filter Account number containing “avery lane” | Asks: "Which column should contain “avery lane”?" |
| `"Avery Lane"` | Asks: "Which column should be equal to avery lane?" | Asks: "Which column should contain “avery lane”?" |
| "last contact after 2026-01-31", on a date-and-time column | Filter Last contact above “2026-01-31”. Keeps a row stamped 09:00 on the 31st | Asks: "Last contact holds times of day, so GridCue can't filter it by date yet." |
| "opened after 2026-02-31" | Filter Opened date above “2026-02-31” | Asks: "2026-02-31 isn't a date." |

- **Quoted text is "containing" only after words GridCue reads:** nothing, ":", "is", "are", or a containing word ("containing", "contains", "includes", "has", "like", "matching"). Any other word between a column and quoted text asks. This is a rule, not a list of bad words.
- **A negation in a part with quoted text asks,** unless it belongs to a named value, as in "non-retirement". Today one negation that belongs to no value passes.
- **The grid's own Row Noun before "for" means the rows.** No other name changes: "gain for trusts" still names Unrealized gain.
- **A date compared with a date-and-time column asks,** until PR 5 gives it a time zone. That includes every column of `Date` objects, which schema inference calls date-and-time.
- **An ISO date that is not a real day asks.**
- **Not fixed here:** words dropped beside a reading ("show large taxable accounts", "taxable accounts opened this quarter", "group by advisor for Avery Lane", "accounts with no advisor over $1m"). PR 2 to PR 5 make those words something GridCue reads, and ADR 0019's check then covers them.

### 5.2 Text forms (PR 2)

`C` is a column name. Each form is the words shown and nothing else.

| Form | Reads as |
| --- | --- |
| `C starts with "x"`, `C starting with "x"`, `C begins with "x"`, `C beginning with "x"` | C starting with x |
| `C is exactly "x"`, `C exactly "x"`, `C = "x"`, `C equals "x"`, `C equal to "x"` | C exactly x, ignoring letter case |
| `C is empty`, `C is blank`, `C is missing`; `no C`, `with no C`, `without C`, `without a C`, `without an C`, `without any C`; each of the last five may end in "assigned" or "set" | C is empty |
| `C is not empty`, `C is not blank`, `C isn't empty`; `has a C`, `have an C`, `having a C`; the last three may end in "assigned" or "set" | C is not empty |

| Request | Today | After |
| --- | --- | --- |
| `advisor starts with "Av"` | Filter Advisor containing “av” | Filter Advisor starting with “av” |
| `advisor is exactly "Avery Lane"` | Filter Advisor containing “avery lane” | Filter Advisor to exactly “avery lane” |
| `advisor ends with "Lane"` | Filter Advisor containing “lane” | Asks, as after PR 1 |
| "accounts with no advisor assigned", "advisor is blank" | Asks | Show only rows where Advisor is empty |
| "accounts that have an advisor" | Asks | Show only rows where Advisor is not empty |
| "taxable accounts with no advisor" | Asks about "advisor" | Filter Registration type to Taxable; show only rows where Advisor is empty |
| "accounts with no advisor over $1m" | Filter Market value above $1,000,000 | Asks |
| "no gain" | Asks | Asks: an amount column could be empty or zero |
| "no restricted holdings" | Show only rows where Restricted holdings is No | Unchanged |
| "no accounts over $1m", "accounts with no gain over $50k" | Filter Market value at or below $1,000,000; filter Unrealized gain at or below $50,000 | Unchanged |
| "there is no advisor I trust" | Asks about "advisor" | Asks about "there" and "I" (4.2) |

- **Empty is read for text, category, date and date-and-time columns.** On a number, currency or percent column it asks. A yes/no column keeps today's reading.
- **The Row Noun is never the column of an empty form,** even where it is also a column's alias. "No accounts" is about the rows.
- **Empty means no value:** null, missing, or an empty string, as `evaluate.ts` has it. A placeholder such as "Unassigned" is a value. A Host can make "unassigned" a House Term (5.3).
- **An empty form followed by an amount or a comparison asks.**
- **The column must allow the operator.** A Host's `allowedOperators` can turn any of these off, and the request then asks.
- **`advisor is "Lane"` stays "containing".** With Local Values off it is the main way to find a name, and "containing" still finds "Lane, Avery". Would change if: held-out labellers mark `is "x"` as exact more often than not.

### 5.3 House Terms (PR 3)

```ts
defineSchema(columns, {
  houseTerms: [
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

- **`defineSchema` checks each condition** the way validation checks a filter in a plan: the column exists, is not restricted, may be filtered, allows the operator, and the value fits its kind. A bad one throws `INPUT_SCHEMA`.
- **A term's names must be its own.** `defineSchema` throws when a label or alias is also a column's, a value's, a Value Group's, the Row Noun, an entity word, another term's, or one of GridCue's own words ("top", "largest", "empty", "today").
- **A term is found as a whole word,** like a value's name, with no plural form. "Large" and "largest" are different words.
- **It adds each condition as an ordinary filter.** The Preview names the term on each line (4.5).
- **A term is never sent to a provider** (4.3).

| Request | Today | After |
| --- | --- | --- |
| "large accounts", "show the big accounts" | Asks | Filter Market value above $1,000,000 (Large) |
| "show large taxable accounts" | Filter Registration type to Taxable. "Large" is dropped | Both filters |
| "accounts that need attention" | Asks | Filter Concentration above 10% (Needs attention); show only rows where Restricted holdings is Yes (Needs attention) |
| "large accounts over $5m" | Asks | Filter Market value above $1,000,000 (Large); filter Market value above $5,000,000 |
| "accounts that aren't large", "hide large accounts" | Asks | Asks: "GridCue can't leave out “large” yet. Ask for the rows to keep, such as “market value at or below $1,000,000”." |
| "sort by large" | Asks: no column called "large" | Asks |
| "large or taxable accounts" | Asks | Asks: either-or, as today |
| "largest accounts" | Asks which column to sort by; the wealth fixture declares no `defaultMeasure` | Unchanged. "Largest" is a size word, not the term (ADR 0018) |

Would change if: a Host's real terms mostly need "or" or a moving date; or held-out requests leave a term out often, which reopens the opposite reading on a fresh set.

### 5.4 Local Values (PR 4)

```ts
createGridCue({
  adapter,
  provider,
  localValues: {
    advisor_name: () => rows.map((row) => row.advisor_name),
    household: () => rows.map((row) => row.household),
  },
});

// gridcue/tanstack-table: every loaded row, whatever the table's filters
createGridCue({ adapter, provider, localValues: localValuesFromTable(table, ["advisor_name", "household"]) });
```

- **Off unless set.** Allowed only for text columns that are exposed, not restricted, and may be filtered. Anything else throws `INPUT_CONFIG` when the Controller is made.
- **The Host says where the values come from.** For a grid that pages, that is the Host's own list, not the page.
- **The function is synchronous.** GridCue calls it when a request is made, drops empty and repeated values, and builds a word index. It keeps the index while the function returns the same array.
- **A function that throws stops the request.** The status is `error`, with the code `INPUT_LOCAL_VALUES` and "Couldn't read this grid's values. The view hasn't changed." GridCue never reads a request with half its values.
- **A whole value is read:** every word of it, in order, as whole words, ignoring letter case and the punctuation between words. There is no plural form. The filter is "exactly" that value, in the grid's own letter case. Several values of one column make one filter.
- **The longest name wins.** "The Alder household" is the value Alder Household, not the Household column or an entity word. An amount inside a value ("Fund 7") is part of the name.
- **A value made only of GridCue's own words** (4.2's lists) is never read from the grid. It can still be quoted.
- **Ties ask.** A value that two columns hold, or that is also a declared name, asks which was meant.
- **One word of a value asks.** A word that no list in 4.2 places, and that is a whole word of one to five values, asks which was meant. More than five: "12 Advisor values contain “lee”. Type the full name." A word that is a declared name or one of GridCue's own words is never offered.
- **The answer stays in the browser.** Choosing a value uses it as if it had been typed whole. "None of these" says nothing will change.
- **A request GridCue refuses stays refused.**

| Request | Today | After |
| --- | --- | --- |
| "Avery Lane's accounts", "accounts for Avery Lane", "advisor is Avery Lane" | Asks | Filter Advisor to exactly “Avery Lane” |
| "the Alder household" | Asks | Filter Household to exactly “Alder Household” |
| "Avery Lane or Blake Moreno" | Asks | Filter Advisor to any of “Avery Lane” and “Blake Moreno” |
| "show taxable accounts for Avery Lane" | Filter Registration type to Taxable. The name is dropped | Both filters |
| "Avery Lane's taxable accounts over $1m" | Asks | Three filters. The amount's column comes from the provider or the kind rule, as today |
| "sort by market value for the Alder household" | Sort by Market value, then Household | Filter Household to exactly “Alder Household”; sort by Market value |
| "group by advisor for Avery Lane" | Group by Advisor. The name is dropped | Filter Advisor to exactly “Avery Lane”; group by Advisor |
| "Lane's accounts", "taxable accounts for Lane" | Asks; Taxable alone | Asks: "Did you mean Advisor: Avery Lane?" |
| "sort by Avery Lane" | Asks: no column called "avery lane" | Asks: "Avery Lane is a value in Advisor, not a column." |
| "hide Avery Lane", "everyone except Avery Lane" | Asks | Asks |
| "Avery Lane called about the trust accounts" | Asks | Asks about "called about" (4.2) |
| "assign Avery Lane to the taxable accounts" | Asks, where a refusal is labelled | The same |
| `advisor containing "Lane"` | Filter Advisor containing “lane” | Unchanged |

Would change if: the one-word question fires on ordinary words often enough to annoy, which drops it; or the held-out sets show it almost always has one choice that Users accept, which is evidence for reading it on a fresh set; or most Hosts use an adapter whose rows GridCue can read in full, which makes an adapter method less work for them.

### 5.5 Dates (PR 5)

```ts
defineSchema(columns, { calendar: { timeZone: "America/New_York", fiscalYearStart: 1 } });
createGridCue({ adapter, provider, now: () => new Date() });
```

**The forms.** T is today in the calendar's time zone. N is a whole number from 1 to 999, in digits. The examples take T as 2026-11-13, with the year starting in January.

| Form | Meaning | Example |
| --- | --- | --- |
| "today", "yesterday" | That day | 2026-11-13; 2026-11-12 |
| "last N days", "past N days"; the same with weeks, months, years | From the day N units before T, through T. A week is 7 days. A month day that doesn't exist is that month's last day | "last 90 days": 2026-08-15 to 2026-11-13 |
| "this month", "this quarter", "this year" | The whole period that holds T | "this quarter": 2026-10-01 to 2026-12-31 |
| "last month", "last quarter", "last year" | The whole period before it | "last quarter": 2026-07-01 to 2026-09-30 |
| "month to date", "quarter to date", "year to date", "MTD", "QTD", "YTD" | From the period's first day, through T | "YTD": 2026-01-01 to 2026-11-13 |
| "between A and B", "from A to B", "from A through B", with two ISO dates | Both ends included. Written high to low, the ends are swapped | "between 2026-01-01 and 2026-03-31" |
| One ISO date with a comparison | As today | "opened after 2026-01-31" |

- **A form may follow** "in", "in the", "over the", "during", "during the", "within the" or "for the".
- **A comparison word before a relative form asks:** "before this quarter", "since last month".
- **Every other time word asks and is never dropped.** That includes "this week" and "last week". A part that holds a day, week, month, quarter or year word, "ago", "next", "recent", a month name, a slash date ("1/31/2026"), or a quarter by number ("Q1"), outside a form above and outside a declared name, asks: "I'm not sure which dates “since january” means. Use dates like 2026-01-31, or “last 90 days”." "May" counts only before a number.
- **A grid with no date column asks:** "This grid has no date column for “year to date”."

**Which column.** The date goes to the date column named right before the form: "opened in the last 90 days". That now also holds right after the Row Noun or a value, where the name is lost today: "accounts opened this quarter", "taxable accounts opened after 2026-01-31". With no date column named, nothing changes: the provider's pick decides, or GridCue asks which column.

**The calendar and the clock.**

- `timeZone` is an IANA name. It defaults to the browser's, taken when a request is read or a row is filtered, never when the schema is built. A bad name throws `INPUT_SCHEMA`.
- `fiscalYearStart` is a month, 1 to 12, default 1. Years, quarters and their "to date" forms follow it.
- `now` returns the current time. It defaults to the system clock. Tests pass a fixed one. A `now` that throws stops the request with the code `INPUT_CLOCK`, and the view does not change, as with a `localValues` function (order plan, D5).
- Day arithmetic is done on calendar days, never by adding hours, so a clock change can't move a date.

**What the view keeps.** The fixed dates, as ordinary filters with today's operators. The protocol and the View State don't change. A view applied today shows the same dates next month.

**Whole days.** A date in a filter means the whole day in the calendar's time zone.

- For both date kinds, a cell is first turned into its day. A date string is that day. A `Date`, or a string with a time and an offset, is the day that instant falls on in the calendar's time zone. A string with a time and no offset is its own date part.
- A cell GridCue can't read as a date matches no date filter.
- A filter value that holds a time is compared as an instant. GridCue never writes one from a request.
- `applyView` reads the calendar from the schema. The TanStack Table adapter stores the time zone beside the column's kind, so `gridcueFilterFn` gives the same rows.
- With this in place, PR 1's question about date-and-time columns is removed.

| Request | Today | After |
| --- | --- | --- |
| "accounts opened in the last 90 days" | Asks how to compare with "90" | Filter Opened date from 2026-08-15 to 2026-11-13 (last 90 days) |
| "taxable accounts opened this quarter" | Filter Registration type to Taxable. The rest is dropped | Filter Registration type to Taxable; filter Opened date from 2026-10-01 to 2026-12-31 (this quarter) |
| "opened YTD" | Asks | Filter Opened date from 2026-01-01 to 2026-11-13 (YTD) |
| "opened between 2026-01-01 and 2026-03-31" | Asks about each date | Filter Opened date from 2026-01-01 to 2026-03-31 |
| "accounts opened after 2026-01-31" | Asks which column | Filter Opened date after 2026-01-31 |
| "accounts contacted this week", "contacted last week" | Asks | Asks: "I'm not sure which dates “this week” means. Use dates like 2026-01-31, or “last 90 days”." |
| "last contact after 2026-01-31", date-and-time column | Wrong rows; asks after PR 1 | Filter Last contact after 2026-01-31, with the note "Whole days, in America/New_York time" |
| "opened before this quarter", "opened 90 days ago", "opened in 2024", "opened after Jan 31, 2026" | Asks | Asks, with the date question |
| "taxable accounts since january" | Filter Registration type to Taxable | Asks |
| "accounts over $1m in the last 90 days" | Asks | The amount as today. The date takes the provider's pick, or GridCue asks which date column |

Would change if: the held-out set shows Users mean two things by a listed form, which moves that form to "asks"; or a Host with data booked in one time zone and Users in another reports a view off by a day, which turns relative dates off until the Host sets `timeZone`; or Hosts ask for saved views that roll forward, which needs a relative value in the protocol.

## 6. Public API and protocol

All additive. Nothing is removed or renamed. The option for House Terms is `houseTerms`, not `terms`: the root entry already exports `unknownTerm`, where a term is a name GridCue didn't recognise (order plan, D5).

| Addition | Entry | PR |
| --- | --- | --- |
| `Literal.match`: `"startsWith"` or `"exact"`, on quoted text | root | 2 |
| `readCodeFilters`, `CodeReadFilter`, `CompileInput.codeRead`, for callers that run `compile` themselves | root | 2, grown in 3 to 5 |
| `SchemaOptions.houseTerms`, `ViewSchema.houseTerms`, `HouseTerm` | root | 3 |
| `GridCueOptions.localValues`, `LocalValues` | root | 4 |
| `INPUT_LOCAL_VALUES` | root | 4 |
| `localValuesFromTable(table, columnIds)` | `gridcue/tanstack-table` | 4 |
| `SchemaOptions.calendar`, `ViewSchema.calendar`, `Calendar` | root | 5 |
| `GridCueOptions.now`, `INPUT_CLOCK` | root | 5 |
| `normalize(text, { today, calendar })`. Without `today`, relative forms ask | root | 5 |
| `Literal.words`: the date words a literal came from | root | 5 |
| `matchesPredicate(value, predicate, column, { timeZone })` | root | 5 |

Changed wording, not shape:

- Preview lines for an exact text filter and the two empty filters (PR 2), a House Term (PR 3), and every date filter (PR 5). Section 9 lists them. `Preview.notes` gains the whole-days note.
- New questions, all through the existing `Clarification` shape.

The resolution protocol stays 0.1. The provider request is the same for every labelled request (4.3). `Literal.match` and `Literal.words` are core-only fields and are not sent (4.3), so no field is added to the protocol. `gridcue/react`, `gridcue/server` and `gridcue/mock` change only where a type they re-export gains a field.

## 7. ADRs

Four, in `docs/adr/`, accepted with this spec. Each is in before the PR that needs it.

**ADR 0023: Beside a code-read filter, every word is placed** (PR 2). A House Term, a Local Value, an empty or text form and a date form are read by code, and a provider is not asked about them. So a part that holds one is ready only when every word in it is a name, an amount, or one of a closed list of GridCue's own words; any other word asks, and the provider's picks are limited to what the words name. Without this, a declared value's rules preview a filter for "Avery Lane called about the trust accounts". A part with none of these readings is read as before. This is the first slice of ADR 0020's closed grammar and is replaced by it. It extends ADRs 0019 and 0022 and overturns neither.

**ADR 0024: House Terms** (PR 3). A Host can declare a named list of fixed conditions on its columns, such as Large = Market value above $1,000,000. `defineSchema` checks the conditions like a plan's filters and refuses a name already in use. Code reads the term and adds its conditions as ordinary filters joined by "and"; the Preview states each condition and names the term, so the User sees the threshold and not just the word. A term is never sent to a provider, never holds "or" or a moving date, and a left-out term asks. Evidence that real terms mostly need "or" or a moving date would reopen this.

**ADR 0025: GridCue reads Local Values in the browser** (PR 4). For the first time GridCue reads values from the grid's rows. It does so only for text columns the Host names in `localValues`, from a function the Host supplies, in the User's browser. Nothing about the values is sent to an Intent Provider: the request and the number of calls are the same as with the option off, and a test pins both. A whole value is read as an exact filter; one word of a value is only ever a question. The alternatives were a Grid Adapter method, which ties the values to what the adapter can see and changes its interface, and sending approved values as Candidates, which the fourth rule in `AGENTS.md` keeps out by default. This fills in the "distinct-value resolver" the product definition foresaw.

**ADR 0026: A date in a request becomes fixed days** (PR 5). A relative date ("last 90 days") is worked out once, when the request is made, from the Controller's clock and the View Schema's Calendar, and the view keeps the two dates. The View State is the record (ADR 0021), so it must not mean something else tomorrow. A date in a filter means the whole day in the Calendar's time zone, on date and date-and-time columns alike. The Calendar holds the time zone and the year's first month; the time zone defaults to the browser's. The alternative, a relative value in the View State, needs a new protocol version and a clock in every adapter and every Host query. The plan's evidence keeps the words so that door stays open.

## 8. Terms for `CONTEXT.md`

**Local Value**: A value of a text column that GridCue reads from the grid's own rows in the User's browser, with the Host's approval. It is never sent to an Intent Provider.
_Avoid_: Distinct value, facet, lookup

**House Term**: A Host-named list of fixed conditions on the rows, all of which must hold, such as Large = Market value above $1,000,000. It is never sent to an Intent Provider.
_Avoid_: Semantic alias, business rule, macro

**Calendar**: The Host's time zone and the first month of its year, which turn date words in a request into dates.
_Avoid_: Locale, date settings

The **Mention** entry gains one sentence: "A Local Value and a House Term are not Mentions either: a Mention is sent to the Intent Provider, and they never are."

## 9. UI

**No component, layout, style or motion changes.** Both UIs already show Preview lines, Preview notes, and a question with choices as wrapping buttons. What a User sees that is new is words: Preview lines, one note, and questions. The design pass below was run on those words with `emil-design-eng`, `better-ui` and `principle-experience-first`. Nothing needs a prototype. The owner sees the table before PR 2's code.

| Before | After | Why |
| --- | --- | --- |
| "Filter Opened date above “2026-01-31”" | "Filter Opened date after 2026-01-31". Also "on or after", "before", "on or before", "on", and "from … to …". No quote marks | A date is not an amount. Each word is one `normalize` reads, so the line can be typed back |
| — | "Filter Opened date from 2026-08-15 to 2026-11-13 (last 90 days)" | The dates come first, because they are what applies. The words follow, so the User can check the reading |
| — | A note under a date filter on a date-and-time column: "Whole days, in America/New_York time" | The one thing the dates don't show. It uses the existing notes line, so both UIs show it with no new element |
| "Filter Advisor to empty" | "Show only rows where Advisor is empty", and "… is not empty" | Reads as a sentence, and matches the yes/no line "Show only rows where Restricted holdings is Yes" |
| "Filter Advisor to “avery lane”" | "Filter Advisor to exactly “Avery Lane”" | "To" alone can't be told from "containing" at a glance |
| — | "Filter Market value above $1,000,000 (Large)" | The User sees the threshold, not just the word |
| "Which column should be equal to avery lane?" | "Which column should contain “avery lane”?" | The question now says what the answer does |
| — | "Did you mean Advisor: Avery Lane?" with "Yes, Avery Lane" and "No" | Today's wording and buttons for a value GridCue is unsure of |
| — | With two to five values: "Which Advisor did you mean by “lane”?" Each choice is the value. The last is "None of these" | One click settles it. Six buttons at most, so the row wraps to two lines at worst |
| — | With more than five: "12 Advisor values contain “lee”. Type the full name." No buttons | A long row of names is slower to scan than typing one more word |
| "I'm not sure what to change for “…”", for most of these requests | Each new question names the words it means and says what to type instead: "Avery Lane is a value in Advisor, not a column.", "I'm not sure which dates “since january” means. Use dates like 2026-01-31, or “last 90 days”." | A question the User can act on in one edit. The request stays in the input, as today |
| A question or a Preview appears with no transition | Unchanged | They follow Enter, many times a day. Keyboard-driven changes never animate |
| The status row is the live region | Unchanged. New questions are announced through it | A screen reader hears the question; the choices are buttons in a labelled group, as today |

Checked in a real browser before PR 4 and PR 5 are called done, light and dark, in the Vite example, the Next.js example and the Site: six choices with long names at 320 px wide, a two-filter date Preview with its note, and keyboard order through the choices.

## 10. Evals and evidence bars

Every set is synthetic. Every held-out set is written and labelled before the code it tests, by a labeller who has not seen that code. A **form set** is written from this spec's section. A **natural set** is written from the product definition and the schema alone, by a labeller who has not seen the forms. A held-out wrong view sends the work back as a class, not a sentence; the set then joins the repo as a regression set, and the class gets a fresh held-out set.

| Mechanism | Dev set | Held-out set | Bar | Reported, no bar |
| --- | --- | --- | --- | --- |
| Fixes (5.1) | At least 30, wealth | At least 30, wealth | 0 wrong views on both. The 23 quoted-text cases stay exact. No existing verdict gets worse | Requests that are ready today and now ask |
| Every word is placed (4.2) | 20 sentences that hold an empty or text form and are not view requests, labelled ask or refused. Each of PR 3 to PR 5 adds 10 with its own reading | 20 more, also grown by 10 in each PR, and the natural sets below | None is ready | The share of natural requests labelled ready that ask because of one unplaced word, and which words. In PR 2, how many ready plans on every set hold a word the lists don't place, whether or not the part holds a code-read filter (D4) |
| The limit on a provider's picks (4.2) | 20 requests that hold a code-read filter, each with a scripted provider answer that proposes a sort, a column or a value for words the filter took. The labeller writes the answers before the code, the way ADR 0022's tests replay Jev's | 20 more. Each of PR 3 to PR 5 adds 10 to both | 0 wrong views: every pick the words don't name is dropped and recorded, or the plan asks | How many picks were dropped, by kind |
| Text forms (5.2) | 40 form cases, wealth and ledger | 40 form cases; a natural set of 30 | 0 wrong views on all three | Exact share; the natural set's ask rate |
| House Terms (5.3) | 40, both schemas, terms declared before labelling | At least 40 form cases, both schemas; a natural set of 30 | 0 wrong views | Exact share; how often a term is left out |
| Local Values (5.4) | 60, both schemas | Two form sets of at least 60, one for each schema; a natural set of 30 | 0 wrong views | Exact share; how often the one-word question fires, and with how many choices |
| The value index (5.4) | 50,000 distinct synthetic names | — | Built in at most 250 ms; a request looked up in at most 5 ms, median of 20 | Both figures at 1,000 and 10,000 |
| Dates (5.5) | 60, ledger, fixed clock | At least 60 form cases, ledger, fixed clock; a natural set of 30 | 0 wrong views | Exact share; which unlisted date wording turns up most |
| Date arithmetic (5.5) | Every form on a month end, a leap day, a year end, the first day of a quarter, and both clock-change days, in six time zones | The same forms on 1,000 random days, fixed seed, against an independent day counter | Every date equal | — |
| Whole days (5.5) | 2,000 random instants in six time zones, fixed seed: a row is kept exactly when its day in the zone is in the range | The same through the TanStack Table adapter | 0 rows differ, and both adapters keep the same rows | Time to filter 50,000 date-and-time rows |
| Provider request (4.3) | Every labelled request, old and new, with `houseTerms` and `localValues` on and off | — | The request is the same, byte for byte, on every one | — |
| Nothing old changes | Every existing labelled request (813 today), with the fixture's terms, values and calendar on | — | The same verdict and the same operations on every one | — |
| ADR 0019's check (4.4) | Every new labelled ready case | — | It blocks none when given the expected operations | — |

- **A natural set can hold a wrong view that section 3 puts out of scope:** a word nothing reads, dropped beside a reading, in a part with no code-read filter ("taxable accounts handled by the new team"). The bar does not move for it. It goes back as a class and is narrowed to a question, with a fresh held-out set, like any other wrong view. No new reading is added for it. The owner approved this as D4 in the order plan.
- **PR 2's count of unplaced words is a report, not a check.** The eval runner calls the placed-words lists on every ready plan. The compiler never runs them on a part with no code-read filter (4.2), so the report can't change a result.
- **Whole-day rows are compared in a test both Grid Adapters share,** `packages/gridcue/test/rendered-rows.ts`. PR 5 starts it with the whole-day, empty and exact-text cases. The operation set's PR 3 adds groups, order and totals to it.
- The six time zones are UTC, America/New_York, America/St_Johns, Europe/London, Asia/Kolkata and Pacific/Auckland.
- The gate (`pnpm check`) runs every set with the Mock Provider. A wrong view in any of them fails it.
- **Live runs with Jev need the owner's command.** Before each of PR 1 to PR 5 merges, one `--live` run confirms 0 wrong views and no drop in exact results against the last recorded run. The live run is the only check on what Jev itself proposes beside a term or a name it can't see. The scripted sets above check what code does with such a proposal.
- **A real Host application** is tested in a throwaway clone before PR 4 merges, with `localValues` on its name columns. Reported as counts only, with no value written down: how many of its values are also a declared name, how many are made only of GridCue's own words, and how often the one-word question would fire on its earlier request set.

## 11. Surfaces

| Surface | Applies | What changes |
| --- | --- | --- |
| Entry points | Yes | Root: everything in section 6. `gridcue/tanstack-table`: `localValuesFromTable`, and the time zone in its stored filter. `gridcue/react`, `gridcue/server`, `gridcue/mock`: types only. The Mock Provider's rules don't change |
| Both UIs | Yes, words only | No component changes. Both are checked with the new lines, the note and six choices |
| Frameworks and tables | Yes | The Next.js example (Rows Adapter) passes `localValues` from its rows. The Vite example (TanStack Table) uses `localValuesFromTable`. Both use the fixture's terms. The wealth fixture gains a date and a date-and-time column in PR 5 if every existing labelled request stays the same; otherwise both examples add a small ledger table. Both Grid Adapters pass the contract suite with the new date cases |
| The Site | Yes | The demo's suggested requests gain a term, a name and a date. Docs: `api/schema` (`houseTerms`, `calendar`), `api/create-grid-cue` (`localValues`, `now`), `api/adapters`, `concepts/requests`, `get-started/describe-your-domain`, `safety` (what is read in the browser and never sent), `guides/vite-tanstack`, `guides/next-rows-adapter`, `guides/going-to-production` (set `timeZone` when rows render on a server), `guides/build-an-adapter` (whole days and empty) |
| Agent skill | Yes | `skills/gridcue`: `houseTerms`, `localValues` for each adapter, `calendar`, and when to set `timeZone`. `pnpm check:skills` |
| Failure paths | Yes | Every new way in ends in a ready plan, a question, or a refusal. Cancel and Escape clear a question. "None of these" says nothing will change. Undo restores the view as for any plan. A stale Revision is rejected as today. A bad `houseTerms`, `calendar` or `localValues` throws when the schema or the Controller is made, with a stable code. A `localValues` function that throws stops the request with `INPUT_LOCAL_VALUES` and changes nothing. A `now` that throws does the same with `INPUT_CLOCK` |

Internal docs that change: `docs/internals/product.md` (the distinct-value resolver and "large" paragraphs), `docs/internals/architecture.md` (the dates line, the payload list), `docs/internals/intent-protocol.md` (the "big" example). The four bets spec's line 56 changes in PR 2, the PR that makes "starts with", empty and not empty reachable. The owner signed that edit off as D2 in the order plan.

## 12. Testing

- Unit tests for each fix in 5.1 and each control row.
- Unit tests for each form in 5.2 and 5.5, and each with one extra word, which must ask.
- Unit tests for the placed-words list: each kind, and each word named as off the list.
- `defineSchema` tests for every way a term or a calendar can be wrong.
- Controller tests for `localValues`: each config error, the index kept and rebuilt, ties, one to five choices, more than five, an answer, "None of these", and a refused request.
- The request-equality test of 4.3, and a test that the provider is called once whether or not a value matched.
- Tests with a fake provider that proposes a sort, a column and a value for the words a term or a name took. Each is dropped.
- Date table tests with a fixed clock, a `now` that throws, and the property tests in section 10.
- The adapter contract suite gains date, empty and exact-text filters in its state checks. It compares state, not rows, so the rows both Grid Adapters keep are compared in the shared rendered-rows test (section 10).
- Tests with a scripted provider for the limit on its picks (section 10).
- The browser bundle check still passes: nothing here imports server code.
- The real-browser checks in section 9.

## 13. Acceptance criteria

1. `pnpm check` passes with no credentials after each PR.
2. Every bar in section 10 is met and reported in its PR, with the numbers, misses included.
3. Each PR's description says which surfaces in section 11 it touched.
4. ADRs 0023 to 0026 are in before the PR that needs each, `CONTEXT.md` has the terms in section 8, and the docs pages in section 11 are current.
5. One live run with Jev, on the owner's command, before each PR merges.
6. PR 4 and PR 5 carry screenshots of the new questions and Preview lines in both UIs, light and dark.

## 14. Risks

- **The placed-words list is fitted to what it has seen.** It is a word list, not a grammar. The natural sets and the adversarial sets are the check, and ADR 0023 says the Local Resolver replaces it.
- **A name makes a request stricter.** A synonym a provider knows ("sorted by size") asks once the part holds a name or a term. The cost is measured, not assumed.
- **Nothing was run with Jev.** Every result here is from the Mock Provider or a provider that answers nothing. A provider may propose something for a word a term or a name took. 4.2 drops it and the live run checks it.
- **Real names collide with ordinary words.** Only the fixture's 5 advisors and 12 households were tested, and they were invented to be distinct. The real Host test reports the counts before PR 4 merges.
- **A value that holds an instruction word** ("… and Show Stoppers Inc") can be split across two parts. It then asks; it is never read in part.
- **The browser's time zone is the default.** A Host that books data in one zone, with Users in another, can show a view off by a day. The Preview shows the dates and the note names the zone. Rows filtered on a server use the server's zone unless `timeZone` is set; the docs say to set it.
- **A fiscal year start changes "this year".** A User may still mean the calendar year. The Preview shows both dates.
- **A saved "last 90 days" view goes stale.** The User asks again. ADR 0026 says what would change this.
- **Date Preview wording changes for every date filter,** including ones read today. No labelled case holds a date; tests that pin the old words are listed in PR 5.
- **Adding date columns to the wealth fixture** could change a provider's picks. Section 11 names the fallback.
- **The headline request still asks.** A House Term settles "need attention"; the sort wording and "in one security" are not in this work.

## 15. Meeting the four bets and the other opportunities

- **Local Resolver grammar (four bets 5.4, ADR 0020).** Each form here is a fixed set of words around a declared name, a Local Value, a House Term, a whole number or an ISO date. The tables in 5.2 to 5.5 become rows of its grammar. A Local Value and a House Term join "declared name" in its rule that every word is accounted for. Section 4.2's list is that rule without positions; the grammar replaces it and must give the same result on every set in section 10.
- **`controller.read` (four bets 5.2).** `readCodeFilters` returns a span and a kind for each reading, so each becomes a mark: "Avery Lane: Advisor is exactly Avery Lane", "last 90 days: from 2026-08-15 to 2026-11-13". `read` is synchronous, which is why `localValues` is. It reuses the index from the last request and must not rebuild it on each keystroke; when it refreshes is for the bets to decide.
- **`describeView` (four bets 5.3).** The sentence words what these requests leave in the view so that it types back with no provider: `Advisor is exactly "Avery Lane"`, which does not depend on the rows still holding the value; "Opened date from 2026-08-15 to 2026-11-13"; "Advisor is empty"; `Advisor starting with "Av"`. A House Term leaves ordinary filters, so the sentence words the filters, not the term. "Starts with", empty and not empty become typeable, so the four bets spec's line 56 no longer lists them (PR 2). OR stays unreachable.
- **`proposeView`.** Nothing new: the View State keeps plain filters with fixed dates.
- **One vocabulary (four bets 4.2).** The date words, "exactly", "is empty" and "starting with" go in the shared words module, or in `preview.ts` until it exists. `normalize` reads each one the Preview prints.
- **The second schema.** It is added here first (4.6). The bets and more grids reuse it.
- **More grids (opportunity 3).** A Host whose rows live on a server passes its own list to `localValues`, or leaves it off. A Host's own data query and any new Grid Adapter must copy three meanings: empty, exact text without letter case, and whole days in the calendar's time zone. The Query Check and the AG Grid adapter are built after PR 5 (order plan), so their table of filter meanings and their cases carry all three from the start.
- **Routing and saved views (opportunity 4).** The longest-name rule runs before any routing rule, so the words of a whole Local Value ("the Alder household") are a name and never an entity noun. Routing's rule for another grid's rows lets a House Term or a Local Value of this grid stand before that grid's noun ("large households"), so such a request offers the grid or asks, and never filters this grid without the User's choice. A saved view whose name is also a House Term or a Local Value asks, as it does for a value. A saved view holds fixed dates.
- **The command bar (opportunity 5).** `localValues` has the shape of its `countRows`: a Host-supplied function on `createGridCue`. A value field in an edited Preview takes one ISO date; a relative form is refused there. Lines that one House Term made drop together. A line that carries a term's label or date words can be dropped, not changed, so the words in brackets are never left on a filter they didn't make.
- **The operation set (opportunity 2).** Its closed view words (`core/view-words.ts`, built first) and 4.2's lists are slices of one idea. `core/placed.ts` imports the operation set's form words; neither module lists a word the other already has. They stay two modules, a reader and a check, until the Local Resolver's grammar replaces both.
