"use client";
import { INTEGRATION_IDS, verifiedSummary } from "@ag/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/feedback";
import { TextField } from "@/components/ui/form";
import { useData, useSession } from "@/data/DataProvider";
import { ReauthNeeded, SignInError, type SetupStatuses } from "@/data/types";
import { CheckItem, CompanyItem, ConfigItem, SampleDataCard, StoredItem, WebsiteItem, type SetupCtx } from "./SetupItems";

/**
 * Settings > Setup & integrations (D-48): everything the CRM connects to, each item with its own settings, Save and Test.
 * Only a super user can open it (also enforced by the rules and the callables). Secret values are write-only (D-49).
 */
export function SetupPage() {
  const { t } = useTranslation();
  const { source, status } = useData();
  const session = useSession();
  const title = t("setup.title");
  const setup = source.setup;
  const [statuses, setStatuses] = useState<SetupStatuses | null>(null);
  const reauthWaiter = useRef<{ ok: () => void; cancel: () => void } | null>(null);
  const [asking, setAsking] = useState(false);

  const reload = useCallback(async () => { if (setup) setStatuses(await setup.statuses()); }, [setup]);
  const allowed = !!session?.superUser;
  useEffect(() => { if (allowed) void reload(); }, [allowed, reload]);

  /** Runs a protected change; if the server wants a fresh sign-in, asks for it and runs the change again. */
  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e) {
      if (!(e instanceof ReauthNeeded)) throw e;
      await new Promise<void>((ok, cancel) => { reauthWaiter.current = { ok, cancel: () => cancel(new Error(t("setup.errors.cancelled"))) }; setAsking(true); });
      return await fn();
    }
  }, [t]);

  if (status === "ready" && !allowed) {
    return <AppShell nav="settings" title={title} crumbs={[{ label: t("settings.title"), href: "/settings/" }, { label: title }]}><NoAccess name={title} /></AppShell>;
  }
  const ctx: SetupCtx | null = setup && statuses ? { setup, statuses, reload, guard } : null;
  const summary = statuses ? verifiedSummary(statuses) : null;
  return (
    <AppShell nav="settings" title={title} crumbs={[{ label: t("settings.title"), href: "/settings/" }, { label: title }]}>
      <div className="page-head"><div className="heading"><h1>{title}</h1><p className="sub">{t("setup.sub")}</p></div></div>
      {setup?.simulated && <div className="banner info" role="note" data-simulation><Icon name="info" /><span className="text">{t("setup.simBanner")}</span></div>}
      {!ctx || !summary ? <Skeleton lines={8} /> : (
        <>
          <div className="card setup-summary" data-setup-summary>
            <b className="setup-count" data-verified={summary.verified} data-total={summary.total}>{t("setup.summary", summary)}</b>
            <div className="bar progress" role="img" aria-label={t("setup.summary", summary)}><span style={{ width: `${(summary.verified / summary.total) * 100}%` }} /></div>
            <p className="small muted">{t("setup.summaryHint")}</p>
          </div>
          <div className="setup-list">
            <ConfigItem ctx={ctx} />
            <CheckItem id="firestore" ctx={ctx} />
            <CheckItem id="storage" ctx={ctx} />
            <CheckItem id="signIn" ctx={ctx} />
            <CheckItem id="functions" ctx={ctx} />
            <StoredItem id="appCheck" ctx={ctx} />
            <StoredItem id="push" ctx={ctx} />
            <StoredItem id="email" ctx={ctx} />
            <WebsiteItem ctx={ctx} />
            <StoredItem id="maps" ctx={ctx} />
            <StoredItem id="whatsapp" ctx={ctx} />
            <CompanyItem />
            {source.sample && <SampleDataCard api={source.sample} guard={guard} />}
          </div>
        </>
      )}
      <ReauthDialog open={asking} onClose={(ok) => { setAsking(false); if (ok) reauthWaiter.current?.ok(); else reauthWaiter.current?.cancel(); reauthWaiter.current = null; }} />
    </AppShell>
  );
}

/** "Sign in again to continue": a Google pop-up, or the password, so a stolen open screen can't change the setup (D-48). */
function ReauthDialog({ open, onClose }: { open: boolean; onClose: (ok: boolean) => void }) {
  const { t } = useTranslation();
  const { source } = useData();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const method = source.auth?.signInMethod() ?? null;
  const go = async () => {
    setBusy(true);
    setError(false);
    try { await source.auth?.reauthenticate(method === "password" ? password : undefined); setPassword(""); onClose(true); } catch (e) { setError(!(e instanceof SignInError && e.code === "cancelled")); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent title={t("setup.reauth.title")} description={t("setup.reauth.body")}>
        {method === "password" && <TextField label={t("setup.reauth.password")} type="password" value={password} onChange={setPassword} autoComplete="current-password" />}
        {error && <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{t("setup.reauth.cannot")}</span></div>}
        <DialogActions>
          <Button variant="secondary" onClick={() => onClose(false)}>{t("setup.reauth.cancel")}</Button>
          <Button variant="primary" disabled={busy || (method === "password" && !password)} onClick={() => void go()} data-reauth>{method === "google.com" ? t("setup.reauth.google") : t("setup.reauth.go")}</Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

// Keeps the list of ids in one place for tests that count the items.
export const SETUP_ITEM_COUNT = INTEGRATION_IDS.length + 1;
