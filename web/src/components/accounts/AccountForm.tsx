"use client";
import { ACCOUNT_TYPES, todayIST, type Account, type AccountType } from "@ag/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess, NotFoundRecord } from "@/components/ModulePage";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Skeleton, useToast } from "@/components/ui/feedback";
import { CheckField, DateField, ErrorSummary, MoneyField, SelectField, TextField, fromDate, fromPaise, toDate, toPaise, useForm } from "@/components/ui/form";
import { useRun, useSmall } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";
import { useParam } from "@/lib/params";
import { AccountsShell, balanceOf, useAccountsAccess, useLang } from "./shared";

interface V { name: string; type: AccountType; bankName: string; last4: string; opening: string; overdrawn: boolean; openingDate: string }

/**
 * Add an account, or change one (spec §12 `accounts`: name, kind, opening balance, opening date, active).
 * The opening balance is typed when adding; afterwards only the owner changes it, with a confirmation, because it
 * moves the balance. An account that is no longer used is closed, never deleted, so its book stays.
 */
export function AccountForm() {
  const { t } = useTranslation();
  const lang = useLang();
  const { canWrite, isOwner, session } = useAccountsAccess();
  const run = useRun();
  const toast = useToast();
  const router = useRouter();
  const id = useParam("id");
  const accounts = useSmall<Account>("accounts");
  const existing = id ? accounts?.find((a) => a.id === id) ?? null : null;
  const f = useForm<V>({ name: "", type: "bank", bankName: "", last4: "", opening: "", overdrawn: false, openingDate: fromDate(todayIST()) });
  const v = f.values;
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (!existing || loaded === existing.id) return;
    f.setAll({
      name: existing.name, type: existing.type, bankName: existing.bankName ?? "", last4: existing.last4 ?? "",
      opening: fromPaise(Math.abs(existing.openingBalancePaise)), overdrawn: existing.openingBalancePaise < 0, openingDate: fromDate(existing.openingDate),
    });
    setLoaded(existing.id);
  }, [existing, loaded, f]);
  const [askOpening, setAskOpening] = useState(false);
  const [askClose, setAskClose] = useState(false);

  const title = id ? t("accounts.form.editTitle") : t("accounts.form.addTitle");
  if (session && !canWrite) return <AccountsShell title={title}><NoAccess name={title} /></AccountsShell>;
  if (id === undefined || (id && accounts === undefined)) return <AccountsShell title={title}><Skeleton lines={5} /></AccountsShell>;
  if (id && !existing) return <AccountsShell title={title}><NotFoundRecord name={t("accounts.book.notFound")} back="/accounts/" backLabel={t("accounts.back")} /></AccountsShell>;

  const openingPaise = () => { const p = toPaise(v.opening); return v.overdrawn && v.type !== "cash" ? -p : p; };
  const save = () => f.submit(async (x) => {
    await run("saveAccount", {
      id: existing?.id ?? null, name: x.name, type: x.type, bankName: x.bankName, last4: x.last4,
      openingBalancePaise: openingPaise(), openingDate: toDate(x.openingDate),
    });
    toast(t("accounts.form.saved"));
    router.push("/accounts/");
  });
  const saveOpening = async () => {
    const ok = await f.submit(async (x) => {
      const r = await run("setOpeningBalance", { id: existing!.id, openingBalancePaise: openingPaise(), openingDate: toDate(x.openingDate) });
      toast(r.changed ? t("accounts.form.openingSaved") : t("accounts.form.openingSame"));
    });
    if (ok) setLoaded(null); // reload the saved values into the form
  };
  const setClosed = async (archived: boolean) => {
    try {
      await run("archiveAccount", { id: existing!.id, archived });
      toast(archived ? t("accounts.form.closed") : t("accounts.form.reopened"));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const openingFields = (
    <>
      <MoneyField label={t("accounts.form.opening")} hint={t("accounts.form.openingHint")} value={v.opening} onChange={(x) => f.set("opening", x)} error={f.errors.openingBalancePaise} />
      <DateField label={t("accounts.form.openingDate")} hint={t("accounts.form.openingDateHint")} value={v.openingDate} onChange={(x) => f.set("openingDate", x)} error={f.errors.openingDate} />
      {v.type !== "cash" && <CheckField label={t("accounts.form.overdrawn")} checked={v.overdrawn} onChange={(x) => f.set("overdrawn", x)} />}
    </>
  );

  return (
    <AccountsShell title={title}>
      <div className="page-head"><div className="heading"><h1>{existing ? existing.name : title}</h1></div></div>
      <form className="card acc-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} data-account-form>
        <ErrorSummary summary={f.summary} errors={f.errors} />
        <div className="form-section">
          <h2>{t("accounts.form.details")}</h2>
          <div className="form-grid two">
            <TextField label={t("accounts.form.name")} hint={t("accounts.form.nameHint")} value={v.name} onChange={(x) => f.set("name", x)} error={f.errors.name} required />
            <SelectField label={t("accounts.form.type")} value={v.type} onChange={(x) => f.set("type", x)} error={f.errors.type}
              options={ACCOUNT_TYPES.map((x) => ({ value: x, label: t(`accounts.types.${x}`) }))} />
            {v.type !== "cash" && <>
              <TextField label={t("accounts.form.bankName")} hint={t("accounts.form.bankNameHint")} value={v.bankName} onChange={(x) => f.set("bankName", x)} error={f.errors.bankName} required={v.type === "bank"} />
              <TextField label={t("accounts.form.last4")} hint={t("accounts.form.last4Hint")} value={v.last4} onChange={(x) => f.set("last4", x)} error={f.errors.last4} inputMode="numeric" />
            </>}
            {!existing && openingFields}
          </div>
        </div>
        <div className="form-actions">
          <Link className="btn btn-secondary" href="/accounts/">{t("common.cancel")}</Link>
          <Button variant="primary" type="submit" disabled={f.submitting} data-save>{f.submitting ? t("common.saving") : t("accounts.form.save")}</Button>
        </div>
      </form>

      {existing && (
        <section className="card acc-subcard" aria-labelledby="acc-opening-title" data-opening>
          <h2 className="card-title" id="acc-opening-title">{t("accounts.form.openingTitle")}</h2>
          <p>{t("accounts.form.openingNow", { amount: money(existing.openingBalancePaise), date: date(existing.openingDate, lang) })}</p>
          {isOwner ? (
            <>
              <div className="form-grid two" style={{ marginTop: "var(--space-4)" }}>{openingFields}</div>
              <div className="form-actions"><Button variant="secondary" onClick={() => setAskOpening(true)} disabled={f.submitting}>{t("accounts.form.openingSave")}</Button></div>
            </>
          ) : <p className="hint"><Icon name="info" size={16} /><span>{t("accounts.form.openingOwnerOnly")}</span></p>}
        </section>
      )}

      {existing && (
        <section className="card acc-subcard" aria-labelledby="acc-status-title" data-status>
          <h2 className="card-title" id="acc-status-title">{t("accounts.form.statusTitle")}</h2>
          <p className="muted">{existing.active === false ? t("accounts.form.reopenHint") : t("accounts.form.closeHint")}</p>
          <div className="form-actions">
            {existing.active === false
              ? <Button variant="secondary" onClick={() => void setClosed(false)}><Icon name="reset" />{t("accounts.form.reopen")}</Button>
              : <Button variant="destructive" onClick={() => setAskClose(true)}><Icon name="archive" />{t("accounts.form.close")}</Button>}
          </div>
        </section>
      )}

      {existing && (
        <>
          <ConfirmDialog open={askOpening} onOpenChange={setAskOpening} destructive={false} title={t("accounts.form.openingConfirmTitle")}
            body={t("accounts.form.openingConfirmBody", { name: existing.name, next: Number.isFinite(openingPaise()) ? money(openingPaise()) : v.opening, date: v.openingDate, old: money(existing.openingBalancePaise) })}
            confirmLabel={t("accounts.form.openingConfirm")} onConfirm={saveOpening} />
          <ConfirmDialog open={askClose} onOpenChange={setAskClose} title={t("accounts.form.closeTitle", { name: existing.name })}
            body={`${t("accounts.form.closeBody")} ${t("accounts.book.balanceNow")}: ${money(balanceOf(existing))}.`} confirmLabel={t("accounts.form.closeConfirm")} onConfirm={() => setClosed(true)} />
        </>
      )}
    </AccountsShell>
  );
}
