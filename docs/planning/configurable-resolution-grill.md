# Configurable resolution and the remaining misses: grilling log

This log follows PR #3 (per-part fan-out). It covers the owner's direction and questions from 2026-09-24:

> "row noun also a column, let's find a way to determine based on user question if they are intending it to be a row record (single record) or if they want it applied to the column. Sort by gains for trust, we need to make this work. How can we accomplish this? I don't understand the retirement accounts, two values of one column."
>
> "We should allow users to configure how they want to use Jev, so don't throw away the first working version or the fan out, perhaps we have both as different solution options to demo? Since the structure of data and grids and views is client dependent, we are just creating the chassis for easy setup"

It follows `.claude/skills/gridcue-planning`: grill, then spec, then plan.

## Facts gathered (2026-09-24)

- **Nothing was thrown away.** The fan-out is additive. Its answers are optional `ClauseResolution` fields, and the compiler behaves exactly as before without them (ADR 0014). `pnpm eval:live -- --without=roles,kind,adds,outer` already reproduces the first version's behaviour from the same code. Offering both is mostly a provider option, plus a way to show the difference.
- **The questions per part on the wealth schema:**
  - First version (PR #2): 27 questions per part, a median of about 135 ms, 40 of 56 live-only cases correct.
  - Fan-out (PR #3): 63 questions per part, about 148 ms, 51 of 56.
- **Row nouns.** The remaining misses are "Largest households first" and "Top households first". The grid's rows are accounts, and Household is a column holding each account's household name. "Households" can mean three things:
  1. **the column's values:** sort by the Household name;
  2. **households as records:** rank households by their total, meaning group by Household and sum Market value, or open the household grid;
  3. **the grid's own rows**, as "accounts" does.

  Reading 2 needs aggregation (`aggregation.set`, which is in the protocol but not in `MVP_OPERATIONS`) or grid routing (the Q2 spec). No Host declaration tells GridCue which noun names the rows, or which columns point at other entities.
- **"Sort by gain for trusts".** The value comes after the verb, so the word-order rule (ADR 0014) doesn't make it a filter, and GridCue asks. Filter phrases after the verb usually start with a preposition: "for trusts", "among IRAs", "at Northgate", "in Roth accounts".
- **Two values of one column.** Each enum column gets one Choice ("which value of Registration type is mentioned?"). A Choice returns one pick, so it can't express IRA *and* Roth IRA. The TypeSafe function-calling cookbook uses one Noul per member for multi-value arguments. *Verified.*

## Round 1

Answer by number. A bare "agree" accepts the recommendation.

❓ **Q1 - Resolution strategies as a Host option.**
(a) **Named presets on the Jev provider:**
   - `createJevProvider({ strategy: "focused" })` asks the first version's questions: 27 per part.
   - `"fan-out"` adds the ADR 0014 questions: 63 per part. This is the default.
   - Advanced Hosts can pass `signals: { roles, kind, adds, outer }` to turn individual questions on or off.

   The compiler already handles both, so there is one code path and no fork.
(b) Two separate providers.
(c) Keep one strategy.

➡️ (a). It is the chassis idea in code: a Host whose grids are simple can use "focused" for fewer tokens, and one with compound requests uses "fan-out". The eval CLI's `--without` becomes `--strategy` plus `--signals`, so every configuration can be measured the same way.

---

❓ **Q2 - Demoing the strategies.**
(a) **A strategy switch in both examples, with a comparison panel.** It shows, for the same request, each strategy's Preview, question count and latency side by side, with the Mock Provider as a third column. It is off by default and behind a "Compare strategies" toggle.
(b) The switch only, with no comparison.
(c) Eval output only, with no UI.

➡️ (a). It lets a prospect see the trade-off on their own words, and it reuses the developer panel the handoff already lists as a gap. It is UI, so the spec runs the design pass first (`emil-design-eng`, `better-ui`, `principle-experience-first`).

---

❓ **Q3 - Row noun or column: how GridCue decides.**
(a) **Host declarations plus one Jev question, only when needed.**
   - The schema gains `rowNoun` (for example "account"). A column can declare the entity it refers to: Household gets `entity: "household"`.
   - When a Clause names a declared entity noun, and the grammar rules (ADR 0013) can't settle it, Jev gets one Choice in the same call: "In `clauses[p].text`, does ‘households’ mean (a) the Household column's values, (b) households as whole records, or (c) the rows of this grid?"
   - (a) is used as a column. (c) is ignored as a name.
   - (b) is **not applied silently**: GridCue offers "Group by Household" or, once routing exists, "Open the Households grid".
(b) Grammar rules only.
(c) Ask the User every time.

➡️ (a). The Host knows its entities, and declaring them costs a line each. The same declarations are exactly what grid routing (Q2 in the fan-out grill) needs, so this lays its groundwork. Reading (b) needs aggregation or routing to apply, so until then it becomes a clear choice for the User, not a guess.

---

❓ **Q4 - "Sort by gain for trusts": values after the verb.**
(a) **Both of these:**
   - **Code:** a named value inside a prepositional phrase ("for", "among", "at", "in", "with", "from", "of") filters, wherever it sits.
   - **Jev:** for every named value, ask one Noul in the same call, "Does `clauses[p].text` limit the rows to ‘Trust’?" A value that neither rule places, with the Noul at or above its threshold, filters too.
(b) Code only.
(c) Jev only.

➡️ (a). The preposition rule covers the common phrasing deterministically, and the Noul covers the rest ("Sort by gain, trusts only please"). As with ADR 0014, each half is measured by ablation and kept only if it decides cases.

---

❓ **Q5 - Two values of one column ("retirement accounts").**
(a) **Both of these:**
   - **Host value groups** in the schema: `valueGroups: { retirement: ["ira", "roth_ira"] }`. These are matched deterministically, like aliases, and become an `in` filter.
   - **Jev:** one Noul per enum value instead of one Choice per column, "Does `clauses[p].text` mean accounts whose Registration type is ‘IRA’?". Several yes answers make an `in` filter.
(b) Value groups only.
(c) Per-value Nouls only.

➡️ (a). Value groups are the chassis way: the Host names its own categories once and gets exact results. The Nouls catch categories nobody declared. On the wealth schema they add about 5 questions per part (7 Nouls in place of 2 Choices). This follows the documented multi-value pattern. It goes in the "fan-out" preset, with "focused" keeping the Choice.

---

❓ **Q6 - Scope and order.**
(a) **One spec for Q1, Q3, Q4 and Q5**, the resolution chassis, measured with held-out sets and ablation as before. Then a UI spec for Q2, the comparison demo. Then the grid-routing spec, which builds on Q3's entity declarations.
(b) Everything in one spec.

➡️ (a). The chassis changes are measurable without UI. The demo is better once there are several strategies worth comparing. Routing reuses the entity declarations.

## Round 1 answers (owner, 2026-09-24)

"I'm good with your proposal": every recommendation (Q1 to Q6) accepted, as the current best design (see the owner's standing "iterate when needed" direction).

| Q | Recorded as |
| --- | --- |
| Q1 | `strategy: "focused" \| "fan-out"` on the Jev provider, plus per-signal toggles. |
| Q2 | A comparison demo, in its own UI spec, after this one. |
| Q3 | `rowNoun` and column `entity` declarations, plus a Jev reading Choice only when grammar can't settle it. "Whole records" is offered, never applied silently. |
| Q4 | A deterministic preposition rule, plus a Jev check for named values. |
| Q5 | Host `valueGroups`, plus per-value Nouls in the fan-out preset. |
| Q6 | A chassis spec (Q1, Q3, Q4, Q5), then the demo UI spec, then grid routing. |

### Found while writing the spec

**Q4's Jev check and Q5's per-value Nouls are the same question.** "Does the part mean rows whose Registration type is Trust?" both limits the rows and allows several values. The spec therefore asks it once per enum value, and uses the answer for both jobs.
