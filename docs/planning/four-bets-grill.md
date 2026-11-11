# Four bets: grilling log

The owner's direction on 2026-11-09, after a review of what would most improve GridCue: build four bets.

1. **The view is a sentence.** Every View State has one plain-English sentence, shown live above the grid.
2. **Understood as you type.** The request input marks each word as GridCue recognises it, before Enter.
3. **Local first, model last.** Rules resolve in the browser; the Intent Provider is called only for what rules can't settle.
4. **Terse requests.** A shorthand for heavy Users, such as `taxable over 1m by advisor desc`.

Each bet came with a cheap test. All four ran on 2026-11-10 as scratch probes outside the repo, with the Mock Provider and no live calls. This round turns their results into decisions. The probes changed nothing in the repo.

## Facts gathered (2026-11-10)

Marked *Verified* when re-run by hand after the probe, *Probe* when only the probe measured it, and *Unverified* when nobody has.

### Wrong views in 0.2.0, found along the way

These are ready-to-apply plans for a view the User didn't ask for.

| Request | Preview today | Cause | Reach |
| --- | --- | --- | --- |
| "show accounts with market value > $1m" | Filter Market value **to** $1,000,000 | `normalize.ts` reads `>`, `<`, `>=`, `<=`, `=` only when glued to a word; an unread comparison defaults to "equal to" | Core, every provider. *Verified.* |
| "accounts with gain below -$50k" | Filter Unrealized gain **to $50,000** | Numbers have no sign, and the sign hides the comparison word | Core, every provider. *Verified.* |
| "Show gain at least $100k" | Filter **Market value** at or above $100,000 | `mentions.ts` treats "at" after a name as a qualifier, so "gain" reads as the rows | Mock path *verified*. With Jev *unverified*. |
| "Accounts over $1M grouped by custodian." | Group by Custodian (filter lost) | The Mock keeps one change per Clause; nothing notices the amount went unused | Mock path *verified*. Labelled exact with Jev. |
| "Show only the advisor and restricted holdings columns." | Show only rows where Restricted holdings is Yes | The Mock reads every yes/no column name as a value | Mock path *verified*. With Jev *unverified*. |

Safe but wrong: a full stop inside a quoted value splits the request, and "29.377%" is refused as unreadable. *Verified.* No eval case uses a spaced symbol, a negative amount, or "at least" after a column name, so the gate is green.

### Bet 1: the view is a sentence (probe D)

- **Round trip.** 1,500 random reachable View States on the wealth schema, each rendered to a sentence and typed back on the default view. *Probe.*

  | Wording and resolver | Identical | Ready but different | Asked |
  | --- | --- | --- | --- |
  | The bet's first wording, Mock Provider | 417 | **180** | 862, plus 41 refused |
  | Tuned wording, Mock Provider | 1,018 | **137** | 345 |
  | Tuned wording, a resolver that reports only each part's leading keyword | **1,500** | 0 | 0 |

  "Identical" counts quoted text that differs only in letter case, which filters the same rows. All 137 wrong results with the tuned wording are the yes/no column bug above.
- **The deterministic layer does the work.** The keyword resolver sends no columns and no values. The compiler takes those from Mentions and literals.
- **A sentence is a change, not a view.** Typed on a view that isn't the default, the same sentence produced a different view 242 times in 400, because hidden columns and other settings carry over. *Probe.*
- **What prose can't carry.** Values containing a quote mark, labels that are instruction words ("Group", "Top 10"), the order of hidden columns, and float noise. *Probe.*
- **What no request can reach, so has no sentence today.** OR, "starts with", empty and not empty, pinning, aggregations, density, negative values, a count without a sort.
- **Length.** Median 131 characters, largest 445. A hand-built largest view is 682, over the default 500-character limit.

### Bet 2: understood as you type (probe C)

- **Agreement with the final plan.** On the 166 labelled requests that end in a plan, 199 of 200 unambiguous Mentions are in the plan. Amounts (16 of 16) and directions (38 of 38) read correctly. *Probe.*
- **The misleading class is the one already flagged.** 9 of 32 `ambiguous` Mentions are the Row Noun meaning the rows.
- **Refused requests still match.** "Sell the taxable accounts over $1M" matches "taxable" and "$1M".
- **Flicker.** In 35 of 174 requests a highlight is retracted while typing. "concentration" matches, drops at "above", and returns at "10%".
- **Cost per keystroke.** 0.05 ms median on the 9-column schema. 12 ms median and 73 ms worst on a synthetic 200-column schema with 20 values each, because the matcher rebuilds its patterns on every call.
- **Positions are the blocker.** `Mention.start` and `Literal.at` index the cleaned Clause text, which is lowercased, trimmed, and sometimes given a borrowed verb. Nothing maps back to what the User typed. Directions and counts carry no position. `withoutNamedSizes` is not exported.

### Bet 3: local first, model last (probe A)

- **The rules alone are not safe.** All 188 labelled requests through the Mock Provider: 125 exact, 34 asked where a plan was expected, **8 wrong ready plans**. All 8 are in the sets written for Jev. *Probe.*
- **A trust rule separates them.** Trust the local result only when the plan is ready, every word is accounted for, and every amount and name that was read is used by the plan, plus two narrower checks. That trusts 100 of 188 (53%) with 0 wrong. On the three sets written for Jev the share is about 49%.
- **The evidence is weak.** The rule was written after seeing the 8 failures. With one file held out, the word list let one wrong view through until a further check was added.
- **Where it would live.** Two of the checks need the compiled plan, which an Intent Provider never sees, so the rule belongs in the Controller.
- **One check stands on its own.** "Every amount and name read is used" would have failed two of the 8 closed, for any provider.

### Bet 4: terse requests (probe B)

- **40 terse lines, labelled before the run**, with short aliases declared (`tax`, `adv`, `mv`). *Probe.*

  | Style | Exact | Wrong ready plan | Asked or refused |
  | --- | --- | --- | --- |
  | Compressed English (`taxable over 1m by advisor desc`), 24 | 12 | 5 | 7 |
  | Symbols (`tax >1m /adv -mv !trust`), 16 | 2 | 8 | 6 |

- **Compressed English is held back by small parser gaps:** spaced comparison symbols, `sort X` with no "by", one direction for a whole Clause (`sort adv, mv desc` sorts both descending), `top10`, a bare `1m` with no column, and `ungroup`.
- **Symbols are a second grammar.** Nothing reads a prefix symbol today. `-` already means a negative number, and `!` already ends a part. Unread tokens were dropped silently, not asked about.

### What the four results have in common

Three bets need the same two pieces: a strict local resolver that reads a known grammar and declines the rest, and a Controller check that refuses a ready plan when anything read was left unused. The sentence's round trip, local-first trust, and terse requests are all that pair applied to different wording.

## Round 1

Answer by number. A bare "agree" accepts the recommendation.

❓ **Q1 - The wrong views above.**
(a) **Fix them first, as their own PR,** before any bet. Cases are written and labelled before each fix. The PR also adds the core check that a ready plan uses every amount and name it read, and otherwise asks.
(b) Fold the fixes into the bets' work.

➡️ (a). They are wrong views in a published release, and every bet builds on symbols, signs, and quoted text being read correctly. A fix PR needs no spec.

---

❓ **Q2 - What the sentence is.**
(a) **The View State is the record, and the sentence is how it reads.** A saved or shared view carries the View State. GridCue promises one thing about the sentence: typed on the default view, it reproduces the same view with no provider call. A property test over random views enforces that, and the renderer says when a view holds something prose can't carry.
(b) The sentence is the stored form, with its own parser and an escape syntax for awkward values.

➡️ (a). The probe showed a sentence is a change, not a view, and that some values can't survive prose. (b) would need a second grammar that Users also have to be kept away from typing by accident.

---

❓ **Q3 - What ships with the sentence.**
(a) **Three things:** `describeView(state, schema)` in the root entry; the sentence shown live in both UIs, updating on manual changes; and `proposeView(state)` on the Controller, so a saved or shared view arrives as a Preview and applies like any plan. Storage, naming, and URLs stay with the Host.
(b) The sentence display only.

➡️ (a). Without a checked way back in, a saved view would bypass Preview. With it, a Host builds saved views and links in a few lines.

---

❓ **Q4 - How local resolution is built.**
(a) **A new strict Local Resolver** that reads the grammar the sentence and terse requests use and declines anything else, plus the trust rule in the Controller, plus an optional remote Intent Provider for what is declined. The Mock Provider stays a test and demo fixture.
(b) Promote the Mock Provider and wrap it in the trust rule.

➡️ (a). The Mock guesses with fixed confidence, which is how it produced 8 wrong plans. The probe's keyword resolver guessed nothing and produced none. This changes the Controller's options, so it needs an ADR.

---

❓ **Q5 - Local first: default or opt-in.**
(a) **Opt-in in this release.** It becomes the default only after two fresh sets, labelled before the rule is frozen and one on a second schema, show 0 wrong views among trusted results.
(b) Default now.

➡️ (a). The 0-wrong result was fitted to the failures it was shown, and the trusted share on Jev-style wording is about half. The target stays 0 wrong views. The Site demo moves to the Local Resolver either way, so it asks instead of guessing.

---

❓ **Q6 - Terse requests: how far.**
(a) **Compressed English only.** Close the parser gaps, give each sort column its own direction, document short aliases, and complete names with Tab. No symbols.
(b) Add the symbol grammar (`/adv -mv !trust`) too.

➡️ (a). It was half working by accident and the gaps are small. Symbols collide with negative numbers and the part separator, and gave 8 wrong plans in 16.

---

❓ **Q7 - What as-you-type shows.**
(a) **An underline on each recognised word, and a line beneath that says what it means** ("Roth: Registration type is Roth IRA"). Shown only for unambiguous names and complete words. Nothing on a refused or restricted request. The design pass with the three UI skills happens in the spec.
(b) Underlines only.

➡️ (a). The line makes it usable without colour and by a screen reader, and it uses the same words as the sentence. Core first gains positions in the User's own text and a cached matcher.

---

❓ **Q8 - Order and shape of the work.**
(a) **One spec and one plan, approved together, then five PRs in this order:** fixes (Q1); positions and as-you-type; the sentence; the Local Resolver; terse requests. Each PR is built by sub-agents chosen by difficulty: the strongest model for the parser, trust rule and resolver, a mid model for hooks, both UIs, examples and docs, a small one for mechanical edits, and a separate reviewer that sees only the diff.
(b) Four separate specs and plans, one per bet.
(c) Skip the spec and plan and build from this log.

➡️ (a). The bets share two core pieces, so one spec keeps them consistent. Approving spec and plan in one step bends the planning rule that each needs its own approval, so it needs your say-so. (c) breaks the rule outright.

## Round 1 answers (owner, 2026-11-10)

"Approved": Q1 to Q8 accepted as recommended.

| Question | Answer |
| --- | --- |
| Q1 - The wrong views | (a) Fix first, as their own PR, with the core check |
| Q2 - What the sentence is | (a) The View State is the record; the sentence is how it reads |
| Q3 - What ships with the sentence | (a) `describeView`, the live sentence in both UIs, `proposeView` |
| Q4 - How local resolution is built | (a) A new strict Local Resolver; the Mock Provider stays a fixture |
| Q5 - Local first: default or opt-in | (a) Opt-in, default only after two fresh sets show 0 wrong views |
| Q6 - Terse requests | (a) Compressed English only |
| Q7 - What as-you-type shows | (a) Underline and a line beneath |
| Q8 - Order and shape | (a) One spec and one plan approved together, then five PRs |

Q8 (a) is the owner's sign-off to approve the spec and plan in one step, which the planning rule otherwise keeps separate.

The terms **View Sentence** and **Local Resolver** entered `CONTEXT.md` with these answers.

## Spec and plan (owner, 2026-11-10)

The spec (`docs/superpowers/specs/2026-11-10-four-bets-design.md`) and the plan (`docs/superpowers/plans/2026-11-10-four-bets.md`) were put to the owner with four questions. The answer: "Approved commit and open pr(s)".

| Question | Answer |
| --- | --- |
| Approve the spec and plan, including an optional `provider`, a direction for each sort column, and a Site demo that asks more often | Approved |
| Commit to stacked branches and open each PR as it passes its gate | Approved |
| One live run with Jev before the fix PR merges | Approved |
| Keep the five older wrong views the review found in the fix PR | Approved |

The owner also asked for the new version to be tested in a representative Host application before it is relied on.
