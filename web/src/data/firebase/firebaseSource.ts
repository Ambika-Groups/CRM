/**
 * Firebase mode (decisions D-37, M1.6): Firestore with an offline copy on the device, Auth, App Check, Storage and the
 * callable functions, behind the same DataSource interface the screens use in demo mode. Reads go straight to
 * Firestore and are filtered by the security rules (which mirror core's canRead); every write is a command sent to the
 * `command` callable, which runs the same core code inside a transaction (posting, numbering, audit).
 *
 * Screens read through the same calls as the demo (rule 9: lists a page at a time, totals from counts and rollups).
 * Data is read again after this person's own commands and when the app returns to the foreground.
 */
import {
  assertLimit, CommandError, seedCategories, SMALL_COLLECTIONS, type CommandArgs, type CommandName, type CommandResult, type Page, type QuerySpec, type Where,
} from "@ag/core";
import {
  clearIndexedDbPersistence, collection, doc, documentId, getCountFromServer, getDoc, getDocs, getDocsFromCache, limit as fsLimit, orderBy, query as fsQuery,
  serverTimestamp, startAfter, terminate, updateDoc, where as fsWhere, type DocumentData, type QueryConstraint,
} from "firebase/firestore";
import { resolveConfig, serverUrl } from "../config";
import { isSmallCollection, type AuthApi, type DataSource, type SampleApi, type Session, type SetupApi } from "../types";
import { call, createClients, docData, isDenied, type Clients } from "./client";
import { FirebaseAuth } from "./firebaseAuth";
import { FirebaseSample, FirebaseSetup } from "./firebaseSetup";

const FINANCE_SETTINGS = ["company", "operations", "bank", "templates", "numbering", "deductionHeads"];
const OPEN_SETTINGS = ["company", "operations"];

/** Plain-words messages for a command that could not run. A refusal from the server (`failed-precondition`) keeps its fields. */
function commandError(e: unknown): Error {
  const err = e as { code?: string; message?: string; details?: { fields?: Record<string, string> } };
  const code = err?.code ?? "";
  if (code.endsWith("failed-precondition")) return new CommandError(err.message ?? "This could not be saved.", err.details?.fields ?? {});
  if (code.endsWith("unavailable") || code.endsWith("deadline-exceeded") || !navigator.onLine) return new CommandError("No connection to the server. Nothing was saved. Try again when you are online.");
  if (code.endsWith("not-found") || code.endsWith("internal")) return new CommandError("Saving this change needs the CRM's server part, which is not connected yet on the free Firebase plan (it moves to Netlify next). Nothing was saved.");
  if (code.endsWith("unauthenticated")) return new CommandError("You were signed out. Sign in again.");
  if (code.endsWith("permission-denied")) return new CommandError("You can't do this.");
  return new CommandError("Something went wrong on our side. Nothing was saved. Try again.");
}

/** A request id the server accepts (letters, digits, - and _, 8 to 64 long); a fresh one when none is given. */
const cleanRequestId = (id?: string): string => {
  const c = (id ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(-64);
  return c.length >= 8 ? c : randomId();
};

const randomId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2, 10)}`).replace(/[^A-Za-z0-9_-]/g, "");

export class FirebaseSource implements DataSource {
  readonly mode = "firebase" as const;
  auth!: AuthApi;
  setup!: SetupApi;
  sample!: SampleApi;
  private clients!: Clients;
  private fbAuth!: FirebaseAuth;
  private listeners = new Set<() => void>();
  private cached: Session | null = null;
  private countCache = new Map<string, { at: number; n: number }>();
  private hiddenAt = 0;

  async init(): Promise<void> {
    const r = resolveConfig();
    if (Object.keys(r.problems).length) throw new Error(`The Firebase settings are incomplete (missing: ${Object.keys(r.problems).join(", ")}). Check them in Netlify, or in Settings > Setup & integrations.`);
    this.clients = createClients(r.config, r.siteKey);
    this.fbAuth = new FirebaseAuth(this.clients, () => this.refreshSession(), () => this.clearLocal());
    this.auth = this.fbAuth;
    this.sample = new FirebaseSample(this.clients);
    this.setup = new FirebaseSetup(this.clients, this.fbAuth, () => this.fbAuth.currentUser()?.uid ?? "");
    await this.fbAuth.start();
    // Read again when the app comes back to the foreground after a while (other people have been working).
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.hiddenAt = Date.now();
      else if (this.hiddenAt && Date.now() - this.hiddenAt > 30_000) { this.countCache.clear(); this.bump(); }
    });
    window.addEventListener("online", () => this.bump());
  }

  /** Nothing of the last person's data stays on the device after sign-out. */
  private async clearLocal(): Promise<void> {
    try { await terminate(this.clients.db); await clearIndexedDbPersistence(this.clients.db); } catch { /* best effort */ }
  }

  // ---------- session ----------

  private refreshSession() {
    const claims = this.fbAuth.claims;
    const p = this.fbAuth.profile;
    const user = this.fbAuth.currentUser();
    this.cached = this.fbAuth.state().kind === "ready" && claims && user ? {
      uid: user.uid, name: p?.name || user.displayName || user.email || "", role: claims.role, projectIds: claims.projects,
      language: p?.language === "hi" ? "hi" : "en", theme: p?.theme ?? "system", superUser: claims.role === "owner" && claims.superUser,
    } : null;
    this.bump();
  }

  session(): Session | null { return this.cached; }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private bump() { for (const l of this.listeners) l(); }

  // ---------- reads ----------

  private ref(collectionPath: string, id: string) { return doc(this.clients.db, collectionPath, id); }

  async get<T>(collectionPath: string, id: string): Promise<T | null> {
    try {
      const s = await getDoc(this.ref(collectionPath, id));
      return s.exists() ? docData<T>(s.id, s.data()) : null;
    } catch (e) {
      if (isDenied(e)) return null;
      throw e;
    }
  }

  async docStatus(collectionPath: string, id: string): Promise<"ok" | "missing" | "denied"> {
    try {
      const s = await getDoc(this.ref(collectionPath, id));
      if (!s.exists() || (s.data() as DocumentData).isDeleted === true) return "missing";
      return "ok";
    } catch (e) {
      if (isDenied(e)) return "denied";
      throw e;
    }
  }

  async getMany<T>(collectionPath: string, ids: string[]): Promise<(T | null)[]> {
    return Promise.all(ids.map((id) => this.get<T>(collectionPath, id)));
  }

  /** Where clauses → Firestore. A range or "not equal" filter needs its own field first in the ordering. */
  private constraints(spec: Pick<QuerySpec, "where" | "orderBy">): { filters: QueryConstraint[]; order: QueryConstraint[] } {
    const wheres: Where[] = spec.where ?? [];
    const filters = wheres.map((w) => fsWhere(w.field, w.op, w.value));
    const orders = [...(spec.orderBy ?? [])];
    const range = wheres.find((w) => ["<", "<=", ">", ">=", "!="].includes(w.op));
    if (range && orders[0]?.field !== range.field) orders.unshift({ field: range.field, dir: "asc" });
    return { filters, order: orders.map((o) => orderBy(o.field, o.dir ?? "asc")) };
  }

  async query<T extends { id: string }>(collectionPath: string, spec: QuerySpec): Promise<Page<T>> {
    assertLimit(spec);
    const col = collection(this.clients.db, collectionPath);
    const { filters, order } = this.constraints(spec);
    const cursor: QueryConstraint[] = [];
    if (spec.after) {
      const at = await getDoc(this.ref(collectionPath, spec.after));
      if (at.exists()) cursor.push(startAfter(at));
    }
    const tail = order.length ? [] : [orderBy(documentId())];
    const snap = await getDocs(fsQuery(col, ...filters, ...order, ...tail, ...cursor, fsLimit(spec.limit + 1)));
    const more = snap.docs.length > spec.limit;
    const items = snap.docs.slice(0, spec.limit).map((d) => docData<T>(d.id, d.data()));
    const total = await this.countOf(collectionPath, spec.where ?? [], items.length + (more ? 1 : 0));
    return { items, next: more ? items[items.length - 1]?.id ?? null : null, total };
  }

  /** The number of matching documents: a server count, remembered for 30 seconds; offline, what the device holds. */
  private async countOf(collectionPath: string, wheres: Where[], fallback: number): Promise<number> {
    const key = `${collectionPath}|${JSON.stringify(wheres)}`;
    const hit = this.countCache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.n;
    try {
      const q = fsQuery(collection(this.clients.db, collectionPath), ...wheres.map((w) => fsWhere(w.field, w.op, w.value)));
      const n = (await getCountFromServer(q)).data().count;
      this.countCache.set(key, { at: Date.now(), n });
      return n;
    } catch {
      try {
        return (await getDocsFromCache(fsQuery(collection(this.clients.db, collectionPath), ...wheres.map((w) => fsWhere(w.field, w.op, w.value))))).size;
      } catch { return fallback; }
    }
  }

  async count(collectionPath: string, wheres: Where[] = []): Promise<number> {
    return this.countOf(collectionPath, wheres, 0);
  }

  async listSmall<T>(collectionPath: string): Promise<T[]> {
    if (!isSmallCollection(collectionPath, SMALL_COLLECTIONS)) {
      throw new Error(`${collectionPath} isn't a small collection; page through it with query() (spec §3.1 rule 9).`);
    }
    const s = this.cached;
    // The rules decide who may read which documents, and a list read is refused whole if any document is off limits,
    // so the settings and users lists are read document by document for what this role may see.
    if (collectionPath === "settings") {
      const ids = s && (s.role === "owner" || s.role === "accountant" || s.role === "ca") ? FINANCE_SETTINGS : OPEN_SETTINGS;
      const docs: (T | null)[] = await Promise.all(ids.map((id) => this.get<T>("settings", id)));
      return docs.filter((x) => x !== null) as T[];
    }
    if (collectionPath === "expense_categories") {
      let stored: { id: string }[] = [];
      try { stored = (await getDocs(collection(this.clients.db, collectionPath))).docs.map((d) => docData<{ id: string }>(d.id, d.data())); } catch (e) { if (!isDenied(e)) throw e; }
      const byId = new Map<string, unknown>(seedCategories().map((c) => [c.id, c]));
      for (const c of stored) byId.set(c.id, c);
      return [...byId.values()] as T[];
    }
    if (collectionPath === "users" && !(s?.role === "owner" || s?.role === "accountant")) {
      const me = s ? await this.get<T>("users", s.uid) : null;
      return me ? [me] : [];
    }
    try {
      return (await getDocs(collection(this.clients.db, collectionPath))).docs.map((d) => docData<T>(d.id, d.data()));
    } catch (e) {
      if (isDenied(e)) return [];
      throw e;
    }
  }

  // ---------- writes ----------

  async run<N extends CommandName>(name: N, args: CommandArgs<N>, requestId?: string): Promise<CommandResult<N>> {
    if (!this.cached) throw new CommandError("Sign in first.");
    // The server part (a Netlify Function, D-51) is not connected until NEXT_PUBLIC_API_URL is set: say so plainly, without a network call.
    if (!serverUrl) throw new CommandError("Saving this change needs the CRM's server part, which is not connected yet on the free Firebase plan (it moves to Netlify next). Nothing was saved.");
    try {
      const out = await call<unknown, { result: unknown }>(this.clients, "command")({ name, args, requestId: cleanRequestId(requestId) });
      this.countCache.clear();
      this.bump();
      return out.result as CommandResult<N>;
    } catch (e) { throw commandError(e); }
  }

  async setPreference(patch: Partial<Pick<Session, "theme" | "language">>): Promise<void> {
    const user = this.fbAuth.currentUser();
    if (!user || !this.cached) return;
    this.cached = { ...this.cached, ...patch };
    // The rules allow a person to change only their own language and theme, stamped with the server time.
    try { await updateDoc(doc(this.clients.db, "users", user.uid), { ...patch, updatedAt: serverTimestamp(), updatedBy: user.uid }); } catch { /* offline: kept by the device and sent later */ }
  }
}
