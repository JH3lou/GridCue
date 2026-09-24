import type { Literal, NormalizedInput } from "./normalize";
import type { RestrictedMention } from "./policy";
import {
  type Clarification,
  type ColumnDescriptor,
  type ColumnKind,
  type DecisionEvidence,
  type FilterPredicate,
  PROTOCOL_VERSION,
  type UnsupportedCategory,
  type ViewOperation,
  type ViewPlan,
  type ViewSchema,
  type ViewState,
} from "./protocol";
import {
  type ClauseResolution,
  COLUMN_FAMILIES,
  type Pick,
  type ResolutionResult,
  UNSUPPORTED_FAMILIES,
  VIEW_FAMILIES,
  type ViewFamily,
} from "./resolution";
import { isExposed, operatorsFor } from "./schema";

export interface ConfidencePolicy {
  /** At or above this, a decision is used as-is. Default 0.85. */
  ready: number;
  /** Below this, a decision is discarded. Between the two, GridCue asks. Default 0.65. */
  clarify: number;
}
export const DEFAULT_CONFIDENCE: ConfidencePolicy = { ready: 0.85, clarify: 0.65 };

export interface CompileInput {
  input: NormalizedInput;
  resolution: ResolutionResult;
  schema: ViewSchema;
  state: ViewState;
  baseRevision: string;
  channel: ViewPlan["source"]["channel"];
  text?: string;
  restricted?: RestrictedMention[];
  /** Answers to earlier clarifications, keyed by clarification ID. */
  answers?: Record<string, string>;
  confidence?: ConfidencePolicy;
  newId: (prefix: string) => string;
}

const LITERAL_KINDS: Record<Literal["kind"], ColumnKind[]> = {
  number: ["number", "currency", "percent"],
  currency: ["currency", "number"],
  percent: ["percent"],
  date: ["date", "datetime"],
  text: ["string"],
  unreadable: [],
};

const COLUMN_WORD: Record<string, string> = {
  sort: "sorted by",
  group: "grouped by",
  "columns.hide": "hidden",
  "columns.show": "shown",
  "columns.only": "kept",
};

const FAMILY_PHRASE: Record<string, string> = {
  filter: "filter the rows",
  sort: "sort the rows",
  group: "group the rows",
  "columns.show": "show some columns",
  "columns.hide": "hide some columns",
  "columns.only": "show only some columns",
  "filter.clear": "clear the filters",
  "sort.clear": "clear the sort",
  "group.clear": "clear the grouping",
  "view.reset": "reset the view",
  "unsupported.data_mutation": "edit the data",
  "unsupported.workflow_action": "run a workflow action",
  "unsupported.navigation": "navigate somewhere else",
  "unsupported.export": "export the data",
};

const isView = (f: string): f is ViewFamily => !f.startsWith("unsupported.");
const KNOWN_FAMILY_IDS: ReadonlySet<string> = new Set([...VIEW_FAMILIES, ...UNSUPPORTED_FAMILIES]);

/** Turns provider picks and parsed literals into a View Plan. Deterministic; never guesses. */
export const compile = (c: CompileInput): ViewPlan => {
  const bands = c.confidence ?? DEFAULT_CONFIDENCE;
  const answers = c.answers ?? {};
  const operations: ViewOperation[] = [];
  const evidence: DecisionEvidence[] = [];
  const clarifications: Clarification[] = [];
  const unsupportedSegments: ViewPlan["unsupportedSegments"] = [];
  const confidences: number[] = [];
  const column = (id: string) => c.schema.columns.find((col) => col.id === id && isExposed(col));
  const optionsFor = (kinds: ColumnKind[] | null, capability: string) =>
    c.schema.columns
      .filter((col) => isExposed(col) && col.capabilities.includes(capability as never) && (!kinds || kinds.includes(col.kind)))
      .map((col) => ({ id: col.id, label: col.label }));
  const note = (key: string, selectedId: string, confidence: number, source: DecisionEvidence["source"]) => {
    evidence.push({ key, selectedId, confidence, source });
    confidences.push(confidence);
  };

  for (const mention of c.restricted ?? []) {
    unsupportedSegments.push({ category: "restricted_column" });
    evidence.push({ key: `c${mention.clauseIndex}.restricted`, selectedId: mention.columnId, source: "host" });
  }

  if (unsupportedSegments.length === 0) {
    for (const clause of c.input.clauses) {
      const key = `c${clause.index}`;
      const res: ClauseResolution = c.resolution.clauses.find((r) => r.clauseIndex === clause.index) ?? {
        clauseIndex: clause.index,
        families: [],
        columns: [],
        values: [],
        unmatchedTerms: [],
      };
      // Family picks: confident ones are used, middling ones are confirmed, weak ones are dropped.
      let familyPending = false;
      const families: Pick[] = [];
      for (const f of res.families) {
        if (!KNOWN_FAMILY_IDS.has(f.id)) continue;
        const answerKey = `${key}.family.${f.id}`;
        if (answers[answerKey] !== undefined) {
          if (answers[answerKey] === f.id) {
            families.push(f);
            note(answerKey, f.id, 1, "user");
          }
        } else if (f.confidence >= bands.ready || (!isView(f.id) && f.confidence >= bands.clarify)) {
          // An unsupported action is refused, not confirmed: asking "did you want to edit the data?" invites a yes that is refused anyway.
          families.push(f);
          note(`${key}.family`, f.id, f.confidence, "provider");
        } else if (f.confidence >= bands.clarify) {
          clarifications.push({
            id: answerKey,
            prompt: `Did you want to ${FAMILY_PHRASE[f.id] ?? "change the view"}?`,
            options: [
              { id: f.id, label: "Yes" },
              { id: "none", label: "No" },
            ],
            required: true,
          });
          familyPending = true;
        }
      }

      const blocked = families.filter((f) => !isView(f.id));
      for (const f of blocked) {
        unsupportedSegments.push({ text: clause.text, category: f.id.replace("unsupported.", "") as UnsupportedCategory });
      }
      const viewFamilies = families.filter((f) => isView(f.id)).map((f) => f.id as ViewFamily);
      if (blocked.length > 0) continue;
      if (viewFamilies.length === 0) {
        if (!familyPending) {
          clarifications.push({
            id: `${key}.family`,
            prompt: `I'm not sure what to change for “${clause.text}”. Try asking to filter, sort, group, or show or hide columns.`,
            required: true,
          });
        }
        continue;
      }
      if (viewFamilies.filter((f) => COLUMN_FAMILIES[f]).length > 1) {
        clarifications.push({
          id: `${key}.family`,
          prompt: `“${clause.text}” asks for more than one kind of change. Split it into separate steps.`,
          required: true,
        });
        continue;
      }

      // Column picks: confident ones are used, middling ones are confirmed, weak ones are dropped.
      const picked: ColumnDescriptor[] = [];
      for (const p of res.columns) {
        const answerKey = `${key}.column.${p.id}`;
        const col = column(p.id);
        if (!col) continue;
        if (answers[answerKey] !== undefined) {
          if (answers[answerKey] === p.id) {
            picked.push(col);
            note(answerKey, p.id, 1, "user");
          }
        } else if (p.confidence >= bands.ready) {
          picked.push(col);
          note(`${key}.column`, p.id, p.confidence, "provider");
        } else if (p.confidence >= bands.clarify) {
          clarifications.push({
            id: answerKey,
            prompt: `Did you mean ${col.label}?`,
            options: [
              { id: col.id, label: `Yes, ${col.label}` },
              { id: "none", label: "No" },
            ],
            required: true,
          });
        }
      }

      for (const family of viewFamilies) {
        if (family === "filter.clear") operations.push({ type: "filter.clear" });
        else if (family === "sort.clear") operations.push({ type: "sort.set", sorts: [] });
        else if (family === "group.clear") operations.push({ type: "group.set", columnIds: [] });
        else if (family === "view.reset") operations.push({ type: "view.reset" });
        else if (family === "filter") {
          const predicates: FilterPredicate[] = [];
          const pred = (columnId: string, operator: FilterPredicate["operator"], value?: FilterPredicate["value"]) =>
            predicates.push({ id: c.newId("filter"), type: "predicate", columnId, operator, ...(value === undefined ? {} : { value }) });
          const byColumn = new Map<string, string[]>();
          for (const v of res.values) {
            const col = column(v.columnId);
            if (!col) continue;
            const isBoolean = col.kind === "boolean";
            const valueLabel = isBoolean
              ? v.valueId === "true"
                ? "Yes"
                : v.valueId === "false"
                  ? "No"
                  : undefined
              : col.enumValues?.find((e) => e.id === v.valueId)?.label;
            if (valueLabel === undefined) continue;
            const use = (confidence: number, source: DecisionEvidence["source"], noteKey: string) => {
              if (isBoolean) pred(col.id, "eq", v.valueId === "true");
              else byColumn.set(col.id, [...(byColumn.get(col.id) ?? []), v.valueId]);
              note(noteKey, v.valueId, confidence, source);
            };
            const answerKey = `${key}.value.${col.id}.${v.valueId}`;
            if (answers[answerKey] !== undefined) {
              if (answers[answerKey] === v.valueId) use(1, "user", answerKey);
            } else if (v.confidence >= bands.ready) {
              use(v.confidence, "provider", `${key}.value.${col.id}`);
            } else if (v.confidence >= bands.clarify) {
              clarifications.push({
                id: answerKey,
                prompt: `Did you mean ${col.label}: ${valueLabel}?`,
                options: [
                  { id: v.valueId, label: `Yes, ${valueLabel}` },
                  { id: "none", label: "No" },
                ],
                required: true,
              });
            }
          }
          for (const [id, ids] of byColumn) {
            if (ids.length === 1) pred(id, "eq", ids[0]);
            else pred(id, "in", ids);
          }
          const used = new Set<string>();
          clause.literals.forEach((lit, j) => {
            if (lit.kind === "unreadable") {
              clarifications.push({
                id: `${key}.literal${j}.number`,
                prompt: `I couldn't read “${lit.value}” as a number. Write it like 1,000,000 or $1M.`,
                required: true,
              });
              return;
            }
            const answerKey = `${key}.literal${j}.column`;
            const fits = LITERAL_KINDS[lit.kind];
            const answered = answers[answerKey] ? column(answers[answerKey]) : undefined;
            const target = answered ?? picked.find((col) => fits.includes(col.kind) && !used.has(col.id));
            const operator = lit.kind === "text" ? "contains" : (lit.comparator ?? "eq");
            if (!target || !operatorsFor(target).includes(operator)) {
              clarifications.push({
                id: answerKey,
                prompt: `Which column should be ${describeLiteral(lit)}?`,
                options: optionsFor(fits, "filter"),
                required: true,
              });
              return;
            }
            used.add(target.id);
            if (answered) note(answerKey, target.id, 1, "user");
            note(`${key}.literal${j}`, String(lit.value), 1, "deterministic");
            pred(target.id, operator, operator === "between" ? { min: lit.value, max: lit.upper ?? lit.value } : lit.value);
          });
          if (predicates.length === 0 && !clarifications.some((q) => q.id.startsWith(key))) {
            clarifications.push({
              id: `${key}.value`,
              prompt: `What should “${clause.text}” filter on? Include a value, such as an amount or a category.`,
              required: true,
            });
          }
          for (const predicate of predicates) operations.push({ type: "filter.add", predicate, combineWith: "and" });
        } else {
          const capability = COLUMN_FAMILIES[family]?.[0] ?? "show";
          const answerKey = `${key}.${family}.column`;
          const answered = answers[answerKey] ? column(answers[answerKey]) : undefined;
          const cols = (answered ? [answered] : picked).filter((col) =>
            COLUMN_FAMILIES[family]?.every((cap) => col.capabilities.includes(cap)),
          );
          if (answered) note(answerKey, answered.id, 1, "user");
          if (cols.length === 0) {
            const unknown = res.unmatchedTerms[0];
            clarifications.push({
              id: answerKey,
              prompt: unknown
                ? `There's no column called “${unknown}”. Which column should be ${COLUMN_WORD[family]}?`
                : `Which column should be ${COLUMN_WORD[family]}?`,
              options: optionsFor(null, capability),
              required: true,
            });
            continue;
          }
          const ids = cols.map((col) => col.id);
          if (family === "sort") {
            const direction =
              clause.direction ?? (res.direction && res.direction.confidence >= bands.ready ? (res.direction.id as "asc" | "desc") : "asc");
            operations.push({ type: "sort.set", sorts: ids.map((columnId) => ({ columnId, direction })) });
          } else if (family === "group") operations.push({ type: "group.set", columnIds: ids });
          else if (family === "columns.hide") operations.push({ type: "columns.hide", columnIds: ids });
          else if (family === "columns.show") operations.push({ type: "columns.show", columnIds: ids });
          else if (family === "columns.only") {
            const hideable = (id: string) => column(id)?.capabilities.includes("hide") ?? false;
            const others = c.state.visibleColumnIds.filter((id) => !ids.includes(id) && hideable(id));
            operations.push({ type: "columns.show", columnIds: ids });
            if (others.length > 0) operations.push({ type: "columns.hide", columnIds: others });
            operations.push({ type: "columns.order", columnIds: ids });
          }
        }
      }
    }
  }

  const status: ViewPlan["status"] =
    unsupportedSegments.length > 0 ? "unsupported" : clarifications.length > 0 || operations.length === 0 ? "needs_clarification" : "ready";
  if (status === "needs_clarification" && clarifications.length === 0) {
    clarifications.push({
      id: "plan.empty",
      prompt: "That request doesn't change the view. Try filtering, sorting, grouping, or showing or hiding columns.",
      required: true,
    });
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: c.newId("plan"),
    baseRevision: c.baseRevision,
    source: { channel: c.channel, ...(c.text === undefined ? {} : { text: c.text }) },
    status,
    operations: status === "ready" || status === "unsupported" ? operations : [],
    ...(confidences.length > 0 ? { confidence: Math.min(...confidences) } : {}),
    evidence,
    clarifications,
    unsupportedSegments,
  };
};

const describeLiteral = (lit: Literal): string => {
  const words: Record<string, string> = { gt: "above", gte: "at least", lt: "below", lte: "at most", eq: "equal to", between: "between" };
  const show = (v: number | string) =>
    lit.kind === "currency" && typeof v === "number"
      ? `$${v.toLocaleString("en-US")}`
      : lit.kind === "percent" && typeof v === "number"
        ? `${Math.round(v * 1000) / 10}%`
        : String(v);
  if (lit.comparator === "between") return `between ${show(lit.value)} and ${show(lit.upper ?? lit.value)}`;
  return `${words[lit.comparator ?? "eq"] ?? ""} ${show(lit.value)}`.trim();
};
