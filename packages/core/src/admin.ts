/**
 * Admin (PRD §2 users and roles; §3.1 rule 12 audit log; rule 16 backups as changed by D-51): staff sign-in rules, the
 * audit log in plain words, the usage meter for the free plan, and the owner's "Download backup". Pure code: no browser,
 * no Firebase, no clock (the caller passes dates).
 */
import { isEmail } from "./commands/common";
import { addDays, daysBetween, isDateStr, todayIST, type Lang } from "./dates";
import { FILE_LIMITS, USAGE_CRITICAL_PERCENT, USAGE_WARN_PERCENT, type UsageLevel } from "./files";
import { normaliseIndianMobile } from "./phone";
import type { QuerySpec, Where } from "./query";

// ───────────────────────── 1. staff sign-in (D-51, SPARK-PLAN) ─────────────────────────

/** A phone-only person signs in with `<mobile>@staff.ambika` (never a real mailbox; nothing is ever sent to it). */
export const STAFF_EMAIL_DOMAIN = "staff.ambika";

/**
 * The sign-in email for what a person typed or what their users document holds: an email stays (lower case), a
 * 10-digit Indian mobile (with or without +91, spaces or a leading 0) becomes `<mobile>@staff.ambika`. Null when it is neither.
 */
export function staffLoginEmail(phoneOrEmail: string | null | undefined): string | null {
  const v = (phoneOrEmail ?? "").trim();
  if (!v) return null;
  if (v.includes("@")) return isEmail(v) ? v.toLowerCase() : null;
  const mobile = normaliseIndianMobile(v);
  return mobile ? `${mobile}@${STAFF_EMAIL_DOMAIN}` : null;
}

export interface StaffLogin {
  /** What the sign-in account uses. */
  email: string;
  /** What the person types on the sign-in screen: their email, or their 10-digit mobile. */
  signInWith: string;
  kind: "email" | "mobile";
}

/** How a person signs in: with their email when they have one, else with their mobile. Null when they have neither. */
export function staffLoginFor(user: { email?: string | null; phone?: string | null }): StaffLogin | null {
  const byEmail = user.email ? staffLoginEmail(user.email) : null;
  if (byEmail && user.email!.includes("@")) return { email: byEmail, signInWith: byEmail, kind: "email" };
  const mobile = user.phone ? normaliseIndianMobile(user.phone) : null;
  return mobile ? { email: `${mobile}@${STAFF_EMAIL_DOMAIN}`, signInWith: mobile, kind: "mobile" } : null;
}

export const STAFF_PASSWORD_MIN = 8;
export const STAFF_PASSWORD_MAX = 64;

export type StaffPasswordCode = "missing" | "short" | "long" | "spaces" | "easy" | "own";
export interface StaffPasswordProblem { code: StaffPasswordCode; message: string }

/** The English for each problem; the web shows `admin.password.err.<code>` in English or Hindi. */
export const STAFF_PASSWORD_TEXT: Record<StaffPasswordCode, string> = {
  missing: "Enter a password.",
  short: `Use at least ${STAFF_PASSWORD_MIN} letters or numbers.`,
  long: `Use at most ${STAFF_PASSWORD_MAX} letters or numbers.`,
  spaces: "A password can't start or end with a space.",
  easy: "This password is too easy to guess. Mix letters and numbers, like a word and a number you will remember.",
  own: "Don't use the person's own mobile number, email or name as the password.",
};

const EASY = new Set(["password", "password1", "passw0rd", "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "qwertyui", "qwerty123", "abcdefgh", "abcd1234", "ambika123", "ambika1234", "india123", "welcome1", "iloveyou"]);

/** A first password, checked before it is sent anywhere. Null when it is fine. */
export function checkStaffPassword(password: unknown, about: { name?: string | null; email?: string | null; phone?: string | null } = {}): StaffPasswordProblem | null {
  const bad = (code: StaffPasswordCode): StaffPasswordProblem => ({ code, message: STAFF_PASSWORD_TEXT[code] });
  if (typeof password !== "string" || password.length === 0) return bad("missing");
  if (password !== password.trim()) return bad("spaces");
  if (password.length < STAFF_PASSWORD_MIN) return bad("short");
  if (password.length > STAFF_PASSWORD_MAX) return bad("long");
  const low = password.toLowerCase();
  if (EASY.has(low) || new Set(low).size <= 2) return bad("easy");
  const mobile = about.phone ? normaliseIndianMobile(about.phone) : null;
  const email = (about.email ?? "").trim().toLowerCase();
  const name = (about.name ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if ((mobile && low.includes(mobile)) || (email && (low === email || low === email.split("@")[0])) || (name.length >= 4 && low === name)) return bad("own");
  return null;
}

/** What the owner tells the person, without the password itself: "Sign in with: 9876543210 and the password you set". */
export function staffHandover(login: StaffLogin, lang: Lang = "en"): string {
  return lang === "hi"
    ? `साइन इन करें: ${login.signInWith} और वह पासवर्ड जो आपने रखा है`
    : `Sign in with: ${login.signInWith} and the password you set`;
}

// ───────────────────────── 2. the audit log in plain words (PRD §3.1 rule 12) ─────────────────────────

/** One `audit_log` record as the runner and the commands write it (runner.ts `auditFor`). */
export interface AuditRecord {
  id: string;
  /** The collection of the main record ("expenses", "projects/p1/roster"). */
  entity: string;
  entityId: string;
  action: string;
  command?: string;
  /** Names of the fields that changed (updates only). */
  fields?: string[];
  paths?: string[];
  projectId?: string | null;
  note?: string | null;
  /** The uid of the person, or "system". */
  by: string;
  /** ISO time. */
  at: string;
}

type Words = { en: string; hi: string };

/** What a collection is called in a sentence. English carries its article; Hindi is the bare noun. */
export const AUDIT_ENTITY_LABELS: Record<string, Words> = {
  expenses: { en: "an expense", hi: "खर्च" },
  expense_templates: { en: "a repeating expense", hi: "हर महीने का खर्च" },
  expense_categories: { en: "an expense head", hi: "खर्च का मद" },
  projects: { en: "a project", hi: "प्रोजेक्ट" },
  roster: { en: "the workers on a site", hi: "साइट के मज़दूर" },
  workers: { en: "a worker", hi: "मज़दूर" },
  private: { en: "private details", hi: "निजी जानकारी" },
  project_terms: { en: "a worker's rate on a site", hi: "साइट पर मज़दूर की दर" },
  attendance: { en: "attendance", hi: "हाज़िरी" },
  attendance_unlocks: { en: "an attendance day", hi: "हाज़िरी का दिन" },
  worker_payments: { en: "a worker payment", hi: "मज़दूर का भुगतान" },
  thekedar_contracts: { en: "a thekedar contract", hi: "ठेकेदार का ठेका" },
  contract_measurements: { en: "a contract measurement", hi: "ठेके की नाप" },
  rate_change_requests: { en: "a rate request", hi: "दर बदलने की माँग" },
  clients: { en: "a client", hi: "ग्राहक" },
  invoices: { en: "an invoice", hi: "इनवॉइस" },
  quotations: { en: "a quotation", hi: "कोटेशन" },
  payments_received: { en: "a payment received", hi: "मिला हुआ भुगतान" },
  accounts: { en: "an account", hi: "खाता" },
  account_transfers: { en: "a transfer between accounts", hi: "खातों के बीच ट्रांसफ़र" },
  period_locks: { en: "a month", hi: "महीना" },
  users: { en: "a person's access", hi: "व्यक्ति की पहुँच" },
  settings: { en: "the settings", hi: "सेटिंग" },
  integrations: { en: "a connected service", hi: "जुड़ी हुई सेवा" },
  documents: { en: "a document", hi: "दस्तावेज़" },
  files: { en: "a file", hi: "फ़ाइल" },
  vendors: { en: "a vendor", hi: "विक्रेता" },
  vendor_bills: { en: "a vendor bill", hi: "विक्रेता का बिल" },
  vendor_payments: { en: "a vendor payment", hi: "विक्रेता का भुगतान" },
};
const ANY_RECORD: Words = { en: "a record", hi: "रिकॉर्ड" };

/** The entities offered in the "What" filter, in this order. */
export const AUDIT_ENTITY_OPTIONS: readonly string[] = [
  "expenses", "projects", "workers", "attendance_unlocks", "worker_payments", "clients", "invoices", "quotations", "payments_received", "accounts",
  "account_transfers", "period_locks", "expense_categories", "expense_templates", "users", "settings",
];

/** What a field is called. English has no article ("the amount and date" is built around it). */
export const AUDIT_FIELD_LABELS: Record<string, Words> = {
  amountPaise: { en: "amount", hi: "रकम" }, taxablePaise: { en: "taxable amount", hi: "कर योग्य रकम" }, date: { en: "date", hi: "तारीख़" },
  description: { en: "description", hi: "विवरण" }, categoryId: { en: "expense head", hi: "खर्च का मद" }, categoryPath: { en: "expense head", hi: "खर्च का मद" },
  projectId: { en: "project", hi: "प्रोजेक्ट" }, projectName: { en: "project", hi: "प्रोजेक्ट" }, payeeName: { en: "payee", hi: "पाने वाला" }, payeeType: { en: "payee", hi: "पाने वाला" },
  mode: { en: "way of paying", hi: "भुगतान का तरीका" }, accountId: { en: "account", hi: "खाता" }, approvalStatus: { en: "approval", hi: "मंज़ूरी" },
  paidStatus: { en: "paid status", hi: "भुगतान की स्थिति" }, gstRateBp: { en: "GST rate", hi: "जीएसटी दर" }, billNo: { en: "bill number", hi: "बिल नंबर" },
  billDate: { en: "bill date", hi: "बिल की तारीख़" }, billFiles: { en: "bill photo", hi: "बिल की फ़ोटो" }, files: { en: "attachments", hi: "संलग्न फ़ाइलें" },
  name: { en: "name", hi: "नाम" }, phone: { en: "phone", hi: "फ़ोन" }, email: { en: "email", hi: "ईमेल" }, address: { en: "address", hi: "पता" },
  role: { en: "role", hi: "भूमिका" }, active: { en: "on or off switch", hi: "चालू या बंद" }, superUser: { en: "super user switch", hi: "सुपर यूज़र" },
  projectIds: { en: "projects", hi: "प्रोजेक्ट" }, assignedUsers: { en: "people on the project", hi: "प्रोजेक्ट के लोग" }, status: { en: "status", hi: "स्थिति" },
  progressPct: { en: "progress", hi: "प्रगति" }, notes: { en: "notes", hi: "नोट" }, note: { en: "note", hi: "नोट" }, reason: { en: "reason", hi: "कारण" },
  isDeleted: { en: "deleted mark", hi: "हटाने का निशान" }, isArchived: { en: "archive mark", hi: "आर्काइव" }, openingBalancePaise: { en: "opening balance", hi: "शुरुआती बकाया" },
  budgetPaise: { en: "budget", hi: "बजट" }, startDate: { en: "start date", hi: "शुरू की तारीख़" }, endDate: { en: "end date", hi: "पूरा होने की तारीख़" },
  dueDate: { en: "due date", hi: "देय तारीख़" }, items: { en: "lines", hi: "लाइनें" }, totalPaise: { en: "total", hi: "कुल" }, gstin: { en: "GSTIN", hi: "जीएसटीआईएन" },
  pan: { en: "PAN", hi: "पैन" }, lastBackupAt: { en: "backup time", hi: "बैकअप का समय" }, counts: { en: "record counts", hi: "रिकॉर्ड की गिनती" },
  workerRoles: { en: "worker roles", hi: "मज़दूरों की भूमिकाएँ" }, language: { en: "language", hi: "भाषा" }, theme: { en: "theme", hi: "थीम" },
};

/** The last part of a collection path: "projects/p1/roster" is "roster"; "expenses" stays. */
export function auditEntityKey(entity: string): string {
  const parts = entity.split("/");
  return parts.length >= 3 ? parts[parts.length - 1]! : parts[0]!;
}

export function auditEntityLabel(entity: string, lang: Lang = "en"): string {
  return (AUDIT_ENTITY_LABELS[auditEntityKey(entity)] ?? ANY_RECORD)[lang];
}

/** A field name nobody listed, made readable: "defaultRatePaise" is "default rate". */
function humanise(field: string): string {
  return field.replace(/(Paise|Bp|Ids?|At)$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().trim() || field;
}

export function auditFieldLabel(field: string, lang: Lang = "en"): string {
  return AUDIT_FIELD_LABELS[field]?.[lang] ?? humanise(field);
}

/** At most this many changed fields are named; the rest are counted ("and 4 more"). */
export const AUDIT_FIELDS_SHOWN = 3;

function fieldList(fields: readonly string[], lang: Lang): string {
  const labels = [...new Set(fields.map((f) => auditFieldLabel(f, lang)))];
  const shown = labels.slice(0, AUDIT_FIELDS_SHOWN);
  const more = labels.length - shown.length;
  if (lang === "hi") {
    if (more > 0) return `${shown.join(", ")} और ${more} और`;
    return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} और ${shown[shown.length - 1]}` : shown[0] ?? "";
  }
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0] ?? "";
}

type Verb = "create" | "update" | "delete" | "restore" | "approve" | "reject" | "pay" | "lock" | "unlock" | "run" | "backup" | "password";
const ACTION_VERB: Record<string, Verb> = {
  create: "create", created: "create", add: "create", added: "create",
  update: "update", updated: "update", edit: "update", edited: "update", change: "update", move: "update", moved: "update", merge: "update", merged: "update",
  delete: "delete", deleted: "delete", remove: "delete", removed: "delete",
  restore: "restore", restored: "restore", approve: "approve", approved: "approve", reject: "reject", rejected: "reject",
  paid: "pay", pay: "pay", lock: "lock", locked: "lock", unlock: "unlock", unlocked: "unlock", run: "run", backup: "backup", password: "password",
};

const VERB_EN: Record<Verb, string> = {
  create: "added", update: "changed", delete: "deleted", restore: "restored", approve: "approved", reject: "rejected", pay: "marked as paid",
  lock: "locked", unlock: "unlocked", run: "ran", backup: "downloaded a backup of", password: "set a new password for",
};

/** Who did it: the name from the list, "The system" for automatic entries, "Someone" when the name is not known. */
export function auditWho(by: string, names: Record<string, string>, lang: Lang = "en"): string {
  if (by === "system") return lang === "hi" ? "सिस्टम" : "The system";
  return names[by] || (lang === "hi" ? "किसी" : "Someone");
}

/**
 * One audit entry as a sentence: "Anil changed the amount and date of an expense". `names` maps a uid to a name.
 * The Hindi keeps to forms that read correctly whatever the noun's gender ("… में बदलाव किया").
 */
export function auditLine(rec: Pick<AuditRecord, "entity" | "action" | "fields" | "by" | "command">, names: Record<string, string>, lang: Lang = "en"): string {
  const who = auditWho(rec.by, names, lang);
  const verb: Verb = ACTION_VERB[rec.action] ?? "update";
  const fields = verb === "update" && rec.fields?.length ? fieldList(rec.fields, lang) : "";
  const key = auditEntityKey(rec.entity);
  if (lang === "hi") {
    const what = auditEntityLabel(rec.entity, "hi");
    switch (verb) {
      case "create": return `${who} ने नया रिकॉर्ड जोड़ा: ${what}`;
      case "delete": return `${who} ने रिकॉर्ड हटाया: ${what}`;
      case "restore": return `${who} ने रिकॉर्ड वापस लाया: ${what}`;
      case "approve": return `${who} ने मंज़ूर किया: ${what}`;
      case "reject": return `${who} ने नामंज़ूर किया: ${what}`;
      case "pay": return `${who} ने भुगतान हुआ दर्ज किया: ${what}`;
      case "lock": return `${who} ने बंद किया: ${what}`;
      case "unlock": return `${who} ने खोला: ${what}`;
      case "run": return `${who} ने चलाया: ${what}`;
      case "backup": return `${who} ने बैकअप डाउनलोड किया`;
      case "password": return `${who} ने एक व्यक्ति का नया पासवर्ड रखा`;
      default: return fields ? `${who} ने ${what} में बदलाव किया: ${fields}` : `${who} ने ${what} में बदलाव किया`;
    }
  }
  const what = auditEntityLabel(rec.entity, "en");
  if (verb === "backup") return `${who} downloaded a backup`;
  if (verb === "password") return `${who} set a new password for a person`;
  if (verb === "run" && key === "expense_templates") return `${who} added this month's repeating expenses`;
  if (verb === "update" && fields) return `${who} changed the ${fields} of ${what}`;
  return `${who} ${VERB_EN[verb]} ${what}`;
}

/** Where the record of an entry can be opened; null when it has no page of its own. */
export function auditHref(rec: Pick<AuditRecord, "entity" | "entityId">): string | null {
  const parts = rec.entity.split("/");
  const id = encodeURIComponent(rec.entityId);
  if (parts.length >= 3 && parts[0] === "projects") return `/projects/view/?id=${encodeURIComponent(parts[1]!)}`;
  if (parts.length >= 3 && parts[0] === "workers") return `/labour/workers/view/?id=${encodeURIComponent(parts[1]!)}`;
  switch (parts[0]) {
    case "expenses": return `/expenses/view/?id=${id}`;
    case "projects": return `/projects/view/?id=${id}`;
    case "workers": return `/labour/workers/view/?id=${id}`;
    case "clients": return `/clients/view/?id=${id}`;
    case "invoices": return `/billing/invoices/view/?id=${id}`;
    case "quotations": return `/billing/quotations/view/?id=${id}`;
    case "expense_templates": return "/expenses/recurring/";
    case "expense_categories": return "/expenses/categories/";
    case "worker_payments": return "/labour/payments/";
    case "attendance": case "attendance_unlocks": return "/labour/attendance/";
    case "accounts": case "account_transfers": return "/accounts/";
    case "period_locks": return "/accounts/lock/";
    case "users": return "/settings/?tab=users";
    case "settings": return rec.entityId === "backup" ? "/settings/data/" : "/settings/";
    default: return null;
  }
}

export interface AuditFilters {
  /** A collection name ("expenses"); empty for all. */
  entity?: string;
  /** A uid; empty for everyone. */
  by?: string;
  /** IST days `YYYY-MM-DD`, both included. */
  from?: string;
  to?: string;
}

/** The first moment of an IST day as the ISO time audit entries carry (UTC). */
export function istDayStartIso(date: string): string {
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}

/** The filters as a query, newest first. Dates that are not real days are ignored. */
export function auditQuery(f: AuditFilters): { where: Where[]; orderBy: { field: string; dir: "asc" | "desc" }[] } {
  const where: Where[] = [];
  if (f.entity) where.push({ field: "entity", op: "==", value: f.entity });
  if (f.by) where.push({ field: "by", op: "==", value: f.by });
  if (f.from && isDateStr(f.from)) where.push({ field: "at", op: ">=", value: istDayStartIso(f.from) });
  if (f.to && isDateStr(f.to)) where.push({ field: "at", op: "<", value: istDayStartIso(addDays(f.to, 1)) });
  return { where, orderBy: [{ field: "at", dir: "desc" }] };
}

export const AUDIT_PAGE_SIZES = [25, 50] as const;

/** One page of the audit log: never the whole collection (PRD §3.1 rule 9). Any other size becomes 25. */
export function auditPageSpec(f: AuditFilters, pageSize: number = 25, after: string | null = null): QuerySpec {
  const limit = (AUDIT_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : 25;
  return { ...auditQuery(f), limit, after };
}

/** The time of an entry as people read it in India: "16 Nov 2026, 3:45 pm" (IST). */
export function auditWhen(atIso: string, lang: Lang = "en"): string {
  const d = new Date(atIso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

// ───────────────────────── 3. the usage meter (D-51: the free plan's limits) ─────────────────────────

/** Firestore's free limits (SPARK-PLAN, 16 Nov 2026) and the photo estimate (about 100 KB a photo in 1 GiB, with room for records). */
export const FREE_LIMITS = {
  storedBytes: FILE_LIMITS.budgetBytes,
  readsPerDay: 50_000,
  writesPerDay: 20_000,
  photos: 8_000,
} as const;

/** Roughly what one record takes in the database, for the "stored data" estimate. A file's details carry a small preview. */
export const DOC_BYTES_ESTIMATE = 1_000;
export const FILE_DETAILS_BYTES_ESTIMATE = 8_000;

/** The collections counted for the meter (one count each: a count costs one read per thousand records). */
export const USAGE_COLLECTIONS: readonly string[] = [
  "expenses", "attendance", "worker_payments", "workers", "projects", "clients", "invoices", "quotations", "payments_received",
  "account_transactions", "account_transfers", "audit_log", "postings", "rollups", "command_requests", "users",
];

/** The daily counter document: `usage_daily/<YYYY-MM-DD>` `{ reads, writes }` (IST day), written by the server part. */
export const USAGE_DAILY_COLLECTION = "usage_daily";
export const usageDayId = (date: string): string => date;

export type MeterKey = "storage" | "photos" | "reads" | "writes";

export interface UsageMeter {
  key: MeterKey;
  used: number;
  limit: number;
  /** Share of the limit, to one decimal place, rounded down (69.99% never shows as 70). */
  percent: number;
  /** "warning" from 70%, "critical" from 90%, "full" at 100%. */
  level: UsageLevel;
  /** False when nothing has counted this yet (reads and writes a day before the counter exists). */
  measured: boolean;
}

export interface UsageInput {
  /** Records per collection, as numbers (from count()). */
  counts: Record<string, number>;
  /** Files kept inside the database: how many and their bytes (files.ts usage). */
  files: { files: number; bytes: number };
  /** Today's counter document, when there is one. */
  day?: { reads?: number | null; writes?: number | null } | null;
}

export interface UsageReport {
  /** All records counted. */
  documents: number;
  meters: UsageMeter[];
  /** The worst level of the measured meters. */
  worst: UsageLevel;
}

const LEVEL_ORDER: readonly UsageLevel[] = ["ok", "warning", "critical", "full"];
const whole = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** The level for a share of a limit: ok, warning from 70%, critical from 90%, full at 100%. */
export function usageLevel(percent: number): UsageLevel {
  return percent >= 100 ? "full" : percent >= USAGE_CRITICAL_PERCENT ? "critical" : percent >= USAGE_WARN_PERCENT ? "warning" : "ok";
}

function meter(key: MeterKey, used: number, limit: number, measured = true): UsageMeter {
  const percent = limit > 0 ? Math.floor((used * 1000) / limit) / 10 : 100;
  return { key, used, limit, percent, level: measured ? usageLevel(percent) : "ok", measured };
}

/** The four meters of the free plan from counts, file usage and today's counter. */
export function usageMeters(input: UsageInput): UsageReport {
  const documents = Object.values(input.counts).reduce((a, n) => a + whole(n), 0);
  const files = whole(input.files.files), fileBytes = whole(input.files.bytes);
  const storedBytes = fileBytes + documents * DOC_BYTES_ESTIMATE + files * FILE_DETAILS_BYTES_ESTIMATE;
  const reads = input.day?.reads, writes = input.day?.writes;
  const meters = [
    meter("storage", storedBytes, FREE_LIMITS.storedBytes),
    meter("photos", files, FREE_LIMITS.photos),
    meter("reads", whole(reads), FREE_LIMITS.readsPerDay, typeof reads === "number"),
    meter("writes", whole(writes), FREE_LIMITS.writesPerDay, typeof writes === "number"),
  ];
  const worst = meters.filter((m) => m.measured).reduce<UsageLevel>((w, m) => (LEVEL_ORDER.indexOf(m.level) > LEVEL_ORDER.indexOf(w) ? m.level : w), "ok");
  return { documents, meters, worst };
}

// ───────────────────────── 4. the owner's backup (PRD §3.1 rule 16, D-51) ─────────────────────────

/**
 * What "Download backup" holds, in the order it is read and would be put back: settings and people first, then the
 * masters, then the day-to-day records, then the totals and the history.
 */
export const BACKUP_COLLECTIONS: readonly string[] = [
  "settings", "users", "expense_categories", "accounts", "clients", "projects", "workers",
  "expense_templates", "expenses", "attendance", "attendance_unlocks", "worker_payments", "thekedar_contracts", "contract_measurements", "rate_change_requests",
  "quotations", "invoices", "payments_received", "account_transfers", "account_transactions", "period_locks",
  "rollups", "finance_rollups", "client_balances", "worker_balances", "files", "audit_log",
];

/** Small lists kept under each project or worker; read once per parent. */
export const BACKUP_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  projects: ["private", "roster", "project_units", "project_milestones", "boq_items", "boq_rates", "project_approvals", "eot_requests", "hindrance_register"],
  workers: ["private", "project_terms"],
};

/** Never in the file: saved keys (D-49), the photos' own bytes (too large for a browser to build), and server working records. */
export const BACKUP_EXCLUDED: readonly string[] = ["private_config", "integrations", "file_blobs", "command_requests", "processed_events", "counters", "postings"];

export const BACKUP_PAGE_SIZE = 50;

export interface BackupStep {
  collection: string;
  /** 1 for the first collection read. */
  order: number;
  pageSize: number;
  /** Lists read under each of its records (`projects/<id>/roster`). */
  children: readonly string[];
}

/** The steps of a backup, in order. Names on the excluded list, and repeats, are dropped. */
export function backupPlan(collections: readonly string[] = BACKUP_COLLECTIONS): { steps: BackupStep[]; excluded: readonly string[] } {
  const seen = new Set<string>();
  const steps: BackupStep[] = [];
  for (const c of collections) {
    if (!c || seen.has(c) || BACKUP_EXCLUDED.includes(c)) continue;
    seen.add(c);
    steps.push({ collection: c, order: steps.length + 1, pageSize: BACKUP_PAGE_SIZE, children: BACKUP_CHILDREN[c] ?? [] });
  }
  return { steps, excluded: BACKUP_EXCLUDED };
}

/** "ambika-crm-backup-2026-11-16.json" for an IST day. */
export function backupFileName(date: string): string {
  return `ambika-crm-backup-${isDateStr(date) ? date : "undated"}.json`;
}

export const BACKUP_FORMAT_VERSION = 1;

export interface BackupMeta {
  app: "ambika-crm";
  version: number;
  /** ISO time the backup was started, and the IST day. */
  madeAt: string;
  date: string;
  /** The uid and name of the owner who made it. */
  by: string;
  byName: string;
  /** "demo" or "firebase". */
  mode: string;
  /** Records per collection (children under their full path, "projects/p1/roster"). */
  counts: Record<string, number>;
  total: number;
  /** Collections that could not be read (the file is then not a complete backup). */
  failed: string[];
  /** What is left out on purpose. */
  excluded: readonly string[];
}

/** The file's shape: details first, then every collection's records under its name. */
export interface Backup {
  meta: BackupMeta;
  collections: Record<string, unknown[]>;
}

export function newBackup(m: { madeAt: string; by: string; byName: string; mode: string }): Backup {
  return {
    meta: { app: "ambika-crm", version: BACKUP_FORMAT_VERSION, madeAt: m.madeAt, date: todayIST(new Date(m.madeAt)), by: m.by, byName: m.byName, mode: m.mode, counts: {}, total: 0, failed: [], excluded: BACKUP_EXCLUDED },
    collections: {},
  };
}

/** Adds one page of a collection's records; the counts in `meta` follow. */
export function addToBackup(b: Backup, collection: string, docs: readonly unknown[]): void {
  (b.collections[collection] ??= []).push(...docs);
  b.meta.counts[collection] = b.collections[collection]!.length;
  b.meta.total += docs.length;
}

/** Notes a collection that could not be read. */
export function markBackupFailed(b: Backup, collection: string): void {
  if (!b.meta.failed.includes(collection)) b.meta.failed.push(collection);
}

/**
 * The file as pieces of text, one record at a time, so a browser builds it without one very large string
 * (`new Blob(backupParts(b))`). Joined together the pieces are the JSON of `{ meta, collections }`.
 */
export function backupParts(b: Backup): string[] {
  const parts: string[] = [`{"meta":${JSON.stringify(b.meta)},"collections":{`];
  Object.keys(b.collections).forEach((name, i) => {
    parts.push(`${i ? "," : ""}${JSON.stringify(name)}:[`);
    b.collections[name]!.forEach((doc, j) => parts.push(`${j ? "," : ""}${JSON.stringify(doc)}`));
    parts.push("]");
  });
  parts.push("}}");
  return parts;
}

/** Days after which the owner is reminded to download a backup. */
export const BACKUP_REMINDER_DAYS = 7;

/** True when no backup was ever made, or the last one is 7 or more days old (IST days). */
export function backupDue(lastBackupAt: string | null | undefined, today: string): boolean {
  if (!lastBackupAt) return true;
  const t = new Date(lastBackupAt);
  if (Number.isNaN(t.getTime())) return true;
  return daysBetween(todayIST(t), today) >= BACKUP_REMINDER_DAYS;
}

/** How many days ago the last backup was made; null when there was none. */
export function backupAgeDays(lastBackupAt: string | null | undefined, today: string): number | null {
  if (!lastBackupAt) return null;
  const t = new Date(lastBackupAt);
  return Number.isNaN(t.getTime()) ? null : Math.max(0, daysBetween(todayIST(t), today));
}

/** `settings/backup`: when the last backup was downloaded, by whom, and how many records it held. */
export interface BackupRecord {
  id: "backup";
  lastBackupAt: string;
  by: string;
  counts: Record<string, number>;
  total: number;
  complete: boolean;
}
