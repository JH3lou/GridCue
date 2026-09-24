import { findMentions } from "../core/text-match";
import type { CandidateColumn, ClauseResolution, IntentProvider, LiteralKind, Pick, ResolutionRequest, ResolutionResult } from "../index";

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
const KIND_FIT: Record<LiteralKind, CandidateColumn["kind"][]> = {
  number: ["number", "currency", "percent"],
  currency: ["currency", "number"],
  percent: ["percent"],
  date: ["date", "datetime"],
  text: ["string"],
  unreadable: [],
};

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

const remainderAfterVerb = (text: string): string =>
  text
    .replace(/^.*?\b(?:sort(?:ed)?|order(?:ed)?|group(?:ed)?|hide|show|display|filter)\b(?:\s+(?:by|on))?\s*/, "")
    .replace(/\b(?:largest|biggest|highest|smallest|lowest|newest|oldest)\b.*$|\b(?:ascending|descending|first|column|columns)\b/g, "")
    .replace(/\bthe\b/g, "")
    .trim();

/** A deterministic, rule-based Intent Provider for tests, demos, and keyless development. */
export const createMockProvider = (options: MockProviderOptions = {}): IntentProvider => ({
  async resolve(request: ResolutionRequest): Promise<ResolutionResult> {
    const columns = request.candidates.columns;
    return {
      clauses: request.clauses.map((clause): ClauseResolution => {
        const empty: ClauseResolution = { clauseIndex: clause.index, families: [], columns: [], values: [], unmatchedTerms: [] };
        const unsupported = UNSUPPORTED.find(([re]) => re.test(clause.text));
        if (unsupported) return { ...empty, families: [pick(unsupported[1], 0.95)] };

        const valueEntries = columns.flatMap((c) =>
          (c.enumValues ?? []).map((v) => ({ item: { columnId: c.id, valueId: v.id }, names: [v.label, ...(v.aliases ?? [])] })),
        );
        const valueHits = findMentions(clause.text, valueEntries);
        const masked = valueHits.reduce((t, h) => t.slice(0, h.start) + " ".repeat(h.end - h.start) + t.slice(h.end), clause.text);
        const columnHits = findMentions(
          masked,
          columns.map((c) => ({ item: c, names: [c.label, ...(c.aliases ?? [])] })),
        );
        const booleanHits = columnHits.filter((h) => h.item.kind === "boolean");
        const values = [
          ...valueHits.map((h) => ({ ...h.item, confidence: 0.95 })),
          ...booleanHits.map((h) => ({
            columnId: h.item.id,
            valueId: NEGATION.test(masked.slice(Math.max(0, h.start - 16), h.start)) ? "false" : "true",
            confidence: 0.9,
          })),
        ];

        const families = detectFamilies(clause, values.length > 0).filter((f) => request.candidates.families.includes(f));
        if (families.length === 0) return empty;

        const picked: Pick[] = columnHits.map((h) => pick(h.item.id, 0.95));
        if (families.includes("filter")) {
          for (const lit of clause.literals) {
            const fits = KIND_FIT[lit.kind];
            const referenced = columnHits.some((h) => fits.includes(h.item.kind));
            const fallback = options.defaultColumnForKind?.[lit.kind];
            if (!referenced && fallback && !picked.some((p) => p.id === fallback)) picked.push(pick(fallback, 0.9));
          }
        }
        const needsColumns = families.some((f) => ["sort", "group", "columns.hide", "columns.show", "columns.only"].includes(f));
        const unmatched = needsColumns && picked.length === 0 ? [remainderAfterVerb(clause.text)].filter(Boolean) : [];
        return {
          clauseIndex: clause.index,
          families: families.map((f) => pick(f, 0.95)),
          columns: picked,
          values,
          unmatchedTerms: unmatched,
        };
      }),
    };
  },
});
