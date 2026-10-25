/**
 * CSV writing for exports (spec §11A.2): header row only, no merged cells, no totals row inside the data,
 * amounts with two decimals and no thousand separators, ISO dates by default, UTF-8 with BOM so Hindi
 * names open correctly in Excel.
 */

export const BOM = "﻿";

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[], opts: { bom?: boolean } = {}): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(","));
  return (opts.bom === false ? "" : BOM) + lines.join("\r\n") + "\r\n";
}

/** Parse our own CSV back (tests use it to prove every record appears exactly once). */
export function parseCsv(text: string): string[][] {
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\r") continue;
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Master CSV columns, in the spec §11A.2 groups. */
export const MASTER_COLUMNS = [
  // Voucher
  "Voucher No", "Date", "Voucher Type",
  // Project and party
  "Project code", "Project name", "Party name", "Party GSTIN",
  // Classification
  "Category (level 1)", "Subcategory (level 2)", "Item (level 3)", "Narration",
  // Bill
  "Bill/Invoice No", "Bill date", "Bill attached (Y/N)", "Bill link", "No-bill reason",
  // Tax
  "Taxable amount", "GST rate", "CGST", "SGST", "IGST", "TDS deducted", "Retention held",
  // Money
  "Total amount", "Debit", "Credit", "Payment mode", "Paid-from account", "Payment status",
  // Control
  "Entered by", "Approved by", "Entry date",
] as const;
