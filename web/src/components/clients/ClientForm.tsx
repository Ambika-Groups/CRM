"use client";
import { useRouter } from "next/navigation";
import { formatPhone, isFinanceRole, type Client, type ClientInput } from "@ag/core";
import { NoAccess } from "@/components/ModulePage";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton, useToast } from "@/components/ui/feedback";
import { ErrorSummary, SelectField, TextArea, TextField, useForm } from "@/components/ui/form";
import { useDoc, useRun, useSession } from "@/data/DataProvider";
import { useParam } from "@/lib/params";

const EMPTY: ClientInput = { name: "", type: "individual", company: "", phone: "", whatsapp: "", email: "", address: "", stateCode: "", gstin: "", pan: "", notes: "" };

/** Add or edit a client (spec §8.1). */
export function ClientForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useParam("id");
  const session = useSession();
  const existing = useDoc<Client>("clients", id);
  const run = useRun();
  const toast = useToast();
  const f = useForm<ClientInput>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (existing && !loaded) {
      f.setAll({
        ...EMPTY, ...existing, phone: existing.phone ? formatPhone(existing.phone) : "", whatsapp: existing.whatsapp ? formatPhone(existing.whatsapp) : "",
      } as ClientInput);
      setLoaded(true);
    }
  }, [existing, loaded, f]);

  const title = id ? t("clients.edit") : t("clients.new");
  if (session && !isFinanceRole(session.role)) {
    return <AppShell nav="clients" title={title} crumbs={[{ label: t("nav.clients"), href: "/clients/" }, { label: title }]}><NoAccess name={title} /></AppShell>;
  }
  const save = () => f.submit(async (v) => {
    const newId = id ? (await run("updateClient", { id, input: v }), id) : await run("createClient", { input: v });
    toast(t("clients.saved"));
    router.push(`/clients/view/?id=${newId}`);
  });

  return (
    <AppShell nav="clients" title={title} crumbs={[{ label: t("nav.clients"), href: "/clients/" }, { label: title }]}>
      <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
      {id && existing === undefined ? <Skeleton lines={6} /> : (
        <form className="card" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
          <ErrorSummary summary={f.summary} errors={f.errors} />
          <div className="form-section">
            <h2>{t("clients.contact")}</h2>
            <div className="form-grid two">
              <TextField label={t("clients.name")} hint={t("clients.nameHint")} value={f.values.name} onChange={(v) => f.set("name", v)} error={f.errors.name} required />
              <SelectField label={t("clients.type")} value={f.values.type} onChange={(v) => f.set("type", v)} error={f.errors.type}
                options={(["individual", "builder", "government"] as const).map((v) => ({ value: v, label: t(`clients.${v}`) }))} />
              <TextField label={t("clients.company")} value={f.values.company ?? ""} onChange={(v) => f.set("company", v)} />
              <TextField label={t("clients.phone")} hint={t("clients.anyPhoneHint")} value={f.values.phone ?? ""} onChange={(v) => f.set("phone", v)} error={f.errors.phone} inputMode="tel" autoComplete="tel" />
              <TextField label={t("clients.whatsapp")} hint={t("clients.phoneHint")} value={f.values.whatsapp ?? ""} onChange={(v) => f.set("whatsapp", v)} error={f.errors.whatsapp} inputMode="tel" />
              <TextField label={t("clients.email")} value={f.values.email ?? ""} onChange={(v) => f.set("email", v)} error={f.errors.email} type="email" inputMode="email" />
              <div className="span-2"><TextArea label={t("clients.address")} value={f.values.address ?? ""} onChange={(v) => f.set("address", v)} rows={2} /></div>
            </div>
          </div>
          <div className="form-section">
            <h2>{t("clients.tax")}</h2>
            <div className="form-grid two">
              <TextField label={t("clients.gstin")} hint={t("clients.gstinHint")} value={f.values.gstin ?? ""} onChange={(v) => f.set("gstin", v)} error={f.errors.gstin} />
              <TextField label={t("clients.pan")} hint={t("clients.panHint")} value={f.values.pan ?? ""} onChange={(v) => f.set("pan", v)} error={f.errors.pan} />
              <TextField label={t("clients.stateCode")} hint={t("clients.stateHint")} value={f.values.stateCode ?? ""} onChange={(v) => f.set("stateCode", v)} error={f.errors.stateCode} inputMode="numeric" />
              <div className="span-2"><TextArea label={t("clients.notes")} value={f.values.notes ?? ""} onChange={(v) => f.set("notes", v)} /></div>
            </div>
          </div>
          <div className="form-actions">
            <Link className="btn btn-secondary" href={id ? `/clients/view/?id=${id}` : "/clients/"}>{t("common.cancel")}</Link>
            <Button variant="primary" type="submit" disabled={f.submitting}>{f.submitting ? t("common.saving") : t("common.save")}</Button>
          </div>
        </form>
      )}
    </AppShell>
  );
}
