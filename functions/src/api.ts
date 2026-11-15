/**
 * The CRM's server part as one plain HTTP handler (D-51, free plan): the same work the Cloud Functions callables did
 * (callables.ts), with nothing in it that belongs to one host. A Netlify Function (netlify.ts) feeds it a request and
 * sends back what it returns.
 *
 * The request: POST, JSON body `{ name, data }`, the person's Firebase ID token in `Authorization: Bearer ...`.
 * The answer:  200 `{ result }`, or `{ error: { code, message, details? } }` with the codes the page already knows
 * (failed-precondition with `fields` or `reauth`, unauthenticated, permission-denied, unavailable, internal).
 *
 * How it stays safe:
 *  - The token is verified on every call; who the person is comes from the token, what they may do from their users
 *    document, read inside each action (command.ts, setup.ts), never from the request body.
 *  - Messages are plain words. Anything unexpected is logged without the request's contents and shown as a general message.
 */
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { CommandError, type TestOutcome } from "@ag/core";
import { executeCommand } from "./command";
import { cleanUp } from "./maintenance";
import { loadSample, removeSample, sampleStatus } from "./sample";
import {
  appCheckEnforced, clearIntegration, ReauthRequired, recordBrowserTest, recordOutcome, requireSuperUser, rotateWebsiteKey, saveIntegration, serverChecks, testIntegration,
} from "./setup";

/** What a verified sign-in token tells us. */
export interface TokenInfo { uid: string; auth_time?: number; email?: string; email_verified?: boolean; name?: string }

export interface ApiDeps {
  db: Firestore;
  auth: Auth;
  /** Rejects when the token is missing, expired or not from this project. */
  verifyIdToken(token: string): Promise<TokenInfo>;
  /** Rejects when the App Check token is not valid. Absent: App Check cannot be enforced on this host. */
  verifyAppCheck?(token: string): Promise<void>;
  /** Sends one test notification to a browser's push address. */
  sendPush?(token: string): Promise<void>;
  /** Where the database lives ("asia-south1"), or null when it cannot be told. */
  firestoreRegion?(): Promise<string | null>;
  /** The site's own address ("https://crm.example.com"), for the website-link Test. */
  origin: string;
  /** Where this code is running, shown by the server Test ("netlify us-east-2"). */
  where: string;
  now?: () => Date;
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

export interface ApiRequest { method: string; authorization: string; appCheck: string; body: string }

export type ApiErrorCode = "failed-precondition" | "unauthenticated" | "permission-denied" | "invalid-argument" | "unavailable" | "not-connected" | "internal";
export interface ApiErrorBody { code: ApiErrorCode; message: string; details?: { fields?: Record<string, string>; reauth?: boolean } }
export interface ApiResponse { status: number; body: { result: unknown } | { error: ApiErrorBody } }

const STATUS: Record<ApiErrorCode, number> = {
  "failed-precondition": 400, "invalid-argument": 400, unauthenticated: 401, "permission-denied": 403, unavailable: 503, "not-connected": 503, internal: 500,
};

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode, message: string, readonly details?: ApiErrorBody["details"]) { super(message); }
}

const fail = (code: ApiErrorCode, message: string, details?: ApiErrorBody["details"]): ApiResponse =>
  ({ status: STATUS[code], body: { error: details ? { code, message, details } : { code, message } } });

/** The answer while the server part has no key yet (the Netlify variable is not set): the page shows this as "not connected yet". */
export const notConnected = (): ApiResponse =>
  fail("not-connected", "The CRM's server part is not connected yet. Nothing was saved.");

/** Largest request we read: a command's fields are small; photos do not come this way. */
export const MAX_BODY = 512_000;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface Who { uid: string; authTime?: number; email: string; emailVerified: boolean }
type Action = (who: Who, data: Record<string, unknown>, deps: ApiDeps) => Promise<unknown>;

export const ACTIONS: Record<string, Action> = {
  /** Run one shared core command in a transaction (posting, numbering, audit). */
  async command(who, data, { db, auth, now }) {
    if (typeof data.name !== "string") throw new CommandError("This action isn't available.");
    if (typeof data.requestId !== "string" || !REQUEST_ID.test(data.requestId)) throw new CommandError("This request could not be read. Reload the page and try again.");
    const out = await executeCommand(db, auth, { uid: who.uid, name: data.name, args: data.args ?? {}, requestId: data.requestId }, now);
    return { result: out.result ?? null, touched: out.touched };
  },

  // ---------- Setup & integrations (D-48, D-49) ----------
  setupSave: (who, data, { db, now }) => saveIntegration(db, who, data as never, now),
  async setupClear(who, data, { db, now }) { await clearIntegration(db, who, data.integration, now); return { ok: true }; },
  /** Server-run Tests (email, maps, website link). */
  setupTest: (who, data, { db, origin, now }) => testIntegration(db, who, data as never, { endpoint: `${origin}${ENQUIRY_PATH}`, superUserEmail: who.email, now }),
  setupRotateWebsiteKey: (who, _data, { db, now }) => rotateWebsiteKey(db, who, now),
  /** Browser-run Tests report their result here. */
  async setupRecordTest(who, data, { db, now }) { await recordBrowserTest(db, who, data as never, now); return { ok: true }; },

  /** The page's server Test: a plain call that proves the server part is deployed, has its key and can be reached. */
  async ping(_who, _data, { where, now }) { return { ok: true, at: (now?.() ?? new Date()).toISOString(), region: where }; },

  /** The server's part of the database Test: it answers, and which region it is in. */
  async connectionTest(who, _data, { db, firestoreRegion }) {
    await requireSuperUser(db, who);
    const lines = await serverChecks({
      databaseReadable: async () => { await db.doc("system/owner").get(); },
      firestoreRegion: async () => (firestoreRegion ? firestoreRegion() : null),
    });
    return { lines };
  },

  /** The push Test: send one notification to the browser that just registered, and record the result. */
  async setupTestPush(who, data, { db, sendPush, now }) {
    await requireSuperUser(db, who);
    const token = data.token;
    if (typeof token !== "string" || token.length < 20) throw new CommandError("This browser could not register for notifications.");
    let outcome: TestOutcome;
    try {
      if (!sendPush) throw new Error("no push sender");
      await sendPush(token);
      outcome = { ok: true, message: "A test notification was sent to this browser. You should see it now." };
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      outcome = code.includes("registration-token-not-registered") || code.includes("invalid-argument")
        ? { ok: false, message: "This browser's notification address was not accepted.", hint: "Check the web push key matches Firebase console > Project settings > Cloud Messaging > Web Push certificates." }
        : { ok: false, message: "The notification could not be sent.", hint: "Check that Cloud Messaging is enabled for the project, then try again." };
    }
    await recordOutcome(db, "push", outcome, (now?.() ?? new Date()).toISOString());
    return outcome;
  },

  /** Sample data for an empty project (super user, on purpose only). action: status, load or remove. */
  async sampleData(who, data, { db, now }) {
    if (data.action === "load") return loadSample(db, who, now);
    if (data.action === "remove") return removeSample(db, who, now);
    return sampleStatus(db, who);
  },

  /** The nightly clean-up, run now: the owner's app asks for it when the last run is over a day old (the free plan has no TTL). */
  async cleanUp(who, _data, { db, now }) {
    await requireSuperUser(db, who);
    return cleanUp(db, now);
  },
};

/** The website's enquiry address on this host (contract v3). */
export const ENQUIRY_PATH = "/.netlify/functions/enquiry";

function toResponse(e: unknown, log: ApiDeps["log"], name: string): ApiResponse {
  if (e instanceof ApiError) return fail(e.code, e.message, e.details);
  if (e instanceof ReauthRequired) return fail("failed-precondition", e.message, { reauth: true });
  if (e instanceof CommandError) return fail("failed-precondition", e.message, { fields: e.fields });
  log?.("api action failed", { name, message: e instanceof Error ? e.message : String(e) });
  return fail("internal", "Something went wrong on our side. Nothing was saved. Try again.");
}

export async function handleApi(req: ApiRequest, deps: ApiDeps, actions: Record<string, Action> = ACTIONS): Promise<ApiResponse> {
  let name = "";
  try {
    if (req.method !== "POST") return { status: 405, body: { error: { code: "invalid-argument", message: "Use POST." } } };
    if (req.body.length > MAX_BODY) throw new ApiError("invalid-argument", "This request is too large.");
    const token = /^Bearer\s+(\S+)$/i.exec(req.authorization)?.[1] ?? "";
    if (!token) throw new ApiError("unauthenticated", "Sign in first.");
    let info: TokenInfo;
    try { info = await deps.verifyIdToken(token); } catch { throw new ApiError("unauthenticated", "You were signed out. Sign in again."); }
    if (!info?.uid) throw new ApiError("unauthenticated", "You were signed out. Sign in again.");

    let parsed: unknown;
    try { parsed = JSON.parse(req.body || "{}"); } catch { throw new ApiError("invalid-argument", "This request could not be read. Reload the page and try again."); }
    const body = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as { name?: unknown; data?: unknown };
    name = typeof body.name === "string" ? body.name : "";
    const action = Object.prototype.hasOwnProperty.call(actions, name) ? actions[name] : undefined;
    if (!action) throw new ApiError("invalid-argument", "This action isn't available.");

    // The App Check switch on the Setup page decides whether a call without a valid App Check token is refused (D-41).
    if (await appCheckEnforced(deps.db)) {
      let ok = false;
      if (req.appCheck && deps.verifyAppCheck) { try { await deps.verifyAppCheck(req.appCheck); ok = true; } catch { ok = false; } }
      if (!ok) throw new ApiError("failed-precondition", "This app could not be verified. Reload the page and try again.");
    }

    const who: Who = { uid: info.uid, authTime: info.auth_time, email: String(info.email ?? ""), emailVerified: info.email_verified === true };
    const data = (body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {}) as Record<string, unknown>;
    return { status: 200, body: { result: (await action(who, data, deps)) ?? null } };
  } catch (e) {
    return toResponse(e, deps.log, name);
  }
}
