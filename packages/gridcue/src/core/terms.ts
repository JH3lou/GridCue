const PRONOUNS = new Set(["it", "this", "that", "them", "these", "those", "one", "ones"]);

/**
 * The words a column Clause names after its verb, such as "risk score" in "sort by risk score", so a
 * Clarification can say which name GridCue didn't recognise. Never matched to a column. Returns nothing
 * for a pronoun, an empty remainder, or more than four words, which are more likely a sentence than a name.
 */
export const unknownTerm = (clauseText: string): string | undefined => {
  const term = clauseText
    .replace(/^.*?\b(?:sort(?:ed)?|order(?:ed)?|group(?:ed)?|hide|show|display|filter)\b(?:\s+(?:by|on))?\s*/, "")
    .replace(/\b(?:largest|biggest|highest|smallest|lowest|newest|oldest)\b.*$|\b(?:ascending|descending|first|column|columns)\b/g, "")
    .replace(/\b(?:the|me|us)\b/g, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!term || term.split(" ").length > 4 || PRONOUNS.has(term)) return undefined;
  return term;
};

/**
 * Wording that can put the inner level first, as in "group by advisor within custodian". Code keeps the order
 * the User named unless this appears and the provider says the pair is reversed (fan-out spec, Q6).
 */
export const REVERSAL_WORDING = /\b(?:within|inside|under|nested (?:in|under|inside)|in each|for each|per)\b/;
