import { LITERAL_COLUMN_KINDS, type Mention } from "./mentions";
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
import { REVERSAL_WORDING, unknownTerm } from "./terms";

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
/** A part that replaces the sort or grouping named before it, instead of adding a level. */
const REPLACES = /\b(?:instead|rather)\b/;
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
const ADJACENT_COMPARISON =
  /^\s*(?:(?:is|are|of)\s+)?(?:over|under|above|below|more than|less than|greater than|fewer than|at least|at most|up to|between|exceed(?:s|ing)?|>|<|=)?\s*$/;
/** A value named inside one of these phrases limits the rows, wherever it sits: "sort by gain for trusts". */
const PREPOSITION_BEFORE = /\b(?:for|among|at|in|with|from|of|within)\s+(?:(?:the|all|only|just)\s+)?(?:[\p{L}-]+\s+)?$/u;

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
      // Mentions are deterministic: a named value is used at confidence 1. A named column is too, unless the provider
      // scored that column below MENTION_FLOOR: "biggest accounts first" names the rows, not Account number (ADR 0013).
      const own = (c.mentions ?? []).filter((m) => m.clauseIndex === clause.index);
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
      for (const id of new Set(own.filter((m) => m.valueId === undefined && !readAsRows.has(m.columnId)).map((m) => m.columnId))) {
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
      const modifierStarts = [
        ...mentionedValues.map((m) => m.start),
        ...namedBooleanValues.flatMap((v) => own.filter((m) => m.columnId === v.columnId && m.valueId === undefined).map((m) => m.start)),
      ];
      const otherChanges = accepted.filter((f) => isView(f.id) && f.id !== "filter" && COLUMN_FAMILIES[f.id as ViewFamily]);
      const verbAt = (f: string) => clause.text.search(CHANGE_VERB[f] ?? /$^/);
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
      const afterVerb = mentionedValues.filter((m) => !accepted.some((f) => f.id === "filter"));
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
      // reading left: "show trusts".
      if (namedFilter && ![...accepted, ...middling].some((f) => isView(f.id) && viable(f.id))) {
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
            const chosen = answers[`${key}.value.${id}`];
            if (chosen !== undefined && ids.includes(chosen)) {
              // The User picked one value from the one-value-at-a-time question below (review fix).
              pred(id, "eq", chosen);
              note(`${key}.value.${id}`, chosen, 1, "user");
            } else if (ids.length === 1) pred(id, "eq", ids[0]);
            else if (ops.includes("in")) pred(id, "in", ids);
            // An exclusion the Host's operators can't express as "in" may still be one "not equal" (review fix).
            else if (out.length === 1 && ops.includes("neq")) pred(id, "neq", out[0]);
            else {
              clarifications.push({
                id: `${key}.value.${id}`,
                prompt: `GridCue can filter ${column(id)?.label ?? id} to one value at a time here. Which one?`,
                options: ids.map((v) => ({ id: v, label: column(id)?.enumValues?.find((e) => e.id === v)?.label ?? v })),
                required: true,
              });
            }
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
            const fits = LITERAL_COLUMN_KINDS[lit.kind];
            const answered = answers[answerKey] ? column(answers[answerKey]) : undefined;
            // The provider's pick for this literal: used when confident, offered first when middling.
            const pick = res.literalColumns?.find((l) => l.literalIndex === j);
            const pickCol = pick && column(pick.columnId);
            const pickFits = pickCol && fits.includes(pickCol.kind) && pickCol.capabilities.includes("filter") && !used.has(pickCol.id);
            const provided = pickFits && pick.confidence >= bands.ready ? pickCol : undefined;
            // A column named right before the amount ("market value over $1m") owns it, over the provider's pick.
            const adjacent = own.find(
              (m) =>
                m.valueId === undefined &&
                m.end <= lit.at &&
                ADJACENT_COMPARISON.test(clause.text.slice(m.end, lit.at)) &&
                mentionedColumns.includes(m.columnId),
            );
            const namedCol = adjacent && column(adjacent.columnId);
            const named = namedCol && fits.includes(namedCol.kind) && !used.has(namedCol.id) ? namedCol : undefined;
            const target = answered ?? named ?? provided ?? picked.find((col) => fits.includes(col.kind) && !used.has(col.id));
            const operator = lit.kind === "text" ? "contains" : (lit.comparator ?? "eq");
            if (!target || !operatorsFor(target).includes(operator)) {
              const options = optionsFor(fits, "filter");
              const first = pickFits && pick.confidence >= bands.clarify ? pickCol.id : undefined;
              clarifications.push({
                id: answerKey,
                prompt: `Which column should be ${describeLiteral(lit)}?`,
                options: first ? [...options.filter((o) => o.id === first), ...options.filter((o) => o.id !== first)] : options,
                required: true,
              });
              return;
            }
            used.add(target.id);
            if (answered) note(answerKey, target.id, 1, "user");
            else if (target === provided && pick) note(answerKey, target.id, pick.confidence, "provider");
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
          // This family takes the columns bound to it plus the free ones: never a column bound to another change,
          // and never a filter argument unless its role says so.
          const bound = new Set(boundTo(family) ?? []);
          const free = new Set(freeFor(family));
          const pool = picked.filter((col) => bound.has(col.id) || (changes.length < 2 && free.has(col.id)));
          const cols = (answered ? [answered] : pool).filter((col) =>
            COLUMN_FAMILIES[family]?.every((cap) => col.capabilities.includes(cap)),
          );
          if (answered) note(answerKey, answered.id, 1, "user");
          if (cols.length === 0) {
            // A provider's own term wins. Core names one only when no "Did you mean …?" is pending here and the
            // Clause named nothing it recognised: it never calls a Host-declared name unknown.
            const pending = clarifications.some((q) => q.id.startsWith(`${key}.column.`));
            const unknown = res.unmatchedTerms[0] ?? (pending || own.length > 0 ? undefined : unknownTerm(clause.text));
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
          if (REVERSAL_WORDING.test(clause.text) && ids.length === 2) {
            const [first = "", second = ""] = ids;
            if (outerScore(second, first) >= FAN_OUT.outer && outerScore(second, first) > outerScore(first, second)) {
              ids.reverse();
              evidence.push({ key: `${key}.outer`, selectedId: second, confidence: outerScore(second, first), source: "provider" });
            }
          }
          // "Also group by advisor": add a level to the current view's sort or grouping instead of replacing it (Q7).
          const adds = (res.adds ?? 0) >= FAN_OUT.adds && !REPLACES.test(clause.text);
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
