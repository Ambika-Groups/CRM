// Printable documents and sharing (spec §8.4, §8.5; §3.1 rule 14 as changed by SPARK-PLAN: the browser makes the page).
// IDs DOC-xx are cited in docs/prd-traceability.md.
import { beforeAll, describe, expect, it } from "vitest";
import {
  amountInWords, formatINR, seedDemo,
  type Client, type CommandCtx, type Invoice, type MemoryStore, type PaymentReceived, type PrintDocSpec,
} from "../src";
import { DOCUMENT_COMMANDS, logShare, saveShareTemplates } from "../src/commands/documents";
import {
  DEFAULT_ACCENT, DEFAULT_SHARE_TEMPLATES, DOCUMENT_CSS, SHARE_LOG_COLLECTION, documentBodyHtml, documentHtml, fillTemplate, invoiceDocument, printSpecDocument,
  quotationDocument, receiptDocument, shareMessage, shareTemplatesFrom, validateShareTemplates, whatsappLink,
  type BankInfo, type CompanyInfo, type ShareLogRecord,
} from "../src/documents";

const ANCHOR = "2026-10-25";
const NOW = "2026-10-25T09:00:00.000Z";
const ctx = (uid: string, role: CommandCtx["role"], projectIds: string[] = []): CommandCtx => ({ uid, role, projectIds, nowIso: NOW });
const owner = ctx("uOwner", "owner"), accountant = ctx("uAccountant", "accountant"), ca = ctx("uCa", "ca");
const pm = ctx("uPm", "pm", ["projShivNagar", "projSharma"]), viewer = ctx("uViewer", "viewer");

const COMPANY: CompanyInfo = {
  legalName: "Ambika Groups", address: "12 Station Road, Lucknow 226001", stateCode: "09", gstin: "09AAACA0000A1Z5", phone: "+919839012345",
  email: "office@example.in", brandColor: "#C62828",
};
const BANK: BankInfo = { bankName: "State Bank of India", accountName: "Ambika Groups", accountNo: "00000012345", ifsc: "SBIN0000001", upiId: "ambika@sbi" };

let store: MemoryStore;
beforeAll(async () => { ({ store } = await seedDemo(ANCHOR)); });
const inv = (id: string) => store.get<Invoice>("invoices", id)!;
const client = (id: string) => store.get<Client>("clients", id)!;
const rs = (p: number) => formatINR(p, { paise: true });
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("document models (§8.4)", () => {
  it("DOC-01 an invoice page carries the letterhead, the client, the number and the stored totals", () => {
    const i = inv("invShBrickwork");
    const m = invoiceDocument(i, COMPANY, client(i.clientId), { bank: BANK, amountInWords: amountInWords(i.totals!.totalPaise), terms: ["Pay within 30 days."] });
    expect(m.kind).toBe("invoice");
    expect(m.title).toBe("Tax invoice");
    expect(m.number).toBe(i.number);
    expect(m.letterhead).toMatchObject({ name: "Ambika Groups", accent: "#C62828" });
    expect(m.letterhead.lines).toEqual(["12 Station Road, Lucknow 226001", "GSTIN: 09AAACA0000A1Z5", "Phone: 98390 12345 · Email: office@example.in"]);
    expect(m.meta.map((x) => x.label)).toEqual(["Number", "Date", "Due date", "Place of supply"]);
    expect(m.meta[3]!.value).toBe("Uttar Pradesh (09)");
    expect(m.parties[0]).toMatchObject({ heading: "Billed to", name: "Rajesh Sharma" });
    expect(m.parties[1]).toMatchObject({ heading: "Project / Site", name: i.projectName });
    expect(m.figures).toEqual({ ...pickTotals(i), netPaise: i.netReceivablePaise });
    expect(m.totals.find((t) => t.label === "Grand total")).toEqual({ label: "Grand total", value: rs(i.totals!.totalPaise), strong: true });
    expect(m.totals.find((t) => t.label === "CGST")!.value).toBe(rs(i.totals!.cgstPaise));
    expect(m.items!.rows).toHaveLength(i.items.length);
    expect(m.items!.columns.map((c) => c.label)).toEqual(["No.", "Description", "HSN/SAC", "Qty", "Unit", "Rate", "GST", "Amount"]);
    expect(m.amountInWords!.text).toMatch(/^Rupees .* Only$/);
    expect(m.bank!.rows.map((r) => r.label)).toEqual(["Bank", "Account name", "Account number", "IFSC", "UPI ID"]);
    expect(m.terms!.lines).toEqual(["Pay within 30 days."]);
    expect(m.signatures[0]).toMatchObject({ heading: "For Ambika Groups", caption: "Authorised signatory" });
    expect(m.watermark).toBeNull();
  });

  it("DOC-02 the GST summary by rate adds up to the invoice's own tax, for every demo invoice", () => {
    for (const i of store.list<Invoice>("invoices")) {
      const m = invoiceDocument(i, COMPANY, client(i.clientId));
      const t = i.totals!;
      const foot = m.taxSummary!.table.foot!;
      expect(foot, i.id).toEqual(["Total", rs(t.taxablePaise), rs(t.cgstPaise), rs(t.sgstPaise), rs(t.cgstPaise + t.sgstPaise)]);
      // One rate in the demo: its row is the whole invoice.
      expect(m.taxSummary!.table.rows, i.id).toEqual([["18%", rs(t.taxablePaise), rs(t.cgstPaise), rs(t.sgstPaise), rs(t.cgstPaise + t.sgstPaise)]]);
      expect(m.figures!.totalPaise, i.id).toBe(t.totalPaise);
    }
  });

  it("DOC-03 deductions, money received and the balance follow the record; a draft and a paid bill are marked", () => {
    const ra = inv("invRa2");
    const m = invoiceDocument(ra, COMPANY, client(ra.clientId));
    expect(m.title).toBe("Running bill");
    for (const d of ra.deductions!) expect(m.totals.some((t) => t.label.startsWith(`Less: ${d.head}`) && t.value === rs(-d.amountPaise))).toBe(true);
    expect(m.totals.find((t) => t.label === "Net receivable")!.value).toBe(rs(ra.netReceivablePaise!));
    expect(ra.paidPaise).toBeGreaterThan(0);
    expect(m.totals.find((t) => t.label === "Balance due")!.value).toBe(rs(ra.netReceivablePaise! - ra.paidPaise!));
    expect(m.parties[0]!.lines).toContain("GSTIN: 09AAALN0001C1ZV");
    expect(m.parties[0]!.lines).toContain("Phone: 0522 2000000");

    const draft = invoiceDocument(inv("invRa3"), COMPANY, null);
    expect(draft).toMatchObject({ number: null, watermark: "DRAFT" });
    expect(draft.meta[0]).toEqual({ label: "Number", value: "Draft, no number yet" });
    expect(draft.parties[0]!.name).toBe("Nagar Nigam Lucknow"); // the name kept on the invoice when the client can't be read
    expect(invoiceDocument(inv("invShBooking"), COMPANY, null).watermark).toBe("PAID");
  });

  it("DOC-04 an inter-state invoice shows IGST; a discount adds its column; settings placeholders are not printed", () => {
    const base = inv("invShBrickwork");
    const other: Invoice = { ...base, placeOfSupply: "07", totals: undefined, items: [{ description: "Design fee", qtyMilli: 2000, ratePaise: 500_000, discountBp: 1000, gstRateBp: 1800 }, { description: "Site visit", qtyMilli: 1000, ratePaise: 100_000, gstRateBp: 500 }] };
    const m = invoiceDocument(other, COMPANY, null);
    expect(m.figures).toMatchObject({ taxablePaise: 1_000_000, igstPaise: 167_000, cgstPaise: 0, totalPaise: 1_167_000 });
    expect(m.taxSummary!.table.columns.map((c) => c.label)).toEqual(["GST rate", "Taxable value", "IGST", "Total GST"]);
    expect(m.taxSummary!.table.rows).toEqual([["5%", "₹1,000.00", "₹50.00", "₹50.00"], ["18%", "₹9,000.00", "₹1,620.00", "₹1,620.00"]]);
    expect(m.items!.columns.map((c) => c.label)).toContain("Discount");
    expect(m.items!.rows[0]).toEqual(["1", "Design fee", "", "2", "", "₹5,000.00", "10%", "18%", "₹9,000.00"]);

    const seeded = store.get<CompanyInfo>("settings", "company")!;
    const bank = store.get<{ accounts: BankInfo[] }>("settings", "bank")!.accounts[0]!;
    const demo = invoiceDocument(base, seeded, null, { bank });
    expect(demo.letterhead.name).toBe("Ambika Groups");
    expect(demo.letterhead.lines).toEqual(["Lucknow, Uttar Pradesh"]);
    expect(JSON.stringify(demo)).not.toContain("to be confirmed");
    expect(demo.bank).toBeNull(); // only the account name is real: no bank block
    expect(invoiceDocument(base, null, null).letterhead).toMatchObject({ name: "Ambika Groups", accent: DEFAULT_ACCENT });
    expect(invoiceDocument(base, { brandColor: "red;}body{display:none" }, null).letterhead.accent).toBe(DEFAULT_ACCENT);
  });

  it("DOC-05 a receipt and a quotation", () => {
    const r = store.list<PaymentReceived>("payments_received").find((x) => x.invoiceId === "invRa1")!;
    const m = receiptDocument(r, COMPANY, client(r.clientId), { invoiceNumber: inv("invRa1").number });
    expect(m).toMatchObject({ kind: "receipt", title: "Payment receipt", number: r.receiptNo, items: null, taxSummary: null });
    expect(m.totals[0]).toEqual({ label: "Amount received", value: rs(r.amountPaise), strong: false });
    expect(m.totals.at(-1)).toEqual({ label: "Total settled", value: rs(r.amountPaise + r.tdsPaise! + r.retentionPaise! + r.otherDeductionsPaise!), strong: true });
    expect(m.blocks[0]).toMatchObject({ kind: "pairs", heading: "Payment details" });
    expect((m.blocks[0] as { rows: { label: string; value: string }[] }).rows).toEqual([
      { label: "Paid by", value: "Bank transfer" }, { label: "Reference", value: r.reference }, { label: "Against invoice", value: inv("invRa1").number },
    ]);

    const q = quotationDocument({ number: "AG/Q/2026-27/0001", date: "2026-10-20", validUntil: "2026-11-19", subject: "Boundary wall", projectName: "Sharma house", siteAddress: "Indira Nagar", placeOfSupply: "09", items: [{ description: "Brick wall", unit: "sqm", qtyMilli: 42_500, ratePaise: 120_000, gstRateBp: 1800 }] }, COMPANY, client("clSharma"));
    expect(q).toMatchObject({ kind: "quotation", title: "Quotation", subtitle: "Boundary wall", number: "AG/Q/2026-27/0001" });
    expect(q.meta.map((x) => x.value)).toEqual(["AG/Q/2026-27/0001", "20 Oct 2026", "19 Nov 2026"]);
    expect(q.figures).toMatchObject({ taxablePaise: 5_100_000, cgstPaise: 459_000, sgstPaise: 459_000, totalPaise: 6_018_000 });
    expect(q.parties.map((p) => p.heading)).toEqual(["Quotation for", "Project / Site"]);
    expect(q.shareValues).toMatchObject({ clientName: "Rajesh Sharma", documentNumber: "AG/Q/2026-27/0001", amount: "₹60,180", dueDate: "19 Nov 2026" });
    // Without the client record, the page uses what the quotation itself kept.
    const kept = quotationDocument({ number: null, date: "2026-10-20", clientName: "Asha Verma", clientGstin: "09AAACA1234B1ZG", clientAddress: "Aliganj, Lucknow", items: [] }, COMPANY, null);
    expect(kept.parties[0]).toEqual({ heading: "Quotation for", name: "Asha Verma", lines: ["Aliganj, Lucknow", "GSTIN: 09AAACA1234B1ZG"] });
  });

  it("DOC-06 Hindi labels with Western digits", () => {
    const i = inv("invShBrickwork");
    const m = invoiceDocument(i, COMPANY, client(i.clientId), { lang: "hi" });
    expect(m.title).toBe("टैक्स इनवॉइस");
    expect(m.parties[0]!.heading).toBe("बिल किसके नाम");
    expect(m.totals.find((t) => t.strong)!).toEqual({ label: "कुल रकम", value: rs(i.totals!.totalPaise), strong: true });
    expect(m.meta[1]!.value).toMatch(/^\d{1,2} \S+ 2026$/);
    expect(JSON.stringify(m)).not.toMatch(/[०-९]/);
  });

  it("DOC-07 a simple print spec gets the same letterhead", () => {
    const spec: PrintDocSpec = {
      title: "Stock statement", subtitle: "October 2026", meta: [{ label: "Site", value: "Shiv Nagar" }],
      sections: [
        { kind: "text", heading: "Note", paragraphs: ["Counted on site."] },
        { kind: "pairs", rows: [{ label: "Items", value: "2" }] },
        { kind: "table", heading: "Stock", head: ["Item", "Qty"], rows: [["Cement", "120"], ["Steel", "4.5"]], align: ["left", "right"] },
      ],
      footerNote: "Made from the stock register.",
    };
    const m = printSpecDocument(spec, COMPANY);
    expect(m).toMatchObject({ kind: "generic", title: "Stock statement", subtitle: "October 2026", meta: spec.meta, footer: ["Made from the stock register."] });
    expect(m.letterhead.name).toBe("Ambika Groups");
    expect(m.blocks[2]).toEqual({ kind: "table", heading: "Stock", table: { columns: [{ label: "Item", align: "left" }, { label: "Qty", align: "right" }], rows: spec.sections[2]!.kind === "table" ? spec.sections[2]!.rows : [] } });
    const html = documentHtml(m);
    for (const s of ["Ambika Groups", "GSTIN: 09AAACA0000A1Z5", "Stock statement", "Counted on site.", "Cement", "Made from the stock register."]) expect(html).toContain(s);
    expect(html).toContain('<td class="r">120</td>');
    expect(printSpecDocument(spec).letterhead.name).toBe("Ambika Groups"); // no company given: the name alone
  });
});

describe("the printed page (§8.4)", () => {
  it("DOC-08 the page holds the number, the client, the GST summary and totals equal to the invoice", () => {
    const i = inv("invRa1");
    const m = invoiceDocument(i, COMPANY, client(i.clientId), { bank: BANK, amountInWords: amountInWords(i.netReceivablePaise!) });
    const body = documentBodyHtml(m);
    const t = text(body);
    for (const s of [i.number!, "Nagar Nigam Lucknow", "GST summary", "Bank details", "SBIN0000001", "Authorised signatory", "Thank you for your business."]) expect(t).toContain(s);
    for (const p of [i.totals!.taxablePaise, i.totals!.cgstPaise, i.totals!.sgstPaise, i.totals!.totalPaise, i.netReceivablePaise!]) expect(t).toContain(rs(p));
    expect(body).toContain("data-doc-items");
    expect(body).toContain("data-doc-tax");
    expect(body).toContain("data-doc-totals");
    expect(body).toContain('style="--doc-accent:#C62828"');
    expect(body).toContain('data-mark="PAID"');
    const page = documentHtml(m);
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain("@page{size:A4;");
    expect(page).toContain(`<title>Running bill ${i.number}</title>`);
    expect(page).not.toMatch(/<script|<link|@import|url\(/); // self-contained: nothing is fetched
    expect(DOCUMENT_CSS).toContain("break-inside:avoid"); // rows are not split across pages
    expect(DOCUMENT_CSS).toContain("background:#fff"); // always white paper
  });

  it("DOC-09 everything typed by a person is escaped, and only safe picture addresses are used", () => {
    const i: Invoice = { ...inv("invShBrickwork"), clientName: '<img src=x onerror="alert(1)">', items: [{ description: "<script>alert(1)</script> & tiles", qtyMilli: 1000, ratePaise: 100, gstRateBp: 0 }], totals: undefined };
    const html = documentBodyHtml(invoiceDocument(i, { ...COMPANY, logoUrl: "javascript:alert(1)", signatureUrl: "data:image/png;base64,AAAA" }, null, { notes: "a < b" }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; tiles");
    expect(html).toContain("a &lt; b");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="">');
  });
});

describe("share messages and the WhatsApp link (§8.5)", () => {
  it("DOC-10 a template is filled; lines with nothing to say are left out", () => {
    const i = inv("invShBrickwork");
    const m = invoiceDocument(i, COMPANY, client(i.clientId));
    const msg = shareMessage("invoice", "en", m.shareValues);
    expect(msg).toBe(`Namaste Rajesh Sharma,\nBill ${i.number} from Ambika Groups is ready. Amount: ${formatINR(i.totals!.totalPaise)}\nPlease pay by ${m.meta[2]!.value}.\nThank you.`);
    expect(shareMessage("invoice", "en", { ...m.shareValues, link: "https://example.in/d/abc" })).toContain("\nhttps://example.in/d/abc\nThank you.");
    expect(shareMessage("invoice", "en", { ...m.shareValues, dueDate: "", clientName: null })).toBe(`Bill ${i.number} from Ambika Groups is ready. Amount: ${formatINR(i.totals!.totalPaise)}\nThank you.`);
    expect(fillTemplate("Hi {clientName} {nickname}", { clientName: "Asha" })).toBe("Hi Asha {nickname}");
  });

  it("DOC-11 Hindi messages, and saved templates over the defaults", () => {
    const i = inv("invShBrickwork");
    const hi = invoiceDocument(i, COMPANY, client(i.clientId), { lang: "hi" });
    const msg = shareMessage("invoice", "hi", hi.shareValues);
    expect(msg.startsWith("नमस्ते Rajesh Sharma,")).toBe(true);
    expect(msg).toContain(`बिल ${i.number}`);
    expect(msg).not.toMatch(/[०-९{}]/);
    const saved = shareTemplatesFrom({ share: { invoice: { en: "Dear {clientName}, bill {documentNumber}: {amount}", hi: "  " }, other: { en: "x" } } });
    expect(saved.invoice.en).toBe("Dear {clientName}, bill {documentNumber}: {amount}");
    expect(saved.invoice.hi).toBe(DEFAULT_SHARE_TEMPLATES.invoice.hi);
    expect(saved.receipt).toEqual(DEFAULT_SHARE_TEMPLATES.receipt);
    expect(shareTemplatesFrom(null)).toEqual(DEFAULT_SHARE_TEMPLATES);
    expect(shareMessage("invoice", "en", hi.shareValues, saved)).toBe(`Dear Rajesh Sharma, bill ${i.number}: ${formatINR(i.totals!.totalPaise)}`);
    expect(validateShareTemplates(DEFAULT_SHARE_TEMPLATES)).toEqual({});
  });

  it("DOC-12 the WhatsApp link has the Indian number and the whole message", () => {
    const text = "Namaste Rajesh,\nBill AG/2026-27/0007: ₹8,58,450 & thanks";
    for (const typed of ["+919415000020", "9415000020", "094150 00020", "91 94150-00020"]) {
      const u = new URL(whatsappLink(typed, text));
      expect(u.origin + u.pathname, typed).toBe("https://wa.me/919415000020");
      expect(u.searchParams.get("text"), typed).toBe(text);
    }
    expect(whatsappLink("+915222000000", "hi")).toBe("https://wa.me/?text=hi"); // a landline: WhatsApp asks who to send it to
    expect(whatsappLink(null, "hi")).toBe("https://wa.me/?text=hi");
  });
});

describe("share log and templates commands (§8.5)", () => {
  const logs = () => store.list<ShareLogRecord>(SHARE_LOG_COLLECTION);

  it("DOC-13 a share is logged: who, which document, which number, how and when", () => {
    const before = logs().length;
    const { id } = logShare(store, { collection: "invoices", id: "invShBrickwork", channel: "whatsapp", phone: "94150 00020" }, accountant);
    expect(store.get<ShareLogRecord>(SHARE_LOG_COLLECTION, id)).toEqual({
      id, documentType: "invoices", documentId: "invShBrickwork", documentNumber: inv("invShBrickwork").number, projectId: "projSharma",
      channel: "whatsapp", phone: "+919415000020", sentBy: "uAccountant", sentByName: "Priya Srivastava", sentAt: NOW,
    });
    // The CA may read invoices, so may log; the phone's share sheet gives no number.
    const second = DOCUMENT_COMMANDS.logShare(store, { collection: "invoices", id: "invShBrickwork", channel: "web_share" }, ca);
    expect(store.get<ShareLogRecord>(SHARE_LOG_COLLECTION, second.id)).toMatchObject({ channel: "web_share", phone: "", sentBy: "uCa" });
    const receipt = store.list<PaymentReceived>("payments_received")[0]!;
    const third = logShare(store, { collection: "payments_received", id: receipt.id, channel: "print" }, owner);
    expect(store.get<ShareLogRecord>(SHARE_LOG_COLLECTION, third.id)).toMatchObject({ documentType: "payments_received", documentNumber: receipt.receiptNo, channel: "print" });
    expect(logs()).toHaveLength(before + 3);
  });

  it("DOC-14 a role that can't read the document can't log a share; bad input is refused in plain words", () => {
    const before = logs().length;
    const call = (c: CommandCtx, input: Record<string, unknown> = {}) => () => logShare(store, { collection: "invoices", id: "invShBrickwork", channel: "whatsapp", ...input } as never, c);
    expect(call(pm)).toThrow("You can't open this document, so you can't share it.");
    expect(call(viewer)).toThrow("You can't open this document");
    expect(call(owner, { id: "nope" })).toThrow("You can't open this document");
    expect(call(owner, { channel: "pigeon" })).toThrow("Choose how it was shared.");
    expect(call(owner, { phone: "12345" })).toThrow("Enter a 10-digit mobile number.");
    expect(call(owner, { collection: SHARE_LOG_COLLECTION })).toThrow("Choose the document that was shared.");
    expect(logs()).toHaveLength(before);
    // A project manager may log a share of a record they can read (an expense of their own project).
    const expense = store.list<{ id: string; projectId: string }>("expenses").find((e) => e.projectId === "projShivNagar")!;
    expect(logShare(store, { collection: "expenses", id: expense.id, channel: "whatsapp" }, pm).id).toBeTruthy();
  });

  it("DOC-15 the owner and the accountant save the messages; others can't; wrong messages are refused", () => {
    const mine = { ...DEFAULT_SHARE_TEMPLATES, invoice: { en: "  Dear {clientName}, bill {documentNumber} for {amount}.  ", hi: "नमस्ते {clientName}, बिल {documentNumber}, रकम {amount}" } };
    for (const c of [pm, viewer, ca]) expect(() => saveShareTemplates(store, { templates: mine }, c)).toThrow("Your role can't change the share messages.");
    expect(store.get("settings", "templates")).toBeNull();
    DOCUMENT_COMMANDS.saveShareTemplates(store, { templates: mine }, accountant);
    const saved = store.get<{ share: typeof mine; updatedBy: string }>("settings", "templates")!;
    expect(saved.updatedBy).toBe("uAccountant");
    expect(saved.share.invoice.en).toBe("Dear {clientName}, bill {documentNumber} for {amount}.");
    expect(shareTemplatesFrom(saved).invoice.hi).toBe(mine.invoice.hi);
    expect(shareTemplatesFrom(saved).quotation).toEqual(DEFAULT_SHARE_TEMPLATES.quotation);

    const bad = { ...DEFAULT_SHARE_TEMPLATES, receipt: { en: "", hi: "रसीद {number}" }, generic: { en: "x".repeat(1001), hi: "ठीक" } };
    let fields: Record<string, string> = {};
    try { saveShareTemplates(store, { templates: bad }, owner); } catch (e) { fields = (e as { fields: Record<string, string> }).fields; }
    expect(Object.keys(fields).sort()).toEqual(["generic.en", "receipt.en", "receipt.hi"]);
    expect(fields["receipt.en"]).toBe("Write the message.");
    expect(fields["receipt.hi"]).toContain("{number} is not one of the words");
    expect(store.get<{ share: typeof mine }>("settings", "templates")!.share.receipt).toEqual(DEFAULT_SHARE_TEMPLATES.receipt);
  });
});

function pickTotals(i: Invoice) {
  const t = i.totals!;
  return { taxablePaise: t.taxablePaise, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise, totalPaise: t.totalPaise };
}
