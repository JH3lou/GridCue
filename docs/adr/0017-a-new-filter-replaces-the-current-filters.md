# A new filter replaces the current filters unless the request says to add

A request that filters, made while the view already has filters, replaces them. It keeps them and narrows further only when its part says so: "also", "too", "as well", "further", "only those", "of these", "among them", "narrow it down". The Preview names every filter it removes ("Remove the filter Market value above $100,000,000"), so nothing is dropped silently.

Before this, every filter was ANDed onto the ones already applied. On the live demo, a filter with no results left every later filter empty, and the Preview ("Filter Registration type to Trust") gave no sign of the filter still in force (owner's user feedback, 2026-09-24). Sorts and groupings already replaced by default and added a level only on "also" (fan-out spec, Q7), so filters now behave the same way. The owner chose this over keeping filters additive with a better Preview, and over asking every time.

Wording decides, not a provider. Jev's add-a-level question is about sorts and groupings, and extending it would change Jev's questions and need new live evals. The words that mean "narrow what I have" are few and reliable. Plain "only" is not one of them: "show only trusts" switches to trusts.

Every applied change is also undoable in turn, newest first, back to the starting view. A manual change in between ends the chain there, so undo never erases it.
