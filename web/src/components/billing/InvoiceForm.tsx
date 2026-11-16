"use client";
// A bill as a draft (spec §8.3): the kind of bill, the client and project, dates, place of supply, the lines, and the
// deductions the client makes (TDS, retention…). Totals are shown as you type. Saving keeps a draft; the bill gets its
// number when it is issued from the bill's own page, after a confirmation.
import {
  DRAFT_INVOICE_TYPES, invoiceEditRefusal, isFinanceRole, raCarryForward, todayIST,
  type BillDeductionInput, type BillingInvoice, type InvoiceDraftInput, type InvoiceType,
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
import { DateField, ErrorSummary, MoneyField, SelectField, TextArea, TextField, fromBp, fromDate, fromPaise, toBp, toDate, toPaise, useForm } from "@/components/ui/form";
import { useDoc, useDocStatus, useRead, useRun, useSession } from "@/data/DataProvider";
import { useParam } from "@/lib/params";
import { ItemsEditor, RaBox, TotalsBox, blankRow, itemsFromRows, previewBill, rowsFromItems, useClients, useCompany, useProjects, type ItemRow } from "./common";

interface V { type: InvoiceType; clientId: string; projectId: string; date: string; dueDate: string; placeOfSupply: string; notes: string }
interface DedRow { key: string; head: string; rate: string; amount: string; reason: string }

let dedSeq = 0;
const dedRow = (d: Partial<Omit<DedRow, "key">> = {}): DedRow => ({ key: `d${++dedSeq}`, head: "", rate: "", amount: "", reason: "", ...d });
const dedInputs = (rows: DedRow[]): BillDeductionInput[] => rows.filter((r) => r.head.trim() || r.rate.trim() || r.amount.trim()).map((r) => ({
  head: r.head, rateBp: toBp(r.rate) ?? 0, overridePaise: r.amount.trim() ? toPaise(r.amount) : null, reason: r.reason,
}));

export function InvoiceForm({ mode }: { mode: "new" | "edit" }) {
  const { t } = useTranslation();
  const session = useSession();
  const run = useRun();
  const toast = useToast();
  const router = useRouter();
  const company = useCompany();
  const clients = useClients();
  const projects = useProjects();
  const idParam = useParam("id");
  const projectParam = useParam("project");
  const fromParam = useParam("from");
  const id = mode === "edit" ? idParam : null;
  const existing = useDoc<BillingInvoice>("invoices", id);
  const status = useDocStatus("invoices", id);
  const proforma = useDoc<BillingInvoice>("invoices", mode === "new" ? fromParam : null);
  const f = useForm<V>({ type: "tax", clientId: "", projectId: "", date: fromDate(todayIST()), dueDate: "", placeOfSupply: "", notes: "" });
  const v = f.values;
  const [rows, setRows] = useState<ItemRow[]>(() => [blankRow()]);
  const [deds, setDeds] = useState<DedRow[]>([]);
  const loaded = useRef<string | null>(null);
  const filledFor = useRef<string | null>(null);
  /** True until the place of supply is typed by hand: until then it follows the client's state. */
  const posFollowsClient = useRef(true);
  const finance = !!session && isFinanceRole(session.role);

  const commercial = useDoc<{ government?: { deductionHeads?: { head: string; rateBp: number }[] } }>(v.projectId ? `projects/${v.projectId}/private` : "none", v.projectId ? "commercial" : null);
  const heads = commercial?.government?.deductionHeads ?? [];
  const projectBills = useRead(`bill-ra:${v.type}:${v.projectId}`, (s) => (v.type === "ra" && v.projectId
    ? s.query<BillingInvoice>("invoices", { where: [{ field: "projectId", op: "==", value: v.projectId }], orderBy: [{ field: "date", dir: "desc" }], limit: 50 })
    : Promise.resolve({ items: [] as BillingInvoice[], next: null, total: 0 })));

  // A draft opened for editing, or a proforma being made into a tax bill, fills the form once.
  useEffect(() => {
    const src = mode === "edit" ? existing : proforma;
    if (!src || loaded.current === src.id) return;
    loaded.current = src.id;
    filledFor.current = src.projectId;
    posFollowsClient.current = !src.placeOfSupply;
    f.setAll({
      type: mode === "edit" ? src.type : "tax", clientId: src.clientId, projectId: src.projectId, date: mode === "edit" ? fromDate(src.date) : fromDate(todayIST()),
      dueDate: mode === "edit" ? fromDate(src.dueDate) : "", placeOfSupply: src.placeOfSupply ?? "", notes: src.notes ?? "",
    });
    setRows(src.items.length ? rowsFromItems(src.items) : [blankRow()]);
    setDeds((src.deductions ?? []).map((d) => dedRow({ head: d.head, rate: fromBp(d.rateBp), amount: d.overridden ? fromPaise(d.amountPaise) : "", reason: d.reason ?? "" })));
  }, [mode, existing, proforma, f]);

  // A new bill opened from a project starts on that project and its client.
  useEffect(() => {
    if (mode !== "new" || v.projectId || !projects || !projectParam) return;
    const p = projects.find((x) => x.id === projectParam);
    if (p) { posFollowsClient.current = true; f.set("projectId", p.id); f.set("clientId", p.clientId); }
  }, [mode, v.projectId, projects, projectParam, f]);

  // The client's state is the place of supply until something else is typed.
  useEffect(() => {
    if (!posFollowsClient.current || v.placeOfSupply || !v.clientId || !clients) return;
    const c = clients.find((x) => x.id === v.clientId);
    f.set("placeOfSupply", c?.stateCode || c?.gstin?.slice(0, 2) || company.stateCode);
  }, [v.placeOfSupply, v.clientId, clients, company.stateCode, f]);

  // A project with its own deductions (a government work) brings them in once, when it is chosen.
  useEffect(() => {
    if (!v.projectId || filledFor.current === v.projectId || commercial === undefined) return;
    filledFor.current = v.projectId;
    if (heads.length && deds.length === 0 && v.type !== "proforma") setDeds(heads.map((h) => dedRow({ head: h.head, rate: fromBp(h.rateBp) })));
  }, [v.projectId, commercial]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = mode === "edit" ? t("billing.form.editTitle") : t("billing.form.newTitle");
  const crumbs = [{ label: t("nav.billing"), href: "/billing/" }, { label: title }];
  const shell = (body: ReactNode) => <AppShell nav="billing" title={title} crumbs={crumbs}>{body}</AppShell>;
  if (!session) return shell(<Skeleton lines={6} />);
  if (!finance) return shell(<NoAccess name={title} />);
  if (mode === "edit") {
    if (idParam === undefined || status === undefined) return shell(<Skeleton lines={6} />);
    if (status === "denied") return shell(<NoAccess name={title} />);
    if (status === "missing" || !existing) return shell(<NotFoundRecord name={title} back="/billing/" backLabel={t("billing.detail.backToList")} />);
    if (invoiceEditRefusal(existing)) {
      return shell(<>
        <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
        <div className="banner warning" role="alert" data-edit-refused><Icon name="lock" /><span className="text">{t("billing.form.locked")}</span></div>
        <p><Link className="btn btn-secondary" href={`/billing/invoices/view/?id=${existing.id}`}>{t("billing.form.backToBill")}</Link></p>
      </>);
    }
  }

  const deductions = dedInputs(deds);
  const preview = previewBill(rows, company.stateCode, v.placeOfSupply, deductions);
  const ra = v.type === "ra" && v.projectId && preview && projectBills
    ? raCarryForward(projectBills.items, { id: existing?.id ?? null, projectId: v.projectId, taxablePaise: preview.totals.taxablePaise, totalPaise: preview.totals.totalPaise }) : null;
  const clientOptions = (clients ?? []).map((c) => ({ value: c.id, label: c.name }));
  const projectOptions = (projects ?? []).filter((p) => !v.clientId || p.clientId === v.clientId).map((p) => ({ value: p.id, label: p.name }));
  const setDed = (i: number, patch: Partial<DedRow>) => setDeds((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = () => f.submit(async (x) => {
    const input: InvoiceDraftInput = {
      id: mode === "edit" ? existing!.id : null, type: x.type, projectId: x.projectId, clientId: x.clientId || null, date: toDate(x.date), dueDate: toDate(x.dueDate) || null,
      placeOfSupply: x.placeOfSupply.trim() || null, items: itemsFromRows(rows), deductions: x.type === "proforma" ? [] : deductions, notes: x.notes,
      fromProformaId: mode === "new" && proforma ? proforma.id : existing?.fromProformaId ?? null, quotationId: existing?.quotationId ?? null, milestoneId: existing?.milestoneId ?? null,
    };
    const r = await run("saveInvoiceDraft", input);
    toast(t("billing.form.saved"));
    router.push(`/billing/invoices/view/?id=${r.id}`);
  });

  return shell(
    <>
      <div className="page-head"><div className="heading"><h1>{title}</h1></div></div>
      {mode === "new" && proforma && <p className="hint" data-from-proforma><Icon name="info" size={16} /><span>{t("billing.form.fromProforma", { number: proforma.number ?? "" })}</span></p>}
      <form className="card" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} data-invoice-form>
        <ErrorSummary summary={f.summary} errors={f.errors} />
        <div className="form-section">
          <h2>{t("billing.form.party")}</h2>
          <div className="form-grid two">
            <SelectField label={t("billing.form.kind")} value={v.type} onChange={(x) => f.set("type", x)} error={f.errors.type} hint={t(`billing.typeHint.${v.type}`)}
              options={DRAFT_INVOICE_TYPES.map((k) => ({ value: k, label: t(`billing.type.${k}`) }))} />
            <SelectField label={t("billing.form.client")} value={v.clientId} error={f.errors.clientId} required placeholder={clients === undefined ? t("common.loading") : t("billing.form.chooseClient")}
              options={clientOptions} onChange={(x) => { posFollowsClient.current = true; f.set("clientId", x); f.set("placeOfSupply", ""); if (v.projectId && projects?.find((p) => p.id === v.projectId)?.clientId !== x) f.set("projectId", ""); }} />
            <SelectField label={t("billing.form.project")} value={v.projectId} error={f.errors.projectId} required placeholder={projects === undefined ? t("common.loading") : t("billing.form.chooseProject")}
              hint={v.clientId && projects && projectOptions.length === 0 ? t("billing.form.noProjects") : undefined} options={projectOptions}
              onChange={(x) => { f.set("projectId", x); const p = projects?.find((y) => y.id === x); if (p && p.clientId !== v.clientId) { posFollowsClient.current = true; f.set("clientId", p.clientId); f.set("placeOfSupply", ""); } }} />
            <TextField label={t("billing.form.pos")} hint={t("billing.form.posHint", { own: company.stateCode })} value={v.placeOfSupply} onChange={(x) => { posFollowsClient.current = false; f.set("placeOfSupply", x); }} error={f.errors.placeOfSupply} inputMode="numeric" />
            <DateField label={t("billing.form.date")} value={v.date} onChange={(x) => f.set("date", x)} error={f.errors.date} required />
            <DateField label={t("billing.form.dueDate")} hint={t("billing.form.dueHint")} value={v.dueDate} onChange={(x) => f.set("dueDate", x)} error={f.errors.dueDate} />
          </div>
        </div>

        <div className="form-section">
          <h2>{t("billing.items.title")}</h2>
          <ItemsEditor rows={rows} onChange={setRows} errors={f.errors} />
        </div>

        {v.type !== "proforma" && (
          <div className="form-section" data-deductions>
            <h2>{t("billing.ded.title")}</h2>
            <p className="hint"><Icon name="info" size={16} /><span>{t("billing.ded.hint")}</span></p>
            {f.errors.deductions && <p className="field-error" role="alert"><Icon name="alert" size={16} />{f.errors.deductions}</p>}
            {deds.map((d, i) => (
              <fieldset key={d.key} className="bill-item" data-deduction={i}>
                <legend>{d.head || t("billing.ded.one", { n: i + 1 })}</legend>
                <button type="button" className="icon-btn bill-item-remove" aria-label={t("billing.ded.remove", { name: d.head || String(i + 1) })} onClick={() => setDeds((x) => x.filter((_, j) => j !== i))}><Icon name="trash" /></button>
                <div className="bill-item-grid">
                  <TextField label={t("billing.ded.head")} hint={i === 0 ? t("billing.ded.headHint") : undefined} value={d.head} onChange={(x) => setDed(i, { head: x })} error={f.errors[`deductions.${i}.head`]} />
                  <TextField label={t("billing.ded.rate")} value={d.rate} onChange={(x) => setDed(i, { rate: x })} error={f.errors[`deductions.${i}.rateBp`]} inputMode="decimal" />
                  <MoneyField label={t("billing.ded.amount")} hint={i === 0 ? t("billing.ded.amountHint") : undefined} value={d.amount} onChange={(x) => setDed(i, { amount: x })} error={f.errors[`deductions.${i}.overridePaise`]} />
                  {d.amount.trim() !== "" && <TextField label={t("billing.ded.reason")} value={d.reason} onChange={(x) => setDed(i, { reason: x })} error={f.errors[`deductions.${i}.reason`]} required />}
                </div>
              </fieldset>
            ))}
            <div className="bill-items-add">
              <Button variant="secondary" onClick={() => setDeds((x) => [...x, dedRow()])} data-add-deduction><Icon name="plus" />{t("billing.ded.add")}</Button>
              {heads.length > 0 && deds.length === 0 && <Button variant="secondary" onClick={() => setDeds(heads.map((h) => dedRow({ head: h.head, rate: fromBp(h.rateBp) })))}>{t("billing.ded.useProject")}</Button>}
            </div>
          </div>
        )}

        <div className="form-section">
          <h2>{t("billing.totals.title")}</h2>
          {preview ? (
            <>
              <p className="muted small" data-tax-kind>{preview.intraState ? t("billing.totals.intra") : t("billing.totals.inter")}</p>
              <TotalsBox totals={preview.totals} deductions={preview.deductions} netPaise={preview.netReceivablePaise} words={preview.amountInWords} />
              {ra && <RaBox ra={ra} />}
            </>
          ) : <p className="muted">{t("billing.totals.empty")}</p>}
          <TextArea label={t("billing.form.notes")} hint={t("billing.form.notesHint")} value={v.notes} onChange={(x) => f.set("notes", x)} rows={2} />
        </div>

        <p className="hint"><Icon name="info" size={16} /><span>{t("billing.form.draftNote")}</span></p>
        <div className="form-actions">
          <Link className="btn btn-secondary" href={mode === "edit" && existing ? `/billing/invoices/view/?id=${existing.id}` : "/billing/"}>{t("common.cancel")}</Link>
          <Button variant="primary" type="submit" disabled={f.submitting} data-save>{f.submitting ? t("common.saving") : t("billing.form.saveDraft")}</Button>
        </div>
      </form>
    </>,
  );
}
