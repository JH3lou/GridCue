# The current view reads as parts, and each part can be removed through a Preview

**Status:** accepted with the command bar spec (2026-11-13). Not yet built.

The bar shows the grid's current View State as View Parts: each filter condition, the sort, the grouping, the count, and the hidden columns. A User can remove a part. Removing one proposes the view without it, and the User sees a Preview and applies or cancels as with any plan.

This amends ADR 0021: the View Sentence is no longer only read, since each of its parts can be removed, and a removal goes through `controller.proposeView` like a saved view does.

Before this, nothing in the bar showed the view as it is, and a request to remove one filter by its value's name ended in a question. The four bets planned the View Sentence for the bar's first line and put editing it out of scope. Two lines saying what one view holds would drift apart (command bar grill, 2026-11-13).

What is decided:

- **One line, from one list of parts.** The View Sentence, when it is built, is made from the same View Parts. The bar keeps one line that is both read and changed.
- **A removal never applies directly.** It is a View Plan with a Preview, so the third rule in `AGENTS.md` holds. Apply, Cancel, Undo, the audit event and a stale Revision behave as for any plan.
- **On a view with a count, removing the sort or a filter asks first.** Either changes which rows the count keeps. GridCue asks whether to keep the count on the new view or show every row, and each answer is a whole view shown in a Preview. ADR 0027 makes the same rule for requests.
- **A part the grid can't remove has no way to remove it.** Nothing is offered that would fail.
- **Parts are removed, not rewritten.** Editing the View Sentence's text stays out.

Removal that applies at once, with Undo as the safety net, was rejected. It breaks "Nothing applies without a preview". Waiting for the View Sentence and adding removal then was rejected too: the bets would build a line that is only read, and removal would mean building it again.

The cost is one more keystroke for each removal, and a Preview that reads as two lines when one filter of several goes: the filters are cleared and the others put back.

This would change if the View Sentence's round-trip test shows the sentence can't be split into parts that each read alone.
