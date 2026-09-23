# Grid adapters report manual view changes

The `GridAdapter` interface gains `subscribe(listener)`, which fires whenever the grid's view changes by any means, including the user clicking a column header. Each such change bumps the Revision. Without it, GridCue could not tell that a pending View Plan had gone stale, and an apply could silently overwrite the user's manual changes. The proposal's interface sketch had no such hook. Adapters that cannot observe changes must declare that in their capabilities, and the controller then re-reads state before every apply.
