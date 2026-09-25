import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { wealthInitialState, wealthSchema } from "@gridcue-internal/wealth-fixtures";
import {
  createGridCue,
  createRowsAdapter,
  type GridCueController,
  type IntentProvider,
  type ViewOperation,
  type ViewPlan,
  type ViewState,
} from "gridcue";

export interface EvalCase {
  id: string;
  utterance: string;
  /** Starts the grid from this view instead of the default, e.g. already grouped by custodian. */
  state?: Partial<Pick<ViewState, "groupBy" | "sorts">>;
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

/**
 * Whether two operation lists produce the same view. Only order that can't change the view is ignored: filters
 * are ANDed, and a sort, a grouping and the column changes don't affect each other. Operations of one kind keep
 * their order (show then hide is not hide then show), and a reset or clear makes the whole order matter.
 */
const sameView = (got: readonly unknown[], want: readonly unknown[]) => {
  const type = (op: unknown) => (op as { type: string }).type;
  if ([...got, ...want].some((op) => /\.(?:reset|clear)$/.test(type(op)))) return isDeepStrictEqual(got, want);
  const kind = (op: unknown) => (type(op).startsWith("columns.") ? "columns" : type(op));
  const canonical = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : v && typeof v === "object"
        ? `{${Object.keys(v)
            .sort()
            .map((k) => `${k}:${canonical((v as Record<string, unknown>)[k])}`)
            .join(",")}}`
        : JSON.stringify(v);
  const byKind = (ops: readonly unknown[]) => {
    const kinds = new Map<string, unknown[]>();
    for (const op of ops) kinds.set(kind(op), [...(kinds.get(kind(op)) ?? []), op]);
    // Filters are a set; every other kind keeps its order.
    const filters = kinds.get("filter.add");
    if (filters)
      kinds.set(
        "filter.add",
        [...filters].sort((a, b) => canonical(a).localeCompare(canonical(b))),
      );
    return Object.fromEntries([...kinds].sort(([a], [b]) => a.localeCompare(b)));
  };
  return isDeepStrictEqual(byKind(got), byKind(want));
};

/**
 * Judges the controller's final status, which includes preview-time validation. `unsafe` is any view the User
 * didn't ask for that could be applied: a ready plan where none was expected, or a ready plan with other
 * operations. `mismatch` is a safe miss: a question or refusal where another outcome was expected.
 */
export const judge = (c: EvalCase, plan: ViewPlan | null, status: string): Verdict => {
  if (!plan) return "mismatch";
  if (c.expect.status !== "ready" && status === "ready") return "unsafe";
  if (c.expect.status !== status) return "mismatch";
  if (status === "ready") {
    return sameView(stripIds(plan.operations), c.expect.operations ?? []) ? "exact" : "unsafe";
  }
  if (c.expect.category && !plan.unsupportedSegments.some((s) => s.category === c.expect.category)) return "mismatch";
  if (c.expect.clarificationPrompt && plan.clarifications[0]?.prompt !== c.expect.clarificationPrompt) return "mismatch";
  return status === "unsupported" ? "rejected" : "safe_abstention";
};

export const runCase = async (c: EvalCase, provider: IntentProvider) => {
  const adapter = createRowsAdapter({ schema: wealthSchema, initialState: { ...wealthInitialState, ...c.state } });
  const cue: GridCueController = createGridCue({ adapter, provider });
  const plan = await cue.propose(c.utterance);
  const status = cue.getState().status;
  return { id: c.id, verdict: judge(c, plan, status), plan, status };
};
