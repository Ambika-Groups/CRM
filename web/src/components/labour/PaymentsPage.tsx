"use client";
import { isFinanceRole, type Project, type WorkerPayment } from "@ag/core";
import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState, MiniWrap, Skeleton, StatusBadge, useToast, type BadgeKind } from "@/components/ui/feedback";
import { TextField } from "@/components/ui/form";
import { useRead, useRun, useSession, useSmall } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";

export const PAY_TYPES = ["wage", "advance", "bonus", "thekedar_bill", "advance_writeoff"] as const;
export const statusKind = (p: Pick<WorkerPayment, "approvalStatus">): BadgeKind => (p.approvalStatus === "approved" ? "approved" : p.approvalStatus === "rejected" ? "rejected" : "pending_approval");

/**
 * Wage, advance, bonus and thekedar payments (spec §6.4), finance only (D-45). Entries above the auto-approve
 * limit, or above a thekedar contract's value (§8A.6), wait here for the owner.
 */
export function PaymentsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const ops = (useSmall<{ id: string; autoApproveLimitPaise?: number }>("settings") ?? []).find((s) => s.id === "operations");
  const pending = useRead("pay-pending", (s) => s.query<WorkerPayment>("worker_payments", { where: [{ field: "approvalStatus", op: "==", value: "pending" }], orderBy: [{ field: "date", dir: "desc" }], limit: 50 }));
  const sites = useRead("pay-sites", (s) => s.query<Project>("projects", { where: [{ field: "isArchived", op: "==", value: false }], orderBy: [{ field: "name" }], limit: 50 }));
  const [reject, setReject] = useState<WorkerPayment | null>(null);
  const [reason, setReason] = useState("");
  const title = t("payments.title");
  if (session && !isFinanceRole(session.role)) return <AppShell nav="labour" title={title} crumbs={[{ label: title }]}><NoAccess name={title} /></AppShell>;

  const limit = ops?.autoApproveLimitPaise ?? 2_500_000;
  const mayApprove = (p: WorkerPayment) => session?.role === "owner" || (session?.role === "accountant" && !p.needsOwnerApproval && p.grossPaise <= limit && p.createdBy !== session.uid);
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); } };

  return (
    <AppShell nav="labour" title={title} crumbs={[{ label: t("nav.labour"), href: "/labour/" }, { label: title }]} actionBar>
      <div className="page-head">
        <div className="heading"><h1>{title}</h1></div>
        <div className="page-actions">
          <Link className="btn btn-secondary" href="/labour/payout/"><Icon name="file-text" />{t("payout.title")}</Link>
          <span className="action-bar"><Link className="btn btn-primary" href="/labour/payments/new/"><Icon name="plus" />{t("payments.new")}</Link></span>
        </div>
      </div>

      <section className="card section" aria-labelledby="pending-title" data-pending>
        <h2 className="card-title" id="pending-title">{t("payments.pending")} {pending ? `(${pending.items.length})` : ""}</h2>
        <p className="hint"><Icon name="info" size={16} /><span>{t("payments.pendingHint", { limit: money(limit) })}</span></p>
        {!pending ? <Skeleton /> : pending.items.length === 0 ? <EmptyState icon="check-circle" title={t("payments.noPending")} /> : (
          <MiniWrap label={t("payments.pending")}><table className="mini-table">
            <thead><tr><th>{t("payments.date")}</th><th>{t("payments.worker")}</th><th>{t("payments.project")}</th><th>{t("payments.type")}</th>
              <th className="num">{t("payments.gross")}</th><th>{t("payments.why")}</th><th><span className="sr-only">{t("table.actions")}</span></th></tr></thead>
            <tbody>{pending.items.map((p) => (
              <tr key={p.id} data-payment={p.id}>
                <td>{date(p.date, lang)}</td><td><Link href={`/labour/workers/view/?id=${p.workerId}`}>{p.workerName}</Link></td><td>{p.projectName}</td>
                <td>{t(`payments.types.${p.type}`)}</td><td className="num">{money(p.grossPaise)}</td>
                <td>{p.needsOwnerApproval ? t("payments.overContract") : t("payments.overLimit")}</td>
                <td className="row-actions">
                  {mayApprove(p) ? <>
                    <Button size="sm" variant="primary" onClick={() => void act(() => run("approveWorkerPayments", { ids: [p.id] }), t("payments.approved"))} data-approve>{t("payments.approve")}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setReject(p)}>{t("payments.reject")}</Button>
                  </> : <span className="muted small">{t("payments.ownerApproves")}</span>}
                </td>
              </tr>
            ))}</tbody>
          </table></MiniWrap>
        )}
      </section>

      <DataTable<WorkerPayment>
        id="worker-payments" collection="worker_payments" caption={title} exportName="worker-payments" defaultSort={{ field: "date", dir: "desc" }}
        rowHref={(p) => `/labour/workers/view/?id=${p.workerId}`}
        filters={[
          { key: "type", label: t("payments.type"), options: PAY_TYPES.map((v) => ({ value: v, label: t(`payments.types.${v}`) })), where: (v) => ({ field: "type", op: "==", value: v }) },
          { key: "project", label: t("payments.project"), options: (sites?.items ?? []).map((p) => ({ value: p.id, label: p.name })), where: (v) => ({ field: "projectId", op: "==", value: v }) },
          { key: "status", label: t("payments.status"), options: (["pending", "approved", "rejected"] as const).map((v) => ({ value: v, label: t(`status.${v === "pending" ? "pending_approval" : v}`) })), where: (v) => ({ field: "approvalStatus", op: "==", value: v }) },
        ]}
        columns={[
          { key: "date", header: t("payments.date"), cell: (p) => date(p.date, lang), csv: (p) => p.date, sortField: "date" },
          { key: "worker", header: t("payments.worker"), cell: (p) => p.workerName ?? "", cardHead: true },
          { key: "project", header: t("payments.project"), cell: (p) => p.projectName ?? "" },
          { key: "type", header: t("payments.type"), cell: (p) => t(`payments.types.${p.type}`) },
          { key: "gross", header: t("payments.gross"), cell: (p) => money(p.grossPaise), csv: (p) => p.grossPaise / 100, align: "right", sortField: "grossPaise" },
          { key: "recovered", header: t("payments.recovered"), cell: (p) => (p.advanceRecoveredPaise ? money(p.advanceRecoveredPaise) : "—"), csv: (p) => (p.advanceRecoveredPaise ?? 0) / 100, align: "right" },
          { key: "tds", header: t("payments.tds"), cell: (p) => (p.tdsPaise ? money(p.tdsPaise) : "—"), csv: (p) => (p.tdsPaise ?? 0) / 100, align: "right" },
          { key: "net", header: t("payments.net"), cell: (p) => money(p.netPaidPaise), csv: (p) => p.netPaidPaise / 100, align: "right" },
          { key: "mode", header: t("payments.mode"), cell: (p) => t(`payments.modes.${p.mode}`) },
          { key: "status", header: t("payments.status"), cell: (p) => <StatusBadge kind={statusKind(p)} />, csv: (p) => p.approvalStatus },
        ]}
        empty={{ title: t("payments.empty") }}
      />

      <Dialog open={!!reject} onOpenChange={(o) => { if (!o) { setReject(null); setReason(""); } }}>
        <DialogContent title={t("payments.rejectTitle", { name: reject?.workerName ?? "" })} description={t("payments.rejectBody")}>
          <TextField label={t("payments.rejectReason")} value={reason} onChange={setReason} required />
          <DialogActions>
            <DialogClose asChild><Button variant="secondary">{t("common.cancel")}</Button></DialogClose>
            <Button variant="destructive" disabled={reason.trim().length < 3} onClick={() => void act(async () => { await run("rejectWorkerPayment", { id: reject!.id, reason }); setReject(null); setReason(""); }, t("payments.rejected"))}>{t("payments.reject")}</Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
