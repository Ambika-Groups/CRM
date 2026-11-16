"use client";
import { todayIST, validateMove, type Account } from "@ag/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useToast } from "@/components/ui/feedback";
import { DateField, ErrorSummary, MoneyField, TextField, fromDate, toDate, toPaise, useForm } from "@/components/ui/form";
import { useRun, useSmall } from "@/data/DataProvider";
import { money } from "@/lib/fmt";
import { useParam } from "@/lib/params";
import { AccountPicker } from "./AccountPicker";
import { AccountsShell, balanceOf, showDate, useAccountsAccess, useLang } from "./shared";

interface V { fromAccountId: string; toAccountId: string; amount: string; date: string; note: string; reference: string }

/**
 * Move money between two of the company's own accounts (spec §11A.4: cash deposited to bank, ATM withdrawal).
 * Not an expense and not income: one line leaves one book and one line enters the other. The person sees what
 * each account will hold afterwards and confirms before anything moves.
 */
export function TransferForm() {
  const { t } = useTranslation();
  const lang = useLang();
  const { canWrite, session } = useAccountsAccess();
  const run = useRun();
  const toast = useToast();
  const router = useRouter();
  const fromParam = useParam("from");
  const accounts = useSmall<Account>("accounts");
  const f = useForm<V>({ fromAccountId: "", toAccountId: "", amount: "", date: fromDate(todayIST()), note: "", reference: "" });
  const v = f.values;
  const [ask, setAsk] = useState(false);
  const title = t("accounts.transfer.title");
  if (session && !canWrite) return <AccountsShell title={title}><NoAccess name={title} /></AccountsShell>;

  const fromId = v.fromAccountId || (fromParam && accounts?.some((a) => a.id === fromParam && a.active !== false) ? fromParam : "");
  const from = accounts?.find((a) => a.id === fromId) ?? null;
  const to = accounts?.find((a) => a.id === v.toAccountId) ?? null;
  const amountPaise = toPaise(v.amount);
  const usable = (accounts ?? []).filter((a) => a.active !== false).length;

  const check = () => {
    const errors = validateMove({ kind: "transfer", from, to, amountPaise, date: toDate(v.date), today: todayIST() });
    f.setErrors(errors, Object.keys(errors).length ? t("form.fixCount", { n: Object.keys(errors).length }) : null);
    if (!Object.keys(errors).length) setAsk(true);
  };
  const save = async () => {
    await f.submit(async (x) => {
      const r = await run("createTransfer", { fromAccountId: fromId, toAccountId: x.toAccountId, amountPaise: toPaise(x.amount), date: toDate(x.date), note: x.note, reference: x.reference });
      toast(r.cashBelowZero ? t("accounts.transfer.cashBelowZero") : t("accounts.transfer.saved"), r.cashBelowZero ? "error" : "success");
      router.push("/accounts/");
    });
  };

  return (
    <AccountsShell title={title}>
      <div className="page-head"><div className="heading"><h1>{title}</h1><p className="sub">{t("accounts.transfer.sub")}</p></div></div>
      {accounts && usable < 2 ? (
        <div className="banner warning"><Icon name="alert" /><div className="text">{t("accounts.transfer.needTwo")} <Link href="/accounts/edit/">{t("accounts.actions.add")}</Link></div></div>
      ) : (
        <form className="card acc-form" noValidate onSubmit={(e) => { e.preventDefault(); check(); }} data-transfer-form>
          <ErrorSummary summary={f.summary} errors={f.errors} />
          <div className="form-grid two">
            <AccountPicker label={t("accounts.transfer.from")} value={fromId} onChange={(x) => { f.set("fromAccountId", x); if (x && x === v.toAccountId) f.set("toAccountId", ""); }} error={f.errors.fromAccountId} showBalance required />
            <AccountPicker label={t("accounts.transfer.to")} value={v.toAccountId} onChange={(x) => f.set("toAccountId", x)} error={f.errors.toAccountId} excludeId={fromId || null} showBalance required />
            <MoneyField label={t("accounts.transfer.amount")} value={v.amount} onChange={(x) => f.set("amount", x)} error={f.errors.amountPaise} required />
            <DateField label={t("accounts.transfer.date")} value={v.date} onChange={(x) => f.set("date", x)} error={f.errors.date} required />
            <TextField label={t("accounts.transfer.note")} hint={t("accounts.transfer.noteHint")} value={v.note} onChange={(x) => f.set("note", x)} />
            <TextField label={t("accounts.transfer.reference")} hint={t("accounts.transfer.referenceHint")} value={v.reference} onChange={(x) => f.set("reference", x)} />
          </div>
          <div className="form-actions">
            <Link className="btn btn-secondary" href="/accounts/">{t("common.cancel")}</Link>
            <Button variant="primary" type="submit" disabled={f.submitting} data-save><Icon name="switch" />{f.submitting ? t("common.saving") : t("accounts.transfer.save")}</Button>
          </div>
        </form>
      )}
      <ConfirmDialog open={ask} onOpenChange={setAsk} destructive={false} title={t("accounts.transfer.confirmTitle", { amount: Number.isFinite(amountPaise) ? money(amountPaise) : "" })}
        body={from && to && Number.isFinite(amountPaise) ? t("accounts.transfer.confirmBody", {
          from: from.name, to: to.name, date: showDate(v.date, lang), fromAfter: money(balanceOf(from) - amountPaise), toAfter: money(balanceOf(to) + amountPaise),
        }) : ""}
        confirmLabel={t("accounts.transfer.confirm")} onConfirm={save} />
    </AccountsShell>
  );
}
