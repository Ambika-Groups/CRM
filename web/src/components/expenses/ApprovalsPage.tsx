"use client";
// Expenses waiting for approval (spec §7.2 "Pending until approved by manager/admin"; D-30): the owner, the
// accountant and the project manager see what waits, approve one or several together, or reject with a reason.
import { approvalRefusal, canApproveExpense, type ExpenseRecord, type Where } from "@ag/core";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useOnline, usePaged, useSession } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";
import { ExpenseTabs, approvalKey, categoryLabel, useCategoryTree, useExpenseLimits, useLang, who } from "./common";
import { ApproveExpensesDialog, RejectExpenseDialog } from "./dialogs";

export function ApprovalsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const session = useSession();
  const online = useOnline();
  const limits = useExpenseLimits();
  const tree = useCategoryTree();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [approve, setApprove] = useState<ExpenseRecord[] | null>(null);
  const [reject, setReject] = useState<ExpenseRecord | null>(null);
  const role = session?.role;
  const allowed = role === "owner" || role === "accountant" || role === "pm";
  const projectIds = session?.projectIds.slice(0, 30) ?? [];
  const spec = useMemo(() => {
    const where: Where[] = [{ field: "approvalStatus", op: "==", value: "pending" }, { field: "isDeleted", op: "==", value: false }];
    if (role === "pm") where.push({ field: "projectId", op: "in", value: projectIds });
    return { where, orderBy: [{ field: "date", dir: "desc" as const }] };
  }, [role, projectIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = !!session && allowed && (role !== "pm" || projectIds.length > 0);
  const page = usePaged<ExpenseRecord>("expenses", spec, 50, ready);

  const title = t("expenses.approvals.title");
  const crumbs = [{ label: t("nav.expenses"), href: "/expenses/" }, { label: title }];
  if (session && !allowed) return <AppShell nav="expenses" title={title} crumbs={crumbs}><NoAccess name={title} /></AppShell>;

  const me = session ? who(session) : null;
  const items = page.items ?? [];
  const mine = items.filter((e) => !!me && canApproveExpense(e, me, limits));
  const chosen = mine.filter((e) => picked.has(e.id));
  const chosenTotal = chosen.reduce((s, e) => s + e.amountPaise, 0);
  const allPicked = mine.length > 0 && chosen.length === mine.length;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const limitText = role === "pm" ? t("expenses.approvals.hintPm", { limit: money(limits.pmApprovalLimitPaise) })
    : role === "accountant" ? t("expenses.approvals.hintAccountant", { limit: money(limits.autoApproveLimitPaise) }) : t("expenses.approvals.hintOwner");

  return (
    <AppShell nav="expenses" title={title} crumbs={crumbs}>
      <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
      <ExpenseTabs current="approvals" />
      <p className="hint"><Icon name="info" size={16} /><span>{limitText}</span></p>
      {!online && <div className="banner warning" role="status"><Icon name="wifi-off" /><span className="text">{t("expenses.detail.offline")}</span></div>}

      {page.error ? (
        <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{page.error}</span></div>
      ) : role === "pm" && session && projectIds.length === 0 ? (
        <EmptyState icon="info" title={t("expenses.list.noProject")} body={t("expenses.list.noProjectBody")} />
      ) : page.items === undefined ? <Skeleton lines={5} /> : items.length === 0 ? (
        <EmptyState icon="check-circle" title={t("expenses.approvals.empty")} body={t("expenses.approvals.emptyBody")} />
      ) : (
        <section className="table-block section" aria-label={title} data-approvals>
          <div className="exp-bulk" data-bulk>
            <label className="check-row">
              <input type="checkbox" checked={allPicked} disabled={!mine.length} onChange={() => setPicked(allPicked ? new Set() : new Set(mine.map((e) => e.id)))} data-pick-all />
              <span>{t("expenses.approvals.pickAll", { n: mine.length })}</span>
            </label>
            <Button variant="primary" disabled={!chosen.length || !online} onClick={() => setApprove(chosen)} data-approve-picked>
              <Icon name="check" />{chosen.length ? t("expenses.approvals.approvePicked", { n: chosen.length, total: money(chosenTotal) }) : t("expenses.approvals.approveNone")}
            </Button>
          </div>
          <div className="table-wrap">
            <table className="data" data-approvals-table>
              <caption className="sr-only">{title}</caption>
              <thead><tr>
                <th scope="col"><span className="sr-only">{t("expenses.approvals.pick")}</span></th>
                <th scope="col">{t("expenses.col.date")}</th><th scope="col">{t("expenses.col.category")}</th><th scope="col">{t("expenses.col.project")}</th>
                <th scope="col">{t("expenses.col.payee")}</th><th scope="col">{t("expenses.col.enteredBy")}</th><th scope="col" className="num">{t("expenses.col.amount")}</th>
                <th scope="col">{t("expenses.approvals.bill")}</th><th scope="col"><span className="sr-only">{t("table.actions")}</span></th>
              </tr></thead>
              <tbody>
                {items.map((e) => {
                  const no = me ? approvalRefusal(e, me, limits) : null;
                  const label = `${money(e.amountPaise)} ${e.payeeName ?? ""}`.trim();
                  return (
                    <tr key={e.id} data-expense={e.id} data-can-approve={!no}>
                      <td data-label={t("expenses.approvals.pick")} className="exp-pick">
                        {!no && <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={t("expenses.approvals.pickOne", { name: label })} data-pick />}
                      </td>
                      <td data-label={t("expenses.col.date")}>{date(e.date, lang)}</td>
                      <td data-label={t("expenses.col.category")} className="card-head">
                        <Link href={`/expenses/view/?id=${e.id}`} className="row-link">{categoryLabel(tree, e.categoryId, lang) || t("expenses.col.category")}</Link>
                        {e.description ? <span className="exp-sub">{e.description}</span> : null}
                      </td>
                      <td data-label={t("expenses.col.project")}>{e.projectName ?? t("expenses.form.office")}</td>
                      <td data-label={t("expenses.col.payee")}>{e.payeeName || "—"}</td>
                      <td data-label={t("expenses.col.enteredBy")}>{e.enteredBy === "system" ? t("expenses.system") : e.enteredByName ?? "—"}</td>
                      <td data-label={t("expenses.col.amount")} className="num">{money(e.amountPaise)}</td>
                      <td data-label={t("expenses.approvals.bill")}>{(e.billFiles?.length ?? 0) + (e.billPaths?.length ?? 0) > 0 ? t("expenses.approvals.billYes") : e.noBillReason ? `${t("expenses.approvals.billNo")}: ${e.noBillReason}` : t("expenses.approvals.billNo")}</td>
                      <td data-label={t("table.actions")} className="row-actions exp-row-buttons">
                        {!no ? <>
                          <Button size="sm" variant="primary" disabled={!online} onClick={() => setApprove([e])} data-approve>{t("expenses.approve.action")}</Button>
                          <Button size="sm" variant="secondary" disabled={!online} onClick={() => setReject(e)} data-reject>{t("expenses.reject.action")}</Button>
                        </> : <span className="muted small" data-why>{t(`expenses.refusal.${approvalKey(no)}`)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label={t("table.pages")}>
            <span className="muted small">{t("expenses.approvals.count", { n: page.total })}</span>
            <Button size="sm" onClick={page.prev} disabled={!page.hasPrev}>{t("table.previous")}</Button>
            <Button size="sm" onClick={page.next} disabled={!page.hasNext}>{t("table.next")}</Button>
          </nav>
        </section>
      )}

      <ApproveExpensesDialog items={approve} onClose={() => setApprove(null)} onDone={() => setPicked(new Set())} />
      <RejectExpenseDialog expense={reject} onClose={() => setReject(null)} />
    </AppShell>
  );
}
