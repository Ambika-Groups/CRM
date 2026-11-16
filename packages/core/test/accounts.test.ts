// Accounts, cash book and bank book, month lock, and the master CSV (spec §11A.2, §11A.4, §11A.7; §3.1 rules 5 and 13;
// D-07, D-08, D-13, D-16, D-20). IDs AC-xx are cited in docs/prd-traceability.md.
import { beforeEach, describe, expect, it } from "vitest";
import {
  BOM, MASTER_COLUMNS, parseCsv, seedDemo, sumFinance, transferEffect,
  type Account, type AccountTransfer, type AccountTxn, type CommandCtx, type Expense, type FinanceRollup, type Invoice, type MemoryStore,
  type PaymentReceived, type WorkerPayment,
} from "../src";
import {
  ENTRY_ROW_TYPE, accountBook, assertMonthOpen, availableEntryKinds, balanceBefore, bookMonths, engineSupportsKind, moneyEntryEffect, runningLines,
  sortBookRows, validateAccount, type MoneyEntry,
} from "../src/accounts";
import {
  ACCOUNT_COMMANDS, archiveAccount, cancelMoneyEntry, cancelTransfer, createMoneyEntry, createTransfer, lockMonth, saveAccount, setOpeningBalance, unlockMonth,
} from "../src/commands/accounts";
import { seedAccounts } from "../src/demo/accounts";
import {
  buildMasterRows, checkMasterTotals, exportPresets, masterCsv, masterInputFromStore, masterTotals, rollupsFromStore, wholeMonths,
} from "../src/exportCsv";

const ANCHOR = "2026-10-25";
const NOW = "2026-10-25T09:00:00.000Z"; // 14:30 IST
const owner: CommandCtx = { uid: "uOwner", role: "owner", projectIds: [], nowIso: NOW };
const accountant: CommandCtx = { uid: "uAccountant", role: "accountant", projectIds: [], nowIso: NOW };
const pm: CommandCtx = { uid: "uPm", role: "pm", projectIds: ["projShivNagar"], nowIso: NOW };
const sup: CommandCtx = { uid: "uSupShivNagar", role: "supervisor", projectIds: ["projShivNagar"], nowIso: NOW };
const viewer: CommandCtx = { uid: "uViewer", role: "viewer", projectIds: [], nowIso: NOW };
const ca: CommandCtx = { uid: "uCa", role: "ca", projectIds: [], nowIso: NOW };
const CASH = "accCash", SBI = "accSbi", HDFC = "accHdfc";

let store: MemoryStore;
beforeEach(async () => {
  ({ store } = await seedDemo(ANCHOR));
  // The lane lead adds seedAccounts to the demo; it does nothing when it has already run.
  await seedAccounts({ store, anchor: ANCHOR, nowIso: NOW, ownerUid: "uOwner" });
});

const account = (id: string) => store.get<Account>("accounts", id)!;
const bal = (id: string) => account(id).balancePaise!;
const rowsOf = (id: string) => store.list<AccountTxn>("account_transactions", (t) => t.accountId === id);
const net = (id: string) => rowsOf(id).reduce((s, t) => s + t.directionSign * t.amountPaise, 0);
const allBalances = () => store.list<Account>("accounts").reduce((s, a) => s + (a.balancePaise ?? 0), 0);
const snap = () => JSON.stringify(store.snapshot());
/** Every account: balance = opening + its rows (seed test S-012), the invariant every command must keep. */
const expectBooksBalanced = () => { for (const a of store.list<Account>("accounts")) expect(a.balancePaise, a.name).toBe(a.openingBalancePaise + net(a.id)); };
const coMonths = () => [...new Set([...store.list<{ id: string }>("rollups"), ...store.list<{ id: string }>("finance_rollups")].map((d) => d.id).filter((id) => /^co_\d{4}-\d{2}$/.test(id)).map((id) => id.slice(3)))].sort();

describe("accounts and opening balances (§11A.4, §12)", () => {
  it("AC-01 a new account starts at its opening balance, and the opening is posted once", () => {
    const { id } = saveAccount(store, { name: "PNB savings", type: "bank", bankName: "Punjab National Bank", last4: "7788", openingBalancePaise: 1_250_050, openingDate: "2026-10-01" }, accountant);
    expect(account(id)).toMatchObject({ name: "PNB savings", type: "bank", last4: "7788", active: true, openingBalancePaise: 1_250_050, balancePaise: 1_250_050 });
    expect(store.get("postings", `accounts_${id}`)).toMatchObject({ targets: { [`accounts/${id}|balancePaise`]: 1_250_050 } });
    // Renaming changes no money.
    saveAccount(store, { id, name: "PNB savings account", type: "bank", bankName: "Punjab National Bank", last4: "7788", openingBalancePaise: 999, openingDate: "2026-01-01" }, accountant);
    expect(account(id)).toMatchObject({ name: "PNB savings account", openingBalancePaise: 1_250_050, openingDate: "2026-10-01", balancePaise: 1_250_050 });
    const overdrawn = saveAccount(store, { name: "Axis overdraft", type: "bank", bankName: "Axis Bank", openingBalancePaise: -500_000, openingDate: "2026-10-01" }, owner);
    expect(bal(overdrawn.id)).toBe(-500_000);
    expectBooksBalanced();
  });

  it("AC-02 account details are checked with plain messages", () => {
    const today = "2026-10-25";
    const others = store.list<Account>("accounts");
    expect(validateAccount({ name: "cash in HAND", type: "cash", openingBalancePaise: 0, openingDate: today }, others, null, today, true).name).toMatch(/already has this name/);
    expect(validateAccount({ name: "Petty cash", type: "cash", openingBalancePaise: -100, openingDate: today }, others, null, today, true).openingBalancePaise).toMatch(/below zero/);
    expect(validateAccount({ name: "ICICI", type: "bank", openingBalancePaise: 0, openingDate: today }, others, null, today, true).bankName).toMatch(/bank's name/);
    expect(validateAccount({ name: "ICICI", type: "bank", bankName: "ICICI Bank", last4: "12345678", openingBalancePaise: 0, openingDate: today }, others, null, today, true).last4).toMatch(/last 4 digits/);
    expect(validateAccount({ name: "ICICI", type: "bank", bankName: "ICICI Bank", openingBalancePaise: 0, openingDate: "2026-10-26" }, others, null, today, true).openingDate).toMatch(/future/);
    expect(validateAccount({ name: "ICICI", type: "bank", bankName: "ICICI Bank", openingBalancePaise: 12.5, openingDate: today }, others, null, today, true).openingBalancePaise).toBeTruthy();
    expect(() => saveAccount(store, { name: "X", type: "cash", openingBalancePaise: 0, openingDate: today }, owner)).toThrow(/need fixing/);
    expect(() => saveAccount(store, { id: "nope", name: "Gone", type: "cash" }, owner)).toThrow(/no longer exists/);
  });

  it("AC-03 changing an opening balance moves the balance by the difference only; owner only", () => {
    const before = bal(SBI);
    const opening = account(SBI).openingBalancePaise;
    expect(() => setOpeningBalance(store, { id: SBI, openingBalancePaise: opening + 100_000, openingDate: account(SBI).openingDate }, accountant)).toThrow(/Your role can't change an opening balance/);
    setOpeningBalance(store, { id: SBI, openingBalancePaise: opening + 100_000, openingDate: account(SBI).openingDate }, owner);
    expect(bal(SBI)).toBe(before + 100_000);
    // Again, now from the posting record; and a repeat of the same values changes nothing.
    setOpeningBalance(store, { id: SBI, openingBalancePaise: opening - 50_000, openingDate: account(SBI).openingDate }, owner);
    expect(bal(SBI)).toBe(before - 50_000);
    const s = snap();
    expect(setOpeningBalance(store, { id: SBI, openingBalancePaise: opening - 50_000, openingDate: account(SBI).openingDate }, owner).changed).toBe(false);
    expect(snap()).toBe(s);
    expectBooksBalanced();
    // The opening date can't jump past entries already in the books.
    expect(() => setOpeningBalance(store, { id: SBI, openingBalancePaise: opening, openingDate: "2026-10-20" }, owner)).toThrow(/already has \d+ entries before that date/);
  });

  it("AC-04 an account with money in it can't be closed; a closed account takes no new entries", async () => {
    expect(() => archiveAccount(store, { id: HDFC, archived: true }, accountant)).toThrow(/still has ₹.*Move the money/);
    const { id } = saveAccount(store, { name: "Old current account", type: "bank", bankName: "Bank of Baroda", openingBalancePaise: 0, openingDate: "2026-09-01" }, owner);
    archiveAccount(store, { id, archived: true }, accountant);
    expect(account(id).active).toBe(false);
    await expect(createTransfer(store, { fromAccountId: SBI, toAccountId: id, amountPaise: 100_000, date: "2026-10-20" }, owner)).rejects.toMatchObject({ fields: { toAccountId: expect.stringMatching(/Choose the account/) } });
    archiveAccount(store, { id, archived: false }, accountant);
    await createTransfer(store, { fromAccountId: SBI, toAccountId: id, amountPaise: 100_000, date: "2026-10-20" }, owner);
    expect(bal(id)).toBe(100_000);
  });
});

describe("transfers between own accounts (§11A.4; D-07, D-08)", () => {
  it("AC-10 a transfer moves both balances, nets to zero, and writes one row out and one row in", async () => {
    const total = allBalances();
    const [sbi, cash] = [bal(SBI), bal(CASH)];
    const r = await createTransfer(store, { fromAccountId: SBI, toAccountId: CASH, amountPaise: 7_500_050, date: "2026-10-22", note: "For Saturday wages", reference: "ATM 4471" }, accountant);
    expect(bal(SBI)).toBe(sbi - 7_500_050);
    expect(bal(CASH)).toBe(cash + 7_500_050);
    expect(allBalances()).toBe(total);
    expect(r).toMatchObject({ fromBalancePaise: sbi - 7_500_050, toBalancePaise: cash + 7_500_050, cashBelowZero: false });
    const out = store.get<AccountTxn>("account_transactions", `account_transfers_${r.id}_out`)!;
    const inn = store.get<AccountTxn>("account_transactions", `account_transfers_${r.id}_in`)!;
    expect(out).toMatchObject({ accountId: SBI, directionSign: -1, amountPaise: 7_500_050, type: "transfer", date: "2026-10-22", monthKey: "2026-10", fy: "2026-27", linkedEntity: "account_transfers", linkedId: r.id });
    expect(inn).toMatchObject({ accountId: CASH, directionSign: 1, amountPaise: 7_500_050, type: "transfer" });
    expect(out.narration).toBe("Cash withdrawn from SBI current account · For Saturday wages · Ref ATM 4471");
    // What was posted is exactly what the rules say a transfer must post.
    const entry = store.get<MoneyEntry>("account_transfers", r.id)!;
    expect(store.get<{ targets: unknown }>("postings", `account_transfers_${r.id}`)!.targets).toEqual(moneyEntryEffect(entry).targets);
    expectBooksBalanced();
  });

  it("AC-11 cancelling a transfer puts everything back exactly", async () => {
    const before = { sbi: bal(SBI), hdfc: bal(HDFC), rows: store.list("account_transactions").length, fin: sumFinance(store.list<FinanceRollup>("finance_rollups", (d) => d.id.startsWith("co_"))) };
    const r = await createTransfer(store, { fromAccountId: SBI, toAccountId: HDFC, amountPaise: 12_345_678, date: "2026-09-30" }, owner);
    expect(bal(SBI)).toBe(before.sbi - 12_345_678);
    await expect(cancelTransfer(store, { id: r.id, reason: "" }, owner)).rejects.toThrow(/Say why/);
    const back = await cancelTransfer(store, { id: r.id, reason: "Entered twice" }, accountant);
    expect(back).toMatchObject({ fromBalancePaise: before.sbi, toBalancePaise: before.hdfc });
    expect(bal(SBI)).toBe(before.sbi);
    expect(bal(HDFC)).toBe(before.hdfc);
    expect(store.list("account_transactions")).toHaveLength(before.rows);
    expect(sumFinance(store.list<FinanceRollup>("finance_rollups", (d) => d.id.startsWith("co_")))).toEqual(before.fin);
    expect(store.get("account_transfers", r.id)).toMatchObject({ isDeleted: true, deleteReason: "Entered twice", deletedBy: "uAccountant" });
    await expect(cancelTransfer(store, { id: r.id, reason: "Again" }, owner)).rejects.toThrow(/already cancelled/);
    expectBooksBalanced();
  });

  it("AC-12 a transfer is refused with a message on the field that is wrong, and nothing is written", async () => {
    const s = snap();
    const base = { fromAccountId: SBI, toAccountId: CASH, amountPaise: 100_000, date: "2026-10-20" };
    await expect(createTransfer(store, { ...base, toAccountId: SBI }, owner)).rejects.toMatchObject({ fields: { toAccountId: "Choose two different accounts." } });
    await expect(createTransfer(store, { ...base, amountPaise: 0 }, owner)).rejects.toMatchObject({ fields: { amountPaise: expect.stringMatching(/more than zero/) } });
    await expect(createTransfer(store, { ...base, amountPaise: 10.5 }, owner)).rejects.toMatchObject({ fields: { amountPaise: expect.any(String) } });
    await expect(createTransfer(store, { ...base, date: "2026-10-26" }, owner)).rejects.toMatchObject({ fields: { date: "The date can't be in the future." } });
    await expect(createTransfer(store, { ...base, date: "2026-08-01" }, owner)).rejects.toMatchObject({ fields: { date: expect.stringMatching(/starts on 26\/08\/2026/) } });
    await expect(createTransfer(store, { ...base, fromAccountId: "" }, owner)).rejects.toMatchObject({ fields: { fromAccountId: expect.any(String) } });
    expect(snap()).toBe(s);
  });

  it("AC-13 taking more cash out than the cash box holds is saved, and flagged", async () => {
    const r = await createTransfer(store, { fromAccountId: CASH, toAccountId: SBI, amountPaise: bal(CASH) + 100, date: "2026-10-24" }, owner);
    expect(r.cashBelowZero).toBe(true);
    expect(bal(CASH)).toBe(-100);
  });
});

describe("drawings, capital, loans, bank charges and interest (§11A.4)", () => {
  it("AC-20 each kind moves one account the right way with the right row type", async () => {
    const hdfc = bal(HDFC);
    const d = await createMoneyEntry(store, { kind: "drawing", accountId: HDFC, amountPaise: 2_000_000, date: "2026-10-21", partyName: "Anil Mishra" }, accountant);
    const c = await createMoneyEntry(store, { kind: "capital", accountId: HDFC, amountPaise: 9_000_000, date: "2026-10-21" }, owner);
    const l = await createMoneyEntry(store, { kind: "loan_in", accountId: HDFC, amountPaise: 30_000_000, date: "2026-10-22", partyName: "Suresh Agarwal" }, owner);
    const p = await createMoneyEntry(store, { kind: "loan_repay", accountId: HDFC, amountPaise: 1_000_000, date: "2026-10-23", partyName: "Suresh Agarwal" }, owner);
    expect(bal(HDFC)).toBe(hdfc - 2_000_000 + 9_000_000 + 30_000_000 - 1_000_000);
    const row = (id: string, side: "in" | "out") => store.get<AccountTxn>("account_transactions", `account_transfers_${id}_${side}`)!;
    expect(row(d.id, "out")).toMatchObject({ type: "drawing", directionSign: -1, narration: "Owner's drawings: Anil Mishra" });
    expect(row(c.id, "in")).toMatchObject({ type: "capital", directionSign: 1, narration: "Capital introduced" });
    expect(row(l.id, "in")).toMatchObject({ type: "loan_in", directionSign: 1, narration: "Loan taken from Suresh Agarwal" });
    expect(row(p.id, "out")).toMatchObject({ type: "loan_out", directionSign: -1, narration: "Loan repaid to Suresh Agarwal" });
    await expect(createMoneyEntry(store, { kind: "loan_in", accountId: HDFC, amountPaise: 100, date: "2026-10-22" }, owner)).rejects.toMatchObject({ fields: { partyName: "Enter who gave the loan." } });
    await expect(createMoneyEntry(store, { kind: "gift" as never, accountId: HDFC, amountPaise: 100, date: "2026-10-22" }, owner)).rejects.toThrow(/what kind of entry/);
    await cancelMoneyEntry(store, { id: d.id, reason: "Wrong account" }, owner);
    expect(bal(HDFC)).toBe(hdfc + 9_000_000 + 30_000_000 - 1_000_000);
    await expect(cancelTransfer(store, { id: c.id, reason: "Not a transfer" }, owner)).rejects.toThrow(/no longer exists/);
    expectBooksBalanced();
  });

  it("AC-21 the rules for every kind match what the posting engine posts", () => {
    const entry = (kind: MoneyEntry["kind"], from: string | null, to: string | null): MoneyEntry =>
      ({ id: "x1", kind, fromAccountId: from, toAccountId: to, amountPaise: 123_456, date: "2026-03-31", monthKey: "2026-03", fy: "2025-26", narration: "n" });
    const cases: MoneyEntry[] = [entry("transfer", "a", "b"), entry("drawing", "a", null), entry("capital", null, "b"), entry("loan_in", null, "b"), entry("loan_repay", "a", null)];
    for (const e of cases) {
      const engine = transferEffect(e as AccountTransfer);
      const rules = moneyEntryEffect(e);
      expect(rules.targets, e.kind).toEqual(engine.targets);
      expect(rules.accountTxns, e.kind).toEqual(engine.accountTxns);
      expect(rules.months).toEqual(engine.months);
    }
    // A transfer's targets net to zero across the two balances.
    const t = moneyEntryEffect(cases[0]!).targets;
    expect(t["accounts/a|balancePaise"]! + t["accounts/b|balancePaise"]!).toBe(0);
    expect(t["finance_rollups/co_2026-03|accounts.a.outPaise"]).toBe(123_456);
    // Bank charges and interest: the specification the engine patch implements.
    expect(moneyEntryEffect(entry("bank_charge", "a", null)).accountTxns[0]).toMatchObject({ id: "account_transfers_x1_out", type: "payment", directionSign: -1, fy: "2025-26" });
    expect(moneyEntryEffect(entry("interest_in", null, "b")).accountTxns[0]).toMatchObject({ id: "account_transfers_x1_in", type: "receipt", directionSign: 1 });
    expect(ENTRY_ROW_TYPE.loan_repay).toBe("loan_out");
    // Cancelled or unapproved entries post nothing.
    expect(moneyEntryEffect({ ...entry("drawing", "a", null), isDeleted: true }).accountTxns).toHaveLength(0);
    expect(moneyEntryEffect({ ...entry("drawing", "a", null), approvalStatus: "pending" }).accountTxns).toHaveLength(0);
  });

  it("AC-22 bank charges book a company expense once (D-16) and interest comes in; refused in plain words until the engine supports them", async () => {
    const input = { kind: "bank_charge" as const, accountId: SBI, amountPaise: 59_000, date: "2026-10-23", note: "Cheque return" };
    if (!engineSupportsKind("bank_charge")) {
      expect(availableEntryKinds()).toEqual(["drawing", "capital", "loan_in", "loan_repay"]);
      await expect(createMoneyEntry(store, input, owner)).rejects.toThrow(/Bank charges can't be recorded here yet/);
      await expect(createMoneyEntry(store, { ...input, kind: "interest_in" }, owner)).rejects.toThrow(/Interest received can't be recorded here yet/);
      return;
    }
    const sbi = bal(SBI);
    const expenseTotal = () => rollupsFromStore(store, ["2026-10"]).cost[0]!.expenseTotalPaise ?? 0;
    const spent = expenseTotal();
    const r = await createMoneyEntry(store, input, accountant);
    expect(bal(SBI)).toBe(sbi - 59_000);
    expect(expenseTotal()).toBe(spent + 59_000);
    const exp = store.get<Expense>("expenses", store.get<MoneyEntry>("account_transfers", r.id)!.expenseId!)!;
    expect(exp).toMatchObject({ source: "bank_charge", projectId: null, amountPaise: 59_000, approvalStatus: "approved" });
    expect(store.get("account_transactions", `expenses_${exp.id}`)).toBeNull(); // the entry moved the money, not the expense
    await expect(createMoneyEntry(store, { ...input, accountId: CASH }, owner)).rejects.toMatchObject({ fields: { accountId: expect.stringMatching(/not cash in hand/) } });
    await cancelMoneyEntry(store, { id: r.id, reason: "Reversed by the bank" }, owner);
    expect(bal(SBI)).toBe(sbi);
    expect(expenseTotal()).toBe(spent);
    const i = await createMoneyEntry(store, { kind: "interest_in", accountId: SBI, amountPaise: 124_000, date: "2026-10-23" }, owner);
    expect(store.get("account_transactions", `account_transfers_${i.id}_in`)).toMatchObject({ type: "receipt", directionSign: 1 });
    expectBooksBalanced();
  });
});

describe("cash book and bank book (§11A.3 item 4, §11A.4)", () => {
  it("AC-30 the running balance of every account ends at its stored balance", () => {
    for (const a of store.list<Account>("accounts")) {
      const book = accountBook(a.openingBalancePaise, rowsOf(a.id), "2000-01-01", "2099-12-31");
      expect(book.openingPaise).toBe(a.openingBalancePaise);
      expect(book.closingPaise, a.name).toBe(a.balancePaise);
      expect(book.lines.at(-1)?.balancePaise ?? a.openingBalancePaise).toBe(a.balancePaise);
      expect(book.openingPaise + book.inPaise - book.outPaise).toBe(book.closingPaise);
    }
  });

  it("AC-31 a date range opens with the balance brought forward and closes with the balance carried forward", () => {
    const rows = rowsOf(SBI);
    const oct = accountBook(account(SBI).openingBalancePaise, rows, "2026-10-01", "2026-10-31");
    const sep = accountBook(account(SBI).openingBalancePaise, rows, "2026-09-01", "2026-09-30");
    expect(oct.openingPaise).toBe(sep.closingPaise);
    expect(oct.lines.every((l) => l.txn.date >= "2026-10-01" && l.txn.date <= "2026-10-31")).toBe(true);
    expect(oct.lines.length).toBeGreaterThan(10);
    const dates = oct.lines.map((l) => l.txn.date);
    expect([...dates].sort()).toEqual(dates);
    // Each line's balance is the one before it, plus money in, less money out.
    oct.lines.forEach((l, n) => expect(l.balancePaise).toBe((n ? oct.lines[n - 1]!.balancePaise : oct.openingPaise) + l.inPaise - l.outPaise));
  });

  it("AC-32 the opening of any day comes from the stored balance and the monthly totals, without reading the whole history", () => {
    const fin = (date: string) => bookMonths(date, ANCHOR).map((m) => store.get<FinanceRollup>("finance_rollups", `co_${m}`));
    for (const a of store.list<Account>("accounts")) {
      for (const date of ["2026-04-01", "2026-09-01", "2026-09-17", "2026-10-01", "2026-10-13", "2026-10-25", "2026-10-26"]) {
        const brute = a.openingBalancePaise + rowsOf(a.id).filter((t) => t.date < date).reduce((s, t) => s + t.directionSign * t.amountPaise, 0);
        const monthRows = store.list<AccountTxn>("account_transactions", (t) => t.accountId === a.id && t.date.slice(0, 7) === date.slice(0, 7));
        expect(balanceBefore(a, date, fin(date), monthRows), `${a.name} ${date}`).toBe(brute);
      }
    }
    expect(bookMonths("2026-09-17", ANCHOR)[0]).toBe("2026-09");
    expect(bookMonths("2026-09-17", ANCHOR)).toContain("2026-11");
  });

  it("AC-33 pages of 50 rows join up into the same book", () => {
    const a = account(CASH);
    const sorted = sortBookRows(rowsOf(CASH));
    expect(sorted.length).toBeGreaterThan(100);
    const whole = accountBook(a.openingBalancePaise, sorted, "2000-01-01", "2099-12-31").lines;
    let start = a.openingBalancePaise;
    const paged = [];
    for (let i = 0; i < sorted.length; i += 50) {
      const lines = runningLines(start, sorted.slice(i, i + 50));
      paged.push(...lines);
      start = lines.at(-1)!.balancePaise;
    }
    expect(paged.map((l) => [l.txn.id, l.balancePaise])).toEqual(whole.map((l) => [l.txn.id, l.balancePaise]));
    expect(start).toBe(a.balancePaise);
  });
});

describe("month lock (§11A.4, §3.1 rule 13, D-13)", () => {
  it("AC-40 only the owner locks a month; the lock's id is the month", () => {
    expect(() => lockMonth(store, { monthKey: "2026-09" }, accountant)).toThrow(/Your role can't lock a month/);
    const lock = lockMonth(store, { monthKey: "2026-09", note: "Confirmed by CA Rakesh Jain" }, owner);
    expect(lock).toMatchObject({ id: "2026-09", lockedBy: "uOwner", lockedByName: "Anil Mishra", note: "Confirmed by CA Rakesh Jain" });
    expect(store.get("period_locks", "2026-09")).toMatchObject({ monthKey: "2026-09", lockedAt: NOW });
    expect(() => lockMonth(store, { monthKey: "2026-09" }, owner)).toThrow(/Sep 2026 is already locked/);
    expect(() => lockMonth(store, { monthKey: "2026-11" }, owner)).toThrow(/hasn't started yet/);
    expect(() => lockMonth(store, { monthKey: "2026-9" }, owner)).toThrow(/Choose the month/);
    expect(store.list<{ action: string; entity: string }>("audit_log", (a) => a.entity === "period_locks" && a.action === "lock")).toHaveLength(1);
  });

  it("AC-41 a locked month refuses in plain words, and nothing is written", async () => {
    lockMonth(store, { monthKey: "2026-09" }, owner);
    let message = "";
    try { assertMonthOpen(store, "2026-09-15", "this payment"); } catch (e) { message = (e as Error).message; }
    expect(message).toBe("Sep 2026 is locked, so this payment can't be saved or changed in it. Ask the owner to unlock Sep 2026, or use a date in an open month.");
    expect(message).not.toMatch(/§|period_locks|monthKey|2026-09|undefined|null/);
    expect(() => assertMonthOpen(store, "2026-10-01")).not.toThrow();
    expect(() => assertMonthOpen(store, "not a date")).toThrow(/Enter the date/);
    const s = snap();
    await expect(createTransfer(store, { fromAccountId: SBI, toAccountId: CASH, amountPaise: 100_000, date: "2026-09-10" }, owner)).rejects.toThrow(/Sep 2026 is locked, so this transfer/);
    await expect(createMoneyEntry(store, { kind: "drawing", accountId: HDFC, amountPaise: 100_000, date: "2026-09-30" }, owner)).rejects.toMatchObject({ fields: { date: "Sep 2026 is locked." } });
    // A transfer made in September before the lock can't be cancelled now.
    const old = store.list<AccountTransfer>("account_transfers", (t) => t.kind === "transfer" && t.date.startsWith("2026-09"))[0]!;
    await expect(cancelTransfer(store, { id: old.id, reason: "Mistake" }, owner)).rejects.toThrow(/is locked/);
    expect(snap()).toBe(s);
    // The posting engine refuses too, for any writer that skips the check (rule 13: enforced in both places).
    store.set("account_transfers", { id: "raw1", kind: "transfer", fromAccountId: SBI, toAccountId: CASH, amountPaise: 5_000, date: "2026-09-12", monthKey: "2026-09", fy: "2026-27" } as never);
    expect((await store.post("account_transfers", "raw1", NOW)).error).toMatch(/closed/);
    expect(store.get("account_transactions", "account_transfers_raw1_out")).toBeNull();
  });

  it("AC-42 an opening balance in a locked month can't be changed; unlocking needs the owner and a reason, and is audited", () => {
    lockMonth(store, { monthKey: "2026-08" }, owner); // the demo accounts open on 26 Aug 2026
    const a = account(SBI);
    expect(() => setOpeningBalance(store, { id: SBI, openingBalancePaise: a.openingBalancePaise + 1, openingDate: a.openingDate }, owner)).toThrow(/Aug 2026 is locked, so the opening balance/);
    expect(() => saveAccount(store, { name: "Late account", type: "cash", openingBalancePaise: 100, openingDate: "2026-08-30" }, owner)).toThrow(/Aug 2026 is locked/);
    expect(() => unlockMonth(store, { monthKey: "2026-08", reason: "CA asked for a correction" }, accountant)).toThrow(/Your role can't unlock a month/);
    expect(() => unlockMonth(store, { monthKey: "2026-08", reason: " " }, owner)).toThrow(/Say why/);
    expect(() => unlockMonth(store, { monthKey: "2026-07", reason: "Not locked" }, owner)).toThrow(/isn't locked/);
    unlockMonth(store, { monthKey: "2026-08", reason: "CA asked for a correction" }, owner);
    expect(store.get("period_locks", "2026-08")).toBeNull();
    expect(store.list<{ action: string; after?: { reason?: string } }>("audit_log", (x) => x.action === "unlock" && x.after?.reason === "CA asked for a correction")).toHaveLength(1);
    setOpeningBalance(store, { id: SBI, openingBalancePaise: a.openingBalancePaise + 1, openingDate: a.openingDate }, owner);
    expect(bal(SBI)).toBe(a.balancePaise! + 1);
  });
});

describe("who may do what (§2, D-42, D-43)", () => {
  it("AC-50 only the owner and the accountant change accounts or move money; the month lock is the owner's", async () => {
    const s = snap();
    const args: Record<keyof typeof ACCOUNT_COMMANDS, unknown> = {
      saveAccount: { name: "Side cash", type: "cash", openingBalancePaise: 0, openingDate: "2026-10-01" },
      setOpeningBalance: { id: SBI, openingBalancePaise: 1, openingDate: "2026-10-01" },
      archiveAccount: { id: SBI, archived: true },
      createTransfer: { fromAccountId: SBI, toAccountId: CASH, amountPaise: 100, date: "2026-10-20" },
      cancelTransfer: { id: "acentUpiTopUp", reason: "No reason" },
      createMoneyEntry: { kind: "drawing", accountId: SBI, amountPaise: 100, date: "2026-10-20" },
      cancelMoneyEntry: { id: "acentDrawing", reason: "No reason" },
      lockMonth: { monthKey: "2026-09" },
      unlockMonth: { monthKey: "2026-09", reason: "No reason" },
    };
    for (const ctx of [pm, sup, viewer, ca]) {
      for (const [name, a] of Object.entries(args)) {
        const fn = ACCOUNT_COMMANDS[name as keyof typeof ACCOUNT_COMMANDS] as (st: MemoryStore, x: unknown, c: CommandCtx) => unknown;
        await expect((async () => fn(store, a, ctx))(), `${ctx.role} ${name}`).rejects.toThrow(/^Your role can't /);
      }
    }
    expect(snap()).toBe(s);
    // The registry names work for the roles that may.
    const made = await ACCOUNT_COMMANDS.createTransfer(store, { fromAccountId: SBI, toAccountId: CASH, amountPaise: 100, date: "2026-10-20" }, accountant);
    expect(store.get("account_transfers", made.id)).toMatchObject({ kind: "transfer", createdBy: "uAccountant", enteredByName: "Priya Srivastava", approvalStatus: "approved" });
  });
});

describe("master CSV (§11A.2, §11A.7)", () => {
  const range = () => { const m = coMonths(); return wholeMonths(`${m[0]}-01`, `${m.at(-1)}-01`); };
  const rowsFor = (from: string, to: string, projectId?: string) => buildMasterRows(masterInputFromStore(store, from, to, projectId));

  it("AC-60 every expense, wage payment, invoice, receipt and transfer appears exactly once", () => {
    const { from, to } = range();
    const rows = rowsFor(from, to);
    const count = (entity: string, id: string) => rows.filter((r) => r.source.entity === entity && r.source.id === id).length;
    const keys = rows.map((r) => `${r.source.entity}/${r.source.id}/${r.source.line}`);
    expect(new Set(keys).size).toBe(keys.length);
    const payments = store.list<WorkerPayment>("worker_payments", (p) => p.approvalStatus === "approved" && !p.isDeleted);
    for (const p of payments) expect(count("worker_payments", p.id)).toBe(1);
    for (const e of store.list<Expense>("expenses", (x) => x.approvalStatus === "approved" && !x.isDeleted)) {
      // A wage payment and the Labour expense it generated are one voucher: the payment's row.
      expect(count("expenses", e.id), e.id).toBe(e.source === "wage" ? 0 : 1);
    }
    for (const e of store.list<Expense>("expenses", (x) => x.approvalStatus !== "approved")) expect(count("expenses", e.id)).toBe(0);
    for (const inv of store.list<Invoice>("invoices")) expect(count("invoices", inv.id), inv.id).toBe(inv.status === "draft" ? 0 : 1);
    for (const r of store.list<PaymentReceived>("payments_received")) expect(count("payments_received", r.id)).toBe(1);
    for (const t of store.list<MoneyEntry>("account_transfers", (x) => !x.isDeleted)) {
      const lines = count("account_transfers", t.id);
      if (t.kind === "transfer") expect(lines).toBe(2);
      else if (t.kind === "bank_charge") expect(lines).toBe(0); // shown as the expense it generated
      else expect(lines).toBe(1);
    }
    const types = new Set(rows.map((r) => r.voucherType));
    for (const t of ["Expense", "Wage payment", "Sales invoice", "Receipt", "Transfer", "Journal"] as const) expect(types.has(t), t).toBe(true);
    expect(masterTotals(rows).vouchers).toBeLessThan(rows.length); // transfers are one voucher on two lines
  });

  it("AC-61 the file's totals equal the rollups the dashboard reads, to the paisa, for the whole demo, one month and one project", () => {
    const { from, to, months } = range();
    const all = checkMasterTotals(rowsFor(from, to), ...Object.values(rollupsFromStore(store, months)) as [never, never]);
    expect(all.lines.filter((l) => !l.ok)).toEqual([]);
    expect(all.ok).toBe(true);
    expect(all.lines.find((l) => l.key === "expensePaise")!.filePaise).toBeGreaterThan(0);
    expect(all.lines.find((l) => l.key === "billedPaise")!.filePaise).toBeGreaterThan(0);
    expect(all.lines.filter((l) => l.key === "accountOut" && l.filePaise > 0).length).toBeGreaterThanOrEqual(3);

    const oct = wholeMonths("2026-10-07", "2026-10-19");
    expect(oct).toEqual({ from: "2026-10-01", to: "2026-10-31", months: ["2026-10"] });
    const r = rollupsFromStore(store, oct.months);
    const one = checkMasterTotals(rowsFor(oct.from, oct.to), r.cost, r.fin);
    expect(one.lines.filter((l) => !l.ok)).toEqual([]);
    // Total expense on the dashboard for October is this very number.
    expect(one.lines.find((l) => l.key === "expensePaise")!.filePaise).toBe(r.cost[0]!.expenseTotalPaise);

    for (const pid of ["projShivNagar", "projGomti", "projSharma"]) {
      const pr = rollupsFromStore(store, months, pid);
      const check = checkMasterTotals(rowsFor(from, to, pid), pr.cost, pr.fin, { accounts: false });
      expect(check.lines.filter((l) => !l.ok), pid).toEqual([]);
      expect(rowsFor(from, to, pid).every((x) => x.projectId === pid)).toBe(true);
    }
  });

  it("AC-62 the totals still agree after transfers, entries, a cancellation and a new expense, and a wrong file is caught", async () => {
    await createTransfer(store, { fromAccountId: HDFC, toAccountId: CASH, amountPaise: 4_000_000, date: "2026-10-18" }, owner);
    const gone = await createTransfer(store, { fromAccountId: SBI, toAccountId: HDFC, amountPaise: 999_999, date: "2026-10-19" }, owner);
    await cancelTransfer(store, { id: gone.id, reason: "Entered twice" }, owner);
    await createMoneyEntry(store, { kind: "capital", accountId: SBI, amountPaise: 25_000_000, date: "2026-10-05", partyName: "Anil Mishra" }, owner);
    const { from, to, months } = range();
    const r = rollupsFromStore(store, months);
    const rows = rowsFor(from, to);
    expect(checkMasterTotals(rows, r.cost, r.fin).ok).toBe(true);
    expect(rows.some((x) => x.source.id === gone.id)).toBe(false);
    // Transfers net to zero inside the file; a journal entry is one line.
    const transfers = rows.filter((x) => x.voucherType === "Transfer");
    expect(transfers.reduce((s, x) => s + (x.debitPaise ?? 0), 0)).toBe(transfers.reduce((s, x) => s + (x.creditPaise ?? 0), 0));
    // Drop one row: the check names the figures that no longer agree.
    const short = rows.filter((x) => x !== rows.find((y) => y.voucherType === "Expense" && y.moves.length > 0));
    const bad = checkMasterTotals(short, r.cost, r.fin);
    expect(bad.ok).toBe(false);
    expect(bad.lines.filter((l) => !l.ok).map((l) => l.key)).toEqual(expect.arrayContaining(["expensePaise", "accountOut"]));
  });

  it("AC-63 the CSV text itself adds up to the rollups (parsed back, two decimals)", () => {
    const { from, to, months } = range();
    const rows = rowsFor(from, to);
    const text = masterCsv(rows);
    const parsed = parseCsv(text);
    const head = parsed[0]!;
    const col = (name: (typeof MASTER_COLUMNS)[number]) => head.indexOf(name);
    const paise = (s: string) => (s === "" ? 0 : Math.round(Number(s) * 100));
    const sum = (type: string, name: (typeof MASTER_COLUMNS)[number], keep: (r: string[]) => boolean = () => true) =>
      parsed.slice(1).filter((r) => r[col("Voucher Type")] === type && keep(r)).reduce((s, r) => s + paise(r[col(name)]!), 0);
    const books = rollupsFromStore(store, months);
    const cost = books.cost.reduce((s, d) => s + (d?.expenseTotalPaise ?? 0), 0);
    const fin = sumFinance(books.fin);
    const notAdvance = (r: string[]) => !r[col("Narration")]!.startsWith("Advance to worker");
    expect(sum("Expense", "Debit") + sum("Wage payment", "Debit", notAdvance)).toBe(cost);
    expect(sum("Sales invoice", "Credit") - sum("Credit note", "Debit")).toBe(fin.billedPaise);
    expect(sum("Receipt", "Credit")).toBe(fin.receivedPaise + fin.clientAdvanceReceivedPaise);
    expect(sum("Receipt", "TDS deducted")).toBe(fin.tdsHeldPaise);
    expect(sum("Receipt", "Retention held")).toBe(fin.retentionHeldPaise);
    expect(sum("Sales invoice", "CGST") + sum("Sales invoice", "SGST") + sum("Sales invoice", "IGST")).toBe(fin.gstOutputPaise);
    expect(sum("Expense", "CGST") + sum("Expense", "SGST") + sum("Expense", "IGST")).toBe(fin.gstInputPaise);
    expect(sum("Transfer", "Debit")).toBe(sum("Transfer", "Credit"));
  });

  it("AC-64 file format: BOM, header row only, no totals row, two decimals, ISO or DD/MM/YYYY dates", () => {
    const rows = rowsFor("2026-10-01", "2026-10-31");
    const text = masterCsv(rows);
    expect(text.startsWith(BOM)).toBe(true);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.endsWith("\r\n")).toBe(true);
    const parsed = parseCsv(text);
    expect(parsed[0]).toEqual([...MASTER_COLUMNS]);
    expect(parsed).toHaveLength(rows.length + 1); // one header, one line per row, nothing else
    expect(parsed.every((r) => r.length === MASTER_COLUMNS.length)).toBe(true);
    const c = (name: (typeof MASTER_COLUMNS)[number]) => MASTER_COLUMNS.indexOf(name);
    for (const r of parsed.slice(1)) {
      for (const name of ["Taxable amount", "CGST", "SGST", "IGST", "TDS deducted", "Retention held", "Total amount", "Debit", "Credit"] as const) {
        expect(r[c(name)], name).toMatch(/^$|^-?\d+\.\d{2}$/);
      }
      expect(r[c("Date")]).toMatch(/^2026-10-\d{2}$/);
      expect(["Y", "N", ""]).toContain(r[c("Bill attached (Y/N)")]);
      expect(["Paid", "Unpaid", "Part", ""]).toContain(r[c("Payment status")]);
    }
    expect(parsed.slice(1).some((r) => /total/i.test(r[c("Voucher No")]!))).toBe(false);
    const dmy = parseCsv(masterCsv(rows, { dateFormat: "dmy" }));
    expect(dmy[1]![c("Date")]).toMatch(/^\d{2}\/10\/2026$/);
    expect(masterCsv(rows, { bom: false }).startsWith("Voucher No,")).toBe(true);
    // An expense row carries the columns a CA asks for.
    const e = store.get<Expense>("expenses", "exp0150")!;
    const line = parsed.find((r) => r[c("Voucher No")] === "EXP-exp0150")!;
    expect(line[c("Voucher Type")]).toBe("Expense");
    expect(line[c("Total amount")]).toBe((e.amountPaise / 100).toFixed(2));
    expect(line[c("GST rate")]).toBe(String(e.gstRateBp! / 100));
    expect(line[c("Category (level 1)")]).not.toBe("");
    expect(line[c("Project code")]).toMatch(/^AG-P-/);
    expect(line[c("Entered by")]).toBe(e.enteredByName);
  });

  it("AC-65 commas, quotes, line breaks and Hindi names survive the file", () => {
    const e = store.get<Expense>("expenses", "exp0010")!;
    store.set("expenses", { ...e, description: 'Gitti 20 mm, "first lot"\nsecond line', payeeName: "राजू निषाद, ट्रैक्टर वाले", noBillReason: " leading space" } as never);
    const rows = rowsFor(e.date, e.date).filter((r) => r.source.id === "exp0010");
    const text = masterCsv(rows);
    expect(text).toContain('"Gitti 20 mm, ""first lot""\nsecond line"');
    expect(text).toContain('"राजू निषाद, ट्रैक्टर वाले"');
    const back = parseCsv(text)[1]!;
    expect(back[MASTER_COLUMNS.indexOf("Narration")]).toBe('Gitti 20 mm, "first lot"\nsecond line');
    expect(back[MASTER_COLUMNS.indexOf("Party name")]).toBe("राजू निषाद, ट्रैक्टर वाले");
    expect(back[MASTER_COLUMNS.indexOf("No-bill reason")]).toBe(" leading space");
    expect(new TextEncoder().encode(text).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf])); // UTF-8 BOM bytes
  });

  it("AC-67 a credit purchase paid in a later month: the expense in its own month, the payment as its own line in the month it was paid", () => {
    const e = { ...store.get<Expense>("expenses", "exp0020")!, id: "expCreditPaidLater", date: "2026-09-10", monthKey: "2026-09", mode: "bank" as const, paidStatus: "paid" as const, accountId: HDFC, paidDate: "2026-10-06" };
    // An engine that dates the account row on the day the bill was paid (the expenses feature's posting change).
    const paidLaterEngine = (x: Expense) => {
      const paidDate = (x as Expense & { paidDate?: string }).paidDate;
      return paidDate ? { targets: {}, months: [], accountTxns: [{ id: `expenses_${x.id}`, accountId: x.accountId!, date: paidDate, monthKey: paidDate.slice(0, 7), fy: "2026-27", type: "payment" as const, directionSign: -1 as const, amountPaise: x.amountPaise, linkedEntity: "expenses", linkedId: x.id }] } : { targets: {}, months: [], accountTxns: [] };
    };
    const input = (from: string, to: string) => ({ ...masterInputFromStore(store, from, to), expenses: [e], workerPayments: [], invoices: [], receipts: [], transfers: [], expenseEffect: paidLaterEngine });
    const sep = buildMasterRows(input("2026-09-01", "2026-09-30"));
    expect(sep).toHaveLength(1);
    expect(sep[0]).toMatchObject({ voucherType: "Expense", date: "2026-09-10", mode: "Credit", account: "", paymentStatus: "Paid", moves: [], debitPaise: e.amountPaise });
    const oct = buildMasterRows(input("2026-10-01", "2026-10-31"));
    expect(oct).toHaveLength(1);
    expect(oct[0]).toMatchObject({ voucherType: "Vendor payment", date: "2026-10-06", account: "HDFC current account", debitPaise: e.amountPaise, figures: {}, source: { entity: "expenses", id: e.id, line: 2 } });
    expect(oct[0]!.moves).toEqual([{ accountId: HDFC, sign: -1, amountPaise: e.amountPaise }]);
    expect(masterTotals(oct).expensePaise).toBe(0); // the cost was counted in September, not again when paid
    expect(buildMasterRows(input("2026-09-01", "2026-10-31")).map((r) => r.voucherType)).toEqual(["Expense", "Vendor payment"]);
  });

  it("AC-66 the export screen's periods are whole months", () => {
    expect(exportPresets("2026-10-25", "2026-27")).toEqual({
      month: { from: "2026-10-01", to: "2026-10-31" }, lastMonth: { from: "2026-09-01", to: "2026-09-30" }, fy: { from: "2026-04-01", to: "2027-03-31" },
    });
    expect(exportPresets("2027-01-05", "2026-27").lastMonth).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(wholeMonths("2028-02-10", "2028-02-11").to).toBe("2028-02-29");
  });
});

describe("demo data for accounts", () => {
  it("AC-70 adds a UPI account, a top-up, capital, a drawing and a loan through the commands, and keeps the books exact", async () => {
    expect(account("accUpi")).toMatchObject({ type: "upi", openingBalancePaise: 1_500_000, balancePaise: 1_500_000 + 5_000_000 });
    const kinds = store.list<MoneyEntry>("account_transfers", (t) => t.id.startsWith("acent")).map((t) => t.kind).sort();
    expect(kinds).toEqual(expect.arrayContaining(["capital", "drawing", "loan_in", "loan_repay", "transfer"]));
    expectBooksBalanced(); // seed test S-012
    expect(bal(CASH)).toBeGreaterThanOrEqual(0); // seed test S-015
    const s = snap();
    await seedAccounts({ store, anchor: ANCHOR, nowIso: NOW, ownerUid: "uOwner" }); // safe to run again
    expect(snap()).toBe(s);
    const again = (await seedDemo(ANCHOR)).store;
    await seedAccounts({ store: again, anchor: ANCHOR, nowIso: NOW, ownerUid: "uOwner" });
    expect(JSON.stringify(again.snapshot().finance_rollups)).toBe(JSON.stringify(store.snapshot().finance_rollups));
    expect(JSON.stringify(again.snapshot().accounts)).toBe(JSON.stringify(store.snapshot().accounts));
  });
});
