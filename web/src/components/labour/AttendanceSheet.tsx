"use client";
import { canOpen, dateRange, formatMonth, isFinanceRole, monthlySheet, todayIST, toCsv, weekday, type Attendance, type Project, type RosterEntry } from "@ag/core";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { EmptyState, MiniWrap, Skeleton, useToast } from "@/components/ui/feedback";
import { useRead, useSession, useSmall } from "@/data/DataProvider";
import { useRoleLabel } from "@/lib/roles";
import { fetchAll } from "@/lib/fetchAll";
import { setParam, useParam } from "@/lib/params";

const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** The monthly attendance sheet for a site (§6.3): a code per worker per day, totals, CSV export and print. No money. */
export function AttendanceSheet() {
  const { t, i18n } = useTranslation();
  const roleLabel = useRoleLabel();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const session = useSession();
  const toast = useToast();
  const month = useParam("month") ?? todayIST().slice(0, 7);
  const siteParam = useParam("site");
  const sites = useRead(`sheet-sites:${session?.uid}`, (s) => s.query<Project>("projects", {
    where: [{ field: "isArchived", op: "==", value: false }, ...(session && !isFinanceRole(session.role) ? [{ field: "assignedUsers", op: "array-contains" as const, value: session.uid }] : [])],
    orderBy: [{ field: "name" }], limit: 50,
  }));
  const siteId = siteParam || sites?.items[0]?.id || null;
  const project = sites?.items.find((p) => p.id === siteId);
  const roster = useSmall<RosterEntry>(siteId ? `projects/${siteId}/roster` : null);
  const records = useRead(`sheet:${siteId}:${month}`, (s) => (siteId
    ? fetchAll<Attendance>(s, "attendance", { where: [{ field: "projectId", op: "==", value: siteId }, { field: "monthKey", op: "==", value: month }] })
    : Promise.resolve([] as Attendance[])));
  const title = t("attendance.sheet");
  if (session && !canOpen(session.role, "labour")) return <AppShell nav="labour" title={title} crumbs={[{ label: title }]}><NoAccess name={title} /></AppShell>;

  const days = dateRange(`${month}-01`, lastDay(month));
  const rows = roster && records ? monthlySheet(roster.filter((r) => r.active), records) : undefined;
  const exportCsv = () => {
    if (!rows) return;
    const csv = toCsv([
      { header: t("workers.name"), value: (r: (typeof rows)[number]) => r.workerName },
      { header: t("workers.role"), value: (r) => roleLabel(r.role) },
      ...days.map((d) => ({ header: d, value: (r: (typeof rows)[number]) => r.days[d] ?? "" })),
      { header: t("attendance.status_present"), value: (r) => r.present },
      { header: t("attendance.status_half_day"), value: (r) => r.half },
      { header: t("attendance.status_absent"), value: (r) => r.absent },
      { header: t("attendance.status_leave"), value: (r) => r.leave },
      { header: t("attendance.otHours"), value: (r) => r.otHoursMilli / 1000 },
      { header: t("attendance.daysWorked"), value: (r) => r.daysWorked },
    ], rows);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `attendance-${project?.code ?? siteId}-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast(t("table.exported", { n: rows.length }));
  };

  return (
    <AppShell nav="labour" title={title} crumbs={[{ label: t("nav.labour"), href: "/labour/" }, { label: t("attendance.title"), href: `/labour/attendance/?site=${siteId ?? ""}` }, { label: title }]}>
      <div className="page-head">
        <div className="heading"><h1>{title}</h1>{project && <p className="sub">{project.name} · {formatMonth(month, lang)}</p>}</div>
        <div className="page-actions no-print">
          <Button variant="secondary" onClick={exportCsv} disabled={!rows?.length} data-export><Icon name="download" />{t("table.export")}</Button>
          <Button variant="secondary" onClick={() => window.print()}><Icon name="file-text" />{t("common.print")}</Button>
        </div>
      </div>
      <div className="att-controls no-print">
        <label className="field"><span>{t("attendance.site")}</span>
          <select className="select" value={siteId ?? ""} onChange={(e) => setParam("site", e.target.value)}>
            {(sites?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field"><span>{t("attendance.month")}</span>
          <input className="input" type="month" value={month} max={todayIST().slice(0, 7)} onChange={(e) => e.target.value && setParam("month", e.target.value)} />
        </label>
      </div>
      <p className="hint"><Icon name="info" size={16} /><span>{t("attendance.legend")}</span></p>
      {!rows ? <Skeleton lines={8} /> : rows.length === 0 ? <EmptyState icon="calendar" title={t("attendance.noneMonth")} /> : (
        <MiniWrap label={title}>
          <table className="mini-table sheet-table" data-sheet>
            <caption className="sr-only">{title}</caption>
            <thead><tr>
              <th scope="col" className="sticky-col">{t("workers.name")}</th>
              {days.map((d) => <th key={d} scope="col" className={weekday(d) === 0 ? "sun" : ""}>{Number(d.slice(8))}</th>)}
              <th scope="col" className="num">{t("attendance.short.present")}</th><th scope="col" className="num">{t("attendance.short.half_day")}</th>
              <th scope="col" className="num">{t("attendance.short.absent")}</th><th scope="col" className="num">{t("attendance.short.leave")}</th>
              <th scope="col" className="num">{t("attendance.otH")}</th><th scope="col" className="num">{t("attendance.daysWorked")}</th>
            </tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.workerId}>
                <th scope="row" className="sticky-col">{r.workerName}<span className="meta">{roleLabel(r.role)}</span></th>
                {days.map((d) => <td key={d} className={`code code-${r.days[d] ?? "none"}${weekday(d) === 0 ? " sun" : ""}`}>{r.days[d] ?? ""}</td>)}
                <td className="num">{r.present}</td><td className="num">{r.half}</td><td className="num">{r.absent}</td><td className="num">{r.leave}</td>
                <td className="num">{r.otHoursMilli / 1000}</td><td className="num"><b>{r.daysWorked}</b></td>
              </tr>
            ))}</tbody>
          </table>
        </MiniWrap>
      )}
      <p className="no-print" style={{ marginTop: "var(--space-4)" }}><Link href={`/labour/attendance/?site=${siteId ?? ""}`}>{t("attendance.backToMarking")}</Link></p>
    </AppShell>
  );
}
