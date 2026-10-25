"use client";
import { canOpen, defaultOtRatePaise, formatINR, isFinanceRole, type Project, type Worker, type WorkerPay } from "@ag/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { NoAccess, NotFoundRecord } from "@/components/ModulePage";
import { Skeleton, StatusBadge, useToast } from "@/components/ui/feedback";
import { CheckField, ErrorSummary, MoneyField, SelectField, TextArea, TextField, toBp, toPaise, fromBp, useForm } from "@/components/ui/form";
import { useDoc, useDocStatus, useDocs, useRun, useSession, useSmall } from "@/data/DataProvider";
import { dash, date, phone } from "@/lib/fmt";
import { useParam } from "@/lib/params";
import { ContractScopesCard, ContractsCard, LedgerCard, PayTermsCard } from "@/components/labour/WorkerMoney";

interface Kyc {
  address?: string; idProofType?: string | null; idProofNumberMasked?: string | null; maskedConfirmed?: boolean; bank?: { accountNo?: string; ifsc?: string } | null;
  upiId?: string | null; pan?: string | null; gstin?: string | null; tdsRateBp?: number | null;
}

/** One worker (spec §6.1): master fields, sites, KYC for finance roles (D-22), rate proposal for PMs (D-32). */
export function WorkerView() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const id = useParam("id");
  const session = useSession();
  const worker = useDoc<Worker>("workers", id);
  const status = useDocStatus("workers", id);
  const finance = !!session && isFinanceRole(session.role);
  const pay = useDoc<WorkerPay>(finance && id ? `workers/${id}/private` : "none", finance && id ? "pay" : null);
  const kyc = useDoc<Kyc>(finance && id ? `workers/${id}/private` : "none", finance && id ? "kyc" : null);
  const sites = useDocs<Project>("projects", worker?.siteIds ?? []);
  const name = worker?.name ?? t("workers.title");
  const roles = (useSmall<{ id: string; workerRoles?: { key: string; label: string; labelHi?: string }[] }>("settings") ?? []).find((s) => s.id === "operations")?.workerRoles ?? [];
  const roleOf = (k: string) => { const r = roles.find((x) => x.key === k); return r ? (lang === "hi" && r.labelHi ? r.labelHi : r.label) : k; };

  return (
    <AppShell nav="labour" title={name} crumbs={[{ label: t("nav.labour"), href: "/labour/" }, { label: name }]}>
      {session && !canOpen(session.role, "labour") ? <NoAccess name={name} /> : worker === undefined || id === undefined ? <Skeleton lines={6} /> : worker === null ? (status === "denied" ? <NoAccess name={name} /> : status === undefined ? <Skeleton lines={4} /> : <NotFoundRecord name={name} back="/labour/" backLabel={t("nav.labour")} />) : (
        <>
          <div className="page-head">
            <div className="heading">
              <h1>{worker.name}</h1>
              <div className="facts"><span>{roleOf(worker.role)}</span>{worker.thekedarName ? <span>{t("workers.thekedar")}: {worker.thekedarName}</span> : null}<StatusBadge kind={worker.active ? "active" : "inactive"} /></div>
            </div>
            {session && (finance || session.role === "pm") && (
              <div className="page-actions"><Link className="btn btn-secondary" href={`/labour/workers/edit/?id=${worker.id}`}><Icon name="edit" />{t("common.edit")}</Link></div>
            )}
          </div>
          <div className="grid grid-2-1">
            <section className="card">
              <h2 className="card-title">{t("workers.details")}</h2>
              <dl className="dl-grid">
                <div><dt>{t("workers.phone")}</dt><dd>{phone(worker.phone)}</dd></div>
                <div><dt>{t("workers.payType")}</dt><dd>{worker.defaultPayType ? t(`workers.${worker.defaultPayType}`) : "—"}</dd></div>
                {finance && <>
                  <div><dt>{t("workers.rate")}</dt><dd>{pay?.defaultRatePaise ? formatINR(pay.defaultRatePaise) : "—"}</dd></div>
                  <div><dt>{t("workers.otRate")}</dt><dd>{pay?.otRatePaise ? formatINR(pay.otRatePaise) : pay?.defaultRatePaise ? t("workers.otDefault", { amount: formatINR(defaultOtRatePaise(pay.defaultRatePaise)) }) : "—"}</dd></div>
                </>}
                <div><dt>{t("workers.joining")}</dt><dd>{date(worker.joiningDate, lang)}</dd></div>
                <div><dt>{t("workers.emergency")}</dt><dd>{dash(worker.emergencyContact)}</dd></div>
              </dl>
            </section>
            <section className="card">
              <h2 className="card-title">{t("workers.sites")}</h2>
              {(sites ?? []).filter(Boolean).length === 0 ? <p className="muted">{t("common.none")}</p> : (
                <ul className="list">{(sites ?? []).filter((p): p is Project => !!p).map((p) => <li key={p.id}><Icon name="folder" /><Link className="grow" href={`/projects/view/?id=${p.id}&tab=workforce`}>{p.name}</Link></li>)}</ul>
              )}
            </section>
          </div>
          {finance && <LedgerCard worker={worker} />}
          {finance && <ContractsCard worker={worker} />}
          {finance && <PayTermsCard worker={worker} />}
          {session?.role === "pm" && worker.isThekedar && <ContractScopesCard worker={worker} />}
          {finance && kyc !== undefined && <KycCard workerId={worker.id} isThekedar={worker.isThekedar} kyc={kyc} />}
          {session?.role === "pm" && <ProposeRate worker={worker} projectIds={session.projectIds.filter((p) => worker.siteIds?.includes(p))} />}
        </>
      )}
    </AppShell>
  );
}

function KycCard({ workerId, isThekedar, kyc }: { workerId: string; isThekedar: boolean; kyc: Kyc | null }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const f = useForm({ address: "", idProofType: "aadhaar_masked", idProofLast4: "", maskedConfirmed: false, bankAccountNo: "", ifsc: "", upiId: "", pan: "", gstin: "", tds: "" });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded) return;
    f.setAll({
      address: kyc?.address ?? "", idProofType: kyc?.idProofType ?? "aadhaar_masked", idProofLast4: kyc?.idProofNumberMasked ?? "",
      maskedConfirmed: kyc?.maskedConfirmed ?? false, bankAccountNo: kyc?.bank?.accountNo ?? "", ifsc: kyc?.bank?.ifsc ?? "", upiId: kyc?.upiId ?? "",
      pan: kyc?.pan ?? "", gstin: kyc?.gstin ?? "", tds: fromBp(kyc?.tdsRateBp ?? null),
    });
    setLoaded(true);
  }, [kyc, loaded, f]);
  const v = f.values;
  return (
    <section className="card section" aria-labelledby="kyc-title">
      <h2 className="card-title" id="kyc-title"><Icon name="lock" />{t("workers.kyc")}</h2>
      <p className="hint"><Icon name="info" size={16} /><span>{t("workers.kycHint")}</span></p>
      <form noValidate onSubmit={(e) => {
        e.preventDefault();
        void f.submit(async (x) => {
          await run("saveKyc", { workerId, input: {
            address: x.address, idProofType: x.idProofType as never, idProofLast4: x.idProofLast4, maskedConfirmed: x.maskedConfirmed,
            bankAccountNo: x.bankAccountNo, ifsc: x.ifsc, upiId: x.upiId, pan: x.pan, gstin: x.gstin, tdsRateBp: x.tds ? toBp(x.tds) : null,
          } });
          toast(t("workers.kycSaved"));
        });
      }}>
        <ErrorSummary summary={f.summary} errors={f.errors} />
        <div className="form-grid two" style={{ marginTop: "var(--space-4)" }}>
          <SelectField label={t("workers.idType")} value={v.idProofType} onChange={(x) => f.set("idProofType", x)}
            options={["aadhaar_masked", "voter_id", "driving_licence", "other"].map((k) => ({ value: k, label: t(`workers.${k}`) }))} />
          <TextField label={t("workers.last4")} value={v.idProofLast4} onChange={(x) => f.set("idProofLast4", x)} error={f.errors.idProofLast4} inputMode="numeric" />
          {v.idProofType === "aadhaar_masked" && (
            <div className="span-2"><CheckField label={t("workers.masked")} hint={t("workers.maskedHint")} checked={v.maskedConfirmed} onChange={(x) => f.set("maskedConfirmed", x)} error={f.errors.maskedConfirmed} /></div>
          )}
          <div className="span-2"><TextArea label={t("workers.address")} value={v.address} onChange={(x) => f.set("address", x)} rows={2} /></div>
          <TextField label={t("workers.bankAccount")} value={v.bankAccountNo} onChange={(x) => f.set("bankAccountNo", x)} error={f.errors.bankAccountNo} inputMode="numeric" />
          <TextField label={t("workers.ifsc")} value={v.ifsc} onChange={(x) => f.set("ifsc", x)} error={f.errors.ifsc} />
          <TextField label={t("workers.upi")} value={v.upiId} onChange={(x) => f.set("upiId", x)} />
          {isThekedar && <>
            <TextField label={t("workers.pan")} value={v.pan} onChange={(x) => f.set("pan", x)} error={f.errors.pan} />
            <TextField label={t("workers.gstin")} value={v.gstin} onChange={(x) => f.set("gstin", x)} />
            <TextField label={t("workers.tds")} hint={t("workers.tdsHint")} value={v.tds} onChange={(x) => f.set("tds", x)} error={f.errors.tdsRateBp} inputMode="decimal" />
          </>}
        </div>
        <div className="form-actions"><Button variant="primary" type="submit" disabled={f.submitting}>{f.submitting ? t("common.saving") : t("common.save")}</Button></div>
      </form>
    </section>
  );
}

function ProposeRate({ worker, projectIds }: { worker: Worker; projectIds: string[] }) {
  const { t } = useTranslation();
  const run = useRun();
  const toast = useToast();
  const f = useForm({ rate: "", reason: "" });
  return (
    <section className="card section">
      <h2 className="card-title">{t("workers.proposeRate")}</h2>
      <p className="hint"><Icon name="info" size={16} /><span>{t("workers.rateLocked")}</span></p>
      <form noValidate onSubmit={(e) => {
        e.preventDefault();
        void f.submit(async (x) => {
          await run("requestRateChange", { workerId: worker.id, projectId: projectIds[0] ?? null, proposedRatePaise: toPaise(x.rate), reason: x.reason });
          toast(t("workers.proposalSent"));
          f.setAll({ rate: "", reason: "" });
        });
      }}>
        <ErrorSummary summary={f.summary} errors={f.errors} />
        <div className="form-grid two" style={{ marginTop: "var(--space-4)" }}>
          <MoneyField label={t("workers.proposed")} value={f.values.rate} onChange={(x) => f.set("rate", x)} error={f.errors.proposedRatePaise} />
          <TextField label={t("workers.proposalReason")} value={f.values.reason} onChange={(x) => f.set("reason", x)} error={f.errors.reason} />
        </div>
        <div className="form-actions"><Button type="submit" disabled={f.submitting}>{t("workers.proposeRate")}</Button></div>
      </form>
    </section>
  );
}
