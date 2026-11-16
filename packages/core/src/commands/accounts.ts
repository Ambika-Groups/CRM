/**
 * Accounts commands (spec §11A.4): add and change cash, bank and UPI accounts, the opening balance, transfers between
 * own accounts, owner's drawings, capital introduced, loans, bank charges and interest, and the month lock.
 *
 * Money integrity (D-07, D-08): a command writes only the source record (`accounts`, `account_transfers`,
 * `period_locks`) and calls `store.post`; the posting engine alone writes account rows, balances and the month's money
 * in and out. The opening balance is posted the same way (a posting record, the difference applied), so it can be
 * changed or replayed without counting twice. Owner and accountant only; the month lock is the owner's.
 */
import { nextVoucherNo } from "../voucher";
import {
  ENTRY_DIRECTION, ENTRY_KIND_NAMES, MONEY_ENTRY_KINDS, MONTH_KEY_RE, assertMonthOpen, engineSupportsKind, entryNarration, openingTargets,
  validateAccount, validateMove, validateOpening, type AccountInput, type MoneyEntry, type MoneyEntryKind, type PeriodLock,
} from "../accounts";
import { formatMonth, fyOf, monthKeyOf, todayIST } from "../dates";
import { postGeneratedExpense, removeGeneratedExpense } from "../lanea-interfaces";
import { formatINR } from "../money";
import type { Account, AccountTxn, User } from "../model";
import { diffTargets, postingId, splitTarget, targetKey, type Posting } from "../posting";
import type { Doc, MemoryStore } from "../store";
import { CommandError, newId, requireRole, stampCreate, stampUpdate, trimOrEmpty, type CommandCtx, type CommandFn } from "./common";

const FINANCE = ["owner", "accountant"] as const;
const today = (ctx: Pick<CommandCtx, "nowIso">) => todayIST(new Date(ctx.nowIso));
const fail = (fields: Record<string, string>) => { if (Object.keys(fields).length) throw new CommandError("Some details need fixing.", fields); };
const userName = (store: MemoryStore, uid: string) => store.get<User>("users", uid)?.name ?? "";

/** Categories tried, in order, for the expense a bank charge books (the first that exists and is in use). */
export const BANK_CHARGE_CATEGORIES = ["cat_permits", "cat_overheads", "cat_misc"] as const;

/**
 * Apply an account's opening balance to its balance, as a posting: the difference from what was applied before.
 * `previousOpeningPaise` is the opening already inside the balance of an account that has no posting record yet
 * (accounts made before this feature, and the demo's base accounts).
 */
function postOpening(store: MemoryStore, accountId: string, previousOpeningPaise: number): void {
  const account = store.get<Account>("accounts", accountId);
  if (!account) return;
  const pid = postingId("accounts", accountId);
  const old = store.get<Posting & { id: string }>("postings", pid);
  const key = targetKey(`accounts/${accountId}`, "balancePaise");
  const oldTargets = old?.targets ?? (previousOpeningPaise ? { [key]: previousOpeningPaise } : {});
  const next = openingTargets(account);
  for (const [k, d] of Object.entries(diffTargets(oldTargets, next))) {
    const { doc, field } = splitTarget(k);
    store.increment(doc, field, d);
  }
  store.set("postings", { id: pid, entity: "accounts", docId: accountId, targets: next, accountTxnIds: [], months: [monthKeyOf(account.openingDate)] } as unknown as Doc);
}

// ───────────────────────── accounts ─────────────────────────

export interface SaveAccountInput extends AccountInput { id?: string | null }

/** Add an account, or change its name, kind, bank and last 4 digits. The opening balance is set when adding; later only by the owner. */
export function saveAccount(store: MemoryStore, input: SaveAccountInput, ctx: CommandCtx, fixedId?: string) {
  requireRole(ctx, FINANCE, "add or change accounts");
  const existing = input.id ? store.get<Account>("accounts", input.id) : null;
  if (input.id && !existing) throw new CommandError("This account no longer exists.");
  fail(validateAccount(input, store.list<Account>("accounts"), existing?.id ?? null, today(ctx), !existing));
  const fields = {
    name: input.name.trim(), type: input.type,
    bankName: input.type === "cash" ? "" : trimOrEmpty(input.bankName), last4: input.type === "cash" ? "" : trimOrEmpty(input.last4),
  };
  if (existing) {
    store.merge("accounts", existing.id, { ...fields, ...stampUpdate(ctx) });
    return { id: existing.id, created: false };
  }
  const openingBalancePaise = input.openingBalancePaise ?? 0;
  const openingDate = input.openingDate!;
  if (openingBalancePaise !== 0) assertMonthOpen(store, openingDate, "an opening balance");
  const id = fixedId ?? newId();
  if (store.get("accounts", id)) throw new CommandError("This account already exists.");
  store.set("accounts", { id, ...fields, openingBalancePaise, openingDate, active: true, balancePaise: 0, ...stampCreate(ctx) } as unknown as Doc);
  postOpening(store, id, 0);
  return { id, created: true };
}

/** Change the opening balance or its date. Owner only, and only while the months involved are open (firestore.rules says the same). */
export function setOpeningBalance(store: MemoryStore, input: { id: string; openingBalancePaise: number; openingDate: string }, ctx: CommandCtx) {
  requireRole(ctx, ["owner"], "change an opening balance");
  const account = store.get<Account>("accounts", input.id);
  if (!account) throw new CommandError("This account no longer exists.");
  fail(validateOpening(account.type, input.openingBalancePaise, input.openingDate, today(ctx)));
  const changed = account.openingBalancePaise !== input.openingBalancePaise || account.openingDate !== input.openingDate;
  if (!changed) return { id: account.id, balancePaise: account.balancePaise ?? account.openingBalancePaise, changed: false };
  assertMonthOpen(store, account.openingDate, "the opening balance");
  assertMonthOpen(store, input.openingDate, "the opening balance");
  if (input.openingDate > account.openingDate) {
    // Entries already in the books before the new start would be left outside them.
    const earlier = store.list<AccountTxn>("account_transactions", (t) => t.date >= account.openingDate && t.date < input.openingDate, { field: "accountId", value: account.id });
    if (earlier.length) {
      const msg = `${account.name} already has ${earlier.length} ${earlier.length === 1 ? "entry" : "entries"} before that date. Keep the opening date on or before the first entry.`;
      throw new CommandError(msg, { openingDate: msg });
    }
  }
  const before = account.openingBalancePaise;
  store.merge("accounts", account.id, { openingBalancePaise: input.openingBalancePaise, openingDate: input.openingDate, ...stampUpdate(ctx) });
  postOpening(store, account.id, before);
  return { id: account.id, balancePaise: store.get<Account>("accounts", account.id)!.balancePaise ?? 0, changed: true };
}

/** Close an account that is no longer used (it stays in the books), or reopen it. An account with money in it can't be closed. */
export function archiveAccount(store: MemoryStore, input: { id: string; archived: boolean }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "close or reopen accounts");
  const account = store.get<Account>("accounts", input.id);
  if (!account) throw new CommandError("This account no longer exists.");
  const balance = account.balancePaise ?? account.openingBalancePaise;
  if (input.archived && balance !== 0) {
    throw new CommandError(`${account.name} still has ${formatINR(balance)}. Move the money to another account first, then close it.`);
  }
  store.merge("accounts", account.id, { active: !input.archived, ...stampUpdate(ctx) });
  return { id: account.id, active: !input.archived };
}

// ───────────────────────── transfers and money entries ─────────────────────────

export interface AccountTransferInput { fromAccountId: string; toAccountId: string; amountPaise: number; date: string; note?: string; reference?: string }
export interface MoneyEntryInput { kind: MoneyEntryKind; accountId: string; amountPaise: number; date: string; partyName?: string; note?: string; reference?: string }

interface Draft { kind: MoneyEntry["kind"]; from: Account | null; to: Account | null; amountPaise: number; date: string; partyName?: string; note?: string; reference?: string }

async function writeEntry(store: MemoryStore, d: Draft, ctx: CommandCtx, what: string, fixedId?: string) {
  assertMonthOpen(store, d.date, what);
  const id = fixedId ?? newId();
  if (store.get("account_transfers", id)) throw new CommandError("This entry was already saved.");
  const entry: MoneyEntry = {
    id, kind: d.kind, fromAccountId: d.from?.id ?? null, toAccountId: d.to?.id ?? null, amountPaise: d.amountPaise, date: d.date,
    monthKey: monthKeyOf(d.date), fy: fyOf(d.date), partyName: trimOrEmpty(d.partyName), note: trimOrEmpty(d.note), reference: trimOrEmpty(d.reference),
    narration: entryNarration(d.kind, { from: d.from, to: d.to, partyName: d.partyName, note: d.note, reference: d.reference }),
    approvalStatus: "approved", enteredByName: userName(store, ctx.uid), voucherNo: nextVoucherNo(store, d.date), ...stampCreate(ctx),
  };
  store.set("account_transfers", entry as unknown as Doc);
  const posted = await store.post("account_transfers", id, ctx.nowIso);
  if (posted.error) throw new CommandError(posted.error);
  const bal = (a: Account | null) => (a ? store.get<Account>("accounts", a.id)?.balancePaise ?? 0 : null);
  const fromBalancePaise = bal(d.from);
  const toBalancePaise = bal(d.to);
  return { id, fromBalancePaise, toBalancePaise, cashBelowZero: d.from?.type === "cash" && (fromBalancePaise ?? 0) < 0 };
}

/** Move money between two of the company's own accounts: cash deposited in the bank, cash withdrawn, bank to bank. */
export async function createTransfer(store: MemoryStore, input: AccountTransferInput, ctx: CommandCtx, fixedId?: string) {
  requireRole(ctx, FINANCE, "move money between accounts");
  const from = input.fromAccountId ? store.get<Account>("accounts", input.fromAccountId) : null;
  const to = input.toAccountId ? store.get<Account>("accounts", input.toAccountId) : null;
  fail(validateMove({ kind: "transfer", from, to, amountPaise: input.amountPaise, date: input.date, today: today(ctx) }));
  return writeEntry(store, { kind: "transfer", from, to, amountPaise: input.amountPaise, date: input.date, note: input.note, reference: input.reference }, ctx, "this transfer", fixedId);
}

/** Owner's drawings, capital introduced, a loan taken or repaid, bank charges, or interest received (§11A.4). */
export async function createMoneyEntry(store: MemoryStore, input: MoneyEntryInput, ctx: CommandCtx, fixedId?: string) {
  requireRole(ctx, FINANCE, "record this entry");
  if (!(MONEY_ENTRY_KINDS as readonly string[]).includes(input.kind)) throw new CommandError("Choose what kind of entry this is.", { kind: "Choose what kind of entry this is." });
  if (!engineSupportsKind(input.kind)) throw new CommandError(`${ENTRY_KIND_NAMES[input.kind]} can't be recorded here yet. Enter it as an expense for now.`);
  const account = input.accountId ? store.get<Account>("accounts", input.accountId) : null;
  const out = ENTRY_DIRECTION[input.kind] === "out";
  const from = out ? account : null;
  const to = out ? null : account;
  fail(validateMove({ kind: input.kind, from, to, amountPaise: input.amountPaise, date: input.date, partyName: input.partyName, today: today(ctx) }));
  let categoryId: string | null = null;
  if (input.kind === "bank_charge") {
    categoryId = BANK_CHARGE_CATEGORIES.find((c) => store.get<{ active?: boolean }>("expense_categories", c)?.active !== false && store.get("expense_categories", c)) ?? null;
    if (!categoryId) throw new CommandError("There is no expense category for bank charges. Add one under Expenses, then try again.");
  }
  const partyName = input.kind === "bank_charge" || input.kind === "interest_in" ? trimOrEmpty(input.partyName) || account!.bankName || account!.name : input.partyName;
  const res = await writeEntry(store, { kind: input.kind, from, to, amountPaise: input.amountPaise, date: input.date, partyName, note: input.note, reference: input.reference }, ctx, "this entry", fixedId);
  if (input.kind === "bank_charge" && categoryId) {
    // D-16: the entry moves the money; the expense it generates books the cost and never moves money itself.
    const e = await postGeneratedExpense(store, ctx, {
      source: "bank_charge", sourceRef: { entity: "account_transfers", id: res.id }, projectId: null, date: input.date, categoryId,
      description: store.get<MoneyEntry>("account_transfers", res.id)!.narration ?? ENTRY_KIND_NAMES.bank_charge, amountPaise: input.amountPaise,
      payeeType: "other", payeeName: partyName ?? "", mode: account!.type === "upi" ? "upi" : "bank", paidStatus: "paid", accountId: account!.id,
    });
    store.merge("account_transfers", res.id, { expenseId: e.id });
  }
  return res;
}

async function cancelEntry(store: MemoryStore, input: { id: string; reason: string }, ctx: CommandCtx, want: "transfer" | "entry") {
  requireRole(ctx, FINANCE, want === "transfer" ? "cancel a transfer" : "cancel this entry");
  const entry = store.get<MoneyEntry>("account_transfers", input.id);
  if (!entry || (want === "transfer") !== (entry.kind === "transfer")) throw new CommandError("This entry no longer exists.");
  if (entry.isDeleted) throw new CommandError("This entry was already cancelled.");
  const reason = trimOrEmpty(input.reason);
  if (reason.length < 3) throw new CommandError("Say why it is being cancelled.", { reason: "Say why it is being cancelled." });
  assertMonthOpen(store, entry.date, want === "transfer" ? "this transfer" : "this entry");
  store.merge("account_transfers", entry.id, { isDeleted: true, deletedAt: ctx.nowIso, deletedBy: ctx.uid, deleteReason: reason, ...stampUpdate(ctx) });
  const posted = await store.post("account_transfers", entry.id, ctx.nowIso);
  if (posted.error) throw new CommandError(posted.error);
  if (entry.kind === "bank_charge") await removeGeneratedExpense(store, ctx, "bank_charge", { entity: "account_transfers", id: entry.id });
  const bal = (id?: string | null) => (id ? store.get<Account>("accounts", id)?.balancePaise ?? 0 : null);
  return { id: entry.id, fromBalancePaise: bal(entry.fromAccountId), toBalancePaise: bal(entry.toAccountId) };
}

/** Cancel a transfer: it stays on record as cancelled, and both balances go back exactly. */
export function cancelTransfer(store: MemoryStore, input: { id: string; reason: string }, ctx: CommandCtx) {
  return cancelEntry(store, input, ctx, "transfer");
}

/** Cancel a drawing, capital, loan, bank charge or interest entry. */
export function cancelMoneyEntry(store: MemoryStore, input: { id: string; reason: string }, ctx: CommandCtx) {
  return cancelEntry(store, input, ctx, "entry");
}

// ───────────────────────── month lock (§11A.4; D-13: the lock's id is the month) ─────────────────────────

/** Lock a month once the CA has confirmed it: nothing dated in it can be added, changed or cancelled. Owner only. */
export function lockMonth(store: MemoryStore, input: { monthKey: string; note?: string }, ctx: CommandCtx) {
  requireRole(ctx, ["owner"], "lock a month");
  const m = trimOrEmpty(input.monthKey);
  if (!MONTH_KEY_RE.test(m)) throw new CommandError("Choose the month to lock.", { monthKey: "Choose the month to lock." });
  if (m > monthKeyOf(today(ctx))) throw new CommandError(`${formatMonth(m)} hasn't started yet, so it can't be locked.`, { monthKey: "Choose this month or an earlier one." });
  if (store.get("period_locks", m)) throw new CommandError(`${formatMonth(m)} is already locked.`);
  const lock: PeriodLock = { id: m, monthKey: m, lockedBy: ctx.uid, lockedByName: userName(store, ctx.uid), lockedAt: ctx.nowIso, note: trimOrEmpty(input.note) };
  store.set("period_locks", lock as unknown as Doc);
  store.set("audit_log", { id: newId(), entity: "period_locks", entityId: m, action: "lock", command: "lockMonth", after: { note: lock.note }, paths: [`period_locks/${m}`], projectId: null, by: ctx.uid, at: ctx.nowIso } as Doc);
  return lock;
}

/** Unlock a month so a correction can be made. Owner only, with a reason that stays in the audit trail. */
export function unlockMonth(store: MemoryStore, input: { monthKey: string; reason: string }, ctx: CommandCtx) {
  requireRole(ctx, ["owner"], "unlock a month");
  const m = trimOrEmpty(input.monthKey);
  const lock = MONTH_KEY_RE.test(m) ? store.get<PeriodLock>("period_locks", m) : null;
  if (!lock) throw new CommandError("This month isn't locked.");
  const reason = trimOrEmpty(input.reason);
  if (reason.length < 3) throw new CommandError("Say why the month is being unlocked.", { reason: "Say why the month is being unlocked." });
  store.delete("period_locks", m);
  store.set("audit_log", {
    id: newId(), entity: "period_locks", entityId: m, action: "unlock", command: "unlockMonth", paths: [`period_locks/${m}`], projectId: null,
    before: { lockedBy: lock.lockedBy, lockedAt: lock.lockedAt, note: lock.note ?? "" }, after: { reason }, by: ctx.uid, at: ctx.nowIso,
  } as Doc);
  return { monthKey: m };
}

/** The names the screens call (spread into the registry by the lane lead). */
export const ACCOUNT_COMMANDS = {
  saveAccount: (s, a: SaveAccountInput, c) => saveAccount(s, a, c),
  setOpeningBalance: (s, a: Parameters<typeof setOpeningBalance>[1], c) => setOpeningBalance(s, a, c),
  archiveAccount: (s, a: Parameters<typeof archiveAccount>[1], c) => archiveAccount(s, a, c),
  createTransfer: (s, a: AccountTransferInput, c) => createTransfer(s, a, c),
  cancelTransfer: (s, a: { id: string; reason: string }, c) => cancelTransfer(s, a, c),
  createMoneyEntry: (s, a: MoneyEntryInput, c) => createMoneyEntry(s, a, c),
  cancelMoneyEntry: (s, a: { id: string; reason: string }, c) => cancelMoneyEntry(s, a, c),
  lockMonth: (s, a: Parameters<typeof lockMonth>[1], c) => lockMonth(s, a, c),
  unlockMonth: (s, a: Parameters<typeof unlockMonth>[1], c) => unlockMonth(s, a, c),
} satisfies Record<string, CommandFn>;
