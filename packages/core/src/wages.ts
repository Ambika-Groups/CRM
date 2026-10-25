/**
 * Wages, attendance earnings, advances and settlements (spec §6.2–§6.4, decisions D-16).
 * Daily wage: rate per day; half-day = 50%; overtime = hours × hourly OT rate on top of the day.
 * Settlement: net cash = gross settled − advance recovered − TDS.
 */
import { mulDivRound } from "./money";
import type { AttendanceStatus, WorkerPayment } from "./model";

/** Default hourly overtime rate when none is set: the daily rate ÷ 8 hours (defaults-applied.md). */
export function defaultOtRatePaise(dailyRatePaise: number): number {
  return mulDivRound(dailyRatePaise, 1, 8);
}

/**
 * Hourly overtime rate (§6.2 "overtime per hour or as a multiplier"): a fixed rate per hour if set; otherwise
 * the multiplier on the hourly rate (daily ÷ 8), e.g. 15000 bp = 1.5×; otherwise the daily rate ÷ 8.
 */
export function otHourlyRate(dailyRatePaise: number, o: { otRatePaise?: number | null; otMultiplierBp?: number | null } = {}): number {
  if (o.otRatePaise && o.otRatePaise > 0) return o.otRatePaise;
  if (o.otMultiplierBp && o.otMultiplierBp > 0) return mulDivRound(dailyRatePaise, o.otMultiplierBp, 8 * 10000);
  return defaultOtRatePaise(dailyRatePaise);
}

/** Monthly staff earn their salary ÷ 26 working days per day present (defaults-applied C8). */
export const MONTHLY_WORKING_DAYS = 26;

/**
 * Money earned for one attendance mark. Monthly-salary staff earn nothing per day here; their pay is a
 * monthly settlement.
 */
export function attendanceEarned(
  status: AttendanceStatus,
  payType: "daily" | "contract" | "monthly",
  ratePaise: number,
  otRatePaise: number,
  otHoursMilli = 0,
): number {
  if (otHoursMilli < 0) throw new RangeError("Overtime hours can't be negative");
  // Contract and thekedar work is paid against the contract, not per day (§6.2).
  if (payType === "contract") return 0;
  if (payType === "monthly") {
    // ratePaise is the monthly salary here. Overtime isn't paid to monthly staff; leave and absence are unpaid.
    if (status === "present" || status === "overtime") return mulDivRound(ratePaise, 1, MONTHLY_WORKING_DAYS);
    if (status === "half_day") return mulDivRound(ratePaise, 1, 2 * MONTHLY_WORKING_DAYS);
    return 0;
  }
  switch (status) {
    case "present": return ratePaise;
    case "half_day": return mulDivRound(ratePaise, 1, 2);
    case "overtime": return ratePaise + mulDivRound(otRatePaise, otHoursMilli, 1000);
    case "absent":
    case "leave": return 0;
  }
}

/** Days worked for the wage register: present/overtime = 1, half day = 0.5. */
export function daysWorked(status: AttendanceStatus): number {
  return status === "present" || status === "overtime" ? 1 : status === "half_day" ? 0.5 : 0;
}

export interface WorkerBalance {
  earnedPaise: number;
  paidPaise: number;
  advanceGivenPaise: number;
  advanceRecoveredPaise: number;
  advanceWrittenOffPaise: number;
}

export const emptyBalance = (): WorkerBalance => ({
  earnedPaise: 0, paidPaise: 0, advanceGivenPaise: 0, advanceRecoveredPaise: 0, advanceWrittenOffPaise: 0,
});

/** Balance due to the worker (earned − settled) and advance still outstanding (§6.4 per-worker ledger). */
export function ledgerFigures(b: WorkerBalance) {
  return {
    balanceDuePaise: b.earnedPaise - b.paidPaise,
    advanceOutstandingPaise: b.advanceGivenPaise - b.advanceRecoveredPaise - b.advanceWrittenOffPaise,
  };
}

/** Payable now = earned − already settled − advance to recover (§6.4 auto-calculation), never below zero. */
export function payableNow(b: WorkerBalance, recoverAdvancePaise: number): { grossPaise: number; recoverPaise: number; netPaise: number } {
  const { balanceDuePaise, advanceOutstandingPaise } = ledgerFigures(b);
  const gross = Math.max(0, balanceDuePaise);
  const recover = Math.min(Math.max(0, recoverAdvancePaise), Math.max(0, advanceOutstandingPaise), gross);
  return { grossPaise: gross, recoverPaise: recover, netPaise: gross - recover };
}

/** The checks firestore.rules applies to worker payments (workerPaymentOk), reused by forms and functions. */
export function validateWorkerPayment(p: Pick<WorkerPayment, "type" | "grossPaise" | "netPaidPaise" | "advanceRecoveredPaise" | "tdsPaise" | "mode" | "accountId">): string[] {
  const errs: string[] = [];
  const isInt = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  if (!isInt(p.grossPaise)) errs.push("Enter the amount.");
  if (!isInt(p.netPaidPaise)) errs.push("Net paid must be zero or more.");
  if (!isInt(p.advanceRecoveredPaise ?? 0)) errs.push("Advance recovered must be zero or more.");
  if (!isInt(p.tdsPaise ?? 0)) errs.push("TDS must be zero or more.");
  if (p.mode === "credit") errs.push("Wages can't be paid on credit. Choose cash, UPI, bank or cheque.");
  if (p.netPaidPaise !== p.grossPaise - (p.advanceRecoveredPaise ?? 0) - (p.tdsPaise ?? 0)) {
    errs.push("Net paid must equal the amount minus advance recovered minus TDS.");
  }
  if (p.netPaidPaise > 0 && !p.accountId) errs.push("Choose which account the money was paid from.");
  return errs;
}

/** Labour sub-category for a worker role (settings/operations.workerRoles default mapping). */
export function labourCategoryFor(role: string, viaThekedar: boolean): string {
  if (viaThekedar) return "cat_labour_thekedar";
  const r = role.toLowerCase();
  if (r === "mistri") return "cat_labour_mistri";
  if (["helper", "operator", "driver"].includes(r)) return "cat_labour_helpers";
  return "cat_labour_labour";
}

/** TDS under s.194C on a thekedar payment (default rates, defaults-applied.md; CA to confirm, D15). */
export function tds194C(grossPaise: number, rateBp: number): number {
  return mulDivRound(grossPaise, rateBp, 10000);
}

/** What a thekedar contract stands at (§6.4 thekedar ledger). Balance due = work measured − paid (gross). */
export function contractPosition(valuePaise: number, measuredPaise: number, paidGrossPaise: number, tdsPaise: number) {
  return {
    valuePaise, measuredPaise, paidGrossPaise, tdsPaise, netPaidPaise: paidGrossPaise - tdsPaise,
    balanceDuePaise: measuredPaise - paidGrossPaise,
    remainingContractPaise: valuePaise - paidGrossPaise,
  };
}

/** A payment that would take total payments on a contract above its value needs the owner (§8A.6). */
export function exceedsContract(valuePaise: number, alreadyPaidGrossPaise: number, thisGrossPaise: number): boolean {
  return alreadyPaidGrossPaise + thisGrossPaise > valuePaise;
}

/** Default TDS rate under s.194C when the thekedar's KYC has none: 1% with PAN (individual/HUF), 20% without (D15). */
export function default194CRateBp(pan: string | null | undefined): number {
  return pan && pan.trim() ? 100 : 2000;
}
