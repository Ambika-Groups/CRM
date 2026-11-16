/**
 * Setup & integrations against a real project (D-48, D-49). Saving and clearing go through callables, which check
 * the super user and a sign-in within the last 5 minutes. Secret values travel one way, up; what comes back is only
 * the masked tail and the public values. Each item has its own Test, run where it can really be checked (this browser
 * or the server), with a plain result that is then recorded with its time.
 */
import { CommandError, INTEGRATIONS, type FirebaseWebConfig, type IntegrationId, type IntegrationStatus, type TestOutcome } from "@ag/core";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { getToken as getAppCheckToken } from "firebase/app-check";
import { FirebaseFiles } from "../files/firebaseFiles";
import { inlineStorageTest } from "../files/selfTest";
import { ReauthNeeded, type SampleApi, type SampleStatus, type SetupApi, type SetupStatuses } from "../types";
import { resolveConfig, saveDeviceSiteKey } from "../config";
import { call, docData, isDenied, type Clients } from "./client";
import type { FirebaseAuth } from "./firebaseAuth";

interface FnError { code?: string; message?: string; details?: { reauth?: boolean; fields?: Record<string, string> } }

/** The page's errors in plain words: a fresh sign-in is needed, a field is wrong, or the message as the server wrote it. */
function mapCallError(e: unknown): Error {
  const err = e as FnError;
  if (err?.details?.reauth) return new ReauthNeeded();
  if (err?.code?.endsWith("failed-precondition")) return new CommandError(err.message ?? "This could not be saved.", err.details?.fields ?? {});
  if (err?.code?.endsWith("unavailable") || err?.code?.endsWith("deadline-exceeded")) return new CommandError("No connection to the server. Check your internet and try again.");
  if (err?.code?.endsWith("not-found")) return new CommandError("This needs the CRM's server part, which is not connected yet. The owner connects it once (DEPLOY.md, \"Connect the server part\").");
  if (err?.code?.endsWith("permission-denied") || err?.code?.endsWith("unauthenticated")) return new CommandError("You can't do this. Sign in again as a super user.");
  return new CommandError("Something went wrong on our side. Nothing was saved. Try again.");
}

const consoleUrl = (projectId: string, path: string) => `https://console.firebase.google.com/project/${projectId}/${path}`;

export class FirebaseSetup implements SetupApi {
  readonly simulated = false;
  constructor(private c: Clients, private auth: FirebaseAuth, private uid: () => string) {}

  async statuses(): Promise<SetupStatuses> {
    try {
      const snap = await getDocs(collection(this.c.db, "integrations"));
      const out: SetupStatuses = {};
      for (const d of snap.docs) out[d.id as IntegrationId] = docData<IntegrationStatus>(d.id, d.data());
      return out;
    } catch (e) {
      if (isDenied(e)) return {};
      throw e;
    }
  }

  async save(id: IntegrationId, input: { enabled?: boolean; enforce?: boolean; values: Record<string, string> }): Promise<IntegrationStatus> {
    try {
      const out = await call<unknown, IntegrationStatus>(this.c, "setupSave")({ integration: id, ...input });
      // The App Check key is needed before sign-in, so this device also keeps it, for the next start-up (and Netlify gets it from the page).
      if (id === "appCheck" && input.values.siteKey) saveDeviceSiteKey(input.values.siteKey.trim());
      return out;
    } catch (e) { throw mapCallError(e); }
  }

  async clear(id: IntegrationId): Promise<void> {
    try {
      await call<unknown, unknown>(this.c, "setupClear")({ integration: id });
      if (id === "appCheck") saveDeviceSiteKey("");
    } catch (e) { throw mapCallError(e); }
  }

  async rotateWebsiteKey(): Promise<{ key: string; status: IntegrationStatus }> {
    try { return await call<unknown, { key: string; status: IntegrationStatus }>(this.c, "setupRotateWebsiteKey")({}); } catch (e) { throw mapCallError(e); }
  }

  configInUse(): { from: "env" | "device" | "none"; config: Partial<FirebaseWebConfig> } {
    const r = resolveConfig();
    return { from: r.from, config: r.config };
  }

  enquiryEndpoint(): string { return `${window.location.origin}/.netlify/functions/enquiry`; }

  async test(id: IntegrationId, opts?: { key?: string }): Promise<TestOutcome> {
    const d = INTEGRATIONS[id];
    if (!d.available) return { ok: false, message: "This is coming in a later phase." };
    let outcome: TestOutcome;
    try {
      if (d.testsIn === "server") return await call<unknown, TestOutcome>(this.c, "setupTest")({ integration: id, key: opts?.key });
      outcome = await this.browserTest(id);
    } catch (e) {
      outcome = { ok: false, message: "The test could not run.", hint: mapCallError(e).message };
    }
    // The browser ran it, so the browser reports it; the server keeps it with its time.
    if (id !== "push") await call<unknown, unknown>(this.c, "setupRecordTest")({ integration: id, ...outcome }).catch(() => undefined);
    return outcome;
  }

  private async browserTest(id: IntegrationId): Promise<TestOutcome> {
    const { db, projectId } = this.c;
    const uid = this.uid();
    switch (id) {
      case "firebaseConfig": {
        // Initialising already worked (we are signed in through it); now prove the project answers a read.
        await getDoc(doc(db, "system_probe", "ping"));
        const from = resolveConfig().from;
        return { ok: true, message: `Connected to the project "${projectId}" (config from ${from === "env" ? "Netlify's variables" : "this device"}).` };
      }
      case "firestore": {
        const probe = doc(db, "system_probe", uid);
        await setDoc(probe, { at: serverTimestamp() });
        const back = await getDoc(probe);
        await deleteDoc(probe);
        const server = (await call<unknown, { lines: { key: string; ok: boolean; message: string; hint?: string }[] }>(this.c, "connectionTest")({})).lines.find((l) => l.key === "database");
        if (!back.exists()) return { ok: false, message: "A test record was written but could not be read back.", hint: "Check the Firestore rules were deployed (npx firebase-tools deploy --only firestore)." };
        return server && !server.ok ? { ok: false, message: server.message, ...(server.hint ? { hint: server.hint } : {}) }
          : { ok: true, message: `The database accepted a test record and returned it. ${server?.message ?? ""}`.trim() };
      }
      case "storage":
        // The built-in store: keep a tiny file in the database, read it back, delete it (as the super user).
        return inlineStorageTest(new FirebaseFiles(this.c, () => ({ role: "owner", uid, assignedProjectIds: [] })));
      case "signIn": {
        const method = this.auth.signInMethod();
        const used = method === "google.com" ? "Google" : method === "password" ? "email and password" : method === "phone" ? "a phone code" : "an unknown method";
        return {
          ok: true, message: `You signed in with ${used}, and this site's address (${window.location.hostname}) is allowed for sign-in.`,
          hint: `The other sign-in methods and the allowed addresses can't be read from here. Check them in the console: ${consoleUrl(projectId, "authentication/providers")} (Settings > Authorized domains: ${consoleUrl(projectId, "authentication/settings")}).`,
        };
      }
      case "functions": {
        const r = await call<unknown, { ok: boolean; region: string }>(this.c, "ping")({});
        return r.ok ? { ok: true, message: `The server part answered (${r.region}).` } : { ok: false, message: "The server part did not answer correctly." };
      }
      case "appCheck": {
        if (!this.c.appCheck) return { ok: false, message: "App Check is not switched on in this browser.", hint: "Save the site key here, add NEXT_PUBLIC_RECAPTCHA_SITE_KEY in Netlify (shown below), and reload." };
        const t = await getAppCheckToken(this.c.appCheck, false);
        return t.token ? { ok: true, message: "App Check gave this browser a token. Calls from this app are verified." } : { ok: false, message: "App Check did not give a token." };
      }
      case "push":
        return await this.pushTest();
      default:
        return { ok: false, message: "This Test is not available." };
    }
  }

  private async pushTest(): Promise<TestOutcome> {
    const { isSupported, getMessaging, getToken } = await import("firebase/messaging");
    if (!(await isSupported())) return { ok: false, message: "This browser can't receive push notifications.", hint: "Use Chrome, Edge or Firefox on a computer or an Android phone." };
    const status = (await this.statuses()).push;
    const vapidKey = status?.values.vapidKey;
    if (!vapidKey) return { ok: false, message: "No web push key is saved yet.", hint: "Paste the key and choose Save, then Test." };
    if ((await Notification.requestPermission()) !== "granted") return { ok: false, message: "This browser did not allow notifications.", hint: "Allow notifications for this site in the browser's address bar, then Test again." };
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(this.c.app), { vapidKey, serviceWorkerRegistration: registration });
    return await call<unknown, TestOutcome>(this.c, "setupTestPush")({ token });
  }
}

/** Sample data in the user's own project (a super user, on purpose only). The server refuses unless the project is empty. */
export class FirebaseSample implements SampleApi {
  constructor(private c: Clients, private changed: () => void = () => {}) {}
  private async act(action: "status" | "load" | "remove"): Promise<SampleStatus> {
    try {
      const out = await call<unknown, SampleStatus>(this.c, "sampleData")({ action });
      if (action !== "status") this.changed();
      return out;
    } catch (e) { throw mapCallError(e); }
  }
  status() { return this.act("status"); }
  load() { return this.act("load"); }
  remove() { return this.act("remove"); }
}
