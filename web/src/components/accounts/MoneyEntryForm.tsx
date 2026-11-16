"use client";
import { ENTRY_DIRECTION, availableEntryKinds, todayIST, validateMove, type Account, type MoneyEntryKind } from "@ag/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useToast } from "@/components/ui/feedback";
import { DateField, ErrorSummary, MoneyField, SelectField, TextField, fromDate, toDate, toPaise, useForm } from "@/components/ui/form";
import { useRun, useSmall } from "@/data/DataProvider";
import { money } from "@/lib/fmt";
import { useParam } from "@/lib/params";
import { AccountPicker } from "./AccountPicker";
import { AccountsShell, balanceOf, showDate, useAccountsAccess, useLang } from "./shared";

interface V { kind: MoneyEntryKind; accountId: string; partyName: string; amount: string; date: string; note: string; reference: string }

/**
 * Money that is neither an expense nor a client payment (spec §11A.4): owner's drawings, capital introduced, loans
 * taken and repaid, bank charges and interest received. One account, money in or out, confirmed before it is saved.
 */
export function MoneyEntryForm() {
  const { t } = useTranslation();
  const lang = useLang();
  const { canWrite, session } = useAccountsAccess();
  const run = useRun();
  const toast = useToast();
  const router = useRouter();
  const kindParam = useParam("kind");
  const accounts = useSmall<Account>("accounts");
  const kinds = useMemo(() => availableEntryKinds(), []);
  const f = useForm<V>({ kind: "drawing", accountId: "", partyName: "", amount: "", date: fromDate(todayIST()), note: "", reference: "" });
  const v = f.values;
  const [fromUrl, setFromUrl] = useState(false);
  useEffect(() => {
    if (fromUrl || !kindParam) return;
    if ((kinds as string[]).includes(kindParam)) f.set("kind", kindParam as MoneyEntryKind);
    setFromUrl(true);
  }, [kindParam, fromUrl, kinds, f]);
  const [ask, setAsk] = useState(false);
  const title = t("accounts.entry.title");
  if (session && !canWrite) return <AccountsShell title={title}><NoAccess name={title} /></AccountsShell>;

  const out = ENTRY_DIRECTION[v.kind] === "out";
  const bankOnly = v.kind === "bank_charge" || v.kind === "interest_in";
  const account = accounts?.find((a) => a.id === v.accountId) ?? null;
  const amountPaise = toPaise(v.amount);
  const needsParty = v.kind === "loan_in" || v.kind === "loan_repay";

  const check = () => {
    const errors = validateMove({ kind: v.kind, from: out ? account : null, to: out ? null : account, amountPaise, date: toDate(v.date), partyName: v.partyName, today: todayIST() });
    f.setErrors(errors, Object.keys(errors).length ? t("form.fixCount", { n: Object.keys(errors).length }) : null);
    if (!Object.keys(errors).length) setAsk(true);
  };
  const save = async () => {
    await f.submit(async (x) => {
      await run("createMoneyEntry", { kind: x.kind, accountId: x.accountId, amountPaise: toPaise(x.amount), date: toDate(x.date), partyName: x.partyName, note: x.note, reference: x.reference });
      toast(t("accounts.entry.saved"));
      router.push("/accounts/entries/");
    });
  };
  const after = account && Number.isFinite(amountPaise) ? money(balanceOf(account) + (out ? -amountPaise : amountPaise)) : "";

  return (
    <AccountsShell title={title}>
      <div className="page-head"><div className="heading"><h1>{title}</h1><p className="sub">{t("accounts.entry.sub")}</p></div></div>
      <form className="card acc-form" noValidate onSubmit={(e) => { e.preventDefault(); check(); }} data-entry-form>
        <ErrorSummary summary={f.summary} errors={f.errors} />
        <div className="form-grid two">
          <SelectField label={t("accounts.entry.kind")} value={v.kind} onChange={(x) => { f.set("kind", x); f.set("accountId", ""); }} error={f.errors.kind}
            options={kinds.map((k) => ({ value: k, label: t(`accounts.entry.kinds.${k}`) }))} hint={v.kind === "bank_charge" ? t("accounts.entry.bankChargeNote") : undefined} />
          <AccountPicker label={out ? t("accounts.entry.accountOut") : t("accounts.entry.accountIn")} value={v.accountId} onChange={(x) => f.set("accountId", x)}
            error={f.errors.accountId} types={bankOnly ? ["bank", "upi"] : undefined} showBalance required />
          <TextField label={t(`accounts.entry.party.${v.kind}`)} hint={t("accounts.entry.partyHint")} value={v.partyName} onChange={(x) => f.set("partyName", x)} error={f.errors.partyName} required={needsParty} />
          <MoneyField label={t("accounts.entry.amount")} value={v.amount} onChange={(x) => f.set("amount", x)} error={f.errors.amountPaise} required />
          <DateField label={t("accounts.entry.date")} value={v.date} onChange={(x) => f.set("date", x)} error={f.errors.date} required />
          <TextField label={t("accounts.entry.reference")} hint={t("accounts.entry.referenceHint")} value={v.reference} onChange={(x) => f.set("reference", x)} />
          <div className="span-2"><TextField label={t("accounts.entry.note")} hint={t("accounts.entry.noteHint")} value={v.note} onChange={(x) => f.set("note", x)} /></div>
        </div>
        <div className="form-actions">
          <Link className="btn btn-secondary" href="/accounts/">{t("common.cancel")}</Link>
          <Button variant="primary" type="submit" disabled={f.submitting} data-save><Icon name="check" />{f.submitting ? t("common.saving") : t("accounts.entry.save")}</Button>
        </div>
      </form>
      <ConfirmDialog open={ask} onOpenChange={setAsk} destructive={false}
        title={t("accounts.entry.confirmTitle", { kind: t(`accounts.entry.short.${v.kind}`), amount: Number.isFinite(amountPaise) ? money(amountPaise) : "" })}
        body={account && Number.isFinite(amountPaise) ? t(out ? "accounts.entry.confirmOut" : "accounts.entry.confirmIn", { amount: money(amountPaise), account: account.name, date: showDate(v.date, lang), after }) : ""}
        confirmLabel={t("accounts.entry.confirm")} onConfirm={save} />
    </AccountsShell>
  );
}
