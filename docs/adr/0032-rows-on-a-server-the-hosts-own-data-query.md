# Rows on a server: the Host's own Data Query

**Status:** accepted with the more grids spec (2026-11-13). The Query Adapter and the Query Check (`gridcue/testing`) are built.

GridCue never writes a Data Query. A Host whose rows live on a server gets a View State from a Query Adapter and turns it into its own request for rows. GridCue ships a Query Check so the Host can prove that request keeps the rows GridCue would.

Before this, every documented path assumed the rows were in the browser. The only option for a Host with rows on a server was the Rows Adapter, with its own request built from the View State. Two things could go wrong there, and nothing would show it (more grids grill, 2026-11-13):

- **A count could be promised and not kept.** The Rows Adapter always lists `limit.set`. A Host that ignored the count showed every row under a Preview that said ten.
- **A filter could mean something else on the server.** GridCue's "is not" keeps rows whose cell is empty. SQL's `<>` drops them. The Preview says nothing about empty cells, and GridCue can't see the rows that came back.

What was decided:

- **No translator.** GridCue produces no SQL, no ORM calls, and no request parameters. The Host owns its data and how it is fetched.
- **A named Query Adapter, safe by default.** It holds the View State and lists `limit.set` only when the Host says its server sorts and cuts to the count before paging. The Host can remove operations its server can't do, and can never add one. A name GridCue doesn't know fails at creation.
- **A removed operation is still read, and then refused by code.** On a grid that leaves out an MVP operation other than grouping, the Intent Provider is offered that operation's Operation Family as on any grid. A request that asks for the change ends in a question with no choices, such as "This grid can't sort rows.", and nothing in it applies. The other way was to leave the family out of the provider's choices. Then the same words could settle on another family and show a view the User didn't ask for, and a request for the change ended in "I'm not sure what to change". The cost is that the provider's candidates name a change the grid can't make, and that grouping, which code reads from its words (more grids spec, 5.3), works another way. This bullet was added when the adapter was built, and waits for the owner's confirmation (order plan, section 12 D).
- **An apply is done when the View State changes,** as it is for a click on a column header. The fetch follows. Loading and fetch errors are the Host's.
- **A Query Check, in a new `gridcue/testing` entry.** It builds synthetic rows and View States from the Host's View Schema, with the rows GridCue keeps for each. It has no test-runner dependency and never reads real rows.

This refines ADR 0018. Its `limit.set` bullet said a grid whose rows come a page at a time can't show the true first ten. A grid whose server cuts first can, and that sentence is rewritten to say so.

The grill weighed three other ways, and the owner approved this one. The Rows Adapter with an option to remove the count makes the wrong view the default. A neutral list of filters in the root entry is a second form of the View State to keep in step, and still doesn't test the Host's code. An apply that waits for the Host's fetch puts a network wait inside Apply and ties GridCue to how the Host loads data.

The cost is a second built-in adapter and a new entry to keep true to core. The Query Check only helps a Host that runs it. And a view can change over rows that then fail to load, which GridCue does not know.

It would change if the owner prefers one adapter that can't be created without saying where the rows are, if Hosts show they get the meanings right from the guide's table alone, or if a real Host's server rejects valid View States and leaves Users with a view whose rows never arrive.
