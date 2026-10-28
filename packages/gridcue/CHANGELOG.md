# Changelog

## 0.2.0 (2026-10-27)

GridCue 0.2.0 turns dense ranking requests into one checked View Plan: changes can start mid-line, size words can use a Host-declared main value column, and counts become previewable row limits where the grid supports them.

**Breaking**
- `engines.node` is now `^22.23.4 || ^24.22.1 || >=26.12.1`, the releases with the Node.js October 2026 security fixes. Node 20 and earlier unpatched Node 22 and 24 releases are no longer supported.
- `ViewOperation` now includes `limit.set`. Code with an exhaustive switch over the public union must handle the new operation. The Rows Adapter reports it in addition to `MVP_OPERATIONS`; custom adapters should advertise it only when they can limit the complete sorted row set.
- `renderPreview()` now returns `notes` (an empty array when nothing was omitted). Exact-object assertions and snapshots may need to include it; the `Preview.notes` type stays optional so hand-built Previews remain compatible.

**Resolution** (ADR 0018)
- Several changes in one line without punctuation: a part also splits where a different kind of change starts mid-line ("grouped by household sorted largest to smallest" is two parts). "Roth IRAs grouped by rep" and "show accounts where value is over $1M" stay one part.
- Direction phrases: "largest to smallest", "biggest to smallest", "top", "largest" and "biggest" sort descending; "smallest to largest" and "smallest" ascending. "Largest to smallest" no longer sorts ascending.
- `defaultMeasure` on the schema names the grid's main value column. "Top accounts", "largest to smallest" and "smallest first" sort by it when no column is named, instead of asking. Column synonyms stay `aliases`.

**Operations**
- `limit.set` shows only the first `count` rows of the sorted view, with its own preview line ("Show only the first 10 rows"); `count: null` shows every row again. "Top 10" produces it where the adapter lists it; the Rows Adapter applies the limit after sorting and before grouping. Elsewhere the plan sorts alone and `Preview.notes` says the count was not applied. `ViewState.limit` is optional.
- `compile` accepts the adapter's `operations`; the Controller passes them automatically. Direct callers can pass this optional list to enable capability-aware row limits.

**Fixes**
- Quoted values and arguments no longer trigger part splitting, sort directions, size words, or row counts.
- Approved values that contain size words (such as "Top tier"), named columns in requests such as "top 10 scores", and large counts keep their intended meaning instead of being replaced by `defaultMeasure` or read as filter values.

**Site**
- `gridcue.dev` now exposes its search API, Component Registry, docs, and agent-readable docs through an RFC 9727 API catalog and discovery headers. The Site build validates those resources and their internal links.

## 0.1.0 (2026-09-25)

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
- A new filter replaces the current filters unless the request says to add ("also", "only those", "narrow it down"), as sorts and groupings already do, and the Preview names the filters it removes (ADR 0017).
- Undo steps back through every applied change in turn, to the starting view. It stops at a manual change instead of erasing it.
- Nothing in a request is dropped silently. A direction beside another change ("trusts, largest first") asks which column to sort by. When no answer was given on whether a part adds a level ("also group by advisor") or which level is outer ("group by advisor within custodian"), GridCue asks instead of guessing. This happens with the focused strategy, the Mock, or a provider that doesn't ask those questions.
