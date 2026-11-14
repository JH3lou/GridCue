import { formatAmount } from "./format";
import { afterExclusionLead, governedClears, LEAD_IN, leavesRowsOut, viewRequest } from "./lead";
import { LEAVES_OUT, LITERAL_COLUMN_KINDS, type Mention } from "./mentions";
import {
  type Clause,
  directionSpans,
  type Literal,
  literalText,
  type NormalizedInput,
  SIZE_WORDS,
  trailingComparison,
  unquoted,
} from "./normalize";
import type { RestrictedMention } from "./policy";
import {
  type Clarification,
  type ColumnDescriptor,
  type ColumnKind,
  type DecisionEvidence,
  type FilterGroup,
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
import { REVERSAL_WORDING, unknownTerm } from "./terms";
import { unusedReadings } from "./unused";

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
  /** Columns and values matched by Host-declared names. Each counts as confidence 1 and overrides the provider. */
  mentions?: readonly Mention[];
  /** Answers to earlier clarifications, keyed by clarification ID. */
  answers?: Record<string, string>;
  confidence?: ConfidencePolicy;
  /**
   * The view `view.reset` returns to (the adapter's `getDefaultState()`). A reset that keeps the current filters
   * ("reset everything except the filters") adds them to this view's own, so it is ready only when this is given and
   * has no filters. Otherwise GridCue asks.
   */
  defaultState?: { filters: ViewState["filters"] };
  /**
   * The operations the grid supports (its adapter's capabilities). A count ("top 10") becomes `limit.set` only where
   * this lists it; otherwise the plan sorts alone and records the count as not applied (ADR 0018).
   */
  operations?: readonly string[];
  newId: (prefix: string) => string;
}

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
const CLEARS: ReadonlySet<string> = new Set(["filter.clear", "sort.clear", "group.clear"]);
/** The verb that introduces each column change, to tell a value named before it (a filter) from one after it. */
const CHANGE_VERB: Partial<Record<string, RegExp>> = {
  sort: /\b(?:sort|order)(?:ed)?\b/,
  group: /\bgroup(?:ed)?\b/,
  "columns.hide": /\bhid(?:e|den)\b/,
  "columns.show": /\bshow(?:n)?\b/,
  "columns.only": /\b(?:keep|only)\b/,
};
/**
 * Whether a part asks to keep the view's current filters and narrow them, instead of replacing them (ADR 0017).
 * "Only those", "among them", and "narrow it down" always mean the filters. "Also" and "too" belong to whichever
 * change they sit next to: "show trusts and also sort by value" sorts in addition, and still replaces the filters.
 */
const OTHER_CHANGE = /^(?:sort|order|group|ungroup|hide|pin|put|move|reorder)(?:ed|s)?\b/;
const keepsFilters = (text: string): boolean => {
  if (
    /\b(?:(?:only|just) (?:those|these|them)|(?:of|among|within|from) (?:those|these|them)|narrow(?:ed)? (?:it |them |that |this )?(?:down|to)|further)\b/.test(
      text,
    )
  ) {
    return true;
  }
  // A leading "also" or "additionally" goes with the verb right after it.
  for (const m of text.matchAll(/\b(?:also|additionally)\s+(?:(?:and|then)\s+)?(\w+)/g)) {
    if (!OTHER_CHANGE.test(m[1] ?? "")) return true;
  }
  // A trailing "too" or "as well" goes with the last verb before it.
  for (const m of text.matchAll(/\b(?:too|as well)\b/g)) {
    const before = text.slice(0, m.index);
    const verbs = [
      ...before.matchAll(/\b(sort|order|group|ungroup|hide|pin|put|move|reorder|show|filter|only|keep|include|exclude|display|list)\w*/g),
    ];
    const last = verbs.at(-1)?.[1] ?? "";
    if (!OTHER_CHANGE.test(last)) return true;
  }
  return false;
};
/** How many predicates a filter group holds, nested groups included. */
const predicatesIn = (group: FilterGroup | null): number =>
  (group?.children ?? []).reduce((n, child) => n + ("children" in child ? predicatesIn(child) : 1), 0);

/** A part that replaces the sort or grouping named before it, instead of adding a level. */
const REPLACES = /\b(?:instead|rather)\b/;
/** Words that may add a level to the current sort or grouping: "also group by advisor", "a second sort". */
const ADDS_WORDING = /\b(?:also|too|as well|additionally|another|second|add)\b/;
const isColumnFamily = (f: Pick) => isView(f.id) && COLUMN_FAMILIES[f.id] !== undefined;
/** How far the top column family must lead the next for the next to be dropped (ADR 0012). */
export const FAMILY_MARGIN = 0.1;
/** Below this provider score, a column named by a Host-declared word is read as not meant (ADR 0013). */
export const MENTION_FLOOR = 0.4;
/**
 * Thresholds for the fan-out signals (ADR 0014). Each is compared with its own question's answer, never with
 * `ready`/`clarify`: a Choice's probability and a Noul's are not comparable.
 */
export const FAN_OUT = {
  /** A role Noul at or above this binds a column to a sort, group, show, or hide. */
  role: 0.7,
  /** The change-type Choice's top probability at or above this decides between column families. */
  kind: 0.6,
  /** The add-a-level Noul at or above this appends to the current view's sort or grouping. */
  adds: 0.7,
  /** A reversal Noul at or above this puts the later-named column outside the earlier one. */
  outer: 0.7,
  /** A per-value Noul at or above this confirms a named value limits the rows ("sort by gain, just the trusts"). */
  values: 0.7,
  /** A reading Choice at or above this decides what an ambiguous row or entity noun means (ADR 0015). */
  reading: 0.6,
} as const;

/** Between a column's name and its amount: "market value over $1m", "gain is above". */
// No two neighbouring parts can match the same spaces, so a long run of spaces is read once.
export const ADJACENT_COMPARISON =
  /^\s*(?:(?:is|are|of|was|were) )?(?:(?:(?:(?:no|not) )?(?:greater|more|larger|bigger|higher|less|fewer|smaller|lower) than(?: or equal to)?|(?:over|under|above|below) or equal to|at or (?:above|below)|on or (?:before|after)|over|under|above|below|from|at least|at most|up to|between|exceed(?:s|ing)?|equal to|equals|exactly|since|before|after|[<>=≤≥]{1,2})\s*)?$/;
/**
 * With no comparison word, an amount is "equal to" only when it sits right by the column it belongs to and nothing
 * GridCue didn't read qualifies it: "market value $750k", "value is $750k", "market value at $1m", "opened on
 * 2024-01-01", "accounts with 5 positions". Anything else, such as "~", "around", "!=", "give or take" or "(approx)",
 * is asked about, never read as "equal to".
 */
const PLAIN_GAP = /^\s*(?::\s*)?(?:(?:is|are|was|were|of|at|on) )?$/;
/** Before an amount whose column follows it: "accounts with 5 positions". */
const PLAIN_BEFORE_AMOUNT = /(?:^|(?:^|\b(?:with|having|has|have|had|of|and|or|show|only|keep|list|find)) |, ?)$/;
/** A value named inside one of these phrases limits the rows, wherever it sits: "sort by gain for trusts". */
const PREPOSITION = String.raw`(?:for|among|at|in|with|from|of|within)\s+`;
const PREPOSITION_DETERMINER = String.raw`(?:(?:the|all|only|just)\s+)?`;
const PREPOSITION_BEFORE = new RegExp(String.raw`\b${PREPOSITION}${PREPOSITION_DETERMINER}(?:[\p{L}-]+\s+)?$`, "u");

/**
 * Decides between competing families (ADR 0012). `accepted` are at or above `ready` or confirmed by the User;
 * `middling` are view families between `clarify` and `ready`. `viable` says whether a family has something to act
 * on in this Clause. Returns the families to use, the ones to ask about, and the ones dropped.
 */
export const settleFamilies = (
  accepted: readonly Pick[],
  middling: readonly Pick[],
  viable: (family: string) => boolean = () => true,
  /** Fan-out signals: whether role answers give each column family its own columns, and the change-type pick. */
  fanOut: { separable?: (families: readonly Pick[]) => boolean; kind?: Pick | undefined } = {},
) => {
  let kept = [...accepted];
  const dropped: Pick[] = [];
  let waiting = [...middling];
  // A confident change-type pick promotes its family out of the middle band ("show trusts" is a filter).
  const kind = fanOut.kind && fanOut.kind.confidence >= FAN_OUT.kind ? fanOut.kind : undefined;
  const promoted = kind && waiting.find((f) => f.id === kind.id && viable(f.id));
  if (promoted) {
    kept.push(promoted);
    waiting = waiting.filter((f) => f !== promoted);
  }
  const drop = (test: (f: Pick) => boolean) => {
    dropped.push(...kept.filter(test));
    kept = kept.filter((f) => !test(f));
  };
  // A family with nothing to act on yields to one that has something, as "show" does to "filter" in "show IRAs at Northgate".
  if (kept.some((f) => !viable(f.id)) && [...kept, ...waiting].some((f) => viable(f.id))) drop((f) => !viable(f.id));
  if (kept.some((f) => f.id === "columns.only")) drop((f) => f.id === "columns.show" || f.id === "columns.hide");
  const reset = kept.find((f) => f.id === "view.reset");
  const clears = kept.filter((f) => CLEARS.has(f.id));
  if (reset && clears.length > 0) {
    if (clears.every((f) => reset.confidence > f.confidence)) drop((f) => CLEARS.has(f.id));
    else drop((f) => f.id === "view.reset");
  }
  const ranked = kept.filter(isColumnFamily).sort((a, b) => b.confidence - a.confidence);
  const [top, next] = ranked;
  // Several column families stand only when each has its own columns ("Roth IRAs grouped by rep"). Otherwise a
  // confident change-type pick decides, then the 0.10 margin. The epsilon keeps 0.95 - 0.85 on the "leads" side.
  let decidedByKind = false;
  if (top && next && !fanOut.separable?.(ranked)) {
    if (kind && ranked.some((f) => f.id === kind.id)) {
      drop((f) => f.id !== kind.id && isColumnFamily(f));
      decidedByKind = true;
    } else if (top.confidence - next.confidence >= FAMILY_MARGIN - 1e-9) drop((f) => f !== top && isColumnFamily(f));
  }
  const confident = kept.some((f) => isView(f.id));
  if (confident) dropped.push(...waiting);
  return { kept, ask: confident ? [] : waiting, dropped, byKind: decidedByKind || !!promoted };
};

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
  const optionsFor = (kinds: readonly ColumnKind[] | null, capability: string) =>
    c.schema.columns
      .filter((col) => isExposed(col) && col.capabilities.includes(capability as never) && (!kinds || kinds.includes(col.kind)))
      .map((col) => ({ id: col.id, label: col.label }));
  // Consecutive sorts or groupings are levels of one, in the order named: the first is the primary sort or the
  // outermost group. A clear or reset in between, or a part that says "instead", starts a new one.
  const levelsOf = (type: "sort.set" | "group.set", replaces: boolean) => {
    const at = operations.findLastIndex((o) => o.type === type);
    const current = operations[at];
    if (replaces || !current || operations.slice(at + 1).some((o) => o.type === "view.reset")) return undefined;
    if (current.type === "sort.set" && current.sorts.length > 0) return current;
    if (current.type === "group.set" && current.columnIds.length > 0) return current;
    return undefined;
  };
  const nameKey = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
  const columnsNamed = (term: string) =>
    c.schema.columns.filter((col) => isExposed(col) && [col.label, ...(col.aliases ?? [])].some((n) => nameKey(n) === nameKey(term)));
  const note = (key: string, selectedId: string, confidence: number, source: DecisionEvidence["source"]) => {
    evidence.push({ key, selectedId, confidence, source });
    confidences.push(confidence);
  };
  // "Top accounts", "largest to smallest": a size word with no column ranks by the Host's main value column (ADR 0018).
  // Names GridCue reads after an amount: the row noun, and every exposed column's and value's declared names.
  const readNames = [
    c.schema.rowNoun ?? "",
    ...c.schema.columns
      .filter(isExposed)
      .flatMap((col) => [
        col.label,
        ...(col.aliases ?? []),
        ...(col.enumValues ?? []).flatMap((v) => [v.label, ...(v.aliases ?? [])]),
        ...(col.valueGroups ?? []).flatMap((g) => [g.label, ...(g.aliases ?? [])]),
      ]),
  ]
    .map((n) => n.toLowerCase())
    .filter(Boolean);
  // Every exposed column's declared names, to notice one the grammar read as the rows.
  const columnNameAt = c.schema.columns
    .filter(isExposed)
    .flatMap((col) => [col.label, ...(col.aliases ?? [])].map((n) => ({ name: n.toLowerCase(), columnId: col.id })))
    .filter(({ name }) => name.length > 0);
  const rowNounKey = c.schema.rowNoun?.toLowerCase().replace(/(?:es|s)$/, "");
  const measureFor = (text: string): ColumnDescriptor | undefined => {
    const measure = c.schema.defaultMeasure ? column(c.schema.defaultMeasure) : undefined;
    return measure?.capabilities.includes("sort") && SIZE_WORDS.test(unquoted(text)) ? measure : undefined;
  };

  for (const mention of c.restricted ?? []) {
    unsupportedSegments.push({ category: "restricted_column" });
    evidence.push({ key: `c${mention.clauseIndex}.restricted`, selectedId: mention.columnId, source: "host" });
  }

  if (unsupportedSegments.length === 0) {
    for (const clause of c.input.clauses) {
      const key = `c${clause.index}`;
      const proposed: ClauseResolution = c.resolution.clauses.find((r) => r.clauseIndex === clause.index) ?? {
        clauseIndex: clause.index,
        families: [],
        columns: [],
        values: [],
        unmatchedTerms: [],
      };
      const ownMentions = (c.mentions ?? []).filter((m) => m.clauseIndex === clause.index);
      const res = narrowProposal(proposed, clause, ownMentions, c.schema, bands, (e) => evidence.push(e));
      const opsBefore = operations.length;
      // Mentions are deterministic: a named value is used at confidence 1. A named column is too, unless the provider
      // scored that column below MENTION_FLOOR: "biggest accounts first" names the rows, not Account number (ADR 0013).
      const own = (c.mentions ?? []).filter((m) => m.clauseIndex === clause.index);
      // "Accounts over $1m. Or northgate accounts": a part that starts with "or" offers another set of rows, and
      // filters combine with "and".
      // Negations GridCue can't be sure about ask, never act: "don't sort by gain", "never hide trusts" (a negation before a
      // view verb other than "show"), "never show never show trusts" (two negations in one part), and "show nothing
      // over $1m" or "show accounts including trusts" (whether the rows are kept or left out is unclear).
      const unsure = unsureNegation(
        unquoted(clause.text),
        own,
        clause.literals.some((l) => l.kind === "text"),
        (id) => column(id)?.kind === "boolean",
      );
      if (unsure) {
        clarifications.push({ id: `${key}.negation`, prompt: unsure, required: true });
        continue;
      }
      // A part that stops on "and", "or", "but", "then" or "the" was cut off: "accounts over $1m but".
      const cutOff = /\b(and|or|but|then|the)[\s,;.]*$/.exec(unquoted(clause.text));
      if (cutOff && clause.text.trim() !== cutOff[1]) {
        clarifications.push({
          id: `${key}.cut`,
          prompt: `“${clause.text}” stops after “${cutOff[1]}”. Finish that part, or leave the last word out.`,
          required: true,
        });
        continue;
      }
      if (/^or\b/.test(clause.text)) {
        clarifications.push({ id: `${key}.either`, prompt: EITHER_PROMPT, required: true });
        continue;
      }
      // What a clear or reset says to keep ("clear filters except accounts over $1m") is kept only when the view
      // already has it; GridCue never adds a filter the User didn't have in its place.
      if (clause.keeps) {
        const kept = keepPart(clause, own, c.state, c.defaultState, operations, column, c.newId, c.schema.rowNoun);
        if ("operations" in kept) operations.push(...kept.operations);
        else clarifications.push({ id: `${key}.keep`, prompt: kept.prompt, required: true });
        continue;
      }
      const scored = new Map(res.columns.map((p) => [p.id, p.confidence]));
      const mentionedColumns: string[] = [];

      // An ambiguous row or entity noun ("largest households first") takes the provider's reading, or the User's
      // answer. "rows" drops the Mention; "records" asks rather than guessing, since GridCue can only group (ADR 0015).
      const readAsRows = new Set<string>();
      let groupAnswer: string | undefined;
      let readingPending = false;
      for (const m of own.filter((x) => x.ambiguous)) {
        const col = column(m.columnId);
        if (!col) continue;
        const answerKey = `${key}.reading.${col.id}`;
        const answer = answers[answerKey];
        if (answer === "group") groupAnswer = col.id;
        if (answer !== undefined) continue;
        const reading = m.records
          ? { columnId: col.id, reading: "records" as const, confidence: 1 }
          : res.readings?.find((r) => r.columnId === col.id);
        if (!reading || reading.confidence < FAN_OUT.reading) continue;
        if (reading.reading === "rows") {
          readAsRows.add(col.id);
          evidence.push({ key: `dropped:${key}.mention`, selectedId: col.id, confidence: reading.confidence, source: "provider" });
        } else if (reading.reading === "records" && col.entity) {
          clarifications.push({
            id: answerKey,
            prompt: `Did you mean ${col.entity}s as a whole? GridCue can group by ${col.label}.`,
            options: [
              { id: "group", label: `Group by ${col.label}` },
              { id: "column", label: `Use the ${col.label} column` },
            ],
            required: true,
          });
          readingPending = true;
        }
      }
      if (readingPending) continue;
      // The provider's other answers can confirm a named column its column score doubts: "restricted accounts" scored
      // Restricted holdings 0.39 as a column but "true" 0.96 as a value in the same call.
      const supported = (id: string) =>
        res.values.some((v) => v.columnId === id && v.confidence >= bands.ready) ||
        (res.roles ?? []).some((r) => r.columnId === id && r.confidence >= FAN_OUT.role) ||
        (res.literalColumns ?? []).some((l) => l.columnId === id && l.confidence >= bands.ready);
      // The row noun or another entity left ambiguous as the subject of a sort or grouping ("households sorted by …")
      // is the rows, never the column to sort or group by.
      const rowNounLeft = (m: Mention) => !!m.ambiguous && /^ (?:sorted|ordered|grouped|sort|order|group)\b/.test(clause.text.slice(m.end));
      for (const id of new Set(
        own.filter((m) => m.valueId === undefined && !readAsRows.has(m.columnId) && !rowNounLeft(m)).map((m) => m.columnId),
      )) {
        const score = scored.get(id);
        if (score !== undefined && score < MENTION_FLOOR && !supported(id)) {
          evidence.push({ key: `dropped:${key}.mention`, selectedId: id, confidence: score, source: "provider" });
        } else mentionedColumns.push(id);
      }
      const mentionedValues = own.filter((m) => m.valueId !== undefined);
      const valueColumns = new Set(mentionedValues.map((m) => m.columnId));
      // An excluded value ("non-retirement", "excluding trusts") filters to the column's other approved values.
      const chosen = mentionedValues.filter((m) => !m.negated);
      const excluded = mentionedValues.filter((m) => m.negated && !chosen.some((x) => x.columnId === m.columnId));
      const others = [...new Set(excluded.map((m) => m.columnId))].flatMap((columnId) =>
        (column(columnId)?.enumValues ?? [])
          .filter((v) => !excluded.some((m) => m.columnId === columnId && m.valueId === v.id))
          .map((v) => `${columnId}\u0000${v.id}`),
      );
      const values = [
        ...[...new Set([...chosen.map((m) => `${m.columnId}\u0000${m.valueId}`), ...others])].map((k) => {
          const [columnId = "", valueId = ""] = k.split("\u0000");
          return { columnId, valueId, confidence: 1, mentioned: true };
        }),
        ...res.values.filter((v) => !valueColumns.has(v.columnId)).map((v) => ({ ...v, mentioned: false })),
      ];
      // A column already implied by a named or confident value, or by a confident literal pick, is never asked about.
      const covered = new Set([
        ...values.filter((v) => v.confidence >= bands.ready).map((v) => v.columnId),
        ...(res.literalColumns ?? []).filter((l) => l.confidence >= bands.ready).map((l) => l.columnId),
      ]);

      const hasColumns = mentionedColumns.length > 0 || res.columns.some((p) => p.confidence >= bands.clarify && column(p.id));
      const hasFilterArgs = clause.literals.length > 0 || values.some((v) => v.mentioned || v.confidence >= bands.clarify);

      // Role answers bind each named or confident column to the change it gets (fan-out spec, Q3). They separate
      // columns between changes; they never drop a named column on their own. A column with a named or confident
      // value is a filter argument, so it joins another change only when its role says so ("restricted accounts
      // grouped by advisor"). A confident reversal answer makes both of its columns levels of the sort or grouping.
      // A confident role answer is itself evidence the column is meant: "biggest northgate accounts first" scores
      // Market value 0.51 as a column but 0.92 as the sort.
      const candidates = [
        ...new Set([
          ...mentionedColumns,
          ...res.columns.filter((p) => p.confidence >= bands.ready).map((p) => p.id),
          ...(res.roles ?? []).filter((r) => r.confidence >= FAN_OUT.role && column(r.columnId)).map((r) => r.columnId),
        ]),
      ].filter((id) => !readAsRows.has(id));
      // Filter arguments: columns with a named or confident value, and the column each amount applies to (the
      // provider's confident pick, else any candidate whose kind can hold it).
      // An enum column named on its own as well as by one of its values ("roth ira accounts grouped by registration
      // type") is free for another change too; a yes/no column named by its value word is not (review fix).
      const namedTwice = new Set(
        mentionedColumns.filter((id) => column(id)?.kind !== "boolean" && mentionedValues.some((m) => m.columnId === id)),
      );
      const valueArgs = new Set([
        ...values.filter((v) => (v.mentioned || v.confidence >= bands.ready) && !namedTwice.has(v.columnId)).map((v) => v.columnId),
        ...clause.literals.flatMap((lit, j) => {
          const pick = res.literalColumns?.find((l) => l.literalIndex === j && l.confidence >= bands.ready);
          if (pick) return [pick.columnId];
          return candidates.filter((id) => LITERAL_COLUMN_KINDS[lit.kind].includes(column(id)?.kind ?? "string"));
        }),
      ]);
      const levels = new Set((res.outer ?? []).filter((o) => o.confidence >= FAN_OUT.outer).flatMap((o) => [o.outerId, o.innerId]));
      const roleFamily = (f: string) => (f === "columns.only" ? "columns.show" : f);
      const hasRole = (id: string, f: string) =>
        (f === "group" && id === groupAnswer) ||
        (res.roles ?? []).some((r) => r.columnId === id && r.family === roleFamily(f) && r.confidence >= FAN_OUT.role) ||
        ((f === "sort" || f === "group") && levels.has(id));
      const boundTo = (f: string): string[] | undefined => {
        const ids = candidates.filter((id) => hasRole(id, f));
        return ids.length > 0 ? ids : undefined;
      };
      const roleFamilies = ["sort", "group", "columns.show", "columns.hide"];
      /** Columns free for any change: not a filter argument and not bound to a different change than `f`. */
      const freeFor = (f: string) =>
        candidates.filter((id) => !valueArgs.has(id) && !roleFamilies.some((g) => g !== roleFamily(f) && hasRole(id, g)));
      /** A column family's columns: those bound to it, else the free ones. */
      const columnsFor = (f: string): string[] | undefined => {
        const bound = boundTo(f);
        if (bound) return bound;
        const free = freeFor(f);
        return free.length > 0 ? free : undefined;
      };
      const separable = (fs: readonly Pick[]) => {
        const claimed = new Set<string>();
        for (const f of fs) {
          if (f.id === "filter") {
            if (!hasFilterArgs) return false;
            continue;
          }
          const ids = columnsFor(f.id);
          // A directed sort with no column yet stands apart: it asks for its column instead of forcing a split.
          if (!ids && f.id === "sort" && clause.direction) continue;
          if (!ids || ids.some((id) => claimed.has(id))) return false;
          for (const id of ids) claimed.add(id);
        }
        return true;
      };
      const viable = (f: string) => {
        if (f === "filter") return hasFilterArgs;
        // A sort with a direction in the text ("biggest … first") was clearly asked for: with no clear column,
        // GridCue asks which one rather than dropping it beside another change (live finding).
        if (f === "sort" && clause.direction) return true;
        if (!isView(f) || !COLUMN_FAMILIES[f]) return true;
        // A column the User chose to group by leaves nothing for another change unless something else is named.
        if (!res.roles) return hasColumns && (f === "group" || !groupAnswer || candidates.some((id) => id !== groupAnswer));
        return !!boundTo(f) || freeFor(f).length > 0 || (candidates.length === 0 && hasColumns);
      };

      // Family picks: sort each into accepted, middling, or dropped, then settle competing ones (ADR 0012).
      const accepted: Pick[] = [];
      const middling: Pick[] = [];
      for (const f of res.families) {
        if (!KNOWN_FAMILY_IDS.has(f.id)) continue;
        const answerKey = `${key}.family.${f.id}`;
        if (answers[answerKey] !== undefined) {
          if (answers[answerKey] === f.id) {
            accepted.push({ id: f.id, confidence: 1 });
            note(answerKey, f.id, 1, "user");
          }
        } else if (f.confidence >= bands.ready || (!isView(f.id) && f.confidence >= bands.clarify)) {
          // An unsupported action is refused, not confirmed: asking "did you want to edit the data?" invites a yes that is refused anyway.
          accepted.push(f);
        } else if (f.confidence >= bands.clarify) {
          middling.push(f);
        }
      }
      const namedFilter = mentionedValues.length > 0 || values.some((v) => v.confidence >= bands.ready);
      // A value named before another change's verb describes which rows: "Roth IRAs grouped by rep", "Northgate
      // accounts sorted by gain". Code reads that from word order, so it filters too. A value after the verb
      // ("sort by gain for trusts") is left to the "never ignore a named value" question below.
      const namedBooleanValues = values.filter(
        (v) => mentionedColumns.includes(v.columnId) && column(v.columnId)?.kind === "boolean" && v.confidence >= bands.ready,
      );
      // An amount or quoted text before the verb describes the rows the same way: "accounts over $1M grouped by
      // custodian" (ADR 0019).
      const modifierStarts = [
        ...mentionedValues.map((m) => m.start),
        ...clause.literals.map((l) => l.at),
        ...namedBooleanValues.flatMap((v) => own.filter((m) => m.columnId === v.columnId && m.valueId === undefined).map((m) => m.start)),
      ];
      const otherChanges = accepted.filter((f) => isView(f.id) && f.id !== "filter" && COLUMN_FAMILIES[f.id as ViewFamily]);
      // Words inside a declared name are part of the name: "group" in "Advisor Group" is no verb.
      const namesBlanked = own.reduce((t, m) => t.slice(0, m.start) + " ".repeat(m.end - m.start) + t.slice(m.end), clause.text);
      const verbAt = (f: string) => namesBlanked.search(CHANGE_VERB[f] ?? /$^/);
      if (
        modifierStarts.length > 0 &&
        otherChanges.length > 0 &&
        !accepted.some((f) => f.id === "filter") &&
        otherChanges.every((f) => {
          const at = verbAt(f.id);
          return modifierStarts.every((start) => at < 0 || start < at);
        })
      ) {
        accepted.push({ id: "filter", confidence: 1 });
        evidence.push({ key: `${key}.modifier`, selectedId: "filter", confidence: 1, source: "deterministic" });
      }
      // After the verb, a named value limits the rows when it sits in a prepositional phrase ("for trusts"), or when
      // the provider's per-value answer says so ("but just the trusts"). Otherwise it is still asked about below.
      const confirmed = (m: Mention) =>
        res.values.some((v) => v.columnId === m.columnId && v.valueId === m.valueId && v.confidence >= FAN_OUT.values);
      const afterVerb = accepted.some((f) => f.id === "filter") ? [] : mentionedValues;
      if (afterVerb.length > 0 && otherChanges.length > 0) {
        const byPreposition = afterVerb.every((m) => PREPOSITION_BEFORE.test(clause.text.slice(0, m.start)));
        if (byPreposition || afterVerb.every(confirmed)) {
          accepted.push({ id: "filter", confidence: 1 });
          evidence.push({
            key: `${key}.${byPreposition ? "preposition" : "values"}`,
            selectedId: "filter",
            confidence: byPreposition
              ? 1
              : Math.min(...afterVerb.map((m) => res.values.find((v) => v.valueId === m.valueId)?.confidence ?? 0)),
            source: byPreposition ? "deterministic" : "provider",
          });
        }
      }
      // When nothing the provider suggests has anything to act on and the part names a value, filtering is the only
      // reading left: "show trusts". Never for a part that doesn't read as a view request: "close all trust accounts".
      const starts = new Set([...own.map((m) => m.start), ...clause.literals.map((l) => l.at)]);
      if (
        namedFilter &&
        ![...accepted, ...middling].some((f) => isView(f.id) && viable(f.id)) &&
        viewRequest(
          unquoted(clause.text),
          starts,
          c.schema.rowNoun,
          new Set(own.filter((m) => m.valueId === undefined && !m.ambiguous).map((m) => m.start)),
          readNames,
        )
      ) {
        accepted.push({ id: "filter", confidence: 1 });
        evidence.push({ key: `${key}.only-reading`, selectedId: "filter", confidence: 1, source: "deterministic" });
      }
      // The User chose "Group by Household" for an ambiguous noun: this part groups by that column only.
      // The User chose "Group by Household": that column is grouped, and the part's other changes stay (review fix).
      if (groupAnswer && !accepted.some((f) => f.id === "group")) {
        accepted.push({ id: "group", confidence: 1 });
        middling.length = 0;
      }
      // A value that continues a sort or grouping ("group by custodian, then northgate") is a filter, not a level.
      if (clause.continues && mentionedValues.length > 0 && mentionedColumns.length === 0) {
        for (const f of [...accepted]) if (f.id !== "filter" && isView(f.id)) accepted.splice(accepted.indexOf(f), 1);
        middling.length = 0;
        if (!accepted.some((f) => f.id === "filter")) accepted.push({ id: "filter", confidence: 1 });
        evidence.push({ key: `${key}.continued-value`, selectedId: "filter", confidence: 1, source: "deterministic" });
      }
      const settled = settleFamilies(accepted, middling, viable, { separable, kind: res.kind });
      const families = settled.kept;
      if (settled.byKind && res.kind)
        evidence.push({ key: `${key}.kind`, selectedId: res.kind.id, confidence: res.kind.confidence, source: "provider" });
      for (const f of families) if (answers[`${key}.family.${f.id}`] === undefined) note(`${key}.family`, f.id, f.confidence, "provider");
      for (const f of settled.dropped)
        evidence.push({ key: `dropped:${key}.family`, selectedId: f.id, confidence: f.confidence, source: "deterministic" });
      for (const f of settled.ask) {
        clarifications.push({
          id: `${key}.family.${f.id}`,
          prompt: `Did you want to ${FAMILY_PHRASE[f.id] ?? "change the view"}?`,
          options: [
            { id: f.id, label: "Yes" },
            { id: "none", label: "No" },
          ],
          required: true,
        });
      }
      const familyPending = settled.ask.length > 0;

      const blocked = families.filter((f) => !isView(f.id));
      for (const f of blocked) {
        unsupportedSegments.push({ text: clause.text, category: f.id.replace("unsupported.", "") as UnsupportedCategory });
      }
      // Canonical order within a part (Q6): filters first, then sorts, groups, and columns, as VIEW_FAMILIES lists them.
      // A family can be added by a rule and promoted by the provider in the same part; it still runs once.
      const viewFamilies = [...new Set(families.filter((f) => isView(f.id)).map((f) => f.id as ViewFamily))].sort(
        (a, b) => VIEW_FAMILIES.indexOf(a) - VIEW_FAMILIES.indexOf(b),
      );
      if (blocked.length > 0) continue;
      // A clear applies only to what its verb governs ("clear the sort, the grouping stays" clears the sort alone).
      // When the part has a clear verb, a proposed clear of anything else is asked about, never applied.
      const clearsOf = governedClears(unquoted(namesBlanked));
      const CLEAR_THING: Partial<Record<string, string>> = {
        "filter.clear": "filter",
        "sort.clear": "sort",
        "group.clear": "group",
        "view.reset": "view",
      };
      if (
        clearsOf.hasClearVerb &&
        (clearsOf.ungoverned || viewFamilies.some((f) => CLEAR_THING[f] && !clearsOf.governed.has(CLEAR_THING[f] ?? "")))
      ) {
        clarifications.push({
          id: `${key}.clear`,
          prompt: "GridCue can't tell which of these to clear. Name just the sort, the grouping or the filters to clear.",
          required: true,
        });
        continue;
      }
      // "Don't show the custodian column" asks for the opposite of a show: never show it.
      if (
        /^(?:don't|dont|do not|never|no longer)\b/.test(unquoted(clause.text).slice(LEAD_IN.exec(unquoted(clause.text))?.[0].length ?? 0))
      ) {
        if (viewFamilies.some((f) => f === "columns.show" || f === "columns.only")) {
          clarifications.push({
            id: `${key}.negated`,
            prompt: `Did you mean to hide those columns? Ask GridCue to hide them.`,
            required: true,
          });
          continue;
        }
      }
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
      const columnFamilies = families.filter((f) => isView(f.id) && COLUMN_FAMILIES[f.id]);
      if (columnFamilies.length > 1 && !separable(columnFamilies)) {
        clarifications.push({
          id: `${key}.family`,
          prompt: `“${clause.text}” asks for more than one kind of change. Split it into separate parts.`,
          required: true,
        });
        continue;
      }
      // With several column changes in one part, a named column bound to none of them is never guessed into one
      // (review fix): "sort by value with gain and name hidden" asks about Name.
      const changes = viewFamilies.filter((f) => f !== "filter" && COLUMN_FAMILIES[f]);
      const unassigned =
        changes.length > 1 ? mentionedColumns.filter((id) => !valueArgs.has(id) && !roleFamilies.some((g) => hasRole(id, g))) : [];
      if (unassigned.length > 0) {
        clarifications.push({
          id: `${key}.family`,
          prompt: `“${clause.text}” also mentions ${column(unassigned[0] ?? "")?.label ?? "a column"}. Say which change it belongs to, or split it into separate parts.`,
          required: true,
        });
        continue;
      }
      // A value the User named is never silently ignored: "roth iras grouped by rep" names Roth IRA but only groups.
      // A named yes/no column with a confident value counts too: "restricted accounts grouped by advisor".
      const namedBooleans = values
        .filter((v) => mentionedColumns.includes(v.columnId) && column(v.columnId)?.kind === "boolean" && v.confidence >= bands.ready)
        .map((v): Mention => ({ clauseIndex: clause.index, columnId: v.columnId, start: 0, end: 0 }));
      const unused = viewFamilies.includes("filter") ? [] : [...mentionedValues, ...namedBooleans];
      if (unused.length > 0) {
        const col = column(unused[0]?.columnId ?? "");
        const label = col?.enumValues?.find((v) => v.id === unused[0]?.valueId)?.label ?? col?.label ?? "a value";
        clarifications.push({
          id: `${key}.family`,
          prompt: `“${clause.text}” also names ${label}. Split it into separate parts, such as “only ${label}” and the rest.`,
          required: true,
        });
        continue;
      }

      // Column picks: named ones are used; otherwise confident ones are used, middling ones are confirmed, weak ones are dropped.
      const picked: ColumnDescriptor[] = [];
      for (const id of mentionedColumns) {
        const col = column(id);
        if (!col) continue;
        picked.push(col);
        note(`${key}.column`, id, 1, "deterministic");
      }
      for (const p of res.columns) {
        const answerKey = `${key}.column.${p.id}`;
        const col = column(p.id);
        // A column the provider read as the rows stays out, whatever its column score (review fix).
        if (!col || mentionedColumns.includes(p.id) || readAsRows.has(p.id)) continue;
        if (answers[answerKey] !== undefined) {
          if (answers[answerKey] === p.id) {
            picked.push(col);
            note(answerKey, p.id, 1, "user");
          }
        } else if (p.confidence >= bands.ready) {
          picked.push(col);
          note(`${key}.column`, p.id, p.confidence, "provider");
        } else if (candidates.includes(p.id)) {
          // Meant by a confident role answer (fan-out spec, Q3), though its column score is lower.
          picked.push(col);
          const role = Math.max(...(res.roles ?? []).filter((r) => r.columnId === p.id).map((r) => r.confidence));
          note(`${key}.column`, p.id, role, "provider");
        } else if (p.confidence >= bands.clarify && !covered.has(p.id)) {
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

      // A clear that names columns ("clear the market value filter") clears only those: the rest of the current
      // filters, sorts or groups stay. GridCue asks when it can't keep the rest exactly.
      // A column named right before a layout word belongs to that clear only: "the account name filter and the sort"
      // clears that column's filters and the whole sort. One named before "view" that is the grid's own row noun
      // ("reset my tasks view") names the grid, not a column. Any other named column applies to every clear, as before.
      const placedOn = (m: Mention) => {
        const w = /^(?:'s)?\s+(filters?|sorts?|sorting|grouping|groups?|view)\b/.exec(clause.text.slice(m.end))?.[1] ?? "";
        return w.startsWith("filter") ? "filter" : w.startsWith("sort") ? "sort" : w.startsWith("group") ? "group" : w ? "view" : undefined;
      };
      const isRowNounText = (m: Mention) =>
        !!rowNounKey &&
        clause.text
          .slice(m.start, m.end)
          .toLowerCase()
          .replace(/(?:es|s)$/, "") === rowNounKey;
      const targetsFor = (thing: string) =>
        mentionedColumns.filter((id) =>
          own.some((m) => {
            if (m.columnId !== id || m.valueId !== undefined) return false;
            const placed = placedOn(m);
            if (placed === "view" && isRowNounText(m)) return false;
            return placed === undefined || placed === thing;
          }),
        );
      let targets = mentionedColumns;
      const clearOnly = (what: string) =>
        clarifications.push({
          id: `${key}.clear`,
          prompt: `GridCue can't clear only ${targets.map((id) => column(id)?.label ?? id).join(" and ")} from the ${what}. Say “clear the ${what}” to clear all of it.`,
          required: true,
        });
      // A clear of named columns is built from the view the request started with. After an earlier change to the same
      // thing in this request ("clear the market value filter and clear the gain filter"), that view is out of date:
      // building from it would bring back what the earlier change removed. GridCue asks.
      const changedEarlier = (...types: ViewOperation["type"][]) =>
        operations.some((o) => o.type === "view.reset" || types.includes(o.type));
      const afterAnother = (what: string) =>
        clarifications.push({
          id: `${key}.clear`,
          prompt: `GridCue can't clear only ${targets.map((id) => column(id)?.label ?? id).join(" and ")} from the ${what} after another change to the ${what} in the same request. Ask for it on its own.`,
          required: true,
        });
      for (const family of viewFamilies) {
        const thing = family === "filter.clear" ? "filter" : family === "sort.clear" ? "sort" : family === "group.clear" ? "group" : "view";
        if (CLEARS.has(family) || family === "view.reset") targets = targetsFor(thing);
        if (family === "filter.clear") {
          const current = c.state.filters?.children ?? [];
          const flat = c.state.filters?.combinator === "and" && current.every((p) => !("children" in p));
          if (targets.length === 0) operations.push({ type: "filter.clear" });
          else if (changedEarlier("filter.add", "filter.clear")) afterAnother("filters");
          else if (!flat || !current.some((p) => "columnId" in p && targets.includes(p.columnId))) clearOnly("filters");
          else {
            operations.push({ type: "filter.clear" });
            for (const p of current) {
              if (!("columnId" in p) || targets.includes(p.columnId)) continue;
              operations.push({ type: "filter.add", predicate: { ...p, id: c.newId("filter") }, combineWith: "and" });
            }
          }
        } else if (family === "sort.clear") {
          if (targets.length === 0) operations.push({ type: "sort.set", sorts: [] });
          else if (changedEarlier("sort.set")) afterAnother("sort");
          else if (!c.state.sorts.some((s) => targets.includes(s.columnId))) clearOnly("sort");
          else operations.push({ type: "sort.set", sorts: c.state.sorts.filter((s) => !targets.includes(s.columnId)) });
        } else if (family === "group.clear") {
          if (targets.length === 0) operations.push({ type: "group.set", columnIds: [] });
          else if (changedEarlier("group.set")) afterAnother("grouping");
          else if (!c.state.groupBy.some((id) => targets.includes(id))) clearOnly("grouping");
          else operations.push({ type: "group.set", columnIds: c.state.groupBy.filter((id) => !targets.includes(id)) });
        } else if (family === "view.reset") {
          if (targets.length === 0) operations.push({ type: "view.reset" });
          else clearOnly("view");
        } else if (family === "filter") {
          const predicates: FilterPredicate[] = [];
          const pred = (columnId: string, operator: FilterPredicate["operator"], value?: FilterPredicate["value"]) =>
            predicates.push({ id: c.newId("filter"), type: "predicate", columnId, operator, ...(value === undefined ? {} : { value }) });
          const byColumn = new Map<string, string[]>();
          for (const v of values) {
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
            } else if (v.mentioned) {
              use(1, "deterministic", `${key}.value.${col.id}`);
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
            const ops = operatorsFor(column(id) ?? ({ kind: "enum" } as ColumnDescriptor));
            const out = excluded.filter((m) => m.columnId === id).map((m) => m.valueId ?? "");
            const filtersBefore = predicates.length;
            const chosen = answers[`${key}.value.${id}`];
            if (chosen !== undefined && ids.includes(chosen) && ops.includes("eq")) {
              // The User picked one value from the one-value-at-a-time question below (review fix).
              pred(id, "eq", chosen);
              note(`${key}.value.${id}`, chosen, 1, "user");
            } else if (ids.length === 1) pred(id, "eq", ids[0]);
            else if (ops.includes("in")) pred(id, "in", ids);
            // An exclusion the Host's operators can't express as "in" may still be one "not equal" (review fix).
            else if (out.length === 1 && ops.includes("neq")) pred(id, "neq", out[0]);
            else if (out.length > 0) {
              // Leaving values out ("hide closed households") can't be offered as a choice of one value to show: picking
              // one would show only that value, not everything except the ones named.
              const label = column(id)?.label ?? id;
              const names = out.map((v) => column(id)?.enumValues?.find((e) => e.id === v)?.label ?? v);
              clarifications.push({
                id: `${key}.value.${id}`,
                prompt: `This grid can show only one ${label} at a time, so GridCue can't leave out ${names.join(" and ")}. Ask for the ${label} to show.`,
                required: true,
              });
            } else if (!ops.includes("eq")) {
              // The Host allows neither "in" nor "eq" here, so no answer could be applied: say so instead of asking.
              clarifications.push({
                id: `${key}.value.${id}`,
                prompt: `GridCue can't filter ${column(id)?.label ?? id} to these values here. Try a different filter.`,
                required: true,
              });
            } else {
              clarifications.push({
                id: `${key}.value.${id}`,
                prompt: `GridCue can filter ${column(id)?.label ?? id} to one value at a time here. Which one?`,
                options: ids.map((v) => ({ id: v, label: column(id)?.enumValues?.find((e) => e.id === v)?.label ?? v })),
                required: true,
              });
            }
            // Keeping "every value but these" also leaves out rows with no value, which the request didn't name. The
            // Preview says so (`leftOutEmpty`). "Not equal" keeps those rows.
            const added = predicates.length > filtersBefore ? predicates.at(-1) : undefined;
            if (out.length > 0 && added && added.operator !== "neq") {
              evidence.push({ key: `${key}.leftOutEmpty`, selectedId: id, confidence: 1, source: "deterministic" });
            }
          }
          const used = new Set<string>();
          // Where each condition sits, and on which column, to find "or" between conditions on different columns.
          const sides = [
            ...mentionedValues,
            ...own.filter(
              (m) => m.valueId === undefined && column(m.columnId)?.kind === "boolean" && values.some((v) => v.columnId === m.columnId),
            ),
          ].map((m) => ({ at: m.start, columnId: m.columnId }));
          // A part that leaves rows out ("hide taxable accounts", "exclude accounts over $1m") keeps the complement of
          // one simple condition. Anything more ("hide restricted accounts at Northgate", "... except trusts") asks.
          // A yes/no the provider reads as "Yes" under such a lead ("hide non-restricted accounts") is asked about too:
          // GridCue can't tell whether the provider already left the named rows out.
          const excluding = leavesRowsOut(unquoted(namesBlanked));
          const conditions = clause.literals.length + new Set(sides.map((s) => s.columnId)).size;
          const yes = values.some((v) => column(v.columnId)?.kind === "boolean" && v.valueId === "true");
          // A named value is left out only when the lead itself negates it ("hide northgate accounts"). One the lead
          // doesn't reach ("hide accounts at northgate"), or a second negation ("hide accounts not at northgate"), asks.
          const unclearValue =
            mentionedValues.some((m) => !m.negated) ||
            /\b(?:non|not|no|excluding|without)\b/.test(afterExclusionLead(unquoted(clause.text)) ?? "");
          // A column name read as the rows next to what is left out ("hide northgate restricted accounts") would be
          // dropped, and the complement would leave out more than asked: ask.
          const bare = unquoted(clause.text);
          const unreadName = columnNameAt.some(({ name }) => {
            for (let at = bare.indexOf(name); at >= 0; at = bare.indexOf(name, at + 1)) {
              const edge = (i: number) => !/[\p{L}\p{N}]/u.test(bare[i] ?? "");
              const end = at + name.length + (/^(?:es|s)(?![\p{L}\p{N}])/u.exec(bare.slice(at + name.length))?.[0].length ?? 0);
              if (!edge(at - 1) || !edge(end)) continue;
              if (rowNounKey && rowNounKey === name.replace(/(?:es|s)$/, "")) continue;
              if (!own.some((m) => m.start <= at && m.end >= end)) return true;
            }
            return false;
          });
          if (
            excluding &&
            (conditions > 1 ||
              yes ||
              unreadName ||
              (mentionedValues.length > 0 && unclearValue) ||
              /\b(?:except|but|other than|apart from)\b/.test(unquoted(clause.text)))
          ) {
            clarifications.push({ id: `${key}.exclude`, prompt: EXCLUDE_PROMPT, required: true });
            continue;
          }
          clause.literals.forEach((lit, j) => {
            if (lit.kind === "unreadable") {
              clarifications.push({
                id: `${key}.literal${j}.number`,
                prompt: /\d[^\d,.]+\d/.test(String(lit.value))
                  ? `I couldn't read “${lit.value}” as a range. Write both ends in full, like $1M and $2M.`
                  : `I couldn't read “${lit.value}” as a number. Write it like 1,000,000 or $1M.`,
                required: true,
              });
              return;
            }
            if (lit.kind === "date" && !realDay(String(lit.value))) {
              clarifications.push({ id: `${key}.literal${j}.date`, prompt: `${lit.value} isn't a date.`, required: true });
              return;
            }
            // Quoted text is "containing" only after words GridCue reads. Any other word between it and its column asks,
            // and so does one GridCue didn't read right before the column, right after the text, or, with no column,
            // right before the text: an answer to which column holds it can't drop them.
            const quotedAfter = lit.kind === "text" ? columnBeforeText(clause, lit, own, column, c.schema.rowNoun) : undefined;
            const unread = lit.kind === "text" ? textWordsQuestion(clause, lit, quotedAfter, own, c.schema.rowNoun) : undefined;
            if (unread) {
              clarifications.push({ id: `${key}.literal${j}.${unread.id}`, prompt: unread.prompt, required: true });
              return;
            }
            if (comparisonUnread(clause, lit, own, readNames)) {
              clarifications.push({
                id: `${key}.literal${j}.comparison`,
                prompt: `I'm not sure how to compare with “${literalText(clause.text, lit)}”. Try “over”, “under”, “at least”, or “exactly”.`,
                required: true,
              });
              return;
            }
            const answerKey = `${key}.literal${j}.column`;
            const fits = LITERAL_COLUMN_KINDS[lit.kind];
            const answered = answers[answerKey] ? column(answers[answerKey]) : undefined;
            // The provider's pick for this literal: used when confident, offered first when middling.
            const pick = res.literalColumns?.find((l) => l.literalIndex === j);
            const pickCol = pick && column(pick.columnId);
            const pickFits = pickCol && fits.includes(pickCol.kind) && pickCol.capabilities.includes("filter") && !used.has(pickCol.id);
            const provided = pickFits && pick.confidence >= bands.ready ? pickCol : undefined;
            // A column named right before the amount ("market value over $1m") owns it, over the provider's pick.
            const nearest = own
              .filter((m) => m.valueId === undefined && !m.ambiguous && m.end <= lit.at)
              .sort((a, b) => a.end - b.end)
              .at(-1);
            // Quoted text belongs to the column named right before it, and to no other: with none, GridCue asks.
            const adjacent =
              lit.kind === "text"
                ? quotedAfter && mentionedColumns.includes(quotedAfter.mention.columnId)
                  ? quotedAfter.mention
                  : undefined
                : nearest && mentionedColumns.includes(nearest.columnId) && ADJACENT_COMPARISON.test(clause.text.slice(nearest.end, lit.at))
                  ? nearest
                  : undefined;
            const namedCol = adjacent && column(adjacent.columnId);
            // ...and one that can't hold it ("gain over 10%") is asked about, never swapped for another column.
            if (namedCol && !fits.includes(namedCol.kind) && !answered) {
              clarifications.push({
                id: `${key}.literal${j}.fits`,
                prompt: `${namedCol.label} can't be compared with “${literalText(clause.text, lit)}”. Name a column that holds ${KIND_WORDS[lit.kind]}.`,
                required: true,
              });
              return;
            }
            const named = namedCol && fits.includes(namedCol.kind) && !used.has(namedCol.id) ? namedCol : undefined;
            // A provider can't see which column holds a name, so for quoted text its pick is offered, never applied,
            // and one that disagrees with the named column asks.
            const target =
              lit.kind === "text"
                ? (answered ?? (named && (!provided || provided.id === named.id) ? named : undefined))
                : (answered ?? named ?? provided ?? picked.find((col) => fits.includes(col.kind) && !used.has(col.id)));
            const operator = lit.kind === "text" ? "contains" : (lit.comparator ?? "eq");
            // A date against a column that holds times of day would keep or drop rows by the hour. GridCue asks.
            if (lit.kind === "date" && target?.kind === "datetime") {
              clarifications.push({
                id: `${key}.literal${j}.datetime`,
                prompt: `${target.label} holds times of day, so GridCue can't filter it by date yet.`,
                required: true,
              });
              return;
            }
            if (!target || !operatorsFor(target).includes(operator)) {
              // A date-and-time column can't take a date yet, so it is never offered for one.
              const options = optionsFor(lit.kind === "date" ? ["date"] : fits, "filter");
              const first =
                pickFits && pick.confidence >= bands.clarify && options.some((o) => o.id === pickCol.id) ? pickCol.id : undefined;
              clarifications.push({
                id: answerKey,
                prompt:
                  lit.kind === "text" ? `Which column should contain “${lit.value}”?` : `Which column should be ${describeLiteral(lit)}?`,
                options: first ? [...options.filter((o) => o.id === first), ...options.filter((o) => o.id !== first)] : options,
                required: true,
              });
              return;
            }
            used.add(target.id);
            sides.push({ at: lit.at, columnId: target.id });
            if (answered) note(answerKey, target.id, 1, "user");
            else if (target === provided && pick) note(answerKey, target.id, pick.confidence, "provider");
            note(`${key}.literal${j}`, String(lit.value), 1, "deterministic");
            // "Exclude accounts over $1m", "accounts with no gain over $50k": the rows to keep are the complement.
            const excludes = excluding || (!!adjacent && /\bno $/.test(clause.text.slice(0, adjacent.start)));
            const kept = excludes ? COMPLEMENT[operator] : operator;
            if (!kept) {
              clarifications.push({ id: `${key}.exclude`, prompt: EXCLUDE_PROMPT, required: true });
              return;
            }
            pred(target.id, kept, operator === "between" ? { min: lit.value, max: lit.upper ?? lit.value } : lit.value);
            // "At or below $1m" also leaves out rows with no amount, which "exclude accounts over $1m" didn't name.
            if (excludes) evidence.push({ key: `${key}.leftOutEmpty`, selectedId: target.id, confidence: 1, source: "deterministic" });
          });
          // "Over $1m or at Northgate": filters always combine with "and", so either-or across columns is asked about.
          // "Northgate or Harborline" is one column, and one filter.
          if (eitherAcrossColumns(clause.text, sides)) {
            clarifications.push({
              id: `${key}.either`,
              prompt: EITHER_PROMPT,
              required: true,
            });
            predicates.length = 0;
          }
          if (predicates.length === 0 && !clarifications.some((q) => q.id.startsWith(key))) {
            clarifications.push({
              id: `${key}.value`,
              prompt: `What should “${clause.text}” filter on? Include a value, such as an amount or a category.`,
              required: true,
            });
          }
          // A new filter replaces the view's current filters, as a new sort or grouping replaces the current one,
          // unless this part says to add to them: "also", "only those", "narrow it down" (ADR 0017). The request's
          // first filtering part decides; filters within one request always combine. One clear per plan, and none
          // after a reset or clear the request already asked for.
          const replacing =
            predicates.length > 0 &&
            predicatesIn(c.state.filters) > 0 &&
            !keepsFilters(clause.text) &&
            !operations.some((o) => o.type === "filter.add" || o.type === "filter.clear" || o.type === "view.reset");
          if (replacing) {
            operations.push({ type: "filter.clear" });
            evidence.push({ key: `${key}.filters`, selectedId: "replace", confidence: 1, source: "deterministic" });
          }
          for (const predicate of predicates) operations.push({ type: "filter.add", predicate, combineWith: "and" });
        } else {
          const capability = COLUMN_FAMILIES[family]?.[0] ?? "show";
          const answerKey = `${key}.${family}.column`;
          const answered = answers[answerKey] ? column(answers[answerKey]) : undefined;
          // This family takes the columns bound to it plus the free ones: never a column bound to another change,
          // and never a filter argument unless its role says so.
          const bound = new Set(boundTo(family) ?? []);
          const free = new Set(freeFor(family));
          const pool = picked.filter((col) => bound.has(col.id) || (changes.length < 2 && free.has(col.id)));
          let cols = (answered ? [answered] : pool).filter((col) =>
            COLUMN_FAMILIES[family]?.every((cap) => col.capabilities.includes(cap)),
          );
          if (answered) note(answerKey, answered.id, 1, "user");
          // A provider's own term wins. Core names one only when no "Did you mean …?" is pending here and the
          // Clause named nothing it recognised: it never calls a Host-declared name unknown.
          const pending = clarifications.some((q) => q.id.startsWith(`${key}.column.`));
          const unknown =
            cols.length > 0 ? undefined : (res.unmatchedTerms[0] ?? (pending || own.length > 0 ? undefined : unknownTerm(clause.text)));
          // A size word with no column named sorts by the Host's main value column. An unknown name, or a named column
          // that can't sort, is still asked about (review fix).
          const measure =
            cols.length === 0 && pool.length === 0 && family === "sort" && !pending && !unknown ? measureFor(clause.text) : undefined;
          if (measure) {
            cols = [measure];
            note(`${key}.measure`, measure.id, 1, "host");
          }
          if (cols.length === 0) {
            // A name several columns share was left to the provider; it is ambiguous, not missing (review fix).
            const sharing = unknown ? columnsNamed(unknown).filter((col) => col.capabilities.includes(capability as never)) : [];
            clarifications.push({
              id: answerKey,
              prompt:
                sharing.length > 1
                  ? `“${unknown}” could mean ${sharing.map((col) => col.label).join(" or ")}. Which column should be ${COLUMN_WORD[family]}?`
                  : unknown
                    ? `There's no column called “${unknown}”. Which column should be ${COLUMN_WORD[family]}?`
                    : `Which column should be ${COLUMN_WORD[family]}?`,
              options: sharing.length > 1 ? sharing.map((col) => ({ id: col.id, label: col.label })) : optionsFor(null, capability),
              required: true,
            });
            continue;
          }
          // Code keeps the order named; with reversal wording, the provider may say the later one is outer (Q6).
          const outerScore = (a: string, b: string) => res.outer?.find((o) => o.outerId === a && o.innerId === b)?.confidence ?? 0;
          const ids = cols.map((col) => col.id);
          const levelled = family === "sort" || family === "group";
          if (REVERSAL_WORDING.test(clause.text) && ids.length === 2) {
            const [first = "", second = ""] = ids;
            const outerKey = `${key}.${family}.outer`;
            if (levelled && answers[outerKey] !== undefined) {
              if (answers[outerKey] === second) ids.reverse();
              note(outerKey, answers[outerKey], 1, "user");
            } else if (levelled && res.outer === undefined) {
              // Nobody was asked which level is outer (a focused strategy, or a provider without the question), and
              // the wording may reverse the named order: ask rather than keep it (pre-launch fix).
              clarifications.push({
                id: outerKey,
                prompt: family === "sort" ? "Which should be the primary sort?" : "Which should be the outer grouping?",
                options: [first, second].map((id) => ({ id, label: column(id)?.label ?? id })),
                required: true,
              });
              continue;
            } else if (outerScore(second, first) >= FAN_OUT.outer && outerScore(second, first) > outerScore(first, second)) {
              ids.reverse();
              evidence.push({ key: `${key}.outer`, selectedId: second, confidence: outerScore(second, first), source: "provider" });
            }
          }
          // "Also group by advisor": add a level to the current view's sort or grouping instead of replacing it (Q7).
          // With no answer to that question, "also" or "too" is asked about, since it may add to the view or only
          // join this part to the one before it (pre-launch fix).
          const addsKey = `${key}.${family}.adds`;
          const replaces = REPLACES.test(clause.text);
          const existing = family === "sort" ? c.state.sorts.length > 0 : family === "group" && c.state.groupBy.length > 0;
          let adds = (res.adds ?? 0) >= FAN_OUT.adds && !replaces;
          if (levelled && res.adds === undefined && !replaces && existing && ADDS_WORDING.test(clause.text)) {
            if (answers[addsKey] === undefined) {
              clarifications.push({
                id: addsKey,
                prompt: `Add ${ids.map((id) => column(id)?.label ?? id).join(" and ")} to the current ${family === "sort" ? "sort" : "grouping"}, or replace it?`,
                options: [
                  { id: "add", label: "Add a level" },
                  { id: "replace", label: "Replace it" },
                ],
                required: true,
              });
              continue;
            }
            adds = answers[addsKey] === "add";
            note(addsKey, answers[addsKey], 1, "user");
          }
          if (family === "sort") {
            const direction =
              clause.direction ?? (res.direction && res.direction.confidence >= bands.ready ? (res.direction.id as "asc" | "desc") : "asc");
            const sorts = ids.map((columnId) => ({ columnId, direction }));
            const current = levelsOf("sort.set", REPLACES.test(clause.text));
            const base = !current && adds && !operations.some((o) => o.type === "sort.set") ? c.state.sorts : [];
            if (base.length > 0) note(`${key}.adds`, "sort", res.adds ?? 0, "provider");
            if (current?.type === "sort.set")
              current.sorts.push(...sorts.filter((s) => !current.sorts.some((x) => x.columnId === s.columnId)));
            else
              operations.push({ type: "sort.set", sorts: [...base, ...sorts.filter((s) => !base.some((x) => x.columnId === s.columnId))] });
          } else if (family === "group") {
            const current = levelsOf("group.set", REPLACES.test(clause.text));
            const base = !current && adds && !operations.some((o) => o.type === "group.set") ? c.state.groupBy : [];
            if (base.length > 0) note(`${key}.adds`, "group", res.adds ?? 0, "provider");
            if (current?.type === "group.set") current.columnIds.push(...ids.filter((id) => !current.columnIds.includes(id)));
            else operations.push({ type: "group.set", columnIds: [...base, ...ids.filter((id) => !base.includes(id))] });
          } else if (family === "columns.hide") operations.push({ type: "columns.hide", columnIds: ids });
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
      // A direction in the text ("largest first", "high to low") asks for a sort even when the provider picked only
      // another change for this part: "accounts excluding trusts, largest first". It is never silently dropped, and
      // code never guesses its column: the User picks one, unless a size word names the Host's `defaultMeasure`.
      if (clause.direction && !viewFamilies.includes("sort")) {
        const answerKey = `${key}.sort.column`;
        const answered = answers[answerKey] ? column(answers[answerKey]) : undefined;
        // "Trusts, largest first": a size word sorts by the Host's main value column, when it declares one (ADR 0018).
        const measure = answered ? undefined : measureFor(clause.text);
        const chosen = answered?.capabilities.includes("sort") ? answered : measure;
        if (chosen) {
          if (chosen === measure) note(`${key}.measure`, chosen.id, 1, "host");
          else note(answerKey, chosen.id, 1, "user");
          const sort = { columnId: chosen.id, direction: clause.direction };
          // Joins the sort still in effect, never one a later reset or "instead" has cleared (review fix).
          const current = levelsOf("sort.set", REPLACES.test(clause.text));
          if (current?.type === "sort.set") {
            if (!current.sorts.some((x) => x.columnId === sort.columnId)) current.sorts.push(sort);
          } else operations.push({ type: "sort.set", sorts: [sort] });
        } else {
          evidence.push({ key: `${key}.direction`, selectedId: "sort", confidence: 1, source: "deterministic" });
          clarifications.push({
            id: answerKey,
            prompt: `Which column should be ${COLUMN_WORD.sort}?`,
            options: optionsFor(null, "sort"),
            required: true,
          });
        }
      }
      // "Top 10": the count shows only the first rows of the sorted view, where the grid can (ADR 0018). Elsewhere the
      // plan sorts alone and keeps the count as dropped evidence, which the Preview names in its notes.
      if (clause.limit !== undefined) {
        if (c.operations?.includes("limit.set")) {
          const earlier = operations.findIndex((o) => o.type === "limit.set");
          if (earlier >= 0) operations.splice(earlier, 1);
          operations.push({ type: "limit.set", count: clause.limit });
          note(`${key}.limit`, String(clause.limit), 1, "deterministic");
        } else {
          evidence.push({ key: `dropped:${key}.limit`, selectedId: String(clause.limit), confidence: 1, source: "host" });
        }
      }
      // G2. The provider proposes, code decides (AGENTS.md): a plan is never ready with fewer clears than the clear
      // verb governs. "Clear filters, grouping" that would clear only the filters asks instead.
      const governedHere = governedClears(unquoted(namesBlankedOf(clause.text, ownMentions)));
      const added = operations.slice(opsBefore);
      const clearedHere: Record<string, boolean> = {
        filter: added.some((o) => o.type === "filter.clear"),
        sort: added.some((o) => o.type === "sort.set"),
        group: added.some((o) => o.type === "group.set"),
        view: added.some((o) => o.type === "view.reset"),
      };
      const missed = [...governedHere.governed].filter((thing) => !clearedHere[thing] && !clearedHere.view);
      if (missed.length > 0 && !clarifications.some((q) => q.id.startsWith(`${key}.`))) {
        const words: Record<string, string> = { filter: "the filters", sort: "the sort", group: "the grouping", view: "the view" };
        clarifications.push({
          id: `${key}.clear`,
          prompt: `GridCue couldn't settle clearing ${missed.map((t) => words[t] ?? t).join(" and ")}. Ask to clear it on its own.`,
          required: true,
        });
      }
    }
  }

  // A "No" never dead-ends (v1 grill, Q1): when the User declined something in a part and all that is left there
  // is a question with no choices, say plainly that nothing will change, with the request kept for editing.
  for (const clause of c.input.clauses) {
    const key = `c${clause.index}`;
    const declined = Object.entries(answers).some(([k, v]) => k.startsWith(`${key}.`) && v === "none");
    const open = clarifications.filter((q) => q.id === key || q.id.startsWith(`${key}.`));
    // Only GridCue's generic "nothing to do here" questions are replaced; an independent question, such as an
    // unreadable number, stays (review fix).
    const deadEnd = (q: Clarification) => !q.options?.length && (q.id === `${key}.family` || q.id === `${key}.value`);
    if (declined && open.length > 0 && open.every(deadEnd)) {
      for (const q of open) clarifications.splice(clarifications.indexOf(q), 1);
      clarifications.push({ id: `${key}.declined`, prompt: "Okay, nothing will change. Rephrase or edit your request.", required: true });
    }
  }

  let status: ViewPlan["status"] =
    unsupportedSegments.length > 0 ? "unsupported" : clarifications.length > 0 || operations.length === 0 ? "needs_clarification" : "ready";
  // Last step (ADR 0019): a ready plan uses everything code read. Anything left over is asked about, by its words.
  // This can only turn a ready plan into a question.
  if (status === "ready") {
    const asked = new Set<number>();
    for (const left of unusedReadings(c.input, c.mentions ?? [], operations, evidence, c.schema.rowNoun)) {
      if (asked.has(left.clauseIndex)) continue;
      asked.add(left.clauseIndex);
      clarifications.push({
        id: `c${left.clauseIndex}.unused`,
        prompt: `I'm not sure what to do with “${left.text}”. Try rephrasing that part.`,
        required: true,
      });
      status = "needs_clarification";
    }
  }
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

const EXCLUDE_PROMPT = "GridCue can only leave out rows that match one simple condition. Ask for the rows to keep instead.";
/** The comparison that keeps the rows another one leaves out. "Equal to", "between" and "containing" have none here. */
const COMPLEMENT: Partial<Record<FilterPredicate["operator"], FilterPredicate["operator"]>> = {
  gt: "lte",
  gte: "lt",
  lt: "gte",
  lte: "gt",
};
const namesBlankedOf = (text: string, own: readonly Mention[]) =>
  own.reduce((t, m) => t.slice(0, m.start) + " ".repeat(m.end - m.start) + t.slice(m.end), text);

/** Whether a name appears in the part only inside quoted text: `advisor containing "restricted"`. */
const onlyQuoted = (text: string, names: readonly string[]) => {
  const bare = unquoted(text);
  const has = (t: string, n: string) => {
    const at = t.indexOf(n);
    return at >= 0 && !/[\p{L}\p{N}]/u.test(t[at - 1] ?? "") && !/[\p{L}\p{N}]/u.test(t[at + n.length] ?? "");
  };
  const lower = names.map((n) => n.toLowerCase()).filter(Boolean);
  return lower.some((n) => has(text, n)) && !lower.some((n) => has(bare, n));
};

/**
 * Narrows what a provider proposes for one part, before the compiler weighs it. The provider proposes, code decides
 * (AGENTS.md, "What we never compromise on", 2):
 * - G1: a column or value the provider picked that no Mention names, and whose names appear in the part only inside
 *   quoted text, is not something the User named ("advisor containing "restricted"" names no Restricted holdings).
 * - G3: in a part whose words are only a governed clear or reset, naming no column, value or amount, a family other
 *   than a clear or reset is not something the User asked for ("clear everything", with a proposed hide).
 * Each dropped proposal is recorded as `dropped:` evidence.
 */
const narrowProposal = (
  res: ClauseResolution,
  clause: Clause,
  own: readonly Mention[],
  schema: ViewSchema,
  bands: ConfidencePolicy,
  record: (e: DecisionEvidence) => void,
): ClauseResolution => {
  const key = `c${clause.index}`;
  const named = new Set(own.map((m) => m.columnId));
  const col = (id: string) => schema.columns.find((c) => c.id === id);
  const columnNames = (id: string) => [col(id)?.label ?? "", ...(col(id)?.aliases ?? [])];
  const valueNames = (columnId: string, valueId: string) => {
    const v = col(columnId)?.enumValues?.find((e) => e.id === valueId);
    return [...columnNames(columnId), ...(v ? [v.label, ...(v.aliases ?? [])] : [])];
  };
  let out = res;
  if (clause.literals.some((l) => l.kind === "text")) {
    const quotedColumn = (id: string) => !named.has(id) && onlyQuoted(clause.text, columnNames(id));
    const columns = out.columns.filter((p) => !quotedColumn(p.id));
    const values = out.values.filter((v) => named.has(v.columnId) || !onlyQuoted(clause.text, valueNames(v.columnId, v.valueId)));
    for (const p of out.columns.filter((x) => !columns.includes(x)))
      record({ key: `dropped:${key}.quoted`, selectedId: p.id, confidence: p.confidence, source: "deterministic" });
    for (const v of out.values.filter((x) => !values.includes(x)))
      record({ key: `dropped:${key}.quoted`, selectedId: `${v.columnId}=${v.valueId}`, confidence: v.confidence, source: "deterministic" });
    out = { ...out, columns, values };
  }
  const clears = governedClears(unquoted(namesBlankedOf(clause.text, own)));
  if (clears.governed.size > 0 && own.length === 0 && clause.literals.length === 0) {
    const isClear = (f: string) => CLEARS.has(f) || f === "view.reset" || f.startsWith("unsupported.");
    const families = out.families.filter((f) => isClear(f.id));
    for (const f of out.families.filter((x) => !isClear(x.id)))
      record({ key: `dropped:${key}.family`, selectedId: f.id, confidence: f.confidence, source: "deterministic" });
    // The words decide which clear it is: a clear or reset the verb governs ("clear everything" → the view), proposed
    // in the Host's clarify band or above, is taken as asked. Nothing the words don't govern is raised.
    const THING: Record<string, string> = { "filter.clear": "filter", "sort.clear": "sort", "group.clear": "group", "view.reset": "view" };
    const raised = families.map((f) =>
      clears.governed.has(THING[f.id] ?? "") && f.confidence >= bands.clarify ? { ...f, confidence: 1 } : f,
    );
    const { roles: _roles, ...rest } = out;
    out = { ...rest, families: raised };
  }
  return out;
};

const NEGATED_VERB =
  /^(?:don't|dont|do not|never|no longer|not) (?!(?:show|include|display|list|see)\b)(?:hide|unhide|exclude|remove|drop|sort|order|group|ungroup|filter|clear|reset|keep|pin|move|add|put|rank|arrange)\b/;
const NEGATION_WORD =
  /\b(?:not|no(?! (?:more|less|greater|fewer|higher|lower|larger|smaller|bigger|over|under|above|below)\b)|never|don't|dont|without|excluding|non)\b/g;
/**
 * More ways to say "not", read beside quoted text, before or after it: `advisor isn't "Lane"`, `advisor != "Lane"`,
 * "other than", "except", `advisor "Lane" excluded`.
 */
const TEXT_NEGATION =
  /\b(?:isn't|aren't|doesn't|other than|apart from|besides|except|exclude[sd]|omit(?:s|ted)?|ignor(?:e|es|ed|ing)|(?:leave|leaving|left) out)\b|!=|=\/=|≠|<>/g;
/** The negations GridCue reads as "No" for a yes/no name: "not restricted", "non-restricted", "no restricted holdings". */
const BOOLEAN_NOT = /^(?:not|no|non|without)$/;
const NOT_THERE = "GridCue can't filter for text that isn't there. Ask for the text to look for instead.";
const BANG_PROMPT = "GridCue can't tell what “!” leaves out. Say which rows to show.";
/** What may sit between a negation and the value it belongs to: "not at Northgate", "non-retirement", "no restricted". */
const ATTACHED_GAP = /^[\s-]+(?:(?:at|in|from|with|the|any) )?$/;
/** The words the Mentions read as leaving the value after them out (`LEAVES_OUT`), and nothing else. */
const LEFT_OUT = new RegExp(`^${LEAVES_OUT}$`);
/**
 * Why a part's negation is unsure, as a question, or `undefined`. `bare` is the part with quoted text blanked;
 * `own` its Mentions. A negation attached to one named value or yes/no name ("non-retirement", "not at Northgate",
 * "no restricted holdings") belongs to that value; any other negation, with a second negation of either kind, asks.
 */
const unsureNegation = (
  bare: string,
  own: readonly Mention[],
  quoted = false,
  isBoolean: (columnId: string) => boolean = () => false,
): string | undefined => {
  // A "!" left in a part says "not" (normalize splits on every other one), and nothing reads it as leaving a name out:
  // `!advisor "Lane"` and `advisor "Lane" !trusts` would show the very rows the User asked to leave out.
  if (/!(?!=)/.test(bare)) return BANG_PROMPT;
  const text = own.reduce((t, m) => t.slice(0, m.start) + " ".repeat(m.end - m.start) + t.slice(m.end), bare);
  const afterLead = text.slice(LEAD_IN.exec(text)?.[0].length ?? 0);
  if (NEGATED_VERB.test(afterLead)) {
    return "GridCue can't act on a request not to change something. Say what you want to see instead.";
  }
  // "Sort by gain, not value", "hide custodian, not advisor": a negated column in a column change.
  const columnChange = /\b(?:sort|order|group|hide|unhide|show)(?:ed|s)?\b/.test(text);
  const negations = [...text.matchAll(NEGATION_WORD)];
  const attachedTo = (n: RegExpMatchArray) => {
    const end = (n.index ?? 0) + n[0].length;
    return own.find((m) => m.start >= end && ATTACHED_GAP.test(bare.slice(end, m.start)));
  };
  const negatedColumn = negations.some((n) => {
    const m = attachedTo(n);
    return !!m && m.valueId === undefined && !/^(?:no|non|without)$/.test(n[0]);
  });
  if (columnChange && negatedColumn) return "GridCue can't tell what “not” leaves out of that change. Name only the columns you want.";
  if (/\b(?:not|doesn't|does not|don't|do not|never)\s+contain/.test(text)) return NOT_THERE;
  // Beside quoted text, a negation asks unless it belongs to a named value or yes/no name ("non-retirement"):
  // `advisor is not "Avery Lane"` would otherwise show the very rows the User asked to leave out. It belongs to a value
  // only when the value is read as left out, and to a yes/no name only when GridCue reads it as "No":
  // `advisor "Lane" except restricted` asks, since nothing reads "except" as "No".
  if (quoted) {
    const owned = (n: RegExpMatchArray) => {
      const m = attachedTo(n);
      if (m) return m.valueId !== undefined ? !!m.negated : isBoolean(m.columnId) && BOOLEAN_NOT.test(n[0]);
      // ...or it is one of the words the Mentions read as leaving the next value out: "not including trusts", "don't
      // show trusts".
      const at = n.index ?? 0;
      const next = own.filter((x) => x.start > at).sort((a, b) => a.start - b.start)[0];
      return !!next && next.valueId !== undefined && !!next.negated && LEFT_OUT.test(bare.slice(at, next.start));
    };
    if ([...negations, ...text.matchAll(TEXT_NEGATION)].some((n) => !owned(n))) return NOT_THERE;
  }
  if (/\bno (?:grouping|groups?|sort|sorting|filters?)\b/.test(text)) {
    return "GridCue can't tell whether “no” there clears something. Ask to clear it on its own.";
  }
  const attached = negations.filter((n) => attachedTo(n)).length;
  const loose = negations.length - attached;
  if (loose > 1 || (loose > 0 && attached > 0)) {
    return "That part says “not” more than once, so GridCue can't tell which rows you want. Say which rows to show.";
  }
  if (/\bnothing\b/.test(text) || /(?<!\bnot )\bincluding\b/.test(text)) {
    return "GridCue can't tell whether that keeps those rows or leaves them out. Say which rows to show.";
  }
  return undefined;
};
const EITHER_PROMPT = "GridCue can only show rows that match every condition, not either one. Ask for one at a time.";

/**
 * What a "keep" part keeps, as operations, or a question that says why GridCue can't. Filters are kept only after a
 * clear of the filters or a reset, from current filters that are one "and" list, and only when what is named is
 * exactly a current filter: a literal by its comparison and value, a named value by a filter holding that value alone,
 * a yes/no named alone by the filter for that answer ("non-restricted" never keeps "Restricted: Yes"), and another
 * column named alone by every filter on it. "Keep the grouping" or "keep the sort" restores it after a reset, and is
 * nothing to do after a clear that doesn't touch it.
 */
const keepPart = (
  clause: Clause,
  own: readonly Mention[],
  state: ViewState,
  defaultState: { filters: ViewState["filters"] } | undefined,
  operations: readonly ViewOperation[],
  column: (columnId: string) => ColumnDescriptor | undefined,
  newId: (prefix: string) => string,
  rowNoun: string | undefined,
): { operations: ViewOperation[] } | { prompt: string } => {
  const what = clause.text.replace(/^(?:keep(?:ing)?|leave) /, "");
  const reset = operations.some((o) => o.type === "view.reset");
  // "Everything but the filters" leaves the filters as they are, and kept filters are added after the reset, to
  // whatever filters the default view has. With any there, or with the default view unknown, GridCue asks. One
  // named filter kept through a reset ("reset the view but keep accounts over $1m") is the default view plus it.
  const resetBringsFilters = reset && (!defaultState || predicatesIn(defaultState.filters) > 0);
  const throughReset = {
    prompt:
      "A reset brings back the default view's own filters, so GridCue can't keep yours through it. Clear the sort and the grouping instead.",
  };
  // "The sort", "the grouping", or both: "keep the sort and the grouping".
  const LAYOUT = /^(?:the )?(?:(grouping|groups?)|(sort|sorting|sorts|order))$/;
  const items = what.split(/,? and |, /);
  const layouts = items.map((item) => LAYOUT.exec(item));
  if (layouts.every((l) => l)) {
    const kept: ViewOperation[] = [];
    for (const layout of layouts) {
      const grouping = !!layout?.[1];
      const cleared = operations.some((o) => (grouping ? o.type === "group.set" : o.type === "sort.set"));
      const now = grouping ? state.groupBy : state.sorts;
      if (cleared && !reset) return { prompt: `GridCue can't clear the ${grouping ? "grouping" : "sort"} and keep it too.` };
      if (!reset) continue;
      if (now.length === 0) return { prompt: `There's no ${grouping ? "grouping" : "sort"} in the view to keep.` };
      kept.push(grouping ? { type: "group.set", columnIds: [...state.groupBy] } : { type: "sort.set", sorts: [...state.sorts] });
    }
    return { operations: kept };
  }
  // "Clear everything but the filter": every current filter, when they are one "and" list.
  if (/^(?:the |my |all (?:the )?)?filters?$/.test(what) && reset) {
    const current = state.filters;
    if (!current || current.children.length === 0) return { prompt: "There are no filters in the view to keep." };
    if (resetBringsFilters) return throughReset;
    if (current.combinator !== "and" || current.children.some((ch) => "children" in ch)) {
      return { prompt: "GridCue can't keep these filters through a reset. Reset the view, then ask for the filters again." };
    }
    return {
      operations: (current.children as FilterPredicate[]).map(
        (p): ViewOperation => ({ type: "filter.add", predicate: { ...p, id: newId("filter") }, combineWith: "and" }),
      ),
    };
  }
  if (layouts.some((l) => l))
    return { prompt: "GridCue can keep the sort and the grouping, or filters, but not both in one part. Ask for them one at a time." };
  const absent = { prompt: `“${what}” isn't one of the current filters, so GridCue can't keep it. Clear the filters, then ask for it.` };
  if (!reset && !operations.some((o) => o.type === "filter.clear")) {
    return { prompt: `GridCue can keep a filter only when it clears the filters or resets the view. Ask for “${what}” on its own.` };
  }
  const current = state.filters;
  if (!current) return absent;
  if (current.combinator !== "and") {
    return {
      prompt:
        "The current filters match rows by any one of them, so GridCue can't keep just one. Clear the filters, then ask for the ones you want.",
    };
  }
  if (current.children.some((ch) => "children" in ch)) {
    return { prompt: "The current filters are nested, so GridCue can't keep just one. Clear the filters, then ask for the ones you want." };
  }
  const preds = current.children as FilterPredicate[];
  const keep = new Set<FilterPredicate>();
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const lit of clause.literals) {
    if (lit.kind === "unreadable") return absent;
    const operator = lit.kind === "text" ? "contains" : (lit.comparator ?? "eq");
    const value = lit.comparator === "between" ? { min: lit.value, max: lit.upper ?? lit.value } : lit.value;
    const quotedAfter = lit.kind === "text" ? columnBeforeText(clause, lit, own, column, rowNoun) : undefined;
    if (quotedAfter && !quotedAfter.read) return absent;
    // The words beside the text are checked as they are for a new filter: `advisor "Lane" exactly` keeps nothing.
    const unread = lit.kind === "text" ? textWordsQuestion(clause, lit, quotedAfter, own, rowNoun) : undefined;
    if (unread) return { prompt: unread.prompt };
    // A column named right before the amount must be the filter's; with none, exactly one filter may match.
    const owner =
      quotedAfter?.mention ??
      own.filter((m) => m.valueId === undefined && m.end <= lit.at && ADJACENT_COMPARISON.test(clause.text.slice(m.end, lit.at))).at(-1);
    const matches = preds.filter((p) => p.operator === operator && same(p.value, value) && (!owner || p.columnId === owner.columnId));
    if (matches.length !== 1 || !matches[0]) return absent;
    keep.add(matches[0]);
  }
  const values = own.filter((m) => m.valueId !== undefined);
  for (const m of values) {
    if (m.negated) return absent;
    const on = preds.find((p) => p.columnId === m.columnId);
    // Keeping one value of a filter that holds several ("northgate" from Northgate or Harborline) would keep them all.
    if (on && Array.isArray(on.value) && on.value.length > 1 && on.value.includes(m.valueId ?? "")) {
      return {
        prompt: `The current filter holds more than “${clause.text.slice(m.start, m.end)}”, so GridCue can't keep only that part. Clear the filters, then ask for it.`,
      };
    }
    const match = preds.find(
      (p) =>
        p.columnId === m.columnId &&
        (String(p.value) === m.valueId || (Array.isArray(p.value) && p.value.length === 1 && p.value[0] === m.valueId)),
    );
    if (!match) return absent;
    keep.add(match);
  }
  if (clause.literals.length === 0 && values.length === 0) {
    const named = own.filter((x) => x.valueId === undefined && !x.ambiguous);
    if (named.length === 0) return absent;
    for (const m of named) {
      const negated = /\b(?:non|not|no|without)[\s-]*$|\bun$/.test(clause.text.slice(0, m.start));
      const on = preds.filter(
        (p) => p.columnId === m.columnId && (column(m.columnId)?.kind !== "boolean" || (p.operator === "eq" && p.value === !negated)),
      );
      if (on.length === 0 || (negated && column(m.columnId)?.kind !== "boolean")) return absent;
      for (const p of on) keep.add(p);
    }
  }
  if (keep.size === 0) return absent;
  return {
    operations: preds
      .filter((p) => keep.has(p))
      .map((p): ViewOperation => ({ type: "filter.add", predicate: { ...p, id: newId("filter") }, combineWith: "and" })),
  };
};

const KIND_WORDS: Record<string, string> = {
  number: "numbers",
  currency: "amounts",
  percent: "percentages",
  date: "dates",
  text: "text",
  unreadable: "numbers",
};

/** "Or" right after an amount that only changes its comparison: "$1m or more", "$1m or so". */
const OR_QUALIFIER =
  / (?:so|more|less|above|below|over|under|higher|lower|greater|fewer|better|worse|thereabouts|equal)\b(?! ?(?:than )?[-−$\d])/y;
const AMOUNT_TAIL = /\d ?(?:(?:k|thousand|mm|m|million|bn|b|billion) ?)?(?:(?:%|percent|dollars) ?)?$/;
/** Whether an "or" sits between two conditions on different columns: "value over $1m or gain over $50k". */
const eitherAcrossColumns = (text: string, sides: ReadonlyArray<{ at: number; columnId: string }>): boolean => {
  const bare = unquoted(text);
  for (const m of bare.matchAll(/\bor\b/g)) {
    const at = m.index ?? 0;
    OR_QUALIFIER.lastIndex = at + 2;
    if (AMOUNT_TAIL.test(bare.slice(Math.max(0, at - 16), at)) && OR_QUALIFIER.test(bare)) continue;
    const left = sides
      .filter((s) => s.at < at)
      .sort((a, b) => a.at - b.at)
      .at(-1);
    const right = sides.filter((s) => s.at > at).sort((a, b) => a.at - b.at)[0];
    if (left && right && left.columnId !== right.columnId) return true;
  }
  return false;
};

/**
 * Words that may sit between an amount and what comes after it without changing its comparison. They pass only when
 * something GridCue reads follows them (`followedByRead`): "$1m, grouped by custodian" passes, "$1m, roughly" and
 * "$1m with a margin" don't.
 */
const JOINERS =
  /(?:[\s,;.]|[-–](?= )|\b(?:and|or|but|then|also|with|without|at|in|for|from|where|whose|that|which|who|by|of|on|the|all|only|just|to|is|are|has|have|having|please)\b)*/y;
/** Words that start something GridCue reads: a view verb or a direction. */
const VIEW_WORD =
  /(?:show|only|keep|hide|unhide|group|sort|order|filter|where|display|list|include|exclude|clear|reset|remove|largest|biggest|smallest|highest|lowest|top|bottom|first|last|ascending|descending|asc|desc)(?:ed|s)?\b/y;
/** A comparison word, read only when an amount follows it: "and under $5m". */
const COMPARISON_WORDS =
  /(?:(?:no |not )?(?:over|under|above|below|exceeding|(?:more|less|greater|fewer|higher|lower|larger|smaller|bigger) than|at (?:least|most)|up to|between|since|before|after)|[<>=≤≥]{1,2}) ?/y;

const sticky = (re: RegExp, text: string, at: number) => {
  re.lastIndex = at;
  return re.exec(text);
};

/** Whether what follows `at` in a part is the end, or, after joining words, something GridCue reads. */
const DANGLING =
  /\b(?:and|or|but|then|with|without|at|in|for|from|where|whose|that|which|who|by|of|on|the|to|is|are|has|have|having)\b[\s,;.]*$/;
const followedByRead = (clause: Clause, at: number, own: readonly Mention[], names: readonly string[]): boolean => {
  const text = unquoted(clause.text);
  const joined = sticky(JOINERS, text, at)?.[0] ?? "";
  const p = at + joined.length;
  // A part that stops on a joining word ("$1m or", "over $1m but", "under $5k and the") was cut off: ask.
  if (p >= text.length) return !DANGLING.test(joined);
  if (clause.text[p] === '"') return true;
  if (own.some((m) => m.start === p) || clause.literals.some((l) => l.at === p)) return true;
  if (sticky(VIEW_WORD, text, p)) return true;
  const comparison = sticky(COMPARISON_WORDS, text, p);
  if (comparison && clause.literals.some((l) => l.at === p + comparison[0].length)) return true;
  // A row word, or a name the Host declared even where no Mention was kept: "over $1m in value".
  return ["row", "one", "record", ...names].some((name) => {
    if (!name || !text.startsWith(name, p)) return false;
    const rest = text.slice(p + name.length, p + name.length + 3);
    return !/^(?:es|s)?[\p{L}\p{N}]/u.test(rest);
  });
};

/**
 * Whether GridCue can't be sure how an amount compares (ADR 0019's spirit: ask, never guess). Read only when what
 * follows it is the end of the part or something GridCue reads, a comparison after it agrees with any before it
 * ("over $1m or so" asks), and, with no comparison word at all, it sits right by its column (see `PLAIN_GAP`).
 */
const comparisonUnread = (clause: Clause, lit: Literal, own: readonly Mention[], names: readonly string[]): boolean => {
  if (lit.kind === "text" || lit.kind === "unreadable") return false;
  let end = lit.at + literalText(clause.text, lit).length;
  const trailing = trailingComparison(clause.text.slice(end, end + 40), lit.kind === "date");
  if (trailing) {
    if (trailing.comparator !== lit.comparator) return true;
    end += trailing.length;
  }
  if (!followedByRead(clause, end, own, names)) return true;
  if (lit.comparator !== undefined) return false;
  const named = own.filter((m) => m.valueId === undefined && !m.ambiguous);
  // The column named right before the amount: "market value $750k".
  const before = named
    .filter((m) => m.end <= lit.at)
    .sort((a, b) => a.end - b.end)
    .at(-1);
  if (before && PLAIN_GAP.test(clause.text.slice(before.end, lit.at))) return false;
  // The column named right after it: "accounts with 5 positions".
  const after = named.find((m) => m.start >= end && /^\s*$/.test(clause.text.slice(end, m.start)));
  if (after && PLAIN_BEFORE_AMOUNT.test(clause.text.slice(Math.max(0, lit.at - 16), lit.at))) {
    return !followedByRead(clause, after.end, own, names);
  }
  return true;
};

/** Whether an ISO date is a real day: "2026-02-31" and "2026-00-15" are not. */
const realDay = (iso: string): boolean => {
  const [y = 0, m = 0, d = 0] = iso.split("-").map(Number);
  const day = new Date(0);
  day.setUTCFullYear(y, m - 1, d);
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d;
};

/**
 * What may sit between a column and quoted text read as "containing": nothing, ":", "is", "are", or a containing word,
 * after a possessive ("advisor's").
 */
const CONTAINING_GAP = /^(?:'s)?\s*(?::\s*|(?:is|are|containing|contains|includes|has|like|matching)\s+)?$/;
/** "Column" after any column's name, and "name" after one that names another record ("advisor name"), are part of it. */
const COLUMN_WORD_AFTER = /^\s*columns?\b/;
const NAME_WORD = /^\s*names?\b/;
/** The Row Noun before "for" is the rows beside quoted text: `accounts for "Avery Lane"` names no column. */
const FOR_AFTER = /^\s*for\b/;
const rowNounKey = (words: string) => words.toLowerCase().replace(/(?:es|s)$/, "");
const isRowNounBeforeFor = (clause: Clause, m: Mention, rowNoun: string | undefined) =>
  !!rowNoun &&
  m.valueId === undefined &&
  rowNounKey(clause.text.slice(m.start, m.end)) === rowNounKey(rowNoun) &&
  FOR_AFTER.test(clause.text.slice(m.end));

/**
 * The column named last before quoted text, and whether only words GridCue reads as "containing" sit between them.
 * `advisor starts with "Av"` and `advisor named "Lane"` are not read: this is a rule, not a list of bad words. The Row
 * Noun before "for" names no column, so `accounts for "Avery Lane"` asks which column should contain the text.
 */
const columnBeforeText = (
  clause: Clause,
  lit: Literal,
  own: readonly Mention[],
  column: (columnId: string) => ColumnDescriptor | undefined,
  rowNoun: string | undefined,
): { mention: Mention; read: boolean } | undefined => {
  const mention = own
    .filter((m) => m.valueId === undefined && m.end <= lit.at)
    .sort((a, b) => a.end - b.end)
    .at(-1);
  if (!mention || isRowNounBeforeFor(clause, mention, rowNoun)) return undefined;
  const gap = clause.text.slice(mention.end, lit.at);
  const word = COLUMN_WORD_AFTER.exec(gap) ?? (column(mention.columnId)?.entity ? NAME_WORD.exec(gap) : null);
  return { mention, read: CONTAINING_GAP.test(gap.slice(word?.[0].length ?? 0)) };
};

/**
 * A joining word: "and", "or" or "then", with "also" after it ("and also"), or "but" before "only" or a sort or
 * grouping ("but sorted by value").
 */
const JOIN = String.raw`(?:(?:and|or|then)\s+(?:also\s+)?|but\s+(?=only\b|sort|order|group))?(?:only\s+)?`;
/**
 * What joins the rows to a column, before it or after quoted text: "with", "where", "whose", "having", "holding", "that
 * have", "which have", "that are", "which are" or "who are".
 */
const ROWS_JOIN = String.raw`(?:with|where|whose|having|holding|(?:that|which) have|(?:that|which|who) (?:are|is))\s+`;
/** A possessive right after quoted text: `advisor "Lane"'s accounts`. */
const POSSESSIVE = "(?:'s)?";
/**
 * What may sit after quoted text and before the next name: a joining word, then "with", a sort or grouping ("sorted
 * by", or "by" before a column: "largest by value"), or a view verb. Before a named value, a preposition is read as
 * it is anywhere ("at Northgate", "in the taxable accounts"). Before a value the Mentions read as left out, so are the
 * words that left it out ("but trusts", "not including trusts"); before any other name, only "not", "no", "non" or
 * "without" ("not restricted"). `nounWords` is the Row Noun, read first ("accounts at Northgate").
 *
 * Before a column whose own value the next name leaves out ("at every custodian other than Northgate"), only a joining
 * word, a preposition and "every", "each", "all" or "any" are read: the negation belongs to the named value.
 */
const afterText = (next: Mention, nounWords: string, leavesOwnValue = false) => {
  const value = next.valueId !== undefined;
  if (!value && leavesOwnValue) return new RegExp(String.raw`^[\s,]*${nounWords}${JOIN}(?:${PREPOSITION})?(?:every|each|all|any)\s+$`);
  const sort = String.raw`(?:sorted|ordered|grouped|sort|order|group)\s+(?:by\s+)?${value ? "" : String.raw`|by\s+|in\s+order\s+of\s+`}`;
  const leaves =
    value && next.negated ? String.raw`(?:(?:but\s+(?!but\b))?${LEAVES_OUT})?` : String.raw`(?:(?:but\s+)?(?:not|no|non|without)[\s-]+)?`;
  return new RegExp(
    String.raw`^${POSSESSIVE}[\s,]*${nounWords}${JOIN}(?:${ROWS_JOIN}|${sort}|(?:hide|show|unhide)\s+)?${value ? `(?:${PREPOSITION})?${PREPOSITION_DETERMINER}` : ""}${leaves}$`,
  );
};
/** Thanks at the end of a part, or at the start of a request before a comma. */
const COURTESY = String.raw`(?:thanks|thank you)\b`;
const COURTESY_LEAD = new RegExp(String.raw`^\s*${COURTESY}\s*,\s*`);
/** What may end a part after quoted text: any of "please", "too", "also", "only" and "as well", then "thanks". */
const afterTextEnd = (nounWords: string) =>
  new RegExp(String.raw`^${POSSESSIVE}[\s,]*${nounWords}(?:(?:please|too|also|only|as well)\b[\s,]*)*(?:${COURTESY})?[\s.!?]*$`);
/** The negation words between a column and its own value that the Mentions read as left out: "other than", "except". */
const LEAVES_OWN_VALUE = new RegExp(String.raw`^\s*${LEAVES_OUT}$`);
/** What may sit between quoted text and an amount's comparison: a joining word, "with", and "valued" or "worth". */
const afterTextJoin = (nounWords: string) =>
  new RegExp(String.raw`^${POSSESSIVE}[\s,]*${nounWords}${JOIN}(?:${ROWS_JOIN})?(?:(?:valued|worth)\s+)?`);

/**
 * The part's text with the direction and the count GridCue reads blanked ("largest first", "top 10", "sorted
 * descending", "in descending order"), so the words beside quoted text are checked without them. A direction is
 * blanked only when nothing but names and the Row Noun sits inside it ("largest value first"): `largest exact first`
 * and `largest "Lane" first` keep their words, and ask.
 */
const withoutDirection = (clause: Clause, own: readonly Mention[], noun: RegExp | undefined): string => {
  if (clause.direction === undefined && clause.limit === undefined) return clause.text;
  const bare = unquoted(clause.text);
  // By UTF-16 code unit, as every stored position counts: spreading the text would count an emoji as one.
  let scan = clause.text
    .split("")
    .map((ch, i) => (bare[i] === ch ? ch : "x"))
    .join("");
  for (const m of own) scan = scan.slice(0, m.start) + " ".repeat(m.end - m.start) + scan.slice(m.end);
  if (noun) scan = scan.replace(noun, (s) => " ".repeat(s.length));
  const { direction, count } = directionSpans(scan);
  const spans = [];
  if (
    direction &&
    clause.direction !== undefined &&
    /^\S+(?: to \S+| first)?$/.test(scan.slice(direction.start, direction.end).trim().replace(/\s+/g, " "))
  ) {
    const lead = /\b(?:sorted|ordered|sort|order|in|from)\s+$/.exec(scan.slice(0, direction.start));
    const tail = /^\s+order\b/.exec(scan.slice(direction.end));
    spans.push({ start: direction.start - (lead?.[0].length ?? 0), end: direction.end + (tail?.[0].length ?? 0) });
  }
  if (count && clause.limit !== undefined) spans.push(count);
  return spans.reduce((t, s) => t.slice(0, s.start) + " ".repeat(s.end - s.start) + t.slice(s.end), clause.text);
};

/**
 * The words GridCue didn't read right before the column that owns quoted text, or right after the text, if any. Before
 * the column, only a verb that chooses rows, "only", "all of", the Row Noun, and "for", what `ROWS_JOIN` lists or a
 * joining word are read, after "thanks," at the start; "filter" also takes "by", "on", "to" and "rows" or "the grid":
 * `accounts sans advisor "Lane"` and `the opposite of advisor "Lane"` are not read. After the text, only a possessive,
 * the Row Noun, then what `afterText` lists before a name, a comparison before an amount (`afterTextJoin`), or what
 * `afterTextEnd` lists at the end: `advisor "Lane" exactly` and `advisor "Lane" accounts exactly` are not. A direction
 * or count is read on either side (`withoutDirection`).
 * Like the words between the column and the text, this is a rule, not a list of bad words.
 *
 * Text no column owns is checked the same way, up to the text itself, where a containing word may also sit right
 * before it (`containing "Lane"`, `accounts for "Avery Lane"`): `starts with "Av"`, `filter to "Lane"` and
 * `"Avery Lane" exactly` are not read, so the User's answer to which column holds the text can't drop them.
 */
const unreadBesideText = (
  clause: Clause,
  lit: Literal,
  owner: Mention | undefined,
  own: readonly Mention[],
  rowNoun: string | undefined,
): { before: boolean; words: string } | undefined => {
  const noun = rowNoun?.toLowerCase().replace(/(?:es|s)$/, "");
  const nounSource = noun ? String.raw`${noun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:e?s)?\b` : undefined;
  const text = withoutDirection(clause, own, nounSource ? new RegExp(String.raw`\b${nounSource}`, "g") : undefined);
  const isRowNoun = (m: Mention) => !!noun && clause.text.slice(m.start, m.end).replace(/(?:es|s)$/, "") === noun;
  const literalEnd = (l: Literal) => l.at + literalText(clause.text, l).length;
  // The words before the column start after the last name or literal GridCue read. The Row Noun left as a name is
  // not one: it is checked below.
  const start = owner?.start ?? lit.at;
  const ends = [
    ...own.filter((m) => m !== owner && m.end <= start && !isRowNoun(m)).map((m) => m.end),
    ...clause.literals.filter((l) => l.at < start).map(literalEnd),
  ];
  const from = Math.max(0, ...ends);
  let before = text.slice(from, start);
  if (from === 0) {
    before = before.slice(COURTESY_LEAD.exec(before)?.[0].length ?? 0);
    before = before.slice(LEAD_IN.exec(before)?.[0].length ?? 0);
  }
  const nounWords = nounSource ? String.raw`(?:${nounSource}[\s,]*)?` : "";
  // The verbs that choose rows (see `verbFamily`), with "only" or "just" after them as before them (`LEAD_IN`), then
  // the rows, then a word that joins them to the column: "show all of", "taxable accounts for", "value over $1m for".
  // "Filter" takes more: "filter by", "filter accounts by", "filter rows with", "filter the grid to".
  const rows = String.raw`(?:${nounSource ? `${nounSource}|` : ""}rows?|records?|grid|table)[\s,]*`;
  const filterLead = String.raw`filter\s+(?:(?:the|all|my)\s+)?(?:${rows})?(?:(?:by|on|for|to|with|where|in)\s+)?`;
  const chooseLead = String.raw`(?:(?:show|filter(?: to)?|find|list|display|see|view|look at|get|keep|include)\s+)?(?:(?:only|just)\s+)?(?:all(?: of)?\s+)?(?:(?:the|my)\s+)?${nounWords}(?:(?:and|or|then|for)\s+|${ROWS_JOIN})?`;
  // Right before text no column owns, a containing word (`CONTAINING_GAP`) may sit too. "To" there may mean "equal to",
  // as it may between a column and its text.
  const containing = owner ? "" : String.raw`(?:(?::|is|are|containing|contains|includes|has|like|matching)\s*)?`;
  const BEFORE = new RegExp(String.raw`^[\s,]*(?:${filterLead}|${chooseLead})(?:(?:but\s+)?only\s+)?(?:(?:the|an?)\s+)?${containing}$`);
  if (!BEFORE.test(before) || (!owner && /\bto\s*$/.test(before))) return { before: true, words: before.trim().replace(/[\s,]+$/, "") };
  // The Row Noun left as a name before the column means GridCue didn't read how the rows and the column join:
  // `accounts not at Northgate with advisor "Lane"`, `accounts for advisor "Lane"`. Where the Mentions read it as the
  // rows, it is not a name, and "for" after it is read above: `taxable accounts for advisor "Lane"`.
  const rowsName = owner && own.find((m) => m !== owner && m.end <= owner.start && isRowNoun(m));
  if (owner && rowsName)
    return {
      before: true,
      words: text
        .slice(rowsName.start, owner.start)
        .trim()
        .replace(/[\s,]+$/, ""),
    };
  // After the text, the check runs to the next name or literal. The Row Noun is not one: `advisor "Lane" accounts
  // exactly` is checked to its end.
  const end = literalEnd(lit);
  const next = [
    ...own.filter((m) => m.start >= end && !isRowNoun(m)).map((m) => ({ at: m.start, mention: m })),
    ...clause.literals.filter((l) => l.at >= end).map((l) => ({ at: l.at, mention: undefined })),
  ].sort((a, b) => a.at - b.at)[0];
  const after = text.slice(end, next?.at ?? text.length);
  // A column whose own value the name after it leaves out, with only the negation between them: `at every custodian
  // other than Northgate`.
  const column = next?.mention;
  const ownValue = column
    ? own.filter((m) => m.start >= column.end && m !== column && !isRowNoun(m)).sort((a, b) => a.start - b.start)[0]
    : undefined;
  const leavesOwnValue =
    !!column &&
    !!ownValue &&
    column.valueId === undefined &&
    ownValue.valueId !== undefined &&
    !!ownValue.negated &&
    ownValue.columnId === column.columnId &&
    !clause.literals.some((l) => l.at >= column.end && l.at < ownValue.start) &&
    LEAVES_OWN_VALUE.test(text.slice(column.end, ownValue.start));
  // Before an amount, the amount's own comparison is read with it: `advisor "Lane" and value over $1m`.
  const read = !next
    ? afterTextEnd(nounWords).test(after)
    : next.mention
      ? afterText(next.mention, nounWords, leavesOwnValue).test(after)
      : ADJACENT_COMPARISON.test(after.slice(afterTextJoin(nounWords).exec(after)?.[0].length ?? 0));
  return read
    ? undefined
    : {
        before: false,
        words: clause.text
          .slice(end, next?.at ?? text.length)
          .trim()
          .replace(/^[\s,]+|[\s.!?]+$/g, ""),
      };
};

/**
 * The question for the words around quoted text, if GridCue didn't read them: "how to match" for a word between the
 * text and its column, or before text no column owns; "what to do with" for any other.
 */
const textWordsQuestion = (
  clause: Clause,
  lit: Literal,
  quotedAfter: { mention: Mention; read: boolean } | undefined,
  own: readonly Mention[],
  rowNoun: string | undefined,
): { id: "match" | "beside"; prompt: string } | undefined => {
  const match = { id: "match", prompt: `I'm not sure how to match “${lit.value}”. Try “containing”.` } as const;
  if (quotedAfter && !quotedAfter.read) return match;
  const beside = unreadBesideText(clause, lit, quotedAfter?.mention, own, rowNoun);
  if (!beside) return undefined;
  if (!quotedAfter && beside.before) return match;
  return { id: "beside", prompt: `I'm not sure what to do with “${beside.words}”. Try rephrasing that part.` };
};

const describeLiteral = (lit: Literal): string => {
  const words: Record<string, string> = { gt: "above", gte: "at least", lt: "below", lte: "at most", eq: "equal to", between: "between" };
  const show = (v: number | string) => (typeof v === "number" ? formatAmount(v, lit.kind) : String(v));
  if (lit.comparator === "between") return `between ${show(lit.value)} and ${show(lit.upper ?? lit.value)}`;
  return `${words[lit.comparator ?? "eq"] ?? ""} ${show(lit.value)}`.trim();
};
