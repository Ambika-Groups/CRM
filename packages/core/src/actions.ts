/**
 * Server-side actions shared by demo mode and Cloud Functions: approvals (D-30), generated expenses
 * (D-16), attendance rate snapshots (D-28), roster snapshots (D-33). Each runs against a MemoryStore here;
 * functions/ wraps the same logic in Firestore transactions.
 */
import { fyOf, monthKeyOf } from "./dates";
import type { Attendance, Expense, ProjectTerms, Worker, WorkerPay, WorkerPayment } from "./model";
import type { Doc, MemoryStore } from "./store";
import { attendanceEarned, labourCategoryFor, otHourlyRate } from "./wages";

export interface ActionCtx {
  uid: string;
  nowIso: string;
}

/** Fill server-owned attendance fields from the worker's terms (trigger in Firebase mode). */
export function snapshotAttendance(store: MemoryStore, a: Attendance): Attendance {
  const w = store.get<Worker>("workers", a.workerId);
  const pay = store.get<WorkerPay>(`workers/${a.workerId}/private`, "pay");
  const terms = store.get<ProjectTerms>(`workers/${a.workerId}/project_terms`, a.projectId);
  const payType = (terms?.payType ?? w?.defaultPayType ?? "daily") as Attendance["payType"];
  // Monthly staff: the snapshot rate is the monthly salary. Daily: the day rate (§6.2, D-28).
  const rate = payType === "monthly"
    ? terms?.monthlySalaryPaise ?? pay?.monthlySalaryPaise ?? 0
    : terms?.ratePaise ?? pay?.defaultRatePaise ?? 0;
  const ot = payType === "daily" ? otHourlyRate(rate, terms ?? pay ?? {}) : 0;
  const earned = attendanceEarned(a.status, payType ?? "daily", rate, ot, a.otHoursMilli ?? 0);
  return { ...a, monthKey: monthKeyOf(a.date), fy: fyOf(a.date), payType, rateSnapshotPaise: rate, otRateSnapshotPaise: ot, earnedPaise: earned };
}

/** Write an attendance mark (merge semantics, P1-01) and post it. */
export async function markAttendance(store: MemoryStore, a: Omit<Attendance, "id" | "monthKey" | "fy">, ctx: ActionCtx) {
  const id = `${a.projectId}_${a.workerId}_${a.date}`;
  const prev = store.get<Attendance>("attendance", id);
  const base = { ...(prev ?? {}), ...a, id, monthKey: monthKeyOf(a.date), fy: fyOf(a.date), markedAt: ctx.nowIso } as Attendance;
  // Rate snapshot is taken on the first write and kept afterwards (D-28).
  const snap = prev?.rateSnapshotPaise !== undefined
    ? { ...base, earnedPaise: attendanceEarned(base.status, base.payType ?? "daily", prev.rateSnapshotPaise ?? 0, prev.otRateSnapshotPaise ?? 0, base.otHoursMilli ?? 0) }
    : snapshotAttendance(store, base);
  store.set("attendance", snap as unknown as Doc);
  return store.post("attendance", id, ctx.nowIso);
}

/** The Labour expense generated for an approved wage, bonus or thekedar payment (D-16). */
export function generatedWageExpense(p: WorkerPayment, worker: Worker | null): Expense | null {
  if (!["wage", "bonus", "thekedar_bill", "advance_writeoff"].includes(p.type) || p.grossPaise <= 0) return null;
  const viaThekedar = p.type === "thekedar_bill" || !!worker?.isThekedar;
  return {
    id: `wage_${p.id}`,
    projectId: p.projectId,
    projectName: p.projectName ?? null,
    date: p.date,
    monthKey: monthKeyOf(p.date),
    fy: fyOf(p.date),
    categoryId: labourCategoryFor(worker?.role ?? "labour", viaThekedar),
    description: `${p.type === "thekedar_bill" ? "Thekedar bill" : p.type === "advance_writeoff" ? "Advance written off" : p.type === "bonus" ? "Bonus" : "Wages"}: ${p.workerName ?? ""}`,
    amountPaise: p.grossPaise,
    tdsPaise: p.tdsPaise ?? 0,
    payeeType: "worker",
    payeeId: p.workerId,
    payeeName: p.workerName ?? "",
    mode: p.mode,
    paidStatus: "paid",
    accountId: null, // generated expenses never move money; the payment does
    approvalStatus: "approved",
    approvedBy: "system",
    isDeleted: false,
    source: "wage",
    sourceRef: { entity: "worker_payments", id: p.id },
    enteredBy: "system",
    enteredByName: "System",
  };
}

/** approveRecords callable: approve a worker payment, create its generated expense, post both. */
export async function approveWorkerPayment(store: MemoryStore, id: string, ctx: ActionCtx) {
  const p = store.get<WorkerPayment>("worker_payments", id);
  if (!p) throw new Error("Payment not found");
  if (p.approvalStatus === "approved") return;
  const approved = { ...p, approvalStatus: "approved" as const, approvedBy: ctx.uid, approvedAt: ctx.nowIso };
  const exp = generatedWageExpense(approved, store.get<Worker>("workers", p.workerId));
  if (exp) approved.expenseId = exp.id;
  store.set("worker_payments", approved as unknown as Doc);
  if (exp) {
    store.set("expenses", exp as unknown as Doc);
    await store.post("expenses", exp.id, ctx.nowIso);
  }
  return store.post("worker_payments", id, ctx.nowIso);
}

export async function approveExpense(store: MemoryStore, id: string, ctx: ActionCtx) {
  const e = store.get<Expense>("expenses", id);
  if (!e) throw new Error("Expense not found");
  store.merge("expenses", id, { approvalStatus: "approved", approvedBy: ctx.uid, approvedAt: ctx.nowIso, rejectReason: null });
  return store.post("expenses", id, ctx.nowIso);
}

export async function rejectExpense(store: MemoryStore, id: string, reason: string, ctx: ActionCtx) {
  store.merge("expenses", id, { approvalStatus: "rejected", approvedBy: ctx.uid, approvedAt: ctx.nowIso, rejectReason: reason });
  return store.post("expenses", id, ctx.nowIso);
}

/** Roster snapshot fields (D-33): names and roles, never rates. */
export function rosterSnapshot(worker: Worker): Record<string, unknown> {
  return {
    workerName: worker.name,
    workerRole: worker.role,
    workerPhone: worker.phone ?? "",
    thekedarId: worker.thekedarId ?? null,
    thekedarName: worker.thekedarName ?? null,
    payType: worker.defaultPayType ?? "daily",
  };
}
