# An apply is done when the grid holds it

**Status:** accepted with the more grids spec (2026-11-13). Not yet built.

A Grid Adapter's `apply` and `restore` succeed only once the grid holds the View State that was written. The Revision they return is the one the grid now has.

The adapter interface already promised "every operation or none". It did not say when. On a TanStack table whose state the Host controls, a write only asks the Host to render again, so the adapter returned before the table had changed (more grids grill, 2026-11-13):

- **Undo was lost.** `apply` returned the old Revision. The table then moved to a new one, and undo was refused as if the User had changed the view since.
- **Apply could report a change that never happened.** With a controlled slice and no change handler, GridCue said "View updated." and the table stayed as it was.

The first fails closed, but the third rule in `AGENTS.md` says every applied plan is undoable. The second tells the User the view changed when it didn't.

What the rule asks of an adapter:

- **A grid that updates at once** returns at once, as today. Nothing changes for a table that owns its state, or for the Rows Adapter.
- **A grid that updates later** is waited for, within a bound. The adapter checks that the grid holds what was written before it answers.
- **When the bound runs out, the apply fails.** The Controller's existing recovery then runs and says what happened. The wait is never unbounded.
- **The shared adapter contract suite tests it:** apply a plan, read back the state and the Revision, then undo.

This changes no accepted ADR. ADR 0009 still decides how manual changes are reported.

The cost is a short wait at Apply on a Host-controlled table, and one more test every adapter must pass. A Host that updates its table only after its own fetch returns will see Apply fail, so the guide says to set state first and fetch after.

It would change if a real Host can't set state before its fetch. Then the bound becomes an adapter option.
