// Calls Google's admin APIs as the person who ran `firebase login` on this computer. The Firebase CLI keeps that login in
// its own config file; this reads the refresh token from it, exchanges it for a short-lived access token, and uses that
// for REST calls (create the database, turn on sign-in, add authorized domains). Nothing here is printed or written
// anywhere: the token lives in memory for the run. The CLI's OAuth client is a public, published pair (it is in the
// firebase-tools source); it can be overridden with FIREBASE_CLIENT_ID / FIREBASE_CLIENT_SECRET.

const DEFAULT_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const DEFAULT_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

/** Where the CLI keeps its login: ~/.config/configstore/firebase-tools.json (also on Windows). */
export function configstorePath(deps) {
  return deps.path.join(deps.home(), ".config", "configstore", "firebase-tools.json");
}

/** The CLI's saved login, or null. Only what is needed (the email, the refresh token, a still-valid access token). */
export async function loadLogin(deps) {
  const file = configstorePath(deps);
  if (!(await deps.fs.exists(file))) return null;
  let json;
  try { json = JSON.parse(await deps.fs.read(file)); } catch { return null; }
  const refresh = json?.tokens?.refresh_token;
  if (!refresh) return null;
  return {
    email: json?.user?.email ?? "(unknown)",
    refreshToken: refresh,
    accessToken: json?.tokens?.access_token ?? null,
    expiresAt: Number(json?.tokens?.expires_at ?? 0),
  };
}

/** A usable access token: the saved one if it has at least a minute left, else a fresh one made from the refresh token. */
export async function accessToken(deps, login = undefined) {
  const l = login ?? (await loadLogin(deps));
  if (!l) throw new GoogleError("not-logged-in", "You are not logged in to Firebase on this computer.");
  if (l.accessToken && l.expiresAt - deps.now() > 60_000) return l.accessToken;
  const body = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: l.refreshToken,
    client_id: deps.env.FIREBASE_CLIENT_ID ?? DEFAULT_CLIENT_ID, client_secret: deps.env.FIREBASE_CLIENT_SECRET ?? DEFAULT_CLIENT_SECRET,
  });
  const r = await deps.fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200 || !j.access_token) throw new GoogleError("login-expired", "Your Firebase login has expired. Run npx firebase-tools@15.34.1 login again.");
  return j.access_token;
}

export class GoogleError extends Error {
  constructor(code, message, status = 0, body = null) { super(message); this.code = code; this.status = status; this.body = body; }
}

/**
 * One REST call as the logged-in person. Returns { status, json }; it does not throw on a 4xx (the caller decides what a 404
 * or 403 means, for example "the database does not exist yet"), only when there is no login.
 */
export async function gapi(deps, method, url, body = undefined, extraHeaders = {}) {
  const token = await accessToken(deps);
  const r = await deps.fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: r.status, json, text };
}

/** The plain-words message inside a Google error body, if there is one. */
export const apiMessage = (res) => String(res?.json?.error?.message ?? res?.text ?? "").slice(0, 300);

/** Enable a Google API for the project (idempotent: enabling one that is on is fine). */
export async function enableApi(deps, project, service) {
  const res = await gapi(deps, "POST", `https://serviceusage.googleapis.com/v1/projects/${project}/services/${service}:enable`, {});
  return res.status >= 200 && res.status < 300;
}

/** Waits for a long-running operation (database creation, bucket creation) to finish. Returns the final operation or null. */
export async function waitOperation(deps, opName, { times = 40, everyMs = 4000, base = "https://firestore.googleapis.com/v1" } = {}) {
  for (let i = 0; i < times; i++) {
    const res = await gapi(deps, "GET", `${base}/${opName}`);
    if (res.status === 200 && res.json?.done) return res.json;
    await deps.sleep(everyMs);
  }
  return null;
}
