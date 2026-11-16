/**
 * Staff sign-in accounts and the usage counts (D-51, free plan), for the owner.
 *
 *  - `setStaffPassword`: the owner sets or resets a person's password. The person then signs in with their email, or,
 *    with no email, their 10-digit mobile (the account's email is `<mobile>@staff.ambika`). The password goes straight
 *    to the sign-in account: it is never written to the database, the audit log or the server's log.
 *  - `usageCounts`: how many records each main collection holds, how much the kept files take, and today's counter, in
 *    one call (a count costs one read per thousand records).
 *
 * Who may call is decided from the caller's users document, never from the request.
 */
import { AggregateField, type Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { checkStaffPassword, CommandError, newId, staffLoginFor, todayIST, USAGE_COLLECTIONS, USAGE_DAILY_COLLECTION, usageDayId, type User } from "@ag/core";
// The admin rules live in the core package; this path is used until `export * from "./admin"` is in core's index.ts.

export interface StaffCaller { uid: string }

/** The caller's users document, when they are an owner who is switched on. Anyone else is refused. */
export async function requireOwner(db: Firestore, caller: StaffCaller, what: string): Promise<User> {
  const snap = await db.doc(`users/${caller.uid}`).get();
  const u = snap.exists ? (snap.data() as User) : null;
  if (!u || !u.active || u.role !== "owner") throw new CommandError(`Only the owner can ${what}.`);
  return u;
}

export interface StaffPasswordResult {
  /** The email of the sign-in account. */
  loginEmail: string;
  /** What the person types to sign in: their email, or their 10-digit mobile. */
  signInWith: string;
  /** True when the sign-in account did not exist and was made now. */
  created: boolean;
}

const authCode = (e: unknown): string => (e as { code?: string } | null)?.code ?? "";

/** Set or reset a person's password (owner only). Makes sure their sign-in account exists and uses their login email. */
export async function setStaffPassword(db: Firestore, auth: Auth, caller: StaffCaller, data: { userId?: unknown; password?: unknown }, now: () => Date = () => new Date()): Promise<StaffPasswordResult> {
  const me = await requireOwner(db, caller, "set a person's password");
  const userId = typeof data.userId === "string" ? data.userId : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) throw new CommandError("Choose a person first.");
  if (userId === caller.uid) throw new CommandError("You can't set your own password here. Use \"Forgot password\" on the sign-in screen.");
  const snap = await db.doc(`users/${userId}`).get();
  const person = snap.exists ? (snap.data() as User) : null;
  if (!person) throw new CommandError("This person no longer exists.");
  // Another owner's password is a way into everything: only a super user may set it (D-48).
  if (person.role === "owner" && me.superUser !== true) throw new CommandError("Only a super user can set another owner's password.");
  const login = staffLoginFor(person);
  if (!login) throw new CommandError("This person has no email or mobile number. Add one first, so they have something to sign in with.");
  const problem = checkStaffPassword(data.password, person);
  if (problem) throw new CommandError(problem.message, { password: problem.message });
  const password = data.password as string;

  let created = false;
  try {
    let existing: { email?: string } | null = null;
    try { existing = await auth.getUser(userId); } catch (e) { if (authCode(e) !== "auth/user-not-found") throw e; }
    if (existing) {
      await auth.updateUser(userId, existing.email === login.email ? { password } : { email: login.email, password });
      // Anyone still signed in with the old password is signed out.
      await auth.revokeRefreshTokens(userId);
    } else {
      await auth.createUser({ uid: userId, email: login.email, password, displayName: person.name || undefined, disabled: !person.active });
      created = true;
    }
  } catch (e) {
    const code = authCode(e);
    if (code === "auth/email-already-exists") throw new CommandError("Another sign-in account already uses this email or mobile number. Change this person's email or mobile first.");
    if (code === "auth/invalid-password" || code === "auth/weak-password") throw new CommandError("This password was not accepted. Use at least 8 letters or numbers.", { password: "Use at least 8 letters or numbers." });
    if (code === "auth/invalid-email") throw new CommandError("This person's email is not a valid address. Correct it first.");
    // Rethrown without the request: the handler logs the action's name only.
    throw new Error(`staff password: ${code || "sign-in service failed"}`);
  }

  const at = now().toISOString();
  await db.doc(`users/${userId}`).set({ loginEmail: login.email, passwordSetAt: at, passwordSetBy: caller.uid }, { merge: true });
  // Who did it and for whom; never the password.
  await db.doc(`audit_log/${newId()}`).set({
    entity: "users", entityId: userId, action: "password", command: "setStaffPassword", fields: [], paths: [`users/${userId}`], projectId: null, by: caller.uid, at,
  });
  return { loginEmail: login.email, signInWith: login.signInWith, created };
}

export interface UsageCounts {
  /** Records per collection. */
  counts: Record<string, number>;
  /** Files kept inside the database and the bytes they take. */
  files: { files: number; bytes: number };
  /** Today's counter (IST day), when the server has counted anything today. */
  day: { date: string; reads: number | null; writes: number | null } | null;
  at: string;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The numbers behind the usage meter (owner only), in one call. */
export async function usageCounts(db: Firestore, caller: StaffCaller, now: () => Date = () => new Date()): Promise<UsageCounts> {
  await requireOwner(db, caller, "see how much of the free plan is used");
  const at = now();
  const date = todayIST(at);
  const [totals, fileAgg, daySnap] = await Promise.all([
    Promise.all(USAGE_COLLECTIONS.map((c) => db.collection(c).count().get())),
    db.collection("files").where("provider", "==", "inline").aggregate({ files: AggregateField.count(), bytes: AggregateField.sum("sizeBytes") }).get(),
    db.doc(`${USAGE_DAILY_COLLECTION}/${usageDayId(date)}`).get(),
  ]);
  const counts: Record<string, number> = {};
  USAGE_COLLECTIONS.forEach((c, i) => { counts[c] = num(totals[i]!.data().count); });
  const agg = fileAgg.data();
  const d = daySnap.exists ? (daySnap.data() as { reads?: unknown; writes?: unknown }) : null;
  return {
    counts,
    files: { files: num(agg.files), bytes: num(agg.bytes) },
    day: d ? { date, reads: typeof d.reads === "number" ? num(d.reads) : null, writes: typeof d.writes === "number" ? num(d.writes) : null } : null,
    at: at.toISOString(),
  };
}
