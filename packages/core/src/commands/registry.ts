/**
 * Command registry: the names the UI calls. Demo mode runs these directly on the browser store; Firebase
 * mode sends the same name and arguments to a callable Cloud Function that runs the same function (M1.6).
 */
import type { MemoryStore } from "../store";
import { createClient, updateClient } from "./clients";
import type { CommandFn } from "./common";
// <commands:imports> one line per feature (lane lead only, append only)
import { ACCOUNT_COMMANDS } from "./accounts";
import { EXPENSE_COMMANDS } from "./expenses";
import { CATEGORY_COMMANDS } from "./categories";
import { DOCUMENT_COMMANDS } from "./documents";
import { BILLING_COMMANDS } from "./billing";
import { ADMIN_COMMANDS } from "./admin";
// </commands:imports>
import { createUser, requestRateChange, saveKyc, saveWorker, setAssignment, setRoster, setSuperUser, setUserActive, setUserRole, updateSettings } from "./people";
import {
  addContractMeasurement, approveWorkerPayments, createWorkerPayment, markAttendanceDay, payPayout, rejectWorkerPayment, saveProjectTerms, saveThekedarContract, unlockAttendanceDay,
} from "./labour";
import { approveEot, createProject, deleteProject, saveProjectChild, setArchived, updateProgress, updateProject } from "./projects";

export const COMMANDS = {
  createClient: (s, a: { input: Parameters<typeof createClient>[1] }, c) => createClient(s, a.input, c),
  updateClient: (s, a: { id: string; input: Parameters<typeof updateClient>[2] }, c) => updateClient(s, a.id, a.input, c),
  createProject: (s, a: { input: Parameters<typeof createProject>[1] }, c) => createProject(s, a.input, c),
  updateProject: (s, a: { id: string; input: Parameters<typeof updateProject>[2] }, c) => updateProject(s, a.id, a.input, c),
  updateProgress: (s, a: { id: string; progressPct: number; status: Parameters<typeof updateProgress>[3] }, c) => updateProgress(s, a.id, a.progressPct, a.status, c),
  deleteProject: (s, a: { id: string }, c) => deleteProject(s, a.id, c),
  setArchived: (s, a: { id: string; archived: boolean }, c) => setArchived(s, a.id, a.archived, c),
  saveProjectChild: (s, a: { projectId: string; kind: Parameters<typeof saveProjectChild>[2]; doc: Record<string, unknown> & { id?: string } }, c) => saveProjectChild(s, a.projectId, a.kind, a.doc, c),
  approveEot: (s, a: { projectId: string; eotId: string; approvedDays: number }, c) => approveEot(s, a.projectId, a.eotId, a.approvedDays, c),
  saveWorker: (s, a: { id: string | null; input: Parameters<typeof saveWorker>[2] }, c) => saveWorker(s, a.id, a.input, c),
  saveKyc: (s, a: { workerId: string; input: Parameters<typeof saveKyc>[2] }, c) => saveKyc(s, a.workerId, a.input, c),
  requestRateChange: (s, a: Parameters<typeof requestRateChange>[1], c) => requestRateChange(s, a, c),
  setRoster: (s, a: { projectId: string; workerId: string; active: boolean }, c) => setRoster(s, a.projectId, a.workerId, a.active, c),
  createUser: (s, a: Parameters<typeof createUser>[1], c) => createUser(s, a, c),
  setUserRole: (s, a: { userId: string; role: Parameters<typeof setUserRole>[2] }, c) => setUserRole(s, a.userId, a.role, c),
  setUserActive: (s, a: { userId: string; active: boolean }, c) => setUserActive(s, a.userId, a.active, c),
  setSuperUser: (s, a: { userId: string; superUser: boolean }, c) => setSuperUser(s, a.userId, a.superUser, c),
  setAssignment: (s, a: { projectId: string; userId: string; assigned: boolean }, c) => setAssignment(s, a.projectId, a.userId, a.assigned, c),
  updateSettings: (s, a: { docId: string; patch: Record<string, unknown> }, c) => updateSettings(s, a.docId, a.patch, c),
  markAttendanceDay: (s, a: Parameters<typeof markAttendanceDay>[1], c) => markAttendanceDay(s, a, c),
  unlockAttendanceDay: (s, a: Parameters<typeof unlockAttendanceDay>[1], c) => unlockAttendanceDay(s, a, c),
  saveProjectTerms: (s, a: Parameters<typeof saveProjectTerms>[1], c) => saveProjectTerms(s, a, c),
  createWorkerPayment: (s, a: Parameters<typeof createWorkerPayment>[1], c) => createWorkerPayment(s, a, c),
  approveWorkerPayments: (s, a: Parameters<typeof approveWorkerPayments>[1], c) => approveWorkerPayments(s, a, c),
  rejectWorkerPayment: (s, a: Parameters<typeof rejectWorkerPayment>[1], c) => rejectWorkerPayment(s, a, c),
  payPayout: (s, a: Parameters<typeof payPayout>[1], c) => payPayout(s, a, c),
  saveThekedarContract: (s, a: Parameters<typeof saveThekedarContract>[1], c) => saveThekedarContract(s, a, c),
  addContractMeasurement: (s, a: Parameters<typeof addContractMeasurement>[1], c) => addContractMeasurement(s, a, c),
  // <commands:maps> one spread per feature, for example ...EXPENSE_COMMANDS (lane lead only, append only)
  ...ACCOUNT_COMMANDS,
  ...EXPENSE_COMMANDS,
  ...CATEGORY_COMMANDS,
  ...DOCUMENT_COMMANDS,
  ...BILLING_COMMANDS,
  ...ADMIN_COMMANDS,
  // </commands:maps>
} satisfies Record<string, CommandFn>;

export type CommandName = keyof typeof COMMANDS;
export type CommandArgs<N extends CommandName> = Parameters<(typeof COMMANDS)[N]>[1];
export type CommandResult<N extends CommandName> = Awaited<ReturnType<(typeof COMMANDS)[N]>>;
