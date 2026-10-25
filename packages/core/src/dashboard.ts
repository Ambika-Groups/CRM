/**
 * Dashboard figures (spec §11.1, §11.1a), as pure functions over data the caller's role may read. The web
 * dashboard calls these, and the tests check them against the same core totals (to the paisa).
 * Rollups are monthly (D-09): "today" and "this week" come from records; a custom range uses whole months.
 */
import type { CategoryTree } from "./categories";
import { addDays, daysBetween, fyOf, fyRange, monthKeyOf } from "./dates";
import type { Account, Expense, Invoice, Project } from "./model";
import type { CostRollup, FinanceRollup } from "./rollups";
import { sumCost, sumFinance, totalExpense } from "./rollups";

export type PeriodKind = "today" | "week" | "month" | "fy" | "custom";
export interface Period { kind: PeriodKind; from: string; to: string; months: string[]; fromRecords: boolean }

/** Every month key from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number) as [number, number];
  const end = to.slice(0, 7);
  for (let i = 0; i < 240; i++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(k);
    if (k >= end) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** The period selector (§11.1a): today, this week (Monday to today), this month, this FY, or a custom range of months. */
export function periodRange(kind: PeriodKind, today: string, custom?: { from: string; to: string }): Period {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  switch (kind) {
    case "today": return { kind, from: today, to: today, months: [monthKeyOf(today)], fromRecords: true };
    case "week": {
      const from = addDays(today, day === 0 ? -6 : 1 - day);
      return { kind, from, to: today, months: monthsBetween(from, today), fromRecords: true };
    }
    case "month": return { kind, from: `${monthKeyOf(today)}-01`, to: today, months: [monthKeyOf(today)], fromRecords: false };
    case "fy": {
      const from = fyRange(fyOf(today)).from;
      return { kind, from, to: today, months: monthsBetween(from, today), fromRecords: false };
    }
    case "custom": {
      const from = `${(custom?.from ?? today).slice(0, 7)}-01`;
      const to = custom?.to && custom.to < today ? custom.to : today;
      return { kind, from, to, months: monthsBetween(from, to), fromRecords: false };
    }
  }
}

/** Total of approved expense records (for "today" and "this week", which monthly rollups can't give). */
export function expenseFromRecords(expenses: Pick<Expense, "amountPaise" | "approvalStatus" | "isDeleted" | "date">[], from: string, to: string): number {
  return expenses.filter((e) => e.approvalStatus === "approved" && !e.isDeleted && e.date >= from && e.date <= to).reduce((s, e) => s + e.amountPaise, 0);
}

export interface Slice { id: string; name: string; valuePaise: number; hasChildren: boolean }

/**
 * One level of the expense drill-down (§7.3, §11.1 chart 1): the children of `parentId` (the five summary heads
 * at the top) with their rolled-up totals, plus what was posted on the parent itself. Sums to the parent's total.
 */
export function expenseLevel(tree: CategoryTree, approvedByCategory: Record<string, number>, parentId: string | null, lang: "en" | "hi" = "en"): Slice[] {
  const name = (c: { name: string; nameHi?: string }) => (lang === "hi" && c.nameHi ? c.nameHi : c.name);
  const kids = parentId ? tree.childrenOf(parentId) : tree.roots();
  const out: Slice[] = kids.map((c) => ({ id: c.id, name: name(c), valuePaise: tree.total(c.id, approvedByCategory), hasChildren: tree.childrenOf(c.id).length > 0 }))
    .filter((s) => s.valuePaise !== 0);
  if (parentId) {
    const own = approvedByCategory[parentId] ?? 0;
    if (own) out.push({ id: `${parentId}__own`, name: "—", valuePaise: own, hasChildren: false });
  }
  return out.sort((a, b) => b.valuePaise - a.valuePaise);
}

export interface MonthRow { month: string; billedPaise: number; receivedPaise: number; expensePaise: number }

/** Income against expense by month (§11.1 chart 2), from the company (or one project's) monthly rollups. */
export function incomeVsExpense(months: string[], cost: Record<string, CostRollup | null | undefined>, fin: Record<string, FinanceRollup | null | undefined>): MonthRow[] {
  return months.map((m) => {
    const f = sumFinance([fin[m]]);
    return { month: m, billedPaise: f.billedPaise, receivedPaise: f.receivedPaise, expensePaise: totalExpense(sumCost([cost[m]])) };
  });
}

export interface AgeingBucket { key: "0_30" | "31_60" | "61_90" | "90_plus"; amountPaise: number; count: number }

const OPEN: ReadonlySet<string> = new Set(["sent", "partially_paid", "overdue"]);

/** What a client still owes on an invoice: the net receivable less what was received. */
export function invoiceOutstanding(inv: Pick<Invoice, "netReceivablePaise" | "totals" | "paidPaise" | "status">): number {
  if (!OPEN.has(inv.status)) return 0;
  return Math.max(0, (inv.netReceivablePaise ?? inv.totals?.totalPaise ?? 0) - (inv.paidPaise ?? 0));
}

/** Receivables ageing (§11.1 chart 5): open invoices by days since the invoice date. */
export function receivablesAgeing(invoices: Invoice[], today: string): { buckets: AgeingBucket[]; totalPaise: number } {
  const buckets: AgeingBucket[] = (["0_30", "31_60", "61_90", "90_plus"] as const).map((key) => ({ key, amountPaise: 0, count: 0 }));
  for (const inv of invoices) {
    const due = invoiceOutstanding(inv);
    if (!due) continue;
    const d = daysBetween(inv.date, today);
    const b = buckets[d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3]!;
    b.amountPaise += due; b.count++;
  }
  return { buckets, totalPaise: buckets.reduce((s, b) => s + b.amountPaise, 0) };
}

export interface ProjectRow {
  id: string; name: string; code: string; status: Project["status"]; progressPct: number; delayed: boolean;
  budgetPaise: number | null; spentPaise: number; overBudget: boolean; billedPaise?: number; receivedPaise?: number; profitPaise?: number;
}

/** A project is delayed when it isn't finished and its expected end date has passed (§11.1). */
export function isDelayed(p: Pick<Project, "status" | "expectedEndDate">, today: string): boolean {
  return (p.status === "in_progress" || p.status === "on_hold" || p.status === "planned") && !!p.expectedEndDate && p.expectedEndDate < today;
}

/**
 * Project overview (§11.1 widget; chart 3): spent against budget and, for roles that read billing, profit
 * (received − total expense, D-20). Lifetime figures from each project's `_all` rollups.
 */
export function projectRows(projects: Project[], today: string, budgets: Record<string, number | null>, costAll: Record<string, CostRollup | null | undefined>, finAll?: Record<string, FinanceRollup | null | undefined>): ProjectRow[] {
  return projects.map((p) => {
    const spent = totalExpense(sumCost([costAll[p.id]]));
    const budget = budgets[p.id] ?? null;
    const row: ProjectRow = {
      id: p.id, name: p.name, code: p.code, status: p.status, progressPct: p.progressPct, delayed: isDelayed(p, today),
      budgetPaise: budget, spentPaise: spent, overBudget: budget != null && budget > 0 && spent > budget,
    };
    if (finAll) {
      const f = sumFinance([finAll[p.id]]);
      row.billedPaise = f.billedPaise; row.receivedPaise = f.receivedPaise; row.profitPaise = f.receivedPaise - spent;
    }
    return row;
  });
}

/** Cash and bank balances (§11.1a cards): each account and the cash and bank totals. */
export function balances(accounts: Account[]) {
  const list = accounts.filter((a) => a.active !== false).map((a) => ({ id: a.id, name: a.name, type: a.type, balancePaise: a.balancePaise ?? a.openingBalancePaise }));
  const cash = list.filter((a) => a.type === "cash").reduce((s, a) => s + a.balancePaise, 0);
  const bank = list.filter((a) => a.type !== "cash").reduce((s, a) => s + a.balancePaise, 0);
  return { list, cashPaise: cash, bankPaise: bank, totalPaise: cash + bank };
}

export interface Deadline { kind: "eot" | "guarantee" | "emd" | "milestone" | "project_end"; date: string; label: string; projectId: string; href: string; overdue: boolean; daysLeft: number }

/** Upcoming deadlines (§11.1a): within `days`, plus anything already overdue, soonest first. */
export function upcomingDeadlines(items: Omit<Deadline, "overdue" | "daysLeft">[], today: string, days = 30): Deadline[] {
  return items.map((d) => ({ ...d, daysLeft: daysBetween(today, d.date), overdue: d.date < today }))
    .filter((d) => d.daysLeft <= days)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Spend tracker (§11.1a): today, this month and last month, with the change. */
export function spendTracker(todayPaise: number, monthPaise: number, lastMonthPaise: number) {
  return { todayPaise, monthPaise, lastMonthPaise, changeBp: lastMonthPaise ? Math.round(((monthPaise - lastMonthPaise) * 10_000) / lastMonthPaise) : null };
}

/** Unpaid credit purchases (to pay): approved credit expenses still unpaid, and those due within a week. */
export function payables(expenses: Pick<Expense, "amountPaise" | "approvalStatus" | "isDeleted" | "paidStatus" | "mode" | "billDate" | "date">[], today: string, termDays = 30) {
  const open = expenses.filter((e) => e.approvalStatus === "approved" && !e.isDeleted && e.mode === "credit" && e.paidStatus !== "paid");
  const due = (e: (typeof open)[number]) => addDays(e.billDate ?? e.date, termDays);
  return {
    totalPaise: open.reduce((s, e) => s + e.amountPaise, 0),
    dueThisWeekPaise: open.filter((e) => due(e) <= addDays(today, 7)).reduce((s, e) => s + e.amountPaise, 0),
    count: open.length,
  };
}
