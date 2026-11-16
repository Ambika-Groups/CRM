"use client";
// Pieces shared by the billing screens (spec §8.2, §8.3): the tabs, status badges, the client and project lists, the
// lines editor (cards that fit a 360 px phone), the live totals, and the printable document built from a bill or a
// quotation (shared/printDoc.ts opens it; a richer template is another feature).
import {
  BILL_GST_RATES_BP, COMMON_BILL_ITEMS, computeBill, formatBp, formatQty, groupBySection, invoiceDuePaise, isFinanceRole, isIssuedInvoice, lineTaxable,
  quotationItems, quotationLabel, quotationShownStatus, statusFromMoney, todayIST,
  type BillComputation, type BillDeductionInput, type BillItem, type BillTotals, type BillingInvoice, type Client, type InvoiceStatus, type PrintDocSpec,
  type PrintSection, type Project, type Quotation, type QuotationStatus, type RaSummary,
} from "@ag/core";
import type { TFunction } from "i18next";
import Link from "next/link";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { MoneyField, SelectField, TextField, fromBp, fromMilli, fromPaise, toBp, toMilli, toPaise } from "@/components/ui/form";
import { useRead, useSession, useSmall } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";

export function useLang(): "en" | "hi" {
  const { i18n } = useTranslation();
  return i18n.language === "hi" ? "hi" : "en";
}

export interface Company { name: string; stateCode: string; gstin: string; address: string }

/** The company's own details from Settings (the state decides CGST + SGST or IGST). */
export function useCompany(): Company {
  const doc = (useSmall<{ id: string }>("settings") ?? []).find((s) => s.id === "company") as Record<string, string> | undefined;
  return useMemo(() => ({
    name: doc?.tradeName || doc?.legalName || "Ambika Groups", stateCode: doc?.stateCode || "09", gstin: doc?.gstin ?? "", address: doc?.address ?? "",
  }), [doc]);
}

/** Clients for the pickers and filters (the owner and accountant; the first 50 by name). */
export function useClients(): Client[] | undefined {
  const session = useSession();
  const finance = !!session && isFinanceRole(session.role);
  const r = useRead(`bill-clients:${finance}`, (s) => (finance
    ? s.query<Client>("clients", { orderBy: [{ field: "name" }], limit: 50 })
    : Promise.resolve({ items: [] as Client[], next: null, total: 0 })));
  return r?.items.filter((c) => !c.isDeleted);
}

/** Open projects for the pickers (the owner and accountant). */
export function useProjects(): Project[] | undefined {
  const session = useSession();
  const finance = !!session && isFinanceRole(session.role);
  const r = useRead(`bill-projects:${finance}`, (s) => (finance
    ? s.query<Project>("projects", { where: [{ field: "isArchived", op: "==", value: false }], orderBy: [{ field: "name" }], limit: 50 })
    : Promise.resolve({ items: [] as Project[], next: null, total: 0 })));
  return r?.items.filter((p) => !p.isDeleted);
}

/** The tabs across the billing pages. Quotations are for the owner and accountant only. */
export function BillingTabs({ current }: { current: "invoices" | "quotations" }) {
  const { t } = useTranslation();
  const session = useSession();
  if (!session || !isFinanceRole(session.role)) return null;
  const tabs = [{ key: "invoices", href: "/billing/", label: t("billing.tabs.invoices") }, { key: "quotations", href: "/billing/quotations/", label: t("billing.tabs.quotations") }];
  return (
    <nav className="tabs" aria-label={t("billing.tabs.label")}>
      {tabs.map((x) => <Link key={x.key} href={x.href} aria-current={x.key === current ? "page" : undefined} data-billing-tab={x.key}>{x.label}</Link>)}
    </nav>
  );
}

// ───────────────────────── Status ─────────────────────────

const TONE: Record<string, { tone: "success" | "warning" | "error" | "neutral"; icon: string }> = {
  draft: { tone: "neutral", icon: "file-text" }, sent: { tone: "warning", icon: "clock" }, partially_paid: { tone: "warning", icon: "clock" },
  paid: { tone: "success", icon: "check-circle" }, overdue: { tone: "error", icon: "alert" }, cancelled: { tone: "neutral", icon: "x" },
  issued: { tone: "success", icon: "check" }, settled: { tone: "neutral", icon: "check" },
  viewed: { tone: "warning", icon: "eye" }, accepted: { tone: "success", icon: "check-circle" }, rejected: { tone: "error", icon: "x" }, expired: { tone: "neutral", icon: "clock" },
  older: { tone: "neutral", icon: "history" },
};

/** The status a bill shows today: overdue once the due date passes, "issued" for proformas and credit notes, "settled" when a credit note cleared it. */
export function invoiceStatusKey(inv: BillingInvoice, today = todayIST()): InvoiceStatus | "issued" | "settled" {
  if (!isIssuedInvoice(inv)) return inv.status;
  if (inv.type === "proforma" || inv.type === "credit_note") return "issued";
  const s = statusFromMoney(inv, today);
  return s === "paid" && (inv.paidPaise ?? 0) === 0 && (inv.creditedPaise ?? 0) > 0 ? "settled" : s;
}

export function InvoiceBadge({ inv }: { inv: BillingInvoice }) {
  const { t } = useTranslation();
  const key = invoiceStatusKey(inv);
  const b = TONE[key] ?? TONE.draft!;
  return <span className={`badge ${b.tone}`} data-status={key}><Icon name={b.icon} size={14} />{t(`billing.status.${key}`)}</span>;
}

export function QuotationBadge({ q }: { q: Quotation }) {
  const { t } = useTranslation();
  const key: QuotationStatus = quotationShownStatus(q, todayIST());
  const b = TONE[key] ?? TONE.draft!;
  return (
    <span className="bill-badges">
      <span className={`badge ${b.tone}`} data-status={key}><Icon name={b.icon} size={14} />{t(`billing.qstatus.${key}`)}</span>
      {!q.isLatest && <span className="badge neutral"><Icon name="history" size={14} />{t("billing.qstatus.older")}</span>}
    </span>
  );
}

/** A quotation's number with its revision, or "Draft" before it is sent. */
export function quotationName(q: Pick<Quotation, "number" | "version">, t: TFunction): string {
  return q.number ? quotationLabel(q.number, q.version) : q.version > 1 ? `${t("billing.list.draftNo")} (Rev ${q.version})` : t("billing.list.draftNo");
}

// ───────────────────────── Lines ─────────────────────────

/** One line as it is typed (text, so nothing typed is lost). */
export interface ItemRow { key: string; section: string; description: string; hsnSac: string; unit: string; qty: string; rate: string; discount: string; gstRate: string }

let rowSeq = 0;
const rowKey = () => `r${++rowSeq}`;
export const blankRow = (section = ""): ItemRow => ({ key: rowKey(), section, description: "", hsnSac: "", unit: "", qty: "", rate: "", discount: "", gstRate: "1800" });

export function rowsFromItems(items: BillItem[]): ItemRow[] {
  return items.map((it) => ({
    key: rowKey(), section: it.section ?? "", description: it.description, hsnSac: it.hsnSac ?? "", unit: it.unit ?? "", qty: fromMilli(it.qtyMilli),
    rate: fromPaise(it.ratePaise), discount: it.discountBp ? fromBp(it.discountBp) : "", gstRate: String(it.gstRateBp),
  }));
}

const isBlank = (r: ItemRow) => !r.description.trim() && !r.qty.trim() && !r.rate.trim();

/** The lines to send: rows left empty at the end are dropped; anything typed wrongly is sent as it is, so the command names it. */
export function itemsFromRows(rows: ItemRow[]): BillItem[] {
  const used = [...rows];
  while (used.length && isBlank(used[used.length - 1]!)) used.pop();
  return used.map((r) => {
    const discount = toBp(r.discount);
    return {
      description: r.description, qtyMilli: toMilli(r.qty), ratePaise: toPaise(r.rate), gstRateBp: Number(r.gstRate),
      ...(r.hsnSac.trim() ? { hsnSac: r.hsnSac.trim() } : {}), ...(r.unit.trim() ? { unit: r.unit.trim() } : {}),
      ...(discount !== undefined ? { discountBp: discount } : {}), ...(r.section.trim() ? { section: r.section.trim() } : {}),
    };
  });
}

const okItem = (it: BillItem) => Number.isInteger(it.qtyMilli) && it.qtyMilli > 0 && Number.isInteger(it.ratePaise) && it.ratePaise >= 0 && Number.isInteger(it.gstRateBp)
  && (it.discountBp === undefined || (Number.isInteger(it.discountBp) && it.discountBp >= 0 && it.discountBp <= 10000));

/** The value of one line before tax, or null while it is not yet a full line. */
export function rowAmount(r: ItemRow): number | null {
  const [it] = itemsFromRows([r]);
  return it && okItem(it) ? lineTaxable(it) : null;
}

/** Totals for what is typed so far (lines that are not complete yet are left out). Null when there is nothing to add up. */
export function previewBill(rows: ItemRow[], companyState: string, placeOfSupply: string, deductions: BillDeductionInput[] = []): BillComputation | null {
  const items = itemsFromRows(rows).filter(okItem);
  if (!items.length) return null;
  const okDeductions = deductions.filter((d) => d.head.trim() && Number.isInteger(d.rateBp) && d.rateBp >= 0 && d.rateBp <= 10000 && (d.overridePaise == null || (Number.isInteger(d.overridePaise) && d.overridePaise >= 0)));
  try { return computeBill(items, companyState, /^\d{2}$/.test(placeOfSupply) ? placeOfSupply : companyState, okDeductions); } catch { return null; }
}

/** The lines editor: one card per line, so every field has its label and fits a phone. */
export function ItemsEditor({ rows, onChange, errors }: { rows: ItemRow[]; onChange: (rows: ItemRow[]) => void; errors: Record<string, string> }) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<ItemRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const lastSection = rows.length ? rows[rows.length - 1]!.section : "";
  const addCommon = (key: string) => {
    const c = COMMON_BILL_ITEMS.find((x) => x.key === key);
    if (!c) return;
    const row: ItemRow = { ...blankRow(lastSection), description: c.description, unit: c.unit, hsnSac: c.hsnSac, gstRate: String(c.gstRateBp) };
    const keep = rows.length === 1 && isBlank(rows[0]!) ? [] : rows;
    onChange([...keep, row]);
  };
  return (
    <div className="bill-items" data-bill-items>
      {errors.items && <p className="field-error" role="alert"><Icon name="alert" size={16} />{errors.items}</p>}
      {rows.map((r, i) => {
        const e = (f: string) => errors[`items.${i}.${f}`];
        const amount = rowAmount(r);
        return (
          <fieldset key={r.key} className="bill-item" data-bill-item={i}>
            <legend>{t("billing.items.line", { n: i + 1 })}</legend>
            <button type="button" className="icon-btn bill-item-remove" aria-label={t("billing.items.remove", { n: i + 1 })} disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon name="trash" /></button>
            <div className="bill-item-wide">
              <TextField label={t("billing.items.description")} hint={i === 0 ? t("billing.items.descriptionHint") : undefined} value={r.description} onChange={(x) => set(i, { description: x })} error={e("description")} required />
            </div>
            <div className="bill-item-grid">
              <TextField label={t("billing.items.qty")} value={r.qty} onChange={(x) => set(i, { qty: x })} error={e("qtyMilli")} inputMode="decimal" required />
              <TextField label={t("billing.items.unit")} hint={i === 0 ? t("billing.items.unitHint") : undefined} value={r.unit} onChange={(x) => set(i, { unit: x })} />
              <MoneyField label={t("billing.items.rate")} value={r.rate} onChange={(x) => set(i, { rate: x })} error={e("ratePaise")} required />
              <SelectField label={t("billing.items.gst")} value={r.gstRate} onChange={(x) => set(i, { gstRate: x })} error={e("gstRateBp")}
                options={BILL_GST_RATES_BP.map((bp) => ({ value: String(bp), label: bp === 0 ? t("billing.items.none") : formatBp(bp) }))} />
              <TextField label={t("billing.items.hsn")} hint={i === 0 ? t("billing.items.hsnHint") : undefined} value={r.hsnSac} onChange={(x) => set(i, { hsnSac: x })} error={e("hsnSac")} inputMode="numeric" />
              <TextField label={t("billing.items.discount")} value={r.discount} onChange={(x) => set(i, { discount: x })} error={e("discountBp")} inputMode="decimal" />
              <TextField label={t("billing.items.section")} hint={i === 0 ? t("billing.items.sectionHint") : undefined} value={r.section} onChange={(x) => set(i, { section: x })} />
              <div className="bill-item-amount"><span>{t("billing.items.amount")}</span><b data-line-amount>{amount === null ? "—" : money(amount)}</b></div>
            </div>
          </fieldset>
        );
      })}
      <div className="bill-items-add">
        <Button variant="secondary" onClick={() => onChange([...rows, blankRow(lastSection)])} data-add-line><Icon name="plus" />{t("billing.items.add")}</Button>
        <label className="bill-common"><span className="sr-only">{t("billing.items.addCommon")}</span>
          <select className="input" value="" onChange={(ev) => addCommon(ev.target.value)} data-add-common>
            <option value="">{t("billing.items.addCommon")}</option>
            {COMMON_BILL_ITEMS.map((c) => <option key={c.key} value={c.key}>{c.description}</option>)}
          </select></label>
      </div>
    </div>
  );
}

// ───────────────────────── Totals ─────────────────────────

type Deducted = { head: string; rateBp: number; amountPaise: number; overridden?: boolean };

/** Totals of a bill or quotation: taxable value, CGST + SGST or IGST, round-off, total; then the deductions and the cash expected. */
export function TotalsBox({ totals, deductions = [], netPaise, words }: { totals: BillTotals; deductions?: Deducted[]; netPaise?: number; words?: string }) {
  const { t } = useTranslation();
  const inter = totals.igstPaise > 0;
  return (
    <div className="bill-totals" data-bill-totals>
      <dl className="kv">
        <dt>{t("billing.totals.taxable")}</dt><dd data-total="taxable">{money(totals.taxablePaise)}</dd>
        {inter
          ? <><dt>{t("billing.totals.igst")}</dt><dd data-total="igst">{money(totals.igstPaise)}</dd></>
          : <><dt>{t("billing.totals.cgst")}</dt><dd data-total="cgst">{money(totals.cgstPaise)}</dd><dt>{t("billing.totals.sgst")}</dt><dd data-total="sgst">{money(totals.sgstPaise)}</dd></>}
        {totals.roundOffPaise !== 0 && <><dt>{t("billing.totals.roundOff")}</dt><dd>{money(totals.roundOffPaise)}</dd></>}
        <dt className="total">{t("billing.totals.total")}</dt><dd className="total" data-total="total">{money(totals.totalPaise)}</dd>
        {deductions.map((d, i) => (
          <DedLine key={`${d.head}-${i}`} label={`${t("billing.totals.less")} ${d.head}${d.overridden || !d.rateBp ? "" : ` (${formatBp(d.rateBp)})`}`} amount={-d.amountPaise} />
        ))}
        {deductions.length > 0 && netPaise !== undefined && <><dt className="total">{t("billing.totals.net")}</dt><dd className="total" data-total="net">{money(netPaise)}</dd></>}
      </dl>
      {words ? <p className="bill-words"><span className="muted small">{t("billing.totals.words")}</span> {words}</p> : null}
    </div>
  );
}

function DedLine({ label, amount }: { label: string; amount: number }) {
  return <><dt>{label}</dt><dd>{money(amount)}</dd></>;
}

/** What was billed before on the project's running bills, this bill, and the figure to date. */
export function RaBox({ ra }: { ra: RaSummary }) {
  const { t } = useTranslation();
  return (
    <div className="bill-ra" data-bill-ra>
      <b>{t("billing.ra.serial", { n: ra.serial })}</b>
      <dl className="kv">
        <dt>{t("billing.ra.previous")}</dt><dd data-ra="previous">{money(ra.previousTaxablePaise)}</dd>
        <dt>{t("billing.ra.thisBill")}</dt><dd>{money(ra.thisTaxablePaise)}</dd>
        <dt className="total">{t("billing.ra.toDate")}</dt><dd className="total" data-ra="todate">{money(ra.toDateTaxablePaise)}</dd>
      </dl>
      <p className="muted small">{t("billing.ra.hint")}</p>
    </div>
  );
}

// ───────────────────────── Printable documents ─────────────────────────

function lineTables(items: BillItem[], t: TFunction): PrintSection[] {
  const head = [t("billing.print.sn"), t("billing.items.description"), t("billing.items.hsn"), t("billing.items.qty"), t("billing.items.unit"), t("billing.items.rate"), t("billing.items.gst"), t("billing.items.amount")];
  const align: ("left" | "right")[] = ["left", "left", "left", "right", "left", "right", "right", "right"];
  let n = 0;
  return groupBySection(items).map((g, i) => ({
    kind: "table" as const, heading: g.title || (i === 0 ? t("billing.items.title") : undefined), head, align,
    rows: g.items.map((it) => [String(++n), it.description, it.hsnSac ?? "", formatQty(it.qtyMilli), it.unit ?? "", money(it.ratePaise), formatBp(it.gstRateBp), money(lineTaxable(it))]),
  }));
}

function totalRows(totals: BillTotals, t: TFunction): { label: string; value: string }[] {
  return [
    { label: t("billing.totals.taxable"), value: money(totals.taxablePaise) },
    ...(totals.igstPaise > 0 ? [{ label: t("billing.totals.igst"), value: money(totals.igstPaise) }]
      : [{ label: t("billing.totals.cgst"), value: money(totals.cgstPaise) }, { label: t("billing.totals.sgst"), value: money(totals.sgstPaise) }]),
    ...(totals.roundOffPaise ? [{ label: t("billing.totals.roundOff"), value: money(totals.roundOffPaise) }] : []),
    { label: t("billing.totals.total"), value: money(totals.totalPaise) },
  ];
}

const partyRows = (d: { clientName?: string; clientAddress?: string; clientGstin?: string; projectName?: string | null }, t: TFunction) => [
  { label: t("billing.col.client"), value: d.clientName ?? "" },
  ...(d.clientAddress ? [{ label: t("billing.detail.address"), value: d.clientAddress }] : []),
  ...(d.clientGstin ? [{ label: t("billing.detail.gstin"), value: d.clientGstin }] : []),
  ...(d.projectName ? [{ label: t("billing.col.project"), value: d.projectName }] : []),
];

const companyLine = (c: Company) => [c.name, c.address, c.gstin ? `GSTIN ${c.gstin}` : ""].filter(Boolean).join(" · ");

/** A bill as a simple printable document (openPrintDoc prints it; the browser saves it as a PDF). */
export function invoicePrintSpec(inv: BillingInvoice, company: Company, t: TFunction, lang: "en" | "hi"): PrintDocSpec {
  const totals = inv.totals!;
  const deductions = inv.deductions ?? [];
  const state = inv.status === "draft" ? ` (${t("billing.print.draft")})` : inv.status === "cancelled" ? ` (${t("billing.status.cancelled")})` : "";
  return {
    title: `${t(`billing.type.${inv.type}`)}${state}`, subtitle: companyLine(company),
    meta: [
      { label: t("billing.col.number"), value: inv.number ?? t("billing.list.draftNo") }, { label: t("billing.col.date"), value: date(inv.date, lang) },
      ...(inv.type === "credit_note" || inv.type === "debit_note" ? [{ label: t("billing.detail.against"), value: inv.againstInvoiceNumber ?? "" }] : [{ label: t("billing.form.dueDate"), value: date(inv.dueDate, lang) }]),
      { label: t("billing.form.pos"), value: inv.placeOfSupply },
    ],
    sections: [
      { kind: "pairs", heading: t("billing.detail.billedTo"), rows: partyRows(inv, t) },
      ...lineTables(inv.items, t),
      ...(inv.ra ? [{ kind: "pairs" as const, heading: t("billing.ra.serial", { n: inv.ra.serial }), rows: [
        { label: t("billing.ra.previous"), value: money(inv.ra.previousTaxablePaise) }, { label: t("billing.ra.thisBill"), value: money(inv.ra.thisTaxablePaise) },
        { label: t("billing.ra.toDate"), value: money(inv.ra.toDateTaxablePaise) },
      ] }] : []),
      { kind: "pairs", heading: t("billing.totals.title"), rows: [
        ...totalRows(totals, t),
        ...deductions.map((d) => ({ label: `${t("billing.totals.less")} ${d.head}${d.overridden || !d.rateBp ? "" : ` (${formatBp(d.rateBp)})`}`, value: money(-d.amountPaise) })),
        ...(deductions.length ? [{ label: t("billing.totals.net"), value: money(inv.netReceivablePaise ?? totals.totalPaise) }] : []),
        ...(inv.amountInWords ? [{ label: t("billing.totals.words"), value: inv.amountInWords }] : []),
      ] },
      ...(inv.noteReason ? [{ kind: "text" as const, heading: t("billing.note.reason"), paragraphs: [inv.noteReason] }] : []),
      ...(inv.notes ? [{ kind: "text" as const, heading: t("billing.form.notes"), paragraphs: inv.notes.split("\n").filter(Boolean) }] : []),
    ],
    footerNote: inv.status === "draft" ? t("billing.print.draftNote") : t("billing.print.footer"),
  };
}

/** A quotation as a simple printable document. */
export function quotationPrintSpec(q: Quotation, company: Company, t: TFunction, lang: "en" | "hi"): PrintDocSpec {
  const paras = (s?: string) => (s ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  const textSection = (heading: string, s?: string): PrintSection[] => (paras(s).length ? [{ kind: "text", heading, paragraphs: paras(s) }] : []);
  return {
    title: `${t("billing.q.detailTitle")}${q.status === "draft" ? ` (${t("billing.print.draft")})` : ""}`, subtitle: companyLine(company),
    meta: [
      { label: t("billing.col.number"), value: quotationName(q, t) }, { label: t("billing.col.date"), value: date(q.date, lang) },
      { label: t("billing.q.validUntil"), value: date(q.validUntil, lang) },
    ],
    sections: [
      { kind: "pairs", heading: t("billing.q.for"), rows: [...partyRows(q, t), ...(q.title ? [{ label: t("billing.q.title"), value: q.title }] : [])] },
      ...lineTables(quotationItems(q), t),
      { kind: "pairs", heading: t("billing.totals.title"), rows: [...totalRows(q.totals, t), { label: t("billing.totals.words"), value: q.amountInWords }] },
      ...textSection(t("billing.q.inclusions"), q.inclusions), ...textSection(t("billing.q.exclusions"), q.exclusions),
      ...textSection(t("billing.q.paymentTerms"), q.paymentTerms), ...textSection(t("billing.q.terms"), q.terms), ...textSection(t("billing.form.notes"), q.notes),
    ],
    footerNote: t("billing.print.footer"),
  };
}

/** What is still to come in on a bill, for lists. */
export const dueOf = (inv: BillingInvoice) => invoiceDuePaise(inv);
