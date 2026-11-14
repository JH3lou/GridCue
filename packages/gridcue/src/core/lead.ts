/**
 * How a part starts. Code reads a part as a view request only when the words in its verb position are ones it knows;
 * an unknown word that goes on to act on something ("close all trusts", "mark the taxable accounts", "set custodian
 * to Northgate") is not a view request, so no filter is read from it.
 */

/** Polite or conversational words before the verb: "can you", "please", "show me". */
export const LEAD_IN =
  /^(?:(?:please|pls|now|then|also|and|so|ok|okay|hey|can you|could you|would you|will you|i want(?: to see)?|i'd like(?: to see)?|i need(?: to see)?|i only want|let me see|let's see|show me|give me|get me|find me|just|only)\b ?)*/;

/** Words known in the verb position: view verbs, articles and quantifiers, prepositions, comparisons, size words. */
const KNOWN_FIRST =
  /^(?:show|display|list|view|see|look|find|get|give|filter|filtered|keep|only|just|include|exclude|excluding|hide|unhide|remove|clear|reset|undo|drop|sort|sorted|order|ordered|rank|ranked|group|grouped|ungroup|where|with|without|having|which|what|who|whose|the|a|an|all|any|every|each|my|our|those|these|that|this|some|top|bottom|largest|biggest|smallest|highest|lowest|most|least|first|last|non|not|no|over|under|above|below|between|from|at|in|for|by|on|of|more|less|greater|fewer|than|exactly|equal|rows?|records?|ones?|columns?|everything|anything|nothing|then|is|are)\b/;
/** Verbs GridCue reads only for columns. */
const COLUMN_VERB = /^(?:add|put|move|pin|arrange|bring|place|shift)\b/;
const DETERMINER = /^(?:the|a|an|all|every|each|my|our|this|that|these|those|some|any|new|both)\b/;

/**
 * Whether a part reads as a view request. `starts` holds where names and amounts begin in the part. An unknown first
 * word followed by a preposition or comparison names something ("clients with more than $5m"); followed by an
 * article, a name, or another unknown word, it acts on something.
 */
export const viewRequest = (
  text: string,
  starts: ReadonlySet<number>,
  rowNoun: string | undefined,
  columnStarts: ReadonlySet<number> = new Set(),
  names: readonly string[] = [],
): boolean => {
  const lead = LEAD_IN.exec(text)?.[0].length ?? 0;
  const first = text.slice(lead);
  if (!first || starts.has(lead) || /^["$\d(-]/.test(first) || KNOWN_FIRST.test(first)) return true;
  // A verb GridCue knows only for columns is a view request only when its object is columns: "add the custodian
  // column", "add concentration as a second sort". On rows ("add the Roth accounts to …") it acts on records.
  const verb = COLUMN_VERB.exec(first);
  if (verb) {
    const object = lead + verb[0].length + (/^ (?:the )?/.exec(first.slice(verb[0].length))?.[0].length ?? 0);
    return columnStarts.has(object) || (/\bcolumns?\b/.test(first) && !starts.has(object));
  }
  // The start of a declared name GridCue didn't match whole ("available cash < 0" for "Available Cash $") is a
  // name, so the specific question about it stays.
  if (names.some((n) => / /.test(n) && first.startsWith(n.split(" ").slice(0, 2).join(" ")))) return true;
  const word = /^[\p{L}']+/u.exec(first)?.[0] ?? "";
  const noun = rowNoun?.toLowerCase();
  if (!word || (noun && (word === noun || word === `${noun}s`))) return true;
  const nextAt = lead + word.length + 1;
  const next = text.slice(nextAt);
  if (!next.trim() || !/^ /.test(text.slice(lead + word.length))) return true;
  if (DETERMINER.test(next) || starts.has(nextAt)) return false;
  return KNOWN_FIRST.test(next);
};

const CLEAR_HEAD = /\b(clear|remove|drop|reset|undo|ungroup|unsort)\b/g;
const OBJECT =
  /(?:\s+(?:the|my|all|every|any|current|of the))*\s+(filters?|filtering|sorts?|sorting|ordering|grouping|groups?|view|everything)\b/y;
const JOIN = /\s*(,\s*and|,|and)(?=\s)/y;
const STAYS = /^\s*(?:stays?|remains?|as is|alone|unchanged|untouched|intact)\b/;
const LAYOUT_OF: Record<string, string> = {
  filter: "filter",
  filters: "filter",
  filtering: "filter",
  sort: "sort",
  sorts: "sort",
  sorting: "sort",
  ordering: "sort",
  grouping: "group",
  group: "group",
  groups: "group",
  view: "view",
  everything: "view",
};
/**
 * The layout things a part's clear verbs govern: the object right after the verb, a list joined by "and" ("clear the
 * sort and the grouping"), or the verb's own target ("ungroup"). Another layout word ("ungroup, don't touch the sort",
 * "clear the sort, the grouping stays") is not governed. `hasClearVerb` says whether the part has any clear verb.
 * `text` should have names and quoted text blanked.
 */
export const governedClears = (text: string): { governed: Set<string>; hasClearVerb: boolean; ungoverned: boolean } => {
  const governed = new Set<string>();
  const accounted = new Set<number>();
  let hasClearVerb = false;
  for (const m of text.matchAll(CLEAR_HEAD)) {
    hasClearVerb = true;
    const verb = m[1];
    if (verb === "ungroup") governed.add("group");
    if (verb === "unsort") governed.add("sort");
    if (verb === "ungroup" || verb === "unsort") continue;
    let at = (m.index ?? 0) + m[0].length;
    const items: Array<{ thing: string; joinedBy: string; end: number }> = [];
    let joinedBy = "";
    for (;;) {
      OBJECT.lastIndex = at;
      const object = OBJECT.exec(text);
      if (!object) break;
      items.push({ thing: LAYOUT_OF[object[1] ?? ""] ?? "", joinedBy, end: OBJECT.lastIndex });
      accounted.add(OBJECT.lastIndex);
      at = OBJECT.lastIndex;
      JOIN.lastIndex = at;
      const join = JOIN.exec(text);
      if (!join) break;
      joinedBy = join[1] ?? "";
      at = JOIN.lastIndex;
    }
    // A list of layout words right after the verb, joined by commas or "and", is governed. One named only to say it
    // stays ("the grouping stays", "the filter alone") is not.
    const kept = items.filter((item) => !STAYS.test(text.slice(item.end)));
    for (const item of kept) if (item.thing) governed.add(item.thing);
    // "Reset", "reset all", "reset to default", "reset back to normal": the whole view.
    if (verb === "reset" && items.length === 0 && RESET_ALONE.test(text.slice((m.index ?? 0) + m[0].length))) governed.add("view");
  }
  // Any other layout word must be marked as staying ("don't touch the sort", "leave the grouping as is"); one that is
  // neither governed nor staying is unclear, so the caller asks.
  let ungoverned = false;
  if (hasClearVerb) {
    for (const w of text.matchAll(LAYOUT_WORD)) {
      const end = (w.index ?? 0) + w[0].length;
      if (accounted.has(end) || STAYS.test(text.slice(end))) continue;
      const before = text.slice(0, w.index);
      // Marked as staying, or trailing alone after a comma ("ungroup the rows, sorting"), which round 5b reads as staying.
      const segment = before.slice(before.lastIndexOf(",") + 1);
      if (STAYING_BEFORE.test(segment) || (before.includes(",") && /^\s*(?:the\s+)?$/.test(segment))) continue;
      ungoverned = true;
    }
  }
  return { governed, hasClearVerb, ungoverned };
};
const RESET_ALONE = /^\s*(?:all\s*|(?:back\s+)?to\s+(?:the\s+)?(?:defaults?(?:\s+view)?|normal|original)\s*)?[.!]?\s*$/;
const LAYOUT_WORD = /\b(?:filters?|filtering|sorts?|sorting|ordering|grouping|groups?)\b/g;
/** Words that mark what follows them, up to the next comma, as staying. */
const STAYING_BEFORE =
  /\b(?:don't touch|do not touch|not|without changing|without touching|leave|leaving|keep|keeping|except|apart from|other than)\b/;
/** "The", "my current" and the like, between a staying word and the word it governs. */
const ARTICLES = String.raw`\s+(?:(?:the|my|this|that|its|their|our|your|any|current|existing)\s+)*$`;
/**
 * A word right before a word that says it stays, with only "the" and the like between: "keep the", "leave my current",
 * "don't change the", "retain". Further back it may govern another word: "keep the sort and add the grouping".
 */
const KEPT_JUST_BEFORE = new RegExp(
  String.raw`\b(?:(?:don't|dont|do not) (?:touch|change)|no changes? to|without changing|without touching|leave|leaving|keep|keeping|retain|retaining|preserve|preserving|maintain|maintaining)${ARTICLES}`,
);
/**
 * A word right before a word that leaves it out: "not", "without", "w/o", "everything but the", "excluding". Words that
 * may mean dropping it ("ignore", "forget") are not here, so they ask.
 */
const LEFT_OUT_JUST_BEFORE = new RegExp(
  String.raw`(?:\b(?:not|no|without|except|excluding|apart from|other than|(?:all|everything|anything) but)|\bw\/o)${ARTICLES}`,
);
/**
 * Whether the word at `start` to `end` of `text` is said to stay (`"kept"`: "the group stays", "keep the grouping",
 * "leave the groups alone", "don't change the grouping") or not asked for (`"left out"`: "without grouping",
 * "everything but the grouping").
 */
export const saidToStay = (text: string, start: number, end: number): "kept" | "left out" | undefined => {
  if (STAYS.test(text.slice(end)) || KEPT_JUST_BEFORE.test(text.slice(0, start))) return "kept";
  return LEFT_OUT_JUST_BEFORE.test(text.slice(0, start)) ? "left out" : undefined;
};
/** After a word and any staying phrase, only punctuation and joining words to the end: "stays.", "as is, and". */
const NOTHING_AFTER =
  /^(?:\s*(?:stays?|remains?|as is|alone|unchanged|untouched|intact)\b)?(?:[\s\p{P}]|(?:and|but|or|then|also|plus)\b)*$/u;
/**
 * Whether nothing follows the word ending at `end` in its part but a staying phrase, punctuation or a joining word:
 * true for "the grouping stays" and "keep the grouping, and", false for "the grouping stays on advisor".
 */
export const nothingAfter = (text: string, end: number): boolean => NOTHING_AFTER.test(text.slice(end));

/** A part that leaves rows out: "hide taxable accounts", "can you exclude accounts over $1m". */
const EXCLUDE =
  /^(?:(?:don't|dont|do not|never|no longer) (?:show|include|display|list|see)(?: me)?|hide|exclude|remove|drop|not|no(?! (?:more|less|greater|fewer|higher|lower|larger|smaller|bigger|over|under|above|below)\b)|without|filter out)\b/;
export const leavesRowsOut = (text: string): boolean => EXCLUDE.test(text.slice(LEAD_IN.exec(text)?.[0].length ?? 0));
/** The words after a leave-rows-out lead, or `undefined` when the part has none. */
export const afterExclusionLead = (text: string): string | undefined => {
  const rest = text.slice(LEAD_IN.exec(text)?.[0].length ?? 0);
  const lead = EXCLUDE.exec(rest);
  return lead ? rest.slice(lead[0].length) : undefined;
};
