# Speculative fan-out: grilling log

The owner proposed restructuring how GridCue asks Jev, as a decision tree modelled on TypeSafe's smart-home demo:

1. **Request category.** Is the request simple or a combination? Is the User asking for several conditions?
2. **Target.** Which data grid is the request about, and is it the active view?
3. **Each condition.** Is the attribute (column) known from the text? Is the change a filter, a sort, or a group?
4. **Hierarchy.** When there are several groupings, which is on top and which is the lowest level? The same question arises for sort priority.
5. **Actions.** Which actions to take, and in what order.

This log reviews the tree against the TypeSafe docs and against GridCue as it stands on `claude/resolution-quality`. It follows `.claude/skills/gridcue-planning`: the grill comes first, then a spec, then a plan.

## Facts gathered (2026-09-24)

### TypeSafe docs

All of these were read live. The raw pages are kept outside the repo.

- **Fan-out.** "put all of the questions your system needs in a single request, and then use code to decide what is relevant." In the smart-home demo, asking the category first and then the rest is "the wrong way", because it is "much slower and more expensive". The demo's category, domain, device and action questions are all Choices in one call. *Verified: patterns/fan-out, demos/smart-home.*
- **The demo publishes no question definitions and no measurements.** The source is "available on GitHub at release". The measured benefit of batching (12.2x cheaper, 10.0x faster) comes from a 54k-character document. With a short Utterance, GridCue gains less. *Verified: cookbooks/parallel_questions.*
- **Multi-intent.** The demo asks a Noul, "is the request asking for more than one distinct action?". When the answer is yes, an LLM splits the request and each part is evaluated again. **Jev detects a compound request; it does not decompose one.** *Verified.*
- **Function calling.** The pattern has three kinds of question:
  - a routing Choice over the functions;
  - one Choice per single-value argument, and one Noul per member of a multi-value argument;
  - a companion "stated?" Noul per argument, so an argument the User never mentioned uses its default instead of being named confidently.

  Two arguments that draw on the same set of values are told apart by role wording, such as "the one being measured, named first". **One command maps to exactly one call; several calls in one request are not handled.** *Verified: cookbooks/function_calling.*
- **Hierarchical classification** goes level by level. This is the documented exception to fan-out, because the next level's options depend on the previous answer. *Verified.*
- **Ordering.** No doc gets an order from Jev. The jaggedness notes say:
  - dates are read "as text, not as ordered quantities", and "Code … owns everything after that, including ordering";
  - counting is unreliable, so iterate in code;
  - multi-hop questions cost accuracy.

  The documented tools are Choice probabilities as a ranking, one Noul per pair of items, and role wording ("named first"). *Verified.*
- **Choice and Noul thresholds differ.** A Choice is relative and a set of Nouls is absolute. A threshold tuned on one does not carry over to the other. *Verified.*
- **Routing to one of several targets** (room or device) is a Choice in the same call. The "stated?" Noul pattern covers "did the User name a different target at all?". *Verified: smart-home, how-to-build.*

### GridCue today

- **Steps 1, 3 and 5 are already one speculative fan-out.**
  - Every part of the request gets, in a single call: family Nouls, column Nouls, value Choices, a direction Choice, and literal Choices.
  - The compiler reads only the answers that apply.
  - Parts are split in code (`normalize`), and names are matched in code (Mentions, ADR 0013).
- **Step 2 does not exist.** One Controller is bound to one grid. There is no routing across grids or saved views.
- **Step 4 is a shipped bug.**
  - `group.set` and `sort.set` replace the current grouping or sort (`core/reduce.ts`).
  - "Sort by Advisor, then by Market value, largest first" previews "Sort by Advisor, ascending" and "Sort by Market value, descending", but applies only the Market value sort.
  - **The Preview claims two sort levels and the grid gets one.** This breaks the rule that the Preview states exactly what will change.
  - "Group by account type, then by advisor" has the same flaw.
  - The eval case `h3-account-type-group`, written in the last round, expects two separate `group.set` operations. It passes while encoding the wrong result.
- **Combinations inside one part fail.**
  - Families are decided per part, and a part gets one column family (ADR 0012 rules 4 and 5).
  - "Show accounts over $1M sorted by gain" and "Roth IRAs grouped by rep" have no comma, so they stay one part. GridCue then asks the User to split them.

## Review of the proposed tree

| Step | Who should own it | How, per the docs | Today |
| --- | --- | --- | --- |
| 1. Simple or combination | **Code** splits, over-finding. **Jev** flags "more than one distinct change" on each part. | Smart-home's multi-action Noul. GridCue has no LLM to split with, so when the flag is up and code can't split, GridCue asks a targeted question. | Code splits only. There is no flag. |
| 1b. Category | **Jev**, as a Choice | A category Choice over view change, unsupported kinds, and "not a request". It is relative, so it separates close families. It sits alongside today's family Nouls, which are absolute and can say "more than one". | Fourteen independent Nouls. |
| 2. Which grid, active view | **Code** knows the active grid. **Jev** is asked only whether the request names another grid, and which one. | The "stated?" Noul plus a grid Choice, in the same call. Two calls only if the grids' columns can't fit one request. | Not supported. |
| 3. Attribute known? filter, sort or group? | **Code** matches names. **Jev** answers "is this column referenced?" and "what does the request do with this column?" | Function calling: a Noul per column and role, for only the roles the column supports, keyed on column IDs. **This binds each column to its change**, so "Roth IRAs grouped by rep" resolves inside one part. | A family per part, and column Nouls without roles. |
| 4. Hierarchy | **Code**: the first named is outermost or primary. **Jev** only checks for reversal wording ("advisor within custodian"). | No ordering recipe exists, and the jaggedness notes say code owns order. Use one Noul per pair: "Is `a` the outer grouping, with `b` inside it?" | A replace bug (see above). |
| 4b. Add or replace | **Jev** | A Noul per sort or group part: "Does this add a level to the current grouping, rather than replace it?" The current view is already in the request. | Always replaces. |
| 5. Actions and order | **Code** | Canonical order: reset and clears first, then filters, groups, sorts, and columns. The User's order is kept within each family. | Order of the parts; replaces within a family. |

**Summary.** The tree is sound, and most of it is already one fan-out. Its most valuable new pieces are:

- **the per-column role questions** (step 3), which make combinations inside one part work without a splitter;
- **the multi-change flag** (step 1);
- **deterministic hierarchy** (step 4), which is a bug fix.

**The docs argue against two readings of the tree.** Asking the steps in sequence ("category first, then …") is the demo's "wrong way". Asking Jev to produce an order or a decomposition hits its documented weak spots. Code produces order and structure. Jev answers bounded questions about them, all in one call.

## Round 1

Answer by number. A bare "agree" accepts the recommendation.

❓ **Q1 - The hierarchy bug.**
(a) **Fix it now on `claude/resolution-quality`, before the PR.**
   - Consecutive parts of the same family merge into one operation, in text order: first named is outermost group or primary sort.
   - A later part replaces an earlier one only when it says so ("instead", "change to").
   - The Preview shows the levels ("Group by Registration type, then Advisor").
   - Fix the wrong eval expectation, and add hierarchy cases.
(b) Leave it for the fan-out spec.

➡️ (a). The Preview currently misstates what applies. The fix is deterministic and small, and it should not ship in a PR described as "0 wrong views".

---

❓ **Q2 - What "which grid / active view" means.**
(a) Several GridCue-enabled grids on one page, and the request picks one. This needs a new router above the Controllers.
(b) Saved or named views of one grid, such as "switch to my Q3 review view". This needs a saved-views feature.
(c) Both.

➡️ Your call; the answer changes the scope. **Either way, write it as its own spec**, because it adds a public API. Design it so the target question joins the same call. Use two calls only when the grids' columns can't fit one request.

---

❓ **Q3 - Per-column role questions (the function-calling pattern).**
(a) **Adopt them.** For each part and each column, ask one Noul per supported role: "Does `clauses[p].text` ask to filter / sort / group / show / hide by `columns[i]`?". The compiler builds operations from these pairs, so one part can filter and group. The per-part family Nouls stay as the "what kind of request" signal.
(b) Keep families per part, and depend on splitting.

➡️ (a), measured against the 56 live-only cases before we switch. On the wealth schema it adds about 30 questions per part. The limit of 600 allows about 10 parts, down from 12. Measure question tokens and latency, and keep the limit honest.

---

❓ **Q4 - The multi-change flag.**
(a) **One Noul per part:** "Does `clauses[p].text` ask for more than one distinct change?". If yes, and neither code nor Q3's role pairs can separate the changes, ask a targeted question instead of the generic split message.
(b) Skip it: Q3 covers most cases.

➡️ (a). It costs one question per part. It catches the compound requests Q3 can't bind, and it is the documented smart-home signal.

---

❓ **Q5 - Adding a category Choice beside the family Nouls.**
(a) **Add a per-part Choice** over the families plus `none`. The compiler uses it to break ties between column families, where ADR 0012's margin rule works today, and to pick the category.
(b) Keep Nouls only.

➡️ (a), evaluated first. The docs pair a Choice (relative) with Nouls (absolute) because they answer different questions. That is exactly the "show 0.85 against filter 0.82" case. It needs its own thresholds, not 0.85 and 0.65.

---

❓ **Q6 - Order and nesting.**
(a) **Code owns them.** Canonical order across families, the User's text order within a family, and first named is outermost or primary. Jev gets one Noul per pair only when reversal wording appears ("within", "inside", "under", "nested in", "then by … first").
(b) Ask Jev for the order.

➡️ (a). No doc gets an order from Jev, and the jaggedness notes warn against it.

---

❓ **Q7 - Add to, or replace, the current view.**
(a) **One Noul per sort or group part:** "Does `clauses[p].text` add another level to the current grouping or sort, rather than replace it?". The current view is already in the request. The default, when the Noul is low, is to replace, as today.
(b) Always replace.

➡️ (a). "Also group by custodian" is common, and the default stays as it is today.

---

❓ **Q8 - Thresholds for the new questions.**
(a) **Tune each new Choice and Noul on the eval set, and record them in one ADR** before they affect behaviour. Leave `ready` and `clarify` alone for the existing questions.
(b) Reuse 0.85 and 0.65.

➡️ (a). The docs are explicit that Noul and Choice thresholds don't transfer.

---

❓ **Q9 - Sequencing.**
(a) **PR `claude/resolution-quality` with the Q1 fix.** Then write a spec and plan for Q3 to Q8 (the per-part fan-out). Write Q2 (targets) as its own spec after that.
(b) One spec for everything.

➡️ (a). Each lands on measured evidence, and the public API change (Q2) stays separate from the internal question design.

## Round 1 answers (owner, 2026-09-24)

| Q | Answer | Recorded as |
| --- | --- | --- |
| Q1 Hierarchy bug | "agree" | Fixed on `claude/resolution-quality` before its PR. |
| Q2 Which grid | "for the demo we currently have in place, we will always be on the right grid, but this is not the reality of the use case. immagine an advisor desktop with many different views (client, household, account, positions…) redirect capability to correct grid." | Target routing across entity grids in a Host app, with a redirect to the right grid. Its own spec, after the fan-out spec. **Open for that spec:** today "navigate somewhere else" is an unsupported family, so redirecting means the Host navigates through a callback it owns, and GridCue picks the grid. |
| Q3–Q8 | "Agree, but with the understanding that this is our best understanding now, we should iterate to get better results if and when needed" | All six recommendations accepted as the current best design, not final. The spec states the evidence each new question must show, and removing or reworking a question that doesn't pay is expected. |
| Q9 Sequencing | "I'll follow your guidance in order and segmentation of work." | (a): PR resolution quality with the Q1 fix, then the fan-out spec (Q3 to Q8), then the grid-routing spec (Q2). |
