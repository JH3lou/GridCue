import { ADJACENT_COMPARISON } from "../core/compile";
import { governedClears, LEAD_IN, leavesRowsOut, viewRequest } from "../core/lead";
import { LITERAL_COLUMN_KINDS, matchMentions } from "../core/mentions";
import { unquoted } from "../core/normalize";
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

const NEGATION = /\b(?:without|no|not|non|excluding)[\s-]+(?:any\s+)?$/;
/** A column named directly after one of these gets that role (fan-out spec, 5.3). */
const ROLE_BEFORE: Array<[RegExp, string]> = [
  [/\b(?:sort(?:ed)?|order(?:ed)?)\s+by\s+(?:the\s+)?$/, "sort"],
  [/\bgroup(?:ed)?\s+by\s+(?:the\s+)?$/, "group"],
  [/\bhide\s+(?:the\s+)?$/, "columns.hide"],
  [/\bshow\s+(?:the\s+)?$/, "columns.show"],
];
const ADDS = /\b(?:also|too|as well)\b/;

const pick = (id: string, confidence: number): Pick => ({ id, confidence });

type Hit = ReturnType<typeof matchMentions>[number];
/** What joins the names of one column list: "advisor, custodian and restricted holdings". */
const LIST_GAP = /^\s*(?:(?:,|&|(?:and|or|the)\b)\s*)*$/;
/** The words after a name that make it describe rows: "restricted accounts", "restricted rows", "the restricted ones". */
const ROW_WORDS = new Map<string, { after: RegExp; end: RegExp; any: RegExp }>();
/** Row-word patterns for a row noun, built once per noun rather than once per request. */
const rowWords = (rowNoun: string | undefined) => {
  const key = rowNoun ?? "";
  let found = ROW_WORDS.get(key);
  if (!found) {
    const words = `rows?|ones?|records?${rowNoun ? `|${rowNoun.replace(/[^\p{L}\p{N} ]/gu, "")}s?` : ""}`;
    found = {
      after: new RegExp(`^\\s*(?:${words})\\b`, "u"),
      end: new RegExp(`^\\s*(?:${words})\\b[\\s,.;!?]*$`, "u"),
      any: new RegExp(`\\b(?:${words})\\b`, "u"),
    };
    ROW_WORDS.set(key, found);
  }
  return found;
};
const HIDE_BEFORE = /\b(?:hide|unhide)\s+(?:the\s+)?$/;

/**
 * Where a column name sits in a list of columns: the list ends with "column(s)", follows "columns:", or starts right
 * after "hide" with no row word after it. "Show restricted accounts" and "hide restricted accounts" are no lists, so
 * their yes/no column still reads as a value.
 */
const listOf = (text: string, hit: Hit, hits: readonly Hit[]) => {
  const sorted = [...hits].sort((a, b) => a.start - b.start);
  let first = sorted.indexOf(hit);
  let last = first;
  while (first > 0 && LIST_GAP.test(text.slice(sorted[first - 1]?.end ?? 0, sorted[first]?.start ?? 0))) first--;
  while (last < sorted.length - 1 && LIST_GAP.test(text.slice(sorted[last]?.end ?? 0, sorted[last + 1]?.start ?? 0))) last++;
  return { before: text.slice(0, sorted[first]?.start ?? 0), after: text.slice(sorted[last]?.end ?? 0) };
};
const inColumnList = (text: string, hit: Hit, hits: readonly Hit[]): boolean => {
  const { before, after } = listOf(text, hit, hits);
  if (/^\s*columns?\b/.test(after) || /\bcolumns?\s*:?\s*$/.test(before)) return true;
  // "Hide restricted", "hide restricted and custodian": a list right after "hide" that ends the part.
  return HIDE_BEFORE.test(before) && /^[\s,.;!?]*$/.test(after);
};

const detectFamilies = (clause: Clause, hasValues: boolean, excludesRows = false): string[] => {
  const t = clause.text;
  const clears: string[] = [];
  // A clear applies only to what its verb governs: "ungroup, don't touch the sort" clears the grouping alone.
  const { governed } = governedClears(t);
  if (governed.has("filter")) clears.push("filter.clear");
  if (governed.has("sort")) clears.push("sort.clear");
  if (governed.has("group")) clears.push("group.clear");
  if (governed.has("view")) clears.push("view.reset");
  if (clears.length > 0) return clears;
  if (excludesRows) return ["filter"];
  if (/\bgroup(?:ed)?\b/.test(t)) return ["group"];
  if (/\b(?:sort|order)(?:ed)?\b/.test(t)) return ["sort"];
  if (/\bhide\b/.test(t)) return ["columns.hide"];
  // A direction alone ("biggest first") is a sort, but only after the explicit verbs: "hide custodian, high to low"
  // hides, and core asks about the sort (it never drops one).
  if (clause.direction && !hasValues) return ["sort"];
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
        // Quoted text is a value as written, never an instruction: `advisor containing "group by rep"`.
        const text = unquoted(clause.text);
        // The Mock reads names with core's deterministic matcher, context rules included (ADR 0013).
        const rowNoun = request.candidates.rowNoun?.toLowerCase();
        const mentions = matchMentions([clause], columns, { rowNoun });
        // Words inside a declared name are part of the name, never a verb: "hide advisor group" (a column "Advisor
        // Group") hides it.
        const plain = mentions.reduce((t, m) => t.slice(0, m.start) + " ".repeat(m.end - m.start) + t.slice(m.end), text);
        const unsupported = UNSUPPORTED.find(([re]) => re.test(plain));
        if (unsupported) return { ...empty, families: [pick(unsupported[1], 0.95)] };
        const starts = new Set([...mentions.map((m) => m.start), ...clause.literals.map((l) => l.at)]);
        const columnStarts = new Set(mentions.filter((m) => m.valueId === undefined && !m.ambiguous).map((m) => m.start));
        const names = columns.flatMap((c) => [c.label, ...(c.aliases ?? [])]).map((n) => n.toLowerCase());
        if (!viewRequest(text, starts, rowNoun, columnStarts, names)) return empty;

        const byId = new Map(columns.map((c) => [c.id, c]));
        const valueHits = mentions.filter((m) => m.valueId !== undefined);
        const columnHits = mentions.filter((m) => m.valueId === undefined);
        // A yes/no column in a column list ("the advisor and restricted holdings columns", "hide the restricted
        // column") names the column, not its value.
        const booleanHits = columnHits.filter((m) => byId.get(m.columnId)?.kind === "boolean" && !inColumnList(text, m, columnHits));
        // "Hide restricted accounts" hides those rows: it keeps the others. Only that exact shape is read: a row word
        // right after the name ends the part, and nothing else is named. "Hide restricted households", "hide
        // restricted accounts at Northgate" and "unhide restricted accounts" are left unanswered.
        const hiding = booleanHits.filter((m) => HIDE_BEFORE.test(text.slice(0, m.start)));
        const rowsEnd = rowWords(rowNoun).end;
        if (hiding.some((m) => /\bunhide\s+(?:the\s+)?$/.test(text.slice(0, m.start)) || !rowsEnd.test(text.slice(m.end)))) return empty;
        if (hiding.length > 0 && (mentions.length > 1 || clause.literals.length > 0)) return empty;
        // A part that leaves rows out ("hide accounts with restricted holdings") keeps the other value of a yes/no.
        // Quoted text that is a column name ('hide "gain"') is a column, not rows to leave out.
        // "Not" and "without" right before a name are that name's own negation (`NEGATION`), so they count once.
        const leaves =
          (leavesRowsOut(plain) && !/^(?:not|no|without)\b(?! longer)/.test(plain.slice(LEAD_IN.exec(plain)?.[0].length ?? 0))) ||
          hiding.length > 0;
        const values = [
          ...valueHits.map((m) => ({ columnId: m.columnId, valueId: m.valueId ?? "", confidence: 0.95 })),
          ...booleanHits.map((m) => ({
            columnId: m.columnId,
            valueId: leaves !== NEGATION.test(text.slice(Math.max(0, m.start - 16), m.start)) ? "false" : "true",
            confidence: 0.9,
          })),
        ];
        const conditions = values.length + clause.literals.filter((l) => l.kind !== "text" || !starts.has(l.at + 1)).length;
        const excludes = leaves && conditions > 0;
        // "Hide accounts with gain", "hide unrestricted accounts": rows named, but no condition GridCue reads. Not a
        // column hide either: ask.
        // A row word read as a column ("hide the account number") is a name, not rows; one read as the rows, or left
        // ambiguous, is rows.
        const rowsText = mentions
          .filter((m) => !m.ambiguous)
          .reduce((t, m) => t.slice(0, m.start) + " ".repeat(m.end - m.start) + t.slice(m.end), text);
        if (leaves && !excludes && rowWords(rowNoun).any.test(rowsText.replace(/^.*?\b(?:hide|exclude|remove|drop)\b/, ""))) return empty;
        // "Don't show the custodian column" is no "show": with nothing to leave out of the rows, ask.
        if (leaves && !excludes && !/^(?:hide|exclude|remove|drop|filter out)\b/.test(plain.slice(LEAD_IN.exec(plain)?.[0].length ?? 0)))
          return empty;
        const families = detectFamilies({ ...clause, text: plain }, values.length > 0, excludes).filter((f) =>
          request.candidates.families.includes(f),
        );
        if (families.length === 0) return empty;

        // The grid's own row noun left ambiguous ("households sorted by …") is the rows, never the column to act on.
        const isRowNoun = (m: Hit) => !!m.ambiguous && /^ (?:sorted|ordered|grouped|sort|order|group)\b/.test(clause.text.slice(m.end));
        const picked: Pick[] = [...new Set(columnHits.filter((m) => !isRowNoun(m)).map((m) => m.columnId))].map((id) => pick(id, 0.95));
        const roles = columnHits.flatMap((m) => {
          const role = ROLE_BEFORE.find(([re]) => re.test(text.slice(0, m.start)))?.[1];
          return role ? [{ columnId: m.columnId, family: role, confidence: 0.95 }] : [];
        });
        // Each amount's column: the one named right before it ("gain over $100k"); else the one named column that fits
        // and has no other change or amount of its own; else, with none, the Host's default for its kind ("accounts
        // over $1M sorted by gain"). A name right before an amount it can't hold ("gain over 10%") gets no pick.
        const ownerOf = (lit: (typeof clause.literals)[number]) => {
          const before = columnHits
            .filter((m) => !m.ambiguous && m.end <= lit.at)
            .sort((a, b) => a.end - b.end)
            .at(-1);
          return before && ADJACENT_COMPARISON.test(clause.text.slice(before.end, lit.at)) ? before : undefined;
        };
        const owners = new Set(clause.literals.map((lit) => ownerOf(lit)?.columnId));
        const literalColumns = clause.literals.flatMap((lit, literalIndex) => {
          const fits = (m: Hit) => LITERAL_COLUMN_KINDS[lit.kind].includes(byId.get(m.columnId)?.kind ?? "string");
          const owner = ownerOf(lit);
          if (owner) return fits(owner) ? [{ literalIndex, columnId: owner.columnId, confidence: 0.9 }] : [];
          const free = [
            ...new Set(
              columnHits
                .filter((m) => fits(m) && !owners.has(m.columnId) && !roles.some((r) => r.columnId === m.columnId))
                .map((m) => m.columnId),
            ),
          ];
          if (free.length === 1) return [{ literalIndex, columnId: free[0] ?? "", confidence: 0.9 }];
          if (free.length > 1) return [];
          const fallback = options.defaultColumnForKind?.[lit.kind];
          return fallback ? [{ literalIndex, columnId: fallback, confidence: 0.9 }] : [];
        });
        if (families.includes("filter")) {
          for (const { columnId } of literalColumns) if (!picked.some((p) => p.id === columnId)) picked.push(pick(columnId, 0.9));
        }
        const needsColumns = families.some((f) => ["sort", "group", "columns.hide", "columns.show", "columns.only"].includes(f));
        const term = needsColumns && picked.length === 0 ? unknownTerm(clause.text) : undefined;
        return {
          clauseIndex: clause.index,
          families: families.map((f) => pick(f, 0.95)),
          ...(roles.length > 0 ? { roles } : {}),
          ...(literalColumns.length > 0 ? { literalColumns } : {}),
          ...(ADDS.test(text) ? { adds: 0.95 } : {}),
          columns: picked,
          values,
          unmatchedTerms: term ? [term] : [],
        };
      }),
    };
  },
});
