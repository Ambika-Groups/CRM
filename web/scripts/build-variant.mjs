// Builds the site as the DEMO (no Firebase settings, even if web/.env.local exists) or as the FIREBASE build (the
// settings in web/.env.local or the environment), so both can be kept side by side on one computer:
//   npm run build:demo      -> web/out            (what the demo preview and a no-config Netlify site serve)
//   npm run build:firebase  -> web/out-firebase   (the same pages, connected to your project)
// Netlify does not use this: it runs `npm run build:web` with its own Environment variables.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const variant = process.argv[2];
if (variant !== "demo" && variant !== "firebase") { console.error("Usage: node web/scripts/build-variant.mjs demo|firebase"); process.exit(2); }
const web = fileURLToPath(new URL("..", import.meta.url));

const env = { ...process.env };
if (variant === "demo") {
  // A variable that is set (even to nothing) in the environment wins over .env.local, so the build sees no settings.
  for (const n of ["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "STORAGE_BUCKET", "MESSAGING_SENDER_ID", "APP_ID"]) env[`NEXT_PUBLIC_FIREBASE_${n}`] = "";
  env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = "";
} else if (!existsSync(fileURLToPath(new URL("../.env.local", import.meta.url))) && !process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
  console.error("No Firebase settings: create web/.env.local first (node tools/make-env-local.mjs <file>, or copy web/.env.example).");
  process.exit(1);
}

// The Firebase build goes to its own folder, so the demo build in web/out (and a preview that serves it) is never touched.
if (variant === "firebase") {
  env.AG_OUT_DIR = "out-firebase";
  rmSync(fileURLToPath(new URL("../out-firebase", import.meta.url)), { recursive: true, force: true });
}
const r = spawnSync("npm", ["run", "build"], { cwd: web, env, stdio: "inherit", shell: true });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(variant === "firebase" ? "Built into web/out-firebase (the demo build in web/out is untouched)." : "Built into web/out (the demo build).");
