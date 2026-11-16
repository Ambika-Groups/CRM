// Expense entry and approvals (spec §7.2; §2 roles; §3.1 rules 3, 5, 11; decisions D-07, D-08, D-16, D-20, D-30;
// defaults D12, D13, C12, I4). IDs EX-xx are cited in docs/prd-traceability.md. Money is checked to the paisa.
import { beforeEach, describe, expect, it } from "vitest";
import { CommandError, seedDemo, type Account, type CommandCtx, type CostRollup, type Expense, type FinanceRollup, type MemoryStore } from "../src";
import {
  approvalOnSave, approvalRefusal, approverRoles, DEFAULT_EXPENSE_LIMITS, editRefusal, entryRefusal, expenseLimits, expenseTotals, gstInclusiveOf,
  postGeneratedExpenseEntry, recurringExpenseId, removeGeneratedExpenseEntry, splitExpenseGst, templateDueDates, templateDueNow, templateNextDue, typedAmountOf,
  type ExpenseInput, type ExpenseRecord, type ExpenseTemplate,
} from "../src/expenses";
import {
  approveExpenses, createExpense, deleteExpense, EXPENSE_COMMANDS, markExpensePaid, pauseExpenseTemplate, rejectExpenseWithReason, runRecurringExpenses,
  saveExpenseTemplate, updateExpense,
} from "../src/commands/expenses";
import { seedExpenses } from "../src/demo/expenses";
import { FEATURE_SEEDS } from "../src/demo/features";

const NOW = "2026-10-25T09:00:00.000Z"; // 14:30 IST on Sunday 25 Oct 2026
const at = (nowIso: string, c: CommandCtx): CommandCtx => ({ ...c, nowIso });
const owner: CommandCtx = { uid: "uOwner", role: "owner", projectIds: [], nowIso: NOW };
const accountant: CommandCtx = { uid: "uAccountant", role: "accountant", projectIds: [], nowIso: NOW };
const pm: CommandCtx = { uid: "uPm", role: "pm", projectIds: ["projShivNagar", "projSharma"], nowIso: NOW };
const sup: CommandCtx = { uid: "uSupShivNagar", role: "supervisor", projectIds: ["projShivNagar"], nowIso: NOW };
const sup2: CommandCtx = { uid: "uSupGomti", role: "supervisor", projectIds: ["projGomti"], nowIso: NOW };
const viewer: CommandCtx = { uid: "uViewer", role: "viewer", projectIds: [], nowIso: NOW };
const ca: CommandCtx = { uid: "uCa", role: "ca", projectIds: [], nowIso: NOW };
const G = "projShivNagar";
const CEMENT = "cat_materials_cement";

let store: MemoryStore;
// Every test starts from the base demo only (no feature seeds, this one included), so the figures below are fixed.
beforeEach(async () => {
  const featureSeeds = FEATURE_SEEDS.splice(0);
  try { ({ store } = await seedDemo("2026-10-25")); } finally { FEATURE_SEEDS.push(...featureSeeds); }
});

const entry = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
  projectId: G, date: "2026-10-24", categoryId: CEMENT, description: "Cement, OPC 53", amountPaise: 100_000, mode: "cash", accountId: "accCash", ...over,
});
const exp = (id: string) => store.get<ExpenseRecord>("expenses", id)!;
const cost = (id: string) => store.get<CostRollup>("rollups", id) ?? { id };
const fin = (id: string) => store.get<FinanceRollup>("finance_rollups", id) ?? { id };
const balance = (id: string) => store.get<Account>("accounts", id)!.balancePaise ?? 0;
const payable = (vendorId: string) => store.get<{ payablePaise?: number }>("vendor_balances", vendorId)?.payablePaise ?? 0;
const txn = (expenseId: string) => store.get<{ amountPaise: number; accountId: string; date: string; directionSign: number }>("account_transactions", `expenses_${expenseId}`);

/** The figures an expense can move, so a test can assert the exact difference. */
function figures(month = "2026-10", project = G, category = CEMENT) {
  const co = cost(`co_${month}`);
  return {
    total: co.expenseTotalPaise ?? 0, paid: co.expensePaidPaise ?? 0, gst: co.expenseGstPaise ?? 0,
    category: co.expense?.approvedPaise?.[category] ?? 0, count: co.expense?.count?.[category] ?? 0,
    projectMonth: cost(`p_${project}_${month}`).expenseTotalPaise ?? 0, projectAll: cost(`p_${project}_all`).expenseTotalPaise ?? 0,
    gstInput: fin(`co_${month}`).gstInputPaise ?? 0, cash: balance("accCash"), sbi: balance("accSbi"), hdfc: balance("accHdfc"),
  };
}
type Figures = ReturnType<typeof figures>;
const moved = (a: Figures, b: Figures) => Object.fromEntries((Object.keys(a) as (keyof Figures)[]).map((k) => [k, b[k] - a[k]]).filter(([, v]) => v !== 0));
const fieldsOf = async (p: Promise<unknown> | (() => unknown)) => {
  try { await (typeof p === "function" ? p() : p); return null; } catch (e) { return e instanceof CommandError ? e.fields : { thrown: String(e) }; }
};
/** Runs `fn` and returns how many documents it changed. */
async function writes(fn: () => unknown): Promise<number> {
  store.beginJournal();
  await fn();
  return store.endJournal().length;
}

describe("amount and GST split (§7.2, gst.ts)", () => {
  it("EX-01 GST added on top: the typed amount is the taxable value, each half rounded half-up", () => {
    expect(splitExpenseGst(100_000, 1800, false)).toEqual({ amountPaise: 118_000, taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000, igstPaise: 0, gstPaise: 18_000 });
    // ₹333.33 at 5%: each half is 833.325 paise → 833; total ₹349.99.
    expect(splitExpenseGst(33_333, 500, false)).toEqual({ amountPaise: 34_999, taxablePaise: 33_333, cgstPaise: 833, sgstPaise: 833, igstPaise: 0, gstPaise: 1_666 });
    // Another state: IGST on the whole, 33,333 × 18% = 5,999.94 → 6,000 paise.
    expect(splitExpenseGst(33_333, 1800, false, true)).toMatchObject({ amountPaise: 39_333, igstPaise: 6_000, cgstPaise: 0, sgstPaise: 0 });
  });

  it("EX-02 GST included: the total stays exactly what was typed, CGST = SGST, the taxable value takes the odd paisa", () => {
    expect(splitExpenseGst(118_000, 1800, true)).toEqual({ amountPaise: 118_000, taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000, igstPaise: 0, gstPaise: 18_000 });
    // ₹1,000 with 18% inside: 1,00,000 ÷ 1.18 = 84,745.76 → 84,746; half tax 7,627.14 → 7,627.
    expect(splitExpenseGst(100_000, 1800, true)).toEqual({ amountPaise: 100_000, taxablePaise: 84_746, cgstPaise: 7_627, sgstPaise: 7_627, igstPaise: 0, gstPaise: 15_254 });
    // ₹1.00: the rounded base is 85 paise, the halves are 8 + 8, so the taxable value is 84 (not 85).
    expect(splitExpenseGst(100, 1800, true)).toEqual({ amountPaise: 100, taxablePaise: 84, cgstPaise: 8, sgstPaise: 8, igstPaise: 0, gstPaise: 16 });
    expect(splitExpenseGst(100_000, 1800, true, true)).toMatchObject({ amountPaise: 100_000, taxablePaise: 84_746, igstPaise: 15_254 });
    expect(splitExpenseGst(12_345, 0, true)).toEqual({ amountPaise: 12_345, taxablePaise: 12_345, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, gstPaise: 0 });
  });

  it("EX-03 the parts always add up to the amount, for every rate and for awkward amounts", () => {
    for (const rate of [500, 600, 1200, 1800, 2800]) {
      for (let typed = 1; typed < 60_000; typed += 37) {
        for (const inclusive of [true, false]) {
          const g = splitExpenseGst(typed, rate, inclusive);
          expect(g.taxablePaise + g.cgstPaise + g.sgstPaise + g.igstPaise).toBe(g.amountPaise);
          expect(g.cgstPaise).toBe(g.sgstPaise);
          if (inclusive) expect(g.amountPaise).toBe(typed); else expect(g.taxablePaise).toBe(typed);
        }
      }
    }
    expect(() => splitExpenseGst(100.5, 1800)).toThrow();
    expect(() => splitExpenseGst(100, 3000)).toThrow();
  });

  it("EX-04 an older entry (saved before this screen) opens with the amount as it was typed", () => {
    // The base seed adds GST on top and doesn't say so: 1,00,000 + 18% = 1,18,000.
    const old = { amountPaise: 118_000, taxablePaise: 100_000, gstRateBp: 1800, cgstPaise: 9_000, sgstPaise: 9_000, igstPaise: 0 };
    expect(gstInclusiveOf(old)).toBe(false);
    expect(typedAmountOf(old)).toBe(100_000);
    expect(typedAmountOf({ ...old, gstInclusive: true })).toBe(118_000);
    expect(typedAmountOf({ amountPaise: 50_000, gstRateBp: 0 })).toBe(50_000);
  });
});

describe("who may enter and who must approve (§2, §7.2, D-30, D13)", () => {
  it("EX-10 the owner's entry is approved at once and posts everything together, to the paisa (§3.1 rules 3, 5)", async () => {
    const before = figures();
    const r = await createExpense(store, entry({ amountPaise: 118_000, gstRateBp: 1800, gstInclusive: true, mode: "bank", accountId: "accSbi" }), owner);
    expect(r).toMatchObject({ approved: true, status: "approved" });
    expect(moved(before, figures())).toEqual({ total: 118_000, paid: 118_000, gst: 18_000, category: 118_000, count: 1, projectMonth: 118_000, projectAll: 118_000, gstInput: 18_000, sbi: -118_000 });
    expect(txn(r.id)).toMatchObject({ amountPaise: 118_000, accountId: "accSbi", date: "2026-10-24", directionSign: -1 });
    expect(exp(r.id)).toMatchObject({
      approvalStatus: "approved", approvedBy: "uOwner", source: "manual", enteredBy: "uOwner", enteredByName: "Anil Mishra", projectName: "Shiv Nagar CC Road",
      monthKey: "2026-10", fy: "2026-27", taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000, paidStatus: "paid",
      categoryPath: ["cat_materials", CEMENT],
    });
  });

  it("EX-11 the accountant's entry is approved up to ₹25,000; above it waits for the owner and counts only then (D-20)", async () => {
    const before = figures();
    const small = await createExpense(store, entry({ amountPaise: 2_500_000, noBillReason: "Bill to follow", mode: "bank", accountId: "accSbi" }), accountant);
    expect(small.approved).toBe(true);
    const mid = figures();
    expect(moved(before, mid)).toMatchObject({ total: 2_500_000, sbi: -2_500_000 });
    const big = await createExpense(store, entry({ amountPaise: 2_500_001, noBillReason: "Bill to follow", mode: "bank", accountId: "accSbi" }), accountant);
    expect(big).toMatchObject({ approved: false, status: "pending" });
    expect(moved(mid, figures())).toEqual({});
    expect(txn(big.id)).toBeNull();
    await expect(approveExpenses(store, { ids: [big.id] }, accountant)).rejects.toThrow("You entered this one yourself, so someone else has to approve it.");
    expect(await approveExpenses(store, { ids: [big.id] }, owner)).toEqual({ approved: 1, skipped: 0 });
    expect(moved(mid, figures())).toEqual({ total: 2_500_001, paid: 2_500_001, category: 2_500_001, count: 1, projectMonth: 2_500_001, projectAll: 2_500_001, sbi: -2_500_001 });
  });

  it("EX-12 everything a supervisor or project manager enters waits; nothing counts until it is approved", async () => {
    const before = figures();
    const a = await createExpense(store, entry({ amountPaise: 150_000 }), sup);
    const b = await createExpense(store, entry({ amountPaise: 90_000, projectId: "projSharma" }), pm);
    expect([a.status, b.status]).toEqual(["pending", "pending"]);
    expect(moved(before, figures())).toEqual({});
    // A site role can't choose the paid-from account (they don't see accounts): whatever they send is not stored.
    expect(exp(a.id)).toMatchObject({ approvalStatus: "pending", accountId: null, enteredBy: "uSupShivNagar", mode: "cash", paidStatus: "paid" });
    expect(exp(a.id).approvedBy).toBeUndefined();
    // The project manager approves the supervisor's entry on their own project, within their limit.
    expect(await approveExpenses(store, { ids: [a.id] }, pm)).toEqual({ approved: 1, skipped: 0 });
    expect(moved(before, figures())).toEqual({ total: 150_000, paid: 150_000, category: 150_000, count: 1, projectMonth: 150_000, projectAll: 150_000 });
    expect(exp(a.id)).toMatchObject({ approvalStatus: "approved", approvedBy: "uPm" });
  });

  it("EX-13 role refusals, in plain words", async () => {
    await expect(createExpense(store, entry(), viewer)).rejects.toThrow("Your role can't enter expenses.");
    await expect(createExpense(store, entry(), ca)).rejects.toThrow("Your role can't enter expenses.");
    await expect(createExpense(store, entry({ projectId: "projGomti" }), sup)).rejects.toThrow("You aren't assigned to this project, so you can't enter expenses here.");
    await expect(createExpense(store, entry({ projectId: null }), pm)).rejects.toThrow("Choose the project. Only the owner or the accountant can enter an office expense with no project.");
    expect((await createExpense(store, entry({ projectId: null, categoryId: "cat_overheads" }), accountant)).approved).toBe(true); // head office, default I4

    const bySup = await createExpense(store, entry({ amountPaise: 150_000 }), sup);
    const byPm = await createExpense(store, entry({ amountPaise: 150_000 }), pm);
    const bigBySup = await createExpense(store, entry({ amountPaise: 2_600_000, noBillReason: "Bill to follow" }), sup);
    const onGomti = await createExpense(store, entry({ amountPaise: 150_000, projectId: "projGomti" }), sup2);
    await expect(approveExpenses(store, { ids: [bySup.id] }, sup)).rejects.toThrow("Your role can't approve expenses.");
    await expect(approveExpenses(store, { ids: [bySup.id] }, viewer)).rejects.toThrow("Your role can't approve expenses.");
    await expect(approveExpenses(store, { ids: [byPm.id] }, pm)).rejects.toThrow("You entered this one yourself, so someone else has to approve it.");
    await expect(approveExpenses(store, { ids: [bigBySup.id] }, pm)).rejects.toThrow("This is above your approval limit of ₹25,000. The owner or the accountant approves it.");
    await expect(approveExpenses(store, { ids: [onGomti.id] }, pm)).rejects.toThrow("You aren't assigned to this project, so you can't approve its expenses.");
    await expect(approveExpenses(store, { ids: [bigBySup.id], accountId: "accCash" }, accountant)).rejects.toThrow("This is above ₹25,000, so only the owner can approve it.");
    await expect(rejectExpenseWithReason(store, { id: bySup.id, reason: "No" }, pm)).rejects.toThrow("Say why this entry is rejected.");
    await expect(rejectExpenseWithReason(store, { id: bySup.id, reason: "Wrong site" }, sup)).rejects.toThrow("Your role can't reject expenses.");
    // The registry's one-entry command is strict: an entry that isn't waiting is an error, not a silent skip.
    await EXPENSE_COMMANDS.approveExpense(store, { id: bySup.id }, pm);
    await expect(EXPENSE_COMMANDS.approveExpense(store, { id: bySup.id }, owner)).rejects.toThrow("Only an entry waiting for approval can be approved or rejected.");
    // The limits come from settings/operations.
    store.merge("settings", "operations", { pmApprovalLimitPaise: 3_000_000 });
    expect(await approveExpenses(store, { ids: [bigBySup.id] }, pm)).toEqual({ approved: 1, skipped: 0 });
  });

  it("EX-14 the owner or accountant approving a paid entry chooses the paid-from account, so the cash book agrees (§3.1 rule 5)", async () => {
    const a = await createExpense(store, entry({ amountPaise: 150_000 }), sup);
    const before = figures();
    expect(await fieldsOf(approveExpenses(store, { ids: [a.id] }, accountant))).toEqual({ accountId: "Choose which account the money was paid from." });
    expect(moved(before, figures())).toEqual({});
    await approveExpenses(store, { ids: [a.id], accountId: "accCash" }, accountant);
    expect(moved(before, figures())).toEqual({ total: 150_000, paid: 150_000, category: 150_000, count: 1, projectMonth: 150_000, projectAll: 150_000, cash: -150_000 });
    expect(txn(a.id)).toMatchObject({ amountPaise: 150_000, accountId: "accCash" });

    // Approved by the project manager with no account: it counts, and the account row appears when finance fills it in.
    const b = await createExpense(store, entry({ amountPaise: 70_000, mode: "upi" }), sup);
    await approveExpenses(store, { ids: [b.id] }, pm);
    expect(txn(b.id)).toBeNull();
    const mid = figures();
    const r = await updateExpense(store, { id: b.id, input: entry({ amountPaise: 70_000, mode: "upi", accountId: "accSbi" }) }, accountant);
    expect(r).toMatchObject({ status: "approved", changed: ["accountId"] });
    expect(moved(mid, figures())).toEqual({ sbi: -70_000 });
    expect(txn(b.id)).toMatchObject({ amountPaise: 70_000, accountId: "accSbi" });
  });

  it("EX-15 a rejected entry never counts; the person who entered it corrects it and it waits again", async () => {
    const before = figures();
    const a = await createExpense(store, entry({ amountPaise: 150_000 }), sup);
    await rejectExpenseWithReason(store, { id: a.id, reason: "Attach the shop's slip" }, pm);
    expect(exp(a.id)).toMatchObject({ approvalStatus: "rejected", rejectReason: "Attach the shop's slip" });
    expect(moved(before, figures())).toEqual({});
    await expect(approveExpenses(store, { ids: [a.id] }, owner, true)).rejects.toThrow("Only an entry waiting for approval can be approved or rejected.");
    const r = await updateExpense(store, { id: a.id, input: entry({ amountPaise: 140_000 }) }, sup);
    expect(r.status).toBe("pending");
    expect(exp(a.id)).toMatchObject({ approvalStatus: "pending", rejectReason: null, amountPaise: 140_000 });
    expect(exp(a.id).history!.map((h) => h.action)).toEqual(["created", "rejected", "sent_again"]);
    await approveExpenses(store, { ids: [a.id], accountId: "accCash" }, owner);
    expect(moved(before, figures())).toMatchObject({ total: 140_000, cash: -140_000 });
  });

  it("EX-16 several entries approved together; doing it again changes nothing", async () => {
    const ids: string[] = [];
    for (const amountPaise of [110_000, 120_000, 130_000]) ids.push((await createExpense(store, entry({ amountPaise }), sup)).id);
    const before = figures();
    expect(await approveExpenses(store, { ids: [...ids, ids[0]!], accountId: "accCash" }, owner)).toEqual({ approved: 3, skipped: 0 });
    expect(moved(before, figures())).toEqual({ total: 360_000, paid: 360_000, category: 360_000, count: 3, projectMonth: 360_000, projectAll: 360_000, cash: -360_000 });
    expect(await approveExpenses(store, { ids, accountId: "accCash" }, owner)).toEqual({ approved: 0, skipped: 3 });
    expect(moved(before, figures())).toMatchObject({ total: 360_000, cash: -360_000 });
    // An entry in the batch that this person may not approve stops the command (the runner then undoes all of it).
    const mine = await createExpense(store, entry({ amountPaise: 2_600_000, noBillReason: "Bill to follow", mode: "bank", accountId: "accSbi" }), accountant);
    const other = await createExpense(store, entry({ amountPaise: 50_000 }), sup);
    await expect(approveExpenses(store, { ids: [mine.id, other.id], accountId: "accCash" }, accountant)).rejects.toThrow(/someone else has to approve/);
    expect(exp(other.id).approvalStatus).toBe("pending");
  });

  it("EX-17 above ₹2,000 an entry needs a bill photo or the reason there is none (default D12)", async () => {
    expect(await fieldsOf(createExpense(store, entry({ amountPaise: 200_001 }), owner))).toEqual({ noBillReason: "Above ₹2,000 an expense needs a photo of the bill, or the reason there is no bill." });
    expect((await createExpense(store, entry({ amountPaise: 200_000 }), owner)).approved).toBe(true);
    expect((await createExpense(store, entry({ amountPaise: 200_001, noBillReason: "Local supplier gives no bill" }), owner)).approved).toBe(true);
    const bill = { id: "fbill0000001", name: "bill.jpg", mime: "image/jpeg", sizeBytes: 81_000, path: "inline/fbill0000001" };
    const withPhoto = await createExpense(store, entry({ amountPaise: 900_000, billNo: "SC/118", billFiles: [bill] }), owner);
    expect(exp(withPhoto.id).billFiles).toEqual([bill]);
    // A record keeps only file references the files feature accepts (never image bytes or a made-up path).
    expect(await fieldsOf(createExpense(store, entry({ billFiles: [{ ...bill, path: "somewhere/else" }] }), owner))).toEqual({ billFiles: "This attachment does not say where it is kept." });
    // Every problem is reported together, next to its field.
    expect(await fieldsOf(createExpense(store, entry({ date: "2026-10-26", categoryId: "cat_materials", amountPaise: 0, mode: "bank", accountId: null }), owner))).toEqual({
      date: "An expense can't be dated in the future.", categoryId: "Choose the last level of the expense head, for example Materials, then Cement.",
      amountPaise: "Enter the amount in rupees, for example 1,250.", accountId: "Choose which account the money was paid from.",
    });
  });

  it("EX-18 a credit purchase is owed until it is paid: payable up, no money moves; paying it moves the money once", async () => {
    const before = figures("2026-10", G, "cat_materials_aggregate_gitti");
    const owedBefore = payable("vMaaDurga");
    const r = await createExpense(store, entry({
      categoryId: "cat_materials_aggregate_gitti", amountPaise: 2_100_000, gstRateBp: 500, gstInclusive: false, mode: "credit", accountId: "accSbi",
      payeeType: "vendor", payeeId: "vMaaDurga", billNo: "MDS/3310", noBillReason: "Bill to follow",
    }), accountant);
    expect(r.approved).toBe(true); // ₹22,050 with GST, within the accountant's limit
    expect(exp(r.id)).toMatchObject({ amountPaise: 2_205_000, cgstPaise: 52_500, sgstPaise: 52_500, mode: "credit", paidStatus: "unpaid", accountId: null, payeeName: "Maa Durga Stone Suppliers", creditPurchase: true });
    const owed = figures("2026-10", G, "cat_materials_aggregate_gitti");
    expect(moved(before, owed)).toEqual({ total: 2_205_000, gst: 105_000, category: 2_205_000, count: 1, projectMonth: 2_205_000, projectAll: 2_205_000, gstInput: 105_000 });
    expect(payable("vMaaDurga") - owedBefore).toBe(2_205_000);
    expect(txn(r.id)).toBeNull();
    expect(await fieldsOf(createExpense(store, entry({ mode: "credit", payeeName: "" }), accountant))).toEqual({ payeeName: "Say who is owed this money." });

    await expect(markExpensePaid(store, { id: r.id, date: "2026-10-25", mode: "bank", accountId: "accSbi" }, pm)).rejects.toThrow("Your role can't record payments.");
    expect(await fieldsOf(markExpensePaid(store, { id: r.id, date: "2026-10-23", mode: "bank", accountId: "accSbi" }, accountant))).toEqual({ date: "The payment can't be before the day of the purchase." });
    await markExpensePaid(store, { id: r.id, date: "2026-10-25", mode: "bank", accountId: "accSbi", reference: "NEFT 1" }, accountant);
    expect(moved(owed, figures("2026-10", G, "cat_materials_aggregate_gitti"))).toEqual({ paid: 2_205_000, sbi: -2_205_000 });
    expect(payable("vMaaDurga")).toBe(owedBefore);
    expect(txn(r.id)).toMatchObject({ amountPaise: 2_205_000, accountId: "accSbi", directionSign: -1 });
    expect(exp(r.id)).toMatchObject({ mode: "bank", paidStatus: "paid", accountId: "accSbi", paidDate: "2026-10-25", creditPurchase: true });
    await expect(markExpensePaid(store, { id: r.id, date: "2026-10-25", mode: "bank", accountId: "accSbi" }, accountant)).rejects.toThrow("This entry is already paid.");
  });
  it.todo("EX-18b the account row of a credit purchase carries the day it was paid (needs the one-line posting.ts change in the report)");

  it("EX-19 an entry sent twice from a phone (offline, then retried) is stored once (§3.1 rule 11, D-07)", async () => {
    const before = figures();
    const first = await createExpense(store, { ...entry(), id: "devAb12Cd34Ef56Gh" }, owner);
    const again = await createExpense(store, { ...entry(), id: "devAb12Cd34Ef56Gh" }, owner);
    expect(first).toMatchObject({ id: "devAb12Cd34Ef56Gh", alreadySaved: false });
    expect(again).toMatchObject({ id: "devAb12Cd34Ef56Gh", alreadySaved: true, approved: true });
    expect(moved(before, figures())).toEqual({ total: 100_000, paid: 100_000, category: 100_000, count: 1, projectMonth: 100_000, projectAll: 100_000, cash: -100_000 });
    // An id can't be used to overwrite someone else's entry, or a generated one.
    await expect(createExpense(store, { ...entry(), id: "devAb12Cd34Ef56Gh" }, accountant)).rejects.toThrow(/couldn't be saved/);
    await expect(createExpense(store, { ...entry(), id: "wage_wp0001" }, owner)).rejects.toThrow(/couldn't be saved/);
    // An offline entry by a supervisor still only waits: a device never approves or posts (D-07).
    const queued = await createExpense(store, { ...entry(), id: "devZz99Yy88Xx77Ww" }, sup);
    expect(queued.status).toBe("pending");
  });
});

describe("changing and deleting (D-08 delta posting)", () => {
  it("EX-20 changing the amount of an approved entry moves every total by the difference only", async () => {
    const r = await createExpense(store, entry({ amountPaise: 100_000 }), owner);
    const after = figures();
    await updateExpense(store, { id: r.id, input: entry({ amountPaise: 123_456 }) }, owner);
    expect(moved(after, figures())).toEqual({ total: 23_456, paid: 23_456, category: 23_456, projectMonth: 23_456, projectAll: 23_456, cash: -23_456 });
    expect(txn(r.id)).toMatchObject({ amountPaise: 123_456 });
    await updateExpense(store, { id: r.id, input: entry({ amountPaise: 99_999, gstRateBp: 1800, gstInclusive: true }) }, owner);
    // 99,999 with 18% inside: base 84,745; halves 7,627 each; GST 15,254.
    expect(moved(after, figures())).toEqual({ total: -1, paid: -1, gst: 15_254, category: -1, projectMonth: -1, projectAll: -1, gstInput: 15_254, cash: 1 });
    expect(store.get<{ targets: Record<string, number> }>("postings", `expenses_${r.id}`)!.targets["rollups/co_2026-10|expenseTotalPaise"]).toBe(99_999);
    // Saving the same thing again writes no total and no account row.
    const same = figures();
    await updateExpense(store, { id: r.id, input: entry({ amountPaise: 99_999, gstRateBp: 1800, gstInclusive: true }) }, owner);
    expect(moved(same, figures())).toEqual({});
  });

  it("EX-21 changing category, project, month and account moves the amount between totals, none is lost", async () => {
    const before = figures();
    const sep = figures("2026-09", "projSharma", "cat_materials_steel");
    const r = await createExpense(store, entry({ amountPaise: 777_700, noBillReason: "Bill to follow" }), owner);
    await updateExpense(store, { id: r.id, input: entry({ amountPaise: 777_700, noBillReason: "Bill to follow", projectId: "projSharma", categoryId: "cat_materials_steel", date: "2026-09-30", mode: "bank", accountId: "accHdfc" }) }, owner);
    expect(moved(before, figures())).toEqual({ hdfc: -777_700 }); // October, the old project and the old head are back where they were
    expect(moved(sep, figures("2026-09", "projSharma", "cat_materials_steel"))).toEqual({ total: 777_700, paid: 777_700, category: 777_700, count: 1, projectMonth: 777_700, projectAll: 777_700, hdfc: -777_700 });
    expect(txn(r.id)).toMatchObject({ accountId: "accHdfc", date: "2026-09-30", amountPaise: 777_700 });
    expect(exp(r.id)).toMatchObject({ monthKey: "2026-09", fy: "2026-27", projectName: "Sharma Villa, Indira Nagar", categoryPath: ["cat_materials", "cat_materials_steel"] });
  });

  it("EX-22 approval changes what counts: an accountant can't lift an entry above the limit and keep it approved", async () => {
    const before = figures();
    const big = entry({ amountPaise: 4_000_000, noBillReason: "Advance, bill later", mode: "bank", accountId: "accSbi" });
    const r = await createExpense(store, big, owner);
    const after = figures();
    expect(moved(before, after)).toMatchObject({ total: 4_000_000, sbi: -4_000_000 });
    // A change that isn't about money leaves the owner's approval alone.
    expect(await updateExpense(store, { id: r.id, input: { ...big, description: "Cement, advance to the dealer" } }, accountant)).toMatchObject({ status: "approved", changed: ["description"] });
    expect(moved(after, figures())).toEqual({});
    expect(exp(r.id).approvedBy).toBe("uOwner");
    // A money change by the accountant above ₹25,000 waits for the owner again: it stops counting.
    expect((await updateExpense(store, { id: r.id, input: { ...big, amountPaise: 4_100_000 } }, accountant)).status).toBe("pending");
    expect(moved(before, figures())).toEqual({});
    expect(txn(r.id)).toBeNull();
    expect(exp(r.id).approvedBy).toBeUndefined();
    await approveExpenses(store, { ids: [r.id] }, owner);
    expect(moved(before, figures())).toEqual({ total: 4_100_000, paid: 4_100_000, category: 4_100_000, count: 1, projectMonth: 4_100_000, projectAll: 4_100_000, sbi: -4_100_000 });
  });

  it("EX-23 who may change an entry: its author while it waits, finance afterwards; site roles can't move it to another project", async () => {
    const mine = await createExpense(store, entry({ amountPaise: 150_000 }), sup);
    const pmEntry = await createExpense(store, entry({ amountPaise: 90_000 }), pm);
    expect((await updateExpense(store, { id: mine.id, input: entry({ amountPaise: 160_000 }) }, sup)).status).toBe("pending");
    await expect(updateExpense(store, { id: pmEntry.id, input: entry({ amountPaise: 1 }) }, sup)).rejects.toThrow("You can change only the entries you made yourself.");
    await expect(updateExpense(store, { id: mine.id, input: entry({ projectId: "projSharma" }) }, pm)).rejects.toThrow("Only the owner or the accountant can move an entry to another project.");
    await expect(updateExpense(store, { id: mine.id, input: entry() }, viewer)).rejects.toThrow("Your role can't change expenses.");
    await expect(updateExpense(store, { id: mine.id, input: entry() }, { ...sup2 })).rejects.toThrow("You aren't assigned to this project, so you can't change its expenses.");
    await approveExpenses(store, { ids: [mine.id] }, pm);
    await expect(updateExpense(store, { id: mine.id, input: entry({ amountPaise: 1 }) }, sup)).rejects.toThrow("This entry is approved. Only the owner or the accountant can change it now.");
    await expect(deleteExpense(store, { id: mine.id, reason: "Entered twice" }, pm)).rejects.toThrow("This entry is approved. Only the owner or the accountant can change it now.");
    expect(editRefusal(exp(mine.id), accountant)).toBeNull();
  });

  it("EX-24 an entry made by a wage payment is changed at its source, never here (D-16, D-30)", async () => {
    const wage = store.list<Expense>("expenses", (e) => e.source === "wage")[0]!;
    const msg = "This entry was made automatically from another record (a wage payment, a purchase bill or a machine). Change that record instead.";
    await expect(updateExpense(store, { id: wage.id, input: entry() }, owner)).rejects.toThrow(msg);
    await expect(deleteExpense(store, { id: wage.id, reason: "Not needed" }, owner)).rejects.toThrow(msg);
    await expect(markExpensePaid(store, { id: wage.id, date: "2026-10-25", mode: "bank", accountId: "accSbi" }, owner)).rejects.toThrow("This bill came from a purchase record. Record its payment there.");
    expect(approvalRefusal({ ...wage, approvalStatus: "pending" }, owner, DEFAULT_EXPENSE_LIMITS)).toMatch(/Approve that record instead/);
  });

  it("EX-25 every step leaves a line in the entry's history and an audit entry (§2 audit log)", async () => {
    const a = await createExpense(store, entry({ amountPaise: 150_000 }), sup);
    await updateExpense(store, { id: a.id, input: entry({ amountPaise: 155_000, description: "Cement, 4 bags" }) }, sup);
    await approveExpenses(store, { ids: [a.id] }, pm);
    await deleteExpense(store, { id: a.id, reason: "Entered twice" }, accountant);
    expect(exp(a.id).history).toMatchObject([
      { action: "created", by: "uSupShivNagar", byName: "Ramesh Yadav" }, { action: "edited", changed: ["description", "amountPaise"] },
      { action: "approved", by: "uPm", byName: "Vikas Tiwari" }, { action: "deleted", by: "uAccountant", note: "Entered twice" },
    ]);
    const log = store.list<{ entity: string; entityId: string; action: string; by: string }>("audit_log", (l) => l.entity === "expenses" && l.entityId === a.id);
    expect(log.map((l) => `${l.action}:${l.by}`).sort()).toEqual(["approve:uPm", "create:uSupShivNagar", "delete:uAccountant", "update:uSupShivNagar"]);
  });

  it("EX-30 deleting needs a reason, keeps the record and takes its totals back to the paisa", async () => {
    const before = figures();
    const r = await createExpense(store, entry({ amountPaise: 118_000, gstRateBp: 1800, mode: "bank", accountId: "accSbi" }), owner);
    expect(await fieldsOf(deleteExpense(store, { id: r.id, reason: " " }, owner))).toEqual({ reason: "Say why this entry is being deleted." });
    await deleteExpense(store, { id: r.id, reason: "Entered twice" }, owner);
    expect(moved(before, figures())).toEqual({});
    expect(txn(r.id)).toBeNull();
    expect(exp(r.id)).toMatchObject({ isDeleted: true, deleteReason: "Entered twice", deletedBy: "uOwner", amountPaise: 118_000 });
    await expect(deleteExpense(store, { id: r.id, reason: "Again" }, owner)).rejects.toThrow("This entry was deleted, so it can't be changed.");
    await expect(updateExpense(store, { id: r.id, input: entry() }, owner)).rejects.toThrow("This entry was deleted, so it can't be changed.");
    // The person who entered a waiting entry may delete it; someone else's they may not.
    const mine = await createExpense(store, entry(), sup);
    const other = await createExpense(store, entry(), pm);
    await deleteExpense(store, { id: mine.id, reason: "Wrong site" }, sup);
    await expect(deleteExpense(store, { id: other.id, reason: "Wrong site" }, sup)).rejects.toThrow("You can change only the entries you made yourself.");
  });

  it("EX-31 a locked month takes no new, changed, approved or deleted expenses, and says so plainly (core assertMonthOpen)", async () => {
    const approved = await createExpense(store, entry(), owner);
    const waiting = await createExpense(store, entry(), sup);
    store.set("period_locks", { id: "2026-10" });
    const before = figures();
    const closed = "Oct 2026 is locked, so this expense can't be saved or changed in it. Ask the owner to unlock Oct 2026, or use a date in an open month.";
    await expect(createExpense(store, entry(), owner)).rejects.toThrow(closed);
    await expect(updateExpense(store, { id: approved.id, input: entry({ amountPaise: 5 }) }, owner)).rejects.toThrow(closed);
    await expect(deleteExpense(store, { id: approved.id, reason: "Entered twice" }, owner)).rejects.toThrow(closed);
    await expect(approveExpenses(store, { ids: [waiting.id], accountId: "accCash" }, owner)).rejects.toThrow(closed);
    // An entry in an open month can't be moved into the locked one.
    const sept = await createExpense(store, entry({ date: "2026-09-29" }), owner);
    await expect(updateExpense(store, { id: sept.id, input: entry({ date: "2026-10-02" }) }, owner)).rejects.toThrow(closed);
    expect(moved(before, figures())).toEqual({ projectAll: 100_000, cash: -100_000 }); // only the September entry counted: October is untouched
    expect(exp(approved.id).amountPaise).toBe(100_000);
  });

  it("EX-32 the rules as plain functions (used by the screens to show or hide actions)", () => {
    const limits = expenseLimits({ pmApprovalLimitPaise: 1_000_000 });
    expect(limits).toEqual({ missingBillThresholdPaise: 200_000, pmApprovalLimitPaise: 1_000_000, autoApproveLimitPaise: 2_500_000 });
    expect(approvalOnSave("owner", 99_000_000, limits)).toBe("approved");
    expect(approvalOnSave("accountant", 2_500_000, limits)).toBe("approved");
    expect(approvalOnSave("accountant", 2_500_001, limits)).toBe("pending");
    expect(approvalOnSave("pm", 100, limits)).toBe("pending");
    expect(approvalOnSave("supervisor", 100, limits)).toBe("pending");
    expect(approverRoles({ amountPaise: 900_000, projectId: G }, limits)).toEqual(["owner", "accountant", "pm"]);
    expect(approverRoles({ amountPaise: 1_500_000, projectId: G }, limits)).toEqual(["owner", "accountant"]);
    expect(approverRoles({ amountPaise: 2_600_000, projectId: G }, limits)).toEqual(["owner"]);
    expect(approverRoles({ amountPaise: 100, projectId: null }, limits)).toEqual(["owner", "accountant"]);
    expect(entryRefusal(sup, G)).toBeNull();
    expect(entryRefusal(viewer, G)).toBe("Your role can't enter expenses.");
    const row = (o: Partial<Expense>) => ({ amountPaise: 1000, approvalStatus: "approved", mode: "cash", paidStatus: "paid", ...o }) as Expense;
    expect(expenseTotals([row({ cgstPaise: 50, sgstPaise: 50 }), row({ approvalStatus: "pending", amountPaise: 400 }), row({ mode: "credit", paidStatus: "unpaid", amountPaise: 700 }),
      row({ isDeleted: true, amountPaise: 9999 }), row({ approvalStatus: "rejected", amountPaise: 300 })]))
      .toEqual({ count: 5, enteredPaise: 2400, approvedPaise: 1700, gstPaise: 100, waitingPaise: 400, unpaidPaise: 700 });
  });
});

describe("recurring templates (§7.2)", () => {
  const rent = { name: "Office rent", projectId: null, categoryId: "cat_overheads", description: "Office rent", amountPaise: 1_800_000, mode: "bank" as const, accountId: "accHdfc", payeeName: "R. K. Gupta", frequency: "monthly" as const, dayOfMonth: 5, startDate: "2026-08-01" };

  it("EX-40 due dates: monthly (a short month uses its last day) and weekly, within the start, end and resume dates", () => {
    expect(templateDueDates({ frequency: "monthly", dayOfMonth: 31, startDate: "2026-01-15" }, "2026-01-01", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(templateDueDates({ frequency: "monthly", dayOfMonth: 29, startDate: "2028-02-01" }, "2028-02-01", "2028-03-01")).toEqual(["2028-02-29"]); // leap year
    const weekly = { frequency: "weekly" as const, weekday: 1, startDate: "2026-10-01" };
    expect(templateDueDates(weekly, "2026-10-01", "2026-10-25")).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(templateDueDates({ ...weekly, endDate: "2026-10-12" }, "2026-10-01", "2026-10-25")).toEqual(["2026-10-05", "2026-10-12"]);
    expect(templateDueDates({ ...weekly, skipBefore: "2026-10-10" }, "2026-10-01", "2026-10-25")).toEqual(["2026-10-12", "2026-10-19"]);
    expect(templateDueNow({ ...weekly, active: true, lastDueDate: "2026-10-12" }, "2026-10-25")).toEqual(["2026-10-19"]);
    expect(templateDueNow({ ...weekly, active: false, lastDueDate: null }, "2026-10-25")).toEqual([]);
    expect(templateNextDue({ frequency: "monthly", dayOfMonth: 5, startDate: "2026-08-01", active: true }, "2026-10-25")).toBe("2026-11-05");
    expect(templateNextDue({ frequency: "monthly", dayOfMonth: 5, startDate: "2026-08-01", endDate: "2026-10-31", active: true }, "2026-10-25")).toBeNull();
  });

  it("EX-41 the run creates each due entry once: running it twice makes no duplicates and moves no total twice", async () => {
    const id = saveExpenseTemplate(store, rent, accountant);
    const guards = saveExpenseTemplate(store, { ...rent, name: "Night guards", projectId: "projGomti", amountPaise: 3_200_000, gstRateBp: 1800, gstInclusive: false, mode: "credit", accountId: null, payeeName: "Awadh Security", dayOfMonth: 1, startDate: "2026-10-01" }, owner);
    const hdfc = balance("accHdfc");
    const aug = figures("2026-08", G, "cat_overheads"), oct = figures("2026-10", G, "cat_overheads");
    const run = await runRecurringExpenses(store, accountant);
    expect([...run.created].sort()).toEqual([recurringExpenseId(guards, "2026-10-01"), recurringExpenseId(id, "2026-08-05"), recurringExpenseId(id, "2026-09-05"), recurringExpenseId(id, "2026-10-05")].sort());
    expect(run).toMatchObject({ approved: 3, waiting: 1, skipped: [] });
    expect(balance("accHdfc") - hdfc).toBe(-5_400_000);
    expect(moved(aug, figures("2026-08", G, "cat_overheads"))).toEqual({ total: 1_800_000, paid: 1_800_000, category: 1_800_000, count: 1, hdfc: -5_400_000 });
    expect(moved(oct, figures("2026-10", G, "cat_overheads"))).toEqual({ total: 1_800_000, paid: 1_800_000, category: 1_800_000, count: 1, hdfc: -5_400_000 }); // the guards' ₹37,760 waits
    const made = exp(recurringExpenseId(id, "2026-09-05"));
    expect(made).toMatchObject({ date: "2026-09-05", amountPaise: 1_800_000, approvalStatus: "approved", approvedBy: "system", source: "manual", templateId: id, recurringFor: "2026-09-05", enteredByName: "Recurring: Office rent", projectId: null });
    expect(exp(recurringExpenseId(guards, "2026-10-01"))).toMatchObject({ approvalStatus: "pending", amountPaise: 3_776_000, mode: "credit", paidStatus: "unpaid" });

    // Again, the same day: nothing is written at all.
    let again!: Awaited<ReturnType<typeof runRecurringExpenses>>;
    expect(await writes(async () => { again = await runRecurringExpenses(store, owner); })).toBe(0);
    expect(again).toEqual({ created: [], approved: 0, waiting: 0, skipped: [] });
    expect(balance("accHdfc") - hdfc).toBe(-5_400_000);
    expect(store.list<ExpenseRecord>("expenses", (e) => e.templateId === id)).toHaveLength(3);
    // Even if the template forgot what it made (a lost pointer), the ids stop a second copy.
    store.merge("expense_templates", id, { lastDueDate: null });
    expect((await runRecurringExpenses(store, owner)).created).toEqual([]);
    expect(store.list<ExpenseRecord>("expenses", (e) => e.templateId === id)).toHaveLength(3);
    // The nightly job two weeks later: only the new due dates.
    const later = await runRecurringExpenses(store, at("2026-11-06T02:00:00.000Z", owner));
    expect(later.created.sort()).toEqual([recurringExpenseId(guards, "2026-11-01"), recurringExpenseId(id, "2026-11-05")].sort());
    await expect(runRecurringExpenses(store, pm)).rejects.toThrow("Your role can't run recurring expenses.");
  });

  it("EX-42 a paused template makes nothing, and nothing for the paused time after it is resumed; a locked month is skipped and reported", async () => {
    const id = saveExpenseTemplate(store, { ...rent, startDate: "2026-10-01" }, owner);
    pauseExpenseTemplate(store, { id, paused: true }, accountant);
    expect((await runRecurringExpenses(store, owner)).created).toEqual([]);
    pauseExpenseTemplate(store, { id, paused: false }, at("2026-11-20T09:00:00.000Z", accountant));
    const run = await runRecurringExpenses(store, at("2026-12-06T02:00:00.000Z", owner));
    expect(run.created).toEqual([recurringExpenseId(id, "2026-12-05")]); // not 5 Oct, not 5 Nov
    store.set("period_locks", { id: "2027-01" });
    const jan = await runRecurringExpenses(store, at("2027-02-06T02:00:00.000Z", owner));
    expect(jan.created).toEqual([recurringExpenseId(id, "2027-02-05")]);
    expect(jan.skipped).toEqual([{ templateId: id, name: "Office rent", date: "2027-01-05", reason: "The month is locked." }]);
    expect(() => saveExpenseTemplate(store, rent, pm)).toThrow("Your role can't set up recurring expenses.");
    expect(await fieldsOf(() => saveExpenseTemplate(store, { ...rent, name: "", dayOfMonth: 40, accountId: null }, owner))).toEqual({
      name: "Give it a name, for example Office rent.", dayOfMonth: "Choose the day of the month, from 1 to 31.", accountId: "Choose which account the money was paid from.",
    });
    // A template that needs fixing (its account was closed) stops and says why; nothing is lost.
    store.merge("accounts", "accHdfc", { active: false });
    const broken = await runRecurringExpenses(store, at("2027-03-06T02:00:00.000Z", owner));
    expect(broken).toMatchObject({ created: [], skipped: [{ date: "2027-03-05", reason: "Choose which account the money was paid from." }] });
    expect(store.get<ExpenseTemplate>("expense_templates", id)!.lastDueDate).toBe("2027-02-05");
  });
});

describe("expenses generated by another record (D-16, D-30)", () => {
  const bill = {
    source: "purchase" as const, sourceRef: { entity: "vendor_bills", id: "vb1" }, key: CEMENT, projectId: G, projectName: "Shiv Nagar CC Road", date: "2026-10-20",
    categoryId: CEMENT, description: "Cement, bill SC/118", amountPaise: 590_000, taxablePaise: 500_000, gstRateBp: 1800,
    payeeType: "vendor" as const, payeeId: "vShreeCement", payeeName: "Shree Cement Agency", billNo: "SC/118",
  };
  const ID = "gen_purchase_vb1_cat_materials_cement";

  it("EX-50 the same source gives the same entry: calling it again writes nothing and counts once", async () => {
    const before = figures();
    const owed = payable("vShreeCement");
    const e = await postGeneratedExpenseEntry(store, owner, bill);
    expect(e).toMatchObject({ id: ID, approvalStatus: "approved", approvedBy: "system", source: "purchase", taxablePaise: 500_000, cgstPaise: 45_000, sgstPaise: 45_000, mode: "credit", paidStatus: "unpaid", isDeleted: false });
    expect(moved(before, figures())).toEqual({ total: 590_000, gst: 90_000, category: 590_000, count: 1, projectMonth: 590_000, projectAll: 590_000, gstInput: 90_000 });
    expect(payable("vShreeCement") - owed).toBe(590_000);
    expect(await writes(() => postGeneratedExpenseEntry(store, at("2026-10-26T09:00:00.000Z", accountant), bill))).toBe(0);
    expect(moved(before, figures())).toMatchObject({ total: 590_000, count: 1 });
    expect(store.list<Expense>("expenses", (x) => x.sourceRef?.id === "vb1")).toHaveLength(1);
  });

  it("EX-51 a changed source moves the totals by the difference, and a generated entry never moves money itself", async () => {
    const before = figures();
    await postGeneratedExpenseEntry(store, owner, bill);
    await postGeneratedExpenseEntry(store, owner, { ...bill, amountPaise: 600_000, taxablePaise: undefined, mode: "bank", accountId: "accSbi" });
    // ₹6,000 with 18% inside: base 5,08,475 paise; halves 45,763 each.
    expect(exp(ID)).toMatchObject({ amountPaise: 600_000, taxablePaise: 508_474, cgstPaise: 45_763, sgstPaise: 45_763, paidStatus: "paid", accountId: "accSbi" });
    expect(moved(before, figures())).toEqual({ total: 600_000, paid: 600_000, gst: 91_526, category: 600_000, count: 1, projectMonth: 600_000, projectAll: 600_000, gstInput: 91_526 });
    expect(txn(ID)).toBeNull(); // the payment record owns the account row (D-16)
    await expect(postGeneratedExpenseEntry(store, owner, { ...bill, amountPaise: 10.5 })).rejects.toThrow("A generated expense needs a whole-paise amount above zero.");
  });

  it("EX-52 it inherits the source's approval: nothing is booked while the source waits, and it is taken back if the source stops being approved", async () => {
    const before = figures();
    const waiting = await postGeneratedExpenseEntry(store, owner, { ...bill, approvalStatus: "pending" });
    expect(waiting.id).toBe(ID);
    expect(store.get("expenses", ID)).toBeNull();
    expect(moved(before, figures())).toEqual({});
    await postGeneratedExpenseEntry(store, owner, { ...bill, approvalStatus: "approved" });
    expect(moved(before, figures())).toMatchObject({ total: 590_000 });
    await postGeneratedExpenseEntry(store, owner, { ...bill, approvalStatus: "rejected" });
    expect(exp(ID)).toMatchObject({ isDeleted: true });
    expect(moved(before, figures())).toEqual({});
    // Approved again: the same record comes back, once.
    await postGeneratedExpenseEntry(store, owner, bill);
    expect(moved(before, figures())).toMatchObject({ total: 590_000, count: 1 });
    await removeGeneratedExpenseEntry(store, owner, "purchase", bill.sourceRef, CEMENT);
    expect(moved(before, figures())).toEqual({});
    expect(await writes(() => removeGeneratedExpenseEntry(store, owner, "purchase", bill.sourceRef, CEMENT))).toBe(0); // safe to call again
    expect(await writes(() => removeGeneratedExpenseEntry(store, owner, "fuel", { entity: "machinery_fuel_logs", id: "none" }))).toBe(0);
    // A generated entry can't be approved from the expenses screen: its source decides.
    expect(approvalRefusal({ ...exp(ID), isDeleted: false, approvalStatus: "pending" }, owner, DEFAULT_EXPENSE_LIMITS)).toMatch(/Approve that record instead/);
  });
});

describe("demo data", () => {
  it("EX-60 seedExpenses adds its spread through the commands and leaves the base seed's records exactly as they were", async () => {
    const base = JSON.stringify(store.list<Expense>("expenses").sort((a, b) => a.id.localeCompare(b.id)));
    const baseIds = new Set(store.list<Expense>("expenses").map((e) => e.id));
    await seedExpenses({ store, anchor: "2026-10-25", nowIso: NOW, ownerUid: "uOwner" });
    const all = store.list<ExpenseRecord>("expenses");
    expect(JSON.stringify(all.filter((e) => baseIds.has(e.id)).sort((a, b) => a.id.localeCompare(b.id)))).toBe(base);
    const mine = all.filter((e) => !baseIds.has(e.id));
    expect(mine.every((e) => e.id.startsWith("exd") || e.id.startsWith("rec_ext"))).toBe(true);
    const byId = (id: string) => mine.find((e) => e.id === id)!;
    expect(byId("exdSupDiesel001")).toMatchObject({ approvalStatus: "pending", enteredBy: "uSupShivNagar" });
    expect(byId("exdAccSteel0001")).toMatchObject({ approvalStatus: "pending", amountPaise: 5_664_000 }); // above ₹25,000: waits for the owner
    expect(byId("exdSupTea000001")).toMatchObject({ approvalStatus: "rejected" });
    expect(byId("exdCreditGitti1")).toMatchObject({ approvalStatus: "approved", mode: "credit", paidStatus: "unpaid", amountPaise: 2_205_000 });
    expect(byId("exdCreditJcb001")).toMatchObject({ approvalStatus: "approved", mode: "bank", paidStatus: "paid", creditPurchase: true, amountPaise: 1_817_200 });
    expect(byId("exdOfficeNet001")).toMatchObject({ projectId: null, approvalStatus: "approved" });
    const templates = store.list<ExpenseTemplate>("expense_templates");
    expect(templates.map((t) => t.id).sort()).toEqual(["extGuardAgency", "extOfficeRent", "extSiteOffice", "extWaterTanker"]);
    expect(templates.find((t) => t.id === "extSiteOffice")!.active).toBe(false);
    expect(mine.filter((e) => e.templateId === "extOfficeRent").map((e) => e.date)).toEqual(["2026-09-05", "2026-10-05"]);
    expect(mine.filter((e) => e.templateId === "extWaterTanker").map((e) => e.date)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(mine.filter((e) => e.templateId === "extGuardAgency")).toMatchObject([{ date: "2026-10-01", approvalStatus: "pending" }]);
    expect(mine.some((e) => e.templateId === "extSiteOffice")).toBe(false);
    // Nothing is counted twice: the company total is still the sum of approved, not deleted entries (D-20) …
    const months = [...new Set(all.map((e) => e.monthKey))];
    const rolled = months.reduce((s, m) => s + (cost(`co_${m}`).expenseTotalPaise ?? 0), 0);
    expect(rolled).toBe(all.filter((e) => e.approvalStatus === "approved" && !e.isDeleted).reduce((s, e) => s + e.amountPaise, 0));
    // … every account balance is its opening balance plus its rows …
    const rows = store.list<{ accountId: string; directionSign: number; amountPaise: number }>("account_transactions");
    for (const a of store.list<Account>("accounts")) {
      expect(a.balancePaise).toBe(a.openingBalancePaise + rows.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.directionSign * t.amountPaise, 0));
    }
    expect(balance("accCash")).toBeGreaterThanOrEqual(0);
    // … and running the recurring job again makes nothing new.
    expect((await runRecurringExpenses(store, owner)).created).toEqual([]);
  });
});
