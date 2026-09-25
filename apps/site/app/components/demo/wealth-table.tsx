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
  // A grouped view lists every group's header, and under each the first few of its accounts with a count of the
  // rest, so no group is ever pushed off the end by an earlier one (review fixes).
  type Row = (typeof rows)[number];
  type Line = { row: Row } | { more: number; depth: number; key: string };
  // Share maxRows among the innermost groups, the ones that hold accounts, with at least three each.
  const innermost = (row: Row): number =>
    row.getIsGrouped() ? (row.subRows.some((sub) => sub.getIsGrouped()) ? row.subRows.reduce((n, sub) => n + innermost(sub), 0) : 1) : 0;
  const perGroup = Math.max(
    3,
    Math.floor(
      maxRows /
        Math.max(
          1,
          rows.reduce((n, row) => n + innermost(row), 0),
        ),
    ),
  );
  const lines: Line[] = [];
  const visit = (row: Row) => {
    lines.push({ row });
    if (!row.getIsGrouped()) return;
    const leaves = row.subRows.filter((sub) => !sub.getIsGrouped());
    for (const sub of row.subRows.filter((sub) => sub.getIsGrouped())) visit(sub);
    for (const sub of leaves.slice(0, perGroup)) lines.push({ row: sub });
    if (leaves.length > perGroup) lines.push({ more: leaves.length - perGroup, depth: row.depth + 1, key: `${row.id}-more` });
  };
  for (const row of rows) visit(row);
  const accounts = grouped ? rows.reduce((n, row) => n + row.getLeafRows().filter((leaf) => !leaf.getIsGrouped()).length, 0) : rows.length;
  // Group headers always show; accounts fill what's left of maxRows.
  const shown = grouped ? lines : lines.slice(0, maxRows);
  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground text-xs tabular-nums">
        {grouped ? `${rows.length} ${rows.length === 1 ? "group" : "groups"}, ${accounts} accounts` : `${rows.length} rows`}
        {!grouped && rows.length > maxRows ? `, showing the first ${maxRows}` : ""}
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
            {shown.map((line) => {
              if ("more" in line) {
                return (
                  <TableRow key={line.key} className="hover:bg-transparent">
                    <TableCell
                      colSpan={visible}
                      className="text-muted-foreground text-xs tabular-nums"
                      style={{ paddingLeft: `${0.5 + line.depth * 1.25}rem` }}
                    >
                      and {line.more} more {line.more === 1 ? "account" : "accounts"}
                    </TableCell>
                  </TableRow>
                );
              }
              const { row } = line;
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
              const count = row.getLeafRows().filter((leaf) => !leaf.getIsGrouped()).length;
              return (
                <TableRow key={row.id} className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={visible} className="font-medium" style={{ paddingLeft: `${0.5 + row.depth * 1.25}rem` }}>
                    {(() => {
                      // The grouped column's own cell format: "Northgate", not the value id "northgate".
                      const cell = row.getAllCells().find((c) => c.column.id === row.groupingColumnId);
                      return cell ? flexRender(cell.column.columnDef.cell, cell.getContext()) : String(row.groupingValue);
                    })()} <span className="text-muted-foreground font-normal tabular-nums">
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
