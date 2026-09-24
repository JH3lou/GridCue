# Per-part fan-out: four new questions, kept on evidence

GridCue already asked Jev every question in one call. The fan-out spec (`docs/superpowers/specs/2026-09-24-fan-out-design.md`) adds questions to that call, so one part of a request can carry more than one change, add to the current view, and nest in the right order. Following the TypeSafe fan-out pattern:

- every question is asked for every part;
- each states its premise;
- the compiler reads only the answers that apply.

Order and structure come from code, and Jev answers bounded questions about them. The docs warn that Jev is unreliable at ordering and at producing decompositions.

## The questions that stayed

| Question | Type | Compiler use | Threshold |
| --- | --- | --- | --- |
| Per column and change type (sort, group, show, hide): "Does the part ask to … this column?" | Noul | Binds columns to changes, so one part can filter and sort ("Show accounts over $1M sorted by gain"). It separates columns between changes and never drops a named column on its own. A confident answer also counts as evidence the column is meant. | 0.7 |
| "Which kind of change does the part mainly ask for?" | Choice | Decides between close column families before the 0.10 margin. It also promotes a middling family it is sure of ("Get rid of the account column"). | 0.6 |
| "Does it add a level to the current sort or grouping, rather than replace it?" | Noul | Appends to the current view ("Also group by advisor"). "instead" or "rather" always replaces. | 0.7 |
| "Is column A the outer grouping or primary sort, with B inside it?" | Noul | Asked only for parts with reversal wording (within, inside, under, nested in, in each, for each, per) that name two columns. A confident answer reverses text order and makes both columns levels. | 0.7 |

The thresholds were set in advance from the TypeSafe guidance, not tuned on the eval set. Noul thresholds are raised above 0.5 when a false yes is costly, and a Choice floor sits around 0.5 to 0.6. Choice and Noul thresholds don't transfer, so each is separate from `ready` and `clarify`, which are unchanged.

## The question that was removed

The spec's "Does the part ask for more than one distinct change?" Noul, from the smart-home demo, was built and measured. With its answers removed, **no live case changed**. Jev reads "Roth IRAs grouped by rep" as one change about Roth IRAs and scored the flag at 0.08 to 0.41. The spec required at least one case, so it was removed.

A deterministic rule does that job instead: **a value named before another change's verb describes which rows, so it filters.** "Roth IRAs grouped by rep" and "Northgate accounts sorted by gain" both filter. A value after the verb ("Sort by gain for trusts") still gets the "never ignore a named value" question from ADR 0012.

## Other rules found while verifying

- **Only reading.** When nothing the provider suggests has anything to act on and the part names a value, filtering is the only reading left ("Show trusts").
- **Filter arguments.** A column with a named or confident value, or the column an amount applies to, joins another change only when its change-type answer says so ("Restricted accounts grouped by advisor").
- **Supported Mentions.** The provider's other answers can confirm a named column its column score doubts. Restricted holdings scored 0.39 as a column but "true" 0.96 as a value in the same call.
- **Continuations.** A short part with no verb after a sort or group part continues it ("Group by custodian, then advisor").
- **Canonical order.** Within a part, operations follow `VIEW_FAMILIES`: filters, then sorts, groups, and columns.

## Evidence

The spec's 20 fan-out cases were written before any code. Two more held-out sets (16 and 14 cases) were written before the refinements they tested.

Ablation runs, `pnpm eval:live -- --without=<signal>` over 134 live requests, gave these results for each question:

| Question | Exact only with it | Wrong views without it |
| --- | --- | --- |
| Change type per column | 4 | 6 |
| Main change type | 5 | 0 |
| Add a level | 5 | 5 |
| Outer | 6 | 6 |
| More than one change | 0 | 0, so removed |

Final results, from two consecutive verbose runs on the finished code:

| Set | Before | After |
| --- | --- | --- |
| Core, 31 cases | all correct | all correct |
| Live-only, 56 cases | 40 exact | 51 exact |
| Fan-out, 50 cases | 4 of the first 20 exact, with 7 wrong views | 49 exact |

- 0 wrong views and 0 unsafe results in both runs.
- Nothing that was correct before became incorrect.
- Median latency rose from about 135 ms to about 148 ms, with up to 63 questions per part. The question cap rises to 800, which fits a 12-part request.

## Revisit when

- Evals show a question no longer changing outcomes (rerun the ablations after any model or wording change).
- A new model is pinned.
- A new case type shows the rules dropping something the User meant.

The owner approved this design as "our best understanding now", to be improved with evidence.
