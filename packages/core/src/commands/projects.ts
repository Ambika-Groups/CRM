/**
 * Projects (spec §5): Step 1 common fields (§5.2), Step 2A residential (§5.3), Step 2B government (§5.4),
 * detail records, archive/delete rules and live profit (§5.6). Money and commercial terms go to the
 * restricted private documents (D-28): budget (PM-readable) and commercial (finance only).
 */
import { isDateStr } from "../dates";
import type { Expense, Invoice, Project, ProjectStatus } from "../model";
import { allocate } from "../numbering";
import { toStoredPhone } from "../phone";
import { projectProfit, sumCost, sumFinance, type CostRollup, type FinanceRollup } from "../rollups";
import { searchKeywords } from "../search";
import type { Doc, MemoryStore } from "../store";
import { createClient, type ClientInput } from "./clients";
import { Checker, CommandError, isNonNegInt, newId, requireAssigned, requireRole, stampCreate, stampUpdate, trimOrEmpty, type CommandCtx } from "./common";

export const RESIDENTIAL_SUBTYPES = ["individual_house", "apartments", "plotted_development", "commercial"] as const;
export const GOVERNMENT_SUBTYPES = ["road", "drain", "interlocking_paver", "building", "other"] as const;
export const PROJECT_STATUSES: readonly ProjectStatus[] = ["planned", "in_progress", "on_hold", "completed", "cancelled"];
export const CONTRACT_TYPES = ["lump_sum", "per_sqft", "cost_plus"] as const;

export interface ResidentialInput {
  units?: number;
  floors?: number;
  builtUpAreaSqft?: number;
  plotAreaSqft?: number;
  reraNo?: string;
  reraValidity?: string;
  contractType?: (typeof CONTRACT_TYPES)[number];
  defectLiabilityMonths?: number;
  handoverDate?: string;
}

export interface GovernmentInput {
  department: string;
  division?: string;
  engineerInCharge?: { name?: string; phone?: string };
  tenderNo?: string;
  tenderDate?: string;
  nitRef?: string;
  workOrderNo?: string;
  workOrderDate?: string;
  agreementNo?: string;
  stipulatedStartDate?: string;
  stipulatedEndDate?: string;
  finalBillDate?: string;
  completionCertificateDate?: string;
}

/** Government commercial terms (finance only, D-28): agreement value, premium, EMD / SD / PG summary, deductions. */
export interface GovernmentCommercialInput {
  agreementValuePaise?: number;
  tenderPremiumBp?: number;
  emd?: { amountPaise?: number; mode?: "dd" | "bg" | "fdr" | "online"; reference?: string; status?: "held" | "refunded" | "converted_to_sd" | "forfeited"; refundDate?: string };
  securityDepositPaise?: number;
  pg?: { bank?: string; number?: string; amountPaise?: number; expiryDate?: string };
  deductionHeads?: { head: string; rateBp: number }[];
}

export interface ProjectInput {
  name: string;
  type: Project["type"];
  subtype: string;
  clientId?: string;
  newClient?: ClientInput;
  address?: string;
  city?: string;
  lat?: number | null;
  lng?: number | null;
  startDate: string;
  expectedEndDate: string;
  actualEndDate?: string | null;
  status: ProjectStatus;
  budgetPaise: number;
  contractValuePaise: number;
  managerId?: string;
  assignedUsers?: string[];
  notes?: string;
  itcEligible?: boolean;
  /** Attendance needs a selfie / a GPS check-in on this site (§6.3; default off, C5). */
  attendanceRequiresSelfie?: boolean;
  attendanceRequiresGps?: boolean;
  residential?: ResidentialInput;
  government?: GovernmentInput;
  governmentCommercial?: GovernmentCommercialInput;
}

function optDate(c: Checker, field: string, v: string | undefined | null, label: string) {
  c.need(field, !v || isDateStr(v), `Enter the ${label} as a date.`);
}

/**
 * Validate and keep ONLY the selected type's fields (AC5.6-1): a residential project never stores
 * government data and vice versa.
 */
export function normaliseProject(input: ProjectInput): ProjectInput {
  const c = new Checker();
  const name = trimOrEmpty(input.name);
  c.need("name", name.length >= 2, "Enter the project name.");
  c.need("type", input.type === "residential" || input.type === "government", "Choose residential or government.");
  const subtypes: readonly string[] = input.type === "government" ? GOVERNMENT_SUBTYPES : RESIDENTIAL_SUBTYPES;
  c.need("subtype", subtypes.includes(input.subtype), "Choose the kind of work.");
  c.need("clientId", !!input.clientId || !!input.newClient, "Choose a client, or add a new one.");
  c.need("startDate", isDateStr(input.startDate), "Enter the start date.");
  c.need("expectedEndDate", isDateStr(input.expectedEndDate), "Enter the expected end date.");
  if (isDateStr(input.startDate) && isDateStr(input.expectedEndDate)) {
    c.need("expectedEndDate", input.expectedEndDate >= input.startDate, "The expected end date can't be before the start date.");
  }
  optDate(c, "actualEndDate", input.actualEndDate, "actual end date");
  c.need("status", PROJECT_STATUSES.includes(input.status), "Choose a status.");
  c.need("budgetPaise", isNonNegInt(input.budgetPaise), "Enter the budget in rupees.");
  c.need("contractValuePaise", isNonNegInt(input.contractValuePaise), "Enter the contract value in rupees.");
  if (input.lat != null || input.lng != null) {
    c.need("location", typeof input.lat === "number" && typeof input.lng === "number" && Math.abs(input.lat) <= 90 && Math.abs(input.lng) <= 180, "Enter both latitude and longitude, or leave both empty.");
  }

  let residential: ResidentialInput | undefined;
  let government: GovernmentInput | undefined;
  let governmentCommercial: GovernmentCommercialInput | undefined;
  if (input.type === "residential") {
    const r = input.residential ?? {};
    for (const k of ["units", "floors", "builtUpAreaSqft", "plotAreaSqft", "defectLiabilityMonths"] as const) {
      c.need(k, r[k] === undefined || isNonNegInt(r[k]), "Enter a whole number.");
    }
    c.need("contractType", !r.contractType || (CONTRACT_TYPES as readonly string[]).includes(r.contractType), "Choose lump sum, per sq ft or cost-plus.");
    optDate(c, "reraValidity", r.reraValidity, "RERA validity date");
    optDate(c, "handoverDate", r.handoverDate, "handover date");
    residential = { ...r, reraNo: trimOrEmpty(r.reraNo) };
  } else {
    const g = input.government ?? { department: "" };
    c.need("department", trimOrEmpty(g.department).length >= 2, "Enter the department or office name.");
    const eicPhone = trimOrEmpty(g.engineerInCharge?.phone);
    c.need("engineerPhone", !eicPhone || !!toStoredPhone(eicPhone), "Enter a 10-digit mobile number for the engineer-in-charge.");
    for (const [k, label] of [["tenderDate", "tender date"], ["workOrderDate", "work order date"], ["stipulatedStartDate", "stipulated start date"],
      ["stipulatedEndDate", "stipulated completion date"], ["finalBillDate", "final bill date"], ["completionCertificateDate", "completion certificate date"]] as const) {
      optDate(c, k, g[k], label);
    }
    government = {
      ...g, department: trimOrEmpty(g.department),
      engineerInCharge: { name: trimOrEmpty(g.engineerInCharge?.name), phone: eicPhone ? toStoredPhone(eicPhone)! : "" },
    };
    const gc = input.governmentCommercial ?? {};
    c.need("agreementValuePaise", gc.agreementValuePaise === undefined || isNonNegInt(gc.agreementValuePaise), "Enter the agreement value in rupees.");
    c.need("tenderPremiumBp", gc.tenderPremiumBp === undefined || (Number.isInteger(gc.tenderPremiumBp) && Math.abs(gc.tenderPremiumBp) <= 10000), "Enter the premium or discount as a percentage (− for below).");
    for (const d of gc.deductionHeads ?? []) c.need("deductionHeads", trimOrEmpty(d.head).length > 0 && isNonNegInt(d.rateBp) && d.rateBp <= 10000, "Each deduction needs a name and a percentage.");
    optDate(c, "emdRefundDate", gc.emd?.refundDate, "EMD refund date");
    optDate(c, "pgExpiry", gc.pg?.expiryDate, "guarantee expiry date");
    governmentCommercial = gc;
  }
  c.throwIfAny();
  return {
    ...input, name, address: trimOrEmpty(input.address), city: trimOrEmpty(input.city), notes: trimOrEmpty(input.notes),
    actualEndDate: input.actualEndDate || null, assignedUsers: [...new Set(input.assignedUsers ?? [])],
    itcEligible: input.itcEligible ?? input.type === "government",
    residential, government, governmentCommercial,
  };
}

/** createProject callable: allocates the project code (AG-P-0001) from the counter. */
export function createProject(store: MemoryStore, input: ProjectInput, ctx: CommandCtx): string {
  requireRole(ctx, ["owner", "accountant"], "create projects");
  const p = normaliseProject(input);
  let clientId = p.clientId;
  if (!clientId && p.newClient) clientId = createClient(store, p.newClient, ctx);
  const client = store.get<{ name: string }>("clients", clientId!);
  if (!client) throw new CommandError("Choose a client.", { clientId: "That client doesn't exist." });
  const counter = store.get<{ next?: number }>("counters", "project");
  const { number, next } = allocate("project", "", counter?.next);
  store.set("counters", { id: "project", docType: "project", next });
  const manager = p.managerId ? store.get<{ name: string }>("users", p.managerId) : null;
  const assigned = [...new Set([...(p.assignedUsers ?? []), ...(p.managerId ? [p.managerId] : [])])];
  const id = newId();
  store.set("projects", {
    id, code: number, name: p.name, type: p.type, subtype: p.subtype, clientId, clientName: client.name, address: p.address, city: p.city,
    location: p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null, startDate: p.startDate, expectedEndDate: p.expectedEndDate,
    actualEndDate: p.actualEndDate, status: p.status, isArchived: false, managerId: p.managerId ?? null, managerName: manager?.name ?? null,
    assignedUsers: assigned, progressPct: 0, itcEligible: p.itcEligible, attendanceRequiresSelfie: !!p.attendanceRequiresSelfie, attendanceRequiresGps: !!p.attendanceRequiresGps,
    notes: p.notes, residential: p.type === "residential" ? p.residential : null, government: p.type === "government" ? p.government : null,
    searchKeywords: searchKeywords(p.name, number, client.name, p.city), ...stampCreate(ctx),
  } as Doc);
  store.set(`projects/${id}/private`, { id: "budget", projectId: id, budgetPaise: p.budgetPaise });
  store.set(`projects/${id}/private`, {
    id: "commercial", projectId: id, contractValuePaise: p.contractValuePaise,
    ...(p.type === "government" ? { government: p.governmentCommercial ?? {} } : {}),
  });
  syncUserProjects(store, id, assigned);
  return id;
}

export function updateProject(store: MemoryStore, id: string, input: ProjectInput, ctx: CommandCtx): void {
  requireRole(ctx, ["owner", "accountant"], "edit projects");
  const cur = store.get<Project>("projects", id);
  if (!cur) throw new CommandError("This project no longer exists.");
  const p = normaliseProject(input);
  const client = store.get<{ name: string }>("clients", p.clientId ?? cur.clientId);
  if (!client) throw new CommandError("Choose a client.", { clientId: "That client doesn't exist." });
  // Only the owner changes who is assigned (D-06, rules).
  const assigned = ctx.role === "owner" ? [...new Set([...(p.assignedUsers ?? []), ...(p.managerId ? [p.managerId] : [])])] : cur.assignedUsers;
  const manager = p.managerId ? store.get<{ name: string }>("users", p.managerId) : null;
  store.merge("projects", id, {
    name: p.name, type: p.type, subtype: p.subtype, clientId: p.clientId ?? cur.clientId, clientName: client.name, address: p.address, city: p.city,
    location: p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null, startDate: p.startDate, expectedEndDate: p.expectedEndDate,
    actualEndDate: p.actualEndDate, status: p.status, managerId: p.managerId ?? null, managerName: manager?.name ?? null, assignedUsers: assigned,
    itcEligible: p.itcEligible, notes: p.notes,
    attendanceRequiresSelfie: p.attendanceRequiresSelfie ?? cur.attendanceRequiresSelfie ?? false,
    attendanceRequiresGps: p.attendanceRequiresGps ?? cur.attendanceRequiresGps ?? false,
    residential: p.type === "residential" ? p.residential : null, government: p.type === "government" ? p.government : null,
    searchKeywords: searchKeywords(p.name, cur.code, client.name, p.city), ...stampUpdate(ctx),
  });
  store.merge(`projects/${id}/private`, "budget", { projectId: id, budgetPaise: p.budgetPaise });
  const commercial = { projectId: id, contractValuePaise: p.contractValuePaise, government: p.type === "government" ? p.governmentCommercial ?? {} : null };
  store.merge(`projects/${id}/private`, "commercial", commercial);
  if (ctx.role === "owner") syncUserProjects(store, id, assigned);
}

/** Mirror assignedUsers into users.projectIds (D-06). */
export function syncUserProjects(store: MemoryStore, projectId: string, assigned: string[]): void {
  for (const u of store.list<{ id: string; projectIds?: string[] }>("users")) {
    const has = (u.projectIds ?? []).includes(projectId);
    const should = assigned.includes(u.id);
    if (has !== should) {
      store.merge("users", u.id, { projectIds: should ? [...(u.projectIds ?? []), projectId] : (u.projectIds ?? []).filter((x) => x !== projectId) });
    }
  }
}

/** A PM may update progress and status on assigned projects (rules). */
export function updateProgress(store: MemoryStore, id: string, progressPct: number, status: ProjectStatus, ctx: CommandCtx): void {
  requireRole(ctx, ["owner", "accountant", "pm"], "update progress");
  requireAssigned(ctx, id, "update its progress");
  if (!Number.isInteger(progressPct) || progressPct < 0 || progressPct > 100) throw new CommandError("Progress is a percentage from 0 to 100.", { progressPct: "Enter 0 to 100." });
  if (!PROJECT_STATUSES.includes(status)) throw new CommandError("Choose a status.");
  store.merge("projects", id, { progressPct, status, ...stampUpdate(ctx) });
}

/** Does the project have financial records? (AC5.6-2) Soft-deleted records still count: they are history. */
export function projectHasFinancials(store: MemoryStore, id: string): { expenses: number; invoices: number } {
  return {
    expenses: store.list<Expense>("expenses", (e) => e.projectId === id, { field: "projectId", value: id }).length,
    invoices: store.list<Invoice>("invoices", (i) => i.projectId === id, { field: "projectId", value: id }).length,
  };
}

/** AC5.6-2: a project with expenses or invoices can't be deleted, only archived. */
export function deleteProject(store: MemoryStore, id: string, ctx: CommandCtx): void {
  requireRole(ctx, ["owner"], "delete projects");
  const p = store.get<Project>("projects", id);
  if (!p) throw new CommandError("This project no longer exists.");
  const f = projectHasFinancials(store, id);
  if (f.expenses || f.invoices) {
    throw new CommandError(`This project has ${f.expenses} expense${f.expenses === 1 ? "" : "s"} and ${f.invoices} bill${f.invoices === 1 ? "" : "s"}, so it can't be deleted. Archive it instead.`);
  }
  for (const sub of PROJECT_CHILDREN) for (const d of store.list<Doc>(`projects/${id}/${sub}`)) store.delete(`projects/${id}/${sub}`, d.id);
  store.delete(`projects/${id}/private`, "budget");
  store.delete(`projects/${id}/private`, "commercial");
  for (const d of store.list<Doc>(`projects/${id}/roster`)) store.delete(`projects/${id}/roster`, d.id);
  store.delete("projects", id);
  syncUserProjects(store, id, []);
}

export function setArchived(store: MemoryStore, id: string, archived: boolean, ctx: CommandCtx): void {
  requireRole(ctx, ["owner"], archived ? "archive projects" : "restore projects");
  if (!store.get("projects", id)) throw new CommandError("This project no longer exists.");
  store.merge("projects", id, { isArchived: archived, ...stampUpdate(ctx) });
}

export interface ProjectFigures {
  budgetPaise: number | null;
  contractValuePaise: number | null;
  spentPaise: number;
  spentExGstPaise: number;
  wagesDuePaise: number;
  billedPaise: number | null;
  receivedPaise: number | null;
  profitPaise: number | null;
}

/**
 * Live project figures (§5.1 list, §5.5 overview, AC5.6-3) from the lifetime rollups. Billed, received and
 * profit are null for roles that can't read finance data (rule A, D-28).
 */
export function projectFigures(
  cost: CostRollup | null, finance: FinanceRollup | null, budgetPaise: number | null, contractValuePaise: number | null,
  basis: "received" | "billed" = "received",
): ProjectFigures {
  const c = sumCost([cost]);
  const f = finance ? sumFinance([finance]) : null;
  const spent = c.expenseTotalPaise;
  return {
    budgetPaise, contractValuePaise, spentPaise: spent, spentExGstPaise: spent - c.expenseGstPaise, wagesDuePaise: c.wagesEarnedPaise - c.wagesExpensedPaise,
    billedPaise: f ? f.billedPaise : null, receivedPaise: f ? f.receivedPaise : null,
    profitPaise: f ? projectProfit(f.receivedPaise, f.billedPaise, spent, basis) : null,
  };
}

// ---------- project detail records (subcollections, §5.3–§5.4) ----------

export const PROJECT_CHILDREN = [
  "project_units", "project_milestones", "project_approvals", "boq_items", "boq_rates", "measurement_book", "eot_requests", "hindrance_register",
] as const;
export type ProjectChild = (typeof PROJECT_CHILDREN)[number];

const CHILD_ROLES: Record<ProjectChild, { write: readonly string[]; type?: Project["type"] }> = {
  project_units: { write: ["owner", "accountant"], type: "residential" },
  project_milestones: { write: ["owner", "accountant"] },
  project_approvals: { write: ["owner", "accountant", "pm"], type: "residential" },
  boq_items: { write: ["owner", "accountant", "pm"], type: "government" },
  boq_rates: { write: ["owner", "accountant"], type: "government" },
  measurement_book: { write: ["owner", "accountant", "pm"], type: "government" },
  eot_requests: { write: ["owner", "accountant", "pm"], type: "government" },
  hindrance_register: { write: ["owner", "accountant", "pm"], type: "government" },
};

function validateChild(kind: ProjectChild, d: Record<string, unknown>): void {
  const c = new Checker();
  const s = (k: string) => trimOrEmpty(d[k]);
  switch (kind) {
    case "project_units":
      c.need("unitNo", s("unitNo").length > 0, "Enter the plot or flat number.");
      c.need("status", ["available", "booked", "sold", "handed_over"].includes(String(d.status)), "Choose available, booked, sold or handed over.");
      c.need("pricePaise", d.pricePaise === undefined || isNonNegInt(d.pricePaise), "Enter the price in rupees.");
      break;
    case "project_milestones":
      c.need("name", s("name").length > 0, "Enter the stage name, like Plinth.");
      c.need("pctBp", isNonNegInt(d.pctBp) && (d.pctBp as number) <= 10000, "Enter the percentage, 0 to 100.");
      c.need("amountPaise", isNonNegInt(d.amountPaise), "Enter the amount in rupees.");
      c.need("dueDate", !d.dueDate || isDateStr(d.dueDate), "Enter the due date.");
      c.need("status", ["pending", "invoiced", "paid"].includes(String(d.status)), "Choose pending, invoiced or paid.");
      break;
    case "project_approvals":
      c.need("kind", s("kind").length > 0, "Choose what the approval is for.");
      c.need("status", ["pending", "applied", "approved", "rejected"].includes(String(d.status)), "Choose a status.");
      for (const k of ["appliedDate", "approvedDate", "expiryDate"]) c.need(k, !d[k] || isDateStr(d[k]), "Enter a date.");
      break;
    case "boq_items":
      c.need("description", s("description").length > 0, "Describe the item.");
      c.need("unit", s("unit").length > 0, "Enter the unit, like cum or sqm.");
      c.need("qtyMilli", isNonNegInt(d.qtyMilli), "Enter the quantity.");
      break;
    case "boq_rates":
      c.need("ratePaise", isNonNegInt(d.ratePaise), "Enter the rate in rupees.");
      break;
    case "measurement_book":
      c.need("boqItemId", s("boqItemId").length > 0, "Choose the BOQ item measured.");
      c.need("date", isDateStr(d.date), "Enter the date.");
      c.need("qtyMilli", isNonNegInt(d.qtyMilli), "Enter the quantity measured.");
      c.need("mbPage", s("mbPage").length > 0, "Enter the MB page number.");
      break;
    case "eot_requests":
      c.need("reason", s("reason").length > 0, "Give the reason for the extension.");
      c.need("appliedDate", isDateStr(d.appliedDate), "Enter the date applied.");
      c.need("periodRequestedDays", isNonNegInt(d.periodRequestedDays), "Enter the days requested.");
      // Approval moves the stipulated date, so only a callable sets "approved" (rules).
      c.need("status", ["applied", "pending", "rejected"].includes(String(d.status)), "Choose applied, pending or rejected. Use Approve to approve.");
      break;
    case "hindrance_register":
      c.need("type", s("type").length > 0, "Choose the kind of hindrance.");
      c.need("fromDate", isDateStr(d.fromDate), "Enter the start date.");
      c.need("toDate", !d.toDate || isDateStr(d.toDate), "Enter the end date.");
      break;
  }
  c.throwIfAny();
}

export function saveProjectChild(store: MemoryStore, projectId: string, kind: ProjectChild, doc: Record<string, unknown> & { id?: string }, ctx: CommandCtx): string {
  const rule = CHILD_ROLES[kind];
  requireRole(ctx, rule.write as never, "change these project details");
  requireAssigned(ctx, projectId, "change its details");
  const p = store.get<Project>("projects", projectId);
  if (!p) throw new CommandError("This project no longer exists.");
  if (rule.type && rule.type !== p.type) throw new CommandError(`This is a ${p.type} project, so it doesn't have these details.`);
  validateChild(kind, doc);
  const id = doc.id || newId();
  const exists = !!store.get(`projects/${projectId}/${kind}`, id);
  if (kind === "measurement_book") {
    const item = store.get<{ description?: string }>(`projects/${projectId}/boq_items`, String(doc.boqItemId));
    if (!item) throw new CommandError("Choose the BOQ item measured.", { boqItemId: "Choose an item from the BOQ." });
    doc = { ...doc, boqItemName: item.description ?? "", measuredBy: doc.measuredBy ?? ctx.uid };
  }
  store.set(`projects/${projectId}/${kind}`, { ...doc, id, projectId, ...(exists ? stampUpdate(ctx) : stampCreate(ctx)) } as Doc);
  return id;
}

/** Approve an EOT: the stipulated completion date moves by the approved days (§5.4 v1.3). Callable only. */
export function approveEot(store: MemoryStore, projectId: string, eotId: string, approvedDays: number, ctx: CommandCtx): void {
  requireRole(ctx, ["owner", "accountant"], "approve extensions of time");
  const p = store.get<Project>("projects", projectId);
  const e = store.get<Record<string, unknown>>(`projects/${projectId}/eot_requests`, eotId);
  if (!p || !e) throw new CommandError("This request no longer exists.");
  if (!isNonNegInt(approvedDays)) throw new CommandError("Enter the days approved.", { periodApprovedDays: "Enter a whole number of days." });
  const g = (p.government ?? {}) as { stipulatedEndDate?: string };
  if (!g.stipulatedEndDate) throw new CommandError("Set the stipulated completion date first.");
  const d = new Date(`${g.stipulatedEndDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + approvedDays);
  const newEnd = d.toISOString().slice(0, 10);
  store.merge(`projects/${projectId}/eot_requests`, eotId, { status: "approved", periodApprovedDays: approvedDays, ...stampUpdate(ctx) });
  store.merge("projects", projectId, { government: { ...p.government, stipulatedEndDate: newEnd }, ...stampUpdate(ctx) });
}
