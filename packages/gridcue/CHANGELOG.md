# Changelog

## Unreleased

**Safety** (ADR 0019)
- A ready plan uses everything code read. The compiler's last step turns a plan that leaves an amount, quoted text, date, count or name unused into a question that names it ("I'm not sure what to do with “$1m”. Try rephrasing that part."), with any provider. "Accounts over $1M grouped by custodian." no longer previews the grouping alone.

**Resolution**
- Comparison symbols `>`, `<`, `>=`, `<=`, `=`, `≥` and `≤` are read with or without spaces. "Market value > $1m" filtered to equal $1,000,000.
- "At or above", "at or below", "over or equal to", "greater than or equal to", "less than or equal to", "on or before", "on or after", and after the amount "or more", "or less", "or later", "or earlier", "at most", "at the most", "at least", "max", "minimum", "exactly" and "+" are read. "Since" a date includes that date.
- "No greater than" and "not more than" read as at most; "no lower than" and "not less than" as at least. "Not over", "not above" and `=/=` are asked about.
- An amount is read only when what follows it is the end of the part or something GridCue reads (a name, an amount, a view verb), so "$1M, roughly", "over $1M or so", "$1M with a margin" and "$1M give or take" are asked about. With no comparison word it is "equal to" only when it sits right by its column ("market value $750k", "opened on 2024-01-01", "accounts with 5 positions"); "around $1M" and "!= $1M" are asked about.
- A minus sign, "negative" or "minus" right before an amount makes it negative: "gain below -$50k" filtered to $50,000. A hyphen between two amounts or words is unchanged.
- "Between A and B" and "from A to B" are ranges, lower bound first. A bound with no unit takes the other bound's only when that is certain ("between 10-20%", "between -10 and -5%", "between $1-2m"); "between $1 and 2m" is asked about.
- "Gain at least $100k" and "gain from $10k to $50k" name Unrealized gain. "At" and "from" on their own still describe the rows ("accounts at Northgate", "accounts from Northgate").
- A column named before an amount it can't hold is asked about: "gain over 10%" filtered Concentration. The grid's `rowNoun`, other entities, and, with no `rowNoun`, a column that holds no amount still mean the rows ("accounts over 10%").
- An amount or quoted text before another change's verb filters too: "accounts over $1M grouped by custodian".
- "Or" between conditions on different columns, or at the start of a part, is asked about, since filters combine with "and": "over $1M or at Northgate" filtered both. "Northgate or Harborline" is still one filter.
- A part that leaves rows out keeps the complement of one simple condition: "hide taxable accounts" keeps the other registration types, "exclude accounts over $1M" keeps at most $1M. Each filtered to the rows named. More than one condition, a second negation, or "except" is asked about.
- A clear or reset of the view's filters that says what to keep keeps it only when the view already has it: "clear filters except accounts over $1M". "Clear the market value filter" clears only that column's filters when the current filters are one "and" list. Each previewed a plain clear. "Remove northgate accounts except trusts" is no clear and is asked about.
- A clear of one named column after another change to the same thing in the request ("clear the market value filter and clear the gain filter") is asked about.
- "Reset everything except the filters" is ready only when the default view has no filters of its own; otherwise the reset would add them to the kept ones, so it is asked about. `compile` takes the view a reset returns to as `defaultState`; the Controller passes it.
- No filter is read from a part whose first word is unknown and acts on something ("close all trust accounts", "mark the taxable accounts as reviewed"). Verbs GridCue reads only for columns (add, put, move, pin, arrange, bring, place, shift) count as a view request only when their object is columns ("add the custodian column"); on rows ("move the IRA accounts to Harborline") they are asked about.
- Quoted text is never split by punctuation inside it, and never read as an instruction, one of the Host's values, or a column name outside a column slot (`advisor containing "custodian"`).
- A name declared with a trailing symbol ("account #") is read whole, and words inside a declared name ("Advisor Group") are never read as a verb.
- Amounts in questions are formatted like the preview's ("above 1,000,000").
- "Or later", "and earlier", "at the latest" and the like are read only after a date; after any other amount they are asked about.
- A range borrows a scale only in the compact form from the second bound ("$1-2m"), and a percent sign from the second bound with any join ("between 10 and 20%"). "Between $1m and 2" and "between 5 and 50k" are asked about.
- "Don't show", "never show" and "no longer show" leave rows out like "hide"; "hide accounts where gain is below $0" keeps the other rows instead of hiding Account number.
- A part that stops on "and", "or", "but", "then" or "the" is asked about. A column named with nothing said about it ("and the advisor") is asked about.
- What a clear keeps is checked against the current filters: never a negated value ("except non-restricted"), never one value of a filter that holds several, and never from filters that match any one of them. "Keep the grouping" or "keep the sort" restores it after a reset. Each question says why.
- A name ending in a symbol ("Available Cash $") keeps it, and a size word and count inside a name ("Top 10 Holding") are part of it.
- Leaving a value out of a column that shows one value at a time says so, with no choices.
- A negation in front of any verb other than "show" is asked about: "don't hide trusts", "don't sort by gain" and "never group by custodian" each did the thing they said not to. So is a negation said twice, a negation inside a sort, group or hide list ("sort by gain, not value"), "not containing", and "nothing over $1M".
- A clear applies only to what its verb governs: the sort, grouping or filters right after it, or a list of them. "Clear the sort, the grouping stays" and "ungroup, leave the sort alone" cleared the wrong thing or both. "Clear everything but the sort" keeps the sort. "Ungroup" on its own clears the grouping.
- A range written high to low is put in order when both bounds carry a scale or neither does ("from $5M to $1M"). With a scale on only one ("between $1M and $2") it is asked about.
- A possessive before the rows ("the advisor's accounts over $1M") and another record's name before "sorted" or "grouped" ("households sorted by value") describe the rows.

- "Reset to default", "reset my accounts view" and "remove the account name filter and the sort" are read as before.

**Provider proposals** (ADR 0022)
- A column or value a provider picks from a word that appears only inside quoted text is dropped: `advisor containing "restricted"` added a Restricted holdings filter with Jev.
- A plan that clears fewer things than the clear verb governs is asked about: "clear filters, grouping" cleared only the filters with Jev. A governed clear the provider scores at or above the Host's `clarify` band is used.
- In a part that only clears or resets, any other change a provider proposes is dropped: "clear everything but the sort" previewed a hide of columns nobody named.

**Preview**
- An amount is stated exactly, below a cent too ("$0.0004"). "Market value $1.50" previewed "to $2", and a percentage was rounded to one decimal.

**Mock Provider**
- A yes/no column in a column list ("the advisor and restricted holdings columns", "hide the restricted holdings column") is a column, not a filter. "Hide restricted accounts" hides those rows; "hide restricted households" and "hide restricted accounts at Northgate" are asked about.
- It answers which column each amount belongs to (`literalColumns`): the column named right before it, else the one named column free to hold it, else the Host's default for its kind.
- It reads a part as a filter only when its first word is one it knows, or names something ("clients with more than $5M").

## 0.2.0 (2026-10-27)

**Resolution** (ADR 0018)
- Several changes in one line without punctuation: a part also splits where a different kind of change starts mid-line ("grouped by household sorted largest to smallest" is two parts). "Roth IRAs grouped by rep" and "show accounts where value is over $1M" stay one part.
- Direction phrases: "largest to smallest", "biggest to smallest", "top", "largest" and "biggest" sort descending; "smallest to largest" and "smallest" ascending. "Largest to smallest" no longer sorts ascending.
- `defaultMeasure` on the schema names the grid's main value column. "Top accounts", "largest to smallest" and "smallest first" sort by it when no column is named, instead of asking. Column synonyms stay `aliases`.

**Operations**
- `limit.set` shows only the first `count` rows of the sorted view, with its own preview line ("Show only the first 10 rows"). "Top 10" produces it where the adapter lists it; the Rows Adapter does. Elsewhere the plan sorts alone and `Preview.notes` says the count was not applied. `ViewState.limit` is optional.
- `compile` takes the adapter's `operations`; the Controller passes them.

**Platform**
- `engines.node` is now `^22.23.4 || ^24.22.1 || >=26.12.1`, the releases with the Node.js October 2026 security fixes. Node 20 is no longer supported.

## 0.1.0 (2026-09-25)

The first release.

**Resolution**
- One package, `gridcue`, with the `gridcue/react`, `gridcue/server`, `gridcue/mock` and `gridcue/tanstack-table` entries.
- The Controller runs each request:
  1. normalize it and screen restricted columns;
  2. ask an Intent Provider closed questions;
  3. compile a View Plan, then validate and preview it;
  4. apply it atomically;
  5. undo it on request.
- Deterministic name matching (Mentions), with grammar rules that tell the rows from a column (ADR 0013).
- Precedence rules for competing changes (ADR 0012), and several changes per part through the fan-out questions (ADR 0014).

**Providers**
- The Jev provider has two strategies, `"focused"` and `"fan-out"` (the default), with per-signal toggles (ADR 0015).
- A Mock Provider for keyless development and tests.

**Domain declarations**
- `rowNoun`, column `entity`, and `valueGroups` (ADR 0015).

**Safety**
- View-only: GridCue never changes data.
- Preview before apply.
- Restricted columns are refused before any provider call.
- No provider key ever reaches a browser bundle; `pnpm check:bundles` enforces this.

**Reliability**
- A provider time limit (`providerTimeoutMs`, default 8 s). When it passes, the view returns to idle and the request is kept.
- Apply and undo never stick: a failed write restores the previous view.
- Answering "No" ends with a clear "nothing will change".
- A new filter replaces the current filters unless the request says to add ("also", "only those", "narrow it down"), as sorts and groupings already do, and the Preview names the filters it removes (ADR 0017).
- Undo steps back through every applied change in turn, to the starting view. It stops at a manual change instead of erasing it.
- Nothing in a request is dropped silently. A direction beside another change ("trusts, largest first") asks which column to sort by. When no answer was given on whether a part adds a level ("also group by advisor") or which level is outer ("group by advisor within custodian"), GridCue asks instead of guessing. This happens with the focused strategy, the Mock, or a provider that doesn't ask those questions.
