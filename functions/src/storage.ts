/**
 * File storage on the server (group A, the files adapter). The built-in store (compressed pictures inside the database)
 * needs nothing here: the signed-in browser writes it directly. This file is for the two optional providers the owner
 * can set up later on Setup & integrations:
 *
 *  - Cloudflare R2: the browser never holds the R2 keys. It asks `filesPresign` for a short-lived signed address
 *    (AWS Signature V4, built here with node:crypto, no SDK) and sends or fetches the file with that. Before signing,
 *    the caller's role is checked with the same core functions the security rules mirror (canAttachFile, canReadFile,
 *    canDeleteFile). The secret access key is read from `private_config/storageR2`, which no client can read.
 *  - Cloudinary (free plan): an unsigned upload preset, which is public by design; the browser uploads directly.
 *
 * `filesConfig` tells a signed-in browser which provider is in use (never a secret). A provider is used only when it is
 * switched on and its last Test passed, so a half-typed setting can never lose a file.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  activeStorageProvider, canAttachFile, canDeleteFile, canReadFile, checkStored, CommandError, FILE_ERROR_TEXT, FILE_ID_PATTERN, filePath, isFileKind,
  parseFilePath, r2ObjectKey,
  type FileAccessCtx, type FileProvider, type IntegrationId, type IntegrationStatus, type TestOutcome, type User,
} from "@ag/core";
import { recordOutcome, requireSuperUser, type Caller } from "./setup";

export const STORAGE_R2 = "storageR2";
export const STORAGE_CLOUDINARY = "storageCloudinary";

/** The storage providers whose Test runs here. */
export const isStorageTest = (integration: unknown): boolean => integration === STORAGE_R2 || integration === STORAGE_CLOUDINARY;

// ───────────────────────── AWS Signature Version 4, query-string signing ─────────────────────────

export interface PresignInput {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  /** The host only, for example "abc123.r2.cloudflarestorage.com". */
  host: string;
  /** The path as it is, not yet encoded: "/bucket/files/bill/f1.jpg". */
  path: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** How long the address works, in seconds (1 to 604800). */
  expiresSeconds: number;
  now: Date;
  /** Extra headers to sign, such as content-type: whoever uses the address must send exactly these. */
  headers?: Record<string, string>;
}

/** RFC 3986 encoding as AWS wants it: only letters, digits and - _ . ~ are left alone. */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s, "utf8").digest();

/**
 * A presigned address (AWS Signature V4 with the signature in the query string, the body unsigned). Pure: the same
 * input always gives the same address. Checked against the example published in the Amazon S3 documentation.
 */
export function presignUrl(i: PresignInput): string {
  if (!Number.isInteger(i.expiresSeconds) || i.expiresSeconds < 1 || i.expiresSeconds > 604_800) throw new Error("expiresSeconds must be 1 to 604800");
  const amzDate = `${i.now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`; // 20130524T000000Z
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const headers: Record<string, string> = { host: i.host };
  for (const [k, v] of Object.entries(i.headers ?? {})) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const uri = i.path.split("/").map(enc).join("/");
  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${i.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(i.expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  const canonicalQuery = query.map(([k, v]) => `${enc(k)}=${enc(v)}`).sort().join("&");
  const canonicalRequest = [i.method, uri, canonicalQuery, names.map((n) => `${n}:${headers[n]}\n`).join(""), signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), i.service), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");
  return `https://${i.host}${uri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ───────────────────────── Cloudflare R2 ─────────────────────────

export interface R2Config { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicBaseUrl?: string }

/** How long a signed address works: long enough for a slow phone to send a 10 MB file, short enough to be useless if it leaks. */
export const PRESIGN_SECONDS = 600;

/** A presigned R2 address for one object. A PUT signs the content type, so the file is stored as what it says it is. */
export function r2Presign(cfg: R2Config, o: { method: PresignInput["method"]; key: string; now: Date; contentType?: string; expiresSeconds?: number }): string {
  return presignUrl({
    method: o.method, host: `${cfg.accountId}.r2.cloudflarestorage.com`, path: `/${cfg.bucket}/${o.key}`, region: "auto", service: "s3",
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, expiresSeconds: o.expiresSeconds ?? PRESIGN_SECONDS, now: o.now,
    ...(o.contentType ? { headers: { "content-type": o.contentType } } : {}),
  });
}

// ───────────────────────── the saved settings ─────────────────────────

export interface CloudinaryConfig { cloudName: string; uploadPreset: string }

export interface StorageSettings {
  /** The provider new files go to. */
  provider: FileProvider;
  /** Present whenever the R2 settings are complete (also before the Test has passed, so the Test can run). */
  r2: R2Config | null;
  cloudinary: CloudinaryConfig | null;
}

const statusRef = (db: Firestore, id: string) => db.doc(`integrations/${id}`);
const secretRef = (db: Firestore, id: string) => db.doc(`private_config/${id}`);
const ready = (s: Partial<IntegrationStatus> | undefined) => !!s && s.enabled !== false && s.test?.ok === true;

let cache: { at: number; value: StorageSettings } | null = null;
export function resetStorageCache() { cache = null; }

/** Reads the storage settings (the R2 secret from the server-only document). Remembered for a minute per running instance. */
export async function loadStorage(db: Firestore, nowMs: number = Date.now()): Promise<StorageSettings> {
  if (cache && nowMs - cache.at < 60_000) return cache.value;
  const [r2Snap, r2Secret, clSnap] = await Promise.all([statusRef(db, STORAGE_R2).get(), secretRef(db, STORAGE_R2).get(), statusRef(db, STORAGE_CLOUDINARY).get()]);
  const r2Status = r2Snap.data() as Partial<IntegrationStatus> | undefined;
  const clStatus = clSnap.data() as Partial<IntegrationStatus> | undefined;
  const secrets = ((r2Secret.data() ?? {}).secrets ?? {}) as Record<string, string>;
  const v = r2Status?.values ?? {};
  const r2: R2Config | null = v.accountId && v.accessKeyId && v.bucket && secrets.secretAccessKey
    ? { accountId: v.accountId, accessKeyId: v.accessKeyId, secretAccessKey: secrets.secretAccessKey, bucket: v.bucket, ...(v.publicBaseUrl ? { publicBaseUrl: v.publicBaseUrl.replace(/\/+$/, "") } : {}) }
    : null;
  const c = clStatus?.values ?? {};
  const cloudinary: CloudinaryConfig | null = c.cloudName && c.uploadPreset ? { cloudName: c.cloudName, uploadPreset: c.uploadPreset } : null;
  const value: StorageSettings = { provider: activeStorageProvider({ r2: !!r2 && ready(r2Status), cloudinary: !!cloudinary && ready(clStatus) }), r2, cloudinary };
  cache = { at: nowMs, value };
  return value;
}

/** Who is asking, from their users document (never from the request). Switched-off people are refused. */
async function accessCtx(db: Firestore, caller: Caller): Promise<FileAccessCtx> {
  const snap = await db.doc(`users/${caller.uid}`).get();
  const u = snap.exists ? (snap.data() as User) : null;
  if (!u || !u.active) throw new CommandError("Your account is switched off. Ask the owner to switch it on.");
  return { role: u.role, uid: caller.uid, assignedProjectIds: u.projectIds ?? [] };
}

/** What a browser may know about storage: the provider in use and the public values it needs. Never a key. */
export interface FilesConfig {
  provider: FileProvider;
  cloudinary?: CloudinaryConfig;
  r2?: { publicBaseUrl?: string };
}

export async function filesConfig(db: Firestore, caller: Caller, now: () => Date = () => new Date()): Promise<FilesConfig> {
  await accessCtx(db, caller);
  const s = await loadStorage(db, now().getTime());
  return {
    provider: s.provider,
    // Files already kept with a provider must stay readable after another one becomes the choice for new files.
    ...(s.cloudinary ? { cloudinary: s.cloudinary } : {}),
    ...(s.r2 ? { r2: s.r2.publicBaseUrl ? { publicBaseUrl: s.r2.publicBaseUrl } : {} } : {}),
  };
}

const isoOf = (v: unknown): string => (typeof v === "string" ? v : v && typeof (v as { toDate?: unknown }).toDate === "function" ? (v as { toDate(): Date }).toDate().toISOString() : "");

export interface PresignDeps { now?: () => Date; fetcher?: typeof fetch }

/**
 * Signed addresses for files kept in R2.
 *   { op: "put", id, kind, mime, sizeBytes, projectId }  ->  { url, path, headers }   (then the browser PUTs the file)
 *   { op: "get", id }                                     ->  { url }                   (opens for 10 minutes)
 *   { op: "delete", id }                                  ->  { ok: true }              (the server removes the object and its record)
 * Every one checks the caller against the file: the same answers as core's canAttachFile, canReadFile and canDeleteFile.
 */
export async function filesPresign(db: Firestore, caller: Caller, data: Record<string, unknown>, deps: PresignDeps = {}): Promise<Record<string, unknown>> {
  const now = deps.now ?? (() => new Date());
  const ctx = await accessCtx(db, caller);
  const s = await loadStorage(db, now().getTime());
  if (!s.r2) throw new CommandError("Cloudflare R2 is not set up, so this file can't be reached. Ask the owner to check Setup & integrations.");
  const id = data.id;
  if (typeof id !== "string" || !FILE_ID_PATTERN.test(id)) throw new CommandError(FILE_ERROR_TEXT.failed);

  if (data.op === "put") {
    if (s.provider !== "r2") throw new CommandError("Cloudflare R2 is not switched on. The file was not uploaded.");
    const { kind, mime, sizeBytes } = data;
    const projectId = typeof data.projectId === "string" ? data.projectId : null;
    if (!isFileKind(kind) || typeof mime !== "string" || typeof sizeBytes !== "number") throw new CommandError(FILE_ERROR_TEXT.failed);
    const problem = checkStored({ mime, sizeBytes }, kind, "r2");
    if (problem) throw new CommandError(FILE_ERROR_TEXT[problem]);
    if (!canAttachFile(kind, projectId, ctx)) throw new CommandError(FILE_ERROR_TEXT.denied);
    // An id that is already a file would let its bytes be replaced.
    if ((await db.doc(`files/${id}`).get()).exists) throw new CommandError(FILE_ERROR_TEXT.failed);
    const key = r2ObjectKey({ id, kind, mime });
    return { url: r2Presign(s.r2, { method: "PUT", key, contentType: mime, now: now() }), path: filePath("r2", key), headers: { "Content-Type": mime }, expiresInSeconds: PRESIGN_SECONDS };
  }

  const snap = await db.doc(`files/${id}`).get();
  const meta = snap.exists ? ({ ...(snap.data() as Record<string, unknown>) }) : null;
  const where = meta ? parseFilePath(meta.path) : null;
  if (!meta || !where || where.provider !== "r2") throw new CommandError(FILE_ERROR_TEXT.missing);
  meta.createdAt = isoOf(meta.createdAt);

  if (data.op === "get") {
    if (!canReadFile(meta, ctx)) throw new CommandError(FILE_ERROR_TEXT.denied);
    return { url: r2Presign(s.r2, { method: "GET", key: where.key, now: now() }), expiresInSeconds: PRESIGN_SECONDS };
  }
  if (data.op === "delete") {
    if (!canDeleteFile(meta, ctx, now().toISOString())) throw new CommandError("Only the owner or the accountant can remove this file now.");
    const r = await (deps.fetcher ?? fetch)(r2Presign(s.r2, { method: "DELETE", key: where.key, now: now(), expiresSeconds: 60 }), { method: "DELETE" });
    if (!r.ok && r.status !== 404) throw new CommandError("The file could not be removed from Cloudflare R2. Try again.");
    await db.doc(`files/${id}`).delete();
    return { ok: true };
  }
  throw new CommandError(FILE_ERROR_TEXT.failed);
}

// ───────────────────────── Tests (Setup & integrations) ─────────────────────────

const TEST_TEXT = "Ambika CRM storage test";

/** The R2 Test: save a tiny file with a signed address, read it back, delete it. Says in plain words what went wrong. */
export async function r2Test(cfg: R2Config, fetcher: typeof fetch, now: () => Date = () => new Date(), tag: string = randomBytes(6).toString("hex")): Promise<TestOutcome> {
  const key = `ag-crm-test/${tag}.txt`;
  const type = "text/plain";
  try {
    const put = await fetcher(r2Presign(cfg, { method: "PUT", key, contentType: type, now: now(), expiresSeconds: 60 }), { method: "PUT", headers: { "Content-Type": type }, body: TEST_TEXT });
    if (put.status === 403 || put.status === 401) return { ok: false, message: "Cloudflare R2 did not accept these keys.", hint: "In Cloudflare open R2 > Manage API tokens, make a token with Object Read & Write for this bucket, then paste its Access Key ID and Secret Access Key here and save." };
    if (put.status === 404) return { ok: false, message: "Cloudflare R2 did not find this bucket.", hint: "Check the bucket name and the account ID (both are on the R2 overview page in Cloudflare)." };
    if (!put.ok) return { ok: false, message: `Cloudflare R2 refused the test file (answer ${put.status}).`, hint: "Check the account ID, the bucket name and the keys, then try again." };
    const get = await fetcher(r2Presign(cfg, { method: "GET", key, now: now(), expiresSeconds: 60 }), { method: "GET" });
    const back = get.ok ? await get.text() : "";
    let publicOk = true;
    if (cfg.publicBaseUrl) {
      try { publicOk = (await fetcher(`${cfg.publicBaseUrl}/${key}`, { method: "GET" })).ok; } catch { publicOk = false; }
    }
    const del = await fetcher(r2Presign(cfg, { method: "DELETE", key, now: now(), expiresSeconds: 60 }), { method: "DELETE" });
    if (back !== TEST_TEXT) return { ok: false, message: "The test file was saved but could not be read back.", hint: "Make sure the API token allows reading (Object Read & Write), then try again." };
    if (!del.ok) return { ok: false, message: "The test file was saved and read, but could not be deleted.", hint: "Make sure the API token allows deleting (Object Read & Write). You can delete the folder ag-crm-test in the bucket yourself." };
    if (!publicOk) return { ok: false, message: "The bucket works, but the public address did not show the test file.", hint: "In Cloudflare open the bucket > Settings and turn on public access (a custom domain or the r2.dev address), or clear the Public address field and save." };
    return { ok: true, message: "A test file was saved to the bucket, read back and deleted." };
  } catch {
    return { ok: false, message: "Cloudflare R2 could not be reached.", hint: "Check the account ID (letters and digits only), then try again in a minute." };
  }
}

/** A 1 x 1 pixel PNG. */
const TEST_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
export const CLOUDINARY_TEST_ID = "ag-crm/connection-test";

/** The Cloudinary Test: upload a 1-pixel picture with the unsigned preset and open it. (An unsigned preset cannot delete, so the picture stays.) */
export async function cloudinaryTest(cfg: CloudinaryConfig, fetcher: typeof fetch): Promise<TestOutcome> {
  const presetHint = "In Cloudinary open Settings > Upload > Upload presets, add a preset with Signing mode set to Unsigned, and paste its name here.";
  try {
    const r = await fetcher(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/image/upload`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ file: TEST_PNG, upload_preset: cfg.uploadPreset, public_id: CLOUDINARY_TEST_ID }).toString(),
    });
    const j = (await r.json().catch(() => ({}))) as { secure_url?: string; error?: { message?: string } };
    if (r.ok && typeof j.secure_url === "string") {
      const seen = await fetcher(j.secure_url, { method: "GET" });
      if (!seen.ok) return { ok: false, message: "The test picture was uploaded but could not be opened.", hint: "Try again in a minute." };
      return { ok: true, message: "A test picture was uploaded to Cloudinary and opened.", hint: "The test picture (ag-crm/connection-test) stays in your Cloudinary account. You can delete it there." };
    }
    const said = (j.error?.message ?? "").toLowerCase();
    if (said.includes("preset")) return { ok: false, message: "Cloudinary did not accept this upload preset.", hint: presetHint };
    if (r.status === 401 || r.status === 404 || said.includes("cloud_name") || said.includes("cloud name")) return { ok: false, message: "Cloudinary did not find this cloud name.", hint: "The cloud name is on the Cloudinary dashboard, under Product Environment. Copy it exactly." };
    return { ok: false, message: `Cloudinary refused the test picture (answer ${r.status}).`, hint: presetHint };
  } catch {
    return { ok: false, message: "Cloudinary could not be reached.", hint: "Try again in a minute." };
  }
}

/** Runs the Test of a storage provider (super user only) and records the result, like the other server-run Tests. */
export async function testStorage(db: Firestore, caller: Caller, req: { integration?: unknown }, deps: PresignDeps = {}): Promise<TestOutcome> {
  await requireSuperUser(db, caller);
  if (!isStorageTest(req.integration)) throw new CommandError("This service isn't known.");
  const now = deps.now ?? (() => new Date());
  const fetcher = deps.fetcher ?? fetch;
  resetStorageCache(); // test what is saved now, not what was saved a minute ago
  const s = await loadStorage(db, now().getTime());
  const notSaved: TestOutcome = { ok: false, message: "The settings aren't all saved yet.", hint: "Fill in every box and choose Save, then Test." };
  const outcome = req.integration === STORAGE_R2
    ? (s.r2 ? await r2Test(s.r2, fetcher, now) : notSaved)
    : (s.cloudinary ? await cloudinaryTest(s.cloudinary, fetcher) : notSaved);
  await recordOutcome(db, req.integration as IntegrationId, outcome, now().toISOString());
  resetStorageCache(); // a pass can make this the provider for new files straight away
  return outcome;
}
