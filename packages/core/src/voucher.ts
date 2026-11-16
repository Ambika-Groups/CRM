/**
 * Voucher numbers for money entries that are not GST documents: expenses, transfers, drawings, capital, loans (D-54,
 * PRD 11A.2 "Voucher No (auto)"). One series per financial year, from the same counters as every other number (D-12),
 * given inside the command that saves the entry, so the number is short, in order and never repeated: "V/2026-27/00042".
 * A rejected or cancelled entry keeps its number (a gap is allowed here; these are internal vouchers). An entry still
 * waiting on a phone has no number until the server saves it.
 */
import { fyOf } from "./dates";
import { allocate, counterId, type DocType } from "./numbering";
import type { MemoryStore } from "./store";

export function nextVoucherNo(store: MemoryStore, date: string): string {
  const fy = fyOf(date);
  const id = counterId("voucher", fy);
  const counter = store.get<{ next?: number }>("counters", id);
  const formats = store.get<{ formats?: Partial<Record<DocType, string>> }>("settings", "numbering")?.formats;
  const taken = allocate("voucher", fy, counter?.next, formats?.voucher);
  store.set("counters", { id, docType: "voucher", fy, next: taken.next });
  return taken.number;
}
