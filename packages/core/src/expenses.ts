/**
 * Expense entry and approvals (spec §7.2): the pure rules. Amount and GST split, who may enter, who must approve and
 * who may approve (spec §2; decisions D-30, D-45; defaults D12, D13, C12), what may still be changed once an entry is
 * approved or its month is closed, recurring templates, and the expense another record generates (D-16, D-30).
 * Commands live in commands/expenses.ts. Money is integer paise; dates are IST strings.
 */
import { CategoryTree, seedCategories, type Category } from "./categories";
import { CommandError, type CommandCtx } from "./commands/common";
import { addDays, fyOf, isDateStr, monthKeyOf, weekday } from "./dates";
import { lineTax } from "./gst";
import { generatedExpenseId, type FileRef, type GeneratedExpenseInput, type GeneratedExpenseSource } from "./lanea-interfaces";
import type { Audit, Expense, PaymentMode, Role } from "./model";
import { formatINR, mulDivRound } from "./money";
import { searchKeywords } from "./search";
import type { Doc, MemoryStore } from "./store";

// ───────────────────────── Types ─────────────────────────

export type ExpenseHistoryAction = "created" | "edited" | "approved" | "rejected" | "deleted" | "paid" | "sent_again";

/** One line of an entry's history, kept on the entry so the person who made it can read it (the audit log is finance only). */
export interface ExpenseHistoryEntry {
  at: string;
  by: string;
  byName?: string;
  action: ExpenseHistoryAction;
  /** A reason typed by a person (reject, delete) or a short plain note. */
  note?: string;
  /** Field names that changed in an edit (the screen shows their labels). */
  changed?: string[];
}

/** An expense as this feature stores it: the shared `Expense` plus the fields model.ts does not have yet. */
export type ExpenseRecord = Expense & {
  /** Bill photos (FileRef, never image bytes on the record itself). */
  billFiles?: FileRef[];
  rejectReason?: string | null;
  remarks?: string;
  /** True when the typed amount already had GST in it; false when GST was added on top. */
  gstInclusive?: boolean;
  /** IGST (supplier in another state) instead of CGST + SGST. */
  gstInterState?: boolean;
  /** Bought on credit (stays true after it is paid). */
  creditPurchase?: boolean;
  /** The day a credit purchase was paid. */
  paidDate?: string | null;
  paymentRef?: string;
  templateId?: string | null;
  /** The due date a recurring template made this entry for. */
  recurringFor?: string | null;
  history?: ExpenseHistoryEntry[];
  searchKeywords?: string[];
};

/** What a person types on the expense form. */
export interface ExpenseInput {
  /** null = a head-office expense with no project (owner and accountant only, default I4). */
  projectId: string | null;
  date: string;
  /** A leaf of the category tree. */
  categoryId: string;
  description?: string;
  qtyMilli?: number | null;
  unit?: string;
  ratePaise?: number | null;
  /** The amount as typed: with GST when `gstInclusive`, before GST otherwise. */
  amountPaise: number;
  gstRateBp?: number;
  gstInclusive?: boolean;
  gstInterState?: boolean;
  payeeType?: "worker" | "vendor" | "other";
  payeeId?: string | null;
  payeeName?: string;
  partyGstin?: string;
  mode: PaymentMode;
  /** Paid-from account; empty for a credit purchase. */
  accountId?: string | null;
  billNo?: string;
  billDate?: string;
  billFiles?: FileRef[];
  noBillReason?: string;
  remarks?: string;
}

export const EXPENSE_MODES: readonly PaymentMode[] = ["cash", "upi", "bank", "cheque", "credit"];
/** GST rates offered on the form, in basis points. */
export const EXPENSE_GST_RATES_BP: readonly number[] = [0, 500, 600, 1200, 1800, 2800];
export const MAX_BILL_FILES = 5;

// ───────────────────────── Limits (settings/operations) ─────────────────────────

export interface ExpenseLimits {
  /** Above this an entry needs a bill photo or a "no bill" reason (default D12: ₹2,000). */
  missingBillThresholdPaise: number;
  /** A project manager approves up to this on assigned projects (default D13: ₹25,000). */
  pmApprovalLimitPaise: number;
  /** An accountant's own entry up to this is approved at once, and they approve others' up to it (default C12: ₹25,000). */
  autoApproveLimitPaise: number;
}

export const DEFAULT_EXPENSE_LIMITS: ExpenseLimits = { missingBillThresholdPaise: 200_000, pmApprovalLimitPaise: 2_500_000, autoApproveLimitPaise: 2_500_000 };

const limitOr = (v: unknown, d: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : d);

/** The three limits from the `settings/operations` document, with the documented defaults. */
export function expenseLimits(ops: Partial<Record<keyof ExpenseLimits, unknown>> | null | undefined): ExpenseLimits {
  return {
    missingBillThresholdPaise: limitOr(ops?.missingBillThresholdPaise, DEFAULT_EXPENSE_LIMITS.missingBillThresholdPaise),
    pmApprovalLimitPaise: limitOr(ops?.pmApprovalLimitPaise, DEFAULT_EXPENSE_LIMITS.pmApprovalLimitPaise),
    autoApproveLimitPaise: limitOr(ops?.autoApproveLimitPaise, DEFAULT_EXPENSE_LIMITS.autoApproveLimitPaise),
  };
}

// ───────────────────────── Amount and GST ─────────────────────────

export interface ExpenseGst {
  /** What the expense costs in all, GST included. This is what posts to the totals. */
  amountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  gstPaise: number;
}

/**
 * Split a typed amount into taxable value and GST, to the paisa (gst.ts `lineTax`: half-up per tax head).
 * - Added on top (`inclusive` false): the typed amount is the taxable value; the total is taxable + GST.
 * - Included (`inclusive` true): the typed amount is the total. CGST and SGST stay equal, and the taxable value takes
 *   the odd paisa, so taxable + GST is exactly the typed amount.
 */
export function splitExpenseGst(typedPaise: number, gstRateBp = 0, inclusive = true, interState = false): ExpenseGst {
  if (!Number.isInteger(typedPaise) || typedPaise < 0) throw new RangeError("Amount must be a whole number of paise");
  if (!Number.isInteger(gstRateBp) || gstRateBp < 0 || gstRateBp > 2800) throw new RangeError("GST rate must be between 0% and 28%");
  if (gstRateBp === 0) return { amountPaise: typedPaise, taxablePaise: typedPaise, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, gstPaise: 0 };
  const base = inclusive ? mulDivRound(typedPaise, 10_000, 10_000 + gstRateBp) : typedPaise;
  const t = lineTax({ qtyMilli: 1000, ratePaise: base, gstRateBp }, !interState);
  const gst = t.cgstPaise + t.sgstPaise + t.igstPaise;
  const taxable = inclusive ? typedPaise - gst : base;
  return { amountPaise: taxable + gst, taxablePaise: taxable, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise, gstPaise: gst };
}

/** The GST inside a stored expense. */
export function expenseGstPaise(e: Pick<Expense, "cgstPaise" | "sgstPaise" | "igstPaise">): number {
  return (e.cgstPaise ?? 0) + (e.sgstPaise ?? 0) + (e.igstPaise ?? 0);
}

type Typed = Pick<ExpenseRecord, "amountPaise" | "taxablePaise" | "gstInclusive" | "gstRateBp" | "igstPaise">;

/**
 * Whether an entry's amount was typed with GST in it. Entries saved by this feature say so; for older ones it is
 * worked out: "added on top" when the taxable value plus its GST gives exactly the stored amount.
 */
export function gstInclusiveOf(e: Typed): boolean {
  if (typeof e.gstInclusive === "boolean") return e.gstInclusive;
  if (!e.gstRateBp || e.taxablePaise == null || e.taxablePaise === e.amountPaise) return true;
  return splitExpenseGst(e.taxablePaise, e.gstRateBp, false, (e.igstPaise ?? 0) > 0).amountPaise !== e.amountPaise;
}

/** The amount to show in the form's amount box when an entry is opened for editing. */
export function typedAmountOf(e: Typed): number {
  return e.gstRateBp && !gstInclusiveOf(e) ? e.taxablePaise ?? e.amountPaise : e.amountPaise;
}

/** Above the limit an entry needs a bill photo or a reason (default D12). */
export function needsBillOrReason(amountPaise: number, billCount: number, limits: ExpenseLimits): boolean {
  return amountPaise > limits.missingBillThresholdPaise && billCount === 0;
}

// ───────────────────────── Who may do what (spec §2, D-30, D13) ─────────────────────────

type Who = Pick<CommandCtx, "role" | "uid" | "projectIds">;
const isFinance = (r: Role) => r === "owner" || r === "accountant";
const isSite = (r: Role) => r === "pm" || r === "supervisor";

/** Why this person can't enter an expense on this project, or null when they can. */
export function entryRefusal(who: Who, projectId: string | null): string | null {
  if (!isFinance(who.role) && !isSite(who.role)) return "Your role can't enter expenses.";
  if (projectId === null) return isFinance(who.role) ? null : "Choose the project. Only the owner or the accountant can enter an office expense with no project.";
  if (isSite(who.role) && !who.projectIds.includes(projectId)) return "You aren't assigned to this project, so you can't enter expenses here.";
  return null;
}

/**
 * The status an entry gets when this role saves it: the owner's entries are approved at once, the accountant's up to
 * the limit, and everything a project manager or supervisor enters waits (defaults D13, C12; D-30).
 */
export function approvalOnSave(role: Role, amountPaise: number, limits: ExpenseLimits): "approved" | "pending" {
  if (role === "owner") return "approved";
  if (role === "accountant" && amountPaise <= limits.autoApproveLimitPaise) return "approved";
  return "pending";
}

type Approvable = Pick<Expense, "approvalStatus" | "amountPaise" | "projectId" | "enteredBy" | "source" | "isDeleted">;

/** Why this person can't approve (or reject) this entry, in plain words; null when they can. */
export function approvalRefusal(e: Approvable, who: Who, limits: ExpenseLimits): string | null {
  if (!isFinance(who.role) && who.role !== "pm") return "Your role can't approve expenses.";
  if (e.isDeleted) return "This entry was deleted.";
  if (e.approvalStatus !== "pending") return "Only an entry waiting for approval can be approved or rejected.";
  if (e.source !== "manual") return "This entry was made automatically from another record (a wage payment, a purchase bill or a machine). Approve that record instead.";
  if (who.role === "owner") return null;
  if (e.enteredBy === who.uid) return "You entered this one yourself, so someone else has to approve it.";
  if (who.role === "accountant") {
    return e.amountPaise <= limits.autoApproveLimitPaise ? null : `This is above ${formatINR(limits.autoApproveLimitPaise)}, so only the owner can approve it.`;
  }
  if (!e.projectId || !who.projectIds.includes(e.projectId)) return "You aren't assigned to this project, so you can't approve its expenses.";
  return e.amountPaise <= limits.pmApprovalLimitPaise ? null : `This is above your approval limit of ${formatINR(limits.pmApprovalLimitPaise)}. The owner or the accountant approves it.`;
}

export function canApproveExpense(e: Approvable, who: Who, limits: ExpenseLimits): boolean {
  return approvalRefusal(e, who, limits) === null;
}

/** Which roles could approve a waiting entry of this size (for "who it waits for" on screen). */
export function approverRoles(e: Pick<Expense, "amountPaise" | "projectId">, limits: ExpenseLimits): Role[] {
  const out: Role[] = ["owner"];
  if (e.amountPaise <= limits.autoApproveLimitPaise) out.push("accountant");
  if (e.projectId && e.amountPaise <= limits.pmApprovalLimitPaise) out.push("pm");
  return out;
}

type Editable = Pick<Expense, "approvalStatus" | "projectId" | "enteredBy" | "source" | "isDeleted">;

/**
 * Why this person can't change or delete this entry; null when they can. While it waits (or after a rejection) the
 * person who entered it and the project's manager may change it; once approved only the owner and the accountant may.
 */
export function editRefusal(e: Editable, who: Who): string | null {
  if (e.isDeleted) return "This entry was deleted, so it can't be changed.";
  if (e.source !== "manual") return "This entry was made automatically from another record (a wage payment, a purchase bill or a machine). Change that record instead.";
  if (isFinance(who.role)) return null;
  if (!isSite(who.role)) return "Your role can't change expenses.";
  if (!e.projectId || !who.projectIds.includes(e.projectId)) return "You aren't assigned to this project, so you can't change its expenses.";
  if (who.role === "supervisor" && e.enteredBy !== who.uid) return "You can change only the entries you made yourself.";
  if (e.approvalStatus === "approved") return "This entry is approved. Only the owner or the accountant can change it now.";
  return null;
}

/** Fields whose change alters what an approved entry does to the totals or the account books. */
const MONEY_FIELDS = ["projectId", "date", "categoryId", "amountPaise", "taxablePaise", "cgstPaise", "sgstPaise", "igstPaise", "mode", "accountId", "payeeType", "payeeId"] as const;

export function moneyChanged(a: Partial<ExpenseRecord>, b: Partial<ExpenseRecord>): boolean {
  return MONEY_FIELDS.some((k) => (a[k] ?? null) !== (b[k] ?? null));
}

/** Fields the history names when an entry is edited. */
export const EXPENSE_EDIT_FIELDS = ["projectId", "date", "categoryId", "description", "qtyMilli", "unit", "ratePaise", "amountPaise", "gstRateBp", "gstInclusive",
  "gstInterState", "payeeType", "payeeId", "payeeName", "partyGstin", "mode", "accountId", "billNo", "billDate", "billFiles", "noBillReason", "remarks"] as const;

export function changedFields(a: Partial<ExpenseRecord>, b: Partial<ExpenseRecord>): string[] {
  const norm = (v: unknown) => JSON.stringify(v === undefined || v === "" ? null : v);
  return EXPENSE_EDIT_FIELDS.filter((k) => norm(a[k]) !== norm(b[k]));
}

/** A credit purchase that is approved and still owed (spec §7.2 "show as payable until paid"). */
export function isUnpaidCredit(e: Pick<Expense, "mode" | "paidStatus" | "approvalStatus" | "isDeleted">): boolean {
  return !e.isDeleted && e.approvalStatus === "approved" && e.mode === "credit" && e.paidStatus !== "paid";
}

/** Totals for a list of entries on screen. Only approved, not deleted entries count as spent (D-20). */
export function expenseTotals(rows: Pick<Expense, "amountPaise" | "cgstPaise" | "sgstPaise" | "igstPaise" | "approvalStatus" | "isDeleted" | "mode" | "paidStatus">[]) {
  const out = { count: rows.length, enteredPaise: 0, approvedPaise: 0, gstPaise: 0, waitingPaise: 0, unpaidPaise: 0 };
  for (const e of rows) {
    if (e.isDeleted) continue;
    out.enteredPaise += e.amountPaise;
    if (e.approvalStatus === "approved") { out.approvedPaise += e.amountPaise; out.gstPaise += expenseGstPaise(e); }
    if (e.approvalStatus === "pending") out.waitingPaise += e.amountPaise;
    if (isUnpaidCredit(e)) out.unpaidPaise += e.amountPaise;
  }
  return out;
}

export function expenseSearchKeywords(e: Pick<Expense, "payeeName" | "description" | "billNo" | "projectName">): string[] {
  return searchKeywords(e.payeeName, e.description, e.billNo, e.projectName);
}

// ───────────────────────── Store helpers ─────────────────────────

/** The category tree in use: the saved one, or the built-in heads when none have been saved yet. */
export function expenseCategoryTree(store: MemoryStore): CategoryTree {
  const cats = store.list<Category>("expense_categories");
  return new CategoryTree(cats.length ? cats : seedCategories());
}

// ───────────────────────── Recurring templates (spec §7.2) ─────────────────────────

export interface ExpenseTemplate extends Audit {
  id: string;
  /** What the person calls it, e.g. "Office rent". */
  name: string;
  projectId: string | null;
  projectName?: string | null;
  categoryId: string;
  description?: string;
  amountPaise: number;
  gstRateBp?: number;
  gstInclusive?: boolean;
  gstInterState?: boolean;
  payeeType?: "worker" | "vendor" | "other";
  payeeId?: string | null;
  payeeName?: string;
  partyGstin?: string;
  mode: PaymentMode;
  accountId?: string | null;
  frequency: "monthly" | "weekly";
  /** Monthly: the day (1 to 31; a shorter month uses its last day). */
  dayOfMonth?: number | null;
  /** Weekly: 0 Sunday … 6 Saturday. */
  weekday?: number | null;
  startDate: string;
  endDate?: string | null;
  active: boolean;
  /** Set when a paused template is resumed: nothing is made for the paused time. */
  skipBefore?: string | null;
  /** The latest due date already handled. */
  lastDueDate?: string | null;
  lastRunAt?: string | null;
  searchKeywords?: string[];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

type Schedule = Pick<ExpenseTemplate, "frequency" | "dayOfMonth" | "weekday" | "startDate" | "endDate" | "skipBefore">;

/** Every due date of a template from `from` to `to` (both included), oldest first. */
export function templateDueDates(t: Schedule, from: string, to: string): string[] {
  let lo = from > t.startDate ? from : t.startDate;
  if (t.skipBefore && t.skipBefore > lo) lo = t.skipBefore;
  const hi = t.endDate && t.endDate < to ? t.endDate : to;
  if (!isDateStr(lo) || !isDateStr(hi) || lo > hi) return [];
  const out: string[] = [];
  if (t.frequency === "weekly") {
    const want = t.weekday ?? 1;
    let d = addDays(lo, (want - weekday(lo) + 7) % 7);
    for (; d <= hi; d = addDays(d, 7)) out.push(d);
    return out;
  }
  const day = Math.min(31, Math.max(1, t.dayOfMonth ?? 1));
  let y = Number(lo.slice(0, 4));
  let m = Number(lo.slice(5, 7));
  for (;;) {
    const due = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, "0")}`;
    if (due > hi) break;
    if (due >= lo) out.push(due);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Due dates that still need an entry today: after the last one handled, up to today. */
export function templateDueNow(t: Schedule & Pick<ExpenseTemplate, "active" | "lastDueDate">, today: string): string[] {
  if (!t.active) return [];
  return templateDueDates(t, t.lastDueDate ? addDays(t.lastDueDate, 1) : t.startDate, today);
}

/** The next due date after today, or null when the template is paused or has ended. */
export function templateNextDue(t: Schedule & Pick<ExpenseTemplate, "active">, today: string): string | null {
  if (!t.active) return null;
  return templateDueDates(t, addDays(today, 1), addDays(today, 62))[0] ?? null;
}

export function recurringExpenseId(templateId: string, dueDate: string): string {
  return `rec_${templateId}_${dueDate}`;
}

// ───────────────────────── Expenses generated by another record (D-16, D-30) ─────────────────────────

function generatedGst(i: GeneratedExpenseInput): Pick<ExpenseGst, "taxablePaise" | "cgstPaise" | "sgstPaise" | "igstPaise"> {
  if (typeof i.taxablePaise === "number" && Number.isInteger(i.taxablePaise) && i.taxablePaise > 0 && i.taxablePaise <= i.amountPaise) {
    // The source record's own figures win: the tax is the amount less the taxable value, in two halves.
    const tax = i.amountPaise - i.taxablePaise;
    const half = Math.floor(tax / 2);
    return { taxablePaise: i.taxablePaise, cgstPaise: half, sgstPaise: tax - half, igstPaise: 0 };
  }
  const g = splitExpenseGst(i.amountPaise, i.gstRateBp && i.gstRateBp > 0 ? i.gstRateBp : 0, true);
  return { taxablePaise: g.taxablePaise, cgstPaise: g.cgstPaise, sgstPaise: g.sgstPaise, igstPaise: g.igstPaise };
}

const GENERATED_COMPARE = ["projectId", "projectName", "date", "categoryId", "description", "amountPaise", "taxablePaise", "gstRateBp", "cgstPaise", "sgstPaise",
  "igstPaise", "payeeType", "payeeId", "payeeName", "mode", "paidStatus", "accountId", "billNo", "billDate", "approvalStatus", "isDeleted"] as const;

/**
 * The real body behind `postGeneratedExpense` (lanea-interfaces.ts keeps the signature and delegates here).
 * D-30: a generated expense inherits its source's approval. It is stored and posted only when the source is approved,
 * and it is born approved. A source that is waiting or rejected books nothing, and takes back what it booked before.
 * The id comes from the source, so calling this again changes nothing and never counts twice. A generated expense
 * never moves money itself (D-16): the source payment owns the account row.
 */
export async function postGeneratedExpenseEntry(store: MemoryStore, ctx: Pick<CommandCtx, "uid" | "nowIso">, i: GeneratedExpenseInput): Promise<Expense> {
  if (!Number.isInteger(i.amountPaise) || i.amountPaise <= 0) throw new CommandError("A generated expense needs a whole-paise amount above zero.");
  if (!isDateStr(i.date)) throw new CommandError("A generated expense needs a date.");
  const tree = expenseCategoryTree(store);
  if (!tree.byId.has(i.categoryId)) throw new CommandError("The expense head chosen for this entry doesn't exist any more. Choose another one.");
  const id = generatedExpenseId(i.source, i.sourceRef, i.key);
  const prev = store.get<ExpenseRecord>("expenses", id);
  const status = i.approvalStatus ?? "approved";
  const mode = i.mode ?? "credit";
  const e: ExpenseRecord = {
    id,
    projectId: i.projectId,
    projectName: i.projectName ?? null,
    date: i.date,
    monthKey: monthKeyOf(i.date),
    fy: fyOf(i.date),
    categoryId: i.categoryId,
    categoryPath: tree.pathOf(i.categoryId),
    description: i.description,
    amountPaise: i.amountPaise,
    gstRateBp: i.gstRateBp ?? 0,
    ...generatedGst(i),
    tdsPaise: 0,
    payeeType: i.payeeType ?? "vendor",
    payeeId: i.payeeId ?? null,
    payeeName: i.payeeName ?? "",
    mode,
    paidStatus: i.paidStatus ?? (mode === "credit" ? "unpaid" : "paid"),
    accountId: i.accountId ?? null,
    billNo: i.billNo ?? "",
    billDate: i.billDate ?? "",
    approvalStatus: status,
    approvedBy: "system",
    approvedAt: prev?.approvedAt ?? ctx.nowIso,
    source: i.source,
    sourceRef: i.sourceRef,
    enteredBy: "system",
    enteredByName: "System",
    searchKeywords: searchKeywords(i.payeeName, i.description, i.billNo, i.projectName),
    createdAt: prev?.createdAt ?? ctx.nowIso,
    createdBy: prev?.createdBy ?? ctx.uid,
    updatedAt: ctx.nowIso,
    updatedBy: ctx.uid,
    isDeleted: false,
  };
  if (status !== "approved") {
    // Nothing is booked until the source is approved; anything booked earlier is taken back.
    await removeGeneratedExpenseEntry(store, ctx, i.source, i.sourceRef, i.key);
    return e;
  }
  const same = !!prev && GENERATED_COMPARE.every((k) => JSON.stringify(prev[k] ?? null) === JSON.stringify(e[k] ?? null));
  if (same) {
    // Same inputs as last time: the record is left as it is, and posting finds nothing to do.
    const r = await store.post("expenses", id, ctx.nowIso);
    if (r.error) throw new CommandError(r.error);
    return prev;
  }
  store.set("expenses", e as unknown as Doc);
  const r = await store.post("expenses", id, ctx.nowIso);
  if (r.error) throw new CommandError(r.error);
  return e;
}

/** The real body behind `removeGeneratedExpense`: marks the generated expense deleted and reverses its posting. Safe if there is none. */
export async function removeGeneratedExpenseEntry(store: MemoryStore, ctx: Pick<CommandCtx, "uid" | "nowIso">, source: GeneratedExpenseSource, ref: { entity: string; id: string }, key?: string): Promise<void> {
  const id = generatedExpenseId(source, ref, key);
  const cur = store.get<ExpenseRecord>("expenses", id);
  if (!cur || cur.isDeleted) return;
  store.merge("expenses", id, { isDeleted: true, deletedAt: ctx.nowIso, deletedBy: ctx.uid, deleteReason: "The record this entry came from was cancelled or is no longer approved.", updatedAt: ctx.nowIso, updatedBy: ctx.uid });
  const r = await store.post("expenses", id, ctx.nowIso);
  if (r.error) throw new CommandError(r.error);
}
