"use client";
import {
  default194CRateBp, emptyBalance, isFinanceRole, ledgerFigures, searchTerm, tds194C, todayIST,
  type Account, type Project, type ThekedarContract, type Worker, type WorkerBalance, type WorkerPayment,
} from "@ag/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/feedback";
import { DateField, ErrorSummary, MoneyField, SelectField, TextField, fromDate, toDate, toPaise, useForm } from "@/components/ui/form";
import { useDoc, useDocs, useRead, useRun, useSession, useSmall } from "@/data/DataProvider";
import { useRoleLabel } from "@/lib/roles";
import { money } from "@/lib/fmt";
import { useParam } from "@/lib/params";
import { PAY_TYPES } from "./PaymentsPage";

interface V { workerId: string; projectId: string; type: WorkerPayment["type"]; date: string; amount: string; recover: string; mode: string; accountId: string; contractId: string; reference: string; remarks: string }

/** Record a wage, advance, bonus, thekedar bill or write-off (spec §6.4, §11A.4: the paid-from account). Finance only (D-45). */
export function PaymentForm() {
  const { t } = useTranslation();
  const roleLabel = useRoleLabel();
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const router = useRouter();
  const workerParam = useParam("worker");
  const f = useForm<V>({ workerId: "", projectId: "", type: "wage", date: fromDate(todayIST()), amount: "", recover: "", mode: "cash", accountId: "accCash", contractId: "", reference: "", remarks: "" });
  const v = f.values;
  useEffect(() => { if (workerParam && !v.workerId) f.set("workerId", workerParam); }, [workerParam, v.workerId, f]);
  const [q, setQ] = useState("");
  const term = searchTerm(q);
  const matches = useRead(`pay-pick:${term}`, (s) => (term
    ? s.query<Worker>("workers", { where: [{ field: "searchKeywords", op: "array-contains", value: term }], orderBy: [{ field: "name" }], limit: 8 })
    : Promise.resolve({ items: [] as Worker[], next: null, total: 0 })));
  const worker = useDoc<Worker>("workers", v.workerId || null);
  const sites = useDocs<Project>("projects", worker?.isThekedar ? [] : worker?.siteIds ?? []);
  const allSites = useRead("pay-all-sites", (s) => s.query<Project>("projects", { where: [{ field: "isArchived", op: "==", value: false }], orderBy: [{ field: "name" }], limit: 50 }));
  const projectOptions = worker?.isThekedar || !(sites ?? []).filter(Boolean).length ? allSites?.items ?? [] : (sites ?? []).filter((p): p is Project => !!p);
  useEffect(() => { if (worker && !v.projectId && projectOptions[0]) f.set("projectId", projectOptions[0].id); }, [worker, v.projectId, projectOptions, f]);
  useEffect(() => { if (worker?.isThekedar && v.type === "wage") f.set("type", "thekedar_bill"); }, [worker?.isThekedar, v.type, f]);
  const balance = useDoc<Partial<WorkerBalance>>("worker_balances", v.workerId && v.projectId ? `${v.workerId}_${v.projectId}` : null);
  const kyc = useDoc<{ pan?: string | null; tdsRateBp?: number | null }>(worker?.isThekedar ? `workers/${worker.id}/private` : "none", worker?.isThekedar ? "kyc" : null);
  const contracts = useRead(`pay-contracts:${v.workerId}`, (s) => (worker?.isThekedar
    ? s.query<ThekedarContract>("thekedar_contracts", { where: [{ field: "thekedarId", op: "==", value: worker.id }], orderBy: [{ field: "scope" }], limit: 20 })
    : Promise.resolve({ items: [] as ThekedarContract[], next: null, total: 0 })));
  const accounts = (useSmall<Account>("accounts") ?? []).filter((a) => a.active !== false);
  const title = t("payments.new");
  if (session && !isFinanceRole(session.role)) return <AppShell nav="labour" title={title} crumbs={[{ label: title }]}><NoAccess name={title} /></AppShell>;

  const fig = ledgerFigures({ ...emptyBalance(), ...(balance ?? {}) });
  const gross = toPaise(v.amount);
  const recover = v.type === "wage" ? toPaise(v.recover) : 0;
  const tds = v.type === "thekedar_bill" && Number.isFinite(gross) ? tds194C(gross, kyc?.tdsRateBp ?? default194CRateBp(kyc?.pan)) : 0;
  const net = v.type === "advance_writeoff" ? 0 : (Number.isFinite(gross) ? gross : 0) - (Number.isFinite(recover) ? recover : 0) - tds;
  const types = PAY_TYPES.filter((x) => (x === "thekedar_bill" ? !!worker?.isThekedar : x === "advance_writeoff" ? session?.role === "owner" : !worker?.isThekedar || x !== "wage"));

  const submit = () => f.submit(async (x) => {
    const r = await run("createWorkerPayment", {
      workerId: x.workerId, projectId: x.projectId, date: toDate(x.date), type: x.type, grossPaise: toPaise(x.amount),
      advanceRecoveredPaise: x.type === "wage" ? toPaise(x.recover) : 0, mode: x.mode as WorkerPayment["mode"], accountId: x.type === "advance_writeoff" ? null : x.accountId,
      contractId: x.contractId || null, reference: x.reference, remarks: x.remarks,
    });
    toast(r.approved ? t("payments.savedApproved") : r.needsOwnerApproval ? t("payments.savedOverContract") : t("payments.savedPending"));
    router.push("/labour/payments/");
  });

  return (
    <AppShell nav="labour" title={title} crumbs={[{ label: t("nav.labour"), href: "/labour/" }, { label: t("payments.title"), href: "/labour/payments/" }, { label: title }]}>
      <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
      <form className="card" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }} data-payment-form>
        <ErrorSummary summary={f.summary} errors={f.errors} />
        <div className="form-section">
          <h2>{t("payments.who")}</h2>
          {worker ? (
            <p className="picked"><b>{worker.name}</b> <span className="muted">{worker.isThekedar ? t("workers.thekedar") : roleLabel(worker.role)}</span>
              <Button size="sm" variant="text" onClick={() => { f.set("workerId", ""); f.set("projectId", ""); }}>{t("payments.change")}</Button></p>
          ) : (
            <div className="field">
              <label htmlFor="pay-worker">{t("payments.findWorker")}</label>
              <input id="pay-worker" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("table.searchHint")} aria-invalid={!!f.errors.workerId} />
              {f.errors.workerId && <p className="field-error"><Icon name="alert" size={16} />{f.errors.workerId}</p>}
              {term && <ul className="pick-list">{(matches?.items ?? []).map((w) => (
                <li key={w.id}><button type="button" className="pick" onClick={() => { f.set("workerId", w.id); setQ(""); }}>{w.name}<span className="meta">{w.isThekedar ? t("workers.thekedar") : roleLabel(w.role)}</span></button></li>
              ))}</ul>}
            </div>
          )}
        </div>
        <div className="form-grid two" style={{ marginTop: "var(--space-4)" }}>
          <SelectField label={t("payments.project")} value={v.projectId} onChange={(x) => f.set("projectId", x)} error={f.errors.projectId} placeholder={t("payments.chooseProject")}
            options={projectOptions.map((p) => ({ value: p.id, label: p.name }))} />
          <SelectField label={t("payments.type")} value={v.type} onChange={(x) => f.set("type", x as V["type"])} error={f.errors.type}
            options={types.map((x) => ({ value: x, label: t(`payments.types.${x}`) }))} />
          <DateField label={t("payments.date")} value={v.date} onChange={(x) => f.set("date", x)} error={f.errors.date} />
          <MoneyField label={v.type === "thekedar_bill" ? t("payments.billValue") : t("payments.amount")} value={v.amount} onChange={(x) => f.set("amount", x)} error={f.errors.grossPaise} required />
          {v.type === "wage" && (
            <MoneyField label={t("payments.recover")} hint={t("payments.recoverHint", { amount: money(Math.max(0, fig.advanceOutstandingPaise)) })} value={v.recover} onChange={(x) => f.set("recover", x)} error={f.errors.advanceRecoveredPaise} />
          )}
          {v.type === "thekedar_bill" && (
            <SelectField label={t("payments.contract")} hint={t("payments.contractHint")} value={v.contractId} onChange={(x) => f.set("contractId", x)} error={f.errors.contractId}
              placeholder={t("payments.noContract")} options={(contracts?.items ?? []).map((k) => ({ value: k.id, label: `${k.scope} · ${money(k.valuePaise)}` }))} />
          )}
          {v.type !== "advance_writeoff" && <>
            <SelectField label={t("payments.mode")} value={v.mode} onChange={(x) => f.set("mode", x)} options={(["cash", "upi", "bank", "cheque"] as const).map((m) => ({ value: m, label: t(`payments.modes.${m}`) }))} />
            <SelectField label={t("payments.account")} hint={t("payments.accountHint")} value={v.accountId} onChange={(x) => f.set("accountId", x)} error={f.errors.accountId}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
            <TextField label={t("payments.reference")} hint={t("payments.referenceHint")} value={v.reference} onChange={(x) => f.set("reference", x)} />
          </>}
          <TextField label={t("payments.remarks")} value={v.remarks} onChange={(x) => f.set("remarks", x)} />
        </div>
        {worker && v.projectId && (
          <dl className="kv pay-preview" aria-label={t("payments.preview")} data-preview>
            {!worker.isThekedar && <><dt>{t("payments.balanceDue")}</dt><dd>{money(fig.balanceDuePaise)}</dd></>}
            {!worker.isThekedar && <><dt>{t("payments.advanceOut")}</dt><dd>{money(fig.advanceOutstandingPaise)}</dd></>}
            {v.type === "thekedar_bill" && <><dt>{t("payments.tds194c")}</dt><dd>{money(tds)}</dd></>}
            <dt><b>{t("payments.netPaid")}</b></dt><dd><b>{money(net)}</b></dd>
          </dl>
        )}
        <div className="form-actions">
          <Link className="btn btn-secondary" href="/labour/payments/">{t("common.cancel")}</Link>
          <Button variant="primary" type="submit" disabled={f.submitting}>{f.submitting ? t("common.saving") : t("payments.save")}</Button>
        </div>
      </form>
    </AppShell>
  );
}
