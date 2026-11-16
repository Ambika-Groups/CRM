/**
 * What both adapters (demo and Firebase) do to a file before keeping it: check it, shrink a picture that is not already
 * small, make its preview, tidy its name, and check the result against the provider's cap.
 */
import { checkPicked, checkStored, cleanFileName, FILE_LIMITS, fileIdFrom, maxBytesFor, STORED_IMAGE_MIMES, type FileProvider } from "@ag/core";
import { compressImage, makeThumb } from "@/components/files/compress";
import { FilesError, type FilePutMeta } from "./types";

export interface Prepared {
  blob: Blob;
  mime: string;
  name: string;
  sizeBytes: number;
  thumb?: string;
  width?: number;
  height?: number;
}

export async function prepareForStore(blob: Blob, meta: FilePutMeta, provider: FileProvider): Promise<Prepared> {
  const picked = checkPicked({ name: meta.name, type: blob.type, size: blob.size }, meta.kind, provider);
  if (!picked.ok) throw new FilesError(picked.code);
  let out: Prepared;
  if (picked.as === "pdf") {
    out = { blob, mime: picked.mime, name: "", sizeBytes: blob.size };
  } else if (blob.size > FILE_LIMITS.targetMaxBytes || !STORED_IMAGE_MIMES.includes(picked.mime)) {
    const c = await compressImage(blob, meta.kind, maxBytesFor(provider));
    out = { blob: c.blob, mime: c.mime, name: "", sizeBytes: c.blob.size, thumb: c.thumb, width: c.width, height: c.height };
  } else {
    // Already small and of a kind we keep (for example what FileAttach has just shrunk): store it as it is.
    // Opening it for the preview also proves it really is a picture.
    const t = meta.thumb ? { thumb: meta.thumb, width: meta.width, height: meta.height } : await makeThumb(blob);
    if (!t) throw new FilesError("unreadable");
    out = { blob, mime: picked.mime, name: "", sizeBytes: blob.size, thumb: t.thumb, width: t.width ?? meta.width, height: t.height ?? meta.height };
  }
  const problem = checkStored(out, meta.kind, provider);
  if (problem) throw new FilesError(problem);
  out.name = cleanFileName(meta.name, out.mime);
  return out;
}

/** A new file id: the time plus 80 random bits. */
export function newFileId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return fileIdFrom(Date.now(), Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
