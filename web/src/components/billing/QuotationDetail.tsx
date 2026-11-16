"use client";
// One quotation (spec §8.2): the lines under their section headings, totals, what is included and left out, terms,
// its versions, and what can be done next: send a draft, mark a sent one accepted, rejected or expired, revise it
// (the next version, same number), or make a bill from an accepted one. Each step asks first.
import {
  CommandError, DRAFT_INVOICE_TYPES, formatBp, formatQty, groupBySection, isFinanceRole, lineTaxable, quotationItems, quotationShownStatus, todayIST,
  type InvoiceType, type Quotation, type QuotationStatus,
} from "@ag/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess, NotFoundRecord } from "@/components/ModulePage";
import { openPrintDoc } from "@/components/shared/printDoc";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog, Skeleton, useToast } from "@/components/ui/feedback";
import { SelectField } from "@/components/ui/form";
import { useDoc, useDocStatus, useRead, useRun, useSession } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";
import { useParam } from "@/lib/params";
import { QuotationBadge, TotalsBox, quotationName, quotationPrintSpec, useCompany, useLang, useProjects } from "./common";

type Open = null | "send" | "accepted" | "rejected" | "expired" | "bill";
const NONE = { items: [] as Quotation[], next: null, total: 0 };

export function QuotationDetail() {
  const { t } = useTranslation();
  const lang = useLang();
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const company = useCompany();
  const id = useParam("id");
  const q = useDoc<Quotation>("quotations", id);
  const status = useDocStatus("quotations", id);
  const [open, setOpen] = useState<Open>(null);
  const finance = !!session && isFinanceRole(session.role);
  const root = q?.rootQuotationId ?? "";
  const versions = useRead(`bill-q-versions:${root}:${finance}`, (s) => (root && finance
    ? s.query<Quotation>("quotations", { where: [{ field: "rootQuotationId", op: "==", value: root }], orderBy: [{ field: "version", dir: "asc" }], limit: 50 }) : Promise.resolve(NONE)));

  const title = t("billing.q.detailTitle");
  const crumbs = [{ label: t("nav.billing"), href: "/billing/quotations/" }, { label: title }];
  const shell = (body: ReactNode) => <AppShell nav="billing" title={title} crumbs={crumbs}>{body}</AppShell>;
  if (id === undefined || status === undefined || !session) return shell(<Skeleton lines={6} />);
  if (!finance || status === "denied") return shell(<NoAccess name={title} />);
  if (!q) return shell(<NotFoundRecord name={title} back="/billing/quotations/" backLabel={t("billing.q.backToList")} />);

  const name = quotationName(q, t);
  const shown = quotationShownStatus(q, todayIST());
  const live = q.isLatest;
  const draft = q.status === "draft";
  const decided = q.status === "accepted";
  const canMark = live && !draft && !decided;
  const items = quotationItems(q);
  let n = 0;
  const act = async (fn: () => Promise<string>) => {
    try { toast(await fn()); } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
  };
  const mark = (to: QuotationStatus) => act(async () => { await run("setQuotationStatus", { id: q.id, status: to }); return t(`billing.q.marked.${to}`); });
  const rows: [string, ReactNode][] = [
    [t("billing.col.number"), name],
    ...(q.title ? [[t("billing.q.title"), q.title] as [string, ReactNode]] : []),
    [t("billing.col.client"), <Link key="c" href={`/clients/view/?id=${q.clientId}`}>{q.clientName}</Link>],
    ...(q.projectId ? [[t("billing.col.project"), <Link key="p" href={`/projects/view/?id=${q.projectId}`}>{q.projectName}</Link>] as [string, ReactNode]] : []),
    [t("billing.col.date"), date(q.date, lang)],
    [t("billing.q.validUntil"), `${date(q.validUntil, lang)}${shown === "expired" && q.status !== "expired" ? ` · ${t("billing.q.pastValidity")}` : ""}`],
    [t("billing.form.pos"), `${q.placeOfSupply} · ${q.intraState ? t("billing.totals.intra") : t("billing.totals.inter")}`],
    ...(q.statusNote ? [[t("billing.q.statusNote"), q.statusNote] as [string, ReactNode]] : []),
    ...(q.notes ? [[t("billing.form.notes"), q.notes] as [string, ReactNode]] : []),
  ];
  const texts: [string, string | undefined][] = [
    [t("billing.q.inclusions"), q.inclusions], [t("billing.q.exclusions"), q.exclusions], [t("billing.q.paymentTerms"), q.paymentTerms], [t("billing.q.terms"), q.terms],
  ];

  return shell(
    <>
      <div className="page-head">
        <div className="heading">
          <h1 data-quotation-number>{name}</h1>
          <p className="sub">{[q.title, q.clientName, money(q.totals.totalPaise)].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="page-actions" data-quotation-actions>
          <QuotationBadge q={q} />
          {live && draft && <Button variant="primary" onClick={() => setOpen("send")} data-send><Icon name="send" />{t("billing.q.send")}</Button>}
          {live && decided && <Button variant="primary" onClick={() => setOpen("bill")} data-make-bill><Icon name="file-text" />{t("billing.q.makeBill")}</Button>}
          {canMark && <Button variant="primary" onClick={() => setOpen("accepted")} data-mark="accepted"><Icon name="check" />{t("billing.q.accept")}</Button>}
          {canMark && q.status !== "rejected" && <Button variant="secondary" onClick={() => setOpen("rejected")} data-mark="rejected">{t("billing.q.reject")}</Button>}
          {canMark && q.status !== "expired" && <Button variant="secondary" onClick={() => setOpen("expired")} data-mark="expired">{t("billing.q.expire")}</Button>}
          {live && !decided && <Link className="btn btn-secondary" href={`/billing/quotations/edit/?id=${q.id}`} data-edit><Icon name="edit" />{draft ? t("common.edit") : t("billing.q.revise")}</Link>}
          <Button variant="secondary" onClick={() => openPrintDoc(quotationPrintSpec(q, company, t, lang))} data-print><Icon name="printer" />{t("billing.detail.print")}</Button>
        </div>
      </div>

      {draft && live && <div className="banner info" role="status" data-draft><Icon name="file-text" /><span className="text">{q.version > 1 ? t("billing.q.draftRevBanner", { n: q.version }) : t("billing.q.draftBanner")}</span></div>}
      {!live && (
        <div className="banner warning" role="status" data-older><Icon name="history" />
          <span className="text">{t("billing.q.olderBanner")} {q.supersededBy ? <Link href={`/billing/quotations/view/?id=${q.supersededBy}`}>{t("billing.q.openLatest")}</Link> : null}</span></div>
      )}

      <div className="bill-detail-grid">
        <section className="card" aria-labelledby="q-d-title">
          <h2 className="card-title" id="q-d-title">{t("billing.detail.details")}</h2>
          <dl className="kv bill-kv" data-quotation-details>
            {rows.map(([k, val], i) => <div key={`${k}-${i}`} className="bill-kv-row"><dt>{k}</dt><dd>{val}</dd></div>)}
          </dl>
        </section>

        <section className="card" aria-labelledby="q-m-title">
          <h2 className="card-title" id="q-m-title">{t("billing.totals.title")}</h2>
          <TotalsBox totals={q.totals} words={q.amountInWords} />
        </section>

        <section className="card bill-wide" aria-labelledby="q-l-title">
          <h2 className="card-title" id="q-l-title">{t("billing.items.title")}</h2>
          <div className="table-wrap">
            <table className="data" data-quotation-lines>
              <caption className="sr-only">{t("billing.items.title")}</caption>
              <thead><tr>
                <th scope="col">{t("billing.print.sn")}</th><th scope="col">{t("billing.items.description")}</th><th scope="col">{t("billing.items.hsn")}</th>
                <th scope="col" className="num">{t("billing.items.qty")}</th><th scope="col" className="num">{t("billing.items.rate")}</th>
                <th scope="col" className="num">{t("billing.items.gst")}</th><th scope="col" className="num">{t("billing.items.amount")}</th>
              </tr></thead>
              {groupBySection(items).map((g, gi) => (
                <tbody key={`${g.title}-${gi}`}>
                  {g.title ? <tr className="bill-section"><td colSpan={7} className="card-head">{g.title}</td></tr> : null}
                  {g.items.map((it) => (
                    <tr key={++n}>
                      <td data-label={t("billing.print.sn")}>{n}</td>
                      <td data-label={t("billing.items.description")} className="card-head">{it.description}</td>
                      <td data-label={t("billing.items.hsn")}>{it.hsnSac || "—"}</td>
                      <td data-label={t("billing.items.qty")} className="num">{formatQty(it.qtyMilli)} {it.unit ?? ""}</td>
                      <td data-label={t("billing.items.rate")} className="num">{money(it.ratePaise)}{it.discountBp ? ` − ${formatBp(it.discountBp)}` : ""}</td>
                      <td data-label={t("billing.items.gst")} className="num">{formatBp(it.gstRateBp)}</td>
                      <td data-label={t("billing.items.amount")} className="num">{money(lineTaxable(it))}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </section>

        {texts.some(([, s]) => s) && (
          <section className="card bill-wide" aria-labelledby="q-t-title">
            <h2 className="card-title" id="q-t-title">{t("billing.q.scope")}</h2>
            <div className="bill-texts">
              {texts.filter(([, s]) => s).map(([k, s]) => <div key={k}><h3>{k}</h3>{s!.split("\n").filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</div>)}
            </div>
          </section>
        )}

        {(versions?.items.length ?? 0) > 1 && (
          <section className="card" aria-labelledby="q-v-title">
            <h2 className="card-title" id="q-v-title">{t("billing.q.versions")}</h2>
            <ul className="bill-links" data-quotation-versions>
              {versions!.items.map((x) => (
                <li key={x.id} aria-current={x.id === q.id ? "true" : undefined}>
                  {x.id === q.id ? <b>{t("billing.q.version", { n: x.version })}</b> : <Link href={`/billing/quotations/view/?id=${x.id}`}>{t("billing.q.version", { n: x.version })}</Link>}
                  <span>{date(x.date, lang)} · {money(x.totals.totalPaise)}</span>
                  <QuotationBadge q={x} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {!!q.invoiceIds?.length && (
          <section className="card" aria-labelledby="q-b-title">
            <h2 className="card-title" id="q-b-title">{t("billing.q.bills")}</h2>
            <ul className="bill-links" data-quotation-bills>
              {q.invoiceIds.map((x, i) => <li key={x}><Link href={`/billing/invoices/view/?id=${x}`}>{t("billing.q.bill", { n: i + 1 })}</Link></li>)}
            </ul>
          </section>
        )}
      </div>

      <ConfirmDialog open={open === "send"} onOpenChange={(o) => setOpen(o ? "send" : null)} destructive={false}
        title={t("billing.q.sendTitle")} body={q.number ? t("billing.q.sendBodyRev", { name }) : t("billing.q.sendBody")} confirmLabel={t("billing.q.sendConfirm")}
        onConfirm={() => act(async () => { const r = await run("sendQuotation", { id: q.id }); return t("billing.q.sent", { name: r.label }); })} />
      {(["accepted", "rejected", "expired"] as const).map((to) => (
        <ConfirmDialog key={to} open={open === to} onOpenChange={(o) => setOpen(o ? to : null)} destructive={to !== "accepted"}
          title={t(`billing.q.markTitle.${to}`, { name })} body={t(`billing.q.markBody.${to}`)} confirmLabel={t(`billing.q.markConfirm.${to}`)} onConfirm={() => mark(to)} />
      ))}
      <MakeBillDialog q={open === "bill" ? q : null} onClose={() => setOpen(null)} />
    </>,
  );
}

/** Make a draft bill from an accepted quotation: choose the kind of bill, and the project when the quotation has none. */
function MakeBillDialog({ q, onClose }: { q: Quotation | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!q} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={t("billing.q.makeBillTitle")} description={t("billing.q.makeBillBody")}>
        {q ? <MakeBillBody key={q.id} q={q} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MakeBillBody({ q, onClose }: { q: Quotation; onClose: () => void }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const router = useRouter();
  const projects = useProjects();
  const [type, setType] = useState<InvoiceType>("tax");
  const [projectId, setProjectId] = useState(q.projectId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const options = (projects ?? []).filter((p) => p.clientId === q.clientId).map((p) => ({ value: p.id, label: p.name }));
  const go = async () => {
    if (busy) return;
    setBusy(true); setError(null); setFields({});
    try {
      const r = await run("convertQuotationToInvoice", { id: q.id, projectId: projectId || null, type });
      toast(t("billing.q.billMade"));
      onClose();
      router.push(`/billing/invoices/view/?id=${r.invoiceId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof CommandError) setFields(e.fields);
    } finally { setBusy(false); }
  };
  return (
    <>
      <SelectField label={t("billing.form.kind")} value={type} onChange={setType} options={DRAFT_INVOICE_TYPES.map((k) => ({ value: k, label: t(`billing.type.${k}`) }))} />
      {!q.projectId && (
        <SelectField label={t("billing.form.project")} value={projectId} onChange={setProjectId} error={fields.projectId} required
          placeholder={projects === undefined ? t("common.loading") : t("billing.form.chooseProject")} hint={projects && options.length === 0 ? t("billing.form.noProjects") : undefined} options={options} />
      )}
      {error && !fields.projectId ? <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{error}</span></div> : null}
      <DialogActions>
        <DialogClose asChild><Button variant="secondary">{t("common.goBack")}</Button></DialogClose>
        <Button variant="primary" disabled={busy || (!q.projectId && !projectId)} onClick={() => void go()} data-confirm-bill>{busy ? t("common.working") : t("billing.q.makeBillConfirm")}</Button>
      </DialogActions>
    </>
  );
}
