"use client";
/**
 * Shows one attached file full size: a photo in the dialog, a PDF as a tile with "Open in a new tab" and "Download".
 * The bytes are fetched only now, through the files adapter (lists show the small preview kept on the FileRef).
 */
import { formatFileSize, PDF_MIME, type FileRef } from "@ag/core";
import * as D from "@radix-ui/react-dialog";
import { Download, ExternalLink, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { FilesError } from "@/data/files/types";
import { useFilesApi, useFilesT } from "./useFilesApi";

type State = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "error"; message: string };

export function FileViewer({ file, onClose }: { file: FileRef | null; onClose: () => void }) {
  const ft = useFilesT();
  const files = useFilesApi();
  const [state, setState] = useState<State>({ kind: "loading" });
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!file) return;
    let live = true;
    setState({ kind: "loading" });
    if (!files) { setState({ kind: "error", message: ft("notReady") }); return; }
    files.url(file).then(
      (url) => { if (live) setState({ kind: "ready", url }); },
      (e) => { if (live) setState({ kind: "error", message: e instanceof FilesError && ["offline", "denied", "missing"].includes(e.code) ? ft(`err.${e.code}`) : ft("err.openFailed") }); },
    );
    return () => { live = false; };
  }, [file, files, ft]);

  const isPdf = file?.mime === PDF_MIME;
  return (
    <D.Root open={!!file} onOpenChange={(o) => { if (!o) onClose(); }}>
      <D.Portal>
        <D.Overlay className="scrim" />
        <D.Content className="dialog dialog-fixed file-viewer" data-file-viewer aria-describedby={undefined}
          onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement | null; }}
          onCloseAutoFocus={(e) => { const o = opener.current; if (o && o !== document.body && o.isConnected) { e.preventDefault(); o.focus(); } }}>
          <D.Title asChild><h2 className="file-viewer-title">{file?.name ?? ""}</h2></D.Title>
          {file && <p className="small muted file-viewer-meta">{isPdf ? ft("pdf") : ft("photo")} · {formatFileSize(file.sizeBytes)}</p>}
          <div className="file-viewer-body" data-file-view-state={state.kind}>
            {state.kind === "loading" && <p role="status" className="muted">{ft("opening")}</p>}
            {state.kind === "error" && <p role="alert" className="field-error"><Icon name="alert" size={16} />{state.message}</p>}
            {state.kind === "ready" && file && (isPdf
              ? <div className="file-pdf-tile large"><FileText width={40} height={40} strokeWidth={1.5} aria-hidden="true" /><span>{ft("pdf")}</span></div>
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={state.url} alt={file.name} className="file-viewer-img" data-file-view />)}
          </div>
          <div className="dialog-actions">
            {state.kind === "ready" && file && (
              <>
                <a className="btn btn-secondary" href={state.url} target="_blank" rel="noopener noreferrer" data-file-open><ExternalLink width={18} height={18} strokeWidth={1.75} aria-hidden="true" />{ft("open")}</a>
                <a className="btn btn-secondary" href={state.url} download={file.name} data-file-download><Download width={18} height={18} strokeWidth={1.75} aria-hidden="true" />{ft("download")}</a>
              </>
            )}
            <D.Close asChild><Button variant="primary">{ft("close")}</Button></D.Close>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
