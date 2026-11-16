"use client";
import { MONEY_ENTRY_KINDS, type Account, type MoneyEntry } from "@ag/core";
import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/feedback";
import { TextField } from "@/components/ui/form";
import { useRun, useSmall } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";
import { AccountsShell, useAccountsAccess, useLang } from "./shared";

const KINDS = ["transfer", ...MONEY_ENTRY_KINDS] as const;

/**
 * Every transfer and other money entry (spec §11A.4), newest first, with who entered it. An entry is never edited or
 * deleted: it is cancelled with a reason, which reverses it exactly and leaves it on record (§3.1 rule 12).
 */
export function EntriesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const { canWrite } = useAccountsAccess();
  const run = useRun();
  const toast = useToast();
  const accounts = useSmall<Account>("accounts");
  const name = (id?: string | null) => (id ? accounts?.find((a) => a.id === id)?.name ?? "" : "");
  const [cancel, setCancel] = useState<MoneyEntry | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const title = t("accounts.entries.title");
  const kindLabel = (k: string) => t(`accounts.entry.short.${k}`);

  const doCancel = async () => {
    if (!cancel) return;
    setBusy(true);
    try {
      await run(cancel.kind === "transfer" ? "cancelTransfer" : "cancelMoneyEntry", { id: cancel.id, reason });
      toast(t("accounts.entries.cancelDone"));
      setCancel(null); setReason("");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountsShell title={title} actionBar={canWrite}>
      <div className="page-head">
        <div className="heading"><h1>{title}</h1></div>
        {canWrite && (
          <div className="page-actions">
            <Link className="btn btn-secondary" href="/accounts/entry/"><Icon name="rupee" />{t("accounts.actions.entry")}</Link>
            <span className="action-bar"><Link className="btn btn-primary" href="/accounts/transfer/"><Icon name="switch" />{t("accounts.actions.transfer")}</Link></span>
          </div>
        )}
      </div>
      <DataTable<MoneyEntry>
        id="account-entries" collection="account_transfers" caption={title} exportName="transfers-and-entries" defaultSort={{ field: "date", dir: "desc" }} searchable={false}
        filters={[{ key: "kind", label: t("accounts.entries.kind"), options: KINDS.map((k) => ({ value: k, label: kindLabel(k) })), where: (v) => ({ field: "kind", op: "==", value: v }) }]}
        columns={[
          { key: "date", header: t("accounts.entries.date"), cell: (e) => date(e.date, lang), csv: (e) => e.date, sortField: "date" },
          { key: "voucherNo", header: t("accounts.entries.voucherNo"), cell: (e) => (e as { voucherNo?: string | null }).voucherNo || "—", csv: (e) => (e as { voucherNo?: string | null }).voucherNo ?? "" },
          { key: "what", header: t("accounts.entries.what"), cell: (e) => kindLabel(e.kind), cardHead: true },
          { key: "details", header: t("accounts.entries.details"), cell: (e) => e.narration ?? "" },
          { key: "from", header: t("accounts.entries.from"), cell: (e) => name(e.fromAccountId) || "—", csv: (e) => name(e.fromAccountId) },
          { key: "to", header: t("accounts.entries.to"), cell: (e) => name(e.toAccountId) || "—", csv: (e) => name(e.toAccountId) },
          { key: "amount", header: t("accounts.entries.amount"), cell: (e) => money(e.amountPaise), csv: (e) => e.amountPaise / 100, align: "right", sortField: "amountPaise" },
          { key: "by", header: t("accounts.entries.by"), cell: (e) => e.enteredByName ?? "", defaultHidden: true },
          { key: "status", header: t("accounts.entries.status"), csv: (e) => (e.isDeleted ? "cancelled" : "saved"),
            cell: (e) => (e.isDeleted ? <span className="badge neutral" title={e.deleteReason}><Icon name="x" size={14} />{t("accounts.entries.cancelled")}</span> : <span className="badge success"><Icon name="check-circle" size={14} />{t("accounts.entries.saved")}</span>) },
        ]}
        rowActions={canWrite ? [{ label: t("accounts.entries.cancel"), destructive: true, hidden: (e) => !!e.isDeleted, onSelect: (e) => setCancel(e) }] : undefined}
        empty={{ title: t("accounts.entries.empty"), body: t("accounts.entries.emptyBody") }}
      />

      <Dialog open={!!cancel} onOpenChange={(o) => { if (!o) { setCancel(null); setReason(""); } }}>
        <DialogContent title={t("accounts.entries.cancelTitle")}
          description={cancel ? t("accounts.entries.cancelBody", { what: kindLabel(cancel.kind), amount: money(cancel.amountPaise), date: date(cancel.date, lang) }) : ""}>
          <TextField label={t("accounts.entries.reason")} hint={t("accounts.entries.reasonHint")} value={reason} onChange={setReason} required />
          <DialogActions>
            <DialogClose asChild><Button variant="secondary">{t("common.goBack")}</Button></DialogClose>
            <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => void doCancel()} data-cancel-confirm>{busy ? t("common.working") : t("accounts.entries.cancelConfirm")}</Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </AccountsShell>
  );
}
