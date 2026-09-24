# Releasing gridcue

Releases are published from GitHub Actions through **npm trusted publishing** (OIDC). No npm token is stored anywhere, and npm attaches a provenance attestation that proves the package was built from this repository.

## One-time setup (owner)

1. **Create or sign in to the npm account** that will own `gridcue`, and turn on two-factor authentication.
2. **On npmjs.com, add a trusted publisher** for `gridcue` (package settings → Trusted publishers → GitHub Actions):
   - Organization or user: `JH3lou`
   - Repository: `GridCue`
   - Workflow filename: `release.yml`
   - Environment: leave empty

   `packages/gridcue/package.json`'s `repository.url` already matches the repository exactly, which npm requires.
3. **If npmjs.com offers the trusted-publisher settings only for a package that already exists** (npm's docs don't say either way), publish 0.1.0 once by hand, then add the trusted publisher for every later release:
   ```bash
   git checkout v0.1.0 && pnpm install --frozen-lockfile && pnpm check
   cd packages/gridcue && npm publish --access public
   ```
   That one release has no provenance attestation. Every tag after it does.

## Every release

1. **Update the version** in `packages/gridcue/package.json`, and add its section to `packages/gridcue/CHANGELOG.md`.
2. **Merge to `main`** through a PR. CI runs `pnpm check`.
3. **Tag the merge commit and push the tag:**
   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```
4. **The Release workflow**:
   - checks that the tag matches the package version;
   - runs `pnpm check` (lint, build, typecheck, tests, Mock evals, package and bundle checks);
   - publishes.
5. **Check the result** on npmjs.com: the version, and the "Provenance" badge.

## Before tagging

Optionally, run the live evals against the release candidate:

```bash
pnpm eval:live -- --verbose --strict
```

`--strict` fails on any mismatch. A live model varies and a service can fail transiently, so rerun a failure before treating it as a regression. Any unsafe result blocks the release.
