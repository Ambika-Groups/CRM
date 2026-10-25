"use client";
import { searchTerm, type Project, type RosterEntry, type Worker } from "@ag/core";
import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, EmptyState, Skeleton, useToast, MiniWrap } from "@/components/ui/feedback";
import { useRead, useRun, useSession, useSmall } from "@/data/DataProvider";
import { useRoleLabel } from "@/lib/roles";

/**
 * The site roster (D-33): who works on this site and appears on its attendance. Finance roles and the
 * assigned PM add or remove workers; supervisors see the list. Snapshots carry names and roles, never rates.
 */
export function RosterTab({ project }: { project: Project }) {
  const { t } = useTranslation();
  const roleLabel = useRoleLabel();
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const roster = useSmall<RosterEntry>(`projects/${project.id}/roster`);
  const canEdit = !!session && (session.role === "owner" || session.role === "accountant" || (session.role === "pm" && session.projectIds.includes(project.id)));
  const [q, setQ] = useState("");
  const [remove, setRemove] = useState<RosterEntry | null>(null);
  const term = searchTerm(q);
  const matches = useRead(`roster-search:${term}`, (s) => (canEdit && term
    ? s.query<Worker>("workers", { where: [{ field: "searchKeywords", op: "array-contains", value: term }, { field: "active", op: "==", value: true }], orderBy: [{ field: "name" }], limit: 25 })
    : Promise.resolve({ items: [] as Worker[], next: null, total: 0 })));

  const active = (roster ?? []).filter((r) => r.active).sort((a, b) => String(a.workerName).localeCompare(String(b.workerName)));
  const groups = new Map<string, RosterEntry[]>();
  for (const r of active) {
    const k = r.thekedarName ? `${t("workers.thekedar")}: ${r.thekedarName}` : t("workers.title");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const add = async (w: Worker) => {
    try { await run("setRoster", { projectId: project.id, workerId: w.id, active: true }); toast(t("projects.rosterAdded", { name: w.name })); setQ(""); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <div className="grid">
      <section className="card">
        <h2 className="card-title">{t("projects.roster")} ({active.length})</h2>
        <p className="hint"><Icon name="info" size={16} /><span>{t("projects.rosterHint")}</span></p>
        {canEdit && (
          <div className="field" style={{ margin: "var(--space-4) 0" }}>
            <label htmlFor="roster-add">{t("projects.addToSite")}</label>
            <input id="roster-add" className="input" type="search" value={q} placeholder={t("table.searchHint")} onChange={(e) => setQ(e.target.value)} />
            {term && matches && (
              <ul className="list card" style={{ padding: 0 }}>
                {matches.items.filter((w) => !w.isThekedar && !active.some((r) => r.id === w.id)).map((w) => (
                  <li key={w.id} style={{ padding: "var(--space-2) var(--space-3)", alignItems: "center" }}>
                    <span className="avatar" aria-hidden="true">{w.name.slice(0, 2).toUpperCase()}</span>
                    <span className="grow">{w.name}<span className="meta"> · {roleLabel(w.role)}{w.thekedarName ? ` · ${w.thekedarName}` : ""}</span></span>
                    <Button size="sm" onClick={() => void add(w)}><Icon name="plus" />{t("projects.addToSite")}</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {roster === undefined ? <Skeleton /> : active.length === 0 ? <EmptyState icon="users" title={t("projects.noRoster")} /> : (
          [...groups.entries()].map(([g, list]) => (
            <div key={g} style={{ marginTop: "var(--space-4)" }}>
              <h3 className="group-head">{g} <span className="muted">({list.length})</span></h3>
              <MiniWrap label={`${t("projects.roster")}: ${g}`}><table className="mini-table">
                <thead><tr><th>{t("workers.name")}</th><th>{t("workers.role")}</th><th>{t("workers.payType")}</th>{canEdit && <th><span className="sr-only">{t("table.actions")}</span></th>}</tr></thead>
                <tbody>{list.map((r) => (
                  <tr key={r.id}>
                    <td>{session?.role === "supervisor" ? r.workerName : <Link href={`/labour/workers/view/?id=${r.id}`}>{r.workerName}</Link>}</td>
                    <td>{roleLabel(r.workerRole)}</td><td>{r.payType ? t(`workers.${r.payType}`) : "—"}</td>
                    {canEdit && <td><Button size="sm" variant="text" onClick={() => setRemove(r)}>{t("projects.removeFromSite")}</Button></td>}
                  </tr>))}</tbody>
              </table></MiniWrap>
            </div>
          ))
        )}
      </section>
      <ConfirmDialog open={!!remove} onOpenChange={(o) => !o && setRemove(null)}
        title={`${t("projects.removeFromSite")}: ${remove?.workerName ?? ""}?`} body={t("projects.rosterHint")} confirmLabel={t("projects.removeFromSite")}
        onConfirm={async () => { if (remove) { await run("setRoster", { projectId: project.id, workerId: remove.id, active: false }); toast(t("projects.rosterRemoved", { name: remove.workerName })); } }} />
    </div>
  );
}
