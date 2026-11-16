// Files and photos (group A, the storage adapter): limits, kinds and types, FileRef validation, paths per provider,
// the maths for shrinking a photo, previews, who may attach, see and remove a file (D-22, D-42, D-43, rule A), which
// provider takes a new file, and how full the free space is. IDs FL-xx are cited in docs/prd-traceability.md.
import { describe, expect, it } from "vitest";
import { CommandError } from "../src/commands/common";
import { INTEGRATIONS, validateIntegration, verifiedSummary, type IntegrationDef } from "../src/integrations";
import type { FileRef } from "../src/lanea-interfaces";
import {
  acceptFor, activeStorageProvider, assertFileRefs, bestAttempt, canAttachFile, canDeleteFile, canReadFile, checkPicked, checkStored, cleanFileName,
  cloudinaryPublicId, cloudinaryUrl, compressionSteps, dataUrlBytes, droppedFileRefs, FILE_ERROR_TEXT, FILE_ID_PATTERN, FILE_KINDS, FILE_LIMITS, fileIdFrom,
  filePath, fitWithin, formatFileSize, guessMime, maxBytesFor, nextStepIndex, parseFilePath, pickImageFormat, providerForUpload, r2ObjectKey, storedMimesFor,
  thumbFits, thumbSteps, toFileRef, usageSummary, validateFileRef, type FileAccessCtx, type FileMeta,
} from "../src/files";

const owner: FileAccessCtx = { role: "owner", uid: "uOwner", assignedProjectIds: [] };
const accountant: FileAccessCtx = { role: "accountant", uid: "uAccountant", assignedProjectIds: [] };
const pm: FileAccessCtx = { role: "pm", uid: "uPm", assignedProjectIds: ["pA", "pB"] };
const sup: FileAccessCtx = { role: "supervisor", uid: "uSup", assignedProjectIds: ["pA"] };
const viewer: FileAccessCtx = { role: "viewer", uid: "uViewer", assignedProjectIds: [] };
const ca: FileAccessCtx = { role: "ca", uid: "uCa", assignedProjectIds: [] };
const everyone = [owner, accountant, pm, sup, viewer, ca];

const ref = (over: Partial<FileRef> = {}): FileRef => ({ id: "fabc12345", name: "bill.jpg", mime: "image/jpeg", sizeBytes: 120_000, path: "inline/fabc12345", ...over });
const meta = (over: Partial<FileMeta> = {}): Record<string, unknown> => ({
  ...ref(), kind: "photo", provider: "inline", projectId: "pA", createdBy: "uSup", createdAt: "2026-11-16T04:00:00.000Z", ...over,
});

describe("limits, kinds and types", () => {
  it("FL-01 the limits: 80 to 150 KB aimed for, 700,000 bytes kept inline (under Firestore's 1 MiB), 10 MB elsewhere, 1 GiB budget", () => {
    expect(FILE_LIMITS.targetMinBytes).toBe(80_000);
    expect(FILE_LIMITS.targetMaxBytes).toBe(150_000);
    expect(FILE_LIMITS.inlineMaxBytes).toBe(700_000);
    expect(FILE_LIMITS.inlineMaxBytes + FILE_LIMITS.thumbMaxChars + 4_000).toBeLessThan(1_048_576);
    expect(maxBytesFor("inline")).toBe(700_000);
    expect(maxBytesFor("r2")).toBe(10 * 1024 * 1024);
    expect(maxBytesFor("cloudinary")).toBe(10 * 1024 * 1024);
    expect(FILE_LIMITS.budgetBytes).toBe(1_073_741_824);
    expect(FILE_LIMITS.thumbMaxChars).toBe(20_000);
  });

  it("FL-02 the five kinds; PDFs are allowed for bills, ID proofs and documents, not for photos or signatures", () => {
    expect([...FILE_KINDS]).toEqual(["bill", "photo", "id_proof", "document", "signature"]);
    for (const k of ["bill", "id_proof", "document"] as const) { expect(storedMimesFor(k)).toContain("application/pdf"); expect(acceptFor(k)).toBe("image/*,application/pdf"); }
    for (const k of ["photo", "signature"] as const) { expect(storedMimesFor(k)).not.toContain("application/pdf"); expect(acceptFor(k)).toBe("image/*"); }
    expect(storedMimesFor("photo")).toEqual(["image/jpeg", "image/webp", "image/png"]);
  });

  it("FL-03 a picked file's type comes from the browser, or from its name when the browser says nothing", () => {
    expect(guessMime("a.JPG", "")).toBe("image/jpeg");
    expect(guessMime("scan.pdf", "application/octet-stream")).toBe("application/pdf");
    expect(guessMime("x.png", "image/jpg")).toBe("image/jpeg");
    expect(guessMime("notes.txt", "")).toBe("");
    expect(guessMime("IMG_1.HEIC", "")).toBe("image/heic");
  });

  it("FL-04 picking: pictures go to be shrunk, PDFs are kept as they are up to the cap, anything else is refused in plain words", () => {
    expect(checkPicked({ name: "bill.jpg", type: "image/jpeg", size: 6_000_000 }, "bill")).toEqual({ ok: true, as: "image", mime: "image/jpeg" });
    expect(checkPicked({ name: "big.jpg", type: "image/jpeg", size: 41 * 1024 * 1024 }, "bill")).toEqual({ ok: false, code: "too_big" });
    expect(checkPicked({ name: "gst.pdf", type: "application/pdf", size: 600_000 }, "document")).toEqual({ ok: true, as: "pdf", mime: "application/pdf" });
    expect(checkPicked({ name: "gst.pdf", type: "application/pdf", size: 700_001 }, "document")).toEqual({ ok: false, code: "too_big" });
    expect(checkPicked({ name: "gst.pdf", type: "application/pdf", size: 5_000_000 }, "document", "r2")).toMatchObject({ ok: true, as: "pdf" });
    expect(checkPicked({ name: "gst.pdf", type: "application/pdf", size: 11 * 1024 * 1024 }, "document", "r2")).toEqual({ ok: false, code: "too_big" });
    expect(checkPicked({ name: "site.pdf", type: "application/pdf", size: 1000 }, "photo")).toEqual({ ok: false, code: "pdf_not_here" });
    expect(checkPicked({ name: "sheet.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 1000 }, "document")).toEqual({ ok: false, code: "bad_type" });
    expect(checkPicked({ name: "clip.mp4", type: "video/mp4", size: 1000 }, "photo")).toEqual({ ok: false, code: "bad_type" });
    expect(checkPicked({ name: "empty.jpg", type: "image/jpeg", size: 0 }, "photo")).toEqual({ ok: false, code: "empty" });
    for (const text of Object.values(FILE_ERROR_TEXT)) expect(text).not.toMatch(/§|MIME|bytes|Firestore|blob/i);
  });

  it("FL-05 what is stored is checked again after shrinking: type for the kind and the provider's cap", () => {
    expect(checkStored({ mime: "image/jpeg", sizeBytes: 140_000 }, "bill", "inline")).toBeNull();
    expect(checkStored({ mime: "image/jpeg", sizeBytes: 700_000 }, "bill", "inline")).toBeNull();
    expect(checkStored({ mime: "image/jpeg", sizeBytes: 700_001 }, "bill", "inline")).toBe("too_big");
    expect(checkStored({ mime: "image/jpeg", sizeBytes: 700_001 }, "bill", "r2")).toBeNull();
    expect(checkStored({ mime: "application/pdf", sizeBytes: 1000 }, "photo", "inline")).toBe("pdf_not_here");
    expect(checkStored({ mime: "image/heic", sizeBytes: 1000 }, "photo", "inline")).toBe("bad_type");
    expect(checkStored({ mime: "image/jpeg", sizeBytes: 0 }, "photo", "inline")).toBe("empty");
  });
});

describe("ids, names and paths", () => {
  it("FL-10 ids are letters and digits, start with f, and differ with the time and the random part", () => {
    const a = fileIdFrom(1_794_000_000_000, "a1b2c3d4e5f6g7h8zzzz");
    expect(a).toMatch(FILE_ID_PATTERN);
    expect(a.startsWith("f")).toBe(true);
    expect(fileIdFrom(1_794_000_000_001, "a1b2c3d4e5f6g7h8")).not.toBe(fileIdFrom(1_794_000_000_000, "a1b2c3d4e5f6g7h8"));
    expect(fileIdFrom(1, "--__!!ab")).toBe("f1ab");
    expect(a.length).toBeLessThanOrEqual(40);
  });

  it("FL-11 names are made safe: no folders, no control characters, the right ending after shrinking, at most 120 characters", () => {
    expect(cleanFileName("C:\\Users\\me\\Bill 12.PNG", "image/jpeg")).toBe("Bill 12.jpg");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("  ", "image/webp")).toBe("file.webp");
    expect(cleanFileName("gst\u0000 return.pdf", "application/pdf")).toBe("gst return.pdf");
    expect(cleanFileName("IMG_0001.HEIC", "image/jpeg")).toBe("IMG_0001.jpg");
    const long = cleanFileName(`${"a".repeat(300)}.pdf`, "application/pdf");
    expect(long.length).toBe(120);
    expect(long.endsWith(".pdf")).toBe(true);
  });

  it("FL-12 the path says where the bytes are: inline/<id>, r2/<key>, cloudinary/<public id>", () => {
    expect(filePath("inline", "fabc12345")).toBe("inline/fabc12345");
    expect(parseFilePath("inline/fabc12345")).toEqual({ provider: "inline", key: "fabc12345" });
    const key = r2ObjectKey({ id: "fabc12345", kind: "bill", mime: "image/jpeg" });
    expect(key).toBe("files/bill/fabc12345.jpg");
    expect(parseFilePath(filePath("r2", key))).toEqual({ provider: "r2", key });
    expect(r2ObjectKey({ id: "fabc12345", kind: "document", mime: "application/pdf" })).toBe("files/document/fabc12345.pdf");
    const pid = cloudinaryPublicId({ id: "fabc12345", kind: "photo" });
    expect(parseFilePath(filePath("cloudinary", pid))).toEqual({ provider: "cloudinary", key: "ag-crm/photo/fabc12345" });
    expect(cloudinaryUrl("ambika", pid, "image/webp")).toBe("https://res.cloudinary.com/ambika/image/upload/ag-crm/photo/fabc12345.webp");
    for (const bad of ["", "inline/", "/x", "s3/abc", "r2/../secret", "r2//x", "inline/a b", 7, null, "inline"]) expect(parseFilePath(bad)).toBeNull();
  });

  it("FL-13 a FileRef is checked field by field, with a plain reason", () => {
    expect(validateFileRef(ref())).toBeNull();
    expect(validateFileRef(ref({ thumb: "data:image/jpeg;base64,AAAA" }))).toBeNull();
    expect(validateFileRef(ref({ mime: "application/pdf", name: "a.pdf" }))).toBeNull();
    expect(validateFileRef(ref({ path: "r2/files/bill/fabc12345.jpg", sizeBytes: 5_000_000 }))).toBeNull();
    expect(validateFileRef(null)).toMatch(/could not be read/);
    expect(validateFileRef(ref({ id: "x" }))).toMatch(/id/);
    expect(validateFileRef(ref({ name: "" }))).toMatch(/name/);
    expect(validateFileRef(ref({ mime: "text/html" }))).toMatch(/photos and PDF/);
    expect(validateFileRef(ref({ path: "inline/other12345" }))).toMatch(/where it is kept/);
    expect(validateFileRef(ref({ path: "ftp/x" }))).toMatch(/where it is kept/);
    expect(validateFileRef(ref({ sizeBytes: 700_001 }))).toMatch(/too large/);
    expect(validateFileRef(ref({ sizeBytes: 1.5 }))).toMatch(/too large/);
    expect(validateFileRef(ref({ thumb: `data:image/jpeg;base64,${"A".repeat(20_000)}` }))).toMatch(/preview/);
    expect(validateFileRef(ref({ thumb: "https://example.com/x.jpg" }))).toMatch(/preview/);
  });

  it("FL-14 a record keeps clean FileRefs only: no extra fields, no more than the limit, no duplicates", () => {
    const dirty = { ...ref({ thumb: "data:image/jpeg;base64,AAAA" }), data: "bytes", kind: "bill" };
    expect(assertFileRefs([dirty], 3)).toEqual([ref({ thumb: "data:image/jpeg;base64,AAAA" })]);
    expect(assertFileRefs(undefined, 3)).toEqual([]);
    expect(() => assertFileRefs([ref(), ref({ id: "fother1234", path: "inline/fother1234" })], 1, "billFiles")).toThrow(/up to 1/);
    expect(() => assertFileRefs([ref(), ref()], 3)).toThrow(/twice/);
    expect(() => assertFileRefs("x", 3)).toThrow(CommandError);
    try { assertFileRefs([ref({ mime: "text/plain" })], 3, "billFiles"); } catch (e) { expect((e as CommandError).fields.billFiles).toMatch(/photos and PDF/); }
    const m: FileMeta = { ...ref({ thumb: "data:image/jpeg;base64,AAAA" }), kind: "bill", provider: "inline", projectId: null, createdBy: "u", createdAt: "x" };
    expect(toFileRef(m)).toEqual(ref({ thumb: "data:image/jpeg;base64,AAAA" }));
    expect(droppedFileRefs([ref(), ref({ id: "fgone12345" })], [ref()]).map((f) => f.id)).toEqual(["fgone12345"]);
    expect(droppedFileRefs(undefined, [ref()])).toEqual([]);
  });
});

describe("shrinking a photo: the maths", () => {
  it("FL-20 a picture is fitted inside the longest side, keeps its shape, and is never enlarged", () => {
    expect(fitWithin({ width: 4000, height: 3000 }, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin({ width: 3000, height: 4000 }, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin({ width: 800, height: 600 }, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin({ width: 12000, height: 10 }, 1600)).toEqual({ width: 1600, height: 1 });
    expect(fitWithin({ width: 0, height: 0 }, 1600)).toEqual({ width: 1, height: 1 });
  });

  it("FL-21 the steps go from best looking to smallest, each one smaller than the last, never below 640 px or quality 0.45", () => {
    const steps = compressionSteps({ width: 4000, height: 3000 });
    expect(steps.map((s) => [s.maxSide, s.quality])).toEqual([[1600, 0.72], [1600, 0.55], [1280, 0.6], [1280, 0.45], [1024, 0.5], [800, 0.5], [640, 0.45]]);
    expect(steps[0]).toMatchObject({ width: 1600, height: 1200 });
    expect(Math.min(...steps.map((s) => s.quality))).toBe(0.45);
    expect(steps[steps.length - 1]).toMatchObject({ width: 640, height: 480 });
    // A small original is not enlarged, so the steps that would repeat a size at a higher quality drop out.
    const small = compressionSteps({ width: 900, height: 600 });
    expect(small.map((s) => [s.width, s.quality])).toEqual([[900, 0.72], [900, 0.55], [900, 0.45], [800, 0.5], [640, 0.45]]);
    expect(compressionSteps({ width: 300, height: 200 }).map((s) => [s.width, s.quality])).toEqual([[300, 0.72], [300, 0.55], [300, 0.45]]);
  });

  it("FL-22 after each try the next step is chosen by size: stop under 150 KB, jump past steps that would still be too big", () => {
    const steps = compressionSteps({ width: 4000, height: 3000 });
    expect(nextStepIndex(steps, 0, 150_000)).toBeNull(); // on target: keep it
    expect(nextStepIndex(steps, 0, 90_000)).toBeNull();
    expect(nextStepIndex(steps, 0, 190_000)).toBe(1); // a little over: one step down is enough
    expect(nextStepIndex(steps, 0, 420_000)).toBeGreaterThan(2); // far over: skip ahead
    expect(nextStepIndex(steps, 0, 5_000_000)).toBe(steps.length - 1); // hopeless: go straight to the smallest
    expect(nextStepIndex(steps, steps.length - 1, 400_000)).toBeNull(); // nothing smaller left
    // Whatever the sizes, the walk ends and never goes backwards.
    let i: number | null = 0, tries = 0;
    while (i !== null) { const next: number | null = nextStepIndex(steps, i, 900_000); if (next !== null) expect(next).toBeGreaterThan(i); i = next; tries++; }
    expect(tries).toBeLessThanOrEqual(steps.length);
  });

  it("FL-23 the smallest try is kept if it is under the hard cap; over the cap the picture is refused", () => {
    expect(bestAttempt([{ bytes: 420_000, i: 0 }, { bytes: 160_000, i: 3 }])).toEqual({ bytes: 160_000, i: 3 });
    expect(bestAttempt([{ bytes: 700_000 }])).toEqual({ bytes: 700_000 });
    expect(bestAttempt([{ bytes: 700_001 }, { bytes: 900_000 }])).toBeNull();
    expect(bestAttempt([])).toBeNull();
    expect(bestAttempt([{ bytes: 2_000_000 }], 10 * 1024 * 1024)).toEqual({ bytes: 2_000_000 });
  });

  it("FL-24 the preview: 160 px first, smaller if needed, and its data URL must fit in 20,000 characters", () => {
    const t = thumbSteps({ width: 1600, height: 1200 });
    expect(t[0]).toMatchObject({ width: 160, height: 120, quality: 0.6 });
    expect(t[t.length - 1]!.width).toBe(64);
    expect(thumbFits(`data:image/jpeg;base64,${"A".repeat(19_000)}`)).toBe(true);
    expect(thumbFits(`data:image/jpeg;base64,${"A".repeat(20_000)}`)).toBe(false);
    expect(thumbFits("data:text/html;base64,AAAA")).toBe(false);
    expect(dataUrlBytes("data:image/jpeg;base64,AAAA")).toBe(3);
    expect(dataUrlBytes("data:image/jpeg;base64,AAA=")).toBe(2);
    expect(dataUrlBytes("data:image/jpeg;base64,AA==")).toBe(1);
    expect(dataUrlBytes("data:image/jpeg;base64,")).toBe(0);
  });

  it("FL-25 bills, ID proofs and documents are JPEG (they open everywhere); site photos use WebP when the browser can make it", () => {
    expect(pickImageFormat("bill", true)).toBe("image/jpeg");
    expect(pickImageFormat("id_proof", true)).toBe("image/jpeg");
    expect(pickImageFormat("photo", true)).toBe("image/webp");
    expect(pickImageFormat("photo", false)).toBe("image/jpeg");
  });
});

describe("who may attach, see and remove a file", () => {
  it("FL-30 ID proofs and signatures: owner and accountant only, to attach and to see (D-22; the CA never, PRD 11A.6)", () => {
    for (const kind of ["id_proof", "signature"] as const) {
      for (const c of everyone) {
        const fin = c.role === "owner" || c.role === "accountant";
        expect(canAttachFile(kind, "pA", c)).toBe(fin);
        expect(canReadFile(meta({ kind, projectId: "pA", createdBy: c.uid }), c)).toBe(fin);
      }
    }
  });

  it("FL-31 site roles see only the files of projects they are assigned to; company files are for finance", () => {
    expect(canReadFile(meta({ kind: "photo", projectId: "pA" }), pm)).toBe(true);
    expect(canReadFile(meta({ kind: "photo", projectId: "pB" }), pm)).toBe(true);
    expect(canReadFile(meta({ kind: "photo", projectId: "pC" }), pm)).toBe(false);
    expect(canReadFile(meta({ kind: "photo", projectId: "pA" }), sup)).toBe(true);
    expect(canReadFile(meta({ kind: "photo", projectId: "pB" }), sup)).toBe(false);
    expect(canReadFile(meta({ kind: "document", projectId: null }), pm)).toBe(false);
    expect(canReadFile(meta({ kind: "document", projectId: null, createdBy: "uPm" }), pm)).toBe(false);
    for (const c of [owner, accountant]) expect(canReadFile(meta({ kind: "document", projectId: null }), c)).toBe(true);
    // Taken off the project: even their own upload is no longer theirs to see.
    expect(canReadFile(meta({ kind: "photo", projectId: "pZ", createdBy: "uSup" }), sup)).toBe(false);
  });

  it("FL-32 bills: a supervisor sees only the ones they attached; the PM sees the project's; the CA sees bills and nothing else; the viewer nothing", () => {
    expect(canReadFile(meta({ kind: "bill", projectId: "pA", createdBy: "uSup" }), sup)).toBe(true);
    expect(canReadFile(meta({ kind: "bill", projectId: "pA", createdBy: "uPm" }), sup)).toBe(false);
    expect(canReadFile(meta({ kind: "bill", projectId: "pA", createdBy: "uSup" }), pm)).toBe(true);
    expect(canReadFile(meta({ kind: "bill", projectId: "pC" }), ca)).toBe(true);
    expect(canReadFile(meta({ kind: "bill", projectId: null }), ca)).toBe(true);
    for (const kind of ["photo", "document"] as const) expect(canReadFile(meta({ kind }), ca)).toBe(false);
    for (const kind of FILE_KINDS) expect(canReadFile(meta({ kind }), viewer)).toBe(false);
    // A document without a known kind is treated as restricted.
    expect(canReadFile(meta({ kind: "other" as never }), pm)).toBe(false);
    expect(canReadFile({ projectId: "pA" }, pm)).toBe(false);
    expect(canReadFile({ projectId: "pA" }, owner)).toBe(true);
  });

  it("FL-33 attaching: finance anything anywhere; site roles bills, photos and documents on their own projects; viewer and CA nothing", () => {
    for (const kind of FILE_KINDS) { expect(canAttachFile(kind, null, owner)).toBe(true); expect(canAttachFile(kind, "pZ", accountant)).toBe(true); }
    for (const kind of ["bill", "photo", "document"] as const) {
      expect(canAttachFile(kind, "pA", sup)).toBe(true);
      expect(canAttachFile(kind, "pB", sup)).toBe(false);
      expect(canAttachFile(kind, null, pm)).toBe(false);
      expect(canAttachFile(kind, "pB", pm)).toBe(true);
      expect(canAttachFile(kind, "pA", viewer)).toBe(false);
      expect(canAttachFile(kind, "pA", ca)).toBe(false);
    }
    expect(canAttachFile("video", "pA", owner)).toBe(false);
  });

  it("FL-34 removing: the person who attached it for 24 hours, then only the owner or the accountant", () => {
    const m = meta({ kind: "bill", projectId: "pA", createdBy: "uSup", createdAt: "2026-11-16T04:00:00.000Z" });
    expect(canDeleteFile(m, sup, "2026-11-16T05:00:00.000Z")).toBe(true);
    expect(canDeleteFile(m, sup, "2026-11-17T03:59:59.000Z")).toBe(true);
    expect(canDeleteFile(m, sup, "2026-11-17T04:00:00.000Z")).toBe(false);
    expect(canDeleteFile(m, pm, "2026-11-16T05:00:00.000Z")).toBe(false); // not theirs
    expect(canDeleteFile(m, owner, "2027-01-01T00:00:00.000Z")).toBe(true);
    expect(canDeleteFile(m, accountant, "2027-01-01T00:00:00.000Z")).toBe(true);
    expect(canDeleteFile(m, ca, "2026-11-16T05:00:00.000Z")).toBe(false);
    expect(canDeleteFile({ ...m, createdAt: "not a date" }, sup, "2026-11-16T05:00:00.000Z")).toBe(false);
    // Taken off the project since: no longer theirs to remove.
    expect(canDeleteFile({ ...m, projectId: "pZ" }, sup, "2026-11-16T05:00:00.000Z")).toBe(false);
  });
});

describe("which provider takes a new file", () => {
  it("FL-40 R2 when it is ready, else Cloudinary, else the built-in store", () => {
    expect(activeStorageProvider({})).toBe("inline");
    expect(activeStorageProvider({ cloudinary: true })).toBe("cloudinary");
    expect(activeStorageProvider({ r2: true, cloudinary: true })).toBe("r2");
    expect(activeStorageProvider({ r2: false, cloudinary: false })).toBe("inline");
  });

  it("FL-41 offline a file always goes inline (it waits on the phone); ID proofs and signatures never go to Cloudinary", () => {
    expect(providerForUpload("r2", "bill", true)).toBe("r2");
    expect(providerForUpload("r2", "bill", false)).toBe("inline");
    expect(providerForUpload("cloudinary", "photo", true)).toBe("cloudinary");
    expect(providerForUpload("cloudinary", "id_proof", true)).toBe("inline");
    expect(providerForUpload("cloudinary", "signature", true)).toBe("inline");
    expect(providerForUpload("r2", "id_proof", true)).toBe("r2");
    expect(providerForUpload("inline", "photo", true)).toBe("inline");
  });
});

// The registry entries arrive with the lead's patch to integrations.ts; until then these two are skipped, not failed.
const REG = INTEGRATIONS as unknown as Record<string, IntegrationDef | undefined>;
describe("storage providers on Setup & integrations (night-build contract section 7)", () => {
  it.skipIf(!REG.storageR2)("FL-45 built-in storage needs nothing; R2 and Cloudinary are optional and do not hold up the verified count; Cloud Storage is a disabled placeholder", () => {
    expect(REG.storage).toMatchObject({ kind: "check", available: true, counts: true, testsIn: "browser", fields: [] });
    expect(REG.storageR2).toMatchObject({ kind: "stored", available: true, counts: false, testsIn: "server" });
    expect(REG.storageR2!.fields.map((f) => [f.key, f.secret, f.required])).toEqual([
      ["accountId", false, true], ["accessKeyId", false, true], ["secretAccessKey", true, true], ["bucket", false, true], ["publicBaseUrl", false, false],
    ]);
    expect(REG.storageCloudinary).toMatchObject({ kind: "stored", available: true, counts: false, testsIn: "server" });
    expect(REG.storageCloudinary!.fields.map((f) => [f.key, f.secret, f.required])).toEqual([["cloudName", false, true], ["uploadPreset", false, true]]);
    expect(REG.storageFirebase).toMatchObject({ available: false, counts: false });
    expect(verifiedSummary({}).total).toBe(10);
  });

  it.skipIf(!REG.storageR2)("FL-46 the R2 settings are checked before saving: the account ID and bucket can only be what Cloudflare issues, and a blank secret keeps the saved one", () => {
    const def = REG.storageR2!;
    const good = { accountId: "0123456789abcdef0123456789abcdef", accessKeyId: "0123456789abcdef0123456789abcdef", secretAccessKey: "a".repeat(64), bucket: "ambika-crm-files", publicBaseUrl: "" };
    expect(validateIntegration(def, good, {})).toEqual({});
    expect(validateIntegration(def, { ...good, secretAccessKey: "" }, { secretAccessKey: true })).toEqual({});
    expect(validateIntegration(def, { ...good, secretAccessKey: "" }, {})).toHaveProperty("secretAccessKey");
    // These two become part of an address the server calls, so nothing but the expected shape is accepted.
    for (const accountId of ["evil.example.com/x", "0123", "0123456789ABCDEF0123456789ABCDEF.attacker.io"]) expect(validateIntegration(def, { ...good, accountId }, {})).toHaveProperty("accountId");
    for (const bucket of ["../other", "Has Space", "a", "x/y"]) expect(validateIntegration(def, { ...good, bucket }, {})).toHaveProperty("bucket");
    expect(validateIntegration(def, { ...good, publicBaseUrl: "http://files.example.com" }, {})).toHaveProperty("publicBaseUrl");
    expect(validateIntegration(def, { ...good, publicBaseUrl: "https://files.ambikagroups.tech" }, {})).toEqual({});
    const cl = REG.storageCloudinary!;
    expect(validateIntegration(cl, { cloudName: "ambika", uploadPreset: "crm_unsigned" }, {})).toEqual({});
    expect(validateIntegration(cl, { cloudName: "Bad Name/..", uploadPreset: "crm_unsigned" }, {})).toHaveProperty("cloudName");
    expect(validateIntegration(cl, { cloudName: "ambika", uploadPreset: "" }, {})).toHaveProperty("uploadPreset");
  });
});

describe("how full the free space is", () => {
  const GIB = 1_073_741_824;
  it("FL-50 count, size and the share of 1 GiB, with a warning from 70% and a stronger one from 90%", () => {
    expect(usageSummary({ files: 0, bytes: 0 })).toMatchObject({ files: 0, bytes: 0, percent: 0, level: "ok", remainingBytes: GIB, budgetBytes: GIB });
    expect(usageSummary({ files: 1000, bytes: 100_000_000 })).toMatchObject({ percent: 9.3, level: "ok" });
    expect(usageSummary({ files: 1, bytes: Math.floor(GIB * 0.7) - 2_000_000 }).level).toBe("ok");
    expect(usageSummary({ files: 1, bytes: Math.ceil(GIB * 0.7) })).toMatchObject({ percent: 70, level: "warning" });
    expect(usageSummary({ files: 1, bytes: Math.ceil(GIB * 0.9) - 2_000_000 }).level).toBe("warning");
    expect(usageSummary({ files: 1, bytes: Math.ceil(GIB * 0.9) })).toMatchObject({ percent: 90, level: "critical" });
    expect(usageSummary({ files: 1, bytes: GIB })).toMatchObject({ percent: 100, level: "full", remainingBytes: 0, photosLeft: 0 });
    expect(usageSummary({ files: 1, bytes: GIB + 5 })).toMatchObject({ level: "full", remainingBytes: 0 });
    // Rounded down to one decimal, so 69.99% never reads as 70.
    expect(usageSummary({ files: 1, bytes: Math.floor(GIB * 0.6999) }).percent).toBe(69.9);
  });

  it("FL-51 about how many more photos fit: at 100 KB each when empty (over 8,000 without the other records), then at the average so far", () => {
    expect(usageSummary({ files: 0, bytes: 0 }).photosLeft).toBe(10_737);
    expect(usageSummary({ files: 2000, bytes: 300_000_000 }).photosLeft).toBe(Math.floor((GIB - 300_000_000) / 150_000));
    expect(usageSummary({ files: 10, bytes: 1000 }).photosLeft).toBe(Math.floor((GIB - 1000) / 20_000)); // tiny files do not inflate the estimate
    expect(usageSummary({ files: 5, bytes: 500_000 }, 1_000_000)).toMatchObject({ percent: 50, photosLeft: 5 });
    expect(usageSummary({ files: -3, bytes: Number.NaN })).toMatchObject({ files: 0, bytes: 0, level: "ok" });
  });

  it("FL-52 sizes are written the way people say them", () => {
    expect(formatFileSize(512)).toBe("512 bytes");
    expect(formatFileSize(142_300)).toBe("142 KB");
    expect(formatFileSize(1_240_000)).toBe("1.2 MB");
    expect(formatFileSize(840_000_000)).toBe("840.0 MB");
    expect(formatFileSize(1_073_741_824)).toBe("1.07 GB");
  });
});
