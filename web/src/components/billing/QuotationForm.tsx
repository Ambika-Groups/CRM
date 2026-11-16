"use client";
// A quotation (spec §8.2): the client, optionally the project, what it is for, dates, the lines under their section
// headings, what is included and left out, payment terms and the terms and conditions. Saving keeps a draft. Saving a
// quotation that was already sent makes the next version (same number) and leaves the sent one as it was (D-17).
import {
  DEFAULT_PAYMENT_TERMS, DEFAULT_QUOTATION_TERMS, addDays, isFinanceRole, quotationChangeRefusal, quotationItems, todayIST,
  type Quotation, type QuotationInput,
} from "@ag/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess, NotFoundRecord } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { Skeleton, useToast } from "@/components/ui/feedback";
import { DateField, ErrorSummary, SelectField, TextArea, TextField, fromDate, toDate, useForm } from "@/components/ui/form";
import { useDoc, useDocStatus, useRun, useSession } from "@/data/DataProvider";
import { useParam } from "@/lib/params";
import { ItemsEditor, TotalsBox, blankRow, itemsFromRows, previewBill, quotationName, rowsFromItems, useClients, useCompany, useProjects, type ItemRow } from "./common";

interface V {
  clientId: string; projectId: string; title: string; date: string; validUntil: string; placeOfSupply: string;
  terms: string; paymentTerms: string; inclusions: string; exclusions: string; notes: string;
}

export function QuotationForm({ mode }: { mode: "new" | "edit" }) {
  const { t } = useTranslation();
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const router = useRouter();
  const company = useCompany();
  const clients = useClients();
  const projects = useProjects();
  const idParam = useParam("id");
  const clientParam = useParam("client");
  const projectParam = useParam("project");
  const leadParam = useParam("lead");
  const id = mode === "edit" ? idParam : null;
  const existing = useDoc<Quotation>("quotations", id);
  const status = useDocStatus("quotations", id);
  const today = todayIST();
  const f = useForm<V>({
    clientId: "", projectId: "", title: "", date: fromDate(today), validUntil: fromDate(addDays(today, 30)), placeOfSupply: "",
    terms: DEFAULT_QUOTATION_TERMS, paymentTerms: DEFAULT_PAYMENT_TERMS, inclusions: "", exclusions: "", notes: "",
  });
  const v = f.values;
  const [rows, setRows] = useState<ItemRow[]>(() => [blankRow()]);
  const loaded = useRef<string | null>(null);
  const posFollowsClient = useRef(true);
  const finance = !!session && isFinanceRole(session.role);
  const revising = mode === "edit" && !!existing && existing.status !== "draft";

  // A quotation opened for editing fills the form once. A sent one is revised: the new version is dated today.
  useEffect(() => {
    if (mode !== "edit" || !existing || loaded.current === existing.id) return;
    loaded.current = existing.id;
    posFollowsClient.current = false;
    const sent = existing.status !== "draft";
    f.setAll({
      clientId: existing.clientId, projectId: existing.projectId ?? "", title: existing.title ?? "", date: fromDate(sent ? today : existing.date),
      validUntil: fromDate(sent ? addDays(today, 30) : existing.validUntil), placeOfSupply: existing.placeOfSupply, terms: existing.terms ?? "",
      paymentTerms: existing.paymentTerms ?? "", inclusions: existing.inclusions ?? "", exclusions: existing.exclusions ?? "", notes: existing.notes ?? "",
    });
    const items = quotationItems(existing);
    setRows(items.length ? rowsFromItems(items) : [blankRow()]);
  }, [mode, existing, f, today]);

  // A new quotation opened from a client or a project starts there.
  useEffect(() => {
    if (mode !== "new" || v.clientId || !clients || !projects) return;
    const p = projectParam ? projects.find((x) => x.id === projectParam) : undefined;
    const c = p?.clientId ?? (clientParam && clients.some((x) => x.id === clientParam) ? clientParam : "");
    if (c) { f.set("clientId", c); if (p) f.set("projectId", p.id); }
  }, [mode, v.clientId, clients, projects, clientParam, projectParam, f]);

  // The client's state is the place of supply until something else is typed.
  useEffect(() => {
    if (!posFollowsClient.current || v.placeOfSupply || !v.clientId || !clients) return;
    const c = clients.find((x) => x.id === v.clientId);
    f.set("placeOfSupply", c?.stateCode || c?.gstin?.slice(0, 2) || company.stateCode);
  }, [v.placeOfSupply, v.clientId, clients, company.stateCode, f]);

  const title = mode === "new" ? t("billing.q.newTitle") : revising ? t("billing.q.reviseTitle") : t("billing.q.editTitle");
  const crumbs = [{ label: t("nav.billing"), href: "/billing/quotations/" }, { label: title }];
  const shell = (body: ReactNode) => <AppShell nav="billing" title={title} crumbs={crumbs}>{body}</AppShell>;
  if (!session) return shell(<Skeleton lines={6} />);
  if (!finance) return shell(<NoAccess name={title} />);
  if (mode === "edit") {
    if (idParam === undefined || status === undefined) return shell(<Skeleton lines={6} />);
    if (status === "denied") return shell(<NoAccess name={title} />);
    if (status === "missing" || !existing) return shell(<NotFoundRecord name={title} back="/billing/quotations/" backLabel={t("billing.q.backToList")} />);
    const refusal = quotationChangeRefusal(existing);
    if (refusal) {
      return shell(<>
        <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
        <div className="banner warning" role="alert" data-edit-refused><Icon name="lock" />
          <span className="text">{existing.isLatest ? t("billing.q.acceptedLocked") : t("billing.q.olderBanner")}</span></div>
        <p><Link className="btn btn-secondary" href={`/billing/quotations/view/?id=${existing.supersededBy ?? existing.id}`}>{existing.supersededBy ? t("billing.q.openLatest") : t("billing.q.backToQuotation")}</Link></p>
      </>);
    }
  }

  const preview = previewBill(rows, company.stateCode, v.placeOfSupply);
  const clientOptions = (clients ?? []).map((c) => ({ value: c.id, label: c.name }));
  const projectOptions = (projects ?? []).filter((p) => !v.clientId || p.clientId === v.clientId).map((p) => ({ value: p.id, label: p.name }));

  const save = () => f.submit(async (x) => {
    const input: QuotationInput = {
      id: mode === "edit" ? existing!.id : null, clientId: x.clientId, projectId: x.projectId || null, leadId: existing?.leadId ?? leadParam ?? null, title: x.title,
      date: toDate(x.date), validUntil: toDate(x.validUntil), placeOfSupply: x.placeOfSupply.trim() || null, items: itemsFromRows(rows),
      terms: x.terms, paymentTerms: x.paymentTerms, inclusions: x.inclusions, exclusions: x.exclusions, notes: x.notes,
    };
    const r = await run("saveQuotation", input);
    toast(r.revised ? t("billing.q.savedRev", { n: r.version }) : t("billing.q.saved"));
    router.push(`/billing/quotations/view/?id=${r.id}`);
  });

  return shell(
    <>
      <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
      {revising && existing && (
        <div className="banner info" role="status" data-revising><Icon name="info" />
          <span className="text">{t("billing.q.reviseBanner", { name: quotationName(existing, t), n: existing.version + 1 })}</span></div>
      )}
      <form className="card" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} data-quotation-form>
        <ErrorSummary summary={f.summary} errors={f.errors} />
        <div className="form-section">
          <h2>{t("billing.q.for")}</h2>
          <div className="form-grid two">
            <SelectField label={t("billing.form.client")} value={v.clientId} error={f.errors.clientId} required placeholder={clients === undefined ? t("common.loading") : t("billing.form.chooseClient")}
              options={clientOptions} onChange={(x) => { posFollowsClient.current = true; f.set("clientId", x); f.set("placeOfSupply", ""); if (v.projectId && projects?.find((p) => p.id === v.projectId)?.clientId !== x) f.set("projectId", ""); }} />
            <SelectField label={t("billing.q.project")} value={v.projectId} error={f.errors.projectId} placeholder={t("billing.q.noProject")} hint={t("billing.q.projectHint")}
              options={projectOptions} onChange={(x) => f.set("projectId", x)} />
            <div className="span-2"><TextField label={t("billing.q.title")} hint={t("billing.q.titleHint")} value={v.title} onChange={(x) => f.set("title", x)} /></div>
            <DateField label={t("billing.col.date")} value={v.date} onChange={(x) => f.set("date", x)} error={f.errors.date} required />
            <DateField label={t("billing.q.validUntil")} value={v.validUntil} onChange={(x) => f.set("validUntil", x)} error={f.errors.validUntil} required />
            <TextField label={t("billing.form.pos")} hint={t("billing.form.posHint", { own: company.stateCode })} value={v.placeOfSupply} onChange={(x) => { posFollowsClient.current = false; f.set("placeOfSupply", x); }} error={f.errors.placeOfSupply} inputMode="numeric" />
          </div>
        </div>

        <div className="form-section">
          <h2>{t("billing.items.title")}</h2>
          <ItemsEditor rows={rows} onChange={setRows} errors={f.errors} />
        </div>

        <div className="form-section">
          <h2>{t("billing.totals.title")}</h2>
          {preview ? (
            <>
              <p className="muted small" data-tax-kind>{preview.intraState ? t("billing.totals.intra") : t("billing.totals.inter")}</p>
              <TotalsBox totals={preview.totals} words={preview.amountInWords} />
            </>
          ) : <p className="muted">{t("billing.totals.empty")}</p>}
        </div>

        <div className="form-section">
          <h2>{t("billing.q.scope")}</h2>
          <div className="form-grid two">
            <TextArea label={t("billing.q.inclusions")} value={v.inclusions} onChange={(x) => f.set("inclusions", x)} rows={3} />
            <TextArea label={t("billing.q.exclusions")} value={v.exclusions} onChange={(x) => f.set("exclusions", x)} rows={3} />
            <div className="span-2"><TextArea label={t("billing.q.paymentTerms")} value={v.paymentTerms} onChange={(x) => f.set("paymentTerms", x)} rows={2} /></div>
            <div className="span-2"><TextArea label={t("billing.q.terms")} hint={t("billing.q.termsHint")} value={v.terms} onChange={(x) => f.set("terms", x)} rows={5} /></div>
            <div className="span-2"><TextArea label={t("billing.form.notes")} value={v.notes} onChange={(x) => f.set("notes", x)} rows={2} /></div>
          </div>
        </div>

        <div className="form-actions">
          <Link className="btn btn-secondary" href={mode === "edit" && existing ? `/billing/quotations/view/?id=${existing.id}` : "/billing/quotations/"}>{t("common.cancel")}</Link>
          <Button variant="primary" type="submit" disabled={f.submitting} data-save>{f.submitting ? t("common.saving") : revising ? t("billing.q.saveRev", { n: (existing?.version ?? 1) + 1 }) : t("billing.form.saveDraft")}</Button>
        </div>
      </form>
    </>,
  );
}
