"use client";
import {
  fyOf, fyRange, monthsBetween, periodRange, sumCost, sumFinance, todayIST,
  type CostRollup, type FinanceRollup, type Period, type PeriodKind, type Project, type Role,
} from "@ag/core";
import { createContext, useContext } from "react";
import type { DataSource } from "@/data/types";

/** What the dashboard is looking at: the period (§11.1a selector) and the project and FY filters. */
export interface DashScope {
  role: Role;
  uid: string;
  projectIds: string[];      // the role's assigned projects (site roles)
  period: Period;
  projectId: string | null;  // global project filter
  fy: string;                // global FY filter (charts by month use it)
  today: string;
}

export const DashContext = createContext<DashScope | null>(null);
export const useDash = () => {
  const s = useContext(DashContext);
  if (!s) throw new Error("Dashboard scope missing");
  return s;
};

export function makePeriod(kind: PeriodKind, fy: string, custom: { from: string; to: string } | null): Period {
  const today = todayIST();
  if (kind === "fy") {
    const r = fyRange(fy);
    const to = r.to < today ? r.to : today;
    return { kind, from: r.from, to, months: monthsBetween(r.from, to), fromRecords: false };
  }
  return periodRange(kind, today, custom ?? undefined);
}

export const currentFy = () => fyOf(todayIST());
export const fyChoices = () => { const f = currentFy(); const y = Number(f.slice(0, 4)); return [f, `${y - 1}-${String(y % 100).padStart(2, "0")}`]; };

/** Projects in scope, never a whole collection: at most a page of 50, filtered for site roles (rule 9). */
export async function scopeProjects(s: DataSource, d: DashScope): Promise<Project[]> {
  const where = [{ field: "isArchived", op: "==" as const, value: false }, ...(d.role === "pm" || d.role === "supervisor" ? [{ field: "assignedUsers", op: "array-contains" as const, value: d.uid }] : [])];
  const page = await s.query<Project>("projects", { where, orderBy: [{ field: "code" }], limit: 50 });
  return d.projectId ? page.items.filter((p) => p.id === d.projectId) : page.items;
}

/**
 * Rollup IDs for months in scope: the company docs for roles that read them, or each project's docs for a
 * PM (who reads only assigned projects' rollups) and when one project is selected.
 */
export function rollupIds(d: DashScope, months: string[], projects?: string[]): string[] {
  if (d.projectId) return months.map((m) => `p_${d.projectId}_${m}`);
  if (d.role === "pm") return (projects ?? d.projectIds).flatMap((p) => months.map((m) => `p_${p}_${m}`));
  return months.map((m) => `co_${m}`);
}

export async function costFor(s: DataSource, d: DashScope, months: string[]) {
  const docs = await s.getMany<CostRollup>("rollups", rollupIds(d, months));
  return sumCost(docs);
}

export async function financeFor(s: DataSource, d: DashScope, months: string[]) {
  const docs = await s.getMany<FinanceRollup>("finance_rollups", rollupIds(d, months));
  return sumFinance(docs);
}

/** Cost and finance docs per month (for charts by month). */
export async function byMonth(s: DataSource, d: DashScope, months: string[], withFinance: boolean) {
  const cost: Record<string, CostRollup | null> = {};
  const fin: Record<string, FinanceRollup | null> = {};
  for (const m of months) {
    const ids = rollupIds(d, [m]);
    const cs = await s.getMany<CostRollup>("rollups", ids);
    cost[m] = { id: m, ...sumCost(cs) } as unknown as CostRollup;
    if (withFinance) {
      const fs = await s.getMany<FinanceRollup>("finance_rollups", ids);
      fin[m] = { id: m, ...sumFinance(fs) } as unknown as FinanceRollup;
    }
  }
  return { cost, fin };
}
