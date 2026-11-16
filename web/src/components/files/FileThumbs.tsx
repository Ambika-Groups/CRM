"use client";
/**
 * The attached files of a record as small previews: tap one to see it full size; "Remove" (when allowed) asks first.
 * Used by FileAttach inside forms and by record pages to show what is attached (leave `onRemove` out for read-only).
 */
import { formatFileSize, PDF_MIME, type FileRef } from "@ag/core";
import { FileText } from "lucide-react";
import { useState } from "react";
import { Icon } from "@/components/shell/Icon";
import { ConfirmDialog } from "@/components/ui/feedback";
import { FileViewer } from "./FileViewer";
import { useFilesT } from "./useFilesApi";

export function FileThumbs({ files, onRemove, emptyText, disabled }: {
  files: FileRef[];
  /** Called after the person confirms. Leave out to show the files without a Remove button. */
  onRemove?: (file: FileRef) => Promise<void> | void;
  /** Shown when there are no files; nothing is shown when left out. */
  emptyText?: string;
  disabled?: boolean;
}) {
  const ft = useFilesT();
  const [viewing, setViewing] = useState<FileRef | null>(null);
  const [removing, setRemoving] = useState<FileRef | null>(null);
  if (!files.length) return emptyText ? <p className="small muted" data-file-none>{emptyText}</p> : null;
  return (
    <>
      <ul className="file-thumbs" aria-label={ft("listLabel")}>
        {files.map((f) => (
          <li key={f.id} className="file-thumb" data-file-thumb data-file-id={f.id} data-size-bytes={f.sizeBytes} data-mime={f.mime}>
            <button type="button" className="file-thumb-open" onClick={() => setViewing(f)} aria-label={ft("viewName", { name: f.name })} data-file-view-open>
              {f.mime !== PDF_MIME && f.thumb
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={f.thumb} alt="" width={72} height={72} />
                : <span className="file-pdf-tile"><FileText width={24} height={24} strokeWidth={1.75} aria-hidden="true" /><span>{f.mime === PDF_MIME ? "PDF" : ft("photo")}</span></span>}
            </button>
            <div className="file-thumb-text">
              <span className="file-thumb-name" title={f.name}>{f.name}</span>
              <span className="small muted">{formatFileSize(f.sizeBytes)}</span>
              {onRemove && (
                <button type="button" className="btn btn-text btn-sm file-thumb-remove" disabled={disabled} onClick={() => setRemoving(f)} aria-label={ft("removeName", { name: f.name })} data-file-remove>
                  <Icon name="trash" size={16} />{ft("remove")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <FileViewer file={viewing} onClose={() => setViewing(null)} />
      {onRemove && (
        <ConfirmDialog open={!!removing} onOpenChange={(o) => { if (!o) setRemoving(null); }} title={ft("removeTitle")} body={ft("removeBody", { name: removing?.name ?? "" })}
          confirmLabel={ft("remove")} onConfirm={async () => { if (removing) await onRemove(removing); }} />
      )}
    </>
  );
}
