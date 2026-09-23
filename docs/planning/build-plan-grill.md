# Build plan: grilling log

This file records the design-tree interview that turns the bootstrap proposal and the owner's framework note into an approved build plan. It follows two processes:

- **superpowers brainstorming, architectural path.** Questions, then approaches, then a written spec in `docs/superpowers/specs/`, then an implementation plan in `docs/superpowers/plans/`. Nothing is scaffolded before both are approved.
- **grill-with-docs.** Questions are asked in rounds over the current frontier, each with a recommended answer. Resolved terms go into `CONTEXT.md`. Hard-to-reverse decisions become ADRs in `docs/adr/`.

## Inputs

| Source | What it says |
| --- | --- |
| `FrameworkAndConcepts` (owner note) | TypeScript utility. Vite, React, Tailwind, shadcn/ui, shadcn typeset. Algolia site search for docs. React Bits and a card-swap effect for the marketing page. Deliverables: an easily instantiated backend interface, integrated UI components, a marketing page, developer docs. |
| Bootstrap packet (`README.md`, `AGENTS.md`, `BUILD_AGENT.md`, `docs/*.md`) | A headless, safety-first "intent-to-view compiler" for data grids. Packages for core, a Jev provider, React UI, and a TanStack Table adapter, plus a demo. The work order stops at one tested vertical slice. |

## Tensions found on first read

1. **Scope.** The note asks for a marketing page and developer docs. The proposal's work order excludes both and stops at a library plus demo.
2. **UI styling.** The note wants shadcn/ui components. The proposal wants headless hooks with "minimally styled" reference components and says nothing about shadcn or Tailwind.
3. **"Backend interface."** The note's "backend interface/component that user can instantiate easily" has no direct match in the proposal. It could mean the core controller, a server-side handler, or both.
4. **Svelte in a React stack.** The note names sveltebits.xyz for a card-swap effect. That library is Svelte, and every other choice in both documents is React.
5. **Provider.** The proposal makes TypeSafe's Jev the first real provider. The note never mentions a provider at all.

