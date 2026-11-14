# A count follows its rows

**Status:** accepted with the operation set spec (2026-11-13). Not yet built.

A count keeps the first N rows of the sorted view. A row with no value in the first sorted column never fills a count. A plan that changes which rows a count keeps, and sets no count of its own, is not ready: GridCue asks whether to keep the first N rows of the new view or to show every row.

In 0.2.0 a count outlived the request that set it (operation set grill, 2026-11-13). After "top 10 accounts by market value" in the Rows Adapter, with the Mock Provider:

- "sort by advisor" and "clear the sort" were ready, and the grid kept ten rows: a different ten, or ten in no order;
- "only the taxable ones" and "clear the filters" were ready with one filter line, and the grid could show ten different rows;
- neither Preview said the count was still there, and no request could remove it short of a reset;
- in a descending sort, rows with no value came first, so they filled "top 10" before any row that had one.

After a count, "sort by advisor" may mean the same ten rows in a new order, or the first ten by Advisor. "Only the taxable ones" may mean the taxable rows among the ten, or the first ten taxable rows. The View State can hold only the second of each, and neither reading is certain. So GridCue asks. The other ways were to keep the count and add a note, or to clear it. The owner approved asking.

What is decided:

- **What asks.** A ready plan, on a view with a count, that changes or clears the sort, or adds, replaces or clears a filter. Grouping, columns, pins, density and totals don't change which rows a count keeps, so they don't ask. A plan that sets its own count doesn't ask.
- **Both answers show in the Preview.** "Keep the first 10" and "Show every row" each become a line of the plan, so nothing about the count changes unseen.
- **The rule is about a plan and the view it applies to,** not about the request's words. Core applies it after compiling, for every Intent Provider, and to any plan made another way that could change which rows a count keeps. A plan that states its whole target view, count included, is exempt.
- **A count can be cleared and set in the Preview's own words:** "show every row", "show only the first 5 rows". Code reads them (ADR 0028).
- **Every Grid Adapter that lists `limit.set` keeps the same rows** for the same View State and rows. The TanStack Table adapter lists it only when the Host registers GridCue's count piece, and never on a table that holds one page of its rows. That piece waits on a spike, which has not run.

This refines the count bullet of ADR 0018: an empty value never fills a count, and the TanStack Table adapter can list `limit.set`. The rest of ADR 0018 stands, and a grid that can't keep a count still sorts alone and says the count was not applied.

The cost is a question after a count, each time the sort or the filters change. It is also a change to what "top 10" shows: on a column where only 7 rows have a value, the grid shows 7.

What would change it: a labelled set where Users change the sort or the filters after a count far more often than anything else, and nearly always mean one reading. For TanStack Table: if the spike finds no piece that keeps exactly the Rows Adapter's rows, that adapter keeps today's note and this ADR loses that line.
