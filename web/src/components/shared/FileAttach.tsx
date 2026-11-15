"use client";
/**
 * Attach photos or documents to a record (thin local version; Lane A's files adapter replaces the storage behind it and
 * keeps this component's props). Images are shrunk in the browser and kept inline as a data URL on the FileRef's `thumb`
 * field, so no Storage bucket is needed. Files over the size cap are refused with a plain message.
 */
import type { FileRef } from "@ag/core";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

const MAX_BYTES = 300_000;

async function shrink(file: File): Promise<{ dataUrl: string; mime: string }> {
  if (!file.type.startsWith("image/")) {
    const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
    return { dataUrl, mime: file.type || "application/octet-stream" };
  }
  const bmp = await createImageBitmap(file);
  let side = 1280;
  for (let attempt = 0; attempt < 5; attempt++) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", 0.72);
    if (dataUrl.length * 0.75 <= MAX_BYTES) return { dataUrl, mime: "image/jpeg" };
    side = Math.round(side * 0.75);
  }
  throw new Error("too_big");
}

export function FileAttach({ value, onChange, accept = "image/*", max = 5, label }: { value: FileRef[]; onChange: (next: FileRef[]) => void; accept?: string; max?: number; label?: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [err, setErr] = useState("");
  async function add(files: FileList | null) {
    if (!files?.length) return;
    setErr("");
    const next = [...value];
    for (const f of [...files]) {
      if (next.length >= max) { setErr(t("common.attachMax", { max, defaultValue: "You can attach up to {{max}} files." })); break; }
      try {
        const { dataUrl, mime } = await shrink(f);
        const fid = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        next.push({ id: fid, name: f.name, mime, sizeBytes: Math.round(dataUrl.length * 0.75), path: `inline/${fid}`, thumb: dataUrl });
      } catch {
        setErr(t("common.attachTooBig", { name: f.name, defaultValue: "{{name}} is too big. Choose a smaller file." }));
      }
    }
    onChange(next);
  }
  return (
    <div>
      <label htmlFor={id} className="field-label">{label ?? t("common.attach", { defaultValue: "Attach photos or files" })}</label>
      <input id={id} type="file" accept={accept} multiple onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
      {err ? <p role="alert" className="field-error">{err}</p> : null}
      <ul className="attach-list">
        {value.map((f) => (
          <li key={f.id}>
            {f.mime.startsWith("image/") && f.thumb ? <img src={f.thumb} alt={f.name} width={64} height={64} style={{ objectFit: "cover" }} /> : <span>{f.name}</span>}
            <button type="button" className="btn btn-secondary" onClick={() => onChange(value.filter((x) => x.id !== f.id))}>{t("common.remove", { defaultValue: "Remove" })}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
