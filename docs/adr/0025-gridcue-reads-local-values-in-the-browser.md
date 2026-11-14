# GridCue reads Local Values in the browser

**Status:** accepted with the named filters spec (2026-11-13). Not yet built.

GridCue may read the values of a text column from the grid's own rows, in the User's browser, when the Host says so. The Host names each column in a `localValues` option on `createGridCue` and gives a function that returns that column's values. A value read this way is a Local Value. It is off unless set, and allowed only for text columns that are exposed, not restricted, and may be filtered.

Before this, GridCue never saw a row. A person's name worked only as quoted "containing" text. With the Mock Provider, "Avery Lane's accounts" asked, and "show taxable accounts for Avery Lane" previewed the Taxable filter alone (named filters grill, 2026-11-13). Nothing was run with Jev. The product definition foresaw a resolver for the grid's values that the Host must govern. This is it.

What is decided:

- **Nothing about a Local Value is sent to an Intent Provider.** Not the values, not whether one was named, not which column holds it, not the choices in a Clarification, and not the User's answer. The request to the provider, and the number of calls, are the same as with the option off. The Utterance is still sent, as it always was, so a name the User types is in it. What never leaves is whether the grid holds that name. A Local Value is not a Mention.
- **The Host says where the values come from.** For a grid that pages, that is the Host's own list, not the page on screen. The function is synchronous, so the same values can serve reading as the User types.
- **A whole value is certain.** Every word of it, in order, ignoring letter case, gives an exact filter on its column. The longest name wins, so "the Alder household" is the value Alder Household, not the Household column.
- **One word of a value only ever asks.** "Lane's accounts" asks "Did you mean Advisor: Avery Lane?", with at most five choices. Above five, GridCue asks for the full name. A word is never read as certain because one value holds it: that would turn Lane, Young, Grant and Trust into filters.
- **Ties ask.** A value that two columns hold, or that is also a declared name, asks which was meant.
- **A failure stops the request.** If the Host's function throws, the request ends with an `INPUT_` error and the view does not change. GridCue never reads a request with half its values.

ADR 0023 governs every Clause that holds a Local Value: each other word must be placed, and a value where a column goes, or where rows are left out, asks.

Two other ways were turned down. A Grid Adapter method would tie the values to what the adapter can see, which is one page on a paged grid, and would change the adapter interface. Sending Host-approved values to the provider as Candidates is what the fourth rule in `AGENTS.md` keeps out by default.

The cost is one more option for the Host to set, and a question for a last name, which is how people often ask.

It would change if most Hosts use a Grid Adapter whose rows GridCue can read in full, which would make an adapter method less work for them. The one-word question would be dropped if it fires on ordinary words often enough to annoy. Reading one word as certain needs a fresh held-out set that shows the question almost always has one choice the User accepts.
