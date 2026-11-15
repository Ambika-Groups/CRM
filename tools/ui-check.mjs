// UI check harness for the demo-mode build (no Firebase, no Java).
// Usage: node tools/ui-check.mjs <jobs.json> <outDir>
//   jobs.json: { "jobs": [ { "path": "/", "name": "home", "width": 390, "theme": "light", "role": "uOwner",
//                            "lang": "en", "shot": true, "state": "menu", "action": "js", "clip": "css", "viewport": true } ] }
// Serves web/out on a local port, drives headless Chrome over the DevTools protocol, and for each job:
//   - checks there is no horizontal page overflow (and lists offending elements),
//   - fails a job whose page didn't render the app shell (a 404 or a crash),
//   - fails a job if any request returns 4xx/5xx or fails (Netlify bills every one, QA F5); a job may set
//     "mainStatus": 404 when the page itself is the not-found page,
//   - checks the theme applied is the job's theme ("expectTheme" when the job itself changes it),
//   - "throttle": "4g" loads cold (no cache) at 150 ms latency, 1.6 Mbps down, 750 kbps up, CPU slowed 4× (QA N12),
//   - "offline": "action" takes the network offline before "action"; "action-then-online" brings it back before "expect",
//   - "reload": reloads the page after "action" so "expect" checks the change was saved (save → reload → still there),
//   - runs the job's "expect" (a JS expression run after "action"; it must return true, or a string saying what failed),
//   - runs axe-core and records violations by impact,
//   - greps the rendered text (and accessible names, titles, placeholders) for developer jargon: "§" or a milestone name like "M1.2",
//   - measures load timing (DOMContentLoaded and app-ready),
//   - optionally saves a screenshot named <name>-<width>-<theme>[-<state>].png.
// Writes <outDir>/ui-check-raw.json and prints a summary. Exit code 1 if any check fails.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createGzip } from "node:zlib";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const [, , jobsFile, outDir] = process.argv;
if (!jobsFile || !outDir) { console.error("Usage: node tools/ui-check.mjs <jobs.json> <outDir>"); process.exit(2); }
const { jobs } = JSON.parse(readFileSync(jobsFile, "utf8"));
const root = resolve(process.env.UI_ROOT ?? "web/out");
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.UI_PORT ?? 4321);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9334);
mkdirSync(join(outDir, "ui"), { recursive: true });

// ---------- static server for web/out (trailing-slash pages → index.html) ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = join(root, p);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) { file = join(root, "404.html"); res.statusCode = 404; }
  res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
  // Compress text the way Netlify does (gzip here; Netlify also offers Brotli), so throttled timings are realistic.
  if (/gzip/.test(req.headers["accept-encoding"] ?? "") && /\.(html|js|css|json|txt|webmanifest|svg)$/.test(file)) {
    res.setHeader("Content-Encoding", "gzip");
    createReadStream(file).pipe(createGzip()).pipe(res);
    return;
  }
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const profile = mkdtempSync(join(tmpdir(), "ag-ui-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars",
  "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpJson(path, method = "GET") {
  for (let i = 0; i < 60; i++) {
    try { return await (await fetch(`http://127.0.0.1:${CDP_PORT}${path}`, { method })).json(); } catch { await sleep(200); }
  }
  throw new Error("Chrome did not start");
}
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0; const pending = new Map();
const handlers = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method && handlers.has(m.method)) for (const fn of handlers.get(m.method)) fn(m.params);
  };
  const ready = new Promise((r) => (ws.onopen = r));
  return { ready, on: (method, fn) => handlers.set(method, [...(handlers.get(method) ?? []), fn]), send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }), close: () => ws.close() };
}
const evalJs = async (cdp, expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
// Actions and expects get 30 s each, so one stuck job can't stall a run; a timeout fails that job.
const evalJsLimited = (cdp, expression, ms = 30_000) => Promise.race([evalJs(cdp, expression), sleep(ms).then(() => "timed out after 30 s")]);

const report = [];
let failures = 0;
try {
  for (const job of jobs) {
    // Watchdog (90 s): a job whose page stops answering is closed and recorded as failed, and the run goes on.
    let targetId = null;
    const runJob = async () => {
    // A fresh target per job keeps storage (role, theme, language) isolated.
    const target = await cdpJson("/json/new?about:blank", "PUT");
    targetId = target.id;
    const cdp = connect(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    const failed = [];
    const mainUrl = `http://127.0.0.1:${PORT}${job.path}`;
    const urls = new Map();
    cdp.on("Network.requestWillBeSent", (e) => urls.set(e.requestId, e.request.url));
    cdp.on("Network.responseReceived", (e) => {
      if (e.response.status < 400) return;
      if (e.type === "Document" && e.response.url === mainUrl && e.response.status === job.mainStatus) return;
      if (job.allowFailed?.some((p) => e.response.url.includes(p))) return; // for example Google's own answers when a project is half set up
      failed.push(`${e.response.status} ${e.response.url.replace(`http://127.0.0.1:${PORT}`, "")}`);
    });
    cdp.on("Network.loadingFailed", (e) => { if (!e.canceled && !/INTERNET_DISCONNECTED/.test(e.errorText) && !job.allowFailed?.some((p) => (urls.get(e.requestId) ?? "").includes(p))) failed.push(`failed ${(urls.get(e.requestId) ?? "").replace(`http://127.0.0.1:${PORT}`, "")} ${e.errorText}`); });
    await cdp.send("Network.enable");
    const mobile = job.width < 600;
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: job.width, height: job.height ?? 900, deviceScaleFactor: 1, mobile });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: job.theme }] });
    const pre = `try{localStorage.setItem('ag-theme',${JSON.stringify(job.theme)});localStorage.setItem('ag-demo-uid',${JSON.stringify(job.role ?? "uOwner")});localStorage.setItem('ag-lang',${JSON.stringify(job.lang ?? "en")});localStorage.setItem('ag-nav-collapsed',${JSON.stringify(job.collapsed ? "1" : "0")});}catch(e){}`;
    const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: pre });
    if (job.throttle === "4g") {
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    const t0 = Date.now();
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}${job.path}` });
    let readyMs = null;
    for (let i = 0; i < 160; i++) {
      if (await evalJs(cdp, "document.documentElement.dataset.ready==='1' && document.fonts.status==='loaded'")) { readyMs = Date.now() - t0; break; }
      await sleep(125);
    }
    await sleep(250);
    // "keepThrottle": stay on 4G through the expect, so it can time content that renders after the ready signal.
    const unthrottle = async () => { await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }); };
    if (job.throttle === "4g" && !job.keepThrottle) await unthrottle();
    if (job.offline) {
      await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await sleep(300);
    }
    if (job.action) { const a = await evalJsLimited(cdp, `(async()=>{${job.action}})()`); if (a === "timed out after 30 s") job.actionTimedOut = true; await sleep(350); }
    if (job.offline === "action-then-online") {
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await sleep(1500);
    }
    // "reload": reload the page after the action, so "expect" proves the change survived (QA N1).
    if (job.reload) {
      await sleep(job.reloadDelay ?? 0);
      await cdp.send("Page.reload", { ignoreCache: false });
      for (let i = 0; i < 160; i++) {
        await sleep(125);
        if (await evalJs(cdp, "document.readyState===complete && document.documentElement.dataset.ready===1")) break;
      }
      await sleep(400);
    }
    // Lazy dashboard cards (data-lazy-pending) mount when scrolled near; reveal them all before the checks.
    if (!job.noReveal) await evalJsLimited(cdp, `(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<40&&document.querySelector('[data-lazy-pending]');i++){document.querySelector('[data-lazy-pending]').scrollIntoView({block:'center'});await w(150);}scrollTo(0,0);await w(document.querySelector('[data-chart]')?600:0);return true})()`).catch(() => {});
    const nav = await evalJs(cdp, "(()=>{const n=performance.getEntriesByType('navigation')[0];return n?{dcl:Math.round(n.domContentLoadedEventEnd),load:Math.round(n.loadEventEnd)}:null})()");
    const layout = await evalJs(cdp, `(() => {
      const vw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth, offenders = [];
      document.querySelectorAll('body *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || r.right <= vw + 0.5) return;
        let p = el.parentElement, scrolls = false;
        while (p) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX)) { scrolls = true; break; } p = p.parentElement; }
        if (!scrolls) offenders.push(el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '') + ' →' + Math.round(r.right));
      });
      return { vw, sw, overflow: sw > vw, offenders: offenders.slice(0, 8), height: document.documentElement.scrollHeight,
        fonts: document.fonts.check('16px "Inter"') && document.fonts.check('600 28px "Inter Tight"'), theme: document.documentElement.dataset.theme, lang: document.documentElement.lang,
        title: document.title, appShell: !!document.querySelector('main#main') && !!document.querySelector('.topbar') };
    })()`);
    let expectResult = true;
    if (job.expect) {
      try { expectResult = await evalJsLimited(cdp, `(async()=>{${job.expect}})()`); if (job.actionTimedOut && expectResult === true) expectResult = "action timed out"; } catch (e) { expectResult = String(e.message ?? e); }
      if (expectResult === undefined) expectResult = "expect returned nothing";
    }
    if (job.throttle === "4g" && job.keepThrottle) await unthrottle();
    const jargon = await evalJs(cdp, `(() => {
      const bits = [document.title, document.body.innerText];
      document.querySelectorAll('[aria-label],[title],[placeholder],[alt]').forEach(e => bits.push(e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder'), e.getAttribute('alt')));
      const hits = [];
      for (const b of bits) { if (!b) continue; for (const m of b.matchAll(/§|\bM\d\.\d?/g)) hits.push(b.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, ' ')); }
      return hits.slice(0, 5);
    })()`);
    await evalJs(cdp, axeSource);
    const axe = await evalJs(cdp, `axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })))`);
    let file = null;
    if (job.shot) {
      if (!job.viewport) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: job.width, height: Math.min(layout.height, 12000), deviceScaleFactor: 1, mobile });
        await sleep(300);
      }
      let params = { format: "png" };
      if (job.clip) {
        const r = await evalJs(cdp, `(()=>{const e=document.querySelector(${JSON.stringify(job.clip)});if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:Math.max(0,b.left+scrollX-8),y:Math.max(0,b.top+scrollY-8),width:b.width+16,height:b.height+16}})()`);
        if (r) params = { format: "png", clip: { ...r, scale: 1 }, captureBeyondViewport: true };
      }
      const shot = await cdp.send("Page.captureScreenshot", params);
      file = `${job.name}-${job.width}-${job.theme}${job.state ? "-" + job.state : ""}.png`;
      writeFileSync(join(outDir, "ui", file), Buffer.from(shot.data, "base64"));
    }
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    const serious = axe.filter((v) => v.impact === "serious" || v.impact === "critical");
    const pass = layout.overflow === false && serious.length === 0 && readyMs !== null && layout.theme === (job.expectTheme ?? job.theme) && jargon.length === 0 && (layout.appShell || job.noShell) && failed.length === 0 && expectResult === true && (job.maxReadyMs == null || (readyMs !== null && readyMs <= job.maxReadyMs));
    if (!pass) failures++;
    report.push({ name: job.name, path: job.path, role: job.role ?? "uOwner", lang: job.lang ?? "en", state: job.state ?? null, width: job.width,
      theme: job.theme, pass, readyMs, nav, ...layout, jargon, failedRequests: failed, expect: job.expect ? expectResult : null, axe, file });
    cdp.close();
    await cdpJson(`/json/close/${target.id}`).catch(() => {});
    };
    const outcome = await Promise.race([runJob().then(() => "ok"), sleep(90_000).then(() => "stalled")]);
    if (outcome === "stalled") {
      failures++;
      report.push({ name: job.name, path: job.path, role: job.role ?? "uOwner", lang: job.lang ?? "en", state: job.state ?? null, width: job.width, theme: job.theme, pass: false, stalled: true, readyMs: null, nav: null, overflow: null, offenders: [], jargon: [], failedRequests: ["job stalled (90 s watchdog)"], expect: "stalled", axe: [], file: null });
      if (targetId) await cdpJson(`/json/close/${targetId}`).catch(() => {});
    }
  }
} finally {
  chrome.kill();
  server.close();
}
writeFileSync(join(outDir, "ui-check-raw.json"), JSON.stringify(report, null, 1));
const byImpact = {};
for (const r of report) for (const v of r.axe) byImpact[v.impact] = (byImpact[v.impact] ?? 0) + 1;
console.log(`Jargon hits: ${report.reduce((n, r) => n + r.jargon.length, 0)}`);
console.log(`Failed requests: ${report.reduce((n, r) => n + r.failedRequests.length, 0)}`);
console.log(`Interactive checks: ${report.filter((r) => r.expect === true).length} passed of ${report.filter((r) => r.expect !== null).length}`);
console.log(`UI checks: ${report.length - failures} passed, ${failures} failed (of ${report.length}). axe violations by impact: ${JSON.stringify(byImpact)}`);
for (const r of report.filter((x) => !x.pass)) console.log(`  FAIL ${r.name} ${r.width} ${r.theme} ${r.role}: overflow=${r.overflow} ready=${r.readyMs} theme=${r.theme} shell=${r.appShell} axe=${r.axe.map((v) => v.id + ":" + v.impact).join(",")} jargon=${JSON.stringify(r.jargon)} failed=${JSON.stringify(r.failedRequests.slice(0, 5))} expect=${JSON.stringify(r.expect)} ${r.offenders.join(" ")}`);
process.exit(failures ? 1 : 0);
