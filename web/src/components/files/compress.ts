/**
 * Shrinks a photo in the browser before it is stored (PRD §4: compressed on upload; SPARK-PLAN: 80 to 150 KB each).
 * The sizes and qualities to try, and when to stop, are core's maths (compressionSteps, nextStepIndex, bestAttempt);
 * this file only draws and encodes. The phone's rotation note (EXIF) is applied while decoding, and re-encoding drops
 * everything else the camera wrote into the file (such as where the photo was taken).
 */
import { bestAttempt, compressionSteps, FILE_LIMITS, nextStepIndex, pickImageFormat, thumbFits, thumbSteps, type FileKind, type Size } from "@ag/core";
import { FilesError } from "@/data/files/types";

export interface Compressed {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  /** A small preview as a data URL (at most about 20 KB); absent only if the browser could not make one. */
  thumb?: string;
  /** How many times the picture was encoded (two or three is normal). */
  tries: number;
}

interface Decoded extends Size { source: CanvasImageSource; close(): void }

/** Opens a picture the way it should be seen (rotation applied). Throws "unreadable" when the browser cannot open it. */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bmp.width > 0 && bmp.height > 0) return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch { /* some browsers cannot decode this type this way: try an <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error("image")); img.src = url; });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("image");
    // An <img> is drawn with its rotation applied in every current browser.
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new FilesError("unreadable");
  }
}

function draw(img: Decoded, size: Size): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size.width;
  c.height = size.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new FilesError("unreadable");
  // JPEG has no see-through: a transparent picture gets a white page behind it, not a black one.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img.source, 0, 0, c.width, c.height);
  return c;
}

const encode = (c: HTMLCanvasElement, mime: string, quality: number) => new Promise<Blob | null>((done) => c.toBlob(done, mime, quality));

/**
 * Shrinks a picture to a JPEG (or a WebP for site photos where the browser can make one): longest side 1600 px or
 * less, aiming under 150 KB, never over `cap`. Throws FilesError "unreadable" or "too_big".
 */
export async function compressImage(file: Blob, kind: FileKind, cap: number = FILE_LIMITS.inlineMaxBytes): Promise<Compressed> {
  const img = await decode(file);
  try {
    const steps = compressionSteps(img);
    let mime: string = pickImageFormat(kind, true);
    const attempts: { bytes: number; blob: Blob; width: number; height: number }[] = [];
    let canvas: HTMLCanvasElement | null = null;
    let i: number | null = 0;
    while (i !== null) {
      const step = steps[i]!;
      if (!canvas || canvas.width !== step.width || canvas.height !== step.height) canvas = draw(img, step);
      let blob = await encode(canvas, mime, step.quality);
      // A browser that cannot make WebP hands back a PNG (or nothing): use JPEG from here on.
      if ((!blob || blob.type !== mime) && mime !== "image/jpeg") { mime = "image/jpeg"; blob = await encode(canvas, mime, step.quality); }
      if (!blob || blob.type !== mime) throw new FilesError("unreadable");
      attempts.push({ bytes: blob.size, blob, width: step.width, height: step.height });
      i = nextStepIndex(steps, i, blob.size);
    }
    const best = bestAttempt(attempts, cap);
    if (!best) throw new FilesError("too_big");
    return { blob: best.blob, mime, width: best.width, height: best.height, thumb: thumbOf(img), tries: attempts.length };
  } finally {
    img.close();
  }
}

function thumbOf(img: Decoded): string | undefined {
  try {
    for (const step of thumbSteps(img)) {
      const url = draw(img, step).toDataURL("image/jpeg", step.quality);
      if (thumbFits(url)) return url;
    }
  } catch { /* no preview: the list shows the file's name instead */ }
  return undefined;
}

/** A small preview of a picture that is already the right size. Undefined when the browser cannot open it. */
export async function makeThumb(file: Blob): Promise<{ thumb?: string; width: number; height: number } | undefined> {
  try {
    const img = await decode(file);
    try { return { thumb: thumbOf(img), width: img.width, height: img.height }; } finally { img.close(); }
  } catch {
    return undefined;
  }
}
