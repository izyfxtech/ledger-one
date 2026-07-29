// CSV export. Values are raw numbers (not currency-symbol-formatted
// strings) with a separate currency column, so the file is actually usable
// for math in a spreadsheet rather than just a printout.
import type { LedgerState } from "./types";
import { balanceOf } from "./selectors";

function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  // CRLF is the CSV-standard line ending and what most spreadsheet apps
  // expect; a leading BOM keeps a NGN naira sign or other special
  // characters from getting mangled when opened in Excel.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function transactionsToCsv(state: LedgerState): string {
  const domainById = new Map(state.domains.map((d) => [d.id, d]));
  const objectById = new Map(state.objects.map((o) => [o.id, o]));
  const categoryById = new Map(state.categories.map((c) => [c.id, c]));

  const rows: (string | number)[][] = [];
  for (const t of state.transactions) {
    for (const e of t.entries) {
      const obj = objectById.get(e.objectId);
      const domain = obj ? domainById.get(obj.domainId) : undefined;
      const category = e.categoryId ? categoryById.get(e.categoryId) : undefined;
      rows.push([
        t.date,
        t.description,
        t.kind,
        t.status ?? "cleared",
        domain?.name ?? "",
        obj?.name ?? e.objectId,
        category?.name ?? "",
        e.amount,
        obj?.currency ?? "",
        t.notes ?? "",
      ]);
    }
  }
  return toCsv(
    ["Date", "Description", "Kind", "Status", "Domain", "Account", "Category", "Amount", "Currency", "Notes"],
    rows,
  );
}

export function accountsToCsv(state: LedgerState): string {
  const domainById = new Map(state.domains.map((d) => [d.id, d]));
  const rows = state.objects.map((o) => [
    domainById.get(o.domainId)?.name ?? o.domainId,
    o.name,
    o.kind,
    o.institution ?? "",
    o.currency,
    balanceOf(state, o.id),
  ]);
  return toCsv(["Domain", "Account", "Kind", "Institution", "Currency", "Balance"], rows);
}
