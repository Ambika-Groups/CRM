/**
 * Billing: quotations (spec §8.2) and invoices (§8.3). Pure rules, no storage.
 *
 * - A line is description, HSN/SAC, unit, quantity, rate, discount and GST rate, optionally under a section heading.
 * - GST is worked out per line (D-15, `gst.ts`): CGST + SGST when the place of supply is the company's own state,
 *   IGST otherwise. The grand total is rounded to the rupee with a round-off line.
 * - Deductions the client makes at source (TDS, GST-TDS, labour cess, retention, advance adjustment) are a rate on the
 *   taxable value rounded to the rupee, or a typed amount with a reason. They lower what is expected in cash, never
 *   what is billed.
 * - Bill types (D-24): tax, RA (running, with what was billed before carried forward), milestone, proforma (a document
 *   only: no number in the GST series, nothing billed), credit note and debit note against an issued bill.
 * - A bill is a draft until it is issued. Issuing gives it the next number of its series and locks it: after that the
 *   only changes are a credit or debit note, or cancelling it (the number is kept and never used again).
 * - A quotation keeps its number across versions (D-17): a change after sending makes the next version as a new
 *   record, and the older one stays as it was, read-only.
 */
import { amountInWords, computeInvoice, isIntraState, type LineTax } from "./gst";
import type { Audit, Invoice, InvoiceItem, InvoiceStatus, InvoiceType } from "./model";
import type { DocType } from "./numbering";

// ───────────────────────── Lines ─────────────────────────

/** One line of a bill or quotation. `section` is the heading it is listed under (Earthwork, Base, Surface…). */
export interface BillItem extends InvoiceItem {
  section?: string;
}

export const BILL_GST_RATES_BP = [0, 500, 1200, 1800, 2800] as const;
export const MAX_BILL_ITEMS = 100;

/** Common work items so a line is one click (spec §8.2 "item and rate library"); the rate is typed for each job. */
export const COMMON_BILL_ITEMS: readonly { key: string; description: string; unit: string; hsnSac: string; gstRateBp: number }[] = [
  { key: "earthwork", description: "Earthwork in excavation and disposal", unit: "cum", hsnSac: "995432", gstRateBp: 1800 },
  { key: "gsb", description: "Granular sub-base (GSB), laid and compacted", unit: "cum", hsnSac: "995421", gstRateBp: 1800 },
  { key: "wmm", description: "Wet mix macadam (WMM) base course", unit: "cum", hsnSac: "995421", gstRateBp: 1800 },
  { key: "pcc", description: "Plain cement concrete (PCC) M15", unit: "cum", hsnSac: "995454", gstRateBp: 1800 },
  { key: "rcc", description: "Reinforced cement concrete (RCC) M25, with steel", unit: "cum", hsnSac: "995454", gstRateBp: 1800 },
  { key: "ccroad", description: "Cement concrete road M30, 200 mm", unit: "cum", hsnSac: "995421", gstRateBp: 1800 },
  { key: "interlocking", description: "Interlocking paver blocks 60 mm, supplied and laid", unit: "sqft", hsnSac: "995421", gstRateBp: 1800 },
  { key: "kerb", description: "Kerb stone, supplied and fixed", unit: "rmt", hsnSac: "995421", gstRateBp: 1800 },
  { key: "brickwork", description: "Brickwork in cement mortar 1:6", unit: "cum", hsnSac: "995454", gstRateBp: 1800 },
  { key: "plaster", description: "Cement plaster 12 mm, 1:4", unit: "sqm", hsnSac: "995472", gstRateBp: 1800 },
];

const isNonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Problems with the lines, in plain words, keyed `items` (the list as a whole) or `items.<n>.<field>`.
 * An empty object means the lines are fine.
 */
export function itemProblems(items: unknown): Record<string, string> {
  const e: Record<string, string> = {};
  if (!Array.isArray(items) || items.length === 0) return { items: "Add at least one line: what the work is, how much, and the rate." };
  if (items.length > MAX_BILL_ITEMS) return { items: `A bill can have up to ${MAX_BILL_ITEMS} lines. Split it into two.` };
  items.forEach((raw, i) => {
    const it = (raw ?? {}) as Partial<BillItem>;
    const k = (f: string) => `items.${i}.${f}`;
    if (text(it.description, 300).length < 2) e[k("description")] = "Say what this line is for.";
    if (!isNonNegInt(it.qtyMilli) || it.qtyMilli <= 0) e[k("qtyMilli")] = "Enter the quantity, for example 40 or 2.5.";
    if (!isNonNegInt(it.ratePaise)) e[k("ratePaise")] = "Enter the rate in rupees.";
    if (!isNonNegInt(it.gstRateBp) || it.gstRateBp > 2800) e[k("gstRateBp")] = "Choose the GST rate.";
    if (it.discountBp != null && (!isNonNegInt(it.discountBp) || it.discountBp > 10000)) e[k("discountBp")] = "The discount is a percentage from 0 to 100.";
    const hsn = text(it.hsnSac, 12);
    if (hsn && !/^\d{4}(\d{2}){0,2}$/.test(hsn)) e[k("hsnSac")] = "An HSN or SAC code has 4, 6 or 8 digits.";
  });
  return e;
}

/** The lines as they are stored: trimmed, with no empty or unknown fields. Call after `itemProblems` finds nothing. */
export function cleanItems(items: BillItem[]): BillItem[] {
  return items.map((it) => {
    const out: BillItem = { description: text(it.description, 300), qtyMilli: it.qtyMilli, ratePaise: it.ratePaise, gstRateBp: it.gstRateBp };
    const hsn = text(it.hsnSac, 12), unit = text(it.unit, 20), section = text(it.section, 80);
    if (hsn) out.hsnSac = hsn;
    if (unit) out.unit = unit;
    if (it.discountBp) out.discountBp = it.discountBp;
    if (section) out.section = section;
    return out;
  });
}

/** Lines grouped under their section headings, in the order they were entered. Lines with no heading come under "". */
export function groupBySection<T extends { section?: string }>(items: T[]): { title: string; items: T[] }[] {
  const out: { title: string; items: T[] }[] = [];
  for (const it of items) {
    const title = it.section ?? "";
    const last = out[out.length - 1];
    if (last && last.title === title) last.items.push(it);
    else out.push({ title, items: [it] });
  }
  return out;
}

// ───────────────────────── Totals ─────────────────────────

export interface BillTotals {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
}

/** A deduction as it is typed: a rate on the taxable value, or an amount typed over it with the reason. */
export interface BillDeductionInput {
  head: string;
  rateBp: number;
  overridePaise?: number | null;
  reason?: string;
}

export interface BillDeduction {
  head: string;
  basisPaise: number;
  rateBp: number;
  amountPaise: number;
  /** The amount was typed instead of worked out from the rate (D-15 point 5). */
  overridden?: boolean;
  reason?: string;
}

export interface BillComputation {
  /** True: CGST + SGST (the place of supply is the company's state). False: IGST. */
  intraState: boolean;
  lines: LineTax[];
  totals: BillTotals;
  byRate: { rateBp: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }[];
  deductions: BillDeduction[];
  deductionsTotalPaise: number;
  /** What is expected in cash: the total less the deductions. */
  netReceivablePaise: number;
  /** The total in words, Indian system ("Rupees Twelve Lakh … Only"). */
  amountInWords: string;
}

/** Problems with the deductions, keyed `deductions.<n>.<field>`. */
export function deductionProblems(deductions: unknown): Record<string, string> {
  const e: Record<string, string> = {};
  if (deductions == null) return e;
  if (!Array.isArray(deductions) || deductions.length > 12) return { deductions: "A bill can have up to 12 deductions." };
  deductions.forEach((raw, i) => {
    const d = (raw ?? {}) as Partial<BillDeductionInput>;
    const k = (f: string) => `deductions.${i}.${f}`;
    if (text(d.head, 60).length < 2) e[k("head")] = "Name the deduction, for example TDS or Retention.";
    if (!isNonNegInt(d.rateBp) || d.rateBp > 10000) e[k("rateBp")] = "The rate is a percentage from 0 to 100.";
    if (d.overridePaise != null) {
      if (!isNonNegInt(d.overridePaise)) e[k("overridePaise")] = "Enter the amount in rupees.";
      else if (text(d.reason, 200).length < 3) e[k("reason")] = "Say why this amount is typed instead of worked out from the rate.";
    }
  });
  return e;
}

/**
 * Work out a bill: per-line tax, totals, round-off to the rupee, deductions and the amount in words.
 * `companyStateCode` comes from Settings; `placeOfSupply` is the client's state (2-digit GST state code).
 */
export function computeBill(items: InvoiceItem[], companyStateCode: string, placeOfSupply: string, deductions: BillDeductionInput[] = []): BillComputation {
  const intraState = isIntraState(companyStateCode, placeOfSupply);
  const t = computeInvoice(items, intraState, deductions.map((d) => ({ head: d.head, rateBp: d.rateBp, ...(d.overridePaise != null ? { overridePaise: d.overridePaise } : {}) })));
  const ded: BillDeduction[] = t.deductions.map((d, i) => {
    const src = deductions[i]!;
    const typed = src.overridePaise != null;
    return { head: text(d.head, 60), basisPaise: d.basisPaise, rateBp: d.rateBp, amountPaise: d.amountPaise, ...(typed ? { overridden: true, reason: text(src.reason, 200) } : {}) };
  });
  return {
    intraState, lines: t.lines, byRate: t.byRate,
    totals: { taxablePaise: t.taxablePaise, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise, roundOffPaise: t.roundOffPaise, totalPaise: t.totalPaise },
    deductions: ded, deductionsTotalPaise: t.deductionsTotalPaise, netReceivablePaise: t.netReceivablePaise,
    amountInWords: amountInWords(t.totalPaise),
  };
}

// ───────────────────────── Invoices ─────────────────────────

/** An invoice as the billing screens and commands keep it (the shared `Invoice` plus what billing adds). */
export interface BillingInvoice extends Omit<Invoice, "items" | "deductions"> {
  items: BillItem[];
  deductions?: BillDeduction[];
  clientStateCode?: string;
  clientAddress?: string;
  intraState?: boolean;
  amountInWords?: string;
  notes?: string;
  issuedAt?: string;
  issuedBy?: string;
  /** Set when the bill is issued: from then on it can't be changed (spec §8.3). */
  lockedAt?: string;
  cancelReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  /** Credit and debit notes: the bill they are against, and why. */
  againstInvoiceId?: string | null;
  againstInvoiceNumber?: string | null;
  noteReason?: string;
  /** On the original bill: the totals of its live credit and debit notes. */
  creditedPaise?: number;
  debitedPaise?: number;
  /** RA bills: what was billed before this one, and the running figure to date. */
  ra?: RaSummary | null;
  quotationId?: string | null;
  fromProformaId?: string | null;
  searchKeywords?: string[];
  /** Set by the posting engine when a locked month refused the posting. */
  postingError?: string | null;
}

/** Types that can be started as a draft. Credit and debit notes are made against an issued bill instead. */
export const DRAFT_INVOICE_TYPES: readonly InvoiceType[] = ["tax", "ra", "milestone", "proforma"];
/** Types that count as billed (D-20) and so can carry a credit or debit note. */
export const BILLED_INVOICE_TYPES: readonly InvoiceType[] = ["tax", "ra", "milestone"];
const ISSUED_STATUSES: readonly InvoiceStatus[] = ["sent", "partially_paid", "paid", "overdue"];

/** The number series a bill type takes its number from (D-12). */
export function billDocType(type: InvoiceType): DocType {
  if (type === "proforma") return "proforma";
  if (type === "credit_note") return "credit_note";
  if (type === "debit_note") return "debit_note";
  return "invoice";
}

export function isIssuedInvoice(inv: Pick<Invoice, "status">): boolean {
  return ISSUED_STATUSES.includes(inv.status);
}

/** What can no longer change once a bill is issued (everything that is printed on it). */
export const LOCKED_ONCE_ISSUED = ["number", "type", "projectId", "clientId", "date", "dueDate", "placeOfSupply", "items", "totals", "deductions", "netReceivablePaise", "amountInWords"] as const;

/** Why this bill can't be edited, or null when it can (only a draft can). */
export function invoiceEditRefusal(inv: Pick<Invoice, "status" | "isDeleted">): string | null {
  if (inv.isDeleted) return "This bill was deleted.";
  if (inv.status === "cancelled") return "This bill was cancelled and can't be changed. Make a new one.";
  if (inv.status !== "draft") return "This bill has been issued, so it can't be changed. Make a credit note or a debit note against it, or cancel it and make a new bill.";
  return null;
}

/** Why this bill can't be cancelled, or null when it can. `liveNotes` is how many credit or debit notes stand against it. */
export function invoiceCancelRefusal(inv: Pick<Invoice, "status" | "paidPaise">, liveNotes = 0): string | null {
  if (inv.status === "cancelled") return "This bill is already cancelled.";
  if ((inv.paidPaise ?? 0) > 0) return "Money has been received against this bill, so it can't be cancelled. Remove the receipt first, or make a credit note.";
  if (liveNotes > 0) return "This bill has a credit or debit note against it. Cancel the note first.";
  return null;
}

/** Why a credit or debit note can't be made against this bill, or null when it can. */
export function noteRefusal(inv: Pick<Invoice, "status" | "type">): string | null {
  if (!isIssuedInvoice(inv)) return inv.status === "draft" ? "This bill is still a draft: change the draft itself." : "This bill was cancelled.";
  if (!BILLED_INVOICE_TYPES.includes(inv.type)) return "A credit or debit note can only be made against a tax, running or milestone bill.";
  return null;
}

/**
 * What is still owed on a bill: its total, less its credit notes, less what has been received (`paidPaise`, which the
 * posting engine raises by the cash plus the TDS, retention and other amounts the client held back). Nothing is owed on
 * a draft, a cancelled bill, a proforma or a credit note.
 */
export function invoiceDuePaise(inv: Pick<BillingInvoice, "status" | "type" | "totals" | "paidPaise" | "creditedPaise">): number {
  if (!isIssuedInvoice(inv) || inv.type === "proforma" || inv.type === "credit_note" || !inv.totals) return 0;
  return Math.max(0, inv.totals.totalPaise - (inv.creditedPaise ?? 0) - (inv.paidPaise ?? 0));
}

/**
 * The status an issued bill should have from its money and due date: paid when nothing is owed, overdue when the due
 * date has passed, partially paid when something was received, otherwise sent. Drafts and cancelled bills keep theirs;
 * so do proformas and credit notes, on which nothing is owed.
 */
export function statusFromMoney(inv: Pick<BillingInvoice, "status" | "type" | "totals" | "paidPaise" | "creditedPaise" | "dueDate">, today: string): InvoiceStatus {
  if (!isIssuedInvoice(inv)) return inv.status;
  if (inv.type === "proforma" || inv.type === "credit_note") return "sent";
  if (invoiceDuePaise(inv) <= 0) return "paid";
  if (inv.dueDate && inv.dueDate < today) return "overdue";
  return (inv.paidPaise ?? 0) > 0 ? "partially_paid" : "sent";
}

// ───────────────────────── RA (running) bills ─────────────────────────

export interface RaSummary {
  /** 1 for the first running bill of the project, 2 for the next… */
  serial: number;
  /** Taxable value of the running bills issued before this one (less their credit notes). */
  previousTaxablePaise: number;
  thisTaxablePaise: number;
  toDateTaxablePaise: number;
  previousTotalPaise: number;
  thisTotalPaise: number;
  toDateTotalPaise: number;
}

type RaSource = Pick<BillingInvoice, "id" | "type" | "status" | "projectId" | "totals" | "isDeleted" | "againstInvoiceId">;

/**
 * Carry forward what was billed before on a project's running bills. `projectInvoices` is every invoice of the
 * project; issued RA bills other than this one count, less the issued credit notes against them.
 */
export function raCarryForward(projectInvoices: RaSource[], bill: { id?: string | null; projectId: string; taxablePaise: number; totalPaise: number }): RaSummary {
  const live = projectInvoices.filter((i) => !i.isDeleted && i.projectId === bill.projectId && isIssuedInvoice(i) && i.totals && i.id !== bill.id);
  const earlier = live.filter((i) => i.type === "ra");
  const ids = new Set(earlier.map((i) => i.id));
  const credits = live.filter((i) => i.type === "credit_note" && !!i.againstInvoiceId && ids.has(i.againstInvoiceId));
  const sum = (list: RaSource[], f: "taxablePaise" | "totalPaise") => list.reduce((s, i) => s + i.totals![f], 0);
  const previousTaxablePaise = sum(earlier, "taxablePaise") - sum(credits, "taxablePaise");
  const previousTotalPaise = sum(earlier, "totalPaise") - sum(credits, "totalPaise");
  return {
    serial: earlier.length + 1,
    previousTaxablePaise, thisTaxablePaise: bill.taxablePaise, toDateTaxablePaise: previousTaxablePaise + bill.taxablePaise,
    previousTotalPaise, thisTotalPaise: bill.totalPaise, toDateTotalPaise: previousTotalPaise + bill.totalPaise,
  };
}

// ───────────────────────── Quotations ─────────────────────────

export type QuotationStatus = "draft" | "sent" | "viewed" | "accepted" | "rejected" | "expired";
export const QUOTATION_STATUSES: readonly QuotationStatus[] = ["draft", "sent", "viewed", "accepted", "rejected", "expired"];
/** What a sent quotation can be marked as by hand. */
export const QUOTATION_OUTCOMES: readonly QuotationStatus[] = ["accepted", "rejected", "expired"];

export interface QuotationSection {
  title: string;
  items: InvoiceItem[];
}

export interface Quotation extends Audit {
  id: string;
  /** `AG/Q/2026-27/0001`, given when the first version is sent; later versions keep it (D-17). */
  number: string | null;
  version: number;
  /** The first version's id: every version of one quotation carries it. */
  rootQuotationId: string;
  /** False once a newer version exists; that older version is read-only and keeps its status. */
  isLatest: boolean;
  supersededBy?: string | null;
  clientId: string;
  clientName?: string;
  clientGstin?: string;
  clientStateCode?: string;
  clientAddress?: string;
  projectId?: string | null;
  projectName?: string | null;
  leadId?: string | null;
  /** What the quotation is for, in a few words. */
  title?: string;
  date: string;
  validUntil: string;
  monthKey: string;
  fy: string;
  placeOfSupply: string;
  intraState: boolean;
  sections: QuotationSection[];
  totals: BillTotals;
  amountInWords: string;
  terms?: string;
  paymentTerms?: string;
  inclusions?: string;
  exclusions?: string;
  notes?: string;
  status: QuotationStatus;
  sentAt?: string;
  sentBy?: string;
  decidedAt?: string;
  decidedBy?: string;
  statusNote?: string;
  /** Bills made from this quotation. */
  invoiceIds?: string[];
  searchKeywords?: string[];
}

export const DEFAULT_QUOTATION_TERMS = [
  "Rates are for the quantities and scope written above. Extra work is charged at the same rates, or at rates agreed in writing.",
  "GST is charged as shown, at the rate in force on the date of the bill.",
  "Water and electricity at the site are provided by the client unless written otherwise.",
  "Work starts after the written order and the advance, if any, are received.",
].join("\n");

export const DEFAULT_PAYMENT_TERMS = "Running bills are raised as the work progresses and are payable within 15 days of the bill date.";

/** The lines of a quotation as one list, each carrying its section heading. */
export function quotationItems(q: Pick<Quotation, "sections">): BillItem[] {
  return (q.sections ?? []).flatMap((s) => s.items.map((it) => (s.title ? { ...it, section: s.title } : { ...it })));
}

/** A list of lines as the sections a quotation stores. */
export function toSections(items: BillItem[]): QuotationSection[] {
  return groupBySection(items).map((g) => ({ title: g.title, items: g.items.map(({ section: _section, ...rest }) => rest) }));
}

/** Why this version can't be changed or revised, or null when it can. A sent one is revised (a new version); a draft is edited. */
export function quotationChangeRefusal(q: Pick<Quotation, "status" | "isLatest" | "isDeleted">): string | null {
  if (q.isDeleted) return "This quotation was deleted.";
  if (!q.isLatest) return "A newer version of this quotation exists. Open that one to change it.";
  if (q.status === "accepted") return "This quotation was accepted, so it can't be changed. Make a new quotation for any further work.";
  return null;
}

/** Why a quotation can't be marked accepted, rejected or expired, or null when it can. */
export function quotationOutcomeRefusal(q: Pick<Quotation, "status" | "isLatest">, to: QuotationStatus): string | null {
  if (!QUOTATION_OUTCOMES.includes(to)) return "Choose accepted, rejected or expired.";
  if (!q.isLatest) return "A newer version of this quotation exists. Open that one.";
  if (q.status === "draft") return "Send the quotation first.";
  if (q.status === to) return `This quotation is already marked ${to}.`;
  if (q.status === "accepted") return "This quotation was already accepted.";
  return null;
}

/** The status to show: a sent quotation past its validity date reads as expired, without anyone marking it. */
export function quotationShownStatus(q: Pick<Quotation, "status" | "validUntil">, today: string): QuotationStatus {
  return (q.status === "sent" || q.status === "viewed") && !!q.validUntil && q.validUntil < today ? "expired" : q.status;
}
