// The setup wizard against a fake Google and Netlify (no network, no login). IDs W-xxx are cited in docs/prd-traceability.md.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main, parseArgs } from "../index.mjs";
import { LABEL, Report, result, runPhases, scrub } from "../lib.mjs";
import {
  authPhase, domains, deploy, ensureDomains, indexesWithTtl, login, netlify, preflight, resources, owner, ALL_PHASES, CONNECT_REPO_STEPS,
} from "../phases.mjs";
import { API_KEY, PROJECT, SECRET_TOKEN, WEB_ENV, fakeWorld, makeCtx, makeDeps } from "./helpers.mjs";

const statuses = (rs) => Object.fromEntries(rs.map((r) => [r.id, r.status]));
const mutations = (w) => w.calls.length + w.runs.filter((r) => /deploy|login|build:firebase|env:set|createSite/.test(r)).length;

describe("preflight (phase 1)", () => {
  it("W-01 reports a good setup by name and size only, never by value", async () => {
    const deps = makeDeps();
    const ctx = makeCtx(deps);
    const out = await preflight.run(ctx);
    expect(statuses(out)).toMatchObject({ node: "ok", packages: "ok", webenv: "ok", owner: "ok", git: "ok" });
    expect(JSON.stringify(out)).not.toContain(API_KEY);
    expect(ctx.state).toMatchObject({ project: PROJECT, ownerEmail: "business@ambikagroups.tech" });
  });

  it("W-02 names exactly what is missing or wrong, and fails", async () => {
    const deps = makeDeps(fakeWorld(), { files: { "/crm/web/.env.local": "NEXT_PUBLIC_FIREBASE_API_KEY=nope\n" } });
    const out = await preflight.run(makeCtx(deps));
    const web = out.find((r) => r.id === "webenv");
    expect(web.status).toBe("fail");
    expect(web.detail).toContain("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
    expect(web.detail).not.toContain("nope");
  });

  it("W-03 asks for the owner address once, writes OWNER_EMAIL, and a second run asks nothing", async () => {
    const files = { "/crm/functions/.env": "" };
    const deps = makeDeps(fakeWorld(), { files, prompts: ["Owner@Example.com"] });
    const first = await preflight.run(makeCtx(deps));
    expect(first.find((r) => r.id === "owner").status).toBe("done");
    expect(deps._files.get("/crm/functions/.env")).toContain("OWNER_EMAIL=Owner@Example.com");
    const second = await preflight.run(makeCtx(deps));
    expect(second.find((r) => r.id === "owner").status).toBe("ok");
  });

  it("W-04 without questions (--yes) and without an owner address it fails with the fix; a dry run only says what it would do", async () => {
    const deps = makeDeps(fakeWorld(), { files: { "/crm/functions/.env": "" } });
    expect((await preflight.run(makeCtx(deps, { yes: true }))).find((r) => r.id === "owner").status).toBe("fail");
    expect((await preflight.run(makeCtx(deps, { dryRun: true }))).find((r) => r.id === "owner").status).toBe("dry");
    expect(deps._files.get("/crm/functions/.env")).toBe("");
  });
});

describe("login and project (phase 2)", () => {
  it("W-10 reuses an existing login and selects the project once", async () => {
    const deps = makeDeps();
    const ctx = makeCtx(deps, {}, { project: PROJECT });
    const first = await login.run(ctx);
    expect(statuses(first)).toMatchObject({ login: "ok", project: "done", access: "ok" });
    expect(deps._world.runs.some((r) => r.includes("login"))).toBe(false);
    expect(JSON.parse(deps._files.get("/crm/.firebaserc")).projects.default).toBe(PROJECT);
    expect(statuses(await login.run(makeCtx(deps, {}, { project: PROJECT }))).project).toBe("ok");
  });

  it("W-11 with no login it starts the CLI login (one browser click) and carries on", async () => {
    const deps = makeDeps(fakeWorld({ loggedIn: false }));
    const out = await login.run(makeCtx(deps, {}, { project: PROJECT }));
    expect(deps._world.runs.some((r) => r.includes("firebase-tools@15.34.1 login"))).toBe(true);
    expect(statuses(out).login).toBe("done");
  });

  it("W-12 a login that cannot see the project fails with the fix; a dry run never opens a browser", async () => {
    const deps = makeDeps(fakeWorld({ canSeeProject: false }));
    expect(statuses(await login.run(makeCtx(deps, {}, { project: PROJECT }))).access).toBe("fail");
    const dryDeps = makeDeps(fakeWorld({ loggedIn: false }));
    expect((await login.run(makeCtx(dryDeps, { dryRun: true }, { project: PROJECT })))[0].status).toBe("dry");
    expect(mutations(dryDeps._world)).toBe(0);
  });
});

describe("database, storage and billing (phase 3)", () => {
  const ctxFor = (w, opts = {}) => makeCtx(makeDeps(w), { yes: true, ...opts }, { project: PROJECT, env: Object.fromEntries(WEB_ENV.trim().split("\n").map((l) => l.split("="))) });

  it("W-20 creates the database in Mumbai and the bucket in us-central1 when missing, and a second run changes nothing", async () => {
    const w = fakeWorld();
    const first = await resources.run(ctxFor(w));
    expect(statuses(first)).toMatchObject({ billing: "ok", firestore: "done", storage: "done" });
    expect(w.db).toBe("asia-south1");
    const before = w.calls.length;
    const second = await resources.run(ctxFor(w));
    expect(statuses(second)).toMatchObject({ firestore: "ok", storage: "ok" });
    expect(w.calls.length).toBe(before);
  });

  it("W-21 a database in the wrong region is reported, never touched", async () => {
    const w = fakeWorld({ db: "us-east1", bucket: true });
    const out = await resources.run(ctxFor(w));
    expect(statuses(out).firestore).toBe("fail");
    expect(out.find((r) => r.id === "firestore").hint).toMatch(/cannot be changed/);
    expect(w.calls.filter((c) => c.includes("databases"))).toEqual([]);
  });

  it("W-22 without the pay-as-you-go plan it stops with the exact console link (billing is only the person's to switch on)", async () => {
    const w = fakeWorld({ billing: false });
    const out = await resources.run(ctxFor(w));
    expect(out.map((r) => r.id)).toEqual(["billing"]);
    expect(out[0]).toMatchObject({ status: "manual" });
    expect(out[0].hint).toContain(`console.firebase.google.com/project/${PROJECT}`);
    expect(w.calls).toEqual([]);
  });

  it("W-23 billing that cannot be read is skipped with a note, and a dry run changes nothing", async () => {
    const w = fakeWorld({ billing: null });
    const out = await resources.run(ctxFor(w, { dryRun: true }));
    expect(statuses(out)).toMatchObject({ billing: "skip", firestore: "dry", storage: "dry" });
    expect(w.calls).toEqual([]);
  });
});

describe("sign-in (phase 4) and authorized domains (phase 5)", () => {
  const ctxFor = (w, opts = {}) => makeCtx(makeDeps(w), { yes: true, ...opts }, { project: PROJECT });

  it("W-30 starts Authentication, turns on email and email link, limits phone codes to India, and a re-run does nothing", async () => {
    const w = fakeWorld();
    const first = await authPhase.run(ctxFor(w));
    expect(statuses(first)).toMatchObject({ "auth-start": "done", "auth-email": "done", "auth-sms": "done" });
    expect(w.emailLink).toBe(true);
    expect(w.sms).toEqual(["IN"]);
    const before = w.calls.length;
    const second = await authPhase.run(ctxFor(w));
    expect(statuses(second)).toMatchObject({ "auth-start": "ok", "auth-email": "ok", "auth-sms": "ok" });
    // Only the Google attempt may be repeated; nothing else is written.
    expect(w.calls.slice(before).every((c) => c.includes("defaultSupportedIdpConfigs"))).toBe(true);
  });

  it("W-31 when Google refuses to create its sign-in client it prints the one click-path, and says email works meanwhile", async () => {
    const out = await authPhase.run(ctxFor(fakeWorld({ authStarted: true, emailLink: true, sms: ["IN"] })));
    const g = out.find((r) => r.id === "auth-google");
    expect(g.status).toBe("manual");
    expect(g.hint).toMatch(/Authentication > Sign-in method > Google/);
    expect(g.hint).toMatch(/Email sign-in works without it/);
  });

  it("W-32 Google that the API can create is turned on; one already on is left alone", async () => {
    const w = fakeWorld({ authStarted: true, emailLink: true, sms: ["IN"], googleCanCreate: true });
    expect(statuses(await authPhase.run(ctxFor(w)))["auth-google"]).toBe("done");
    expect(statuses(await authPhase.run(ctxFor(w)))["auth-google"]).toBe("ok");
  });

  it("W-33 a dry run says what it would do and calls nothing that changes anything", async () => {
    const w = fakeWorld();
    const out = await authPhase.run(ctxFor(w, { dryRun: true }));
    expect(out[0].status).toBe("dry");
    expect(w.calls).toEqual([]);
  });

  it("W-34 authorized domains are added without removing any, and only once", async () => {
    const w = fakeWorld({ authStarted: true, domains: ["localhost", "kept.example.com"] });
    const first = await ensureDomains(ctxFor(w), ["localhost", `${PROJECT}.firebaseapp.com`, "ambika-crm.netlify.app"]);
    expect(first.status).toBe("done");
    expect(w.domains).toEqual(expect.arrayContaining(["kept.example.com", "localhost", "ambika-crm.netlify.app", `${PROJECT}.firebaseapp.com`]));
    const before = w.calls.length;
    expect((await ensureDomains(ctxFor(w), ["localhost", "ambika-crm.netlify.app"])).status).toBe("ok");
    expect(w.calls.length).toBe(before);
    expect((await domains.run(ctxFor(fakeWorld({ authStarted: true }), { dryRun: true }))).status).toMatch(/dry|ok/);
  });
});

describe("deploy (phase 6)", () => {
  const ctxFor = (w, opts = {}) => makeCtx(makeDeps(w), { yes: true, ...opts }, { project: PROJECT, apiKey: API_KEY, env: { NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${PROJECT}.firebasestorage.app` } });

  it("W-40 deploys rules and indexes only (free plan), then proves the rules are live (anonymous reads are DENIED)", async () => {
    const w = fakeWorld();
    const out = await deploy.run(ctxFor(w));
    expect(w.runs.some((r) => r.includes("deploy --only firestore --project ambikagroupscrm"))).toBe(true);
    expect(statuses(out)).toMatchObject({ deploy: "done", "rules-db": "ok" });
    expect(w.runs.some((r) => /functions|storage/.test(r.split("deploy")[1] ?? ""))).toBe(false);
  });

  it("W-41 rules that are not live (an anonymous read succeeds) are a FAIL, not a pass", async () => {
    const out = await deploy.run(ctxFor(fakeWorld({ rulesLive: false })));
    expect(statuses(out)["rules-db"]).toBe("fail");
  });

  it("W-42 a failed deploy stops with the likely causes", async () => {
    const out = await deploy.run(ctxFor(fakeWorld({ deployExit: 1 })));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "fail" });
    expect(out[0].hint).toMatch(/TTL/);
  });

  it("W-42b an indexes file that asks for TTL is refused before anything is deployed (free plan, D-51), and the repository file has none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ag-ttl-"));
    writeFileSync(join(dir, "firestore.indexes.json"), JSON.stringify({ indexes: [], fieldOverrides: [{ collectionGroup: "command_requests", fieldPath: "expireAt", ttl: true, indexes: [] }] }));
    expect(indexesWithTtl(dir)).toEqual(["command_requests.expireAt"]);
    const w = fakeWorld();
    const ctx = ctxFor(w); ctx.deps.root = dir;
    const out = await deploy.run(ctx);
    expect(out[0]).toMatchObject({ id: "indexes-ttl", status: "fail" });
    expect(w.runs).toEqual([]);
    expect(indexesWithTtl(join(import.meta.dirname, "..", "..", ".."))).toEqual([]);
  });

  it("W-43 a dry run deploys nothing", async () => {
    const w = fakeWorld();
    const out = await deploy.run(ctxFor(w, { dryRun: true }));
    expect(out[0].status).toBe("dry");
    expect(w.runs).toEqual([]);
  });
});

describe("Netlify (phase 7)", () => {
  const ctxFor = (w, opts = {}) => makeCtx(makeDeps(w), { yes: true, ...opts }, {
    project: PROJECT, apiKey: API_KEY, env: Object.fromEntries(WEB_ENV.trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])),
  });
  const wi = (w) => { w.domains = ["localhost"]; w.authStarted = true; return w; };

  it("W-50 creates the site, sets the six settings, builds in Firebase mode, adds the domain and deploys a PREVIEW only (publishing is opt-in)", async () => {
    const w = wi(fakeWorld());
    const ctx = ctxFor(w);
    const out = await netlify.run(ctx);
    expect(statuses(out)).toMatchObject({ "netlify-login": "ok", "netlify-site": "done", "netlify-env": "done", "netlify-build": "done", "netlify-preview": "done", "netlify-prod": "skip" });
    expect(Object.keys(w.netlifyEnv).sort()).toEqual(["NEXT_PUBLIC_FIREBASE_API_KEY", "NEXT_PUBLIC_FIREBASE_APP_ID", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "NEXT_PUBLIC_FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"]);
    expect(w.domains).toContain("ambika-crm.netlify.app");
    expect(w.runs.some((r) => r.includes("--prod"))).toBe(false);
    expect(ctx.deps._log.join("\n")).toContain("Link repository");
    expect(ctx.deps._log.join("\n")).toContain("15 credits");
  });

  it("W-51 --prod publishes; an existing site is reused, not created again", async () => {
    const w = wi(fakeWorld({ sites: [{ id: "site-1", name: "ambika-crm", ssl_url: "https://ambika-crm.netlify.app" }] }));
    const out = await netlify.run(ctxFor(w, { prod: true }));
    expect(statuses(out)).toMatchObject({ "netlify-site": "ok", "netlify-prod": "done" });
    expect(w.runs.some((r) => r.includes("createSite"))).toBe(false);
  });

  it("W-52 not logged in to Netlify: it starts the login; a build that fails stops before any deploy", async () => {
    const w = wi(fakeWorld({ netlifyLoggedIn: false, buildExit: 1 }));
    const out = await netlify.run(ctxFor(w));
    expect(statuses(out)["netlify-login"]).toBe("done");
    expect(statuses(out)["netlify-build"]).toBe("fail");
    expect(w.runs.some((r) => r.includes("deploy --dir"))).toBe(false);
  });

  it("W-53 settings that cannot be set stop the run with the manual route; a dry run and --skip-netlify touch nothing", async () => {
    expect(statuses(await netlify.run(ctxFor(wi(fakeWorld({ envExit: 1 })))))["netlify-env"]).toBe("fail");
    const w = wi(fakeWorld());
    expect((await netlify.run(ctxFor(w, { dryRun: true })))[0].status).toBe("dry");
    expect((await netlify.run(ctxFor(w, { skipNetlify: true })))[0].status).toBe("skip");
    expect(w.runs).toEqual([]);
  });

  it("W-54 the repo-connect click-path carries the netlify.toml values and the 15-credit reminder", () => {
    const text = CONNECT_REPO_STEPS.join("\n");
    expect(text).toContain("Ambika-Groups/CRM");
    expect(text).toContain("npm ci && npm run build:web");
    expect(text).toContain("web/out");
    expect(text).toContain("15 credits");
  });
});

describe("first owner (phase 9)", () => {
  it("W-60 prints the steps; an owner that exists is recognised; waiting is opt-in", async () => {
    const w = fakeWorld();
    const deps = makeDeps(w);
    const ctx = makeCtx(deps, { yes: true }, { project: PROJECT, ownerEmail: "business@ambikagroups.tech" });
    expect((await owner.run(ctx))[0].status).toBe("manual");
    expect(deps._log.join("\n")).toContain("Set up as the first owner");
    w.bootstrapped = true;
    expect((await owner.run(makeCtx(deps, { yes: true }, { project: PROJECT })))[0].status).toBe("ok");
  });
});

describe("the whole run: idempotent, dry-run safe, no secrets", () => {
  it("W-70 a dry run changes nothing (no write to Google, no process that changes anything) and says so", async () => {
    const w = fakeWorld({ loggedIn: false });
    const deps = makeDeps(w);
    const out = await main(["--dry-run", "--skip-netlify"], deps);
    expect(mutations(w)).toBe(0);
    expect(deps._log.join("\n")).toContain("dry run");
    expect(deps._files.get("/crm/setup-report.md")).toContain("dry run");
    expect(out.report.rows.some((r) => r.status === "dry")).toBe(true);
  });

  it("W-71 a complete run does the work, and the next run finds everything in place and changes nothing", async () => {
    const w = fakeWorld({ googleCanCreate: true });
    const deps = makeDeps(w);
    const first = await main(["--yes", "--skip-netlify"], deps);
    expect(first.ok).toBe(true);
    const calls = w.calls.length, runs = w.runs.length;
    const second = await main(["--yes", "--skip-netlify"], deps);
    expect(second.ok).toBe(true);
    // The second run may check again and re-deploy (deploy is safe to repeat) but creates and changes nothing in Google.
    const newCalls = w.calls.slice(calls).filter((c) => !c.includes("ping") && !c.includes("submitEnquiry") && !c.includes("accounts:") && !c.includes("oauth2"));
    expect(newCalls).toEqual([]);
    expect(statuses(second.report.rows)).toMatchObject({ firestore: "ok", storage: "ok", "auth-start": "ok", "auth-email": "ok", "auth-google": "ok" });
    expect(w.runs.slice(runs).filter((r) => r.includes("login") || r.includes("createSite")).length).toBe(0);
  });

  it("W-72 a step that fails stops the run and says what to do; a step that throws is a FAIL, not a crash", async () => {
    const w = fakeWorld({ db: "us-east1" });
    const out = await main(["--yes", "--skip-netlify"], makeDeps(w));
    expect(out.ok).toBe(false);
    expect(out.ctx.stoppedAt).toBe("resources");
    const rep = new Report();
    const ctx = { deps: makeDeps(), opts: {}, state: {}, report: rep, log: () => {} };
    await runPhases(ctx, [{ id: "boom", title: "Boom", run: async () => { throw new Error("it broke"); } }, { id: "after", title: "After", run: async () => result("after", "After", "ok") }]);
    expect(rep.rows.map((r) => r.status)).toEqual(["fail"]);
    expect(rep.rows[0].detail).toBe("it broke");
  });

  it("W-73 nothing secret reaches the screen or the report: keys, tokens, OAuth secrets, private keys", async () => {
    const w = fakeWorld();
    const deps = makeDeps(w);
    const r = new Report([API_KEY]);
    r.add(result("x", "Leak test", "fail", `key ${API_KEY} token ${SECRET_TOKEN} refresh 1//0gABCDEFGHIJKLMNOPQRSTU secret GOCSPX-abcdef123456 agw_ABCDEFGHIJKLM re_abcdefghijklmnop12345`, `use ${API_KEY}`));
    const md = r.toMarkdown({ project: PROJECT });
    for (const s of [API_KEY, SECRET_TOKEN, "1//0gABC", "GOCSPX-abc", "agw_ABCD", "re_abcdefghij"]) expect(md).not.toContain(s);
    expect(scrub('{"private_key": "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----"}')).not.toContain("BEGIN PRIVATE");
    // And through the real run.
    const out = await main(["--yes", "--skip-netlify"], deps);
    const report = deps._files.get("/crm/setup-report.md");
    expect(report).not.toContain(API_KEY);
    expect(report).not.toContain(SECRET_TOKEN);
    expect(deps._log.join("\n")).not.toContain(SECRET_TOKEN);
    expect(out.report.rows.length).toBeGreaterThan(5);
  });

  it("W-74 the command line: flags are read, and the honest limits are printed on screen", async () => {
    expect(parseArgs(["--dry-run", "--only", "preflight,login", "--site-name", "x", "--prod", "--wait-owner", "-y"])).toMatchObject({ dryRun: true, only: ["preflight", "login"], siteName: "x", prod: true, waitOwner: true, yes: true });
    const deps = makeDeps();
    await main(["--dry-run", "--only", "preflight"], deps);
    const text = deps._log.join("\n");
    expect(text).toContain("cannot do for you");
    expect(text).toContain("Blaze");
    expect(text).toContain("sign-in client");
    expect(ALL_PHASES.map((p) => p.id)).toEqual(["preflight", "login", "resources", "auth", "domains", "deploy", "netlify", "verify", "owner"]);
    expect(Object.keys(LABEL)).toContain("manual");
  });
});
