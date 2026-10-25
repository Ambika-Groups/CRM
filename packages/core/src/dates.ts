/**
 * Business dates are `YYYY-MM-DD` strings in IST (D-04). Month and financial year are always derived
 * from the date (D-13), never trusted from stored fields. Financial year runs April–March ("2026-27").
 */

const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isDateStr(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parts(date: string): [number, number, number] {
  if (!isDateStr(date)) throw new RangeError(`Not a valid date: ${date}`);
  return date.split("-").map(Number) as [number, number, number];
}

/** "2026-10-25" → "2026-10" */
export function monthKeyOf(date: string): string {
  parts(date);
  return date.slice(0, 7);
}

/** "2026-03-31" → "2025-26"; "2026-04-01" → "2026-27". Same formula as firestore.rules fyOf(). */
export function fyOf(date: string): string {
  const [y, m] = parts(date);
  const start = m >= 4 ? y : y - 1;
  const end = (start + 1) % 100;
  return `${start}-${String(end).padStart(2, "0")}`;
}

/** First and last date of a financial year ("2026-27" → 2026-04-01 … 2027-03-31). */
export function fyRange(fy: string): { from: string; to: string } {
  const start = Number(fy.slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** Months of a financial year as monthKeys, April first. */
export function fyMonths(fy: string): string[] {
  const start = Number(fy.slice(0, 4));
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? start : start + 1;
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

const IST_OFFSET_MIN = 330;

/** Today's business date in India, from an instant (defaults to now). */
export function todayIST(now: Date = new Date()): string {
  const t = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  return t.toISOString().slice(0, 10);
}

/** Add whole days to a date string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Day of week, 0 = Sunday. */
export function weekday(date: string): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_HI = ["जन", "फ़र", "मार्च", "अप्रै", "मई", "जून", "जुला", "अग", "सितं", "अक्टू", "नवं", "दिसं"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_HI = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];

export type Lang = "en" | "hi";

/** On-screen date: "25 Oct 2026" (D-03). Hindi uses Western digits (brand.md 2.1). */
export function formatDate(date: string, lang: Lang = "en"): string {
  const [y, m, d] = parts(date);
  return `${d} ${(lang === "hi" ? MONTHS_HI : MONTHS_EN)[m - 1]} ${y}`;
}

/** "Sat, 25 Oct 2026" */
export function formatDateLong(date: string, lang: Lang = "en"): string {
  return `${(lang === "hi" ? DAYS_HI : DAYS_EN)[weekday(date)]}, ${formatDate(date, lang)}`;
}

/** "Oct 2026" from a monthKey. */
export function formatMonth(monthKey: string, lang: Lang = "en"): string {
  const y = monthKey.slice(0, 4);
  const m = Number(monthKey.slice(5, 7));
  return `${(lang === "hi" ? MONTHS_HI : MONTHS_EN)[m - 1]} ${y}`;
}

/** Input fields use DD/MM/YYYY (D-03). */
export function toInputDate(date: string): string {
  const [y, m, d] = parts(date);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** "25/10/2026" → "2026-10-25", or null. */
export function parseInputDate(input: string): string | null {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(input);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return isDateStr(iso) ? iso : null;
}

/** CSV dates are ISO by default, DD/MM/YYYY as the §11A.2 option. */
export function csvDate(date: string, format: "iso" | "dmy" = "iso"): string {
  return format === "iso" ? date : toInputDate(date);
}

/** Every date from `from` to `to` inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
