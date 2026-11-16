"use client";
// One expense (spec §7.2): everything that was entered, the bill, who approved it or why it was rejected, and its
// history. Approve, reject, edit, delete and "mark as paid" appear only for the people who may do them.
import {
  approvalRefusal, approverRoles, canApproveExpense, editRefusal, expenseGstPaise, formatBp, formatQty, isFinanceReader, isFinanceRole, isUnpaidCredit, ROLE_LABELS,
  type Account, type ExpenseHistoryEntry, type ExpenseRecord,
} from "@ag/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileThumbs } from "@/components/files/FileThumbs";
import { NoAccess, NotFoundRecord } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { useDoc, useDocStatus, useOnline, useSession, useSmall } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";
import { useParam } from "@/lib/params";
import { ExpenseBadges, approvalKey, categoryLabel, refusalKey, useCategoryTree, useExpenseLimits, useLang, usePersonName, who } from "./common";
import { ApproveExpensesDialog, DeleteExpenseDialog, MarkPaidDialog, RejectExpenseDialog } from "./dialogs";

const when = (iso: string | undefined, lang: "en" | "hi") => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 330 * 60_000).toISOString(); // shown in India time
  return `${date(d.slice(0, 10), lang)}, ${d.slice(11, 16)}`;
};

/** Entries saved before this screen have no history list: the few steps the record itself remembers are shown. */
function historyOf(e: ExpenseRecord): ExpenseHistoryEntry[] {
  if (e.history?.length) return e.history;
  const out: ExpenseHistoryEntry[] = [];
  if (e.createdAt) out.push({ at: e.createdAt, by: e.enteredBy, byName: e.enteredByName, action: "created" });
  if (e.approvalStatus === "approved" && e.approvedAt) out.push({ at: e.approvedAt, by: e.approvedBy ?? "", action: "approved" });
  if (e.approvalStatus === "rejected" && e.approvedAt) out.push({ at: e.approvedAt, by: e.approvedBy ?? "", action: "rejected", note: e.rejectReason ?? undefined });
  if (e.isDeleted && e.deletedAt) out.push({ at: e.deletedAt, by: e.deletedBy ?? "", action: "deleted", note: e.deleteReason });
  return out;
}

export function ExpenseDetail() {
  const { t } = useTranslation();
  const lang = useLang();
  const session = useSession();
  const router = useRouter();
  const online = useOnline();
  const limits = useExpenseLimits();
  const tree = useCategoryTree();
  const personName = usePersonName();
  const id = useParam("id");
  const e = useDoc<ExpenseRecord>("expenses", id);
  const status = useDocStatus("expenses", id);
  const finance = !!session && isFinanceRole(session.role);
  const accounts = useSmall<Account>(session && isFinanceReader(session.role) ? "accounts" : null);
  const [approve, setApprove] = useState(false);
  const [reject, setReject] = useState(false);
  const [del, setDel] = useState(false);
  const [paid, setPaid] = useState(false);

  const title = t("expenses.detail.title");
  const crumbs = [{ label: t("nav.expenses"), href: "/expenses/" }, { label: title }];
  const shell = (body: ReactNode) => <AppShell nav="expenses" title={title} crumbs={crumbs}>{body}</AppShell>;
  if (id === undefined || status === undefined || !session) return shell(<Skeleton lines={6} />);
  if (status === "denied") return shell(<NoAccess name={title} />);
  // A deleted entry is still shown to the people who may read it, marked as deleted.
  if (!e) return shell(<NotFoundRecord name={title} back="/expenses/" backLabel={t("expenses.backToList")} />);

  const me = who(session);
  const editNo = editRefusal(e, me);
  const mayApprove = canApproveExpense(e, me, limits);
  const approveNo = e.approvalStatus === "pending" && !e.isDeleted && !mayApprove ? approvalRefusal(e, me, limits) : null;
  const mayPay = finance && e.source === "manual" && isUnpaidCredit(e);
  const gst = expenseGstPaise(e);
  const account = e.accountId ? accounts?.find((a) => a.id === e.accountId) : null;
  const waitsFor = approverRoles(e, limits).map((r) => ROLE_LABELS[r][lang]).join(", ");
  const head = categoryLabel(tree, e.categoryId, lang, true) || title;
  const rows: [string, ReactNode][] = [
    [t("expenses.col.date"), date(e.date, lang)],
    ...(e.voucherNo ? [[t("expenses.detail.voucherNo"), <span key="vno" data-voucher-no>{e.voucherNo}</span>] as [string, ReactNode]] : []),
    [t("expenses.col.project"), e.projectId ? (finance || session.projectIds.includes(e.projectId) ? <Link href={`/projects/view/?id=${e.projectId}`}>{e.projectName ?? e.projectId}</Link> : e.projectName ?? "") : t("expenses.form.office")],
    [t("expenses.col.category"), head],
    [t("expenses.form.description"), e.description || "—"],
    ...(e.qtyMilli ? [[t("expenses.form.qty"), `${formatQty(e.qtyMilli)} ${e.unit ?? ""}${e.ratePaise ? ` × ${money(e.ratePaise)}` : ""}`] as [string, ReactNode]] : []),
    [t("expenses.col.payee"), e.payeeName ? `${e.payeeName}${e.payeeType && e.payeeType !== "other" ? ` (${t(`expenses.payee.${e.payeeType}`)})` : ""}` : "—"],
    ...(e.partyGstin ? [[t("expenses.form.gstin"), e.partyGstin] as [string, ReactNode]] : []),
    [t("expenses.col.mode"), `${t(`expenses.modes.${e.mode}`)}${e.creditPurchase && e.mode !== "credit" ? ` (${t("expenses.detail.wasCredit")})` : ""}`],
    ...(e.mode !== "credit" && isFinanceReader(session.role) ? [[t("expenses.form.paidFrom"), account ? account.name : e.accountId ? "…" : <span className="badge warning" key="na"><Icon name="alert" size={14} />{t("expenses.detail.noAccount")}</span>] as [string, ReactNode]] : []),
    ...(e.paidDate ? [[t("expenses.paid.date"), `${date(e.paidDate, lang)}${e.paymentRef ? ` · ${e.paymentRef}` : ""}`] as [string, ReactNode]] : []),
    [t("expenses.form.billNo"), e.billNo ? `${e.billNo}${e.billDate ? ` · ${date(e.billDate, lang)}` : ""}` : "—"],
    ...(e.noBillReason ? [[t("expenses.form.noBill"), e.noBillReason] as [string, ReactNode]] : []),
    ...(e.remarks ? [[t("expenses.form.remarks"), e.remarks] as [string, ReactNode]] : []),
    [t("expenses.col.enteredBy"), e.enteredBy === "system" ? e.enteredByName ?? t("expenses.system") : personName(e.enteredBy, e.enteredByName)],
    ...(e.source !== "manual" ? [[t("expenses.detail.source"), t(`expenses.source.${e.source}`, { defaultValue: t("expenses.source.other") })] as [string, ReactNode]] : []),
    ...(e.templateId ? [[t("expenses.detail.source"), <Link key="tpl" href="/expenses/recurring/">{t("expenses.source.recurring")}</Link>] as [string, ReactNode]] : []),
  ];

  return shell(
    <>
      <div className="page-head">
        <div className="heading">
          <h1>{money(e.amountPaise)}</h1>
          <p className="sub">{head}{e.payeeName ? ` · ${e.payeeName}` : ""}</p>
        </div>
        <div className="page-actions" data-expense-actions>
          <ExpenseBadges e={e} />
          {mayApprove && <Button variant="primary" onClick={() => setApprove(true)} disabled={!online} data-approve><Icon name="check" />{t("expenses.approve.action")}</Button>}
          {mayApprove && <Button variant="secondary" onClick={() => setReject(true)} disabled={!online} data-reject>{t("expenses.reject.action")}</Button>}
          {mayPay && <Button variant="primary" onClick={() => setPaid(true)} disabled={!online} data-mark-paid><Icon name="rupee" />{t("expenses.paid.action")}</Button>}
          {!editNo && <Link className="btn btn-secondary" href={`/expenses/edit/?id=${e.id}`} data-edit><Icon name="edit" />{t("common.edit")}</Link>}
          {!editNo && <Button variant="destructive" onClick={() => setDel(true)} disabled={!online} data-delete><Icon name="trash" />{t("common.delete")}</Button>}
        </div>
      </div>
      {!online && <div className="banner warning" role="status"><Icon name="wifi-off" /><span className="text">{t("expenses.detail.offline")}</span></div>}

      {e.isDeleted && <div className="banner info" role="status" data-deleted><Icon name="trash" /><span className="text"><b>{t("expenses.detail.deleted")}</b> {e.deleteReason}</span></div>}
      {!e.isDeleted && e.approvalStatus === "rejected" && (
        <div className="banner error" role="status" data-rejected><Icon name="x" /><span className="text"><b>{t("expenses.detail.rejected")}</b> {e.rejectReason} {!editNo && <Link href={`/expenses/edit/?id=${e.id}`}>{t("expenses.detail.fixIt")}</Link>}</span></div>
      )}
      {!e.isDeleted && e.approvalStatus === "pending" && (
        <div className="banner warning" role="status" data-waiting><Icon name="clock" />
          <span className="text"><b>{t("expenses.detail.waiting")}</b> {e.source === "manual" ? t("expenses.detail.waitsFor", { who: waitsFor }) : ""} {approveNo ? t(`expenses.refusal.${approvalKey(approveNo)}`) : ""}</span></div>
      )}
      {e.postingError && <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{e.postingError}</span></div>}
      {editNo && e.source !== "manual" && !e.isDeleted && <p className="hint"><Icon name="info" size={16} /><span>{t(`expenses.refusal.${refusalKey(editNo)}`)}</span></p>}

      <div className="exp-detail-grid">
        <section className="card" aria-labelledby="exp-d-title">
          <h2 className="card-title" id="exp-d-title">{t("expenses.detail.details")}</h2>
          <dl className="kv exp-kv" data-expense-details>
            {rows.map(([k, val], i) => <div key={`${k}-${i}`} className="exp-kv-row"><dt>{k}</dt><dd>{val}</dd></div>)}
          </dl>
        </section>

        <section className="card" aria-labelledby="exp-m-title">
          <h2 className="card-title" id="exp-m-title">{t("expenses.detail.money")}</h2>
          <dl className="kv" data-expense-money>
            {gst > 0 && <><dt>{t("expenses.form.taxable")}</dt><dd>{money(e.taxablePaise ?? e.amountPaise - gst)}</dd></>}
            {gst > 0 && ((e.igstPaise ?? 0) > 0
              ? <><dt>{t("expenses.form.igst")} {formatBp(e.gstRateBp ?? 0)}</dt><dd>{money(e.igstPaise)}</dd></>
              : <><dt>{t("expenses.form.cgstSgst")} {formatBp(e.gstRateBp ?? 0)}</dt><dd>{money(e.cgstPaise)} + {money(e.sgstPaise)}</dd></>)}
            <dt className="total">{t("expenses.form.total")}</dt><dd className="total">{money(e.amountPaise)}</dd>
          </dl>
          <p className="hint"><Icon name="info" size={16} /><span>{e.isDeleted || e.approvalStatus !== "approved" ? t("expenses.detail.notCounted") : isUnpaidCredit(e) ? t("expenses.detail.countedUnpaid") : t("expenses.detail.counted")}</span></p>

          <h3 className="exp-h3">{t("expenses.form.bill")}</h3>
          <FileThumbs files={e.billFiles ?? []} emptyText={e.billPaths?.length ? t("expenses.detail.oldBill", { n: e.billPaths.length }) : t("expenses.detail.noBillPhoto")} />
        </section>

        <section className="card exp-history" aria-labelledby="exp-h-title">
          <h2 className="card-title" id="exp-h-title">{t("expenses.detail.history")}</h2>
          <ol className="exp-timeline" data-expense-history>
            {historyOf(e).map((h, i) => (
              <li key={`${h.at}-${i}`} data-action={h.action}>
                <b>{t(`expenses.history.${h.action}`)}</b>
                <span className="muted small">{[personName(h.by, h.byName), when(h.at, lang)].filter(Boolean).join(" · ")}</span>
                {h.changed?.length ? <span className="small">{t("expenses.history.changed", { fields: h.changed.map((k) => t(`expenses.field.${k}`, { defaultValue: k })).join(", ") })}</span> : null}
                {h.note ? <span className="small">{h.action === "paid" ? t("expenses.history.paidFrom", { account: h.note }) : h.note}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <ApproveExpensesDialog items={approve ? [e] : null} onClose={() => setApprove(false)} />
      <RejectExpenseDialog expense={reject ? e : null} onClose={() => setReject(false)} />
      <DeleteExpenseDialog expense={del ? e : null} onClose={() => setDel(false)} onDone={() => router.push("/expenses/")} />
      <MarkPaidDialog expense={paid ? e : null} onClose={() => setPaid(false)} />
    </>,
  );
}
