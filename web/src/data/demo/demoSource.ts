/**
 * Demo mode (decisions D-37): the spec §17 test data in the browser, persisted to IndexedDB, running the
 * same packages/core posting, numbering, rollup, wage and command code as production. Reads are filtered
 * with the same role matrix the Firestore rules enforce (core/roles canRead). Never used when Firebase
 * config exists.
 */
import {
  canRead, CommandError, MemoryStore, runCommand, runCount, runQuery, seedDemo, SMALL_COLLECTIONS, todayIST,
  type CommandArgs, type CommandName, type CommandResult, type Doc, type Page, type QuerySpec, type User, type Where, Persister } from "@ag/core";
import { openDB, type IDBPDatabase } from "idb";
import { DemoSetup } from "./demoSetup";
import { DemoFiles } from "../files/demoFiles";
import { isSmallCollection, type DataSource, type Session } from "../types";

const DB_NAME = "ag-crm-demo";
const STORE = "snapshot";
const KEY = "v1";
const SESSION_KEY = "ag-demo-uid";
/** Bump when the seed changes shape, so browsers reseed. */
export const DEMO_SEED_VERSION = 7;

/** Map a collection path to the key the role matrix uses. */
function matrixKey(collection: string, id: string): string {
  const parts = collection.split("/");
  if (parts[0] === "projects" && parts[2] === "private") return `projects/private/${id}`;
  if (parts[0] === "workers" && parts[2] === "private") return `workers/private/${id}`;
  return parts[parts.length - 1]!;
}

/** Project subcollection docs carry projectId so the matrix can check assignment. */
function withProject(collection: string, doc: Doc): Doc {
  const parts = collection.split("/");
  return parts[0] === "projects" && parts.length === 3 && !doc.projectId ? { ...doc, projectId: parts[1] } : doc;
}

export class DemoSource implements DataSource {
  readonly mode = "demo" as const;
  readonly setup = new DemoSetup();
  private store = new MemoryStore();
  private db: IDBPDatabase | null = null;
  private listeners = new Set<() => void>();
  private uid: string | null = null;
  // Write-behind saving; every command awaits flush() so a save is durable before the UI moves on (QA N1).
  private persister = new Persister(() => this.persistNow(), 400);
  /** Photos and documents, kept in the demo store so they survive a reload like everything else. */
  readonly files = new DemoFiles(this.store, () => this.ctx(), () => this.persister.flush());

  async init(): Promise<void> {
    try {
      this.db = await openDB(DB_NAME, 1, { upgrade: (db) => db.createObjectStore(STORE) });
    } catch {
      this.db = null; // private browsing: the demo still runs, it just isn't kept
    }
    const saved = this.db ? ((await this.db.get(STORE, KEY)) as { version: number; data: Record<string, Doc[]> } | undefined) : undefined;
    if (saved && saved.version === DEMO_SEED_VERSION) this.store.load(saved.data);
    else await this.seed();
    try { this.uid = localStorage.getItem(SESSION_KEY); } catch { this.uid = null; }
    if (!this.uid || !this.store.get("users", this.uid)) this.uid = "uOwner";
    this.store.onChange(() => this.changed());
    // Best effort if the tab closes inside the debounce window; commands never rely on it.
    window.addEventListener("pagehide", () => { void this.persister.flush(); });
  }

  private async seed() {
    const { store } = await seedDemo(todayIST());
    this.store.load(store.snapshot());
    await this.persistNow();
  }

  private changed() {
    this.readableCache.clear();
    for (const l of this.listeners) l();
    this.persister.schedule();
  }

  private async persistNow() {
    if (!this.db) return;
    await this.db.put(STORE, { version: DEMO_SEED_VERSION, data: this.store.snapshot() }, KEY);
  }

  session(): Session | null {
    const u = this.uid ? this.store.get<User>("users", this.uid) : null;
    if (!u) return null;
    return { uid: u.id, name: u.name, role: u.role, projectIds: u.projectIds ?? [], language: u.language, theme: u.theme, superUser: u.role === "owner" && u.superUser === true };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private ctx() {
    const s = this.session();
    return s ? { role: s.role, uid: s.uid, assignedProjectIds: s.projectIds } : null;
  }

  // Role-filtered lists, cached until the data or the signed-in person changes (dashboards run many counts).
  private readableCache = new Map<string, Doc[]>();

  private readable(collection: string): Doc[] {
    const c = this.ctx();
    if (!c) return [];
    const key = `${c.uid}|${collection}`;
    const hit = this.readableCache.get(key);
    if (hit) return hit;
    const list = this.store.list<Doc>(collection).filter((d) => canRead(matrixKey(collection, d.id), withProject(collection, d), c));
    this.readableCache.set(key, list);
    return list;
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const c = this.ctx();
    const d = this.store.get<Doc>(collection, id);
    if (!c || !d) return null;
    return canRead(matrixKey(collection, id), withProject(collection, d), c) ? (structuredClone(d) as unknown as T) : null;
  }

  async docStatus(collection: string, id: string): Promise<"ok" | "missing" | "denied"> {
    const c = this.ctx();
    const d = this.store.get<Doc>(collection, id);
    if (!d || d.isDeleted) return "missing";
    return c && canRead(matrixKey(collection, id), withProject(collection, d), c) ? "ok" : "denied";
  }

  async getMany<T>(collection: string, ids: string[]): Promise<(T | null)[]> {
    return Promise.all(ids.map((id) => this.get<T>(collection, id)));
  }

  async query<T extends { id: string }>(collection: string, spec: QuerySpec): Promise<Page<T>> {
    // runQuery enforces the 1–50 limit (rule 9).
    return structuredClone(runQuery(this.readable(collection) as unknown as T[], spec));
  }

  async count(collection: string, where: Where[] = []): Promise<number> {
    return runCount(this.readable(collection), where);
  }

  async listSmall<T>(collection: string): Promise<T[]> {
    if (!isSmallCollection(collection, SMALL_COLLECTIONS)) {
      throw new Error(`${collection} isn't a small collection; page through it with query() (spec §3.1 rule 9).`);
    }
    if (collection === "users") {
      // Everyone can see names and roles for assignment pickers; contact details only for finance roles.
      const s = this.session();
      const finance = s?.role === "owner" || s?.role === "accountant";
      return this.store.list<User>("users").map((u) => (finance ? structuredClone(u) : { id: u.id, name: u.name, role: u.role, active: u.active })) as T[];
    }
    if (collection === "expense_categories" || collection === "settings" || collection === "period_locks" || collection === "meta") {
      return structuredClone(this.store.list<T>(collection));
    }
    return structuredClone(this.readable(collection) as unknown as T[]);
  }

  async run<N extends CommandName>(name: N, args: CommandArgs<N>): Promise<CommandResult<N>> {
    const s = this.session();
    if (!s) throw new CommandError("Sign in first.");
    // The same runner as the server (core runner.ts): all or nothing, and audited.
    const { result } = await runCommand(this.store, name, args, { uid: s.uid, role: s.role, projectIds: s.projectIds, nowIso: new Date().toISOString() });
    await this.persister.flush();
    return result;
  }

  async setPreference(patch: Partial<Pick<Session, "theme" | "language">>): Promise<void> {
    if (this.uid) this.store.merge("users", this.uid, patch);
    await this.persister.flush();
  }

  /** Resolves when every change so far is saved on this device. */
  flush(): Promise<void> {
    return this.persister.flush();
  }

  demoUsers(): User[] {
    const order = ["owner", "accountant", "pm", "supervisor", "viewer", "ca"];
    return this.store.list<User>("users").sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));
  }

  async switchUser(uid: string): Promise<void> {
    if (!this.store.get("users", uid)) return;
    this.uid = uid;
    try { localStorage.setItem(SESSION_KEY, uid); } catch { /* ignore */ }
    for (const l of this.listeners) l();
  }

  async reset(): Promise<void> {
    await this.seed();
    for (const l of this.listeners) l();
  }

  /** Dataset facts for the demo panel on Home (not role-filtered; demo only). */
  rawCount<T>(collection: string, filter?: (d: T) => boolean): number {
    return this.store.list<T>(collection, filter).length;
  }

  rawDistinct<T>(collection: string, key: (d: T) => unknown): number {
    return new Set(this.store.list<T>(collection).map(key)).size;
  }
}
