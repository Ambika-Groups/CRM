// File storage on the server (group A): the AWS Signature V4 presigned address (checked against the example Amazon
// publishes), the R2 address, who may get a signed address, the R2 and Cloudinary Tests with a stand-in for fetch, and
// that no answer ever carries a secret. No network and no Firebase project. IDs ST-xx are cited in docs/prd-traceability.md.
import { beforeEach, describe, expect, it } from "vitest";
import { CommandError } from "@ag/core";
import {
  CLOUDINARY_TEST_ID, cloudinaryTest, filesConfig, filesPresign, isStorageTest, loadStorage, presignUrl, PRESIGN_SECONDS, r2Presign, r2Test, resetStorageCache,
  testStorage, type R2Config,
} from "../src/storage";

const NOW = new Date("2026-11-16T04:30:00.000Z");
const now = () => NOW;
const SECRET = "s3cr3t-ACCESS-key-never-shown-0123456789";
const R2: R2Config = { accountId: "0123456789abcdef0123456789abcdef", accessKeyId: "AKIDEXAMPLE0123456789abcdef01234", secretAccessKey: SECRET, bucket: "ambika-crm-files" };

/** A database that holds only what a test puts in it (path -> fields). */
function fakeDb(docs: Record<string, Record<string, unknown>> = {}) {
  const reads: string[] = [];
  return {
    docs, reads,
    doc: (path: string) => ({
      path,
      get: async () => { reads.push(path); return { exists: path in docs, data: () => docs[path] }; },
      set: async (v: Record<string, unknown>) => { docs[path] = v; },
      delete: async () => { delete docs[path]; },
    }),
  };
}

const USERS = {
  "users/uOwner": { role: "owner", active: true, superUser: true, projectIds: [] },
  "users/uAccountant": { role: "accountant", active: true, projectIds: [] },
  "users/uPm": { role: "pm", active: true, projectIds: ["pA"] },
  "users/uSup": { role: "supervisor", active: true, projectIds: ["pA"] },
  "users/uSup2": { role: "supervisor", active: true, projectIds: ["pB"] },
  "users/uCa": { role: "ca", active: true, projectIds: [] },
  "users/uViewer": { role: "viewer", active: true, projectIds: [] },
  "users/uOff": { role: "owner", active: false, projectIds: [] },
};
const R2_SAVED = {
  "integrations/storageR2": { id: "storageR2", enabled: true, values: { accountId: R2.accountId, accessKeyId: R2.accessKeyId, bucket: R2.bucket }, masked: { secretAccessKey: "••••6789" }, test: { ok: true, message: "ok", at: "2026-11-15T00:00:00.000Z" } },
  "private_config/storageR2": { secrets: { secretAccessKey: SECRET } },
};
const CLOUD_SAVED = {
  "integrations/storageCloudinary": { id: "storageCloudinary", enabled: true, values: { cloudName: "ambika", uploadPreset: "crm_unsigned" }, masked: {}, test: { ok: true, message: "ok", at: "2026-11-15T00:00:00.000Z" } },
};
const fileDoc = (over: Record<string, unknown> = {}) => ({
  name: "bill.jpg", mime: "image/jpeg", sizeBytes: 140_000, path: "r2/files/bill/fbill00001.jpg", kind: "bill", provider: "r2", projectId: "pA", createdBy: "uSup",
  createdAt: { toDate: () => new Date("2026-11-16T03:00:00.000Z") }, ...over,
});
const db = (extra: Record<string, Record<string, unknown>> = {}) => fakeDb({ ...USERS, ...R2_SAVED, ...extra });
const who = (uid: string) => ({ uid });

/** A stand-in for fetch: answers from a list of rules and remembers what was asked. */
function fakeFetch(answer: (url: string, init: RequestInit) => { status: number; text?: string; json?: unknown } | Error) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: typeof init.body === "string" ? init.body : "" });
    const a = answer(url, init);
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => a.text ?? "", json: async () => { if (a.json === undefined) throw new Error("not json"); return a.json; } } as unknown as Response;
  }) as typeof fetch;
  return { fetcher, calls };
}

beforeEach(() => resetStorageCache());

describe("AWS Signature Version 4, query-string signing (storage.ts presignUrl)", () => {
  it("ST-01 matches the presigned address Amazon publishes as its worked example (GET examplebucket/test.txt, 24 May 2013, one day)", () => {
    // Amazon S3 API Reference, "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)".
    const url = presignUrl({
      method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", region: "us-east-1", service: "s3",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", expiresSeconds: 86_400, now: new Date("2013-05-24T00:00:00.000Z"),
    });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request"
      + "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("ST-02 the same input always gives the same address; the method, the path, the time and the secret each change the signature", () => {
    const base = { method: "GET" as const, host: "h.example.com", path: "/b/k.jpg", region: "auto", service: "s3", accessKeyId: "AK", secretAccessKey: "SK", expiresSeconds: 600, now: NOW };
    const sig = (u: string) => /X-Amz-Signature=([0-9a-f]{64})$/.exec(u)![1];
    const a = presignUrl(base);
    expect(presignUrl({ ...base })).toBe(a);
    const others = [presignUrl({ ...base, method: "PUT" }), presignUrl({ ...base, path: "/b/k2.jpg" }), presignUrl({ ...base, now: new Date(NOW.getTime() + 1000) }), presignUrl({ ...base, secretAccessKey: "SK2" }), presignUrl({ ...base, expiresSeconds: 601 })];
    expect(new Set([sig(a), ...others.map(sig)]).size).toBe(6);
    expect(a).not.toContain("SK");
    expect(() => presignUrl({ ...base, expiresSeconds: 0 })).toThrow();
    expect(() => presignUrl({ ...base, expiresSeconds: 604_801 })).toThrow();
  });

  it("ST-03 names with spaces and other characters are encoded the AWS way, and a signed content type is listed", () => {
    const u = presignUrl({ method: "PUT", host: "h.example.com", path: "/b/site photo (1)+a.jpg", region: "auto", service: "s3", accessKeyId: "AK", secretAccessKey: "SK", expiresSeconds: 60, now: NOW, headers: { "Content-Type": "image/jpeg" } });
    expect(u).toContain("/b/site%20photo%20%281%29%2Ba.jpg?");
    expect(u).toContain("X-Amz-SignedHeaders=content-type%3Bhost");
    expect(u).toContain("X-Amz-Date=20261116T043000Z");
  });

  it("ST-04 an R2 address: the account's own host, the bucket and key in the path, region auto, 10 minutes (fixed clock)", () => {
    const u = new URL(r2Presign(R2, { method: "GET", key: "files/bill/fbill00001.jpg", now: NOW }));
    expect(u.host).toBe(`${R2.accountId}.r2.cloudflarestorage.com`);
    expect(u.pathname).toBe("/ambika-crm-files/files/bill/fbill00001.jpg");
    expect(u.searchParams.get("X-Amz-Credential")).toBe(`${R2.accessKeyId}/20261116/auto/s3/aws4_request`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe(String(PRESIGN_SECONDS));
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(u.toString()).not.toContain(SECRET);
    const put = new URL(r2Presign(R2, { method: "PUT", key: "files/bill/fbill00001.jpg", now: NOW, contentType: "image/jpeg" }));
    expect(put.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(put.searchParams.get("X-Amz-Signature")).not.toBe(u.searchParams.get("X-Amz-Signature"));
  });
});

describe("the saved settings and what a browser may know", () => {
  it("ST-10 with nothing saved the built-in store is used", async () => {
    const d = fakeDb({ ...USERS });
    expect(await loadStorage(d as never, 0)).toEqual({ provider: "inline", r2: null, cloudinary: null });
    expect(await filesConfig(d as never, who("uSup"), now)).toEqual({ provider: "inline" });
  });

  it("ST-11 a provider is used only when it is switched on and its last Test passed; R2 comes before Cloudinary", async () => {
    expect((await loadStorage(db() as never, 0)).provider).toBe("r2");
    resetStorageCache();
    const untested = db({ "integrations/storageR2": { ...R2_SAVED["integrations/storageR2"], test: null } });
    expect((await loadStorage(untested as never, 0)).provider).toBe("inline");
    resetStorageCache();
    const failed = db({ "integrations/storageR2": { ...R2_SAVED["integrations/storageR2"], test: { ok: false, message: "no", at: "x" } }, ...CLOUD_SAVED });
    expect((await loadStorage(failed as never, 0)).provider).toBe("cloudinary");
    resetStorageCache();
    const off = db({ "integrations/storageR2": { ...R2_SAVED["integrations/storageR2"], enabled: false } });
    expect((await loadStorage(off as never, 0)).provider).toBe("inline");
    resetStorageCache();
    expect((await loadStorage(db(CLOUD_SAVED) as never, 0)).provider).toBe("r2");
    resetStorageCache();
    const noSecret = db({ "private_config/storageR2": { secrets: {} } });
    expect(await loadStorage(noSecret as never, 0)).toMatchObject({ provider: "inline", r2: null });
  });

  it("ST-12 the settings are remembered for a minute per instance, then read again", async () => {
    const d = db();
    await loadStorage(d as never, 1_000);
    const first = d.reads.length;
    await loadStorage(d as never, 50_000);
    expect(d.reads.length).toBe(first);
    await loadStorage(d as never, 62_000);
    expect(d.reads.length).toBe(first + 3);
  });

  it("ST-13 the browser is told the provider and public values only: never the secret key or the key id", async () => {
    const d = db({ ...CLOUD_SAVED, "integrations/storageR2": { ...R2_SAVED["integrations/storageR2"], values: { ...R2_SAVED["integrations/storageR2"].values, publicBaseUrl: "https://files.ambikagroups.tech/" } } });
    const cfg = await filesConfig(d as never, who("uSup"), now);
    expect(cfg).toEqual({ provider: "r2", cloudinary: { cloudName: "ambika", uploadPreset: "crm_unsigned" }, r2: { publicBaseUrl: "https://files.ambikagroups.tech" } });
    expect(JSON.stringify(cfg)).not.toContain(SECRET);
    expect(JSON.stringify(cfg)).not.toContain(R2.accessKeyId);
    await expect(filesConfig(d as never, who("uOff"), now)).rejects.toThrow(/switched off/);
    await expect(filesConfig(d as never, who("uNobody"), now)).rejects.toThrow(CommandError);
  });
});

describe("signed addresses for R2 (filesPresign)", () => {
  const put = (over: Record<string, unknown> = {}) => ({ op: "put", id: "fnew000001", kind: "bill", mime: "image/jpeg", sizeBytes: 140_000, projectId: "pA", ...over });

  it("ST-20 upload: a supervisor on the project gets a PUT address, the path to keep and the header to send", async () => {
    const out = await filesPresign(db() as never, who("uSup"), put(), { now });
    const u = new URL(String(out.url));
    expect(u.pathname).toBe("/ambika-crm-files/files/bill/fnew000001.jpg");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(out).toMatchObject({ path: "r2/files/bill/fnew000001.jpg", headers: { "Content-Type": "image/jpeg" }, expiresInSeconds: 600 });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it("ST-21 upload is refused: another project, the viewer and the CA, an ID proof from a site role, a wrong type, over 10 MB, an id already used", async () => {
    await expect(filesPresign(db() as never, who("uSup2"), put(), { now })).rejects.toThrow(/can't do this/);
    await expect(filesPresign(db() as never, who("uViewer"), put(), { now })).rejects.toThrow(/can't do this/);
    await expect(filesPresign(db() as never, who("uCa"), put(), { now })).rejects.toThrow(/can't do this/);
    await expect(filesPresign(db() as never, who("uPm"), put({ kind: "id_proof" }), { now })).rejects.toThrow(/can't do this/);
    await expect(filesPresign(db() as never, who("uSup"), put({ projectId: null }), { now })).rejects.toThrow(/can't do this/);
    expect(await filesPresign(db() as never, who("uAccountant"), put({ kind: "id_proof", projectId: null }), { now })).toHaveProperty("url");
    await expect(filesPresign(db() as never, who("uSup"), put({ mime: "text/html" }), { now })).rejects.toThrow(/not a photo or a PDF/);
    await expect(filesPresign(db() as never, who("uSup"), put({ kind: "photo", mime: "application/pdf" }), { now })).rejects.toThrow(/Only photos/);
    await expect(filesPresign(db() as never, who("uSup"), put({ sizeBytes: 10 * 1024 * 1024 + 1 }), { now })).rejects.toThrow(/too large/);
    await expect(filesPresign(db() as never, who("uSup"), put({ id: "../x" }), { now })).rejects.toThrow(CommandError);
    await expect(filesPresign(db({ "files/fnew000001": fileDoc() }) as never, who("uSup"), put(), { now })).rejects.toThrow(CommandError);
    await expect(filesPresign(db() as never, who("uOff"), put(), { now })).rejects.toThrow(/switched off/);
  });

  it("ST-22 upload needs R2 to be the provider in use; with nothing set up every request is refused in plain words", async () => {
    const untested = db({ "integrations/storageR2": { ...R2_SAVED["integrations/storageR2"], test: null } });
    await expect(filesPresign(untested as never, who("uSup"), put(), { now })).rejects.toThrow(/not switched on/);
    resetStorageCache();
    await expect(filesPresign(fakeDb({ ...USERS }) as never, who("uSup"), put(), { now })).rejects.toThrow(/not set up/);
  });

  it("ST-23 opening: the same people as the security rules (project, own bills for a supervisor, bills for the CA, ID proofs for finance only)", async () => {
    const files = {
      "files/fbill00001": fileDoc(),
      "files/fphoto0001": fileDoc({ kind: "photo", path: "r2/files/photo/fphoto0001.webp", mime: "image/webp", createdBy: "uPm" }),
      "files/fidproof01": fileDoc({ kind: "id_proof", projectId: null, path: "r2/files/id_proof/fidproof01.jpg", createdBy: "uAccountant" }),
      "files/finline001": fileDoc({ path: "inline/finline001", provider: "inline" }),
    };
    const get = async (uid: string, id: string) => { resetStorageCache(); try { return await filesPresign(db(files) as never, who(uid), { op: "get", id }, { now }); } catch (e) { return (e as Error).message; } };
    const ok = (v: unknown) => typeof v === "object";
    expect(ok(await get("uOwner", "fbill00001"))).toBe(true);
    expect(ok(await get("uSup", "fbill00001"))).toBe(true); // their own bill
    expect(ok(await get("uPm", "fbill00001"))).toBe(true);
    expect(ok(await get("uCa", "fbill00001"))).toBe(true);
    expect(await get("uSup2", "fbill00001")).toMatch(/can't do this/); // another project
    expect(await get("uViewer", "fbill00001")).toMatch(/can't do this/);
    expect(ok(await get("uSup", "fphoto0001"))).toBe(true);
    expect(await get("uCa", "fphoto0001")).toMatch(/can't do this/);
    expect(ok(await get("uAccountant", "fidproof01"))).toBe(true);
    for (const uid of ["uPm", "uSup", "uCa", "uViewer"]) expect(await get(uid, "fidproof01")).toMatch(/can't do this/);
    expect(await get("uOwner", "fnothere01")).toMatch(/no longer available/);
    expect(await get("uOwner", "finline001")).toMatch(/no longer available/); // not an R2 file
    const out = (await get("uOwner", "fphoto0001")) as { url: string };
    expect(new URL(out.url).pathname).toBe("/ambika-crm-files/files/photo/fphoto0001.webp");
    expect(new URL(out.url).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("ST-24 removing: the person who attached it within 24 hours, or finance; the server deletes the object and then the record", async () => {
    const d = db({ "files/fbill00001": fileDoc() });
    const { fetcher, calls } = fakeFetch(() => ({ status: 204 }));
    await expect(filesPresign(d as never, who("uPm"), { op: "delete", id: "fbill00001" }, { now, fetcher })).rejects.toThrow(/Only the owner or the accountant/);
    const late = () => new Date("2026-11-17T03:00:01.000Z");
    await expect(filesPresign(d as never, who("uSup"), { op: "delete", id: "fbill00001" }, { now: late, fetcher })).rejects.toThrow(/Only the owner or the accountant/);
    expect(calls.length).toBe(0);
    expect(d.docs["files/fbill00001"]).toBeDefined();
    expect(await filesPresign(d as never, who("uSup"), { op: "delete", id: "fbill00001" }, { now, fetcher })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "DELETE" });
    expect(new URL(calls[0]!.url).pathname).toBe("/ambika-crm-files/files/bill/fbill00001.jpg");
    expect(d.docs["files/fbill00001"]).toBeUndefined();
    // If R2 refuses, the record is kept, so the file is not lost from view.
    const d2 = db({ "files/fbill00001": fileDoc() });
    resetStorageCache();
    await expect(filesPresign(d2 as never, who("uOwner"), { op: "delete", id: "fbill00001" }, { now: late, fetcher: fakeFetch(() => ({ status: 500 })).fetcher })).rejects.toThrow(/could not be removed/);
    expect(d2.docs["files/fbill00001"]).toBeDefined();
    await expect(filesPresign(d2 as never, who("uOwner"), { op: "copy", id: "fbill00001" }, { now })).rejects.toThrow(CommandError);
  });
});

describe("the Tests on Setup & integrations", () => {
  it("ST-30 R2 Test passes: a tiny file is saved, read back and deleted, each with a signed address", async () => {
    let stored = "";
    const { fetcher, calls } = fakeFetch((_url, init) => {
      if (init.method === "PUT") { stored = String(init.body); return { status: 200 }; }
      if (init.method === "GET") return { status: 200, text: stored };
      return { status: 204 };
    });
    expect(await r2Test(R2, fetcher, now, "abc123")).toEqual({ ok: true, message: "A test file was saved to the bucket, read back and deleted." });
    expect(calls.map((c) => c.method)).toEqual(["PUT", "GET", "DELETE"]);
    for (const c of calls) { expect(new URL(c.url).pathname).toBe("/ambika-crm-files/ag-crm-test/abc123.txt"); expect(c.url).not.toContain(SECRET); }
    expect(calls[0]!.headers["Content-Type"]).toBe("text/plain");
  });

  it("ST-31 R2 Test fails in plain words: wrong keys, no such bucket, cannot read back, cannot delete, no connection", async () => {
    const run = (answer: Parameters<typeof fakeFetch>[0]) => r2Test(R2, fakeFetch(answer).fetcher, now, "abc123");
    expect(await run(() => ({ status: 403 }))).toMatchObject({ ok: false, message: "Cloudflare R2 did not accept these keys." });
    expect(await run(() => ({ status: 404 }))).toMatchObject({ ok: false, message: "Cloudflare R2 did not find this bucket." });
    expect(await run(() => ({ status: 500 }))).toMatchObject({ ok: false, message: "Cloudflare R2 refused the test file (answer 500)." });
    expect(await run((_u, i) => (i.method === "GET" ? { status: 200, text: "something else" } : { status: 200 }))).toMatchObject({ ok: false, message: "The test file was saved but could not be read back." });
    expect(await run((_u, i) => (i.method === "PUT" ? { status: 200 } : i.method === "GET" ? { status: 200, text: "Ambika CRM storage test" } : { status: 403 }))).toMatchObject({ ok: false, message: "The test file was saved and read, but could not be deleted." });
    const down = await run(() => new Error("ENOTFOUND"));
    expect(down).toMatchObject({ ok: false, message: "Cloudflare R2 could not be reached." });
    for (const o of [down, await run(() => ({ status: 403 }))]) { expect(o.hint).toBeTruthy(); expect(JSON.stringify(o)).not.toContain(SECRET); }
  });

  it("ST-32 R2 Test with a public address also checks that address shows the file", async () => {
    const cfg = { ...R2, publicBaseUrl: "https://files.ambikagroups.tech" };
    const answer = (publicStatus: number): Parameters<typeof fakeFetch>[0] => (url, init) => {
      if (url.startsWith("https://files.ambikagroups.tech/")) return { status: publicStatus };
      if (init.method === "GET") return { status: 200, text: "Ambika CRM storage test" };
      return { status: 200 };
    };
    const good = fakeFetch(answer(200));
    expect(await r2Test(cfg, good.fetcher, now, "abc123")).toMatchObject({ ok: true });
    expect(good.calls.map((c) => c.url)).toContain("https://files.ambikagroups.tech/ag-crm-test/abc123.txt");
    expect(await r2Test(cfg, fakeFetch(answer(404)).fetcher, now, "abc123")).toMatchObject({ ok: false, message: "The bucket works, but the public address did not show the test file." });
  });

  it("ST-33 Cloudinary Test: uploads a 1-pixel picture with the unsigned preset and opens it; failures name the preset or the cloud name", async () => {
    const good = fakeFetch((url) => (url.startsWith("https://api.cloudinary.com/") ? { status: 200, json: { secure_url: "https://res.cloudinary.com/ambika/image/upload/v1/ag-crm/connection-test.png" } } : { status: 200 }));
    expect(await cloudinaryTest({ cloudName: "ambika", uploadPreset: "crm_unsigned" }, good.fetcher)).toMatchObject({ ok: true, message: "A test picture was uploaded to Cloudinary and opened." });
    expect(good.calls[0]!.url).toBe("https://api.cloudinary.com/v1_1/ambika/image/upload");
    const sent = new URLSearchParams(good.calls[0]!.body);
    expect(sent.get("upload_preset")).toBe("crm_unsigned");
    expect(sent.get("public_id")).toBe(CLOUDINARY_TEST_ID);
    expect(sent.get("file")).toMatch(/^data:image\/png;base64,/);
    expect(good.calls[1]!.url).toContain("res.cloudinary.com/ambika/");
    const run = (a: Parameters<typeof fakeFetch>[0]) => cloudinaryTest({ cloudName: "ambika", uploadPreset: "x" }, fakeFetch(a).fetcher);
    expect(await run(() => ({ status: 400, json: { error: { message: "Upload preset not found" } } }))).toMatchObject({ ok: false, message: "Cloudinary did not accept this upload preset." });
    expect(await run(() => ({ status: 401, json: { error: { message: "Invalid cloud_name ambika" } } }))).toMatchObject({ ok: false, message: "Cloudinary did not find this cloud name." });
    expect(await run(() => ({ status: 500 }))).toMatchObject({ ok: false, message: "Cloudinary refused the test picture (answer 500)." });
    expect(await run(() => new Error("offline"))).toMatchObject({ ok: false, message: "Cloudinary could not be reached." });
  });

  it("ST-34 the storage Test is for a super user, runs on what is saved now, and records its result on the integration", async () => {
    expect(isStorageTest("storageR2")).toBe(true);
    expect(isStorageTest("storageCloudinary")).toBe(true);
    expect(isStorageTest("email")).toBe(false);
    const d = db({ "integrations/storageR2": { ...R2_SAVED["integrations/storageR2"], test: null } });
    let stored = "";
    const { fetcher } = fakeFetch((_u, i) => (i.method === "PUT" ? ((stored = String(i.body)), { status: 200 }) : i.method === "GET" ? { status: 200, text: stored } : { status: 204 }));
    await expect(testStorage(d as never, who("uAccountant"), { integration: "storageR2" }, { now, fetcher })).rejects.toThrow(/Only a super user/);
    await expect(testStorage(d as never, who("uOwner"), { integration: "email" }, { now, fetcher })).rejects.toThrow(/isn't known/);
    expect((await loadStorage(d as never, NOW.getTime())).provider).toBe("inline"); // not tested yet, so not in use
    expect(await testStorage(d as never, who("uOwner"), { integration: "storageR2" }, { now, fetcher })).toMatchObject({ ok: true });
    const saved = d.docs["integrations/storageR2"] as { test: { ok: boolean; at: string }; lastOkAt: string; values: Record<string, string> };
    expect(saved.test).toMatchObject({ ok: true, at: NOW.toISOString() });
    expect(saved.lastOkAt).toBe(NOW.toISOString());
    expect(saved.values.bucket).toBe(R2.bucket);
    expect(JSON.stringify(saved)).not.toContain(SECRET);
    expect((await loadStorage(d as never, NOW.getTime())).provider).toBe("r2"); // a pass switches it on at once
    // Nothing saved for Cloudinary: a plain "not saved yet", recorded as a fail.
    expect(await testStorage(d as never, who("uOwner"), { integration: "storageCloudinary" }, { now, fetcher })).toMatchObject({ ok: false, message: "The settings aren't all saved yet." });
    expect((d.docs["integrations/storageCloudinary"] as { test: { ok: boolean } }).test.ok).toBe(false);
  });
});
