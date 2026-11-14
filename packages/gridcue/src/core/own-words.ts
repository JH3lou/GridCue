import { emptyWordsOutside } from "./code-read";
import { leavesRowsOut, nothingAfter } from "./lead";
import { LEAVES_OUT } from "./mentions";
import {
  comparisonSpans,
  directionSpans,
  literalText,
  normalize,
  readsOrder,
  SIZE_WORDS,
  startsInstruction,
  TEXT_MATCH_WORDS,
} from "./normalize";
import { onPlacedLists } from "./placed";
import { Density } from "./protocol";

/**
 * GridCue's own words: the words its reader gives a meaning of its own, taken from the lists the reader already holds.
 * No word is written here that a reader does not read, with one exception, the time words below, which GridCue keeps
 * before it reads them.
 *
 * Two checks use it, and neither holds a list of its own, so neither can fall behind the reader:
 * - `defineSchema` refuses a House Term named with one of these words (ADR 0024), since it would be read twice;
 * - a Local Value made only of these words is never read from the grid, and such a word is never offered as one word of
 *   a value (ADR 0025; `core/local-values.ts`).
 *
 * The root entry exports everything `core/schema.ts` exports, so this lives in a module of its own.
 */

const whole = (pattern: string) => new RegExp(`^(?:${pattern})$`, "u");
/** GridCue's own words that its reader writes as patterns: the size words, the words that leave rows out, the match words. */
const OWN_PATTERNS: readonly RegExp[] = [whole(SIZE_WORDS.source), whole(LEAVES_OUT), ...TEXT_MATCH_WORDS.map(([, words]) => whole(words))];

/** Whether `text` holds one amount and nothing but the comparison words read for it: "over 1", "1 or more". */
const onlyComparison = (text: string): boolean => {
  const { clauses } = normalize(text);
  const clause = clauses[0];
  const lit = clause?.literals[0];
  if (clauses.length !== 1 || !clause || !lit || clause.literals.length !== 1) return false;
  const read = [{ start: lit.at, end: lit.at + literalText(clause.text, lit).length }, ...comparisonSpans(clause.text, lit)];
  return clause.text.split("").every((ch, i) => /\s/.test(ch) || read.some((s) => i >= s.start && i < s.end));
};

/** The densities a view can have: "compact view" asks for one. */
const DENSITIES: ReadonlySet<string> = new Set(Density.options);
/**
 * The words for days and periods the dates of named filters' spec 5.5 read ("today", "last 90 days", "this quarter",
 * "YTD", a month's name). GridCue keeps them for itself before it reads them, so no term can be named one now and read
 * twice later.
 */
const TIME_WORDS =
  /^(?:today|yesterday|tomorrow|days?|weeks?|months?|quarters?|years?|ago|next|recent|mtd|qtd|ytd|january|february|march|april|may|june|july|august|september|october|november|december)$/u;

/**
 * Whether `words` (lower case, one space between) are one of GridCue's own words, taken from the lists its reader
 * already holds: a word the placed-words check places or a lead-in (`core/placed.ts`, `core/lead.ts`), a joining or
 * staying word ("plus", "then", "stays"), a size, age or order word or a direction, a verb that starts an instruction, a
 * density, a word for no value, a word that leaves rows out, a text match's words, a comparison, or a time word. A House
 * Term that held one would be read twice.
 */
export const ownWord = (words: string): boolean => {
  const all = (span: { start: number; end: number } | undefined) => !!span && span.start === 0 && span.end === words.length;
  return (
    onPlacedLists(words) ||
    nothingAfter(words, 0) ||
    OWN_PATTERNS.some((re) => re.test(words)) ||
    all(directionSpans(words).direction) ||
    readsOrder(words) ||
    startsInstruction(words) ||
    DENSITIES.has(words) ||
    TIME_WORDS.test(words) ||
    leavesRowsOut(`${words} rows`) ||
    emptyWordsOutside({ index: 0, text: words, literals: [] }, []).some(all) ||
    onlyComparison(`${words} 1`) ||
    onlyComparison(`1 ${words}`) ||
    onlyComparison(`${words} 1 and 2`)
  );
};
