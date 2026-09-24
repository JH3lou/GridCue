import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { wealthInitialState, wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { createGridCue, createRowsAdapter, type GridCueController, type IntentProvider, type ViewOperation, type ViewPlan } from "gridcue";

export interface EvalCase {
  id: string;
  utterance: string;
  expect: {
    status: ViewPlan["status"];
    operations?: unknown[];
    category?: string;
    clarificationPrompt?: string;
  };
}

export type Verdict = "exact" | "safe_abstention" | "rejected" | "mismatch" | "unsafe";

export const loadCases = (path = new URL("./cases.jsonl", import.meta.url)): EvalCase[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EvalCase);

/** Drops generated IDs so plans compare on meaning only. */
const stripIds = (ops: readonly ViewOperation[]) =>
  ops.map((op) => {
    if (op.type !== "filter.add") return op;
    const { id: _id, type: _type, ...predicate } = op.predicate;
    return { ...op, predicate };
  });

/** Judges the controller's final status, which includes preview-time validation. */
export const judge = (c: EvalCase, plan: ViewPlan | null, status: string): Verdict => {
  if (!plan) return "mismatch";
  if (c.expect.status !== "ready" && status === "ready") return "unsafe";
  if (c.expect.status !== status) return "mismatch";
  if (status === "ready") {
    return isDeepStrictEqual(stripIds(plan.operations), c.expect.operations) ? "exact" : "mismatch";
  }
  if (c.expect.category && !plan.unsupportedSegments.some((s) => s.category === c.expect.category)) return "mismatch";
  if (c.expect.clarificationPrompt && plan.clarifications[0]?.prompt !== c.expect.clarificationPrompt) return "mismatch";
  return status === "unsupported" ? "rejected" : "safe_abstention";
};

export const runCase = async (c: EvalCase, provider: IntentProvider) => {
  const adapter = createRowsAdapter({ schema: wealthSchema, initialState: wealthInitialState });
  const cue: GridCueController = createGridCue({ adapter, provider });
  const plan = await cue.propose(c.utterance);
  const status = cue.getState().status;
  return { id: c.id, verdict: judge(c, plan, status), plan, status };
};
