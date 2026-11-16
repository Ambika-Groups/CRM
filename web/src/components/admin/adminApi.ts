// What the admin screens ask of the data layer that the shared hooks do not cover: the two server actions of
// functions/src/staff.ts (set a person's password, count the records), their demo stand-ins, and reading every record
// for a backup. Demo mode: the password is a labelled simulation (nothing is stored) and the counts come from the demo store.
import { CommandError, readAnswer, ServerError, SMALL_COLLECTIONS, type Page } from "@ag/core";
import { getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { serverUrl } from "@/data/config";
import { isSmallCollection, type DataSource, type Session } from "@/data/types";
import {
  addToBackup, backupPlan, checkStaffPassword, markBackupFailed, newBackup, staffLoginFor, USAGE_COLLECTIONS,
  type Backup, type BackupRecord, type StaffPasswordCode,
} from "./core";

/** A failure the screens put in plain words: `admin.err.<code>`. */
export type AdminErrorCode = "offline" | "notConnected" | "denied" | "signedOut" | "other";
export class AdminError extends Error {
  constructor(readonly code: AdminErrorCode) { super(code); }
}

/** A weak password, with the code the screen translates (`admin.password.err.<code>`). */
export class PasswordProblem extends Error {
  constructor(readonly code: StaffPasswordCode, message: string) { super(message); }
}

const CALL_TIMEOUT_MS = 65_000;

/** One action of the server part, as the signed-in person (the same request the data layer makes for a save). */
async function serverCall<O>(name: string, data: unknown): Promise<O> {
  const app = getApps()[0];
  const user = app ? getAuth(app).currentUser : null;
  if (!user) throw new AdminError("signedOut");
  let res: Response;
  try {
    res = await fetch(serverUrl, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ name, data }), signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    throw new AdminError("offline");
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  try {
    return readAnswer<O>(res.status, body);
  } catch (e) {
    if (e instanceof ServerError) {
      // A plain-words refusal from the server is shown as it is, with its field messages.
      if (e.code === "failed-precondition" && e.message) throw new CommandError(e.message, e.details?.fields ?? {});
      if (e.code === "unavailable") throw new AdminError("offline");
      if (e.code === "not-found") throw new AdminError("notConnected");
      if (e.code === "unauthenticated") throw new AdminError("signedOut");
      if (e.code === "permission-denied") throw new AdminError("denied");
    }
    throw new AdminError("other");
  }
}

// ---------- staff password ----------

export interface PasswordResult { loginEmail: string; signInWith: string; simulated: boolean }

/**
 * Set or reset a person's password. Firebase mode: the server does it (owner only) and nothing about the password is
 * kept by the app. Demo mode: the same checks, then nothing at all happens; the screen labels it a simulation.
 */
export async function setStaffPassword(source: DataSource, person: { id: string; name?: string; email?: string; phone?: string }, password: string): Promise<PasswordResult> {
  const problem = checkStaffPassword(password, person);
  if (problem) throw new PasswordProblem(problem.code, problem.message);
  if (source.mode === "demo") {
    const login = staffLoginFor(person);
    if (!login) throw new CommandError("This person has no email or mobile number. Add one first, so they have something to sign in with.");
    return { loginEmail: login.email, signInWith: login.signInWith, simulated: true };
  }
  const out = await serverCall<{ loginEmail: string; signInWith: string }>("setStaffPassword", { userId: person.id, password });
  return { loginEmail: out.loginEmail, signInWith: out.signInWith, simulated: false };
}

// ---------- usage ----------

export interface UsageData {
  counts: Record<string, number>;
  files: { files: number; bytes: number };
  day: { reads?: number | null; writes?: number | null } | null;
  at: string;
}

/** Counts made from this browser: one count per collection (never the records themselves). What may not be counted is 0. */
async function countHere(source: DataSource): Promise<UsageData> {
  const totals = await Promise.all(USAGE_COLLECTIONS.map((c) => source.count(c).catch(() => 0)));
  const counts: Record<string, number> = {};
  USAGE_COLLECTIONS.forEach((c, i) => { counts[c] = totals[i] ?? 0; });
  const files = source.files ? await source.files.usage().catch(() => ({ files: 0, bytes: 0 })) : { files: 0, bytes: 0 };
  return { counts, files, day: null, at: new Date().toISOString() };
}

/** The numbers behind the meters. Firebase mode asks the server once; if it cannot answer, the browser counts instead. */
export async function loadUsage(source: DataSource): Promise<UsageData> {
  if (source.mode === "firebase") {
    try { return await serverCall<UsageData>("usageCounts", {}); } catch (e) { if (e instanceof AdminError && e.code === "signedOut") throw e; }
  }
  return countHere(source);
}

// ---------- backup ----------

export interface BackupProgress { collection: string; step: number; steps: number; records: number }

/** The most pages read from one collection (50 records each): a safety net, far above a real collection here. */
const MAX_PAGES = 4000;

async function readWhole(source: DataSource, collection: string, onPage: (docs: { id: string }[]) => void): Promise<void> {
  if (isSmallCollection(collection, SMALL_COLLECTIONS)) { onPage(await source.listSmall<{ id: string }>(collection)); return; }
  let after: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const pg: Page<{ id: string }> = await source.query<{ id: string }>(collection, { limit: 50, after });
    onPage(pg.items);
    if (!pg.next) return;
    after = pg.next;
  }
  throw new Error(`${collection} is too large`);
}

/**
 * Reads every collection of the backup plan, 50 records at a time, into `{ meta, collections }`. A collection that
 * cannot be read is listed in `meta.failed` and the rest carries on, so the owner still gets what could be read.
 */
export async function buildBackup(source: DataSource, session: Session, onProgress: (p: BackupProgress) => void): Promise<Backup> {
  const b = newBackup({ madeAt: new Date().toISOString(), by: session.uid, byName: session.name, mode: source.mode });
  const { steps } = backupPlan();
  for (const step of steps) {
    const tell = () => onProgress({ collection: step.collection, step: step.order, steps: steps.length, records: b.meta.total });
    tell();
    const parents: string[] = [];
    try {
      addToBackup(b, step.collection, []);
      await readWhole(source, step.collection, (docs) => { addToBackup(b, step.collection, docs); for (const d of docs) parents.push(d.id); tell(); });
    } catch {
      markBackupFailed(b, step.collection);
      continue;
    }
    // The small lists kept under each record (a project's workers and budget, a worker's pay): one read each.
    for (const id of step.children.length ? parents : []) {
      await Promise.all(step.children.map(async (child) => {
        const path = `${step.collection}/${id}/${child}`;
        try {
          const docs = await source.listSmall<{ id: string }>(path);
          if (docs.length) addToBackup(b, path, docs);
        } catch { markBackupFailed(b, step.collection); }
      }));
      tell();
    }
  }
  return b;
}

/** Counts for the note the CRM keeps: the lists under projects and workers are added up under one name each. */
export function backupCounts(b: Backup): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [path, n] of Object.entries(b.meta.counts)) {
    const parts = path.split("/");
    const key = parts.length >= 3 ? `${parts[0]}/${parts[parts.length - 1]}` : path;
    out[key] = (out[key] ?? 0) + n;
  }
  return out;
}

/** Notes that a backup was downloaded (core command `recordBackup`, owner only). */
export function recordBackup(source: DataSource, input: { counts: Record<string, number>; complete: boolean }): Promise<BackupRecord> {
  // The command's name joins the typed list when the lane lead adds ADMIN_COMMANDS to the registry.
  return (source as unknown as { run(name: string, args: unknown): Promise<BackupRecord> }).run("recordBackup", input);
}

/** The words for a failure: a refusal's own message, or `admin.err.<code>`. */
export function errorText(e: unknown, t: (key: string) => string): string {
  if (e instanceof PasswordProblem) return t(`admin.password.err.${e.code}`);
  if (e instanceof AdminError) return t(`admin.err.${e.code}`);
  if (e instanceof CommandError && e.message) return e.message;
  return e instanceof Error && e.message ? e.message : t("admin.err.other");
}
