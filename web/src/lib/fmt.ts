import { formatDate, formatINR, formatPhone, roundToRupee, type Lang } from "@ag/core";

/** Display helpers: Indian money and DD MMM YYYY dates everywhere (spec §4, D-03). */
export const money = (p: number | null | undefined) => (p == null ? "—" : formatINR(p));
export const rupees = (p: number | null | undefined) => (p == null ? "—" : formatINR(roundToRupee(p)));
export const date = (d: string | null | undefined, lang: Lang = "en") => (d ? formatDate(d, lang) : "—");
export const phone = (p: string | null | undefined) => (p ? formatPhone(p) : "—");
export const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
