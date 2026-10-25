"use client";
import { addDays, canOpen, daysBetween, formatDateLong, isFinanceRole, todayIST, type Attendance, type AttendanceStatus, type Project, type RosterEntry } from "@ag/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState, Skeleton, useToast } from "@/components/ui/feedback";
import { TextField } from "@/components/ui/form";
import { useDoc, useOnline, useRead, useRun, useSession, useSmall } from "@/data/DataProvider";
import { useRoleLabel } from "@/lib/roles";
import { fetchAll } from "@/lib/fetchAll";
import { setParam, useParam } from "@/lib/params";
import { enqueue } from "@/lib/queue";

type Mark = { status: AttendanceStatus; ot: number };
const STATUS: AttendanceStatus[] = ["present", "half_day", "absent", "leave", "overtime"];

/** Downscale a photo to a small JPEG for the check-in (demo keeps it on this device; Storage in Firebase mode). */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, 320 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Mark attendance (spec §6.3): one site, one day, one screen. "Mark all present", then tap the exceptions
 * (one tap per worker; overtime adds hours). Works offline: the save is kept on this phone and synced later.
 * The lock window is shown in plain words; the owner can unlock a day.
 */
export function AttendancePage() {
  const { t, i18n } = useTranslation();
  const roleLabel = useRoleLabel();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const online = useOnline();
  const today = todayIST();
  const siteParam = useParam("site");
  const date = useParam("date") ?? today;
  const sites = useRead(`att-sites:${session?.uid}`, (s) => s.query<Project>("projects", {
    where: [{ field: "isArchived", op: "==", value: false }, ...(session && !isFinanceRole(session.role) ? [{ field: "assignedUsers", op: "array-contains" as const, value: session.uid }] : [])],
    orderBy: [{ field: "name" }], limit: 50,
  }));
  const siteId = siteParam ?? sites?.items[0]?.id ?? null;
  const project = sites?.items.find((p) => p.id === siteId) ?? null;
  const roster = useSmall<RosterEntry>(siteId ? `projects/${siteId}/roster` : null);
  const ops = (useSmall<{ id: string; attendanceLockDays?: number }>("settings") ?? []).find((s) => s.id === "operations");
  const unlock = useDoc<{ until: string; reason: string }>("attendance_unlocks", siteId ? `${siteId}_${date}` : null);
  const existing = useRead(`att-day:${siteId}:${date}`, (s) => (siteId
    ? fetchAll<Attendance>(s, "attendance", { where: [{ field: "projectId", op: "==", value: siteId }, { field: "date", op: "==", value: date }] })
    : Promise.resolve([] as Attendance[])));

  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [loadedAt, setLoadedAt] = useState<string>(new Date().toISOString());
  const [saving, setSaving] = useState(false);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracyM: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [reason, setReason] = useState("");

  const active = useMemo(() => (roster ?? []).filter((r) => r.active).sort((a, b) => String(a.workerName).localeCompare(String(b.workerName))), [roster]);
  useEffect(() => {
    if (!existing) return;
    setMarks(Object.fromEntries(existing.map((a) => [a.workerId, { status: a.status, ot: a.otHoursMilli ?? 0 }])));
    setLoadedAt(new Date().toISOString());
  }, [existing]);

  const title = t("attendance.title");
  if (session && !canOpen(session.role, "labour")) return <AppShell nav="labour" title={title} crumbs={[{ label: title }]}><NoAccess name={title} /></AppShell>;

  const lockDays = ops?.attendanceLockDays ?? 3;
  const daysOld = daysBetween(date, today);
  const unlocked = !!unlock && unlock.until > new Date().toISOString();
  const locked = daysOld > lockDays && !unlocked;
  const future = date > today;
  const readOnly = future || (locked && session?.role !== "owner");
  const needSelfie = !!project?.attendanceRequiresSelfie;
  const needGps = !!project?.attendanceRequiresGps;

  const set = (wid: string, status: AttendanceStatus) => setMarks((m) => ({ ...m, [wid]: { status, ot: status === "overtime" ? (m[wid]?.ot || 2000) : 0 } }));
  const allPresent = () => setMarks((m) => Object.fromEntries(active.map((r) => [r.id, m[r.id] && m[r.id]!.status !== "present" ? m[r.id]! : { status: "present" as const, ot: 0 }])));
  const counts = STATUS.map((s) => [s, active.filter((r) => marks[r.id]?.status === s).length] as const);
  const unmarked = active.filter((r) => !marks[r.id]).length;
  const changed = active.filter((r) => {
    const m = marks[r.id]; const e = existing?.find((a) => a.workerId === r.id);
    return m && (!e || e.status !== m.status || (e.otHoursMilli ?? 0) !== m.ot);
  });

  const save = async () => {
    if (!siteId || !changed.length) return;
    const args = {
      projectId: siteId, date, loadedAt,
      marks: changed.map((r) => ({ workerId: r.id, status: marks[r.id]!.status, otHoursMilli: marks[r.id]!.status === "overtime" ? marks[r.id]!.ot : 0 })),
      checkin: needSelfie || needGps ? { selfieDataUrl: selfie, lat: gps?.lat ?? null, lng: gps?.lng ?? null, accuracyM: gps?.accuracyM ?? null } : null,
    };
    if (!online) {
      enqueue("markAttendanceDay", args, `${t("attendance.title")}: ${project?.name ?? ""}, ${formatDateLong(date, lang)}`, `att_${siteId}_${date}`);
      toast(t("attendance.queued"));
      return;
    }
    setSaving(true);
    try {
      const r = await run("markAttendanceDay", args);
      toast(r.conflicts.length ? t("attendance.savedConflicts", { n: r.saved, c: r.conflicts.length }) : t("attendance.saved", { n: r.saved }));
    } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
    finally { setSaving(false); }
  };

  const locate = () => {
    setGpsError(null);
    if (!navigator.geolocation) { setGpsError(t("attendance.gpsUnavailable")); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5, accuracyM: Math.round(p.coords.accuracy) }),
      (e) => setGpsError(e.code === 1 ? t("attendance.gpsDenied") : t("attendance.gpsUnavailable")),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  const checkinMissing = (needSelfie && !selfie) || (needGps && !gps);

  return (
    <AppShell nav="labour" title={title} crumbs={[{ label: t("nav.labour"), href: "/labour/" }, { label: title }]} actionBar>
      <div className="page-head">
        <div className="heading"><h1>{title}</h1>{project && <p className="sub">{project.name} · {formatDateLong(date, lang)}</p>}</div>
        <div className="page-actions">
          <Link className="btn btn-secondary" href={`/labour/attendance/sheet/?site=${siteId ?? ""}&month=${date.slice(0, 7)}`}><Icon name="calendar" />{t("attendance.sheet")}</Link>
        </div>
      </div>
      <div className="att-controls">
        <label className="field"><span>{t("attendance.site")}</span>
          <select className="select" value={siteId ?? ""} onChange={(e) => setParam("site", e.target.value)} data-site>
            {(sites?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="field"><span id="att-date-label">{t("attendance.date")}</span>
          <div className="date-step" role="group" aria-labelledby="att-date-label">
            <Button size="sm" variant="secondary" aria-label={t("attendance.prevDay")} onClick={() => setParam("date", addDays(date, -1))}><Icon name="back" size={16} /></Button>
            <input className="input" type="date" value={date} max={today} aria-label={t("attendance.date")} onChange={(e) => e.target.value && setParam("date", e.target.value)} />
            <Button size="sm" variant="secondary" aria-label={t("attendance.nextDay")} disabled={date >= today} onClick={() => setParam("date", addDays(date, 1))}><Icon name="chevron-right" size={16} /></Button>
          </div>
        </div>
      </div>

      {locked && (
        <div className="banner warning section" role="status" data-locked>
          <Icon name="lock" />
          <span className="text"><b>{t("attendance.lockedTitle")}</b> {session?.role === "owner" ? t("attendance.lockedOwner", { n: lockDays }) : t("attendance.lockedBody", { n: lockDays })}</span>
          {session?.role === "owner" && <Button size="sm" onClick={() => setUnlockOpen(true)} data-unlock>{t("attendance.unlock")}</Button>}
        </div>
      )}
      {unlocked && <div className="banner info section" role="status"><Icon name="info" /><span className="text">{t("attendance.unlocked", { reason: unlock!.reason })}</span></div>}

      {(needSelfie || needGps) && !readOnly && (
        <section className="card section" aria-labelledby="checkin-title">
          <h2 className="card-title" id="checkin-title">{t("attendance.checkin")}</h2>
          <p className="hint"><Icon name="info" size={16} /><span>{t("attendance.checkinHint")}</span></p>
          <div className="checkin-row">
            {needSelfie && (
              <label className="btn btn-secondary">
                <Icon name="user-plus" />{selfie ? t("attendance.retake") : t("attendance.selfie")}
                <input className="sr-only" type="file" accept="image/*" capture="user" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setSelfie(await shrink(f)); }} />
              </label>
            )}
            {selfie && <img src={selfie} alt={t("attendance.selfieAlt")} className="selfie" />}
            {needGps && <Button variant="secondary" onClick={locate}><Icon name="pin" />{gps ? t("attendance.located", { m: gps.accuracyM }) : t("attendance.locate")}</Button>}
          </div>
          {gpsError && <p className="field-error" role="alert"><Icon name="alert" size={16} />{gpsError}</p>}
        </section>
      )}

      {roster === undefined || existing === undefined ? <Skeleton lines={8} /> : active.length === 0 ? <EmptyState icon="users" title={t("projects.noRoster")} body={t("attendance.noRosterBody")} /> : (
        <section className="card att-card section" aria-label={title}>
          <div className="att-head">
            <Button variant="secondary" onClick={allPresent} disabled={readOnly} data-all-present><Icon name="check" />{t("attendance.allPresent")}</Button>
            <span className="muted small">{t("attendance.tapHint")}</span>
          </div>
          <ul className="att-list">
            {active.map((r) => {
              const m = marks[r.id];
              return (
                <li key={r.id} className="att-row" data-worker={r.id} data-status={m?.status ?? ""}>
                  <div className="att-who"><b>{r.workerName}</b><span className="meta">{roleLabel(r.workerRole)}{r.thekedarName ? ` · ${r.thekedarName}` : ""}</span></div>
                  <div className="att-toggle" role="group" aria-label={`${r.workerName}: ${t("attendance.status")}`}>
                    {STATUS.map((s) => (
                      <button key={s} type="button" className={`att-btn att-${s}`} aria-pressed={m?.status === s} disabled={readOnly} onClick={() => set(r.id, s)} data-set={s}>
                        <span aria-hidden="true">{t(`attendance.short.${s}`)}</span><span className="sr-only">{t(`attendance.status_${s}`)}</span>
                      </button>
                    ))}
                  </div>
                  {m?.status === "overtime" && (
                    <div className="att-ot" role="group" aria-label={`${r.workerName}: ${t("attendance.otHours")}`}>
                      <Button size="sm" variant="secondary" aria-label={t("attendance.otLess")} disabled={readOnly || m.ot <= 1000} onClick={() => setMarks((x) => ({ ...x, [r.id]: { status: "overtime", ot: m.ot - 1000 } }))}>−</Button>
                      <span className="ot-val">{t("attendance.hours", { n: m.ot / 1000 })}</span>
                      <Button size="sm" variant="secondary" data-ot-more aria-label={t("attendance.otMore")} disabled={readOnly || m.ot >= 12000} onClick={() => setMarks((x) => ({ ...x, [r.id]: { status: "overtime", ot: m.ot + 1000 } }))}>+</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {active.length > 0 && (
        <div className="att-footer action-bar">
          <span className="att-counts" aria-live="polite">
            {counts.filter(([, n]) => n).map(([s, n]) => <span key={s}>{t(`attendance.status_${s}`)} {n}</span>)}
            {unmarked > 0 && <span className="muted">{t("attendance.unmarked", { n: unmarked })}</span>}
          </span>
          <Button variant="primary" onClick={() => void save()} disabled={readOnly || saving || !changed.length || checkinMissing} data-save>
            {saving ? t("common.saving") : online ? t("attendance.save", { n: changed.length }) : t("attendance.saveOffline", { n: changed.length })}
          </Button>
        </div>
      )}

      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent title={t("attendance.unlockTitle", { date: formatDateLong(date, lang) })} description={t("attendance.unlockBody")}>
          <TextField label={t("attendance.unlockReason")} value={reason} onChange={setReason} required />
          <DialogActions>
            <DialogClose asChild><Button variant="secondary">{t("common.cancel")}</Button></DialogClose>
            <Button variant="primary" disabled={reason.trim().length < 3} onClick={async () => {
              try { await run("unlockAttendanceDay", { projectId: siteId!, date, reason }); toast(t("attendance.unlockDone")); setUnlockOpen(false); setReason(""); }
              catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
            }}>{t("attendance.unlock")}</Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
