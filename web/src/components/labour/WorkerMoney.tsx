"use client";
import {
  formatQty, thekedarLedger, todayIST, workerLedger,
  type ContractMeasurement, type ContractScope, type Project, type ProjectTerms, type ThekedarContract, type Worker, type WorkerBalance, type WorkerPayment,
} from "@ag/core";
import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState, MiniWrap, Skeleton, StatusBadge, useToast } from "@/components/ui/feedback";
import { DateField, ErrorSummary, MoneyField, SelectField, TextField, fromDate, fromPaise, toBp, toDate, toMilli, toPaise, useForm } from "@/components/ui/form";
import { useDocs, useRead, useRun } from "@/data/DataProvider";
import { date, money } from "@/lib/fmt";
import { statusKind } from "./PaymentsPage";

/** Per-worker ledger (spec §6.4): earned, paid, advances and balance due on each site, and the latest payments. Finance only. */
export function LedgerCard({ worker }: { worker: Worker }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const siteIds = worker.siteIds ?? [];
  const sites = useDocs<Project>("projects", siteIds);
  const balances = useDocs<Partial<WorkerBalance>>("worker_balances", siteIds.map((p) => `${worker.id}_${p}`));
  const payments = useRead(`ledger-pays:${worker.id}`, (s) => s.query<WorkerPayment>("worker_payments", { where: [{ field: "workerId", op: "==", value: worker.id }], orderBy: [{ field: "date", dir: "desc" }], limit: 25 }));
  const viaThekedar = !!worker.thekedarId;
  return (
    <section className="card section" aria-labelledby="ledger-title" data-ledger>
      <h2 className="card-title" id="ledger-title">{t("ledger.title")}
        <span className="aside"><Link className="btn btn-secondary btn-sm" href={`/labour/payments/new/?worker=${worker.id}`}><Icon name="plus" />{t("payments.new")}</Link></span>
      </h2>
      {viaThekedar && <p className="hint"><Icon name="info" size={16} /><span>{t("ledger.viaThekedar", { name: worker.thekedarName ?? "" })}</span></p>}
      {!balances || !sites ? <Skeleton /> : siteIds.length === 0 ? <p className="muted">{t("ledger.noSites")}</p> : (
        <MiniWrap label={t("ledger.title")}><table className="mini-table">
          <thead><tr><th>{t("payments.project")}</th><th className="num">{t("ledger.earned")}</th><th className="num">{t("ledger.paid")}</th>
            <th className="num">{t("ledger.advanceGiven")}</th><th className="num">{t("ledger.recovered")}</th><th className="num">{t("ledger.advanceOut")}</th><th className="num">{t("ledger.due")}</th></tr></thead>
          <tbody>{siteIds.map((pid, i) => {
            const l = workerLedger(balances[i] ?? {}, []);
            return (
              <tr key={pid}><td>{sites[i]?.name ?? pid}</td><td className="num">{money(l.earnedPaise)}</td><td className="num">{money(l.paidPaise)}</td>
                <td className="num">{money(l.advanceGivenPaise)}</td><td className="num">{money(l.advanceRecoveredPaise)}</td>
                <td className="num">{money(l.advanceOutstandingPaise)}</td><td className="num"><b>{viaThekedar ? t("ledger.throughThekedar") : money(l.balanceDuePaise)}</b></td></tr>
            );
          })}</tbody>
        </table></MiniWrap>
      )}
      <h3 className="group-head" style={{ marginTop: "var(--space-6)" }}>{t("ledger.latest")}</h3>
      {!payments ? <Skeleton lines={3} /> : payments.items.length === 0 ? <p className="muted">{t("ledger.noPayments")}</p> : (
        <MiniWrap label={t("ledger.latest")}><table className="mini-table">
          <thead><tr><th>{t("payments.date")}</th><th>{t("payments.type")}</th><th>{t("payments.project")}</th><th className="num">{t("payments.gross")}</th>
            <th className="num">{t("payments.recovered")}</th><th className="num">{t("payments.tds")}</th><th className="num">{t("payments.net")}</th><th>{t("payments.status")}</th></tr></thead>
          <tbody>{payments.items.map((p) => (
            <tr key={p.id}><td>{date(p.date, lang)}</td><td>{t(`payments.types.${p.type}`)}</td><td>{p.projectName}</td><td className="num">{money(p.grossPaise)}</td>
              <td className="num">{p.advanceRecoveredPaise ? money(p.advanceRecoveredPaise) : "—"}</td><td className="num">{p.tdsPaise ? money(p.tdsPaise) : "—"}</td>
              <td className="num">{money(p.netPaidPaise)}</td><td><StatusBadge kind={statusKind(p)} /></td></tr>
          ))}</tbody>
        </table></MiniWrap>
      )}
    </section>
  );
}

/** Pay on each site (spec §6.2: a different pay type per project). Finance only (D-32). */
export function PayTermsCard({ worker }: { worker: Worker }) {
  const { t } = useTranslation();
  const siteIds = worker.siteIds ?? [];
  const sites = useDocs<Project>("projects", siteIds);
  const terms = useDocs<ProjectTerms>(`workers/${worker.id}/project_terms`, siteIds);
  const [edit, setEdit] = useState<string | null>(null);
  if (!siteIds.length || worker.isThekedar) return null;
  return (
    <section className="card section" aria-labelledby="terms-title">
      <h2 className="card-title" id="terms-title">{t("terms.title")}</h2>
      <p className="hint"><Icon name="info" size={16} /><span>{t("terms.hint")}</span></p>
      {!terms ? <Skeleton lines={2} /> : (
        <ul className="list">{siteIds.map((pid, i) => {
          const k = terms[i];
          const desc = !k ? t("terms.default") : k.payType === "monthly" ? t("terms.monthlyDesc", { amount: money(k.monthlySalaryPaise) })
            : k.payType === "contract" ? t("workers.contract") : t("terms.dailyDesc", { amount: money(k.ratePaise), ot: k.otMultiplierBp ? t("terms.otMult", { x: k.otMultiplierBp / 10000 }) : k.otRatePaise ? t("terms.otFixed", { amount: money(k.otRatePaise) }) : t("workers.otHint") });
          return (
            <li key={pid}><Icon name="folder" /><span className="grow">{sites?.[i]?.name ?? pid}<span className="meta">{desc}</span></span>
              <Button size="sm" variant="text" onClick={() => setEdit(pid)} aria-label={`${t("common.edit")}: ${sites?.[i]?.name ?? pid}`}><Icon name="edit" size={16} /></Button></li>
          );
        })}</ul>
      )}
      {edit && <TermsDialog worker={worker} projectId={edit} current={terms?.[siteIds.indexOf(edit)] ?? null} onClose={() => setEdit(null)} />}
    </section>
  );
}

function TermsDialog({ worker, projectId, current, onClose }: { worker: Worker; projectId: string; current: ProjectTerms | null; onClose: () => void }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const f = useForm({
    payType: current?.payType ?? worker.defaultPayType ?? "daily", rate: fromPaise(current?.ratePaise), salary: fromPaise(current?.monthlySalaryPaise ?? undefined),
    otMode: current?.otMultiplierBp ? "multiplier" : current?.otRatePaise ? "fixed" : "default", otRate: fromPaise(current?.otRatePaise ?? undefined),
    otMult: current?.otMultiplierBp ? String(current.otMultiplierBp / 10000) : "1.5",
  });
  const v = f.values;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("terms.editTitle")} description={worker.name}>
        <form noValidate onSubmit={(e) => { e.preventDefault(); void f.submit(async (x) => {
          await run("saveProjectTerms", {
            workerId: worker.id, projectId, payType: x.payType as ProjectTerms["payType"], ratePaise: x.payType === "daily" ? toPaise(x.rate) : undefined,
            monthlySalaryPaise: x.payType === "monthly" ? toPaise(x.salary) : null, otRatePaise: x.otMode === "fixed" ? toPaise(x.otRate) : null,
            otMultiplierBp: x.otMode === "multiplier" ? Math.round(Number(x.otMult) * 10000) : null, effectiveFrom: todayIST(),
          });
          toast(t("terms.saved")); onClose();
        }); }}>
          <ErrorSummary summary={f.summary} errors={f.errors} />
          <div className="form-grid">
            <SelectField label={t("workers.payType")} value={v.payType} onChange={(x) => f.set("payType", x as ProjectTerms["payType"])} options={(["daily", "contract", "monthly"] as const).map((k) => ({ value: k, label: t(`workers.${k}`) }))} />
            {v.payType === "daily" && <>
              <MoneyField label={t("workers.rate")} value={v.rate} onChange={(x) => f.set("rate", x)} error={f.errors.ratePaise} />
              <SelectField label={t("terms.otMode")} value={v.otMode} onChange={(x) => f.set("otMode", x)}
                options={[{ value: "default", label: t("workers.otHint") }, { value: "fixed", label: t("terms.otFixedLabel") }, { value: "multiplier", label: t("terms.otMultLabel") }]} />
              {v.otMode === "fixed" && <MoneyField label={t("workers.otRate")} value={v.otRate} onChange={(x) => f.set("otRate", x)} error={f.errors.otRatePaise} />}
              {v.otMode === "multiplier" && <TextField label={t("terms.multiplier")} hint={t("terms.multiplierHint")} value={v.otMult} onChange={(x) => f.set("otMult", x)} error={f.errors.otMultiplierBp} inputMode="decimal" />}
            </>}
            {v.payType === "monthly" && <MoneyField label={t("terms.salary")} hint={t("terms.salaryHint")} value={v.salary} onChange={(x) => f.set("salary", x)} error={f.errors.monthlySalaryPaise} />}
          </div>
          <DialogActions>
            <DialogClose asChild><Button variant="secondary">{t("common.cancel")}</Button></DialogClose>
            <Button variant="primary" type="submit" disabled={f.submitting}>{t("common.save")}</Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A thekedar's contracts (spec §6.2, §6.4): value, work measured, paid, TDS 194C and balance; new contracts and measurements. */
export function ContractsCard({ worker }: { worker: Worker }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const data = useRead(`contracts:${worker.id}`, async (s) => {
    const ks = await s.query<ThekedarContract>("thekedar_contracts", { where: [{ field: "thekedarId", op: "==", value: worker.id }], orderBy: [{ field: "scope" }], limit: 20 });
    const rows = await Promise.all(ks.items.map(async (k) => {
      const [ms, ps] = await Promise.all([
        s.query<ContractMeasurement>("contract_measurements", { where: [{ field: "contractId", op: "==", value: k.id }], orderBy: [{ field: "date", dir: "desc" }], limit: 50 }),
        s.query<WorkerPayment>("worker_payments", { where: [{ field: "contractId", op: "==", value: k.id }], orderBy: [{ field: "date", dir: "desc" }], limit: 50 }),
      ]);
      return { k, ms: ms.items, ps: ps.items, ledger: thekedarLedger(k, ms.items, ps.items) };
    }));
    return rows;
  });
  const [newOpen, setNewOpen] = useState(false);
  const [measure, setMeasure] = useState<ThekedarContract | null>(null);
  if (!worker.isThekedar) return null;
  return (
    <section className="card section" aria-labelledby="contracts-title" data-contracts>
      <h2 className="card-title" id="contracts-title">{t("contracts.title")}
        <span className="aside"><Button size="sm" onClick={() => setNewOpen(true)}><Icon name="plus" />{t("contracts.new")}</Button></span>
      </h2>
      {!data ? <Skeleton /> : data.length === 0 ? <EmptyState icon="file-signature" title={t("contracts.none")} /> : data.map(({ k, ms, ledger }) => (
        <div key={k.id} className="contract-block" data-contract={k.id}>
          <h3 className="group-head">{k.scope} <span className="muted">· {k.projectName}</span></h3>
          <p className="muted small">{k.basis === "per_unit" ? t("contracts.perUnitDesc", { rate: money(k.ratePaise), unit: t(`contracts.units.${k.unit}`), qty: formatQty(k.qtyMilli ?? 0) }) : t("contracts.lumpsum")}</p>
          <dl className="dl-grid">
            <div><dt>{t("contracts.value")}</dt><dd>{money(ledger.valuePaise)}</dd></div>
            <div><dt>{t("contracts.measured")}</dt><dd>{money(ledger.measuredPaise)}</dd></div>
            <div><dt>{t("contracts.paid")}</dt><dd>{money(ledger.paidGrossPaise)}</dd></div>
            <div><dt>{t("contracts.tds")}</dt><dd>{money(ledger.tdsPaise)}</dd></div>
            <div><dt>{t("contracts.netPaid")}</dt><dd>{money(ledger.netPaidPaise)}</dd></div>
            <div><dt>{t("contracts.balance")}</dt><dd><b>{money(ledger.balanceDuePaise)}</b></dd></div>
            <div><dt>{t("contracts.remaining")}</dt><dd>{money(ledger.remainingContractPaise)}</dd></div>
          </dl>
          {!!k.milestones?.length && <p className="small">{t("contracts.milestones")}: {k.milestones.map((m) => `${m.name} (${money(m.amountPaise)})`).join(" · ")}</p>}
          <div className="page-actions" style={{ marginTop: "var(--space-3)" }}>
            <Button size="sm" variant="secondary" onClick={() => setMeasure(k)}><Icon name="plus" />{t("contracts.addMeasurement")}</Button>
            <Link className="btn btn-secondary btn-sm" href={`/labour/payments/new/?worker=${worker.id}`}><Icon name="rupee" />{t("contracts.payBill")}</Link>
          </div>
          {ms.length > 0 && (
            <MiniWrap label={`${t("contracts.measurements")}: ${k.scope}`}><table className="mini-table">
              <thead><tr><th>{t("payments.date")}</th><th className="num">{t("contracts.qty")}</th><th className="num">{t("contracts.workValue")}</th><th>{t("payments.remarks")}</th></tr></thead>
              <tbody>{ms.slice(0, 8).map((m) => <tr key={m.id}><td>{date(m.date, lang)}</td><td className="num">{m.qtyMilli != null ? formatQty(m.qtyMilli) : `${(m.pctBp ?? 0) / 100}%`}</td><td className="num">{money(m.valuePaise)}</td><td>{m.note}</td></tr>)}</tbody>
            </table></MiniWrap>
          )}
        </div>
      ))}
      {newOpen && <ContractDialog worker={worker} onClose={() => setNewOpen(false)} />}
      {measure && <MeasureDialog contract={measure} onClose={() => setMeasure(null)} />}
    </section>
  );
}

function ContractDialog({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const sites = useRead("contract-sites", (s) => s.query<Project>("projects", { where: [{ field: "isArchived", op: "==", value: false }], orderBy: [{ field: "name" }], limit: 50 }));
  const f = useForm({ projectId: "", scope: "", basis: "per_unit", unit: "sqm", rate: "", qty: "", value: "", m1: "", m1amt: "" });
  const v = f.values;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("contracts.new")} description={worker.name}>
        <form noValidate onSubmit={(e) => { e.preventDefault(); void f.submit(async (x) => {
          await run("saveThekedarContract", {
            thekedarId: worker.id, projectId: x.projectId, scope: x.scope, basis: x.basis as ThekedarContract["basis"],
            unit: x.basis === "per_unit" ? (x.unit as ThekedarContract["unit"]) : null, ratePaise: x.basis === "per_unit" ? toPaise(x.rate) : null,
            qtyMilli: x.basis === "per_unit" ? toMilli(x.qty) : null, valuePaise: x.basis === "lumpsum" ? toPaise(x.value) : undefined,
            milestones: x.m1.trim() ? [{ name: x.m1, amountPaise: toPaise(x.m1amt) }] : [],
          });
          toast(t("contracts.saved")); onClose();
        }); }}>
          <ErrorSummary summary={f.summary} errors={f.errors} />
          <div className="form-grid">
            <SelectField label={t("payments.project")} value={v.projectId} onChange={(x) => f.set("projectId", x)} error={f.errors.projectId} placeholder={t("payments.chooseProject")}
              options={(sites?.items ?? []).map((p) => ({ value: p.id, label: p.name }))} />
            <TextField label={t("contracts.scope")} hint={t("contracts.scopeHint")} value={v.scope} onChange={(x) => f.set("scope", x)} error={f.errors.scope} required />
            <SelectField label={t("contracts.basis")} value={v.basis} onChange={(x) => f.set("basis", x)} options={[{ value: "per_unit", label: t("contracts.perUnit") }, { value: "lumpsum", label: t("contracts.lumpsum") }]} />
            {v.basis === "per_unit" ? <>
              <SelectField label={t("contracts.unit")} value={v.unit} onChange={(x) => f.set("unit", x)} options={["sqft", "sqm", "m", "rmt", "cum", "nos"].map((u) => ({ value: u, label: t(`contracts.units.${u}`) }))} />
              <MoneyField label={t("contracts.rate")} value={v.rate} onChange={(x) => f.set("rate", x)} error={f.errors.ratePaise} />
              <TextField label={t("contracts.qtyScope")} value={v.qty} onChange={(x) => f.set("qty", x)} error={f.errors.qtyMilli} inputMode="decimal" />
            </> : <MoneyField label={t("contracts.value")} value={v.value} onChange={(x) => f.set("value", x)} error={f.errors.valuePaise} />}
            <TextField label={t("contracts.milestoneName")} hint={t("contracts.milestoneHint")} value={v.m1} onChange={(x) => f.set("m1", x)} error={f.errors.milestones} />
            {v.m1.trim() && <MoneyField label={t("contracts.milestoneAmount")} value={v.m1amt} onChange={(x) => f.set("m1amt", x)} />}
          </div>
          <DialogActions>
            <DialogClose asChild><Button variant="secondary">{t("common.cancel")}</Button></DialogClose>
            <Button variant="primary" type="submit" disabled={f.submitting}>{t("common.save")}</Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MeasureDialog({ contract, onClose }: { contract: ThekedarContract; onClose: () => void }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const f = useForm({ date: fromDate(todayIST()), qty: "", pct: "", note: "" });
  const v = f.values;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("contracts.addMeasurement")} description={contract.scope}>
        <form noValidate onSubmit={(e) => { e.preventDefault(); void f.submit(async (x) => {
          await run("addContractMeasurement", { contractId: contract.id, date: toDate(x.date), qtyMilli: contract.basis === "per_unit" ? toMilli(x.qty) : null, pctBp: contract.basis === "lumpsum" ? toBp(x.pct) ?? null : null, note: x.note });
          toast(t("contracts.measuredSaved")); onClose();
        }); }}>
          <ErrorSummary summary={f.summary} errors={f.errors} />
          <div className="form-grid">
            <DateField label={t("payments.date")} value={v.date} onChange={(x) => f.set("date", x)} error={f.errors.date} />
            {contract.basis === "per_unit"
              ? <TextField label={t("contracts.qtyMeasured", { unit: t(`contracts.units.${contract.unit}`) })} value={v.qty} onChange={(x) => f.set("qty", x)} error={f.errors.qtyMilli} inputMode="decimal" />
              : <TextField label={t("contracts.pctDone")} value={v.pct} onChange={(x) => f.set("pct", x)} error={f.errors.pctBp} inputMode="decimal" />}
            <TextField label={t("payments.remarks")} value={v.note} onChange={(x) => f.set("note", x)} />
          </div>
          <DialogActions>
            <DialogClose asChild><Button variant="secondary">{t("common.cancel")}</Button></DialogClose>
            <Button variant="primary" type="submit" disabled={f.submitting}>{t("common.save")}</Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A thekedar's contracts on the PM's sites, without money (QA N10, D-45): scope, unit, quantity and work measured. */
export function ContractScopesCard({ worker }: { worker: Worker }) {
  const { t } = useTranslation();
  const scopes = useRead(`scopes:${worker.id}`, (s) => s.query<ContractScope>("contract_scopes", { where: [{ field: "thekedarId", op: "==", value: worker.id }], orderBy: [{ field: "scope" }], limit: 20 }));
  if (!worker.isThekedar) return null;
  return (
    <section className="card section" aria-labelledby="scopes-title" data-contract-scopes>
      <h2 className="card-title" id="scopes-title">{t("contracts.title")}</h2>
      <p className="hint"><Icon name="info" size={16} /><span>{t("contracts.noMoneyHint")}</span></p>
      {!scopes ? <Skeleton /> : scopes.items.length === 0 ? <EmptyState icon="file-signature" title={t("contracts.none")} /> : (
        <ul className="list">{scopes.items.map((k) => (
          <li key={k.id}><Icon name="file-signature" /><span className="grow">{k.scope}<span className="meta">{k.projectName} · {k.basis === "per_unit"
            ? t("contracts.measuredOf", { done: formatQty(k.measuredQtyMilli), total: formatQty(k.qtyMilli ?? 0), unit: t(`contracts.units.${k.unit}`) })
            : t("contracts.pctDoneOf", { pct: k.measuredPctBp / 100 })}</span></span></li>
        ))}</ul>
      )}
    </section>
  );
}
