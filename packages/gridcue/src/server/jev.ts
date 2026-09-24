import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import {
  type ClauseResolution,
  GridCueError,
  type IntentProvider,
  LITERAL_COLUMN_KINDS,
  type Pick,
  REVERSAL_WORDING,
  type ResolutionRequest,
} from "../index";

/** The slice of the TypeSafe client this provider uses. Tests pass a fake. */
export interface JevClient {
  systemOne(
    request: { model?: string; state: unknown; questions: Record<string, unknown> },
    options?: { signal?: AbortSignal },
  ): PromiseLike<{ answers: Record<string, unknown> }>;
}

export interface JevProviderOptions {
  apiKey?: string;
  /** Default `jev-1.13.0`, the model GridCue's confidence bands are tuned against. Pass `jev-latest` to float. */
  model?: string;
  client?: JevClient;
  /**
   * GridCue's own per-request question budget, not an API limit. Default 800, about 31k tokens: under Jev's 64k per
   * request. Twelve Clauses on a nine-column schema need about 790. Measure cost and latency with `pnpm eval:live`.
   */
  maxQuestions?: number;
}

export const DEFAULT_JEV_MODEL = "jev-1.13.0";

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

type Answer = { noul?: number; choice?: string; probabilities?: Record<string, unknown> };

/** Column families a role question can bind a column to, and how each question words it (fan-out spec, Q3). */
const ROLE_TEXT: Record<string, string> = {
  sort: "sort the rows by",
  group: "group the rows by",
  "columns.show": "show",
  "columns.hide": "hide",
};

/** Jev resolves bounded yes/no and choice questions. It never sees rows or restricted columns. */
export const createJevProvider = (options: JevProviderOptions): IntentProvider => {
  // `logLevel` otherwise falls back to `TYPESAFE_LOG_LEVEL`; at `debug` the SDK logs full request and response
  // bodies (the Utterance, column labels, aliases, descriptions). Set it explicitly so a Host's environment
  // can't turn that on by accident. A Host that wants SDK logs can inject its own `client` instead.
  const client: JevClient = options.client ?? (new TypeSafeClient({ apiKey: options.apiKey, logLevel: "off" }) as unknown as JevClient);
  const maxQuestions = options.maxQuestions ?? 800;
  const model = options.model ?? DEFAULT_JEV_MODEL;
  return {
    async resolve(request: ResolutionRequest, signal?: AbortSignal) {
      const { columns, families } = request.candidates;
      const questions: Record<string, unknown> = {};
      const labelOf = (id: string) => columns.find((c) => c.id === id)?.label ?? id;
      // Questions point at named state by path, so each carries its full meaning (question IDs are never sent).
      request.clauses.forEach((clause, p) => {
        const q = `c${clause.index}`;
        const about = `The request step \`clauses[${p}].text\``;
        // A named value is final, so its column and value questions are skipped. A named column is still asked about:
        // its score lets the compiler tell the column from the rows ("biggest accounts first"), ADR 0013.
        const valued = new Set(clause.mentions?.filter((m) => m.valueId !== undefined).map((m) => m.columnId));
        families.forEach((f, i) => {
          questions[`${q}_f${i}`] = noul(`Does ${about} ask to ${FAMILY_TEXT[f] ?? f}?`);
        });
        columns.forEach((c, i) => {
          if (!valued.has(c.id)) {
            questions[`${q}_col${i}`] = noul(
              `Does ${about} refer to the grid column \`columns[${i}]\` (“${c.label}”), by its label or an alias?`,
            );
          }
          if (c.enumValues?.length && !valued.has(c.id)) {
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
        // Fan-out (spec 2026-09-24): asked for every part; the compiler reads only the answers that apply.
        columns.forEach((c, i) => {
          if (valued.has(c.id)) return;
          Object.keys(ROLE_TEXT).forEach((family, r) => {
            if (!c.families.includes(family)) return;
            questions[`${q}_role${i}_${r}`] = noul(
              `Does ${about} ask to ${ROLE_TEXT[family]} the grid column \`columns[${i}]\` (“${c.label}”)?`,
            );
          });
        });
        questions[`${q}_kind`] = choice(`Which kind of change does ${about} mainly ask for?`, {
          ...Object.fromEntries(families.map((f) => [f, FAMILY_TEXT[f] ?? f])),
          none: "No change to the view, or it is unclear",
        });
        questions[`${q}_adds`] = noul(
          `If ${about} sorts or groups the rows, does it add another level to the current \`view\` sort or grouping, rather than replace it?`,
        );
        const named = [...new Set(clause.mentions?.filter((m) => m.valueId === undefined).map((m) => m.columnId))];
        if (REVERSAL_WORDING.test(clause.text) && named.length > 1) {
          for (const a of named) {
            for (const b of named) {
              if (a === b) continue;
              const ia = columns.findIndex((c) => c.id === a);
              const ib = columns.findIndex((c) => c.id === b);
              questions[`${q}_outer${ia}_${ib}`] = noul(
                `In ${about}, is the grid column \`columns[${ia}]\` the outer grouping or the primary sort, with \`columns[${ib}]\` inside it?`,
              );
            }
          }
        }
        clause.literals.forEach((lit, j) => {
          const fits = columns.filter((c) => c.families.includes("filter") && LITERAL_COLUMN_KINDS[lit.kind].includes(c.kind));
          if (fits.length === 0) return;
          questions[`${q}_lit${j}`] = choice(
            `Which grid column does the condition \`clauses[${p}].literals[${j}]\` in ${about} apply to?`,
            {
              none: "None of these columns",
              ...Object.fromEntries(fits.map((c) => [c.id, c.label])),
            },
          );
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
            model,
            state: {
              request: request.utterance,
              clauses: request.clauses.map((c) => ({
                text: c.text,
                ...(c.literals.length > 0
                  ? { literals: c.literals.map(({ kind, value, upper, comparator }) => ({ kind, value, upper, comparator })) }
                  : {}),
              })),
              columns: columns.map(({ id, label, kind, aliases, description }) => ({ id, label, kind, aliases, description })),
              view: {
                sorts: request.view.sorts.map((s) => ({ column: labelOf(s.columnId), direction: s.direction })),
                groupBy: request.view.groupBy.map(labelOf),
              },
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
        // Jev's `confidence` describes the whole distribution's shape; GridCue's bands are probabilities (ADR 0013).
        const probability = a.probabilities?.[a.choice];
        if (typeof probability !== "number" || probability < 0 || probability > 1)
          throw new GridCueError("PROVIDER_MALFORMED", "Jev omitted a choice probability.");
        return a.choice === "none" ? undefined : { id: a.choice, confidence: probability };
      };
      return {
        clauses: request.clauses.map((clause): ClauseResolution => {
          const q = `c${clause.index}`;
          const fam = families.map((f, i) => ({ id: f, confidence: yes(`${q}_f${i}`) }));
          const asked = (i: number) => `${q}_col${i}` in questions;
          const mentions = columns
            .map((c, i) => ({ c, i }))
            .filter((m) => asked(m.i))
            .map((m) => ({ ...m, p: yes(`${q}_col${m.i}`) }))
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
            const key = c.enumValues ? `${q}_val${i}` : c.kind === "boolean" ? `${q}_bool${i}` : undefined;
            const allowed = c.enumValues ? ["none", ...c.enumValues.map((e) => e.id)] : ["none", "true", "false"];
            const v = key && key in questions ? pickOf(key, allowed) : undefined;
            if (v) values.push({ columnId: c.id, valueId: v.id, confidence: v.confidence });
          });
          const direction = clause.direction ? undefined : pickOf(`${q}_dir`, ["none", "asc", "desc"]);
          const literalColumns: NonNullable<ClauseResolution["literalColumns"]> = [];
          clause.literals.forEach((_, j) => {
            const key = `${q}_lit${j}`;
            if (!(key in questions)) return;
            const pick = pickOf(key, ["none", ...columns.map((c) => c.id)]);
            if (pick) literalColumns.push({ literalIndex: j, columnId: pick.id, confidence: pick.confidence });
          });
          const roles: NonNullable<ClauseResolution["roles"]> = [];
          columns.forEach((c, i) => {
            Object.keys(ROLE_TEXT).forEach((family, r) => {
              const key = `${q}_role${i}_${r}`;
              if (key in questions) roles.push({ columnId: c.id, family, confidence: yes(key) });
            });
          });
          const kind = pickOf(`${q}_kind`, [...families, "none"]);
          const outer: NonNullable<ClauseResolution["outer"]> = [];
          for (const key of Object.keys(questions)) {
            const m = key.match(/^c(\d+)_outer(\d+)_(\d+)$/);
            const a = columns[Number(m?.[2])];
            const b = columns[Number(m?.[3])];
            if (m && m[1] === String(clause.index) && a && b) outer.push({ outerId: a.id, innerId: b.id, confidence: yes(key) });
          }
          return {
            clauseIndex: clause.index,
            families: fam,
            roles,
            ...(kind ? { kind } : {}),
            adds: yes(`${q}_adds`),
            ...(outer.length > 0 ? { outer } : {}),
            columns: mentions.map((m) => ({ id: m.c.id, confidence: m.p })),
            values,
            ...(direction ? { direction } : {}),
            unmatchedTerms: [],
            ...(literalColumns.length > 0 ? { literalColumns } : {}),
          };
        }),
      };
    },
  };
};
