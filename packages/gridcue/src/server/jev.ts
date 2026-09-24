import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import { type ClauseResolution, GridCueError, type IntentProvider, type Pick, type ResolutionRequest } from "../index";

/** The slice of the TypeSafe client this provider uses. Tests pass a fake. */
export interface JevClient {
  systemOne(
    request: { model?: string; state: unknown; questions: Record<string, unknown> },
    options?: { signal?: AbortSignal },
  ): PromiseLike<{ answers: Record<string, unknown> }>;
}

export interface JevProviderOptions {
  apiKey?: string;
  model?: string;
  client?: JevClient;
  /** GridCue's own per-request question budget, not an API limit. Default 96. Measure cost and latency with `pnpm eval:live`. */
  maxQuestions?: number;
}

const FAMILY_TEXT: Record<string, string> = {
  filter: "narrow the rows to those matching a condition",
  sort: "sort the rows",
  group: "group the rows by a column",
  "columns.show": "show or add columns",
  "columns.hide": "hide columns",
  "columns.only": "keep only the listed columns and hide the rest",
  "filter.clear": "clear or remove filters",
  "sort.clear": "clear or remove sorting",
  "group.clear": "clear or remove grouping",
  "view.reset": "reset the whole view",
  "unsupported.data_mutation": "edit, delete, or change data values",
  "unsupported.workflow_action": "take a business action such as trading, emailing, or approving",
  "unsupported.navigation": "open another page or record",
  "unsupported.export": "export, download, print, or copy data",
};

type Answer = { noul?: number; choice?: string; confidence?: number };

/** Jev resolves bounded yes/no and choice questions. It never sees rows or restricted columns. */
export const createJevProvider = (options: JevProviderOptions): IntentProvider => {
  // `logLevel` otherwise falls back to `TYPESAFE_LOG_LEVEL`; at `debug` the SDK logs full request and response
  // bodies (the Utterance, column labels, aliases, descriptions). Set it explicitly so a Host's environment
  // can't turn that on by accident. A Host that wants SDK logs can inject its own `client` instead.
  const client: JevClient = options.client ?? (new TypeSafeClient({ apiKey: options.apiKey, logLevel: "off" }) as unknown as JevClient);
  const maxQuestions = options.maxQuestions ?? 96;
  return {
    async resolve(request: ResolutionRequest, signal?: AbortSignal) {
      const { columns, families } = request.candidates;
      const questions: Record<string, unknown> = {};
      // Questions point at named state by path, so each carries its full meaning (question IDs are never sent).
      request.clauses.forEach((clause, p) => {
        const q = `c${clause.index}`;
        const about = `The request step \`clauses[${p}].text\``;
        families.forEach((f, i) => {
          questions[`${q}_f${i}`] = noul(`Does ${about} ask to ${FAMILY_TEXT[f] ?? f}?`);
        });
        columns.forEach((c, i) => {
          questions[`${q}_col${i}`] = noul(
            `Does ${about} refer to the grid column \`columns[${i}]\` (“${c.label}”), by its label or an alias?`,
          );
          if (c.enumValues?.length) {
            questions[`${q}_val${i}`] = choice(
              `Which value of the column \`columns[${i}]\` (“${c.label}”) does ${about} mention, if any?`,
              {
                none: "No value of this column is mentioned",
                ...Object.fromEntries(c.enumValues.map((v) => [v.id, v.label])),
              },
            );
          }
          if (c.kind === "boolean") {
            questions[`${q}_bool${i}`] = choice(
              `Does ${about} want rows where the column \`columns[${i}]\` (“${c.label}”) is true or false?`,
              {
                none: "Neither",
                true: "Yes / true",
                false: "No / false",
              },
            );
          }
        });
        if (!clause.direction) {
          questions[`${q}_dir`] = choice(`If ${about} sorts rows, which direction does it ask for?`, {
            none: "No direction given",
            asc: "Smallest, earliest, or A first",
            desc: "Largest, latest, or Z first",
          });
        }
      });
      if (Object.keys(questions).length > maxQuestions) {
        throw new GridCueError("PROVIDER_TOO_COMPLEX", "That request is too complex. Try a shorter one.");
      }
      let answers: Record<string, Answer>;
      try {
        const response = await client.systemOne(
          {
            ...(options.model ? { model: options.model } : {}),
            state: {
              request: request.utterance,
              clauses: request.clauses.map((c) => ({ text: c.text })),
              columns: columns.map(({ id, label, kind, aliases, description }) => ({ id, label, kind, aliases, description })),
            },
            questions,
          },
          signal ? { signal } : {},
        );
        answers = response.answers as Record<string, Answer>;
      } catch {
        throw new GridCueError("PROVIDER_FAILED", "Jev request failed.");
      }
      const yes = (key: string): number => {
        const a = answers[key];
        if (!a || typeof a.noul !== "number") throw new GridCueError("PROVIDER_MALFORMED", "Jev omitted an answer.");
        return a.noul;
      };
      const pickOf = (key: string, allowed: string[]): Pick | undefined => {
        const a = answers[key];
        if (!a) throw new GridCueError("PROVIDER_MALFORMED", "Jev omitted an answer.");
        if (typeof a.choice !== "string" || !allowed.includes(a.choice))
          throw new GridCueError("PROVIDER_MALFORMED", "Jev returned an unknown choice.");
        return a.choice === "none" ? undefined : { id: a.choice, confidence: a.confidence ?? 0 };
      };
      return {
        clauses: request.clauses.map((clause): ClauseResolution => {
          const q = `c${clause.index}`;
          const fam = families.map((f, i) => ({ id: f, confidence: yes(`${q}_f${i}`) }));
          const mentions = columns
            .map((c, i) => ({ c, i, p: yes(`${q}_col${i}`) }))
            .map((m) => ({
              ...m,
              at:
                [m.c.label, ...(m.c.aliases ?? [])]
                  .map((n) => clause.text.indexOf(n.toLowerCase()))
                  .filter((x) => x >= 0)
                  .sort((a, b) => a - b)[0] ?? Number.MAX_SAFE_INTEGER,
            }))
            .sort((a, b) => a.at - b.at || a.i - b.i);
          const values: ClauseResolution["values"] = [];
          columns.forEach((c, i) => {
            const v = c.enumValues
              ? pickOf(`${q}_val${i}`, ["none", ...c.enumValues.map((e) => e.id)])
              : c.kind === "boolean"
                ? pickOf(`${q}_bool${i}`, ["none", "true", "false"])
                : undefined;
            if (v) values.push({ columnId: c.id, valueId: v.id, confidence: v.confidence });
          });
          const direction = clause.direction ? undefined : pickOf(`${q}_dir`, ["none", "asc", "desc"]);
          return {
            clauseIndex: clause.index,
            families: fam,
            columns: mentions.map((m) => ({ id: m.c.id, confidence: m.p })),
            values,
            ...(direction ? { direction } : {}),
            unmatchedTerms: [],
          };
        }),
      };
    },
  };
};
