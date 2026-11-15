// Before every push: do any of this machine's real secret values appear in what is staged for commit? Prints NAMES and COUNTS
// only, never a value. The values it knows about come from the private files that must never be committed:
// web/.env.local, functions/.env, and any file named on the command line (for example the moved-aside website file).
// Also looks for the shapes of keys and tokens, and for private files that should not be staged.
//   node tools/secret-scan.mjs [extra-file-with-secrets ...]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const git = (args) => spawnSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).stdout.split(/\r?\n/).filter(Boolean);
let problems = 0;
const bad = (m) => { problems++; console.log(`  PROBLEM  ${m}`); };

// 1. Private files that must never be committed.
const FORBIDDEN = [/(^|\/)\.env($|\.)(?!example)/, /(^|\/)\.env\.local$/, /service-account/i, /-adminsdk-/i, /\.pem$/, /\.p12$/, /setup-report\.md$/, /node_modules\//, /(^|\/)out(-firebase)?\//, /(^|\/)\.next\//, /moved-aside/i, /(^|\/)lib\/index\.js/];
for (const f of staged) if (FORBIDDEN.some((re) => re.test(f)) && !/\.env\.example$/.test(f)) bad(`a private or generated file is staged: ${f}`);

// 2. Real values from the private files, searched in the staged content.
// Values that are public by design (the project address, the owner address written in the rules) may appear in docs.
const PUBLIC_NAMES = /(PROJECT_ID|AUTH_DOMAIN|STORAGE_BUCKET|OWNER_EMAIL|SITE_URL|ENQUIRY_ENDPOINT)$/;
const files = ["web/.env.local", "functions/.env", ...process.argv.slice(2)].filter((f) => existsSync(f));
const names = [];
for (const f of files) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (value.length < 8 || PUBLIC_NAMES.test(m[1])) continue;
    names.push(m[1]);
    const hit = git(["grep", "--cached", "-F", "-l", "-e", value]);
    const where = hit.stdout.split(/\r?\n/).filter(Boolean);
    if (where.length) bad(`the value of ${m[1]} (${value.length} characters, from ${f}) appears in staged file(s): ${where.slice(0, 3).join(", ")}`);
  }
}
console.log(`  checked ${names.length} private values (${[...new Set(names)].join(", ") || "none"}) against ${staged.length} staged files`);

// 3. The shapes of keys and tokens.
const SHAPES = [
  ["a Google API key", "AIza[0-9A-Za-z_-]{35}"], ["a Google access token", "ya29\\.[0-9A-Za-z_-]{20,}"], ["a Google OAuth secret", "GOCSPX-[0-9A-Za-z_-]{10,}"],
  ["a private key block", "-----BEGIN [A-Z ]*PRIVATE KEY-----"], ["a Netlify token", "nfp_[0-9A-Za-z]{20,}"], ["a Resend key", "\\bre_[0-9A-Za-z]{20,}"], ["the website key", "agw_[0-9A-Za-z_-]{20,}"],
];
for (const [what, re] of SHAPES) {
  const hit = git(["grep", "--cached", "-E", "-l", "-e", re]).stdout.split(/\r?\n/).filter(Boolean)
    // test fixtures and docs hold obviously fake examples; those are listed so a human can confirm
    // the job files hold obviously fake example keys (repeated letters), used to test the Setup page
    .filter((f) => !/(^|\/)(test|tests)\//.test(f) && !/\.test\.(ts|mjs)$/.test(f) && !/^tools\/jobs\//.test(f));
  if (hit.length) bad(`looks like ${what} in: ${hit.slice(0, 4).join(", ")}`);
}
console.log(problems ? `\nSECRET SCAN: ${problems} problem(s). Do not push.` : "\nSECRET SCAN: clean.");
process.exit(problems ? 1 : 0);
