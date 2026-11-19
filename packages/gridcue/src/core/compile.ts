import { MVP_OPERATIONS } from "./adapter";
import {
  amountWithoutName,
  type CodeReadFilter,
  dateQuestion,
  dateStatement,
  datesPrompt,
  dateWordsOf,
  emptyWordsOutside,
  isRowNoun,
  localValueFilters,
  type NamedValue,
  nameHoldsDate,
  namesAfterCodeRead,
  termQuestion,
  termWordsOutside,
  textFormStatement,
  timeWordsOutside,
  unreadAdverbs,
  valuePlaceQuestion,
  valueStatement,
} from "./code-read";
import { isExposed, operatorsFor } from "./columns";
import { addDays, isDay } from "./dates";
import { matchesPredicate } from "./evaluate";
import { formatAmount } from "./format";
import { afterExclusionLead, governedClears, LEAD_IN, leavesRowsOut, nothingAfter, saidToStay, viewRequest } from "./lead";
import { type DeclaredName, type LocalValueRef, type LocalValuesPart, MAX_LOCAL_VALUE_CHOICES } from "./local-values";
import { LEAVES_OUT, LITERAL_COLUMN_KINDS, type Mention } from "./mentions";
import {
  type Clause,
  directionBySize,
  directionFromSizeAlone,
  type Literal,
  literalText,
  type NormalizedInput,
  SIZE_WORDS,
  trailingComparison,
  unquoted,
} from "./normalize";
import {
  ALSO_WORDS,
  CHOOSING_VERBS,
  CONTAINING_WORDS,
  COURTESY,
  type CodeReadSpan,
  directionWords,
  GROUP_VERBS,
  limitPicks,
  ONLY_WORDS,
  outsideCodeRead,
  PREPOSITIONS,
  QUANTIFIERS,
  rowNouns,
  SORT_VERBS,
  strayBesideColumnsOnly,
  unplacedQuestion,
  unplacedWords,
  withoutNames,
} from "./placed";
import type { RestrictedMention } from "./policy";
import {
  type AggregationSpec,
  type Clarification,
  type ColumnDescriptor,
  type ColumnKind,
  type DecisionEvidence,
  emptyViewState,
  type FilterGroup,
  type FilterPredicate,
  PROTOCOL_VERSION,
  type UnsupportedCategory,
  type ViewOperation,
  type ViewPlan,
  type ViewSchema,
  type ViewState,
} from "./protocol";
import { applyOperations } from "./reduce";
import {
  type ClauseResolution,
  COLUMN_FAMILIES,
  type Pick,
  type ResolutionResult,
  UNSUPPORTED_FAMILIES,
  VIEW_FAMILIES,
  type ViewFamily,
} from "./resolution";
import { REVERSAL_WORDING, unknownTerm } from "./terms";
import { escapeRegExp } from "./text-match";
import { unusedReadings } from "./unused";
import { totalKindIssue } from "./validate";
import {
  nameQuestion,
  namesEveryRow,
  pinListRunsOn,
  readViewWords,
  removesToo,
  totalsMisfit,
  type ViewWordLeft,
  type ViewWordsReading,
  viewWordsLeft,
  viewWordsQuestion,
} from "./view-words";

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
  /**
   * The request's code-read filters, part by part, from `readCodeFilters` (ADR 0023). A part that holds one is ready
   * only when every word in it is placed, and what the provider proposes for it is limited to what its words name.
   * Each filter is in the plan, decided by code, where the column's kind and allowed operators take it; otherwise the
   * part asks. A span with no filter places its words and adds nothing. A part that holds none is compiled exactly as
   * it is with this left out. A date with no column named (spec 5.5) takes the provider's confident pick of a date
   * column the part doesn't name for something else, or the User's answer; otherwise the part asks which.
   *
   * Whatever this holds, a time word outside a date code read ("this week", "since january") asks, in every part.
   */
  codeRead?: readonly (CodeReadSpan | CodeReadFilter)[];
  /**
   * What each part names among the Local Values, from `readLocalValueParts` (named filters spec, 5.4; ADR 0025). A
   * whole value becomes a code-read filter, and a tie or one word of a value asks which was meant. Nothing here is ever
   * sent to an Intent Provider. Left out, the request is compiled exactly as before.
   */
  localValues?: readonly LocalValuesPart[];
  /** Answers to earlier clarifications, keyed by clarification ID. */
  answers?: Record<string, string>;
  confidence?: ConfidencePolicy;
  /**
   * The view `view.reset` returns to (the adapter's `getDefaultState()`). A reset that keeps the current filters
   * ("reset everything except the filters") adds them to this view's own, so it is ready only when this is given and
   * has no filters. Otherwise GridCue asks. Its sort and count are what a reset leaves for the count rule (ADR 0027).
   * Its columns and pins are what a pin or an unpin said after a reset starts from, and its totals what a total said
   * after a reset is added to.
   */
  defaultState?: {
    filters: ViewState["filters"];
    sorts?: ViewState["sorts"];
    limit?: ViewState["limit"];
    visibleColumnIds?: ViewState["visibleColumnIds"];
    pinnedColumnIds?: ViewState["pinnedColumnIds"];
    aggregations?: ViewState["aggregations"];
  };
  /**
   * The operations the grid supports (its adapter's capabilities). Left out, they are `MVP_OPERATIONS`. A count ("top
   * 10") becomes `limit.set` only where this lists it; otherwise the plan sorts alone and records the count as not
   * applied (ADR 0018). "Show only the first 5 rows" there ends in a question with no choices, and nothing applies
   * (ADR 0027). Where this doesn't list `group.set`, a part that asks to group or ungroup ends the whole request in
   * "This grid can't group rows." (more grids spec, 5.3). Where it doesn't list `columns.pin` or `density.set`, a pin,
   * unpin or density code read ends the whole request in "This grid can't pin columns." or "This grid can't change its
   * density." (operation set spec, 4.2). Where it doesn't list `aggregation.set`, a totals code read, or any word that
   * may ask for a total ("total", "sum", "average") outside a declared name, ends it in "This grid can't show
   * totals.", and a ranked-group question offers no ranking by a total (spec 5.4). A hint that suggests changes names
   * only those listed here.
   */
  operations?: readonly string[];
  newId: (prefix: string) => string;
}

/**
 * The column kinds that hold a size, the only ones a size or age word sorts: amounts, and dates ("top 10 by booking
 * date", "sort by opened, newest first"). The Mentions call a column of these kinds sized too (`core/mentions.ts`).
 */
const SIZED_KINDS: ReadonlySet<string> = new Set(["number", "currency", "percent", "date", "datetime"]);
/** A sort's own verb, wherever it sits in a part: "sort", "sorted", "order", "ordered". */
const SAYS_SORT = new RegExp(String.raw`(?<![\p{L}\p{N}'])(?:${SORT_VERBS.join("|")})(?![\p{L}\p{N}'])`, "u");

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
const PREPOSITION = String.raw`(?:${[...PREPOSITIONS, "among", "within"].join("|")})\s+`;
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

/** The count question (ADR 0027), and the plan each answer makes. */
export interface CountQuestion {
  /** "Keep only the first 10 rows of the new view, or show every row?", with the options `keep` and `all`. */
  clarification: Clarification;
  /** The plan's operations after each answer. Each ends with the count's own line, so the Preview says it. */
  answers: { keep: ViewOperation[]; all: ViewOperation[] };
}

const countWords = (count: number) => count.toLocaleString("en-US");

/**
 * An operation a request needs that the grid doesn't list. Pins, density and totals are here for a grid whose Host
 * hasn't turned them on with the adapter's `renders` (operation set 4.2).
 */
export type UnlistedOperation =
  | { type: "group.set" }
  | { type: "limit.set"; count: number }
  | { type: "columns.pin" }
  | { type: "density.set" }
  | { type: "aggregation.set" };

/**
 * "This grid can't …": the one question for a change the grid doesn't list (more grids spec, 5.3). It has no choices,
 * since no answer makes the grid able to. Its ID starts with its part's index, as the compiler's other questions do,
 * so the command bar can show it beside that part. A pin, a density and a total each add their kind to the ID, so one
 * part can ask more than one. The caller decides what else in the request stops with it.
 */
export const cantQuestion = (clauseIndex: number, op: UnlistedOperation): Clarification => {
  switch (op.type) {
    case "group.set":
      return { id: `c${clauseIndex}.cant`, prompt: "This grid can't group rows.", required: true };
    case "limit.set":
      return {
        id: `c${clauseIndex}.cant`,
        prompt: `This grid can't show only the first ${countWords(op.count)} ${op.count === 1 ? "row" : "rows"}.`,
        required: true,
      };
    case "columns.pin":
      return { id: `c${clauseIndex}.cant.pin`, prompt: "This grid can't pin columns.", required: true };
    case "density.set":
      return { id: `c${clauseIndex}.cant.density`, prompt: "This grid can't change its density.", required: true };
    case "aggregation.set":
      return { id: `c${clauseIndex}.cant.totals`, prompt: "This grid can't show totals.", required: true };
  }
};

/**
 * Any word built on "group": "group", "groups", "grouped", "grouping", "ungroup", "regroup", "subgroup", "groupwise",
 * "groupby", "group_by". A word joined to others by "_" is a name ("group_name").
 */
const GROUP_WORD = /(?<![\p{L}\p{N}_])[\p{L}\p{N}]*group[\p{L}\p{N}]*(?:_by)?(?![\p{L}\p{N}_])/gu;
/** The words that ask to group or ungroup, as the spec lists them: "group", "grouped", "ungroup" and their forms. */
const GROUPING_VERB = /^(?:un)?group(?:s|ed|ing|ings)?$/;
/** "By" after the word names what to group by: "the grouping by advisor". That asks, whatever comes before it. */
const BY_NEXT = /^\s+by\b/;
/** Before the word when it is the text to match: "household contains group", "accounts named group". */
const TEXT_MATCH_BEFORE =
  /\b(?:contains?|containing|named|called|matching|matches|like|(?:starts?|starting|begins?|beginning|ends?|ending)\s+with)\s+$/;
/** Marks where a name or quoted text was, so the words on either side of it don't touch. */
const NAME_MARK = "\u{fffc}";
/**
 * A column's own label or alias that holds "group", said beside a value of that column the part names: "the alpha
 * group" or "group = beta" on a grid with a column "Group". It names the column, not a grouping (spec 5.3, "would
 * change if"). Matching records only the value there, so the label is found here. Before the value it counts only
 * with "=", ":", "is" or "equals" between them, and after it never with "by" next: "alpha group by advisor" asks.
 */
const groupLabelsBeside = (text: string, own: readonly Mention[], columns: ViewSchema["columns"]) =>
  own.flatMap((m) => {
    if (m.valueId === undefined) return [];
    const col = columns.find((c) => c.id === m.columnId);
    const names = [col?.label, ...(col?.aliases ?? [])].filter((n): n is string => !!n && /group/i.test(n));
    return names.flatMap((name) => {
      const n = name.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
      const spans: Array<{ start: number; end: number }> = [];
      const after = new RegExp(`^(\\s+)(${n})(?![\\p{L}\\p{N}_])(?!\\s+by\\b)`, "iu").exec(text.slice(m.end));
      if (after?.[1] && after[2]) spans.push({ start: m.end + after[1].length, end: m.end + after[1].length + after[2].length });
      const before = new RegExp(`(?<![\\p{L}\\p{N}_])(${n})\\s*(?:=|:|\\bis\\b|\\bequals\\b)\\s*$`, "iu").exec(text.slice(0, m.start));
      if (before?.[1]) spans.push({ start: before.index, end: before.index + before[1].length });
      return spans;
    });
  });
/**
 * What a part's words built on "group" ask of a grid that can't group. Words inside a declared name ("Group Annuity",
 * "Group name"), in quoted text, or a column's own label beside its value ("the alpha group") don't count.
 *
 * - `"cant"`: the part asks to group or ungroup, and the whole request ends in "This grid can't group rows.". That is a
 *   grouping verb ("group", "grouped", "ungroup", "groups"), a word with "by" next ("regroup by advisor", "keep the
 *   sort and the grouping by advisor"), or a clear verb that governs the grouping ("clear the grouping"). "The
 *   Northgate group" and "sort groups by value" may each mean a grouping, and code can't tell, so they ask.
 * - `"unready"`: code can't tell what the word asks: "regroup my thoughts", "advisor like groups", "groupwise", or a
 *   grouping said to stay with more after it ("the grouping stays on advisor"). The part keeps whatever question it
 *   asks, but the request never ends ready: if it would, it asks "This grid can't group rows." instead.
 * - `undefined`: no such word, or each is said to stay or left out with nothing after it in its part but punctuation
 *   or a joining word: "clear the sort, the grouping stays", "keep the grouping", "sort by value without grouping".
 *   Only the staying words `saidToStay` knows count; any other wording asks. "Not ungrouped" asks for groups, so an
 *   "un" word counts only when it is kept ("leave ungrouped"), not left out.
 */
const groupingAsked = (clause: Clause, own: readonly Mention[], columns: ViewSchema["columns"]): "cant" | "unready" | undefined =>
  groupingWords(clause, own, columns).asked;

/**
 * What `groupingAsked` says of a part, and the first word that counts, as written in the part's text with names and
 * quoted text marked out. A word that is the text to match ("households named group") is no `word`.
 */
const groupingWords = (
  clause: Clause,
  own: readonly Mention[],
  columns: ViewSchema["columns"],
): { asked: "cant" | "unready" | undefined; word?: string } => {
  const names = [...own, ...groupLabelsBeside(clause.text, own, columns)];
  const words = unquoted(namesBlankedOf(clause.text, names));
  const marked = unquoted(namesBlankedOf(clause.text, names, NAME_MARK), NAME_MARK);
  let asked: "cant" | "unready" | undefined = governedClears(words).governed.has("group") ? "cant" : undefined;
  let first: string | undefined;
  for (const m of marked.matchAll(GROUP_WORD)) {
    const word = m[0];
    const start = m.index ?? 0;
    const end = start + word.length;
    const matched = TEXT_MATCH_BEFORE.test(marked.slice(0, start));
    // A part a clear or reset says to keep ("reset everything but the grouping") is left out of the clear. Leaving out
    // an ungrouping asks for groups ("not ungrouped", "except ungrouped"), so for "ungroup" only a word that keeps it
    // ("leave ungrouped") counts.
    const said = saidToStay(marked, start, end);
    const stays = said === "kept" || (!/^un/.test(word) && (clause.keeps || said === "left out"));
    // A word said to stay or left out, or the text to match, is never the `word`: the part asks for no grouping there.
    if (!stays && !matched) first ??= word;
    if (/by$/.test(word) || BY_NEXT.test(marked.slice(end))) return { asked: "cant", ...(first === undefined ? {} : { word: first }) };
    if (stays && nothingAfter(marked, end)) continue;
    if (stays || !GROUPING_VERB.test(word) || matched) asked ??= "unready";
    else return { asked: "cant", word: first };
  }
  return { asked, ...(first === undefined ? {} : { word: first }) };
};

/**
 * The changes a hint may suggest, in the order it names them, each with the operations it needs and its words: the
 * first to follow "Try asking to", the second to follow "Try".
 */
const HINT_CHANGES: ReadonlyArray<{ needs: string; ask: string; try: string }> = [
  { needs: "filter.add", ask: "filter", try: "filtering" },
  { needs: "sort.set", ask: "sort", try: "sorting" },
  { needs: "group.set", ask: "group", try: "grouping" },
];
/** "a, b, or c"; "a or b"; "a". */
const listOr = (items: readonly string[]) =>
  items.length > 2 ? `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}` : items.join(" or ");
/**
 * What a hint suggests, naming only the changes the grid lists (more grids spec, 5.3): "filter, sort, group, or show or
 * hide columns" on a grid that lists them all. Empty when the grid lists none of them.
 */
const hintChanges = (lists: (op: string) => boolean, form: "ask" | "try") => {
  const items = HINT_CHANGES.filter((h) => lists(h.needs)).map((h) => h[form]);
  const show = lists("columns.show");
  const hide = lists("columns.hide");
  const words = form === "ask" ? ["show", "hide"] : ["showing", "hiding"];
  const columns = [show ? words[0] : "", hide ? words[1] : ""].filter(Boolean).join(" or ");
  if (columns) items.push(`${columns} columns`);
  return listOr(items);
};
/** A sort or the filters as the rows see them: generated IDs dropped, and keys in one order however they were written. */
const rowsKey = (part: ViewState["sorts"] | FilterGroup | null) =>
  JSON.stringify(part, (key, value) =>
    key === "id"
      ? undefined
      : value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
        : value,
  );
/** No filters at all is one thing, whether the view holds `null` or an empty group. */
const filtersKey = (filters: FilterGroup | null) => (predicatesIn(filters) === 0 ? "null" : rowsKey(filters));

/**
 * The count rule (ADR 0027): a count follows its rows. On a view with a count, a plan that changes or clears the sort,
 * or adds, replaces or clears a filter, and sets no count of its own, would keep the count over different rows without
 * saying so. This returns the question to ask instead, or `undefined` when the plan may go ahead.
 *
 * It is a pure function of a plan's operations and the view they apply to, not of the request's words, so it holds for
 * every Intent Provider and for a plan made without compiling. It never asks about a plan that sets its own count, or
 * one that leaves the sort and the filters as they are. A reset states its whole target view, count included: only the
 * operations after it are checked, against `defaultView`, the view it returns to.
 */
export const countQuestion = (
  operations: readonly ViewOperation[],
  view: { sorts: ViewState["sorts"]; filters: ViewState["filters"]; limit?: ViewState["limit"] },
  defaultView?: { sorts?: ViewState["sorts"]; filters?: ViewState["filters"]; limit?: ViewState["limit"] },
): CountQuestion | undefined => {
  const reset = operations.findLastIndex((op) => op.type === "view.reset");
  const from = reset < 0 ? view : defaultView;
  const count = from?.limit;
  const rest = operations.slice(reset + 1);
  if (count === undefined || rest.some((op) => op.type === "limit.set")) return undefined;
  const before: ViewState = { ...emptyViewState([]), sorts: from?.sorts ?? [], filters: from?.filters ?? null };
  const after = applyOperations(before, rest, before);
  if (rowsKey(after.sorts) === rowsKey(before.sorts) && filtersKey(after.filters) === filtersKey(before.filters)) return undefined;
  const rows = count === 1 ? "row" : `${countWords(count)} rows`;
  return {
    clarification: {
      id: "plan.count",
      prompt: `Keep only the first ${rows} of the new view, or show every row?`,
      options: [
        { id: "keep", label: `Keep the first ${count === 1 ? "row" : countWords(count)}` },
        { id: "all", label: "Show every row" },
      ],
      required: true,
    },
    answers: {
      keep: [...operations, { type: "limit.set", count }],
      all: [...operations, { type: "limit.set", count: null }],
    },
  };
};

/** The operators `filtersCanAllHold` reads. Any other on a text column is left as it is. */
const TEXT_OPERATORS: ReadonlySet<FilterPredicate["operator"]> = new Set([
  "eq",
  "neq",
  "in",
  "contains",
  "startsWith",
  "isEmpty",
  "isNotEmpty",
]);
/**
 * Whether some cell of a text column can match every one of these filters. A cell is empty or one text, so it is
 * enough to try an empty cell, each text an exact filter names, and one text made from the filters' own words: the
 * longest start, then every text to contain, then a character no filter names, which no "is not" can rule out.
 */
const filtersCanAllHold = (predicates: readonly FilterPredicate[], column: ColumnDescriptor): boolean => {
  if (predicates.some((p) => !TEXT_OPERATORS.has(p.operator))) return true;
  const texts = (p: FilterPredicate): string[] =>
    Array.isArray(p.value) ? p.value.map(String) : p.value === undefined || typeof p.value === "object" ? [] : [String(p.value)];
  const exact = predicates.flatMap((p) => (p.operator === "eq" || p.operator === "in" ? texts(p) : []));
  const starts = predicates.flatMap((p) => (p.operator === "startsWith" ? texts(p) : [])).sort((a, b) => b.length - a.length);
  const contained = predicates.flatMap((p) => (p.operator === "contains" ? texts(p) : []));
  const made = `${starts[0] ?? ""}${contained.join("")}\u0001`;
  return [null, ...exact, made].some((cell) => predicates.every((p) => matchesPredicate(cell, p, column)));
};

/** The column kinds a date is read on (spec 5.5). */
const DATE_COLUMN_KINDS: ReadonlySet<string> = new Set(["date", "datetime"]);

/**
 * Whether some day can match every one of these filters on a date column (spec 5.5): "this month" and "last month"
 * together keep no row. Each filter that compares with a day narrows the days that can match, both ends included; a
 * filter it can't read this way ("is not empty", a time of day) is left as it is. "Is empty" beside a filter on a day
 * keeps no row.
 */
const daysCanAllHold = (predicates: readonly FilterPredicate[]): boolean => {
  let low = "0001-01-01";
  let high = "9999-12-31";
  for (const p of predicates) {
    const v = p.value;
    const day = typeof v === "string" && isDay(v) ? v : undefined;
    const range =
      typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.min === "string" && typeof v.max === "string" ? v : undefined;
    if (p.operator === "isEmpty") return predicates.length === 1;
    if (p.operator === "between" && range && isDay(String(range.min)) && isDay(String(range.max))) {
      if (String(range.min) > low) low = String(range.min);
      if (String(range.max) < high) high = String(range.max);
    } else if (day && (p.operator === "eq" || p.operator === "gte" || p.operator === "gt")) {
      const from = p.operator === "gt" ? (day === "9999-12-31" ? "9999-12-32" : addDays(day, 1)) : day;
      if (from > low) low = from;
      if (p.operator === "eq" && day < high) high = day;
    } else if (day && (p.operator === "lte" || p.operator === "lt")) {
      const to = p.operator === "lt" ? (day === "0001-01-01" ? "0000-12-31" : addDays(day, -1)) : day;
      if (to < high) high = to;
    }
  }
  return low <= high;
};

/**
 * A Local Value's filter beside another filter on its column that no row can match with it (architecture, "Compile":
 * contradictory operations). Filters combine with "and" (ADR 0017), so the view would show no rows: "Avery Lane's
 * accounts with no advisor", `Avery Lane's accounts where advisor starts with "bl"`, or a value added beside a filter
 * the view keeps ("also Avery Lane's accounts" on a view of Blake Moreno's). This returns the question to ask instead,
 * or `undefined`.
 *
 * It is a pure function of a plan's operations and the view they apply to, as `countQuestion` is, so it holds for every
 * Intent Provider. It reads only filters joined by "and", only on text columns, and only on a column where one of
 * them is a Local Value's filter the plan adds (`localFilterIds`, by predicate ID). A plan with none reads as before:
 * two text forms that no row can match together are left as they are. It can only turn a ready plan into a question.
 */
export const emptyViewQuestion = (
  operations: readonly ViewOperation[],
  view: { filters: ViewState["filters"] },
  defaultView: { filters?: ViewState["filters"] } | undefined,
  schema: ViewSchema,
  localFilterIds: ReadonlySet<string>,
): Clarification | undefined => {
  const added = new Set(
    operations.flatMap((op) => (op.type === "filter.add" && localFilterIds.has(op.predicate.id) ? [op.predicate.id] : [])),
  );
  if (added.size === 0) return undefined;
  const before: ViewState = { ...emptyViewState([]), filters: view.filters };
  const after = applyOperations(before, operations, { ...emptyViewState([]), filters: defaultView?.filters ?? null });
  const byColumn = new Map<string, FilterPredicate[]>();
  const walk = (group: FilterGroup) => {
    if (group.combinator !== "and") return;
    for (const child of group.children) {
      if (child.type === "group") walk(child);
      else byColumn.set(child.columnId, [...(byColumn.get(child.columnId) ?? []), child]);
    }
  };
  if (after.filters) walk(after.filters);
  for (const [columnId, predicates] of byColumn) {
    if (predicates.length < 2 || !predicates.some((p) => added.has(p.id))) continue;
    const column = schema.columns.find((col) => col.id === columnId);
    const canAllHold =
      column?.kind === "string"
        ? filtersCanAllHold(predicates, column)
        : DATE_COLUMN_KINDS.has(column?.kind ?? "")
          ? daysCanAllHold(predicates)
          : true;
    if (!column || canAllHold) continue;
    return {
      id: "plan.empty_view",
      prompt: `No row matches every ${column.label} filter, so the view would be empty. Ask for the rows to keep.`,
      required: true,
    };
  }
  return undefined;
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
  // The Local Values the request names, as code-read filters, and the questions they ask (spec 5.4). With none, the
  // code-read filters are the caller's, exactly.
  const local = localReading(c, answers);
  // The filters the plan makes for Local Values, by predicate ID, for the check on filters no row can match together.
  const localFilterIds = new Set<string>();
  // The same for dates read by code (spec 5.5), and the column each date with none named was given.
  const dateFilterIds = new Set<string>();
  const resolvedDates = new Map<CodeReadFilter, string>();
  // A date's words inside a Local Value are the value's: "Today Partners" is a name, not today (spec 5.5).
  const codeReadAll: readonly (CodeReadSpan | CodeReadFilter)[] =
    local.filters.length === 0
      ? (c.codeRead ?? [])
      : [
          ...(c.codeRead ?? []).filter(
            (r) =>
              !(isCodeReadFilter(r) && r.kind === "date") ||
              !local.filters.some((v) => v.clauseIndex === r.clauseIndex && nameHoldsDate(v, r, r.dateAt)),
          ),
          ...local.filters,
        ].sort((a, b) => a.clauseIndex - b.clauseIndex || a.start - b.start);
  // The Mentions, with any column named right after a code-read filter's words, which they read as the rows.
  const found = c.mentions ?? [];
  const allMentions: readonly Mention[] = c.restricted?.length
    ? found
    : [...found, ...namesAfterCodeRead(c.input, found, codeReadAll, c.schema)].sort(
        (a, b) => a.clauseIndex - b.clauseIndex || a.start - b.start,
      );
  // View words come first (spec 4.1), read for each part before anything else. A part read whole uses the reader's
  // operations, and the provider's families for it are ignored. A pin, unpin or density read at the end of a part
  // ("group by advisor and pin advisor") is read only where the rest of the part is the provider's alone: the provider
  // didn't refuse the part (a refusal runs first, as today), and no filter or Local Value code read sits in those words.
  // The rest of the part is then compiled as if they weren't there. A part not read goes on exactly as before.
  const refusedPart = (index: number) =>
    (c.resolution.clauses.find((r) => r.clauseIndex === index)?.families ?? []).some(
      (f) => KNOWN_FAMILY_IDS.has(f.id) && !isView(f.id) && f.confidence >= bands.clarify,
    );
  const viewWordsOf = new Map<number, ViewWordsReading>();
  // Parts whose words would read as a pin, unpin or density but for a name of the Host's, with the question each asks.
  const viewWordsAsks = new Map<number, string>();
  // Parts with pin or density words that no form read, which a ready plan would drop (below).
  const viewWordsLeftOf = new Map<number, ViewWordLeft[]>();
  // Parts whose totals don't fit their column's kind (ADR 0030), with the question each asks, or the User's "No".
  const totalsKindAsks = new Map<number, Clarification>();
  const lists = (op: string) => (c.operations ?? MVP_OPERATIONS).includes(op);
  const holdsTotals = (r: ViewWordsReading | undefined) => !!r?.operations.some((op) => op.type === "aggregation.set");
  for (const clause of c.input.clauses) {
    const codeReadIn = [...codeReadAll.filter((r) => r.clauseIndex === clause.index), ...(local.asks.get(clause.index)?.spans ?? [])];
    // Words at the end of a part are its own only where nothing else reads them.
    const ownTail = (from: number) =>
      !refusedPart(clause.index) && codeReadIn.every((r) => r.end <= from) && clause.literals.every((lit) => lit.at < from);
    // A part read whole as a total holds nothing a code read reads either: a House Term or a Local Value named with a
    // total's word is the Host's, and the part is not read as a total.
    const ownWhole = (r: ViewWordsReading) => !holdsTotals(r) || codeReadIn.length === 0;
    let reading = readViewWords(clause, allMentions, c.schema);
    // A total that doesn't fit its column's kind asks (ADR 0030), on a grid that lists totals: "Concentration can't be
    // totalled. Show its average instead?" "Yes" reads the words with the average. On any other grid the request ends in
    // "This grid can't show totals." whatever the column (below).
    const misfit = reading === undefined && lists("aggregation.set") ? totalsMisfit(clause, allMentions, c.schema) : undefined;
    if (misfit && (misfit.from === 0 ? ownWhole(misfit.reading) : ownTail(misfit.from))) {
      const kindKey = `c${clause.index}.total.kind`;
      const label = column(misfit.misfit.columnId)?.label ?? misfit.misfit.columnId;
      if (misfit.misfit.fits && answers[kindKey] === "avg") {
        reading = misfit.reading;
        evidence.push({ key: kindKey, selectedId: "avg", confidence: 1, source: "user" });
        confidences.push(1);
      } else if (misfit.misfit.fits && answers[kindKey] === "none") {
        totalsKindAsks.set(clause.index, {
          id: `c${clause.index}.declined`,
          prompt: "Okay, nothing will change. Rephrase or edit your request.",
          required: true,
        });
      } else if (misfit.misfit.fits) {
        totalsKindAsks.set(clause.index, {
          id: kindKey,
          prompt: `${label} can't be totalled. Show its average instead?`,
          options: [
            { id: "avg", label: "Yes" },
            { id: "none", label: "No" },
          ],
          required: true,
        });
      } else {
        const verb = misfit.misfit.asked === "sum" ? "totalled" : "averaged";
        totalsKindAsks.set(clause.index, { id: kindKey, prompt: `${label} can't be ${verb}.`, required: true });
      }
    }
    const own = reading !== undefined && (reading.from === undefined ? ownWhole(reading) : ownTail(reading.from));
    // A pin list may run on into the next part, split before a column's name ("pin rate and cleared": "clear"). On a
    // grid that lists what the words ask for, the part asks. On one that doesn't, the request ends in "This grid can't
    // …" whatever the list holds, so the reading stays.
    const next = c.input.clauses.find((x) => x.index === clause.index + 1);
    const runsOn =
      reading?.operations.every((op) => lists(op.type)) === true ? pinListRunsOn(reading, next, allMentions, c.schema) : undefined;
    if (reading && runsOn !== undefined) {
      if (own) viewWordsAsks.set(clause.index, runsOn);
    } else if (reading && own) viewWordsOf.set(clause.index, reading);
    else if (!reading) {
      const asks = viewWordsQuestion(clause, allMentions, c.schema);
      // A Host's name that holds a form word is in doubt only on a grid that lists the form's change. On any other
      // grid the words can only be the name, and the part reads as it did before pins and density were read.
      const inDoubt = asks && (asks.named === undefined || lists(asks.named));
      if (asks && inDoubt && (asks.from === 0 || ownTail(asks.from))) viewWordsAsks.set(clause.index, asks.prompt);
    }
    // The pin and density words no form read (spec 5.2): code reads a form only as a whole part or its end, so one said
    // anywhere else would be dropped. Inside quoted text, a code-read filter or a Local Value, a word is the text's or
    // the name's, and after a text match's words it is the text to match. Said to stay or left out, with nothing after
    // it but its noun ("the pins stay", "keep the pinned columns"), it asks for nothing, as a grouping word does.
    const upTo = reading && own && runsOn === undefined ? (reading.from ?? 0) : clause.text.length;
    const plain = unquoted(clause.text);
    const left = viewWordsLeft(clause, allMentions, c.schema, upTo).filter((w) => {
      // A word in a Host's name, on a grid that doesn't list the change its form would ask for, is the name's.
      if (w.name !== undefined && (w.named === undefined || !lists(w.named))) return false;
      if (plain.slice(w.start, w.end) !== clause.text.slice(w.start, w.end)) return false;
      if (codeReadIn.some((r) => w.start < r.end && w.end > r.start) || TEXT_MATCH_BEFORE.test(plain.slice(0, w.start))) return false;
      const end = w.end + (/^\s+(?:columns?|views?|rows|density|mode)\b/.exec(plain.slice(w.end))?.[0].length ?? 0);
      const said = saidToStay(plain, w.start, end);
      const stays = said === "kept" || (!/^un/.test(w.text) && (clause.keeps || said === "left out"));
      return !(stays && nothingAfter(plain, end));
    });
    if (left.length > 0) viewWordsLeftOf.set(clause.index, left);
  }
  /** Where the words read at the end of a part start, if they do. */
  const tailOf = (index: number) => viewWordsOf.get(index)?.from;
  const input: NormalizedInput = {
    ...c.input,
    clauses: c.input.clauses.map((clause) => {
      const from = tailOf(clause.index);
      return from === undefined
        ? clause
        : { ...clause, text: clause.text.slice(0, from).trimEnd(), literals: clause.literals.filter((lit) => lit.at < from) };
    }),
  };
  const mentions: readonly Mention[] = allMentions.filter((m) => m.start < (tailOf(m.clauseIndex) ?? Number.POSITIVE_INFINITY));
  // What the provider proposed for a part read at its end is kept only where the rest of the part names it.
  const resolution: ResolutionResult = {
    clauses: c.resolution.clauses.map((r) => {
      const from = tailOf(r.clauseIndex);
      const clause = input.clauses.find((x) => x.index === r.clauseIndex);
      const reading = viewWordsOf.get(r.clauseIndex);
      return from === undefined || !clause || !reading
        ? r
        : beforeViewWords(
            r,
            clause,
            mentions.filter((m) => m.clauseIndex === r.clauseIndex),
            reading,
            (e) => evidence.push(e),
          );
    }),
  };
  const optionsFor = (kinds: readonly ColumnKind[] | null, capability: string) =>
    c.schema.columns
      .filter((col) => isExposed(col) && col.capabilities.includes(capability as never) && (!kinds || kinds.includes(col.kind)))
      .map((col) => ({ id: col.id, label: col.label }));
  // Consecutive sorts or groupings are levels of one, in the order named: the first is the primary sort or the
  // outermost group. A clear, reset or count in between, or a part that says "instead", starts a new one.
  // A grouping "total X by Y" set is the words' own and is never a level of another: "total market value by advisor,
  // group by custodian" groups again, and the words that said "by advisor" are then asked about (ADR 0019).
  const ownGroupings = new WeakSet<ViewOperation>();
  // The part that set the plan's count, and whether a sort or grouping was said after the count while one said before
  // it was still in effect. The later one would replace the sort or grouping the count was said with, so the part
  // that set the count is asked about (below), wherever the count's own sort was said.
  let countPart: number | undefined;
  let levelAfterCount = false;
  const levelsOf = (type: "sort.set" | "group.set", replaces: boolean) => {
    const at = operations.findLastIndex((o) => o.type === type);
    const current = operations[at];
    if (replaces || !current || operations.slice(at + 1).some((o) => o.type === "view.reset")) return undefined;
    const levels =
      (current.type === "sort.set" && current.sorts.length > 0) || (current.type === "group.set" && current.columnIds.length > 0);
    const afterCount = operations.slice(at + 1).some((o) => o.type === "limit.set");
    if (levels && afterCount) levelAfterCount = true;
    return levels && !afterCount && !ownGroupings.has(current) ? current : undefined;
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
  /**
   * The column a ranking's adjective is made from, for the ranked-group question's third choice (spec 5.4): "most
   * concentrated" or "least concentrated" for a column the Host named "Concentration". The adjective is the name with
   * "-ion" written "-ed", after "most" or "least"; one column only. The choice names the column, so the User decides.
   */
  const rankedByAdjective = (text: string): ColumnDescriptor | undefined => {
    const said = /\b(?:most|least)\s+(\p{L}+)ed\b/u.exec(unquoted(text))?.[1];
    if (!said) return undefined;
    const ids = new Set(columnNameAt.filter(({ name }) => name === `${said}ion`).map(({ columnId }) => columnId));
    return ids.size === 1 ? column([...ids][0] ?? "") : undefined;
  };

  for (const mention of c.restricted ?? []) {
    unsupportedSegments.push({ category: "restricted_column" });
    evidence.push({ key: `c${mention.clauseIndex}.restricted`, selectedId: mention.columnId, source: "host" });
  }

  // Parts code read whole as view words (ADR 0028), with the operations each gave the plan.
  const readWhole = new Map<number, ViewOperation[]>();
  // The same for parts whose end code read (`from`), with the operations those words gave the plan.
  const readTail = new Map<number, ViewOperation[]>();
  // Parts that say "every row" of a view with no count and no filters: true only while the request adds no filter.
  const everyRowOfAll = new Set<number>();
  const canCount = lists("limit.set");
  // One count per plan: a later one replaces an earlier one, which is then left unused and asked about (ADR 0019).
  const setCount = (count: number | null, part: number): ViewOperation => {
    const earlier = operations.findIndex((o) => o.type === "limit.set");
    if (earlier >= 0) operations.splice(earlier, 1);
    const op: ViewOperation = { type: "limit.set", count };
    operations.push(op);
    countPart = part;
    return op;
  };
  // The view as the plan has it so far: the columns a pin needs shown, the pins an unpin of every column names.
  const viewSoFar = () => applyOperations(c.state, operations, { ...c.state, ...c.defaultState });
  // Set when a pin or unpin code read changes nothing: every column it names is already where it asks.
  let alreadyShown = false;
  // The totals code read in this request so far, by column, said as a change or not.
  const totalsSaid = new Map<string, AggregationSpec["function"]>();
  /**
   * Puts the pins, unpins and densities a part's view words read into the plan (spec 4.4), or asks. A column the Host
   * doesn't let pin is never pinned or unpinned: the part asks. A hidden column is shown before its pin, so the Preview
   * says both. An unpin that names no column names every pinned column. As with a count, one density per plan: a later
   * one replaces an earlier one, which is then asked about (ADR 0019). Totals and the grouping of "total X by Y" go in
   * the same way (spec 5.4): a column the Host doesn't let total or group by asks, a total is added to the view's and
   * replaces another on its column, and a hidden column is shown first.
   */
  const placeViewWords = (clause: Clause, read: readonly ViewOperation[]): ViewOperation[] | undefined => {
    const key = `c${clause.index}`;
    const now = viewSoFar();
    // After a reset, the columns that show are the default view's, which a caller may not have given.
    const resetUnknown = operations.some((op) => op.type === "view.reset") && !c.defaultState?.visibleColumnIds;
    // Each unpin of every column names the columns pinned when it is said, the part's own earlier pins included. A column
    // the User may not name (a restricted one, or one kept from the provider) is never named, so it would stay pinned.
    // Hidden, it shows nothing pinned. Shown, or perhaps shown after a reset, the unpin wouldn't do what it says: ask,
    // without naming it.
    let running = now;
    const everyColumn = new Set<ViewOperation>();
    let keptPinned: { others: boolean } | undefined;
    const filled = read.map((op) => {
      const every = op.type === "columns.pin" && op.position === "none" && op.columnIds.length === 0;
      const pinned = every ? [...running.pinnedColumnIds.start, ...running.pinnedColumnIds.end] : [];
      const named = pinned.filter((id) => column(id));
      if (pinned.some((id) => !column(id) && (resetUnknown || running.visibleColumnIds.includes(id)))) {
        keptPinned ??= { others: named.length > 0 };
      }
      const out: ViewOperation = every ? { ...op, columnIds: named } : op;
      if (every) everyColumn.add(out);
      running = applyOperations(running, [out], running);
      return out;
    });
    if (keptPinned) {
      const others = keptPinned.others ? " To unpin the others, name them." : "";
      clarifications.push({ id: `${key}.pin`, prompt: `GridCue can't unpin every column here.${others}`, required: true });
      return undefined;
    }
    for (const op of filled) {
      if (op.type !== "columns.pin") continue;
      const refused = op.columnIds.find((id) => !column(id)?.capabilities.includes("pin"));
      if (refused !== undefined) {
        const label = c.schema.columns.find((col) => col.id === refused)?.label ?? refused;
        const others = everyColumn.has(op) && op.columnIds.length > 1 ? " To unpin the others, name them." : "";
        clarifications.push({
          id: `${key}.pin`,
          prompt: `GridCue can't ${op.position === "none" ? "unpin" : "pin"} ${label} here.${others}`,
          required: true,
        });
        return undefined;
      }
    }
    // A column this request hides and pins ("hide advisor and pin advisor") is asked about, never shown again.
    const hiddenHere = filled.flatMap((op) =>
      op.type === "columns.pin" && op.position !== "none"
        ? op.columnIds.filter(
            (id) => !now.visibleColumnIds.includes(id) && operations.some((o) => o.type === "columns.hide" && o.columnIds.includes(id)),
          )
        : [],
    )[0];
    if (hiddenHere !== undefined) {
      const label = column(hiddenHere)?.label ?? hiddenHere;
      clarifications.push({ id: `${key}.pin`, prompt: `GridCue can't hide ${label} and pin it too.`, required: true });
      return undefined;
    }
    // A total, and the grouping "total X by Y" names, only on a column the Host lets take it (spec 4.4). A total on a
    // column this request hides would show nothing: asked about, never shown again.
    for (const op of filled) {
      const refused =
        op.type === "group.set"
          ? op.columnIds.filter((id) => !column(id)?.capabilities.includes("group")).map((id) => ({ id, verb: "group by" }))
          : op.type === "aggregation.set"
            ? op.aggregations
                .filter((a) => !column(a.columnId)?.capabilities.includes("aggregate"))
                .map((a) => ({ id: a.columnId, verb: a.function === "avg" ? "average" : "total" }))
            : [];
      const hidden =
        op.type === "aggregation.set"
          ? op.aggregations.find(
              (a) =>
                !now.visibleColumnIds.includes(a.columnId) &&
                operations.some((o) => o.type === "columns.hide" && o.columnIds.includes(a.columnId)),
            )
          : undefined;
      const [first] = refused;
      if (first || hidden) {
        const id = first?.id ?? hidden?.columnId ?? "";
        const label = c.schema.columns.find((col) => col.id === id)?.label ?? id;
        const prompt = first ? `GridCue can't ${first.verb} ${label} here.` : `GridCue can't hide ${label} and total it too.`;
        clarifications.push({ id: `${key}.total`, prompt, required: true });
        return undefined;
      }
    }
    // "Total X by Y" replaces the grouping (spec 5.4). A grouping the same request set before it ("group by advisor,
    // total market value by custodian") would be dropped without a word, with its line still in the Preview: the part
    // asks. The same grouping said twice is no change.
    const regroups = filled.find((op) => op.type === "group.set");
    const groupedAt = operations.findLastIndex((o) => o.type === "group.set");
    const grouped = operations[groupedAt];
    if (
      regroups?.type === "group.set" &&
      grouped?.type === "group.set" &&
      grouped.columnIds.length > 0 &&
      !operations.slice(groupedAt + 1).some((o) => o.type === "view.reset") &&
      JSON.stringify(grouped.columnIds) !== JSON.stringify(regroups.columnIds)
    ) {
      const names = (ids: readonly string[]) => ids.map((id) => c.schema.columns.find((col) => col.id === id)?.label ?? id);
      const [before, after] = [names(grouped.columnIds), names(regroups.columnIds)];
      clarifications.push({
        id: `${key}.total`,
        prompt: `GridCue can't group by ${before.join(", then ")} and by ${after.join(", then ")} too. To group by both, say “group by ${[...before, ...after].join(", then ").toLowerCase()}”.`,
        required: true,
      });
      return undefined;
    }
    // A column holds one total at a time (spec 4.4). A request that names a column's total twice ("total market value
    // and average market value"), or removes the totals after it names one, can't show what each of its words asks.
    // Whatever the view already shows, it asks: a total the view has already would otherwise be dropped without a word.
    const named = new Map(totalsSaid);
    for (const op of filled) {
      if (op.type !== "aggregation.set") continue;
      const again = op.aggregations.find((a) => named.has(a.columnId));
      const [earlier] = op.aggregations.length === 0 ? named : [];
      if (again || earlier) {
        const label = (id: string) => c.schema.columns.find((col) => col.id === id)?.label ?? id;
        const prompt = again
          ? `${label(again.columnId)} shows one total at a time. Ask for its total or its average.`
          : `GridCue can't show the ${earlier?.[1] === "avg" ? "average" : "total"} of ${label(earlier?.[0] ?? "")} and remove the totals too.`;
        clarifications.push({ id: `${key}.total`, prompt, required: true });
        return undefined;
      }
      for (const a of op.aggregations) named.set(a.columnId, a.function);
    }
    for (const [id, fn] of named) totalsSaid.set(id, fn);
    // After a reset, the pins are the default view's, which a caller may not have given either.
    const pinsUnknown = operations.some((op) => op.type === "view.reset") && !c.defaultState?.pinnedColumnIds;
    const placed: ViewOperation[] = [];
    for (const said of filled) {
      // "Total X by Y" groups by Y, replacing the grouping, as "group by Y" does. A grouping the view already has is no
      // change, and has no line.
      if (said.type === "group.set") {
        if (JSON.stringify(viewSoFar().groupBy) === JSON.stringify(said.columnIds)) {
          alreadyShown = true;
          continue;
        }
        ownGroupings.add(said);
        operations.push(said);
        placed.push(said);
        note(`${key}.words`, said.type, 1, "deterministic");
        continue;
      }
      // A total is added to the view's totals, and the plan carries the whole list (spec 5.4). A column holds one total
      // at a time, so a total on a column that has another replaces it where it stands. A hidden column is shown first,
      // so the Preview says both. With nothing to change, there is no line.
      if (said.type === "aggregation.set") {
        // After a reset, the totals are the default view's, which a caller may not have given: the list is the words'
        // since the reset.
        const reset = operations.findLastIndex((op) => op.type === "view.reset");
        const totalsUnknown =
          reset >= 0 && !c.defaultState?.aggregations && !operations.slice(reset).some((op) => op.type === "aggregation.set");
        const before = totalsUnknown ? [] : viewSoFar().aggregations;
        let list = said.aggregations.length === 0 ? [] : [...before];
        for (const a of said.aggregations) {
          const at = list.findIndex((b) => b.columnId === a.columnId);
          list = at < 0 ? [...list, a] : list.map((b, i) => (i === at ? a : b));
        }
        const hidden = said.aggregations.map((a) => a.columnId).filter((id) => resetUnknown || !viewSoFar().visibleColumnIds.includes(id));
        if (hidden.length > 0) {
          const show: ViewOperation = { type: "columns.show", columnIds: hidden };
          operations.push(show);
          placed.push(show);
        }
        if (hidden.length === 0 && !totalsUnknown && JSON.stringify(list) === JSON.stringify(before)) {
          alreadyShown = true;
          continue;
        }
        const op: ViewOperation = { type: "aggregation.set", aggregations: list };
        operations.push(op);
        placed.push(op);
        note(`${key}.words`, op.type, 1, "deterministic");
        continue;
      }
      let op = said;
      if (op.type === "columns.pin" && !pinsUnknown) {
        // A pin or unpin names only the columns it changes, so its line never claims a change that doesn't happen: a
        // column already pinned to that side stays where it is, and an unpin leaves a column that isn't pinned alone. A
        // hidden column already pinned to that side is shown, and that is all. With nothing to change, there is no line.
        const pins = viewSoFar().pinnedColumnIds;
        const { position } = op;
        const changes = op.columnIds.filter((id) =>
          position === "none" ? pins.start.includes(id) || pins.end.includes(id) : !pins[position].includes(id),
        );
        const shows = position !== "none" && op.columnIds.some((id) => !viewSoFar().visibleColumnIds.includes(id));
        if (changes.length === 0 && !shows) {
          alreadyShown = true;
          continue;
        }
        if (changes.length < op.columnIds.length) op = { ...op, columnIds: changes };
      }
      if (said.type === "columns.pin" && said.position !== "none") {
        const hidden = said.columnIds.filter((id) => resetUnknown || !viewSoFar().visibleColumnIds.includes(id));
        if (hidden.length > 0) {
          const show: ViewOperation = { type: "columns.show", columnIds: hidden };
          operations.push(show);
          placed.push(show);
        }
      }
      if (op.type === "columns.pin" && op.columnIds.length === 0) continue;
      if (op.type === "density.set") {
        const earlier = operations.findIndex((o) => o.type === "density.set");
        if (earlier >= 0) operations.splice(earlier, 1);
      }
      operations.push(op);
      placed.push(op);
      note(`${key}.words`, op.type, 1, "deterministic");
    }
    return placed;
  };

  // A Local Value is a name too: "Hollis Travel Group entries" asks for no grouping.
  const localNames = (clause: Clause) => local.filters.filter((r) => r.clauseIndex === clause.index).map((r) => asNamedValue(r, clause));
  // A part that asks to group or ungroup, on a grid that can't group (more grids spec, 5.3), ends the whole request in
  // one question, and nothing in it applies, other parts included: the User asked for every change, and showing some
  // would be a different view. The question is the first such part's. A part whose grouping word code can't read
  // (`unready`) never leaves the plan ready either: that is checked once the plan is built, below.
  const groupAsks = lists("group.set")
    ? []
    : input.clauses.map((clause) => ({
        clause,
        asked: groupingAsked(clause, [...mentions.filter((m) => m.clauseIndex === clause.index), ...localNames(clause)], c.schema.columns),
      }));
  // "Total X by Y" groups too (spec 5.4), so on a grid that can't group it asks the same.
  const grouping =
    groupAsks.find((g) => g.asked === "cant")?.clause ??
    (lists("group.set")
      ? undefined
      : input.clauses.find((clause) => viewWordsOf.get(clause.index)?.operations.some((op) => op.type === "group.set")));
  const unreadGrouping = groupAsks.find((g) => g.asked === "unready")?.clause;
  // A pin, unpin or density, on a grid whose Host hasn't said its table draws it (operation set spec, 4.2), ends the
  // request the same way, with the same shared question. One question for each kind, the first part's. That is a form
  // code read, and also a form said where code reads none ("compact view of taxable accounts") or about a column in
  // doubt ("pin restricted"): whatever the rest of the part means, the grid can't do what the form asks. A request with
  // a part the provider refuses ("pin advisor and export the list") is refused instead, as on a grid that draws them;
  // its pins and density are left out of the plan, which never applies.
  const refusedAny = c.input.clauses.some((clause) => !clause.keeps && refusedPart(clause.index));
  const unlisted: Array<{ index: number; op: UnlistedOperation }> = grouping ? [{ index: grouping.index, op: { type: "group.set" } }] : [];
  const unlistedView = new Set<number>();
  // The questions asked once every part is compiled, if the refusal didn't hold after all.
  const unlistedIfNotRefused: typeof unlisted = [];
  // Parts whose totals were left out beside a refused part, asked about if the refusal didn't hold after all.
  const totalsBesideRefusal: Clause[] = [];
  // A total the same way (spec 5.4), and also any word that may ask for one that no form read ("northgate accounts
  // total", "sort by total market value"): the grid can't show what the word asks for, whatever the rest means.
  for (const type of ["columns.pin", "density.set", "aggregation.set"] as const) {
    if (lists(type)) continue;
    const asked = input.clauses.filter(
      (clause) =>
        viewWordsOf.get(clause.index)?.operations.some((op) => op.type === type) ||
        (!refusedPart(clause.index) &&
          viewWordsLeftOf.get(clause.index)?.some((w) => w.form === type || (type === "aggregation.set" && w.total))),
    );
    for (const clause of asked) unlistedView.add(clause.index);
    const first = asked[0];
    if (first) (refusedAny ? unlistedIfNotRefused : unlisted).push({ index: first.index, op: { type } });
  }
  unlisted.sort((a, b) => a.index - b.index);
  if (unsupportedSegments.length === 0) for (const { index, op } of unlisted) clarifications.push(cantQuestion(index, op));

  if (unsupportedSegments.length === 0 && unlisted.length === 0) {
    // The words read at the end of a part go into the plan after the rest of that part: at the start of the next
    // part, or once every part is compiled.
    // The words read at the end of a part, from the part's whole text, without the joining "and" or comma.
    const saidAt = (clause: Clause, from: number) =>
      (c.input.clauses.find((x) => x.index === clause.index)?.text ?? clause.text).slice(from).replace(/^\s*(?:,\s*)?(?:and\s+)?/, "");
    let pendingTail: { clause: Clause; reading: ViewWordsReading; start: number } | undefined;
    const placeTail = () => {
      if (!pendingTail) return;
      const { clause, reading, start } = pendingTail;
      pendingTail = undefined;
      // A total said after a sort, or after a list of columns to hide or show, may be one more item of that list:
      // "sort by gain and average concentration" may sort by Concentration too, and "hide custodian and average
      // concentration" hide it. A pin can't be a sort or a column to hide, but those words can. A grouping can't group
      // by a total, so a total after one is read ("group by advisor and total market value").
      const list = holdsTotals(reading)
        ? operations
            .slice(start)
            .find((op) => (op.type === "sort.set" && op.sorts.length > 0) || op.type === "columns.hide" || op.type === "columns.show")
        : undefined;
      // The same for a total said after a clear that names what it removes: "clear the sort and total market value" may
      // remove that total too. A clear said in one word ("ungroup") names nothing, so the words after it are their own.
      const clear =
        holdsTotals(reading) && !list && (clause.text.match(/[\p{L}\p{N}]+/gu) ?? []).length > 1
          ? operations
              .slice(start)
              .find(
                (op) =>
                  (op.type === "sort.set" && op.sorts.length === 0) ||
                  (op.type === "group.set" && op.columnIds.length === 0) ||
                  op.type === "filter.clear" ||
                  (op.type === "aggregation.set" && op.aggregations.length === 0),
              )
          : undefined;
      if (list || clear) {
        const said = saidAt(clause, reading.from ?? 0);
        const fn = reading.operations.find((op) => op.type === "aggregation.set");
        const what = fn?.type === "aggregation.set" && fn.aggregations[0]?.function === "avg" ? "average" : "total";
        const verb = list?.type === "sort.set" ? "sort by" : list?.type === "columns.hide" ? "hide" : "show";
        clarifications.push({
          id: `c${clause.index}.viewWords`,
          prompt: list
            ? `GridCue can't tell whether “${said}” is one more column to ${verb}. To show the ${what}, ask for it on its own.`
            : removesToo(said, what === "average" ? "avg" : "sum"),
          required: true,
        });
        return;
      }
      const placed = placeViewWords(clause, reading.operations);
      if (placed) readTail.set(clause.index, placed);
    };
    for (const clause of input.clauses) {
      placeTail();
      const key = `c${clause.index}`;
      // View words come first (spec 4.1). A part read whole uses the reader's operations, and the provider's families
      // for it are ignored. A part not read goes on exactly as before.
      const viewWords = viewWordsOf.get(clause.index);
      // A pin, density or total the grid can't do, beside a part the provider refuses, is left out (above). So is a
      // total beside a refused part on a grid that shows totals: the request is refused, and its plan holds no total.
      const refusedTotals = refusedAny && holdsTotals(viewWords);
      if (refusedTotals) totalsBesideRefusal.push(clause);
      const cant = unlistedView.has(clause.index) || refusedTotals;
      if (viewWords?.from !== undefined) {
        if (!cant) pendingTail = { clause, reading: viewWords, start: operations.length };
      } else if (
        viewWords?.operations.some((op) => op.type === "columns.pin" || op.type === "density.set" || op.type === "aggregation.set")
      ) {
        const placed = cant ? undefined : placeViewWords(clause, viewWords.operations);
        if (placed) readWhole.set(clause.index, placed);
        continue;
      }
      // A total that doesn't fit its column's kind asks, before the provider reads the part (ADR 0030).
      const kindAsk = totalsKindAsks.get(clause.index);
      if (kindAsk) {
        clarifications.push(kindAsk);
        continue;
      }
      // Words that would read as a pin or a density but for a name of the Host's ("compact view" where Compact is a size
      // class, "pin restricted") may name the Host's value or the rows: ask (spec 5.2), before the provider reads them.
      const viewWordsAsk = viewWordsAsks.get(clause.index);
      if (viewWordsAsk !== undefined) {
        if (cant) continue;
        clarifications.push({ id: `${key}.viewWords`, prompt: viewWordsAsk, required: true });
        continue;
      }
      const readCount = (viewWords?.from === undefined ? viewWords : undefined)?.operations.flatMap((op) =>
        op.type === "limit.set" ? [op.count] : [],
      )[0];
      if (typeof readCount === "number") {
        // "Show only the first 5 rows" on a grid that keeps no count: a question with no choices, and nothing applies.
        if (!canCount) {
          clarifications.push(cantQuestion(clause.index, { type: "limit.set", count: readCount }));
          continue;
        }
        readWhole.set(clause.index, [setCount(readCount, clause.index)]);
        note(`${key}.words`, "limit.set", 1, "deterministic");
        continue;
      }
      // "Show every row" and "remove the count" clear the count. On a view with no count that is a clear of nothing, as
      // "clear the sort" is on a view with no sort. But with filters and no count, "every row" may mean the rows the
      // filters leave out, and on a grid that keeps no count there is none to clear: both go to the provider, as before.
      const saysCount = clause.text.endsWith("count");
      if (readCount === null && canCount && (c.state.limit !== undefined || saysCount || predicatesIn(c.state.filters) === 0)) {
        readWhole.set(clause.index, [setCount(null, clause.index)]);
        if (c.state.limit === undefined && !saysCount) everyRowOfAll.add(clause.index);
        note(`${key}.words`, "limit.set", 1, "deterministic");
        continue;
      }
      // "Show all accounts" on a view with a count and filters: every row of the filtered view, or of the grid?
      if (canCount && c.state.limit !== undefined && predicatesIn(c.state.filters) > 0 && namesEveryRow(clause, mentions, c.schema)) {
        const answerKey = `${key}.rows`;
        const answer = answers[answerKey];
        if (answer === "count" || answer === "filters") {
          const ops = [setCount(null, clause.index)];
          if (answer === "filters") {
            const clear: ViewOperation = { type: "filter.clear" };
            operations.push(clear);
            ops.push(clear);
          }
          readWhole.set(clause.index, ops);
          note(answerKey, answer, 1, "user");
        } else {
          clarifications.push({
            id: answerKey,
            prompt: "Show every row, or clear the filters too?",
            options: [
              { id: "count", label: "Show every row" },
              { id: "filters", label: "Clear the filters too" },
            ],
            required: true,
          });
        }
        continue;
      }
      const proposed: ClauseResolution = resolution.clauses.find((r) => r.clauseIndex === clause.index) ?? {
        clauseIndex: clause.index,
        families: [],
        columns: [],
        values: [],
        unmatchedTerms: [],
      };
      const partMentions = mentions.filter((m) => m.clauseIndex === clause.index);
      // Beside a code-read filter, every word is placed (ADR 0023): a word GridCue didn't place is asked about, before
      // anything a provider proposes for the part. A part that holds no code-read filter skips all of this, and is
      // compiled exactly as before. A name inside a code-read filter is the filter's own, so nothing else reads it.
      const codeRead = codeReadAll.filter((r) => r.clauseIndex === clause.index);
      const beside = codeRead.length > 0 ? { clause, mentions: partMentions, codeRead, schema: c.schema } : undefined;
      const ownMentions = beside ? outsideCodeRead(partMentions, codeRead) : partMentions;
      // A refusal stays a refusal: the words a provider refuses a part for ("email", "export") are not asked about.
      const refused =
        !clause.keeps && proposed.families.some((f) => KNOWN_FAMILY_IDS.has(f.id) && !isView(f.id) && f.confidence >= bands.clarify);
      // A time word outside a date form GridCue read is never dropped (spec 5.5): "this week", "since january", "90 days
      // ago" ask, in every part, with a code-read filter or without. Declared names and quoted text are not looked in.
      if (!refused) {
        const time = timeWordsOutside(clause, mentions, [...codeRead, ...(local.asks.get(clause.index)?.spans ?? [])], c.schema);
        if (time) {
          clarifications.push({ id: `${key}.dates`, prompt: datesPrompt(time.text), required: true });
          continue;
        }
      }
      const dateFilters = codeRead.filter((r): r is CodeReadFilter => isCodeReadFilter(r) && r.kind === "date");
      // A House Term is read only as the rows to keep (spec 4.1, 5.3): left out, where a column goes, or said as a
      // statement, it asks, before anything else is asked about the part.
      if (beside && !refused) {
        const asks = termQuestion(termsIn(codeRead), clause, partMentions, c.schema);
        if (asks) {
          clarifications.push({ id: `${key}.term.${asks.id}`, prompt: asks.prompt, required: true });
          continue;
        }
      }
      // A Local Value is read only as the rows to keep, and never where a column goes (spec 4.1, 5.4).
      const localFilters = codeRead.filter((r): r is CodeReadFilter => isCodeReadFilter(r) && r.kind === "value");
      if (beside && !refused) {
        const asks = valuePlaceQuestion(localFilters, clause, partMentions, c.schema);
        if (asks) {
          clarifications.push({ id: `${key}.local.${asks.id}`, prompt: asks.prompt, required: true });
          continue;
        }
        const twice = local.again.get(clause.index);
        if (twice) {
          clarifications.push(twice);
          continue;
        }
      }
      // A tie, or one word of a value, asks which was meant (spec 5.4). Words GridCue can't place are asked about
      // first, all of them at once: a value chosen for one word would leave the others unplaced.
      const localAsks = local.asks.get(clause.index);
      if (localAsks && !refused) {
        const unplaced = unplacedWords({ clause, mentions: partMentions, codeRead: [...codeRead, ...localAsks.spans], schema: c.schema });
        clarifications.push(unplaced.length > 0 ? unplacedQuestion(clause, unplaced) : localAsks.question);
        continue;
      }
      if (beside && !refused) {
        const unplaced = unplacedWords(beside);
        if (unplaced.length > 0) {
          clarifications.push(unplacedQuestion(clause, unplaced));
          continue;
        }
      }
      // Values that are no one list for each column ask (spec 5.4): "Avery Lane's accounts for Blake Moreno".
      const apart = local.apart.get(clause.index);
      if (apart && beside && !refused) {
        clarifications.push(apart);
        continue;
      }
      // A Local Value in a statement, or owning something other than the rows, asks (spec 5.4).
      if (beside && !refused) {
        const otherFilters = codeRead.filter((r): r is CodeReadFilter => isCodeReadFilter(r) && r.kind !== "value");
        const asks = valueStatement(localFilters, otherFilters, clause, partMentions, c.schema);
        if (asks) {
          clarifications.push({ id: `${key}.local.${asks.id}`, prompt: asks.prompt, required: true });
          continue;
        }
        // A date said as a statement asks, as a form does: "entries were booked last quarter" (spec 5.5).
        const said = dateStatement(dateFilters, clause, partMentions, c.schema);
        if (said) {
          clarifications.push({ id: `${key}.date.statement`, prompt: said, required: true });
          continue;
        }
        // A date is read only as the rows to keep, and only on a grid with a date column (spec 5.5).
        const where = dateQuestion(dateFilters, clause, c.schema);
        if (where) {
          clarifications.push({ id: `${key}.date.${where.id}`, prompt: where.prompt, required: true });
          continue;
        }
      }
      // A word for no value outside an empty form is read nowhere: "sort by advisor, blanks last" would sort and drop
      // "blanks last", since where empty rows go in a sort is not something GridCue reads. Nor is a word made from a
      // House Term's name ("larger" in "show larger taxable accounts"), since a term is found only as a whole word, or
      // an adverb beside what the part keeps ("largely" in "accounts largely in retirement"), which no filter holds. The
      // part asks (order plan, D4). Beside a code-read filter, `unplacedWords` already asks about such words.
      if (!beside && !refused) {
        // An amount whose comparison GridCue can't read asks about it below, naming the amount: "market value roughly
        // $1m", "$1m, approximately". Its part's adverbs are left to that question.
        const amountAsks = clause.literals.some((lit) => comparisonUnread(clause, lit, partMentions, readNames));
        const found = [
          ...emptyWordsOutside(clause, partMentions),
          ...termWordsOutside(clause, partMentions, c.schema),
          ...(amountAsks ? [] : unreadAdverbs(clause, partMentions, c.schema)),
        ];
        // "Largely" is made from "Large" and is an adverb too: name it once.
        const unread = found
          .filter((w, i) => found.findIndex((o) => o.start === w.start && o.end === w.end) === i)
          .sort((a, b) => a.start - b.start);
        if (unread.length > 0) {
          clarifications.push(unplacedQuestion(clause, unread));
          continue;
        }
      }
      // The filters the part's code-read filters read (spec 4.1, 5.2). Code decides that the part filters, and writes
      // each one only where its column takes it; otherwise the part asks. Their words are theirs alone: a literal or a
      // negation inside one is never read again below.
      const readFilters = codeRead.filter(isCodeReadFilter);
      const inCodeRead = (at: number) => codeRead.some((r) => at >= r.start && at < r.end);
      if (readFilters.length > 0 && !refused) {
        const next = input.clauses[clause.index + 1];
        const asks = readFilters.map((r) => codeReadQuestion(r, clause, column, mentions, next)).find((q) => q !== undefined);
        if (asks) {
          clarifications.push({ id: `${key}.form`, prompt: asks, required: true });
          continue;
        }
        // What a clear or reset keeps ("clear filters except advisor is empty") is kept only when the view has it, and
        // GridCue doesn't look for a code-read filter there: ask.
        if (clause.keeps) {
          clarifications.push({ id: `${key}.keep`, prompt: KEEP_FORM_PROMPT, required: true });
          continue;
        }
      }
      // Then the provider's choices, narrowed by ADR 0022 and, beside a code-read filter, limited to what the words name.
      const narrowed = narrowProposal(proposed, clause, ownMentions, c.schema, bands, (e) => evidence.push(e));
      const res = beside && !refused ? limitPicks(narrowed, beside, (e) => evidence.push(e)) : narrowed;
      // What the plan held before this part, to tell afterwards which operations the part added or changed.
      const heldBefore = beside ? new Map(operations.map((op) => [op, JSON.stringify(op)])) : undefined;
      // The same for a grouping, on a grid that can group, when a word built on "group" is a word of a Local Value the
      // grid holds (below).
      const heldWords = local.valueWords.get(clause.index);
      const groupedBefore =
        lists("group.set") && heldWords && [...heldWords].some((w) => w.includes("group"))
          ? new Map(
              operations.flatMap((op) => (op.type === "group.set" || op.type === "view.reset" ? [[op, JSON.stringify(op)] as const] : [])),
            )
          : undefined;
      const opsBefore = operations.length;
      // Mentions are deterministic: a named value is used at confidence 1. A named column is too, unless the provider
      // scored that column below MENTION_FLOOR: "biggest accounts first" names the rows, not Account number (ADR 0013).
      const own = ownMentions;
      // "Accounts over $1m. Or northgate accounts": a part that starts with "or" offers another set of rows, and
      // filters combine with "and".
      // Negations GridCue can't be sure about ask, never act: "don't sort by gain", "never hide trusts" (a negation before a
      // view verb other than "show"), "never show never show trusts" (two negations in one part), and "show nothing
      // over $1m" or "show accounts including trusts" (whether the rows are kept or left out is unclear).
      // A code-read filter's own words ("no advisor", "isn't empty") are read with it, and never as a negation here.
      const unsure = unsureNegation(
        namesBlankedOf(unquoted(clause.text), codeRead),
        own,
        clause.literals.some((l) => l.kind === "text" && !inCodeRead(l.at)),
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
        const kept = keepPart(clause, own, c.state, c.defaultState, operations, column, c.newId, c.schema);
        // What is kept is all the plan holds for this part, so another change's words in it are asked about (ADR 0023).
        const unplaced = beside && "operations" in kept ? unplacedWords({ ...beside, operations: kept.operations }) : [];
        if (unplaced.length > 0) clarifications.push(unplacedQuestion(clause, unplaced));
        else if ("operations" in kept) operations.push(...kept.operations);
        else clarifications.push({ id: `${key}.keep`, prompt: kept.prompt, required: true });
        continue;
      }
      const scored = new Map(res.columns.map((p) => [p.id, p.confidence]));
      const mentionedColumns: string[] = [];

      // An ambiguous row or entity noun ("largest households first") takes the provider's reading, or the User's
      // answer. "rows" drops the Mention; "records" asks rather than guessing, since GridCue can only group (ADR 0015).
      const readAsRows = new Set<string>();
      let groupAnswer: string | undefined;
      let rankAnswer: { col: ColumnDescriptor; answerKey: string } | undefined;
      let readingPending = false;
      // The third choice (spec 5.4; ADR 0030): rank the records by a total. Offered only on a grid that shows totals,
      // groups and sorts, for a request that says which way ("largest", "smallest"), by the one column the part names,
      // or else the one the provider picks with confidence, or else the column its ranking word is made from ("most
      // concentrated"), or else the Host's main value column for a size word (`defaultMeasure`). That column must take a total and a sort. A sum where its kind takes one, else an average.
      const rankFor = (entity: ColumnDescriptor) => {
        const direction = clause.direction;
        if (!direction || !lists("aggregation.set") || !lists("group.set") || !lists("sort.set")) return undefined;
        const fits = (col: ColumnDescriptor | undefined): col is ColumnDescriptor =>
          !!col &&
          col.id !== entity.id &&
          col.capabilities.includes("aggregate") &&
          col.capabilities.includes("sort") &&
          (totalKindIssue(col, "sum") === undefined || totalKindIssue(col, "avg") === undefined);
        const named = [...new Set(own.filter((m) => m.valueId === undefined && !m.ambiguous).map((m) => m.columnId))].filter(
          (id) => id !== entity.id,
        );
        const picked = [...new Set(res.columns.filter((p) => p.confidence >= bands.ready).map((p) => p.id))].filter(
          (id) => id !== entity.id,
        );
        const ids = named.length > 0 ? named : picked;
        const by =
          ids.length === 0
            ? (rankedByAdjective(clause.text) ?? measureFor(clause.text))
            : ids.length === 1
              ? column(ids[0] ?? "")
              : undefined;
        if (!fits(by)) return undefined;
        const fn: "sum" | "avg" = totalKindIssue(by, "sum") === undefined ? "sum" : "avg";
        return { by, fn, direction };
      };
      for (const m of own.filter((x) => x.ambiguous)) {
        const col = column(m.columnId);
        if (!col) continue;
        // Beside a code-read filter the Row Noun is placed as the rows (spec 4.2), so it names no column of another
        // change: in "show the advisor column for large accounts", "accounts" is no Account number column.
        if (beside && isRowNoun(clause, m, c.schema.rowNoun)) {
          readAsRows.add(col.id);
          evidence.push({ key: `dropped:${key}.mention`, selectedId: col.id, confidence: 1, source: "deterministic" });
          continue;
        }
        const answerKey = `${key}.reading.${col.id}`;
        const answer = answers[answerKey];
        if (answer === "group") groupAnswer = col.id;
        if (answer === "rank") rankAnswer = { col, answerKey };
        if (answer !== undefined) continue;
        const reading = m.records
          ? { columnId: col.id, reading: "records" as const, confidence: 1 }
          : res.readings?.find((r) => r.columnId === col.id);
        if (!reading || reading.confidence < FAN_OUT.reading) continue;
        if (reading.reading === "rows") {
          readAsRows.add(col.id);
          evidence.push({ key: `dropped:${key}.mention`, selectedId: col.id, confidence: reading.confidence, source: "provider" });
        } else if (reading.reading === "records" && col.entity) {
          const rank = rankFor(col);
          clarifications.push({
            id: answerKey,
            prompt: `Did you mean ${col.entity}s as a whole? GridCue can group by ${col.label}.`,
            options: [
              { id: "group", label: `Group by ${col.label}` },
              { id: "column", label: `Use the ${col.label} column` },
              ...(rank
                ? [{ id: "rank", label: `Rank ${col.entity}s by ${rank.fn === "sum" ? "total" : "average"} ${rank.by.label}` }]
                : []),
            ],
            required: true,
          });
          readingPending = true;
        }
      }
      if (readingPending) continue;
      // "Rank households by total Market value": the grouping, the total and the sort on the total's column, in that
      // order, so the Preview says all three. The total is added to the view's, as any total is; the grouping and the
      // sort replace the view's. A hidden column is shown first. The part's other words are checked as any part's are.
      const rank = rankAnswer && rankFor(rankAnswer.col);
      if (rankAnswer && rank) {
        const { by, fn, direction } = rank;
        if (!viewSoFar().visibleColumnIds.includes(by.id)) operations.push({ type: "columns.show", columnIds: [by.id] });
        const list = viewSoFar().aggregations.filter((a) => a.columnId !== by.id);
        const at = viewSoFar().aggregations.findIndex((a) => a.columnId === by.id);
        const total = { columnId: by.id, function: fn };
        operations.push(
          { type: "group.set", columnIds: [rankAnswer.col.id] },
          { type: "aggregation.set", aggregations: at < 0 ? [...list, total] : [...list.slice(0, at), total, ...list.slice(at)] },
          { type: "sort.set", sorts: [{ columnId: by.id, direction }] },
        );
        note(rankAnswer.answerKey, "rank", 1, "user");
        continue;
      }
      if (rankAnswer) {
        clarifications.push({ id: rankAnswer.answerKey, prompt: "GridCue can't rank them that way here.", required: true });
        continue;
      }
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
      const hasFilterArgs =
        clause.literals.length > 0 || values.some((v) => v.mentioned || v.confidence >= bands.clarify) || readFilters.length > 0;

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
          // A text form's quoted text is its column's, read by code.
          if (inCodeRead(lit.at)) return [];
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
      // So are a code-read filter's words: "with no advisor" leaves no row out.
      const namesBlanked = [...own, ...codeRead].reduce(
        (t, m) => t.slice(0, m.start) + " ".repeat(m.end - m.start) + t.slice(m.end),
        clause.text,
      );
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
      // A code-read filter is code's own reading: the part filters whatever the provider proposed (spec 4.1).
      let codeReadPick: Pick | undefined;
      if (readFilters.length > 0 && !accepted.some((f) => f.id === "filter")) {
        codeReadPick = { id: "filter", confidence: 1 };
        accepted.push(codeReadPick);
        evidence.push({ key: `${key}.codeRead`, selectedId: "filter", confidence: 1, source: "deterministic" });
      }
      const settled = settleFamilies(accepted, middling, viable, { separable, kind: res.kind });
      const families = settled.kept;
      if (settled.byKind && res.kind)
        evidence.push({ key: `${key}.kind`, selectedId: res.kind.id, confidence: res.kind.confidence, source: "provider" });
      // The family code added for a code-read filter is recorded above as code's, not again as the provider's.
      for (const f of families)
        if (f !== codeReadPick && answers[`${key}.family.${f.id}`] === undefined) note(`${key}.family`, f.id, f.confidence, "provider");
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
          const changes = hintChanges(lists, "ask");
          clarifications.push({
            id: `${key}.family`,
            prompt: `I'm not sure what to change for “${clause.text}”.${changes ? ` Try asking to ${changes}.` : ""}`,
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
      // A change to show only some columns ("just the advisor") reads the columns it names and drops every other word:
      // "just the accounts where the advisor is Blake Moreno" would show Advisor alone. It is ready only when the part
      // holds nothing but that change's own words; otherwise it asks (order plan, D4). Beside a code-read filter,
      // `unplacedWords` and `limitPicks` already check this. A column the provider picked that no Mention names ("just
      // the balance column") has words GridCue can't tell apart from the rest, so that part reads as before.
      const providerNamed = res.columns.some(
        (p) => p.confidence >= bands.clarify && !mentionedColumns.includes(p.id) && !readAsRows.has(p.id),
      );
      if (!beside && !providerNamed && viewFamilies.includes("columns.only")) {
        const stray = strayBesideColumnsOnly(clause, own);
        if (stray.length > 0) {
          clarifications.push(unplacedQuestion(clause, stray));
          continue;
        }
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
          const pred = (columnId: string, operator: FilterPredicate["operator"], value?: FilterPredicate["value"]) => {
            const id = c.newId("filter");
            predicates.push({ id, type: "predicate", columnId, operator, ...(value === undefined ? {} : { value }) });
            return id;
          };
          // Where each filter's words start in the part, where code knows: a named value's or a column's, an amount's.
          const placedAt = new Map<string, number>();
          const namedAt = (columnId: string) => own.find((m) => m.columnId === columnId)?.start;
          const at = (id: string, start: number | undefined) => {
            if (start !== undefined) placedAt.set(id, start);
          };
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
              if (isBoolean) at(pred(col.id, "eq", v.valueId === "true"), namedAt(col.id));
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
            if (added) at(added.id, namedAt(id));
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
          // Before "where", only "the", "all" and the like may stand before the rows: "hide pending accounts where …"
          // would drop "pending", and "remove cleared entries where …" would read it as a second condition.
          const beforeWhere = /^\s*(.*?)\s+where\b/.exec(afterExclusionLead(bare) ?? "")?.[1];
          const wordsBeforeRows = !!beforeWhere && !/^(?:(?:the|all|any|those|these)\s+)*\S+$/.test(beforeWhere);
          // A code-read filter is never read where rows are left out (spec 4.1): "hide accounts with no advisor" asks.
          if (
            excluding &&
            (conditions > 1 ||
              readFilters.length > 0 ||
              yes ||
              unreadName ||
              wordsBeforeRows ||
              (mentionedValues.length > 0 && unclearValue) ||
              /\b(?:except|but|other than|apart from)\b/.test(unquoted(clause.text)))
          ) {
            clarifications.push({ id: `${key}.exclude`, prompt: EXCLUDE_PROMPT, required: true });
            continue;
          }
          // A Local Value beside quoted text is read as a named value is, with its possessive: `Avery Lane's accounts
          // with household containing "alder"`.
          const withValues =
            localFilters.length === 0
              ? own
              : [...own, ...localFilters.map((r) => asNamedValue(r, clause))].sort((a, b) => a.start - b.start);
          clause.literals.forEach((lit, j) => {
            // A text form's quoted text is read with its code-read filter, below.
            if (inCodeRead(lit.at)) return;
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
            const unread = lit.kind === "text" ? textWordsQuestion(clause, lit, quotedAfter, withValues, c.schema) : undefined;
            if (unread) {
              clarifications.push({ id: `${key}.literal${j}.${unread.id}`, prompt: unread.prompt, required: true });
              return;
            }
            if (comparisonUnread(clause, lit, own, readNames, codeRead)) {
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
            // A date on a date-and-time column means the whole day in the Calendar's time zone (ADR 0026).
            const operator = lit.kind === "text" ? "contains" : (lit.comparator ?? "eq");
            if (!target || !operatorsFor(target).includes(operator)) {
              const options = optionsFor(fits, "filter");
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
            const made = pred(target.id, kept, operator === "between" ? { min: lit.value, max: lit.upper ?? lit.value } : lit.value);
            at(made, lit.at);
            // A relative date form's literal (`normalize` with today) names its words after its dates (spec 4.5).
            if (lit.words !== undefined)
              evidence.push({ key: `${key}.dateWords.${made}`, selectedId: lit.words, confidence: 1, source: "deterministic" });
            // "At or below $1m" also leaves out rows with no amount, which "exclude accounts over $1m" didn't name.
            if (excludes) evidence.push({ key: `${key}.leftOutEmpty`, selectedId: target.id, confidence: 1, source: "deterministic" });
          });
          /** The column for a date with none named right before it, or `undefined` when the part asks which (spec 5.5). */
          const dateColumnFor = (r: CodeReadFilter, i: number): string | undefined => {
            const answerKey = `${key}.date${i}.column`;
            const takes = (col: ColumnDescriptor | undefined): col is ColumnDescriptor =>
              !!col &&
              DATE_COLUMN_KINDS.has(col.kind) &&
              col.capabilities.includes("filter") &&
              operatorsFor(col).includes(r.predicate.operator);
            const answered = answers[answerKey] ? column(answers[answerKey]) : undefined;
            if (takes(answered)) {
              note(answerKey, answered.id, 1, "user");
              return answered.id;
            }
            // A column the part names is the User's, for its own change ("sorted by posted") or for another date ("booked
            // this quarter"): never taken for this date. Names inside a code-read filter count too.
            const named = new Set([
              ...partMentions.filter((m) => m.valueId === undefined).map((m) => m.columnId),
              ...readFilters.flatMap((f) => (f.kind === "date" && f.predicate.columnId ? [f.predicate.columnId] : [])),
            ]);
            const inSpan = (j: number) => {
              const lit = clause.literals[j];
              return !!lit && lit.at >= r.start && lit.at < r.end;
            };
            // The provider's date column comes from its proposal: the limit on its picks keeps it from a sort or a
            // grouping, which no word names (spec 4.2).
            const picks = [
              ...narrowed.columns.filter((p) => p.confidence >= bands.ready).map((p) => ({ id: p.id, confidence: p.confidence })),
              ...(res.literalColumns ?? [])
                .filter((l) => l.confidence >= bands.ready && inSpan(l.literalIndex))
                .map((l) => ({ id: l.columnId, confidence: l.confidence })),
            ].filter((p) => takes(column(p.id)) && !named.has(p.id) && !used.has(p.id));
            const ids = [...new Set(picks.map((p) => p.id))];
            const [only] = ids;
            if (ids.length === 1 && only) {
              note(answerKey, only, Math.max(...picks.map((p) => p.confidence)), "provider");
              return only;
            }
            clarifications.push({
              id: answerKey,
              prompt: `Which date column should “${dateWordsOf(r, clause)}” filter?`,
              options: optionsFor(null, "filter").filter((o) => takes(column(o.id))),
              required: true,
            });
            return undefined;
          };
          // Each code-read filter, as code read it (spec 4.1). Its column was checked above. "Or" next to one asks below,
          // whatever the other side names: GridCue never joins a code-read filter to anything with "or".
          // A House Term's filters carry its label in `host` evidence, which the Preview names (spec 4.5). They go where
          // the term sits among the part's other filters, in the term's order: "large taxable accounts" previews Large
          // first. A part with no term keeps its filters as before.
          // Several Local Values of one column are one filter, made where the first of them sits (spec 5.4).
          const valueColumns = new Set<string>();
          readFilters.forEach((r, i) => {
            if (r.kind === "date") {
              // A date's column is the one named right before it. With none named, it is the provider's confident pick
              // of a date column the part doesn't name for something else, or the User's answer; otherwise GridCue asks
              // which (spec 5.5). The fixed days are written with today's operators.
              const columnId = r.predicate.columnId || dateColumnFor(r, i);
              if (!columnId) return;
              used.add(columnId);
              const id = pred(columnId, r.predicate.operator, r.predicate.value);
              resolvedDates.set(r, columnId);
              dateFilterIds.add(id);
              sides.push({ at: r.start, columnId: `\u0000code-read ${i}` });
              note(`${key}.codeRead${i}`, `${columnId}.${r.predicate.operator}`, 1, "deterministic");
              if (r.dateWords !== undefined)
                evidence.push({ key: `${key}.dateWords.${id}`, selectedId: r.dateWords, confidence: 1, source: "deterministic" });
              placedAt.set(id, r.start);
              return;
            }
            if (r.kind === "value") {
              // Values of one column are one side of an "or": "Avery Lane or Blake Moreno" is one filter.
              sides.push({ at: r.start, columnId: r.predicate.columnId });
              if (valueColumns.has(r.predicate.columnId)) return;
              valueColumns.add(r.predicate.columnId);
            }
            const before = predicates.length;
            const id = pred(r.predicate.columnId, r.predicate.operator, r.predicate.value);
            if (r.kind === "value") {
              localFilterIds.add(id);
              note(`${key}.codeRead${i}`, `${r.predicate.columnId}.${r.predicate.operator}`, 1, "deterministic");
              const sitsBefore = predicates.slice(0, before).findIndex((p) => (placedAt.get(p.id) ?? -1) > r.start);
              if (sitsBefore >= 0) predicates.splice(sitsBefore, 0, ...predicates.splice(before, 1));
            } else if (r.term !== undefined) {
              // A term's conditions are one side of an "or": "large or taxable accounts" asks either-or, as today.
              sides.push({ at: r.start, columnId: `\u0000term ${r.start}` });
              note(`${key}.codeRead${i}`, `${r.predicate.columnId}.${r.predicate.operator}`, 1, "host");
              evidence.push({ key: `${key}.term.${id}`, selectedId: r.term, confidence: 1, source: "host" });
              const sitsBefore = predicates.slice(0, before).findIndex((p) => (placedAt.get(p.id) ?? -1) > r.start);
              if (sitsBefore >= 0) predicates.splice(sitsBefore, 0, ...predicates.splice(before, 1));
            } else {
              sides.push({ at: r.start, columnId: `\u0000code-read ${i}` });
              note(`${key}.codeRead${i}`, `${r.predicate.columnId}.${r.predicate.operator}`, 1, "deterministic");
            }
            placedAt.set(id, r.start);
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
          // A Local Value's words are its own: "Riley As Well" or "Further Lane" never says to keep the filters. They stand
          // as one plain word, so "also" still goes with the value after it: "also Avery Lane's accounts".
          const ownWords = readFilters.reduce(
            (text, r) => (r.kind === "value" ? text.slice(0, r.start) + "x".repeat(r.end - r.start) + text.slice(r.end) : text),
            clause.text,
          );
          const replacing =
            predicates.length > 0 &&
            predicatesIn(c.state.filters) > 0 &&
            !keepsFilters(ownWords) &&
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
          // A code-read filter's words name its column, never an unknown one.
          const unknown =
            cols.length > 0
              ? undefined
              : (res.unmatchedTerms[0] ?? (pending || own.length > 0 || codeRead.length > 0 ? undefined : unknownTerm(clause.text)));
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
          // A size or age word speaks of how big or how old the rows are, so its direction sorts only a column that holds
          // a size. In "which advisor has the largest accounts?" and "accounts by advisor, largest first" it is no order
          // for Advisor, and the User may mean the largest accounts first, or a grouping: ask which column, as "largest
          // accounts" does (order plan, D4). A phrase in a part that says "sort" or "order" itself is the order of the
          // column it sorts: "sort by advisor, largest first". "Descending" and "A to Z" say only an order.
          const blanked = family === "sort" && !answered && clause.direction ? namesBlankedOf(clause.text, partMentions) : undefined;
          if (
            blanked !== undefined &&
            (directionFromSizeAlone(blanked) || (directionBySize(blanked) && !SAYS_SORT.test(unquoted(blanked))))
          ) {
            if (cols.some((col) => !SIZED_KINDS.has(col.kind))) {
              clarifications.push({
                id: answerKey,
                prompt: `Which column should be ${COLUMN_WORD[family]}?`,
                options: optionsFor(null, capability),
                required: true,
              });
              continue;
            }
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
        if (canCount) {
          setCount(clause.limit, clause.index);
          note(`${key}.limit`, String(clause.limit), 1, "deterministic");
        } else {
          evidence.push({ key: `dropped:${key}.limit`, selectedId: String(clause.limit), confidence: 1, source: "host" });
        }
      }
      // G2. The provider proposes, code decides (AGENTS.md): a plan is never ready with fewer clears than the clear
      // verb governs. "Clear filters, grouping" that would clear only the filters asks instead.
      const governedHere = governedClears(unquoted(namesBlankedOf(clause.text, [...ownMentions, ...codeRead])));
      const added = operations.slice(opsBefore);
      // A sort or grouping that still holds a column the part names ("clear the gain sort" sorted by Gain) clears nothing.
      const namedHere = new Set(ownMentions.filter((m) => m.valueId === undefined).map((m) => m.columnId));
      const clearedHere: Record<string, boolean> = {
        filter: added.some((o) => o.type === "filter.clear"),
        sort: added.some((o) => o.type === "sort.set" && !o.sorts.some((s) => namedHere.has(s.columnId))),
        group: added.some((o) => o.type === "group.set" && !o.columnIds.some((id) => namedHere.has(id))),
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
      // ADR 0023, once the part's operations are known. Another change's own words ("sorted by", "hide") and a verb
      // read only for columns ("add", "pin") are placed only when the plan holds that change for this part: "pin
      // advisor for …" beside a filter would otherwise be ready with the pin dropped. A part that already asks is left
      // to its question; the check runs again once that is answered.
      if (beside && heldBefore && !clarifications.some((q) => q.id.startsWith(`${key}.`))) {
        const held = operations.filter((op) => heldBefore.get(op) !== JSON.stringify(op));
        const unplaced = unplacedWords({ ...beside, operations: held });
        if (unplaced.length > 0) clarifications.push(unplacedQuestion(clause, unplaced));
      }
      // A word built on "group" that the part doesn't group by is dropped, and when the grid holds a value with that word
      // the User may have named the value: "Travel Group entries", when the grid holds Hollis Travel Group, would filter
      // Category to Travel. It asks with ADR 0019's question. Only a word of a Local Value counts: with no Local Values,
      // or none that holds the word ("show accounts in the Northgate group" on a grid whose values don't), the part reads
      // as before. A grouping said to stay or left out, as `groupingAsked` reads it, and a word that is the text to
      // match, are not asked about. Nor is the verb a part that continues a grouping carries from the part before
      // ("group by custodian, then northgate"): the User said it there.
      if (groupedBefore !== undefined && heldWords && !clarifications.some((q) => q.id.startsWith(`${key}.`))) {
        const grouped = operations.some(
          (op) => (op.type === "group.set" || op.type === "view.reset") && groupedBefore.get(op) !== JSON.stringify(op),
        );
        const carried = clause.continues ? (/^\S+/.exec(clause.text)?.[0].length ?? 0) : 0;
        const said = carried > 0 ? { ...clause, text: " ".repeat(carried) + clause.text.slice(carried) } : clause;
        const { word } = grouped ? {} : groupingWords(said, [...partMentions, ...localNames(clause)], c.schema.columns);
        if (word && heldWords.has(word)) {
          clarifications.push({
            id: `${key}.group.word`,
            prompt: `I'm not sure what to do with “${word}”. Try rephrasing that part.`,
            required: true,
          });
        }
      }
    }
    placeTail();
    if (unsupportedSegments.length === 0) for (const { index, op } of unlistedIfNotRefused) clarifications.push(cantQuestion(index, op));
    const [leftOutTotals] = totalsBesideRefusal;
    if (unsupportedSegments.length === 0 && leftOutTotals) {
      const whole = c.input.clauses.find((x) => x.index === leftOutTotals.index)?.text ?? leftOutTotals.text;
      const said = whole.slice(tailOf(leftOutTotals.index) ?? 0).replace(/^\s*(?:,\s*)?(?:and\s+)?/, "");
      clarifications.push({
        id: `c${leftOutTotals.index}.unused`,
        prompt: `I'm not sure what to do with “${said}”. Try rephrasing that part.`,
        required: true,
      });
    }
  }

  // View words are read in the order they are said. Parts whose words the rest of the request undoes are asked about
  // with ADR 0019's check below:
  // - a reset said after them returns to the default view, count included, so their line would not be kept;
  // - "show only the first 5 rows" said before a change to the sort or the filters may mean the 5 rows on screen now,
  //   or the first 5 of the new view. The View State holds only the second, and neither is certain (ADR 0027).
  // "Show only the first 5 rows" keeps the first rows of the sorted view as it stands when it is said. With no sort
  // there, nothing says which rows come first: ask, never pick a column.
  // - a sort or grouping said after the count would replace the one said before it (above), so the count's rows would
  //   not be the ones its part names.
  const undone = new Set<number>();
  if (levelAfterCount && countPart !== undefined) undone.add(countPart);
  const viewOf = (v?: { sorts?: ViewState["sorts"]; filters?: ViewState["filters"] }): ViewState => ({
    ...emptyViewState([]),
    sorts: v?.sorts ?? [],
    filters: v?.filters ?? null,
  });
  const viewAt = (at: number) => applyOperations(viewOf(c.state), operations.slice(0, at), viewOf(c.defaultState));
  for (const [index, ops] of [...readWhole, ...readTail]) {
    for (const op of ops) {
      const at = operations.indexOf(op);
      if (at < 0) continue;
      const later = operations.slice(at + 1);
      if (later.some((o) => o.type === "view.reset")) {
        undone.add(index);
        continue;
      }
      // A pin that a later part changes again ("pin advisor, unpin advisor") or whose column a later part hides would not
      // show as said. An unpin a later pin follows ("unpin everything and pin advisor") is said as it shows.
      if (
        op.type === "columns.pin" &&
        op.position !== "none" &&
        later.some((o) => (o.type === "columns.pin" || o.type === "columns.hide") && o.columnIds.some((id) => op.columnIds.includes(id)))
      ) {
        undone.add(index);
        continue;
      }
      // The same for a total a later part removes or replaces, or whose column a later part hides, and for the grouping
      // of "total X by Y" when a later part groups again ("total market value by advisor, group by custodian").
      if (op.type === "aggregation.set") {
        const held = applyOperations(c.state, operations.slice(0, at), { ...c.state, ...c.defaultState }).aggregations;
        const said = op.aggregations.filter((a) => !held.some((b) => b.columnId === a.columnId && b.function === a.function));
        const changed = (o: ViewOperation) =>
          (o.type === "aggregation.set" &&
            said.some((a) => !o.aggregations.some((b) => b.columnId === a.columnId && b.function === a.function))) ||
          (o.type === "columns.hide" && said.some((a) => o.columnIds.includes(a.columnId)));
        if (later.some(changed)) {
          undone.add(index);
          continue;
        }
      }
      if (op.type === "group.set" && later.some((o) => o.type === "group.set")) {
        undone.add(index);
        continue;
      }
      if (op.type !== "limit.set" || op.count === null) continue;
      const said = viewAt(at);
      const end = applyOperations(said, later, said);
      if (rowsKey(end.sorts) !== rowsKey(said.sorts) || filtersKey(end.filters) !== filtersKey(said.filters)) undone.add(index);
      else if (said.sorts.length === 0) {
        clarifications.push({ id: `c${index}.count`, prompt: `First ${countWords(op.count)} by which column?`, required: true });
      }
    }
  }

  // A "No" never dead-ends (v1 grill, Q1): when the User declined something in a part and all that is left there
  // is a question with no choices, say plainly that nothing will change, with the request kept for editing.
  for (const clause of input.clauses) {
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
    // A part read whole as view words used every word (ADR 0028), unless another part replaced what it set (a request
    // holds one count, one density), "every row" has no count to clear and sits beside a filter this request adds, or
    // the rest of the request undoes it (above). Words read at the end of a part are asked about the same way, by
    // those words; the rest of that part is checked like any other.
    const others = { ...input, clauses: input.clauses.filter((clause) => !readWhole.has(clause.index)) };
    const addsFilter = operations.some((op) => op.type === "filter.add");
    const leftOver = c.input.clauses.flatMap((clause) => {
      const read = readWhole.get(clause.index) ?? readTail.get(clause.index);
      const from = tailOf(clause.index);
      const unused =
        read?.some((op) => !operations.includes(op)) || (addsFilter && everyRowOfAll.has(clause.index)) || undone.has(clause.index);
      return unused ? [{ clauseIndex: clause.index, text: clause.text.slice(from ?? 0).replace(/^\s*(?:,\s*)?(?:and\s+)?/, "") }] : [];
    });
    // A date with no column named counts as read by the filter on the column it was given (spec 4.4).
    const codeReadUsed =
      resolvedDates.size === 0
        ? codeReadAll
        : codeReadAll.map((r) => {
            const columnId = isCodeReadFilter(r) ? resolvedDates.get(r) : undefined;
            return columnId !== undefined && isCodeReadFilter(r) ? { ...r, predicate: { ...r.predicate, columnId } } : r;
          });
    const unused = [...unusedReadings(others, mentions, operations, evidence, c.schema.rowNoun, codeReadUsed), ...leftOver];
    for (const left of unused.sort((a, b) => a.clauseIndex - b.clauseIndex)) {
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
  // A Local Value's filter beside another filter on its column that no row can match with it never leaves a ready plan:
  // the view would be empty. With no Local Value in the plan, nothing here runs.
  if (status === "ready" && (localFilterIds.size > 0 || dateFilterIds.size > 0)) {
    const asks = emptyViewQuestion(
      operations,
      viewOf(c.state),
      viewOf(c.defaultState),
      c.schema,
      new Set([...localFilterIds, ...dateFilterIds]),
    );
    if (asks) {
      clarifications.push(asks);
      status = "needs_clarification";
    }
  }
  // On a grid that can't group, a word built on "group" that code couldn't read never leaves a ready plan (more grids
  // spec, 5.3): "sort by value, regroup on advisor" would otherwise sort by advisor and drop the grouping asked for.
  if (status === "ready" && unreadGrouping) {
    clarifications.push(cantQuestion(unreadGrouping.index, { type: "group.set" }));
    status = "needs_clarification";
  }
  // A pin or density word no form read never leaves a ready plan either (spec 5.2): code reads a form only as a whole
  // part or its end, so "compact view, top 10 by market value" would sort and count and drop the density. The part asks
  // about those words. A form said there is asked about as a form, so the User can ask for it on its own. Words that
  // would read as a form but for a name of the Host's ask what they ask at the whole part or its end.
  // A Host's name made of totals words only ("total", "sum") may ask for a total where the plan shows totals ("group by
  // owner, total, average rate") or its part groups ("group by owner with totals"). Elsewhere it is the name, as before
  // ("sort by total", "group by owner, sort by total").
  const showsTotals = operations.some((op) => op.type === "aggregation.set");
  const groups = (index: number) => unquoted(c.input.clauses.find((x) => x.index === index)?.text ?? "").match(GROUP_WORD) !== null;
  const [leftIndex, leftWords] =
    [...viewWordsLeftOf]
      .map(([index, words]) => [index, words.filter((w) => !w.whole || showsTotals || groups(index))] as const)
      .find(([, words]) => words.length > 0) ?? [];
  const leftWord = leftWords?.[0];
  if (status === "ready" && leftIndex !== undefined && leftWord) {
    clarifications.push(
      leftWord.name !== undefined
        ? { id: `c${leftIndex}.viewWords`, prompt: nameQuestion(leftWord.name, leftWord.text), required: true }
        : leftWord.form && !lists(leftWord.form)
          ? cantQuestion(leftIndex, { type: leftWord.form })
          : {
              id: `c${leftIndex}.viewWords.word`,
              prompt: leftWord.form
                ? `GridCue can't tell how “${leftWord.text}” fits with the rest of that part. Try asking for it on its own.`
                : `I'm not sure what to do with “${leftWord.text}”. Try rephrasing that part.`,
              required: true,
            },
    );
    status = "needs_clarification";
  }
  // A total on a column the view groups by (spec 5.4): in a group row, TanStack Table shows the group's own value in
  // that column, so no total can show there, and the Grid Adapters would draw different numbers. A plan that groups or
  // sets totals asks instead, on a grid that shows totals: "total gain" on a view grouped by Unrealized gain, or "group
  // by gain" on one that shows its total. Validation refuses the same view.
  if (status === "ready" && lists("aggregation.set") && operations.some((op) => op.type === "aggregation.set" || op.type === "group.set")) {
    const after = applyOperations(c.state, operations, { ...c.state, ...c.defaultState });
    const grouped = after.aggregations.find((a) => after.groupBy.includes(a.columnId));
    if (grouped) {
      const label = column(grouped.columnId)?.label ?? grouped.columnId;
      clarifications.push({
        id: "plan.total.grouped",
        prompt: `GridCue can't group by ${label} and show its ${grouped.function === "avg" ? "average" : "total"} too.`,
        required: true,
      });
      status = "needs_clarification";
    }
  }
  // Then the count rule (ADR 0027): a plan that would keep the view's count over different rows asks which the User
  // wants. Each answer adds the count's own line, so the Preview says it. Asked here, after compiling, so it holds for
  // every Intent Provider. Until it is answered, it can only turn a ready plan into a question.
  if (status === "ready") {
    const asks = countQuestion(operations, c.state, c.defaultState);
    const answer = asks && answers[asks.clarification.id];
    if (asks && (answer === "keep" || answer === "all")) {
      operations.push(...asks.answers[answer].slice(operations.length));
      note(asks.clarification.id, answer, 1, "user");
    } else if (asks) {
      clarifications.push(asks.clarification);
      status = "needs_clarification";
    }
  }
  if (status === "needs_clarification" && clarifications.length === 0) {
    const changes = hintChanges(lists, "try");
    // A pin or unpin of columns already where it asks ("unpin everything" with none pinned) is said so (spec 5.3).
    clarifications.push({
      id: "plan.empty",
      prompt: alreadyShown
        ? "The grid already shows this view."
        : `That request doesn't change the view.${changes ? ` Try ${changes}.` : ""}`,
      required: true,
    });
  }
  // One list of totals per plan (spec 5.4). Each totals form sets the whole list, so the view after the plan holds the
  // last list, which already holds the earlier ones: only it is kept, and its one Preview line names every total the
  // plan adds, replaces or removes. This runs last, since the checks above follow each form's own operation.
  // A list that ends where the view's totals started ("no totals and show the total of market value" on a view that
  // shows that total) changes nothing, and has no line: with nothing else to change, the grid already shows this view.
  const lastTotals = operations.findLast((op) => op.type === "aggregation.set");
  if (status === "ready" && lastTotals) {
    for (let at = operations.length - 1; at >= 0; at--) {
      const op = operations[at];
      if (op?.type === "aggregation.set" && op !== lastTotals) operations.splice(at, 1);
    }
    const at = operations.indexOf(lastTotals);
    // After a reset, the totals are the default view's, which a caller may not have given.
    const known = !!c.defaultState?.aggregations || !operations.slice(0, at).some((op) => op.type === "view.reset");
    const before = applyOperations(c.state, operations.slice(0, at), { ...c.state, ...c.defaultState }).aggregations;
    if (known && JSON.stringify(before) === JSON.stringify(lastTotals.aggregations)) operations.splice(at, 1);
    if (operations.length === 0) {
      clarifications.push({ id: "plan.empty", prompt: "The grid already shows this view.", required: true });
      status = "needs_clarification";
    }
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

/**
 * What a provider proposed for a part whose end code read as view words, kept only where the rest of the part names it
 * (spec 4.1). The provider saw the whole part, so it may have taken a column only the read words name: "sort by
 * advisor and pin market value" sorted by both, and "group by advisor and total market value" grouped by both. A pick of a column that only the read words name is dropped, and so is
 * a term the provider couldn't place that is written only there. `clause` is the rest of the part, and `own` its
 * Mentions.
 */
const beforeViewWords = (
  res: ClauseResolution,
  clause: Clause,
  own: readonly Mention[],
  reading: ViewWordsReading,
  record: (e: DecisionEvidence) => void,
): ClauseResolution => {
  const named = new Set(own.map((m) => m.columnId));
  const onlyRead = new Set(
    reading.operations
      .flatMap((op) =>
        op.type === "columns.pin" || op.type === "group.set"
          ? op.columnIds
          : op.type === "aggregation.set"
            ? op.aggregations.map((a) => a.columnId)
            : [],
      )
      .filter((id) => !named.has(id)),
  );
  const keep = (id: string) => !onlyRead.has(id);
  const said = (term: string) => clause.text.includes(term.toLowerCase());
  for (const p of res.columns.filter((x) => !keep(x.id))) {
    record({ key: `dropped:c${clause.index}.viewWords`, selectedId: p.id, confidence: p.confidence, source: "deterministic" });
  }
  return {
    ...res,
    columns: res.columns.filter((p) => keep(p.id)),
    values: res.values.filter((v) => keep(v.columnId)),
    unmatchedTerms: res.unmatchedTerms.filter(said),
    ...(res.roles ? { roles: res.roles.filter((r) => keep(r.columnId)) } : {}),
    ...(res.outer ? { outer: res.outer.filter((o) => keep(o.outerId) && keep(o.innerId)) } : {}),
    ...(res.readings ? { readings: res.readings.filter((r) => keep(r.columnId)) } : {}),
    ...(res.literalColumns ? { literalColumns: res.literalColumns.filter((l) => keep(l.columnId)) } : {}),
  };
};

const EXCLUDE_PROMPT = "GridCue can only leave out rows that match one simple condition. Ask for the rows to keep instead.";
const KEEP_FORM_PROMPT = "GridCue can't tell whether the view already has that filter. Clear the filters, then ask for it again.";

/** A code-read filter, as `readCodeFilters` gives it, and not a span alone. */
const isCodeReadFilter = (r: CodeReadSpan | CodeReadFilter): r is CodeReadFilter => "predicate" in r;

/**
 * A Local Value's filter as a named value's Mention, for the checks beside quoted text. A possessive right after it is
 * its own ("Avery Lane's accounts"). Its value ID stands for no declared value; nothing else reads it.
 */
const asNamedValue = (r: CodeReadFilter, clause: Clause): Mention => ({
  clauseIndex: r.clauseIndex,
  columnId: r.predicate.columnId,
  valueId: "\u0000local",
  start: r.start,
  end: r.end + (/^'s?(?![\p{L}\p{N}])/u.exec(clause.text.slice(r.end))?.[0].length ?? 0),
});

/** A tie, or one word of a value, still to settle: the words, what they may mean, and for one word its counts. */
interface LocalChoice {
  start: number;
  end: number;
  /** A tie's values carry their own words; one word's choices are read at the word. */
  values: ReadonlyArray<LocalValueRef & { start?: number; end?: number }>;
  names: readonly DeclaredName[];
  word?: { word: string; count: number; columns: ReadonlyArray<{ columnId: string; count: number }> };
}

/** "Advisor and Household": labels listed with "and". */
const listed = (labels: readonly string[]) =>
  labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;

/**
 * The question for a tie or one word of a value (spec 5.4, section 9). Each value is a choice, by itself when every
 * choice is in one column and with its column's label when they are in several, and the last choice is "None of
 * these". One value asks "Did you mean Advisor: Avery Lane?", with "Yes" and "No". More than five values ask for the
 * full name, with no choices. A tie offers the declared names too: picking one reads the words as GridCue would
 * without Local Values. Option IDs say only which choice it was: `v` and the value's place, `n` and the name's.
 */
const localQuestion = (id: string, clause: Clause, choice: LocalChoice, schema: ViewSchema): Clarification => {
  const label = (columnId: string) => schema.columns.find((col) => col.id === columnId)?.label ?? columnId;
  const words = clause.text.slice(choice.start, choice.end);
  const columns = [...new Set(choice.values.map((v) => v.columnId))];
  const none = { id: "none", label: "None of these" };
  if (choice.word && choice.values.length === 0) {
    const where = listed(choice.word.columns.map((col) => label(col.columnId)));
    return { id, prompt: `${choice.word.count} ${where} values contain “${words}”. Type the full name.`, required: true };
  }
  const [only] = choice.values;
  if (choice.word && only && choice.values.length === 1) {
    return {
      id,
      prompt: `Did you mean ${label(only.columnId)}: ${only.value}?`,
      options: [
        { id: "v0", label: `Yes, ${only.value}` },
        { id: "none", label: "No" },
      ],
      required: true,
    };
  }
  const valueLabel = (v: LocalValueRef) =>
    columns.length === 1 && choice.names.length === 0 ? v.value : `${label(v.columnId)}: ${v.value}`;
  // Every declared name reads the words as GridCue would with no Local Values, so a column's names are one choice: its
  // name and its entity word are "The Household column", and its values one list, "Registration type: Trust and IRA".
  const names = new Map<string, { column: boolean; values: string[]; label: string }>();
  for (const n of choice.names) {
    const key = n.columnId ?? `\u0000${n.kind} ${n.label}`;
    const held = names.get(key) ?? { column: false, values: [], label: n.kind === "codeRead" ? `“${n.label}”` : n.label };
    if (n.columnId && (n.kind === "value" || n.kind === "valueGroup")) {
      if (!held.values.includes(n.label)) held.values.push(n.label);
    } else if (n.columnId) held.column = true;
    names.set(key, held);
  }
  const nameLabels = [...names].map(([key, n]) =>
    n.values.length > 0 ? `${label(key)}: ${listed(n.values)}` : n.column ? `The ${label(key)} column` : n.label,
  );
  // Six buttons at most, "None of these" among them (section 9). With more, the User rephrases.
  if (choice.values.length + nameLabels.length > MAX_LOCAL_VALUE_CHOICES || choice.values.length + nameLabels.length === 0) {
    return {
      id,
      prompt: `“${words}” could mean more than ${MAX_LOCAL_VALUE_CHOICES} things here. Try rephrasing that part.`,
      required: true,
    };
  }
  const prompt =
    choice.word && columns.length === 1 && columns[0] !== undefined
      ? `Which ${label(columns[0])} did you mean by “${words}”?`
      : `Which did you mean by “${words}”?`;
  return {
    id,
    prompt,
    options: [
      ...choice.values.map((v, i) => ({ id: `v${i}`, label: valueLabel(v) })),
      ...nameLabels.map((l, i) => ({ id: `n${i}`, label: l })),
      none,
    ],
    required: true,
  };
};

/**
 * What joins two Local Values written as one list: commas, "&", "/", "+", "and" and "or", with "the" before the next
 * value, after a possessive mark on the first ("Avery Lane's or Blake Moreno's"). At least one of them is needed.
 */
const LISTED_BETWEEN = /^(?:'s?)?(?:\s*(?:[,&/+]|\b(?:and|or)\b))+\s*(?:the\s+)?$/u;
/**
 * Words that add one thing to another, wherever they sit between two Local Values: "and", "plus", "also", "as well
 * as", "along with", "together with", a comma, "&", "/" or "+". "Avery Lane's accounts and the Alder household's" may
 * mean the rows of each, where "in", "with" or "for" says which rows have both.
 */
const ADDS_BETWEEN = /[,&/+—–]|\s-\s|\b(?:and|plus|also|as\s+well\s+as|along\s+with|together\s+with)\b/u;
/**
 * Whether the part names the column of a Local Value right before it: "advisor is Avery Lane", "filter advisor to
 * Avery Lane". The value's filter then covers the column's name too (`localValueFilters`), so the name starts where the
 * filter's words do and ends before they end. Such a value is a condition on that column, and two of them are two
 * conditions, which every row kept must meet: "advisor is Avery Lane and household is Alder Household".
 */
const columnNamed = (clause: Clause, r: CodeReadFilter, mentions: readonly Mention[]): boolean =>
  mentions.some(
    (m) =>
      m.clauseIndex === clause.index &&
      m.valueId === undefined &&
      m.columnId === r.predicate.columnId &&
      m.start === r.start &&
      m.end < r.end,
  );

/** The question for Local Values of two columns that may mean rows with both, or rows with either (spec 5.4). */
const bothOrEither = (clauseIndex: number, first: string, other: string, either: boolean): Clarification => ({
  id: `c${clauseIndex}.local.listed`,
  prompt: either
    ? EITHER_PROMPT
    : `GridCue can't tell whether you want rows with both “${first}” and “${other}”, or with either. Ask for one at a time, or for the rows that have both.`,
  required: true,
});

/**
 * The question for Local Values a part names that don't make one filter for each column (spec 5.4), if any. Several
 * values of one column make one filter only when they are written as one list ("Avery Lane or Blake Moreno"):
 * - values of one column apart from each other give the same rows two values: "Avery Lane's accounts for Blake
 *   Moreno", "accounts for Avery Lane with advisor Blake Moreno";
 * - values of two columns in one list may mean rows with both, or rows with either: "Avery Lane and the Alder
 *   household". Words that say which rows have each are read: "Avery Lane's accounts in the Alder household".
 * `found` are the part's Local Values, from `localValueFilters`, in the order written.
 */
const unlistedValues = (
  clause: Clause,
  found: readonly CodeReadFilter[],
  schema: ViewSchema,
  mentions: readonly Mention[],
): Clarification | undefined => {
  if (found.length < 2) return undefined;
  const label = (columnId: string) => schema.columns.find((col) => col.id === columnId)?.label ?? columnId;
  // Each value's list: values written one after another, with only a list's joining words between them.
  const lists: CodeReadFilter[][] = [];
  found.forEach((r, i) => {
    const before = found[i - 1];
    const list = lists.at(-1);
    const between = clause.text.slice(before?.end ?? 0, r.start);
    // Two values that each follow their column's name are two conditions, unless "or" alone joins them: "advisor is
    // Avery Lane and advisor is Blake Moreno" gives the same rows two values.
    const conditions =
      !!before && columnNamed(clause, before, mentions) && columnNamed(clause, r, mentions) && !/^\W*or\W*$/u.test(between);
    if (before && list && !conditions && LISTED_BETWEEN.test(between)) list.push(r);
    else lists.push([r]);
  });
  const listsOf = new Map<string, Set<number>>();
  const valuesOf = new Map<string, string[]>();
  lists.forEach((list, i) => {
    for (const r of list) {
      const id = r.predicate.columnId;
      listsOf.set(id, (listsOf.get(id) ?? new Set()).add(i));
      const values = valuesOf.get(id) ?? [];
      if (r.localValue !== undefined && !values.includes(r.localValue)) values.push(r.localValue);
      valuesOf.set(id, values);
    }
  });
  for (const [columnId, values] of valuesOf) {
    if (values.length < 2 || (listsOf.get(columnId)?.size ?? 0) < 2) continue;
    return {
      id: `c${clause.index}.local.apart`,
      prompt: `No row has two ${label(columnId)} values. Ask for them as one list, such as “${values[0]} or ${values[1]}”.`,
      required: true,
    };
  }
  const both = (first: CodeReadFilter, other: CodeReadFilter, either: boolean) =>
    bothOrEither(clause.index, first.localValue ?? "", other.localValue ?? "", either);
  for (const list of lists) {
    const first = list[0];
    const other = list.find((r) => r.predicate.columnId !== first?.predicate.columnId);
    if (!first || !other) continue;
    // Each after its column's name, they are two conditions: "advisor is Avery Lane and household is Alder Household".
    if (columnNamed(clause, first, mentions) && columnNamed(clause, other, mentions)) continue;
    const joins = clause.text.slice(first.end, list.at(-1)?.start ?? first.end);
    return both(first, other, /\bor\b/.test(joins) && !/\band\b/.test(joins));
  }
  // Values of two columns with words that add one to the other between them, wherever they sit, ask the same: "Avery
  // Lane's accounts and the Alder household's accounts". So do values that each come with the rows' own noun, whatever
  // sits between them: "Avery Lane's accounts the Alder household's accounts" names two sets of rows. Two values that
  // each follow their column's name are two conditions, and are read: "advisor is Avery Lane and household is Alder
  // Household".
  const text = unquoted(clause.text);
  const entityColumns = new Set(schema.columns.map((col) => col.id));
  const rows = rowNouns(text, schema, entityColumns).filter((n) => !found.some((r) => r.start < n.end && n.start < r.end));
  for (let i = 1; i < found.length; i++) {
    const first = found[i - 1];
    const other = found[i];
    if (!first || !other || first.predicate.columnId === other.predicate.columnId) continue;
    if (columnNamed(clause, first, mentions) && columnNamed(clause, other, mentions)) continue;
    if (ADDS_BETWEEN.test(text.slice(first.end, other.start))) return both(first, other, false);
    const between = rows.some((n) => n.start >= first.end && n.end <= other.start);
    const outside = rows.some((n) => n.end <= first.start || n.start >= other.end);
    if (between && outside) return both(first, other, false);
  }
  return undefined;
};

/**
 * The Local Values a request names (named filters spec, 5.4; ADR 0025), as code-read filters, and the question each
 * part still asks about them. A whole value is a filter. A tie, or one word of a value, asks which was meant, one at a
 * time in the order written. An answer that picks a value reads it as if typed whole at those words; one that picks a
 * declared name reads the words as GridCue would without Local Values; "None of these" or "No" says nothing will
 * change, and the part stays unread. Answers are read here, in the browser: nothing is sent again.
 *
 * Filters in different parts combine with "and", and no row has two values in one column: "entries for Gale Ivers;
 * entries for Frankie Dunmore" would show no rows. A part that names a value of a column an earlier part already named
 * one of asks (`again`), and says how to name both in one part. A part that names a value of another column than an
 * earlier part's value asks too, as two values with "and" between them do in one part: "Avery Lane's accounts. Also
 * the Alder household." may mean the rows of each.
 */
const localReading = (
  c: CompileInput,
  answers: Record<string, string>,
): {
  filters: CodeReadFilter[];
  asks: Map<number, { question: Clarification; spans: CodeReadSpan[] }>;
  again: Map<number, Clarification>;
  apart: Map<number, Clarification>;
  valueWords: Map<number, ReadonlySet<string>>;
} => {
  const filters: CodeReadFilter[] = [];
  const asks = new Map<number, { question: Clarification; spans: CodeReadSpan[] }>();
  const again = new Map<number, Clarification>();
  const apart = new Map<number, Clarification>();
  const valueWords = new Map<number, ReadonlySet<string>>();
  // The values named for each column in earlier parts, in the order named, and the columns whose every value so far
  // followed its column's name ("advisor is Avery Lane").
  const named = new Map<string, string[]>();
  const tied = new Map<string, boolean>();
  for (const part of c.localValues ?? []) {
    const clause = c.input.clauses.find((x) => x.index === part.clauseIndex);
    if (!clause) continue;
    valueWords.set(clause.index, new Set(part.valueWords));
    const hits: NamedValue[] = part.values.map(({ start, end, columnId, value }) => ({ start, end, columnId, value }));
    const choices: LocalChoice[] = [
      ...part.ties.map((t) => ({ start: t.start, end: t.end, values: t.values, names: t.names })),
      ...part.words.map((w) => ({
        start: w.start,
        end: w.end,
        values: w.choices,
        names: [],
        word: { word: w.word, count: w.count, columns: w.columns },
      })),
    ].sort((a, b) => a.start - b.start);
    const open: CodeReadSpan[] = [];
    let question: Clarification | undefined;
    for (const choice of choices) {
      const id = `c${clause.index}.local.${choice.start}`;
      const answer = answers[id];
      const picked = answer === undefined ? undefined : /^([vn])(\d+)$/.exec(answer);
      const value = picked?.[1] === "v" ? choice.values[Number(picked[2])] : undefined;
      if (value) {
        // A value picked from a tie sits at its own words, so the tie's other words are still placed or asked about.
        hits.push({
          start: value.start ?? choice.start,
          end: value.end ?? choice.end,
          columnId: value.columnId,
          value: value.value,
        });
        continue;
      }
      // A declared name: the words are read as they are with no Local Values.
      if (picked?.[1] === "n" && choice.names[Number(picked[2])]) continue;
      open.push({ clauseIndex: clause.index, start: choice.start, end: choice.end });
      question ??=
        answer === undefined
          ? localQuestion(id, clause, choice, c.schema)
          : {
              id: `${id}.none`,
              prompt: `Nothing will change for “${clause.text.slice(choice.start, choice.end)}”. Type the full name, or rephrase that part.`,
              required: true,
            };
    }
    if (question) asks.set(clause.index, { question, spans: open });
    const others = (c.codeRead ?? []).filter((r) => r.clauseIndex === clause.index);
    // A value chosen in an answer sits where its words do: "Lane and Blake Moreno" lists Avery Lane first.
    hits.sort((a, b) => a.start - b.start);
    const found = localValueFilters(clause, hits, c.mentions ?? [], others);
    const unlisted = unlistedValues(clause, found, c.schema, c.mentions ?? []);
    if (unlisted) apart.set(clause.index, unlisted);
    const twice = found.find((r) => {
      const before = named.get(r.predicate.columnId);
      return !!before && !before.includes(r.localValue ?? "");
    });
    if (twice) {
      const label = c.schema.columns.find((col) => col.id === twice.predicate.columnId)?.label ?? twice.predicate.columnId;
      again.set(clause.index, {
        id: `c${clause.index}.local.again`,
        prompt: `No row has two ${label} values. Ask for them in one part, such as “${named.get(twice.predicate.columnId)?.[0]} or ${twice.localValue}”.`,
        required: true,
      });
    } else if (!/^or\b/.test(clause.text)) {
      // Each part is a request of its own, so a value of another column than an earlier part's value is listed apart
      // from it, as values with "and" between them are in one part: rows with both, or with either? It asks the same.
      // A part that starts with "or" asks either-or already. Values that each follow their column's name are
      // conditions, and are read: "advisor is Avery Lane; household is Alder Household".
      for (const r of found) {
        const earlier = [...named].find(
          ([columnId]) => columnId !== r.predicate.columnId && !(tied.get(columnId) && columnNamed(clause, r, c.mentions ?? [])),
        )?.[1][0];
        if (earlier === undefined) continue;
        again.set(clause.index, bothOrEither(clause.index, earlier, r.localValue ?? "", false));
        break;
      }
    }
    for (const r of found) {
      const id = r.predicate.columnId;
      named.set(id, [...(named.get(id) ?? []), r.localValue ?? ""]);
      tied.set(id, (tied.get(id) ?? true) && columnNamed(clause, r, c.mentions ?? []));
    }
    filters.push(...found);
  }
  return { filters, asks, again, apart, valueWords };
};
/** A part's House Terms, each as its filters at one place: a term's conditions share its words. */
const termsIn = (codeRead: readonly (CodeReadSpan | CodeReadFilter)[]): CodeReadFilter[][] => {
  const terms = new Map<string, CodeReadFilter[]>();
  for (const r of codeRead) {
    if (!isCodeReadFilter(r) || r.kind !== "term") continue;
    const at = `${r.start}:${r.end}`;
    terms.set(at, [...(terms.get(at) ?? []), r]);
  }
  return [...terms.values()];
};
/** The column kinds an empty form is read on (spec 5.2). A number, currency or percent column could be empty or zero. */
const EMPTY_KINDS: ReadonlySet<ColumnKind> = new Set(["string", "enum", "date", "datetime"]);
/** What each operator a text or empty form writes does, for the question when the Host doesn't allow it. */
const FORM_WORDS: Partial<Record<CodeReadFilter["predicate"]["operator"], string>> = {
  startsWith: "by how it starts",
  eq: "to exact text",
  in: "to any of several values",
  isEmpty: "to rows where it is empty",
  isNotEmpty: "to rows where it is not empty",
};

/**
 * The question for a code-read filter its column can't take, if any (spec 5.2). Text forms are read on text columns,
 * and empty forms on text, category, date and date-and-time columns. The Host's `allowedOperators` can turn any of
 * them off. An empty form followed by an amount or a comparison that names no column of its own ("accounts with no
 * advisor over $1m", "Advisor is empty and over 5%") asks too: the amount may belong to the empty column, which has
 * none. That question says "the date" when a date follows ("no vendor after 2026-01-01"), and "the amount" otherwise.
 * An empty form after a yes/no column ("cleared is empty") asks: today's reading drops "empty" and shows Yes.
 */
const codeReadQuestion = (
  r: CodeReadFilter,
  clause: Clause,
  column: (id: string) => ColumnDescriptor | undefined,
  mentions: readonly Mention[],
  next: Clause | undefined,
): string | undefined => {
  // A date with no column named right before it takes one later: the provider's pick, or the User's answer.
  if (r.kind === "date" && !r.predicate.columnId) return undefined;
  const col = column(r.predicate.columnId);
  const label = col?.label ?? r.predicate.columnId;
  const words = clause.text.slice(r.start, r.end);
  // A date goes only to a date column: "amount in the last 90 days" names a column that holds none (spec 5.5).
  if (r.kind === "date" && col && !DATE_COLUMN_KINDS.has(col.kind)) {
    return `${label} can't be compared with “${dateWordsOf(r, clause)}”. Name a column that holds dates.`;
  }
  if (!col?.capabilities.includes("filter")) return `GridCue can't filter ${label} here. Try a different filter.`;
  if ((r.kind === "text" || r.kind === "value") && col.kind !== "string") {
    return `GridCue can match text only in a text column, and ${label} isn't one.`;
  }
  if (r.kind === "empty" && col.kind === "boolean") {
    return `GridCue reads ${label} as Yes or No, so it can't tell what “${words}” means. Ask for Yes or No instead.`;
  }
  if (r.kind === "empty" && !EMPTY_KINDS.has(col.kind)) {
    return `GridCue can't tell whether “${words}” means ${label} is empty or zero. Ask for an amount instead.`;
  }
  const follows = r.kind === "empty" ? amountWithoutName(clause, r.end, mentions, next) : undefined;
  if (follows) return `I'm not sure what the ${follows} after “${words}” applies to. Name its column.`;
  if (!operatorsFor(col).includes(r.predicate.operator)) {
    // A House Term's conditions were checked when the schema was built; one built by hand may still hold another.
    if (r.kind === "term") return `GridCue can't filter ${label} the way “${words}” needs here.`;
    if (r.kind === "date") return `GridCue can't filter ${label} by “${dateWordsOf(r, clause)}” here. Try a different filter.`;
    return `GridCue can't filter ${label} ${FORM_WORDS[r.predicate.operator] ?? "that way"} here.`;
  }
  return undefined;
};
/** The comparison that keeps the rows another one leaves out. "Equal to", "between" and "containing" have none here. */
const COMPLEMENT: Partial<Record<FilterPredicate["operator"], FilterPredicate["operator"]>> = {
  gt: "lte",
  gte: "lt",
  lt: "gte",
  lte: "gt",
};
/** Blanks the part's own names, keeping offsets. With `mark`, a single character, each name starts with it. */
const namesBlankedOf = (text: string, own: ReadonlyArray<{ start: number; end: number }>, mark = " ") =>
  own.reduce((t, m) => (m.end > m.start ? t.slice(0, m.start) + mark + " ".repeat(m.end - m.start - 1) + t.slice(m.end) : t), text);

/** Whether a name appears in the part only inside quoted text: `advisor containing "restricted"`. */
const onlyQuoted = (text: string, names: readonly string[]) => {
  const bare = unquoted(text);
  // Every occurrence: "unrestricted restricted" holds "restricted" whole after a hit inside a longer word.
  const has = (t: string, n: string) => {
    for (let at = t.indexOf(n); at >= 0; at = t.indexOf(n, at + 1))
      if (!/[\p{L}\p{N}]/u.test(t[at - 1] ?? "") && !/[\p{L}\p{N}]/u.test(t[at + n.length] ?? "")) return true;
    return false;
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
  schema: ViewSchema,
): { operations: ViewOperation[] } | { prompt: string } => {
  const { rowNoun } = schema;
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
  // "Leave" before the column says to keep, as "keep" does: `clear filters but leave advisor "Lane"`. Blanked, so
  // offsets hold.
  const checked = { ...clause, text: clause.text.replace(/^(?:leave|leaving) /, (s) => " ".repeat(s.length)) };
  for (const lit of clause.literals) {
    if (lit.kind === "unreadable") return absent;
    const operator = lit.kind === "text" ? "contains" : (lit.comparator ?? "eq");
    const value = lit.comparator === "between" ? { min: lit.value, max: lit.upper ?? lit.value } : lit.value;
    const quotedAfter = lit.kind === "text" ? columnBeforeText(checked, lit, own, column, rowNoun) : undefined;
    if (quotedAfter && !quotedAfter.read) return absent;
    // The words beside the text are checked as they are for a new filter: `advisor "Lane" exactly` keeps nothing.
    const unread = lit.kind === "text" ? textWordsQuestion(checked, lit, quotedAfter, own, schema) : undefined;
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
const followedByRead = (
  clause: Clause,
  at: number,
  own: readonly Mention[],
  names: readonly string[],
  codeRead: readonly CodeReadSpan[] = [],
): boolean => {
  const text = unquoted(clause.text);
  const joined = sticky(JOINERS, text, at)?.[0] ?? "";
  const p = at + joined.length;
  // A part that stops on a joining word ("$1m or", "over $1m but", "under $5k and the") was cut off: ask.
  if (p >= text.length) return !DANGLING.test(joined);
  if (clause.text[p] === '"') return true;
  // A name, a literal, or a code-read filter's words: "over $1m with no advisor".
  if (own.some((m) => m.start === p) || clause.literals.some((l) => l.at === p) || codeRead.some((r) => r.start === p)) return true;
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
const comparisonUnread = (
  clause: Clause,
  lit: Literal,
  own: readonly Mention[],
  names: readonly string[],
  codeRead: readonly CodeReadSpan[] = [],
): boolean => {
  if (lit.kind === "text" || lit.kind === "unreadable") return false;
  let end = lit.at + literalText(clause.text, lit).length;
  const trailing = trailingComparison(clause.text.slice(end, end + 40), lit.kind === "date");
  if (trailing) {
    if (trailing.comparator !== lit.comparator) return true;
    end += trailing.length;
  }
  if (!followedByRead(clause, end, own, names, codeRead)) return true;
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
const CONTAINING_GAP = new RegExp(String.raw`^(?:'s)?\s*(?::\s*|(?:is|are|has|${CONTAINING_WORDS.join("|")})\s+)?$`);
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
  if (!value && leavesOwnValue)
    return new RegExp(String.raw`^[\s,]*${nounWords}${JOIN}(?:${PREPOSITION})?(?:${QUANTIFIERS.join("|")})\s+$`);
  const sort = String.raw`(?:${[...SORT_VERBS, ...GROUP_VERBS].join("|")})\s+(?:by\s+)?${value ? "" : String.raw`|by\s+|in\s+order\s+of\s+`}`;
  const leaves =
    value && next.negated ? String.raw`(?:(?:but\s+(?!but\b))?${LEAVES_OUT})?` : String.raw`(?:(?:but\s+)?(?:not|no|non|without)[\s-]+)?`;
  return new RegExp(
    String.raw`^${POSSESSIVE}[\s,]*${nounWords}${JOIN}(?:${ROWS_JOIN}|${sort}|(?:hide|show|unhide)\s+)?${value ? `(?:${PREPOSITION})?${PREPOSITION_DETERMINER}` : ""}${leaves}$`,
  );
};
/** Thanks at the start of a request before a comma. */
const COURTESY_LEAD = new RegExp(String.raw`^\s*${COURTESY}\s*,\s*`);
/** What may end a part after quoted text: any of "please", "too", "also", "only" and "as well", then "thanks". */
const afterTextEnd = (nounWords: string) =>
  new RegExp(String.raw`^${POSSESSIVE}[\s,]*${nounWords}(?:(?:please|only|${ALSO_WORDS.join("|")})\b[\s,]*)*(?:${COURTESY})?[\s.!?]*$`);
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
  let scan = withoutNames(clause.text, own);
  if (noun) scan = scan.replace(noun, (s) => " ".repeat(s.length));
  const spans = directionWords(clause, scan);
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
  const chooseLead = String.raw`(?:(?:${[...CHOOSING_VERBS, "filter to", "look at"].join("|")})\s+)?(?:(?:${ONLY_WORDS.join("|")})\s+)?(?:all(?: of)?\s+)?(?:(?:the|my)\s+)?${nounWords}(?:(?:and|or|then|for)\s+|${ROWS_JOIN})?`;
  // Right before text no column owns, a containing word (`CONTAINING_GAP`) may sit too. "To" there may mean "equal to",
  // as it may between a column and its text.
  const containing = owner ? "" : String.raw`(?:(?::|is|are|has|${CONTAINING_WORDS.join("|")})\s*)?`;
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
 * text and its column, or before text no column owns; "what to do with" for any other. A text form said as a statement
 * (`every advisor starts with "Av"`) asks about the words that make it one: "starts with" is read, so offering
 * "containing" instead would mislead.
 */
const textWordsQuestion = (
  clause: Clause,
  lit: Literal,
  quotedAfter: { mention: Mention; read: boolean } | undefined,
  own: readonly Mention[],
  schema: ViewSchema,
): { id: "match" | "beside"; prompt: string } | undefined => {
  const match = { id: "match", prompt: `I'm not sure how to match “${lit.value}”. Try “containing”.` } as const;
  const said = quotedAfter ? textFormStatement(clause, lit, quotedAfter.mention, own, schema) : undefined;
  if (said) return { id: "beside", prompt: `I'm not sure what to do with “${said}”. Try rephrasing that part.` };
  if (quotedAfter && !quotedAfter.read) return match;
  const beside = unreadBesideText(clause, lit, quotedAfter?.mention, own, schema.rowNoun);
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
