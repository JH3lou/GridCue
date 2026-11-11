# The Local Resolver reads first, and a provider is optional

**Status:** accepted with the four bets spec (2026-11-10). Not yet built.

GridCue gains a Local Resolver: deterministic code in the root entry that reads a closed grammar in the User's browser and declines everything else. `createGridCue` takes it three ways:

- **No `provider`:** the Local Resolver alone. No server, no key.
- **`provider` and `local: true`:** the Local Resolver first, and the provider for what it declines.
- **`provider` only:** as before. This stays the default until the owner changes it.

Before this, every request needed an Intent Provider, so every Host needed a Server Handler and a key, or the Mock Provider. The Mock Provider answers from rules with fixed confidence, and a test over 188 labelled requests found 8 wrong ready plans from it (four bets grill, 2026-11-10). The owner chose a new strict resolver over promoting the Mock Provider behind a trust rule, and chose opt-in over on by default.

What makes a local result safe to use:

- **The grammar is closed.** A Clause is read only when every word in it is a declared name, an amount, or one of the grammar's own words in a place the grammar allows. A single leftover word declines the whole request. The Mock Provider's failures all came from reading part of a Clause and acting on it.
- **It never picks a column by likelihood.** A bare amount goes to the column the kind rule of ADR 0013 selects. When several fit, it goes to the schema's `defaultMeasure` (ADR 0018) if that is one of them. This widens `defaultMeasure` from "the column a size word ranks by" to "the column a bare amount means". Otherwise the Local Resolver declines.
- **The Controller decides, not the resolver.** A local result is used only when every Clause was read in full and the compiled plan is ready and valid, including ADR 0019's check, or is a refusal. The compiled plan is something no Intent Provider sees, which is why this is a Controller option and not a provider that wraps another.

A declined request goes to the provider unchanged, so the provider path behaves exactly as it does today. With no provider, GridCue asks, and names the words it couldn't place.

Local first stays opt-in until two fresh labelled sets, one on a second schema, show no wrong view among locally resolved results. The first trust rule reached that number only after it was shown its failures, so the number alone was not evidence.

The Mock Provider stays in `gridcue/mock` for tests and for keyless work on the provider path. The Site demo moves to the Local Resolver alone, so the public demo asks where it used to guess.
