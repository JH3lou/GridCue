import { LITERAL_COLUMN_KINDS, matchMentions } from "../core/mentions";
import { unknownTerm } from "../core/terms";
import type { ClauseResolution, IntentProvider, LiteralKind, Pick, ResolutionRequest, ResolutionResult } from "../index";

export interface MockProviderOptions {
  /** Which column a bare amount refers to, e.g. `{ currency: "market_value" }` for "accounts over $1 million". */
  defaultColumnForKind?: Partial<Record<LiteralKind, string>>;
}

type Clause = ResolutionRequest["clauses"][number];

const UNSUPPORTED: Array<[RegExp, string]> = [
  [/\b(?:export|download|csv|excel|print|copy)\b/, "unsupported.export"],
  [/\b(?:place|submit|execute|approve|reject|rebalance|trade|trades|sell|buy|email|send|contact|call)\b/, "unsupported.workflow_action"],
  [/\b(?:delete|edit|rename|overwrite)\b|\bupdate (?:the )?(?:values?|records?|accounts?)\b/, "unsupported.data_mutation"],
  [/\bgo to\b|\bnavigate\b|\btake me\b|\bopen (?:the |this |that )?(?:page|screen|record|profile|details?)\b/, "unsupported.navigation"],
];

const NEGATION = /\b(?:without|no|not|non|excluding)\s+(?:any\s+)?$/;
/** A column named directly after one of these gets that role (fan-out spec, 5.3). */
const ROLE_BEFORE: Array<[RegExp, string]> = [
  [/\b(?:sort(?:ed)?|order(?:ed)?)\s+by\s+(?:the\s+)?$/, "sort"],
  [/\bgroup(?:ed)?\s+by\s+(?:the\s+)?$/, "group"],
  [/\bhide\s+(?:the\s+)?$/, "columns.hide"],
  [/\bshow\s+(?:the\s+)?$/, "columns.show"],
];
const ADDS = /\b(?:also|too|as well)\b/;

const pick = (id: string, confidence: number): Pick => ({ id, confidence });

const detectFamilies = (clause: Clause, hasValues: boolean): string[] => {
  const t = clause.text;
  const clears: string[] = [];
  if (/\b(?:clear|remove|drop|reset|undo)\b/.test(t) || /\bungroup\b/.test(t)) {
    if (/\bfilter/.test(t)) clears.push("filter.clear");
    if (/\bsort/.test(t)) clears.push("sort.clear");
    if (/\bgroup/.test(t)) clears.push("group.clear");
    if (clears.length === 0 && /\breset\b/.test(t)) clears.push("view.reset");
    if (clears.length > 0) return clears;
  }
  if (/\bgroup(?:ed)?\b/.test(t)) return ["group"];
  if (/\b(?:sort|order)(?:ed)?\b/.test(t) || (clause.direction && !hasValues)) return ["sort"];
  if (/\bhide\b/.test(t)) return ["columns.hide"];
  const only = /\b(?:keep|show|display) only\b|\bonly (?:show|display|keep)\b|\bjust the\b/.test(t);
  if (hasValues || clause.literals.length > 0) return ["filter"];
  if (only) return ["columns.only"];
  if (/\b(?:show|display|include|add)\b.*\bcolumns?\b|\bunhide\b/.test(t)) return ["columns.show"];
  if (/\b(?:show|only|filter|where|with)\b/.test(t)) return ["filter"];
  return [];
};

/** A deterministic, rule-based Intent Provider for tests, demos, and keyless development. */
export const createMockProvider = (options: MockProviderOptions = {}): IntentProvider => ({
  async resolve(request: ResolutionRequest): Promise<ResolutionResult> {
    const columns = request.candidates.columns;
    return {
      clauses: request.clauses.map((clause): ClauseResolution => {
        const empty: ClauseResolution = { clauseIndex: clause.index, families: [], columns: [], values: [], unmatchedTerms: [] };
        const unsupported = UNSUPPORTED.find(([re]) => re.test(clause.text));
        if (unsupported) return { ...empty, families: [pick(unsupported[1], 0.95)] };

        // The Mock reads names with core's deterministic matcher, context rules included (ADR 0013).
        const mentions = matchMentions([clause], columns);
        const byId = new Map(columns.map((c) => [c.id, c]));
        const valueHits = mentions.filter((m) => m.valueId !== undefined);
        const columnHits = mentions.filter((m) => m.valueId === undefined);
        const booleanHits = columnHits.filter((m) => byId.get(m.columnId)?.kind === "boolean");
        const values = [
          ...valueHits.map((m) => ({ columnId: m.columnId, valueId: m.valueId ?? "", confidence: 0.95 })),
          ...booleanHits.map((m) => ({
            columnId: m.columnId,
            valueId: NEGATION.test(clause.text.slice(Math.max(0, m.start - 16), m.start)) ? "false" : "true",
            confidence: 0.9,
          })),
        ];

        const families = detectFamilies(clause, values.length > 0).filter((f) => request.candidates.families.includes(f));
        if (families.length === 0) return empty;

        const picked: Pick[] = [...new Set(columnHits.map((m) => m.columnId))].map((id) => pick(id, 0.95));
        if (families.includes("filter")) {
          for (const lit of clause.literals) {
            const fits = LITERAL_COLUMN_KINDS[lit.kind];
            const referenced = columnHits.some((m) => fits.includes(byId.get(m.columnId)?.kind ?? "string"));
            const fallback = options.defaultColumnForKind?.[lit.kind];
            if (!referenced && fallback && !picked.some((p) => p.id === fallback)) picked.push(pick(fallback, 0.9));
          }
        }
        const needsColumns = families.some((f) => ["sort", "group", "columns.hide", "columns.show", "columns.only"].includes(f));
        const term = needsColumns && picked.length === 0 ? unknownTerm(clause.text) : undefined;
        const roles = columnHits.flatMap((m) => {
          const role = ROLE_BEFORE.find(([re]) => re.test(clause.text.slice(0, m.start)))?.[1];
          return role ? [{ columnId: m.columnId, family: role, confidence: 0.95 }] : [];
        });
        return {
          clauseIndex: clause.index,
          families: families.map((f) => pick(f, 0.95)),
          ...(roles.length > 0 ? { roles } : {}),
          ...(ADDS.test(clause.text) ? { adds: 0.95 } : {}),
          columns: picked,
          values,
          unmatchedTerms: term ? [term] : [],
        };
      }),
    };
  },
});
