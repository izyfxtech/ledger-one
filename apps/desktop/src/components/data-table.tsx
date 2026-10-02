import { useRef } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

// One table component for every list in the app, built on TanStack Table
// (columns, sorting, row model) and TanStack Virtual (windowed rows once a
// list is long). Replaces ~6 hand-written <table> blocks that each repeated
// the same thead/tbody/className boilerplate.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- column value types vary per column
export type Col<T> = ColumnDef<T, any> & {
  /** Tailwind classes for both header and cells, e.g. "text-right w-24". */
  className?: string;
};

type Props<T> = {
  data: T[];
  columns: Col<T>[];
  getRowId?: (row: T) => string;
  rowClassName?: (row: T) => string;
  empty?: React.ReactNode;
  /** Render only visible rows inside a fixed-height scroller. */
  virtualize?: boolean | { maxHeight?: number; rowHeight?: number };
  initialSort?: SortingState;
  /** No outer border/rounding — for tables already inside a card. */
  bare?: boolean;
};

const TH = "px-4 py-2 font-medium text-left";
const TD = "px-4 py-2.5";

export function DataTable<T>({
  data,
  columns,
  getRowId,
  rowClassName,
  empty,
  virtualize,
  initialSort = [],
  bare,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = typeof virtualize === "object" ? virtualize : {};
  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => v.rowHeight ?? 41,
    overscan: 12,
  });

  const cls = (c: unknown) => (c as Col<T>).className ?? "";

  const renderRow = (row: Row<T>, style?: React.CSSProperties) => (
    <tr
      key={row.id}
      style={style}
      className={["hover:bg-accent/40 transition-colors", rowClassName?.(row.original) ?? ""].join(
        " ",
      )}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className={`${TD} ${cls(cell.column.columnDef)}`}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );

  if (rows.length === 0 && empty) return <>{empty}</>;

  const items = virtualize ? virtualizer.getVirtualItems() : [];
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div className={bare ? "" : "border border-border rounded-lg bg-card overflow-hidden"}>
      <div
        ref={scrollRef}
        className={virtualize ? "overflow-y-auto" : undefined}
        style={virtualize ? { maxHeight: v.maxHeight ?? 640 } : undefined}
      >
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      className={`${TH} ${cls(h.column.columnDef)} ${sortable ? "cursor-pointer select-none" : ""}`}
                      onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" && <ArrowUp className="size-3" />}
                        {dir === "desc" && <ArrowDown className="size-3" />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border">
            {virtualize ? (
              <>
                {padTop > 0 && <tr style={{ height: padTop }} />}
                {items.map((it) => renderRow(rows[it.index]))}
                {padBottom > 0 && <tr style={{ height: padBottom }} />}
              </>
            ) : (
              rows.map((r) => renderRow(r))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
