# Changelog

## 0.1.0

The first release.

**Resolution**
- One package, `gridcue`, with the `gridcue/react`, `gridcue/server`, `gridcue/mock` and `gridcue/tanstack-table` entries.
- The Controller runs each request:
  1. normalize it and screen restricted columns;
  2. ask an Intent Provider closed questions;
  3. compile a View Plan, then validate and preview it;
  4. apply it atomically;
  5. undo it on request.
- Deterministic name matching (Mentions), with grammar rules that tell the rows from a column (ADR 0013).
- Precedence rules for competing changes (ADR 0012), and several changes per part through the fan-out questions (ADR 0014).

**Providers**
- The Jev provider has two strategies, `"focused"` and `"fan-out"` (the default), with per-signal toggles (ADR 0015).
- A Mock Provider for keyless development and tests.

**Domain declarations**
- `rowNoun`, column `entity`, and `valueGroups` (ADR 0015).

**Safety**
- View-only: GridCue never changes data.
- Preview before apply.
- Restricted columns are refused before any provider call.
- No provider key ever reaches a browser bundle; `pnpm check:bundles` enforces this.

**Reliability**
- A provider time limit (`providerTimeoutMs`, default 8 s). When it passes, the view returns to idle and the request is kept.
- Apply and undo never stick: a failed write restores the previous view.
- Answering "No" ends with a clear "nothing will change".
