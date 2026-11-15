// `npm run golive`: checks every prerequisite for running the CRM on your own Firebase project and prints what is still
// missing, in plain words, with the step of GO-LIVE-LOCAL.md that fixes it. It changes nothing and never prints a secret
// (only names, and your project's address). Checks that need your Google login are skipped with a note if you are not
// logged in yet; the rest are read from Google's public addresses.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const lines = [];
let missing = 0;
let skipped = 0;
const ok = (m) => lines.push(`  [ok]      ${m}`);
const todo = (m, fix) => { missing++; lines.push(`  [MISSING] ${m}`); lines.push(`            -> ${fix}`); };
const note = (m, fix) => { skipped++; lines.push(`  [??]      ${m}`); if (fix) lines.push(`            -> ${fix}`); };

function readEnv(file) {
  const out = {};
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function http(url, init) {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, text, json };
  } catch (e) { return { status: 0, text: String(e?.message ?? e), json: null }; }
}

// ---- 1. this computer ----
const major = Number(process.versions.node.split(".")[0]);
major >= 22 ? ok(`Node ${process.versions.node} is installed`) : todo(`Node ${process.versions.node} is too old (22 or newer is needed)`, "Install Node 24 from nodejs.org, then open a new PowerShell window.");
existsSync(root("node_modules")) ? ok("the project's packages are installed") : todo("the project's packages are not installed", "Run:  npm ci   (inside the CRM folder).");

// ---- 2. the web settings (web\.env.local) ----
const web = readEnv(root("web/.env.local"));
const NAMES = ["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "STORAGE_BUCKET", "MESSAGING_SENDER_ID", "APP_ID"].map((n) => `NEXT_PUBLIC_FIREBASE_${n}`);
let projectId = "", apiKey = "";
if (!web) {
  todo("web\\.env.local does not exist, so the CRM would start in demo mode", "Create it from web\\.env.example and fill in the six Firebase values (GO-LIVE-LOCAL.md, step 1).");
} else {
  const absent = NAMES.filter((n) => !web[n]);
  absent.length ? todo(`web\\.env.local is missing: ${absent.join(", ")}`, "Copy the missing values from the Firebase console > Project settings > Your apps (web app).") : ok("web\\.env.local has all six Firebase values");
  projectId = web.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
  apiKey = web.NEXT_PUBLIC_FIREBASE_API_KEY ?? "";
  if (web.NEXT_PUBLIC_FIREBASE_API_KEY && !/^AIza[A-Za-z0-9_-]{35}$/.test(web.NEXT_PUBLIC_FIREBASE_API_KEY)) todo("the API key does not look right (it starts with AIza and is 39 characters)", "Copy it again from the Firebase console.");
}

// ---- 3. who the owner is (functions\.env) ----
const fenv = readEnv(root("functions/.env"));
if (!fenv || !fenv.OWNER_EMAIL) todo("functions\\.env has no OWNER_EMAIL, so nobody can be set up as the first owner", "Copy functions\\.env.example to functions\\.env and put your Google address after OWNER_EMAIL= (GO-LIVE-LOCAL.md, step 6).");
else /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fenv.OWNER_EMAIL) ? ok("functions\\.env has an owner address (OWNER_EMAIL)") : todo("OWNER_EMAIL in functions\\.env is not a full email address", "Write it like you@gmail.com (GO-LIVE-LOCAL.md, step 6).");

// ---- 4. firebase login and project ----
const args = process.argv.slice(2);
if (args.includes("--no-login-check")) {
  note("login check skipped", "Run without --no-login-check to check it.");
} else {
  const r = spawnSync("npx", ["firebase-tools@15.34.1", "login:list"], { shell: true, encoding: "utf8", timeout: 180000 });
  const outText = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0 && !outText) note("could not run the Firebase tool", "Check your internet, then run again.");
  else if (/No authorized accounts/i.test(outText)) todo("you are not logged in to Firebase from this computer", "Run:  npx firebase-tools@15.34.1 login   (GO-LIVE-LOCAL.md, step 1).");
  else ok("you are logged in to Firebase on this computer");
}
const rc = existsSync(root(".firebaserc")) ? JSON.parse(readFileSync(root(".firebaserc"), "utf8")) : null;
if (projectId) {
  rc?.projects?.default === projectId ? ok(`the project "${projectId}" is selected (.firebaserc)`) : todo(`the project "${projectId}" is not selected yet`, `Run:  npx firebase-tools@15.34.1 use ${projectId}   (GO-LIVE-LOCAL.md, step 2).`);
}

// ---- 5. what is switched on at Google (no login needed) ----
if (!projectId || !apiKey) {
  note("online checks skipped: the project address or API key is not set", "Fix the web settings above first.");
} else {
  // The database and the rules.
  const db = await http(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/meta/bootstrap?key=${apiKey}`);
  const dbMsg = String(db.json?.error?.message ?? "");
  // "Missing or insufficient permissions" is the database answering and the rules saying no (what we want).
  // "Permission denied on the service" or a missing database is Firestore not being switched on yet.
  if (db.status === 403 && /Missing or insufficient permissions/i.test(dbMsg)) ok('the database exists and the security rules are in place');
  else if (db.status === 200 || (db.status === 404 && /document/i.test(db.text) && !/does not exist|database/i.test(dbMsg))) todo("the database exists but is open: the CRM's security rules are not deployed", "Deploy the rules (GO-LIVE-LOCAL.md, step 7).");
  else if (db.status === 403 || db.status === 404 || /does not exist|not been used|NOT_FOUND|disabled/i.test(db.text)) todo('the Firestore database is not created yet (Google says: permission denied on the service)', 'Create it in asia-south1 (GO-LIVE-LOCAL.md, step 3).');
  else note(`the database could not be checked (answer ${db.status})`, "Check your internet and the API key.");

  // File storage: a bucket that does not exist answers 404; one that exists answers with a refusal (rules) or a list.
  const bucket = web.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '';
  if (bucket) {
    const st = await http(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o?maxResults=1`);
    if (st.status === 404) todo('file storage is not set up yet', 'Console > Build > Storage > Get started, choose us-central1 (GO-LIVE-LOCAL.md, step 3).');
    else if (st.status === 200) todo('file storage exists but is open: the storage rules are not deployed', 'Deploy the rules (GO-LIVE-LOCAL.md, step 7).');
    else if (st.status === 401 || st.status === 403) ok('file storage exists and is locked by rules');
    else note(`file storage could not be checked (answer ${st.status})`, "Try again in a minute.");
  }

  // The server functions.
  const fn = await http(`https://asia-south1-${projectId}.cloudfunctions.net/ping`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }) });
  if (fn.status === 401 || fn.json?.error?.status === "UNAUTHENTICATED") ok("the server functions are deployed (and the pay-as-you-go plan is on)");
  else if (fn.status === 404) todo("the server functions are not deployed yet", "Deploy them (GO-LIVE-LOCAL.md, steps 4 and 7). Functions need the pay-as-you-go plan.");
  else note(`the server functions could not be checked (answer ${fn.status})`, "Try again in a minute.");

  // Sign-in methods: ask Google's sign-in service what it would accept. A wrong password for a made-up account is
  // refused one way when the method is on and another when it is off.
  const pw = await http(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "golive-check@example.invalid", password: "not-a-real-password", returnSecureToken: true }) });
  const pwMsg = String(pw.json?.error?.message ?? "");
  if (/OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/.test(pwMsg)) todo("Email/Password sign-in is not turned on", "Console > Authentication > Sign-in method > Email/Password (GO-LIVE-LOCAL.md, step 5).");
  else if (/EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|INVALID_EMAIL/.test(pwMsg)) ok("Email/Password sign-in is turned on");
  else if (/CONFIGURATION_NOT_FOUND/.test(pwMsg)) todo("sign-in (Authentication) has not been started for this project", "Console > Authentication > Get started (GO-LIVE-LOCAL.md, step 5).");
  else note("Email/Password sign-in could not be checked", "Check it in the Firebase console (step 5).");

  const g = await http(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId: "google.com", continueUri: "http://localhost" }) });
  const gMsg = String(g.json?.error?.message ?? "");
  if (g.status === 200 && g.json?.authUri) ok("Google sign-in is turned on");
  else if (/OPERATION_NOT_ALLOWED|CONFIGURATION_NOT_FOUND/.test(gMsg)) todo("Google sign-in is not turned on", "Console > Authentication > Sign-in method > Google (GO-LIVE-LOCAL.md, step 5).");
  else note("Google sign-in could not be checked", "Check it in the Firebase console (step 5).");
}

// ---- 6. the things only the console can show ----
note("Your pay-as-you-go plan and the ₹100 budget alert can't be checked from here", "Do GO-LIVE-LOCAL.md step 4 in the console. (If the server functions are deployed, the plan is on.)");

console.log("\nCRM go-live check\n" + "-".repeat(40));
for (const l of lines) console.log(l);
console.log("-".repeat(40));
if (missing === 0) console.log(`Nothing is missing${skipped ? ` (${skipped} thing(s) could not be checked from here)` : ""}. Start the CRM:  npm run dev   then open http://localhost:4320`);
else console.log(`${missing} thing(s) still to do. Fix them in order, then run  npm run golive  again.`);
process.exit(missing === 0 ? 0 : 1);
