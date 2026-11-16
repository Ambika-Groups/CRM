"use client";
// The usage meter for the free plan (D-51): stored data against 1 GiB, photos against about 8,000, and records read
// and saved today against 50,000 and 20,000, with a warning from 70% and a stronger one from 90%, and what to do.
// The state is always said in words, never by colour alone. Owner only.
import { formatFileSize } from "@ag/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { MiniWrap, Skeleton } from "@/components/ui/feedback";
import { useData, useSession } from "@/data/DataProvider";
import { AdminError, loadUsage, type UsageData } from "./adminApi";
import { auditWhen, usageMeters, type UsageMeter } from "./core";

const num = (n: number) => Math.round(n).toLocaleString("en-IN");

export function UsagePanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const session = useSession();
  const { source } = useData();
  const owner = session?.role === "owner";
  const [data, setData] = useState<UsageData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try { setData(await loadUsage(source)); } catch (e) { setError(e instanceof AdminError && e.code === "signedOut" ? "signedOut" : "failed"); } finally { setBusy(false); }
  }, [source]);
  useEffect(() => { if (owner) void load(); }, [owner, load]);

  if (!owner) return null;
  const report = data ? usageMeters(data) : null;
  const todo = report?.meters.filter((m) => m.measured && m.level !== "ok") ?? [];
  const rows = data ? Object.entries(data.counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) : [];

  return (
    <section className="card section" data-usage-panel data-worst={report?.worst ?? ""} aria-labelledby="usage-title">
      <h2 className="card-title" id="usage-title">{t("admin.usage.title")}
        <span className="aside"><Button size="sm" onClick={() => void load()} disabled={busy} data-usage-refresh><Icon name="refresh" />{busy ? t("admin.usage.checking") : t("admin.usage.refresh")}</Button></span>
      </h2>
      <p className="hint"><Icon name="info" size={16} /><span>{t("admin.usage.hint")}</span></p>
      {error && <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{error === "signedOut" ? t("admin.err.signedOut") : t("admin.usage.failed")}</span></div>}
      {!report ? (error ? null : <Skeleton lines={6} />) : (
        <>
          {todo.length === 0
            ? <p className="admin-fine" data-usage-fine><Icon name="check-circle" size={16} /><span>{t("admin.usage.allFine")}</span></p>
            : todo.map((m) => (
              <div key={m.key} className={`banner ${m.level === "warning" ? "warning" : "error"}`} role="status" data-usage-todo={m.key}>
                <Icon name="alert" /><span className="text">{t(`admin.usage.todo.${m.key}.${m.level}`)}</span>
              </div>
            ))}
          <div className="admin-meters">
            {report.meters.map((m) => <Meter key={m.key} m={m} />)}
          </div>
          <p className="muted small">{t("admin.usage.estimate")} {data ? t("admin.usage.updated", { time: auditWhen(data.at, lang) }) : ""}</p>

          <h3 className="admin-sub">{t("admin.usage.records")}</h3>
          <p className="muted small" data-usage-documents={report.documents}>{t("admin.usage.recordsTotal", { n: num(report.documents) })}</p>
          {rows.length > 0 && (
            <MiniWrap label={t("admin.usage.records")}><table className="mini-table" data-usage-counts>
              <caption className="sr-only">{t("admin.usage.records")}</caption>
              <tbody>
                {rows.map(([name, n]) => <tr key={name} data-count={name}><th scope="row">{t(`admin.usage.collection.${name}`, { defaultValue: name })}</th><td className="num">{num(n)}</td></tr>)}
              </tbody>
            </table></MiniWrap>
          )}
        </>
      )}
    </section>
  );
}

function Meter({ m }: { m: UsageMeter }) {
  const { t } = useTranslation();
  const label = t(`admin.usage.meter.${m.key}`);
  const used = m.key === "storage" ? formatFileSize(m.used) : num(m.used);
  const limit = m.key === "storage" ? formatFileSize(m.limit) : num(m.limit);
  const width = Math.min(100, Math.max(m.used > 0 ? 1 : 0, m.percent));
  return (
    <div className="admin-meter" data-meter={m.key} data-level={m.level} data-measured={m.measured} data-percent={m.percent}>
      <div className="admin-meter-head">
        <span className="admin-meter-name">{label}</span>
        {m.measured && <span className="admin-meter-state" data-state>{m.level !== "ok" && <Icon name="alert" size={14} />}{t(`admin.usage.level.${m.level}`)}</span>}
      </div>
      {m.measured ? (
        <>
          <div className="admin-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, m.percent)}
            aria-valuetext={`${t("admin.usage.percent", { n: m.percent })}, ${t(`admin.usage.level.${m.level}`)}`}>
            <span className="admin-bar-fill" style={{ width: `${width}%` }} />
            <span className="admin-bar-mark at-70" aria-hidden="true" /><span className="admin-bar-mark at-90" aria-hidden="true" />
          </div>
          <p className="admin-meter-figures"><span>{t(m.key === "storage" ? "admin.usage.ofAbout" : "admin.usage.of", { used, limit })}</span><span>{t("admin.usage.percent", { n: m.percent })}</span></p>
        </>
      ) : (
        <p className="muted small" data-not-measured><b>{t("admin.usage.notMeasured")}.</b> {t("admin.usage.notMeasuredHint")} ({t("admin.usage.of", { used: "?", limit })})</p>
      )}
    </div>
  );
}
