// Creates web/.env.local from a file that holds the Firebase web config, copying ONLY the six NEXT_PUBLIC_FIREBASE_*
// settings (and NEXT_PUBLIC_RECAPTCHA_SITE_KEY if present). Nothing else in that file is read into the CRM. If the
// messaging sender ID is missing it is worked out from the app ID (1:<senderId>:web:<id>). Values are never printed:
// only names, lengths and whether each looks right.
// Usage: node tools/make-env-local.mjs <file-with-the-config> [--force]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [, , source, flag] = process.argv;
if (!source) { console.error("Usage: node tools/make-env-local.mjs <file-with-the-config> [--force]"); process.exit(2); }
const target = fileURLToPath(new URL("../web/.env.local", import.meta.url));
if (existsSync(target) && flag !== "--force") { console.error("web/.env.local already exists. Use --force to replace it."); process.exit(1); }

const NAMES = [
  ["NEXT_PUBLIC_FIREBASE_API_KEY", /^AIza[A-Za-z0-9_-]{35}$/],
  ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", /^[a-z0-9.-]+\.[a-z]{2,}$/],
  ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/],
  ["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", /^[a-z0-9.-]+\.(appspot\.com|firebasestorage\.app)$/],
  ["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", /^[0-9]{8,16}$/],
  ["NEXT_PUBLIC_FIREBASE_APP_ID", /^1:[0-9]+:web:[0-9a-f]+$/],
];

const read = {};
for (const line of readFileSync(resolve(source), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) read[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!read.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID && read.NEXT_PUBLIC_FIREBASE_APP_ID) {
  const sender = read.NEXT_PUBLIC_FIREBASE_APP_ID.split(":")[1];
  if (sender) { read.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = sender; console.log("  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: worked out from the app ID");
  }
}

let bad = 0;
const out = ["# Written by tools/make-env-local.mjs. Public web settings for your Firebase project; this file is never committed."];
for (const [name, pattern] of NAMES) {
  const v = read[name] ?? "";
  const ok = pattern.test(v);
  if (!ok) bad++;
  console.log(`  ${ok ? "ok     " : "PROBLEM"} ${name}: ${v ? `${v.length} characters` : "missing"}${v && !ok ? ", does not look right" : ""}`);
  out.push(`${name}=${v}`);
}
if (read.NEXT_PUBLIC_RECAPTCHA_SITE_KEY) { out.push(`NEXT_PUBLIC_RECAPTCHA_SITE_KEY=${read.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}`); console.log(`  ok      NEXT_PUBLIC_RECAPTCHA_SITE_KEY: ${read.NEXT_PUBLIC_RECAPTCHA_SITE_KEY.length} characters`); }
if (bad) { console.error(`${bad} value(s) missing or wrong. web/.env.local was not written.`); process.exit(1); }
writeFileSync(target, out.join("\n") + "\n");
console.log("web/.env.local written. The next build and `npm run dev` run in Firebase mode.");
