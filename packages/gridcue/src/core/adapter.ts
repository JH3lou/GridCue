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
  /** Applies every operation or none. Rejects plans that did not come from `validatePlan`. */
  apply(plan: ApplicableViewPlan): Promise<ApplyResult>;
  restore(snapshot: VersionedViewState): Promise<ApplyResult>;
  /** Fires on every view change, including the user's own clicks (ADR 0009). */
  subscribe(listener: (state: VersionedViewState) => void): () => void;
}

/** The MVP operations every first-release adapter supports. */
export const MVP_OPERATIONS = [
  "filter.add",
  "filter.clear",
  "sort.set",
  "group.set",
  "columns.show",
  "columns.hide",
  "columns.order",
  "view.reset",
];
