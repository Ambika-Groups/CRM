/**
 * Files in demo mode: kept in the demo store (`files/{id}` and `file_blobs/{id}`, the same two collections as the live
 * database), so they are saved to this device with the rest of the demo data and are still there after a reload.
 * The same core checks as production decide who may attach, see and remove a file.
 */
import {
  canAttachFile, canDeleteFile, canReadFile, FILE_BLOBS_COLLECTION, filePath, FILES_COLLECTION, toFileRef,
  type Doc, type FileAccessCtx, type FileMeta, type FileRef, type MemoryStore,
} from "@ag/core";
import { base64ToBlob, blobToBase64, newFileId, prepareForStore } from "./prepare";
import { FilesError, type FilePutMeta, type FilesApi } from "./types";

interface DemoBlob extends Doc { data: string; kind: string; projectId: string | null; createdBy: string; createdAt: string }

export class DemoFiles implements FilesApi {
  /** Addresses made for this page, so the same file is not turned into a new one on every view. */
  private urls = new Map<string, string>();

  /**
   * @param store the demo store
   * @param who   the person using the demo now (role and projects), or null
   * @param flush resolves when the demo store has been saved to this device
   */
  constructor(private store: MemoryStore, private who: () => FileAccessCtx | null, private flush: () => Promise<void>) {}

  private me(): FileAccessCtx {
    const c = this.who();
    if (!c) throw new FilesError("denied");
    return c;
  }

  async put(blob: Blob, meta: FilePutMeta): Promise<FileRef> {
    const c = this.me();
    const projectId = meta.projectId ?? null;
    if (!canAttachFile(meta.kind, projectId, c)) throw new FilesError("denied");
    const p = await prepareForStore(blob, meta, "inline");
    const id = newFileId();
    const createdAt = new Date().toISOString();
    const m: FileMeta = {
      id, name: p.name, mime: p.mime, sizeBytes: p.sizeBytes, path: filePath("inline", id), ...(p.thumb ? { thumb: p.thumb } : {}),
      kind: meta.kind, provider: "inline", projectId, owner: meta.owner ?? null, ...(p.width && p.height ? { width: p.width, height: p.height } : {}),
      createdBy: c.uid, createdAt,
    };
    const bytes: DemoBlob = { id, data: await blobToBase64(p.blob), kind: meta.kind, projectId, createdBy: c.uid, createdAt };
    this.store.set(FILE_BLOBS_COLLECTION, bytes);
    this.store.set(FILES_COLLECTION, m as unknown as Doc);
    await this.flush();
    return toFileRef(m);
  }

  async url(ref: FileRef): Promise<string> {
    const c = this.me();
    const m = this.store.get<Doc>(FILES_COLLECTION, ref.id);
    const b = this.store.get<DemoBlob>(FILE_BLOBS_COLLECTION, ref.id);
    if (!m || !b) throw new FilesError("missing");
    if (!canReadFile(m, c)) throw new FilesError("denied");
    let url = this.urls.get(ref.id);
    if (!url) {
      url = URL.createObjectURL(base64ToBlob(b.data, String(m.mime ?? ref.mime)));
      this.urls.set(ref.id, url);
    }
    return url;
  }

  async remove(ref: FileRef): Promise<void> {
    const c = this.me();
    const m = this.store.get<Doc>(FILES_COLLECTION, ref.id);
    if (!m) return; // already gone
    if (!canDeleteFile(m, c, new Date().toISOString())) throw new FilesError("denied", "Only the owner or the accountant can remove this file now.");
    this.store.delete(FILE_BLOBS_COLLECTION, ref.id);
    this.store.delete(FILES_COLLECTION, ref.id);
    const url = this.urls.get(ref.id);
    if (url) { URL.revokeObjectURL(url); this.urls.delete(ref.id); }
    await this.flush();
  }

  async usage(): Promise<{ files: number; bytes: number }> {
    const all = this.store.list<{ sizeBytes?: number }>(FILES_COLLECTION);
    return { files: all.length, bytes: all.reduce((n, f) => n + (typeof f.sizeBytes === "number" ? f.sizeBytes : 0), 0) };
  }
}
