// Billing: quotations and invoices (spec §8.2, §8.3; decisions D-12, D-15, D-17, D-20, D-24).
// IDs BL-xx are cited in docs/prd-traceability.md. Money is checked to the paisa.
import { beforeEach, describe, expect, it } from "vitest";
import { CommandError, amountInWords, seedDemo, seededIds, withIdSource, Loaded, LoadingStore, type CommandCtx, type MemoryStore } from "../src";
import {
  COMMON_BILL_ITEMS, LOCKED_ONCE_ISSUED, billDocType, computeBill, deductionProblems, groupBySection, invoiceCancelRefusal, invoiceDuePaise, invoiceEditRefusal,
  itemProblems, quotationItems, quotationShownStatus, raCarryForward, statusFromMoney, toSections,
  type BillItem, type BillingInvoice, type Quotation,
} from "../src/billing";
import {
  BILLING_COMMANDS, cancelInvoice, convertQuotationToInvoice, createCreditNote, createDebitNote, issueInvoice, saveInvoiceDraft, saveQuotation, sendQuotation,
  setQuotationStatus, type InvoiceDraftInput, type QuotationInput,
} from "../src/commands/billing";
import { seedBilling } from "../src/demo/billing";
import { FEATURE_SEEDS } from "../src/demo/features";

const ANCHOR = "2026-10-25";
const NOW = "2026-10-25T09:00:00.000Z"; // 14:30 IST on 25 Oct 2026
const owner: CommandCtx = { uid: "uOwner", role: "owner", projectIds: [], nowIso: NOW };
const accountant: CommandCtx = { uid: "uAccountant", role: "accountant", projectIds: [], nowIso: NOW };
const pm: CommandCtx = { uid: "uPm", role: "pm", projectIds: ["projShivNagar", "projSharma"], nowIso: NOW };
const sup: CommandCtx = { uid: "uSupShivNagar", role: "supervisor", projectIds: ["projShivNagar"], nowIso: NOW };
const viewer: CommandCtx = { uid: "uViewer", role: "viewer", projectIds: [], nowIso: NOW };
const ca: CommandCtx = { uid: "uCa", role: "ca", projectIds: [], nowIso: NOW };
const FY = "2026-27";
const MONTH = "2026-10";

let store: MemoryStore;
// Every test starts from the base demo only (no feature seeds), so the figures below are fixed.
beforeEach(async () => {
  const featureSeeds = FEATURE_SEEDS.splice(0);
  try { ({ store } = await seedDemo(ANCHOR)); } finally { FEATURE_SEEDS.push(...featureSeeds); }
});

/** 2.5 sqm at ₹1,234.56 with 18% GST: taxable ₹3,086.40. */
const LINE: BillItem = { description: "Extra plaster work", hsnSac: "995472", unit: "sqm", qtyMilli: 2500, ratePaise: 123_456, gstRateBp: 1800 };
const draft = (over: Partial<InvoiceDraftInput> = {}): InvoiceDraftInput => ({ type: "tax", projectId: "projSharma", date: "2026-10-24", items: [LINE], ...over });
const quote = (over: Partial<QuotationInput> = {}): QuotationInput => ({ clientId: "clSharma", projectId: "projSharma", title: "Boundary wall", date: "2026-10-20", validUntil: "2026-11-19", items: [{ ...LINE, section: "Wall" }], ...over });
const inv = (id: string) => store.get<BillingInvoice>("invoices", id)!;
const qtn = (id: string) => store.get<Quotation>("quotations", id)!;
const num = (collection: string, id: string, field: string) => (store.get<Record<string, number>>(collection, id)?.[field] ?? 0);
const billed = () => ({
  co: num("finance_rollups", `co_${MONTH}`, "billedPaise"), coGst: num("finance_rollups", `co_${MONTH}`, "gstOutputPaise"),
  pm: num("finance_rollups", `p_projSharma_${MONTH}`, "billedPaise"), pmGst: num("finance_rollups", `p_projSharma_${MONTH}`, "gstOutputPaise"),
  all: num("finance_rollups", "p_projSharma_all", "billedPaise"), allGst: num("finance_rollups", "p_projSharma_all", "gstOutputPaise"),
  client: num("client_balances", "clSharma", "billedPaise"),
});
const nextNo = (series = `invoice_${FY}`) => store.get<{ next?: number }>("counters", series)?.next ?? 1;
const fieldsOf = (fn: () => unknown): Record<string, string> => {
  try { fn(); } catch (e) { if (e instanceof CommandError) return e.fields; throw e; }
  throw new Error("expected a refusal");
};
async function issued(over: Partial<InvoiceDraftInput> = {}, ctx = accountant) {
  const { id } = saveInvoiceDraft(store, draft(over), ctx);
  return issueInvoice(store, { id }, ctx);
}

describe("GST, rounding, deductions and words (D-15)", () => {
  it("BL-01 intra-state: CGST and SGST are half the rate each, per line, to the paisa", () => {
    const b = computeBill([LINE], "09", "09");
    expect(b.intraState).toBe(true);
    expect(b.totals).toEqual({ taxablePaise: 308_640, cgstPaise: 27_778, sgstPaise: 27_778, igstPaise: 0, roundOffPaise: 4, totalPaise: 364_200 });
    expect(b.lines[0]).toEqual({ taxablePaise: 308_640, cgstPaise: 27_778, sgstPaise: 27_778, igstPaise: 0 });
  });

  it("BL-02 inter-state: IGST at the full rate, no CGST or SGST", () => {
    const b = computeBill([LINE], "09", "07");
    expect(b.intraState).toBe(false);
    expect(b.totals).toEqual({ taxablePaise: 308_640, cgstPaise: 0, sgstPaise: 0, igstPaise: 55_555, roundOffPaise: 5, totalPaise: 364_200 });
  });

  it("BL-03 the total is rounded to the rupee, half up, with the round-off shown; several lines and rates add up", () => {
    const one = (ratePaise: number) => computeBill([{ description: "x", qtyMilli: 1000, ratePaise, gstRateBp: 0 }], "09", "09").totals;
    expect(one(100_050)).toMatchObject({ totalPaise: 100_100, roundOffPaise: 50 });
    expect(one(100_049)).toMatchObject({ totalPaise: 100_000, roundOffPaise: -49 });
    const b = computeBill([LINE, { description: "Sand", qtyMilli: 3333, ratePaise: 4_999, gstRateBp: 500, discountBp: 1000 }], "09", "09");
    // Sand: 3.333 × 49.99 × 0.9 = 149.955… → ₹149.96 taxable; CGST = SGST = 2.5% = ₹3.75
    expect(b.lines[1]).toEqual({ taxablePaise: 14_996, cgstPaise: 375, sgstPaise: 375, igstPaise: 0 });
    expect(b.totals.taxablePaise).toBe(308_640 + 14_996);
    expect(b.byRate.map((r) => r.rateBp)).toEqual([500, 1800]);
    const gross = b.totals.taxablePaise + b.totals.cgstPaise + b.totals.sgstPaise;
    expect(b.totals.totalPaise % 100).toBe(0);
    expect(b.totals.totalPaise - gross).toBe(b.totals.roundOffPaise);
    expect(Math.abs(b.totals.roundOffPaise)).toBeLessThanOrEqual(50);
  });

  it("BL-04 deductions: a rate on the taxable value rounded to the rupee, or a typed amount with a reason", () => {
    const work: BillItem = { description: "RA work", qtyMilli: 1000, ratePaise: 100_000_000, gstRateBp: 1800 }; // ₹10,00,000
    const b = computeBill([work], "09", "09", [
      { head: "TDS, income tax", rateBp: 200 }, { head: "GST-TDS", rateBp: 200 }, { head: "Labour cess", rateBp: 100 }, { head: "Retention", rateBp: 500 },
      { head: "Advance adjustment", rateBp: 0, overridePaise: 12_345_600, reason: "Mobilisation advance, second part" },
    ]);
    expect(b.totals.totalPaise).toBe(118_000_000);
    expect(b.deductions.map((d) => d.amountPaise)).toEqual([2_000_000, 2_000_000, 1_000_000, 5_000_000, 12_345_600]);
    expect(b.deductions[4]).toMatchObject({ overridden: true, reason: "Mobilisation advance, second part" });
    expect(b.deductionsTotalPaise).toBe(22_345_600);
    expect(b.netReceivablePaise).toBe(118_000_000 - 22_345_600);
    // 2% of ₹1,234.56 is ₹24.69, which becomes ₹25 (deductions are whole rupees).
    expect(computeBill([{ description: "x", qtyMilli: 1000, ratePaise: 123_456, gstRateBp: 0 }], "09", "09", [{ head: "TDS", rateBp: 200 }]).deductions[0]!.amountPaise).toBe(2_500);
    expect(deductionProblems([{ head: "Advance", rateBp: 0, overridePaise: 100 }])).toHaveProperty("deductions.0.reason");
    expect(deductionProblems([{ head: "", rateBp: 20_000 }])).toMatchObject({ "deductions.0.head": expect.any(String), "deductions.0.rateBp": expect.any(String) });
  });

  it("BL-05 amount in words, Indian system: zero, paise, lakh, crore", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(50)).toBe("Rupees Zero and Fifty Paise Only");
    expect(amountInWords(12_345_678)).toBe("Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Seventy-Eight Paise Only");
    expect(amountInWords(2_500_000_000)).toBe("Rupees Two Crore Fifty Lakh Only");
    expect(amountInWords(118_000_000)).toBe("Rupees Eleven Lakh Eighty Thousand Only");
    expect(computeBill([LINE], "09", "09").amountInWords).toBe("Rupees Three Thousand Six Hundred Forty-Two Only");
  });

  it("BL-06 lines: plain-words problems per field, sections kept in order, common items ready", () => {
    expect(itemProblems([])).toHaveProperty("items");
    const p = itemProblems([{ description: "", qtyMilli: 0, ratePaise: -1, gstRateBp: 9999, hsnSac: "12" }]);
    expect(Object.keys(p).sort()).toEqual(["items.0.description", "items.0.gstRateBp", "items.0.hsnSac", "items.0.qtyMilli", "items.0.ratePaise"]);
    const items: BillItem[] = [{ ...LINE, section: "Base" }, { ...LINE, section: "Base" }, { ...LINE, section: "Surface" }, { ...LINE }];
    expect(groupBySection(items).map((g) => [g.title, g.items.length])).toEqual([["Base", 2], ["Surface", 1], ["", 1]]);
    const sections = toSections(items);
    expect(sections[0]!.items[0]).not.toHaveProperty("section");
    expect(quotationItems({ sections }).map((i) => i.section)).toEqual(["Base", "Base", "Surface", undefined]);
    expect(COMMON_BILL_ITEMS.length).toBeGreaterThanOrEqual(8);
    expect(itemProblems(COMMON_BILL_ITEMS.map((c) => ({ ...c, qtyMilli: 1000, ratePaise: 100 })))).toEqual({});
  });
});

describe("invoices: draft, issue, numbering, lock (D-12, §8.3)", () => {
  it("BL-07 a draft has no number and counts nowhere; issuing numbers it, locks it and posts it", async () => {
    const before = billed();
    const { id, totalPaise } = saveInvoiceDraft(store, draft(), accountant);
    expect(totalPaise).toBe(364_200);
    expect(inv(id)).toMatchObject({ status: "draft", number: null, clientId: "clSharma", clientName: "Rajesh Sharma", placeOfSupply: "09", intraState: true, dueDate: "2026-11-23" });
    expect(billed()).toEqual(before);
    const n = nextNo();
    const r = await issueInvoice(store, { id }, accountant);
    expect(r.number).toBe(`AG/${FY}/${String(n).padStart(4, "0")}`);
    expect(inv(id)).toMatchObject({ status: "sent", number: r.number, issuedBy: "uAccountant", lockedAt: NOW, amountInWords: "Rupees Three Thousand Six Hundred Forty-Two Only" });
    const after = billed();
    expect(after.co - before.co).toBe(364_200);
    expect(after.pm - before.pm).toBe(364_200);
    expect(after.all - before.all).toBe(364_200);
    expect(after.client - before.client).toBe(364_200);
    expect(after.coGst - before.coGst).toBe(55_556);
    expect(invoiceDuePaise(inv(id))).toBe(364_200);
  });

  it("BL-08 numbers are gapless across commands and restart each financial year", async () => {
    const n = nextNo();
    expect(n).toBe(9); // the base demo issued eight bills this year
    const a = await issued({ date: "2026-10-23" });
    const b = await issued({ date: "2026-10-24" }, owner);
    const c = await issued({ date: "2026-10-25" });
    expect([a.number, b.number, c.number]).toEqual([`AG/${FY}/0009`, `AG/${FY}/0010`, `AG/${FY}/0011`]);
    expect(nextNo()).toBe(12);
    // 1 April 2027 is the first day of financial year 2027-28: its own series, from 0001.
    const april: CommandCtx = { ...accountant, nowIso: "2027-04-02T09:00:00.000Z" };
    const d = await issued({ date: "2027-04-01" }, april);
    const e = await issued({ date: "2027-04-02" }, april);
    expect([d.number, e.number]).toEqual(["AG/2027-28/0001", "AG/2027-28/0002"]);
    expect(nextNo()).toBe(12);
    expect(nextNo("invoice_2027-28")).toBe(3);
    const numbers = store.list<BillingInvoice>("invoices", (i) => !!i.number && i.fy === FY && billDocType(i.type) === "invoice").map((i) => i.number).sort();
    expect(numbers).toEqual(Array.from({ length: 11 }, (_, i) => `AG/${FY}/${String(i + 1).padStart(4, "0")}`));
  });

  it("BL-09 a cancelled bill keeps its number and the number is never given again", async () => {
    const a = await issued({ date: "2026-10-23" });
    await cancelInvoice(store, { id: a.id, reason: "Wrong client name on the bill" }, accountant);
    expect(inv(a.id)).toMatchObject({ status: "cancelled", number: a.number, cancelReason: "Wrong client name on the bill", cancelledBy: "uAccountant" });
    const b = await issued({ date: "2026-10-24" });
    expect(a.number).toBe(`AG/${FY}/0009`);
    expect(b.number).toBe(`AG/${FY}/0010`);
    expect(store.list<BillingInvoice>("invoices", (i) => i.number === a.number).length).toBe(1);
  });

  it("BL-10 a GST number longer than 16 characters is refused and nothing is used up", async () => {
    store.set("settings", { id: "numbering", formats: { invoice: "AG/INV/{fy}/{seq4}" } });
    const { id } = saveInvoiceDraft(store, draft(), accountant);
    await expect(issueInvoice(store, { id }, accountant)).rejects.toThrow(/16 characters/);
    expect(inv(id)).toMatchObject({ status: "draft", number: null });
    expect(nextNo()).toBe(9);
    // A proforma is not a GST document: its longer number is fine and comes from its own series.
    const p = await issued({ type: "proforma" });
    expect(p.number).toBe(`AG/PF/${FY}/0001`);
  });

  it("BL-11 a bill can't be dated in the future, or before the bill numbered just before it", async () => {
    const future = saveInvoiceDraft(store, draft({ date: "2026-10-26" }), accountant);
    await expect(issueInvoice(store, { id: future.id }, accountant)).rejects.toThrow(/future/);
    await issued({ date: "2026-10-24" });
    const early = saveInvoiceDraft(store, draft({ date: "2026-10-20" }), accountant);
    await expect(issueInvoice(store, { id: early.id }, accountant)).rejects.toThrow(/can't be dated before it/);
    expect(inv(early.id).status).toBe("draft");
    expect(nextNo()).toBe(10);
  });

  it("BL-12 locked once issued: no edit, no second issue; only a draft can be changed", async () => {
    const d = saveInvoiceDraft(store, draft(), accountant);
    saveInvoiceDraft(store, draft({ id: d.id, items: [{ ...LINE, qtyMilli: 5000 }] }), accountant);
    expect(inv(d.id).totals!.taxablePaise).toBe(617_280);
    const r = await issueInvoice(store, { id: d.id }, accountant);
    expect(() => saveInvoiceDraft(store, draft({ id: d.id }), accountant)).toThrow(/has been issued, so it can't be changed/);
    await expect(issueInvoice(store, { id: d.id }, accountant)).rejects.toThrow(/already issued/);
    expect(inv(d.id)).toMatchObject({ number: r.number, status: "sent" });
    expect(inv(d.id).totals!.taxablePaise).toBe(617_280);
    expect(invoiceEditRefusal({ status: "draft" })).toBeNull();
    expect(invoiceEditRefusal({ status: "paid" })).toMatch(/credit note/);
    expect(invoiceEditRefusal({ status: "cancelled" })).toMatch(/cancelled/);
    expect(LOCKED_ONCE_ISSUED).toEqual(expect.arrayContaining(["number", "date", "items", "totals", "deductions", "placeOfSupply"]));
  });

  it("BL-13 what is typed is checked in plain words, field by field", () => {
    expect(fieldsOf(() => saveInvoiceDraft(store, draft({ items: [] }), accountant))).toHaveProperty("items");
    expect(fieldsOf(() => saveInvoiceDraft(store, draft({ projectId: "nope" }), accountant))).toHaveProperty("projectId");
    expect(fieldsOf(() => saveInvoiceDraft(store, draft({ clientId: "clAwadh" }), accountant)).projectId).toMatch(/belongs to another client/);
    expect(fieldsOf(() => saveInvoiceDraft(store, draft({ dueDate: "2026-10-01" }), accountant))).toHaveProperty("dueDate");
    expect(fieldsOf(() => saveInvoiceDraft(store, draft({ placeOfSupply: "UP" }), accountant))).toHaveProperty("placeOfSupply");
    expect(fieldsOf(() => saveInvoiceDraft(store, draft({ type: "credit_note" }), accountant))).toHaveProperty("type");
    expect(fieldsOf(() => saveInvoiceDraft(store, draft({ deductions: [{ head: "Retention", rateBp: 10_000 }, { head: "TDS", rateBp: 10_000 }] }), accountant)).deductions).toMatch(/more than the bill/);
    expect(inv(saveInvoiceDraft(store, draft({ placeOfSupply: "07" }), accountant).id).totals).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 55_555 });
  });

  it("BL-14 a proforma is a document only: its own number series, nothing billed (D-24)", async () => {
    const before = billed();
    const p = await issued({ type: "proforma" });
    expect(p.number).toBe(`AG/PF/${FY}/0001`);
    expect(billed()).toEqual(before);
    expect(nextNo()).toBe(9);
    expect(invoiceDuePaise(inv(p.id))).toBe(0);
    await cancelInvoice(store, { id: p.id, reason: "Not needed" }, accountant);
    expect(billed()).toEqual(before);
  });
});

describe("RA bills and deductions on a government project (§8.3)", () => {
  it("BL-15 an RA bill carries forward what was billed before, and the project's deductions lower the cash expected", async () => {
    const ra1 = inv("invRa1"), ra2 = inv("invRa2"), ra3 = inv("invRa3");
    const heads = store.get<{ government: { deductionHeads: { head: string; rateBp: number }[] } }>("projects/projShivNagar/private", "commercial")!.government.deductionHeads;
    saveInvoiceDraft(store, { id: "invRa3", type: "ra", projectId: "projShivNagar", date: ra3.date, items: ra3.items, deductions: heads }, accountant);
    const saved = inv("invRa3");
    expect(saved.ra).toEqual({
      serial: 3,
      previousTaxablePaise: ra1.totals!.taxablePaise + ra2.totals!.taxablePaise, thisTaxablePaise: saved.totals!.taxablePaise,
      toDateTaxablePaise: ra1.totals!.taxablePaise + ra2.totals!.taxablePaise + saved.totals!.taxablePaise,
      previousTotalPaise: ra1.totals!.totalPaise + ra2.totals!.totalPaise, thisTotalPaise: saved.totals!.totalPaise,
      toDateTotalPaise: ra1.totals!.totalPaise + ra2.totals!.totalPaise + saved.totals!.totalPaise,
    });
    expect(saved.totals).toEqual(ra3.totals); // the same lines give the same totals as the base demo
    expect(saved.deductions!.map((d) => d.head)).toEqual(["TDS, income tax", "GST-TDS", "Labour cess", "Retention"]);
    const t = saved.totals!.taxablePaise;
    const rupee = (p: number) => Math.floor((p + 50) / 100) * 100;
    expect(saved.deductions!.map((d) => d.amountPaise)).toEqual([rupee(t * 0.02), rupee(t * 0.02), rupee(t * 0.01), rupee(t * 0.05)]);
    expect(saved.netReceivablePaise).toBe(saved.totals!.totalPaise - saved.deductions!.reduce((s, d) => s + d.amountPaise, 0));
    const r = await issueInvoice(store, { id: "invRa3" }, accountant);
    expect(r.number).toBe(`AG/${FY}/0009`);
    expect(inv("invRa3").ra!.serial).toBe(3);
    expect(r.netReceivablePaise).toBe(saved.netReceivablePaise);
  });

  it("BL-16 carry-forward ignores drafts, cancelled bills and other projects, and takes off credit notes", () => {
    const mk = (id: string, over: Partial<BillingInvoice>): BillingInvoice => ({
      id, number: null, type: "ra", projectId: "p1", clientId: "c", date: "2026-10-01", dueDate: "2026-10-31", monthKey: MONTH, fy: FY, placeOfSupply: "09", items: [],
      totals: { taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000, igstPaise: 0, roundOffPaise: 0, totalPaise: 118_000 }, status: "sent", ...over,
    });
    const all = [
      mk("a", {}), mk("b", { status: "paid" }), mk("draft", { status: "draft" }), mk("gone", { status: "cancelled" }), mk("other", { projectId: "p2" }),
      mk("tax", { type: "tax" }),
      mk("cn", { type: "credit_note", againstInvoiceId: "a", totals: { taxablePaise: 10_000, cgstPaise: 900, sgstPaise: 900, igstPaise: 0, roundOffPaise: 0, totalPaise: 11_800 } }),
    ];
    expect(raCarryForward(all, { id: "new", projectId: "p1", taxablePaise: 50_000, totalPaise: 59_000 })).toEqual({
      serial: 3, previousTaxablePaise: 190_000, thisTaxablePaise: 50_000, toDateTaxablePaise: 240_000, previousTotalPaise: 224_200, thisTotalPaise: 59_000, toDateTotalPaise: 283_200,
    });
    // A bill never counts itself (saving the same draft again).
    expect(raCarryForward(all, { id: "b", projectId: "p1", taxablePaise: 100_000, totalPaise: 118_000 }).serial).toBe(2);
  });
});

describe("cancel, credit note, debit note (D-20, D-24)", () => {
  it("BL-17 cancelling an issued bill takes back exactly what it added", async () => {
    const before = billed();
    const a = await issued();
    expect(billed()).not.toEqual(before);
    await expect(cancelInvoice(store, { id: a.id, reason: " " }, accountant)).rejects.toThrow(/Say why/);
    await cancelInvoice(store, { id: a.id, reason: "Billed twice by mistake" }, owner);
    expect(billed()).toEqual(before);
    expect(invoiceDuePaise(inv(a.id))).toBe(0);
    await expect(cancelInvoice(store, { id: a.id, reason: "again" }, owner)).rejects.toThrow(/already cancelled/);
  });

  it("BL-18 a draft can be set aside without a reason and uses no number; a paid bill can't be cancelled", async () => {
    const d = saveInvoiceDraft(store, draft(), accountant);
    const r = await cancelInvoice(store, { id: d.id }, accountant);
    expect(r).toMatchObject({ number: null, wasIssued: false });
    expect(inv(d.id).status).toBe("cancelled");
    expect(nextNo()).toBe(9);
    expect(inv("invRa1").paidPaise).toBeGreaterThan(0);
    await expect(cancelInvoice(store, { id: "invRa1", reason: "test" }, owner)).rejects.toThrow(/Money has been received/);
    expect(invoiceCancelRefusal({ status: "sent", paidPaise: 0 }, 1)).toMatch(/Cancel the note first/);
  });

  it("BL-19 a credit note lowers what is billed and owed, has its own number, and can't exceed the bill", async () => {
    const a = await issued();
    const afterIssue = billed();
    const credit: BillItem = { description: "Rate difference", qtyMilli: 1000, ratePaise: 100_000, gstRateBp: 1800 }; // ₹1,000 + 18% = ₹1,180
    const cn = await createCreditNote(store, { invoiceId: a.id, date: "2026-10-25", reason: "Rate agreed lower", items: [credit] }, accountant);
    expect(cn).toMatchObject({ number: `CN/${FY}/0001`, totalPaise: 118_000, invoiceDuePaise: 364_200 - 118_000 });
    expect(inv(cn.id)).toMatchObject({ type: "credit_note", status: "sent", againstInvoiceId: a.id, againstInvoiceNumber: a.number, noteReason: "Rate agreed lower", projectId: "projSharma", clientId: "clSharma" });
    const afterNote = billed();
    expect(afterIssue.client - afterNote.client).toBe(118_000);
    expect(afterIssue.co - afterNote.co).toBe(118_000);
    expect(afterIssue.all - afterNote.all).toBe(118_000);
    expect(afterIssue.coGst - afterNote.coGst).toBe(18_000);
    expect(inv(a.id)).toMatchObject({ creditedPaise: 118_000, status: "sent", number: a.number });
    expect(nextNo()).toBe(10); // the invoice series is untouched
    // No more than what is left on the bill.
    const big: BillItem = { ...credit, ratePaise: 300_000 };
    await expect(createCreditNote(store, { invoiceId: a.id, date: "2026-10-25", reason: "Too much", items: [big] }, accountant)).rejects.toThrow(/left to credit/);
    // The bill can't be cancelled while the note stands; cancelling the note puts everything back.
    await expect(cancelInvoice(store, { id: a.id, reason: "test" }, accountant)).rejects.toThrow(/Cancel the note first/);
    await cancelInvoice(store, { id: cn.id, reason: "Entered against the wrong bill" }, accountant);
    expect(billed()).toEqual(afterIssue);
    expect(inv(a.id).creditedPaise).toBe(0);
    expect(inv(cn.id)).toMatchObject({ status: "cancelled", number: `CN/${FY}/0001` });
    const cn2 = await createCreditNote(store, { invoiceId: a.id, date: "2026-10-25", reason: "Full credit", items: [LINE] }, accountant);
    expect(cn2.number).toBe(`CN/${FY}/0002`);
    expect(inv(a.id)).toMatchObject({ creditedPaise: 364_200, status: "paid" }); // nothing is owed any more
    expect(cn2.invoiceDuePaise).toBe(0);
  });

  it("BL-20 a debit note adds to what is billed, with its own number; notes need an issued tax bill and a reason", async () => {
    const a = await issued();
    const afterIssue = billed();
    const extra: BillItem = { description: "Extra depth", qtyMilli: 2000, ratePaise: 50_000, gstRateBp: 1800 };
    const dn = await createDebitNote(store, { invoiceId: a.id, date: "2026-10-25", reason: "Extra depth of footing", items: [extra] }, accountant);
    expect(dn).toMatchObject({ number: `DN/${FY}/0001`, totalPaise: 118_000 });
    expect(billed().client - afterIssue.client).toBe(118_000);
    expect(inv(a.id).debitedPaise).toBe(118_000);
    expect(invoiceDuePaise(inv(dn.id))).toBe(118_000);
    const d = saveInvoiceDraft(store, draft(), accountant);
    await expect(createCreditNote(store, { invoiceId: d.id, date: "2026-10-25", reason: "x y z", items: [extra] }, accountant)).rejects.toThrow(/still a draft/);
    const p = await issued({ type: "proforma" });
    await expect(createCreditNote(store, { invoiceId: p.id, date: "2026-10-25", reason: "x y z", items: [extra] }, accountant)).rejects.toThrow(/only be made against a tax/);
    await expect(createDebitNote(store, { invoiceId: a.id, date: "2026-10-25", reason: "", items: [extra] }, accountant)).rejects.toThrow(CommandError);
    await expect(createDebitNote(store, { invoiceId: a.id, date: "2026-10-01", reason: "Too early", items: [extra] }, accountant)).rejects.toThrow(CommandError);
  });

  it("BL-21 what is owed and the status follow the money", () => {
    const base: Pick<BillingInvoice, "status" | "type" | "totals" | "paidPaise" | "creditedPaise" | "dueDate"> = {
      status: "sent", type: "tax", dueDate: "2026-11-30", paidPaise: 0,
      totals: { taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000, igstPaise: 0, roundOffPaise: 0, totalPaise: 118_000 },
    };
    expect(invoiceDuePaise(base)).toBe(118_000);
    expect(invoiceDuePaise({ ...base, paidPaise: 50_000, creditedPaise: 18_000 })).toBe(50_000);
    expect(invoiceDuePaise({ ...base, status: "draft" })).toBe(0);
    expect(invoiceDuePaise({ ...base, status: "cancelled" })).toBe(0);
    expect(invoiceDuePaise({ ...base, type: "credit_note" })).toBe(0);
    expect(statusFromMoney(base, "2026-11-01")).toBe("sent");
    expect(statusFromMoney({ ...base, paidPaise: 1 }, "2026-11-01")).toBe("partially_paid");
    expect(statusFromMoney({ ...base, paidPaise: 1 }, "2026-12-01")).toBe("overdue");
    expect(statusFromMoney({ ...base, paidPaise: 118_000 }, "2026-12-01")).toBe("paid");
    expect(statusFromMoney({ ...base, status: "draft" }, "2026-12-01")).toBe("draft");
    expect(statusFromMoney({ ...base, status: "cancelled" }, "2026-12-01")).toBe("cancelled");
  });
});

describe("who may bill, and locked months (§2, D-13)", () => {
  it("BL-22 only the owner and the accountant: every command refuses the other roles in plain words", async () => {
    const a = await issued();
    const q = saveQuotation(store, quote(), accountant);
    for (const who of [pm, sup, viewer, ca]) {
      expect(() => saveInvoiceDraft(store, draft(), who)).toThrow(/Your role can't/);
      await expect(issueInvoice(store, { id: a.id }, who)).rejects.toThrow(/Your role can't/);
      await expect(cancelInvoice(store, { id: a.id, reason: "no" }, who)).rejects.toThrow(/Your role can't/);
      await expect(createCreditNote(store, { invoiceId: a.id, date: "2026-10-25", reason: "no", items: [LINE] }, who)).rejects.toThrow(/Your role can't/);
      await expect(createDebitNote(store, { invoiceId: a.id, date: "2026-10-25", reason: "no", items: [LINE] }, who)).rejects.toThrow(/Your role can't/);
      expect(() => saveQuotation(store, quote(), who)).toThrow(/Your role can't/);
      expect(() => sendQuotation(store, { id: q.id }, who)).toThrow(/Your role can't/);
      expect(() => setQuotationStatus(store, { id: q.id, status: "accepted" }, who)).toThrow(/Your role can't/);
      expect(() => convertQuotationToInvoice(store, { id: q.id }, who)).toThrow(/Your role can't/);
    }
    expect(inv(a.id).status).toBe("sent");
    expect(Object.keys(BILLING_COMMANDS).sort()).toEqual([
      "cancelInvoice", "convertQuotationToInvoice", "createCreditNote", "createDebitNote", "issueInvoice", "saveInvoiceDraft", "saveQuotation", "sendQuotation", "setQuotationStatus",
    ]);
  });

  it("BL-23 a locked month refuses issue, cancel and notes, and nothing moves; a draft can still be prepared", async () => {
    const a = await issued({ date: "2026-10-23" });
    const d = saveInvoiceDraft(store, draft(), accountant);
    store.set("period_locks", { id: MONTH, monthKey: MONTH });
    const before = billed();
    await expect(issueInvoice(store, { id: d.id }, accountant)).rejects.toThrow(/Oct 2026 is locked/);
    await expect(cancelInvoice(store, { id: a.id, reason: "Locked month" }, owner)).rejects.toThrow(/locked/);
    await expect(createCreditNote(store, { invoiceId: a.id, date: "2026-10-25", reason: "Locked month", items: [LINE] }, accountant)).rejects.toThrow(/locked/);
    await expect(createDebitNote(store, { invoiceId: a.id, date: "2026-10-25", reason: "Locked month", items: [LINE] }, accountant)).rejects.toThrow(/locked/);
    expect(billed()).toEqual(before);
    expect(inv(d.id)).toMatchObject({ status: "draft", number: null });
    expect(inv(a.id).status).toBe("sent");
    expect(nextNo()).toBe(10);
    expect(nextNo(`credit_note_${FY}`)).toBe(1);
    expect(() => saveInvoiceDraft(store, draft({ id: d.id, notes: "Waiting for the month to open" }), accountant)).not.toThrow();
  });
});

describe("quotations (§8.2, D-17)", () => {
  it("BL-24 a draft has no number; sending numbers it AG/Q/…; numbers run on", () => {
    const a = saveQuotation(store, quote(), accountant);
    expect(qtn(a.id)).toMatchObject({ status: "draft", number: null, version: 1, isLatest: true, rootQuotationId: a.id, clientName: "Rajesh Sharma", projectName: "Sharma Villa, Indira Nagar" });
    expect(qtn(a.id).totals).toEqual({ taxablePaise: 308_640, cgstPaise: 27_778, sgstPaise: 27_778, igstPaise: 0, roundOffPaise: 4, totalPaise: 364_200 });
    expect(qtn(a.id).sections).toEqual([{ title: "Wall", items: [LINE] }]);
    saveQuotation(store, quote({ id: a.id, title: "Boundary wall and gate" }), accountant); // a draft is changed in place
    expect(qtn(a.id)).toMatchObject({ title: "Boundary wall and gate", version: 1 });
    expect(store.list("quotations").length).toBe(1);
    const sent = sendQuotation(store, { id: a.id }, accountant);
    expect(sent).toMatchObject({ number: `AG/Q/${FY}/0001`, label: `AG/Q/${FY}/0001` });
    expect(qtn(a.id)).toMatchObject({ status: "sent", sentBy: "uAccountant" });
    expect(() => sendQuotation(store, { id: a.id }, accountant)).toThrow(/already sent/);
    const b = saveQuotation(store, quote({ clientId: "clAwadh", projectId: null }), owner); // from a client alone, no project yet
    expect(sendQuotation(store, { id: b.id }, owner).number).toBe(`AG/Q/${FY}/0002`);
    expect(fieldsOf(() => saveQuotation(store, quote({ validUntil: "2026-10-01" }), accountant))).toHaveProperty("validUntil");
    expect(fieldsOf(() => saveQuotation(store, quote({ clientId: "nope", projectId: null }), accountant))).toHaveProperty("clientId");
    expect(fieldsOf(() => saveQuotation(store, quote({ items: [] }), accountant))).toHaveProperty("items");
  });

  it("BL-25 a change after sending makes the next version with the same number; the sent one stays read-only", () => {
    const a = saveQuotation(store, quote(), accountant);
    sendQuotation(store, { id: a.id }, accountant);
    const v1 = structuredClone(qtn(a.id));
    const r = saveQuotation(store, quote({ id: a.id, items: [{ ...LINE, ratePaise: 110_000, section: "Wall" }] }), accountant);
    expect(r).toMatchObject({ version: 2, revised: true });
    expect(r.id).not.toBe(a.id);
    expect(qtn(r.id)).toMatchObject({ status: "draft", number: v1.number, version: 2, rootQuotationId: a.id, isLatest: true });
    expect(qtn(a.id)).toMatchObject({ status: "sent", isLatest: false, supersededBy: r.id, totals: v1.totals, sections: v1.sections });
    expect(() => saveQuotation(store, quote({ id: a.id }), accountant)).toThrow(/newer version/);
    expect(() => setQuotationStatus(store, { id: a.id, status: "accepted" }, accountant)).toThrow(/newer version/);
    const sent = sendQuotation(store, { id: r.id }, accountant);
    expect(sent).toMatchObject({ number: `AG/Q/${FY}/0001`, version: 2, label: `AG/Q/${FY}/0001 (Rev 2)` });
    expect(store.get<{ next: number }>("counters", `quotation_${FY}`)!.next).toBe(2); // version 2 took no new number
    expect(store.list<Quotation>("quotations", (q) => q.rootQuotationId === a.id).map((q) => q.version).sort()).toEqual([1, 2]);
  });

  it("BL-26 status: accepted, rejected, expired; a draft must be sent first; accepted is final", () => {
    const a = saveQuotation(store, quote(), accountant);
    expect(() => setQuotationStatus(store, { id: a.id, status: "accepted" }, accountant)).toThrow(/Send the quotation first/);
    sendQuotation(store, { id: a.id }, accountant);
    expect(() => setQuotationStatus(store, { id: a.id, status: "draft" }, accountant)).toThrow(/Choose accepted, rejected or expired/);
    expect(quotationShownStatus(qtn(a.id), "2026-11-19")).toBe("sent");
    expect(quotationShownStatus(qtn(a.id), "2026-11-20")).toBe("expired"); // past its validity date
    setQuotationStatus(store, { id: a.id, status: "rejected", note: "Too high" }, accountant);
    expect(qtn(a.id)).toMatchObject({ status: "rejected", statusNote: "Too high", decidedBy: "uAccountant" });
    setQuotationStatus(store, { id: a.id, status: "expired" }, accountant);
    setQuotationStatus(store, { id: a.id, status: "accepted" }, owner);
    expect(() => setQuotationStatus(store, { id: a.id, status: "rejected" }, owner)).toThrow(/already accepted/);
    expect(() => saveQuotation(store, quote({ id: a.id }), owner)).toThrow(/was accepted, so it can't be changed/);
  });

  it("BL-27 an accepted quotation becomes a draft bill with the same lines and total", async () => {
    const two: BillItem[] = [{ ...LINE, section: "Wall" }, { description: "MS gate", unit: "nos", qtyMilli: 1000, ratePaise: 6_800_000, gstRateBp: 1800, section: "Gate" }];
    const a = saveQuotation(store, quote({ items: two }), accountant);
    sendQuotation(store, { id: a.id }, accountant);
    expect(() => convertQuotationToInvoice(store, { id: a.id }, accountant)).toThrow(/accepted first/);
    setQuotationStatus(store, { id: a.id, status: "accepted" }, accountant);
    const before = billed();
    const made = convertQuotationToInvoice(store, { id: a.id }, accountant);
    const bill = inv(made.invoiceId);
    expect(bill).toMatchObject({ status: "draft", number: null, type: "tax", projectId: "projSharma", clientId: "clSharma", quotationId: a.id, date: ANCHOR, notes: `As per quotation AG/Q/${FY}/0001` });
    expect(bill.items).toEqual(two);
    expect(bill.totals).toEqual(qtn(a.id).totals);
    expect(qtn(a.id).invoiceIds).toEqual([made.invoiceId]);
    expect(billed()).toEqual(before); // a draft counts nowhere
    const r = await issueInvoice(store, { id: made.invoiceId }, accountant);
    expect(r.number).toBe(`AG/${FY}/0009`);
    // With no project on the quotation, the project must be chosen.
    const b = saveQuotation(store, quote({ projectId: null }), accountant);
    sendQuotation(store, { id: b.id }, accountant);
    setQuotationStatus(store, { id: b.id, status: "accepted" }, accountant);
    expect(fieldsOf(() => convertQuotationToInvoice(store, { id: b.id }, accountant))).toHaveProperty("projectId");
    expect(inv(convertQuotationToInvoice(store, { id: b.id, projectId: "projSharma", type: "proforma" }, accountant).invoiceId).type).toBe("proforma");
  });
});

describe("server and demo", () => {
  it("BL-28 issuing works on the server's loading store (it asks only for what it reads) and gives the same number", async () => {
    const { id } = saveInvoiceDraft(store, draft({ type: "ra", projectId: "projShivNagar" }), accountant);
    const loaded = new Loaded();
    const seed = new Uint32Array([1, 2, 3, 4]);
    let result: Awaited<ReturnType<typeof issueInvoice>> | null = null;
    let runs = 0;
    let final: LoadingStore | null = null;
    for (; runs < 12 && !result; runs++) {
      const ls = new LoadingStore(loaded);
      let out: Awaited<ReturnType<typeof issueInvoice>> | null = null;
      try { out = await withIdSource(seededIds(seed), () => issueInvoice(ls, { id }, accountant)); } catch { /* a run on missing data is thrown away */ }
      if (ls.missedAnything) {
        for (const p of ls.missingDocs) { const i = p.lastIndexOf("/"); loaded.addDoc(p.slice(0, i), p.slice(i + 1), store.get(p.slice(0, i), p.slice(i + 1))); }
        for (const need of ls.missingLists.values()) loaded.addList(need, store.list(need.collection, undefined, need.hint));
        continue;
      }
      result = out;
      final = ls;
    }
    expect(result).toMatchObject({ number: `AG/${FY}/0009` });
    expect(runs).toBeLessThan(8);
    expect(final!.get<BillingInvoice>("invoices", id)).toMatchObject({ status: "sent", number: `AG/${FY}/0009` });
    expect(final!.get<BillingInvoice>("invoices", id)!.ra!.serial).toBe(3);
    // It never asked for the whole invoices collection: only this project's.
    expect(loaded.lists.has("invoices")).toBe(false);
  });

  it("BL-29 the demo adds quotations in different states and no bills", async () => {
    const invoicesBefore = store.list("invoices").length;
    const before = JSON.stringify([store.snapshot().finance_rollups, store.snapshot().client_balances]);
    await seedBilling({ store, anchor: ANCHOR, nowIso: NOW, ownerUid: "uOwner" });
    const all = store.list<Quotation>("quotations").sort((a, b) => a.id.localeCompare(b.id));
    expect(all.map((q) => [q.id, q.status, q.version, q.isLatest])).toEqual([
      ["qtnDemo01", "draft", 1, true], ["qtnDemo02", "sent", 1, true], ["qtnDemo03", "accepted", 1, true], ["qtnDemo04", "rejected", 1, false], ["qtnDemo05", "sent", 2, true],
    ]);
    expect(all.map((q) => q.number)).toEqual([null, `AG/Q/${FY}/0001`, `AG/Q/${FY}/0002`, `AG/Q/${FY}/0003`, `AG/Q/${FY}/0003`]);
    expect(all.every((q) => q.totals.totalPaise > 0 && q.totals.totalPaise % 100 === 0)).toBe(true);
    expect(store.list("invoices").length).toBe(invoicesBefore);
    expect(JSON.stringify([store.snapshot().finance_rollups, store.snapshot().client_balances])).toBe(before);
  });
});
