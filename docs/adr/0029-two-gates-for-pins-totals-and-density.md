# Two gates for pins, totals and density

**Status:** accepted with the operation set spec (2026-11-13). Not yet built.

A pin or a total reaches a grid through two gates, and each gate has its own default. A density passes the second gate only.

- **Columns: on.** Every column that isn't restricted may be pinned. Number, currency and percent columns may be totalled. A Host can still narrow any column in the View Schema. Density belongs to no column, so it has no column gate.
- **Grids: off.** A Grid Adapter lists `columns.pin`, `density.set` and `aggregation.set` only when the Host says, with the adapter's `renders` option, that its table draws them. The default is none.

Before this, pinning and totals were off for every column unless the Host turned each one on, and no shipped adapter listed any of the three (operation set grill, 2026-11-13). The first draft opened the column gate alone. A check of the code showed why that is not enough: both shipped adapters are headless. GridCue writes the View State, and the Host's own markup keeps a Pinned Column in place, sets a row's height, or draws a total cell. An adapter that listed a change the Host's table ignores would show a Preview, apply, say the view was updated, and change nothing the User can see.

So the two gates answer two different questions. The column gate asks whether the change is allowed. Pins and totals are view changes with no data risk, and a column setting a Host has to find first is a feature most Users never get, so it is on. The grid gate asks whether the change will show. Only the Host knows, so it is off until the Host says so.

A request for something the grid doesn't draw ends in a question with no choices, such as "This grid can't pin columns." Nothing in the request applies, the other parts included. It comes from one piece of code that every Grid Adapter shares, and the protocol does not change. It is not an Unsupported Segment, which stays for requests outside the view-only rule. The other way was a new unsupported kind in the protocol. The owner approved the question.

A count is different. The Rows Adapter drops the rows itself, so it lists `limit.set` with no option. The TanStack Table adapter's count goes through `renders` (ADR 0027).

The cost is one option a Host must find and set, and a promise GridCue can't check: a Host can name something in `renders` and not draw it. The docs, the agent skill and the examples show both halves together. A Host that upgrades also finds that requests can now pin and total columns it never opted in, once it sets `renders`.

Both defaults are hard to reverse once Hosts rely on them. What would change the column default: a Host for whom pinning or totalling some kind of column is not harmless. What would change the grid default: a way for an adapter to see for itself what the Host's table draws.
