import type { ApplyResult, GridAdapter } from "./adapter";
import { MVP_OPERATIONS } from "./adapter";
import { GridCueError } from "./errors";
import { emptyViewState, type VersionedViewState, type ViewSchema, type ViewState } from "./protocol";
import { createStateAdapter, renderedOperations, textOf } from "./state-adapter";

export interface QueryAdapterOptions {
  schema: ViewSchema;
  /**
   * The view the grid starts from, and the one `view.reset` returns to. Defaults to every column, in order. It may hold
   * a count only with `countBeforePaging`, pins only with “pinning” in `renders`, a density other than comfortable only
   * with “density”, and never totals: anything else throws `INPUT_CONFIG`.
   */
  initialState?: ViewState;
  /**
   * True only when the Host's server sorts, cuts to the count, and then pages, so "top 10" is the true first ten. Then
   * the adapter lists `limit.set`, and the Host's Data Query must keep what `applyView` keeps for a count. Off by
   * default: a count then ends as a sort with a note that the count was not applied (ADR 0032).
   */
  countBeforePaging?: boolean;
  /**
   * Operations the Host's Data Query can't carry out, such as `["group.set"]`. Each is taken out of the MVP operations
   * the adapter lists. It can only remove: a name the adapter doesn't list throws `INPUT_CONFIG`, naming it.
   */
  without?: readonly string[];
  /**
   * What the Host's table draws from the View State beyond its rows and columns: `"pinning"` when it keeps
   * `pinnedColumnIds` in place, `"density"` when it sets its row height from `density`. The adapter lists `columns.pin`
   * and `density.set` only for what this names. It never lists totals: a total over rows on a server is a Data Query of
   * its own, so `"totals"` throws `INPUT_CONFIG`, as does any other name.
   */
  renders?: ReadonlyArray<"pinning" | "density">;
  maxSorts?: number;
  maxGroups?: number;
}

export interface QueryAdapter extends GridAdapter {
  /**
   * For the Host's own controls, such as clicking a column header. Bumps the revision. It throws `INPUT_CONFIG`, and
   * changes nothing, for a View State that holds what the adapter doesn't list: a count without `countBeforePaging`,
   * totals, pins without “pinning” in `renders`, or a density other than comfortable without “density”.
   */
  setState(update: (state: ViewState) => ViewState): VersionedViewState;
}

/** The name of a value as the Host wrote it, for a message: “group.sett”, or 3, null, 1n, {"op":"group.set"}. */
const named = (value: unknown): string => (typeof value === "string" ? `“${value}”` : textOf(value, true));

/** Why each name a Host may expect to remove isn't one a Query Adapter lists by default. */
const NOT_LISTED: Record<string, string> = {
  "limit.set": "To turn the count off, leave countBeforePaging out.",
  "columns.pin": "To turn pins off, leave “pinning” out of renders.",
  "density.set": "To turn density off, leave “density” out of renders.",
  "aggregation.set": "A Query Adapter never lists totals.",
};

/** The MVP operations without the ones `without` names. A name that isn't an MVP operation throws. */
const remaining = (without: unknown): string[] => {
  if (without === undefined) return [...MVP_OPERATIONS];
  if (!Array.isArray(without)) throw new GridCueError("INPUT_CONFIG", "without must be a list of operations, such as [“group.set”].");
  for (const name of without) {
    if (typeof name === "string" && MVP_OPERATIONS.includes(name)) continue;
    const why = typeof name === "string" && Object.hasOwn(NOT_LISTED, name) ? ` ${NOT_LISTED[name]}` : "";
    throw new GridCueError(
      "INPUT_CONFIG",
      `without names ${named(name)}, which isn't an operation the Query Adapter lists. It can only remove ${MVP_OPERATIONS.map((op) => `“${op}”`).join(", ")}.${why}`,
    );
  }
  return MVP_OPERATIONS.filter((op) => !without.includes(op));
};

const COMFORTABLE = emptyViewState([]).density;

/**
 * What a View State holds that the adapter lists no operation for, among the parts only an operation outside the MVP
 * operations sets: a count, totals, pins and a density. The Host's Data Query or table would never carry it out, and no
 * request could take it away. With its fix, for a message. The MVP parts are not checked: a Host that takes grouping out
 * may still group a page with its own controls.
 */
const unlisted = (state: ViewState | undefined, operations: readonly string[]): { part: string; fix: string } | undefined => {
  const s = (state ?? {}) as Partial<ViewState>;
  if (!operations.includes("limit.set") && s.limit !== undefined && s.limit !== null)
    return { part: "a count", fix: "Leave the count out, or set countBeforePaging: true if the server sorts and cuts before paging." };
  if (!operations.includes("aggregation.set") && Array.isArray(s.aggregations) && s.aggregations.length > 0)
    return {
      part: "totals",
      fix: "Leave them out: a Query Adapter never lists totals, since a total over rows on a server is a Data Query of its own.",
    };
  const pins = s.pinnedColumnIds;
  if (!operations.includes("columns.pin") && ((pins?.start?.length ?? 0) > 0 || (pins?.end?.length ?? 0) > 0))
    return { part: "pinned columns", fix: "Leave them out, or name “pinning” in renders if the table draws pins." };
  if (!operations.includes("density.set") && s.density !== undefined && s.density !== COMFORTABLE)
    return { part: `the density ${named(s.density)}`, fix: "Leave it out, or name “density” in renders if the table draws it." };
  return undefined;
};

/**
 * A Grid Adapter for Hosts whose rows come from their own Data Query (ADR 0032). It holds the View State and never
 * fetches: the Host subscribes, builds its Data Query from the View State on each change, and shows its own loading and
 * fetch errors, as for a click on a column header. An apply is done when the View State changes. It lists only the
 * operations a Data Query can carry out: the MVP ones less `without`, a count only with `countBeforePaging`, and pins
 * and density only when `renders` names them. Its View State never holds what it doesn't list.
 */
export const createQueryAdapter = (options: QueryAdapterOptions): QueryAdapter => {
  const { countBeforePaging } = options;
  if (countBeforePaging !== undefined && typeof countBeforePaging !== "boolean") {
    throw new GridCueError("INPUT_CONFIG", `countBeforePaging must be true or false, not ${named(countBeforePaging)}.`);
  }
  const kept = remaining(options.without);
  const rendered = renderedOperations(options.renders, {
    adapter: "the Query Adapter",
    takes: ["pinning", "density"],
    refused: {
      totals: "renders names “totals”: a Query Adapter never lists totals, since a total over rows on a server is a Data Query of its own.",
      count: "renders names “count”: a Query Adapter lists a count only with countBeforePaging: true. Leave it out of renders.",
    },
  });
  const operations = [...kept, ...(countBeforePaging ? ["limit.set"] : []), ...rendered];
  const starting = unlisted(options.initialState, operations);
  if (starting) {
    throw new GridCueError("INPUT_CONFIG", `initialState holds ${starting.part}, which this grid can't keep. ${starting.fix}`);
  }
  const holder = createStateAdapter({
    schema: options.schema,
    initialState: options.initialState,
    maxSorts: options.maxSorts,
    maxGroups: options.maxGroups,
    operations,
    revisionPrefix: "query",
  });
  return {
    ...holder,
    async apply(plan): Promise<ApplyResult> {
      // The Controller validates against this adapter's operations before it applies. This holds even when it didn't, so
      // a count or a grouping the Host's Data Query can't carry out never reaches the View State.
      const unlistedOp = Array.isArray(plan?.operations) ? plan.operations.find((op) => !operations.includes(op.type)) : undefined;
      if (unlistedOp) {
        return {
          ok: false,
          code: "ADAPTER_NOT_APPLICABLE",
          message: `This grid doesn't list ${unlistedOp.type}, so the plan can't apply.`,
        };
      }
      return holder.apply(plan);
    },
    async restore(snapshot): Promise<ApplyResult> {
      const held = unlisted(snapshot?.state, operations);
      if (held)
        return { ok: false, code: "ADAPTER_NOT_APPLICABLE", message: `This snapshot holds ${held.part}, which this grid can't keep.` };
      return holder.restore(snapshot);
    },
    setState: (update) =>
      holder.setState((state) => {
        const next = update(state);
        const held = unlisted(next, operations);
        if (held) throw new GridCueError("INPUT_CONFIG", `setState would hold ${held.part}, which this grid can't keep. ${held.fix}`);
        return next;
      }),
  };
};
