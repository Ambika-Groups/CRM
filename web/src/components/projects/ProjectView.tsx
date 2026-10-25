"use client";
import { useRouter } from "next/navigation";
import {
  canOpen, groupIndian, daysBetween, formatBp, formatQty, isFinanceReader, isFinanceRole, projectFigures, projectTabsFor, ROLE_LABELS, todayIST,
  type CostRollup, type FinanceRollup, type Project, type User,
} from "@ag/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ComingSoon, NoAccess, NotFoundRecord } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { ConfirmDialog, EmptyState, Skeleton, StatusBadge, useToast, MiniWrap } from "@/components/ui/feedback";
import { useCount, useDoc, useDocStatus, useRead, useRun, useSession, useSmall } from "@/data/DataProvider";
import { date, dash, money, phone, rupees } from "@/lib/fmt";
import { setParam, useParam } from "@/lib/params";
import { ChildEditor, type ChildField } from "./ChildEditor";
import { statusBadge } from "./ProjectsPage";
import { RosterTab } from "./RosterTab";
import { SiteWorkforce } from "@/components/labour/SiteWorkforce";

/** The 12 tabs of spec §5.5, in order. */
const TABS = ["overview", "workforce", "expenses", "materials", "machinery", "billing", "contracts", "documents", "dpr", "schedule", "photos", "pnl"] as const;
type Tab = (typeof TABS)[number];

type Row = Record<string, unknown> & { id: string };

export function ProjectView() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const id = useParam("id");
  const tabParam = useParam("tab");
  const [tab, setTab] = useState<Tab>("overview");
  useEffect(() => { if (tabParam && (TABS as readonly string[]).includes(tabParam)) setTab(tabParam as Tab); }, [tabParam]);
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const project = useDoc<Project>("projects", id);
  const status = useDocStatus("projects", id);
  const cost = useDoc<CostRollup>("rollups", id ? `p_${id}_all` : null);
  const finance = useDoc<FinanceRollup>("finance_rollups", id ? `p_${id}_all` : null);
  const budget = useDoc<{ budgetPaise: number }>(id ? `projects/${id}/private` : "none", id ? "budget" : null);
  const commercial = useDoc<{ contractValuePaise: number; government?: Record<string, unknown> }>(id ? `projects/${id}/private` : "none", id ? "commercial" : null);
  const users = useSmall<User>("users") ?? [];
  const [basis, setBasis] = useState<"received" | "billed">("received");
  const [confirm, setConfirm] = useState<null | "delete" | "archive">(null);
  // AC5.6-2: a project with expenses or invoices can only be archived, so the delete dialog says so up front.
  const linked = useRead(`project-linked:${id}:${session?.role}`, (s) => (id && session?.role === "owner"
    ? Promise.all([s.count("expenses", [{ field: "projectId", op: "==", value: id }]), s.count("invoices", [{ field: "projectId", op: "==", value: id }])]).then(([a, b]) => a + b)
    : Promise.resolve(0)));
  const [progress, setProgress] = useState<string>("");

  const role = session?.role;
  const finRead = !!role && isFinanceReader(role);
  const finWrite = !!role && isFinanceRole(role);
  const canProgress = !!role && (finWrite || role === "pm");

  if (session && !canOpen(session.role, "projects")) {
    return <AppShell nav="projects" title={t("projects.title")} crumbs={[{ label: t("nav.projects") }]}><NoAccess name={t("projects.title")} /></AppShell>;
  }
  if (id === undefined || project === undefined) return <AppShell nav="projects" title={t("projects.title")} crumbs={[{ label: t("nav.projects"), href: "/projects/" }]}><Skeleton lines={8} /></AppShell>;
  if (project === null) {
    return (
      <AppShell nav="projects" title={t("projects.title")} crumbs={[{ label: t("nav.projects"), href: "/projects/" }]}>
        {status === "denied" ? <NoAccess name={t("projects.title")} /> : status === undefined ? <Skeleton lines={4} />
          : <NotFoundRecord name={t("projects.title")} back="/projects/" backLabel={t("nav.projects")} />}
      </AppShell>
    );
  }

  const fig = projectFigures(cost ?? null, finRead ? finance ?? null : null, budget?.budgetPaise ?? null, commercial?.contractValuePaise ?? null, basis);
  const g = (project.government ?? {}) as Record<string, unknown> & { engineerInCharge?: { name?: string; phone?: string } };
  const r = (project.residential ?? {}) as Record<string, unknown>;
  const gc = (commercial?.government ?? {}) as Record<string, unknown> & { emd?: Record<string, unknown>; pg?: Record<string, unknown>; deductionHeads?: { head: string; rateBp: number }[] };
  const pgExpiry = gc.pg?.expiryDate as string | undefined;
  const pgDays = pgExpiry ? daysBetween(todayIST(), pgExpiry) : null;
  const team = users.filter((u) => project.assignedUsers.includes(u.id));
  const pick = (k: string) => ({ value: k, label: t(`projects.${k}`) });
  // Areas in Indian grouping with their unit (QA N8): 28,800 sq ft.
  const area = (n: unknown) => (typeof n === "number" ? `${groupIndian(n)} ${t("contracts.units.sqft")}` : "—");

  const changeTab = (x: Tab) => { setTab(x); setParam("tab", x); };
  // Only the tabs this role may open (QA F9); a restricted tab opened by URL says so in plain words.
  const allowedTabs = TABS.filter((x) => !!role && projectTabsFor(role).includes(x));
  const tabAllowed = allowedTabs.includes(tab);
  // Roles that can't read the cost totals see the site's day instead of false zeros (QA F10, §11.1a).
  const readsCost = cost !== null && cost !== undefined;

  return (
    <AppShell nav="projects" title={project.name} crumbs={[{ label: t("nav.projects"), href: "/projects/" }, { label: project.name }]}>
      <div className="page-head">
        <div className="heading">
          <h1>{project.name}</h1>
          <div className="facts">
            <span>{project.code}</span>
            <span><Icon name="building" size={16} />{t(`projects.${project.type}`)} · {t(`projects.${project.subtype}`)}</span>
            {project.city ? <span><Icon name="pin" size={16} />{[project.address, project.city].filter(Boolean).join(", ")}</span> : null}
            <span><Icon name="contact" size={16} />{finRead ? <Link href={`/clients/view/?id=${project.clientId}`}>{project.clientName}</Link> : project.clientName}</span>
            <StatusBadge kind={statusBadge(project)} />
          </div>
        </div>
        <div className="page-actions">
          {finWrite && <Link className="btn btn-secondary" href={`/projects/edit/?id=${project.id}`}><Icon name="edit" />{t("common.edit")}</Link>}
          {role === "owner" && (project.isArchived
            ? <Button onClick={async () => { await run("setArchived", { id: project.id, archived: false }); toast(t("projects.restored")); }}><Icon name="reset" />{t("common.restore")}</Button>
            : <Button onClick={() => setConfirm("archive")}><Icon name="archive" />{t("common.archive")}</Button>)}
          {role === "owner" && <Button variant="destructive" onClick={() => setConfirm("delete")}><Icon name="trash" />{t("common.delete")}</Button>}
        </div>
      </div>

      <nav className="tabs" aria-label={t("projects.title")}>
        {allowedTabs.map((x) => (
          <a key={x} href={`?id=${project.id}&tab=${x}`} aria-current={tab === x ? "page" : undefined} onClick={(e) => { e.preventDefault(); changeTab(x); }}>{t(`projects.tabs.${x}`)}</a>
        ))}
      </nav>

      {!tabAllowed && <NoAccess name={t(`projects.tabs.${tab}`)} heading={false} />}

      {tab === "overview" && tabAllowed && (
        <>
          {pgDays !== null && pgDays <= 60 && (
            <div className="banner warning" style={{ marginBottom: "var(--space-4)" }}><Icon name="alert" />
              <span className="text"><b>{t("projects.pg")}: {t("projects.pgExpiry")} {date(pgExpiry, lang)}.</b> {t("projects.pgHint")}</span></div>
          )}
          <div className="grid grid-3">
            {!readsCost && cost === null && <SiteDay project={project} />}
            {readsCost && role !== "viewer" && <WorkersToday project={project} />}
            {readsCost && <section className="card">
              <h2 className="card-title">{t("projects.spentOfBudget")}</h2>
              <div className="big money">{rupees(fig.spentPaise)}</div>
              {fig.budgetPaise != null && <>
                <p className="muted small">{t("projects.budget")}: {rupees(fig.budgetPaise)}{fig.budgetPaise ? ` (${Math.round((fig.spentPaise / fig.budgetPaise) * 100)}%)` : ""}</p>
                <div className="bar" style={{ marginTop: "var(--space-2)" }}><span style={{ width: `${Math.min(100, fig.budgetPaise ? (fig.spentPaise / fig.budgetPaise) * 100 : 0)}%` }} /></div>
              </>}
              <dl className="kv small" style={{ marginTop: "var(--space-4)" }}>
                {fig.budgetPaise != null && <><dt>{t("projects.leftInBudget")}</dt><dd>{rupees(fig.budgetPaise - fig.spentPaise)}</dd></>}
                <dt>{t("projects.wagesDue")}</dt><dd>{rupees(fig.wagesDuePaise)}</dd>
              </dl>
            </section>}
            {finRead && (
              <section className="card">
                <h2 className="card-title">{t("projects.billingCard")}</h2>
                <dl className="two-figures">
                  <div><dt>{t("projects.billed")}</dt><dd className="big money">{rupees(fig.billedPaise)}</dd></div>
                  <div><dt>{t("projects.received")}</dt><dd className="big money">{rupees(fig.receivedPaise)}</dd></div>
                </dl>
                <div className="bar" style={{ marginTop: "var(--space-2)" }}><span style={{ width: `${fig.billedPaise ? Math.min(100, ((fig.receivedPaise ?? 0) / fig.billedPaise) * 100) : 0}%` }} /></div>
                <dl className="kv small" style={{ marginTop: "var(--space-4)" }}>
                  <dt>{t("projects.contractValue")}</dt><dd>{rupees(fig.contractValuePaise)}</dd>
                  <dt>{t("projects.profit")}</dt><dd>{rupees(fig.profitPaise)}</dd>
                </dl>
              </section>
            )}
            <section className="card">
              <h2 className="card-title">{t("projects.progress")}</h2>
              <div className="big">{project.progressPct}%</div>
              <div className="bar progress" style={{ marginTop: "var(--space-2)" }}><span style={{ width: `${project.progressPct}%` }} /></div>
              {canProgress && (
                <form className="form-grid" style={{ marginTop: "var(--space-4)" }} onSubmit={async (e) => {
                  e.preventDefault();
                  const n = Number(progress);
                  try { await run("updateProgress", { id: project.id, progressPct: n, status: project.status }); toast(t("projects.progressSaved")); setProgress(""); }
                  catch (err) { toast(err instanceof Error ? err.message : String(err), "error"); }
                }}>
                  <label className="field"><span>{t("projects.updateProgress")} (%)</span>
                    <input className="input" inputMode="numeric" value={progress} placeholder={String(project.progressPct)} onChange={(e) => setProgress(e.target.value)} /></label>
                  <Button type="submit" disabled={progress === ""}>{t("common.save")}</Button>
                </form>
              )}
            </section>
          </div>
          <div className="grid grid-2-1 section">
            <section className="card">
              <h2 className="card-title">{t("projects.typeDetails")}</h2>
              {/* Only this project type's fields (AC5.6-1). */}
              {project.type === "government" ? (
                <dl className="dl-grid">
                  <div><dt>{t("projects.department")}</dt><dd>{dash(g.department)}</dd></div>
                  <div><dt>{t("projects.division")}</dt><dd>{dash(g.division)}</dd></div>
                  <div><dt>{t("projects.eic")}</dt><dd>{dash(g.engineerInCharge?.name)} {g.engineerInCharge?.phone && role !== "viewer" ? `· ${phone(g.engineerInCharge.phone)}` : ""}</dd></div>
                  <div><dt>{t("projects.tenderNo")}</dt><dd>{dash(g.tenderNo)}</dd></div>
                  <div><dt>{t("projects.nitRef")}</dt><dd>{dash(g.nitRef)}</dd></div>
                  <div><dt>{t("projects.workOrderNo")}</dt><dd>{dash(g.workOrderNo)} {g.workOrderDate ? `· ${date(g.workOrderDate as string, lang)}` : ""}</dd></div>
                  <div><dt>{t("projects.agreementNo")}</dt><dd>{dash(g.agreementNo)}</dd></div>
                  <div><dt>{t("projects.stipEnd")}</dt><dd>{date(g.stipulatedEndDate as string, lang)}</dd></div>
                </dl>
              ) : (
                <dl className="dl-grid">
                  <div><dt>{t("projects.units")}</dt><dd>{dash(r.units)}</dd></div>
                  <div><dt>{t("projects.floors")}</dt><dd>{dash(r.floors)}</dd></div>
                  <div><dt>{t("projects.builtUp")}</dt><dd>{area(r.builtUpAreaSqft)}</dd></div>
                  <div><dt>{t("projects.plotArea")}</dt><dd>{area(r.plotAreaSqft)}</dd></div>
                  <div><dt>{t("projects.reraNo")}</dt><dd>{dash(r.reraNo)} {r.reraValidity ? `· ${date(r.reraValidity as string, lang)}` : ""}</dd></div>
                  <div><dt>{t("projects.contractType")}</dt><dd>{r.contractType ? t(`projects.${r.contractType}`) : "—"}</dd></div>
                  <div><dt>{t("projects.dlp")}</dt><dd>{dash(r.defectLiabilityMonths)}</dd></div>
                  <div><dt>{t("projects.handover")}</dt><dd>{date(r.handoverDate as string, lang)}</dd></div>
                </dl>
              )}
            </section>
            <section className="card">
              <h2 className="card-title">{t("projects.team")}</h2>
              <ul className="list">
                <li><Icon name="users" /><div className="grow">{project.managerName ?? t("projects.notAssigned")}<div className="meta">{t("projects.manager")}</div></div></li>
                {team.filter((u) => u.id !== project.managerId).map((u) => (
                  <li key={u.id}><Icon name="users" /><div className="grow">{u.name}<div className="meta">{ROLE_LABELS[u.role][lang]}</div></div></li>
                ))}
              </ul>
              <dl className="kv small" style={{ marginTop: "var(--space-4)" }}>
                <dt>{t("projects.startDate")}</dt><dd>{date(project.startDate, lang)}</dd>
                <dt>{t("projects.expectedEndDate")}</dt><dd>{date(project.expectedEndDate, lang)}</dd>
                {project.actualEndDate ? <><dt>{t("projects.actualEndDate")}</dt><dd>{date(project.actualEndDate, lang)}</dd></> : null}
              </dl>
            </section>
          </div>
        </>
      )}

      {tab === "workforce" && tabAllowed && <div className="grid"><SiteWorkforce project={project} /><RosterTab project={project} /></div>}

      {tab === "billing" && tabAllowed && (finRead
        ? <BillingTab project={project} gc={gc} finWrite={finWrite} pick={pick} />
        : <EmptyState icon="lock" title={t("module.noAccess")} body={t("projects.pnlFinanceOnly")} />)}

      {tab === "documents" && tabAllowed && <DocumentsTab project={project} canWrite={finWrite || role === "pm"} pick={pick} />}

      {tab === "schedule" && tabAllowed && <ScheduleTab project={project} canWrite={finWrite || role === "pm"} canApprove={finWrite} finRead={finRead} />}

      {tab === "pnl" && tabAllowed && (finRead ? (
        <section className="card">
          <h2 className="card-title">{t("projects.tabs.pnl")}</h2>
          <div className="toggle-row" role="group" aria-label={t("projects.profitBasis")}>
            <button type="button" aria-pressed={basis === "received"} onClick={() => setBasis("received")}>{t("projects.onReceived")}</button>
            <button type="button" aria-pressed={basis === "billed"} onClick={() => setBasis("billed")}>{t("projects.onBilled")}</button>
          </div>
          <dl className="kv" style={{ marginTop: "var(--space-4)", maxWidth: 520 }}>
            <dt>{basis === "received" ? t("projects.received") : t("projects.billed")}</dt><dd>{money(basis === "received" ? fig.receivedPaise : fig.billedPaise)}</dd>
            <dt>{t("projects.spent")}</dt><dd>−{money(fig.spentPaise)}</dd>
            <dt className="total">{t("projects.profit")}</dt><dd className="total" data-profit>{money(fig.profitPaise)}</dd>
          </dl>
          <p className="hint"><Icon name="info" size={16} /><span>{t("projects.profitHint", { basis: basis === "received" ? t("projects.onReceived") : t("projects.onBilled") })}</span></p>
        </section>
      ) : <EmptyState icon="lock" title={t("module.noAccess")} body={t("projects.pnlFinanceOnly")} />)}

      {(["expenses", "materials", "machinery", "contracts", "dpr", "photos"] as const).includes(tab as never) && tabAllowed && <ComingSoon name={t(`projects.tabs.${tab}`)} />}

      {linked ? (
        <ConfirmDialog open={confirm === "delete"} onOpenChange={(o) => !o && setConfirm(null)} destructive={false}
          title={t("projects.cantDeleteTitle", { name: project.name })} body={t("projects.cantDeleteBody")} confirmLabel={t("common.archive")}
          onConfirm={async () => { await run("setArchived", { id: project.id, archived: true }); toast(t("projects.archived")); }} />
      ) : <ConfirmDialog open={confirm === "delete"} onOpenChange={(o) => !o && setConfirm(null)}
        title={t("projects.deleteTitle", { name: project.name })} body={t("projects.deleteBody")} confirmLabel={t("common.delete")}
        onConfirm={async () => {
          try { await run("deleteProject", { id: project.id }); toast(t("projects.deleted")); router.push("/projects/"); }
          catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
        }} />}
      <ConfirmDialog open={confirm === "archive"} onOpenChange={(o) => !o && setConfirm(null)}
        title={t("projects.archiveTitle", { name: project.name })} body={t("projects.archiveBody")} confirmLabel={t("common.archive")}
        onConfirm={async () => { await run("setArchived", { id: project.id, archived: true }); toast(t("projects.archived")); }} />
    </AppShell>
  );
}

function BillingTab({ project, gc, finWrite, pick }: { project: Project; gc: Record<string, unknown> & { emd?: Record<string, unknown>; pg?: Record<string, unknown>; deductionHeads?: { head: string; rateBp: number }[] }; finWrite: boolean; pick: (k: string) => { value: string; label: string } }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const milestones = (useSmall<Row>(`projects/${project.id}/project_milestones`) ?? []).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
  const units = (useSmall<Row>(project.type === "residential" ? `projects/${project.id}/project_units` : null) ?? []).sort((a, b) => String(a.unitNo).localeCompare(String(b.unitNo), "en", { numeric: true }));
  const boq = (useSmall<Row>(project.type === "government" ? `projects/${project.id}/boq_items` : null) ?? []).sort((a, b) => String(a.itemNo).localeCompare(String(b.itemNo), "en", { numeric: true }));
  const rates = useSmall<Row>(project.type === "government" ? `projects/${project.id}/boq_rates` : null) ?? [];
  const msFields: ChildField[] = [
    { key: "name", label: t("projects.stage"), kind: "text" }, { key: "pctBp", label: `${t("projects.share")} (%)`, kind: "pct" },
    { key: "amountPaise", label: t("projects.amount"), kind: "money" }, { key: "dueDate", label: t("projects.due"), kind: "date" },
    { key: "status", label: t("projects.status"), kind: "select", options: ["pending", "invoiced", "paid"].map(pick) },
  ];
  const unitFields: ChildField[] = [
    { key: "unitNo", label: t("projects.unitNo"), kind: "text" }, { key: "floor", label: t("projects.floor"), kind: "int" },
    { key: "areaSqft", label: t("projects.area"), kind: "int" }, { key: "pricePaise", label: t("projects.price"), kind: "money" },
    { key: "status", label: t("projects.status"), kind: "select", options: ["available", "booked", "sold", "handed_over"].map(pick) },
  ];
  return (
    <div className="grid">
      {project.type === "residential" && <section className="card">
        <h2 className="card-title">{t("projects.milestones")}
          {finWrite && <span className="aside"><ChildEditor projectId={project.id} kind="project_milestones" fields={msFields} title={t("projects.addMilestone")} saved={t("form.saved")}
            extra={{ sortOrder: milestones.length + 1 }} trigger={<Button size="sm"><Icon name="plus" />{t("projects.addMilestone")}</Button>} /></span>}
        </h2>
        {milestones.length === 0 ? <EmptyState title={t("common.none")} /> : (
          <MiniWrap label={t("projects.milestones")}><table className="mini-table">
            <thead><tr><th>{t("projects.stage")}</th><th className="num">{t("projects.share")}</th><th className="num">{t("projects.amount")}</th><th>{t("projects.due")}</th><th>{t("projects.status")}</th>{finWrite && <th><span className="sr-only">{t("table.actions")}</span></th>}</tr></thead>
            <tbody>{milestones.map((m) => (
              <tr key={m.id}><td>{String(m.name)}</td><td className="num">{formatBp(Number(m.pctBp))}</td><td className="num">{money(Number(m.amountPaise))}</td>
                <td>{date(m.dueDate as string, lang)}</td>
                <td><StatusBadge kind={m.status === "paid" ? "paid" : m.status === "invoiced" ? "partially_paid" : "draft"} /></td>
                {finWrite && <td><ChildEditor projectId={project.id} kind="project_milestones" fields={msFields} title={t("common.edit")} saved={t("form.saved")} initial={m}
                  trigger={<Button size="sm" variant="text" aria-label={`${t("common.edit")} ${String(m.name)}`}><Icon name="edit" size={16} /></Button>} /></td>}
              </tr>))}</tbody>
          </table></MiniWrap>
        )}
      </section>}

      {project.type === "residential" && (
        <section className="card">
          <h2 className="card-title">{t("projects.unitsList")} ({units.length})
            {finWrite && <span className="aside"><ChildEditor projectId={project.id} kind="project_units" fields={unitFields} title={t("projects.addUnit")} saved={t("form.saved")}
              trigger={<Button size="sm"><Icon name="plus" />{t("projects.addUnit")}</Button>} /></span>}
          </h2>
          {units.length === 0 ? <EmptyState title={t("common.none")} /> : (
            <MiniWrap label={t("projects.unitsList")}><table className="mini-table">
              <thead><tr><th>{t("projects.unitNo")}</th><th className="num">{t("projects.floor")}</th><th className="num">{t("projects.area")}</th><th className="num">{t("projects.price")}</th><th>{t("projects.status")}</th><th>{t("projects.customer")}</th></tr></thead>
              <tbody>{units.map((u) => (
                <tr key={u.id}><td>{String(u.unitNo)}</td><td className="num">{dash(u.floor)}</td><td className="num">{dash(u.areaSqft)}</td><td className="num">{money(u.pricePaise as number)}</td>
                  <td>{t(`projects.${u.status}`)}</td><td>{dash(u.customerName)}</td></tr>))}</tbody>
            </table></MiniWrap>
          )}
        </section>
      )}

      {project.type === "government" && (
        <>
          <section className="card">
            <h2 className="card-title">{t("projects.boq")}</h2>
            <p className="hint"><Icon name="info" size={16} /><span>{t("projects.boqHint")}</span></p>
            <MiniWrap label={t("projects.boq")}><table className="mini-table">
              <thead><tr><th>#</th><th>{t("projects.item")}</th><th>{t("projects.unit")}</th><th className="num">{t("projects.qty")}</th><th className="num">{t("projects.itemRate")}</th><th className="num">{t("projects.amount")}</th></tr></thead>
              <tbody>{boq.map((b) => { const rt = rates.find((x) => x.id === b.id); return (
                <tr key={b.id}><td>{String(b.itemNo)}</td><td>{String(b.description)}</td><td>{String(b.unit)}</td><td className="num">{formatQty(Number(b.qtyMilli))}</td>
                  <td className="num">{money(rt?.ratePaise as number)}</td><td className="num">{money(rt?.amountPaise as number)}</td></tr>); })}</tbody>
            </table></MiniWrap>
          </section>
          <section className="card">
            <h2 className="card-title">{t("projects.contractInfo")}</h2>
            <dl className="dl-grid three">
              <div><dt>{t("projects.agreementValue")}</dt><dd>{money(gc.agreementValuePaise as number)}</dd></div>
              <div><dt>{t("projects.premium")}</dt><dd>{gc.tenderPremiumBp != null ? formatBp(Number(gc.tenderPremiumBp)) : "—"}</dd></div>
              <div><dt>{t("projects.emdAmount")}</dt><dd>{money(gc.emd?.amountPaise as number)} {gc.emd?.mode ? `· ${t(`projects.${gc.emd.mode}`)}` : ""}</dd></div>
              <div><dt>{t("projects.emdStatus")}</dt><dd>{gc.emd?.status ? t(`projects.${gc.emd.status}`) : "—"}</dd></div>
              <div><dt>{t("projects.emdRef")}</dt><dd>{dash(gc.emd?.reference)}</dd></div>
              <div><dt>{t("projects.sd")}</dt><dd>{money(gc.securityDepositPaise as number)}</dd></div>
              <div><dt>{t("projects.pg")}</dt><dd>{money(gc.pg?.amountPaise as number)} {gc.pg?.bank ? `· ${String(gc.pg.bank)}` : ""}</dd></div>
              <div><dt>{t("projects.pgNumber")}</dt><dd>{dash(gc.pg?.number)}</dd></div>
              <div><dt>{t("projects.pgExpiry")}</dt><dd>{date(gc.pg?.expiryDate as string, lang)}</dd></div>
            </dl>
            <p className="hint"><Icon name="info" size={16} /><span>{t("projects.emdHint")} {t("projects.pgHint")} {t("projects.emdLater")}</span></p>
            <h3 className="card-title" style={{ marginTop: "var(--space-6)" }}>{t("projects.deductions")}</h3>
            <ul className="list">{(gc.deductionHeads ?? []).map((d) => <li key={d.head}><span className="grow">{d.head}</span><span className="num">{formatBp(d.rateBp)}</span></li>)}</ul>
            <p className="hint"><Icon name="info" size={16} /><span>{t("projects.raLater")}</span></p>
          </section>
        </>
      )}
    </div>
  );
}

function DocumentsTab({ project, canWrite, pick }: { project: Project; canWrite: boolean; pick: (k: string) => { value: string; label: string } }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const approvals = useSmall<Row>(project.type === "residential" ? `projects/${project.id}/project_approvals` : null) ?? [];
  const fields: ChildField[] = [
    { key: "kind", label: t("projects.kind"), kind: "select", options: ["map", "noc", "electricity", "water", "rera"].map(pick) },
    { key: "status", label: t("projects.status"), kind: "select", options: ["pending", "applied", "approved", "rejected"].map(pick) },
    { key: "appliedDate", label: t("projects.applied"), kind: "date" }, { key: "approvedDate", label: t("projects.approved"), kind: "date" },
    { key: "expiryDate", label: t("projects.expires"), kind: "date" },
  ];
  if (project.type !== "residential") return <ComingSoon name={t("projects.tabs.documents")} />;
  return (
    <section className="card">
      <h2 className="card-title">{t("projects.approvals")}
        {canWrite && <span className="aside"><ChildEditor projectId={project.id} kind="project_approvals" fields={fields} title={t("projects.addApproval")} saved={t("form.saved")}
          trigger={<Button size="sm"><Icon name="plus" />{t("projects.addApproval")}</Button>} /></span>}
      </h2>
      <p className="hint"><Icon name="info" size={16} /><span>{t("projects.approvalsHint")}</span></p>
      {approvals.length === 0 ? <EmptyState title={t("common.none")} /> : (
        <MiniWrap label={t("projects.approvals")}><table className="mini-table">
          <thead><tr><th>{t("projects.kind")}</th><th>{t("projects.status")}</th><th>{t("projects.applied")}</th><th>{t("projects.approved")}</th><th>{t("projects.expires")}</th></tr></thead>
          <tbody>{approvals.map((a) => (
            <tr key={a.id}><td>{t(`projects.${a.kind}`, { defaultValue: String(a.kind) })}</td>
              <td><StatusBadge kind={a.status === "approved" ? "completed" : a.status === "rejected" ? "cancelled" : "pending_approval"} /></td>
              <td>{date(a.appliedDate as string, lang)}</td><td>{date(a.approvedDate as string, lang)}</td><td>{date(a.expiryDate as string, lang)}</td></tr>))}</tbody>
        </table></MiniWrap>
      )}
    </section>
  );
}

function ScheduleTab({ project, canWrite, canApprove, finRead }: { project: Project; canWrite: boolean; canApprove: boolean; finRead: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const run = useRun();
  const toast = useToast();
  const gov = project.type === "government";
  const eots = useSmall<Row>(gov ? `projects/${project.id}/eot_requests` : null) ?? [];
  const hind = useSmall<Row>(gov ? `projects/${project.id}/hindrance_register` : null) ?? [];
  const mb = useSmall<Row>(gov ? `projects/${project.id}/boq_items` : null) ?? [];
  const milestones = (useSmall<Row>(!gov && finRead ? `projects/${project.id}/project_milestones` : null) ?? []).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
  const g = (project.government ?? {}) as Record<string, unknown>;
  const eotFields: ChildField[] = [
    { key: "reason", label: t("projects.reason"), kind: "text" }, { key: "appliedDate", label: t("projects.applied"), kind: "date" },
    { key: "periodRequestedDays", label: t("projects.requested"), kind: "int" },
  ];
  const hFields: ChildField[] = [
    { key: "type", label: t("projects.kind"), kind: "select", options: ["site_not_handed", "drawings_delayed", "rain", "payment_delay", "scope_change", "other"].map((k) => ({ value: k, label: k.replace(/_/g, " ") })) },
    { key: "fromDate", label: t("projects.from"), kind: "date" }, { key: "toDate", label: t("projects.to"), kind: "date" }, { key: "notes", label: t("projects.remarks"), kind: "text" },
  ];
  const mbFields: ChildField[] = [
    { key: "boqItemId", label: t("projects.item"), kind: "select", options: mb.map((b) => ({ value: b.id, label: `${String(b.itemNo)}. ${String(b.description)}` })) },
    { key: "date", label: t("projects.date"), kind: "date" }, { key: "qtyMilli", label: t("projects.qty"), kind: "qty" }, { key: "mbPage", label: t("projects.mbPage"), kind: "text" },
    { key: "remarks", label: t("projects.remarks"), kind: "text" },
  ];
  return (
    <div className="grid">
      <section className="card">
        <h2 className="card-title">{t("projects.tabs.schedule")}</h2>
        <dl className="dl-grid three">
          <div><dt>{t("projects.startDate")}</dt><dd>{date(project.startDate, lang)}</dd></div>
          <div><dt>{t("projects.expectedEndDate")}</dt><dd>{date(project.expectedEndDate, lang)}</dd></div>
          <div><dt>{t("projects.actualEndDate")}</dt><dd>{date(project.actualEndDate ?? "", lang)}</dd></div>
          {gov && <><div><dt>{t("projects.stipStart")}</dt><dd>{date(g.stipulatedStartDate as string, lang)}</dd></div>
            <div><dt>{t("projects.stipEnd")}</dt><dd>{date(g.stipulatedEndDate as string, lang)}</dd></div>
            <div><dt>{t("projects.finalBill")}</dt><dd>{date(g.finalBillDate as string, lang)}</dd></div>
            <div><dt>{t("projects.completionCert")}</dt><dd>{date(g.completionCertificateDate as string, lang)}</dd></div></>}
        </dl>
      </section>
      {!gov && finRead && (
        <section className="card">
          <h2 className="card-title">{t("projects.milestones")}</h2>
          <ul className="list">{milestones.map((m) => <li key={m.id}><span className="grow">{String(m.name)}</span><span className="muted small">{date(m.dueDate as string, lang)}</span></li>)}</ul>
        </section>
      )}
      {gov && (
        <>
          <section className="card">
            <h2 className="card-title">{t("projects.eot")}
              {canWrite && <span className="aside"><ChildEditor projectId={project.id} kind="eot_requests" fields={eotFields} title={t("projects.addEot")} saved={t("form.saved")}
                extra={{ status: "applied" }} trigger={<Button size="sm"><Icon name="plus" />{t("projects.addEot")}</Button>} /></span>}
            </h2>
            <p className="hint"><Icon name="info" size={16} /><span>{t("projects.eotHint")}</span></p>
            <MiniWrap label={t("projects.eot")}><table className="mini-table">
              <thead><tr><th>{t("projects.reason")}</th><th>{t("projects.applied")}</th><th className="num">{t("projects.requested")}</th><th className="num">{t("projects.approvedDays")}</th><th>{t("projects.status")}</th><th><span className="sr-only">{t("table.actions")}</span></th></tr></thead>
              <tbody>{eots.map((e) => (
                <tr key={e.id}><td>{String(e.reason)}</td><td>{date(e.appliedDate as string, lang)}</td><td className="num">{dash(e.periodRequestedDays)}</td><td className="num">{dash(e.periodApprovedDays)}</td>
                  <td><StatusBadge kind={e.status === "approved" ? "completed" : e.status === "rejected" ? "cancelled" : "pending_approval"} /></td>
                  <td>{canApprove && e.status !== "approved" && e.status !== "rejected" && (
                    <Button size="sm" onClick={async () => {
                      try { await run("approveEot", { projectId: project.id, eotId: e.id, approvedDays: Number(e.periodRequestedDays) }); toast(t("projects.eotApproved")); }
                      catch (err) { toast(err instanceof Error ? err.message : String(err), "error"); }
                    }}>{t("projects.approveEot")}</Button>)}</td></tr>))}</tbody>
            </table></MiniWrap>
          </section>
          <section className="card">
            <h2 className="card-title">{t("projects.hindrance")}
              {canWrite && <span className="aside"><ChildEditor projectId={project.id} kind="hindrance_register" fields={hFields} title={t("projects.addHindrance")} saved={t("form.saved")}
                trigger={<Button size="sm"><Icon name="plus" />{t("projects.addHindrance")}</Button>} /></span>}
            </h2>
            <ul className="list">{hind.map((h) => <li key={h.id}><span className="grow">{String(h.type).replace(/_/g, " ")}{h.notes ? ` · ${String(h.notes)}` : ""}</span><span className="muted small">{date(h.fromDate as string, lang)} – {date(h.toDate as string, lang)}</span></li>)}</ul>
          </section>
          <MbSection project={project} canWrite={canWrite} fields={mbFields} />
        </>
      )}
    </div>
  );
}

/** Measurement Book: paged (MB entries grow over the life of a project, so they aren't read whole). */
function MbSection({ project, canWrite, fields }: { project: Project; canWrite: boolean; fields: ChildField[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  return (
    <section className="card">
      <h2 className="card-title">{t("projects.mb")}
        {canWrite && <span className="aside"><ChildEditor projectId={project.id} kind="measurement_book" fields={fields} title={t("projects.addMb")} saved={t("form.saved")}
          trigger={<Button size="sm"><Icon name="plus" />{t("projects.addMb")}</Button>} /></span>}
      </h2>
      <p className="hint"><Icon name="info" size={16} /><span>{t("projects.mbHint")}</span></p>
      <DataTable<Row> id={`mb-${project.id}`} collection={`projects/${project.id}/measurement_book`} caption={t("projects.mb")} exportName={`mb-${project.code}`}
        searchable={false} defaultSort={{ field: "date", dir: "desc" }}
        columns={[
          { key: "date", header: t("projects.date"), cell: (m) => date(m.date as string, lang), csv: (m) => String(m.date), sortField: "date", cardHead: true },
          { key: "item", header: t("projects.item"), cell: (m) => String(m.boqItemName ?? m.boqItemId) },
          { key: "qty", header: t("projects.qty"), cell: (m) => formatQty(Number(m.qtyMilli)), align: "right" },
          { key: "page", header: t("projects.mbPage"), cell: (m) => String(m.mbPage) },
          { key: "remarks", header: t("projects.remarks"), cell: (m) => String(m.remarks ?? "—") },
        ]}
        empty={{ title: t("common.none") }} />
    </section>
  );
}

/** What a supervisor's project page shows instead of money: the site's day (§11.1a "supervisor sees only today's site"). */
function SiteDay({ project }: { project: Project }) {
  const { t } = useTranslation();
  const session = useSession();
  const today = todayIST();
  const present = useCount("attendance", [{ field: "projectId", op: "==", value: project.id }, { field: "date", op: "==", value: today }, { field: "status", op: "in", value: ["present", "half_day", "overtime"] }]);
  const marked = useCount("attendance", [{ field: "projectId", op: "==", value: project.id }, { field: "date", op: "==", value: today }]);
  const pending = useCount("expenses", [{ field: "projectId", op: "==", value: project.id }, { field: "enteredBy", op: "==", value: session?.uid ?? "" }, { field: "approvalStatus", op: "==", value: "pending" }]);
  return (
    <section className="card" data-site-day>
      <h2 className="card-title">{t("projects.siteDay")}</h2>
      <div className="big">{present ?? "…"}</div>
      <p className="muted small">{t("projects.presentToday", { marked: marked ?? 0 })}</p>
      <dl className="kv small" style={{ marginTop: "var(--space-4)" }}>
        <dt>{t("projects.myPending")}</dt><dd>{pending ?? "…"}</dd>
        <dt>{t("projects.dpr")}</dt><dd>{t("common.comingSoon")}</dd>
      </dl>
      <div className="page-actions" style={{ marginTop: "var(--space-4)" }}>
        <Link className="btn btn-secondary" href="/labour/attendance/"><Icon name="check" />{t("nav.attendance")}</Link>
      </div>
    </section>
  );
}

/** "Workers today" on the Overview (§5.5): how many are on site today, for staff who can read attendance (QA N4). */
function WorkersToday({ project }: { project: Project }) {
  const { t } = useTranslation();
  const today = todayIST();
  const present = useCount("attendance", [{ field: "projectId", op: "==", value: project.id }, { field: "date", op: "==", value: today }, { field: "status", op: "in", value: ["present", "half_day", "overtime"] }]);
  const marked = useCount("attendance", [{ field: "projectId", op: "==", value: project.id }, { field: "date", op: "==", value: today }]);
  return (
    <section className="card" data-workers-today>
      <h2 className="card-title">{t("projects.workersToday")}</h2>
      <div className="big">{present ?? "…"}</div>
      <p className="muted small">{marked ? t("projects.presentToday", { marked }) : t("workforce.notMarked")}</p>
      <div className="page-actions" style={{ marginTop: "var(--space-4)" }}>
        <Link className="btn btn-secondary" href={`/projects/view/?id=${project.id}&tab=workforce`}><Icon name="users" />{t("workforce.title")}</Link>
      </div>
    </section>
  );
}
