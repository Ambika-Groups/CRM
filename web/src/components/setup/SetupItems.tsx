"use client";
import {
  CommandError, firebaseConfigToEnv, INTEGRATIONS, parseFirebaseConfigBlock, validateFirebaseConfig,
  type FirebaseWebConfig, type IntegrationId, type IntegrationStatus, type TestOutcome,
} from "@ag/core";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useToast } from "@/components/ui/feedback";
import { CheckField, TextArea, TextField } from "@/components/ui/form";
import { deviceConfig, forgetDeviceConfig, saveDeviceConfig } from "@/data/config";
import type { SampleApi, SampleStatus, SetupApi, SetupStatuses } from "@/data/types";

export interface SetupCtx {
  setup: SetupApi;
  statuses: SetupStatuses;
  reload: () => Promise<void>;
  /** Runs a protected change; asks for a fresh sign-in first when the server wants one (D-48). */
  guard: <T>(fn: () => Promise<T>) => Promise<T>;
}

const WHERE_URL: Partial<Record<IntegrationId, string>> = {
  firebaseConfig: "https://console.firebase.google.com/",
  firestore: "https://console.firebase.google.com/",
  storage: "https://console.firebase.google.com/",
  signIn: "https://console.firebase.google.com/",
  appCheck: "https://www.google.com/recaptcha/admin",
  push: "https://console.firebase.google.com/",
  email: "https://resend.com/api-keys",
  maps: "https://console.cloud.google.com/google/maps-apis/credentials",
  whatsapp: "https://developers.facebook.com/apps/",
};

function whenText(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

type BadgeKind = "verified" | "failed" | "untested" | "off" | "later";
export function badgeFor(id: IntegrationId, st: IntegrationStatus | undefined): BadgeKind {
  if (!INTEGRATIONS[id].available) return "later";
  if (st && st.enabled === false) return "off";
  if (st?.test) return st.test.ok ? "verified" : "failed";
  return "untested";
}

function Badge({ kind }: { kind: BadgeKind }) {
  const { t } = useTranslation();
  const look: Record<BadgeKind, { tone: string; icon: string }> = {
    verified: { tone: "success", icon: "check-circle" }, failed: { tone: "error", icon: "alert" }, untested: { tone: "neutral", icon: "clock" },
    off: { tone: "neutral", icon: "x" }, later: { tone: "neutral", icon: "clock" },
  };
  return <span className={`badge ${look[kind].tone}`} data-setup-badge={kind}><Icon name={look[kind].icon} size={14} />{t(`setup.badge.${kind}`)}</span>;
}

/** The common frame of an item: its title, a status badge, what it is, and where to get it, in plain words. */
function Shell({ id, ctx, children }: { id: IntegrationId; ctx: SetupCtx; children?: ReactNode }) {
  const { t } = useTranslation();
  const url = WHERE_URL[id];
  // The Firebase config item keeps its strings under "config".
  const key = id === "firebaseConfig" ? "config" : id;
  return (
    <section className="card setup-item" data-setup-item={id} aria-labelledby={`si-${id}`}>
      <div className="setup-head">
        <h2 id={`si-${id}`}>{t(`setup.${key}.title`)}</h2>
        <Badge kind={badgeFor(id, ctx.statuses[id])} />
      </div>
      <p className="muted">{t(`setup.${key}.desc`)}</p>
      <p className="setup-where small"><b>{t("setup.where")}:</b> {t(`setup.${key}.where`)}{" "}
        {url && <a href={url} target="_blank" rel="noopener noreferrer">{t("setup.open")}<span className="sr-only"> ({t(`setup.${key}.title`)})</span></a>}</p>
      {children}
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  return (
    <Button size="sm" variant="secondary" aria-label={label ?? t("setup.copy")}
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => toast(t("setup.copied")), () => undefined); }}>
      <Icon name="file-text" size={16} />{t("setup.copy")}
    </Button>
  );
}

/** The Test button and its result: Pass or Fail, one plain sentence, a fix hint, and when it last passed. */
function TestRow({ id, ctx, extra, disabled }: { id: IntegrationId; ctx: SetupCtx; extra?: { key?: string }; disabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<(TestOutcome & { at: string }) | null>(null);
  const st = ctx.statuses[id];
  useEffect(() => setLocal(null), [st?.updatedAt, st?.test?.at]);
  const result = local ?? st?.test ?? null;
  const run = async () => {
    setBusy(true);
    try {
      const out = await ctx.setup.test(id, extra);
      setLocal({ ...out, at: new Date().toISOString() });
      await ctx.reload();
    } catch (e) {
      setLocal({ ok: false, message: e instanceof Error ? e.message : String(e), at: new Date().toISOString() });
    } finally { setBusy(false); }
  };
  return (
    <div className="setup-test">
      <Button variant="secondary" onClick={() => void run()} disabled={busy || disabled} data-test={id}><Icon name="check" size={16} />{busy ? t("setup.testing") : t("setup.test")}</Button>
      <div className="setup-result" role="status" aria-live="polite" data-test-result={id} data-ok={result ? String(result.ok) : undefined}>
        {result && (
          <p className={result.ok ? "setup-pass" : "setup-fail"}>
            <Icon name={result.ok ? "check-circle" : "alert"} size={18} />
            <span><b>{result.ok ? t("setup.pass") : t("setup.fail")}:</b> {result.message}</span>
          </p>
        )}
        {result?.hint && <p className="small setup-hint">{t("setup.fixHint", { hint: result.hint })}</p>}
        <p className="small muted" data-last-ok>{st?.lastOkAt ? t("setup.lastOk", { when: whenText(st.lastOkAt, i18n.language) }) : t("setup.neverOk")}</p>
      </div>
    </div>
  );
}

// ---------- 1. Firebase web config ----------

const CONFIG_KEYS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"] as const;

export function ConfigItem({ ctx }: { ctx: SetupCtx }) {
  const { t } = useTranslation();
  const toast = useToast();
  const inUse = ctx.setup.configInUse();
  const fixed = inUse.from === "env";
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(inUse.config as Record<string, string>) }));
  const [paste, setPaste] = useState("");
  const [found, setFound] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [forget, setForget] = useState(false);
  const cfg = values as Partial<FirebaseWebConfig>;
  const siteKey = ctx.statuses.appCheck?.values.siteKey ?? "";
  const envBlock = firebaseConfigToEnv(cfg) + (siteKey ? `\nNEXT_PUBLIC_RECAPTCHA_SITE_KEY=${siteKey}` : "");

  const read = () => {
    const parsed = parseFirebaseConfigBlock(paste);
    setValues((v) => ({ ...v, ...parsed }));
    setFound(Object.keys(parsed).length);
    setErrors({});
  };
  const save = () => {
    const errs = validateFirebaseConfig(cfg);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    saveDeviceConfig(cfg as FirebaseWebConfig);
    toast(t("setup.saved"));
    // Connecting means starting again with the new config.
    window.location.assign("/settings/setup/");
  };
  return (
    <Shell id="firebaseConfig" ctx={ctx}>
      <p className="hint" data-config-from={inUse.from}><Icon name="info" size={16} /><span>{inUse.from === "env" ? t("setup.config.fromEnv") : inUse.from === "device" ? t("setup.config.fromDevice") : t("setup.config.fromNone")}</span></p>
      {!fixed && (
        <div className="setup-paste">
          <TextArea label={t("setup.config.paste")} hint={t("setup.config.pasteHint")} value={paste} onChange={setPaste} rows={4} />
          <Button size="sm" variant="secondary" onClick={read} disabled={!paste.trim()} data-read-config>{t("setup.config.read")}</Button>
          {found !== null && <span className="small muted" role="status">{t("setup.config.readFound", { n: found })}</span>}
        </div>
      )}
      <div className="form-grid two">
        {CONFIG_KEYS.map((k) => (
          <TextField key={k} label={t(`setup.config.${k}`)} hint={k === "authDomain" ? t("setup.config.authDomainHint") : undefined} value={values[k] ?? ""}
            onChange={(v) => setValues((x) => ({ ...x, [k]: v }))} error={errors[k]} disabled={fixed} />
        ))}
      </div>
      {!fixed && (
        <div className="setup-actions">
          <Button variant="primary" onClick={save} data-save-config>{inUse.from === "device" ? t("setup.config.saveDevice") : t("setup.config.saveConnect")}</Button>
          {inUse.from === "device" && deviceConfig() && <Button variant="text" onClick={() => setForget(true)}>{t("setup.config.forget")}</Button>}
        </div>
      )}
      <div className="setup-netlify">
        <h3>{t("setup.config.netlifyTitle")}</h3>
        <p className="small muted">{t("setup.config.netlifyBody")}</p>
        <pre className="setup-pre" tabIndex={0} aria-label={t("setup.config.netlifyTitle")}>{envBlock}</pre>
        <CopyButton text={envBlock} />
      </div>
      <TestRow id="firebaseConfig" ctx={ctx} />
      <ConfirmDialog open={forget} onOpenChange={setForget} title={t("setup.config.forget")} body={t("setup.config.forgetBody")} confirmLabel={t("setup.config.forget")}
        onConfirm={() => { forgetDeviceConfig(); toast(t("setup.config.forgot")); window.location.assign("/settings/setup/"); }} />
    </Shell>
  );
}

// ---------- 2–5. Checks with nothing to type in ----------

export function CheckItem({ id, ctx }: { id: "firestore" | "storage" | "signIn" | "functions"; ctx: SetupCtx }) {
  const { t } = useTranslation();
  const bucket = ctx.setup.configInUse().config.storageBucket;
  const host = typeof window === "undefined" ? "" : window.location.hostname;
  return (
    <Shell id={id} ctx={ctx}>
      <ul className="setup-facts">
        {id === "firestore" && <><li>{t("setup.firestore.name")}</li><li>{t("setup.firestore.region")}</li></>}
        {id === "storage" && <><li>{t("setup.storage.bucket", { bucket: bucket || "—" })}</li><li>us-central1</li></>}
        {id === "functions" && <li>{t("setup.functions.region")}</li>}
        {id === "signIn" && (
          <>
            <li>{t("setup.signIn.methods")}</li>
            <li><b>{t("setup.signIn.domains")}:</b> {t("setup.signIn.domainsBody", { host })} {t("setup.signIn.netlify")}</li>
            <li>{t("setup.signIn.smsNote")}</li>
          </>
        )}
      </ul>
      <TestRow id={id} ctx={ctx} />
    </Shell>
  );
}

// ---------- 6–8, 10, 11: saved settings ----------

export function StoredItem({ id, ctx }: { id: "appCheck" | "push" | "email" | "maps" | "whatsapp"; ctx: SetupCtx }) {
  const { t } = useTranslation();
  const toast = useToast();
  const def = INTEGRATIONS[id];
  const st = ctx.statuses[id];
  const [values, setValues] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(st?.enabled ?? true);
  const [enforce, setEnforce] = useState(st?.enforce ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Public values come back from the server; secrets never do (only a masked tail).
  // Keyed on the saved content, not on object identity: another card's Test reloads every status, and that must not wipe what is being typed here.
  const savedKey = JSON.stringify([st?.updatedAt ?? null, st?.values ?? {}, st?.enabled ?? true, st?.enforce ?? false]);
  useEffect(() => {
    setValues((v) => ({ ...(st?.values ?? {}), ...Object.fromEntries(def.fields.filter((f) => f.secret).map((f) => [f.key, v[f.key] ?? ""])) }));
    setEnabled(st?.enabled ?? true);
    setEnforce(st?.enforce ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await ctx.guard(() => ctx.setup.save(id, { enabled, ...(def.hasEnforce ? { enforce } : {}), values }));
      setValues((v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, def.fields.find((f) => f.key === k)?.secret ? "" : x])));
      toast(t("setup.saved"));
      await ctx.reload();
    } catch (e) {
      if (e instanceof CommandError) { setErrors(e.fields); toast(e.message, "error"); } else toast(e instanceof Error ? e.message : String(e), "error");
    } finally { setBusy(false); }
  };
  const clear = async () => {
    await ctx.guard(() => ctx.setup.clear(id));
    toast(t("setup.cleared"));
    setValues({});
    await ctx.reload();
  };
  const siteKey = id === "appCheck" ? (st?.values.siteKey ?? "") : "";
  const netlifyLine = `NEXT_PUBLIC_RECAPTCHA_SITE_KEY=${siteKey}`;
  const later = !def.available;
  return (
    <Shell id={id} ctx={ctx}>
      <div className="form-grid two">
        {def.fields.map((f) => (
          <TextField key={f.key} label={t(`setup.${id}.${f.key}`)}
            hint={f.secret ? [st?.masked[f.key] ? t("setup.savedKey", { masked: st.masked[f.key] }) : t("setup.notSaved"), t("setup.keepBlank"), t(`setup.${id}.${f.key}Hint`, { defaultValue: "" })].filter(Boolean).join(" ") : t(`setup.${id}.${f.key}Hint`, { defaultValue: "" }) || undefined}
            type={f.secret ? "password" : "text"} autoComplete="off" value={values[f.key] ?? ""} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))}
            error={errors[f.key]} disabled={later} />
        ))}
      </div>
      {!later && <CheckField checked={enabled} onChange={setEnabled} label={t("setup.enabled")} />}
      {def.hasEnforce && !later && <CheckField checked={enforce} onChange={setEnforce} label={t("setup.enforce")} hint={t("setup.appCheck.enforceHint")} />}
      {id === "appCheck" && siteKey && (
        <div className="setup-netlify">
          <p className="small muted">{t("setup.appCheck.netlify", { line: "" })}</p>
          <pre className="setup-pre" tabIndex={0} aria-label="NEXT_PUBLIC_RECAPTCHA_SITE_KEY">{netlifyLine}</pre>
          <CopyButton text={netlifyLine} />
        </div>
      )}
      {!later && (
        <div className="setup-actions">
          <Button variant="primary" onClick={() => void save()} disabled={busy} data-save={id}>{busy ? t("setup.saving") : t("setup.save")}</Button>
          <Button variant="text" onClick={() => setClearing(true)} disabled={busy || !st} data-clear={id}>{t("setup.clear")}</Button>
        </div>
      )}
      {!later && <TestRow id={id} ctx={ctx} />}
      <ConfirmDialog open={clearing} onOpenChange={setClearing} title={`${t("setup.clear")}: ${t(`setup.${id}.title`)}`} body={t("setup.clear")} confirmLabel={t("setup.clear")} onConfirm={clear} />
    </Shell>
  );
}

// ---------- 9. Website to CRM link ----------

export function WebsiteItem({ ctx }: { ctx: SetupCtx }) {
  const { t } = useTranslation();
  const toast = useToast();
  const st = ctx.statuses.websiteLink;
  const [asking, setAsking] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [testKey, setTestKey] = useState("");
  const endpoint = ctx.setup.enquiryEndpoint();
  const make = async () => {
    try {
      const out = await ctx.guard(() => ctx.setup.rotateWebsiteKey());
      setFresh(out.key);
      setTestKey(out.key);
      await ctx.reload();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
  };
  return (
    <Shell id="websiteLink" ctx={ctx}>
      <div className="setup-endpoint">
        <b>{t("setup.websiteLink.endpoint")}</b>
        <code className="setup-code" data-endpoint>{endpoint}</code>
        <CopyButton text={endpoint} />
      </div>
      <p className="small">{st?.masked.apiKey ? t("setup.websiteLink.masked", { masked: st.masked.apiKey }) : t("setup.notSaved")}</p>
      {fresh && (
        <div className="setup-fresh" role="status" data-fresh-key>
          <p><b>{t("setup.websiteLink.shownOnce")}</b></p>
          <code className="setup-code">{fresh}</code>
          <CopyButton text={fresh} />
        </div>
      )}
      <div className="setup-actions">
        <Button variant="primary" onClick={() => (st?.masked.apiKey ? setAsking(true) : void make())} data-make-key>{st?.masked.apiKey ? t("setup.websiteLink.remake") : t("setup.websiteLink.make")}</Button>
      </div>
      <TextField label={t("setup.websiteLink.paste")} hint={t("setup.websiteLink.pasteHint")} value={testKey} onChange={setTestKey} type="password" autoComplete="off" />
      <p className="small muted">{t("setup.websiteLink.later")}</p>
      <TestRow id="websiteLink" ctx={ctx} extra={{ key: testKey }} />
      <ConfirmDialog open={asking} onOpenChange={setAsking} title={t("setup.websiteLink.confirmTitle")} body={t("setup.websiteLink.confirmBody")} confirmLabel={t("setup.websiteLink.make")} destructive={false} onConfirm={make} />
    </Shell>
  );
}

// ---------- 12. Company profile ----------

export function CompanyItem() {
  const { t } = useTranslation();
  return (
    <section className="card setup-item" data-setup-item="company" aria-labelledby="si-company">
      <div className="setup-head"><h2 id="si-company">{t("setup.company.title")}</h2></div>
      <p className="muted">{t("setup.company.desc")}</p>
      <Link className="btn btn-secondary" href="/settings/?tab=company">{t("setup.company.go")}</Link>
    </section>
  );
}

// ---------- Sample data (real project only) ----------

/**
 * "Load sample data into this project": the demo set (PRD §17), flagged as sample on every record and removable. Never
 * automatic: a super user presses the button, after a sign-in within 5 minutes. Only for an empty project.
 */
export function SampleDataCard({ api, guard }: { api: SampleApi; guard: SetupCtx["guard"] }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [st, setSt] = useState<SampleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<"load" | "remove" | null>(null);
  const reload = async () => { try { setSt(await api.status()); } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); } };
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const total = Object.values(st?.counts ?? {}).reduce((a, b) => a + b, 0);
  const act = async (kind: "load" | "remove") => {
    setBusy(true);
    try {
      setSt(await guard(() => (kind === "load" ? api.load() : api.remove())));
      toast(t(kind === "load" ? "setup.sample.loadedToast" : "setup.sample.removedToast"));
    } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); await reload(); } finally { setBusy(false); }
  };
  return (
    <section className="card setup-item" id="sample-data" data-sample-card aria-labelledby="si-sample">
      <div className="setup-head">
        <h2 id="si-sample">{t("setup.sample.title")}</h2>
        {st && <span className={`badge ${st.loaded ? "warning" : "neutral"}`} data-sample-state={st.loaded ? "loaded" : "none"}><Icon name={st.loaded ? "info" : "x"} size={14} />{st.loaded ? t("setup.sample.stateLoaded") : t("setup.sample.stateNone")}</span>}
      </div>
      <p className="muted">{t("setup.sample.desc")}</p>
      {st?.loaded && <p data-sample-info>{t("setup.sample.info", { n: total, when: st.at ? new Date(st.at).toLocaleString(i18n.language === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "" })}</p>}
      {st && !st.loaded && st.hasOwnRecords && <p className="hint" role="note"><Icon name="info" size={16} /><span>{t("setup.sample.notEmpty")}</span></p>}
      {st && st.loaded && st.hasOwnRecords && <p className="hint" role="note"><Icon name="info" size={16} /><span>{t("setup.sample.cantRemove")}</span></p>}
      <div className="setup-actions">
        <Button variant="primary" disabled={busy || !st || st.loaded || st.hasOwnRecords} onClick={() => setAsking("load")} data-sample-load>{busy && !st?.loaded ? t("setup.sample.loading") : t("setup.sample.load")}</Button>
        <Button variant="secondary" disabled={busy || !st?.loaded || st.hasOwnRecords} onClick={() => setAsking("remove")} data-sample-remove>{t("setup.sample.remove")}</Button>
      </div>
      <ConfirmDialog open={asking === "load"} onOpenChange={(o) => !o && setAsking(null)} title={t("setup.sample.load")} body={t("setup.sample.confirmLoad")} confirmLabel={t("setup.sample.load")} destructive={false} onConfirm={() => act("load")} />
      <ConfirmDialog open={asking === "remove"} onOpenChange={(o) => !o && setAsking(null)} title={t("setup.sample.remove")} body={t("setup.sample.confirmRemove")} confirmLabel={t("setup.sample.remove")} onConfirm={() => act("remove")} />
    </section>
  );
}
