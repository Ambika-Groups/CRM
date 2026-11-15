// Firestore security rules on the emulator (CI). Two kinds of check:
//  1. PARITY: for every role and a sample of the seeded documents, the rules allow a read exactly when core's canRead
//     says so (core/roles.ts is what the demo shows; the rules are what production enforces, so they must agree).
//  2. TARGETED: the writes and server-only collections, the super-user collections (D-48, D-49), the user's own
//     preferences, and the first-owner rules (D-52). Roles are read from each person's users document, not from claims.
//     IDs T-xxx follow docs/rules-test-matrix.md.
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { canRead, seedDemo, type Doc, type Role, type User } from "@ag/core";
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROJECT = "demo-ambika";
let env: RulesTestEnvironment;
let snapshot: Record<string, Doc[]>;
let users: User[];

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") } });
  const { store } = await seedDemo("2026-10-25");
  snapshot = store.snapshot();
  users = snapshot.users as unknown as User[];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const writes: Promise<void>[] = [];
    for (const [col, docs] of Object.entries(snapshot)) for (const d of docs) writes.push(setDoc(doc(db, col, d.id), clean(d)));
    for (let i = 0; i < writes.length; i += 200) await Promise.all(writes.slice(i, i + 200));
  });
});
afterAll(async () => { await env?.cleanup(); });

/** Who is who in the demo data. The role, projects and super-user flag are in each person's seeded users document (D-52). */
const PEOPLE: Record<string, { uid: string; role: Role }> = {
  owner: { uid: "uOwner", role: "owner" },
  accountant: { uid: "uAccountant", role: "accountant" },
  pm: { uid: "uPm", role: "pm" },
  supervisor: { uid: "uSupShivNagar", role: "supervisor" },
  viewer: { uid: "uViewer", role: "viewer" },
  ca: { uid: "uCa", role: "ca" },
};
const as = (who: keyof typeof PEOPLE) => env.authenticatedContext(PEOPLE[who]!.uid, { email: `${PEOPLE[who]!.uid}@example.test`, email_verified: true }).firestore();
/** A signed-in account with no claims at all: only its users document says what it may do. */
const asUid = (uid: string, token: Record<string, unknown> = {}) => env.authenticatedContext(uid, token).firestore();
const readOk = async (db: ReturnType<typeof as>, path: string) => {
  try { await getDoc(doc(db, path)); return true; } catch { return false; }
};

// ---------- 1. parity with core's canRead ----------

/** Collections where core's canRead has an explicit rule (the rest are server-only or special-cased below). */
const COMPARE_TOP = [
  "projects", "clients", "client_balances", "invoices", "payments_received", "accounts", "account_transactions", "audit_log", "vendor_bills",
  "vendor_payments", "finance_rollups", "rollups", "expenses", "workers", "contract_scopes", "attendance", "worker_payments", "worker_balances",
  "thekedar_contracts", "contract_measurements", "attendance_unlocks", "attendance_checkins", "rate_change_requests",
];
const PROJECT_CHILDREN = ["roster", "project_units", "project_milestones", "boq_items", "boq_rates", "eot_requests", "hindrance_register", "project_approvals", "measurement_book", "dpr"];

function matrixKey(col: string, id: string): string {
  const parts = col.split("/");
  if (parts[0] === "projects" && parts[2] === "private") return `projects/private/${id}`;
  if (parts[0] === "workers" && parts[2] === "private") return `workers/private/${id}`;
  return parts[parts.length - 1]!;
}
function withProject(col: string, d: Doc): Doc {
  const parts = col.split("/");
  return parts[0] === "projects" && parts.length === 3 && !d.projectId ? { ...d, projectId: parts[1] } : d;
}

/** A few documents per collection, taking in different projects so assignment matters. */
function sample(): { col: string; d: Doc }[] {
  const out: { col: string; d: Doc }[] = [];
  const pick = (col: string, docs: Doc[]) => {
    const seen = new Set<unknown>();
    for (const d of docs) {
      const key = d.projectId ?? d.scope ?? d.status ?? "x";
      if (seen.has(key) && seen.size >= 2) continue;
      seen.add(key);
      out.push({ col, d });
      if (out.length > 4000 || seen.size >= 5) break;
    }
  };
  for (const col of COMPARE_TOP) pick(col, snapshot[col] ?? []);
  for (const [col, docs] of Object.entries(snapshot)) {
    const p = col.split("/");
    if (p[0] === "projects" && p.length === 3 && (PROJECT_CHILDREN.includes(p[2]!) || p[2] === "private")) pick(col, docs);
    if (p[0] === "workers" && p.length === 3 && p[2] === "private") pick(col, docs);
  }
  return out;
}

describe("rules agree with core canRead (read matrix, D-42, D-43, D-45)", () => {
  for (const who of Object.keys(PEOPLE)) {
    it(`parity: ${who}`, async () => {
      const db = as(who);
      const p = PEOPLE[who]!;
      const ctx = { role: p.role, uid: p.uid, assignedProjectIds: users.find((u) => u.id === p.uid)?.projectIds ?? [] };
      const mismatches: string[] = [];
      for (const { col, d } of sample()) {
        const expected = canRead(matrixKey(col, d.id), withProject(col, d) as Record<string, unknown>, ctx);
        const actual = await readOk(db, `${col}/${d.id}`);
        if (expected !== actual) mismatches.push(`${col}/${d.id}: core says ${expected ? "allow" : "deny"}, rules say ${actual ? "allow" : "deny"}`);
      }
      expect(mismatches).toEqual([]);
    });
  }
});

// ---------- 2. targeted checks ----------

const seedUser = (id: string, data: Record<string, unknown>) =>
  env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "users", id), { id, name: id, active: true, projectIds: [], language: "en", theme: "system", ...data }); });

describe("server-only collections (D-07, D-08, D-09)", () => {
  const SERVER_ONLY = ["rollups", "finance_rollups", "postings", "counters", "account_transactions", "worker_balances", "audit_log", "command_requests", "private_config", "processed_events"];
  it("T-300 no signed-in role, not even the owner, can write them from a browser", async () => {
    for (const who of Object.keys(PEOPLE)) {
      const db = as(who);
      for (const col of SERVER_ONLY) {
        await assertFails(setDoc(doc(db, col, "probe_write"), { id: "probe_write", amountPaise: 1 }));
        await assertFails(deleteDoc(doc(db, col, (snapshot[col]?.[0]?.id) ?? "none")));
      }
    }
  });
  it("T-301 nobody signed out reads anything", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "projects", snapshot.projects![0]!.id)));
    await assertFails(getDoc(doc(anon, "users", "uOwner")));
    await assertFails(getDoc(doc(anon, "system", "owner")));
  });
  it("T-302 an account with no users document reads nothing but its own (missing) document and the owner marker (not set up yet)", async () => {
    const db = asUid("stranger", { email: "stranger@example.test", email_verified: true });
    await assertSucceeds(getDoc(doc(db, "users", "stranger")));
    await assertSucceeds(getDoc(doc(db, "system", "owner")));
    await assertFails(getDoc(doc(db, "projects", snapshot.projects![0]!.id)));
    await assertFails(getDocs(query(collection(db, "settings"), limit(1))));
    await assertFails(getDoc(doc(db, "users", "uOwner")));
  });
  it("T-303 a person who is switched off (active false) reads nothing", async () => {
    await seedUser("uOff", { role: "owner", active: false, superUser: true });
    const db = asUid("uOff");
    await assertFails(getDoc(doc(db, "projects", snapshot.projects![0]!.id)));
    await assertFails(getDoc(doc(db, "settings", "company")));
    await assertSucceeds(getDoc(doc(db, "users", "uOff")));
  });
  it("T-304 command_requests and private_config are closed to everyone, a super user included", async () => {
    const db = as("owner");
    await assertFails(getDoc(doc(db, "command_requests", "any")));
    await assertFails(getDoc(doc(db, "private_config", "email")));
    await assertFails(setDoc(doc(db, "private_config", "email"), { secrets: { apiKey: "x" } }));
  });
});

describe("Setup & integrations (D-48, D-49, D-52)", () => {
  it("T-370 only a super user (an owner whose users document says so) reads integrations", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "integrations", "email"), { id: "email", enabled: true, values: {}, masked: { apiKey: "••••1234" } }); });
    await seedUser("uOwner2", { role: "owner", superUser: false });
    await assertSucceeds(getDoc(doc(as("owner"), "integrations", "email")));
    await assertFails(getDoc(doc(asUid("uOwner2"), "integrations", "email")));
    for (const who of ["accountant", "pm", "supervisor", "viewer", "ca"] as const) await assertFails(getDoc(doc(as(who), "integrations", "email")));
  });
  it("T-371 nobody writes integrations from a client, not even a super user", async () => {
    await assertFails(setDoc(doc(as("owner"), "integrations", "email"), { id: "email", enabled: true, values: {}, masked: {} }));
    await assertFails(updateDoc(doc(as("owner"), "integrations", "email"), { enabled: false }));
    await assertFails(deleteDoc(doc(as("owner"), "integrations", "email")));
  });
  it("T-372 the Firestore probe is for a super user only", async () => {
    const owner = as("owner");
    await assertSucceeds(setDoc(doc(owner, "system_probe", "uOwner"), { at: serverTimestamp() }));
    await assertSucceeds(getDoc(doc(owner, "system_probe", "uOwner")));
    await assertSucceeds(deleteDoc(doc(owner, "system_probe", "uOwner")));
    await seedUser("uOwner2", { role: "owner", superUser: false });
    await assertFails(setDoc(doc(asUid("uOwner2"), "system_probe", "x"), { at: 1 }));
    await assertFails(setDoc(doc(as("accountant"), "system_probe", "x"), { at: 1 }));
  });
  it("T-373 a super-user flag on a non-owner opens nothing", async () => {
    await seedUser("uAcc2", { role: "accountant", superUser: true });
    const sneaky = asUid("uAcc2");
    await assertFails(getDoc(doc(sneaky, "integrations", "email")));
    await assertFails(setDoc(doc(sneaky, "system_probe", "x"), { at: 1 }));
  });
});

describe("users and preferences (D-05, D-52)", () => {
  it("T-380 a person changes their own language and theme, stamped by the server clock", async () => {
    await assertSucceeds(updateDoc(doc(as("pm"), "users", "uPm"), { language: "hi", theme: "dark", updatedAt: serverTimestamp(), updatedBy: "uPm" }));
  });
  it("T-381 nobody changes their own role, status, projects or super-user flag", async () => {
    for (const who of ["pm", "owner"] as const) {
      const id = PEOPLE[who]!.uid;
      for (const patch of [{ role: "owner" }, { active: false }, { projectIds: ["x"] }, { superUser: true }]) {
        await assertFails(updateDoc(doc(as(who), "users", id), { ...patch, updatedAt: serverTimestamp(), updatedBy: id }));
      }
    }
  });
  it("T-382 an owner manages OTHER people (role, on/off, projects); others cannot; the super-user flag needs a super user", async () => {
    await assertSucceeds(updateDoc(doc(as("owner"), "users", "uPm"), { role: "supervisor", projectIds: ["projShivNagar"], updatedAt: serverTimestamp(), updatedBy: "uOwner" }));
    await assertSucceeds(updateDoc(doc(as("owner"), "users", "uPm"), { active: false, updatedAt: serverTimestamp(), updatedBy: "uOwner" }));
    await assertFails(updateDoc(doc(as("accountant"), "users", "uPm"), { role: "owner", updatedAt: serverTimestamp(), updatedBy: "uAccountant" }));
    await assertFails(updateDoc(doc(as("owner"), "users", "uViewer"), { role: "godmode", updatedAt: serverTimestamp(), updatedBy: "uOwner" }));
    await seedUser("uOwner2", { role: "owner", superUser: false });
    await assertFails(updateDoc(doc(asUid("uOwner2"), "users", "uViewer"), { superUser: true, updatedAt: serverTimestamp(), updatedBy: "uOwner2" }));
  });
  it("T-383 a site role reads only their own user document; owner and accountant read all; the CA does not", async () => {
    await assertSucceeds(getDoc(doc(as("pm"), "users", "uPm")));
    await assertFails(getDoc(doc(as("pm"), "users", "uOwner")));
    await assertSucceeds(getDoc(doc(as("accountant"), "users", "uSupShivNagar")));
    await assertSucceeds(getDoc(doc(as("owner"), "users", "uSupShivNagar")));
    await assertFails(getDoc(doc(as("ca"), "users", "uSupShivNagar")));
  });
  it("T-384 nobody creates another person's document or deletes one from a browser", async () => {
    await assertFails(setDoc(doc(as("owner"), "users", "uNew"), { id: "uNew", role: "owner", active: true }));
    await assertFails(deleteDoc(doc(as("owner"), "users", "uSupShivNagar")));
  });
});

describe("the first owner, created by the rules alone (D-52)", () => {
  const NEW = "uNewOwner";
  const tok = (over: Record<string, unknown> = {}) => ({ email: "Business@AmbikaGroups.Tech", email_verified: true, ...over });
  const ownerDoc = (over: Record<string, unknown> = {}) => ({
    name: "Business Owner", email: "business@ambikagroups.tech", phone: "", role: "owner", active: true, superUser: true, language: "en", theme: "system", projectIds: [],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: NEW, updatedBy: NEW, ...over,
  });
  const marker = (over: Record<string, unknown> = {}) => ({ uid: NEW, email: "business@ambikagroups.tech", at: serverTimestamp(), ...over });
  const attempt = async (db: ReturnType<typeof asUid>, u: Record<string, unknown>, m: Record<string, unknown>, uid = NEW) => {
    const b = writeBatch(db);
    b.set(doc(db, "users", uid), u);
    b.set(doc(db, "system", "owner"), m);
    return b.commit();
  };
  const clean = () => env.withSecurityRulesDisabled(async (ctx) => {
    await deleteDoc(doc(ctx.firestore(), "system", "owner"));
    await deleteDoc(doc(ctx.firestore(), "users", NEW));
  });
  it("T-390 the verified owner address (any capitals) creates their document and the marker in one batch", async () => {
    await clean();
    await assertSucceeds(attempt(asUid(NEW, tok()), ownerDoc(), marker()));
    // They are now a working super user: they read their document and write settings; the marker can never change.
    const db = asUid(NEW, tok());
    await assertSucceeds(getDoc(doc(db, "users", NEW)));
    await assertSucceeds(setDoc(doc(db, "settings", "company"), { id: "company", tradeName: "Ambika Groups" }));
    await assertFails(updateDoc(doc(db, "system", "owner"), { uid: "someoneElse" }));
    await assertFails(deleteDoc(doc(db, "system", "owner")));
    await clean();
  });
  it("T-391 an unverified email is refused (this is what stops anyone registering the address first)", async () => {
    await clean();
    await assertFails(attempt(asUid(NEW, tok({ email_verified: false })), ownerDoc(), marker()));
  });
  it("T-392 any other address is refused, including a one-letter typo; an account with no email is refused", async () => {
    await clean();
    await assertFails(attempt(asUid(NEW, tok({ email: "bussiness@ambikagroups.tech" })), ownerDoc(), marker()));
    await assertFails(attempt(asUid(NEW, tok({ email: "someone@gmail.com" })), ownerDoc({ email: "someone@gmail.com" }), marker({ email: "someone@gmail.com" })));
    await assertFails(attempt(asUid(NEW, { email_verified: true }), ownerDoc(), marker()));
  });
  it("T-393 once an owner exists nobody can do it again, even the same address", async () => {
    await clean();
    await assertSucceeds(attempt(asUid(NEW, tok()), ownerDoc(), marker()));
    await assertFails(attempt(asUid("uSecond", tok()), ownerDoc({ createdBy: "uSecond", updatedBy: "uSecond" }), marker({ uid: "uSecond" }), "uSecond"));
    await clean();
  });
  it("T-394 the document must be exactly a first owner: role owner, super user, switched on, no projects, no extra fields", async () => {
    await clean();
    for (const bad of [{ role: "accountant" }, { superUser: false }, { active: false }, { projectIds: ["p1"] }, { extra: "x" }, { email: "other@x.in" }]) {
      await assertFails(attempt(asUid(NEW, tok()), ownerDoc(bad), marker()));
    }
  });
  it("T-395 both documents or neither: the document alone, or the marker alone, is refused", async () => {
    await clean();
    const db = asUid(NEW, tok());
    await assertFails(setDoc(doc(db, "users", NEW), ownerDoc()));
    await assertFails(setDoc(doc(db, "system", "owner"), marker()));
  });
  it("T-396 the documents must be the signer's own: not another person's id, not a marker naming someone else", async () => {
    await clean();
    await assertFails(attempt(asUid(NEW, tok()), ownerDoc(), marker(), "uSomeoneElse"));
    await assertFails(attempt(asUid(NEW, tok()), ownerDoc(), marker({ uid: "uSomeoneElse" })));
  });
});
