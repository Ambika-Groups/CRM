/**
 * Indian mobile numbers. The rule is shared word for word with the website (docs/shared/enquiry-form-contract.md).
 * Stored as "+91XXXXXXXXXX"; de-duplication uses the stored form.
 */
export function normaliseIndianMobile(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/**
 * An Indian phone that may be a landline (QA N2, spec §8.1 lists phone and WhatsApp separately): a mobile, or an
 * STD code plus number, 10 digits without the leading 0. Stored as "+91XXXXXXXXXX". WhatsApp stays mobile-only.
 */
export function toStoredAnyPhone(input: string): string | null {
  const mobile = toStoredPhone(input);
  if (mobile) return mobile;
  let d = input.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[1-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

/** "+919876543210", or null when the input isn't a valid Indian mobile. */
export function toStoredPhone(input: string): string | null {
  const d = normaliseIndianMobile(input);
  return d ? `+91${d}` : null;
}

/** Two-digit STD codes (metros); other landlines are shown with a three-digit code (most of Uttar Pradesh: Lucknow 522). */
const METRO_STD = new Set(["11", "20", "22", "33", "40", "44", "79", "80"]);

/** "+919876543210" → "98765 43210"; a landline "+915222000000" → "0522 2000000" (QA note on M1.2). */
export function formatPhone(stored: string): string {
  const d = stored.replace(/^\+91/, "");
  if (d.length !== 10) return stored;
  if (/^[6-9]/.test(d)) return `${d.slice(0, 5)} ${d.slice(5)}`;
  const std = METRO_STD.has(d.slice(0, 2)) ? 2 : 3;
  return `0${d.slice(0, std)} ${d.slice(std)}`;
}

/** wa.me link digits ("919876543210"). */
export function waDigits(stored: string): string {
  return stored.replace(/\D/g, "");
}
