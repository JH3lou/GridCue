# Releasing gridcue

Releases are published from GitHub Actions through **npm trusted publishing** (OIDC). No npm token is stored anywhere, and npm attaches a provenance attestation that proves the package was built from this repository.

## First release (owner, once)

npm adds a trusted publisher only to a package that already exists, so 0.1.0 is published by hand. Every later release goes through the workflow with provenance.

1. **Sign in to the npm account** that will own `gridcue`, turn on two-factor authentication, and run `npm login`.
2. **Merge the release PR**, and wait for CI's `pnpm check` to pass on `main`.
3. **Publish 0.1.0 from a clean copy of that merge commit.** A worktree keeps local edits out of the build:
   ```bash
   git fetch origin && git worktree add ../gridcue-release origin/main && cd ../gridcue-release
   pnpm install --frozen-lockfile && pnpm check
   cd packages/gridcue
   npm pack --dry-run            # LICENSE, README.md, CHANGELOG.md and dist/ are listed
   npm publish --access public   # asks for the 2FA code
   ```
4. **Add the trusted publisher** at npmjs.com/package/gridcue/access (Trusted publisher → GitHub Actions):
   - User: `JH3lou`
   - Repository: `GridCue`
   - Workflow filename: `release.yml`
   - Environment: leave empty

   `packages/gridcue/package.json`'s `repository.url` already matches the repository exactly, which npm requires. Then, on the same page, set publishing access to require 2FA and disallow tokens.
5. **Tag the same commit:** `git tag v0.1.0 <merge-sha> && git push origin v0.1.0`. The workflow runs its checks, sees that 0.1.0 is on npm, and skips publishing.
6. **Check** `npm view gridcue`, and install it in a fresh project. The Provenance badge first appears on 0.1.1.
7. **Clean up** with `git worktree remove ../gridcue-release`.

## Every release

1. **Update the version** in `packages/gridcue/package.json`, and add its section to `packages/gridcue/CHANGELOG.md` with the release date.
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

`--strict` fails on any mismatch. A live model varies and a service can fail transiently, so rerun a failure before treating it as a regression. Any unsafe result blocks the release: a ready plan where a question or refusal was expected, or a ready plan with other operations than the case expects.
