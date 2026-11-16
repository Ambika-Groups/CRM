// Staff sign-in accounts and the usage counts (D-51), with a database and a sign-in service that hold only what a test
// puts in them: no network, no Firebase project. IDs ST-xx are cited in docs/prd-traceability.md.
import { describe, expect, it } from "vitest";
import { CommandError } from "@ag/core";
import { handleApi, type ApiDeps } from "../src/api";
import { setStaffPassword, usageCounts } from "../src/staff";

type Docs = Record<string, Record<string, unknown>>;

/** A database that holds only what a test puts in it (path -> fields). */
function fakeDb(docs: Docs = {}, sizes: Record<string, number> = {}, files = { files: 0, bytes: 0 }) {
  const counted: string[] = [];
  return {
    docs, counted,
    doc: (path: string) => ({
      path,
      get: async () => ({ exists: path in docs, data: () => docs[path], get: (f: string) => docs[path]?.[f] }),
      set: async (v: Record<string, unknown>, o?: { merge?: boolean }) => { docs[path] = o?.merge ? { ...(docs[path] ?? {}), ...v } : v; },
    }),
    collection: (name: string) => ({
      count: () => ({ get: async () => { counted.push(name); return { data: () => ({ count: sizes[name] ?? 0 }) }; } }),
      where: () => ({ aggregate: () => ({ get: async () => { counted.push(`${name}:aggregate`); return { data: () => files }; } }) }),
    }),
  };
}

interface Account { uid: string; email?: string; password?: string; displayName?: string; disabled?: boolean; phoneNumber?: string }

/** A sign-in service that keeps accounts in memory and notes what was asked of it. */
function fakeAuth(accounts: Record<string, Account> = {}) {
  const calls: string[] = [];
  const notFound = () => Object.assign(new Error("no such user"), { code: "auth/user-not-found" });
  return {
    accounts, calls,
    getUser: async (uid: string) => { if (!accounts[uid]) throw notFound(); return accounts[uid]!; },
    createUser: async (a: Account) => {
      if (Object.values(accounts).some((x) => x.email && x.email === a.email)) throw Object.assign(new Error("taken"), { code: "auth/email-already-exists" });
      accounts[a.uid] = { ...a }; calls.push(`create ${a.uid}`); return accounts[a.uid]!;
    },
    updateUser: async (uid: string, patch: Partial<Account>) => {
      if (!accounts[uid]) throw notFound();
      if (patch.email && Object.values(accounts).some((x) => x.uid !== uid && x.email === patch.email)) throw Object.assign(new Error("taken"), { code: "auth/email-already-exists" });
      accounts[uid] = { ...accounts[uid]!, ...patch }; calls.push(`update ${uid} ${Object.keys(patch).sort().join("+")}`); return accounts[uid]!;
    },
    revokeRefreshTokens: async (uid: string) => { calls.push(`revoke ${uid}`); },
  };
}

const NOW = () => new Date("2026-11-16T09:00:00.000Z");
const OWNER = { uid: "uOwner" };
const people = (): Docs => ({
  "users/uOwner": { name: "Anil", role: "owner", active: true, superUser: false, email: "anil@example.com" },
  "users/uSuper": { name: "Meena", role: "owner", active: true, superUser: true, email: "meena@example.com" },
  "users/uAcc": { name: "Sunita", role: "accountant", active: true, email: "sunita@example.com", phone: "+919811111111" },
  "users/uSup": { name: "Ram Kumar", role: "supervisor", active: true, email: "", phone: "+919876543210" },
  "users/uOff": { name: "Old Owner", role: "owner", active: false, superUser: true, email: "old@example.com" },
  "users/uNoContact": { name: "Nameless", role: "viewer", active: true, email: "", phone: "" },
});
const refusal = async (p: Promise<unknown>): Promise<string> => {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(CommandError); return (e as Error).message; }
  return "not refused";
};

describe("setStaffPassword (staff.ts)", () => {
  it("ST-01 a phone-only person gets <mobile>@staff.ambika and the password; the owner is told what to hand over", async () => {
    const db = fakeDb(people()), auth = fakeAuth({ uSup: { uid: "uSup", phoneNumber: "+919876543210" } });
    const out = await setStaffPassword(db as never, auth as never, OWNER, { userId: "uSup", password: "gitti-2026" }, NOW);
    expect(out).toEqual({ loginEmail: "9876543210@staff.ambika", signInWith: "9876543210", created: false });
    expect(auth.accounts.uSup).toMatchObject({ email: "9876543210@staff.ambika", password: "gitti-2026", phoneNumber: "+919876543210" });
    expect(auth.calls).toEqual(["update uSup email+password", "revoke uSup"]);
    expect(db.docs["users/uSup"]).toMatchObject({ loginEmail: "9876543210@staff.ambika", passwordSetAt: "2026-11-16T09:00:00.000Z", passwordSetBy: "uOwner", role: "supervisor" });
  });

  it("ST-02 a person with an email keeps it; a reset changes only the password and ends their old sessions", async () => {
    const db = fakeDb(people()), auth = fakeAuth({ uAcc: { uid: "uAcc", email: "sunita@example.com", password: "old-one-11" } });
    const out = await setStaffPassword(db as never, auth as never, OWNER, { userId: "uAcc", password: "naya-pass-42" }, NOW);
    expect(out).toMatchObject({ loginEmail: "sunita@example.com", signInWith: "sunita@example.com", created: false });
    expect(auth.calls).toEqual(["update uAcc password", "revoke uAcc"]);
    expect(auth.accounts.uAcc!.password).toBe("naya-pass-42");
  });

  it("ST-03 a person with no sign-in account yet gets one, with the same id as their users document", async () => {
    const db = fakeDb(people()), auth = fakeAuth();
    const out = await setStaffPassword(db as never, auth as never, OWNER, { userId: "uSup", password: "gitti-2026" }, NOW);
    expect(out.created).toBe(true);
    expect(auth.accounts.uSup).toEqual({ uid: "uSup", email: "9876543210@staff.ambika", password: "gitti-2026", displayName: "Ram Kumar", disabled: false });
  });

  it("ST-04 only an owner who is switched on may do it: every other role, a switched-off owner and a stranger are refused", async () => {
    for (const uid of ["uAcc", "uSup", "uOff", "uNobody"]) {
      const db = fakeDb(people()), auth = fakeAuth();
      expect(await refusal(setStaffPassword(db as never, auth as never, { uid }, { userId: "uSup", password: "gitti-2026" }, NOW))).toBe("Only the owner can set a person's password.");
      expect(auth.calls).toEqual([]);
      expect(db.docs["users/uSup"]!.passwordSetAt).toBeUndefined();
    }
  });

  it("ST-05 nobody sets their own password here; another owner's only by a super user", async () => {
    const db = fakeDb(people()), auth = fakeAuth();
    expect(await refusal(setStaffPassword(db as never, auth as never, OWNER, { userId: "uOwner", password: "gitti-2026" }, NOW))).toContain("You can't set your own password here.");
    expect(await refusal(setStaffPassword(db as never, auth as never, OWNER, { userId: "uSuper", password: "gitti-2026" }, NOW))).toBe("Only a super user can set another owner's password.");
    expect(auth.calls).toEqual([]);
    const ok = await setStaffPassword(db as never, auth as never, { uid: "uSuper" }, { userId: "uOwner", password: "gitti-2026" }, NOW);
    expect(ok.loginEmail).toBe("anil@example.com");
  });

  it("ST-06 a weak password, a missing person and a person with nothing to sign in with are refused in plain words, before the sign-in service is touched", async () => {
    const db = fakeDb(people()), auth = fakeAuth();
    const call = (data: Record<string, unknown>) => refusal(setStaffPassword(db as never, auth as never, OWNER, data, NOW));
    expect(await call({ userId: "uSup", password: "abc" })).toBe("Use at least 8 letters or numbers.");
    expect(await call({ userId: "uSup", password: "9876543210" })).toContain("Don't use the person's own mobile number");
    expect(await call({ userId: "uSup" })).toBe("Enter a password.");
    expect(await call({ userId: "uGone", password: "gitti-2026" })).toBe("This person no longer exists.");
    expect(await call({ userId: "uNoContact", password: "gitti-2026" })).toContain("has no email or mobile number");
    expect(await call({ password: "gitti-2026" })).toBe("Choose a person first.");
    expect(await call({ userId: "users/../x", password: "gitti-2026" })).toBe("Choose a person first.");
    expect(auth.calls).toEqual([]);
    try { await setStaffPassword(db as never, auth as never, OWNER, { userId: "uSup", password: "abc" }, NOW); } catch (e) { expect((e as CommandError).fields).toEqual({ password: "Use at least 8 letters or numbers." }); }
  });

  it("ST-07 the password is never written to the database or the audit log; the audit entry says who and for whom", async () => {
    const db = fakeDb(people()), auth = fakeAuth();
    await setStaffPassword(db as never, auth as never, OWNER, { userId: "uSup", password: "gitti-2026" }, NOW);
    expect(JSON.stringify(db.docs)).not.toContain("gitti-2026");
    const audits = Object.entries(db.docs).filter(([p]) => p.startsWith("audit_log/")).map(([, v]) => v);
    expect(audits).toEqual([{ entity: "users", entityId: "uSup", action: "password", command: "setStaffPassword", fields: [], paths: ["users/uSup"], projectId: null, by: "uOwner", at: "2026-11-16T09:00:00.000Z" }]);
  });

  it("ST-08 a login that another account already uses is refused in plain words and nothing is stamped", async () => {
    const db = fakeDb(people()), auth = fakeAuth({ other: { uid: "other", email: "9876543210@staff.ambika" } });
    expect(await refusal(setStaffPassword(db as never, auth as never, OWNER, { userId: "uSup", password: "gitti-2026" }, NOW))).toContain("Another sign-in account already uses this email or mobile number.");
    expect(db.docs["users/uSup"]!.passwordSetAt).toBeUndefined();
    expect(Object.keys(db.docs).some((p) => p.startsWith("audit_log/"))).toBe(false);
  });

  it("ST-09 through the HTTP handler an unexpected sign-in failure is logged by name only: the password is in no log and no answer", async () => {
    const logged: unknown[] = [];
    const db = fakeDb(people());
    const auth = { ...fakeAuth(), getUser: async () => { throw Object.assign(new Error("boom gitti-2026"), { code: "auth/internal-error" }); } };
    const deps: ApiDeps = {
      db: db as never, auth: auth as never, origin: "https://crm.example.com", where: "test",
      verifyIdToken: async () => ({ uid: "uOwner" }), log: (message, detail) => { logged.push({ message, detail }); },
    };
    const actions = { setStaffPassword: (who: { uid: string }, data: Record<string, unknown>, d: ApiDeps) => setStaffPassword(d.db, d.auth, who, data, NOW) };
    const r = await handleApi({ method: "POST", authorization: "Bearer good", appCheck: "", body: JSON.stringify({ name: "setStaffPassword", data: { userId: "uSup", password: "gitti-2026" } }) }, deps, actions);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("gitti-2026");
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain("gitti-2026");
    const ok = await handleApi({ method: "POST", authorization: "Bearer good", appCheck: "", body: JSON.stringify({ name: "setStaffPassword", data: { userId: "uSup", password: "abc" } }) }, { ...deps, auth: fakeAuth() as never }, actions);
    expect(ok.status).toBe(400);
    expect("error" in ok.body && ok.body.error.details).toEqual({ fields: { password: "Use at least 8 letters or numbers." } });
  });
});

describe("usageCounts (staff.ts)", () => {
  it("ST-10 the owner gets every main collection's count, the files' count and bytes, and today's counter, by counting (never by reading records)", async () => {
    const docs = { ...people(), "usage_daily/2026-11-16": { reads: 1234, writes: 56 } };
    const db = fakeDb(docs, { expenses: 420, attendance: 9000, audit_log: 77 }, { files: 31, bytes: 3_100_000 });
    const out = await usageCounts(db as never, OWNER, NOW);
    expect(out.counts).toMatchObject({ expenses: 420, attendance: 9000, audit_log: 77, clients: 0 });
    expect(Object.keys(out.counts)).toContain("users");
    expect(out.files).toEqual({ files: 31, bytes: 3_100_000 });
    expect(out.day).toEqual({ date: "2026-11-16", reads: 1234, writes: 56 });
    expect(out.at).toBe("2026-11-16T09:00:00.000Z");
    expect(db.counted).toContain("files:aggregate");
    expect(db.counted.filter((c) => !c.includes(":")).sort()).toEqual(Object.keys(out.counts).sort());
  });

  it("ST-11 with no counter for today the day is null; a counter with only writes says reads were not counted", async () => {
    const none = await usageCounts(fakeDb(people()) as never, OWNER, NOW);
    expect(none.day).toBeNull();
    const writesOnly = await usageCounts(fakeDb({ ...people(), "usage_daily/2026-11-16": { writes: 9 } }) as never, OWNER, NOW);
    expect(writesOnly.day).toEqual({ date: "2026-11-16", reads: null, writes: 9 });
    // 20:00 UTC is already the next day in India.
    const late = await usageCounts(fakeDb({ ...people(), "usage_daily/2026-11-17": { writes: 2 } }) as never, OWNER, () => new Date("2026-11-16T20:00:00.000Z"));
    expect(late.day?.date).toBe("2026-11-17");
  });

  it("ST-12 everyone but an owner who is switched on is refused, and nothing is counted", async () => {
    for (const uid of ["uAcc", "uSup", "uOff", "uNobody"]) {
      const db = fakeDb(people());
      expect(await refusal(usageCounts(db as never, { uid }, NOW))).toBe("Only the owner can see how much of the free plan is used.");
      expect(db.counted).toEqual([]);
    }
  });
});
