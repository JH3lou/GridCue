# Beside a code-read filter, every word is placed

**Status:** accepted with the named filters spec (2026-11-13). Not yet built.

A code-read filter is a filter whose meaning GridCue reads with its own code: a text form ("starts with", "exactly"), an empty form ("no advisor"), a House Term, a Local Value, or a date form ("last 90 days"). An Intent Provider is never asked what one means. A Clause that holds one gives a ready plan only when GridCue placed every word in it. Any other word leads to a Clarification that names the word, and nothing can be applied.

A word is placed when it is a declared name, a House Term, a Local Value, the Row Noun, an amount, a date, quoted text, or one of a closed list of GridCue's own words. The list is short on purpose. "To", "about", "who" and "what" are not on it.

A declared value is read wherever it appears. A probe gave Advisor's values those same rules, with a provider that answered nothing. Core alone previewed a ready filter for "Avery Lane called about the trust accounts", "who is Avery Lane" and "sort by Avery Lane" (named filters grill, fact check, 2026-11-13). Nothing was run with Jev. A person's name turns up in many more kinds of sentence than a Host's approved values do, and a provider can't say whether such a sentence is a view request, because it never sees the name as a value.

What follows from it:

- **A code-read filter is never read where a column goes, or where rows are left out.** "Sort by Avery Lane", "hide Avery Lane" and "accounts that aren't large" ask.
- **A provider's picks are limited to what the words name.** In a Clause that passed the check, a column or value the provider proposes that no Mention names is dropped, and a sort, group, show or hide is kept only when the Clause holds that change's own words. Each drop is recorded as `dropped:` evidence. The column for a bare amount or a bare date still comes from the kind rule of ADR 0013 and the provider's pick.
- **A Clause with no code-read filter is read exactly as before.** That is how the rule can't change an existing result.

This is the first slice of the closed grammar in ADR 0020. It checks which words a Clause holds, not where they sit. The Local Resolver checks both and replaces the list. ADR 0022's three narrowings stand. This adds a fourth, which applies only in a Clause that holds a code-read filter. ADR 0019's check gains the code-read filters as things read. Neither ADR is overturned.

The cost is a question where a provider would have read the request. "Avery Lane's accounts sorted by size" asks about "size", where "accounts sorted by size" may be ready because a provider knows the synonym. Each PR reports how often that happens.

The list grows only on evidence: when held-out sets written without sight of the list show that most requests with a name or a House Term ask because of one unplaced word. A word is then added on a fresh held-out set, one at a time. A wrong view from a word nothing reads, in a Clause with no code-read filter, is narrowed to a question and never fixed by a new reading.
