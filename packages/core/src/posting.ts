/**
 * Delta posting (decisions D-07, D-08). The single code path that turns source records (expenses,
 * attendance, wage payments, receipts, invoices, transfers) into rollups, balances and account rows.
 *
 * For every event:
 *  1. re-read the source record (never trust an event snapshot);
 *  2. compute its current effect as per-target amounts;
 *  3. delta = new − posted, per target (so moving date/project/category/account moves the amount);
 *  4. if nothing changes, write nothing;
 *  5. refuse if any month with a non-zero delta is locked;
 *  6. apply increments, upsert/remove account rows, save the new posting.
 * The same function runs in demo mode (browser store) and in Cloud Functions (Firestore transaction).
 */
import { fyOf, monthKeyOf } from "./dates";
import { attendanceEarned, defaultOtRatePaise } from "./wages";
import type {
  AccountTransfer, AccountTxn, Attendance, Expense, Invoice, PaymentReceived, WorkerPayment,
} from "./model";

/** "collection/docId|field.path" → amount. */
export type Targets = Record<string, number>;

export interface Posting {
  entity: string;
  docId: string;
  targets: Targets;
  /** Account rows this record owns, by ID. */
  accountTxnIds: string[];
  /** Months the effect touched (for lock checks on reversal). */
  months: string[];
}

export interface Effect {
  targets: Targets;
  accountTxns: AccountTxn[];
  months: string[];
}

export const EMPTY_EFFECT: Effect = { targets: {}, accountTxns: [], months: [] };

export type PostableEntity =
  | "expenses" | "attendance" | "worker_payments" | "payments_received" | "invoices" | "account_transfers";

export const POSTABLE: readonly PostableEntity[] = [
  "expenses", "attendance", "worker_payments", "payments_received", "invoices", "account_transfers",
];

export function postingId(entity: string, docId: string): string {
  return `${entity}_${docId}`;
}

export function targetKey(doc: string, field: string): string {
  return `${doc}|${field}`;
}

export function splitTarget(key: string): { doc: string; field: string } {
  const i = key.indexOf("|");
  return { doc: key.slice(0, i), field: key.slice(i + 1) };
}

/** Rollup document IDs a dated, project-scoped record touches. */
export function rollupDocs(collection: "rollups" | "finance_rollups", projectId: string | null | undefined, monthKey: string): string[] {
  const docs = [`${collection}/co_${monthKey}`];
  if (projectId) docs.push(`${collection}/p_${projectId}_${monthKey}`, `${collection}/p_${projectId}_all`);
  return docs;
}

class EffectBuilder {
  targets: Targets = {};
  accountTxns: AccountTxn[] = [];
  months = new Set<string>();
  add(doc: string, field: string, amount: number) {
    if (!amount) return;
    const k = targetKey(doc, field);
    this.targets[k] = (this.targets[k] ?? 0) + amount;
  }
  addAll(docs: string[], field: string, amount: number) {
    for (const d of docs) this.add(d, field, amount);
  }
  build(): Effect {
    return { targets: this.targets, accountTxns: this.accountTxns, months: [...this.months] };
  }
}

/** Derive month and FY from the date (never from stored fields, D-13). */
function period(date: string) {
  return { monthKey: monthKeyOf(date), fy: fyOf(date) };
}

function accountMovement(b: EffectBuilder, txn: Omit<AccountTxn, "monthKey" | "fy">) {
  const { monthKey, fy } = period(txn.date);
  b.accountTxns.push({ ...txn, monthKey, fy });
  const field = txn.directionSign > 0 ? "inPaise" : "outPaise";
  b.add(`finance_rollups/co_${monthKey}`, `accounts.${txn.accountId}.${field}`, txn.amountPaise);
  b.add(`accounts/${txn.accountId}`, "balancePaise", txn.directionSign * txn.amountPaise);
}

export function expenseEffect(e: Expense): Effect {
  if (e.isDeleted || e.approvalStatus !== "approved") return EMPTY_EFFECT;
  const b = new EffectBuilder();
  const { monthKey } = period(e.date);
  b.months.add(monthKey);
  const gst = (e.cgstPaise ?? 0) + (e.sgstPaise ?? 0) + (e.igstPaise ?? 0);
  const paid = e.mode !== "credit";
  const cat = e.categoryId;
  const docs = rollupDocs("rollups", e.projectId, monthKey);
  b.addAll(docs, `expense.approvedPaise.${cat}`, e.amountPaise);
  b.addAll(docs, `expense.gstPaise.${cat}`, gst);
  b.addAll(docs, `expense.paidPaise.${cat}`, paid ? e.amountPaise : 0);
  b.addAll(docs, `expense.count.${cat}`, 1);
  b.addAll(docs, "expenseTotalPaise", e.amountPaise);
  b.addAll(docs, "expensePaidPaise", paid ? e.amountPaise : 0);
  b.addAll(docs, "expenseGstPaise", gst);
  b.addAll(rollupDocs("finance_rollups", e.projectId, monthKey), "gstInputPaise", gst);
  if (!paid && e.payeeType === "vendor" && e.payeeId) {
    b.add(`vendor_balances/${e.payeeId}`, "payablePaise", e.amountPaise);
    b.addAll(rollupDocs("finance_rollups", e.projectId, monthKey), "vendorBilledPaise", e.amountPaise);
  }
  // Generated expenses never move money; the source payment does (D-16).
  if (e.source === "manual" && paid && e.accountId) {
    accountMovement(b, {
      id: `expenses_${e.id}`, accountId: e.accountId, date: e.date, type: "payment", directionSign: -1,
      amountPaise: e.amountPaise, linkedEntity: "expenses", linkedId: e.id, projectId: e.projectId,
      partyName: e.payeeName ?? "", narration: e.description ?? "",
    });
  }
  return b.build();
}

export function attendanceEffect(a: Attendance): Effect {
  const b = new EffectBuilder();
  const { monthKey } = period(a.date);
  b.months.add(monthKey);
  const earned = a.earnedPaise ?? attendanceEarned(a.status, a.payType ?? "daily", a.rateSnapshotPaise ?? 0,
    a.otRateSnapshotPaise ?? defaultOtRatePaise(a.rateSnapshotPaise ?? 0), a.otHoursMilli ?? 0);
  const pm = `rollups/p_${a.projectId}_${monthKey}`;
  b.add(pm, `attendance.${a.status}`, 1);
  b.add(pm, "attendance.otHoursMilli", a.otHoursMilli ?? 0);
  b.addAll(rollupDocs("rollups", a.projectId, monthKey), "wagesEarnedPaise", earned);
  b.add(`worker_balances/${a.workerId}_${a.projectId}`, "earnedPaise", earned);
  return b.build();
}

export function workerPaymentEffect(p: WorkerPayment): Effect {
  if (p.isDeleted || p.approvalStatus !== "approved") return EMPTY_EFFECT;
  const b = new EffectBuilder();
  const { monthKey } = period(p.date);
  b.months.add(monthKey);
  const bal = `worker_balances/${p.workerId}_${p.projectId}`;
  const recovered = p.advanceRecoveredPaise ?? 0;
  const tds = p.tdsPaise ?? 0;
  switch (p.type) {
    case "wage":
    case "bonus":
    case "thekedar_bill":
      b.add(bal, "paidPaise", p.grossPaise);
      b.add(bal, "advanceRecoveredPaise", recovered);
      b.addAll(rollupDocs("rollups", p.projectId, monthKey), "wagesExpensedPaise", p.grossPaise);
      b.addAll(rollupDocs("finance_rollups", p.projectId, monthKey), "tdsDeductedPaise", tds);
      break;
    case "advance":
      b.add(bal, "advanceGivenPaise", p.grossPaise);
      break;
    case "advance_writeoff":
      b.add(bal, "advanceWrittenOffPaise", p.grossPaise);
      break;
  }
  if (p.netPaidPaise > 0 && p.accountId) {
    accountMovement(b, {
      id: `worker_payments_${p.id}`, accountId: p.accountId, date: p.date, type: "payment", directionSign: -1,
      amountPaise: p.netPaidPaise, linkedEntity: "worker_payments", linkedId: p.id, projectId: p.projectId,
      partyName: p.workerName ?? "", narration: `${p.type.replace("_", " ")}${p.remarks ? `: ${p.remarks}` : ""}`,
    });
  }
  return b.build();
}

const BILLED_TYPES: ReadonlySet<string> = new Set(["tax", "ra", "milestone", "debit_note"]);
const ISSUED: ReadonlySet<string> = new Set(["sent", "partially_paid", "paid", "overdue"]);

/** Billed = issued tax, RA and milestone invoices − credit notes + debit notes; drafts, proforma, cancelled excluded (D-20, D-24). */
export function invoiceEffect(inv: Invoice): Effect {
  if (inv.isDeleted || !ISSUED.has(inv.status) || !inv.totals) return EMPTY_EFFECT;
  const sign = inv.type === "credit_note" ? -1 : BILLED_TYPES.has(inv.type) ? 1 : 0;
  if (!sign) return EMPTY_EFFECT;
  const b = new EffectBuilder();
  const { monthKey } = period(inv.date);
  b.months.add(monthKey);
  const docs = rollupDocs("finance_rollups", inv.projectId, monthKey);
  const gst = inv.totals.cgstPaise + inv.totals.sgstPaise + inv.totals.igstPaise;
  b.addAll(docs, "billedPaise", sign * inv.totals.totalPaise);
  b.addAll(docs, "gstOutputPaise", sign * gst);
  b.add(`client_balances/${inv.clientId}`, "billedPaise", sign * inv.totals.totalPaise);
  return b.build();
}

export function receiptEffect(r: PaymentReceived): Effect {
  if (r.isDeleted) return EMPTY_EFFECT;
  const b = new EffectBuilder();
  const { monthKey } = period(r.date);
  b.months.add(monthKey);
  const docs = rollupDocs("finance_rollups", r.projectId, monthKey);
  if (r.isAdvance) b.addAll(docs, "clientAdvanceReceivedPaise", r.amountPaise);
  else b.addAll(docs, "receivedPaise", r.amountPaise);
  b.addAll(docs, "tdsHeldPaise", r.tdsPaise ?? 0);
  b.addAll(docs, "retentionHeldPaise", r.retentionPaise ?? 0);
  b.add(`client_balances/${r.clientId}`, "receivedPaise", r.amountPaise + (r.tdsPaise ?? 0) + (r.retentionPaise ?? 0) + (r.otherDeductionsPaise ?? 0));
  if (r.invoiceId) b.add(`invoices/${r.invoiceId}`, "paidPaise", r.amountPaise + (r.tdsPaise ?? 0) + (r.retentionPaise ?? 0) + (r.otherDeductionsPaise ?? 0));
  accountMovement(b, {
    id: `payments_received_${r.id}`, accountId: r.accountId, date: r.date, type: "receipt", directionSign: 1,
    amountPaise: r.amountPaise, linkedEntity: "payments_received", linkedId: r.id, projectId: r.projectId,
    partyName: r.clientName ?? "", narration: r.isAdvance ? "Client advance" : "Payment received",
  });
  return b.build();
}

export function transferEffect(t: AccountTransfer): Effect {
  if (t.isDeleted || (t.approvalStatus && t.approvalStatus !== "approved")) return EMPTY_EFFECT;
  const b = new EffectBuilder();
  const { monthKey } = period(t.date);
  b.months.add(monthKey);
  const kindType = { transfer: "transfer", drawing: "drawing", capital: "capital", loan_in: "loan_in", loan_repay: "loan_out" } as const;
  if (t.fromAccountId) {
    accountMovement(b, {
      id: `account_transfers_${t.id}_out`, accountId: t.fromAccountId, date: t.date, type: kindType[t.kind], directionSign: -1,
      amountPaise: t.amountPaise, linkedEntity: "account_transfers", linkedId: t.id, narration: t.narration ?? "",
    });
  }
  if (t.toAccountId) {
    accountMovement(b, {
      id: `account_transfers_${t.id}_in`, accountId: t.toAccountId, date: t.date, type: kindType[t.kind], directionSign: 1,
      amountPaise: t.amountPaise, linkedEntity: "account_transfers", linkedId: t.id, narration: t.narration ?? "",
    });
  }
  return b.build();
}

export function effectOf(entity: PostableEntity, doc: unknown): Effect {
  if (!doc) return EMPTY_EFFECT;
  switch (entity) {
    case "expenses": return expenseEffect(doc as Expense);
    case "attendance": return attendanceEffect(doc as Attendance);
    case "worker_payments": return workerPaymentEffect(doc as WorkerPayment);
    case "invoices": return invoiceEffect(doc as Invoice);
    case "payments_received": return receiptEffect(doc as PaymentReceived);
    case "account_transfers": return transferEffect(doc as AccountTransfer);
  }
}

/** delta = new − old for every target in either map; zero deltas are dropped. */
export function diffTargets(oldT: Targets, newT: Targets): Targets {
  const out: Targets = {};
  for (const k of new Set([...Object.keys(oldT), ...Object.keys(newT)])) {
    const d = (newT[k] ?? 0) - (oldT[k] ?? 0);
    if (d) out[k] = d;
  }
  return out;
}

function sameTxns(a: AccountTxn[], ids: string[], stored: Record<string, AccountTxn | null>): boolean {
  if (a.length !== ids.length) return false;
  return a.every((t) => {
    const s = stored[t.id];
    return !!s && s.accountId === t.accountId && s.amountPaise === t.amountPaise && s.date === t.date &&
      s.directionSign === t.directionSign && s.type === t.type;
  });
}

/** Storage operations the engine needs. Demo store and the Firestore transaction adapter both implement it. */
export interface PostingTx {
  getSource(entity: PostableEntity, docId: string): Promise<unknown | null>;
  getPosting(id: string): Promise<Posting | null>;
  getAccountTxn(id: string): Promise<AccountTxn | null>;
  isLocked(monthKey: string): Promise<boolean>;
  increment(docPath: string, fieldPath: string, delta: number): void;
  putAccountTxn(txn: AccountTxn): void;
  deleteAccountTxn(id: string): void;
  putPosting(id: string, p: Posting): void;
  setSourceField(entity: PostableEntity, docId: string, field: string, value: unknown): void;
}

export interface PostResult {
  changed: boolean;
  error?: string;
  deltas?: Targets;
}

export async function post(tx: PostingTx, entity: PostableEntity, docId: string, nowIso: string): Promise<PostResult> {
  const source = await tx.getSource(entity, docId);
  const effect = effectOf(entity, source);
  const pid = postingId(entity, docId);
  const old = (await tx.getPosting(pid)) ?? { entity, docId, targets: {}, accountTxnIds: [], months: [] };
  const deltas = diffTargets(old.targets, effect.targets);

  const storedTxns: Record<string, AccountTxn | null> = {};
  for (const id of old.accountTxnIds) storedTxns[id] = await tx.getAccountTxn(id);
  const txnsSame = sameTxns(effect.accountTxns, old.accountTxnIds, storedTxns);

  if (Object.keys(deltas).length === 0 && txnsSame) return { changed: false };

  const months = new Set<string>();
  for (const k of Object.keys(deltas)) {
    const m = /_(\d{4}-\d{2})\|/.exec(k);
    if (m) months.add(m[1]!);
  }
  if (!txnsSame) for (const m of [...old.months, ...effect.months]) months.add(m);
  for (const m of months) {
    if (await tx.isLocked(m)) {
      const error = `${m} is closed. Ask the owner to reopen it, or record an adjustment in an open month.`;
      if (source) tx.setSourceField(entity, docId, "postingError", error);
      return { changed: false, error };
    }
  }

  for (const [k, d] of Object.entries(deltas)) {
    const { doc, field } = splitTarget(k);
    tx.increment(doc, field, d);
  }
  const newIds = new Set(effect.accountTxns.map((t) => t.id));
  for (const id of old.accountTxnIds) if (!newIds.has(id)) tx.deleteAccountTxn(id);
  for (const t of effect.accountTxns) tx.putAccountTxn({ ...t, voucherNo: storedTxns[t.id]?.voucherNo ?? null, postedAt: nowIso });
  tx.putPosting(pid, { entity, docId, targets: effect.targets, accountTxnIds: [...newIds], months: effect.months });
  if (source && (source as { postingError?: unknown }).postingError) tx.setSourceField(entity, docId, "postingError", null);
  return { changed: true, deltas };
}
