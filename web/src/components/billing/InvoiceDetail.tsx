"use client";
// One bill (spec §8.3): who it is to, the lines, the totals with CGST + SGST or IGST, the deductions, what is still to
// come in, and its status. A draft can be changed, issued (after a confirmation: it gets its number and is locked) or
// set aside. An issued bill can be printed, cancelled with a reason, or corrected with a credit or debit note.
import {
  BILLED_INVOICE_TYPES, BILL_GST_RATES_BP, CommandError, computeBill, formatBp, formatQty, groupBySection, invoiceDuePaise, isFinanceReader, isFinanceRole,
  isIssuedInvoice, lineTaxable, raCarryForward, todayIST, type BillingInvoice,
} from "@ag/core";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess, NotFoundRecord } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog, Skeleton, useToast } from "@/components/ui/feedback";
import { DateField, MoneyField, SelectField, TextField, fromDate, toDate, toPaise } from "@/components/ui/form";
import { useDoc, useDocStatus, useRead, useRun, useSession } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";
import { useParam } from "@/lib/params";
import { InvoiceBadge, RaBox, TotalsBox, invoicePrintSpec, useCompany, useLang } from "./common";

type Open = null | "issue" | "setAside" | "cancel" | "credit_note" | "debit_note";
const NONE = { items: [] as BillingInvoice[], next: null, total: 0 };

export function InvoiceDetail() {
  const { t } = useTranslation();
  const lang = useLang();
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const company = useCompany();
  const id = useParam("id");
  const inv = useDoc<BillingInvoice>("invoices", id);
  const status = useDocStatus("invoices", id);
  const [open, setOpen] = useState<Open>(null);
  const reader = !!session && isFinanceReader(session.role);
  // Credit and debit notes made against this bill.
  const notes = useRead(`bill-notes:${id}:${reader}`, (s) => (id && reader
    ? s.query<BillingInvoice>("invoices", { where: [{ field: "againstInvoiceId", op: "==", value: id }], limit: 50 }) : Promise.resolve(NONE)));
  // Running bills saved before the carry-forward was kept on the bill: worked out from the project's earlier bills.
  const needRa = !!inv && inv.type === "ra" && !inv.ra && !!inv.totals;
  const earlier = useRead(`bill-ra-view:${needRa ? inv!.projectId : ""}`, (s) => (needRa
    ? s.query<BillingInvoice>("invoices", { where: [{ field: "projectId", op: "==", value: inv!.projectId }], orderBy: [{ field: "date", dir: "desc" }], limit: 50 }) : Promise.resolve(NONE)));

  const title = t("billing.detail.title");
  const crumbs = [{ label: t("nav.billing"), href: "/billing/" }, { label: title }];
  const shell = (body: ReactNode) => <AppShell nav="billing" title={title} crumbs={crumbs}>{body}</AppShell>;
  if (id === undefined || status === undefined || !session) return shell(<Skeleton lines={6} />);
  if (!reader || status === "denied") return shell(<NoAccess name={title} />);
  if (!inv || !inv.totals) return shell(<NotFoundRecord name={title} back="/billing/" backLabel={t("billing.detail.backToList")} />);

  const finance = isFinanceRole(session.role);
  const totals = inv.totals;
  const issued = isIssuedInvoice(inv);
  const draft = inv.status === "draft";
  const isNote = inv.type === "credit_note" || inv.type === "debit_note";
  const canNote = finance && issued && BILLED_INVOICE_TYPES.includes(inv.type);
  const billed = issued && inv.type !== "proforma" && inv.type !== "credit_note";
  const ra = inv.ra ?? (needRa && earlier
    ? raCarryForward(earlier.items.filter((i) => i.type !== "ra" || i.date < inv.date || (i.date === inv.date && i.id < inv.id)), { id: inv.id, projectId: inv.projectId, taxablePaise: totals.taxablePaise, totalPaise: totals.totalPaise })
    : null);
  const name = inv.number ?? t("billing.detail.draftTitle");
  let n = 0;

  const act = async (fn: () => Promise<string>) => {
    try { toast(await fn()); } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
  };
  const rows: [string, ReactNode][] = [
    [t("billing.col.kind"), t(`billing.type.${inv.type}`)],
    [t("billing.col.number"), inv.number ?? t("billing.detail.noNumberYet")],
    ...(isNote && inv.againstInvoiceId ? [[t("billing.detail.against"), <Link key="a" href={`/billing/invoices/view/?id=${inv.againstInvoiceId}`}>{inv.againstInvoiceNumber}</Link>] as [string, ReactNode]] : []),
    ...(inv.noteReason ? [[t("billing.note.reason"), inv.noteReason] as [string, ReactNode]] : []),
    [t("billing.col.date"), date(inv.date, lang)],
    ...(isNote ? [] : [[t("billing.form.dueDate"), date(inv.dueDate, lang)] as [string, ReactNode]]),
    [t("billing.col.client"), finance ? <Link href={`/clients/view/?id=${inv.clientId}`}>{inv.clientName}</Link> : inv.clientName ?? ""],
    ...(inv.clientGstin ? [[t("billing.detail.gstin"), inv.clientGstin] as [string, ReactNode]] : []),
    [t("billing.col.project"), finance ? <Link href={`/projects/view/?id=${inv.projectId}`}>{inv.projectName}</Link> : inv.projectName ?? ""],
    [t("billing.form.pos"), `${inv.placeOfSupply} · ${totals.igstPaise > 0 ? t("billing.totals.inter") : t("billing.totals.intra")}`],
    ...(inv.quotationId && finance ? [[t("billing.detail.fromQuotation"), <Link key="q" href={`/billing/quotations/view/?id=${inv.quotationId}`}>{t("billing.detail.openQuotation")}</Link>] as [string, ReactNode]] : []),
    ...(inv.notes ? [[t("billing.form.notes"), inv.notes] as [string, ReactNode]] : []),
  ];

  return shell(
    <>
      <div className="page-head">
        <div className="heading">
          <h1 data-bill-number>{name}</h1>
          <p className="sub">{t(`billing.type.${inv.type}`)} · {inv.clientName} · {money(totals.totalPaise)}</p>
        </div>
        <div className="page-actions" data-bill-actions>
          <InvoiceBadge inv={inv} />
          {finance && draft && <Button variant="primary" onClick={() => setOpen("issue")} data-issue><Icon name="check" />{t("billing.detail.issue")}</Button>}
          {finance && draft && <Link className="btn btn-secondary" href={`/billing/invoices/edit/?id=${inv.id}`} data-edit><Icon name="edit" />{t("common.edit")}</Link>}
          <Link className="btn btn-secondary" href={`/billing/document/?type=invoice&id=${inv.id}`} data-print><Icon name="printer" />{t("billing.detail.print")}</Link>
          {canNote && <Button variant="secondary" onClick={() => setOpen("credit_note")} data-credit-note>{t("billing.detail.creditNote")}</Button>}
          {canNote && <Button variant="secondary" onClick={() => setOpen("debit_note")} data-debit-note>{t("billing.detail.debitNote")}</Button>}
          {finance && issued && inv.type === "proforma" && <Link className="btn btn-secondary" href={`/billing/invoices/new/?from=${inv.id}`} data-make-tax>{t("billing.detail.makeTax")}</Link>}
          {finance && draft && <Button variant="destructive" onClick={() => setOpen("setAside")} data-set-aside><Icon name="x" />{t("billing.detail.setAside")}</Button>}
          {finance && issued && <Button variant="destructive" onClick={() => setOpen("cancel")} data-cancel><Icon name="x" />{t("billing.detail.cancel")}</Button>}
        </div>
      </div>

      {draft && <div className="banner info" role="status" data-draft><Icon name="file-text" /><span className="text">{t("billing.detail.draftBanner")}</span></div>}
      {inv.status === "cancelled" && (
        <div className="banner warning" role="status" data-cancelled><Icon name="x" />
          <span className="text"><b>{inv.number ? t("billing.detail.cancelledBanner", { number: inv.number }) : t("billing.detail.setAsideBanner")}</b> {inv.cancelReason}</span></div>
      )}
      {issued && <p className="hint" data-locked><Icon name="lock" size={16} /><span>{t("billing.detail.lockedNote")}</span></p>}
      {!finance && <p className="hint" data-read-only><Icon name="info" size={16} /><span>{t("billing.list.readOnly")}</span></p>}
      {inv.postingError ? <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{inv.postingError}</span></div> : null}

      <div className="bill-detail-grid">
        <section className="card" aria-labelledby="bill-d-title">
          <h2 className="card-title" id="bill-d-title">{t("billing.detail.details")}</h2>
          <dl className="kv bill-kv" data-bill-details>
            {rows.map(([k, val], i) => <div key={`${k}-${i}`} className="bill-kv-row"><dt>{k}</dt><dd>{val}</dd></div>)}
          </dl>
        </section>

        <section className="card" aria-labelledby="bill-m-title">
          <h2 className="card-title" id="bill-m-title">{t("billing.totals.title")}</h2>
          <TotalsBox totals={totals} deductions={inv.deductions ?? []} netPaise={inv.netReceivablePaise} words={inv.amountInWords} />
          {billed && (
            <dl className="kv bill-money" data-bill-money>
              <dt>{t("billing.totals.received")}</dt><dd data-money="received">{money(inv.paidPaise ?? 0)}</dd>
              {(inv.creditedPaise ?? 0) > 0 && <><dt>{t("billing.totals.credited")}</dt><dd data-money="credited">{money(inv.creditedPaise)}</dd></>}
              <dt className="total">{t("billing.totals.due")}</dt><dd className="total" data-money="due">{money(invoiceDuePaise(inv))}</dd>
            </dl>
          )}
          {billed && (inv.debitedPaise ?? 0) > 0 && <p className="muted small">{t("billing.totals.debited", { amount: money(inv.debitedPaise) })}</p>}
          {ra && <RaBox ra={ra} />}
        </section>

        <section className="card bill-wide" aria-labelledby="bill-l-title">
          <h2 className="card-title" id="bill-l-title">{t("billing.items.title")}</h2>
          <div className="table-wrap">
            <table className="data" data-bill-lines>
              <caption className="sr-only">{t("billing.items.title")}</caption>
              <thead><tr>
                <th scope="col">{t("billing.print.sn")}</th><th scope="col">{t("billing.items.description")}</th><th scope="col">{t("billing.items.hsn")}</th>
                <th scope="col" className="num">{t("billing.items.qty")}</th><th scope="col" className="num">{t("billing.items.rate")}</th>
                <th scope="col" className="num">{t("billing.items.gst")}</th><th scope="col" className="num">{t("billing.items.amount")}</th>
              </tr></thead>
              {groupBySection(inv.items).map((g, gi) => (
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

        {!!notes?.items.length && (
          <section className="card bill-wide" aria-labelledby="bill-n-title">
            <h2 className="card-title" id="bill-n-title">{t("billing.detail.notesAgainst")}</h2>
            <ul className="bill-links" data-bill-notes>
              {notes.items.map((x) => (
                <li key={x.id}>
                  <Link href={`/billing/invoices/view/?id=${x.id}`}>{x.number}</Link>
                  <span>{t(`billing.type.${x.type}`)} · {date(x.date, lang)} · {money(x.totals?.totalPaise)}</span>
                  <InvoiceBadge inv={x} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <ConfirmDialog open={open === "issue"} onOpenChange={(o) => setOpen(o ? "issue" : null)} destructive={false}
        title={t("billing.detail.issueTitle")} body={t("billing.detail.issueBody", { total: money(totals.totalPaise), client: inv.clientName ?? "" })} confirmLabel={t("billing.detail.issueConfirm")}
        onConfirm={() => act(async () => { const r = await run("issueInvoice", { id: inv.id }); return t("billing.detail.issued", { number: r.number }); })} />
      <ConfirmDialog open={open === "setAside"} onOpenChange={(o) => setOpen(o ? "setAside" : null)}
        title={t("billing.detail.setAsideTitle")} body={t("billing.detail.setAsideBody")} confirmLabel={t("billing.detail.setAside")}
        onConfirm={() => act(async () => { await run("cancelInvoice", { id: inv.id }); return t("billing.detail.setAsideDone"); })} />
      <CancelDialog inv={open === "cancel" ? inv : null} onClose={() => setOpen(null)} />
      <NoteDialog inv={open === "credit_note" || open === "debit_note" ? inv : null} kind={open === "debit_note" ? "debit_note" : "credit_note"} onClose={() => setOpen(null)} />
    </>,
  );
}

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const go = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFields({});
    try { await fn(); onDone(); } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof CommandError) setFields(e.fields);
    } finally { setBusy(false); }
  };
  return { busy, error, fields, go };
}

/** Cancel an issued bill: asks first, and needs the reason. */
function CancelDialog({ inv, onClose }: { inv: BillingInvoice | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!inv} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={t("billing.detail.cancelTitle", { number: inv?.number ?? "" })} description={t("billing.detail.cancelBody")}>
        {inv ? <CancelBody key={inv.id} inv={inv} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CancelBody({ inv, onClose }: { inv: BillingInvoice; onClose: () => void }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const a = useAction(onClose);
  return (
    <>
      <TextField label={t("billing.detail.reason")} hint={t("billing.detail.reasonHint")} value={reason} onChange={setReason} error={a.fields.reason} required />
      {a.error && !a.fields.reason ? <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{a.error}</span></div> : null}
      <DialogActions>
        <DialogClose asChild><Button variant="secondary">{t("common.goBack")}</Button></DialogClose>
        <Button variant="destructive" disabled={a.busy || reason.trim().length < 3} data-confirm-cancel
          onClick={() => void a.go(async () => { await run("cancelInvoice", { id: inv.id, reason }); toast(t("billing.detail.cancelled", { number: inv.number ?? "" })); })}>
          {a.busy ? t("common.working") : t("billing.detail.cancelConfirm")}
        </Button>
      </DialogActions>
    </>
  );
}

/** A credit or debit note against an issued bill: one line (what it is for, the amount before tax, the GST rate), the date and the reason. */
function NoteDialog({ inv, kind, onClose }: { inv: BillingInvoice | null; kind: "credit_note" | "debit_note"; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!inv} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={t(`billing.note.title.${kind}`, { number: inv?.number ?? "" })} description={t(`billing.note.body.${kind}`)}>
        {inv ? <NoteBody key={`${inv.id}-${kind}`} inv={inv} kind={kind} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function NoteBody({ inv, kind, onClose }: { inv: BillingInvoice; kind: "credit_note" | "debit_note"; onClose: () => void }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const company = useCompany();
  const [description, setDescription] = useState(t(`billing.note.default.${kind}`, { number: inv.number ?? "" }));
  const [amount, setAmount] = useState("");
  const [gst, setGst] = useState(String(inv.items[0]?.gstRateBp ?? 1800));
  const [on, setOn] = useState(fromDate(todayIST()));
  const [reason, setReason] = useState("");
  const a = useAction(onClose);
  const paise = toPaise(amount);
  const item = { description, qtyMilli: 1000, ratePaise: paise, gstRateBp: Number(gst) };
  const total = Number.isInteger(paise) && paise > 0 ? computeBill([item], company.stateCode, inv.placeOfSupply).totals.totalPaise : 0;
  const left = (inv.totals?.totalPaise ?? 0) - (inv.creditedPaise ?? 0);
  const itemError = a.fields.items ?? a.fields["items.0.ratePaise"] ?? a.fields["items.0.description"];
  return (
    <>
      <TextField label={t("billing.note.description")} value={description} onChange={setDescription} error={a.fields["items.0.description"]} required />
      <MoneyField label={t("billing.note.amount")} hint={kind === "credit_note" ? t("billing.note.left", { amount: money(left) }) : t("billing.note.amountHint")} value={amount} onChange={setAmount} error={a.fields.items ?? a.fields["items.0.ratePaise"]} required />
      <SelectField label={t("billing.items.gst")} value={gst} onChange={setGst} options={BILL_GST_RATES_BP.map((bp) => ({ value: String(bp), label: bp === 0 ? t("billing.items.none") : formatBp(bp) }))} />
      <DateField label={t("billing.col.date")} value={on} onChange={setOn} error={a.fields.date} required />
      <TextField label={t("billing.note.reason")} hint={t("billing.note.reasonHint")} value={reason} onChange={setReason} error={a.fields.reason} required />
      {total > 0 && <p className="hint" data-note-total><Icon name="info" size={16} /><span>{t("billing.note.total", { total: money(total) })}</span></p>}
      {a.error && !itemError && !a.fields.date && !a.fields.reason ? <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{a.error}</span></div> : null}
      <DialogActions>
        <DialogClose asChild><Button variant="secondary">{t("common.goBack")}</Button></DialogClose>
        <Button variant="primary" disabled={a.busy || total <= 0 || reason.trim().length < 3} data-confirm-note
          onClick={() => void a.go(async () => {
            const r = await run(kind === "credit_note" ? "createCreditNote" : "createDebitNote", { invoiceId: inv.id, date: toDate(on), reason, items: [item] });
            toast(t("billing.note.made", { number: r.number }));
          })}>
          {a.busy ? t("common.working") : t(`billing.note.confirm.${kind}`, { total: total > 0 ? money(total) : "" })}
        </Button>
      </DialogActions>
    </>
  );
}
