"use client";
import {
  formatDateLong, isFinanceRole, payoutSheet, payoutWeek, todayIST, type Account, type Attendance, type PaymentMode, type Project, type RosterEntry, type WorkerBalance,
} from "@ag/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, EmptyState, MiniWrap, Skeleton, useToast } from "@/components/ui/feedback";
import { fromPaise, toPaise } from "@/components/ui/form";
import { useRead, useRun, useSession, useSmall } from "@/data/DataProvider";
import { useRoleLabel } from "@/lib/roles";
import { fetchAll } from "@/lib/fetchAll";
import { money } from "@/lib/fmt";
import { setParam, useParam } from "@/lib/params";

/**
 * The weekly or monthly payout sheet for a site (spec §6.4): what each direct worker is due, the advance to
 * recover and the net cash, with "Mark paid" and a printable page. Thekedar crews are paid through the
 * thekedar's bill. Finance only (D-45).
 */
export function PayoutPage() {
  const { t, i18n } = useTranslation();
  const roleLabel = useRoleLabel();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const today = todayIST();
  const week = payoutWeek(today);
  const from = useParam("from") ?? week.from;
  const to = useParam("to") ?? (week.to > today ? today : week.to);
  const sites = useRead("payout-sites", (s) => s.query<Project>("projects", { where: [{ field: "isArchived", op: "==", value: false }], orderBy: [{ field: "name" }], limit: 50 }));
  const siteId = useParam("site") || sites?.items[0]?.id || null;
  const project = sites?.items.find((p) => p.id === siteId);
  const roster = useSmall<RosterEntry>(siteId ? `projects/${siteId}/roster` : null);
  const accounts = (useSmall<Account>("accounts") ?? []).filter((a) => a.active !== false);
  const data = useRead(`payout:${siteId}:${from}:${to}:${roster?.length}`, async (s) => {
    if (!siteId || !roster) return undefined;
    const [att, bals] = await Promise.all([
      fetchAll<Attendance>(s, "attendance", { where: [{ field: "projectId", op: "==", value: siteId }, { field: "date", op: ">=", value: from }, { field: "date", op: "<=", value: to }] }),
      s.getMany<Partial<WorkerBalance>>("worker_balances", roster.map((r) => `${r.id}_${siteId}`)),
    ]);
    const balances = Object.fromEntries(roster.map((r, i) => [r.id, bals[i] ?? {}]));
    return payoutSheet(roster, att, balances, from, to);
  });
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [recover, setRecover] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [accountId, setAccountId] = useState("accCash");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!data) return;
    setInclude(Object.fromEntries(data.map((r) => [r.workerId, r.grossPaise > 0])));
    setRecover(Object.fromEntries(data.map((r) => [r.workerId, fromPaise(r.recoverPaise)])));
  }, [data]);

  const rows = useMemo(() => (data ?? []).map((r) => {
    const rec = Math.min(Math.max(0, toPaise(recover[r.workerId] ?? "") || 0), Math.max(0, r.advanceOutstandingPaise), r.grossPaise);
    return { ...r, recoverPaise: rec, netPaise: r.grossPaise - rec, on: !!include[r.workerId] && r.grossPaise > 0 };
  }), [data, include, recover]);
  const chosen = rows.filter((r) => r.on);
  const total = { gross: chosen.reduce((s, r) => s + r.grossPaise, 0), recover: chosen.reduce((s, r) => s + r.recoverPaise, 0), net: chosen.reduce((s, r) => s + r.netPaise, 0) };
  const title = t("payout.title");
  if (session && !isFinanceRole(session.role)) return <AppShell nav="labour" title={title} crumbs={[{ label: title }]}><NoAccess name={title} /></AppShell>;
  const account = accounts.find((a) => a.id === accountId);

  return (
    <AppShell nav="labour" title={title} crumbs={[{ label: t("nav.labour"), href: "/labour/" }, { label: t("payments.title"), href: "/labour/payments/" }, { label: title }]} actionBar>
      <div className="page-head">
        <div className="heading"><h1>{title}</h1>{project && <p className="sub">{project.name} · {formatDateLong(from, lang)} – {formatDateLong(to, lang)}</p>}</div>
        <div className="page-actions no-print"><Button variant="secondary" onClick={() => window.print()} data-print><Icon name="file-text" />{t("common.print")}</Button></div>
      </div>
      <div className="att-controls no-print">
        <label className="field"><span>{t("attendance.site")}</span>
          <select className="select" value={siteId ?? ""} onChange={(e) => setParam("site", e.target.value)}>{(sites?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <label className="field"><span>{t("payout.from")}</span><input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setParam("from", e.target.value)} /></label>
        <label className="field"><span>{t("payout.to")}</span><input className="input" type="date" value={to} max={today} onChange={(e) => e.target.value && setParam("to", e.target.value)} /></label>
      </div>
      <p className="hint no-print"><Icon name="info" size={16} /><span>{t("payout.hint")}</span></p>
      {!data ? <Skeleton lines={8} /> : rows.length === 0 ? <EmptyState icon="users" title={t("payout.none")} /> : (
        <MiniWrap label={title}>
          <table className="mini-table payout-table" data-payout>
            <caption className="sr-only">{title}</caption>
            <thead><tr>
              <th className="no-print"><span className="sr-only">{t("payout.include")}</span></th>
              <th>{t("workers.name")}</th><th className="num">{t("payout.days")}</th><th className="num">{t("payout.half")}</th><th className="num">{t("attendance.otH")}</th>
              <th className="num">{t("payout.earned")}</th><th className="num">{t("payout.due")}</th><th className="num">{t("payout.advance")}</th>
              <th className="num">{t("payout.recover")}</th><th className="num">{t("payout.net")}</th><th className="print-only">{t("payout.sign")}</th>
            </tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.workerId} className={r.on ? "" : "row-off"} data-row={r.workerId}>
                <td className="no-print"><input type="checkbox" checked={r.on} disabled={r.grossPaise <= 0} aria-label={`${t("payout.include")}: ${r.workerName}`}
                  onChange={(e) => setInclude((x) => ({ ...x, [r.workerId]: e.target.checked }))} /></td>
                <td>{r.workerName}<span className="meta">{roleLabel(r.role)}</span></td>
                <td className="num">{r.days}</td><td className="num">{r.halfDays}</td><td className="num">{r.otHoursMilli / 1000}</td>
                <td className="num">{money(r.earnedInPeriodPaise)}</td><td className="num">{money(r.grossPaise)}</td><td className="num">{money(Math.max(0, r.advanceOutstandingPaise))}</td>
                <td className="num">{r.advanceOutstandingPaise > 0 && r.on
                  ? <input className="input input-sm no-print" inputMode="decimal" value={recover[r.workerId] ?? ""} aria-label={`${t("payout.recover")}: ${r.workerName}`}
                      onChange={(e) => setRecover((x) => ({ ...x, [r.workerId]: e.target.value }))} />
                  : null}<span className={r.advanceOutstandingPaise > 0 && r.on ? "print-only" : ""}>{money(r.recoverPaise)}</span></td>
                <td className="num"><b>{money(r.on ? r.netPaise : 0)}</b></td><td className="print-only sign-cell" />
              </tr>
            ))}</tbody>
            <tfoot><tr>
              <td className="no-print" /><th scope="row">{t("payout.total", { n: chosen.length })}</th><td /><td /><td /><td />
              <td className="num">{money(total.gross)}</td><td /><td className="num">{money(total.recover)}</td><td className="num"><b>{money(total.net)}</b></td><td className="print-only" />
            </tr></tfoot>
          </table>
        </MiniWrap>
      )}
      {chosen.length > 0 && (
        <div className="att-footer action-bar no-print">
          <label className="field inline"><span>{t("payments.mode")}</span>
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>{(["cash", "upi", "bank", "cheque"] as const).map((m) => <option key={m} value={m}>{t(`payments.modes.${m}`)}</option>)}</select>
          </label>
          <label className="field inline"><span>{t("payments.account")}</span>
            <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </label>
          <Button variant="primary" onClick={() => setConfirm(true)} data-mark-paid>{t("payout.markPaid", { n: chosen.length })}</Button>
        </div>
      )}
      <p className="hint no-print" style={{ marginTop: "var(--space-4)" }}><Icon name="info" size={16} /><span>{t("payout.pdfLater")}</span></p>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} destructive={false}
        title={t("payout.confirmTitle", { n: chosen.length })} body={t("payout.confirmBody", { net: money(total.net), account: account?.name ?? "", date: formatDateLong(to, lang) })}
        confirmLabel={t("payout.markPaid", { n: chosen.length })}
        onConfirm={async () => {
          try {
            const r = await run("payPayout", { projectId: siteId!, to, date: to, mode, accountId, rows: chosen.map((x) => ({ workerId: x.workerId, grossPaise: x.grossPaise, recoverPaise: x.recoverPaise })) });
            const waiting = r.payments.filter((p) => !p.approved).length;
            toast(waiting ? t("payout.paidSomeWaiting", { n: r.payments.length, w: waiting }) : t("payout.paid", { n: r.payments.length }));
          } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
        }} />
    </AppShell>
  );
}
