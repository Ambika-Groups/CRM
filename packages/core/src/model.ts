/**
 * Entity shapes (docs/data-model.md). Field names are camelCase, collection names snake_case (D-02).
 * Money in paise, rates in basis points, quantities in thousandths (D-01). Business dates are IST strings (D-04).
 * Only the fields used by core logic are typed strictly; documents may carry more.
 */

export const ROLES = ["owner", "accountant", "pm", "supervisor", "viewer", "ca"] as const;
export type Role = (typeof ROLES)[number];

export type PaymentMode = "cash" | "upi" | "bank" | "cheque" | "credit";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Audit {
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  deleteReason?: string;
}

export interface User extends Audit {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  role: Role;
  active: boolean;
  language: "en" | "hi";
  theme: "light" | "dark" | "system";
  projectIds: string[];
  defaultSalesUser?: boolean;
  /** D-48: an owner who may open Setup & integrations. Becomes the `superUser` sign-in claim. */
  superUser?: boolean;
  /** Set by the server whenever the sign-in claims change, so open sessions refresh their token. */
  claimsAt?: string;
}

export interface Client extends Audit {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  stateCode?: string;
  gstin?: string;
  pan?: string;
  type: "individual" | "builder" | "government";
  notes?: string;
}

export type ProjectStatus = "planned" | "in_progress" | "on_hold" | "completed" | "cancelled";

export interface Project extends Audit {
  id: string;
  code: string;
  name: string;
  type: "residential" | "government";
  subtype: string;
  clientId: string;
  clientName: string;
  address?: string;
  city?: string;
  location?: { lat: number; lng: number } | null;
  startDate: string;
  expectedEndDate: string;
  actualEndDate?: string | null;
  status: ProjectStatus;
  isArchived: boolean;
  managerId?: string;
  managerName?: string;
  assignedUsers: string[];
  progressPct: number;
  itcEligible: boolean;
  attendanceRequiresSelfie: boolean;
  attendanceRequiresGps: boolean;
  residential?: Record<string, unknown> | null;
  government?: Record<string, unknown> | null;
}

/** projects/{id}/private/budget */
export interface ProjectBudget { budgetPaise: number; budgetByCategory?: Record<string, number> }
/** projects/{id}/private/commercial */
export interface ProjectCommercial { contractValuePaise: number; [k: string]: unknown }

export type PayType = "daily" | "contract" | "monthly";

export interface Worker extends Audit {
  id: string;
  name: string;
  phone?: string;
  role: string;
  thekedarId?: string | null;
  thekedarName?: string | null;
  isThekedar: boolean;
  defaultPayType?: PayType;
  joiningDate?: string;
  active: boolean;
  emergencyContact?: string;
  /** Sites where the worker is on the roster (server-maintained, D-33). */
  siteIds?: string[];
  /** For a thekedar: sites where their crew is on the roster (server-maintained; lets the PM open the thekedar, QA N10). */
  crewSiteIds?: string[];
  photoPath?: string | null;
}

/**
 * workers/{id}/private/pay: the worker's default wage rates. Owner and accountant only (rule A: PMs and
 * supervisors never see rates; D-32 for writes). Kept off the worker master because Firestore rules can't hide fields.
 */
export interface WorkerPay {
  id: "pay";
  defaultRatePaise: number;
  /** Overtime per hour; empty means the multiplier, or else the daily rate ÷ 8. */
  otRatePaise?: number | null;
  /** Overtime as a multiple of the hourly rate (daily ÷ 8), in basis points: 15000 = 1.5×. */
  otMultiplierBp?: number | null;
  /** Monthly salary for staff on pay type "monthly". */
  monthlySalaryPaise?: number | null;
}

/** workers/{id}/project_terms/{projectId}: a different pay type and rate on one project (§6.2). Finance only. */
export interface ProjectTerms {
  id: string; // projectId
  payType: PayType;
  ratePaise?: number;
  otRatePaise?: number | null;
  otMultiplierBp?: number | null;
  monthlySalaryPaise?: number | null;
  effectiveFrom?: string;
}

/** A thekedar contract for a defined scope (§6.2): lump sum or per unit, with milestones and part payments. */
export interface ThekedarContract extends Audit {
  id: string;
  thekedarId: string;
  thekedarName?: string;
  projectId: string;
  projectName?: string;
  scope: string;
  basis: "lumpsum" | "per_unit";
  unit?: "sqft" | "m" | "rmt" | "cum" | "sqm" | "nos" | null;
  ratePaise?: number | null;
  qtyMilli?: number | null;
  valuePaise: number;
  milestones?: { name: string; amountPaise: number; done?: boolean }[];
  status: "active" | "closed";
}

/**
 * contract_scopes/{contractId}: the contract without money, for the PM of the project (QA N10, D-45): what the
 * thekedar does, in what unit, how much, and how much is measured. Written with the contract and its measurements.
 */
export interface ContractScope {
  id: string;
  thekedarId: string;
  thekedarName?: string;
  projectId: string;
  projectName?: string;
  scope: string;
  basis: "lumpsum" | "per_unit";
  unit?: string | null;
  qtyMilli?: number | null;
  measuredQtyMilli: number;
  measuredPctBp: number;
  milestoneNames: string[];
  status: "active" | "closed";
}

/** Work measured against a thekedar contract: quantity (per unit) or share complete (lump sum). */
export interface ContractMeasurement extends Audit {
  id: string;
  contractId: string;
  projectId: string;
  thekedarId: string;
  date: string;
  qtyMilli?: number | null;
  pctBp?: number | null;
  valuePaise: number;
  note?: string;
}

export interface RosterEntry {
  id: string; // workerId
  projectId: string;
  active: boolean;
  addedBy: string;
  addedAt: string;
  workerName?: string;
  workerRole?: string;
  workerPhone?: string;
  thekedarId?: string | null;
  thekedarName?: string | null;
  payType?: PayType;
}

export type AttendanceStatus = "present" | "half_day" | "absent" | "overtime" | "leave";

export interface Attendance {
  id: string; // {projectId}_{workerId}_{date}
  projectId: string;
  projectName?: string;
  workerId: string;
  workerName?: string;
  workerRole?: string;
  thekedarId?: string | null;
  date: string;
  monthKey: string;
  fy: string;
  status: AttendanceStatus;
  otHoursMilli?: number;
  payType?: PayType;
  rateSnapshotPaise?: number;
  otRateSnapshotPaise?: number;
  earnedPaise?: number;
  markedBy: string;
  markedAt?: string;
}

export interface Expense extends Audit {
  id: string;
  projectId: string | null;
  projectName?: string | null;
  date: string;
  monthKey: string;
  fy: string;
  categoryId: string;
  categoryPath?: string[];
  description?: string;
  qtyMilli?: number;
  unit?: string;
  ratePaise?: number;
  amountPaise: number;
  taxablePaise?: number;
  gstRateBp?: number;
  cgstPaise?: number;
  sgstPaise?: number;
  igstPaise?: number;
  tdsPaise?: number;
  payeeType?: "worker" | "vendor" | "other";
  payeeId?: string | null;
  payeeName?: string;
  partyGstin?: string;
  mode: PaymentMode;
  paidStatus?: "paid" | "unpaid" | "part";
  accountId?: string | null;
  billNo?: string;
  billDate?: string;
  billPaths?: string[];
  noBillReason?: string;
  approvalStatus: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  source: "manual" | "wage" | "purchase" | "machinery_rent" | "stock_transfer" | "bank_charge" | "fuel" | "maintenance";
  sourceRef?: { entity: string; id: string } | null;
  voucherNo?: string | null;
  enteredBy: string;
  enteredByName?: string;
  postingError?: string | null;
}

export type WorkerPaymentType = "wage" | "advance" | "bonus" | "advance_writeoff" | "thekedar_bill";

export interface WorkerPayment extends Audit {
  id: string;
  workerId: string;
  workerName?: string;
  projectId: string;
  projectName?: string;
  thekedarId?: string | null;
  date: string;
  monthKey: string;
  fy: string;
  type: WorkerPaymentType;
  grossPaise: number;
  advanceRecoveredPaise?: number;
  tdsPaise?: number;
  tdsSection?: string | null;
  netPaidPaise: number;
  mode: PaymentMode;
  accountId?: string | null;
  reference?: string;
  remarks?: string;
  payoutBatchId?: string | null;
  approvalStatus: ApprovalStatus;
  expenseId?: string | null;
  voucherNo?: string | null;
  /** Thekedar bill against a contract. */
  contractId?: string | null;
  /** Set when the payment takes a contract above its value: only the owner may approve (§8A.6). */
  needsOwnerApproval?: boolean;
  ownerApprovalReason?: string | null;
  rejectReason?: string | null;
}

export interface Account extends Audit {
  id: string;
  name: string;
  type: "cash" | "bank" | "upi";
  bankName?: string;
  last4?: string;
  openingBalancePaise: number;
  openingDate: string;
  active: boolean;
  balancePaise?: number;
}

export interface AccountTransfer extends Audit {
  id: string;
  kind: "transfer" | "drawing" | "capital" | "loan_in" | "loan_repay";
  fromAccountId?: string | null;
  toAccountId?: string | null;
  amountPaise: number;
  date: string;
  monthKey: string;
  fy: string;
  narration?: string;
  approvalStatus?: ApprovalStatus;
}

export type InvoiceType = "proforma" | "tax" | "ra" | "milestone" | "credit_note" | "debit_note";
export type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";

export interface InvoiceItem {
  description: string;
  hsnSac?: string;
  unit?: string;
  qtyMilli: number;
  ratePaise: number;
  discountBp?: number;
  gstRateBp: number;
}

export interface Invoice extends Audit {
  id: string;
  number: string | null;
  type: InvoiceType;
  projectId: string;
  projectName?: string;
  clientId: string;
  clientName?: string;
  clientGstin?: string;
  date: string;
  dueDate: string;
  monthKey: string;
  fy: string;
  placeOfSupply: string;
  items: InvoiceItem[];
  totals?: { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; roundOffPaise: number; totalPaise: number };
  deductions?: { head: string; basisPaise: number; rateBp: number; amountPaise: number }[];
  netReceivablePaise?: number;
  status: InvoiceStatus;
  paidPaise?: number;
  raBillId?: string | null;
  milestoneId?: string | null;
}

export interface PaymentReceived extends Audit {
  id: string;
  invoiceId?: string | null;
  projectId: string;
  projectName?: string;
  clientId: string;
  clientName?: string;
  date: string;
  monthKey: string;
  fy: string;
  amountPaise: number;
  tdsPaise?: number;
  retentionPaise?: number;
  otherDeductionsPaise?: number;
  mode: PaymentMode;
  accountId: string;
  reference?: string;
  isAdvance?: boolean;
  receiptNo?: string | null;
}

export interface AccountTxn {
  id: string;
  accountId: string;
  date: string;
  monthKey: string;
  fy: string;
  type: "receipt" | "payment" | "transfer" | "drawing" | "capital" | "loan_in" | "loan_out" | "adjustment";
  directionSign: 1 | -1;
  amountPaise: number;
  linkedEntity: string;
  linkedId: string;
  projectId?: string | null;
  partyName?: string;
  narration?: string;
  voucherNo?: string | null;
  postedAt?: string;
}

export interface Vendor extends Audit {
  id: string;
  name: string;
  type: string;
  phone?: string;
  gstin?: string;
  pan?: string;
  address?: string;
  stateCode?: string;
}
