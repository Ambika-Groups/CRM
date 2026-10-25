/**
 * Labour commands (spec §6.2–§6.5): marking attendance with the lock window (D-25) and last-write-wins plus
 * audit; owner unlock; per-project pay terms; wage, advance, bonus and thekedar payments created pending and
 * approved through the approval path (D-30, D13 limits; D-45: finance only); payout batches; thekedar
 * contracts and measurements with the contract-value guard (§8A.6).
 */
import { markAttendance, approveWorkerPayment } from "../actions";
import { addDays, daysBetween, fyOf, isDateStr, monthKeyOf, todayIST } from "../dates";
import { mulDivRound } from "../money";
import type {
  Account, Attendance, AttendanceStatus, ContractMeasurement, PaymentMode, Project, ProjectTerms, RosterEntry, ThekedarContract, Worker, WorkerPayment,
} from "../model";
import type { Doc, MemoryStore } from "../store";
import { contractPosition, default194CRateBp, emptyBalance, exceedsContract, ledgerFigures, tds194C, validateWorkerPayment, type WorkerBalance } from "../wages";
import { Checker, CommandError, isNonNegInt, newId, requireAssigned, requireRole, stampCreate, stampUpdate, trimOrEmpty, type CommandCtx } from "./common";

const STAFF = ["owner", "accountant", "pm", "supervisor"] as const;
const FINANCE = ["owner", "accountant"] as const;
const STATUSES: readonly AttendanceStatus[] = ["present", "half_day", "absent", "overtime", "leave"];

function operations(store: MemoryStore) {
  return store.get<{ attendanceLockDays?: number; autoApproveLimitPaise?: number }>("settings", "operations") ?? {};
}

/** The server's date for this request (D-25): the lock is measured on server time, never the phone's clock. */
export function serverToday(ctx: Pick<CommandCtx, "nowIso">): string {
  return todayIST(new Date(ctx.nowIso));
}

export interface LockState { locked: boolean; future: boolean; lockDays: number; unlockedUntil: string | null; daysOld: number }

/** Whether a day's attendance can still be changed (§6.3 "lock after N days", D-25; owner unlock). */
export function attendanceLock(store: MemoryStore, projectId: string, date: string, ctx: Pick<CommandCtx, "nowIso">): LockState {
  const lockDays = operations(store).attendanceLockDays ?? 3;
  const today = serverToday(ctx);
  const daysOld = daysBetween(date, today);
  const unlock = store.get<{ until: string }>("attendance_unlocks", `${projectId}_${date}`);
  const unlockedUntil = unlock && unlock.until > ctx.nowIso ? unlock.until : null;
  return { locked: daysOld > lockDays && !unlockedUntil, future: date > today, lockDays, unlockedUntil, daysOld };
}

export interface MarkInput { workerId: string; status: AttendanceStatus; otHoursMilli?: number }
export interface CheckinInput { selfieDataUrl?: string | null; lat?: number | null; lng?: number | null; accuracyM?: number | null }

/**
 * Save a day's attendance for one site (§6.3). Every changed mark is written with last-write-wins and an
 * audit entry; when someone else changed the mark after this person loaded the day (`loadedAt`), the
 * audit entry names the overwritten change.
 */
export async function markAttendanceDay(store: MemoryStore, input: { projectId: string; date: string; marks: MarkInput[]; loadedAt?: string | null; checkin?: CheckinInput | null }, ctx: CommandCtx) {
  requireRole(ctx, STAFF, "mark attendance");
  requireAssigned(ctx, input.projectId, "mark attendance here");
  const project = store.get<Project>("projects", input.projectId);
  if (!project) throw new CommandError("This project no longer exists.");
  if (!isDateStr(input.date)) throw new CommandError("Choose the date.");
  const lock = attendanceLock(store, input.projectId, input.date, ctx);
  if (lock.future) throw new CommandError("Attendance can't be marked for a future date.");
  if (lock.locked && ctx.role !== "owner") {
    throw new CommandError(`This day is locked. Attendance can be changed for ${lock.lockDays} days; ask the owner to unlock it.`, { lock: "locked" });
  }
  const c = new Checker();
  if (project.attendanceRequiresSelfie) c.need("selfie", !!input.checkin?.selfieDataUrl, "Take a selfie at the site to save attendance.");
  if (project.attendanceRequiresGps) c.need("gps", input.checkin?.lat != null && input.checkin?.lng != null, "Allow location so the site check-in can be saved.");
  const roster = new Map(store.list<RosterEntry>(`projects/${input.projectId}/roster`).filter((r) => r.active).map((r) => [r.id, r]));
  for (const m of input.marks) {
    c.need(`w_${m.workerId}`, roster.has(m.workerId), "This worker isn't on the site's list.");
    c.need(`w_${m.workerId}`, STATUSES.includes(m.status), "Choose present, half day, absent, overtime or leave.");
    if (m.status === "overtime") c.need(`w_${m.workerId}`, isNonNegInt(m.otHoursMilli) && m.otHoursMilli > 0 && m.otHoursMilli <= 12_000, "Enter overtime hours, up to 12.");
  }
  c.throwIfAny();

  let saved = 0, unchanged = 0;
  const conflicts: { workerId: string; overwrote: string }[] = [];
  for (const m of input.marks) {
    const id = `${input.projectId}_${m.workerId}_${input.date}`;
    const prev = store.get<Attendance>("attendance", id);
    const ot = m.status === "overtime" ? m.otHoursMilli ?? 0 : 0;
    if (prev && prev.status === m.status && (prev.otHoursMilli ?? 0) === ot) { unchanged++; continue; }
    const r = roster.get(m.workerId)!;
    // Last write wins (§6.3); a change made by someone else after this person loaded the day is recorded.
    const overwrote = prev && input.loadedAt && (prev.markedAt ?? "") > input.loadedAt && prev.markedBy !== ctx.uid ? prev.markedBy : null;
    if (overwrote) conflicts.push({ workerId: m.workerId, overwrote });
    await markAttendance(store, {
      projectId: input.projectId, projectName: project.name, workerId: m.workerId, workerName: r.workerName, workerRole: r.workerRole,
      thekedarId: r.thekedarId ?? null, date: input.date, status: m.status, otHoursMilli: ot, markedBy: ctx.uid,
    }, { uid: ctx.uid, nowIso: ctx.nowIso });
    store.set("audit_log", {
      id: newId(), entity: "attendance", entityId: id, projectId: input.projectId, action: prev ? "update" : "create",
      before: prev ? { status: prev.status, otHoursMilli: prev.otHoursMilli ?? 0, markedBy: prev.markedBy, markedAt: prev.markedAt ?? null } : null,
      after: { status: m.status, otHoursMilli: ot }, by: ctx.uid, at: ctx.nowIso, overwrote,
      note: overwrote ? "Saved over a change made after this person loaded the day (last write wins)." : null,
    } as Doc);
    saved++;
  }
  if (input.checkin && (input.checkin.selfieDataUrl || input.checkin.lat != null)) {
    store.set("attendance_checkins", {
      id: `${input.projectId}_${input.date}_${ctx.uid}`, projectId: input.projectId, date: input.date, by: ctx.uid, at: ctx.nowIso,
      selfieDataUrl: input.checkin.selfieDataUrl ?? null, lat: input.checkin.lat ?? null, lng: input.checkin.lng ?? null, accuracyM: input.checkin.accuracyM ?? null,
    } as Doc);
  }
  return { saved, unchanged, conflicts };
}

/** Owner unlock of a locked day for 24 hours, with a reason (§6.3, D-25). */
export function unlockAttendanceDay(store: MemoryStore, input: { projectId: string; date: string; reason: string }, ctx: CommandCtx) {
  requireRole(ctx, ["owner"], "unlock attendance");
  const reason = trimOrEmpty(input.reason);
  if (reason.length < 3) throw new CommandError("Say why the day is being unlocked.", { reason: "Say why the day is being unlocked." });
  const until = new Date(Date.parse(ctx.nowIso) + 24 * 3600 * 1000).toISOString();
  store.set("attendance_unlocks", { id: `${input.projectId}_${input.date}`, projectId: input.projectId, date: input.date, until, reason, by: ctx.uid, at: ctx.nowIso } as Doc);
  store.set("audit_log", { id: newId(), entity: "attendance_unlocks", entityId: `${input.projectId}_${input.date}`, projectId: input.projectId, action: "unlock", after: { until, reason }, by: ctx.uid, at: ctx.nowIso } as Doc);
  return until;
}

/** A different pay type and rate on one project (§6.2). Finance only (D-32, rule A). */
export function saveProjectTerms(store: MemoryStore, input: { workerId: string; projectId: string } & Omit<ProjectTerms, "id">, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "set pay terms");
  const c = new Checker();
  c.need("payType", ["daily", "contract", "monthly"].includes(input.payType), "Choose daily, contract or monthly.");
  if (input.payType === "daily") c.need("ratePaise", isNonNegInt(input.ratePaise) && input.ratePaise > 0, "Enter the daily rate.");
  if (input.payType === "monthly") c.need("monthlySalaryPaise", isNonNegInt(input.monthlySalaryPaise) && input.monthlySalaryPaise > 0, "Enter the monthly salary.");
  c.need("otRatePaise", input.otRatePaise == null || isNonNegInt(input.otRatePaise), "Enter the overtime rate in rupees.");
  c.need("otMultiplierBp", input.otMultiplierBp == null || (isNonNegInt(input.otMultiplierBp) && input.otMultiplierBp <= 40_000), "Enter a multiplier up to 4×.");
  c.throwIfAny();
  if (!store.get("workers", input.workerId)) throw new CommandError("This worker no longer exists.");
  const { workerId, projectId, ...terms } = input;
  store.set(`workers/${workerId}/project_terms`, { id: projectId, ...terms, ...stampUpdate(ctx) } as Doc);
}

// ---------- payments (§6.4) ----------

export interface PaymentInput {
  workerId: string;
  projectId: string;
  date: string;
  type: WorkerPayment["type"];
  grossPaise: number;
  advanceRecoveredPaise?: number;
  mode: PaymentMode;
  accountId: string | null;
  reference?: string;
  remarks?: string;
  contractId?: string | null;
  payoutBatchId?: string | null;
}

export function balanceOf(store: MemoryStore, workerId: string, projectId: string): WorkerBalance {
  return { ...emptyBalance(), ...(store.get<Partial<WorkerBalance>>("worker_balances", `${workerId}_${projectId}`) ?? {}) };
}

/** Gross paid on a contract so far, counting payments still waiting for approval. */
function contractPaid(store: MemoryStore, contractId: string): number {
  return store.list<WorkerPayment>("worker_payments", (p) => p.contractId === contractId && p.approvalStatus !== "rejected" && !p.isDeleted, { field: "contractId", value: contractId })
    .reduce((s, p) => s + p.grossPaise, 0);
}

/** Who may approve a payment: the owner always; the accountant only up to the limit and never above a contract (D13, D-30, §8A.6). */
export function canApprovePayment(store: MemoryStore, p: WorkerPayment, ctx: Pick<CommandCtx, "role" | "uid">): boolean {
  if (ctx.role === "owner") return true;
  const limit = operations(store).autoApproveLimitPaise ?? 2_500_000;
  return ctx.role === "accountant" && !p.needsOwnerApproval && p.grossPaise <= limit && p.createdBy !== ctx.uid;
}

/**
 * Record a wage, advance, bonus, thekedar bill or advance write-off (§6.4, §11A.4). Created pending (D-30).
 * An owner's or accountant's own entry within the auto-approve limit is approved at once; a thekedar bill
 * that takes its contract above the contract value always waits for the owner (§8A.6).
 */
export async function createWorkerPayment(store: MemoryStore, input: PaymentInput, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "record payments to workers");
  const worker = store.get<Worker>("workers", input.workerId);
  const project = store.get<Project>("projects", input.projectId);
  const c = new Checker();
  c.need("workerId", !!worker, "Choose the worker or thekedar.");
  c.need("projectId", !!project, "Choose the project.");
  c.need("date", isDateStr(input.date), "Enter the date.");
  c.need("date", !isDateStr(input.date) || input.date <= serverToday(ctx), "A payment can't be dated in the future.");
  c.need("type", ["wage", "advance", "bonus", "thekedar_bill", "advance_writeoff"].includes(input.type), "Choose the payment type.");
  c.need("grossPaise", isNonNegInt(input.grossPaise) && input.grossPaise > 0, "Enter the amount.");
  if (input.type === "advance_writeoff") c.need("type", ctx.role === "owner", "Only the owner can write off an advance.");
  if (input.type === "thekedar_bill") c.need("workerId", !!worker?.isThekedar, "Thekedar bills are paid to a thekedar.");
  const recovered = input.type === "wage" ? input.advanceRecoveredPaise ?? 0 : 0;
  const bal = balanceOf(store, input.workerId, input.projectId);
  const { advanceOutstandingPaise } = ledgerFigures(bal);
  c.need("advanceRecoveredPaise", isNonNegInt(recovered) && recovered <= Math.max(0, advanceOutstandingPaise), "You can't recover more than the advance still outstanding.");
  if (input.type === "advance_writeoff") c.need("grossPaise", input.grossPaise <= Math.max(0, advanceOutstandingPaise), "You can't write off more than the advance still outstanding.");
  const moves = input.type !== "advance_writeoff";
  const account = moves && input.accountId ? store.get<Account>("accounts", input.accountId) : null;
  if (moves) c.need("accountId", !!account && account.active !== false, "Choose which account the money was paid from.");
  let contract: ThekedarContract | null = null;
  if (input.type === "thekedar_bill" && input.contractId) {
    contract = store.get<ThekedarContract>("thekedar_contracts", input.contractId);
    c.need("contractId", !!contract && contract.thekedarId === input.workerId, "Choose one of this thekedar's contracts.");
  }
  c.throwIfAny();

  let tds = 0;
  let tdsSection: string | null = null;
  if (input.type === "thekedar_bill") {
    const kyc = store.get<{ pan?: string | null; tdsRateBp?: number | null }>(`workers/${input.workerId}/private`, "kyc");
    tds = tds194C(input.grossPaise, kyc?.tdsRateBp ?? default194CRateBp(kyc?.pan));
    tdsSection = "194C";
  }
  const net = moves ? input.grossPaise - recovered - tds : 0;
  const draft: WorkerPayment = {
    id: newId(), workerId: input.workerId, workerName: worker!.name, projectId: input.projectId, projectName: project!.name,
    thekedarId: worker!.isThekedar ? worker!.id : worker!.thekedarId ?? null, date: input.date, monthKey: monthKeyOf(input.date), fy: fyOf(input.date),
    type: input.type, grossPaise: input.grossPaise, advanceRecoveredPaise: recovered, tdsPaise: tds, tdsSection, netPaidPaise: net,
    mode: input.mode, accountId: moves ? input.accountId : null, reference: trimOrEmpty(input.reference), remarks: trimOrEmpty(input.remarks),
    payoutBatchId: input.payoutBatchId ?? null, contractId: contract?.id ?? null, needsOwnerApproval: false, ownerApprovalReason: null,
    approvalStatus: "pending", ...stampCreate(ctx),
  };
  const errs = validateWorkerPayment(moves ? draft : { ...draft, accountId: "n/a" });
  if (errs.length) throw new CommandError(errs[0]!);
  if (contract && exceedsContract(contract.valuePaise, contractPaid(store, contract.id), draft.grossPaise)) {
    draft.needsOwnerApproval = true;
    draft.ownerApprovalReason = "This payment takes the contract above its value.";
  }
  store.set("worker_payments", draft as unknown as Doc);
  const limit = operations(store).autoApproveLimitPaise ?? 2_500_000;
  const auto = !draft.needsOwnerApproval && (ctx.role === "owner" || draft.grossPaise <= limit);
  if (auto) await approveWorkerPayment(store, draft.id, { uid: ctx.uid, nowIso: ctx.nowIso });
  return { id: draft.id, approved: auto, needsOwnerApproval: !!draft.needsOwnerApproval };
}

export async function approveWorkerPayments(store: MemoryStore, input: { ids: string[] }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "approve payments");
  let approved = 0;
  for (const id of input.ids) {
    const p = store.get<WorkerPayment>("worker_payments", id);
    if (!p || p.approvalStatus !== "pending") continue;
    if (!canApprovePayment(store, p, ctx)) {
      throw new CommandError(p.needsOwnerApproval ? "Only the owner can approve a payment above the contract value." : "Only the owner can approve this payment.");
    }
    await approveWorkerPayment(store, id, { uid: ctx.uid, nowIso: ctx.nowIso });
    store.set("audit_log", { id: newId(), entity: "worker_payments", entityId: id, action: "approve", by: ctx.uid, at: ctx.nowIso } as Doc);
    approved++;
  }
  return approved;
}

export function rejectWorkerPayment(store: MemoryStore, input: { id: string; reason: string }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "reject payments");
  const p = store.get<WorkerPayment>("worker_payments", input.id);
  if (!p || p.approvalStatus !== "pending") throw new CommandError("Only a payment waiting for approval can be rejected.");
  if (!canApprovePayment(store, p, ctx)) throw new CommandError("Only the owner can reject this payment.");
  const reason = trimOrEmpty(input.reason);
  if (reason.length < 3) throw new CommandError("Say why.", { reason: "Say why the payment is rejected." });
  store.merge("worker_payments", input.id, { approvalStatus: "rejected", rejectReason: reason, approvedBy: ctx.uid, approvedAt: ctx.nowIso });
  store.set("audit_log", { id: newId(), entity: "worker_payments", entityId: input.id, action: "reject", after: { reason }, by: ctx.uid, at: ctx.nowIso } as Doc);
}

/** "Mark paid" on a payout sheet (§6.4): one wage payment per row, in one batch. */
export async function payPayout(store: MemoryStore, input: { projectId: string; to: string; date: string; mode: PaymentMode; accountId: string; rows: { workerId: string; grossPaise: number; recoverPaise: number }[] }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "pay wages");
  const rows = input.rows.filter((r) => r.grossPaise > 0);
  if (!rows.length) throw new CommandError("Nothing to pay on this sheet.");
  const batch = `payout_${input.projectId}_${input.to}`;
  const out: { workerId: string; id: string; approved: boolean }[] = [];
  for (const r of rows) {
    const res = await createWorkerPayment(store, {
      workerId: r.workerId, projectId: input.projectId, date: input.date, type: "wage", grossPaise: r.grossPaise, advanceRecoveredPaise: r.recoverPaise,
      mode: input.mode, accountId: input.accountId, payoutBatchId: batch, remarks: `Payout to ${input.to}`,
    }, ctx);
    out.push({ workerId: r.workerId, id: res.id, approved: res.approved });
  }
  return { batch, payments: out };
}

// ---------- thekedar contracts (§6.2, §6.4) ----------

const UNITS = ["sqft", "sqm", "m", "rmt", "cum", "nos"] as const;

export function saveThekedarContract(store: MemoryStore, input: Omit<ThekedarContract, "id" | "valuePaise" | "status" | "thekedarName" | "projectName"> & { id?: string | null; valuePaise?: number; status?: ThekedarContract["status"] }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "set up thekedar contracts");
  const t = store.get<Worker>("workers", input.thekedarId);
  const project = store.get<Project>("projects", input.projectId);
  const c = new Checker();
  c.need("thekedarId", !!t?.isThekedar, "Choose a thekedar.");
  c.need("projectId", !!project, "Choose the project.");
  c.need("scope", trimOrEmpty(input.scope).length >= 3, "Describe the work this contract covers.");
  c.need("basis", input.basis === "lumpsum" || input.basis === "per_unit", "Choose lump sum or per unit.");
  let value = input.valuePaise ?? 0;
  if (input.basis === "per_unit") {
    c.need("unit", !!input.unit && (UNITS as readonly string[]).includes(input.unit), "Choose the unit.");
    c.need("ratePaise", isNonNegInt(input.ratePaise) && input.ratePaise > 0, "Enter the rate per unit.");
    c.need("qtyMilli", isNonNegInt(input.qtyMilli) && input.qtyMilli > 0, "Enter the quantity in the scope.");
    if (isNonNegInt(input.ratePaise) && isNonNegInt(input.qtyMilli)) value = mulDivRound(input.ratePaise, input.qtyMilli, 1000);
  } else {
    c.need("valuePaise", isNonNegInt(value) && value > 0, "Enter the contract value.");
  }
  const ms = (input.milestones ?? []).filter((m) => trimOrEmpty(m.name));
  c.need("milestones", ms.every((m) => isNonNegInt(m.amountPaise) && m.amountPaise > 0), "Each milestone needs an amount.");
  c.need("milestones", ms.reduce((s, m) => s + m.amountPaise, 0) <= value, "Milestones add up to more than the contract value.");
  c.throwIfAny();
  const id = input.id ?? newId();
  const prev = input.id ? store.get<ThekedarContract>("thekedar_contracts", input.id) : null;
  store.set("thekedar_contracts", {
    ...(prev ?? {}), id, thekedarId: t!.id, thekedarName: t!.name, projectId: project!.id, projectName: project!.name, scope: trimOrEmpty(input.scope),
    basis: input.basis, unit: input.basis === "per_unit" ? input.unit : null, ratePaise: input.basis === "per_unit" ? input.ratePaise : null,
    qtyMilli: input.basis === "per_unit" ? input.qtyMilli : null, valuePaise: value, milestones: ms, status: input.status ?? prev?.status ?? "active",
    ...(prev ? stampUpdate(ctx) : stampCreate(ctx)),
  } as unknown as Doc);
  syncContractScope(store, id);
  return id;
}

/** Rebuild the contract's money-free copy for the PM (QA N10): scope, unit, quantity and work measured. */
export function syncContractScope(store: MemoryStore, contractId: string): void {
  const k = store.get<ThekedarContract>("thekedar_contracts", contractId);
  if (!k) return;
  const ms = store.list<ContractMeasurement>("contract_measurements", (m) => m.contractId === contractId, { field: "contractId", value: contractId });
  store.set("contract_scopes", {
    id: k.id, thekedarId: k.thekedarId, thekedarName: k.thekedarName, projectId: k.projectId, projectName: k.projectName, scope: k.scope,
    basis: k.basis, unit: k.unit ?? null, qtyMilli: k.qtyMilli ?? null,
    measuredQtyMilli: ms.reduce((s, m) => s + (m.qtyMilli ?? 0), 0), measuredPctBp: ms.reduce((s, m) => s + (m.pctBp ?? 0), 0),
    milestoneNames: (k.milestones ?? []).map((m) => m.name), status: k.status,
  } as unknown as Doc);
}

/** Record work measured on a contract: a quantity (per unit) or the share complete (lump sum). */
export function addContractMeasurement(store: MemoryStore, input: { contractId: string; date: string; qtyMilli?: number | null; pctBp?: number | null; note?: string }, ctx: CommandCtx) {
  requireRole(ctx, FINANCE, "record measured work");
  const k = store.get<ThekedarContract>("thekedar_contracts", input.contractId);
  if (!k) throw new CommandError("This contract no longer exists.");
  const c = new Checker();
  c.need("date", isDateStr(input.date) && input.date <= serverToday(ctx), "Enter the date (not in the future).");
  let value = 0;
  if (k.basis === "per_unit") {
    c.need("qtyMilli", isNonNegInt(input.qtyMilli) && input.qtyMilli > 0, "Enter the quantity measured.");
    value = mulDivRound(k.ratePaise ?? 0, input.qtyMilli ?? 0, 1000);
  } else {
    c.need("pctBp", isNonNegInt(input.pctBp) && input.pctBp > 0 && input.pctBp <= 10_000, "Enter the share of work done, up to 100%.");
    value = mulDivRound(k.valuePaise, input.pctBp ?? 0, 10_000);
  }
  c.throwIfAny();
  const id = newId();
  store.set("contract_measurements", {
    id, contractId: k.id, projectId: k.projectId, thekedarId: k.thekedarId, date: input.date, qtyMilli: input.qtyMilli ?? null, pctBp: input.pctBp ?? null,
    valuePaise: value, note: trimOrEmpty(input.note), ...stampCreate(ctx),
  } as unknown as Doc);
  syncContractScope(store, k.id);
  return id;
}

/** Thekedar ledger for one contract (§6.4): value, work measured, paid, TDS and balance. */
export function thekedarLedger(contract: ThekedarContract, measurements: ContractMeasurement[], payments: WorkerPayment[]) {
  const mine = payments.filter((p) => p.contractId === contract.id && p.approvalStatus === "approved" && !p.isDeleted);
  const measured = measurements.filter((m) => m.contractId === contract.id).reduce((s, m) => s + m.valuePaise, 0);
  return contractPosition(contract.valuePaise, measured, mine.reduce((s, p) => s + p.grossPaise, 0), mine.reduce((s, p) => s + (p.tdsPaise ?? 0), 0));
}

// ---------- derived views (pure; the UI passes what the role may read) ----------

export interface PayoutRow {
  workerId: string; workerName: string; role: string;
  days: number; halfDays: number; otHoursMilli: number;
  earnedInPeriodPaise: number; balanceDuePaise: number; advanceOutstandingPaise: number;
  grossPaise: number; recoverPaise: number; netPaise: number;
}

/**
 * The weekly or monthly payout sheet for a site (§6.4): every direct worker with days in the period, what is
 * due now (all unsettled earnings), the advance to recover (up to `recoverCapPaise` each), and the net cash.
 */
export function payoutSheet(roster: RosterEntry[], attendance: Attendance[], balances: Record<string, Partial<WorkerBalance>>, from: string, to: string, recoverCapPaise = 100_000): PayoutRow[] {
  return roster.filter((r) => r.active && !r.thekedarId).map((r) => {
    const mine = attendance.filter((a) => a.workerId === r.id && a.date >= from && a.date <= to);
    const b = { ...emptyBalance(), ...(balances[r.id] ?? {}) };
    const { balanceDuePaise, advanceOutstandingPaise } = ledgerFigures(b);
    const gross = Math.max(0, balanceDuePaise);
    const recover = Math.min(Math.max(0, advanceOutstandingPaise), recoverCapPaise, gross);
    return {
      workerId: r.id, workerName: r.workerName ?? r.id, role: r.workerRole ?? "",
      days: mine.filter((a) => a.status === "present" || a.status === "overtime").length,
      halfDays: mine.filter((a) => a.status === "half_day").length,
      otHoursMilli: mine.reduce((s, a) => s + (a.otHoursMilli ?? 0), 0),
      earnedInPeriodPaise: mine.reduce((s, a) => s + (a.earnedPaise ?? 0), 0),
      balanceDuePaise, advanceOutstandingPaise, grossPaise: gross, recoverPaise: recover, netPaise: gross - recover,
    };
  });
}

/** Default payout period: the week from Monday to Saturday that contains `date` (Sunday off). */
export function payoutWeek(date: string): { from: string; to: string } {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sunday
  const from = addDays(date, d === 0 ? -6 : 1 - d);
  return { from, to: addDays(from, 5) };
}

export interface SheetRow { workerId: string; workerName: string; role: string; days: Record<string, string>; present: number; half: number; absent: number; leave: number; otHoursMilli: number; daysWorked: number }

const CODE: Record<AttendanceStatus, string> = { present: "P", half_day: "H", absent: "A", overtime: "OT", leave: "L" };

/** The monthly attendance sheet (§6.3): one row per worker, a code per day, and totals. */
export function monthlySheet(roster: RosterEntry[], attendance: Attendance[]): SheetRow[] {
  const ids = new Set(roster.map((r) => r.id));
  for (const a of attendance) ids.add(a.workerId);
  return [...ids].map((wid) => {
    const r = roster.find((x) => x.id === wid);
    const mine = attendance.filter((a) => a.workerId === wid);
    const days: Record<string, string> = {};
    for (const a of mine) days[a.date] = CODE[a.status];
    const count = (s: AttendanceStatus) => mine.filter((a) => a.status === s).length;
    const present = count("present") + count("overtime");
    return {
      workerId: wid, workerName: r?.workerName ?? mine[0]?.workerName ?? wid, role: r?.workerRole ?? mine[0]?.workerRole ?? "", days,
      present, half: count("half_day"), absent: count("absent"), leave: count("leave"),
      otHoursMilli: mine.reduce((s, a) => s + (a.otHoursMilli ?? 0), 0), daysWorked: present + count("half_day") / 2,
    };
  }).sort((a, b) => a.workerName.localeCompare(b.workerName));
}

export interface WorkforceRow { workerId: string; name: string; role: string; payType: string; thekedarName: string | null; status: AttendanceStatus | null; otHoursMilli: number; ratePaise?: number | null; paidToDatePaise?: number; balanceDuePaise?: number }

/**
 * Site workforce view for a date (§6.5): who is on site and today's status, with summary counts. Money
 * (rate, paid to date, balance due) is filled only when the caller passes `money`, i.e. for finance roles.
 */
export function siteWorkforce(roster: RosterEntry[], attendance: Attendance[], money?: { balances: Record<string, Partial<WorkerBalance>>; rates: Record<string, number | null> }) {
  const byWorker = new Map(attendance.map((a) => [a.workerId, a]));
  const rows: WorkforceRow[] = roster.filter((r) => r.active).map((r) => {
    const a = byWorker.get(r.id);
    const row: WorkforceRow = {
      workerId: r.id, name: r.workerName ?? r.id, role: r.workerRole ?? "", payType: r.payType ?? "daily", thekedarName: r.thekedarName ?? null,
      status: a?.status ?? null, otHoursMilli: a?.otHoursMilli ?? 0,
    };
    if (money) {
      const b = { ...emptyBalance(), ...(money.balances[r.id] ?? {}) };
      row.ratePaise = money.rates[r.id] ?? null;
      row.paidToDatePaise = b.paidPaise;
      row.balanceDuePaise = r.thekedarId ? 0 : ledgerFigures(b).balanceDuePaise;
    }
    return row;
  });
  const onSite = rows.filter((r) => r.status === "present" || r.status === "overtime" || r.status === "half_day");
  const summary = {
    total: rows.length, present: onSite.length, marked: rows.filter((r) => r.status).length,
    mistri: onSite.filter((r) => r.role === "mistri").length, labour: onSite.filter((r) => r.role === "labour").length,
    helpers: onSite.filter((r) => r.role === "helper").length,
    viaThekedar: onSite.filter((r) => r.thekedarName).length, direct: onSite.filter((r) => !r.thekedarName).length,
  };
  return { rows, summary };
}

/** Per-worker ledger (§6.4): earned, paid, advances and balance due, from the balance and the payments. */
export function workerLedger(balance: Partial<WorkerBalance>, payments: WorkerPayment[]) {
  const b = { ...emptyBalance(), ...balance };
  const f = ledgerFigures(b);
  const entries = payments.filter((p) => !p.isDeleted).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  return { ...b, ...f, entries };
}
