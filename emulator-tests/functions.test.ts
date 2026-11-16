// The Cloud Functions' logic against the Firestore and Auth emulators (CI): the transactional `command` runner, sign-in
// claims, and Setup & integrations (D-48, D-49). The callables are thin wrappers, so these call the same functions they do.
// IDs FN-xxx are cited in docs/prd-traceability.md.
import { seedDemo } from "@ag/core";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleApi, type ApiDeps } from "../functions/src/api";
import { executeCommand } from "../functions/src/command";
import { cleanUp } from "../functions/src/maintenance";
import { loadSample, removeSample, sampleStatus } from "../functions/src/sample";
import {
  clearIntegration, handleEnquiry, recordBrowserTest, rotateWebsiteKey, saveIntegration, serverChecks, testIntegration, websiteKeyMatches,
} from "../functions/src/setup";

const PROJECT = "demo-ambika";
process.env.GCLOUD_PROJECT = PROJECT;
const app = initializeApp({ projectId: PROJECT });
// The same transport the server part uses on Netlify (functions/src/admin.ts): the Admin SDK's default.
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const auth = getAuth(app);

const FIRESTORE = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"}`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`;

async function reset() {
  await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
}

async function seed() {
  const { store } = await seedDemo("2026-10-25");
  const writes: Promise<unknown>[] = [];
  for (const [col, docs] of Object.entries(store.snapshot())) for (const d of docs) writes.push(db.doc(`${col}/${d.id}`).set(JSON.parse(JSON.stringify(d))));
  for (let i = 0; i < writes.length; i += 300) await Promise.all(writes.slice(i, i + 300));
}

beforeAll(async () => { await reset(); });
beforeEach(async () => { await reset(); await seed(); });

const NOW = new Date("2026-10-25T09:00:00.000Z");
const run = (uid: string, name: string, args: unknown, requestId = `req_${Math.random().toString(36).slice(2, 12)}`) =>
  executeCommand(db, auth, { uid, name, args, requestId }, () => NOW);

const fresh = (uid: string) => ({ uid, authTime: Math.floor(NOW.getTime() / 1000) - 60 });
const stale = (uid: string) => ({ uid, authTime: Math.floor(NOW.getTime() / 1000) - 3600 });
const now = () => NOW;

describe("command runner (transaction, posting, audit, replay)", () => {
  const project = {
    name: "Aliganj Drain", type: "government", subtype: "drain", clientId: "clNagarNigam", city: "Lucknow", startDate: "2026-11-01",
    expectedEndDate: "2027-03-31", status: "planned", budgetPaise: 50_000_000, contractValuePaise: 60_000_000, managerId: "uPm",
    government: { department: "PWD Lucknow", division: "Div 2", engineerInCharge: { name: "Er. A. Singh", phone: "98390 12345" } },
    governmentCommercial: { agreementValuePaise: 60_000_000, tenderPremiumBp: -250, deductionHeads: [{ head: "Retention", rateBp: 500 }] },
  };

  it("FN-01 a command writes its records, the number counter and one audit entry in one transaction", async () => {
    const out = await run("uOwner", "createProject", { input: project });
    const id = out.result as string;
    const p = (await db.doc(`projects/${id}`).get()).data();
    expect(p?.name).toBe("Aliganj Drain");
    expect(p?.code).toMatch(/^AG-P-\d{4}$/);
    const audit = await db.collection("audit_log").where("entityId", "==", id).get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0]!.data()).toMatchObject({ entity: "projects", action: "create", command: "createProject", by: "uOwner" });
  });

  it("FN-02 the same request id never runs twice: a retry gets the first result", async () => {
    const a = await run("uOwner", "createProject", { input: project }, "same_request_1");
    const b = await run("uOwner", "createProject", { input: project }, "same_request_1");
    expect(b.replayed).toBe(true);
    expect(b.result).toBe(a.result);
    expect((await db.collection("projects").where("name", "==", "Aliganj Drain").get()).size).toBe(1);
  });

  it("FN-03 a refusal changes nothing, and a switched-off person cannot run commands", async () => {
    const before = (await db.collection("clients").get()).size;
    await expect(run("uPm", "createProject", { input: project })).rejects.toThrow();
    expect((await db.collection("clients").get()).size).toBe(before);
    await db.doc("users/uPm").update({ active: false });
    await expect(run("uPm", "markAttendanceDay", { projectId: "projShivNagar", date: "2026-10-24", marks: [] })).rejects.toThrow(/switched off/);
    await expect(run("nobody", "createProject", { input: project })).rejects.toThrow(/switched off/);
  });

  it("FN-04 a worker payment posts the Labour expense, the account entry and the rollups together", async () => {
    await run("uAccountant", "createWorkerPayment", { workerId: "w001", projectId: "projShivNagar", date: "2026-10-24", type: "wage", grossPaise: 400_000, mode: "cash", accountId: "accCash" });
    const wp = await db.collection("worker_payments").where("workerId", "==", "w001").where("date", "==", "2026-10-24").get();
    expect(wp.size).toBeGreaterThan(0);
    const id = wp.docs[0]!.id;
    expect((await db.doc(`expenses/wage_${id}`).get()).data()).toMatchObject({ amountPaise: 400_000, source: "wage" });
    expect((await db.doc(`account_transactions/worker_payments_${id}`).get()).exists).toBe(true);
    expect((await db.doc("rollups/co_2026-10").get()).exists).toBe(true);
  });
});

describe("sign-in claims (D-05)", () => {
  it("FN-10 adding a person creates their sign-in with the same id and sets their claims; a taken email is refused cleanly", async () => {
    const out = await run("uOwner", "createUser", { name: "Ravi Kumar", email: "ravi@example.com", role: "pm" });
    const id = out.result as string;
    const u = await auth.getUser(id);
    expect(u.email).toBe("ravi@example.com");
    expect(u.customClaims).toMatchObject({ role: "pm", projects: [] });
    await expect(run("uOwner", "createUser", { name: "Ravi Two", email: "ravi@example.com", role: "pm" })).rejects.toThrow(/already has an account/);
    expect((await db.collection("users").where("email", "==", "ravi@example.com").get()).size).toBe(1);
  });

  it("FN-11 a role change, switching off, and an assignment update the person's claims", async () => {
    await auth.createUser({ uid: "uPm", email: "pm@example.com" });
    await run("uOwner", "setAssignment", { projectId: "projShivNagar", userId: "uPm", assigned: false });
    await run("uOwner", "setAssignment", { projectId: "projShivNagar", userId: "uPm", assigned: true });
    expect((await auth.getUser("uPm")).customClaims?.projects ?? []).toContain("projShivNagar");
    await run("uOwner", "setUserRole", { userId: "uPm", role: "viewer" });
    expect((await auth.getUser("uPm")).customClaims?.role).toBe("viewer");
    await run("uOwner", "setUserActive", { userId: "uPm", active: false });
    const off = await auth.getUser("uPm");
    expect(off.disabled).toBe(true);
    expect(off.customClaims ?? {}).toEqual({});
  });

  it("FN-12 super user is a claim for owners only, and granting it is for a super user", async () => {
    await auth.createUser({ uid: "uAccountant", email: "acc@example.com" });
    await run("uOwner", "setUserRole", { userId: "uAccountant", role: "owner" });
    await run("uOwner", "setSuperUser", { userId: "uAccountant", superUser: true });
    expect((await auth.getUser("uAccountant")).customClaims).toMatchObject({ role: "owner", superUser: true });
    await expect(run("uPm", "setSuperUser", { userId: "uPm", superUser: true })).rejects.toThrow();
  });
});

describe("Setup & integrations (D-48, D-49)", () => {
  const email = { integration: "email", values: { apiKey: "re_abcdefghijklmnop1234", fromAddress: "alerts@ambika.in" } };

  it("FN-20 only a super user saves, and only after a sign-in within 5 minutes", async () => {
    await expect(saveIntegration(db, fresh("uAccountant"), email, now)).rejects.toThrow(/super user/);
    await db.doc("users/uPm").update({ superUser: true });
    await expect(saveIntegration(db, fresh("uPm"), email, now)).rejects.toThrow(/super user/);
    await expect(saveIntegration(db, stale("uOwner"), email, now)).rejects.toThrow(/sign in again/i);
    const saved = await saveIntegration(db, fresh("uOwner"), email, now);
    expect(saved.masked.apiKey).toBe("••••1234");
  });

  it("FN-21 the secret goes only to the server-only document; the readable one holds the mask and public values", async () => {
    await saveIntegration(db, fresh("uOwner"), email, now);
    const readable = JSON.stringify((await db.doc("integrations/email").get()).data());
    expect(readable).not.toContain("re_abcdefghijklmnop1234");
    expect(readable).toContain("alerts@ambika.in");
    expect((await db.doc("private_config/email").get()).data()?.secrets.apiKey).toBe("re_abcdefghijklmnop1234");
    // A second save with the key left blank keeps it.
    await saveIntegration(db, fresh("uOwner"), { integration: "email", values: { fromAddress: "billing@ambika.in" } }, now);
    expect((await db.doc("private_config/email").get()).data()?.secrets.apiKey).toBe("re_abcdefghijklmnop1234");
  });

  it("FN-22 every change is audited by field name, and the audit entry never holds a value", async () => {
    await saveIntegration(db, fresh("uOwner"), email, now);
    await clearIntegration(db, fresh("uOwner"), "email", now);
    const audit = (await db.collection("audit_log").where("entity", "==", "integrations").get()).docs.map((d) => d.data());
    expect(audit.map((a) => a.action).sort()).toEqual(["clear", "save"]);
    const text = JSON.stringify(audit);
    expect(text).not.toContain("re_abcdefghijklmnop1234");
    expect(text).not.toContain("alerts@ambika.in");
    expect(audit.find((a) => a.action === "save")).toMatchObject({ by: "uOwner", fields: expect.arrayContaining(["apiKey", "fromAddress"]) });
    expect((await db.doc("private_config/email").get()).exists).toBe(false);
  });

  it("FN-23 wrong values are refused with the field named; an unavailable service is refused", async () => {
    await expect(saveIntegration(db, fresh("uOwner"), { integration: "email", values: { apiKey: "nope", fromAddress: "x" } }, now)).rejects.toMatchObject({ fields: expect.objectContaining({ apiKey: expect.any(String) }) });
    await expect(saveIntegration(db, fresh("uOwner"), { integration: "whatsapp", values: { token: "t", phoneNumberId: "123456789" } }, now)).rejects.toThrow(/later phase/);
    await expect(saveIntegration(db, fresh("uOwner"), { integration: "nothing", values: {} }, now)).rejects.toThrow();
  });

  it("FN-24 the website key is shown once and only its hash is kept; the endpoint accepts it and refuses others", async () => {
    const { key, status } = await rotateWebsiteKey(db, fresh("uOwner"), now);
    expect(key).toMatch(/^agw_/);
    expect(status.masked.apiKey).toBe(`••••${key.slice(-4)}`);
    const stored = JSON.stringify((await db.doc("private_config/websiteLink").get()).data());
    expect(stored).not.toContain(key);
    expect(await websiteKeyMatches(db, key)).toBe(true);
    expect(await websiteKeyMatches(db, `${key}x`)).toBe(false);
    const body = { dryRun: true, name: "Test Enquiry", phone: "98765 43210" };
    expect((await handleEnquiry(db, "GET", `Bearer ${key}`, body)).status).toBe(405);
    expect((await handleEnquiry(db, "POST", "Bearer wrong", body)).status).toBe(401);
    expect((await handleEnquiry(db, "POST", `Bearer ${key}`, { dryRun: true, name: "X" })).status).toBe(400);
    expect(await handleEnquiry(db, "POST", `Bearer ${key}`, body)).toEqual({ status: 200, body: { accepted: true, dryRun: true } });
    expect((await handleEnquiry(db, "POST", `Bearer ${key}`, { ...body, dryRun: false })).status).toBe(501);
    // A new key stops the old one.
    const next = await rotateWebsiteKey(db, fresh("uOwner"), now);
    expect(await websiteKeyMatches(db, key)).toBe(false);
    expect(await websiteKeyMatches(db, next.key)).toBe(true);
  });

  it("FN-25 Tests record Pass or Fail with the time, and keep the last time one passed", async () => {
    await saveIntegration(db, fresh("uOwner"), email, now);
    const ok = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const denied = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const pass = await testIntegration(db, fresh("uOwner"), { integration: "email" }, { fetcher: ok, now, superUserEmail: "owner@example.com" });
    expect(pass.ok).toBe(true);
    const after = (await db.doc("integrations/email").get()).data();
    expect(after?.test).toMatchObject({ ok: true, at: NOW.toISOString() });
    expect(after?.lastOkAt).toBe(NOW.toISOString());
    const fail = await testIntegration(db, fresh("uOwner"), { integration: "email" }, { fetcher: denied, now, superUserEmail: "owner@example.com" });
    expect(fail).toMatchObject({ ok: false, hint: expect.any(String) });
    const again = (await db.doc("integrations/email").get()).data();
    expect(again?.test.ok).toBe(false);
    expect(again?.lastOkAt).toBe(NOW.toISOString());
    // Changing a setting clears the result, so "verified" never outlives the change.
    await saveIntegration(db, fresh("uOwner"), { integration: "email", values: { fromAddress: "billing@ambika.in" } }, now);
    expect((await db.doc("integrations/email").get()).data()?.test).toBeNull();
  });

  it("FN-26 the browser reports its Tests through recordBrowserTest, for a super user only", async () => {
    await recordBrowserTest(db, fresh("uOwner"), { integration: "functions", ok: true, message: "The server functions answered." }, now);
    expect((await db.doc("integrations/functions").get()).data()?.test).toMatchObject({ ok: true, message: "The server functions answered." });
    await expect(recordBrowserTest(db, fresh("uPm"), { integration: "functions", ok: true, message: "x" }, now)).rejects.toThrow(/super user/);
  });

  it("FN-27 the connection check says plainly when storage or the database region is wrong", async () => {
    const good = await serverChecks({ databaseReadable: async () => undefined, firestoreRegion: async () => "asia-south1", bucketLocation: async () => "US-CENTRAL1" });
    expect(good.every((l) => l.ok)).toBe(true);
    const bad = await serverChecks({ databaseReadable: async () => undefined, firestoreRegion: async () => "us-east1", bucketLocation: async () => null });
    expect(bad.map((l) => l.ok)).toEqual([false, false]);
    expect(bad.every((l) => !!l.hint)).toBe(true);
  });
});

describe('sample data on an empty project (D-48)', () => {
  // The beforeEach seeds the demo set; a real project starts empty, so clear the business data and keep the people and settings.
  async function emptyProject() {
    for (const c of ['projects', 'clients', 'workers', 'expenses', 'invoices', 'attendance', 'worker_payments', 'vendor_bills', 'accounts', 'rollups', 'finance_rollups', 'counters', 'postings', 'account_transactions', 'worker_balances', 'audit_log']) {
      await db.recursiveDelete(db.collection(c));
    }
  }

  it('FN-30 only a super user with a fresh sign-in loads it, and nothing loads by itself', async () => {
    await emptyProject();
    expect((await sampleStatus(db, fresh('uOwner'))).loaded).toBe(false);
    await expect(loadSample(db, fresh('uAccountant'), now)).rejects.toThrow(/super user/);
    await expect(loadSample(db, stale('uOwner'), now)).rejects.toThrow(/sign in again/i);
    expect((await db.collection('projects').limit(1).get()).size).toBe(0);
  });

  it('FN-31 it writes the sample set flagged as sample, without the demo people, settings or expense heads', async () => {
    await emptyProject();
    const usersBefore = (await db.collection('users').get()).size;
    const st = await loadSample(db, fresh('uOwner'), now);
    expect(st).toMatchObject({ loaded: true, state: 'loaded', hasOwnRecords: false });
    const projects = await db.collection('projects').get();
    expect(projects.size).toBeGreaterThan(2);
    expect(projects.docs.every((d) => d.data().isSample === true)).toBe(true);
    expect((await db.collection('rollups').limit(1).get()).docs[0]!.data().isSample).toBe(true);
    expect((await db.collection('users').get()).size).toBe(usersBefore);
    expect((await db.collection('users').where('isSample', '==', true).get()).size).toBe(0);
    await expect(loadSample(db, fresh('uOwner'), now)).rejects.toThrow(/already/);
  });

  it("FN-32 it refuses to mix with the project's own records", async () => {
    await emptyProject();
    await db.doc('clients/real1').set({ id: 'real1', name: 'My Real Client' });
    await expect(loadSample(db, fresh('uOwner'), now)).rejects.toThrow(/own records/);
    expect((await sampleStatus(db, fresh('uOwner'))).hasOwnRecords).toBe(true);
  });

  it('FN-33 removing takes out exactly the sample, project details included, and the marker', async () => {
    await emptyProject();
    await loadSample(db, fresh('uOwner'), now);
    const st = await removeSample(db, fresh('uOwner'), now);
    expect(st.loaded).toBe(false);
    for (const c of ['projects', 'clients', 'workers', 'expenses', 'attendance', 'rollups', 'counters']) expect((await db.collection(c).limit(1).get()).size).toBe(0);
    expect((await db.collection('projects/projShivNagar/roster').limit(1).get()).size).toBe(0);
    expect((await db.doc('meta/sampleData').get()).exists).toBe(false);
    await expect(removeSample(db, fresh('uOwner'), now)).rejects.toThrow(/no sample data/);
  });

  it('FN-34 once your own records exist, the sample is kept and removing is refused (the totals stay true)', async () => {
    await emptyProject();
    await loadSample(db, fresh('uOwner'), now);
    await db.doc('clients/real1').set({ id: 'real1', name: 'My Real Client' });
    await expect(removeSample(db, fresh('uOwner'), now)).rejects.toThrow(/own records/);
    expect((await db.collection('projects').limit(1).get()).size).toBe(1);
  });

  it('FN-35 loading and removing are audited without any record content', async () => {
    await emptyProject();
    await loadSample(db, fresh('uOwner'), now);
    await removeSample(db, fresh('uOwner'), now);
    const audit = (await db.collection('audit_log').where('entity', '==', 'sampleData').get()).docs.map((d) => d.data());
    expect(audit.map((a) => a.action).sort()).toEqual(['load', 'remove']);
    expect(audit.every((a) => a.by === 'uOwner')).toBe(true);
  });
});

describe("the server part's HTTP handler against a real database (D-51)", () => {
  const deps = (uid: string): ApiDeps => ({
    db, auth, origin: "https://crm.example.com", where: "emulator", now,
    verifyIdToken: async (t) => { if (t !== "good") throw new Error("bad"); return { uid, auth_time: Math.floor(NOW.getTime() / 1000) - 60, email: "owner@example.com", email_verified: true }; },
  });
  const post = (name: string, data: unknown, token = "good") => ({ method: "POST", authorization: `Bearer ${token}`, appCheck: "", body: JSON.stringify({ name, data }) });

  it("FN-36 a save through the handler writes the record and says which collections changed", async () => {
    const r = await handleApi(post("command", { name: "createClient", args: { input: { name: "Handler Test Client", type: "individual", phone: "98390 55555" } }, requestId: "handler_req_1" }), deps("uOwner"));
    expect(r.status).toBe(200);
    const out = (r.body as { result: { result: string; touched: string[] } }).result;
    expect((await db.doc(`clients/${out.result}`).get()).data()?.name).toBe("Handler Test Client");
    expect(out.touched).toContain("clients");
    expect(out.touched).toContain("audit_log");
    // The same request again: the first result, nothing written twice, and "*" because it cannot tell what changed.
    const again = await handleApi(post("command", { name: "createClient", args: { input: { name: "Handler Test Client", type: "individual", phone: "98390 55555" } }, requestId: "handler_req_1" }), deps("uOwner"));
    expect((again.body as { result: { result: string; touched: string[] } }).result).toEqual({ result: out.result, touched: ["*"] });
    expect((await db.collection("clients").where("name", "==", "Handler Test Client").get()).size).toBe(1);
  });

  it("FN-37 the handler refuses a role that may not do it, in plain words, and a forged token before anything runs", async () => {
    const refused = await handleApi(post("command", { name: "createClient", args: { input: { name: "Nope", type: "individual", phone: "98390 55556" } }, requestId: "handler_req_2" }), deps("uViewer"));
    expect(refused.status).toBe(400);
    expect((refused.body as { error: { code: string; message: string } }).error.code).toBe("failed-precondition");
    const forged = await handleApi(post("command", { name: "createClient", args: {}, requestId: "handler_req_3" }, "forged"), deps("uOwner"));
    expect(forged.status).toBe(401);
    expect((await db.collection("clients").where("name", "==", "Nope").get()).size).toBe(0);
  });

  it("FN-38 the nightly clean-up removes expired request records from the real database and keeps fresh ones", async () => {
    await db.doc("command_requests/old_one").set({ uid: "uOwner", name: "x", expireAt: Timestamp.fromDate(new Date("2026-10-01T00:00:00Z")) });
    await db.doc("command_requests/new_one").set({ uid: "uOwner", name: "x", expireAt: Timestamp.fromDate(new Date("2026-11-30T00:00:00Z")) });
    const out = await cleanUp(db, now);
    expect(out.removed.command_requests).toBe(1);
    expect((await db.doc("command_requests/old_one").get()).exists).toBe(false);
    expect((await db.doc("command_requests/new_one").get()).exists).toBe(true);
    expect((await db.doc("system/maintenance").get()).data()?.lastRunAt).toBe(NOW.toISOString());
  });
});

void Timestamp;
