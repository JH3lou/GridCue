# Ship a plain-CSS command bar in the package, alongside the registry

ADR 0001 shipped styled UI only through the shadcn registry. Because GridCue must drop into existing apps, many of which don't use shadcn or Tailwind, the package also ships a ready-made `<GridCueBar />` in `gridcue/react` with its own small stylesheet. Its colours and spacing come from CSS variables, so it can match a Host's theme. shadcn users still install the registry components, which they own and restyle. Both UIs sit on the same headless hooks, so behaviour lives in one place.

## Consequences

- There are two styled UIs to keep accessible and visually current. The shared hooks and a shared component test suite limit the drift.
- The built-in bar must not depend on Tailwind, a CSS-in-JS runtime, or any icon library.
