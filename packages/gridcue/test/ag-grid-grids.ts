import * as ag36 from "ag-grid-community";
import * as ag34 from "ag-grid-community-34";
import * as ag35 from "ag-grid-community-35";
import { afterEach } from "vitest";
import type { AgGridApiLike } from "../src/ag-grid";
import type { ViewSchema } from "../src/core/protocol";

// The grids the AG Grid tests run on: AG Grid Community 34, 35 and 36 in jsdom. Every grid a test makes is destroyed,
// and a tick awaited, before the test ends: AG Grid's own events run a tick after a change, and one that runs after
// jsdom is gone fails the run (AG Grid spike, Q1).

ag34.ModuleRegistry.registerModules([ag34.AllCommunityModule]);
ag35.ModuleRegistry.registerModules([ag35.AllCommunityModule]);
ag36.ModuleRegistry.registerModules([ag36.AllCommunityModule]);

// Each tested major's own GridApi fits AgGridApiLike, with no cast: `pnpm typecheck` checks these.
const fits34 = (api: ag34.GridApi): AgGridApiLike => api;
const fits35 = (api: ag35.GridApi): AgGridApiLike => api;
const fits36 = (api: ag36.GridApi): AgGridApiLike => api;

/** What the tests read from a grid beyond `AgGridApiLike`. */
export type TestApi = AgGridApiLike & {
  destroy(): void;
  getDisplayedRowCount(): number;
  getDisplayedRowAtIndex(index: number): { data?: Record<string, unknown> } | undefined;
  forEachNodeAfterFilterAndSort(callback: (node: { data?: Record<string, unknown> }) => void): void;
};
export type GridOptions = Record<string, unknown>;

const open = new Set<TestApi>();
export const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(async () => {
  for (const api of open) if (!api.isDestroyed()) api.destroy();
  open.clear();
  await tick();
});

export interface Major {
  version: string;
  createGrid(options: GridOptions): TestApi;
}
const grid =
  (make: (div: HTMLElement, options: GridOptions) => TestApi) =>
  (options: GridOptions): TestApi => {
    const div = document.createElement("div");
    document.body.append(div);
    const api = make(div, options);
    open.add(api);
    return api;
  };
export const MAJORS: Major[] = [
  { version: "34", createGrid: grid((div, o) => fits34(ag34.createGrid(div, o as ag34.GridOptions)) as TestApi) },
  { version: "35", createGrid: grid((div, o) => fits35(ag35.createGrid(div, o as ag35.GridOptions)) as TestApi) },
  { version: "36", createGrid: grid((div, o) => fits36(ag36.createGrid(div, o as ag36.GridOptions)) as TestApi) },
];
export const [, , latest] = MAJORS as [Major, Major, Major];

export type RowModel = "clientSide" | "infinite";

/** The ids of the rows the Client-Side grid shows, in order. */
export const shown = (api: TestApi, key: string) => {
  const out: unknown[] = [];
  api.forEachNodeAfterFilterAndSort((node) => out.push(node.data?.[key]));
  return out;
};

/** The `cellDataType` a Host gives a column of each kind, so AG Grid uses its text, number or date filter for it. */
const DATA_TYPE: Record<ViewSchema["columns"][number]["kind"], string> = {
  string: "text",
  enum: "text",
  boolean: "boolean",
  number: "number",
  currency: "number",
  percent: "number",
  date: "dateString",
  datetime: "dateTimeString",
};

/** Column definitions for every column of a schema, as a Host would write them. */
export const columnDefsFor = (schema: ViewSchema) =>
  schema.columns.map((c) => ({ field: c.id, headerName: c.label, cellDataType: DATA_TYPE[c.kind] }));
