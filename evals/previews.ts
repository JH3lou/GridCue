import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createMockProvider } from "gridcue/mock";
import { labelledRequests } from "./payloads";
import { mockOptionsFor, runCase } from "./run";

/**
 * The Preview pin (named filters plan, Task 2.4): the Preview every labelled request leads to with the Mock Provider,
 * as last recorded in `previews.jsonl`. A change to how a filter reads in the Preview shows up here, line by line, so
 * its pull request can list each line it changes.
 *
 * When a change means to alter a Preview, or adds a labelled set, record again and say what changed in the pull
 * request:
 *   pnpm build && pnpm eval:previews
 */
export const PREVIEWS = new URL("./previews.jsonl", import.meta.url);

/** One labelled request's Preview. A request with no Preview (a question, or nothing to change) is not recorded. */
export interface PinnedPreview {
  file: string;
  id: string;
  lines: string[];
  notes: string[];
}

const wealth = createMockProvider(mockOptionsFor({}));
const ledger = createMockProvider(mockOptionsFor({ schema: "ledger" }));

/** The Preview one labelled request leads to, or `null` when it has none. */
export const previewOf = async (c: Parameters<typeof runCase>[0]): Promise<Pick<PinnedPreview, "lines" | "notes"> | null> => {
  const { preview } = await runCase(c, c.schema === "ledger" ? ledger : wealth);
  return preview ? { lines: preview.lines, notes: preview.notes ?? [] } : null;
};

/** Every labelled request's Preview, one JSON value per line. */
export const recordPreviews = async (): Promise<string> => {
  const lines: string[] = [];
  for (const { file, id, case: c } of labelledRequests()) {
    const preview = await previewOf(c);
    if (preview) lines.push(JSON.stringify({ file, id, ...preview } satisfies PinnedPreview));
  }
  return `${lines.join("\n")}\n`;
};

/** Each recorded Preview, by its file and ID. */
export const loadPreviews = (path: URL = PREVIEWS): Map<string, Pick<PinnedPreview, "lines" | "notes">> =>
  new Map(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const { file, id, lines, notes } = JSON.parse(line) as PinnedPreview;
        return [`${file}: ${id}`, { lines, notes }] as const;
      }),
  );

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ? new URL(process.argv[2], pathToFileURL(`${process.cwd()}/`)) : PREVIEWS;
  const record = await recordPreviews();
  writeFileSync(out, record);
  console.log(`Recorded ${record.split("\n").filter((line) => line.trim()).length} Previews in ${out.pathname}.`);
}
