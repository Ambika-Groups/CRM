"use client";
import {
  buildMasterRows, checkMasterTotals, exportPresets, formatMonth, fyOf, isDateStr, masterCsv, masterTotals, todayIST, wholeMonths, VOUCHER_TYPES,
  type Account, type Category, type CheckLine, type Client, type CostRollup, type Expense, type FinanceRollup, type Invoice, type MasterCheck, type MasterRow,
  type MoneyEntry, type PaymentReceived, type Project, type VendorPaymentLike, type WorkerPayment,
} from "@ag/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, EmptyState, MiniWrap, useToast } from "@/components/ui/feedback";
import { DateField, SelectField, fromDate, toDate } from "@/components/ui/form";
import { useData, useRead, useSmall } from "@/data/DataProvider";
import type { DataSource } from "@/data/types";
import { date, money } from "@/lib/fmt";
import { AccountsShell, downloadText, fetchRange, useLang } from "./shared";

type Preset = "month" | "lastMonth" | "fy" | "custom";
interface Result { from: string; to: string; months: string[]; projectId: string; fileRows: MasterRow[]; check: MasterCheck; cut: boolean }

/** Read everything the master CSV needs for whole months, 50 records at a time, and check it against the rollups. */
async function prepare(s: DataSource, from: string, to: string, projectId: string, accounts: Account[]): Promise<Result> {
  const wm = wholeMonths(from, to);
  const byDate = { where: [{ field: "date", op: ">=" as const, value: wm.from }, { field: "date", op: "<=" as const, value: wm.to }], orderBy: [{ field: "date" }] };
  const quiet = async <T extends { id: string }>(collection: string) => { try { return await fetchRange<T>(s, collection, byDate); } catch { return { items: [] as T[], cut: false }; } };
  const [exp, pay, inv, rec, ent, ven] = await Promise.all([
    fetchRange<Expense>(s, "expenses", byDate), fetchRange<WorkerPayment>(s, "worker_payments", byDate), fetchRange<Invoice>(s, "invoices", byDate),
    fetchRange<PaymentReceived>(s, "payments_received", byDate), fetchRange<MoneyEntry>(s, "account_transfers", byDate),
    quiet<VendorPaymentLike>("vendor_payments"), // another module's records: absent until it is switched on
  ]);
  // Credit purchases bought before the period but paid inside it: their payment belongs in this file.
  let paidLater: Expense[] = [];
  try {
    paidLater = (await fetchRange<Expense>(s, "expenses", { where: [{ field: "paidDate", op: ">=", value: wm.from }, { field: "paidDate", op: "<=", value: wm.to }], orderBy: [{ field: "paidDate" }] })).items;
  } catch { /* no such entries, or the list is not available: the check below would show any gap */ }
  const seen = new Set(exp.items.map((x) => x.id));
  const expenses = [...exp.items, ...paidLater.filter((x) => !seen.has(x.id))];
  // Receipts name the bill they pay, which may be dated before the period.
  const have = new Set(inv.items.map((x) => x.id));
  const olderIds = [...new Set(rec.items.map((r) => r.invoiceId).filter((x): x is string => !!x && !have.has(x)))];
  const older = olderIds.length ? (await s.getMany<Invoice>("invoices", olderIds)).filter((x): x is Invoice => !!x) : [];
  const [categories, users, projects, clients] = await Promise.all([
    s.listSmall<Category>("expense_categories"), s.listSmall<{ id: string; name: string }>("users"),
    fetchRange<Project>(s, "projects", { orderBy: [{ field: "code" }] }, 20).then((r) => r.items),
    fetchRange<Client>(s, "clients", { orderBy: [{ field: "name" }] }, 40).then((r) => r.items).catch(() => [] as Client[]), // the CA can't read clients; names are on the records
  ]);
  const rows = buildMasterRows({
    from: wm.from, to: wm.to, projectId: projectId || null, expenses, workerPayments: pay.items, invoices: [...inv.items, ...older],
    receipts: rec.items, transfers: ent.items, vendorPayments: ven.items, accounts, categories, projects, clients, users,
  });
  const ids = wm.months.map((m) => (projectId ? `p_${projectId}_${m}` : `co_${m}`));
  const [cost, fin] = await Promise.all([s.getMany<CostRollup>("rollups", ids), s.getMany<FinanceRollup>("finance_rollups", ids)]);
  return {
    from, to, months: wm.months, projectId, fileRows: rows.filter((r) => r.date >= from && r.date <= to),
    check: checkMasterTotals(rows, cost, fin, { accounts: !projectId }), cut: [exp, pay, inv, rec, ent, ven].some((x) => x.cut),
  };
}

/**
 * The master CSV for the CA (spec §11A.1, §11A.2): choose the period, a project if wanted, and the date style; the
 * screen reads the records, shows what is in the file, proves the file's totals equal the dashboard's (§11A.7), and
 * downloads it. Header row only, two decimals, and a byte-order mark so Hindi names open correctly in Excel.
 */
export function ExportCsvPanel() {
  const { t } = useTranslation();
  const lang = useLang();
  const { source } = useData();
  const toast = useToast();
  const today = todayIST();
  const presets = exportPresets(today, fyOf(today));
  const accounts = useSmall<Account>("accounts");
  const projects = useRead("export-projects", (s) => fetchRange<Project>(s, "projects", { orderBy: [{ field: "code" }] }, 20).then((r) => r.items));
  const [preset, setPreset] = useState<Preset>("month");
  const [typed, setTyped] = useState({ from: fromDate(presets.month.from), to: fromDate(presets.month.to) });
  const [projectId, setProjectId] = useState("");
  const [dateFormat, setDateFormat] = useState<"iso" | "dmy">("iso");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [askAnyway, setAskAnyway] = useState(false);

  const pick = (p: Preset) => {
    setPreset(p); setResult(null); setError("");
    if (p !== "custom") setTyped({ from: fromDate(presets[p].from), to: fromDate(presets[p].to) });
  };
  const run = async () => {
    const from = toDate(typed.from), to = toDate(typed.to);
    if (!isDateStr(from) || !isDateStr(to) || from > to) { setError(t("accounts.export.rangeError")); return; }
    setError(""); setBusy(true); setResult(null);
    try {
      setResult(await prepare(source, from, to, projectId, accounts ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!result) return;
    downloadText(`ambika-accounts-${result.from}-to-${result.to}${result.projectId ? `-${result.projectId}` : ""}.csv`, masterCsv(result.fileRows, { dateFormat }));
    toast(t("accounts.export.downloaded"));
  };

  const accountName = (id?: string) => accounts?.find((a) => a.id === id)?.name ?? id ?? "";
  const lineLabel = (l: CheckLine) => t(`accounts.export.figures.${l.key}`, { name: accountName(l.accountId) });
  const totals = result ? masterTotals(result.fileRows) : null;
  const bad = result ? result.check.lines.filter((l) => !l.ok) : [];
  const shown = result ? result.check.lines.filter((l) => !l.ok || l.filePaise !== 0 || l.booksPaise !== 0) : [];
  const partial = result ? result.from !== `${result.months[0]}-01` || result.to !== wholeMonths(result.from, result.to).to : false;

  return (
    <div data-export-panel>
      <section className="card acc-form" aria-label={t("accounts.export.period")}>
        <div className="acc-presets">
          <div className="segmented" role="group" aria-label={t("accounts.export.period")}>
            {(["month", "lastMonth", "fy", "custom"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={preset === p} onClick={() => pick(p)} data-preset={p}>
                {t(`accounts.export.${p === "month" ? "thisMonth" : p === "lastMonth" ? "lastMonth" : p === "fy" ? "thisFy" : "custom"}`)}
              </button>
            ))}
          </div>
        </div>
        <form className="form-grid two" noValidate onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <DateField label={t("accounts.export.from")} value={typed.from} onChange={(x) => { setTyped((v) => ({ ...v, from: x })); setPreset("custom"); setResult(null); }} error={error || undefined} />
          <DateField label={t("accounts.export.to")} value={typed.to} onChange={(x) => { setTyped((v) => ({ ...v, to: x })); setPreset("custom"); setResult(null); }} />
          <SelectField label={t("accounts.export.project")} value={projectId} onChange={(x) => { setProjectId(x); setResult(null); }} placeholder={t("accounts.export.allProjects")}
            options={(projects ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} />
          <SelectField label={t("accounts.export.dateFormat")} value={dateFormat} onChange={setDateFormat}
            options={[{ value: "iso", label: t("accounts.export.iso") }, { value: "dmy", label: t("accounts.export.dmy") }]} />
          <div className="form-actions span-2">
            <Button variant={result ? "secondary" : "primary"} type="submit" disabled={busy || !accounts} data-prepare><Icon name="check-circle" />{busy ? t("accounts.export.preparing") : t("accounts.export.prepare")}</Button>
          </div>
        </form>
      </section>

      {result && totals && (
        <div className="acc-export-result" data-export-result data-check={result.check.ok ? "ok" : "bad"}>
          {result.cut ? <p className="banner error" role="alert"><Icon name="alert" /><span className="text">{t("accounts.export.tooMany")}</span></p> : null}
          {result.fileRows.length === 0 ? <EmptyState icon="info" title={t("accounts.export.empty")} /> : (
            <>
              <section className="card" aria-labelledby="export-check-title">
                <h2 className="card-title" id="export-check-title">{t("accounts.export.checkTitle")}</h2>
                <p className={`banner ${result.check.ok ? "acc-check-ok" : "error"}`} role="status" data-check-result>
                  <Icon name={result.check.ok ? "check-circle" : "alert"} />
                  <span className="text"><b>{result.check.ok ? t("accounts.export.checkOk") : t("accounts.export.checkBad", { n: bad.length })}</b>{" "}
                    {t("accounts.export.checkMonths", { from: formatMonth(result.months[0]!, lang), to: formatMonth(result.months[result.months.length - 1]!, lang) })}
                    {partial ? ` ${t("accounts.export.partial", { from: date(result.from, lang), to: date(result.to, lang) })}` : ""}</span>
                </p>
                <MiniWrap label={t("accounts.export.checkTitle")}>
                  <table className="mini-table" data-check-lines>
                    <thead><tr><th>{t("accounts.export.figure")}</th><th className="num">{t("accounts.export.inFile")}</th><th className="num">{t("accounts.export.inBooks")}</th><th>{t("accounts.export.result")}</th></tr></thead>
                    <tbody>{shown.map((l) => (
                      <tr key={`${l.key}:${l.accountId ?? ""}`} data-line={l.key} data-ok={l.ok}>
                        <td>{lineLabel(l)}</td><td className="num">{money(l.filePaise)}</td><td className="num">{money(l.booksPaise)}</td>
                        <td className={l.ok ? "acc-check-ok" : "acc-check-bad"}><Icon name={l.ok ? "check" : "x"} size={16} /> {l.ok ? t("accounts.export.agree") : t("accounts.export.differ")}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </MiniWrap>
              </section>

              <section className="card" aria-labelledby="export-file-title">
                <h2 className="card-title" id="export-file-title">{t("accounts.export.byType")}</h2>
                <p data-ready>{t("accounts.export.ready", { rows: totals.rows, records: totals.vouchers })}</p>
                <MiniWrap label={t("accounts.export.byType")}>
                  <table className="mini-table">
                    <thead><tr><th>{t("accounts.export.kind")}</th><th className="num">{t("accounts.export.lines")}</th><th className="num">{t("accounts.export.amount")}</th></tr></thead>
                    <tbody>{VOUCHER_TYPES.filter((v) => totals.byType[v]).map((v) => (
                      <tr key={v}><td>{t(`accounts.export.voucherTypes.${v}`)}</td><td className="num">{totals.byType[v]!.rows}</td><td className="num">{money(totals.byType[v]!.totalPaise)}</td></tr>
                    ))}</tbody>
                  </table>
                </MiniWrap>
                <div className="form-actions">
                  {result.check.ok && !result.cut
                    ? <Button variant="primary" onClick={download} data-download><Icon name="download" />{t("accounts.export.download")}</Button>
                    : <Button variant="secondary" onClick={() => setAskAnyway(true)} data-download><Icon name="download" />{t("accounts.export.download")}</Button>}
                </div>
              </section>
            </>
          )}
        </div>
      )}
      <ConfirmDialog open={askAnyway} onOpenChange={setAskAnyway} title={t("accounts.export.download")}
        body={result?.cut ? t("accounts.export.tooMany") : t("accounts.export.checkBad", { n: bad.length })} confirmLabel={t("accounts.export.download")} onConfirm={download} />
    </div>
  );
}

/** The Export for CA page under Accounts. */
export function ExportCsvPage() {
  const { t } = useTranslation();
  const title = t("accounts.export.title");
  return (
    <AccountsShell title={title}>
      <div className="page-head"><div className="heading"><h1>{title}</h1><p className="sub">{t("accounts.export.sub")}</p></div></div>
      <ExportCsvPanel />
    </AccountsShell>
  );
}
