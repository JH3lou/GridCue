# One npm package, `gridcue`, with subpath exports

GridCue ships as a single npm package named `gridcue` that works in both Next.js and Vite apps. This replaces the proposal's four `@gridcue/*` packages. The owner chose one install over separate packages so adopters have one version to track and one thing to install.

Boundaries survive as subpath exports instead of package boundaries. The root entry stays free of framework, grid, and provider imports. React bindings sit behind their own subpath with React as an optional peer dependency. Server-only code, including the Jev provider and the Server Handler, sits behind a server subpath that a client bundle can never reach through the root or React entries. The styled components still ship through the shadcn registry from ADR 0001.

TanStack Start and TanStack Table are out of scope for the first release.

## Consequences

- The `@gridcue` npm scope from ADR 0004 is no longer needed for the first release. The `gridcue` name must be claimed before the first publish.
- Adding a grid or provider later means a new subpath, not a new package, until the package grows too large to keep in one release cycle.
