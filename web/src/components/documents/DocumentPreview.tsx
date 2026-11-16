"use client";
// A document on screen with its actions (spec §8.4, §8.5): the page as it will print, the message that will be sent,
// and who shared it so far. `DocumentPreview` takes any document model; `DocumentPreviewPage` is the route that builds
// the model for an invoice or a receipt (?type=invoice|receipt&id=…).
import {
  SHARE_LOG_COLLECTION, amountInWords, formatPhone, invoiceDocument, isFinanceReader, isFinanceRole, receiptDocument, shareMessage, shareTemplatesFrom,
  type BankInfo, type Client, type CompanyInfo, type DocumentModel, type Invoice, type Lang, type PaymentReceived, type Project, type ShareLogRecord,
} from "@ag/core";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess, NotFoundRecord } from "@/components/ModulePage";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/shell/Icon";
import { Skeleton } from "@/components/ui/feedback";
import { useDoc, useDocStatus, useRead, useSession } from "@/data/DataProvider";
import { date } from "@/lib/fmt";
import { useParam } from "@/lib/params";
import { DocumentActions } from "./DocumentActions";
import { DocumentSheet } from "./DocumentSheet";

const when = (iso: string, lang: Lang) => {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000).toISOString(); // shown in India time
  return `${date(d.slice(0, 10), lang)}, ${d.slice(11, 16)}`;
};

/** The shares of one record, newest first (up to 20). Only the owner and the accountant may read the share log. */
function ShareHistory({ entity, lang }: { entity: { collection: string; id: string }; lang: Lang }) {
  const { t } = useTranslation();
  const rows = useRead(`share-log:${entity.collection}/${entity.id}`, (s) =>
    s.query<ShareLogRecord>(SHARE_LOG_COLLECTION, { where: [{ field: "documentId", op: "==", value: entity.id }], limit: 20 })
      .then((p) => p.items.filter((r) => r.documentType === entity.collection).sort((a, b) => b.sentAt.localeCompare(a.sentAt)))
      .catch(() => [] as ShareLogRecord[]));
  return (
    <section className="card" aria-labelledby="doc-log-title" data-share-log data-count={rows?.length ?? ""}>
      <h2 className="card-title" id="doc-log-title">{t("documents.history.title")}</h2>
      {!rows ? <Skeleton lines={2} /> : rows.length === 0 ? <p className="muted">{t("documents.history.empty")}</p> : (
        <ol className="doc-log">
          {rows.map((r) => (
            <li key={r.id} data-channel={r.channel}>
              <b>{t(`documents.channel.${r.channel}`, { defaultValue: r.channel })}</b>
              <span>{r.phone ? formatPhone(r.phone) : t("documents.history.noNumber")}</span>
              <span className="muted small">{[r.sentByName, when(r.sentAt, lang)].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export interface DocumentPreviewProps {
  model: DocumentModel;
  entity: { collection: string; id: string };
  phone?: string | null;
  /** The message to send with it (see core `shareMessage`). */
  message: string;
  /** The language of the page, and how to change it (leave out to hide the choice). */
  onLang?: (lang: Lang) => void;
  /** Extra notes above the page (for example "this bill is still a draft"). */
  children?: ReactNode;
}

/** Any document model on screen: the actions, the message, the page, and the share history. */
export function DocumentPreview({ model, entity, phone, message, onLang, children }: DocumentPreviewProps) {
  const { t } = useTranslation();
  const session = useSession();
  return (
    <div className="doc-layout" data-document-preview data-doc-lang={model.lang}>
      <section className="card" aria-label={t("documents.actions")}>
        {onLang && (
          <div className="doc-lang">
            <span id="doc-lang-label">{t("documents.lang.label")}</span>
            <div className="segmented" role="group" aria-labelledby="doc-lang-label">
              <button type="button" aria-pressed={model.lang === "en"} onClick={() => onLang("en")} data-doc-lang-en>English</button>
              <button type="button" aria-pressed={model.lang === "hi"} onClick={() => onLang("hi")} lang="hi" data-doc-lang-hi>हिंदी</button>
            </div>
          </div>
        )}
        <DocumentActions model={model} entity={entity} phone={phone} message={message} />
        <h2 className="doc-h">{t("documents.message.title")}</h2>
        <p className="doc-message" lang={model.lang} data-share-message>{message}</p>
      </section>
      {children}
      <DocumentSheet model={model} label={t("documents.sheet.label")} />
      {session && isFinanceRole(session.role) && <ShareHistory entity={entity} lang={model.lang} />}
    </div>
  );
}

/** The route: an invoice or a receipt as a document. Owner, accountant and the CA (the roles that read these records). */
export function DocumentPreviewPage() {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const type = useParam("type");
  const id = useParam("id");
  const isReceipt = type === "receipt";
  const known = type === "invoice" || isReceipt;
  const collection = isReceipt ? "payments_received" : "invoices";
  const rec = useDoc<Invoice | PaymentReceived>(collection, known ? id : null);
  const status = useDocStatus(collection, known ? id : null);
  const finance = !!session && isFinanceRole(session.role);
  const reader = !!session && isFinanceReader(session.role);
  // Everything below is optional: the page is built with what this role may read, and fills in as it arrives.
  const company = useDoc<CompanyInfo>("settings", "company");
  const bank = useDoc<{ accounts?: BankInfo[] }>("settings", reader ? "bank" : null);
  const templates = useDoc<Record<string, unknown>>("settings", reader ? "templates" : null);
  const client = useDoc<Client>("clients", finance && rec ? rec.clientId : null);
  const project = useDoc<Project>("projects", rec ? rec.projectId : null);
  const billed = useDoc<Invoice>("invoices", isReceipt && rec ? (rec as PaymentReceived).invoiceId ?? null : null);
  const [chosen, setChosen] = useState<Lang | null>(null);
  const lang: Lang = chosen ?? (i18n.language === "hi" ? "hi" : "en");

  const model = useMemo(() => {
    if (!rec) return null;
    const opts = {
      lang, bank: bank?.accounts?.[0] ?? null,
      project: project ? { name: project.name, address: [project.address, project.city].filter(Boolean).join(", ") } : null,
    };
    if (isReceipt) return receiptDocument(rec as PaymentReceived, company, client, { ...opts, invoiceNumber: billed?.number });
    const inv = rec as Invoice;
    const payable = inv.netReceivablePaise ?? inv.totals?.totalPaise ?? -1;
    // Amount in words is written in English only, so a Hindi page leaves it out.
    return invoiceDocument(inv, company, client, { ...opts, amountInWords: lang === "en" && payable >= 0 ? amountInWords(payable) : undefined });
  }, [rec, isReceipt, lang, company, bank, client, project, billed]);
  const message = useMemo(() => (model ? shareMessage(model.kind, lang, model.shareValues, shareTemplatesFrom(templates)) : ""), [model, lang, templates]);

  const title = isReceipt ? t("documents.title.receipt") : t("documents.title.invoice");
  const crumbs = [{ label: t("nav.billing"), href: "/billing/" }, { label: title }];
  const shell = (body: ReactNode) => <AppShell nav="billing" title={title} crumbs={crumbs}>{body}</AppShell>;
  if (type === undefined || id === undefined || !session || (known && status === undefined)) return shell(<Skeleton lines={8} />);
  if (status === "denied") return shell(<NoAccess name={title} />);
  if (!known || !id || !rec || !model) return shell(<NotFoundRecord name={title} back="/billing/" backLabel={t("documents.back")} />);

  return shell(
    <>
      <div className="page-head">
        <div className="heading">
          <h1>{model.number ?? title}</h1>
          <p className="sub">{[model.title, model.parties[0]?.name].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="page-actions"><Link className="btn btn-text" href="/billing/"><Icon name="back" />{t("documents.back")}</Link></div>
      </div>
      <DocumentPreview model={model} entity={{ collection, id }} phone={client?.whatsapp || client?.phone || null} message={message} onLang={setChosen}>
        {!isReceipt && !model.number && <div className="banner info" role="status" data-draft-note><Icon name="info" /><span className="text">{t("documents.draftNote")}</span></div>}
      </DocumentPreview>
    </>,
  );
}
