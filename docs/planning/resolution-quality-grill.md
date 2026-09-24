# Resolution quality: grilling log

This log covers next steps 1 and 2 of `docs/planning/handoff-2026-09-24.md`: the six live-eval mismatches and the question budget. It follows `.claude/skills/gridcue-planning`. The grill comes first, then a spec in `docs/superpowers/specs/`, then a plan in `docs/superpowers/plans/`. No product code is written until the owner approves both.

## Facts gathered (2026-09-24)

### Live probe

The probe ran every eval case against Jev with a throwaway script and logged each Clause's scores. Only scores of 0.30 or more are shown.

| Case | Verdict | What Jev returned | Why it is not exact |
| --- | --- | --- | --- |
| `accounts-over-1m` "Show accounts over $1 million." | mismatch | filter 0.97, columns.show 0.83. Market value 0.62. | Show falls in the middle band, so GridCue asks about it. "$1 million" names no column, and Market value is below `clarify`, so the literal has no column. |
| `keep-only` "Keep only account, household, market value, and unrealized gain." | mismatch | columns.only 0.97, columns.hide 0.88, columns.show 0.67. | Only and hide are both at or above `ready`, so the split message fires. Show also asks. |
| `clear-filters-sorting` "Clear the filters and sorting." | mismatch | filter.clear 0.99, sort.clear 0.99, view.reset 0.77. | Reset falls in the middle band, so GridCue asks about it. |
| `reset` "Reset the view." | mismatch | view.reset 0.96, filter.clear 0.83, sort.clear 0.64, group.clear 0.63. | Clear-filters falls in the middle band, so GridCue asks about it. |
| `bare-roth-alias` "Only Roth accounts, grouped by rep." | mismatch | Clause 0: filter 0.98, Registration type 0.75, Roth IRA 0.89. Clause 1: group 0.96, Advisor 0.83. | Both columns fall in the middle band. "rep" is a declared alias of Advisor. "roth" is a declared alias of the Roth IRA value, but Jev never sees value aliases. |
| `unknown-column` "Sort by risk score." | mismatch | sort 0.99, no column at or above 0.30. | Jev always returns `unmatchedTerms: []`, so GridCue asks "Which column should be sorted by?" without naming "risk score". |

The other nine cases were exact or rejected safely. Nothing was unsafe. Calls took 118 to 319 ms.

**Scores move between runs.** In the first live run, "Show accounts over $1 million" gave columns.show 0.85. In this run it gave 0.83. A score that close to `ready` (0.85) can land on either side of it.

### Code (file:line)

- **Questions per Clause on the wealth schema: 27.** That is 14 family Nouls (10 view families plus 4 unsupported), 9 column Nouls, 2 enum Choices, 1 boolean Choice, and 1 direction Choice when the normaliser found no direction (`packages/gridcue/src/server/jev.ts:51-88`).
  - All Clauses go in **one** `systemOne` call (`jev.ts:94-105`).
  - `maxQuestions` (default 96) throws `PROVIDER_TOO_COMPLEX` when exceeded (`jev.ts:89-91`), so 4 Clauses already fail. `MAX_CLAUSES` is 12 (`controller.ts:46`).
- **No precedence between families.** Each family is judged alone (`compile.ts:122-148`).
  - A middle-band family always asks, even when a confident family covers it.
  - Two column families at or above `ready` trigger the split message (`compile.ts:166-173`). Nothing asserts that message in a test.
  - The clears and view.reset each emit an operation when confident (`compile.ts:202-206`).
- **Value confidence reads the wrong field.** `jev.ts:120` stores Jev's Choice `confidence`, which measures how peaked the whole distribution is. It is not the probability of the chosen option. The probabilities are in `probabilities`, which GridCue ignores.
- **Literal assignment.** A literal goes to the first column at or above `ready` whose kind fits, in the order the columns appear in the text (`compile.ts:260-263`).
- **Unknown terms.** The Mock Provider takes the text after the verb as the unmatched term (`mock/index.ts:51-56, 99-100`). The compiler uses it only for non-filter column families (`compile.ts:295-305`).
- **Confidence policy.** `ready` 0.85 and `clarify` 0.65 (`compile.ts:27-33`). Direction uses only `ready` and silently defaults to ascending (`compile.ts:309-310`). **No ADR covers confidence.** It is documented in `docs/internals/product.md:117-127`.
- **The Mock Provider** never produces middle-band scores and returns at most one non-clear family. Mock evals therefore don't depend on precedence rules.
- **Glossary gap.** `CONTEXT.md` defines neither Clause nor Family. It lists "step" as a word to avoid for View Operation, yet the code and user-facing text use "step" to mean a Clause (`compile.ts:169`, `jev.ts:53`, `controller.ts:157, 180`).

### Jev API, as of `@typesafe-ai/sdk` 0.6.0 and docs.typesafe.ai

- **Three question types:** Noul (yes/no), Choice, and Score. There is no multi-select, span extraction, or free text. *Verified.*
- **Choice returns `probabilities` for every option, summing to 1**, plus a separate `confidence` that describes the shape of the distribution. It has no built-in "none" option, so you add your own. It allows up to 255 options. *Verified.*
- **Questions in one request are independent.** One cannot depend on another's answer. The docs recommend asking extra questions speculatively in the same call over making a second round trip. *Verified.*
- **There is no cap on questions per request.** The limits are 64k tokens per request and 32k for the state plus the longest question. Pricing is per input token ($0.042 per million on `jev-1.13.0`), so adding questions costs almost nothing, and batching is about 10 times faster than separate calls. *Verified.* **GridCue's 96 limit is its own.**
- **Models.** The SDK defaults to `jev-latest`, which currently points to `jev-1.13.0`. The docs advise pinning a versioned model when thresholds have been tuned. *Verified.*
- **Calibration.** Probabilities are calibrated across groups of answers, with no guarantee for any single answer. A threshold tuned on a Noul does not carry over to a Choice. A set of Nouls is absolute, while a Choice is relative. *Verified.*
- **Closest documented pattern.** The function-calling cookbook uses a Choice for which function to call, a Choice per single-value argument, a Noul per member of a multi-value argument, and a Noul per argument asking whether it was mentioned. *Verified.* No cookbook covers unknown-term detection. Code finding candidate spans and Jev judging them is an *unverified* extrapolation.

## Round 1

Answer by number. A bare "agree" accepts the recommendation.

❓ **Q1 - Which family wins when Jev says yes to several.**
(a) **Compiler precedence rules** that are provider-independent and deterministic:
   1. Once any view family is at or above `ready`, middle-band families are dropped instead of asked about.
   2. columns.only absorbs columns.show and columns.hide.
   3. view.reset absorbs the three clears when its score is higher than each of theirs. Otherwise the explicit clears win and reset is dropped.
   4. The split message fires only if two column families are still left after rules 1 to 3.
(b) **A Jev Choice for the Clause's main family**, using the routing pattern from the docs, plus Nouls for which things a clear targets. This changes the provider's questions and how scores should be read.
(c) Both.

➡️ (a), recorded in ADR 0012. It fixes four of the six mismatches (`keep-only`, `clear-filters-sorting`, `reset`, and the family half of `accounts-over-1m`). It changes no provider questions, works for the Mock and third-party providers, and each rule is one unit test. Nothing wrong gets applied that the User wouldn't see: a dropped middle-band family is simply absent from the Preview. Revisit (b) if the larger eval set (Q8) shows rule 1 dropping things Users meant.

---

❓ **Q2 - Deterministic column and value mentions.** "rep" and "roth" are aliases the Host declared, but Jev scores them in the middle band.
(a) **Match first.** Core matches a Host-declared column label or alias, or an enum value label or alias, as a whole word in the Clause. Deterministic parsing then owns that match at confidence 1. The longest match wins, and a term that matches more than one column is left to the provider. A value at or above `ready` also selects its column.
(b) Send value aliases to Jev and hope its scores clear `ready`.

➡️ (a). It follows the architecture's rule that deterministic code owns parsing and the provider handles only what is fuzzy. It fixes `bare-roth-alias` without touching the confidence defaults. It also makes the result stable where scores near the threshold move between runs. Whole-word matching keeps "accounts" from matching the alias "account".

---

❓ **Q3 - Which column a literal like "$1 million" belongs to.**
(a) **A Jev Choice for each literal**, over the columns whose kind fits plus "none". It replaces "the first confident column that fits", and the answer goes through the usual bands.
(b) A Host default per kind in the schema, such as `currency → market_value`. The Mock already has this as `defaultColumnForKind`.
(c) Keep asking the User.

➡️ (a). "Accounts over $1 million" means market value by common sense, and that is Jev's strength. It needs no new schema field. It adds one question per literal. It also settles the "first of several candidate columns" follow-up from the handoff.

---

❓ **Q4 - Naming unknown terms.** Jev can't extract spans.
(a) **Core does it.** Move the Mock's "text after the verb" logic into the compiler as a fallback. It is used when a column family has no column above `clarify` and the provider returned no `unmatchedTerms`. Provider-supplied terms still take priority.
(b) Ask Jev a Noul per candidate term.
(c) Leave it: the current prompt is safe, just less helpful.

➡️ (a). It is deterministic, costs no questions, and gives "There's no column called “risk score”" for every provider. It fixes `unknown-column`.

---

❓ **Q5 - Value confidence.** GridCue reads Choice `confidence` (the shape of the distribution) as if it were the probability of the chosen value.
(a) **Read `probabilities[choice]`**, the same way for enum, boolean, direction, and the new literal Choice.
(b) Keep `confidence`.

➡️ (a). The current behaviour is a bug. The bands are defined as probabilities, and the Jev docs warn that the two fields differ, for example 0.61 against 0.42.

---

❓ **Q6 - Question budget.** 27 questions per Clause means 4 Clauses already fail.
(a) **One call, with a higher budget and fewer questions.** Stay with one batched call. Skip the questions that deterministic parsing already answers: columns matched under Q2, and direction, as today. Raise the default `maxQuestions` so `MAX_CLAUSES` (12) fits on a typical schema, about 400. Keep the cap as a guard below Jev's 64k-token limit for very wide schemas.
(b) Two calls: ask the change type first, then only the columns that type needs, as the handoff suggested.

➡️ (a). Jev's pricing and latency make extra questions in one call almost free. A second call adds a full round trip, and the docs call sequential calls "the wrong way". The plan must measure question tokens on the wealth schema before choosing the default.

---

❓ **Q7 - Pin the Jev model.**
(a) **Default the Jev provider to `jev-1.13.0`.** The Host can still pass `model`.
(b) Keep `jev-latest`.

➡️ (a). The confidence bands and the precedence rules are tuned against one model. The docs advise pinning in that case. Upgrading then becomes a deliberate change that re-runs `pnpm eval:live`.

---

❓ **Q8 - Confidence defaults and the eval set.**
(a) **Keep `ready` 0.85 and `clarify` 0.65 for now.**
   - Grow the eval set to about 40 synthetic cases: paraphrases, alias forms, several Clauses, literals that could fit more than one column, and near-miss column names.
   - Add `--verbose` to the eval CLI to print scores, question count, and latency for each case.
   - Revisit the defaults in a later ADR, using the larger set.
(b) Tune the defaults now against the 15 cases.

➡️ (a). With Q1 to Q4, all six mismatches should resolve without touching the thresholds. Fifteen cases are too few to set them. The handoff already says any change to the defaults needs an ADR.

---

❓ **Q9 - Glossary.**
(a) **Add Clause and Operation Family to `CONTEXT.md`.**
   - A Clause is one part of an Utterance, split deterministically.
   - An Operation Family is the kind of change a Clause asks for.
   - User-facing text says "part" instead of "step", as in "Try fewer parts at once" and "Split it into separate parts". This keeps "step" on the avoid list.
(b) Add "Step" as the term and take it off the avoid list.

➡️ (a). "Clause" is already the name in the code and the protocol (`ClauseResolution`, `MAX_CLAUSES`).

---

❓ **Q10 - Where this lands.** PR #1 is still open, and the `.env.local` wiring from today is uncommitted on its branch.
(a) **Commit the `.env.local` wiring to PR #1**, because live evals depend on it. Build this work on a new branch stacked on PR #1.
(b) Put everything in PR #1.
(c) Wait for PR #1 to merge, then branch from `main`.

➡️ (a). PR #1 stays as the reviewed first build, and this becomes a focused second PR.

### Expected effect on the six mismatches

| Case | Fixed by |
| --- | --- |
| `accounts-over-1m` | Q1 rule 1 drops show. Q3 sends the literal to Market value. |
| `keep-only` | Q1 rule 2. |
| `clear-filters-sorting` | Q1 rule 1 drops reset. |
| `reset` | Q1 rule 1 drops the middle-band clear. Rule 3 covers the case where a clear is also confident. |
| `bare-roth-alias` | Q2. |
| `unknown-column` | Q4. |

These are expectations to be checked with `pnpm eval:live`, not results.

## Round 1 answers (owner, 2026-09-24)

"agree" — every recommendation accepted.

| Q | Answer | Recorded as |
| --- | --- | --- |
| Q1 Family precedence | Agree | Compiler precedence rules, ADR 0012. |
| Q2 Deterministic mentions | Agree | Core matches Host-declared names before the provider. See the spec for plural handling. |
| Q3 Literal column | Agree | A Jev Choice per literal over fitting columns plus "none". |
| Q4 Unknown terms | Agree | Core fallback, taken from the Mock Provider. |
| Q5 Value confidence | Agree | Read `probabilities[choice]`. |
| Q6 Question budget | Agree | One call, skip what is already answered, raise the default cap. |
| Q7 Model pin | Agree | Default to `jev-1.13.0`. |
| Q8 Defaults and evals | Agree | Keep 0.85 and 0.65. About 40 cases and `--verbose`. |
| Q9 Glossary | Agree | Clause and Operation Family added to `CONTEXT.md`. Users see "part". |
| Q10 Branching | Agree | `.env.local` wiring committed to PR #1 as `c630957`. This work is on `claude/resolution-quality`. |

### Facts gathered after Round 1

- **Question tokens.** Measured by building the requests with a fake client, estimated at 4 characters per token (*unverified* against Jev's tokenizer). 1 Clause is 27 questions, about 1.1k tokens. 12 Clauses are 324 questions, about 12.7k tokens, plus about 0.5k of state. That is well under Jev's 64k per request, and about $0.0005 at $0.042 per million.
- **Plurals.** `findMentions` (`core/text-match.ts`) also matches plural forms, so "accounts" matches the `account` alias of Account number. The Mock already relies on this. Q2's claim that whole-word matching keeps "accounts" from matching "account" holds only if the new matching turns plurals off. The spec does.
- **`accounts-over-1m` is not fixed by rule 1 alone.** columns.show scored 0.85 in the first run and 0.83 in the second. At 0.85, filter and show are both confident, so the split message would fire even after Q1's rules. The spec adds a margin rule for this and flags it for approval.

## Plural experiment (2026-09-24)

The owner asked to test plural handling before the spec fixes it. Throwaway scripts ran 36 synthetic requests. Each request was labelled with the columns and enum values it really names, and "accounts" as the word for the rows does not count as naming Account number. The scripts compared three matcher variants deterministically, then combined each with one live Jev run. A Mention counts as 1. Anything else uses Jev's column Noul, or the chosen value's probability, against 0.85 and 0.65.

| Variant | Wrong column used | Expected missed | Expected asked | Requests fully right |
| --- | --- | --- | --- | --- |
| Jev only | 0 | 6 | 6 | 23/36 |
| Plurals on everywhere | 14 | 0 | 0 | 21/36 |
| Plurals off everywhere | 0 | 2 | 2 | 27/36 |
| Plurals on for enum values only | 0 | 1 | 1 | 29/36 |

What the numbers show:

- **Plurals on everywhere.** 13 of its 14 errors are "accounts", the row noun, matched to the `account` alias. The other is "households" in "Sort households by assets".
  - This is worse than it looks: a Mention overrides Jev, and Jev scored Account number low in every one of these cases.
  - Column plurals can't be trusted whenever a Host's alias is also the word for its rows.
- **Plurals on for enum values only.** It catches "IRAs", "trusts" and "Roth IRAs" with no errors. Column plurals ("custodians", "balances", "households", "reps'") go to Jev:
  - "Group by custodians" and "Hide the balances" scored at or above `ready`.
  - "Group by households" scored 0.84, so GridCue asks.
  - "Show the reps' largest positions" scored 0.46 for Advisor, so it is missed.
- **Every remaining extra question** in this variant is either Registration type alongside a value that was already matched, or Market value for a bare amount. The spec's "a value selects its column" rule and the literal Choice address these, so the adjusted count is about 33/36. That is *unverified* until built.
- **Jev's value Choice misses often.** One run gave:
  - Summit Trust 0.03 in "Show Summit Trust accounts".
  - Brokerage 0.13 and Northgate 0.22 in "Show only brokerage accounts at Northgate".
  - Roth IRA 0.06 in "Show IRA and Roth accounts". That is a structural limit: one single-answer Choice per column can't return two values.
  - Deterministic value matching catches all of these. **Finding for later:** a request naming two values of one column that aren't Host-declared names needs one Noul per value (the docs' multi-value pattern), not one Choice.
- **Caveat.** This is one live run on 36 requests written for this test.

## Context-rule experiment (2026-09-24)

The owner's direction: "use context clues to make sure it works instead of shifting goal post". The target stays fixed: no wrong matches, and plural column names ("custodians", "households") are still caught by the matcher, not handed to Jev.

**Rules.** Plurals are on everywhere. A column-name match is **not** a column reference when it sits where the rows go:

1. **Directly after another name.** "Roth accounts", "restricted accounts".
2. **Before a qualifier.** with, without, where, whose, that, which, at, in, from, having, held, owned.
3. **Before "by".** In "sort households by assets", the column comes after "by".
4. **Before a comparison with a literal its kind can't hold.** "accounts over $1M", where Account number is text.

Otherwise the match is a column. The rules refer only to grammar and column kinds, never to this schema's words.

**Method.** The rules were written after seeing the 36-request dev set. A held-out set of 30 new requests was written and labelled **before** the rules were implemented or run. It includes traps such as "Keep only accounts, balances, and reps", where "accounts" does mean the column. Both sets were scored on the matcher alone, then combined with a live Jev run.

| Set | Plurals on | Values-only plurals | Context rules |
| --- | --- | --- | --- |
| Dev, matcher only: wrong / missed | 14 / 0 | 0 / 9 | 0 / 0 |
| Held-out, matcher only: wrong / missed | 11 / 0 | 0 / 9 | 0 / 0 |
| Dev with live Jev: fully right | 21/36 | 29/36 | 31/36 |
| Held-out with live Jev: fully right | 19/30 | 28/30 | 28/30 |

- **All 25 decisions that a match means the rows were correct** across both sets.
- **The held-out set's one "wrong" is a labelling artefact.** In "Taxable accounts only", Jev scored Registration type 0.86, which is the column the value belongs to.
- **The remaining shortfalls are all Jev asking about an implied column.** That is Registration type next to a matched value, or Market value for a bare amount. The spec's "a value selects its column" rule and the literal Choice target exactly these. *Unverified until built.*
- **Decision:** the context rules replace "plurals off" in spec section 5.2. The 66 labelled requests become Mention unit-test fixtures.

## Status

- **Spec:** approved by the owner on 2026-09-24 ("Sure"), including the 0.10 margin rule. It is at `docs/superpowers/specs/2026-09-24-resolution-quality-design.md`.
- **Next:** ADRs 0012 and 0013, then the plan. Its code is built and tested in a scratch copy first, as with the first plan.
