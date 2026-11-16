"use client";
// Add or change an expense (spec §7.2): date, project, category (cascading), description, quantity and rate,
// amount, GST, who was paid, how, the paid-from account, bill number and photo (or why there is no bill), remarks.
// An entry made with no connection is kept on the device as a pending entry (lib/queue.ts) and sent later.
import {
  approvalOnSave, CommandError, editRefusal, formatBp, gstInclusiveOf, isFinanceRole, needsBillOrReason, newId, splitExpenseGst, todayIST, typedAmountOf,
  EXPENSE_GST_RATES_BP, MAX_BILL_FILES,
  type ExpenseInput, type ExpenseRecord, type FileRef, type PaymentMode,
} from "@ag/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AccountPicker } from "@/components/accounts/AccountPicker";
import { NoAccess, NotFoundRecord } from "@/components/ModulePage";
import { FileAttach } from "@/components/shared/FileAttach";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Skeleton, useToast } from "@/components/ui/feedback";
import { CheckField, DateField, ErrorSummary, MoneyField, SelectField, TextArea, TextField, fromDate, fromMilli, fromPaise, toDate, toMilli, toPaise, useForm } from "@/components/ui/form";
import { useDoc, useDocStatus, useOnline, useRun, useSession } from "@/data/DataProvider";
import { date as fmtDate, money } from "@/lib/fmt";
import { useParam } from "@/lib/params";
import { enqueue, queuedWrites } from "@/lib/queue";
import { ALL_MODES, CategoryPicker, OFFICE, categoryLabel, refusalKey, useCategoryTree, useExpenseLimits, useLang, useMyProjects, useVendors, who } from "./common";

interface V {
  projectId: string; date: string; categoryId: string; description: string; qty: string; unit: string; rate: string; amount: string;
  gstRate: string; gstHow: "in" | "ex"; interState: boolean; payeeType: "vendor" | "worker" | "other"; payeeId: string; payeeName: string; partyGstin: string;
  mode: PaymentMode; accountId: string; billNo: string; billDate: string; noBillReason: string; remarks: string;
}

const BLANK: V = {
  projectId: "", date: "", categoryId: "", description: "", qty: "", unit: "", rate: "", amount: "", gstRate: "0", gstHow: "in", interState: false,
  payeeType: "other", payeeId: "", payeeName: "", partyGstin: "", mode: "cash", accountId: "", billNo: "", billDate: "", noBillReason: "", remarks: "",
};

function fromRecord(e: ExpenseRecord): V {
  return {
    projectId: e.projectId ?? OFFICE, date: fromDate(e.date), categoryId: e.categoryId, description: e.description ?? "", qty: e.qtyMilli ? fromMilli(e.qtyMilli) : "",
    unit: e.unit ?? "", rate: e.ratePaise ? fromPaise(e.ratePaise) : "", amount: fromPaise(typedAmountOf(e)), gstRate: String(e.gstRateBp ?? 0),
    gstHow: gstInclusiveOf(e) ? "in" : "ex", interState: !!e.gstInterState || (e.igstPaise ?? 0) > 0, payeeType: e.payeeType ?? "other", payeeId: e.payeeId ?? "",
    payeeName: e.payeeName ?? "", partyGstin: e.partyGstin ?? "", mode: e.mode, accountId: e.accountId ?? "", billNo: e.billNo ?? "", billDate: fromDate(e.billDate),
    noBillReason: e.noBillReason ?? "", remarks: e.remarks ?? "",
  };
}

function toInput(v: V, billFiles: FileRef[]): ExpenseInput {
  return {
    projectId: v.projectId === OFFICE ? null : v.projectId || null, date: toDate(v.date), categoryId: v.categoryId, description: v.description,
    qtyMilli: v.qty.trim() ? toMilli(v.qty) : null, unit: v.unit, ratePaise: v.rate.trim() ? toPaise(v.rate) : null, amountPaise: toPaise(v.amount),
    gstRateBp: Number(v.gstRate) || 0, gstInclusive: v.gstHow === "in", gstInterState: v.interState,
    payeeType: v.payeeType, payeeId: v.payeeType === "vendor" ? v.payeeId || null : null, payeeName: v.payeeName, partyGstin: v.partyGstin,
    mode: v.mode, accountId: v.mode === "credit" ? null : v.accountId || null, billNo: v.billNo, billDate: toDate(v.billDate), billFiles, noBillReason: v.noBillReason, remarks: v.remarks,
  };
}

export function ExpenseForm({ mode }: { mode: "new" | "edit" }) {
  const { t } = useTranslation();
  const lang = useLang();
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const router = useRouter();
  const online = useOnline();
  const limits = useExpenseLimits();
  const tree = useCategoryTree();
  const projects = useMyProjects();
  const idParam = useParam("id");
  const projectParam = useParam("project");
  const id = mode === "edit" ? idParam : null;
  const existing = useDoc<ExpenseRecord>("expenses", id);
  const status = useDocStatus("expenses", id);
  const f = useForm<V>({ ...BLANK, date: fromDate(todayIST()) });
  const v = f.values;
  const [bills, setBills] = useState<FileRef[]>([]);
  const [more, setMore] = useState(false);
  const loaded = useRef<string | null>(null);
  const finance = !!session && isFinanceRole(session.role);
  const vendors = useVendors(finance);

  // An entry opened for editing fills the form once.
  useEffect(() => {
    if (mode !== "edit" || !existing || loaded.current === existing.id) return;
    loaded.current = existing.id;
    f.setAll(fromRecord(existing));
    setBills(existing.billFiles ?? []);
    setMore(!!(existing.qtyMilli || existing.ratePaise || existing.remarks || existing.partyGstin));
  }, [mode, existing, f]);
  // A new entry starts on the project it was opened from, or the person's only project.
  useEffect(() => {
    if (mode !== "new" || v.projectId || !projects) return;
    const wanted = projectParam && projects.find((p) => p.id === projectParam);
    if (wanted) f.set("projectId", wanted.id);
    else if (!finance && projects.length === 1) f.set("projectId", projects[0]!.id);
  }, [mode, v.projectId, projects, projectParam, finance, f]);

  const title = mode === "edit" ? t("expenses.form.editTitle") : t("expenses.form.newTitle");
  const crumbs = [{ label: t("nav.expenses"), href: "/expenses/" }, { label: title }];
  const shell = (body: ReactNode) => <AppShell nav="expenses" title={title} crumbs={crumbs}>{body}</AppShell>;
  if (session && !finance && session.role !== "pm" && session.role !== "supervisor") return shell(<NoAccess name={title} />);
  if (mode === "edit") {
    if (idParam === undefined || status === undefined) return shell(<Skeleton lines={6} />);
    if (status === "denied") return shell(<NoAccess name={title} />);
    if (status === "missing" || !existing) return shell(<NotFoundRecord name={title} back="/expenses/" backLabel={t("expenses.backToList")} />);
    const refusal = session ? editRefusal(existing, who(session)) : null;
    if (refusal) {
      return shell(<>
        <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
        <div className="banner warning" role="alert" data-edit-refused><Icon name="lock" /><span className="text">{t(`expenses.refusal.${refusalKey(refusal)}`, { defaultValue: refusal })}</span></div>
        <p><Link className="btn btn-secondary" href={`/expenses/view/?id=${existing.id}`}>{t("expenses.backToEntry")}</Link></p>
      </>);
    }
  }

  const typed = toPaise(v.amount);
  const rateBp = Number(v.gstRate) || 0;
  const split = Number.isFinite(typed) && typed > 0 ? splitExpenseGst(typed, rateBp, v.gstHow === "in", v.interState) : null;
  const gross = split?.amountPaise ?? 0;
  const willApprove = !!session && !!split && approvalOnSave(session.role, gross, limits) === "approved";
  const billNeeded = needsBillOrReason(gross, bills.length + (existing?.billPaths?.length ?? 0), limits);
  const qty = toMilli(v.qty), rate = toPaise(v.rate);
  const computed = v.qty.trim() && v.rate.trim() && Number.isFinite(qty) && Number.isFinite(rate) && qty > 0 && rate > 0 ? Math.round((qty * rate) / 1000) : 0;
  const projectOptions = [
    ...(finance ? [{ value: OFFICE, label: t("expenses.form.office") }] : []),
    ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
    ...(existing?.projectId && !(projects ?? []).some((p) => p.id === existing.projectId) ? [{ value: existing.projectId, label: existing.projectName ?? existing.projectId }] : []),
  ];

  /** The checks that can be made without the server, so an entry kept offline is not refused later for something plain. */
  const localProblems = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!v.projectId) e.projectId = t("expenses.err.project");
    if (!toDate(v.date) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate(v.date))) e.date = t("expenses.err.date");
    if (!v.categoryId) e.categoryId = t("expenses.err.category");
    if (!Number.isFinite(typed) || typed <= 0) e.amountPaise = t("expenses.err.amount");
    if (v.mode === "credit" && v.payeeName.trim().length < 2 && !(v.payeeType === "vendor" && v.payeeId)) e.payeeName = t("expenses.err.creditPayee");
    if (billNeeded && v.noBillReason.trim().length < 3) e.noBillReason = t("expenses.err.bill", { limit: money(limits.missingBillThresholdPaise) });
    return e;
  };

  const save = (again: boolean) => f.submit(async (x) => {
    const input = toInput(x, bills);
    if (mode === "edit") {
      const r = await run("updateExpense", { id: existing!.id, input });
      toast(r.status === "approved" ? t("expenses.form.savedApproved") : t("expenses.form.savedWaiting"));
      router.push(`/expenses/view/?id=${existing!.id}`);
      return;
    }
    const newIdForDevice = newId();
    if (!online) {
      // Kept on this device and sent when the connection returns (lib/queue.ts, the same queue attendance uses).
      const problems = localProblems();
      if (Object.keys(problems).length) throw new CommandError(t("expenses.err.summary"), problems);
      const key = `exp_${newIdForDevice}`;
      const label = `${t("expenses.queue.label")}: ${money(gross)}${x.payeeName ? `, ${x.payeeName}` : ""}, ${fmtDate(input.date, lang)}`;
      enqueue("createExpense", { ...input, id: newIdForDevice }, label, key);
      if (!queuedWrites().some((q) => q.id === key)) throw new CommandError(t("expenses.queue.noRoom"));
      toast(t("expenses.queue.kept"));
    } else {
      const r = await run("createExpense", { ...input, id: newIdForDevice });
      toast(r.approved ? t("expenses.form.savedApproved") : t("expenses.form.savedWaiting"));
    }
    if (again) {
      f.setAll({ ...x, description: "", qty: "", rate: "", amount: "", billNo: "", billDate: "", noBillReason: "", remarks: "" });
      setBills([]);
      window.scrollTo({ top: 0 });
    } else {
      router.push("/expenses/");
    }
  });

  const offlineEdit = mode === "edit" && !online;
  return shell(
    <>
      <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
      {!online && (
        <div className="banner warning" role="status" data-offline-note><Icon name="wifi-off" />
          <span className="text">{mode === "edit" ? t("expenses.form.offlineEdit") : t("expenses.form.offlineNew")}</span></div>
      )}
      <form className="card" noValidate onSubmit={(e) => { e.preventDefault(); void save(false); }} data-expense-form>
        <ErrorSummary summary={f.summary} errors={f.errors} />
        <div className="form-section">
          <h2>{t("expenses.form.what")}</h2>
          <div className="form-grid two">
            <SelectField label={t("expenses.form.project")} value={v.projectId} onChange={(x) => f.set("projectId", x)} error={f.errors.projectId} required
              placeholder={projects === undefined ? t("common.loading") : t("expenses.form.chooseProject")} options={projectOptions}
              disabled={mode === "edit" && !finance} hint={mode === "edit" && !finance ? t("expenses.form.projectFixed") : undefined} />
            <DateField label={t("expenses.form.date")} value={v.date} onChange={(x) => f.set("date", x)} error={f.errors.date} required />
            <div className="span-2"><CategoryPicker label={t("expenses.form.category")} value={v.categoryId} onChange={(x) => f.set("categoryId", x)} error={f.errors.categoryId} required /></div>
            <div className="span-2"><TextField label={t("expenses.form.description")} hint={t("expenses.form.descriptionHint")} value={v.description} onChange={(x) => f.set("description", x)} /></div>
          </div>
        </div>

        <div className="form-section">
          <h2>{t("expenses.form.howMuch")}</h2>
          <div className="form-grid two">
            <MoneyField label={t("expenses.form.amount")} hint={computed && !v.amount.trim() ? undefined : t("expenses.form.amountHint")} value={v.amount} onChange={(x) => f.set("amount", x)} error={f.errors.amountPaise} required />
            <SelectField label={t("expenses.form.gstRate")} value={v.gstRate} onChange={(x) => f.set("gstRate", x)} error={f.errors.gstRateBp}
              options={EXPENSE_GST_RATES_BP.map((bp) => ({ value: String(bp), label: bp === 0 ? t("expenses.form.noGst") : formatBp(bp) }))} />
            {computed > 0 && !v.amount.trim() && (
              <p className="hint span-2"><Icon name="info" size={16} /><span>{t("expenses.form.qtyTimesRate", { amount: money(computed) })} <button type="button" className="link-btn" onClick={() => f.set("amount", fromPaise(computed))}>{t("expenses.form.useIt")}</button></span></p>
            )}
            {rateBp > 0 && (
              <>
                <SelectField label={t("expenses.form.gstHow")} value={v.gstHow} onChange={(x) => f.set("gstHow", x)}
                  options={[{ value: "in", label: t("expenses.form.gstIncluded") }, { value: "ex", label: t("expenses.form.gstAdded") }]} />
                <CheckField label={t("expenses.form.interState")} hint={t("expenses.form.interStateHint")} checked={v.interState} onChange={(x) => f.set("interState", x)} />
              </>
            )}
          </div>
          {split && (
            <dl className="kv exp-preview" aria-label={t("expenses.form.preview")} data-preview>
              {rateBp > 0 && <><dt>{t("expenses.form.taxable")}</dt><dd>{money(split.taxablePaise)}</dd></>}
              {rateBp > 0 && (v.interState
                ? <><dt>{t("expenses.form.igst")}</dt><dd>{money(split.igstPaise)}</dd></>
                : <><dt>{t("expenses.form.cgstSgst")}</dt><dd>{money(split.cgstPaise)} + {money(split.sgstPaise)}</dd></>)}
              <dt className="total">{t("expenses.form.total")}</dt><dd className="total" data-total>{money(split.amountPaise)}</dd>
            </dl>
          )}
          <p><button type="button" className="link-btn" aria-expanded={more} onClick={() => setMore((m) => !m)} data-more>{more ? t("expenses.form.lessDetails") : t("expenses.form.moreDetails")}</button></p>
          {more && (
            <div className="form-grid two">
              <TextField label={t("expenses.form.qty")} hint={t("expenses.form.qtyHint")} value={v.qty} onChange={(x) => f.set("qty", x)} error={f.errors.qtyMilli} inputMode="decimal" />
              <TextField label={t("expenses.form.unit")} hint={t("expenses.form.unitHint")} value={v.unit} onChange={(x) => f.set("unit", x)} />
              <MoneyField label={t("expenses.form.rate")} value={v.rate} onChange={(x) => f.set("rate", x)} error={f.errors.ratePaise} />
              <TextField label={t("expenses.form.gstin")} hint={t("expenses.form.gstinHint")} value={v.partyGstin} onChange={(x) => f.set("partyGstin", x.toUpperCase())} error={f.errors.partyGstin} />
              <div className="span-2"><TextArea label={t("expenses.form.remarks")} value={v.remarks} onChange={(x) => f.set("remarks", x)} rows={2} /></div>
            </div>
          )}
        </div>

        <div className="form-section">
          <h2>{t("expenses.form.whoHow")}</h2>
          <div className="form-grid two">
            <SelectField label={t("expenses.form.payeeType")} value={v.payeeType} onChange={(x) => { f.set("payeeType", x); f.set("payeeId", ""); }} error={f.errors.payeeType}
              options={(["vendor", "worker", "other"] as const).map((k) => ({ value: k, label: t(`expenses.payee.${k}`) }))} />
            {v.payeeType === "vendor" && finance && vendors.length > 0 ? (
              <SelectField label={t("expenses.form.vendor")} value={v.payeeId} error={f.errors.payeeId} placeholder={t("expenses.form.vendorNotListed")}
                onChange={(x) => { f.set("payeeId", x); const vd = vendors.find((y) => y.id === x); if (vd) { f.set("payeeName", vd.name); f.set("partyGstin", vd.gstin ?? ""); } }}
                options={vendors.map((y) => ({ value: y.id, label: y.name }))} />
            ) : null}
            {!(v.payeeType === "vendor" && v.payeeId) && (
              <TextField label={t("expenses.form.payeeName")} hint={t("expenses.form.payeeHint")} value={v.payeeName} onChange={(x) => f.set("payeeName", x)} error={f.errors.payeeName} required={v.mode === "credit"} />
            )}
            <SelectField label={t("expenses.form.mode")} value={v.mode} onChange={(x) => f.set("mode", x)} error={f.errors.mode} hint={v.mode === "credit" ? t("expenses.form.creditHint") : undefined}
              options={ALL_MODES.map((m) => ({ value: m, label: t(`expenses.modes.${m}`) }))} />
            {v.mode !== "credit" && (
              <AccountPicker value={v.accountId} onChange={(x) => f.set("accountId", x)} label={t("expenses.form.paidFrom")} required error={f.errors.accountId} hint={t("expenses.form.paidFromHint")} />
            )}
          </div>
        </div>

        <div className="form-section">
          <h2>{t("expenses.form.bill")}</h2>
          <div className="form-grid two">
            <TextField label={t("expenses.form.billNo")} value={v.billNo} onChange={(x) => f.set("billNo", x)} />
            <DateField label={t("expenses.form.billDate")} value={v.billDate} onChange={(x) => f.set("billDate", x)} error={f.errors.billDate} hint={t("expenses.form.billDateHint")} />
            <div className="span-2">
              <FileAttach value={bills} onChange={setBills} accept="image/*" max={MAX_BILL_FILES} label={t("expenses.form.billPhoto")} kind="bill"
                projectId={v.projectId && v.projectId !== OFFICE ? v.projectId : null} hint={t("expenses.form.billPhotoHint", { limit: money(limits.missingBillThresholdPaise) })} />
              {f.errors.billFiles && <p className="field-error" role="alert"><Icon name="alert" size={16} />{f.errors.billFiles}</p>}
            </div>
            {bills.length === 0 && (
              <div className="span-2"><TextField label={t("expenses.form.noBill")} hint={billNeeded ? t("expenses.form.noBillNeeded", { limit: money(limits.missingBillThresholdPaise) }) : t("expenses.form.noBillHint")}
                value={v.noBillReason} onChange={(x) => f.set("noBillReason", x)} error={f.errors.noBillReason} required={billNeeded} /></div>
            )}
          </div>
        </div>

        {split && session && (
          <p className="hint" data-approval-note><Icon name={willApprove ? "check-circle" : "clock"} size={16} />
            <span>{willApprove ? t("expenses.form.willApprove") : t("expenses.form.willWait", { limit: money(session.role === "accountant" ? limits.autoApproveLimitPaise : limits.pmApprovalLimitPaise) })}</span></p>
        )}
        <p className="muted small">{t("expenses.form.enteredBy", { name: mode === "edit" ? existing?.enteredByName ?? "" : session?.name ?? "" })}{tree && v.categoryId ? ` · ${categoryLabel(tree, v.categoryId, lang, true)}` : ""}</p>
        <div className="form-actions">
          <Link className="btn btn-secondary" href={mode === "edit" && existing ? `/expenses/view/?id=${existing.id}` : "/expenses/"}>{t("common.cancel")}</Link>
          {mode === "new" && <Button variant="secondary" disabled={f.submitting} onClick={() => void save(true)} data-save-again>{t("expenses.form.saveAgain")}</Button>}
          <Button variant="primary" type="submit" disabled={f.submitting || offlineEdit} data-save>{f.submitting ? t("common.saving") : !online && mode === "new" ? t("expenses.form.saveOffline") : t("expenses.form.save")}</Button>
        </div>
      </form>
    </>,
  );
}
