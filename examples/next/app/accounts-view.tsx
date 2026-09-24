"use client";

import { generateAccounts, wealthInitialState, wealthSchema } from "@gridcue-internal/wealth-fixtures";
import { applyView, createGridCue, createRemoteProvider, createRowsAdapter } from "gridcue";
import { GridCueBar } from "gridcue/react";
import { useState, useSyncExternalStore } from "react";

const rows = generateAccounts();
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const format = (columnId: string, value: unknown): string => {
  const column = wealthSchema.columns.find((c) => c.id === columnId);
  if (column?.kind === "currency") return money.format(value as number);
  if (column?.kind === "percent") return `${Math.round((value as number) * 1000) / 10}%`;
  if (column?.kind === "boolean") return value ? "Yes" : "No";
  if (column?.kind === "enum") return column.enumValues?.find((e) => e.id === value)?.label ?? String(value);
  return String(value);
};

export function AccountsView() {
  // The whole GridCue setup: an adapter over the rows you already have, and a controller.
  const [{ adapter, cue }] = useState(() => {
    const adapter = createRowsAdapter({ schema: wealthSchema, initialState: wealthInitialState });
    return { adapter, cue: createGridCue({ adapter, provider: createRemoteProvider({ endpoint: "/api/gridcue" }) }) };
  });
  const { state } = useSyncExternalStore(adapter.subscribe, adapter.getState, adapter.getState);
  const view = applyView(rows, state, wealthSchema);
  const label = (id: string) => wealthSchema.columns.find((c) => c.id === id)?.label ?? id;
  const body = (list: typeof rows) =>
    list.slice(0, 100).map((row) => (
      <tr key={row.account_number}>
        {view.columns.map((id) => (
          <td key={id}>{format(id, row[id as keyof typeof row])}</td>
        ))}
      </tr>
    ));

  return (
    <main>
      <h1>Accounts</h1>
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
