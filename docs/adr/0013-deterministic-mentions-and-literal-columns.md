# Deterministic Mentions, literal columns, and a pinned Jev model

**Mentions.** Before the provider call, core matches the Host's declared column labels and aliases, and enum value labels and aliases, as whole words in each Clause. Plurals match. A name that matches more than one column or value is left to the provider.

A column-name match that sits where the rows go is not a column reference. That means a match:

- directly after another matched name ("Roth accounts");
- before a qualifier ("accounts with …");
- before "by" ("sort households by assets");
- before a comparison with a literal its kind can't hold ("accounts over $1M", where Account number is text), or with no literal at all, where the word is a preposition ("accounts under each advisor");
- directly after a superlative, unless the column is yes/no ("biggest accounts first"; but "the most restricted accounts" still names Restricted holdings).

A match directly after "by" or "on", or directly before "column", is always a column.

**The rules lean toward "the rows" on purpose.** A name wrongly read as the rows falls back to the provider, which usually gets it or asks. A name wrongly read as a column overrides the provider and proposes a wrong view.

**Two signals for columns.** A named value counts as confidence 1 with source `deterministic`. A named column does too, unless the provider scores that column below **0.40**, in which case it is dropped. So the provider is still asked about named columns.

The grammar rules and the provider fail on different requests:

- In "Biggest accounts first", "Group by who manages the account" and "Sort by how concentrated the account is", no grammar rule fired. Jev scored Account number 0.02 to 0.05.
- On the labelled requests, Jev scored every real column mention at 0.46 or higher. Every row-noun hit the grammar missed scored 0.36 or lower.

The 0.40 floor is a compiler constant.

This follows the architecture's rule that deterministic code owns parsing. Live, Jev scored the declared alias "rep" at 0.83. It missed "Summit Trust" (0.03), and missed the second value in "IRA and Roth accounts" (0.06), because one single-answer Choice per column can't return two values.

Every rule was tested on requests written and labelled before that rule existed:

| Set | Size | Rules it tested |
| --- | --- | --- |
| Dev | 36 | none (the rules were written from it) |
| Held-out 1 | 30 | the grammar rules, on the matcher alone |
| Held-out 2 | 16 | the grammar rules live |
| Held-out 3 | 20 | the provider floor |
| Held-out 4 | 20 | the superlative rule |

Each held-out set found problems the earlier ones hid. A third run of the full live set then found "Group the accounts under each advisor", which led to the comparison-word rule. After that, two consecutive verbose runs of the 81 live requests produced no wrong view. Matching plurals without context had read "accounts" as the Account number column 25 times.

Restricted-column screening keeps matching every form, with no context rules, so it errs toward refusing.

**Literal columns.** The Jev provider asks one Choice per literal ("$1 million") over the columns whose kind fits, plus `none`. The compiler uses the pick through the usual confidence bands. Before this, a literal went to the first confident column that fit, and "Show accounts over $1 million" named no column at all.

**Protocol 0.1 additions.** Both are optional, so providers that ignore them behave as before:

- `ResolutionRequest.clauses[].mentions` lists what core matched, so a provider can skip those questions.
- `ClauseResolution.literalColumns` carries a provider's column pick for each literal.

**Choice probabilities.** The Jev provider now reads `probabilities[choice]` for value, boolean, direction, and literal picks. Jev's `confidence` field describes the shape of the whole distribution and is not a probability, while GridCue's bands are.

**Pinned model.** The Jev provider defaults to `jev-1.13.0` instead of `jev-latest`. The bands and the ADR 0012 rules are tuned against one model, and the TypeSafe docs advise pinning in that case. A Host can still pass `model`. Upgrading becomes a deliberate change that re-runs `pnpm eval:live`.

**Question budget.** The default `maxQuestions` rises from 96 to 600. Jev charges per token and answers batched questions in parallel, so one larger call beats a second round trip. Twelve Clauses on the wealth schema need about 330 questions, roughly 13k tokens, well under Jev's 64k-token request limit.
