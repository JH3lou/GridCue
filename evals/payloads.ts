import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { IntentProvider, ResolutionRequest } from "gridcue";
import { type EvalCase, loadCases, runCase } from "./run";

/**
 * The payload pin (operation set spec, 4.1): the request sent to the Intent Provider for every labelled request, as
 * last recorded in `payloads.jsonl`. Code that reads more of a request itself must not change what a provider is sent,
 * so `payloads.test.ts` compares each request with its record.
 *
 * When a change means to alter the request, or adds a labelled set, record again and say why in the pull request:
 *   pnpm build && pnpm eval:payloads
 */
export const PAYLOADS = new URL("./payloads.jsonl", import.meta.url);

/** What every request on one schema repeats, written once: the candidates, and the columns the starting view shows. */
interface Shared {
  schema: string;
  candidates: ResolutionRequest["candidates"];
  visibleColumnIds: string[];
}
/** One labelled request's record. `request` is `null` when the Controller answers without calling the provider. */
interface Pinned {
  file: string;
  id: string;
  /** `candidates`, and `view.visibleColumnIds` where they are the schema's own, hold the schema's name instead. */
  request: unknown;
}

/** Every labelled request in `evals/`: each `cases*.jsonl` set, and the requests labelled for their Mentions. */
export const labelledRequests = (): Array<{ file: string; id: string; case: EvalCase }> => {
  const dir = new URL("./", import.meta.url);
  const sets = readdirSync(dir)
    .filter((name) => /^cases.*\.jsonl$/.test(name))
    .sort()
    .flatMap((file) => loadCases(new URL(file, dir)).map((c) => ({ file, id: c.id, case: c })));
  const file = "mentions-cases.jsonl";
  const mentions = readFileSync(new URL(file, dir), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      const { set, utterance } = JSON.parse(line) as { set: string; utterance: string };
      const id = `${set}-${i + 1}`;
      return { file, id, case: { id, utterance, expect: { status: "ready" } } satisfies EvalCase };
    });
  return [...sets, ...mentions];
};

type Run = (c: EvalCase, provider: IntentProvider) => Promise<unknown>;

/** The request one labelled request sends to the provider, or `null` when none is sent. */
export const providerRequest = async (c: EvalCase, run: Run = runCase): Promise<ResolutionRequest | null> => {
  let seen: ResolutionRequest | null = null;
  // The request is built before the provider answers, so the answer doesn't matter here.
  const provider: IntentProvider = {
    resolve: async (request) => {
      seen = structuredClone(request);
      return { clauses: [] };
    },
  };
  await run(c, provider);
  return seen;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The whole record, one JSON value per line: what each schema's requests share, then each labelled request. */
export const recordPayloads = async (run: Run = runCase): Promise<string> => {
  const shared = new Map<string, Shared>();
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const { file, id, case: c } of labelledRequests()) {
    if (seen.has(`${file}: ${id}`)) throw new Error(`${file} labels “${id}” twice.`);
    seen.add(`${file}: ${id}`);
    const request = await providerRequest(c, run);
    // A grid that lists other operations offers the provider other candidates, so it is a schema of its own here.
    const schema = `${c.schema ?? "wealth"}${c.grid ? `, ${c.grid}` : ""}`;
    let pinned: unknown = null;
    if (request) {
      const { candidates, view } = request;
      const first = shared.get(schema) ?? { schema, candidates, visibleColumnIds: view.visibleColumnIds };
      shared.set(schema, first);
      if (!same(candidates, first.candidates)) throw new Error(`${file}: ${id} has other candidates than its schema's.`);
      const visibleColumnIds = same(view.visibleColumnIds, first.visibleColumnIds) ? schema : view.visibleColumnIds;
      pinned = { ...request, candidates: schema, view: { ...view, visibleColumnIds } };
    }
    lines.push(JSON.stringify({ file, id, request: pinned } satisfies Pinned));
  }
  return `${[...[...shared.values()].map((s) => JSON.stringify(s)), ...lines].join("\n")}\n`;
};

/** Each recorded request in full, by its file and ID. */
export const loadPayloads = (path: URL = PAYLOADS): Map<string, ResolutionRequest | null> => {
  const entries = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Shared | Pinned);
  const shared = new Map(entries.flatMap((e) => ("schema" in e ? [[e.schema, e] as const] : [])));
  const requests = new Map<string, ResolutionRequest | null>();
  for (const entry of entries) {
    if ("schema" in entry) continue;
    const pinned = entry.request as (Omit<ResolutionRequest, "candidates"> & { candidates: string }) | null;
    const own = pinned && shared.get(pinned.candidates);
    if (pinned && !own) throw new Error(`payloads.jsonl has no “${pinned.candidates}” schema line for ${entry.file}: ${entry.id}.`);
    const columns = pinned?.view.visibleColumnIds as string[] | string | undefined;
    requests.set(
      `${entry.file}: ${entry.id}`,
      pinned && own
        ? {
            ...pinned,
            candidates: own.candidates,
            view: { ...pinned.view, visibleColumnIds: typeof columns === "string" ? own.visibleColumnIds : (columns ?? []) },
          }
        : null,
    );
  }
  return requests;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const record = await recordPayloads();
  writeFileSync(PAYLOADS, record);
  console.log(
    `Recorded ${record.split("\n").filter((line) => line.startsWith('{"file"')).length} provider requests in evals/payloads.jsonl.`,
  );
}
