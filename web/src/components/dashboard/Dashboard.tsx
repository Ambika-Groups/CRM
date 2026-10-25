"use client";
import { formatDateLong, formatMonth, isFinanceReader, monthKeyOf, todayIST, type PeriodKind, type Project } from "@ag/core";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { useData, useRead, useSession } from "@/data/DataProvider";
import type { DemoSource } from "@/data/demo/demoSource";
import { rupees } from "@/lib/fmt";

/** KPI money in the Indian short form (₹53.76 L, ₹1.33 Cr); the exact amount is in the title and for screen readers. */
function Money({ paise }: { paise: number | null | undefined }) {
  if (paise == null) return <>…</>;
  const r = Math.abs(paise) / 100;
  const sign = paise < 0 ? "−" : "";
  const short = r >= 1e7 ? `${sign}₹${(r / 1e7).toFixed(2)} Cr` : r >= 1e5 ? `${sign}₹${(r / 1e5).toFixed(2)} L` : rupees(paise);
  return <span title={rupees(paise)}><span aria-hidden="true">{short}</span><span className="sr-only">{rupees(paise)}</span></span>;
}
import { Later, openKpiGate, resetKpiGate } from "./Chart";
import { currentFy, DashContext, fyChoices, makePeriod, scopeProjects, useDash as useDashScope, type DashScope } from "./data";
import {
  Activity, Ageing, Approvals, AttendanceTrend, Balances, ContractsSummary, Deadlines, ExpenseDrill, GstSnapshot, IncomeExpense, Kpi, LeadPipeline,
  PayThisWeek, ProjectBars, ProjectOverview, ReceivePay, SiteToday, SpendTracker, TopProjects, useMoneyKpis, useOpenInvoices, useProjectCounts, WorkersTodayChart,
} from "./Widgets";

/** The period selector and global filters (§11.1a): today, week, month, FY, custom; one project; the FY. */
function PeriodBar({ kind, setKind, fy, setFy, custom, setCustom, projectId, setProjectId, projects, showPeriod = true }: {
  kind: PeriodKind; setKind: (k: PeriodKind) => void; fy: string; setFy: (f: string) => void; custom: { from: string; to: string };
  setCustom: (c: { from: string; to: string }) => void; projectId: string | null; setProjectId: (p: string | null) => void; projects: Project[]; showPeriod?: boolean;
}) {
  const { t } = useTranslation();
  const kinds: PeriodKind[] = ["today", "week", "month", "fy", "custom"];
  return (
    <div className="period-bar" role="group" aria-label={t("dash.filters")} data-period-bar>
      {showPeriod && (
        <div className="segmented" role="group" aria-label={t("dash.period")}>
          {kinds.map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} data-period={k}>{t(`dash.periods.${k}`)}</button>)}
        </div>
      )}
      {showPeriod && kind === "custom" && (
        <span className="period-custom">
          <label><span className="sr-only">{t("dash.from")}</span><input className="input input-sm" type="month" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} aria-label={t("dash.from")} /></label>
          <span aria-hidden="true">–</span>
          <label><span className="sr-only">{t("dash.to")}</span><input className="input input-sm" type="month" value={custom.to} max={todayIST().slice(0, 7)} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} aria-label={t("dash.to")} /></label>
        </span>
      )}
      <label className="filter-inline"><span>{t("dash.fy")}</span>
        <select className="select input-sm" value={fy} onChange={(e) => setFy(e.target.value)}>{fyChoices().map((f) => <option key={f} value={f}>{f}</option>)}</select>
      </label>
      {projects.length > 1 && (
        <label className="filter-inline"><span>{t("dash.project")}</span>
          <select className="select input-sm" value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)} data-project-filter>
            <option value="">{t("dash.allProjects")}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

/** The last day of a month (YYYY-MM), or today if that is earlier. */
function endOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const end = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  return end > todayIST() ? todayIST() : end;
}

function periodLabel(d: DashScope, t: (k: string, o?: Record<string, unknown>) => string, lang: "en" | "hi") {
  if (d.period.kind === "month") return formatMonth(monthKeyOf(d.today), lang);
  if (d.period.kind === "fy") return `${t("dash.fy")} ${d.fy}`;
  if (d.period.kind === "today") return formatDateLong(d.today, lang);
  return `${formatDateLong(d.period.from, lang)} – ${formatDateLong(d.period.to, lang)}`;
}

function ProjectKpis({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const c = useProjectCounts();
  return <>
    <Kpi id="active" label={t("dash.activeProjects")} value={c?.active ?? "…"} href="/projects/?f.status=in_progress" />
    <Kpi id="completed" label={t("dash.completed")} value={c?.completed ?? "…"} href="/projects/?f.status=completed" />
    <Kpi id="delayed" label={t("dash.delayed")} value={c?.delayed ?? "…"} tone={c?.delayed ? "bad" : undefined} href="/projects/?f.delayed=yes" />
    {children}
  </>;
}

function MoneyKpis({ billing, wages = true }: { billing: boolean; wages?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const ctx = useDashScope();
  // Outstanding needs the invoices themselves: owner, accountant and CA only (the viewer reads totals, D-42).
  const readsInvoices = billing && isFinanceReader(ctx.role);
  const k = useMoneyKpis(billing);
  useEffect(() => { if (k) openKpiGate(); }, [k]);
  const inv = useOpenInvoices(readsInvoices);
  const outstanding = inv?.reduce((s, i) => s + Math.max(0, (i.netReceivablePaise ?? i.totals?.totalPaise ?? 0) - (i.paidPaise ?? 0)), 0);
  const label = periodLabel(ctx, t, lang);
  return <>
    <Kpi id="expense" label={t("dash.totalExpense")} value={<Money paise={k?.expense} />} hint={label} href="#chart-expense" />
    {billing && <Kpi id="billed" label={t("dash.billed")} value={<Money paise={k?.billed} />} hint={label} href="/clients/" />}
    {billing && <Kpi id="received" label={t("dash.received")} value={<Money paise={k?.received} />} hint={label} href="/clients/" />}
    {readsInvoices && <Kpi id="outstanding" label={t("dash.outstanding")} value={<Money paise={outstanding} />} hint={t("dash.openBills", { n: inv?.length ?? 0 })} href="#chart-ageing" />}
    {billing && <Kpi id="net" label={t("dash.netProfit")} value={<Money paise={k?.net} />} tone={k && k.net < 0 ? "bad" : undefined} hint={t("dash.netHint")} href="/projects/" />}
    {wages && <Kpi id="wages" label={k && k.wages < 0 ? t("dash.wagesAhead") : t("dash.wagesDue")} value={<Money paise={k ? Math.abs(k.wages) : undefined} />} hint={t("dash.wagesHint")} href="/labour/payout/" />}
  </>;
}

/** Owner (§11.1): everything. */
function OwnerDashboard() {
  return <>
    <section className="kpis dash-kpis" aria-label="KPIs"><ProjectKpis /><MoneyKpis billing /></section>
    <Later eager placeholder="grid grid-2 dash-pair lazy-pair"><ReceivePay /></Later>
    <div className="dash-grid">
      <Later><ExpenseDrill /></Later><Later><IncomeExpense /></Later>
      <Later><ProjectBars withFinance /></Later><Later><Ageing /></Later>
      <Later><WorkersTodayChart /></Later><Later><AttendanceTrend /></Later>
    </div>
    <div className="dash-grid dash-grid-3">
      <Later><ProjectOverview withFinance /></Later><Later><Balances /></Later><Later><Approvals scope="finance" /></Later>
      <Later><SpendTracker /></Later><Later><PayThisWeek /></Later><Later><GstSnapshot /></Later>
      <Later><TopProjects /></Later><Later><Deadlines withFinance /></Later><Later><Activity /></Later>
      <Later><ContractsSummary /></Later><Later><LeadPipeline /></Later>
    </div>
  </>;
}

/** Accountant (§11.1a): money in and out, receivables ageing, GST, cash and bank, approvals, Books readiness. */
function AccountantDashboard() {
  const { t } = useTranslation();
  return <>
    <section className="kpis dash-kpis" aria-label="KPIs"><MoneyKpis billing /></section>
    <Later eager placeholder="grid grid-2 dash-pair lazy-pair"><ReceivePay /></Later>
    <div className="dash-grid">
      <Later><IncomeExpense /></Later><Later><Ageing /></Later>
      <Later><ExpenseDrill /></Later><Later><ProjectBars withFinance /></Later>
    </div>
    <div className="dash-grid dash-grid-3">
      <Later><Balances /></Later><Later><GstSnapshot /></Later><Later><Approvals scope="finance" /></Later>
      <Later><PayThisWeek /></Later><Later><SpendTracker /></Later><Later><Deadlines withFinance /></Later>
      <Later><Activity /></Later>
      <section className="card dash-card" data-widget="books"><h2 className="card-title">{t("dash.books")}</h2><p className="muted">{t("dash.booksSoon")}</p></section>
    </div>
  </>;
}

/** PM (§11.1a): their projects' progress, budget against spent (cost only, no billing), attendance, approvals, deadlines. */
function PmDashboard() {
  return <>
    <section className="kpis dash-kpis" aria-label="KPIs"><ProjectKpis /><MoneyKpis billing={false} /></section>
    <div className="dash-grid">
      <Later><ProjectBars withFinance={false} /></Later><Later><WorkersTodayChart /></Later>
      <Later><AttendanceTrend /></Later><Later><ExpenseDrill /></Later>
    </div>
    <div className="dash-grid dash-grid-3">
      <Later><ProjectOverview withFinance={false} /></Later><Later><Approvals scope="pm" /></Later><Later><Deadlines withFinance={false} /></Later>
      <Later><SpendTracker /></Later>
    </div>
  </>;
}

/** Supervisor (§11.1a): today's site only, with no ₹ anywhere. */
function SupervisorDashboard() {
  return <>
    <SiteToday />
    <div className="dash-grid"><Later><AttendanceTrend /></Later></div>
  </>;
}

/** Viewer (D-42): read-only totals and charts. */
function ViewerDashboard() {
  return <>
    <section className="kpis dash-kpis" aria-label="KPIs"><Later><ProjectKpis /></Later><Later><MoneyKpis billing wages={false} /></Later></section>
    <div className="dash-grid">
      <Later><ExpenseDrill /></Later><Later><IncomeExpense /></Later>
      <Later><ProjectBars withFinance={false} /></Later>
    </div>
  </>;
}

/** CA (D-43): read-only accounting totals and the exports. */
function CaDashboard() {
  const { t } = useTranslation();
  return <>
    <section className="kpis dash-kpis" aria-label="KPIs"><MoneyKpis billing wages={false} /></section>
    <div className="dash-grid">
      <Later><IncomeExpense /></Later><Later><Ageing /></Later>
      <Later><ExpenseDrill /></Later>
    </div>
    <div className="dash-grid dash-grid-3">
      <Later><GstSnapshot /></Later><Later><Balances /></Later>
      <section className="card dash-card" data-widget="exports">
        <h2 className="card-title">{t("dash.exports")}</h2>
        <p className="muted">{t("dash.exportsBody")}</p>
        <ul className="link-list"><li><a href="#chart-income">{t("dash.exportIncome")}</a></li><li><a href="#chart-expense">{t("dash.exportExpense")}</a></li><li><a href="#chart-ageing">{t("dash.exportAgeing")}</a></li></ul>
        <p className="hint small"><Later><Icon name="info" size={16} /></Later><span>{t("dash.caPackLater")}</span></p>
      </section>
    </div>
  </>;
}

/**
 * The home dashboard (spec §11.1, §11.1a): a designed dashboard per role, every figure computed from data that
 * role may read, from the rollups and counts (rule 9, under 3 s). Sample data is labelled in the demo.
 */
export function Dashboard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const { source } = useData();
  const session = useSession();
  const [kind, setKind] = useState<PeriodKind>("month");
  const [fy, setFy] = useState(currentFy());
  const [custom, setCustom] = useState({ from: todayIST().slice(0, 7), to: todayIST().slice(0, 7) });
  const [projectId, setProjectId] = useState<string | null>(null);
  // The supervisor has no money KPIs: their site card is the first screen, so the gate opens at once.
  useState(() => { resetKpiGate(); return null; });
  useEffect(() => { if (session?.role === "supervisor") openKpiGate(); }, [session?.role]);
  const scope = useMemo<DashScope | null>(() => (session ? {
    role: session.role, uid: session.uid, projectIds: session.projectIds, today: todayIST(), fy, projectId,
    period: makePeriod(kind, fy, kind === "custom" ? { from: `${custom.from}-01`, to: endOfMonth(custom.to) } : null),
  } : null), [session, kind, fy, custom, projectId]);
  const projects = useRead(`dash-projects:${session?.uid}`, (s) => (scope ? scopeProjects(s, { ...scope, projectId: null }) : Promise.resolve([] as Project[])));
  if (!session || !scope) return null;
  const role = session.role;
  const demo = source.mode === "demo" ? (source as DemoSource) : null;
  return (
    <DashContext.Provider value={scope}>
      <div className="page-head dash-head">
        <div className="heading">
          {demo && <span className="sample-tag">{t("common.sampleData")}</span>}
          <h1>{t("dash.title", { name: session.name.split(" ")[0] })}</h1>
          <p className="sub">{t(`dash.sub.${role}`)} · {periodLabel(scope, t, lang)}</p>
        </div>
      </div>
      {role !== "supervisor" && (
        <PeriodBar kind={kind} setKind={setKind} fy={fy} setFy={(f) => { setFy(f); setKind("fy"); }} custom={custom} setCustom={setCustom}
          projectId={projectId} setProjectId={setProjectId} projects={projects ?? []} />
      )}
      <div className={`dashboard dash-${role}`} data-dashboard={role}>
        {role === "owner" && <OwnerDashboard />}
        {role === "accountant" && <AccountantDashboard />}
        {role === "pm" && <PmDashboard />}
        {role === "supervisor" && <SupervisorDashboard />}
        {role === "viewer" && <ViewerDashboard />}
        {role === "ca" && <CaDashboard />}
      </div>
      {demo && (
        <p className="muted small dash-note"><Link href="/more/">{t("dash.aboutDemo")}</Link></p>
      )}
    </DashContext.Provider>
  );
}
