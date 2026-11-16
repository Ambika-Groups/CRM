"use client";
/**
 * A demo-only page for trying the files adapter before a real form uses it (route: /settings/files-check/). Three attach
 * controls (a bill, site photos, an ID proof) and the list of every file kept in the demo store, which is still there
 * after a reload. The browser checks in tools/jobs/make-files.mjs run against this page. In Firebase mode it shows
 * nothing but a short note, so no test files can land in the real database.
 */
import { toFileRef, usageSummary, formatFileSize, type FileMeta, type FileRef } from "@ag/core";
import { useEffect, useState } from "react";
import { FileAttach } from "@/components/shared/FileAttach";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState, Skeleton, useToast } from "@/components/ui/feedback";
import { useData, useRead, useSession } from "@/data/DataProvider";
import { FilesError } from "@/data/files/types";
import { FileThumbs } from "./FileThumbs";
import { useFilesApi, useFilesT } from "./useFilesApi";

export function FilesDemo() {
  const ft = useFilesT();
  const toast = useToast();
  const { source, status, version } = useData();
  const session = useSession();
  const files = useFilesApi();
  const [bill, setBill] = useState<FileRef[]>([]);
  const [site, setSite] = useState<FileRef[]>([]);
  const [idProof, setIdProof] = useState<FileRef[]>([]);
  const [usage, setUsage] = useState<{ files: number; bytes: number } | null>(null);
  const title = ft("check.title");
  const demo = source.mode === "demo";
  // Site roles may attach only on a project they are assigned to; finance roles need none.
  const projectId = session?.projectIds[0] ?? null;
  const finance = session?.role === "owner" || session?.role === "accountant";

  const saved = useRead(`files-check:${session?.uid}`, (s) => s.query<FileMeta>("files", { orderBy: [{ field: "createdAt", dir: "desc" }], limit: 50 }));
  useEffect(() => {
    let live = true;
    if (files && demo) files.usage().then((u) => { if (live) setUsage(u); }, () => { if (live) setUsage(null); });
    return () => { live = false; };
  }, [files, demo, version]);

  const remove = async (f: FileRef) => {
    if (!files) return;
    try {
      await files.remove(f);
      for (const set of [setBill, setSite, setIdProof]) set((list) => list.filter((x) => x.id !== f.id));
      toast(ft("removed"));
    } catch (e) {
      toast(e instanceof FilesError && e.code === "offline" ? ft("err.offline") : ft("err.removeDenied"), "error");
    }
  };

  const crumbs = [{ label: title }];
  if (status === "ready" && !demo) {
    return <AppShell nav="settings" title={title} crumbs={crumbs}><EmptyState icon="info" title={title} body={ft("check.sub")} /></AppShell>;
  }
  const summary = usage ? usageSummary(usage) : null;
  return (
    <AppShell nav="settings" title={title} crumbs={crumbs}>
      <div className="page-head"><div className="heading"><h1>{title}</h1><p className="sub">{ft("check.sub")}</p></div></div>
      <div className="files-check" data-files-check>
        <section className="card" data-check="bill">
          <FileAttach value={bill} onChange={setBill} kind="bill" max={3} label={ft("check.bill")} projectId={projectId} required />
        </section>
        <section className="card" data-check="site">
          <FileAttach value={site} onChange={setSite} kind="photo" accept="image/*" max={5} label={ft("check.site")} projectId={projectId} />
        </section>
        {finance && (
          <section className="card" data-check="id">
            <FileAttach value={idProof} onChange={setIdProof} kind="id_proof" max={1} label={ft("check.idProof")} />
          </section>
        )}
        <section className="card" data-saved-files aria-labelledby="files-check-saved">
          <h2 id="files-check-saved">{ft("check.saved")}</h2>
          <p className="small muted">{ft("check.savedBody")}</p>
          {summary && <p className="small" data-usage data-usage-files={summary.files} data-usage-bytes={summary.bytes}>{ft("check.usage", { files: summary.files, size: formatFileSize(summary.bytes), percent: summary.percent })}</p>}
          {!saved ? <Skeleton lines={2} /> : saved.items.length === 0
            ? <EmptyState icon="info" title={ft("check.empty")} body={ft("check.emptyBody")} />
            : <FileThumbs files={saved.items.map(toFileRef)} onRemove={remove} />}
        </section>
      </div>
    </AppShell>
  );
}
