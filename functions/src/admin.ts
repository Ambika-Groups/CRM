/**
 * The Firebase Admin SDK for a host that is not Google's (D-51: a Netlify Function), started from ONE secret: the
 * service-account key in the host's environment. The key is never in the repository, never sent to a browser and never
 * logged; this file only ever reads it.
 *
 * The variable `FIREBASE_SERVICE_ACCOUNT` holds the key as JSON (the file Google gives, or just its three needed fields:
 * project_id, client_email, private_key), optionally base64. A host that limits one value's size can split it:
 * `FIREBASE_SERVICE_ACCOUNT` + `FIREBASE_SERVICE_ACCOUNT_2` (+ `_3` ...) are joined in order before reading.
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import type { ApiDeps } from "./api";

export const KEY_VARIABLE = "FIREBASE_SERVICE_ACCOUNT";

export interface ServiceAccount { projectId: string; clientEmail: string; privateKey: string }
export type Env = Record<string, string | undefined>;

/** Reads the key from the environment. Null when it is absent or not a usable key (the reason never includes the value). */
export function serviceAccountFromEnv(env: Env): ServiceAccount | null {
  let raw = (env[KEY_VARIABLE] ?? "").trim();
  for (let i = 2; env[`${KEY_VARIABLE}_${i}`]; i++) raw += (env[`${KEY_VARIABLE}_${i}`] ?? "").trim();
  if (!raw) return null;
  if (!raw.startsWith("{")) {
    try { raw = Buffer.from(raw, "base64").toString("utf8").trim(); } catch { return null; }
  }
  let j: { project_id?: unknown; client_email?: unknown; private_key?: unknown };
  try { j = JSON.parse(raw) as typeof j; } catch { return null; }
  if (typeof j?.project_id !== "string" || typeof j.client_email !== "string" || typeof j.private_key !== "string") return null;
  // A key pasted by hand often has its line breaks written as the two characters \n.
  const privateKey = j.private_key.replace(/\\n/g, "\n");
  if (!j.project_id || !j.client_email.includes("@") || !privateKey.includes("PRIVATE KEY")) return null;
  return { projectId: j.project_id, clientEmail: j.client_email, privateKey };
}

/** The smallest form of a key that still works here: what the wizard stores (about 1.8 KB instead of 2.4 KB). */
export function compactKey(fullJson: string): string {
  const j = JSON.parse(fullJson) as { project_id: string; client_email: string; private_key: string };
  return JSON.stringify({ project_id: j.project_id, client_email: j.client_email, private_key: j.private_key });
}

export interface Runtime extends Omit<ApiDeps, "origin"> { app: App; db: Firestore; auth: Auth; projectId: string }

let cached: Runtime | null = null;

/** The Admin SDK, started once per running instance. Null while the key variable is not set: the caller answers "not connected yet". */
export function runtime(env: Env = process.env): Runtime | null {
  if (cached) return cached;
  const sa = serviceAccountFromEnv(env);
  if (!sa) return null;
  const app = getApps()[0] ?? initializeApp({ credential: cert(sa), projectId: sa.projectId });
  // The Admin SDK's usual transport (gRPC): the one the emulator tests run on. Its REST option (preferRest) starts quicker
  // after an idle spell, but it failed those tests and ran out of memory, so it is not used.
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  const auth = getAuth(app);
  cached = {
    app, db, auth, projectId: sa.projectId,
    where: `netlify ${env.AWS_REGION ?? ""}`.trim(),
    verifyIdToken: (token) => auth.verifyIdToken(token),
    verifyAppCheck: async (token) => { await getAppCheck(app).verifyToken(token); },
    sendPush: async (token) => {
      await getMessaging(app).send({ token, notification: { title: "Ambika CRM", body: "Push notifications are working." }, webpush: { fcmOptions: { link: "/" } } });
    },
    firestoreRegion: async () => {
      if (env.FIRESTORE_EMULATOR_HOST) return null; // a local emulator has no region to ask Google about
      const t = await app.options.credential?.getAccessToken();
      if (!t) return null;
      const r = await fetch(`https://firestore.googleapis.com/v1/projects/${sa.projectId}/databases/(default)`, { headers: { Authorization: `Bearer ${t.access_token}` } });
      return r.ok ? ((await r.json()) as { locationId?: string }).locationId ?? null : null;
    },
    // Field names and messages only: never the request body, a token or the key.
    log: (message, detail) => console.error(message, JSON.stringify(detail ?? {})),
  };
  return cached;
}

/** For tests: forget the started SDK. */
export function resetRuntime() { cached = null; }
