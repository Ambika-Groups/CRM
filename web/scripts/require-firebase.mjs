// Runs before `next build`. When NEXT_PUBLIC_REQUIRE_FIREBASE=1 (set in netlify.toml for the production context, and by
// `npm run setup` for its own build) the build STOPS, with a plain message, if the Firebase settings are missing, so a live
// site can never silently open as the demo. Deploy previews and local demo builds do not set it and are unaffected.
import { readFileSync } from "node:fs";

if (process.env.NEXT_PUBLIC_REQUIRE_FIREBASE !== "1") process.exit(0);

const NAMES = ["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "STORAGE_BUCKET", "MESSAGING_SENDER_ID", "APP_ID"].map((n) => `NEXT_PUBLIC_FIREBASE_${n}`);
// Next also reads web/.env.local; read it the same way, so a local Firebase build passes. A variable set in the environment
// (even to nothing) wins, as in Next. On Netlify the settings come from the environment.
let file = {};
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) file[m[1]] = m[2];
  }
} catch { /* no .env.local: Netlify */ }
const value = (n) => String(process.env[n] ?? file[n] ?? "").trim();
const missing = NAMES.filter((n) => !value(n));
if (!missing.length) process.exit(0);

console.error([
  "",
  "STOPPED: this is a production build, but the Firebase settings are missing, so the site would open as the DEMO",
  "with sample data instead of your real CRM.",
  "",
  `Missing (${missing.length} of ${NAMES.length}): ${missing.join(", ")}`,
  "",
  "Fix: in Netlify open Site configuration > Environment variables, add the names above with the values from the",
  "Firebase console (Project settings > Your apps > the web app), then deploy again.",
  "Easiest: run  npm run setup  on your computer; it sets them for you.",
  "",
].join("\n"));
process.exit(1);
