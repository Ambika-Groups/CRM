"use client";
import {
  addDays, balances, CategoryTree, expenseFromRecords, expenseLevel, formatMonth, incomeVsExpense, monthKeyOf,
  payables, projectRows, receivablesAgeing, spendTracker, totalExpense, upcomingDeadlines, wagesDue,
  type Account, type Category, type CostRollup, type Deadline, type Expense, type FinanceRollup, type Invoice, type ThekedarContract, type WorkerPayment,
} from "@ag/core";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { EmptyState, Skeleton, StatusBadge } from "@/components/ui/feedback";
import { useRead, useSmall } from "@/data/DataProvider";
import { fetchAll } from "@/lib/fetchAll";
import { date, rupees } from "@/lib/fmt";
import { ChartCard, EChart, type ChartTheme } from "./Chart";
import { byMonth, costFor, financeFor, scopeProjects, useDash } from "./data";

const lakh = (p: number) => {
  const r = p / 100;
  return Math.abs(r) >= 1e7 ? `₹${(r / 1e7).toFixed(2)} Cr` : Math.abs(r) >= 1e5 ? `₹${(r / 1e5).toFixed(1)} L` : `₹${Math.round(r).toLocaleString("en-IN")}`;
};
const useLang = () => { const { i18n } = useTranslation(); return i18n.language === "hi" ? "hi" : "en"; };

// ---------- KPI cards (§11.1): each one opens its records ----------

export function Kpi({ label, value, hint, href, tone, id }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "bad" | "good"; id: string }) {
  const body = (<><div className="label">{label}</div><div className={`value${tone ? ` tone-${tone}` : ""}`}>{value}</div>{hint && <div className="trend">{hint}</div>}</>);
  // A link to a chart on this page is a plain anchor, so its hashchange mounts the lazy card it names.
  if (href?.startsWith("#")) return <a className="kpi kpi-link" href={href} data-kpi={id}>{body}</a>;
  return href ? <Link className="kpi kpi-link" href={href} data-kpi={id}>{body}</Link> : <div className="kpi" data-kpi={id}>{body}</div>;
}

/** Project counts (active, completed, delayed): counts only, never the collection. */
export function useProjectCounts() {
  const d = useDash();
  return useRead(`dash-counts:${d.role}:${d.uid}:${d.projectId}:${d.today}`, async (s) => {
    const mine = d.role === "pm" || d.role === "supervisor" ? [{ field: "assignedUsers", op: "array-contains" as const, value: d.uid }] : [];
    const live = [{ field: "isArchived", op: "==" as const, value: false }, ...mine];
    const [active, completed, delayed] = await Promise.all([
      s.count("projects", [...live, { field: "status", op: "==", value: "in_progress" }]),
      s.count("projects", [...live, { field: "status", op: "==", value: "completed" }]),
      s.count("projects", [...live, { field: "status", op: "==", value: "in_progress" }, { field: "expectedEndDate", op: "<", value: d.today }]),
    ]);
    return { active, completed, delayed };
  });
}

/** Money KPIs for the period: expense (records for today/week, rollups otherwise), billed, received, net. */
export function useMoneyKpis(withFinance: boolean) {
  const d = useDash();
  return useRead(`dash-money:${d.role}:${d.projectId}:${d.period.kind}:${d.period.from}:${d.period.to}:${withFinance}`, async (s) => {
    const cost = await costFor(s, d, d.period.months);
    let expense = totalExpense(cost);
    if (d.period.fromRecords) {
      const where = [{ field: "date", op: ">=" as const, value: d.period.from }, { field: "date", op: "<=" as const, value: d.period.to },
        ...(d.projectId ? [{ field: "projectId", op: "==" as const, value: d.projectId }] : d.role === "pm" ? [{ field: "projectId", op: "in" as const, value: d.projectIds.slice(0, 30) }] : [])];
      expense = expenseFromRecords(await fetchAll<Expense>(s, "expenses", { where }), d.period.from, d.period.to);
    }
    const fin = withFinance ? await financeFor(s, d, d.period.months) : null;
    // Wages due is a running balance, so it uses the financial year so far, not just the period.
    const fyCost = await costFor(s, d, d.period.kind === "fy" ? d.period.months : rollupMonthsToDate(d));
    return { expense, wages: wagesDue(fyCost), billed: fin?.billedPaise ?? 0, received: fin?.receivedPaise ?? 0, net: (fin?.receivedPaise ?? 0) - expense, gstOut: fin?.gstOutputPaise ?? 0, gstIn: fin?.gstInputPaise ?? 0, tdsDeducted: fin?.tdsDeductedPaise ?? 0, tdsHeld: fin?.tdsHeldPaise ?? 0 };
  });
}
function rollupMonthsToDate(d: ReturnType<typeof useDash>) {
  const start = `${d.fy.slice(0, 4)}-04`;
  const out: string[] = [];
  for (let m = start; m <= monthKeyOf(d.today); ) { out.push(m); const [y, mm] = m.split("-").map(Number) as [number, number]; m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; }
  return out;
}

/** Open invoices (≤ 50), for outstanding and ageing. Finance readers only. */
export function useOpenInvoices(enabled: boolean) {
  const d = useDash();
  return useRead(`dash-inv:${enabled}:${d.projectId}`, (s) => (enabled
    ? s.query<Invoice>("invoices", { where: [{ field: "status", op: "in", value: ["sent", "partially_paid", "overdue"] }, ...(d.projectId ? [{ field: "projectId", op: "==" as const, value: d.projectId }] : [])], orderBy: [{ field: "date" }], limit: 50 }).then((p) => p.items)
    : Promise.resolve([] as Invoice[])));
}

// ---------- Chart 1: expense drill-down (§7.3, §11.1) ----------

export function ExpenseDrill() {
  const { t } = useTranslation();
  const lang = useLang();
  const d = useDash();
  const cats = useSmall<Category>("expense_categories");
  const cost = useRead(`dash-drill:${d.role}:${d.projectId}:${d.period.months.join()}`, (s) => costFor(s, d, d.period.months));
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const parent = path[path.length - 1]?.id ?? null;
  const tree = cats ? new CategoryTree(cats) : null;
  const slices = tree && cost ? expenseLevel(tree, cost.expense.approvedPaise, parent, lang).map((x) => (x.id.endsWith("__own") ? { ...x, name: t("dash.directly") } : x)) : [];
  const total = slices.reduce((s, x) => s + x.valuePaise, 0);
  const option = useCallback((th: ChartTheme) => ({
    tooltip: { trigger: "item", formatter: (p: { name: string; value: number; percent: number }) => `${p.name}: ${lakh(p.value)} (${p.percent}%)` },
    legend: { bottom: 0, type: "scroll", textStyle: { color: th.text }, pageIconColor: th.text, pageIconInactiveColor: th.grid, pageTextStyle: { color: th.axis } },
    series: [{ type: "pie", radius: ["48%", "72%"], center: ["50%", "44%"], avoidLabelOverlap: true,
      itemStyle: { borderColor: th.surface, borderWidth: 2 },
      label: { color: th.text, formatter: (p: { name: string; percent: number }) => `${p.name}\n${p.percent}%`, fontSize: 12 },
      labelLayout: { hideOverlap: true },
      data: slices.map((x, i) => ({ id: x.id, name: x.name, value: x.valuePaise, label: { show: total > 0 && x.valuePaise / total >= 0.03 }, labelLine: { show: total > 0 && x.valuePaise / total >= 0.03 }, itemStyle: { color: th.series[i % 5], borderColor: i % 5 === 2 && !parent ? th.outline : th.surface, borderWidth: i % 5 === 2 ? 1 : 2 } })) }],
  }), [slices, parent, total]);
  return (
    <ChartCard title={t("dash.expenseDrill")} id="chart-expense" exportName="expense-breakdown" rows={slices}
      columns={[{ header: t("dash.category"), value: (r) => r.name }, { header: t("dash.amount"), value: (r) => rupees(r.valuePaise), num: true }, { header: "%", value: (r) => (total ? `${Math.round((r.valuePaise * 1000) / total) / 10}%` : "—"), num: true }]}
      controls={<span className="muted small">{t("dash.total")}: <b>{rupees(total)}</b></span>}>
      <nav className="crumbs-line" aria-label={t("dash.drillPath")} data-drill-path>
        <button type="button" className="link-btn" onClick={() => setPath([])} aria-current={!path.length ? "page" : undefined}>{t("dash.allHeads")}</button>
        {path.map((p, i) => <span key={p.id}> › <button type="button" className="link-btn" onClick={() => setPath(path.slice(0, i + 1))} aria-current={i === path.length - 1 ? "page" : undefined}>{p.name}</button></span>)}
      </nav>
      {!cost || !cats ? <Skeleton lines={5} /> : (
        <EChart option={option} height={300} label={`${t("dash.expenseDrill")}: ${slices.map((x) => `${x.name} ${rupees(x.valuePaise)}`).join(", ")}`}
          onSelect={(p) => { const s = slices[p.dataIndex]; if (s?.hasChildren) setPath([...path, { id: s.id, name: s.name }]); }} />
      )}
      <p className="hint small"><Icon name="info" size={16} /><span>{t("dash.drillHint")}</span></p>
    </ChartCard>
  );
}

// ---------- Chart 2: income vs expense by month ----------

export function IncomeExpense() {
  const { t } = useTranslation();
  const lang = useLang();
  const d = useDash();
  const months = d.period.months.length > 1 ? d.period.months : rollupMonthsFy(d.fy, d.today);
  const data = useRead(`dash-ie:${d.role}:${d.projectId}:${months.join()}`, async (s) => { const { cost, fin } = await byMonth(s, d, months, true); return incomeVsExpense(months, cost, fin); });
  const rows = (data ?? []).filter((r) => r.billedPaise || r.receivedPaise || r.expensePaise);
  const option = useCallback((th: ChartTheme) => ({
    tooltip: { trigger: "axis", valueFormatter: (v: number) => lakh(v) },
    legend: { bottom: 0, textStyle: { color: th.text } },
    grid: { left: 8, right: 8, top: 16, bottom: 40, containLabel: true },
    xAxis: { type: "category", data: rows.map((r) => formatMonth(r.month, lang)), axisLabel: { color: th.axis }, axisLine: { lineStyle: { color: th.grid } } },
    yAxis: { type: "value", axisLabel: { color: th.axis, formatter: (v: number) => lakh(v) }, splitLine: { lineStyle: { color: th.grid } } },
    series: [
      { name: t("dash.received"), type: "bar", data: rows.map((r) => r.receivedPaise), itemStyle: { color: th.series[4], borderRadius: [6, 6, 0, 0] } },
      { name: t("dash.billed"), type: "bar", data: rows.map((r) => r.billedPaise), itemStyle: { color: th.series[3], borderRadius: [6, 6, 0, 0] } },
      { name: t("dash.expense"), type: "line", data: rows.map((r) => r.expensePaise), itemStyle: { color: th.series[0] }, lineStyle: { width: 3, color: th.series[0] }, symbolSize: 8 },
    ],
  }), [rows, lang, t]);
  return (
    <ChartCard title={t("dash.incomeExpense")} id="chart-income" exportName="income-expense" rows={rows}
      columns={[{ header: t("dash.month"), value: (r) => formatMonth(r.month, lang) }, { header: t("dash.billed"), value: (r) => rupees(r.billedPaise), num: true }, { header: t("dash.received"), value: (r) => rupees(r.receivedPaise), num: true }, { header: t("dash.expense"), value: (r) => rupees(r.expensePaise), num: true }]}>
      {!data ? <Skeleton lines={5} /> : <EChart option={option} label={`${t("dash.incomeExpense")}: ${rows.map((r) => `${formatMonth(r.month, lang)} ${t("dash.received")} ${rupees(r.receivedPaise)}, ${t("dash.expense")} ${rupees(r.expensePaise)}`).join("; ")}`} />}
    </ChartCard>
  );
}
function rollupMonthsFy(fy: string, today: string) {
  const out: string[] = [];
  for (let m = `${fy.slice(0, 4)}-04`; m <= monthKeyOf(today) && out.length < 12; ) { out.push(m); const [y, mm] = m.split("-").map(Number) as [number, number]; m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; }
  return out;
}

// ---------- Chart 3 + widget: projects (budget vs spent; profit for finance) ----------

export function useProjectRows(withFinance: boolean) {
  const d = useDash();
  return useRead(`dash-proj:${d.role}:${d.uid}:${d.projectId}:${withFinance}`, async (s) => {
    const ps = await scopeProjects(s, d);
    const [budgets, cost, fin] = await Promise.all([
      Promise.all(ps.map((p) => s.get<{ budgetPaise: number }>(`projects/${p.id}/private`, "budget"))),
      s.getMany<CostRollup>("rollups", ps.map((p) => `p_${p.id}_all`)),
      withFinance ? s.getMany<FinanceRollup>("finance_rollups", ps.map((p) => `p_${p.id}_all`)) : Promise.resolve(null),
    ]);
    return projectRows(ps, d.today, Object.fromEntries(ps.map((p, i) => [p.id, budgets[i]?.budgetPaise ?? null])),
      Object.fromEntries(ps.map((p, i) => [p.id, cost[i]])), fin ? Object.fromEntries(ps.map((p, i) => [p.id, fin[i]])) : undefined);
  });
}

export function ProjectBars({ withFinance }: { withFinance: boolean }) {
  const { t } = useTranslation();
  const rows = useProjectRows(withFinance);
  const list = rows ?? [];
  const over = list.filter((r) => r.overBudget);
  const option = useCallback((th: ChartTheme) => ({
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => lakh(v) },
    legend: { bottom: 0, textStyle: { color: th.text } },
    grid: { left: 8, right: 16, top: 8, bottom: 40, containLabel: true },
    yAxis: { type: "category", data: list.map((r) => r.name), axisLabel: { color: th.text, width: 140, overflow: "truncate" }, axisLine: { lineStyle: { color: th.grid } } },
    xAxis: { type: "value", splitNumber: 3, axisLabel: { color: th.axis, formatter: (v: number) => lakh(v), hideOverlap: true }, splitLine: { lineStyle: { color: th.grid } } },
    series: [
      { name: t("dash.budget"), type: "bar", data: list.map((r) => r.budgetPaise ?? 0), itemStyle: { color: th.series[4], borderRadius: [0, 6, 6, 0] } },
      { name: t("dash.spent"), type: "bar", data: list.map((r) => ({ value: r.spentPaise, itemStyle: { color: r.overBudget ? th.bad : th.series[0] } })), itemStyle: { color: th.series[0], borderRadius: [0, 6, 6, 0] } },
      ...(withFinance ? [{ name: t("dash.profit"), type: "bar", data: list.map((r) => ({ value: r.profitPaise ?? 0, itemStyle: { color: (r.profitPaise ?? 0) < 0 ? th.series[1] : th.series[3] } })), itemStyle: { color: th.series[3], borderRadius: [0, 6, 6, 0] } }] : []),
    ],
  }), [list, withFinance, t]);
  return (
    <ChartCard title={withFinance ? t("dash.projectsMoney") : t("dash.budgetSpent")} id="chart-projects" exportName="projects" rows={list}
      columns={[{ header: t("dash.project"), value: (r) => r.name }, { header: t("dash.budget"), value: (r) => (r.budgetPaise == null ? "—" : rupees(r.budgetPaise)), num: true }, { header: t("dash.spent"), value: (r) => rupees(r.spentPaise), num: true },
        ...(withFinance ? [{ header: t("dash.received"), value: (r: (typeof list)[number]) => rupees(r.receivedPaise ?? 0), num: true }, { header: t("dash.profit"), value: (r: (typeof list)[number]) => rupees(r.profitPaise ?? 0), num: true }] : [])]}>
      {!rows ? <Skeleton lines={5} /> : <EChart option={option} height={Math.max(220, list.length * 64 + 70)} label={`${t("dash.budgetSpent")}: ${list.map((r) => `${r.name} ${t("dash.spent")} ${rupees(r.spentPaise)} ${t("dash.budget")} ${rupees(r.budgetPaise ?? 0)}`).join("; ")}`} />}
      {over.length > 0 && (
        <div className="over-budget" role="status" data-over-budget>
          <Icon name="alert" size={16} /><b>{t("dash.overBudget")}</b>
          <ul>{over.map((r) => <li key={r.id}><Link href={`/projects/view/?id=${r.id}`}>{r.name}</Link>: {t("dash.overBy", { amount: rupees(r.spentPaise - (r.budgetPaise ?? 0)) })}</li>)}</ul>
        </div>
      )}
    </ChartCard>
  );
}

export function ProjectOverview({ withFinance }: { withFinance: boolean }) {
  const { t } = useTranslation();
  const rows = useProjectRows(withFinance);
  return (
    <section className="card dash-card" aria-labelledby="po-title" data-widget="projects">
      <h2 className="card-title" id="po-title">{t("dash.projectOverview")}<span className="aside"><Link href="/projects/">{t("common.seeAll")}</Link></span></h2>
      {!rows ? <Skeleton lines={4} /> : rows.length === 0 ? <EmptyState icon="folder" title={t("dash.noProjects")} /> : (
        <ul className="po-list">{rows.map((r) => {
          const pct = r.budgetPaise ? Math.min(100, Math.round((r.spentPaise / r.budgetPaise) * 100)) : null;
          return (
            <li key={r.id}>
              <div className="po-head"><Link href={`/projects/view/?id=${r.id}`}><b>{r.name}</b></Link>
                <StatusBadge kind={r.delayed ? "delayed" : r.status === "completed" ? "completed" : r.status === "on_hold" ? "on_hold" : r.status === "planned" ? "planned" : "active"} /></div>
              <div className="po-bars">
                <div className="po-bar"><span className="muted small">{t("dash.progress")} {r.progressPct}%</span><div className="bar progress"><span style={{ width: `${r.progressPct}%` }} /></div></div>
                {pct != null && <div className="po-bar"><span className="muted small">{t("dash.budgetUsed", { pct })}{r.overBudget ? ` · ${t("dash.overBudgetShort")}` : ""}</span><div className={`bar${r.overBudget ? " bar-bad" : ""}`}><span style={{ width: `${pct}%` }} /></div></div>}
              </div>
            </li>
          );
        })}</ul>
      )}
    </section>
  );
}

export function TopProjects() {
  const { t } = useTranslation();
  const rows = useProjectRows(false);
  const top = [...(rows ?? [])].sort((a, b) => b.spentPaise - a.spentPaise).slice(0, 5);
  return (
    <section className="card dash-card" aria-labelledby="top-title" data-widget="top5">
      <h2 className="card-title" id="top-title">{t("dash.top5")}</h2>
      {!rows ? <Skeleton lines={4} /> : (
        <ol className="rank-list">{top.map((r) => <li key={r.id}><Link href={`/projects/view/?id=${r.id}&tab=pnl`}>{r.name}</Link><span className="num">{rupees(r.spentPaise)}</span></li>)}</ol>
      )}
    </section>
  );
}

// ---------- Chart 4 + widget: attendance ----------

export function useSiteAttendance() {
  const d = useDash();
  return useRead(`dash-att:${d.role}:${d.uid}:${d.projectId}:${d.today}`, async (s) => {
    const ps = await scopeProjects(s, d);
    const sites = await Promise.all(ps.map(async (p) => {
      const base = [{ field: "projectId", op: "==" as const, value: p.id }, { field: "date", op: "==" as const, value: d.today }];
      const [present, half, absent, marked] = await Promise.all([
        s.count("attendance", [...base, { field: "status", op: "in", value: ["present", "overtime"] }]),
        s.count("attendance", [...base, { field: "status", op: "==", value: "half_day" }]),
        s.count("attendance", [...base, { field: "status", op: "in", value: ["absent", "leave"] }]),
        s.count("attendance", base),
      ]);
      const roster = (await s.listSmall<{ active: boolean }>(`projects/${p.id}/roster`)).filter((r) => r.active).length;
      return { id: p.id, name: p.name, present, half, absent, marked, roster };
    }));
    return sites;
  });
}

export function WorkersTodayChart() {
  const { t } = useTranslation();
  const sites = useSiteAttendance();
  const list = sites ?? [];
  const option = useCallback((th: ChartTheme) => ({
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { bottom: 0, textStyle: { color: th.text } },
    grid: { left: 8, right: 16, top: 8, bottom: 40, containLabel: true },
    yAxis: { type: "category", data: list.map((s) => s.name), axisLabel: { color: th.text, width: 140, overflow: "truncate" } },
    xAxis: { type: "value", minInterval: 1, axisLabel: { color: th.axis }, splitLine: { lineStyle: { color: th.grid } } },
    series: [
      { name: t("dash.present"), type: "bar", stack: "a", data: list.map((s) => s.present), itemStyle: { color: th.series[4] } },
      { name: t("dash.halfDay"), type: "bar", stack: "a", data: list.map((s) => s.half), itemStyle: { color: th.series[3] } },
      { name: t("dash.absent"), type: "bar", stack: "a", data: list.map((s) => s.absent), itemStyle: { color: th.series[0], borderRadius: [0, 6, 6, 0] } },
    ],
  }), [list, t]);
  return (
    <ChartCard title={t("dash.workersToday")} id="chart-workers" exportName="workers-today" rows={list}
      columns={[{ header: t("dash.site"), value: (r) => r.name }, { header: t("dash.present"), value: (r) => r.present, num: true }, { header: t("dash.halfDay"), value: (r) => r.half, num: true }, { header: t("dash.absent"), value: (r) => r.absent, num: true }, { header: t("dash.onRoster"), value: (r) => r.roster, num: true }]}>
      {!sites ? <Skeleton lines={4} /> : <>
        {list.every((s) => s.marked === 0) ? <p className="muted" data-empty="workers-today">{t("dash.noAttendanceToday")}</p> : <EChart option={option} height={Math.max(180, list.length * 56 + 70)} label={`${t("dash.workersToday")}: ${list.map((s) => `${s.name} ${s.present} ${t("dash.present")}`).join("; ")}`} />}
        <ul className="link-list">{list.map((s) => <li key={s.id}><Link href={`/projects/view/?id=${s.id}&tab=workforce`}>{t("dash.seePresent", { site: s.name })}</Link>{s.marked === 0 && <span className="muted small"> · {t("dash.notMarkedYet")}</span>}</li>)}</ul>
      </>}
    </ChartCard>
  );
}

export function AttendanceTrend() {
  const { t } = useTranslation();
  const lang = useLang();
  const d = useDash();
  const days = Array.from({ length: 30 }, (_, i) => addDays(d.today, i - 29));
  const data = useRead(`dash-trend:${d.role}:${d.uid}:${d.projectId}:${d.today}`, async (s) => {
    const ps = await scopeProjects(s, d);
    const scope = d.projectId ? [{ field: "projectId", op: "==" as const, value: d.projectId }] : d.role === "pm" || d.role === "supervisor" ? [{ field: "projectId", op: "in" as const, value: ps.map((p) => p.id).slice(0, 30) }] : [];
    return Promise.all(days.map(async (day) => {
      const base = [...scope, { field: "date", op: "==" as const, value: day }];
      const [present, half, absent] = await Promise.all([
        s.count("attendance", [...base, { field: "status", op: "in", value: ["present", "overtime"] }]),
        s.count("attendance", [...base, { field: "status", op: "==", value: "half_day" }]),
        s.count("attendance", [...base, { field: "status", op: "in", value: ["absent", "leave"] }]),
      ]);
      return { day, present, half, absent };
    }));
  });
  const rows = (data ?? []).filter((r) => r.present + r.half + r.absent > 0);
  const option = useCallback((th: ChartTheme) => ({
    tooltip: { trigger: "axis" },
    legend: { bottom: 0, textStyle: { color: th.text } },
    grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
    xAxis: { type: "category", data: rows.map((r) => date(r.day, lang).slice(0, 6)), axisLabel: { color: th.axis }, axisLine: { lineStyle: { color: th.grid } } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { color: th.axis }, splitLine: { lineStyle: { color: th.grid } } },
    series: [
      { name: t("dash.present"), type: "line", data: rows.map((r) => r.present), lineStyle: { width: 3, color: th.series[4] }, itemStyle: { color: th.series[4] }, symbol: "circle" },
      { name: t("dash.halfDay"), type: "line", data: rows.map((r) => r.half), lineStyle: { width: 2, type: "dashed", color: th.series[3] }, itemStyle: { color: th.series[3] }, symbol: "diamond" },
      { name: t("dash.absent"), type: "line", data: rows.map((r) => r.absent), lineStyle: { width: 2, color: th.series[0] }, itemStyle: { color: th.series[0] }, symbol: "triangle" },
    ],
  }), [rows, lang, t]);
  return (
    <ChartCard title={t("dash.attendance30")} id="chart-trend" exportName="attendance-30-days" rows={rows}
      columns={[{ header: t("dash.day"), value: (r) => date(r.day, lang) }, { header: t("dash.present"), value: (r) => r.present, num: true }, { header: t("dash.halfDay"), value: (r) => r.half, num: true }, { header: t("dash.absent"), value: (r) => r.absent, num: true }]}>
      {!data ? <Skeleton lines={5} /> : <EChart option={option} label={`${t("dash.attendance30")}: ${rows.length} ${t("dash.daysShown")}`} />}
    </ChartCard>
  );
}

// ---------- Chart 5: receivables ageing ----------

export function Ageing() {
  const { t } = useTranslation();
  const d = useDash();
  const invoices = useOpenInvoices(true);
  const a = invoices ? receivablesAgeing(invoices, d.today) : null;
  const rows = a?.buckets ?? [];
  const option = useCallback((th: ChartTheme) => ({
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => lakh(v) },
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: rows.map((b) => t(`dash.age.${b.key}`)), axisLabel: { color: th.text } },
    yAxis: { type: "value", axisLabel: { color: th.axis, formatter: (v: number) => lakh(v) }, splitLine: { lineStyle: { color: th.grid } } },
    series: [{ type: "bar", data: rows.map((b, i) => ({ value: b.amountPaise, itemStyle: { color: [th.series[4], th.series[3], th.series[1], th.series[0]][i], borderRadius: [6, 6, 0, 0] } })),
      label: { show: true, position: "top", color: th.text, formatter: (p: { value: number }) => (p.value ? lakh(p.value) : "") } }],
  }), [rows, t]);
  return (
    <ChartCard title={t("dash.ageing")} id="chart-ageing" exportName="receivables-ageing" rows={rows.filter((b) => b.count)}
      columns={[{ header: t("dash.ageBucket"), value: (r) => t(`dash.age.${r.key}`) }, { header: t("dash.invoices"), value: (r) => r.count, num: true }, { header: t("dash.amount"), value: (r) => rupees(r.amountPaise), num: true }]}
      controls={a ? <span className="muted small">{t("dash.total")}: <b>{rupees(a.totalPaise)}</b></span> : null}
      empty={<p className="muted">{t("dash.nothingOwed")}</p>}>
      {!a ? <Skeleton lines={4} /> : <EChart option={option} height={220} label={`${t("dash.ageing")}: ${rows.map((b) => `${t(`dash.age.${b.key}`)} ${rupees(b.amountPaise)}`).join("; ")}`} />}
      <p className="small"><Link href="/clients/">{t("dash.seeClients")}</Link></p>
    </ChartCard>
  );
}

// ---------- Money widgets (§11.1a) ----------

export function ReceivePay() {
  const { t } = useTranslation();
  const d = useDash();
  const invoices = useOpenInvoices(true);
  const pay = useRead(`dash-pay:${d.projectId}:${d.today}`, async (s) => {
    const credit = await fetchAll<Expense>(s, "expenses", { where: [{ field: "mode", op: "==", value: "credit" }, { field: "paidStatus", op: "==", value: "unpaid" }, ...(d.projectId ? [{ field: "projectId", op: "==" as const, value: d.projectId }] : [])] }, 10);
    const projectIds = d.projectId ? [d.projectId] : (await scopeProjects(s, d)).map((p) => p.id);
    const cost = await s.getMany<CostRollup>("rollups", projectIds.map((p) => `p_${p}_all`));
    const wages = cost.reduce((sum, c) => sum + (c?.wagesEarnedPaise ?? 0) - (c?.wagesExpensedPaise ?? 0), 0);
    return { ...payables(credit, d.today), wagesPaise: wages };
  });
  const receive = invoices?.reduce((s, i) => s + Math.max(0, (i.netReceivablePaise ?? i.totals?.totalPaise ?? 0) - (i.paidPaise ?? 0)), 0);
  return (
    <div className="grid grid-2 dash-pair" data-widget="receive-pay">
      <Link className="kpi kpi-link" href="/clients/" data-kpi="to-receive"><div className="label">{t("dash.toReceive")}</div><div className="value">{receive == null ? "…" : rupees(receive)}</div><div className="trend">{t("dash.toReceiveHint", { n: invoices?.length ?? 0 })}</div></Link>
      <Link className="kpi kpi-link" href="/labour/payout/" data-kpi="to-pay"><div className="label">{t("dash.toPay")}</div><div className="value">{pay ? rupees(pay.totalPaise + Math.max(0, pay.wagesPaise)) : "…"}</div><div className="trend">{pay ? t("dash.toPayHint", { bills: rupees(pay.totalPaise), wages: rupees(Math.max(0, pay.wagesPaise)) }) : ""}</div></Link>
    </div>
  );
}

export function PayThisWeek() {
  const { t } = useTranslation();
  const d = useDash();
  const data = useRead(`dash-week:${d.today}:${d.projectId}`, async (s) => {
    const credit = await fetchAll<Expense>(s, "expenses", { where: [{ field: "mode", op: "==", value: "credit" }, { field: "paidStatus", op: "==", value: "unpaid" }] }, 10);
    const ps = await scopeProjects(s, d);
    const cost = await s.getMany<CostRollup>("rollups", ps.map((p) => `p_${p.id}_all`));
    return { bills: payables(credit, d.today).dueThisWeekPaise, wages: cost.reduce((sum, c) => sum + (c?.wagesEarnedPaise ?? 0) - (c?.wagesExpensedPaise ?? 0), 0) };
  });
  return (
    <section className="card dash-card" aria-labelledby="week-title" data-widget="pay-week">
      <h2 className="card-title" id="week-title">{t("dash.payThisWeek")}</h2>
      {!data ? <Skeleton lines={2} /> : (
        <dl className="kv"><dt>{data.wages < 0 ? t("dash.wagesAhead") : t("dash.wagesDue")}</dt><dd><Link href="/labour/payout/">{rupees(Math.abs(data.wages))}</Link></dd><dt>{t("dash.billsDue")}</dt><dd>{rupees(data.bills)}</dd><dt><b>{t("dash.total")}</b></dt><dd><b>{rupees(Math.max(0, data.wages) + data.bills)}</b></dd></dl>
      )}
    </section>
  );
}

export function Balances() {
  const { t } = useTranslation();
  const accounts = useSmall<Account>("accounts");
  const b = accounts ? balances(accounts) : null;
  return (
    <section className="card dash-card" aria-labelledby="bal-title" data-widget="balances">
      <h2 className="card-title" id="bal-title">{t("dash.cashBank")}</h2>
      {!b ? <Skeleton lines={3} /> : <>
        <dl className="two-figures"><div><dt>{t("dash.cash")}</dt><dd className="big money">{rupees(b.cashPaise)}</dd></div><div><dt>{t("dash.bank")}</dt><dd className="big money">{rupees(b.bankPaise)}</dd></div></dl>
        <ul className="rank-list" style={{ marginTop: "var(--space-3)" }}>{b.list.map((a) => <li key={a.id}><span>{a.name}</span><span className="num">{rupees(a.balancePaise)}</span></li>)}</ul>
      </>}
    </section>
  );
}

export function SpendTracker() {
  const { t } = useTranslation();
  const d = useDash();
  const data = useRead(`dash-spend:${d.role}:${d.projectId}:${d.today}`, async (s) => {
    const m = monthKeyOf(d.today);
    const last = monthKeyOf(addDays(`${m}-01`, -1));
    const scope = d.projectId ? [{ field: "projectId", op: "==" as const, value: d.projectId }] : d.role === "pm" ? [{ field: "projectId", op: "in" as const, value: d.projectIds.slice(0, 30) }] : [];
    const todays = await fetchAll<Expense>(s, "expenses", { where: [...scope, { field: "date", op: "==", value: d.today }] }, 4);
    const [cm, lm] = await Promise.all([costFor(s, d, [m]), costFor(s, d, [last])]);
    return spendTracker(expenseFromRecords(todays, d.today, d.today), totalExpense(cm), totalExpense(lm));
  });
  return (
    <section className="card dash-card" aria-labelledby="spend-title" data-widget="spend">
      <h2 className="card-title" id="spend-title">{t("dash.spendTracker")}</h2>
      {!data ? <Skeleton lines={3} /> : (
        <dl className="kv"><dt>{t("dash.today")}</dt><dd>{rupees(data.todayPaise)}</dd><dt>{t("dash.thisMonth")}</dt><dd>{rupees(data.monthPaise)}</dd><dt>{t("dash.lastMonth")}</dt><dd>{rupees(data.lastMonthPaise)}</dd>
          {data.changeBp != null && <><dt>{t("dash.spendVs")}</dt><dd data-spend-change><span className={`trend-line${data.changeBp > 0 ? " tone-bad" : ""}`}>
            {data.changeBp !== 0 && <Icon name={data.changeBp > 0 ? "trend-up" : "trend-down"} size={16} />}
            {data.changeBp === 0 ? t("dash.spendSame") : t(data.changeBp > 0 ? "dash.spendUp" : "dash.spendDown", { pct: (Math.abs(data.changeBp) / 100).toFixed(1) })}</span></dd></>}</dl>
      )}
    </section>
  );
}

export function GstSnapshot() {
  const { t } = useTranslation();
  const k = useMoneyKpis(true);
  return (
    <section className="card dash-card" aria-labelledby="gst-title" data-widget="gst">
      <h2 className="card-title" id="gst-title">{t("dash.gst")}</h2>
      {!k ? <Skeleton lines={3} /> : (
        <dl className="kv"><dt>{t("dash.gstOut")}</dt><dd>{rupees(k.gstOut)}</dd><dt>{t("dash.gstIn")}</dt><dd>{rupees(k.gstIn)}</dd>{k.gstOut - k.gstIn >= 0
            ? <><dt><b>{t("dash.gstNet")}</b></dt><dd data-gst="to-pay"><b>{rupees(k.gstOut - k.gstIn)}</b></dd></>
            : <><dt><b>{t("dash.gstCredit")}</b></dt><dd data-gst="credit"><b>{rupees(k.gstIn - k.gstOut)}</b></dd></>}
          <dt>{t("dash.tdsDeducted")}</dt><dd>{rupees(k.tdsDeducted)}</dd><dt>{t("dash.tdsHeld")}</dt><dd>{rupees(k.tdsHeld)}</dd></dl>
      )}
      {k && k.gstOut < k.gstIn && <p className="muted small">{t("dash.gstCreditHint")}</p>}
      <p className="hint small"><Icon name="info" size={16} /><span>{t("dash.gstHint")}</span></p>
    </section>
  );
}

export function Approvals({ scope }: { scope: "finance" | "pm" }) {
  const { t } = useTranslation();
  const d = useDash();
  const limit = (useSmall<{ id: string; pmApprovalLimitPaise?: number }>("settings") ?? []).find((x) => x.id === "operations")?.pmApprovalLimitPaise ?? 2_500_000;
  const data = useRead(`dash-appr:${scope}:${d.uid}:${limit}`, async (s) => {
    const pending = [{ field: "approvalStatus", op: "==" as const, value: "pending" }];
    if (scope === "pm") {
      const mine = await s.count("expenses", [...pending, { field: "projectId", op: "in", value: d.projectIds.slice(0, 30) }, { field: "amountPaise", op: "<=", value: limit }]);
      return { expenses: mine, payments: 0, rates: 0 };
    }
    const [expenses, payments, rates] = await Promise.all([
      s.count("expenses", [...pending, { field: "isDeleted", op: "==", value: false }]),
      s.count("worker_payments", pending), s.count("rate_change_requests", pending),
    ]);
    return { expenses, payments, rates };
  });
  return (
    <section className="card dash-card" aria-labelledby="appr-title" data-widget="approvals">
      <h2 className="card-title" id="appr-title">{t("dash.approvals")}</h2>
      {!data ? <Skeleton lines={2} /> : (
        <ul className="rank-list">
          <li><span>{scope === "pm" ? t("dash.apprExpensesPm", { limit: rupees(limit) }) : t("dash.apprExpenses")}</span><b className="num">{data.expenses}</b></li>
          {scope === "finance" && <li><Link href="/labour/payments/">{t("dash.apprPayments")}</Link><b className="num">{data.payments}</b></li>}
          {scope === "finance" && <li><span>{t("dash.apprRates")}</span><b className="num">{data.rates}</b></li>}
        </ul>
      )}
    </section>
  );
}

export function Deadlines({ withFinance }: { withFinance: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const d = useDash();
  const data = useRead(`dash-dead:${d.role}:${d.uid}:${d.projectId}:${withFinance}`, async (s) => {
    const ps = await scopeProjects(s, d);
    const items: Omit<Deadline, "overdue" | "daysLeft">[] = [];
    for (const p of ps) {
      if (p.status !== "completed" && p.expectedEndDate) items.push({ kind: "project_end", date: p.expectedEndDate, label: p.name, projectId: p.id, href: `/projects/view/?id=${p.id}` });
      if (p.type === "government") {
        for (const e of await s.listSmall<{ status: string; requestedDate?: string; date?: string; reason?: string }>(`projects/${p.id}/eot_requests`)) {
          if (e.status === "applied" || e.status === "pending") items.push({ kind: "eot", date: e.date ?? e.requestedDate ?? d.today, label: p.name, projectId: p.id, href: `/projects/view/?id=${p.id}&tab=schedule` });
        }
      }
      if (withFinance) {
        const c = await s.get<{ government?: { pg?: { expiryDate?: string }; emd?: { refundDate?: string | null; status?: string } } }>(`projects/${p.id}/private`, "commercial");
        if (c?.government?.pg?.expiryDate) items.push({ kind: "guarantee", date: c.government.pg.expiryDate, label: p.name, projectId: p.id, href: `/projects/view/?id=${p.id}&tab=billing` });
        if (c?.government?.emd?.refundDate) items.push({ kind: "emd", date: c.government.emd.refundDate, label: p.name, projectId: p.id, href: `/projects/view/?id=${p.id}&tab=billing` });
        for (const m of await s.listSmall<{ name: string; dueDate?: string; status: string }>(`projects/${p.id}/project_milestones`)) {
          if (m.dueDate && m.status !== "paid") items.push({ kind: "milestone", date: m.dueDate, label: `${p.name}: ${m.name}`, projectId: p.id, href: `/projects/view/?id=${p.id}&tab=billing` });
        }
      }
    }
    return upcomingDeadlines(items, d.today, 45);
  });
  return (
    <section className="card dash-card" aria-labelledby="dl-title" data-widget="deadlines">
      <h2 className="card-title" id="dl-title">{t("dash.deadlines")}</h2>
      {!data ? <Skeleton lines={3} /> : data.length === 0 ? <p className="muted">{t("dash.noDeadlines")}</p> : (
        <ul className="deadline-list">{data.slice(0, 8).map((x, i) => (
          <li key={i} className={x.overdue ? "is-overdue" : ""}>
            <span className="dl-date">{date(x.date, lang)}</span>
            <Link href={x.href}>{t(`dash.dl.${x.kind}`)}: {x.label}</Link>
            <span className={`small ${x.overdue ? "tone-bad" : "muted"}`}>{x.overdue ? t("dash.overdueDays", { n: -x.daysLeft }) : t("dash.inDays", { n: x.daysLeft })}</span>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

/** Recent activity (§11.1 #11): the latest audit entries, payments, expenses and bills, newest first. Finance roles. */
export function Activity() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const data = useRead("dash-activity", async (s) => {
    const [audit, pays, exps, invs] = await Promise.all([
      s.query<{ id: string; entity: string; action: string; at: string; by: string }>("audit_log", { orderBy: [{ field: "at", dir: "desc" }], limit: 8 }),
      s.query<WorkerPayment>("worker_payments", { orderBy: [{ field: "date", dir: "desc" }], limit: 5 }),
      s.query<Expense>("expenses", { where: [{ field: "source", op: "==", value: "manual" }], orderBy: [{ field: "date", dir: "desc" }], limit: 5 }),
      s.query<Invoice>("invoices", { orderBy: [{ field: "date", dir: "desc" }], limit: 3 }),
    ]);
    const rows = [
      ...audit.items.map((a) => ({ key: a.id, at: a.at, text: t(`dash.act.${a.entity}_${a.action}`, { defaultValue: t("dash.act.change") }), href: "/" })),
      ...pays.items.map((p) => ({ key: p.id, at: p.date, text: t("dash.act.payment", { type: t(`payments.types.${p.type}`), name: p.workerName, amount: rupees(p.grossPaise) }), href: `/labour/workers/view/?id=${p.workerId}` })),
      ...exps.items.map((e) => ({ key: e.id, at: e.date, text: t("dash.act.expense", { what: e.description ?? "", amount: rupees(e.amountPaise), project: e.projectName ?? "" }), href: e.projectId ? `/projects/view/?id=${e.projectId}&tab=pnl` : "/" })),
      ...invs.items.map((i) => ({ key: i.id, at: i.date, text: t("dash.act.invoice", { number: i.number ?? t("status.draft"), client: i.clientName }), href: `/clients/view/?id=${i.clientId}` })),
    ];
    return rows.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10);
  });
  return (
    <section className="card dash-card" aria-labelledby="act-title" data-widget="activity">
      <h2 className="card-title" id="act-title">{t("dash.activity")}</h2>
      {!data ? <Skeleton lines={4} /> : (
        <ul className="activity-list">{data.map((r) => <li key={r.key}><span className="dl-date">{date(r.at.slice(0, 10), lang)}</span><Link href={r.href}>{r.text}</Link></li>)}</ul>
      )}
    </section>
  );
}

/** Contracts summary: thekedar contracts (finance). Client agreements and leads come with later modules: a plain empty state. */
export function ContractsSummary() {
  const { t } = useTranslation();
  const data = useRead("dash-contracts", async (s) => {
    const ks = await s.query<ThekedarContract>("thekedar_contracts", { where: [{ field: "status", op: "==", value: "active" }], orderBy: [{ field: "scope" }], limit: 20 });
    const ms = await Promise.all(ks.items.map((k) => s.query<{ id: string; valuePaise: number }>("contract_measurements", { where: [{ field: "contractId", op: "==", value: k.id }], orderBy: [{ field: "date" }], limit: 50 })));
    return ks.items.map((k, i) => ({ k, measured: ms[i]!.items.reduce((x, m) => x + m.valuePaise, 0) }));
  });
  return (
    <section className="card dash-card" aria-labelledby="ct-title" data-widget="contracts">
      <h2 className="card-title" id="ct-title">{t("dash.contracts")}</h2>
      {!data ? <Skeleton lines={2} /> : data.length === 0 ? <p className="muted">{t("contracts.none")}</p> : (
        <ul className="activity-list">{data.map(({ k, measured }) => (
          <li key={k.id}><Link href={`/labour/workers/view/?id=${k.thekedarId}`}><b>{k.thekedarName}</b>: {k.scope}</Link><span className="muted small">{t("dash.measuredOf", { done: rupees(measured), total: rupees(k.valuePaise) })}</span></li>
        ))}</ul>
      )}
      <p className="hint small"><Icon name="info" size={16} /><span>{t("dash.agreementsLater")}</span></p>
    </section>
  );
}

export function LeadPipeline() {
  const { t } = useTranslation();
  return (
    <section className="card dash-card" aria-labelledby="lead-title" data-widget="leads">
      <h2 className="card-title" id="lead-title">{t("dash.leads")}</h2>
      <EmptyState icon="contact" title={t("dash.leadsEmpty")} body={t("dash.leadsEmptyBody")} action={<Link className="btn btn-secondary btn-sm" href="/clients/">{t("nav.clients")}</Link>} />
    </section>
  );
}

/** A supervisor's site today (§11.1a): marked, present and absent, with no money anywhere. */
export function SiteToday() {
  const { t } = useTranslation();
  const d = useDash();
  const sites = useSiteAttendance();
  const pending = useRead(`dash-mine:${d.uid}`, (s) => s.count("expenses", [{ field: "enteredBy", op: "==", value: d.uid }, { field: "approvalStatus", op: "==", value: "pending" }, { field: "projectId", op: "in", value: d.projectIds.slice(0, 30) }]));
  return (
    <div className="grid" data-widget="site-today">
      {!sites ? <Skeleton lines={4} /> : sites.map((s) => (
        <section key={s.id} className="card dash-card site-today" aria-labelledby={`st-${s.id}`}>
          <h2 className="card-title" id={`st-${s.id}`}>{s.name}</h2>
          <div className="stat-grid st-stats">
            <div><b>{s.marked}/{s.roster}</b><span>{t("dash.marked")}</span></div>
            <div><b>{s.present}</b><span>{t("dash.present")}</span></div>
            <div><b>{s.half}</b><span>{t("dash.halfDay")}</span></div>
            <div><b>{s.absent}</b><span>{t("dash.absent")}</span></div>
          </div>
          <div className="page-actions" style={{ marginTop: "var(--space-4)" }}>
            <Link className={`btn ${s.marked < s.roster ? "btn-primary" : "btn-secondary"}`} href={`/labour/attendance/?site=${s.id}`}><Icon name="check" />{s.marked < s.roster ? t("dash.markAttendance", { n: s.roster - s.marked }) : t("dash.attendanceDone")}</Link>
            <Link className="btn btn-secondary" href={`/projects/view/?id=${s.id}&tab=workforce`}><Icon name="users" />{t("workforce.title")}</Link>
          </div>
          <dl className="kv small" style={{ marginTop: "var(--space-4)" }}>
            <dt>{t("projects.myPending")}</dt><dd>{pending ?? "…"}</dd>
            <dt>{t("projects.dpr")}</dt><dd>{t("common.comingSoon")}</dd>
          </dl>
        </section>
      ))}
    </div>
  );
}

