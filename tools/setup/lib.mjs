// Shared pieces of `npm run setup` (the go-live wizard): result shapes, the report (which never holds a secret), the
// phase runner, and small helpers. Everything that touches the outside world (network, processes, files, questions) is
// passed in as `deps`, so the tests can run every phase against mocks and the dry run can show what would happen.

/** @typedef {"ok"|"done"|"fail"|"manual"|"skip"|"dry"} Status
 *  ok: already fine, nothing to do.  done: the wizard did it.  fail: could not (a plain fix is given).
 *  manual: only the user can do it (billing, a login, an OAuth client): the exact click-path is given.
 *  skip: not applicable or left out on request.  dry: dry run, what would have been done. */

export const LABEL = { ok: "[ok]    ", done: "[DONE]  ", fail: "[FAIL]  ", manual: "[MANUAL]", skip: "[skip]  ", dry: "[DRY]   " };

/** Things that look like secrets are removed from anything written to the screen or the report. */
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{35}/g,                 // Google API keys
  /ya29\.[0-9A-Za-z_-]+/g,                   // Google access tokens
  /1\/\/[0-9A-Za-z_-]{20,}/g,                // Google refresh tokens
  /GOCSPX-[0-9A-Za-z_-]+/g,                  // Google OAuth client secrets
  /agw_[0-9A-Za-z_-]{10,}/g,                 // the website's key
  /re_[0-9A-Za-z_-]{16,}/g,                  // Resend keys
  /nfp_[0-9A-Za-z]{20,}/g,                   // Netlify personal tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /("private_key"\s*:\s*")[^"]+/g,
];

export function scrub(text, extra = []) {
  let s = String(text ?? "");
  for (const p of SECRET_PATTERNS) s = s.replace(p, (m, g1) => (g1 ? `${g1}<hidden>` : "<hidden>"));
  for (const v of extra) if (v && String(v).length >= 8) s = s.split(String(v)).join("<hidden>");
  return s;
}

/** The values from web/.env.local and the like that must never appear in output. */
export function secretValues(env) {
  return Object.entries(env ?? {}).filter(([k]) => /KEY|SECRET|TOKEN|PASSWORD/i.test(k)).map(([, v]) => v);
}

export const result = (id, title, status, detail = "", hint = "") => ({ id, title, status, detail, hint });

export class Report {
  constructor(extraSecrets = []) { this.rows = []; this.extra = extraSecrets; this.started = new Date(); }
  add(r) { this.rows.push({ ...r, detail: scrub(r.detail, this.extra), hint: scrub(r.hint, this.extra) }); return r; }
  get failed() { return this.rows.filter((r) => r.status === "fail"); }
  get manual() { return this.rows.filter((r) => r.status === "manual"); }
  /** The report file: what was checked and done, with hints. No values, no tokens, no keys. */
  toMarkdown({ project, dryRun, ready } = {}) {
    const lines = [
      "# CRM setup report", "",
      `Run: ${this.started.toISOString()}${dryRun ? " (dry run: nothing was changed)" : ""}`,
      project ? `Project: ${project}` : "",
      ready === undefined ? "" : `Result: **${ready ? "READY" : "NOT READY"}**`, "",
      "| Step | Result | What happened |", "|---|---|---|",
    ].filter((l, i) => l !== "" || i === 1);
    for (const r of this.rows) {
      const what = [r.detail, r.hint ? `Fix: ${r.hint}` : ""].filter(Boolean).join(" ").replace(/\|/g, "/").replace(/\n/g, " ");
      lines.push(`| ${r.title} | ${LABEL[r.status].trim()} | ${what} |`);
    }
    lines.push("", "This report holds no passwords, keys or tokens.");
    return lines.join("\n") + "\n";
  }
}

/** Prints a phase result as it happens, in plain words. */
export function show(log, r) {
  log(`${LABEL[r.status]} ${r.title}${r.detail ? `: ${r.detail}` : ""}`);
  if (r.hint) log(`           -> ${r.hint}`);
}

/**
 * Runs phases in order. A phase returns one result or a list. A `fail` stops the run (later phases depend on it) unless the
 * phase is marked `soft`. A phase that throws is reported as a fail with its message, never as a crash.
 */
export async function runPhases(ctx, phases) {
  for (const phase of phases) {
    if (ctx.only && !ctx.only.includes(phase.id)) { ctx.report.add(result(phase.id, phase.title, "skip", "left out on request")); continue; }
    ctx.log(`\n${phase.title}`);
    let out;
    try { out = await phase.run(ctx); } catch (e) { out = result(phase.id, phase.title, "fail", String(e?.message ?? e), "Run npm run setup again; it picks up where it stopped."); }
    const list = Array.isArray(out) ? out : [out];
    for (const r of list) { ctx.report.add(r); show(ctx.log, r); }
    if (list.some((r) => r.status === "fail") && !phase.soft) { ctx.stoppedAt = phase.id; break; }
  }
  return ctx.report;
}

/** Read a KEY=VALUE file into an object (no printing). Missing file gives null. */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export const FIREBASE_ENV = ["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "STORAGE_BUCKET", "MESSAGING_SENDER_ID", "APP_ID"].map((n) => `NEXT_PUBLIC_FIREBASE_${n}`);

export const consoleUrl = (project, path = "") => `https://console.firebase.google.com/project/${project}${path ? `/${path}` : ""}`;

/** Wait for `fn` to return a truthy value, trying every `everyMs` up to `times`. Injected sleep keeps tests fast. */
export async function poll(fn, { times = 20, everyMs = 3000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < times; i++) {
    const v = await fn(i);
    if (v) return v;
    if (i < times - 1) await sleep(everyMs);
  }
  return null;
}
