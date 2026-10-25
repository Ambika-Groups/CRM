"use client";
import { useRouter } from "next/navigation";
import {
  CommandError, formatPhone, GOVERNMENT_SUBTYPES, normaliseProject, PROJECT_STATUSES, RESIDENTIAL_SUBTYPES,
  type Client, type GovernmentCommercialInput, type Project, type ProjectInput, type User,
} from "@ag/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Skeleton, useToast } from "@/components/ui/feedback";
import {
  CheckField, DateField, ErrorSummary, fromBp, fromDate, fromPaise, MoneyField, SelectField, TextArea, TextField, toBp, toDate, toInt, toPaise, useForm,
} from "@/components/ui/form";
import { useDoc, useRead, useRun, useSession, useSmall } from "@/data/DataProvider";
import { money, date } from "@/lib/fmt";
import { useParam } from "@/lib/params";

/** Everything typed is kept as text until save, so nothing is lost when validation fails (spec §4A.8). */
interface V {
  name: string; type: Project["type"]; subtype: string; clientMode: "existing" | "new"; clientId: string;
  ncName: string; ncType: Client["type"]; ncPhone: string;
  address: string; city: string; lat: string; lng: string; startDate: string; expectedEndDate: string; actualEndDate: string;
  status: Project["status"]; budget: string; contractValue: string; managerId: string; team: string[]; notes: string; selfie: boolean; gps: boolean;
  // 2A residential
  units: string; floors: string; builtUp: string; plotArea: string; reraNo: string; reraValidity: string; contractType: string; dlp: string; handover: string;
  // 2B government
  department: string; division: string; eicName: string; eicPhone: string; tenderNo: string; tenderDate: string; nitRef: string; workOrderNo: string;
  workOrderDate: string; agreementNo: string; stipStart: string; stipEnd: string; finalBill: string; completionCert: string;
  agreementValue: string; premium: string; emdAmount: string; emdMode: string; emdRef: string; emdStatus: string; emdRefund: string;
  sd: string; pgBank: string; pgNumber: string; pgAmount: string; pgExpiry: string; deductions: { head: string; rate: string }[];
}

const EMPTY: V = {
  name: "", type: "residential", subtype: "", clientMode: "existing", clientId: "", ncName: "", ncType: "individual", ncPhone: "",
  address: "", city: "", lat: "", lng: "", startDate: "", expectedEndDate: "", actualEndDate: "", status: "planned", budget: "", contractValue: "",
  managerId: "", team: [], notes: "", selfie: false, gps: false, units: "", floors: "", builtUp: "", plotArea: "", reraNo: "", reraValidity: "", contractType: "", dlp: "", handover: "",
  department: "", division: "", eicName: "", eicPhone: "", tenderNo: "", tenderDate: "", nitRef: "", workOrderNo: "", workOrderDate: "", agreementNo: "",
  stipStart: "", stipEnd: "", finalBill: "", completionCert: "", agreementValue: "", premium: "", emdAmount: "", emdMode: "", emdRef: "", emdStatus: "",
  emdRefund: "", sd: "", pgBank: "", pgNumber: "", pgAmount: "", pgExpiry: "",
  deductions: [{ head: "TDS, income tax", rate: "2" }, { head: "GST-TDS", rate: "2" }, { head: "Labour cess", rate: "1" }, { head: "Retention", rate: "5" }],
};

const num = (s: string) => (s.trim() === "" ? null : Number(s));

function toInput(v: V): ProjectInput {
  const opt = <T,>(x: T | undefined) => (x === undefined || (typeof x === "number" && Number.isNaN(x)) ? x : x);
  const gc: GovernmentCommercialInput = {
    agreementValuePaise: v.agreementValue ? toPaise(v.agreementValue) : undefined, tenderPremiumBp: toBp(v.premium),
    emd: { amountPaise: v.emdAmount ? toPaise(v.emdAmount) : undefined, mode: (v.emdMode || undefined) as never, reference: v.emdRef, status: (v.emdStatus || undefined) as never, refundDate: toDate(v.emdRefund) || undefined },
    securityDepositPaise: v.sd ? toPaise(v.sd) : undefined,
    pg: { bank: v.pgBank, number: v.pgNumber, amountPaise: v.pgAmount ? toPaise(v.pgAmount) : undefined, expiryDate: toDate(v.pgExpiry) || undefined },
    deductionHeads: v.deductions.filter((d) => d.head.trim() || d.rate.trim()).map((d) => ({ head: d.head, rateBp: toBp(d.rate) ?? Number.NaN })),
  };
  return {
    name: v.name, type: v.type, subtype: v.subtype,
    clientId: v.clientMode === "existing" ? v.clientId || undefined : undefined,
    newClient: v.clientMode === "new" ? { name: v.ncName, type: v.ncType, phone: v.ncPhone } : undefined,
    address: v.address, city: v.city, lat: num(v.lat), lng: num(v.lng), startDate: toDate(v.startDate), expectedEndDate: toDate(v.expectedEndDate),
    actualEndDate: toDate(v.actualEndDate) || null, status: v.status, budgetPaise: toPaise(v.budget), contractValuePaise: toPaise(v.contractValue),
    managerId: v.managerId || undefined, assignedUsers: v.team, notes: v.notes,
    attendanceRequiresSelfie: v.selfie, attendanceRequiresGps: v.gps,
    residential: v.type === "residential" ? {
      units: opt(toInt(v.units)), floors: opt(toInt(v.floors)), builtUpAreaSqft: opt(toInt(v.builtUp)), plotAreaSqft: opt(toInt(v.plotArea)),
      reraNo: v.reraNo, reraValidity: toDate(v.reraValidity) || undefined, contractType: (v.contractType || undefined) as never,
      defectLiabilityMonths: opt(toInt(v.dlp)), handoverDate: toDate(v.handover) || undefined,
    } : undefined,
    government: v.type === "government" ? {
      department: v.department, division: v.division, engineerInCharge: { name: v.eicName, phone: v.eicPhone }, tenderNo: v.tenderNo,
      tenderDate: toDate(v.tenderDate) || undefined, nitRef: v.nitRef, workOrderNo: v.workOrderNo, workOrderDate: toDate(v.workOrderDate) || undefined,
      agreementNo: v.agreementNo, stipulatedStartDate: toDate(v.stipStart) || undefined, stipulatedEndDate: toDate(v.stipEnd) || undefined,
      finalBillDate: toDate(v.finalBill) || undefined, completionCertificateDate: toDate(v.completionCert) || undefined,
    } : undefined,
    governmentCommercial: v.type === "government" ? gc : undefined,
  };
}

const STEP1 = new Set(["name", "type", "subtype", "clientId", "startDate", "expectedEndDate", "actualEndDate", "status", "budgetPaise", "contractValuePaise", "location"]);

/** New project (§5.2 → §5.3 / §5.4) and edit. Owner and accountant only. */
export function ProjectForm() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const id = useParam("id");
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const users = useSmall<User>("users") ?? [];
  const clients = useRead("clients-for-picker", (s) => s.query<Client>("clients", { orderBy: [{ field: "name" }], limit: 50 }));
  const existing = useDoc<Project>("projects", id);
  const budgetDoc = useDoc<{ budgetPaise: number }>(id ? `projects/${id}/private` : "none", id ? "budget" : null);
  const commercialDoc = useDoc<{ contractValuePaise: number; government?: GovernmentCommercialInput }>(id ? `projects/${id}/private` : "none", id ? "commercial" : null);
  const f = useForm<V>(EMPTY);
  const [step, setStep] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const isEdit = !!id;

  useEffect(() => {
    if (!isEdit || loaded || !existing || budgetDoc === undefined || commercialDoc === undefined) return;
    const r = (existing.residential ?? {}) as Record<string, unknown>;
    const g = (existing.government ?? {}) as Record<string, unknown> & { engineerInCharge?: { name?: string; phone?: string } };
    const gc = commercialDoc?.government ?? {};
    f.setAll({
      ...EMPTY, name: existing.name, type: existing.type, subtype: existing.subtype, clientMode: "existing", clientId: existing.clientId,
      address: existing.address ?? "", city: existing.city ?? "", lat: existing.location ? String(existing.location.lat) : "", lng: existing.location ? String(existing.location.lng) : "",
      startDate: fromDate(existing.startDate), expectedEndDate: fromDate(existing.expectedEndDate), actualEndDate: fromDate(existing.actualEndDate ?? ""),
      status: existing.status, budget: fromPaise(budgetDoc?.budgetPaise), contractValue: fromPaise(commercialDoc?.contractValuePaise),
      managerId: existing.managerId ?? "", team: existing.assignedUsers.filter((u) => u !== existing.managerId), notes: (existing as { notes?: string }).notes ?? "", selfie: !!existing.attendanceRequiresSelfie, gps: !!existing.attendanceRequiresGps,
      units: r.units != null ? String(r.units) : "", floors: r.floors != null ? String(r.floors) : "", builtUp: r.builtUpAreaSqft != null ? String(r.builtUpAreaSqft) : "",
      plotArea: r.plotAreaSqft != null ? String(r.plotAreaSqft) : "", reraNo: (r.reraNo as string) ?? "", reraValidity: fromDate(r.reraValidity as string),
      contractType: (r.contractType as string) ?? "", dlp: r.defectLiabilityMonths != null ? String(r.defectLiabilityMonths) : "", handover: fromDate(r.handoverDate as string),
      department: (g.department as string) ?? "", division: (g.division as string) ?? "", eicName: g.engineerInCharge?.name ?? "",
      eicPhone: g.engineerInCharge?.phone ? formatPhone(g.engineerInCharge.phone) : "", tenderNo: (g.tenderNo as string) ?? "", tenderDate: fromDate(g.tenderDate as string),
      nitRef: (g.nitRef as string) ?? "", workOrderNo: (g.workOrderNo as string) ?? "", workOrderDate: fromDate(g.workOrderDate as string), agreementNo: (g.agreementNo as string) ?? "",
      stipStart: fromDate(g.stipulatedStartDate as string), stipEnd: fromDate(g.stipulatedEndDate as string), finalBill: fromDate(g.finalBillDate as string),
      completionCert: fromDate(g.completionCertificateDate as string), agreementValue: fromPaise(gc.agreementValuePaise), premium: fromBp(gc.tenderPremiumBp),
      emdAmount: fromPaise(gc.emd?.amountPaise), emdMode: gc.emd?.mode ?? "", emdRef: gc.emd?.reference ?? "", emdStatus: gc.emd?.status ?? "",
      emdRefund: fromDate(gc.emd?.refundDate), sd: fromPaise(gc.securityDepositPaise), pgBank: gc.pg?.bank ?? "", pgNumber: gc.pg?.number ?? "",
      pgAmount: fromPaise(gc.pg?.amountPaise), pgExpiry: fromDate(gc.pg?.expiryDate),
      deductions: (gc.deductionHeads ?? []).map((d) => ({ head: d.head, rate: fromBp(d.rateBp) })),
    });
    setLoaded(true);
  }, [isEdit, loaded, existing, budgetDoc, commercialDoc, f]);

  const v = f.values;
  const subtypes = v.type === "government" ? GOVERNMENT_SUBTYPES : RESIDENTIAL_SUBTYPES;
  const pms = users.filter((u) => u.role === "pm" || u.role === "owner");
  const staff = users.filter((u) => u.role === "pm" || u.role === "supervisor");
  const title = isEdit ? t("projects.edit") : t("projects.new");

  /** Validate with the same core function the command uses; keep only this step's errors. */
  const check = (forStep: number): boolean => {
    try {
      const input = toInput(f.values);
      if (f.values.clientMode === "new" && !f.values.ncName.trim()) throw new CommandError("x", { clientId: t("projects.chooseClient") });
      normaliseProject(input);
      f.setErrors({});
      return true;
    } catch (e) {
      if (!(e instanceof CommandError)) throw e;
      const mine = Object.fromEntries(Object.entries(e.fields).filter(([k]) => (forStep === 1 ? STEP1.has(k) : !STEP1.has(k))));
      if (forStep === 3 || Object.keys(mine).length) {
        f.setErrors(forStep === 3 ? e.fields : mine, e.message);
        if (forStep === 3) setStep(Object.keys(e.fields).some((k) => STEP1.has(k)) ? 1 : 2);
        return false;
      }
      f.setErrors({});
      return true;
    }
  };

  const save = () => f.submit(async (vals) => {
    const input = toInput(vals);
    if (isEdit) {
      await run("updateProject", { id: id!, input });
      toast(t("projects.saved"));
      router.push(`/projects/view/?id=${id}`);
    } else {
      const newId = await run("createProject", { input });
      toast(t("projects.created"));
      router.push(`/projects/view/?id=${newId}`);
    }
  });

  const clientName = useMemo(() => clients?.items.find((c) => c.id === v.clientId)?.name ?? "", [clients, v.clientId]);
  if (session && !(session.role === "owner" || session.role === "accountant")) {
    return <AppShell nav="projects" title={title} crumbs={[{ label: t("nav.projects"), href: "/projects/" }, { label: title }]}><NoAccess name={title} /></AppShell>;
  }

  const steps = [t("projects.stepCommon"), t("projects.stepType"), t("projects.stepReview")];
  return (
    <AppShell nav="projects" title={title} crumbs={[{ label: t("nav.projects"), href: "/projects/" }, { label: title }]}>
      <div className="page-head"><div className="heading"><h1>{title}</h1><p className="sub">{t("form.stepOf", { n: step, total: 3 })}</p></div></div>
      <ol className="steps-bar">
        {steps.map((s, i) => (
          <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={step > i + 1 ? "done" : undefined}><b>{i + 1}</b>{s}</li>
        ))}
      </ol>
      {isEdit && !loaded ? <Skeleton lines={8} /> : (
        <form className="card" noValidate onSubmit={(e) => { e.preventDefault(); if (step < 3) { if (check(step)) setStep(step + 1); } else if (check(3)) void save(); }}>
          <ErrorSummary summary={f.summary} errors={f.errors} />

          {step === 1 && (
            <>
              <div className="form-section">
                <h2>{t("projects.stepCommon")}</h2>
                <div className="form-grid two">
                  <TextField label={t("projects.name")} hint={t("projects.nameHint")} value={v.name} onChange={(x) => f.set("name", x)} error={f.errors.name} required />
                  <SelectField label={t("projects.type")} value={v.type} error={f.errors.type}
                    onChange={(x) => { f.set("type", x); f.set("subtype", ""); }}
                    options={(["residential", "government"] as const).map((x) => ({ value: x, label: t(`projects.${x}`) }))} />
                  <SelectField label={t("projects.subtype")} value={v.subtype} onChange={(x) => f.set("subtype", x)} error={f.errors.subtype} placeholder="—"
                    options={subtypes.map((x) => ({ value: x, label: t(`projects.${x}`) }))} />
                  <SelectField label={t("projects.status")} value={v.status} onChange={(x) => f.set("status", x)} error={f.errors.status}
                    options={PROJECT_STATUSES.map((x) => ({ value: x, label: t(`projects.${x}`) }))} />
                </div>
              </div>
              <div className="form-section">
                <h2>{t("projects.client")}</h2>
                <div className="form-grid two">
                  <SelectField label={t("projects.client")} value={v.clientMode === "new" ? "__new" : v.clientId} error={f.errors.clientId} placeholder={t("projects.chooseClient")}
                    onChange={(x) => { if (x === "__new") f.set("clientMode", "new"); else { f.set("clientMode", "existing"); f.set("clientId", x); } }}
                    options={[...(clients?.items ?? []).map((c) => ({ value: c.id, label: c.name })), { value: "__new", label: `+ ${t("projects.newClient")}` }]} />
                  {v.clientMode === "new" && (
                    <>
                      <TextField label={t("clients.name")} value={v.ncName} onChange={(x) => f.set("ncName", x)} error={f.errors.name && v.clientMode === "new" ? undefined : undefined} />
                      <SelectField label={t("clients.type")} value={v.ncType} onChange={(x) => f.set("ncType", x)} options={(["individual", "builder", "government"] as const).map((x) => ({ value: x, label: t(`clients.${x}`) }))} />
                      <TextField label={t("clients.phone")} hint={t("clients.phoneHint")} value={v.ncPhone} onChange={(x) => f.set("ncPhone", x)} inputMode="tel" />
                    </>
                  )}
                </div>
              </div>
              <div className="form-section">
                <h2>{t("projects.location")}</h2>
                <div className="form-grid two">
                  <TextField label={t("projects.address")} value={v.address} onChange={(x) => f.set("address", x)} />
                  <TextField label={t("projects.city")} value={v.city} onChange={(x) => f.set("city", x)} />
                  <TextField label={`${t("projects.gps")}: ${t("projects.lat")}`} value={v.lat} onChange={(x) => f.set("lat", x)} error={f.errors.location} inputMode="decimal" />
                  <TextField label={`${t("projects.gps")}: ${t("projects.lng")}`} value={v.lng} onChange={(x) => f.set("lng", x)} inputMode="decimal" />
                </div>
              </div>
              <div className="form-section">
                <h2>{t("projects.contractInfo")}</h2>
                <div className="form-grid two">
                  <DateField label={t("projects.startDate")} value={v.startDate} onChange={(x) => f.set("startDate", x)} error={f.errors.startDate} required />
                  <DateField label={t("projects.expectedEndDate")} value={v.expectedEndDate} onChange={(x) => f.set("expectedEndDate", x)} error={f.errors.expectedEndDate} required />
                  {isEdit && <DateField label={t("projects.actualEndDate")} value={v.actualEndDate} onChange={(x) => f.set("actualEndDate", x)} error={f.errors.actualEndDate} />}
                  <MoneyField label={t("projects.budget")} value={v.budget} onChange={(x) => f.set("budget", x)} error={f.errors.budgetPaise} hint="e.g. 46,00,000" />
                  <MoneyField label={t("projects.contractValue")} value={v.contractValue} onChange={(x) => f.set("contractValue", x)} error={f.errors.contractValuePaise} hint="e.g. 48,50,000" />
                </div>
              </div>
              <div className="form-section">
                <h2>{t("projects.team")}</h2>
                <div className="form-grid two">
                  <SelectField label={t("projects.manager")} value={v.managerId} onChange={(x) => f.set("managerId", x)} placeholder={t("projects.notAssigned")}
                    options={pms.map((u) => ({ value: u.id, label: u.name }))} />
                  <fieldset className="field" disabled={session?.role !== "owner"}>
                    <legend>{t("projects.team")}</legend>
                    <span className="hint-line">{session?.role === "owner" ? t("projects.teamHint") : t("settings.readOnly")}</span>
                    {staff.filter((u) => u.id !== v.managerId).map((u) => (
                      <CheckField key={u.id} label={u.name} checked={v.team.includes(u.id)}
                        onChange={(c) => f.set("team", c ? [...v.team, u.id] : v.team.filter((x) => x !== u.id))} disabled={session?.role !== "owner"} />
                    ))}
                  </fieldset>
                  <fieldset className="field span-2" data-checkin-options>
                    <legend>{t("projects.attendanceCheckin")}</legend>
                    <span className="hint-line">{t("projects.attendanceCheckinHint")}</span>
                    <CheckField label={t("projects.requireSelfie")} checked={v.selfie} onChange={(x) => f.set("selfie", x)} />
                    <CheckField label={t("projects.requireGps")} checked={v.gps} onChange={(x) => f.set("gps", x)} />
                  </fieldset>
                  <div className="span-2"><TextArea label={t("projects.notes")} value={v.notes} onChange={(x) => f.set("notes", x)} /></div>
                </div>
              </div>
            </>
          )}

          {step === 2 && v.type === "residential" && (
            <div className="form-section">
              <h2>{t("projects.residential")}</h2>
              <div className="form-grid two">
                <TextField label={t("projects.units")} value={v.units} onChange={(x) => f.set("units", x)} error={f.errors.units} inputMode="numeric" />
                <TextField label={t("projects.floors")} value={v.floors} onChange={(x) => f.set("floors", x)} error={f.errors.floors} inputMode="numeric" />
                <TextField label={t("projects.builtUp")} value={v.builtUp} onChange={(x) => f.set("builtUp", x)} error={f.errors.builtUpAreaSqft} inputMode="numeric" />
                <TextField label={t("projects.plotArea")} value={v.plotArea} onChange={(x) => f.set("plotArea", x)} error={f.errors.plotAreaSqft} inputMode="numeric" />
                <TextField label={t("projects.reraNo")} value={v.reraNo} onChange={(x) => f.set("reraNo", x)} />
                <DateField label={t("projects.reraValidity")} value={v.reraValidity} onChange={(x) => f.set("reraValidity", x)} error={f.errors.reraValidity} />
                <SelectField label={t("projects.contractType")} value={v.contractType} onChange={(x) => f.set("contractType", x)} error={f.errors.contractType} placeholder="—"
                  options={(["lump_sum", "per_sqft", "cost_plus"] as const).map((x) => ({ value: x, label: t(`projects.${x}`) }))} />
                <TextField label={t("projects.dlp")} value={v.dlp} onChange={(x) => f.set("dlp", x)} error={f.errors.defectLiabilityMonths} inputMode="numeric" />
                <DateField label={t("projects.handover")} value={v.handover} onChange={(x) => f.set("handover", x)} error={f.errors.handoverDate} />
              </div>
              <p className="hint"><Icon name="info" size={16} /><span>{t("projects.addLater")}</span></p>
            </div>
          )}

          {step === 2 && v.type === "government" && (
            <>
              <div className="form-section">
                <h2>{t("projects.government")}</h2>
                <div className="form-grid two">
                  <TextField label={t("projects.department")} value={v.department} onChange={(x) => f.set("department", x)} error={f.errors.department} required />
                  <TextField label={t("projects.division")} value={v.division} onChange={(x) => f.set("division", x)} />
                  <TextField label={t("projects.eic")} value={v.eicName} onChange={(x) => f.set("eicName", x)} />
                  <TextField label={t("projects.eicPhone")} value={v.eicPhone} onChange={(x) => f.set("eicPhone", x)} error={f.errors.engineerPhone} inputMode="tel" />
                  <TextField label={t("projects.tenderNo")} value={v.tenderNo} onChange={(x) => f.set("tenderNo", x)} />
                  <DateField label={t("projects.tenderDate")} value={v.tenderDate} onChange={(x) => f.set("tenderDate", x)} error={f.errors.tenderDate} />
                  <TextField label={t("projects.nitRef")} value={v.nitRef} onChange={(x) => f.set("nitRef", x)} />
                  <TextField label={t("projects.workOrderNo")} value={v.workOrderNo} onChange={(x) => f.set("workOrderNo", x)} />
                  <DateField label={t("projects.workOrderDate")} value={v.workOrderDate} onChange={(x) => f.set("workOrderDate", x)} error={f.errors.workOrderDate} />
                  <TextField label={t("projects.agreementNo")} value={v.agreementNo} onChange={(x) => f.set("agreementNo", x)} />
                  <DateField label={t("projects.stipStart")} value={v.stipStart} onChange={(x) => f.set("stipStart", x)} error={f.errors.stipulatedStartDate} />
                  <DateField label={t("projects.stipEnd")} value={v.stipEnd} onChange={(x) => f.set("stipEnd", x)} error={f.errors.stipulatedEndDate} />
                  {isEdit && <DateField label={t("projects.finalBill")} value={v.finalBill} onChange={(x) => f.set("finalBill", x)} error={f.errors.finalBillDate} />}
                  {isEdit && <DateField label={t("projects.completionCert")} value={v.completionCert} onChange={(x) => f.set("completionCert", x)} error={f.errors.completionCertificateDate} />}
                </div>
              </div>
              <div className="form-section">
                <h2>{t("projects.contractInfo")}</h2>
                <div className="form-grid two">
                  <MoneyField label={t("projects.agreementValue")} value={v.agreementValue} onChange={(x) => f.set("agreementValue", x)} error={f.errors.agreementValuePaise} />
                  <TextField label={t("projects.premium")} hint={t("projects.premiumHint")} value={v.premium} onChange={(x) => f.set("premium", x)} error={f.errors.tenderPremiumBp} inputMode="decimal" />
                  <MoneyField label={`${t("projects.emdAmount")}`} hint={t("projects.emdHint")} value={v.emdAmount} onChange={(x) => f.set("emdAmount", x)} />
                  <SelectField label={t("projects.emdMode")} value={v.emdMode} onChange={(x) => f.set("emdMode", x)} placeholder="—" options={(["dd", "bg", "fdr", "online"] as const).map((x) => ({ value: x, label: t(`projects.${x}`) }))} />
                  <TextField label={t("projects.emdRef")} value={v.emdRef} onChange={(x) => f.set("emdRef", x)} />
                  <SelectField label={t("projects.emdStatus")} value={v.emdStatus} onChange={(x) => f.set("emdStatus", x)} placeholder="—" options={(["held", "refunded", "converted_to_sd", "forfeited"] as const).map((x) => ({ value: x, label: t(`projects.${x}`) }))} />
                  <DateField label={t("projects.emdRefund")} value={v.emdRefund} onChange={(x) => f.set("emdRefund", x)} error={f.errors.emdRefundDate} />
                  <MoneyField label={t("projects.sd")} value={v.sd} onChange={(x) => f.set("sd", x)} />
                  <TextField label={t("projects.pgBank")} hint={t("projects.pgHint")} value={v.pgBank} onChange={(x) => f.set("pgBank", x)} />
                  <TextField label={t("projects.pgNumber")} value={v.pgNumber} onChange={(x) => f.set("pgNumber", x)} />
                  <MoneyField label={t("projects.pgAmount")} value={v.pgAmount} onChange={(x) => f.set("pgAmount", x)} />
                  <DateField label={t("projects.pgExpiry")} value={v.pgExpiry} onChange={(x) => f.set("pgExpiry", x)} error={f.errors.pgExpiry} />
                </div>
              </div>
              <div className="form-section">
                <h2>{t("projects.deductions")}</h2>
                <p className="hint"><Icon name="info" size={16} /><span>{t("projects.deductionsHint")}</span></p>
                {f.errors.deductionHeads ? <span className="field-error"><Icon name="alert" size={16} />{f.errors.deductionHeads}</span> : null}
                {v.deductions.map((d, i) => (
                  <div className="form-grid two" key={i}>
                    <TextField label={`${t("projects.deductionHead")} ${i + 1}`} value={d.head} onChange={(x) => f.set("deductions", v.deductions.map((y, j) => (j === i ? { ...y, head: x } : y)))} />
                    <TextField label={t("projects.rate")} value={d.rate} onChange={(x) => f.set("deductions", v.deductions.map((y, j) => (j === i ? { ...y, rate: x } : y)))} inputMode="decimal" />
                  </div>
                ))}
                <div><Button size="sm" onClick={() => f.set("deductions", [...v.deductions, { head: "", rate: "" }])}><Icon name="plus" />{t("projects.addDeduction")}</Button></div>
                <p className="hint"><Icon name="info" size={16} /><span>{t("projects.raLater")} {t("projects.emdLater")}</span></p>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="form-section">
              <h2>{t("projects.stepReview")}</h2>
              <p className="muted">{t("projects.review")}</p>
              <dl className="dl-grid three">
                <div><dt>{t("projects.name")}</dt><dd>{v.name || "—"}</dd></div>
                <div><dt>{t("projects.type")}</dt><dd>{t(`projects.${v.type}`)}{v.subtype ? ` · ${t(`projects.${v.subtype}`)}` : ""}</dd></div>
                <div><dt>{t("projects.client")}</dt><dd>{v.clientMode === "new" ? `${v.ncName} (${t("projects.newClient")})` : clientName || "—"}</dd></div>
                <div><dt>{t("projects.startDate")}</dt><dd>{date(toDate(v.startDate), lang)}</dd></div>
                <div><dt>{t("projects.expectedEndDate")}</dt><dd>{date(toDate(v.expectedEndDate), lang)}</dd></div>
                <div><dt>{t("projects.status")}</dt><dd>{t(`projects.${v.status}`)}</dd></div>
                <div><dt>{t("projects.budget")}</dt><dd>{v.budget.trim() ? money(toPaise(v.budget)) : t("common.notEntered")}</dd></div>
                <div><dt>{t("projects.contractValue")}</dt><dd>{v.contractValue.trim() ? money(toPaise(v.contractValue)) : t("common.notEntered")}</dd></div>
                <div><dt>{t("projects.manager")}</dt><dd>{users.find((u) => u.id === v.managerId)?.name ?? t("projects.notAssigned")}</dd></div>
                {v.type === "government"
                  ? <div><dt>{t("projects.department")}</dt><dd>{v.department || "—"}</dd></div>
                  : <div><dt>{t("projects.contractType")}</dt><dd>{v.contractType ? t(`projects.${v.contractType}`) : "—"}</dd></div>}
              </dl>
            </div>
          )}

          <div className="form-actions">
            {step > 1
              ? <Button onClick={() => { f.setErrors({}); setStep(step - 1); }}><Icon name="back" />{t("common.back")}</Button>
              : <Link className="btn btn-secondary" href={isEdit ? `/projects/view/?id=${id}` : "/projects/"}>{t("common.cancel")}</Link>}
            <Button variant="primary" type="submit" disabled={f.submitting}>
              {step < 3 ? <>{t("common.next")}<Icon name="chevron-right" /></> : f.submitting ? t("common.saving") : isEdit ? t("common.save") : t("projects.create")}
            </Button>
          </div>
        </form>
      )}
    </AppShell>
  );
}
