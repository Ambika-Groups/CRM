/**
 * Workers (spec §6.1, D-22, D-29, D-32), the site roster (D-33), users and roles (§2, D-05) and settings.
 */
import { rosterSnapshot } from "../actions";
import { isDateStr } from "../dates";
import { ROLES, type Role, type User, type Worker } from "../model";
import { toStoredPhone } from "../phone";
import { searchKeywords } from "../search";
import type { Doc, MemoryStore } from "../store";
import { Checker, CommandError, isEmail, isNonNegInt, isPan, newId, requireAssigned, requireRole, stampCreate, stampUpdate, trimOrEmpty, type CommandCtx } from "./common";
import { syncUserProjects } from "./projects";

/** §6.1 role list (editable in Settings) plus Thekedar. */
export const DEFAULT_WORKER_ROLES = [
  { key: "mistri", label: "Mistri", labelHi: "मिस्त्री", expenseCategoryId: "cat_labour_mistri" },
  { key: "labour", label: "Labour", labelHi: "मज़दूर", expenseCategoryId: "cat_labour_labour" },
  { key: "helper", label: "Helper", labelHi: "हेल्पर", expenseCategoryId: "cat_labour_helpers" },
  { key: "operator", label: "Operator", labelHi: "ऑपरेटर", expenseCategoryId: "cat_labour_helpers" },
  { key: "driver", label: "Driver", labelHi: "ड्राइवर", expenseCategoryId: "cat_labour_helpers" },
  { key: "electrician", label: "Electrician", labelHi: "इलेक्ट्रीशियन", expenseCategoryId: "cat_labour_labour" },
  { key: "plumber", label: "Plumber", labelHi: "प्लंबर", expenseCategoryId: "cat_labour_labour" },
  { key: "carpenter", label: "Carpenter", labelHi: "बढ़ई", expenseCategoryId: "cat_labour_labour" },
  { key: "bar_bender", label: "Bar-bender", labelHi: "सरिया बाँधने वाला", expenseCategoryId: "cat_labour_labour" },
  { key: "supervisor", label: "Supervisor", labelHi: "सुपरवाइज़र", expenseCategoryId: "cat_labour_labour" },
  { key: "thekedar", label: "Thekedar", labelHi: "ठेकेदार", expenseCategoryId: "cat_labour_thekedar" },
  { key: "other", label: "Other", labelHi: "अन्य", expenseCategoryId: "cat_labour_labour" },
] as const;

/** Rate fields only finance roles may set (D-32). */
export const WORKER_RATE_FIELDS = ["defaultPayType", "defaultRatePaise", "otRatePaise", "isThekedar"] as const;

export interface WorkerInput {
  name: string;
  phone?: string;
  role: string;
  thekedarId?: string | null;
  isThekedar?: boolean;
  defaultPayType?: Worker["defaultPayType"];
  defaultRatePaise?: number;
  otRatePaise?: number | null;
  /** Overtime as a multiplier of the hourly rate, in basis points (15000 = 1.5×). */
  otMultiplierBp?: number | null;
  /** Monthly salary for staff on pay type "monthly". */
  monthlySalaryPaise?: number | null;
  joiningDate?: string;
  active?: boolean;
  emergencyContact?: string;
  photoPath?: string | null;
}

export function workerRoles(store: MemoryStore): { key: string; label: string; labelHi?: string; active?: boolean }[] {
  const s = store.get<{ workerRoles?: { key: string; label: string; labelHi?: string; active?: boolean }[] }>("settings", "operations");
  return s?.workerRoles?.length ? s.workerRoles : [...DEFAULT_WORKER_ROLES];
}

export function saveWorker(store: MemoryStore, id: string | null, input: WorkerInput, ctx: CommandCtx): string {
  requireRole(ctx, ["owner", "accountant", "pm"], "add or edit workers");
  const finance = ctx.role === "owner" || ctx.role === "accountant";
  const cur = id ? store.get<Worker>("workers", id) : null;
  if (id && !cur) throw new CommandError("This worker no longer exists.");
  const c = new Checker();
  const name = trimOrEmpty(input.name);
  c.need("name", name.length >= 2, "Enter the worker's name.");
  const phone = trimOrEmpty(input.phone);
  c.need("phone", !phone || !!toStoredPhone(phone), "Enter a 10-digit mobile number, like 98765 43210.");
  c.need("role", workerRoles(store).some((r) => r.key === input.role), "Choose a role.");
  c.need("joiningDate", !input.joiningDate || isDateStr(input.joiningDate), "Enter the joining date.");
  if (input.thekedarId) {
    const t = store.get<Worker>("workers", input.thekedarId);
    c.need("thekedarId", !!t?.isThekedar, "Choose a thekedar from the list.");
  }
  if (finance) {
    c.need("defaultRatePaise", input.defaultRatePaise === undefined || isNonNegInt(input.defaultRatePaise), "Enter the daily rate in rupees.");
    c.need("otRatePaise", input.otRatePaise == null || isNonNegInt(input.otRatePaise), "Enter the overtime rate per hour in rupees.");
    c.need("otMultiplierBp", input.otMultiplierBp == null || (isNonNegInt(input.otMultiplierBp) && input.otMultiplierBp <= 40_000), "Enter a multiplier up to 4×.");
    c.need("monthlySalaryPaise", input.defaultPayType !== "monthly" || (isNonNegInt(input.monthlySalaryPaise) && input.monthlySalaryPaise > 0), "Enter the monthly salary.");
    c.need("defaultPayType", !input.defaultPayType || ["daily", "contract", "monthly"].includes(input.defaultPayType), "Choose daily, contract or monthly.");
  }
  c.throwIfAny();
  const thekedar = input.thekedarId ? store.get<Worker>("workers", input.thekedarId) : null;
  const base: Record<string, unknown> = {
    name, phone: phone ? toStoredPhone(phone) : "", role: input.role, thekedarId: input.thekedarId || null, thekedarName: thekedar?.name ?? null,
    joiningDate: input.joiningDate ?? "", active: input.active ?? true, emergencyContact: trimOrEmpty(input.emergencyContact),
    photoPath: input.photoPath ?? cur?.["photoPath" as keyof Worker] ?? null, searchKeywords: searchKeywords(name, phone),
  };
  // A PM never writes rate fields; they propose through rate_change_requests (D-32).
  if (finance) {
    Object.assign(base, {
      isThekedar: input.isThekedar ?? input.role === "thekedar", defaultPayType: input.defaultPayType ?? "daily",
    });
  } else if (!cur) {
    Object.assign(base, { isThekedar: false });
  }
  const wid = id ?? newId();
  if (cur) store.merge("workers", wid, { ...base, ...stampUpdate(ctx) });
  else store.set("workers", { id: wid, ...base, ...stampCreate(ctx) } as Doc);
  // Rates live in the finance-only pay document, never on the master a PM can read (rule A, D-32).
  const payKeys = ["defaultRatePaise", "otRatePaise", "otMultiplierBp", "monthlySalaryPaise"] as const;
  if (finance && (payKeys.some((k) => input[k] !== undefined) || !cur)) {
    const prev = store.get<Record<string, number | null>>(`workers/${wid}/private`, "pay");
    const pick = (k: (typeof payKeys)[number]) => (input[k] !== undefined ? input[k] : prev?.[k] ?? null);
    store.set(`workers/${wid}/private`, {
      id: "pay", defaultRatePaise: pick("defaultRatePaise") ?? 0, otRatePaise: pick("otRatePaise"), otMultiplierBp: pick("otMultiplierBp"),
      monthlySalaryPaise: pick("monthlySalaryPaise"), ...stampUpdate(ctx),
    } as Doc);
  }
  // Roster snapshots follow the worker (D-33).
  for (const pid of store.list<{ id: string }>("projects").map((p) => p.id)) {
    if (store.get(`projects/${pid}/roster`, wid)) store.merge(`projects/${pid}/roster`, wid, rosterSnapshot(store.get<Worker>("workers", wid)!));
  }
  return wid;
}

export interface KycInput {
  address?: string;
  idProofType?: "aadhaar_masked" | "voter_id" | "driving_licence" | "other";
  /** Only the last 4 digits of the ID are stored (D-22). */
  idProofLast4?: string;
  /** The uploader confirms the Aadhaar copy shows only the last 4 digits. */
  maskedConfirmed?: boolean;
  idProofPath?: string | null;
  bankAccountNo?: string;
  ifsc?: string;
  upiId?: string;
  pan?: string;
  gstin?: string;
  tdsRateBp?: number | null;
}

/** KYC subdocument: owner and accountant only; masked Aadhaar only (D-22). */
export function saveKyc(store: MemoryStore, workerId: string, input: KycInput, ctx: CommandCtx): void {
  requireRole(ctx, ["owner", "accountant"], "see or change ID and bank details");
  const w = store.get<Worker>("workers", workerId);
  if (!w) throw new CommandError("This worker no longer exists.");
  const c = new Checker();
  const last4 = trimOrEmpty(input.idProofLast4);
  c.need("idProofLast4", !last4 || /^\d{4}$/.test(last4), "Enter only the last 4 digits of the ID number.");
  if (input.idProofType === "aadhaar_masked" && (input.idProofPath || last4)) {
    c.need("maskedConfirmed", input.maskedConfirmed === true,
      "Upload a masked Aadhaar: the first 8 digits must be hidden. Tick the box to confirm the copy is masked.");
  }
  const ifsc = trimOrEmpty(input.ifsc).toUpperCase();
  c.need("ifsc", !ifsc || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc), "An IFSC has 11 characters, like SBIN0001234.");
  const acct = trimOrEmpty(input.bankAccountNo);
  c.need("bankAccountNo", !acct || /^\d{9,18}$/.test(acct), "Enter the account number, digits only.");
  const pan = trimOrEmpty(input.pan).toUpperCase();
  c.need("pan", !pan || isPan(pan), "A PAN has 10 characters, like ABCDE1234F.");
  c.need("tdsRateBp", input.tdsRateBp == null || (isNonNegInt(input.tdsRateBp) && input.tdsRateBp <= 3000), "Enter the TDS rate as a percentage.");
  c.throwIfAny();
  store.merge(`workers/${workerId}/private`, "kyc", {
    address: trimOrEmpty(input.address), idProofType: input.idProofType ?? null, idProofNumberMasked: last4 || null,
    maskedConfirmed: input.maskedConfirmed === true, idProofPath: input.idProofPath ?? null,
    bank: acct || ifsc ? { accountNo: acct, ifsc } : null, upiId: trimOrEmpty(input.upiId) || null,
    pan: pan || null, gstin: trimOrEmpty(input.gstin).toUpperCase() || null,
    tdsSection: w.isThekedar ? "194C" : null,
    // Default 194C rates (defaults-applied D15): 1% individual, 20% without PAN.
    tdsRateBp: w.isThekedar ? input.tdsRateBp ?? (pan ? 100 : 2000) : null,
    ...stampUpdate(ctx),
  });
}

/** PM proposal for a rate (D-32). */
export function requestRateChange(store: MemoryStore, input: { workerId: string; projectId: string | null; proposedRatePaise: number; proposedOtRatePaise?: number; reason: string; effectiveFrom?: string }, ctx: CommandCtx): string {
  requireRole(ctx, ["owner", "accountant", "pm"], "propose wage rates");
  if (input.projectId) requireAssigned(ctx, input.projectId, "propose rates there");
  const c = new Checker();
  c.need("proposedRatePaise", isNonNegInt(input.proposedRatePaise) && input.proposedRatePaise > 0, "Enter the proposed daily rate.");
  c.need("reason", trimOrEmpty(input.reason).length > 2, "Say why the rate should change.");
  c.throwIfAny();
  const w = store.get<Worker>("workers", input.workerId);
  if (!w) throw new CommandError("This worker no longer exists.");
  const id = newId();
  store.set("rate_change_requests", {
    id, workerId: w.id, workerName: w.name, projectId: input.projectId, proposedRatePaise: input.proposedRatePaise,
    proposedOtRatePaise: input.proposedOtRatePaise ?? null, effectiveFrom: input.effectiveFrom ?? null, reason: trimOrEmpty(input.reason),
    requestedBy: ctx.uid, approvalStatus: "pending", ...stampCreate(ctx),
  } as Doc);
  return id;
}

/** Add or remove a worker from a site roster (D-33). Membership only; snapshots come from the worker. */
export function setRoster(store: MemoryStore, projectId: string, workerId: string, active: boolean, ctx: CommandCtx): void {
  requireRole(ctx, ["owner", "accountant", "pm"], "change who works on a site");
  requireAssigned(ctx, projectId, "change its workers");
  const w = store.get<Worker>("workers", workerId);
  if (!w) throw new CommandError("This worker no longer exists.");
  if (w.isThekedar) throw new CommandError("A thekedar isn't marked on attendance; add their workers instead.");
  const cur = store.get(`projects/${projectId}/roster`, workerId);
  if (cur) {
    store.merge(`projects/${projectId}/roster`, workerId, active
      ? { active: true, removedBy: null, removedAt: null, ...stampUpdate(ctx) }
      : { active: false, removedBy: ctx.uid, removedAt: ctx.nowIso, ...stampUpdate(ctx) });
  } else if (active) {
    store.set(`projects/${projectId}/roster`, { id: workerId, projectId, active: true, addedBy: ctx.uid, addedAt: ctx.nowIso, ...rosterSnapshot(w) } as Doc);
  }
  // Mirror active sites onto the worker for list filters (server-maintained, like users.projectIds).
  const sites = new Set((w as Worker & { siteIds?: string[] }).siteIds ?? []);
  if (active) sites.add(projectId); else sites.delete(projectId);
  store.merge("workers", workerId, { siteIds: [...sites] });
  if (w.thekedarId) syncCrewSites(store, w.thekedarId);
}

/** A thekedar's crewSiteIds: every site where one of their crew is on the active roster (QA N10). */
export function syncCrewSites(store: MemoryStore, thekedarId: string): void {
  const sites = new Set<string>();
  for (const p of store.list<{ id: string }>("projects")) {
    if (store.list<{ active: boolean; thekedarId?: string | null }>(`projects/${p.id}/roster`).some((r) => r.active && r.thekedarId === thekedarId)) sites.add(p.id);
  }
  store.merge("workers", thekedarId, { crewSiteIds: [...sites] });
}

// ---------- users and roles (§2, D-05) ----------

export function createUser(store: MemoryStore, input: { name: string; email?: string; phone?: string; role: Role }, ctx: CommandCtx): string {
  requireRole(ctx, ["owner"], "add users");
  const c = new Checker();
  const name = trimOrEmpty(input.name);
  c.need("name", name.length >= 2, "Enter the person's name.");
  c.need("role", (ROLES as readonly string[]).includes(input.role), "Choose a role.");
  const email = trimOrEmpty(input.email);
  const phone = trimOrEmpty(input.phone);
  c.need("email", !email || isEmail(email), "Enter an email address like name@example.com.");
  c.need("phone", !phone || !!toStoredPhone(phone), "Enter a 10-digit mobile number.");
  c.need("email", !!email || !!phone, "Enter an email (office staff) or a phone (site staff) so they can sign in.");
  c.throwIfAny();
  const id = newId();
  store.set("users", {
    id, name, email, phone: phone ? toStoredPhone(phone) : "", role: input.role, active: true, language: "en", theme: "system", projectIds: [],
    ...stampCreate(ctx),
  } as Doc);
  return id;
}

/** setRole callable: owner only; sets the claim and the users mirror together (D-05). */
/** Active owners who are super users (D-48). */
function activeSuperUsers(store: MemoryStore): User[] {
  return store.list<User>("users", (x) => x.superUser === true && x.active && x.role === "owner", { field: "superUser", value: true });
}

/** There must always be one super user, or nobody could open Setup & integrations. */
function keepASuperUser(store: MemoryStore, leaving: string, message: string): void {
  const u = store.get<User>("users", leaving);
  if (u?.superUser && activeSuperUsers(store).filter((x) => x.id !== leaving).length === 0) throw new CommandError(message);
}

/** Grant or revoke super user (D-48): super users only; the person must be an active owner; never the last one. */
export function setSuperUser(store: MemoryStore, userId: string, superUser: boolean, ctx: CommandCtx): void {
  if (!ctx.superUser) throw new CommandError("Only a super user can do this.");
  const u = store.get<User>("users", userId);
  if (!u) throw new CommandError("This user no longer exists.");
  if (superUser && (u.role !== "owner" || !u.active)) throw new CommandError("Only an active owner can be a super user.");
  if (!superUser) keepASuperUser(store, userId, "There must be at least one super user. Make someone else a super user first.");
  store.merge("users", userId, { superUser, ...stampUpdate(ctx) });
}

export function setUserRole(store: MemoryStore, userId: string, role: Role, ctx: CommandCtx): void {
  requireRole(ctx, ["owner"], "change roles");
  if (!(ROLES as readonly string[]).includes(role)) throw new CommandError("Choose a role.");
  const u = store.get<User>("users", userId);
  if (!u) throw new CommandError("This user no longer exists.");
  if (userId === ctx.uid && role !== "owner" && store.list<User>("users", (x) => x.role === "owner" && x.active, { field: "role", value: "owner" }).length <= 1) {
    throw new CommandError("You're the only owner. Make someone else an owner before changing your own role.");
  }
  if (role !== "owner") keepASuperUser(store, userId, "This person is the only super user. Make someone else a super user first.");
  store.merge("users", userId, { role, ...(role !== "owner" && u.superUser ? { superUser: false } : {}), ...stampUpdate(ctx) });
}

export function setUserActive(store: MemoryStore, userId: string, active: boolean, ctx: CommandCtx): void {
  requireRole(ctx, ["owner"], "turn users on or off");
  if (userId === ctx.uid && !active) throw new CommandError("You can't turn off your own access.");
  if (!active) keepASuperUser(store, userId, "This person is the only super user. Make someone else a super user first.");
  store.merge("users", userId, { active, ...stampUpdate(ctx) });
}

/** Assign or unassign a user on a project (owner only, D-06). */
export function setAssignment(store: MemoryStore, projectId: string, userId: string, assigned: boolean, ctx: CommandCtx): void {
  requireRole(ctx, ["owner"], "assign people to projects");
  const p = store.get<{ assignedUsers: string[] }>("projects", projectId);
  if (!p) throw new CommandError("This project no longer exists.");
  const next = assigned ? [...new Set([...p.assignedUsers, userId])] : p.assignedUsers.filter((x) => x !== userId);
  store.merge("projects", projectId, { assignedUsers: next, ...stampUpdate(ctx) });
  syncUserProjects(store, projectId, next);
}

// ---------- settings ----------

const SETTINGS_WRITERS: Record<string, readonly Role[]> = {
  company: ["owner"], operations: ["owner"], numbering: ["owner"], deductionHeads: ["owner"], bank: ["owner", "accountant"], templates: ["owner", "accountant"],
};

export function updateSettings(store: MemoryStore, docId: string, patch: Record<string, unknown>, ctx: CommandCtx): void {
  const writers = SETTINGS_WRITERS[docId];
  if (!writers) throw new CommandError("Unknown settings.");
  requireRole(ctx, writers, "change these settings");
  if (docId === "operations") {
    const c = new Checker();
    const nonNeg = (k: string) => patch[k] === undefined || isNonNegInt(patch[k]);
    c.need("attendanceLockDays", nonNeg("attendanceLockDays") && ((patch.attendanceLockDays as number | undefined) ?? 1) <= 31, "Enter 0 to 31 days.");
    for (const k of ["missingBillThresholdPaise", "pmApprovalLimitPaise", "autoApproveLimitPaise", "leadFollowUpHours", "emdRefundAlertDays", "shareLinkDays"]) {
      c.need(k, nonNeg(k), "Enter a whole number, zero or more.");
    }
    if (Array.isArray(patch.workerRoles)) {
      const keys = (patch.workerRoles as { key: string; label: string }[]).map((r) => r.key);
      c.need("workerRoles", keys.length === new Set(keys).size && (patch.workerRoles as { key: string; label: string }[]).every((r) => trimOrEmpty(r.label)), "Each role needs a name, and names must be different.");
    }
    c.throwIfAny();
  }
  store.merge("settings", docId, { ...patch, ...stampUpdate(ctx) });
}
