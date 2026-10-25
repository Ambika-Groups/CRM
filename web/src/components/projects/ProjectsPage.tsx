"use client";
import { canOpen, fyOf, fyRange, isFinanceReader, isFinanceRole, todayIST, sumCost, sumFinance, type Project, type User, type Where } from "@ag/core";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { StatusBadge, type BadgeKind } from "@/components/ui/feedback";
import { useSession, useSmall } from "@/data/DataProvider";
import { rupees } from "@/lib/fmt";

export function statusBadge(p: Pick<Project, "status" | "isArchived" | "expectedEndDate">): BadgeKind {
  if (p.isArchived) return "archived";
  if (p.status === "in_progress") return p.expectedEndDate < todayIST() ? "delayed" : "active";
  return p.status === "completed" ? "completed" : p.status === "on_hold" ? "on_hold" : p.status === "cancelled" ? "cancelled" : "planned";
}

/** Recent financial years for the FY filter. */
function fyOptions(): string[] {
  const now = fyOf(todayIST());
  const start = Number(now.slice(0, 4));
  return [0, 1, 2, 3].map((i) => { const s = start - i; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; });
}

/**
 * Project list (spec §5.1): name, type, client, location, status, progress, budget, spent, billed, received,
 * manager; filters by type, status, FY and manager. Billed and received only for finance roles (D-28).
 */
export function ProjectsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const users = useSmall<User>("users") ?? [];
  const [archived, setArchived] = useState(false);
  const canCreate = !!session && isFinanceRole(session.role);
  const finance = !!session && isFinanceReader(session.role);
  // Budget vs spent: finance, the assigned PM and the viewer (D-42). Billed and received: finance only.
  const seesBudget = finance || session?.role === "pm" || session?.role === "viewer";

  const base: Where[] = useMemo(() => {
    const w: Where[] = [{ field: "isArchived", op: "==", value: archived }];
    // Site roles see only assigned projects (D-06, D-21).
    if (session && (session.role === "pm" || session.role === "supervisor")) w.push({ field: "assignedUsers", op: "array-contains", value: session.uid });
    return w;
  }, [archived, session]);

  if (session && !canOpen(session.role, "projects")) {
    return <AppShell nav="projects" title={t("projects.title")} crumbs={[{ label: t("nav.projects") }]}><NoAccess name={t("projects.title")} /></AppShell>;
  }
  return (
    <AppShell nav="projects" title={t("projects.title")} crumbs={[{ label: t("nav.projects") }]} actionBar={canCreate}>
      <div className="page-head">
        <div className="heading"><h1>{t("projects.title")}</h1></div>
        <div className="page-actions">
          <Button size="sm" variant="text" onClick={() => setArchived((a) => !a)}><Icon name="archive" />{archived ? t("projects.hideArchived") : t("projects.showArchived")}</Button>
          {canCreate && <span className="action-bar"><Link className="btn btn-primary" href="/projects/new/"><Icon name="plus" />{t("projects.new")}</Link></span>}
        </div>
      </div>
      <DataTable<Project>
        id={`projects-${archived ? "archived" : "live"}`} collection="projects" caption={t("projects.title")} exportName="projects"
        baseWhere={base} defaultSort={{ field: "code", dir: "asc" }} rowHref={(p) => `/projects/view/?id=${p.id}`}
        extra={async (s, rows) => {
          const [cost, fin, budgets] = await Promise.all([
            s.getMany<Record<string, unknown>>("rollups", rows.map((r) => `p_${r.id}_all`)),
            finance ? s.getMany<Record<string, unknown>>("finance_rollups", rows.map((r) => `p_${r.id}_all`)) : Promise.resolve([]),
            seesBudget ? Promise.all(rows.map((r) => s.get<{ budgetPaise: number }>(`projects/${r.id}/private`, "budget"))) : Promise.resolve([]),
          ]);
          return Object.fromEntries(rows.map((r, i) => [r.id, {
            spent: cost[i] ? sumCost([cost[i] as never]).expenseTotalPaise : null,
            billed: fin[i] ? sumFinance([fin[i] as never]).billedPaise : null,
            received: fin[i] ? sumFinance([fin[i] as never]).receivedPaise : null,
            budget: budgets[i]?.budgetPaise ?? null,
          }]));
        }}
        filters={[
          { key: "type", label: t("projects.type"), options: (["residential", "government"] as const).map((v) => ({ value: v, label: t(`projects.${v}`) })), where: (v) => ({ field: "type", op: "==", value: v }) },
          { key: "status", label: t("projects.status"), options: (["planned", "in_progress", "on_hold", "completed", "cancelled"] as const).map((v) => ({ value: v, label: t(`projects.${v}`) })), where: (v) => ({ field: "status", op: "==", value: v }) },
          { key: "delayed", label: t("dash.delayed"), options: [{ value: "yes", label: t("common.yes") }], where: () => [{ field: "status", op: "==", value: "in_progress" }, { field: "expectedEndDate", op: "<", value: todayIST() }] },
          { key: "fy", label: t("projects.fy"), options: fyOptions().map((f) => ({ value: f, label: f })), where: (v) => [{ field: "startDate", op: "<=", value: fyRange(v).to }, { field: "expectedEndDate", op: ">=", value: fyRange(v).from }] },
          { key: "manager", label: t("projects.manager"), options: users.filter((u) => u.role === "pm" || u.role === "owner").map((u) => ({ value: u.id, label: u.name })), where: (v) => ({ field: "managerId", op: "==", value: v }) },
        ]}
        columns={[
          { key: "name", header: t("projects.name"), cell: (p) => p.name, sortField: "name", cardHead: true },
          { key: "code", header: t("projects.code"), cell: (p) => p.code, sortField: "code" },
          { key: "type", header: t("projects.type"), cell: (p) => `${t(`projects.${p.type}`).split(" (")[0]} · ${t(`projects.${p.subtype}`)}`, sortField: "type" },
          { key: "client", header: t("projects.client"), cell: (p) => p.clientName, sortField: "clientName" },
          { key: "city", header: t("projects.location"), cell: (p) => [p.address, p.city].filter(Boolean).join(", ") || "—", defaultHidden: true },
          { key: "status", header: t("projects.status"), cell: (p) => <StatusBadge kind={statusBadge(p)} />, csv: (p) => t(`status.${statusBadge(p)}`), sortField: "status" },
          { key: "progress", header: t("projects.progress"), cell: (p) => `${p.progressPct}%`, sortField: "progressPct", align: "right" },
          ...(seesBudget ? [{ key: "budget", header: t("projects.budget"), cell: (_p: Project, x: Record<string, unknown>) => rupees(x.budget as number | null), csv: (_p: Project, x: Record<string, unknown>) => ((x.budget as number | null) ?? 0) / 100, align: "right" as const }] : []),
          { key: "spent", header: t("projects.spent"), cell: (_p, x) => rupees(x.spent as number | null), csv: (_p, x) => ((x.spent as number | null) ?? 0) / 100, align: "right" },
          ...(finance ? [
            { key: "billed", header: t("projects.billed"), cell: (_p: Project, x: Record<string, unknown>) => rupees(x.billed as number | null), csv: (_p: Project, x: Record<string, unknown>) => ((x.billed as number | null) ?? 0) / 100, align: "right" as const },
            { key: "received", header: t("projects.received"), cell: (_p: Project, x: Record<string, unknown>) => rupees(x.received as number | null), csv: (_p: Project, x: Record<string, unknown>) => ((x.received as number | null) ?? 0) / 100, align: "right" as const },
          ] : []),
          { key: "manager", header: t("projects.manager"), cell: (p) => p.managerName ?? "—", sortField: "managerName" },
        ]}
        empty={{ title: t("projects.empty"), body: t("projects.emptyBody"), action: canCreate ? <Link className="btn btn-secondary" href="/projects/new/"><Icon name="plus" />{t("projects.new")}</Link> : undefined }}
      />
    </AppShell>
  );
}
