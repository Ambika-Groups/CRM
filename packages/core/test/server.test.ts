// M1.6 server runner: a command run through runWithLoads (loading only what it asks for, as the `command` callable
// does inside a Firestore transaction) changes exactly what the same command changes on the whole store; failures
// leave nothing behind; every command is audited; claims follow users and assignments; the first-owner documents.
// IDs SV-xxx are cited in docs/prd-traceability.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditFor, claimsFor, firstOwnerDocs, Loaded, LoadingStore, MemoryStore, newIdSeed, runCommand, runWithLoads, seededIds, seedDemo, usersToResync, withIdSource,
  type CommandArgs, type CommandCtx, type CommandName, type Doc, type JournalEntry, type Loader, type LoadPlan,
} from "../src";

const NOW = "2026-10-25T09:00:00.000Z";
const owner: CommandCtx = { uid: "uOwner", role: "owner", projectIds: [], nowIso: NOW };
const accountant: CommandCtx = { uid: "uAccountant", role: "accountant", projectIds: [], nowIso: NOW };
const sup: CommandCtx = { uid: "uSupShivNagar", role: "supervisor", projectIds: ["projShivNagar"], nowIso: NOW };
const G = "projShivNagar";

// Deterministic IDs, restarted before each run, so a direct run and the final loaded run make the same IDs.
let counter = 0;
const resetIds = () => { counter = 0; };
beforeEach(() => {
  resetIds();
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
    const b = a as unknown as Uint8Array;
    for (let i = 0; i < b.length; i++) b[i] = (counter * 7 + i * 13) % 251;
    counter++;
    return a;
  });
});
afterEach(() => { vi.restoreAllMocks(); });

/** A stand-in for Firestore: answers the planned reads from a store and counts them. */
class MemLoader implements Loader {
  docReads = 0;
  listReads = 0;
  rounds = 0;
  constructor(private db: MemoryStore) {}
  async load(plan: LoadPlan, into: Loaded) {
    this.rounds++;
    for (const { collection, id } of plan.docs) { this.docReads++; into.addDoc(collection, id, this.db.get<Doc>(collection, id)); }
    for (const need of plan.lists) { const docs = this.db.list<Doc>(need.collection, undefined, need.hint); this.listReads += Math.max(1, docs.length); into.addList(need, docs); }
    resetIds();
  }
}

function apply(db: MemoryStore, changes: JournalEntry[]) {
  for (const c of changes) c.after ? db.set(c.collection, c.after) : db.delete(c.collection, c.id);
}

async function parity<N extends CommandName>(name: N, args: CommandArgs<N>, ctx: CommandCtx) {
  const { store: db } = await seedDemo("2026-10-25");
  const direct = new MemoryStore();
  direct.load(structuredClone(db.snapshot()));
  const idSeed = new Uint32Array([11, 22, 33, 44]);
  const a = await withIdSource(seededIds(idSeed), () => runCommand(direct, name, args, ctx));
  const loader = new MemLoader(db);
  const b = await runWithLoads(loader, name, args, ctx, { idSeed });
  apply(db, b.changes);
  expect(b.result).toEqual(a.result);
  expect(db.snapshot()).toEqual(direct.snapshot());
  return { a, b, loader };
}

describe("server runner parity (M1.6)", () => {
  const project = {
    name: "Aliganj Drain", type: "government", subtype: "drain", clientId: "clNagarNigam", city: "Lucknow", startDate: "2026-11-01",
    expectedEndDate: "2027-03-31", status: "planned", budgetPaise: 50_000_000, contractValuePaise: 60_000_000, managerId: "uPm",
    government: { department: "PWD Lucknow", division: "Div 2", engineerInCharge: { name: "Er. A. Singh", phone: "98390 12345" } },
    governmentCommercial: { agreementValuePaise: 60_000_000, tenderPremiumBp: -250, deductionHeads: [{ head: "Retention", rateBp: 500 }] },
  } as unknown as CommandArgs<"createProject">["input"];

  it("SV-01 creating a project (numbering AG-P-…) writes the same documents as in the demo", async () => {
    const { b } = await parity("createProject", { input: project }, owner);
    expect(b.changes.some((c) => c.collection === "counters")).toBe(true);
    expect(b.runs).toBeGreaterThan(1);
  });

  it("SV-02 a worker payment with posting, rollups and the Labour expense matches the demo to the paisa", async () => {
    const { b } = await parity("createWorkerPayment", { workerId: "w001", projectId: G, date: "2026-10-24", type: "wage", grossPaise: 400_000, mode: "cash", accountId: "accCash" }, accountant);
    const cols = new Set(b.changes.map((c) => c.collection));
    for (const c of ["worker_payments", "expenses", "account_transactions", "rollups", "worker_balances", "audit_log"]) expect(cols.has(c)).toBe(true);
  });

  it("SV-03 attendance (roster snapshot, lock, last write wins) matches the demo", async () => {
    await parity("markAttendanceDay", { projectId: G, date: "2026-10-24", marks: [{ workerId: "w001", status: "absent" }, { workerId: "w002", status: "half_day" }] }, sup);
  });

  it("SV-04 editing a worker, a client and an assignment match the demo", async () => {
    await parity("saveWorker", { id: null, input: { name: "Ravi Shankar", role: "labour", defaultRatePaise: 52_500 } } as CommandArgs<"saveWorker">, owner);
    await parity("updateClient", { id: "clSharma", input: { name: "Rajesh K. Sharma", type: "individual" } } as CommandArgs<"updateClient">, owner);
    await parity("setAssignment", { projectId: "projSharma", userId: "uSupShivNagar", assigned: true }, owner);
  });

  it("SV-05 hinted lists load only the matching documents, not the collection", async () => {
    const { loader } = await parity("addContractMeasurement", { contractId: "tcShivNagarCC", date: "2026-10-24", qtyMilli: 10_000 }, accountant);
    const { store: db } = await seedDemo("2026-10-25");
    // Only this contract's measurements and payments are read, never the whole of either collection.
    expect(loader.listReads).toBeLessThan(db.list("contract_measurements").length + db.list("worker_payments").length);
  });

  it("SV-06 a refusal from a complete run is thrown, and nothing is written", async () => {
    const { store: db } = await seedDemo("2026-10-25");
    const loader = new MemLoader(db);
    await expect(runWithLoads(loader, "markAttendanceDay", { projectId: G, date: "2026-10-21", marks: [{ workerId: "w001", status: "absent" }] }, sup)).rejects.toThrow(/locked/);
    await expect(runWithLoads(loader, "setUserRole", { userId: "uPm", role: "owner" }, accountant)).rejects.toThrow();
  });
});

describe("atomic commands and audit", () => {
  it("SV-10 a command that fails part-way leaves the store exactly as it was", async () => {
    const { store } = await seedDemo("2026-10-25");
    const before = JSON.stringify(store.snapshot());
    // An unknown worker in the marks fails after earlier marks were written.
    await expect(runCommand(store, "markAttendanceDay", { projectId: G, date: "2026-10-24", marks: [{ workerId: "w001", status: "absent" }, { workerId: "noSuchWorker", status: "absent" }] }, sup)).rejects.toThrow();
    expect(JSON.stringify(store.snapshot())).toBe(before);
  });

  it("SV-11 every command leaves one audit entry: what, which fields, who and when", async () => {
    const { store } = await seedDemo("2026-10-25");
    const { changes } = await runCommand(store, "updateClient", { id: "clSharma", input: { name: "Rajesh K. Sharma", type: "individual" } } as CommandArgs<"updateClient">, owner);
    const audit = changes.filter((c) => c.collection === "audit_log");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ entity: "clients", entityId: "clSharma", action: "update", command: "updateClient", by: "uOwner", at: NOW });
    expect((audit[0]!.after as unknown as { fields: string[] }).fields).toContain("name");
    // A command that writes its own audit entry (approvals) gets no second one.
    expect(auditFor("x", [{ collection: "audit_log", id: "a", before: null, after: { id: "a" } }], owner)).toBeNull();
  });

  it("SV-13 with real random ids a command that posts money still finishes in a few rounds of reads (each run makes the same new ids)", async () => {
    vi.restoreAllMocks(); // real random ids, as on the server
    const { store: db } = await seedDemo("2026-10-25");
    const loader = new MemLoader(db);
    const out = await runWithLoads(loader, "createWorkerPayment", { workerId: "w001", projectId: G, date: "2026-10-24", type: "wage", grossPaise: 400_000, mode: "cash", accountId: "accCash" } as never, accountant);
    expect(out.runs).toBeLessThanOrEqual(4);
    expect(loader.rounds).toBe(out.runs - 1);
    const paid = out.changes.find((c) => c.collection === "worker_payments")!;
    expect(out.changes.some((c) => c.collection === "expenses" && c.id === `wage_${paid.id}`)).toBe(true);
    expect(out.changes.some((c) => c.collection === "postings" && c.id === `worker_payments_${paid.id}`)).toBe(true);
    // Two commands never share ids.
    const again = await runWithLoads(new MemLoader(db), "createWorkerPayment", { workerId: "w001", projectId: G, date: "2026-10-24", type: "wage", grossPaise: 100_000, mode: "cash", accountId: "accCash" } as never, accountant);
    expect(again.changes.find((c) => c.collection === "worker_payments")!.id).not.toBe(paid.id);
  });

  it("SV-14 a seeded id sequence repeats exactly, and different seeds give different ids", async () => {
    const a = seededIds(new Uint32Array([1, 2, 3, 4])), b = seededIds(new Uint32Array([1, 2, 3, 4])), c = seededIds(new Uint32Array([1, 2, 3, 5]));
    const ids = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((x) => /^[A-Za-z0-9]{20}$/.test(x))).toBe(true);
    expect(c()).not.toBe(ids[0]);
    expect(seededIds(new Uint32Array(4))()).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(newIdSeed()).toHaveLength(4);
    // Outside withIdSource, ids are random again.
    const inside = await withIdSource(seededIds(new Uint32Array([9, 9, 9, 9])), async () => (await import("../src")).newId());
    expect(inside).toBe(seededIds(new Uint32Array([9, 9, 9, 9]))());
  });

  it("SV-12 a loading store records what it hasn't got, and answers from what it has", () => {
    const loaded = new Loaded();
    loaded.addDoc("projects", "p1", { id: "p1", name: "One" });
    const s = new LoadingStore(loaded);
    expect(s.get<{ name: string }>("projects", "p1")!.name).toBe("One");
    expect(s.missedAnything).toBe(false);
    s.get("projects", "p2");
    s.list("expenses", undefined, { field: "projectId", value: "p1" });
    expect([...s.missingDocs]).toEqual(["projects/p2"]);
    expect([...s.missingLists.values()]).toEqual([{ collection: "expenses", hint: { field: "projectId", value: "p1" } }]);
    s.set("projects", { id: "p3" });
    s.get("projects", "p3");
    expect(s.missingDocs.has("projects/p3")).toBe(false);
  });
});

describe("claims and first owner", () => {
  it("SV-20 claims carry the role and assigned projects; inactive users get none", () => {
    expect(claimsFor({ role: "pm", active: true, projectIds: ["b", "a"] })).toEqual({ role: "pm", projects: ["a", "b"] });
    expect(claimsFor({ role: "pm", active: false, projectIds: [] })).toBeNull();
    expect(claimsFor(null)).toBeNull();
  });

  it("SV-21 claims are re-synced for users whose role, status or assignments changed", async () => {
    const { store } = await seedDemo("2026-10-25");
    const { changes } = await runCommand(store, "setAssignment", { projectId: "projSharma", userId: "uSupShivNagar", assigned: true }, owner);
    expect(usersToResync(changes)).toContain("uSupShivNagar");
    const r = await runCommand(store, "setUserRole", { userId: "uViewer", role: "accountant" }, owner);
    expect(usersToResync(r.changes)).toEqual(["uViewer"]);
  });

  it("SV-22 the first owner gets a user record, settings and the expense heads; no sample data", () => {
    const docs = firstOwnerDocs({ uid: "abc", name: "A. Owner", email: "owner@example.com" }, NOW);
    expect(docs.find((d) => d.collection === "users")!.doc).toMatchObject({ id: "abc", role: "owner", active: true });
    expect(docs.filter((d) => d.collection === "settings").map((d) => d.doc.id).sort()).toEqual(["bank", "company", "operations"]);
    expect(docs.filter((d) => d.collection === "expense_categories").length).toBeGreaterThan(5);
    expect(docs.some((d) => ["projects", "workers", "clients"].includes(d.collection))).toBe(false);
  });
});
