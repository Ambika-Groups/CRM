/**
 * The callable functions (region asia-south1, set in index.ts):
 *  - command: run one shared core command in a transaction (posting, numbering, audit, claims).
 *  - bootstrapStatus, bootstrapOwner: the first owner (DEPLOY.md). Gated by OWNER_EMAIL, once only.
 *  - setupSave, setupClear, setupTest, setupRotateWebsiteKey, connectionTest: Setup & integrations (D-48, D-49).
 */
import "./app";
import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall, onRequest, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { CommandError, canBecomeFirstOwner, claimsFor, firstOwnerDocs, ownerHint, type TestOutcome } from "@ag/core";
import { executeCommand, syncClaims } from "./command";
import { loadSample, removeSample, sampleStatus } from "./sample";
import {
  appCheckEnforced, clearIntegration, handleEnquiry, ReauthRequired, recordBrowserTest, recordOutcome, requireSuperUser, rotateWebsiteKey, saveIntegration, serverChecks, testIntegration, type Caller,
} from "./setup";

const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

function caller(req: CallableRequest): Caller {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return { uid: req.auth.uid, authTime: req.auth.token.auth_time };
}

/** The App Check switch on the Setup page decides whether a call without a valid App Check token is refused (D-41). */
async function checkAppCheck(req: CallableRequest): Promise<void> {
  if (!req.app && (await appCheckEnforced(db))) throw new HttpsError("failed-precondition", "This app could not be verified. Reload the page and try again.");
}

/** Plain-words errors for the page; anything unexpected is logged here and shown as a general message. */
function toHttps(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e;
  if (e instanceof ReauthRequired) return new HttpsError("failed-precondition", e.message, { reauth: true });
  if (e instanceof CommandError) return new HttpsError("failed-precondition", e.message, { fields: e.fields });
  logger.error("callable failed", { message: e instanceof Error ? e.message : String(e) });
  return new HttpsError("internal", "Something went wrong on our side. Nothing was saved. Try again.");
}

const wrap = <T>(fn: (req: CallableRequest) => Promise<T>) => async (req: CallableRequest): Promise<T> => {
  try { await checkAppCheck(req); return await fn(req); } catch (e) { throw toHttps(e); }
};

export const command = onCall({ timeoutSeconds: 60 }, wrap(async (req) => {
  const who = caller(req);
  const data = (req.data ?? {}) as { name?: unknown; args?: unknown; requestId?: unknown };
  if (typeof data.name !== "string") throw new CommandError("This action isn't available.");
  if (typeof data.requestId !== "string" || !REQUEST_ID.test(data.requestId)) throw new CommandError("This request could not be read. Reload the page and try again.");
  const out = await executeCommand(db, getAuth(), { uid: who.uid, name: data.name, args: data.args ?? {}, requestId: data.requestId });
  return { result: out.result ?? null };
}));

// ---------- first owner ----------

const ownerEmail = () => (process.env.OWNER_EMAIL ?? "").trim();

/** May this signed-in person be set up as the first owner? Case does not matter; the email must be verified (core canBecomeFirstOwner). */
function eligible(req: CallableRequest) {
  return canBecomeFirstOwner(ownerEmail(), { email: req.auth?.token.email, email_verified: req.auth?.token.email_verified });
}

/** Tells a signed-in person who has no role whether "Set up as the first owner" is for them. */
export const bootstrapStatus = onCall(wrap(async (req) => {
  caller(req);
  const done = (await db.doc("meta/bootstrap").get()).exists;
  const e = eligible(req);
  // A hint about the owner address (its shape only) goes to someone on the same email domain, to help spot a typo.
  return { canBootstrap: e.ok && !done, alreadySetUp: done, ownerEmailConfigured: !!ownerEmail(), ownerHint: e.why === "different" && !done ? ownerHint(ownerEmail(), e.email) : null, emailVerified: req.auth?.token.email_verified === true };
}));

/** Make the signed-in person the first owner and super user: once, and only for OWNER_EMAIL with a verified email. */
export const bootstrapOwner = onCall(wrap(async (req) => {
  const who = caller(req);
  const e = eligible(req);
  if (!e.ok) {
    throw new CommandError(e.why === "unverified" ? "Verify your email first: press the link in the email we sent you, then try again."
      : "This account can't be set up as the owner. Sign in with the address you put in OWNER_EMAIL (capital letters don't matter).");
  }
  const now = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const marker = db.doc("meta/bootstrap");
    if ((await tx.get(marker)).exists) throw new CommandError("The owner is already set up.");
    for (const { collection, doc } of firstOwnerDocs({ uid: who.uid, name: String(req.auth?.token.name ?? ""), email: e.email }, now)) tx.set(db.doc(`${collection}/${doc.id}`), doc);
    tx.set(db.doc(`audit_log/bootstrap_${who.uid}`), { entity: "users", entityId: who.uid, action: "create", command: "bootstrapOwner", by: who.uid, at: now, fields: [], paths: [`users/${who.uid}`] });
  });
  await getAuth().setCustomUserClaims(who.uid, claimsFor({ role: "owner", active: true, projectIds: [], superUser: true }));
  await db.doc(`users/${who.uid}`).update({ claimsAt: Timestamp.now() });
  return { ok: true };
}));

// ---------- Setup & integrations (D-48, D-49) ----------

const projectId = () => process.env.GCLOUD_PROJECT ?? '';

export const setupSave = onCall(wrap(async (req) => saveIntegration(db, caller(req), (req.data ?? {}) as never)));

export const setupClear = onCall(wrap(async (req) => {
  await clearIntegration(db, caller(req), (req.data as { integration?: unknown } | undefined)?.integration);
  return { ok: true };
}));

/** Server-run Tests (email, maps, website link). */
export const setupTest = onCall(wrap(async (req) => testIntegration(db, caller(req), (req.data ?? {}) as never, {
  endpoint: `https://asia-south1-${projectId()}.cloudfunctions.net/submitEnquiry`,
  superUserEmail: String(req.auth?.token.email ?? ''),
})));

export const setupRotateWebsiteKey = onCall(wrap(async (req) => rotateWebsiteKey(db, caller(req))));

/** Browser-run Tests report their result here. */
export const setupRecordTest = onCall(wrap(async (req) => {
  await recordBrowserTest(db, caller(req), (req.data ?? {}) as never);
  return { ok: true };
}));

/** The page's functions Test: a plain call that proves the callables are deployed and reachable. */
export const ping = onCall(wrap(async (req) => {
  caller(req);
  return { ok: true, at: new Date().toISOString(), region: 'asia-south1' };
}));

/** The server's part of the Firestore and Storage Tests: reads, the database region and the bucket location. */
export const connectionTest = onCall(wrap(async (req) => {
  await requireSuperUser(db, caller(req));
  const lines = await serverChecks({
    databaseReadable: async () => { await db.doc('meta/bootstrap').get(); },
    firestoreRegion: async () => {
      const token = await getApp().options.credential?.getAccessToken();
      if (!token) return null;
      const r = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)`, { headers: { Authorization: `Bearer ${token.access_token}` } });
      return r.ok ? ((await r.json()) as { locationId?: string }).locationId ?? null : null;
    },
    bucketLocation: async () => {
      const bucket = getStorage().bucket();
      if (!(await bucket.exists())[0]) return null;
      return ((await bucket.getMetadata())[0].location as string | undefined) ?? '';
    },
  });
  return { lines };
}));

/** The push Test: send one notification to the browser that just registered, and record the result. */
export const setupTestPush = onCall(wrap(async (req) => {
  const who = caller(req);
  await requireSuperUser(db, who);
  const token = (req.data as { token?: unknown } | undefined)?.token;
  if (typeof token !== 'string' || token.length < 20) throw new CommandError('This browser could not register for notifications.');
  let outcome: TestOutcome;
  try {
    await getMessaging().send({ token, notification: { title: 'Ambika CRM', body: 'Push notifications are working.' }, webpush: { fcmOptions: { link: '/' } } });
    outcome = { ok: true, message: 'A test notification was sent to this browser. You should see it now.' };
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    outcome = code.includes('registration-token-not-registered') || code.includes('invalid-argument')
      ? { ok: false, message: "This browser's notification address was not accepted.", hint: 'Check the web push key matches Firebase console > Project settings > Cloud Messaging > Web Push certificates.' }
      : { ok: false, message: 'The notification could not be sent.', hint: 'Check that Cloud Messaging is enabled for the project, then try again.' };
  }
  await recordOutcome(db, 'push', outcome, new Date().toISOString());
  return outcome;
}));

/** Sample data for an empty project (super user, on purpose only). action: status, load or remove. */
export const sampleData = onCall({ timeoutSeconds: 300, memory: "1GiB" }, wrap(async (req) => {
  const who = caller(req);
  const action = (req.data as { action?: unknown } | undefined)?.action;
  if (action === "load") return loadSample(db, who);
  if (action === "remove") return removeSample(db, who);
  return sampleStatus(db, who);
}));

// ---------- the website's enquiry link (contract v3, R13.1a): key check and dry run until leads arrive (Phase 3) ----------

export const submitEnquiry = onRequest({ cors: false }, async (req, res) => {
  try {
    const out = await handleEnquiry(db, req.method, String(req.headers.authorization ?? ''), req.body);
    res.status(out.status).json(out.body);
  } catch (e) {
    logger.error('submitEnquiry failed', { message: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
});

// Exported for the emulator tests.
export { syncClaims };
