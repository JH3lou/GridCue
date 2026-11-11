# GridCue docs

## Using GridCue

Developer docs for adopters will live on the Site, under `/docs`, once it is built. See ADR 0002.

## Working on GridCue

Start with [AGENTS.md](../AGENTS.md) and the [contribution guide](../CONTRIBUTING.md). Vocabulary is in [CONTEXT.md](../CONTEXT.md).

### Internals

These explain what the source alone can't: the product boundary, the pipeline, and the public protocol.

- [Product definition](./internals/product.md)
- [Architecture](./internals/architecture.md)
- [Intent protocol](./internals/intent-protocol.md)

### Decisions

- [0001: Styled UI ships as a shadcn registry](./adr/0001-styled-ui-ships-as-shadcn-registry.md), amended by 0008
- [0002: The website is one Vite app with Fumadocs](./adr/0002-website-is-one-vite-app-with-fumadocs.md)
- [0003: Marketing effects stay in the website](./adr/0003-marketing-effects-stay-in-the-website.md)
- [0004: Name, license, and npm scope](./adr/0004-name-license-and-npm-scope.md), license and scope superseded
- [0005: MIT license](./adr/0005-mit-license.md)
- [0006: Host the Site on Cloudflare](./adr/0006-host-on-cloudflare.md)
- [0007: One npm package with subpath exports](./adr/0007-one-npm-package.md)
- [0008: Plain-CSS command bar in the package](./adr/0008-built-in-plain-css-command-bar.md)
- [0009: Grid adapters report manual view changes](./adr/0009-grid-adapters-report-manual-changes.md)
- [0010: Protocol 0.1 additions](./adr/0010-protocol-0-1-additions.md)
- [0011: `gridcue/server` resolves to the real module on edge runtimes](./adr/0011-server-entry-runs-on-edge-runtimes.md)
- [0012: The compiler decides between competing Operation Families](./adr/0012-operation-family-precedence.md)
- [0013: Deterministic Mentions, literal columns, and a pinned Jev model](./adr/0013-deterministic-mentions-and-literal-columns.md)
- [0014: Per-part fan-out](./adr/0014-per-part-fan-out.md)
- [0015: Resolution chassis](./adr/0015-resolution-chassis.md)
- [0016: The Site is static on Workers static assets](./adr/0016-site-is-static-on-workers-assets.md)
- [0017: A new filter replaces the current filters](./adr/0017-a-new-filter-replaces-the-current-filters.md)
- [0018: Size words, the main value column, and counts](./adr/0018-size-words-main-value-column-and-counts.md)
- [0019: A ready plan uses everything GridCue read](./adr/0019-a-ready-plan-uses-everything-it-read.md)
- [0020: The Local Resolver reads first, and a provider is optional](./adr/0020-local-resolver-and-optional-provider.md), not yet built
- [0021: The View State is the record](./adr/0021-the-view-state-is-the-record.md), not yet built

### Planning

- [Build-plan interview](./planning/build-plan-grill.md): open questions and the owner's answers
- [Bootstrap work order](./planning/bootstrap-work-order.md): the original proposal, kept for history
- [Handoff, 2026-09-24](./planning/handoff-2026-09-24.md): where the first build stopped, open follow-ups, and next steps
- [Four bets interview](./planning/four-bets-grill.md): test results and the owner's answers for the View Sentence, as-you-type, the Local Resolver, and terse requests

### Runbooks

- [Local development](./operations/development.md)
