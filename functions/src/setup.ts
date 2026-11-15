/**
 * Setup & integrations on the server (D-48, D-49). Only a super user (an active owner with superUser=true on the
 * users document, the same fact the sign-in claim mirrors) may use these, every change needs a sign-in within the
 * last 5 minutes, and every change leaves an audit entry that never contains a secret value.
 *
 * Storage (D-49): public values, the masked tail and the last Test result go in `integrations/{id}` (a super user's
 * page reads it); secrets go in `private_config/{id}`, which no client can read or write (rules: `if false`; only
 * this code, through the Admin SDK). Firestore backups and exports contain those secrets, so they are sensitive.
 * The website's key is the exception: only its SHA-256 hash is kept.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  INTEGRATIONS, INTEGRATION_IDS, CommandError, maskSecret, signedInRecently, validateIntegration, toStoredPhone,
  type IntegrationDef, type IntegrationId, type IntegrationStatus, type TestOutcome, type User,
} from "@ag/core";

export interface Caller { uid: string; authTime?: number }

const newAuditId = () => randomBytes(10).toString("hex");

/** The caller must be an active owner marked as super user on the users document. */
export async function requireSuperUser(db: Firestore, caller: Caller): Promise<User> {
  const snap = await db.doc(`users/${caller.uid}`).get();
  const u = snap.exists ? (snap.data() as User) : null;
  if (!u || !u.active || u.role !== "owner" || u.superUser !== true) throw new CommandError("Only a super user can open Setup & integrations.");
  return u;
}

export class ReauthRequired extends Error {
  constructor() { super("Please sign in again to change settings. It keeps your setup safe."); }
}

/** Changes need a fresh sign-in (D-48): within 5 minutes. The page asks the person to sign in again, then retries. */
export function requireFreshSignIn(caller: Caller, now: () => number = Date.now): void {
  if (!signedInRecently(caller.authTime, now())) throw new ReauthRequired();
}

function def(id: unknown): IntegrationDef {
  if (typeof id !== "string" || !(INTEGRATION_IDS as readonly string[]).includes(id)) throw new CommandError("This service isn't known.");
  return INTEGRATIONS[id as IntegrationId];
}

const statusRef = (db: Firestore, id: string) => db.doc(`integrations/${id}`);
const secretRef = (db: Firestore, id: string) => db.doc(`private_config/${id}`);

async function audit(db: Firestore, caller: Caller, id: string, action: string, fields: string[], nowIso: string): Promise<void> {
  // Field NAMES only (for example "apiKey"), never values.
  await db.doc(`audit_log/${newAuditId()}`).set({ entity: "integrations", entityId: id, action, fields, by: caller.uid, at: nowIso });
}

export interface SaveRequest { integration: unknown; enabled?: unknown; enforce?: unknown; values?: unknown }

/** Save one integration. A blank secret keeps the saved one. Returns the status a page may show. */
export async function saveIntegration(db: Firestore, caller: Caller, req: SaveRequest, now: () => Date = () => new Date()): Promise<IntegrationStatus> {
  await requireSuperUser(db, caller);
  requireFreshSignIn(caller, () => now().getTime());
  const d = def(req.integration);
  if (!d.available) throw new CommandError("This is coming in a later phase.");
  if (d.kind !== "stored") throw new CommandError("There is nothing to save here. Use Test.");
  if (d.generated) throw new CommandError("This key is made for you. Choose Make a new key.");
  const values = (typeof req.values === "object" && req.values ? req.values : {}) as Record<string, unknown>;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) clean[k] = typeof v === "string" ? v.trim() : "";

  const nowIso = now().toISOString();
  const out = await db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(statusRef(db, d.id), secretRef(db, d.id));
    const sSnap = snaps[0]!, pSnap = snaps[1]!;
    const prev = (sSnap.data() ?? {}) as Partial<IntegrationStatus>;
    const prevSecrets = ((pSnap.data() ?? {}).secrets ?? {}) as Record<string, string>;
    const errors = validateIntegration(d, clean, Object.fromEntries(Object.keys(prevSecrets).map((k) => [k, !!prevSecrets[k]])));
    if (Object.keys(errors).length) throw new CommandError("Check the highlighted settings.", errors);

    const secrets = { ...prevSecrets };
    const publicValues = { ...(prev.values ?? {}) };
    const masked = { ...(prev.masked ?? {}) };
    const changed: string[] = [];
    for (const f of d.fields) {
      const v = clean[f.key] ?? "";
      if (!v) continue;
      if (f.secret) { if (secrets[f.key] !== v) { secrets[f.key] = v; masked[f.key] = maskSecret(v); changed.push(f.key); } }
      else if (publicValues[f.key] !== v) { publicValues[f.key] = v; changed.push(f.key); }
    }
    const enabled = typeof req.enabled === "boolean" ? req.enabled : prev.enabled ?? true;
    const enforce = d.hasEnforce ? (typeof req.enforce === "boolean" ? req.enforce : prev.enforce ?? false) : undefined;
    if (enabled !== (prev.enabled ?? true)) changed.push("enabled");
    if (d.hasEnforce && enforce !== (prev.enforce ?? false)) changed.push("enforce");

    const next: IntegrationStatus = {
      id: d.id, enabled, values: publicValues, masked, ...(d.hasEnforce ? { enforce } : {}),
      // A change clears the last Test, so "verified" never outlives the setting it verified.
      test: changed.length ? null : prev.test ?? null, lastOkAt: prev.lastOkAt ?? null, updatedAt: nowIso, updatedBy: caller.uid,
    };
    if (Object.keys(secrets).length) tx.set(secretRef(db, d.id), { secrets, updatedAt: Timestamp.fromDate(now()) });
    tx.set(statusRef(db, d.id), next);
    return { next, changed };
  });
  await audit(db, caller, d.id, "save", out.changed, nowIso);
  return out.next;
}

/** Remove an integration's saved values and secrets. */
export async function clearIntegration(db: Firestore, caller: Caller, integration: unknown, now: () => Date = () => new Date()): Promise<void> {
  await requireSuperUser(db, caller);
  requireFreshSignIn(caller, () => now().getTime());
  const d = def(integration);
  await Promise.all([statusRef(db, d.id).delete(), secretRef(db, d.id).delete()]);
  await audit(db, caller, d.id, "clear", d.fields.map((f) => f.key), now().toISOString());
}

/**
 * Make (or replace) the website's key for the enquiry link (contract v3, R13.1a). The key is shown ONCE, here, and
 * only its SHA-256 hash is kept, so even a backup cannot reveal it. The inbound endpoint hashes what the website
 * sends and compares.
 */
export async function rotateWebsiteKey(db: Firestore, caller: Caller, now: () => Date = () => new Date()): Promise<{ key: string; status: IntegrationStatus }> {
  await requireSuperUser(db, caller);
  requireFreshSignIn(caller, () => now().getTime());
  const key = `agw_${randomBytes(32).toString("base64url")}`;
  const nowIso = now().toISOString();
  const prev = (await statusRef(db, "websiteLink").get()).data() as Partial<IntegrationStatus> | undefined;
  const next: IntegrationStatus = { id: "websiteLink", enabled: true, values: {}, masked: { apiKey: maskSecret(key) }, test: null, lastOkAt: prev?.lastOkAt ?? null, updatedAt: nowIso, updatedBy: caller.uid };
  await Promise.all([
    secretRef(db, "websiteLink").set({ secrets: { apiKeyHash: sha256(key) }, updatedAt: Timestamp.fromDate(now()) }),
    statusRef(db, "websiteLink").set(next),
  ]);
  await audit(db, caller, "websiteLink", "rotate", ["apiKey"], nowIso);
  return { key, status: next };
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Does this key match the saved hash? Constant-time. Used by the inbound website endpoint. */
export async function websiteKeyMatches(db: Firestore, key: string): Promise<boolean> {
  const snap = await secretRef(db, "websiteLink").get();
  const hash = ((snap.data() ?? {}).secrets as { apiKeyHash?: string } | undefined)?.apiKeyHash;
  if (!hash) return false;
  const a = Buffer.from(sha256(key), "hex"), b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Save a Test's result on the integration, with the time, and the last time one passed. */
export async function recordOutcome(db: Firestore, id: IntegrationId, outcome: TestOutcome, nowIso: string): Promise<void> {
  const ref = statusRef(db, id);
  const prev = (await ref.get()).data() as Partial<IntegrationStatus> | undefined;
  const next: IntegrationStatus = {
    id, enabled: prev?.enabled ?? true, values: prev?.values ?? {}, masked: prev?.masked ?? {}, ...(prev?.enforce !== undefined ? { enforce: prev.enforce } : {}),
    test: { ...outcome, at: nowIso }, lastOkAt: outcome.ok ? nowIso : prev?.lastOkAt ?? null,
    ...(prev?.updatedAt ? { updatedAt: prev.updatedAt } : {}), ...(prev?.updatedBy ? { updatedBy: prev.updatedBy } : {}),
  };
  await ref.set(next);
}

/** A browser-run Test reports its result here (the page has just run it); only a super user may. */
export async function recordBrowserTest(db: Firestore, caller: Caller, req: { integration?: unknown; ok?: unknown; message?: unknown; hint?: unknown }, now: () => Date = () => new Date()): Promise<void> {
  await requireSuperUser(db, caller);
  const d = def(req.integration);
  if (!d.available) throw new CommandError("This is coming in a later phase.");
  const outcome: TestOutcome = { ok: req.ok === true, message: String(req.message ?? "").slice(0, 300), ...(req.hint ? { hint: String(req.hint).slice(0, 300) } : {}) };
  await recordOutcome(db, d.id, outcome, now().toISOString());
}

// ---------- server-run Tests ----------

const FIX_EMAIL_KEY = "Make a new key on the Resend page (API Keys), then paste and save it here.";

async function emailTest(secrets: Record<string, string>, status: Partial<IntegrationStatus>, to: string, fetcher: typeof fetch): Promise<TestOutcome> {
  const from = status.values?.fromAddress ?? "";
  try {
    const r = await fetcher("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${secrets.apiKey ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: "Ambika CRM test email", text: "This is a test email from your Ambika CRM. If you can read this, email is working." }),
    });
    if (r.ok) return { ok: true, message: `A test email was sent to ${to}. Check that inbox.` };
    if (r.status === 401 || r.status === 403) return { ok: false, message: "Resend did not accept this key.", hint: FIX_EMAIL_KEY };
    if (r.status === 422) return { ok: false, message: "Resend refused the from-address.", hint: "On the Resend page verify your company domain, then use an address on it. Until then you can use onboarding@resend.dev, which only emails your own Resend login address." };
    return { ok: false, message: "Resend could not send the email right now.", hint: "Try again in a minute." };
  } catch {
    return { ok: false, message: "Resend could not be reached.", hint: "Try again in a minute." };
  }
}

async function mapsTest(status: Partial<IntegrationStatus>, fetcher: typeof fetch): Promise<TestOutcome> {
  const key = status.values?.apiKey ?? "";
  if (!key) return { ok: false, message: "No Maps key is saved.", hint: "Maps is optional. Paste a key and save it, or leave this off." };
  try {
    const r = await fetcher(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent("Hazratganj, Lucknow")}&key=${encodeURIComponent(key)}`);
    const j = (await r.json()) as { status?: string };
    if (j.status === "OK") return { ok: true, message: "Google Maps answered a test address search." };
    if (j.status === "REQUEST_DENIED") return { ok: false, message: "Google Maps did not accept this key.", hint: "In Google Cloud Console turn on the Geocoding API for the project, and check the key's restrictions allow it." };
    if (j.status === "OVER_QUERY_LIMIT") return { ok: false, message: "This key has used up its limit.", hint: "Check billing and quotas for the key in Google Cloud Console." };
    return { ok: false, message: `Google Maps replied: ${j.status ?? "no answer"}.`, hint: "Check the key on the Google Cloud Console Credentials page." };
  } catch {
    return { ok: false, message: "Google Maps could not be reached.", hint: "Try again in a minute." };
  }
}

/**
 * The website link: send a signed sample enquiry with the website's key to our own submitEnquiry address, as the
 * website will. It runs as a dry run (no lead is made, leads come in Phase 3), so a Pass proves the key and the
 * address work end to end. The key is the one just shown by "Make a new key"; only its hash is stored.
 */
async function websiteTest(key: string, endpoint: string, fetcher: typeof fetch): Promise<TestOutcome> {
  if (!key) return { ok: false, message: "To test, paste the website key.", hint: "The key is shown once when you make it. If you no longer have it, choose Make a new key and test straight away." };
  try {
    const r = await fetcher(endpoint, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true, name: "Test Enquiry", phone: "98765 43210", message: "Sample enquiry from Setup & integrations" }),
    });
    const j = (await r.json().catch(() => ({}))) as { accepted?: boolean; dryRun?: boolean };
    if (r.ok && j.accepted && j.dryRun) return { ok: true, message: "The website link works. A sample enquiry was accepted (a test only: no lead was made)." };
    if (r.status === 401) return { ok: false, message: "The address answered but did not accept this key.", hint: "Choose Make a new key and use the new key in the website's settings." };
    return { ok: false, message: "The enquiry address did not answer as expected.", hint: "Check that the functions were deployed (npx firebase-tools deploy --only functions)." };
  } catch {
    return { ok: false, message: "The enquiry address could not be reached.", hint: "Check that the functions were deployed, then try again." };
  }
}

export interface TestDeps { fetcher?: typeof fetch; now?: () => Date; endpoint?: string; superUserEmail?: string }

/** Run one server-side Test and save its result. Browser-side items report through recordBrowserTest. */
export async function testIntegration(db: Firestore, caller: Caller, req: { integration?: unknown; key?: unknown }, deps: TestDeps = {}): Promise<TestOutcome> {
  const u = await requireSuperUser(db, caller);
  const d = def(req.integration);
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? (() => new Date());
  const [sSnap, pSnap] = await Promise.all([statusRef(db, d.id).get(), secretRef(db, d.id).get()]);
  const status = (sSnap.data() ?? {}) as Partial<IntegrationStatus>;
  const secrets = ((pSnap.data() ?? {}).secrets ?? {}) as Record<string, string>;
  let outcome: TestOutcome;
  if (!d.available) outcome = { ok: false, message: "This is coming in a later phase." };
  else if (d.testsIn !== "server") outcome = { ok: false, message: "This Test runs in your browser.", hint: "Use the Test button on the page." };
  else if (d.id === "email") {
    outcome = !secrets.apiKey || !status.values?.fromAddress
      ? { ok: false, message: "The email key and from-address aren't both saved yet.", hint: "Fill in both and choose Save, then Test." }
      : await emailTest(secrets, status, deps.superUserEmail || u.email || "", fetcher);
  } else if (d.id === "maps") outcome = await mapsTest(status, fetcher);
  else if (d.id === "websiteLink") {
    outcome = status.masked?.apiKey ? await websiteTest(typeof req.key === "string" ? req.key.trim() : "", deps.endpoint ?? "", fetcher)
      : { ok: false, message: "There is no website key yet.", hint: "Choose Make a new key." };
  } else outcome = { ok: false, message: "This Test is not available." };
  await recordOutcome(db, d.id, outcome, now().toISOString());
  return outcome;
}

/** One line of the connection check: plain words, with a hint when it fails. */
export interface CheckLine { key: string; ok: boolean; message: string; hint?: string }

export interface ServerProbes {
  firestoreRegion: () => Promise<string | null>;
  bucketLocation: () => Promise<string | null>;
  databaseReadable: () => Promise<void>;
}

/** The server's part of the Firestore and Storage Tests: the database answers and sits in Mumbai; storage exists in us-central1. */
export async function serverChecks(p: ServerProbes): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];
  try {
    await p.databaseReadable();
    let region: string | null = null;
    try { region = await p.firestoreRegion(); } catch { /* region is a bonus check */ }
    if (region && region.toLowerCase() !== "asia-south1") {
      lines.push({ key: "database", ok: false, message: `The database is in ${region}, not asia-south1 (Mumbai).`, hint: "Firestore's region can't be changed. Make a new Firebase project and create the (default) database in asia-south1." });
    } else {
      lines.push({ key: "database", ok: true, message: region ? "The database answers and is in asia-south1 (Mumbai)." : "The database answers." });
    }
  } catch {
    lines.push({ key: "database", ok: false, message: "The database did not answer.", hint: "In the Firebase console open Firestore Database and check that the (default) database was created in asia-south1." });
  }
  try {
    const loc = await p.bucketLocation();
    if (loc === null) lines.push({ key: "storage", ok: false, message: "File storage is not set up.", hint: "In the Firebase console open Storage and press Get started (choose us-central1)." });
    else if (loc.toLowerCase() !== "us-central1") lines.push({ key: "storage", ok: true, message: `File storage is ready, in ${loc}. us-central1 is the free choice.`, hint: "Storage in another region may not be free. Check the Firebase pricing page." });
    else lines.push({ key: "storage", ok: true, message: "File storage is ready, in us-central1." });
  } catch {
    lines.push({ key: "storage", ok: false, message: "File storage could not be checked.", hint: "In the Firebase console open Storage and press Get started (choose us-central1)." });
  }
  return lines;
}

/** Whether calls must carry an App Check token (the page's enforce switch). Cached for a minute per instance. */
let enforceCache: { at: number; value: boolean } | null = null;
export async function appCheckEnforced(db: Firestore, nowMs: number = Date.now()): Promise<boolean> {
  if (enforceCache && nowMs - enforceCache.at < 60_000) return enforceCache.value;
  const snap = await db.doc("integrations/appCheck").get();
  const s = snap.data() as Partial<IntegrationStatus> | undefined;
  const value = !!s && s.enabled !== false && s.enforce === true;
  enforceCache = { at: nowMs, value };
  return value;
}
export function resetAppCheckCache() { enforceCache = null; }

// ---------- inbound website enquiry (contract v3, R13.1a): minimal until leads arrive in Phase 3 ----------

export interface EnquiryResult { status: number; body: Record<string, unknown> }

/**
 * Handles one POST from the website. M1.6 authenticates the key and supports a dry run only; real leads (de-duplication
 * by phone, the follow-up clock) switch on with the leads module in Phase 3, and until then a real enquiry is refused
 * with a clear message so nothing is lost silently.
 */
export async function handleEnquiry(db: Firestore, method: string, authorization: string, body: unknown): Promise<EnquiryResult> {
  if (method !== "POST") return { status: 405, body: { error: "Use POST." } };
  const key = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] ?? "";
  if (!key || !(await websiteKeyMatches(db, key))) return { status: 401, body: { error: "The key was not accepted." } };
  const b = (typeof body === "object" && body ? body : {}) as { dryRun?: unknown; name?: unknown; phone?: unknown };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const phone = typeof b.phone === "string" ? toStoredPhone(b.phone) : null;
  if (name.length < 2 || !phone) return { status: 400, body: { error: "A name and a valid 10-digit mobile number are needed." } };
  if (b.dryRun === true) return { status: 200, body: { accepted: true, dryRun: true } };
  return { status: 501, body: { error: "Enquiries are not switched on yet. They arrive with the leads module." } };
}
