// The phases of `npm run setup`. Each one reads the current state first and does only what is missing (so it can be run
// again and again), never deletes or overwrites data, and says in plain words what it found and did. Phases return
// results (see lib.mjs); in a dry run they say what they would do and change nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accessToken, apiMessage, enableApi, gapi, loadLogin, waitOperation } from "./google.mjs";
import { consoleUrl, FIREBASE_ENV, parseEnv, poll, result } from "./lib.mjs";
import { verifyLive } from "./verify-live.mjs";

export const FIREBASE_TOOLS = "firebase-tools@15.34.1";
export const NETLIFY_CLI = "netlify-cli@27.16.1";
export const DB_REGION = "asia-south1";
export const STORAGE_REGION = "us-central1";
const CONFIG_PATTERNS = {
  NEXT_PUBLIC_FIREBASE_API_KEY: /^AIza[A-Za-z0-9_-]{35}$/, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: /^[a-z0-9.-]+\.[a-z]{2,}$/, NEXT_PUBLIC_FIREBASE_PROJECT_ID: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: /^[a-z0-9.-]+\.(appspot\.com|firebasestorage\.app)$/, NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: /^[0-9]{8,16}$/, NEXT_PUBLIC_FIREBASE_APP_ID: /^1:[0-9]+:web:[0-9a-f]+$/,
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const p = (ctx, ...parts) => ctx.deps.path.join(ctx.deps.root, ...parts);
/** Ask a question, or take the default when running without questions (--yes). */
async function ask(ctx, question, def = "") {
  if (ctx.opts.yes) return def;
  return (await ctx.deps.prompt(question, def)).trim();
}
const dry = (ctx, id, title, what) => result(id, title, "dry", `would ${what}`);

/** Loads the project settings into the run state without printing anything (so --only can run a single phase). */
export async function loadState(ctx) {
  const { deps, state } = ctx;
  const web = p(ctx, "web", ".env.local");
  if (await deps.fs.exists(web)) {
    const env = parseEnv(await deps.fs.read(web));
    state.env = env;
    state.project = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    state.apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY;
  }
  const fe = p(ctx, "functions", ".env");
  if (await deps.fs.exists(fe)) state.ownerEmail = parseEnv(await deps.fs.read(fe)).OWNER_EMAIL;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Preflight
// ---------------------------------------------------------------------------------------------------------------
export const preflight = {
  id: "preflight", title: "1. Preflight: this computer and your settings",
  async run(ctx) {
    const { deps, state } = ctx;
    const out = [];
    const major = Number(String(deps.nodeVersion).split(".")[0]);
    out.push(major >= 22 ? result("node", "Node.js", "ok", `version ${deps.nodeVersion}`) : result("node", "Node.js", "fail", `version ${deps.nodeVersion} is too old`, "Install Node 24 from nodejs.org and open a new PowerShell window."));
    out.push((await deps.fs.exists(p(ctx, "node_modules"))) ? result("packages", "Packages", "ok", "installed") : result("packages", "Packages", "fail", "not installed", "Run:  npm ci"));

    // The six web settings, by name and size only.
    const envFile = p(ctx, "web", ".env.local");
    if (!(await deps.fs.exists(envFile))) {
      out.push(result("webenv", "web/.env.local", "fail", "does not exist, so the CRM would start in demo mode", "Create it: node tools/make-env-local.mjs <file with your Firebase web config>, or copy web/.env.example and fill it in."));
    } else {
      const env = parseEnv(await deps.fs.read(envFile));
      state.env = env;
      const bad = FIREBASE_ENV.filter((n) => !CONFIG_PATTERNS[n].test(env[n] ?? ""));
      out.push(bad.length ? result("webenv", "web/.env.local", "fail", `missing or wrong: ${bad.join(", ")}`, "Copy them from Firebase console > Project settings > Your apps (web app).")
        : result("webenv", "web/.env.local", "ok", "all six Firebase settings look right"));
      state.project = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      state.apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY;
    }

    // The first owner's address.
    const fEnvFile = p(ctx, "functions", ".env");
    let fEnv = (await deps.fs.exists(fEnvFile)) ? parseEnv(await deps.fs.read(fEnvFile)) : {};
    if (!EMAIL.test(fEnv.OWNER_EMAIL ?? "")) {
      const entered = ctx.opts.dryRun ? "" : await ask(ctx, "Which email address will be the first owner (the one you will sign in with)?", ctx.opts.ownerEmail ?? "");
      if (EMAIL.test(entered)) {
        const keep = (await deps.fs.exists(fEnvFile)) ? (await deps.fs.read(fEnvFile)).split(/\r?\n/).filter((l) => !/^\s*OWNER_EMAIL\s*=/.test(l)) : [];
        await deps.fs.write(fEnvFile, [...keep.filter((l) => l.trim() !== ""), `OWNER_EMAIL=${entered}`].join("\n") + "\n");
        fEnv = { ...fEnv, OWNER_EMAIL: entered };
        out.push(result("owner", "functions/.env", "done", "OWNER_EMAIL written"));
      } else {
        out.push(ctx.opts.dryRun ? dry(ctx, "owner", "functions/.env", "ask for the first owner's email and write OWNER_EMAIL") : result("owner", "functions/.env", "fail", "no owner address (OWNER_EMAIL)", "Put your email after OWNER_EMAIL= in functions\\.env (copy functions\\.env.example first)."));
      }
    } else out.push(result("owner", "functions/.env", "ok", "an owner address is set (OWNER_EMAIL)"));
    state.ownerEmail = fEnv.OWNER_EMAIL;

    // Git is only reported, never changed.
    const g = await deps.run("git", ["status", "--porcelain"], { cwd: deps.root });
    out.push(g.code === 0 ? result("git", "Git", "ok", `${g.stdout.split(/\r?\n/).filter(Boolean).length} uncommitted change(s) (nothing is committed by this tool)`) : result("git", "Git", "skip", "not a Git folder"));
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Firebase login and project
// ---------------------------------------------------------------------------------------------------------------
export const login = {
  id: "login", title: "2. Firebase login and project",
  async run(ctx) {
    const { deps, state } = ctx;
    const out = [];
    let l = await loadLogin(deps);
    if (!l) {
      if (ctx.opts.dryRun) { state.noLoginDry = true; return [dry(ctx, "login", "Firebase login", "open a browser so you can log in (npx firebase-tools login), one click")]; }
      ctx.log("   A browser will open: choose the Google account that owns the Firebase project.");
      const r = await deps.run("npx", ["--yes", FIREBASE_TOOLS, "login"], { inherit: true, cwd: deps.root });
      l = await loadLogin(deps);
      if (!l) return [result("login", "Firebase login", "fail", r.code === 0 ? "the login was not saved" : "the login did not finish", `Run:  npx ${FIREBASE_TOOLS} login   then run this again.`)];
      out.push(result("login", "Firebase login", "done", `logged in as ${l.email}`));
    } else out.push(result("login", "Firebase login", "ok", `logged in as ${l.email}`));

    // Select the project (idempotent: only the default entry is set).
    const rcFile = p(ctx, ".firebaserc");
    let rc = { projects: {} };
    if (await deps.fs.exists(rcFile)) { try { rc = JSON.parse(await deps.fs.read(rcFile)); } catch { rc = { projects: {} }; } }
    if (rc?.projects?.default === state.project) out.push(result("project", "Project selected", "ok", state.project));
    else if (ctx.opts.dryRun) out.push(dry(ctx, "project", "Project selected", `select ${state.project} in .firebaserc`));
    else { await deps.fs.write(rcFile, JSON.stringify({ ...rc, projects: { ...(rc.projects ?? {}), default: state.project } }, null, 2) + "\n"); out.push(result("project", "Project selected", "done", state.project)); }

    // This login can see the project?
    const res = await gapi(deps, "GET", `https://firebase.googleapis.com/v1beta1/projects/${state.project}`);
    out.push(res.status === 200 ? result("access", "Project access", "ok", `this login can manage ${state.project}`)
      : result("access", "Project access", "fail", `this login cannot open the project (${res.status})`, `Log in with the Google account that owns it:  npx ${FIREBASE_TOOLS} login --reauth`));
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. What the project needs: billing, the database, storage
// ---------------------------------------------------------------------------------------------------------------
export async function billingEnabled(ctx) {
  const res = await gapi(ctx.deps, "GET", `https://cloudbilling.googleapis.com/v1/projects/${ctx.state.project}/billingInfo`);
  if (res.status !== 200) return null;
  return res.json?.billingEnabled === true;
}

export const resources = {
  id: "resources", title: "3. The database, file storage and the pay-as-you-go plan",
  async run(ctx) {
    const { deps, state } = ctx;
    const project = state.project;
    const out = [];
    if (state.noLoginDry) return [dry(ctx, "resources", "Database, file storage, plan", "check the pay-as-you-go plan, then create the Firestore (default) database in asia-south1 and the default Storage bucket in us-central1 if they are missing (after you log in)")];

    // Billing can only be switched on by the person: check it, and wait here if it is off.
    let billing = await billingEnabled(ctx);
    if (billing === null) out.push(result("billing", "Pay-as-you-go plan (Blaze)", "skip", "could not be checked from here", `Check it in the console: ${consoleUrl(project, "usage/details")}`));
    else if (billing) out.push(result("billing", "Pay-as-you-go plan (Blaze)", "ok", "on"));
    else {
      const hint = `Only you can do this (it needs your card). Open ${consoleUrl(project, "usage/details")}, press Upgrade, choose Blaze, and also set a ₹100 budget alert at console.cloud.google.com/billing > Budgets & alerts.`;
      if (ctx.opts.dryRun) out.push(result("billing", "Pay-as-you-go plan (Blaze)", "manual", "is off (the functions and file storage need it)", hint));
      else {
        ctx.log(`   The pay-as-you-go plan is off. ${hint}`);
        for (let i = 0; i < 5 && !billing; i++) {
          if (ctx.opts.yes) break;
          await ask(ctx, "Press Enter when you have switched it on (it re-checks)", "");
          billing = await billingEnabled(ctx);
        }
        out.push(billing ? result("billing", "Pay-as-you-go plan (Blaze)", "done", "now on") : result("billing", "Pay-as-you-go plan (Blaze)", "manual", "is still off", hint));
        if (!billing) return out;
      }
    }

    // Firestore (default) in Mumbai, production mode.
    const dbUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`;
    let db = await gapi(deps, "GET", dbUrl);
    if (db.status === 200) {
      const loc = String(db.json?.locationId ?? "");
      out.push(loc === DB_REGION ? result("firestore", "Database (default)", "ok", `exists in ${loc}`)
        : result("firestore", "Database (default)", "fail", `exists but in ${loc}, not ${DB_REGION}`, "A database's region cannot be changed. Use a new Firebase project, or delete this empty database in the console first and run this again."));
    } else if (ctx.opts.dryRun) out.push(dry(ctx, "firestore", "Database (default)", `create the (default) Firestore database in ${DB_REGION}, production mode`));
    else {
      await enableApi(deps, project, "firestore.googleapis.com");
      const create = await gapi(deps, "POST", `https://firestore.googleapis.com/v1/projects/${project}/databases?databaseId=(default)`, { type: "FIRESTORE_NATIVE", locationId: DB_REGION, concurrencyMode: "OPTIMISTIC" });
      if (create.status === 200 && create.json?.name) await waitOperation(deps, create.json.name);
      else if (create.status !== 409) { out.push(result("firestore", "Database (default)", "fail", `could not be created (${create.status}): ${apiMessage(create)}`, `Create it by hand: ${consoleUrl(project, "firestore")} > Create database > (default) > ${DB_REGION} > production mode.`)); return out; }
      db = await gapi(deps, "GET", dbUrl);
      out.push(db.status === 200 ? result("firestore", "Database (default)", "done", `created in ${DB_REGION}`) : result("firestore", "Database (default)", "fail", "was asked for but is not there yet", "Wait a minute and run this again."));
    }

    // The default Storage bucket in us-central1.
    const bucket = state.env?.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";
    const list = await gapi(deps, "GET", `https://firebasestorage.googleapis.com/v1beta/projects/${project}/buckets`);
    const have = list.status === 200 && (list.json?.buckets ?? []).some((b) => String(b.name).endsWith(`/${bucket}`));
    if (have) out.push(result("storage", "File storage", "ok", "the default bucket exists"));
    else if (ctx.opts.dryRun) out.push(dry(ctx, "storage", "File storage", `create the default bucket in ${STORAGE_REGION}`));
    else {
      await enableApi(deps, project, "firebasestorage.googleapis.com");
      const make = await gapi(deps, "POST", `https://firebasestorage.googleapis.com/v1alpha/projects/${project}/defaultBucket`, { location: STORAGE_REGION });
      const after = make.status === 200 || make.status === 409 ? await gapi(deps, "GET", `https://firebasestorage.googleapis.com/v1beta/projects/${project}/buckets`) : null;
      const ok = after?.status === 200 && (after.json?.buckets ?? []).some((b) => String(b.name).endsWith(`/${bucket}`));
      out.push(ok ? result("storage", "File storage", "done", `created in ${STORAGE_REGION}`)
        : result("storage", "File storage", "manual", `could not be created from here (${make.status}): ${apiMessage(make)}`, `Console > Build > Storage > Get started > production mode > ${STORAGE_REGION}: ${consoleUrl(project, "storage")}`));
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 4. Sign-in (Authentication)
// ---------------------------------------------------------------------------------------------------------------
const idt = (project) => `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}`;

async function authConfig(ctx) {
  let res = await gapi(ctx.deps, "GET", `${idt(ctx.state.project)}/config`);
  if (res.status === 200) return { res, started: true };
  return { res, started: false };
}

export const authPhase = {
  id: "auth", title: "4. Sign-in: Email/Password, Email link, Google",
  async run(ctx) {
    const { deps, state } = ctx;
    const project = state.project;
    const out = [];
    if (state.noLoginDry) return [dry(ctx, "auth", "Sign-in", "start Authentication, turn on Email/Password and Email link, allow SMS only to India, and try to turn on Google (after you log in)")];
    let { res, started } = await authConfig(ctx);
    if (!started) {
      if (ctx.opts.dryRun) return [dry(ctx, "auth-start", "Authentication", "start Authentication, turn on Email/Password and Email link, allow SMS only to India, and try to turn on Google")];
      await enableApi(deps, project, "identitytoolkit.googleapis.com");
      const init = await gapi(deps, "POST", `https://identitytoolkit.googleapis.com/v2/projects/${project}/identityPlatform:initializeAuth`, {});
      ({ res, started } = await authConfig(ctx));
      if (!started) return [result("auth-start", "Authentication", "fail", `could not be started (${init.status}): ${apiMessage(init)}`, `Start it by hand: ${consoleUrl(project, "authentication")} > Get started.`)];
      out.push(result("auth-start", "Authentication", "done", "started"));
    } else out.push(result("auth-start", "Authentication", "ok", "started"));

    const email = res.json?.signIn?.email ?? {};
    if (email.enabled === true && email.passwordRequired === false) out.push(result("auth-email", "Email/Password and Email link", "ok", "both on"));
    else if (ctx.opts.dryRun) out.push(dry(ctx, "auth-email", "Email/Password and Email link", "turn on Email/Password and the passwordless Email link"));
    else {
      const patch = await gapi(deps, "PATCH", `${idt(project)}/config?updateMask=signIn.email`, { signIn: { email: { enabled: true, passwordRequired: false } } });
      out.push(patch.status === 200 ? result("auth-email", "Email/Password and Email link", "done", "turned on (both)")
        : result("auth-email", "Email/Password and Email link", "manual", `could not be turned on from here (${patch.status}): ${apiMessage(patch)}`, `Console > Authentication > Sign-in method > Email/Password: switch on both options and save: ${consoleUrl(project, "authentication/providers")}`));
    }

    const regions = res.json?.smsRegionConfig?.allowlistOnly?.allowedRegions ?? [];
    if (regions.length === 1 && regions[0] === "IN") out.push(result("auth-sms", "Phone codes: India only", "ok", "allowed region is India only"));
    else if (ctx.opts.dryRun) out.push(dry(ctx, "auth-sms", "Phone codes: India only", "allow phone codes to India only"));
    else {
      const patch = await gapi(deps, "PATCH", `${idt(project)}/config?updateMask=smsRegionConfig`, { smsRegionConfig: { allowlistOnly: { allowedRegions: ["IN"] } } });
      out.push(patch.status === 200 ? result("auth-sms", "Phone codes: India only", "done", "allowed region set to India only")
        : result("auth-sms", "Phone codes: India only", "manual", `could not be set from here (${patch.status})`, `Console > Authentication > Settings > SMS region policy > Allow > India only: ${consoleUrl(project, "authentication/settings")}`));
    }

    // Google needs an OAuth client the API usually will not hand out: try, and give the one click-path if it refuses.
    const g = await gapi(deps, "GET", `${idt(project)}/defaultSupportedIdpConfigs/google.com`);
    if (g.status === 200 && g.json?.enabled === true) out.push(result("auth-google", "Google sign-in", "ok", "on"));
    else if (ctx.opts.dryRun) out.push(dry(ctx, "auth-google", "Google sign-in", "try to turn on Google (it may need one click in the console)"));
    else {
      const make = await gapi(deps, "POST", `${idt(project)}/defaultSupportedIdpConfigs?idpId=google.com`, { enabled: true });
      const again = make.status === 200 ? await gapi(deps, "GET", `${idt(project)}/defaultSupportedIdpConfigs/google.com`) : null;
      out.push(again?.json?.enabled === true ? result("auth-google", "Google sign-in", "done", "turned on")
        : result("auth-google", "Google sign-in", "manual", "needs one click (Google does not let a script create its sign-in client)", `Console > Authentication > Sign-in method > Google > Enable > choose a support email > Save: ${consoleUrl(project, "authentication/providers")}. Run this again afterwards to re-check. (Email sign-in works without it.)`));
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 5. Authorized domains
// ---------------------------------------------------------------------------------------------------------------
/** Adds addresses to Authentication > Authorized domains without removing any that are there. */
export async function ensureDomains(ctx, wanted) {
  const { deps, state } = ctx;
  const project = state.project;
  const cfg = await gapi(deps, "GET", `${idt(project)}/config`);
  if (cfg.status !== 200) return result("domains", "Authorized domains", "fail", `could not be read (${cfg.status})`, "Run the sign-in step first.");
  const have = cfg.json?.authorizedDomains ?? [];
  const missing = [...new Set(wanted.filter(Boolean))].filter((d) => !have.includes(d));
  if (!missing.length) return result("domains", "Authorized domains", "ok", `already present: ${wanted.filter(Boolean).join(", ")}`);
  if (ctx.opts.dryRun) return dry(ctx, "domains", "Authorized domains", `add ${missing.join(", ")}`);
  const patch = await gapi(deps, "PATCH", `${idt(project)}/config?updateMask=authorizedDomains`, { authorizedDomains: [...have, ...missing] });
  return patch.status === 200 ? result("domains", "Authorized domains", "done", `added ${missing.join(", ")}`)
    : result("domains", "Authorized domains", "manual", `could not be added from here (${patch.status})`, `Console > Authentication > Settings > Authorized domains > Add: ${missing.join(", ")} (${consoleUrl(project, "authentication/settings")})`);
}

export const domains = {
  id: "domains", title: "5. Authorized domains",
  async run(ctx) {
    const project = ctx.state.project;
    if (ctx.state.noLoginDry) return dry(ctx, "domains", "Authorized domains", "add localhost and your site addresses (after you log in)");
    return ensureDomains(ctx, ["localhost", `${project}.firebaseapp.com`, `${project}.web.app`, ctx.opts.siteDomain]);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 6. Deploy the rules, indexes and functions, then prove they are live
// ---------------------------------------------------------------------------------------------------------------
/** The checks that need no login: a deployed callable answers an anonymous call with a refusal; the rules deny anonymous reads. */
export async function liveChecks(ctx, { retries = 8 } = {}) {
  const { deps, state } = ctx;
  const project = state.project, key = state.apiKey;
  const probes = [
    { id: "rules-db", title: "Database rules deny anonymous reads", ok: (r, t) => r.status === 403 && /insufficient permissions/i.test(t), run: () => deps.fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/users/x?key=${key}`), fix: "The Firestore rules did not deploy. Run npm run setup again and read the deploy output." },
  ];
  const out = [];
  for (const pr of probes) {
    const hit = await poll(async () => {
      try { const r = await pr.run(); const t = await r.text(); return pr.ok(r, t) ? { r } : null; } catch { return null; }
    }, { times: retries, everyMs: 5000, sleep: deps.sleep });
    out.push(hit ? result(pr.id, pr.title, "ok", "verified") : result(pr.id, pr.title, "fail", "not as expected", pr.fix));
  }
  return out;
}

/** TTL policies are paid-plan only (D-51); a file that asks for one makes the whole indexes deploy fail. Returns the offending collection.field names. */
export function indexesWithTtl(root) {
  try {
    const j = JSON.parse(readFileSync(join(root, "firestore.indexes.json"), "utf8"));
    return (j.fieldOverrides ?? []).filter((o) => o.ttl).map((o) => `${o.collectionGroup}.${o.fieldPath}`);
  } catch { return []; }
}

export const deploy = {
  id: "deploy", title: "6. Deploy the rules and indexes",
  async run(ctx) {
    const { deps, state } = ctx;
    const ttl = indexesWithTtl(deps.root);
    if (ttl.length) return [result("indexes-ttl", "Indexes file", "fail", `asks for TTL on ${ttl.join(", ")}`, "The free plan cannot publish a TTL (auto-delete) setting (it fails with 'billing disabled'). Remove the entries with \"ttl\": true from firestore.indexes.json.")];
    if (ctx.opts.dryRun) return [dry(ctx, "deploy", "Deploy", `run: npx ${FIREBASE_TOOLS} deploy --only firestore --project ${state.project} (rules and indexes only: the free plan has no functions or storage), then check the rules by calling the database`)];
    const args = ["--yes", FIREBASE_TOOLS, "deploy", "--only", "firestore", "--project", state.project, "--non-interactive", "--force"];
    ctx.log(`   Running: npx ${FIREBASE_TOOLS} deploy ... (this takes a few minutes the first time)`);
    const r = await deps.run("npx", args, { inherit: true, cwd: deps.root });
    if (r.code !== 0) return [result("deploy", "Deploy", "fail", `the deploy stopped (exit ${r.code})`, "Read the last lines above. Common causes: an index file that asks for TTL (auto-delete), which the free plan refuses with \"billing disabled\", or an API still switching on (wait a minute and run again).")];
    return [result("deploy", "Deploy", "done", "rules and indexes sent"), ...(await liveChecks(ctx))];
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 7. Netlify
// ---------------------------------------------------------------------------------------------------------------
const nf = (ctx, args, opt = {}) => ctx.deps.run("npx", ["--yes", NETLIFY_CLI, ...args], { cwd: ctx.deps.root, ...opt });
const tryJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

export const CONNECT_REPO_STEPS = [
  "To get push-to-deploy afterwards (every push to main builds the site), connect the repository once in Netlify:",
  "  1. app.netlify.com > your site > Site configuration > Build & deploy > Continuous deployment > Link repository.",
  "  2. Choose GitHub > Ambika-Groups/CRM > branch main.",
  "  3. Base directory: (leave empty)   Build command: npm ci && npm run build:web   Publish directory: web/out   (these come from netlify.toml).",
  "  4. Environment variables are already set by this wizard. Keep NODE_VERSION as in netlify.toml.",
  "Cost reminder: each production deploy on Netlify uses 15 credits, so push to main only when you mean to publish.",
];

export const netlify = {
  id: "netlify", title: "7. Netlify (the website itself)",
  async run(ctx) {
    const { deps, state } = ctx;
    const out = [];
    if (ctx.opts.skipNetlify) return [result("netlify", "Netlify", "skip", "left out (--skip-netlify)")];
    const siteName = ctx.opts.siteName ?? "ambika-crm";
    if (ctx.opts.dryRun) {
      return [dry(ctx, "netlify", "Netlify", `check the Netlify login, find or create the site "${siteName}", set the six NEXT_PUBLIC_FIREBASE_* variables, build the Firebase site locally (npm run build:firebase, NEXT_PUBLIC_REQUIRE_FIREBASE=1), deploy a preview, and (if you agree) publish it. Publishing uses 15 Netlify credits.`)];
    }

    // Login.
    let sites = await nf(ctx, ["sites:list", "--json"]);
    if (sites.code !== 0) {
      ctx.log("   A browser will open: log in to Netlify.");
      await nf(ctx, ["login"], { inherit: true });
      sites = await nf(ctx, ["sites:list", "--json"]);
      if (sites.code !== 0) return [result("netlify-login", "Netlify login", "fail", "not logged in", `Run:  npx ${NETLIFY_CLI} login   then run this again.`)];
      out.push(result("netlify-login", "Netlify login", "done", "logged in"));
    } else out.push(result("netlify-login", "Netlify login", "ok", "logged in"));

    // The site: found by name, or made.
    let site = (tryJson(sites.stdout) ?? []).find((s) => s.name === siteName || s.id === ctx.opts.siteId);
    if (!site) {
      const make = await nf(ctx, ["api", "createSite", "--data", JSON.stringify({ body: { name: siteName } })]);
      site = tryJson(make.stdout);
      if (!site?.id) return [...out, result("netlify-site", "Netlify site", "fail", `could not create "${siteName}"`, "The name may be taken. Run again with --site-name <another-name>.")];
      out.push(result("netlify-site", "Netlify site", "done", `created ${site.name}`));
    } else out.push(result("netlify-site", "Netlify site", "ok", `found ${site.name}`));
    const siteDomain = new URL(site.ssl_url ?? site.url ?? `https://${site.name}.netlify.app`).hostname;
    state.siteDomain = siteDomain;
    state.siteId = site.id;

    // The settings: public web config only, from web/.env.local.
    const keys = [...FIREBASE_ENV, ...(state.env?.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ? ["NEXT_PUBLIC_RECAPTCHA_SITE_KEY"] : [])];
    let failed = 0;
    for (const k of keys) {
      const r = await nf(ctx, ["env:set", k, state.env[k], "--site", site.id, "--force"]);
      if (r.code !== 0) failed++;
    }
    out.push(failed ? result("netlify-env", "Netlify settings", "fail", `${failed} of ${keys.length} settings could not be set`, "Set them by hand: Netlify > Site configuration > Environment variables (the Setup page prints the exact lines).")
      : result("netlify-env", "Netlify settings", "done", `${keys.length} Firebase settings set`));
    if (failed) return out;

    // Authorized domain for the site address, then build and deploy.
    out.push(await ensureDomains(ctx, [siteDomain]));
    const build = await deps.run("npm", ["run", "build:firebase"], { inherit: true, cwd: deps.root, env: { NEXT_PUBLIC_REQUIRE_FIREBASE: "1" } });
    if (build.code !== 0) return [...out, result("netlify-build", "Build the site", "fail", "the build stopped", "Read the message above (it says what is missing).")];
    out.push(result("netlify-build", "Build the site", "done", "built in Firebase mode (web/out-firebase)"));

    const preview = await nf(ctx, ["deploy", "--dir", "web/out-firebase", "--site", site.id, "--json"]);
    const pj = tryJson(preview.stdout);
    if (preview.code !== 0 || !pj) return [...out, result("netlify-preview", "Preview deploy", "fail", "did not finish", "Run again; the deploy is safe to repeat.")];
    out.push(result("netlify-preview", "Preview deploy", "done", `preview at ${pj.deploy_url ?? pj.url}`, "A preview address is not an authorized sign-in domain, so sign-in only works on the main address."));
    state.previewUrl = pj.deploy_url ?? pj.url;

    const go = ctx.opts.prod ? "y" : await ask(ctx, "Publish to production now? It uses 15 Netlify credits. [y/N]", "n");
    if (/^y/i.test(go)) {
      const prod = await nf(ctx, ["deploy", "--dir", "web/out-firebase", "--site", site.id, "--prod", "--json"]);
      const j = tryJson(prod.stdout);
      if (prod.code !== 0 || !j) return [...out, result("netlify-prod", "Production deploy", "fail", "did not finish", "Run again; it is safe to repeat.")];
      state.url = j.url ?? `https://${siteDomain}`;
      out.push(result("netlify-prod", "Production deploy", "done", `live at ${state.url}`));
    } else out.push(result("netlify-prod", "Production deploy", "skip", "not published (you chose not to)", "Run again with --prod, or publish from the Netlify page."));
    for (const line of CONNECT_REPO_STEPS) ctx.log(`   ${line}`);
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 8. Smoke test of the published site
// ---------------------------------------------------------------------------------------------------------------
export const verify = {
  id: "verify", title: "8. Check the published site",
  soft: true,
  async run(ctx) {
    const url = ctx.opts.url ?? ctx.state.url;
    if (!url) return [result("verify", "Smoke test", "skip", "no site address yet", "After publishing, run:  npm run verify:live -- https://your-site")];
    if (ctx.opts.dryRun) return [dry(ctx, "verify", "Smoke test", `check ${url}: pages, security headers, the sign-in proxy, providers, rules, functions, authorized domain, the sign-in screen`)];
    const v = await verifyLive(url, ctx.deps, { project: ctx.state.project, apiKey: ctx.state.apiKey, bucket: ctx.state.env?.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET });
    ctx.state.ready = v.ready;
    return [...v.rows.map((r) => result(`verify-${r.id}`, r.title, r.status, r.detail, r.hint)), result("verify", "Overall", v.ready ? "ok" : "fail", v.ready ? "READY" : "NOT READY", v.ready ? "" : "Fix the lines marked [FAIL] above and run again.")];
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 9. The first owner
// ---------------------------------------------------------------------------------------------------------------
export const owner = {
  id: "owner", title: "9. The first owner",
  async run(ctx) {
    const { deps, state } = ctx;
    const url = ctx.opts.url ?? state.url ?? "http://localhost:3100  (start it with:  npm run dev:live)";
    ctx.log(`   Open ${url}`);
    ctx.log(`   1. Sign in with ${state.ownerEmail ?? "your owner address"}: press "Email me a sign-in link" (or Continue with Google if it is a Google account).`);
    ctx.log("   2. Open the email on the same computer and press the link.");
    ctx.log('   3. The page says "Your account isn\'t set up yet" with the button "Set up as the first owner". Press it.');
    if (state.noLoginDry) return [result("owner", "First owner", "manual", "after the steps above", "Follow the three steps above.")];
    const done = await gapi(deps, "GET", `https://firestore.googleapis.com/v1/projects/${state.project}/databases/(default)/documents/meta/bootstrap`);
    if (done.status === 200) return [result("owner", "First owner", "ok", "the first owner is already set up")];
    if (ctx.opts.dryRun || !ctx.opts.waitOwner) return [result("owner", "First owner", "manual", "not set up yet", `Follow the three steps above. (Run with --wait-owner to have this wait and confirm.)`)];
    ctx.log("   Waiting for the first owner (press Ctrl+C to stop waiting)...");
    const hit = await poll(async () => (await gapi(deps, "GET", `https://firestore.googleapis.com/v1/projects/${state.project}/databases/(default)/documents/meta/bootstrap`)).status === 200, { times: 120, everyMs: 5000, sleep: deps.sleep });
    return [hit ? result("owner", "First owner", "done", "the first owner is set up") : result("owner", "First owner", "manual", "still not set up", "Do the three steps above, then run npm run golive to confirm.")];
  },
};

export const ALL_PHASES = [preflight, login, resources, authPhase, domains, deploy, netlify, verify, owner];
