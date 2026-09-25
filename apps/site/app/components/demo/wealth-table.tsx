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
  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground text-xs tabular-nums">
        {rows.length} {rows[0]?.getIsGrouped() ? "groups" : "rows"}
        {rows.length > maxRows ? `, showing the first ${maxRows}` : ""}
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
            {rows.slice(0, maxRows).map((row) =>
              row.getIsGrouped() ? (
                <TableRow key={row.id} className="bg-muted/40">
                  <TableCell colSpan={visible} className="font-medium">
                    {String(row.groupingValue)}{" "}
                    <span className="text-muted-foreground font-normal tabular-nums">
                      · {row.subRows.length} {row.subRows.length === 1 ? "account" : "accounts"}
                    </span>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="whitespace-nowrap tabular-nums">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
