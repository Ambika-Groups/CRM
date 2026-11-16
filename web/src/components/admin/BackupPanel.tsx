"use client";
// "Download backup" (PRD §3.1 rule 16 as changed by D-51: the free plan keeps no backups). The browser reads every
// collection 50 records at a time, builds one JSON file, saves it to the device, and notes the date so the owner is
// reminded again after 7 days. Owner only. The file is private (D-49) and does not hold the photos' own bytes.
import { todayIST } from "@ag/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { useData, useDoc, useSession } from "@/data/DataProvider";
import { date } from "@/lib/fmt";
import { backupCounts, buildBackup, recordBackup, type BackupProgress } from "./adminApi";
import { backupAgeDays, backupDue, backupFileName, backupParts, type BackupMeta, type BackupRecord } from "./core";

/** What the last download held, for the browser checks (tools/jobs/make-admin.mjs): the details and the collection names, not the records. */
interface LastBackup { fileName: string; bytes: number; meta: BackupMeta; collections: string[] }
declare global { interface Window { __agLastBackup?: LastBackup } }

const num = (n: number) => Math.round(n).toLocaleString("en-IN");

export function BackupPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const session = useSession();
  const { source } = useData();
  const saved = useDoc<BackupRecord>("settings", "backup");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [done, setDone] = useState<{ fileName: string; total: number; failed: string[]; noted: boolean; at: string } | null>(null);
  const [error, setError] = useState(false);

  if (!session || session.role !== "owner") return null;
  const today = todayIST();
  // The download just made counts at once, before the saved note has been read again.
  const lastAt = done && done.failed.length === 0 ? done.at : saved?.lastBackupAt || null;
  const lastTotal = done && done.failed.length === 0 ? done.total : saved?.total ?? 0;
  const due = saved !== undefined && backupDue(lastAt, today);
  const age = backupAgeDays(lastAt, today);

  const download = async () => {
    setBusy(true);
    setError(false);
    setDone(null);
    try {
      const b = await buildBackup(source, session, setProgress);
      // Nothing could be read at all (offline): no file, and say so.
      if (b.meta.total === 0) throw new Error("empty");
      const fileName = backupFileName(b.meta.date);
      const blob = new Blob(backupParts(b), { type: "application/json" });
      window.__agLastBackup = { fileName, bytes: blob.size, meta: b.meta, collections: Object.keys(b.collections) };
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      let noted = true;
      try { await recordBackup(source, { counts: backupCounts(b), complete: b.meta.failed.length === 0 }); } catch { noted = false; }
      setDone({ fileName, total: b.meta.total, failed: b.meta.failed, noted, at: b.meta.madeAt });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <section className="card section" data-backup-panel data-due={due} aria-labelledby="backup-title">
      <h2 className="card-title" id="backup-title">{t("admin.backup.title")}</h2>
      <p className="hint"><Icon name="info" size={16} /><span>{t("admin.backup.hint")}</span></p>
      {due && (
        <div className="banner warning" role="status" data-backup-due><Icon name="alert" />
          <span className="text">{age === null ? t("admin.backup.dueNever") : t("admin.backup.due", { days: age })}</span></div>
      )}
      {lastAt && age !== null && (
        <p data-backup-last>{age === 0 ? t("admin.backup.lastToday", { n: num(lastTotal) }) : t("admin.backup.last", { date: date(todayIST(new Date(lastAt)), lang), n: num(lastTotal) })}</p>
      )}
      <ul className="admin-notes">
        <li><Icon name="lock" size={16} /><span>{t("admin.backup.private")}</span></li>
        <li><Icon name="image" size={16} /><span>{t("admin.backup.noPhotos")}</span></li>
        <li><Icon name="clock" size={16} /><span>{t("admin.backup.readsNote")}</span></li>
      </ul>
      <div className="form-actions admin-actions">
        <Button variant="primary" onClick={() => void download()} disabled={busy} data-backup-download><Icon name="download" />{busy ? t("admin.backup.working") : t("admin.backup.download")}</Button>
      </div>
      <p className="admin-progress" role="status" aria-live="polite" data-backup-progress>
        {busy && progress ? t("admin.backup.progress", { name: t(`admin.usage.collection.${progress.collection}`, { defaultValue: progress.collection }), step: progress.step, steps: progress.steps, n: num(progress.records) }) : ""}
      </p>
      {error && <div className="banner error" role="alert" data-backup-error><Icon name="alert" /><span className="text">{t("admin.backup.failed")}</span></div>}
      {done && (
        <div className={`banner ${done.failed.length ? "warning" : "info"}`} role="status" data-backup-done data-complete={done.failed.length === 0}>
          <Icon name={done.failed.length ? "alert" : "check-circle"} />
          <span className="text">
            {t("admin.backup.done", { n: num(done.total), file: done.fileName })}
            {done.failed.length > 0 && <> {t("admin.backup.incomplete", { list: done.failed.map((c) => t(`admin.usage.collection.${c}`, { defaultValue: c })).join(", ") })}</>}
            {!done.noted && <> {t("admin.backup.noted")}</>}
          </span>
        </div>
      )}
    </section>
  );
}
