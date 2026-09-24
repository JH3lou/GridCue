# Deterministic Mentions, literal columns, and a pinned Jev model

**Mentions.** Before the provider call, core matches the Host's declared column labels and aliases, and enum value labels and aliases, as whole words in each Clause. Plurals match. A column-name match that sits where the rows go is not a column reference: directly after another matched name ("Roth accounts"), before a qualifier ("accounts with …"), before "by" ("sort households by assets"), or before a comparison with a literal its kind can't hold ("accounts over $1M", where Account number is text). A name that matches more than one column or value is left to the provider. A Mention counts as confidence 1 with source `deterministic`, and it overrides the provider's score for that column or value.

This follows the architecture's rule that deterministic code owns parsing. Live, Jev scored the declared alias "rep" at 0.83 and missed "Summit Trust" (0.03) and a second value in "IRA and Roth accounts" (0.06), because one single-answer Choice per column can't return two values. The context rules were tested on a 36-request dev set and a 30-request held-out set written before the rules. They gave 0 wrong and 0 missed matches, where matching plurals without context read "accounts" as the Account number column 25 times. Restricted-column screening keeps matching every form, with no context rules, so it errs toward refusing.

**Literal columns.** The Jev provider asks one Choice per literal ("$1 million") over the columns whose kind fits, plus `none`. The compiler uses the pick through the usual confidence bands. Before this, a literal went to the first confident column that fit, and "Show accounts over $1 million" named no column at all.

**Protocol 0.1 additions.** Both are optional, so providers that ignore them behave as before:

- `ResolutionRequest.clauses[].mentions` lists what core matched, so a provider can skip those questions.
- `ClauseResolution.literalColumns` carries a provider's column pick for each literal.

**Choice probabilities.** The Jev provider now reads `probabilities[choice]` for value, boolean, direction, and literal picks. Jev's `confidence` field describes the shape of the whole distribution and is not a probability, while GridCue's bands are.

**Pinned model.** The Jev provider defaults to `jev-1.13.0` instead of `jev-latest`. The bands and the ADR 0012 rules are tuned against one model, and the TypeSafe docs advise pinning in that case. A Host can still pass `model`. Upgrading becomes a deliberate change that re-runs `pnpm eval:live`.

**Question budget.** The default `maxQuestions` rises from 96 to 600. Jev charges per token and answers batched questions in parallel, so one larger call beats a second round trip. Twelve Clauses on the wealth schema need about 330 questions, roughly 13k tokens, well under Jev's 64k-token request limit.
