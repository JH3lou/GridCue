import type { NormalizedInput } from "./normalize";
import type { ViewSchema } from "./protocol";
import { findMentions } from "./text-match";

export interface RestrictedMention {
  clauseIndex: number;
  columnId: string;
}

/**
 * Finds clauses that name a restricted column. Runs locally, before any provider call,
 * so restricted columns are refused without their metadata or values ever leaving the Host.
 */
export const screenRestricted = (input: NormalizedInput, schema: ViewSchema): RestrictedMention[] => {
  const entries = schema.columns
    .filter((c) => c.sensitivity === "restricted")
    // Each name is screened without its trailing symbols too, so "show client id" is refused for "Client ID!".
    .map((c) => ({ item: c.id, names: [c.label, ...(c.aliases ?? [])].flatMap((n) => [n, n.replace(/[^\p{L}\p{N}\s]+$/u, "")]) }));
  if (entries.length === 0) return [];
  return input.clauses.flatMap((clause) =>
    findMentions(clause.text, entries).map((m) => ({ clauseIndex: clause.index, columnId: m.item })),
  );
};
