# The Host counts rows, and zero rows is information

**Status:** accepted with the command bar spec (2026-11-13). Not yet built.

A Preview can say how many rows the view would leave, and how many there are in all: the Rows Shown. GridCue shows them only when the Host gives the Controller a way to count, the `countRows` option. The Grid Adapter interface does not change. With no way to count, the Preview says nothing about rows and nothing else changes.

Before this, a User learned that a view was empty only after applying it. ADR 0017 exists because a filter with no results left every later filter empty on the live demo. But no Grid Adapter holds the rows for GridCue to count. The Rows Adapter is given a View State, not rows. A table whose rows are filtered or paged on a server holds one page, and ADR 0018 made the same call for a count: a grid that can't show the true first ten doesn't claim to (command bar grill, 2026-11-13).

What is decided:

- **The Host counts.** The Host owns the data, by the fourth rule in `AGENTS.md`, so it decides how: over its rows in memory, or by asking its server. GridCue ships a counter for TanStack Table that answers only when the table's own rows are the rows the User sees.
- **No number is better than a wrong one.** When the Host can't count, or the number can't be right, the Preview shows no Rows Shown. Counting never holds up the Preview.
- **Zero rows is said in words, and Apply stays.** "No rows match." sits with the Preview. The plan stays ready. An empty grid can be the answer the User wanted.
- **The number stays with the Host.** It is never sent to an Intent Provider and never put in an audit event.

Zero rows does not mark a wrong view. In a run of five labelled sets with the Mock Provider, 37 correct ready plans left no rows, and the one wrong view found kept every row. So zero does not turn a plan into a question, and does not block Apply.

Counting in the Grid Adapter was rejected. It would change the adapter interface for every grid, and the grids that most need a number, the ones on a server, are the ones that can't give it.

The cost is one more option for the Host to set, and a number GridCue can't check. A Host that counts with different filters than its grid applies shows a wrong number, and the docs say so.

This would change if most Hosts turn out to use one adapter whose rows GridCue can count exactly, or if Users in a representative Host apply a Preview with no rows and then undo it most of the time.
