// A fake outside world for the wizard tests: files, Google's admin APIs, Netlify, and the Firebase CLI, all in memory.
// Every mutating call is recorded, so a test can prove a re-run changed nothing and a dry run touched nothing.
import path from "node:path";
import { Report } from "../lib.mjs";

export const PROJECT = "ambikagroupscrm";
export const API_KEY = `AIza${"S".repeat(35)}`;
export const SECRET_TOKEN = "ya29.A0-this-is-a-fake-access-token-1234567890";
export const WEB_ENV = [
  `NEXT_PUBLIC_FIREBASE_API_KEY=${API_KEY}`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${PROJECT}.firebaseapp.com`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID=${PROJECT}`,
  `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${PROJECT}.firebasestorage.app`, "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012", "NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abc123def456",
].join("\n") + "\n";

const res = (status, body = {}, headers = {}) => ({
  status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  json: async () => (typeof body === "string" ? JSON.parse(body) : body),
});
export { res };

/** The state of the pretend Firebase project and Netlify account. Tests flip these to set up a scenario. */
export function fakeWorld(over = {}) {
  return {
    billing: true, db: null /* region or null */, bucket: false, authStarted: false, emailLink: false, sms: [], google: false, googleCanCreate: false,
    domains: ["localhost", `${PROJECT}.firebaseapp.com`], rulesLive: true, functionsLive: true, loggedIn: true, canSeeProject: true,
    netlifyLoggedIn: true, sites: [], netlifyEnv: {}, bootstrapped: false,
    calls: [], // every non-GET call: "METHOD url"
    runs: [], // every process started: "cmd args"
    ...over,
  };
}

export function makeDeps(world = fakeWorld(), { files = {}, prompts = [], now = 1_000_000 } = {}) {
  const fsMap = new Map(Object.entries({
    "/crm/web/.env.local": WEB_ENV,
    "/crm/functions/.env": "OWNER_EMAIL=bussiness@ambikagroups.tech\n",
    "/crm/node_modules/x": "",
    ...files,
  }));
  const home = "/home/u";
  const configstore = "/home/u/.config/configstore/firebase-tools.json";
  const syncLogin = () => { if (world.loggedIn) fsMap.set(configstore, JSON.stringify({ user: { email: "owner@example.com" }, tokens: { refresh_token: "1//refresh-token-fake-0000000000", access_token: SECRET_TOKEN, expires_at: now + 3_600_000 } })); else fsMap.delete(configstore); };
  syncLogin();
  const log = [];
  const promptQ = [...prompts];

  const fetch = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET") world.calls.push(`${method} ${url.replace(/\?.*/, (q) => (q.includes("updateMask") ? q : ""))}`);
    const u = new URL(url);
    const body = init.body ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : undefined;
    const h = u.host, p = u.pathname;

    if (h === "oauth2.googleapis.com") return res(200, { access_token: SECRET_TOKEN });
    if (h === "firebase.googleapis.com") return world.canSeeProject ? res(200, { projectId: PROJECT }) : res(403, { error: { message: "no access" } });
    if (h === "cloudbilling.googleapis.com") return world.billing === null ? res(403, { error: { message: "denied" } }) : res(200, { billingEnabled: world.billing });
    if (h === "serviceusage.googleapis.com") return res(200, {});
    if (h === "firestore.googleapis.com" && p.endsWith("/databases/(default)") && method === "GET") return world.db ? res(200, { locationId: world.db }) : res(404, { error: { message: "not found" } });
    if (h === "firestore.googleapis.com" && p.endsWith("/databases") && method === "POST") { world.db = body.locationId; return res(200, { name: "projects/p/operations/op1" }); }
    if (h === "firestore.googleapis.com" && p.includes("/operations/")) return res(200, { done: true });
    if (h === "firestore.googleapis.com" && p.includes("/documents/meta/bootstrap")) return world.bootstrapped ? res(200, { name: "x" }) : res(404, { error: { message: "not found" } });
    if (h === "firestore.googleapis.com" && p.includes("/documents/")) return world.rulesLive ? res(403, { error: { message: "Missing or insufficient permissions." } }) : res(200, {});
    if (h === "firebasestorage.googleapis.com" && p.endsWith("/buckets") && method === "GET") return res(200, { buckets: world.bucket ? [{ name: `projects/${PROJECT}/buckets/${PROJECT}.firebasestorage.app` }] : [] });
    if (h === "firebasestorage.googleapis.com" && p.endsWith("/defaultBucket")) { world.bucket = true; return res(200, {}); }
    if (h === "firebasestorage.googleapis.com" && p.startsWith("/v0/b/")) return world.rulesLive ? res(403, {}) : res(200, {});
    if (h === "identitytoolkit.googleapis.com" && p.endsWith("/identityPlatform:initializeAuth")) { world.authStarted = true; return res(200, {}); }
    if (h === "identitytoolkit.googleapis.com" && p.endsWith("/config") && method === "GET") {
      return world.authStarted ? res(200, { signIn: { email: { enabled: world.emailLink, passwordRequired: !world.emailLink } }, smsRegionConfig: { allowlistOnly: { allowedRegions: world.sms } }, authorizedDomains: [...world.domains] })
        : res(404, { error: { message: "CONFIGURATION_NOT_FOUND" } });
    }
    if (h === "identitytoolkit.googleapis.com" && p.endsWith("/config") && method === "PATCH") {
      if (body.signIn) world.emailLink = body.signIn.email.enabled && body.signIn.email.passwordRequired === false;
      if (body.smsRegionConfig) world.sms = body.smsRegionConfig.allowlistOnly.allowedRegions;
      if (body.authorizedDomains) world.domains = body.authorizedDomains;
      return res(200, {});
    }
    if (h === "identitytoolkit.googleapis.com" && p.includes("/defaultSupportedIdpConfigs/google.com") && method === "GET") return world.google ? res(200, { enabled: true }) : res(404, {});
    if (h === "identitytoolkit.googleapis.com" && p.endsWith("/defaultSupportedIdpConfigs") && method === "POST") { if (world.googleCanCreate) { world.google = true; return res(200, {}); } return res(400, { error: { message: "clientId required" } }); }
    // The public, no-login addresses used by the live checks.
    if (h === "identitytoolkit.googleapis.com" && p.endsWith("accounts:signInWithPassword")) return world.authStarted ? res(400, { error: { message: "EMAIL_NOT_FOUND" } }) : res(400, { error: { message: "CONFIGURATION_NOT_FOUND" } });
    if (h === "identitytoolkit.googleapis.com" && p.endsWith("accounts:createAuthUri")) {
      if (!world.google) return res(400, { error: { message: "OPERATION_NOT_ALLOWED" } });
      return world.domains.includes(new URL(body.continueUri).hostname) ? res(200, { authUri: "https://accounts.google.com/x" }) : res(400, { error: { message: "INVALID_CONTINUE_URI" } });
    }
    if (h.endsWith(".cloudfunctions.net")) return world.functionsLive ? res(401, { error: { status: "UNAUTHENTICATED" } }) : res(404, "<html>Page not found</html>");
    if (h === "ambika-crm.netlify.app" || h === "127.0.0.1:3100" || h === "localhost:3100") return world.site ? world.site(u, method) : res(404, "");
    return res(404, {});
  };

  const run = async (cmd, args = [], opt = {}) => {
    const line = `${cmd} ${args.join(" ")}`;
    world.runs.push(line);
    if (cmd === "/chrome") return { code: 0, stdout: world.dom ?? "", stderr: "" };
    if (cmd === "git") return { code: 0, stdout: " M a.ts\n?? b.ts\n", stderr: "" };
    if (line.includes("firebase-tools") && args.includes("login")) { world.loggedIn = true; syncLogin(); return { code: 0, stdout: "", stderr: "" }; }
    if (line.includes("firebase-tools") && args.includes("deploy")) return { code: world.deployExit ?? 0, stdout: "", stderr: "" };
    if (line.includes("netlify-cli")) {
      if (args.includes("sites:list")) return world.netlifyLoggedIn ? { code: 0, stdout: JSON.stringify(world.sites), stderr: "" } : { code: 1, stdout: "", stderr: "not logged in" };
      if (args.includes("login")) { world.netlifyLoggedIn = true; return { code: 0, stdout: "", stderr: "" }; }
      if (args.includes("api")) { const s = { id: "site-1", name: "ambika-crm", ssl_url: "https://ambika-crm.netlify.app" }; world.sites.push(s); return { code: 0, stdout: JSON.stringify(s), stderr: "" }; }
      if (args.includes("env:set")) { world.netlifyEnv[args[args.indexOf("env:set") + 1]] = args[args.indexOf("env:set") + 2]; return { code: world.envExit ?? 0, stdout: "", stderr: "" }; }
      if (args.includes("deploy")) return args.includes("--prod") ? { code: 0, stdout: JSON.stringify({ url: "https://ambika-crm.netlify.app" }), stderr: "" } : { code: 0, stdout: JSON.stringify({ deploy_url: "https://abc--ambika-crm.netlify.app" }), stderr: "" };
    }
    if (cmd === "npm" && args.includes("build:firebase")) return { code: world.buildExit ?? 0, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };

  return {
    root: "/crm", path: path.posix, env: {}, nodeVersion: "24.11.1", fetch, run, now: () => now, sleep: async () => {}, home: () => home, chromePath: world.chromePath ?? null,
    prompt: async () => promptQ.shift() ?? "",
    fs: { exists: async (f) => fsMap.has(f) || [...fsMap.keys()].some((k) => k.startsWith(`${f}/`)), read: async (f) => { if (!fsMap.has(f)) throw new Error(`no file ${f}`); return fsMap.get(f); }, write: async (f, t) => { fsMap.set(f, t); } },
    log: (s) => log.push(s), _files: fsMap, _log: log, _world: world,
  };
}

export function makeCtx(deps, opts = {}, state = {}) {
  const report = new Report();
  return { deps, opts, state, report, log: deps.log, only: opts.only };
}
