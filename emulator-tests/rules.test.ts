// Firestore security rules on the emulator (CI). Two kinds of check:
//  1. PARITY: for every role and a sample of the seeded documents, the rules allow a read exactly when core's canRead
//     says so (core/roles.ts is what the demo shows; the rules are what production enforces, so they must agree).
//  2. TARGETED: the writes and server-only collections, the super-user collections (D-48, D-49), the user's own
//     preferences, and the first-owner rules (D-52). Roles are read from each person's users document, not from claims.
//     IDs T-xxx follow docs/rules-test-matrix.md.
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { canRead, OWNER_EMAIL, seedDemo, type Doc, type Role, type User } from "@ag/core";
import { Bytes, collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from "firebase/firestore";
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
      const patches = who === "pm" ? [{ role: "owner" }, { active: false }, { projectIds: ["x"] }, { superUser: true }]
        : [{ role: "accountant" }, { active: false }, { projectIds: ["x"] }, { superUser: false }];
      for (const patch of patches) {
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
  const tok = (over: Record<string, unknown> = {}) => ({ email: OWNER_EMAIL.toUpperCase(), email_verified: true, ...over });
  const ownerDoc = (over: Record<string, unknown> = {}) => ({
    name: "Business Owner", email: OWNER_EMAIL, phone: "", role: "owner", active: true, superUser: true, language: "en", theme: "system", projectIds: [],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: NEW, updatedBy: NEW, ...over,
  });
  const marker = (over: Record<string, unknown> = {}) => ({ uid: NEW, email: OWNER_EMAIL, at: serverTimestamp(), ...over });
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
    await assertFails(attempt(asUid(NEW, tok({ email: "business@ambikagroups.tech" })), ownerDoc(), marker()));
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

// ---------- files and photos (group A, the storage adapter; core/files.ts) ----------
describe("files and file_blobs (D-22, D-51; core canAttachFile, canReadFile, canDeleteFile)", () => {
  const G = "projShivNagar"; // uPm and uSupShivNagar are assigned to it; neither is on projGomti
  type F = { kind: string; projectId: string | null; createdBy: string };
  const SEEDED: Record<string, F> = {
    fRulesBill01: { kind: "bill", projectId: G, createdBy: "uSupShivNagar" },
    fRulesBill02: { kind: "bill", projectId: G, createdBy: "uPm" },
    fRulesBill03: { kind: "bill", projectId: null, createdBy: "uAccountant" },
    fRulesPhoto1: { kind: "photo", projectId: G, createdBy: "uPm" },
    fRulesPhoto2: { kind: "photo", projectId: "projGomti", createdBy: "uOwner" },
    fRulesDoc001: { kind: "document", projectId: null, createdBy: "uOwner" },
    fRulesIdPrf1: { kind: "id_proof", projectId: null, createdBy: "uAccountant" },
    fRulesSign01: { kind: "signature", projectId: G, createdBy: "uOwner" },
  };
  const metaOf = (id: string, f: F, over: Record<string, unknown> = {}) => ({ name: `${id}.jpg`, mime: "image/jpeg", sizeBytes: 3, path: `inline/${id}`, provider: "inline", owner: null, ...f, ...over });
  const blobOf = (f: F, bytes = 3) => ({ data: Bytes.fromUint8Array(new Uint8Array(bytes).fill(7)), ...f });

  beforeAll(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const old = Timestamp.fromDate(new Date(Date.now() - 48 * 3600_000)); // past the 24-hour remove window
      // Earlier tests change people (role, switched off): put them back as seeded, so the comparison with core is fair.
      for (const p of Object.values(PEOPLE)) await setDoc(doc(db, "users", p.uid), JSON.parse(JSON.stringify(users.find((u) => u.id === p.uid))));
      for (const [id, f] of Object.entries(SEEDED)) {
        await setDoc(doc(db, "files", id), { ...metaOf(id, f), createdAt: old });
        await setDoc(doc(db, "file_blobs", id), { ...blobOf(f), createdAt: old });
      }
    });
  });

  /** Writes a file the way the app does: files/{id} and file_blobs/{id} in one batch, stamped with the server time. */
  const put = (who: string, id: string, f: Omit<F, "createdBy">, o: { meta?: Record<string, unknown>; blob?: Record<string, unknown> | null; bytes?: number } = {}) => {
    const db = as(who), uid = PEOPLE[who]!.uid, n = o.bytes ?? 3;
    const b = writeBatch(db);
    b.set(doc(db, "files", id), { ...metaOf(id, { ...f, createdBy: uid }, { sizeBytes: n }), createdAt: serverTimestamp(), ...o.meta });
    if (o.blob !== null) b.set(doc(db, "file_blobs", id), { ...blobOf({ ...f, createdBy: uid }, n), createdAt: serverTimestamp(), ...o.blob });
    return b.commit();
  };
  const del = (who: string, id: string) => { const db = as(who); const b = writeBatch(db); b.delete(doc(db, "files", id)); b.delete(doc(db, "file_blobs", id)); return b.commit(); };

  for (const who of Object.keys(PEOPLE)) {
    it(`T-F00 parity with core canRead: ${who}`, async () => {
      const db = as(who), p = PEOPLE[who]!;
      const ctx = { role: p.role, uid: p.uid, assignedProjectIds: users.find((u) => u.id === p.uid)?.projectIds ?? [] };
      const mismatches: string[] = [];
      for (const [id, f] of Object.entries(SEEDED)) for (const col of ["files", "file_blobs"]) {
        const expected = canRead(col, { id, ...f }, ctx);
        const actual = await readOk(db, `${col}/${id}`);
        if (expected !== actual) mismatches.push(`${col}/${id}: core ${expected}, rules ${actual}`);
      }
      expect(mismatches).toEqual([]);
    });
  }

  it("T-F01 a supervisor attaches a photo and a bill on their own project; finance attaches an ID proof with no project", async () => {
    await assertSucceeds(put("supervisor", "fRulesNew001", { kind: "photo", projectId: G }));
    await assertSucceeds(put("supervisor", "fRulesNew002", { kind: "bill", projectId: G }));
    await assertSucceeds(put("accountant", "fRulesNew003", { kind: "id_proof", projectId: null }));
    await assertSucceeds(put("owner", "fRulesNew004", { kind: "document", projectId: null }, { meta: { mime: "application/pdf", thumb: "data:image/jpeg;base64,AAAA", width: 10, height: 10 } }));
  });

  it("T-F02 attaching is refused: another project, no project, an ID proof or signature from a site role, the viewer, the CA, someone else's name", async () => {
    await assertFails(put("supervisor", "fRulesBad001", { kind: "photo", projectId: "projGomti" }));
    await assertFails(put("pm", "fRulesBad002", { kind: "photo", projectId: null }));
    await assertFails(put("pm", "fRulesBad003", { kind: "id_proof", projectId: G }));
    await assertFails(put("supervisor", "fRulesBad004", { kind: "signature", projectId: G }));
    await assertFails(put("viewer", "fRulesBad005", { kind: "photo", projectId: G }));
    await assertFails(put("ca", "fRulesBad006", { kind: "bill", projectId: null }));
    await assertFails(put("supervisor", "fRulesBad007", { kind: "photo", projectId: G }, { meta: { createdBy: "uOwner" }, blob: { createdBy: "uOwner" } }));
    await assertFails(put("owner", "fRulesBad008", { kind: "video", projectId: null }));
  });

  it("T-F03 the size caps and shapes are enforced by the rules", async () => {
    await assertSucceeds(put("owner", "fRulesCap001", { kind: "photo", projectId: null }, { bytes: 700_000 }));
    await assertFails(put("owner", "fRulesCap002", { kind: "photo", projectId: null }, { bytes: 700_001 }));
    await assertFails(put("owner", "fRulesCap003", { kind: "photo", projectId: null }, { meta: { sizeBytes: 2 } })); // says 2, holds 3
    await assertFails(put("owner", "fRulesCap004", { kind: "photo", projectId: null }, { blob: null })); // inline with no bytes
    await assertFails(put("owner", "fRulesCap005", { kind: "photo", projectId: null }, { meta: { mime: "text/html" } }));
    await assertFails(put("owner", "fRulesCap006", { kind: "photo", projectId: null }, { meta: { mime: "application/pdf" } })); // no PDFs as photos
    await assertFails(put("owner", "fRulesCap007", { kind: "photo", projectId: null }, { meta: { thumb: `data:image/jpeg;base64,${"A".repeat(20_000)}` } }));
    await assertFails(put("owner", "fRulesCap008", { kind: "photo", projectId: null }, { meta: { extra: 1 } }));
    await assertFails(put("owner", "fRulesCap009", { kind: "photo", projectId: null }, { meta: { path: "inline/fRulesBill01" } }));
    await assertFails(put("owner", "fRulesCap010", { kind: "photo", projectId: null }, { meta: { createdAt: Timestamp.fromDate(new Date(2020, 0, 1)) } }));
    await assertFails(put("owner", "short", { kind: "photo", projectId: null }));
    // Bytes on their own, or for a file that already exists, are refused.
    await assertFails(setDoc(doc(as("owner"), "file_blobs", "fRulesCap011"), { ...blobOf({ kind: "photo", projectId: null, createdBy: "uOwner" }), createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as("owner"), "file_blobs", "fRulesDoc001"), { ...blobOf({ kind: "document", projectId: null, createdBy: "uOwner" }), createdAt: serverTimestamp() }));
  });

  it("T-F04 a file is never changed", async () => {
    await assertFails(updateDoc(doc(as("owner"), "files", "fRulesDoc001"), { name: "renamed.jpg" }));
    await assertFails(updateDoc(doc(as("owner"), "file_blobs", "fRulesDoc001"), { kind: "photo" }));
    await assertFails(updateDoc(doc(as("pm"), "files", "fRulesPhoto1"), { projectId: "projGomti" }));
  });

  it("T-F05 removing: the person who attached it within 24 hours, then only finance; both documents go together", async () => {
    await assertSucceeds(put("supervisor", "fRulesDel001", { kind: "photo", projectId: G }));
    await assertFails(del("pm", "fRulesDel001")); // not theirs
    await assertFails(deleteDoc(doc(as("supervisor"), "files", "fRulesDel001"))); // would leave the bytes behind
    await assertSucceeds(del("supervisor", "fRulesDel001"));
    await assertFails(del("pm", "fRulesPhoto1")); // theirs, but attached 48 hours ago
    await assertFails(del("ca", "fRulesBill03"));
    await assertSucceeds(del("accountant", "fRulesPhoto1"));
  });

  it("T-F06 a file kept in R2 or Cloudinary has no bytes here; ID proofs never go to Cloudinary", async () => {
    const meta = (uid: string, id: string, over: Record<string, unknown>) => ({ ...metaOf(id, { kind: "bill", projectId: G, createdBy: uid }, { sizeBytes: 5_000_000 }), createdAt: serverTimestamp(), ...over });
    await assertSucceeds(setDoc(doc(as("supervisor"), "files", "fRulesR2x01"), meta("uSupShivNagar", "fRulesR2x01", { provider: "r2", path: "r2/files/bill/fRulesR2x01.jpg" })));
    await assertFails(setDoc(doc(as("supervisor"), "files", "fRulesR2x02"), meta("uSupShivNagar", "fRulesR2x02", { provider: "r2", path: "r2/files/bill/fRulesBill01.jpg" }))); // another file's object
    await assertFails(setDoc(doc(as("supervisor"), "files", "fRulesR2x03"), meta("uSupShivNagar", "fRulesR2x03", { provider: "r2", path: "r2/files/bill/fRulesR2x03.jpg", sizeBytes: 10_485_761 })));
    await assertSucceeds(setDoc(doc(as("owner"), "files", "fRulesCld01"), meta("uOwner", "fRulesCld01", { provider: "cloudinary", path: "cloudinary/ag-crm/bill/fRulesCld01" })));
    await assertFails(setDoc(doc(as("owner"), "files", "fRulesCld02"), meta("uOwner", "fRulesCld02", { provider: "cloudinary", path: "cloudinary/ag-crm/id_proof/fRulesCld02", kind: "id_proof", projectId: null })));
  });
});
