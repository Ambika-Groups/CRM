/**
 * Files and photos: the storage adapter's rules (group A). Pure code: no browser, no Firebase.
 *
 * On the free plan (D-51) there is no Cloud Storage, so a compressed image sits inside the database: `files/{id}` holds
 * what lists need (name, size, a small preview) and `file_blobs/{id}` holds the bytes, under Firestore's 1 MiB per
 * document. Cloudflare R2 or Cloudinary can take the bytes instead once the owner sets one up; screens never notice,
 * because a record only ever keeps `FileRef`s and the adapter reads `path` to find the bytes:
 *   inline/<id>              the bytes are in file_blobs/<id>
 *   r2/<object key>          the bytes are in the R2 bucket; reached through a short-lived signed address
 *   cloudinary/<public id>   the bytes are in the Cloudinary account
 *
 * Who may see a file is decided here (`canReadFile`), mirrored by firestore.rules and by the server before it signs an
 * address. ID proofs are for the owner and the accountant only (D-22; the CA never sees them, PRD §11A.6).
 */
import { CommandError } from "./commands/common";
import type { FileRef } from "./lanea-interfaces";
import type { Role } from "./model";

export const FILES_COLLECTION = "files";
export const FILE_BLOBS_COLLECTION = "file_blobs";

export const FILE_KINDS = ["bill", "photo", "id_proof", "document", "signature"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_PROVIDERS = ["inline", "r2", "cloudinary"] as const;
export type FileProvider = (typeof FILE_PROVIDERS)[number];

export const FILE_LIMITS = {
  /** A compressed photo should land between these (SPARK-PLAN: 80 to 150 KB, about 8,000 photos in the free 1 GiB). */
  targetMinBytes: 80_000,
  targetMaxBytes: 150_000,
  /** The most data one inline file may hold: well under Firestore's 1 MiB (1,048,576 bytes) per document. */
  inlineMaxBytes: 700_000,
  /** The most a file may be on R2 or Cloudinary (PRD §4: 10 MB). */
  externalMaxBytes: 10 * 1024 * 1024,
  /** The largest photo we will try to shrink in the browser (a phone's biggest camera file, with room to spare). */
  originalImageMaxBytes: 40 * 1024 * 1024,
  /** Longest side of a stored photo, and the smallest we shrink to before giving up. */
  maxSide: 1600,
  minSide: 640,
  /** The preview kept on the FileRef: longest side and the most characters its data URL may have (about 20 KB). */
  thumbSide: 160,
  thumbMaxChars: 20_000,
  nameMaxChars: 120,
  /** Firestore's free storage (shared with every other record). */
  budgetBytes: 1024 * 1024 * 1024,
  /** The person who attached a file may remove it for this long; after that only the owner or the accountant. */
  deleteWindowHours: 24,
} as const;

export const PDF_MIME = "application/pdf";
/** What a person may pick as a picture (the browser turns it into a JPEG or WebP). */
export const IMAGE_INPUT_MIMES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif", "image/bmp"];
/** What is kept after compression. */
export const STORED_IMAGE_MIMES: readonly string[] = ["image/jpeg", "image/webp", "image/png"];

const PDF_ALLOWED: Record<FileKind, boolean> = { bill: true, photo: false, id_proof: true, document: true, signature: false };

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", gif: "image/gif", bmp: "image/bmp", pdf: PDF_MIME,
};
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png", [PDF_MIME]: "pdf" };

export const isFileKind = (v: unknown): v is FileKind => typeof v === "string" && (FILE_KINDS as readonly string[]).includes(v);
export const isImageMime = (mime: string): boolean => mime.startsWith("image/");

/** The type of a picked file: what the browser says, or, when it says nothing (some Android pickers), the name's ending. */
export function guessMime(name: string, type: string): string {
  const t = type.trim().toLowerCase();
  if (t && t !== "application/octet-stream") return t === "image/jpg" ? "image/jpeg" : t;
  const ext = /\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1]?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "";
}

/** The types that may be stored for a kind (after compression). */
export function storedMimesFor(kind: FileKind): string[] {
  return PDF_ALLOWED[kind] ? [...STORED_IMAGE_MIMES, PDF_MIME] : [...STORED_IMAGE_MIMES];
}

/** The `accept` value for a file input of this kind. */
export function acceptFor(kind: FileKind): string {
  return PDF_ALLOWED[kind] ? "image/*,application/pdf" : "image/*";
}

/** The most bytes a stored file may have with this provider. */
export function maxBytesFor(provider: FileProvider): number {
  return provider === "inline" ? FILE_LIMITS.inlineMaxBytes : FILE_LIMITS.externalMaxBytes;
}

/**
 * Why a file can't be attached. The web shows `files.err.<code>` in English or Hindi; FILE_ERROR_TEXT is the English.
 *  - bad_type: not a picture or PDF;  pdf_not_here: this place takes pictures only;  empty: the file has nothing in it;
 *  - too_big: over the cap even after shrinking;  unreadable: the picture could not be opened;
 *  - offline: needs a connection;  denied: this person may not;  missing: the file is gone;  failed: anything else.
 */
export type FileErrorCode = "bad_type" | "pdf_not_here" | "empty" | "too_big" | "unreadable" | "offline" | "denied" | "missing" | "failed";

export const FILE_ERROR_TEXT: Record<FileErrorCode, string> = {
  bad_type: "This is not a photo or a PDF. Choose a photo (JPG or PNG) or a PDF file.",
  pdf_not_here: "Only photos can be added here. Take a photo or choose a picture.",
  empty: "This file is empty. Choose another one.",
  too_big: "This file is too large to keep. Choose a smaller file, or take a photo of the page instead.",
  unreadable: "This picture could not be opened. Take the photo again or choose another picture.",
  offline: "You are offline. This needs an internet connection. Try again when you are online.",
  denied: "You can't do this with this file.",
  missing: "This file is no longer available.",
  failed: "The file could not be saved. Try again.",
};

/** How a picked file will be handled: a picture is shrunk in the browser, a PDF is kept as it is. */
export type PickCheck = { ok: true; as: "image" | "pdf"; mime: string } | { ok: false; code: FileErrorCode };

/** First check of a file the person picked, before any work is done on it. */
export function checkPicked(file: { name: string; type: string; size: number }, kind: FileKind, provider: FileProvider = "inline"): PickCheck {
  const mime = guessMime(file.name, file.type);
  if (file.size <= 0) return { ok: false, code: "empty" };
  if (mime === PDF_MIME) {
    if (!PDF_ALLOWED[kind]) return { ok: false, code: "pdf_not_here" };
    if (file.size > maxBytesFor(provider)) return { ok: false, code: "too_big" };
    return { ok: true, as: "pdf", mime };
  }
  if (!IMAGE_INPUT_MIMES.includes(mime)) return { ok: false, code: "bad_type" };
  if (file.size > FILE_LIMITS.originalImageMaxBytes) return { ok: false, code: "too_big" };
  return { ok: true, as: "image", mime };
}

/** Last check of what is about to be stored (after compression). Null when fine. */
export function checkStored(file: { mime: string; sizeBytes: number }, kind: FileKind, provider: FileProvider): FileErrorCode | null {
  if (!storedMimesFor(kind).includes(file.mime)) return file.mime === PDF_MIME ? "pdf_not_here" : "bad_type";
  if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0) return "empty";
  if (file.sizeBytes > maxBytesFor(provider)) return "too_big";
  return null;
}

// ───────────────────────── ids, names and paths ─────────────────────────

export const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;

/** A file id from the time and some random letters and digits (the caller supplies both, so this stays pure). */
export function fileIdFrom(nowMs: number, random: string): string {
  const tail = random.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  return `f${Math.max(0, Math.floor(nowMs)).toString(36)}${tail}`.slice(0, 40);
}

/** A file name safe to show and to store: no folders, no control characters, at most 120 characters, never empty. */
export function cleanFileName(name: string, mime = ""): string {
  const base = name.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop()!.trim().replace(/\s+/g, " ");
  const ext = MIME_EXT[mime];
  let out = base || "file";
  // A compressed picture is a JPEG or WebP now, so its name should say so.
  if (ext && isImageMime(mime)) out = `${out.replace(/\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i, "")}.${ext}`;
  if (out.length > FILE_LIMITS.nameMaxChars) {
    const dot = out.lastIndexOf(".");
    const tail = dot > 0 && out.length - dot <= 6 ? out.slice(dot) : "";
    out = out.slice(0, FILE_LIMITS.nameMaxChars - tail.length) + tail;
  }
  return out;
}

export function filePath(provider: FileProvider, key: string): string {
  return `${provider}/${key}`;
}

/** Splits a FileRef's `path` into its provider and the provider's own key. Null when it is not one of ours. */
export function parseFilePath(path: unknown): { provider: FileProvider; key: string } | null {
  if (typeof path !== "string") return null;
  const i = path.indexOf("/");
  if (i <= 0) return null;
  const provider = path.slice(0, i), key = path.slice(i + 1);
  if (!(FILE_PROVIDERS as readonly string[]).includes(provider) || !key || key.length > 300 || key.includes("..") || key.startsWith("/")) return null;
  if (!/^[A-Za-z0-9_\-./]+$/.test(key)) return null;
  return { provider: provider as FileProvider, key };
}

/** Where a file sits in the R2 bucket: `files/<kind>/<id>.<ext>`. */
export function r2ObjectKey(f: { id: string; kind: FileKind; mime: string }): string {
  return `files/${f.kind}/${f.id}.${MIME_EXT[f.mime] ?? "bin"}`;
}

/** The public id a file gets in Cloudinary: `ag-crm/<kind>/<id>`. */
export function cloudinaryPublicId(f: { id: string; kind: FileKind }): string {
  return `ag-crm/${f.kind}/${f.id}`;
}

/** The address of a Cloudinary file from its FileRef (Cloudinary serves PDFs under "image" too). */
export function cloudinaryUrl(cloudName: string, publicId: string, mime: string): string {
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload/${publicId.split("/").map(encodeURIComponent).join("/")}.${MIME_EXT[mime] ?? "jpg"}`;
}

/** What is wrong with a FileRef, in plain words; null when it is fine. Records must only ever hold valid ones. */
export function validateFileRef(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "This attachment could not be read.";
  const r = v as Partial<FileRef>;
  if (typeof r.id !== "string" || !FILE_ID_PATTERN.test(r.id)) return "This attachment has no valid id.";
  if (typeof r.name !== "string" || !r.name.trim() || r.name.length > FILE_LIMITS.nameMaxChars) return "This attachment needs a name of at most 120 characters.";
  if (typeof r.mime !== "string" || !(STORED_IMAGE_MIMES.includes(r.mime) || r.mime === PDF_MIME)) return "Only photos and PDF files can be attached.";
  const p = parseFilePath(r.path);
  if (!p) return "This attachment does not say where it is kept.";
  if (p.provider === "inline" && p.key !== r.id) return "This attachment does not say where it is kept.";
  if (typeof r.sizeBytes !== "number" || !Number.isInteger(r.sizeBytes) || r.sizeBytes <= 0 || r.sizeBytes > maxBytesFor(p.provider)) return "This attachment is too large.";
  if (r.thumb !== undefined && (typeof r.thumb !== "string" || !r.thumb.startsWith("data:image/") || r.thumb.length > FILE_LIMITS.thumbMaxChars)) return "This attachment's preview is too large.";
  return null;
}

/**
 * For commands: the attachments a record may keep. Checks each one, refuses more than `max`, and returns clean copies
 * with only the FileRef fields (so image bytes or anything else can never ride along on a business record).
 */
export function assertFileRefs(value: unknown, max: number, field = "files"): FileRef[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new CommandError("The attachments could not be read.", { [field]: "The attachments could not be read." });
  if (value.length > max) throw new CommandError(`You can attach up to ${max} files here.`, { [field]: `You can attach up to ${max} files here.` });
  const seen = new Set<string>();
  return value.map((v) => {
    const problem = validateFileRef(v);
    if (problem) throw new CommandError(problem, { [field]: problem });
    const r = v as FileRef;
    if (seen.has(r.id)) throw new CommandError("The same file is attached twice.", { [field]: "The same file is attached twice." });
    seen.add(r.id);
    return { id: r.id, name: r.name, mime: r.mime, sizeBytes: r.sizeBytes, path: r.path, ...(r.thumb ? { thumb: r.thumb } : {}) };
  });
}

/** The attachments a record had before a save and no longer has: their stored bytes can be removed. */
export function droppedFileRefs(before: readonly FileRef[] | undefined, after: readonly FileRef[] | undefined): FileRef[] {
  const kept = new Set((after ?? []).map((f) => f.id));
  return (before ?? []).filter((f) => !kept.has(f.id));
}

// ───────────────────────── what is stored ─────────────────────────

/** `files/{id}`: everything about a file except its bytes. Never changed after it is made. */
export interface FileMeta extends FileRef {
  kind: FileKind;
  provider: FileProvider;
  /** The project the file belongs to; null for company-level files (finance roles only). */
  projectId: string | null;
  /** The record it was attached to, when known at upload time. */
  owner?: { collection: string; id: string } | null;
  width?: number;
  height?: number;
  createdBy: string;
  createdAt: string;
}

/** The FileRef a record keeps for a stored file. */
export function toFileRef(m: Pick<FileMeta, "id" | "name" | "mime" | "sizeBytes" | "path" | "thumb">): FileRef {
  return { id: m.id, name: m.name, mime: m.mime, sizeBytes: m.sizeBytes, path: m.path, ...(m.thumb ? { thumb: m.thumb } : {}) };
}

// ───────────────────────── shrinking a photo: the maths ─────────────────────────

export interface Size { width: number; height: number }

/** The size that fits inside a square of `maxSide`, keeping the shape. Never enlarges; never below 1 pixel. */
export function fitWithin(size: Size, maxSide: number): Size {
  const w = Math.max(1, Math.floor(size.width)), h = Math.max(1, Math.floor(size.height));
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

export interface CompressionStep extends Size { maxSide: number; quality: number }

/** Longest side and quality, from best looking to smallest. A bill must stay readable, so quality never goes below 0.45. */
const LADDER: readonly (readonly [number, number])[] = [[1600, 0.72], [1600, 0.55], [1280, 0.6], [1280, 0.45], [1024, 0.5], [800, 0.5], [640, 0.45]];

/**
 * The sizes and qualities to try for a picture, in order. Steps that would not be smaller than the one before (a small
 * original is never enlarged, so several steps can come out the same) are left out.
 */
export function compressionSteps(original: Size): CompressionStep[] {
  const out: CompressionStep[] = [];
  for (const [maxSide, quality] of LADDER) {
    const s = fitWithin(original, maxSide);
    const last = out[out.length - 1];
    const px = s.width * s.height;
    if (last && !(px < last.width * last.height || (px === last.width * last.height && quality < last.quality))) continue;
    out.push({ maxSide, quality, ...s });
  }
  return out;
}

/** Roughly how the encoded size moves with pixels and quality: enough to skip steps that cannot reach the target. */
const stepWeight = (s: CompressionStep) => s.width * s.height * Math.pow(s.quality, 1.3);

/**
 * After step `tried` gave `gotBytes`: the next step worth trying, or null when the result is small enough or there is
 * nothing smaller left. It jumps over steps that would still be too big, so a phone encodes two or three times, not seven.
 */
export function nextStepIndex(steps: readonly CompressionStep[], tried: number, gotBytes: number, target: number = FILE_LIMITS.targetMaxBytes): number | null {
  if (gotBytes <= target || tried >= steps.length - 1) return null;
  const from = steps[tried]!;
  for (let j = tried + 1; j < steps.length; j++) {
    if ((gotBytes * stepWeight(steps[j]!)) / stepWeight(from) <= target * 1.1) return j;
  }
  return steps.length - 1;
}

/** Of the tries made, the one to keep: the smallest, if it is under the hard cap. Null means the picture is too big to keep. */
export function bestAttempt<T extends { bytes: number }>(attempts: readonly T[], cap: number = FILE_LIMITS.inlineMaxBytes): T | null {
  let best: T | null = null;
  for (const a of attempts) if (!best || a.bytes < best.bytes) best = a;
  return best && best.bytes <= cap ? best : null;
}

/** The preview sizes and qualities to try, until its data URL fits in `thumbMaxChars`. */
export function thumbSteps(original: Size): CompressionStep[] {
  return ([[FILE_LIMITS.thumbSide, 0.6], [FILE_LIMITS.thumbSide, 0.4], [120, 0.4], [96, 0.3], [64, 0.3]] as const)
    .map(([maxSide, quality]) => ({ maxSide, quality, ...fitWithin(original, maxSide) }));
}

export const thumbFits = (dataUrl: string): boolean => dataUrl.startsWith("data:image/") && dataUrl.length <= FILE_LIMITS.thumbMaxChars;

/** How many bytes a base64 data URL holds. */
export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (!b64) return 0;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** JPEG opens everywhere (the CA's computer, WhatsApp); site photos use the smaller WebP when the browser can make it. */
export function pickImageFormat(kind: FileKind, webpSupported: boolean): "image/jpeg" | "image/webp" {
  return kind === "photo" && webpSupported ? "image/webp" : "image/jpeg";
}

// ───────────────────────── who may attach, see and remove ─────────────────────────

export interface FileAccessCtx { role: Role; uid: string; assignedProjectIds: string[] }

const isFinance = (r: Role) => r === "owner" || r === "accountant";
/** Kinds that only the owner and the accountant handle: ID proofs (D-22) and signatures on contracts (D-45). */
const RESTRICTED: readonly unknown[] = ["id_proof", "signature"];

/**
 * May this person attach a file of this kind here? Owner and accountant: anything. A project manager or supervisor:
 * bills, photos and documents on a project they are assigned to. Viewer and CA: nothing.
 */
export function canAttachFile(kind: unknown, projectId: unknown, c: FileAccessCtx): boolean {
  if (!isFileKind(kind)) return false;
  if (isFinance(c.role)) return true;
  if (c.role !== "pm" && c.role !== "supervisor") return false;
  return !RESTRICTED.includes(kind) && typeof projectId === "string" && c.assignedProjectIds.includes(projectId);
}

/**
 * May this person see this file (`files/{id}` or `file_blobs/{id}`; both carry kind, projectId and createdBy)?
 *  - Owner and accountant: every file.
 *  - ID proofs and signatures: nobody else.
 *  - CA: bills only (the accounting record; PRD §11A).   - Viewer: none (D-42: totals only).
 *  - Project manager: files of the projects they are assigned to.
 *  - Supervisor: the same, but of bills only the ones they attached (they see only their own expenses, rule A).
 */
export function canReadFile(doc: Record<string, unknown>, c: FileAccessCtx): boolean {
  if (isFinance(c.role)) return true;
  if (!isFileKind(doc.kind) || RESTRICTED.includes(doc.kind)) return false;
  if (c.role === "ca") return doc.kind === "bill";
  const assigned = typeof doc.projectId === "string" && c.assignedProjectIds.includes(doc.projectId);
  if (c.role === "pm") return assigned;
  if (c.role === "supervisor") return assigned && (doc.kind !== "bill" || doc.createdBy === c.uid);
  return false;
}

/** May this person remove this file? Owner and accountant: always. The person who attached it: for 24 hours, while they can still see it. */
export function canDeleteFile(doc: Record<string, unknown>, c: FileAccessCtx, nowIso: string): boolean {
  if (isFinance(c.role)) return true;
  if (doc.createdBy !== c.uid || !canReadFile(doc, c)) return false;
  const made = typeof doc.createdAt === "string" ? Date.parse(doc.createdAt) : NaN;
  const now = Date.parse(nowIso);
  return Number.isFinite(made) && Number.isFinite(now) && now - made < FILE_LIMITS.deleteWindowHours * 3600_000;
}

// ───────────────────────── which provider takes a new file ─────────────────────────

/** The provider in use: R2 when it is set up and its Test passed, else Cloudinary the same way, else the built-in one. */
export function activeStorageProvider(ready: { r2?: boolean; cloudinary?: boolean }): FileProvider {
  return ready.r2 ? "r2" : ready.cloudinary ? "cloudinary" : "inline";
}

/**
 * Where a new file goes. Offline it is always kept in the database (that save waits on the phone and goes up later;
 * an upload to R2 or Cloudinary cannot wait). ID proofs and signatures never go to Cloudinary, whose addresses open
 * for anyone who has them.
 */
export function providerForUpload(active: FileProvider, kind: FileKind, online: boolean): FileProvider {
  if (!online) return "inline";
  if (active === "cloudinary" && RESTRICTED.includes(kind)) return "inline";
  return active;
}

// ───────────────────────── how full the free space is ─────────────────────────

export type UsageLevel = "ok" | "warning" | "critical" | "full";

export interface UsageSummary {
  files: number;
  bytes: number;
  budgetBytes: number;
  /** Share of the budget used, to one decimal place, rounded down (so 69.99% never shows as 70). */
  percent: number;
  /** "warning" from 70%, "critical" from 90%, "full" at 100%. */
  level: UsageLevel;
  remainingBytes: number;
  /** About how many more photos fit, at the average size so far (100 KB when there are none yet). */
  photosLeft: number;
}

export const USAGE_WARN_PERCENT = 70;
export const USAGE_CRITICAL_PERCENT = 90;

export function usageSummary(u: { files: number; bytes: number }, budgetBytes: number = FILE_LIMITS.budgetBytes): UsageSummary {
  const files = Math.max(0, Math.floor(u.files || 0)), bytes = Math.max(0, Math.floor(u.bytes || 0));
  const percent = budgetBytes > 0 ? Math.floor((bytes * 1000) / budgetBytes) / 10 : 100;
  const level: UsageLevel = percent >= 100 ? "full" : percent >= USAGE_CRITICAL_PERCENT ? "critical" : percent >= USAGE_WARN_PERCENT ? "warning" : "ok";
  const remainingBytes = Math.max(0, budgetBytes - bytes);
  const average = Math.max(20_000, files > 0 ? bytes / files : 100_000);
  return { files, bytes, budgetBytes, percent, level, remainingBytes, photosLeft: Math.floor(remainingBytes / average) };
}

/** "142 KB", "1.2 MB", "0.84 GB": sizes as people say them. */
export function formatFileSize(bytes: number): string {
  const b = Math.max(0, bytes);
  if (b < 1000) return `${Math.round(b)} bytes`;
  if (b < 1_000_000) return `${Math.round(b / 1000)} KB`;
  if (b < 1_000_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  return `${(b / 1_000_000_000).toFixed(2)} GB`;
}
