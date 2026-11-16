"use client";
/**
 * Attach photos or documents to a record (the files adapter, group A).
 *
 *   <FileAttach value={refs} onChange={setRefs} accept="image/*" max={3} label="Bill photo" kind="bill" projectId={projectId} />
 *
 * A photo is made smaller in the browser (longest side 1600 px, aiming under 150 KB, rotation kept right), then kept
 * through the files adapter: in the demo store, inside the database on the free plan, or in Cloudflare R2 / Cloudinary
 * when the owner has set one up. A PDF is kept as it is, up to the cap. The record keeps only the returned FileRefs.
 * On a phone "Take photo" opens the camera. Offline (Firebase mode) the file waits on the phone and is sent later.
 *
 * Props: `kind` says what the files are ("bill", "photo", "id_proof", "document", "signature"); when left out a picture
 * is a "photo" and a PDF a "document". `projectId` is needed for project managers and supervisors (they may attach only
 * on their own projects). `owner` names the record, when it already exists. `required` and `hint` are for the form.
 *
 * Removing a file added in this form deletes it from storage at once. Removing one that was already on the record only
 * takes it off the list: the record's own save decides (core `droppedFileRefs` tells a command which bytes to delete).
 */
import { acceptFor, FILE_LIMITS, formatFileSize, guessMime, PDF_MIME, type FileKind, type FileRef } from "@ag/core";
import { Camera, Paperclip } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { FileThumbs } from "@/components/files/FileThumbs";
import { useFilesApi, useFilesT, useFilesWaitOffline } from "@/components/files/useFilesApi";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { FilesError } from "@/data/files/types";

export interface FileAttachProps {
  value: FileRef[];
  onChange: (next: FileRef[]) => void;
  accept?: string;
  max?: number;
  label?: string;
  kind?: FileKind;
  owner?: { collection: string; id: string };
  projectId?: string | null;
  required?: boolean;
  hint?: string;
}

export function FileAttach({ value, onChange, accept, max = 5, label, kind, owner, projectId, required, hint }: FileAttachProps) {
  const ft = useFilesT();
  const files = useFilesApi();
  const waitsOffline = useFilesWaitOffline();
  const id = useId();
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  /** Files added in this form (not yet on a saved record): removing one deletes its bytes straight away. */
  const addedHere = useRef(new Set<string>());
  /** The newest list, so several files picked together are added one after another without losing any. */
  const latest = useRef(value);
  latest.current = value;
  const [busy, setBusy] = useState<{ n: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState(false);
  useEffect(() => { setPhone(typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches); }, []);

  const types = accept ?? (kind ? acceptFor(kind) : "image/*");
  const takesPdf = types.includes("pdf");
  const full = value.length >= max;

  async function add(list: FileList | null) {
    const picked = list ? [...list] : [];
    if (!picked.length) return;
    setErrors([]);
    setNote("");
    if (!files) { setErrors([ft("notReady")]); return; }
    const problems: string[] = [];
    let offlineKept = false;
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i]!;
      if (latest.current.length >= max) { problems.push(ft("maxReached", { max })); break; }
      setBusy({ n: i + 1, total: picked.length });
      try {
        const isPdf = guessMime(f.name, f.type) === PDF_MIME;
        // A PDF picked where only pictures are wanted is refused by the adapter with the right words.
        const ref = await files.put(f, { name: f.name, kind: kind ?? (isPdf && takesPdf ? "document" : "photo"), ...(owner ? { owner } : {}), projectId: projectId ?? null });
        addedHere.current.add(ref.id);
        latest.current = [...latest.current, ref];
        onChange(latest.current);
        if (waitsOffline && !navigator.onLine) offlineKept = true;
      } catch (e) {
        const code = e instanceof FilesError ? e.code : "failed";
        problems.push(ft(`err.${code}`, { name: f.name }));
      }
    }
    setBusy(null);
    setErrors(problems);
    if (offlineKept) setNote(ft("offlineKept"));
  }

  async function remove(f: FileRef) {
    setErrors([]);
    if (addedHere.current.has(f.id) && files) {
      try { await files.remove(f); } catch (e) {
        setErrors([e instanceof FilesError && e.code === "offline" ? ft("err.offline") : ft("err.removeDenied")]);
        return;
      }
      addedHere.current.delete(f.id);
    }
    latest.current = latest.current.filter((x) => x.id !== f.id);
    onChange(latest.current);
  }

  const helper = hint ?? (kind === "id_proof" ? ft("hintIdProof") : takesPdf ? ft("hintPdf", { size: formatFileSize(FILE_LIMITS.inlineMaxBytes) }) : ft("hintPhoto"));
  return (
    <div className="field file-attach" role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`} data-file-attach={kind ?? "any"} data-busy={busy ? "1" : undefined}>
      <span className="file-attach-label" id={`${id}-label`}>{label ?? ft("attach")}{required ? <span aria-hidden="true"> *</span> : null}</span>
      <FileThumbs files={value} onRemove={remove} disabled={!!busy} />
      <div className="file-attach-actions">
        {phone && (
          <Button onClick={() => cameraRef.current?.click()} disabled={!!busy || full} data-file-camera>
            <Camera width={18} height={18} strokeWidth={1.75} aria-hidden="true" />{ft("takePhoto")}
          </Button>
        )}
        <Button onClick={() => pickRef.current?.click()} disabled={!!busy || full} data-file-choose>
          <Paperclip width={18} height={18} strokeWidth={1.75} aria-hidden="true" />{takesPdf ? ft("chooseFile") : ft("choosePhoto")}
        </Button>
        <span className="small muted" data-file-count>{ft("count", { n: value.length, max })}</span>
      </div>
      {/* The inputs are hidden; the buttons above open them. `capture` asks a phone for its back camera. */}
      <input ref={pickRef} type="file" hidden tabIndex={-1} accept={types} multiple={max > 1} data-file-input
        onChange={(e) => { const l = e.target.files; void add(l).finally(() => { e.target.value = ""; }); }} />
      <input ref={cameraRef} type="file" hidden tabIndex={-1} accept="image/*" capture="environment" data-file-camera-input
        onChange={(e) => { const l = e.target.files; void add(l).finally(() => { e.target.value = ""; }); }} />
      <span className="hint-line" id={`${id}-hint`}>{helper}</span>
      <div role="status" aria-live="polite" className="file-attach-status">
        {busy ? <span data-file-working>{busy.total > 1 ? ft("workingMany", busy) : ft("working")}</span> : null}
        {!busy && note ? <span data-file-note>{note}</span> : null}
        {!busy && full && !errors.length ? <span className="muted">{ft("maxReached", { max })}</span> : null}
      </div>
      {errors.length ? (
        <div role="alert" data-file-errors>
          {errors.map((m, i) => <span className="field-error" key={i}><Icon name="alert" size={16} />{m}</span>)}
        </div>
      ) : null}
    </div>
  );
}
