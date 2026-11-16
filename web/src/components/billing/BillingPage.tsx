"use client";
// Quotes and bills (spec §8.2, §8.3): two tabs, each a paged list (25 or 50 a page) with a status filter and a client
// filter. The owner and accountant make and change them; the CA reads the bills only; other roles are refused.
import { QUOTATION_STATUSES, isFinanceReader, isFinanceRole, type BillingInvoice, type Quotation, type Where } from "@ag/core";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { DataTable, type Column, type FilterDef } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/feedback";
import { useSession } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";
import { BillingTabs, InvoiceBadge, QuotationBadge, dueOf, invoiceStatusKey, quotationName, useClients, useLang } from "./common";

const LATEST: Where[] = [{ field: "isLatest", op: "==", value: true }];

export function BillingPage({ tab }: { tab: "invoices" | "quotations" }) {
  const { t } = useTranslation();
  const lang = useLang();
  const session = useSession();
  const clients = useClients();
  const finance = !!session && isFinanceRole(session.role);
  const title = t("nav.billing");

  const clientFilter: FilterDef[] = useMemo(() => (clients?.length ? [{
    key: "client", label: t("billing.col.client"), options: clients.map((c) => ({ value: c.id, label: c.name })), where: (v: string) => ({ field: "clientId", op: "==" as const, value: v }),
  }] : []), [clients, t]);

  const invoiceFilters: FilterDef[] = useMemo(() => [{
    key: "status", label: t("billing.col.status"),
    options: [
      { value: "draft", label: t("billing.status.draft") }, { value: "unpaid", label: t("billing.filter.unpaid") },
      { value: "paid", label: t("billing.status.paid") }, { value: "cancelled", label: t("billing.status.cancelled") },
    ],
    // "Not paid yet" is every issued bill with money still to come, overdue ones included.
    where: (v: string): Where => (v === "unpaid" ? { field: "status", op: "in", value: ["sent", "partially_paid", "overdue"] } : { field: "status", op: "==", value: v }),
  }, ...clientFilter], [clientFilter, t]);

  const quotationFilters: FilterDef[] = useMemo(() => [{
    key: "status", label: t("billing.col.status"), options: QUOTATION_STATUSES.map((s) => ({ value: s, label: t(`billing.qstatus.${s}`) })),
    where: (v: string): Where => ({ field: "status", op: "==", value: v }),
  }, ...clientFilter], [clientFilter, t]);

  const invoiceColumns: Column<BillingInvoice>[] = useMemo(() => [
    { key: "number", header: t("billing.col.number"), cardHead: true, cell: (r) => r.number ?? t("billing.list.draftNo"), csv: (r) => r.number ?? "" },
    { key: "kind", header: t("billing.col.kind"), cell: (r) => t(`billing.type.${r.type}`) },
    { key: "date", header: t("billing.col.date"), cell: (r) => date(r.date, lang), csv: (r) => r.date },
    { key: "client", header: t("billing.col.client"), cell: (r) => r.clientName ?? "" },
    { key: "project", header: t("billing.col.project"), cell: (r) => r.projectName ?? "" },
    { key: "total", header: t("billing.col.total"), align: "right", cell: (r) => money(r.totals?.totalPaise), csv: (r) => (r.totals?.totalPaise ?? 0) / 100 },
    { key: "due", header: t("billing.col.due"), align: "right", cell: (r) => money(dueOf(r)), csv: (r) => dueOf(r) / 100 },
    { key: "status", header: t("billing.col.status"), cell: (r) => <InvoiceBadge inv={r} />, csv: (r) => t(`billing.status.${invoiceStatusKey(r)}`) },
  ], [t, lang]);

  const quotationColumns: Column<Quotation>[] = useMemo(() => [
    { key: "number", header: t("billing.col.number"), cardHead: true, cell: (r) => quotationName(r, t), csv: (r) => (r.number ? quotationName(r, t) : "") },
    { key: "title", header: t("billing.col.title"), cell: (r) => r.title || r.projectName || "" },
    { key: "date", header: t("billing.col.date"), cell: (r) => date(r.date, lang), csv: (r) => r.date },
    { key: "client", header: t("billing.col.client"), cell: (r) => r.clientName ?? "" },
    { key: "total", header: t("billing.col.total"), align: "right", cell: (r) => money(r.totals?.totalPaise), csv: (r) => (r.totals?.totalPaise ?? 0) / 100 },
    { key: "validUntil", header: t("billing.col.validUntil"), cell: (r) => date(r.validUntil, lang), csv: (r) => r.validUntil },
    { key: "status", header: t("billing.col.status"), cell: (r) => <QuotationBadge q={r} />, csv: (r) => t(`billing.qstatus.${r.status}`) },
  ], [t, lang]);

  const shell = (body: ReactNode, actionBar = false) => <AppShell nav="billing" title={title} crumbs={[{ label: title }]} actionBar={actionBar}>{body}</AppShell>;
  if (!session) return shell(<Skeleton lines={6} />);
  // The CA reads bills (accounting records) but not quotations; site roles and the viewer read neither.
  if (!isFinanceReader(session.role) || (tab === "quotations" && !finance)) return shell(<NoAccess name={title} />);

  const newHref = tab === "invoices" ? "/billing/invoices/new/" : "/billing/quotations/new/";
  const newLabel = tab === "invoices" ? t("billing.list.newInvoice") : t("billing.list.newQuotation");
  return shell(
    <>
      <div className="page-head">
        <div className="heading"><h1>{title}</h1></div>
        {finance && (
          <div className="page-actions">
            <span className="action-bar"><Link className="btn btn-primary" href={newHref} data-billing-new><Icon name="plus" />{newLabel}</Link></span>
          </div>
        )}
      </div>
      <BillingTabs current={tab} />
      {!finance && <p className="hint" data-read-only><Icon name="lock" size={16} /><span>{t("billing.list.readOnly")}</span></p>}
      {clients === undefined ? <Skeleton lines={6} /> : tab === "invoices" ? (
        <div data-invoice-list>
          <DataTable<BillingInvoice> id="billing-invoices" collection="invoices" columns={invoiceColumns} filters={invoiceFilters} searchable={false}
            defaultSort={{ field: "date", dir: "desc" }} rowHref={(r) => `/billing/invoices/view/?id=${r.id}`} exportName="bills" caption={t("billing.list.caption")}
            empty={{ title: t("billing.list.empty"), body: t("billing.list.emptyBody"), action: finance ? <Link className="btn btn-primary" href={newHref}><Icon name="plus" />{newLabel}</Link> : undefined }} />
        </div>
      ) : (
        <div data-quotation-list>
          <DataTable<Quotation> id="billing-quotations" collection="quotations" columns={quotationColumns} filters={quotationFilters} baseWhere={LATEST} searchable={false}
            defaultSort={{ field: "date", dir: "desc" }} rowHref={(r) => `/billing/quotations/view/?id=${r.id}`} exportName="quotations" caption={t("billing.list.qCaption")}
            empty={{ title: t("billing.list.qEmpty"), body: t("billing.list.qEmptyBody"), action: <Link className="btn btn-primary" href={newHref}><Icon name="plus" />{newLabel}</Link> }} />
        </div>
      )}
    </>,
    finance,
  );
}
