/**
 * The single master CSV for the CA (spec §11A.2) and the check that it agrees with the books (§11A.7: "export totals
 * equal dashboard totals for the same filters"; §3.1 rule 5: cash book, bank book, dashboard and CSV always agree).
 *
 * One row per transaction line, built from the stored records themselves:
 *   Expense         every approved expense (manual, purchases, machinery, bank charges…)
 *   Wage payment    every approved payment to a worker or thekedar; its generated Labour expense is this same row (D-16)
 *   Vendor payment  payments against vendor bills, when that module's records are given
 *   Sales invoice   issued tax, RA and milestone invoices and debit notes (D-20, D-24); Credit note for credit notes
 *   Receipt         payments received from clients
 *   Transfer        money between own accounts, as two lines (into one account, out of the other)
 *   Journal         owner's drawings, capital introduced, loans taken and repaid, interest received
 * Every record appears exactly once. The totals check sums what each row stands for and compares it with the same
 * monthly rollups the dashboard reads (D-09), account by account, to the paisa.
 */
import { ENTRY_DIRECTION, ENTRY_KIND_NAMES, type MoneyEntry } from "./accounts";
import { CategoryTree, type Category } from "./categories";
import { MASTER_COLUMNS, toCsv, type CsvColumn } from "./csv";
import { monthsBetween } from "./dashboard";
import { csvDate, fyRange, isDateStr, todayIST } from "./dates";
import type { Account, Client, Expense, Invoice, PaymentMode, PaymentReceived, Project, WorkerPayment } from "./model";
import { csvAmount } from "./money";
import { expenseEffect, type Effect } from "./posting";
import { sumCost, sumFinance, type CostRollup, type FinanceRollup } from "./rollups";
import type { MemoryStore } from "./store";

export type VoucherType = "Expense" | "Wage payment" | "Vendor payment" | "Sales invoice" | "Receipt" | "Credit note" | "Transfer" | "Journal";
export const VOUCHER_TYPES: readonly VoucherType[] = ["Expense", "Wage payment", "Vendor payment", "Sales invoice", "Credit note", "Receipt", "Transfer", "Journal"];

/** What the rollups (and so the dashboard) hold for the same records. */
export interface MasterFigures {
  /** Total expense (D-20): approved, paid and unpaid. */
  expensePaise: number;
  /** GST inside those expenses (input tax). */
  expenseGstPaise: number;
  /** Gross wages, bonuses and thekedar bills settled. */
  wagesPaise: number;
  billedPaise: number;
  gstOutputPaise: number;
  /** Received against invoices; client advances are separate (D-16b). */
  receivedPaise: number;
  clientAdvancePaise: number;
  /** TDS and retention the clients held back on receipts. */
  tdsHeldPaise: number;
  retentionHeldPaise: number;
  /** TDS the company deducted from thekedar bills. */
  tdsDeductedPaise: number;
}
export const FIGURE_KEYS = ["expensePaise", "expenseGstPaise", "wagesPaise", "billedPaise", "gstOutputPaise", "receivedPaise", "clientAdvancePaise", "tdsHeldPaise", "retentionHeldPaise", "tdsDeductedPaise"] as const satisfies readonly (keyof MasterFigures)[];

export interface MasterRow {
  voucherNo: string; date: string; voucherType: VoucherType;
  projectCode: string; projectName: string; partyName: string; partyGstin: string;
  category1: string; category2: string; category3: string; narration: string;
  billNo: string; billDate: string; billAttached: "Y" | "N" | ""; billLink: string; noBillReason: string;
  taxablePaise: number | null; gstRateBp: number | null; cgstPaise: number | null; sgstPaise: number | null; igstPaise: number | null;
  tdsPaise: number | null; retentionPaise: number | null;
  totalPaise: number; debitPaise: number | null; creditPaise: number | null; mode: string; account: string; paymentStatus: "Paid" | "Unpaid" | "Part" | "";
  enteredBy: string; approvedBy: string; entryDate: string;
  // Not written to the file: what the line stands for.
  source: { entity: string; id: string; line: number };
  projectId: string | null;
  figures: Partial<MasterFigures>;
  /** Money this line moved in or out of an account. */
  moves: { accountId: string; sign: 1 | -1; amountPaise: number }[];
}

/** A payment to a vendor (Lane B's `vendor_payments`), as far as the CSV needs it. */
export interface VendorPaymentLike {
  id: string; vendorName?: string; vendorGstin?: string; projectId?: string | null; date: string; amountPaise: number; tdsPaise?: number;
  mode?: PaymentMode; accountId?: string | null; reference?: string; voucherNo?: string | null; isDeleted?: boolean; approvalStatus?: string;
  createdBy?: string; createdAt?: string; approvedBy?: string;
}

export interface MasterInput {
  from: string;
  to: string;
  /** Only this project's records. Transfers and journal entries belong to no project and are left out. */
  projectId?: string | null;
  expenses: Expense[];
  workerPayments: WorkerPayment[];
  invoices: Invoice[];
  receipts: PaymentReceived[];
  transfers: MoneyEntry[];
  vendorPayments?: VendorPaymentLike[];
  accounts: Pick<Account, "id" | "name">[];
  categories: Category[];
  projects: Pick<Project, "id" | "code" | "name">[];
  clients?: Pick<Client, "id" | "gstin">[];
  users?: { id: string; name: string }[];
  /** What the posting engine posts for an expense. Default: the engine's own `expenseEffect` (tests may pass another). */
  expenseEffect?: (e: Expense) => Effect;
}

const MODE_NAMES: Record<string, string> = { cash: "Cash", upi: "UPI", bank: "Bank transfer", cheque: "Cheque", credit: "Credit" };
const ISSUED: ReadonlySet<string> = new Set(["sent", "partially_paid", "paid", "overdue"]);
const BILLED_TYPES: ReadonlySet<string> = new Set(["tax", "ra", "milestone", "debit_note"]);
const WAGE_EXPENSE_TYPES: ReadonlySet<string> = new Set(["wage", "bonus", "thekedar_bill"]);
const PAY_NAMES: Record<string, string> = { wage: "Wages", advance: "Advance to worker", bonus: "Bonus", thekedar_bill: "Thekedar bill", advance_writeoff: "Advance written off" };

/** The date a record was entered, as an IST date. */
function entryDay(createdAt?: string): string {
  if (!createdAt) return "";
  const t = Date.parse(createdAt);
  return Number.isNaN(t) ? "" : todayIST(new Date(t));
}

/** Build the master rows for a date range from the records given (callers may pass more than the range; it filters). */
export function buildMasterRows(i: MasterInput): MasterRow[] {
  const inRange = (d: string) => isDateStr(d) && d >= i.from && d <= i.to;
  const inProject = (pid: string | null | undefined) => !i.projectId || pid === i.projectId;
  const accountName = new Map(i.accounts.map((a) => [a.id, a.name]));
  const project = new Map(i.projects.map((p) => [p.id, p]));
  const user = new Map((i.users ?? []).map((u) => [u.id, u.name]));
  const gstin = new Map((i.clients ?? []).map((c) => [c.id, c.gstin ?? ""]));
  const tree = new CategoryTree(i.categories);
  const levels = (categoryId: string | null | undefined): [string, string, string] => {
    if (!categoryId || !tree.byId.has(categoryId)) return ["", "", ""];
    const names = tree.pathOf(categoryId).map((x) => tree.byId.get(x)!.name);
    return [names[0] ?? "", names[1] ?? "", names.slice(2).join(" > ")];
  };
  const who = (uid?: string | null) => (uid ? user.get(uid) ?? (uid === "system" ? "System" : uid) : "");
  const acc = (id?: string | null) => (id ? accountName.get(id) ?? "" : "");
  const base = (pid: string | null | undefined) => {
    const p = pid ? project.get(pid) : undefined;
    return { projectId: pid ?? null, projectCode: p?.code ?? "", projectName: p?.name ?? "" };
  };
  const blank = {
    partyGstin: "", category1: "", category2: "", category3: "", billNo: "", billDate: "", billAttached: "" as const, billLink: "", noBillReason: "",
    taxablePaise: null, gstRateBp: null, cgstPaise: null, sgstPaise: null, igstPaise: null, tdsPaise: null, retentionPaise: null,
    debitPaise: null, creditPaise: null, mode: "", account: "", paymentStatus: "" as const, approvedBy: "",
  };
  const rows: MasterRow[] = [];

  const expenses = i.expenses.filter((e) => !e.isDeleted && e.approvalStatus === "approved" && inRange(e.date) && inProject(e.projectId));
  const expenseById = new Map(expenses.map((e) => [e.id, e]));
  const payments = i.workerPayments.filter((p) => !p.isDeleted && p.approvalStatus === "approved" && inRange(p.date) && inProject(p.projectId));
  const paymentIds = new Set(payments.map((p) => p.id));
  const entries = i.transfers.filter((t) => !t.isDeleted && (!t.approvalStatus || t.approvalStatus === "approved") && inRange(t.date));
  const entryById = new Map(entries.map((t) => [t.id, t]));
  const usedByExpense = new Set<string>();

  // ---------- expenses ----------
  // The money an expense moved is whatever the posting engine posts for it (one source of truth, D-08). A credit
  // purchase paid on a later day moves money on that day: it gets its own "Vendor payment" line, dated then.
  const postedFor = i.expenseEffect ?? expenseEffect;
  for (const e of i.expenses) {
    if (e.isDeleted || e.approvalStatus !== "approved" || !inProject(e.projectId)) continue;
    const posted = postedFor(e).accountTxns;
    const later = posted.filter((t) => t.date !== e.date);
    for (const t of later) {
      if (!inRange(t.date)) continue;
      rows.push({
        ...blank, ...base(e.projectId), voucherNo: e.voucherNo ? `${e.voucherNo}/P` : `PAY-${e.id}`, date: t.date, voucherType: "Vendor payment",
        partyName: e.payeeName ?? "", partyGstin: e.partyGstin ?? "", narration: [`Payment of the purchase dated ${e.date}`, e.description ?? ""].filter(Boolean).join("; "),
        billNo: e.billNo ?? "", billDate: e.billDate ?? "", totalPaise: t.amountPaise, debitPaise: t.amountPaise, mode: MODE_NAMES[e.mode] ?? e.mode, account: acc(t.accountId),
        paymentStatus: "Paid", enteredBy: who(e.updatedBy ?? e.createdBy), approvedBy: who(e.approvedBy), entryDate: entryDay(e.updatedAt ?? e.createdAt),
        source: { entity: "expenses", id: e.id, line: 2 }, figures: {}, moves: [{ accountId: t.accountId, sign: t.directionSign, amountPaise: t.amountPaise }],
      });
    }
    if (!inRange(e.date)) continue;
    // A wage payment's Labour expense is carried by the payment's own row, so the wage appears once.
    if (e.source === "wage" && e.sourceRef?.entity === "worker_payments" && paymentIds.has(e.sourceRef.id)) continue;
    const gst = (e.cgstPaise ?? 0) + (e.sgstPaise ?? 0) + (e.igstPaise ?? 0);
    const [c1, c2, c3] = levels(e.categoryId);
    const files = (e as Expense & { billFiles?: { path: string }[]; files?: { path: string }[] });
    const billLink = e.billPaths?.[0] ?? files.billFiles?.[0]?.path ?? files.files?.[0]?.path ?? "";
    const onCredit = e.mode === "credit" || later.length > 0;
    const moves: MasterRow["moves"] = posted.filter((t) => t.date === e.date).map((t) => ({ accountId: t.accountId, sign: t.directionSign, amountPaise: t.amountPaise }));
    let account = onCredit ? "" : acc(e.accountId);
    // Bank charges: the money entry moved the money (D-16); it is shown on the expense it generated.
    const entry = e.source === "bank_charge" && e.sourceRef?.entity === "account_transfers" ? entryById.get(e.sourceRef.id) : undefined;
    if (entry?.fromAccountId) {
      moves.push({ accountId: entry.fromAccountId, sign: -1, amountPaise: entry.amountPaise });
      account = acc(entry.fromAccountId);
      usedByExpense.add(entry.id);
    }
    rows.push({
      ...blank, ...base(e.projectId), voucherNo: e.voucherNo || `EXP-${e.id}`, date: e.date, voucherType: "Expense",
      partyName: e.payeeName ?? "", partyGstin: e.partyGstin ?? "", category1: c1, category2: c2, category3: c3, narration: e.description ?? "",
      billNo: e.billNo ?? "", billDate: e.billDate ?? "", billAttached: billLink ? "Y" : "N", billLink, noBillReason: e.noBillReason ?? "",
      taxablePaise: e.taxablePaise ?? e.amountPaise - gst, gstRateBp: e.gstRateBp ?? null, cgstPaise: e.cgstPaise ?? 0, sgstPaise: e.sgstPaise ?? 0, igstPaise: e.igstPaise ?? 0,
      tdsPaise: e.tdsPaise ?? 0, totalPaise: e.amountPaise, debitPaise: e.amountPaise, mode: onCredit ? MODE_NAMES.credit! : MODE_NAMES[e.mode] ?? e.mode, account,
      paymentStatus: e.paidStatus === "part" ? "Part" : e.paidStatus === "unpaid" || (!e.paidStatus && e.mode === "credit") ? "Unpaid" : "Paid",
      enteredBy: e.enteredByName || who(e.enteredBy ?? e.createdBy), approvedBy: who(e.approvedBy), entryDate: entryDay(e.createdAt),
      source: { entity: "expenses", id: e.id, line: 1 }, figures: { expensePaise: e.amountPaise, expenseGstPaise: gst }, moves,
    });
  }

  // ---------- payments to workers and thekedars ----------
  for (const p of payments) {
    const exp = expenseById.get(`wage_${p.id}`);
    const [c1, c2, c3] = levels(exp?.categoryId);
    const recovered = p.advanceRecoveredPaise ?? 0;
    const tds = p.tdsPaise ?? 0;
    const notes = [PAY_NAMES[p.type] ?? p.type, p.remarks ?? "", recovered ? `advance recovered ${csvAmount(recovered)}` : "", p.netPaidPaise !== p.grossPaise ? `net paid ${csvAmount(p.netPaidPaise)}` : "", p.reference ? `Ref ${p.reference}` : ""];
    rows.push({
      ...blank, ...base(p.projectId), voucherNo: p.voucherNo || `WAGE-${p.id}`, date: p.date, voucherType: "Wage payment",
      partyName: p.workerName ?? "", category1: c1, category2: c2, category3: c3, narration: notes.filter(Boolean).join("; "),
      tdsPaise: tds, totalPaise: p.grossPaise, debitPaise: p.grossPaise, mode: p.netPaidPaise > 0 ? MODE_NAMES[p.mode] ?? p.mode : "", account: acc(p.accountId),
      paymentStatus: "Paid", enteredBy: who(p.createdBy), approvedBy: who((p as WorkerPayment & { approvedBy?: string }).approvedBy), entryDate: entryDay(p.createdAt),
      source: { entity: "worker_payments", id: p.id, line: 1 },
      figures: { expensePaise: exp?.amountPaise ?? 0, wagesPaise: WAGE_EXPENSE_TYPES.has(p.type) ? p.grossPaise : 0, tdsDeductedPaise: WAGE_EXPENSE_TYPES.has(p.type) ? tds : 0 },
      moves: p.netPaidPaise > 0 && p.accountId ? [{ accountId: p.accountId, sign: -1, amountPaise: p.netPaidPaise }] : [],
    });
  }

  // ---------- payments to vendors (Lane B) ----------
  for (const v of i.vendorPayments ?? []) {
    if (v.isDeleted || (v.approvalStatus && v.approvalStatus !== "approved") || !inRange(v.date) || !inProject(v.projectId)) continue;
    rows.push({
      ...blank, ...base(v.projectId), voucherNo: v.voucherNo || `VP-${v.id}`, date: v.date, voucherType: "Vendor payment",
      partyName: v.vendorName ?? "", partyGstin: v.vendorGstin ?? "", narration: ["Payment to vendor", v.reference ? `Ref ${v.reference}` : ""].filter(Boolean).join("; "),
      tdsPaise: v.tdsPaise ?? 0, totalPaise: v.amountPaise, debitPaise: v.amountPaise, mode: v.mode ? MODE_NAMES[v.mode] ?? v.mode : "", account: acc(v.accountId),
      paymentStatus: "Paid", enteredBy: who(v.createdBy), approvedBy: who(v.approvedBy), entryDate: entryDay(v.createdAt),
      source: { entity: "vendor_payments", id: v.id, line: 1 }, figures: {},
      moves: v.accountId ? [{ accountId: v.accountId, sign: -1, amountPaise: v.amountPaise }] : [],
    });
  }

  // ---------- sales invoices and credit notes ----------
  for (const inv of i.invoices) {
    if (inv.isDeleted || !ISSUED.has(inv.status) || !inv.totals || !inRange(inv.date) || !inProject(inv.projectId)) continue;
    const credit = inv.type === "credit_note";
    if (!credit && !BILLED_TYPES.has(inv.type)) continue; // proforma is not a sale (D-24)
    const t = inv.totals;
    const gst = t.cgstPaise + t.sgstPaise + t.igstPaise;
    const rates = [...new Set(inv.items.map((x) => x.gstRateBp))];
    const sign = credit ? -1 : 1;
    rows.push({
      ...blank, ...base(inv.projectId), voucherNo: inv.number ?? `INV-${inv.id}`, date: inv.date, voucherType: credit ? "Credit note" : "Sales invoice",
      partyName: inv.clientName ?? "", partyGstin: inv.clientGstin || gstin.get(inv.clientId) || "",
      narration: [inv.type === "ra" ? "RA bill" : inv.type === "milestone" ? "Milestone bill" : inv.type === "debit_note" ? "Debit note" : credit ? "Credit note" : "Tax invoice",
        inv.items[0]?.description ?? "", inv.items.length > 1 ? `and ${inv.items.length - 1} more` : "", rates.length > 1 ? "mixed GST rates" : ""].filter(Boolean).join("; "),
      billNo: inv.number ?? "", billDate: inv.date, taxablePaise: t.taxablePaise, gstRateBp: rates.length === 1 ? rates[0]! : null,
      cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise, totalPaise: t.totalPaise,
      debitPaise: credit ? t.totalPaise : null, creditPaise: credit ? null : t.totalPaise,
      paymentStatus: credit ? "" : inv.status === "paid" ? "Paid" : inv.status === "partially_paid" ? "Part" : "Unpaid",
      enteredBy: who(inv.createdBy), entryDate: entryDay(inv.createdAt),
      source: { entity: "invoices", id: inv.id, line: 1 }, figures: { billedPaise: sign * t.totalPaise, gstOutputPaise: sign * gst }, moves: [],
    });
  }

  // ---------- receipts ----------
  const invoiceNo = new Map(i.invoices.map((x) => [x.id, x.number ?? ""]));
  for (const r of i.receipts) {
    if (r.isDeleted || !inRange(r.date) || !inProject(r.projectId)) continue;
    rows.push({
      ...blank, ...base(r.projectId), voucherNo: r.receiptNo || `RCPT-${r.id}`, date: r.date, voucherType: "Receipt",
      partyName: r.clientName ?? "", partyGstin: gstin.get(r.clientId) ?? "",
      narration: [r.isAdvance ? "Client advance" : "Payment received", r.otherDeductionsPaise ? `other deductions ${csvAmount(r.otherDeductionsPaise)}` : "", r.reference ? `Ref ${r.reference}` : ""].filter(Boolean).join("; "),
      billNo: r.invoiceId ? invoiceNo.get(r.invoiceId) ?? "" : "", tdsPaise: r.tdsPaise ?? 0, retentionPaise: r.retentionPaise ?? 0,
      totalPaise: r.amountPaise, creditPaise: r.amountPaise, mode: MODE_NAMES[r.mode] ?? r.mode, account: acc(r.accountId), paymentStatus: "Paid",
      enteredBy: who(r.createdBy), entryDate: entryDay(r.createdAt),
      source: { entity: "payments_received", id: r.id, line: 1 },
      figures: { [r.isAdvance ? "clientAdvancePaise" : "receivedPaise"]: r.amountPaise, tdsHeldPaise: r.tdsPaise ?? 0, retentionHeldPaise: r.retentionPaise ?? 0 },
      moves: r.accountId ? [{ accountId: r.accountId, sign: 1, amountPaise: r.amountPaise }] : [],
    });
  }

  // ---------- transfers (two lines) and journal entries (no project) ----------
  if (!i.projectId) {
    for (const t of entries) {
      if (usedByExpense.has(t.id)) continue;
      const common = {
        ...blank, ...base(null), date: t.date, narration: t.narration ?? ENTRY_KIND_NAMES[t.kind] ?? "", totalPaise: t.amountPaise,
        enteredBy: t.enteredByName || who(t.createdBy), entryDate: entryDay(t.createdAt), figures: {},
      };
      if (t.kind === "transfer") {
        if (t.toAccountId) rows.push({ ...common, voucherNo: `TRF-${t.id}`, voucherType: "Transfer", partyName: acc(t.toAccountId), account: acc(t.fromAccountId), debitPaise: t.amountPaise,
          source: { entity: "account_transfers", id: t.id, line: 1 }, moves: [{ accountId: t.toAccountId, sign: 1, amountPaise: t.amountPaise }] });
        if (t.fromAccountId) rows.push({ ...common, voucherNo: `TRF-${t.id}`, voucherType: "Transfer", partyName: acc(t.fromAccountId), account: acc(t.toAccountId), creditPaise: t.amountPaise,
          source: { entity: "account_transfers", id: t.id, line: 2 }, moves: [{ accountId: t.fromAccountId, sign: -1, amountPaise: t.amountPaise }] });
        continue;
      }
      const out = ENTRY_DIRECTION[t.kind] === "out";
      const accountId = out ? t.fromAccountId : t.toAccountId;
      rows.push({
        ...common, voucherNo: `JRN-${t.id}`, voucherType: "Journal", partyName: t.partyName || ENTRY_KIND_NAMES[t.kind] || "", category1: ENTRY_KIND_NAMES[t.kind] ?? "",
        account: acc(accountId), debitPaise: out ? t.amountPaise : null, creditPaise: out ? null : t.amountPaise,
        source: { entity: "account_transfers", id: t.id, line: 1 }, moves: accountId ? [{ accountId, sign: out ? -1 : 1, amountPaise: t.amountPaise }] : [],
      });
    }
  }

  const order = (v: VoucherType) => VOUCHER_TYPES.indexOf(v);
  return rows.sort((a, b) => a.date.localeCompare(b.date) || order(a.voucherType) - order(b.voucherType) || a.voucherNo.localeCompare(b.voucherNo) || a.source.line - b.source.line);
}

/** "18", "2.5", "0": the GST rate as the CA reads it. */
const rate = (bp: number | null) => (bp == null ? "" : String(bp / 100));
const amt = (p: number | null) => (p == null ? "" : csvAmount(p));

/** The 32 columns of §11A.2, in order. `dateFormat` "dmy" writes DD/MM/YYYY. */
export function masterColumns(dateFormat: "iso" | "dmy" = "iso"): CsvColumn<MasterRow>[] {
  const d = (v: string) => (isDateStr(v) ? csvDate(v, dateFormat) : "");
  const values: ((r: MasterRow) => unknown)[] = [
    (r) => r.voucherNo, (r) => d(r.date), (r) => r.voucherType,
    (r) => r.projectCode, (r) => r.projectName, (r) => r.partyName, (r) => r.partyGstin,
    (r) => r.category1, (r) => r.category2, (r) => r.category3, (r) => r.narration,
    (r) => r.billNo, (r) => d(r.billDate), (r) => r.billAttached, (r) => r.billLink, (r) => r.noBillReason,
    (r) => amt(r.taxablePaise), (r) => rate(r.gstRateBp), (r) => amt(r.cgstPaise), (r) => amt(r.sgstPaise), (r) => amt(r.igstPaise), (r) => amt(r.tdsPaise), (r) => amt(r.retentionPaise),
    (r) => amt(r.totalPaise), (r) => amt(r.debitPaise), (r) => amt(r.creditPaise), (r) => r.mode, (r) => r.account, (r) => r.paymentStatus,
    (r) => r.enteredBy, (r) => r.approvedBy, (r) => d(r.entryDate),
  ];
  if (values.length !== MASTER_COLUMNS.length) throw new Error("Master CSV columns are out of step with MASTER_COLUMNS");
  return MASTER_COLUMNS.map((header, n) => ({ header, value: values[n]! }));
}

/** The file: header row only, no totals row, two decimals, UTF-8 with BOM (§11A.2). */
export function masterCsv(rows: MasterRow[], opts: { dateFormat?: "iso" | "dmy"; bom?: boolean } = {}): string {
  return toCsv(masterColumns(opts.dateFormat ?? "iso"), rows, { bom: opts.bom });
}

export interface MasterTotals extends MasterFigures {
  rows: number;
  /** Records (a transfer is one record on two lines). */
  vouchers: number;
  debitPaise: number;
  creditPaise: number;
  byType: Partial<Record<VoucherType, { rows: number; totalPaise: number }>>;
  accounts: Record<string, { inPaise: number; outPaise: number }>;
}

/** What the rows add up to. */
export function masterTotals(rows: MasterRow[]): MasterTotals {
  const out: MasterTotals = {
    expensePaise: 0, expenseGstPaise: 0, wagesPaise: 0, billedPaise: 0, gstOutputPaise: 0, receivedPaise: 0, clientAdvancePaise: 0,
    tdsHeldPaise: 0, retentionHeldPaise: 0, tdsDeductedPaise: 0, rows: rows.length, vouchers: 0, debitPaise: 0, creditPaise: 0, byType: {}, accounts: {},
  };
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(`${r.source.entity}/${r.source.id}`);
    for (const k of FIGURE_KEYS) out[k] += r.figures[k] ?? 0;
    out.debitPaise += r.debitPaise ?? 0;
    out.creditPaise += r.creditPaise ?? 0;
    const t = (out.byType[r.voucherType] ??= { rows: 0, totalPaise: 0 });
    t.rows++; t.totalPaise += r.totalPaise;
    for (const m of r.moves) {
      const a = (out.accounts[m.accountId] ??= { inPaise: 0, outPaise: 0 });
      if (m.sign > 0) a.inPaise += m.amountPaise; else a.outPaise += m.amountPaise;
    }
  }
  out.vouchers = seen.size;
  return out;
}

/** The same figures from the monthly rollups the dashboard reads (company docs, or one project's). */
export function booksTotals(cost: (CostRollup | null | undefined)[], fin: (FinanceRollup | null | undefined)[]): MasterFigures & { accounts: Record<string, { inPaise: number; outPaise: number }> } {
  const c = sumCost(cost);
  const f = sumFinance(fin);
  return {
    expensePaise: c.expenseTotalPaise, expenseGstPaise: c.expenseGstPaise, wagesPaise: c.wagesExpensedPaise, billedPaise: f.billedPaise,
    gstOutputPaise: f.gstOutputPaise, receivedPaise: f.receivedPaise, clientAdvancePaise: f.clientAdvanceReceivedPaise, tdsHeldPaise: f.tdsHeldPaise,
    retentionHeldPaise: f.retentionHeldPaise, tdsDeductedPaise: f.tdsDeductedPaise, accounts: f.accounts,
  };
}

export interface CheckLine { key: keyof MasterFigures | "accountIn" | "accountOut"; accountId?: string; filePaise: number; booksPaise: number; ok: boolean }
export interface MasterCheck { ok: boolean; lines: CheckLine[]; rows: number; vouchers: number }

/**
 * Compare the file with the books. `rows` must cover whole months (the rollups are monthly, D-09) and `cost` / `fin` must
 * be the rollups of exactly those months: the company docs, or one project's docs when the rows are for one project
 * (`accounts: false` then, because money in and out per account is kept on the company docs only).
 */
export function checkMasterTotals(rows: MasterRow[], cost: (CostRollup | null | undefined)[], fin: (FinanceRollup | null | undefined)[], opts: { accounts?: boolean } = {}): MasterCheck {
  const file = masterTotals(rows);
  const books = booksTotals(cost, fin);
  const lines: CheckLine[] = FIGURE_KEYS.map((key) => ({ key, filePaise: file[key], booksPaise: books[key], ok: file[key] === books[key] }));
  if (opts.accounts !== false) {
    for (const id of [...new Set([...Object.keys(file.accounts), ...Object.keys(books.accounts)])].sort()) {
      const a = file.accounts[id] ?? { inPaise: 0, outPaise: 0 };
      const b = books.accounts[id] ?? { inPaise: 0, outPaise: 0 };
      lines.push({ key: "accountIn", accountId: id, filePaise: a.inPaise, booksPaise: b.inPaise, ok: a.inPaise === b.inPaise });
      lines.push({ key: "accountOut", accountId: id, filePaise: a.outPaise, booksPaise: b.outPaise, ok: a.outPaise === b.outPaise });
    }
  }
  return { ok: lines.every((l) => l.ok), lines, rows: file.rows, vouchers: file.vouchers };
}

/** First day of the first month and last day of the last month a date range touches, with the month keys. */
export function wholeMonths(from: string, to: string): { from: string; to: string; months: string[] } {
  const months = monthsBetween(from, to);
  const last = months[months.length - 1]!;
  const [y, m] = last.split("-").map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: `${months[0]}-01`, to: end, months };
}

/** The ranges the export screen offers: this month, last month, this financial year. */
export function exportPresets(today: string, fy: string): { month: { from: string; to: string }; lastMonth: { from: string; to: string }; fy: { from: string; to: string } } {
  const m = wholeMonths(today, today);
  const [y, mo] = today.split("-").map(Number) as [number, number];
  const prevEnd = new Date(Date.UTC(y, mo - 1, 0)).toISOString().slice(0, 10);
  const lm = wholeMonths(prevEnd, prevEnd);
  return { month: { from: m.from, to: m.to }, lastMonth: { from: lm.from, to: lm.to }, fy: fyRange(fy) };
}

/** Everything the master CSV needs, read from a store (tests, the demo, and the server's export job). */
export function masterInputFromStore(store: MemoryStore, from: string, to: string, projectId?: string | null): MasterInput {
  return {
    from, to, projectId: projectId ?? null,
    expenses: store.list<Expense>("expenses"), workerPayments: store.list<WorkerPayment>("worker_payments"), invoices: store.list<Invoice>("invoices"),
    receipts: store.list<PaymentReceived>("payments_received"), transfers: store.list<MoneyEntry>("account_transfers"),
    vendorPayments: store.list<VendorPaymentLike>("vendor_payments"), accounts: store.list<Account>("accounts"),
    categories: store.list<Category>("expense_categories"), projects: store.list<Project>("projects"), clients: store.list<Client>("clients"),
    users: store.list<{ id: string; name: string }>("users"),
  };
}

/** The rollup documents a check needs for a range of whole months (company, or one project). */
export function rollupsFromStore(store: MemoryStore, months: string[], projectId?: string | null): { cost: (CostRollup | null)[]; fin: (FinanceRollup | null)[] } {
  const id = (m: string) => (projectId ? `p_${projectId}_${m}` : `co_${m}`);
  return { cost: months.map((m) => store.get<CostRollup>("rollups", id(m))), fin: months.map((m) => store.get<FinanceRollup>("finance_rollups", id(m))) };
}
