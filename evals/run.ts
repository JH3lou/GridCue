import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { ledgerInitialState, ledgerMockOptions, ledgerSchema } from "@gridcue-internal/ledger-fixtures";
import { wealthInitialState, wealthMockOptions, wealthSchema } from "@gridcue-internal/wealth-fixtures";
import {
  createGridCue,
  createRowsAdapter,
  defineSchema,
  type GridCueController,
  type IntentProvider,
  type ResolutionResult,
  type RowsAdapter,
  type ViewOperation,
  type ViewPlan,
  type ViewState,
} from "gridcue";

export interface EvalCase {
  id: string;
  utterance: string;
  /** Starts the grid from this view instead of the default, e.g. already grouped by custodian, or showing a count. */
  state?: Partial<Pick<ViewState, "groupBy" | "sorts" | "filters" | "limit">>;
  /**
   * Runs on another schema instead of the wealth fixture: "dated" for cases about dates, "group-names" for a schema
   * where "group" is part of a value and of a column's label, "ledger" for the ledger fixture (fixtures/ledger).
   */
  schema?: "dated" | "group-names" | "ledger";
  /** "no-group" runs on a grid that doesn't list `group.set` (more grids spec, 5.3). */
  grid?: "no-group";
  /**
   * A scripted answer from the Intent Provider, written by the labeller before the code. It is replayed in place of
   * the provider the case runs with, the way ADR 0022's tests replay an answer, so the case checks what code does with
   * that proposal. The request is built and sent as for any other case.
   */
  providerAnswer?: ResolutionResult;
  /** With a ready `expect`: a question or a refusal is also right. Only a ready plan with other operations is wrong. */
  alsoAcceptsAsk?: boolean;
  expect: {
    /** Left out with `mustNotBeReady`. */
    status?: ViewPlan["status"];
    operations?: unknown[];
    category?: string;
    clarificationPrompt?: string;
    /** Any question or refusal passes; only a ready plan fails. For a case the spec doesn't settle beyond that. */
    mustNotBeReady?: boolean;
    /** A ready plan holding this operation is a wrong view, whatever else the case expects. */
    neverApplies?: string;
  };
}

/**
 * The date schema in packages/gridcue/test/reading-fixes.test.ts, plus one date-and-time column. Its rows are never
 * read: a case judges the plan, not the rows.
 */
const datedSchema = defineSchema(
  [
    { id: "name", label: "Name" },
    { id: "opened", label: "Opened" },
    { id: "closed", label: "Close date" },
    { id: "last_contact", label: "Last contact" },
    { id: "positions", label: "Positions" },
    { id: "value", label: "Value" },
  ],
  {
    id: "ledger",
    version: "1",
    rowNoun: "account",
    columns: {
      opened: { kind: "date", aliases: ["open date"] },
      closed: { kind: "date", aliases: ["closed"] },
      last_contact: { kind: "datetime" },
      positions: { kind: "number", aliases: ["holdings count"] },
      value: { kind: "currency" },
    },
  },
);

/** Plans whose names hold the word "group": a product called "Group Annuity" and a "Group name" column. */
const groupNamesSchema = defineSchema(
  [
    { id: "plan_number", label: "Plan number" },
    { id: "group_name", label: "Group name" },
    { id: "product", label: "Product" },
    { id: "premium", label: "Premium" },
  ],
  {
    id: "group-plans",
    version: "1",
    rowNoun: "account",
    columns: {
      product: {
        kind: "enum",
        enumValues: [
          { id: "group_annuity", label: "Group Annuity" },
          { id: "individual_annuity", label: "Individual Annuity" },
          { id: "term_life", label: "Term Life" },
        ],
      },
      premium: { kind: "currency" },
    },
  },
);

/**
 * A grid that can't group rows, built as a Host would build one: the Rows Adapter with `group.set` taken out of the
 * operations it lists. Everything else, the rows and the View State included, is the Rows Adapter's own.
 */
const withoutGrouping = (adapter: RowsAdapter): RowsAdapter => ({
  ...adapter,
  getCapabilities: () => {
    const capabilities = adapter.getCapabilities();
    return { ...capabilities, operations: capabilities.operations.filter((op) => op !== "group.set") };
  },
});

/** The Mock Provider's settings for the app a case runs in: which column a bare amount or percentage names there. */
export const mockOptionsFor = (c: Pick<EvalCase, "schema">) => (c.schema === "ledger" ? ledgerMockOptions : wealthMockOptions);

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
  if (status === "ready" && c.expect.neverApplies && plan.operations.some((op) => op.type === c.expect.neverApplies)) return "unsafe";
  if (c.expect.status !== "ready" && status === "ready") return "unsafe";
  if (c.expect.mustNotBeReady || (c.alsoAcceptsAsk && status !== "ready")) return status === "unsupported" ? "rejected" : "safe_abstention";
  if (c.expect.status !== status) return "mismatch";
  if (status === "ready") {
    return sameView(stripIds(plan.operations), c.expect.operations ?? []) ? "exact" : "unsafe";
  }
  if (c.expect.category && !plan.unsupportedSegments.some((s) => s.category === c.expect.category)) return "mismatch";
  if (c.expect.clarificationPrompt && plan.clarifications[0]?.prompt !== c.expect.clarificationPrompt) return "mismatch";
  return status === "unsupported" ? "rejected" : "safe_abstention";
};

/**
 * Runs one case. `make` is the Controller's constructor: the built package's, unless a test passes the package
 * source's to look inside the compiler.
 */
export const runCase = async (c: EvalCase, provider: IntentProvider, make: typeof createGridCue = createGridCue) => {
  // A case's state is the view the User is looking at. The default view, which a reset returns to, stays the fixture's.
  const rows =
    c.schema === "dated"
      ? createRowsAdapter({ schema: datedSchema })
      : c.schema === "group-names"
        ? createRowsAdapter({ schema: groupNamesSchema })
        : c.schema === "ledger"
          ? createRowsAdapter({ schema: ledgerSchema, initialState: ledgerInitialState })
          : createRowsAdapter({ schema: wealthSchema, initialState: wealthInitialState });
  const adapter = c.grid === "no-group" ? withoutGrouping(rows) : rows;
  if (c.state) adapter.setState((view) => ({ ...view, ...c.state }));
  const answer = c.providerAnswer;
  const cue: GridCueController = make({
    adapter,
    provider: answer ? { resolve: async () => structuredClone(answer) } : provider,
  });
  const plan = await cue.propose(c.utterance);
  const { status, preview } = cue.getState();
  return { id: c.id, verdict: judge(c, plan, status), plan, status, preview };
};

/** "group", "grouped", "grouping", "ungroup", in any case. */
const GROUPING_WORD = /\b(?:un)?group/i;

/**
 * An existing case, moved to a grid without `group.set`, with its expected result derived (more grids spec, 10).
 * A case whose expected plan groups, or clears the grouping, must end not applied. So must a question or refusal
 * whose words name grouping, since its labelled prompt may now say the grid can't group. Every other case keeps its
 * label, and must keep the verdict it has on the Rows Adapter. A case that starts grouped is left out: a grid that
 * can't group never holds a grouping. So is a case with a scripted provider answer: it was written for the candidates
 * of a grid that can group. Returns `undefined` for those.
 */
export const onGridWithoutGrouping = (c: EvalCase): { case: EvalCase; groups: boolean } | undefined => {
  if (c.grid || c.providerAnswer || (c.state?.groupBy?.length ?? 0) > 0) return undefined;
  const groups =
    (c.expect.operations ?? []).some((op) => (op as { type: string }).type === "group.set") ||
    (c.expect.status !== "ready" && GROUPING_WORD.test(c.utterance));
  return {
    case: { ...c, grid: "no-group", expect: groups ? { mustNotBeReady: true, neverApplies: "group.set" } : c.expect },
    groups,
  };
};

/**
 * Runs an existing case on the Rows Adapter and on a grid without `group.set`. A case that groups passes when it
 * isn't ready on the second grid; any other case passes when its verdict there is the one it has on the Rows Adapter.
 */
export const runWithoutGrouping = async (c: EvalCase, provider: IntentProvider) => {
  const moved = onGridWithoutGrouping(c);
  if (!moved) return undefined;
  const before = await runCase(c, provider);
  const after = await runCase(moved.case, provider);
  const pass = moved.groups ? after.verdict !== "unsafe" : after.verdict === before.verdict;
  return { id: c.id, groups: moved.groups, pass, before, after };
};
