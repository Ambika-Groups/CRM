// M1.2 commands: projects (§5.2–§5.6), clients (§8.1), workers and KYC (§6.1, D-22, D-32), roster (D-33),
// users and roles (§2, D-05), list queries (§3.1 rule 9). IDs M-xxx are referenced from docs/prd-traceability.md.
import { beforeEach, describe, expect, it } from "vitest";
import {
  CommandError, createClient, createProject, createUser, deleteProject, normaliseProject, projectFigures, QueryLimitError, requestRateChange,
  runQuery, saveKyc, saveProjectChild, saveWorker, seedDemo, setArchived, setRoster, setUserRole, updateClient, updateSettings, approveEot,
  type CommandCtx, type CostRollup, type Expense, type FinanceRollup, type MemoryStore, type Project, type ProjectInput, type Worker,
} from "../src";

const NOW = "2026-10-25T09:00:00.000Z";
const owner: CommandCtx = { uid: "uOwner", role: "owner", projectIds: [], nowIso: NOW };
const accountant: CommandCtx = { uid: "uAccountant", role: "accountant", projectIds: [], nowIso: NOW };
const pm: CommandCtx = { uid: "uPm", role: "pm", projectIds: ["projShivNagar", "projSharma"], nowIso: NOW };
const sup: CommandCtx = { uid: "uSupShivNagar", role: "supervisor", projectIds: ["projShivNagar"], nowIso: NOW };

let store: MemoryStore;
beforeEach(async () => {
  ({ store } = await seedDemo("2026-10-25"));
});

const base = (over: Partial<ProjectInput> = {}): ProjectInput => ({
  name: "Aliganj Drain", type: "government", subtype: "drain", clientId: "clNagarNigam", city: "Lucknow", startDate: "2026-11-01",
  expectedEndDate: "2027-03-31", status: "planned", budgetPaise: 50_000_000, contractValuePaise: 60_000_000, managerId: "uPm",
  government: { department: "PWD Lucknow", division: "Div 2", engineerInCharge: { name: "Er. A. Singh", phone: "98390 12345" } },
  governmentCommercial: { agreementValuePaise: 60_000_000, tenderPremiumBp: -250, deductionHeads: [{ head: "Retention", rateBp: 500 }] },
  ...over,
});

describe("§5.6 acceptance", () => {
  it("M-001 AC5.6-1: only the selected type's fields are stored", () => {
    const withBoth = base({ residential: { units: 10, reraNo: "X" } });
    const n = normaliseProject(withBoth);
    expect(n.residential).toBeUndefined();
    expect(n.government?.department).toBe("PWD Lucknow");
    const id = createProject(store, withBoth, owner);
    const p = store.get<Project>("projects", id)!;
    expect(p.residential).toBeNull();
    expect(p.government).toMatchObject({ department: "PWD Lucknow" });
    const r = createProject(store, base({ type: "residential", subtype: "individual_house", residential: { units: 1, contractType: "lump_sum" }, government: undefined }), owner);
    const rp = store.get<Project>("projects", r)!;
    expect(rp.government).toBeNull();
    expect(store.get<Record<string, unknown>>(`projects/${r}/private`, "commercial")!.government).toBeUndefined();
    // A residential-only child can't be added to a government project.
    expect(() => saveProjectChild(store, id, "project_units", { unitNo: "1", status: "available" }, owner)).toThrow(/government project/);
  });

  it("M-002 AC5.6-2: a project with expenses or invoices can't be deleted, only archived", () => {
    expect(() => deleteProject(store, "projShivNagar", owner)).toThrow(/can't be deleted\. Archive it instead/);
    setArchived(store, "projShivNagar", true, owner);
    expect(store.get<Project>("projects", "projShivNagar")!.isArchived).toBe(true);
    const fresh = createProject(store, base(), owner);
    deleteProject(store, fresh, owner);
    expect(store.get("projects", fresh)).toBeNull();
    expect(() => deleteProject(store, "projSharma", accountant)).toThrow(CommandError);
  });

  it("M-003 AC5.6-3: profit is live (received or billed − expense) and follows a new expense", async () => {
    const read = () => projectFigures(
      store.get<CostRollup>("rollups", "p_projSharma_all"), store.get<FinanceRollup>("finance_rollups", "p_projSharma_all"),
      store.get<{ budgetPaise: number }>("projects/projSharma/private", "budget")!.budgetPaise,
      store.get<{ contractValuePaise: number }>("projects/projSharma/private", "commercial")!.contractValuePaise,
    );
    const before = read();
    expect(before.profitPaise).toBe(before.receivedPaise! - before.spentPaise);
    const billed = projectFigures(store.get("rollups", "p_projSharma_all"), store.get("finance_rollups", "p_projSharma_all"), null, null, "billed");
    expect(billed.profitPaise).toBe(billed.billedPaise! - billed.spentPaise);
    store.set("expenses", { id: "eNew", projectId: "projSharma", date: "2026-10-24", monthKey: "2026-10", fy: "2026-27", categoryId: "cat_misc", amountPaise: 1_000_000, mode: "cash", accountId: "accCash", approvalStatus: "approved", source: "manual", enteredBy: "uOwner" } satisfies Expense as never);
    await store.post("expenses", "eNew", NOW);
    expect(read().profitPaise).toBe(before.profitPaise! - 1_000_000);
    // Roles without finance access get no billed, received or profit (rule A).
    expect(projectFigures(store.get("rollups", "p_projSharma_all"), null, 0, null).profitPaise).toBeNull();
  });
});

describe("projects §5.2–§5.4", () => {
  it("M-004 codes come from the counter (AG-P-0004 after the 3 seeded)", () => {
    const id = createProject(store, base(), owner);
    expect(store.get<Project>("projects", id)!.code).toBe("AG-P-0004");
    expect(store.get<Project>("projects", createProject(store, base({ name: "Second" }), owner))!.code).toBe("AG-P-0005");
  });
  it("M-005 validation speaks plain words, field by field", () => {
    try {
      normaliseProject(base({ name: "", startDate: "2027-01-01", expectedEndDate: "2026-01-01", budgetPaise: -1 }));
      expect.unreachable();
    } catch (e) {
      expect((e as CommandError).fields).toMatchObject({
        name: "Enter the project name.", expectedEndDate: "The expected end date can't be before the start date.", budgetPaise: "Enter the budget in rupees.",
      });
    }
  });
  it("M-006 PMs and supervisors can't create projects; the PM is assigned automatically", () => {
    expect(() => createProject(store, base(), pm)).toThrow(/can't create projects/);
    const id = createProject(store, base({ assignedUsers: ["uSupShivNagar"] }), owner);
    expect(store.get<Project>("projects", id)!.assignedUsers.sort()).toEqual(["uPm", "uSupShivNagar"]);
    expect(store.get<{ projectIds: string[] }>("users", "uSupShivNagar")!.projectIds).toContain(id);
  });
  it("M-007 money goes to the private documents, not the project (D-28)", () => {
    const id = createProject(store, base(), owner);
    expect(JSON.stringify(store.get("projects", id))).not.toMatch(/budgetPaise|contractValuePaise|agreementValuePaise/);
    expect(store.get<{ budgetPaise: number }>(`projects/${id}/private`, "budget")!.budgetPaise).toBe(50_000_000);
    expect(store.get<{ government: { tenderPremiumBp: number } }>(`projects/${id}/private`, "commercial")!.government.tenderPremiumBp).toBe(-250);
  });
  it("M-008 EOT approval moves the stipulated completion date (§5.4 v1.3)", () => {
    const g = store.get<Project>("projects", "projShivNagar")!.government as { stipulatedEndDate: string };
    approveEot(store, "projShivNagar", "eot1", 21, owner);
    const after = store.get<Project>("projects", "projShivNagar")!.government as { stipulatedEndDate: string };
    expect(new Date(after.stipulatedEndDate).getTime() - new Date(g.stipulatedEndDate).getTime()).toBe(21 * 86_400_000);
    expect(() => saveProjectChild(store, "projShivNagar", "eot_requests", { reason: "x", appliedDate: "2026-10-01", periodRequestedDays: 3, status: "approved" }, pm)).toThrow();
  });
});

describe("clients §8.1", () => {
  it("M-010 validates and normalises the client master", () => {
    const id = createClient(store, { name: " Verma Builders ", type: "builder", phone: "98765 43210", gstin: "09aaacv1234a1zx", pan: "", email: "" }, accountant);
    const c = store.get<Record<string, unknown>>("clients", id)!;
    expect(c).toMatchObject({ name: "Verma Builders", phone: "+919876543210", gstin: "09AAACV1234A1ZX", stateCode: "09" });
    expect(c.searchKeywords).toContain("ve");
    expect(() => createClient(store, { name: "X", type: "builder", gstin: "123" }, accountant)).toThrow();
    expect(() => createClient(store, { name: "Valid Name", type: "individual" }, pm)).toThrow(/can't add clients/);
  });
  it("M-011 renaming a client updates the name snapshot on its projects", () => {
    updateClient(store, "clSharma", { name: "Rajesh K. Sharma", type: "individual" }, owner);
    expect(store.get<Project>("projects", "projSharma")!.clientName).toBe("Rajesh K. Sharma");
  });
});

describe("workers §6.1, D-22, D-32, D-33", () => {
  it("M-023 rates are never on the worker master; finance writes them to the pay document (rule A)", () => {
    for (const w of store.list<Record<string, unknown>>("workers")) {
      expect(w.defaultRatePaise).toBeUndefined();
      expect(w.otRatePaise).toBeUndefined();
    }
    const owner = { ...pm, uid: "uOwner", role: "owner" as const };
    const id = saveWorker(store, null, { name: "Ravi Shankar", role: "labour", defaultRatePaise: 52_500 }, owner);
    expect(store.get<Record<string, unknown>>("workers", id)!.defaultRatePaise).toBeUndefined();
    expect(store.get(`workers/${id}/private`, "pay")).toMatchObject({ defaultRatePaise: 52_500, otRatePaise: null });
  });


  it("M-020 a PM can add a worker but never sets rates (D-32)", () => {
    const id = saveWorker(store, null, { name: "Nand Kishore", role: "labour", defaultRatePaise: 99_900 }, pm);
    const w = store.get<Record<string, unknown>>("workers", id)!;
    expect(w.defaultRatePaise).toBeUndefined();
    expect(store.get(`workers/${id}/private`, "pay")).toBeNull();
    const before = store.get<{ defaultRatePaise: number }>("workers/w001/private", "pay")!.defaultRatePaise;
    saveWorker(store, "w001", { name: "Suresh Pal", role: "mistri", defaultRatePaise: 1 }, pm);
    expect(store.get<{ defaultRatePaise: number }>("workers/w001/private", "pay")!.defaultRatePaise).toBe(before);
    expect(before).toBeGreaterThanOrEqual(80_000);
    const r = requestRateChange(store, { workerId: "w001", projectId: "projShivNagar", proposedRatePaise: 85_000, reason: "Senior mistri" }, pm);
    expect(store.get("rate_change_requests", r)).toMatchObject({ approvalStatus: "pending", requestedBy: "uPm" });
    expect(() => saveWorker(store, null, { name: "X Y", role: "labour" }, sup)).toThrow();
  });
  it("M-021 KYC is finance-only and accepts masked Aadhaar only (D-22)", () => {
    expect(() => saveKyc(store, "w001", { idProofType: "aadhaar_masked", idProofLast4: "1234" }, pm)).toThrow(/can't see or change ID/);
    const fieldError = (fn: () => void) => { try { fn(); return null; } catch (e) { return (e as CommandError).fields; } };
    expect(fieldError(() => saveKyc(store, "w001", { idProofType: "aadhaar_masked", idProofLast4: "1234" }, owner))!.maskedConfirmed).toMatch(/masked Aadhaar: the first 8 digits must be hidden/);
    expect(fieldError(() => saveKyc(store, "w001", { idProofType: "aadhaar_masked", idProofLast4: "123456789012", maskedConfirmed: true }, owner))!.idProofLast4).toMatch(/last 4 digits/);
    saveKyc(store, "w001", { idProofType: "aadhaar_masked", idProofLast4: "1234", maskedConfirmed: true, ifsc: "sbin0001234", bankAccountNo: "123456789012" }, owner);
    expect(store.get("workers/w001/private", "kyc")).toMatchObject({ idProofNumberMasked: "1234", bank: { ifsc: "SBIN0001234" } });
  });
  it("M-022 roster: PM on an assigned site adds or removes; snapshots carry no rates (D-33)", () => {
    const id = saveWorker(store, null, { name: "Nand Kishore", role: "labour" }, owner);
    setRoster(store, "projSharma", id, true, pm);
    const r = store.get<Record<string, unknown>>("projects/projSharma/roster", id)!;
    expect(r).toMatchObject({ active: true, workerName: "Nand Kishore", workerRole: "labour" });
    expect(JSON.stringify(r)).not.toMatch(/Rate/);
    setRoster(store, "projSharma", id, false, pm);
    expect(store.get<Record<string, unknown>>("projects/projSharma/roster", id)!.active).toBe(false);
    expect(() => setRoster(store, "projGomti", id, true, pm)).toThrow(/aren't assigned/);
    expect(() => setRoster(store, "projShivNagar", "wMohanLal", true, owner)).toThrow(/thekedar/);
  });
});

describe("users and settings §2, D-05", () => {
  it("M-030 only the owner adds users and changes roles; the last owner can't demote themselves", () => {
    const id = createUser(store, { name: "Kiran Joshi", email: "kiran@example.com", role: "supervisor" }, owner);
    setUserRole(store, id, "pm", owner);
    expect(store.get<{ role: string }>("users", id)!.role).toBe("pm");
    expect(() => setUserRole(store, id, "owner", accountant)).toThrow(/can't change roles/);
    expect(() => setUserRole(store, "uOwner", "accountant", owner)).toThrow(/only owner/);
  });
  it("M-031 settings: operations owner-only and validated; bank editable by the accountant", () => {
    expect(() => updateSettings(store, "operations", { attendanceLockDays: 5 }, accountant)).toThrow();
    expect(() => updateSettings(store, "operations", { attendanceLockDays: -1 }, owner)).toThrow();
    updateSettings(store, "operations", { attendanceLockDays: 5 }, owner);
    updateSettings(store, "bank", { accounts: [] }, accountant);
    expect(store.get<{ attendanceLockDays: number }>("settings", "operations")!.attendanceLockDays).toBe(5);
  });
});

describe("§3.1 rule 9: no page downloads a whole collection", () => {
  it("M-040 every list query needs a limit of 1–50; pages chain with cursors", () => {
    const docs = Array.from({ length: 120 }, (_, i) => ({ id: `d${String(i).padStart(3, "0")}`, n: i }));
    expect(() => runQuery(docs, { limit: 0 })).toThrow(QueryLimitError);
    expect(() => runQuery(docs, { limit: 51 })).toThrow(QueryLimitError);
    expect(() => runQuery(docs, {} as never)).toThrow(QueryLimitError);
    const p1 = runQuery(docs, { limit: 50, orderBy: [{ field: "n", dir: "desc" }] });
    expect(p1.items).toHaveLength(50);
    expect(p1.total).toBe(120);
    const p3 = runQuery(docs, { limit: 50, orderBy: [{ field: "n", dir: "desc" }], after: runQuery(docs, { limit: 50, orderBy: [{ field: "n", dir: "desc" }], after: p1.next }).next });
    expect(p3.items).toHaveLength(20);
    expect(p3.next).toBeNull();
    expect(runQuery(docs, { limit: 25, where: [{ field: "n", op: ">=", value: 100 }] }).total).toBe(20);
  });
});
