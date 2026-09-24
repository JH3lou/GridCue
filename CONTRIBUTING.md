# Contributing

GridCue is early stage in development still. The protocol and package boundaries are still settling, so we keep scope tight and changes small.

## Before you start

- **Bugs** go in [GitHub issues](../../issues). One problem per issue, with steps to reproduce.
- **Ideas, new adapters, and new providers** start as a [Discussion](../../discussions). Agree on the shape before writing code.
- **Security problems** follow [SECURITY.md](.github/SECURITY.md). Do not open a public issue.
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## How decisions are made

The maintainer decides. Decisions that are hard to reverse are recorded as ADRs in `docs/adr/`, and planning happens in the open in `docs/planning/`.

## What we are most likely to accept

- Small, focused bug fixes.
- A failing eval or test case that shows GridCue applying the wrong view.
- Docs fixes where the docs and the code disagree.
- A grid adapter or provider that was agreed in a Discussion first and passes the shared contract suite.

## What we are least likely to accept

- Large PRs that mix several changes.
- Anything that lets GridCue change data rather than views. That boundary is deliberate; see `AGENTS.md`.
- New runtime dependencies in the package's root entry.
- Features from the roadmap that nobody asked to build yet.

## Opening a PR

- Keep it to one concern.
- Use a conventional commit title in plain language, such as `fix(core): stale revisions no longer apply`.
- Explain what changed and why it should exist.
- Include before and after screenshots for UI changes, and a short video for motion.
- Run `pnpm check` locally. It must pass.
- Update the Site's developer docs if you changed a public API. Follow the documentation rules in `AGENTS.md`.
- Never commit API keys, `.env` files, or real client data. Fixtures are synthetic.

Opening a PR does not oblige anyone to merge it. We may ask you to shrink it, or reimplement the idea ourselves.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
