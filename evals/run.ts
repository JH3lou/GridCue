import { readdirSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  generateLedger,
  ledgerColumns,
  ledgerInitialState,
  ledgerMockOptions,
  ledgerSchema,
  ledgerSchemaOptions,
} from "@gridcue-internal/ledger-fixtures";
import {
  generateAccounts,
  wealthColumns,
  wealthInitialState,
  wealthMockOptions,
  wealthSchema,
  wealthSchemaOptions,
} from "@gridcue-internal/wealth-fixtures";
import {
  type ColumnInput,
  createGridCue,
  createRowsAdapter,
  defineSchema,
  emptyViewState,
  type GridAdapter,
  type GridCueController,
  type IntentProvider,
  type ResolutionResult,
  type SchemaOptions,
  type ViewOperation,
  type ViewPlan,
  type ViewSchema,
  type ViewState,
} from "gridcue";
import {
  createTanStackAdapter,
  gridcueAggregationFn,
  gridcueAggregationValue,
  gridcueCountFeature,
  gridcueCountRowModel,
  gridcueFilterFn,
  type TanStackTableLike,
} from "gridcue/tanstack-table";
import { tanStackTables } from "../packages/gridcue/test/tanstack-table";
import { clockFor, EVAL_CALENDAR, evalNow } from "./clock";
import { type EvalHouseTerm, ledgerHouseTerms, wealthHouseTerms } from "./house-terms";
import { type EvalLocalValues, ledgerLocalValues, wealthLocalValues } from "./local-values";

export interface EvalCase {
  id: string;
  utterance: string;
  /**
   * Starts the grid from this view instead of the default, e.g. already grouped by custodian, showing a count, with
   * pinned columns, or with a column hidden.
   */
  state?: Partial<
    Pick<ViewState, "groupBy" | "sorts" | "filters" | "limit" | "pinnedColumnIds" | "visibleColumnIds" | "density" | "aggregations">
  >;
  /**
   * Runs on another schema instead of the wealth fixture: "dated" for cases about dates, "group-names" for a schema
   * where "group" is part of a value and of a column's label, "form-words" for a schema whose names hold the pin and
   * density form words ("Pin code", "Compact"), "total-names" for a schema whose names hold the totals form words
   * ("Total return", "Sum insured", "Average cost"), "wealth-measure" for the wealth fixture with Market value as its
   * `defaultMeasure`, "ledger" for the ledger fixture (fixtures/ledger).
   */
  schema?: "dated" | "group-names" | "form-words" | "total-names" | "wealth-measure" | "ledger";
  /** "no-group" runs on a grid that doesn't list `group.set` (more grids spec, 5.3). */
  grid?: "no-group";
  /**
   * What the Host's table draws, as the adapter's `renders` option says it (operation set spec, 4.2): a case with it
   * runs on a Rows Adapter built with that `renders`, which lists `columns.pin`, `density.set` and `aggregation.set`
   * for the names it holds. A case without it runs on a grid that lists none of them, as before. Every pin and density
   * case is labelled for a grid that draws both, and every totals case for one that draws totals.
   * `onGridWithoutRenders` derives the same case's result on a grid without it.
   */
  renders?: Array<"pinning" | "density" | "totals">;
  /**
   * With `renders`: what the same request must read on a grid without it, where that is not derived from `expect`. One
   * kind of case needs it (order plan, section 11): words that are a pin or density form but for a name of the Host's
   * ("compact view" where the Host names a size class Compact). On a grid that draws density they are in doubt and
   * ask; on a grid that doesn't, they can only be the Host's value, and read as they did before density was read.
   */
  withoutRenders?: EvalCase["expect"];
  /**
   * Runs on a schema that declares its House Terms (evals/house-terms.ts): the wealth fixture's or the ledger's. Only
   * those two schemas declare terms. A case without it runs on the schema as the fixture defines it.
   */
  terms?: boolean;
  /**
   * Runs with the Local Values of its schema's name columns (evals/local-values.ts): Advisor and Household on the
   * wealth fixture, Owner and Counterparty on the ledger. Only those two schemas have them. A case without it runs with
   * no Local Values.
   */
  values?: boolean;
  /**
   * Runs at the fixed clock with the fixed Calendar (evals/clock.ts): today is 2026-11-13 in America/New_York, and the
   * year starts in January. Only the ledger schema takes it. A case without it runs with no Calendar and the default
   * clock, as before.
   */
  clock?: boolean;
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
    /**
     * The labels of the first question's choices, in order. `[]` says the question has none, as a "This grid can't …"
     * question. Left out, the choices are not checked.
     */
    clarificationChoices?: string[];
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
const datedColumns: ColumnInput[] = [
  { id: "name", label: "Name" },
  { id: "opened", label: "Opened" },
  { id: "closed", label: "Close date" },
  { id: "last_contact", label: "Last contact" },
  { id: "positions", label: "Positions" },
  { id: "value", label: "Value" },
];
const datedOptions: SchemaOptions = {
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
};

/** Plans whose names hold the word "group": a product called "Group Annuity" and a "Group name" column. */
const groupNamesColumns: ColumnInput[] = [
  { id: "plan_number", label: "Plan number" },
  { id: "group_name", label: "Group name" },
  { id: "product", label: "Product" },
  { id: "premium", label: "Premium" },
];
const groupNamesOptions: SchemaOptions = {
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
};

/**
 * Vehicles whose names hold the pin and density form words (operation set spec, 5.2): a "Pin code" column, and a size
 * class called "Compact". A Host's name is a Mention first, so "pin code" and "compact view" are not read as a pin or a
 * density here; the provider gets the part, as before. Its rows are never read: a case judges the plan, not the rows.
 */
const formWordsColumns: ColumnInput[] = [
  { id: "unit_number", label: "Unit number" },
  { id: "pin_code", label: "Pin code" },
  { id: "depot", label: "Depot" },
  { id: "size_class", label: "Size class" },
  { id: "mileage", label: "Mileage" },
];
const formWordsOptions: SchemaOptions = {
  id: "fleet-units",
  version: "1",
  rowNoun: "vehicle",
  columns: {
    unit_number: { aliases: ["unit"] },
    size_class: {
      kind: "enum",
      aliases: ["size"],
      enumValues: [
        { id: "compact", label: "Compact" },
        { id: "midsize", label: "Midsize" },
        { id: "full_size", label: "Full-size" },
      ],
    },
    mileage: { kind: "number" },
  },
};

/**
 * Policies whose names hold the totals form words (operation set spec, 5.2): a "Total return" percent column, a "Sum
 * insured" and an "Average cost" currency column. A Host's name is a Mention first, so "total return" and "average
 * cost" are columns, not a total or an average, and read as before; "average total return" is an average of Total
 * return. Its rows are never read: a case judges the plan, not the rows.
 */
const totalNamesColumns: ColumnInput[] = [
  { id: "policy_number", label: "Policy number" },
  { id: "region", label: "Region" },
  { id: "total_return", label: "Total return" },
  { id: "sum_insured", label: "Sum insured" },
  { id: "average_cost", label: "Average cost" },
  { id: "premium", label: "Premium" },
];
const totalNamesOptions: SchemaOptions = {
  id: "insured-policies",
  version: "1",
  rowNoun: "policy",
  columns: {
    policy_number: { aliases: ["policy"] },
    region: {
      kind: "enum",
      enumValues: [
        { id: "north", label: "North" },
        { id: "south", label: "South" },
        { id: "west", label: "West" },
      ],
    },
    total_return: { kind: "percent" },
    sum_insured: { kind: "currency" },
    average_cost: { kind: "currency" },
    premium: { kind: "currency" },
  },
};

/**
 * Every schema a case can run on, built as a Host would build it: by its name, with its House Terms when the case says
 * `terms`, and with the fixed Calendar of `evals/clock.ts` when it runs at the fixed clock. Each is built once.
 */
const SCHEMAS = new Map<string, ViewSchema>();
const schemaOf = (name: EvalCase["schema"], terms: boolean, calendar: boolean): ViewSchema => {
  const key = `${name ?? "wealth"}:${terms}:${calendar}`;
  const built = SCHEMAS.get(key);
  if (built) return built;
  const dated = calendar ? { calendar: { ...EVAL_CALENDAR } } : {};
  const [columns, options]: [ColumnInput[], SchemaOptions] =
    name === "dated"
      ? [datedColumns, datedOptions]
      : name === "group-names"
        ? [groupNamesColumns, groupNamesOptions]
        : name === "form-words"
          ? [formWordsColumns, formWordsOptions]
          : name === "total-names"
            ? [totalNamesColumns, totalNamesOptions]
            : name === "wealth-measure"
              ? // The wealth fixture with a `defaultMeasure`: size words alone rank by Market value (ADR 0018).
                [wealthColumns, { ...wealthSchemaOptions, defaultMeasure: "market_value" }]
              : name === "ledger"
                ? [ledgerColumns, { ...ledgerSchemaOptions, ...(terms ? { houseTerms: ledgerHouseTerms } : {}) }]
                : [wealthColumns, { ...wealthSchemaOptions, ...(terms ? { houseTerms: wealthHouseTerms } : {}) }];
  const schema = defineSchema(columns, { ...options, ...dated });
  SCHEMAS.set(key, schema);
  return schema;
};

/**
 * A grid that can't group rows, built as a Host would build one: the Rows Adapter with `group.set` taken out of the
 * operations it lists. Everything else, the rows and the View State included, is the Rows Adapter's own.
 */
const withoutGrouping = <A extends GridAdapter>(adapter: A): A => ({
  ...adapter,
  getCapabilities: () => {
    const capabilities = adapter.getCapabilities();
    return { ...capabilities, operations: capabilities.operations.filter((op) => op !== "group.set") };
  },
});

/** The House Terms a case runs with: its schema's declared terms when it says `terms: true`, else none. */
export const houseTermsFor = (c: Pick<EvalCase, "schema" | "terms">): EvalHouseTerm[] | undefined => {
  if (!c.terms) return undefined;
  if (c.schema === undefined) return wealthHouseTerms;
  if (c.schema === "ledger") return ledgerHouseTerms;
  throw new Error(`No House Terms are declared for the "${c.schema}" schema.`);
};

/** The Local Values a case runs with: its schema's when it says `values: true`, else none. */
export const localValuesFor = (c: Pick<EvalCase, "schema" | "values">): EvalLocalValues | undefined => {
  if (!c.values) return undefined;
  if (c.schema === undefined) return wealthLocalValues;
  if (c.schema === "ledger") return ledgerLocalValues;
  throw new Error(`No Local Values are set for the "${c.schema}" schema.`);
};

/**
 * The schema a wealth or ledger case runs on: its fixture's, with the House Terms declared when it says `terms: true`,
 * and the fixed Calendar when it says `clock: true`.
 */
export const fixtureSchemaFor = (c: Pick<EvalCase, "schema" | "terms" | "clock">) => {
  houseTermsFor(c);
  const calendar = clockFor(c) !== undefined;
  if (c.schema === "ledger") return c.terms || calendar ? schemaOf("ledger", !!c.terms, calendar) : ledgerSchema;
  if (c.schema === undefined) return c.terms ? schemaOf(undefined, true, false) : wealthSchema;
  throw new Error(`The "${c.schema}" schema is not a fixture's.`);
};

/** The schema a case runs on: a fixture's, or one of the eval-only schemas ("total-names", "wealth-measure", …). */
export const caseSchemaFor = (c: Pick<EvalCase, "schema" | "terms" | "clock">) =>
  c.schema === undefined || c.schema === "ledger" ? fixtureSchemaFor(c) : schemaOf(c.schema, !!c.terms, clockFor(c) !== undefined);

/** The Mock Provider's settings for the app a case runs in: which column a bare amount or percentage names there. */
export const mockOptionsFor = (c: Pick<EvalCase, "schema">) => (c.schema === "ledger" ? ledgerMockOptions : wealthMockOptions);

export type Verdict = "exact" | "safe_abstention" | "rejected" | "mismatch" | "unsafe";

/**
 * The cases of `cases-review-fixes-heldout-r2.jsonl` labelled to ask where the code is ready, each the owner's decision,
 * not a defect; the order plan's section 12 D records them. The set passes with these ready, and fails on any other
 * wrong view.
 * - "hide <a column> where <a condition>" hides the column and adds the filter, the reading the docs give for it.
 * - A count said after a grouping is ready, as the count's spec has it: a grouping does not change which rows a count
 *   keeps.
 */
export const REVIEW_R2_FOR_THE_OWNER: readonly string[] = [
  "rf2-hide-column-where-01",
  "rf2-hide-column-where-02",
  "rf2-hide-column-where-03",
  "rf2-hide-column-where-04",
  "rf2-hide-column-where-06",
  "rf2-hide-column-where-08",
  "rf2-count-then-group-07",
  "rf2-count-then-group-08",
];

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
  // A column holds one total at a time (operation set spec, 5.4), so the order of a totals list can't change the view.
  const totalsAsASet = (op: unknown) => {
    const { aggregations } = op as { aggregations?: unknown[] };
    return type(op) === "aggregation.set" && Array.isArray(aggregations)
      ? { ...(op as object), aggregations: [...aggregations].sort((a, b) => canonical(a).localeCompare(canonical(b))) }
      : op;
  };
  const byKind = (ops: readonly unknown[]) => {
    const kinds = new Map<string, unknown[]>();
    for (const op of ops.map(totalsAsASet)) kinds.set(kind(op), [...(kinds.get(kind(op)) ?? []), op]);
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
  const choices = (plan.clarifications[0]?.options ?? []).map((o) => o.label);
  if (c.expect.clarificationChoices && !isDeepStrictEqual(choices, c.expect.clarificationChoices)) return "mismatch";
  return status === "unsupported" ? "rejected" : "safe_abstention";
};

/** How `runCase` runs a case beyond what the case says. */
export interface RunOptions {
  /**
   * Runs the case at the fixed clock with the fixed Calendar of `evals/clock.ts` on its schema, whatever schema that is,
   * as a case that says `"clock": true` runs. For the check that a Calendar changes nothing old (`evals/calendar.test.ts`).
   */
  calendar?: boolean;
  /**
   * The Grid Adapter the case runs on: the Rows Adapter (the default, which every label was written for), or the
   * TanStack Table adapter over a real TanStack Table (`tanStackAdapterFor`). For the TanStack run (operation set spec,
   * section 10).
   */
  adapter?: EvalAdapter;
}

/** The two Grid Adapters a case can run on. */
export type EvalAdapter = "rows" | "tanstack";

/** The `renders` names the Rows Adapter takes. A case's other names are left out when its adapter is built. */
type RowsAdapterRenders = NonNullable<Parameters<typeof createRowsAdapter>[0]["renders"]>[number];
const ROWS_ADAPTER_RENDERS: readonly RowsAdapterRenders[] = ["pinning", "density", "totals"];
const takenByRowsAdapter = (name: string): name is RowsAdapterRenders => (ROWS_ADAPTER_RENDERS as readonly string[]).includes(name);

/** The TanStack Tables the TanStack run builds: the one way the tests build one, with the built package's pieces. */
const buildTable = tanStackTables({
  gridcueCountFeature,
  gridcueCountRowModel,
  gridcueFilterFn,
  gridcueAggregationFn,
  gridcueAggregationValue,
});
/** Each fixture's rows, made once. The eval-only schemas have none: a case judges the plan, not the rows. */
const FIXTURE_ROWS = { wealth: generateAccounts(), ledger: generateLedger() } as const;

/**
 * The TanStack Table adapter a case runs on in the TanStack run: a real TanStack Table over its fixture's rows, with
 * the case's schema and starting view, and the case's `renders` plus `"count"`. The Rows Adapter keeps a count with no
 * option, and every label was written for a grid that does, so the TanStack table registers GridCue's count piece and
 * names it. A default view other than every column in order (the wealth fixture hides Tax ID) is the table's own
 * `initialState`, so a reset goes back to the same view on both adapters; it throws when the two differ.
 */
export const tanStackAdapterFor = (c: Pick<EvalCase, "schema" | "renders">, schema: ViewSchema, initialState?: ViewState): GridAdapter => {
  const rows =
    c.schema === "ledger" ? FIXTURE_ROWS.ledger : c.schema === undefined || c.schema === "wealth-measure" ? FIXTURE_ROWS.wealth : [];
  const start = initialState
    ? { columnVisibility: Object.fromEntries(initialState.columnOrder.map((id) => [id, initialState.visibleColumnIds.includes(id)])) }
    : undefined;
  const table = buildTable<TanStackTableLike>(rows, schema, start);
  const adapter = createTanStackAdapter({ schema, table, renders: [...(c.renders ?? []), "count"] });
  const want = initialState ?? emptyViewState(schema.columns.map((col) => col.id));
  if (!isDeepStrictEqual(adapter.getDefaultState(), want)) {
    throw new Error(`The TanStack table's default view is not the Rows Adapter's: ${JSON.stringify(adapter.getDefaultState())}`);
  }
  return adapter;
};

/**
 * Runs one case. `make` is the Controller's constructor: the built package's, unless a test passes the package
 * source's to look inside the compiler.
 */
export const runCase = async (
  c: EvalCase,
  provider: IntentProvider,
  make: typeof createGridCue = createGridCue,
  options: RunOptions = {},
) => {
  // A case with terms runs on its fixture's schema with the fixture's House Terms declared; it throws for a schema that
  // declares none.
  const terms = houseTermsFor(c) !== undefined;
  // A case with a clock runs at the fixed instant, on its schema with the fixed Calendar; it throws for a schema other
  // than the ledger's. A case without the field runs with no Calendar and the default clock, as before, unless the
  // caller sets the Calendar for every case (`options.calendar`).
  const clock = clockFor(c) ?? (options.calendar ? { now: evalNow, calendar: EVAL_CALENDAR } : undefined);
  // A case's state is the view the User is looking at. The default view, which a reset returns to, stays the fixture's.
  const schema = clock || terms ? schemaOf(c.schema, terms, !!clock) : undefined;
  // A case with `renders` runs on a Rows Adapter that lists what it names; a case without it, on one that lists none of
  // `columns.pin`, `density.set` and `aggregation.set`, as before.
  const renders = c.renders ? { renders: c.renders.filter(takenByRowsAdapter) } : {};
  const [caseSchema, initialState]: [ViewSchema, ViewState | undefined] =
    c.schema === "dated" || c.schema === "group-names" || c.schema === "form-words" || c.schema === "total-names"
      ? [schema ?? schemaOf(c.schema, false, false), undefined]
      : c.schema === "wealth-measure"
        ? [schema ?? schemaOf(c.schema, false, false), wealthInitialState]
        : c.schema === "ledger"
          ? [schema ?? ledgerSchema, ledgerInitialState]
          : [schema ?? wealthSchema, wealthInitialState];
  let grid: GridAdapter;
  if (options.adapter === "tanstack") {
    grid = tanStackAdapterFor(c, caseSchema, initialState);
    // The case's view, written through the adapter before the Controller exists, as the Rows Adapter's `setState` does.
    if (c.state) {
      const written = await grid.restore({ revision: grid.getState().revision, state: { ...grid.getState().state, ...c.state } });
      if (!written.ok) throw new Error(`The TanStack table can't start from the case's view: ${written.code}: ${written.message}`);
    }
  } else {
    const rows = createRowsAdapter({ schema: caseSchema, ...(initialState ? { initialState } : {}), ...renders });
    if (c.state) rows.setState((view) => ({ ...view, ...c.state }));
    grid = rows;
  }
  const adapter = c.grid === "no-group" ? withoutGrouping(grid) : grid;
  const answer = c.providerAnswer;
  // A case with values reads its schema's Local Values; it throws for a schema that has none.
  const localValues = localValuesFor(c);
  const cue: GridCueController = make({
    adapter,
    provider: answer ? { resolve: async () => structuredClone(answer) } : provider,
    ...(localValues ? { localValues } : {}),
    ...(clock ? { now: clock.now } : {}),
  });
  const plan = await cue.propose(c.utterance);
  const { status, preview } = cue.getState();
  return { id: c.id, verdict: judge(c, plan, status), plan, status, preview };
};

type CaseResult = Awaited<ReturnType<typeof runCase>>;

/**
 * The sets whose labels need a live model's common sense. `pnpm eval` judges them only with `--live`, so with the Mock
 * Provider the TanStack run holds them to the Rows Adapter's result alone. On the Rows Adapter, the Mock gives 4 wrong
 * views by their labels (f-sort-with-hidden, live-how-concentrated, live-who-manages, h3-account-owner).
 */
export const LIVE_ONLY_SETS: readonly string[] = ["cases-live.jsonl", "cases-fanout.jsonl", "cases-chassis.jsonl"];

/** Every labelled set, by file name, in order. */
export const caseFiles = (): string[] =>
  readdirSync(new URL("./", import.meta.url))
    .filter((name) => /^cases.*\.jsonl$/.test(name))
    .sort();

/**
 * How a case's TanStack run differs from its Rows Adapter run, one line for each part that differs: the verdict, the
 * status, the plan's operations (generated IDs dropped), the questions and their choices, what is refused, and the
 * Preview. Empty when the two are the same.
 */
export const differences = (rows: CaseResult, tanstack: CaseResult): string[] => {
  const show = (v: unknown) => JSON.stringify(v) ?? "none";
  const parts: Array<[string, unknown, unknown]> = [
    ["verdict", rows.verdict, tanstack.verdict],
    ["status", rows.status, tanstack.status],
    ["operations", stripIds(rows.plan?.operations ?? []), stripIds(tanstack.plan?.operations ?? [])],
    [
      "questions",
      (rows.plan?.clarifications ?? []).map((q) => [q.prompt, ...(q.options ?? []).map((o) => o.label)]),
      (tanstack.plan?.clarifications ?? []).map((q) => [q.prompt, ...(q.options ?? []).map((o) => o.label)]),
    ],
    ["refused", rows.plan?.unsupportedSegments ?? [], tanstack.plan?.unsupportedSegments ?? []],
    ["preview", rows.preview, tanstack.preview],
  ];
  return parts
    .filter(([, a, b]) => !isDeepStrictEqual(a, b))
    .map(([part, a, b]) => `${part}: ${show(a)} on the Rows Adapter, ${show(b)} on TanStack`);
};

/**
 * Runs a case on the Rows Adapter and on the TanStack Table adapter (operation set spec, section 10), with the same
 * schema, starting view, House Terms, Local Values, clock, provider and Controller. `tanstack` is judged with the same
 * labels; `why` lists every part of its result that differs from the Rows Adapter's. A TanStack table that can't start
 * from the case's view is a difference too, with no TanStack result.
 */
export const runOnTanStack = async (c: EvalCase, provider: IntentProvider, options: Omit<RunOptions, "adapter"> = {}) => {
  const rows = await runCase(c, provider, createGridCue, options);
  try {
    const tanstack = await runCase(c, provider, createGridCue, { ...options, adapter: "tanstack" });
    const why = differences(rows, tanstack);
    return { id: c.id, same: why.length === 0, why, rows, tanstack };
  } catch (error) {
    return { id: c.id, same: false, why: [error instanceof Error ? error.message : String(error)], rows, tanstack: undefined };
  }
};

/** "group", "grouped", "grouping", "ungroup", in any case. */
const GROUPING_WORD = /\b(?:un)?group/i;

/**
 * An existing case, moved to a grid without `group.set`, with its expected result derived (more grids spec, 10).
 * A case whose expected plan groups, or clears the grouping, must end not applied. So must a question or refusal
 * whose words name grouping, since its labelled prompt may now say the grid can't group. Every other case keeps its
 * label, and must keep the verdict it has on the Rows Adapter. A case that starts grouped is left out: a grid that
 * can't group never holds a grouping. So is a case with a scripted provider answer: it was written for the candidates
 * of a grid that can group. Returns `undefined` for those. A question labelled with a choice that ranks groups by a
 * total ("Rank households by total Market value", operation set spec, 5.4) is expected without that choice: it groups,
 * so a grid that can't group doesn't offer it.
 */
export const onGridWithoutGrouping = (c: EvalCase): { case: EvalCase; groups: boolean } | undefined => {
  if (c.grid || c.providerAnswer || (c.state?.groupBy?.length ?? 0) > 0) return undefined;
  const groups =
    (c.expect.operations ?? []).some((op) => (op as { type: string }).type === "group.set") ||
    (c.expect.status !== "ready" && GROUPING_WORD.test(c.utterance));
  const choices = c.expect.clarificationChoices;
  const expect = groups
    ? { mustNotBeReady: true, neverApplies: "group.set" }
    : choices?.some((label) => TOTALS_CHOICE.test(label))
      ? { ...c.expect, clarificationChoices: choices.filter((label) => !TOTALS_CHOICE.test(label)) }
      : c.expect;
  return { case: { ...c, grid: "no-group", expect }, groups };
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

/** The one question a grid asks for a change its Host's table doesn't draw (operation set spec, 4.2 and 5.3; D3). */
export const CANT_PROMPTS = {
  "columns.pin": "This grid can't pin columns.",
  "density.set": "This grid can't change its density.",
  "aggregation.set": "This grid can't show totals.",
} as const;

/** A question only a grid that shows totals asks: "Concentration can't be totalled. Show its average instead?" */
const TOTALS_QUESTION = /can't be totalled\./;
/** A choice only a grid that shows totals offers: "Rank households by total Market value" (operation set spec, 5.4). */
const TOTALS_CHOICE = /^Rank .+ by (?:total|average) /;

/**
 * A case labelled for a grid that draws pins, density or totals, moved to a grid without `renders` (operation set spec,
 * 5.3 and 5.4), with its expected result derived the way `onGridWithoutGrouping` derives grouping's. A case whose
 * expected plan holds `columns.pin`, `density.set` or `aggregation.set` must end not applied, asking only "This grid
 * can't pin columns.", "This grid can't change its density." or "This grid can't show totals.", one for each kind of
 * change it holds; nothing else in the request applies, a grouping included. So must a case labelled with a question
 * only a grid that shows totals asks ("Concentration can't be totalled. …"). A question labelled with a choice that
 * ranks by a total ("Rank households by total Market value") is expected without that choice: a request with no totals
 * form reads there as it did before totals. Every other case keeps its label, and must keep the verdict it has with
 * `renders`. A case without `renders` already runs on such a grid: returns `undefined` for it.
 */
export const onGridWithoutRenders = (c: EvalCase): { case: EvalCase; prompts: string[]; exact?: true } | undefined => {
  if (!c.renders) return undefined;
  const { renders: _renders, withoutRenders, ...moved } = c;
  // A case that says what it reads without `renders` is held to that, exactly.
  if (withoutRenders) return { case: { ...moved, expect: withoutRenders }, prompts: [], exact: true };
  const types = new Set((c.expect.operations ?? []).map((op) => (op as { type: string }).type));
  if (TOTALS_QUESTION.test(c.expect.clarificationPrompt ?? "")) types.add("aggregation.set");
  const kinds = (["columns.pin", "density.set", "aggregation.set"] as const).filter((type) => types.has(type));
  const prompts = kinds.map((type) => CANT_PROMPTS[type]);
  // Any ready plan is a wrong view here; whether it asks the right question is checked apart, by `runWithoutRenders`.
  const choices = c.expect.clarificationChoices;
  const expect = kinds[0]
    ? { mustNotBeReady: true, neverApplies: kinds[0] }
    : choices?.some((label) => TOTALS_CHOICE.test(label))
      ? { ...c.expect, clarificationChoices: choices.filter((label) => !TOTALS_CHOICE.test(label)) }
      : c.expect;
  return { case: { ...moved, expect }, prompts };
};

/**
 * Runs a case labelled for a grid that draws pins, density or totals, with its `renders` and without. A case whose
 * expected plan pins, sets the density or shows totals passes when, without `renders`, nothing applies and every
 * question it asks is one of its "This grid can't …" questions, with no choices. One labelled `alsoAcceptsAsk` that
 * already asked with `renders` also passes when it still asks without. A case that says what it reads without
 * `renders` (`withoutRenders`) passes when it reads exactly that. Any other case passes when its verdict is the same on
 * both grids.
 */
export const runWithoutRenders = async (c: EvalCase, provider: IntentProvider) => {
  const moved = onGridWithoutRenders(c);
  if (!moved) return undefined;
  const before = await runCase(c, provider);
  const after = await runCase(moved.case, provider);
  const asked = after.plan?.clarifications ?? [];
  const cant =
    after.status === "needs_clarification" &&
    (after.plan?.unsupportedSegments.length ?? 0) === 0 &&
    asked.length > 0 &&
    asked.every((q) => moved.prompts.includes(q.prompt) && (q.options?.length ?? 0) === 0);
  const pass =
    moved.prompts.length > 0
      ? cant || (!!c.alsoAcceptsAsk && before.status !== "ready" && after.status !== "ready")
      : moved.exact
        ? after.verdict === "exact"
        : after.verdict === before.verdict;
  return { id: c.id, needsRenders: moved.prompts.length > 0, cant, pass, before, after };
};

// The totals held-out round 3 cases on a grid without `renders`. Seven ledger requests are ready there, each with the
// plan the code before this work gave: on a grid that draws no totals, "total" and "sum" can only be the Host's names
// for Amount, and a Host that never set `renders` sees no change. Two of the seven drop a column named right after
// another ("sort by value descending and total units"), an older wrong view the order plan lists (12 A).
const TOTALS_R3_AS_BEFORE: Record<string, unknown[]> = {
  "tt3-e-07": [{ type: "group.set", columnIds: ["category", "amount"] }],
  "tt3-e-13": [{ type: "group.set", columnIds: ["amount"] }],
  "tt3-e-15": [
    {
      type: "sort.set",
      sorts: [
        { columnId: "amount", direction: "desc" },
        { columnId: "units", direction: "desc" },
      ],
    },
  ],
  "tt3-e-19": [{ type: "columns.hide", columnIds: ["amount", "units"] }],
  "tt3-e-20": [{ type: "sort.set", sorts: [{ columnId: "amount", direction: "desc" }] }],
  "tt3-e-21": [{ type: "columns.hide", columnIds: ["amount"] }],
  "tt3-e-22": [{ type: "group.set", columnIds: ["owner", "amount"] }],
};

/** The totals held-out sets of round 1, whose cases pass without `renders` when they ask there too. */
const TOTALS_R1_HELD_OUT = ["cases-totals-heldout.jsonl", "cases-totals-ranked-heldout.jsonl", "cases-totals-natural-heldout.jsonl"];

/**
 * Whether a case of `file`, run by `runWithoutRenders`, passes on a grid without `renders`. `evals.test.ts` and
 * `--grid=no-renders` both judge by this, so the mode fails exactly when the test does. A case passes by
 * `runWithoutRenders`' rule, except in the totals held-out sets: in round 1 a case that missed with `renders` also
 * passes when it isn't ready without; in round 3 any case that isn't ready without passes, and the seven in
 * `TOTALS_R3_AS_BEFORE` must be ready with exactly that plan.
 */
export const passesWithoutRenders = (
  file: string,
  result: {
    id: string;
    pass: boolean;
    before: { verdict: Verdict };
    after: { status: string; plan: { operations: readonly unknown[] } | null };
  },
): boolean => {
  if (file === "cases-totals-heldout-r3.jsonl") {
    const asBefore = TOTALS_R3_AS_BEFORE[result.id];
    if (asBefore) return result.after.status === "ready" && isDeepStrictEqual(result.after.plan?.operations, asBefore);
    return result.pass || result.after.status !== "ready";
  }
  if (TOTALS_R1_HELD_OUT.includes(file)) {
    return result.pass || (result.before.verdict === "mismatch" && result.after.status !== "ready");
  }
  return result.pass;
};
