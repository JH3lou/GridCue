import type { Clause, LiteralKind } from "./normalize";
import type { ColumnKind, EnumValue } from "./protocol";
import { findMentions, type TextMatch } from "./text-match";

/** The column kinds a literal of each kind can filter. An unreadable number fits none, so GridCue asks. */
export const LITERAL_COLUMN_KINDS: Readonly<Record<LiteralKind, readonly ColumnKind[]>> = {
  number: ["number", "currency", "percent"],
  currency: ["currency", "number"],
  percent: ["percent"],
  date: ["date", "datetime"],
  text: ["string"],
  unreadable: [],
};

/** A column or enum value a Clause names by one of its Host-declared names. */
export interface Mention {
  clauseIndex: number;
  columnId: string;
  /** Set when the text named an enum value, such as "roth". Its column is implied. */
  valueId?: string;
  /**
   * A row or entity noun that grammar couldn't place, such as "households" in "largest households first": it may mean
   * the column or the records (ADR 0015). The provider may be asked which.
   */
  ambiguous?: true;
  /** The words as written. Set on ambiguous Mentions. */
  text?: string;
  /** The value was excluded, not chosen: "non-retirement", "excluding trusts". The compiler filters to the others. */
  negated?: true;
  /**
   * Another entity ranked by size ("largest households first") whose column can't hold a size, such as the text
   * Household: it can only mean the records. Code reads that from the column's kind, like the amount rule (ADR 0015).
   */
  records?: true;
  start: number;
  end: number;
}

/** What matching needs from a column. Schema columns and provider candidates both fit. */
export interface MentionColumn {
  id: string;
  label: string;
  kind: ColumnKind;
  aliases?: readonly string[] | undefined;
  enumValues?: readonly EnumValue[] | undefined;
  entity?: string | undefined;
  valueGroups?: ReadonlyArray<{ label: string; aliases?: readonly string[] | undefined; values: readonly string[] }> | undefined;
}

// A column name "where the rows go" names the rows, not the column (ADR 0013): "Roth accounts",
// "accounts with …", "sort households by …", "accounts over $1M" when Account number can't hold an amount.
// The rules lean toward "the rows": a name wrongly read as the rows falls back to the provider, while one
// wrongly read as a column overrides it.
const QUALIFIER_AFTER = /^\s*(?:with|without|where|whose|that|which|at|in|from|having|held|owned)\b/;
const BY_AFTER = /^\s*by\b/;
const COMPARISON_AFTER =
  /^\s*(?:(?:is|are)\s+)?(?:over|under|above|below|exceed(?:s|ing)?|more than|less than|greater than|fewer than|at least|at most|up to|between|>|<)/;
// A superlative ranks rows: "biggest accounts first", "largest households first".
const SUPERLATIVE_BEFORE =
  /\b(?:biggest|largest|smallest|highest|lowest|greatest|least|most|top|bottom|best|worst|richest|poorest|newest|oldest)\s+(?:[\p{L}-]+\s+)?$/u;
// These slots always hold a column: "sort by value in descending order", "hide the account column".
const COLUMN_SLOT_BEFORE = /\b(?:by|on)\s+(?:the\s+)?$/;
const COLUMN_WORD_AFTER = /^\s*columns?\b/;

const nameKey = (name: string) => (name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");

/** Keeps only names that point at exactly one item. An ambiguous name is left to the provider. */
const unambiguous = <T>(entries: Array<{ item: T; key: string; names: string[] }>) => {
  const owners = new Map<string, Set<string>>();
  for (const e of entries) {
    for (const n of e.names) {
      const k = nameKey(n);
      owners.set(k, (owners.get(k) ?? new Set()).add(e.key));
    }
  }
  return entries.map((e) => ({ item: e.item, names: e.names.filter((n) => owners.get(nameKey(n))?.size === 1) }));
};

/** Where grammar puts a column-name match: a column slot, the rows, or undecided. */
const placement = (
  clause: Clause,
  hit: TextMatch<MentionColumn>,
  others: ReadonlyArray<TextMatch<unknown>>,
): "column" | "rows" | "ranked" | undefined => {
  const before = clause.text.slice(0, hit.start);
  const after = clause.text.slice(hit.end);
  if (COLUMN_SLOT_BEFORE.test(before) || COLUMN_WORD_AFTER.test(after)) return "column";
  if (others.some((o) => o !== hit && o.end <= hit.start && /^\s*$/.test(clause.text.slice(o.end, hit.start)))) return "rows";
  if (QUALIFIER_AFTER.test(after) || BY_AFTER.test(after)) return "rows";
  // A yes/no column can't be ranked, so "the most restricted accounts" still names Restricted holdings.
  // Ranked by a superlative. For the grid's own row noun that is the rows; for another entity it may be the records.
  if (SUPERLATIVE_BEFORE.test(before) && hit.item.kind !== "boolean") return "ranked";
  if (COMPARISON_AFTER.test(after)) {
    // With an amount after it, the kind decides: "value over $1M" is a column, "accounts over $1M" the rows.
    // With none, the word is a preposition: "accounts under each advisor".
    const literal = clause.literals.filter((l) => l.at >= hit.end).sort((a, b) => a.at - b.at)[0];
    if (!literal) return "rows";
    return literal.kind !== "unreadable" && !LITERAL_COLUMN_KINDS[literal.kind].includes(hit.item.kind) ? "rows" : undefined;
  }
  return undefined;
};

/** "households" and "household" name the same noun. */
const singular = (words: string) => nameKey(words).replace(/(?:es|s)$/, "");
/** A value named after one of these is excluded, not chosen: "non-retirement", "excluding trusts". Left to the provider. */
const NEGATED_BEFORE = /\b(?:non|not|no|excluding|except|without)(?:\s+(?:at|in|from|with))?[\s-]*$/;
/** What joins the values of one list: "Northgate or Harborline", "trusts, IRAs, and Roths". */
const LIST_JOIN = /^\s*(?:,\s*)?(?:(?:or|and|nor)\s+)?(?:(?:at|in|from)\s+)?$/;

/**
 * Finds the columns and enum values each Clause names by a Host-declared label or alias. Deterministic,
 * so these never depend on a provider's score. Pass exposed columns only: Mentions are sent to the provider.
 */
export const matchMentions = (
  clauses: readonly Clause[],
  columns: readonly MentionColumn[],
  options: { rowNoun?: string | undefined } = {},
): Mention[] => {
  // A value group ("retirement") names several values of one column, so it yields one Mention per value (ADR 0015).
  const valueEntries = unambiguous(
    columns.flatMap((c) => [
      ...(c.enumValues ?? []).map((v) => ({
        item: { columnId: c.id, valueIds: [v.id] },
        key: `${c.id}\u0000${v.id}`,
        names: [v.label, ...(v.aliases ?? [])],
      })),
      ...(c.valueGroups ?? []).map((g) => ({
        item: { columnId: c.id, valueIds: [...g.values] },
        key: `${c.id}\u0000group\u0000${g.label}`,
        names: [g.label, ...(g.aliases ?? [])],
      })),
    ]),
  );
  // A row noun or entity word that grammar leaves undecided may mean the column or the records.
  const nouns = (col: MentionColumn) => [options.rowNoun, col.entity].filter((n): n is string => !!n).map(singular);
  const columnEntries = unambiguous(columns.map((c) => ({ item: c, key: c.id, names: [c.label, ...(c.aliases ?? [])] })));
  return clauses.flatMap((clause) => {
    // Values first, masked out, so "Roth IRA" is not also read as a column name.
    const values = findMentions(clause.text, valueEntries);
    const masked = values.reduce((t, h) => t.slice(0, h.start) + " ".repeat(h.end - h.start) + t.slice(h.end), clause.text);
    const cols = findMentions(masked, columnEntries);
    const all: TextMatch<unknown>[] = [...values, ...cols];
    // A negation covers a list of values of the same column: "not at Northgate or Harborline".
    const negatedHits = new Set<TextMatch<unknown>>();
    values.forEach((h, i) => {
      const prev = values[i - 1];
      const listed =
        !!prev && negatedHits.has(prev) && prev.item.columnId === h.item.columnId && LIST_JOIN.test(clause.text.slice(prev.end, h.start));
      if (listed || NEGATED_BEFORE.test(clause.text.slice(0, h.start))) negatedHits.add(h);
    });
    return [
      ...values.flatMap((h) => {
        const negated = negatedHits.has(h);
        return h.item.valueIds.map((valueId) => ({
          clauseIndex: clause.index,
          columnId: h.item.columnId,
          valueId,
          start: h.start,
          end: h.end,
          ...(negated ? { negated: true as const } : {}),
        }));
      }),
      ...cols.flatMap((h): Mention[] => {
        const place = placement(clause, h, all);
        const text = clause.text.slice(h.start, h.end);
        const isRowNoun = !!options.rowNoun && singular(text) === singular(options.rowNoun);
        // Any name of a column that declares an entity names that entity: "reps" for Advisor.
        const isEntity = !!h.item.entity;
        // "largest households first" ranks another entity: the column's values or the households as records.
        const rankedEntity = place === "ranked" && isEntity && !isRowNoun;
        if (place === "rows" || (place === "ranked" && !rankedEntity)) return [];
        const ambiguous = rankedEntity || (place === undefined && nouns(h.item).includes(singular(text)));
        const sized = ["number", "currency", "percent", "date", "datetime"].includes(h.item.kind);
        if (rankedEntity && !sized) {
          return [{ clauseIndex: clause.index, columnId: h.item.id, start: h.start, end: h.end, ambiguous: true, text, records: true }];
        }
        return [
          {
            clauseIndex: clause.index,
            columnId: h.item.id,
            start: h.start,
            end: h.end,
            ...(ambiguous ? { ambiguous: true as const, text } : {}),
          },
        ];
      }),
    ].sort((a, b) => a.start - b.start);
  });
};
