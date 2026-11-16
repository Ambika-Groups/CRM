/**
 * Roles (D-05) and what each one sees. Navigation follows spec §4A.5 ("role-based visibility applies") and
 * the read matrix in docs/data-model.md §12. Security is enforced by firestore.rules in Firebase mode and
 * by `canRead` in demo mode; the UI only hides what a role can't use.
 */
import { canReadFile } from "./files";
import type { Role } from "./model";

export const ROLE_LABELS: Record<Role, { en: string; hi: string }> = {
  owner: { en: "Owner / Admin", hi: "मालिक / एडमिन" },
  accountant: { en: "Accountant", hi: "अकाउंटेंट" },
  pm: { en: "Project manager", hi: "प्रोजेक्ट मैनेजर" },
  supervisor: { en: "Supervisor", hi: "सुपरवाइज़र" },
  viewer: { en: "Viewer", hi: "दर्शक" },
  ca: { en: "CA (read-only)", hi: "सीए (सिर्फ़ देखें)" },
};

export type NavKey =
  | "home" | "projects" | "labour" | "expenses" | "procurement" | "clients" | "billing" | "contracts"
  | "accounts" | "calendar" | "machinery" | "realestate" | "reports" | "settings";

export interface NavItem {
  key: NavKey;
  href: string;
  icon: string;
  roles: readonly Role[];
  /** PRD phase in which the module is built (spec §16). */
  phase: 1 | 2 | 3 | 4;
}

const ALL: readonly Role[] = ["owner", "accountant", "pm", "supervisor", "viewer", "ca"];
const FINANCE: readonly Role[] = ["owner", "accountant"];
const STAFF: readonly Role[] = ["owner", "accountant", "pm", "supervisor"];

/**
 * The 14 sidebar items of spec §4A.5, in order, with plain-language labels (D-44).
 * Viewer: Home, Projects, Reports (D-42). CA: Home, Accounts, Reports (D-43). PM: no Clients in Phase 1 (§2).
 */
export const NAV: readonly NavItem[] = [
  { key: "home", href: "/", icon: "home", roles: ALL, phase: 1 },
  { key: "projects", href: "/projects/", icon: "folder", roles: [...STAFF, "viewer"], phase: 1 },
  { key: "labour", href: "/labour/", icon: "users", roles: STAFF, phase: 1 },
  { key: "expenses", href: "/expenses/", icon: "receipt", roles: STAFF, phase: 1 },
  { key: "procurement", href: "/procurement/", icon: "package", roles: STAFF, phase: 3 },
  { key: "clients", href: "/clients/", icon: "contact", roles: FINANCE, phase: 1 },
  { key: "billing", href: "/billing/", icon: "file-text", roles: FINANCE, phase: 2 },
  { key: "contracts", href: "/contracts/", icon: "file-signature", roles: FINANCE, phase: 3 },
  { key: "accounts", href: "/accounts/", icon: "calculator", roles: [...FINANCE, "ca"], phase: 1 },
  { key: "calendar", href: "/calendar/", icon: "calendar", roles: STAFF, phase: 3 },
  { key: "machinery", href: "/machinery/", icon: "truck", roles: STAFF, phase: 3 },
  { key: "realestate", href: "/real-estate/", icon: "building", roles: FINANCE, phase: 2 },
  { key: "reports", href: "/reports/", icon: "bar-chart", roles: ["owner", "accountant", "pm", "viewer", "ca"], phase: 1 },
  { key: "settings", href: "/settings/", icon: "settings", roles: FINANCE, phase: 1 },
];

/** Phone bottom bar (spec §4A.5): Home, Attendance, Expenses, Projects, More. */
export const BOTTOM_NAV: readonly { key: "home" | "attendance" | "expenses" | "projects" | "more"; href: string; icon: string }[] = [
  { key: "home", href: "/", icon: "home" },
  { key: "attendance", href: "/labour/attendance/", icon: "users" },
  { key: "expenses", href: "/expenses/", icon: "receipt" },
  { key: "projects", href: "/projects/", icon: "folder" },
  { key: "more", href: "/more/", icon: "grid" },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role));
}

/** Whether a role may open a sidebar module (used to guard pages opened by URL). */
export function canOpen(role: Role, key: NavKey): boolean {
  return NAV.some((n) => n.key === key && n.roles.includes(role));
}

/** Roles that see every project document without assignment (D-06). The CA reads names only, for report filters (D-43). */
export function seesAllProjects(role: Role): boolean {
  return role === "owner" || role === "accountant" || role === "viewer" || role === "ca";
}

/** Owner and accountant: write money records and read everything (D-05). */
export function isFinanceRole(role: Role): boolean {
  return role === "owner" || role === "accountant";
}

/** Raw accounting records (invoices, payments, accounts, ledgers): owner, accountant and the CA (D-43). Not the viewer (D-42). */
export function isFinanceReader(role: Role): boolean {
  return role === "owner" || role === "accountant" || role === "ca";
}

/** Totals only (rollups, budget vs spent): finance roles, the viewer (D-42) and the CA. */
export function readsTotals(role: Role): boolean {
  return seesAllProjects(role);
}

/** Project tabs a role may see (spec §5.5; rule A keeps billing and profit from site roles; D-42 viewer sees the overview). */
export function projectTabsFor(role: Role): readonly string[] {
  const all = ["overview", "workforce", "expenses", "materials", "machinery", "billing", "contracts", "documents", "dpr", "schedule", "photos", "pnl"];
  if (isFinanceRole(role)) return all;
  if (role === "pm" || role === "supervisor") return all.filter((t) => t !== "billing" && t !== "pnl" && t !== "contracts");
  if (role === "viewer") return ["overview"];
  return [];
}

type Ctx = { role: Role; uid: string; assignedProjectIds: string[] };

/**
 * Demo-mode read check mirroring firestore.rules for the collections the app shows. A record is passed
 * as a plain object; project-scoped records carry projectId. Keep in step with firestore.rules (D-42, D-43).
 */
export function canRead(collection: string, doc: Record<string, unknown>, c: Ctx): boolean {
  const assigned = (pid: unknown) => typeof pid === "string" && c.assignedProjectIds.includes(pid);
  const r = c.role;
  const fin = isFinanceRole(r);
  const siteRoleOn = (pid: unknown) => (r === "pm" || r === "supervisor") && assigned(pid);
  switch (collection) {
    case "projects":
      return seesAllProjects(r) || assigned(doc.id);
    case "projects/private/budget":
      return fin || r === "viewer" || r === "ca" || (r === "pm" && assigned(doc.projectId));
    case "projects/private/commercial":
    case "project_units":
    case "project_milestones":
    case "boq_rates":
    case "clients":
      return fin;
    case "client_balances":
    case "invoices":
    case "payments_received":
    case "accounts":
    case "account_transactions":
    case "audit_log":
    case "vendor_bills":
    case "vendor_payments":
      return isFinanceReader(r);
    case "finance_rollups":
      return readsTotals(r);
    case "boq_items":
    case "measurement_book":
    case "project_approvals":
    case "eot_requests":
    case "hindrance_register":
    case "dpr":
    case "roster":
      return fin || siteRoleOn(doc.projectId);
    case "workers":
      // A PM reads only workers on the rosters of their assigned projects (QA F1); supervisors use the roster.
      return fin || (r === "pm" && [...(Array.isArray(doc.siteIds) ? doc.siteIds : []), ...(Array.isArray(doc.crewSiteIds) ? doc.crewSiteIds : [])].some(assigned));
    case "contract_scopes":
      // The contract without money, for the PM of the project (QA N10; D-45 keeps the money finance-only).
      return fin || (r === "pm" && assigned(doc.projectId));
    case "attendance":
      return fin || siteRoleOn(doc.projectId);
    case "worker_payments":
    case "worker_balances":
    case "thekedar_contracts":
      // Money on workers is for finance and the CA only (D-45, rule A): no ₹ for the PM or supervisor.
      return isFinanceReader(r);
    case "contract_measurements":
      return fin;
    case "attendance_unlocks":
      return fin || siteRoleOn(doc.projectId);
    case "attendance_checkins":
      return fin || doc.by === c.uid;
    case "expenses":
      return isFinanceReader(r) || (r === "pm" && assigned(doc.projectId)) ||
        (r === "supervisor" && doc.enteredBy === c.uid && assigned(doc.projectId));
    case "rate_change_requests":
      return fin || (r === "pm" && doc.requestedBy === c.uid);
    case "rollups":
      return readsTotals(r) || (r === "pm" && doc.scope === "project" && assigned(doc.projectId));
    case "files":
    case "file_blobs":
      // Photos and documents (core/files.ts): by kind and project; ID proofs and signatures finance only (D-22).
      return canReadFile(doc, c);
    default:
      // workers/private/* (KYC, pay), project_terms and anything not listed: owner and accountant only.
      return fin;
  }
}
