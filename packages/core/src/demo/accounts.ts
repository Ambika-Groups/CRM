/**
 * Demo data for Accounts: what the base seed lacks. The base seed has cash in hand, two bank accounts and a weekly cash
 * withdrawal; this adds a UPI account, a top-up and a cash deposit, capital introduced, an owner's drawing, a loan taken
 * and a part repayment, and (when the posting engine supports them) a bank charge and interest received.
 * Everything goes through the Accounts commands, so balances, books and the month's totals are made the same way as in
 * real use. Fixed ids (prefix `acc` / `acent`) and dates relative to the anchor keep the demo the same every time.
 */
import { engineSupportsKind } from "../accounts";
import { addDays } from "../dates";
import { createMoneyEntry, createTransfer, saveAccount } from "../commands/accounts";
import type { CommandCtx } from "../commands/common";
import type { Account } from "../model";
import type { FeatureSeedCtx } from "./features";

const R = (rupees: number) => Math.round(rupees * 100);

export const ACCOUNTS_DEMO_IDS = { upi: "accUpi", cash: "accCash", sbi: "accSbi", hdfc: "accHdfc" } as const;

export async function seedAccounts(ctx: FeatureSeedCtx): Promise<void> {
  const { store, anchor } = ctx;
  const c: CommandCtx = { uid: ctx.ownerUid, role: "owner", projectIds: [], nowIso: ctx.nowIso };
  const { upi, cash, sbi, hdfc } = ACCOUNTS_DEMO_IDS;
  if (!store.get("accounts", sbi) || !store.get("accounts", hdfc) || store.get("accounts", upi)) return; // base accounts missing, or already seeded
  const day = (back: number) => addDays(anchor, -back);

  saveAccount(store, { name: "Business UPI", type: "upi", bankName: "Linked to HDFC", last4: "", openingBalancePaise: R(15000), openingDate: day(60) }, c, upi);

  await createMoneyEntry(store, { kind: "loan_in", accountId: sbi, amountPaise: R(1000000), date: day(50), partyName: "Shriram Finance", note: "Working capital loan", reference: "LN/2026/4471" }, c, "acentLoanTaken");
  await createMoneyEntry(store, { kind: "capital", accountId: hdfc, amountPaise: R(500000), date: day(45), partyName: "Anil Mishra", note: "Money put in by the owner" }, c, "acentCapital");
  await createTransfer(store, { fromAccountId: hdfc, toAccountId: upi, amountPaise: R(50000), date: day(20), note: "Top-up for small site payments" }, c, "acentUpiTopUp");
  await createMoneyEntry(store, { kind: "loan_repay", accountId: sbi, amountPaise: R(50000), date: day(15), partyName: "Shriram Finance", note: "First instalment", reference: "NACH 0915" }, c, "acentLoanRepaid");
  await createMoneyEntry(store, { kind: "drawing", accountId: hdfc, amountPaise: R(60000), date: day(10), partyName: "Anil Mishra", note: "Household expenses" }, c, "acentDrawing");
  if (engineSupportsKind("interest_in")) {
    await createMoneyEntry(store, { kind: "interest_in", accountId: hdfc, amountPaise: R(1240), date: day(8), note: "Quarterly interest" }, c, "acentInterest");
  }
  if (engineSupportsKind("bank_charge") && store.get("expense_categories", "cat_permits")) {
    await createMoneyEntry(store, { kind: "bank_charge", accountId: sbi, amountPaise: R(590), date: day(5), note: "Cheque book and SMS charges" }, c, "acentBankCharge");
  }
  // A cash deposit, only when the cash box can spare it (the demo never shows cash below zero).
  const cashNow = store.get<Account>("accounts", cash)?.balancePaise ?? 0;
  if (cashNow >= R(75000)) {
    await createTransfer(store, { fromAccountId: cash, toAccountId: sbi, amountPaise: R(25000), date: day(2), note: "Surplus cash banked", reference: "Slip 118" }, c, "acentCashDeposit");
  }
}
