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

## Facts gathered (2026-09-23)

These were looked up, not decided. Items marked *unverified* came from search snippets only.

- **shadcn typeset** is a single copied `typeset.css` file for docs-page typography. It replaces `@tailwindcss/typography`. It is not a component and has no npm package.
- **shadcn registries** let any project ship installable components. Users run `npx shadcn add @gridcue/command-bar` after adding a namespace. `shadcn build` generates the registry files.
- **shadcn's Data Table** is built on TanStack Table, so the proposal's first grid adapter matches the shadcn ecosystem.
- **Algolia SiteSearch** is an open-source search UI shipped as a shadcn registry. It still needs an Algolia index. **Algolia DocSearch** is the free hosted crawler and index for public docs, and needs a live, verified domain.
- **React Bits** is licensed MIT plus Commons Clause. It may be used inside an app or site, but its components may not be redistributed. The free tier has **CardSwap** (uses gsap) and **ScrollStack** (uses lenis). The Pro "Scroll Stack" is a different, paid component. Pro pricing is *unverified*.
- **sveltebits.xyz** is a Svelte port of React Bits. It cannot drop into a React site.
- **Jev is real and public.** The SDK is `@typesafe-ai/sdk`. A request carries a `state` plus typed questions: choice, score, or yes/no. Each answer returns a choice with confidence and full probabilities. This matches the proposal's "closed candidates plus confidence" design. Pricing and free credit are *unverified*.
- **Fumadocs** is React, Tailwind, and Radix based, and can run on Vite through React Router. Starlight is Astro, VitePress is Vue, and Docusaurus is webpack. None of those three match shadcn styling out of the box.
- **npm names** `gridcue` and `@gridcue/core` are both unclaimed.
- **Current stable versions:** Node 24 LTS, pnpm 12.6, TypeScript 7.0, Vite 8.3, React 19.3, Tailwind 4.3, TanStack Table 9.2, Vitest 5.0, zod 4.6, Biome 2.5, shadcn CLI 4.21.

## Routine calls made without asking

- Node 24 LTS as the floor, instead of the proposal's Node 22, because 24 is the current LTS.
- Biome for lint and format, instead of ESLint plus Prettier, because it is one fast tool with no plugin sprawl.
- zod 4 for runtime validation of public inputs and provider responses.
- Brainstorming path: **architectural**. This is a new project, so it gets a written spec and a written plan.

## Round 1

Answer by number. A bare "agree" accepts the recommendation.

❓ **Q1 - Purpose.** What is GridCue for, and what does success look like in three months?
(a) An open-source library you want real teams to adopt. (b) A portfolio or showcase piece. (c) A commercial product with an open-source core.

➡️ (a). The proposal's safety rules, license choice, and eval harness all assume real adoption. The marketing page and docs then act as the library's front door.

---

❓ **Q2 - Product boundary.** Do you accept the proposal's definition as the product? That means a view-only, intent-to-view compiler: preview before apply, fail closed, undo, and no row data sent to the provider. The demo uses synthetic wealth-management data.

➡️ Yes, adopt it unchanged. It is coherent and your note does not contradict it. Financial data is the proving ground only, and the core stays domain-neutral.

---

❓ **Q3 - "Backend interface/component that user can instantiate easily."** What did you mean?
(a) A single browser-side factory such as `createGridCue({ schema, adapter, provider })`. (b) A server-side handler that keeps the provider's API key off the browser. (c) Both.

➡️ (c). The factory is the one call a developer makes to wire a grid. The server handler is a small Fetch-standard `Request` to `Response` function, so it runs on Node, edge runtimes, or any framework. The demo's mock provider needs no server at all.

---

❓ **Q4 - How the styled UI ships.**
(a) Headless hooks on npm, plus shadcn-styled components shipped through a GridCue shadcn registry. (b) One npm package of pre-styled Tailwind components. (c) Headless hooks only.

➡️ (a). This matches how shadcn users already work. Developers own and restyle the copied components, and the headless hooks stay framework-light. The registry source lives in the repo from day one, and hosting it waits for the website.

---

❓ **Q5 - First real intent provider.**
(a) Jev only, as proposed. (b) A general LLM provider, such as Claude with constrained tool choices, instead. (c) Both in the first build.

➡️ (a). Jev's typed choice questions with probabilities are exactly the closed-choice shape the design needs. A general LLM provider can come later through the same interface. Tests and the demo use the mock provider, so no paid key is needed to build.

---

❓ **Q6 - Build order.** Your note adds a website that the proposal excludes. How should the work split?
(a) Two sub-projects, each with its own spec and plan. First the library slice with shadcn-styled components in the demo, then the website with marketing, docs, and the hosted registry. (b) One combined build. (c) Website first, to show the idea, then the library.

➡️ (a). The docs need a real API to document, and the marketing page needs a working demo to show. Splitting also keeps each plan small enough to review.

---

❓ **Q7 - Website stack.** Must the website also be Vite, or is Next.js acceptable?
(a) One Vite app using Fumadocs on React Router. It serves marketing at `/` and docs at `/docs`, styled with shadcn and typeset. (b) Next.js with Fumadocs, the most documented path. (c) Astro Starlight.

➡️ (a). It keeps "Vite, React, Tailwind, shadcn" true across the whole repo. One app also means one deploy, one theme, and one place to host the registry.

---

❓ **Q8 - Marketing effects.** Sveltebits is Svelte and cannot run in a React site.
(a) Use the free React Bits CardSwap and ScrollStack, and drop Svelte. (b) Also buy React Bits Pro for its fancier Scroll Stack. (c) Skip animated effects.

➡️ (a). Both free components exist and match your note. React Bits' license forbids redistributing its components, so they must stay in the website and never enter a published GridCue package.

---

❓ **Q9 - Owner decisions the proposal left open.** Keep the name GridCue, the Apache-2.0 license, and the `@gridcue` npm scope?

➡️ Yes to all three. The npm names are free today. Claim the `@gridcue` npm org before anything is published, since claiming an org is cheap and not reversible by anyone else.

## Waiting on Round 1

These branches open once Round 1 is answered.

- **Docs search.** Fumadocs' built-in local search, or Algolia DocSearch with the SiteSearch UI. This depends on Q7 and on having a public domain.
- **Hosting and domain** for the website and registry. This depends on Q6 and Q7.
- **Where the demo lives.** Its own app, or embedded as live examples in the docs. This depends on Q6 and Q7.
- **Jev integration depth.** Live, opt-in tests against the real API, and who holds the key. This depends on Q5.
- **First spec's acceptance criteria.** Whether to keep `BUILD_AGENT.md`'s list as-is, plus shadcn styling. This depends on Q2, Q4, and Q6.
