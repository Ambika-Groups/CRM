/**
 * Cash and bank accounts (spec §11A.4, §12 v1.1): the kinds of account, the entries that move money without being an
 * expense or a receipt (transfers between own accounts, owner's drawings, capital introduced, loans taken and repaid,
 * bank charges, interest received), the cash book and bank book arithmetic, and the month lock check.
 *
 * Pure rules. Account rows and balances are written only by the posting engine (posting.ts, D-07, D-08); what is here
 * says what a correct posting looks like (`moneyEntryEffect`) and reads what was posted (`accountBook`, `balanceBefore`).
 */
import { CommandError } from "./commands/common";
import { addDays, formatMonth, fyOf, isDateStr, monthKeyOf } from "./dates";
import { monthsBetween } from "./dashboard";
import type { Account, AccountTransfer, AccountTxn } from "./model";
import { EMPTY_EFFECT, targetKey, transferEffect, type Effect, type Targets } from "./posting";
import { sumFinance, type FinanceRollup } from "./rollups";
import type { MemoryStore } from "./store";

// ───────────────────────── accounts ─────────────────────────

/** §12: cash in hand, a bank account, or a UPI / wallet account. */
export const ACCOUNT_TYPES = ["cash", "bank", "upi"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface AccountInput {
  name: string;
  type: AccountType;
  bankName?: string;
  /** Last 4 digits of the account number, to tell accounts apart. The full number is never stored here. */
  last4?: string;
  /** Balance on the opening date, in paise. May be below zero for an overdrawn bank account, never for cash. */
  openingBalancePaise?: number;
  /** The day the books of this account start (YYYY-MM-DD). */
  openingDate?: string;
}

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Field messages for an account being added (`creating`) or renamed. Empty when everything is fine. */
export function validateAccount(
  input: AccountInput, others: Pick<Account, "id" | "name" | "isDeleted">[], selfId: string | null, today: string, creating: boolean,
): Record<string, string> {
  const e: Record<string, string> = {};
  const name = clean(input.name);
  if (name.length < 2 || name.length > 60) e.name = "Enter a name for the account, e.g. Cash in hand or SBI current account.";
  else if (others.some((a) => a.id !== selfId && !a.isDeleted && a.name.trim().toLowerCase() === name.toLowerCase())) e.name = "Another account already has this name.";
  if (!(ACCOUNT_TYPES as readonly string[]).includes(input.type)) e.type = "Choose cash, bank account or UPI.";
  if (input.type === "bank" && clean(input.bankName).length < 2) e.bankName = "Enter the bank's name, e.g. State Bank of India.";
  const last4 = clean(input.last4);
  if (last4 && !/^\d{4}$/.test(last4)) e.last4 = "Enter only the last 4 digits of the account number.";
  if (creating) Object.assign(e, validateOpening(input.type, input.openingBalancePaise ?? 0, input.openingDate ?? "", today));
  return e;
}

export function validateOpening(type: AccountType, openingBalancePaise: number, openingDate: string, today: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (!Number.isSafeInteger(openingBalancePaise)) e.openingBalancePaise = "Enter the opening balance in rupees, e.g. 25,000.";
  else if (type === "cash" && openingBalancePaise < 0) e.openingBalancePaise = "Cash in hand can't start below zero.";
  if (!isDateStr(openingDate)) e.openingDate = "Enter the date this balance is from.";
  else if (openingDate > today) e.openingDate = "The opening date can't be in the future.";
  return e;
}

/** What the opening balance adds to the account's balance (the one target of an account's own posting). */
export function openingTargets(a: Pick<Account, "id" | "openingBalancePaise" | "isDeleted">): Targets {
  return a.isDeleted || !a.openingBalancePaise ? {} : { [targetKey(`accounts/${a.id}`, "balancePaise")]: a.openingBalancePaise };
}

// ───────────────────────── money entries ─────────────────────────

/** Entries that are not a transfer between two own accounts: one account, money in or out. */
export const MONEY_ENTRY_KINDS = ["drawing", "capital", "loan_in", "loan_repay", "bank_charge", "interest_in"] as const;
export type MoneyEntryKind = (typeof MONEY_ENTRY_KINDS)[number];
export type TransferKind = "transfer" | MoneyEntryKind;

/** An `account_transfers` document as this feature writes it (the model's `AccountTransfer` with the two extra kinds and a few plain fields). */
export interface MoneyEntry extends Omit<AccountTransfer, "kind"> {
  kind: TransferKind;
  /** The short voucher number the server gave when the entry was saved (D-54). Older entries have none. */
  voucherNo?: string | null;
  /** The lender, the owner or partner, or the bank. */
  partyName?: string;
  /** What the person typed as a note. `narration` is the line the books show. */
  note?: string;
  /** Cheque, UTR or slip number. */
  reference?: string;
  /** Bank charges: the company expense generated for it (D-16). */
  expenseId?: string | null;
  enteredByName?: string;
}

export const ENTRY_DIRECTION: Record<TransferKind, "out" | "in" | "both"> = {
  transfer: "both", drawing: "out", capital: "in", loan_in: "in", loan_repay: "out", bank_charge: "out", interest_in: "in",
};

/** The `account_transactions.type` each kind posts as (data-model: receipt, payment, transfer, drawing, capital, loan_in, loan_out). */
export const ENTRY_ROW_TYPE: Record<TransferKind, AccountTxn["type"]> = {
  transfer: "transfer", drawing: "drawing", capital: "capital", loan_in: "loan_in", loan_repay: "loan_out", bank_charge: "payment", interest_in: "receipt",
};

/** English names for narrations and the CSV. Screens use their own translated labels. */
export const ENTRY_KIND_NAMES: Record<TransferKind, string> = {
  transfer: "Transfer between accounts", drawing: "Owner's drawings", capital: "Capital introduced", loan_in: "Loan taken",
  loan_repay: "Loan repaid", bank_charge: "Bank charges", interest_in: "Interest received",
};

/**
 * The effect a transfer or money entry must have: one account row out and/or one in, the account balances, and the
 * month's money in and out per account. For the five kinds the posting engine knows it equals `transferEffect`
 * (tested); for bank charges and interest it is the specification the engine patch implements.
 */
export function moneyEntryEffect(t: MoneyEntry): Effect {
  if (t.isDeleted || (t.approvalStatus && t.approvalStatus !== "approved")) return EMPTY_EFFECT;
  const monthKey = monthKeyOf(t.date);
  const fy = fyOf(t.date);
  const targets: Targets = {};
  const accountTxns: AccountTxn[] = [];
  const add = (doc: string, field: string, amount: number) => {
    if (!amount) return;
    const k = targetKey(doc, field);
    targets[k] = (targets[k] ?? 0) + amount;
  };
  const move = (suffix: "out" | "in", accountId: string, sign: 1 | -1) => {
    accountTxns.push({
      id: `account_transfers_${t.id}_${suffix}`, accountId, date: t.date, monthKey, fy, type: ENTRY_ROW_TYPE[t.kind], directionSign: sign,
      amountPaise: t.amountPaise, linkedEntity: "account_transfers", linkedId: t.id, narration: t.narration ?? "",
    });
    add(`finance_rollups/co_${monthKey}`, `accounts.${accountId}.${sign > 0 ? "inPaise" : "outPaise"}`, t.amountPaise);
    add(`accounts/${accountId}`, "balancePaise", sign * t.amountPaise);
  };
  if (t.fromAccountId) move("out", t.fromAccountId, -1);
  if (t.toAccountId) move("in", t.toAccountId, 1);
  return { targets, accountTxns, months: [monthKey] };
}

/** Whether the posting engine in this build posts a kind with the right row type (bank charges and interest need the patch). */
export function engineSupportsKind(kind: TransferKind): boolean {
  const dir = ENTRY_DIRECTION[kind];
  if (!dir) return false;
  const probe = {
    id: "probe", kind, fromAccountId: dir === "in" ? null : "a", toAccountId: dir === "out" ? null : "b",
    amountPaise: 100, date: "2026-04-01", monthKey: "2026-04", fy: "2026-27",
  } as unknown as AccountTransfer;
  const rows = transferEffect(probe).accountTxns;
  return rows.length > 0 && rows.every((r) => r.type === ENTRY_ROW_TYPE[kind]);
}

/** The entry kinds a form may offer in this build. */
export function availableEntryKinds(): MoneyEntryKind[] {
  return MONEY_ENTRY_KINDS.filter(engineSupportsKind);
}

export interface MoveCheck {
  kind: TransferKind;
  from: Pick<Account, "id" | "name" | "type" | "active" | "openingDate" | "isDeleted"> | null;
  to: Pick<Account, "id" | "name" | "type" | "active" | "openingDate" | "isDeleted"> | null;
  amountPaise: number;
  date: string;
  partyName?: string;
  today: string;
}

/** Field messages for a transfer or a money entry. `accountId` is used for the single account of a money entry. */
export function validateMove(m: MoveCheck): Record<string, string> {
  const e: Record<string, string> = {};
  const dir = ENTRY_DIRECTION[m.kind];
  if (!dir) { e.kind = "Choose what kind of entry this is."; return e; }
  const usable = (a: MoveCheck["from"]) => !!a && !a.isDeleted && a.active !== false;
  if (dir === "both") {
    if (!usable(m.from)) e.fromAccountId = "Choose the account the money left.";
    if (!usable(m.to)) e.toAccountId = "Choose the account the money went into.";
    if (m.from && m.to && m.from.id === m.to.id) e.toAccountId = "Choose two different accounts.";
  } else {
    const a = dir === "out" ? m.from : m.to;
    if (!usable(a)) e.accountId = dir === "out" ? "Choose the account the money left." : "Choose the account the money came into.";
    else if ((m.kind === "bank_charge" || m.kind === "interest_in") && a!.type === "cash") e.accountId = "Choose the bank or UPI account, not cash in hand.";
  }
  if (!Number.isSafeInteger(m.amountPaise) || m.amountPaise <= 0) e.amountPaise = "Enter the amount in rupees, more than zero.";
  if (!isDateStr(m.date)) e.date = "Enter the date.";
  else if (m.date > m.today) e.date = "The date can't be in the future.";
  else {
    for (const a of [m.from, m.to]) {
      if (a && isDateStr(a.openingDate) && m.date < a.openingDate && !e.date) e.date = `${a.name} starts on ${a.openingDate.split("-").reverse().join("/")}. Use that date or a later one.`;
    }
  }
  if ((m.kind === "loan_in" || m.kind === "loan_repay") && clean(m.partyName).length < 2) e.partyName = m.kind === "loan_in" ? "Enter who gave the loan." : "Enter who was repaid.";
  return e;
}

/** The line the cash book or bank book shows for an entry. */
export function entryNarration(kind: TransferKind, o: { from?: Pick<Account, "name" | "type"> | null; to?: Pick<Account, "name" | "type"> | null; partyName?: string; note?: string; reference?: string }): string {
  let head: string;
  if (kind === "transfer") {
    head = o.from?.type === "cash" && o.to && o.to.type !== "cash" ? `Cash deposited in ${o.to.name}`
      : o.to?.type === "cash" && o.from && o.from.type !== "cash" ? `Cash withdrawn from ${o.from.name}`
      : `Transfer from ${o.from?.name ?? "?"} to ${o.to?.name ?? "?"}`;
  } else {
    const party = clean(o.partyName);
    head = kind === "loan_in" ? `Loan taken from ${party}` : kind === "loan_repay" ? `Loan repaid to ${party}`
      : party ? `${ENTRY_KIND_NAMES[kind]}: ${party}` : ENTRY_KIND_NAMES[kind];
  }
  const note = clean(o.note);
  const ref = clean(o.reference);
  return [head, note, ref ? `Ref ${ref}` : ""].filter(Boolean).join(" · ");
}

// ───────────────────────── cash book and bank book ─────────────────────────

export const signedPaise = (t: Pick<AccountTxn, "directionSign" | "amountPaise">): number => t.directionSign * t.amountPaise;

/** Book order: by date, then by row id (the same order a paged query by date gives, so pages join up exactly). */
export function sortBookRows<T extends Pick<AccountTxn, "date" | "id">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export interface BookLine { txn: AccountTxn; inPaise: number; outPaise: number; balancePaise: number }

/** Rows already in book order, each with the balance after it, starting from `startPaise`. */
export function runningLines(startPaise: number, rows: AccountTxn[]): BookLine[] {
  let bal = startPaise;
  return rows.map((txn) => {
    bal += signedPaise(txn);
    return { txn, inPaise: txn.directionSign > 0 ? txn.amountPaise : 0, outPaise: txn.directionSign < 0 ? txn.amountPaise : 0, balancePaise: bal };
  });
}

export interface AccountBookView { from: string; to: string; openingPaise: number; lines: BookLine[]; inPaise: number; outPaise: number; closingPaise: number }

/**
 * A cash book or bank book for a date range (§11A.3: opening balance, every entry, running closing balance).
 * `balanceAtStartPaise` is the balance before the earliest row given; rows dated before `from` are folded into the
 * opening line, rows after `to` are left out.
 */
export function accountBook(balanceAtStartPaise: number, rows: AccountTxn[], from: string, to: string): AccountBookView {
  const sorted = sortBookRows(rows);
  const opening = balanceAtStartPaise + sorted.filter((r) => r.date < from).reduce((s, r) => s + signedPaise(r), 0);
  const lines = runningLines(opening, sorted.filter((r) => r.date >= from && r.date <= to));
  const inPaise = lines.reduce((s, l) => s + l.inPaise, 0);
  const outPaise = lines.reduce((s, l) => s + l.outPaise, 0);
  return { from, to, openingPaise: opening, lines, inPaise, outPaise, closingPaise: opening + inPaise - outPaise };
}

/** The company months whose `finance_rollups` are needed to work back from today's balance to the start of `date`'s month. */
export function bookMonths(date: string, today: string): string[] {
  const end = today > date ? today : date;
  return monthsBetween(date, addDays(end, 92)); // a quarter ahead, in case an entry carries a later date
}

/**
 * The balance of an account at the start of `date` (before any row of that day), without reading its whole history:
 * today's stored balance, less the money in and out of every month from `date`'s month onwards (company rollups for
 * `bookMonths(date, today)`), plus the rows of `date`'s month that fall before `date`.
 */
export function balanceBefore(
  account: Pick<Account, "id" | "balancePaise" | "openingBalancePaise">, date: string,
  rollups: (FinanceRollup | null | undefined)[], rowsOfThatMonth: Pick<AccountTxn, "accountId" | "date" | "directionSign" | "amountPaise">[],
): number {
  const now = account.balancePaise ?? account.openingBalancePaise;
  const flow = sumFinance(rollups).accounts[account.id] ?? { inPaise: 0, outPaise: 0 };
  const month = monthKeyOf(date);
  const head = rowsOfThatMonth.filter((r) => r.accountId === account.id && r.date < date && r.date.slice(0, 7) === month).reduce((s, r) => s + signedPaise(r), 0);
  return now - (flow.inPaise - flow.outPaise) + head;
}

/** Money in and out of one account in the months given (the account list's "this month" figures). */
export function accountFlow(accountId: string, rollups: (FinanceRollup | null | undefined)[]): { inPaise: number; outPaise: number } {
  return sumFinance(rollups).accounts[accountId] ?? { inPaise: 0, outPaise: 0 };
}

// ───────────────────────── month lock (§11A.4, §3.1 rule 13, D-13) ─────────────────────────

export const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface PeriodLock { id: string; monthKey: string; lockedBy: string; lockedByName?: string; lockedAt: string; note?: string }

export function isMonthLocked(store: MemoryStore, monthKey: string): boolean {
  return store.get("period_locks", monthKey) !== null;
}

/**
 * Every command that records or changes money calls this with the record's date (and, on a change, the old date too).
 * `what` names the thing being saved, e.g. "this payment". Throws a refusal in plain words when the month is locked.
 * The month is always derived from the date (D-13), never read from a stored field.
 */
export function assertMonthOpen(store: MemoryStore, date: string, what = "this entry"): void {
  if (!isDateStr(date)) throw new CommandError("Enter the date.", { date: "Enter the date." });
  const month = monthKeyOf(date);
  if (!isMonthLocked(store, month)) return;
  const name = formatMonth(month);
  throw new CommandError(
    `${name} is locked, so ${what} can't be saved or changed in it. Ask the owner to unlock ${name}, or use a date in an open month.`,
    { date: `${name} is locked.` },
  );
}
