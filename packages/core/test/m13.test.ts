// M1.3 labour: pay types (§6.2), attendance with lock and last-write-wins (§6.3, D-25), wages, payments, advances,
// payout, ledgers, thekedar contracts (§6.4, §8A.6), site workforce (§6.5), D-16 and D-45. IDs L-xxx are cited in
// docs/prd-traceability.md.
import { beforeEach, describe, expect, it } from "vitest";
import {
  addContractMeasurement, approveWorkerPayments, attendanceEarned, attendanceLock, canRead, createWorkerPayment, markAttendanceDay, monthlySheet,
  otHourlyRate, payoutSheet, payPayout, rejectWorkerPayment, saveProjectTerms, saveThekedarContract, saveWorker, seedDemo, siteWorkforce,
  snapshotAttendance, thekedarLedger, unlockAttendanceDay, workerLedger,
  type Attendance, type CommandCtx, type ContractMeasurement, type Expense, type MemoryStore, type RosterEntry, type ThekedarContract, type WorkerPayment,
} from "../src";

const NOW = "2026-10-25T09:00:00.000Z"; // 14:30 IST on Sunday 25 Oct 2026
const owner: CommandCtx = { uid: "uOwner", role: "owner", projectIds: [], nowIso: NOW };
const accountant: CommandCtx = { uid: "uAccountant", role: "accountant", projectIds: [], nowIso: NOW };
const pm: CommandCtx = { uid: "uPm", role: "pm", projectIds: ["projShivNagar", "projSharma"], nowIso: NOW };
const sup: CommandCtx = { uid: "uSupShivNagar", role: "supervisor", projectIds: ["projShivNagar"], nowIso: NOW };
const G = "projShivNagar";

let store: MemoryStore;
beforeEach(async () => {
  ({ store } = await seedDemo("2026-10-25"));
});
const att = (wid: string, date: string) => store.get<Attendance>("attendance", `${G}_${wid}_${date}`)!;
const bal = (wid: string) => store.get<Record<string, number>>("worker_balances", `${wid}_${G}`) ?? {};

describe("pay types §6.2", () => {
  it("L-001 overtime per hour or as a multiplier; half day is 50%", () => {
    expect(otHourlyRate(80_000)).toBe(10_000); // ₹800 ÷ 8
    expect(otHourlyRate(80_000, { otRatePaise: 12_500 })).toBe(12_500);
    expect(otHourlyRate(80_000, { otMultiplierBp: 15_000 })).toBe(15_000); // 1.5 × ₹100
    expect(attendanceEarned("overtime", "daily", 80_000, otHourlyRate(80_000, { otMultiplierBp: 20_000 }), 2000)).toBe(80_000 + 40_000);
    expect(attendanceEarned("half_day", "daily", 80_000, 10_000)).toBe(40_000);
  });

  it("L-002 a different pay type per project, and monthly staff at salary ÷ 26", () => {
    saveProjectTerms(store, { workerId: "w001", projectId: G, payType: "monthly", monthlySalaryPaise: 2_600_000 }, accountant);
    const a = snapshotAttendance(store, { id: "x", projectId: G, workerId: "w001", date: "2026-10-24", monthKey: "", fy: "", status: "present", markedBy: "u" });
    expect(a).toMatchObject({ payType: "monthly", rateSnapshotPaise: 2_600_000, earnedPaise: 100_000 });
    saveProjectTerms(store, { workerId: "w002", projectId: G, payType: "daily", ratePaise: 90_000, otMultiplierBp: 15_000 }, accountant);
    const b = snapshotAttendance(store, { id: "y", projectId: G, workerId: "w002", date: "2026-10-24", monthKey: "", fy: "", status: "overtime", otHoursMilli: 2000, markedBy: "u" });
    expect(b.earnedPaise).toBe(90_000 + 2 * 16_875);
    expect(() => saveProjectTerms(store, { workerId: "w001", projectId: G, payType: "daily", ratePaise: 1 }, pm)).toThrow();
  });

  it("L-003 the worker's own pay document takes the multiplier and the monthly salary (finance only)", () => {
    const id = saveWorker(store, null, { name: "Kamlesh Tiwari", role: "supervisor", defaultPayType: "monthly", monthlySalaryPaise: 1_800_000 }, owner);
    expect(store.get(`workers/${id}/private`, "pay")).toMatchObject({ monthlySalaryPaise: 1_800_000 });
    expect(() => saveWorker(store, null, { name: "No Salary", role: "supervisor", defaultPayType: "monthly" }, owner)).toThrow();
  });
});

describe("attendance §6.3", () => {
  it("L-010 the lock is measured on server time (D-25): 3 days, then only the owner, or after an unlock", async () => {
    expect(attendanceLock(store, G, "2026-10-22", sup)).toMatchObject({ locked: false, daysOld: 3 });
    expect(attendanceLock(store, G, "2026-10-21", sup)).toMatchObject({ locked: true, daysOld: 4 });
    // The phone's clock plays no part: the same request at a later server time is locked.
    expect(attendanceLock(store, G, "2026-10-22", { nowIso: "2026-10-26T09:00:00.000Z" }).locked).toBe(true);
    const marks = [{ workerId: "w001", status: "absent" as const }];
    await expect(markAttendanceDay(store, { projectId: G, date: "2026-10-21", marks }, sup)).rejects.toThrow(/locked/);
    await expect(markAttendanceDay(store, { projectId: G, date: "2026-10-26", marks }, sup)).rejects.toThrow(/future/);
    expect(() => unlockAttendanceDay(store, { projectId: G, date: "2026-10-21", reason: "Rain day" }, sup)).toThrow();
    unlockAttendanceDay(store, { projectId: G, date: "2026-10-21", reason: "Wrong marks" }, owner);
    await markAttendanceDay(store, { projectId: G, date: "2026-10-21", marks }, sup);
    expect(att("w001", "2026-10-21").status).toBe("absent");
    await markAttendanceDay(store, { projectId: G, date: "2026-10-20", marks: [{ workerId: "w002", status: "leave" }] }, owner);
    expect(att("w002", "2026-10-20").status).toBe("leave");
  });

  it("L-011 last write wins, and the audit trail records the overwritten change", async () => {
    const loaded = "2026-10-24T05:00:00.000Z";
    await markAttendanceDay(store, { projectId: G, date: "2026-10-24", marks: [{ workerId: "w001", status: "absent" }] }, { ...pm, nowIso: "2026-10-24T11:00:00.000Z" });
    const r = await markAttendanceDay(store, { projectId: G, date: "2026-10-24", loadedAt: loaded, marks: [{ workerId: "w001", status: "half_day" }] }, sup);
    expect(r.conflicts).toEqual([{ workerId: "w001", overwrote: "uPm" }]);
    expect(att("w001", "2026-10-24")).toMatchObject({ status: "half_day", markedBy: "uSupShivNagar" });
    const audit = store.list<{ entityId: string; overwrote: string | null; before: { status: string } | null }>("audit_log", (a) => a.entityId === `${G}_w001_2026-10-24`);
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({ overwrote: "uPm", before: { status: "absent" } });
    // Saving the same mark again writes nothing.
    expect((await markAttendanceDay(store, { projectId: G, date: "2026-10-24", marks: [{ workerId: "w001", status: "half_day" }] }, sup)).unchanged).toBe(1);
  });

  it("L-012 marking is for assigned staff, workers on the roster, valid overtime, and the project's check-in rules", async () => {
    await expect(markAttendanceDay(store, { projectId: "projGomti", date: "2026-10-24", marks: [] }, sup)).rejects.toThrow(/assigned/);
    await expect(markAttendanceDay(store, { projectId: G, date: "2026-10-24", marks: [{ workerId: "w031", status: "present" }] }, sup)).rejects.toThrow();
    await expect(markAttendanceDay(store, { projectId: G, date: "2026-10-24", marks: [{ workerId: "w001", status: "overtime", otHoursMilli: 13_000 }] }, sup)).rejects.toThrow();
    store.merge("projects", G, { attendanceRequiresSelfie: true, attendanceRequiresGps: true });
    await expect(markAttendanceDay(store, { projectId: G, date: "2026-10-24", marks: [{ workerId: "w001", status: "present" }] }, sup)).rejects.toThrow();
    await markAttendanceDay(store, { projectId: G, date: "2026-10-24", marks: [{ workerId: "w001", status: "present" }], checkin: { selfieDataUrl: "data:image/jpeg;base64,AA", lat: 26.85, lng: 80.95, accuracyM: 12 } }, sup);
    expect(store.get("attendance_checkins", `${G}_2026-10-24_uSupShivNagar`)).toMatchObject({ lat: 26.85 });
  });

  it("L-013 the monthly sheet adds up to the attendance records", () => {
    const roster = store.list<RosterEntry>(`projects/${G}/roster`);
    const month = store.list<Attendance>("attendance", (a) => a.projectId === G && a.monthKey === "2026-10");
    const sheet = monthlySheet(roster, month);
    const total = sheet.reduce((s, r) => s + r.present + r.half + r.absent + r.leave, 0);
    expect(total).toBe(month.length);
    expect(sheet.find((r) => r.workerId === "w001")!.days["2026-10-24"]).toMatch(/^(P|H|A|L|OT)$/);
  });
});

describe("wages and payments §6.4", () => {
  it("L-020 a wage within the limit is approved at once, books a Labour expense for the gross (D-16) and moves the net", async () => {
    const before = bal("w001");
    const r = await createWorkerPayment(store, { workerId: "w001", projectId: G, date: "2026-10-24", type: "wage", grossPaise: 400_000, mode: "cash", accountId: "accCash" }, accountant);
    expect(r).toMatchObject({ approved: true, needsOwnerApproval: false });
    const exp = store.get<Expense>("expenses", `wage_${r.id}`)!;
    expect(exp).toMatchObject({ amountPaise: 400_000, source: "wage", categoryId: "cat_labour_mistri", approvalStatus: "approved", accountId: null });
    expect(bal("w001").paidPaise).toBe((before.paidPaise ?? 0) + 400_000);
    expect(store.get("account_transactions", `worker_payments_${r.id}`)).toMatchObject({ amountPaise: 400_000, directionSign: -1 });
  });

  it("L-021 above the limit an accountant's payment waits; only the owner approves it (D13, D-30)", async () => {
    const r = await createWorkerPayment(store, { workerId: "w001", projectId: G, date: "2026-10-24", type: "bonus", grossPaise: 3_000_000, mode: "bank", accountId: "accSbi" }, accountant);
    expect(r.approved).toBe(false);
    await expect(approveWorkerPayments(store, { ids: [r.id] }, accountant)).rejects.toThrow(/owner/);
    expect(await approveWorkerPayments(store, { ids: [r.id] }, owner)).toBe(1);
    expect(store.get<WorkerPayment>("worker_payments", r.id)!.approvalStatus).toBe("approved");
    const r2 = await createWorkerPayment(store, { workerId: "w002", projectId: G, date: "2026-10-24", type: "bonus", grossPaise: 3_000_000, mode: "bank", accountId: "accSbi" }, accountant);
    rejectWorkerPayment(store, { id: r2.id, reason: "Not agreed" }, owner);
    expect(store.get<WorkerPayment>("worker_payments", r2.id)!.approvalStatus).toBe("rejected");
    expect(store.get("expenses", `wage_${r2.id}`)).toBeNull();
  });

  it("L-022 advances: given, recovered against wages, never over-recovered; payable = earned − paid − recovery", async () => {
    const before = workerLedger(bal("w001"), []);
    await createWorkerPayment(store, { workerId: "w001", projectId: G, date: "2026-10-24", type: "advance", grossPaise: 300_000, mode: "cash", accountId: "accCash" }, owner);
    const mid = workerLedger(bal("w001"), []);
    expect(mid.advanceOutstandingPaise).toBe(before.advanceOutstandingPaise + 300_000);
    expect(store.get("expenses", "wage_x")).toBeNull();
    await expect(createWorkerPayment(store, { workerId: "w001", projectId: G, date: "2026-10-24", type: "wage", grossPaise: 500_000, advanceRecoveredPaise: mid.advanceOutstandingPaise + 1, mode: "cash", accountId: "accCash" }, owner)).rejects.toMatchObject({ fields: { advanceRecoveredPaise: expect.stringMatching(/advance/) } });
    const w = await createWorkerPayment(store, { workerId: "w001", projectId: G, date: "2026-10-24", type: "wage", grossPaise: 500_000, advanceRecoveredPaise: 100_000, mode: "cash", accountId: "accCash" }, owner);
    expect(store.get<WorkerPayment>("worker_payments", w.id)!.netPaidPaise).toBe(400_000);
    const after = workerLedger(bal("w001"), []);
    expect(after.advanceOutstandingPaise).toBe(mid.advanceOutstandingPaise - 100_000);
    expect(after.balanceDuePaise).toBe(mid.balanceDuePaise - 500_000);
  });

  it("L-023 money on workers is finance-only (D-45): no payments by or for the PM and supervisor", async () => {
    const input = { workerId: "w001", projectId: G, date: "2026-10-24", type: "wage" as const, grossPaise: 1000, mode: "cash" as const, accountId: "accCash" };
    await expect(createWorkerPayment(store, input, pm)).rejects.toThrow();
    await expect(createWorkerPayment(store, input, sup)).rejects.toThrow();
    for (const c of ["worker_payments", "worker_balances", "thekedar_contracts", "contract_measurements"]) {
      expect(canRead(c, { projectId: G }, { role: "pm", uid: "uPm", assignedProjectIds: [G] }), c).toBe(false);
      expect(canRead(c, { projectId: G }, { role: "supervisor", uid: "uSup", assignedProjectIds: [G] }), c).toBe(false);
    }
  });

  it("L-024 thekedar bills: TDS under 194C from KYC; a bill above the contract value always waits for the owner (§8A.6)", async () => {
    const k = store.get<ThekedarContract>("thekedar_contracts", "tcShivNagarCC")!;
    const paid = store.list<WorkerPayment>("worker_payments", (p) => p.contractId === k.id).reduce((s, p) => s + p.grossPaise, 0);
    const ok = await createWorkerPayment(store, { workerId: "wMohanLal", projectId: G, date: "2026-10-24", type: "thekedar_bill", grossPaise: 1_000_000, mode: "bank", accountId: "accSbi", contractId: k.id }, accountant);
    expect(store.get<WorkerPayment>("worker_payments", ok.id)).toMatchObject({ tdsPaise: 10_000, tdsSection: "194C", netPaidPaise: 990_000, needsOwnerApproval: false });
    const over = await createWorkerPayment(store, { workerId: "wMohanLal", projectId: G, date: "2026-10-24", type: "thekedar_bill", grossPaise: k.valuePaise - paid, mode: "bank", accountId: "accSbi", contractId: k.id }, owner);
    expect(over).toMatchObject({ approved: false, needsOwnerApproval: true });
    await expect(approveWorkerPayments(store, { ids: [over.id] }, accountant)).rejects.toThrow(/contract value/);
    await approveWorkerPayments(store, { ids: [over.id] }, owner);
    await expect(createWorkerPayment(store, { workerId: "w001", projectId: G, date: "2026-10-24", type: "thekedar_bill", grossPaise: 100, mode: "bank", accountId: "accSbi" }, owner)).rejects.toMatchObject({ fields: { workerId: expect.stringMatching(/thekedar/) } });
  });

  it("L-025 contracts: lump sum or per unit with milestones; measurements value the work; the ledger balances", () => {
    expect(() => saveThekedarContract(store, { thekedarId: "wMohanLal", projectId: G, scope: "Kerb", basis: "per_unit", unit: "rmt", ratePaise: 5_000, qtyMilli: 1_000_000, milestones: [{ name: "All", amountPaise: 6_000_000 }] }, accountant)).toThrowError(expect.objectContaining({ fields: expect.objectContaining({ milestones: expect.stringMatching(/Milestones/) }) }));
    const id = saveThekedarContract(store, { thekedarId: "wMohanLal", projectId: G, scope: "Kerb stone fixing", basis: "per_unit", unit: "rmt", ratePaise: 5_000, qtyMilli: 1_000_000 }, accountant);
    expect(store.get<ThekedarContract>("thekedar_contracts", id)!.valuePaise).toBe(5_000_000);
    addContractMeasurement(store, { contractId: id, date: "2026-10-24", qtyMilli: 250_000 }, accountant);
    const ls = saveThekedarContract(store, { thekedarId: "wMohanLal", projectId: G, scope: "Site cleaning", basis: "lumpsum", valuePaise: 2_000_000 }, owner);
    addContractMeasurement(store, { contractId: ls, date: "2026-10-24", pctBp: 2_500 }, owner);
    const ms = store.list<ContractMeasurement>("contract_measurements");
    expect(thekedarLedger(store.get<ThekedarContract>("thekedar_contracts", id)!, ms, [])).toMatchObject({ valuePaise: 5_000_000, measuredPaise: 1_250_000, balanceDuePaise: 1_250_000 });
    expect(thekedarLedger(store.get<ThekedarContract>("thekedar_contracts", ls)!, ms, []).measuredPaise).toBe(500_000);
    // The seeded contract: every weekly bill was measured, so nothing is due beyond rounding.
    const seeded = thekedarLedger(store.get<ThekedarContract>("thekedar_contracts", "tcShivNagarCC")!, ms, store.list<WorkerPayment>("worker_payments"));
    expect(seeded.paidGrossPaise).toBeGreaterThan(0);
    expect(Math.abs(seeded.balanceDuePaise)).toBeLessThan(100 * 10);
    expect(seeded.netPaidPaise).toBe(seeded.paidGrossPaise - seeded.tdsPaise);
  });

  it("L-026 the payout sheet pays what is due, recovers advances, and leaves nothing due after mark paid", async () => {
    await createWorkerPayment(store, { workerId: "w004", projectId: G, date: "2026-10-20", type: "advance", grossPaise: 250_000, mode: "cash", accountId: "accCash" }, owner);
    const roster = store.list<RosterEntry>(`projects/${G}/roster`);
    const atts = store.list<Attendance>("attendance", (a) => a.projectId === G);
    const balances = Object.fromEntries(roster.map((r) => [r.id, store.get<Record<string, number>>("worker_balances", `${r.id}_${G}`) ?? {}]));
    const rows = payoutSheet(roster, atts, balances, "2026-10-19", "2026-10-24");
    expect(rows.every((r) => !roster.find((x) => x.id === r.workerId)!.thekedarId)).toBe(true);
    expect(rows.some((r) => r.grossPaise > 0)).toBe(true);
    const w4 = rows.find((r) => r.workerId === "w004")!;
    expect(w4.recoverPaise).toBe(Math.min(100_000, w4.grossPaise)); // the advance is recovered, up to ₹1,000 a payout
    const res = await payPayout(store, { projectId: G, to: "2026-10-24", date: "2026-10-24", mode: "cash", accountId: "accCash", rows: rows.map((r) => ({ workerId: r.workerId, grossPaise: r.grossPaise, recoverPaise: r.recoverPaise })) }, owner);
    expect(res.payments.every((p) => p.approved)).toBe(true);
    for (const r of rows.filter((x) => x.grossPaise > 0)) expect(workerLedger(bal(r.workerId), []).balanceDuePaise).toBe(0);
  });
});

describe("site workforce §6.5 and money flows D-16", () => {
  it("L-030 the workforce view counts the site, and carries money only when asked (finance)", () => {
    const roster = store.list<RosterEntry>(`projects/${G}/roster`);
    const day = store.list<Attendance>("attendance", (a) => a.projectId === G && a.date === "2026-10-24");
    const plain = siteWorkforce(roster, day);
    expect(plain.rows.every((r) => r.paidToDatePaise === undefined && r.ratePaise === undefined)).toBe(true);
    expect(plain.summary.total).toBe(roster.filter((r) => r.active).length);
    expect(plain.summary.viaThekedar + plain.summary.direct).toBe(plain.summary.present);
    const withMoney = siteWorkforce(roster, day, { balances: { w001: { earnedPaise: 1000, paidPaise: 400 } }, rates: { w001: 80_000 } });
    expect(withMoney.rows.find((r) => r.workerId === "w001")).toMatchObject({ ratePaise: 80_000, paidToDatePaise: 400, balanceDuePaise: 600 });
  });

  it("L-031 every approved wage, bonus and thekedar payment appears as one Labour expense for its gross, with no second cash entry (D-16)", () => {
    const pays = store.list<WorkerPayment>("worker_payments", (p) => p.approvalStatus === "approved" && ["wage", "bonus", "thekedar_bill"].includes(p.type));
    expect(pays.length).toBeGreaterThan(50);
    for (const p of pays) {
      const e = store.get<Expense>("expenses", `wage_${p.id}`);
      expect(e, p.id).toMatchObject({ amountPaise: p.grossPaise, source: "wage", accountId: null });
      expect(e!.categoryId.startsWith("cat_labour_")).toBe(true);
    }
    const advances = store.list<WorkerPayment>("worker_payments", (p) => p.type === "advance");
    for (const a of advances) expect(store.get("expenses", `wage_${a.id}`)).toBeNull();
  });
});

describe("QA N2: the sample data passes its own validation", () => {
  it("L-040 every sample client saves unchanged; GSTINs and PANs are format-valid; client landlines are accepted", async () => {
    const { updateClient, isGstin, isPan, formatPhone, toStoredAnyPhone } = await import("../src");
    for (const c of store.list<Record<string, string>>("clients")) {
      expect(() => updateClient(store, c.id!, { ...c, phone: c.phone ? formatPhone(c.phone) : "", whatsapp: c.whatsapp ? formatPhone(c.whatsapp) : "" } as never, owner), c.id).not.toThrow();
      if (c.gstin) expect(isGstin(c.gstin), c.gstin).toBe(true);
    }
    for (const v of store.list<{ gstin?: string }>("vendors")) if (v.gstin) expect(isGstin(v.gstin), v.gstin).toBe(true);
    expect(isPan(store.get<{ pan: string }>("workers/wMohanLal/private", "kyc")!.pan)).toBe(true);
    expect(isGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isGstin("27AAPFU0939F1ZW")).toBe(false); // wrong check character
    expect(toStoredAnyPhone("0522 2345678")).toBe("+915222345678");
    expect(toStoredAnyPhone("98765 43210")).toBe("+919876543210");
  });
});

describe("QA N10: the PM and the thekedars on their sites", () => {
  it("L-041 the PM opens a thekedar whose crew is on their site, and sees the contract without money", async () => {
    const { canRead } = await import("../src");
    const pmCtx = { role: "pm" as const, uid: "uPm", assignedProjectIds: ["projShivNagar", "projSharma"] };
    const t = store.get<Record<string, unknown>>("workers", "wMohanLal")!;
    expect(t.crewSiteIds).toEqual(["projShivNagar"]);
    expect(canRead("workers", t, pmCtx)).toBe(true);
    expect(canRead("workers", t, { ...pmCtx, assignedProjectIds: ["projGomti"] })).toBe(false);
    const scope = store.get<Record<string, unknown>>("contract_scopes", "tcShivNagarCC")!;
    expect(canRead("contract_scopes", scope, pmCtx)).toBe(true);
    expect(canRead("thekedar_contracts", scope, pmCtx)).toBe(false);
    expect(Object.keys(scope).some((k) => /Paise$/.test(k))).toBe(false); // no money on the copy
    expect(scope.measuredQtyMilli).toBeGreaterThan(0);
  });
});
