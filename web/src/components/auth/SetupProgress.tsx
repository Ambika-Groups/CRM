"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { resolveConfig } from "@/data/config";
import { probeProject, type ProbeLine } from "@/lib/projectProbe";

/**
 * "Setting up your project: 1 of 3 steps still to do" (Firebase mode, before the first owner exists). It asks Google's
 * public addresses what is switched on in the user's project, and the CRM's own server part whether it is connected, and says in plain words what is missing and which step of
 * GO-LIVE-LOCAL.md fixes it, instead of an error. Shown beside the sign-in, so a half-set-up project is never a dead end.
 */
export function useProjectProbe() {
  const [lines, setLines] = useState<ProbeLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try { setLines(await probeProject(resolveConfig().config)); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void run(); }, [run]);
  return { lines, busy, run };
}

export function SetupProgress({ probe }: { probe: ReturnType<typeof useProjectProbe> }) {
  const { t } = useTranslation();
  const { lines, busy, run } = probe;

  if (!lines) return <section className="card auth-progress" data-setup-progress="checking"><p className="muted" role="status">{t("signin.progress.checking")}</p></section>;
  const missing = lines.filter((l) => l.ok === false).length;
  const text = (l: ProbeLine): string => {
    const k = `signin.progress.${l.key}`;
    if (l.ok === true) return t(`${k}.ok`, { methods: (l.detail ?? "").split("+").map((m) => t(`signin.progress.method.${m}`)).join(", ") });
    if (l.ok === false) return t(`${k}.${l.detail && ["notStarted", "noMethod", "noKey", "notDeployed"].includes(l.detail) ? l.detail : "missing"}`);
    return t(`${k}.${l.detail === "local" ? "local" : "unknown"}`);
  };
  return (
    <section className="card auth-progress" aria-labelledby="progress-title" data-setup-progress={missing ? "missing" : "ready"} data-missing={missing}>
      <h2 id="progress-title">{missing ? t("signin.progress.title", { missing, total: lines.length }) : t("signin.progress.ready")}</h2>
      <ul className="progress-list">
        {lines.map((l) => (
          <li key={l.key} data-progress={l.key} data-ok={String(l.ok)} className={l.ok === true ? "is-ok" : l.ok === false ? "is-missing" : "is-unknown"}>
            <Icon name={l.ok === true ? "check-circle" : l.ok === false ? "alert" : "info"} size={18} /><span>{text(l)}</span>
          </li>
        ))}
        <li data-progress="owner" className="is-unknown"><Icon name="info" size={18} /><span>{t("signin.progress.owner")}</span></li>
      </ul>
      <div className="auth-actions">
        <Button variant="secondary" size="sm" onClick={() => void run()} disabled={busy} data-progress-recheck>{busy ? t("signin.progress.checking") : t("signin.progress.recheck")}</Button>
      </div>
      <p className="muted small">{t("signin.progress.guide")}</p>
    </section>
  );
}
