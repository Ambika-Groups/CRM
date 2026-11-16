"use client";
// The paid-from / received-into account picker every money form uses (spec §11A.4: every expense and payment
// carries the cash box, bank account or UPI account the money moved through).
//   <AccountPicker value={accountId} onChange={setAccountId} label="Paid from" required />
// It lists the active accounts the signed-in person may see. People who can't see accounts (site roles) get a
// switched-off field with a plain note, so their form still saves and the accountant fills the account in later.
import { isFinanceReader, type Account } from "@ag/core";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/ui/form";
import { useSession, useSmall } from "@/data/DataProvider";
import { money } from "@/lib/fmt";

export type AccountType = Account["type"];

export interface AccountPickerProps {
  /** The chosen account id ("" or null when nothing is chosen yet). */
  value: string | null | undefined;
  onChange: (accountId: string) => void;
  label: string;
  required?: boolean;
  /** Only these kinds of account, e.g. ["cash"] or ["bank", "upi"]. Default: all. */
  types?: readonly AccountType[];
  /** Show each account's balance next to its name. */
  showBalance?: boolean;
  disabled?: boolean;
  error?: string;
  hint?: string;
  /** Leave one account out (the other side of a transfer). */
  excludeId?: string | null;
  /** First line of the list. Default: "Choose the account". */
  placeholder?: string;
}

/** The label of an account in lists: "SBI current account ··4821". */
export function accountLabel(a: Pick<Account, "name" | "last4">): string {
  return a.last4 ? `${a.name} ··${a.last4}` : a.name;
}

export function AccountPicker({ value, onChange, label, required, types, showBalance, disabled, error, hint, excludeId, placeholder }: AccountPickerProps) {
  const { t } = useTranslation();
  const session = useSession();
  const all = useSmall<Account & { isDeleted?: boolean }>("accounts");
  const maySee = !session || isFinanceReader(session.role);
  const current = value ?? "";
  const list = (all ?? [])
    .filter((a) => !a.isDeleted && (a.active !== false || a.id === current))
    .filter((a) => !types || types.includes(a.type) || a.id === current)
    .filter((a) => !excludeId || a.id !== excludeId)
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "cash" ? -1 : b.type === "cash" ? 1 : a.type.localeCompare(b.type)));
  const options = list.map((a) => ({
    value: a.id,
    label: `${accountLabel(a)}${a.active === false ? ` (${t("accounts.picker.closed", { defaultValue: "closed" })})` : ""}${showBalance ? ` · ${money(a.balancePaise ?? a.openingBalancePaise)}` : ""}`,
  }));
  const noAccounts = maySee && all !== undefined && options.length === 0;
  const note = !maySee
    ? t("accounts.picker.notYourRole", { defaultValue: "The accountant chooses the account when checking this entry." })
    : noAccounts
      ? t("accounts.picker.none", { defaultValue: "No account yet. Add one under Accounts first." })
      : hint;
  return (
    <SelectField
      label={label} value={current} onChange={onChange} options={options} required={required && maySee} error={maySee ? error : undefined} hint={note}
      disabled={disabled || !maySee || all === undefined || noAccounts}
      placeholder={all === undefined && maySee ? t("common.loading") : placeholder ?? t("accounts.picker.choose", { defaultValue: "Choose the account" })}
    />
  );
}
