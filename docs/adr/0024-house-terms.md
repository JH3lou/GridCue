# House Terms

**Status:** accepted with the named filters spec (2026-11-13). Not yet built.

A Host can declare a House Term in its View Schema: a name, such as Large, and a list of fixed conditions on its columns, such as Market value above $1,000,000. All of the conditions must hold. When a request uses the name, code adds each condition as an ordinary filter, and the Preview states each one and names the term: "Filter Market value above $1,000,000 (Large)". The User sees the threshold, not just the word.

The product definition already said GridCue asks about "large" unless the Host supplies a meaning, but a Host had no way to supply one. With the Mock Provider, "large accounts" asked. Beside something GridCue could read, the word was dropped: "show large taxable accounts" previewed the Taxable filter alone, ready to apply (named filters grill, 2026-11-13). Nothing was run with Jev.

What makes a House Term safe to read:

- **The Host states it, and the schema checks it.** Each condition is checked the way a filter in a View Plan is: the column exists, is not restricted, may be filtered, allows the operator, and the value fits its kind. A bad one stops the schema from being built.
- **Its names are its own.** A name already used by a column, a value, a Value Group, the Row Noun, another House Term, or one of GridCue's own words is refused. "Large" and "largest" are different words, so a House Term never collides with the size words of ADR 0018.
- **It is never sent to an Intent Provider.** Not its name, not its conditions, and not whether a request used it. The request to the provider is the same with House Terms declared as without. A House Term is not a Mention.
- **The view keeps plain filters.** The View State, the protocol and every Grid Adapter are unchanged. The plan's evidence records the Host as the source and keeps the term's name.
- **A left-out House Term asks.** "Accounts that aren't large" is never read as the opposite comparison. The opposite also hides rows with no value, and negation was the largest source of held-out wrong views in the four bets' first PR.

A House Term holds only fixed conditions joined by "and". It never holds "or", which the TanStack Table adapter can't apply, or a moving date, which would put a clock inside a declaration. A meaning that needs other rows to work out, such as "top decile", is not a House Term.

ADR 0023 governs every Clause that holds a House Term: each other word must be placed, and a term where a column goes asks.

The option is named `houseTerms`. The root entry already exports `unknownTerm`, where a term is a name GridCue didn't recognise.

The cost is that the Host must write each term down, and that a request for the opposite of a term is a question.

This would be reopened if Hosts' real terms mostly need "or" or a moving date, or if held-out requests leave a term out often. The opposite reading would then be tried on a fresh held-out set.
