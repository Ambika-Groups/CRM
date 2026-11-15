/**
 * The Firebase web SDK, set up once (M1.6). Firestore keeps an offline copy on this device (all tabs share it), so
 * pages the person has opened still read without a connection. App Check starts first when a reCAPTCHA site key is
 * configured (D-41), so every later call carries its token.
 */
import type { FirebaseWebConfig } from "@ag/core";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from "firebase/app-check";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager, Timestamp, type Firestore } from "firebase/firestore";
import { getFunctions, httpsCallable, type Functions } from "firebase/functions";
import { getStorage, type FirebaseStorage } from "firebase/storage";

/** The region of the callable functions (the database is next to them, asia-south1). */
export const FUNCTIONS_REGION = "asia-south1";

export interface Clients {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
  storage: FirebaseStorage;
  appCheck: AppCheck | null;
  projectId: string;
}

export function createClients(config: Partial<FirebaseWebConfig>, siteKey: string): Clients {
  const existing = getApps()[0];
  const app = existing ?? initializeApp({
    apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId,
    storageBucket: config.storageBucket, messagingSenderId: config.messagingSenderId, appId: config.appId,
  });
  let appCheck: AppCheck | null = null;
  if (!existing && siteKey) {
    try { appCheck = initializeAppCheck(app, { provider: new ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: true }); } catch { appCheck = null; }
  }
  let db: Firestore;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    // Already initialised (a second call), or the browser keeps nothing offline (private window): carry on without the offline copy.
    try { db = getFirestore(app); } catch { db = initializeFirestore(app, { localCache: memoryLocalCache() }); }
  }
  return {
    app, auth: getAuth(app), db, functions: getFunctions(app, FUNCTIONS_REGION), storage: getStorage(app), appCheck,
    projectId: config.projectId ?? "",
  };
}

/** Firestore timestamps become ISO strings, so screens and core see the one shape the demo uses. */
export function plain<T = unknown>(v: unknown): T {
  if (v instanceof Timestamp) return v.toDate().toISOString() as T;
  if (Array.isArray(v)) return v.map((x) => plain(x)) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plain(x)])) as T;
  }
  return v as T;
}

export const docData = <T>(id: string, data: unknown): T => ({ ...(plain<Record<string, unknown>>(data ?? {})), id }) as T;

export function call<I, O>(c: Clients, name: string): (data: I) => Promise<O> {
  const fn = httpsCallable<I, O>(c.functions, name);
  return async (data: I) => (await fn(data)).data;
}

/** "permission-denied" from Firestore: the person may not read this (rules), as opposed to it not existing. */
export function isDenied(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "permission-denied";
}
