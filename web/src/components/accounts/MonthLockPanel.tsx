"use client";
import { formatMonth, isDateStr, monthKeyOf, monthsBetween, todayIST, type PeriodLock } from "@ag/core";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog, EmptyState, Skeleton, useToast } from "@/components/ui/feedback";
import { SelectField, TextField } from "@/components/ui/form";
import { useRead, useRun, useSmall } from "@/data/DataProvider";
import { date } from "@/lib/fmt";
import { AccountsShell, useAccountsAccess, useLang } from "./shared";

/** The last 24 months, newest first, for the month chooser. */
function recentMonths(today: string): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 24, 1)).toISOString().slice(0, 10);
  return monthsBetween(start, today).reverse();
}

/**
 * Month lock (spec §11A.4, §3.1 rule 13): the owner locks a month after the CA confirms it; nothing dated in it can
 * then be added, changed or cancelled. Unlocking needs a reason, which is kept in the record of changes. Everyone who
 * can open Accounts sees which months are locked.
 */
export function MonthLockPanel() {
  const { t } = useTranslation();
  const lang = useLang();
  const { isOwner } = useAccountsAccess();
  const run = useRun();
  const toast = useToast();
  const locks = useSmall<PeriodLock>("period_locks");
  const today = todayIST();
  const lockedKeys = useMemo(() => new Set((locks ?? []).map((l) => l.id)), [locks]);
  const open = useMemo(() => recentMonths(today).filter((m) => !lockedKeys.has(m)), [today, lockedKeys]);
  const [month, setMonth] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [ask, setAsk] = useState(false);
  const [unlock, setUnlock] = useState<PeriodLock | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // Entries of the chosen month still waiting for approval: they would be shut out of the books by the lock.
  const pending = useRead(`lock-pending:${month}`, async (s) => {
    if (!month) return 0;
    const where = [{ field: "monthKey", op: "==" as const, value: month }, { field: "approvalStatus", op: "==" as const, value: "pending" }];
    const [a, b] = await Promise.all([s.count("expenses", where), s.count("worker_payments", where)]);
    return a + b;
  });
  const name = (m: string) => formatMonth(m, lang);

  const doLock = async () => {
    try {
      await run("lockMonth", { monthKey: month, note });
      toast(t("accounts.lock.locked", { month: name(month) }));
      setMonth(""); setNote("");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const doUnlock = async () => {
    if (!unlock) return;
    setBusy(true);
    try {
      await run("unlockMonth", { monthKey: unlock.id, reason });
      toast(t("accounts.lock.unlocked", { month: name(unlock.id) }));
      setUnlock(null); setReason("");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const sorted = [...(locks ?? [])].sort((a, b) => b.id.localeCompare(a.id));

  return (
    <div data-month-lock>
      {isOwner ? (
        <section className="card acc-form" aria-labelledby="lock-new-title">
          <h2 className="card-title" id="lock-new-title">{t("accounts.lock.lockTitle")}</h2>
          <form className="form-grid two" noValidate onSubmit={(e) => { e.preventDefault(); if (!month) { setError(t("accounts.lock.chooseMonth")); return; } setError(""); setAsk(true); }}>
            <SelectField label={t("accounts.lock.month")} value={month} onChange={(x) => { setMonth(x); setError(""); }} error={error || undefined} placeholder={t("accounts.lock.chooseMonth")}
              options={open.map((m) => ({ value: m, label: name(m) }))} required />
            <TextField label={t("accounts.lock.note")} hint={t("accounts.lock.noteHint")} value={note} onChange={setNote} />
            {month && pending ? <p className="banner warning span-2"><Icon name="alert" /><span className="text">{t("accounts.lock.pending", { n: pending, month: name(month) })}</span></p> : null}
            <div className="form-actions span-2"><Button variant="primary" type="submit" data-lock><Icon name="lock" />{t("accounts.lock.lock")}</Button></div>
          </form>
        </section>
      ) : (
        <p className="banner info"><Icon name="info" /><span className="text">{t("accounts.lock.ownerOnly")}</span></p>
      )}

      <section className="card acc-subcard" aria-labelledby="lock-list-title">
        <h2 className="card-title" id="lock-list-title">{t("accounts.lock.list")}</h2>
        {!locks ? <Skeleton /> : sorted.length === 0 ? <EmptyState icon="check-circle" title={t("accounts.lock.none")} /> : (
          <ul className="acc-locks" data-locked-months>
            {sorted.map((l) => (
              <li key={l.id} data-locked={l.id}>
                <span>
                  <b>{name(l.id)} <span className="badge neutral"><Icon name="lock" size={14} />{t("accounts.lock.isLocked")}</span></b>
                  <span className="muted small">{t("accounts.lock.lockedBy", { name: l.lockedByName || "—", date: date(l.lockedAt ? todayIST(new Date(l.lockedAt)) : null, lang) })}{l.note ? ` · ${l.note}` : ""}</span>
                </span>
                {isOwner && <Button size="sm" variant="secondary" onClick={() => setUnlock(l)} data-unlock>{t("accounts.lock.unlock")}</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog open={ask} onOpenChange={setAsk} title={t("accounts.lock.confirmTitle", { month: month ? name(month) : "" })}
        body={month ? `${t("accounts.lock.confirmBody", { month: name(month) })}${pending ? ` ${t("accounts.lock.pending", { n: pending, month: name(month) })}` : ""}` : ""}
        confirmLabel={t("accounts.lock.confirm")} onConfirm={doLock} destructive={false} />
      <Dialog open={!!unlock} onOpenChange={(o) => { if (!o) { setUnlock(null); setReason(""); } }}>
        <DialogContent title={t("accounts.lock.unlockTitle", { month: unlock ? name(unlock.id) : "" })} description={unlock ? t("accounts.lock.unlockBody", { month: name(unlock.id) }) : ""}>
          <TextField label={t("accounts.lock.reason")} hint={t("accounts.lock.reasonHint")} value={reason} onChange={setReason} required />
          <DialogActions>
            <DialogClose asChild><Button variant="secondary">{t("common.goBack")}</Button></DialogClose>
            <Button variant="primary" disabled={busy || reason.trim().length < 3} onClick={() => void doUnlock()} data-unlock-confirm>{busy ? t("common.working") : t("accounts.lock.unlockConfirm")}</Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The Month lock page under Accounts. */
export function MonthLockPage() {
  const { t } = useTranslation();
  const title = t("accounts.lock.title");
  return (
    <AccountsShell title={title}>
      <div className="page-head"><div className="heading"><h1>{title}</h1><p className="sub">{t("accounts.lock.sub")}</p></div></div>
      <MonthLockPanel />
    </AccountsShell>
  );
}

/** Whether a date falls in a locked month (for other screens that want to warn before a save). */
export function useLockedMonth(dateStr: string | null | undefined): boolean {
  const locks = useSmall<PeriodLock>("period_locks");
  if (!dateStr || !isDateStr(dateStr)) return false;
  return (locks ?? []).some((l) => l.id === monthKeyOf(dateStr));
}
