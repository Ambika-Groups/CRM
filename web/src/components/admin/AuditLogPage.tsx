"use client";
// The activity log (PRD §3.1 rule 12): every change in plain words, newest first, one page at a time (rule 9), with
// filters for what, who and dates, and a link to the record. The owner, the accountant and the CA may read it
// (roles.ts canRead and firestore.rules); nobody can change it.
import { isFinanceReader, type User } from "@ag/core";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { toDate } from "@/components/ui/form";
import { usePaged, useSession, useSmall } from "@/data/DataProvider";
import { AUDIT_ENTITY_OPTIONS, auditHref, auditLine, auditQuery, auditWhen, type AuditRecord } from "./core";

interface Filters { entity: string; by: string; from: string; to: string }
const NONE: Filters = { entity: "", by: "", from: "", to: "" };
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const session = useSession();
  const [fl, setFl] = useState<Filters>(NONE);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFl((f) => ({ ...f, [k]: v }));
  const allowed = !!session && isFinanceReader(session.role);
  const users = useSmall<Pick<User, "id" | "name">>(allowed ? "users" : null);
  const from = toDate(fl.from), to = toDate(fl.to);
  const spec = useMemo(() => auditQuery({ entity: fl.entity, by: fl.by, from, to }), [fl.entity, fl.by, from, to]);
  const page = usePaged<AuditRecord>("audit_log", spec, 25, allowed);
  const names = useMemo(() => Object.fromEntries((users ?? []).map((u) => [u.id, u.name])), [users]);

  const title = t("admin.audit.title");
  const crumbs = [{ label: t("settings.title"), href: "/settings/" }, { label: title }];
  if (session && !allowed) return <AppShell nav="settings" title={title} crumbs={crumbs}><NoAccess name={title} /></AppShell>;

  const items = page.items;
  const filtered = Object.values(fl).some(Boolean);
  const first = (page.page - 1) * page.pageSize + 1;
  const last = first + (items?.length ?? 0) - 1;

  return (
    <AppShell nav="settings" title={title} crumbs={crumbs}>
      <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
      <p className="hint"><Icon name="lock" size={16} /><span>{t("admin.audit.hint")}</span></p>

      <section className="table-block section" aria-label={title}>
        <div className="table-tools" data-audit-filters>
          <label className="table-filter"><span className="sr-only">{t("admin.audit.what")}</span>
            <select className="input" value={fl.entity} onChange={(e) => set("entity", e.target.value)} data-filter="entity">
              <option value="">{t("admin.audit.what")}: {t("admin.audit.everything")}</option>
              {AUDIT_ENTITY_OPTIONS.map((e) => <option key={e} value={e}>{t(`admin.audit.entity.${e}`)}</option>)}
            </select></label>
          <label className="table-filter"><span className="sr-only">{t("admin.audit.who")}</span>
            <select className="input" value={fl.by} onChange={(e) => set("by", e.target.value)} data-filter="by">
              <option value="">{t("admin.audit.who")}: {t("admin.audit.everyone")}</option>
              {[...(users ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></label>
          <label className="table-filter admin-date"><span>{t("admin.audit.from")}</span>
            <input className="input" inputMode="numeric" placeholder="DD/MM/YYYY" value={fl.from} onChange={(e) => set("from", e.target.value)} data-filter="from" aria-invalid={!!fl.from && !isIso(from)} /></label>
          <label className="table-filter admin-date"><span>{t("admin.audit.to")}</span>
            <input className="input" inputMode="numeric" placeholder="DD/MM/YYYY" value={fl.to} onChange={(e) => set("to", e.target.value)} data-filter="to" aria-invalid={!!fl.to && !isIso(to)} /></label>
          {filtered && <span className="table-tools-end"><Button size="sm" onClick={() => setFl(NONE)} data-clear><Icon name="x" />{t("admin.audit.clear")}</Button></span>}
        </div>

        {page.error ? (
          <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{page.error}</span></div>
        ) : !allowed || items === undefined ? (
          <Skeleton lines={8} />
        ) : items.length === 0 ? (
          <EmptyState icon="history" title={filtered ? t("table.noMatch") : t("admin.audit.empty")} body={filtered ? t("table.noMatchBody") : t("admin.audit.emptyBody")} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data" data-audit-table data-total={page.total}>
                <caption className="sr-only">{title}</caption>
                <thead><tr>
                  <th scope="col">{t("admin.audit.colWhen")}</th>
                  <th scope="col">{t("admin.audit.colWhat")}</th>
                  <th scope="col">{t("admin.audit.colOpen")}</th>
                </tr></thead>
                <tbody>
                  {items.map((r) => {
                    const href = auditHref(r);
                    return (
                      <tr key={r.id} data-audit={r.id} data-entity={r.entity} data-by={r.by} data-action={r.action}>
                        <td data-label={t("admin.audit.colWhen")} className="admin-when">{auditWhen(r.at, lang)}</td>
                        <td data-label={t("admin.audit.colWhat")} className="card-head" data-line>{auditLine(r, names, lang)}{r.note ? <span className="admin-note muted small">{r.note}</span> : null}</td>
                        <td data-label={t("admin.audit.colOpen")}>{href ? <Link href={href} className="row-link" data-open>{t("admin.audit.open")}</Link> : <span className="muted">{t("admin.audit.noPage")}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <nav className="pager" aria-label={t("table.pages")}>
              <span className="muted small">{t("table.showing", { first, last, total: page.total })}</span>
              <label className="pager-size"><span>{t("table.perPage")}</span>
                <select className="input" value={page.pageSize} onChange={(e) => page.setPageSize(Number(e.target.value) as 25 | 50)}><option value={25}>25</option><option value={50}>50</option></select></label>
              <Button size="sm" onClick={page.prev} disabled={!page.hasPrev}>{t("table.previous")}</Button>
              <Button size="sm" onClick={page.next} disabled={!page.hasNext}>{t("table.next")}</Button>
            </nav>
          </>
        )}
      </section>
    </AppShell>
  );
}
