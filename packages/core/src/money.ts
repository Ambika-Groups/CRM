/**
 * Money, rates and quantities as integers (decisions D-01).
 * - money: integer paise (`…Paise`)
 * - percentages: integer basis points (`…Bp`, 1800 = 18%)
 * - quantities: integer thousandths (`…Milli`, 2500 = 2.5)
 * Products such as qtyMilli × ratePaise × (10000 − discountBp) can pass Number.MAX_SAFE_INTEGER,
 * so multiply-then-divide happens in BigInt and the result is checked before it becomes a Number.
 */

export type Paise = number;

function toBig(n: number | bigint): bigint {
  if (typeof n === "bigint") return n;
  if (!Number.isInteger(n)) throw new RangeError(`Expected an integer, got ${n}`);
  return BigInt(n);
}

function toSafeNumber(b: bigint): number {
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw new RangeError(`Result ${b} is outside the safe integer range`);
  return n;
}

/** round(n / d), half away from zero, on integers. d must be positive. */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError("Divisor must be positive");
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (2n * a + d) / (2n * d);
  return neg ? -q : q;
}

/** round(a × b / c) half-up (away from zero), computed exactly in BigInt. */
export function mulDivRound(a: number | bigint, b: number | bigint, c: number | bigint): number {
  return toSafeNumber(divRoundHalfUp(toBig(a) * toBig(b), toBig(c)));
}

/** round(a × b × c / d) half-up, for three-factor products such as qty × rate × discount. */
export function mulMulDivRound(a: number | bigint, b: number | bigint, c: number | bigint, d: number | bigint): number {
  return toSafeNumber(divRoundHalfUp(toBig(a) * toBig(b) * toBig(c), toBig(d)));
}

/** Round paise to the nearest whole rupee (half-up), still in paise. */
export function roundToRupee(paise: Paise): Paise {
  return mulDivRound(paise, 1, 100) * 100;
}

/** Percentage of a paise amount: amount × bp / 10000, half-up. */
export function percentOf(paise: Paise, bp: number): Paise {
  return mulDivRound(paise, bp, 10000);
}

/** Indian digit grouping: 1234567 → "12,34,567". */
export function groupIndian(whole: bigint | number): string {
  const s = (typeof whole === "bigint" ? whole : BigInt(whole)).toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

export interface FormatMoneyOptions {
  /** Always show two decimals (invoices). Default: only when the amount isn't whole rupees. */
  paise?: boolean;
  /** Omit the ₹ sign. */
  noSymbol?: boolean;
}

/** ₹1,25,000 / ₹1,25,000.50 / −₹500 (design-tokens §2, D-03). Uses U+2212 for minus. */
export function formatINR(paise: Paise, opts: FormatMoneyOptions = {}): string {
  const neg = paise < 0;
  const abs = BigInt(Math.abs(paise));
  const rupees = abs / 100n;
  const rem = Number(abs % 100n);
  const showPaise = opts.paise || rem !== 0;
  const body = groupIndian(rupees) + (showPaise ? "." + String(rem).padStart(2, "0") : "");
  return (neg ? "−" : "") + (opts.noSymbol ? "" : "₹") + body;
}

/** Compact form for chart axes: ₹12.5 L, ₹1.2 Cr, ₹45K. */
export function formatINRCompact(paise: Paise): string {
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "−" : "";
  const trim = (n: number) => (Math.round(n * 10) / 10).toString().replace(/\.0$/, "");
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

/** CSV amount: two decimals, no separators, "-" for negatives (spec §11A.2). */
export function csvAmount(paise: Paise): string {
  const neg = paise < 0;
  const abs = BigInt(Math.abs(paise));
  return (neg ? "-" : "") + (abs / 100n).toString() + "." + String(abs % 100n).padStart(2, "0");
}

/**
 * Parse what a person types into a money field ("1,25,000", "₹ 1250.5", "12500.00") into paise.
 * Returns null for anything that isn't a plain non-negative amount with at most 2 decimals.
 */
export function parseRupees(input: string): Paise | null {
  const s = input.replace(/[₹,\s]/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const paise = BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  return toSafeNumber(paise);
}

/** Quantity in thousandths → display string with up to 3 decimals ("2.5", "420.000" with fixed). */
export function formatQty(milli: number, fixed = false): string {
  const neg = milli < 0;
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, "0");
  const fracOut = fixed ? frac : frac.replace(/0+$/, "");
  return (neg ? "−" : "") + groupIndian(whole) + (fracOut ? "." + fracOut : "");
}

/** Parse a typed quantity ("2.5", "1,200") into thousandths. */
export function parseQty(input: string): number | null {
  const s = input.replace(/[,\s]/g, "");
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  return toSafeNumber(BigInt(m[1]!) * 1000n + BigInt((m[2] ?? "").padEnd(3, "0") || "0"));
}

/** Basis points → "18%", "2.5%". */
export function formatBp(bp: number): string {
  return (bp / 100).toString() + "%";
}

/** Sum a list of paise amounts. */
export function sumPaise(values: Iterable<Paise>): Paise {
  let t = 0;
  for (const v of values) t += v;
  if (!Number.isSafeInteger(t)) throw new RangeError("Sum outside the safe integer range");
  return t;
}
