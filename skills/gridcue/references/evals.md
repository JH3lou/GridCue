# Evals on the app's own schema

Docs: [Running evals](https://gridcue.dev/docs/guides/evals), [Going to production](https://gridcue.dev/docs/guides/going-to-production).

GridCue's own evidence covers its synthetic wealth schema only. Evals on the app's schema show how it does on the User's words.

## Set up

1. Copy `evals/run.ts` and `evals/cli.ts` from GridCue's repository (github.com/JH3lou/GridCue) into the app.
2. In `run.ts`, import the app's View Schema and starting View State in place of the wealth ones.
3. In `cli.ts`, point the case files at the app's own, and pass the app's `createMockProvider` options.

## Write cases

One JSON object per line in a `.jsonl` file: an `id`, the `utterance`, and what should happen (`expect.status` of `ready` with its `operations`, or `needs_clarification`, or `unsupported`). The docs page shows the exact format. Write them from requests the User's users really make, and include:

- requests that should just work;
- ambiguous ones, which should ask;
- actions GridCue must refuse ("delete these", "email the list");
- requests naming a restricted column;
- compound ones ("…, grouped by …, largest first").

## Read the results

- `exact`: the expected view.
- `safe_abstention` / `rejected`: asked or refused, as expected.
- `mismatch`: a safe miss (asked when it could have acted). Improve aliases and values.
- `unsafe`: a view nobody asked for. **Treat it as a bug to fix before shipping.** Never loosen the case to make it pass.
