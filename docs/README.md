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

### Planning

- [Build-plan interview](./planning/build-plan-grill.md): open questions and the owner's answers
- [Bootstrap work order](./planning/bootstrap-work-order.md): the original proposal, kept for history

### Runbooks

- [Local development](./operations/development.md)
