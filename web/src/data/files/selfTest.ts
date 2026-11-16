/**
 * The Test of the built-in file store on Setup & integrations: keep a tiny file, read it back, compare, delete it.
 * Runs in the browser as the signed-in super user, through the same FilesApi every screen uses.
 */
import type { TestOutcome } from "@ag/core";
import { FilesError, type FilesApi } from "./types";

/** A 1 x 1 pixel PNG (70 bytes). */
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export async function inlineStorageTest(files: FilesApi): Promise<TestOutcome> {
  const raw = atob(PIXEL);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const hint = "Check that the security rules were published (the files and file_blobs parts), then try again.";
  let ref;
  try {
    ref = await files.put(new Blob([bytes], { type: "image/png" }), { name: "storage-test.png", kind: "document", projectId: null });
  } catch (e) {
    return { ok: false, message: "A test file could not be saved.", hint: e instanceof FilesError && e.code === "offline" ? "You are offline. Connect to the internet and try again." : hint };
  }
  try {
    // Read it back the way screens do: as a picture. (The file is one pixel wide and one high.)
    const url = await files.url(ref);
    const same = await new Promise<boolean>((done) => {
      const img = new Image();
      img.onload = () => done(img.naturalWidth === 1 && img.naturalHeight === 1);
      img.onerror = () => done(false);
      img.src = url;
    });
    await files.remove(ref);
    if (!same) return { ok: false, message: "A test file was saved but came back different.", hint };
    return { ok: true, message: "A test file was saved in the database, read back and deleted. Photos and documents can be kept without any other service." };
  } catch {
    try { await files.remove(ref); } catch { /* nothing more to do */ }
    return { ok: false, message: "A test file was saved but could not be read back or deleted.", hint };
  }
}
