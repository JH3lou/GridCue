---
status: amended by ADR 0008, which adds a plain-CSS command bar to the package
---

# Styled UI ships as a shadcn registry, not a styled npm package

GridCue's command bar, preview panel, and clarification UI ship in two layers. Headless React hooks and controllers are published in the `gridcue` npm package, under its React entry point (ADR 0007). The shadcn/ui-styled components are published as a shadcn registry that developers install with `npx shadcn add`, so they own and restyle the copied code. We chose this over one pre-styled npm package because GridCue targets shadcn and Tailwind users, and a copied component can't clash with a host's design system.

## Consequences

- Styled components can't be fixed by a version bump once copied. Bug fixes in them are re-run through `shadcn add`, so behaviour belongs in the hooks and styling in the components.
- The registry is served from the website, so installing it depends on the website being live. Until then the demo consumes the registry source from inside the repo.
