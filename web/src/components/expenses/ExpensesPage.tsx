"use client";
// The expense list (spec §7.2, §4 "search, filter, sort and pagination on every list"): one page at a time (§3.1
// rule 9), filtered by project, category, dates, status, paid or not, and a search on who was paid; totals under the
// list; actions by role; and the entries still waiting on this device to be sent.
import {
  approvalRefusal, canApproveExpense, csvAmount, editRefusal, expenseGstPaise, expenseTotals, isFinanceReader, isFinanceRole, isUnpaidCredit, searchTerm, toCsv,
  type ExpenseRecord, type QuerySpec, type Where,
} from "@ag/core";
import * as DM from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton, useToast } from "@/components/ui/feedback";
import { toDate } from "@/components/ui/form";
import { useData, usePaged, useRead, useSession } from "@/data/DataProvider";
import { fetchAll } from "@/lib/fetchAll";
import { date, money } from "@/lib/fmt";
import { discardQueued, useQueue } from "@/lib/queue";
import { ExpenseBadges, ExpenseTabs, OFFICE, approvalKey, categoryLabel, useCategoryTree, useExpenseLimits, useLang, useMyProjects, who } from "./common";
import { ApproveExpensesDialog, DeleteExpenseDialog, MarkPaidDialog, RejectExpenseDialog } from "./dialogs";

interface Filters { project: string; category: string; status: string; paid: string; from: string; to: string; q: string }
const NO_FILTERS: Filters = { project: "", category: "", status: "", paid: "", from: "", to: "", q: "" };
const STATUSES = ["pending", "approved", "rejected", "deleted"] as const;
/** "Add up all" reads at most this many entries (20 pages of 50). */
const SUM_CAP = 1000;
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function ExpensesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const session = useSession();
  const { source } = useData();
  const toast = useToast();
  const router = useRouter();
  const limits = useExpenseLimits();
  const tree = useCategoryTree();
  const projects = useMyProjects();
  const queue = useQueue().filter((q) => q.name === "createExpense");
  const [fl, setFl] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ field: "date" | "amountPaise"; dir: "asc" | "desc" }>({ field: "date", dir: "desc" });
  const [approve, setApprove] = useState<ExpenseRecord | null>(null);
  const [reject, setReject] = useState<ExpenseRecord | null>(null);
  const [del, setDel] = useState<ExpenseRecord | null>(null);
  const [paid, setPaid] = useState<ExpenseRecord | null>(null);
  const [grand, setGrand] = useState<{ key: string; totals: ReturnType<typeof expenseTotals> } | null>(null);
  const [busy, setBusy] = useState<"sum" | "csv" | null>(null);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFl((f) => ({ ...f, [k]: v }));

  // Filters can arrive in the address (?f.status=pending), so a dashboard figure opens its entries already filtered.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const init: Partial<Filters> = {};
    for (const k of ["project", "category", "status", "paid"] as const) { const v = q.get(`f.${k}`); if (v) init[k] = v; }
    if (Object.keys(init).length) setFl((f) => ({ ...f, ...init }));
  }, []);

  const role = session?.role;
  const finance = !!role && isFinanceRole(role);
  const site = role === "pm" || role === "supervisor";
  // A project manager or supervisor always looks at one of their own projects (the list is asked for per project).
  useEffect(() => {
    if (site && projects?.length && !projects.some((p) => p.id === fl.project)) set("project", projects[0]!.id);
  }, [site, projects, fl.project]);

  const term = searchTerm(fl.q);
  const from = toDate(fl.from), to = toDate(fl.to);
  const spec: Omit<QuerySpec, "limit" | "after"> = useMemo(() => {
    const where: Where[] = [{ field: "isDeleted", op: "==", value: fl.status === "deleted" }];
    if (fl.status === "pending" || fl.status === "approved" || fl.status === "rejected") where.push({ field: "approvalStatus", op: "==", value: fl.status });
    if (fl.project === OFFICE) where.push({ field: "projectId", op: "==", value: null });
    else if (fl.project) where.push({ field: "projectId", op: "==", value: fl.project });
    if (role === "supervisor" && session) where.push({ field: "enteredBy", op: "==", value: session.uid });
    if (fl.category && tree?.byId.has(fl.category)) where.push({ field: "categoryId", op: "in", value: tree.descendantsAndSelf(fl.category).slice(0, 30) });
    if (fl.paid === "paid" || fl.paid === "unpaid") where.push({ field: "paidStatus", op: "==", value: fl.paid });
    if (fl.paid === "noAccount") where.push({ field: "paidStatus", op: "==", value: "paid" }, { field: "accountId", op: "==", value: null }, { field: "source", op: "==", value: "manual" });
    if (isIso(from)) where.push({ field: "date", op: ">=", value: from });
    if (isIso(to)) where.push({ field: "date", op: "<=", value: to });
    if (term) where.push({ field: "searchKeywords", op: "array-contains", value: term });
    return { where, orderBy: [{ field: sort.field, dir: sort.dir }] };
  }, [fl.status, fl.project, fl.category, fl.paid, from, to, term, sort, role, session, tree]);
  const specKey = JSON.stringify(spec);
  const ready = !!session && (!site || !!fl.project);
  const page = usePaged<ExpenseRecord>("expenses", spec, 25, ready);
  const noAccount = useRead(`exp-noaccount:${finance}`, (s) => (finance
    ? s.count("expenses", [{ field: "isDeleted", op: "==", value: false }, { field: "approvalStatus", op: "==", value: "approved" }, { field: "source", op: "==", value: "manual" },
      { field: "paidStatus", op: "==", value: "paid" }, { field: "accountId", op: "==", value: null }])
    : Promise.resolve(0)));

  const title = t("nav.expenses");
  if (session && !isFinanceReader(session.role) && !site) return <AppShell nav="expenses" title={title} crumbs={[{ label: title }]}><NoAccess name={title} /></AppShell>;

  const items = page.items;
  const pageTotals = expenseTotals(items ?? []);
  const whole = !!items && page.total <= items.length && page.page === 1;
  const shown = whole ? pageTotals : grand?.key === specKey ? grand.totals : null;
  const filtered = Object.values(fl).some(Boolean) && !(site && Object.entries(fl).every(([k, v]) => k === "project" || !v));
  const canAdd = finance || site;
  const me = session ? who(session) : null;

  const allMatching = () => fetchAll<ExpenseRecord>(source, "expenses", spec, SUM_CAP / 50);
  const addUp = async () => {
    setBusy("sum");
    try { setGrand({ key: specKey, totals: expenseTotals(await allMatching()) }); } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); } finally { setBusy(null); }
  };
  const exportCsv = async () => {
    setBusy("csv");
    try {
      const rows = await allMatching();
      const csv = toCsv<ExpenseRecord>([
        { header: t("expenses.col.date"), value: (e) => e.date },
        { header: t("expenses.col.project"), value: (e) => e.projectName ?? t("expenses.form.office") },
        { header: t("expenses.col.category"), value: (e) => categoryLabel(tree, e.categoryId, lang, true) },
        { header: t("expenses.form.description"), value: (e) => e.description ?? "" },
        { header: t("expenses.col.payee"), value: (e) => e.payeeName ?? "" },
        { header: t("expenses.col.amount"), value: (e) => csvAmount(e.amountPaise) },
        { header: t("expenses.form.taxable"), value: (e) => csvAmount(e.taxablePaise ?? e.amountPaise) },
        { header: t("expenses.col.gst"), value: (e) => csvAmount(expenseGstPaise(e)) },
        { header: t("expenses.col.mode"), value: (e) => t(`expenses.modes.${e.mode}`) },
        { header: t("expenses.col.paid"), value: (e) => (e.paidStatus === "unpaid" ? t("expenses.filter.unpaid") : t("expenses.filter.paid")) },
        { header: t("expenses.form.billNo"), value: (e) => e.billNo ?? "" },
        { header: t("expenses.col.status"), value: (e) => (e.isDeleted ? t("expenses.status.deleted") : t(`expenses.status.${e.approvalStatus}`)) },
        { header: t("expenses.col.enteredBy"), value: (e) => e.enteredByName ?? "" },
      ], rows);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "expenses.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast(rows.length >= SUM_CAP ? t("expenses.list.exportedCap", { n: rows.length }) : t("table.exported", { n: rows.length }));
    } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); } finally { setBusy(null); }
  };

  const sortBy = (field: "date" | "amountPaise") => setSort((s) => (s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "desc" }));
  const sortIcon = (field: string) => (sort.field === field ? (sort.dir === "asc" ? "chevron-up" : "chevron-down") : "chevrons-up-down");
  const first = (page.page - 1) * page.pageSize + 1;
  const last = first + (items?.length ?? 0) - 1;
  const catOptions = tree ? tree.roots().flatMap((r) => tree.descendantsAndSelf(r.id).map((id) => ({ id, label: `${"— ".repeat(tree.level(id) - 1)}${categoryLabel(tree, id, lang)}` }))) : [];

  return (
    <AppShell nav="expenses" title={title} crumbs={[{ label: title }]} actionBar={canAdd}>
      <div className="page-head">
        <div className="heading"><h1>{title}</h1></div>
        {canAdd && (
          <div className="page-actions">
            <span className="action-bar"><Link className="btn btn-primary" href={`/expenses/new/${fl.project && fl.project !== OFFICE ? `?project=${fl.project}` : ""}`} data-add-expense><Icon name="plus" />{t("expenses.list.add")}</Link></span>
          </div>
        )}
      </div>
      <ExpenseTabs current="all" />

      {queue.length > 0 && (
        <section className="card section" aria-labelledby="exp-queue-title" data-expense-queue>
          <h2 className="card-title" id="exp-queue-title">{t("expenses.queue.title", { n: queue.length })}</h2>
          <p className="hint"><Icon name="wifi-off" size={16} /><span>{t("expenses.queue.hint")}</span></p>
          <ul className="exp-queue">
            {queue.map((q) => (
              <li key={q.id}>
                <span>{q.label}{q.error ? <span className="field-error"><Icon name="alert" size={16} />{q.error}</span> : null}</span>
                <button type="button" className="link-btn" onClick={() => discardQueued(q.id)}>{t("sync.discard")}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {finance && !!noAccount && fl.paid !== "noAccount" && (
        <div className="banner warning" role="status" data-no-account><Icon name="alert" />
          <span className="text">{t("expenses.list.noAccount", { n: noAccount })} <button type="button" className="link-btn" onClick={() => setFl({ ...NO_FILTERS, paid: "noAccount" })}>{t("expenses.list.showThem")}</button></span></div>
      )}

      <section className="table-block" aria-label={title}>
        <div className="table-tools exp-filters" data-expense-filters>
          <label className="table-search"><Icon name="search" /><span className="sr-only">{t("expenses.filter.search")}</span>
            <input className="input" type="search" value={fl.q} placeholder={t("expenses.filter.searchHint")} onChange={(e) => set("q", e.target.value)} /></label>
          <label className="table-filter"><span className="sr-only">{t("expenses.col.project")}</span>
            <select className="input" value={fl.project} onChange={(e) => set("project", e.target.value)} data-filter="project">
              {!site && <option value="">{t("expenses.col.project")}: {t("table.all")}</option>}
              {finance && <option value={OFFICE}>{t("expenses.form.office")}</option>}
              {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="table-filter"><span className="sr-only">{t("expenses.col.category")}</span>
            <select className="input" value={fl.category} onChange={(e) => set("category", e.target.value)} data-filter="category">
              <option value="">{t("expenses.col.category")}: {t("table.all")}</option>
              {catOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select></label>
          <label className="table-filter"><span className="sr-only">{t("expenses.col.status")}</span>
            <select className="input" value={fl.status} onChange={(e) => set("status", e.target.value)} data-filter="status">
              <option value="">{t("expenses.col.status")}: {t("table.all")}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`expenses.status.${s}`)}</option>)}
            </select></label>
          <label className="table-filter"><span className="sr-only">{t("expenses.col.paid")}</span>
            <select className="input" value={fl.paid} onChange={(e) => set("paid", e.target.value)} data-filter="paid">
              <option value="">{t("expenses.col.paid")}: {t("table.all")}</option>
              <option value="paid">{t("expenses.filter.paid")}</option>
              <option value="unpaid">{t("expenses.filter.unpaid")}</option>
              {finance && <option value="noAccount">{t("expenses.filter.noAccount")}</option>}
            </select></label>
          <label className="table-filter exp-date"><span>{t("expenses.filter.from")}</span>
            <input className="input" inputMode="numeric" placeholder="DD/MM/YYYY" value={fl.from} onChange={(e) => set("from", e.target.value)} data-filter="from" aria-invalid={!!fl.from && !isIso(from)} /></label>
          <label className="table-filter exp-date"><span>{t("expenses.filter.to")}</span>
            <input className="input" inputMode="numeric" placeholder="DD/MM/YYYY" value={fl.to} onChange={(e) => set("to", e.target.value)} data-filter="to" aria-invalid={!!fl.to && !isIso(to)} /></label>
          <span className="table-tools-end">
            {filtered && <Button size="sm" onClick={() => setFl({ ...NO_FILTERS, project: site ? fl.project : "" })} data-clear><Icon name="x" />{t("expenses.filter.clear")}</Button>}
            <Button size="sm" onClick={() => void exportCsv()} disabled={busy !== null || !items?.length}><Icon name="download" />{busy === "csv" ? t("table.exporting") : t("table.export")}</Button>
          </span>
        </div>

        {page.error ? (
          <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{page.error}</span></div>
        ) : !ready || items === undefined ? (
          site && projects && projects.length === 0 ? <EmptyState icon="info" title={t("expenses.list.noProject")} body={t("expenses.list.noProjectBody")} /> : <Skeleton lines={6} />
        ) : items.length === 0 ? (
          <EmptyState icon="receipt" title={filtered ? t("table.noMatch") : t("expenses.list.empty")} body={filtered ? t("table.noMatchBody") : t("expenses.list.emptyBody")}
            action={!filtered && canAdd ? <Link className="btn btn-primary" href="/expenses/new/"><Icon name="plus" />{t("expenses.list.add")}</Link> : undefined} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data" data-expense-table>
                <caption className="sr-only">{title}</caption>
                <thead><tr>
                  <th scope="col" aria-sort={sort.field === "date" ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                    <button type="button" className="th-sort" onClick={() => sortBy("date")}>{t("expenses.col.date")}<Icon name={sortIcon("date")} size={14} /></button></th>
                  <th scope="col">{t("expenses.col.category")}</th>
                  <th scope="col">{t("expenses.col.project")}</th>
                  <th scope="col">{t("expenses.col.payee")}</th>
                  <th scope="col" className="num" aria-sort={sort.field === "amountPaise" ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                    <button type="button" className="th-sort" onClick={() => sortBy("amountPaise")}>{t("expenses.col.amount")}<Icon name={sortIcon("amountPaise")} size={14} /></button></th>
                  <th scope="col">{t("expenses.col.mode")}</th>
                  <th scope="col">{t("expenses.col.status")}</th>
                  <th scope="col">{t("expenses.col.enteredBy")}</th>
                  <th scope="col"><span className="sr-only">{t("table.actions")}</span></th>
                </tr></thead>
                <tbody>
                  {items.map((e) => {
                    const mayEdit = !!me && !editRefusal(e, me);
                    const mayApprove = !!me && canApproveExpense(e, me, limits);
                    const waitsForOther = !!me && e.approvalStatus === "pending" && !e.isDeleted && !mayApprove && (finance || role === "pm");
                    const mayPay = finance && e.source === "manual" && isUnpaidCredit(e);
                    return (
                      <tr key={e.id} data-expense={e.id} data-status={e.isDeleted ? "deleted" : e.approvalStatus}>
                        <td data-label={t("expenses.col.date")}>{date(e.date, lang)}</td>
                        <td data-label={t("expenses.col.category")} className="card-head">
                          <Link href={`/expenses/view/?id=${e.id}`} className="row-link">{categoryLabel(tree, e.categoryId, lang) || t("expenses.col.category")}</Link>
                          {e.description ? <span className="exp-sub">{e.description}</span> : null}
                        </td>
                        <td data-label={t("expenses.col.project")}>{e.projectName ?? t("expenses.form.office")}</td>
                        <td data-label={t("expenses.col.payee")}>{e.payeeName || "—"}</td>
                        <td data-label={t("expenses.col.amount")} className="num">{money(e.amountPaise)}</td>
                        <td data-label={t("expenses.col.mode")}>{t(`expenses.modes.${e.mode}`)}</td>
                        <td data-label={t("expenses.col.status")}><ExpenseBadges e={e} /></td>
                        <td data-label={t("expenses.col.enteredBy")}>{e.enteredBy === "system" ? t("expenses.system") : e.enteredByName ?? "—"}</td>
                        <td data-label={t("table.actions")} className="row-actions">
                          <DM.Root>
                            <DM.Trigger asChild>
                              <button type="button" className="icon-btn" aria-label={t("table.actionsFor", { name: `${money(e.amountPaise)} ${e.payeeName ?? ""}`.trim() })} data-row-menu><Icon name="more-v" /></button>
                            </DM.Trigger>
                            <DM.Portal>
                              <DM.Content className="menu" align="end" sideOffset={4}>
                                <DM.Item className="menu-item" onSelect={() => router.push(`/expenses/view/?id=${e.id}`)}>{t("common.open")}</DM.Item>
                                {mayApprove && <DM.Item className="menu-item" onSelect={() => setApprove(e)} data-action="approve">{t("expenses.approve.action")}</DM.Item>}
                                {mayApprove && <DM.Item className="menu-item" onSelect={() => setReject(e)} data-action="reject">{t("expenses.reject.action")}</DM.Item>}
                                {waitsForOther && <DM.Item className="menu-item" disabled>{t(`expenses.refusal.${approvalKey(approvalRefusal(e, me!, limits) ?? "")}`)}</DM.Item>}
                                {mayPay && <DM.Item className="menu-item" onSelect={() => setPaid(e)} data-action="paid">{t("expenses.paid.action")}</DM.Item>}
                                {mayEdit && <DM.Item className="menu-item" onSelect={() => router.push(`/expenses/edit/?id=${e.id}`)} data-action="edit">{t("common.edit")}</DM.Item>}
                                {mayEdit && <DM.Item className="menu-item destructive" onSelect={() => setDel(e)} data-action="delete">{t("common.delete")}</DM.Item>}
                              </DM.Content>
                            </DM.Portal>
                          </DM.Root>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="exp-totals" role="group" aria-label={t("expenses.totals.label")} data-expense-totals data-scope={shown ? "all" : "page"}>
              <b className="exp-totals-title">{shown ? t("expenses.totals.all", { n: page.total }) : t("expenses.totals.page", { n: items.length, total: page.total })}</b>
              <dl>
                <div><dt>{t("expenses.totals.approved")}</dt><dd data-total="approved">{money((shown ?? pageTotals).approvedPaise)}</dd></div>
                <div><dt>{t("expenses.totals.gst")}</dt><dd>{money((shown ?? pageTotals).gstPaise)}</dd></div>
                <div><dt>{t("expenses.totals.waiting")}</dt><dd data-total="waiting">{money((shown ?? pageTotals).waitingPaise)}</dd></div>
                <div><dt>{t("expenses.totals.unpaid")}</dt><dd>{money((shown ?? pageTotals).unpaidPaise)}</dd></div>
              </dl>
              {!shown && (page.total <= SUM_CAP
                ? <Button size="sm" onClick={() => void addUp()} disabled={busy !== null} data-add-up>{busy === "sum" ? t("common.working") : t("expenses.totals.addUp", { n: page.total })}</Button>
                : <span className="muted small">{t("expenses.totals.tooMany", { cap: SUM_CAP })}</span>)}
              <p className="muted small">{t("expenses.totals.note")}</p>
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

      <ApproveExpensesDialog items={approve ? [approve] : null} onClose={() => setApprove(null)} />
      <RejectExpenseDialog expense={reject} onClose={() => setReject(null)} />
      <DeleteExpenseDialog expense={del} onClose={() => setDel(null)} />
      <MarkPaidDialog expense={paid} onClose={() => setPaid(null)} />
    </AppShell>
  );
}
