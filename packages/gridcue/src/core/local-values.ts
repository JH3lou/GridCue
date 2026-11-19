import { inComparison } from "./code-read";
import { isExposed } from "./columns";
import type { Mention } from "./mentions";
import { literalText, type NormalizedInput, normalize, unquoted } from "./normalize";
import { ownWord } from "./own-words";
import { type CodeReadSpan, type PlacedPart, unplacedWords } from "./placed";
import type { ViewSchema } from "./protocol";

/**
 * Local Values: what counts as naming one (named filters spec, 5.4; ADR 0025).
 *
 * A Local Value is a value of a text column that GridCue reads from the grid's own rows, in the User's browser, when the
 * Host says so. This module holds the two pieces that decide what a request names:
 * - `indexLocalValues` builds a word index from one column's values, once;
 * - `readLocalValues` reads one part of a request against the indexes. It is a pure function: it returns the whole
 *   values the part names, the ties, and the words that are one word of a value, each with where it sits in the part.
 *
 * Nothing here builds a filter or a question, and nothing here is sent anywhere. The caller turns a whole value into an
 * exact filter and a tie or a word into a question, and it never sends any of them to an Intent Provider: the provider's
 * request is built before values are looked at (spec 4.3).
 *
 * The rules:
 * - **A whole value is read.** Every word of it, in order, as whole words, ignoring letter case and the punctuation
 *   between words. There is no plural form. Between two of its words the part may hold spaces, one hyphen, underscore,
 *   full stop or apostrophe with no space beside it, or the punctuation the value itself holds there. A comma, a slash
 *   or a symbol the value does not hold separates two names: "Hollis, Greaves" lists two and is not the value Hollis
 *   Greaves.
 * - **The longest name wins.** "The Alder household" is the value Alder Household, not the Household column. A value
 *   inside a longer value named whole is not read, and an amount inside a value ("Fund 7") is part of the name. A
 *   declared name that holds the value wins the same way: "market value" is the column, not a value Market.
 * - **A value made only of GridCue's own words is never read,** and never offered. A word is GridCue's own when its
 *   reader gives it a meaning (`core/own-words.ts`), a comparison is written with it, or `normalize` reads it as an
 *   amount. Nor is a value read where the placed-words lists place every word of it without it ("can you", "as well").
 * - **Ties ask.** A value two columns hold; a value one column holds in two spellings ("Hollis-Greaves", "Hollis
 *   Greaves"); a value that is also a declared name of a column, a value, a Value Group, the Row Noun, an entity word
 *   or a House Term, in any form GridCue finds that name in; a value whose every word is a declared name or one of
 *   GridCue's own words ("Trust Accounts"), since the part reads whole without it; a value whose words cross another
 *   name's; a value that ends in a possessive mark when the grid also holds it without ("Darcy's" and "Darcy"); and a
 *   value that may list two others ("Alder and Cedar", when the grid also holds Alder and Cedar).
 * - **One word of a value asks.** A word that the placed-words lists do not place (`unplacedWords`), that is no
 *   declared name and none of GridCue's own words, and that is a whole word of a value. With one to five such values the
 *   caller offers them; with more it asks for the full name.
 * - **Quoted text is never looked inside.**
 *
 * The words inside a whole value's span are the value's own. A Mention, an amount, a count or a direction read there
 * names nothing else, and the caller drops it, as it does inside any code-read filter (`outsideCodeRead`).
 *
 * `core/own-words.ts` reads `core/code-read.ts`, so this module sits above both. `core/code-read.ts` may import its
 * types, never its functions.
 */

type Span = { start: number; end: number };

/** How many values a one-word question offers at most (spec 5.4). With more, GridCue asks for the full name. */
export const MAX_LOCAL_VALUE_CHOICES = 5;

/**
 * One column's Local Values, indexed by their words. Built once by `indexLocalValues` and read by `readLocalValues`. The
 * maps are the index's own: treat them as opaque.
 */
export interface LocalValueIndex {
  /** The column's distinct values that hold a word, as the grid holds them, in the order first seen. */
  readonly values: readonly string[];
  /** Each word the values hold, numbered from 1. */
  readonly words: ReadonlyMap<string, number>;
  /** By a word's number, the values that hold it as a whole word. The possessive mark is no value's word here. */
  readonly holders: ReadonlyArray<number | readonly number[] | undefined>;
  /**
   * The values' words as a tree, read one word at a time from node 0 (`stepOf`). By node: the word number of its first
   * next word, and the node after it (0 for none). Most nodes have one next word.
   */
  readonly firstTerm: readonly number[];
  readonly firstNext: readonly number[];
  /** By node, for a node with more than one next word: each other next word's number to the node after it. */
  readonly branches: ReadonlyMap<number, ReadonlyMap<number, number>>;
  /** A node to the values whose last word it is, by where each sits in `values`. Several values can read the same. */
  readonly ends: ReadonlyMap<number, number | readonly number[]>;
  /** A node to the punctuation, spaces left out, that some value holds right before its word: "&" in "Birch & Fenn". */
  readonly marks: ReadonlyMap<number, ReadonlySet<string>>;
}

/** One column's index, with the column it belongs to. */
export interface LocalValueColumn {
  columnId: string;
  index: LocalValueIndex;
}

/** A value, as the grid holds it, and its column. */
export interface LocalValueRef {
  columnId: string;
  value: string;
}

/** A whole value the part names, with where its words sit in the part's text. Certain: one value of one column. */
export interface NamedLocalValue extends Span, LocalValueRef {}

/** Another thing the words of a tie name. */
export interface DeclaredName {
  /** What declares it. `codeRead` is another code-read filter's words: a text form, an empty form. */
  kind: "column" | "value" | "valueGroup" | "rowNoun" | "entity" | "houseTerm" | "codeRead";
  /** The name as the Host declared it, or for `codeRead` the words as written. */
  label: string;
  columnId?: string;
  valueId?: string;
}

/**
 * Words that name a value and something else, with where they sit. GridCue asks which was meant. `values` holds every
 * value the words may name, each with where its own words sit, and `names` every declared name they may also be.
 */
export interface LocalValueTie extends Span {
  values: Array<LocalValueRef & Span>;
  names: DeclaredName[];
}

/** A word that is one whole word of a value, and of no whole value the part names. */
export interface LocalValueWord extends Span {
  /** The word as written in the part (lower case, as `normalize` leaves it). */
  word: string;
  /** How many values hold the word, in every column together. */
  count: number;
  /** How many values hold it in each column that has any, in the order the columns were given. */
  columns: Array<{ columnId: string; count: number }>;
  /** The values that hold it, when there are at most `MAX_LOCAL_VALUE_CHOICES`: the choices to offer. Empty with more. */
  choices: LocalValueRef[];
}

/** What one part of a request names among the Local Values. Each list is in the order written. */
export interface LocalValuesRead {
  values: NamedLocalValue[];
  ties: LocalValueTie[];
  words: LocalValueWord[];
  /**
   * Each word of the part, once, that is a whole word of some value, read as one or not ("group" in "the travel group",
   * when the grid holds Hollis Travel Group). The compiler asks about such a word where it would drop it.
   */
  valueWords: string[];
}

/** What one part names among the Local Values, with the part's index. */
export interface LocalValuesPart extends LocalValuesRead {
  clauseIndex: number;
}

/** The possessive mark, read as a word of its own so that "Lane's fund" is never the value Lane S Fund. */
const POSSESSIVE = "'s";
/** A word: a run of letters and digits, or a possessive mark right after one. */
const WORD = /[\p{L}\p{N}]+|(?<=[\p{L}\p{N}])'s(?![\p{L}\p{N}])/gu;
/** Stands in for quoted text, keeping offsets. No name is read across it. */
const MASK = "\u0000";

interface Word extends Span {
  key: string;
}
const wordsIn = (text: string): Word[] => {
  const out: Word[] = [];
  for (const m of text.matchAll(WORD)) out.push({ start: m.index, end: m.index + m[0].length, key: m[0] });
  return out;
};
/** A value as a request would hold it: straight apostrophes and lower case. */
const lowered = (value: string): string => value.replace(/[‘’]/g, "'").toLowerCase();
/** A value's words, for the index. */
const keysOf = (value: string): string[] | null => lowered(value).match(WORD);
/** The punctuation between two words, spaces left out: "" for spaces alone, "&" for " & ". */
const markOf = (between: string): string => between.replace(/\s+/g, "");
/** A character that is no letter, digit or space: a value without one has no punctuation between its words. */
const PUNCTUATED = /[^\p{L}\p{N}\s]/u;
/** The node after `node` by the word numbered `term` in an index's tree, or `undefined`. */
const stepOf = (index: LocalValueIndex, node: number, term: number): number | undefined =>
  index.firstTerm[node] === term ? index.firstNext[node] : index.branches.get(node)?.get(term);

const add = <K>(map: Map<K, number | number[]>, key: K, id: number) => {
  const held = map.get(key);
  if (held === undefined) map.set(key, id);
  else if (typeof held === "number") {
    if (held !== id) map.set(key, [held, id]);
  } else if (held[held.length - 1] !== id) held.push(id);
};
const addAt = (list: Array<number | number[] | undefined>, at: number, id: number) => {
  const held = list[at];
  if (held === undefined) list[at] = id;
  else if (typeof held === "number") {
    if (held !== id) list[at] = [held, id];
  } else if (held[held.length - 1] !== id) held.push(id);
};
const idsOf = (held: number | readonly number[] | undefined): readonly number[] =>
  held === undefined ? [] : typeof held === "number" ? [held] : held;

/**
 * Builds the word index for one column's values (spec 5.4). Values that are not text, hold no letter or digit, or
 * repeat an earlier value are dropped. A value that differs from an earlier one only in letter case repeats it: an
 * exact filter on a text column ignores letter case (`matchesPredicate`), so both keep the same rows, and asking which
 * was meant would offer two choices that do the same. The values are kept as the grid holds them, the first spelling
 * of each, so a filter keeps exactly its rows. Nothing is checked against GridCue's own words here: `readLocalValues`
 * does that for the few words a request holds, so building stays fast for a long list.
 */
export const indexLocalValues = (values: readonly unknown[]): LocalValueIndex => {
  const kept: string[] = [];
  const seen = new Set<string>();
  const words = new Map<string, number>();
  const holders: Array<number | number[] | undefined> = [undefined];
  const firstTerm: number[] = [0];
  const firstNext: number[] = [0];
  const branches = new Map<number, Map<number, number>>();
  const ends = new Map<number, number | number[]>();
  const marks = new Map<number, Set<string>>();
  /** A new node after `node` by the word numbered `term`. */
  const grow = (node: number, term: number): number => {
    const made = firstTerm.length;
    firstTerm.push(0);
    firstNext.push(0);
    if (firstNext[node] === 0) {
      firstTerm[node] = term;
      firstNext[node] = made;
    } else {
      const more = branches.get(node);
      if (more) more.set(term, made);
      else branches.set(node, new Map([[term, made]]));
    }
    return made;
  };
  for (const value of values) {
    if (typeof value !== "string") continue;
    // Letter case as `matchesPredicate` ignores it.
    const caseless = value.toLowerCase();
    if (seen.has(caseless)) continue;
    seen.add(caseless);
    const held = lowered(value);
    const keys = held.match(WORD);
    if (!keys) continue;
    const id = kept.length;
    kept.push(value);
    // The punctuation before each word, worked out only for a value that holds some ("Birch & Fenn"): most hold none.
    const heldMarks = PUNCTUATED.test(held) ? marksOf(held) : undefined;
    let node = 0;
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k] as string;
      let term = words.get(key);
      if (term === undefined) {
        term = holders.length;
        words.set(key, term);
        holders.push(undefined);
      }
      const child = (firstTerm[node] === term ? firstNext[node] : branches.get(node)?.get(term)) ?? grow(node, term);
      const mark = heldMarks?.[k];
      if (mark) {
        const known = marks.get(child);
        if (known) known.add(mark);
        else marks.set(child, new Set([mark]));
      }
      node = child;
      if (key !== POSSESSIVE) addAt(holders, term, id);
    }
    add(ends, node, id);
  }
  return { values: kept, words, holders, firstTerm, firstNext, branches, ends, marks };
};

/** For each word of a value as a request would hold it (`lowered`), the punctuation before it (`markOf`). */
const marksOf = (held: string): string[] => {
  const found = wordsIn(held);
  return found.map((w, k) => (k === 0 ? "" : markOf(held.slice(found[k - 1]?.end, w.start))));
};
/** For each value of an index, `marksOf`, worked out when first asked. */
const VALUE_MARKS = new WeakMap<LocalValueIndex, Map<number, readonly string[]>>();
const valueMarks = (index: LocalValueIndex, id: number): readonly string[] => {
  let known = VALUE_MARKS.get(index);
  if (!known) {
    known = new Map();
    VALUE_MARKS.set(index, known);
  }
  let held = known.get(id);
  if (!held) {
    held = marksOf(lowered(index.values[id] ?? ""));
    known.set(id, held);
  }
  return held;
};

// GridCue's own words, asked of the reader's lists once for each word.

const OWN_WORDS = new Map<string, boolean>();
const OWN_WORDS_KEPT = 4096;

/** Whether a word, read on its own, is an amount: "7", "2024", "50k", "1m". "Q3" and "Fund7" hold one and are not. */
const isAmount = (word: string): boolean => {
  if (!/\p{N}/u.test(word)) return false;
  if (/^\p{N}+$/u.test(word)) return true;
  const { clauses } = normalize(word);
  const [clause] = clauses;
  const [lit] = clause?.literals ?? [];
  if (clauses.length !== 1 || !clause || !lit || clause.literals.length !== 1 || lit.kind === "text") return false;
  return lit.at === 0 && literalText(clause.text, lit).length === clause.text.length;
};
/**
 * Whether one word is GridCue's own: a word its reader gives a meaning (`ownWord`), a word a comparison is written
 * with, an amount, or the possessive mark. The answer is a fact about the word alone, so it is kept.
 */
const isOwn = (word: string): boolean => {
  if (word === POSSESSIVE) return true;
  const known = OWN_WORDS.get(word);
  if (known !== undefined) return known;
  const own = ownWord(word) || inComparison(word) || isAmount(word);
  if (OWN_WORDS.size >= OWN_WORDS_KEPT) OWN_WORDS.clear();
  OWN_WORDS.set(word, own);
  return own;
};

/** A schema that declares no name, to read a value's words against GridCue's own lists alone. */
const NO_NAMES: ViewSchema = { id: "local-values", version: "1", columns: [] };
/**
 * Whether a value is made only of GridCue's own words: each word is one on its own, or the placed-words lists place it
 * when the value is read alone ("as well", "can you"). Such a value is never read from the grid, so it is never a
 * choice either.
 */
const madeOfOwnWords = (value: string): boolean => {
  if ((keysOf(value) ?? []).every(isOwn)) return true;
  return normalize(value).clauses.every((clause) =>
    unplacedWords({ clause, mentions: [], codeRead: [], schema: NO_NAMES }).every((u) => (u.text.match(WORD) ?? []).every(isOwn)),
  );
};
/**
 * `madeOfOwnWords` for each value of an index, by where it sits in `values`. The answer is a fact about the value alone,
 * so it is worked out once for each value, however many requests or words ask, and kept as long as the index is.
 */
const OWN_VALUES = new WeakMap<LocalValueIndex, Map<number, boolean>>();
const madeOfOwnWordsAt = (index: LocalValueIndex, id: number): boolean => {
  let known = OWN_VALUES.get(index);
  if (!known) {
    known = new Map();
    OWN_VALUES.set(index, known);
  }
  let own = known.get(id);
  if (own === undefined) {
    own = madeOfOwnWords(index.values[id] ?? "");
    known.set(id, own);
  }
  return own;
};
/**
 * Up to this many values that hold a word are each read against GridCue's own lists before they are counted. A longer
 * list is counted as it is: it is far past the choices a question offers, and the reading is not free.
 */
const CHOICES_CHECKED = 12;

// The names the schema declares, as words, built once for each schema.

interface DeclaredEntry {
  keys: readonly string[];
  name: DeclaredName;
}
const DECLARED = new WeakMap<ViewSchema, ReadonlyMap<string, readonly DeclaredEntry[]>>();

/** Every way to write a name's words: apart, or joined with nothing between ("tax id", "taxid"). */
const joined = (keys: readonly string[]): string[][] => {
  if (keys.length > 4) return [[...keys], [keys.join("")]];
  let out: string[][] = [[keys[0] ?? ""]];
  for (const key of keys.slice(1)) {
    out = out.flatMap((sofar) => [
      [...sofar, key],
      [...sofar.slice(0, -1), `${sofar.at(-1) ?? ""}${key}`],
    ]);
  }
  return out;
};
/** The forms a name's last word is found in: as declared, and in the plural ("trust", "trusts"; "entry", "entries"). */
const plurals = (word: string): string[] => [
  word,
  `${word}s`,
  `${word}es`,
  ...(/[^aeiou]y$/.test(word) ? [`${word.slice(0, -1)}ies`] : []),
];

/**
 * The schema's declared names by their first word, in every form GridCue finds a name in (`core/text-match.ts`,
 * `core/placed.ts`): any separator between its words or none, and a plural. A House Term has no plural (ADR 0024).
 */
const declaredIn = (schema: ViewSchema): ReadonlyMap<string, readonly DeclaredEntry[]> => {
  const cached = DECLARED.get(schema);
  if (cached) return cached;
  const byFirst = new Map<string, DeclaredEntry[]>();
  const declare = (said: string | undefined, name: DeclaredName, plural = true) => {
    const keys = said ? keysOf(said) : null;
    if (!keys) return;
    for (const form of joined(keys)) {
      const last = form.at(-1) ?? "";
      for (const end of plural && last !== POSSESSIVE ? plurals(last) : [last]) {
        const entry = { keys: [...form.slice(0, -1), end], name };
        const first = entry.keys[0] ?? "";
        const known = byFirst.get(first);
        if (known) known.push(entry);
        else byFirst.set(first, [entry]);
      }
    }
  };
  if (schema.rowNoun) declare(schema.rowNoun, { kind: "rowNoun", label: schema.rowNoun });
  for (const col of schema.columns.filter(isExposed)) {
    for (const said of [col.label, ...(col.aliases ?? [])]) declare(said, { kind: "column", label: col.label, columnId: col.id });
    if (col.entity) declare(col.entity, { kind: "entity", label: col.entity, columnId: col.id });
    for (const v of col.enumValues ?? [])
      for (const said of [v.label, ...(v.aliases ?? [])]) declare(said, { kind: "value", label: v.label, columnId: col.id, valueId: v.id });
    for (const g of col.valueGroups ?? [])
      for (const said of [g.label, ...(g.aliases ?? [])]) declare(said, { kind: "valueGroup", label: g.label, columnId: col.id });
  }
  for (const term of schema.houseTerms ?? [])
    for (const said of [term.label, ...(term.aliases ?? [])]) declare(said, { kind: "houseTerm", label: term.label }, false);
  DECLARED.set(schema, byFirst);
  return byFirst;
};

/** A declared name, or another code-read filter, with where it sits in the part. */
interface Named extends Span {
  name: DeclaredName;
}

const JOINER = /^[-_.']$/;
/**
 * The part writes two of a value's words as that value's with only spaces between them, with one hyphen, underscore,
 * full stop or apostrophe and no space ("O'Jessup" for O Jessup), or with the punctuation the value itself holds there
 * ("Birch & Fenn", "Lane, Avery"). Anything else separates two names. This gives the punctuation that only a value
 * holding it there joins across, or `undefined` where any value's two words may sit.
 */
const strictMark = (written: string): string | undefined => {
  const said = markOf(written);
  return said === "" || JOINER.test(written) ? undefined : said;
};

/**
 * How many whole-value readings a part may hold for each of its words, beyond `FOUND_SLACK`. Values that hold each other
 * in turn ("Kim", "Kim Kim", "Kim Kim Kim") can make one for every place and length, and the part can't be one request
 * for all of them: past this many it asks, and nothing more is worked out for it.
 */
const FOUND_PER_WORD = 4;
const FOUND_SLACK = 64;

/** A whole value found in the part: its words there, every value they read as, and what else they name. */
interface Found extends Span {
  /** Which of the part's words is its first. */
  from: number;
  /** Which of the part's words comes after its last. */
  to: number;
  refs: LocalValueRef[];
  /** The declared names its words also are, or cross. With any, it is a tie. */
  names: DeclaredName[];
  /** Other whole values whose words cross these. With any, it is a tie. */
  crossing: Found[];
  /** Shorter whole values inside these words. */
  inside: Found[];
}

const nameKey = (n: DeclaredName) => `${n.kind}\u0000${n.label}\u0000${n.columnId ?? ""}\u0000${n.valueId ?? ""}`;
const refKey = (r: LocalValueRef) => `${r.columnId}\u0000${r.value}`;
const sameRef = (a: LocalValueRef, b: LocalValueRef) => a.columnId === b.columnId && a.value === b.value;
/** The items with no earlier item of the same key, in order. */
const distinct = <T>(items: readonly T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
/** Past this many shorter values inside a longer one, it is read as a list of them (`listedIn`) without looking. */
const INSIDE_CHECKED = 64;
const holds = (outer: Span, inner: Span) => outer.start <= inner.start && inner.end <= outer.end;

/**
 * Reads one part of a request against the Local Value indexes (spec 5.4): the whole values it names, the ties, and the
 * words that are one word of a value. The rules are at the top of this module.
 *
 * `part` is the part as the placed-words check sees it: its Clause, its own Mentions, where its other code-read filters
 * sit, and the schema. `columns` are the indexes, in the order questions should name them. It reads nothing else, keeps
 * nothing but what a word or a schema always answers, and returns an equal answer for the same input. The part's text
 * is as `normalize` leaves it, in lower case.
 */
export const readLocalValues = (part: PlacedPart, columns: readonly LocalValueColumn[]): LocalValuesRead => {
  const read: LocalValuesRead = { values: [], ties: [], words: [], valueWords: [] };
  if (columns.length === 0) return read;
  const { clause, schema } = part;
  // Quoted text is masked, so no word in it is read and no value is read across it.
  const text = unquoted(clause.text, MASK);
  const words = wordsIn(text);
  // A part that holds no word of any value names none: nothing else is worked out for it.
  const inValues = words.map((w) => w.key !== POSSESSIVE && columns.some((c) => c.index.words.has(w.key)));
  if (!inValues.includes(true)) return read;
  read.valueWords = [...new Set(words.filter((_, k) => inValues[k]).map((w) => w.key))];

  // Everything below is kept word by word, so a long part is read once and never once for each of its words.
  /** Calls `visit` with each word that `span` covers any part of. The words are in the order written. */
  const eachWordIn = (span: Span, visit: (k: number) => void) => {
    let low = 0;
    let high = words.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((words[mid]?.end ?? 0) > span.start) high = mid;
      else low = mid + 1;
    }
    for (let k = low; k < words.length && (words[k]?.start ?? 0) < span.end; k++) visit(k);
  };

  // Where the part writes a declared name: the schema's names word by word, then the Mentions and the other code-read
  // filters, which may hold a name in a form the words alone do not show.
  const declared = declaredIn(schema);
  /** For each word, the declared names it is a word of. */
  const namedAt: Named[][] = words.map(() => []);
  const name = (n: Named) => eachWordIn(n, (k) => namedAt[k]?.push(n));
  /** A name the schema's own names already account for, at the same words. */
  const known = (span: Span) => {
    let same = false;
    eachWordIn(span, (k) => {
      same ||= !!namedAt[k]?.some((n) => n.start === span.start && n.end === span.end);
    });
    return same;
  };
  words.forEach((word, from) => {
    for (const entry of declared.get(word.key) ?? []) {
      const to = from + entry.keys.length;
      if (to > words.length || !entry.keys.every((key, k) => words[from + k]?.key === key)) continue;
      const span = { start: word.start, end: words[to - 1]?.end ?? word.end };
      if (text.slice(span.start, span.end).includes(MASK)) continue;
      const n = { ...span, name: entry.name };
      for (let k = from; k < to; k++) namedAt[k]?.push(n);
    }
  });
  const mentions = part.mentions.filter((m) => m.clauseIndex === clause.index);
  const others: Named[] = [];
  for (const m of mentions) {
    if (known(m)) continue;
    const col = schema.columns.find((c) => c.id === m.columnId);
    const value = m.valueId === undefined ? undefined : col?.enumValues?.find((v) => v.id === m.valueId);
    others.push({
      start: m.start,
      end: m.end,
      name: value
        ? { kind: "value", label: value.label, columnId: m.columnId, valueId: value.id }
        : { kind: "column", label: col?.label ?? m.columnId, columnId: m.columnId },
    });
  }
  for (const r of part.codeRead)
    if (!known(r)) others.push({ start: r.start, end: r.end, name: { kind: "codeRead", label: clause.text.slice(r.start, r.end) } });
  others.forEach(name);

  // "A word that no list in 4.2 places": the placed-words check decides, once for the part, with no value counted as
  // read. A word it places in part is left over too: in "ab123" it reads the amount and leaves "ab".
  let left: boolean[] | undefined;
  const leftOver = (k: number): boolean => {
    if (!left) {
      const marks = words.map(() => false);
      for (const u of unplacedWords({ ...part, mentions }))
        eachWordIn(u, (at) => {
          marks[at] = true;
        });
      left = marks;
    }
    return left[k] === true;
  };

  // Word by word, once: the punctuation before each word that only a value holding it joins across (`strictMark`), and
  // running counts of those and of words that are a declared name's, so a span is checked in one step.
  const strict = words.map((w, k) => (k === 0 ? undefined : strictMark(text.slice(words[k - 1]?.end, w.start))));
  const strictBefore = [0];
  const namedBefore = [0];
  words.forEach((_, k) => {
    strictBefore.push((strictBefore[k] ?? 0) + (strict[k] === undefined ? 0 : 1));
    namedBefore.push((namedBefore[k] ?? 0) + ((namedAt[k]?.length ?? 0) > 0 ? 1 : 0));
  });

  /**
   * The values of one column the words from `from` to `to` read as, each written there as that value's own words. `ids`
   * are the values whose words they are (`LocalValueIndex.ends`).
   */
  const refsAt = (column: LocalValueColumn, from: number, to: number, ids: readonly number[]): LocalValueRef[] => {
    // A value made only of GridCue's own words is never read from the grid.
    let own = true;
    for (let k = from; k < to && own; k++) own = isOwn(words[k]?.key ?? "");
    if (own) return [];
    // With spaces or a joining mark alone between the words, every value of these words is written here.
    const strictCount = (strictBefore[to] ?? 0) - (strictBefore[from + 1] ?? 0);
    return ids.flatMap((id) => {
      const value = column.index.values[id];
      if (value === undefined) return [];
      if (strictCount > 0) {
        const held = valueMarks(column.index, id);
        for (let k = from + 1; k < to; k++) if (strict[k] !== undefined && held[k - from] !== strict[k]) return [];
      }
      return [{ columnId: column.columnId, value }];
    });
  };
  /**
   * What else the words from `from` to `to` name, when a value is read there: the declared names they also are, or
   * cross. `undefined` when no value is read there at all.
   */
  const namesAt = (from: number, to: number, span: Span): DeclaredName[] | undefined => {
    const over = new Set<Named>();
    if ((namedBefore[to] ?? 0) > (namedBefore[from] ?? 0)) for (let k = from; k < to; k++) for (const n of namedAt[k] ?? []) over.add(n);
    const names: DeclaredName[] = [];
    const within: Named[] = [];
    for (const n of over) {
      const equal = n.start === span.start && n.end === span.end;
      // A declared name that holds the value's words is the longer name: "market value" is the column, not a value Market.
      if (!equal && holds(n, span)) return undefined;
      if (!equal && holds(span, n)) within.push(n);
      // The same words as a declared name, or words that cross one: the value is a tie with that name.
      else names.push(n.name);
    }
    if (names.length > 0) return names;
    // The value is needed when one of its words is no declared name, none of GridCue's own, and placed by no list.
    let needed = false;
    for (let k = from; k < to && !needed; k++) {
      const word = words[k];
      needed = !!word && !isOwn(word.key) && !within.some((n) => holds(n, word)) && leftOver(k);
    }
    if (needed) return [];
    // With none, the part reads whole without the value. Its words are all GridCue's own or placed where they sit ("can
    // you", "as well"), and it is not read; or some are declared names ("trust accounts"), and it is a tie with them.
    return within.length === 0 ? undefined : within.map((n) => n.name);
  };

  // Every whole value the part names, at every place and of every length: each value's words are walked from each word
  // of the part through the index's tree, one step a word.
  const found: Found[] = [];
  const foundAt = new Map<number, Found | null>();
  const most = FOUND_PER_WORD * words.length + FOUND_SLACK;
  let tooMany = false;
  for (let from = 0; from < words.length && !tooMany; from++) {
    const word = words[from];
    if (!word || !inValues[from]) continue;
    for (const column of columns) {
      const { ends, marks } = column.index;
      let node = 0;
      for (let to = from + 1; to <= words.length && !tooMany; to++) {
        const term = column.index.words.get(words[to - 1]?.key ?? "");
        const step = term === undefined ? undefined : stepOf(column.index, node, term);
        if (step === undefined) break;
        // Punctuation no value holds there separates two names.
        const mark = to - 1 > from ? strict[to - 1] : undefined;
        if (mark !== undefined && !marks.get(step)?.has(mark)) break;
        node = step;
        const held = ends.get(node);
        if (held === undefined) continue;
        const refs = refsAt(column, from, to, idsOf(held));
        if (refs.length === 0) continue;
        const place = from * (words.length + 1) + to;
        const same = foundAt.get(place);
        if (same) same.refs.push(...refs);
        // `null` is a place judged before, where no value is read.
        if (same !== undefined) continue;
        const span = { start: word.start, end: words[to - 1]?.end ?? word.end };
        const names = namesAt(from, to, span);
        const f = names ? { ...span, from, to, refs, names, crossing: [], inside: [] } : null;
        foundAt.set(place, f);
        if (f) found.push(f);
        tooMany = found.length > most;
      }
    }
  }
  // Too many readings for one part: it asks about its words, from the first value on, and offers none of them.
  if (tooMany) {
    const first = found[0];
    const last = words[words.length - 1];
    if (first && last) read.ties.push({ start: first.start, end: last.end, values: [], names: [] });
    return read;
  }

  // The longest name wins: a value inside a longer one is not read. Two values whose words cross are a tie. Values are
  // taken longest first, so a value is free when no value taken already holds its first or its last word: one that sat
  // between them would be shorter.
  const taker: Array<Found | undefined> = words.map(() => undefined);
  const taken: Found[] = [];
  for (const f of [...found].sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from)) {
    if (taker[f.from] !== undefined || taker[f.to - 1] !== undefined) continue;
    for (let k = f.from; k < f.to; k++) taker[k] = f;
    taken.push(f);
  }
  for (const f of found) {
    if (taker[f.from] === f) continue;
    // The values taken over its words, each found once: from one taken value's last word to the next word.
    const over: Found[] = [];
    for (let k = f.from; k < f.to; ) {
      const t = taker[k];
      if (t) over.push(t);
      k = t ? t.to : k + 1;
    }
    for (const t of over) {
      const inside = f.from >= t.from && f.to <= t.to;
      // "Darcy's accounts" may be the value Darcy's, or the accounts of the value Darcy.
      if (inside && f.from === t.from && f.to === t.to - 1 && words[t.to - 1]?.key === POSSESSIVE) t.refs.push(...f.refs);
      else if (!inside) t.crossing.push(f);
      else t.inside.push(f);
    }
  }
  /**
   * The values a longer value may list instead: "Alder and Cedar" may be that value, or the values Alder and Cedar,
   * when the grid holds all three. It is a list when two different values sit apart inside it, something joins them (a
   * word of GridCue's own, a comma, "&", "/" or "+"), and every other word is GridCue's own. A value with more than
   * `INSIDE_CHECKED` values inside it is read as a list without looking: the part then asks, as a list does.
   */
  const listedIn = (t: Found): Found[] => {
    if (t.inside.length > INSIDE_CHECKED) return t.inside;
    const apart = t.inside.some((a) => t.inside.some((b) => a.to <= b.from && !a.refs.some((r) => b.refs.some((s) => sameRef(r, s)))));
    if (!apart) return [];
    const loose = words.slice(t.from, t.to).filter((w) => !t.inside.some((f) => holds(f, w)));
    const joined = loose.length > 0 || /[,&/+]/.test(text.slice(t.start, t.end).replace(WORD, ""));
    return joined && loose.every((w) => isOwn(w.key)) ? t.inside : [];
  };

  /** The words no one-word question may offer: a value's or a tie's. A declared name's are never offered either. */
  const spoken = words.map(() => false);
  taken.sort((a, b) => a.from - b.from);
  for (const t of taken) {
    const all = [t, ...t.crossing, ...listedIn(t)];
    // Each value keeps its own words: a value picked from a tie is read there, and the tie's other words stay unread.
    const refs = distinct(
      all.flatMap((f) => f.refs.map((r) => ({ ...r, start: f.start, end: f.end }))),
      refKey,
    );
    const names = distinct(
      all.flatMap((f) => f.names),
      nameKey,
    );
    let from = t.from;
    let to = t.to;
    for (const f of all) {
      from = Math.min(from, f.from);
      to = Math.max(to, f.to);
    }
    const span = { start: words[from]?.start ?? t.start, end: words[to - 1]?.end ?? t.end };
    spoken.fill(true, from, to);
    const [only] = refs;
    if (only && refs.length === 1 && names.length === 0 && all.length === 1) read.values.push({ ...only, ...span });
    else read.ties.push({ ...span, values: refs, names });
  }

  read.values.sort((a, b) => a.start - b.start);
  read.ties.sort((a, b) => a.start - b.start);

  // One word of a value: a word of some value that is in no name above, is none of GridCue's own words, and that the
  // placed-words lists leave unplaced. A value made only of GridCue's own words is never read, so it is no choice. What
  // a word holds depends on the word alone, so it is worked out once for each distinct word of the part.
  const heldBy = new Map<string, Omit<LocalValueWord, "start" | "end"> | null>();
  const wordHeld = (key: string): Omit<LocalValueWord, "start" | "end"> | null => {
    const known = heldBy.get(key);
    if (known !== undefined) return known;
    const held = columns.flatMap((c) => {
      const term = c.index.words.get(key);
      const all = idsOf(term === undefined ? undefined : c.index.holders[term]);
      const ids = all.length > CHOICES_CHECKED ? all : all.filter((id) => !madeOfOwnWordsAt(c.index, id));
      return ids.length > 0 ? [{ columnId: c.columnId, ids, values: c.index.values }] : [];
    });
    const count = held.reduce((n, h) => n + h.ids.length, 0);
    const found =
      count === 0
        ? null
        : {
            word: key,
            count,
            columns: held.map((h) => ({ columnId: h.columnId, count: h.ids.length })),
            choices:
              count > MAX_LOCAL_VALUE_CHOICES
                ? []
                : held.flatMap((h) =>
                    h.ids.flatMap((id) => {
                      const value = h.values[id];
                      return value === undefined ? [] : [{ columnId: h.columnId, value }];
                    }),
                  ),
          };
    heldBy.set(key, found);
    return found;
  };
  words.forEach((w, k) => {
    if (!inValues[k] || spoken[k] || (namedAt[k]?.length ?? 0) > 0 || isOwn(w.key) || !leftOver(k)) return;
    const held = wordHeld(w.key);
    if (!held) return;
    read.words.push({
      start: w.start,
      end: w.end,
      ...held,
      columns: held.columns.map((c) => ({ ...c })),
      choices: held.choices.map((c) => ({ ...c })),
    });
  });
  return read;
};

/**
 * Reads every part of a request against the Local Value indexes (`readLocalValues`), and returns the parts that name
 * anything: a whole value, a tie, or one word of a value. `mentions` are the request's Mentions, and `codeRead` where
 * its other code-read filters sit (`readCodeFilters`). The Controller calls this after the provider's request is built,
 * and nothing it returns is sent anywhere (spec 4.3).
 */
export const readLocalValueParts = (
  input: NormalizedInput,
  mentions: readonly Mention[],
  codeRead: readonly CodeReadSpan[],
  schema: ViewSchema,
  columns: readonly LocalValueColumn[],
): LocalValuesPart[] => {
  if (columns.length === 0) return [];
  return input.clauses.flatMap((clause) => {
    const read = readLocalValues(
      {
        clause,
        mentions: mentions.filter((m) => m.clauseIndex === clause.index),
        codeRead: codeRead.filter((r) => r.clauseIndex === clause.index),
        schema,
      },
      columns,
    );
    return read.valueWords.length > 0 ? [{ clauseIndex: clause.index, ...read }] : [];
  });
};
