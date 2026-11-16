/**
 * Demo data for expense entry and approvals (spec §7.2), added after the base seed. The base seed already holds 200
 * manual expenses (`exp0001`…, eight of them waiting) and the wage-generated ones (`wage_…`); nothing here touches
 * those. Everything below is entered through the real commands as the demo people, so approvals, totals, payables and
 * account rows are made exactly as in real use. Ids start with `exd` (entries) and `ext` (templates).
 */
import { createExpense, markExpensePaid, pauseExpenseTemplate, rejectExpenseWithReason, runRecurringExpenses, saveExpenseTemplate } from "../commands/expenses";
import type { CommandCtx } from "../commands/common";
import { addDays, weekday } from "../dates";
import type { ExpenseTemplate } from "../expenses";
import type { Doc } from "../store";
import type { FeatureSeedCtx } from "./features";
import { DEMO_IDS } from "./seed";

const R = (rupees: number) => Math.round(rupees * 100);

export async function seedExpenses(seed: FeatureSeedCtx): Promise<void> {
  const { store, anchor, nowIso } = seed;
  const as = (uid: string, role: CommandCtx["role"], projectIds: string[] = []): CommandCtx => ({ uid, role, projectIds, nowIso });
  const owner = as(seed.ownerUid, "owner");
  const accountant = as(DEMO_IDS.accountant, "accountant");
  const pm = as(DEMO_IDS.pm, "pm", [DEMO_IDS.projGov, DEMO_IDS.projHouse]);
  const sup1 = as(DEMO_IDS.sup1, "supervisor", [DEMO_IDS.projGov]);
  const sup2 = as(DEMO_IDS.sup2, "supervisor", [DEMO_IDS.projApt]);
  const day = (back: number) => addDays(anchor, -back);

  // Waiting: two small site entries by a supervisor, one by the project manager.
  await createExpense(store, {
    id: "exdSupDiesel001", projectId: DEMO_IDS.projGov, date: day(1), categoryId: "cat_machinery_fuel", description: "Diesel for the roller, 20 litres",
    qtyMilli: 20_000, unit: "litre", ratePaise: R(92.5), amountPaise: R(1850), mode: "cash", payeeType: "other", payeeName: "Shiv Nagar petrol pump",
  }, sup1);
  await createExpense(store, {
    id: "exdSupTractor01", projectId: DEMO_IDS.projGov, date: day(0), categoryId: "cat_transport", description: "Tractor trolley, 3 trips of GSB",
    qtyMilli: 3000, unit: "trip", ratePaise: R(1400), amountPaise: R(4200), mode: "cash", payeeType: "other", payeeName: "Ram Naresh (tractor)",
    noBillReason: "The tractor owner gives no bill",
  }, sup1);
  await createExpense(store, {
    id: "exdPmPlumbing01", projectId: DEMO_IDS.projHouse, date: day(2), categoryId: "cat_materials_mep", description: "CPVC pipes and fittings, first floor",
    amountPaise: R(12400), gstRateBp: 1800, gstInclusive: true, mode: "upi", payeeType: "vendor", payeeName: "Gupta Sanitary Store", billNo: "GS/2291", billDate: day(2),
    noBillReason: "Bill is at the site office, photo to follow",
  }, pm);

  // Waiting for the owner: the accountant's entry is above the ₹25,000 limit.
  await createExpense(store, {
    id: "exdAccSteel0001", projectId: DEMO_IDS.projApt, date: day(3), categoryId: "cat_materials_steel", description: "TMT bars Fe500, 12 mm, 0.8 tonne",
    qtyMilli: 800, unit: "tonne", ratePaise: R(60000), amountPaise: R(48000), gstRateBp: 1800, gstInclusive: false, mode: "bank", accountId: DEMO_IDS.sbi,
    payeeType: "vendor", payeeId: "vLucknowSteel", billNo: "LST/7741", billDate: day(3), noBillReason: "Bill is in the purchase file, photo to follow",
  }, accountant);

  // Rejected with a reason: the supervisor can correct it and send it again.
  await createExpense(store, {
    id: "exdSupTea000001", projectId: DEMO_IDS.projApt, date: day(4), categoryId: "cat_overheads", description: "Tea and snacks for the slab casting day",
    amountPaise: R(6500), mode: "cash", payeeType: "other", payeeName: "Sharma tea stall", noBillReason: "Small shop, no bill",
  }, sup2);
  await rejectExpenseWithReason(store, { id: "exdSupTea000001", reason: "Too high for one day. Enter each day on its own and attach the shop's slip." }, accountant);

  // Bought on credit and still owed to the supplier (payable until paid).
  await createExpense(store, {
    id: "exdCreditGitti1", projectId: DEMO_IDS.projGov, date: day(6), categoryId: "cat_materials_aggregate_gitti", description: "Gitti 20 mm, 5 brass",
    qtyMilli: 5000, unit: "brass", ratePaise: R(4200), amountPaise: R(21000), gstRateBp: 500, gstInclusive: false, mode: "credit",
    payeeType: "vendor", payeeId: "vMaaDurga", billNo: "MDS/3310", billDate: day(6), noBillReason: "Bill comes with the month's statement",
  }, accountant);

  // Bought on credit, paid from the bank nine days later.
  await createExpense(store, {
    id: "exdCreditJcb001", projectId: DEMO_IDS.projHouse, date: day(12), categoryId: "cat_machinery_hire", description: "JCB 3DX, 14 hours, trench and backfill",
    qtyMilli: 14_000, unit: "hour", ratePaise: R(1100), amountPaise: R(15400), gstRateBp: 1800, gstInclusive: false, mode: "credit",
    payeeType: "vendor", payeeId: "vSinghJcb", billNo: "SJH/0918", billDate: day(12), noBillReason: "Bill is in the purchase file, photo to follow",
  }, accountant);
  await markExpensePaid(store, { id: "exdCreditJcb001", date: day(3), mode: "bank", accountId: DEMO_IDS.sbi, reference: `NEFT ${day(3).replace(/-/g, "")}` }, accountant);

  // A head-office expense with no project (owner and accountant only).
  await createExpense(store, {
    id: "exdOfficeNet001", projectId: null, date: day(8), categoryId: "cat_overheads", description: "Office internet, one month",
    amountPaise: R(3540), gstRateBp: 1800, gstInclusive: true, mode: "bank", accountId: DEMO_IDS.hdfc, payeeType: "other", payeeName: "Airtel Broadband",
    billNo: "AB/55120", billDate: day(8), noBillReason: "The bill comes by email",
  }, owner);

  // Recurring templates: office rent (monthly), a water tanker (weekly), a guard agency above the limit, and one paused.
  const mondayBack = (from: number) => { let d = day(from); while (weekday(d) !== 1) d = addDays(d, -1); return d; };
  const rentStart = day(70);
  const templates: [string, Parameters<typeof saveExpenseTemplate>[1]][] = [
    ["extOfficeRent", {
      name: "Office rent", projectId: null, categoryId: "cat_overheads", description: "Office rent, Hazratganj", amountPaise: R(18000), mode: "bank", accountId: DEMO_IDS.hdfc,
      payeeType: "other", payeeName: "R. K. Gupta (landlord)", frequency: "monthly", dayOfMonth: 5, startDate: rentStart,
    }],
    ["extWaterTanker", {
      name: "Water tanker, Shiv Nagar", projectId: DEMO_IDS.projGov, categoryId: "cat_overheads", description: "Water tanker for curing", amountPaise: R(1200), mode: "upi",
      accountId: DEMO_IDS.sbi, payeeType: "other", payeeName: "Yadav water supply", frequency: "weekly", weekday: 1, startDate: mondayBack(15),
    }],
    ["extGuardAgency", {
      name: "Night guards, Gomti Residency", projectId: DEMO_IDS.projApt, categoryId: "cat_overheads", description: "Two night guards, monthly bill", amountPaise: R(32000),
      gstRateBp: 1800, gstInclusive: false, mode: "credit", payeeType: "other", payeeName: "Awadh Security Services", frequency: "monthly", dayOfMonth: 1, startDate: day(40),
    }],
    ["extSiteOffice", {
      name: "Site office electricity", projectId: DEMO_IDS.projHouse, categoryId: "cat_overheads", description: "Temporary connection, monthly", amountPaise: R(6000), mode: "bank",
      accountId: DEMO_IDS.sbi, payeeType: "other", payeeName: "MVVNL", frequency: "monthly", dayOfMonth: 20, startDate: day(5),
    }],
  ];
  for (const [id, input] of templates) {
    // The command picks a random id for a new template; the demo wants stable ones, so the saved record is renamed.
    const made = saveExpenseTemplate(store, input, accountant);
    const doc = store.get<ExpenseTemplate>("expense_templates", made)!;
    store.delete("expense_templates", made);
    store.set("expense_templates", { ...doc, id } as unknown as Doc);
  }
  pauseExpenseTemplate(store, { id: "extSiteOffice", paused: true }, accountant);
  await runRecurringExpenses(store, owner);
}
