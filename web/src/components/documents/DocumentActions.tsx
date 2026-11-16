"use client";
// The three things a person does with a document (spec §8.5): print it or save it as a PDF, send the message on
// WhatsApp, or copy the message. The file is made by the phone's or computer's own "Save as PDF" (no server PDF).
import { formatPhone, normaliseIndianMobile, whatsappLink, type DocumentModel } from "@ag/core";
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { shareDocument } from "@/components/share";
import { useShareLogger } from "@/components/share/ShareLogBridge";
import { Icon } from "@/components/shell/Icon";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/feedback";
import { PrintOnly } from "./DocumentSheet";

export interface DocumentActionsProps {
  model: DocumentModel;
  /** The record the document was made from: the share log points at it. */
  entity: { collection: string; id: string };
  /** The client's WhatsApp or mobile number, if one is saved. */
  phone?: string | null;
  /** The message to send (a filled template). */
  message: string;
}

export function DocumentActions({ model, entity, phone, message }: DocumentActionsProps) {
  const { t } = useTranslation();
  const toast = useToast();
  useShareLogger();
  const [busy, setBusy] = useState(false);
  const mobile = phone ? normaliseIndianMobile(phone) : null;

  const share = async (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault(); // the link's address is the same wa.me address; going through shareDocument also logs it
    if (busy) return;
    setBusy(true);
    try {
      const result = await shareDocument({ entity, phone, text: message });
      if (result !== "cancelled") toast(t(result === "opened" ? "documents.share.opened" : "documents.share.shared"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast(t("documents.copy.done"));
    } catch {
      toast(t("documents.copy.failed"), "error");
    }
  };

  return (
    <div className="doc-actions-wrap" data-document-actions>
      <PrintOnly model={model} />
      <div className="doc-actions">
        <Button variant="primary" onClick={() => window.print()} data-print><Icon name="printer" />{t("documents.print.action")}</Button>
        <a className="btn btn-secondary" href={whatsappLink(phone, message)} target="_blank" rel="noopener noreferrer" onClick={share} aria-disabled={busy} data-whatsapp>
          <Icon name="message" />{t("documents.share.action")}
        </a>
        <Button variant="secondary" onClick={copy} data-copy><Icon name="copy" />{t("documents.copy.action")}</Button>
      </div>
      <p className="hint"><Icon name="info" size={16} /><span>{t("documents.print.hint")}</span></p>
      <p className="hint" data-share-hint>
        <Icon name="message" size={16} />
        <span>{mobile ? t("documents.share.to", { phone: formatPhone(`+91${mobile}`) }) : t("documents.share.noNumber")} {t("documents.share.attach")}</span>
      </p>
    </div>
  );
}
