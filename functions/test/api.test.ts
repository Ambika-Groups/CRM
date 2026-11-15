// The server part on the free plan (D-51): the HTTP handler, the key in the environment, the Netlify wrappers and the
// nightly clean-up, with no network and no Firebase project. What the actions do to the database is tested against
// the emulator (emulator-tests/functions.test.ts, in CI). IDs API-xx, SA-xx, NF-xx, CL-xx are cited in docs/prd-traceability.md.
import { generateKeyPairSync } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { CommandError } from "@ag/core";
import { compactKey, KEY_VARIABLE, resetRuntime, runtime, serviceAccountFromEnv } from "../src/admin";
import { ACTIONS, handleApi, MAX_BODY, notConnected, type ApiDeps, type ApiRequest, type ApiResponse } from "../src/api";
import { touchedBy } from "../src/command";
import { CLEAN_BATCH, cleanUp } from "../src/maintenance";
import { apiFunction, enquiryFunction, nightlyFunction } from "../src/netlify";
import { ReauthRequired, resetAppCheckCache } from "../src/setup";

/** A database that holds only what a test puts in it (path -> fields). */
function fakeDb(docs: Record<string, Record<string, unknown>> = {}) {
  const writes: string[] = [];
  const db = {
    writes,
    doc: (path: string) => ({
      path,
      get: async () => ({ exists: path in docs, data: () => docs[path], get: (f: string) => docs[path]?.[f] }),
      set: async (v: Record<string, unknown>) => { docs[path] = v; writes.push(`set ${path}`); },
    }),
    collection: (name: string) => ({
      where: (_f: string, _op: string, at: Timestamp) => ({
        limit: (n: number) => ({
          get: async () => {
            const hit = Object.keys(docs).filter((p) => p.startsWith(`${name}/`) && (docs[p]!.expireAt as Timestamp).toMillis() < at.toMillis()).slice(0, n);
            return { size: hit.length, empty: hit.length === 0, docs: hit.map((p) => ({ ref: { path: p } })) };
          },
        }),
      }),
    }),
    batch: () => {
      const gone: string[] = [];
      return { delete: (ref: { path: string }) => { gone.push(ref.path); }, commit: async () => { for (const p of gone) { delete docs[p]; writes.push(`delete ${p}`); } } };
    },
  };
  return db;
}

const logged: { message: string; detail?: Record<string, unknown> }[] = [];
function deps(over: Partial<ApiDeps> = {}, docs: Record<string, Record<string, unknown>> = {}): ApiDeps {
  return {
    db: fakeDb(docs) as never, auth: {} as never, origin: "https://crm.example.com", where: "test",
    verifyIdToken: async (t) => { if (t !== "good") throw new Error("bad token"); return { uid: "uOwner", auth_time: 1_700_000_000, email: "owner@example.com", email_verified: true }; },
    log: (message, detail) => { logged.push({ message, detail }); },
    ...over,
  };
}
const request = (over: Partial<ApiRequest> = {}): ApiRequest => ({ method: "POST", authorization: "Bearer good", appCheck: "", body: JSON.stringify({ name: "echo", data: { a: 1 } }), ...over });
const errorOf = (r: ApiResponse) => ("error" in r.body ? r.body.error : null);
const resultOf = (r: ApiResponse) => ("result" in r.body ? r.body.result : undefined);

beforeEach(() => { logged.length = 0; resetAppCheckCache(); resetRuntime(); });

describe("the HTTP handler (api.ts)", () => {
  const echo = { echo: async (who: unknown, data: unknown) => ({ who, data }) };

  it("API-01 only POST is answered", async () => {
    const r = await handleApi(request({ method: "GET" }), deps(), echo);
    expect(r.status).toBe(405);
  });

  it("API-02 a call with no token, or a token that does not verify, is refused before anything runs", async () => {
    let ran = false;
    const actions = { echo: async () => { ran = true; return 1; } };
    const none = await handleApi(request({ authorization: "" }), deps(), actions);
    expect(none.status).toBe(401);
    expect(errorOf(none)).toMatchObject({ code: "unauthenticated", message: "Sign in first." });
    const bad = await handleApi(request({ authorization: "Bearer forged" }), deps(), actions);
    expect(bad.status).toBe(401);
    expect(errorOf(bad)?.code).toBe("unauthenticated");
    const noUid = await handleApi(request(), deps({ verifyIdToken: async () => ({ uid: "" }) }), actions);
    expect(noUid.status).toBe(401);
    expect(ran).toBe(false);
  });

  it("API-03 an unknown action is refused, including names that exist on every object", async () => {
    for (const name of ["nope", "constructor", "__proto__", "toString", ""]) {
      const r = await handleApi(request({ body: JSON.stringify({ name }) }), deps());
      expect(r.status).toBe(400);
      expect(errorOf(r)).toMatchObject({ code: "invalid-argument", message: "This action isn't available." });
    }
  });

  it("API-04 who the person is comes from the verified token, never from the request body", async () => {
    const r = await handleApi(request({ body: JSON.stringify({ name: "echo", data: { uid: "uSomeoneElse", a: 1 }, uid: "uSomeoneElse" }) }), deps(), echo);
    expect(r.status).toBe(200);
    expect(resultOf(r)).toEqual({ who: { uid: "uOwner", authTime: 1_700_000_000, email: "owner@example.com", emailVerified: true }, data: { uid: "uSomeoneElse", a: 1 } });
  });

  it("API-05 a refusal keeps its plain words and field messages; a stale sign-in asks to sign in again", async () => {
    const refused = await handleApi(request(), deps(), { echo: async () => { throw new CommandError("Enter an amount.", { amount: "Enter an amount above zero." }); } });
    expect(refused.status).toBe(400);
    expect(errorOf(refused)).toEqual({ code: "failed-precondition", message: "Enter an amount.", details: { fields: { amount: "Enter an amount above zero." } } });
    const stale = await handleApi(request(), deps(), { echo: async () => { throw new ReauthRequired(); } });
    expect(errorOf(stale)).toMatchObject({ code: "failed-precondition", details: { reauth: true } });
  });

  it("API-06 an unexpected failure is logged by name only and shown as a general message, with nothing leaked", async () => {
    const r = await handleApi(request({ body: JSON.stringify({ name: "echo", data: { secret: "s3cr3t-value" } }) }), deps(), { echo: async () => { throw new Error("connect ECONNRESET 10.0.0.1 internal-detail"); } });
    expect(r.status).toBe(500);
    expect(errorOf(r)).toEqual({ code: "internal", message: "Something went wrong on our side. Nothing was saved. Try again." });
    expect(JSON.stringify(r.body)).not.toContain("internal-detail");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.detail).toMatchObject({ name: "echo" });
    expect(JSON.stringify(logged)).not.toContain("s3cr3t-value");
  });

  it("API-07 a body that is not JSON, or is too large, is refused", async () => {
    const notJson = await handleApi(request({ body: "{nope" }), deps(), echo);
    expect(errorOf(notJson)?.code).toBe("invalid-argument");
    const big = await handleApi(request({ body: "x".repeat(MAX_BODY + 1) }), deps(), echo);
    expect(big.status).toBe(400);
    expect(errorOf(big)?.message).toBe("This request is too large.");
  });

  it("API-08 with App Check enforced on the Setup page, a call needs a valid App Check token; otherwise none is asked for", async () => {
    const enforced = { "integrations/appCheck": { enabled: true, enforce: true } };
    const verifyAppCheck = async (t: string) => { if (t !== "app-ok") throw new Error("bad"); };
    const missing = await handleApi(request(), deps({ verifyAppCheck }, enforced), echo);
    expect(errorOf(missing)).toMatchObject({ code: "failed-precondition", message: "This app could not be verified. Reload the page and try again." });
    resetAppCheckCache();
    expect((await handleApi(request({ appCheck: "forged" }), deps({ verifyAppCheck }, enforced), echo)).status).toBe(400);
    resetAppCheckCache();
    expect((await handleApi(request({ appCheck: "app-ok" }), deps({ verifyAppCheck }, enforced), echo)).status).toBe(200);
    resetAppCheckCache();
    // A host that cannot verify App Check tokens refuses rather than waving the call through.
    expect((await handleApi(request({ appCheck: "app-ok" }), deps({}, enforced), echo)).status).toBe(400);
    resetAppCheckCache();
    expect((await handleApi(request(), deps({ verifyAppCheck }), echo)).status).toBe(200);
  });

  it("API-09 the command action needs a command name and a well-formed request id", async () => {
    const noName = await handleApi(request({ body: JSON.stringify({ name: "command", data: { requestId: "abcdefgh" } }) }), deps());
    expect(errorOf(noName)).toMatchObject({ code: "failed-precondition", message: "This action isn't available." });
    const badId = await handleApi(request({ body: JSON.stringify({ name: "command", data: { name: "createExpense", requestId: "a b" } }) }), deps());
    expect(errorOf(badId)?.message).toBe("This request could not be read. Reload the page and try again.");
  });

  it("API-10 ping answers with where the server part runs; every action the page calls exists", async () => {
    const r = await handleApi(request({ body: JSON.stringify({ name: "ping" }) }), deps({ now: () => new Date("2026-11-16T10:00:00.000Z") }));
    expect(resultOf(r)).toEqual({ ok: true, at: "2026-11-16T10:00:00.000Z", region: "test" });
    expect(Object.keys(ACTIONS).sort()).toEqual(["cleanUp", "command", "connectionTest", "ping", "sampleData", "setupClear", "setupRecordTest", "setupRotateWebsiteKey", "setupSave", "setupTest", "setupTestPush"]);
  });

  it("API-11 Setup actions are for the super user only (checked on the users document)", async () => {
    const plain = { "users/uOwner": { role: "owner", active: true, superUser: false } };
    for (const name of ["connectionTest", "cleanUp", "setupTestPush"]) {
      const r = await handleApi(request({ body: JSON.stringify({ name, data: { token: "t".repeat(30) } }) }), deps({}, plain));
      expect(errorOf(r)).toMatchObject({ code: "failed-precondition", message: "Only a super user can open Setup & integrations." });
    }
  });

  it("API-12 the database Test reports the region and has no file-storage line on the free plan", async () => {
    const su = { "users/uOwner": { role: "owner", active: true, superUser: true } };
    const ok = await handleApi(request({ body: JSON.stringify({ name: "connectionTest" }) }), deps({ firestoreRegion: async () => "asia-south1" }, su));
    expect(resultOf(ok)).toEqual({ lines: [{ key: "database", ok: true, message: "The database answers and is in asia-south1 (Mumbai)." }] });
    const far = await handleApi(request({ body: JSON.stringify({ name: "connectionTest" }) }), deps({ firestoreRegion: async () => "us-central1" }, su));
    expect((resultOf(far) as { lines: { ok: boolean }[] }).lines[0]!.ok).toBe(false);
  });
});

describe("what a save changed (command.ts)", () => {
  it("API-13 the collections a command changed are listed once each, so the page re-reads only those", () => {
    const change = (collection: string, id: string) => ({ collection, id, before: null, after: { id } });
    expect(touchedBy([change("expenses", "e1"), change("rollups", "company_2026-11"), change("expenses", "e2"), change("projects/p1/roster", "w1")] as never)).toEqual(["expenses", "projects/p1/roster", "rollups"]);
    expect(touchedBy([])).toEqual([]);
  });
});

describe("the key in the environment (admin.ts)", () => {
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const full = JSON.stringify({ type: "service_account", project_id: "demo-ambika", private_key_id: "0".repeat(40), private_key: pem, client_email: "crm-server@demo-ambika.iam.gserviceaccount.com", client_id: "1".repeat(21), token_uri: "https://oauth2.googleapis.com/token" });
  const want = { projectId: "demo-ambika", clientEmail: "crm-server@demo-ambika.iam.gserviceaccount.com", privateKey: pem };

  it("SA-01 reads the key as JSON, as its three needed fields, as base64, split in parts, or with written-out line breaks", () => {
    expect(serviceAccountFromEnv({ [KEY_VARIABLE]: full })).toEqual(want);
    const compact = compactKey(full);
    expect(compact.length).toBeLessThan(full.length);
    expect(serviceAccountFromEnv({ [KEY_VARIABLE]: compact })).toEqual(want);
    expect(serviceAccountFromEnv({ [KEY_VARIABLE]: Buffer.from(compact).toString("base64") })).toEqual(want);
    const cut = Math.floor(compact.length / 3);
    expect(serviceAccountFromEnv({ [KEY_VARIABLE]: compact.slice(0, cut), [`${KEY_VARIABLE}_2`]: compact.slice(cut, 2 * cut), [`${KEY_VARIABLE}_3`]: compact.slice(2 * cut) })).toEqual(want);
    const written = JSON.stringify({ project_id: "demo-ambika", client_email: want.clientEmail, private_key: pem.replace(/\n/g, "\\n") });
    expect(serviceAccountFromEnv({ [KEY_VARIABLE]: written })).toEqual(want);
  });

  it("SA-02 no key, or something that is not a key, is 'not connected', never a crash", () => {
    for (const v of [undefined, "", "   ", "not a key", "{}", JSON.stringify({ project_id: "p", client_email: "nobody", private_key: "x" }), JSON.stringify({ project_id: "p", client_email: "a@b.c" })]) {
      expect(serviceAccountFromEnv({ [KEY_VARIABLE]: v })).toBeNull();
    }
    expect(runtime({})).toBeNull();
  });

  it("SA-03 the compact key is small enough for a 4 KB environment", () => {
    expect(compactKey(full).length).toBeLessThan(2000);
  });

  it("NF-01 without the key every function answers 'not connected yet' (503), so the site can be deployed first", async () => {
    const post = (path: string) => new Request(`https://crm.example.com/.netlify/functions/${path}`, { method: "POST", headers: { authorization: "Bearer good" }, body: "{}" });
    const api = await apiFunction(post("api"), {});
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual(notConnected().body);
    expect(api.headers.get("cache-control")).toBe("no-store");
    expect((await enquiryFunction(post("enquiry"), {})).status).toBe(503);
    expect((await nightlyFunction(undefined, {})).status).toBe(503);
  });

  it("NF-02 with a key the Admin SDK starts (no network needed) and refuses a call with no token or a forged one", async () => {
    const env = { [KEY_VARIABLE]: compactKey(full), AWS_REGION: "us-east-2" };
    const rt = runtime(env);
    expect(rt).toMatchObject({ projectId: "demo-ambika", where: "netlify us-east-2" });
    expect(runtime(env)).toBe(rt);
    const url = "https://crm.example.com/.netlify/functions/api";
    const none = await apiFunction(new Request(url, { method: "POST", body: JSON.stringify({ name: "ping" }) }), env);
    expect(none.status).toBe(401);
    const forged = await apiFunction(new Request(url, { method: "POST", headers: { authorization: "Bearer not.a.token" }, body: JSON.stringify({ name: "ping" }) }), env);
    expect(forged.status).toBe(401);
    expect(((await forged.json()) as { error: { code: string } }).error.code).toBe("unauthenticated");
    expect((await apiFunction(new Request(url), env)).status).toBe(405);
  });
});

describe("the nightly clean-up (maintenance.ts)", () => {
  const NOW = new Date("2026-11-16T20:30:00.000Z");
  const at = (iso: string) => ({ expireAt: Timestamp.fromDate(new Date(iso)) });

  it("CL-01 removes only records whose time has passed, and writes when it ran", async () => {
    const docs: Record<string, Record<string, unknown>> = {
      "command_requests/old1": at("2026-11-10T00:00:00Z"), "command_requests/old2": at("2026-11-16T20:29:59Z"), "command_requests/fresh": at("2026-11-17T00:00:00Z"),
      "processed_events/old": at("2026-11-01T00:00:00Z"), "expenses/e1": at("2026-01-01T00:00:00Z"),
    };
    const db = fakeDb(docs);
    const out = await cleanUp(db as never, () => NOW);
    expect(out).toEqual({ at: NOW.toISOString(), removed: { command_requests: 2, processed_events: 1 }, more: false });
    expect(Object.keys(docs).sort()).toEqual(["command_requests/fresh", "expenses/e1", "system/maintenance"]);
    expect(docs["system/maintenance"]).toEqual({ lastRunAt: NOW.toISOString(), removed: { command_requests: 2, processed_events: 1 }, more: false });
  });

  it("CL-02 one run does a bounded amount of work and says when more is left", async () => {
    const docs: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < CLEAN_BATCH + 25; i++) docs[`command_requests/r${i}`] = at("2026-11-01T00:00:00Z");
    const db = fakeDb(docs);
    const first = await cleanUp(db as never, () => NOW);
    expect(first.removed.command_requests).toBe(CLEAN_BATCH);
    expect(first.more).toBe(true);
    const second = await cleanUp(db as never, () => NOW);
    expect(second).toMatchObject({ removed: { command_requests: 25, processed_events: 0 }, more: false });
  });
});
