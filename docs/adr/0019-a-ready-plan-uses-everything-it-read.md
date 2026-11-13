# A ready plan uses everything GridCue read

A plan is ready only when every amount, quoted text, date, and name that code read from the request is used by one of the plan's operations. When something read is left over, GridCue asks about it and names it, and nothing can be applied.

In 0.2.0, "Accounts over $1M grouped by custodian" could preview "Group by Custodian" alone. The amount was read and then dropped, and the Preview was ready to apply (four bets grill, 2026-11-10). Validation checked that each operation was allowed. Nothing checked that the plan covered the request. The owner chose to add that check in core, for every provider, over fixing each provider that drops something.

What counts as read, and as used:

- **An amount, quoted text, or date** is used when a filter in the plan holds its value with the comparison it was written with. Each filter accounts for one of them, so the same amount said twice needs two filters. A count ("top 10") is used by `limit.set`, or by the `dropped:` evidence ADR 0018 already records when the grid can't limit rows.
- **A named value** ("Roth") is used when a filter on its column holds it. An excluded value ("non-retirement") is used when a filter on its column leaves it out.
- **A named column** is used when any operation in the plan names it. Quoted text that is exactly a column's name in a column's place (`hide "market value"`) is that column's name, not text to filter by.
- **In a part that leaves rows out** ("hide taxable accounts", "exclude accounts over $1m"), the opposite filter counts as using what was named: a filter that leaves the value out, or the complementary comparison.

What is not counted:

- a name the grammar read as the rows, which is never a Mention;
- the grid's own Row Noun, unless the words make it a column ("by account", "the account column"). In "group by the advisor on the account" it may mean the rows, so a plan that leaves it out is not blocked;
- another record's name where the words make it describe the rows: a possessive before the Row Noun ("the advisor's accounts", "advisors' Roth accounts"), or directly before "sorted", "ordered" or "grouped" ("households sorted by value");
- a name the plan dropped and recorded as `dropped:` evidence, whether the provider or the User said it means the rows, or its score fell under the floor of ADR 0013;
- the other values named for a column once the User has picked one of them ("Northgate or Harborline", answered "Harborline");
- in a part that clears, the columns it names, since those are what it clears. An amount, a value, or quoted text in a clearing part still counts.

All but the first were found by running the check over every labelled case and by review, not predicted. Two exemptions in the first draft turned out to hide wrong views and were narrowed. "Any name still marked ambiguous" let "market value over $1m and the advisor" pass with Advisor dropped; now only the Row Noun is exempt. "Anything in a part that clears" let "clear filters except accounts over $1m" pass as a plain clear; now only the cleared columns are exempt.

The check runs as the compiler's last step, so every caller gets it, and the plan's own status says what happened. It can turn a ready plan into a question. It can never make a plan ready.

A second rule closes the same gap for comparisons. An amount whose comparison GridCue couldn't read leads to a question, never to "equal to". "Equal to" is used only when the wording says so ("=", "equals", "exactly"), or when the amount sits directly with its column's name ("market value $750k", "value is $750k", "accounts with 5 positions"). The words after any amount must be ones GridCue reads: the end of the part, a comparison ("or more", "at the most"), or the start of something else it reads. So "$1m or so", "$1m, approximately", and "$1m or later" ask. Before this, "market value > $1m" filtered to exactly $1,000,000.

The cost is a question where a provider would have guessed. That is the trade the second rule in `AGENTS.md` already makes. The check must never block a correct plan: every labelled case whose expected plan is ready passes it with its expected operations, and that test runs in the gate.
