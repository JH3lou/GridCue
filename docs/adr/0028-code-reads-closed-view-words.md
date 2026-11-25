# Code reads closed view words

**Status:** accepted with the operation set spec (2026-11-13). Not yet built.

Pins, density, totals, and setting or clearing a count are reached by code that reads a small, closed set of words. No Operation Family is added for them. The request sent to an Intent Provider, the families it scores, and Jev's questions do not change, so the protocol stays at 0.1.

The protocol has held `columns.pin`, `density.set` and `aggregation.set` since 0.1, and the validator and the Preview know them. No request could reach them: "pin account number", "compact view" and "total market value by advisor" all ended in "I'm not sure what to change" with the Mock Provider (operation set grill, 2026-11-13). The other way to reach them was three new Operation Families with new Jev questions. The owner approved closed words, read the way counts already are (ADR 0018).

What makes the reading safe:

- **A Clause is read whole or not at all.** It is read only when every word is one of the form's own words, a Mention of a column, or a filler word the form allows. One word left over and the Clause goes to the provider exactly as it does today.
- **Columns come only from Mentions.** A provider's pick, a Row Noun, or a value is never the column. So "pin the Northgate accounts to my watchlist" and "freeze the Alder account" read as nothing here, and stay refused or asked about.
- **The Host's names come first.** A form word that is also a declared label or alias is a Mention, so the form doesn't read.
- **The words are narrow.** "Freeze" counts only with "column". Density takes "compact", "comfortable" or "spacious" beside "view", "rows", "density" or "mode". "Denser" and "tighter" depend on the current density, so they ask.
- **A word joins the list only on held-out evidence.** Each list is tested on cases labelled before it exists, with no wrong view allowed.

When code reads a Clause, its operations are used and the provider's families for that Clause are ignored. ADR 0019 holds without a change, since a read form uses every word.

This is a first slice of the Local Resolver (ADR 0020), which will call the same reader, so each form is written once. It does not skip the provider call. That stays the Local Resolver's job.

The cost is reach. "How much does each advisor manage" is not read. It goes to a provider that has no family for totals, so no total comes of it. With the Mock Provider it ends in a question; nothing was run with Jev. A looser reading was not taken, because every looser reading tried in the four bets' first PR opened new wrong views.

What would change it: a held-out set, written without sight of the word lists, where more than half of the natural requests for totals end in a question. That goes to the owner as evidence for a provider family beside the closed words. No such set has been run yet.
