"use client";
import { DEFAULT_FORMATS, formatDocNumber, fyOf, ROLE_LABELS, ROLES, todayIST, type DocType, type Role, type User } from "@ag/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Skeleton, StatusBadge, useToast, MiniWrap } from "@/components/ui/feedback";
import { CheckField, ErrorSummary, fromPaise, MoneyField, SelectField, TextArea, TextField, toInt, toPaise, useForm } from "@/components/ui/form";
import { useData, useRun, useSession, useSmall } from "@/data/DataProvider";
import { phone } from "@/lib/fmt";
import { setParam, useParam } from "@/lib/params";

const TABS = ["company", "users", "roles", "operations", "numbering"] as const;
type Tab = (typeof TABS)[number];
type Settings = { id: string; [k: string]: unknown };
interface WorkerRole { key: string; label: string; labelHi?: string; active?: boolean }

/** Settings (spec §2, §3.3): company details (placeholders until confirmed), users and roles, worker roles, rules and limits, numbering. */
export function SettingsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const tabParam = useParam("tab");
  const [tab, setTab] = useState<Tab>("company");
  useEffect(() => { if (tabParam && (TABS as readonly string[]).includes(tabParam)) setTab(tabParam as Tab); }, [tabParam]);
  const settings = useSmall<Settings>("settings");
  const doc = (id: string) => settings?.find((s) => s.id === id);
  const title = t("settings.title");

  if (session && session.role !== "owner" && session.role !== "accountant") {
    return <AppShell nav="settings" title={title} crumbs={[{ label: title }]}><NoAccess name={title} /></AppShell>;
  }
  const owner = session?.role === "owner";
  return (
    <AppShell nav="settings" title={title} crumbs={[{ label: title }]}>
      <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
      {session?.superUser && (
        <section className="card setup-link" data-setup-link>
          <div><h2 className="card-title">{t("setup.menu")}</h2><p className="muted">{t("setup.menuHint")}</p></div>
          <Link className="btn btn-secondary" href="/settings/setup/">{t("setup.title")}</Link>
        </section>
      )}
      <nav className="tabs" aria-label={title}>
        {TABS.map((x) => (
          <a key={x} href={`?tab=${x}`} aria-current={tab === x ? "page" : undefined} onClick={(e) => { e.preventDefault(); setTab(x); setParam("tab", x); }}>{t(`settings.${x}`)}</a>
        ))}
      </nav>
      {!owner && <p className="hint"><Icon name="lock" size={16} /><span>{t("settings.readOnly")}</span></p>}
      {!settings ? <Skeleton lines={6} /> : (
        <>
          {tab === "company" && <CompanyTab doc={doc("company")} canWrite={owner} />}
          {tab === "users" && <UsersTab canWrite={owner} />}
          {tab === "roles" && <RolesTab roles={(doc("operations")?.workerRoles as WorkerRole[] | undefined) ?? []} canWrite={owner} />}
          {tab === "operations" && <OperationsTab doc={doc("operations")} canWrite={owner} />}
          {tab === "numbering" && <NumberingTab doc={doc("numbering")} />}
        </>
      )}
    </AppShell>
  );
}

const COMPANY_FIELDS = ["legalName", "tradeName", "address", "stateCode", "gstin", "pan", "phone", "email", "brandColor"] as const;
const isPlaceholder = (v: unknown) => typeof v === "string" && v.includes("[");

function CompanyTab({ doc, canWrite }: { doc?: Settings; canWrite: boolean }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const init = Object.fromEntries([...COMPANY_FIELDS.map((k) => [k, String(doc?.[k] ?? "")]), ["gstScheme", String(doc?.gstScheme ?? "regular")]]) as Record<string, string>;
  const f = useForm(init);
  const pending = COMPANY_FIELDS.filter((k) => isPlaceholder(doc?.[k]));
  return (
    <form className="card" noValidate onSubmit={(e) => {
      e.preventDefault();
      void f.submit(async (x) => { await run("updateSettings", { docId: "company", patch: x }); toast(t("settings.saved")); });
    }}>
      <h2 className="card-title">{t("settings.company")}</h2>
      {pending.length > 0 && <p className="hint"><Icon name="info" size={16} /><span>{t("settings.placeholder")}</span></p>}
      <ErrorSummary summary={f.summary} errors={f.errors} />
      <div className="form-grid two" style={{ marginTop: "var(--space-4)" }}>
        {COMPANY_FIELDS.map((k) => k === "address"
          ? <div key={k} className="span-2"><TextArea label={t(`settings.${k}`)} value={f.values[k] ?? ""} onChange={(v) => f.set(k, v)} disabled={!canWrite} rows={2} /></div>
          : <TextField key={k} label={t(`settings.${k}`)} value={f.values[k] ?? ""} onChange={(v) => f.set(k, v)} error={f.errors[k]} disabled={!canWrite} />)}
        <SelectField label={t("settings.gstScheme")} value={f.values.gstScheme ?? "regular"} onChange={(v) => f.set("gstScheme", v)} disabled={!canWrite}
          options={[{ value: "regular", label: t("settings.regular") }, { value: "composition", label: t("settings.composition") }]} />
      </div>
      {canWrite && <div className="form-actions"><Button variant="primary" type="submit" disabled={f.submitting}>{f.submitting ? t("common.saving") : t("common.save")}</Button></div>}
    </form>
  );
}

function UsersTab({ canWrite }: { canWrite: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const { source } = useData();
  const users = useSmall<User>("users");
  const f = useForm({ name: "", contact: "", role: "supervisor" });
  const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r][lang] }));
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg); } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
  };
  return (
    <>
      <section className="card">
        <h2 className="card-title">{t("settings.users")}</h2>
        <p className="hint"><Icon name="info" size={16} /><span>{source.mode === "demo" ? t("settings.demoSwitch") : t("settings.ownerOnly")}</span></p>
        {!users ? <Skeleton lines={4} /> : (
          <MiniWrap label={t("settings.users")}><table className="mini-table">
            <caption className="sr-only">{t("settings.users")}</caption>
            <thead><tr><th>{t("settings.userName")}</th><th>{t("settings.userContact")}</th><th>{t("settings.userRole")}</th><th>{t("settings.activeUser")}</th><th>{t("settings.superUser")}</th></tr></thead>
            <tbody>
              {[...users].sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
                <tr key={u.id}>
                  <td>{u.name}{u.id === session?.uid ? <span className="muted"> ({t("settings.you")})</span> : null}</td>
                  <td>{u.email || (u.phone ? phone(u.phone) : "—")}</td>
                  <td>{canWrite ? (
                    <select className="select" aria-label={`${t("settings.userRole")}: ${u.name}`} value={u.role}
                      onChange={(e) => void act(() => run("setUserRole", { userId: u.id, role: e.target.value as Role }), t("settings.roleChanged"))}>
                      {roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : ROLE_LABELS[u.role][lang]}</td>
                  <td>{canWrite ? (
                    <label className="toggle-row"><input type="checkbox" checked={u.active} aria-label={`${t("settings.activeUser")}: ${u.name}`}
                      onChange={(e) => void act(() => run("setUserActive", { userId: u.id, active: e.target.checked }), t("settings.saved"))} /></label>
                  ) : <StatusBadge kind={u.active ? "active" : "inactive"} />}</td>
                <td>{u.role !== "owner" ? "—" : session?.superUser ? (
                    <label className="toggle-row"><input type="checkbox" checked={u.superUser === true} aria-label={`${t("settings.superUser")}: ${u.name}`} data-super-user={u.id}
                      onChange={(e) => void act(() => run("setSuperUser", { userId: u.id, superUser: e.target.checked }), t("settings.saved"))} /></label>
                  ) : (u.superUser ? t("settings.yes") : t("settings.no"))}</td>
                </tr>
              ))}
            </tbody>
          </table></MiniWrap>
        )}
      </section>
      {canWrite && (
        <form className="card section" noValidate onSubmit={(e) => {
          e.preventDefault();
          void f.submit(async (x) => {
            const email = x.contact.includes("@") ? x.contact : undefined;
            await run("createUser", { name: x.name, email, phone: email ? undefined : x.contact, role: x.role as Role });
            toast(t("settings.userAdded"));
            f.setAll({ name: "", contact: "", role: "supervisor" });
          });
        }}>
          <h2 className="card-title">{t("settings.addUser")}</h2>
          <ErrorSummary summary={f.summary} errors={f.errors} />
          <div className="form-grid two" style={{ marginTop: "var(--space-4)" }}>
            <TextField label={t("settings.userName")} value={f.values.name} onChange={(v) => f.set("name", v)} error={f.errors.name} required />
            <TextField label={t("settings.userContact")} value={f.values.contact} onChange={(v) => f.set("contact", v)} error={f.errors.email ?? f.errors.phone} />
            <SelectField label={t("settings.userRole")} value={f.values.role} onChange={(v) => f.set("role", v)} options={roleOptions} error={f.errors.role} />
          </div>
          <div className="form-actions"><Button variant="primary" type="submit" disabled={f.submitting}><Icon name="plus" />{t("settings.addUser")}</Button></div>
        </form>
      )}
    </>
  );
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `role_${Date.now()}`;

function RolesTab({ roles, canWrite }: { roles: WorkerRole[]; canWrite: boolean }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const f = useForm({ rows: roles.map((r) => ({ ...r, active: r.active !== false })) });
  const rows = f.values.rows;
  const setRow = (i: number, patch: Partial<WorkerRole>) => f.set("rows", rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <form className="card" noValidate onSubmit={(e) => {
      e.preventDefault();
      void f.submit(async (x) => {
        const next = x.rows.map((r) => ({ ...r, key: r.key || slug(r.label) }));
        await run("updateSettings", { docId: "operations", patch: { workerRoles: next } });
        f.set("rows", next);
        toast(t("settings.saved"));
      });
    }}>
      <h2 className="card-title">{t("settings.roles")}</h2>
      <ErrorSummary summary={f.summary} errors={f.errors} />
      <MiniWrap label={t("settings.roles")}><table className="mini-table">
        <caption className="sr-only">{t("settings.roles")}</caption>
        <thead><tr><th>{t("settings.roleName")}</th><th>{t("settings.roleNameHi")}</th><th>{t("settings.inUse")}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key || `new-${i}`}>
              <td>{canWrite ? <input className="input" aria-label={`${t("settings.roleName")} ${i + 1}`} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} /> : r.label}</td>
              <td>{canWrite ? <input className="input" lang="hi" aria-label={`${t("settings.roleNameHi")} ${i + 1}`} value={r.labelHi ?? ""} onChange={(e) => setRow(i, { labelHi: e.target.value })} /> : (r.labelHi ?? "—")}</td>
              <td>{canWrite
                ? <input type="checkbox" aria-label={`${t("settings.inUse")}: ${r.label || i + 1}`} checked={r.active !== false} onChange={(e) => setRow(i, { active: e.target.checked })} />
                : <StatusBadge kind={r.active !== false ? "active" : "inactive"} />}</td>
            </tr>
          ))}
        </tbody>
      </table></MiniWrap>
      {canWrite && (
        <div className="form-actions">
          <Button type="button" onClick={() => f.set("rows", [...rows, { key: "", label: "", labelHi: "", active: true }])}><Icon name="plus" />{t("settings.addRole")}</Button>
          <Button variant="primary" type="submit" disabled={f.submitting}>{f.submitting ? t("common.saving") : t("common.save")}</Button>
        </div>
      )}
    </form>
  );
}

const MONEY_KEYS = ["missingBillThresholdPaise", "pmApprovalLimitPaise", "autoApproveLimitPaise"] as const;
const INT_KEYS = ["attendanceLockDays", "leadFollowUpHours", "emdRefundAlertDays", "shareLinkDays"] as const;
const OP_LABELS: Record<string, string> = {
  attendanceLockDays: "lockDays", missingBillThresholdPaise: "billThreshold", pmApprovalLimitPaise: "pmLimit", autoApproveLimitPaise: "autoLimit",
  leadFollowUpHours: "followUpHours", emdRefundAlertDays: "emdDays", shareLinkDays: "shareDays",
};

function OperationsTab({ doc, canWrite }: { doc?: Settings; canWrite: boolean }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const f = useForm(Object.fromEntries([
    ...MONEY_KEYS.map((k) => [k, fromPaise(doc?.[k] as number | undefined)]),
    ...INT_KEYS.map((k) => [k, doc?.[k] === undefined ? "" : String(doc[k])]),
  ]) as Record<string, string>);
  return (
    <form className="card" noValidate onSubmit={(e) => {
      e.preventDefault();
      void f.submit(async (x) => {
        const patch: Record<string, number> = {};
        for (const k of MONEY_KEYS) patch[k] = toPaise(x[k] ?? "");
        for (const k of INT_KEYS) { const n = toInt(x[k] ?? ""); if (n !== undefined) patch[k] = n; }
        await run("updateSettings", { docId: "operations", patch });
        toast(t("settings.saved"));
      });
    }}>
      <h2 className="card-title">{t("settings.operations")}</h2>
      <ErrorSummary summary={f.summary} errors={f.errors} />
      <div className="form-grid two" style={{ marginTop: "var(--space-4)" }}>
        {INT_KEYS.slice(0, 1).map((k) => <TextField key={k} label={t(`settings.${OP_LABELS[k]}`)} hint={t("settings.lockDaysHint")} value={f.values[k] ?? ""} onChange={(v) => f.set(k, v)} error={f.errors[k]} inputMode="numeric" disabled={!canWrite} />)}
        {MONEY_KEYS.map((k) => <MoneyField key={k} label={t(`settings.${OP_LABELS[k]}`)} value={f.values[k] ?? ""} onChange={(v) => f.set(k, v)} error={f.errors[k]} disabled={!canWrite} />)}
        {INT_KEYS.slice(1).map((k) => <TextField key={k} label={t(`settings.${OP_LABELS[k]}`)} value={f.values[k] ?? ""} onChange={(v) => f.set(k, v)} error={f.errors[k]} inputMode="numeric" disabled={!canWrite} />)}
      </div>
      {canWrite && <div className="form-actions"><Button variant="primary" type="submit" disabled={f.submitting}>{f.submitting ? t("common.saving") : t("common.save")}</Button></div>}
    </form>
  );
}

function NumberingTab({ doc }: { doc?: Settings }) {
  const { t } = useTranslation();
  const fy = fyOf(todayIST());
  const formats = { ...DEFAULT_FORMATS, ...((doc?.formats as Partial<Record<DocType, string>> | undefined) ?? {}) };
  return (
    <section className="card">
      <h2 className="card-title">{t("settings.numbering")}</h2>
      <p className="hint"><Icon name="info" size={16} /><span>{t("settings.numberingHint")}</span></p>
      <MiniWrap label={t("settings.numbering")}><table className="mini-table">
        <caption className="sr-only">{t("settings.numbering")}</caption>
        <thead><tr><th>{t("settings.docType")}</th><th>{t("settings.format")}</th><th>{t("settings.example")}</th></tr></thead>
        <tbody>
          {(Object.keys(formats) as DocType[]).map((k) => (
            <tr key={k}><td>{t(`settings.docTypes.${k}`)}</td><td><code>{formats[k]}</code></td><td>{formatDocNumber(k, fy, 1, formats[k])}</td></tr>
          ))}
        </tbody>
      </table></MiniWrap>
    </section>
  );
}
