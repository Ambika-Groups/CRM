// `npm run setup`: puts the CRM live on your own Firebase project and Netlify site, doing the work wherever Google and
// Netlify allow a script to, checking each step, and telling you plainly what only you can do. It can be run again
// and again (each step reads the current state and does only what is missing) and it never deletes or overwrites data.
//
//   npm run setup                 the full wizard (asks only what it must)
//   npm run setup -- --dry-run    shows what it would do, changes nothing
//   npm run setup -- --yes        no questions (needs OWNER_EMAIL and web/.env.local already in place)
//   npm run setup -- --only preflight,login   run just those phases
//   other flags: --skip-netlify  --prod  --site-name <name>  --site-id <id>  --url <https://site>  --wait-owner  --owner-email <email>
import { realDeps } from "./deps.mjs";
import { ALL_PHASES, loadState } from "./phases.mjs";
import { Report, runPhases, secretValues, parseEnv } from "./lib.mjs";

export const LIMITS = [
  "What this tool cannot do for you (it will tell you when it gets there):",
  "  - Log in to Google: one browser click, which only you can give.",
  "  - Switch on the pay-as-you-go (Blaze) plan and set the ₹100 budget alert: they need your card.",
  "  - Create Google's sign-in client: Google does not let a script do it (one click in the Firebase console).",
  "  - Connect the GitHub repository to Netlify: that is a browser approval. This tool deploys from this computer;",
  "    the last step prints the click-path for push-to-deploy.",
  "  - Create the App Check reCAPTCHA site (optional, never blocks anything).",
];

export function parseArgs(argv) {
  const o = { dryRun: false, yes: false, skipNetlify: false, prod: false, waitOwner: false };
  const val = (i) => argv[i + 1];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--yes" || a === "-y") o.yes = true;
    else if (a === "--skip-netlify") o.skipNetlify = true;
    else if (a === "--prod") o.prod = true;
    else if (a === "--wait-owner") o.waitOwner = true;
    else if (a === "--only") o.only = String(val(i++)).split(",");
    else if (a === "--site-name") o.siteName = val(i++);
    else if (a === "--site-id") o.siteId = val(i++);
    else if (a === "--url") o.url = val(i++);
    else if (a === "--owner-email") o.ownerEmail = val(i++);
    else if (a === "--report") o.report = val(i++);
    else if (a === "--help" || a === "-h") o.help = true;
  }
  return o;
}

/** Runs the wizard with the given dependencies (the tests pass mocks). Returns { report, ctx, ok }. */
export async function main(argv, deps = realDeps(), phases = ALL_PHASES) {
  const opts = parseArgs(argv);
  const log = deps.log ?? console.log;
  if (opts.help) { log(LIMITS.join("\n")); return { ok: true }; }
  // Known secret values (from the web settings and the environment) can never reach the screen or the report.
  const envFile = deps.path.join(deps.root, "web", ".env.local");
  const known = (await deps.fs.exists(envFile)) ? secretValues(parseEnv(await deps.fs.read(envFile))) : [];
  const report = new Report(known);
  const ctx = { deps, opts, state: {}, report, log: (s) => log(report.rows ? s : s), only: opts.only };
  log(`CRM setup${opts.dryRun ? " (dry run: nothing will be changed)" : ""}`);
  log("=".repeat(60));
  for (const l of LIMITS) log(l);
  if (opts.only && !opts.only.includes("preflight")) await loadState(ctx);
  await runPhases(ctx, phases);
  const failed = report.failed.length;
  const manual = report.manual.length;
  log("\n" + "=".repeat(60));
  log(failed ? `${failed} step(s) failed. Fix what is marked [FAIL] and run  npm run setup  again: it continues where it stopped.`
    : manual ? `Done, except ${manual} step(s) only you can do (marked [MANUAL]). Do them, then run  npm run setup  again to re-check.`
      : opts.dryRun ? "Dry run finished. Nothing was changed. Run  npm run setup  to do it for real." : "Everything that could be checked is in place.");
  const reportFile = deps.path.join(deps.root, opts.report ?? "setup-report.md");
  await deps.fs.write(reportFile, report.toMarkdown({ project: ctx.state.project, dryRun: opts.dryRun, ready: ctx.state.ready }));
  log(`Report written to ${opts.report ?? "setup-report.md"} (it holds no passwords, keys or tokens).`);
  return { report, ctx, ok: failed === 0 };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("tools/setup/index.mjs")) {
  const { ok } = await main(process.argv.slice(2));
  process.exit(ok ? 0 : 1);
}
