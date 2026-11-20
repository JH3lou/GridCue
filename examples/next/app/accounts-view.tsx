"use client";

import { generateAccounts, wealthColumns, wealthInitialState, wealthSchemaOptions } from "@gridcue-internal/wealth-fixtures";
import { applyView, createGridCue, createRemoteProvider, createRowsAdapter, defineSchema, emptyViewState } from "gridcue";
import { GridCueBar } from "gridcue/react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

// The firm's time zone. Next.js renders these rows on the server first, so the Calendar names it: the server and the
// browser then agree on today and on the day each date falls on.
const timeZone = "America/New_York";

// The fixture's schema with two date columns of this app's own, and two House Terms: the firm's own names for fixed
// filters. GridCue reads them in the browser and never sends them.
const schema = defineSchema([...wealthColumns, { id: "opened", label: "Opened" }, { id: "last_contact", label: "Last contact" }], {
  ...wealthSchemaOptions,
  calendar: { timeZone },
  columns: {
    ...wealthSchemaOptions.columns,
    opened: { kind: "date", aliases: ["opened", "open date"] },
    last_contact: { kind: "datetime", aliases: ["contacted", "last contacted"] },
  },
  houseTerms: [
    { label: "Large", aliases: ["big"], where: [{ columnId: "market_value", operator: "gt", value: 1_000_000 }] },
    {
      label: "Needs attention",
      aliases: ["need attention", "needing attention"],
      where: [
        { columnId: "concentration", operator: "gt", value: 0.1 },
        { columnId: "has_restricted_holding", operator: "eq", value: true },
      ],
    },
  ],
});
const dayParts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" });
// Synthetic dates worked out from each row's index and today in the firm's time zone: Opened spreads over four years
// back from today, so "opened in the last 90 days" keeps some rows and not all. Date.UTC rolls a day count over into
// earlier months and years, so this is arithmetic on calendar days.
const accountsAt = (now: Date) => {
  const today = Object.fromEntries(dayParts.formatToParts(now).map((p) => [p.type, p.value]));
  const back = (days: number, hour = 0, minute = 0) =>
    new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) - days, hour, minute)).toISOString();
  return generateAccounts().map((row, i) => ({
    ...row,
    opened: back((i * 97) % 1461).slice(0, 10),
    last_contact: back((i * 13) % 120, 13 + (i % 8), (i * 7) % 60),
  }));
};
// The fixture's starting view, with the two date columns after its own.
const initialState = {
  ...emptyViewState(schema.columns.map((c) => c.id)),
  visibleColumnIds: [...wealthInitialState.visibleColumnIds, "opened", "last_contact"],
};
// A date stays on one line in its cell (page.css).
const DATE_COLUMNS = new Set(schema.columns.filter((c) => c.kind === "date" || c.kind === "datetime").map((c) => c.id));
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" });

const format = (columnId: string, value: unknown): string => {
  const column = schema.columns.find((c) => c.id === columnId);
  if (column?.kind === "datetime") return dateTime.format(new Date(value as string));
  if (column?.kind === "currency") return money.format(value as number);
  if (column?.kind === "percent") return `${Math.round((value as number) * 1000) / 10}%`;
  if (column?.kind === "boolean") return value ? "Yes" : "No";
  if (column?.kind === "enum") return column.enumValues?.find((e) => e.id === value)?.label ?? String(value);
  return String(value);
};

/** `now` is the server's clock when it rendered the page, so the browser builds the rows the server did. */
export function AccountsView({ now }: { now: string }) {
  // The whole GridCue setup: an adapter over the rows you already have, and a controller.
  const [{ rows, adapter, cue }] = useState(() => {
    const rows = accountsAt(new Date(now));
    // Local Values: the names this grid holds, read in the browser so "Avery Lane's accounts" filters to that advisor.
    // The rows never leave the page; the Server Handler sees only the request.
    const localValues = {
      advisor_name: () => rows.map((row) => row.advisor_name),
      household: () => rows.map((row) => row.household),
    };
    const adapter = createRowsAdapter({ schema, initialState });
    const cue = createGridCue({ adapter, provider: createRemoteProvider({ endpoint: "/api/gridcue" }), localValues });
    return { rows, adapter, cue };
  });
  const { state } = useSyncExternalStore(adapter.subscribe, adapter.getState, adapter.getState);
  const view = applyView(rows, state, schema);
  const label = (id: string) => schema.columns.find((c) => c.id === id)?.label ?? id;
  const body = (list: typeof rows) =>
    list.slice(0, 100).map((row) => (
      <tr key={row.account_number}>
        {view.columns.map((id) => (
          <td key={id} className={DATE_COLUMNS.has(id) ? "date" : undefined}>
            {format(id, row[id as keyof typeof row])}
          </td>
        ))}
      </tr>
    ));

  return (
    <main>
      <h1>Accounts</h1>
      <nav aria-label="Examples">
        <Link href="/paged">Rows from a server, paged</Link> · <Link href="/ag-grid">In AG Grid</Link>
      </nav>
      <GridCueBar controller={cue} />
      <p>{view.rows.length} rows</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {view.columns.map((id) => (
                <th key={id}>{label(id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.groups
              ? view.groups.map((group) => [
                  <tr key={JSON.stringify(group.key)} className="group-row">
                    <td colSpan={view.columns.length}>
                      {Object.entries(group.key)
                        .map(([id, v]) => `${label(id)}: ${format(id, v)}`)
                        .join(" · ")}{" "}
                      ({group.rows.length})
                    </td>
                  </tr>,
                  ...body(group.rows),
                ])
              : body(view.rows)}
          </tbody>
        </table>
      </div>
    </main>
  );
}
