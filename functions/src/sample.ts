/**
 * Sample data for a real, empty project (M1.6): the same demo set the demo mode shows (PRD §17), written into the user's
 * own Firestore so the dashboards have something to draw. It is only ever started by a super user pressing the button
 * (never automatically), needs a sign-in within 5 minutes like every Setup change (D-48), is flagged `isSample: true` on
 * every document, and "Remove sample data" deletes exactly those. It refuses to mix with real records: it loads only
 * into an empty project and removes only while nothing of the user's own has been added, so the totals stay true.
 * The demo people, settings and expense heads are not copied (the real ones already exist).
 */
import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { CommandError, seedDemo, todayIST, type Doc } from "@ag/core";
import { requireFreshSignIn, requireSuperUser, type Caller } from "./setup";

/** Not copied from the demo set: the real project has its own. */
const SKIP = new Set(["users", "settings", "expense_categories", "meta", "audit_log", "processed_events", "command_requests"]);
/** Where the user's own records would be: if any exists besides the sample, the project is not empty. */
const OWN = ["projects", "clients", "workers", "expenses", "invoices", "attendance", "worker_payments", "vendor_bills", "accounts"];

export interface SampleStatus {
  loaded: boolean;
  state?: "loading" | "loaded";
  at?: string;
  counts?: Record<string, number>;
  /** Records that are not sample: loading and removing are both refused while there are any. */
  hasOwnRecords: boolean;
}

const marker = (db: Firestore) => db.doc("meta/sampleData");
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function hasOwnRecords(db: Firestore): Promise<boolean> {
  const counts = await Promise.all(OWN.map(async (c) => {
    const [all, sample] = await Promise.all([db.collection(c).count().get(), db.collection(c).where("isSample", "==", true).count().get()]);
    return all.data().count - sample.data().count;
  }));
  return counts.some((n) => n > 0);
}

export async function sampleStatus(db: Firestore, caller: Caller): Promise<SampleStatus> {
  await requireSuperUser(db, caller);
  const [m, own] = await Promise.all([marker(db).get(), hasOwnRecords(db)]);
  const d = m.data() as { state?: "loading" | "loaded"; at?: string; counts?: Record<string, number> } | undefined;
  return { loaded: m.exists, ...(d?.state ? { state: d.state } : {}), ...(d?.at ? { at: d.at } : {}), ...(d?.counts ? { counts: d.counts } : {}), hasOwnRecords: own };
}

async function audit(db: Firestore, caller: Caller, action: string, counts: Record<string, number>, nowIso: string) {
  await db.doc(`audit_log/${randomBytes(10).toString("hex")}`).set({ entity: "sampleData", entityId: "sampleData", action, counts, by: caller.uid, at: nowIso });
}

export async function loadSample(db: Firestore, caller: Caller, now: () => Date = () => new Date()): Promise<SampleStatus> {
  await requireSuperUser(db, caller);
  requireFreshSignIn(caller, () => now().getTime());
  if ((await marker(db).get()).exists) throw new CommandError("Sample data is already in this project. Remove it first to load it again.");
  if (await hasOwnRecords(db)) throw new CommandError("This project already has your own records. Sample data can only be added to an empty project, so your totals stay true.");
  const nowIso = now().toISOString();
  // The marker goes first, so a load that stops half way can still be removed.
  await marker(db).set({ id: "sampleData", state: "loading", at: nowIso, by: caller.uid });
  const { store } = await seedDemo(todayIST());
  const writer = db.bulkWriter();
  let failed = 0;
  const counts: Record<string, number> = {};
  for (const [col, docs] of Object.entries(store.snapshot())) {
    const top = col.split("/")[0]!;
    if (SKIP.has(top)) continue;
    for (const d of docs as Doc[]) {
      writer.set(db.doc(`${col}/${d.id}`), { ...clean(d), isSample: true }).catch(() => { failed++; });
      counts[top] = (counts[top] ?? 0) + 1;
    }
  }
  await writer.close();
  if (failed) throw new CommandError(`${failed} sample records could not be written. Choose Remove sample data, then try again.`);
  await marker(db).set({ id: "sampleData", state: "loaded", at: nowIso, by: caller.uid, counts });
  await audit(db, caller, "load", counts, nowIso);
  return sampleStatus(db, caller);
}

export async function removeSample(db: Firestore, caller: Caller, now: () => Date = () => new Date()): Promise<SampleStatus> {
  await requireSuperUser(db, caller);
  requireFreshSignIn(caller, () => now().getTime());
  const m = await marker(db).get();
  if (!m.exists) throw new CommandError("There is no sample data to remove.");
  if (await hasOwnRecords(db)) {
    throw new CommandError("You have added your own records since the sample was loaded. To keep your totals true, sample data can only be removed while nothing else has been added.");
  }
  const writer = db.bulkWriter();
  let failed = 0;
  const removed: Record<string, number> = {};
  const { store } = await seedDemo(todayIST());
  const tops = [...new Set(Object.keys(store.snapshot()).map((c) => c.split("/")[0]!))].filter((t) => !SKIP.has(t));
  for (const top of tops) {
    const snap = await db.collection(top).where("isSample", "==", true).select().get();
    for (const d of snap.docs) { db.recursiveDelete(d.ref, writer).catch(() => { failed++; }); removed[top] = (removed[top] ?? 0) + 1; }
  }
  await writer.close();
  if (failed) throw new CommandError(`${failed} sample records could not be removed. Try Remove sample data again.`);
  await marker(db).delete();
  await audit(db, caller, "remove", removed, now().toISOString());
  return sampleStatus(db, caller);
}
