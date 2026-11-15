// `npm run verify:live -- <url>`: is the published CRM really ready? One table, and a final READY or NOT READY. It needs no
// login (it asks only public addresses) and changes nothing. App Check is optional and never decides READY.
//   node tools/setup/verify-live.mjs https://your-site.netlify.app
//   node tools/setup/verify-live.mjs http://localhost:3100        (the local live server; header and proxy checks are n/a there)
import { LABEL, parseEnv, scrub, secretValues } from "./lib.mjs";

const row = (id, title, status, detail = "", hint = "", required = true) => ({ id, title, status, detail, hint, required });
const isLocal = (u) => /^(localhost|127\.0\.0\.1)$/.test(new URL(u).hostname);

/**
 * @param {string} url the site to check, no trailing slash needed
 * @param {object} deps fetch, run, sleep, chromePath (see index.mjs)
 * @param {{project: string, apiKey: string, bucket?: string}} cfg the Firebase web settings of the project it should be connected to
 */
export async function verifyLive(url, deps, cfg) {
  const base = url.replace(/\/+$/, "");
  const local = isLocal(base);
  const rows = [];
  const get = async (path, init) => { try { const r = await deps.fetch(`${base}${path}`, { redirect: "manual", ...init }); return { r, text: await r.text() }; } catch (e) { return { r: null, text: String(e?.message ?? e) }; } };
  const post = (u, body) => deps.fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // 1. Pages and the not-found page (a missing address must say so, with the right status).
  const bad = [];
  for (const path of ["/", "/projects/", "/clients/", "/labour/", "/settings/setup/"]) {
    const { r, text } = await get(path);
    if (!r || r.status !== 200 || !/<html/i.test(text)) bad.push(`${path} (${r?.status ?? "no answer"})`);
  }
  rows.push(bad.length ? row("pages", "Pages open", "fail", `not OK: ${bad.join(", ")}`, "Check the deploy finished and the publish folder is web/out (Netlify) / web/out-firebase (this wizard).") : row("pages", "Pages open", "ok", "5 pages answered"));
  const nf = await get("/no-such-page-check/");
  rows.push(nf.r?.status === 404 && /not found/i.test(nf.text) ? row("notfound", "Unknown address shows 'Page not found'", "ok", "404 with the CRM's own page")
    : row("notfound", "Unknown address shows 'Page not found'", "fail", `answered ${nf.r?.status ?? "nothing"}`, "Pages should come from the CRM build (404.html)."));

  // 2. Security headers (set by Netlify, so not present on the local server).
  if (local) rows.push(row("headers", "Security headers", "skip", "set by Netlify; not on a local server", "", false));
  else {
    const { r } = await get("/");
    const h = (n) => r?.headers.get(n) ?? "";
    const missing = [];
    if (!/nosniff/i.test(h("x-content-type-options"))) missing.push("X-Content-Type-Options");
    if (!/strict-origin/i.test(h("referrer-policy"))) missing.push("Referrer-Policy");
    if (!/deny/i.test(h("x-frame-options"))) missing.push("X-Frame-Options");
    if (!/max-age=/i.test(h("strict-transport-security"))) missing.push("Strict-Transport-Security");
    if (!/frame-ancestors 'none'/.test(h("content-security-policy")) || !/recaptcha/.test(h("content-security-policy"))) missing.push("Content-Security-Policy");
    rows.push(missing.length ? row("headers", "Security headers", "fail", `missing: ${missing.join(", ")}`, "They come from netlify.toml [[headers]]. Check it was deployed.") : row("headers", "Security headers", "ok", "all present"));
  }

  // 3. The page is the Firebase build for this project (not the demo): the project address is inside the site's scripts.
  const home = await get("/");
  const chunks = [...new Set([...home.text.matchAll(/\/_next\/static\/[^"')\s]+\.js/g)].map((m) => m[0]))].slice(0, 25);
  let hasProject = false, siteKey = false;
  for (const c of chunks) {
    const t = (await get(c)).text;
    if (cfg.project && t.includes(cfg.project)) hasProject = true;
    if (/"6L[A-Za-z0-9_-]{38}"/.test(t)) siteKey = true;
    if (hasProject && siteKey) break;
  }
  rows.push(hasProject ? row("config", "Connected to your project (not the demo)", "ok", "the Firebase settings are in the site")
    : row("config", "Connected to your project (not the demo)", "fail", "the site has no Firebase settings, so it would open as the demo", "Set the six NEXT_PUBLIC_FIREBASE_* variables in Netlify (Site configuration > Environment variables) and deploy again."));

  // 4. The sign-in proxy: Google sign-in stays on the site's own address (not on a local server).
  if (local) rows.push(row("proxy", "Sign-in proxy (/__/auth)", "skip", "set up by the Netlify build; not on a local server", "", false));
  else {
    const h = await get("/__/auth/handler");
    const init = await get("/__/firebase/init.json");
    const okInit = init.r?.status === 200 && (() => { try { return JSON.parse(init.text).projectId === cfg.project; } catch { return false; } })();
    rows.push(h.r?.status === 200 && okInit ? row("proxy", "Sign-in proxy (/__/auth)", "ok", "forwards to your project")
      : row("proxy", "Sign-in proxy (/__/auth)", "fail", `handler ${h.r?.status ?? "no answer"}, init ${init.r?.status ?? "no answer"}`, "The Netlify build writes it (web/scripts/postbuild.mjs) when NEXT_PUBLIC_FIREBASE_PROJECT_ID is set. Check the variable and deploy again."));
  }

  // 5. What is switched on at Google: the sign-in methods, and whether this site's address is allowed.
  const idk = `key=${cfg.apiKey}`;
  const pw = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?${idk}`, { email: "verify@example.invalid", password: "x", returnSecureToken: true }).then(async (r) => String((await r.json().catch(() => ({})))?.error?.message ?? ""), () => "");
  const gg = await post(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?${idk}`, { providerId: "google.com", continueUri: local ? "http://localhost" : base }).then(async (r) => ({ status: r.status, msg: String((await r.json().catch(() => ({})))?.error?.message ?? "") }), () => ({ status: 0, msg: "" }));
  const emailOn = /EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|INVALID_EMAIL/.test(pw);
  const googleOn = gg.status === 200;
  rows.push(emailOn || googleOn ? row("providers", "Sign-in methods", "ok", [emailOn ? "email and password" : "", googleOn ? "Google" : ""].filter(Boolean).join(" and ") + " on", !googleOn ? "Google is off: fine if the owner uses an email link." : "")
    : row("providers", "Sign-in methods", "fail", /CONFIGURATION_NOT_FOUND/.test(pw) ? "Authentication has not been started" : "no method is turned on", "Console > Authentication > Sign-in method: turn on Email/Password (with Email link) and Google."));
  rows.push(/INVALID_CONTINUE_URI|UNAUTHORIZED|not authorized|invalid_continue/i.test(gg.msg)
    ? row("domain", "This address is an authorized sign-in domain", "fail", `${new URL(base).hostname} is not authorized`, "Console > Authentication > Settings > Authorized domains > Add this address.")
    : gg.status === 200 ? row("domain", "This address is an authorized sign-in domain", "ok", new URL(base).hostname)
      : row("domain", "This address is an authorized sign-in domain", "skip", "could not be checked (Google sign-in is off or unreachable)", "", false));

  // 6. The rules are live (anonymous reads are refused) and the server functions answer.
  const db = await deps.fetch(`https://firestore.googleapis.com/v1/projects/${cfg.project}/databases/(default)/documents/users/x?${idk}`).then(async (r) => ({ status: r.status, text: await r.text() }), () => ({ status: 0, text: "" }));
  rows.push(db.status === 403 && /insufficient permissions/i.test(db.text) ? row("rules-db", "Database rules refuse anonymous reads", "ok", "the rules are live")
    : row("rules-db", "Database rules refuse anonymous reads", "fail", db.status === 200 || db.status === 404 ? "the database is open or empty-ruled" : `answered ${db.status}`, "Deploy the rules: npm run setup (or npx firebase-tools@15.34.1 deploy --only firestore)."));
  const st = await deps.fetch(`https://firebasestorage.googleapis.com/v0/b/${cfg.bucket}/o?maxResults=1`).then((r) => r.status, () => 0);
  rows.push(st === 401 || st === 403 ? row("rules-storage", "Storage rules refuse anonymous access", "ok", "the rules are live") : row("rules-storage", "Storage rules refuse anonymous access", "fail", `answered ${st}`, "Create Storage and deploy its rules: npm run setup."));
  const fp = await post(`https://asia-south1-${cfg.project}.cloudfunctions.net/ping`, { data: {} }).then((r) => r.status, () => 0);
  const fe = await post(`https://asia-south1-${cfg.project}.cloudfunctions.net/submitEnquiry`, { dryRun: true }).then((r) => r.status, () => 0);
  rows.push(fp === 401 && fe === 401 ? row("functions", "Server functions answer", "ok", "ping and the website enquiry address are live")
    : row("functions", "Server functions answer", "fail", `ping ${fp || "no answer"}, enquiry ${fe || "no answer"}`, "Deploy the functions: npm run setup."));

  // 7. App Check is optional: reported, never a reason for NOT READY.
  rows.push(siteKey ? row("appcheck", "App Check", "ok", "a reCAPTCHA site key is in the site (switch enforcement on later, from Setup & integrations)", "", false)
    : row("appcheck", "App Check", "skip", "optional, not set (nothing is blocked because of it)", "Set it up later in Settings > Setup & integrations.", false));

  // 8. The sign-in screen really appears in a browser (rendered, not just downloaded).
  if (!deps.chromePath) rows.push(row("screen", "Sign-in screen appears", "skip", "no Chrome or Edge found to look with", "", false));
  else {
    const dump = await deps.run(deps.chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--virtual-time-budget=25000", "--dump-dom", base + "/"], {});
    rows.push(/data-google/.test(dump.stdout) ? row("screen", "Sign-in screen appears", "ok", "the sign-in page rendered in a browser")
      : /data-role-switcher|demo-banner/.test(dump.stdout) ? row("screen", "Sign-in screen appears", "fail", "the site opened as the DEMO", "The Firebase settings are missing from this build. Set the NEXT_PUBLIC_FIREBASE_* variables and deploy again.")
        : row("screen", "Sign-in screen appears", "fail", "the sign-in page did not appear", "Open the site in a browser and read the message on screen."));
  }

  const ready = rows.filter((r) => r.required).every((r) => r.status === "ok" || r.status === "skip");
  return { rows, ready };
}

// ---- command line ----
export function formatTable(rows, ready) {
  const w = Math.max(...rows.map((r) => r.title.length));
  const lines = rows.map((r) => `${LABEL[r.status]} ${r.title.padEnd(w)}  ${r.detail}${r.hint && r.status !== "ok" ? `\n           -> ${r.hint}` : ""}`);
  return `${lines.join("\n")}\n\n${ready ? "READY" : "NOT READY"}\n`;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("tools/setup/verify-live.mjs")) {
  const { realDeps } = await import("./deps.mjs");
  const args = process.argv.slice(2);
  const url = args.find((a) => /^https?:\/\//.test(a));
  if (!url) { console.error("Usage: npm run verify:live -- https://your-site"); process.exit(2); }
  const deps = realDeps();
  const env = (await deps.fs.exists(deps.path.join(deps.root, "web", ".env.local"))) ? parseEnv(await deps.fs.read(deps.path.join(deps.root, "web", ".env.local"))) : {};
  const project = args[args.indexOf("--project") + 1]?.startsWith("-") ? undefined : args.includes("--project") ? args[args.indexOf("--project") + 1] : env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!project) { console.error("No project: create web/.env.local or pass --project <id>."); process.exit(2); }
  const { rows, ready } = await verifyLive(url, deps, { project, apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "", bucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET });
  console.log(scrub(formatTable(rows, ready), secretValues(env)));
  process.exit(ready ? 0 : 1);
}
