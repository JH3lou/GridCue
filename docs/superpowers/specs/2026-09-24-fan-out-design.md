# Per-part fan-out: design spec

**Status:** draft, waiting for the owner's approval
**Date:** 2026-09-24
**Scope:** grill answers Q3 to Q8 in `docs/planning/fan-out-grill.md`. Grid routing (Q2) is a separate spec. Q1, the nesting fix, shipped in PR #2.

The owner approved Q3 to Q8 as "our best understanding now". This design is expected to change with evidence. Each new question has a stated bar in section 7. A question that doesn't clear its bar is reworked or removed, not kept for completeness.

## 1. Purpose

After PR #2, GridCue proposes no wrong views on the live set, but 15 of the 56 live-only requests still ask where a person would act. The causes fall into four groups:

- **A part can take only one column change type.** "Show accounts over $1M sorted by gain" and "Roth IRAs grouped by rep" ask the User to split them.
- **Close change types.** "Show IRAs at Northgate" gave show 0.85 against filter 0.82, and rules can only guess between them.
- **Adding versus replacing.** "Also group by custodian" replaces the current grouping.
- **Reversed nesting.** "Group by advisor within custodian" nests in text order, the wrong way round.

Success: more live-only requests reach a correct Preview without a question, with **no new wrong views** and 0 unsafe, in two consecutive runs.

## 2. Decisions this spec builds on

| Decision | Source |
| --- | --- |
| A yes/no per column and change type, so each column is bound to its change | Grill Q3 (function-calling cookbook) |
| A yes/no per part: "more than one distinct change?" | Grill Q4 (smart-home demo) |
| A single-pick change-type Choice per part, beside the per-type yes/no questions | Grill Q5 |
| Code owns order and nesting; Jev checks reversal wording only | Grill Q6 |
| A yes/no per sort or group part: add a level, or replace | Grill Q7 |
| New thresholds tuned on evals and recorded in an ADR; `ready` and `clarify` unchanged | Grill Q8 |
| Everything in one call; order and structure from code | TypeSafe fan-out, jaggedness notes |

## 3. Scope

### In

- **Jev provider:** four new question kinds (section 5.1), and a higher question cap.
- **Protocol:** optional result fields for the new answers (section 6).
- **Compiler:** role binding, the change-type pick, the multi-change flag, adding to the current view, and reversed nesting (section 5.2).
- **Mock Provider:** deterministic equivalents where the rules are simple (section 5.3).
- **Evals:** new cases written before the first run, and `--verbose` output for the new answers.
- **ADR 0014:** the new thresholds and the evidence for them.

### Out

- Grid routing (Q2).
- Changing `ready` or `clarify`.
- Multi-value enum filters ("retirement accounts"). That is a separate finding, with its own question design (one Noul per value).
- Rewording the existing family questions.

## 4. Two changes beyond the grill, for approval

1. **No per-column filter questions.** On the wealth schema, every exposed column supports all five change types, so Q3 would add 45 questions per part, not the 30 I estimated. Filters are already bound to their columns by other questions:
   - enum values by the value Choices;
   - booleans by the boolean Choice;
   - amounts by the literal Choices (ADR 0013).

   The role questions therefore cover sort, group, show and hide: **36 per part**. Revisit this if the evals show filters landing on the wrong column.
2. **Raise the question cap from 600 to 800.** One part now needs up to 27 + 36 + 3 = 66 questions, so 12 parts need 792. At about 39 tokens per question that is roughly 31k tokens, under Jev's 64k-token request limit, and about $0.0013 a request. The 12-part limit stays. Latency must be measured (section 7).

## 5. Units

### 5.1 Jev provider (`server/jev.ts`)

All new questions go in the existing single call. Each one names its premise, following the fan-out pattern. Code reads only the answers that apply.

| Key | Type | Asked for | Wording (draft; the plan fixes it after the evals) |
| --- | --- | --- | --- |
| `c{p}_role_{i}_{r}` | Noul | each part `p`, each exposed column `i`, each role `r` in sort, group, show and hide that the column supports | "Does `clauses[p].text` ask to {sort the rows by / group the rows by / show / hide} the grid column `columns[i]` (“label”)?" |
| `c{p}_kind` | Choice | each part | "Which kind of change does `clauses[p].text` mainly ask for?" The options are the candidate families, each with its `FAMILY_TEXT`, plus `none`: "No view change, or unclear". |
| `c{p}_multi` | Noul | each part | "Does `clauses[p].text` ask for more than one distinct change to the view, such as a filter and a sort?" |
| `c{p}_adds` | Noul | each part | "If `clauses[p].text` sorts or groups the rows, does it add another level to the current `view` sort or grouping, rather than replace it?" |
| `c{p}_outer_{a}_{b}` | Noul | only parts with reversal wording (5.2), for each ordered pair of that part's column Mentions | "In `clauses[p].text`, is the grid column `columns[a]` the outer grouping, or the primary sort, with `columns[b]` inside it?" |

- The state gains `view: { sorts, groupBy }`, using column labels. That lets `c{p}_adds` see the current view, which is already in the `ResolutionRequest`.
- Choice answers use `probabilities[choice]` (ADR 0013). Noul answers use `noul`.
- A missing answer is `PROVIDER_MALFORMED`, as today.

### 5.2 Compiler (`core/compile.ts`)

Each new signal has a threshold constant, set by the plan from the evals and recorded in ADR 0014. None is a Host option.

1. **Role binding.**
   - For a column family (sort, group, show, hide, only), its columns are the named or confident columns whose role score for that family is at or above `ROLE_READY`. For "only", the show role counts.
   - When the provider returns no role scores, as the Mock and third-party providers may not, today's behaviour holds: the family takes every picked column.
   - **A part may now yield several column families**, as long as each has its own columns and no column is claimed by two. That replaces ADR 0012's split message for bound cases.
   - A column claimed by two families, or a family left with no column, still goes to the ADR 0012 rules.
2. **The change-type pick.** When ADR 0012 rules 4 and 5 would split a part or apply the margin, and role binding can't separate the families, the pick decides: its top option wins if its probability is at or above `KIND_READY`. The 0.10 margin stays as the fallback when there is no pick.
3. **The multi-change flag.** If `multi` is at or above `MULTI_READY` and the compiled part yields one change, while a named column or value is left unused, GridCue asks a targeted question. For example: "“…” also mentions Gain. What should happen to it?", with options for the change types that column supports. This extends the "never ignore a named value" rule to columns.
4. **Adding to the current view.** For a sort or group part with `adds` at or above `ADDS_READY`, the new levels are appended to the current view's sort or grouping, with no repeats, instead of replacing it. The Preview names the result: "Group by Custodian, then Advisor".
5. **Reversal.** Code detects reversal wording in a part: within, inside, under, nested in, and "… first" after a list. The first-named-is-outer rule (PR #2) applies unless `outer_{b}_{a}` is at or above `OUTER_READY`, in which case the pair is reversed. Nothing is asked without reversal wording.
6. **Evidence.** Every decision made by a new signal is recorded with source `provider` and its score. Every decision it overrode is recorded as `dropped:`.

### 5.3 Mock Provider

- It returns role scores of 0.95 for a column named directly after "sort by", "group by", "hide" or "show", and none otherwise.
- It returns `adds` of 0.95 when the part contains "also", "and then also", "as well" or "too".
- It returns no `kind`, `multi` or `outer`. The compiler's fallbacks cover them.

### 5.4 Question budget

- Wealth schema: 66 questions per part, plus pairs in parts with reversal wording.
- The cap rises to 800 (section 4).
- `--verbose` prints the question count and latency.

## 6. Protocol (ADR 0014 records it)

These are optional `ClauseResolution` fields, so the protocol stays at 0.1:

- `roles?: { columnId: string; family: string; confidence: number }[]`
- `kind?: { id: string; confidence: number }`
- `multi?: number`
- `adds?: number`
- `outer?: { outerId: string; innerId: string; confidence: number }[]`

## 7. Evidence bar

Each signal must show its value on the live set, or be removed.

| Signal | Keeps its place only if |
| --- | --- |
| Roles | At least 3 live-only cases that asked before reach a correct Preview, with no new wrong view. The combination cases in the new eval set are the main test. |
| Change-type pick | At least 2 cases decided by it, and none of its decisions wrong. |
| Multi-change flag | It turns at least 1 silent drop or wrong split into a targeted question. |
| Adds | The new "also" cases are exact, and it never fires on a plain sort or group. |
| Outer | The reversal cases are exact, and it never fires without reversal wording. |
| Budget | Median latency grows by 50% or less over the current median (about 135 ms). If it grows more, trim questions before shipping. |

The overall bar stays: 0 unsafe and 0 wrong views in two consecutive verbose runs. Every live case that is correct today must stay correct.

## 8. Evals

- About 20 new live-only cases, written and labelled before the first run:
  - combinations in one part ("Roth IRAs grouped by rep", "accounts over $1M sorted by gain");
  - "also" and "instead";
  - reversal ("group by advisor within custodian");
  - plain sorts and groups, as controls for `adds` and `outer`.
- New Mock cases only where the Mock's rules can answer.
- The live runs record which signal decided each case, from the evidence.

## 9. Testing

- Unit tests for each compiler path in 5.2, including every fallback when a field is absent.
- A Jev fake-client test for each new question kind, its key shape, and the premise wording.
- Mock tests for roles and `adds`.
- The existing suites and the `pnpm check` gate are unchanged.

## 10. Acceptance criteria

1. `pnpm check` passes with no credentials.
2. `pnpm eval` passes every Mock case.
3. Two consecutive `pnpm eval:live -- --verbose` runs give 0 unsafe and 0 wrong views, and every case correct before this work stays correct.
4. Each signal meets its bar in section 7, or is removed before merge, with the result recorded in ADR 0014.
5. A 12-part request fits the default cap.

## 11. Risks

- **Role Nouls are absolute and may all be low.** The docs warn that a set of Nouls can be low everywhere. The fallback is today's behaviour, so the risk is little gain, not a wrong result.
- **More questions may lower answer quality.** The docs say adding questions doesn't change the other answers. The live runs check that the currently-correct cases stay correct.
- **Reversal wording is English-only and incomplete.** A missed cue falls back to text order, which is today's behaviour.
