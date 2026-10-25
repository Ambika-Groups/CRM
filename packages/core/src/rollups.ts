/**
 * Reading rollups (decisions D-09). Monthly docs per company and project, plus a lifetime doc per project;
 * FY and custom ranges are summed from monthly docs. Category totals use the live tree (D-10).
 */
import { fyMonths } from "./dates";

export interface CostRollup {
  id: string;
  expense?: {
    approvedPaise?: Record<string, number>;
    gstPaise?: Record<string, number>;
    paidPaise?: Record<string, number>;
    count?: Record<string, number>;
  };
  expenseTotalPaise?: number;
  expensePaidPaise?: number;
  expenseGstPaise?: number;
  wagesEarnedPaise?: number;
  wagesExpensedPaise?: number;
  attendance?: Record<string, number>;
}

export interface FinanceRollup {
  id: string;
  billedPaise?: number;
  receivedPaise?: number;
  clientAdvanceReceivedPaise?: number;
  clientAdvanceAdjustedPaise?: number;
  gstOutputPaise?: number;
  gstInputPaise?: number;
  tdsHeldPaise?: number;
  retentionHeldPaise?: number;
  tdsDeductedPaise?: number;
  vendorBilledPaise?: number;
  vendorPaidPaise?: number;
  accounts?: Record<string, { inPaise?: number; outPaise?: number }>;
}

/** Metadata rules need on every rollup doc (scope, projectId, period), parsed from its ID. */
export function rollupMeta(id: string): { scope: "company" | "project"; projectId: string | null; period: string } {
  const period = id.slice(id.lastIndexOf("_") + 1);
  if (id.startsWith("co_")) return { scope: "company", projectId: null, period };
  return { scope: "project", projectId: id.slice(2, id.lastIndexOf("_")), period };
}

export function rollupId(projectId: string | null, period: string): string {
  return projectId ? `p_${projectId}_${period}` : `co_${period}`;
}

/** IDs to read for a range of months. */
export function rollupIdsFor(projectId: string | null, months: string[]): string[] {
  return months.map((m) => rollupId(projectId, m));
}

export function fyRollupIds(projectId: string | null, fy: string): string[] {
  return rollupIdsFor(projectId, fyMonths(fy));
}

function addMap(into: Record<string, number>, from: Record<string, number> | undefined) {
  if (!from) return;
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

export interface CostSum {
  expense: { approvedPaise: Record<string, number>; gstPaise: Record<string, number>; paidPaise: Record<string, number>; count: Record<string, number> };
  expenseTotalPaise: number;
  expensePaidPaise: number;
  expenseGstPaise: number;
  wagesEarnedPaise: number;
  wagesExpensedPaise: number;
  attendance: Record<string, number>;
}

/** Sum several cost rollups (e.g. the months of an FY) into one. */
export function sumCost(docs: (CostRollup | null | undefined)[]): CostSum {
  const out: CostSum = {
    expense: { approvedPaise: {}, gstPaise: {}, paidPaise: {}, count: {} },
    expenseTotalPaise: 0, expensePaidPaise: 0, expenseGstPaise: 0, wagesEarnedPaise: 0, wagesExpensedPaise: 0,
    attendance: {},
  };
  for (const d of docs) {
    if (!d) continue;
    addMap(out.expense.approvedPaise, d.expense?.approvedPaise);
    addMap(out.expense.gstPaise, d.expense?.gstPaise);
    addMap(out.expense.paidPaise, d.expense?.paidPaise);
    addMap(out.expense.count, d.expense?.count);
    out.expenseTotalPaise += d.expenseTotalPaise ?? 0;
    out.expensePaidPaise += d.expensePaidPaise ?? 0;
    out.expenseGstPaise += d.expenseGstPaise ?? 0;
    out.wagesEarnedPaise += d.wagesEarnedPaise ?? 0;
    out.wagesExpensedPaise += d.wagesExpensedPaise ?? 0;
    addMap(out.attendance, d.attendance);
  }
  return out;
}

const FIN_KEYS = ["billedPaise", "receivedPaise", "clientAdvanceReceivedPaise", "clientAdvanceAdjustedPaise", "gstOutputPaise",
  "gstInputPaise", "tdsHeldPaise", "retentionHeldPaise", "tdsDeductedPaise", "vendorBilledPaise", "vendorPaidPaise"] as const;

export function sumFinance(docs: (FinanceRollup | null | undefined)[]) {
  const out = Object.fromEntries(FIN_KEYS.map((k) => [k, 0])) as Record<(typeof FIN_KEYS)[number], number>;
  const accounts: Record<string, { inPaise: number; outPaise: number }> = {};
  for (const d of docs) {
    if (!d) continue;
    for (const k of FIN_KEYS) out[k] += d[k] ?? 0;
    for (const [a, v] of Object.entries(d.accounts ?? {})) {
      const x = (accounts[a] ??= { inPaise: 0, outPaise: 0 });
      x.inPaise += v.inPaise ?? 0;
      x.outPaise += v.outPaise ?? 0;
    }
  }
  return { ...out, accounts };
}

/** "Total expense" per D-20: approved, paid + unpaid; optionally paid only, optionally excluding GST. */
export function totalExpense(c: CostSum, opts: { paidOnly?: boolean; excludeGst?: boolean } = {}): number {
  const base = opts.paidOnly ? c.expensePaidPaise : c.expenseTotalPaise;
  return opts.excludeGst ? base - c.expenseGstPaise : base;
}

/** Wages due (D-16a) = earned from attendance − settled. */
export function wagesDue(c: CostSum): number {
  return c.wagesEarnedPaise - c.wagesExpensedPaise;
}

/** Project profit (§5.6): received (or billed, toggle) − total expense. */
export function projectProfit(received: number, billed: number, expense: number, basis: "received" | "billed" = "received"): number {
  return (basis === "received" ? received : billed) - expense;
}
