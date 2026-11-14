# The View State is the record, and the View Sentence is how it reads

**Status:** accepted with the four bets spec (2026-11-10). Not yet built.

Every View State reads as one View Sentence, from `describeView`. A Host that saves or shares a view stores the View State. It comes back through `controller.proposeView(state)`, which builds a plan, shows a Preview, and applies like any other plan.

The first idea was that the sentence itself would be the stored form: save the text, type it back. A test over 1,500 random views showed why not (four bets grill, 2026-11-10):

- **A sentence is a change, not a view.** Typed on a view that isn't the default, the same sentence gave a different view 242 times in 400, because hidden columns and other settings carry over.
- **Prose can't carry everything.** A value containing a quote mark, a label that is an instruction word, the order of hidden columns, and some decimals do not survive being written and read.
- **A stored sentence needs a second grammar,** with escapes for the awkward values, that Users must then be kept from typing by accident.

So GridCue promises one thing about the sentence: typed on the default view, with no provider, it reproduces the view. A property test over random views enforces that. When a view holds something prose can't carry, `describeView` says so (`roundTrips: false`) and names it.

`proposeView` exists so that a saved view never bypasses the third rule in `AGENTS.md`. The state it is given is untrusted: it may come from a link. It is parsed, turned into the operations that change the current view into it, and validated against the View Schema and the grid's capabilities. A column that no longer exists, a restricted column, or a setting the grid can't apply fails closed, and nothing is applied in part. A Host that calls `adapter.restore` with a stored state gets none of this.

`proposeView` also removes one part of the current view. The bar shows the view as View Parts, and removing one proposes the view without it, so a removal gets a Preview like any other plan (ADR 0039).

Storage, names, and links stay with the Host. GridCue saves and opens a Saved View by request only through the Host, and never stores one (ADR 0034).
