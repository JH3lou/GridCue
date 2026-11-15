import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { ledgerColumns, ledgerInitialState, ledgerMockOptions, ledgerSchema, ledgerSchemaOptions } from "@gridcue-internal/ledger-fixtures";
import { wealthColumns, wealthInitialState, wealthMockOptions, wealthSchema, wealthSchemaOptions } from "@gridcue-internal/wealth-fixtures";
import {
  type ColumnInput,
  createGridCue,
  createRowsAdapter,
  defineSchema,
  type GridCueController,
  type IntentProvider,
  type ResolutionResult,
  type RowsAdapter,
  type SchemaOptions,
  type ViewOperation,
  type ViewPlan,
  type ViewSchema,
  type ViewState,
} from "gridcue";
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
  state?: Partial<Pick<ViewState, "groupBy" | "sorts" | "filters" | "limit" | "pinnedColumnIds" | "visibleColumnIds" | "density">>;
  /**
   * Runs on another schema instead of the wealth fixture: "dated" for cases about dates, "group-names" for a schema
   * where "group" is part of a value and of a column's label, "form-words" for a schema whose names hold the pin and
   * density form words ("Pin code", "Compact"), "ledger" for the ledger fixture (fixtures/ledger).
   */
  schema?: "dated" | "group-names" | "form-words" | "ledger";
  /** "no-group" runs on a grid that doesn't list `group.set` (more grids spec, 5.3). */
  grid?: "no-group";
  /**
   * What the Host's table draws, as the adapter's `renders` option says it (operation set spec, 4.2): a case with it
   * runs on a Rows Adapter built with that `renders`, which lists `columns.pin` and `density.set`. A case without it
   * runs on a grid that lists neither, as before. Every pin and density case is labelled for a grid that draws both.
   * `onGridWithoutRenders` derives the same case's result on a grid without it.
   */
  renders?: Array<"pinning" | "density">;
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
const withoutGrouping = (adapter: RowsAdapter): RowsAdapter => ({
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

/** How `runCase` runs a case beyond what the case says. */
export interface RunOptions {
  /**
   * Runs the case at the fixed clock with the fixed Calendar of `evals/clock.ts` on its schema, whatever schema that is,
   * as a case that says `"clock": true` runs. For the check that a Calendar changes nothing old (`evals/calendar.test.ts`).
   */
  calendar?: boolean;
}

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
  // A case with `renders` runs on a Rows Adapter that lists what it names; a case without it, on one that lists neither
  // `columns.pin` nor `density.set`, as before.
  const renders = c.renders ? { renders: c.renders } : {};
  const rows =
    c.schema === "dated" || c.schema === "group-names" || c.schema === "form-words"
      ? createRowsAdapter({ schema: schema ?? schemaOf(c.schema, false, false), ...renders })
      : c.schema === "ledger"
        ? createRowsAdapter({ schema: schema ?? ledgerSchema, initialState: ledgerInitialState, ...renders })
        : createRowsAdapter({ schema: schema ?? wealthSchema, initialState: wealthInitialState, ...renders });
  const adapter = c.grid === "no-group" ? withoutGrouping(rows) : rows;
  if (c.state) adapter.setState((view) => ({ ...view, ...c.state }));
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

/** The one question a grid asks for a change its Host's table doesn't draw (operation set spec, 4.2 and 5.3; D3). */
export const CANT_PROMPTS = {
  "columns.pin": "This grid can't pin columns.",
  "density.set": "This grid can't change its density.",
} as const;

/**
 * A case labelled for a grid that draws pins and density, moved to a grid without `renders` (operation set spec, 5.3),
 * with its expected result derived the way `onGridWithoutGrouping` derives grouping's. A case whose expected plan holds
 * `columns.pin` or `density.set` must end not applied, asking only "This grid can't pin columns." or "This grid can't
 * change its density.", one for each kind of change it holds. Every other case keeps its label, and must keep the
 * verdict it has with `renders`. A case without `renders` already runs on such a grid: returns `undefined` for it.
 */
export const onGridWithoutRenders = (c: EvalCase): { case: EvalCase; prompts: string[]; exact?: true } | undefined => {
  if (!c.renders) return undefined;
  const { renders: _renders, withoutRenders, ...moved } = c;
  // A case that says what it reads without `renders` is held to that, exactly.
  if (withoutRenders) return { case: { ...moved, expect: withoutRenders }, prompts: [], exact: true };
  const types = new Set((c.expect.operations ?? []).map((op) => (op as { type: string }).type));
  const kinds = (["columns.pin", "density.set"] as const).filter((type) => types.has(type));
  const prompts = kinds.map((type) => CANT_PROMPTS[type]);
  // Any ready plan is a wrong view here; whether it asks the right question is checked apart, by `runWithoutRenders`.
  const expect = kinds[0] ? { mustNotBeReady: true, neverApplies: kinds[0] } : c.expect;
  return { case: { ...moved, expect }, prompts };
};

/**
 * Runs a case labelled for a grid that draws pins and density, with its `renders` and without. A case whose expected
 * plan pins or sets the density passes when, without `renders`, nothing applies and every question it asks is one of
 * its "This grid can't …" questions, with no choices. One labelled `alsoAcceptsAsk` that already asked with `renders`
 * also passes when it still asks without. A case that says what it reads without `renders` (`withoutRenders`) passes
 * when it reads exactly that. Any other case passes when its verdict is the same on both grids.
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
