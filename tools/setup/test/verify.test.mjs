// verify:live against a fake published site and a fake Google. IDs V-xxx are cited in docs/prd-traceability.md.
import { describe, expect, it } from "vitest";
import { formatTable, verifyLive } from "../verify-live.mjs";
import { API_KEY, PROJECT, fakeWorld, makeDeps, res } from "./helpers.mjs";

const SECURITY = {
  "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY",
  "strict-transport-security": "max-age=31536000; includeSubDomains", "content-security-policy": "default-src 'self'; script-src 'self' https://www.google.com/recaptcha/; frame-ancestors 'none'",
};

/** A fake published CRM: its pages, headers, scripts, 404 page and the sign-in proxy. */
function site({ demo = false, headers = true, siteKey = false, proxy = true, notFound = true } = {}) {
  const hdr = headers ? SECURITY : {};
  const page = `<html><head><script src="/_next/static/chunks/main.js"></script></head><body></body></html>`;
  return (u) => {
    const p = u.pathname;
    if (p === "/_next/static/chunks/main.js") return res(200, `var cfg={projectId:${demo ? '""' : '"' + PROJECT + '"'}};${siteKey ? ' var key="6L' + "a".repeat(38) + '";' : ""}`, hdr);
    if (p === "/__/auth/handler") return proxy ? res(200, "<html>auth</html>", hdr) : res(404, "not found", hdr);
    if (p === "/__/firebase/init.json") return proxy ? res(200, { projectId: PROJECT }, hdr) : res(404, "", hdr);
    if (p === "/no-such-page-check/") return notFound ? res(404, "<html>Page not found</html>", hdr) : res(200, page, hdr);
    return res(200, page, hdr);
  };
}

const cfg = { project: PROJECT, apiKey: API_KEY, bucket: `${PROJECT}.firebasestorage.app` };
const setup = (siteOpts, world = {}, host = "ambika-crm.netlify.app") => {
  const w = fakeWorld({ authStarted: true, google: true, domains: ["localhost", host.replace(/:\d+$/, "")], ...world });
  w.site = site(siteOpts);
  return { w, deps: makeDeps(w), url: host.startsWith("127") ? `http://${host}` : `https://${host}` };
};
const row = (v, id) => v.rows.find((r) => r.id === id);

describe("verify:live (phase 8)", () => {
  it("V-01 a correctly published site is READY: pages, headers, proxy, config, providers, rules, functions, domain", async () => {
    const { deps, url } = setup();
    const v = await verifyLive(url, deps, cfg);
    expect(v.rows.filter((r) => r.required).map((r) => `${r.id}:${r.status}`)).toEqual(expect.arrayContaining(["pages:ok", "notfound:ok", "headers:ok", "config:ok", "proxy:ok", "providers:ok", "domain:ok", "rules-db:ok", "rules-storage:ok", "functions:ok"]));
    expect(v.ready).toBe(true);
    expect(formatTable(v.rows, v.ready)).toContain("READY");
    expect(formatTable(v.rows, v.ready)).not.toContain("NOT READY");
  });

  it("V-02 a site built without the Firebase settings (it would open as the demo) is NOT READY, with the fix", async () => {
    const { deps, url } = setup({ demo: true });
    const v = await verifyLive(url, deps, cfg);
    expect(v.ready).toBe(false);
    expect(row(v, "config")).toMatchObject({ status: "fail" });
    expect(row(v, "config").hint).toMatch(/NEXT_PUBLIC_FIREBASE_/);
  });

  it("V-03 App Check is optional: not set is reported as such and never affects READY; set is reported ok", async () => {
    const off = await verifyLive(...(() => { const s = setup(); return [s.url, s.deps, cfg]; })());
    expect(row(off, "appcheck")).toMatchObject({ status: "skip", required: false });
    expect(row(off, "appcheck").detail).toMatch(/optional, not set/);
    expect(off.ready).toBe(true);
    const s2 = setup({ siteKey: true });
    const on = await verifyLive(s2.url, s2.deps, cfg);
    expect(row(on, "appcheck").status).toBe("ok");
    expect(on.ready).toBe(true);
  });

  it("V-04 missing security headers, a missing proxy and a missing 404 page are each named", async () => {
    const { deps, url } = setup({ headers: false, proxy: false, notFound: false });
    const v = await verifyLive(url, deps, cfg);
    expect(row(v, "headers").status).toBe("fail");
    expect(row(v, "headers").detail).toMatch(/Content-Security-Policy/);
    expect(row(v, "proxy").status).toBe("fail");
    expect(row(v, "notfound").status).toBe("fail");
    expect(v.ready).toBe(false);
  });

  it("V-05 rules that are open, functions that are down, Authentication not started and an unauthorized domain each make it NOT READY", async () => {
    expect(row(await verifyLive(...(() => { const s = setup({}, { rulesLive: false }); return [s.url, s.deps, cfg]; })()), "rules-db").status).toBe("fail");
    expect(row(await verifyLive(...(() => { const s = setup({}, { functionsLive: false }); return [s.url, s.deps, cfg]; })()), "functions").status).toBe("fail");
    const noAuth = await verifyLive(...(() => { const s = setup({}, { authStarted: false, google: false }); return [s.url, s.deps, cfg]; })());
    expect(row(noAuth, "providers")).toMatchObject({ status: "fail" });
    expect(row(noAuth, "providers").detail).toMatch(/not been started/);
    const wrongDomain = await verifyLive(...(() => { const s = setup({}, { domains: ["localhost"] }); return [s.url, s.deps, cfg]; })());
    expect(row(wrongDomain, "domain")).toMatchObject({ status: "fail" });
    expect(row(wrongDomain, "domain").hint).toMatch(/Authorized domains/);
    expect(wrongDomain.ready).toBe(false);
  });

  it("V-06 on a local server the Netlify-only checks (headers, proxy) are skipped, not failed", async () => {
    const { deps, url } = setup({}, {}, "127.0.0.1:3100");
    const v = await verifyLive(url, deps, cfg);
    expect(row(v, "headers").status).toBe("skip");
    expect(row(v, "proxy").status).toBe("skip");
    expect(v.ready).toBe(true);
  });

  it("V-07 the sign-in screen is checked in a real browser when one is installed: sign-in is READY, the demo is NOT", async () => {
    const good = setup({}, { chromePath: "/chrome", dom: '<button data-google>Continue with Google</button>' });
    expect(row(await verifyLive(good.url, good.deps, cfg), "screen").status).toBe("ok");
    const demo = setup({}, { chromePath: "/chrome", dom: '<div class="demo-banner"><select data-role-switcher></select></div>' });
    const d = await verifyLive(demo.url, demo.deps, cfg);
    expect(row(d, "screen").status).toBe("fail");
    expect(d.ready).toBe(false);
    const none = setup();
    expect(row(await verifyLive(none.url, none.deps, cfg), "screen").status).toBe("skip");
  });

  it("V-08 the table never contains a key", async () => {
    const { deps, url } = setup();
    const v = await verifyLive(url, deps, cfg);
    expect(formatTable(v.rows, v.ready)).not.toContain(API_KEY);
  });
});
