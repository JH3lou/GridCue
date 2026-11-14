# Saved views through the Host

**Status:** accepted with the routing and saved views spec (2026-11-13). Not yet built.

A User can keep a view by request ("save this as my exceptions view") and bring it back ("open my exceptions view"). GridCue does both only through the Host, and never stores a view itself. The Host passes the current User's Saved Views for this grid, and the means to load, save, and remove one.

ADR 0021 left this out: "GridCue ships no saved-views feature." A Host could store a View State and bring it back with `proposeView`, but the User could not ask for either in words. The owner chose to add save and open by request, with the Host still owning storage, over leaving both to buttons the Host builds (routing and saved views grill, 2026-11-13).

What is decided:

- **The Host stores every Saved View.** GridCue holds no view, no name, and no list of its own. This keeps the fourth rule in `AGENTS.md`.
- **The Host's list is never sent to an Intent Provider.** Names are the User's own text and can hold client names. Code reads them in the browser. A name the User typed leaves the browser only inside their own request, and only when that request also reads as a change on this grid, as any typed request does today.
- **A Saved View is named only in explicit words, by its exact name.** "Open", "load", "switch to", or "go back to" a name, or "show" with "view" after the name. The name must be exactly one on the Host's list, ignoring letter case. A name that is close but not exact is not matched. Two Saved Views with the same name ask.
- **A name that also reads as a change on this grid asks.** "Show my taxable view" is a ready filter today. With a Saved View called "Taxable", GridCue asks which the User means, and never picks.
- **A save is shown in a Preview and happens on Apply.** A name already in use is never replaced by request: GridCue asks for another name. Undo removes the new Saved View.
- **Opening goes through `proposeView`.** What the Host loads is untrusted and is validated like any plan, so a Saved View never skips the Preview (ADR 0021).
- **Renaming, deleting, sharing, and replacing stay refused by request.** They change something the User already has. The Host's own UI does them.
- **Every save emits a structured audit event,** with no name unless the Host opts in to text. The audit callback now receives more than one kind of event, so a Host that typed its handler for plans alone gets a type error. The owner chose that over a second callback.

This rewrites the last paragraph of ADR 0021, which now says GridCue saves and opens a Saved View by request only through the Host, and points here. The rest of ADR 0021 stands.

The cost is questions. A User who names a Saved View after a value gets a question each time they open it. A name typed one letter off is not found, where a looser match would have offered the right one. A Host whose list is stale may miss a new name, and must reject a duplicate name in its own store.

What would change it: a held-out set of near names with no wrong view would let a near name become a question with choices. Sending names to an Intent Provider would need the Host's explicit choice and its own ADR.
