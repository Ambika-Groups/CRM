import { FILE_ERROR_TEXT, type FileErrorCode, type FileRef } from "@ag/core";

/**
 * The one way screens keep and fetch files (photos, bills, ID proofs, documents, signatures). Demo mode keeps them in
 * the demo store; Firebase mode keeps a compressed copy inside the database, or in Cloudflare R2 / Cloudinary when the
 * owner has set one up. A record only ever stores the returned `FileRef`.
 *
 * `put` accepts a picture or a PDF. A picture is shrunk first if it is not already small; a PDF is kept as it is, up to
 * the cap. `meta.thumb`, `width` and `height` are optional extras a caller may pass when it has already made them.
 */
export interface FilesApi {
  put(blob: Blob, meta: {
    name: string;
    kind: "bill" | "photo" | "id_proof" | "document" | "signature";
    owner?: { collection: string; id: string };
    projectId?: string | null;
    thumb?: string;
    width?: number;
    height?: number;
  }): Promise<FileRef>;
  /** An address the browser can show or open now (it may stop working after a few minutes; ask again when needed). */
  url(ref: FileRef): Promise<string>;
  remove(ref: FileRef): Promise<void>;
  /** How many files are kept in the database and how many bytes they take (the free 1 GiB is shared with all records). */
  usage(): Promise<{ files: number; bytes: number }>;
}

export type FilePutMeta = Parameters<FilesApi["put"]>[1];

/** A refusal with a reason the screen can put in plain words: `files.err.<code>` in English or Hindi. */
export class FilesError extends Error {
  constructor(readonly code: FileErrorCode, message: string = FILE_ERROR_TEXT[code]) { super(message); }
}

/** Any failure as a FilesError, so screens handle one kind. */
export function asFilesError(e: unknown): FilesError {
  if (e instanceof FilesError) return e;
  const code = (e as { code?: string } | null)?.code ?? "";
  if (code.endsWith("permission-denied")) return new FilesError("denied");
  if (code.endsWith("unavailable") || code.endsWith("deadline-exceeded")) return new FilesError("offline");
  return new FilesError("failed");
}
