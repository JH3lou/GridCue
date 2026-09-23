# Marketing effects stay in the website and never enter a package

The marketing page may use free animated components such as React Bits' CardSwap and ScrollStack, rebuilt on shadcn/ui. Those components must never be imported by a published `@gridcue/*` package or the component registry. React Bits is licensed MIT plus Commons Clause, which forbids redistributing its components, and GridCue's packages are Apache-2.0. Paid effect libraries such as React Bits Pro are out of scope.
