"use client";
import { canOpen, formatINR, isFinanceRole, type Project, type Worker, type WorkerPay } from "@ag/core";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { DataTable } from "@/components/ui/data-table";
import { NoAccess } from "@/components/ModulePage";
import { EmptyState, Skeleton, StatusBadge } from "@/components/ui/feedback";
import { useRead, useSession, useSmall } from "@/data/DataProvider";
import { phone } from "@/lib/fmt";
import { thekedarsOf, usePmWorkers } from "./pmRoster";

/**
 * Workers & attendance landing (spec §6.1 worker master). Owner, accountant and PM see the worker list;
 * a supervisor works from their site's roster, linked here. Attendance itself is the next screen to come.
 */
export function WorkersPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const session = useSession();
  const roles = (useSmall<{ id: string; workerRoles?: { key: string; label: string; labelHi?: string }[] }>("settings") ?? []).find((s) => s.id === "operations")?.workerRoles ?? [];
  // Site roles may only list projects they are assigned to (rules: uid in assignedUsers).
  const sites = useRead(`worker-sites:${session?.uid}`, (s) => s.query<Project>("projects", {
    where: [{ field: "isArchived", op: "==", value: false }, ...(session && !isFinanceRole(session.role) ? [{ field: "assignedUsers", op: "array-contains" as const, value: session.uid }] : [])],
    orderBy: [{ field: "name" }], limit: 50,
  }));
  const pmRows = usePmWorkers();
  const thekedarQuery = useRead("thekedars", (s) => (session && isFinanceRole(session.role)
    ? s.query<Worker>("workers", { where: [{ field: "isThekedar", op: "==", value: true }], orderBy: [{ field: "name" }], limit: 50 })
    : Promise.resolve({ items: [] as Worker[], next: null, total: 0 })));
  const thekedars = session?.role === "pm" ? thekedarsOf(pmRows ?? []) : (thekedarQuery?.items ?? []);
  const roleLabel = (k: string) => { const r = roles.find((x) => x.key === k); return r ? (lang === "hi" && r.labelHi ? r.labelHi : r.label) : k; };
  const finance = !!session && isFinanceRole(session.role);
  const canAdd = finance || session?.role === "pm";
  // A PM sees only workers on the rosters of their assigned projects (QA F1). Rosters are small per-site collections the
  // PM may read, so the list is built from them and never queries the worker master (rule 9, rules T-350…T-353).
  const siteName = (id: string) => sites?.items.find((p) => p.id === id)?.name ?? "";

  if (!session) return <AppShell nav="labour" title={t("workers.title")} crumbs={[{ label: t("nav.labour") }]}><Skeleton lines={6} /></AppShell>;
  if (!canOpen(session.role, "labour")) {
    return <AppShell nav="labour" title={t("nav.labour")} crumbs={[{ label: t("nav.labour") }]}><NoAccess name={t("nav.labour")} /></AppShell>;
  }
  if (session.role === "supervisor") {
    return (
      <AppShell nav="labour" title={t("nav.labour")} crumbs={[{ label: t("nav.labour") }]}>
        <div className="page-head"><div className="heading"><h1>{t("nav.labour")}</h1></div></div>
        <div className="grid">
          {(sites?.items ?? []).filter((p) => session.projectIds.includes(p.id)).map((p) => (
            <section key={p.id} className="card">
              <h2 className="card-title">{p.name}</h2>
              <p className="muted">{t("projects.rosterHint")}</p>
              <div className="page-actions" style={{ marginTop: "var(--space-4)" }}>
                <Link className="btn btn-secondary" href={`/projects/view/?id=${p.id}&tab=workforce`}><Icon name="users" />{t("projects.roster")}</Link>
                <Link className="btn btn-primary" href={`/labour/attendance/?site=${p.id}`}><Icon name="check" />{t("attendance.markToday")}</Link>
                <Link className="btn btn-secondary" href={`/labour/attendance/sheet/?site=${p.id}`}><Icon name="calendar" />{t("attendance.sheet")}</Link>
              </div>
            </section>
          ))}
          {sites && !sites.items.some((p) => session.projectIds.includes(p.id)) && <EmptyState title={t("projects.noRoster")} />}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell nav="labour" title={t("workers.title")} crumbs={[{ label: t("nav.labour") }]} actionBar={canAdd}>
      <div className="page-head">
        <div className="heading"><h1>{t("workers.title")}</h1></div>
        <div className="page-actions">
          <Link className="btn btn-secondary" href="/labour/attendance/"><Icon name="check" />{t("nav.attendance")}</Link>
          <Link className="btn btn-secondary" href="/labour/attendance/sheet/"><Icon name="calendar" />{t("attendance.sheet")}</Link>
          {finance && <Link className="btn btn-secondary" href="/labour/payments/"><Icon name="rupee" />{t("payments.title")}</Link>}
          {finance && <Link className="btn btn-secondary" href="/labour/payout/"><Icon name="file-text" />{t("payout.title")}</Link>}
          {canAdd && <span className="action-bar"><Link className="btn btn-primary" href="/labour/workers/edit/"><Icon name="plus" />{t("workers.new")}</Link></span>}
        </div>
      </div>
      <DataTable<Worker>
        id="workers" collection="workers" caption={t("workers.title")} exportName="workers" defaultSort={{ field: "name", dir: "asc" }}
        rowHref={(w) => `/labour/workers/view/?id=${w.id}`} rows={session.role === "pm" ? pmRows ?? [] : undefined}
        extra={finance ? async (s, rows) => {
          const pays = await Promise.all(rows.map((w) => s.get<WorkerPay>(`workers/${w.id}/private`, "pay")));
          return Object.fromEntries(rows.map((w, i) => [w.id, { rate: pays[i]?.defaultRatePaise ?? null }]));
        } : undefined}
        filters={[
          { key: "role", label: t("workers.role"), options: roles.map((r) => ({ value: r.key, label: lang === "hi" && r.labelHi ? r.labelHi : r.label })), where: (v) => ({ field: "role", op: "==", value: v }) },
          { key: "site", label: t("workers.sites"), options: (sites?.items ?? []).filter((p) => finance || session.projectIds.includes(p.id)).map((p) => ({ value: p.id, label: p.name })),
            where: (v) => ({ field: "siteIds", op: "array-contains", value: v }) },
          { key: "thekedar", label: t("workers.thekedar"), options: thekedars.map((w) => ({ value: w.id, label: w.name })), where: (v) => ({ field: "thekedarId", op: "==", value: v }) },
          { key: "active", label: t("workers.active"), options: [{ value: "yes", label: t("common.yes") }, { value: "no", label: t("common.no") }], where: (v) => ({ field: "active", op: "==", value: v === "yes" }) },
        ]}
        columns={[
          { key: "name", header: t("workers.name"), cell: (w) => w.name, sortField: "name", cardHead: true },
          { key: "role", header: t("workers.role"), cell: (w) => roleLabel(w.role), sortField: "role" },
          { key: "phone", header: t("workers.phone"), cell: (w) => phone(w.phone), csv: (w) => w.phone ?? "" },
          { key: "pay", header: t("workers.payType"), cell: (w) => (w.defaultPayType ? t(`workers.${w.defaultPayType}`) : "—") },
          ...(finance ? [{ key: "rate", header: t("workers.rate"), cell: (_w: Worker, x: Record<string, unknown>) => (x.rate ? formatINR(x.rate as number) : "—"), csv: (_w: Worker, x: Record<string, unknown>) => ((x.rate as number | null) ?? 0) / 100, align: "right" as const }] : []),
          { key: "thekedar", header: t("workers.thekedar"), cell: (w) => w.thekedarName ?? "—" },
          { key: "sites", header: t("workers.sites"), cell: (w) => (w.siteIds ?? []).map(siteName).filter(Boolean).join(", ") || "—" },
          { key: "active", header: t("workers.active"), cell: (w) => <StatusBadge kind={w.active ? "active" : "inactive"} />, csv: (w) => (w.active ? "yes" : "no") },
        ]}
        empty={{ title: t("workers.empty"), body: t("workers.emptyBody") }}
      />
    </AppShell>
  );
}
