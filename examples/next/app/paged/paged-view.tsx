"use client";

import { wealthSchema as schema, wealthInitialState } from "@gridcue-internal/wealth-fixtures";
import { createGridCue, createQueryAdapter, createRemoteProvider, type Scalar, type ViewState } from "gridcue";
import { GridCueBar } from "gridcue/react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import "./paged.css";

// THE HOST'S CODE, NOT GRIDCUE'S. GridCue writes the View State. This page asks its own route (/api/rows) for one page of
// rows for that View State, and draws them: the loading, the error and the empty states are the page's own.

const PAGE_SIZE = 25;

interface RowsPage {
  rows: Array<Record<string, Scalar>>;
  total: number;
}

/** Asks the route for one page of the view. A 400 carries the route's own message. */
const loadRows = async (state: ViewState, page: number, signal: AbortSignal): Promise<RowsPage> => {
  const response = await fetch("/api/rows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, page: { offset: page * PAGE_SIZE, size: PAGE_SIZE } }),
    signal,
  });
  const body: unknown = await response.json().catch(() => undefined);
  const { rows, total, error } = (body ?? {}) as Partial<RowsPage> & { error?: unknown };
  if (!response.ok) throw new Error(typeof error === "string" ? error : `The server answered ${response.status}.`);
  if (!Array.isArray(rows) || typeof total !== "number") throw new Error("The server's answer was not a page of rows.");
  return { rows, total };
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const count = new Intl.NumberFormat("en-US");
// One decimal always, so "37.0%" lines up under "40.1%".
const percent = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

const NUMBER_KINDS = new Set(["currency", "percent", "number"]);

const format = (columnId: string, value: Scalar | undefined): string => {
  const column = schema.columns.find((c) => c.id === columnId);
  if (value === null || value === undefined) return "";
  if (column?.kind === "currency") return money.format(value as number);
  if (column?.kind === "percent") return percent.format(value as number);
  if (column?.kind === "boolean") return value ? "Yes" : "No";
  if (column?.kind === "enum") return column.enumValues?.find((e) => e.id === value)?.label ?? String(value);
  return String(value);
};

export function PagedView() {
  // The whole GridCue setup: a Query Adapter, which holds the View State and never fetches, and a controller. The route
  // sorts, keeps the first N rows and only then pages, so a count is exact (countBeforePaging). It doesn't group, and
  // a page can't be grouped by the table alone, so grouping is out.
  const [{ adapter, cue }] = useState(() => {
    const adapter = createQueryAdapter({ schema, initialState: wealthInitialState, countBeforePaging: true, without: ["group.set"] });
    const cue = createGridCue({ adapter, provider: createRemoteProvider({ endpoint: "/api/gridcue" }) });
    return { adapter, cue };
  });
  const view = useSyncExternalStore(adapter.subscribe, adapter.getState, adapter.getState);
  const { state, revision } = view;

  // The page number belongs to the View State it was chosen in. Any change to the view, GridCue's, an undo or a click of
  // your own, is a new revision and starts again at page 1.
  const [paging, setPaging] = useState({ revision, page: 0 });
  const page = paging.revision === revision ? paging.page : 0;

  // A page of rows remembers the revision it was read for. Its total says nothing about a newer view.
  const [data, setData] = useState<(RowsPage & { revision: typeof revision }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  // Refetch on every change of the view, of the page, or a retry. The fetch lives here, not in a subscriber of the
  // adapter, so nothing it throws can come out of an apply. A change that comes while a page is loading cancels it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is how a retry asks again
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadRows(state, page, controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        setData({ ...next, revision });
        setError(null);
        setLoading(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        // A page of the wrong view is worse than none, so the rows go.
        setData(null);
        setError(failure instanceof Error ? failure.message : "The request failed.");
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [state, revision, page, attempt]);

  // The columns the View State shows, in its order. The route never returns the restricted column.
  const columns = schema.columns.filter((c) => c.sensitivity !== "restricted" && state.visibleColumnIds.includes(c.id));
  columns.sort((a, b) => state.columnOrder.indexOf(a.id) - state.columnOrder.indexOf(b.id));

  // Only a total read for this revision can say how many pages there are. While a new view loads, the last view's rows
  // stay dimmed, but its count and its page numbers don't: Next waits, so it can't ask for a page the new view lacks.
  const current = data !== null && data.revision === revision ? data : null;
  const total = current?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrevious = page > 0;
  const hasNext = current !== null && page + 1 < pages;
  const matched = `${count.format(total)} ${total === 1 ? "row matches" : "rows match"}`;
  const status = error ? "Rows not loaded" : loading ? "Loading rows…" : matched;

  return (
    <main className="paged">
      <div className="paged-head">
        <h1>Accounts, paged</h1>
        <nav aria-label="Examples">
          <Link href="/">Rows in memory</Link> · <Link href="/ag-grid">In AG Grid</Link>
        </nav>
      </div>
      <GridCueBar controller={cue} />
      <div className="paged-bar">
        {/* One polite live region: "Loading rows…", then how many rows match. */}
        <p className="paged-status" role="status">
          {status}
        </p>
        <nav className="paged-pages" aria-label="Pages">
          {/* aria-disabled, not disabled: a button that goes disabled under the keyboard drops its focus. */}
          <button
            type="button"
            aria-label="Previous page"
            aria-disabled={!hasPrevious}
            onClick={() => hasPrevious && setPaging({ revision, page: page - 1 })}
          >
            Previous
          </button>
          <span className="paged-position">{current ? `Page ${page + 1} of ${pages}` : `Page ${page + 1}`}</span>
          <button
            type="button"
            aria-label="Next page"
            aria-disabled={!hasNext}
            onClick={() => hasNext && setPaging({ revision, page: page + 1 })}
          >
            Next
          </button>
        </nav>
      </div>

      {error ? (
        <div className="paged-note paged-error" role="alert">
          <p>
            <strong>Couldn't load the rows.</strong> {error}
          </p>
          <button type="button" aria-disabled={loading} onClick={() => !loading && setAttempt((n) => n + 1)}>
            {loading ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : !data || (data.total === 0 && !current) ? (
        <p className="paged-note">Loading rows…</p>
      ) : data.total === 0 ? (
        <p className="paged-note">No rows match this view. Undo the last change, or ask to reset the view.</p>
      ) : (
        // While the next page of the same view loads, its rows stay on screen, dimmed, so the table never flashes empty.
        // Rows of an older view are not this view's rows: after 100ms they hide (data-stale) and only the headers stay.
        // Both are cues on top of the status line above, never the only one.
        <section className="table-scroll paged-rows" aria-label="Accounts" aria-busy={loading} data-stale={current ? undefined : ""}>
          <table>
            <caption className="sr-only">{current ? `Accounts, page ${page + 1} of ${pages}` : "Accounts, loading"}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.id} scope="col" className={NUMBER_KINDS.has(c.kind) ? "num" : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={String(row.account_number)}>
                  {columns.map((c) => (
                    <td key={c.id} className={NUMBER_KINDS.has(c.kind) ? "num" : undefined}>
                      {format(c.id, row[c.id])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
