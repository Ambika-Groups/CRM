/**
 * The nightly clean-up (D-51). The free Firebase plan has no automatic deletion (TTL), so records that only matter for a
 * few days are removed here: request records that make a retried save safe (`command_requests`) and processed-event
 * markers (`processed_events`), once their `expireAt` time has passed.
 *
 * It runs from the Netlify scheduled function each night, and from the owner's app when the last run is over a day old
 * (a scheduled function only runs on a published site). Each run does a bounded amount of work, so it always finishes
 * well inside the scheduled function's 30 seconds; whatever is left goes in the next run.
 */
import { Timestamp, type Firestore } from "firebase-admin/firestore";

/** Collections whose documents carry `expireAt` and are safe to delete after it. */
export const EXPIRING = ["command_requests", "processed_events"] as const;
/** Deletes per collection per run: one batch, far below the free plan's 20,000 deletes a day. */
export const CLEAN_BATCH = 400;

export interface CleanUpResult { at: string; removed: Record<string, number>; more: boolean }

export const maintenanceRef = (db: Firestore) => db.doc("system/maintenance");

export async function cleanUp(db: Firestore, now: () => Date = () => new Date()): Promise<CleanUpResult> {
  const at = now();
  const removed: Record<string, number> = {};
  let more = false;
  for (const name of EXPIRING) {
    const snap = await db.collection(name).where("expireAt", "<", Timestamp.fromDate(at)).limit(CLEAN_BATCH).get();
    removed[name] = snap.size;
    if (snap.size === CLEAN_BATCH) more = true;
    if (snap.empty) continue;
    const batch = db.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
  }
  const result: CleanUpResult = { at: at.toISOString(), removed, more };
  // The app reads this to decide whether a catch-up run is due, and the Setup page shows when it last ran.
  await maintenanceRef(db).set({ lastRunAt: result.at, removed, more });
  return result;
}
