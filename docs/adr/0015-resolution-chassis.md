# Resolution chassis: strategies and domain declarations

GridCue is a chassis. Every client's data, grids and words differ, so the Host chooses how GridCue uses Jev and describes its own domain in a few declarations. This ADR records the resolution chassis spec (`docs/superpowers/specs/2026-09-24-resolution-chassis-design.md`) as built and measured.

## Strategies

`createJevProvider({ strategy })` chooses which questions are asked, and `signals` overrides individual ones. The compiler is the same for every strategy and treats a missing answer as "no signal", so the strategies are one code path.

| Strategy | Signals | Questions per part, wealth schema | Median latency |
| --- | --- | --- | --- |
| `"focused"` | none: the first version's questions (PR #2) | 27 | about 137 ms |
| `"fan-out"` (default) | roles, kind, adds, outer, reading | about 55 to 70 | about 153 ms |
| opt-in | `values`: one Noul per enum value | about 5 more | — |

**Focused reproduces the first version and does better.** On the PR #2 baseline's cases, it gets 76 exact where PR #2 got 64, with no regressions, because the compiler improvements apply to every strategy. It still proposes the first version's wrong views on request types that version never handled: nesting, "also", and combinations. That is the trade-off it represents, and why fan-out is the default.

## Domain declarations

These are optional additions to `ViewSchema` and `ColumnDescriptor`:

- **`rowNoun`:** what one row is ("account").
- **`entity`:** the other record a column names ("household"). Any name of that column counts ("reps" for Advisor).
- **`valueGroups`:** Host categories over enum values ("Retirement" = IRA and Roth IRA). `defineSchema` rejects a group that names a value the column doesn't have.

## Rules

1. **Value groups** match like aliases and give one Mention per value, so the filter is `in`.
2. **An excluded value filters to the column's other approved values.** This covers "non-retirement", "excluding trusts", "everything except Northgate" and "not at Summit Trust". The complement is taken over `enumValues`, which the Host approved as the closed set.
3. **A value in a prepositional phrase is a filter,** wherever it sits: "sort by gain for trusts", "at Northgate", "among Roth accounts".
4. **A text-valued entity ranked by size means the records.** "Largest households first" or "top reps first": you can't rank a name by size, so GridCue offers "Group by Household" or "Use the Household column" rather than guessing. The rule came from evidence: Jev's reading question answered "column" (0.78 to 0.92) for these requests, so code decides this from the column's kind, like the amount rule in ADR 0013.
5. **The reading Choice** is asked for a row or entity noun that grammar can't place ("show the household for each account"): column, records, or this grid's rows.
6. **A family added by a rule and promoted by the provider in the same part runs once.** "Show IRAs at Northgate" had produced a duplicate filter.

## Evidence

The spec's 23 chassis cases were written before any code, and two more held-out sets (9 and 7 cases) before the refinements they tested. All 39 are now in `evals/cases-chassis.jsonl`.

**Before the chassis:**
- 10 of 23 exact;
- 2 wrong views ("Show the household for each account" also showed Account number; "Retirement accounts grouped by advisor" dropped its filter);
- 1 unsafe ("Largest households first" sorted instead of asking).

**Final fan-out results, from two consecutive verbose runs:**

| Set | Result |
| --- | --- |
| Core, 31 cases | all correct |
| Live-only, 56 cases | 55 correct |
| Fan-out, 50 cases | 49 correct |
| Chassis, 39 cases | 36 correct |

0 wrong views, 0 unsafe, and no regressions against the pre-chassis baseline. The one fan-out miss is a known flaky case: exact in 8 of 12 runs, and it asks otherwise.

**Ablation, removing one signal from fan-out:**
- **`reading`** decided 2 cases, and without it "Show the household for each account" proposes a wrong view. It stays.
- **`values`** decided 1 case, below its bar of 3, and that case also flips when `reading` is removed. It is **opt-in**, not deleted. It is the only route to categories nobody declared ("tax-advantaged" scored IRA 0.39), and the owner asked that approaches stay available as configuration.

**One label changed on the owner's direction.** Two older live-only cases labelled "Largest/Top households first" as "sort by Market value". They contradicted the owner's direction to decide whether a noun means records or the column, and the chassis labels. They now expect the records question. The grill log records the change.

## Remaining findings

All of these ask the User; none applies a wrong view.

- **"Remove the custodian column":** Jev scores no change type.
- **"Tax-advantaged accounts":** declare it as a value group, or opt in to `values`.
- **"Biggest households at Northgate first":** the qualifier rule places "households" as rows before the ranking rule sees it.
- **"Sort by gain limited to Harborline":** "to" is not in the preposition list, so it depends on opt-in `values`.

## Revisit when

- The model or the question wording changes. Rerun `pnpm eval:live -- --strategy=focused` and the `--without` ablations.
- A client's domain shows the declarations missing something.
