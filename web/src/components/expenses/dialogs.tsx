"use client";
// The confirmations of the expense screens: approve (one or several, choosing the paid-from account when it is
// missing), reject with a reason, delete with a reason, and mark a credit purchase as paid. Each asks before money
// moves or a record is deleted, and shows the command's own words when it refuses.
import { CommandError, isFinanceRole, todayIST, type ExpenseRecord, type PaymentMode } from "@ag/core";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AccountPicker } from "@/components/accounts/AccountPicker";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/feedback";
import { DateField, SelectField, TextField, fromDate, toDate } from "@/components/ui/form";
import { useRun, useSession } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";
import { PAID_MODES, useLang } from "./common";

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const go = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFields({});
    try { await fn(); onDone(); } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof CommandError) setFields(e.fields);
    } finally { setBusy(false); }
  };
  return { busy, error, fields, go };
}

function Problem({ text }: { text: string | null }) {
  return text ? <div className="banner error" role="alert"><Icon name="alert" /><span className="text">{text}</span></div> : null;
}

function Shell({ open, onClose, title, description, children }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={title} description={description}>{open ? children : null}</DialogContent>
    </Dialog>
  );
}

/** One line that says which entry this is: amount, who was paid, and the day. */
export function useEntryLine(): (e: Pick<ExpenseRecord, "amountPaise" | "payeeName" | "description" | "date">) => string {
  const lang = useLang();
  return (e) => [money(e.amountPaise), e.payeeName || e.description, date(e.date, lang)].filter(Boolean).join(" · ");
}

// ---------- approve ----------
export function ApproveExpensesDialog({ items, onClose, onDone }: { items: ExpenseRecord[] | null; onClose: () => void; onDone?: (approved: number) => void }) {
  const { t } = useTranslation();
  const line = useEntryLine();
  const list = items ?? [];
  const total = list.reduce((s, e) => s + e.amountPaise, 0);
  return (
    <Shell open={!!items?.length} onClose={onClose}
      title={list.length === 1 ? t("expenses.approve.titleOne") : t("expenses.approve.titleMany", { n: list.length })}
      description={list.length === 1 ? line(list[0]!) : t("expenses.approve.bodyMany", { n: list.length, total: money(total) })}>
      <ApproveBody key={list.map((e) => e.id).join(",")} items={list} onClose={onClose} onDone={onDone} />
    </Shell>
  );
}

function ApproveBody({ items, onClose, onDone }: { items: ExpenseRecord[]; onClose: () => void; onDone?: (approved: number) => void }) {
  const { t } = useTranslation();
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const [accountId, setAccountId] = useState("");
  const a = useAction(onClose);
  const finance = !!session && isFinanceRole(session.role);
  const noAccount = items.filter((e) => e.mode !== "credit" && !e.accountId).length;
  const askAccount = finance && noAccount > 0;
  return (
    <>
      <p className="hint"><Icon name="info" size={16} /><span>{t("expenses.approve.counts")}</span></p>
      {askAccount && (
        <AccountPicker value={accountId} onChange={setAccountId} label={t("expenses.form.paidFrom")} required error={a.fields.accountId}
          hint={items.length === 1 ? t("expenses.approve.accountHintOne") : t("expenses.approve.accountHintMany", { n: noAccount })} />
      )}
      <Problem text={a.fields.accountId && askAccount ? null : a.error} />
      <DialogActions>
        <DialogClose asChild><Button variant="secondary">{t("common.goBack")}</Button></DialogClose>
        <Button variant="primary" disabled={a.busy || (askAccount && !accountId)} data-confirm-approve
          onClick={() => void a.go(async () => {
            const r = await run("approveExpenses", { ids: items.map((e) => e.id), accountId: askAccount ? accountId : null });
            toast(r.approved === 1 ? t("expenses.approve.doneOne") : t("expenses.approve.doneMany", { n: r.approved }));
            onDone?.(r.approved);
          })}>
          {a.busy ? t("common.working") : items.length === 1 ? t("expenses.approve.action") : t("expenses.approve.actionMany", { n: items.length })}
        </Button>
      </DialogActions>
    </>
  );
}

// ---------- reject ----------
export function RejectExpenseDialog({ expense, onClose, onDone }: { expense: ExpenseRecord | null; onClose: () => void; onDone?: () => void }) {
  const { t } = useTranslation();
  const line = useEntryLine();
  return (
    <Shell open={!!expense} onClose={onClose} title={t("expenses.reject.title")} description={expense ? `${line(expense)}. ${t("expenses.reject.body")}` : undefined}>
      {expense && <ReasonBody key={expense.id} label={t("expenses.reject.reason")} hint={t("expenses.reject.reasonHint")} confirm={t("expenses.reject.action")} onClose={onClose}
        act={async (reason, run, toast) => { await run("rejectExpense", { id: expense.id, reason }); toast(t("expenses.reject.done")); onDone?.(); }} />}
    </Shell>
  );
}

// ---------- delete ----------
export function DeleteExpenseDialog({ expense, onClose, onDone }: { expense: ExpenseRecord | null; onClose: () => void; onDone?: () => void }) {
  const { t } = useTranslation();
  const line = useEntryLine();
  return (
    <Shell open={!!expense} onClose={onClose} title={t("expenses.delete.title")}
      description={expense ? `${line(expense)}. ${expense.approvalStatus === "approved" ? t("expenses.delete.bodyApproved") : t("expenses.delete.body")}` : undefined}>
      {expense && <ReasonBody key={expense.id} label={t("expenses.delete.reason")} hint={t("expenses.delete.reasonHint")} confirm={t("expenses.delete.action")} onClose={onClose}
        act={async (reason, run, toast) => { await run("deleteExpense", { id: expense.id, reason }); toast(t("expenses.delete.done")); onDone?.(); }} />}
    </Shell>
  );
}

function ReasonBody({ label, hint, confirm, act, onClose }: {
  label: string; hint: string; confirm: string; onClose: () => void;
  act: (reason: string, run: ReturnType<typeof useRun>, toast: ReturnType<typeof useToast>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const a = useAction(onClose);
  return (
    <>
      <TextField label={label} hint={hint} value={reason} onChange={setReason} required error={a.fields.reason} />
      <Problem text={a.fields.reason ? null : a.error} />
      <DialogActions>
        <DialogClose asChild><Button variant="secondary">{t("common.goBack")}</Button></DialogClose>
        <Button variant="destructive" disabled={a.busy || reason.trim().length < 3} data-confirm-reason onClick={() => void a.go(() => act(reason, run, toast))}>
          {a.busy ? t("common.working") : confirm}
        </Button>
      </DialogActions>
    </>
  );
}

// ---------- mark a credit purchase as paid ----------
export function MarkPaidDialog({ expense, onClose, onDone }: { expense: ExpenseRecord | null; onClose: () => void; onDone?: () => void }) {
  const { t } = useTranslation();
  const line = useEntryLine();
  return (
    <Shell open={!!expense} onClose={onClose} title={t("expenses.paid.title")} description={expense ? `${line(expense)}. ${t("expenses.paid.body")}` : undefined}>
      {expense && <PaidBody key={expense.id} expense={expense} onClose={onClose} onDone={onDone} />}
    </Shell>
  );
}

function PaidBody({ expense, onClose, onDone }: { expense: ExpenseRecord; onClose: () => void; onDone?: () => void }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const [day, setDay] = useState(fromDate(todayIST()));
  const [mode, setMode] = useState<PaymentMode>("bank");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const a = useAction(onClose);
  const fieldError = a.fields.date || a.fields.mode || a.fields.accountId;
  return (
    <>
      <div className="form-grid">
        <DateField label={t("expenses.paid.date")} value={day} onChange={setDay} error={a.fields.date} required />
        <SelectField label={t("expenses.form.mode")} value={mode} onChange={setMode} error={a.fields.mode}
          options={PAID_MODES.map((m) => ({ value: m, label: t(`expenses.modes.${m}`) }))} />
        <AccountPicker value={accountId} onChange={setAccountId} label={t("expenses.form.paidFrom")} required error={a.fields.accountId} />
        <TextField label={t("expenses.paid.reference")} hint={t("expenses.paid.referenceHint")} value={reference} onChange={setReference} />
      </div>
      <Problem text={fieldError ? null : a.error} />
      <DialogActions>
        <DialogClose asChild><Button variant="secondary">{t("common.goBack")}</Button></DialogClose>
        <Button variant="primary" disabled={a.busy || !accountId} data-confirm-paid
          onClick={() => void a.go(async () => {
            await run("markExpensePaid", { id: expense.id, date: toDate(day), mode, accountId, reference });
            toast(t("expenses.paid.done", { amount: money(expense.amountPaise) }));
            onDone?.();
          })}>
          {a.busy ? t("common.working") : t("expenses.paid.action")}
        </Button>
      </DialogActions>
    </>
  );
}
