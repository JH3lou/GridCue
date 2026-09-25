import type { AccountRow } from "@gridcue-internal/wealth-fixtures";
import { flexRender, type Table as TanStackTable } from "@tanstack/react-table";
import type { GridCueController } from "gridcue";
import { useGridCue } from "gridcue/react";
import { useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { features } from "./use-wealth-demo";

/** Column ids a plan touched, so their headers can stay marked after it applies: a static cue beside any motion. */
const touchedColumns = (operations: ReadonlyArray<Record<string, unknown>>): Set<string> => {
  const ids = new Set<string>();
  for (const op of operations) {
    if (Array.isArray(op.columnIds)) for (const id of op.columnIds) ids.add(String(id));
    if (Array.isArray(op.sorts)) for (const s of op.sorts) ids.add(String((s as { columnId: string }).columnId));
    const predicate = op.predicate as { columnId?: string } | undefined;
    if (predicate?.columnId) ids.add(predicate.columnId);
  }
  return ids;
};

export function WealthTable({
  table,
  controller,
  maxRows = 100,
}: {
  table: TanStackTable<typeof features, AccountRow>;
  controller: GridCueController;
  maxRows?: number;
}) {
  const cue = useGridCue(controller);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (cue.status !== "applied" || !cue.plan) return;
    setMarked(touchedColumns(cue.plan.operations as unknown as Array<Record<string, unknown>>));
    const timer = setTimeout(() => setMarked(new Set()), 1200);
    return () => clearTimeout(timer);
  }, [cue.status, cue.plan]);

  const rows = table.getRowModel().rows;
  const visible = table.getVisibleLeafColumns().length;
  const grouped = rows[0]?.getIsGrouped() ?? false;
  // A grouped view lists each group's accounts under its header, nested groups included (review fix).
  type Line = (typeof rows)[number];
  const lines: Line[] = [];
  const visit = (row: Line) => {
    lines.push(row);
    if (row.getIsGrouped()) for (const sub of row.subRows) visit(sub);
  };
  for (const row of rows) visit(row);
  const accounts = grouped ? lines.filter((row) => !row.getIsGrouped()).length : rows.length;
  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground text-xs tabular-nums">
        {grouped ? `${rows.length} ${rows.length === 1 ? "group" : "groups"}, ${accounts} accounts` : `${rows.length} rows`}
        {lines.length > maxRows ? `, showing the first ${maxRows} lines` : ""}
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id} className={`whitespace-nowrap ${marked.has(header.column.id) ? "changed-header" : ""}`}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {lines.slice(0, maxRows).map((row) => {
              if (!row.getIsGrouped()) {
                return (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="whitespace-nowrap tabular-nums">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              }
              const count = row.getLeafRows().length;
              return (
                <TableRow key={row.id} className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={visible} className="font-medium" style={{ paddingLeft: `${0.5 + row.depth * 1.25}rem` }}>
                    {String(row.groupingValue)}{" "}
                    <span className="text-muted-foreground font-normal tabular-nums">
                      · {count} {count === 1 ? "account" : "accounts"}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
