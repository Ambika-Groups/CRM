// The server part end to end (D-51), exactly as a deployed Netlify Function runs it, against the Firestore and Auth
// emulators: a web Request with a real sign-in token goes through netlify.ts -> admin.ts (the key from the environment)
// -> api.ts (token verified by the Admin SDK) -> the command runner -> the database. The only stand-in is the key
// itself (a throwaway one: the emulators do not check it). IDs E2E-xx are cited in docs/prd-traceability.md.
import { generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { KEY_VARIABLE, runtime } from "../functions/src/admin";
import { apiFunction, enquiryFunction, nightlyFunction } from "../functions/src/netlify";

const PROJECT = "demo-ambika";
const FIRESTORE = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"}`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`;
const URL_API = "https://crm.example.com/.netlify/functions/api";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = { [KEY_VARIABLE]: JSON.stringify({ project_id: PROJECT, client_email: `crm-server@${PROJECT}.iam.gserviceaccount.com`, private_key: pem }), AWS_REGION: "us-east-2" };

/** A person signs in the way the browser does (the Auth emulator's sign-up address) and gets a real ID token. */
async function signIn(email: string): Promise<{ uid: string; token: string }> {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "a-long-password", returnSecureToken: true }),
  });
  const j = (await r.json()) as { localId: string; idToken: string };
  return { uid: j.localId, token: j.idToken };
}

const call = async (token: string | null, name: string, data: unknown = {}) => {
  const res = await apiFunction(new Request(URL_API, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify({ name, data }) }), env);
  return { status: res.status, body: (await res.json()) as { result?: unknown; error?: { code: string; message: string } } };
};

let owner: { uid: string; token: string };
let stranger: { uid: string; token: string };

beforeAll(async () => {
  await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  owner = await signIn("owner@example.com");
  stranger = await signIn("stranger@example.com");
  const rt = runtime(env)!;
  const now = new Date().toISOString();
  await rt.db.doc(`users/${owner.uid}`).set({ name: "Owner", email: "owner@example.com", role: "owner", active: true, superUser: true, projectIds: [], language: "en", theme: "system", createdAt: now, updatedAt: now, createdBy: owner.uid, updatedBy: owner.uid, isDeleted: false });
});

describe("the server part, end to end on the emulators (D-51)", () => {
  it("E2E-01 a signed-in owner's save goes through the function and lands in the database, once", async () => {
    const data = { name: "createClient", args: { input: { name: "End To End Client", type: "individual", phone: "98390 44444" } }, requestId: "e2e_request_0001" };
    const first = await call(owner.token, "command", data);
    expect(first.status).toBe(200);
    const out = first.body.result as { result: string; touched: string[] };
    const rt = runtime(env)!;
    const saved = (await rt.db.doc(`clients/${out.result}`).get()).data();
    expect(saved).toMatchObject({ name: "End To End Client", createdBy: owner.uid });
    expect(out.touched).toEqual(expect.arrayContaining(["clients", "audit_log"]));
    // A retry of the same request (a flaky connection) returns the same record and writes nothing new.
    const again = await call(owner.token, "command", data);
    expect((again.body.result as { result: string }).result).toBe(out.result);
    expect((await rt.db.collection("clients").get()).size).toBe(1);
    expect((await rt.db.collection("audit_log").where("entityId", "==", out.result).get()).size).toBe(1);
  });

  it("E2E-02 a refusal comes back in plain words with the field, and nothing is written", async () => {
    const r = await call(owner.token, "command", { name: "createClient", args: { input: { name: "", type: "individual" } }, requestId: "e2e_request_0002" });
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe("failed-precondition");
    expect(JSON.stringify(r.body)).toContain("Enter the client's name.");
    expect((await runtime(env)!.db.collection("clients").get()).size).toBe(1);
  });

  it("E2E-03 no token, a forged token, and a signed-in person with no role are all refused", async () => {
    expect((await call(null, "ping")).status).toBe(401);
    expect((await call("forged.token.value", "ping")).status).toBe(401);
    // A real sign-in, but no users document: the person has no role, so no command runs.
    const r = await call(stranger.token, "command", { name: "createClient", args: { input: { name: "Nope", type: "individual" } }, requestId: "e2e_request_0003" });
    expect(r.status).toBe(400);
    expect(r.body.error?.message).toMatch(/switched off/);
    expect((await runtime(env)!.db.collection("clients").where("name", "==", "Nope").get()).size).toBe(0);
  });

  it("E2E-04 ping says where the server part runs; the database Test reads the real database", async () => {
    const ping = await call(owner.token, "ping");
    expect(ping.body.result).toMatchObject({ ok: true, region: "netlify us-east-2" });
    const test = await call(owner.token, "connectionTest");
    expect((test.body.result as { lines: { key: string; ok: boolean }[] }).lines[0]).toMatchObject({ key: "database", ok: true });
    expect((await call(stranger.token, "connectionTest")).status).toBe(400);
  });

  it("E2E-05 the enquiry link refuses a wrong key, and the nightly clean-up runs and records when", async () => {
    const enquiry = await enquiryFunction(new Request("https://crm.example.com/.netlify/functions/enquiry", { method: "POST", headers: { authorization: "Bearer wrong-key" }, body: JSON.stringify({ name: "Asha", phone: "9839012345", dryRun: true }) }), env);
    expect(enquiry.status).toBe(401);
    const night = await nightlyFunction(undefined, env);
    expect(night.status).toBe(200);
    expect((await runtime(env)!.db.doc("system/maintenance").get()).exists).toBe(true);
  });
});
