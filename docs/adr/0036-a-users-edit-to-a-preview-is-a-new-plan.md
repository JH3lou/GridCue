# A User's edit to a Preview is a new plan

**Status:** accepted with the command bar spec (2026-11-13). Not yet built.

A User can change a Preview before applying it: drop a line, or change one filter's value. Each edit makes a new View Plan. It is validated against the View Schema, the grid's capabilities and the current Revision, and shown as a new Preview, like any plan. No Intent Provider is called.

Before this, a User who wanted one line less, or a different amount, typed the whole request again. The product definition says the User "applies, edits, or cancels" a proposal, but an edit only put the cursor back in the input (command bar grill, 2026-11-13). Sending the edited text through a provider again was the other way. A provider can read the same words differently the second time, so the User would not get the Preview they had just read with one thing changed.

What an edit is:

- **Lines that only make sense together drop together.** A count goes with the sort it was asked of. A filter that a clear puts back goes with that clear. The lines one House Term made go together. The rules are fixed, and the bar says which lines will go before the User drops them.
- **A line can't be dropped when that would leave a different view than the Preview says.** The count rule of ADR 0027 runs on an edited plan too. When every line would go, Cancel is the way.
- **A changed value is certain or refused.** It is one of the column's declared values, or typed text that GridCue's own reader reads whole as one value of the column's kind. Anything left over refuses the edit, and the Preview stays as it was.
- **The plan records the edit.** Each edit is evidence with the source `user`.

This limits ADRs 0019 and 0022 to the plan a request produced: an edited plan is not checked against the request's words, because the User changed it on purpose after reading it. Both checks still run on the plan the request produced, before any edit. Checks about the plan and the view, not the words, run on every edit.

A full editor, with the column and the comparison open to change, was rejected. It would be a filter builder, and the Host's own controls already are one.

The cost is that an edited plan no longer says what the request said. The Preview is the only account of it, so a recent request is never recorded from an edited plan.

This would change if a held-out set of edits gives a wrong view that a fixed rule should have caught, which would add a rule, or if one typed value is read as a different value.
