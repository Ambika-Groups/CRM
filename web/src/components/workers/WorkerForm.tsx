"use client";
import { useRouter } from "next/navigation";
import { formatPhone, isFinanceRole, type Worker, type WorkerPay } from "@ag/core";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Skeleton, useToast } from "@/components/ui/feedback";
import { CheckField, DateField, ErrorSummary, fromDate, fromPaise, MoneyField, SelectField, TextField, toDate, toPaise, useForm } from "@/components/ui/form";
import { useDoc, useRead, useRun, useSession, useSmall } from "@/data/DataProvider";
import { useParam } from "@/lib/params";
import { thekedarsOf, usePmWorkers } from "./pmRoster";

interface V { name: string; phone: string; role: string; thekedarId: string; isThekedar: boolean; payType: string; rate: string; otRate: string; joining: string; active: boolean; emergency: string }
const EMPTY: V = { name: "", phone: "", role: "labour", thekedarId: "", isThekedar: false, payType: "daily", rate: "", otRate: "", joining: "", active: true, emergency: "" };

/** Add or edit a worker (spec §6.1). Rate fields are for the owner and accountant only (D-32). */
export function WorkerForm() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = i18n.language === "hi" ? "hi" : "en";
  const id = useParam("id");
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const existing = useDoc<Worker>("workers", id);
  const roles = (useSmall<{ id: string; workerRoles?: { key: string; label: string; labelHi?: string; active?: boolean }[] }>("settings") ?? []).find((s) => s.id === "operations")?.workerRoles ?? [];
  const thekedarQuery = useRead("form-thekedars", (s) => (isFinanceRole(session?.role ?? "viewer")
    ? s.query<Worker>("workers", { where: [{ field: "isThekedar", op: "==", value: true }], orderBy: [{ field: "name" }], limit: 50 })
    : Promise.resolve({ items: [] as Worker[], next: null, total: 0 })));
  const pmWorkers = usePmWorkers();
  const thekedars = session?.role === "pm" ? thekedarsOf(pmWorkers ?? []) : (thekedarQuery?.items ?? []);
  const f = useForm<V>(EMPTY);
  const pay = useDoc<WorkerPay>(isFinanceRole(session?.role ?? "viewer") && id ? `workers/${id}/private` : "none", isFinanceRole(session?.role ?? "viewer") && id ? "pay" : null);
  const [loaded, setLoaded] = useState(false);
  const finance = !!session && isFinanceRole(session.role);

  useEffect(() => {
    if (existing && !loaded && (pay !== undefined || !finance)) {
      f.setAll({
        name: existing.name, phone: existing.phone ? formatPhone(existing.phone) : "", role: existing.role, thekedarId: existing.thekedarId ?? "",
        isThekedar: existing.isThekedar, payType: existing.defaultPayType ?? "daily", rate: fromPaise(pay?.defaultRatePaise), otRate: fromPaise(pay?.otRatePaise ?? undefined),
        joining: fromDate(existing.joiningDate), active: existing.active, emergency: existing.emergencyContact ?? "",
      });
      setLoaded(true);
    }
  }, [existing, loaded, f, pay, finance]);

  const title = id ? t("workers.edit") : t("workers.new");
  if (session && !(finance || session.role === "pm")) {
    return <AppShell nav="labour" title={title} crumbs={[{ label: t("nav.labour"), href: "/labour/" }, { label: title }]}><NoAccess name={title} /></AppShell>;
  }
  const v = f.values;
  const save = () => f.submit(async (x) => {
    const input = {
      name: x.name, phone: x.phone, role: x.role, thekedarId: x.thekedarId || null, joiningDate: toDate(x.joining) || undefined, active: x.active, emergencyContact: x.emergency,
      ...(finance ? { isThekedar: x.isThekedar || x.role === "thekedar", defaultPayType: x.payType as Worker["defaultPayType"], defaultRatePaise: toPaise(x.rate), otRatePaise: x.otRate ? toPaise(x.otRate) : undefined } : {}),
    };
    const wid = await run("saveWorker", { id: id ?? null, input });
    toast(t("workers.saved"));
    router.push(`/labour/workers/view/?id=${wid}`);
  });

  return (
    <AppShell nav="labour" title={title} crumbs={[{ label: t("nav.labour"), href: "/labour/" }, { label: title }]}>
      <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
      {id && existing === undefined ? <Skeleton lines={6} /> : (
        <form className="card" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <ErrorSummary summary={f.summary} errors={f.errors} />
          <div className="form-grid two">
            <TextField label={t("workers.name")} value={v.name} onChange={(x) => f.set("name", x)} error={f.errors.name} required />
            <TextField label={t("workers.phone")} hint={t("clients.phoneHint")} value={v.phone} onChange={(x) => f.set("phone", x)} error={f.errors.phone} inputMode="tel" />
            <SelectField label={t("workers.role")} value={v.role} onChange={(x) => f.set("role", x)} error={f.errors.role}
              options={roles.filter((r) => r.active !== false).map((r) => ({ value: r.key, label: lang === "hi" && r.labelHi ? r.labelHi : r.label }))} />
            <SelectField label={t("workers.thekedar")} hint={t("workers.thekedarHint")} value={v.thekedarId} onChange={(x) => f.set("thekedarId", x)} error={f.errors.thekedarId}
              placeholder={t("workers.none")} options={thekedars.filter((w) => w.id !== id).map((w) => ({ value: w.id, label: w.name }))} />
            <DateField label={t("workers.joining")} value={v.joining} onChange={(x) => f.set("joining", x)} error={f.errors.joiningDate} />
            <TextField label={t("workers.emergency")} value={v.emergency} onChange={(x) => f.set("emergency", x)} />
            <CheckField label={t("workers.active")} checked={v.active} onChange={(x) => f.set("active", x)} />
          </div>
          <div className="form-section" style={{ marginTop: "var(--space-8)" }}>
            <h2>{t("workers.payType")}</h2>
            {finance ? (
              <div className="form-grid two">
                <CheckField label={t("workers.isThekedar")} checked={v.isThekedar} onChange={(x) => f.set("isThekedar", x)} />
                <SelectField label={t("workers.payType")} value={v.payType} onChange={(x) => f.set("payType", x)} error={f.errors.defaultPayType}
                  options={["daily", "contract", "monthly"].map((k) => ({ value: k, label: t(`workers.${k}`) }))} />
                <MoneyField label={t("workers.rate")} value={v.rate} onChange={(x) => f.set("rate", x)} error={f.errors.defaultRatePaise} hint="e.g. 500" />
                <MoneyField label={t("workers.otRate")} hint={t("workers.otHint")} value={v.otRate} onChange={(x) => f.set("otRate", x)} error={f.errors.otRatePaise} />
              </div>
            ) : (
              <p className="hint"><Icon name="lock" size={16} /><span>{t("workers.rateLocked")}</span></p>
            )}
          </div>
          <div className="form-actions">
            <Link className="btn btn-secondary" href={id ? `/labour/workers/view/?id=${id}` : "/labour/"}>{t("common.cancel")}</Link>
            <Button variant="primary" type="submit" disabled={f.submitting}>{f.submitting ? t("common.saving") : t("common.save")}</Button>
          </div>
        </form>
      )}
    </AppShell>
  );
}
