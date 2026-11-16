/**
 * Billing commands (spec §8.2 quotations, §8.3 invoices; decisions D-12, D-15, D-17, D-20, D-24).
 *
 * Quotations: save a draft, send it (it gets `AG/Q/…` once and keeps it across versions), mark it accepted, rejected
 * or expired, and make a bill from an accepted one. Saving a quotation that was already sent makes the next version
 * as a new record and leaves the sent one as it was.
 *
 * Invoices: save a draft, issue it (the next number of its series for the financial year, taken from the counter in
 * this same command so there are no gaps; GST numbers are at most 16 characters), cancel it with a reason (the number
 * is kept and never used again), and make a credit or debit note against an issued bill. Everything that moves money
 * goes through `store.post("invoices", id)`: no command writes a total, a receivable or a rollup itself. Receipts are
 * another feature; this one only keeps `paidPaise` (raised by the posting engine) and `creditedPaise` in step.
 *
 * Owner and accountant only. A locked month refuses every money change.
 */
import { assertMonthOpen } from "../accounts";
import {
  DRAFT_INVOICE_TYPES, billDocType, cleanItems, computeBill, deductionProblems, invoiceCancelRefusal, invoiceDuePaise, invoiceEditRefusal,
  isIssuedInvoice, itemProblems, noteRefusal, quotationChangeRefusal, quotationItems, quotationOutcomeRefusal, raCarryForward, statusFromMoney, toSections,
  type BillDeductionInput, type BillItem, type BillingInvoice, type Quotation, type QuotationStatus, type RaSummary,
} from "../billing";
import { addDays, formatDate, fyOf, isDateStr, monthKeyOf } from "../dates";
import type { Client, InvoiceType, Project } from "../model";
import { formatINR } from "../money";
import { GST_DOC_TYPES, allocate, counterId, quotationLabel, type DocType } from "../numbering";
import { searchKeywords } from "../search";
import type { Doc, MemoryStore } from "../store";
import { Checker, CommandError, newId, requireRole, stampCreate, stampUpdate, trimOrEmpty, type CommandCtx, type CommandFn } from "./common";
import { serverToday } from "./labour";

const FINANCE = ["owner", "accountant"] as const;

/** Drop keys that hold `undefined`, so a saved document never carries them. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function companyState(store: MemoryStore): string {
  return trimOrEmpty(store.get<{ stateCode?: string }>("settings", "company")?.stateCode) || "09";
}

interface Counter { id: string; docType: string; fy?: string; next?: number; lastDate?: string; lastNumber?: string }

/**
 * Take the next number of a series for the financial year of `date` (D-12): read the counter, format, write the
 * counter back, all inside the command (one transaction on the server). GST documents must also follow the dates: a
 * bill can't be dated before the one numbered just before it.
 */
function takeNumber(store: MemoryStore, docType: DocType, date: string, what: string): string {
  const fy = fyOf(date);
  const id = counterId(docType, fy);
  const counter = store.get<Counter>("counters", id);
  if (GST_DOC_TYPES.has(docType) && counter?.lastDate && date < counter.lastDate) {
    const last = formatDate(counter.lastDate);
    const msg = `${counter.lastNumber ?? "The last number"} is dated ${last}. ${what} can't be dated before it, because the numbers follow the dates. Use ${last} or a later date.`;
    throw new CommandError(msg, { date: msg });
  }
  const formats = store.get<{ formats?: Partial<Record<DocType, string>> }>("settings", "numbering")?.formats;
  let taken: ReturnType<typeof allocate>;
  try {
    taken = allocate(docType, fy, counter?.next, formats?.[docType]);
  } catch (e) {
    if (e instanceof RangeError) throw new CommandError("The next number would be longer than 16 characters, which GST rules don't allow. Ask the owner to shorten the number format in Settings.");
    throw e;
  }
  store.set("counters", { id, docType, fy, next: taken.next, lastDate: date, lastNumber: taken.number });
  return taken.number;
}

async function postInvoice(store: MemoryStore, id: string, nowIso: string) {
  const r = await store.post("invoices", id, nowIso);
  if (r.error) throw new CommandError(r.error);
}

/** Stop when anything is wrong. One problem is said as it is; several are listed under the fields with a short summary. */
function stopIfAny(c: Checker, summary = "Some details need fixing.") {
  const list = Object.values(c.errors);
  if (list.length === 1) throw new CommandError(list[0]!, c.errors);
  c.throwIfAny(summary);
}

function addProblems(c: Checker, problems: Record<string, string>) {
  for (const [k, v] of Object.entries(problems)) c.need(k, false, v);
}

/** The client and, when given, the project of a document; problems go to `c`. */
function parties(store: MemoryStore, c: Checker, clientId: string | null | undefined, projectId: string | null | undefined, projectNeeded: boolean) {
  const project = projectId ? store.get<Project>("projects", projectId) : null;
  if (projectNeeded || projectId) c.need("projectId", !!project && !project.isDeleted, "Choose the project this is for.");
  const cid = clientId || project?.clientId || "";
  const client = cid ? store.get<Client>("clients", cid) : null;
  c.need("clientId", !!client && !client.isDeleted, "Choose the client.");
  if (project && client) c.need("projectId", project.clientId === client.id, `${project.name} belongs to another client (${project.clientName}). Choose one of this client's projects.`);
  return { client, project };
}

function supplyState(c: Checker, typed: unknown, client: Client | null, company: string): string {
  const pos = trimOrEmpty(typed) || trimOrEmpty(client?.stateCode) || trimOrEmpty(client?.gstin).slice(0, 2) || company;
  c.need("placeOfSupply", /^\d{2}$/.test(pos), "The place of supply is the 2-digit state code, like 09 for Uttar Pradesh.");
  return pos;
}

// ───────────────────────── Invoices ─────────────────────────

export interface InvoiceDraftInput {
  /** The draft being changed; empty for a new one. */
  id?: string | null;
  type: InvoiceType;
  projectId: string;
  /** Defaults to the project's client. */
  clientId?: string | null;
  date: string;
  /** Defaults to 30 days after the date. */
  dueDate?: string | null;
  /** 2-digit state code; defaults to the client's state. */
  placeOfSupply?: string | null;
  items: BillItem[];
  deductions?: BillDeductionInput[] | null;
  notes?: string;
  milestoneId?: string | null;
  quotationId?: string | null;
  fromProformaId?: string | null;
}

type InvoiceFields = Pick<BillingInvoice, "type" | "projectId" | "projectName" | "clientId" | "clientName" | "clientGstin" | "clientStateCode" | "clientAddress" | "date"
  | "dueDate" | "monthKey" | "fy" | "placeOfSupply" | "intraState" | "items" | "totals" | "deductions" | "netReceivablePaise" | "amountInWords" | "notes" | "milestoneId"
  | "quotationId" | "fromProformaId" | "ra">;

/** Check what was typed and work out what is stored. Problems are added to `c`; returns null when there are any. */
function resolveInvoice(store: MemoryStore, c: Checker, input: InvoiceDraftInput): InvoiceFields | null {
  c.need("type", DRAFT_INVOICE_TYPES.includes(input.type), "Choose the kind of bill: tax, running (RA), milestone or proforma.");
  const { client, project } = parties(store, c, input.clientId, input.projectId, true);
  c.need("date", isDateStr(input.date), "Enter the bill date as DD/MM/YYYY.");
  const dueDate = trimOrEmpty(input.dueDate) || (isDateStr(input.date) ? addDays(input.date, 30) : "");
  c.need("dueDate", isDateStr(dueDate), "Enter the due date as DD/MM/YYYY.");
  c.need("dueDate", !isDateStr(dueDate) || !isDateStr(input.date) || dueDate >= input.date, "The due date can't be before the bill date.");
  const company = companyState(store);
  const pos = supplyState(c, input.placeOfSupply, client, company);
  addProblems(c, itemProblems(input.items));
  const deductionsIn = input.deductions ?? [];
  addProblems(c, deductionProblems(deductionsIn));
  if (Object.keys(c.errors).length) return null;

  const items = cleanItems(input.items);
  const comp = computeBill(items, company, pos, deductionsIn);
  c.need("items", comp.totals.totalPaise > 0, "This bill comes to zero. Check the quantities and rates.");
  c.need("deductions", comp.deductionsTotalPaise <= comp.totals.totalPaise, "The deductions come to more than the bill.");
  if (Object.keys(c.errors).length) return null;

  let ra: RaSummary | null = null;
  if (input.type === "ra") {
    const others = store.list<BillingInvoice>("invoices", undefined, { field: "projectId", value: project!.id });
    ra = raCarryForward(others, { id: input.id ?? null, projectId: project!.id, taxablePaise: comp.totals.taxablePaise, totalPaise: comp.totals.totalPaise });
  }
  return {
    type: input.type, projectId: project!.id, projectName: project!.name, clientId: client!.id, clientName: client!.name, clientGstin: client!.gstin ?? "",
    clientStateCode: client!.stateCode ?? "", clientAddress: client!.address ?? "", date: input.date, dueDate, monthKey: monthKeyOf(input.date), fy: fyOf(input.date),
    placeOfSupply: pos, intraState: comp.intraState, items, totals: comp.totals, deductions: comp.deductions, netReceivablePaise: comp.netReceivablePaise,
    amountInWords: comp.amountInWords, notes: trimOrEmpty(input.notes).slice(0, 1000), milestoneId: input.milestoneId || null, quotationId: input.quotationId || null,
    fromProformaId: input.fromProformaId || null, ra,
  };
}

function invoiceKeywords(f: { number?: string | null; clientName?: string; projectName?: string }) {
  return searchKeywords(f.number, f.clientName, f.projectName);
}

/** Save a bill as a draft: a new one, or a change to a draft. A draft has no number and counts nowhere. */
export function saveInvoiceDraft(store: MemoryStore, input: InvoiceDraftInput, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "make or change bills");
  const prev = input.id ? store.get<BillingInvoice>("invoices", input.id) : null;
  if (input.id && !prev) throw new CommandError("This bill no longer exists.");
  if (prev) {
    const refusal = invoiceEditRefusal(prev);
    if (refusal) throw new CommandError(refusal);
  }
  const c = new Checker();
  const f = resolveInvoice(store, c, input);
  stopIfAny(c);
  const fields = f!;
  const id = prev?.id ?? newId();
  const doc: BillingInvoice = clean({
    ...(prev ?? {}), ...fields, id, number: null, status: "draft" as const, paidPaise: 0, raBillId: prev?.raBillId ?? null,
    searchKeywords: invoiceKeywords(fields), ...(prev ? stampUpdate(ctx) : stampCreate(ctx)),
  });
  store.set("invoices", doc as unknown as Doc);
  return { id, totalPaise: fields.totals!.totalPaise };
}

/** A stored draft as the input that made it, so issuing works the totals out again from the lines. */
function draftInput(inv: BillingInvoice): InvoiceDraftInput {
  return {
    id: inv.id, type: inv.type, projectId: inv.projectId, clientId: inv.clientId, date: inv.date, dueDate: inv.dueDate, placeOfSupply: inv.placeOfSupply,
    items: inv.items, notes: inv.notes, milestoneId: inv.milestoneId, quotationId: inv.quotationId, fromProformaId: inv.fromProformaId,
    deductions: (inv.deductions ?? []).map((d) => ({ head: d.head, rateBp: d.rateBp, overridePaise: d.overridden ? d.amountPaise : null, reason: d.reason })),
  };
}

/**
 * Issue a draft: it gets the next number of its series, is locked, and from this moment counts as billed (a proforma
 * gets a proforma number and counts nowhere, D-24). The totals are worked out again from the lines first.
 */
export async function issueInvoice(store: MemoryStore, a: { id: string }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "issue bills");
  const prev = store.get<BillingInvoice>("invoices", a.id);
  if (!prev || prev.isDeleted) throw new CommandError("This bill no longer exists.");
  if (prev.status !== "draft") throw new CommandError(prev.status === "cancelled" ? "This bill was cancelled." : `This bill was already issued as ${prev.number ?? "a numbered bill"}.`);
  const c = new Checker();
  const f = resolveInvoice(store, c, draftInput(prev));
  c.need("date", !isDateStr(prev.date) || prev.date <= serverToday(ctx), "A bill can't be dated in the future. Change the date to today or earlier, then issue it.");
  stopIfAny(c, "This bill can't be issued yet. Open it and fix what is marked.");
  const fields = f!;
  const money = fields.type !== "proforma";
  if (money) assertMonthOpen(store, fields.date, "this bill");
  const number = takeNumber(store, billDocType(fields.type), fields.date, "This bill");
  const doc: BillingInvoice = clean({
    ...prev, ...fields, number, status: "sent" as const, paidPaise: 0, issuedAt: ctx.nowIso, issuedBy: ctx.uid, lockedAt: ctx.nowIso,
    searchKeywords: invoiceKeywords({ ...fields, number }), ...stampUpdate(ctx),
  });
  store.set("invoices", doc as unknown as Doc);
  await postInvoice(store, doc.id, ctx.nowIso);
  return { id: doc.id, number, totalPaise: fields.totals!.totalPaise, netReceivablePaise: fields.netReceivablePaise ?? fields.totals!.totalPaise };
}

/** Notes that stand against a bill (issued credit and debit notes). */
function liveNotes(store: MemoryStore, inv: BillingInvoice): BillingInvoice[] {
  return store.list<BillingInvoice>("invoices", (n) => n.againstInvoiceId === inv.id && isIssuedInvoice(n) && !n.isDeleted, { field: "projectId", value: inv.projectId });
}

/** Add to (or take back from) what stands credited or debited on the bill a note is against, and set its status again. */
function applyNoteToOriginal(store: MemoryStore, note: BillingInvoice, sign: 1 | -1, ctx: CommandCtx) {
  const orig = note.againstInvoiceId ? store.get<BillingInvoice>("invoices", note.againstInvoiceId) : null;
  if (!orig || !note.totals) return null;
  const field = note.type === "credit_note" ? "creditedPaise" : "debitedPaise";
  const next = { ...orig, [field]: Math.max(0, (orig[field] ?? 0) + sign * note.totals.totalPaise) };
  store.merge("invoices", orig.id, { [field]: next[field], status: statusFromMoney(next, serverToday(ctx)), ...stampUpdate(ctx) });
  return store.get<BillingInvoice>("invoices", orig.id);
}

/**
 * Cancel a bill. An issued bill needs a reason; what it added to the totals is taken back exactly, and its number
 * stays on the cancelled record so it is never given to another bill. A draft is simply set aside.
 */
export async function cancelInvoice(store: MemoryStore, a: { id: string; reason?: string }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "cancel bills");
  const inv = store.get<BillingInvoice>("invoices", a.id);
  if (!inv || inv.isDeleted) throw new CommandError("This bill no longer exists.");
  const issued = isIssuedInvoice(inv);
  const refusal = invoiceCancelRefusal(inv, issued ? liveNotes(store, inv).length : 0);
  if (refusal) throw new CommandError(refusal);
  const reason = trimOrEmpty(a.reason).slice(0, 300);
  if (issued && reason.length < 3) throw new CommandError("Say why this bill is being cancelled.", { reason: "Say why this bill is being cancelled." });
  if (issued && inv.type !== "proforma") assertMonthOpen(store, inv.date, "this bill");
  store.merge("invoices", inv.id, { status: "cancelled", cancelReason: reason, cancelledAt: ctx.nowIso, cancelledBy: ctx.uid, ...stampUpdate(ctx) });
  if (issued) {
    await postInvoice(store, inv.id, ctx.nowIso);
    if (inv.type === "credit_note" || inv.type === "debit_note") applyNoteToOriginal(store, inv, -1, ctx);
  }
  return { id: inv.id, number: inv.number, wasIssued: issued };
}

export interface NoteInput {
  /** The issued bill the note is against. */
  invoiceId: string;
  date: string;
  reason: string;
  items: BillItem[];
}

async function createNote(store: MemoryStore, type: "credit_note" | "debit_note", input: NoteInput, ctx: CommandCtx) {
  const name = type === "credit_note" ? "credit note" : "debit note";
  requireRole(ctx, FINANCE, `make ${name}s`);
  const orig = store.get<BillingInvoice>("invoices", input.invoiceId);
  if (!orig || orig.isDeleted) throw new CommandError("The bill this note is against no longer exists.");
  const refusal = noteRefusal(orig);
  if (refusal) throw new CommandError(refusal);
  const c = new Checker();
  c.need("date", isDateStr(input.date), "Enter the date as DD/MM/YYYY.");
  c.need("date", !isDateStr(input.date) || input.date >= orig.date, `A ${name} can't be dated before the bill it is against (${formatDate(orig.date)}).`);
  c.need("date", !isDateStr(input.date) || input.date <= serverToday(ctx), `A ${name} can't be dated in the future.`);
  const reason = trimOrEmpty(input.reason).slice(0, 300);
  c.need("reason", reason.length >= 3, `Say why this ${name} is being made.`);
  addProblems(c, itemProblems(input.items));
  stopIfAny(c);
  const items = cleanItems(input.items);
  const comp = computeBill(items, companyState(store), orig.placeOfSupply);
  c.need("items", comp.totals.totalPaise > 0, `This ${name} comes to zero. Check the amount.`);
  if (type === "credit_note") {
    const left = orig.totals!.totalPaise - (orig.creditedPaise ?? 0);
    c.need("items", comp.totals.totalPaise <= left, `This credit note comes to ${formatINR(comp.totals.totalPaise)}, but only ${formatINR(left)} of bill ${orig.number} is left to credit.`);
  }
  stopIfAny(c);
  assertMonthOpen(store, input.date, `this ${name}`);
  const number = takeNumber(store, billDocType(type), input.date, `This ${name}`);
  const note: BillingInvoice = clean({
    id: newId(), number, type, projectId: orig.projectId, projectName: orig.projectName, clientId: orig.clientId, clientName: orig.clientName,
    clientGstin: orig.clientGstin ?? "", clientStateCode: orig.clientStateCode, clientAddress: orig.clientAddress, date: input.date, dueDate: input.date,
    monthKey: monthKeyOf(input.date), fy: fyOf(input.date), placeOfSupply: orig.placeOfSupply, intraState: comp.intraState, items, totals: comp.totals,
    deductions: [], netReceivablePaise: comp.totals.totalPaise, amountInWords: comp.amountInWords, status: "sent" as const, paidPaise: 0,
    againstInvoiceId: orig.id, againstInvoiceNumber: orig.number, noteReason: reason, issuedAt: ctx.nowIso, issuedBy: ctx.uid, lockedAt: ctx.nowIso,
    searchKeywords: invoiceKeywords({ number, clientName: orig.clientName, projectName: orig.projectName }), ...stampCreate(ctx),
  });
  store.set("invoices", note as unknown as Doc);
  await postInvoice(store, note.id, ctx.nowIso);
  const after = applyNoteToOriginal(store, note, 1, ctx);
  return { id: note.id, number, totalPaise: comp.totals.totalPaise, invoiceDuePaise: after ? invoiceDuePaise(after) : 0 };
}

/** A credit note against an issued bill: lowers what is billed and owed, in the month of the note (D-24). */
export function createCreditNote(store: MemoryStore, input: NoteInput, ctx: CommandCtx) {
  return createNote(store, "credit_note", input, ctx);
}

/** A debit note against an issued bill: an extra amount billed, in the month of the note (D-24). */
export function createDebitNote(store: MemoryStore, input: NoteInput, ctx: CommandCtx) {
  return createNote(store, "debit_note", input, ctx);
}

// ───────────────────────── Quotations ─────────────────────────

export interface QuotationInput {
  /** The quotation being changed. A draft is changed in place; a sent one gets a new version. Empty for a new one. */
  id?: string | null;
  clientId: string;
  projectId?: string | null;
  leadId?: string | null;
  title?: string;
  date: string;
  validUntil: string;
  placeOfSupply?: string | null;
  items: BillItem[];
  terms?: string;
  paymentTerms?: string;
  inclusions?: string;
  exclusions?: string;
  notes?: string;
}

/**
 * Save a quotation as a draft. Saving one that was already sent makes the next version (same number, D-17) as a new
 * record; the sent version stays as it was and becomes read-only.
 */
export function saveQuotation(store: MemoryStore, input: QuotationInput, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "make or change quotations");
  const prev = input.id ? store.get<Quotation>("quotations", input.id) : null;
  if (input.id && !prev) throw new CommandError("This quotation no longer exists.");
  if (prev) {
    const refusal = quotationChangeRefusal(prev);
    if (refusal) throw new CommandError(refusal);
  }
  const c = new Checker();
  const { client, project } = parties(store, c, input.clientId, input.projectId, false);
  c.need("date", isDateStr(input.date), "Enter the quotation date as DD/MM/YYYY.");
  c.need("validUntil", isDateStr(input.validUntil), "Enter the date the quotation is valid until, as DD/MM/YYYY.");
  c.need("validUntil", !isDateStr(input.validUntil) || !isDateStr(input.date) || input.validUntil >= input.date, "The valid-until date can't be before the quotation date.");
  const company = companyState(store);
  const pos = supplyState(c, input.placeOfSupply, client, company);
  addProblems(c, itemProblems(input.items));
  stopIfAny(c);
  const items = cleanItems(input.items);
  const comp = computeBill(items, company, pos);
  c.need("items", comp.totals.totalPaise > 0, "This quotation comes to zero. Check the quantities and rates.");
  stopIfAny(c);

  const revise = !!prev && prev.status !== "draft";
  const id = prev && !revise ? prev.id : newId();
  const title = trimOrEmpty(input.title).slice(0, 160);
  const fields = {
    clientId: client!.id, clientName: client!.name, clientGstin: client!.gstin ?? "", clientStateCode: client!.stateCode ?? "", clientAddress: client!.address ?? "",
    projectId: project?.id ?? null, projectName: project?.name ?? null, leadId: input.leadId || null, title, date: input.date, validUntil: input.validUntil,
    monthKey: monthKeyOf(input.date), fy: fyOf(input.date), placeOfSupply: pos, intraState: comp.intraState, sections: toSections(items), totals: comp.totals,
    amountInWords: comp.amountInWords, terms: trimOrEmpty(input.terms).slice(0, 4000), paymentTerms: trimOrEmpty(input.paymentTerms).slice(0, 2000),
    inclusions: trimOrEmpty(input.inclusions).slice(0, 2000), exclusions: trimOrEmpty(input.exclusions).slice(0, 2000), notes: trimOrEmpty(input.notes).slice(0, 1000),
  };
  let doc: Quotation;
  if (prev && !revise) {
    doc = { ...prev, ...fields, ...stampUpdate(ctx) };
  } else {
    doc = {
      ...fields, id, number: revise ? prev!.number : null, version: revise ? prev!.version + 1 : 1, rootQuotationId: revise ? prev!.rootQuotationId : id,
      isLatest: true, supersededBy: null, status: "draft", invoiceIds: [], ...stampCreate(ctx),
    };
    if (revise) store.merge("quotations", prev!.id, { isLatest: false, supersededBy: id, ...stampUpdate(ctx) });
  }
  doc.searchKeywords = searchKeywords(doc.number, doc.clientName, doc.projectName, doc.title);
  store.set("quotations", clean(doc) as unknown as Doc);
  return { id, version: doc.version, revised: revise, totalPaise: comp.totals.totalPaise };
}

/** Send a draft quotation: the first version gets its number; a later version keeps the number it already has. */
export function sendQuotation(store: MemoryStore, a: { id: string }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "send quotations");
  const q = store.get<Quotation>("quotations", a.id);
  if (!q || q.isDeleted) throw new CommandError("This quotation no longer exists.");
  if (q.status !== "draft") throw new CommandError(`This quotation was already sent${q.number ? ` as ${quotationLabel(q.number, q.version)}` : ""}.`);
  if (q.date > serverToday(ctx)) throw new CommandError("A quotation can't be dated in the future. Change the date to today or earlier, then send it.", { date: "A quotation can't be dated in the future." });
  const number = q.number ?? takeNumber(store, "quotation", q.date, "This quotation");
  store.merge("quotations", q.id, {
    number, status: "sent", sentAt: ctx.nowIso, sentBy: ctx.uid, searchKeywords: searchKeywords(number, q.clientName, q.projectName, q.title), ...stampUpdate(ctx),
  });
  return { id: q.id, number, version: q.version, label: quotationLabel(number, q.version) };
}

/** Mark a sent quotation accepted, rejected or expired. */
export function setQuotationStatus(store: MemoryStore, a: { id: string; status: QuotationStatus; note?: string }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "change a quotation's status");
  const q = store.get<Quotation>("quotations", a.id);
  if (!q || q.isDeleted) throw new CommandError("This quotation no longer exists.");
  const refusal = quotationOutcomeRefusal(q, a.status);
  if (refusal) throw new CommandError(refusal);
  store.merge("quotations", q.id, { status: a.status, statusNote: trimOrEmpty(a.note).slice(0, 300), decidedAt: ctx.nowIso, decidedBy: ctx.uid, ...stampUpdate(ctx) });
  return { id: q.id, status: a.status };
}

/**
 * Make a draft bill from an accepted quotation (spec §8.2 "one-click convert"): the same lines, client and place of
 * supply, dated today. The bill is a draft: it is checked, changed if needed, and issued from the bill screen.
 */
export function convertQuotationToInvoice(store: MemoryStore, a: { id: string; projectId?: string | null; type?: InvoiceType }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "make bills");
  const q = store.get<Quotation>("quotations", a.id);
  if (!q || q.isDeleted) throw new CommandError("This quotation no longer exists.");
  if (!q.isLatest) throw new CommandError("A newer version of this quotation exists. Open that one.");
  if (q.status !== "accepted") throw new CommandError("Mark the quotation as accepted first. A bill is made only from an accepted quotation.");
  const projectId = a.projectId || q.projectId || "";
  if (!projectId) throw new CommandError("Choose the project this bill is for. Every bill belongs to a project.", { projectId: "Choose the project this bill is for." });
  const today = serverToday(ctx);
  const made = saveInvoiceDraft(store, {
    type: a.type ?? "tax", projectId, clientId: q.clientId, date: today, placeOfSupply: q.placeOfSupply, items: quotationItems(q), quotationId: q.id,
    notes: q.number ? `As per quotation ${quotationLabel(q.number, q.version)}` : "",
  }, ctx);
  store.merge("quotations", q.id, { invoiceIds: [...(q.invoiceIds ?? []), made.id], ...stampUpdate(ctx) });
  return { invoiceId: made.id, totalPaise: made.totalPaise };
}

/** The names the screens call (spread into the registry by the lane lead). */
export const BILLING_COMMANDS = {
  saveQuotation: (s, a: QuotationInput, c) => saveQuotation(s, a, c),
  sendQuotation: (s, a: { id: string }, c) => sendQuotation(s, a, c),
  setQuotationStatus: (s, a: { id: string; status: QuotationStatus; note?: string }, c) => setQuotationStatus(s, a, c),
  convertQuotationToInvoice: (s, a: { id: string; projectId?: string | null; type?: InvoiceType }, c) => convertQuotationToInvoice(s, a, c),
  saveInvoiceDraft: (s, a: InvoiceDraftInput, c) => saveInvoiceDraft(s, a, c),
  issueInvoice: (s, a: { id: string }, c) => issueInvoice(s, a, c),
  cancelInvoice: (s, a: { id: string; reason?: string }, c) => cancelInvoice(s, a, c),
  createCreditNote: (s, a: NoteInput, c) => createCreditNote(s, a, c),
  createDebitNote: (s, a: NoteInput, c) => createDebitNote(s, a, c),
} satisfies Record<string, CommandFn>;
