// Admin: staff sign-in rules (D-51), the audit log in plain words (PRD §3.1 rule 12), the usage meter (D-51) and the
// owner's backup (PRD §3.1 rule 16 as changed by D-51). IDs AD-xx are cited in docs/prd-traceability.md.
import { describe, expect, it } from "vitest";
import { MemoryStore, auditFor, canRead, runQuery, type CommandCtx } from "../src";
import {
  AUDIT_ENTITY_OPTIONS, BACKUP_COLLECTIONS, BACKUP_EXCLUDED, FREE_LIMITS, USAGE_COLLECTIONS, addToBackup, auditEntityLabel, auditFieldLabel, auditHref, auditLine,
  auditPageSpec, auditQuery, auditWhen, backupAgeDays, backupDue, backupFileName, backupParts, backupPlan, checkStaffPassword, istDayStartIso, markBackupFailed,
  newBackup, staffHandover, staffLoginEmail, staffLoginFor, usageLevel, usageMeters, type AuditRecord,
} from "../src/admin";
import { ADMIN_COMMANDS, recordBackup } from "../src/commands/admin";

const NOW = "2026-11-16T09:00:00.000Z"; // 14:30 IST, Monday 16 Nov 2026
const owner: CommandCtx = { uid: "uOwner", role: "owner", projectIds: [], nowIso: NOW };
const names = { uOwner: "Anil", uAcc: "Sunita" };

describe("staff sign-in (D-51)", () => {
  it("AD-01 a 10-digit mobile becomes <mobile>@staff.ambika; an email stays; anything else is refused", () => {
    expect(staffLoginEmail("9876543210")).toBe("9876543210@staff.ambika");
    expect(staffLoginEmail("+91 98765 43210")).toBe("9876543210@staff.ambika");
    expect(staffLoginEmail("098765-43210")).toBe("9876543210@staff.ambika");
    expect(staffLoginEmail(" Anil@Example.com ")).toBe("anil@example.com");
    for (const bad of ["", "   ", "12345", "5876543210", "anil@", "not an email@x", null, undefined]) expect(staffLoginEmail(bad)).toBeNull();
  });

  it("AD-02 a person signs in with their email when they have one, else with their mobile", () => {
    expect(staffLoginFor({ email: "sunita@example.com", phone: "+919876543210" })).toEqual({ email: "sunita@example.com", signInWith: "sunita@example.com", kind: "email" });
    expect(staffLoginFor({ email: "", phone: "+919876543210" })).toEqual({ email: "9876543210@staff.ambika", signInWith: "9876543210", kind: "mobile" });
    expect(staffLoginFor({ email: "", phone: "" })).toBeNull();
    expect(staffLoginFor({})).toBeNull();
  });

  it("AD-03 a first password: 8 to 64 characters, no spaces at the ends, not an easy one, not their own details", () => {
    expect(checkStaffPassword("")?.code).toBe("missing");
    expect(checkStaffPassword(undefined)?.code).toBe("missing");
    expect(checkStaffPassword("abc123")?.code).toBe("short");
    expect(checkStaffPassword("x".repeat(65))?.code).toBe("long");
    expect(checkStaffPassword("ab".repeat(33) + "c1")?.code).toBe("long");
    expect(checkStaffPassword(" gitti2026 ")?.code).toBe("spaces");
    for (const easy of ["password", "12345678", "aaaaaaaa", "abababab", "Ambika123"]) expect(checkStaffPassword(easy)?.code).toBe("easy");
    expect(checkStaffPassword("9876543210", { phone: "+919876543210" })?.code).toBe("own");
    expect(checkStaffPassword("ramkumar", { name: "Ram Kumar" })?.code).toBe("own");
    expect(checkStaffPassword("sunita.devi", { email: "sunita.devi@example.com" })?.code).toBe("own");
    expect(checkStaffPassword("gitti-2026", { name: "Ram Kumar", phone: "+919876543210" })).toBeNull();
    expect(checkStaffPassword("abc123")?.message).toBe("Use at least 8 letters or numbers.");
  });

  it("AD-04 what the owner hands over never contains the password", () => {
    const login = staffLoginFor({ phone: "+919876543210" })!;
    expect(staffHandover(login)).toBe("Sign in with: 9876543210 and the password you set");
    expect(staffHandover(login, "hi")).toContain("9876543210");
    expect(staffHandover(staffLoginFor({ email: "a@b.co" })!)).toBe("Sign in with: a@b.co and the password you set");
  });
});

describe("the audit log in plain words (PRD §3.1 rule 12)", () => {
  const rec = (over: Partial<AuditRecord>): AuditRecord => ({ id: "a1", entity: "expenses", entityId: "e1", action: "update", by: "uOwner", at: NOW, ...over });

  it("AD-05 an update names the fields that changed, in English and in Hindi", () => {
    expect(auditLine(rec({ fields: ["amountPaise", "date"] }), names)).toBe("Anil changed the amount and date of an expense");
    expect(auditLine(rec({ fields: ["amountPaise", "date", "projectId"] }), names)).toBe("Anil changed the amount, date and project of an expense");
    expect(auditLine(rec({ fields: ["amountPaise", "date"] }), names, "hi")).toBe("Anil ने खर्च में बदलाव किया: रकम और तारीख़");
    expect(auditLine(rec({ fields: [] }), names)).toBe("Anil changed an expense");
  });

  it("AD-06 more than three changed fields are counted, and the same label is never said twice", () => {
    expect(auditLine(rec({ fields: ["amountPaise", "date", "description", "mode", "billNo", "notes"] }), names)).toBe("Anil changed the amount, date, description and 3 more of an expense");
    expect(auditLine(rec({ fields: ["categoryId", "categoryPath"] }), names)).toBe("Anil changed the expense head of an expense");
  });

  it("AD-07 create, delete, approve, reject, lock, backup and password each have their own words", () => {
    expect(auditLine(rec({ action: "create" }), names)).toBe("Anil added an expense");
    expect(auditLine(rec({ action: "delete", entity: "projects" }), names)).toBe("Anil deleted a project");
    expect(auditLine(rec({ action: "approve", entity: "worker_payments", by: "uAcc" }), names)).toBe("Sunita approved a worker payment");
    expect(auditLine(rec({ action: "reject", entity: "worker_payments" }), names)).toBe("Anil rejected a worker payment");
    expect(auditLine(rec({ action: "lock", entity: "period_locks" }), names)).toBe("Anil locked a month");
    expect(auditLine(rec({ action: "backup", entity: "settings", entityId: "backup" }), names)).toBe("Anil downloaded a backup");
    expect(auditLine(rec({ action: "password", entity: "users" }), names)).toBe("Anil set a new password for a person");
    expect(auditLine(rec({ action: "create" }), names, "hi")).toBe("Anil ने नया रिकॉर्ड जोड़ा: खर्च");
    expect(auditLine(rec({ action: "something-new" }), names)).toBe("Anil changed an expense");
  });

  it("AD-08 unknown people, the system, unknown collections and unlisted fields still read as words", () => {
    expect(auditLine(rec({ by: "uGone", action: "create" }), names)).toBe("Someone added an expense");
    expect(auditLine(rec({ by: "system", action: "create" }), names)).toBe("The system added an expense");
    expect(auditLine(rec({ entity: "brand_new_things", action: "create" }), names)).toBe("Anil added a record");
    expect(auditEntityLabel("projects/p1/roster")).toBe("the workers on a site");
    expect(auditFieldLabel("defaultRatePaise")).toBe("default rate");
    expect(auditFieldLabel("amountPaise", "hi")).toBe("रकम");
  });

  it("AD-09 the line is built from what the runner writes for a real change", () => {
    const entry = auditFor("updateExpense", [{ collection: "expenses", id: "e1", before: { id: "e1", amountPaise: 100, date: "2026-11-01", updatedAt: "a" }, after: { id: "e1", amountPaise: 250, date: "2026-11-02", updatedAt: "b" } }], owner)!;
    expect(auditLine(entry as unknown as AuditRecord, names)).toBe("Anil changed the amount and date of an expense");
  });

  it("AD-10 an entry links to its record; detail records link to their project or worker", () => {
    expect(auditHref({ entity: "expenses", entityId: "e 1" })).toBe("/expenses/view/?id=e%201");
    expect(auditHref({ entity: "projects/p1/roster", entityId: "w1" })).toBe("/projects/view/?id=p1");
    expect(auditHref({ entity: "workers/w9/private", entityId: "pay" })).toBe("/labour/workers/view/?id=w9");
    expect(auditHref({ entity: "users", entityId: "u1" })).toBe("/settings/?tab=users");
    expect(auditHref({ entity: "settings", entityId: "backup" })).toBe("/settings/data/");
    expect(auditHref({ entity: "brand_new_things", entityId: "x" })).toBeNull();
  });

  it("AD-11 filters: what, who and an IST date range, newest first", () => {
    expect(auditQuery({})).toEqual({ where: [], orderBy: [{ field: "at", dir: "desc" }] });
    expect(istDayStartIso("2026-11-16")).toBe("2026-11-15T18:30:00.000Z");
    expect(auditQuery({ entity: "expenses", by: "uOwner", from: "2026-11-01", to: "2026-11-16" }).where).toEqual([
      { field: "entity", op: "==", value: "expenses" }, { field: "by", op: "==", value: "uOwner" },
      { field: "at", op: ">=", value: "2026-10-31T18:30:00.000Z" }, { field: "at", op: "<", value: "2026-11-16T18:30:00.000Z" },
    ]);
    expect(auditQuery({ from: "16/11/2026", to: "soon" }).where).toEqual([]);
    for (const e of AUDIT_ENTITY_OPTIONS) expect(auditEntityLabel(e)).not.toBe("a record");
  });

  it("AD-12 the filters pick the right entries from a list, a page at a time, never the whole collection", () => {
    const all: AuditRecord[] = [];
    for (let i = 0; i < 60; i++) all.push(rec({ id: `a${String(i).padStart(2, "0")}`, entity: i % 2 ? "expenses" : "projects", by: i % 3 ? "uOwner" : "uAcc", at: new Date(Date.parse("2026-11-10T00:00:00Z") + i * 3_600_000).toISOString() }));
    const first = runQuery(all, auditPageSpec({}, 25));
    expect(first.items).toHaveLength(25);
    expect(first.total).toBe(60);
    expect(first.items[0]!.id).toBe("a59");
    expect(runQuery(all, auditPageSpec({}, 25, first.next)).items[0]!.id).toBe("a34");
    expect(auditPageSpec({}, 500).limit).toBe(25);
    expect(auditPageSpec({}, 50).limit).toBe(50);
    const mine = runQuery(all, auditPageSpec({ entity: "expenses", by: "uAcc" }, 50));
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((r) => r.entity === "expenses" && r.by === "uAcc")).toBe(true);
    // 11 Nov IST runs from 10 Nov 18:30 UTC to 11 Nov 18:30 UTC: 24 hourly entries.
    const day = runQuery(all, auditPageSpec({ from: "2026-11-11", to: "2026-11-11" }, 50));
    expect(day.total).toBe(24);
  });

  it("AD-13 the time is shown in IST; the owner, accountant and CA read the log, nobody else", () => {
    expect(auditWhen("2026-11-16T10:15:00.000Z")).toMatch(/16 Nov 2026.*3:45/);
    expect(auditWhen("nonsense")).toBe("");
    const can = (role: CommandCtx["role"]) => canRead("audit_log", {}, { role, uid: "u", assignedProjectIds: ["p1"] });
    expect([can("owner"), can("accountant"), can("ca")]).toEqual([true, true, true]);
    expect([can("pm"), can("supervisor"), can("viewer")]).toEqual([false, false, false]);
  });
});

describe("the usage meter (D-51: the free plan)", () => {
  it("AD-14 warnings start at 70% and 90%; 69.9% is still fine", () => {
    expect([usageLevel(0), usageLevel(69.9), usageLevel(70), usageLevel(89.9), usageLevel(90), usageLevel(99.9), usageLevel(100)]).toEqual(["ok", "ok", "warning", "warning", "critical", "critical", "full"]);
  });

  it("AD-15 four meters against the free limits: stored data, photos, reads and writes today", () => {
    const r = usageMeters({ counts: { expenses: 12_000, attendance: 30_000, audit_log: 8_000 }, files: { files: 5_600, bytes: 560_000_000 }, day: { reads: 45_500, writes: 3_000 } });
    expect(r.documents).toBe(50_000);
    const by = Object.fromEntries(r.meters.map((m) => [m.key, m]));
    expect(by.storage!.used).toBe(560_000_000 + 50_000 * 1_000 + 5_600 * 8_000);
    expect(by.storage!.limit).toBe(1024 * 1024 * 1024);
    expect(by.storage!.level).toBe("ok");
    expect(by.photos).toMatchObject({ used: 5_600, limit: 8_000, percent: 70, level: "warning", measured: true });
    expect(by.reads).toMatchObject({ used: 45_500, limit: 50_000, percent: 91, level: "critical" });
    expect(by.writes).toMatchObject({ used: 3_000, limit: 20_000, percent: 15, level: "ok" });
    expect(r.worst).toBe("critical");
    expect(FREE_LIMITS).toEqual({ storedBytes: 1_073_741_824, readsPerDay: 50_000, writesPerDay: 20_000, photos: 8_000 });
  });

  it("AD-16 reads and writes that nothing has counted are 'not measured', never shown as zero use or as a warning", () => {
    const r = usageMeters({ counts: {}, files: { files: 0, bytes: 0 }, day: null });
    expect(r.meters.find((m) => m.key === "reads")).toMatchObject({ measured: false, level: "ok", used: 0 });
    expect(r.meters.find((m) => m.key === "writes")!.measured).toBe(false);
    expect(r.worst).toBe("ok");
    const full = usageMeters({ counts: { expenses: -5, clients: Number.NaN }, files: { files: 9_000, bytes: 0 }, day: { writes: 20_000 } });
    expect(full.documents).toBe(0);
    expect(full.meters.find((m) => m.key === "photos")!.level).toBe("full");
    expect(full.meters.find((m) => m.key === "writes")).toMatchObject({ level: "full", measured: true });
    expect(full.meters.find((m) => m.key === "reads")!.measured).toBe(false);
    expect(USAGE_COLLECTIONS).toContain("expenses");
    expect(USAGE_COLLECTIONS).not.toContain("file_blobs");
  });
});

describe("the owner's backup (PRD §3.1 rule 16, D-51)", () => {
  it("AD-17 the plan lists every collection once, in order, with the lists kept under projects and workers; keys and photo bytes are never in it", () => {
    const plan = backupPlan();
    expect(plan.steps.map((s) => s.collection)).toEqual([...BACKUP_COLLECTIONS]);
    expect(plan.steps[0]).toMatchObject({ collection: "settings", order: 1, pageSize: 50 });
    expect(plan.steps.map((s) => s.order)).toEqual(plan.steps.map((_, i) => i + 1));
    expect(plan.steps.find((s) => s.collection === "projects")!.children).toContain("roster");
    expect(plan.steps.find((s) => s.collection === "workers")!.children).toEqual(["private", "project_terms"]);
    expect(plan.steps.findIndex((s) => s.collection === "users")).toBeLessThan(plan.steps.findIndex((s) => s.collection === "expenses"));
    expect(plan.steps[plan.steps.length - 1]!.collection).toBe("audit_log");
    for (const no of ["private_config", "file_blobs", "command_requests"]) {
      expect(BACKUP_EXCLUDED).toContain(no);
      expect(BACKUP_COLLECTIONS).not.toContain(no);
    }
    expect(backupPlan(["expenses", "private_config", "expenses", "", "clients"]).steps.map((s) => s.collection)).toEqual(["expenses", "clients"]);
  });

  it("AD-18 the file name carries the day", () => {
    expect(backupFileName("2026-11-16")).toBe("ambika-crm-backup-2026-11-16.json");
    expect(backupFileName("today")).toBe("ambika-crm-backup-undated.json");
  });

  it("AD-19 the file is { meta, collections: { name: docs[] } }, built a page at a time, and its pieces join into the same JSON", () => {
    const b = newBackup({ madeAt: NOW, by: "uOwner", byName: "Anil", mode: "demo" });
    addToBackup(b, "expenses", [{ id: "e1", amountPaise: 100 }, { id: "e2", note: "he said \"ok\", 5₹" }]);
    addToBackup(b, "expenses", [{ id: "e3" }]);
    addToBackup(b, "clients", []);
    addToBackup(b, "projects/p1/roster", [{ id: "w1" }]);
    markBackupFailed(b, "invoices");
    markBackupFailed(b, "invoices");
    expect(b.meta).toMatchObject({ app: "ambika-crm", version: 1, date: "2026-11-16", by: "uOwner", counts: { expenses: 3, clients: 0, "projects/p1/roster": 1 }, total: 4, failed: ["invoices"] });
    const parts = backupParts(b);
    expect(parts.length).toBeGreaterThan(6);
    expect(JSON.parse(parts.join(""))).toEqual(JSON.parse(JSON.stringify(b)));
    expect(Object.keys(JSON.parse(parts.join("")))).toEqual(["meta", "collections"]);
    const empty = newBackup({ madeAt: NOW, by: "u", byName: "", mode: "demo" });
    expect(JSON.parse(backupParts(empty).join(""))).toEqual({ meta: JSON.parse(JSON.stringify(empty.meta)), collections: {} });
  });

  it("AD-20 a reminder is due when there was never a backup, or the last one is 7 or more days old", () => {
    expect(backupDue(null, "2026-11-16")).toBe(true);
    expect(backupDue("", "2026-11-16")).toBe(true);
    expect(backupDue("garbage", "2026-11-16")).toBe(true);
    expect(backupDue("2026-11-10T06:00:00.000Z", "2026-11-16")).toBe(false);
    expect(backupDue("2026-11-09T06:00:00.000Z", "2026-11-16")).toBe(true);
    // 9 Nov 20:00 UTC is already 10 Nov in India: six days, not yet due.
    expect(backupDue("2026-11-09T20:00:00.000Z", "2026-11-16")).toBe(false);
    expect(backupAgeDays("2026-11-09T06:00:00.000Z", "2026-11-16")).toBe(7);
    expect(backupAgeDays(null, "2026-11-16")).toBeNull();
  });

  it("AD-21 recordBackup: the owner only; writes settings/backup with when, who and the counts, and an audit entry", () => {
    const store = new MemoryStore();
    const out = recordBackup(store, { counts: { expenses: 120, clients: 8 } }, owner);
    expect(out).toEqual({ id: "backup", lastBackupAt: NOW, by: "uOwner", counts: { expenses: 120, clients: 8 }, total: 128, complete: true });
    expect(store.get("settings", "backup")).toMatchObject({ lastBackupAt: NOW, by: "uOwner", total: 128 });
    const audit = store.list<AuditRecord>("audit_log");
    expect(audit).toHaveLength(1);
    expect(auditLine(audit[0]!, names)).toBe("Anil downloaded a backup");
    expect(backupDue(out.lastBackupAt, "2026-11-16")).toBe(false);
    for (const role of ["accountant", "pm", "supervisor", "viewer", "ca"] as const) {
      expect(() => recordBackup(store, { counts: { expenses: 1 } }, { ...owner, uid: "uX", role })).toThrow("Your role can't download a backup.");
    }
    expect(Object.keys(ADMIN_COMMANDS)).toEqual(["recordBackup"]);
  });

  it("AD-22 recordBackup refuses counts it cannot read, and an incomplete file does not move the last backup's date", () => {
    const store = new MemoryStore();
    for (const bad of [{}, { counts: {} }, { counts: { expenses: -1 } }, { counts: { expenses: 1.5 } }, { counts: { "bad name!": 1 } }, { counts: [1] }]) {
      expect(() => recordBackup(store, bad as never, owner)).toThrow("The backup could not be noted. Download it again.");
    }
    expect(store.get("settings", "backup")).toBeNull();
    recordBackup(store, { counts: { expenses: 5 } }, { ...owner, nowIso: "2026-11-01T09:00:00.000Z" });
    const later = recordBackup(store, { counts: { expenses: 5 }, complete: false }, owner);
    expect(later).toMatchObject({ lastBackupAt: "2026-11-01T09:00:00.000Z", complete: false });
    expect(backupDue(later.lastBackupAt, "2026-11-16")).toBe(true);
  });
});
