/**
 * Printable documents made in the browser, and sharing them (spec §8.4, §8.5; SPARK-PLAN "Server PDFs": no server PDF).
 *
 * - A document model is built from records (`invoiceDocument`, `quotationDocument`, `receiptDocument`) or from a simple
 *   `PrintDocSpec` (`printSpecDocument`), so every printed page carries the same letterhead.
 * - One renderer turns the model into HTML (`documentBodyHtml`, `documentHtml`) with one stylesheet (`DOCUMENT_CSS`):
 *   the screen preview, the print-only view and the print window all use it, so they cannot drift apart.
 * - Sharing: message templates in English and Hindi with placeholders, a wa.me link, and the share-log record.
 *
 * Pure code: no browser, no Firebase. Money is paise; the figures of an invoice are the stored totals, never new ones.
 */
import { formatDate, type Lang } from "./dates";
import { computeInvoice, isIntraState, lineTaxable } from "./gst";
import type { PrintDocSpec } from "./lanea-interfaces";
import type { Client, Invoice, InvoiceItem, PaymentReceived } from "./model";
import { formatBp, formatINR, formatQty } from "./money";
import { formatPhone, normaliseIndianMobile } from "./phone";

// ───────────────────────── What the builders are given ─────────────────────────

/** The `settings/company` document (all optional: a new company has not filled everything in). */
export interface CompanyInfo {
  legalName?: string; tradeName?: string; address?: string; stateCode?: string; gstin?: string; pan?: string; phone?: string; email?: string;
  /** The one accent colour of printed documents (spec §8.4), "#RRGGBB". */
  brandColor?: string;
  /** Images, when the caller has them as a data: or https: address. */
  logoUrl?: string | null; signatureUrl?: string | null;
}

/** One account of the `settings/bank` document. */
export interface BankInfo { bankName?: string; accountName?: string; accountNo?: string; ifsc?: string; branch?: string; upiId?: string }

export interface DocOptions {
  /** Language of the labels on the page. Default English. Digits are always Western. */
  lang?: Lang;
  bank?: BankInfo | null;
  project?: { name?: string; address?: string } | null;
  /** Printed only when the caller gives it (core `amountInWords` writes English). */
  amountInWords?: string;
  terms?: string[];
  notes?: string;
}

/**
 * A quotation as far as the page needs it (the quotations feature owns the full record). A billing `Quotation` fits
 * with its lines flattened: `{ ...q, items: quotationItems(q), subject: q.title }`.
 */
export interface QuotationLike {
  number: string | null;
  date: string;
  validUntil?: string | null;
  subject?: string | null;
  /** Kept on the record, used when the client record itself is not given. */
  clientName?: string;
  clientGstin?: string;
  clientAddress?: string;
  projectName?: string | null;
  siteAddress?: string | null;
  placeOfSupply?: string;
  items: InvoiceItem[];
  totals?: Invoice["totals"];
  status?: string;
}

// ───────────────────────── The document model ─────────────────────────

export type DocumentKind = "invoice" | "quotation" | "receipt" | "generic";
export interface DocTable { columns: { label: string; align: "left" | "right" }[]; rows: string[][]; foot?: string[] }
export interface DocPairs { heading: string; rows: { label: string; value: string }[] }
export type DocBlock =
  | { kind: "text"; heading?: string; paragraphs: string[] }
  | { kind: "pairs"; heading?: string; rows: { label: string; value: string }[] }
  | { kind: "table"; heading?: string; table: DocTable };

export const SHARE_PLACEHOLDERS = ["clientName", "documentNumber", "amount", "dueDate", "link", "companyName"] as const;
export type SharePlaceholder = (typeof SHARE_PLACEHOLDERS)[number];
export type ShareValues = Partial<Record<SharePlaceholder, string | null>>;

export interface DocumentModel {
  kind: DocumentKind;
  lang: Lang;
  letterhead: { name: string; lines: string[]; logoUrl: string | null; accent: string };
  title: string;
  subtitle: string;
  number: string | null;
  /** Shown top right: number, date, due date. */
  meta: { label: string; value: string }[];
  parties: { heading: string; name: string; lines: string[] }[];
  items: DocTable | null;
  taxSummary: { heading: string; table: DocTable } | null;
  totals: { label: string; value: string; strong?: boolean }[];
  amountInWords: { label: string; text: string } | null;
  blocks: DocBlock[];
  bank: DocPairs | null;
  terms: { heading: string; lines: string[] } | null;
  signatures: { heading: string; caption: string; imageUrl: string | null }[];
  footer: string[];
  /** "DRAFT", "PAID" or "CANCELLED" across the page. */
  watermark: string | null;
  /** The money on the page, for checks (equals the record). */
  figures: { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; netPaise: number } | null;
  /** What the share message is filled with. */
  shareValues: ShareValues;
}

// ───────────────────────── Labels (English and Hindi) ─────────────────────────

const LABELS = {
  en: {
    taxInvoice: "Tax invoice", proforma: "Proforma invoice", raBill: "Running bill", creditNote: "Credit note", debitNote: "Debit note",
    quotation: "Quotation", receipt: "Payment receipt",
    number: "Number", date: "Date", dueDate: "Due date", validUntil: "Valid until", placeOfSupply: "Place of supply",
    billedTo: "Billed to", quoteFor: "Quotation for", receivedFrom: "Received from", project: "Project / Site",
    gstin: "GSTIN", pan: "PAN", phone: "Phone", email: "Email",
    sn: "No.", description: "Description", hsn: "HSN/SAC", qty: "Qty", unit: "Unit", rate: "Rate", discount: "Discount", gst: "GST", amount: "Amount",
    taxSummary: "GST summary", gstRate: "GST rate", taxable: "Taxable value", cgst: "CGST", sgst: "SGST", igst: "IGST", totalTax: "Total GST", total: "Total",
    subtotal: "Subtotal", roundOff: "Round off", grandTotal: "Grand total", less: "Less", netReceivable: "Net receivable", received: "Received", balance: "Balance due",
    amountInWords: "Amount in words", bank: "Bank details", bankName: "Bank", accountName: "Account name", accountNo: "Account number", ifsc: "IFSC", branch: "Branch", upi: "UPI ID",
    terms: "Terms", notes: "Notes", forCompany: "For {name}", signatory: "Authorised signatory", thanks: "Thank you for your business.",
    draft: "DRAFT", paid: "PAID", cancelled: "CANCELLED", noNumber: "Draft, no number yet",
    paymentDetails: "Payment details", amountReceived: "Amount received", mode: "Paid by", reference: "Reference", againstInvoice: "Against invoice",
    tds: "TDS deducted", retention: "Retention held", otherDeductions: "Other deductions", settled: "Total settled", advance: "Advance payment",
    modes: { cash: "Cash", upi: "UPI", bank: "Bank transfer", cheque: "Cheque", credit: "Credit" },
    scroll: "Table: scroll sideways to see every column",
  },
  hi: {
    taxInvoice: "टैक्स इनवॉइस", proforma: "प्रोफ़ॉर्मा इनवॉइस", raBill: "रनिंग बिल", creditNote: "क्रेडिट नोट", debitNote: "डेबिट नोट",
    quotation: "कोटेशन", receipt: "भुगतान की रसीद",
    number: "नंबर", date: "तारीख़", dueDate: "भुगतान की आख़िरी तारीख़", validUntil: "कब तक मान्य", placeOfSupply: "सप्लाई की जगह",
    billedTo: "बिल किसके नाम", quoteFor: "कोटेशन किसके लिए", receivedFrom: "किससे मिला", project: "प्रोजेक्ट / साइट",
    gstin: "GSTIN", pan: "PAN", phone: "फ़ोन", email: "ईमेल",
    sn: "क्र.", description: "विवरण", hsn: "HSN/SAC", qty: "मात्रा", unit: "इकाई", rate: "दर", discount: "छूट", gst: "GST", amount: "रकम",
    taxSummary: "GST का सार", gstRate: "GST दर", taxable: "कर योग्य रकम", cgst: "CGST", sgst: "SGST", igst: "IGST", totalTax: "कुल GST", total: "कुल",
    subtotal: "उप-योग", roundOff: "राउंड ऑफ़", grandTotal: "कुल रकम", less: "घटाएँ", netReceivable: "मिलने वाली रकम", received: "मिल चुका", balance: "बाकी रकम",
    amountInWords: "रकम शब्दों में", bank: "बैंक की जानकारी", bankName: "बैंक", accountName: "खाते का नाम", accountNo: "खाता नंबर", ifsc: "IFSC", branch: "शाखा", upi: "UPI आईडी",
    terms: "शर्तें", notes: "टिप्पणी", forCompany: "{name} की ओर से", signatory: "अधिकृत हस्ताक्षर", thanks: "आपके साथ काम करके अच्छा लगा। धन्यवाद।",
    draft: "ड्राफ़्ट", paid: "भुगतान हो गया", cancelled: "रद्द", noNumber: "ड्राफ़्ट, अभी नंबर नहीं",
    paymentDetails: "भुगतान की जानकारी", amountReceived: "मिली रकम", mode: "भुगतान का तरीका", reference: "संदर्भ", againstInvoice: "किस बिल के लिए",
    tds: "TDS कटा", retention: "रोकी गई रकम", otherDeductions: "अन्य कटौती", settled: "कुल निपटान", advance: "एडवांस भुगतान",
    modes: { cash: "नकद", upi: "UPI", bank: "बैंक ट्रांसफ़र", cheque: "चेक", credit: "उधार" },
    scroll: "तालिका: सभी कॉलम देखने के लिए बाएँ-दाएँ खिसकाएँ",
  },
} as const;
type Labels = (typeof LABELS)[Lang];

/** GST state codes, for "Place of supply". */
const STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};
export const stateLabel = (code: string | undefined | null): string => (code ? (STATES[code] ? `${STATES[code]} (${code})` : code) : "");

// ───────────────────────── Small helpers ─────────────────────────

/** A setting still holding a "[to be confirmed]" placeholder is not printed. */
const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").replace(/^[\s,]+|[\s,]+$/g, "") : "");
const rs = (p: number) => formatINR(p, { paise: true });
const joined = (parts: string[], sep = " · ") => parts.filter(Boolean).join(sep);
const shownPhone = (p: string) => (/^\+91\d{10}$/.test(p) ? formatPhone(p) : p);
const pairsOf = (rows: [string, string][]) => rows.filter(([, v]) => v).map(([label, value]) => ({ label, value }));

export const DEFAULT_ACCENT = "#D7192C";
export const DEFAULT_COMPANY_NAME = "Ambika Groups";

function letterheadOf(company: CompanyInfo | null | undefined, L: Labels): DocumentModel["letterhead"] {
  const c = company ?? {};
  const phone = clean(c.phone);
  return {
    name: clean(c.legalName) || clean(c.tradeName) || DEFAULT_COMPANY_NAME,
    lines: [
      clean(c.address),
      joined([clean(c.gstin) && `${L.gstin}: ${clean(c.gstin)}`, clean(c.pan) && `${L.pan}: ${clean(c.pan)}`]),
      joined([phone && `${L.phone}: ${shownPhone(phone)}`, clean(c.email) && `${L.email}: ${clean(c.email)}`]),
    ].filter(Boolean),
    logoUrl: c.logoUrl || null,
    accent: /^#[0-9a-fA-F]{6}$/.test(c.brandColor ?? "") ? c.brandColor! : DEFAULT_ACCENT,
  };
}

type ClientLike = Partial<Pick<Client, "name" | "company" | "address" | "gstin" | "phone" | "whatsapp" | "stateCode">> | null | undefined;

/** The client block: the client record when the caller may read it, otherwise what the document itself kept. */
function clientParty(heading: string, client: ClientLike, kept: { clientName?: string; clientGstin?: string; clientAddress?: string }, L: Labels): DocumentModel["parties"][number] {
  const name = client?.name || kept.clientName || "";
  const gstin = kept.clientGstin || client?.gstin || "";
  const phone = client?.phone || client?.whatsapp || "";
  return {
    heading, name,
    lines: [
      client?.company && client.company !== name ? client.company : "",
      client?.address || kept.clientAddress || "",
      gstin ? `${L.gstin}: ${gstin}` : "",
      phone ? `${L.phone}: ${shownPhone(phone)}` : "",
    ].filter(Boolean),
  };
}

function projectParty(name: string | null | undefined, address: string | null | undefined, L: Labels): DocumentModel["parties"] {
  return name || address ? [{ heading: L.project, name: name ?? "", lines: address ? [address] : [] }] : [];
}

function bankOf(bank: BankInfo | null | undefined, L: Labels): DocPairs | null {
  if (!bank) return null;
  const rows = pairsOf([
    [L.bankName, clean(bank.bankName)], [L.accountName, clean(bank.accountName)], [L.accountNo, clean(bank.accountNo)],
    [L.ifsc, clean(bank.ifsc)], [L.branch, clean(bank.branch)], [L.upi, clean(bank.upiId)],
  ]);
  // A bank block with only the account name says nothing a client can pay to.
  return rows.some((r) => r.label !== L.accountName) ? { heading: L.bank, rows } : null;
}

function signaturesOf(head: DocumentModel["letterhead"], company: CompanyInfo | null | undefined, L: Labels): DocumentModel["signatures"] {
  return [{ heading: L.forCompany.replace("{name}", head.name), caption: L.signatory, imageUrl: company?.signatureUrl || null }];
}

function itemsTable(items: InvoiceItem[], L: Labels): DocTable {
  const disc = items.some((i) => (i.discountBp ?? 0) > 0);
  const col = (label: string, align: "left" | "right" = "left") => ({ label, align });
  return {
    columns: [col(L.sn), col(L.description), col(L.hsn), col(L.qty, "right"), col(L.unit), col(L.rate, "right"), ...(disc ? [col(L.discount, "right")] : []), col(L.gst, "right"), col(L.amount, "right")],
    rows: items.map((i, n) => [
      String(n + 1), i.description, i.hsnSac ?? "", formatQty(i.qtyMilli), i.unit ?? "", rs(i.ratePaise),
      ...(disc ? [i.discountBp ? formatBp(i.discountBp) : ""] : []), formatBp(i.gstRateBp), rs(lineTaxable(i)),
    ]),
  };
}

type Totals = NonNullable<Invoice["totals"]>;

/** The stored totals when the record has them (the truth); otherwise worked out from the lines. */
function totalsOf(items: InvoiceItem[], stored: Invoice["totals"], companyState: string | undefined, placeOfSupply: string | undefined) {
  const intra = stored ? stored.igstPaise === 0 : !companyState || !placeOfSupply || isIntraState(companyState, placeOfSupply);
  const computed = computeInvoice(items, intra);
  const totals: Totals = stored ?? {
    taxablePaise: computed.taxablePaise, cgstPaise: computed.cgstPaise, sgstPaise: computed.sgstPaise, igstPaise: computed.igstPaise,
    roundOffPaise: computed.roundOffPaise, totalPaise: computed.totalPaise,
  };
  return { intra, totals, byRate: computed.byRate };
}

function taxSummary(byRate: ReturnType<typeof computeInvoice>["byRate"], intra: boolean, t: Totals, L: Labels): DocumentModel["taxSummary"] {
  const right = (label: string) => ({ label, align: "right" as const });
  const tax = t.cgstPaise + t.sgstPaise + t.igstPaise;
  return {
    heading: L.taxSummary,
    table: {
      columns: [{ label: L.gstRate, align: "left" }, right(L.taxable), ...(intra ? [right(L.cgst), right(L.sgst)] : [right(L.igst)]), right(L.totalTax)],
      rows: byRate.map((r) => [formatBp(r.rateBp), rs(r.taxablePaise), ...(intra ? [rs(r.cgstPaise), rs(r.sgstPaise)] : [rs(r.igstPaise)]), rs(r.cgstPaise + r.sgstPaise + r.igstPaise)]),
      foot: [L.total, rs(t.taxablePaise), ...(intra ? [rs(t.cgstPaise), rs(t.sgstPaise)] : [rs(t.igstPaise)]), rs(tax)],
    },
  };
}

function totalLines(t: Totals, intra: boolean, L: Labels): DocumentModel["totals"] {
  return [
    { label: L.subtotal, value: rs(t.taxablePaise) },
    ...(intra ? [{ label: L.cgst, value: rs(t.cgstPaise) }, { label: L.sgst, value: rs(t.sgstPaise) }] : [{ label: L.igst, value: rs(t.igstPaise) }]),
    ...(t.roundOffPaise ? [{ label: L.roundOff, value: rs(t.roundOffPaise) }] : []),
    { label: L.grandTotal, value: rs(t.totalPaise), strong: true },
  ];
}

function closing(opts: DocOptions, L: Labels): Pick<DocumentModel, "terms" | "blocks" | "amountInWords" | "footer"> {
  return {
    terms: opts.terms?.length ? { heading: L.terms, lines: opts.terms } : null,
    blocks: opts.notes ? [{ kind: "text", heading: L.notes, paragraphs: [opts.notes] }] : [],
    amountInWords: opts.amountInWords ? { label: L.amountInWords, text: opts.amountInWords } : null,
    footer: [L.thanks],
  };
}

// ───────────────────────── Builders ─────────────────────────

const INVOICE_TITLE: Record<Invoice["type"], keyof Labels> = {
  tax: "taxInvoice", milestone: "taxInvoice", proforma: "proforma", ra: "raBill", credit_note: "creditNote", debit_note: "debitNote",
};

/** An invoice (tax, proforma, running bill, milestone, credit or debit note) as a page (spec §8.3, §8.4). */
export function invoiceDocument(invoice: Invoice, company: CompanyInfo | null | undefined, client: ClientLike, opts: DocOptions = {}): DocumentModel {
  const lang = opts.lang ?? "en";
  const L: Labels = LABELS[lang];
  const head = letterheadOf(company, L);
  const { intra, totals: t, byRate } = totalsOf(invoice.items, invoice.totals, company?.stateCode, invoice.placeOfSupply);
  const deductions = invoice.deductions ?? [];
  const net = invoice.netReceivablePaise ?? t.totalPaise - deductions.reduce((s, d) => s + d.amountPaise, 0);
  const paid = invoice.paidPaise ?? 0;
  const billedTo = clientParty(L.billedTo, client, invoice as Invoice & { clientAddress?: string }, L);
  return {
    kind: "invoice", lang, letterhead: head,
    title: L[INVOICE_TITLE[invoice.type] ?? "taxInvoice"] as string, subtitle: "",
    number: invoice.number,
    meta: pairsOf([
      [L.number, invoice.number ?? L.noNumber], [L.date, formatDate(invoice.date, lang)], [L.dueDate, invoice.dueDate ? formatDate(invoice.dueDate, lang) : ""],
      [L.placeOfSupply, stateLabel(invoice.placeOfSupply)],
    ]),
    parties: [billedTo, ...projectParty(opts.project?.name ?? invoice.projectName, opts.project?.address, L)],
    items: itemsTable(invoice.items, L),
    taxSummary: taxSummary(byRate, intra, t, L),
    totals: [
      ...totalLines(t, intra, L),
      ...deductions.map((d) => ({ label: `${L.less}: ${d.head}${d.rateBp ? ` (${formatBp(d.rateBp)})` : ""}`, value: rs(-d.amountPaise) })),
      ...(deductions.length ? [{ label: L.netReceivable, value: rs(net), strong: true }] : []),
      ...(paid > 0 ? [{ label: L.received, value: rs(paid) }, { label: L.balance, value: rs(net - paid), strong: true }] : []),
    ],
    ...closing(opts, L),
    bank: bankOf(opts.bank, L),
    signatures: signaturesOf(head, company, L),
    watermark: invoice.status === "draft" ? L.draft : invoice.status === "paid" ? L.paid : invoice.status === "cancelled" ? L.cancelled : null,
    figures: { taxablePaise: t.taxablePaise, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise, totalPaise: t.totalPaise, netPaise: net },
    shareValues: {
      clientName: billedTo.name, documentNumber: invoice.number ?? "", amount: formatINR(net), dueDate: invoice.dueDate ? formatDate(invoice.dueDate, lang) : "",
      companyName: head.name,
    },
  };
}

/** A quotation as a page (spec §8.2, §8.4). */
export function quotationDocument(q: QuotationLike, company: CompanyInfo | null | undefined, client: ClientLike, opts: DocOptions = {}): DocumentModel {
  const lang = opts.lang ?? "en";
  const L: Labels = LABELS[lang];
  const head = letterheadOf(company, L);
  const { intra, totals: t, byRate } = totalsOf(q.items, q.totals, company?.stateCode, q.placeOfSupply ?? client?.stateCode);
  const party = clientParty(L.quoteFor, client, q, L);
  return {
    kind: "quotation", lang, letterhead: head, title: L.quotation, subtitle: q.subject ?? "", number: q.number,
    meta: pairsOf([[L.number, q.number ?? L.noNumber], [L.date, formatDate(q.date, lang)], [L.validUntil, q.validUntil ? formatDate(q.validUntil, lang) : ""]]),
    parties: [party, ...projectParty(opts.project?.name ?? q.projectName, opts.project?.address ?? q.siteAddress, L)],
    items: itemsTable(q.items, L),
    taxSummary: taxSummary(byRate, intra, t, L),
    totals: totalLines(t, intra, L),
    ...closing(opts, L),
    bank: bankOf(opts.bank, L),
    signatures: signaturesOf(head, company, L),
    watermark: q.status === "draft" ? L.draft : null,
    figures: { taxablePaise: t.taxablePaise, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise, totalPaise: t.totalPaise, netPaise: t.totalPaise },
    shareValues: {
      clientName: party.name, documentNumber: q.number ?? "", amount: formatINR(t.totalPaise), dueDate: q.validUntil ? formatDate(q.validUntil, lang) : "", companyName: head.name,
    },
  };
}

/** A receipt for money received from a client (spec §8.6). `invoiceNumber` is the bill it was paid against. */
export function receiptDocument(
  receipt: PaymentReceived, company: CompanyInfo | null | undefined, client: ClientLike, opts: DocOptions & { invoiceNumber?: string | null } = {},
): DocumentModel {
  const lang = opts.lang ?? "en";
  const L: Labels = LABELS[lang];
  const head = letterheadOf(company, L);
  const held = (receipt.tdsPaise ?? 0) + (receipt.retentionPaise ?? 0) + (receipt.otherDeductionsPaise ?? 0);
  const party = clientParty(L.receivedFrom, client, receipt, L);
  const end = closing(opts, L);
  return {
    kind: "receipt", lang, letterhead: head, title: L.receipt, subtitle: receipt.isAdvance ? L.advance : "", number: receipt.receiptNo ?? null,
    meta: pairsOf([[L.number, receipt.receiptNo ?? L.noNumber], [L.date, formatDate(receipt.date, lang)]]),
    parties: [party, ...projectParty(opts.project?.name ?? receipt.projectName, opts.project?.address, L)],
    items: null, taxSummary: null,
    totals: [
      { label: L.amountReceived, value: rs(receipt.amountPaise), strong: !held },
      ...pairsOf([
        [L.tds, receipt.tdsPaise ? rs(receipt.tdsPaise) : ""], [L.retention, receipt.retentionPaise ? rs(receipt.retentionPaise) : ""],
        [L.otherDeductions, receipt.otherDeductionsPaise ? rs(receipt.otherDeductionsPaise) : ""],
      ]),
      ...(held ? [{ label: L.settled, value: rs(receipt.amountPaise + held), strong: true }] : []),
    ],
    ...end,
    blocks: [
      { kind: "pairs", heading: L.paymentDetails, rows: pairsOf([[L.mode, L.modes[receipt.mode] ?? receipt.mode], [L.reference, receipt.reference ?? ""], [L.againstInvoice, opts.invoiceNumber ?? ""]]) },
      ...end.blocks,
    ],
    bank: null,
    signatures: signaturesOf(head, company, L),
    watermark: null,
    figures: { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: receipt.amountPaise, netPaise: receipt.amountPaise },
    shareValues: { clientName: party.name, documentNumber: receipt.receiptNo ?? "", amount: formatINR(receipt.amountPaise), dueDate: "", companyName: head.name },
  };
}

/** Any simple `PrintDocSpec` on the company letterhead, so reports and statements look like the invoices. */
export function printSpecDocument(spec: PrintDocSpec, company?: CompanyInfo | null, opts: { lang?: Lang } = {}): DocumentModel {
  const lang = opts.lang ?? "en";
  const head = letterheadOf(company, LABELS[lang]);
  return {
    kind: "generic", lang, letterhead: head, title: spec.title, subtitle: spec.subtitle ?? "", number: null,
    meta: spec.meta ?? [], parties: [], items: null, taxSummary: null, totals: [], amountInWords: null,
    blocks: spec.sections.map((s): DocBlock => (s.kind === "table"
      ? { kind: "table", heading: s.heading, table: { columns: s.head.map((label, i) => ({ label, align: s.align?.[i] ?? "left" })), rows: s.rows } }
      : s)),
    bank: null, terms: null, signatures: [], footer: spec.footerNote ? [spec.footerNote] : [], watermark: null, figures: null,
    shareValues: { documentNumber: spec.title, companyName: head.name },
  };
}

// ───────────────────────── The renderer (one for screen, print view and print window) ─────────────────────────

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]!);
/** Only pictures the page itself carries or a secure address: nothing else becomes an image source. */
const safeImg = (u: string | null) => (u && /^(data:image\/(png|jpeg|webp|gif);base64,|https:\/\/|blob:)/.test(u) ? u : null);

/** A table in a box that scrolls sideways on a narrow screen (reachable by keyboard, named for screen readers). */
function tableHtml(t: DocTable, scrollLabel: string, attrs = ""): string {
  const cls = (i: number) => (t.columns[i]?.align === "right" ? ' class="r"' : "");
  const row = (cells: string[], tag: "td" | "th") => `<tr>${cells.map((c, i) => `<${tag}${cls(i)}>${esc(c)}</${tag}>`).join("")}</tr>`;
  return `<div class="ag-doc-scroll" tabindex="0" role="group" aria-label="${esc(scrollLabel)}"><table${attrs}><thead>${row(t.columns.map((c) => c.label), "th")}</thead><tbody>${t.rows.map((r) => row(r, "td")).join("")}</tbody>` +
    `${t.foot ? `<tfoot>${row(t.foot, "td")}</tfoot>` : ""}</table></div>`;
}

const pairsHtml = (rows: { label: string; value: string }[]) =>
  `<table class="ag-doc-pairs"><tbody>${rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join("")}</tbody></table>`;

function blockHtml(b: DocBlock, scrollLabel: string): string {
  const h = b.heading ? `<h2>${esc(b.heading)}</h2>` : "";
  const body = b.kind === "text" ? b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("") : b.kind === "pairs" ? pairsHtml(b.rows) : tableHtml(b.table, scrollLabel);
  return `<section class="ag-doc-block">${h}${body}</section>`;
}

/** The page itself (an `<article class="ag-doc">`), every value escaped. Needs `DOCUMENT_CSS`. */
export function documentBodyHtml(m: DocumentModel): string {
  const logo = safeImg(m.letterhead.logoUrl);
  const head = `<header class="ag-doc-head"><div class="ag-doc-co">${logo ? `<img class="ag-doc-logo" src="${esc(logo)}" alt="">` : ""}` +
    `<div><div class="ag-doc-name">${esc(m.letterhead.name)}</div><div class="ag-doc-lines">${m.letterhead.lines.map(esc).join("<br>")}</div></div></div>` +
    `<div class="ag-doc-title"><h1>${esc(m.title)}</h1>${m.subtitle ? `<div class="ag-doc-sub">${esc(m.subtitle)}</div>` : ""}` +
    `<dl class="ag-doc-meta">${m.meta.map((x) => `<div><dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd></div>`).join("")}</dl></div></header>`;
  const parties = m.parties.length
    ? `<section class="ag-doc-parties">${m.parties.map((p) => `<div><h2>${esc(p.heading)}</h2><div class="ag-doc-pname">${esc(p.name)}</div>${p.lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>`).join("")}</section>`
    : "";
  const scroll = LABELS[m.lang].scroll;
  const items = m.items ? tableHtml(m.items, scroll, " data-doc-items") : "";
  const left = (m.taxSummary ? `<h2>${esc(m.taxSummary.heading)}</h2>${tableHtml(m.taxSummary.table, scroll, " data-doc-tax")}` : "") +
    (m.amountInWords ? `<p class="ag-doc-words"><span>${esc(m.amountInWords.label)}:</span> ${esc(m.amountInWords.text)}</p>` : "");
  const totals = m.totals.length
    ? `<table class="ag-doc-totals" data-doc-totals><tbody>${m.totals.map((t) => `<tr${t.strong ? ' class="strong"' : ""}><td>${esc(t.label)}</td><td class="r">${esc(t.value)}</td></tr>`).join("")}</tbody></table>`
    : "";
  const after = left || totals ? `<section class="ag-doc-after"><div>${left}</div>${totals}</section>` : "";
  const bank = m.bank ? `<div><h2>${esc(m.bank.heading)}</h2>${pairsHtml(m.bank.rows)}</div>` : "";
  const terms = m.terms ? `<div><h2>${esc(m.terms.heading)}</h2><ol class="ag-doc-terms">${m.terms.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol></div>` : "";
  const signs = m.signatures.map((s) => {
    const img = safeImg(s.imageUrl);
    return `<div class="ag-doc-sign"><div>${esc(s.heading)}</div>${img ? `<img src="${esc(img)}" alt="">` : '<div class="ag-doc-sign-space"></div>'}<div class="ag-doc-sign-cap">${esc(s.caption)}</div></div>`;
  }).join("");
  const foot = bank || terms || signs ? `<section class="ag-doc-foot"><div class="ag-doc-foot-left">${bank}${terms}</div><div>${signs}</div></section>` : "";
  const thanks = m.footer.length ? `<footer class="ag-doc-thanks">${m.footer.map((l) => `<div>${esc(l)}</div>`).join("")}</footer>` : "";
  return `<article class="ag-doc" lang="${m.lang}" data-doc-kind="${m.kind}" style="--doc-accent:${esc(m.letterhead.accent)}">` +
    // The watermark is drawn by the stylesheet from the attribute, so it is decoration, not text on the page.
    `${m.watermark ? `<div class="ag-doc-mark" aria-hidden="true" data-mark="${esc(m.watermark)}"></div>` : ""}${head}${parties}${items}${after}${m.blocks.map((b) => blockHtml(b, scroll)).join("")}${foot}${thanks}</article>`;
}

/** Paper margins and page numbers (page numbers print where the browser supports margin boxes). */
export const DOCUMENT_PAGE_CSS = `@page{size:A4;margin:14mm 14mm 16mm;@bottom-right{content:counter(page) " / " counter(pages);font:10px system-ui,sans-serif;color:#5F544E}}`;

/** The look of the page: always dark ink on white paper, one accent colour, light lines, rows never split across pages. */
export const DOCUMENT_CSS = `
.ag-doc{--doc-accent:${DEFAULT_ACCENT};--doc-ink:#1A1206;--doc-soft:#5F544E;--doc-line:#DDD6D1;position:relative;box-sizing:border-box;width:100%;max-width:210mm;margin:0 auto;padding:14mm;background:#fff;color:var(--doc-ink);font:13px/1.5 Inter,"Noto Sans Devanagari",system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;text-align:left;overflow-wrap:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ag-doc *{box-sizing:border-box}
.ag-doc h1,.ag-doc h2,.ag-doc p,.ag-doc dl,.ag-doc dt,.ag-doc dd,.ag-doc ol{margin:0;padding:0}
.ag-doc h2{font-size:11px;font-weight:600;line-height:1.4;text-transform:uppercase;letter-spacing:.06em;color:var(--doc-soft);margin-bottom:4px}
.ag-doc-head{display:flex;justify-content:space-between;gap:16px;padding-bottom:12px;margin-bottom:14px;border-bottom:2px solid var(--doc-accent)}
.ag-doc-co{display:flex;gap:12px;align-items:flex-start;min-width:0}
.ag-doc-logo{max-height:56px;max-width:120px;object-fit:contain}
.ag-doc-name{font-size:18px;font-weight:600;line-height:1.25;color:var(--doc-ink)}
.ag-doc-lines{margin-top:2px;font-size:12px;color:var(--doc-soft)}
.ag-doc-title{flex:none;max-width:48%;text-align:right}
.ag-doc-title h1{font-size:20px;font-weight:600;line-height:1.2;letter-spacing:-.01em;color:var(--doc-accent)}
.ag-doc-sub{font-size:12px;color:var(--doc-soft)}
.ag-doc-meta{margin-top:6px;font-size:12px}
.ag-doc-meta div{display:flex;justify-content:flex-end;gap:8px}
.ag-doc-meta dt{color:var(--doc-soft)}
.ag-doc-meta dd{font-weight:600}
.ag-doc-parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px}
.ag-doc-pname{font-weight:600}
.ag-doc-scroll{margin-bottom:12px}
.ag-doc table{width:100%;border-collapse:collapse;font-size:12.5px;background:#fff;color:var(--doc-ink)}
.ag-doc th,.ag-doc td{padding:6px 8px;border:0;border-bottom:1px solid var(--doc-line);background:transparent;color:inherit;font-weight:400;text-align:left;vertical-align:top}
.ag-doc thead th{font-size:11px;font-weight:600;color:var(--doc-soft);border-bottom:1.5px solid var(--doc-ink);white-space:nowrap}
.ag-doc tfoot td{font-weight:600;border-top:1.5px solid var(--doc-ink);border-bottom:0}
.ag-doc .r{text-align:right;white-space:nowrap}
.ag-doc thead{display:table-header-group}
.ag-doc tr,.ag-doc-sign,.ag-doc-totals{break-inside:avoid;page-break-inside:avoid}
.ag-doc-after{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:20px;align-items:start;margin-bottom:14px}
.ag-doc-totals td{padding:4px 8px;border-bottom:0}
.ag-doc-totals tr.strong td{font-size:14px;font-weight:600;border-top:1.5px solid var(--doc-ink)}
.ag-doc-words{font-size:12.5px}
.ag-doc-words span{color:var(--doc-soft)}
.ag-doc-block{margin-bottom:12px}
.ag-doc-block p{margin-bottom:6px}
.ag-doc-pairs th{width:36%;color:var(--doc-soft)}
.ag-doc-pairs th,.ag-doc-pairs td{padding:3px 8px 3px 0;border-bottom:0}
.ag-doc-foot{display:grid;grid-template-columns:1.2fr 1fr;gap:20px;margin-top:18px}
.ag-doc-foot-left{display:grid;gap:12px;align-content:start}
.ag-doc-terms{padding-left:18px;font-size:12px}
.ag-doc-sign{text-align:right;font-size:12.5px}
.ag-doc-sign-space{height:52px}
.ag-doc-sign img{display:inline-block;max-height:52px;max-width:180px;object-fit:contain}
.ag-doc-sign-cap{display:inline-block;min-width:160px;padding-top:4px;border-top:1px solid var(--doc-ink);text-align:center;color:var(--doc-soft)}
.ag-doc-thanks{margin-top:18px;padding-top:8px;border-top:1px solid var(--doc-line);font-size:12px;text-align:center;color:var(--doc-soft)}
.ag-doc-mark{position:absolute;top:36%;left:0;right:0;text-align:center;font-size:84px;font-weight:700;line-height:1;letter-spacing:.08em;color:var(--doc-accent);opacity:.09;transform:rotate(-24deg);pointer-events:none;user-select:none}
.ag-doc-mark::before{content:attr(data-mark)}
.ag-doc-scroll:focus-visible{outline:2px solid var(--doc-accent);outline-offset:2px}
@media screen{.ag-doc{overflow:hidden}}
@media screen and (max-width:640px){.ag-doc{padding:16px}.ag-doc-head{flex-direction:column}.ag-doc-title{max-width:none;text-align:left}.ag-doc-meta div{justify-content:flex-start}.ag-doc-parties,.ag-doc-after,.ag-doc-foot{grid-template-columns:minmax(0,1fr)}.ag-doc-scroll{overflow-x:auto}.ag-doc-scroll table[data-doc-items]{min-width:540px}.ag-doc-mark{font-size:44px}}
@media print{.ag-doc{max-width:none;margin:0;padding:0}}
`;

/** A whole page for a new window: the document, its stylesheet and the paper size. Nothing else is loaded. */
export function documentHtml(m: DocumentModel): string {
  const title = [m.title, m.number].filter(Boolean).join(" ");
  return `<!doctype html><html lang="${m.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
    `<style>${DOCUMENT_PAGE_CSS}html,body{margin:0;background:#fff}@media screen{body{padding:16px;background:#F1EEEA}.ag-doc{box-shadow:0 1px 6px rgba(26,18,6,.18)}}${DOCUMENT_CSS}</style>` +
    `</head><body>${documentBodyHtml(m)}</body></html>`;
}

// ───────────────────────── Sharing: message templates, WhatsApp link, share log ─────────────────────────

export const SHARE_DOC_KINDS = ["invoice", "quotation", "receipt", "generic"] as const;
export type ShareTemplates = Record<DocumentKind, Record<Lang, string>>;

/** The messages used until the company writes its own (Settings keeps them in `settings/templates`, field `share`). */
export const DEFAULT_SHARE_TEMPLATES: ShareTemplates = {
  invoice: {
    en: "Namaste {clientName},\nBill {documentNumber} from {companyName} is ready. Amount: {amount}\nPlease pay by {dueDate}.\n{link}\nThank you.",
    hi: "नमस्ते {clientName},\n{companyName} का बिल {documentNumber} तैयार है। रकम: {amount}\nकृपया {dueDate} तक भुगतान कर दें।\n{link}\nधन्यवाद।",
  },
  quotation: {
    en: "Namaste {clientName},\nQuotation {documentNumber} from {companyName} is ready. Amount: {amount}\nIt is valid until {dueDate}.\n{link}\nThank you.",
    hi: "नमस्ते {clientName},\n{companyName} का कोटेशन {documentNumber} तैयार है। रकम: {amount}\nयह {dueDate} तक मान्य है।\n{link}\nधन्यवाद।",
  },
  receipt: {
    en: "Namaste {clientName},\nWe have received {amount}. Receipt number: {documentNumber}\n{link}\nThank you.\n{companyName}",
    hi: "नमस्ते {clientName},\nहमें {amount} मिल गए हैं। रसीद नंबर: {documentNumber}\n{link}\nधन्यवाद।\n{companyName}",
  },
  generic: {
    en: "Namaste {clientName},\nPlease see {documentNumber} from {companyName}.\n{link}\nThank you.",
    hi: "नमस्ते {clientName},\n{companyName} की ओर से {documentNumber} देखें।\n{link}\nधन्यवाद।",
  },
};

export const SHARE_TEMPLATE_MAX = 1000;
const isPlaceholder = (n: string): n is SharePlaceholder => (SHARE_PLACEHOLDERS as readonly string[]).includes(n);

/** The saved templates over the defaults: anything missing or empty falls back to the default. */
export function shareTemplatesFrom(settingsDoc: unknown): ShareTemplates {
  const saved = (settingsDoc as { share?: Partial<Record<string, Partial<Record<string, unknown>>>> } | null | undefined)?.share;
  const pick = (kind: DocumentKind, lang: Lang) => {
    const v = saved?.[kind]?.[lang];
    return typeof v === "string" && v.trim() ? v : DEFAULT_SHARE_TEMPLATES[kind][lang];
  };
  return Object.fromEntries(SHARE_DOC_KINDS.map((k) => [k, { en: pick(k, "en"), hi: pick(k, "hi") }])) as ShareTemplates;
}

/**
 * Put the values into a template. A line whose placeholders are all empty is left out (no link, no due date), so the
 * message never shows a dangling "Please pay by ." Unknown `{words}` are kept as typed.
 */
export function fillTemplate(template: string, values: ShareValues): string {
  const val = (n: SharePlaceholder) => (values[n] ?? "").trim();
  return template.split(/\r?\n/).map((line) => {
    const names = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter(isPlaceholder);
    if (names.length && names.every((n) => !val(n))) return null;
    return line.replace(/\{(\w+)\}/g, (all, n: string) => (isPlaceholder(n) ? val(n) : all)).replace(/ {2,}/g, " ").trimEnd();
  }).filter((l): l is string => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The message for a document: its kind's template in the chosen language, filled. */
export function shareMessage(kind: DocumentKind, lang: Lang, values: ShareValues, templates: ShareTemplates = DEFAULT_SHARE_TEMPLATES): string {
  return fillTemplate(templates[kind]?.[lang] ?? DEFAULT_SHARE_TEMPLATES[kind][lang], values);
}

/** Field errors for the templates form, keyed "invoice.en". Empty when everything is fine. */
export function validateShareTemplates(input: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  const t = (input ?? {}) as Partial<Record<string, Partial<Record<string, unknown>>>>;
  for (const kind of SHARE_DOC_KINDS) for (const lang of ["en", "hi"] as const) {
    const v = t[kind]?.[lang];
    const key = `${kind}.${lang}`;
    if (typeof v !== "string" || !v.trim()) errors[key] = "Write the message.";
    else if (v.length > SHARE_TEMPLATE_MAX) errors[key] = `Keep the message under ${SHARE_TEMPLATE_MAX} letters.`;
    else {
      const unknown = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((n) => !isPlaceholder(n));
      if (unknown.length) errors[key] = `{${unknown[0]}} is not one of the words that get filled in. Use: ${SHARE_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}.`;
    }
  }
  return errors;
}

/**
 * The WhatsApp address for a message: `https://wa.me/91XXXXXXXXXX?text=…` for an Indian mobile in any typed form.
 * Without a usable number WhatsApp opens and asks who to send it to.
 */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const d = phone ? normaliseIndianMobile(phone) : null;
  return `https://wa.me/${d ? `91${d}` : ""}?text=${encodeURIComponent(text)}`;
}

export const SHARE_LOG_COLLECTION = "share_logs";
export const SHARE_CHANNELS = ["whatsapp", "web_share", "email", "download", "print"] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/** One share of one document (docs/data-model.md `share_logs`). Append-only. */
export interface ShareLogRecord {
  id: string;
  /** The collection of the shared record ("invoices", "payments_received", …). */
  documentType: string;
  documentId: string;
  documentNumber: string;
  projectId: string | null;
  channel: ShareChannel;
  /** "+91XXXXXXXXXX", or "" when the phone's share sheet chose the person. */
  phone: string;
  sentBy: string;
  sentByName: string;
  sentAt: string;
}

export interface ShareLogInput { collection: string; id: string; channel: ShareChannel; phone?: string | null; documentNumber?: string | null }

export function buildShareLog(id: string, input: ShareLogInput, doc: Record<string, unknown>, by: { uid: string; name: string }, nowIso: string): ShareLogRecord {
  const d = input.phone ? normaliseIndianMobile(input.phone) : null;
  const number = [input.documentNumber, doc.number, doc.receiptNo].find((v) => typeof v === "string" && v) as string | undefined;
  return {
    id, documentType: input.collection, documentId: input.id, documentNumber: number ?? "", projectId: typeof doc.projectId === "string" ? doc.projectId : null,
    channel: input.channel, phone: d ? `+91${d}` : "", sentBy: by.uid, sentByName: by.name, sentAt: nowIso,
  };
}
