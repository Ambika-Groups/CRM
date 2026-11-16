"use client";
// Recurring expenses (spec §7.2 "Recurring expense templates, e.g. monthly rent"): the owner and accountant set up an
// expense that repeats every month or every week, pause it, and create the entries that are due. The same run happens
// every night; the button here is the catch-up.
import {
  EXPENSE_GST_RATES_BP, formatBp, isFinanceRole, splitExpenseGst, templateDueNow, templateNextDue, todayIST,
  type ExpenseTemplate, type PaymentMode, type RecurringRun,
} from "@ag/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountPicker } from "@/components/accounts/AccountPicker";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, EmptyState, Skeleton, useToast } from "@/components/ui/feedback";
import { DateField, ErrorSummary, MoneyField, SelectField, TextField, fromDate, fromPaise, toDate, toPaise, useForm } from "@/components/ui/form";
import { useOnline, useRead, useRun, useSession } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";
import { ALL_MODES, CategoryPicker, ExpenseTabs, OFFICE, categoryLabel, useCategoryTree, useLang, useMyProjects } from "./common";

interface V {
  name: string; projectId: string; categoryId: string; description: string; amount: string; gstRate: string; gstHow: "in" | "ex";
  payeeName: string; mode: PaymentMode; accountId: string; frequency: "monthly" | "weekly"; dayOfMonth: string; weekday: string; startDate: string; endDate: string;
}
const blank = (): V => ({
  name: "", projectId: OFFICE, categoryId: "", description: "", amount: "", gstRate: "0", gstHow: "in", payeeName: "", mode: "bank", accountId: "",
  frequency: "monthly", dayOfMonth: "1", weekday: "1", startDate: fromDate(todayIST()), endDate: "",
});
const fromTemplate = (x: ExpenseTemplate): V => ({
  name: x.name, projectId: x.projectId ?? OFFICE, categoryId: x.categoryId, description: x.description ?? "", amount: fromPaise(x.amountPaise), gstRate: String(x.gstRateBp ?? 0),
  gstHow: x.gstInclusive === false ? "ex" : "in", payeeName: x.payeeName ?? "", mode: x.mode, accountId: x.accountId ?? "", frequency: x.frequency,
  dayOfMonth: String(x.dayOfMonth ?? 1), weekday: String(x.weekday ?? 1), startDate: fromDate(x.startDate), endDate: fromDate(x.endDate),
});

export function RecurringPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const online = useOnline();
  const tree = useCategoryTree();
  const projects = useMyProjects();
  const finance = !!session && isFinanceRole(session.role);
  const list = useRead(`exp-templates:${finance}`, (s) => (finance
    ? s.query<ExpenseTemplate>("expense_templates", { orderBy: [{ field: "name" }], limit: 50 })
    : Promise.resolve({ items: [] as ExpenseTemplate[], next: null, total: 0 })));
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [lastRun, setLastRun] = useState<RecurringRun | null>(null);
  const f = useForm<V>(blank());
  const v = f.values;

  const title = t("expenses.recurring.title");
  const crumbs = [{ label: t("nav.expenses"), href: "/expenses/" }, { label: title }];
  if (session && !finance) return <AppShell nav="expenses" title={title} crumbs={crumbs}><NoAccess name={title} /></AppShell>;

  const today = todayIST();
  const templates = (list?.items ?? []).filter((x) => !x.isDeleted);
  const dueCount = templates.reduce((n, x) => n + templateDueNow(x, today).length, 0);
  const typed = toPaise(v.amount);
  const rateBp = Number(v.gstRate) || 0;
  const split = Number.isFinite(typed) && typed > 0 ? splitExpenseGst(typed, rateBp, v.gstHow === "in") : null;
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: t(`expenses.recurring.weekdays.${d}`) }));
  const how = (x: ExpenseTemplate) => (x.frequency === "weekly"
    ? t("expenses.recurring.everyWeek", { day: t(`expenses.recurring.weekdays.${x.weekday ?? 1}`) })
    : t("expenses.recurring.everyMonth", { day: x.dayOfMonth ?? 1 }));

  const open = (x: ExpenseTemplate | null) => { f.setAll(x ? fromTemplate(x) : blank()); f.setErrors({}); setEditing(x ? x.id : "new"); };
  const save = () => f.submit(async (x) => {
    await run("saveExpenseTemplate", {
      id: editing === "new" ? null : editing, name: x.name, projectId: x.projectId === OFFICE ? null : x.projectId, categoryId: x.categoryId, description: x.description,
      amountPaise: toPaise(x.amount), gstRateBp: Number(x.gstRate) || 0, gstInclusive: x.gstHow === "in", payeeType: "other", payeeName: x.payeeName, mode: x.mode,
      accountId: x.mode === "credit" ? null : x.accountId || null, frequency: x.frequency, dayOfMonth: x.frequency === "monthly" ? Number(x.dayOfMonth) : null,
      weekday: x.frequency === "weekly" ? Number(x.weekday) : null, startDate: toDate(x.startDate), endDate: toDate(x.endDate) || null,
    });
    toast(t("expenses.recurring.saved"));
    setEditing(null);
  });
  const pause = async (x: ExpenseTemplate) => {
    try { await run("pauseExpenseTemplate", { id: x.id, paused: x.active }); toast(x.active ? t("expenses.recurring.paused") : t("expenses.recurring.resumed")); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
  };
  const runNow = async () => {
    try {
      const r = await run("runRecurringExpenses", {});
      setLastRun(r);
      toast(r.created.length ? t("expenses.recurring.ran", { n: r.created.length, approved: r.approved, waiting: r.waiting }) : t("expenses.recurring.ranNone"));
    } catch (e) { toast(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <AppShell nav="expenses" title={title} crumbs={crumbs}>
      <div className="page-head">
        <div className="heading"><h1>{title}</h1></div>
        <div className="page-actions"><Button variant="primary" onClick={() => open(null)} disabled={!online} data-new-template><Icon name="plus" />{t("expenses.recurring.add")}</Button></div>
      </div>
      <ExpenseTabs current="recurring" />
      <p className="hint"><Icon name="info" size={16} /><span>{t("expenses.recurring.hint")}</span></p>

      {dueCount > 0 && (
        <div className="banner warning" role="status" data-due><Icon name="clock" />
          <span className="text"><b>{t("expenses.recurring.due", { n: dueCount })}</b> {t("expenses.recurring.dueBody")}{" "}
            <Button size="sm" variant="primary" onClick={() => setConfirmRun(true)} disabled={!online} data-run>{t("expenses.recurring.runNow")}</Button></span></div>
      )}
      {lastRun && lastRun.skipped.length > 0 && (
        <div className="banner error" role="alert" data-skipped><Icon name="alert" />
          <span className="text"><b>{t("expenses.recurring.skipped")}</b>
            {lastRun.skipped.map((s) => <span key={`${s.templateId}-${s.date}`} className="queued-error">{s.name}, {date(s.date, lang)}: {s.reason}</span>)}</span></div>
      )}

      {editing && (
        <form className="card section" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} data-template-form>
          <h2 className="card-title">{editing === "new" ? t("expenses.recurring.add") : t("expenses.recurring.edit")}</h2>
          <ErrorSummary summary={f.summary} errors={f.errors} />
          <div className="form-grid two">
            <TextField label={t("expenses.recurring.name")} hint={t("expenses.recurring.nameHint")} value={v.name} onChange={(x) => f.set("name", x)} error={f.errors.name} required />
            <SelectField label={t("expenses.form.project")} value={v.projectId} onChange={(x) => f.set("projectId", x)} error={f.errors.projectId}
              options={[{ value: OFFICE, label: t("expenses.form.office") }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
            <div className="span-2"><CategoryPicker label={t("expenses.form.category")} value={v.categoryId} onChange={(x) => f.set("categoryId", x)} error={f.errors.categoryId} required /></div>
            <MoneyField label={t("expenses.form.amount")} value={v.amount} onChange={(x) => f.set("amount", x)} error={f.errors.amountPaise} required
              hint={split && rateBp > 0 ? t("expenses.recurring.totalHint", { total: money(split.amountPaise) }) : undefined} />
            <SelectField label={t("expenses.form.gstRate")} value={v.gstRate} onChange={(x) => f.set("gstRate", x)} error={f.errors.gstRateBp}
              options={EXPENSE_GST_RATES_BP.map((bp) => ({ value: String(bp), label: bp === 0 ? t("expenses.form.noGst") : formatBp(bp) }))} />
            {rateBp > 0 && <SelectField label={t("expenses.form.gstHow")} value={v.gstHow} onChange={(x) => f.set("gstHow", x)}
              options={[{ value: "in", label: t("expenses.form.gstIncluded") }, { value: "ex", label: t("expenses.form.gstAdded") }]} />}
            <TextField label={t("expenses.form.payeeName")} value={v.payeeName} onChange={(x) => f.set("payeeName", x)} error={f.errors.payeeName} required={v.mode === "credit"} />
            <SelectField label={t("expenses.form.mode")} value={v.mode} onChange={(x) => f.set("mode", x)} error={f.errors.mode}
              hint={v.mode === "credit" ? t("expenses.recurring.creditHint") : t("expenses.recurring.paidHint")} options={ALL_MODES.map((m) => ({ value: m, label: t(`expenses.modes.${m}`) }))} />
            {v.mode !== "credit" && <AccountPicker value={v.accountId} onChange={(x) => f.set("accountId", x)} label={t("expenses.form.paidFrom")} required error={f.errors.accountId} />}
            <SelectField label={t("expenses.recurring.frequency")} value={v.frequency} onChange={(x) => f.set("frequency", x)} error={f.errors.frequency}
              options={[{ value: "monthly", label: t("expenses.recurring.monthly") }, { value: "weekly", label: t("expenses.recurring.weekly") }]} />
            {v.frequency === "monthly"
              ? <TextField label={t("expenses.recurring.dayOfMonth")} hint={t("expenses.recurring.dayOfMonthHint")} value={v.dayOfMonth} onChange={(x) => f.set("dayOfMonth", x)} error={f.errors.dayOfMonth} inputMode="numeric" required />
              : <SelectField label={t("expenses.recurring.weekday")} value={v.weekday} onChange={(x) => f.set("weekday", x)} error={f.errors.weekday} options={weekdays} />}
            <DateField label={t("expenses.recurring.startDate")} value={v.startDate} onChange={(x) => f.set("startDate", x)} error={f.errors.startDate ?? f.errors.date} required />
            <DateField label={t("expenses.recurring.endDate")} hint={t("expenses.recurring.endDateHint")} value={v.endDate} onChange={(x) => f.set("endDate", x)} error={f.errors.endDate} />
            <div className="span-2"><TextField label={t("expenses.form.description")} value={v.description} onChange={(x) => f.set("description", x)} /></div>
          </div>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" type="submit" disabled={f.submitting || !online} data-save-template>{f.submitting ? t("common.saving") : t("common.save")}</Button>
          </div>
        </form>
      )}

      {!list ? <Skeleton lines={4} /> : templates.length === 0 ? (
        <EmptyState icon="calendar" title={t("expenses.recurring.empty")} body={t("expenses.recurring.emptyBody")} />
      ) : (
        <section className="table-block section" aria-label={title}>
          <div className="table-wrap">
            <table className="data" data-templates>
              <caption className="sr-only">{title}</caption>
              <thead><tr>
                <th scope="col">{t("expenses.recurring.name")}</th><th scope="col" className="num">{t("expenses.col.amount")}</th><th scope="col">{t("expenses.recurring.frequency")}</th>
                <th scope="col">{t("expenses.col.project")}</th><th scope="col">{t("expenses.col.mode")}</th><th scope="col">{t("expenses.recurring.next")}</th>
                <th scope="col">{t("expenses.col.status")}</th><th scope="col"><span className="sr-only">{t("table.actions")}</span></th>
              </tr></thead>
              <tbody>
                {templates.map((x) => {
                  const next = templateNextDue(x, today);
                  const total = splitExpenseGst(x.amountPaise, x.gstRateBp ?? 0, x.gstInclusive !== false, !!x.gstInterState).amountPaise;
                  return (
                    <tr key={x.id} data-template={x.id} data-active={x.active}>
                      <td data-label={t("expenses.recurring.name")} className="card-head"><b>{x.name}</b><span className="exp-sub">{categoryLabel(tree, x.categoryId, lang, true)}{x.payeeName ? ` · ${x.payeeName}` : ""}</span></td>
                      <td data-label={t("expenses.col.amount")} className="num">{money(total)}</td>
                      <td data-label={t("expenses.recurring.frequency")}>{how(x)}</td>
                      <td data-label={t("expenses.col.project")}>{x.projectName ?? t("expenses.form.office")}</td>
                      <td data-label={t("expenses.col.mode")}>{t(`expenses.modes.${x.mode}`)}</td>
                      <td data-label={t("expenses.recurring.next")}>{next ? date(next, lang) : "—"}</td>
                      <td data-label={t("expenses.col.status")}>
                        <span className={`badge ${x.active ? "success" : "neutral"}`}><Icon name={x.active ? "check-circle" : "clock"} size={14} />{x.active ? t("expenses.recurring.active") : t("expenses.recurring.pausedBadge")}</span>
                      </td>
                      <td data-label={t("table.actions")} className="row-actions exp-row-buttons">
                        <Button size="sm" onClick={() => open(x)} disabled={!online} data-edit-template>{t("common.edit")}</Button>
                        <Button size="sm" onClick={() => void pause(x)} disabled={!online} data-pause-template>{x.active ? t("expenses.recurring.pause") : t("expenses.recurring.resume")}</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ConfirmDialog open={confirmRun} onOpenChange={setConfirmRun} destructive={false} title={t("expenses.recurring.runTitle", { n: dueCount })}
        body={t("expenses.recurring.runBody")} confirmLabel={t("expenses.recurring.runNow")} onConfirm={runNow} />
    </AppShell>
  );
}
