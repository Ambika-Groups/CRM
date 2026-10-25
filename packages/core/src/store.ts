/**
 * In-memory document store with Firestore-like paths ("collection/id", sub-collections allowed).
 * Implements PostingTx so demo mode and tests run the exact posting engine production uses.
 * Demo mode persists it to IndexedDB (web/src/data/demo); Cloud Functions use Firestore instead.
 */
import type { AccountTxn } from "./model";
import { rollupMeta } from "./rollups";
import { post, type PostableEntity, type Posting, type PostingTx, type PostResult } from "./posting";

export type Doc = Record<string, unknown> & { id: string };

function setPath(obj: Record<string, unknown>, path: string, fn: (v: unknown) => unknown) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (typeof o[k] !== "object" || o[k] === null) o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1]!;
  o[last] = fn(o[last]);
}

export function getPath(obj: unknown, path: string): unknown {
  let o: unknown = obj;
  for (const k of path.split(".")) {
    if (typeof o !== "object" || o === null) return undefined;
    o = (o as Record<string, unknown>)[k];
  }
  return o;
}

/** An equality a list filter implies, so a server can query just those documents. */
export interface ListHint { field: string; value: unknown }

export type ChangeListener = (collection: string, id: string, doc: Doc | null) => void;

/** One document a command changed: its state before the command and after it (null = absent). */
export interface JournalEntry { collection: string; id: string; before: Doc | null; after: Doc | null }

export class MemoryStore {
  /** collection path → id → doc */
  readonly data = new Map<string, Map<string, Doc>>();
  private listeners = new Set<ChangeListener>();
  /** While a command runs: path → the document as it was before the command first touched it. */
  private journal: Map<string, { collection: string; id: string; before: Doc | null }> | null = null;

  /** Start recording every write (core runCommand: audit, rollback, and the server's transaction writes). */
  beginJournal(): void { this.journal = new Map(); }

  /** What changed since beginJournal, with the state before and after; recording goes on. */
  peekJournal(): JournalEntry[] {
    return [...(this.journal?.values() ?? [])]
      .map((e) => ({ ...e, after: (this.data.get(e.collection)?.get(e.id) as Doc | undefined) ?? null }))
      .filter((e) => JSON.stringify(e.before) !== JSON.stringify(e.after));
  }

  /** What changed since beginJournal, with the state before and after; stops recording. */
  endJournal(): JournalEntry[] {
    const out = this.peekJournal();
    this.journal = null;
    return out;
  }

  /** Undo every write since beginJournal (a command that failed part-way leaves nothing behind). */
  rollback(): void {
    const j = this.journal;
    this.journal = null;
    if (!j) return;
    for (const e of j.values()) {
      if (e.before) { this.col(e.collection).set(e.id, e.before); this.emit(e.collection, e.id, e.before); }
      else { this.data.get(e.collection)?.delete(e.id); this.emit(e.collection, e.id, null); }
    }
  }

  private touch(collection: string, id: string) {
    const key = `${collection}/${id}`;
    if (this.journal && !this.journal.has(key)) this.journal.set(key, { collection, id, before: structuredClone(this.data.get(collection)?.get(id) ?? null) });
  }

  onChange(fn: ChangeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(collection: string, id: string, doc: Doc | null) {
    for (const l of this.listeners) l(collection, id, doc);
  }

  private col(collection: string): Map<string, Doc> {
    let c = this.data.get(collection);
    if (!c) { c = new Map(); this.data.set(collection, c); }
    return c;
  }

  static split(docPath: string): { collection: string; id: string } {
    const i = docPath.lastIndexOf("/");
    return { collection: docPath.slice(0, i), id: docPath.slice(i + 1) };
  }

  get<T = Doc>(collection: string, id: string): T | null {
    return (this.data.get(collection)?.get(id) as T | undefined) ?? null;
  }

  getPath<T = Doc>(docPath: string): T | null {
    const { collection, id } = MemoryStore.split(docPath);
    return this.get<T>(collection, id);
  }

  /**
   * Documents of a collection, optionally filtered. `hint` names an equality the filter implies; in memory it
   * also filters, and on the server it lets the faulting store load only the matching documents (M1.6).
   */
  list<T = Doc>(collection: string, filter?: (d: T) => boolean, hint?: ListHint): T[] {
    let all = [...(this.data.get(collection)?.values() ?? [])] as unknown as T[];
    if (hint) all = all.filter((d) => getPath(d, hint.field) === hint.value);
    return filter ? all.filter(filter) : all;
  }

  set(collection: string, doc: Doc): void {
    this.touch(collection, doc.id);
    const copy = structuredClone(doc);
    this.col(collection).set(doc.id, copy);
    this.emit(collection, doc.id, copy);
  }

  merge(collection: string, id: string, patch: Record<string, unknown>): Doc {
    const cur = this.get(collection, id) ?? { id };
    this.touch(collection, id);
    const next = { ...structuredClone(cur), ...structuredClone(patch), id } as Doc;
    this.col(collection).set(id, next);
    this.emit(collection, id, next);
    return next;
  }

  delete(collection: string, id: string): void {
    this.touch(collection, id);
    this.data.get(collection)?.delete(id);
    this.emit(collection, id, null);
  }

  increment(docPath: string, fieldPath: string, delta: number): void {
    const { collection, id } = MemoryStore.split(docPath);
    const existing = this.get(collection, id);
    this.touch(collection, id);
    const cur = structuredClone(existing ?? (collection === "rollups" || collection === "finance_rollups" ? { id, ...rollupMeta(id) } : { id }));
    setPath(cur, fieldPath, (v) => (typeof v === "number" ? v : 0) + delta);
    this.col(collection).set(id, cur);
    this.emit(collection, id, cur);
  }

  /** Run the posting engine for one record against this store. */
  async post(entity: PostableEntity, docId: string, nowIso = new Date().toISOString()): Promise<PostResult> {
    const s = this;
    const tx: PostingTx = {
      getSource: async (e, id) => s.get(e, id),
      getPosting: async (id) => s.get<Posting & { id: string }>("postings", id),
      getAccountTxn: async (id) => s.get<AccountTxn>("account_transactions", id),
      isLocked: async (m) => s.get("period_locks", m) !== null,
      increment: (d, f, v) => s.increment(d, f, v),
      putAccountTxn: (t) => s.set("account_transactions", t as unknown as Doc),
      deleteAccountTxn: (id) => s.delete("account_transactions", id),
      putPosting: (id, p) => s.set("postings", { id, ...p } as unknown as Doc),
      setSourceField: (e, id, f, v) => { s.merge(e, id, { [f]: v }); },
    };
    return post(tx, entity, docId, nowIso);
  }

  /** Plain JSON snapshot (for persistence and tests). */
  snapshot(): Record<string, Doc[]> {
    const out: Record<string, Doc[]> = {};
    for (const [c, m] of this.data) out[c] = [...m.values()];
    return out;
  }

  load(snapshot: Record<string, Doc[]>): void {
    this.data.clear();
    for (const [c, docs] of Object.entries(snapshot)) {
      const m = new Map<string, Doc>();
      for (const d of docs) m.set(d.id, d);
      this.data.set(c, m);
    }
  }
}
