import type { CodeReadFilter } from "./code-read";
import { leavesRowsOut } from "./lead";
import type { Mention } from "./mentions";
import { type Literal, literalText, type NormalizedInput, unquoted } from "./normalize";
import type { CodeReadSpan } from "./placed";
import type { DecisionEvidence, FilterPredicate, ViewOperation } from "./protocol";

/** Something code read from a part of the request that no operation in the plan uses, in the User's words. */
export interface UnusedReading {
  clauseIndex: number;
  text: string;
}

const CLEARING: ReadonlySet<string> = new Set(["filter.clear", "sort.clear", "group.clear", "view.reset"]);
const CLEAR_WORDS = /\b(?:clear|remove|reset|undo|drop|ungroup)\b/;
const COUNT_WORDS = /\b(?:top|largest|biggest|smallest)\s+[\d,]+/;
/** "accounts" and "account" name the same noun. */
/** "'s accounts", "' accounts" right after a name. */
/**
 * "'s accounts", "' accounts", or "' roth accounts" right after a name: a possessive, then any named values, then the
 * row noun. `text` is the part, `at` where the name ends, and `values` the part's named values.
 */
const possessiveOfRows = (text: string, at: number, rowNoun: string, values: readonly Mention[]) => {
  const mark = /^(?:'s|’s|'|’)/.exec(text.slice(at));
  if (!mark) return false;
  let p = at + mark[0].length;
  for (;;) {
    const next = values.find((v) => v.start === p + 1 && text[p] === " ");
    if (!next) break;
    p = next.end;
  }
  const word = /^ ([\p{L}]+)/u.exec(text.slice(p));
  return !!word && singular(word[1] ?? "") === singular(rowNoun);
};
const singular = (words: string) => (words.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ").replace(/(?:es|s)$/, "");

const namesOf = (op: ViewOperation): string[] => {
  switch (op.type) {
    case "filter.add":
      return [op.predicate.columnId];
    case "sort.set":
      return op.sorts.map((s) => s.columnId);
    case "group.set":
    case "columns.show":
    case "columns.hide":
    case "columns.order":
    case "columns.pin":
      return op.columnIds;
    case "aggregation.set":
      return op.aggregations.map((a) => a.columnId);
    default:
      return [];
  }
};

/** The comparison that keeps the rows a part leaves out: "exclude accounts over $1m" keeps "at most $1m". */
const COMPLEMENT: Partial<Record<string, string>> = { gt: "lte", gte: "lt", lt: "gte", lte: "gt" };

/** A filter holds a literal when it compares by the literal's own comparison, or its complement, with its value. */
const holdsLiteral = (p: FilterPredicate, lit: Literal): boolean => {
  const operator = lit.kind === "text" ? "contains" : (lit.comparator ?? "eq");
  if (p.operator !== operator && p.operator !== COMPLEMENT[operator]) return false;
  if (lit.comparator === "between") {
    const v = p.value as { min?: unknown; max?: unknown } | undefined;
    return typeof v === "object" && v !== null && v.min === lit.value && v.max === (lit.upper ?? lit.value);
  }
  return p.value === lit.value;
};

/** Whether a filter on the value's column chooses it, or, for an excluded value ("non-retirement"), leaves it out. */
/** The same Mention read the other way: chosen if it was excluded, excluded if it was chosen. */
const flipped = ({ negated, ...m }: Mention): Mention => (negated ? m : { ...m, negated: true });

const usesValue = (p: FilterPredicate, m: Mention): boolean => {
  if (p.columnId !== m.columnId || m.valueId === undefined) return false;
  const v = p.value;
  const holds = (x: unknown) => x === m.valueId || (typeof x === "boolean" && String(x) === m.valueId);
  if (m.negated) {
    if (p.operator === "neq") return holds(v);
    if (p.operator === "in") return Array.isArray(v) && !v.some(holds);
    if (p.operator === "eq") return !holds(v);
    return false;
  }
  if (p.operator === "eq") return holds(v);
  if (p.operator === "in") return Array.isArray(v) && v.some(holds);
  return false;
};

/**
 * ADR 0019: what code read from the request (amounts, quoted text, dates, counts, and names) that the plan's
 * operations leave unused. A plan with anything left over is not ready. Not counted: a name still marked ambiguous,
 * a name the plan dropped with `dropped:` evidence, the grid's own row noun, the other values named for a column after
 * the User picked one of them, and a column named in a part that clears or resets (what the clear targets). A name
 * read as the rows is never a Mention, so it is not counted either.
 *
 * A code-read filter (named filters spec, 4.4) is read as a whole: it is used when the plan holds its filter, and the
 * names and quoted text inside its words are its own. Its filter uses nothing outside them: a name of its column outside
 * them is used only when another operation names that column. A span with no filter places its words and is never
 * counted.
 */
export const unusedReadings = (
  input: NormalizedInput,
  mentions: readonly Mention[],
  operations: readonly ViewOperation[],
  evidence: readonly DecisionEvidence[] = [],
  rowNoun?: string,
  codeRead: readonly (CodeReadSpan | CodeReadFilter)[] = [],
): UnusedReading[] => {
  const predicates = operations.flatMap((op) => (op.type === "filter.add" ? [op.predicate] : []));
  // A code-read filter's operation uses its own words and nothing else. The same column named again outside them
  // ("show advisor where advisor starts with …", "no advisor, advisor") is used only by another operation.
  const readOps = new Set<ViewOperation>();
  for (const r of codeRead) {
    if (!("predicate" in r)) continue;
    const { columnId, operator, value } = r.predicate;
    const op = operations.find(
      (o) =>
        o.type === "filter.add" &&
        !readOps.has(o) &&
        o.predicate.columnId === columnId &&
        o.predicate.operator === operator &&
        o.predicate.value === value,
    );
    if (op) readOps.add(op);
  }
  const named = new Set(operations.filter((op) => !readOps.has(op)).flatMap(namesOf));
  const counts = operations.flatMap((op) => (op.type === "limit.set" && op.count !== null ? [op.count] : []));
  const has = (key: string, selectedId: string) => evidence.some((e) => e.key === key && e.selectedId === selectedId);
  // A part that clears or resets: by the compiler's evidence or, for a plan given without evidence, by its words and a
  // clearing operation in the plan.
  const clearingOp = operations.some(
    (op) =>
      op.type === "filter.clear" ||
      op.type === "view.reset" ||
      (op.type === "sort.set" && op.sorts.length === 0) ||
      (op.type === "group.set" && op.columnIds.length === 0),
  );
  const clears = (index: number, text: string) =>
    evidence.some((e) => (e.key === `c${index}.family` || e.key.startsWith(`c${index}.family.`)) && CLEARING.has(e.selectedId ?? "")) ||
    (evidence.length === 0 && clearingOp && CLEAR_WORDS.test(text));
  // Each filter holds one literal, so the same amount said twice needs two filters.
  const free = [...predicates];
  const out: UnusedReading[] = [];
  for (const clause of input.clauses) {
    // In a part that clears, a named column is what the clear targets ("clear the market value filter"). Anything else
    // it holds, such as an amount or a value, still counts.
    const clearing = clears(clause.index, clause.text);
    // In a part that leaves rows out ("exclude accounts at Summit Trust"), a filter that leaves the named value out
    // uses it too, as a complemented amount does.
    const leaving = leavesRowsOut(unquoted(clause.text));
    const found: Array<{ at: number; text: string }> = [];
    const spans = codeRead.filter((r) => r.clauseIndex === clause.index);
    const inSpan = (at: number, end = at + 1) => spans.some((r) => at < r.end && end > r.start);
    for (const r of spans) {
      if (!("predicate" in r)) continue;
      const { columnId, operator, value } = r.predicate;
      const at = free.findIndex((p) => p.columnId === columnId && p.operator === operator && p.value === value);
      if (at >= 0) free.splice(at, 1);
      else found.push({ at: r.start, text: clause.text.slice(r.start, r.end) });
    }
    for (const lit of clause.literals) {
      if (inSpan(lit.at)) continue;
      // Quoted text that is exactly a column name the plan uses: 'hide "market value"'.
      const quotedName = mentions.some(
        (m) =>
          lit.kind === "text" &&
          m.clauseIndex === clause.index &&
          m.valueId === undefined &&
          m.start === lit.at + 1 &&
          m.end === lit.at + 1 + String(lit.value).length &&
          named.has(m.columnId),
      );
      if (quotedName) continue;
      const at = free.findIndex((p) => holdsLiteral(p, lit));
      if (at >= 0) free.splice(at, 1);
      else found.push({ at: lit.at, text: literalText(clause.text, lit) });
    }
    if (clause.limit !== undefined && !counts.includes(clause.limit) && !has(`dropped:c${clause.index}.limit`, String(clause.limit))) {
      const count = COUNT_WORDS.exec(clause.text);
      found.push({ at: count?.index ?? 0, text: count?.[0] ?? String(clause.limit) });
    }
    for (const m of mentions.filter((x) => x.clauseIndex === clause.index)) {
      if (inSpan(m.start, m.end)) continue;
      if (has(`dropped:c${clause.index}.mention`, m.columnId)) continue;
      // An ambiguous name is not counted when it is the grid's row noun. Another entity ("and the advisor") that no
      // reading resolved and no operation uses is asked about: it was named for a reason.
      if (m.ambiguous && rowNoun && singular(clause.text.slice(m.start, m.end)) === singular(rowNoun)) continue;
      // An entity that only describes the rows: a possessive right before the row noun ("the advisor's accounts"), or
      // the subject of a sort or grouping ("households sorted by value").
      if (
        m.ambiguous &&
        rowNoun &&
        possessiveOfRows(
          clause.text,
          m.end,
          rowNoun,
          mentions.filter((x) => x.clauseIndex === clause.index && x.valueId !== undefined),
        )
      )
        continue;
      if (m.ambiguous && /^ (?:sorted|ordered|grouped|sort|order|group)\b/.test(clause.text.slice(m.end))) continue;
      if (clearing && m.valueId === undefined) continue;
      // The grid's own row noun ("the advisor on the account") may mean the rows, unless the words make it a column:
      // "by account", "the account column".
      if (
        rowNoun &&
        m.valueId === undefined &&
        singular(clause.text.slice(m.start, m.end)) === singular(rowNoun) &&
        !/\bby\s+(?:the\s+)?$/.test(clause.text.slice(0, m.start)) &&
        !/^\s*columns?\b/.test(clause.text.slice(m.end))
      )
        continue;
      // The User picked one of the values named for this column ("Northgate or Harborline": "Harborline").
      if (m.valueId !== undefined && evidence.some((e) => e.key === `c${clause.index}.value.${m.columnId}` && e.source === "user"))
        continue;
      const used =
        m.valueId === undefined ? named.has(m.columnId) : predicates.some((p) => usesValue(p, m) || (leaving && usesValue(p, flipped(m))));
      if (!used) found.push({ at: m.start, text: clause.text.slice(m.start, m.end) });
    }
    // A value group ("retirement") is one name with a Mention per value: name it once.
    const seen = new Set<string>();
    for (const f of found.sort((a, b) => a.at - b.at)) {
      if (seen.has(`${f.at}\u0000${f.text}`)) continue;
      seen.add(`${f.at}\u0000${f.text}`);
      out.push({ clauseIndex: clause.index, text: f.text });
    }
  }
  return out;
};
