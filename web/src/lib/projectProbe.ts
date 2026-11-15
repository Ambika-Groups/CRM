/**
 * What is switched on in the user's Firebase project, asked of Google's public addresses with the web config (no sign-in
 * needed). It powers the "steps still missing" panel on the sign-in screen, so a project that is not set up yet shows
 * exactly what is missing instead of an error. Same checks as `npm run golive` (tools/golive.mjs).
 */
import type { FirebaseWebConfig } from "@ag/core";

export type ProbeKey = "database" | "signIn";
/** ok: true (done), false (missing), null (could not tell, for example offline). */
export interface ProbeLine { key: ProbeKey; ok: boolean | null; detail?: string }

async function ask(url: string, init?: RequestInit): Promise<{ status: number; json: { error?: { message?: string } } | null; text: string } | null> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json, text };
  } catch { return null; }
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function probeProject(cfg: Partial<FirebaseWebConfig>): Promise<ProbeLine[]> {
  const { projectId = "", apiKey = "" } = cfg;
  const [db, , pw, g] = await Promise.all([
    ask(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/meta/bootstrap?key=${apiKey}`),
    Promise.resolve(null),
    ask(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, post({ email: "check@example.invalid", password: "x", returnSecureToken: true })),
    ask(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${apiKey}`, post({ providerId: "google.com", continueUri: window.location.origin })),
  ]);

  // The database: the rules refusing us is the database answering; "permission denied on the service" means it is not switched on.
  const dbMsg = String(db?.json?.error?.message ?? "");
  const database: ProbeLine = !db ? { key: "database", ok: null }
    : db.status === 403 && /insufficient permissions/i.test(dbMsg) ? { key: "database", ok: true }
    : db.status === 200 ? { key: "database", ok: true, detail: "open" }
    : { key: "database", ok: false };

  // Sign-in: Authentication must be started and Google or Email/Password turned on.
  const pwMsg = String(pw?.json?.error?.message ?? "");
  const gMsg = String(g?.json?.error?.message ?? "");
  const started = !/CONFIGURATION_NOT_FOUND/.test(pwMsg) && !/CONFIGURATION_NOT_FOUND/.test(gMsg);
  const emailOn = /EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|INVALID_EMAIL/.test(pwMsg);
  const googleOn = g?.status === 200;
  const signIn: ProbeLine = !pw && !g ? { key: "signIn", ok: null }
    : !started ? { key: "signIn", ok: false, detail: "notStarted" }
    : googleOn || emailOn ? { key: "signIn", ok: true, detail: `${googleOn ? "google" : ""}${googleOn && emailOn ? "+" : ""}${emailOn ? "email" : ""}` }
    : { key: "signIn", ok: false, detail: "noMethod" };

  // Free plan (D-51): no file storage or server-function step. They are probed only so a later paid plan can show them.
  return [database, signIn];
}
