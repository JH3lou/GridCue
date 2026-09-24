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

const inRowPosition = (clause: Clause, hit: TextMatch<MentionColumn>, others: ReadonlyArray<TextMatch<unknown>>): boolean => {
  const before = clause.text.slice(0, hit.start);
  const after = clause.text.slice(hit.end);
  if (COLUMN_SLOT_BEFORE.test(before) || COLUMN_WORD_AFTER.test(after)) return false;
  if (others.some((o) => o !== hit && o.end <= hit.start && /^\s*$/.test(clause.text.slice(o.end, hit.start)))) return true;
  if (QUALIFIER_AFTER.test(after) || BY_AFTER.test(after)) return true;
  // A yes/no column can't be ranked, so "the most restricted accounts" still names Restricted holdings.
  if (SUPERLATIVE_BEFORE.test(before) && hit.item.kind !== "boolean") return true;
  if (COMPARISON_AFTER.test(after)) {
    // With an amount after it, the kind decides: "value over $1M" is a column, "accounts over $1M" the rows.
    // With none, the word is a preposition: "accounts under each advisor".
    const literal = clause.literals.filter((l) => l.at >= hit.end).sort((a, b) => a.at - b.at)[0];
    if (!literal) return true;
    return literal.kind !== "unreadable" && !LITERAL_COLUMN_KINDS[literal.kind].includes(hit.item.kind);
  }
  return false;
};

/**
 * Finds the columns and enum values each Clause names by a Host-declared label or alias. Deterministic,
 * so these never depend on a provider's score. Pass exposed columns only: Mentions are sent to the provider.
 */
export const matchMentions = (clauses: readonly Clause[], columns: readonly MentionColumn[]): Mention[] => {
  const valueEntries = unambiguous(
    columns.flatMap((c) =>
      (c.enumValues ?? []).map((v) => ({
        item: { columnId: c.id, valueId: v.id },
        key: `${c.id}\u0000${v.id}`,
        names: [v.label, ...(v.aliases ?? [])],
      })),
    ),
  );
  const columnEntries = unambiguous(columns.map((c) => ({ item: c, key: c.id, names: [c.label, ...(c.aliases ?? [])] })));
  return clauses.flatMap((clause) => {
    // Values first, masked out, so "Roth IRA" is not also read as a column name.
    const values = findMentions(clause.text, valueEntries);
    const masked = values.reduce((t, h) => t.slice(0, h.start) + " ".repeat(h.end - h.start) + t.slice(h.end), clause.text);
    const cols = findMentions(masked, columnEntries);
    const all: TextMatch<unknown>[] = [...values, ...cols];
    return [
      ...values.map((h) => ({ clauseIndex: clause.index, columnId: h.item.columnId, valueId: h.item.valueId, start: h.start, end: h.end })),
      ...cols
        .filter((h) => !inRowPosition(clause, h, all))
        .map((h) => ({ clauseIndex: clause.index, columnId: h.item.id, start: h.start, end: h.end })),
    ].sort((a, b) => a.start - b.start);
  });
};
