/**
 * Files in Firebase mode on the free plan (D-51: no Cloud Storage).
 *
 * Built-in store: `files/{id}` (name, size, kind, project, a small preview) and `file_blobs/{id}` (the bytes, as a
 * Firestore Bytes value of at most 700,000 bytes) are written together by the signed-in browser. Because they are
 * ordinary Firestore writes they also wait on the phone when it is offline and go up by themselves later; the security
 * rules check who may write and read them (the same answers as core's canAttachFile and canReadFile).
 *
 * When the owner has set up Cloudflare R2 or Cloudinary (Setup & integrations) and its Test has passed, new files go
 * there instead while the phone is online: R2 through a short-lived signed address from the server (`filesPresign`),
 * Cloudinary through its unsigned upload preset. Only `files/{id}` is written then. Offline, and for ID proofs with
 * Cloudinary, the built-in store is used. If the provider fails and the file is small enough, it is kept in the
 * built-in store rather than lost.
 */
import {
  canAttachFile, cloudinaryPublicId, cloudinaryUrl, FILE_BLOBS_COLLECTION, FILE_LIMITS, filePath, FILES_COLLECTION, parseFilePath, providerForUpload, toFileRef,
  type FileAccessCtx, type FileMeta, type FileProvider, type FileRef,
} from "@ag/core";
import {
  Bytes, collection, count, deleteDoc, doc, getAggregateFromServer, getDoc, getDocFromCache, query, serverTimestamp, setDoc, sum, where, writeBatch,
} from "firebase/firestore";
import { call, type Clients } from "../firebase/client";
import { newFileId, prepareForStore, type Prepared } from "./prepare";
import { asFilesError, FilesError, type FilePutMeta, type FilesApi } from "./types";

/** What the server says about storage (functions/src/storage.ts filesConfig): never a key. */
interface FilesConfig { provider: FileProvider; cloudinary?: { cloudName: string; uploadPreset: string }; r2?: { publicBaseUrl?: string } }

const CONFIG_KEY = "ag-files-config";
const CONFIG_FRESH_MS = 15 * 60_000;
/** How long we wait for the database to confirm a save before carrying on (the save itself keeps going). */
const CONFIRM_MS = 8_000;
const online = () => typeof navigator === "undefined" || navigator.onLine;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class FirebaseFiles implements FilesApi {
  private urls = new Map<string, { url: string; until: number; revoke: boolean }>();
  private cfg: { at: number; value: FilesConfig } | null = null;

  /** @param who the signed-in person (role and projects), or null when nobody is signed in */
  constructor(private c: Clients, private who: () => FileAccessCtx | null) {}

  private me(): FileAccessCtx {
    const c = this.who();
    if (!c) throw new FilesError("denied");
    return c;
  }

  // ---------- which provider ----------

  /** The provider in use, asked from the server at most every 15 minutes and remembered on this device for offline use. */
  private async config(): Promise<FilesConfig> {
    const now = Date.now();
    if (!this.cfg) {
      try { const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null") as { at: number; value: FilesConfig } | null; if (saved?.value?.provider) this.cfg = saved; } catch { /* private mode */ }
    }
    if (this.cfg && (now - this.cfg.at < CONFIG_FRESH_MS || !online())) return this.cfg.value;
    try {
      const value = await call<unknown, FilesConfig>(this.c, "filesConfig")({});
      this.cfg = { at: now, value };
      try { localStorage.setItem(CONFIG_KEY, JSON.stringify(this.cfg)); } catch { /* private mode */ }
      return value;
    } catch {
      // The server part is not connected, or cannot be reached: the built-in store needs no server.
      return this.cfg?.value ?? { provider: "inline" };
    }
  }

  // ---------- put ----------

  async put(blob: Blob, meta: FilePutMeta): Promise<FileRef> {
    const me = this.me();
    const projectId = meta.projectId ?? null;
    if (!canAttachFile(meta.kind, projectId, me)) throw new FilesError("denied");
    const cfg = online() ? await this.config() : { provider: "inline" as const };
    let provider = providerForUpload(cfg.provider, meta.kind, online());
    const p = await prepareForStore(blob, meta, provider);
    const id = newFileId();
    let path = filePath("inline", id);
    if (provider !== "inline") {
      try {
        path = provider === "r2" ? await this.sendToR2(id, p, meta.kind, projectId) : await this.sendToCloudinary(id, p, meta.kind, cfg);
      } catch (e) {
        // Keep the file rather than lose it, when it fits in the built-in store.
        if (p.sizeBytes > FILE_LIMITS.inlineMaxBytes) throw online() ? asFilesError(e) : new FilesError("offline");
        provider = "inline";
        path = filePath("inline", id);
      }
    }
    const m: FileMeta = {
      id, name: p.name, mime: p.mime, sizeBytes: p.sizeBytes, path, ...(p.thumb ? { thumb: p.thumb } : {}),
      kind: meta.kind, provider, projectId, owner: meta.owner ?? null, ...(p.width && p.height ? { width: p.width, height: p.height } : {}),
      createdBy: me.uid, createdAt: new Date().toISOString(),
    };
    const { id: _id, createdAt: _at, ...fields } = m;
    const batch = writeBatch(this.c.db);
    batch.set(doc(this.c.db, FILES_COLLECTION, id), { ...fields, createdAt: serverTimestamp() });
    if (provider === "inline") {
      batch.set(doc(this.c.db, FILE_BLOBS_COLLECTION, id), {
        data: Bytes.fromUint8Array(new Uint8Array(await p.blob.arrayBuffer())), kind: meta.kind, projectId, createdBy: me.uid, createdAt: serverTimestamp(),
      });
    }
    await this.settle(batch.commit());
    return toFileRef(m);
  }

  /**
   * Firestore keeps a write on the device at once and confirms it when the server has it. Online we wait for that (so a
   * refusal is shown), but not for ever; offline the write is already safe on the device and goes up later.
   */
  private async settle(write: Promise<void>): Promise<void> {
    write.catch(() => undefined); // never an unhandled rejection; the awaited copy below still reports it
    if (!online()) return;
    try { await Promise.race([write, sleep(CONFIRM_MS)]); } catch (e) { throw asFilesError(e); }
  }

  private async sendToR2(id: string, p: Prepared, kind: FilePutMeta["kind"], projectId: string | null): Promise<string> {
    const signed = await call<unknown, { url: string; path: string; headers: Record<string, string> }>(this.c, "filesPresign")({ op: "put", id, kind, mime: p.mime, sizeBytes: p.sizeBytes, projectId });
    const r = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: p.blob });
    if (!r.ok) throw new FilesError("failed");
    return signed.path;
  }

  private async sendToCloudinary(id: string, p: Prepared, kind: FilePutMeta["kind"], cfg: FilesConfig): Promise<string> {
    if (!cfg.cloudinary) throw new FilesError("failed");
    const form = new FormData();
    form.append("file", p.blob, p.name);
    form.append("upload_preset", cfg.cloudinary.uploadPreset);
    form.append("public_id", cloudinaryPublicId({ id, kind }));
    const r = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudinary.cloudName)}/image/upload`, { method: "POST", body: form });
    const j = (await r.json().catch(() => ({}))) as { public_id?: string };
    const path = typeof j.public_id === "string" ? filePath("cloudinary", j.public_id) : "";
    if (!r.ok || !parseFilePath(path)) throw new FilesError("failed");
    return path;
  }

  // ---------- url ----------

  async url(ref: FileRef): Promise<string> {
    this.me();
    const at = parseFilePath(ref.path);
    if (!at) throw new FilesError("missing");
    const hit = this.urls.get(ref.id);
    if (hit && hit.until > Date.now()) return hit.url;
    const keep = (url: string, ms: number, revoke = false) => { this.urls.set(ref.id, { url, until: Date.now() + ms, revoke }); return url; };

    if (at.provider === "inline") {
      const blobRef = doc(this.c.db, FILE_BLOBS_COLLECTION, at.key);
      let snap;
      // A stored file never changes, so the copy on this device is as good as the server's and costs nothing.
      try { snap = await getDocFromCache(blobRef); } catch { snap = null; }
      if (!snap?.exists()) {
        try { snap = await getDoc(blobRef); } catch (e) { throw online() ? asFilesError(e) : new FilesError("offline"); }
      }
      const data = snap.exists() ? (snap.data() as { data?: unknown }).data : null;
      if (!(data instanceof Bytes)) throw online() ? new FilesError("missing") : new FilesError("offline");
      return keep(URL.createObjectURL(new Blob([data.toUint8Array() as BlobPart], { type: ref.mime })), Number.MAX_SAFE_INTEGER, true);
    }

    if (!online()) throw new FilesError("offline");
    const cfg = await this.config();
    if (at.provider === "cloudinary") {
      if (!cfg.cloudinary) throw new FilesError("missing");
      return keep(cloudinaryUrl(cfg.cloudinary.cloudName, at.key, ref.mime), CONFIG_FRESH_MS);
    }
    // R2: site photos may use the bucket's public address when the owner gave one; everything else gets a signed address.
    if (cfg.r2?.publicBaseUrl && at.key.startsWith("files/photo/")) return keep(`${cfg.r2.publicBaseUrl}/${at.key}`, CONFIG_FRESH_MS);
    try {
      const out = await call<unknown, { url: string; expiresInSeconds: number }>(this.c, "filesPresign")({ op: "get", id: ref.id });
      return keep(out.url, Math.max(30, out.expiresInSeconds - 60) * 1000);
    } catch (e) {
      throw serverRefusal(e);
    }
  }

  // ---------- remove ----------

  async remove(ref: FileRef): Promise<void> {
    this.me();
    const at = parseFilePath(ref.path);
    if (!at) return;
    if (at.provider === "r2") {
      if (!online()) throw new FilesError("offline");
      try { await call<unknown, unknown>(this.c, "filesPresign")({ op: "delete", id: ref.id }); } catch (e) { throw serverRefusal(e); }
    } else if (at.provider === "cloudinary") {
      // An unsigned preset cannot delete from Cloudinary: the record goes, the picture stays in the Cloudinary account.
      await this.settle(deleteDoc(doc(this.c.db, FILES_COLLECTION, ref.id)));
    } else {
      const batch = writeBatch(this.c.db);
      batch.delete(doc(this.c.db, FILES_COLLECTION, ref.id));
      batch.delete(doc(this.c.db, FILE_BLOBS_COLLECTION, at.key));
      await this.settle(batch.commit());
    }
    const hit = this.urls.get(ref.id);
    if (hit?.revoke) URL.revokeObjectURL(hit.url);
    this.urls.delete(ref.id);
  }

  // ---------- usage ----------

  /**
   * Files kept inside the database, counted by the server (one read per thousand files). Only the owner and the
   * accountant may count every file; anyone else is refused ("denied"). Needs a connection.
   */
  async usage(): Promise<{ files: number; bytes: number }> {
    this.me();
    if (!online()) throw new FilesError("offline");
    const all = collection(this.c.db, FILES_COLLECTION);
    const ask = async (q: ReturnType<typeof query>) => {
      const d = (await getAggregateFromServer(q, { files: count(), bytes: sum("sizeBytes") })).data();
      return { files: d.files, bytes: d.bytes };
    };
    try {
      return await ask(query(all, where("provider", "==", "inline")));
    } catch (e) {
      // Without the index for that question (firestore.indexes.json), count every file: files kept in R2 or Cloudinary are then included.
      if ((e as { code?: string }).code === "failed-precondition") { try { return await ask(query(all)); } catch (e2) { throw asFilesError(e2); } }
      throw asFilesError(e);
    }
  }
}

/** A refusal from the server part keeps its plain words. */
function serverRefusal(e: unknown): FilesError {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? "";
  if (code.endsWith("failed-precondition") && err.message) return new FilesError(/no longer available/.test(err.message) ? "missing" : "denied", err.message);
  if (code.endsWith("unavailable") || code.endsWith("not-found")) return new FilesError("offline", "The file could not be reached right now. Check your internet and try again.");
  return asFilesError(e);
}
