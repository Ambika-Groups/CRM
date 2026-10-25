/**
 * Gapless document numbering (decisions D-12). Numbers are allocated from a counter per document type
 * and financial year inside the transaction that writes the document. GST documents (invoices, credit
 * and debit notes, receipt vouchers) must be at most 16 characters of letters, digits, "-" and "/".
 */

export type DocType =
  | "invoice" | "credit_note" | "debit_note" | "advance_receipt"
  | "proforma" | "receipt" | "quotation" | "agreement" | "project" | "voucher";

export const DEFAULT_FORMATS: Record<DocType, string> = {
  invoice: "AG/{fy}/{seq4}",
  credit_note: "CN/{fy}/{seq4}",
  debit_note: "DN/{fy}/{seq4}",
  advance_receipt: "RV/{fy}/{seq4}",
  proforma: "AG/PF/{fy}/{seq4}",
  receipt: "AG/R/{fy}/{seq4}",
  quotation: "AG/Q/{fy}/{seq4}",
  agreement: "AG/C/{fy}/{seq4}",
  project: "AG-P-{seq4}",
  voucher: "V/{fy}/{seq5}",
};

/** Document types that are GST documents under CGST Rules 46(b), 50 and 53. */
export const GST_DOC_TYPES: ReadonlySet<DocType> = new Set<DocType>(["invoice", "credit_note", "debit_note", "advance_receipt"]);

/** Sequences that restart each financial year. Project codes run across years. */
export function isPerFy(docType: DocType): boolean {
  return docType !== "project";
}

/** Counter document ID: `invoice_2026-27`, or `project`. */
export function counterId(docType: DocType, fy: string): string {
  return isPerFy(docType) ? `${docType}_${fy}` : docType;
}

const GST_SERIAL_RE = /^[A-Za-z0-9/-]{1,16}$/;

export function isValidGstSerial(s: string): boolean {
  return GST_SERIAL_RE.test(s);
}

/** Format a sequence number. Throws if a GST document number would break the 16-character rule. */
export function formatDocNumber(docType: DocType, fy: string, seq: number, format = DEFAULT_FORMATS[docType]): string {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError("Sequence must be a positive integer");
  const out = format
    .replace("{fy}", fy)
    .replace(/\{seq(\d)\}/, (_m, w: string) => String(seq).padStart(Number(w), "0"));
  if (GST_DOC_TYPES.has(docType) && !isValidGstSerial(out)) {
    throw new RangeError(`GST document number "${out}" must be at most 16 characters of letters, digits, - and /`);
  }
  return out;
}

/** Quotation display with revision: version 1 has no suffix (D-17). */
export function quotationLabel(number: string, version: number): string {
  return version > 1 ? `${number} (Rev ${version})` : number;
}

/**
 * Allocate the next number from a counter value inside a transaction. Returns the formatted number and
 * the counter's new `next` value. Pure: the caller reads and writes the counter atomically.
 */
export function allocate(docType: DocType, fy: string, counterNext: number | undefined, format?: string): { number: string; next: number; seq: number } {
  const seq = counterNext ?? 1;
  return { number: formatDocNumber(docType, fy, seq, format), next: seq + 1, seq };
}
