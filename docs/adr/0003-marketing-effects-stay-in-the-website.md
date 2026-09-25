# Marketing effects stay in the website and never enter a package

The marketing page may use free visual effects, built on shadcn/ui or plain CSS. Those effects must never be imported by the published `gridcue` package or the Component Registry. Some free effect libraries carry licenses that forbid redistribution: React Bits, for example, is MIT plus Commons Clause, which is incompatible with GridCue's MIT license. Paid effect libraries such as React Bits Pro are out of scope.

In the first Site build, the design pass replaced both React Bits candidates: CardSwap was dropped, and ScrollStack became CSS scroll-driven animation with no smooth-scroll library (Site spec, design pass). Nothing from React Bits is used.
