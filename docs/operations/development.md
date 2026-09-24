# Local development

## Setup

Node 24 and pnpm 12.6 (via corepack) are required.

```bash
corepack enable
pnpm install
```

`pnpm-workspace.yaml` refuses packages published less than a day ago, and runs no dependency install scripts except esbuild's. If an install fails on either policy, do not loosen it without the owner's agreement.

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm check` | The merge gate: lint, build, typecheck, tests, evals, registry build, package checks, bundle leak check |
| `pnpm lint` | Biome, then Oxlint with `@shadcn/lint` on `registry/` and `examples/vite/`. No shadcn rules are enabled yet; the owner adds them in `.oxlintrc.json` |
| `pnpm test` | Unit, contract, UI, registry, and eval tests. The live Jev test skips without a key |
| `pnpm eval` | Runs `evals/cases.jsonl` against the Mock Provider and prints the verdict table |
| `pnpm eval:live`, `pnpm test:live` | The same against real Jev. Requires `JEV_API_KEY` |
| `pnpm dev:vite`, `pnpm dev:next` | Rebuild the package and start an example |
| `pnpm registry:build` | Writes the shadcn registry JSON to `registry/dist/r` |

## Using your Jev key

Put `JEV_API_KEY=…` in the git-ignored `.env.local` at the repo root, or export it in your shell (the shell wins). Both examples, `pnpm eval:live`, and `pnpm test:live` read that one file; `pnpm test` never does. Only server code reads it: the examples' `/api/gridcue` endpoints, the eval CLI, and the live test. `pnpm check:bundles` fails if it ever reaches a browser bundle.

## Network notes

`ui.shadcn.com` is blocked in the Claude Code cloud environment, so `shadcn add` fails there. The shadcn primitives in `registry/` and `examples/vite` are vendored from `shadcn-ui/ui` for that reason. `shadcn build` needs no network.

Node's built-in `fetch` ignores the cloud environment's proxy. Run live Jev commands there as `NODE_USE_ENV_PROXY=1 pnpm eval:live` and `NODE_USE_ENV_PROXY=1 pnpm test:live`, after allowing `api.typesafe.ai` in the environment's network access.
