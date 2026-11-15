// Setup & integrations (D-48, D-49): the super user, sign-in claims, integration validation, the Firebase web config,
// and the "N of M verified" count. IDs SU-xxx are cited in docs/prd-traceability.md.
import { beforeEach, describe, expect, it } from "vitest";
import {
  canBecomeFirstOwner, claimsFor, firebaseConfigToEnv, ownerHint, INTEGRATIONS, INTEGRATION_IDS, maskSecret, parseFirebaseConfigBlock, runCommand, seedDemo, setSuperUser,
  signedInRecently, usersToResync, validateFirebaseConfig, validateIntegration, verifiedSummary,
  type CommandCtx, type IntegrationStatus, type MemoryStore, type User,
} from "../src";

const NOW = "2026-10-25T09:00:00.000Z";
const owner: CommandCtx = { uid: "uOwner", role: "owner", projectIds: [], nowIso: NOW, superUser: true };
const plainOwner: CommandCtx = { uid: "uOwner2", role: "owner", projectIds: [], nowIso: NOW, superUser: false };
const accountant: CommandCtx = { uid: "uAccountant", role: "accountant", projectIds: [], nowIso: NOW };

let store: MemoryStore;
beforeEach(async () => { ({ store } = await seedDemo("2026-10-25")); });
const user = (id: string) => store.get<User>("users", id)!;

describe("super user (D-48)", () => {
  it("SU-01 only a super user can grant or revoke, and only to an active owner", async () => {
    await runCommand(store, "setUserRole", { userId: "uAccountant", role: "owner" }, owner);
    expect(() => setSuperUser(store, "uAccountant", true, plainOwner)).toThrow(/Only a super user/);
    await expect(runCommand(store, "setSuperUser", { userId: "uPm", superUser: true }, owner)).rejects.toThrow(/active owner/);
    await runCommand(store, "setSuperUser", { userId: "uAccountant", superUser: true }, owner);
    expect(user("uAccountant").superUser).toBe(true);
  });

  it("SU-02 there is always one super user: the last cannot be revoked, switched off or demoted", async () => {
    await expect(runCommand(store, "setSuperUser", { userId: "uOwner", superUser: false }, owner)).rejects.toThrow(/at least one super user/);
    await runCommand(store, "setUserRole", { userId: "uAccountant", role: "owner" }, owner);
    await runCommand(store, "setSuperUser", { userId: "uAccountant", superUser: true }, owner);
    // With a second super user the first may step down, and the role change clears the flag.
    await runCommand(store, "setUserRole", { userId: "uAccountant", role: "accountant" }, { ...owner });
    expect(user("uAccountant").superUser).toBe(false);
    await expect(runCommand(store, "setUserActive", { userId: "uOwner", active: false }, { ...owner, uid: "uSomeoneElse" })).rejects.toThrow(/only super user/);
  });

  it("SU-03 a super user's sign-in claim carries superUser; nobody else's does", () => {
    expect(claimsFor({ role: "owner", active: true, projectIds: [], superUser: true })).toEqual({ role: "owner", projects: [], superUser: true });
    expect(claimsFor({ role: "owner", active: true, projectIds: [] })).toEqual({ role: "owner", projects: [] });
    expect(claimsFor({ role: "accountant", active: true, projectIds: [], superUser: true })).toEqual({ role: "accountant", projects: [] });
    expect(claimsFor({ role: "owner", active: false, projectIds: [], superUser: true })).toBeNull();
  });

  it("SU-04 granting or revoking super user re-syncs that person's claims", async () => {
    await runCommand(store, "setUserRole", { userId: "uAccountant", role: "owner" }, owner);
    const { changes } = await runCommand(store, "setSuperUser", { userId: "uAccountant", superUser: true }, owner);
    expect(usersToResync(changes)).toEqual(["uAccountant"]);
  });

  it("SU-05 the demo owner is a super user and the other demo roles are not", () => {
    expect(user("uOwner").superUser).toBe(true);
    for (const id of ["uAccountant", "uPm", "uSupShivNagar", "uViewer", "uCa"]) expect(user(id).superUser).not.toBe(true);
    expect(accountant.superUser).toBeUndefined();
  });
});

describe("integrations (D-49)", () => {
  it("SU-10 every item is defined, WhatsApp is unavailable, and the secrets are write-only fields", () => {
    expect(INTEGRATION_IDS).toHaveLength(11);
    expect(INTEGRATIONS.whatsapp.available).toBe(false);
    expect(INTEGRATIONS.whatsapp.counts).toBe(false);
    expect(INTEGRATIONS.email.fields.filter((f) => f.secret).map((f) => f.key)).toEqual(["apiKey"]);
    expect(INTEGRATIONS.appCheck.fields.every((f) => !f.secret)).toBe(true);
    expect(INTEGRATIONS.appCheck.hasEnforce).toBe(true);
  });

  it("SU-11 values are checked in plain words; a blank secret keeps the saved one; unknown settings are refused", () => {
    const email = INTEGRATIONS.email;
    expect(validateIntegration(email, { apiKey: "re_abcdefghijklmnop1234", fromAddress: "alerts@ambika.in" }, {})).toEqual({});
    expect(validateIntegration(email, { apiKey: "wrong", fromAddress: "alerts" }, {})).toMatchObject({ apiKey: expect.stringContaining("re_"), fromAddress: expect.stringContaining("alerts@") });
    expect(validateIntegration(email, { fromAddress: "alerts@ambika.in" }, {})).toMatchObject({ apiKey: "This is needed." });
    expect(validateIntegration(email, { fromAddress: "alerts@ambika.in" }, { apiKey: true })).toEqual({});
    expect(validateIntegration(email, { fromAddress: "a@b.in", apiKey: "re_abcdefghijklmnop1234", extra: "x" }, {})).toEqual({ extra: "This isn't a setting." });
    expect(validateIntegration(INTEGRATIONS.maps, {}, {})).toEqual({});
    expect(validateIntegration(INTEGRATIONS.appCheck, { siteKey: "6L" + "a".repeat(38) }, {})).toEqual({});
    expect(validateIntegration(INTEGRATIONS.appCheck, { siteKey: "nope" }, {})).toHaveProperty("siteKey");
  });

  it("SU-12 a secret is masked to its last four characters, and a short one to nothing", () => {
    expect(maskSecret("re_abcdefghijklmnop1234")).toBe("••••1234");
    expect(maskSecret("short")).toBe("••••");
    expect(maskSecret("re_abcdefghijklmnop1234")).not.toContain("abcdef");
  });

  it("SU-13 a change needs a sign-in within 5 minutes", () => {
    const now = Date.UTC(2026, 9, 25, 9, 0, 0);
    expect(signedInRecently(now / 1000 - 299, now)).toBe(true);
    expect(signedInRecently(now / 1000 - 300, now)).toBe(true);
    expect(signedInRecently(now / 1000 - 301, now)).toBe(false);
    expect(signedInRecently(undefined, now)).toBe(false);
  });

  it("SU-14 'N of M verified' counts passing items that count; a turned-off item and WhatsApp do not", () => {
    const pass = (id: IntegrationStatus["id"], extra: Partial<IntegrationStatus> = {}): IntegrationStatus => ({ id, enabled: true, values: {}, masked: {}, test: { ok: true, message: "ok", at: NOW }, ...extra });
    const fail = (id: IntegrationStatus["id"]): IntegrationStatus => ({ id, enabled: true, values: {}, masked: {}, test: { ok: false, message: "no", at: NOW } });
    expect(verifiedSummary({}).total).toBe(10);
    expect(verifiedSummary({}).verified).toBe(0);
    const s = verifiedSummary({ firestore: pass("firestore"), storage: pass("storage"), functions: fail("functions"), email: pass("email", { enabled: false }), whatsapp: pass("whatsapp") });
    expect(s).toEqual({ verified: 2, total: 10 });
  });
});

describe("Firebase web config (item 1)", () => {
  const consoleSnippet = `
    // Import the functions you need
    const firebaseConfig = {
      apiKey: "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
      authDomain: "crm.ambika.in",
      projectId: "ambika-crm",
      storageBucket: "ambika-crm.firebasestorage.app",
      messagingSenderId: "123456789012",
      appId: "1:123456789012:web:abc123def456"
    };`;

  it("SU-20 reads the console's snippet, JSON, or NEXT_PUBLIC lines into the six values", () => {
    const a = parseFirebaseConfigBlock(consoleSnippet);
    expect(Object.keys(a)).toHaveLength(6);
    expect(a.projectId).toBe("ambika-crm");
    expect(validateFirebaseConfig(a)).toEqual({});
    const json = parseFirebaseConfigBlock(JSON.stringify(a));
    expect(json).toEqual(a);
    const env = parseFirebaseConfigBlock(firebaseConfigToEnv(a));
    expect(env).toEqual(a);
  });

  it("SU-21 prints the exact NEXT_PUBLIC_FIREBASE_* block for Netlify", () => {
    const block = firebaseConfigToEnv(parseFirebaseConfigBlock(consoleSnippet));
    expect(block.split("\n")).toHaveLength(6);
    expect(block).toContain("NEXT_PUBLIC_FIREBASE_PROJECT_ID=ambika-crm");
    expect(block).toContain("NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abc123def456");
  });

  it("SU-22 each wrong value is named in plain words", () => {
    const errs = validateFirebaseConfig({ apiKey: "nope", authDomain: "https://x.in/", projectId: "A", storageBucket: "bucket", messagingSenderId: "12", appId: "web:1" });
    expect(Object.keys(errs).sort()).toEqual(["apiKey", "appId", "authDomain", "messagingSenderId", "projectId", "storageBucket"]);
    expect(errs.apiKey).toMatch(/AIza/);
    expect(validateFirebaseConfig({})).toHaveProperty("apiKey", "This is needed.");
  });
});

describe("first owner (OWNER_EMAIL)", () => {
  it("SU-23 the owner address matches ignoring capitals and spaces, and the email must be verified", () => {
    expect(canBecomeFirstOwner("business@ambikagroups.tech", { email: "Business@AmbikaGroups.Tech", email_verified: true })).toMatchObject({ ok: true });
    expect(canBecomeFirstOwner("  Business@ambikagroups.tech ", { email: "business@ambikagroups.tech", email_verified: true }).ok).toBe(true);
    expect(canBecomeFirstOwner("business@ambikagroups.tech", { email: "business@ambikagroups.tech", email_verified: false })).toMatchObject({ ok: false, why: "unverified" });
    expect(canBecomeFirstOwner("business@ambikagroups.tech", { email: "bussiness@ambikagroups.tech", email_verified: true })).toMatchObject({ ok: false, why: "different" });
    expect(canBecomeFirstOwner(undefined, { email: "a@b.in", email_verified: true })).toMatchObject({ ok: false, why: "noOwnerConfigured" });
    expect(canBecomeFirstOwner("", { email: "a@b.in", email_verified: true }).ok).toBe(false);
  });

  it("SU-24 the typo hint shows the shape of the owner address only to someone on the same domain", () => {
    expect(ownerHint("business@ambikagroups.tech", "bussiness@ambikagroups.tech")).toBe("b••••••s@ambikagroups.tech");
    expect(ownerHint("business@ambikagroups.tech", "someone@gmail.com")).toBeNull();
    expect(ownerHint(undefined, "x@y.in")).toBeNull();
    // 8 letters before the @ in the real address, 9 in the typo: the dots make the difference visible.
    expect(ownerHint("business@ambikagroups.tech", "x@ambikagroups.tech")!.split("@")[0]!.length).toBe(8);
  });
});
