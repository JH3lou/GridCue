# A ready plan uses everything GridCue read

A plan is ready only when every amount, quoted text, date, and name that code read from the request is used by one of the plan's operations. When something read is left over, GridCue asks about it and names it, and nothing can be applied.

In 0.2.0, "Accounts over $1M grouped by custodian" could preview "Group by Custodian" alone. The amount was read and then dropped, and the Preview was ready to apply (four bets grill, 2026-11-10). Validation checked that each operation was allowed. Nothing checked that the plan covered the request. The owner chose to add that check in core, for every provider, over fixing each provider that drops something.

What counts as read, and as used:

- **An amount, quoted text, or date** is used when a filter in the plan holds its value. Each filter accounts for one of them, so the same amount said twice needs two filters. A count ("top 10") is used by `limit.set`, or by the `dropped:` evidence ADR 0018 already records when the grid can't limit rows.
- **A named value** ("Roth") is used when a filter on its column holds it. An excluded value ("non-retirement") is used when a filter on its column leaves it out.
- **A named column** is used when any operation in the plan names it. Quoted text that is exactly a column's name (`hide "market value"`) is that column's name, not text to filter by.

What is not counted:

- a name the grammar read as the rows, which is never a Mention;
- a name still marked ambiguous;
- the grid's own Row Noun, unless the words make it a column ("by account", "the account column"). In "group by the advisor on the account" it may mean the rows, so a plan that leaves it out is not blocked;
- a name the plan dropped and recorded as `dropped:` evidence, whether the provider or the User said it means the rows, or its score fell under the floor of ADR 0013;
- the other values named for a column once the User has picked one of them ("Northgate or Harborline", answered "Harborline");
- anything in a part that clears or resets.

The last four were found by running the check over every labelled case, not predicted.

The check runs as the compiler's last step, so every caller gets it, and the plan's own status says what happened. It can turn a ready plan into a question. It can never make a plan ready.

A second rule closes the same gap for comparisons. An amount whose comparison GridCue couldn't read leads to a question, never to "equal to". "Equal to" is used only when the wording says so ("=", "equals", "exactly"), or when the amount directly follows its column's name ("market value $750k", "value is $750k") and nothing after it qualifies it ("$1m or so"). Before this, "market value > $1m" filtered to exactly $1,000,000.

The cost is a question where a provider would have guessed. That is the trade the second rule in `AGENTS.md` already makes. The check must never block a correct plan: every labelled case whose expected plan is ready passes it with its expected operations, and that test runs in the gate. On 2026-11-10 that was 0 blocked.
