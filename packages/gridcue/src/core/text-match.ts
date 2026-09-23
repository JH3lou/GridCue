export interface TextMatch<T> {
  item: T;
  start: number;
  end: number;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds whole-word mentions of any name (optionally plural) in `text`.
 * Longer matches win over shorter overlapping ones, so "account number" beats "account".
 */
export const findMentions = <T>(text: string, entries: ReadonlyArray<{ item: T; names: readonly string[] }>): TextMatch<T>[] => {
  const hits: TextMatch<T>[] = [];
  for (const { item, names } of entries) {
    for (const name of names) {
      const n = name.trim().toLowerCase();
      if (!n) continue;
      const re = new RegExp(`(?<![\\w])${escapeRegExp(n)}(?:s|es)?(?![\\w])`, "g");
      for (const m of text.matchAll(re)) {
        hits.push({ item, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
      }
    }
  }
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const taken: TextMatch<T>[] = [];
  for (const hit of hits) {
    if (!taken.some((t) => hit.start < t.end && t.start < hit.end)) taken.push(hit);
  }
  return taken.sort((a, b) => a.start - b.start);
};
