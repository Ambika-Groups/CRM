// The dashboard (spec §11.1, §11.1a): every figure equals the core totals it summarises, to the paisa. IDs DB-xxx.
import { beforeAll, describe, expect, it } from "vitest";
import {
  balances, CategoryTree, expenseLevel, incomeVsExpense, invoiceOutstanding, isDelayed, monthsBetween, payables, periodRange, projectRows,
  receivablesAgeing, seedDemo, sumCost, sumFinance, totalExpense,
  type Account, type CostRollup, type Expense, type FinanceRollup, type Invoice, type MemoryStore, type Project,
} from "../src";

const TODAY = "2026-10-25";
let store: MemoryStore;
beforeAll(async () => { ({ store } = await seedDemo(TODAY)); });

describe("dashboard figures", () => {
  it("DB-001 periods: today, week (Monday to today), month, FY and custom months", () => {
    expect(periodRange("today", TODAY)).toMatchObject({ from: TODAY, to: TODAY, fromRecords: true });
    expect(periodRange("week", TODAY)).toMatchObject({ from: "2026-10-19", to: TODAY }); // 25 Oct 2026 is a Sunday
    expect(periodRange("month", TODAY)).toMatchObject({ from: "2026-10-01", months: ["2026-10"] });
    expect(periodRange("fy", TODAY).months).toEqual(monthsBetween("2026-04-01", TODAY));
    expect(periodRange("custom", TODAY, { from: "2026-08-15", to: "2026-09-10" }).months).toEqual(["2026-08", "2026-09"]);
  });

  it("DB-002 the expense drill-down adds up to total expense at every level", () => {
    const tree = new CategoryTree(store.list("expense_categories"));
    const fy = periodRange("fy", TODAY).months;
    const cost = sumCost(fy.map((m) => store.get<CostRollup>("rollups", `co_${m}`)));
    const top = expenseLevel(tree, cost.expense.approvedPaise, null);
    expect(top.reduce((s, x) => s + x.valuePaise, 0)).toBe(totalExpense(cost));
    const labour = top.find((x) => x.id === "cat_labour")!;
    const sub = expenseLevel(tree, cost.expense.approvedPaise, "cat_labour");
    expect(sub.reduce((s, x) => s + x.valuePaise, 0)).toBe(labour.valuePaise);
  });

  it("DB-003 income against expense by month adds up to the FY rollups", () => {
    const months = periodRange("fy", TODAY).months;
    const cost = Object.fromEntries(months.map((m) => [m, store.get<CostRollup>("rollups", `co_${m}`)]));
    const fin = Object.fromEntries(months.map((m) => [m, store.get<FinanceRollup>("finance_rollups", `co_${m}`)]));
    const rows = incomeVsExpense(months, cost, fin);
    const f = sumFinance(Object.values(fin));
    expect(rows.reduce((s, r) => s + r.receivedPaise, 0)).toBe(f.receivedPaise);
    expect(rows.reduce((s, r) => s + r.billedPaise, 0)).toBe(f.billedPaise);
    expect(rows.reduce((s, r) => s + r.expensePaise, 0)).toBe(totalExpense(sumCost(Object.values(cost))));
  });

  it("DB-004 receivables ageing sums to what open invoices still owe", () => {
    const invoices = store.list<Invoice>("invoices");
    const a = receivablesAgeing(invoices, TODAY);
    expect(a.totalPaise).toBe(invoices.reduce((s, i) => s + invoiceOutstanding(i), 0));
    expect(a.totalPaise).toBeGreaterThan(0);
    expect(a.buckets.reduce((s, b) => s + b.count, 0)).toBe(invoices.filter((i) => invoiceOutstanding(i) > 0).length);
  });

  it("DB-005 project rows: spent and profit from each project's lifetime rollups; delayed and over budget flags", () => {
    const ps = store.list<Project>("projects");
    const budgets = Object.fromEntries(ps.map((p) => [p.id, store.get<{ budgetPaise: number }>(`projects/${p.id}/private`, "budget")?.budgetPaise ?? null]));
    const cost = Object.fromEntries(ps.map((p) => [p.id, store.get<CostRollup>("rollups", `p_${p.id}_all`)]));
    const fin = Object.fromEntries(ps.map((p) => [p.id, store.get<FinanceRollup>("finance_rollups", `p_${p.id}_all`)]));
    const rows = projectRows(ps, TODAY, budgets, cost, fin);
    for (const r of rows) {
      expect(r.spentPaise).toBe(totalExpense(sumCost([cost[r.id]])));
      expect(r.profitPaise).toBe(sumFinance([fin[r.id]]).receivedPaise - r.spentPaise);
      expect(r.delayed).toBe(isDelayed(ps.find((p) => p.id === r.id)!, TODAY));
    }
    expect(rows.some((r) => r.delayed)).toBe(true); // Gomti is behind its expected end date in the sample data
    const noMoney = projectRows(ps, TODAY, budgets, cost);
    expect(noMoney.every((r) => r.billedPaise === undefined && r.profitPaise === undefined)).toBe(true);
  });

  it("DB-006 cash and bank equal each account's opening balance plus its posted movements", () => {
    const accts = store.list<Account>("accounts");
    const b = balances(accts);
    for (const a of accts) {
      const moved = store.list<{ accountId: string; amountPaise: number; directionSign: number }>("account_transactions", (t) => t.accountId === a.id)
        .reduce((s, t) => s + t.directionSign * t.amountPaise, 0);
      expect(b.list.find((x) => x.id === a.id)!.balancePaise).toBe(a.openingBalancePaise + moved);
    }
    expect(b.totalPaise).toBe(b.cashPaise + b.bankPaise);
  });

  it("DB-007 to pay: unpaid credit purchases", () => {
    const exps = store.list<Expense>("expenses");
    const p = payables(exps, TODAY);
    const expected = exps.filter((e) => e.mode === "credit" && e.approvalStatus === "approved" && !e.isDeleted && e.paidStatus !== "paid").reduce((s, e) => s + e.amountPaise, 0);
    expect(p.totalPaise).toBe(expected);
    expect(p.dueThisWeekPaise).toBeLessThanOrEqual(p.totalPaise);
  });
});
