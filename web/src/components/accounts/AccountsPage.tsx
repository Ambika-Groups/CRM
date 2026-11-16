"use client";
import { accountFlow, balances, formatMonth, monthKeyOf, todayIST, type Account, type FinanceRollup, type PeriodLock } from "@ag/core";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useRead, useSmall } from "@/data/DataProvider";
import { money } from "@/lib/fmt";
import { accountLabel } from "./AccountPicker";
import { AccountsShell, balanceOf, useAccountsAccess, useLang } from "./shared";

/**
 * Accounts home (spec §11A.4, §11.1a balance cards): cash in hand, each bank and UPI account, the totals, this
 * month's money in and out, and the way into each cash book or bank book. The same balances the dashboard shows.
 */
export function AccountsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const { canWrite, canSee, session } = useAccountsAccess();
  const title = t("accounts.title");
  const accounts = useSmall<Account & { isDeleted?: boolean }>("accounts");
  const locks = useSmall<PeriodLock>("period_locks");
  const month = monthKeyOf(todayIST());
  const fin = useRead(`acc-month:${month}`, (s) => s.getMany<FinanceRollup>("finance_rollups", [`co_${month}`]));
  const list = (accounts ?? []).filter((a) => !a.isDeleted).sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || (a.type === "cash" ? -1 : b.type === "cash" ? 1 : a.name.localeCompare(b.name)));
  const b = balances(list);
  const book = (a: Account) => t(`accounts.book.${a.type}`);

  return (
    <AccountsShell title={title} actionBar={canWrite}>
      <div className="page-head">
        <div className="heading"><h1>{title}</h1><p className="sub">{t("accounts.sub")}</p></div>
        {canWrite && (
          <div className="page-actions">
            <Link className="btn btn-secondary" href="/accounts/edit/"><Icon name="plus" />{t("accounts.actions.add")}</Link>
            <Link className="btn btn-secondary" href="/accounts/entry/"><Icon name="rupee" />{t("accounts.actions.entry")}</Link>
            <span className="action-bar"><Link className="btn btn-primary" href="/accounts/transfer/" data-move-money><Icon name="switch" />{t("accounts.actions.transfer")}</Link></span>
          </div>
        )}
      </div>
      {session && canSee && !canWrite && <p className="banner info acc-note"><Icon name="info" /><span className="text">{t("accounts.readOnly")}</span></p>}

      {!accounts ? <Skeleton lines={4} /> : list.length === 0 ? (
        <EmptyState icon="calculator" title={t("accounts.list.empty")} body={t("accounts.list.emptyBody")}
          action={canWrite ? <Link className="btn btn-primary" href="/accounts/edit/"><Icon name="plus" />{t("accounts.actions.add")}</Link> : undefined} />
      ) : (
        <>
          <section className="acc-kpis" aria-label={t("accounts.totals.label")} data-account-totals>
            <div className="kpi" data-total="cash"><div className="label">{t("accounts.totals.cash")}</div><div className={`value${b.cashPaise < 0 ? " tone-bad" : ""}`}>{money(b.cashPaise)}</div></div>
            <div className="kpi" data-total="bank"><div className="label">{t("accounts.totals.bank")}</div><div className={`value${b.bankPaise < 0 ? " tone-bad" : ""}`}>{money(b.bankPaise)}</div></div>
            <div className="kpi" data-total="all"><div className="label">{t("accounts.totals.total")}</div><div className={`value${b.totalPaise < 0 ? " tone-bad" : ""}`}>{money(b.totalPaise)}</div></div>
          </section>

          <section className="section" aria-labelledby="acc-list-title">
            <h2 className="section-title" id="acc-list-title">{t("accounts.list.title")} <span className="muted small">{formatMonth(month, lang)}</span></h2>
            <div className="table-wrap">
              <table className="data" data-accounts>
                <caption className="sr-only">{t("accounts.list.title")}</caption>
                <thead><tr>
                  <th scope="col">{t("accounts.list.name")}</th><th scope="col">{t("accounts.list.type")}</th>
                  <th scope="col" className="num">{t("accounts.list.monthIn")}</th><th scope="col" className="num">{t("accounts.list.monthOut")}</th>
                  <th scope="col" className="num">{t("accounts.list.balance")}</th><th scope="col"><span className="sr-only">{t("table.actions")}</span></th>
                </tr></thead>
                <tbody>{list.map((a) => {
                  const flow = accountFlow(a.id, fin ?? []);
                  const bal = balanceOf(a);
                  return (
                    <tr key={a.id} data-account={a.id}>
                      <td className="card-head" data-label={t("accounts.list.name")}>
                        <Link className="row-link" href={`/accounts/book/?id=${a.id}`}>{accountLabel(a)}</Link>
                        {a.active === false && <> <span className="badge neutral"><Icon name="lock" size={14} />{t("accounts.list.closed")}</span></>}
                        {a.bankName ? <div className="muted small">{a.bankName}</div> : null}
                      </td>
                      <td data-label={t("accounts.list.type")}>{t(`accounts.types.${a.type}`)}</td>
                      <td className="num" data-label={t("accounts.list.monthIn")}>{fin ? money(flow.inPaise) : "…"}</td>
                      <td className="num" data-label={t("accounts.list.monthOut")}>{fin ? money(flow.outPaise) : "…"}</td>
                      <td className="num" data-label={t("accounts.list.balance")} data-balance>
                        <b className={bal < 0 ? "tone-bad" : undefined}>{money(bal)}</b>
                        {bal < 0 && a.type === "cash" ? <div className="small tone-bad">{t("accounts.list.belowZero")}</div> : null}
                      </td>
                      <td className="acc-row-actions" data-label={t("accounts.list.more")}>
                        <Link className="btn btn-secondary btn-sm" href={`/accounts/book/?id=${a.id}`}><Icon name="file-text" size={16} />{book(a)}</Link>
                        {canWrite && <Link className="btn btn-text btn-sm" href={`/accounts/edit/?id=${a.id}`}><Icon name="edit" size={16} />{t("common.edit")}</Link>}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="section acc-links" aria-label={t("accounts.list.more")}>
        <Link className="card acc-link" href="/accounts/entries/"><Icon name="switch" /><span><b>{t("accounts.actions.entries")}</b><span className="muted small">{t("accounts.actions.entriesHint")}</span></span></Link>
        <Link className="card acc-link" href="/accounts/lock/" data-lock-link><Icon name="lock" /><span><b>{t("accounts.actions.lock")}{locks?.length ? ` (${locks.length})` : ""}</b><span className="muted small">{t("accounts.actions.lockHint")}</span></span></Link>
        <Link className="card acc-link" href="/accounts/export/"><Icon name="download" /><span><b>{t("accounts.actions.export")}</b><span className="muted small">{t("accounts.actions.exportHint")}</span></span></Link>
      </section>
    </AccountsShell>
  );
}
