# Offering a declared grid

**Status:** accepted with the routing and saved views spec (2026-11-13). Not yet built. The grid routing PR waits for the owner's own edit to rule 1 in `AGENTS.md`.

A Host with several grids can list them as Declared Grids. When a request names another Declared Grid, or is about its rows, GridCue makes a Grid Offer: "This is about clients. Open the Clients grid?" The User chooses, and the Host opens the grid. GridCue never opens anything itself.

Before this, a request to go to another screen was refused or asked about, and one Controller knew one grid. With the Mock Provider, "households over $5m" on an Accounts grid filtered accounts over $5m, ready to apply. Beside a Households grid, that is a view the User did not ask for (routing and saved views grill, 2026-11-13). The owner had asked for an advisor desktop with many grids and a redirect to the right one (fan-out grill, 2026-09-24). The owner chose an offer over opening the grid at once, and code over a provider question.

What is decided:

- **Offer, never jump.** Leaving the grid the User is looking at is the User's choice, however certain the grid is.
- **Only a Declared Grid can be offered.** The list is closed and comes from the Host. A request to open a record, or any screen that is not on the list, is handled as before.
- **The Host opens the grid.** GridCue hands the Host the chosen grid and, when the request asks for more than the move, the User's words. Only those words move between grids, never rows and never a view. The other grid reads them as any typed request and shows its own Preview.
- **Code decides, from the Host's list.** A request is about another grid when it asks to go to that grid by name, or when its rows are that grid's Row Noun or another name the Host gave it. No Intent Provider is asked, the list is never sent, and the resolution protocol does not change. No object sits above the Controllers: each still wires one grid.
- **A declared noun no longer filters this grid on its own.** Once the Host declares a grid for a noun, a request whose rows are that noun gets a Grid Offer. When a column here also goes by that name, GridCue asks, and "Keep it on this grid" gives the result it gave before. Where the request already led to a question with choices, as "largest households first" does (ADR 0015), the other grid is added as the last choice. A Host that declares no grids sees no change.
- **A request about two grids asks.** GridCue asks the User to take one grid at a time.
- **Opening a grid has no undo, and a grid chosen in a question has no Preview.** Nothing on this grid changes, and the choice was the User's. The Host's own back control returns them. A Grid Offer that is not a choice in a question is shown like a Preview, and the grid opens on Apply.
- **Every Grid Offer the User takes emits a structured audit event,** with no request text unless the Host opts in.

This is the one exception to the first rule in `AGENTS.md`, which says GridCue never navigates to privileged screens. That rule gains one sentence: GridCue may offer to open a Declared Grid, and the Host navigates. The owner writes that sentence by hand. It changes no accepted ADR.

The cost is questions where there were ready filters. A Host that declares a Households grid sees "households over $5m" ask on its Accounts grid. A wrong Grid Offer costs the User one Cancel, and a wrong reading on the other grid is still caught by that grid's Preview.

What would change it: a held-out set where Users name grids in words no declared name covers, often enough that asking becomes the usual result, would reopen asking an Intent Provider which grid is meant. That changes the resolution protocol and needs its own ADR.
