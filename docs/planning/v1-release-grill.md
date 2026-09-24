# v1 release: grilling log

The owner's direction on 2026-09-24: "Let's get this as a good v1 wrapped and then move to marketing site/docs".

This round decides what "a good v1" includes. It draws on the handoff's open follow-ups (`docs/planning/handoff-2026-09-24.md`) and on what the live runs found. The Site and docs are the next spec.

## Facts gathered (2026-09-24)

- **npm.** `gridcue` is still unclaimed: `npm view gridcue` returns 404. `packages/gridcue/package.json` is at `0.0.0`. CI exists (`.github/workflows/ci.yml`), but there is no release workflow.
- **Open PRs** stack in this order: #2 (resolution quality) → #3 (fan-out) → #4 (chassis). Each has passed `pnpm check` and two live runs.
- **A provider can hang.** In a live run, a Jev call hung for 78 s before failing. The SDK's per-attempt 10 s timeout and 2 retries stack up, and GridCue has no overall limit. The spec (section 9) expects a timeout to return to idle with the Utterance kept; today it ends in "error".
- **The handoff's open follow-ups that can leave a User stuck or misled:**
  - `apply()` and `undo()` call some adapter methods outside their `try`. If one throws, the controller can stay on "applying". A throw part-way through a write doesn't restore the previous view.
  - Answering "No" to a confirmation leads to a Clarification with no options.
- **Security.** The Server Handler has no auth hook. Only docs cover it today, and they don't say to put it behind auth and rate limits yet.

## Round 1

Answer by number. A bare "agree" accepts the recommendation.

❓ **Q1 - Hardening that must land before 0.1.0.**
(a) **Four fixes, each with tests:**
   1. **A provider time limit.** `createGridCue({ providerTimeoutMs })`, default 8 s, aborts the request. The UI returns to idle with the Utterance kept and says "That took too long. Try again." The Jev provider also caps the SDK's own retries within that limit.
   2. **`apply()`/`undo()` never stick.** Every adapter call is inside the `try`. A failed write restores the previous View State through the adapter and reports the error.
   3. **"No" never dead-ends.** Answering "No" ends in "Okay, nothing will change. Rephrase or edit your request.", with the Utterance kept.
   4. **`examples/vite/server.ts` loads the root `.env.local`,** like `pnpm dev`.
(b) Ship as is, and fix these in 0.1.x.

➡️ (a). Each is a way for a real User to get stuck or wait 78 s. They are small and testable, and a v1 should not ship with them.

---

❓ **Q2 - The Server Handler and auth.**
(a) **Docs and examples only for v1.** The README and the Site docs say plainly to put `/api/gridcue` behind the app's own auth and rate limit, and show a few lines for Next.js middleware and Express. There is no new API.
(b) Add an `authorize(request)` hook to `createGridCueHandler`.

➡️ (a). Hosts already have auth, and GridCue shouldn't invent a second one. A hook can come in 0.2 if Hosts ask for it.

---

❓ **Q3 - Release mechanics.**
(a) **Version `0.1.0`, released from a tag through GitHub Actions** with npm trusted publishing and provenance, so no npm token is stored.
   - The workflow runs `pnpm check` before publishing.
   - `CHANGELOG.md` starts at 0.1.0.
   - `docs/operations/release.md` documents the steps.
   - **You** create the npm account, link the repository as a trusted publisher, and push the tag. I write everything else.
(b) Publish by hand from a laptop.

➡️ (a). It was already decided in the handoff (ADR 0004 re-check done: the name is free). Provenance lets adopters verify the package came from this repo.

---

❓ **Q4 - What stays out of v1.**
(a) **Defer:**
   - the strategy-comparison demo UI, which moves into the Site spec as part of the live demo;
   - grid routing (0.2);
   - the developer-panel gaps, which the Site's demo supersedes;
   - the cosmetic follow-ups, except `biome migrate`, which takes a minute.
(b) Include the comparison demo in v1.

➡️ (a). The comparison belongs where prospects will see it, on the Site. v1 is the package.

---

❓ **Q5 - Merging the stacked PRs.**
(a) **You merge #2, then #3, then #4, into `main` in that order.** GitHub retargets each to `main` as the one below merges. I then cut `claude/v1-release` from `main` for the Q1 to Q3 work, as one PR.
(b) I collapse #2 to #4 into one PR.

➡️ (a). The reviews and live evidence stay attached to each PR, and the history stays readable.

## Round 1 answers (owner, 2026-09-24)

"Agree": Q1 to Q5 accepted as recommended. The owner also asked for the Greptile review comments on PRs #2 to #4 to be reviewed and addressed before merging.
