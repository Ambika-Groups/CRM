/**
 * Data mode (decisions D-37, D-48). Firebase mode when the Firebase web config is present: from the build's
 * NEXT_PUBLIC_FIREBASE_* variables (Netlify's Environment variables stay the source of truth for everyone, D-36), or,
 * when the build has none, from the one pasted on this device in Setup (localStorage; public values only). Demo mode
 * only when neither exists, and never once any config is present.
 *
 * Each variable is referenced literally so Next.js inlines it into the static export.
 */
import type { FirebaseWebConfig } from "@ag/core";

export type DataMode = "demo" | "firebase";
export type ConfigSource = "env" | "device" | "none";

/** The build's variables (empty strings when unset). */
export const envConfig: FirebaseWebConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};
/** The reCAPTCHA v3 site key for App Check (D-41). Public. Optional. */
export const envRecaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? "";

/** The first owner's email address (D-52): one copy in @ag/core, compared with firestore.rules by a test. */
export { OWNER_EMAIL } from "@ag/core";

/**
 * The address of the CRM's server part (the Netlify Function, D-51), for example "/.netlify/functions/api". Empty until it
 * exists: saves then say plainly that the server part is not connected, and everything that only reads works.
 */
export const serverUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

const DEVICE_CONFIG_KEY = "ag-firebase-config";
const DEVICE_SITEKEY_KEY = "ag-appcheck-sitekey";

/** Only presence is checked at start-up (strict format checks live on the Setup form), so a valid but unusual value never blocks the app. */
const missing = (c: Partial<FirebaseWebConfig>): Record<string, string> =>
  Object.fromEntries(("apiKey authDomain projectId appId".split(" ") as (keyof FirebaseWebConfig)[]).filter((k) => !(c[k] ?? "").trim()).map((k) => [k, "missing"]));

const anyValue = (c: Partial<FirebaseWebConfig>) => Object.values(c).some((v) => (v ?? "").trim() !== "");

function readDevice<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}

/** The config pasted on this device, if any. */
export function deviceConfig(): Partial<FirebaseWebConfig> | null {
  if (typeof window === "undefined") return null;
  const c = readDevice<Partial<FirebaseWebConfig>>(DEVICE_CONFIG_KEY);
  return c && anyValue(c) ? c : null;
}

export function saveDeviceConfig(cfg: FirebaseWebConfig): void {
  localStorage.setItem(DEVICE_CONFIG_KEY, JSON.stringify(cfg));
}

/** Forget this device's config (the explicit way back to the demo on a device that has no build config). */
export function forgetDeviceConfig(): void {
  try { localStorage.removeItem(DEVICE_CONFIG_KEY); localStorage.removeItem(DEVICE_SITEKEY_KEY); } catch { /* private mode */ }
}

export function saveDeviceSiteKey(key: string): void {
  try { if (key) localStorage.setItem(DEVICE_SITEKEY_KEY, JSON.stringify(key)); else localStorage.removeItem(DEVICE_SITEKEY_KEY); } catch { /* private mode */ }
}

export interface ResolvedConfig {
  mode: DataMode;
  from: ConfigSource;
  config: Partial<FirebaseWebConfig>;
  /** The values that are still missing or malformed: empty when the config is usable. */
  problems: Record<string, string>;
  siteKey: string;
}

/**
 * Which config this page load uses. The build's variables win; a partial one is an error in Firebase mode, never a
 * fallback to demo (D-37). Call in the browser, after mount.
 */
export function resolveConfig(): ResolvedConfig {
  const device = deviceConfig();
  const siteKey = envRecaptchaSiteKey || (typeof window !== "undefined" ? readDevice<string>(DEVICE_SITEKEY_KEY) ?? "" : "");
  if (anyValue(envConfig)) return { mode: "firebase", from: "env", config: envConfig, problems: missing(envConfig), siteKey };
  if (device) return { mode: "firebase", from: "device", config: device, problems: missing(device), siteKey };
  return { mode: "demo", from: "none", config: {}, problems: {}, siteKey };
}
