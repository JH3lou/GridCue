# Resolution quality: design spec

**Status:** draft, waiting for the owner's approval
**Date:** 2026-09-24
**Scope:** fix the six live-eval mismatches from `docs/planning/handoff-2026-09-24.md` and lift the question budget. The decisions come from `docs/planning/resolution-quality-grill.md`, Round 1. This spec does not change the confidence defaults, the UI, or the Site.

## 1. Purpose

On the first live Jev run, GridCue applied nothing wrong: 0 unsafe results. But 6 of 15 requests asked a question where a person would have acted, such as "Reset the view." answered with "Did you want to clear the filters?". Over-asking is safe, but it wears the User out, and it hides whether GridCue understood.

After this work, a request GridCue understands should reach a Preview without a question, including across repeated runs where Jev's scores shift by a few hundredths. A request GridCue doesn't understand should still say so, and name what it didn't recognise.

Success: the 15 original cases all meet their expectation in two consecutive `pnpm eval:live` runs, with 0 unsafe. Every case passes under the Mock Provider. A 12-Clause request fits the default Jev budget on the wealth schema.

## 2. Decisions this spec builds on

| Decision | Source |
| --- | --- |
| Compiler precedence rules for Operation Families | Grill Q1, ADR 0012 |
| Core matches Host-declared names deterministically | Grill Q2 |
| A Jev Choice per literal picks its column | Grill Q3 |
| Core names unknown terms when the provider doesn't | Grill Q4 |
| Choice picks use the probability of the chosen option | Grill Q5 |
| One Jev call, fewer questions, a higher cap | Grill Q6 |
| Jev model pinned to `jev-1.13.0` by default | Grill Q7 |
| `ready` 0.85 and `clarify` 0.65 unchanged. More eval cases and `--verbose` | Grill Q8 |
| Clause and Operation Family in `CONTEXT.md`. Users see "part" | Grill Q9 |
| Additive protocol changes stay at 0.1 | ADR 0010 precedent, ADR 0013 |

## 3. Scope

### In

- Compiler: the precedence rules (section 5.1), Mentions (5.2), literal targets (5.3), and unknown terms (5.4).
- A new core step, `matchMentions`, and the optional protocol fields it and the literal picks need (section 6).
- Jev provider: literal Choices, skipping answered questions, reading probabilities, the new cap, and the pinned model (section 5.5).
- Mock Provider: moves to the shared core helpers without changing what it returns for the existing cases.
- Evals: about 25 new cases, a live-only case file, and `--verbose`.
- User-facing copy: "step" becomes "part".
- Docs: ADR 0012, ADR 0013, `docs/internals/product.md` (confidence), `docs/internals/intent-protocol.md` (new fields), and the handoff.

### Out

- Changing `ready` or `clarify` defaults. That needs a later ADR, using the larger eval set.
- Asking Jev for the Clause's main family with a Choice (grill Q1, option b). Revisit only if the larger eval set shows the rules dropping things Users meant.
- The "No" answer dead end, and other open follow-ups in the handoff.
- Publishing, and the Site.

## 4. One addition beyond the grill, for approval

**Margin rule (rule 5 below).** The two live runs gave `accounts-over-1m` columns.show scores of 0.85 and 0.83. At 0.83, rule 1 drops show and the request works. At 0.85, filter (0.97) and show are both confident, so rules 1 to 4 still end in the split message. The result would depend on a score of ±0.02.

Rule 5: when two or more column families are still accepted, keep the top one if it leads the next by at least **0.10**. Otherwise, ask for a split as today. The margin is a compiler constant, not a Host setting, because nothing yet shows a Host needs to tune it.

This is safe for the same reason as rule 1: a dropped family is simply absent from the Preview, and nothing is applied without approval. If the owner declines it, `accounts-over-1m` stays flaky on live and the acceptance bar in section 9 changes to "passes in at least one of two runs".

## 5. Units

### 5.1 Family precedence (`core/compile.ts`)

The family loop becomes two passes. The first pass sorts every known family into three groups: **accepted**, meaning at or above `ready`, or already confirmed by the User; **middling**, between `clarify` and `ready`; and **dropped**, below `clarify`. Unsupported families keep today's handling: they are refused at or above `clarify`. The rules then run in order:

1. **Confident beats middling.** If any view family is accepted, every middling view family is dropped instead of asked about.
2. **Show-only absorbs show and hide.** If columns.only is accepted, columns.show and columns.hide are dropped.
3. **Reset versus the clears.** If view.reset and at least one clear are accepted, reset wins when its score is higher than every accepted clear's, and the clears are dropped. Otherwise the clears win and reset is dropped. A User's confirmation counts as 1.
4. **Split.** If two or more column families remain, the Clause asks the User to split it: "“…” asks for more than one kind of change. Split it into separate parts."
5. **Margin** (section 4). This runs before rule 4. If two or more column families remain and the top leads the next by at least 0.10, only the top one is kept.

Each dropped family is recorded in the plan's evidence with source `"deterministic"` and a `dropped:` prefix on the key. That way the audit trail shows why it was not applied, and the Preview is unchanged.

### 5.2 Mentions (`core/mentions.ts`, new)

`matchMentions(input, schema) → Mention[]` runs in the Controller after `screenRestricted` and before the provider call.

```ts
interface Mention {
  clauseIndex: number;
  columnId: string;
  /** Set when the text named an enum value, such as "roth". The column is implied. */
  valueId?: string;
  start: number;
  end: number;
}
```

- **What it matches.** It matches exposed columns' labels and aliases, and exposed enum values' labels and aliases. It uses `findMentions`, the whole-word matcher that already handles punctuation variants.
- **Plurals.** `findMentions` gains a `plural` option, default `true` so restricted-column screening stays unchanged. `matchMentions` passes `false`. "accounts" therefore no longer matches the `account` alias, and plural forms go to the provider.
- **Values before columns.** Value names are matched first and masked out, and column names are matched in what remains. That way "Roth IRA" is not also read as a column. This is the Mock's current approach.
- **Ambiguity.** A name that matches more than one column, or more than one value, is ignored and left to the provider. Nothing is guessed.
- **Booleans.** Boolean columns are matched like any other column. Deciding true or false stays with the provider, because negation needs context.

How the compiler uses Mentions:

- A column Mention is a column pick at confidence 1, with source `"deterministic"`. It overrides the provider's score for that column, whether higher or lower.
- A value Mention is a value pick at confidence 1, and its column counts as mentioned.
- A provider value pick at or above `ready` also marks its column as mentioned. A middle-band column that is already covered by an accepted value is therefore never asked about. This is grill Q2's "a value selects its column".
- Mentions never add a family. A Clause with Mentions but no accepted family still asks what to change.

### 5.3 Literal targets (`core/compile.ts`)

A literal's column is decided in this order:

1. The User's answer to that literal's Clarification.
2. The provider's pick for that literal (new `literalColumns`, section 6). At or above `ready`, it is used. In the middle band, GridCue asks "Which column should be above $1,000,000?", with the provider's pick listed first. Below `clarify`, it is ignored.
3. Today's fallback: the first unused confident column, or Mention, whose kind fits. Providers that don't return `literalColumns` behave exactly as now.
4. Otherwise, GridCue asks "Which column should be …?", as today.

The operator check is unchanged. A picked column that doesn't allow the operator still leads to the Clarification.

### 5.4 Unknown terms (`core/terms.ts`, new)

- `unknownTerm(clauseText) → string | undefined` is the Mock's `remainderAfterVerb`, moved into core. It returns `undefined` if the remainder is empty, longer than four words, or only pronouns ("it", "this", "that", "them", "these", "those").
- The compiler uses it when a column family has no usable column and the provider returned no `unmatchedTerms`. The provider's own terms still win.
- The filter path is unchanged.
- The Mock imports the core helper instead of keeping its own copy.

### 5.5 Jev provider (`server/jev.ts`)

- **Literal Choices.** For each literal of a Clause that is not `unreadable`, it asks: "Which column does the value \`clauses[p].literals[j]\` in \`clauses[p].text\` apply to?". The options are `none` plus each exposed column whose kind fits, keyed by column id. The state gains `literals: [{ text, kind }]` per Clause, where `text` is the literal as written. A Clause whose literal fits only one column still gets the question, so that "none" can win.
- **Skip answered questions.** No column Noul is sent for a column with a column or value Mention in that Clause. No value Choice is sent for a column with a value Mention. Direction is still skipped when the normaliser found it.
- **Probabilities.** `pickOf` reads `probabilities[choice]`. If it is missing or not a number, the provider throws `PROVIDER_MALFORMED`. This applies to value, boolean, direction, and literal Choices.
- **Cap.** The default `maxQuestions` rises from 96 to **600**. At 12 Clauses, the wealth schema needs about 330 questions, and each question averages about 39 tokens. So 600 questions is about 24k tokens, well under Jev's 64k per request. The option's doc comment gives both numbers. A wider schema that exceeds the cap still gets "Try fewer parts at once."
- **Model.** `model` defaults to `"jev-1.13.0"`. A Host can pass `model: "jev-latest"` to float.
- **Question wording.** The Noul and Choice wording for families, columns, values, booleans, and direction is not changed, because rewording shifts scores. "The request step" stays as internal wording that Users never see.

### 5.6 Copy

In `compile.ts` and `controller.ts`, "Split it into separate steps" becomes "…parts". "Try fewer steps at once. GridCue handles up to 12 in one request." becomes "…parts…", and "Try fewer steps at once." becomes "Try fewer parts at once." Any test that asserts these strings is updated.

## 6. Protocol changes (ADR 0013)

All changes are optional additions, so the protocol stays at 0.1. A provider that ignores them behaves as before.

- `ResolutionRequest.clauses[].mentions?: { columnId: string; valueId?: string }[]`. This tells a provider what core already matched, so it can skip those questions. Offsets stay in core.
- `ClauseResolution.literalColumns?: { literalIndex: number; columnId: string; confidence: number }[]`. This is the provider's pick for each literal. `literalIndex` is the literal's position in `clauses[].literals`.

`docs/internals/intent-protocol.md` documents both.

## 7. Evals

- **`evals/cases.jsonl`** keeps its 15 cases and gains about 10 more that the Mock can answer. Every case in it must pass under the Mock, as today.
- **`evals/cases-live.jsonl`** (new) holds about 15 cases that only Jev can reasonably answer: paraphrases ("biggest accounts first", "just the IRAs"), alias forms, several Clauses, literals that could fit more than one column, and near-miss names ("risk", "gains"). `pnpm eval:live` runs both files. `pnpm eval` runs only the first.
- **`--verbose`** prints, for each case, the verdict, each Clause's family and column scores at or above 0.30, literal picks, Mentions, the question count, and the latency.
- **Every new case is synthetic**, and its expectation is written before the first live run. A new case that fails on live is recorded as a finding, not rewritten to pass.

## 8. Testing

Unit tests, all with no network:

- One test per precedence rule, including the tie in rule 3 and exactly 0.10 in rule 5.
- `matchMentions`: aliases, value aliases masking columns, plurals off, ambiguous names ignored, and restricted columns never matched. Restricted-column screening still matches plurals.
- Literal targets: the provider's pick in each band, the fallback when `literalColumns` is absent, and the operator check.
- `unknownTerm`: the Mock's existing risk-score case, pronouns, empty text, and more than four words.
- Jev provider, with a fake client:
  - The question set skips mentioned columns.
  - Literal questions offer only fitting columns plus `none`.
  - `probabilities` are read.
  - A missing `probabilities` throws `PROVIDER_MALFORMED`.
  - The default model is sent.
  - The cap is 600.
- The existing contract suites, boundary tests, and `pnpm check` gate are unchanged.

## 9. Acceptance criteria

1. `pnpm check` passes from a clean frozen install, with no credentials.
2. `pnpm eval` passes every case in `evals/cases.jsonl` under the Mock.
3. Two consecutive `pnpm eval:live` runs each give **0 unsafe**, and all 15 original cases meet their expectation in both runs.
4. The new live cases are reported by count, with no pass bar. Their failures are listed in the handoff as findings for the confidence-defaults ADR.
5. A 12-Clause request on the wealth schema reaches Jev without `PROVIDER_TOO_COMPLEX`.
6. Every precedence decision that drops a family is visible in the plan's evidence.
7. `CONTEXT.md`, ADRs 0012 and 0013, `docs/internals/product.md`, `docs/internals/intent-protocol.md`, and the handoff are current.

## 10. Risks

- **Rule 1 could hide something a User meant.** A middling second family is dropped silently. The Preview shows what will change, so the User can see what's missing. The larger eval set is where this would first show up.
- **Mentions could over-match a common word used as an alias**, such as a Host alias "value" in "value accounts". Ambiguous names are already ignored. A Host that declares a very common word as an alias can see this in the Preview. The docs will say so.
- **Literal Choices are unmeasured.** Whether Jev places "$1 million" on Market value at or above `ready` is *unverified* until the first live run. If it lands in the middle band, the case asks "Which column…?" with Market value first. That is safe, but `accounts-over-1m` would still not be exact.
