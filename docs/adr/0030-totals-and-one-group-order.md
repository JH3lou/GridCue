# Totals, and one group order

**Status:** accepted with the operation set spec (2026-11-13). Not yet built.

A total is a sum or an average of one column, and the column's kind picks which. Number and currency columns take either. A percent column takes an average only. No other kind takes a total. Every Grid Adapter orders the groups of a grouped, sorted view the same way.

Two things were found together (operation set grill, 2026-11-13). No request could reach a total, and validation accepted totals that make no sense: a sum of a text column, a sum of percentages, the same total twice. And the two shipped adapters already drew one View State in two group orders. For "group by advisor, sorted by market value descending", the Rows Adapter put a group first because of its largest row. TanStack Table kept the groups in the order they first appear in the rows. The Rows Adapter's order ranks groups by something nobody asked for and the View State doesn't hold.

What a total is:

- **It counts the rows the view shows,** after its filters and its count. Empty values are skipped. With no values, the total is empty.
- **With a grouping, each group shows its total.** With none, the grid shows one total for the whole view.
- **A new total is added** to the ones the view has. Nothing goes unless a request says to remove it.
- **A total that doesn't fit its column's kind is not valid,** and GridCue says which total would fit.
- **Min, max and a count of rows stay unreachable by request.** The Site demo's grid already shows each group's row count.

The one group order:

- **A sort on a column with a total orders the groups by that total.**
- **A sort on a column with no total** orders the rows inside each group, and leaves the groups in the order they first appear in the rows before sorting.

This is TanStack Table's order. It can't be changed from outside the Host's column definitions, so the Rows Adapter changes to match. That gives ranking groups one certain reading. "Largest households first" still asks, and gains a third choice, "Rank households by total Market value", when the request names a column or the View Schema has a `defaultMeasure`. That gives `defaultMeasure` (ADR 0018) one more use: the column a group ranking totals.

The cost falls on Hosts of the Rows Adapter. A grouped, sorted view that requests reach today changes its group order there, with no change to its View State. The changelog will say so. The aim is that no two adapters draw one View State differently. A shared test of what each adapter would draw is to hold both shipped adapters to that for rows, order, groups and totals. It is not written yet. One difference stays: where a row with no value in a sorted column sits. It changes order, never which rows show.

What would change it: labelled requests showing that min, max or a count of rows are asked for about as often as sums and averages. Or Hosts on the Rows Adapter showing that Users read the old group order as a ranking and miss it, which would argue for keeping that order there and giving the TanStack Table Host a sort function to register. TanStack Table totals rest on a spike, which has not run. If it fails, that adapter doesn't list totals, and the group order rule still holds.
