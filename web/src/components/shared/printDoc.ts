// A simple printable document (NIGHT-BUILD-GUIDE section 5): any `PrintDocSpec` on the company letterhead, in the same
// layout as invoices and receipts (core documents.ts: one renderer, one stylesheet). The page is a self-contained HTML
// document written into a new window, so it works from any screen; the browser's "Save as PDF" makes the file.
import { documentHtml, printSpecDocument, type CompanyInfo, type PrintDocSpec } from "@ag/core";

// The letterhead comes from Settings (company). A screen that has read it can pass it, or set it once for every later
// call; with neither, the page carries the company name alone.
let letterhead: CompanyInfo | null = null;

/** Remember the company details for every later openPrintDoc / printDocHtml call (pass null to forget them). */
export function setPrintCompany(company: CompanyInfo | null): void {
  letterhead = company;
}

/** The printable HTML of a document spec: A4, the letterhead, light-lined tables that don't split mid-row. */
export function printDocHtml(d: PrintDocSpec, company: CompanyInfo | null = letterhead): string {
  return documentHtml(printSpecDocument(d, company, { lang: typeof document !== "undefined" && document.documentElement.lang === "hi" ? "hi" : "en" }));
}

/** Open the document in a print window and ask to print it (choose "Save as PDF" there to keep a file). */
export function openPrintDoc(d: PrintDocSpec, company: CompanyInfo | null = letterhead): void {
  const w = window.open("", "_blank", "noopener=no,width=900,height=1000");
  if (!w) return;
  w.document.open();
  w.document.write(printDocHtml(d, company));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
