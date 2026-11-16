"use client";
import {
  accountBook, addDays, balanceBefore, bookMonths, csvAmount, exportPresets, fyOf, isDateStr, runningLines, toCsv, todayIST,
  type Account, type AccountTxn, type BookLine, type FinanceRollup,
} from "@ag/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NotFoundRecord } from "@/components/ModulePage";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton, useToast } from "@/components/ui/feedback";
import { DateField, fromDate, toDate } from "@/components/ui/form";
import { useData, useRead, useSmall } from "@/data/DataProvider";
import type { DataSource } from "@/data/types";
import { date, money } from "@/lib/fmt";
import { useParam } from "@/lib/params";
import { accountLabel } from "./AccountPicker";
import { AccountsShell, balanceOf, downloadText, fetchRange, sourceHref, useAccountsAccess, useLang } from "./shared";

const PAGE = 50;

/** The balance of an account at the start of a day, from its stored balance and the monthly totals (never the whole history). */
async function openingOn(s: DataSource, account: Account, day: string, today: string): Promise<number> {
  const months = bookMonths(day, today);
  const fin = await s.getMany<FinanceRollup>("finance_rollups", months.map((m) => `co_${m}`));
  const monthStart = `${day.slice(0, 7)}-01`;
  const head = day === monthStart ? [] : (await fetchRange<AccountTxn>(s, "account_transactions", {
    where: [{ field: "accountId", op: "==", value: account.id }, { field: "date", op: ">=", value: monthStart }, { field: "date", op: "<", value: day }],
    orderBy: [{ field: "date" }],
  })).items;
  return balanceBefore(account, day, fin, head);
}

const rowsQuery = (accountId: string, from: string, to: string) => ({
  where: [{ field: "accountId", op: "==" as const, value: accountId }, { field: "date", op: ">=" as const, value: from }, { field: "date", op: "<=" as const, value: to }],
  orderBy: [{ field: "date" }],
});

/**
 * The cash book or bank book of one account (spec §11A.3 item 4, §11A.4): the opening balance of the dates shown, every
 * entry with the balance after it, 50 to a page, and the closing balance. Each line opens the record behind it.
 */
export function AccountBook() {
  const { t } = useTranslation();
  const lang = useLang();
  const { canWrite } = useAccountsAccess();
  const { source, version } = useData();
  const toast = useToast();
  const id = useParam("id");
  const accounts = useSmall<Account>("accounts");
  const account = id ? accounts?.find((a) => a.id === id) ?? null : null;
  const today = todayIST();
  const presets = exportPresets(today, fyOf(today));
  const [range, setRange] = useState({ from: presets.month.from, to: today });
  const [typed, setTyped] = useState({ from: fromDate(presets.month.from), to: fromDate(today) });
  const [rangeError, setRangeError] = useState("");
  // Pages already walked: the cursor each starts after, and the balance it starts from.
  const [stack, setStack] = useState<{ after: string | null; start: number | null }[]>([{ after: null, start: null }]);
  useEffect(() => setStack([{ after: null, start: null }]), [id, range.from, range.to, version]);
  const [downloading, setDownloading] = useState(false);
  // Opened without an account (an address typed by hand): go to the accounts list instead of "not found".
  useEffect(() => { if (id !== undefined && !id) window.location.replace("/accounts/"); }, [id]);

  const balanceNow = account ? balanceOf(account) : 0;
  const edges = useRead(`book-edges:${id}:${range.from}:${range.to}:${balanceNow}`, async (s) => {
    if (!account) return undefined;
    const [opening, closing] = await Promise.all([openingOn(s, account, range.from, today), openingOn(s, account, addDays(range.to, 1), today)]);
    return { opening, closing };
  });
  const cur = stack[stack.length - 1]!;
  const page = useRead(`book-page:${id}:${range.from}:${range.to}:${cur.after}`, (s) => (account
    ? s.query<AccountTxn>("account_transactions", { ...rowsQuery(account.id, range.from, range.to), limit: 50, after: cur.after })
    : Promise.resolve(undefined)));

  const title = account ? t(`accounts.book.${account.type}`) : t("accounts.book.bank");
  if (id === undefined || accounts === undefined) return <AccountsShell title={title}><Skeleton lines={6} /></AccountsShell>;
  if (!account) return <AccountsShell title={title}><NotFoundRecord name={t("accounts.book.notFound")} back="/accounts/" backLabel={t("accounts.back")} /></AccountsShell>;

  const start = cur.start ?? edges?.opening;
  const lines: BookLine[] | undefined = page && start !== undefined ? runningLines(start, page.items) : undefined;
  const firstPage = stack.length === 1;
  const lastPage = !!page && !page.next;
  const first = (stack.length - 1) * PAGE + 1;

  const apply = (from: string, to: string) => {
    if (!isDateStr(from) || !isDateStr(to) || from > to) { setRangeError(t("accounts.book.rangeError")); return; }
    setRangeError("");
    setRange({ from, to });
    setTyped({ from: fromDate(from), to: fromDate(to) });
  };
  const next = () => { if (page?.next && lines) setStack((s) => [...s, { after: page.next, start: lines[lines.length - 1]?.balancePaise ?? start ?? 0 }]); };
  const prev = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  const download = async () => {
    setDownloading(true);
    try {
      const opening = await openingOn(source, account, range.from, today);
      const { items } = await fetchRange<AccountTxn>(source, "account_transactions", rowsQuery(account.id, range.from, range.to));
      const book = accountBook(opening, items, range.from, range.to);
      type Row = { date: string; details: string; kind: string; inPaise: number | null; outPaise: number | null; balancePaise: number };
      const rows: Row[] = [
        { date: range.from, details: t("accounts.book.csvOpening"), kind: "", inPaise: null, outPaise: null, balancePaise: book.openingPaise },
        ...book.lines.map((l) => ({ date: l.txn.date, details: [l.txn.partyName, l.txn.narration].filter(Boolean).join(": "), kind: t(`accounts.book.rowTypes.${l.txn.type}`), inPaise: l.inPaise || null, outPaise: l.outPaise || null, balancePaise: l.balancePaise })),
        { date: range.to, details: t("accounts.book.csvClosing"), kind: "", inPaise: null, outPaise: null, balancePaise: book.closingPaise },
      ];
      const amount = (p: number | null) => (p == null ? "" : csvAmount(p));
      const csv = toCsv<Row>([
        { header: t("accounts.book.date"), value: (r) => r.date }, { header: t("accounts.book.details"), value: (r) => r.details },
        { header: t("accounts.entries.kind"), value: (r) => r.kind }, { header: t("accounts.book.moneyIn"), value: (r) => amount(r.inPaise) },
        { header: t("accounts.book.moneyOut"), value: (r) => amount(r.outPaise) }, { header: t("accounts.book.balance"), value: (r) => amount(r.balancePaise) },
      ], rows);
      downloadText(`${account.type === "cash" ? "cash" : "bank"}-book-${account.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${range.from}-to-${range.to}.csv`, csv);
      toast(t("accounts.book.downloaded", { n: book.lines.length }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setDownloading(false);
    }
  };

  const edgeRow = (label: string, amount: number | undefined, key: string) => (
    <tr className="book-edge" data-edge={key}>
      <td className="card-head" data-label={t("accounts.book.details")} colSpan={4}>{label}</td>
      <td className="num" data-label={t("accounts.book.balance")}>{amount === undefined ? "…" : <span className={amount < 0 ? "tone-bad" : undefined}>{money(amount)}</span>}</td>
      <td />
    </tr>
  );

  return (
    <AccountsShell title={title} parent={[{ label: account.name, href: `/accounts/book/?id=${account.id}` }]}>
      <div className="page-head">
        <div className="heading"><h1>{title}: {accountLabel(account)}</h1><p className="sub">{t(`accounts.types.${account.type}`)}{account.bankName ? ` · ${account.bankName}` : ""}</p></div>
        <div className="page-actions">
          {canWrite && <Link className="btn btn-secondary" href={`/accounts/transfer/?from=${account.id}`}><Icon name="switch" />{t("accounts.actions.transfer")}</Link>}
          <Button variant="secondary" onClick={() => void download()} disabled={downloading} data-download-book><Icon name="download" />{downloading ? t("accounts.book.downloading") : t("accounts.book.download")}</Button>
        </div>
      </div>

      <div className="book-head" data-book-head>
        <div><div className="muted small">{t("accounts.book.balanceNow")}</div><div className={`big${balanceNow < 0 ? " tone-bad" : ""}`} data-balance-now>{money(balanceNow)}</div></div>
        <div><div className="muted small">{t("accounts.book.opening", { date: date(range.from, lang) })}</div><div className="big" data-opening>{edges ? money(edges.opening) : "…"}</div></div>
        <div><div className="muted small">{t("accounts.book.closing", { date: date(range.to, lang) })}</div><div className="big" data-closing>{edges ? money(edges.closing) : "…"}</div></div>
      </div>

      <section className="card" aria-label={t("accounts.book.range")}>
        <div className="acc-presets">
          <Button size="sm" onClick={() => apply(presets.month.from, today)}>{t("accounts.book.thisMonth")}</Button>
          <Button size="sm" onClick={() => apply(presets.lastMonth.from, presets.lastMonth.to)}>{t("accounts.book.lastMonth")}</Button>
          <Button size="sm" onClick={() => apply(presets.fy.from, presets.fy.to > today ? today : presets.fy.to)}>{t("accounts.book.thisFy")}</Button>
        </div>
        <form className="acc-range" noValidate onSubmit={(e) => { e.preventDefault(); apply(toDate(typed.from), toDate(typed.to)); }}>
          <DateField label={t("accounts.book.from")} value={typed.from} onChange={(x) => setTyped((v) => ({ ...v, from: x }))} error={rangeError || undefined} />
          <DateField label={t("accounts.book.to")} value={typed.to} onChange={(x) => setTyped((v) => ({ ...v, to: x }))} />
          <Button variant="secondary" type="submit">{t("accounts.book.show")}</Button>
        </form>

        {!page || !lines ? <Skeleton lines={6} /> : (
          <>
            <div className="table-wrap">
              <table className="data" data-book>
                <caption className="sr-only">{title}: {account.name}, {date(range.from, lang)} – {date(range.to, lang)}</caption>
                <thead><tr>
                  <th scope="col">{t("accounts.book.date")}</th><th scope="col">{t("accounts.book.details")}</th>
                  <th scope="col" className="num">{t("accounts.book.moneyIn")}</th><th scope="col" className="num">{t("accounts.book.moneyOut")}</th>
                  <th scope="col" className="num">{t("accounts.book.balance")}</th><th scope="col">{t("accounts.book.source")}</th>
                </tr></thead>
                <tbody>
                  {edgeRow(firstPage ? t("accounts.book.opening", { date: date(range.from, lang) }) : t("accounts.book.broughtForward"), start, firstPage ? "opening" : "brought")}
                  {lines.map((l) => {
                    const href = sourceHref(l.txn);
                    return (
                      <tr key={l.txn.id} data-row={l.txn.id}>
                        <td data-label={t("accounts.book.date")}>{date(l.txn.date, lang)}</td>
                        <td className="card-head book-details" data-label={t("accounts.book.details")}>
                          {l.txn.partyName || l.txn.narration || t(`accounts.book.rowTypes.${l.txn.type}`)}
                          <div className="muted small">{[t(`accounts.book.rowTypes.${l.txn.type}`), l.txn.partyName ? l.txn.narration : ""].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="num" data-label={t("accounts.book.moneyIn")}>{l.inPaise ? <span className="tone-in">{money(l.inPaise)}</span> : "—"}</td>
                        <td className="num" data-label={t("accounts.book.moneyOut")}>{l.outPaise ? money(l.outPaise) : "—"}</td>
                        <td className="num" data-label={t("accounts.book.balance")}><span className={l.balancePaise < 0 ? "tone-bad" : undefined}>{money(l.balancePaise)}</span></td>
                        <td data-label={t("accounts.book.source")}>{href ? <Link href={href}>{t("accounts.book.open")}</Link> : "—"}</td>
                      </tr>
                    );
                  })}
                  {lastPage
                    ? edgeRow(t("accounts.book.closing", { date: date(range.to, lang) }), lines.length ? lines[lines.length - 1]!.balancePaise : start, "closing")
                    : edgeRow(t("accounts.book.carried"), lines[lines.length - 1]?.balancePaise, "carried")}
                </tbody>
              </table>
            </div>
            {page.total === 0 && <EmptyState icon="info" title={t("accounts.book.empty")} body={t("accounts.book.emptyBody", { amount: start === undefined ? "" : money(start) })} />}
            <nav className="book-foot" aria-label={t("table.pages")}>
              <span className="muted small">{page.total ? `${t("table.showing", { first, last: first + lines.length - 1, total: page.total })} · ` : ""}{t("accounts.book.page", { n: stack.length })}</span>
              <Button size="sm" onClick={prev} disabled={firstPage}>{t("table.previous")}</Button>
              <Button size="sm" onClick={next} disabled={lastPage} data-next-page>{t("table.next")}</Button>
            </nav>
          </>
        )}
      </section>
    </AccountsShell>
  );
}
