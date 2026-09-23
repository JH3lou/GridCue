---
name: gridcue-planning
description: How GridCue turns an idea into an approved spec and plan before any code is written. Use when starting a new feature, package, adapter, or Site section, when the owner says "grill me" or "plan this", or when resuming the build-plan interview in docs/planning/build-plan-grill.md.
---

# Planning a GridCue change

GridCue plans in three steps. Each step needs the owner's approval before the next one starts.

1. **Grill.** Use the `grill-with-docs` skill from the Matt Pocock plugin. Ask the whole frontier of open decisions in one numbered round, each with a recommended answer. Look up facts yourself, often with a sub-agent. Only decisions go to the owner.
2. **Spec.** Use the superpowers `brainstorming` skill on its architectural path. Write the spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
3. **Plan.** Use the superpowers `writing-plans` skill. Write the plan to `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.

## Where things go

- **Round log.** Append each round and the owner's answers to `docs/planning/build-plan-grill.md`, or to a new `docs/planning/<topic>-grill.md` for a later feature. Record the answers verbatim in a table, then write the next round.
- **Glossary.** When a term is settled, update `CONTEXT.md` right away. Keep it a glossary with no implementation detail.
- **Decisions.** Write an ADR in `docs/adr/` only when a decision is hard to reverse, surprising without context, and the result of a real trade-off. Number it one above the highest existing ADR. When a later answer overturns one, add a new ADR and mark the old one superseded.
- **Research.** Put facts in the round log's "Facts gathered" section and mark anything unverified. Keep raw research out of the repo.

## If the plugins are missing

`.claude/settings.json` enables both plugins for Claude Code. Other agents, or a session where they did not install, can read the skills directly:

- superpowers: https://github.com/obra/superpowers, in `skills/brainstorming` and `skills/writing-plans`
- Matt Pocock: https://github.com/mattpocock/skills, in `skills/productivity/grilling` and `skills/engineering/domain-modeling`

Follow them as written, with this file's paths taking precedence.

## Rules that override the generic skills

- AGENTS.md's non-negotiables are not up for re-grilling unless the owner raises them.
- Never scaffold or write product code before the spec and the plan are both approved.
