"use client";
import { isFinanceRole, siteWorkforce, todayIST, type Attendance, type Project, type ProjectTerms, type RosterEntry, type WorkerBalance, type WorkerPay } from "@ag/core";
import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { EmptyState, MiniWrap, Skeleton } from "@/components/ui/feedback";
import { useRead, useSession, useSmall } from "@/data/DataProvider";
import { useRoleLabel } from "@/lib/roles";
import { fetchAll } from "@/lib/fetchAll";
import { money } from "@/lib/fmt";

/**
 * Site workforce view (spec §6.5): who is on site for a date and their status, with summary counts.
 * The rate, paid to date and balance due are shown to the owner and accountant only (D-32, D-45, QA F1);
 * the PM and supervisor see the list without money.
 */
export function SiteWorkforce({ project }: { project: Project }) {
  const { t } = useTranslation();
  const roleLabel = useRoleLabel();
  const session = useSession();
  const finance = !!session && isFinanceRole(session.role);
  const [day, setDay] = useState(todayIST());
  const roster = useSmall<RosterEntry>(`projects/${project.id}/roster`);
  const view = useRead(`workforce:${project.id}:${day}:${finance}:${roster?.length}`, async (s) => {
    if (!roster) return undefined;
    const att = await fetchAll<Attendance>(s, "attendance", { where: [{ field: "projectId", op: "==", value: project.id }, { field: "date", op: "==", value: day }] });
    if (!finance) return siteWorkforce(roster, att);
    const ids = roster.filter((r) => r.active).map((r) => r.id);
    const [bals, pays, terms] = await Promise.all([
      s.getMany<Partial<WorkerBalance>>("worker_balances", ids.map((id) => `${id}_${project.id}`)),
      Promise.all(ids.map((id) => s.get<WorkerPay>(`workers/${id}/private`, "pay"))),
      Promise.all(ids.map((id) => s.get<ProjectTerms>(`workers/${id}/project_terms`, project.id))),
    ]);
    return siteWorkforce(roster, att, {
      balances: Object.fromEntries(ids.map((id, i) => [id, bals[i] ?? {}])),
      rates: Object.fromEntries(ids.map((id, i) => [id, terms[i]?.ratePaise ?? pays[i]?.defaultRatePaise ?? null])),
    });
  });
  const s = view?.summary;
  return (
    <section className="card" aria-labelledby="workforce-title" data-workforce>
      <h2 className="card-title" id="workforce-title">{t("workforce.title")}
        <span className="aside"><label className="sr-only" htmlFor="wf-date">{t("attendance.date")}</label>
          <input id="wf-date" className="input input-sm" type="date" value={day} max={todayIST()} onChange={(e) => e.target.value && setDay(e.target.value)} /></span>
      </h2>
      {!view ? <Skeleton lines={5} /> : view.rows.length === 0 ? <EmptyState icon="users" title={t("projects.noRoster")} /> : (
        <>
          <div className="stat-grid wf-stats" data-summary>
            <div><b>{s!.present}</b><span>{t("workforce.present", { total: s!.total })}</span></div>
            <div><b>{s!.mistri}</b><span>{t("workforce.mistri")}</span></div>
            <div><b>{s!.labour}</b><span>{t("workforce.labour")}</span></div>
            <div><b>{s!.helpers}</b><span>{t("workforce.helpers")}</span></div>
            <div><b>{s!.viaThekedar}</b><span>{t("workforce.viaThekedar")}</span></div>
            <div><b>{s!.direct}</b><span>{t("workforce.direct")}</span></div>
          </div>
          {s!.marked === 0 && <p className="hint"><Icon name="info" size={16} /><span>{t("workforce.notMarked")} <Link href={`/labour/attendance/?site=${project.id}&date=${day}`}>{t("nav.attendance")}</Link></span></p>}
          <MiniWrap label={t("workforce.title")}><table className="mini-table">
            <thead><tr><th>{t("workers.name")}</th><th>{t("workers.role")}</th><th>{t("workers.payType")}</th><th>{t("workforce.today")}</th>
              {finance && <><th className="num">{t("workers.rate")}</th><th className="num">{t("workforce.paid")}</th><th className="num">{t("workforce.due")}</th></>}</tr></thead>
            <tbody>{view.rows.map((r) => (
              <tr key={r.workerId}>
                <td>{session?.role === "supervisor" ? r.name : <Link href={`/labour/workers/view/?id=${r.workerId}`}>{r.name}</Link>}{r.thekedarName && <span className="meta">{r.thekedarName}</span>}</td>
                <td>{roleLabel(r.role)}</td><td>{t(`workers.${r.payType}`)}</td>
                <td>{r.status ? <span className={`att-chip att-${r.status}`}>{t(`attendance.status_${r.status}`)}{r.status === "overtime" ? ` +${r.otHoursMilli / 1000}h` : ""}</span> : <span className="muted">{t("workforce.notMarkedShort")}</span>}</td>
                {finance && <><td className="num">{money(r.ratePaise)}</td><td className="num">{money(r.paidToDatePaise)}</td><td className="num">{r.thekedarName ? t("ledger.throughThekedar") : money(r.balanceDuePaise)}</td></>}
              </tr>
            ))}</tbody>
          </table></MiniWrap>
        </>
      )}
    </section>
  );
}
