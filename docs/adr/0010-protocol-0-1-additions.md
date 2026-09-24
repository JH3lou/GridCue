# Protocol 0.1 additions found while planning the package

Planning the first build against real libraries surfaced five small, additive changes to protocol 0.1 and its interfaces. None changes an existing meaning, so the protocol stays at 0.1.

- `ViewCapabilities.observesChanges` says whether an adapter reports manual view changes (ADR 0009).
- `GridAdapter.getDefaultState()` returns the view that `view.reset` restores.
- `GridAdapter.apply(plan)` takes only a validated plan. The validator keeps each plan's resulting state in a private map, and adapters read it with `resultingState(plan)`, so a caller cannot pair a valid plan with a different state.
- The unsupported category `restricted_column` marks a request that names a restricted column. GridCue refuses it locally, before any provider call.
- The evidence source `user` records a decision the user made by answering a Clarification. The resolution literal kind `unreadable` marks a number whose format is ambiguous across locales, such as "1.000.000". GridCue asks about it rather than guessing.
