# What a provider proposes is checked against the request's words

The compiler narrows an Intent Provider's proposal in three places before it weighs it, and raises it in one. Each rests on something code reads from the request with certainty.

A live run with Jev over the new reading cases found wrong views that no rule-based run showed, because they came from what the provider proposed, not from how the request was read (four bets plan, PR 1, 2026-11-10). All of them also happened in 0.2.0:

- `advisor containing "restricted" and market value over $2m` added "Restricted holdings is Yes". The provider picked a value from a word inside quoted text.
- "Clear filters, grouping" cleared the filters and left the grouping. The provider scored one of the two clears too low.
- "Clear everything but the sort" previewed a hide of several columns nobody named, beside the reset.

The checks:

- **Quoted text names nothing.** A column or value the provider picks is dropped when its name appears in the part only inside quoted text and no Mention supports it. The quoted text still makes its own filter. A pick with no quoted text in play is accepted as before: a provider may still read a synonym the Host never declared.
- **A clear covers what its verb governs.** Code reads which of the sort, the grouping, and the filters a clear verb governs. A plan that clears fewer of them than that is not ready, and GridCue asks.
- **A part that only clears changes nothing else.** When a part's words are a clear or a reset and it names no column, value, or amount, a proposed change of any other kind is dropped.
- **The words can confirm a clear.** A clear or reset that the verb governs, and that the provider scores at or above the Host's `clarify` band, is used as if it were at `ready`. This is the one place a proposal is raised. It follows ADR 0013, where a column named by the Host's own label needs only a low provider score. Nothing the words don't govern is raised, and nothing below `clarify`.

Every drop is recorded as `dropped:` evidence on the plan.

These checks run on the plan a request produced. A plan the User edited in the Preview is not checked against the request's words (ADR 0036).

The owner's second rule already says a provider's output is a proposal. These checks apply it to cases where the words settle the matter. They do not make the provider path as strict as the Local Resolver (ADR 0020): a provider is still trusted to read wording code can't, which is what it is for.

The `ready` and `clarify` defaults do not change.
