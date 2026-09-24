# Resolution chassis: design spec

**Status:** approved by the owner on 2026-09-24
**Date:** 2026-09-24
**Scope:** grill answers Q1, Q3, Q4 and Q5 in `docs/planning/configurable-resolution-grill.md`. The comparison demo (Q2) and grid routing are later specs.

The owner approved these as the current best design. As in ADR 0014, every new question has an evidence bar and is removed if it doesn't meet it.

## 1. Purpose

GridCue is a chassis: every client's data, grids and views differ, so the Host should be able to pick how GridCue uses Jev, and describe its own domain in a few declarations. This spec delivers that, and uses it to fix the three remaining kinds of miss:

- **Row nouns that are also columns.** "Largest households first" on the accounts grid.
- **Values after the verb.** "Sort by gain for trusts".
- **Categories spanning several values.** "Retirement accounts" means IRA and Roth IRA.

Success means the following, in two consecutive live runs:
- 0 wrong views and 0 unsafe results;
- each of the three miss kinds is exact on held-out cases written before the code;
- nothing that is correct today regresses, under either strategy.

## 2. Decisions this spec builds on

| Decision | Source |
| --- | --- |
| `strategy: "focused" \| "fan-out"`, with per-signal toggles | Grill Q1 |
| `rowNoun` and column `entity` declarations, and a Jev reading question only when grammar can't settle it | Grill Q3 |
| A preposition rule, plus a Jev check for named values | Grill Q4 |
| Host `valueGroups`, plus per-value Nouls in fan-out | Grill Q5 |
| The Q4 check and the Q5 Nouls are one question | Grill log, "Found while writing the spec" |
| Additive, optional protocol fields; protocol stays 0.1 | ADR 0010 precedent |

## 3. Scope

### In

- Jev provider strategies and signal toggles (5.1).
- Schema declarations: `rowNoun`, column `entity`, and `valueGroups` (5.2).
- Mentions for value groups and row nouns (5.3).
- The compiler's preposition rule, reading answers, and multi-value filters (5.4).
- The eval CLI's `--strategy` and `--signals`, and new held-out cases (section 7).
- ADR 0015.

### Out

- The comparison demo UI (Q2).
- Grid routing. A "whole records" reading becomes a choice for the User, not a redirect.
- Aggregation. "Rank households by total value" is offered as "Group by Household", not computed.
- `ready` and `clarify`.

## 4. Strategies (Q1)

```ts
createJevProvider({
  apiKey,
  strategy: "fan-out", // default. "focused" asks only the first version's questions (PR #2)
  signals: { roles: true, kind: true, adds: true, outer: true, values: true, reading: true }, // optional overrides
});
```

| Signal | Question | "focused" | "fan-out" |
| --- | --- | --- | --- |
| roles, kind, adds, outer | ADR 0014 | off | on |
| values | one Noul per enum value (5.4), replacing that column's value Choice | off (keeps the Choice) | on |
| reading | a reading Choice for an ambiguous entity noun (5.4) | off | on |

- The strategy only chooses questions. The compiler is the same for both, and it treats a missing answer as "no signal".
- `signals` overrides individual questions on top of the strategy.
- An unknown signal name is a `GridCueError` at construction.

## 5. Units

### 5.1 Jev provider

- **Strategy and signals.** These decide which questions are built. The question cap (800) still applies.
- **Value Nouls,** when `values` is on. One per enum value, per part, except for columns with a value Mention: "Does `clauses[p].text` mean rows whose ‘Registration type’ is ‘IRA’?". These replace that column's value Choice. Every value at or above `ready` is returned in `values`, so several values of one column can come back.
- **Named-value check.** This reuses the value Nouls. For a column that *has* a value Mention, only the mentioned values are asked about, so code can tell whether they limit the rows.
- **Reading Choice,** when `reading` is on. It is asked for each Mention of an entity noun (5.2) that the grammar rules didn't already place: "In `clauses[p].text`, what does ‘households’ refer to?". The options are:
  - `column`: "The Household column's values";
  - `records`: "Households as whole records";
  - `rows`: "The rows of this grid, which are accounts".

  `records` is offered only when the noun is a column `entity`, and `rows` only when it is the `rowNoun`.

### 5.2 Schema declarations (`core/schema.ts`, `core/protocol.ts`)

These are optional additions to `ViewSchema` and `SchemaOptions`:

- **`rowNoun?: string`**: what one row is ("account"). Its plural matches too.
- **`entity?: string`** on a column: the other record the column names ("household" on Household).
- **`valueGroups?: { label: string; aliases?: string[]; values: string[] }[]`** on an enum column, for example `{ label: "Retirement", aliases: ["retirement"], values: ["ira", "roth_ira"] }`. The values must be ids in that column's `enumValues`; otherwise `defineSchema` throws `SCHEMA_INVALID`.

The wealth fixture declares:
- `rowNoun: "account"`;
- `entity: "household"` on Household, and `"advisor"` on Advisor;
- the Retirement group.

### 5.3 Mentions (`core/mentions.ts`)

- **Value groups** are matched with the enum values, and each group Mention yields one Mention per member value. "Retirement accounts" therefore gives `registration_type=ira` and `registration_type=roth_ira`.
- **Row nouns and entity nouns.**
  - A Mention whose text is the `rowNoun`, or a column's `entity` word, is flagged `ambiguous: true` whenever it is also a column name ("account", "household"), unless a grammar rule already placed it.
  - Flagged Mentions are sent to the provider, which asks the reading Choice when that signal is on.
  - The rest of ADR 0013 is unchanged.

### 5.4 Compiler (`core/compile.ts`)

1. **Preposition rule.** A named value inside a phrase introduced by for, among, at, in, with, from, of or within is a filter, wherever it sits ("Sort by gain for trusts"). It is recorded as `c{p}.preposition`.
2. **Named-value check.** A named value that neither word order nor a preposition places filters if its value Noul is at or above `FAN_OUT.values` (0.7). It is recorded as `c{p}.values`. Otherwise GridCue asks, as today.
3. **Multi-value filters.** Several values of one column become one `in` filter, which already happens for Mentions. Provider values now reach this path too.
4. **Readings** (`FAN_OUT.reading`, 0.6):
   - `column` keeps the Mention;
   - `rows` drops it, and records `dropped:c{p}.mention`;
   - `records` asks: "Did you mean households as a whole? GridCue can group by Household.", with the options "Group by Household" and "Use the Household column".

   With no reading answer, today's rules apply.

## 6. Protocol

These are optional additions:
- `ViewSchema.rowNoun`;
- `ColumnDescriptor.entity`;
- `ColumnDescriptor.valueGroups`;
- `ResolutionRequest.clauses[].mentions[].ambiguous`;
- `ClauseResolution.readings?: { columnId, reading: "column" | "records" | "rows", confidence }[]`.

ADR 0015 records them.

## 7. Evals and evidence

- **Held-out cases, written before the code:** about 24 in `evals/cases-chassis.jsonl`, 8 per miss kind, plus controls:
  - "account" meaning the column;
  - a value before the verb;
  - a single value;
  - a group name used as a plain word.
- **`--strategy=focused|fan-out` and `--signals=...`** replace `--without`, which keeps working as an alias.
- **Acceptance is two consecutive runs of each strategy:**
  - **fan-out:** 0 wrong views, 0 unsafe, no regressions;
  - **focused:** the same numbers as PR #2's baseline, which proves the strategy option really reproduces the first version;
  - **Ablation:** `values` must decide at least 3 cases, and `reading` at least 2, or they are removed. Value groups and the preposition rule are deterministic and are tested by the Mock and unit tests.
- **Latency:** the fan-out median grows by 25% or less over about 148 ms.

## 8. Testing

- Unit tests for every schema declaration, including an invalid value group.
- Unit tests for group Mentions and ambiguous flags.
- Unit tests for each compiler path in 5.4 and its fallback.
- Unit tests for strategy and signal question sets, including an unknown signal.
- Mock cases for value groups and the preposition rule.
- The `pnpm check` gate is unchanged.

## 9. Acceptance criteria

1. `pnpm check` passes with no credentials.
2. `pnpm eval` passes every Mock case.
3. The strategy runs in section 7 meet their bars.
4. Each Jev signal meets its evidence bar or is removed, and ADR 0015 records the result.
5. The README gains a short "Choosing a strategy" note, and the handoff is current.

## 10. Risks

- **The preposition rule can over-filter.** "Sort by gain in descending order" puts no value after "in", so the rule doesn't fire. "Show gain for each advisor" names a column, not a value, so the rule doesn't apply.
- **Reading Choices can be low-confidence.** When they are, today's rules apply, and today's rules produce no wrong views.
- **Per-value Nouls cost tokens.** On a schema with large enums, a Host can turn `values` off.
