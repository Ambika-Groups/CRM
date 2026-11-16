/**
 * The `command` callable's work (M1.6, D-37): run one core command for a signed-in person inside a Firestore
 * transaction. Kept apart from the callable wrapper so the emulator tests can call it directly.
 *
 * How it stays correct:
 *  - The person's role and projects come from their users document, not from the token, so a switched-off or
 *    demoted person is refused at once (the token can be up to an hour old).
 *  - `runWithLoads` runs the shared core command on an empty in-memory store, loads exactly what it asked for
 *    (inside this transaction, so the reads are locked), and runs it again until it misses nothing. The final
 *    run's changes are then written in the same transaction: posting, numbering, rollups and audit included.
 *  - A request id makes a retry safe: the same id returns the first result instead of running the command twice.
 *  - After the commit, sign-in claims (role and projects) are re-synced for anyone whose role, status or
 *    assignments changed (D-05), and a newly added person gets their sign-in account.
 */
import { FieldValue, Timestamp, type DocumentData, type Firestore, type Query, type Transaction } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import {
  CommandError, COMMANDS, claimsFor, runWithLoads, todayIST, usersToResync,
  type CommandName, type Doc, type JournalEntry, type Loaded, type Loader, type LoadPlan, type ListNeed, type User,
} from "@ag/core";

export interface CommandRequest { uid: string; name: string; args: unknown; requestId: string }
/** `touched`: the collections the command changed, so the page re-reads only those ("*" when it cannot tell: a repeated request). */
export interface CommandOutcome { result: unknown; replayed: boolean; touched: string[] }

/** The collections a set of changes touched, each once. */
export const touchedBy = (changes: JournalEntry[]): string[] => [...new Set(changes.map((c) => c.collection))].sort();

/** Firestore's transaction allows 500 writes; leave room for the request record and the audit entry. */
const MAX_WRITES = 480;
/** A whole-collection read on the server is only for small collections; this stops a runaway one. */
const MAX_WHOLE_READ = 3000;
const REQUEST_KEEP_DAYS = 7;

/** Firestore timestamps become ISO strings, so core code (which stores ISO strings) sees one shape. */
export function plain(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plain(x)]));
  }
  return v;
}

export const docOf = (id: string, data: DocumentData | undefined): Doc => ({ ...(plain(data ?? {}) as Record<string, unknown>), id });

class TxLoader implements Loader {
  constructor(private db: Firestore, private tx: Transaction) {}

  private query(need: ListNeed): Query {
    const col = this.db.collection(need.collection);
    return need.hint ? col.where(need.hint.field, "==", need.hint.value) : col;
  }

  async load(plan: LoadPlan, into: Loaded): Promise<void> {
    const refs = plan.docs.map((d) => this.db.doc(`${d.collection}/${d.id}`));
    const [docs, ...lists] = await Promise.all([
      refs.length ? this.tx.getAll(...refs) : Promise.resolve([]),
      ...plan.lists.map((n) => this.tx.get(this.query(n))),
    ]);
    plan.docs.forEach((d, i) => {
      const snap = docs[i]!;
      into.addDoc(d.collection, d.id, snap.exists ? docOf(snap.id, snap.data()) : null);
    });
    plan.lists.forEach((n, i) => {
      const snap = lists[i]!;
      if (!n.hint && snap.size > MAX_WHOLE_READ) throw new Error(`${n.collection} is too large to read whole.`);
      into.addList(n, snap.docs.map((d) => docOf(d.id, d.data())));
    });
  }
}

/** The plain-words refusal for a sign-in account that could not be made. */
function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "auth/email-already-exists") return "Someone already has an account with this email.";
  if (code === "auth/phone-number-already-exists") return "Someone already has an account with this phone number.";
  if (code === "auth/invalid-email") return "Enter an email address like name@example.com.";
  if (code === "auth/invalid-phone-number") return "Enter a 10-digit mobile number.";
  return "The sign-in account could not be created. Nothing was saved. Try again.";
}

function writeChanges(db: Firestore, tx: Transaction, changes: JournalEntry[]) {
  for (const c of changes) {
    const ref = db.doc(`${c.collection}/${c.id}`);
    if (c.after) tx.set(ref, c.after);
    else tx.delete(ref);
  }
}

/** Re-sync sign-in claims from the users documents. A person who is switched off cannot sign in. */
export async function syncClaims(db: Firestore, auth: Auth, uids: string[]): Promise<void> {
  for (const uid of uids) {
    const snap = await db.doc(`users/${uid}`).get();
    const claims = claimsFor(snap.exists ? (snap.data() as User) : null);
    try {
      await auth.setCustomUserClaims(uid, claims);
      await auth.updateUser(uid, { disabled: !claims });
      if (!claims) await auth.revokeRefreshTokens(uid);
    } catch (e) {
      // A users document that never had a sign-in account (older data) has nothing to sync.
      if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
      continue;
    }
    // Open sessions watch this field and refresh their token when it changes.
    if (snap.exists) await snap.ref.update({ claimsAt: Timestamp.now() });
  }
}

export async function executeCommand(db: Firestore, auth: Auth, req: CommandRequest, now: () => Date = () => new Date()): Promise<CommandOutcome> {
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, req.name)) throw new CommandError("This action isn't available.");
  const name = req.name as CommandName;

  const out = await db.runTransaction(async (tx) => {
    const reqRef = db.doc(`command_requests/${req.requestId}`);
    const snaps = await tx.getAll(reqRef, db.doc(`users/${req.uid}`));
    const dup = snaps[0]!, userSnap = snaps[1]!;
    if (dup.exists) {
      if (dup.get("uid") !== req.uid) throw new CommandError("This request was already used.");
      return { replayed: true as const, result: dup.get("result") as unknown ?? null, changes: [] as JournalEntry[] };
    }
    const user = userSnap.exists ? (userSnap.data() as User) : null;
    if (!user || !user.active) throw new CommandError("Your account is switched off. Ask the owner to switch it on.");
    const nowIso = now().toISOString();
    const ctx = { uid: req.uid, role: user.role, projectIds: user.projectIds ?? [], nowIso, superUser: user.role === "owner" && user.superUser === true };

    const { result, changes } = await runWithLoads(new TxLoader(db, tx), name, req.args as never, ctx);
    if (changes.length > MAX_WRITES) throw new CommandError("This changes too many records at once. Do it in smaller parts.");
    writeChanges(db, tx, changes);
    // The usage meter (D-51): how many records the server wrote today (the request record and this counter included).
    tx.set(db.doc(`usage_daily/${todayIST(now())}`), { writes: FieldValue.increment(changes.length + 2) }, { merge: true });
    tx.set(reqRef, { uid: req.uid, name, at: nowIso, result: (result ?? null) as unknown, expireAt: Timestamp.fromMillis(now().getTime() + REQUEST_KEEP_DAYS * 86_400_000) });
    return { replayed: false as const, result: (result ?? null) as unknown, changes };
  });

  if (out.replayed) return { result: out.result, replayed: true, touched: ["*"] };

  // A new person gets their sign-in account, with the same id as their users document.
  if (name === "createUser") {
    const id = out.result as string;
    const created = out.changes.find((c) => c.collection === "users" && c.id === id)?.after as (Doc & { email?: string; phone?: string; name?: string }) | null | undefined;
    try {
      await auth.createUser({ uid: id, email: created?.email || undefined, phoneNumber: created?.phone || undefined, displayName: created?.name || undefined });
    } catch (e) {
      // Undo the commit: the person was never really added.
      const batch = db.batch();
      for (const c of out.changes) if (c.before === null) batch.delete(db.doc(`${c.collection}/${c.id}`));
      batch.delete(db.doc(`command_requests/${req.requestId}`));
      await batch.commit();
      throw new CommandError(authMessage(e));
    }
  }

  const uids = usersToResync(out.changes);
  if (uids.length) await syncClaims(db, auth, uids);
  return { result: out.result, replayed: false, touched: touchedBy(out.changes) };
}
