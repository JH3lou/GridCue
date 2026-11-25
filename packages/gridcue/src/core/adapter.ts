import type { VersionedViewState, ViewCapabilities, ViewSchema, ViewState } from "./protocol";
import type { ApplicableViewPlan } from "./validate";

export type ApplyResult = { ok: true; state: VersionedViewState } | { ok: false; code: `ADAPTER_${string}`; message: string };

/** Translates GridCue's View State to one grid library. Contains no language logic. */
export interface GridAdapter {
  getSchema(): ViewSchema;
  getCapabilities(): ViewCapabilities;
  getState(): VersionedViewState;
  /** The view `view.reset` returns to. */
  getDefaultState(): ViewState;
  /**
   * Applies every operation or none. Rejects plans that did not come from `validatePlan`. Resolves with `ok: true`
   * only once the grid holds the state written, and returns the Revision the grid has at that moment. A change made
   * after it is newer than the apply, so it must not be folded into the returned Revision. A grid that updates at
   * once returns at once. A grid that updates later, such as a table whose state the Host controls, is waited for
   * within a bound, and the apply throws when the bound runs out (ADR 0031).
   */
  apply(plan: ApplicableViewPlan): Promise<ApplyResult>;
  /** Writes a snapshot back. Done, like `apply`, only once the grid holds it, with the Revision the grid now has. */
  restore(snapshot: VersionedViewState): Promise<ApplyResult>;
  /** Fires on every view change, including the user's own clicks (ADR 0009). */
  subscribe(listener: (state: VersionedViewState) => void): () => void;
}

/** The MVP operations every first-release adapter supports. */
export const MVP_OPERATIONS: readonly string[] = [
  "filter.add",
  "filter.clear",
  "sort.set",
  "group.set",
  "columns.show",
  "columns.hide",
  "columns.order",
  "view.reset",
];
