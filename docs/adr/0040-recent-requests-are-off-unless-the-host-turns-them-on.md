# Recent requests are off unless the Host turns them on

**Status:** accepted with the command bar spec (2026-11-13). Not yet built.

At an empty input the bar offers a few Starters: the Host's own examples, recent requests, and changes built from the View Schema. GridCue keeps recent requests only when the Host asks for them, by setting `recent: true` or by passing its own store. With neither, GridCue keeps no Utterance at all.

The first design kept this session's applied requests in the Controller's memory by default. `AGENTS.md` says raw Utterances are never recorded without explicit Host configuration. Memory is still a record: on a shared desk, the next User at the same screen would see what the last one asked. The owner approved off by default (order plan D45, 2026-11-13).

What is decided:

- **Off is the default.** A Host that sets nothing gets Starters from its examples and the View Schema only.
- **Turned on, they stay in memory.** They last as long as the Controller does. GridCue never writes them to browser storage.
- **Keeping them is the Host's choice and the Host's code.** A Host that wants them to outlast the Controller passes a store, and decides where they go and who sees them.
- **Only an applied request is recent.** A plan the User edited, or one that came from a View State, is not recorded, because its text no longer says what was applied.

Recent requests in browser storage were rejected. They would outlast the session on a machine GridCue knows nothing about.

The cost is that a Host gets no recent requests until it sets one option, so many Users will never see them.

This would change only if the rule in `AGENTS.md` it follows changes.
