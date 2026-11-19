import { isExposed } from "./columns";
import { type Mention, matchMentions } from "./mentions";
import type { Clause } from "./normalize";
import type { ViewOperation, ViewSchema } from "./protocol";
import { escapeRegExp } from "./text-match";
import { totalKindIssue } from "./validate";

/**
 * View words: the small, closed set of words code reads itself (ADR 0028). A Clause is read whole or not at all. One
 * word left over and it is not read, and the Clause goes to the provider exactly as it does today.
 *
 * One exception keeps a part's words together where the provider request can't split them: "pin", "unpin", "freeze",
 * a density and a total start no part (`normalize` splits a request only before its own verbs, and a new split would
 * change the request an Intent Provider is sent). So a pin, unpin, density or totals form said after "and" or a comma at
 * the end of a part is read on its own, from the joining word to the part's end ("group by advisor and pin advisor",
 * "group by advisor and total market value"). Those words are read whole too: one word left over in them and nothing is
 * read.
 */
export interface ViewWordsReading {
  /**
   * What the words ask for. The compiler uses these and ignores the provider's families for the words read. An unpin
   * that names no column ("unpin all", "unpin everything") unpins every pinned column: the compiler names them.
   */
  operations: ViewOperation[];
  /** Where the words that were read sit in the Clause's text. "Total" is a total's own word: "total", "sum", "average". */
  spans: Array<{ start: number; end: number; kind: "verb" | "column" | "count" | "density" | "position" | "total" }>;
  /**
   * Set when only the end of the Clause is read: where its joining "and" or comma starts. The words before it are the
   * provider's, as before. Left out when the whole Clause is read.
   */
  from?: number;
}

/** How a count is written: 5, 25, 1,000. Never 0, 05, 5.5 or "five". */
const NUMBER = String.raw`[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*`;

/**
 * Each count form is its whole Clause, word for word. A named group is a span of that kind; `n` is the count's number.
 * `nouns` are the form's own nouns: where a Host's declared name holds one ("Trade count"), the form is not read.
 */
const FORMS: ReadonlyArray<{ words: RegExp; nouns: readonly string[]; count: (n: string | undefined) => number | null }> = [
  // The count-clear form, in the Preview's own words: "Show every row".
  { words: /^(?<verb>show) (?<count>every row|all rows)$/d, nouns: ["row"], count: () => null },
  { words: /^(?<verb>remove) the (?<count>count)$/d, nouns: ["count"], count: () => null },
  { words: /^(?<count>no count)$/d, nouns: ["count"], count: () => null },
  // The count form, in the Preview's own words: "Show only the first 5 rows".
  {
    words: new RegExp(`^(?:(?<verb>show) )?only the (?<count>first (?<n>${NUMBER}) rows?)$`, "d"),
    nouns: ["row"],
    count: (n) => Number((n ?? "").replaceAll(",", "")),
  },
];
const SPAN_KINDS = ["verb", "count"] as const;

/**
 * The pin, unpin and density form words (spec 5.2; order plan D19). Narrow on purpose: "freeze" only with "column",
 * and no word that depends on the current density ("denser", "tighter"). A word joins only on held-out evidence.
 */
const PIN_VERBS = ["pin", "freeze"] as const;
const UNPIN_VERBS = ["unpin"] as const;
/**
 * The totals forms (spec 5.2; ADR 0030), as narrow as the pins: "total X", "sum of X", "show the total of X", "show
 * total X", "average X", "show the average of X", each with "also" before it if the User likes; "total X by Y", "sum of
 * X by Y" and "average X by Y", which group by Y too; and "remove the totals", "clear the totals", "no totals". X is a
 * column a sum or an average fits (`totalKindIssue`): a number or currency column for a sum, also a percent column for
 * an average. "Per", "mean", "avg" and "X totals" read nothing. A word joins only on held-out evidence.
 */
const TOTAL_VERBS: Readonly<Record<string, "sum" | "avg">> = { total: "sum", sum: "sum", average: "avg" };
/** "Left" and "right" pin to the start and the end, which assumes a left-to-right grid. */
const POSITIONS: Readonly<Record<string, "start" | "end">> = { start: "start", left: "start", end: "end", right: "end" };
const DENSITIES: ReadonlySet<string> = new Set(["compact", "comfortable", "spacious"]);
/** What a density word stands right before: "compact view", "spacious rows", "comfortable mode", "compact density". */
const DENSITY_NOUNS: ReadonlySet<string> = new Set(["view", "rows", "density", "mode"]);

const wordsOf = (text: string): string[] => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.replace(/(?:es|s)$/, ""));
/** A name as words, lower case, one space between: "Account #" and "account" are both "account". */
const nameKey = (text: string): string => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");

/** Every label and alias the Host declared, for columns and their values, as words. "Rows" and "row" are one word. */
const NAMES = new WeakMap<ViewSchema, string[][]>();
const declaredNames = (schema: ViewSchema): string[][] => {
  const known = NAMES.get(schema);
  if (known) return known;
  const names = schema.columns
    .flatMap((col) => [
      col.label,
      ...(col.aliases ?? []),
      ...(col.enumValues ?? []).flatMap((v) => [v.label, ...(v.aliases ?? [])]),
      ...(col.valueGroups ?? []).flatMap((g) => [g.label, ...(g.aliases ?? [])]),
    ])
    .map(wordsOf)
    .filter((words) => words.length > 0);
  NAMES.set(schema, names);
  return names;
};

/** Whether `name` is written whole, word for word, somewhere in `words`. */
const holds = (words: readonly string[], name: readonly string[]): boolean =>
  words.some((_, at) => name.every((word, i) => words[at + i] === word));

/** A totals word a column follows in "total X by Y", "sum of X by Y" or "average X by Y". */
const TOTAL_THEN_COLUMN = /(?<![\p{L}\p{N}])(?:total|average|sum of)\s+/gu;

/**
 * The part's own Mentions, with the column of a totals form said before "by" ("total market value by advisor"). The
 * Mention rules read a name right before "by" as the rows ("sort households by …"), so that column is no Mention. Here
 * it sits in the form's own column slot, right after "total", "sum of" or "average", so the same rules are run on the
 * totals word and the words after it up to "by", and a column they find filling all of those words is the form's.
 * Nothing else changes: the Mentions sent to the provider are the caller's.
 */
const ownMentions = (clause: Clause, mentions: readonly Mention[], schema: ViewSchema): Mention[] => {
  const own = mentions.filter((m) => m.clauseIndex === clause.index);
  if (!/\bby\b/.test(clause.text)) return own;
  const slots: Mention[] = [];
  // The same words are matched once.
  const matched = new Map<string, Mention | undefined>();
  const exposed = schema.columns.filter(isExposed);
  for (const word of clause.text.matchAll(TOTAL_THEN_COLUMN)) {
    const from = word.index ?? 0;
    const name = from + word[0].length;
    const by = /\s+by\b/.exec(clause.text.slice(name, name + 200));
    if (!by) continue;
    const at = name + by.index;
    if (own.some((o) => o.start < at && o.end > name)) continue;
    const text = clause.text.slice(from, at);
    if (!matched.has(text)) {
      const found = matchMentions([{ ...clause, text, literals: [] }], exposed, { rowNoun: schema.rowNoun }).find(
        (m) => m.valueId === undefined && m.start === word[0].length && m.end === text.length,
      );
      matched.set(text, found);
    }
    const found = matched.get(text);
    if (found) slots.push({ ...found, clauseIndex: clause.index, start: name, end: at });
  }
  return slots.length === 0 ? own : [...own, ...slots].sort((a, b) => a.start - b.start);
};

/** A word of the part, a column a Mention names, another Mention (never a form word), or a comma. */
type Token =
  | { kind: "word"; text: string; start: number; end: number }
  | { kind: "column"; columnId: string; doubt?: "never" | "named"; start: number; end: number }
  | { kind: "name"; start: number; end: number }
  | { kind: "comma"; start: number; end: number };
/** A word, with any apostrophes inside it, or one symbol. A symbol other than a comma is a word no form has. */
const TOKEN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;

/**
 * What a Mention is where a form takes a column (spec 4.1). Columns come only from Mentions, and a value or a left-out
 * value is never one: `undefined`. A name that may also mean the rows is a column in doubt:
 * - `"never"`: the Row Noun ("pin the account column"), the records a ranking names, or a name not written as the Host
 *   declared it ("households" names the records; "Household" is the column). Never the column.
 * - `"named"`: a yes/no column's name, which also says which rows ("pin restricted"). The column only with "column"
 *   after it ("pin the restricted holdings column").
 * The compiler asks about a column in doubt rather than leave the part to the provider, which may read the name as rows.
 */
const columnOf = (m: Mention, text: string, schema: ViewSchema): { columnId: string; doubt?: "never" | "named" } | undefined => {
  if (m.valueId !== undefined || m.negated) return undefined;
  const col = schema.columns.find((c) => c.id === m.columnId);
  if (!col) return undefined;
  const said = nameKey(text.slice(m.start, m.end));
  const noun = schema.rowNoun ? nameKey(schema.rowNoun) : undefined;
  const rows = m.records || (noun && (said === noun || said === `${noun}s` || said === `${noun}es`));
  if (rows || ![col.label, ...(col.aliases ?? [])].some((n) => nameKey(n) === said)) return { columnId: col.id, doubt: "never" };
  return col.kind === "boolean" ? { columnId: col.id, doubt: "named" } : { columnId: col.id };
};

/** The words every form here is made of, to tell a Host's name that holds one ("Pin code", "Compact"). */
const FORM_WORDS: ReadonlySet<string> = new Set([
  ...PIN_VERBS,
  ...UNPIN_VERBS,
  ...Object.keys(POSITIONS),
  ...DENSITIES,
  ...DENSITY_NOUNS,
  "use",
  "all",
  "everything",
  "column",
  "columns",
]);

/**
 * The part's words as tokens. With `raw`, a Mention that holds a form word is written out as its words, to see whether
 * the words would read as a form but for the Host's name. `undefined` when a Mention starts or ends inside a word.
 */
const tokensOf = (clause: Clause, own: readonly Mention[], schema: ViewSchema, raw: boolean) => {
  const tokens: Token[] = [];
  const spelled: Mention[] = [];
  const kept = own.flatMap((m) => {
    const said = clause.text.slice(m.start, m.end);
    if (raw && (holdsFormWord(said) || holdsTotalWord(said))) {
      spelled.push(m);
      return [];
    }
    return [{ m, column: columnOf(m, clause.text, schema) }];
  });
  let next = 0;
  for (const match of clause.text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const inside = kept.find(({ m }) => start < m.end && end > m.start);
    if (inside) {
      if (start < inside.m.start || end > inside.m.end) return undefined;
      if (inside.m.start >= next) {
        const { m, column } = inside;
        tokens.push(
          column === undefined ? { kind: "name", start: m.start, end: m.end } : { kind: "column", ...column, start: m.start, end: m.end },
        );
        next = m.end;
      }
      continue;
    }
    tokens.push(match[0] === "," ? { kind: "comma", start, end } : { kind: "word", text: match[0].toLowerCase(), start, end });
  }
  return { tokens, spelled };
};

/** A column a read form names that may mean the rows, where it sits, and the verb it is said with. */
type Doubt = { columnId: string; start: number; end: number; verb: "pin" | "unpin" };
/**
 * A total a read form asks for that doesn't fit its column's kind (ADR 0030): "total concentration", "average opened".
 * `fits` is the total that does, where one does: an average for a percent column. The form's operations hold that one.
 */
export interface TotalMisfit {
  columnId: string;
  asked: "sum" | "avg";
  fits?: "avg";
}
/**
 * A totals form said right after a clear, with no verb of its own: "remove the totals and total market value". The
 * clear's verb may take those words too, so the User may ask for no totals at all. Where they sit, and the total.
 */
type RunsOn = { start: number; end: number; fn: "sum" | "avg" };
type Read = {
  operations: ViewOperation[];
  spans: ViewWordsReading["spans"];
  end: number;
  doubts: Doubt[];
  misfits: TotalMisfit[];
  runsOn?: RunsOn;
};

/**
 * A reader of the forms in `t`: from a token, the forms joined by "and" or a comma, to the end; `undefined` unless every
 * token is read. A start that fails is remembered with every start its forms led to, since each of those fails too, so
 * looking for the end of a part reads each token once or twice, however long the part.
 */
const formsReader = (
  t: readonly Token[],
  schema: ViewSchema,
): { read: (i: number) => Read | undefined; form: (at: number) => Read | undefined } => {
  const word = (at: number) => {
    const token = t[at];
    return token?.kind === "word" ? token.text : undefined;
  };
  const span = (from: number, to: number, kind: ViewWordsReading["spans"][number]["kind"]) => ({
    start: t[from]?.start ?? 0,
    end: t[to]?.end ?? 0,
    kind,
  });
  // One column or more, each with "the" before it if the User likes, joined by "and", a comma, or both.
  const columns = (at: number, verb: Doubt["verb"]) => {
    const ids: string[] = [];
    const spans: ViewWordsReading["spans"] = [];
    const doubts: Array<Doubt & { doubt: "never" | "named" }> = [];
    let j = at;
    for (;;) {
      const k = word(j) === "the" ? j + 1 : j;
      const token = t[k];
      if (token?.kind !== "column" || ids.includes(token.columnId)) return undefined;
      ids.push(token.columnId);
      spans.push({ start: token.start, end: token.end, kind: "column" });
      if (token.doubt) doubts.push({ columnId: token.columnId, start: token.start, end: token.end, verb, doubt: token.doubt });
      j = k + 1;
      let after = t[j]?.kind === "comma" ? j + 1 : j;
      if (word(after) === "and") after += 1;
      if (after === j) break;
      const nextColumn = word(after) === "the" ? after + 1 : after;
      if (t[nextColumn]?.kind !== "column") break;
      j = after;
    }
    // "Column" after one, "columns" after two or more: "pin the household column", "pin the custodian and advisor columns".
    const noun = word(j) === "column" && ids.length === 1 ? 1 : word(j) === "columns" && ids.length > 1 ? 1 : 0;
    const named = noun === 1;
    // A yes/no column's name is the column only with "column" after it; the Row Noun never is.
    const unsure = doubts.filter((d) => d.doubt === "never" || !named).map(({ doubt: _doubt, ...d }) => d);
    return { ids, spans, end: j + noun, named, doubts: unsure };
  };
  const form = (at: number): Read | undefined => {
    const verb = word(at);
    if (verb === "pin" || verb === "freeze") {
      const list = columns(at + 1, "pin");
      // "Freeze" reads only with "column" (order plan D19): "freeze the account" may mean the records.
      if (!list || (verb === "freeze" && !list.named)) return undefined;
      const position =
        verb === "pin" && word(list.end) === "to" && word(list.end + 1) === "the" ? POSITIONS[word(list.end + 2) ?? ""] : undefined;
      return {
        operations: [{ type: "columns.pin", columnIds: list.ids, position: position ?? "start" }],
        spans: [span(at, at, "verb"), ...list.spans, ...(position ? [span(list.end, list.end + 2, "position")] : [])],
        end: position ? list.end + 3 : list.end,
        doubts: list.doubts,
        misfits: [],
      };
    }
    if (verb === "unpin") {
      const all = word(at + 1) === "everything" ? 2 : word(at + 1) === "all" ? (word(at + 2) === "columns" ? 3 : 2) : 0;
      if (all > 0) {
        return {
          operations: [{ type: "columns.pin", columnIds: [], position: "none" }],
          spans: [span(at, at, "verb"), span(at + 1, at + all - 1, "column")],
          end: at + all,
          doubts: [],
          misfits: [],
        };
      }
      const list = columns(at + 1, "unpin");
      if (!list) return undefined;
      return {
        operations: [{ type: "columns.pin", columnIds: list.ids, position: "none" }],
        spans: [span(at, at, "verb"), ...list.spans],
        end: list.end,
        doubts: list.doubts,
        misfits: [],
      };
    }
    const totals = totalsForm(at);
    if (totals) return totals;
    // "Use compact density", in the Preview's own words.
    const density = verb === "use" ? word(at + 1) : verb;
    if (density && DENSITIES.has(density)) {
      const first = verb === "use" ? at + 1 : at;
      const noun = word(first + 1);
      if (!noun || !DENSITY_NOUNS.has(noun) || (verb === "use" && noun !== "density")) return undefined;
      return {
        operations: [{ type: "density.set", density: density as "compact" | "comfortable" | "spacious" }],
        spans: [...(verb === "use" ? [span(at, at, "verb")] : []), span(first, first + 1, "density")],
        end: first + 2,
        doubts: [],
        misfits: [],
      };
    }
    return undefined;
  };
  // The column a totals form names: one column a Mention names, never one that may mean the rows.
  const columnAt = (k: number) => {
    const token = t[k];
    return token?.kind === "column" && token.doubt !== "never" ? token : undefined;
  };
  // The totals forms (spec 5.2): see TOTAL_VERBS.
  const totalsForm = (at: number): Read | undefined => {
    // "Remove the totals", "clear the totals", "no totals".
    const clearing = word(at);
    if ((clearing === "remove" || clearing === "clear") && word(at + 1) === "the" && word(at + 2) === "totals") {
      return {
        operations: [{ type: "aggregation.set", aggregations: [] }],
        spans: [span(at, at, "verb"), span(at + 2, at + 2, "total")],
        end: at + 3,
        doubts: [],
        misfits: [],
      };
    }
    if (clearing === "no" && word(at + 1) === "totals") {
      return {
        operations: [{ type: "aggregation.set", aggregations: [] }],
        spans: [span(at, at, "verb"), span(at + 1, at + 1, "total")],
        end: at + 2,
        doubts: [],
        misfits: [],
      };
    }
    // "Also" before a total: a new total is always added to the view's.
    const start = word(at) === "also" ? at + 1 : at;
    const spans: ViewWordsReading["spans"] = [];
    let k = start;
    let fn: "sum" | "avg" | undefined;
    // Whether "by Y" may follow: only "total X", "sum of X" and "average X".
    let bare = true;
    if (word(k) === "show") {
      // "Show the total of X", "show the average of X", "show total X".
      spans.push(span(k, k, "verb"));
      bare = false;
      if (word(k + 1) === "the" && (word(k + 2) === "total" || word(k + 2) === "average") && word(k + 3) === "of") {
        fn = TOTAL_VERBS[word(k + 2) ?? ""];
        spans.push(span(k + 2, k + 2, "total"));
        k += 4;
      } else if (word(k + 1) === "total") {
        fn = "sum";
        spans.push(span(k + 1, k + 1, "total"));
        k += 2;
      } else return undefined;
    } else if (word(k) === "sum" && word(k + 1) === "of") {
      fn = "sum";
      spans.push(span(k, k, "total"));
      k += 2;
    } else if (word(k) === "total" || word(k) === "average") {
      fn = TOTAL_VERBS[word(k) ?? ""];
      spans.push(span(k, k, "total"));
      k += 1;
    }
    const x = fn && columnAt(k);
    if (!fn || !x) return undefined;
    spans.push({ start: x.start, end: x.end, kind: "column" });
    k += 1;
    // "By Y": Y is the grouping, and is never X.
    let by: string | undefined;
    if (bare && word(k) === "by") {
      const y = columnAt(k + 1);
      if (!y || y.columnId === x.columnId) return undefined;
      by = y.columnId;
      spans.push({ start: y.start, end: y.end, kind: "column" });
      k += 2;
    }
    // A total that doesn't fit the column's kind is read, and marked: the compiler asks (ADR 0030).
    const col = schema.columns.find((c) => c.id === x.columnId);
    const misfit = col && totalKindIssue(col, fn) !== undefined;
    const fits = misfit && fn === "sum" && col && totalKindIssue(col, "avg") === undefined ? "avg" : undefined;
    const said = fits ?? fn;
    return {
      operations: [
        ...(by === undefined ? [] : [{ type: "group.set" as const, columnIds: [by] }]),
        { type: "aggregation.set", aggregations: [{ columnId: x.columnId, function: said }] },
      ],
      spans,
      end: k,
      doubts: [],
      misfits: misfit ? [{ columnId: x.columnId, asked: fn, ...(fits ? { fits } : {}) }] : [],
    };
  };
  const fails = new Set<number>();
  const read = (i: number) => {
    const read: Read = { operations: [], spans: [], end: i, doubts: [], misfits: [] };
    const starts: number[] = [];
    let cleared = false;
    for (let at = i; !fails.has(at); ) {
      starts.push(at);
      const one = form(at);
      if (!one) break;
      // A clear's verb ("remove", "clear", "no") may take the totals form after it too, unless that form says its own
      // verb ("show the total of X").
      const added = one.operations.find((op) => op.type === "aggregation.set" && op.aggregations.length > 0);
      if (cleared && !read.runsOn && added?.type === "aggregation.set" && one.spans[0]?.kind !== "verb") {
        const fn = one.misfits[0]?.asked ?? (added.aggregations[0]?.function === "avg" ? "avg" : "sum");
        read.runsOn = { start: t[at]?.start ?? 0, end: t[one.end - 1]?.end ?? 0, fn };
      }
      cleared = one.operations.length === 1 && one.operations[0]?.type === "aggregation.set" && one.operations[0].aggregations.length === 0;
      read.operations.push(...one.operations);
      read.spans.push(...one.spans);
      read.doubts.push(...one.doubts);
      read.misfits.push(...one.misfits);
      read.end = one.end;
      if (one.end === t.length) return read;
      let j = t[one.end]?.kind === "comma" ? one.end + 1 : one.end;
      if (word(j) === "and") j += 1;
      if (j === one.end) break;
      at = j;
    }
    for (const start of starts) fails.add(start);
    return undefined;
  };
  return { read, form };
};

/**
 * The pin, unpin, density and totals forms in a part: the whole part, or failing that its end after "and" or a comma. With
 * the start of the read words, and whether a Host's declared name is written whole among them.
 */
const readPinsAndDensity = (tokens: readonly Token[], clause: Clause, schema: ViewSchema) => {
  const isAnd = (token: Token | undefined) => token?.kind === "word" && token.text === "and";
  const readForms = formsReader(tokens, schema).read;
  // The end of a part is read from the first joining word after which the rest reads whole.
  const after = (k: number) => readForms(tokens[k]?.kind === "comma" && isAnd(tokens[k + 1]) ? k + 2 : k + 1);
  let read = readForms(0);
  let from = 0;
  for (let k = 1; !read && k < tokens.length; k++) {
    const token = tokens[k];
    if (token?.kind !== "comma" && !isAnd(token)) continue;
    read = after(k);
    if (read) from = token?.start ?? 0;
  }
  if (!read) return undefined;
  // A declared name written whole among the form's words is the Host's first, whatever the Mention rules made of it.
  // The columns the form names are the Host's names in their place, so the words between them are looked in.
  const names = declaredNames(schema);
  const columns = tokens.filter((t) => t.kind === "column" && t.start >= from);
  const between = [...columns.map((t) => t.start), clause.text.length].map((end, i) =>
    clause.text.slice(i === 0 ? from : (columns[i - 1]?.end ?? from), end),
  );
  const named = between.some((text) => {
    const words = wordsOf(text);
    return names.some((name) => holds(words, name));
  });
  return { read, from, named };
};

/**
 * Reads a Clause's words against the closed forms (spec 4.1, ADR 0028). Returns `undefined` unless every word is a form
 * word, a column a Mention names where a form takes one, or a filler word the form allows: then the Clause is left to
 * the provider. The Host's names come first, so a form is not read when
 * - the Clause holds a Mention where a form takes none (a count form names no column; a value is never a column),
 * - one of the Host's declared names is written whole in the form's words ("Count", "Rows", "Compact"), whatever the
 *   Mention rules made of it, or
 * - a count form's own noun is a word of one of the Host's names ("remove the count" beside a "Trade count" column).
 *
 * The pin, unpin, density and totals forms may also be read at the end of a part, after "and" or a comma; `from` then says
 * where. The reading is returned, never stored on the Clause: the provider request is built from the Clause, and it
 * must not change.
 */
export const readViewWords = (clause: Clause, mentions: readonly Mention[], schema: ViewSchema): ViewWordsReading | undefined => {
  // What a clear says to keep, and a part that continues a sort or grouping, are read by their own rules.
  if (clause.keeps || clause.continues) return undefined;
  const own = ownMentions(clause, mentions, schema);
  if (own.length === 0) {
    for (const form of FORMS) {
      const match = form.words.exec(clause.text);
      if (!match) continue;
      const words = wordsOf(clause.text);
      if (declaredNames(schema).some((name) => holds(words, name) || name.some((word) => form.nouns.includes(word)))) return undefined;
      const count = form.count(match.groups?.n);
      if (count !== null && !Number.isSafeInteger(count)) return undefined;
      const spans = SPAN_KINDS.flatMap((kind) => {
        const at = match.indices?.groups?.[kind];
        return at ? [{ start: at[0], end: at[1], kind }] : [];
      });
      return { operations: [{ type: "limit.set", count }], spans };
    }
  }
  const tokens = tokensOf(clause, own, schema, false)?.tokens;
  const found = tokens && readPinsAndDensity(tokens, clause, schema);
  if (!found || found.named || found.read.doubts.length > 0 || found.read.misfits.length > 0 || found.read.runsOn) return undefined;
  return { operations: found.read.operations, spans: found.read.spans, ...(found.from > 0 ? { from: found.from } : {}) };
};

/**
 * A part whose words read as forms but for a total that doesn't fit its column's kind (ADR 0030): "total
 * concentration", "average opened by advisor". With the first such total, where the words start (0 for the whole
 * part), and the reading with the total that fits in its place, where one fits. `undefined` when no form is read, or
 * every total fits. The compiler asks, and never reads such words another way.
 */
export const totalsMisfit = (
  clause: Clause,
  mentions: readonly Mention[],
  schema: ViewSchema,
): { misfit: TotalMisfit; from: number; reading: ViewWordsReading } | undefined => {
  if (clause.keeps || clause.continues) return undefined;
  const own = ownMentions(clause, mentions, schema);
  const tokens = tokensOf(clause, own, schema, false)?.tokens;
  const found = tokens && readPinsAndDensity(tokens, clause, schema);
  const misfit = found?.read.misfits[0];
  if (!found || !misfit || found.named || found.read.doubts.length > 0 || found.read.runsOn) return undefined;
  return {
    misfit,
    from: found.from,
    reading: { operations: found.read.operations, spans: found.read.spans, ...(found.from > 0 ? { from: found.from } : {}) },
  };
};

/** The words a form was read from, without the joining "and" or comma before them. */
const saidFrom = (clause: Clause, from: number) => clause.text.slice(from).replace(/^\s*,?\s*(?:and\s+)?/, "");

/**
 * The question for a part whose words would read as a pin, unpin or density form but for one of the Host's names
 * (spec 5.2), with where those words start (0 for the whole part). `undefined` when no form is in the words, or one
 * reads. Code can't tell what such words ask for, and the provider may read the name another way, so the part asks:
 * - a name that holds a form word ("compact view" where "Compact" is a size class the Host declared): the words may
 *   ask for the density or name the Host's value. `named` is the change they would ask for: on a grid that doesn't
 *   list it, the words can only be the Host's name, and the caller reads the part as before;
 * - a column that may mean the rows: the Row Noun ("freeze the account column"), a name the Host didn't write that way
 *   ("pin households"), or a yes/no column's name without "column" after it ("pin restricted");
 * - a totals form said right after a clear, with no verb of its own: "remove the totals and total market value" may
 *   remove that total too. `named` is `aggregation.set`.
 */
export const viewWordsQuestion = (
  clause: Clause,
  mentions: readonly Mention[],
  schema: ViewSchema,
): { prompt: string; from: number; named?: "columns.pin" | "density.set" | "aggregation.set" } | undefined => {
  if (clause.keeps || clause.continues) return undefined;
  const own = ownMentions(clause, mentions, schema);
  const plain = tokensOf(clause, own, schema, false);
  const read = plain && readPinsAndDensity(plain.tokens, clause, schema);
  const doubt = read && !read.named ? read.read.doubts[0] : undefined;
  const runsOn = read && !read.named ? read.read.runsOn : undefined;
  if (read && !read.named && !doubt && !runsOn) return undefined;
  if (read && doubt) {
    return { prompt: rowsOrColumn(clause.text.slice(doubt.start, doubt.end), doubt.columnId, doubt.verb, schema), from: read.from };
  }
  // On a grid that doesn't list totals, the request ends in "This grid can't show totals." instead.
  if (read && runsOn) {
    return { prompt: removesToo(clause.text.slice(runsOn.start, runsOn.end), runsOn.fn), from: read.from, named: "aggregation.set" };
  }
  // Read again with the Host's names that hold a form word written out as words. A declared name with no Mention is
  // already words here.
  const raw = tokensOf(clause, own, schema, true);
  const spelled = raw && readPinsAndDensity(raw.tokens, clause, schema);
  if (!raw || !spelled) return undefined;
  const mention = raw.spelled.find((m) => m.start >= spelled.from);
  const words = wordsOf(clause.text.slice(spelled.from));
  const name = mention ? clause.text.slice(mention.start, mention.end) : declaredNamesWritten(schema).find((n) => holds(words, wordsOf(n)));
  if (!name || (!mention && !spelled.named)) return undefined;
  const ops = spelled.read.operations;
  const type = ops.some((op) => op.type === "aggregation.set") ? "aggregation.set" : ops[0]?.type;
  return {
    prompt: nameQuestion(name, saidFrom(clause, spelled.from)),
    from: spelled.from,
    ...(type === "columns.pin" || type === "density.set" || type === "aggregation.set" ? { named: type } : {}),
  };
};

/**
 * The question for a total said after a clear, with no verb of its own: "remove the totals and total market value"
 * may remove that total too. `said` is the total's words.
 */
export const removesToo = (said: string, fn: "sum" | "avg"): string =>
  `GridCue can't tell whether “${said}” is one more thing to remove. To show the ${fn === "avg" ? "average" : "total"}, ask for it on its own.`;

/** The question for words that would read as a form but for `name`, one of the Host's names. */
export const nameQuestion = (name: string, said: string): string =>
  `“${name}” is a name in this grid, so GridCue can't tell what “${said}” asks for. Try rephrasing that part.`;

const labelOf = (columnId: string, schema: ViewSchema) => schema.columns.find((c) => c.id === columnId)?.label ?? columnId;

/** The question for a column a pin or unpin form names that may mean the rows. */
const rowsOrColumn = (said: string, columnId: string, verb: Doubt["verb"], schema: ViewSchema): string => {
  const label = labelOf(columnId, schema);
  return `GridCue can't tell whether “${said}” means the ${label} column or the rows. To ${verb} the column, say “${verb} the ${label} column”.`;
};

/**
 * The question for a pin or unpin list that may run on into the next part (spec 5.2). A request is split before a word
 * that starts an instruction, and a column's name may start with one: "pin rate and cleared" is "pin rate" and
 * "cleared" ("clear"), and "pin customer and order date" is "pin customer" and "order date". Where the next part starts
 * with a column a Mention names, that column may be one more in the list, or say which rows or another change. Code
 * can't tell, so the part asks rather than read the list without it. `undefined` when the reading doesn't end in a list
 * of columns, or the next part doesn't start with a column.
 */
export const pinListRunsOn = (
  reading: ViewWordsReading,
  next: Clause | undefined,
  mentions: readonly Mention[],
  schema: ViewSchema,
): string | undefined => {
  const last = reading.operations.at(-1);
  if (!next || last?.type !== "columns.pin" || last.columnIds.length === 0) return undefined;
  const first = mentions.find((m) => m.clauseIndex === next.index && m.start === 0);
  const column = first && columnOf(first, next.text, schema);
  if (!first || !column) return undefined;
  const verb = last.position === "none" ? "unpin" : "pin";
  const said = next.text.slice(first.start, first.end);
  if (column.doubt) return rowsOrColumn(said, column.columnId, verb, schema);
  const label = labelOf(column.columnId, schema);
  return `GridCue can't tell whether “${said}” is one more column to ${verb}. To ${verb} it, say “${verb} the ${label} column”.`;
};

const holdsFormWord = (text: string): boolean => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).some((w) => FORM_WORDS.has(w));
/** Whether a name holds a word that may ask for a total ("Total", "Sum insured", "Average cost"). */
const holdsTotalWord = (text: string): boolean => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).some((w) => TOTAL_WORD.test(w));
/** Whether a name is made of words that may ask for a total only ("Total", "Totals", "Sum"). */
const madeOfTotalWords = (text: string): boolean => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).every((w) => TOTAL_WORD.test(w));

/**
 * The first word of `name` that a pin, unpin or density form reads ("Unpin", "End", "Mode", "Use"), if any. A House
 * Term named with one would be read twice: as the term, and as the form's word, which the forms read whatever the
 * Host's terms are (`defineSchema` refuses it, ADR 0024).
 */
export const formWordIn = (name: string): string | undefined =>
  (name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).find((w) => FORM_WORDS.has(w));

/** Words built on "pin" or "freeze": "pin", "pins", "pinned", "unpin", "repinning", "freeze", "frozen", "unfreeze". */
const PIN_WORD = /^(?:un|re)?(?:pin(?:s|ned|ning)?|freez(?:e|es|ing)|froze|frozen)$/u;
/**
 * The densities, "density" and "dense", and the words for a density that depends on the current one ("denser",
 * "tighter"), which no form reads (order plan, D19).
 */
const DENSITY_WORD = /^(?:compact|comfortable|spacious|dens(?:e|er|est|ity|ities)|tighter)$/u;
/**
 * The words that may ask for a total (spec 5.2): "total", "totals", "totalled", "subtotal", "sum", "summed", "average",
 * "averages", "avg". "Mean" is left out: it is also the verb ("I mean"). So is "average" after a comparison word
 * ("entries above average"): it is a level to compare with, and can't ask for a total.
 */
const TOTAL_WORD = /^(?:(?:sub)?totals?|total(?:l?ed|l?ing)|sums?|summ(?:ed|ing)|averag(?:e|es|ed|ing)|avgs?)$/u;
/**
 * A comparison word right before "average" makes it a level to compare with, not a total: "above average",
 * "above-average".
 */
const COMPARED_WITH = /(?<![\p{L}\p{N}])(?:above|below|over|under|than|versus|vs\.?)(?:\s+|\s*-\s*)(?:the\s+)?$/iu;

/** A pin, density or totals word in a part that no read form used. */
export interface ViewWordLeft {
  /** Where the word sits in the Clause's text. */
  start: number;
  end: number;
  /** The words as said: the whole form where one starts at this word ("compact view", "pin market value"), else the word. */
  text: string;
  /**
   * What a form that starts at this word asks for, read on its own ("compact view" in "compact view of taxable
   * accounts"). A column in doubt still counts: "pin restricted" asks to pin, whichever column it means. Left out when no
   * form starts here ("pinned", "denser", "freeze advisor"). A totals form is `aggregation.set`, with a grouping or not,
   * and so is a total that doesn't fit its column ("total concentration").
   */
  form?: "columns.pin" | "density.set" | "aggregation.set";
  /**
   * Set for a word that may ask for a total ("total", "sum", "average"), with a form or not. Such a word inside one of
   * the Host's names ("Total return") or quoted text is not one: it is the name's, and the part reads as before.
   */
  total?: true;
  /**
   * The Host's name the word sits in, where that name written out as words starts a form here ("compact view" where
   * "Compact" is a size class). The words may ask for the form or name the Host's value, so the part asks, as it does
   * when they make up the whole part or its end. Such a word has no `form`: it may not ask for one.
   */
  name?: string;
  /** With `name`: the change the words would ask for if they were the form. */
  named?: "columns.pin" | "density.set" | "aggregation.set";
  /**
   * With `name`: the name is made of totals words only ("Total", "Sum"), and no form starts at it. On a grid that shows
   * totals it may name the column or ask for a total where the plan shows totals or its part groups, and asks there.
   * Left out when a column a total fits is named right after it ("total units"): those words ask wherever they are.
   */
  whole?: true;
}

/**
 * The words built on "pin", "freeze" or a density in a part, before `upTo`, that are not inside one of the Host's
 * names (spec 5.2). The compiler passes where the words a form read start, so these are the words no form used. Each
 * says whether a pin, unpin or density form starts at it. Code read only a form that makes up the whole part, or its
 * end, so such a word elsewhere would be dropped from a ready plan: "compact view, top 10 by market value" sorted and
 * counted and left the density out. The compiler asks instead. A word in one of the Host's names is the name's, unless
 * the name written out as words starts a form there (`name`).
 */
export const viewWordsLeft = (clause: Clause, mentions: readonly Mention[], schema: ViewSchema, upTo: number): ViewWordLeft[] => {
  if (upTo <= 0) return [];
  const own = ownMentions(clause, mentions, schema);
  const tokens = tokensOf(clause, own, schema, false)?.tokens;
  const reader = tokens && formsReader(tokens, schema);
  const tokenAt = new Map((tokens ?? []).map((t, i) => [t.start, i]));
  // The part again with the Host's names that hold a form word written out as words, read only when a word sits in one.
  let spelled: { tokens: Token[]; form: (at: number) => Read | undefined; at: Map<number, number> } | null | undefined;
  const spelledOut = () => {
    if (spelled === undefined) {
      const raw = tokensOf(clause, own, schema, true)?.tokens;
      spelled = raw ? { tokens: raw, form: formsReader(raw, schema).form, at: new Map(raw.map((t, i) => [t.start, i])) } : null;
    }
    return spelled;
  };
  // Where the Host's names that hold a totals word are written whole in the part, found only when a word needs them.
  let declared: Array<{ start: number; end: number }> | undefined;
  const namedAt = (start: number, end: number) => {
    // A name made of totals words only ("Total") that no Mention placed is a totals word like any other here.
    declared ??= declaredNamesWritten(schema)
      .filter((n) => holdsTotalWord(n) && !madeOfTotalWords(n))
      .flatMap((n) => [...clause.text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(n.toLowerCase())}(?![\\p{L}\\p{N}])`, "giu"))])
      .map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
    return declared.find((d) => start >= d.start && end <= d.end);
  };
  const left: ViewWordLeft[] = [];
  for (const match of clause.text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start >= upTo) break;
    const word = match[0].toLowerCase();
    const total = TOTAL_WORD.test(word) && !(word.startsWith("averag") && COMPARED_WITH.test(clause.text.slice(0, start)));
    if (!PIN_WORD.test(word) && !DENSITY_WORD.test(word) && !total) continue;
    const name = own.find((m) => start < m.end && end > m.start);
    // A totals word in one of the Host's names is the name's: "sort by total return", "hide average cost", and "average
    // cost by holder", where the Mention rules read the name before "by" as the rows. Two exceptions, on a grid that
    // shows totals (the compiler checks the grid): the name written out as words starts a totals form here ("total
    // amount" where the Host aliased Amount "total"), or the name is made of totals words only ("totals", "sum").
    const inName = total ? (name ?? namedAt(start, end)) : undefined;
    if (inName) {
      const said = clause.text.slice(inName.start, inName.end);
      const raw = name ? spelledOut() : undefined;
      const at = name ? raw?.at.get(start) : tokenAt.get(start);
      const read = at === undefined ? undefined : name ? raw?.form(at) : reader?.form(at);
      const last = read?.operations.some((op) => op.type === "aggregation.set") ? (name ? raw?.tokens : tokens)?.[read.end - 1] : undefined;
      const whole = madeOfTotalWords(said);
      // A name made of totals words only, with another column a total fits named right after it ("total units", "sum
      // of units"), is a totals form spelled out, wherever its part is. The Mention rules read a name right after
      // another as the rows, so that column is no Mention, and no form read it.
      const then = !last && whole && name ? totalledAfter(clause.text, inName.end, name.columnId, schema) : undefined;
      if (last || whole) {
        const to = last?.end ?? then;
        left.push({
          start,
          end,
          text: to === undefined ? match[0] : clause.text.slice(start, to),
          name: said,
          named: "aggregation.set",
          ...(to === undefined ? { whole: true as const } : {}),
        });
      }
      continue;
    }
    if (name) {
      // A word of the Host's name is the name's, unless the name written out as words starts a form here: then the
      // words may ask for the form or name the Host's value, wherever they sit in the part. "Rows" is the records' own
      // word, so a value before it says which rows ("hide the compact rows"), as before the Row Noun. Those words may be
      // the density form only where nothing before them takes them: at the start of the part, or after "and", "then"
      // or a comma.
      const raw = spelledOut();
      const at = raw?.at.get(start);
      const read = at === undefined ? undefined : raw?.form(at);
      const last = read && raw?.tokens[read.end - 1];
      const before = at === undefined ? undefined : raw?.tokens[at - 1];
      const rows = last?.kind === "word" && last.text === "rows";
      const joins = before?.kind === "comma" || (before?.kind === "word" && (before.text === "and" || before.text === "then"));
      const taken = before !== undefined && !joins;
      const type = read?.operations[0]?.type;
      if (last && !(rows && taken)) {
        left.push({
          start,
          end,
          text: clause.text.slice(start, last.end),
          name: clause.text.slice(name.start, name.end),
          ...(type === "columns.pin" || type === "density.set" ? { named: type } : {}),
        });
      }
      continue;
    }
    const at = tokenAt.get(start);
    const read = at === undefined ? undefined : reader?.form(at);
    const last = read && tokens?.[read.end - 1];
    const type = read?.operations.some((op) => op.type === "aggregation.set") ? "aggregation.set" : read?.operations[0]?.type;
    left.push({
      start,
      end,
      text: last ? clause.text.slice(start, last.end) : match[0],
      ...(type === "columns.pin" || type === "density.set" || type === "aggregation.set" ? { form: type } : {}),
      ...(total ? { total: true as const } : {}),
    });
  }
  return left;
};

/**
 * Where a column's name ends that is written right after `at`, with "of" and "the" before it if the User likes, for
 * a column other than `own` that a total fits (a number, currency or percent column). The longest name wins.
 */
const totalledAfter = (text: string, at: number, own: string, schema: ViewSchema): number | undefined => {
  const lead = /^\s+(?:of\s+)?(?:the\s+)?/.exec(text.slice(at));
  if (!lead) return undefined;
  const from = at + lead[0].length;
  const rest = text.slice(from).toLowerCase();
  let end: number | undefined;
  for (const col of schema.columns) {
    if (col.id === own || !isExposed(col) || totalKindIssue(col, "avg") !== undefined) continue;
    for (const n of [col.label, ...(col.aliases ?? [])]) {
      const key = n.toLowerCase();
      if (!key || !rest.startsWith(key) || /^[\p{L}\p{N}]/u.test(rest.slice(key.length))) continue;
      if (end === undefined || from + key.length > end) end = from + key.length;
    }
  }
  return end;
};

/** Every label and alias the Host declared, as written. */
const declaredNamesWritten = (schema: ViewSchema): string[] =>
  schema.columns.flatMap((col) => [
    col.label,
    ...(col.aliases ?? []),
    ...(col.enumValues ?? []).flatMap((v) => [v.label, ...(v.aliases ?? [])]),
    ...(col.valueGroups ?? []).flatMap((g) => [g.label, ...(g.aliases ?? [])]),
  ]);

/**
 * "Show all accounts", "show every account": the count-clear words with the Row Noun where "rows" would be. This is
 * never the count-clear form (spec 5.2). On a view with filters it may ask for the rows they leave out too, so the
 * compiler asks. The Row Noun may be a Mention here ("account" is often a column's alias too); nothing else may be.
 */
export const namesEveryRow = (clause: Clause, mentions: readonly Mention[], schema: ViewSchema): boolean => {
  const noun = schema.rowNoun?.toLowerCase();
  if (!noun || clause.keeps || clause.continues) return false;
  const lead = /^show (?:every|all) /.exec(clause.text);
  if (!lead) return false;
  const rows = clause.text.slice(lead[0].length);
  if (rows !== noun && rows !== `${noun}s` && rows !== `${noun}es`) return false;
  return mentions.every((m) => m.clauseIndex !== clause.index || (m.valueId === undefined && m.start >= lead[0].length));
};
