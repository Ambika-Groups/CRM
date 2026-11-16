/**
 * Expense commands (spec §7.2): enter, change, delete (soft, with a reason), approve one or many, reject with a
 * reason, mark a credit purchase paid, and recurring templates with the run that creates the entries that are due.
 * Every money change goes through `store.post("expenses", id, nowIso)` (D-07, D-08): no command writes a total, an
 * account row or a balance itself. A posting refusal (a locked month) is thrown, so the whole command is undone.
 * Approval rules are in ../expenses.ts; approve and reject reuse actions.ts.
 */
import { assertMonthOpen, isMonthLocked } from "../accounts";
import { approveExpense, rejectExpense } from "../actions";
import { fyOf, isDateStr, monthKeyOf } from "../dates";
import {
  approvalOnSave, approvalRefusal, approverRoles, changedFields, editRefusal, entryRefusal, expenseCategoryTree, expenseLimits,
  expenseSearchKeywords, EXPENSE_MODES, MAX_BILL_FILES, moneyChanged, needsBillOrReason, recurringExpenseId, splitExpenseGst, templateDueNow,
  type ExpenseHistoryAction, type ExpenseHistoryEntry, type ExpenseInput, type ExpenseLimits, type ExpenseRecord, type ExpenseTemplate,
} from "../expenses";
import { assertFileRefs } from "../files";
import { notify, type FileRef } from "../lanea-interfaces";
import type { Account, PaymentMode, Project, User, Vendor, Worker } from "../model";
import { formatINR } from "../money";
import { searchKeywords } from "../search";
import type { Doc, MemoryStore } from "../store";
import { Checker, CommandError, isGstin, isNonNegInt, newId, requireRole, stampCreate, stampUpdate, trimOrEmpty, type CommandCtx, type CommandFn } from "./common";
import { serverToday } from "./labour";

const FINANCE = ["owner", "accountant"] as const;
const isFinance = (ctx: Pick<CommandCtx, "role">) => ctx.role === "owner" || ctx.role === "accountant";
const PAID_MODES: readonly PaymentMode[] = ["cash", "upi", "bank", "cheque"];

function limitsOf(store: MemoryStore): ExpenseLimits {
  return expenseLimits(store.get<Record<string, unknown>>("settings", "operations"));
}

function nameOf(store: MemoryStore, uid: string): string {
  return store.get<User>("users", uid)?.name ?? "";
}

/** Drop keys that hold `undefined`, so a saved document never carries them. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function historyLine(store: MemoryStore, ctx: CommandCtx, action: ExpenseHistoryAction, extra: Partial<ExpenseHistoryEntry> = {}): ExpenseHistoryEntry {
  return clean({ at: ctx.nowIso, by: ctx.uid, byName: nameOf(store, ctx.uid) || undefined, action, ...extra });
}

const withHistory = (prev: ExpenseHistoryEntry[] | undefined, line: ExpenseHistoryEntry) => [...(prev ?? []), line].slice(-30);

function audit(store: MemoryStore, ctx: CommandCtx, command: string, e: { id: string; projectId?: string | null }, action: string, before: unknown, after: unknown, note: string | null = null) {
  store.set("audit_log", { id: newId(), entity: "expenses", entityId: e.id, projectId: e.projectId ?? null, action, command, before: before ?? null, after: after ?? null, note, by: ctx.uid, at: ctx.nowIso } as Doc);
}

async function postOrThrow(store: MemoryStore, id: string, nowIso: string) {
  const r = await store.post("expenses", id, nowIso);
  if (r.error) throw new CommandError(r.error);
  return r;
}

function activeAccount(store: MemoryStore, id: string | null | undefined): Account | null {
  if (!id) return null;
  const a = store.get<Account>("accounts", id);
  return a && a.active !== false && !a.isDeleted ? a : null;
}

type EntryFields = Pick<ExpenseRecord, "projectId" | "projectName" | "date" | "monthKey" | "fy" | "categoryId" | "categoryPath" | "description" | "qtyMilli" | "unit"
  | "ratePaise" | "amountPaise" | "taxablePaise" | "gstRateBp" | "cgstPaise" | "sgstPaise" | "igstPaise" | "gstInclusive" | "gstInterState" | "payeeType" | "payeeId"
  | "payeeName" | "partyGstin" | "mode" | "paidStatus" | "accountId" | "billNo" | "billDate" | "billFiles" | "noBillReason" | "remarks">;

/** The bill photos a record may keep, checked by the files feature (`assertFileRefs`); a problem lands on the field. */
function billRefs(c: Checker, v: unknown): FileRef[] {
  try {
    return assertFileRefs(v, MAX_BILL_FILES, "billFiles");
  } catch (err) {
    if (!(err instanceof CommandError)) throw err;
    c.need("billFiles", false, err.message);
    return [];
  }
}

/**
 * Check what was typed and work out what is stored. Problems are added to `c` (one message per field, in plain
 * words); returns null when there are any. `prev` is the entry being changed.
 */
function resolveEntry(store: MemoryStore, c: Checker, input: ExpenseInput, ctx: CommandCtx, o: { prev?: ExpenseRecord | null; checkDate?: boolean; checkBill?: boolean } = {}): EntryFields | null {
  const limits = limitsOf(store);
  const finance = isFinance(ctx);
  const projectId = input.projectId || null;
  const refusal = entryRefusal(ctx, projectId);
  if (refusal) throw new CommandError(refusal, projectId ? {} : { projectId: refusal });
  const project = projectId ? store.get<Project>("projects", projectId) : null;
  if (projectId) {
    c.need("projectId", !!project && !project.isDeleted, "Choose the project.");
    c.need("projectId", !project?.isArchived || o.prev?.projectId === projectId, "This project is archived. Restore it before adding expenses to it.");
  }
  c.need("date", isDateStr(input.date), "Enter the date as DD/MM/YYYY.");
  if (o.checkDate !== false) c.need("date", !isDateStr(input.date) || input.date <= serverToday(ctx), "An expense can't be dated in the future.");

  const tree = expenseCategoryTree(store);
  const cat = tree.byId.get(input.categoryId);
  c.need("categoryId", !!cat && cat.active !== false, "Choose what the money was spent on.");
  c.need("categoryId", !cat || tree.isLeaf(cat.id), "Choose the last level of the expense head, for example Materials, then Cement.");

  c.need("amountPaise", isNonNegInt(input.amountPaise) && input.amountPaise > 0, "Enter the amount in rupees, for example 1,250.");
  const rate = input.gstRateBp ?? 0;
  c.need("gstRateBp", Number.isInteger(rate) && rate >= 0 && rate <= 2800, "Choose the GST rate.");
  c.need("qtyMilli", input.qtyMilli == null || isNonNegInt(input.qtyMilli), "Enter the quantity as a number, for example 40 or 2.5.");
  c.need("ratePaise", input.ratePaise == null || isNonNegInt(input.ratePaise), "Enter the rate in rupees.");
  c.need("mode", EXPENSE_MODES.includes(input.mode), "Choose how it was paid.");

  let payeeType = input.payeeType ?? "other";
  c.need("payeeType", ["worker", "vendor", "other"].includes(payeeType), "Choose who was paid.");
  let payeeId = payeeType === "other" ? null : input.payeeId || null;
  let payeeName = trimOrEmpty(input.payeeName).slice(0, 120);
  let gstin = trimOrEmpty(input.partyGstin).toUpperCase();
  if (payeeId && payeeType === "vendor") {
    const v = store.get<Vendor>("vendors", payeeId);
    c.need("payeeId", !!v && !v.isDeleted, "Choose the supplier again: this one is no longer in the list.");
    if (v) { payeeName = v.name; gstin = gstin || (v.gstin ?? ""); }
  }
  if (payeeId && payeeType === "worker") {
    const w = store.get<Worker>("workers", payeeId);
    c.need("payeeId", !!w, "Choose the worker again: this one is no longer in the list.");
    if (w) payeeName = w.name;
  }
  if (!payeeName) { payeeId = null; if (payeeType !== "other" && input.mode !== "credit") payeeType = "other"; }
  c.need("partyGstin", !gstin || isGstin(gstin), "Check the GSTIN: 15 characters, for example 09AAACA1234B1ZG.");

  const credit = input.mode === "credit";
  if (credit) c.need("payeeName", payeeName.length >= 2, "Say who is owed this money.");
  let accountId: string | null = null;
  if (!credit) {
    if (finance) {
      const account = activeAccount(store, input.accountId);
      c.need("accountId", !!account, "Choose which account the money was paid from.");
      accountId = account?.id ?? null;
    } else {
      // Site roles don't see the accounts: the owner or accountant fills this in. An account already set is kept.
      accountId = o.prev && o.prev.mode === input.mode ? o.prev.accountId ?? null : null;
    }
  }

  const billFiles = billRefs(c, input.billFiles);
  const billDate = trimOrEmpty(input.billDate);
  c.need("billDate", !billDate || isDateStr(billDate), "Enter the bill date as DD/MM/YYYY.");
  const noBillReason = trimOrEmpty(input.noBillReason).slice(0, 200);

  if (Object.keys(c.errors).length) return null;
  const gst = splitExpenseGst(input.amountPaise, rate, input.gstInclusive !== false, !!input.gstInterState);
  if (o.checkBill !== false) {
    const bills = billFiles.length + (o.prev?.billPaths?.length ?? 0);
    c.need("noBillReason", !needsBillOrReason(gst.amountPaise, bills, limits) || noBillReason.length >= 3,
      `Above ${formatINR(limits.missingBillThresholdPaise)} an expense needs a photo of the bill, or the reason there is no bill.`);
    if (Object.keys(c.errors).length) return null;
  }
  return clean({
    projectId, projectName: project?.name ?? null, date: input.date, monthKey: monthKeyOf(input.date), fy: fyOf(input.date),
    categoryId: cat!.id, categoryPath: tree.pathOf(cat!.id), description: trimOrEmpty(input.description).slice(0, 200),
    qtyMilli: input.qtyMilli ?? undefined, unit: trimOrEmpty(input.unit).slice(0, 20), ratePaise: input.ratePaise ?? undefined,
    amountPaise: gst.amountPaise, taxablePaise: gst.taxablePaise, gstRateBp: rate, cgstPaise: gst.cgstPaise, sgstPaise: gst.sgstPaise, igstPaise: gst.igstPaise,
    gstInclusive: input.gstInclusive !== false, gstInterState: !!input.gstInterState,
    payeeType, payeeId, payeeName, partyGstin: gstin, mode: input.mode, paidStatus: credit ? "unpaid" as const : "paid" as const, accountId,
    billNo: trimOrEmpty(input.billNo).slice(0, 40), billDate, billFiles, noBillReason, remarks: trimOrEmpty(input.remarks).slice(0, 500),
  });
}

function tellApprovers(store: MemoryStore, ctx: CommandCtx, e: ExpenseRecord, limits: ExpenseLimits) {
  notify(store, ctx, {
    toRoles: approverRoles(e, limits), projectId: e.projectId, dedupeKey: `expense_waiting:${e.id}:${e.updatedAt ?? ctx.nowIso}`,
    title: "An expense is waiting for approval", body: [formatINR(e.amountPaise), e.payeeName || e.description, e.projectName].filter(Boolean).join(" · "),
    link: `/expenses/view/?id=${e.id}`,
  });
}

// ───────────────────────── Enter, change, delete ─────────────────────────

/**
 * Enter an expense (spec §7.2). It is always created waiting (D-30); the owner's entries, and the accountant's up to
 * the limit, are approved in the same step, which posts them. `id` may be chosen by the device so that an entry saved
 * offline and sent twice is stored once.
 */
export async function createExpense(store: MemoryStore, input: ExpenseInput & { id?: string | null }, ctx: CommandCtx) {
  const c = new Checker();
  const f = resolveEntry(store, c, input, ctx);
  c.throwIfAny();
  const fields = f!;
  assertMonthOpen(store, fields.date, "this expense");
  let id = newId();
  if (input.id) {
    if (!/^[A-Za-z0-9]{12,40}$/.test(input.id)) throw new CommandError("This entry couldn't be saved. Please enter it again.");
    const already = store.get<ExpenseRecord>("expenses", input.id);
    if (already) {
      if (already.createdBy !== ctx.uid) throw new CommandError("This entry couldn't be saved. Please enter it again.");
      return { id: already.id, approved: already.approvalStatus === "approved", status: already.approvalStatus, alreadySaved: true };
    }
    id = input.id;
  }
  const limits = limitsOf(store);
  const e: ExpenseRecord = {
    ...fields, id, tdsPaise: 0, billPaths: [], approvalStatus: "pending", source: "manual", sourceRef: null, voucherNo: null,
    enteredBy: ctx.uid, enteredByName: nameOf(store, ctx.uid), creditPurchase: fields.mode === "credit", paidDate: null,
    searchKeywords: expenseSearchKeywords(fields), history: [historyLine(store, ctx, "created")], ...stampCreate(ctx),
  };
  store.set("expenses", e as unknown as Doc);
  const approved = approvalOnSave(ctx.role, e.amountPaise, limits) === "approved";
  if (approved) {
    const r = await approveExpense(store, id, { uid: ctx.uid, nowIso: ctx.nowIso });
    if (r.error) throw new CommandError(r.error);
  } else {
    tellApprovers(store, ctx, e, limits);
  }
  audit(store, ctx, "createExpense", e, "create", null, { amountPaise: e.amountPaise, categoryId: e.categoryId, date: e.date, mode: e.mode, approvalStatus: approved ? "approved" : "pending" });
  return { id, approved, status: approved ? "approved" as const : "pending" as const, alreadySaved: false };
}

/**
 * Change an entry. Totals move by the difference (D-08). A rejected entry goes back to waiting. A change to the money
 * side of an approved entry is decided again by the same rule as a new entry, so an accountant can't lift an entry
 * above their limit and keep it approved.
 */
export async function updateExpense(store: MemoryStore, a: { id: string; input: ExpenseInput }, ctx: CommandCtx) {
  const prev = store.get<ExpenseRecord>("expenses", a.id);
  if (!prev) throw new CommandError("This expense no longer exists.");
  const refusal = editRefusal(prev, ctx);
  if (refusal) throw new CommandError(refusal);
  if (!isFinance(ctx) && (a.input.projectId || null) !== prev.projectId) throw new CommandError("Only the owner or the accountant can move an entry to another project.", { projectId: "Only the owner or the accountant can move an entry to another project." });
  const c = new Checker();
  const f = resolveEntry(store, c, a.input, ctx, { prev });
  c.throwIfAny();
  const fields = f!;
  assertMonthOpen(store, prev.date, "this expense");
  if (fields.date !== prev.date) assertMonthOpen(store, fields.date, "this expense");

  const limits = limitsOf(store);
  const changed = changedFields(prev, fields);
  const keepApproved = prev.approvalStatus === "approved" && !moneyChanged(prev, fields);
  const status = keepApproved ? "approved" : approvalOnSave(ctx.role, fields.amountPaise, limits);
  const sentAgain = prev.approvalStatus === "rejected";
  const wasCredit = !!prev.creditPurchase || prev.mode === "credit";
  const next: ExpenseRecord = {
    ...prev, ...fields, approvalStatus: status, rejectReason: null, postingError: null,
    creditPurchase: wasCredit || fields.mode === "credit", paidDate: fields.mode === "credit" ? null : prev.paidDate ?? null,
    searchKeywords: expenseSearchKeywords(fields),
    history: withHistory(prev.history, historyLine(store, ctx, sentAgain ? "sent_again" : "edited", { changed })),
    ...stampUpdate(ctx),
  };
  if (fields.qtyMilli === undefined) delete next.qtyMilli;
  if (fields.ratePaise === undefined) delete next.ratePaise;
  if (status === "approved") {
    if (prev.approvalStatus !== "approved") { next.approvedBy = ctx.uid; next.approvedAt = ctx.nowIso; }
  } else {
    delete next.approvedBy;
    delete next.approvedAt;
  }
  store.set("expenses", next as unknown as Doc);
  await postOrThrow(store, next.id, ctx.nowIso);
  if (status === "pending" && (prev.approvalStatus !== "pending" || moneyChanged(prev, fields))) tellApprovers(store, ctx, next, limits);
  const pick = (r: Partial<ExpenseRecord>) => Object.fromEntries(changed.filter((k) => k !== "billFiles").map((k) => [k, (r as Record<string, unknown>)[k] ?? null]));
  audit(store, ctx, "updateExpense", next, "update", { ...pick(prev), amountPaise: prev.amountPaise, approvalStatus: prev.approvalStatus }, { ...pick(next), amountPaise: next.amountPaise, approvalStatus: status });
  return { id: next.id, approved: status === "approved", status, changed };
}

/** Delete an entry: it is kept, marked deleted with the reason, and its totals are reversed. */
export async function deleteExpense(store: MemoryStore, a: { id: string; reason: string }, ctx: CommandCtx) {
  const prev = store.get<ExpenseRecord>("expenses", a.id);
  if (!prev) throw new CommandError("This expense no longer exists.");
  const refusal = editRefusal(prev, ctx);
  if (refusal) throw new CommandError(refusal);
  const reason = trimOrEmpty(a.reason);
  if (reason.length < 3) throw new CommandError("Say why this entry is being deleted.", { reason: "Say why this entry is being deleted." });
  assertMonthOpen(store, prev.date, "this expense");
  store.merge("expenses", a.id, {
    isDeleted: true, deletedAt: ctx.nowIso, deletedBy: ctx.uid, deleteReason: reason,
    history: withHistory(prev.history, historyLine(store, ctx, "deleted", { note: reason })), ...stampUpdate(ctx),
  });
  await postOrThrow(store, a.id, ctx.nowIso);
  audit(store, ctx, "deleteExpense", prev, "delete", { amountPaise: prev.amountPaise, approvalStatus: prev.approvalStatus }, null, reason);
  return { id: a.id };
}

// ───────────────────────── Approve, reject ─────────────────────────

/**
 * Approve waiting entries (D-30). The owner approves anything; the accountant up to the limit and never their own;
 * a project manager on assigned projects up to their limit and never their own. A paid entry with no paid-from
 * account gets `accountId` when the owner or accountant approves, so the cash book and bank book stay right.
 * `strict` (one entry): an entry that isn't waiting is an error; in a batch it is skipped.
 */
export async function approveExpenses(store: MemoryStore, a: { ids: string[]; accountId?: string | null }, ctx: CommandCtx, strict = false) {
  requireRole(ctx, ["owner", "accountant", "pm"], "approve expenses");
  const limits = limitsOf(store);
  let approved = 0, skipped = 0;
  for (const id of [...new Set(a.ids)]) {
    const e = store.get<ExpenseRecord>("expenses", id);
    if (!e || e.isDeleted || e.approvalStatus !== "pending") {
      if (strict) throw new CommandError(!e ? "This expense no longer exists." : approvalRefusal(e, ctx, limits) ?? "Only an entry waiting for approval can be approved.");
      skipped++;
      continue;
    }
    const refusal = approvalRefusal(e, ctx, limits);
    if (refusal) throw new CommandError(refusal);
    assertMonthOpen(store, e.date, "this expense");
    if (e.mode !== "credit" && !e.accountId && isFinance(ctx)) {
      const account = activeAccount(store, a.accountId);
      if (!account) throw new CommandError("Choose which account this was paid from, so the cash book and bank book stay right.", { accountId: "Choose which account the money was paid from." });
      store.merge("expenses", id, { accountId: account.id });
    }
    const r = await approveExpense(store, id, { uid: ctx.uid, nowIso: ctx.nowIso });
    if (r.error) throw new CommandError(r.error);
    store.merge("expenses", id, { history: withHistory(e.history, historyLine(store, ctx, "approved")), ...stampUpdate(ctx) });
    audit(store, ctx, "approveExpenses", e, "approve", { approvalStatus: "pending" }, { approvalStatus: "approved", amountPaise: e.amountPaise });
    approved++;
  }
  return { approved, skipped };
}

/** Reject a waiting entry with a reason. It never counts; the person who entered it is told and can correct it. */
export async function rejectExpenseWithReason(store: MemoryStore, a: { id: string; reason: string }, ctx: CommandCtx) {
  requireRole(ctx, ["owner", "accountant", "pm"], "reject expenses");
  const e = store.get<ExpenseRecord>("expenses", a.id);
  if (!e) throw new CommandError("This expense no longer exists.");
  const refusal = approvalRefusal(e, ctx, limitsOf(store));
  if (refusal) throw new CommandError(refusal);
  const reason = trimOrEmpty(a.reason);
  if (reason.length < 3) throw new CommandError("Say why this entry is rejected.", { reason: "Say why this entry is rejected, so the person who entered it can fix it." });
  const r = await rejectExpense(store, a.id, reason, { uid: ctx.uid, nowIso: ctx.nowIso });
  if (r.error) throw new CommandError(r.error);
  store.merge("expenses", a.id, { history: withHistory(e.history, historyLine(store, ctx, "rejected", { note: reason })), ...stampUpdate(ctx) });
  audit(store, ctx, "rejectExpense", e, "reject", { approvalStatus: "pending" }, { approvalStatus: "rejected" }, reason);
  if (e.enteredBy && e.enteredBy !== "system" && e.enteredBy !== ctx.uid) {
    notify(store, ctx, {
      toUserIds: [e.enteredBy], projectId: e.projectId, dedupeKey: `expense_rejected:${e.id}:${ctx.nowIso}`, level: "warning",
      title: "An expense you entered was not approved", body: `${formatINR(e.amountPaise)}: ${reason}`, link: `/expenses/view/?id=${e.id}`,
    });
  }
  return { id: a.id };
}

// ───────────────────────── Credit purchases ─────────────────────────

/**
 * A credit purchase is paid (spec §7.2 "payable until paid"): record the day, how, and the account the money left.
 * The entry stops being owed, the supplier's payable goes down and the account row is written, all by posting.
 */
export async function markExpensePaid(store: MemoryStore, a: { id: string; date: string; mode: PaymentMode; accountId: string; reference?: string }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "record payments");
  const e = store.get<ExpenseRecord>("expenses", a.id);
  if (!e || e.isDeleted) throw new CommandError("This expense no longer exists.");
  if (e.source !== "manual") throw new CommandError("This bill came from a purchase record. Record its payment there.");
  if (e.mode !== "credit" || e.paidStatus === "paid") throw new CommandError("This entry is already paid.");
  if (e.approvalStatus !== "approved") throw new CommandError("Approve this entry first. Then it can be marked as paid.");
  const c = new Checker();
  c.need("date", isDateStr(a.date), "Enter the date it was paid as DD/MM/YYYY.");
  c.need("date", !isDateStr(a.date) || a.date <= serverToday(ctx), "The payment can't be dated in the future.");
  c.need("date", !isDateStr(a.date) || a.date >= e.date, "The payment can't be before the day of the purchase.");
  c.need("mode", PAID_MODES.includes(a.mode), "Choose how it was paid: cash, UPI, bank transfer or cheque.");
  const account = activeAccount(store, a.accountId);
  c.need("accountId", !!account, "Choose which account the money was paid from.");
  c.throwIfAny();
  assertMonthOpen(store, a.date, "this payment");
  const reference = trimOrEmpty(a.reference).slice(0, 60);
  store.merge("expenses", a.id, {
    mode: a.mode, paidStatus: "paid", accountId: account!.id, paidDate: a.date, creditPurchase: true, paymentRef: reference,
    history: withHistory(e.history, historyLine(store, ctx, "paid", { note: account!.name })), ...stampUpdate(ctx),
  });
  await postOrThrow(store, a.id, ctx.nowIso);
  audit(store, ctx, "markExpensePaid", e, "paid", { mode: "credit", paidStatus: e.paidStatus ?? "unpaid" }, { mode: a.mode, paidStatus: "paid", accountId: account!.id, paidDate: a.date, amountPaise: e.amountPaise });
  return { id: a.id };
}

// ───────────────────────── Recurring templates ─────────────────────────

export interface ExpenseTemplateInput extends Omit<ExpenseInput, "date" | "billNo" | "billDate" | "billFiles" | "noBillReason" | "qtyMilli" | "unit" | "ratePaise" | "remarks"> {
  id?: string | null;
  name: string;
  frequency: "monthly" | "weekly";
  dayOfMonth?: number | null;
  weekday?: number | null;
  startDate: string;
  endDate?: string | null;
}

/** Add or change a recurring template, e.g. monthly rent (spec §7.2). Owner and accountant only. */
export function saveExpenseTemplate(store: MemoryStore, input: ExpenseTemplateInput, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "set up recurring expenses");
  const prev = input.id ? store.get<ExpenseTemplate>("expense_templates", input.id) : null;
  if (input.id && !prev) throw new CommandError("This recurring expense no longer exists.");
  const c = new Checker();
  const name = trimOrEmpty(input.name).slice(0, 80);
  c.need("name", name.length >= 2, "Give it a name, for example Office rent.");
  c.need("frequency", input.frequency === "monthly" || input.frequency === "weekly", "Choose every month or every week.");
  if (input.frequency === "monthly") c.need("dayOfMonth", Number.isInteger(input.dayOfMonth) && input.dayOfMonth! >= 1 && input.dayOfMonth! <= 31, "Choose the day of the month, from 1 to 31.");
  if (input.frequency === "weekly") c.need("weekday", Number.isInteger(input.weekday) && input.weekday! >= 0 && input.weekday! <= 6, "Choose the day of the week.");
  c.need("startDate", isDateStr(input.startDate), "Enter the first date as DD/MM/YYYY.");
  const endDate = trimOrEmpty(input.endDate) || null;
  c.need("endDate", !endDate || (isDateStr(endDate) && (!isDateStr(input.startDate) || endDate >= input.startDate)), "The last date must be on or after the first date.");
  const f = resolveEntry(store, c, { ...input, date: input.startDate }, ctx, { checkDate: false, checkBill: false });
  c.throwIfAny();
  const fields = f!;
  const id = prev?.id ?? newId();
  const doc: ExpenseTemplate = {
    ...(prev ?? {}), id, name, projectId: fields.projectId, projectName: fields.projectName, categoryId: fields.categoryId, description: fields.description,
    // The template keeps the amount as typed; each entry it makes is split again on its own day.
    amountPaise: input.amountPaise, gstRateBp: fields.gstRateBp, gstInclusive: fields.gstInclusive, gstInterState: fields.gstInterState,
    payeeType: fields.payeeType, payeeId: fields.payeeId, payeeName: fields.payeeName, partyGstin: fields.partyGstin, mode: fields.mode, accountId: fields.accountId,
    frequency: input.frequency, dayOfMonth: input.frequency === "monthly" ? input.dayOfMonth! : null, weekday: input.frequency === "weekly" ? input.weekday! : null,
    startDate: input.startDate, endDate, active: prev?.active ?? true, skipBefore: prev?.skipBefore ?? null, lastDueDate: prev?.lastDueDate ?? null, lastRunAt: prev?.lastRunAt ?? null,
    searchKeywords: searchKeywords(name, fields.payeeName, fields.projectName), ...(prev ? stampUpdate(ctx) : stampCreate(ctx)),
  };
  store.set("expense_templates", doc as unknown as Doc);
  return id;
}

/** Pause or resume a template. Nothing is made for the time it was paused. */
export function pauseExpenseTemplate(store: MemoryStore, a: { id: string; paused: boolean }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "pause recurring expenses");
  const t = store.get<ExpenseTemplate>("expense_templates", a.id);
  if (!t) throw new CommandError("This recurring expense no longer exists.");
  if (t.active === !a.paused) return { id: a.id, active: t.active };
  store.merge("expense_templates", a.id, a.paused
    ? { active: false, pausedAt: ctx.nowIso, ...stampUpdate(ctx) }
    : { active: true, pausedAt: null, skipBefore: serverToday(ctx), ...stampUpdate(ctx) });
  return { id: a.id, active: !a.paused };
}

export interface RecurringRun {
  /** Ids of the entries made in this run. */
  created: string[];
  approved: number;
  waiting: number;
  skipped: { templateId: string; name: string; date: string; reason: string }[];
}

/** At most this many missed dates are caught up per template in one run; the rest follow in the next run. */
const MAX_CATCH_UP = 36;

/**
 * Create the entries that are due (the nightly job, and the catch-up button). Safe to run again: an entry's id comes
 * from its template and due date, so it is made once. Entries are created waiting and approved at once up to the
 * auto-approve limit; larger ones wait for the owner (D-30). A due date in a locked month is skipped and reported.
 */
export async function runRecurringExpenses(store: MemoryStore, ctx: CommandCtx): Promise<RecurringRun> {
  requireRole(ctx, FINANCE, "run recurring expenses");
  const today = serverToday(ctx);
  const limits = limitsOf(store);
  const out: RecurringRun = { created: [], approved: 0, waiting: 0, skipped: [] };
  const templates = store.list<ExpenseTemplate>("expense_templates", (t) => !t.isDeleted, { field: "active", value: true }).sort((a, b) => a.id.localeCompare(b.id));
  for (const t of templates) {
    let last = t.lastDueDate ?? null;
    for (const due of templateDueNow(t, today).slice(0, MAX_CATCH_UP)) {
      const id = recurringExpenseId(t.id, due);
      if (store.get("expenses", id)) { last = due; continue; }
      if (isMonthLocked(store, monthKeyOf(due))) {
        out.skipped.push({ templateId: t.id, name: t.name, date: due, reason: "The month is locked." });
        last = due;
        continue;
      }
      const c = new Checker();
      let fields: EntryFields | null = null;
      try {
        fields = resolveEntry(store, c, {
          projectId: t.projectId, date: due, categoryId: t.categoryId, description: t.description || t.name, amountPaise: t.amountPaise, gstRateBp: t.gstRateBp,
          gstInclusive: t.gstInclusive, gstInterState: t.gstInterState, payeeType: t.payeeType, payeeId: t.payeeId, payeeName: t.payeeName, partyGstin: t.partyGstin,
          mode: t.mode, accountId: t.accountId, noBillReason: "Recurring entry: add the bill when it arrives.",
        }, ctx, { checkDate: false, checkBill: false });
      } catch (err) {
        if (!(err instanceof CommandError)) throw err;
        c.need("template", false, err.message);
      }
      if (!fields) {
        // The template itself needs fixing (a closed account, an archived project…): stop here so nothing is lost.
        out.skipped.push({ templateId: t.id, name: t.name, date: due, reason: Object.values(c.errors)[0] ?? "This recurring expense needs fixing." });
        break;
      }
      const e: ExpenseRecord = {
        ...fields, id, tdsPaise: 0, billPaths: [], approvalStatus: "pending", source: "manual", sourceRef: null, voucherNo: null,
        enteredBy: "system", enteredByName: `Recurring: ${t.name}`, creditPurchase: fields.mode === "credit", paidDate: null, templateId: t.id, recurringFor: due,
        searchKeywords: expenseSearchKeywords(fields), history: [{ at: ctx.nowIso, by: "system", byName: `Recurring: ${t.name}`, action: "created" }],
        createdBy: "system", createdAt: ctx.nowIso, updatedBy: "system", updatedAt: ctx.nowIso, isDeleted: false,
      };
      store.set("expenses", e as unknown as Doc);
      if (e.amountPaise <= limits.autoApproveLimitPaise) {
        const r = await approveExpense(store, id, { uid: "system", nowIso: ctx.nowIso });
        if (r.error) throw new CommandError(r.error);
        out.approved++;
      } else {
        tellApprovers(store, ctx, e, limits);
        out.waiting++;
      }
      out.created.push(id);
      last = due;
    }
    if (last !== (t.lastDueDate ?? null)) store.merge("expense_templates", t.id, { lastDueDate: last, lastRunAt: ctx.nowIso });
  }
  if (out.created.length) {
    store.set("audit_log", { id: newId(), entity: "expense_templates", entityId: "run", projectId: null, action: "run", command: "runRecurringExpenses",
      before: null, after: { created: out.created.length, approved: out.approved, waiting: out.waiting }, note: null, by: ctx.uid, at: ctx.nowIso } as Doc);
  }
  return out;
}

// ───────────────────────── The command map ─────────────────────────

export const EXPENSE_COMMANDS = {
  createExpense: (s, a: Parameters<typeof createExpense>[1], c) => createExpense(s, a, c),
  updateExpense: (s, a: Parameters<typeof updateExpense>[1], c) => updateExpense(s, a, c),
  deleteExpense: (s, a: Parameters<typeof deleteExpense>[1], c) => deleteExpense(s, a, c),
  approveExpense: (s, a: { id: string; accountId?: string | null }, c) => approveExpenses(s, { ids: [a.id], accountId: a.accountId }, c, true),
  approveExpenses: (s, a: { ids: string[]; accountId?: string | null }, c) => approveExpenses(s, a, c),
  rejectExpense: (s, a: Parameters<typeof rejectExpenseWithReason>[1], c) => rejectExpenseWithReason(s, a, c),
  markExpensePaid: (s, a: Parameters<typeof markExpensePaid>[1], c) => markExpensePaid(s, a, c),
  saveExpenseTemplate: (s, a: Parameters<typeof saveExpenseTemplate>[1], c) => saveExpenseTemplate(s, a, c),
  pauseExpenseTemplate: (s, a: Parameters<typeof pauseExpenseTemplate>[1], c) => pauseExpenseTemplate(s, a, c),
  runRecurringExpenses: (s, _a: Record<string, never>, c) => runRecurringExpenses(s, c),
} satisfies Record<string, CommandFn>;
