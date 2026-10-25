/**
 * GST and invoice totals (decisions D-15): tax is computed per line, half-up to the paisa, and totals
 * are the sum of the lines. The grand total is rounded to the rupee with an explicit round-off.
 * Deductions (TDS, GST-TDS, retention, labour cess) are rounded half-up to the rupee.
 */
import { mulDivRound, mulMulDivRound, roundToRupee, type Paise } from "./money";

export interface LineInput {
  qtyMilli: number;
  ratePaise: Paise;
  discountBp?: number;
  gstRateBp: number;
}

export interface LineTax {
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}

/** Taxable value of a line: qty × rate × (1 − discount), half-up to the paisa. */
export function lineTaxable(line: LineInput): Paise {
  const disc = line.discountBp ?? 0;
  if (disc < 0 || disc > 10000) throw new RangeError("Discount must be 0–100%");
  return mulMulDivRound(line.qtyMilli, line.ratePaise, 10000 - disc, 1000 * 10000);
}

/** Per-line GST. Intra-state: CGST = SGST = taxable × rate / 2. Inter-state: IGST = taxable × rate. */
export function lineTax(line: LineInput, intraState: boolean): LineTax {
  const taxable = lineTaxable(line);
  if (intraState) {
    const half = mulDivRound(taxable, line.gstRateBp, 20000);
    return { taxablePaise: taxable, cgstPaise: half, sgstPaise: half, igstPaise: 0 };
  }
  return { taxablePaise: taxable, cgstPaise: 0, sgstPaise: 0, igstPaise: mulDivRound(taxable, line.gstRateBp, 10000) };
}

export interface DeductionInput {
  head: string;
  rateBp: number;
  /** Basis amount; defaults to the taxable value. */
  basisPaise?: Paise;
  /** Manual override with a reason (D-15 point 5). */
  overridePaise?: Paise;
}

export interface InvoiceTotals {
  lines: LineTax[];
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  /** Rate-wise summary (sum of lines at each rate). */
  byRate: { rateBp: number; taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise }[];
  grossPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  deductions: { head: string; rateBp: number; basisPaise: Paise; amountPaise: Paise }[];
  deductionsTotalPaise: Paise;
  netReceivablePaise: Paise;
}

export function computeInvoice(lines: LineInput[], intraState: boolean, deductions: DeductionInput[] = []): InvoiceTotals {
  const taxes = lines.map((l) => lineTax(l, intraState));
  const sum = (k: keyof LineTax) => taxes.reduce((s, t) => s + t[k], 0);
  const taxable = sum("taxablePaise");
  const cgst = sum("cgstPaise");
  const sgst = sum("sgstPaise");
  const igst = sum("igstPaise");
  const rates = new Map<number, { rateBp: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }>();
  lines.forEach((l, i) => {
    const t = taxes[i]!;
    const r = rates.get(l.gstRateBp) ?? { rateBp: l.gstRateBp, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    r.taxablePaise += t.taxablePaise; r.cgstPaise += t.cgstPaise; r.sgstPaise += t.sgstPaise; r.igstPaise += t.igstPaise;
    rates.set(l.gstRateBp, r);
  });
  const gross = taxable + cgst + sgst + igst;
  const total = roundToRupee(gross);
  const ded = deductions.map((d) => {
    const basis = d.basisPaise ?? taxable;
    const amount = d.overridePaise ?? roundToRupee(mulDivRound(basis, d.rateBp, 10000));
    return { head: d.head, rateBp: d.rateBp, basisPaise: basis, amountPaise: amount };
  });
  const dedTotal = ded.reduce((s, d) => s + d.amountPaise, 0);
  return {
    lines: taxes,
    taxablePaise: taxable,
    cgstPaise: cgst,
    sgstPaise: sgst,
    igstPaise: igst,
    byRate: [...rates.values()].sort((a, b) => a.rateBp - b.rateBp),
    grossPaise: gross,
    roundOffPaise: total - gross,
    totalPaise: total,
    deductions: ded,
    deductionsTotalPaise: dedTotal,
    netReceivablePaise: total - dedTotal,
  };
}

/** Intra-state supply when the company's state code equals the place of supply. */
export function isIntraState(companyStateCode: string, placeOfSupply: string): boolean {
  return companyStateCode.trim() === placeOfSupply.trim();
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
}

/** Indian-system amount in words: "Rupees Thirty-Eight Lakh … Only" (spec §8.3). */
export function amountInWords(paise: Paise): string {
  if (paise < 0) throw new RangeError("Negative amount");
  let r = Math.floor(paise / 100);
  const p = paise % 100;
  if (r === 0 && p === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(r / 1e7); r %= 1e7;
  const lakh = Math.floor(r / 1e5); r %= 1e5;
  const thousand = Math.floor(r / 1e3); r %= 1e3;
  if (crore) parts.push(`${crore >= 100 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (r) parts.push(threeDigits(r));
  const rupees = parts.length ? `Rupees ${parts.join(" ")}` : "Rupees Zero";
  return p ? `${rupees} and ${twoDigits(p)} Paise Only` : `${rupees} Only`;
}
